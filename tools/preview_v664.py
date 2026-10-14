#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V6.64 两处视觉修正的验证：**光柱（离散柱 -> 连续光幕）** + **远景鱼群（椭圆 -> 鱼形）**。

---------------------------------------------------------------------------
为什么必须画出来
---------------------------------------------------------------------------
这两个改动**都是"参数全对、合起来错"那一类**，只有合成图能提前发现：
  · 光柱：单条的 alpha / 宽度 / 衰减逐个看都对，"是不是连成一片"要看**横向剖面**；
  · 鱼群：轮廓点逐个看都对，"缩到 26px 还认不认得出是鱼"要看**实际显示尺寸**。

---------------------------------------------------------------------------
光柱的客观判据（**不靠眼估**）
---------------------------------------------------------------------------
取光柱合成层在某一行的**横向 alpha 剖面**：
  · **离散柱** ⇒ 剖面有几个孤立峰，峰与峰之间**降到 0** ⇒ 视觉上就是几根柱子；
  · **连续光幕** ⇒ 剖面是一条**不降到 0 的连续曲线**，有起伏但不中断 ⇒ 一片光。

⇒ 本次判据：屏宽中段（20%~80%）的 `min/max` —— 旧版应 ≈0，新版应 >0.3。
  这不依赖审美，是可打印的数字。

---------------------------------------------------------------------------
鱼群的判据
---------------------------------------------------------------------------
**可辨识性测试**：缩到目标显示尺寸（26 / 46 / 78 px）的 100%，看剪影还认不认得出是鱼。
认不出就是重做。旧版（椭圆 + 一片三角）在 26px 上读作"蝌蚪 / 叶子"。

用法：python tools/preview_v664.py
输出：docs/shots/v664_beam_and_school.png
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'shots'

W, H = 1304, 749

# --- 光柱常量（逐字取自 DiveGame.ts，V6.64 现值）---
BEAM_N_NEW = 13
BEAM_N_OLD = 4
BEAM_VP_X, BEAM_VP_Y = 0.62, -0.55
BEAM_SWAY_T = 11
BEAM_SWAY_A = 14
BEAM_SWAY_STEP = 0.55
BEAM_SWAY_PH_OLD = [0, 1.7, 3.4, 5.1, 0.9, 2.6]
BEAM_COL_TOP, BEAM_COL_BOT = 0xfff2dc, 0x93cdf0
BEAM_ABSORB = 1.75
BEAM_DIFFUSE = 0.8
BEAM_W_BASE, BEAM_W_AMP = 80.0, 36.0
BEAM_WAVE_K = 1.6
BEAM_WAVE_JITTER = 0.22
BEAM_A0, BEAM_A1 = 0.013, 0.009
BEAM_SHEET_A = 0.115
BEAM_A0_OLD, BEAM_A1_OLD = 0.030, 0.022
BEAM_W0_OLD, BEAM_W1_OLD = 24.0, 44.0
BEAM_SEG = 3
BEAM_OVERLAP = 0.04

# --- 鱼群 ---
FISH_OUTLINE = [
    (0.00, 0.16), (0.16, 0.60), (0.38, 1.00), (0.62, 0.72), (0.82, 0.38), (0.98, 0.26),
    (1.24, 1.05), (0.94, 0.10), (1.24, -1.05),
    (0.98, -0.26), (0.82, -0.38), (0.62, -0.72), (0.38, -1.00), (0.16, -0.60), (0.00, -0.16),
]
WATER = (0x0d, 0x21, 0x30)      # L1 水体近似（供鱼群剪影压在上面）
FISH_TINT = 0x2b5266

INK = (0xc8, 0xf8, 0xff)
DIM = (150, 186, 202)
PAGE = (10, 14, 20)
GOOD = (120, 240, 190)
BAD = (255, 110, 130)


def font(sz, bold=False):
    p = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    try:
        return ImageFont.truetype(p, sz)
    except Exception:
        return ImageFont.load_default()


