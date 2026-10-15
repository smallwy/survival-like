#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
出图后的**固定工序**脚本：去水印 → 转 webp → 出实机 cover 预览 → 打印验收数字。

为什么必须固定成脚本（小汪 2026-10-15 明确要求）：
  **提示词压不住模型自带的角标水印** —— 实测在提示词里写明「无水印/无签名/无边框」，
  出图仍带右下角角标，说明那是**后处理加的**。所以「生成 → 本地修水印 → 交付」
  是一条固定链路，修水印不是可选项，也不能靠"下次提示词写好点"绕过。

用法：
    python tools/prep_shot.py <输入图> [--out <输出前缀>] [--name L2]
    # 例：python tools/prep_shot.py docs/shots/env_draft/xxx.png --name L2
    # 产物：<前缀>.png（已修水印）/ <前缀>.webp / <前缀>_ingame.png（1304x749 cover）

设计分辨率取自项目既有规格：1304x749 / fitHeight。
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from PIL import Image, ImageFilter

DESIGN_W, DESIGN_H = 1304, 749
LUMA_CUT = 90
LUMA_MIN_PCT = 6.0
SEAM_MAX = 14.0


def kill_watermark(im: Image.Image,
                   box_frac=(0.855, 0.915, 1.0, 1.0)) -> Image.Image:
    """
    用**同一 y 区间左侧的同尺寸图块**盖住右下角水印，边缘羽化。

    ⚠️ 只对「低纹理区域」有效（水下、天空、纯色底）。纹理复杂的画面上盖一块会露馅，
       那时应改为裁剪或让模型重出。
    """
    W, H = im.size
    x0, y0 = int(W * box_frac[0]), int(H * box_frac[1])
    x1, y1 = int(W * box_frac[2]), int(H * box_frac[3])
    bw, bh = x1 - x0, y1 - y0
    if bw <= 0 or bh <= 0:
        return im
    src = im.crop((x0 - bw, y0, x0, y1)).resize((bw, bh))
    mask = Image.new('L', (bw, bh), 255).filter(ImageFilter.GaussianBlur(6))
    out = im.copy()
    out.paste(src, (x0, y0), mask)
    return out


def stats(im: Image.Image) -> dict:
    g = im.convert('L')
    w, h = g.size
    hist = g.histogram()
    tot = sum(hist)
    bright = sum(hist[LUMA_CUT + 1:])
    top = sum(g.crop((0, 0, w, 1)).tobytes()) / w
    bot = sum(g.crop((0, h - 1, w, h)).tobytes()) / w
    return {
        'size': (w, h),
        'pct': 100.0 * bright / tot,
        'mean': sum(i * c for i, c in enumerate(hist)) / tot,
        'seam': abs(top - bot),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', default=None, help='输出前缀（不含扩展名）')
    ap.add_argument('--name', default=None, help='日志里显示的名字，如 L2')
    ap.add_argument('--no-wm', action='store_true', help='跳过修水印')
    a = ap.parse_args()

    p = Path(a.src)
    if not p.exists():
        print(f'找不到输入图：{p}', file=sys.stderr)
        return 2

    im = Image.open(p).convert('RGB')
    raw = im.copy()
    if not a.no_wm:
        im = kill_watermark(im)

    out = Path(a.out) if a.out else p.with_name(p.stem + '_clean')
    im.save(out.with_suffix('.png'))
    im.save(out.with_suffix('.webp'), quality=82, method=6)

    # 实机 cover 预览（设计分辨率）
    W, H = im.size
    s = max(DESIGN_W / W, DESIGN_H / H)
    nw, nh = int(W * s + 0.5), int(H * s + 0.5)
    big = im.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - DESIGN_W) // 2, (nh - DESIGN_H) // 2
    big.crop((left, top, left + DESIGN_W, top + DESIGN_H)).save(out.with_name(out.stem + '_ingame.png'))

    s2 = stats(im)
    tag = a.name or p.stem
    print(f'[{tag}] 画布 {s2["size"][0]}x{s2["size"][1]}'
          f' | 亮于{LUMA_CUT} {s2["pct"]:.2f}% (>={LUMA_MIN_PCT}%)'
          f' | 均值 {s2["mean"]:.1f}'
          f' | 首末行差 {s2["seam"]:.1f} (<= {SEAM_MAX})'
          f' | webp {os.path.getsize(out.with_suffix(".webp")) / 1048576:.2f}MB')
    print(f'      判据：亮度 {"PASS" if s2["pct"] >= LUMA_MIN_PCT else "FAIL"}'
          f' | 无缝 {"PASS" if s2["seam"] <= SEAM_MAX else "FAIL"}')
    print(f'      -> {out.with_suffix(".png")}')
    print(f'      -> {out.with_suffix(".webp")}')
    print(f'      -> {out.with_name(out.stem + "_ingame.png")}')
    # 未修的原图另存，便于追溯
    if not a.no_wm:
        p.with_name(p.stem + '_raw.png').write_bytes(p.read_bytes())
    del raw
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
