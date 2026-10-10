#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把「前端 + 后端」拉起来，供同一进程周期内的验证脚本使用。

为什么必须是"同一进程周期"
--------------------------
这台机器的沙箱会把**命令周期结束时残留的子进程**一并回收。表现是：

  * 在一条命令里 `npx vite &`，curl 得到 200 —— 看起来起好了；
  * 下一条命令再访问就 `WinError 10061 连接被拒绝`；
  * 用 `nohup`、`CREATE_NEW_PROCESS_GROUP`、`DETACHED_PROCESS` 都无济于事
    （实测：分离进程起后端，健康检查通过，下一条命令就 502）。

所以本模块把 dev server 当**上下文**管：谁需要谁开，用完就关，
全程不出这一个进程。代价是无法"起一次用很久"，好处是结果永远可信 ——
之前因为"服务其实已经死了"而得到过一整轮假结论（所有断言都读不到游戏状态）。

用法：
    from _devstack import stack
    with stack() as st:            # 默认前端+后端都起
        ...                        # 此时 http://localhost:5173 / :8099 可用
"""
import os
import re
import subprocess
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(ROOT, 'server')
SERVER_EXE = os.path.join(SERVER_DIR, 'survivors-server.exe')
WEB_DIR = os.path.join(ROOT, 'web')
VITE_JS = os.path.join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
API_PORT = os.environ.get('APP_PORT', '8099')
WEB_PORT = os.environ.get('WEB_PORT', '5173')

# 本机有 http_proxy：urllib 连 localhost 也会走代理并回 502，必须显式清空
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _get(url, timeout=1):
    with _OPENER.open(url, timeout=timeout) as r:
        return r.status, r.read().decode('utf-8', 'replace')


def _node():
    for p in (r'C:/Users/yu.wang/.workbuddy/binaries/node/versions/22.22.2-6/node.exe',
              r'C:/Users/yu.wang/Node/runtime/node.exe'):
        if os.path.exists(p):
            return p
    return 'node'


def free_ports(ports):
    """先清掉占用端口的旧进程。

    必须清：上一轮遗留的服务会一直占着端口提供**旧代码**的服务，
    新进程起不来（或起在别的端口），于是所有验证结论都是错的 —— 实测踩到过。
    """
    try:
        out = subprocess.run(['netstat', '-ano'], capture_output=True,
                             encoding='gbk', errors='replace', timeout=20).stdout or ''
    except Exception as e:
        print('  netstat 失败:', e)
        return
    pids = set()
    for line in out.splitlines():
        if 'LISTENING' not in line:
            continue
        m = re.search(r':(\d+)\s+\S+\s+LISTENING\s+(\d+)$', line.strip())
        if m and int(m.group(1)) in ports:
            pids.add(m.group(2))
    for pid in pids:
        print(f'  释放端口：结束 pid {pid}')
        subprocess.run(['taskkill', '/PID', pid, '/F'], capture_output=True)


def build_backend():
    r = subprocess.run(['go', 'build', '-o', 'survivors-server.exe', '.'],
                       cwd=SERVER_DIR, capture_output=True, encoding='utf-8',
                       errors='replace')
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        raise SystemExit('后端编译失败')


class Stack:
    def __init__(self, backend=True, front=True, quiet=False):
        self.want_backend = backend
        self.want_front = front
        self.quiet = quiet
        self.procs = []
        self.logs = []

    def say(self, *a):
        if not self.quiet:
            print(*a)

    def _spawn(self, argv, cwd, env_extra, logname):
        env = dict(os.environ)
        env.update(env_extra)
        path = os.path.join(ROOT, logname)
        lf = open(path, 'wb')
        self.logs.append((path, lf))
        p = subprocess.Popen(argv, cwd=cwd, env=env, stdout=lf, stderr=lf,
                             stdin=subprocess.DEVNULL)
        self.procs.append(p)
        return p

    def __enter__(self):
        if self.want_backend:
            free_ports({int(API_PORT)})
        if self.want_front:
            free_ports({int(WEB_PORT)})
        time.sleep(1)

        if self.want_backend:
            build_backend()
            p = self._spawn([SERVER_EXE], SERVER_DIR,
                            {'APP_PORT': API_PORT, 'APP_DATA_DIR': 'data'},
                            'server-run.log')
            for _ in range(30):
                time.sleep(0.4)
                try:
                    _, body = _get(f'http://127.0.0.1:{API_PORT}/api/health')
                    self.say(f'  后端就绪 :{API_PORT} (pid={p.pid}) {body.strip()}')
                    break
                except Exception:
                    pass
            else:
                raise SystemExit('后端未就绪，见 server-run.log')

        if self.want_front:
            if not os.path.exists(VITE_JS):
                raise SystemExit(f'找不到 vite：{VITE_JS}（先在 web/ 里 npm install）')
            # 直接调 vite.js，不经 npx —— npx 是 .cmd，而本机 cmd.exe 被安全策略拦。
            p = self._spawn([_node(), VITE_JS, '--port', WEB_PORT, '--strictPort'],
                            WEB_DIR, {}, 'vite-run.log')
            ok = False
            for _ in range(60):
                time.sleep(0.5)
                for host in (f'http://localhost:{WEB_PORT}/', f'http://[::1]:{WEB_PORT}/'):
                    try:
                        st, _ = _get(host, timeout=2)
                        self.say(f'  前端就绪 :{WEB_PORT} (pid={p.pid}, HTTP {st})')
                        ok = True
                        break
                    except Exception:
                        pass
                if ok:
                    break
            if not ok:
                raise SystemExit('前端未就绪，见 vite-run.log')
        return self

    def __exit__(self, *exc):
        for p in reversed(self.procs):
            try:
                p.terminate()
                p.wait(timeout=6)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
        for _, lf in self.logs:
            try:
                lf.close()
            except Exception:
                pass
        return False


def stack(backend=True, front=True, quiet=False):
    return Stack(backend=backend, front=front, quiet=quiet)


if __name__ == '__main__':
    with stack() as st:
        print('OK', st)
