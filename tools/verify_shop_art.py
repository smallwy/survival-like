import json,os,shutil,subprocess,tempfile,time,urllib.request,base64
CHROME=r"C:/Program Files/Google/Chrome/Application/chrome.exe"
PORT=9376; URL="http://127.0.0.1:4173/"
ud=os.path.join(tempfile.gettempdir(),"wb_sh2"); shutil.rmtree(ud,ignore_errors=True); os.makedirs(ud,exist_ok=True)
p=subprocess.Popen([CHROME,"--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
 "--hide-scrollbars","--mute-audio","--remote-allow-origins=*",f"--user-data-dir={ud}",
 f"--remote-debugging-port={PORT}","--window-size=1320,900","about:blank"],
 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
ws=None
for _ in range(100):
    try:
        with op.open(f"http://127.0.0.1:{PORT}/json/list",timeout=2) as r:
            for t in json.load(r):
                if t.get("type")=="page": ws=t["webSocketDebuggerUrl"]
        if ws: break
    except Exception: pass
    time.sleep(0.25)
import websocket
c=websocket.create_connection(ws,timeout=30); i=0
def call(m,par=None):
    global i;i+=1;c.send(json.dumps({"id":i,"method":m,"params":par or {}}))
    while True:
        mm=json.loads(c.recv())
        if mm.get("id")==i: return mm
def ev(e): return call("Runtime.evaluate",{"expression":e,"returnByValue":True}).get("result",{}).get("result",{}).get("value")
def shot(n):
    r=call("Page.captureScreenshot",{"format":"png"})
    open("tools/shots/"+n,"wb").write(base64.b64decode(r["result"]["data"]))
def key(k,code,vk):
    for t in ("keyDown","keyUp"):
        call("Input.dispatchKeyEvent",{"type":t,"key":k,"code":code,"windowsVirtualKeyCode":vk,"nativeVirtualKeyCode":vk})
try:
    call("Page.enable");call("Runtime.enable")
    call("Page.navigate",{"url":URL})
    for _ in range(80):
        if ev("!!window.__sg"): break
        time.sleep(0.4)
    time.sleep(1.5)
    key("Enter","Enter",13); time.sleep(2.5)
    ev("(()=>{const s=__sg.scene.getScene('dive');s.bank=300;s.spawnLeft=0;s.enemies=[];return 1})()")
    for _ in range(40):
        if ev("(()=>{const s=__sg.scene.getScene('dive');return s.phase})()")=="shop": break
        time.sleep(0.4)
    sets = [['w_gun','w_sonar','w_torp'], ['w_arc','w_harp','w_echo'], ['w_acid','w_gun','w_arc'], ['e_gun_gl','e_gun_sg','e_torp_hv'], ['e_torp_cl','e_arc_ov','e_arc_st'], ['e_sonar_rs','e_sonar_fc','w_gun'],
              ['r_echo_heart','r_osteoblast','r_tidal_compass'],
              ['r_resonance_core','r_gluttony','r_abyss_mark'],
              ['r_current_fin','r_silent_plating','r_echo_heart']]
    for si, ids in enumerate(sets):
        ev("(()=>{const s=__sg.scene.getScene('dive');const pick=id=>s.pool.filter(u=>u.id===id)[0];"
           "s.offers=[pick('%s'),pick('%s'),pick('%s')];s.shopCards=[];return 1})()" % tuple(ids))
        time.sleep(0.6)
        print("卡片:", ev("(()=>{const s=__sg.scene.getScene('dive');return JSON.stringify(s.offers.map(o=>o.id))})()"),
              "立绘:", ev("(()=>{const s=__sg.scene.getScene('dive');return JSON.stringify(s.shopArt.map(a=>a.visible?a.texture.key:'-'))})()"))
        shot("shopart_%d.png" % si)
    print("done")
finally:
    p.terminate()
