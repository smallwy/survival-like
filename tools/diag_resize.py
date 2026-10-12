#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""分辨率自适应的实机诊断（无头 Chrome + CDP）。

用户反馈：「我改变分辨率不能自适应吗 会出现黑色边界 视野遮挡」

这个脚本做的不是"看一眼截图"，是把边界**量出来**：
  1. 用 Emulation.setDeviceMetricsOverride 在**运行时**改视口（模拟用户改分辨率/拉窗口）
  2. 每次改完读 canvas 的 CSS 尺寸 / 位图尺寸 / gameSize / uiCam viewport
  3. 截图，扫四条边上的"近黑像素带"厚度（战斗海面是亮青色，黑 = 真的没人画）

用法：
  cd web && node ./node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1 &
  python tools/diag_resize.py [dpr]     # dpr 默认 1
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
# 若设了 CHROME_EXTERNAL=1，则假定 Chrome 已由外部（带 --remote-debugging-port=PORT）
# 启动，脚本只负责连接，不再自己 Popen（沙箱里自己拉起的 Chrome 会被杀）。
EXT = os.environ.get('CHROME_EXTERNAL') == '1'
MODE = os.environ.get('DPRMODE', '')
URL = "http://127.0.0.1:4173/" + (f"?dprmode={MODE}" if MODE else "")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tools', 'shots')

SIZES = [(1304, 749), (1600, 900), (1000, 640), (1920, 1080), (1304, 749)]
BLACK = 26          # max(r,g,b) <= 26 判为"近黑"（画布底色是 #04070d）


def band_len(pix, w, h, side):
    """返回某条边上从外缘到第一个非近黑像素的**真实**距离（不截断）。"""
    def row_black(y):
        for x in range(0, w, max(1, w // 200)):
            r, g, b = pix[x, y][:3]
            if max(r, g, b) > BLACK:
                return False
        return True

    def col_black(x):
        for y in range(0, h, max(1, h // 200)):
            r, g, b = pix[x, y][:3]
            if max(r, g, b) > BLACK:
                return False
        return True

    n = 0
    if side == 'top':
        for y in range(0, h):
            if row_black(y):
                n += 1
            else:
                break
    elif side == 'bottom':
        for y in range(h - 1, -1, -1):
            if row_black(y):
                n += 1
            else:
                break
    elif side == 'left':
        for x in range(0, w):
            if col_black(x):
                n += 1
            else:
                break
    else:
        for x in range(w - 1, -1, -1):
            if col_black(x):
                n += 1
            else:
                break
    return n


def main():
    dpr = sys.argv[1] if len(sys.argv) > 1 else '1'
    os.makedirs(SHOTS, exist_ok=True)
    p = None
    if not EXT:
        ud = os.path.join(tempfile.gettempdir(), "wb_diag_resize")
        shutil.rmtree(ud, ignore_errors=True)
        os.makedirs(ud, exist_ok=True)
        p = subprocess.Popen(
            [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
             "--hide-scrollbars", "--mute-audio", "--remote-allow-origins=*",
             f"--force-device-scale-factor={dpr}",
             f"--user-data-dir={ud}", f"--remote-debugging-port={PORT}",
             "--window-size=1304,749", "about:blank"],
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
    if not ws_url:
        print("连不上无头 Chrome"); return 1

    import websocket
    from PIL import Image
    import io as _io

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

    probe = """
    (() => {
      const s = __sg.scene.getScene('dive');
      const cv = __sg.canvas;
      const r = cv.getBoundingClientRect();
      const app = document.getElementById('app');
      return {
        inner: [window.innerWidth, window.innerHeight],
        app:   [app.clientWidth, app.clientHeight],
        css:   [Math.round(r.width), Math.round(r.height)],
        bmp:   [cv.width, cv.height],
        game:  [__sg.scale.width, __sg.scale.height],
        uiCam: s.uiCam ? [s.uiCam.width, s.uiCam.height] : null,
        dpr:   window.devicePixelRatio
      };
    })()
    """

    try:
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
        # 钉在战斗相位：海面是亮青色，黑边才判得出来（商店本来就是近黑底，会误报）
        ev("(()=>{const s=__sg.scene.getScene('dive');s.phase='wave';s.spawnLeft=6;"
           "s.enemies.length=0;s.waveTimer=999;s.bullets.length=0;return 1})()")

        print(f"\nDPR 目标 = {dpr}")
        # 装一个 resize 事件计数器，判断"事件到底有没有到达页面"
        ev("(()=>{window.__resizeN=0;window.addEventListener('resize',()=>{window.__resizeN++});return 1})()")
        print(f"{'视口':<11}{'inner':<13}{'#app':<13}{'canvas css':<13}{'位图':<13}"
              f"{'gameSize':<13}{'uiCam':<13}{'dpr':<5}{'黑边 上/下/左/右'}")
        worst = 0
        for i, (w, h) in enumerate(SIZES):
            ev("window.__resizeN=0")
            call("Emulation.setDeviceMetricsOverride",
                 {"width": w, "height": h, "deviceScaleFactor": float(dpr), "mobile": False})
            # 等 innerWidth 落到目标（布局生效），再手动触发一次 refresh 抵消无头环境
            # 的 rAF 节流（否则 step() 不跑，画布会"慢一拍"，那是 CDP 假象不是真 bug）。
            for _ in range(40):
                iw = ev("window.innerWidth")
                if iw == w:
                    break
                time.sleep(0.05)
            ev("(()=>{const s=__sg.scene.getScene('dive');s.phase='wave';s.spawnLeft=6;"
               "s.enemies.length=0;s.waveTimer=999;s.bullets.length=0;"
               "if(window.__sg)window.__sg.scale.refresh();return 1})()")
            time.sleep(0.3)
            st = ev(probe) or {}
            r = call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
            raw = base64.b64decode(r["result"]["data"])
            im = Image.open(_io.BytesIO(raw)).convert('RGB')
            px = im.load()
            iw, ih = im.size
            b = [band_len(px, iw, ih, s) for s in ('top', 'bottom', 'left', 'right')]
            worst = max(worst, max(b))
            f = f"{w}x{h}"
            print(f"{f:<11}{str(st.get('inner')):<13}{str(st.get('app')):<13}"
                  f"{str(st.get('css')):<13}{str(st.get('bmp')):<13}{str(st.get('game')):<13}"
                  f"{str(st.get('uiCam')):<13}{str(st.get('dpr')):<5}"
                  f"{b}  {'<-- 黑边!' if max(b) >= 4 else ''}")
            im.save(os.path.join(SHOTS, f'resize_dpr{dpr}_{w}x{h}.png'))

        print(f"\n最大黑边厚度 = {worst}px  " + ("=> 确认存在黑边" if worst >= 4 else "=> 未检出黑边"))
        return 0
    finally:
        if p is not None:
            p.terminate()


if __name__ == '__main__':
    sys.exit(main())