def rgb(c):
    """同时接受 int（0xRRGGBB）与 tuple（mix() 的结果）。"""
    if isinstance(c, (tuple, list)):
        r, g, b = c[0], c[1], c[2]
        return (int(r) & 255, int(g) & 255, int(b) & 255)
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def mix(c1, c2, t):
    r1, g1, b1 = rgb(c1)
    r2, g2, b2 = rgb(c2)
    return (int(r1 + (r2 - r1) * t), int(g1 + (g2 - g1) * t), int(b1 + (b2 - b1) * t))


def poly_a(base: Image.Image, pts, col, a: float) -> None:
    """在透明层画多边形，再 alpha_composite 到 base（复刻 Cocos 的 over 合成）。"""
    ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).polygon(pts, fill=rgb(col) + (int(a * 255),))
    base.alpha_composite(ov)


def ell_a(base: Image.Image, cx, cy, rx, ry, col, a: float) -> None:
    ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=rgb(col) + (int(a * 255),))
    base.alpha_composite(ov)


def tri_a(base: Image.Image, pts, col, a: float) -> None:
    poly_a(base, pts, col, a)


# ---------------------------------------------------------------------------
# 光柱
# ---------------------------------------------------------------------------
def build_beams(new: bool, seed=7):
    rnd = random.Random(seed)
    W_ = W
    out = []
    if new:
        phi = rnd.random() * math.pi * 2
        for i in range(BEAM_N_NEW):
            u = i / BEAM_N_NEW
            wave = math.sin(u * BEAM_WAVE_K * math.pi * 2 + phi)
            jit = (rnd.random() - 0.5) * 2 * BEAM_WAVE_JITTER
            k = max(-1.0, min(1.0, wave + jit))
            out.append(dict(
                x=W_ * ((i + 0.5 + (rnd.random() - 0.5) * 0.35) / BEAM_N_NEW),
                w=BEAM_W_BASE + BEAM_W_AMP * k,
                ph=i * BEAM_SWAY_STEP,
                lit=max(0.35, 1.0 - 0.55 * (k * 0.5 + 0.5)),
            ))
    else:
        for i in range(BEAM_N_OLD):
            out.append(dict(
                x=W_ * ((i + 0.5 + (rnd.random() - 0.5) * 1.1) / BEAM_N_OLD),
                w=BEAM_W0_OLD + rnd.random() * BEAM_W1_OLD,
                ph=BEAM_SWAY_PH_OLD[i % len(BEAM_SWAY_PH_OLD)],
                lit=1.0,
            ))
    return out


BEAM_ENV_GAIN = 0.35


def envelope(beams, y, yBot, step=1.5):
    """复刻 `beamEnvelope`：某一行的横向起伏包络（[x, v] 列表）。"""
    k = (y - (H * BEAM_VP_Y)) / (yBot - H * BEAM_VP_Y)
    grow = 1 + BEAM_DIFFUSE * max(0.0, min(1.0, k))
    n = int(math.ceil(W / step)) + 1
    out = []
    for i in range(n):
        x = i * step
        env = 0.0
        for b in beams:
            bx = W * BEAM_VP_X + (b['sx'] - W * BEAM_VP_X) * k
            half = b['w'] * 0.72 * grow
            d = abs(x - bx)
            if d >= half:
                continue
            env += (1 - d / half) * b['lit']
        out.append((x, env * BEAM_ENV_GAIN))
    return out


