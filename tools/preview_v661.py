"""
V6.61 物理化预览：**光柱**（几何 → 物理）与**撒网**（圆形 → 水滴形）。

回答的问题（用户批评「太机械化 / 不结合物理世界 / 光在水里不能消化吗 / 撒出去是个圆形」）：
  ① 光柱：从"等距平行直条 + 多项式衰减"改成"透视放射 + 指数衰减 + 变色 + 颗粒照亮"后，
     是否读作"透过水面的太阳光"，而不是"贴上去的几条光带"。
  ② 撒网：从"同心圆环"改成"沿抛出方向拉长的水滴形 + 扇贝网缘 + 展开→塌陷"后，
     是否读作"一张被甩出去的柔性网"，而不是"一个圆"。

为什么必须画出来：物理对不对，代码读不出来 —— 只有把合成结果画出来（与 `preview_lights.py`
同一个理由）。特别是"变色"与"指数衰减的拖尾"，都是**曲线形状**问题。

⚠️ alpha 必须先画到**透明层**再 `alpha_composite` —— `ImageDraw` 在 RGBA 上画**不做混合，
   是直接覆盖**（第一版两张图都因此糊成实心，见 V6.61 日志）。本脚本每个图元单独合成。

用法：
  python tools/preview_v661.py             # 两张都出（光柱 + 撒网）
  python tools/preview_v661.py --beam      # 只出光柱
  python tools/preview_v661.py --net       # 只出撒网

输出 `docs/shots/beam_phys.png` / `docs/shots/net_phys.png`。
"""

import math
import os
import sys
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# 与 TS 同步的常量（改一处不改另一处 = 出一张骗人的图）
# ---------------------------------------------------------------------------
W, H = 1304, 749
ENV = 'cocos/assets/resources/env/L1.png'
OUT = 'docs/shots'
ABYSS = 0x04070D
CAM_ZOOM = 1.25

# ---- shared/dive/tables.ts · LAYERS[0]（L1 阳光带）----
L1_TINT, L1_TINT_A, L1_VIS = 0x2A6F8A, 0.16, 1.00

# ---- 丁达尔光柱 ----
BEAM_N = 4
BEAM_VP_X, BEAM_VP_Y = 0.62, -0.55
BEAM_COL_TOP, BEAM_COL_BOT = 0xFFF2DC, 0x93CDF0
BEAM_ABSORB, BEAM_DIFFUSE = 1.75, 0.8
BEAM_W0, BEAM_W1 = 24, 44
BEAM_SEG, BEAM_OVERLAP = 3, 0.04
# 旧的几何参数（对照）
OLD_TILT, OLD_SPREAD, OLD_FALLOFF, OLD_COLOR = 0.314, 1.45, 1.6, 0xDFF2FF

# ---- 撒网 ----
NET_OPEN_END = 0.42
NET_STRETCH, NET_TAPER = 0.45, 0.22
NET_SCALLOP, NET_SCALLOP_N = 0.035, 6
NET_SEGS, NET_JITTER = 12, 0.05
NET_COLLAPSE, NET_R = 0.82, 96
NET_COL = 0x6FD4B8          # UI.jade 近似


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def mix_col(c1, c2, t):
    r1, g1, b1 = rgb(c1)
    r2, g2, b2 = rgb(c2)
    return (int(r1 + (r2 - r1) * t) << 16) | (int(g1 + (g2 - g1) * t) << 8) | int(b1 + (b2 - b1) * t)


def font(sz):
    try:
        return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', sz)
    except Exception:
        return ImageFont.load_default()


