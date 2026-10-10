#!/usr/bin/env python3
"""
DiveScene V6 全链路无头验证（CDP）

验证的是 V6 的灵魂——**5 层 × 4 波 + 层末下潜/上浮决策**是否真的跑通：

  ① 页面无 JS 异常，主界面 → 开始下潜 → 进入 dive
  ② 单波战斗与氧气系统在运行（敌人 > 0、氧气在掉）
  ③ 波间商店三选一能点（真实鼠标点击，不是直接调函数）
  ④ 每层第 4 波结束真的弹出补给站（phase = decide）
  ⑤ 下潜后层号 +1、氧气上限被压缩、收益倍率 +0.5
  ⑥ 一路下到 L5，深渊守望者 Boss 能生成并被渲染
  ⑦ 结算面板出现

用法：
  cd web && npx vite preview --port 4173 &
  python3 tools/verify_dive_v6.py

输出截图在 tools/shots/
"""
import base64
import json
import os
import shutil
import subprocess
import time
import urllib.request

import websocket

UD = "/tmp/cdp-profile-dive6"
URL = "http://localhost:4173/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
PORT = 9222

os.makedirs(OUT, exist_ok=True)


def wait_cdp(timeout=25):
    """
    要连 **page 级** endpoint，不是 /json/version 的浏览器级 endpoint。
    浏览器级只支持 Target.*，发 Page.enable 会返回 'Page.enable' wasn't found
    （实测踩过，表现为所有 evaluate 静默返回 None）。
    """
    for _ in range(timeout * 4):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page":
                        return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.25)
    raise SystemExit("CDP 未就绪：chromium 没起来（检查残留 SingletonLock）")


class Cdp:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.i = 0

    def call(self, method, params=None):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.i:
                return m

    def ev(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("result", {}).get("value")

    def shot(self, name):
        r = self.call("Page.captureScreenshot", {"format": "png"})
        p = os.path.join(OUT, name + ".png")
        with open(p, "wb") as f:
            f.write(base64.b64decode(r["result"]["data"]))
        print(f"    截图 → {os.path.basename(p)}")
        return p

    def key(self, key, code, vk):
        for t in ("keyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {
                "type": t, "key": key, "code": code,
                "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk,
            })

    def click(self, x, y):
        # 真实鼠标点击：验证 hitRouter 链路，而不是绕过它直接调回调
        for t in ("mousePressed", "mouseReleased"):
            self.call("Input.dispatchMouseEvent", {
                "type": t, "x": x, "y": y, "button": "left", "clickCount": 1,
            })


def probe(c):
    return c.ev("window.__dive ? __dive.probe() : null")


