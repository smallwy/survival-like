#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
潜航器三台立绘/机体贴图的后处理：抠掉「假透明」棋盘格底 → 裁到内容 → 补成正方形 → 缩到 512。

为什么需要它（2026-10-12）
--------------------------
ImageGen 请求 background=transparent 时**不返回真 alpha**，而是把「透明棋盘格」画进像素里
（实测三张图 alpha 全 = 255）。所以必须自己抠。

为什么不能只按「亮 + 灰」抠
---------------------------
三张的棋盘格灰度各不相同（240/224、254/232、252/230），而**刺鳐和深潜者的机体本身就是灰白色**
（装甲板 lum ≈ 240、饱和 ≈ 4），与棋盘格灰度**重叠** —— 只按颜色阈值的泛洪会从机体边缘
直接漏进机身，把整台艇吃掉。

判据（双重）：
  ① **色**：落在该图棋盘格的两个灰度之一（从四角采样得到，容差 ±7）且低饱和；
  ② **纹**：局部方差高（棋盘格是交替纹理，25px 窗口内 std > 5；机体是平坦色块，std ≈ 0）。
两者同时满足才当背景，并且**从图像四边泛洪**（只清与边缘连通的部分）。

收尾两步：
  ③ **只保留与图像中心连通的区域** —— 丢掉边缘碎屑与右下角的水印；
  ④ 裁到内容包围盒 → 补成正方形 → LANCZOS 缩到 512。
