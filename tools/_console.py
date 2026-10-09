"""抓浏览器控制台报错 —— 选人界面没渲染出来时用它定位真实异常。"""
import asyncio, json, os, subprocess, sys, time, urllib.request
import websockets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = os.environ.get('GAME_URL', 'http://localhost:5173/')
PORT = 9344

CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]


def launch():
    exe = next((p for p in CANDIDATES if os.path.exists(p)), None)
    if not exe:
        sys.exit('找不到 Chrome/Edge')
    prof = os.path.join(ROOT, '_diag', 'cdp-prof-c')
    os.makedirs(prof, exist_ok=True)
    return subprocess.Popen([exe, '--headless=new', f'--remote-debugging-port={PORT}',
                             f'--user-data-dir={prof}', '--no-first-run', '--disable-gpu',
                             '--window-size=960,800', 'about:blank'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_ws():
    for _ in range(80):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/list') as r:
                for t in json.load(r):
                    if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                        return t['webSocketDebuggerUrl']
        except Exception:
            pass
        time.sleep(0.25)
    sys.exit('拿不到 ws')


async def main():
    proc = launch()
    try:
        ws_url = wait_ws()
        async with websockets.connect(ws_url, max_size=32 * 1024 * 1024) as ws:
            i = 0
            logs = []

            async def send(method, **params):
                nonlocal i
                i += 1
                await ws.send(json.dumps({'id': i, 'method': method, 'params': params}))
                return i

            async def drain(seconds):
                end = time.time() + seconds
                while time.time() < end:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.4)
                    except asyncio.TimeoutError:
                        continue
                    m = json.loads(raw)
                    meth = m.get('method')
                    if meth == 'Runtime.exceptionThrown':
                        d = m['params']['exceptionDetails']
                        logs.append('EXCEPTION: ' + (d.get('exception', {}).get('description') or d.get('text')))
                    elif meth == 'Runtime.consoleAPICalled':
                        parts = []
                        for a in m['params'].get('args', []):
                            parts.append(str(a.get('value', a.get('description', ''))))
                        logs.append(m['params']['type'].upper() + ': ' + ' '.join(parts))

            await send('Runtime.enable')
            await send('Page.enable')
            await send('Log.enable')
            await send('Page.navigate', url=URL)
            await drain(6)
            for l in logs[:40]:
                print(l[:600])
            if not logs:
                print('（无控制台输出）')
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=6)
        except Exception:
            proc.kill()


asyncio.run(main())
