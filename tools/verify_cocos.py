#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Cocos 侧**离线**验证（不需要 GUI 编辑器）。

一条命令跑七件事：
  1. 真源漂移检查 —— `shared/` 与 `cocos/assets/scripts/shared/` 是否一致；
  2. 模拟核心无头冒烟 —— 编译 `shared/dive` 为 CJS 真跑，31 条不变量断言；
  3. 视图层类型检查 —— 把 `cocos/assets/scripts/**` 全量过 tsc；
  4. 美术完整性 —— 源图与 cocos 副本是否一致，以及**代码会去要的每个 key
     在磁盘上是否真有对应文件**（反向也查残留）；
  5. 工程资源完整性 —— 场景/prefab 的 `__id__` 引用、`_id` 唯一性，以及
     **脚本类 id ↔ .ts.meta uuid** 是否对得上（压缩 uuid 算法错了就红在这）；
  6. 模块图自检 —— 源码里每条相对 import 都能命中磁盘上的真实模块，且**编辑器
     增量编译的解析表里没有未解析项**。最后这条专门堵"源码全对、编辑器里却全黑"
     这种假绿（2026-10-13 真的踩到过，见 check_module_graph 的注释）。

------------------------------------------------------------------------------
第 3 步用哪份 `cc` 声明：优先用**引擎自带的那份**
------------------------------------------------------------------------------
按下面顺序找，找到就用，找不到才退回 `tools/cocos_cc_stub.d.ts`：

  1. 环境变量 `COCOS_ENGINE_DTS`
  2. `C:/ProgramData/cocos/editors/Creator/<版本>/resources/resources/3d/engine/
     bin/.declarations/cc.d.ts`（本机 3.8.8 就装在这）

**为什么这件事重要**：手写的声明桩是"按我的理解"写的，它只能验证"代码是否
符合我的假设"。本项目真的因此漏过一次 —— 桩里我顺手写了 `Camera.zoom`，于是
检查通过；换成引擎真声明后立刻报错，Cocos 3.8 的 `Camera` 根本没有 `zoom`
（只有 `orthoHeight`，而那是 Canvas 托管的状态）。**桩越像真的，假绿越危险。**

------------------------------------------------------------------------------
它能证明什么、不能证明什么（**这条边界必须说清，否则会得到假结论**）
------------------------------------------------------------------------------
能证明：
  · 模拟核心与 `DiveScene.ts` 的行为一致（清波/商店/决策/死亡路径/确定性）；
  · 视图层**没有用错模拟层 API，也没有用错引擎 API**（字段名拼错、参数个数不对、
    属性根本不存在……）—— 这是移植里最容易出的错，而且只有 tsc 抓得住；
  · 真源与 Cocos 副本没有漂移；美术亦然（且"表里加了 id、图却没同步"会红）；
  · 工程骨架自洽：打开编辑器时不会遇到"Missing Script / 悬空引用"这类问题。

**不能**证明：
  · 引擎 API 在**运行期**的真实行为（`Graphics.ellipse` 画出来什么样、
    节点缩放与 UI 相机的配合、Sprite 的混合模式……）。类型只说明签名对。
  · 画面是否真的画对了。**这一条只能由你在 Creator 里打开工程、点运行确认。**

