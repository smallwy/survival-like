"""
光的主权转移 · 合成预览（V6.60）。

复刻 `DiveGame` 的 **drawBg → drawVeil → drawAtmo** 三层合成结果，回答一个
单帧代码看不出来的问题：**五带各自"有光"之后，合起来是什么样**。

为什么必须画出来：V6.59 一口气加了 雾 / 探照灯 / 光柱 / 荧光链 / 烟柱 / 点阵 六件，
每一件的参数都是合法的，但"合起来是否还读得出深度、是否过曝、是否糊成一团"
只有把合成结果画出来才知道（与 `preview_atmo.py` 同一个理由）。

⚠️ 常量必须与 TS 同步（改一处不改另一处 = 出一张骗人的图，比没有图更糟）：
  · vis / tint        → shared/dive/tables.ts        LAYERS
  · 压暗 / 暗角        → cocos/.../view/DiveGame.ts   drawVeil()
  · 雾 / 探照灯 / 光柱 / 荧光 / 烟柱 / 点阵 → 同文件 drawFog / drawLamp / drawBeams …
  · 鱼群体色 / alpha   → 同文件 ATM_FISH_TINT / ATM_FISH_ALPHA

用法：
  python tools/preview_lights.py                # 五带 A/B 拼图 → docs/shots/lights_ab.png
  python tools/preview_lights.py --layer 3      # 只出 L4（A/B 横排，放大）→ docs/shots/lights_L4.png
  python tools/preview_lights.py --old-only     # 只出"改前"（无光 + 旧压暗）
"""

import argparse
import math
import os
import random
from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# 与 TS 同步的常量
# ---------------------------------------------------------------------------
W, H = 1304, 749
ABYSS = 0x04070D
CAM_ZOOM = 1.25

# ---- shared/dive/tables.ts · LAYERS ----
# 旧（V6.56）：一路压到黑
LAY_OLD = [
    dict(vis=1.00, tint=0x2A6F8A),
    dict(vis=0.80, tint=0x1D5A5A),
    dict(vis=0.40, tint=0x14203C),
    dict(vis=0.25, tint=0x3A1A10),
    dict(vis=0.10, tint=0x0A0614),
]
# 新（V6.59，V6.51 §2.2/§2.3）：转色相保饱和
LAY_NEW = [
    dict(vis=1.00, tint=0x2A6F8A),
    dict(vis=0.92, tint=0x1D6B7A),
    dict(vis=0.68, tint=0x352F6B),
    dict(vis=0.60, tint=0x7A3A16),
    dict(vis=0.46, tint=0x1A1740),
]

DARK_OLD, VIG_OLD = 0.42, 0.72      # 旧：(1-vis)*0.42 / 0.16+(1-vis)*0.72
DARK_NEW, VIG_NEW = 0.24, 0.42      # 新：(1-vis)*0.24 / 0.10+(1-vis)*0.42
TINT_A_OLD, TINT_A_NEW = 0.10, 0.16

# ---- LAYER_ECO ----
ECO = [
    dict(school=46, schoolSize=0.75, tag='L1 SUNLIT'),
    dict(school=30, schoolSize=0.85, tag='L2 TWILIGHT'),
    dict(school=38, schoolSize=0.95, tag='L3 MIDNIGHT'),
    dict(school=20, schoolSize=0.90, tag='L4 HYDROTHERMAL'),
    dict(school=3,  schoolSize=3.00, tag='L5 ABYSS'),
]
TINT_FISH = [0x2B5266, 0x5F97A2, 0x74F2CC, 0x8A6A48, 0x33485C]
ALPHA_FISH = [(0.26, 0.44), (0.18, 0.32), (0.22, 0.40), (0.16, 0.30), (0.30, 0.48)]
PER_BIG, PER_SMALL, SPREAD = 1, 6, 62

# ---- V6.59 光照层 ----
LAMP_COLOR, LAMP_R, LAMP_STEP = 0xBFF4FF, 168, 9
LAMP_D0, LAMP_D1 = 120, 600
LAMP_ALPHA, LAMP_BANDS, LAMP_POW = 0.044, 14, 1.35
LAMP_EDGE_N, LAMP_EDGE_RAMP = 3, [0.35, 0.60, 0.85]
FOG_R, FOG_BANDS, FOG_ALPHA = [0, 640, 480, 380, 300], 12, 0.22
# ---- 丁达尔光柱（V6.61 物理版）----
BEAM_N = 4
BEAM_VP_X, BEAM_VP_Y = 0.62, -0.55          # 消失点（太阳虚像）
BEAM_SWAY_T, BEAM_SWAY_A = 11, 14
BEAM_SWAY_PH = [0, 1.7, 3.4, 5.1, 0.9, 2.6]
BEAM_COL_TOP, BEAM_COL_BOT = 0xFFF2DC, 0x93CDF0   # 分波长吸收：暖白 → 蓝青
BEAM_ABSORB, BEAM_DIFFUSE = 1.75, 0.8        # Beer-Lambert + 散射扩散
BEAM_W0, BEAM_W1 = 24, 44
BEAM_SEG, BEAM_OVERLAP = 3, 0.04
BEAM_D0, BEAM_D1 = 900, 1200                 # depthM 淡出
FLUO_CHAINS, FLUO_C1, FLUO_C2 = 7, 0xA88CFF, 0x6FF0D0
VENT_N, VENT_HOT, VENT_EDGE = 6, 0xFF8A3C, 0x8A3A18
DOTS_N, DOTS_PERIOD, DOTS_SAFE_R = 48, 3.2, 260
CYAN_HI, CYAN, CYAN_DIM = 0xC8F8FF, 0x4FE8FF, 0x1F6A7D

