#!/usr/bin/env python3
"""
敌人立绘的 **36px 剪影可分性闸门**（V6.86）。

-----------------------------------------------------------------------------
为什么需要这个脚本
-----------------------------------------------------------------------------
`docs/生物形状规格_V6.83.md` §5 写了一条**必须做**的验收判据：

    把两张图缩到 36px、涂成纯黑，如果能互换 —— 就该重画。

但那条判据到 V6.85 为止**一直是人眼看**的。人眼在 19 张里逐个两两对比（171 对）
是不可靠的：`swarm` 和 `splitter` 一眼能看出不同（有裂口），但摊到 36px、
又是满屏 150 只的时候，玩家看到的是**同一个剪影**。把"能不能互换"写成数字，
才能拦住"我加了新图但读起来还是只有一种鱼"。

这是 UI 岗的**图标家族一致性检查**（`scripts/ui_asset_tools.py icons`）在敌人立绘上的
同一条方法论：**家族一致性 > 单张惊艳**。

-----------------------------------------------------------------------------
判据与阈值
-----------------------------------------------------------------------------
归一化：裁到 alpha 包围盒 → **长边缩到 36px**（等比，另一维跟着）→ 居中贴到
36×36 的黑mask上。把所有图统一到"长边 36"，等于**抹掉尺寸差，只比形状** ——
这正是"缩到实机大小看剪影"的意思（36px ≈ `swarm` 的实机直径 2×r=38）。

相似度用 **IoU（交并比）**。判据：

    IoU >= 0.72  ⇒  FAIL「36px 下可互换」—— 必须重画其中一个的形状族/识别特征

为什么是 0.72 而不是 0.9：实机是**满屏 150 只、半透明、还在动**，玩家扫一眼
不是做逐像素比对。0.72 已经意味着"轮廓差不到一条描边的宽度"。
阈值可 `--thresh` 覆盖，但**改阈值必须同步改 `生物形状规格_V6.83.md` §5**。

-----------------------------------------------------------------------------
用法
-----------------------------------------------------------------------------
  python tools/check_fish_silhouette.py                  # 校验 + 出对照图
  python tools/check_fish_silhouette.py --thresh 0.78    # 改阈值
  python tools/check_fish_silhouette.py --quiet          # 只列 FAIL
  python tools/check_fish_silhouette.py --no-sheet       # 不写对照图
  python tools/check_fish_silhouette.py --strict         # 应到清单缺图也算 FAIL（闸门模式）

退出码 0 = 无 FAIL / 1 = 有 FAIL（`--strict` 时缺图也算）。
对照图写到 `docs/shots/fish_silhouette_sheet.png`。
"""

import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'web', 'src', 'assets', 'fish')   # ★ 真源（cocos 是它的副本）
SHEET = os.path.join(ROOT, 'docs', 'shots', 'fish_silhouette_sheet.png')

SIL = 36           # 判定尺寸（长边）—— 见文件头"为什么是 36"
GRID = SIL         # 归一化后的画布（正方形，居中）
ALPHA_CUT = 16     # 透明判定阈值（与 check_art.py / gen_fish_meta 同口径）

# 真图与占位剪影的**色数分界**（量化到 32 级后的颜色种数）。
# 真图实测 58 ~ 243（`armor` 最低，因为它是单一钢色金属件）；程序化占位剪影实测 10 ~ 35。
# 取 **50** 做分界：两侧分别留 8 / 15 的余量（比 60 稳 —— 60 会把真图 `armor` 误判成占位）。
REAL_MIN_COLORS = 50

