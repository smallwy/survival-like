#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
真实游戏截图工具（无第三方浏览器驱动的 CDP 方案）

为什么需要它
------------
这个项目前几轮反复返工，根因之一是**我看不到画面**：只能"盲改 → 等用户截图 → 再猜"。
本脚本用 Chrome 自带的 DevTools Protocol 直接驱动无头浏览器：
打开页面 → 点选潜行者 → 按键移动 → 截图，全程不需要 playwright/浏览器下载。

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
# 只调计谋特效照片时用：SHOT_FX_ONLY=1 跳过 11 张常规图和 60 秒中盘采样。
# 调特效是"改一点 → 看一眼"的循环，整条流程 3 分钟里 2 分钟与特效无关。
FX_ONLY = os.environ.get('SHOT_FX_ONLY') == '1'


def out(name):
    """常规截图路径；FX_ONLY 时返回 None（shot() 会跳过）。"""
    return None if FX_ONLY else os.path.join(OUT_DIR, name)

# 每次跑用一个全新的 pid：云存档是**按 pid 持久化**的，复用会增加累加统计，
# 让第 N 次跑拿到的解锁状态和第一次不一样 —— 平衡测试必须要一个干净的起点。
RUN_PID = 'shot_' + str(int(time.time()))
URL = os.environ.get('GAME_URL', f'http://localhost:5173/?pid={RUN_PID}')
# 窗口尺寸可覆盖：验证视野钳制要用超宽屏 (SHIFT_W=3440 SHIFT_H=1440)
W = int(os.environ.get('SHOT_W', 960))
H = int(os.environ.get('SHOT_H', 800))
PORT = int(os.environ.get('SHOT_PORT', 9333))

