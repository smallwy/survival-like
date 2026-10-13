#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Cocos 侧**离线**验证（不需要 GUI 编辑器、不需要引擎）。

一条命令跑四件事：
  1. 真源漂移检查 —— `shared/` 与 `cocos/assets/scripts/shared/` 是否一致；
  2. 模拟核心无头冒烟 —— 编译 `shared/dive` 为 CJS 真跑，21 条不变量断言；
  3. 视图层类型检查 —— 用 `tools/cocos_cc_stub.d.ts` 顶上 `cc`，把
     `cocos/assets/scripts/**` 全量过 tsc；
  4. 工程资源完整性 —— 场景/prefab 的 `__id__` 引用、`_id` 唯一性，以及
     **脚本类 id ↔ .ts.meta uuid** 是否对得上（压缩 uuid 算法错了就红在这）。

------------------------------------------------------------------------------
它能证明什么、不能证明什么（**这条边界必须说清，否则会得到假结论**）
------------------------------------------------------------------------------
能证明：
  · 模拟核心与 `DiveScene.ts` 的行为一致（清波/商店/决策/死亡路径/确定性）；
  · 视图层**没有用错模拟层 API**（字段名拼错、参数个数不对、类型不匹配）——
    这是移植里最容易出的错，而且只有 tsc 抓得住；
  · 真源与 Cocos 副本没有漂移；
  · 工程骨架自洽：打开编辑器时不会遇到"Missing Script / 悬空引用"这类问题。

**不能**证明：
  · 引擎 API 的真实行为（`Graphics.circle` 画出来什么样、`Node.layer` 默认值、
    相机 zoom 与 UI 相机的配合……）。`cc` 声明桩只是签名，不含实现。
  · 画面是否真的画对了。**这一条只能由你在 Creator 里打开工程、点运行确认。**

