#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
战斗 HUD 预览（V6.57 建 · V6.78 扩）。

两个模式
--------
    python tools/preview_hud.py             # 布局模式：只画占位框 + 名称（默认）
    python tools/preview_hud.py --only      # 布局模式，不叠旧位置虚线
    python tools/preview_hud.py --seats     # 座圈模式：**贴真立绘** 1:1 + 3× 放大

布局模式干什么用
----------------
用户 2026-10-14 两条反馈都是**位置/尺寸**问题（"鱼情图小了点"、"退出暂停的可以放在
右下角"）。这类改动在实机里核对成本高（要开 Creator + 跑一局 + 盯着角落），
而它的正确性判据只有一条：**各信息块之间有没有重叠 / 有没有越界**。
把布局按坐标画出来，一眼可查。

它**不画**任何细节（图标、文字、雷达点位），只画**占位框 + 名称**。
要看的不是"好不好看"，是"站哪儿、多大、撞不撞"。

座圈模式干什么用
----------------
V6.78 把座圈槽的图标从"矢量重画的弹体"换成**发射器立绘本身**（`item_<id>.png`）。
判据是"**同一个东西在两张界面里必须长得一模一样**"（卡面用立绘、座圈用矢量就必然对不上）。
这类判据**只有把真图画出来**才能提前发现，占位框看不出来 —— 所以这个模式
必须贴 `items/` 下的真 PNG，并按 `putArt` 的 contain 算式缩放到窗口里。

⚠️ 坐标必须与 `cocos/assets/scripts/view/Hud.ts` 的 `drawCombat()` 同步。
   本文件曾长期停在 V6.57（雷达 R64 @ W−86,174 / 遗物 rgap 36 / 座圈 46×46）——
   而实机早已是 R88 @ W−110,198 / rgap 40 / 座圈 88×52。**预览落后于实机就是
   "预览比实机差一层"那条老坑**：本文件 2026-10-15 已按实机逐个校准。

输出
----
    docs/shots/hud_layout.png     （布局模式）
    docs/shots/hud_seats.png      （座圈模式）
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1304, 749
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'docs', 'shots')
ITEMS_DIR = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'items')

# ---- 主题色（`shared/theme.ts` 的 PALETTE / UI，逐个抄，不要现调）----
C_ABYSS = (4, 7, 13)
C_PANEL = (8, 17, 28)
C_PANEL_HI = (14, 26, 41)
C_LINE = (27, 51, 72)
C_CYAN = (79, 232, 255)
C_CYAN_HI = (200, 248, 255)
C_CYAN_DIM = (31, 106, 125)
C_JADE = (127, 255, 212)
C_JADE_HI = (196, 255, 240)
C_AMBER = (255, 209, 102)
C_VIOLET = (160, 107, 255)
C_DANGER = (255, 46, 99)
C_MAGENTA = (255, 79, 216)
C_DIM = (110, 150, 165)
C_RED = (255, 96, 110)

C_BG = (12, 34, 46)          # 战斗水体（近似 L2 带被 veil 压过之后的亮度）

# WEAPON_DEF[<id>].color —— 只列本预览要用的那几把
WEAPON_COL = {
    'sonar': C_CYAN_HI, 'gun': C_AMBER, 'torpedo': C_DANGER, 'arc': C_VIOLET,
    'harpoon': C_JADE, 'echo': C_MAGENTA, 'acid': C_JADE_HI,
    'sonar_rs': C_CYAN_HI, 'gun_gl': C_AMBER, 'echo_mu': C_MAGENTA,
    'harp_tr': C_JADE, 'net': C_JADE, 'mine': C_CYAN_HI, 'lure': C_AMBER,
}

# ⚠️ 镜像 `shared/dive/artKeys.ts` 的 `WEAPON_ART_FALLBACK`（尚未出图的 id 借语义最近的图）。
#    预览如果不镜像它，画出来的就是"实机不会出现的样子"（实机取到的是回退图）。
ART_FALLBACK = {
    'mine': 'echo', 'mine_ch': 'echo', 'mine_o2': 'echo_mu',
    'net': 'arc', 'net_el': 'arc_ov', 'net_cv': 'arc_st',
    'lure': 'sonar', 'lure_bo': 'echo_fo', 'lure_wl': 'sonar_rs',
}

