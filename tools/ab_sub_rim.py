#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""机体/位图素材的**改前改后对照图**（常驻工具）。

为什么常驻：交付前给用户拍板时，"改前 / 改后"必须**同框、同尺度、同背景**才有说服力；
此前每做一次就现写一个临时脚本（`hull_edge_fix` / `hull_outline_ab` / `hull_bright_ab` /
`hull_white_ab` / `emit_ab` / `base_ab` …），图留下来了但**做法没留下来**。
⇒ 统一到本脚本：`--a` 改前、`--b` 改后，输出 2 列 × N 行的对照图。

⚠️ 本脚本**只负责"摆图"**，判据仍写在各工序的 docstring 里（`prep_sub_art.de_rim()` 等）。

用法
----
  python tools/ab_sub_rim.py --a <改前.png> --b <改后.png> \
      [--a-label BEFORE] [--b-label AFTER] [--out docs/shots/hull_rim_ab.png] [--note "..."]

四行分别是：
  ① 位图**原生尺度**的躯干（1.14×）—— 位图级的差异（描边/亮环/开孔）只有这一行看得出来
  ② 艇腹剪影边 4× 近邻 —— 用户截图里下红框的位置
  ③ 1× 实机合成（L2 真实背景 + 6 门炮）—— **唯一代表实机画面**的一行
  ④ 3× 实机合成放大 —— 艏部 / 上红框的位置
"""
from __future__ import annotations

import argparse
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import preview_hull_side as P  # noqa: E402

W, H = 1304, 749                      # 设计分辨率（与 tables.ts 同源）
TRUNK_C = (204, 198)                  # 躯干中心在 408×339 画布里的坐标（= SUB_HULL 常量）


def _font(sz: int, bold: bool = False):
    for n in (('arialbd.ttf' if bold else 'arial.ttf'), 'segoeui.ttf'):
        try:
            return ImageFont.truetype('C:/Windows/Fonts/' + n, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def compose(art_path: str):
    """贴一张位图 + 6 门炮到 L2 真实背景上（复刻 `preview_hull_side.py --combat`）。

    ⚠️ 走的是 `paste_hull` / `draw_turret` 的**默认参数**（= 实机当前采纳的样式）。
       要画"改前"的样式必须**显式**传参，否则默认值一改、历史对照图自己就变了。
    """
    P.SUB_HULL_ART = art_path
    try:
        bg = Image.open(os.path.join(ROOT, 'web', 'src', 'assets', 'env', 'L2.webp')).convert('RGB')
        bg = bg.resize((W, H), Image.LANCZOS).point(lambda v: int(v * 0.55))
    except Exception:
        bg = Image.new('RGB', (W, H), P.rgb(P.C_BG))
    cx, cy = W / 2, H / 2
    P.paste_hull(bg, cx, cy, 1.0)
    d = ImageDraw.Draw(bg)
    ang = [math.degrees(math.atan2(P.SEAT_MOUNTS[i][1] * (P.HULL_H / 2),
                                   P.SEAT_MOUNTS[i][0] * (P.SUB_D / 2)))
           for i in range(len(P.SEAT_MOUNTS))]
    for i in range(len(P.SEAT_MOUNTS)):
        P.draw_turret(d, cx + P.SEAT_MOUNTS[i][0] * (P.SUB_D / 2),
                      cy + P.SEAT_MOUNTS[i][1] * (P.HULL_H / 2), ang[i], 1.0,
                      ext=(i >= 4), sgn=(-1 if P.SEAT_MOUNTS[i][1] < 0 else 1))
    return bg, cx, cy


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--a', required=True, help='改前位图')
    ap.add_argument('--b', required=True, help='改后位图')
    ap.add_argument('--a-label', default='BEFORE')
    ap.add_argument('--b-label', default='AFTER')
    ap.add_argument('--title', default='SUB ART A/B')
    ap.add_argument('--note', default='')
    ap.add_argument('--out', default='docs/shots/sub_ab.png')
    args = ap.parse_args()
    out = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)

    cell_w, cell_h, gap, head = 400, 260, 14, 66 if args.note else 44
    img = Image.new('RGB', (cell_w * 2 + gap * 3, head + 4 * (cell_h + 22) + gap), (8, 16, 22))
    d = ImageDraw.Draw(img)
    d.text((gap, 8), args.title, fill=(120, 220, 240), font=_font(21, True))
    if args.note:
        d.text((gap + 6, 31), args.note, fill=(255, 220, 120), font=_font(13))

    for c, (lab, path, col) in enumerate([
            (args.a_label, args.a, (255, 160, 150)),
            (args.b_label, args.b, (150, 240, 170))]):
        x = gap + c * (cell_w + gap)
        d.text((x, head - 17), lab, fill=col, font=_font(14, True))
        bmp = Image.open(path).convert('RGBA')
        flat = Image.new('RGB', bmp.size, (10, 30, 40))
        flat.paste(bmp, (0, 0), bmp)
        scene, cx, cy = compose(path)
        rows = [
            ('1  bitmap trunk 1.14x  -- bitmap-level diffs live here',
             flat.crop((TRUNK_C[0] - 176, TRUNK_C[1] - 114,
                        TRUNK_C[0] + 176, TRUNK_C[1] + 114)).resize((cell_w, cell_h), Image.NEAREST)),
            ('2  belly silhouette edge 4x  -- user lower box',
             flat.crop((TRUNK_C[0] - 76, TRUNK_C[1] + 70,
                        TRUNK_C[0] + 24, TRUNK_C[1] + 135)).resize((cell_w, cell_h), Image.NEAREST)),
            ('3  1x in-game composite  (L2 real bg + 6 turrets)',
             scene.crop((int(cx - cell_w / 2), int(cy - cell_h / 2),
                         int(cx + cell_w / 2), int(cy + cell_h / 2)))),
            ('4  3x in-game composite  -- bow / top box',
             scene.crop((int(cx - 67), int(cy - 43), int(cx + 67), int(cy + 43)))
                  .resize((cell_w, cell_h), Image.NEAREST)),
        ]
        for r, (lab2, im2) in enumerate(rows):
            y = head + r * (cell_h + 22)
            img.paste(im2, (x, y))
            d.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=(60, 90, 105))
            d.text((x + 4, y + cell_h + 3), lab2, fill=(190, 200, 210), font=_font(13))

    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print('已出图:', out, img.size)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
