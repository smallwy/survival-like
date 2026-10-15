#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V6.81 背景图去鱼 —— **正式工具**（生产用）。

为什么需要它（而不是直接用 `thin_fish.py`）
-------------------------------------------
用户 2026-10-15：「每个场景底图都有冻结的鱼一样 是静态的 感觉很假」。两条硬事实：

1. ⛔ **`thin_fish.py --keep 0` 什么都不做** —— `thin()` 里
   `if not drop or len(drop) == len(comps): break` ⇒ keep_n=0 时第一轮就 return，
   **inpaint 一次都没跑**。那个工具只支持"减到 N 条"，**从没支持过"删干净"**。
2. ⛔ **`thin_fish.detect()` 的严判口径抓不到"玩家看到的大鱼"** —— 它的口径是"细长小鱼"
   （面积 8~1200 / 长边 ≤90 / 填充率 ≥0.20 / 环带平坦 ≤0.45）。L1 实测：
   检出 **169** 条里 **135 条在 y<300**（丁达尔光柱里的碎斑），
   而玩家一眼看到的那排 40~90px 大鱼 **长边 ≥30px 的只有 5 个**。
   ⇒ 它的"密度"指标 ≠ 玩家感知，所以 V6.69「减密到参照密度」没解决这条报障。

本工具的口径（换了"选谁"，补洞仍复用 `thin_fish.inpaint()` 的归一化卷积）：
    局部对比 `bg(11px 高斯) − gray > THR`  →  开运算去噪  →  连通域  →  形状过滤
    →  `thin_fish.inpaint()`  →  迭代到收敛

⚠️ 三条**必须**保留的约束（都是踩过的）：
  · 直接用对比度阈值当遮罩**不行**：它分不开"鱼"和"丁达尔光柱的负空间"，
    会把光柱区抹成一片白云（实测遮罩占 6%）。必须回到**连通域 + 形状过滤**。
  · 判定带 **y ∈ [30%, 72%]**：上面是光柱区、下面是海床/烟囱，两处都不该按"鱼"处理。
  · 补洞会留**极淡的水痕**（鱼原来所在的位置） ⇒ 交付时**必须人工精修**，
    ⛔ 不要当成"可直接商用"。

用法
----
    # 只出对照预览（写到 .tmp）
    python tools/defish_env.py --preview --out .tmp/v681

    # 回写真源（web 侧 webp）—— 之后必须再跑 sync_art.py 落到 cocos
    python tools/defish_env.py --write

    # 只量密度
    python tools/defish_env.py --measure