# ---- 座圈槽几何（Hud.ts `drawCombat()` ⑤，V6.78）----
SEAT_X0, SEAT_GAP = 24, 100
SEAT_W, SEAT_H = 88, 52
SEAT_Y = H - 56
ART_INSET = 4                      # 立绘窗相对卡面的内缩

_F = {}


def F(size):
    if size not in _F:
        for path in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/arial.ttf'):
            try:
                _F[size] = ImageFont.truetype(path, size)
                break
            except Exception:
                continue
        else:
            _F[size] = ImageFont.load_default()
    return _F[size]


def blend(fg, bg, a):
    return tuple(int(round(fg[i] * a + bg[i] * (1 - a))) for i in range(3))


def art_path(wid):
    """`artPaths()` 的等价物：item_<id>.png，缺图时走 WEAPON_ART_FALLBACK。"""
    p = os.path.join(ITEMS_DIR, 'item_%s.png' % wid)
    if os.path.isfile(p):
        return p
    fb = ART_FALLBACK.get(wid)
    if fb:
        p2 = os.path.join(ITEMS_DIR, 'item_%s.png' % fb)
        if os.path.isfile(p2):
            return p2
    return None


def paste_art(img, cx, cy, fw, fh, wid):
    """复刻 `Hud.putArt()`：contain（按**未裁剪的整张画布** originalSize 算比例）+ 居中。"""
    p = art_path(wid)
    if not p:
        return False
    sf = Image.open(p).convert('RGBA')
    iw, ih = sf.size
    k = min(fw / iw, fh / ih)
    sf = sf.resize((max(1, int(round(iw * k))), max(1, int(round(ih * k)))), Image.LANCZOS)
    img.paste(sf, (int(round(cx - sf.width / 2)), int(round(cy - sf.height / 2))), sf)
    return True


# ---------------------------------------------------------------------------
# 布局模式
# ---------------------------------------------------------------------------
def box(d, x, y, w, h, col, label, a_label=True, fill=None, dash=False):
    """画一个占位框（x/y 为**左上角**）+ 名称。"""
    if fill:
        d.rectangle([x, y, x + w, y + h], fill=fill)
    if dash:
        for i in range(x, x + w, 8):
            d.line([(i, y), (min(i + 4, x + w), y)], fill=col, width=1)
            d.line([(i, y + h), (min(i + 4, x + w), y + h)], fill=col, width=1)
        for i in range(y, y + h, 8):
            d.line([(x, i), (x, min(i + 4, y + h))], fill=col, width=1)
            d.line([(x + w, i), (x + w, min(i + 4, y + h))], fill=col, width=1)
    else:
        d.rectangle([x, y, x + w, y + h], outline=col, width=2)
    if a_label:
        d.text((x + 2, y + 2), label, fill=col, font=F(13))


def circle(d, cx, cy, r, col, label, fill=None):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=2, fill=fill)
    d.text((cx - r, cy - r - 18), label, fill=col, font=F(13))


