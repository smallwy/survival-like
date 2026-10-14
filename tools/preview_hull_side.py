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
    python tools/preview_hull_side.py --tex        # 质感对照（有无结构层，V6.57）
    python tools/preview_hull_side.py --silhouette # 剪影辨识度测试（100% / 75% / 50%）
    python tools/preview_hull_side.py --flip       # 左右朝向对比（验镜像）

输出在 `docs/shots/hull_side_*.png`。
"""

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

_FONT_CACHE = {}


def F(size):
    """中文字体（PIL 默认字体没有 CJK ⇒ 不加载会满屏豆腐块）。"""
    if size not in _FONT_CACHE:
        try:
            _FONT_CACHE[size] = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)
        except Exception:
            _FONT_CACHE[size] = ImageFont.load_default()
    return _FONT_CACHE[size]


def txt(d, xy, s, fill, size=14):
    d.text(xy, s, fill=fill, font=F(size))

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
C_AMBER = 0xffd166
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
    L = layers or {'shadow', 'side', 'body', 'lit', 'belly', 'detail', 'spine', 'tower',
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
    # ②d 金属高光带 + 背脊铆钉（V6.57）
    #     ⚠️ 三版被否的方案：竖板缝（读作铁笼）、舷窗暗框（读作一排黑洞）、
    #        低频明暗斑（读作锈渍）。56px 量级上"金属感"只来自**一条集中的镜面亮痕**。
    if 'detail' in L:
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.86, -1, -8) for i in range(1, 6)],
             blend((0xdc, 0xfe, 0xff), BG_RGB, 0.50), 2.6)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.88, -1, -8) for i in range(1, 6)],
             blend((255, 255, 255), BG_RGB, 0.34), 1.2)
        for i in range(5):
            tt = i / 4
            px = cx + (0.60 - 1.12 * tt) * HL * m
            py = cy + (-0.52 - 0.30 * tt) * HH
            r = 1.45 * scale
            d.ellipse([px - r + 1, py - r + 1, px + r + 1, py + r + 1],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.5))
            d.ellipse([px - r, py - r, px + r, py + r],
                      fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.5))
    # ③ 背脊挂载带（主题色，预览里用 tint）
    if 'spine' in L:
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.78, -2, -6) for i in range(0, 6)],
             rgb(tint, 1.12), 3.0)
    # ④ 指挥塔 + 潜望镜 + 观察窗
    if 'tower' in L:
        poly([P(x, y, 1.0, 0, 5) for (x, y) in TOWER], rgb(C_ABYSS))
        poly([P(x, y) for (x, y) in TOWER], rgb(C_BODY, 0.88))
        line([P(0.14, -1.46), P(0.42, -1.46)], rgb(C_BODY, 1.50), 1.6)
        # 观察窗（V6.57，结构层关掉时不画）
        if 'detail' in L:
            wy = cy - 1.18 * HH
            ax, bx = cx + 0.14 * HL * m, cx + 0.42 * HL * m
            line([(min(ax, bx), wy), (max(ax, bx), wy)], blend(rgb(C_ABYSS), BG_RGB, 0.5), 2.6)
            line([(min(ax, bx) + 1 * scale, wy), (max(ax, bx) - 1 * scale, wy)],
                 blend(rgb(C_CYAN_HI), BG_RGB, 0.62), 1.2)
        line([P(0.29, -1.46), P(0.27, -1.78)], rgb(C_BODY, 1.34), 1.5)
    # ⑤ 尾舵（上下两片）
    if 'fins' in L:
        for sgn in (1, -1):
            poly([P(x, y, ysgn=sgn) for (x, y) in FIN], rgb(C_BODY, 0.55))
    # ⑥ 舷窗带（V6.57：光晕 + 暗窗框 + 玻璃 + 高光点；关掉 detail 走 V6.54 的素圆点）
    if 'windows' in L:
        for i in range(5):
            px, py = P(-0.34 + 0.22 * i, -0.30)
            r = (2.8 if i == 2 else 2.2) * scale
            if 'detail' not in L:
                d.ellipse([px - r, py - r, px + r, py + r], fill=rgb(C_CYAN_HI))
                continue
            gr = r * 2.0
            d.ellipse([px - gr, py - gr, px + gr, py + gr],
                      fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.11))
            d.ellipse([px - r, py - r, px + r, py + r], fill=rgb(C_CYAN_HI))
            hx, hy2, hr = px - r * 0.32 * m, py - r * 0.34, r * 0.34
            d.ellipse([hx - hr, hy2 - hr, hx + hr, hy2 + hr], fill=(255, 255, 255))
    # ⑦ 艉部推进器（竖椭圆护罩 + 轴心）+ 散热格栅
    if 'prop' in L:
        tx, ty = P(-1.00, 0.0)
        rx, ry = HH * 0.26, HH * 0.64
        d.ellipse([tx - rx, ty - ry, tx + rx, ty + ry],
                  outline=rgb(C_BODY, 1.30), width=max(1, int(round(1.6 * scale))))
        r = 2.0 * scale
        d.ellipse([tx - r, ty - r, tx + r, ty + r], fill=rgb(C_CYAN_HI))
        for i in range(3):                                   # 散热格栅（V6.57）
            if 'detail' not in L:
                break
            sx = cx + (-0.60 - i * 0.085) * HL * m
            line([(sx, cy - HH * 0.20), (sx, cy + HH * 0.22)],
                 blend(rgb(C_ABYSS), BG_RGB, 0.26), 1.1)
    # ⑧ 霓虹外轮廓 + 上缘受光弧
    if 'neon' in L:
        line([P(x, y) for (x, y) in HULL_OUTLINE] +
             [P(HULL_OUTLINE[0][0], HULL_OUTLINE[0][1])], rgb(C_CYAN), 1.6)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.97, -1, -3) for i in range(0, 4)],
             blend(rgb(C_CYAN_HI), BG_RGB, 0.32), 3.0)
    # ⑨ 座圈六座（**校验用**：底座外沿应压在艇舷上，不该飘在轮廓之外）
    #     V6.57：挂点 = 「底座（pad×1.28）+ 内凹槽」。底座再大一点就变成"机体外套六个黑盘"。
    if 'seats' in L:
        pad = TURRET_R * 0.55 * scale
        base = pad * 1.28
        TOP = rgb(C_BODY, 0.52)          # 挂点叠在**机体**上，不是叠在背景上
        for deg in SEAT_ANGLES_DEG:
            a = math.radians(deg)
            sx = cx + SEAT_RING_R * math.cos(a) * scale * m
            sy = cy + SEAT_RING_R * math.sin(a) * SEAT_RATIO * scale
            # ① 投影 ② 侧壁（下移） ③ 顶面 ④ 内凹槽
            d.ellipse([sx + pad * 0.14 - base, sy + pad * 0.30 - base,
                       sx + pad * 0.14 + base, sy + pad * 0.30 + base],
                      fill=blend(rgb(C_ABYSS), TOP, 0.40))
            d.ellipse([sx - base, sy + 1.6 * scale - base, sx + base, sy + 1.6 * scale + base],
                      fill=rgb(C_BODY, 0.34))
            d.ellipse([sx - base, sy - base, sx + base, sy + base],
                      fill=TOP, outline=rgb(C_CYAN_DIM))
            d.ellipse([sx - pad, sy - pad, sx + pad, sy + pad],
                      fill=blend(rgb(C_ABYSS), TOP, 0.58), outline=rgb(C_CYAN_HI))


def canvas(w, h, bg=C_BG):
    img = Image.new('RGB', (w, h), rgb(bg))
    return img, ImageDraw.Draw(img)


# ---------------------------------------------------------------------------
# 炮塔预览（V6.57）：复刻 drawTurret 的「底座 + 内凹槽 + 壳体 + 枪族发射器」
# ⚠️ 与 DiveGame.ts 的 drawTurret / drawEmitter('gun') 同步，改那边要改这里。
# 目的：用户「发射装置像贴图」—— 放大 6 倍看挂点有没有厚度、炮管是不是从壳里出来的。
# ---------------------------------------------------------------------------
EMITTER_SIZE = 18


def _R(cx, cy, ang, lx, ly):
    c, s = math.cos(ang), math.sin(ang)
    return (cx + lx * c - ly * s, cy + lx * s + ly * c)


def draw_turret(d, cx, cy, ang_deg, scale=6.0, ext=False, firing=False):
    ang = math.radians(ang_deg)          # sim 语义：y 向下、顺时针为正
    pad = TURRET_R * 0.55 * scale
    base = pad * 1.28
    S = EMITTER_SIZE * scale

    def circ(x, y, r, fill=None, outline=None, w=1):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill, outline=outline, width=w)

    # 挂点：投影 → 侧壁 → 顶面 → 受光弧 → 外沿 → 内凹槽 → 槽受光弧 → 槽描边
    circ(cx + pad * 0.14, cy + pad * 0.30, base, fill=blend(rgb(C_ABYSS), BG_RGB, 0.40))
    circ(cx, cy + 1.6 * scale, base, fill=rgb(C_BODY, 0.34))
    circ(cx, cy, base, fill=rgb(C_BODY, 0.52))
    d.arc([cx - base * 0.84, cy - base * 0.84, cx + base * 0.84, cy + base * 0.84],
          math.degrees(math.pi * 1.05), math.degrees(math.pi * 1.45),
          fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.42), width=max(1, round(base * 0.16)))
    circ(cx, cy, base, outline=rgb(C_AMBER if ext else C_CYAN_DIM), w=max(1, round(1.3 * scale)))
    circ(cx, cy, pad, fill=blend(rgb(C_ABYSS), BG_RGB, 0.58))
    d.arc([cx - pad * 0.74, cy - pad * 0.74, cx + pad * 0.74, cy + pad * 0.74],
          math.degrees(math.pi * 1.02), math.degrees(math.pi * 1.48),
          fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.50), width=max(1, round(pad * 0.22)))
    circ(cx, cy, pad, outline=rgb(C_CYAN_HI), w=max(1, round(1.4 * scale)))

    # 壳体（发射器外罩）
    L0, L1, W2 = -pad * 0.55, pad * 1.45, pad * 1.05
    quad = [_R(cx, cy, ang, L0, -W2), _R(cx, cy, ang, L1, -W2),
            _R(cx, cy, ang, L1, W2), _R(cx, cy, ang, L0, W2)]
    d.polygon([(round(p[0]), round(p[1])) for p in quad], fill=rgb(C_BODY, 0.50))
    e0 = _R(cx, cy, ang, L0 + 1.5 * scale, -W2 * 0.92)
    e1 = _R(cx, cy, ang, L1 - 1.5 * scale, -W2 * 0.92)
    d.line([(round(e0[0]), round(e0[1])), (round(e1[0]), round(e1[1]))],
           fill=rgb(C_BODY, 1.18), width=max(1, round(1.5 * scale)))
    f0 = _R(cx, cy, ang, L0 + 1.5 * scale, W2 * 0.92)
    f1 = _R(cx, cy, ang, L1 - 1.5 * scale, W2 * 0.92)
    d.line([(round(f0[0]), round(f0[1])), (round(f1[0]), round(f1[1]))],
           fill=blend(rgb(C_ABYSS), BG_RGB, 0.45), width=max(1, round(1.5 * scale)))
    # 壳口环
    c0 = _R(cx, cy, ang, L1, 0)
    d.arc([c0[0] - W2 * 0.72, c0[1] - W2 * 0.72, c0[0] + W2 * 0.72, c0[1] + W2 * 0.72],
          math.degrees(ang - 1.35), math.degrees(ang + 1.35),
          fill=rgb(C_AMBER if ext else C_CYAN_HI), width=max(1, round(1.3 * scale)))

    # 枪族发射器：3 根平行枪管（中间那根更亮）
    n = 3
    for i in range(n):
        yy = (i - (n - 1) / 2) * (S * 0.3)
        p1 = _R(cx, cy, ang, -S * 0.35, yy)
        p2 = _R(cx, cy, ang, S * 0.8, yy)
        col = rgb(C_AMBER, 1 if i == (n - 1) // 2 else 0.65)
        d.line([(round(p1[0]), round(p1[1])), (round(p2[0]), round(p2[1]))],
               fill=col, width=max(1, round(2.2 * scale)))
    # 开火：枪口焰 + 前向长焰
    if firing:
        mx, my = _R(cx, cy, ang, S * 0.8, 0)
        fr = 9 * scale
        d.ellipse([mx - fr, my - fr, mx + fr, my + fr], fill=blend(rgb(C_AMBER), BG_RGB, 0.9))
        tx, ty = _R(cx, cy, ang, S * 0.8 + 7 * scale, 0)
        tr = 3.4 * scale
        d.ellipse([tx - tr, ty - tr, tx + tr, ty + tr], fill=(255, 255, 255))


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
            ('6 +背脊带/舷窗/推进器/霓虹', {'shadow', 'side', 'body', 'lit', 'belly',
                                          'spine', 'tower', 'fins', 'windows', 'prop', 'neon'}),
            ('7 +结构层（V6.57 质感）', None),
        ]
        cell, cols = 320, 3
        rowsn = (len(rows) + cols - 1) // cols
        img, d = canvas(cell * cols, rowsn * (cell + 30))
        for i, (name, layers) in enumerate(rows):
            gx, gy = (i % cols) * cell, (i // cols) * (cell + 30)
            draw_hull(d, gx + cell / 2, gy + cell / 2, scale=2.6, m=1, layers=layers)
            txt(d, (gx + 8, gy + cell + 8), name, fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_layers.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--tex':
        # V6.57 质感对照：两组只差「结构层」这一个变量（板缝/铆钉/窗框/格栅）
        base = {'shadow', 'side', 'body', 'lit', 'belly', 'spine', 'tower',
                'fins', 'windows', 'prop', 'neon'}
        cell = 360
        img, d = canvas(cell * 2, cell + 32)
        draw_hull(d, cell / 2, cell / 2, scale=2.9, m=1, layers=base)
        draw_hull(d, cell * 1.5, cell / 2, scale=2.9, m=1, layers=base | {'detail'})
        txt(d, (10, cell + 10), 'V6.54 定稿（无结构层）', fill=rgb(C_CYAN_DIM))
        txt(d, (cell + 10, cell + 10), 'V6.57 +结构层', fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_tex.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--turret':
        # 「发射装置像贴图」对照：旧版（挂点=单色实心圆）vs V6.57（底座+凹槽+壳体+开火）
        cell, SC = 300, 6.0
        img, d = canvas(cell * 3, cell + 32)

        def old(cx, cy, ang_deg):
            ang = math.radians(ang_deg)
            pad, S = TURRET_R * 0.55 * SC, EMITTER_SIZE * SC
            d.ellipse([cx + pad * 0.16 - pad, cy + pad * 0.26 - pad,
                       cx + pad * 0.16 + pad, cy + pad * 0.26 + pad],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.45))
            d.ellipse([cx - pad, cy - pad, cx + pad, cy + pad],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.62))
            d.arc([cx - pad * 0.76, cy - pad * 0.76, cx + pad * 0.76, cy + pad * 0.76],
                  180 + 3.6, 180 + 86.4, fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.55),
                  width=max(1, round(pad * 0.24)))
            d.ellipse([cx - pad, cy - pad, cx + pad, cy + pad],
                      outline=rgb(C_CYAN_HI), width=max(1, round(1.4 * SC)))
            for i in range(3):
                yy = (i - 1) * S * 0.3
                p1, p2 = _R(cx, cy, ang, -S * 0.35, yy), _R(cx, cy, ang, S * 0.8, yy)
                d.line([p1, p2], fill=rgb(C_AMBER, 1 if i == 1 else 0.65),
                       width=max(1, round(2.2 * SC)))

        old(cell / 2, cell / 2, -30)
        draw_turret(d, cell * 1.5, cell / 2, -30, SC)
        draw_turret(d, cell * 2.5, cell / 2, -30, SC, firing=True)
        txt(d, (10, cell + 10), 'V6.54 挂点（单色实心圆）', rgb(C_CYAN_DIM))
        txt(d, (cell + 10, cell + 10), 'V6.57 底座+凹槽+壳体', rgb(C_CYAN_DIM))
        txt(d, (cell * 2 + 10, cell + 10), 'V6.57 +开火（后坐/枪口焰）', rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'turret_tex.png')
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
            txt(d, (i * cell + 8, cell + 10), name, fill=rgb(C_CYAN_DIM))
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
        txt(d, (10, 10), 'faceX = +1 (朝右)', fill=rgb(C_CYAN_DIM))
        txt(d, (cell + 10, 10), 'faceX = -1 (朝左)', fill=rgb(C_CYAN_DIM))
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
