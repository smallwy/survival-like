#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
战斗内潜航器**侧视剖面**（V6.54）静态预览渲染器。

干什么用
--------
`DiveGame.ts` 的 `drawBody()` 是运行时 `Graphics` 画的，改一个比例常量要开 Creator
才能看到结果，一轮反馈几分钟。这个脚本用 PIL 复刻同一套几何
（**常量从 DiveGame.ts 抄，改了要同步**），直接出图 ——
艇形像不像潜艇、炮位有没有压在艇舷上、缩到 44px 还认不认得出，看一眼就知道。

它**不是**像素级还原：Cocos 的描边端点、抗锯齿与 PIL 不同，
但"哪层压着哪层""炮心在轮廓内还是外"这类判断是一致的。

用法
----
    python tools/preview_hull_side.py              # 出主图（含座圈校验）
    python tools/preview_hull_side.py --big        # 3 倍放大（看体积线索）
    python tools/preview_hull_side.py --sheet      # 分层拆解
    python tools/preview_hull_side.py --silhouette # 剪影辨识度测试（100% / 75% / 50%）
    python tools/preview_hull_side.py --flip       # 左右朝向对比（验镜像）

输出在 `docs/shots/hull_side_*.png`。
"""

import math
import os
import sys

from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# ⚠️ 下面这组常量必须与 `cocos/assets/scripts/view/DiveGame.ts` 保持同步。
#    改了 TS 那边忘了改这里，这张预览就变成"骗人的图" —— 比没有更糟。
# ---------------------------------------------------------------------------
SUB_D = 88                      # 艇身总长
HULL_H = 56                     # 艇高
SEAT_RING_R = 48                # 座圈半径（模拟层）
SEAT_RATIO = 28 / 48            # 座圈高度投影比（= 机体半高 ÷ 座圈半径）
TURRET_R = 16
SEAT_ANGLES_DEG = [30, -30, 90, -90, 150, -150]

# 14 点梭形：艏在 +x、艏艉都是圆钝端面、背腹平直
HULL_OUTLINE = [
    (1.00, -0.30), (0.86, -0.74), (0.46, -0.96), (-0.10, -1.00),
    (-0.60, -0.90), (-0.88, -0.62), (-1.00, -0.18), (-1.00, 0.18),
    (-0.88, 0.62), (-0.60, 0.90), (-0.10, 1.00), (0.46, 0.96),
    (0.86, 0.74), (1.00, 0.30),
]
TOWER = [(0.50, -0.88), (0.05, -0.96), (0.13, -1.46), (0.43, -1.46)]   # 指挥塔（围壳）
FIN = [(-0.70, -0.62), (-1.02, -1.42), (-0.86, -0.30)]                 # 尾舵（上片）

# 颜色（对应 shared/theme.ts 与 BODY_METAL）
C_BODY = 0x2f8fa8
C_ABYSS = 0x04070d
C_CYAN = 0x4fe8ff
C_CYAN_HI = 0xc8f8ff
C_CYAN_DIM = 0x1f6a7d
C_BG = 0x081824
BG_RGB = (0x08, 0x18, 0x24)     # = C_BG，用于半透明图元的混合底

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'shots')


def shade(hexv, f):
    """同 TS 的 `shade()`：单色按系数调明度，夹到 0..255。"""
    r, g, b = (hexv >> 16) & 0xff, (hexv >> 8) & 0xff, hexv & 0xff
    c = lambda v: max(0, min(255, round(v * f)))            # noqa: E731
    return (c(r), c(g), c(b))


def rgb(hexv, f=1.0):
    return shade(hexv, f)


def blend(fg, bg, a):
    return tuple(round(fg[i] * a + bg[i] * (1 - a)) for i in range(3))


def draw_hull(d, cx, cy, scale=1.0, m=1, layers=None, tint=C_BODY):
    """在 (cx, cy) 画一台侧视潜航器。`m` = 朝向镜像(+1 右 / -1 左)。"""
    L = layers or {'shadow', 'side', 'body', 'lit', 'belly', 'spine', 'tower',
                   'fins', 'windows', 'prop', 'neon', 'seats'}
    HL = (SUB_D / 2) * scale
    HH = (HULL_H / 2) * scale

    def P(x, y, sc=1.0, dx=0.0, dy=0.0, ysgn=1.0):
        return (cx + dx * scale + x * HL * sc * m,
                cy + dy * scale + y * HH * sc * ysgn)

    def poly(pl, fill):
        d.polygon([(round(p[0]), round(p[1])) for p in pl], fill=fill)

    def line(pl, fill, w):
        d.line([(round(p[0]), round(p[1])) for p in pl],
               fill=fill, width=max(1, int(round(w * scale))), joint='curve')

    # ⓪ 投影（半透明 → 近似混到底色）
    if 'shadow' in L:
        poly([P(x, y, 1.0, 5, 8) for (x, y) in HULL_OUTLINE], blend(rgb(C_ABYSS), BG_RGB, 0.42))
    # ① 侧壁（厚度）
    if 'side' in L:
        poly([P(x, y, 0.99, 0, 6) for (x, y) in HULL_OUTLINE], rgb(C_BODY, 0.28))
    # ② 主体
    if 'body' in L:
        poly([P(x, y) for (x, y) in HULL_OUTLINE], rgb(C_BODY, 0.74))
    # ②b 上缘受光（上半壳轻微提亮 + 贴轮廓的两级渐变光带）
    if 'lit' in L:
        poly([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.95, 0, -3)
              for i in range(0, 7)], rgb(C_BODY, 0.88))
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.90, 0, -2) for i in range(0, 7)],
             blend(rgb(C_BODY, 1.24), BG_RGB, 0.26), 10.0)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.94, 0, -2) for i in range(0, 7)],
             blend(rgb(C_BODY, 1.42), BG_RGB, 0.40), 4.5)
    # ②c 下腹暗带（两级）
    if 'belly' in L:
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.92, 0, 3) for i in range(8, 12)],
             blend(rgb(C_ABYSS), BG_RGB, 0.26), 10.0)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.96, 1, 4) for i in range(8, 12)],
             blend(rgb(C_ABYSS), BG_RGB, 0.42), 5.0)
    # ③ 背脊挂载带（主题色，预览里用 tint）
    if 'spine' in L:
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.78, -2, -6) for i in range(0, 6)],
             rgb(tint, 1.12), 3.0)
    # ④ 指挥塔 + 潜望镜
    if 'tower' in L:
        poly([P(x, y, 1.0, 0, 5) for (x, y) in TOWER], rgb(C_ABYSS))
        poly([P(x, y) for (x, y) in TOWER], rgb(C_BODY, 0.88))
        line([P(0.14, -1.46), P(0.42, -1.46)], rgb(C_BODY, 1.50), 1.6)
        line([P(0.29, -1.46), P(0.27, -1.78)], rgb(C_BODY, 1.34), 1.5)
    # ⑤ 尾舵（上下两片）
    if 'fins' in L:
        for sgn in (1, -1):
            poly([P(x, y, ysgn=sgn) for (x, y) in FIN], rgb(C_BODY, 0.55))
    # ⑥ 舷窗带
    if 'windows' in L:
        for i in range(5):
            px, py = P(-0.34 + 0.22 * i, -0.30)
            r = (2.8 if i == 2 else 2.2) * scale
            d.ellipse([px - r, py - r, px + r, py + r], fill=rgb(C_CYAN_HI))
    # ⑦ 艉部推进器（竖椭圆护罩 + 轴心）
    if 'prop' in L:
        tx, ty = P(-1.00, 0.0)
        rx, ry = HH * 0.26, HH * 0.64
        d.ellipse([tx - rx, ty - ry, tx + rx, ty + ry],
                  outline=rgb(C_BODY, 1.30), width=max(1, int(round(1.6 * scale))))
        r = 2.0 * scale
        d.ellipse([tx - r, ty - r, tx + r, ty + r], fill=rgb(C_CYAN_HI))
    # ⑧ 霓虹外轮廓 + 上缘受光弧
    if 'neon' in L:
        line([P(x, y) for (x, y) in HULL_OUTLINE] +
             [P(HULL_OUTLINE[0][0], HULL_OUTLINE[0][1])], rgb(C_CYAN), 1.6)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.97, -1, -3) for i in range(0, 4)],
             blend(rgb(C_CYAN_HI), BG_RGB, 0.32), 3.0)
    # ⑨ 座圈六座（**校验用**：塔座中心应压在艇舷上，不该飘在轮廓之外）
    if 'seats' in L:
        pad = TURRET_R * 0.55 * scale
        for deg in SEAT_ANGLES_DEG:
            a = math.radians(deg)
            sx = cx + SEAT_RING_R * math.cos(a) * scale * m
            sy = cy + SEAT_RING_R * math.sin(a) * SEAT_RATIO * scale
            d.ellipse([sx - pad, sy - pad, sx + pad, sy + pad],
                      fill=rgb(C_ABYSS), outline=rgb(C_CYAN_HI), width=max(1, int(scale)))


def canvas(w, h, bg=C_BG):
    img = Image.new('RGB', (w, h), rgb(bg))
    return img, ImageDraw.Draw(img)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    os.makedirs(OUT_DIR, exist_ok=True)

    if mode == '--sheet':
        rows = [
            ('1 仅主体（无体积线索）', {'body'}),
            ('2 +侧壁（厚度）', {'body', 'side'}),
            ('3 +上缘受光（光源）', {'body', 'side', 'lit'}),
            ('4 +投影+下腹暗带', {'body', 'side', 'lit', 'belly', 'shadow'}),
            ('5 +指挥塔/尾舵（破剪影）', {'body', 'side', 'lit', 'belly', 'shadow', 'tower', 'fins'}),
            ('6 +背脊带/舷窗/推进器/霓虹', None),
        ]
        cell, cols = 320, 3
        rowsn = (len(rows) + cols - 1) // cols
        img, d = canvas(cell * cols, rowsn * (cell + 30))
        for i, (name, layers) in enumerate(rows):
            gx, gy = (i % cols) * cell, (i // cols) * (cell + 30)
            draw_hull(d, gx + cell / 2, gy + cell / 2, scale=2.6, m=1, layers=layers)
            d.text((gx + 8, gy + cell + 8), name, fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_layers.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--silhouette':
        # 验收 §9-1：**纯黑剪影下，潜航器必须一眼是「侧视」**
        scales = [('100% (88px)', 1.0), ('75% (66px)', 0.75), ('50% (44px)', 0.5)]
        cell = 300
        img, d = canvas(cell * 3, cell + 34)
        for i, (name, sc) in enumerate(scales):
            gx, gy = i * cell + cell / 2, cell / 2
            HL, HH = (SUB_D / 2) * sc * 3.0, (HULL_H / 2) * sc * 3.0
            d.polygon([(gx + x * HL, gy + y * HH) for (x, y) in HULL_OUTLINE], fill=(0, 0, 0))
            d.polygon([(gx + x * HL, gy + y * HH) for (x, y) in TOWER], fill=(0, 0, 0))
            for sgn in (1, -1):
                d.polygon([(gx + x * HL, gy + y * sgn * HH) for (x, y) in FIN], fill=(0, 0, 0))
            d.text((i * cell + 8, cell + 10), name, fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_silhouette.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--flip':
        # 左右朝向对比：镜像**只翻 x** ⇒ 背永远是背（翻 y 会让艇腹朝天）
        cell = 380
        img, d = canvas(cell * 2, cell)
        draw_hull(d, cell / 2, cell / 2, scale=2.8, m=1)
        draw_hull(d, cell * 1.5, cell / 2, scale=2.8, m=-1)
        d.text((10, 10), 'faceX = +1 (朝右)', fill=rgb(C_CYAN_DIM))
        d.text((cell + 10, 10), 'faceX = -1 (朝左)', fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_flip.png')
        img.save(p)
        print('已出图:', p)
        return

    scale = 3.0 if mode == '--big' else 2.6
    pad = int(SUB_D * scale + 90)
    img, d = canvas(pad * 2, pad * 2)
    draw_hull(d, pad, pad, scale, m=1)
    p = os.path.join(OUT_DIR, 'hull_side_big.png' if mode == '--big' else 'hull_side.png')
    img.save(p)
    print('已出图:', p, img.size)


if __name__ == '__main__':
    main()
