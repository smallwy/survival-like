#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
战斗 HUD **布局**预览（V6.57）。

干什么用
--------
用户 2026-10-14 两条反馈都是**位置/尺寸**问题（"鱼情图小了点"、"退出暂停的可以放在
右下角"）。这类改动在实机里核对成本高（要开 Creator + 跑一局 + 盯着角落），
而它的正确性判据只有一条：**各信息块之间有没有重叠 / 有没有越界**。
把布局按坐标画出来，一眼可查。

它**不画**任何细节（图标、文字、雷达点位），只画**占位框 + 名称**。
要看的不是"好不好看"，是"站哪儿、多大、撞不撞"。

⚠️ 坐标必须与 `cocos/assets/scripts/view/Hud.ts` 的 `drawCombat()` 同步。

用法
----
    python tools/preview_hud.py            # 新布局 + 旧位置虚线对照
    python tools/preview_hud.py --only     # 只画新布局

输出 `docs/shots/hud_layout.png`。
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1304, 749
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'shots')

C_BG = (8, 24, 36)
C_PANEL = (28, 58, 74)
C_PANEL_HI = (46, 96, 118)
C_CYAN = (79, 232, 255)
C_CYAN_HI = (200, 248, 255)
C_DIM = (110, 150, 165)
C_AMBER = (255, 209, 102)
C_RED = (255, 96, 110)
C_JADE = (127, 255, 212)

_F = {}


def F(size):
    if size not in _F:
        try:
            _F[size] = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)
        except Exception:
            _F[size] = ImageFont.load_default()
    return _F[size]


def box(d, x, y, w, h, col, label, a_label=True, fill=None, dash=False):
    """画一个占位框（x/y 为**左上角**）+ 名称。"""
    if fill:
        d.rectangle([x, y, x + w, y + h], fill=fill)
    if dash:
        # 虚线（PIL 没有原生虚线，手工画短段）
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


def draw(show_old):
    img = Image.new('RGB', (W, H), C_BG)
    d = ImageDraw.Draw(img)

    # ---- 旧位置（虚线对照）----
    if show_old:
        circle(d, W - 88, 164, 52, (110, 70, 90), '旧 雷达 R52')
        d.rectangle([W - 32 - 19, 30 - 19, W - 32 + 19, 30 + 19], outline=(110, 70, 90), width=2)
        d.text((W - 130, 56), '旧 暂停键', fill=(110, 70, 90), font=F(13))

    # ---- ① 深度指示（左上）----
    box(d, 24, 22, 210, 200, C_CYAN, '深度指示 / 层刻度 / 氧耗')
    # ---- ② 氧气条（顶部居中）----
    bx, by, bw, bh = (W - 420) / 2, 26, 420, 20
    box(d, bx, by, bw, bh, C_CYAN_HI, '氧气条')
    # ---- ③ 波次进度 ----
    box(d, 880, by, 130, 116, C_DIM, '波次 / 倒计时')
    # ---- ③b 鱼情雷达（V6.57 放大）----
    circle(d, W - 86, 174, 64, C_CYAN, '鱼情雷达 R64', fill=(20, 44, 60))
    # ---- ④ 鱼骨 / 生物质 ----
    # 鱼骨：圆 (W−106, bY+8) r7 + 数字从 W−88 起；bY = 26+26（mult=1）
    box(d, W - 113, 52, 74, 26, C_AMBER, '鱼骨')
    # 生物质：**右对齐到 W−24** 的文字（宽约 99px，两行 26~78），不是固定宽框
    box(d, W - 24 - 99, 22, 99, 28, C_JADE, '生物质')
    # ---- ④ 暂停键（右下，V6.57 移来）----
    box(d, W - 46 - 23, H - 27 - 23, 46, 46, C_RED, '暂停', fill=(60, 30, 36))
    # ---- ⑤ 装备槽（底部左）----
    for i in range(6):
        box(d, 24 + i * 52, H - 50, 46, 46, C_CYAN, f'{i+1}' if i < 3 else '', a_label=i < 3)
    # ---- ⑥ 遗物槽（底部右，V6.57 左移）----
    rx0 = W - 92 - 6 * 36 + (36 - 30)
    for i in range(6):
        box(d, rx0 + i * 36, H - 50 + 7, 30, 30, C_AMBER, '')
    d.text((rx0, H - 50 - 20), '遗物槽 ×6（右端让到 W−92）', fill=C_AMBER, font=F(13))
    # ---- ⑦ 技能冷却（底部中）----
    circle(d, W / 2, H - 50 + 22, 20, C_CYAN_HI, '空格')

    # 关键间隙标注
    d.line([(W - 92, H - 60), (W - 69, H - 60)], fill=C_RED, width=2)
    d.text((W - 92, H - 78), '23px', fill=C_RED, font=F(13))
    d.text((10, H - 22), 'V6.57 HUD 布局：雷达 R52→64 / 暂停键 右上→右下（46×46） / 遗物槽右端 W−24→W−92',
           fill=C_DIM, font=F(14))
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only = '--only' in sys.argv
    img = draw(not only)
    p = os.path.join(OUT_DIR, 'hud_layout.png')
    img.save(p)
    print('已出图:', p, img.size)


if __name__ == '__main__':
    main()