def draw_layout(show_old):
    img = Image.new('RGB', (W, H), C_BG)
    d = ImageDraw.Draw(img)

    # ---- 旧位置（虚线对照）----
    if show_old:
        circle(d, W - 86, 174, 64, (110, 70, 90), '')
        d.text((W - 150, 92), 'V6.57 雷达 R64', fill=(140, 90, 110), font=F(12))
        d.rectangle([W - 55, 11, W - 9, 49], outline=(110, 70, 90), width=2)
        d.text((W - 130, 56), 'V6.57 暂停键（右上）', fill=(110, 70, 90), font=F(13))

    # ---- ① 深度指示（左上）----
    box(d, 24, 22, 210, 200, C_CYAN, '深度数字 / 层名 / 倍率 / 氧耗')
    # ---- ①b 深度计：竖直标尺，五段等分 + 段内真实插值游标 ----
    mgX, mgW, mgY0, mgY1 = 24, 9, 262, H - 128
    segH = (mgY1 - mgY0) / 5
    names = ['阳光带', '弱光带', '午夜带', '热泉带', '深渊带']
    d.line([(mgX - 4, mgY0), (mgX + mgW + 60, mgY0)], fill=(40, 80, 96), width=1)
    for i in range(5):
        y = mgY0 + i * segH
        d.rectangle([mgX, y + 1.5, mgX + mgW, y + segH - 1.5],
                    fill=(46, 100, 120) if i == 1 else None,
                    outline=C_CYAN if i == 1 else (40, 80, 96))
        if i > 0:
            d.line([(mgX - 4, y), (mgX, y)], fill=(40, 80, 96), width=1)
        d.text((mgX + mgW + 12, y + segH / 2 - 8), names[i],
               fill=C_CYAN if i == 1 else C_DIM, font=F(12))
    py = mgY0 + (1 + 0.4) * segH
    d.line([(mgX - 5, py), (mgX + mgW + 5, py)], fill=C_CYAN_HI, width=2)
    d.rectangle([mgX + mgW + 1, py - 3, mgX + mgW + 6, py + 3], fill=C_CYAN_HI)
    d.text((mgX + mgW + 12, mgY1 + 6), '深度计', fill=C_CYAN_HI, font=F(13))
    d.text((106, 250), '环境提示块移到这里\n（避开带名标签）', fill=C_AMBER, font=F(12))
    # ---- ② 氧气条（顶部居中）----
    bx, by, bw, bh = (W - 420) / 2, 26, 420, 20
    box(d, bx, by, bw, bh, C_CYAN_HI, '氧气条')
    # ---- ③ 波次进度 ----
    box(d, 880, by, 130, 116, C_DIM, '波次 / 倒计时')
    # ---- ③b 鱼情雷达（RR=88 @ W−110 / 198）----
    circle(d, W - 110, 198, 88, C_CYAN, '鱼情雷达 R88', fill=(20, 44, 60))
    # ---- ④ 鱼骨 / 生物质 ----
    box(d, W - 113, 52, 74, 26, C_AMBER, '鱼骨')
    box(d, W - 24 - 99, 22, 99, 28, C_JADE, '生物质')
    # ---- ④ 暂停键（右下）----
    box(d, W - 46 - 23, H - 27 - 23, 46, 46, C_RED, '暂停', fill=(60, 30, 36))
    # ---- ⑤ 装备槽 · 座圈（88×52，gap 100）----
    for i in range(6):
        box(d, SEAT_X0 + i * SEAT_GAP, SEAT_Y, SEAT_W, SEAT_H, C_CYAN, f'槽{i + 1}')
    d.text((SEAT_X0, SEAT_Y - 16), '座圈 n/6', fill=C_CYAN, font=F(13))
    # ---- ⑥ 遗物槽（rs=34 / rgap=40，右端 W−92）----
    rx0 = W - 92 - 6 * 40 + (40 - 34)
    for i in range(6):
        box(d, rx0 + i * 40, H - 50 + 5, 34, 34, C_AMBER, '')
    d.text((rx0, H - 50 - 20), '遗物槽 ×6（右端让到 W−92）', fill=C_AMBER, font=F(13))
    # ---- ⑦ 技能冷却（底部中，r=20 @ W/2）----
    circle(d, W / 2, H - 50 + 22, 20, C_CYAN_HI, '空格')

    # 关键间隙：6 座右端 ↔ 冷却环左缘
    seat_end = SEAT_X0 + 5 * SEAT_GAP + SEAT_W
    cd_left = W / 2 - 20
    d.line([(seat_end, SEAT_Y - 6), (seat_end, SEAT_Y + SEAT_H + 6)], fill=C_RED, width=2)
    d.line([(cd_left, SEAT_Y - 6), (cd_left, SEAT_Y + SEAT_H + 6)], fill=C_RED, width=2)
    d.line([(seat_end, SEAT_Y + SEAT_H + 16), (cd_left, SEAT_Y + SEAT_H + 16)], fill=C_RED, width=2)
    d.text(((seat_end + cd_left) / 2 - 60, SEAT_Y + SEAT_H + 20),
           f'{int(cd_left - seat_end)}px 余量', fill=C_RED, font=F(14))

    d.text((10, 4),
           'V6.78 HUD 布局：鱼情雷达 R88 @ W−110,198 / 座圈槽 88×52 gap100 / 遗物 rgap40 rs34',
           fill=C_DIM, font=F(14))
    return img