# ---------------------------------------------------------------------------
# 应到清单（V6.87 新增）—— **从 `docs/敌对立绘与前摇交接单_V6.86.md` §2.2 的 20 种总表反推**，
# 不是"磁盘上恰好有什么"。顺序与 §2.2 一致。
# ---------------------------------------------------------------------------
# ⚠️ **为什么必须有这张表**（铁规 15「两张表必须互相对账」在本脚本上的投影）：
#   只扫磁盘的话，"加了一类敌人却忘了出图"**不会红** —— 表现只是图鉴里永远一张剪影
#   或场景里退回上一张贴图，而 `--check` 一路绿。**表里有 ≠ 玩家看得见**。
# `boss_watcher` / `boss_angler` 是用户 2026-10-16 拍板的**新图**
#   （原 `ENEMY_TEX.boss = 'f_dash'`，两个 Boss 共用冲刺体的贴图）；落盘前它们一直待在"待出"。
# ⚠️ 判据：**缺图默认只警告（不 FAIL）**，因为"待出"是正常生产态；要当闸门用加 `--strict`。
EXPECT = [
    'swarm', 'dash', 'drift', 'armor', 'orbit',                 # V6.10 ~ V6.79
    'splitter', 'shard', 'bulwark', 'brood', 'kamikaze', 'herder',   # V6.82
    'jelly', 'mimic', 'lancer', 'burrower', 'bloom', 'leech', 'darter', 'spitter',  # V6.83
    'boss_watcher', 'boss_angler',                              # V6.87 新增（用户拍板单独出图）
]


