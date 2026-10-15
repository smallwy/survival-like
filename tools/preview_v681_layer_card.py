#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V6.81 换带（跨层）过场 · **UI 概念图** —— 参数级示意，非实机渲染。

用户 2026-10-15：**「不同层之间的衔接没有做好 文字描述需要有UI概念图 给人一种兴奋感的提示吧」**

图上要回答三件事
----------------
① **现状为什么不行**：`Hud.drawCombat` 的层入场卡是一块 **520×140 的 `MENU.page` 实心板**
   放在**屏幕正中** `(W/2, H/2-70)`。而 HUD 布局预览（`preview_hud.py`）显示
   中央 y 150~380 / x 60~1050 **整块是战场** —— 卡片正好糊在自机与鱼群上。
   另外它 **L1 不显示**（`L.mech === ''` 直接跳过）⇒ 开局没有任何"进入"的仪式感。
② **方案 A（推荐）**：把过场搬到**上 1/5 的一条压条**（x 24~1080, y 150~242），
   不碰战场；信息从"带名"扩成「层号 + 带名 + 深度区间 + 机制 + 氧耗倍率」，
   氧耗用**放大入场的数字**给"这一层更难"的心跳。
③ **方案 B**：不占中央，把**左侧深度计**的新段展开成小面板。

⚠️ 图上所有坐标都是 1304×749 实机 px，可直接抄进 `Hud.ts`。
⚠️ 参数级示意：底图是 L3 真图 + HUD 位置框，**不是** Creator 渲染结果。

输出：docs/shots/v681_layer_card.png
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'env')
OUT = os.path.join(ROOT, 'docs', 'shots', 'v681_layer_card.png')

W, H = 1304, 749
TH_W = 470                                   # 对照缩略图宽
TH_S = TH_W / W

# ---- 主题色（`shared/theme.ts` 逐个抄）----
PAGE = (8, 17, 28)
LINE = (27, 51, 72)
CYAN = (79, 232, 255)
CYAN_HI = (200, 248, 255)
CYAN_DIM = (31, 106, 125)
AMBER = (255, 209, 102)
DANGER = (255, 46, 99)
JADE = (127, 255, 212)
MUTE = (96, 128, 142)
DIM = (128, 160, 176)
INK = (12, 20, 30)
FRAME = (46, 62, 78)

FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'
_f: dict[int, ImageFont.FreeTypeFont] = {}


def F(s: int) -> ImageFont.FreeTypeFont:
    if s not in _f:
        _f[s] = ImageFont.truetype(FONT_PATH, s)
    return _f[s]


def lerp(c: int, k: float) -> tuple:
    return tuple(int(v + (255 - v) * k + 0.5) for v in ((c >> 16) & 255, (c >> 8) & 255, c & 255))


# L3 午夜带
TINT = lerp(0x352f6b, 0.38)
L3 = dict(idx=3, name='午夜带', sub='MIDNIGHT', mech='涌流', top=1000, bot=4000,
          tip='它们从同一个方向压上来 —— 退路只有一条', drain=1.80, sec=47)


