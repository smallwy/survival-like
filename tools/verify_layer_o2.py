#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V6.24 验收：① 氧气收支是否已经"稀缺化" ② 每层的节奏/机制是否真的不同

只做**数据断言**，不做"好不好玩"的判断 —— 那个只能人玩。
判据全部来自场景实例的实时状态（TS 的 private 只是编译期，运行期可读）。

跑法：
  cd web && node ./node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1 &
  python tools/verify_layer_o2.py
"""
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9382
URL = "http://127.0.0.1:4173/"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')

results = {}


def main():
    ud = os.path.join(tempfile.gettempdir(), "wb_vo")
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
        return r.get("result", {}).get("result", {}).get("value")

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

        # 必须真的按一次 Enter 进 dive —— 否则 create()/startRun() 没跑过，
        # 读到的全是字段默认值（踩过：layerCardT 恒为 0，误判成"层卡没播"）。
        key("Enter", "Enter", 13)
        time.sleep(0.9)
        # 层入场卡只在开局 2.6s 内存在，必须**立刻**读，不能等到第 ⑥ 节
        card0 = ev("(()=>{const s=__sg.scene.getScene('dive');return s.layerCardT})()")
        print("== ① 每层的节奏表与机制 ==")
        layers = ev(
            "(()=>{const s=__sg.scene.getScene('dive');const out=[];"
            "for(let i=0;i<5;i++){s.layerIdx=i;const L=s.layer();const Wv=s.waves();"
            "out.push({n:L.name,mech:L.mech,drain:L.drain,dropCap:L.dropCap,o2Max:L.o2Max,"
            "burns:Wv.reduce((a,w)=>a+w.dur,0),cnts:Wv.map(w=>w.count),durs:Wv.map(w=>w.dur),"
            "cur:L.current,pres:L.pressure,surge:L.surge});}"
            "s.layerIdx=0;return JSON.stringify(out)})()")
        layers = json.loads(layers)
        print("  %-8s %-5s %6s %6s %6s %8s %s" %
              ("层", "机制", "耗氧", "掉落", "自时长", "节奏(数量)", "时长分布"))
        for L in layers:
            print("  %-8s %-5s %6.2f %6d %6d   %-18s %s" %
                  (L['n'], L['mech'] or '—', L['drain'], L['dropCap'],
                   L['burns'], str(L['cnts']), str(L['durs'])))

        # ① 每层总时长必须 = 156s（否则氧气收支会跟着变）
        results['①各层总时长均为156s'] = all(L['burns'] == 156 for L in layers)
        # ② 节奏签名互不相同
        sigs = [tuple(L['cnts']) for L in layers]
        results['①五层节奏签名互不相同'] = len(set(sigs)) == 5
        # ③ 机制各不相同（L1 可以没有）
        mechs = [L['mech'] for L in layers]
        results['①各层机制不重复'] = len(set(mechs)) == 5

        print("\n== ② 氧气收支（全捡时的 供给/需求）==")
        print("  %-8s %8s %8s %8s" % ("层", "需求", "供给", "比值"))
        ratios = []
        for L in layers:
            need = L['drain'] * L['burns']
            # 一根普通鱼骨回氧 = max(2, round(3.0 * 30/18)) = 5；鱼骨币 = 7
            bones = L['dropCap'] / 7.0
            supply = bones * 5.0 * 4
            r = supply / need
            ratios.append(r)
            print("  %-8s %8.0f %8.0f %8.2f" % (L['n'], need, supply, r))
        print("  旧版对照：L1 1.79 → L5 1.37（供给过剩，所以没有犹豫）")
        results['②全捡比值均<1.5（已稀缺化）'] = all(r < 1.5 for r in ratios)
        results['②比值随深度单调递减'] = all(ratios[i] >= ratios[i + 1] - 0.02
                                        for i in range(len(ratios) - 1))
        # 判据是"连一个不漏都几乎不赚"（≤1.05），不是"必然亏" ——
        # 必然亏会变成数值死刑（打得好也活不下去），那就不是取舍了。
        results['②L5全捡也几乎不赚（≤1.05）'] = ratios[-1] <= 1.05

        print("\n== ③ 鱼骨回氧/鱼骨币已解耦 ==")
        bone = ev(
            "(()=>{const s=__sg.scene.getScene('dive');s.bones.length=0;"
            "s.enemies.length=0;for(let i=0;i<4;i++)s.spawnEnemy();"
            "const e=s.enemies[0];const r=Math.round(e.r);s.hurt(e,99999);"
            "return JSON.stringify({r:r,o2:s.bones.map(b=>b.o2),coin:s.bones.map(b=>b.coin)})})()")
        bone = json.loads(bone)
        print("  普通鱼 r=%d → 回氧 %s / 鱼骨币 %s（旧版回氧=7）"
              % (bone['r'], bone['o2'], bone['coin']))
        results['③鱼骨回氧已降到5'] = bool(bone['o2']) and bone['o2'][0] == 5
        results['③鱼骨币保持7（商店经济不变）'] = bool(bone['coin']) and bone['coin'][0] == 7

        print("\n== ④ L3 涌流：全部从同一侧涌入 ==")
        surge = ev(
            "(()=>{const s=__sg.scene.getScene('dive');s.layerIdx=2;s.surgeSide=3;"
            "s.enemies.length=0;for(let i=0;i<14;i++)s.spawnEnemy();"
            "const xs=s.enemies.map(e=>Math.round(e.x));"
            "return JSON.stringify({n:s.enemies.length,minX:Math.min.apply(null,xs),"
            "maxX:Math.max.apply(null,xs)})})()")
        surge = json.loads(surge)
        print("  surgeSide=3(左) → 敌人 x 范围 [%d, %d]，共 %d 只"
              % (surge['minX'], surge['maxX'], surge['n']))
        results['④涌流全部来自同一侧'] = surge['maxX'] <= 0 and surge['n'] >= 10

        print("\n== ⑤ L5 压力：每波压缩氧气上限 ==")
        pres = ev(
            "(()=>{const s=__sg.scene.getScene('dive');s.layerIdx=4;"
            "s.o2Max=60;s.o2=60;const seq=[];"
            "for(let i=0;i<4;i++){s.waveInLayer=i;s.o2Max=60*(i===0?1:s.o2Max/60);"
            "s.startWave();seq.push(Math.round(s.o2Max));}"
            "s.waveInLayer=0;s.layerIdx=0;s.o2Max=100;s.o2=100;"
            "return JSON.stringify(seq)})()")
        print("  L5 各波开始时的氧气上限:", pres)
        pres = json.loads(pres)
        results['⑤压力使上限逐波下降'] = pres[0] > pres[-1]

        print("\n== ⑥ 层入场卡 + 低氧暗角 ==")
        print("  开局 layerCardT =", round(card0 or 0, 2), "（>0 表示层卡正在播）")
        results['⑥开局播层入场卡'] = bool(card0) and card0 > 0

        # 回到 L1 抓一张层卡
        ev("(()=>{const s=__sg.scene.getScene('dive');s.layerIdx=0;s.layerCardT=2.6;"
           "s.spawnLeft=0;s.enemies=[];return 1})()")
        time.sleep(0.35)
        shot("v624-01_层卡_L1阳光带.png")

        # L2 暗流：进层 + 放敌人 + 抓图
        ev("(()=>{const s=__sg.scene.getScene('dive');s.layerIdx=1;s.layerCardT=2.6;"
           "s.o2Max=100;s.o2=88;s.spawnLeft=999;return 1})()")
        time.sleep(0.4)
        shot("v624-02_层卡_L2弱光带暗流.png")
        ev("(()=>{const s=__sg.scene.getScene('dive');s.enemies.length=0;"
           "for(let i=0;i<16;i++)s.spawnEnemy();"
           "s.enemies.forEach((e,i)=>{const a=i*2.4;const d=150+(i%4)*60;"
           "e.x=s.px+Math.cos(a)*d;e.y=s.py+Math.sin(a)*d;e.hp=99999;e.maxHp=99999;});"
           "return 1})()")
        time.sleep(0.9)
        shot("v624-03_战斗_暗流提示.png")

        # 低氧暗角：把氧气压到 12%
        ev("(()=>{const s=__sg.scene.getScene('dive');s.o2=12;s.o2Max=100;"
           "s.o2Shown=12;return 1})()")
        time.sleep(0.25)
        shot("v624-04_低氧暗角.png")

        print("\n== 结果 ==")
        ok = True
        for k, v in results.items():
            print("  %s %s" % ("✓" if v else "✗ FAIL", k))
            ok &= bool(v)
        print("\n%d/%d 通过" % (sum(1 for v in results.values() if v), len(results)))
        return 0 if ok else 1
    finally:
        p.terminate()


if __name__ == '__main__':
    raise SystemExit(main())