# 该带中点的 depthM（用于探照灯 / 光柱淡入淡出）
DEPTH_MID = [100, 600, 2500, 5000, 8500]

ENV = 'cocos/assets/resources/env/L{}.png'
OUT = 'docs/shots'


def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def rgba(c, a):
    return rgb(c) + (max(0, min(255, round(a * 255))),)


def cover(img, w, h):
    s = max(w / img.width, h / img.height)
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


# ---------------------------------------------------------------------------
# 各元素（复刻 DiveGame 的几何与顺序）
# ---------------------------------------------------------------------------
def draw_schools(lay, d, i, seed=7):
    eco = ECO[i]
    lo, hi = ALPHA_FISH[i]
    rnd = random.Random(seed + i * 131)
    body = rgb(TINT_FISH[i])
    big = eco['schoolSize'] > 2
    per = PER_BIG if big else PER_SMALL
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
            vx = dirn * spd
            size = size0 * (0.78 + rnd.random() * 0.44)
            a = lo + rnd.random() * (hi - lo)
            x, y, L, hh = cx0 + gx, cy0 + gy, size, size * 0.40
            d.ellipse([x - L / 2, y - hh / 2, x + L / 2, y + hh / 2], fill=rgba(TINT_FISH[i], a))
            ang = math.pi if vx > 0 else 0.0
            ca, sa = math.cos(ang), -math.sin(ang)
            tl, tw = L * 0.42, hh * 0.5
            bx, by = x - (1 if vx > 0 else -1) * L * 0.48, y
            d.polygon([
                (bx + tl * ca, by - tl * sa),
                (bx - 0.6 * tl * ca - tw * sa, by + 0.6 * tl * sa - tw * ca),
                (bx - 0.6 * tl * ca + tw * sa, by + 0.6 * tl * sa + tw * ca),
            ], fill=rgba(TINT_FISH[i], a))


def draw_fog(lay, d, i):
    """同心环带（禁用径向渐变）。PIL 的 ellipse outline width 正好是环带。"""
    r0 = FOG_R[i]
    if r0 <= 0:
        return 0
    r_in = r0 / CAM_ZOOM
    r_out = math.hypot(W, H) / CAM_ZOOM * 0.55
    band = max(20.0, (r_out - r_in) / FOG_BANDS)
    cx, cy = W / 2, H / 2
    for k in range(FOG_BANDS):
        t = (k + 0.5) / FOG_BANDS
        a = FOG_ALPHA * (t ** 1.6)
        r = r_in + band * (k + 0.5)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=rgba(LAY_NEW[i]['tint'], a),
                  width=int(band) + 2)
    return FOG_BANDS


def draw_lamp(lay, d, i):
    k = max(0.0, min(1.0, (DEPTH_MID[i] - LAMP_D0) / (LAMP_D1 - LAMP_D0)))
    if k <= 0.01:
        return 0
    R = (LAMP_R - LAMP_STEP * i) / CAM_ZOOM
    bands = LAMP_BANDS
    a = LAMP_ALPHA * k
    for j in range(bands):
        edge = LAMP_EDGE_RAMP[j] if j < LAMP_EDGE_N else 1.0
        r = R * ((1 - j / bands) ** LAMP_POW)
        d.ellipse([W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r], fill=rgba(LAMP_COLOR, a * edge))
    return bands


