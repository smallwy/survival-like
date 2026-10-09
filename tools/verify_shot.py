#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""一键验证：起前端 + 后端 -> 跑 CDP 截图 -> 收尾。

为什么需要这一层
----------------
这台机器的沙箱会把「命令周期结束时残留的子进程」一并回收。
于是 `./survivors-server.exe &`、`npx vite &`、PowerShell Start-Process 起的服务
**都活不过一条命令**：探活看起来是好的，下一条命令再访问就 502 / 连接被拒。
（`nohup`、`CREATE_NEW_PROCESS_GROUP`、`DETACHED_PROCESS` 全试过，一样被收走。）

服务生命周期由 `tools/_devstack.py` 统一管理：谁需要谁开、用完就关，全程在一个进程里。

用法：
    python tools/verify_shot.py [输出目录]
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _devstack import ROOT, stack  # noqa: E402

SHOOT = os.path.join(ROOT, 'tools', 'shoot_game.py')
PY = os.environ.get('PYTHON_BIN', sys.executable)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs', 'shots')
    with stack(backend=True, front=True) as st:
        print('跑 CDP 截图流程')
        r = subprocess.run([PY, SHOOT, out_dir], cwd=ROOT)
        print('截图脚本退出码', r.returncode)
        return r.returncode


if __name__ == '__main__':
    sys.exit(main())