def draw_beams(new: bool, t=3.0, seed=7) -> Image.Image:
    """复刻 `drawBeams`，返回一张 **RGBA 光柱层**（还没有背景）。"""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    beams = build_beams(new, seed)
    sway = math.sin((t / BEAM_SWAY_T) * math.pi * 2)
    vpX = W * BEAM_VP_X + sway * 26
    vpY = H * BEAM_VP_Y
    yTop, yBot = -80.0, float(H) + 40
    span = yBot - yTop
    if new:
        # 整片基底 + 起伏包络（剖面处要读的这个层）
        xL, xR = -80, W + 80
        for b in beams:
            b['sx'] = b['x'] + math.sin((t / BEAM_SWAY_T) * math.pi * 2 + b['ph']) * BEAM_SWAY_A
        for s in range(BEAM_SEG):
            t0 = s / BEAM_SEG
            t1 = min(1.0, (s + 1) / BEAM_SEG + BEAM_OVERLAP)
            yA, yB = yTop + span * t0, yTop + span * t1
            env = envelope(beams, (yA + yB) * 0.5, yBot)
            a0 = BEAM_SHEET_A * math.exp(-BEAM_ABSORB * t0)
            if a0 < 0.002:
                continue
            colr = mix(BEAM_COL_TOP, BEAM_COL_BOT, t0)
            # 逐 1.5px 段画（首尾相接，不留缝）
            for i in range(len(env) - 1):
                x0 = xL if i == 0 else env[i][0]
                x1 = xR if i == len(env) - 2 else env[i + 1][0]
                a = a0 * (1 + env[i][1])
                if a < 0.002:
                    continue
                poly_a(layer, [(max(xL, x0), yA), (x1, yA), (x1, yB), (max(xL, x0), yB)], colr, a)
        return layer
    for b in beams:
        sx = b['x'] + math.sin((t / BEAM_SWAY_T) * math.pi * 2 + b['ph']) * BEAM_SWAY_A
        if new:
            bright = 1.30 - ((b['w'] - BEAM_W_BASE) / BEAM_W_AMP) * 0.35
            a0, a1 = BEAM_A0, BEAM_A1
        else:
            bright = 1.30 - (b['w'] - BEAM_W0_OLD) / BEAM_W1_OLD * 0.80
            a0, a1 = BEAM_A0_OLD, BEAM_A1_OLD
        for L in range(3):
            wTop = b['w'] * (1.45 - 0.32 * L)
            aBase = (a0 + a1 * L) * bright
            for s in range(BEAM_SEG):
                t0 = s / BEAM_SEG
                t1 = min(1.0, (s + 1) / BEAM_SEG + BEAM_OVERLAP)
                yA, yB = yTop + span * t0, yTop + span * t1
                kA = (yA - vpY) / (yBot - vpY)
                kB = (yB - vpY) / (yBot - vpY)
                cxA = vpX + (sx - vpX) * kA
                cxB = vpX + (sx - vpX) * kB
                wA = wTop * (1 + BEAM_DIFFUSE * t0)
                wB = wTop * (1 + BEAM_DIFFUSE * t1)
                a = aBase * math.exp(-BEAM_ABSORB * t0)
                col = mix(BEAM_COL_TOP, BEAM_COL_BOT, t0)
                poly_a(layer, [(cxA - wA * 0.5, yA), (cxA + wA * 0.5, yA),
                               (cxB + wB * 0.5, yB), (cxB - wB * 0.5, yB)], col, a)
    return layer


def profile(layer: Image.Image, y_frac=0.35):
    """某一行的横向 alpha 剖面（0~255）。"""
    y = int(H * y_frac)
    a = layer.getchannel('A')
    return list(a.crop((0, y, W, y + 1)).tobytes())


def prof_stats(p):
    lo, hi = int(W * 0.20), int(W * 0.80)
    seg = p[lo:hi]
    mx = max(seg) or 1
    mn = min(seg)
    mean = sum(seg) / len(seg)
    return mn, mx, mean, mn / mx


# ---------------------------------------------------------------------------
# 鱼群
# ---------------------------------------------------------------------------
def fish_pts(cx, cy, L, s, phase, t=0.0):
    Hh = L * 0.20
    swing = math.sin(t * 5 + phase) * Hh * 0.55
    pts = []
    for (u, v) in FISH_OUTLINE:
        wTail = max(0.0, (u - 0.6) / 0.4)
        bend = math.sin(t * 5 + phase - 0.8) * Hh * 0.12 * math.sin(u * math.pi)
        pts.append((cx + s * (0.5 - u) * L, cy + v * Hh + bend + swing * wTail))
    return pts


