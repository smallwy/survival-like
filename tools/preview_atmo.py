"""
远景鱼群观感预览（V6.55）。

复刻 `DiveGame` 的 **drawBg / drawVeil / drawAtmo 三层合成结果**，用来在不打开
Creator 的情况下回答一个问题：**鱼群在每一带的水里，到底读作"一群鱼"还是读作"天上的云"**。

为什么值得单独写一个脚本：这一条已经不是"参数对不对"的问题 —— 上一版每个数值都
合法，合起来却成了"背景飘白云"（用户 2026-10-14 实机反馈）。**只有把合成结果画出来
才看得见"合起来是什么"**，单看任何一个函数都判断不出来。

⚠️ 常量必须与 TS 同步（改了一处不改另一处 = 出一张骗人的图，比没有图更糟）：
  · 压暗 / 色调        → cocos/assets/scripts/view/DiveGame.ts   drawVeil()
  · 鱼群条数 / 尺寸倍率 → shared/dive/tables.ts                  LAYER_ECO
  · 鱼群体色 / alpha   → cocos/assets/scripts/view/DiveGame.ts   ATM_FISH_TINT / ATM_FISH_ALPHA
  · 层的 vis / tint     → shared/dive/tables.ts                  LAYERS

用法：
  python tools/preview_atmo.py               # 5 带各一张，纵向拼图 → docs/shots/atmo_layers.png
  python tools/preview_atmo.py --layer 2     # 只出 L3 → docs/shots/atmo_L3.png
  python tools/preview_atmo.py --old         # 用 V6.53 的旧亮色出 L1，看"白云"是怎么来的
"""

import argparse
import math
import os
import random
from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# 与 TS 同步的常量
# ---------------------------------------------------------------------------
W, H = 1304, 749                       # 设计分辨率
ABYSS = 0x04070D                       # UI.abyss

# shared/dive/tables.ts · LAYERS（只取渲染用到的三个字段）
LAYERS = [
    dict(vis=1.00, tint=0x2A6F8A),     # L1 阳光带
    dict(vis=0.80, tint=0x1D5A5A),     # L2 弱光带
    dict(vis=0.40, tint=0x14203C),     # L3 午夜带
    dict(vis=0.25, tint=0x3A1A10),     # L4 热泉带
    dict(vis=0.10, tint=0x0A0614),     # L5 深渊带
]

# shared/dive/tables.ts · LAYER_ECO（school / schoolSize）
ECO = [
    dict(school=46, schoolSize=0.75, tag='L1 SUNLIT'),
    dict(school=30, schoolSize=0.85, tag='L2 TWILIGHT'),
    dict(school=38, schoolSize=0.95, tag='L3 MIDNIGHT'),
    dict(school=20, schoolSize=0.90, tag='L4 HYDROTHERMAL'),
    dict(school=3,  schoolSize=3.00, tag='L5 ABYSS'),
]

# DiveGame.ts · ATM_FISH_TINT / ATM_FISH_ALPHA（V6.55 新：背光剪影 + 成团）
TINT_NEW = [0x2B5266, 0x5F97A2, 0x74F2CC, 0x8A6A48, 0x33485C]
ALPHA_NEW = [(0.26, 0.44), (0.18, 0.32), (0.22, 0.40), (0.16, 0.30), (0.30, 0.48)]

# DiveGame.ts · buildSchools 的分团参数
PER_CLUSTER_BIG, PER_CLUSTER_SMALL = 1, 6
SPREAD = 62

# V6.53 旧值（只给 --old 对比用）：全亮色 + 低 alpha
TINT_OLD = [0xBFE9FF, 0x9FD8D8, 0xA89CE0, 0xD8A878, 0x6F7BB8]
ALPHA_OLD = [(0.13, 0.28)] * 5

ENV = 'cocos/assets/resources/env/L{}.png'
OUT = 'docs/shots'


