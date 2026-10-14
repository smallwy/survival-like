#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V6.60 两件事的预览（`--blend` / `--flash`，默认全出）。

① depthM 连续化（§9-9）
   旧：`drawVeil` / `drawFog` 取 `w.layer()` 的**常量** tint / vis / 雾半径
       ⇒ 换带那一帧"啪"地换色（图上就是一条硬阶）。
   新：`layerBlend()` 按 `depthM` 在相邻带之间插值，且**本带前 70% 保持本色**、
       后 30% 才过渡（保住每带的辨识度）。
   画法：横轴 = depthM 0→11000，每一列取该深度下**实际会用的**颜色。
        上排 = 旧（阶梯）、下排 = 新（平滑）。下方两条折线是 vis 与雾半径。

② 交互光反馈（§9-7）
   三条触发各自的**时序**：半径扩散 + alpha 衰减（`e²` 先快后慢）。
   `preview_lights.py` 画的是静态合成，看不出"炸开就收"这件事，所以单独画时间轴。

⚠️ 数值必须与 `cocos/assets/scripts/view/DiveGame.ts` 同步
   （`LAMP_*` / `FLASH_*` / `BLEND_FROM` / `LAYERS`）。

用法
----
    python tools/preview_v660.py            # 两张都出
    python tools/preview_v660.py --blend    # 只出连续性
    python tools/preview_v660.py --flash    # 只出光反馈

输出 `docs/shots/blend_curve.png` / `docs/shots/flash_timeline.png`。
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, 'docs', 'shots')

# ---- 与 shared/dive/tables.ts LAYERS 同序 ----
LAYERS = [
    dict(name='阳光带', top=0,     bot=200,   tint=0x2a6f8a, vis=1.00, fog=0),
    dict(name='弱光带', top=200,   bot=1000,  tint=0x1d6b7a, vis=0.92, fog=640),
    dict(name='午夜带', top=1000,  bot=4000,  tint=0x352f6b, vis=0.68, fog=480),
    dict(name='热泉带', top=4000,  bot=6000,  tint=0x7a3a16, vis=0.60, fog=380),
    dict(name='深渊带', top=6000,  bot=11000, tint=0x1a1740, vis=0.46, fog=300),
]
BLEND_FROM = 0.70          # <-- DiveGame.ts 同名常量

# ---- 与 DiveGame.ts FLASH_* 同值 ----
FLASH = {
    '开火 (muzzle)': dict(r0=20,  r1=38,  dur=0.12, col=0xdff2ff, a=0.26),
    '爆炸 (blast)':  dict(r0=56,  r1=158, dur=0.28, col=0xffe6bc, a=0.30),
    '拾取 (pickup)': dict(r0=140, r1=248, dur=0.20, col=0x6fe8ff, a=0.13),
}

_F = {}


def F(size):
    if size not in _F:
        try:
            _F[size] = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)
        except Exception:
            _F[size] = ImageFont.load_default()
    return _F[size]


def rgb(h):
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


def mix(a, b, t):
    ar, ag, ab = rgb(a)
    br, bg, bb = rgb(b)
    return (round(ar + (br - ar) * t), round(ag + (bg - ag) * t), round(ab + (bb - ab) * t))


def layer_idx(depth):
    for i, L in enumerate(LAYERS):
        if depth < L['bot'] or i == len(LAYERS) - 1:
            return i
    return len(LAYERS) - 1


def blend(depth):
    """复刻 DiveGame.layerBlend()。"""
    i = layer_idx(depth)
    L = LAYERS[i]
    nxt = LAYERS[i + 1] if i + 1 < len(LAYERS) else None
    if nxt is None:
        return rgb(L['tint']), L['vis'], L['fog']
    span = max(1, nxt['top'] - L['top'])
    r = (depth - L['top']) / span
    r = 0.0 if r < 0 else (1.0 if r > 1 else r)
    t = (r - BLEND_FROM) / (1 - BLEND_FROM)
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    t = t * t * (3 - 2 * t)                       # smoothstep
    fog = 0 if L['fog'] <= 0 else round(L['fog'] + (nxt['fog'] - L['fog']) * t)
    return mix(L['tint'], nxt['tint'], t), L['vis'] + (nxt['vis'] - L['vis']) * t, fog


