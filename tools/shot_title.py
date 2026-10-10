#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
标题界面截图工具（CDP 方案，无第三方浏览器驱动）

只做一件事：打开页面 → 等动画稳定 → 截主界面。
用于验证 TitleScene 的视觉，**尤其是 Canvas 渲染器下是否出现实心色块**。

用法：
    python tools/shot_title.py [输出路径]
默认输出到 spec/shots/title_neon.png
"""
import asyncio
import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

try:
    import websockets
except ImportError:
    print('需要 websockets：pip install websockets', file=sys.stderr)
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'spec', 'shots', 'title_neon.png')
OUT = os.path.abspath(OUT)
W = int(os.environ.get('SHOT_W', 1280))
H = int(os.environ.get('SHOT_H', 720))
PORT = int(os.environ.get('SHOT_PORT', 9571))
URL = os.environ.get('GAME_URL', 'http://localhost:5173/?pid=shottitle')

CHROME = '/usr/bin/google-chrome'
if not os.path.exists(CHROME):
    CHROME = '/usr/bin/chromium'


def launch(url):
    # 必须清 profile：上次 Chrome 若被强杀会残留 SingletonLock，
    # 新实例会因 "profile appears to be in use" 直接退出（exit 21）。
    ud = os.path.join(tempfile.gettempdir(), 'wb_title_prof')
    shutil.rmtree(ud, ignore_errors=True)
    os.makedirs(ud, exist_ok=True)
    return subprocess.Popen([
        CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
        '--hide-scrollbars', '--mute-audio',
        f'--window-size={W},{H}', f'--user-data-dir={ud}',
        f'--remote-debugging-port={PORT}', url,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_ws():
    # 本机有 http_proxy 环境变量，代理会让 localhost 回 502 —— 必须显式清空。
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(80):
        try:
            with opener.open(f'http://127.0.0.1:{PORT}/json', timeout=1) as r:
                targets = json.load(r)
            pages = [t for t in targets if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')]
            if pages:
                return pages[0]['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit('CDP 未就绪（端口 %d）' % PORT)


async def main(ws_url):
    async with websockets.connect(ws_url, max_size=None) as ws:
        n = [0]

        async def call(method, **params):
            n[0] += 1
            mid = n[0]
            await ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get('id') == mid:
                    if 'error' in msg:
                        raise RuntimeError(f'{method}: {msg["error"]}')
                    return msg.get('result', {})

        await call('Page.enable')
        # 对齐窗口与视口，避免"无头窗口 vs 视口不一致"的截图假象（黑边）
        await call('Emulation.setDeviceMetricsOverride',
                   width=W, height=H, deviceScaleFactor=1, mobile=False)
        # 等 Phaser 起来 + 背景动画跑几帧
        await asyncio.sleep(4.0)

        # 顺便确认当前渲染器，方便判断"是否验证了 Canvas 降级路径"
        res = await call('Runtime.evaluate', expression=
                         'JSON.stringify({r: (window.game&&window.game.renderer)?window.game.renderer.type:"?", '
                         'scene: (window.game&&window.game.scene)?window.game.scene.scenes.map(s=>s.scene.key):[]})',
                         returnByValue=True)
        info = json.loads(res.get('result', {}).get('value', '{}'))
        print('renderer.type =', info.get('r'), '(1=Canvas, 2=WebGL)')
        print('active scenes =', info.get('scene'))

        shot = await call('Page.captureScreenshot', format='png')
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'wb') as f:
            f.write(base64.b64decode(shot['data']))
        print('saved:', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    proc = launch(URL)
    try:
        asyncio.run(main(wait_ws()))
    finally:
        try:
            os.kill(proc.pid, signal.SIGTERM)
        except Exception:
            pass
