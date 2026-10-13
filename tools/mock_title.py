#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
主界面「效果图合成」—— 在改代码之前，先把新版观感做出来给用户确认。

为什么要有这个脚本（而不是直接改 Title.ts）：
  规格没确认就改视图层 = 改错方向要回滚两次（一次代码、一次资源）。
  本脚本按 `Title.ts` 里**逐字相同**的坐标画一张 1304×749 的图，
  只替换两样东西：① 背景从矢量渐变换成位图 ② 槽位底从近黑换成深青玻璃。
  图能过，再照着改代码。

用法：
    python tools/mock_title.py [背景图] [输出png]
默认背景 = docs/ui_concept 下最新的「主界面背景图_*.png」
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'ui_concept', '效果图_主界面_v2.png')
CUT = os.path.join(ROOT, 'docs', 'ui_concept', 'icons_cut_v3')
SUB = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'sub', 'sub_body.png')

# ---- 设计坐标（逐字抄自 Title.ts / menu.ts，改了必须两边一起改） ----
W, H = 1304, 749
BAR_H, BAR_PAD, AVATAR = 72, 32, 40
TOP_BTN_HIT, TOP_BTN_GAP, TOP_BTN_Y = 48, 8, 12
HERO_BOX, HERO_DISC = 184, 168
CENTER_Y = 392
ARROW_HIT, ARROW_OFF = 64, 190
DOT_PITCH = 14
CTA_W, CTA_H, CTA_Y = 340, 68, 612

# ---- 色板（与 shared/theme.ts 对齐） ----
UI_CYAN = (0x4F, 0xE8, 0xFF)
UI_CYAN_HI = (0xC8, 0xF8, 0xFF)
CYAN_DIM = (0x1F, 0x6A, 0x7D)
TXT_MAIN = (0xDC, 0xEE, 0xF5)
TXT_DIM = (0x7F, 0x9B, 0xAB)
TXT_MUTE = (0x4D, 0x6B, 0x7C)
TXT_CYBER = (0xC8, 0xF8, 0xFF)
AMBER = (0xFF, 0xD1, 0x66)
ROCK = (0x16, 0x28, 0x3C)

# ---- 新版「深青玻璃槽」色板（= shared/theme.ts 的 GLASS，改一处必须同步） ----
GLASS_BASE = (12, 32, 42)         # GLASS.base  0x0c202a
GLASS_BASE_A = 209                # GLASS.baseAlpha 0.82
GLASS_HI = (86, 186, 208)         # GLASS.hi    0x56bad0
GLASS_EDGE = (79, 232, 255)       # GLASS.edge  0x4fe8ff
GLASS_EDGE_A = 89                 # GLASS.edgeAlpha 0.35
GLASS_HOVER = (18, 48, 60)        # GLASS.hover 0x12303c
GLASS_PRESS = (8, 22, 28)         # GLASS.press 0x08161c
GLASS_LOCK = (22, 28, 32)         # GLASS.lock  0x161c20
GLASS_BAR = (8, 17, 25)           # GLASS.bar   0x081119
ICON_TINT_NORMAL = (0x4F, 0xB9, 0xD4)
ICON_TINT_LOCK = (0x8A, 0x99, 0xA3)

FONT = 'C:/Windows/Fonts/msyh.ttc'
FONT_B = 'C:/Windows/Fonts/msyhbd.ttc'

# ---- 左/右栏几何（抄 columnBlocks） ----
def column_blocks(n):
    size = 96 if n <= 2 else (88 if n == 3 else 80)
    pitch = 184 if n <= 2 else (164 if n == 3 else 140)
    height = (n - 1) * pitch + size + 16 + 20
    y0 = CENTER_Y - height / 2
    tops = [y0 + i * pitch for i in range(n)]
    labels = [t + size + 16 + 10 for t in tops]
    return size, tops, labels


def font(sz, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, sz)


