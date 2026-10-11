#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UI 合理性自动审计工具（通用）
================================
检测任意实现了 __dive.uiProbe() 契约的 Phaser/Canvas 游戏的 UI 健康问题：

  1. 越界 overflow      —— 元素超出画布边界（左/上/右/下）
  2. 重叠 overlap       —— 文字溢出面板、文字压文字、热区压热区
  3. 对比度 contrast    —— 文字色 vs 背景色（WCAG AA：正文≥4.5，大字≥3.0）
  4. 密度 density       —— 单位面积文字数 + 3×3 网格热点区

契约（被审计方需实现）：
  window.__dive.uiProbe() -> {
      phase: str, W: int, H: int,
      nodes: [{ kind:'text'|'panel'|'hit',
                x,y,w,h, color?, fill?, edge?, size?, text?, cat?'ui'|'float' }],
      theme: { abyss: '#04070d', panel:'#08111c', panelHi:'#0e1a29' }
  }
  每帧 draw 阶段累积 nodes 即可，本工具只负责读取+分析+出报告。

用法：
  python3 ui_audit.py                       # 默认审计本机 4178 端口全部相位
  python3 ui_audit.py --phases wave,shop    # 只审计指定相位
  python3 ui_audit.py --url http://x:4178   # 指定地址
  python3 ui_audit.py --no-shot             # 不生成标注截图（只出 JSON）

输出：
  <out>/ui_audit_report.json    —— 结构化问题清单（按相位分组 + 汇总）
  <out>/ui_audit_<phase>.png    —— 各相位标注截图（红=越界/严重重叠，橙=文字重叠，黄=低对比）