"""

import argparse
import os
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import thin_fish as T  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'web' / 'src' / 'assets' / 'env'          # ★ 真源（web 侧 webp）
DEST = ROOT / 'cocos' / 'assets' / 'resources' / 'env'  # 派生（sync_art.py 生成）
BACKUP = ROOT / 'docs' / 'shots' / 'env_v2' / '_backup_pre_defish_V6.81'
LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5']

TOPY, BOTY = 0.30, 0.72
AMIN, AMAX = 60, 4000
SIDE_MAX, FILL_MIN = 200, 0.34
SIGMA, THR = 8.0, 5.0
ROUNDS = 3
WEBP_Q = 95                     # 与现存游戏 webp 同档（反推自字节数）


def pick_fish(rgb: np.ndarray, thr: float = THR):
    g = rgb @ T.LUMA
    bg = np.asarray(Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'L')
                    .filter(ImageFilter.GaussianBlur(11)), np.float32)
    h = g.shape[0]
    m = (bg - g) > thr
    m[:int(h * TOPY)] = False
    m[int(h * BOTY):] = False
    er = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            er &= np.roll(np.roll(m, dy, 0), dx, 1)
    m = T._dilate(er, 1)
    lab, n = T._label(m)
    comps = []
    for i in range(n):
        ys, xs = np.where(lab == i)
        if len(ys) < AMIN or len(ys) > AMAX:
            continue
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
        sy, sx = y1 - y0 + 1, x1 - x0 + 1
        if max(sy, sx) > SIDE_MAX or min(sy, sx) < 4:
            continue
        if len(ys) / (sy * sx) < FILL_MIN:
            continue
        comps.append({'id': i, 'y0': y0, 'y1': y1, 'x0': x0, 'x1': x1})
    return comps, lab


def strip_fish(arr: np.ndarray, rounds: int = ROUNDS):
    """**两段口径**（这是本工具与 `thin_fish.py --keep 0` 的第二个差别）。

    · **光柱带（y < 30%）**：用 `thin_fish.detect()` 的严判（细长小鱼）。
      那一带**正好是它擅长的**：L1 的 169 条里 135 条在这儿。而且它的
      "环带平坦度 ≤0.45" 会把**贴在光柱纹理上的块**剔掉 ⇒ 不会误伤丁达尔结构。
    · **中段（y ∈ [30%, 72%]）**：用本工具的紧凑大块口径 —— 玩家一眼看到的
      40~90px 大鱼全在这儿，而严判口径**只命中 5 个**。
    """
    total = 0
    for _ in range(rounds):
        # ---- 第一段：光柱带的细长小鱼（严判）----
        # ⚠️ 严判自己的判定带是 y∈[4%,68%)，这里**不裁剪**它 —— 让它按原口径跑，
        #    中段的重复命中由第二段去重（inpaint 后该处已无暗块，第二段自然不再命中）。
        n1 = 0
        for _ in range(2):
            comps, gray, bg, d, thr, lab = T.detect(arr, verbose=False)
            if not comps:
                break
            n1 += len(comps)
            arr = T.inpaint(arr, comps, lab, sigma=SIGMA)
        # ---- 第二段：中段的紧凑大块 ----
        n2 = 0
        for _ in range(2):
            comps2, lab2 = pick_fish(arr)
            if not comps2:
                break
            n2 += len(comps2)
            arr = T.inpaint(arr, comps2, lab2, sigma=SIGMA)
        total += n1 + n2
        if n1 + n2 == 0:
            break
    return arr, total


def to_rgb(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert('RGB'), np.float32)


def run_preview(out_dir: str) -> int:
    os.makedirs(out_dir, exist_ok=True)
    for name in LAYERS:
        arr = to_rgb(Image.open(SRC / f'{name}.webp'))
        out, n = strip_fish(arr)
        p = os.path.join(out_dir, f'{name}_defish')
        Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(p + '.png')
        print(f'  {name}: 抹掉 {n} 团 -> {p}.png')
    return 0


def run_write() -> int:
    BACKUP.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(LAYERS):
        src = SRC / f'{name}.webp'
        bak = BACKUP / f'{name}.webp'
        if not bak.exists():
            shutil.copy2(src, bak)
        arr = to_rgb(Image.open(src))
        out, n = strip_fish(arr)
        im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        im.save(src, quality=WEBP_Q, method=6)
        # 同步落到 cocos（不等 sync_art，保证"先落文件再写引用"）
        im.save(DEST / f'{name}.png')
        print(f'  {name}: 抹掉 {n} 团 -> {src.name} + cocos/{name}.png')
    print(f'  原图备份 -> {BACKUP}')
    print('  ⚠️ 现在跑 python tools/sync_art.py 把 manifest 的哈希对齐')
    return 0


def run_measure() -> int:
    for name in LAYERS:
        n = len(T.detect(to_rgb(Image.open(DEST / f'{name}.png')), verbose=False)[0])
        print(f'  {name}: {n} 条')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description='V6.81 背景图去鱼')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--measure', action='store_true')
    ap.add_argument('--out', default='.tmp/v681')
    a = ap.parse_args()
    if a.write:
        return run_write()
    if a.measure:
        return run_measure()
    return run_preview(a.out)


if __name__ == '__main__':
    raise SystemExit(main())