def draw_beams(lay, d, i, rnd):
    """V6.61：透视放射 + Beer-Lambert 指数衰减 + 散射扩散 + 分波长变色。

    `fade` 由 depthM 决定（L1 满 / L2 减半），`ph` 每条独立相位。
    """
    if i > 1:
        return 0
    depth = DEPTH_MID[i]
    fade = max(0.0, min(1.0, 1 - (depth - BEAM_D0) / (BEAM_D1 - BEAM_D0)))
    if fade <= 0.01:
        return 0
    n = 0
    y_top, y_bot = -80, H + 40
    vpx, vpy = W * BEAM_VP_X, H * BEAM_VP_Y
    span = y_bot - y_top
    for b in range(BEAM_N):
        bw = BEAM_W0 + rnd.random() * BEAM_W1
        sx = W * ((b + 0.5 + (rnd.random() - 0.5) * 1.1) / BEAM_N) \
            + math.sin(BEAM_SWAY_PH[b % len(BEAM_SWAY_PH)]) * BEAM_SWAY_A
        bright = 1.30 - (bw - BEAM_W0) / BEAM_W1 * 0.80
        for L in range(3):
            w_top = (bw * (1.45 - 0.32 * L)) / CAM_ZOOM
            a_base = (0.030 + 0.022 * L) * fade * bright
            for sg in range(BEAM_SEG):
                t0 = sg / BEAM_SEG
                t1 = min(1.0, (sg + 1) / BEAM_SEG + BEAM_OVERLAP)
                ya, yb = y_top + span * t0, y_top + span * t1
                ka = (ya - vpy) / (y_bot - vpy)
                kb = (yb - vpy) / (y_bot - vpy)
                cxa = vpx + (sx - vpx) * ka          # 向消失点收敛
                cxb = vpx + (sx - vpx) * kb
                wa = w_top * (1 + BEAM_DIFFUSE * t0)   # 越深越宽
                wb = w_top * (1 + BEAM_DIFFUSE * t1)
                a = a_base * math.exp(-BEAM_ABSORB * t0)   # 指数衰减
                col = mix_col(BEAM_COL_TOP, BEAM_COL_BOT, t0)  # 变色
                d.polygon([(cxa - wa * 0.5, ya), (cxa + wa * 0.5, ya),
                           (cxb + wb * 0.5, yb), (cxb - wb * 0.5, yb)], fill=rgba(col, a))
                n += 1
    return n


def mix_col(c1, c2, t):
    r1, g1, b1 = (c1 >> 16) & 255, (c1 >> 8) & 255, c1 & 255
    r2, g2, b2 = (c2 >> 16) & 255, (c2 >> 8) & 255, c2 & 255
    return (int(r1 + (r2 - r1) * t) << 16) | (int(g1 + (g2 - g1) * t) << 8) | int(b1 + (b2 - b1) * t)


def draw_fluo(lay, d, i, rnd):
    if i != 2:
        return 0
    n = 0
    for _c in range(FLUO_CHAINS):
        k = 3 + rnd.randrange(5)
        dirn = -1 if rnd.random() < 0.5 else 1
        x0, y0 = rnd.random() * W, rnd.random() * H
        hue = FLUO_C2 if rnd.random() < 0.2 else FLUO_C1
        for p in range(k):
            px = x0 + dirn * p * (8 + rnd.random() * 10)
            py = y0 + (rnd.random() - 0.5) * 22
            d.ellipse([px - 2.2, py - 2.2, px + 2.2, py + 2.2], fill=rgba(hue, 0.85))
            n += 1
    return n


def draw_vents(lay, d, i, rnd):
    if i != 3:
        return 0
    n = 0
    for v in range(VENT_N):
        vx = W * ((v + 0.5 + (rnd.random() - 0.5) * 0.6) / VENT_N)
        vy = rnd.random() * H
        vw = 30 + rnd.random() * 60
        for j in range(4):
            k = j / 3
            yy = vy - k * vw * 0.55
            rr = vw * (0.52 + k * 0.95)
            col = VENT_HOT if j < 2 else VENT_EDGE
            d.ellipse([vx - rr, yy - rr * 0.72, vx + rr, yy + rr * 0.72],
                      fill=rgba(col, 0.15 - 0.11 * k))
            n += 1
    gy = H - 20
    for j in range(3):
        d.ellipse([W / 2 - (380 - j * 100), gy + j * 16 - (26 - j * 6),
                   W / 2 + (380 - j * 100), gy + j * 16 + (26 - j * 6)],
                  fill=rgba(VENT_HOT, 0.09 - j * 0.025))
        n += 1
    return n


def draw_dots(lay, d, i, rnd):
    if i != 4:
        return 0
    n = 0
    cx, cy = W / 2, H / 2
    for _ in range(DOTS_N):
        for _t in range(8):
            x, y = rnd.random() * W, rnd.random() * H
            if math.hypot(x - cx, y - cy) > DOTS_SAFE_R:
                break
        r = 1.4 + rnd.random() * 1.4
        halo = rnd.random() < 0.2
        if halo:
            for j in (3, 2, 1):
                rr = r + j * 3.2
                d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=rgba(CYAN_HI, 0.10 * j))
                n += 1
        d.ellipse([x - r, y - r, x + r, y + r], fill=rgba(CYAN_HI, 0.60))
        n += 1
    return n


