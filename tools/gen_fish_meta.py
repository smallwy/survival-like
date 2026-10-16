#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为 `cocos/assets/resources/fish/*.png` 生成 / 修正 `.meta`。

------------------------------------------------------------------------------
为什么需要这个脚本（不是一个可以跳过的工序）
------------------------------------------------------------------------------
Cocos 的 `.meta` 里有一整套**由图片尺寸推导出来的**字段：
`trimX / trimY / width / height / rawWidth / rawHeight / offsetX / offsetY`
以及 `vertices.uv / nuv / rawPosition / minPos / maxPos`。

手抄一份 meta（改个名字就交差）会**静默错位** —— 编辑器不一定当场重算，
而错误的表现是"鱼的位置/缩放不对"，**不报错、不红、日志里什么都没有**。
本工程已经因此栽过一次：V6.82 的 6 张新鱼图 meta 全部照抄 `orbit.png.meta`，
于是 `herder`（实际 512×250）带着 `rawHeight: 330` + `trimY: 65` 上了线。

------------------------------------------------------------------------------
口径：统一 `trimType: "none"`
------------------------------------------------------------------------------
· 不用 `"auto"`：那需要把 PNG 的 alpha bbox 精确换算成 trim 值，
  更要正确重建 `uv/nuv` 的重排顺序 —— 收益（省几十 KB 纹理）与风险不成正比。
· 本目录的**老图**（swarm/dash/drift/armor）本来就是 `auto` 且 `bbox == 整图`
  ⇒ `trim = (0,0)`，**与 `none` 视觉等价**；`sub_hull.png` 则是显式 `none`。
· ⇒ 统一 `none` 之后，**新老鱼图的 pivot / originalSize 口径完全一致**，
  渲染层不需要任何按图分支。

模板取 `sub/sub_hull.png.meta`（工程里唯一的显式 `none`）——
**不是"像个模板"**，而是它的 `vertices` 已经是"整图"形态，照尺寸缩放即可，
不需要从别的样本反推序列化顺序。

用法：
    <python> tools/gen_fish_meta.py            # 全部（缺的补、错的修）
    <python> tools/gen_fish_meta.py --check    # 只检查，不写盘
"""

from __future__ import annotations

import argparse
import json
import os
import uuid

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FISH = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'fish')
TEMPLATE = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'sub', 'sub_hull.png.meta')

# 需要生成 / 修正的鱼图（V6.82 六张 + V6.83 七张）
NAMES = [
    'splitter', 'shard', 'bulwark', 'brood', 'kamikaze', 'herder',   # V6.82
    'jelly', 'mimic', 'lancer', 'burrower', 'bloom', 'leech', 'darter', 'spitter',  # V6.83
]


def build_meta(name: str, w: int, h: int) -> dict:
    """按尺寸造一份 `none` 口径的 meta。模板只提供**与尺寸无关的**结构。"""
    tpl = json.load(open(TEMPLATE, encoding='utf-8'))
    u4 = str(uuid.uuid4())
    half_w, half_h = w / 2, h / 2

    out = dict(tpl)
    out['uuid'] = u4
    # ⚠️ 顶层 `displayName`/`name` 只在**模板本来就有**时才写。
    #    凭空加字段 = 造出一份"编辑器没见过的 meta"，语义未定义。
    if 'displayName' in out:
        out['displayName'] = name
    if 'name' in out:
        out['name'] = name
    out['subMetas'] = json.loads(json.dumps(tpl['subMetas']))   # 深拷贝

    for sub_id, sub in out['subMetas'].items():
        sub['uuid'] = f'{u4}@{sub_id}'
        sub['displayName'] = name
        if sub_id == '6c48a':
            sub['userData']['imageUuidOrDatabaseUri'] = u4

    sf = out['subMetas']['f9941']['userData']
    sf['trimThreshold'] = 1
    sf['rotated'] = False
    sf['trimX'] = 0
    sf['trimY'] = 0
    sf['offsetX'] = 0
    sf['offsetY'] = 0
    sf['width'] = w
    sf['height'] = h
    sf['rawWidth'] = w
    sf['rawHeight'] = h
    sf['trimType'] = 'none'
    # uv 是**像素**坐标（y 轴在下）；nuv 是归一化。`none` 口径下就是整图。
    sf['vertices']['uv'] = [0, h, w, h, 0, 0, w, 0]
    sf['vertices']['nuv'] = [0, 0, 1, 0, 0, 1, 1, 1]
    sf['vertices']['rawPosition'] = [
        -half_w, -half_h, 0, half_w, -half_h, 0,
        -half_w, half_h, 0, half_w, half_h, 0,
    ]
    sf['vertices']['minPos'] = [-half_w, -half_h, 0]
    sf['vertices']['maxPos'] = [half_w, half_h, 0]
    out['userData'] = dict(tpl['userData'])
    out['userData']['redirect'] = f'{u4}@6c48a'
    return out


def current_ok(path: str, w: int, h: int) -> bool:
    """现有 meta 是否已经是"正确的 none + 正确尺寸"（`--check` 与幂等用）"""
    if not os.path.exists(path):
        return False
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception:
        return False
    u = d.get('subMetas', {}).get('f9941', {}).get('userData')
    if not u:
        return False
    return (u.get('trimType') == 'none'
            and u.get('rawWidth') == w and u.get('rawHeight') == h
            and u.get('width') == w and u.get('height') == h)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只检查不写盘')
    args = ap.parse_args()

    bad = []
    for name in NAMES:
        png = os.path.join(FISH, name + '.png')
        if not os.path.exists(png):
            print(f'  ⚠️  {name:9s} 缺图（先跑 gen_fish_placeholder.py）')
            continue
        w, h = Image.open(png).size
        meta_path = png + '.meta'
        if current_ok(meta_path, w, h):
            print(f'  ✓ {name:9s} {w}×{h}  已正确')
            continue
        if os.path.exists(meta_path):
            prev = json.load(open(meta_path, encoding='utf-8'))
            old = prev['subMetas']['f9941']['userData']
            why = (f"raw={old.get('rawWidth')}×{old.get('rawHeight')} "
                   f"trim=({old.get('trimX')},{old.get('trimY')}) "
                   f"type={old.get('trimType')}")
        else:
            why = '（无 meta）'
        bad.append(name)
        if args.check:
            print(f'  ✗ {name:9s} {w}×{h}  需要修正 ← {why}')
            continue
        d = build_meta(name, w, h)
        # ⛔ 铁规 7：不直写 —— 先写临时文件再 os.replace（直写若中途报错 = 文件已清空）
        tmp = meta_path + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(d, f, indent=2, ensure_ascii=False)
            f.write('\n')
        os.replace(tmp, meta_path)
        print(f'  ✏️  {name:9s} {w}×{h}  已写 ← 原为 {why}')

    if bad and not args.check:
        print(f'\n[sync_meta] 写入 {len(bad)} 份 meta（trimType: none · 尺寸自 PNG 读出）')
    elif bad:
        print(f'\n[sync_meta] {len(bad)} 份需要修正（--check 未写盘）')
        raise SystemExit(1)
    else:
        print('\n[sync_meta] ✅ 全部正确')


if __name__ == '__main__':
    main()
