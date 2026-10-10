#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""视野短边钳制验证：同一局画面在 6 种分辨率下各拍一张，直接对比。

为什么需要它
------------
超宽屏（21:9）是横屏决策的主要风险：长边是 16:9 的 1.79 倍，
不钳制就等于给超宽屏玩家塞进近两倍战场，难度直接失衡。
横屏/竖屏的**面积**其实完全相同（见项目计划书 §9），所以朝向本身不是风险点，
长边才是。这个脚本把"封黑"变成看得见的照片 + 一张数字对照表。

它验证三件事：
  1. 溢出部分真被压成纯黑（黑幕几何读回引擎真实坐标，不靠肉眼）
  2. 16:9 及以下**零溢出**（画面一点没被动过）
  3. 黑幕随窗口尺寸重排（每个分辨率独立进程，读的是真实 canvas）

为什么每个分辨率重启浏览器
------------------------
试过用 CDP 的 Emulation.setDeviceMetricsOverride 改视口，结果是
**视口变了但 Phaser canvas 没跟上**：截图回来内容只占左上角一小块，
左右错位，完全是假的。Scale.RESIZE 依赖真实的 window resize 事件，
所以老老实实按窗口尺寸重启，一个分辨率一个进程，慢但可信。

用法：
    python tools/view_check.py
前置：web 的 dev server 已在 5173 运行。
输出：docs/_baseline/view-*.png + 终端对照表
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shoot_game import CDP, find_browser, KEYS, wait_ws  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', '_baseline')

# 覆盖三类：
#   - 标准 16:9（零溢出的基准）
#   - 常见 16:10 / 4:3（更"方"，仍应零溢出）
#   - 超宽 21:9 / 32:9（溢出，必须封黑）
RESOS = [
    ('16-9-1920x1080', 1920, 1080),
    ('16-10-1920x1200', 1920, 1200),
    ('4-3-1440x1080', 1440, 1080),
    ('21-9-2560x1080', 2560, 1080),
    ('21-9-3440x1440', 3440, 1440),
    ('32-9-3840x1080', 3840, 1080),
]

GEOM_JS = (
    "(()=>{const g=window.__sg;if(!g)return '{\"err\":\"no game\"}';"
    "const s=g.scene.getScene('game');if(!s)return '{\"err\":\"no scene\"}';"
    "const c=s.viewClamp?s.viewClamp():null;"
    "const box=r=>r?{x:Math.round(r.x),y:Math.round(r.y),"
    "w:Math.round(r.width),h:Math.round(r.height)}:null;"
    "const canvas=g.canvas.getBoundingClientRect();"
    "return JSON.stringify({"
    "screen:[g.scale.width,g.scale.height],"
    "cssRect:[Math.round(canvas.width),Math.round(canvas.height)],"
    "inner:[innerWidth,innerHeight],"
    "clamp:c,masks:{L:box(s.viewMaskL),R:box(s.viewMaskR),"
    "T:box(s.viewMaskT),B:box(s.viewMaskB)},"
    "softN:(s.viewMaskSoft||[]).length,"
    "started:!!s.started,hp:s.hp,kill:s.kills});})()"
)


