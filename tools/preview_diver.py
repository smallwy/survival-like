#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
主界面中央舱体（V6.42）**静态预览渲染器**。

干什么用
--------
`Title.ts` 的舱体是运行时 `Graphics` 画的，改一个半径常量要开 Creator 才能看到结果，
一轮反馈几分钟。这个脚本用 PIL 复刻同一套几何（**常量从 Title.ts 里抄，改了要同步**），
直接出图 —— 半径层级冲突、体积线索有没有读出来，看一眼就知道。

它**不是**像素级还原：Cocos 的描边端点是 butt、PIL 的 `arc` 采样更粗，
但"哪层压着哪层""光从哪来"这类判断是一致的。

用法
----
    python tools/preview_diver.py                 # 出一张整体图
    python tools/preview_diver.py --big           # 出 3 倍放大（看体积线索）
    python tools/preview_diver.py --sheet         # 出"分层拆解"对比图

输出在 `docs/shots/diver_*.png`。
"""

import math
import os
import sys

from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# ⚠️ 下面这组常量必须与 `cocos/assets/scripts/view/Title.ts` 的 §3.3 保持同步。
#    改了 TS 那边忘了改这里，这张预览就变成"骗人的图" —— 比没有更糟。
# ---------------------------------------------------------------------------
HULL_R = 90
HULL_DEPTH = 14
SHADOW_DX = 9
SHADOW_DY = 8

RING_A_R = 86
RING_A_W = 8
RING_A_SEG = 19
RING_B_R = 78
RING_B_W = 6
RING_B_SEG = 14

THRUST_R = 68
CORE_R = 20
CORE_A = 10
CORE_B = 14
SCAN_R0 = 24
SCAN_R1 = 58
HERO_DISC = 116

# 颜色（对应 shared/theme.ts）
C_SHADOW = (0x02, 0x06, 0x0b)
C_SIDE = (0x0a, 0x1a, 0x26)
C_HULL = (0x1b, 0x32, 0x43)
C_SEAM = (0x0d, 0x1c, 0x28)
C_RING = (0x2a, 0x46, 0x5c)
C_RING_EDGE = (0x0b, 0x1a, 0x26)
C_CYAN = (0x4f, 0xe8, 0xff)
C_CYAN_HI = (0xc8, 0xf8, 0xff)
C_CYAN_DIM = (0x1f, 0x6a, 0x7d)
C_BG = (0x0c, 0x20, 0x2a)

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'shots')


def larc(d, cx, cy, r, a0, a1, fill, width=1):
    """数学角弧（y 向上、逆时针为正）→ PIL 的 arc（y 向下、顺时针为正）。"""
    d.arc([cx - r, cy - r, cx + r, cy + r],
          -math.degrees(a1), -math.degrees(a0), fill=fill, width=width)


def ring_band(d, cx, cy, r, w, seg, fill):
    """装甲环带：留出 38% 缺口 —— 没有缺口就看不见旋转。"""
    step = 2 * math.pi / seg
    duty = 0.62
    for i in range(seg):
        a0 = i * step
        larc(d, cx, cy, r, a0, a0 + step * duty, fill, w)
    larc(d, cx, cy, r - w / 2, 0, 2 * math.pi, C_RING_EDGE, 1)
    larc(d, cx, cy, r + w / 2, 0, 2 * math.pi, C_RING_EDGE, 1)


def draw_diver(img, d, cx, cy, scale=1.0, layers=None):
    """在 (cx, cy) 画一台舱体。`layers` 为 None 时画全部。"""
    L = layers or {'shadow', 'side', 'hull', 'rings', 'core', 'art', 'light', 'scan'}
    s = lambda v: v * scale                      # noqa: E731

    def disc(r, offx=0, offy=0, fill=None, outline=None, width=1):
        rr = s(r)
        d.ellipse([cx + s(offx) - rr, cy + s(offy) - rr, cx + s(offx) + rr, cy + s(offy) + rr],
                  fill=fill, outline=outline, width=width)

    if 'shadow' in L:
        # ⓪ 投影：**偏移要小**。偏 18/14 会读成"后面还有另一个圆"，
        #    偏 8/7 才读作"这台机器微微浮着"。水下阴影本来就是弥散的，不是硬轮廓。
        disc(HULL_R + 4, SHADOW_DX, SHADOW_DY, fill=C_SHADOW)
    if 'side' in L:
        # ① 侧壁：主盘下移 HULL_DEPTH 的同形暗盘 ⇒ 下方露出月牙 = 厚度
        disc(HULL_R, 0, HULL_DEPTH, fill=C_SIDE)
    if 'hull' in L:
        disc(HULL_R, fill=C_HULL)
        # 左右稳定鳍：让整体轮廓**不再是圆** —— 这是"读作机械"而不是"读作表盘"的关键。
        # 画在外壳层（装甲环带之下）⇒ 根部被环带压住，只有伸出去的一段可见，
        # 反而正好读作"鳍从装甲环下面穿出来"。厚度用下移 5px 的暗色副本。
        for sgn in (-1, 1):
            def polar(deg, r):
                a = math.radians(deg)
                return (cx + sgn * math.cos(a) * s(r), cy - math.sin(a) * s(r))
            # 梯形而不是三角：根部跨 80°（r58 处约 74px 宽）→ 尖端跨 16°
            # （r132 处约 37px 宽）。三角尖会读成"箭头/机翼"，梯形才读作"鳍"。
            # 尖端伸到 132：装甲环带（75–90）压掉根部，露出约 42px 的真翼。
            # ⚠️ 角度按**右鳍**写（0° = 正右），左鳍靠 sgn 镜像 x。反过来写会叠到同一侧。
            p1, p2 = polar(-40, 58), polar(40, 58)
            p3, p4 = polar(8, 132), polar(-8, 132)
            off = s(5)
            d.polygon([(p1[0], p1[1] + off), (p2[0], p2[1] + off),
                       (p3[0], p3[1] + off), (p4[0], p4[1] + off)], fill=(0x0a, 0x1c, 0x28))
            d.polygon([p1, p2, p3, p4], fill=(0x26, 0x44, 0x58))
            d.line([p1, p4, p3, p2], fill=(0x40, 0x70, 0x8a), width=max(1, int(s(1.4))))
        larc(d, cx, cy, s(74), 0, 2 * math.pi, C_SEAM, max(1, int(s(1.5))))
        # 六个姿态推进器口的凹槽
        for deg in (30, -30, 90, -90, 150, -150):
            a = math.radians(deg)
            tx, ty = cx + math.cos(a) * s(THRUST_R), cy - math.sin(a) * s(THRUST_R)
            rr = s(5.5)
            d.ellipse([tx - rr, ty - rr, tx + rr, ty + rr], fill=(0x08, 0x13, 0x1d))
            larc(d, tx, ty, s(5.5), math.pi * 0.15, math.pi * 0.85, C_CYAN_HI, max(1, int(s(1.2))))
            larc(d, tx, ty, s(5.5), math.pi * 1.15, math.pi * 1.85, (0x04, 0x0a, 0x10), max(1, int(s(1.2))))
    if 'art' in L:
        # 潜航器立绘（**占位**：真实运行时是 sub_<id>.png）
        rr = s(HERO_DISC / 2)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(0x24, 0x4a, 0x5e), outline=(0x3d, 0x78, 0x90), width=max(1, int(s(2))))
        for deg in range(0, 360, 30):
            a = math.radians(deg)
            px, py = cx + math.cos(a) * s(46), cy - math.sin(a) * s(46)
            pr = s(3.2)
            d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=(0x6f, 0xa8, 0xbc))
        # 艏部指示（下潜方向朝下 ⇒ 艏在下方）
        d.polygon([(cx - s(9), cy + s(30)), (cx + s(9), cy + s(30)), (cx, cy + s(56))], fill=(0x7f, 0xd9, 0xf5))
    if 'rings' in L:
        ring_band(d, cx, cy, s(RING_A_R), max(1, int(s(RING_A_W))), RING_A_SEG, C_RING)
        ring_band(d, cx, cy, s(RING_B_R), max(1, int(s(RING_B_W))), RING_B_SEG, C_RING)
    if 'core' in L:
        disc(CORE_R, fill=(0x08, 0x16, 0x1f))
        disc(CORE_R * 0.62, 0, -3, fill=C_CYAN_DIM)
        d.ellipse([cx - s(4) - s(4), cy + s(-7) - s(4), cx - s(4) + s(4), cy + s(-7) + s(4)], fill=C_CYAN_HI)
        larc(d, cx, cy, s(CORE_R), 0, 2 * math.pi, C_CYAN, max(1, int(s(1.2))))
    if 'light' in L:
        # ② 全局球面打光：左上受光区 + 右下暗区，**盖住整个舱体（含立绘与环带）**。
        #    这是"看着像实物"最关键的一步 —— 只在壳面做明暗，读作"一圈装饰"；
        #    整块一起明暗，才读作"一个球/一块金属被光从左上照到"。
        rx, ry = s(62), s(50)
        ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        bx, by = cx - s(14), cy - s(14)              # 左上（PIL y 向下 ⇒ 减 = 上）
        od.ellipse([bx - rx, by - ry, bx + rx, by + ry], fill=C_CYAN_HI + (66,))
        bx, by = cx + s(20), cy + s(20)              # 右下
        od.ellipse([bx - rx, by - ry, bx + rx, by + ry], fill=C_SHADOW + (128,))
        mask = Image.new('L', img.size, 0)
        ImageDraw.Draw(mask).ellipse(
            [cx - s(HULL_R), cy - s(HULL_R), cx + s(HULL_R), cy + s(HULL_R)], fill=255)
        img.paste(Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB'), (0, 0), mask)
        # ③ 受光弧（左上）/ ④ 暗弧（右下）—— 光源固定在世界坐标
        lw = max(1, int(s(6)))
        larc(d, cx, cy, s(HULL_R - 4), math.radians(80), math.radians(190), C_CYAN_HI, lw)
        larc(d, cx, cy, s(HULL_R - 3), math.radians(258), math.radians(372), (0x02, 0x06, 0x0b),
             max(1, int(s(6))))
        larc(d, cx, cy, s(HULL_R), 0, 2 * math.pi, C_CYAN, max(1, int(s(1.6))))
    if 'scan' in L:
        d.line([(cx + s(SCAN_R0), cy), (cx + s(SCAN_R1 - 8), cy)], fill=C_CYAN, width=max(1, int(s(2))))
        x0, y0, hw = cx + s(SCAN_R1 - 8), cy - s(4), s(4)
        d.rectangle([x0, y0 - hw, x0 + s(8), y0 + hw], fill=(0x16, 0x30, 0x3f))
        d.line([(x0, y0 - hw), (x0 + s(8), y0 - hw)], fill=C_CYAN_HI, width=max(1, int(s(1.4))))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    os.makedirs(OUT_DIR, exist_ok=True)

    if mode == '--sheet':
        # 分层拆解：看"每一条体积线索各贡献了什么"
        rows = [
            ('① 仅主盘（无体积线索）', {'hull'}),
            ('② +投影 ⓪', {'hull', 'shadow'}),
            ('③ +侧壁（厚度）', {'hull', 'shadow', 'side'}),
            ('④ +受光弧/暗弧（光源）', {'hull', 'shadow', 'side', 'light'}),
            ('⑤ +装甲环带', {'hull', 'shadow', 'side', 'light', 'rings'}),
            ('⑥ 全部（+立绘/核心/扫描臂）', None),
        ]
        cell, cols = 200, 3
        W = cell * cols
        Hh = cell * ((len(rows) + cols - 1) // cols) + 30 * ((len(rows) + cols - 1) // cols)
        img = Image.new('RGB', (W, Hh), C_BG)
        d = ImageDraw.Draw(img)
        for i, (name, layers) in enumerate(rows):
            gx, gy = (i % cols) * cell, (i // cols) * (cell + 30)
            draw_diver(img, d, gx + cell / 2, gy + cell / 2, 0.95, layers)
            d.text((gx + 6, gy + cell - 14), name, fill=(0x9f, 0xc6, 0xd8))
        p = os.path.join(OUT_DIR, 'diver_layers.png')
        img.save(p)
        print('已出图:', p)
        return

    scale = 3.0 if mode == '--big' else 1.6
    pad = int(HULL_R * scale + 60)
    img = Image.new('RGB', (pad * 2, pad * 2), C_BG)
    d = ImageDraw.Draw(img)
    draw_diver(img, d, pad, pad, scale)
    name = 'diver_big.png' if mode == '--big' else 'diver.png'
    p = os.path.join(OUT_DIR, name)
    img.save(p)
    print('已出图:', p, img.size)


if __name__ == '__main__':
    main()
