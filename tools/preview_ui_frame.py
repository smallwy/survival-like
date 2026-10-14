#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
框架元件预览：**九宫格拉伸验证** + 实景合成。

为什么必须画出来（同 `preview_v662.py` 的理由）：
  "圆角半径对不对"在 PNG 上看得出来，"**拉伸后圆角还对不对**"只能在拉伸结果上看。
  九宫格最容易出的错不是"图丑"，是**角块算小了 -> 拉伸后四角起毛刺 / 圆角被压扁**。
  这个错在源图上一像素都看不出来。

三张图：
  ① `frame_sheet.png`   —— 三类元件的**实际尺寸**对照（含四态 + 九宫格拉伸）
  ② `frame_slice.png`   —— 九宫格切割示意（切线画在源图上 + 角块放大镜）
  ③ `frame_onbg.png`    —— 实景合成（贴到 `title_bg.png` 上，看玻璃到底"透不透"）

⚠️ 字体：`C:/Windows/Fonts/msyh.ttc` **缺 `·` `⇒` `⚠` 字形**，会渲染成方框。
   本文件一律只用 ASCII 与中文，不用这三个字符。

用法：python tools/preview_ui_frame.py
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FRAME = ROOT / 'cocos' / 'assets' / 'resources' / 'ui' / 'frame'
ICONS = ROOT / 'cocos' / 'assets' / 'resources' / 'ui' / 'icons'
BG = ROOT / 'cocos' / 'assets' / 'resources' / 'ui' / 'title_bg.png'
OUT = ROOT / 'docs' / 'shots'

W, H = 1304, 749
SCALE = 2                      # 位图是设计尺寸的 2 倍

# 与 make_ui_frame.py 同源（**源图像素**）
INSET = {'btn': 32, 'panel': 48}
# 设计尺寸 / 圆角 —— 逐字对齐 Title.ts 实装（V6.41 起）
DESIGN = {'slot': (96, 96, 12), 'btn': (236, 62, 11), 'panel': (64, 64, 18)}
# 九宫格安全余量：角块(设计px) - 圆角 - 描边宽
STROKE = {'btn': 1.5, 'panel': 1.6}

CYAN_HI = (0xc8, 0xf8, 0xff)
DIM = (150, 186, 202)
PAGE = (10, 26, 36)
PINK = (255, 110, 140, 235)


def font(sz, bold=False):
    p = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    try:
        return ImageFont.truetype(p, sz)
    except Exception:
        try:
            return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', sz)
        except Exception:
            return ImageFont.load_default()


def load(name):
    return Image.open(FRAME / f'{name}.png').convert('RGBA')


# ---------------------------------------------------------------------------
# 九宫格拉伸（复刻引擎行为）
# ---------------------------------------------------------------------------
def nine_slice(img: Image.Image, inset: int, tw: int, th: int) -> Image.Image:
    """`inset` = 源图像素（四边等值）。`tw/th` = 目标像素。"""
    w, h = img.size
    l = t = r = b = inset
    cw, ch = max(1, tw - l - r), max(1, th - t - b)
    src = {
        'tl': img.crop((0, 0, l, t)), 'tm': img.crop((l, 0, w - r, t)), 'tr': img.crop((w - r, 0, w, t)),
        'ml': img.crop((0, t, l, h - b)), 'mm': img.crop((l, t, w - r, h - b)), 'mr': img.crop((w - r, t, w, h - b)),
        'bl': img.crop((0, h - b, l, h)), 'bm': img.crop((l, h - b, w - r, h)), 'br': img.crop((w - r, h - b, w, h)),
    }
    out = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    for k, (x, y, ww, hh) in {
        'tl': (0, 0, l, t), 'tm': (l, 0, cw, t), 'tr': (l + cw, 0, r, t),
        'ml': (0, t, l, ch), 'mm': (l, t, cw, ch), 'mr': (l + cw, t, r, ch),
        'bl': (0, t + ch, l, b), 'bm': (l, t + ch, cw, b), 'br': (l + cw, t + ch, r, b),
    }.items():
        p = src[k]
        if p.size != (ww, hh):
            p = p.resize((max(1, ww), max(1, hh)), Image.LANCZOS)
        out.alpha_composite(p, (int(x), int(y)))
    return out


