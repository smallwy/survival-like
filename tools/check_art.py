#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
美术交付验收器（Art Delivery Gate）
===================================

为什么必须有这个脚本
--------------------
本项目两次栽在同一件事上：**规格写了 ≠ 资源达标**。
  · V6.51 写下"每张 env 图 ≥6% 像素亮于 90"这条红线，但当时的 5 张图没按它重出；
  · V6.58 实测才发现 **4/5 张不合格**（L2 5.5% / L3 1.4% / L4 2.6% / L5 0.4%）。
  于是"太黑了"这个用户反馈拖了好几轮，而根因在**资源层**，改渲染层 tint 治不了。

⇒ 把验收从"眼估"挪到"可脚本判定"。**插画岗交付后，第一件事是跑这个脚本，不是看效果图。**

⚠️ 本脚本是**只读**的：不修改任何资产。判 FAIL 时只报告，不动文件。

---------------------------------------------------------------------------
零依赖约束
---------------------------------------------------------------------------
构建环境**没有 numpy**（`process_item_art.py` 用了它，所以那个脚本只能在有 numpy 的机器上跑）。
本脚本**纯 PIL**，与 `key_fish_bg.py` 同款取舍。
另外：pixelgen / 剪影类工具与本题无关，不要混用。

---------------------------------------------------------------------------
用法
---------------------------------------------------------------------------
    python tools/check_art.py env      # 环境图 5 张（真源 + cocos 副本）
    python tools/check_art.py fish     # 敌人贴图
    python tools/check_art.py items    # 道具立绘
    python tools/check_art.py all      # 全部
    python tools/check_art.py all --quiet   # 只打印 FAIL 行

退出码：0 = 全过；1 = 有 FAIL（可挂进 CI / 手动流水线）。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ENV_SRC = ROOT / 'web' / 'src' / 'assets' / 'env'       # ★ 真源（sync_art 从这往 cocos 推）
ENV_COC = ROOT / 'cocos' / 'assets' / 'resources' / 'env'
FISH_DIR = ROOT / 'web' / 'src' / 'assets' / 'fish'     # ★ 敌人贴图真源
ITEM_DIR = ROOT / 'web' / 'src' / 'assets' / 'items'

# ---------------------------------------------------------------------------
# 阈值（全部来自规格文档，改这里必须同步改规格）
# ---------------------------------------------------------------------------
ENV_TARGET = (1536, 1180)      # 画布（V6.58 §1.1）—— 纵向比旧版多 196px 才有滚动余量
ENV_MAX_MB = 0.8               # 单张体积上限
ENV_TOL = (0, 40)              # 画布尺寸容差：不小于目标宽，高度允许 ±40（生成模型难精确）
LUMA_CUT = 90                  # 亮度分界（0-255）
LUMA_MIN_PCT = 6.0             # ★ 亮于 LUMA_CUT 的像素占比下限（对压暗层有 50% 余量）
SEAM_MAX_DIFF = 14.0           # 上下边缘的无缝判据：首行/末行逐列平均绝对差
# ⛔ 只对**无地形带**成立（V6.68 修正）。有海床/地形的带（L3/L4）天然「上水+下床」，
#    首末行必然不同色 —— 那不是缺陷。整图纵向滚动本身也已改成视差（背景不动）。
SEAM_SKIP = {'L3', 'L4'}

# ★ 亮度判据必须**分带**（V6.66 立，V6.68 落到脚本）：判据要匹配「光是怎么分布的」。
#   ⛔ V6.58 的「每张 ≥6% 像素亮于 90」一刀切是错的 —— 强行提亮暗带会让水体变灰绿浑水、
#      暗岩壁被照亮出噪点，「午夜带」当场变成「浑浊白天」，段感全丢。
#   面光源(天光)  → 全画面亮部占比
#   局部光源(荧光/热泉) → **峰值够亮 且 面积够**（两个都要，缺一个就是「要么不亮、要么一小坨」）
#   稀疏微光(深渊雪) → 对比与结构（p50 够暗 + p99 够亮 = 有可辨的微光点）
#   ⚠️ 阈值一律留 ±2 的噪声余量 —— 别把定性判据写成精确判据（FISH_CX 踩过同一个坑）。
LUMA_BY_BAND = {
    'L1': ('area', 40.0),            # 面光源：亮部占比 >= 40%
    'L2': ('area', 12.0),
    'L3': ('local', (130.0, 1.5)),   # 局部光源：p99 >= 130 且 亮部占比 >= 1.5%
    'L4': ('local', (130.0, 1.5)),
    'L5': ('sparse', (42.0, 55.0)),  # 稀疏微光：p50 <= 42 且 p99 >= 55
}

