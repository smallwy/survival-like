#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V6.10 五项修复的无头实机验证（CDP，无第三方浏览器驱动）

验证对象（对应本轮五项改动）：
  ① 去掉飘字底板   —— drawFloats 里不再有 fillRoundedRect，只有文字+ 描边
  ② 取消敌人小血条 —— drawEnemyHpBar 已删除，敌人身上无横条
  ③炮塔圆形布局   —— 座圈 6 座固定角度（±30/±90/±150），相邻弦长 > 2×塔半径
  ④ 商店梳理       —— 卡面描述折行不溢出、锁按钮独立、顶栏有鱼骨胶囊
  ⑤ 打击/击杀特效  —— shocks 数组在跑，命中出圈、击杀出双色双圈 + 闪核

为什么必须实机跑而不是只看代码：
本轮改的全是**绘制层**。绘制层的 bug（画错位置、盖住别的元素、
数组每帧暴涨）在tsc 里全部是绿的，只有把游戏跑起来、把数组读出来、
把截图拍下来才能确认。

用法：
  cd web && npx vite preview --port 4173 &
  python tools/verify_v610.py
截图输出到 tools/shots/
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)
PORT = int(os.environ.get("CDP_PORT", "9334"))
URL = os.environ.get("GAME_URL", "http://127.0.0.1:4173/")
W, H = 1280, 800

CHROME = None
for p in [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    shutil.which("chromium") or "",
    shutil.which("google-chrome") or "",
    "/usr/bin/chromium",
]:
    if p and os.path.exists(p):
        CHROME = p
        break
if not CHROME:
    sys.exit("未找到 Chrome / Edge / Chromium")


