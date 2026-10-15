#!/usr/bin/env python3
"""
V6.82 第一批新生物的**占位剪影**生成器。

为什么要"占位剪影"而不是等真图（与 V6.79 的 `orbit.png` 同一条口径）：
**链路先通，美术后补**。一条新生物的落地要牵动 7 处（types / tables / world /
theme / 图 / 图鉴对账 / 冒烟），其中 6 处是"错一位就静默失效"的。先把这 6 处跑通并
被闸门锁住，再让插画岗拿这张剪影当**形状规格**去出真图 —— 反过来做的话，
"图好了但代码接不上"是最常见的返工。

★ 形状语汇见 `shared/dive/world.ts` 文件头那张表（给插画岗的交接单）。
★ 全部**头朝左**（与现有 5 张鱼图同规，`TEX_BASE_ROT` 的基准值是 π）。

用法：
  python tools/gen_fish_placeholder.py            # 写出 6 张到 web/src/assets/fish/
  python tools/gen_fish_placeholder.py --sheet    # 另出一张对照大图到 docs/shots/
"""

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'web', 'src', 'assets', 'fish')
SHOTS = os.path.join(ROOT, 'docs', 'shots')

# 与 shared/theme.ts 的 PALETTE 一致（这里是**出图侧**，改色只改这两处 + world.ts 的 ENEMY_BASE）
JADE = (0x7f, 0xff, 0xd4)
JADE_HI = (0xc4, 0xff, 0xf0)
STEEL = (0x9a, 0xa7, 0xb8)
LIME = (0xa8, 0xd9, 0x4f)
MAGENTA = (0xff, 0x4f, 0xd8)
DANGER = (0xff, 0x2e, 0x63)
INK = (0x08, 0x11, 0x1c)      # panel 色：体内暗部

SS = 4                         # 超采样倍率
W = 512                        # 画布宽（与现有鱼图一致）
BODY_A = 150                   # 体色 alpha（0-255）
CORE_A = 235                   # 发光核 alpha


def _mix(c, k, toward=INK):
    """把颜色朝暗部混 `k` 比例（k=0 原色，k=1 全暗）"""
    return tuple(int(c[i] * (1 - k) + toward[i] * k) for i in range(3))


def _canvas(h):
    return Image.new('RGBA', (W * SS, h * SS), (0, 0, 0, 0))


def _save(im, h, name):
    im = im.resize((W, h), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name + '.png')
    im.save(p)
    return p


def _blob(dr, box, fill, outline, width, k=0.0):
    """一个圆角体：填充 + 描边。`box` 是像素坐标"""
    dr.ellipse(box, fill=fill + (BODY_A,), outline=outline + (255,), width=width)


def _spindle(dr, cx, cy, L, Hh, fill, outline, width):
    """纺锤形（左右两个尖的菱形近似）—— 头朝左"""
    pts = [(cx - L / 2, cy),
           (cx - L * 0.12, cy - Hh),
           (cx + L * 0.34, cy - Hh * 0.78),
           (cx + L / 2, cy),
           (cx + L * 0.34, cy + Hh * 0.78),
           (cx - L * 0.12, cy + Hh)]
    dr.polygon(pts, fill=fill + (BODY_A,))
    dr.line(pts + [pts[0]], fill=outline + (255,), width=width, joint='curve')


# ---------------------------------------------------------------------------
# 六种形状
# ---------------------------------------------------------------------------
def draw_splitter(im=None):
    """裂体：纺锤 + **中段一道裂口**（"它要裂开"是这个形状唯一要说的信息）"""
    h = 330
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 360 * SS, 105 * SS
    _spindle(dr, cx, cy, L, Hh, _mix(JADE, 0.55), JADE, 7 * SS)
    # 裂口：中段一道向内的暗缝（不切断轮廓 —— 断了会读作"两条鱼"）
    for dy in (-1, 1):
        dr.line([(cx + 10 * SS, cy - Hh * 0.62), (cx + 26 * SS, cy), (cx + 10 * SS, cy + Hh * 0.62)],
                fill=INK + (220,), width=9 * SS, joint='curve')
    _eye(dr, cx - L * 0.30, cy - 8 * SS, JADE, 13 * SS)
    return _save(im, h, 'splitter')


