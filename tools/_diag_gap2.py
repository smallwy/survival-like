"""对比「改前 / 改后」的连通块与间隙（V6.90 splitter 修正）。

用法：<python> tools/_diag_gap2.py <旧png> <新png>
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def blocks(mask):
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    out = []
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and not seen[sy, sx]:
                q = deque([(sx, sy)])
                seen[sy, sx] = True
                n = 0
                x0 = x1 = sx
                y0 = y1 = sy
                while q:
                    x, y = q.popleft()
                    n += 1
                    x0 = min(x0, x); x1 = max(x1, x)
                    y0 = min(y0, y); y1 = max(y1, y)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((nx, ny))
                out.append((n, x0, y0, x1, y1))
    out.sort(reverse=True)
    return out


def report(tag, p):
    im = Image.open(p).convert('RGBA')
    a = np.array(im.getchannel('A'))
    m = a > 8
    tot = int(m.sum())
    bl = blocks(m)
    w, h = im.size
    print(f'\n=== {tag}  {os.path.basename(p)}  {im.size} ===')
    print(f'  透明率 {100*(1-tot/m.size):.1f}%  连通块 {len(bl)} 个')
    b0 = bl[0]
    print(f'  主块 面积 {b0[0]} ({100*b0[0]/tot:.1f}%) 宽 {b0[3]-b0[1]+1}')
    # 面积 >0.5% 的块
    big = [b for b in bl if b[0] / tot >= 0.005]
    for i, (n, x0, y0, x1, y1) in enumerate(bl[:6]):
        print(f'   #{i+1} {n:6d} ({100*n/tot:5.1f}%) x[{x0:3d},{x1:3d}] y[{y0:3d},{y1:3d}]')
    if len(bl) > 6:
        print(f'   ... 另 {len(bl)-6} 个小块（合计 {sum(b[0] for b in bl[6:])} px）')
    print(f'  ** 主体块面积占比 = {100*b0[0]/tot:.1f}%（判据：单主体族 ≥70%）')
    if len(bl) >= 2:
        b1 = bl[1]
        if b0[1] <= b1[1]:
            gap = b1[1] - b0[3] - 1
        else:
            gap = b0[1] - b1[3] - 1
        print(f'  ** 主块→次块水平间隙 = {gap}px（判据：≤10px）')
    col = m.sum(axis=0)
    empty = np.where(col == 0)[0]
    if len(empty):
        runs = []
        s = prev = empty[0]
        for x in empty[1:]:
            if x != prev + 1:
                runs.append((int(s), int(prev)))
                s = x
            prev = x
        runs.append((int(s), int(prev)))
        inner = [r for r in runs if r[0] > 0 and r[1] < w - 1]
        print(f'  内部空列段: {inner}')
    # 连丝区域：主块右缘与次块左缘之间的非空像素
    if len(bl) >= 2:
        b1 = bl[1]
        l, r = (b0[3], b1[1]) if b0[1] <= b1[1] else (b1[3], b0[1])
        strip = m[:, l+1:r]
        print(f'  间隙带内像素 = {int(strip.sum())} px（这就是"连丝"的总量）')
    return bl


if __name__ == '__main__':
    old, new = sys.argv[1], sys.argv[2]
    report('改前', old)
    report('改后', new)
