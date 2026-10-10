#!/usr/bin/env python3
"""
指针坐标探针：读出 Phaser 在 DPR 适配后的真实换算链路，定位"点不动"的精确原因。

读的是 window.__sg（main.ts 已暴露的调试句柄），不猜。
"""
import asyncio, json, os, shutil, subprocess, tempfile, time
import urllib.request
import websockets

DPR = float(os.environ.get('DPR', '2'))
CSS_W, CSS_H = 1280, 720
PORT = int(os.environ.get('SHOT_PORT', '9601'))
URL = 'http://localhost:5173/?pid=ptr'
TAG = os.environ.get('TAG', f'ptr{int(DPR)}')

PROBE = """(() => {
  const g = window.__sg;
  if (!g) return JSON.stringify({err:'no __sg'});
  const sm = g.scale;
  const sc = g.scene.getScene('title');
  const routes = (sc && sc.__uiHitRoutes) || [];
  const hits = routes.map(h => {
    let x = h.obj.x, y = h.obj.y, sx = 1, sy = 1, p = h.obj.parentContainer;
    while (p) { x = p.x + x*p.scaleX; y = p.y + y*p.scaleY; sx*=p.scaleX; sy*=p.scaleY; p = p.parentContainer; }
    return {x: Math.round(x), y: Math.round(y), w: h.w, h: h.h, alive: !!h.alive()};
  });
  // 模拟：CSS 坐标 (640, 573) 会被 Phaser 换算成什么游戏坐标
  const gx = (640 - sm.canvasBounds.left) * sm.displayScale.x;
  const gy = (573 - sm.canvasBounds.top) * sm.displayScale.y;
  return JSON.stringify({
    scaleW: sm.width, scaleH: sm.height,
    gameW: sm.gameSize.width, gameH: sm.gameSize.height,
    baseW: sm.baseSize.width, baseH: sm.baseSize.height,
    dispW: sm.displaySize.width, dispH: sm.displaySize.height,
    zoom: sm.zoom,
    displayScaleX: sm.displayScale.x, displayScaleY: sm.displayScale.y,
    bounds: {l: Math.round(sm.canvasBounds.left), t: Math.round(sm.canvasBounds.top),
             w: Math.round(sm.canvasBounds.width), h: Math.round(sm.canvasBounds.height)},
    active: g.scene.scenes.filter(s => s.scene.isActive()).map(s => s.scene.key),
    hitCount: routes.length,
    hits,
    clickMapsTo: {x: Math.round(gx), y: Math.round(gy)},
    wouldHit: hits.filter(h => Math.abs(gx-h.x) <= h.w/2 && Math.abs(gy-h.y) <= h.h/2).length
  });
})()"""


def launch(url):
    ud = os.path.join(tempfile.gettempdir(), f'wb_ptr_prof_{TAG}')
    shutil.rmtree(ud, ignore_errors=True)
    os.makedirs(ud, exist_ok=True)
    return subprocess.Popen(
        ['/usr/bin/google-chrome', '--headless=new', '--disable-gpu', '--no-sandbox',
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


async def main():
    ws_url = wait_ws()
    errors = []
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
                if msg.get('method') == 'Runtime.exceptionThrown':
                    d = msg['params'].get('exceptionDetails', {})
                    errors.append('EXC: ' + str(d.get('exception', {}).get('description', d))[:300])

        await call('Page.enable')
        await call('Runtime.enable')
        await call('Emulation.setDeviceMetricsOverride',
                   width=CSS_W, height=CSS_H, deviceScaleFactor=DPR, mobile=False)
        await asyncio.sleep(5.0)

        m = await call('Runtime.evaluate', expression=PROBE, returnByValue=True)
        print(f'=== DPR={DPR} ===')
        print(json.dumps(json.loads(m['result']['value']), indent=2, ensure_ascii=False))
        if errors:
            print('--- 运行时异常 ---')
            for e in errors[:6]:
                print(' ', e)


if __name__ == '__main__':
    proc = launch(URL)
    try:
        asyncio.run(main())
    finally:
        proc.terminate()