"""

import glob
import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

OUT_LONG = 512
# 输出贴图里**圆盘（机体本体）的半径**，px。三张统一成同一个值 ——
# 这样游戏里 `setScale(SUB_D / (2*SUB_ART_R))` 就能让三台的机体在屏幕上**一样大**，
# 边缘光环也永远贴着机体（不统一的话刺鳐的机体只有 33px、光环却画在 48px 处，
# 会明显浮空）。改这个值必须同步改 `web/src/config/subs.ts` 的 `SUB_ART_R`。
TARGET_R = 180


def analyze_disc(rgba: np.ndarray) -> tuple:
    """定位**圆盘（机体本体）**：中心 + 半径 + 离中心最远的实体距离。

    为什么要单独找圆盘，而不是直接用内容包围盒：
      刺鳐带楔形撞角与两侧散热鳍，包围盒被撑大，圆盘只占盒子的约 55%；
      灯艇/深潜者几乎没有突出件，圆盘占约 95%。若不归一化，三台在屏幕上
      **大小差一倍**，而且按 SUB_D 画的边缘光环会在刺鳐上明显浮空。

    方法：以画布中心为初始圆心，取「到圆心距离」的直方图峰值 = 圆盘半径
    （圆盘周长 2πr 在对应半径桶里的像素数远多于鳍片），
    再用该半径附近的**环带质心**反推圆心（环是对称的，质心即圆心），迭代两次。
    """
    m = rgba[:, :, 3] > 40
    ys, xs = np.where(m)
    h, w = m.shape
    cx, cy = w / 2.0, h / 2.0
    r = 0.0
    for _ in range(3):
        d = np.hypot(xs - cx, ys - cy)
        hist, edges = np.histogram(d, bins=np.arange(0, d.max() + 4, 3))
        lo = int(len(hist) * 0.25)
        k = lo + int(np.argmax(hist[lo:]))
        r = edges[k] + 1.5
        ann = np.abs(d - r) < 9
        if ann.sum() < 50:
            break
        cx, cy = xs[ann].mean(), ys[ann].mean()
    d = np.hypot(xs - cx, ys - cy)
    r = float(d[np.abs(d - r) < 12].mean())
    return cx, cy, r, float(d.max())


def box_mean(img: np.ndarray, r: int) -> np.ndarray:
    """半径 r 的方框均值（积分图实现，避免依赖 scipy）。"""
    h, w = img.shape
    ii = np.pad(np.cumsum(np.cumsum(img, 0), 1), ((1, 0), (1, 0)))
    ys, xs = np.arange(h), np.arange(w)
    y0, y1 = np.clip(ys - r, 0, h), np.clip(ys + r + 1, 0, h)
    x0, x1 = np.clip(xs - r, 0, w), np.clip(xs + r + 1, 0, w)
    s = ii[np.ix_(y1, x1)] - ii[np.ix_(y0, x1)] - ii[np.ix_(y1, x0)] + ii[np.ix_(y0, x0)]
    n = (y1 - y0)[:, None] * (x1 - x0)[None, :]
    return s / np.maximum(1, n)


def flood_from_border(mask: np.ndarray) -> np.ndarray:
    """从四边泛洪，返回与边框连通的区域。BFS 自写：PIL 的 floodfill 在 1024 图上
    曾经只填了 0.3% 且不报错（见 relight_fish.py 的踩坑记录），不可靠。"""
    h, w = mask.shape
    vis = np.zeros((h, w), np.uint8)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not vis[y, x]:
                vis[y, x] = 1
                dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not vis[y, x]:
                vis[y, x] = 1
                dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not vis[ny, nx]:
                vis[ny, nx] = 1
                dq.append((nx, ny))
    return vis.astype(bool)


def keep_center_component(alpha: np.ndarray) -> np.ndarray:
    """只保留与图像中心连通的不透明区域（丢弃水印、边缘碎屑）。"""
    h, w = alpha.shape
    fg = alpha > 40
    cx, cy = w // 2, h // 2
    if not fg[cy, cx]:                       # 中心可能正好落在透明处：向右扫到第一个前景
        row = np.where(fg[cy])[0]
        if row.size == 0:
            return alpha
        cx = int(row[np.argmin(np.abs(row - cx))])
    vis = np.zeros((h, w), np.uint8)
    dq = deque([(cx, cy)])
    vis[cy, cx] = 1
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and fg[ny, nx] and not vis[ny, nx]:
                vis[ny, nx] = 1
                dq.append((nx, ny))
    return np.where(vis > 0, alpha, 0).astype(np.uint8)


def checker_values(rgb: np.ndarray, lum: np.ndarray, sat: np.ndarray) -> list:
    """从四角采样，取该图棋盘格的两个灰度值。"""
    h, w = lum.shape
    k = 64
    patches = np.concatenate([
        lum[:k, :k].ravel(), lum[:k, -k:].ravel(),
        lum[-k:, :k].ravel(), lum[-k:, -k:].ravel(),
    ])
    ok = patches > 200                        # 棋盘格一定是亮的
    vals = np.round(patches[ok]).astype(int)
    if vals.size == 0:
        vals = np.round(patches).astype(int)
    uniq, cnt = np.unique(vals, return_counts=True)
    top = uniq[np.argsort(-cnt)][:6]
    # 取出现最多的值与其后与之相差 >8 的另一个值，作为棋盘两色
    v1 = int(top[0])
    v2 = None
    for v in top[1:]:
        if abs(int(v) - v1) > 8:
            v2 = int(v)
            break
    return [v1] if v2 is None else [v1, v2]


def clean(src: str) -> dict:
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    rgb = a.astype(float)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)

    cvals = checker_values(rgb, lum, sat)
    near = np.zeros(lum.shape, bool)
    for v in cvals:
        near |= np.abs(lum - v) <= 7

    # ⚠️ 判据的关键一点：**不能只看单个像素的颜色**。
    # 刺鳐 / 深潜者的机体就是灰白色（装甲板 lum≈240、饱和≈4），与棋盘格灰度**重叠**，
    # 只按颜色抠会从机体边缘漏进去、把整台艇啃掉（实测刺鳐被吃掉一半）。
    #
    # 真正的区别是**结构性**的：棋盘格在任一局部窗口里**两种灰度都出现**（交替），
    # 机体的白是**一整片同一种白**（另一种色完全不出现）。
    # 所以要求窗口内 e1、e2 两种色的占比都 > 15% 才判为背景。
    e1 = np.abs(lum - cvals[0]) <= 4
    e2 = (np.abs(lum - cvals[1]) <= 4) if len(cvals) > 1 else np.zeros(lum.shape, bool)
    b1 = box_mean(e1.astype(float), 20)
    b2 = box_mean(e2.astype(float), 20)
    striped = (b1 > 0.15) & (b2 > 0.15)

    mask = striped & (sat < 16) & (lum > 195)
    seed = flood_from_border(mask)

    # ⚠️ 只清「确实是棋盘格色」的那些像素 —— 泛洪区域边界上可能扫到机体的白
    is_bg = seed & near & (sat < 16)
    alpha = np.where(is_bg, 0, 255).astype(np.uint8)

    # 收边：吃 1px 去白边 + 轻微羽化
    am = Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    alpha = np.asarray(am)
    alpha = keep_center_component(alpha)

    out = np.dstack([a.astype(np.uint8)[:, :, :3], alpha]).astype(np.uint8)
    dcx, dcy, dr, dmax = analyze_disc(out)
    return {'rgba': out, 'v': cvals, 'disc': (dcx, dcy, dr, dmax)}


def normalize(rgba: np.ndarray, disc: tuple, side: int, target_r: int) -> Image.Image:
    """把圆盘中心挪到画布正中，并把圆盘半径缩放到 target_r（三张统一）。"""
    dcx, dcy, dr, _ = disc
    k = target_r / dr
    src = Image.fromarray(rgba, 'RGBA')
    # 先把全透明像素的 RGB 填成机体均值色：不填的话 LANCZOS 会把透明区的黑
    # 混进边缘，缩出来后机体外圈有一圈**暗边**（浅底素材尤其明显）。
    a = np.asarray(src).astype(np.float32).copy()
    op = a[:, :, 3] > 40
    if op.sum():
        a[~op, :3] = a[op, :3].mean(axis=0)
    src = Image.fromarray(a.astype(np.uint8), 'RGBA')
    nw, nh = max(1, round(src.width * k)), max(1, round(src.height * k))
    small = src.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(small, (round(side / 2 - dcx * k), round(side / 2 - dcy * k)))
    return canvas


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    regen = os.path.join(root, 'web', 'src', 'assets', 'sub', '_regen_v2')
    dest = os.path.join(root, 'web', 'src', 'assets', 'sub')
    # 按生成时间戳映射到潜航器 id：15=raia(第2次调用) 16=lumen(第1次) 17=bathy(第3次)
    tagmap = {'15': 'raia', '16': 'lumen', '17': 'bathy'}
    files = sorted(glob.glob(os.path.join(regen, '*.png')))
    if not files:
        raise SystemExit('_regen_v2 下没有生成图')

    # ---- 第一遍：抠底 + 定位圆盘 ----
    jobs = []
    for f in files:
        base = os.path.basename(f)
        key = base.rsplit('-', 1)[-1].replace('.png', '')[-2:]
        name = tagmap.get(key)
        if not name:
            print('跳过无法识别的文件:', base)
            continue
        r = clean(f)
        dcx, dcy, dr, dmax = r['disc']
        jobs.append({'name': name, 'rgba': r['rgba'], 'disc': r['disc'],
                     'v': r['v'], 'K': dmax / dr})
        print('[%-6s] 棋盘格 %s  圆盘 r=%.0f  最远实体 %.0f  突出比 K=%.2f'
              % (name, r['v'], dr, dmax, dmax / dr))

    # ---- 统一画布：让三张的圆盘半径都 = TARGET_R，且任何突出件都不出界 ----
    kmax = max(j['K'] for j in jobs)
    side = 2 * int(-(-TARGET_R * kmax * 1.05 // 2) * 2)          # 向上取到偶数
    print('画布 %d×%d  圆盘半径 %d（占画布 %.1f%%）' % (side, side, TARGET_R, 100 * TARGET_R / (side / 2)))

    # ---- 第二遍：归一化 + 保存 ----
    for j in jobs:
        img = normalize(j['rgba'], j['disc'], side, TARGET_R)
        dst = os.path.join(dest, 'sub_%s.png' % j['name'])
        img.save(dst)
        b = np.asarray(img).astype(float)
        m = b[:, :, 3] > 10
        l2 = b[:, :, :3][m].mean(axis=1)
        print('[%-6s] -> %s  覆盖 %.1f%%  平均亮度 %.0f  亮部>150 %.1f%%'
              % (j['name'], os.path.basename(dst), 100 * m.mean(), l2.mean(), 100 * (l2 > 150).mean()))
