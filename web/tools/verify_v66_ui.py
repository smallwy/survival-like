import json,os,subprocess,time,urllib.request,base64,websocket
UD="/tmp/cdp-v66b"; URL="http://localhost:4178/"; PORT=9234
OUT="/workspace/web/tools/shots"
def wait(px=25):
    for _ in range(px*4):
        try:
            for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list",timeout=1)):
                if t.get("type")=="page" and t.get("webSocketDebuggerUrl"): return t["webSocketDebuggerUrl"]
        except Exception: pass
        time.sleep(0.25)
    raise RuntimeError("cdp")
class C:
    def __init__(s,ws): s.ws=websocket.create_connection(ws,timeout=30); s.i=0
    def call(s,m,p=None):
        s.i+=1; s.ws.send(json.dumps({"id":s.i,"method":m,"params":p or {}}))
        while True:
            r=json.loads(s.ws.recv())
            if r.get("id")==s.i: return r.get("result",{})
    def js(s,e): return s.call("Runtime.evaluate",{"expression":e,"returnByValue":True}).get("result",{}).get("value")
def shot(c,n):
    r=c.call("Page.captureScreenshot",{"format":"png"})
    open(os.path.join(OUT,n),"wb").write(base64.b64decode(r["data"])); print("→",n)
ok=fail=0
def check(l,c_,x=""):
    global ok,fail
    if c_: ok+=1; print(f"✓ {l}"+(f" — {x}" if x else ""))
    else: fail+=1; print(f"❌ {l} {x}")