def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def cover(img, w, h):
    """按 cover 铺满（与 syncBg 的 max 缩放同规）。"""
    s = max(w / img.width, h / img.height)
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    x = (img.width - w) // 2
    y = (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def draw_schools(layer, tint, alpha, seed=7):
    """在透明层上画远景鱼群（复刻 drawAtmo 的几何：椭圆鱼身 + 三角尾鳍）。"""
    eco, layers = ECO[layer], LAYERS[layer]
    lo, hi = alpha[layer]
    rnd = random.Random(seed + layer * 131)
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    body = rgb(tint[layer]) + (255,)

    big = eco['schoolSize'] > 2
    per = PER_CLUSTER_BIG if big else PER_CLUSTER_SMALL
    clusters = max(1, round(eco['school'] / per))

    for _c in range(clusters):
        cx0 = 40 + rnd.random() * (W - 80)
        cy0 = 40 + rnd.random() * (H - 80)
        dirn = -1 if rnd.random() < 0.5 else 1
        spd = (6 + rnd.random() * 6) if big else (12 + rnd.random() * 20)
        size0 = 26 * eco['schoolSize']
        for _i in range(per):
            gx = (rnd.random() + rnd.random() - 1) * SPREAD
            gy = (rnd.random() + rnd.random() - 1) * SPREAD * 0.7
            vx = dirn * spd * (0.88 + rnd.random() * 0.24)
            size = size0 * (0.78 + rnd.random() * 0.44)
            a = lo + rnd.random() * (hi - lo)
            x, y = cx0 + gx, cy0 + gy
            L, hh = size, size * 0.40

            # 1) 鱼身：椭圆（半轴 L/2, h/2）
            d.ellipse([x - L / 2, y - hh / 2, x + L / 2, y + hh / 2],
                      fill=body[:3] + (round(a * 255),))
            # 2) 尾鳍：复刻 Gfx.tri（ang 为 sim 语义，y 向下顺时针正）
            ang = math.pi if vx > 0 else 0.0
            ca, sa = math.cos(ang), -math.sin(ang)
            tl, tw = L * 0.42, hh * 0.5
            bx, by = x - (1 if vx > 0 else -1) * L * 0.48, y
            p1 = (bx + tl * ca, by - tl * sa)
            p2 = (bx - 0.6 * tl * ca - tw * sa, by + 0.6 * tl * sa - tw * ca)
            p3 = (bx - 0.6 * tl * ca + tw * sa, by + 0.6 * tl * sa + tw * ca)
            d.polygon([p1, p2, p3], fill=body[:3] + (round(a * 255),))
    return lay


def render(layer, tint, alpha, tw, th):
    """一层水：背景图 → tint → 压暗 → 鱼群。返回 RGB 图。"""
    base = Image.open(ENV.format(layer + 1)).convert('RGB')
    base = cover(base, W, H)

    # drawVeil：色调 0.10，再按 (1-vis)*0.42 压向 abyss
    base = Image.blend(base, Image.new('RGB', base.size, rgb(LAYERS[layer]['tint'])), 0.10)
    dark = (1 - LAYERS[layer]['vis']) * 0.42
    if dark > 0.001:
        base = Image.blend(base, Image.new('RGB', base.size, rgb(ABYSS)), dark)

    # drawAtmo：鱼群叠在压暗**之上**（不吃压暗）
    base = base.convert('RGBA')
    base.alpha_composite(draw_schools(layer, tint, alpha))
    base = base.convert('RGB')

    out = base.resize((tw, th), Image.LANCZOS)
    d = ImageDraw.Draw(out)
    d.rectangle([0, 0, tw - 1, 18], fill=rgb(ABYSS))
    d.text((6, 5), ECO[layer]['tag'], fill=(150, 230, 255))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--layer', type=int, default=None, help='只出一层（0-4）')
    ap.add_argument('--old', action='store_true', help='用 V6.53 旧亮色（对比"白云"成因）')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    tint, alpha = (TINT_OLD, ALPHA_OLD) if args.old else (TINT_NEW, ALPHA_NEW)
    suffix = '_old' if args.old else ''

    if args.layer is not None:
        tw = int(W * 0.62)
        img = render(args.layer, tint, alpha, tw, int(tw * H / W))
        path = f'{OUT}/atmo_L{args.layer + 1}{suffix}.png'
        img.save(path)
        print('写入', path, img.size)
        return

    tw = int(W * 0.44)
    th = int(tw * H / W)
    tiles = [render(i, tint, alpha, tw, th) for i in range(5)]
    sheet = Image.new('RGB', (tw, th * 5), rgb(ABYSS))
    for i, t in enumerate(tiles):
        sheet.paste(t, (0, i * th))
    path = f'{OUT}/atmo_layers{suffix}.png'
    sheet.save(path)
    print('写入', path, sheet.size)


if __name__ == '__main__':
    main()
