#!/usr/bin/env python3
"""截图定位 UI 问题：进入战斗、进商店、结算，多张截图。"""
import base64, json, os, shutil, subprocess, time, urllib.request, websocket

UD = "/tmp/cdp-shot"; URL = "http://localhost:4178/?v=%d" % __import__("time").time(); OUT = "/workspace/web/tools/shots"
PORT = 9222
os.makedirs(OUT, exist_ok=True)

def wait_cdp(t=25):
    for _ in range(t*4):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page": return t["webSocketDebuggerUrl"]
        except Exception: pass
        time.sleep(0.25)
    raise SystemExit("CDP 未就绪")

class C:
    def __init__(s, ws): s.ws=websocket.create_connection(ws,timeout=30); s.i=0
    def call(s,m,p=None):
        s.i+=1; s.ws.send(json.dumps({"id":s.i,"method":m,"params":p or {}}))
        while True:
            x=json.loads(s.ws.recv())
            if x.get("id")==s.i: return x
    def ev(s,e):
        r=s.call("Runtime.evaluate",{"expression":e,"returnByValue":True})
        return r.get("result",{}).get("result",{}).get("value")
    def shot(s,n):
        r=s.call("Page.captureScreenshot",{"format":"png"})
        p=os.path.join(OUT,n+".png")
        open(p,"wb").write(base64.b64decode(r["result"]["data"])); print("  截图",os.path.basename(p)); return p
    def key(s,k,c,v):
        for t in("keyDown","keyUp"):
            s.call("Input.dispatchKeyEvent",{"type":t,"key":k,"code":c,"windowsVirtualKeyCode":v,"nativeVirtualKeyCode":v})
    def click(s,x,y):
        for t in("mousePressed","mouseReleased"):
            s.call("Input.dispatchMouseEvent",{"type":t,"x":x,"y":y,"button":"left","clickCount":1})

def probe(c): return c.ev("window.__dive ? __dive.probe() : null")

def main():
    shutil.rmtree(UD, ignore_errors=True)
    proc=subprocess.Popen(["chromium","--headless=new","--no-sandbox","--disable-dev-shm-usage",
        f"--user-data-dir={UD}",f"--remote-debugging-port={PORT}","--remote-allow-origins=*",
        "--window-size=1280,720","--hide-scrollbars","about:blank"],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        c=C(wait_cdp()); c.call("Page.enable"); c.call("Runtime.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument",{"source":
            "window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));"
            "window.addEventListener('unhandledrejection',e=>window.__errs.push('rej:'+e.reason));"})
        c.call("Page.navigate",{"url":URL})
        for i in range(60):
            if c.ev("!!window.__sg"): break
            time.sleep(0.5)
        else: print("探针未就绪",c.ev("location.href"),c.ev("window.__errs")); return
        print("就绪",c.ev("__sg.scene.getScenes(true).map(s=>s.scene.key)"))
        c.shot("dbg_01_title")
        c.key("Enter","Enter",13); time.sleep(3.2)
        # 第 1 波战斗中途：敌人满屏、武器开火
        c.shot("dbg_02_combat")
        time.sleep(2.5)
        c.shot("dbg_02b_combat_late")
        print("战斗:",probe(c))
        c.shot("dbg_02_combat")
        # 进商店
        for w in range(3):
            c.ev("__dive.skip()"); time.sleep(0.4)
            p=probe(c)
            print("skip后",p["phase"] if p else None)
            if p and p["phase"]=="shop":
                c.shot("dbg_03_shop"); break
        # 买一张卡后看战斗 HUD（遗物槽等）
        c.ev("__dive.buy(0)"); time.sleep(0.5)
        c.ev("__dive.leaveShop()"); time.sleep(2)
        c.shot("dbg_04_aftershop")
        print("errs",c.ev("window.__errs"))
    finally:
        proc.terminate()

if __name__=="__main__": main()
