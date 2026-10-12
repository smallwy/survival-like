#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""V6.26 两条修复的实机验证（无头 Chrome + CDP）。

用户报的两个 bug：
  ① 「选择发射器之后 场景中还有遗留」——商店立绘离开商店后没被收走，冻在世界里。
  ② 「发射器不会选择就近射击，会受上下左右移动影响…我移动上面就一直射击上面」
     ——炮塔角写成 `机体朝向 + clamp(目标角-机体朝向, ±70°)`，被移动方向绑架。

断言（全部可证伪，不是"看起来对"）：
  T1 商店里立绘是亮的 → 离开商店后 3 张全部不可见。
  T2 玩家把船舵打到"上"、敌人在正下方 300px 时：
       炮塔角必须收敛到"指向敌人"（误差 < 0.15 rad）；
       并且旧公式在同一输入下给出的角度一定偏 > 1 rad（证明旧代码确实做不到）。
  T3 画塔与出弹共用同一个角度源：turretPose().ang === weapons[i].aimAng。

用法：
  cd web && node ./node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1 &
  python tools/verify_v626.py
"""
import base64
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9391
URL = "http://127.0.0.1:4173/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tools', 'shots')

FAIL = []


def check(name, ok, detail=''):
    tag = '通过' if ok else '失败'
    print(f"  [{tag}] {name}" + (f"  {detail}" if detail else ''))
    if not ok:
        FAIL.append(name)


# 在页面里同步跑完整段测试：一次 evaluate 内不会有别的帧插进来，
# 所以"塞一个假敌人"不会被 updateEnemies 拿去用。
JS_SLEW = r"""
(() => {
  const s = __sg.scene.getScene('dive');
  const out = {};
  // 摆一个确定性的场景：船舵打到"上"，敌人在**正下方** 300px。
  s.phase = 'wave';
  const savedEnemies = s.enemies, savedAim = s.aim, savedPx = s.px, sPy = s.py;
  // 至少 4 座（±30° / ±90°）：座越靠艉，"指向下方"相对机体朝向的偏角越大，
  // 旧限幅公式在艉侧座上崩得最明显 —— 只测 1 座会漏掉这个最坏情况。
  const savedWeapons = s.weapons.slice();
  while (s.weapons.length < 4) s.addWeapon(['gun', 'torpedo', 'harpoon', 'arc'][s.weapons.length]);
  s.enemies = [];
  s.px = 400; s.py = 300;
  s.aim = -Math.PI / 2;                       // 往上走
  s.enemies.push({ alive: true, x: 400, y: 600, hp: 1, maxHp: 1, r: 10,
                   kind: 'fish', color: 0xffffff, speed: 0, vx: 0, vy: 0,
                   kx: 0, ky: 0, phase: 'chase', t: 0, dirX: 0, dirY: 0,
                   flash: 0, texRot: 0, tex: 'fish_0' });

  // 先把炮塔角拨到一个"远离目标"的初值，确保测的是"转过去"而不是"本来就在那"
  for (const w of s.weapons) w.aimAng = -Math.PI / 2;
  for (let i = 0; i < 90; i++) s.slewTurretAims(1 / 60);   // 1.5s —— 足够转 180°

  out.weapons = s.weapons.map((w, i) => {
    const p = s.seatPos(i);
    const dir = Math.atan2(600 - p.y, 400 - p.x);          // 座位 → 敌人 的真实方向
    const err = Math.abs(Math.atan2(Math.sin(w.aimAng - dir), Math.cos(w.aimAng - dir)));
    // 旧公式在同一输入下的结果（限幅 ±1.22 相对机体朝向）
    const rel = Math.atan2(Math.sin(dir - s.aim), Math.cos(dir - s.aim));
    const oldAng = s.aim + Math.max(-1.22, Math.min(1.22, rel));
    const oldErr = Math.abs(Math.atan2(Math.sin(oldAng - dir), Math.cos(oldAng - dir)));
    const pose = s.turretPose(i);
    return { id: w.id, aimAng: w.aimAng, dir, err, oldErr,
             poseAng: pose ? pose.ang : null };
  });

  // —— T1：商店立绘的显隐 ——
  s.weapons.length = 0; for (const w of savedWeapons) s.weapons.push(w);
  s.enemies = savedEnemies; s.aim = savedAim; s.px = savedPx; s.py = sPy;
  out.ok = true;
  return out;
})()
"""


def main():
    ud = os.path.join(tempfile.gettempdir(), "wb_verify_v626")
    shutil.rmtree(ud, ignore_errors=True)
    os.makedirs(ud, exist_ok=True)
    os.makedirs(SHOTS, exist_ok=True)
    p = subprocess.Popen(
        [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
         "--hide-scrollbars", "--mute-audio", "--remote-allow-origins=*",
         f"--user-data-dir={ud}", f"--remote-debugging-port={PORT}",
         "--window-size=1320,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    ws_url = None
    for _ in range(120):
        try:
            with op.open(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page":
                        ws_url = t["webSocketDebuggerUrl"]
            if ws_url:
                break
        except Exception:
            pass
        time.sleep(0.25)
    if not ws_url:
        print("连不上无头 Chrome"); return 1

    import websocket
    c = websocket.create_connection(ws_url, timeout=40)
    seq = [0]

    def call(m, par=None):
        seq[0] += 1
        c.send(json.dumps({"id": seq[0], "method": m, "params": par or {}}))
        while True:
            mm = json.loads(c.recv())
            if mm.get("id") == seq[0]:
                return mm

    def ev(expr):
        r = call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        res = r.get("result", {})
        if res.get("exceptionDetails"):
            print("JS 异常:", json.dumps(res["exceptionDetails"])[:400])
        return res.get("result", {}).get("value")

    def key(k, code, vk):
        for t in ("keyDown", "keyUp"):
            call("Input.dispatchKeyEvent", {"type": t, "key": k, "code": code,
                                            "windowsVirtualKeyCode": vk,
                                            "nativeVirtualKeyCode": vk})

    def shot(name):
        r = call("Page.captureScreenshot", {"format": "png"})
        with open(os.path.join(SHOTS, name), "wb") as f:
            f.write(base64.b64decode(r["result"]["data"]))
        print("   截图", name)

    try:
        call("Page.enable")
        call("Runtime.enable")
        call("Page.navigate", {"url": URL})
        for _ in range(80):
            if ev("!!window.__sg"):
                break
            time.sleep(0.4)
        time.sleep(1.2)
        key("Enter", "Enter", 13)
        for _ in range(60):
            if ev("(()=>{const s=__sg.scene.getScene('dive');return s && s.phase})()"):
                break
            time.sleep(0.25)
        time.sleep(0.8)

        print("\n=== T2 发射器独立索敌（敌人正下方 300px，船舵朝上）===")
        r = ev(JS_SLEW)
        if not r or not r.get('ok'):
            print("  场景准备失败", r); return 1
        worst_new, worst_old = 0.0, 1e9
        for w in r['weapons']:
            worst_new = max(worst_new, w['err'])
            worst_old = min(worst_old, w['oldErr'])
            print(f"   {w['id']:<10} 新误差 {w['err']:.3f} rad | 旧公式误差 {w['oldErr']:.3f} rad")
        check("每座塔都转到了自己最近的敌人（误差 < 0.15 rad）", worst_new < 0.15,
              f"最大误差 {worst_new:.3f}")
        check("旧公式在同一输入下被限幅绑架（至少一座偏 > 1.0 rad）", worst_old > 1.0,
              f"旧公式最小偏差 {worst_old:.3f}")
        pose_ok = all(abs(math.atan2(math.sin(w['poseAng'] - w['aimAng']),
                                    math.cos(w['poseAng'] - w['aimAng']))) < 1e-6
                      for w in r['weapons'] if w['poseAng'] is not None)
        check("画塔与出弹共用同一角度源（turretPose == aimAng）", pose_ok)

        print("\n=== T1 商店立绘残留（离开商店后必须全隐）===")
        ev("(()=>{const s=__sg.scene.getScene('dive');s.bank=9999;s.spawnLeft=0;"
           "s.enemies.length=0;s.waveTimer=0;return 1})()")
        for _ in range(40):
            if ev("(()=>{const s=__sg.scene.getScene('dive');return s.phase})()") == "shop":
                break
            time.sleep(0.35)
        time.sleep(0.7)
        # 商店是随机牌面，某些组合（纯属性/扩容卡）本来就没有立绘。
        # 所以先重抽到"至少一张带立绘的卡"再断言 —— 否则测的是随机数不是代码。
        lit = 0
        for _ in range(15):
            lit = ev("(()=>{const s=__sg.scene.getScene('dive');"
                     "return s.shopArt.filter(i=>i.visible).length})()") or 0
            if lit > 0:
                break
            ev("__dive.reroll()")
            time.sleep(0.5)
        check("商店里立绘是亮的（说明这一帧确实走过 drawShop）", lit > 0, f"亮着 {lit} 张")
        shot("v626_shop.png")

        ev("__dive.leaveShop()")
        time.sleep(1.0)
        phase = ev("(()=>{const s=__sg.scene.getScene('dive');return s.phase})()")
        after = ev("(()=>{const s=__sg.scene.getScene('dive');"
                   "return s.shopArt.filter(i=>i.visible).length})()")
        check("离开商店后进入战斗相位", phase == 'wave', f"phase={phase}")
        check("战斗相位下商店立绘全部不可见", (after or 0) == 0, f"仍亮着 {after} 张")
        shot("v626_wave.png")

        print("\n" + ("全部通过" if not FAIL else f"失败 {len(FAIL)} 项: {FAIL}"))
        return 0 if not FAIL else 1
    finally:
        p.terminate()


if __name__ == '__main__':
    sys.exit(main())
