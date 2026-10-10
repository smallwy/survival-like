#!/usr/bin/env python3
"""
按钮点击链路诊断：真正用鼠标点「开始下潜」，分别在 DPR=1 和 DPR=2 下测。

为什么单独写：上一轮验证用的是键盘 Enter，绕过了 hitRouter 的点击链路，
所以"按钮能不能点"其实一次都没被测到。用户机器 DPR 通常不是 1，
而 DPR 适配会改写 gameSize / zoom，很可能把 Phaser 的指针坐标换算搞坏。
"""
import asyncio, base64, json, os, shutil, subprocess, sys, tempfile, time
import urllib.request
import websockets

DPR = float(os.environ.get('DPR', '1'))
CSS_W, CSS_H = 1280, 720
PORT = int(os.environ.get('SHOT_PORT', '9591'))
URL = 'http://localhost:5173/?pid=click'
TAG = os.environ.get('TAG', f'dpr{int(DPR)}')
BEFORE = f'/tmp/click_before_{TAG}.png'
AFTER = f'/tmp/click_after_{TAG}.png'

CHROME = '/usr/bin/google-chrome'


def launch(url):
    ud = os.path.join(tempfile.gettempdir(), f'wb_click_prof_{TAG}')
    shutil.rmtree(ud, ignore_errors=True)
    os.makedirs(ud, exist_ok=True)
    return subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
         '--hide-scrollbars', '--mute-audio', f'--window-size={CSS_W},{CSS_H}',
         f'--force-device-scale-factor={DPR}',
         f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}', url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_ws(timeout=60):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    end = time.time() + timeout
    while time.time() < end:
        try:
            with opener.open(f'http://127.0.0.1:{PORT}/json', timeout=1) as r:
                tg = json.load(r)
            pg = [t for t in tg if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')]
            if pg:
                return pg[0]['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit('CDP 未就绪')


PROBE = """(() => {
  const c = document.querySelector('canvas');
  if (!c) return JSON.stringify({err:'no canvas'});
  const r = c.getBoundingClientRect();
  return JSON.stringify({
    bitmapW: c.width, bitmapH: c.height,
    styleW: c.style.width, styleH: c.style.height,
    rectW: Math.round(r.width), rectH: Math.round(r.height),
    rectL: Math.round(r.left), rectT: Math.round(r.top),
    dpr: window.devicePixelRatio,
    innerW: window.innerWidth, innerH: window.innerHeight
  });
})()"""


async def main():
    ws_url = wait_ws()
    async with websockets.connect(ws_url, max_size=None) as ws:
        n = [0]

        async def call(method, **params):
            n[0] += 1
            i = n[0]
            await ws.send(json.dumps({'id': i, 'method': method, 'params': params}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get('id') == i:
                    if 'error' in msg:
                        raise RuntimeError(f'{method}: {msg["error"]}')
                    return msg.get('result', {})

        await call('Page.enable')
        await call('Runtime.enable')
        await call('Emulation.setDeviceMetricsOverride',
                   width=CSS_W, height=CSS_H, deviceScaleFactor=DPR, mobile=False)
        await asyncio.sleep(4.5)

        m = await call('Runtime.evaluate', expression=PROBE, returnByValue=True)
        info = json.loads(m['result']['value'])
        print(f'[{TAG}] canvas 指标: {info}')

        # 点前截图
        r = await call('Page.captureScreenshot', format='png')
        open(BEFORE, 'wb').write(base64.b64decode(r['data']))

        # 按钮在游戏坐标 (0.5*gameW, 0.70*gameH)。
        # gameW/gameH 取 canvas 位图尺寸（DPR 适配后 = 物理像素）。
        gw, gh = info['bitmapW'], info['bitmapH']
        gx, gy = gw * 0.5, gh * 0.70
        # 换成 CSS 坐标：位图 → CSS 的比例
        sx = info['rectW'] / gw if gw else 1
        sy = info['rectH'] / gh if gh else 1
        cx = info['rectL'] + gx * sx
        cy = info['rectT'] + gy * sy
        print(f'[{TAG}] 游戏坐标({gx:.0f},{gy:.0f}) → CSS 点击({cx:.0f},{cy:.0f})  '
              f'换算比 sx={sx:.3f} sy={sy:.3f}')

        for typ in ('mousePressed', 'mouseReleased'):
            await call('Input.dispatchMouseEvent', type=typ, x=cx, y=cy,
                       button='left', clickCount=1)
        await asyncio.sleep(4.0)

        r = await call('Page.captureScreenshot', format='png')
        open(AFTER, 'wb').write(base64.b64decode(r['data']))
        print(f'[{TAG}] 已保存 {BEFORE} / {AFTER}')


if __name__ == '__main__':
    proc = launch(URL)
    try:
        asyncio.run(main())
    finally:
        proc.terminate()
