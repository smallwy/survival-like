#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
海生物素材后处理：抠浅色底 → 裁到内容 → 长边缩到 512 → 存 RGBA。

为什么新写一个（而不是用 `relight_fish.py`）
--------------------------------------------
`relight_fish.py` 依赖 numpy，而本项目的构建环境**没有 numpy**（只有 PIL）。
所以这里用**纯 PIL + 逐像素 BFS** 重写「从画布四边泛洪、只清除与边缘连通的亮像素」
这一段核心逻辑，语义与 `relight_fish.py` 一致：

  · 只删与**画布边缘连通**的浅色 → 生物内部的亮部（被深色描边包住）不会被误删；
  · **保持内容原始宽高比**（游戏侧按 setDisplaySize 拉伸，压成正方形会变形）；
  · 输出**长边 512**。

与 `relight_fish.py` 的差异：
  · 用 BFS 连通域代替 numpy 的形态学膨胀（结果一致，速度慢一点，但零依赖）；
  · 额外支持**屏蔽右下角水印区**（生成模型爱在角落打水印，而它离边缘近、
    亮度又接近背景，会被泛洪当成"背景"漏掉，导致水印被裁进图里）。

用法：
    python tools/key_fish_bg.py <输入png> <输出png> [--long 512] [--no-mark] [--no-inner]

  `--no-inner` 关掉内部背景补种（回到 V6.88 之前的行为：闭合轮廓的内腔会被留下）。
