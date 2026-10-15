#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
背景图去鱼 · **正式工具**（V6.82 重做）。

为什么 V6.81 没成功（别再走回头路）
-----------------------------------
用户 2026-10-15 两次报「每个场景底图都有冻结的鱼一样 是静态的 感觉很假」。
V6.81 的两段口径（严判细长小鱼 + 紧凑大块）**选块对了，补洞错了**：

  ⛔ **`thin_fish.inpaint()` 的补洞半径太小**（归一化卷积 σ=8）。
     背景里的鱼是**成片**的（L1 中段与深水两处各有几十条，间距 ~20px），
     σ=8 的卷积窗口里**仍然全是鱼** ⇒ 补出来的还是鱼。
     症状极具欺骗性：遮罩覆盖率、检出条数全都"正常"，出图一看**原封不动**。
  ⛔ **判定带太窄**：V6.81 用 y∈[30%,72%]，而 L1 的鱼一直铺到 **y≈0.84**（深水段）
     ⇒ 下半屏那一片从来没有被处理过。用户看到的"还有静止的鱼"一半是这条。
  ⛔ **8 邻域腐蚀会吃掉鱼**：鱼身只有 2~3px 厚，`er &= roll(...)×8` 之后整条消失，
     `pick_fish` 在目标区**一条都命中不了**（实测：目标区 2041px 的暗块，腐蚀后剩 0）。

本工具的口径（三处改了，缺一处就回到"抹了跟没抹一样"）
------------------------------------------------------
    遮罩：局部对比 `bg(11px 高斯) − gray > 4.5`，**不腐蚀**，靠形状过滤去噪
    判定带：**y∈[28%, 98%]**（L1 没有海床，一铺到底；其余带压到 78% 保护海床/热泉）
    补洞：**大半径归一化补洞**（σ=18、遮罩先膨胀 5px、只从**未遮盖区**取色）

⚠️ 大半径补洞的**唯一代价**：光柱／射线的硬边会被柔化 —— 但那正是"鱼"与"结构"的
   分界：**结构（光柱、海床、烟囱）必须在判定带之外**，鱼在任何地方都该被抹掉。
   ⇒ `BOTY` 按层给值，别一刀切。

用法
----
    python tools/defish_env.py --preview --out .tmp/v682   # 只出图到 .tmp
    python tools/defish_env.py --write                     # 回写真源（web webp）+ cocos png
    python tools/defish_env.py --measure                   # 只量密度
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
SRC = ROOT / 'web' / 'src' / 'assets' / 'env'            # ★ 真源（web 侧 webp）
DEST = ROOT / 'cocos' / 'assets' / 'resources' / 'env'   # 派生（sync_art.py 生成）
BACKUP = ROOT / 'docs' / 'shots' / 'env_v2' / '_backup_pre_defish_V6.81'
LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5']

# ---- 遮罩参数 ----
TOPY = 0.28              # 上沿：光柱带的下缘（光柱在 y<0.28，那是"结构"不是鱼）
BOTY = {                 # 下沿：**按层给**——L1/L2 没有海床，一铺到底
    'L1': 0.98, 'L2': 0.92, 'L3': 0.80, 'L4': 0.78, 'L5': 0.76,
}
THR = 4.5
AMIN, AMAX = 20, 2500    # 面积窗（<20 = 噪点；>2500 = 光柱负空间 / 海床）
SIDE_MAX = 190           # 长边上限（更大的 = 结构，不是一条鱼）
FILL_MIN = 0.28          # 填充率下限（细长 >> 这个值；光斑 << 这个值）

# ---- 补洞参数 ----
SIGMA = 18.0             # ★ 比 `thin_fish.inpaint` 的 8 大一倍以上：窗口里才没有别的鱼
DIL = 5                  # 遮罩膨胀：鱼身只有 2~3px，必须留出足够margin
ROUNDS = 4
WEBP_Q = 95


def _mask(rgb: np.ndarray, boty: float, thr: float = THR) -> np.ndarray:
    """局部对比遮罩 + 形状过滤（**不腐蚀** —— 见文件头第 3 条）。"""
    g = rgb @ T.LUMA
    bg = np.asarray(Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'L')
                    .filter(ImageFilter.GaussianBlur(11)), np.float32)
    h = g.shape[0]
    m = (bg - g) > thr
    m[:int(h * TOPY)] = False
    m[int(h * boty):] = False
    lab, n = T._label(m)
    if n == 0:
        return np.zeros_like(m)
    # ⚠️ **向量化**：逐连通域 `np.where(lab == i)` 是 O(n·像素数)，
    #    1.5MP 上要跑几分钟（实测直接超时被杀）。用 bincount 一次算完每组统计。
    # ⚠️ `_label` 的**背景是 -1**（不是 0）：先 +1 再统计，否则 bincount 直接报错。
    flat = (lab.ravel() + 1).astype(np.int64)
    ids = np.arange(1, n + 1)
    cnt = np.bincount(flat, minlength=n + 1)[1:]
    idx = np.flatnonzero(flat)
    lab_flat = flat[idx]
    ys = idx // lab.shape[1]
    xs = idx % lab.shape[1]
    ymin = np.full(n + 1, 10 ** 9, np.int64)
    ymax = np.full(n + 1, -1, np.int64)
    xmin = np.full(n + 1, 10 ** 9, np.int64)
    xmax = np.full(n + 1, -1, np.int64)
    np.minimum.at(ymin, lab_flat, ys)
    np.maximum.at(ymax, lab_flat, ys)
    np.minimum.at(xmin, lab_flat, xs)
    np.maximum.at(xmax, lab_flat, xs)
    sy = (ymax - ymin + 1)[1:]
    sx = (xmax - xmin + 1)[1:]
    keep_ids = ids[
        (cnt >= AMIN) & (cnt <= AMAX)
        & (np.maximum(sy, sx) <= SIDE_MAX) & (np.minimum(sy, sx) >= 2)
        & (cnt / np.maximum(1, sy * sx) >= FILL_MIN)
    ]
    lut = np.zeros(n + 1, np.uint8)
    lut[keep_ids] = 1
    return lut[flat].reshape(m.shape).astype(bool)


