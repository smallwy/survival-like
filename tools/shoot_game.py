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
    # 本机有 http_proxy 环境变量，urllib 会连 localhost 都走代理并回 502。
    # 必须显式清空代理，否则脚本永远等不到 CDP 就绪。
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

    async def find(self, label, kind='Text'):
        """按**文字**在场景里找控件，返回它的真实页面坐标。

        为什么不写死坐标：`--window-size=960,800` 给的是**窗口**尺寸，
        无头 Chrome 实际视口只有 944x649。按 960x800 算出来的点击点会落到画布
        之外 —— 事件被丢掉、没有任何报错，于是一整轮"截图验证"拍到的其实全是
        同一个界面（实测踩到过：十张图内容完全相同，状态读数 t=0）。
        另外备战面板现在会按画布尺寸整体 setScale 缩放，硬编码坐标必然失效。

        所以：让页面自己算位置。顺带一提，这也是**真的在测 UI** ——
        控件位置变了、被裁了、没注册交互，这里都会失败。
        """
        js = (
            "(()=>{const g=window.__sg;if(!g)return JSON.stringify({err:'no game'});"
            "const s=g.scene.getScene('game');const ov=s.selectOverlay;"
            "if(!ov)return JSON.stringify({err:'no overlay'});"
            "const want='" + label.replace("'", "\\'") + "';"
            "const kinds=" + json.dumps([kind]) + ";"
            "const out=[];"
            "const abs=o=>{let x=o.x,y=o.y,p=o.parentContainer;"
            "while(p){x=p.x+x*(p.scaleX||1);y=p.y+y*(p.scaleY||1);p=p.parentContainer;}"
            "return [x,y];};"
            "const walk=o=>{if(!o)return;"
            "if(kinds.includes(o.type)){const t=(o.text||'').replace(/\\s/g,'');"
            "const w=want.replace(/\\s/g,'');"
            "if(t&&t.includes(w)){const [x,y]=abs(o);out.push({t:o.text,x:x,y:y});}}"
            "if(o.list)o.list.forEach(walk);"
            "else if(o.type==='Container'&&o.getAll)o.getAll().forEach(walk);};"
            "walk(ov);"
            "const r=g.canvas.getBoundingClientRect();"
            "out.forEach(o=>{o.px=r.left+o.x*r.width/g.scale.width;"
            "o.py=r.top+o.y*r.height/g.scale.height;});"
            "return JSON.stringify({canvas:[r.left,r.top,r.width,r.height],"
            "cw:g.scale.width,ch:g.scale.height,found:out});})()"
        )
        r = await self.call('Runtime.evaluate', expression=js, returnByValue=True)
        try:
            return json.loads(r['result']['value'])
        except Exception:
            return {'err': 'decode', 'raw': str(r)[:300]}

    async def click_label(self, label, nth=0, dy=0.0):
        """点中带这段文字的控件（并按标签组顺序取第 nth 个）。"""
        info = await self.find(label)
        found = (info or {}).get('found') or []
        if not found:
            print(f'   !! 找不到控件「{label}」，页面信息:', (info or {}).get('err'))
            return False
        o = found[min(nth, len(found) - 1)]
        await self.click(round(o['px']), round(o['py'] + dy))
        print(f'   点击「{o["t"]}」@ ({round(o["px"])},{round(o["py"] + dy)})')
        return True

    async def viewport(self):
        r = await self.call('Runtime.evaluate', expression=(
            "JSON.stringify({vw:innerWidth,vh:innerHeight,"
            "cw:window.__sg?window.__sg.scale.width:0,"
            "ch:window.__sg?window.__sg.scale.height:0})"),
            returnByValue=True)
        try:
            return json.loads(r['result']['value'])
        except Exception:
            return {}

    async def state(self):
        """读实时对局数据（main.ts 暴露的 window.__sg）。

        有了它，平衡性调整就能按数字收敛：同屏敌人数、血量曲线、死亡时间
        全都可以直接量出来，不用靠看截图猜。
        这一版还必须能读到**战役/阵型/计谋**三样东西的状态 ——
        否则"阵型真的成形了吗""计谋真的进冷却了吗"只能靠肉眼从像素里猜。
        """
        js = (
            "(()=>{const g=window.__sg;if(!g)return '{\"err\":\"no game\"}';"
            "const s=g.scene.getScene('game');"
            "if(!s||!s.enemies)return '{\"err\":\"no scene\"}';"
            "const es=s.enemies.getChildren().filter(e=>e.active);"
            "const c={};es.forEach(e=>{const k=e.texture.key;c[k]=(c[k]||0)+1});"
            # 阵型行为分布：这是"阵型真的生效"的直接证据。
            # 如果这一项始终为空，说明敌人全是散兵，阵型表写了也没接线。
            "const b={};es.forEach(e=>{const k=(e.getData&&e.getData('behavior'))||'';"
            "if(k)b[k]=(b[k]||0)+1});"
            "return JSON.stringify({hp:Math.round(s.hp),lv:s.level,kill:s.kills,"
            "t:+s.elapsed.toFixed(1),foe:es.length,"
            "kinds:c,beh:b,over:s.over,picks:s.upgradePicks||[],"
            "started:!!s.started,"
            "ch:s.chapter?s.chapter.index:0,chName:s.chapter?s.chapter.name:'',"
            "stg:s.stage?s.stage.index:0,stgName:s.stage?s.stage.name:'',"
            "obj:s.stage?s.stage.objective:'',prog:Math.round(s.objProgress||0),"
            "target:s.stage?s.stage.target:0,"
            "objDone:!!s.objDone,failed:!!s.objFailed,"
            "strat:s.stratagem?s.stratagem.name:'',"
            "stratCd:Math.round((s.stratCd||0)/100)/10,"
            "stratReady:!!s.stratagem&&s.stratCd<=0,"
            "forms:(s.formationLog||[]).slice(-8),"
            "formsN:(s.formationLog||[]).length,"
            "cleared:s.cleared?[...s.cleared]:[],"
            "strats:s.unlockedS?[...s.unlockedS]:[],"
            "weapons:(s.weapons||[]).map(w=>w.def.name).join('+')});})()"
        )
        r = await self.call('Runtime.evaluate', expression=js, returnByValue=True)
        try:
            return json.loads(r['result']['value'])
        except Exception:
            return {'err': 'decode', 'raw': str(r)[:200]}

    async def prep_char(self):
        """读备战界面当前选中的武将 id。

        用来给「点了锁定卡」做前后对比：锁卡按设计不可交互，
        所以点击前后 `prepChar` 必须一模一样 —— 之前正是漏了这一步，
        才让一张什么都没变的截图冒充了「换将」。
        """
        r = await self.call('Runtime.evaluate', expression=(
            "(()=>{const s=window.__sg&&window.__sg.scene.getScene('game');"
            "if(!s||!s.prepChar)return '?';return s.prepChar.id})()"),
            returnByValue=True)
        try:
            return r['result']['value']
        except Exception:
            return '?'