def fit_contain(im, box):
    w, h = im.size
    s = min(box / w, box / h)
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def tint(im, color):
    if color is None:
        return im
    r, g, b, a = im.split()
    r = r.point(lambda v: v * color[0] // 255)
    g = g.point(lambda v: v * color[1] // 255)
    b = b.point(lambda v: v * color[2] // 255)
    return Image.merge('RGBA', (r, g, b, a))


def cover(im, w, h):
    """按 cover 缩放铺满（保持比例，裁掉溢出）。"""
    iw, ih = im.size
    s = max(w / iw, h / ih)
    nw, nh = round(iw * s), round(ih * s)
    im = im.resize((nw, nh), Image.LANCZOS)
    return im.crop(((nw - w) // 2, (nh - h) // 2, (nw - w) // 2 + w, (nh - h) // 2 + h))


def glass_slot(canvas, x, y, s, state, r=12):
    """画一个「深青玻璃槽」。state: normal / hover / press / lock"""
    x, y, s = int(x), int(y), int(s)
    ov = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    if state == 'lock':
        base, alpha, edge, ea = GLASS_LOCK, 219, (0x39, 0x45, 0x5A), 115
    elif state == 'hover':
        base, alpha, edge, ea = GLASS_HOVER, 230, UI_CYAN, 255
    elif state == 'press':
        base, alpha, edge, ea = GLASS_PRESS, 230, UI_CYAN_HI, 255
    else:
        base, alpha, edge, ea = GLASS_BASE, GLASS_BASE_A, GLASS_EDGE, GLASS_EDGE_A

    # hover 外发光（多层描边，不用加法混合）
    if state == 'hover':
        d.rounded_rectangle([x - 6, y - 6, x + s + 6, y + s + 6], r + 3, outline=UI_CYAN + (30,), width=3)
        d.rounded_rectangle([x - 3, y - 3, x + s + 3, y + s + 3], r + 2, outline=UI_CYAN + (72,), width=2)
    d.rounded_rectangle([x, y, x + s, y + s], r, fill=base + (alpha,), outline=edge + (ea,), width=2)
    # 顶部高光带：上 38% 一条竖向渐隐的青（先画在整槽大小的层上，再用圆角遮罩裁 alpha）
    hi = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    bh = max(1, int(s * 0.38))
    bw = s - 6
    for i in range(bh):
        a = int(46 * (1 - i / bh))
        hd.line([(3, 3 + i), (3 + bw, 3 + i)], fill=GLASS_HI + (a,))
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], r, fill=255)
    hi.putalpha(Image.composite(hi.split()[3], Image.new('L', (s, s), 0), m))
    ov.alpha_composite(hi, (x, y))
    # 内侧细描边（玻璃厚度）
    d.rounded_rectangle([x + 3, y + 3, x + s - 3, y + s - 3], r - 2, outline=(255, 255, 255, 16), width=1)
    canvas.alpha_composite(ov)


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith('--')]
    bg_path = argv[0] if argv else None
    out = argv[1] if len(argv) > 1 else OUT
    if not bg_path:
        cands = sorted(glob.glob(os.path.join(ROOT, 'docs', 'ui_concept', '游戏主界面背景图_*.png')))
        if not cands:
            print('找不到背景图', file=sys.stderr)
            return 2
        bg_path = cands[-1]
    print('背景：', os.path.basename(bg_path))

    canvas = cover(Image.open(bg_path).convert('RGB'), W, H).convert('RGBA')
    d = ImageDraw.Draw(canvas)

    # ================= 顶栏 =================
    top = Image.new('RGBA', (W, BAR_H), GLASS_BAR + (235,))
    canvas.alpha_composite(top, (0, 0))
    d.line([(0, BAR_H), (W, BAR_H)], fill=GLASS_EDGE + (72,), width=1)
    # 头像框
    d.rounded_rectangle([BAR_PAD, 16, BAR_PAD + AVATAR, 16 + AVATAR], 10,
                        fill=GLASS_BASE + (230,), outline=GLASS_EDGE + (GLASS_EDGE_A,), width=1)
    d.ellipse([BAR_PAD + 14, 24, BAR_PAD + 26, 36], fill=CYAN_DIM)
    d.ellipse([BAR_PAD + 9, 42, BAR_PAD + 31, 58], fill=(0x1F, 0x6A, 0x7D, 140))
    d.text((BAR_PAD + AVATAR + 12, 36), '潜航员 · 首次下潜', font=font(16), fill=TXT_DIM, anchor='lm')
    # 货币
    d.polygon([(592, 26), (602, 36), (592, 46), (582, 36)], fill=AMBER)
    d.text((684, 36), '1,240', font=font(24, True), fill=(0x7F, 0xEF, 0xFF), anchor='rm')
    d.text((702, 36), '沉淀', font=font(14), fill=TXT_MUTE, anchor='lm')

    # ================= 左右图标栏 =================
    ICONS = {
        'codex': '图鉴', 'milestone': '里程碑', 'dock': '装置坞',
        'region': '海域', 'settings': '设置', 'help': '帮助',
    }
    left = [('codex', 'unlocked'), ('milestone', 'unlocked'), (None, 'soon')]
    right = [('dock', 'unlocked'), ('region', 'lock')]
    size_l, tops_l, labs_l = column_blocks(len(left))
    size_r, tops_r, labs_r = column_blocks(len(right))
    x_l = BAR_PAD
    x_r = W - BAR_PAD - size_r

    def draw_column(col, x, size, tops, labs):
        for i, ((iid, st), top_, lab_y) in enumerate(zip(col, tops, labs)):
            state = {'unlocked': 'normal', 'lock': 'lock', 'soon': 'lock'}[st]
            glass_slot(canvas, x, top_, size, state)
            if iid:
                icon = Image.open(os.path.join(CUT, ICONS[iid] + '.png')).convert('RGBA')
                icon = fit_contain(icon, int(size * 1.0))
                icon = tint(icon, ICON_TINT_NORMAL if st == 'unlocked' else ICON_TINT_LOCK)
                canvas.alpha_composite(icon, (x + (size - icon.width) // 2, int(top_ + (size - icon.height) // 2)))
                label = ICONS[iid]
            else:
                # 空槽位：画内框占位
                m = int(size * 0.30)
                d.rounded_rectangle([x + m, top_ + m, x + size - m, top_ + size - m], 6,
                                    outline=(0x39, 0x45, 0x5A, 115), width=1)
                label = '任务'
            col_txt = TXT_MUTE if st != 'unlocked' else TXT_DIM
            d.text((x + size / 2, lab_y), label, font=font(16), fill=col_txt, anchor='mm')
            if st == 'lock':
                # 锁角标
                lx, ly = x + size - 20, top_ + 8
                d.arc([lx + 2, ly + 1, lx + 10, ly + 9], 180, 360, fill=AMBER, width=2)
                d.rounded_rectangle([lx, ly + 4, lx + 12, ly + 12], 2, fill=AMBER)

    draw_column(left, x_l, size_l, tops_l, labs_l)
    draw_column(right, x_r, size_r, tops_r, labs_r)

    # ================= 顶栏工具按钮（设置 / 帮助） =================
    for i, iid in enumerate(['settings', 'help']):
        x = W - BAR_PAD - TOP_BTN_HIT - i * (TOP_BTN_HIT + TOP_BTN_GAP)
        icon = Image.open(os.path.join(CUT, ICONS[iid] + '.png')).convert('RGBA')
        icon = fit_contain(icon, TOP_BTN_HIT)
        icon = tint(icon, ICON_TINT_NORMAL)
        canvas.alpha_composite(icon, (x + (TOP_BTN_HIT - icon.width) // 2,
                                      TOP_BTN_Y + (TOP_BTN_HIT - icon.height) // 2))

    # ================= 中央区 =================
    bx = W / 2 - HERO_BOX / 2
    by = CENTER_Y - HERO_BOX / 2
    # 大立绘框：换成深青玻璃（与槽位同语汇）
    glass_slot(canvas, int(bx), int(by), HERO_BOX, 'hover', r=16)
    # 台面椭圆
    d.ellipse([W / 2 - HERO_BOX * 0.30, by + HERO_BOX - 40, W / 2 + HERO_BOX * 0.30, by + HERO_BOX - 16],
              fill=(0x1A, 0x21, 0x2C, 150))
    # 立绘
    hero = Image.open(SUB).convert('RGBA')
    hero = fit_contain(hero, HERO_DISC)
    canvas.alpha_composite(hero, (int(W / 2 - hero.width / 2), int(CENTER_Y - hero.height / 2)))

    # 标题
    d.text((W / 2, 150), '深 海 回 响', font=font(64, True), fill=TXT_CYBER, anchor='mm',
           stroke_width=4, stroke_fill=(0x04, 0x08, 0x10))
    d.text((W / 2, 202), 'DEEP SEA ECHO', font=font(16), fill=(0x7F, 0xEF, 0xFF), anchor='mm')
    d.text((W / 2, 228), '在深渊里，光就是命', font=font(15), fill=TXT_DIM, anchor='mm')

    # 箭头
    for dirn, ax in [(-1, W / 2 - ARROW_OFF), (1, W / 2 + ARROW_OFF)]:
        w = 12 * dirn
        d.line([(ax + w, CENTER_Y - 18), (ax - w, CENTER_Y), (ax + w, CENTER_Y + 18)],
               fill=UI_CYAN, width=3, joint='curve')

    # 指示点
    n = 3
    x0 = W / 2 - (n - 1) * DOT_PITCH / 2
    for i in range(n):
        r = 4 if i == 0 else 3
        c = UI_CYAN if i == 0 else (0x39, 0x45, 0x5A)
        d.ellipse([x0 + i * DOT_PITCH - r, 508 - r, x0 + i * DOT_PITCH + r, 508 + r], fill=c)

    # 名称 + 特性
    d.text((W / 2, 534), '深潜者', font=font(20, True), fill=TXT_CYBER, anchor='mm')
    d.text((W / 2, 566), '均衡型 · 氧气上限 +20 · 移速 +5% · 装备槽 4', font=font(14), fill=TXT_MAIN, anchor='mm')

    # 主按钮
    hw, hh = CTA_W / 2, CTA_H / 2
    d.rounded_rectangle([W / 2 - hw, CTA_Y - hh, W / 2 + hw, CTA_Y + hh], 11,
                        fill=(0x08, 0x11, 0x1C, 240), outline=UI_CYAN, width=2)
    d.line([(W / 2 - hw + 10, CTA_Y - hh + 5), (W / 2 - hw + 10 + CTA_W * 0.28, CTA_Y - hh + 5)],
           fill=UI_CYAN_HI + (128,), width=2)
    d.text((W / 2, CTA_Y), '开 始 下 潜', font=font(28, True), fill=TXT_CYBER, anchor='mm',
           stroke_width=3, stroke_fill=(0x04, 0x08, 0x10))

    # 底栏
    d.text((BAR_PAD, 664), 'Enter 开始下潜 · 1/2/3 或 ←→ 换潜航器', font=font(14), fill=TXT_MUTE, anchor='lm')
    d.text((W - BAR_PAD, 664), 'v6.40 · 1304×749', font=font(14), fill=TXT_MUTE, anchor='rm')

    canvas.convert('RGB').save(out, quality=95)
    print('已输出：', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