# ---------------------------------------------------------------------------
# 座圈模式
# ---------------------------------------------------------------------------
def draw_seat_row(img, weapons, ext_flags, timers, x0=None, y0=None, label=None):
    """按 Hud.ts ⑤ 的算式画一排座圈槽（含真立绘）。`weapons` 里的 None = 空槽。

    ⚠️ `y0` 必须能覆盖：整屏布局用 `SEAT_Y`（= H−56），而裁成一条 60px 高的条带时
       必须传条带内的 y —— 否则整排画在条带外面，出来的是一张空图（踩过一次）。
    """
    d = ImageDraw.Draw(img)
    x0 = SEAT_X0 if x0 is None else x0
    y0 = SEAT_Y if y0 is None else y0
    for i, wid in enumerate(weapons):
        sx = x0 + i * SEAT_GAP
        ext = ext_flags[i] if i < len(ext_flags) else False
        col = WEAPON_COL.get(wid, C_LINE) if wid else C_LINE

        # 卡体
        d.rounded_rectangle([sx, y0, sx + SEAT_W, y0 + SEAT_H], radius=9,
                            fill=blend(C_PANEL_HI if wid else C_PANEL, C_BG, 0.9 if wid else 0.55))
        ax, ay, aw, ah = sx + ART_INSET, y0 + ART_INSET, SEAT_W - 8, SEAT_H - 12

        if not wid:
            d.rounded_rectangle([sx, y0, sx + SEAT_W, y0 + SEAT_H], radius=9,
                                outline=C_LINE)
            d.rounded_rectangle([ax, ay, ax + aw, ay + ah], radius=7,
                                fill=blend(C_ABYSS, C_BG, 0.22))
            tw = d.textlength(str(i + 1), font=F(15))
            d.text((ax + aw / 2 - tw / 2, ay + ah / 2 - 8), str(i + 1), fill=(77, 107, 124), font=F(15))
            continue

        d.rounded_rectangle([sx, y0, sx + SEAT_W, y0 + SEAT_H], radius=9,
                            outline=col, width=3 if ext else 2)
        # 立绘窗
        d.rounded_rectangle([ax, ay, ax + aw, ay + ah], radius=7,
                            fill=blend(C_ABYSS, C_BG, 0.55))
        # putArt：fw = aw−4, fh = ah−2
        paste_art(img, ax + aw / 2, ay + ah / 2, aw - 4, ah - 2, wid)
        d.rounded_rectangle([ax, ay, ax + aw, ay + ah], radius=7, outline=blend(col, C_BG, 0.35))
        # 冷却条
        if timers[i] > 0:
            cbx, cby, cbw = sx + 6, y0 + SEAT_H - 5, SEAT_W - 12
            d.rounded_rectangle([cbx, cby, cbx + cbw, cby + 3], radius=1.5,
                                fill=blend(C_ABYSS, C_BG, 0.85))
            d.rounded_rectangle([cbx, cby, cbx + max(2, cbw * timers[i]), cby + 3], radius=1.5,
                                fill=blend(col, C_BG, 0.95))
        # 等级点
        lvl = min(5, 1 + i % 5)
        for k in range(5):
            px, py = ax + 5 + k * 6, ay + ah - 7
            if k < lvl:
                d.rectangle([px, py, px + 4, py + 4], fill=blend(col, C_BG, 1.0))
            else:
                d.rectangle([px, py, px + 4, py + 4], outline=blend(C_LINE, C_BG, 0.45))
        # 扩容角标
        if ext:
            d.rounded_rectangle([ax + aw - 17, ay + 2, ax + aw - 2, ay + 18], radius=4,
                                fill=blend(C_ABYSS, C_BG, 0.6))
            d.rectangle([ax + aw - 14, ay + 4, ax + aw - 7, ay + 8], fill=C_AMBER)
            d.rectangle([ax + aw - 14, ay + 10, ax + aw - 7, ay + 14], fill=C_AMBER)

    if label:
        d.text((x0, y0 - 16), label, fill=C_CYAN, font=F(15))


