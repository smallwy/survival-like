#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V6.82 UI 概念图 · **参数级示意（非实机渲染）**。

覆盖本轮两件事，坐标全部取 1304×749 实机 px，可直接对着 `Hud.ts` 核：

A. **换带提示条**：V6.81 通栏（1056px）→ V6.82 居中浮条（620×78）+ 最后 1.0s 渐隐。
   用户 2026-10-15：「这个需要高一点」「这个太长了…一个提示不应该适中提示然后渐变消失吗」。
   下半部分是**时间线四帧**（滑入 / 全亮 / 渐隐中 / 将尽）—— "渐变消失"是唯一需要看
   连续四帧才能确认的东西，静帧对比图看不出来。

B. **槽位说明卡**：点座圈 / 遗物槽 → 弹卡（344×138，槽位正上方 12px + 指针）。
   用户 2026-10-15 两次：「点击座圈那几个发射物没有出来说明这个发射物的信息 …遗物也是」。

输出：docs/shots/v682_ui.png
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'env')
ART = os.path.join(ROOT, 'cocos', 'assets', 'resources')
ARTPROBE = ['echo', 'gun', 'torpedo']
OUT = os.path.join(ROOT, 'docs', 'shots', 'v682_ui.png')

W, H = 1304, 749

PAGE = (8, 17, 28)
PANEL = (17, 32, 48)
PANEL_HI = (24, 44, 64)
LINE = (27, 51, 72)
CYAN = (79, 232, 255)
CYAN_HI = (200, 248, 255)
CYAN_DIM = (31, 106, 125)
AMBER = (255, 209, 102)
JADE = (127, 255, 212)
MAGENTA = (255, 79, 216)
ABYSS = (6, 14, 24)
CYBER = (200, 248, 255)
DIM = (128, 160, 176)
MUTE = (96, 128, 142)
EDGE = (46, 62, 78)

FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'
_f: dict[int, ImageFont.FreeTypeFont] = {}


def F(s: int) -> ImageFont.FreeTypeFont:
    if s not in _f:
        _f[s] = ImageFont.truetype(FONT_PATH, s)
    return _f[s]


