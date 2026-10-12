#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""抓商店界面的实机截图（默认态 + 悬停态 + 侧栏展开态）。

用法：
  cd web && node ./node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1 &
  python tools/shot_shop.py
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9386
URL = "http://127.0.0.1:4173/"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
PREFIX = sys.argv[1] if len(sys.argv) > 1 else 'shop'


def main():
    ud = os.path.join(tempfile.gettempdir(), "wb_shot_shop")
    shutil.rmtree(ud, ignore_errors=True)
    os.makedirs(ud, exist_ok=True)
    os.makedirs(SHOTS, exist_ok=True)
    p = subprocess.Popen(
        [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
         "--hide-scrollbars", "--mute-audio", "--remote-allow-origins=*",
         f"--user-data-dir={ud}", f"--remote-debugging-port={PORT}",
         "--window-size=1320,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    ws_url = None
    for _ in range(120):
        try:
            with op.open(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page":
                        ws_url = t["webSocketDebuggerUrl"]
            if ws_url:
                break
        except Exception:
            pass
        time.sleep(0.25)

    import websocket
    c = websocket.create_connection(ws_url, timeout=40)
    seq = [0]

    def call(m, par=None):
        seq[0] += 1
        c.send(json.dumps({"id": seq[0], "method": m, "params": par or {}}))
        while True:
            mm = json.loads(c.recv())
            if mm.get("id") == seq[0]:
                return mm

    def ev(expr):
        r = call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("result", {}).get("value")

    def key(k, code, vk):
        for t in ("keyDown", "keyUp"):
            call("Input.dispatchKeyEvent", {"type": t, "key": k, "code": code,
                                            "windowsVirtualKeyCode": vk,
                                            "nativeVirtualKeyCode": vk})

    def shot(name):
        r = call("Page.captureScreenshot", {"format": "png"})
        with open(os.path.join(SHOTS, name), "wb") as f:
            f.write(base64.b64decode(r["result"]["data"]))
        print("   截图", name)

    try:
        call("Page.enable")
        call("Runtime.enable")
        call("Page.navigate", {"url": URL})
        for _ in range(80):
            if ev("!!window.__sg"):
                break
            time.sleep(0.4)
        time.sleep(1.2)
        key("Enter", "Enter", 13)
        # 等 create() 跑完（preload 十几张贴图）
        for _ in range(60):
            if ev("(()=>{const s=__sg.scene.getScene('dive');return s && s.phase})()"):
                break
            time.sleep(0.25)
        time.sleep(0.6)

        # 进商店：把这一波清空
        ev("(()=>{const s=__sg.scene.getScene('dive');s.bank=120;s.spawnLeft=0;"
           "s.enemies.length=0;s.waveTimer=0;return 1})()")
        for _ in range(40):
            if ev("(()=>{const s=__sg.scene.getScene('dive');return s.phase})()") == "shop":
                break
            time.sleep(0.35)
        time.sleep(0.6)
        print("phase =", ev("(()=>{const s=__sg.scene.getScene('dive');return s.phase})()"))
        shot(f"{PREFIX}_default.png")

        ev("(()=>{const s=__sg.scene.getScene('dive');s.hoverCard=1;return 1})()")
        time.sleep(0.35)
        shot(f"{PREFIX}_hover.png")

        ev("(()=>{const s=__sg.scene.getScene('dive');s.hoverCard=-1;"
           "s.shopInfoOpen=true;return 1})()")
        time.sleep(0.35)
        shot(f"{PREFIX}_info.png")
        print("done")
    finally:
        p.terminate()


if __name__ == '__main__':
    main()