# Windows优先，Linux/macOS 兜底 —— 同一脚本双机可用。
CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
        # path 为 None = 本次不拍（SHOT_FX_ONLY 下调特效照片时用来跳过常规图）。
        # 用"跳过"而不是"拍完再删"：常规图一拍就是 11 张、每张都要等一次
        # Page.captureScreenshot 往返，调特效时序时这段时间纯属浪费。
        if path is None:
            return
        r = await self.call('Page.captureScreenshot', format='png')
        with open(path, 'wb') as f:
            f.write(base64.b64decode(r['data']))
        print('  写出', os.path.relpath(path, ROOT),
              os.path.getsize(path) // 1024, 'KB')

    async def ev(self, body):
        """在游戏场景里执行一段 JS（body 里可用 s = 当前场景）。

        给"把六个计谋逐个放一遍"这种**调试通道**用：一局里新号只解锁一个计谋，
        另外五个的形态根本看不到，而"六个计谋形态互不相同"是这一版的硬规范 ——
        没有视觉证据的规范等于没写。所以这里允许直接改场景状态来取景。
        """
        js = ("(()=>{const g=window.__sg;const s=g&&g.scene.getScene('game');"
              "if(!s)return '';try{" + body + "}catch(e){return 'ERR:'+e}})()")
        r = await self.call('Runtime.evaluate', expression=js, returnByValue=True)
        return (r.get('result') or {}).get('value')

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
            "started:!!s.started,paused:!!s.paused,"
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
        """读备战界面当前选中的潜行者 id。

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
        'enter': ('Enter', 'Enter', 13), 'esc': ('Escape', 'Escape', 27),
        # 方向键：既是移动键，也是备战界面切章的键。
        # 正因为"同一个键有两套含义"，备战面板误弹出才会毁掉一局 —— 见 check_objectives 的回归断言。
        'left': ('ArrowLeft', 'ArrowLeft', 37), 'right': ('ArrowRight', 'ArrowRight', 39),
        'up': ('ArrowUp', 'ArrowUp', 38), 'down': ('ArrowDown', 'ArrowDown', 40),
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

            # ---- 1. 备战 · 屏①「战役 · 选关」----
            # 备战这一版拆成了两屏（用户反馈"界面看起来很乱"）：
            #   ① 选关：章节切换 + 三张关卡卡 + 目标 + 首通奖励
            #   ② 点将：潜行者 + 计谋 + 本关摘要 + 出征
            # 第一张图拍屏①，确认"一屏一个主题"确实做到了。
            await c.shot(out('1-选关.png'))
            st = await c.state()
            print('   选关页:', fmt(st))

            # 切一次章节再切回来 —— 验证 ◀▶ 真的会重绘（切到未解锁章显示锁定态，
            # 切回来必须恢复正常，否则说明重绘时状态没复位）
            await c.click_label('▶')
            await asyncio.sleep(0.7)
            await c.shot(out('2-下一章.png'))
            print('   切章后:', fmt(await c.state()))
            await c.click_label('◀')
            await asyncio.sleep(0.7)

            # ---- 1b. 进屏②「帐前 · 点将」----
            await c.click_label('点将')
            await asyncio.sleep(0.6)
            await c.shot(out('3-点将.png'))

            # 选计谋卡 —— 点将页上唯一一个「新号也能真的选动」的控件。
            # 选中后卡片描边 / 图标 / 名字一起变金色，是最直观的一次「选择已生效」反馈。
            #
            # 为什么这里不是潜行者卡：截图流程每次都用全新的 pid（云存档按 pid 持久化，
            # 不换 pid 就会累加统计、让第 N 次跑拿到不一样的解锁状态）。新号只解锁深潜者，
            # 拾光者 / 铸壳者 / 电鳗使都是**锁定卡、按设计不可点**。
            # 早先这里点的是「拾光者」然后直接截图，结果那张图和「1-备战」逐字节相同 ——
            # 一张写着「换将」却什么都没变的假图（靠 md5 比对才抓出来）。
            # 现在改成：先点锁卡、确认**真的没有反应**，再点计谋卡拍真实变化。
            # 注意：这里的控件名必须跟着 gameData.ts 一起改。
            # 换题材时 STRATAGEMS / CHARS 全部改名，这一段没同步 ——
            # 于是 click_label 找不到控件，点了个寂寞，
            # 而脚本不报错，后面 4-选计谋.png 与 1-备战.png 逐字节相同（假图）。
            # 「换题材」不只是画面：所有按名字点控件的脚本都得同步改名。
            await c.click_label('环形回旋')
            await asyncio.sleep(0.6)
            await c.shot(out('4-选计谋.png'))

            before = await c.prep_char()
            await c.click_label('铸壳者')
            await asyncio.sleep(0.4)
            after = await c.prep_char()
            print(f'   锁定潜行者点击: prepChar {before} -> {after}  '
                  + ('(锁卡不可点，符合预期)' if before == after
                     else '!! 锁定卡被点动了'))

            # ---- 2. 出征 ----
            ok = await c.click_label('出　征')
            await asyncio.sleep(1.4)
            st = await c.state()
            if not st.get('started'):
                # 点不到就退到键盘路径（点将页绑了 Enter），保证后续步骤不被卡住，
                # 但把这件事打出来 —— 静默降级会让"按钮坏了"这种问题永远查不出来。
                print('   !! 点击未生效，降级用 Enter 出征')
                await tap(c, 'enter')
                await asyncio.sleep(1.2)
                st = await c.state()
            print('   出征后:', fmt(st), ' started=', st.get('started'), ' 点击命中=', ok)
            await c.shot(out('5-报幕.png'))

            # 抬经验门槛到不可能达到 —— 必须在**进局后立刻**做，不是等到特效段。
            # 上一版只在拍计谋特效前才抬，结果整局中后段（交火/朝上/施计/中盘 四张）
            # 全被升级三选一面板糊住：面板 paused=true、覆盖全屏，
            # 于是四张图看起来一模一样，密度和阵型一张都验证不到。
            # 踩过的坑：以为「脚本跑完了就是拍到了」，其实拍到的全是同一张面板。
            await c.ev("s.expNeed=1e18;return 'ok';")

            # 回归：进局后按方向键**绝不能**把备战面板弹回来（曾经的真 bug）
            for k in ('left', 'right'):
                await tap(c, k)
            await asyncio.sleep(0.4)
            st_arrow = await c.state()
            print('   方向键回归: started=', st_arrow.get('started'),
                  '（必须仍为 True；若为 False 说明备战面板被弹回来了）')

            # 向右下跑一段，把走路帧和镜头滚动都拍进去
            for k in ('d', 's'):
                await c.key('keyDown', *KEYS[k])
            await asyncio.sleep(3.0)
            await c.shot(out('6-走路.png'))
            for k in ('d', 's'):
                await c.key('keyUp', *KEYS[k])

            # ---- 3. 交火 + 阵型成形 ----
            # 阵型是这一版最重要的新增：脚本必须在敌人成阵之后再拍一张，
            # 否则拍到的是零散散兵，看不出"楔形/横排/弧形"的差别。
            await settle(c, 6 if FX_ONLY else 20, trace=trace, strat_every=8)
            await c.shot(out('7-交火.png'))

            # 换个方向再拍一张，验证朝向切换
            await c.key('keyDown', *KEYS['w'])
            await asyncio.sleep(2.2)
            await c.shot(out('8-朝上.png'))
            await c.key('keyUp', *KEYS['w'])

            # ---- 4. 施计谋 + 冷却环 ----
            # 先轮询等"未暂停+冷却清零"再按 Q，否则：
            #   1) 升级面板开着时 paused=true，castStratagem 直接 return，没有特效；
            #   2) 按在冷却期内也是空操作。
            # 两种情况都会让 9-施计瞬间 和上帧逐字节相同，冒充"施法"。
            # 若卡在开面板状态，就按 1 选第一张卡关面板，再继续等。
            # 环在 0.2s 时扩张最明显（外环半径已约 190px），抓这一帧。
            wait_deadline = time.time() + 36
            while time.time() < wait_deadline:
                st_r = await c.state()
                if st_r.get('paused'):
                    await tap(c, '1')
                    await asyncio.sleep(0.25)
                    continue
                if st_r.get('stratReady'):
                    break
                await asyncio.sleep(0.5)
            await tap(c, 'q')
            await asyncio.sleep(0.2)
            await c.shot(out('9-施计瞬间.png'))
            st_sg = await c.state()
            print('   施计后:', fmt(st_sg))
            await settle(c, 4 if FX_ONLY else 14, trace=trace)
            await c.shot(out('10-计谋冷却中.png'))

            # ---- 5. 中盘压力曲线 ----
            await settle(c, 8 if FX_ONLY else 60, trace=trace, strat_every=20)
            await c.shot(out('11-中盘.png'))

            # ---- 6. 计谋特效六连拍（本轮「特效体系」的视觉证据）----
            #
            # 为什么必须单独做：一局里新号只解锁了一个计谋，另外五个的爆发形态
            # 在正常流程里**根本看不到** —— 而"六个计谋形态互不相同"是这一版的硬规范，
            # 没有视觉证据的规范等于没写。所以这里用调试通道逐个装上放一遍。
            #
            # 抓拍时机按形态给：火墙/火舌要等它铺开（0.35s），箭雨要等几波落下来（0.62s），
            # 纯扩散类 0.22s 最亮。全部**错开时间**抓，否则拍到的是同一帧的初始状态。
            #
            # 最后两列是摆靶参数 (半径, 个数) —— **必须按每个计谋自己的有效范围给**：
            #   火计的火墙铺在玩家身前 78px 处（半径 40 的结算圈），靶子摆到 175 就等于
            #   "火在中间烧、敌人在外圈站着看"；十面埋伏的落点有 220px 随机半径，
            #   靶子摆太近又会被互相重叠的敌人挡住。一刀切两个计谋都用同一个半径，
            #   六张图里至少四张是废的。
            # id / name / kind 三列必须与 gameData.ts 的 STRATAGEMS 完全一致。
            # 换题材时这三列全改名了（domino/magnetball/... 是深海版的新 id），
            # 旧值 fire/emptycity/... 在 switch 里一个都匹配不上，
            # castStratagem 会静默 return —— 六张图拍出来全是"什么都没发生"。
            # 但结算特效走的是特效层，不看 id，所以名字/id 错了只是文案不对，
            # kind 错了才是特效形态不对。三者都按新表填。
            FX = [
                ('domino', '共鸣脉冲', 'chain', 22, 0.20, 105, 10),
                ('magnetball', '诱光潮', 'pull', 24, 0.30, 145, 9),
                ('rubber', '声呐冲击', 'rebound', 24, 0.26, 170, 11),
                ('spinner', '环形回旋', 'spin', 26, 0.62, 175, 10),
                ('puzzlebox', '捕光陷阱', 'stun', 25, 0.24, 150, 9),
                ('overclock', '过载脉冲', 'buff', 28, 0.26, 160, 10),
            ]
            st_fx = await c.state()
            if st_fx.get('over'):
                print('   !! 已收场，跳过计谋特效六连拍（否则拍到的是结算界面）')
            else:
                # 摆靶的敌人被打死后会掉经验，玩家一捡就弹**升级面板**：
                # 它会暂停物理、并且直接盖住整个画面（第一版 fx-only 跑出来
                # 六张图全是升级面板，特效一张没拍到 —— 面板挡住的正是要拍的东西）。
                # 两道处理：
                #   ① 升级门槛抬到不可能达到，从根上断掉拍照期间弹板的可能；
                #   ② 若此刻已经弹着，按 1 走游戏自己的关板路径 ——
                #      不硬改 paused，否则物体会停在暂停态、后续特效全不动。
                await c.ev("s.expNeed=1e18;return 'ok';")
                for _ in range(4):
                    if not (await c.state()).get('paused'):
                        break
                    await tap(c, '1')
                    await asyncio.sleep(0.3)
                for i, (sid, sname, kind, cd, wait, rr, rn) in enumerate(FX, 1):
                    # 每发之前必须做两件事，否则照片没有证据价值：
                    #   ① fxClear —— 计谋特效是**有时长**的（火墙活 4 秒），
                    #      不清场的话上一发会盖在下一发的照片上。
                    #      实测 fx-4-十面埋伏 那张里拍到的是 fx-1 火计的火墙。
                    #   ② fxRing  —— 阵型的阵心是刻意刷在屏幕外的（见 spawnFormation 注释），
                    #      不改的话六张照片全是"计谋打在空地上"，撞击感为零。
                    r = await c.ev(
                        "s.invuln=9999999;"
                        "if(s.fxClear)s.fxClear();"
                        f"if(s.fxRing)s.fxRing({rn},{rr});"
                        f"s.stratagem={{id:'{sid}',name:'{sname}',quote:'',desc:'',"
                        f"kind:'{kind}',cdSec:{cd}}};"
                        "s.stratCd=0;return 'ok';")
                    if r != 'ok':
                        print('   !! 计谋特效调试通道返回', r)
                    await asyncio.sleep(0.55)
                    await c.ev(f"s.stratagem={{id:'{sid}',name:'{sname}',quote:'',"
                               f"desc:'',kind:'{kind}',cdSec:{cd}}};"
                               "s.stratCd=0;s.castStratagem();return 'ok';")
                    await asyncio.sleep(wait)
                    await c.shot(os.path.join(OUT_DIR, f'fx-{i}-{sname}.png'))

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
