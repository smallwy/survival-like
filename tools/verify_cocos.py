#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Cocos 侧**离线**验证（不需要 GUI 编辑器、不需要引擎）。

一条命令跑三件事：
  1. 真源漂移检查 —— `shared/` 与 `cocos/assets/scripts/shared/` 是否一致；
  2. 模拟核心无头冒烟 —— 编译 `shared/dive` 为 CJS 真跑，21 条不变量断言；
  3. 视图层类型检查 —— 用 `tools/cocos_cc_stub.d.ts` 顶上 `cc`，把
     `cocos/assets/scripts/**` 全量过 tsc。

------------------------------------------------------------------------------
它能证明什么、不能证明什么（**这条边界必须说清，否则会得到假结论**）
------------------------------------------------------------------------------
能证明：
  · 模拟核心与 `DiveScene.ts` 的行为一致（清波/商店/决策/死亡路径/确定性）；
  · 视图层**没有用错模拟层 API**（字段名拼错、参数个数不对、类型不匹配）——
    这是移植里最容易出的错，而且只有 tsc 抓得住；
  · 真源与 Cocos 副本没有漂移。

**不能**证明：
  · 引擎 API 的真实行为（`Graphics.circle` 画出来什么样、`Node.layer` 默认值、
    相机 zoom 与 UI 相机的配合……）。`cc` 声明桩只是签名，不含实现。
  · 画面是否真的画对了。**这一条只能由你在 Creator 里打开工程、挂上组件、点运行确认。**

所以本脚本绿了 ≠ 能跑；它绿了只说明"进编辑器之前，代码本身该对的都对上了"。
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _devstack import ROOT, _node  # noqa: E402

TOOLS = os.path.join(ROOT, 'tools')
WEB = os.path.join(ROOT, 'web')
TSC_JS = os.path.join(WEB, 'node_modules', 'typescript', 'bin', 'tsc')
BUILD_DIR = os.path.join(ROOT, '.tmp', 'sim-build')

NODE = _node()
steps = []


def run(name, argv, cwd=ROOT):
    print('\n' + '=' * 72)
    print('>>> ' + name)
    print('=' * 72)
    r = subprocess.run(argv, cwd=cwd, encoding='utf-8', errors='replace')
    steps.append((name, r.returncode))
    return r.returncode


def main():
    print(f'使用 node：{NODE}')

    # 1) 真源漂移：shared/ 改了但忘了同步到 cocos/ 时，这里必须红
    run('真源漂移检查 sync_shared.py --check',
        [sys.executable, os.path.join(TOOLS, 'sync_shared.py'), '--check'])

    # 2) 模拟核心：编译成 CJS 真跑（沙箱里唯一能真正"运行"的一层）
    #    先清干净：残留的旧 .js 会让"编译失败但冒烟通过"这种假绿线出现。
    shutil.rmtree(BUILD_DIR, ignore_errors=True)

    rc = run('编译模拟核心 shared/dive → CJS',
             [NODE, TSC_JS,
              'shared/dive/index.ts',
              '--outDir', BUILD_DIR,
              '--rootDir', 'shared',
              '--module', 'commonjs',
              '--target', 'ES2020',
              '--moduleResolution', 'node',
              '--strict', '--skipLibCheck',
              '--lib', 'ES2020,DOM'])

    if rc == 0:
        run('模拟核心无头冒烟 dive_sim_smoke.js',
            [NODE, os.path.join(TOOLS, 'dive_sim_smoke.js'), BUILD_DIR])
    else:
        steps.append(('模拟核心无头冒烟 dive_sim_smoke.js', 1))
        print('  （编译没过，跳过冒烟）')

    # 3) 视图层：用 cc 声明桩做全量类型检查
    run('视图层类型检查（cc 声明桩）',
        [NODE, TSC_JS, '-p', os.path.join(TOOLS, 'cocos_check.tsconfig.json')])

    print('\n' + '=' * 72)
    bad = 0
    for name, code in steps:
        print(('PASS  ' if code == 0 else 'FAIL  ') + name)
        bad += (code != 0)
    print(f'--- {len(steps) - bad}/{len(steps)} 个阶段通过 ---')
    print('\n⚠️  以上全绿只代表"静态可验的部分对上了"。')
    print('    引擎 API 的真实行为与画面正确性**无法在沙箱里验证** ——')
    print('    请在 Cocos Creator 3.8.8 里打开 cocos/、按 README 的三步挂上组件后目视确认。')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