def base_bg() -> Image.Image:
    """L3 实机裁切做底（真图，不是画的水）。

    ⚠️ 乘 0.55 近似 `drawVeil` 的压暗 —— 实机看到的水体比裸背景图**暗一半**，
    不压暗的话这张概念图会比实机"亮一档"，字号与对比度的判断全不可信。
    """
    im = Image.open(os.path.join(ENV, 'L3.png')).convert('RGB')
    W0, H0 = im.size
    s = max(W / W0, H / H0)
    big = im.resize((int(W0 * s + .5), int(H0 * s + .5)), Image.LANCZOS)
    crop = big.crop(((big.width - W) // 2, (big.height - H) // 2,
                     (big.width - W) // 2 + W, (big.height - H) // 2 + H))
    return crop.point(lambda v: int(v * 0.55 + 0.5))


def hud_boxes(d: ImageDraw.ImageDraw, ox=0, oy=0, s=1.0, a=1.0):
    """现有 HUD 的位置框（与 `preview_hud.py` / `Hud.drawCombat` 同口径）。"""
    def R(x, y, w, h, col=FRAME, txt=None, fs=12):
        d.rectangle([ox + x * s, oy + y * s, ox + (x + w) * s, oy + (y + h) * s],
                    outline=col)
        if txt:
            d.text((ox + (x + 3) * s, oy + (y + 2) * s), txt, font=F(max(9, int(fs * s))),
                   fill=MUTE)
    # 深度块 / 深度计
    R(24, 22, 162, 183, txt='深度数字 · 层名 · 机制 · 氧耗')
    R(24, 262, 9, 359)
    for i, nm in enumerate(['阳光带', '弱光带', '午夜带', '热泉带', '深渊带']):
        d.text((ox + 45 * s, oy + (262 + i * 71.8 + 30) * s), nm, font=F(max(9, int(12 * s))),
               fill=CYAN_DIM if i == 2 else MUTE)
    # 氧气条（顶部居中）
    d.rectangle([ox + 360 * s, oy + 28 * s, ox + 690 * s, oy + 42 * s], outline=CYAN_DIM)
    d.text((ox + 364 * s, oy + 30 * s), '氧气条', font=F(max(9, int(11 * s))), fill=MUTE)
    # 波次 / 倒计时
    R(760, 22, 140, 103, txt='波次 / 倒计时')
    # 鱼情雷达 R88 @ (W-110, 198)
    cx, cy, r = ox + 1194 * s, oy + 198 * s, 88 * s
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=CYAN_DIM)
    d.text((cx - r, cy - r - 16 * s), '鱼情雷达 R88', font=F(max(9, int(11 * s))), fill=MUTE)
    # 座圈 ×6 + 空格
    for i in range(6):
        R(24 + i * 100, 693, 88, 52, txt=f'槽{i+1}' if s > .6 else None)
    R(624, 693, 44, 44, txt='空格' if s > .6 else None)
    # 遗物 ×6 + 暂停
    for i in range(6):
        R(825 + i * 50, 693, 40, 44)
    R(1140, 693, 50, 44, txt='暂停' if s > .6 else None)
    # 战场标注
    if s > .6:
        d.rectangle([ox + 60 * s, oy + 150 * s, ox + 1050 * s, oy + 380 * s],
                    outline=(70, 44, 44))
        d.text((ox + 66 * s, oy + 154 * s), '← 战场（自机 / 鱼群）· 现在这张卡正压在这里',
               font=F(12), fill=(150, 80, 90))


# ---------------------------------------------------------------------------
# 现状
# ---------------------------------------------------------------------------
def draw_current(bg: Image.Image) -> Image.Image:
    im = bg.copy()
    d = ImageDraw.Draw(im)
    hud_boxes(d)
    a = 0.72
    d.rectangle([W / 2 - 260, H / 2 - 70, W / 2 + 260, H / 2 + 70],
                fill=tuple(int(v * a + b * (1 - a)) for v, b in zip(PAGE, (20, 40, 52))))
    d.rectangle([W / 2 - 260, H / 2 - 70, W / 2 + 260, H / 2 + 70], outline=(60, 40, 44))
    d.text((W / 2, H / 2 - 44), f'{L3["name"]} · {L3["mech"]}', font=F(24), fill=CYAN, anchor='ma')
    d.text((W / 2, H / 2 - 4), L3['tip'], font=F(15), fill=DIM, anchor='ma')
    d.text((W / 2, H / 2 + 20), '⛔ 520×140 实心板压在战场中央；且 L1（mech 为空）完全不显示',
           font=F(12), fill=(200, 110, 120), anchor='ma')
    return im


# ---------------------------------------------------------------------------
# 方案 A（推荐）：上 1/5 压条
# ---------------------------------------------------------------------------
def draw_option_a(bg: Image.Image, k: float = 1.0, hl: float = 0.62) -> Image.Image:
    """`k` = 入场进度（0=未入, 1=到位）；`hl` = 高光扫过的位置 0~1。"""
    im = bg.copy()
    d = ImageDraw.Draw(im)
    hud_boxes(d)

    x0, x1 = 24, 1080
    y0 = 150 - (1 - k) * 92            # 从上方滑入
    y1 = y0 + 92
    # 底板
    d.rectangle([x0, y0, x1, y1], fill=(int(PAGE[0] * .80 + 14 * .2),
                                        int(PAGE[1] * .80 + 30 * .2),
                                        int(PAGE[2] * .80 + 42 * .2)))
    d.line([x0, y0, x1, y0], fill=LINE, width=1)
    d.line([x0, y1, x1, y1], fill=LINE, width=1)
    # 左右端强调竖条（取新带 tint 提亮 38%）
    d.rectangle([x0, y0, x0 + 3, y1], fill=TINT)
    d.rectangle([x1 - 3, y0, x1, y1], fill=TINT)
    # 入场高光（右侧 3px 竖条向左扫过一次）
    hx = int(x1 - (x1 - x0) * hl)
    d.rectangle([hx, y0, hx + 2, y1], fill=CYAN_HI)

    # ---- 主行 ----
    ty = y0 + 14
    d.text((x0 + 22, ty), 'L3', font=F(26), fill=TINT)
    d.text((x0 + 22 + 42, ty), L3['name'], font=F(26), fill=CYAN_HI)
    d.text((x0 + 22 + 42 + 26 * 3 + 14, ty + 12), L3['sub'], font=F(12), fill=MUTE)
    d.text((x1 - 22, ty + 4), f'{L3["top"]:,} – {L3["bot"]:,} m', font=F(20),
           fill=AMBER, anchor='ra')
    # ---- 次行 ----
    sy = y0 + 54
    d.text((x0 + 22, sy), f'◆ {L3["mech"]}', font=F(15), fill=AMBER)
    d.text((x0 + 22 + 76, sy + 2), L3['tip'], font=F(13), fill=DIM)
    d.text((x1 - 22, sy + 1), f'氧耗 ×{L3["drain"]:.2f} · 静止 {L3["sec"]}s', font=F(14),
           fill=AMBER, anchor='ra')
    if k > .99:
        d.text((x0 + 22, y1 + 8), '↑ 压条占 y 150~242，不覆盖战场（y150~380 中只吃最上面一条）',
               font=F(12), fill=JADE)
    return im


# ---------------------------------------------------------------------------
# 方案 B：左侧深度计展开
# ---------------------------------------------------------------------------
def draw_option_b(bg: Image.Image) -> Image.Image:
    im = bg.copy()
    d = ImageDraw.Draw(im)
    hud_boxes(d)
    seg = 359 / 5
    y0 = 262 + 2 * seg
    x0, x1 = 18, 210
    y1 = y0 + 92
    d.rectangle([x0, y0, x1, y1], fill=(10, 20, 32))
    d.rectangle([x0, y0, x0 + 3, y1], fill=TINT)
    d.rectangle([x0, y0, x1, y1], outline=LINE)
    d.text((x0 + 14, y0 + 10), f'L3  {L3["name"]}', font=F(19), fill=CYAN_HI)
    d.text((x0 + 14, y0 + 38), f'{L3["top"]:,} – {L3["bot"]:,} m', font=F(14), fill=AMBER)
    d.text((x0 + 14, y0 + 58), f'◆ {L3["mech"]} · 氧耗 ×{L3["drain"]:.2f}', font=F(13), fill=DIM)
    d.text((x0, y1 + 8), '不占中央；信息落在"我在哪一层"的固定位置', font=F(12), fill=JADE)
    return im


def timeline(d: ImageDraw.ImageDraw, ox: int, oy: int, wdt: int):
    """换带时序：0 ~ 2.6s（= `world.layerCardT`）。"""
    T = 2.6
    x1 = ox + wdt
    d.text((ox, oy - 20), '换带时序（0 ~ 2.6 s，全部与 V6.56 已有节奏对齐；⛔ 不改模拟层）',
           font=F(14), fill=CYAN_HI)
    d.line([ox, oy + 26, x1, oy + 26], fill=LINE, width=1)
    rows = [
        ('下潜爆冲 + 震屏', 0.0, 2.6, (90, 120, 150)),
        ('温跃层扫带', 0.0, 0.6, CYAN),
        ('水压环 ×3', 0.0, 0.9, JADE),
        ('背景 crossfade', 0.0, 2.0, (120, 110, 180)),
        ('★ 换带压条：滑入', 0.0, 0.25, AMBER),
        ('★ 换带压条：停留', 0.25, 2.20, AMBER),
        ('★ 换带压条：抽出', 2.20, 2.60, AMBER),
        ('第一波开打', 2.10, 2.60, DANGER),
    ]
    for i, (tag, t0, t1, col) in enumerate(rows):
        y = oy + 44 + i * 13
        d.text((ox, y - 1), tag, font=F(11), fill=MUTE)
        bx = ox + 168
        bw = x1 - bx
        d.rectangle([bx + bw * t0 / T, y, bx + bw * t1 / T, y + 8], fill=col)
    # 刻度
    for s in range(0, 6):
        x = ox + 168 + (x1 - ox - 168) * s / 5
        d.text((x - 6, oy + 44 + 8 * 13 + 2), f'{s * 0.52:.1f}', font=F(10), fill=MUTE)


def main() -> int:
    bg = base_bg()
    main_panel = draw_option_a(bg, k=1.0)
    cur = draw_current(bg)
    optb = draw_option_b(bg)
    enter = draw_option_a(bg, k=0.35, hl=0.30)

    PAD = 18
    HEAD = 76
    TW, TH = TH_W, int(H * TH_S)
    TL_H = 190
    FOOT = 104
    width = W + PAD * 2
    height = HEAD + H + 18 + TH + 18 + TL_H + FOOT
    im = Image.new('RGB', (width, height), (20, 27, 36))
    d = ImageDraw.Draw(im)

    d.text((PAD, 14), '换带（跨层）过场 · UI 概念图（V6.81）', font=F(19), fill=CYAN_HI)
    d.text((PAD, 44), '实机 1304×749 参数级示意（非 Creator 渲染）· 底图 = L3 真图 + 现有 HUD 位置框',
           font=F(12), fill=DIM)

    # 主面板
    im.paste(main_panel, (PAD, HEAD))
    d.rectangle([PAD, HEAD, PAD + W - 1, HEAD + H - 1], outline=(60, 80, 96))
    d.text((PAD + 4, HEAD + H + 3), '方案 A（推荐）· 换带压条 —— 稳定态 1:1',
           font=F(14), fill=AMBER)

    # 对照缩略图
    ty = HEAD + H + 24
    for i, (img, tag, col) in enumerate(((cur, '现状 · 中央 520×140 实心板', DANGER),
                                         (optb, '方案 B · 左侧深度计展开', CYAN),
                                         (enter, '方案 A · 入场瞬间（k=0.35）', AMBER))):
        ox = PAD + i * (TW + 16)
        im.paste(img.resize((TW, TH), Image.LANCZOS), (ox, ty))
        d.rectangle([ox, ty, ox + TW - 1, ty + TH - 1], outline=(60, 80, 96))
        d.text((ox + 3, ty + TH + 4), tag, font=F(12), fill=col)

    timeline(d, PAD + 6, ty + TH + 40, W - 12)

    fy = height - FOOT + 8
    d.text((PAD, fy), '为什么这样改：', font=F(14), fill=AMBER)
    d.text((PAD, fy + 22),
           '① **让开战场** —— 中央 y150~380 是自机与鱼群，过场必须挪到上/侧边；'
           '② **给数字** —— 深度区间 + 氧耗倍率才是"更深更险"的可读信号，'
           '带名只是一个词；', font=F(12), fill=DIM)
    d.text((PAD, fy + 42),
           '③ **补 L1** —— 现在 L1（mech 为空）完全不显示，开局没有"进入"的仪式感，'
           '建议 mech 为空时也出压条（只显示带名 + 深度）；', font=F(12), fill=DIM)
    d.text((PAD, fy + 62),
           '④ 文案仍走引擎内 Label（⛔ 不画进图），本图只定**位置 / 字号 / 色**。',
           font=F(12), fill=JADE)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT)
    print(f'-> {OUT}  {im.size}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