subprocess.run(["pkill","-f",f"remote-debugging-port={PORT}"],check=False)
ch=subprocess.Popen(["chromium","--headless=new","--no-sandbox","--disable-dev-shm-usage",
  f"--remote-debugging-port={PORT}","--remote-allow-origins=*",f"--user-data-dir={UD}",
  "--window-size=1280,720","--hide-scrollbars",URL],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(2.5); c=C(wait()); c.call("Page.enable"); c.call("Runtime.enable")
c.call("Page.addScriptToEvaluateOnNewDocument",{"source":
  "window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));"})
c.call("Page.navigate",{"url":URL+"?v66b="+str(time.time())})
for _ in range(60):
    if c.js("!!window.__sg"): break
    time.sleep(0.5)
c.js("__sg.scene.getScene('title').scene.start('dive')")
time.sleep(2.5)
D="__sg.scene.getScene('dive')"

print("① addWeapon：槽位没满 → 同款也占新槽")
c.js(f"""(()=>{{const s={D};
 s.maxWeapons=6; s.weapons=[];
 s.addWeapon('gun'); s.addWeapon('gun'); s.addWeapon('sonar');}})()""")
time.sleep(0.3)
r=c.js(f"JSON.stringify({D}.weapons.map(w=>[w.id,w.lvl]))")
arr=json.loads(r)
check("同款 gun 占了两槽", len(arr)==3 and arr[0][0]=='gun' and arr[1][0]=='gun', r)
check("两台都不该被升级（各 Lv1）", all(a[1]==1 for a in arr), r)
plan=c.js(f"JSON.stringify({D}.mountPlan())")
pl=json.loads(plan)
check("mountPlan 按台数分配", len(pl)==3 and pl[2]['seat']==2, plan)

print("\n② addWeapon：槽位满了 → 同款合并升级")
c.js(f"""(()=>{{const s={D};
 s.maxWeapons=2; s.weapons=[];
 s.addWeapon('gun'); s.addWeapon('gun'); s.addWeapon('gun');}})()""")
time.sleep(0.3)
r2=c.js(f"JSON.stringify({D}.weapons.map(w=>[w.id,w.lvl]))")
a2=json.loads(r2)
check("台数保持 2 不溢出", len(a2)==2, r2)
check("有一台被升到 Lv2", any(a[1]==2 for a in a2), r2)

print("\n③ 满槽塞新武器 → 挤掉最早那台")
c.js(f"""(()=>{{const s={D};
 s.maxWeapons=2; s.weapons=[];
 s.addWeapon('gun'); s.addWeapon('sonar'); s.addWeapon('torpedo');}})()""")
time.sleep(0.3)
r3=c.js(f"JSON.stringify({D}.weapons.map(w=>w.id))")
check("最早 gun 被挤出", json.loads(r3)==['sonar','torpedo'], r3)

print("\n④ startRun 复位挂载位（重开一局不能带 6 座）")
c.js(f"(()=>{{const s={D}; s.maxWeapons=6; s.twinRate=0.5; s.startRun();}})()")
time.sleep(0.4)
mw=c.js(f"{D}.maxWeapons"); tr=c.js(f"{D}.twinRate")
check("maxWeapons 复位 4", mw==4, f"maxWeapons={mw}")
check("twinRate 复位 0", tr==0, f"twinRate={tr}")
# 注意：氧气在持续消耗（drain），o2 本身每帧都在掉，
# 所以这里只能断言"补间值追得上真实值"，不能断言等于某个常数。
d4=c.js(f"Math.abs({D}.o2Shown-{D}.o2)")
check("o2Shown 追上 o2（差值<1）", d4 is not None and d4<1, f"差={round(d4,3) if d4 else d4}")

print("\n⑤ 氧气数值补间（不硬跳）")
c.js(f"(()=>{{const s={D}; s.o2Max=100; s.o2=100; s.o2Shown=100; s.o2=40;}})()")
time.sleep(0.12)
mid=c.js(f"{D}.o2Shown")
time.sleep(0.9)
end=c.js(f"{D}.o2Shown"); real=c.js(f"{D}.o2")
check("中途值介于真实值与起点之间（在补间）",
      mid is not None and real < mid < 100, f"中途 o2Shown={round(mid,2)} 真实 o2={round(real,2)}")
check("最终收敛到真实值", abs(end-real)<1, f"终值 o2Shown={round(end,2)} 真实 o2={round(real,2)}")

print("\n⑥ 受击方向记录 + 方向性暗角")
c.js(f"""(()=>{{const s={D};
 s.phase='wave'; s.waveTimer=60; s.spawnTimer=999; s.spawnLeft=0;
 s.enemies.forEach(e=>e.alive=false); s.enemies=[];
 s.spawnEnemy('swarm'); s.enemies[0].x=s.px+30; s.enemies[0].y=s.py;}})()""")
time.sleep(0.5)
hd=c.js(f"JSON.stringify([{D}.hurtDirX,{D}.hurtDirY,{D}.hurtDirT])")
hx,hy,ht=json.loads(hd)
check("记录了受击来向", ht>0, f"dir=({round(hx,2)},{round(hy,2)}) t={round(ht,2)}")
check("方向指向敌人那一侧（+X）", hx>0.5, f"hurtDirX={round(hx,2)}")
shot(c,"v66b_01_hurt_vignette.png")

print("\n⑦ 低氧：心跳缩放 + 告急边框")
# 两个坑，都会让 gasping 悄悄失效：
#   1) o2 被 drain 持续消耗，掉到 0 就 gameover → phase 不再满足；
#   2) spawnLeft===0 且场上无敌人 → cleared → advance() 把 phase 推进到 shop。
# 所以采样期间必须每帧把 o2 钉回去、并保持 spawnLeft>0 让波次不结束。
zmax=0; ph=None
for _ in range(30):
    c.js(f"""(()=>{{const s={D};
      s.o2Max=100; s.o2=15; s.o2Shown=15; s.phase='wave';
      s.waveTimer=60; s.spawnTimer=999; s.spawnLeft=99;}})()""")
    time.sleep(0.05)              # 等至少一帧，否则读到的是上一帧的 zoom
    z=c.js(f"{D}.cameras.main.zoom")
    ph=c.js(f"JSON.stringify([{D}.phase,{D}.o2])")
    if z: zmax=max(zmax,z)
check("低氧时镜头有心跳缩放", zmax>1.0001, f"峰值 zoom={round(zmax,5)} phase/o2={ph}")
check("缩放幅度克制（<1.5%）", zmax<1.015, f"峰值 zoom={round(zmax,5)}")
shot(c,"v66b_02_low_o2.png")
c.js(f"(()=>{{const s={D}; s.o2=100; s.o2Shown=100;}})()")
time.sleep(0.4)
check("高氧时 zoom 复位 1", abs((c.js(f"{D}.cameras.main.zoom") or 1)-1)<0.0001,
      f"zoom={c.js(f'{D}.cameras.main.zoom')}")

print("\n⑧ 武器条随 maxWeapons 扩容（6 座全可见）")
c.js(f"""(()=>{{const s={D};
 s.maxWeapons=6; s.weapons=[];
 ['sonar','gun','torpedo','arc','gun','torpedo'].forEach(id=>s.addWeapon(id));
 s.phase='wave'; s.waveTimer=60; s.spawnTimer=999; s.spawnLeft=0;}})()""")
time.sleep(0.6)
vis=c.js(f"{D}.turretImgs.filter(i=>i.visible).length")
check("6 个塔头可见", vis==6, f"{vis} 个")
plan=c.js(f"JSON.stringify({D}.mountPlan())")
pl=json.loads(plan)
check("第 5、6 台是双联（barrel=1）", pl[4]['barrel']==1 and pl[5]['barrel']==1, plan)
shot(c,"v66b_03_six_mounts_hud.png")

print("\n⑨ 波次环形倒计时 + 剩余敌人")
c.js(f"""(()=>{{const s={D};
 s.phase='wave'; s.waveInLayer=1; s.waveTimer=30; s.spawnTimer=999; s.spawnLeft=0;
 s.enemies.forEach(e=>e.alive=false); s.enemies=[];
 for(let i=0;i<5;i++) s.spawnEnemy('swarm');}})()""")
time.sleep(0.5)
al=c.js(f"{D}.enemies.reduce((n,e)=>n+(e.alive?1:0),0)")
check("剩余敌人数可统计", al>0, f"alive={al}")
shot(c,"v66b_04_wave_ring.png")

print("\n⑩ 下潜进度条")
c.js(f"(()=>{{const s={D}; s.phase='descending'; s.descT=0.3; s.descDur=1.0;}})()")
time.sleep(0.4)
shot(c,"v66b_05_descend_bar.png")
c.js(f"(()=>{{const s={D}; s.phase='wave';}})()")

print("\n⑪ JS 异常")
e_=c.js("JSON.stringify((window.__errs||[]).slice(0,5))")
check("无未捕获异常", json.loads(e_)==[], e_)
print(f"\n结论: {'✅' if fail==0 else '❌'} {ok} 通过 / {fail} 失败")
ch.terminate()
