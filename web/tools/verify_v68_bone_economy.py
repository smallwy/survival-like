import json,os,subprocess,time,urllib.request,base64,websocket
UD="/tmp/cdp-v68"; URL="http://localhost:4178/"; PORT=9237
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
c.call("Page.navigate",{"url":URL+"?v68="+str(time.time())})
for _ in range(60):
    if c.js("!!window.__sg"): break
    time.sleep(0.5)
c.js("__sg.scene.getScene('title').scene.start('dive')")
time.sleep(2.5)
D="__sg.scene.getScene('dive')"
P="__dive"

print("① 鱼骨拾取 = 加钱 + 回氧")
c.js(f"""(()=>{{const s={D};
 s.phase='wave'; s.waveTimer=60; s.spawnTimer=999; s.spawnLeft=0;
 s.bank=0; s.o2Max=100; s.o2=50;
 s.enemies.forEach(e=>e.alive=false); s.enemies=[];
 s.bones=[]; s.bones.push({{x:s.px,y:s.py,vx:0,vy:0,fade:5,value:9,size:20,rot:0,spin:0,alive:true}});}})()""")
time.sleep(0.5)
bk=c.js(f"{D}.bank"); o2=c.js(f"{D}.o2")
check("拾取后 bank +9", bk==9, f"bank={bk}")
check("同时回氧 (>50)", o2>50, f"o2={o2:.1f}")

print("\n② 买卡：扣钱 + 生效 + 留在商店")
c.js(f"(()=>{{const s={D}; s.bank=100; s.maxWeapons=4; s.weapons=[]; s.openShop();}})()")
time.sleep(0.4)
off=c.js(f"JSON.stringify({D}.offers.map(u=>[u.id,u.cost]))")
print("   三选一:",off)
cost0=json.loads(off)[0][1]
nw0=c.js(f"{D}.weapons.length")
c.js(f"{P}.buy(0)")
time.sleep(0.3)
bk2=c.js(f"{D}.bank"); nw1=c.js(f"{D}.weapons.length")
ph=c.js(f"{D}.phase")
check("扣款正确", bk2==100-cost0, f"bank {100}→{bk2} (卡价 {cost0})")
check("买完仍留在商店（不自动开下一波）", ph=='shop', f"phase={ph}")
check("已售格标记", json.loads(c.js(f"JSON.stringify({D}.sold)"))[0]==True)
shot(c,"v68_01_shop_bought.png")

print("\n③ 钱不够 → 买不动")
c.js(f"(()=>{{const s={D}; s.bank=1; s.sold=[false,false,false];}})()")
time.sleep(0.2)
before=c.js(f"{D}.bank")
c.js(f"{P}.buy(1)")
time.sleep(0.2)
check("余额不足时购买无效", c.js(f"{D}.bank")==before, f"bank 仍={before}")

print("\n④ 刷新：扣递增费用 + 保留锁定格")
c.js(f"(()=>{{const s={D}; s.bank=200; s.sold=[false,false,false]; s.locked=[false,false,false]; s.openShop();}})()")
time.sleep(0.4)
r0=c.js(f"{D}.rerollCost")
keep=c.js(f"JSON.stringify({D}.offers.map(u=>u.id))")
c.js(f"{P}.lock(0)")
time.sleep(0.15)
b1=c.js(f"{D}.bank")
c.js(f"{P}.reroll()")
time.sleep(0.3)
b2=c.js(f"{D}.bank"); r1=c.js(f"{D}.rerollCost")
after=c.js(f"JSON.stringify({D}.offers.map(u=>u.id))")
check("刷新扣费", b2==b1-r0, f"{b1}→{b2}（费用 {r0}）")
check("刷新费递增", r1==r0+6, f"{r0}→{r1}")
check("锁定格保留原卡", json.loads(after)[0]==json.loads(keep)[0], f"{keep} → {after}")

print("\n⑤ 离开商店 → 开下一波，余额保留")
b3=c.js(f"{D}.bank")
c.js(f"{P}.leaveShop()")
time.sleep(0.5)
check("离开后进入 wave", c.js(f"{D}.phase")=='wave', f"phase={c.js(f'{D}.phase')}")
check("余额保留（货币跨波累积）", c.js(f"{D}.bank")==b3, f"bank={c.js(f'{D}.bank')}")

print("\n⑥ 开局启动资金")
c.js(f"(()=>{{const s={D}; s.bank=0; s.openShop();}})()")
time.sleep(0.3)
check("首波给启动资金（不会必然空手）", c.js(f"{D}.bank")>=20, f"bank={c.js(f'{D}.bank')}")

print("\n⑦ JS 异常")
e_=c.js("JSON.stringify((window.__errs||[]).slice(0,5))")
check("无未捕获异常", json.loads(e_)==[], e_)
print(f"\n结论: {'✅' if fail==0 else '❌'} {ok} 通过 / {fail} 失败")
ch.terminate()
