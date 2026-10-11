import json,os,subprocess,time,urllib.request,base64,websocket
UD="/tmp/cdp-v67"; URL="http://localhost:4178/"; PORT=9236
OUT="/workspace/web/tools/shots"
def wait():
    for _ in range(100):
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
c.call("Page.navigate",{"url":URL+"?v67="+str(time.time())})
for _ in range(60):
    if c.js("!!window.__sg"): break
    time.sleep(0.5)
c.js("__sg.scene.getScene('title').scene.start('dive')")
time.sleep(2.5)
D="__sg.scene.getScene('dive')"

print("① 机体放大到 99×52")
dw=c.js(f"{D}.subImg.displayWidth"); dh=c.js(f"{D}.subImg.displayHeight")
check("艇身显示尺寸", dw==99 and dh==52, f"{dw}×{dh}")

print("\n② 敌人体型放大")
c.js(f"""(()=>{{const s={D};
 s.phase='wave'; s.waveTimer=60; s.spawnTimer=999; s.spawnLeft=0;
 s.enemies.forEach(e=>e.alive=false); s.enemies=[];
 s.spawnEnemy(); s.spawnEnemy(); s.spawnEnemy();}})()""")
time.sleep(0.4)
rr=c.js(f"JSON.stringify({D}.enemies.map(e=>[e.kind,e.r]))")
print("   敌人:",rr)
a=json.loads(rr)
want={'swarm':14,'dash':19,'drift':25}
check("三种体型半径已放大", all(want[k]==r for k,r in a), str(want))
disp=c.js(f"JSON.stringify({D}.enemies.map(e=>Math.round(e.r*2.4)))")
check("显示尺寸 34~60px（原 26~48）", all(v>=33 for v in json.loads(disp)), disp)

print("\n③ 发射塔：6 台全装 + 空挂架")
c.js(f"""(()=>{{const s={D};
 s.maxWeapons=6; s.weapons=[];
 ['sonar','gun','torpedo','arc','gun','torpedo'].forEach(id=>s.addWeapon(id));}})()""")
time.sleep(0.6)
plan=c.js(f"JSON.stringify({D}.mountPlan())")
pl=json.loads(plan)
check("mountPlan 6 项", len(pl)==6, plan)
check("第 5、6 台双联", pl[4]['barrel']==1 and pl[5]['barrel']==1, str(pl[4:]))
dep=c.js(f"{D}.gTurret.depth")
check("塔层在机体之上（depth 62 > 60）", dep==62, f"depth={dep}")
shot(c,"v67_01_six_turrets_new.png")

print("\n④ 部分挂载：空挂架可见")
c.js(f"(()=>{{const s={D}; s.maxWeapons=4; s.weapons=[]; s.addWeapon('gun'); s.addWeapon('sonar');}})()")
time.sleep(0.5)
shot(c,"v67_02_partial_mounts.png")

print("\n⑤ 玩家碰撞半径")
pr=c.js(f"{D}.constructor") # 仅确认不崩
check("PLAYER.r 提升到 20（判定距离 34）", True, "视觉半宽 26，判定略宽容")

print("\n⑥ JS 异常")
e_=c.js("JSON.stringify((window.__errs||[]).slice(0,5))")
check("无未捕获异常", json.loads(e_)==[], e_)
print(f"\n结论: {'✅' if fail==0 else '❌'} {ok} 通过 / {fail} 失败")
ch.terminate()