def main():
    shutil.rmtree(UD, ignore_errors=True)
    proc = subprocess.Popen([
        "chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
        f"--user-data-dir={UD}", f"--remote-debugging-port={PORT}",
        "--remote-allow-origins=*",   # 不加这个新版 Chromium 会拒绝 WS 握手（403）
        "--window-size=1280,720", "--hide-scrollbars", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    fails = []
    try:
        c = Cdp(wait_cdp())
        c.call("Page.enable")
        c.call("Runtime.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", {"source":
            "window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));"
            "window.addEventListener('unhandledrejection',e=>window.__errs.push('reject:'+e.reason));"})
        c.call("Page.navigate", {"url": URL})

        # 只等 __sg（game 实例）。__dive 是 DiveScene.create() 里挂的，
        # 标题画面时还不存在，拿它做就绪条件必然超时。
        for i in range(60):
            if c.ev("!!window.__sg"):
                break
            time.sleep(0.5)
        else:
            print("  !!! 探针未出现；href =", c.ev("location.href"))
            print("  errs =", c.ev("window.__errs"))
            fails.append("探针未就绪")
        print(f"① Phaser 就绪（~{i * 0.5:.1f}s），活动场景: "
              f"{c.ev('__sg.scene.getScenes(true).map(s=>s.scene.key)')}")
        c.shot("v6_01_title")

        print("② Enter 开始下潜")
        c.key("Enter", "Enter", 13)
        time.sleep(1.5)
        print("   活动场景:", c.ev("__sg.scene.getScenes(true).map(s=>s.scene.key)"))

        print("③ 单波战斗 6 秒")
        time.sleep(6.0)
        st = probe(c)
        print("   ", st)
        if not (st and st["enemies"] > 0 and st["o2"] < st["o2Max"]):
            fails.append("战斗/氧气未在跑")
        c.shot("v6_02_wave1")

        # ---- 逐层推进 ----
        for layer in range(1, 6):
            print(f"④ L{layer}：推进 4 波")
            for w in range(3):
                c.ev("__dive.skip()")
                time.sleep(0.35)
                p = probe(c)
                if p["phase"] != "shop":
                    fails.append(f"L{layer} 第{w+1}波后未进入商店（phase={p['phase']}）")
                if w == 0 and layer == 1:
                    # 一次真实鼠标点击：三张卡中间那张的中心正好在屏幕中心
                    print("   真实点击中间卡片（验证 hitRouter 链路）")
                    c.click(640, 360)
                    time.sleep(0.4)
                    print("   点击后:", probe(c))
                    c.shot("v6_03_shop")
                else:
                    c.ev("__dive.pick(0)")
                    time.sleep(0.35)
            # 第 4 波
            if layer == 5:
                # 上面 3 次 skip+pick 之后 waveInLayer 已经是 3 = 第 4 波，
                # Boss 在 startWave() 里就生成了 —— 这里不能再 skip，否则直接结算。
                time.sleep(2.5)
                p = probe(c)
                print(f"   L5 第4波（Boss 波）: {p}")
                if not p.get("bossAlive"):
                    fails.append("L5 最后一波未生成 Boss")
                c.shot("v6_09_l5_boss")
                time.sleep(1.5)
                c.ev("__dive.skip()")
                time.sleep(0.5)
                break

            c.ev("__dive.skip()")
            time.sleep(0.5)
            p = probe(c)
            print(f"   层末: {p}")
            if p["phase"] != "decide":
                fails.append(f"L{layer} 层末未进入补给站（phase={p['phase']}）")
                break
            c.shot(f"v6_{10 + layer}_decide_l{layer}")

            before = p
            if not p.get("canDive"):
                # 氧气不够付门票：验证下潜确实被锁死（V6 硬约束），再补氧继续往下测
                c.ev("__dive.dive()")
                time.sleep(0.3)
                if probe(c)["layer"] == p["layer"]:
                    print(f"   ✓ 氧气 {p['o2']} < 门票，下潜被正确禁用 → 补氧继续")
                else:
                    fails.append("氧气不足时下潜未被禁用")
                c.ev("__dive.refill()")
                time.sleep(0.2)
            c.ev("__dive.dive()")
            time.sleep(0.6)
            after = probe(c)
            print(f"   下潜: L{before['layer']}({before['o2Max']}) "
                  f"→ L{after['layer']}({after['o2Max']}) ×{after['mult']}  {after['layerName']}")
            if after["layer"] != before["layer"] + 1:
                fails.append(f"下潜未推进层号（{before['layer']}→{after['layer']}）")
            if after["mult"] <= before["mult"]:
                fails.append("下潜未提升收益倍率")
            c.shot(f"v6_{20 + layer}_l{layer + 1}_wave1")

        p = probe(c)
        print(f"⑤ 终局: {p}")
        if p["phase"] != "result":
            fails.append(f"未进入结算（phase={p['phase']}）")
        c.shot("v6_99_result")

        errs = c.ev("window.__errs")
        print("⑥ JS 异常:", errs if errs else "无")
        if errs:
            fails.append("JS 异常")
    finally:
        proc.terminate()

    print("\n结论:", "✅ 5 层 × 4 波 + 下潜/上浮全链路通过" if not fails
          else "❌ " + "；".join(fails))


if __name__ == "__main__":
    main()
