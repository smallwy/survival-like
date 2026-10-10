#!/usr/bin/env python3
"""
DiveScene 无头验证（CDP）

验证三件事，都是上次"点了没反应"这类问题的直接防线：
  ① 页面能起来、无 JS 异常
  ② 主界面 → 开始下潜 → 真的进入 dive 场景（不是停在标题）
  ③ 进入后战斗与氧气系统真的在跑（敌人数 > 0、氧气在下降）

用法：
  cd web && npx vite preview --port 4173 &
  python3 tools/verify_dive.py

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

UD = "/tmp/cdp-profile-dive"
URL = "http://127.0.0.1:4173/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
PORT = 9222

os.makedirs(OUT, exist_ok=True)


def wait_cdp(timeout=25):
    """
    注意要连 **page 级** endpoint，不是 /json/version 那个浏览器级 endpoint。
    浏览器级只支持 Target.*，发 Page.enable 会返回 'Page.enable' wasn't found
    （实测踩过，表现为所有 evaluate 都拿不到值）。
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
    raise SystemExit("CDP 未就绪：chromium 没起来（检查 /tmp/cdp-profile-dive 残留锁）")


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
        print(f"  截图 → {p}")
        return p

    def key(self, key, code, vk):
        for t in ("keyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {
                "type": t, "key": key, "code": code,
                "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk,
            })


def main():
    # 残留 SingletonLock 会让新实例 exit 21（实测踩过）
    shutil.rmtree(UD, ignore_errors=True)
    proc = subprocess.Popen([
        "chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
        f"--user-data-dir={UD}", f"--remote-debugging-port={PORT}",
        # 新版 Chromium 默认拒绝非同源 WS 连接，不加这个会 403
        "--remote-allow-origins=*",
        "--window-size=1280,720", "--hide-scrollbars", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        ws_url = wait_cdp()
        c = Cdp(ws_url)
        c.call("Page.enable")
        c.call("Runtime.enable")
        # 注入错误收集器，避免异常被静默吞掉
        c.call("Page.addScriptToEvaluateOnNewDocument", {"source":
            "window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));"
            "window.addEventListener('unhandledrejection',e=>window.__errs.push('reject:'+e.reason));"})
        c.call("Page.navigate", {"url": URL})
        # 轮询等 Phaser 起来：固定 sleep 在慢机器上会拿到 null（1.7MB bundle）
        for i in range(60):
            if c.ev("!!window.__sg"):
                break
            time.sleep(0.5)
        else:
            print("  !!! __sg 未出现；href =", c.ev("location.href"))
            print("  errs =", c.ev("window.__errs"))
        print("  Phaser 就绪耗时 ~%.1fs" % (i * 0.5))

        print("① 主界面")
        print("  活动场景:", c.ev("__sg ? __sg.scene.getScenes(true).map(s=>s.scene.key) : 'no game'"))
        print("  BUILD_TAG:", c.ev("__BUILD__ || 'n/a'"))
        c.shot("01_title")

        print("② 按 Enter 开始下潜")
        c.key("Enter", "Enter", 13)
        time.sleep(1.2)
        print("  活动场景:", c.ev("__sg.scene.getScenes(true).map(s=>s.scene.key)"))
        c.shot("02_dive_early")

        print("③ 战斗运行中（等 6 秒）")
        time.sleep(6.0)
        st = c.ev(
            "(()=>{const s=__sg.scene.getScene('dive');"
            "if(!s) return null;"
            "return {phase:s.phase, wave:s.waveIdx, o2:Math.round(s.o2),"
            "enemies:s.enemies.length, bubbles:s.bubbles.length, biomass:s.biomass}})()"
        )
        print("  状态:", st)
        c.shot("03_dive_running")

        errs = c.ev("window.__errs")
        print("④ JS 异常:", errs if errs else "无")

        ok = (
            isinstance(st, dict)
            and st.get("enemies", 0) > 0
            and st.get("o2", 999) < 100
        )
        print("\n结论:", "✅ 波次与氧气系统在运行" if ok else "❌ 未通过，见上方状态")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
