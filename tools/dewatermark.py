#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
水印压制：去掉 AI 出图右下角的「AI生成 / WORKBUDDY」浅色角标。

为什么不能靠裁剪
----------------
角标固定在**右下角**，而那里往往正好是 UI 的关闭叉号 / 返回键所在 →
裁掉会把界面元素一起切走；`relight_bg.erase_corner` 的镜像填充也会把按钮
镜像成一份"重影"（背景图无所谓，UI 图不行）。

做法（利用水印的两个特征）
--------------------------
水印是**白色、低饱和、比局部背景亮**的文字叠加。于是：
  ① 用中值滤波估「局部背景」；
  ② 找出同时满足 `亮度显著高于背景` **且** `饱和度低` 的像素 —— 这就是水印；
  ③ 把这些像素拉回背景值，其余像素（青色描边、按钮、发光）一律不动。

判据里的"低饱和"是关键：UI 的霓虹描边是 #4fe8ff 这类高饱和青（sat≈0.69），
不会被误伤；而水印是灰白（sat≈0.05）会被吃掉。迭代若干次可压掉半透明的字缘。

用法
----
  python tools/dewatermark.py <src> --out <dst> [--box 0.84,0.88,1.0,1.0]
  python tools/dewatermark.py docs/ui_concept/screens/*.png --inplace
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def suppress(im: Image.Image, box=None, threshold: float = 0.045,
             sat_max: float = 0.32, iters: int = 3, ksize: int = 9) -> Image.Image:
    """压制 box 区域内的浅色低饱和水印。box 用归一化坐标 (x0,y0,x1,y1)。"""
    out = im.convert('RGB')
    W, H = out.size
    nx0, ny0, nx1, ny1 = box or (0.80, 0.86, 1.0, 1.0)
    x0, y0 = int(W * nx0), int(H * ny0)
    x1, y1 = int(W * nx1), int(H * ny1)

    for _ in range(iters):
        arr = np.asarray(out, dtype=np.float32) / 255.0
        bg = np.asarray(out.filter(ImageFilter.MedianFilter(size=ksize)),
                        dtype=np.float32) / 255.0
        mx = arr.max(axis=2)
        mn = arr.min(axis=2)
        sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
        L = arr @ LUMA
        Lb = bg @ LUMA

        region = np.zeros(L.shape, dtype=bool)
        region[y0:y1, x0:x1] = True
        hit = region & (L > Lb + threshold) & (sat < sat_max)
        if not hit.any():
            break
        arr[hit] = bg[hit]
        out = Image.fromarray((np.clip(arr, 0, 1) * 255.0 + 0.5).astype(np.uint8))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description='AI 出图右下角水印压制')
    ap.add_argument('srcs', nargs='+')
    ap.add_argument('--out', default=None, help='输出路径（仅单文件时有效）')
    ap.add_argument('--inplace', action='store_true', help='就地覆盖')
    ap.add_argument('--box', default='0.80,0.86,1.0,1.0',
                    help='水印所在区域，归一化 x0,y0,x1,y1')
    ap.add_argument('--threshold', type=float, default=0.045)
    ap.add_argument('--sat-max', type=float, default=0.32)
    ap.add_argument('--iters', type=int, default=3)
    args = ap.parse_args()

    box = tuple(float(v) for v in args.box.split(','))
    paths: list[str] = []
    for s in args.srcs:
        paths.extend(sorted(glob.glob(s)) or [s])

    for p in paths:
        if not os.path.exists(p):
            print(f'MISSING {p}')
            continue
        im = Image.open(p)
        out = suppress(im, box=box, threshold=args.threshold,
                       sat_max=args.sat_max, iters=args.iters)
        dst = p if args.inplace else (args.out or p)
        if not args.inplace and args.out is None:
            root, ext = os.path.splitext(p)
            dst = f'{root}_nowm{ext}'
        out.save(dst)
        # 自检：右下角是否还有"亮且不饱和"的像素
        a = np.asarray(out, dtype=np.float32) / 255.0
        H, W = a.shape[:2]
        mx = a.max(axis=2); mn = a.min(axis=2)
        sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
        L = a @ LUMA
        reg = np.zeros(L.shape, dtype=bool)
        reg[int(H * box[1]):int(H * box[3]), int(W * box[0]):int(W * box[2])] = True
        left = int((reg & (L > 0.60) & (sat < 0.20)).sum())
        print(f'{os.path.basename(p):<16} -> {dst}   残留亮白像素 {left}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
