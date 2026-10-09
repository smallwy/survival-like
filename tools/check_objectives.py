#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""主线关卡目标 / 阵型 / 计谋 的**逻辑**验证（无头，不等满一局）。

为什么单独做这一层
------------------
截图只能证明"画面能看"，证明不了"规则真的会触发"。而主线的三件事恰恰都是
**要等很久才会发生**的：
  * survive 关要活满 4 分钟才通关；
  * boss 关要等 Boss 在 30% 时长处出场，再把它打死；
  * kill 关要杀掉一百多个。
等满一局要 4~7 分钟，一轮验证就是十几分钟，根本没法反复跑。

所以这里用 CDP 直接把场景状态推到临界点，然后让**真实的 update 循环**跑下去，
看它是不是真的触发了对应的收场。这样验的是真代码路径，不是复述一遍逻辑。

用法：
    python tools/check_objectives.py
前端/后端由 tools/_devstack.py 在同进程周期内拉起（本机沙箱会回收残留子进程，
不能"先起服务再单独跑脚本"）。
"""
import asyncio
import json
import os
import sys

try:
    import websockets
except ModuleNotFoundError:  # pragma: no cover
    # 这一层是 CDP 直连浏览器的前提。直接抛 traceback 的话，
    # 在 verify_all 里表现为"逻辑验证 FAIL"，很容易被误判成"代码坏了"——
    # 实测就因为这个白跑过一整条验证链（6 秒就结束，还全是 FAIL）。
    print('需要 websockets：pip install websockets', file=sys.stderr)
    print('提示：本机已有一个装好依赖的解释器，'
          r'可直接用 ~/.workbuddy/binaries/python/envs/default/Scripts/python.exe 运行，'
          '或设 PYTHON_BIN 指向它。', file=sys.stderr)
    sys.exit(2)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _devstack import stack  # noqa: E402
from shoot_game import CDP, launch, tap, wait_ws  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PID = 'objcheck_%d' % int(__import__('time').time())
URL = f'http://localhost:5173/?pid={PID}'

results = []


def ok(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS  ' if cond else 'FAIL  ') + name + (f'  — {detail}' if detail else ''))


async def ev(c, body):
    """执行一段 JS（body 里可以用 s = 当前游戏场景），返回解析后的 JSON。"""
    js = ("(()=>{const g=window.__sg;if(!g)return '{\"err\":\"no game\"}';"
          "const s=g.scene.getScene('game');if(!s)return '{\"err\":\"no scene\"}';"
          "try{" + body + "}catch(e){return JSON.stringify({err:String(e)});}})()")
    r = await c.call('Runtime.evaluate', expression=js, returnByValue=True)
    try:
        return json.loads(r['result']['value'])
    except Exception:
        return {'err': 'decode', 'raw': str(r)[:300]}


TEXTS = (
    "const out=[];const walk=o=>{if(!o)return;"
    "if(o.type==='Text'&&o.text)out.push(o.text.replace(/\\s/g,''));"
    "if(o.list)o.list.forEach(walk);};"
    "(s.children&&s.children.list?s.children.list:[]).forEach(walk);"
)


async def read_stage(c):
    """读开局状态。抽出来是为了让下面三条出征路径共用同一段表达式。"""
    return await ev(c, "return JSON.stringify({started:!!s.started,"
                       "obj:s.stage.objective,dur:s.stage.durationSec,"
                       "target:s.stage.target,ch:s.chapter.index,"
                       "stg:s.stage.index,strat:s.stratagem?s.stratagem.name:''});")


async def start_run(c):
    """重新载入页面并出征。

    备战现在是**两屏**（① 战役·选关 → ② 帐前·点将），两条屏都绑了 Enter：
    选关页按 Enter 进点将页，点将页按 Enter 出征。

    三条路径依次尝试，**每一层失败都要看得见**：
      1) Enter 连按 —— 同时也验证了键盘路径真的通；
      2) 点按钮（「点将」→「出征」）—— Enter 可能被别的监听吃掉；
      3) 直接调 s.deploy() —— 兜底，但会**大声打出来**。
         静默降级是最危险的：UI 真坏了却永远查不出来（本项目踩过一次，
         表现为"一整轮截图拍到的其实是同一个界面"）。
    """
    await c.call('Page.navigate', url=URL)
    await asyncio.sleep(3.0)
    st = {}
    for _ in range(6):
        await tap(c, 'enter')
        await asyncio.sleep(0.7)
        st = await read_stage(c)
        if st.get('started'):
            return st
    print('   !! Enter 路径没能出征，改用点击路径')
    for label in ('点将', '出　征'):
        await c.click_label(label)
        await asyncio.sleep(0.8)
    st = await read_stage(c)
    if st.get('started'):
        return st
    print('   !! 点击路径也没能出征，**降级**直接调 s.deploy()（请检查按钮/键盘绑定）')
    await ev(c, "s.gotoDeploy();s.deploy();return '1';")
    await asyncio.sleep(1.0)
    return await read_stage(c)


async def main():
    proc = launch('about:blank')
    try:
        ws_url = wait_ws()
        async with websockets.connect(ws_url, max_size=32 * 1024 * 1024) as ws:
            c = CDP(ws)
            await c.call('Page.enable')

            # ---------- -1) 备战界面（两屏）的交互 ----------
            # 这两条是被一张**假截图**逼出来的：截图流程里点了「关羽」再拍图，
            # 那张图却和「1-备战」逐字节相同 —— 因为新号只解锁刘备，关羽是锁定卡，
            # 点击本来就没有任何反应。所以这里用断言把「交互 → 状态」钉住，
            # 免得再出现"图上写着换将、实际什么都没发生"。
            await c.call('Page.navigate', url=URL)
            await asyncio.sleep(3.5)

            # 两屏拆分（用户反馈"界面看起来很乱"）：
            # 加载后必须先落在「战役·选关」，点「点将」才进「帐前·点将」。
            # 拆开之后每一屏只有一个主题 —— 断言也顺便保证"拆了但两屏都真的可进"。
            r0 = await ev(c, "return JSON.stringify({step:s.prepStep,ov:!!s.selectOverlay});")
            ok('备战分两步：加载后停在「战役·选关」', r0.get('step') == 'stage', str(r0))
            await c.click_label('点将')
            await asyncio.sleep(0.6)
            r1 = await ev(c, "return JSON.stringify({step:s.prepStep});")
            ok('点「点将」进入「帐前·点将」', r1.get('step') == 'deploy', str(r1))

            pc0 = await c.prep_char()
            ok('备战：新号默认选中刘备', pc0 == 'rookie', str(pc0))

            deck = await ev(c, "return JSON.stringify({"
                               "chars:s.unlockedC?[...s.unlockedC]:null,"
                               "stratPicked:s.prepStrat});")
            ok('备战：新号只解锁了刘备一名武将（其余是锁定卡）',
               deck.get('chars') == ['rookie'], str(deck.get('chars')))
            ok('备战：初始没有预选计谋（默认要玩家自己点）',
               deck.get('stratPicked') == '', repr(deck.get('stratPicked')))

            await c.click_label('关羽')
            await asyncio.sleep(0.5)
            pc1 = await c.prep_char()
            ok('备战：点锁定武将卡不会换将（锁卡按设计不可交互）',
               pc1 == pc0, f'{pc0} -> {pc1}')

            await c.click_label('缓兵计')
            await asyncio.sleep(0.5)
            r = await ev(c, "return JSON.stringify({picked:s.prepStrat});")
            ok('备战：点计谋卡真的会被选中（prepStrat 落到该 id）',
               r.get('picked') == 'slowdown', str(r.get('picked')))

            # ---------- 0) 起点：新号的第一个关卡 ----------
            st = await start_run(c)
            print('开局:', st)
            ok('新号从第 1 章第 1 关开始', st.get('ch') == 1 and st.get('stg') == 1,
               str(st))
            ok('第 1 关目标是 survive', st.get('obj') == 'survive', str(st.get('obj')))
            ok('默认已解锁一个计谋（缓兵计）', st.get('strat') == '缓兵计',
               str(st.get('strat')))

            # ---------- 0.5) 回归：对局中按方向键绝不能把备战面板弹回来 ----------
            #
            # 这是用户实机截图反馈的那个 bug：「打着打着弹了这个（备战面板）」。
            # 病根是备战界面每次重建都往 window 上加一个 keydown 监听，
            # 而"摘旧的"读的是刚新建容器上的属性（永远 undefined）→ 监听只增不减。
            # startRun 只摘掉最后一份，于是对局中按 ← / →（也正是移动键）会重新弹出备战。
            #
            # 症状极隐蔽：tsc 全绿、布局断言全绿、画面也正常，只有真的按了方向键才暴露。
            # 所以钉成断言：进局后连按方向键，必须仍然在局内、且没有 overlay。
            await tap(c, 'left')
            await tap(c, 'right')
            await tap(c, 'up')
            await asyncio.sleep(0.5)
            rr = await ev(c, "return JSON.stringify({started:!!s.started,"
                             "ov:!!s.selectOverlay,step:s.prepStep});")
            ok('回归：对局中按方向键不会把备战面板弹回来',
               rr.get('started') and not rr.get('ov'), str(rr))

            # ---------- 1) survive 关：活满时长 = 通关 ----------
            await ev(c, "s.elapsed = s.stage.durationSec - 0.3; return '1';")
            await asyncio.sleep(1.0)
            r = await ev(c, "return JSON.stringify({done:s.objDone,over:s.over,"
                            "failed:s.objFailed,texts:(()=>{" + TEXTS + "return out;})()});")
            names = r.get('texts') or []
            ok('survive：活满时长触发通关', r.get('done') and r.get('over'), str(r.get('done')))
            ok('survive：结算标题是「通关」', '通关' in names,
               ','.join(x for x in names if '关' in x or '亡' in x or '竟' in x)[:60])
            ok('survive：不是被判定为阵亡/未竟',
               not r.get('failed') and '阵亡' not in names and '未竟' not in names)

            # ---------- 2) 阵亡：血被打空 ----------
            await start_run(c)
            await ev(c, "s.invuln=0;s.hp=1;"
                        "const fake={active:true,x:s.player.x,y:s.player.y,"
                        "getData:k=>(k==='dmg'?999:0),setData:()=>{}};"
                        "s.onPlayerHit(s.player,fake);return '1';")
            await asyncio.sleep(0.6)
            r = await ev(c, "return JSON.stringify({hp:Math.round(s.hp),over:s.over,"
                            "done:s.objDone,failed:s.objFailed,"
                            "texts:(()=>{" + TEXTS + "return out;})()});")
            names = r.get('texts') or []
            ok('阵亡：血空即收场', r.get('over') and r.get('hp', 1) <= 0, str(r.get('hp')))
            ok('阵亡：标题是「阵亡」而不是「未竟」',
               '阵亡' in names and '未竟' not in names,
               ','.join(x for x in names if '阵亡' in x or '竟' in x or '通关' in x)[:60])

            # ---------- 3) kill 关：击杀数达标 = 通关 ----------
            await start_run(c)
            r = await ev(c, "s.stage.objective='kill';s.stage.target=5;s.kills=5;"
                            "return JSON.stringify(s.stage.objective);")
            await asyncio.sleep(0.8)
            r = await ev(c, "return JSON.stringify({done:s.objDone,over:s.over,"
                            "prog:s.objProgress,"
                            "texts:(()=>{" + TEXTS + "return out;})()});")
            ok('kill：击杀达标触发通关', r.get('done') and r.get('over'),
               f"prog={r.get('prog')}")

            # ---------- 4) kill 关超时 = 未竟（不是阵亡） ----------
            await start_run(c)
            await ev(c, "s.stage.objective='kill';s.stage.target=99999;"
                        "s.elapsed=s.stage.durationSec-0.3;return '1';")
            await asyncio.sleep(1.0)
            r = await ev(c, "return JSON.stringify({failed:s.objFailed,over:s.over,"
                            "done:s.objDone,"
                            "texts:(()=>{" + TEXTS + "return out;})()});")
            names = r.get('texts') or []
            ok('kill 超时：判定为「未竟」', r.get('failed') and r.get('over') and not r.get('done'),
               str(r.get('failed')))
            ok('kill 超时：没有误报「阵亡」', '未竟' in names and '阵亡' not in names,
               ','.join(x for x in names if '阵亡' in x or '竟' in x or '通关' in x)[:60])

            # ---------- 5) boss 关：Boss 按时出场，斩将即通关 ----------
            await start_run(c)
            r = await ev(c, "s.stage.objective='boss';s.stage.bossId='boss_warlord';"
                            "s.stage.bossAt=1;s.stage.durationSec=9999;"
                            "s.bossesSpawned.clear();s.elapsed=2;"
                            "return JSON.stringify({bossAt:s.stage.bossAt});")
            await asyncio.sleep(1.0)
            r = await ev(c,
                         "const es=s.enemies.getChildren().filter(e=>e.active);"
                         "const bosses=es.filter(e=>e.getData('isBoss'));"
                         "return JSON.stringify({foe:es.length,bosses:bosses.length,"
                         "name:bosses.length?bosses[0].getData('bossName'):'',"
                         "hp:bosses.length?Math.round(bosses[0].getData('hp')):0});")
            ok('boss：到点真的生成了 Boss', r.get('bosses', 0) >= 1, str(r))
            ok('boss：Boss 带名字（用于斩将播报）', bool(r.get('name')), str(r.get('name')))

            r = await ev(c,
                         "const b=s.enemies.getChildren().filter(e=>e.active&&e.getData('isBoss'))[0];"
                         "if(!b) return JSON.stringify({err:'no boss'});"
                         "s.killEnemy(b);return JSON.stringify({killed:true});")
            await asyncio.sleep(2.0)   # finishStage 里有 900ms 延迟
            r = await ev(c, "return JSON.stringify({done:s.objDone,bossDown:s.bossDown,"
                            "over:s.over,prog:s.objProgress});")
            ok('boss：斩将后按目标通关', r.get('done') and r.get('over'),
               f"bossDown={r.get('bossDown')} prog={r.get('prog')}")

            # ---------- 6) 阵型：真的成形（屏外、成组、行为有分叉） ----------
            await start_run(c)
            await asyncio.sleep(0.4)
            r = await ev(c,
                         "for(let i=0;i<3;i++) s.spawnFormation();"
                         "const es=s.enemies.getChildren().filter(e=>e.active);"
                         "const beh={};es.forEach(e=>{const b=e.getData('behavior')||'';"
                         "if(b)beh[b]=(beh[b]||0)+1;});"
                         "const ds=es.map(e=>Math.hypot(e.x-s.player.x,e.y-s.player.y));"
                         "return JSON.stringify({foe:es.length,beh:beh,"
                         "log:(s.formationLog||[]).slice(-3),"
                         "minD:ds.length?Math.round(Math.min(...ds)):0});")
            ok('阵型：刷出的敌人被标记了行为', sum((r.get('beh') or {}).values()) >= 15,
               str(r.get('beh')))
            ok('阵型：出场位置在屏外（不会凭空出现在画面里）', r.get('minD', 0) > 250,
               f"minD={r.get('minD')}")
            ok('阵型：formationLog 有记录（可观测）', len(r.get('log') or []) >= 1,
               str(r.get('log')))

            # 同一章不同波次应能刷出不同阵型 —— 只刷一种等于"阵型"没做。
            # 注意：`seen` 必须在循环**之后**从 formationLog 现取。
            # 先取快照再循环的话拿到的还是循环前那三个，永远只有 1 种（本脚本踩过）。
            r = await ev(c,
                         "for(let i=0;i<40;i++){s.waveIdx=i;s.spawnFormation();}"
                         "const all=[...new Set(s.formationLog||[])];"
                         "return JSON.stringify({distinct:all.length,all:all,"
                         "wave0:(s.waveIdx=0,s.formationsFor(0)),"
                         "wave9:(s.waveIdx=9,s.formationsFor(9))});")
            ok('阵型：整章能刷出多种阵型（不是只有一种）',
               (r.get('distinct') or 0) >= 2, str(r.get('all')))
            ok('阵型：波次推进真的会解锁更硬的阵型',
               len(r.get('wave9') or []) > len(r.get('wave0') or []),
               f"wave0={r.get('wave0')} wave9={r.get('wave9')}")

            # ---------- 7) 计谋：六个都真的有效果，冷却真的生效 ----------
            await start_run(c)
            await asyncio.sleep(0.4)
            # 先造一批敌人，让有伤害的计谋有事可做
            await ev(c, "for(let i=0;i<3;i++) s.spawnFormation(); return '1';")
            await asyncio.sleep(0.3)

            SPECS = {
                'fire': ("s.stratagem={id:'fire',name:'火计',quote:'',kind:'burst',cdSec:22};",
                         "return JSON.stringify({n:s.children.list.filter(o=>o.type==='Zone').length});",
                         "n", 1, '火计：放出了火墙区域'),
                'emptycity': ("s.stratagem={id:'emptycity',name:'空城计',quote:'',kind:'guard',cdSec:24};",
                              # 读**施放瞬间记录的授予值**，不回读会衰减的 s.invuln。
                              # 回读会引入真实时间噪声：机器卡一下（CDP 首轮常见）
                              # 就会读到 1400 上下，一次偶发失败会被误读成"空城计坏了"。
                              "return JSON.stringify({iv:s.lastGuardMs});",
                              "iv", 2500, '空城计：给了大段无敌帧'),
                'slowdown': ("s.stratagem={id:'slowdown',name:'缓兵计',quote:'',kind:'control',cdSec:24};",
                             "const es=s.enemies.getChildren().filter(e=>e.active);"
                             "return JSON.stringify({n:es.length,later:es.every(e=>s.slowUntil>s.elapsed)});",
                             "later", True, '缓兵计：全场进入减速窗口'),
                'ambush': ("s.stratagem={id:'ambush',name:'十面埋伏',quote:'',kind:'burst',cdSec:26};",
                           "const es=s.enemies.getChildren().filter(e=>e.active);"
                           "return JSON.stringify({before:es.reduce((a,e)=>a+(e.getData('hp')||0),0)});",
                           "before", -1, '十面埋伏：命中范围内敌人'),
                'chain': ("s.stratagem={id:'chain',name:'连环计',quote:'',kind:'control',cdSec:25};",
                          "const es=s.enemies.getChildren().filter(e=>e.active);"
                          "return JSON.stringify({n:es.length,slow:s.slowUntil>s.elapsed});",
                          "slow", True, '连环计：连起最近敌人并使其减速'),
                'laststand': ("s.stratagem={id:'laststand',name:'背水一战',quote:'',kind:'buff',cdSec:28};",
                              "return JSON.stringify({dmg:s.buffDmg,vuln:s.buffVuln,t:s.buffT});",
                              "dmg", 1.5, '背水一战：攻击提升且带代价'),
            }

            for sid, (setup, probe, key, want, label) in SPECS.items():
                # 每次先把冷却清零，保证"这一发"真的能放出去
                await ev(c, "s.stratCd=0;" + setup + "s.castStratagem();return '1';")
                await asyncio.sleep(0.45)
                r = await ev(c, probe)
                got = r.get(key)
                if sid == 'ambush':
                    # 箭雨是 8 波、每波 190ms，等它落完再看血量掉了多少
                    await asyncio.sleep(1.8)
                    r2 = await ev(c, "const es=s.enemies.getChildren().filter(e=>e.active);"
                                     "return JSON.stringify({after:es.reduce((a,e)=>a+(e.getData('hp')||0),0),"
                                     "kills:s.kills});")
                    ok(label, (r2.get('kills') or 0) > 0 or (r2.get('after', 0) < (got or 0)),
                       f"hp {got}→{r2.get('after')}, kills={r2.get('kills')}")
                elif isinstance(want, bool):
                    ok(label, got is want, f"{key}={got}")
                else:
                    ok(label, (got or 0) >= want, f"{key}={got}")

            # 冷却：立刻再按一次不应重置
            r = await ev(c,
                         "s.stratagem={id:'slowdown',name:'缓兵计',quote:'',kind:'control',cdSec:24};"
                         "s.stratCd=0;s.castStratagem();const a=s.stratCd;"
                         "s.castStratagem();const b=s.stratCd;"
                         "s.slowUntil=0;return JSON.stringify({a:Math.round(a/1000),b:Math.round(b/1000)});")
            ok('计谋：释放后进入冷却', (r.get('a') or 0) >= 20, str(r))
            ok('计谋：冷却中再按不会重置冷却（也不能白嫖）',
               (r.get('b') or 0) <= (r.get('a') or 0), str(r))

            # ---------- 8) HUD 布局自检：三档字号下都不许互相压字 ----------
            #
            # 这一组是本项目里最容易"看一眼才发现"的问题：顶部居中的目标条曾经
            # 直接压在左上角的武将面板上（目标文字左端 297px < 面板右边界 390px），
            # 两段字叠在一起谁都读不了。而它只在**特定字号档**下才越界 ——
            # 手动切档看一遍很容易漏，所以做成对三档全跑的断言。
            LAYOUT_JS = (
                "const all=[];const walk=o=>{if(!o)return;if(o.type)all.push(o);"
                "if(o.list)o.list.forEach(walk);};s.children.list.forEach(walk);"
                "const panel=all.find(o=>o.type==='Rectangle'&&o.depth===99"
                "&&Math.round(o.originX)===0&&o.originY===0&&o.width>200);"
                "const R=o=>{if(!o)return null;const b=o.getBounds();"
                "return {l:Math.round(b.left),r:Math.round(b.right),"
                "t:Math.round(b.top),b:Math.round(b.bottom)};};"
                "const inter=(a,b)=>!!a&&!!b&&!(a.right<=b.left||b.right<=a.left"
                "||a.bottom<=b.top||b.bottom<=a.top);"
                "const obj=s.objText.getBounds();"
                "const br=s.objBar.getData('rect');"
                "const bar=br?{left:br.l,right:br.l+br.w,top:br.t,bottom:br.t+br.h}:null;"
                "const st=s.stratText.getBounds(),hn=s.hintText.getBounds();"
                "const pb=panel?panel.getBounds():null;"
                "return JSON.stringify({k:s.hudK,w:s.scale.width,h:s.scale.height,"
                "panel:R(panel),obj:R(s.objText),"
                "bar:bar?{l:Math.round(bar.left),r:Math.round(bar.right),"
                "t:Math.round(bar.top),b:Math.round(bar.bottom)}:null,"
                "strat:R(s.stratText),hint:R(s.hintText),"
                "objHitPanel:inter(obj,pb),barHitPanel:inter(bar,pb),"
                "barPastRight:!!bar&&bar.right>s.scale.width-2,"
                "objPastRight:obj.right>s.scale.width-2,"
                "stratOut:st.right>s.scale.width||st.bottom>s.scale.height,"
                "hintOut:hn.right>s.scale.width||hn.bottom>s.scale.height});"
            )
            for tier in (0, 1, 2):
                await ev(c, f"s.hudTier={tier};s.rebuildHud();return '1';")
                await asyncio.sleep(0.35)
                r = await ev(c, LAYOUT_JS)
                tag = f"第{tier + 1}档(k={r.get('k')})"
                # 先确认测量本身没失败。否则 getBounds() 抛异常时下面全是 None，
                # `not None == True` 会让每一条都"通过" —— 假绿灯比红灯更危险。
                ok(f'HUD{tag}：布局测量成功（getBounds 可用）', not r.get('err'), str(r)[:120])
                if r.get('err'):
                    continue
                ok(f'HUD{tag}：目标条没有压在左上角武将面板上',
                   not r.get('objHitPanel'), f"obj={r.get('obj')} panel={r.get('panel')}")
                ok(f'HUD{tag}：目标进度条没有压在武将面板上',
                   not r.get('barHitPanel'), f"bar={r.get('bar')}")
                ok(f'HUD{tag}：目标文字没有超出画布右边界',
                   not r.get('objPastRight'), f"obj={r.get('obj')} w={r.get('w')}")
                ok(f'HUD{tag}：目标进度条右端没有超出画布',
                   not r.get('barPastRight'), f"bar={r.get('bar')} w={r.get('w')}")
                ok(f'HUD{tag}：计谋槽完整在画布内',
                   not r.get('stratOut'), f"strat={r.get('strat')} h={r.get('h')}")
                ok(f'HUD{tag}：底部提示没有超出画布',
                   not r.get('hintOut'), f"hint={r.get('hint')}")

            # 目标条不该和右上角的计时块叠在一起（同一条竖线上的两块信息）
            r = await ev(c, "s.hudTier=0;s.rebuildHud();return '1';")
            await asyncio.sleep(0.3)
            r = await ev(c,
                         "const all=[];const walk=o=>{if(!o)return;if(o.type)all.push(o);"
                         "if(o.list)o.list.forEach(walk);};s.children.list.forEach(walk);"
                         "const tp=all.find(o=>o.type==='Rectangle'&&o.depth===99"
                         "&&Math.round(o.originX)===0&&o.width>90&&o.width<200);"
                         "const ob=s.objText.getBounds();const b=tp?tp.getBounds():null;"
                         "const inter=(a,b)=>!!a&&!!b&&!(a.right<=b.left||b.right<=a.left"
                         "||a.bottom<=b.top||b.bottom<=a.top);"
                         "return JSON.stringify({hit:inter(ob,b),"
                         "tp:b?[Math.round(b.left),Math.round(b.right),Math.round(b.bottom)]:null,"
                         "ob:[Math.round(ob.top),Math.round(ob.left),Math.round(ob.right)]});")
            ok('HUD：目标条没有压在右上角计时块上', not r.get('err') and not r.get('hit'), str(r))

            # ---------- 9) 特效抓拍通道（截图脚本逐发抓拍用的两条通道）----------
            #
            # 为什么"给截图工具用的代码"也要立断言：
            # 计谋特效是**有时长**的（火墙活 4 秒），逐个拍六个计谋时上一发的残留会盖在
            # 下一发的照片上 —— 实测 fx-4-十面埋伏.png 里拍到的是 fx-1 火计的火墙。
            # 而这种代码最容易**悄悄半坏**：清了贴图却没清火墙的结算 Zone，
            # 画面看着干净了、火还在烧，静态断言一条都查不出来。
            #
            # 放在最后跑：fxRing 会凭空摆一圈敌人，不能让它干扰上面的 HUD / 计谋断言。
            r = await ev(c,
                         "return JSON.stringify({clear:typeof s.fxClear,"
                         "ring:typeof s.fxRing});")
            ok('截图通道：场景暴露了 fxClear / fxRing',
               r.get('clear') == 'function' and r.get('ring') == 'function', str(r))

            r = await ev(c,
                         "const tag=o=>{try{return !!(o.getData&&o.getData('fx')===1)}"
                         "catch(e){return false}};"
                         "s.invuln=9999999;"
                         "s.stratagem={id:'fire',name:'火计',quote:'',kind:'burst',cdSec:22};"
                         "s.stratCd=0;s.castStratagem();"
                         "const zs=s.children.list.filter(o=>o.type==='Zone'&&tag(o));"
                         "const n1=s.children.list.filter(tag).length;"
                         "s.fxClear();"
                         "const n2=s.children.list.filter(tag).length;"
                         "const z2=zs.filter(o=>o.active&&!!o.scene).length;"
                         "return JSON.stringify({n1:n1,n2:n2,z1:zs.length,z2:z2});")
            ok('特效清场：火计放完后场上确实有带 fx 标记的对象（有东西可清）',
               (r.get('n1') or 0) >= 5, str(r))
            ok('特效清场：fxClear 之后一个 fx 对象都不剩',
               r.get('n2') == 0, str(r))
            ok('特效清场：火墙的结算 Zone 也被清掉（只清贴图 = 画面干净但还在烧）',
               (r.get('z1') or 0) >= 1 and (r.get('z2') or 0) == 0, str(r))

            r = await ev(c,
                         "const act=()=>s.enemies.getChildren().filter(e=>e.active).length;"
                         "const before=act();"
                         "s.fxRing(14,125);"
                         "const near=s.enemies.getChildren().filter(e=>e.active"
                         "&&Math.hypot(e.x-s.player.x,e.y-s.player.y)<190).length;"
                         "return JSON.stringify({before:before,after:act(),near:near});")
            ok('截靶通道：fxRing 真的把一圈敌人摆到了玩家身边',
               (r.get('after') or 0) - (r.get('before') or 0) >= 10
               and (r.get('near') or 0) >= 10, str(r))

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()

    bad = [n for n, v in results if not v]
    print()
    print(f'--- {len(results) - len(bad)}/{len(results)} 通过 ---')
    for n in bad:
        print('   失败:', n)
    sys.exit(1 if bad else 0)


def run():
    # 前后端都必须在本进程周期内起 —— 见文件头说明
    with stack(backend=True, front=True):
        asyncio.run(main())


if __name__ == '__main__':
    run()