"""

import os
import sys
from collections import deque

from PIL import Image, ImageFilter

# ⚠️ 判据是**与边界采样色的色距**，不是绝对亮度。
# 旧写法（`relight_fish.py`）用 `亮度 ≥ 170`，那是针对"浅灰底 1024×1024"的素材写的；
# 本轮生成的装甲鱼是**中灰底（亮度 ≈ 128）** ⇒ 亮度门槛直接失效，背景一个像素都没删掉
# （症状：抠完还是整片灰）。色距判据对底色深浅不敏感，是更稳的那一条。
DIST_MAX = 34           # 单通道平均容差
# 收缩边数（px）：把主体边缘那圈**抗锯齿半透明描边**吃掉，否则贴到深色水里会有一圈白边
ERODE = 1

# ★★ V6.88 内部背景补种 —— 修「闭合轮廓内部的底色抠不掉」。
# 症状：`orbit`（细触须绕成的**封闭环**）抠完仍有 49% 的像素是"不透明且接近浅白"，
#       环内那片背景原封不动留在图上；实机读作"一个大白盘"，36px 剪影也成了实心盘
#       ⇒ **中空这个识别特征被抠底吃掉了**（剪影看板里 `brood↔orbit` 0.736 的成因之一）。
# 根因：第一轮只泛洪**与画布四边连通**的浅色（见模块头注释），而闭合轮廓把它围在里面。
# 处置：第一轮之后，把「颜色接近背景基色、但未与边缘连通」的**大块**连通域也判为背景。
INNER_MIN_AREA_RATIO = 0.004    # 该连通域占全图的比例下限（0.4%）
# ⚠️ 下限的用途是**放过主体上的小亮点**（高光/眼点），只删真正的背景岛。
#    实测：orbit 环内岛 ≈ 40% 全图，而主体高光块 < 0.2% ⇒ 0.4% 两侧余量都够。


def key_out(img, block_mark=True, inner=True):
    """把与画布边缘连通的浅色像素置为透明。返回 RGBA 图。

    `inner=True` 时额外清除**被主体围住、与边缘不连通**的浅色块（闭合轮廓的内腔）。
    """
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()

    # 边界采样：四边中点的 5x5 均值当作背景基准色
    samples = []
    for cx, cy in ((w // 2, 1), (w // 2, h - 2), (1, h // 2), (w - 2, h // 2)):
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                x, y = min(max(cx + dx, 0), w - 1), min(max(cy + dy, 0), h - 1)
                samples.append(px[x, y][:3])
    bg = tuple(sum(c[i] for c in samples) // len(samples) for i in range(3))

    def is_bg(x, y):
        r, g, b, _ = px[x, y]
        return (abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])) <= DIST_MAX * 3

    # ---- 屏蔽水印区：把右下角一块**强制标为背景**，再让泛洪连出去 ----
    seed = deque()
    if block_mark:
        for y in range(h - 90, h):
            for x in range(w - 320, w):
                seed.append((x, y))

    # 从四边所有像素入队
    for x in range(w):
        seed.append((x, 0)); seed.append((x, h - 1))
    for y in range(h):
        seed.append((0, y)); seed.append((w - 1, y))

    vis = bytearray(w * h)
    q = deque()
    for x, y in seed:
        i = y * w + x
        if not vis[i]:
            vis[i] = 1
            q.append((x, y))

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            i = ny * w + nx
            if vis[i]:
                continue
            if is_bg(nx, ny):
                vis[i] = 1
                q.append((nx, ny))

    # ---- 第二轮：内部背景补种（V6.88，见 INNER_MIN_AREA_RATIO 的注释）----
    # 只认「颜色接近背景基色 + 未与画布边缘连通 + 面积够大」三件套；
    # 面积门槛放过主体自己的浅色高光，颜色门槛放过主体上的有色区域。
    if inner:
        area_min = max(64, int(w * h * INNER_MIN_AREA_RATIO))
        seen = bytearray(w * h)
        for y0 in range(h):
            row0 = y0 * w
            for x0 in range(w):
                i0 = row0 + x0
                if vis[i0] or seen[i0] or not is_bg(x0, y0):
                    continue
                comp = []
                dq = deque([(x0, y0)])
                seen[i0] = 1
                while dq:
                    x, y = dq.popleft()
                    comp.append(y * w + x)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if nx < 0 or ny < 0 or nx >= w or ny >= h:
                            continue
                        i = ny * w + nx
                        if vis[i] or seen[i]:
                            continue
                        if is_bg(nx, ny):
                            seen[i] = 1
                            dq.append((nx, ny))
                if len(comp) >= area_min:
                    for i in comp:
                        vis[i] = 1

    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            if not vis[row + x]:
                op[x, y] = px[x, y]

    # 边缘收缩：抗锯齿在主体外沿留了一圈"半透明浅色"，泛洪判定不到它
    # （它离底色有距离），贴到深色水里就是一圈白边。用 MinFilter 腐蚀 alpha 去掉。
    if ERODE > 0:
        a = out.getchannel('A').filter(ImageFilter.MinFilter(ERODE * 2 + 1))
        out.putalpha(a)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        print(__doc__)
        return 1
    src, dst = args[0], args[1]
    long_side = 512
    for a in sys.argv[1:]:
        if a.startswith('--long'):
            long_side = int(a.split('=')[1]) if '=' in a else long_side
    block_mark = '--no-mark' not in sys.argv
    inner = '--no-inner' not in sys.argv

    img = Image.open(src)
    got = key_out(img, block_mark, inner)

    bbox = got.getbbox()
    if bbox:
        got = got.crop(bbox)

    w, h = got.size
    s = long_side / max(w, h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    got = got.resize((nw, nh), Image.LANCZOS)

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    got.save(dst)
    # 统计（验收用）。⚠️ 用**最终尺寸**算占比 —— 缩放前的 `w/h` 已经是旧值，
    #    拿它当分母会得到一个虚低的百分比（第一版就写错了，读起来像"图是空的"）。
    fw, fh = got.size
    a = got.split()[3].histogram()
    opaque = sum(a[128:])
    # 平均亮度只统计**不透明**像素：透明处是 (0,0,0)，混进去会把均值拉黑、失去意义。
    # ⚠️ 必须逐像素配对（alpha, 亮度），不能拿两条独立的直方图拼 —— 索引对不上。
    lum_vals = got.convert('L').getdata()
    pav = list(got.getchannel('A').getdata())
    tot = s = 0
    for i, v in enumerate(lum_vals):
        if pav[i] >= 128:
            s += v; tot += 1
    mean = s / max(1, tot)
    print(f'{dst}  {got.size}  不透明像素 {opaque/max(1, fw*fh)*100:.1f}%  主体平均亮度 {mean:.0f}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