FISH_LONG = 512                # 长边（key_fish_bg.py --long 512）
# 重心 x 区间 —— ⚠️ **只有上界有语义**：>50% = 头朝右 ⇒ 整场鱼反向（这是真错误）。
# 下界原本写 40（照抄三张真图 42/42/46 的最小值减 2），**没有任何语义依据** ——
# 重心偏左（<40%）在语义上恰恰是"头朝左更明显"，完全正确。V6.87 踩：
# `burrower` 左端大幅张开的铲颚把重心压到 39% ⇒ 被判死，而它正是按 brief 画的。
# ⇒ 下界放宽到 30（只挡"整个主体贴到画布最左"这种明显失衡）。
FISH_CX = (0.30, 0.50)

# ★★ 形态族（V6.87）：**质心只对"普通鱼形"可信**。
#   质心 = 面积的一阶矩 ⇒ 一片"大而薄"的尾鳍能把它拉到右边，
#   而这条鱼其实头朝左、完全正确。实测：`lancer` 50% / `darter` 53% 都是这种情况。
#   ⛔ 拿质心去卡非鱼形态 = 烧图去凑一个对目标无效的数目字（V6.87 的教训，见 MEMORY_ART）。
#   ⇒ 非 `fish` 族的重心**只 WARN 不 FAIL**，「头朝左」由目视确认（本来也要一张张看）。
FISH_FAMILY = {
    'shard':    'frag',      # 碎片群：无头无尾，体量分布本就自由
    'mimic':    'frag',      # E 族碎屑：**唯一不许对称**的 ⇒ 重心本就任意
    # C 巢形：圆鼓囊体、**没有头也没有尾** ⇒ 重心天然落在 50% 附近，
    #   用鱼形的 40~50% 去卡必然判死（brood 实测 50% —— 这个坑 V6.87 踩了三次才按族修）。
    'brood':    'blob',
    'bloom':    'blob',
    'spitter':  'blob',
    'lancer':   'spear',     # 矛形：体量是长矛本身，尾只是一小片
    'darter':   'bigtail',   # 身体在左 + 大 V 尾在右（薄而大 ⇒ 质心天然右偏）
    'orbit':    'ring',      # 触须绕成环 ⇒ 主剪影是环，重心天然居中偏右
}
# 各族重心的**提示区间**（超出 = WARN，不是 FAIL）
# ⚠️ 加族时**两边都要加**；取值用 `.get(fam, FISH_CX_SOFT_DEFAULT)`，
#    漏一个键只会 KeyError 把整个闸门打崩（V6.87 踩：`orbit` 加进 FISH_FAMILY 却忘加这里）。
FISH_CX_SOFT_DEFAULT = (0.30, 0.70)
FISH_CX_SOFT = {
    'frag':    (0.30, 0.60),
    'spear':   (0.30, 0.60),
    'bigtail': (0.40, 0.62),
    'ring':    (0.35, 0.70),   # 环：触须绕圈 ⇒ 重心天然居中偏右
}
FISH_EDGE_SLACK = 2            # "裁到内容"允许的贴边容差（px/边）
FISH_MIN_SIDE = 64             # 长边之外的短边下限，防"一根细条"

ITEM_CANVAS = (1200, 600)      # 2:1（process_item_art.py CANVAS_W/H）
# ⚠️ `FILL 0.86` 是**内容高度占画布高度**的比例（实测 29 张全部 = 516/600 = 0.86），
#    宽度按内容原始比例 contain ⇒ 宽度占比随道具本身长宽比变化，**不能拿宽度判**。
ITEM_FILL_H = 0.86
ITEM_FILL_TOL = 0.02
ITEM_MIN_W = 100               # 内容宽度下限（防"一根竖线"）

OK, BAD, WARN = 'OK  ', 'FAIL', 'WARN'


def _alpha(img: Image.Image) -> Image.Image:
    return img.convert('RGBA').getchannel('A')