def font(size):
    for p in (r'C:/Windows/Fonts/msyh.ttc', r'C:/Windows/Fonts/simhei.ttf',
              r'C:/Windows/Fonts/arial.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def silhouette(img):
    """裁到 alpha 包围盒 → 长边缩到 SIL → 居中贴到 SIL×SIL 的黑 mask（返回 bool 2D）。"""
    a = img.convert('RGBA').split()[3]
    bb = a.point(lambda v: 255 if v > ALPHA_CUT else 0).getbbox()
    if bb is None:
        return None, (0, 0)
    a = a.crop(bb)
    w, h = a.size
    k = SIL / max(w, h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    a = a.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('L', (GRID, GRID), 0)
    canvas.paste(a, ((GRID - nw) // 2, (GRID - nh) // 2))
    mask = canvas.point(lambda v: 255 if v > 96 else 0)
    return mask, (w, h)


def colors_of(img):
    """alpha>16 区域量化到 32 级后的颜色种数 —— 用来判"真图 / 程序化占位剪影"。"""
    im = img.convert('RGBA')
    a = im.split()[3].point(lambda v: 255 if v > ALPHA_CUT else 0)
    rgb = im.convert('RGB')
    seen = set()
    px_a, px_r = a.load(), rgb.load()
    w, h = im.size
    step = max(1, int((w * h / 20000) ** 0.5))     # 大图抽样，够用且快
    for y in range(0, h, step):
        for x in range(0, w, step):
            if px_a[x, y]:
                r, g, b = px_r[x, y]
                seen.add((r >> 5, g >> 5, b >> 5))
    return len(seen)


def iou(m1, m2):
    d1, d2 = m1.load(), m2.load()
    inter = union = 0
    for y in range(GRID):
        for x in range(GRID):
            p, q = d1[x, y] > 0, d2[x, y] > 0
            if p or q:
                union += 1
                if p and q:
                    inter += 1
    return inter / union if union else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--thresh', type=float, default=0.72)
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--no-sheet', action='store_true')
    ap.add_argument('--strict', action='store_true',
                    help='应到清单（EXPECT）缺图也算 FAIL —— 当闸门跑时用它')
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        print('[FATAL] 找不到真源目录 %s' % SRC)
        return 2

    names = sorted(f[:-4] for f in os.listdir(SRC) if f.endswith('.png'))
    if not names:
        print('[FATAL] %s 里没有 png' % SRC)
        return 2

    # ★ 两表对账：磁盘上有什么（names） vs 表里该有什么（EXPECT）
    missing = [n for n in EXPECT if n not in names]
    extra = [n for n in names if n not in EXPECT]

    masks, aspect, ncol = {}, {}, {}
    for n in names:
        im = Image.open(os.path.join(SRC, n + '.png'))
        m, (w, h) = silhouette(im)
        if m is None:
            print('[FAIL] %-10s 整张透明 —— 没有可见内容' % n)
            return 1
        masks[n] = m
        aspect[n] = w / h
        ncol[n] = colors_of(im)

    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            pairs.append((iou(masks[a], masks[b]), a, b))
    pairs.sort(reverse=True)

    fails = [p for p in pairs if p[0] >= args.thresh]

    print('=== 敌人立绘 36px 剪影可分性（长边 %dpx · 阈值 %.2f · %d 张 / %d 对）==='
          % (SIL, args.thresh, len(names), len(pairs)))
    print()
    # ★ 两表对账（先报"有没有"，再报"像不像"）
    if missing or extra:
        if missing:
            print('[待出] 应到清单里有、磁盘上没有（%d 张）：%s' % (len(missing), ' '.join(missing)))
            print('       ⇒ 缺图不算 FAIL（生产态正常），但要 `--strict` 时算；'
                  '它们在图鉴/场景里会退回上一张贴图或显示剪影，**不报错**。')
        if extra:
            print('[多余] 磁盘上有、应到清单里没有（%d 张）：%s' % (len(extra), ' '.join(extra)))
            print('       ⇒ 要么是历史中间产物该删，要么是 `EXPECT` 该补一行（本脚本的文件头）。')
        print()
    else:
        print('应到清单 %d 张，全部落盘 ✅' % len(EXPECT))
        print()
    print('%-10s %-9s %-7s %s' % ('file', 'content%', 'colors', '判定'))
    for n in names:
        real = ncol[n] >= REAL_MIN_COLORS
        print('%-10s %-9s %-7d %s' % (
            n, '%.2f' % aspect[n], ncol[n],
            '真图' if real else '占位剪影(程序化)'))
    print()
    show = [p for p in pairs if not args.quiet][:18] if args.quiet else pairs[:18]
    print('--- 相似度 Top（越靠前越像；FAIL 阈值 %.2f）---' % args.thresh)
    for v, a, b in show:
        tag = '  <<<< FAIL 可互换' if v >= args.thresh else ''
        print('  IoU %.3f  %-10s <-> %-10s%s' % (v, a, b, tag))
    print()
    if fails:
        print('结果：**FAIL %d 对** —— 下面每对在 36px 下读作同一个剪影：' % len(fails))
        for v, a, b in fails:
            print('   %.3f  %s  <->  %s' % (v, a, b))
    else:
        print('结果：**PASS** —— 没有一对达到 %.2f，全部可区分。' % args.thresh)
    print()
    print('⚠️ 本判据把长边统一到 %dpx ⇒ **尺寸差被刻意抹掉，只比形状**。' % SIL)
    print('   实机还有第二个线索：半径（`world.ts` 的 `ENEMY_BASE`）。')
    print('   所以"形状撞了但实机尺寸差一大截"的对，危害小于"形状+尺寸都撞"。')

    if not args.no_sheet:
        _sheet(names, masks, aspect, ncol, fails, args.thresh, missing)

    return 1 if (fails or (args.strict and missing)) else 0


def _sheet(names, masks, aspect, ncol, fails, thresh, missing=()):
    """对照图：上行原色缩略，中行 **36px 涂黑剪影**（放大 3×，判据就是这一行），下行标注。
    末尾追加**待出槽位**（应到清单里有、磁盘上没有）—— 让"还缺哪几张"直接出现在图上。"""
    COLS = 5
    CELL_W = 132
    THUMB_H = 46          # 原色缩略区
    SIL_PX = GRID * 3     # 剪影放大 3× = 108
    CELL_H = 10 + THUMB_H + 6 + SIL_PX + 36 + 6
    total = len(names) + len(missing)
    rows = (total + COLS - 1) // COLS
    head = 56
    W, H = COLS * CELL_W, head + rows * CELL_H + 36
    BG = (10, 18, 27)
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    ft, fs, fn = font(20), font(13), font(12)

    d.text((16, 12), '敌人立绘 · 剪影可分性', font=ft, fill=(216, 244, 255))
    d.text((16, 34), '中行 = 实机 36px 涂黑 · 放大 3× · 阈值 IoU %.2f · FAIL %d 对 · '
                     '应到 %d / 落盘 %d / 待出 %d'
                     % (thresh, len(fails), len(EXPECT), len(names), len(missing)),
           font=fn, fill=(150, 170, 190))

    failset = set()
    for _, a, b in fails:
        failset.add(a)
        failset.add(b)

    # 剪影卡片的浅色底（"涂黑剪影"要贴在亮底上才读得准，与深色页面刻意区分）
    TILE = (214, 226, 236)

    for idx, n in enumerate(names):
        cx = (idx % COLS) * CELL_W
        cy = head + (idx // COLS) * CELL_H
        bad = n in failset
        d.rectangle([cx + 5, cy + 4, cx + CELL_W - 5, cy + CELL_H - 4],
                    outline=(255, 46, 99) if bad else (36, 54, 74), width=2)

        # ① 原色缩略
        src = Image.open(os.path.join(SRC, n + '.png')).convert('RGBA')
        a = src.split()[3]
        sb = a.point(lambda v: 255 if v > ALPHA_CUT else 0).getbbox()
        src = src.crop(sb) if sb else src
        k = THUMB_H / max(src.size)
        th = src.resize((max(1, round(src.width * k)), max(1, round(src.height * k))),
                        Image.LANCZOS)
        im.paste(th, (cx + (CELL_W - th.width) // 2, cy + 10), th)

        # ② 36px 涂黑剪影（放大 3×），贴在浅色方砖上
        ty = cy + 10 + THUMB_H + 6
        d.rectangle([cx + 8, ty, cx + CELL_W - 8, ty + SIL_PX], fill=TILE)
        big = Image.new('RGB', (SIL_PX, SIL_PX), TILE)
        m = masks[n].resize((SIL_PX, SIL_PX), Image.NEAREST).load()
        bp = big.load()
        for y in range(SIL_PX):
            for x in range(SIL_PX):
                if m[x, y] > 0:
                    bp[x, y] = (16, 16, 18)
        im.paste(big, (cx + (CELL_W - SIL_PX) // 2, ty))

        # ③ 标注
        ly = ty + SIL_PX + 6
        d.text((cx + CELL_W // 2, ly + 7), n, font=fs,
               fill=(255, 120, 150) if bad else (200, 220, 235), anchor='mm')
        d.text((cx + CELL_W // 2, ly + 23),
               ('%d 色' % ncol[n]) + ('' if ncol[n] >= REAL_MIN_COLORS else ' ·占位剪影'),
               font=fn, fill=(120, 140, 160), anchor='mm')

    # ④ 待出槽位（应到清单有、磁盘没有）—— 空框 + 灰字，让"还缺哪几张"上墙
    for j, n in enumerate(missing):
        idx = len(names) + j
        cx = (idx % COLS) * CELL_W
        cy = head + (idx // COLS) * CELL_H
        d.rectangle([cx + 5, cy + 4, cx + CELL_W - 5, cy + CELL_H - 4],
                    outline=(74, 74, 86), width=2)
        d.line([cx + 5, cy + 4, cx + CELL_W - 5, cy + CELL_H - 4], fill=(58, 58, 70), width=1)
        ty = cy + 10 + THUMB_H + 6
        d.rectangle([cx + 8, ty, cx + CELL_W - 8, ty + SIL_PX], fill=(30, 34, 42))
        d.text((cx + CELL_W // 2, ty + SIL_PX // 2), '待出', font=fs,
               fill=(120, 126, 140), anchor='mm')
        ly = ty + SIL_PX + 6
        d.text((cx + CELL_W // 2, ly + 7), n, font=fs, fill=(150, 156, 172), anchor='mm')
        d.text((cx + CELL_W // 2, ly + 23), '应到清单里有 · 未落盘',
               font=fn, fill=(104, 110, 126), anchor='mm')

    d.text((16, H - 26), '红框 = 与至少一张其它图在 36px 下可互换（需重画形状族或识别特征）',
           font=fn, fill=(255, 120, 150))
    d.text((16, H - 12), '虚线框 = 待出（应到清单里有、磁盘上没有）· 判据已抹掉尺寸差，只比形状',
           font=fn, fill=(120, 140, 160))
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    im.save(SHEET)
    print('对照图 -> %s' % os.path.relpath(SHEET, ROOT).replace('\\', '/'))


if __name__ == '__main__':
    sys.exit(main())
