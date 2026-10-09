#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
真实游戏截图工具（无第三方浏览器驱动的 CDP 方案）

为什么需要它
------------
这个项目前几轮反复返工，根因之一是**我看不到画面**：只能"盲改 → 等用户截图 → 再猜"。
本脚本用 Chrome 自带的 DevTools Protocol 直接驱动无头浏览器：
打开页面 → 点选武将 → 按键移动 → 截图，全程不需要 playwright/浏览器下载。

依赖：本机已装 Chrome、Python 端有 websockets、以及前端 dev server 在 5173。

用法：
    python tools/shoot_game.py [输出目录]
默认输出到 docs/shots/
"""
import asyncio
import base64
import json
import os
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
OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs', 'shots')
# 每次跑用一个全新的 pid：云存档是**按 pid 持久化**的，复用会增加累加统计，
# 让第 N 次跑拿到的解锁状态和第一次不一样 —— 平衡测试必须要一个干净的起点。
RUN_PID = 'shot_' + str(int(time.time()))
URL = os.environ.get('GAME_URL', f'http://localhost:5173/?pid={RUN_PID}')
W, H = 960, 800
PORT = 9333

CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
]


def find_browser():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit('未找到 Chrome / Edge')


def launch(url):
    ud = os.path.join(tempfile.gettempdir(), 'wb_cdp_prof')
    os.makedirs(ud, exist_ok=True)
    proc = subprocess.Popen([
        find_browser(), '--headless=new', '--disable-gpu', '--no-sandbox',
        '--hide-scrollbars', '--mute-audio',
        f'--window-size={W},{H}', f'--user-data-dir={ud}',
        f'--remote-debugging-port={PORT}', url,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc


def wait_ws():
    for _ in range(60):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json', timeout=1) as r:
                targets = json.load(r)
            pages = [t for t in targets if t.get('type') == 'page' and t.get('webSocketDebuggerUrl')]
            if pages:
                return pages[0]['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit('CDP 未就绪')


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def call(self, method, **params):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result', {})

    async def click(self, x, y):
        for t in ('mousePressed', 'mouseReleased'):
            await self.call('Input.dispatchMouseEvent', type=t, x=x, y=y,
                            button='left', clickCount=1)

    async def key(self, kind, key, code, vk):
        await self.call('Input.dispatchKeyEvent', type=kind, key=key, code=code,
                        windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)

    async def shot(self, path):
        r = await self.call('Page.captureScreenshot', format='png')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(r['data']))
        print('  写出', os.path.relpath(path, ROOT),
              os.path.getsize(path) // 1024, 'KB')

    async def state(self):
        """读实时对局数据（main.ts 暴露的 window.__sg）。

        有了它，平衡性调整就能按数字收敛：同屏敌人数、血量曲线、死亡时间
        全都可以直接量出来，不用靠看截图猜。
        """
        js = (
            "(()=>{const g=window.__sg;if(!g)return '{\"err\":\"no game\"}';"
            "const s=g.scene.getScene('game');"
            "if(!s||!s.enemies)return '{\"err\":\"no scene\"}';"
            "const es=s.enemies.getChildren().filter(e=>e.active);"
            "const c={};es.forEach(e=>{const k=e.texture.key;c[k]=(c[k]||0)+1});"
            "return JSON.stringify({hp:Math.round(s.hp),lv:s.level,kill:s.kills,"
            "t:+s.elapsed.toFixed(1),foe:es.length,"
            "kinds:c,over:s.over,picks:s.upgradePicks||[],"
            "weapons:(s.weapons||[]).map(w=>w.def.name).join('+')});})()"
        )
        r = await self.call('Runtime.evaluate', expression=js, returnByValue=True)
        try:
            return json.loads(r['result']['value'])
        except Exception:
            return {'err': 'decode', 'raw': str(r)[:200]}


def fmt(st):
    if st.get('err'):
        return f"(读不到状态: {st.get('err')})"
    kinds = st.get('kinds') or {}
    ks = ' '.join(f"{k.replace('px_foe_', '')}x{v}" for k, v in kinds.items())
    return (f"t={st['t']:>5.1f}s  HP={st['hp']:>3}  Lv={st['lv']:>2}  "
            f"击杀={st['kill']:>3}  同屏敌={st['foe']:>2}  武器={st['weapons']}"
            + (f"  [{ks}]" if ks else '') + ('  已阵亡' if st.get('over') else ''))


# 方向键的 key/code/vk 映射（Phaser 按 keyCode 认键）
KEYS = {'d': ('d', 'KeyD', 68), 'a': ('a', 'KeyA', 65),
        'w': ('w', 'KeyW', 87), 's': ('s', 'KeyS', 83),
        '1': ('1', 'Digit1', 49), '2': ('2', 'Digit2', 50),
        '3': ('3', 'Digit3', 51)}


async def tap(c, k, n=1, gap=0.12):
    for _ in range(n):
        await c.key('keyDown', *KEYS[k])
        await c.key('keyUp', *KEYS[k])
        await asyncio.sleep(gap)


# 「一个懂行的玩家」会怎么选：先补武器（多一把 = DPS 直接翻倍），
# 再堆伤害/攻速，缺血时补血，最后才是移速和拾取范围。
# 机器人按这个优先级选卡，跑出来的曲线才能代表真人体验。
PICK_PRIORITY = ['newgun', 'dmg', 'cd', 'regen', 'hp', 'pierce', 'spd', 'magnet']


def pick_upgrade(picks):
    for want in PICK_PRIORITY:
        if want in picks:
            return str(picks.index(want) + 1)
    return '1'


async def settle(c, seconds, pattern=('d', 'w', 'a', 's'), leg=0.9, trace=None):
    """一边走位一边等，顺手处理升级弹窗，并按秒采样对局状态。

    三件必须做的事：
    1. **持续走位**。幸存者类里站着不动=被围死，上一版脚本让玩家站桩，
       结果 0:28 就阵亡、后面三张截图全是同一个结算界面。
    2. **按优先级选升级**。升级面板会暂停整个游戏（暂停物理、暂停计时），
       不处理的话第一次升级之后所有画面都会被弹窗糊住、计时器也停在原地 ——
       之前连续三张"战斗截图"拍到的其实是同一个升级界面，毫无诊断价值。
       而且**必须选得像个人**：无脑按 1 的机器人永远拿不到第二把武器，
       单手枪的 DPS 打不赢刷怪速率，跑出来的曲线毫无参考价值。
    3. **采样状态**。同屏敌人数、血量曲线、死亡时间要能读数，否则调平衡只能靠猜。
    """
    end = time.time() + seconds
    i = 0
    while time.time() < end:
        k = pattern[i % len(pattern)]
        await c.key('keyDown', *KEYS[k])
        await asyncio.sleep(leg)
        await c.key('keyUp', *KEYS[k])
        i += 1
        st = await c.state()
        for _ in range(3):          # 可能连续弹两次（一次升多级）
            if st.get('picks'):
                await tap(c, pick_upgrade(st['picks']))
                await asyncio.sleep(0.25)
                st = await c.state()
            else:
                break
        if trace is not None:
            trace.append(st)
        if st.get('over'):
            print('    ! 阵亡', fmt(st))
            break
    return trace


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    trace = []
    proc = launch('about:blank')
    try:
        ws_url = wait_ws()
        async with websockets.connect(ws_url, max_size=32 * 1024 * 1024) as ws:
            c = CDP(ws)
            await c.call('Page.enable')
            await c.call('Page.navigate', url=URL)
            print('已打开', URL)
            await asyncio.sleep(4)   # 等 Phaser 起场景 + 程序化贴图生成
            await c.shot(os.path.join(OUT_DIR, '1-选人.png'))

            # 点「新人」卡片（选人面板居中，第一张卡在 x = 中心 - 288）
            await c.click(W // 2 - 288, H // 2 + 22)
            await asyncio.sleep(1.0)

            # 向右下跑一段，把走路帧和镜头滚动都拍进去
            for k in ('d', 's'):
                await c.key('keyDown', *KEYS[k])
            await asyncio.sleep(3.2)
            await c.shot(os.path.join(OUT_DIR, '2-走路.png'))
            for k in ('d', 's'):
                await c.key('keyUp', *KEYS[k])

            # 交火：命中会出飘字、死亡会炸碎片
            await settle(c, 12, trace=trace)
            await c.shot(os.path.join(OUT_DIR, '3-交火.png'))

            # 换个方向再拍一张，验证朝向切换
            await c.key('keyDown', *KEYS['w'])
            await asyncio.sleep(2.2)
            await c.shot(os.path.join(OUT_DIR, '4-朝上.png'))
            await c.key('keyUp', *KEYS['w'])

            await settle(c, 22, trace=trace)
            await c.shot(os.path.join(OUT_DIR, '5-长局.png'))

            # 后期：拉长到两分钟量级，看中盘的压力曲线有没有失控
            await settle(c, 55, trace=trace)
            await c.shot(os.path.join(OUT_DIR, '6-后期.png'))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()
    print('--- 对局曲线（每采样点一行）---')
    for st in trace:
        print('   ', fmt(st))
    if trace:
        last = trace[-1]
        print(f'--- 结论：存活 {last.get("t")}s，击杀 {last.get("kill")}，'
              f'终局同屏敌 {last.get("foe")} ---')
    print('完成 ->', OUT_DIR)


if __name__ == '__main__':
    asyncio.run(main())