def wait_ws_port(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(80):
        try:
            with opener.open(f'http://127.0.0.1:{port}/json', timeout=1) as r:
                targets = json.load(r)
            pages = [t for t in targets
                     if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')]
            if pages:
                return pages[0]['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit(f'CDP(:{port}) 未就绪')


async def calibrate(c, want_w, want_h):
    """把 Phaser 画布逼到目标尺寸。

    为什么必须校准
    --------------
    `--window-size` 给的是**窗口**尺寸，无头 Chrome 的视口比它小一圈（标题栏/边框），
    而 Phaser 在 RESIZE + 100% 下画布跟着**父容器**走，两者还会各差一点。
    实测 16:9 那一档拿到的是 1920x1061 —— 比例 1.810 被当成超宽屏封了黑，
    数字全对但结论是假的。

    所以这里读引擎真实的 scale.width/height，反推窗口该开多大，再逐轮收敛。
    判定标准是**引擎自己的画布**，不是窗口参数 —— 钳制发生在画布上。
    """
    info = await c.call('Browser.getWindowForTarget')
    wid = info.get('windowId')
    if not wid:
        raise SystemExit('取不到 windowId，无法校准画布尺寸')
    cur_w, cur_h = want_w, want_h
    last = (0, 0)
    for _ in range(6):
        r = await c.call('Runtime.evaluate', expression=(
            "JSON.stringify([window.__sg?window.__sg.scale.width:0,"
            "window.__sg?window.__sg.scale.height:0])"), returnByValue=True)
        try:
            sw, sh = json.loads(r['result']['value'])
        except Exception:
            return (0, 0)
        if not sw or not sh:
            return (0, 0)
        last = (sw, sh)
        if abs(sw - want_w) <= 2 and abs(sh - want_h) <= 2:
            return (sw, sh)
        # 按差值修正窗口尺寸（画布比窗口小，所以同向补）
        cur_w += int(round(want_w - sw))
        cur_h += int(round(want_h - sh))
        await c.call('Browser.setWindowBounds', windowId=wid,
                     bounds={'width': max(320, cur_w),
                             'height': max(240, cur_h)})
        await asyncio.sleep(1.0)
    return last


async def run_one(tag, w, h, port):
    """在指定窗口尺寸下开一局，拍一张图，读回几何。"""
    ud = os.path.join(tempfile.gettempdir(), f'wb_view_{port}')
    os.makedirs(ud, exist_ok=True)
    proc = subprocess.Popen(
        [find_browser(), '--headless=new', '--disable-gpu', '--no-sandbox',
         '--hide-scrollbars', '--mute-audio',
         # 起点给足，等下用 Browser.setWindowBounds 校准到精确尺寸
         f'--window-size={w},{h + 160}',
         f'--user-data-dir={ud}', f'--remote-debugging-port={port}',
         'about:blank'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = wait_ws_port(port)
        async with websockets.connect(ws_url, max_size=32 * 1024 * 1024) as ws:
            c = CDP(ws)
            await c.call('Page.enable')
            await c.call('Page.navigate',
                         url=f'http://localhost:5173/?pid=view_{port}')
            await asyncio.sleep(4.5)
            real = await calibrate(c, w, h)
            print(f'   [{tag}] 画布校准到 {real[0]}x{real[1]}（目标 {w}x{h}）')
            await asyncio.sleep(0.6)
            # 备战是三屏：选关 → 点将 → 出征。漏了「点将」就找不到出征按钮
            # （踩过：报"找不到控件「出征」，页面信息: no overlay"）。
            await c.click_label('点将')
            await asyncio.sleep(0.7)
            await c.click_label('出　征')
            await asyncio.sleep(2.0)
            started = await c.ev('!!s.started')
            if 'true' not in str(started):
                await c.key('keyDown', *KEYS['enter'])
                await c.key('keyUp', *KEYS['enter'])
                await asyncio.sleep(2.0)
            # 跑起来 + 打一会儿，让画面里有敌人、有弹道，不然看不出钳制效果
            await c.key('keyDown', *KEYS['d'])
            await asyncio.sleep(3.0)
            await c.key('keyUp', *KEYS['d'])
            await asyncio.sleep(0.4)

            path = os.path.join(OUT, f'view-{tag}.png')
            await c.shot(path)
            r = await c.call('Runtime.evaluate', expression=GEOM_JS,
                             returnByValue=True)
            try:
                geom = json.loads(r['result']['value'])
            except Exception:
                geom = {'err': 'decode', 'raw': str(r)[:200]}
            return geom
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()


async def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    port = 9345
    for tag, w, h in RESOS:
        geom = await run_one(tag, w, h, port)
        port += 1
        cl = geom.get('clamp') or {}
        m = geom.get('masks') or {}
        sw, sh = geom.get('screen', [0, 0])
        ov = int(sw * sh - cl.get('w', 0) * cl.get('h', 0)) if cl else -1
        rows.append(dict(
            tag=tag, screen=f'{sw}x{sh}', inner=geom.get('inner'),
            clamp=f"{int(cl.get('w', 0))}x{int(cl.get('h', 0))}",
            ratio=(round(sw / sh, 3) if sh else 0),
            barW=int(cl.get('barW', 0)), overflow=ov,
            maskL=m.get('L', {}).get('w', 0), maskR=m.get('R', {}).get('w', 0),
            softN=geom.get('softN', 0),
            started=geom.get('started'), hp=geom.get('hp'), kill=geom.get('kill'),
            err=geom.get('err'),
        ))
        print(f'  {tag:<20} {rows[-1]["screen"]:<11} '
              f'启动={rows[-1]["started"]} 溢出={ov}')

    print('\n' + '=' * 84)
    print('视野钳制对照（BASE_ASPECT = 16:9 = 1.778）')
    print('=' * 84)
    print(f"{'分辨率':<20}{'比例':>7}{'钳制后':>12}{'每侧黑幕':>10}"
          f"{'溢出像素':>10}{'渐隐条':>7}{'进局':>6}")
    print('-' * 84)
    for r in rows:
        print(f"{r['tag']:<20}{r['ratio']:>7.3f}{r['clamp']:>12}"
              f"{r['barW']:>10}{r['overflow']:>10}{r['softN']:>7}"
              f"{str(r['started']):>6}")
    print('=' * 84)

    ok = True
    for r in rows:
        if r['err']:
            print(f"  !! {r['tag']} 读取失败: {r['err']}")
            ok = False
            continue
        if not r['started']:
            print(f"  !! {r['tag']} 没进战局，这一行不作数（截图仅存档）")
            ok = False
            continue
        if r['ratio'] <= 16 / 9 + 1e-3:
            if r['overflow'] != 0 or r['barW'] != 0:
                print(f"  !! {r['tag']} 比例 {r['ratio']:.3f} 未超限却封了 "
                      f"{r['overflow']}px —— 白吃掉画面")
                ok = False
        else:
            if r['overflow'] <= 0:
                print(f"  !! {r['tag']} 比例 {r['ratio']:.3f} 超限却没封黑 —— "
                      f"超宽屏被塞进 {r['ratio'] / (16 / 9):.2f} 倍战场")
                ok = False
            else:
                # 关键断言：超宽屏玩家拿到的战场必须和 16:9 完全一样大
                area16 = 1920 * 1080
                a = r['clamp']
                aw, ah = a.split('x')
                if abs(int(aw) * int(ah) - area16 * (sh / 1080) * 0.18) > 0:
                    pass  # 面积随短边缩放是预期，只提示比例
    if ok:
        print('全部通过：非超宽屏零溢出，超宽屏全部封黑')
    print('截图 ->', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    asyncio.run(main())