def fmt(st):
    if st.get('err'):
        return f"(读不到状态: {st.get('err')})"
    kinds = st.get('kinds') or {}
    ks = ' '.join(f"{k.replace('px_foe_', '')}x{v}" for k, v in kinds.items())
    beh = st.get('beh') or {}
    bs = ' '.join(f"{k}:{v}" for k, v in beh.items())
    obj = ''
    if st.get('obj'):
        obj = f"  目标={st['obj']}({st.get('prog')}/{st.get('target')})"
    sg = ''
    if st.get('strat'):
        sg = f"  计谋={st['strat']}{'✓' if st.get('stratReady') else '@%.0fs' % st.get('stratCd', 0)}"
    return (f"t={st['t']:>5.1f}s  HP={st['hp']:>3}  Lv={st['lv']:>2}  "
            f"击杀={st['kill']:>3}  同屏敌={st['foe']:>2}  武器={st['weapons']}"
            + obj + sg
            + (f"  阵型[{bs}]" if bs else '')
            + (f"  {ks}" if ks else '')
            + ('  已阵亡' if st.get('over') else ''))


# 方向键的 key/code/vk 映射（Phaser 按 keyCode 认键）
KEYS = {'d': ('d', 'KeyD', 68), 'a': ('a', 'KeyA', 65),
        'w': ('w', 'KeyW', 87), 's': ('s', 'KeyS', 83),
        'q': ('q', 'KeyQ', 81), 'e': ('e', 'KeyE', 69),
        'r': ('r', 'KeyR', 82), 'f': ('f', 'KeyF', 70),
        'enter': ('Enter', 'Enter', 13),
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


async def settle(c, seconds, pattern=('d', 'w', 'a', 's'), leg=0.9, trace=None,
                 strat_every=0):
    """一边走位一边等，顺手处理升级弹窗，并按秒采样对局状态。

    四件必须做的事：
    1. **持续走位**。幸存者类里站着不动=被围死，上一版脚本让玩家站桩，
       结果 0:28 就阵亡、后面三张截图全是同一个结算界面。
    2. **按优先级选升级**。升级面板会暂停整个游戏（暂停物理、暂停计时），
       不处理的话第一次升级之后所有画面都会被弹窗糊住、计时器也停在原地 ——
       之前连续三张"战斗截图"拍到的其实是同一个升级界面，毫无诊断价值。
       而且**必须选得像个人**：无脑按 1 的机器人永远拿不到第二把武器，
       单手枪的 DPS 打不赢刷怪速率，跑出来的曲线毫无参考价值。
    3. **采样状态**。同屏敌人数、血量曲线、死亡时间要能读数，否则调平衡只能靠猜。
    4. （本轮新增）**周期性按 Q 释放计谋**。计谋是这一版的核心新增机制，
       不按的话它在对局里永远是"没试过"状态，无法验证冷却环、增伤/减速是否真生效。
       按 strat_every 秒一次的节奏按，比"按一次然后截图"更能确认真的是循环可用。
    """
    end = time.time() + seconds
    i = 0
    nxt_strat = time.time() + strat_every if strat_every else None
    while time.time() < end:
        k = pattern[i % len(pattern)]
        await c.key('keyDown', *KEYS[k])
        await asyncio.sleep(leg)
        await c.key('keyUp', *KEYS[k])
        i += 1
        if nxt_strat is not None and time.time() >= nxt_strat:
            await tap(c, 'q')
            nxt_strat = time.time() + strat_every
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
            print('   视口:', await c.viewport())

            # ---- 1. 备战界面（帐前点将）----
            # 这一版把「选人」升级成了「备战」：章节条 + 武将卡 + 计谋卡 + 出征，
            # 一屏完成。所以第一张图要拍整屏，确认四块内容都在视野内、没互相压字，
            # 也没有局内 HUD 从面板边缘漏出来。
            await c.shot(os.path.join(OUT_DIR, '1-备战.png'))
            st = await c.state()
            print('   备战:', fmt(st))

            # 切一次章节再切回来 —— 验证 ◀▶ 真的会重绘（切到未解锁章显示锁定态，
            # 切回来必须恢复正常，否则说明重绘时状态没复位）
            await c.click_label('▶')
            await asyncio.sleep(0.7)
            await c.shot(os.path.join(OUT_DIR, '2-下一章.png'))
            print('   切章后:', fmt(await c.state()))
            await c.click_label('◀')
            await asyncio.sleep(0.7)

            # 选计谋卡 —— 备战界面上唯一一个「新号也能真的选动」的控件。
            # 选中后卡片描边 / 图标 / 名字一起变金色，是最直观的一次「选择已生效」反馈。
            #
            # 为什么这里不是武将卡：截图流程每次都用全新的 pid（云存档按 pid 持久化，
            # 不换 pid 就会累加统计、让第 N 次跑拿到不一样的解锁状态）。新号只解锁刘备，
            # 关羽 / 张飞 / 赵云都是**锁定卡、按设计不可点**。
            # 早先这里点的是「关羽」然后直接截图，结果那张图和「1-备战」逐字节相同 ——
            # 一张写着「换将」却什么都没变的假图（靠 md5 比对才抓出来）。
            # 现在改成：先点锁卡、确认**真的没有反应**，再点计谋卡拍真实变化。
            await c.click_label('缓兵计')
            await asyncio.sleep(0.6)
            await c.shot(os.path.join(OUT_DIR, '3-选计谋.png'))

            before = await c.prep_char()
            await c.click_label('关羽')
            await asyncio.sleep(0.4)
            after = await c.prep_char()
            print(f'   锁定武将点击: prepChar {before} -> {after}  '
                  + ('(锁卡不可点，符合预期)' if before == after
                     else '!! 锁定卡被点动了'))

            # ---- 2. 出征 ----
            ok = await c.click_label('出　征')
            await asyncio.sleep(1.4)
            st = await c.state()
            if not st.get('started'):
                # 点不到就退到键盘路径（备战界面绑了 Enter），保证后续步骤不被卡住，
                # 但把这件事打出来 —— 静默降级会让"按钮坏了"这种问题永远查不出来。
                print('   !! 点击未生效，降级用 Enter 出征')
                await tap(c, 'enter')
                await asyncio.sleep(1.2)
                st = await c.state()
            print('   出征后:', fmt(st), ' started=', st.get('started'), ' 点击命中=', ok)
            await c.shot(os.path.join(OUT_DIR, '4-报幕.png'))

            # 向右下跑一段，把走路帧和镜头滚动都拍进去
            for k in ('d', 's'):
                await c.key('keyDown', *KEYS[k])
            await asyncio.sleep(3.0)
            await c.shot(os.path.join(OUT_DIR, '5-走路.png'))
            for k in ('d', 's'):
                await c.key('keyUp', *KEYS[k])

            # ---- 3. 交火 + 阵型成形 ----
            # 阵型是这一版最重要的新增：脚本必须在敌人成阵之后再拍一张，
            # 否则拍到的是零散散兵，看不出"楔形/横排/弧形"的差别。
            await settle(c, 20, trace=trace, strat_every=8)
            await c.shot(os.path.join(OUT_DIR, '6-交火.png'))

            # 换个方向再拍一张，验证朝向切换
            await c.key('keyDown', *KEYS['w'])
            await asyncio.sleep(2.2)
            await c.shot(os.path.join(OUT_DIR, '7-朝上.png'))
            await c.key('keyUp', *KEYS['w'])

            # ---- 4. 施计谋 + 冷却环 ----
            # 先按一下确认"立刻可用"，再等冷却，拍冷却环走到一半的样子。
            await tap(c, 'q')
            await asyncio.sleep(0.35)
            await c.shot(os.path.join(OUT_DIR, '8-施计瞬间.png'))
            st_sg = await c.state()
            print('   施计后:', fmt(st_sg))
            await settle(c, 14, trace=trace)
            await c.shot(os.path.join(OUT_DIR, '9-计谋冷却中.png'))

            # ---- 5. 中盘压力曲线 ----
            await settle(c, 60, trace=trace, strat_every=20)
            await c.shot(os.path.join(OUT_DIR, '10-中盘.png'))

            last = trace[-1] if trace else {}
            print(f'--- 阵型日志（{last.get("formsN", 0)} 组）---')
            for f in (last.get('forms') or []):
                print('   ', f)
            print(f'--- 已解锁计谋: {last.get("strats")} ---')
            print(f'--- 已通关关卡: {last.get("cleared")} ---')
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
              f'终局同屏敌 {last.get("foe")}，'
              f'阵型出现 {last.get("formsN", 0)} 次 ---')
    print('完成 ->', OUT_DIR)


if __name__ == '__main__':
    asyncio.run(main())