def bbox_of(img: Image.Image):
    return _alpha(img).getbbox()


def centroid_x(img: Image.Image) -> float:
    """主体重心 x（归一到 0~1）。用 alpha 逐列质量和 —— 纯 PIL，与 V6.58 §5 同算法。"""
    a = _alpha(img)
    w, h = a.size
    col = a.resize((w, 1), Image.BOX).tobytes()   # 逐列均值（tobytes 避开 getdata 弃用）
    s = sum(col)
    if s <= 0:
        return 0.5
    return sum(i * n for i, n in enumerate(col)) / s / w


def luma_stats(img: Image.Image, cut: int = LUMA_CUT):
    """返回 (亮于 cut 的像素占比 %, 平均亮度)。"""
    h = img.convert('L').histogram()
    t = sum(h) or 1
    bright = sum(h[cut + 1:]) / t * 100
    mean = sum(i * n for i, n in enumerate(h)) / t
    return bright, mean


def luma_pct(img: Image.Image, q: float) -> float:
    """亮度分位数（q 取 0~100）。用于**分带**亮度判据：局部亮区看 p98，深渊雪看 p50/p99。"""
    h = img.convert('L').histogram()
    t = sum(h) or 1
    need, acc = t * q / 100.0, 0
    for i, n in enumerate(h):
        acc += n
        if acc >= need:
            return float(i)
    return 255.0


def edge_seam(img: Image.Image) -> float:
    """
    上下无缝判据：首行与末行逐列的平均绝对亮度差。
    滚动 wrap 时这两行会相邻 —— 差值大 = 一条可见的横向硬边。
    """
    g = img.convert('L')
    w, h = g.size
    top = list(g.crop((0, 0, w, 1)).tobytes())
    bot = list(g.crop((0, h - 1, w, h)).tobytes())
    return sum(abs(a - b) for a, b in zip(top, bot)) / w


def row(name, tag, detail):
    print(f'[{tag}] {name:<20} {detail}')
    return tag == BAD


# ---------------------------------------------------------------------------
# env
# ---------------------------------------------------------------------------
def check_env(quiet=False) -> int:
    print('=' * 78)
    print('环境图 env  —— 判据：画布 / 体积 / 亮度(分带) / 上下无缝(仅无地形带 L1/L2/L5)')
    print('=' * 78)
    fails = 0
    for d, label in ((ENV_SRC, '真源 webp'), (ENV_COC, 'cocos 副本')):
        if not d.exists():
            print(f'  (跳过 {d} —— 不存在)')
            continue
        print(f'\n--- {label}  {d.relative_to(ROOT)} ---')
        files = sorted([p for p in d.iterdir()
                        if p.suffix.lower() in ('.png', '.webp')
                        and p.stem.startswith('L') and len(p.stem) <= 2])
        if not files:
            print('  (无文件)')
        for p in files:
            try:
                img = Image.open(p)
            except Exception as e:
                fails += row(p.name, BAD, f'打不开: {e}')
                continue
            w, h = img.size
            mb = os.path.getsize(p) / 1e6
            bright, mean = luma_stats(img)
            seamed = edge_seam(img)
            band = p.stem[:2]

            bad = []
            if w < ENV_TARGET[0] or abs(h - ENV_TARGET[1]) > ENV_TOL[1]:
                bad.append(f'画布 {w}x{h} (目标 {ENV_TARGET[0]}x{ENV_TARGET[1]}±{ENV_TOL[1]})')
            if mb > ENV_MAX_MB:
                bad.append(f'体积 {mb:.2f}MB > {ENV_MAX_MB}')

            # ---- 亮度：分带判据（面光源 / 局部光源 / 稀疏微光）----
            mode, thr = LUMA_BY_BAND.get(band, ('area', LUMA_MIN_PCT))
            if mode == 'area':
                if bright < thr:
                    bad.append(f'亮度(面光源) 亮部 {bright:.1f}% < {thr}%')
            elif mode == 'local':
                p99 = luma_pct(img, 99)
                pk, area = thr
                if p99 < pk:
                    bad.append(f'亮度(局部光源) 峰值 p99 {p99:.0f} < {pk:.0f} —— 亮区不够亮')
                if bright < area:
                    bad.append(f'亮度(局部光源) 亮部占比 {bright:.1f}% < {area}% —— 亮区太小')
            else:  # sparse
                p50, p99 = luma_pct(img, 50), luma_pct(img, 99)
                q50, q99 = thr
                if p50 > q50 or p99 < q99:
                    bad.append(f'亮度(稀疏微光) p50 {p50:.0f}(<={q50:.0f}) / p99 {p99:.0f}(>={q99:.0f}) 不达标')

            # ---- 上下无缝：仅无地形带（有海床的带首末行天然不同色）----
            if band not in SEAM_SKIP and seamed > SEAM_MAX_DIFF:
                bad.append(f'上下不无缝(首末行差 {seamed:.1f} > {SEAM_MAX_DIFF})')

            p98 = luma_pct(img, 98)
            p50, p99 = luma_pct(img, 50), luma_pct(img, 99)
            seam_note = '  n/a' if band in SEAM_SKIP else f'{seamed:5.1f}'
            detail = (f'{w}x{h} {mb:.2f}MB 亮{bright:5.1f}% 均{mean:5.1f} '
                      f'p50/p98/p99 {p50:.0f}/{p98:.0f}/{p99:.0f} 缝{seam_note}')
            if bad:
                if not quiet:
                    print(f'[{BAD}] {p.name:<20} {detail}')
                    for b in bad:
                        print(f'         └─ {b}')
                else:
                    print(f'[{BAD}] {p.name:<20} ' + ' | '.join(bad))
                fails += 1
            elif not quiet:
                row(p.name, OK, detail)
    return fails


