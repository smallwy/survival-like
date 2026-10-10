#!/usr/bin/env python3
"""
探索器实机验证：进主界面 → 按 Enter 下潜 → 截图 + 抓运行时报错。

为什么要单独写：tsc 只能查类型，抓不到运行时崩溃。
之前「点了没反应」就是运行时链路问题，类型检查全绿也一样坏。
"""
import asyncio, base64, json, os, shutil, subprocess, sys, tempfile, time
import urllib.request
import websockets

W, H = 1280, 720
PORT = int(os.environ.get('SHOT_PORT', '9581'))
URL = 'http://localhost:5173/?pid=explore'
OUT = '/workspace/spec/shots/explore_neon.png'


def launch(url):
    ud = os.path.join(tempfile.gettempdir(), 'wb_explore_prof')
    shutil.rmtree(ud, ignore_errors=True)      # 清 SingletonLock，否则 chrome exit 21
    os.makedirs(ud, exist_ok=True)
    return subprocess.Popen(
        ['/usr/bin/google-chrome', '--headless=new', '--disable-gpu', '--no-sandbox',
         '--hide-scrollbars', '--mute-audio', f'--window-size={W},{H}',
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
                    errors.append('EXCEPTION: ' + str(d.get('exception', {}).get('description', d))[:400])
                if msg.get('method') == 'Runtime.consoleAPICalled':
                    if msg['params'].get('type') in ('error', 'warning'):
                        errors.append('CONSOLE: ' + str(msg['params'].get('args', []))[:300])
                if msg.get('method') == 'Log.entryAdded':
                    e = msg['params'].get('entry', {})
                    if e.get('level') == 'error':
                        errors.append('LOG: ' + str(e.get('text', ''))[:300])

        await call('Page.enable')
        await call('Runtime.enable')
        await call('Log.enable')
        await call('Emulation.setDeviceMetricsOverride',
                   width=W, height=H, deviceScaleFactor=1, mobile=False)
        await asyncio.sleep(4.0)   # 等主界面

        # 按 Enter 进入探索器
        for typ in ('keyDown', 'keyUp'):
            await call('Input.dispatchKeyEvent', type=typ, key='Enter', code='Enter',
                       windowsVirtualKeyCode=13, nativeVirtualKeyCode=13)
        await asyncio.sleep(4.0)   # 等探索器跑起来

        # 模拟操作：向下移动一段 + 采集 + 看 HUD
        for code, vk in (('KeyS', 83), ('KeyD', 68)):
            await call('Input.dispatchKeyEvent', type='keyDown', key=code, code=code,
                       windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)
        await asyncio.sleep(2.5)
        for code, vk in (('KeyS', 83), ('KeyD', 68)):
            await call('Input.dispatchKeyEvent', type='keyUp', key=code, code=code,
                       windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)
        await asyncio.sleep(0.6)

        r = await call('Page.captureScreenshot', format='png')
        open(OUT, 'wb').write(base64.b64decode(r['data']))
        print('saved', OUT, os.path.getsize(OUT))

    print(f'--- 运行时报错 {len(errors)} 条 ---')
    for e in errors[:12]:
        print(' ', e)


if __name__ == '__main__':
    proc = launch(URL)
    try:
        asyncio.run(main())
    finally:
        proc.terminate()
