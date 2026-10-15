#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
环境图的**曝光补偿**（不是调色）：把暗带拉到一个"压暗层吃掉一半之后还看得见"的水位。

为什么必须做这一道：
  渲染层有一层压暗（`drawVeil`），实测**吃掉一半亮度**（V6.59：L4 均值 40.5 → 20.1）。
  env 图是按"最终要进游戏"用的 ⇒ 出图时不能按"我在看图"的标准配曝光，
  得按**被压暗之后**的标准配。

做法：`out = 255 · (x)^(1/g)`（逐通道）。单调曲线 ⇒ **色相不变**；
  只提亮暗部与中间调、白点保持 255 ⇒ 荧光与热泉亮芯不会过曝成白块。

用法：python tools/brighten_env.py <图> --gamma 1.3 --out <输出前缀>
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

LUMA_CUT = 90


def luma_pct(im: Image.Image, cut=LUMA_CUT) -> float:
    h = im.convert('L').histogram()
    return 100.0 * sum(h[cut + 1:]) / sum(h)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--gamma', type=float, default=1.3, help='>1 提亮')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    im = Image.open(a.src).convert('RGB')
    before = luma_pct(im)
    g = a.gamma
    lut = [min(255, round(255 * (i / 255.0) ** (1.0 / g))) for i in range(256)]
    out = im.point(lut * 3)
    after = luma_pct(out)

    p = Path(a.out)
    out.save(p.with_suffix('.png'))
    out.save(p.with_suffix('.webp'), quality=82, method=6)
    mean_b = sum(i * c for i, c in enumerate(im.convert('L').histogram())) / (im.width * im.height)
    mean_a = sum(i * c for i, c in enumerate(out.convert('L').histogram())) / (out.width * out.height)
    print(f'{p.stem}: gamma {g:.2f} | 亮于90 {before:.2f}% -> {after:.2f}% | 均值 {mean_b:.1f} -> {mean_a:.1f}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
