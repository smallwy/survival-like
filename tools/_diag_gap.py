"""诊断 splitter / shard 的"中间断开"。

输出：连通块数、各块 bbox、块间最小间隙、断开处的列宽曲线。
不依赖 scipy（手写 4-邻接 flood fill）。
"""
import sys, os
from collections import deque
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FISH = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'fish')


def blocks(mask):
    """4-连通域标注，返回 [(area, x0,y0,x1,y1), ...] 按面积降序。"""
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
                    if x < x0: x0 = x
                    if x > x1: x1 = x
                    if y < y0: y0 = y
                    if y > y1: y1 = y
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((nx, ny))
                out.append((n, x0, y0, x1, y1))
    out.sort(reverse=True)
    return out


def report(name):
    p = os.path.join(FISH, name + '.png')
    im = Image.open(p).convert('RGBA')
    a = np.array(im.getchannel('A'))
    m = a > 8
    w = im.size[0]
    print(f'\n=== {name}  画布 {im.size} ===')
    bl = blocks(m)
    tot = m.sum()
    print(f'  连通块 {len(bl)} 个 · 不透明像素 {tot} ({100*tot/m.size:.1f}%)')
    for i, (n, x0, y0, x1, y1) in enumerate(bl[:8]):
        print(f'   #{i+1} 面积 {n:6d} ({100*n/tot:5.1f}%)  bbox x[{x0:3d},{x1:3d}] y[{y0:3d},{y1:3d}]  宽{x1-x0+1:3d} 高{y1-y0+1:3d}')
    if len(bl) > 8:
        print(f'   ... 另 {len(bl)-8} 个小块')
    # 主块与第二大块之间的水平间隙
    if len(bl) >= 2:
        b0, b1 = bl[0], bl[1]
        # 按 x 排序判断左右关系
        if b0[1] <= b1[1]:
            gap = b1[1] - b0[3] - 1
            print(f'  主块右缘 x={b0[3]}  次块左缘 x={b1[1]}  => 水平间隙 {gap}px '
                  f'(主块宽 {b0[3]-b0[1]+1})  间隙/主块宽 = {100*gap/(b0[3]-b0[1]+1):.1f}%')
        else:
            gap = b0[1] - b1[3] - 1
            print(f'  次块右缘 x={b1[3]}  主块左缘 x={b0[1]}  => 水平间隙 {gap}px')
        # 重心偏移
        cx_all = (m * np.arange(w)[None, :]).sum() / tot
        cy_all = (m * np.arange(m.shape[0])[:, None]).sum() / tot
        cx0 = (b0[3] + b0[1]) / 2
        cx1 = (b1[3] + b1[1]) / 2
        print(f'  全图重心 x={cx_all:.1f} ({100*cx_all/w:.1f}%) · 主块中心 x={cx0:.1f} · 次块中心 x={cx1:.1f}')
    # 列向覆盖曲线（找出空列）
    col = m.sum(axis=0)
    empty = np.where(col == 0)[0]
    if len(empty):
        # 找连续的空白段
        runs = []
        s = empty[0]
        prev = empty[0]
        for x in empty[1:]:
            if x != prev + 1:
                runs.append((s, prev))
                s = x
            prev = x
        runs.append((s, prev))
        inner = [r for r in runs if r[0] > 0 and r[1] < w - 1]
        print(f'  空列段 {len(runs)} 段（含左右留白）；内部空列段：{inner}')


if __name__ == '__main__':
    for n in (sys.argv[1:] or ['splitter', 'shard']):
        report(n)