# ---------------------------------------------------------------- ① 连续性
def draw_blend():
    W, H = 1180, 600
    img = Image.new('RGB', (W, H), (10, 18, 26))
    d = ImageDraw.Draw(img)
    x0, x1 = 74, W - 30
    span = 11000
    bar_h = 52

    def xpos(depth):
        return x0 + (x1 - x0) * depth / span

    y_old, y_new = 74, 176
    # 段边界竖线（贯穿两条色带）
    for L in LAYERS[1:]:
        xx = xpos(L['top'])
        d.line([(xx, y_old), (xx, y_new + bar_h)], fill=(50, 76, 90), width=1)

    d.text((2, y_old - 22), '旧', fill=(255, 130, 130), font=F(15))
    d.text((2, y_old + 14), '阶梯', fill=(255, 130, 130), font=F(12))
    d.text((x0, y_old - 22), 'drawVeil / drawFog 取 w.layer() 的常量 ⇒ 换带那一帧"啪"地跳色',
           fill=(255, 130, 130), font=F(13))
    for px in range(x0, x1):
        i = layer_idx((px - x0) / (x1 - x0) * span)
        d.line([(px, y_old), (px, y_old + bar_h)], fill=rgb(LAYERS[i]['tint']))

    d.text((2, y_new - 22), '新', fill=(120, 230, 255), font=F(15))
    d.text((2, y_new + 14), '连续', fill=(120, 230, 255), font=F(12))
    d.text((x0, y_new - 22), 'layerBlend() 按 depthM 插值；本带前 70% 保持本色、后 30% 才过渡',
           fill=(120, 230, 255), font=F(13))
    for px in range(x0, x1):
        c, _, _ = blend((px - x0) / (x1 - x0) * span)
        d.line([(px, y_new), (px, y_new + bar_h)], fill=c)

    # 带名：贴着下排色带**下沿**，每段中心（L1 太窄就外移）
    ly = y_new + bar_h + 6
    for i, L in enumerate(LAYERS):
        cx = (xpos(L['top']) + xpos(L['bot'])) / 2
        tx = max(x0, min(cx - 22, x1 - 50))
        # L1 只有 20px 宽，标签必与 L2 重叠 ⇒ 单独下移一行
        d.text((tx, ly + (17 if i == 0 else 0)), L['name'], fill=(160, 200, 215), font=F(13))
    d.text((x0, ly + 36), '↑ 刻度按**真实米数**（L1 只占 1.8%，标签挤到要错行 —— 这正是深度计要等分五段的原因）',
           fill=(130, 160, 175), font=F(12))

    # vis / 雾半径折线
    y_v, h_v = 300, 150
    d.rectangle([x0, y_v, x1, y_v + h_v], outline=(46, 70, 84))
    for L in LAYERS[1:]:
        xx = xpos(L['top'])
        d.line([(xx, y_v), (xx, y_v + h_v)], fill=(38, 56, 68), width=1)
    pts_v, pts_f = [], []
    for px in range(x0, x1):
        _, v, f = blend((px - x0) / (x1 - x0) * span)
        pts_v.append((px, y_v + h_v * (1 - v)))
        pts_f.append((px, y_v + h_v * (1 - f / 640)))
    d.line(pts_f, fill=(255, 209, 102), width=2)
    d.line(pts_v, fill=(120, 230, 255), width=2)
    # 图例放右上（避开曲线本身）
    d.text((x1 - 250, y_v + 8), '能见度 vis（青）', fill=(120, 230, 255), font=F(13))
    d.text((x1 - 250, y_v + 26), '雾半径（琥珀 ÷ 640）', fill=(255, 209, 102), font=F(13))
    d.text((x0 + 8, y_v + h_v + 8),
           'vis / 雾半径同样"前 70% 平、后 30% 过渡"；雾在 L1 恒为 0（阳光带刻意无雾，不参与插值）',
           fill=(150, 175, 190), font=F(12))

    d.text((6, H - 26), 'V6.60 §9-9 depthM 连续化 —— 颜色 / 能见度 / 雾不再取带的常量，而按深度插值',
           fill=(130, 165, 180), font=F(14))
    p = os.path.join(OUT_DIR, 'blend_curve.png')
    img.save(p)
    return p