def wait_cdp(timeout=25):
    """连page 级 endpoint。浏览器级只支持 Target.*，发Page.enable 会报not found。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(timeout * 4):
        try:
            with opener.open(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page":
                        return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.25)
    raise SystemExit("CDP 未就绪")


class Cdp:
    def __init__(self, ws_url):
        import websocket
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.i = 0

    def call(self, method, params=None):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.i:
                return m

    def ev(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("result", {}).get("value")

    def shot(self, name):
        r = self.call("Page.captureScreenshot", {"format": "png"})
        p = os.path.join(OUT, name + ".png")
        with open(p, "wb") as f:
            f.write(base64.b64decode(r["result"]["data"]))
        print(f"  截图 -> {os.path.relpath(p)}")
        return p

    def key(self, key, code, vk):
        for t in ("keyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {
                "type": t, "key": key, "code": code,
                "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk,
            })

    def hold(self, key, code, vk, sec):
        self.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": key, "code": code,
                                             "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})
        time.sleep(sec)
        self.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": code,
                                             "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk})


def main():
    ud = os.path.join(tempfile.gettempdir(), "wb_cdp_v610")
    shutil.rmtree(ud, ignore_errors=True)
    os.makedirs(ud, exist_ok=True)
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--hide-scrollbars", "--mute-audio",
        "--remote-allow-origins=*",
        f"--user-data-dir={ud}", f"--remote-debugging-port={PORT}",
        f"--window-size={W},{H}", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    results = {}
    try:
        c = Cdp(wait_cdp())
        c.call("Page.enable")
        c.call("Runtime.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", {"source":
            "window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));"
            "window.addEventListener('unhandledrejection',e=>window.__errs.push('reject:'+e.reason));"})
        c.call("Page.navigate", {"url": URL})
        for i in range(60):
            if c.ev("!!window.__sg"):
                break
            time.sleep(0.5)
        else:
            print("!!! __sg 未出现；errs =", c.ev("window.__errs"))
            return
        print(f"Phaser 就绪~{i*0.5:.1f}s")

        # ---------- ① 标题 → 下潜 ----------
        c.key("Enter", "Enter", 13)
        time.sleep(1.5)
        print("活动场景:", c.ev("__sg.scene.getScenes(true).map(s=>s.scene.key)"))
        c.shot("v610-01_开局")

        # ---------- 装满6 座，验证座圈全展开 ----------
        # 直接改场景状态比一张张买卡快得多，也保证一次能拍到 6 座满编。
        c.ev("(()=>{const s=__sg.scene.getScene('dive');"
             "s.maxWeapons=6;"
             "s.addWeapon('gun');s.addWeapon('torpedo');"
             "s.addWeapon('arc');s.addWeapon('gun');s.addWeapon('sonar');"
             "return 'ok'})()")
        time.sleep(0.6)
        plan = c.ev("(()=>{const s=__sg.scene.getScene('dive');"
                    "const p=s.mountPlan();"
                    "return p.map((x,i)=>({i:i,deg:Math.round(x.ang*180/Math.PI),ext:x.ext}))})()")
        print("座圈分配:", plan)
        results['seatPlan'] = plan
        seats_ok = (len(plan) == 6
                    and [p['deg'] for p in plan] == [30, -30, 90, -90, 150, -150]
                    and [p['ext'] for p in plan] == [False]*4 + [True]*2)
        results['③座圈角度固定且扩容座标记正确'] = seats_ok

        # ---------- 炮塔位姿：弹必须从座圈出，不能从机体中心出 ----------
        # 这是本轮用户第 1 条的核心诉求「子弹弹射出去很清晰」。
        # 旧实现里 bullets 和 muzzle flash 都用 this.px/this.py，
        # 炮画在半径 40 的座圈上、弹从机体正中心冒，视觉上完全对不上。
        # 判据：turretPose(i) 到机体的距离必须 ≈ SEAT_RING_R(40)，
        # 且方向必须等于该座位角度（把机体朝向 aim 转成世界角）。
        pose = c.ev(
            "(()=>{const s=__sg.scene.getScene('dive');"
            "const out=[];"
            "for(let i=0;i<s.weapons.length;i++){"
            "  const p=s.turretPose(i);"
            "  if(!p){out.push(null);continue;}"
            "  const d=Math.hypot(p.x-s.px,p.y-s.py);"
            "  const a=Math.atan2(p.y-s.py,p.x-s.px);"
            "  out.push({d:Math.round(d),a:Math.round(a*180/Math.PI),"
            "rel:Math.round((a-s.aim)*180/Math.PI)});}"
            "return out})()")
        print("炮塔位姿(距机体/世界角/相对艇身角):", pose)
        seat_degs = [30, -30, 90, -90, 150, -150]
        aim_deg = c.ev("(()=>{const s=__sg.scene.getScene('dive');"
                       "return Math.round(s.aim*180/Math.PI)})()")
        pose_ok = (isinstance(pose, list) and len(pose) == 6
                   and all(p is not None and 38 <= p['d'] <= 42 for p in pose)
                   and all(p['rel'] == seat_degs[i] for i, p in enumerate(pose)))
        print(f"  （机体朝向 {aim_deg}°，期望相对角 {seat_degs}）")
        results['③弹从座圈出（turretPose 几何正确）'] = pose_ok

        # ---------- 打一会儿，看战斗中的特效 ----------
        # 走位 2.4s 后**立刻**开始采样，不要中间再 sleep。
        # 踩过的坑：中间 sleep 4s 之后，6 座齐射已经把第 1 波 22 只清完、
        # phase 变成 shop，采样窗口里一场战斗都没有 ——
        # 于是"击打痕/冲击波峰值=0"被误报成 FAIL，其实代码是好的。
        # 特效生命期只有 0.10~0.32s，采样必须贴着战斗进行。
        for k, code, vk in [("KeyD", "KeyD", 68), ("KeyS", "KeyS", 83)]:
            c.hold(k, code, vk, 1.2)

        # 三个新件（击打痕 / 弹出身点 / 冲击波）必须在**同一个采样循环**里看。
        # 分成两个循环时，第一个循环打了 3 下、第二个循环敌人已出射程，
        # 会得到"击打痕峰值=3 但冲击波峰值=0"——两者明明在 hurt() 里
        # 相邻两行触发，看起来像 bug，其实是采样窗口错开。
        spawn_d_min, slash_peak, shock_peak = 9999, 0, 0
        diag = {}
        for _ in range(200):
            r = c.ev(
                "(()=>{const s=__sg.scene.getScene('dive');"
                "let dm=9999;"
                "for(const b of s.bullets){"
                "  const d=Math.hypot(b.x-s.px,b.y-s.py);"
                "  if(d<dm)dm=d;}"
                "let ne=99999;"
                "for(const e of s.enemies){"
                "  const d=Math.hypot(e.x-s.px,e.y-s.py);"
                "  if(d<ne)ne=d;}"
                "return {dm:dm,sl:s.slashes.length,sh:s.shocks.length,"
                "ph:s.phase,en:s.enemies.length,ne:Math.round(ne),"
                "px:Math.round(s.px),py:Math.round(s.py),"
                "bul:s.bullets.length,pul:s.pulses.length}})()")
            if isinstance(r, dict):
                spawn_d_min = min(spawn_d_min, r.get('dm', 9999) or 9999)
                slash_peak = max(slash_peak, r.get('sl', 0) or 0)
                shock_peak = max(shock_peak, r.get('sh', 0) or 0)
                diag = r
            time.sleep(0.02)
        print(f"弹出生点到机体中心最近距离: {spawn_d_min:.0f}px")
        print(f"击打痕峰值: {slash_peak}（上限 40）  冲击波峰值: {shock_peak}（上限 48）")
        print("最后一帧诊断:", diag)
        # 阈值取 20 而不是 55：炮口探出沿**炮塔朝向**（±70° 限幅）而非沿径向，
        # 出生点到机心的距离在 40−14.7=25.3 ~ 40+14.7=54.7 之间浮动。
        # 判据要表达的是"不是从机体中心出"（中心出≈0），
        # 20 是唯一能同时容纳 25.3 与"中心出≈0"的分界。
        results['⑤弹从炮塔出（不是机体中心）'] = spawn_d_min >= 20
        results['⑤击打痕在运行'] = slash_peak > 0
        results['⑤击打痕未超上限'] = slash_peak <= 40
        results['⑤冲击波在运行'] = shock_peak > 0
        results['⑤冲击波峰值未超上限'] = shock_peak <= 48

        st = c.ev("(()=>{const s=__sg.scene.getScene('dive');return {"
                  "phase:s.phase,enemies:s.enemies.length,o2:Math.round(s.o2),"
                  "sparks:s.sparks.length,floats:s.floats.length,"
                  "weapons:s.weapons.length,bank:s.bank}})()")
        print("战斗状态:", st)
        c.shot("v610-02_战斗_炮塔座圈")
        results['⑤粒子未失控'] = isinstance(st, dict) and st.get('sparks', 0) <= 220

        # ---------- ② 敌人无血条 ----------
        # 直接查代码里还有没有画血条的调用点 —— 有就说明漏删了。
        hpbar = c.ev("(()=>{const s=__sg.scene.getScene('dive');"
                     "return typeof s.drawEnemyHpBar})()")
        print("drawEnemyHpBar:", hpbar)
        results['②敌人血条函数已删除'] = hpbar == 'undefined'

        # ---------- ①飘字无底板 ----------
        # 飘字数量为 0 时无法验证；先确保有飘字（击杀回氧/伤害数）
        c.ev("(()=>{const s=__sg.scene.getScene('dive');"
             "s.spawnFloat(s.px,s.py,'测试飘字',0xffffff,20);"
             "s.spawnFloat(s.px+40,s.py,'-42',0xff2e63,14);return 'ok'})()")
        time.sleep(0.05)
        c.shot("v610-03_飘字_无底板")
        fcount = c.ev("(()=>{const s=__sg.scene.getScene('dive');return s.floats.length})()")
        results['①飘字系统仍在运行'] = (fcount or 0) > 0
        print("飘字数量:", fcount)

        # ---------- ④ 商店 ----------
        # 直接推进到商店相位：把剩余刷怪清零就会advance → openShop
        c.ev("(()=>{const s=__sg.scene.getScene('dive');"
             "s.spawnLeft=0;s.enemies.forEach(e=>e.alive=false);"
             "s.enemies=[];return 'ok'})()")
        time.sleep(1.2)
        sh_phase = c.ev("(()=>{const s=__sg.scene.getScene('dive');return s.phase})()")
        print("商店相位:", sh_phase)
        results['④能进入商店'] = sh_phase == 'shop'
        c.shot("v610-04_商店_默认")

        # 展开侧栏（页签）
        c.key("Tab", "Tab", 9)
        time.sleep(0.6)
        info = c.ev("(()=>{const s=__sg.scene.getScene('dive');return s.shopInfoOpen})()")
        print("侧栏展开:", info)
        results['④侧栏页签可切换'] = info == True
        c.shot("v610-05_商店_侧栏展开")
        c.key("Tab", "Tab", 9)
        time.sleep(0.4)

        # 商店 UI 审计：描述是否溢出卡宽
        # ⚠️ 判据必须是「文字包围盒的中心落在卡内」。
        # 只比边界会把紧邻卡的元素（顶栏提示行、底栏按钮）全算进来 ——
        # 上一版误报「继续·下一波」越界 43px，那其实是底栏按钮，不是卡内文字。
        # 「溢出」要表达的是"属于这张卡的内容跑到卡外"，
        # 所以先用中心归属把卡内文字筛出来，再量它伸出卡外多少。
        overflow = c.ev(
            "(()=>{const s=__sg.scene.getScene('dive');"
            "const out=[];"
            "for(const n of s.ui){"
            "  if(n.kind!=='text'||n.cat==='float')continue;"
            "  for(const c of s.shopCards){"
            "    const ccx=n.x+n.w/2, ccy=n.y+n.h/2;"
            "    if(ccx<c.x||ccx>c.x+c.w||ccy<c.y||ccy>c.y+c.h)continue;"
            # 溢出 = 盒子伸出卡外的那部分（四个方向各自算，正值才算溢出）。
            # 注意符号：n.x - c.x 是「距左边多远」，往左溢出才是 c.x - n.x。
            # 上一版把两者写反，于是每张卡的每行文字都被报成「溢出 20~294px」。
            "    const right=n.x+n.w-(c.x+c.w), bot=n.y+n.h-(c.y+c.h);"
            "    const left=c.x-n.x, top=c.y-n.y;"
            "    const ov=Math.max(right,bot,left,top);"
            "    if(ov>2)out.push({t:n.text,ov:Math.round(ov),size:n.size});"
            "    break;}}"
            "return out})()")
        print("卡内文字溢出:", overflow if overflow else "无")
        results['④卡面文字无溢出'] = not overflow

        sizes = c.ev(
            "(()=>{const s=__sg.scene.getScene('dive');"
            "const bad=s.ui.filter(n=>n.kind==='text'&&n.cat!=='float'&&n.size<12)"
            ".map(n=>n.text+'@'+n.size+'px');return bad})()")
        print("小于 12px 的文字:", sizes if sizes else "无")
        results['④商店无小于 12px 的文字'] = not sizes

        # 商店整体是否在视口内（V6.10 修的核心 bug：小窗时顶栏/底栏被裁掉）
        inView = c.ev(
            "(()=>{const s=__sg.scene.getScene('dive');"
            "const W=s.scale.width,H=s.scale.height;"
            "const bs=[s.rerollBtnRect,s.leaveBtnRect].filter(Boolean);"
            "const r={W:W,H:H,"
            "cardTop:Math.round(Math.min(...s.shopCards.map(c=>c.y))),"
            "cardBot:Math.round(Math.max(...s.shopCards.map(c=>c.y+c.h))),"
            "btnTop:Math.round(Math.min(...bs.map(b=>b.y))),"
            "btnBot:Math.round(Math.max(...bs.map(b=>b.y+b.h)))};"
            "r.ok=r.cardTop>=0&&r.btnBot<=H&&r.cardBot<=r.btnTop;"
            "return r})()")
        print("视口适配:", inView)
        results['④商店完整落在视口内'] = bool(inView.get('ok'))

        # 卡内分区互不重叠 —— V6.10 踩过的最隐蔽的一个坑。
        # 现象：ch 一变，链式偏移（footY = descY0 + 60）跟着漂，
        # 状态行直接压在价格底板上；tsc 全绿、数组审计也全绿，
        # 只有像素比对看得出来。所以这里逐帧取卡内文字包围盒，
        # 断言「不同分区之间没有纵向交叠」。
        overlap = c.ev(
            "(()=>{const s=__sg.scene.getScene('dive');"
            "const rows=s.ui.filter(n=>n.kind==='text'&&n.cat!=='float');"
            "const bad=[];"
            "for(const c of s.shopCards){"
            "  const inCard=rows.filter(n=>{"
            "    const x=n.x+n.w/2,y=n.y+n.h/2;"
            "    return x>c.x&&x<c.x+c.w&&y>c.y&&y<c.y+c.h});"
            "  for(let i=0;i<inCard.length;i++){"
            "    for(let j=i+1;j<inCard.length;j++){"
            "      const a=inCard[i],b=inCard[j];"
            "      const ovY=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);"
            "      const ovX=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);"
            "      if(ovY>3&&ovX>3)bad.push({a:a.text.slice(0,8),b:b.text.slice(0,8),"
            "ov:Math.round(ovY)});}}}"
            "return bad.slice(0,8)})()")
        print("卡内文字交叠:", overlap if overlap else "无")
        results['④卡内分区无重叠'] = not overlap

        # 锁按钮与价格行不再重叠
        lockpos = c.ev(
            "(()=>{const s=__sg.scene.getScene('dive');"
            "const b=s.shopBtns.filter(x=>x.w===62&&x.h===26);"
            "return b.map(x=>({x:Math.round(x.x),y:Math.round(x.y)}))})()")
        print("锁定按钮位置(应全在卡顶 y≈y0+14):", lockpos)
        cardy = c.ev("(()=>{const s=__sg.scene.getScene('dive');"
                     "return s.shopCards.map(c=>Math.round(c.y))})()")
        ok_lock = bool(lockpos) and all(
            abs(lp['y'] - (cy + 14)) <= 2 for lp in lockpos for cy in cardy[:len(lockpos)])
        results['④锁按钮独立在卡顶'] = ok_lock

        # 买一张卡，验证交易链路没被布局改动打断。
        # 必须先把钱给足：默认 bank 可能不够买第一张卡，
        # 而 buyCard 的设计就是「钱不够静默返回」——
        # 上一版没给钱就断言 sold[0]，拿到的是"钱不够所以没买"的假失败。
        before = c.ev("(()=>{const s=__sg.scene.getScene('dive');s.bank=500;return s.bank})()")
        c.key("1", "Digit1", 49)
        time.sleep(0.5)
        after = c.ev("(()=>{const s=__sg.scene.getScene('dive');"
                     "return {bank:s.bank,sold:s.sold.slice(),weapons:s.weapons.length,"
                     "maxW:s.maxWeapons,o2:Math.round(s.o2)}})()")
        print(f"购买：bank {before} -> {after}")
        bought = (isinstance(after, dict) and after.get('sold', [None])[0] is True
                  and after.get('bank', 999) < 500)
        results['④买卡链路正常'] = bought
        c.shot("v610-06_商店_已购入")

        # ---------- 收尾：JS 异常 ----------
        errs = c.ev("window.__errs")
        print("JS 异常:", errs if errs else "无")
        results['无 JS 异常'] = not errs

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()

    print("\n=========== V6.10 验收结果 ===========")
    npass = 0
    for k, v in results.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
        npass += 1 if v else 0
    print(f"  {npass}/{len(results)} 通过")
    print("======================================")


if __name__ == "__main__":
    main()