def draw_fish(base, cx, cy, L, s, phase, col, a, new=True, t=0.0):
    if new:
        poly_a(base, fish_pts(cx, cy, L, s, phase, t), col, a)
    else:
        h = L * 0.40
        ell_a(base, cx, cy, L * 0.5, h * 0.5, col, a)
        swing = math.sin(t * 5 + phase) * h * 0.5
        tx = cx - s * L * 0.48
        ty = cy + swing
        # fillTri(ang=π/0, len, halfW)：朝左 / 朝右的三角
        if s > 0:
            tri_a(base, [(tx - L * 0.42, ty), (tx + L * 0.25, ty - h * 0.5),
                         (tx + L * 0.25, ty + h * 0.5)], col, a)
        else:
            tri_a(base, [(tx + L * 0.42, ty), (tx - L * 0.25, ty - h * 0.5),
                         (tx - L * 0.25, ty + h * 0.5)], col, a)


# ---------------------------------------------------------------------------
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.new('RGB', (W, 1180), PAGE)
    d = ImageDraw.Draw(im)

    d.text((16, 12), 'V6.64  光柱：离散柱 -> 连续光幕   ·   远景鱼群：椭圆 -> 鱼形', fill=INK, font=font(21, True))
    d.text((16, 38), '光柱的判据是**横向 alpha 剖面**：峰间降到 0 = 几根柱子；不降到 0 = 一片光。这是数字，不是审美。',
           fill=DIM, font=font(12))

    # ---------- 行 1：两张光柱（压在暗底上）----------
    y1 = 62
    TW, TH = 632, 363
    d.text((16, y1 - 18), 'V6.61 旧版：4 条 · 宽度随机 · 相位乱序', fill=BAD, font=font(14, True))
    d.text((16 + TW + 24, y1 - 18), 'V6.64 新版：13 条 · 宽度行波 · 相位递增', fill=GOOD, font=font(14, True))
    stats = {}
    for i, new in enumerate((False, True)):
        lay = draw_beams(new)
        bg = Image.new('RGBA', (W, H), WATER + (255,))
        bg.alpha_composite(lay)
        thumb = bg.convert('RGB').resize((TW, TH), Image.LANCZOS)
        x = 16 + i * (TW + 24)
        im.paste(thumb, (x, y1))
        d.rectangle([x, y1, x + TW, y1 + TH], outline=(60, 74, 90))
        stats[new] = prof_stats(profile(lay))

    y2 = y1 + TH + 16
    for i, new in enumerate((False, True)):
        mn, mx, mean, ratio = stats[new]
        x = 16 + i * (TW + 24)
        col = GOOD if ratio > 0.3 else BAD
        d.text((x, y2), f'剖面 min={mn}  max={mx}  mean={mean:.0f}   min/max={ratio:.2f}'
                        f'   ->  {"连续光幕" if ratio > 0.3 else "离散柱子"}',
               fill=col, font=font(13, True))

    # ---------- 行 2：横向剖面曲线 ----------
    y3 = y2 + 30
    d.text((16, y3 - 18), '横向 alpha 剖面（y = 35% 屏高）  ——  上=旧 · 下=新', fill=INK, font=font(14, True))
    pw, ph = W - 32, 150
    d.rectangle([16, y3, 16 + pw, y3 + ph], fill=(26, 34, 44))
    for i, new in enumerate((False, True)):
        p = profile(draw_beams(new))
        off = y3 + 8 + i * (ph // 2 - 8)
        col = (255, 110, 130) if not new else (120, 240, 190)
        pts = []
        for x in range(0, W, 3):
            v = p[x] / 255.0
            pts.append((16 + x / W * pw, off + (ph // 2 - 16) * (1 - v)))
        if len(pts) > 1:
            d.line(pts, fill=col, width=2)
        # 零线
        d.line([(16, off + ph // 2 - 16), (16 + pw, off + ph // 2 - 16)], fill=(70, 86, 104))
    d.text((16, y3 + ph + 4),
           '旧版：几个孤立峰、峰间**掉到 0** ⇒ 视觉上就是几根柱子。'
           '新版：一条**不中断的连续曲线**，有起伏但处处有光 ⇒ 一片从上方来的光幕。',
           fill=DIM, font=font(12))

    # ---------- 行 3：鱼群形状（三档尺寸 · 新/旧对照）----------
    y4 = y3 + ph + 34
    d.text((16, y4 - 18), '远景鱼群剪影：实际显示尺寸 26 / 46 / 78 px   左=旧（椭圆+三角）  右=新（单条鱼形轮廓）',
           fill=INK, font=font(14, True))
    sizes = (26, 46, 78)
    colw = (W - 40) // 3
    for i, L in enumerate(sizes):
        x = 20 + i * colw
        cell = Image.new('RGBA', (colw - 8, 150), WATER + (255,))
        # 旧
        for j in range(3):
            draw_fish(cell, 60 + j * (L + 26), 46, L, 1 if j % 2 == 0 else -1,
                      j * 1.7, FISH_TINT, 0.35, new=False, t=0.0)
        # 新
        for j in range(3):
            draw_fish(cell, 60 + j * (L + 26), 112, L, 1 if j % 2 == 0 else -1,
                      j * 1.7, FISH_TINT, 0.35, new=True, t=0.0)
        im.paste(cell.convert('RGB'), (x, y4))
        d.rectangle([x, y4, x + colw - 8, y4 + 150], outline=(60, 74, 90))
        d.text((x + 4, y4 + 152), f'{L} px', fill=DIM, font=font(12))

    # ---------- 行 4：成团远景合成 ----------
    y5 = y4 + 180
    d.text((16, y5 - 18), '成团合成（L1：3 团 x 8 条，压在水体上）—— 判据：读作"一群鱼"还是"一层脏点"',
           fill=INK, font=font(14, True))
    for i, new in enumerate((False, True)):
        cell = Image.new('RGBA', (632, 300), WATER + (255,))
        rnd = random.Random(11)
        for c in range(3):
            cx0 = 60 + rnd.random() * 460
            cy0 = 50 + rnd.random() * 200
            dir_ = 1 if rnd.random() < 0.5 else -1
            for j in range(8):
                gx = (rnd.random() + rnd.random() - 1) * 62
                gy = (rnd.random() + rnd.random() - 1) * 62 * 0.7
                L = 26 * (0.78 + rnd.random() * 0.44)
                draw_fish(cell, cx0 + gx, cy0 + gy, L, dir_, rnd.random() * 6.28,
                          FISH_TINT, 0.35, new=new, t=0.0)
        x = 16 + i * (632 + 24)
        im.paste(cell.convert('RGB'), (x, y5))
        d.rectangle([x, y5, x + 632, y5 + 300], outline=(60, 74, 90))
        d.text((x + 4, y5 + 302), 'V6.61 旧' if not new else 'V6.64 新',
               fill=BAD if not new else GOOD, font=font(13, True))

    im.save(OUT / 'v664_beam_and_school.png')

    print('已出图:', OUT / 'v664_beam_and_school.png')
    print('\n--- 光柱横向剖面（屏宽 20%~80%）---')
    for new in (False, True):
        mn, mx, mean, ratio = stats[new]
        tag = '旧(V6.61)' if not new else '新(V6.64)'
        verdict = '连续光幕 OK' if ratio > 0.3 else '离散柱子'
        print(f'  {tag}: min={mn:3d} max={mx:3d} mean={mean:6.1f} min/max={ratio:.2f}  -> {verdict}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
