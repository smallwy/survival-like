#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""立绘后处理：抠背景 -> 去水印 -> 裁切缩放成 256x256 透明 PNG。

为什么需要它
------------
生成模型给出的立绘是**带背景**的（哪怕请求了 transparent，模型也常铺一层
浅色渐变），右下角还会带平台水印。而游戏里的立绘是叠在深色卡片/HUD 上的，
带背景会变成一块方块。所以必须抠干净。

为什么不用简单色键
------------------
"把浅色都变透明"会把**剑刃/脸部高光**一起吃掉。这里用**从边框泛洪**
（flood fill）：只清除与画面边缘连通的浅色区域，被深色描边包住的内部
浅色（脸、剑）不会被误伤 —— 前提是角色有闭合的深色描边，而 chibi 立绘
恰好都有。

用法
----
python tools/clean_portrait.py <输入图> <输出图> [--erase x0,y0,x1,y1]
  --erase 可多次给出，用来抹掉右下角水印（归一化 0~1 坐标）。
"""
import sys
import argparse
from collections import deque

import numpy as np
from PIL import Image

OUT_SIZE = 256
CONTENT = 236          # 角色在 256 画布里的目标最长边
TOL = 16               # 相邻像素最大单通道差；超过即视为"边缘"、停止扩张


def flood_clear_bg(img: Image.Image, tol: int = TOL) -> Image.Image:
    """从画面四边泛洪，清除背景。

    **按相邻像素的色差扩张，而不是按固定的"浅色阈值"**。
    生成图的背景是渐变 + 有噪点，用硬阈值会出现"有些背景像素差一点没过线"
    的横向残影（第一版就是这个毛病）。比较相邻像素则能顺着渐变一路走过去，
    遇到角色那条闭合的深色描边（色差突然变大）就停下 —— 于是脸/剑这些
    **被描边包住的浅色内部**不会被误伤。
    """
    a = np.array(img.convert('RGBA')).astype(np.int16)
    h, w, _ = a.shape
    rgb = a[:, :, :3]
    visited = np.zeros((h, w), dtype=bool)

    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not visited[y, x]:
                visited[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x]:
                visited[y, x] = True
                dq.append((y, x))

    while dq:
        y, x = dq.popleft()
        cur = rgb[y, x]
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if int(np.abs(rgb[ny, nx] - cur).max()) <= tol:
                    visited[ny, nx] = True
                    dq.append((ny, nx))

    a[:, :, 3] = np.where(visited, 0, a[:, :, 3])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def erase_regions(img: Image.Image, regions):
    """把给定的归一化矩形区域整块抹成透明（去水印）。"""
    a = np.array(img)
    h, w, _ = a.shape
    for (x0, y0, x1, y1) in regions:
        a[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w), 3] = 0
    return Image.fromarray(a, 'RGBA')


def fit_center(img: Image.Image, out: int = OUT_SIZE, content: int = CONTENT) -> Image.Image:
    """按内容包围盒裁切，等比缩放到 content 内，居中贴到 out×out 透明画布。"""
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    s = content / max(w, h)
    img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (out, out), (0, 0, 0, 0))
    canvas.paste(img, ((out - img.width) // 2, (out - img.height) // 2), img)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--erase', action='append', default=[],
                    help='归一化矩形 x0,y0,x1,y1，可多次')
    ap.add_argument('--out-size', type=int, default=OUT_SIZE)
    args = ap.parse_args()

    regions = []
    for e in args.erase:
        parts = [float(v) for v in e.split(',')]
        if len(parts) == 4:
            regions.append(tuple(parts))

    img = Image.open(args.src).convert('RGBA')
    img = flood_clear_bg(img)
    if regions:
        img = erase_regions(img, regions)
    img = fit_center(img, args.out_size)

    # 统计：透明像素占比，作为"抠干净了没"的量化指标
    arr = np.array(img)
    clear = float((arr[:, :, 3] < 8).mean())
    img.save(args.dst)
    print(f'written {args.dst}  size={img.size}  透明占比={clear:.1%}')


if __name__ == '__main__':
    main()