所以本脚本绿了 ≠ 能跑；它绿了只说明"进编辑器之前，代码与工程骨架该对的都对上了"。
"""
import glob
import json
import os
import re
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
COCOS_RES = os.path.join(COCOS_ASSETS, 'resources')
CHECK_TSCONFIG = os.path.join(ROOT, '.tmp', 'cocos_check.json')

NODE = _node()
steps = []

# ---------------------------------------------------------------------------
# 找引擎自带的 cc.d.ts（见文件头"第 3 步用哪份 cc 声明"）
# ---------------------------------------------------------------------------
_EDITOR_BASES = [
    'C:/ProgramData/cocos/editors/Creator',                       # 本机 3.8.8
    os.path.expanduser('~/.CocosCreator/editors/Creator'),
    os.path.expanduser('~/AppData/Roaming/CocosCreator/editors/Creator'),
    'C:/Program Files/Cocos/Creator',
]
_DTS_REL = 'resources/resources/3d/engine/bin/.declarations/cc.d.ts'


def find_engine_dts():
    """引擎自带的 cc.d.ts 路径；找不到返回 None（退回手写桩）。"""
    env = os.environ.get('COCOS_ENGINE_DTS')
    if env:
        return env if os.path.isfile(env) else None
    hits = []
    for base in _EDITOR_BASES:
        hits += glob.glob(os.path.join(base, '*', _DTS_REL))
    if not hits:
        return None

    def ver_key(p):
        parts = p.replace('\\', '/').split('/')
        try:
            i = parts.index('Creator')
            return [int(x) for x in parts[i + 1].split('.') if x.isdigit()]
        except Exception:                                    # noqa: BLE001
            return [0]

    return sorted(hits, key=ver_key)[-1]


def write_check_tsconfig(engine_dts) -> str:
    """生成类型检查用的 tsconfig。

    **在 Python 里生成**，而不是仓库里放一份静态文件：`cc` 声明的位置是机器相关
    的，静态文件必须"按机器改"，那就一定会有人忘了改、然后得到一份假绿。
    """
    cc = engine_dts.replace('\\', '/') if engine_dts else '../tools/cocos_cc_stub.d.ts'
    cfg = {
        'compilerOptions': {
            'noEmit': True,
            'strict': True,
            'target': 'ES2020',
            'module': 'ES2020',
            'moduleResolution': 'node',
            'skipLibCheck': True,
            'lib': ['ES2020', 'DOM'],
            'experimentalDecorators': True,
            'useDefineForClassFields': False,
            'forceConsistentCasingInFileNames': True,
            'types': [],
        },
        'include': ['../cocos/assets/scripts/**/*.ts', cc],
    }
    os.makedirs(os.path.dirname(CHECK_TSCONFIG), exist_ok=True)
    with open(CHECK_TSCONFIG, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write('\n')
    return cc


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


# ---------------------------------------------------------------------------
# 美术完整性
# ---------------------------------------------------------------------------
def check_art():
    print('\n' + '=' * 72)
    print('>>> 美术完整性（源↔副本一致 / 代码会要的 key 在磁盘上都有）')
    print('=' * 72)

    errs = []

    # 4.1 源 ↔ 副本：交给 sync_art.py --check（它做的是双侧哈希核对，
    #     源变了、或 cocos 侧副本被手改，两种都能查出来）
    print('  · 源↔副本漂移（web/src/assets → cocos/assets/resources）')
    r = subprocess.run([sys.executable, os.path.join(TOOLS, 'sync_art.py'), '--check'],
                       cwd=ROOT, encoding='utf-8', errors='replace',
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for line in (r.stdout or '').strip().splitlines():
        print('      ' + line)
    if r.returncode != 0:
        errs.append('美术源与副本不一致（见上面 sync_art 的输出）')

    # 4.2 代码会去要的每个 key，磁盘上是否真有文件 —— 而且是**运行时同一份表**：
    #     artPaths() 来自 shared/dive/artKeys.ts，跟 cocos 视图层用的是同一个函数。
    idx = os.path.join(BUILD_DIR, 'dive', 'index.js')
    if not os.path.isfile(idx):
        errs.append('模拟核心没编译出来，读不到 artPaths()（先看第 2 步）')
        paths = None
    else:
        js = "const m=require(process.argv[1]);process.stdout.write(JSON.stringify(m.artPaths()))"
        r = subprocess.run([NODE, '-e', js, idx], cwd=ROOT, encoding='utf-8',
                           errors='replace', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            errs.append('读取 artPaths() 失败：' + (r.stderr or '').strip()[:300])
            paths = None
        else:
            paths = json.loads(r.stdout)

    if paths is not None:
        disk = set()
        for dirpath, _dirs, files in os.walk(COCOS_RES):
            for fn in files:
                rel = os.path.relpath(os.path.join(dirpath, fn), COCOS_RES).replace('\\', '/')
                if rel.endswith('.png'):
                    disk.add(rel[:-4])
                elif rel.endswith('.meta'):
                    continue            # 编辑器给每张图生成的 .png.meta
                else:
                    errs.append(f'resources 下有非 PNG 文件：{rel}')

        want = set(paths.values())
        missing = sorted(k for k in paths if paths[k] not in disk)
        orphans = sorted(disk - want)

        print(f'  · artPaths() 给出 {len(paths)} 个 key；'
              f'resources 下 {len(disk)} 个 PNG；对得上 {len(want & disk)} 个')

        for k in missing[:15]:
            errs.append(f'key "{k}" → 需要 {paths[k]}.png，磁盘上没有（跑 python tools/sync_art.py）')
        if len(missing) > 15:
            errs.append(f'…另有 {len(missing) - 15} 个缺失')
        for o in orphans[:15]:
            errs.append(f'磁盘上有 {o}.png，但没有任何 art key 指向它（残留 / 未登记）')
        if len(orphans) > 15:
            errs.append(f'…另有 {len(orphans) - 15} 个多余')

    if errs:
        print(f'\n  发现 {len(errs)} 个问题：')
        for e in errs:
            print('  ✗ ' + e)
        steps.append(('美术完整性', 1))
        return 1
    print('\n  ✓ 美术完整：源与副本一致，且"代码会要的每一张图"都在磁盘上')
    steps.append(('美术完整性', 0))
    return 0


COCOS_DIR = os.path.join(ROOT, 'cocos')
_RESOLUTION_MAP = os.path.join(
    COCOS_DIR, 'temp', 'programming', 'packer-driver', 'targets', 'editor',
    'resolution-detail-map.json')

# 相对模块说明符：`import … from 'x'` / `export … from 'x'`。本项目不用裸说明符
# （除了 'cc' 与 'cc/env'），所以只查相对路径。
_FROM_RE = re.compile(r"""\bfrom\s*['"]([^'"]+)['"]""")
# 扫描前必须剥掉注释 —— 否则**文档里的示例代码**会被当成真 import（实测踩到：
# itemArt.ts / subs.ts 的注释里各写了一句 `import X from '...png'` 做对照说明）。
_BLOCK_COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)
_LINE_COMMENT_RE = re.compile(r'^\s*//.*$', re.M)


def _strip_comments(text):
    """只剥"块注释"和"整行以 // 开头"的行注释。

    为什么不像语法分析那样剥掉所有 `//`：`https://…` 这类字符串会被砍成半截。
    代价是"代码行尾的注释"里如果正好写了 `from 'x'` 仍会误报 —— 本项目没有这种写法，
    真出现了也会立刻红在这一阶段，不会静默。
    """
    text = _BLOCK_COMMENT_RE.sub('', text)
    return _LINE_COMMENT_RE.sub('', text)


def _resolve_spec(base_dir, spec):
    """把相对说明符解析到一个真实存在的 .ts 文件；解析不到返回 None。

    候选顺序照 Cocos/TS 的惯例：原样 → 补 `.ts` → 当目录取 `index.ts`。
    源码里写 `.js`（ESM 风格）时要先把后缀摘掉再试 —— Creator 的 packer 也是这么做的。
    """
    p = os.path.normpath(os.path.join(base_dir, spec))
    if spec.endswith('.js'):
        p = p[:-3]
    for c in (p, p + '.ts', os.path.join(p, 'index.ts')):
        if os.path.isfile(c):
            return c
    return None


def check_module_graph():
    """模块图自检。

    两条独立检查，射程不同、缺一不可：
      ① **静态**：`assets/scripts/**/*.ts` 里每条相对 import 都能在磁盘上命中。
         抓的是"引用了还没建/没同步过来的文件"。
      ② **产物**：编辑器增量编译留下的解析表里 **不允许有 `__unresolved_*` 条目**。
         抓的是"文件后来出现了，但增量编译没有回头重解析"。

    --------------------------------------------------------------------------
    为什么必须加这一阶段（2026-10-13 真实事故，前 5 个阶段**全是绿的**）
    --------------------------------------------------------------------------
    在 Creator 已经打开工程时新增了一个被 import 的模块（`shared/dive/profile.ts`），
    而 importer（`view/save.ts`）在模块还不存在时**已经被编译过一次** —— 那次解析
    失败，于是 importer 没被登记成 `profile.ts` 的依赖方。5 分钟后模块出现在磁盘上，
    但**没有任何东西会去触发 importer 重编译**，它就带着那条失败的 import 一直躺在缓存里。

    后果不是"少个特效"，而是整条链断掉：`save.ts` 加载失败 → `DiveGame.ts` 的
    import 链断 → 场景里挂的 `DiveGame` 组件变成 `Missing class` →
    **编辑器里一片全黑，且控制台只说是"脚本缺失"**。而本脚本当时报 6/6 全绿。

    也就是说：**这一阶段补的是一个"假绿"缺口**，不是一个新的功能检查。
    注意第 ② 条要求编辑器至少编译过一次本工程（`temp/` 存在）；没跑过就只能查第 ① 条。
    """
    problems = []

    # ---- ① 静态：源码 vs 磁盘 ----
    scripts_dir = os.path.join(COCOS_ASSETS, 'scripts')
    n_checked = 0
    for dirpath, _dirs, files in os.walk(scripts_dir):
        for name in files:
            if not name.endswith('.ts'):
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding='utf-8') as fh:
                text = _strip_comments(fh.read())
            for spec in _FROM_RE.findall(text):
                if not spec.startswith('.'):
                    continue          # 'cc' 之类的内置模块，不归我们管
                n_checked += 1
                if not _resolve_spec(dirpath, spec):
                    rel = os.path.relpath(path, COCOS_DIR)
                    problems.append(f'{rel} 里的 import "{spec}" 在磁盘上找不到对应文件')

    # ---- ② 产物：编辑器的解析表 ----
    artifact_note = ''
    if os.path.isfile(_RESOLUTION_MAP):
        try:
            with open(_RESOLUTION_MAP, encoding='utf-8') as fh:
                table = json.load(fh)
        except Exception as e:                                  # noqa: BLE001
            artifact_note = f'解析表读不动（{e}），产物检查跳过'
        else:
            for chunk, recs in table.items():
                if not isinstance(recs, dict):
                    continue
                for key, rec in recs.items():
                    if '__unresolved' not in str(key):
                        continue
                    msg = rec.get('error', '') if isinstance(rec, dict) else str(rec)
                    problems.append(
                        f'编辑器编译产物里仍有未解析的 import（chunk {chunk}）：{msg.splitlines()[0]}')
    else:
        artifact_note = '未找到 packer-driver 解析表（编辑器还没编译过本工程），产物检查跳过'

    if problems:
        for p in problems:
            print(f'  ✗ {p}')
        if any('未解析' in p for p in problems):
            print('    → 这一类是**增量编译的旧账**：该 importer 在模块还不存在时被编译过一次，'
                  '失败的那条边没登记依赖，于是永远不会自动重编译。')
            print('      解法：改动一下那个 importer 文件（或删掉 cocos/temp/programming 让它全量重建），'
                  '让编辑器重新解析。')
        if artifact_note:
            print(f'    （{artifact_note}）')
        steps.append(('模块图自检', 1))
        return 1

    if artifact_note:
        print(f'  ! {artifact_note}')
    print(f'\n  ✓ 模块图自洽：{n_checked} 条相对 import 全部命中磁盘上的真实模块，'
          '且编辑器产物里没有未解析项')
    steps.append(('模块图自检', 0))
    return 0


def main():
    print(f'使用 node：{NODE}')

    engine_dts = find_engine_dts()
    cc = write_check_tsconfig(engine_dts)

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

    # 3) 视图层：全量类型检查（cc 声明优先用引擎自带那份）
    if engine_dts:
        print(f'\ncc 声明 = 引擎自带：{cc}')
        print('           → 检查的是**真**引擎 API（不是我们的假设）')
    else:
        print(f'\ncc 声明 = 手写桩：{cc}')
        print('           ⚠️ 未找到引擎安装，本次只验证"代码是否符合我们的假设"。')
        print('              装了 Cocos 后重跑，或设 COCOS_ENGINE_DTS 指向 cc.d.ts。')
    run('视图层类型检查',
        [NODE, TSC_JS, '-p', CHECK_TSCONFIG])

    # 4) 美术：源↔副本 + "代码会要的 key 是否都在磁盘上"
    check_art()

    # 5) 工程资源：场景引用、脚本类 id、压缩 uuid
    check_assets()

    # 6) 模块图：源码里的相对 import 是否都能命中，以及编辑器产物里有没有未解析项
    #    这一阶段补的是"假绿"缺口 —— 详见函数注释里记的那次真实事故。
    check_module_graph()

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