所以本脚本绿了 ≠ 能跑；它绿了只说明"进编辑器之前，代码与工程骨架该对的都对上了"。
"""
import glob
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _devstack import ROOT, _node  # noqa: E402
from cocos_uuid import canonical, decompress_uuid, is_compressed_uuid, selfcheck  # noqa: E402

TOOLS = os.path.join(ROOT, 'tools')
WEB = os.path.join(ROOT, 'web')
TSC_JS = os.path.join(WEB, 'node_modules', 'typescript', 'bin', 'tsc')
BUILD_DIR = os.path.join(ROOT, '.tmp', 'sim-build')
COCOS_ASSETS = os.path.join(ROOT, 'cocos', 'assets')

NODE = _node()
steps = []


def run(name, argv, cwd=ROOT):
    print('\n' + '=' * 72)
    print('>>> ' + name)
    print('=' * 72)
    r = subprocess.run(argv, cwd=cwd, encoding='utf-8', errors='replace')
    steps.append((name, r.returncode))
    return r.returncode


# ---------------------------------------------------------------------------
# 4) 工程资源完整性
# ---------------------------------------------------------------------------
def _iter_ids(obj, out):
    """收集该 JSON 子树里所有 {'__id__': n} 的下标。"""
    if isinstance(obj, dict):
        if set(obj.keys()) == {'__id__'} and isinstance(obj['__id__'], int):
            out.append(obj['__id__'])
        for v in obj.values():
            _iter_ids(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _iter_ids(v, out)


def _script_uuid_table():
    """把所有 .ts 的 meta uuid 收成 {32位hex: 相对路径}，供场景引用比对。"""
    table = {}
    for meta in glob.glob(os.path.join(COCOS_ASSETS, '**', '*.ts.meta'), recursive=True):
        try:
            with open(meta, encoding='utf-8') as f:
                uuid = json.load(f).get('uuid', '')
        except Exception as e:                       # noqa: BLE001
            print(f'  ✗ meta 读不动 {meta}：{e}')
            continue
        rel = os.path.relpath(meta[:-len('.meta')], COCOS_ASSETS).replace('\\', '/')
        table[canonical(uuid).replace('-', '')] = rel
    return table


def check_assets():
    print('\n' + '=' * 72)
    print('>>> 工程资源完整性（场景引用 / 脚本类 id / uuid 算法）')
    print('=' * 72)

    errs = []

    # 4.0 压缩 uuid 算法本身：与外层 decode 严格互逆
    try:
        selfcheck()
        print('  ✓ 压缩 uuid 往返自检 20000 例通过')
    except AssertionError as e:
        errs.append(f'压缩 uuid 算法自检失败：{e}')

    scripts = _script_uuid_table()
    print(f'  · 脚本 meta {len(scripts)} 个：' + '、'.join(sorted(scripts.values())))
    if not scripts:
        errs.append('没有找到任何 .ts.meta —— 脚本类 id 无法校验')

    targets = sorted(
        glob.glob(os.path.join(COCOS_ASSETS, '**', '*.scene'), recursive=True) +
        glob.glob(os.path.join(COCOS_ASSETS, '**', '*.prefab'), recursive=True)
    )
    if not targets:
        errs.append('cocos/assets 下没有任何 .scene —— 打开编辑器会看到一个空场景列表')

    for path in targets:
        rel = os.path.relpath(path, ROOT).replace('\\', '/')
        with open(path, encoding='utf-8') as f:
            try:
                doc = json.load(f)
            except Exception as e:                   # noqa: BLE001
                errs.append(f'{rel}: JSON 解析失败 —— {e}')
                continue
        if not isinstance(doc, list):
            errs.append(f'{rel}: 顶层应为数组（Cocos 的索引式序列化）')
            continue

        print(f'  · {rel}：{len(doc)} 个对象')

        # 4.1 所有 __id__ 必须在范围内
        ids = []
        _iter_ids(doc, ids)
        bad_ids = sorted({n for n in ids if not (0 <= n < len(doc))})
        if bad_ids:
            errs.append(f'{rel}: 有 {len(bad_ids)} 个越界 __id__：{bad_ids[:8]}')

        # 4.2 _id 唯一（场景内 id 重复会让编辑器行为诡异）
        seen, dup = set(), set()
        for o in doc:
            if isinstance(o, dict) and isinstance(o.get('_id'), str):
                if o['_id'] in seen:
                    dup.add(o['_id'])
                seen.add(o['_id'])
        if dup:
            errs.append(f'{rel}: _id 重复：{sorted(dup)[:5]}')

        # 4.3 节点树引用自洽
        nodes = [i for i, o in enumerate(doc)
                 if isinstance(o, dict) and o.get('__type__') in ('cc.Node', 'cc.Scene')]
        for i in nodes:
            o = doc[i]
            for key in ('_children', '_components'):
                for ref in (o.get(key) or []):
                    if not isinstance(ref, dict) or '__id__' not in ref:
                        errs.append(f'{rel}: 对象#{i}.{key} 里有个不是引用的项')
                        continue
                    tgt = doc[ref['__id__']]
                    want = 'cc.Node' if key == '_children' else None
                    if want and tgt.get('__type__') != want:
                        errs.append(f'{rel}: 对象#{i}.{key} → #{ref["__id__"]} 不是 {want}')
                    if key == '_components' and not isinstance(tgt, dict):
                        errs.append(f'{rel}: 对象#{i}._components → #{ref["__id__"]} 不是对象')
            par = o.get('_parent')
            if par is not None:
                pt = doc[par['__id__']].get('__type__')
                if pt not in ('cc.Node', 'cc.Scene'):
                    errs.append(f'{rel}: 对象#{i}._parent → #{par["__id__"]} 是 {pt}')

        # 4.4 组件的 node 反指，且 __type__ 是 cc.* 或能解到真实脚本
        for i, o in enumerate(doc):
            if not isinstance(o, dict):
                continue
            t = o.get('__type__')
            if not isinstance(t, str):
                continue
            if 'node' in o and isinstance(o['node'], dict) and '__id__' in o['node']:
                nt = doc[o['node']['__id__']].get('__type__')
                if nt != 'cc.Node':
                    errs.append(f'{rel}: 组件#{i}({t}).node → #{o["node"]["__id__"]} 是 {nt}')
            # 先做「像不像压缩 uuid」的判定：压缩 uuid 以 0-9a-f 开头，
            # 而引擎内置的脚本类（cc.*、sp.*、CCPropertyOverrideInfo 等）不是，
            # 所以能明确二分，不必维护一张内置类型白名单。
            if is_compressed_uuid(t):
                hit = scripts.get(decompress_uuid(t))
                if hit is None:
                    errs.append(
                        f'{rel}: 对象#{i} 的 __type__="{t}" 解出 uuid '
                        f'{decompress_uuid(t)}，但 cocos/assets 下没有对应的 .ts.meta '
                        '→ 编辑器里会显示 Missing Script')
                else:
                    print(f'    · 脚本引用 OK：{t} → {hit}')
            elif t.startswith('cc.') or t.startswith('sp.') or '.' in t or t[:1].isupper():
                pass                                  # 引擎内置类型
            else:
                errs.append(f'{rel}: 对象#{i} 的 __type__="{t}" 既不是内置类型也不像压缩 uuid')

    if errs:
        print('\n  发现 %d 个问题：' % len(errs))
        for e in errs:
            print('  ✗ ' + e)
        steps.append(('工程资源完整性', 1))
        return 1
    print('\n  ✓ 工程资源自洽：无悬空引用、无 Missing Script、uuid 算法互逆')
    steps.append(('工程资源完整性', 0))
    return 0


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

    # 4) 工程资源：场景引用、脚本类 id、压缩 uuid
    check_assets()

    print('\n' + '=' * 72)
    bad = 0
    for name, code in steps:
        print(('PASS  ' if code == 0 else 'FAIL  ') + name)
        bad += (code != 0)
    print(f'--- {len(steps) - bad}/{len(steps)} 个阶段通过 ---')
    print('\n⚠️  以上全绿只代表"静态可验的部分对上了"。')
    print('    引擎 API 的真实行为与画面正确性**无法在沙箱里验证** ——')
    print('    请在 Cocos Creator 3.8.8 里打开 cocos/，直接运行 Dive 场景目视确认。')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
