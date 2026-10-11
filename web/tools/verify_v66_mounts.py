import json,os,subprocess,time,urllib.request,base64,websocket
UD="/tmp/cdp-v66"; URL="http://localhost:4178/"; PORT=9233
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
c.call("Page.navigate",{"url":URL+"?v66="+str(time.time())})
for _ in range(60):
    if c.js("!!window.__sg"): break
    time.sleep(0.5)
c.js("__sg.scene.getScene('title').scene.start('dive')")
time.sleep(2.5)
D="__sg.scene.getScene('dive')"

print("① 挂载位：初始 4，卡片解锁到 6")
mw0=c.js(f"{D}.maxWeapons")
check("初始上限 4", mw0==4, f"maxWeapons={mw0}")
# 装 6 台（直接构造，绕过 addWeapon 的「同 id 合并升级」分支）
# 注：当前 WeaponId 只有 4 种，addWeapon 对同 id 走升级，故这里手工铺满 6 槽
c.js(f"""(()=>{{const s={D};
 s.maxWeapons=6; s.weapons.length=0;
 const mk=id=>({{id, iv:1.0, timer:0, dmg:5, lvl:1, anchor:0}});
 ['sonar','gun','torpedo','arc','gun','torpedo'].forEach(id=>s.weapons.push(mk(id)));
}})()""")
time.sleep(0.5)
n=c.js(f"{D}.weapons.length")
plan=c.js(f"JSON.stringify({D}.mountPlan())")
pl=json.loads(plan)
print("   mountPlan:",pl)
check("可装 6 台", n==6, f"{n} 台")
check("前 4 台各占一座前管", all(p['barrel']==0 and p['seat']==i for i,p in enumerate(pl[:4])), str(pl[:4]))
check("第 5、6 台落到座 0/1 后管（双联）",
      pl[4]=={"seat":0,"barrel":1} and pl[5]=={"seat":1,"barrel":1}, str(pl[4:]))
vis=c.js(f"{D}.turretImgs.filter(i=>i.visible).length")
check("6 个塔头都可见", vis==6, f"{vis} 个")
shot(c,"v66_01_six_turrets.png")

print("\n② 商店卡：挂载扩容卡 + 死卡过滤")
pool=c.js(f"JSON.stringify({D}.pool.map(u=>[u.id,u.kind]))")
print("   卡池:",pool)
pl2=json.loads(pool)
check("存在 3 张挂载卡", sum(1 for p in pl2 if p[1]=='mount')==3, str([p[0] for p in pl2 if p[1]=='mount']))
# 满槽后不该刷出扩容卡
c.js(f"(()=>{{const s={D}; s.maxWeapons=6; s.openShop();}})()")
time.sleep(0.4)
off=c.js(f"JSON.stringify({D}.offers.map(u=>u.id))")
print("   满槽时三选一:",off)
check("满槽后不再刷出扩容卡", 't_slot5' not in off and 't_slot6' not in off, off)
shot(c,"v66_02_shop_cards.png")
# 4 槽时应该能刷出 slot5
c.js(f"(()=>{{const s={D}; s.maxWeapons=4; s.openShop();}})()")
time.sleep(0.4)
off2=c.js(f"JSON.stringify({D}.offers.map(u=>u.id))")
c.js(f"(()=>{{const s={D}; s.maxWeapons=4; for(let k=0;k<12;k++){{s.openShop(); if(s.offers.some(u=>u.id==='t_slot5')){{window.__hit5=true;break}}}}}})()")
hit5=c.js("!!window.__hit5")
check("4 槽时能刷出双联挂载 I", hit5, f"抽样12次命中={hit5}")

print("\n③ 飘字：捡鱼骨 / 击杀回氧")
c.js(f"""(()=>{{const s={D};
 s.phase='wave'; s.waveTimer=60; s.spawnTimer=999; s.spawnLeft=0;
 s.floats=[]; s.o2=40; s.o2Max=120;
 s.enemies.forEach(e=>e.alive=false); s.enemies=[];
 for(let i=0;i<3;i++) s.spawnEnemy('swarm');
 s.enemies.forEach((e,i)=>{{e.x=400+i*60; e.y=300; e.r=12;}});
}})()""")
time.sleep(0.3)
# 强制击杀 → 触发击杀回氧飘字
c.js(f"(()=>{{const s={D}; s.enemies.forEach(e=>{{e.hp=0; s.hurt(e,9999)}});}})()")
time.sleep(0.3)
# 强制把鱼骨挪到玩家身上 → 触发拾取飘字
c.js(f"(()=>{{const s={D}; s.bones.forEach(b=>{{b.x=s.px; b.y=s.py}});}})()")
time.sleep(0.4)
fl=c.js(f"JSON.stringify({D}.floats.map(f=>[f.text,+f.life.toFixed(2)]))")
print("   飘字:",fl)
check("产生了飘字", json.loads(fl) and len(json.loads(fl))>0, fl)
shot(c,"v66_03_floats.png")

print("\n④ JS 异常")
e_=c.js("JSON.stringify((window.__errs||[]).slice(0,5))")
check("无未捕获异常", json.loads(e_)==[], e_)
print(f"\n结论: {'✅' if fail==0 else '❌'} {ok} 通过 / {fail} 失败")
ch.terminate()
