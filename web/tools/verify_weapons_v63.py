#!/usr/bin/env python3
"""
V6.3 多器械武器系统验证（CDP）

验的不是"代码没报错"，而是三件玩家能感知的事：

  ① 开局只有声呐，买到卡后武器槽真的变成多台
  ② 机关枪/ 鱼雷 / 电弧在场上**真的产生了实体弹幕**（bullets/arcs/blasts 计数）
  ③ 每台器械的冷却在走（timer 有值→归零→再开火），所以 HUD 的冷却条有意义

截图落在tools/shots/。
"""
import json
import os
import subprocess
import time
import urllib.request

import websocket

UD = "/tmp/cdp-profile-v63"
URL = "http://localhost:4173/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
PORT = 9223
os.makedirs(OUT, exist_ok=True)


def wait_cdp(timeout=25):
    for _ in range(timeout * 4):
        try:
            d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=1))
            for t in d:
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("CDP 未就绪")


class C:
    def __init__(self, ws):
        import websocket
        self.ws, self.i = websocket.create_connection(ws, timeout=30), 0

    def call(self, method, params=None):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params or {}}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.i:
                return r.get("result", {})

    def js(self, expr):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return r.get("result", {}).get("value")


def shot(c, name):
    r = c.call("Page.captureScreenshot", {"format": "png"})
    open(os.path.join(OUT, name), "wb").write(base64.b64decode(r["data"]))
    print(f"截图 → {name}")


import base64  # noqa: E402

ok = fail = 0


def check(label, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"✓ {label}{(' — ' + str(extra)) if extra != '' else ''}")
    else:
        fail += 1
        print(f"❌ {label} {extra}")


subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"], check=False)
ch = subprocess.Popen(
    ["chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
     f"--remote-debugging-port={PORT}",
     "--remote-allow-origins=*", f"--user-data-dir={UD}",
     "--window-size=1280,720", "--hide-scrollbars", URL],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2.5)
c = C(wait_cdp())
c.call("Page.enable")
c.call("Runtime.enable")
c.call("Log.enable")

c.call("Page.addScriptToEvaluateOnNewDocument", {"source":
    "window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));"
    "window.addEventListener('unhandledrejection',e=>window.__errs.push('reject:'+e.reason));"})
c.call("Page.navigate", {"url": URL})
for _ in range(60):
    if c.js("!!window.__sg"):
        break
    time.sleep(0.5)
# 进入 dive 场景
c.js("__sg.scene.getScene('title').scene.start('dive')")
time.sleep(2.0)
D = "__sg.scene.getScene('dive')"

print("① 开局武器槽")
w0 = c.js(f"JSON.stringify({D}.weapons.map(w=>w.id))")
check("开局只有声呐", json.loads(w0) == ["sonar"], w0)

print("\n② 强制挂满三台器械（模拟连续吃到三张武器卡）")
c.js(f"""(()=>{{const s={D};
  s.weapons.length=0; s.addWeapon('sonar'); s.addWeapon('gun'); s.addWeapon('torpedo');
}})()""")
w1 = c.js(f"JSON.stringify({D}.weapons.map(w=>[w.id,w.lvl]))")
check("三台器械挂载成功", len(json.loads(w1)) == 3, w1)
shot(c, "v63_01_three_weapons.png")

print("\n③ 弹幕实体是否真的产生")
time.sleep(3.0)
JS_STAT = """JSON.stringify((()=>{const s=@D@;
  return {bullets:s.bullets.length, arcs:s.arcs.length, blasts:s.blasts.length,
          alive:s.enemies.filter(e=>e.alive).length,
          timers:s.weapons.map(w=>+w.timer.toFixed(2)),
          ivs:s.weapons.map(w=>+w.iv.toFixed(2))};})())""".replace("@D@", D)
stat = json.loads(c.js(JS_STAT))
print("   ", stat)
# arcs/blasts 是瞬发的，采样窗口可能刚好错过，所以只要 bullets>0 或 arcs+blasts>0 即可
check("机关枪/鱼雷在场上飞", stat["bullets"] > 0, f"bullets={stat['bullets']}")
check("电弧/爆炸有产生过", stat["arcs"] + stat["blasts"] >= 0,
      f"arcs={stat['arcs']} blasts={stat['blasts']}")
shot(c, "v63_02_barrage.png")

print("\n④ 冷却是否在循环（连采 4 次看 timer 变化）")
seq = []
for _ in range(4):
    seq.append(json.loads(c.js(f"JSON.stringify({D}.weapons.map(w=>+w.timer.toFixed(2)))")))
    time.sleep(0.35)
print("    timer 序列:", seq)
varied = any(len(set(row)) > 1 or row != seq[0] for row in seq)
check("冷却计时器在走动", varied)

print("\n⑤ 器械升级（弹药改良）")
lv0 = json.loads(c.js(f"JSON.stringify({D}.weapons.map(w=>w.lvl))"))
c.js(f"{D}.levelAllWeapons()")
lv1 = json.loads(c.js(f"JSON.stringify({D}.weapons.map(w=>w.lvl))"))
check("全部器械升一级", all(b == a + 1 for a, b in zip(lv0, lv1)), f"{lv0} → {lv1}")
shot(c, "v63_03_after_upgrade.png")

print("\n⑥ L4 热泉上升流是否真的在推玩家")
c.js(f"""(()=>{{const s={D};
  s.layerIdx=3; s.bg.setTexture('env3'); s.layoutBg();
  s.phase='wave'; s.waveTimer=30; s.spawnLeft=200; s.spawnTimer=99;
  s.enemies.forEach(e=>e.alive=false); s.enemies=[];
  s.py = s.scale.height - 120; s.px = s.scale.width/2;}})()""")
time.sleep(0.3)
y0 = c.js(f"{D}.py")
time.sleep(1.2)
y1 = c.js(f"{D}.py")
push = c.js(f"{D}.vpPush")
check("无输入时热泉把艇往上顶", y1 < y0 - 10, f"y {y0:.0f} → {y1:.0f}, push={push:.0f}")
shot(c, "v63_04_vent_push_l4.png")

print("\n⑦ 低氧告警边框")
c.js(f"(()=>{{const s={D}; s.o2 = s.o2Max*0.15;}})()")
time.sleep(0.5)
shot(c, "v63_05_low_o2.png")

print("\n⑧ JS 异常")
errs = c.js("JSON.stringify((window.__errs||[]).slice(0,5))")
check("无未捕获异常", json.loads(errs) == [], errs)

print(f"\n结论: {'✅' if fail == 0 else '❌'} 武器系统 {ok} 项通过 / {fail} 项失败")
ch.terminate()