# ---------------------------------------------------------------------------
# fish（敌人贴图）
# ---------------------------------------------------------------------------
def check_fish(quiet=False) -> int:
    print('\n' + '=' * 78)
    print('敌人贴图 fish  —— 判据：长边 512 / 裁到内容 / 重心 x 40~48%（头朝左）/ 四角透明')
    print('=' * 78)
    fails = 0
    if not FISH_DIR.exists():
        print(f'  (目录不存在 {FISH_DIR})')
        return 0
    for p in sorted(FISH_DIR.glob('*.png')):
        img = Image.open(p).convert('RGBA')
        w, h = img.size
        bb = bbox_of(img)
        cx = centroid_x(img)
        # 四角必须透明（抠底干净）
        px = img.load()
        corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
        corners_clear = all(a == 0 for a in corners)

        bad = []
        if max(w, h) != FISH_LONG:
            bad.append(f'长边 {max(w, h)} != {FISH_LONG}')
        if min(w, h) < FISH_MIN_SIDE:
            bad.append(f'短边 {min(w, h)} < {FISH_MIN_SIDE}（细条）')
        if bb is None:
            bad.append('全透明（没有主体）')
        else:
            x0, y0, x1, y1 = bb
            # 裁到内容：包围盒须贴住至少 3 边（允许 FISH_EDGE_SLACK）
            slack = FISH_EDGE_SLACK
            touching = sum([x0 <= slack, y0 <= slack, w - x1 <= slack, h - y1 <= slack])
            if touching < 3:
                bad.append(f'未裁到内容（包围盒 {bb} 只贴 {touching}/4 边）'
                           f'—— 透明边会让引擎里显示变小')
        # 重心：按形态族判（见 FISH_FAMILY 注释 —— 质心对非鱼形态不可信）
        fam = FISH_FAMILY.get(p.stem, 'fish')
        soft = []
        if fam == 'fish':
            if not (FISH_CX[0] <= cx <= FISH_CX[1]):
                bad.append(f'重心 x {cx * 100:.0f}% 不在 {FISH_CX[0] * 100:.0f}~{FISH_CX[1] * 100:.0f}%'
                           f'（>50% = 头朝右，整场鱼会反向）')
        else:
            lo, hi = FISH_CX_SOFT.get(fam, FISH_CX_SOFT_DEFAULT)
            if not (lo <= cx <= hi):
                soft.append(f'重心 x {cx * 100:.0f}% 超出 {fam} 族提示区间'
                            f' {lo * 100:.0f}~{hi * 100:.0f}%（质心对 {fam} 形态不可信，'
                            f'请以目视「头朝左」为准）')
        if not corners_clear:
            bad.append(f'四角不透明 {corners}（抠底没抠干净）')

        detail = f'{w}x{h} 重心{cx * 100:4.0f}% 四角透明={corners_clear}' + (
            '' if fam == 'fish' else f' [{fam}]')
        if bad:
            if not quiet:
                print(f'[{BAD}] {p.name:<20} {detail}')
                for b in bad:
                    print(f'         └─ {b}')
            else:
                print(f'[{BAD}] {p.name:<20} ' + ' | '.join(bad))
            fails += 1
        elif soft:
            # WARN 不计入 fails —— 它只是"人眼该看一眼"，不是几何错误
            if not quiet:
                print(f'[{WARN}] {p.name:<20} {detail}')
                for b in soft:
                    print(f'         └─ {b}')
            else:
                print(f'[{WARN}] {p.name:<20} ' + ' | '.join(soft))
        elif not quiet:
            row(p.name, OK, detail)
    return fails


