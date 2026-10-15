#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""量若干张 env 图的"鱼密度"（条数 + 条/百万像素）。

⚠️ **必须复用 `thin_fish.detect`**（严判口径）—— 判据散在两个文件里各写一份，
就会出现"工具说对齐了、量出来还差 8倍"的自相矛盾（V6.69 实测 L1：241 团 vs 539 条）。
**单一真源 = `thin_fish.detect()`**，改判据只改那一个函数。

用法：
    python tools/measure_fish.py cocos/assets/resources/env/L*.png docs/shots/env_v2/L4*.png
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import thin_fish as T          # noqa: E402


def measure(path: str, verbose: bool = False) -> tuple[int, float, float]:
    """返回 (鱼条数, 条/百万像素, 画布宽高)。"""
    im = Image.open(path).convert('RGB')
    rgb = __import__('numpy').asarray(im, dtype='float32')
    comps, *_ = T.detect(rgb, verbose=verbose)
    n = len(comps)
    mp = im.size[0] * im.size[1] / 1e6
    return n, n / mp, mp


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    warn_if_lossy(argv)
    print(f'{"图":52s} {"鱼条数":>8s}{"条/百万px":>12s}{"画布":>14s}')
    for p in argv:
        n, per, mp = measure(p)
        im = Image.open(p)
        print(f'{p:52s} {n:8d}{per:12.1f}{f"{im.size[0]}x{im.size[1]}":>14s}')
    return 0


def warn_if_lossy(paths: list[str]) -> None:
    """⚠️ **密度判据只能对 PNG 跑**。

    webp 是有损编码：q=95 下也有 0.06% 像素偏差 >8（均值 1.86）——
    肉眼不可见，但 `detect()` 的阈值只有 7，会把这些编码噪声**当成小鱼**检出
    （V6.69 实测 L4：PNG 60 条 vs 同一张图的 webp 84 条）。
    对着 webp 复核密度 = 拿噪声当鱼，结论必然偏多。
    """
    bad = [p for p in paths if p.lower().endswith(('.webp', '.jpg', '.jpeg'))]
    if bad:
        print(f'[警告] 下列是有损格式，鱼密度会偏高，别用来判定：{", ".join(bad)}')


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))