def stretch(name, inset, tw_d, th_d):
    """按**设计尺寸**拉伸（内部 ×SCALE 还原成源图像素坐标系）。"""
    return nine_slice(load(name), inset, tw_d * SCALE, th_d * SCALE)


def paste(im, layer, x, y):
    """把 RGBA 图层合成到 `im` 的 (x,y)（im 可能是 RGBA 底图）。"""
    im.alpha_composite(layer, (int(x), int(y)))


# ---------------------------------------------------------------------------
# ① 元件对照表
# ---------------------------------------------------------------------------
def sheet() -> Image.Image:
    im = Image.new('RGBA', (W, 700), PAGE + (255,))
    d = ImageDraw.Draw(im)
    d.text((16, 14), '框架元件（程序化位图）V6.63   实际尺寸 / 四态 / 九宫格拉伸',
           fill=CYAN_HI, font=font(20, True))
    d.text((16, 40), '源图 = 设计尺寸 x2（retina 余量）   圆角与描边由脚本逐像素控制   色板取自 shared/theme.ts   取值对齐 Title.ts 实装',
           fill=DIM, font=font(12))

    # --- 行 1：玻璃槽位底（96 档四态 + 88 档缩放）---
    y = 78
    d.text((16, y - 20), '玻璃槽位底 slot  96x96 r12   整图不切（96 / 88 两档直接缩放）',
           fill=CYAN_HI, font=font(14, True))
    x = 24
    for st in ('off', 'hi', 'press', 'lock'):
        s = load(f'slot_{st}').resize((96, 96), Image.LANCZOS)
        paste(im, s, x, y)
        d.text((x + 48, y + 112), {'off': '常态', 'hi': '悬停', 'press': '按下', 'lock': '锁定'}[st],
               fill=DIM, font=font(12), anchor='mm')
        x += 128
    d.text((x + 8, y + 8), '96 缩到 88：', fill=DIM, font=font(12))
    s88 = load('slot_off').resize((88, 88), Image.LANCZOS)
    paste(im, s88, x + 108, y)
    d.text((x + 210, y + 34), '圆角 12 变 11，差 1px\n不单独出图', fill=DIM, font=font(12))
    d.text((x + 210, y + 78), '锁定态刻意没有高光\n（高光会误导"这个能点"）', fill=DIM, font=font(12))

    # --- 行 2：主按钮底（九宫格：236 基准 + 拉伸/压缩）---
    y += 190
    d.text((16, y - 20), '主按钮底 btn  236x62 r11（V6.41 实装值，不是文档里的 340x68）   九宫格 inset = 16 设计px',
           fill=CYAN_HI, font=font(14, True))
    x = 24
    for st in ('off', 'hi', 'press', 'dis'):
        b = stretch(f'btn_{st}', INSET['btn'], 236, 62).resize((236, 62), Image.LANCZOS)
        paste(im, b, x, y)
        d.text((x + 118, y + 74), {'off': '常态', 'hi': '悬停', 'press': '按下', 'dis': '禁用'}[st],
               fill=DIM, font=font(12), anchor='mm')
        x += 252
    y2 = y + 96
    for tw_d, lab in ((360, '拉宽到 360：角块不变，只有中段变长'), (160, '压到 160：仍 > 左右角块之和 32')):
        b = stretch('btn_off', INSET['btn'], tw_d, 62).resize((tw_d, 62), Image.LANCZOS)
        paste(im, b, 24, y2)
        d.text((24 + tw_d + 14, y2 + 31), lab, fill=DIM, font=font(12), anchor='lm')
        y2 += 78

    # --- 行 3：面板底（同一张 128x128 源图拉出两种尺寸）---
    y += 260
    d.text((16, y - 20), '面板底 panel  源图仅 128x128 r18   九宫格 inset = 24 设计px   一张源图拉出所有面板',
           fill=CYAN_HI, font=font(14, True))
    for i, (tw_d, th_d, lab) in enumerate(((560, 300, '装置坞 880x660（等比缩小演示）'), (300, 200, '小弹窗 300x200'))):
        pnl = stretch('panel_off', INSET['panel'], tw_d, th_d).resize((tw_d, th_d), Image.LANCZOS)
        px = 24 + i * 596
        paste(im, pnl, px, y)
        d.text((px + tw_d // 2, y + th_d // 2), f'{tw_d}x{th_d}', fill=(235, 250, 255, 220), font=font(18, True), anchor='mm')
        d.text((px, y + th_d + 10), lab, fill=DIM, font=font(12))
    d.text((940, y + 20), '同一个源图，四角圆角完全一致\n（这是九宫格唯一的用途）\n\n面板底不出高光带：\n源图 64x64，中段会被纵向拉 41x，\n任何纵向渐变都会被拉成横条。\n面板的"厚度"由顶栏横梁（代码画）给。',
           fill=DIM, font=font(12))
    return im


# ---------------------------------------------------------------------------
# ② 九宫格切割示意
# ---------------------------------------------------------------------------
def slice_map() -> Image.Image:
    im = Image.new('RGBA', (W, 520), PAGE + (255,))
    d = ImageDraw.Draw(im)
    d.text((16, 14), '九宫格切割示意    切线画在源图上（四条线按 inset 像素）', fill=CYAN_HI, font=font(20, True))
    d.text((16, 40), '四角固定不缩放 / 四边单向拉伸 / 中心双向拉伸。角块必须大于「圆角 + 描边」，否则拉伸后四角起毛刺。',
           fill=DIM, font=font(12))

    def show(name, inset, x0, y0, zoom):
        img = load(name)
        w, h = img.size
        big = img.resize((w * zoom, h * zoom), Image.NEAREST)
        paste(im, big, x0, y0)
        dd = ImageDraw.Draw(im)
        for gx in (inset, w - inset):
            dd.line([(x0 + gx * zoom, y0), (x0 + gx * zoom, y0 + h * zoom)], fill=PINK, width=2)
        for gy in (inset, h - inset):
            dd.line([(x0, y0 + gy * zoom), (x0 + w * zoom, y0 + gy * zoom)], fill=PINK, width=2)
        dd.text((x0, y0 + h * zoom + 8), f'{name}   {w}x{h}   inset={inset}', fill=CYAN_HI, font=font(13, True))
        dd.text((x0, y0 + h * zoom + 28), f'角块 {inset} 源图像素 = 设计 {inset // SCALE}px',
                fill=DIM, font=font(12))

    # 布局：左列两个源图（缩放看切线）+ 右下角块放大镜（列在源图之下，互不重叠）
    # ⚠️ 面板源图放大 3x 后是 384×384，y 从 84 起 ⇒ 下缘到 468。整图高度必须 ≥ 520。
    show('btn_off', INSET['btn'], 24, 84, 1)
    show('panel_off', INSET['panel'], 620, 84, 2)

    # 角块放大镜：证明角块里正好装下「圆角 + 描边」
    # ⚠️ 底要先铺一层不透明色再贴角块，否则看的是主图深色，放大镜会"糊成一片看不到渐变"。
    bx, by = 900, 84
    backer = Image.new('RGBA', (176, 176), (4, 7, 13, 255))
    paste(im, backer, bx - 6, by - 6)
    b = load('btn_off')
    corner = b.crop((0, 0, INSET['btn'], INSET['btn'])).resize((164, 164), Image.NEAREST)
    paste(im, corner, bx, by)
    dd = ImageDraw.Draw(im)
    dd.text((bx - 6, by + 182), '按钮左上角块 x5 放大', fill=CYAN_HI, font=font(13, True))
    dd.text((bx - 6, by + 206),
            f'236x62 r11：圆角 11 + 描边 {STROKE["btn"]}\n'
            f'= {DESIGN["btn"][2] + STROKE["btn"]} 设计px  <  角块 {INSET["btn"] // SCALE}px   OK',
            fill=DIM, font=font(12))
    dd.text((24, 380),
            '角块必须大于「圆角 + 描边」——角块小了会让拉伸后的四角被啃掉一块，而源图上一像素都看不出来。',
            fill=(235, 250, 255), font=font(13))
    dd.text((24, 406),
            f'按钮：角块 {INSET["btn"] // SCALE} 设计px  -  圆角 {DESIGN["btn"][2]}  -  描边 {STROKE["btn"]}'
            f'  =  余量 {INSET["btn"] // SCALE - DESIGN["btn"][2] - STROKE["btn"]:.1f}px',
            fill=DIM, font=font(12))
    dd.text((24, 430),
            f'面板：角块 {INSET["panel"] // SCALE} 设计px  -  圆角 {DESIGN["panel"][2]}  -  描边 {STROKE["panel"]}'
            f'  =  余量 {INSET["panel"] // SCALE - DESIGN["panel"][2] - STROKE["panel"]:.1f}px',
            fill=DIM, font=font(12))
    dd.text((24, 454),
            '槽位不切九宫格（96 / 88 只差 8px），所以没有余量问题 —— 但代价是它**只能用在 96 档**。',
            fill=DIM, font=font(12))
    return im


# ---------------------------------------------------------------------------
# ③ 实景合成
# ---------------------------------------------------------------------------
def on_bg() -> Image.Image:
    bg = Image.open(BG).convert('RGB')
    iw, ih = bg.size
    s = max(W / iw, H / ih)
    bg = bg.resize((int(iw * s + .5), int(ih * s + .5)), Image.LANCZOS)
    bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2,
                  (bg.width - W) // 2 + W, (bg.height - H) // 2 + H)).convert('RGBA')

    # 左栏两个入口（槽位 96，V6.38 版式坐标）
    for i, st in enumerate(('off', 'hi')):
        s96 = load(f'slot_{st}').resize((96, 96), Image.LANCZOS)
        paste(bg, s96, 32, 234 + i * 184)
        ic = ICONS / 'icon_codex.png'
        if ic.exists():
            # 图标是**单色冷白**（基底约 #bcc2c8）而不是纯白 —— 实装靠 sprite.color 乘色
            # 得到四态（乘法只能压暗）。预览里示范"常态"乘色：把 RGB 整体压到 0.62 倍，
            # 这正是引擎里 `sprite.color = 0x9fa8b2` 的效果。
            g0 = Image.open(ic).convert('RGBA').resize((96, 96), Image.LANCZOS)
            rgb = g0.convert('RGB').point(lambda v: int(v * 0.62))
            g0 = Image.merge('RGBA', (*rgb.split(), g0.getchannel('A')))
            paste(bg, g0, 32, 234 + i * 184)

    # 主按钮（236x62，右下角 START_CY=640 / START_PAD_R=32）
    b = stretch('btn_off', INSET['btn'], 236, 62).resize((236, 62), Image.LANCZOS)
    bx = W - 32 - 236
    by = 640 - 31
    paste(bg, b, bx, by)

    # 面板（560x300 演示九宫格大面板）
    pn = stretch('panel_off', INSET['panel'], 560, 300).resize((560, 300), Image.LANCZOS)
    paste(bg, pn, 620, 200)

    # 顶栏底（一条横向玻璃梁，矢量画法）
    bar = Image.new('RGBA', (W, 72), (0x08, 0x11, 0x19, int(0.92 * 255)))
    paste(bg, bar, 0, 0)

    d = ImageDraw.Draw(bg)
    d.text((16, 84), '实景合成：玻璃槽位底 + 主按钮底 + 面板底（560x300 由 128x128 源图九宫格拉出）',
           fill=CYAN_HI, font=font(16, True))
    d.text((16, 108), '判据：槽位是「贴在场景上发光」还是「在画上贴了两块黑板」；面板能不能透出背景的岩壁',
           fill=(210, 235, 245), font=font(12))
    d.text((bx + 118, by + 31), '开始游戏', fill=(0xc8, 0xf8, 0xff), font=font(26, True), anchor='mm')
    return bg


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    p1 = OUT / 'frame_sheet.png'
    p2 = OUT / 'frame_slice.png'
    p3 = OUT / 'frame_onbg.png'
    sheet().convert('RGB').save(p1)
    slice_map().convert('RGB').save(p2)
    on_bg().convert('RGB').save(p3)
    print('已出图:', p1)
    print('已出图:', p2)
    print('已出图:', p3)


if __name__ == '__main__':
    main()
