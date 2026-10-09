#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""一键跑完全部验证：静态守卫 -> 类型检查 -> 逻辑验证 -> 真机截图。

一条命令拿到全部结论，避免"服务其实已经死了"这类假结论。

    python tools/verify_all.py

退出码 0 表示全绿。
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _devstack import ROOT, _node, stack  # noqa: E402

PY = os.environ.get('PYTHON_BIN', sys.executable)
NODE = _node()
WEB = os.path.join(ROOT, 'web')

steps = []


def run(name, argv, cwd=ROOT, shell=False):
    print('\n' + '=' * 72)
    print('>>> ' + name)
    print('=' * 72)
    r = subprocess.run(argv, cwd=cwd, shell=shell, encoding='utf-8', errors='replace')
    steps.append((name, r.returncode))
    return r.returncode


def main():
    # 1) 静态守卫：四支柱引用完整性 + 接线（不需要服务）
    run('静态守卫 check_facing_applied.mjs',
        [NODE, os.path.join(ROOT, 'tools', 'check_facing_applied.mjs')])

    # 2) 类型检查（不需要服务）
    npx_tsc = os.path.join(WEB, 'node_modules', 'typescript', 'bin', 'tsc')
    run('TypeScript 类型检查', [NODE, npx_tsc, '--noEmit'], cwd=WEB)

    # 3) + 4) 需要服务：由 _devstack 在同进程周期内拉起
    run('逻辑验证 check_objectives.py（关卡目标/阵型/计谋）',
        [PY, os.path.join(ROOT, 'tools', 'check_objectives.py')])
    run('真机截图 verify_shot.py（起前后端 + CDP 截图 + 采样）',
        [PY, os.path.join(ROOT, 'tools', 'verify_shot.py')])

    print('\n' + '=' * 72)
    bad = 0
    for name, code in steps:
        print(('PASS  ' if code == 0 else 'FAIL  ') + name)
        bad += (code != 0)
    print(f'--- {len(steps) - bad}/{len(steps)} 个阶段通过 ---')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