def draw_shard(im=None):
    """幼体：小纺锤，**无裂口、无眼** —— "它只是个碎片" """
    h = 210
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 200 * SS, 62 * SS
    _spindle(dr, cx, cy, L, Hh, _mix(JADE_HI, 0.5), JADE_HI, 6 * SS)
    # 只有一颗亮点（不是眼）：它是"刚裂出来的碎片还在发光"
    r = 16 * SS
    dr.ellipse([cx - L * 0.10 - r, cy - r, cx - L * 0.10 + r, cy + r], fill=JADE_HI + (CORE_A,))
    return _save(im, h, 'shard')


def draw_bulwark(im=None):
    """盾鳐：宽扁 + **前缘一块厚甲**（"正面硬"）"""
    h = 300
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 400 * SS, 96 * SS
    # 扁平体：上下各一条长弧（比 spindle 更"压扁"）
    pts = [(cx - L / 2, cy - 6 * SS), (cx - L * 0.14, cy - Hh),
           (cx + L * 0.40, cy - Hh * 0.66), (cx + L / 2, cy),
           (cx + L * 0.40, cy + Hh * 0.66), (cx - L * 0.14, cy + Hh),
           (cx - L / 2, cy + 6 * SS)]
    dr.polygon(pts, fill=_mix(STEEL, 0.58) + (BODY_A,))
    dr.line(pts + [pts[0]], fill=STEEL + (255,), width=7 * SS, joint='curve')
    # 前缘厚甲：左侧一块加厚的竖板（**双线** ⇒ 读作"这是一块板"而不是"这条线粗")
    x0, x1 = cx - L / 2 + 14 * SS, cx - L / 2 + 52 * SS
    dr.rounded_rectangle([x0, cy - Hh * 0.94, x1, cy + Hh * 0.94],
                         radius=14 * SS, fill=_mix(STEEL, 0.30) + (235,), outline=STEEL + (255,), width=6 * SS)
    _eye(dr, cx - L * 0.28, cy - 8 * SS, STEEL, 12 * SS)
    # 尾鳍
    dr.polygon([(cx + L / 2 - 6 * SS, cy), (cx + L / 2 + 40 * SS, cy - 46 * SS), (cx + L / 2 + 40 * SS, cy + 46 * SS)],
               fill=_mix(STEEL, 0.5) + (200,), outline=STEEL + (255,))
    return _save(im, h, 'bulwark')


def draw_brood(im=None):
    """孵卵囊：圆鼓 + 表面一排卵孔（"会生"）"""
    h = 340
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    Rx, Ry = 150 * SS, 138 * SS
    _blob(dr, [cx - Rx, cy - Ry, cx + Rx, cy + Ry], _mix(LIME, 0.55), LIME, 7 * SS)
    # 卵孔：三列小圆（暗孔 + 亮环 ⇒ 读作"里面还有东西"）
    for i, dx in enumerate((-62, 0, 62)):
        for j, dy in enumerate((-52, 14)):
            ox, oy = cx + dx * SS, cy + dy * SS
            r = 24 * SS
            dr.ellipse([ox - r, oy - r, ox + r, oy + r], fill=INK + (230,), outline=LIME + (255,), width=5 * SS)
            r2 = 10 * SS
            dr.ellipse([ox - r2, oy - r2, ox + r2, oy + r2], fill=_mix(LIME, 0.2) + (210,))
    # 顶部一撮短触手（让它不像"一块石头"）
    for k in (-46, -14, 18, 50):
        dr.line([(cx + k * SS, cy - Ry * 0.94), (cx + k * SS * 1.35, cy - Ry * 1.5)],
                fill=LIME + (230,), width=8 * SS)
    return _save(im, h, 'brood')