def cover(img, w, h):
    iw, ih = img.size
    s = max(w / iw, h / ih)
    nw, nh = int(iw * s + 0.5), int(ih * s + 0.5)
    img = img.resize((nw, nh), Image.LANCZOS)
    return img.crop(((nw - w) // 2, (nh - h) // 2, (nw - w) // 2 + w, (nh - h) // 2 + h))


# ---- 逐图元 alpha 合成（核心：ImageDraw 不混合，必须走透明层）----
def _lay(base):
    return Image.new('RGBA', base.size, (0, 0, 0, 0))


def _scaled(ov, a):
    al = ov.getchannel('A').point(lambda v: int(v * a))
    ov.putalpha(al)
    return ov


def poly_a(base, pts, col, a):
    if a <= 0.002 or len(pts) < 3:
        return base
    ov = _lay(base)
    ImageDraw.Draw(ov).polygon(pts, fill=rgb(col) + (255,))
    return Image.alpha_composite(base, _scaled(ov, a))


def line_a(base, pts, col, a, w=1):
    if a <= 0.002 or len(pts) < 2:
        return base
    ov = _lay(base)
    ImageDraw.Draw(ov).line(pts, fill=rgb(col) + (255,), width=w, joint='curve')
    return Image.alpha_composite(base, _scaled(ov, a))


def ell_a(base, cx, cy, r, col, a):
    if a <= 0.002:
        return base
    ov = _lay(base)
    ImageDraw.Draw(ov).ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgb(col) + (255,))
    return Image.alpha_composite(base, _scaled(ov, a))


def circ_a(base, cx, cy, r, col, a, w=1):
    if a <= 0.002:
        return base
    ov = _lay(base)
    ImageDraw.Draw(ov).ellipse([cx - r, cy - r, cx + r, cy + r],
                               outline=rgb(col) + (255,), width=w)
    return Image.alpha_composite(base, _scaled(ov, a))


# ---------------------------------------------------------------------------
# ① 光柱：几何 vs 物理
# ---------------------------------------------------------------------------
def old_beams(base, rnd):
    tan = math.tan(OLD_TILT)
    y_top, y_bot = -80, H + 40
    span = y_bot - y_top
    for b in range(BEAM_N):
        bx = W * ((b + 0.5 + (rnd.random() - 0.5) * 1.1) / BEAM_N)
        bw = BEAM_W0 + rnd.random() * BEAM_W1
        bright = 1.30 - (bw - BEAM_W0) / BEAM_W1 * 0.80
        for L in range(3):
            w_top = (bw * (1.45 - 0.32 * L)) / CAM_ZOOM
            w_bot = w_top * OLD_SPREAD
            a_base = (0.030 + 0.022 * L) * bright
            x_top = bx - tan * (H * 0.5)
            for sg in range(BEAM_SEG):
                t0 = sg / BEAM_SEG
                t1 = min(1.0, (sg + 1) / BEAM_SEG + BEAM_OVERLAP)
                ya, yb = y_top + span * t0, y_top + span * t1
                wa = w_top + (w_bot - w_top) * t0
                wb = w_top + (w_bot - w_top) * t1
                cxa, cxb = x_top + tan * (ya - y_top), x_top + tan * (yb - y_top)
                a = a_base * ((1 - t0) ** OLD_FALLOFF)
                base = poly_a(base, [(cxa - wa * .5, ya), (cxa + wa * .5, ya),
                                     (cxb + wb * .5, yb), (cxb - wb * .5, yb)],
                              OLD_COLOR, a)
    return base


def new_beams(base, rnd):
    y_top, y_bot = -80, H + 40
    vpx, vpy = W * BEAM_VP_X, H * BEAM_VP_Y
    span = y_bot - y_top
    for b in range(BEAM_N):
        bw = BEAM_W0 + rnd.random() * BEAM_W1
        sx = W * ((b + 0.5 + (rnd.random() - 0.5) * 1.1) / BEAM_N)
        bright = 1.30 - (bw - BEAM_W0) / BEAM_W1 * 0.80
        for L in range(3):
            w_top = (bw * (1.45 - 0.32 * L)) / CAM_ZOOM
            a_base = (0.030 + 0.022 * L) * bright
            for sg in range(BEAM_SEG):
                t0 = sg / BEAM_SEG
                t1 = min(1.0, (sg + 1) / BEAM_SEG + BEAM_OVERLAP)
                ya, yb = y_top + span * t0, y_top + span * t1
                ka, kb = (ya - vpy) / (y_bot - vpy), (yb - vpy) / (y_bot - vpy)
                cxa, cxb = vpx + (sx - vpx) * ka, vpx + (sx - vpx) * kb
                wa, wb = w_top * (1 + BEAM_DIFFUSE * t0), w_top * (1 + BEAM_DIFFUSE * t1)
                a = a_base * math.exp(-BEAM_ABSORB * t0)
                col = mix_col(BEAM_COL_TOP, BEAM_COL_BOT, t0)
                base = poly_a(base, [(cxa - wa * .5, ya), (cxa + wa * .5, ya),
                                     (cxb + wb * .5, yb), (cxb - wb * .5, yb)], col, a)
    return base


def draw_beam():
    import random
    base = cover(Image.open(ENV).convert('RGB'), W, H).convert('RGBA')
    base = Image.blend(base, Image.new('RGBA', (W, H), rgb(L1_TINT) + (255,)), L1_TINT_A)

    # 左半 = 旧（几何）/ 右半 = 新（物理），各自在自己半屏上画满屏光柱再拼
    left = old_beams(base.copy(), random.Random(7))
    right = new_beams(base.copy(), random.Random(7))
    combined = Image.new('RGBA', (W, H))
    combined.paste(left.crop((0, 0, W // 2, H)), (0, 0))
    combined.paste(right.crop((W // 2, 0, W, H)), (W // 2, 0))

    d = ImageDraw.Draw(combined)
    d.line([(W // 2, 0), (W // 2, H)], fill=(255, 255, 255, 90), width=2)
    d.text((14, 12), 'V6.60 几何：等距平行直条 · (1-t)^1.6 · 单一色',
           fill=(255, 175, 175), font=font(15))
    d.text((W // 2 + 14, 12), 'V6.61 物理：透视放射 · e^-1.75t · 变色',
           fill=(160, 240, 255), font=font(15))
    d.text((14, H - 30),
           '真平行太阳光经透视必汇聚到消失点(云隙光的几何)；水对视光是 Beer-Lambert 指数衰减、红光先被吃掉',
           fill=(210, 225, 240), font=font(13))
    p = os.path.join(OUT, 'beam_phys.png')
    combined.convert('RGB').save(p)
    return p


# ---------------------------------------------------------------------------
# ② 撒网：圆形 vs 水滴形（时序）
# ---------------------------------------------------------------------------
def net_poly(cx, cy, ang, t, rnd):
    open_ = t < NET_OPEN_END
    k_in = t / NET_OPEN_END if open_ else (t - NET_OPEN_END) / (1 - NET_OPEN_END)
    spread = (0.35 + 0.65 * k_in) if open_ else (1 - (1 - NET_COLLAPSE) * k_in)
    # 沿抛出方向的半轴被拉长（迎水面前缘被拖），垂直方向维持 r
    a1 = NET_R * spread * (1 + NET_STRETCH * (k_in if open_ else 1))
    b1 = NET_R * spread
    ca, sa = math.cos(ang), math.sin(ang)
    ph = [rnd.random() for _ in range(NET_SEGS)]
    pts = []
    for k in range(NET_SEGS):
        th = (k / NET_SEGS) * math.pi * 2
        w = (1 - NET_TAPER * math.cos(th)) \
            * (1 + NET_SCALLOP * math.sin(NET_SCALLOP_N * th) + (ph[k] - 0.5) * NET_JITTER)
        lx, ly = a1 * w * math.cos(th), b1 * w * math.sin(th)
        pts.append((cx + lx * ca - ly * sa, cy + lx * sa + ly * ca))
    al = (0.30 + 0.55 * k_in) if open_ else 0.85 * (1 - k_in)
    return pts, al


def draw_net_phys(base, cx, cy, ang, t, rnd):
    pts, al = net_poly(cx, cy, ang, t, rnd)
    base = poly_a(base, pts, NET_COL, al * 0.12)                       # 网衣
    base = line_a(base, pts + [pts[0]], NET_COL, al, 2)                # 网缘
    for k in range(NET_SEGS):                                          # 径向索
        px, py = pts[k]
        base = line_a(base, [(cx + (px - cx) * 0.92, cy + (py - cy) * 0.92), (px, py)],
                      NET_COL, al * 0.5, 1)
    for fr in (0.38, 0.66):                                            # 环向索
        ring = [(cx + (p[0] - cx) * fr, cy + (p[1] - cy) * fr) for p in pts]
        base = line_a(base, ring + [ring[0]], NET_COL, al * 0.42, 1)
    for k in range(NET_SEGS):                                          # 铅坠
        base = ell_a(base, pts[k][0], pts[k][1], 1.8, NET_COL, al * 0.85)
    return base


def draw_net_circle(base, cx, cy, t):
    k = min(1.0, t / 0.4)
    r = NET_R * k
    al = 0.6 * (1 - k * 0.4)
    base = circ_a(base, cx, cy, r, 0xC8F8FF, al, 3)
    base = circ_a(base, cx, cy, r * 0.6, 0xC8F8FF, al * 0.5, 2)
    return base


def draw_net():
    import random
    ystep, cells = 270, 6
    Hh = 70 + ystep * 2 + 40
    base = Image.new('RGBA', (W, Hh), (10, 26, 36, 255))
    ang = 0.0
    for row, physical in enumerate((False, True)):
        cy = 70 + ystep * row + ystep / 2 - 20
        for s in range(cells):
            cx = 110 + s * ((W - 150) / cells)
            t = s / (cells - 1) * 1.05
            if t >= 1:
                continue
            rr = random.Random(3 + s)
            if physical:
                base = draw_net_phys(base, cx, cy, ang, t, rr)
            else:
                base = draw_net_circle(base, cx, cy, t)
    d = ImageDraw.Draw(base)
    d.text((14, 16), 'V6.61 撒网物理化 —— 上排 V6.60「同心圆环」/ 下排 V6.61「水滴形 + 扇贝缘 + 展开→塌陷」',
           fill=(190, 225, 240), font=font(16))
    for row in range(2):
        cy = 70 + ystep * row + ystep / 2 - 20
        for s in range(cells):
            cx = 110 + s * ((W - 150) / cells)
            t = s / (cells - 1) * 1.05
            if t >= 1:
                d.text((cx - 14, cy - 6), 't>1\n结束', fill=(120, 150, 165), font=font(12))
            else:
                d.text((cx - 16, cy + 118), f't={t:.2f}', fill=(150, 185, 200), font=font(12))
    d.text((14, Hh - 30),
           '网是柔性体：沿抛出方向(→)被甩长成水滴、网缘6个铅坠之间网衣被水顶成扇贝波、先张开后塌回 0.82',
           fill=(140, 175, 190), font=font(13))
    p = os.path.join(OUT, 'net_phys.png')
    base.convert('RGB').save(p)
    return p


def main():
    os.makedirs(OUT, exist_ok=True)
    only_beam = '--beam' in sys.argv
    only_net = '--net' in sys.argv
    if not only_net:
        print('已出图:', draw_beam())
    if not only_beam:
        print('已出图:', draw_net())


if __name__ == '__main__':
    main()
