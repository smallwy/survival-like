#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
主界面中央区**下潜循环**（V6.43）的关键帧渲染器。

干什么用
--------
`stepDiver` 是运行时代码，跑一个 16.8s 的循环要看 17 秒才知道结果。
这个脚本用 PIL 复刻同一套 **位移公式 + 气泡出生产生**，把整个循环抽成 8 帧并排出，

    python tools/preview_dive_cycle.py            # 8 帧接触表
    python tools/preview_dive_cycle.py --frames 12   # 抽 12 帧

输出 `docs/shots/dive_cycle.png`。

⚠️ 常量必须与 `cocos/assets/scripts/view/Title.ts` §3.3 同步，不同步这张图就是**骗人的**。
"""

import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from preview_diver import draw_diver, C_HULL, C_SIDE, C_SHADOW  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- §3.3 同步常量（改 TS 必须同步这里）----
SHAFT_W, SHAFT_H = 296, 368
SHAFT_X0, SHAFT_Y0 = 504, 284
SHAFT_CX = SHAFT_X0 + SHAFT_W / 2

DIVE_Y0, DIVE_Y1 = 380, 556
T_TOP, T_DOWN, T_BOT, T_UP = 1.0, 6.4, 1.4, 5.6
DIVE_T = T_TOP + T_DOWN + T_BOT + T_UP
T_DOWN_END = T_TOP + T_DOWN
T_BOT_END = T_DOWN_END + T_BOT

BUBBLE_N = 44
BUBBLE_V0, BUBBLE_V1, BUBBLE_LIFE = 26.0, 52.0, 2.4
DT_CRUISE, DT_STERN = 0.30, 0.18
DT_VENT_BLOW, DT_VENT_UP = 0.07, 0.09
VENT_DX0, VENT_DX1, VENT_DY = 76, 104, 72
VENT_V0, VENT_V1 = 95.0, 150.0
VENT_VX, VENT_DECAY = 40.0, 1.2

HULL_R = 90

BG = (18, 30, 42)                       # 主界面底色近似
C_WATER_TOP = (0x1d, 0x3c, 0x52)
C_WATER_BOT = (0x06, 0x11, 0x1c)
C_EDGE = (0x2e, 0x5a, 0x72)
C_BUBBLE = (0x9f, 0xd8, 0xe8)


def phase_at(t):
    """返回该时刻的 (sim_y, boost, mode, gap, 段名)。与 `stepDiver` 同构。"""
    ph = t % DIVE_T
    if ph < T_TOP:
        return DIVE_Y0, 0.0, 'cruise', DT_CRUISE, '顶部待机'
    if ph < T_DOWN_END:
        u = (ph - T_TOP) / T_DOWN
        return DIVE_Y0 + u * (DIVE_Y1 - DIVE_Y0), 0.18, 'stern', DT_STERN, '下潜'
    if ph < T_BOT_END:
        u = (ph - T_DOWN_END) / T_BOT
        return DIVE_Y1, u, 'vent', DT_VENT_BLOW, '吹除压载'
    u = (ph - T_BOT_END) / T_UP
    y = DIVE_Y1 - u * u * (3 - 2 * u) * (DIVE_Y1 - DIVE_Y0)
    return y, 1 - 0.3 * u, 'vent', DT_VENT_UP, '上浮'


def simulate(t_end, seed=7, dt=1.0 / 60):
    """从 t=0 步进到 t_end，返回在场气泡列表 [(x, y, r, alpha)]。"""
    rnd = random.Random(seed)
    bubbles = []
    bubble_t = 0.0
    t = 0.0
    while t < t_end:
        y, _boost, mode, gap, _name = phase_at(t)
        bubble_t += dt
        while bubble_t >= gap:
            bubble_t -= gap
            if mode == 'vent':
                side = -1 if rnd.random() < 0.5 else 1
                bubbles.append({
                    'x': SHAFT_CX + side * (VENT_DX0 + rnd.random() * (VENT_DX1 - VENT_DX0)),
                    'y': y + VENT_DY,
                    'r': 1.8 + rnd.random() * 3.4,
                    'v': VENT_V0 + rnd.random() * (VENT_V1 - VENT_V0),
                    'vx': side * VENT_VX * (0.6 + rnd.random() * 0.8),
                    'ph': rnd.random() * 6.28,
                    'life': BUBBLE_LIFE,
                })
            else:
                bubbles.append({
                    'x': SHAFT_CX - 44 + rnd.random() * 88,
                    'y': y - 70,
                    'r': 1.6 + rnd.random() * 3.4,
                    'v': BUBBLE_V0 + rnd.random() * (BUBBLE_V1 - BUBBLE_V0),
                    'vx': 0.0,
                    'ph': rnd.random() * 6.28,
                    'life': BUBBLE_LIFE,
                })
        while len(bubbles) > BUBBLE_N:
            bubbles.pop(0)

        for b in bubbles:
            b['life'] -= dt
            b['y'] -= b['v'] * dt
            b['vx'] *= max(0.0, 1 - dt * VENT_DECAY)
            b['x'] += (b['vx'] + math.sin(t * 1.6 + b['ph']) * 7) * dt
        bubbles = [b for b in bubbles if b['life'] > 0 and b['y'] >= SHAFT_Y0 + 2]
        t += dt
    return bubbles


def bubble_alpha(b):
    """两段淡出相乘：寿命末段 + 靠近柱顶 30px 内（与 TS 同构）。"""
    return min(1.0, b['life'] / 0.5) * min(1.0, max(0.0, (b['y'] - SHAFT_Y0) / 30))


def draw_bubbles(img, d, bubbles):
    """气泡：一层小白点。画在舱体**之前**，与 TS 的 `tBubble` 层序一致。"""
    ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for b in bubbles:
        a = bubble_alpha(b)
        if a <= 0:
            continue
        r = b['r']
        od.ellipse([b['x'] - r, b['y'] - r, b['x'] + r, b['y'] + r],
                   outline=C_BUBBLE + (int(255 * 0.62 * a),), width=2)
        hr = r * 0.34
        od.ellipse([b['x'] - r * 0.3 - hr, b['y'] - r * 0.3 - hr,
                    b['x'] - r * 0.3 + hr, b['y'] - r * 0.3 + hr],
                   fill=(255, 255, 255, int(255 * 0.45 * a)))
    img.paste(Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB'), (0, 0))


def render_gif(step=0.3):
    """按真实速度出一个循环的 GIF（`step` 秒/帧，0.3 ⇒ 48 帧 = 14.4s）。"""
    gw, gh = 360, 464
    sx = (gw - SHAFT_W) / 2 - SHAFT_X0
    sy = 36 - SHAFT_Y0
    frames = []
    n = int(round(DIVE_T / step))
    for i in range(n):
        t = i * step
        y, _boost, _mode, _gap, _name = phase_at(t)
        cell = Image.new('RGB', (gw, gh), BG)
        cd = ImageDraw.Draw(cell)
        draw_cell(cell, cd, simulate(t), sx, sy)
        draw_diver(cell, cd, (gw - SHAFT_W) / 2 + SHAFT_W / 2, y + sy, 1.0)
        frames.append(cell)
    out = os.path.join(ROOT, 'docs', 'shots', 'dive_cycle.gif')
    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=int(step * 1000), loop=0, optimize=True)
    print('saved', out, '%d 帧' % n)


def main():
    n = 8
    for i, a in enumerate(sys.argv):
        if a == '--frames' and i + 1 < len(sys.argv):
            n = int(sys.argv[i + 1])
    if '--gif' in sys.argv:
        render_gif()
        return

    # 重点帧：每段至少 2 帧，其中上浮段 3 帧（本轮改的就是它）
    times = [0.5, 3.5, 6.5, 8.0, 9.2, 10.6, 12.0, 13.6]
    times = times[:n]

    cell_w, cell_h = 340, 392
    cols = 3
    rows = (len(times) + cols - 1) // cols
    pad = 12
    sheet = Image.new('RGB', (cols * (cell_w + pad) + pad,
                              rows * (cell_h + pad + 18) + pad), (10, 16, 22))
    sd = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 14)
    except Exception:
        font = ImageFont.load_default()

    for k, t in enumerate(times):
        y, _boost, mode, _gap, name = phase_at(t)
        bubbles = simulate(t)

        cell = Image.new('RGB', (cell_w, cell_h), BG)
        cd = ImageDraw.Draw(cell)
        sx = (cell_w - SHAFT_W) / 2 - SHAFT_X0
        sy = 40 - SHAFT_Y0
        draw_cell(cell, cd, bubbles, sx, sy)
        # ⚠️ 舱体画在气泡**之后**，与 TS 的层序（`tBubble` 在 `diver` 之下）一致
        draw_diver(cell, cd, (cell_w - SHAFT_W) / 2 + SHAFT_W / 2, y + sy, 1.0)

        gx = pad + (k % cols) * (cell_w + pad)
        gy = pad + (k // cols) * (cell_h + pad + 18)
        sheet.paste(cell, (gx, gy))
        label = 't=%.1fs  %s  y=%.0f  (%s)' % (t, name, y, mode)
        sd.text((gx + 4, gy + cell_h + 2), label, fill=(0x8f, 0xc4, 0xdc), font=font)

    out = os.path.join(ROOT, 'docs', 'shots', 'dive_cycle.png')
    sheet.save(out)
    print('saved', out, sheet.size)


def draw_cell(img, d, bubbles, sx, sy):
    """在偏移后的坐标里画柱 + 气泡（舱体由调用方另行画）。"""
    x0, y0 = SHAFT_X0 + sx, SHAFT_Y0 + sy
    x1, y1 = x0 + SHAFT_W, y0 + SHAFT_H
    for i in range(SHAFT_H):
        k = i / max(1, SHAFT_H - 1)
        col = tuple(int(C_WATER_TOP[c] + (C_WATER_BOT[c] - C_WATER_TOP[c]) * k) for c in range(3))
        d.line([(x0, y0 + i), (x1, y0 + i)], fill=col)
    # 水面：一道亮线 + 向下 24px 的光池
    d.line([(x0, y0), (x1, y0)], fill=(0x6f, 0xd0, 0xe8), width=2)
    for i in range(24):
        a = 1 - i / 24
        c = tuple(int(BG[c] + ((0x5a, 0xb8, 0xd8)[c] - BG[c]) * a * 0.35) for c in range(3))
        d.line([(x0, y0 + 1 + i), (x1, y0 + 1 + i)], fill=c)
    d.rectangle([x0, y0, x1, y1], outline=C_EDGE, width=1)

    shifted = [{**b, 'x': b['x'] + sx, 'y': b['y'] + sy} for b in bubbles]
    draw_bubbles(img, d, shifted)


if __name__ == '__main__':
    main()