def compose(i, new, tw, th):
    """一层水的完整合成。返回 (图, 图元统计)。"""
    L = LAY_NEW[i] if new else LAY_OLD[i]
    tint_a = TINT_A_NEW if new else TINT_A_OLD
    dark = (1 - L['vis']) * (DARK_NEW if new else DARK_OLD)
    vig = 0.10 + (1 - L['vis']) * (VIG_NEW if new else VIG_OLD)

    base = cover(Image.open(ENV.format(i + 1)).convert('RGB'), W, H)
    base = Image.blend(base, Image.new('RGB', base.size, rgb(L['tint'])), tint_a)
    if dark > 0.001:
        base = Image.blend(base, Image.new('RGB', base.size, rgb(ABYSS)), dark)

    # 暗角：同心环带（每像素只覆盖一次）
    vg = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dv = ImageDraw.Draw(vg)
    band = min(W, H) / 18

    def rect_safe(x0, y0, x1, y1, fill):
        # 靠后的环带里，某条边会退化成负高度 —— TS 那边 `fillRect` 画负高度等于不画，
        # PIL 会直接抛 ValueError，所以这里显式跳过（不是"容错"，是复刻同一语义）。
        if x1 <= x0 or y1 <= y0:
            return
        dv.rectangle([x0, y0, x1, y1], fill=fill)

    for b in range(18):
        a = (1 - b / 18) ** 2.4 * vig
        if a < 0.004:
            continue
        o = b * band
        e = o + band
        col = rgba(ABYSS, a)
        rect_safe(o, o, W - o, e, col)              # 上
        rect_safe(o, H - e, W - o, H - o, col)      # 下
        rect_safe(o, e, e, H - e, col)              # 左
        rect_safe(W - e, e, W - o, H - e, col)      # 右
    base = Image.alpha_composite(base.convert('RGBA'), vg)

    # ---- gAtmo：鱼群 → 雾 → 探照灯 → 按带光源 ----
    rnd = random.Random(31 + i * 17)
    at = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    da = ImageDraw.Draw(at)
    stats = {}
    draw_schools(at, da, i)
    if new:
        stats['fog'] = draw_fog(at, da, i)
        stats['lamp'] = draw_lamp(at, da, i)
        if i <= 1:
            stats['beams'] = draw_beams(at, da, i, rnd)
        elif i == 2:
            stats['fluo'] = draw_fluo(at, da, i, rnd)
        elif i == 3:
            stats['vents'] = draw_vents(at, da, i, rnd)
        elif i == 4:
            stats['dots'] = draw_dots(at, da, i, rnd)
    base = Image.alpha_composite(base, at).convert('RGB')

    out = base.resize((tw, th), Image.LANCZOS)
    return out, stats


def label(img, text, color=(150, 230, 255)):
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, img.width - 1, 18], fill=rgb(ABYSS))
    d.text((6, 5), text, fill=color)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--layer', type=int, default=None, help='只出一层（0-4）')
    ap.add_argument('--old-only', action='store_true', help='只出"改前"')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    if args.layer is not None:
        i = args.layer
        tw = int(W * 0.60)
        th = int(tw * H / W)
        cols = []
        b, _ = compose(i, False, tw, th)
        label(b, f'{ECO[i]["tag"]}  BEFORE (V6.56, no light)')
        cols.append(b)
        if not args.old_only:
            a, st = compose(i, True, tw, th)
            label(a, f'{ECO[i]["tag"]}  AFTER (V6.60)', (190, 255, 220))
            cols.append(a)
            print(f'L{i + 1} 图元：', {k: v for k, v in st.items() if v})
        sheet = Image.new('RGB', (tw * len(cols) + 6 * (len(cols) - 1), th), rgb(ABYSS))
        for c, im in enumerate(cols):
            sheet.paste(im, (c * (tw + 6), 0))
        path = f'{OUT}/lights_L{i + 1}.png'
        sheet.save(path)
        print('写入', path, sheet.size)
        return

    tw = int(W * 0.34)
    th = int(tw * H / W)
    rows = []
    for i in range(5):
        b, _ = compose(i, False, tw, th)
        label(b, f'{ECO[i]["tag"]}  BEFORE')
        if args.old_only:
            rows.append([b])
        else:
            a, _ = compose(i, True, tw, th)
            label(a, 'AFTER (V6.60)', (190, 255, 220))
            rows.append([b, a])
    cols = len(rows[0])
    sheet = Image.new('RGB', (tw * cols + 6 * (cols - 1), th * 5), rgb(ABYSS))
    for i, row in enumerate(rows):
        for c, im in enumerate(row):
            sheet.paste(im, (c * (tw + 6), i * th))
    path = f'{OUT}/lights_ab{"_old" if args.old_only else ""}.png'
    sheet.save(path)
    print('写入', path, sheet.size)


if __name__ == '__main__':
    main()