def base_bg(layer: str, dim: float = 1.0) -> Image.Image:
    """实机 L 图做底（cover 裁切 + 可选压暗）。"""
    im = Image.open(os.path.join(ENV, layer + '.png')).convert('RGB')
    s = max(W / im.width, H / im.height)
    big = im.resize((int(im.width * s + .5), int(im.height * s + .5)), Image.LANCZOS)
    out = big.crop(((big.width - W) // 2, (big.height - H) // 2,
                    (big.width - W) // 2 + W, (big.height - H) // 2 + H))
    if dim < 1.0:
        out = Image.eval(out, lambda v: int(v * dim))
    return out


# ---------------------------------------------------------------------------
# A. 换带提示条
# ---------------------------------------------------------------------------
CARD_W, CARD_Y, CARD_H = 620, 96, 78
BAND_OLD = (24, 150, 1080, 242)          # V6.81 通栏（x0,y0,x1,y1）

# L1 阳光带（与 `LAYERS[0]` 同源文案）
L_NAME, L_SUB = '阳光带', 'SUNLIT'
L_DEPTH = '0 – 200 m'
L_MECH, L_TIP = '', '没有额外机制 —— 先把手感练顺'
L_O2 = '氧耗 ×1.00 · 静止 100s'
TINT = (79, 232, 255)


def draw_card(im: Image.Image, alpha: float, dy: float = 0.0) -> None:
    """按 `Hud.drawCombat` ⑩ 的几何画浮条。alpha = 渐隐系数（1 = 全亮）。"""
    d = ImageDraw.Draw(im, 'RGBA')
    x0 = (W - CARD_W) / 2
    y0 = CARD_Y + dy
    a = int(255 * alpha)
    box = [x0, y0, x0 + CARD_W, y0 + CARD_H]
    d.rounded_rectangle(box, 12, fill=PAGE + (int(214 * alpha),),
                        outline=LINE + (int(230 * alpha),), width=1)
    edge = tuple(min(255, int(c + (255 - c) * 0.38)) for c in TINT)
    d.rounded_rectangle([x0, y0, x0 + 3, y0 + CARD_H], 1, fill=edge + (a,))
    d.rounded_rectangle([x0 + CARD_W - 3, y0, x0 + CARD_W, y0 + CARD_H], 1, fill=edge + (a,))
    tx = x0 + 20
    d.text((tx, y0 + 12), 'L1', font=F(26), fill=edge + (a,))
    d.text((tx + 42, y0 + 12), L_NAME, font=F(26), fill=CYBER + (a,))
    d.text((tx + 42 + 26 * len(L_NAME) + 12, y0 + 24), L_SUB, font=F(12), fill=MUTE + (a,))
    tw = d.textlength(L_DEPTH, font=F(20))
    d.text((x0 + CARD_W - 20 - tw, y0 + 16), L_DEPTH, font=F(20), fill=AMBER + (a,))
    sy = y0 + 48
    d.text((tx, sy + 2), L_TIP, font=F(13), fill=DIM + (a,))
    tw2 = d.textlength(L_O2, font=F(13))
    d.text((x0 + CARD_W - 20 - tw2, sy + 1), L_O2, font=F(13), fill=AMBER + (a,))


def panel_A() -> Image.Image:
    """上：V6.81 通栏 vs V6.82 浮条。下：渐隐时间线四帧。"""
    FW, FH = 640, 360                    # 单格缩略
    S = FW / W
    rows = 3
    im = Image.new('RGB', (FW * 2 + 24, FH * rows + 24 * rows + 64), (14, 18, 26))
    d = ImageDraw.Draw(im)
    d.text((12, 8), 'A. 换带提示条 —— 通栏压条 → 居中浮条（620×78）+ 最后 1.0s 渐隐',
           font=F(19), fill=CYAN_HI)
    d.text((12, 34), '用户：「这个需要高一点」「这个太长了吧 一个提示不应该适中提示然后渐变消失吗」',
           font=F(12), fill=DIM)

    def put(col: int, row: int, img: Image.Image, tag: str) -> None:
        x = 12 + col * (FW + 8)
        y = 64 + row * (FH + 24)
        im.paste(img.resize((FW, FH), Image.LANCZOS), (x, y))
        d.rectangle([x, y, x + FW - 1, y + FH - 1], outline=EDGE)
        d.text((x + 3, y + FH + 3), tag, font=F(13), fill=AMBER if col == 0 else JADE)

    # 上行：旧通栏
    o1 = base_bg('L1', 0.85)
    dd = ImageDraw.Draw(o1, 'RGBA')
    x0, y0, x1, y1 = BAND_OLD
    dd.rectangle([x0, y0, x1, y1], fill=PAGE + (200,))
    dd.line([x0, y0, x1, y0], fill=LINE + (230,), width=1)
    dd.line([x0, y1, x1, y1], fill=LINE + (230,), width=1)
    dd.rectangle([x0, y0, x0 + 3, y1], fill=TINT + (255,))
    dd.rectangle([x1 - 3, y0, x1, y1], fill=TINT + (255,))
    dd.text((x0 + 22, y0 + 14), 'L1', font=F(26), fill=(199, 255, 255))
    dd.text((x0 + 64, y0 + 14), L_NAME, font=F(26), fill=CYBER)
    dd.text((x0 + 64 + 78 + 12, y0 + 26), L_SUB, font=F(12), fill=MUTE)
    tw = dd.textlength(L_DEPTH, font=F(20))
    dd.text((x1 - 22 - tw, y0 + 18), L_DEPTH, font=F(20), fill=AMBER)
    dd.text((x0 + 22, y0 + 54 + 2), L_TIP, font=F(13), fill=DIM)
    tw2 = dd.textlength(L_O2, font=F(13))
    dd.text((x1 - 22 - tw2, y0 + 55), L_O2, font=F(13), fill=AMBER)
    dd.rectangle([x0, y0, x1, y1], outline=(255, 120, 120))
    dd.text((x0, y1 + 4), 'V6.81  1056×92 通栏 —— 只有两行字却占满整屏宽，读作"进度条"',
            font=F(13), fill=(255, 140, 140))
    put(0, 0, o1, 'BEFORE  V6.81 通栏压条')

    o2 = base_bg('L1', 0.85)
    draw_card(o2, 1.0)
    put(1, 0, o2, 'AFTER  V6.82 居中浮条 + 渐隐')

    # 下行：时间线四帧（放大到"只取条周围"）
    crop = (300, 60, 1010, 220)
    for k, (t, al, lab) in enumerate([
        (0.12, 0.70, 't≈0.12s  滑入 + 淡入'),
        (0.90, 1.00, 't≈0.90s  全亮'),
        (2.10, 0.50, 't≈2.10s  渐隐中'),
        (2.50, 0.12, 't≈2.50s  将尽'),
    ]):
        fr = base_bg('L1', 0.85)
        draw_card(fr, al, dy=(1 - min(1, t / 0.25)) * 24)
        put(k % 2, 1 + k // 2, fr.crop(crop), lab)
    return im


# ---------------------------------------------------------------------------
# B. 槽位说明卡
# ---------------------------------------------------------------------------
CW, CH = 344, 138


def draw_seat_card(im: Image.Image, i: int, name: str, col: tuple,
                   lvl: int, stats: str, dps: str, desc: str, evo: str) -> None:
    d = ImageDraw.Draw(im, 'RGBA')
    sw, sh, gap, seatY = 88, 52, 100, H - 56
    ax = 24 + i * gap
    x = max(12, min(W - CW - 12, ax + sw / 2 - CW / 2))
    y = seatY - 12 - CH
    d.rounded_rectangle([x, y, x + CW, y + CH], 10, fill=PANEL + (245,), outline=CYAN_DIM + (230,), width=1)
    px0 = max(x + 14, min(x + CW - 14, ax + sw / 2))
    d.polygon([(px0 - 7, y + CH - 1), (px0 + 7, y + CH - 1), (px0, y + CH + 9)], fill=PANEL + (245,))
    d.rounded_rectangle([x + 12, y + 12, x + 112, y + 62], 7, fill=ABYSS + (140,))
    art = os.path.join(ART, 'items', 'item_' + ARTPROBE[i] + '.png')
    if os.path.exists(art):
        sp = Image.open(art).convert('RGBA')
        s = min(96 / sp.width, 46 / sp.height)
        sp = sp.resize((max(1, int(sp.width * s)), max(1, int(sp.height * s))), Image.LANCZOS)
        im.paste(sp, (int(x + 62 - sp.width / 2), int(y + 37 - sp.height / 2)), sp)
    d.text((x + 124, y + 14), name, font=F(17), fill=CYBER)
    for k in range(5):
        c = col if k < lvl else (60, 76, 92)
        d.rectangle([x + 124 + k * 6, y + 40, x + 128 + k * 6, y + 44], fill=c)
    d.text((x + 124, y + 58), stats, font=F(13), fill=DIM)
    d.text((x + 124, y + 78), dps, font=F(13), fill=AMBER)
    d.text((x + 12, y + 100), desc, font=F(13), fill=DIM)
    d.text((x + 12, y + 120), evo, font=F(13), fill=MUTE)


def draw_relic_card(im: Image.Image, i: int, name: str, desc: str, cost: str, live: bool) -> None:
    d = ImageDraw.Draw(im, 'RGBA')
    rs, rgap = 34, 40
    rx0 = W - 92 - 4 * rgap + (rgap - rs)
    ax = rx0 + i * rgap
    ay = H - 50 + 5
    x = max(12, min(W - CW - 12, ax + rs / 2 - CW / 2))
    y = ay - 12 - CH
    d.rounded_rectangle([x, y, x + CW, y + CH], 10, fill=PANEL + (245,), outline=CYAN_DIM + (230,), width=1)
    px0 = max(x + 14, min(x + CW - 14, ax + rs / 2))
    d.polygon([(px0 - 7, y + CH - 1), (px0 + 7, y + CH - 1), (px0, y + CH + 9)], fill=PANEL + (245,))
    d.rounded_rectangle([x + 12, y + 12, x + 68, y + 68], 8, fill=ABYSS + (130,))
    # 遗物图标：一颗心 + 内环（`relicIcon` 的 echo_heart 简写）
    hx, hy = x + 40, y + 40
    d.polygon([(hx, hy + 11), (hx - 12, hy - 1), (hx - 6, hy - 10), (hx, hy - 4),
               (hx + 6, hy - 10), (hx + 12, hy - 1)], fill=MAGENTA + (235,))
    d.ellipse([hx - 4, hy - 4, hx + 4, hy + 4], outline=CYAN_HI + (200,), width=1)
    d.text((x + 82, y + 14), name, font=F(17), fill=CYAN if live else CYBER)
    if live:
        tw = d.textlength('生效中', font=F(13))
        d.text((x + CW - 14 - tw, y + 16), '生效中', font=F(13), fill=CYAN)
    d.text((x + 82, y + 40), desc, font=F(13), fill=DIM)
    d.text((x + 82, y + 60), cost, font=F(13), fill=AMBER)
    d.text((x + 12, y + 100), '条件触发的遗物满足条件时自动生效（槽框呼吸提示）', font=F(12), fill=MUTE)


def panel_B() -> Image.Image:
    FW, FH = 640, 360
    im = Image.new('RGB', (FW * 2 + 24, FH + 64), (14, 18, 26))
    d = ImageDraw.Draw(im)
    d.text((12, 8), 'B. 槽位说明卡 —— 点座圈 / 遗物槽弹出（344×138，槽上方 12px + 指针）',
           font=F(19), fill=CYAN_HI)
    d.text((12, 34), '用户：「点击座圈那几个发射物没有出来说明这个发射物的信息…遗物也是」（两次）',
           font=F(12), fill=DIM)

    # B 面板必须**裁到卡周围再放大** —— 说明卡只有 344×138，整屏缩到 640 宽
    # 之后卡上的字全糊（第一版就是这样，读不出任何内容）。裁窗按卡所在侧给。
    def put(col: int, img: Image.Image, tag: str, crop: tuple) -> None:
        x = 12 + col * (FW + 8)
        c = img.crop(crop)
        im.paste(c.resize((FW, int(FW * c.height / c.width)), Image.LANCZOS), (x, 64))
        d.rectangle([x, 64, x + FW - 1, 64 + FH - 1], outline=EDGE)
        d.text((x + 3, 64 + FH + 3), tag, font=F(13), fill=JADE)

    o1 = base_bg('L3', 0.80)
    # 槽位本体（回声炮 = item_echo）
    dx = 24
    dy = H - 56
    d1 = ImageDraw.Draw(o1, 'RGBA')
    d1.rounded_rectangle([dx, dy, dx + 88, dy + 52], 9, fill=PANEL_HI + (230,), outline=MAGENTA + (230,), width=2)
    d1.rounded_rectangle([dx + 4, dy + 4, dx + 84, dy + 44], 7, fill=ABYSS + (140,))
    a1 = os.path.join(ART, 'items', 'item_echo.png')
    if os.path.exists(a1):
        sp = Image.open(a1).convert('RGBA')
        s = min(76 / sp.width, 38 / sp.height)
        sp = sp.resize((max(1, int(sp.width * s)), max(1, int(sp.height * s))), Image.LANCZOS)
        o1.paste(sp, (int(dx + 44 - sp.width / 2), int(dy + 24 - sp.height / 2)), sp)
    for k in range(5):
        d1.rectangle([dx + 9 + k * 6, dy + 37, dx + 13 + k * 6, dy + 41], fill=MAGENTA if k < 3 else (60, 76, 92))
    draw_seat_card(o1, 0, '回声炮', MAGENTA, 3, '单发 40.0 · 每 1.50s · 射程 480',
                   '秒伤 ≈ 26.7', '延迟爆发 · 需预判', '可进化为 多重回声 / 聚焦回声')
    d1.text((24, dy - 16), '座圈 4/5', font=F(13), fill=CYAN)
    put(0, o1, 'AFTER  座圈卡（回声炮）：立绘 + 名称 + 等级 + 数值 + 描述 + 进化去向',
        (0, 520, 400, 749))

    o2 = base_bg('L3', 0.80)
    d2 = ImageDraw.Draw(o2, 'RGBA')
    rs, rgap = 34, 40
    rx0 = W - 92 - 4 * rgap + (rgap - rs)
    d2.rounded_rectangle([rx0, H - 45, rx0 + rs, H - 45 + rs], 7, fill=PANEL_HI + (230,), outline=CYAN_HI + (240,), width=2)
    hx, hy = rx0 + 17, H - 45 + 17
    d2.polygon([(hx, hy + 8), (hx - 9, hy - 1), (hx - 5, hy - 8), (hx, hy - 3),
                (hx + 5, hy - 8), (hx + 9, hy - 1)], fill=MAGENTA + (225,))
    d2.rectangle([rx0 + 5, H - 49, rx0 + rs - 5, H - 46], fill=CYAN_HI + (230,))
    draw_relic_card(o2, 0, '回声心脏', '氧气低于 30% 时，伤害 +50%',
                    '代价：无代价 —— 但你得敢留在那条线上', True)
    d2.text((W - 92, H - 50 - 16), '遗物 1/6', font=F(13), fill=CYAN)
    put(1, o2, 'AFTER  遗物卡（回声心脏）：图标 + 名称 + 生效态 + 效果 + 代价',
        (880, 530, 1280, 749))
    return im


def main() -> int:
    a = panel_A()
    b = panel_B()
    w = max(a.width, b.width)
    out = Image.new('RGB', (w, a.height + b.height + 20), (14, 18, 26))
    out.paste(a, (0, 0))
    out.paste(b, (0, a.height + 20))
    d = ImageDraw.Draw(out)
    d.text((12, out.height - 14),
           '⚠️ 参数级示意：底图为工程内真实 env 图 + 立绘，位置/尺寸可对着 Hud.ts 核；非 Creator 渲染。',
           font=F(12), fill=MUTE)
    out.save(OUT)
    print('->', OUT, out.size)
    return 0


if __name__ == '__main__':
    sys.exit(main())
