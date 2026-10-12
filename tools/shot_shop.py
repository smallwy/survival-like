#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""截取「商店」界面在指定 DPR 下的样子，用来判断 UI 是否随 DPR 缩水。

用法（需先外部起 Chrome，见 README 或 diag_resize.py）：
  CHROME_EXTERNAL=1 CHROME_PORT=9393 python tools/shot_shop.py 2 [w] [h]
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
PORT = int(os.environ.get('CHROME_PORT', '9393'))
MODE = os.environ.get('DPRMODE', '')
URL = "http://127.0.0.1:4173/" + (f"?dprmode={MODE}" if MODE else "")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tools', 'shots')
# 若设了 CHROME_EXTERNAL=1，则假定 Chrome 已由外部启动（带 --remote-debugging-port=PORT），
# 脚本只负责连接。否则自己拉起一个带调试端口的无头 Chrome。
EXT = os.environ.get('CHROME_EXTERNAL') == '1'


def main():
    dpr = sys.argv[1] if len(sys.argv) > 1 else '1'
    vw = int(sys.argv[2]) if len(sys.argv) > 2 else 1304
    vh = int(sys.argv[3]) if len(sys.argv) > 3 else 749
    os.makedirs(SHOTS, exist_ok=True)

    p = None
    if not EXT:
        ud = os.path.join(tempfile.gettempdir(), "wb_shot_shop")
        shutil.rmtree(ud, ignore_errors=True)
        os.makedirs(ud, exist_ok=True)
        p = subprocess.Popen(
            [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
             "--hide-scrollbars", "--mute-audio", "--remote-allow-origins=*",
             f"--user-data-dir={ud}", f"--remote-debugging-port={PORT}",
             f"--window-size={vw},{vh}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    import websocket
    from PIL import Image
    import io as _io

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
    if not ws_url:
        print("连不上 Chrome")
        if p is not None: p.terminate()
        return 1

    c = websocket.create_connection(ws_url, timeout=120)
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
                                            "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})

    call("Page.enable"); call("Runtime.enable")
    call("Page.navigate", {"url": URL})
    for _ in range(80):
        if ev("!!window.__sg"):
            break
        time.sleep(0.4)
    time.sleep(1.2)
    key("Enter", "Enter", 13)
    for _ in range(60):
        if ev("(()=>{const s=__sg.scene.getScene('dive');return s && s.phase})()"):
            break
        time.sleep(0.25)
    time.sleep(0.8)

    call("Emulation.setDeviceMetricsOverride",
         {"width": vw, "height": vh, "deviceScaleFactor": float(dpr), "mobile": False})
    for _ in range(40):
        if ev("window.innerWidth") == vw:
            break
        time.sleep(0.05)
    # 强制进入商店相位（并给几张卡一个稳定的内容）
    # SHOP_BANK 可选：设了就先把鱼骨币拉高，用来截「买得起」态（亮键帽 + 按 N 购买）
    # SHOP_SOLD 可选：设了就把第 1 张卡标为已购入，用来截「已购入」态（键帽打勾）
    bank = os.environ.get('SHOP_BANK', '')
    setbank = f"s.bank={int(bank)};" if bank else ""
    setsold = "s.sold[0]=true;" if os.environ.get('SHOP_SOLD') else ""
    ev("(()=>{const s=__sg.scene.getScene('dive');" + setbank + "s.openShop();"
       + setsold + "if(__sg)__sg.scale.refresh();return 1})()")
    time.sleep(0.5)
    ev("(()=>{const s=__sg.scene.getScene('dive');if(__sg)__sg.scale.refresh();return 1})()")
    time.sleep(0.4)

    r = call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    raw = base64.b64decode(r["result"]["data"])
    im = Image.open(_io.BytesIO(raw)).convert('RGB')
    out = os.path.join(SHOTS, f'shop_dpr{dpr}_{vw}x{vh}.png')
    im.save(out)
    print("saved", out, im.size)
    if p is not None: p.terminate()
    return 0


if __name__ == '__main__':
    sys.exit(main())
