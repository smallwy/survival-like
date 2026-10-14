#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
env 亮度诊断图：把"太黑"从数字变成**看得见的证据**。

为什么需要它
------------
V6.51 就把"每张 env 图 ≥6% 像素亮于 90"写成了红线，但**规格写了 ≠ 资源达标** ——
一直到 V6.58 实测才发现 4/5 张不合格，而这条用户反馈（"太黑了"）已经拖了好几轮。

`check_art.py` 给出数字，本脚本给出**位置**：
  "亮于 90 的像素只有 1.4%" 是抽象的；"亮部只集中在画面顶部那一条 20px 的带里" 是**可执行的改图指令**。

三列对照（每一带一行）：
  ① 原图缩略        —— 眼睛看到的
  ② 亮部遮罩        —— 亮于 90 的像素标白，其余压到近黑（阈值判定，不是审美判断）
  ③ 直方图 + 首末行 —— 亮度分布 + 上下无缝检查（wrap 时这两行会相邻）

用法：python tools/preview_env_luma.py
输出：docs/shots/env_luma.png
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / 'web' / 'src' / 'assets' / 'env'
OUT = ROOT / 'docs' / 'shots'

W = 1304
CUT = 90
TARGET_PCT = 6.0

PAGE = (10, 14, 20)
INK = (0xc8, 0xf8, 0xff)
DIM = (150, 186, 202)
BAD = (255, 100, 120)
GOOD = (120, 240, 190)
BAR_BG = (26, 34, 44)


def font(sz, bold=False):
    p = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    try:
        return ImageFont.truetype(p, sz)
    except Exception:
        return ImageFont.load_default()


def luma_pct(img: Image.Image, cut=CUT) -> float:
    h = img.convert('L').histogram()
    t = sum(h) or 1
    return sum(h[cut + 1:]) / t * 100


def main():
    files = [p for p in sorted(ENV.iterdir())
             if p.suffix.lower() in ('.png', '.webp') and p.stem.startswith('L') and len(p.stem) <= 2]
    if not files:
        print('没有 env 图')
        return 1

    THUMB_W = 360
    ROW_H = 170
    head = 76
    H = head + ROW_H * len(files) + 20
    im = Image.new('RGB', (W, H), PAGE)
    d = ImageDraw.Draw(im)

    d.text((16, 14), 'env 亮度诊断  L1-L5', fill=INK, font=font(21, True))
    d.text((16, 40), f'红线：亮于 {CUT} 的像素占比 >= {TARGET_PCT}%   ·   '
                     f'左=原图   中=亮部遮罩（亮于 {CUT} 标白，其余压到近黑）   右=亮度分布 + 首末行',
           fill=DIM, font=font(12))

    for i, p in enumerate(files):
        y0 = head + i * ROW_H
        img = Image.open(p).convert('RGB')
        w, h = img.size
        pct = luma_pct(img)
        mean = sum(k * n for k, n in enumerate(img.convert('L').histogram())) / (w * h)
        ok = pct >= TARGET_PCT

        # ① 缩略（cover 裁到 THUMB_W x ROW_H-40）
        tw, th = THUMB_W, ROW_H - 46
        s = max(tw / w, th / h)
        th1 = img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
        th1 = th1.crop(((th1.width - tw) // 2, 0, (th1.width - tw) // 2 + tw, th))
        im.paste(th1, (16, y0 + 26))
        d.rectangle([16, y0 + 26, 16 + tw, y0 + 26 + th], outline=(60, 74, 90))

        # ② 亮部遮罩
        mask = img.convert('L').point(lambda v: 255 if v > CUT else 0)
        m2 = mask.resize((tw, th), Image.BOX)
        m3 = Image.merge('RGB', (m2, m2, m2))
        x2 = 16 + tw + 12
        im.paste(m3, (x2, y0 + 26))
        d.rectangle([x2, y0 + 26, x2 + tw, y0 + 26 + th], outline=(60, 74, 90))

        # ③ 直方图（横轴 0-255，纵轴占比）
        x3 = x2 + tw + 14
        hw, hh = 300, th
        d.rectangle([x3, y0 + 26, x3 + hw, y0 + 26 + hh], fill=BAR_BG)
        hist = img.convert('L').histogram()
        tot = sum(hist) or 1
        peak = max(hist) or 1
        bars = 64
        for b in range(bars):
            lo = int(b * 256 / bars)
            hi = int((b + 1) * 256 / bars)
            v = sum(hist[lo:hi]) / tot
            bh = int((v / (peak / tot)) * (hh - 8))
            bh = max(0, min(hh - 8, bh))
            col = (240, 250, 255) if lo >= CUT else (52, 68, 86)
            d.rectangle([x3 + b * hw // bars, y0 + 26 + hh - bh, x3 + (b + 1) * hw // bars - 1, y0 + 26 + hh],
                        fill=col)
        # 阈值线
        xt = x3 + int(CUT / 256 * hw)
        d.line([(xt, y0 + 26), (xt, y0 + 26 + hh)], fill=BAD, width=1)
        d.text((xt + 3, y0 + 28), f'{CUT}', fill=BAD, font=font(10))
        d.text((x3, y0 + 26 + hh + 3), '亮度分布 0..255  （白=亮于阈值）', fill=DIM, font=font(11))

        # 首末行对比条：上=首行 下=末行
        g = img.convert('L')
        top = g.crop((0, 0, w, 1)).resize((hw, 7), Image.BOX)
        bot = g.crop((0, h - 1, w, h)).resize((hw, 7), Image.BOX)
        yb = y0 + 26 + hh + 20
        im.paste(Image.merge('RGB', (top, top, top)), (x3, yb))
        im.paste(Image.merge('RGB', (bot, bot, bot)), (x3, yb + 9))
        seam = abs(sum(tob := list(top.tobytes())) / len(tob)
                   - sum(bbs := list(bot.tobytes())) / len(bbs))
        d.text((x3, yb + 19), f'首行(上)/末行(下)  平均差 {seam:.0f}',
               fill=GOOD if seam <= 14 else BAD, font=font(11))

        # 左侧带名 + 结论
        tag = 'OK' if ok else 'FAIL'
        col = GOOD if ok else BAD
        d.text((18, y0 + 4), f'{p.stem}   {w}x{h}   {pct:5.1f}%  均亮度 {mean:5.1f}  [{tag}]',
               fill=col, font=font(14, True))
        if not ok:
            d.text((16, y0 + 26 + th + 4),
                   f'差 {TARGET_PCT - pct:.1f} 个点 —— 需要更多亮部像素，不是"整体调亮"',
                   fill=DIM, font=font(11))

    im.save(OUT / 'env_luma.png')
    print('已出图:', OUT / 'env_luma.png')
    print(f'\n{"文件":<10}{"画布":<12}{"亮>90":>8}{"均亮度":>8}   判定')
    for p in files:
        img = Image.open(p).convert('RGB')
        pct = luma_pct(img)
        m = sum(k * n for k, n in enumerate(img.convert('L').histogram())) / (img.size[0] * img.size[1])
        print(f'{p.stem:<10}{img.size[0]}x{img.size[1]:<8}{pct:7.1f}%{m:8.1f}   '
              f'{"OK" if pct >= TARGET_PCT else "FAIL"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
