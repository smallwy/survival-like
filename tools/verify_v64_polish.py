import json,os,subprocess,time,urllib.request,base64,websocket
UD="/tmp/cdp-v64"; URL="http://localhost:4178/"; PORT=9231
OUT="/workspace/survivors-game/tools/shots"
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
c.call("Page.navigate",{"url":URL+"?v64="+str(time.time())})
for _ in range(60):
    if c.js("!!window.__sg"): break
    time.sleep(0.5)
c.js("__sg.scene.getScene('title').scene.start('dive')")
time.sleep(2.5)
D="__sg.scene.getScene('dive')"

print("① 鱼朝向：鱼头必须朝玩家（贴图基准角必须含 π）")
c.js(f"""(()=>{{const s={D};
 s.enemies.forEach(e=>e.alive=false);s.enemies=[];s.spawnTimer=9999;
 for(let i=0;i<4;i++) s.spawnEnemy('swarm');
 s.px=640; s.py=360;
 const pos=[[300,200],[1000,200],[300,520],[1000,520]];
 s.enemies.forEach((e,i)=>{{e.x=pos[i][0];e.y=pos[i][1];e.r=18;}});}})()""")
time.sleep(0.5)
# 期望：每条鱼的 rotation 使其"贴图鱼头(朝左=π)"转向玩家
exp=[]
got=c.js(f"JSON.stringify({D}.enemies.map(e=>[e.x|0,e.y|0]))")
info=c.js(f"""JSON.stringify({D}.fishPool.filter(i=>i.visible).map(i=>{{
 const e={D}.enemies.find(en=>Math.abs(en.x-i.x)<1&&Math.abs(en.y-i.y)<1);
 const face=Math.atan2({D}.py-e.y,{D}.px-e.x);
 // 贴图鱼头指向 = rotation + π（因为贴图基准朝左=π）
 const head=i.rotation+Math.PI;
 let d=head-face; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
 return [i.texture.key, +d.toFixed(3)];
}}))""")
deltas=json.loads(info)
print("   鱼头朝向 vs 朝向玩家 的夹角:",deltas)
check("所有鱼头都朝向玩家（夹角≈0）", all(abs(d[1])<0.35 for d in deltas), str([d[1] for d in deltas]))
shot(c,"v64_01_fish_facing.png")

print("\n② 炮塔：尺寸放大 + 挂载点内收")
c.js(f"(()=>{{const s={D}; s.weapons.length=0; s.addWeapon('gun'); s.addWeapon('torpedo'); s.addWeapon('arc');}})()")
time.sleep(0.6)
t=c.js(f"JSON.stringify({D}.turretImgs.filter(i=>i.visible).map(i=>[+i.displayWidth.toFixed(1), +Math.hypot(i.x-{D}.px,i.y-{D}.py).toFixed(1)]))")
tv=json.loads(t)
print("   [塔尺寸, 距机体中心距离]:",tv)
check("塔头放大到 30px", all(v[0]==30 for v in tv), str([v[0] for v in tv]))
check("挂载点内收（距中心 < 16px）", all(v[1]<16 for v in tv), str([v[1] for v in tv]))
shot(c,"v64_02_turret_mount.png")

print("\n③ 声呐圆环已移除")
c.js(f"(()=>{{const s={D}; s.pulses=[]; for(let i=0;i<5;i++) s.pulses.push({{x:s.px,y:s.py,r:60+i*40,maxR:420,width:34,dmg:1,hit:new Set(),alive:true}});}})()")
time.sleep(0.3)
src=c.js("(()=>{const s=__sg.scene.getScene('dive');return s.drawPulses.toString()})()")
check("drawPulses 已改为空实现（无 neonCircle 绘制）", "neonCircle" not in src, src[:50])
shot(c,"v64_03_no_sonar_ring.png")

print("\n④ 火花 / 枪口闪光")
c.js(f"""(()=>{{const s={D}; s.sparks=[];
 s.enemies.forEach(e=>e.alive=false); s.enemies=[];
 for(let i=0;i<20;i++) s.spawnEnemy('swarm');
 s.enemies.forEach((e,i)=>{{e.x=200+i*45; e.y=200; e.r=14; e.hp=99999; e.maxHp=99999;}});
 s.spawnTimer=9999;}})()""")
time.sleep(3.0)
sp=c.js(f"JSON.stringify({{n:{D}.sparks.length, kinds:(()=>{{const m={{}};{D}.sparks.forEach(s=>m[s.kind]=(m[s.kind]||0)+1);return m}})()}})")
print("   火花:",sp)
check("开火产生了火花", json.loads(sp)["n"]>0, sp)
shot(c,"v64_04_sparks.png")

print("\n⑤ JS 异常")
e_=c.js("JSON.stringify((window.__errs||[]).slice(0,5))")
check("无未捕获异常", json.loads(e_)==[], e_)
print(f"\n结论: {'✅' if fail==0 else '❌'} {ok} 通过 / {fail} 失败")
ch.terminate()