# ---------------------------------------------------------------------------
# items（道具立绘）
# ---------------------------------------------------------------------------
def check_items(quiet=False) -> int:
    print('\n' + '=' * 78)
    print('道具立绘 items  —— 判据：画布 1200x600 / 内容高度占 86% / 内容不贴边 / 四角透明')
    print('=' * 78)
    fails = 0
    if not ITEM_DIR.exists():
        print(f'  (目录不存在 {ITEM_DIR})')
        return 0
    files = sorted([p for p in ITEM_DIR.glob('item_*.png')])
    print(f'  共 {len(files)} 张')
    for p in files:
        img = Image.open(p).convert('RGBA')
        w, h = img.size
        bb = bbox_of(img)
        bad = []
        if (w, h) != ITEM_CANVAS:
            bad.append(f'画布 {w}x{h} != {ITEM_CANVAS} (比例 {w / h:.2f})')
        if bb is None:
            bad.append('全透明（没有主体）')
            fh = cw = 0
        else:
            x0, y0, x1, y1 = bb
            cw, ch = x1 - x0, y1 - y0
            fh = ch / h
            if abs(fh - ITEM_FILL_H) > ITEM_FILL_TOL:
                bad.append(f'内容高度占 {fh * 100:.0f}% 偏离 {ITEM_FILL_H * 100:.0f}%'
                           f'±{ITEM_FILL_TOL * 100:.0f}')
            if cw < ITEM_MIN_W:
                bad.append(f'内容宽 {cw}px < {ITEM_MIN_W}（细条）')
            if x0 <= 0 or y0 <= 0 or x1 >= w or y1 >= h:
                bad.append(f'内容贴边（包围盒 {bb}）—— 卡面会被切')
        px = img.load()
        corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
        if not all(a == 0 for a in corners):
            bad.append('四角不透明（抠底没抠干净）')

        detail = f'{w}x{h} 高占{fh * 100:4.0f}% 宽{cw:4d}px'
        if bad:
            if not quiet:
                print(f'[{BAD}] {p.name:<28} {detail}')
                for b in bad:
                    print(f'         └─ {b}')
            else:
                print(f'[{BAD}] {p.name:<28} ' + ' | '.join(bad))
            fails += 1
        elif not quiet:
            row(p.name, OK, detail)
    return fails


def main() -> int:
    ap = argparse.ArgumentParser(description='美术交付验收器（只读）')
    ap.add_argument('what', nargs='?', default='all',
                    choices=['env', 'fish', 'items', 'all'])
    ap.add_argument('--quiet', action='store_true', help='只打印 FAIL')
    args = ap.parse_args()

    fails = 0
    if args.what in ('env', 'all'):
        fails += check_env(args.quiet)
    if args.what in ('fish', 'all'):
        fails += check_fish(args.quiet)
    if args.what in ('items', 'all'):
        fails += check_items(args.quiet)

    print('\n' + '=' * 78)
    if fails:
        print(f'>>> {fails} 项不合格。插画岗重出后重跑本脚本，全绿再走 sync_art。')
        print('>>> 提醒：闸门在资源层，不在渲染层。改 tint / 压暗系数治不了"太黑"。')
    else:
        print('>>> 全部通过。可以走 tools/sync_art.py 同步到 cocos。')
    print('=' * 78)
    return 1 if fails else 0


if __name__ == '__main__':
    raise SystemExit(main())