# ---------------------------------------------------------------- ② 光反馈
def draw_flash():
    W = 1180
    # 三行**各自缩放**：拾取的范围（R248）是开火（R38）的 6.5 倍，同一比例下
    #   要么开火看不见、要么拾取撑爆画布。缩放系数标在行首，读数不受影响。
    rows = [('开火 (muzzle)', 1.00), ('爆炸 (blast)', 1.00), ('拾取 (pickup)', 0.50)]
    steps = 7
    y = 54
    layout = []
    for label, sc in rows:
        fp = FLASH[label]
        rh = fp['r1'] * sc * 2 + 52
        layout.append((label, sc, fp, y, rh))
        y += rh
    H = int(y + 44)
    img = Image.new('RGB', (W, H), (12, 34, 46))     # 用"弱光带"水色当底，
    d = ImageDraw.Draw(img)                          # 反光的可读性接近实机
    d.text((14, 14), 'V6.60 §9-7 交互光反馈 —— 半径扩散 + alpha 衰减（e²，先快后慢）',
           fill=(190, 225, 240), font=F(15))

    x0 = 200
    for label, sc, fp, ry, rh in layout:
        cy = ry + rh / 2
        d.text((14, cy - 20), label, fill=(190, 225, 240), font=F(14))
        if sc != 1:
            d.text((14, cy + 2), f'（缩放 {sc:.2f}×）', fill=(150, 185, 200), font=F(11))
        for s in range(steps):
            t = s / (steps - 1) * 1.15
            cx = x0 + s * ((W - x0 - 50) / steps)
            if t >= 1:
                d.text((cx - 14, cy + 12), '已结束', fill=(120, 145, 160), font=F(11))
                continue
            e = 1 - t
            a = fp['a'] * e * e
            rad = (fp['r0'] + (fp['r1'] - fp['r0']) * t) * sc
            # 3 层同心、同 alpha 累叠（与 drawFlashes 一致）
            for k in range(3):
                rr = rad * (0.45 + 0.275 * k)
                if rr < 1:
                    continue
                ov = Image.new('RGBA', (int(rr * 2) + 1, int(rr * 2) + 1), (0, 0, 0, 0))
                ImageDraw.Draw(ov).ellipse([0, 0, rr * 2, rr * 2],
                                           fill=rgb(fp['col']) + (int(a * 255),))
                bx0, by0 = int(cx - rr), int(cy - rr)
                base = img.crop((bx0, by0, bx0 + ov.width, by0 + ov.height)).convert('RGBA')
                img.paste(Image.alpha_composite(base, ov).convert('RGB'), (bx0, by0))
            d.ellipse([cx - 1.5, cy - 1.5, cx + 1.5, cy + 1.5], fill=(255, 255, 255))
            ms = t * fp['dur'] * 1000
            d.text((cx - 26, cy + rad + 4), f'{ms:.0f}ms\nR={rad / sc:.0f}',
                   fill=(150, 185, 200), font=F(11))

    d.text((14, H - 26),
           '3 层同心同 alpha 累叠 ⇒ 中心最亮、边缘柔（与 drawLamp 同规；异 alpha 会显出硬环）',
           fill=(140, 175, 190), font=F(13))
    p = os.path.join(OUT_DIR, 'flash_timeline.png')
    img.save(p)
    return p


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only_blend = '--blend' in sys.argv
    only_flash = '--flash' in sys.argv
    if not only_flash:
        print('已出图:', draw_blend())
    if not only_blend:
        print('已出图:', draw_flash())


if __name__ == '__main__':
    main()