SEAT_SCENES = [
    ('A  开局 · 1 台（声呐）', ['sonar', None, None, None], [False] * 4, [0.0] * 4),
    ('B  满编 4 台 / 含 1 台冷却中', ['gun', 'torpedo', 'arc', 'harpoon'],
     [False, False, False, False], [0.0, 0.55, 0.0, 0.0]),
    ('C  挂载扩容到 6 座（右端必须不撞冷却环）',
     ['echo', 'acid', 'net', 'sonar_rs', 'gun_gl', 'lure'],
     [False, True, False, False, False, False], [0.0, 0.0, 0.7, 0.0, 0.3, 0.0]),
]


def draw_seats():
    pad, gapy = 12, 24
    strip_h = SEAT_H + 10
    rows_y = 40
    rows_h = len(SEAT_SCENES) * (strip_h + 20 + gapy) - gapy
    z = 3
    zoom_src_h = strip_h
    zoom_h = zoom_src_h * z
    ref_h = 44
    ch = rows_y + rows_h + gapy + zoom_h + 26 + ref_h + 16
    img = Image.new('RGB', (W, ch), (10, 26, 34))
    d = ImageDraw.Draw(img)
    d.text((pad, 8), 'SEAT SLOTS = LAUNCHER ART   (V6.78 · item_<id>.png, the same image the shop card uses)',
           fill=(150, 230, 250), font=F(17))

    y = rows_y
    for title, wps, exts, tms in SEAT_SCENES:
        d.text((pad, y), title, fill=(255, 220, 120), font=F(15))
        strip = Image.new('RGB', (W, strip_h), C_BG)
        draw_seat_row(strip, wps, exts, tms, x0=SEAT_X0 - 8, y0=5)
        # 6 座那一行把冷却环也画上，直接验"会不会撞"（右端 612 vs 环左缘 632）
        if len(wps) == 6:
            sd = ImageDraw.Draw(strip)
            cx = W / 2
            sd.ellipse([cx - 20, 5, cx + 20, 45], outline=C_CYAN, width=2)
            tw = sd.textlength('空格', font=F(13))
            sd.text((cx - tw / 2, 16), '空格', fill=C_CYAN_HI, font=F(13))
        img.paste(strip, (0, y + 20))
        y += strip_h + 20 + gapy

    # 3× 放大（只看前两台：枪族 / 鱼雷族，含一台冷却中）
    src = Image.new('RGB', (SEAT_GAP * 2, strip_h), C_BG)
    draw_seat_row(src, ['gun', 'torpedo'], [False, False], [0.0, 0.55], x0=4, y0=5)
    big = src.resize((src.width * z, src.height * z), Image.NEAREST)
    img.paste(big, (pad, y))
    d.text((pad + big.width + 16, y + 8),
           '3× 放大：枪族 / 鱼雷族\n立绘窗 80×40 = 2:1\n等级点在窗左下内侧（立绘那个角落是透明的）',
           fill=(160, 200, 220), font=F(14))

    # 实机参考（改前：46×46 方槽 + 矢量弹体图标）
    ref = os.path.join(os.path.expanduser('~'), '.workbuddy', 'clipboard-images',
                       'clipboard-2026-10-15T08-08-20-804Z-8a14fc0f.png')
    ry = y + zoom_h + 26
    if os.path.isfile(ref):
        r = Image.open(ref).convert('RGB').crop((18, 36, 236, 80))
        img.paste(r, (pad, ry))
        d.text((pad + r.width + 16, ry + 6),
               '改前（用户实机截图）：46×46 方槽 + 矢量弹体图标', fill=(255, 160, 150), font=F(14))
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if '--seats' in sys.argv:
        img = draw_seats()
        p = os.path.join(OUT_DIR, 'hud_seats.png')
    else:
        img = draw_layout('--only' not in sys.argv)
        p = os.path.join(OUT_DIR, 'hud_layout.png')
    img.save(p)
    print('已出图:', p, img.size)


if __name__ == '__main__':
    main()