def draw_kamikaze(im=None):
    """自爆螺：短粗圆壳 + **背部一道红缝**（"要炸"）"""
    h = 280
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    Rx, Ry = 176 * SS, 106 * SS
    _blob(dr, [cx - Rx, cy - Ry, cx + Rx, cy + Ry], _mix(MAGENTA, 0.58), MAGENTA, 7 * SS)
    # 螺旋壳纹（两段弧 ⇒ 读作"螺"）
    for k, rr in ((0.72, 62), (0.46, 34)):
        dr.arc([cx - Rx * k, cy - Ry * k, cx + Rx * k, cy + Ry * k], 120, 420,
               fill=_mix(MAGENTA, 0.25) + (220,), width=6 * SS)
    # ★ 背部红缝：**唯一一处 `danger`** —— 与"敌方预警 / 低氧 / 受击"同一支红，
    #   玩家不用学新符号就知道"这里要出事"。
    dr.line([(cx - 26 * SS, cy - Ry - 4 * SS), (cx + 6 * SS, cy - Ry - 16 * SS), (cx + 40 * SS, cy - Ry + 2 * SS)],
            fill=DANGER + (255,), width=11 * SS, joint='curve')
    _eye(dr, cx - Rx * 0.62, cy - 6 * SS, MAGENTA, 13 * SS)
    return _save(im, h, 'kamikaze')


def draw_herder(im=None):
    """牧群者：细长 + **两侧一排须**（"在指挥"）"""
    h = 250
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 430 * SS, 46 * SS
    _spindle(dr, cx, cy, L, Hh, _mix(JADE, 0.62), JADE, 7 * SS)
    # 两侧的须：上下各 5 根短须，**朝后的角度**（像在划水/发信号）
    for i in range(5):
        bx = cx - L * 0.30 + i * L * 0.17
        for s in (-1, 1):
            dr.line([(bx, cy + s * Hh * 0.86), (bx - 22 * SS, cy + s * (Hh + 46 * SS))],
                    fill=JADE + (225,), width=7 * SS)
    # 背鳍（把它和"游群"拉开：游群没有立起来的鳍）
    dr.polygon([(cx - 20 * SS, cy - Hh * 0.9), (cx + 30 * SS, cy - Hh * 0.9), (cx + 60 * SS, cy - Hh * 2.2)],
               fill=_mix(JADE, 0.4) + (225,), outline=JADE + (255,), width=5 * SS)
    _eye(dr, cx - L * 0.34, cy - 6 * SS, JADE, 12 * SS)
    # 发光核（"它是个中枢"）
    r = 20 * SS
    dr.ellipse([cx - r + 8 * SS, cy - r - 40 * SS, cx + r + 8 * SS, cy + r - 40 * SS], fill=JADE + (200,))
    return _save(im, h, 'herder')


def _eye(dr, x, y, color, r):
    dr.ellipse([x - r, y - r, x + r, y + r], fill=INK + (240,), outline=color + (255,), width=4 * SS)
    r2 = r * 0.45
    dr.ellipse([x - r2, y - r2, x + r2, y + r2], fill=(0xff, 0xff, 0xff, 235))


DRAWERS = [
    ('splitter', draw_splitter),
    ('shard', draw_shard),
    ('bulwark', draw_bulwark),
    ('brood', draw_brood),
    ('kamikaze', draw_kamikaze),
    ('herder', draw_herder),
]


def main():
    for name, fn in DRAWERS:
        p = fn()
        print(f'  ✓ {name:9s} → {os.path.relpath(p, ROOT)}  ({Image.open(p).size})')
    if '--sheet' in sys.argv:
        names = [n for n, _ in DRAWERS]
        ims = [Image.open(os.path.join(OUT, n + '.png')) for n in names]
        sc = 0.62
        pad = 12
        Wt = int(max(i.width for i in ims) * sc) + pad * 2
        Ht = int(sum(i.height for i in ims) * sc) + pad * (len(ims) + 1)
        sheet = Image.new('RGBA', (Wt, Ht), (0x04, 0x07, 0x0d, 255))
        y = pad
        for i in ims:
            t = i.resize((int(i.width * sc), int(i.height * sc)), Image.LANCZOS)
            sheet.alpha_composite(t, (pad, y))
            y += t.height + pad
        os.makedirs(SHOTS, exist_ok=True)
        out = os.path.join(SHOTS, 'v682_fish_placeholder.png')
        sheet.save(out)
        print(f'  ✓ 对照大图 → {os.path.relpath(out, ROOT)}  ({sheet.size})')


if __name__ == '__main__':
    main()