"""
import argparse, base64, json, os, subprocess, sys, time, urllib.request, websocket
from datetime import datetime

# ----------------------------- 阈值（可调的"通用"参数） -----------------------------
TOL_TEXT = 4.0      # 文字越界容差（描边 3px，给点余量）
TOL_BOX = 2.0       # 面板/热区越界容差
PANEL_SPILL = 6.0   # 文字相对面板溢出超过此值才算"溢出面板"（像素）
OVERLAP_RATIO = 0.30  # 两框相交面积占较小框比例超过此值 → 重叠
CONTRAST_NORMAL = 4.5  # WCAG AA 正文
CONTRAST_LARGE = 3.0   # WCAG AA 大字（size>=24）
DENSITY_PER_100K = 7.0  # 每 10 万像素文字数超过此值 → 偏密
HOT_CELL = 8            # 3×3 网格单格文字数超过此值 → 热点拥挤
CDP_PORT = 9222
OUT = "/workspace/web/tools/audit"

# ----------------------------- CDP 基础（与 shot.py 同款） -----------------------------
def wait_cdp(t=25):
    for _ in range(t * 4):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page":
                        return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.25)
    raise SystemExit("CDP 未就绪")

class C:
    def __init__(s, ws):
        s.ws = websocket.create_connection(ws, timeout=30); s.i = 0
    def call(s, m, p=None):
        s.i += 1; s.ws.send(json.dumps({"id": s.i, "method": m, "params": p or {}}))
        while True:
            x = json.loads(s.ws.recv())
            if x.get("id") == s.i: return x
    def ev(s, e):
        r = s.call("Runtime.evaluate", {"expression": e, "returnByValue": True})
        return r.get("result", {}).get("result", {}).get("value")
    def shot(s, n, path):
        r = s.call("Page.captureScreenshot", {"format": "png"})
        open(path, "wb").write(base64.b64decode(r["result"]["data"])); return path
    def key(s, k, c, v):
        for t in ("keyDown", "keyUp"):
            s.call("Input.dispatchKeyEvent", {"type": t, "key": k, "code": c,
                                              "windowsVirtualKeyCode": v, "nativeVirtualKeyCode": v})
    def click(s, x, y):
        for t in ("mousePressed", "mouseReleased"):
            s.call("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y,
                                                "button": "left", "clickCount": 1})

def ui_probe(c): return c.ev("window.__dive ? __dive.uiProbe() : null")

# ----------------------------- 颜色 / 几何 工具 -----------------------------
def hex2rgb(h):
    if not isinstance(h, str) or not h.startswith("#") or len(h) < 7:
        return None
    h = h.lstrip("#")
    try: return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except Exception: return None

def rel_lum(rgb):
    def f(c):
        c /= 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def contrast(c1, c2):
    a, b = hex2rgb(c1), hex2rgb(c2)
    if not a or not b: return 99.0   # 颜色无法解析时按"安全"处理，不误报
    hi, lo = max(rel_lum(a), rel_lum(b)), min(rel_lum(a), rel_lum(b))
    return (hi + 0.05) / (lo + 0.05)

def area(n): return n["w"] * n["h"]
def center(n): return (n["x"] + n["w"] / 2, n["y"] + n["h"] / 2)
def in_rect(px, py, n, pad=0):
    return n["x"] - pad <= px <= n["x"] + n["w"] + pad and n["y"] - pad <= py <= n["y"] + n["h"] + pad
def inter_area(a, b):
    x = max(a["x"], b["x"]); y = max(a["y"], b["y"])
    xx = min(a["x"] + a["w"], b["x"] + b["w"]); yy = min(a["y"] + a["h"], b["y"] + b["h"])
    w = xx - x; h = yy - y
    return w * h if (w > 0 and h > 0) else 0

# ----------------------------- 四项检测 -----------------------------
def check_overflow(nodes, W, H):
    issues = []
    for n in nodes:
        tol = TOL_TEXT if n["kind"] == "text" else TOL_BOX
        sides = []
        if n["x"] < -tol: sides.append("左")
        if n["y"] < -tol: sides.append("上")
        if n["x"] + n["w"] > W + tol: sides.append("右")
        if n["y"] + n["h"] > H + tol: sides.append("下")
        if sides:
            issues.append({"type": "overflow", "kind": n["kind"],
                           "label": n.get("text") or n["kind"],
                           "box": [n["x"], n["y"], n["w"], n["h"]],
                           "sides": sides})
    return issues

def check_overlap(nodes):
    texts = [n for n in nodes if n["kind"] == "text" and n.get("cat") != "float"]
    panels = [n for n in nodes if n["kind"] == "panel"]
    hits = [n for n in nodes if n["kind"] == "hit"]
    issues = []
    # ① 文字溢出面板（仅当文字显著逃出面板才报：居中标题贴边不算）
    for t in texts:
        cx, cy = center(t)
        host = next((p for p in panels if in_rect(cx, cy, p)), None)
        if not host: continue
        inter = inter_area(t, host)
        outside = area(t) - inter
        if area(t) > 0 and outside / area(t) > 0.35:
            spill = max(0, t["x"] - host["x"], host["x"] + host["w"] - (t["x"] + t["w"]),
                        t["y"] - host["y"], host["y"] + host["h"] - (t["y"] + t["h"]))
            issues.append({"type": "text_out_of_panel", "label": t.get("text"),
                           "box": [t["x"], t["y"], t["w"], t["h"]],
                           "panel": [host["x"], host["y"], host["w"], host["h"]],
                           "outside_ratio": round(outside / area(t), 2),
                           "spill": round(spill, 1)})
    # ② 文字压文字（ui 类）
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            inter = inter_area(texts[i], texts[j])
            if not inter: continue
            smaller = min(area(texts[i]), area(texts[j]))
            if inter / smaller > OVERLAP_RATIO:
                issues.append({"type": "text_text_overlap",
                               "a": texts[i].get("text"), "b": texts[j].get("text"),
                               "box_a": [texts[i]["x"], texts[i]["y"], texts[i]["w"], texts[i]["h"]],
                               "box_b": [texts[j]["x"], texts[j]["y"], texts[j]["w"], texts[j]["h"]],
                               "ratio": round(inter / smaller, 2)})
    # ③ 热区压热区（按钮/卡片互相覆盖）
    for i in range(len(hits)):
        for j in range(i + 1, len(hits)):
            inter = inter_area(hits[i], hits[j])
            if not inter: continue
            smaller = min(area(hits[i]), area(hits[j]))
            if inter / smaller > OVERLAP_RATIO:
                issues.append({"type": "hit_hit_overlap",
                               "box_a": [hits[i]["x"], hits[i]["y"], hits[i]["w"], hits[i]["h"]],
                               "box_b": [hits[j]["x"], hits[j]["y"], hits[j]["w"], hits[j]["h"]],
                               "ratio": round(inter / smaller, 2)})
    return issues

def check_contrast(nodes, theme):
    texts = [n for n in nodes if n["kind"] == "text"]
    panels = [n for n in nodes if n["kind"] == "panel"]
    issues = []
    for t in texts:
        col = hex2rgb(t.get("color"))
        if not col: continue
        cx, cy = center(t)
        bg_hex = theme.get("abyss", "#000000")
        host = next((p for p in panels if in_rect(cx, cy, p)), None)
        if host and host.get("fill"): bg_hex = host["fill"]
        bg = hex2rgb(bg_hex)
        if not bg: continue
        ratio = contrast(t["color"], bg_hex)
        size = t.get("size", 12)
        needed = CONTRAST_LARGE if size >= 24 else CONTRAST_NORMAL
        if ratio < needed:
            issues.append({"type": "low_contrast", "label": t.get("text"),
                           "box": [t["x"], t["y"], t["w"], t["h"]],
                           "ratio": round(ratio, 2), "needed": needed,
                           "text_color": t["color"], "bg_color": bg_hex,
                           "bg_kind": "panel" if host else "abyss"})
    return issues

def check_density(nodes, W, H):
    texts = [n for n in nodes if n["kind"] == "text" and n.get("cat") != "float"]
    total = len(texts)
    per_100k = round(total / (W * H / 100000.0), 2) if W and H else 0
    grid = [[0] * 3 for _ in range(3)]
    for t in texts:
        cx, cy = center(t)
        gx = min(2, max(0, int(cx / (W / 3))))
        gy = min(2, max(0, int(cy / (H / 3))))
        grid[gy][gx] += 1
    hot = [[gy, gx] for gy in range(3) for gx in range(3) if grid[gy][gx] >= HOT_CELL]
    return {"text_total": total, "per_100k": per_100k, "grid": grid,
            "hot_cells": hot,
            "warn": (per_100k > DENSITY_PER_100K) or bool(hot)}

# ----------------------------- 标注截图 -----------------------------
def annotate(shot_path, issues, W, H):
    from PIL import Image, ImageDraw
    im = Image.open(shot_path).convert("RGB")
    d = ImageDraw.Draw(im)
    color = {"overflow": (255, 60, 60), "text_out_of_panel": (255, 140, 0),
             "text_text_overlap": (255, 140, 0), "hit_hit_overlap": (255, 140, 0),
             "low_contrast": (255, 230, 0)}
    for it in issues:
        c = color.get(it["type"], (255, 255, 255))
        for key in ("box", "box_a", "box_b"):
            if key in it:
                x, y, w, h = it[key]
                d.rectangle([x, y, x + w, y + h], outline=c, width=2)
        if it["type"] == "text_out_of_panel":
            x, y, w, h = it["panel"]
            d.rectangle([x, y, x + w, y + h], outline=(0, 200, 255), width=1)
    im.save(shot_path)

# ----------------------------- 相位驱动 -----------------------------
def reach_phase(c, target, max_tries=40):
    for _ in range(max_tries):
        p = ui_probe(c)
        if p and p.get("phase") == target:
            return p
        if not p:
            time.sleep(0.3); continue
        ph = p["phase"]
        if ph in ("wave", "descending"):
            c.ev("__dive.skip()")
        elif ph == "shop":
            c.ev("__dive.leaveShop()")
        elif ph == "decide":
            # 进商店再离开，或直接下潜；这里用 dive 推进到下一层再回到 decide 不现实，
            # 故 decide 相位直接用当前帧审计（已在 decide 时调用方处理）
            pass
        time.sleep(0.25)
    return ui_probe(c)

def collect(c, phase, tries=8):
    """轮询直到 uiProbe 拿到该相位的非空 nodes。"""
    for _ in range(tries):
        p = ui_probe(c)
        if p and p.get("phase") == phase and p.get("nodes"):
            return p
        time.sleep(0.2)
    return ui_probe(c)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=f"http://localhost:4178/?v={int(time.time())}")
    ap.add_argument("--phases", default="wave,shop,decide,result")
    ap.add_argument("--no-shot", action="store_true")
    args = ap.parse_args()
    phases = [x.strip() for x in args.phases.split(",") if x.strip()]
    os.makedirs(OUT, exist_ok=True)

    UD = "/tmp/cdp-audit"
    shutil_rm(UD)
    proc = subprocess.Popen(["chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
        f"--user-data-dir={UD}", f"--remote-debugging-port={CDP_PORT}", "--remote-allow-origins=*",
        "--window-size=1280,720", "--hide-scrollbars", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = C(wait_cdp()); c.call("Page.enable"); c.call("Runtime.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", {"source":
            "window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));"
            "window.addEventListener('unhandledrejection',e=>window.__errs.push('rej:'+e.reason));"})
        c.call("Page.navigate", {"url": args.url})
        for _ in range(60):
            if c.ev("!!window.__sg"): break
            time.sleep(0.5)
        else:
            print("游戏未就绪"); return
        time.sleep(2.0)
        # 进入战斗：在 title 场景按 Enter 启动 dive
        c.key("Enter", "Enter", 13); time.sleep(3.0)

        report = {"generated": datetime.now().isoformat(), "url": args.url, "phases": {}}
        for ph in phases:
            if ph == "wave":
                p = collect(c, "wave")
            elif ph == "shop":
                p = reach_phase(c, "shop"); p = collect(c, "shop") if p else None
            elif ph == "decide":
                # 先到 shop 离开，循环到 decide
                reach_phase(c, "shop"); 
                for _ in range(20):
                    pp = ui_probe(c)
                    if pp and pp.get("phase") == "decide": break
                    if pp and pp.get("phase") == "shop": c.ev("__dive.leaveShop()")
                    else: c.ev("__dive.skip()")
                    time.sleep(0.25)
                p = collect(c, "decide")
            elif ph == "result":
                for _ in range(15):
                    c.ev("__dive.hurtPlayer(200)"); time.sleep(0.03)
                time.sleep(1.0)
                p = collect(c, "result")
            else:
                p = collect(c, ph)

            if not p or not p.get("nodes"):
                report["phases"][ph] = {"error": "no data", "phase": (p or {}).get("phase")}
                print(f"  [{ph}] 无 UI 数据 (phase={(p or {}).get('phase')})")
                continue

            W, H = p["W"], p["H"]; nodes = p["nodes"]; theme = p.get("theme", {})
            issues = (check_overflow(nodes, W, H) + check_overlap(nodes)
                      + check_contrast(nodes, theme))
            density = check_density(nodes, W, H)
            counts = {"text": sum(1 for n in nodes if n["kind"] == "text"),
                      "panel": sum(1 for n in nodes if n["kind"] == "panel"),
                      "hit": sum(1 for n in nodes if n["kind"] == "hit")}
            report["phases"][ph] = {"W": W, "H": H, "counts": counts,
                                    "density": density, "issues": issues,
                                    "issue_count": len(issues)}
            # 标注截图
            if not args.no_shot:
                sp = os.path.join(OUT, f"ui_audit_{ph}.png")
                c.shot(f"ui_audit_{ph}", sp)
                annotate(sp, issues, W, H)
            print(f"  [{ph}] 节点={counts} 问题={len(issues)} 密度/100k={density['per_100k']}")

        # 汇总
        total_issues = sum(v.get("issue_count", 0) for v in report["phases"].values() if isinstance(v, dict))
        report["summary"] = {"total_issues": total_issues,
                             "by_type": _by_type(report)}
        json.dump(report, open(os.path.join(OUT, "ui_audit_report.json"), "w"),
                  ensure_ascii=False, indent=2)
        print("=== 报告已写出:", os.path.join(OUT, "ui_audit_report.json"), "===")
        print("errs", c.ev("window.__errs"))
    finally:
        proc.terminate()

def _by_type(report):
    bt = {}
    for ph, v in report["phases"].items():
        if not isinstance(v, dict): continue
        for it in v.get("issues", []):
            bt[it["type"]] = bt.get(it["type"], 0) + 1
    return bt

def shutil_rm(p):
    import shutil
    shutil.rmtree(p, ignore_errors=True)

if __name__ == "__main__":
    main()