def _fill(rgb: np.ndarray, m: np.ndarray, sigma: float = SIGMA, dil: int = DIL) -> np.ndarray:
    """**大半径归一化补洞**：只从**未被遮盖**的像素取色。

    直接用 `GaussianBlur` 会把遮盖区的鱼一起平均进去（那就是 V6.81 的病根），
    所以要把"被遮盖"的像素从分子和分母里**同时**去掉，再做除法还原：
        补色 = Blur(rgb · (1−M)) / Blur(1−M)
    """
    md = T._dilate(m, dil)
    free = (~md).astype(np.float32)
    den = np.asarray(Image.fromarray((free * 255).astype(np.uint8))
                     .filter(ImageFilter.GaussianBlur(sigma)), np.float32) / 255.0
    den = np.maximum(den, 1e-3)
    num = np.asarray(Image.fromarray(np.clip(rgb * free[..., None], 0, 255).astype(np.uint8))
                     .filter(ImageFilter.GaussianBlur(sigma)), np.float32)
    far = num / den[..., None]
    a = md.astype(np.float32)[..., None]
    return rgb * (1 - a) + far * a


def strip_fish(arr: np.ndarray, layer: str):
    """两段口径：光柱带的细长小鱼走 `thin_fish`（严判，已证明不伤光柱），
    其余整列走本工具的大半径补洞。"""
    total = 0
    out = arr.copy()
    # ---- 第一段：光柱带（y<0.28）的细长小鱼 ----
    n1 = 0
    for _ in range(2):
        comps, gray, bg, d, thr, lab = T.detect(out, verbose=False)
        if not comps:
            break
        n1 += len(comps)
        out = T.inpaint(out, comps, lab, sigma=8.0)
    total += n1
    # ---- 第二段：整列的成片鱼（大半径补洞）----
    boty = BOTY.get(layer, 0.80)
    n2 = 0
    for _ in range(ROUNDS):
        m = _mask(out, boty)
        if not m.any():
            break
        n2 += 1
        out = _fill(out, m)
    total += n2
    return out, total


def to_rgb(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert('RGB'), np.float32)


def run_preview(out_dir: str) -> int:
    os.makedirs(out_dir, exist_ok=True)
    for name in LAYERS:
        arr = to_rgb(Image.open(SRC / f'{name}.webp'))
        out, n = strip_fish(arr, name)
        p = os.path.join(out_dir, f'{name}_defish')
        Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(p + '.png')
        print(f'  {name}: 处理 {n} 轮 -> {p}.png')
    return 0


def run_write() -> int:
    BACKUP.mkdir(parents=True, exist_ok=True)
    for name in LAYERS:
        src = SRC / f'{name}.webp'
        bak = BACKUP / f'{name}.webp'
        if not bak.exists():
            shutil.copy2(src, bak)
        arr = to_rgb(Image.open(bak if bak.exists() else src))   # ★ 一律从**原图**跑
        out, n = strip_fish(arr, name)
        im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        im.save(src, quality=WEBP_Q, method=6)
        im.save(DEST / f'{name}.png')                            # 先落文件、再写引用
        print(f'  {name}: {n} 轮 -> {src.name} + cocos/{name}.png')
    print(f'  原图备份 -> {BACKUP}')
    print('  ⚠️ 现在跑 python tools/sync_art.py 把 manifest 的哈希对齐')
    return 0


def run_measure() -> int:
    for name in LAYERS:
        n = len(T.detect(to_rgb(Image.open(DEST / f'{name}.png')), verbose=False)[0])
        print(f'  {name}: {n} 条（严判口径；现已是噪声级别）')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description='背景图去鱼（V6.82）')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--measure', action='store_true')
    ap.add_argument('--out', default='.tmp/v682')
    a = ap.parse_args()
    if a.write:
        return run_write()
    if a.measure:
        return run_measure()
    return run_preview(a.out)


if __name__ == '__main__':
    raise SystemExit(main())
