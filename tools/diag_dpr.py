#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断「糊」：实测 canvas 位图尺寸 vs CSS 尺寸 vs devicePixelRatio。

糊的假设：scale.mode=RESIZE 让 canvas 位图缓冲区 == CSS 尺寸，
而 Windows DPR 1.25/1.5 下浏览器把位图拉到物理像素 → 非整数倍放大 + pixelArt NEAREST
→ 像素块大小不均 = 糊。
本脚本用 --force-device-scale-factor 模拟 DPR=1.5，读真实数字验证。
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tools'))
import shoot_game as sg  # noqa

PORT = 9355
CHROME = '/usr/bin/chromium'


def launch(dpr):
    ud = os.path.join(tempfile.gettempdir(), 'wb_cdp_diag_%s' % dpr)
    os.makedirs(ud, exist_ok=True)
    return subprocess.Popen([
        CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
        '--hide-scrollbars', '--mute-audio',
        '--window-size=960,800', f'--user-data-dir={ud}',
        f'--force-device-scale-factor={dpr}',
        f'--remote-debugging-port={PORT}', 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_ws():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(60):
        try:
            with opener.open(f'http://127.0.0.1:{PORT}/json', timeout=1) as r:
                targets = json.load(r)
            pages = [t for t in targets if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')]
            if pages:
                return pages[0]['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit('CDP 未就绪')


async def probe(dpr):
    import websockets
    proc = launch(dpr)
    try:
        ws_url = wait_ws()
        async with websockets.connect(ws_url, max_size=32 * 1024 * 1024) as ws:
            c = sg.CDP(ws)
            await c.call('Page.enable')
            await c.call('Runtime.enable')
            await c.call('Page.navigate', url='http://localhost:5173/?pid=diag_%s' % dpr)
            await asyncio.sleep(4.5)
            js = (
                "(()=>{const g=window.__sg;const cv=document.querySelector('#app canvas');"
                "if(!cv||!g)return JSON.stringify({err:'no canvas'});"
                "const r=cv.getBoundingClientRect();"
                "return JSON.stringify({"
                "dpr:devicePixelRatio,"
                "cssW:Math.round(r.width*100)/100,cssH:Math.round(r.height*100)/100,"
                "bufW:cv.width,bufH:cv.height,"
                "scaleW:g.scale.width,scaleH:g.scale.height,"
                "zoom:g.scale.zoom,"
                "cssToBufX:Math.round((cv.width/r.width)*1000)/1000,"
                "cssToBufY:Math.round((cv.height/r.height)*1000)/1000,"
                "bufToCssX:Math.round((r.width/cv.width)*1000)/1000"
                "});})()")
            r = await c.call('Runtime.evaluate', expression=js, returnByValue=True)
            v = json.loads(r['result']['value'])
            print('DPR=%s ->' % dpr, json.dumps(v, ensure_ascii=False))
            return v
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=6)
        except Exception:
            proc.kill()


async def main():
    for dpr in ('1', '1.25', '1.5', '2'):
        try:
            await probe(dpr)
        except Exception as e:
            print('DPR=%s 失败: %s' % (dpr, e))
        time.sleep(0.5)


if __name__ == '__main__':
    asyncio.run(main())
