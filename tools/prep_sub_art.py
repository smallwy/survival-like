#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
潜航器**侧视机体位图**的固定后处理工序（V6.75）。

为什么需要它
------------
用户 2026-10-15 拍板：机体不再用矢量 `drawBody()` 实时绘制，改用**位图机体**。
但 AI 出图有三件事**不可控**，必须在本脚本里补齐：

  ① **比例**：模型先验极强，怎么要求都出「细长潜艇」（实测三张长高比 2.4~3.8），
     而游戏里机体必须是 `SUB_D × HULL_H = 88 × 56`（长高比 1.571）—— 因为
     `SEAT_MOUNTS` 的 `v` 就是按这个比例贴 `HULL_OUTLINE` 轮廓取的，而且
     炮座外缘直径 ~30px 必须坐得进艇高，艇不能太扁。
     ⇒ **各向异性缩放到 88×56**（实机只有 88px 宽，压缩看不出失真）。
  ② **背景**：`background=transparent` 不返回真 alpha（实拍 alpha 全 255，白底）。
     ⇒ 自己抠（亮度 + 饱和阈值 + 最大连通域去碎屑）。
  ③ **剪影**：AI 出的轮廓与 `HULL_OUTLINE` 不一致 ⇒ 炮位会「浮在艇外」。
     ⇒ **用 `HULL_OUTLINE` 裁 alpha**（保塔/鳍的出血，见下）。

④ **削硬亮边**（V6.77b）：AI 出图**必然**带一条沿剪影的 rim light（最外圈比内侧亮 1.5~1.8×）。
   缩到实机 88px 后就是用户看到的「白色的划线」⇒ 在**源域**（缩放到 88×56 之前，1~2px 可辨）
   与**画布域**（④ 裁完剪影之后、④b 开槽之前）各削一道。判据 / 时机见 `de_rim()`。
   ⛔ 与渲染层无关（`DiveGame.ts` 的挂载导轨是另一层）。

裁剪规则（关键）
----------------
  `alpha_final = alpha_src AND ( mask_trunk OR Y < oy OR Y >= oy + th )`

  · `mask_trunk` = `HULL_OUTLINE` 多边形 ⇒ 艇身剪影**严格等于**挂点基准，
    炮座必然落在轮廓线上（这是「挂点要对」的唯一保证）。
  · 躯干矩形**之外**的像素一律保留 ⇒ 指挥塔（背脊之上）与尾鳍（艇腹之下）
    作为**突破剪影**不被裁掉。
  · ⛔ 不要改成「保留躯干外的所有连通大块」—— 位图若比 `HULL_OUTLINE` 胖，
    多出来的那一圈本身就是个大连通块，会把裁切整个抵消掉。
  · ⚠️ mask/几何一律用**目标画布坐标**，且多边形尺寸必须乘超采样倍率 `K`
    （V6.75 踩过：漏乘 K ⇒ mask 只有躯干 1/4 宽 ⇒ 机体被裁得只剩上下两条）。

躯干定位（为什么用「列高众数」）
--------------------------------
  逐列高度 `colH(x)` 里，塔/鳍只占少数列 ⇒ **众数**天然是躯干厚度。
  比中值滤波稳（塔宽 ~320px，窗口要开到 400+ 才滤得掉，而那样会把艏艉抹平）。

用法
----
  python tools/prep_sub_art.py <src.png> [--out docs/shots/sub_art/sub_body]
                              [--k 4] [--pad 28] [--no-hull] [--diag]
                              [--expose 2.0] [--sat 1.15]
                              [--derim-src 2] [--derim-cv 4] [--derim-target 1.03]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from dewatermark import suppress as dw_suppress  # noqa: E402

# ---- 与 `shared/dive/tables.ts` 同源的几何真值（改了必须同步）-----------------
SUB_D = 88          # 艇长 px
HULL_H = 56         # 艇高 px
MOUNT_RING_R = 7    # 转座半径（预览用）
SEAT_PORT_R = 4     # 槽底内孔半径（预览用）

# ★ V6.76 **发射槽**（机体位图自带的开孔）—— 用户原话：
#   「我要的是你机型图自带开孔的发射槽，发射装置是直接装上去的，漏出发射头，
#     不是你画上去的突兀感」。
#   槽心 = `SEAT_MOUNTS` 在躯干矩形里的位置；槽 = 圆角矩形，
#   半宽 `SLOT_HW`（沿艇长）、深 `SLOT_HD`（沿挂点法线**往艇内**，从座心起算）。
#   ⚠️ 三个判据（动一个必须核另外两个，见 tables.ts 同名常量的注释）：
#     ① `2×SLOT_HW(13px) < 相邻座间距 0.46×44 ≈ 20px`（六槽之间留得住缝）
#     ② `SLOT_HD ≥ 发射器机匣的尾部入槽量`（否则机匣尾巴压在艇身皮肤上）
#     ③ `2×SLOT_HW(13) ≲ 转座直径 2×MOUNT_RING_R(14)`（插件正好塞满槽口）
SLOT_HW = 6.5
SLOT_HD = 6.0

# `HULL_OUTLINE`（`DiveGame.ts` 同源）：14 点梭形，u ∈ [-1,1]、v ∈ [-1,1]
HULL_OUTLINE = [
    (1.00, -0.30), (0.86, -0.74), (0.46, -0.96), (-0.10, -1.00),
    (-0.60, -0.90), (-0.88, -0.62), (-1.00, -0.18), (-1.00, 0.18),
    (-0.88, 0.62), (-0.60, 0.90), (-0.10, 1.00), (0.46, 0.96),
    (0.86, 0.74), (1.00, 0.30),
]

# `SEAT_MOUNTS`（`shared/dive/tables.ts` 同源）：背 3 + 腹 3
SEAT_MOUNTS = [
    (0.66, 0.75), (0.60, -0.80),
    (0.24, 0.93), (-0.22, 0.93),
    (-0.62, 0.80), (-0.70, -0.67),
]

LUMA_W = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


# =============================================================================
# 1. 抠图
# =============================================================================
def cutout(rgb: np.ndarray) -> np.ndarray:
    """白底 → alpha。判据：亮度低于白底，或饱和度明显（霓虹描边是有色的）。"""
    f = rgb.astype(np.float32)
    lum = f @ LUMA_W
    mx, mn = f.max(2), f.min(2)
    sat = (mx - mn) / (mx + 1e-6)
    fg = (lum < 228) | (sat > 0.16)
    keep = largest_component(fg)
    a = (keep * 255).astype(np.uint8)
    return np.asarray(Image.fromarray(a).filter(ImageFilter.BoxBlur(1)))


def largest_component(fg: np.ndarray) -> np.ndarray:
    """4-邻域 BFS，只保留最大连通域（1/2 降采样加速，再上采样）。"""
    h, w = fg.shape
    ds = 2
    sh, sw = h // ds, w // ds
    small = fg[: sh * ds, : sw * ds].reshape(sh, ds, sw, ds).any(axis=(1, 3))
    lab = np.zeros((sh, sw), dtype=np.int32)
    best, best_area, cur = 0, 0, 0
    for sy in range(sh):
        for sx in range(sw):
            if not small[sy, sx] or lab[sy, sx]:
                continue
            cur += 1
            area = 0
            q = deque([(sy, sx)])
            lab[sy, sx] = cur
            while q:
                y, x = q.popleft()
                area += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < sh and 0 <= nx < sw and small[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        q.append((ny, nx))
            if area > best_area:
                best, best_area = cur, area
    keep_small = lab == best
    keep = np.repeat(np.repeat(keep_small, ds, axis=0), ds, axis=1)
    out = np.zeros_like(fg)
    out[: keep.shape[0], : keep.shape[1]] = keep
    return out


# =============================================================================
# 2. 躯干定位
# =============================================================================
def locate_trunk(alpha: np.ndarray, verbose: bool = True) -> dict:
    fg = alpha > 128
    h, w = fg.shape
    ymin = np.full(w, -1, dtype=np.int32)
    ymax = np.full(w, -1, dtype=np.int32)
    ys, xs = np.nonzero(fg)
    for x in np.unique(xs):
        yy = ys[xs == x]
        ymin[x], ymax[x] = yy.min(), yy.max()
    colh = np.where(ymin >= 0, ymax - ymin + 1, 0)

    valid = colh > 0
    hist: dict[int, list[int]] = {}
    for x in np.nonzero(valid)[0]:
        hist.setdefault(int(colh[x]) // 4, []).append(int(x))
    if verbose:
        top = sorted(hist.items(), key=lambda kv: -len(kv[1]))[:5]
        print('[hist] colH top5 buckets(px:cols) = '
              + ', '.join(f'{b * 4}~{b * 4 + 3}:{len(v)}' for b, v in top))
    bucket = max(hist, key=lambda b: len(hist[b]))
    thick = float(np.median(colh[hist[bucket]]))

    near = valid & (np.abs(colh - thick) <= max(6.0, thick * 0.18))
    cy = float(np.median(((ymin + ymax) / 2.0)[near]))

    return {
        'x0': int(xs.min()), 'x1': int(xs.max()), 'len': int(xs.max() - xs.min() + 1),
        'cy': cy, 'thick': thick,
        'y_top': cy - thick / 2.0, 'y_bot': cy + thick / 2.0,
        'fg_y0': int(ys.min()), 'fg_y1': int(ys.max()),
    }


# =============================================================================
# 3. 缩放 + 裁剪影
# =============================================================================
def resample(rgba: np.ndarray, box: tuple, out_w: int, out_h: int) -> np.ndarray:
    """裁剪 box 后各向异性缩放到 (out_w, out_h)。**预乘 alpha** 防白边。"""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(rgba.shape[1], x1), min(rgba.shape[0], y1)
    sub = rgba[y0:y1, x0:x1].astype(np.float32)
    a = sub[..., 3:4] / 255.0
    pm = np.concatenate([sub[..., :3] * a, sub[..., 3:4]], axis=2)
    im = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), 'RGBA')
    im = im.resize((out_w, out_h), Image.LANCZOS)
    out = np.asarray(im).astype(np.float32)
    aa = out[..., 3:4] / 255.0
    rgb = out[..., :3] / np.maximum(aa, 1e-3)
    return np.concatenate([np.clip(rgb, 0, 255), out[..., 3:4]], axis=2).astype(np.uint8)


def hull_mask(w: int, h: int, ox: float, oy: float, k: int) -> np.ndarray:
    """在 (w,h) 画布上画 `HULL_OUTLINE`（躯干矩形左上角在 ox,oy，尺寸 SUB_D*k × HULL_H*k）。

    ⚠️ 多边形半径必须乘 `k`（超采样倍率），否则 mask 只有躯干的 1/k。
    """
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    pts = [((u * 0.5 + 0.5) * SUB_D * k + ox, (v * 0.5 + 0.5) * HULL_H * k + oy)
           for u, v in HULL_OUTLINE]
    d.polygon(pts, fill=255)
    return np.asarray(m)


def _soft(mask: np.ndarray, sigma: float) -> np.ndarray:
    """bool mask → 0~1 的**软权重场**（高斯羽化边界）。逐层叠加明暗时用它做权重，
    否则每一层都在像素边界留下硬边（6 个槽就是 6 圈锯齿）。"""
    im = Image.fromarray((mask * 255).astype(np.uint8), 'L')
    return np.asarray(im.filter(ImageFilter.GaussianBlur(sigma))).astype(np.float32) / 255.0


def de_rim(rgba: np.ndarray, r: int, target: float = 1.03, tag: str = '') -> np.ndarray:
    """削掉沿剪影的**硬亮边**（AI 出图自带的 rim light）。**只改 RGB，绝不动 alpha**。

    为什么必须做（用户 2026-10-15 **第三次**报「机体有白色的描边 / 划线」）：
        沿 alpha 边界从外往里数，最后几圈的平均亮度是 **144 / 132 / 112 / 100**，
        而内侧（3~5px）只有 **95** ⇒ 最外圈比内侧亮 **1.52×**；在 1536×1024 的**原稿**上更极端
        —— 最外圈 **167**（p50 181）vs 内侧 **93** = **1.8×**。
        这条亮边沿剪影**成一整圈**（ASCII 分布见 `docs/shots/hull_rim_ab.png`），
        缩到实机 88px 后仍是 ~0.5px 的一条亮线 —— 就是用户看到的「白色的划线」。

    判据（铁规 14）：**长条 + 亮色 = "UI 框"的语汇**。真实机体的剪影边**不该比自身表面亮一整圈**
        （那读作"抠图留下的描边 / 贴上去的一块"）。
        ⛔ 与渲染层无关：`DiveGame.ts` 那两条挂载导轨是**另一层**（已改成暗缝）；本函数改**素材本体**。

    做法（**自适应，不做全局压暗** —— 全局压暗会把边缘真实的高光细节一起抹掉）：
        ① 反复腐蚀求"距边界深度" `d`（0 = 最外圈）；
        ② 参考场 `ref` = **只用内侧**（d ≥ r+1）的亮度做归一化 box 模糊
           （= 边界处的"局部内侧亮度"；边界自己的高频不参与，所以不会被自己污染）；
        ③ 在 `d ≤ r` 的环带里把亮度**只往下**拉向 `ref × target`：
           `g = clip(ref × target / luma, 0, 1)`（>1 时截回 1 ⇒ **只削不补**）；
        ④ 逐通道乘**同一个** `g` ⇒ 色相比值不变（与 ⑤ 曝光补偿同一条"不偏色"的理由）。
        因为 `g` 随 `luma → ref×target` 自然收敛到 1，**环带边界无硬台阶**（不需要额外羽化）；
        也正因为如此，本函数**可以安全地连续调用两次**（源域 + 画布域）—— 第二次几乎没有可削的量。

    ⚠️ 调用时机（两处都是硬约束）：
        · 必须在 ④ **裁剪影之后** —— 否则边界还不是最终剪影（`HULL_OUTLINE`），
          削掉的可能是将来被裁掉的部分，而真正的艇缘原封不动；
        · 必须在 ④b **`bake_slots()` 之前** —— 槽口那圈 ×1.30 亮边是"这里有洞"的**主力**
          （见 `bake_slots` 注释），削边会把六个槽一起削平。

    ⚠️ `r` 的单位是**各自域**的像素：源域（1536×1024）`r≈2`，画布域（K=4）`r≈4`（= 1 实机 px）。
    """
    if r <= 0:
        return rgba
    a = rgba.astype(np.float32)
    fg = a[..., 3] > 128
    if int(fg.sum()) < 64:
        return rgba

    rings = [fg]
    c = fg
    for _ in range(r + 1):
        c = np.asarray(Image.fromarray((c * 255).astype(np.uint8), 'L')
                       .filter(ImageFilter.MinFilter(3))) > 128
        rings.append(c)
    band = rings[0] & ~rings[r + 1]          # d ≤ r：要削的环带
    inner = rings[r + 1]                     # 参考场取样区（严格在内侧）
    if not band.any() or not inner.any():
        print(f'[derim]{tag} 跳过（band={int(band.sum())} inner={int(inner.sum())}）')
        return rgba

    lum = a[..., :3] @ LUMA_W
    rad = r + 3
    den = np.asarray(Image.fromarray((inner * 255).astype(np.uint8), 'L')
                     .filter(ImageFilter.BoxBlur(rad)), np.float32) / 255.0
    num = np.asarray(Image.fromarray(np.clip(lum * inner, 0, 255).astype(np.uint8), 'L')
                     .filter(ImageFilter.BoxBlur(rad)), np.float32)
    ref = np.where(den > 0.02, num / np.maximum(den, 1e-3), 0.0)

    g = np.ones_like(lum)
    ok = band & (ref > 1.0) & (lum > 1.0)
    np.divide(ref * target, np.maximum(lum, 1e-3), out=g, where=ok)
    g = np.clip(g, 0.0, 1.0)
    g[~band] = 1.0

    before = float(lum[band].mean())
    out = a.copy()
    out[..., :3] = a[..., :3] * g[..., None]
    after = float((out[..., :3] @ LUMA_W)[band].mean())
    print(f'[derim]{tag} r={r} target={target}  环带 {int(band.sum())}px  '
          f'平均亮度 {before:.1f} → {after:.1f}（×{after / max(1e-3, before):.2f}）')
    return np.clip(out, 0, 255).astype(np.uint8)


def bake_slots(arr: np.ndarray, ox: float, oy: float, tw: float, th: float, K: int) -> np.ndarray:
    """在躯干矩形上挖出 6 个**发射槽**，并画出槽口 / 内壁 / 槽底的明暗。

    为什么必须在"图"上做，而不是渲染层画（这是用户 2026-10-15 的原话）：
        用 `Graphics` 画的插座只能是**艇身外侧的一块凸出物**（无渐变/无模糊/无笔触），
        六座读作"贴在艇上的积木"——那就是「你画上去的突兀感」。
        槽必须由**位图本体**承担，而位图已被对齐成「躯干矩形 == SUB_D × HULL_H」
        ⇒ 槽位与 `SEAT_MOUNTS` 必然重合，**挂点不可能错**。

    ⛔ **绝不改 alpha（不改剪影）**：只做"面上下陷"。
       · 机体剪影是被 `HULL_OUTLINE` 裁出来的，那是**挂点基准**——挖真缺口会同时
         改掉"座心到艇缘"的距离；
       · 而且 `HULL_OUTLINE` 是 tuned 过的梭形，啃 6 个口会变成锯齿。
       ⇒ 槽的"外缘"就是艇缘本身，靠**明暗**读作凹坑（暗腔 + 亮翻边 + 相邻艇缘提亮）。

    明暗层次（光源固定世界左上，与渲染层同一条铁律；全部用**原像素乘系数**，
    这样槽自动继承艇身自己的材质与色偏）：
        槽口内沿（×0.14，唇口压住最近光源那一侧）
        → 槽内（×0.22 → ×0.52，由外向内变亮 = 斜着看到槽底）
        → 槽底翻边（×1.05，最后一圈受光 = "到底了"）
        + 槽口左右两侧**相邻的艇缘**提亮（×1.22，"开孔把边缘照亮"= 有洞的最强线索）
    """
    out = arr.astype(np.float32).copy()
    H, W = out.shape[:2]
    fg = out[..., 3] > 96
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    report = []

    for i, (u, v) in enumerate(SEAT_MOUNTS):
        tx = ox + (u * 0.5 + 0.5) * tw
        ty = oy + (v * 0.5 + 0.5) * th
        inward = 1.0 if v < 0 else -1.0      # 背脊(v<0) 往 y+ 挖；腹部 往 y- 挖
        hw, hd = SLOT_HW * K, SLOT_HD * K
        rr = min(hw, hd) * 0.5
        pad = 4.0 * K
        x0 = max(0, int(tx - hw - pad)); x1 = min(W, int(tx + hw + pad) + 1)
        y0 = max(0, int(min(ty, ty + inward * (hd + 3 * K)) - pad))
        y1 = min(H, int(max(ty, ty + inward * (hd + 3 * K)) + pad) + 1)
        if x1 <= x0 or y1 <= y0:
            continue

        wloc = xx[y0:y1, x0:x1] - tx
        tloc = (yy[y0:y1, x0:x1] - ty) * inward
        sfgo = fg[y0:y1, x0:x1]
        srgb = out[y0:y1, x0:x1, :3]
        if not sfgo.any():
            continue

        # ---- 艇缘：**逐列**求前景最外缘（不是整个窗口取极值！）----
        # ⚠️ V6.76 踩过：整窗取 `rows.min()` 时，0 号槽的窗口右端搭到了指挥塔的底边，
        #    "艇缘"被抬到塔顶 ⇒ 那一槽算出来 9.2px 深（实际 6.4），槽会挖穿甲板。
        #    ⇒ 逐列求，且只用**槽自身 x 范围**内的列。
        nr = sfgo.shape[0]
        ridx = np.arange(nr)[:, None]
        if inward > 0:
            col_top = np.where(sfgo, ridx, 10 ** 6).min(axis=0).astype(np.float64)
            col_top[col_top > nr] = np.nan
        else:
            col_top = np.where(sfgo, ridx, -1).max(axis=0).astype(np.float64)
            col_top[col_top < 0] = np.nan
        ok = np.isfinite(col_top)
        if not ok.any():
            continue
        cidx = np.arange(col_top.size)
        col_top = np.interp(cidx, cidx[ok], col_top[ok])        # 缺材料的列用邻居插值
        t_open = (col_top + y0 - ty) * inward                   # 逐列：0 = 该列艇缘
        depth_col = hd - t_open                                 # 逐列：该列的槽总进深
        dp = tloc - t_open[None, :]                             # 逐像素：距艇缘的深度

        ax = np.abs(wloc)
        sx = ax - (hw - rr)
        st = tloc - (hd - rr)
        corner = (st > 0) & (sx > 0)
        pocket = ((ax <= hw) & (tloc <= hd) & (dp >= -0.6 * K)
                  & ~(corner & (sx * sx + st * st > rr * rr)) & sfgo)
        if int(pocket.sum()) < 8:
            report.append(f'{i}: 槽内无材料 跳过')
            continue

        soft = _soft(pocket, K * 0.7)
        # 槽的"名义深度"取槽心中线那一列，只用于打印
        dmid = float(np.median(depth_col[np.abs(wloc[0]) <= hw])) / K if np.any(np.abs(wloc[0]) <= hw) else 0.0

        # ① 槽内：由外向内 0.16 → 0.46
        kk = np.clip((dp - 0.8 * K) / np.maximum(1e-3, depth_col[None, :] - 1.6 * K), 0, 1)
        srgb *= (1.0 + (0.16 + 0.30 * kk - 1.0)[..., None] * soft[..., None])
        # ①b 槽内左右微差（光源在左 ⇒ 左壁略亮、右壁略暗），弧度只有 ±8%
        srgb *= (1.0 + (0.08 * np.clip(-wloc / max(1e-3, hw), -1, 1))[..., None] * soft[..., None])
        # ② 槽口内沿：唇口投影（最近光源那一侧的暗环）
        srgb *= (1.0 + (0.10 - 1.0) * _soft(pocket & (dp <= 1.3 * K), K * 0.5)[..., None])
        # ③ 槽底翻边：最后一圈受光
        srgb *= (1.0 + (1.08 - 1.0)
                 * _soft(pocket & (dp >= depth_col[None, :] - 1.5 * K), K * 0.5)[..., None])
        # ④ ★ **槽口整圈的亮边（机加工翻边）** —— 这一条是"这里有洞"的主力：
        #    只把"槽内变暗"是读不出凹坑的（暗斑在深海里到处都是），
        #    **必须有一圈亮边把口框出来**（人眼认洞口靠的是这条边）。
        #    做法：把槽 mask 膨胀 1.7px，取"落在艇体上、且不在槽内"的那一圈。
        r_ = max(1, int(round(1.7 * K)))
        pim = Image.fromarray((pocket * 255).astype(np.uint8), 'L')
        dil = np.asarray(pim.filter(ImageFilter.MaxFilter(2 * r_ + 1))) > 128
        rim = dil & sfgo & ~pocket
        srgb *= (1.0 + (1.30 - 1.0) * _soft(rim, K * 0.45)[..., None])

        out[y0:y1, x0:x1, :3] = srgb
        report.append(f'{i}: 槽心({tx / K:.1f},{ty / K:.1f})px 宽{2 * SLOT_HW:.1f} 深{dmid:.1f} '
                      f'槽内材料 {int(pocket.sum())}px')

    print('[slots] ' + ' | '.join(report))
    return np.clip(out, 0, 255).astype(np.uint8)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', default='docs/shots/sub_art/sub_body')
    ap.add_argument('--k', type=int, default=4, help='超采样倍率（躯干 = SUB_D*k × HULL_H*k）')
    ap.add_argument('--pad', type=int, default=28, help='画布四周留边（目标 px）')
    ap.add_argument('--no-hull', action='store_true', help='不裁剪影（只做缩放对齐）')
    ap.add_argument('--no-slots', action='store_true', help='不烘焙发射槽（对照用）')
    ap.add_argument('--diag', action='store_true', help='额外输出「原图上画躯干框」的诊断图')
    ap.add_argument('--expose', type=float, default=2.0,
                    help='曝光补偿 gamma（>1 提亮）。**与 env 同一条工序**：`drawVeil` 会吃掉'
                         '一半亮度 ⇒ 素材要按"被压暗之后"配。机体是暗金属，不给补偿会与'
                         '深海背景糊成一片（`--combat` 合成图能看出来）。'
                         '⚠️ **V6.77 从 1.35 提到 2.0**：用户报「机体本体是黑的」。'
                         '实测 1.35 时成品本体 p50 只有 **61**，而浅海背景 L1 的 p25 就有 74 '
                         '⇒ 机体一半以上的像素比背景最暗的 1/4 还暗，开局就是"一块黑板"。'
                         '2.0 之后 p50 = **93**（判据：**成品本体 p50 落在 90~100**；'
                         '对比图 `docs/shots/hull_bright_ab.png`，1.9 档在深海开始发白）')
    ap.add_argument('--sat', type=float, default=1.15,
                    help='饱和度增益（>1 更青，与暗绿水体拉开）。'
                         '⚠️ 默认 **1.15**（= 采用值），这样"不带参数跑一遍"就是正确产物')
    ap.add_argument('--derim-src', type=int, default=2,
                    help='源域削硬亮边的环带宽度（px，0 = 关）。AI 原稿自带 rim light，见 de_rim()')
    ap.add_argument('--derim-cv', type=int, default=4,
                    help='画布域削硬亮边的环带宽度（px，0 = 关）。K=4 ⇒ 4px = 1 实机 px')
    ap.add_argument('--derim-target', type=float, default=1.03,
                    help='削到"内侧局部亮度"的几倍（1.0 = 完全削平，1.03 = 留 3%% 边）。'
                         '⛔ 不要 >1.2（会留回一圈描边）也不要 <1.0（边缘反比艇身暗 = 换一种描边）')
    args = ap.parse_args()

    im = Image.open(args.src).convert('RGB')
    im = dw_suppress(im)                      # ① 去角标水印（固定工序）
    rgb = np.asarray(im).astype(np.uint8)
    alpha = cutout(rgb)                       # ② 抠底
    t = locate_trunk(alpha)
    print(f'[trunk] len={t["len"]} thick={t["thick"]:.0f} '
          f'ratio={t["len"] / t["thick"]:.3f}  (target {SUB_D / HULL_H:.3f})')
    print(f'[trunk] cy={t["cy"]:.1f} y=[{t["y_top"]:.0f},{t["y_bot"]:.0f}] '
          f'fgY=[{t["fg_y0"]},{t["fg_y1"]}] fgX=[{t["x0"]},{t["x1"]}]')

    K = args.k
    tw, th = SUB_D * K, HULL_H * K           # 躯干目标尺寸
    sx = tw / float(t['x1'] - t['x0'] + 1)
    sy = th / float(t['y_bot'] - t['y_top'])
    inner_w = tw
    inner_h = max(1, int(round((t['fg_y1'] - t['fg_y0'] + 1) * sy)))
    oy_in = int(round((t['y_top'] - t['fg_y0']) * sy))

    pad = args.pad
    ox, oy = pad, pad + oy_in
    canvas_w, canvas_h = inner_w + 2 * pad, inner_h + 2 * pad
    print(f'[scale] sx={sx:.4f} sy={sy:.4f} (sy/sx={sy / sx:.2f} = 垂直拉伸倍数)')
    print(f'[canvas] {canvas_w}x{canvas_h} trunk@({ox},{oy}) size {tw}x{th}')

    rgba = np.concatenate([rgb, alpha[..., None]], axis=2)
    # ③b **削硬亮边（源域）**（V6.77b）—— AI 原稿自带的 rim light 在 1536×1024 上是
    #     清晰可辨的 1~2px 亮带（最外圈 167 vs 内侧 93），在这一层削最精确。
    #     ⚠️ 必须在缩放**之前**（缩放会把它和邻域糊在一起，之后就分不清"边"和"面"了）。
    if args.derim_src > 0:
        rgba = de_rim(rgba, args.derim_src, args.derim_target, tag='·src')
    inner = resample(rgba, (t['x0'], t['fg_y0'], t['x1'] + 1, t['fg_y1'] + 1), inner_w, inner_h)
    scaled = np.zeros((canvas_h, canvas_w, 4), np.uint8)
    scaled[pad:pad + inner_h, pad:pad + inner_w] = inner

    # ④ 用 HULL_OUTLINE 裁剪影（保塔/鳍出血）
    if not args.no_hull:
        m = hull_mask(canvas_w, canvas_h, ox, oy, K) > 0
        yy = np.arange(canvas_h)[:, None]
        keep = m | (yy < oy) | (yy >= oy + th)
        scaled[..., 3] = np.where(keep, scaled[..., 3], 0)
        hole = float((m & (scaled[..., 3] < 96)).sum()) / max(1, int(m.sum()))
        print(f'[hull] 轮廓内透明占比 = {hole * 100:.2f}%  '
              f'{"✅ 覆盖良好" if hole < 0.02 else "⚠️ 位图比轮廓瘦，炮座可能浮空"}')

    # ④c **削硬亮边（画布域）**（V6.77b）—— 收尾：源域削过之后，LANCZOS 各向异性缩放
    #     仍会在"不透明的艇身 / 透明的背景"这个强边界上留下**振铃过冲**（负瓣抬亮最外圈）。
    #     这一道就是量到的 144/132/112/100 ↔ 内侧 95 那条 1.52× 的环。
    #     ⚠️ 位置是硬约束：④ 裁完（边界 = 最终剪影）之后、④b 开槽之前（槽口亮边不能被削）。
    if args.derim_cv > 0:
        scaled = de_rim(scaled, args.derim_cv, args.derim_target, tag='·cv')

    # ④b **发射槽**（V6.76）—— 机体位图自带的 6 个开孔。
    #     必须在 ④ 裁完剪影**之后**（槽口的"外缘"就是裁出来的艇缘）、
    #     在 ⑤ 曝光补偿**之前**（槽是用原像素乘系数画的 ⇒ 跟着一起过 gamma，
    #     明暗关系与艇身保持一致；放到补偿之后画，槽会比艇身暗一档、读作"贴了块黑胶布"）。
    if not args.no_slots:
        scaled = bake_slots(scaled, ox, oy, tw, th, K)

    # ⑤ 曝光补偿 + 饱和度（**与 env 同一条工序**，不是"调色"）
    #    依据：`drawVeil` 压掉一半亮度 ⇒ 素材按"被压暗之后"配。机体是暗金属，
    #    不给补偿在 L3-L5 那种深水里会与背景糊成一片（`preview_hull_side.py --combat` 可见）。
    #    ⚠️ 逐通道幂函数是**单调**的 ⇒ 色相不变，只是明度重分布（白点仍保 255）。
    if args.expose != 1.0:
        f = np.clip(scaled[..., :3].astype(np.float32) / 255.0, 0, 1)
        scaled[..., :3] = np.clip(np.power(f, 1.0 / args.expose) * 255.0, 0, 255).astype(np.uint8)
        print(f'[expose] gamma={args.expose}（提亮 {args.expose:.2f}×）')
    if args.sat != 1.0:
        f = scaled[..., :3].astype(np.float32)
        g = f @ LUMA_W
        f = g[..., None] + (f - g[..., None]) * args.sat
        scaled[..., :3] = np.clip(f, 0, 255).astype(np.uint8)
        print(f'[sat] {args.sat}×')

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(scaled, 'RGBA').save(str(out) + '.png')
    Image.fromarray(scaled, 'RGBA').save(str(out) + '.webp', quality=95, method=6)
    meta = {'canvasW': canvas_w, 'canvasH': canvas_h,
            'trunkX': ox, 'trunkY': oy, 'trunkW': tw, 'trunkH': th,
            'subD': SUB_D, 'hullH': HULL_H, 'k': K}
    (out.parent / (out.name + '.json')).write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(f'[meta] {json.dumps(meta)}')

    preview(out, scaled, meta)
    slots_check(out, scaled, meta)
    ingame(out, scaled, meta)
    if args.diag:
        diag(rgb, t, out)
    return 0


def slots_check(out: Path, scaled: np.ndarray, meta: dict) -> None:
    """**发射槽验收图**：躯干区域 3× 放大，红框 = 槽应该落的位置（由 `SEAT_MOUNTS` 算）。

    判据只有一条：**六个红框里必须各有一个看得见的凹坑**（暗腔 + 亮翻边 + 相邻艇缘提亮），
    且六个凹坑的**左右位置 = 红框**。框里是平的 ⇒ 槽没画上；框外有坑 ⇒ 槽位算错了。
    """
    K, Z = meta['k'], 3
    ox, oy = meta['trunkX'], meta['trunkY']
    tw, th = meta['trunkW'], meta['trunkH']
    x0 = max(0, int(ox - 6 * K)); x1 = int(ox + tw + 6 * K)
    y0 = max(0, int(oy - 26 * K)); y1 = int(oy + th + 6 * K)
    crop = scaled[y0:y1, x0:x1]
    im = Image.fromarray(crop, 'RGBA').resize(((x1 - x0) * Z, (y1 - y0) * Z), Image.NEAREST)
    bg = Image.new('RGB', im.size, (10, 22, 30))
    bg.paste(im, (0, 0), im)
    d = ImageDraw.Draw(bg)
    for i, (u, v) in enumerate(SEAT_MOUNTS):
        tx = ((ox + (u * 0.5 + 0.5) * tw) - x0) * Z
        ty = ((oy + (v * 0.5 + 0.5) * th) - y0) * Z
        hw, hd = SLOT_HW * K * Z, SLOT_HD * K * Z
        inward = 1 if v < 0 else -1
        d.rectangle([tx - hw, ty + (0 if inward > 0 else -hd), tx + hw,
                     ty + (hd if inward > 0 else 0)], outline=(255, 90, 90), width=2)
        d.text((tx + hw + 3, ty - 8), str(i), fill=(255, 220, 60))
    bg.save(str(out) + '_slots.png')
    print(f'[slots] {out}_slots.png  （红框=槽位，六个框里各应有一个凹坑）')


def ingame(out: Path, scaled: np.ndarray, meta: dict) -> None:
    """**实机尺寸**验收图：机体按 1x（SUB_D × HULL_H）贴进 1304×749 战斗画面，
    右侧给出机体区域的 4× 放大。

    为什么必须有这张：`_preview.png` 是 8× 放大（K=4 × Z=2），**各向异性拉伸的失真
    在 8× 下极其刺眼、在 1x 下未必看得出来**。唯一该看的是实机那一张。
    """
    W, H = 1304, 749
    K = meta['k']
    try:
        bg = Image.open('web/src/assets/env/L2.webp').convert('RGB').resize((W, H), Image.LANCZOS)
        bg = Image.eval(bg, lambda v: int(v * 0.55))          # 近似 drawVeil 压暗
    except Exception:
        bg = Image.new('RGB', (W, H), (14, 30, 38))
    # 机体 1x：躯干 SUB_D×HULL_H，画布同比缩小
    w1, h1 = meta['canvasW'] / K, meta['canvasH'] / K
    body1 = Image.fromarray(scaled, 'RGBA').resize((int(round(w1)), int(round(h1))), Image.LANCZOS)
    cx, cy = W // 2, H // 2
    px = int(round(cx - meta['trunkX'] / K - meta['trunkW'] / (2 * K)))
    py = int(round(cy - meta['trunkY'] / K - meta['trunkH'] / (2 * K)))
    bg.paste(body1, (px, py), body1)

    d = ImageDraw.Draw(bg)
    for i, (u, v) in enumerate(SEAT_MOUNTS):
        x = cx + u * SUB_D / 2
        y = cy + v * HULL_H / 2
        r = MOUNT_RING_R
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 220, 60), width=1)
        d.text((x + r + 2, y - 5), str(i), fill=(255, 220, 60))
    bg.save(str(out) + '_ingame.png')

    # 局部放大（以机体为中心 300×200 区域 → 4×）
    bx, by, bw, bh = cx - 150, cy - 100, 300, 200
    crop = bg.crop((bx, by, bx + bw, by + bh)).resize((bw * 3, bh * 3), Image.NEAREST)
    full = Image.new('RGB', (W, H + bh * 3 + 8), (6, 14, 20))
    full.paste(bg, (0, 0))
    full.paste(crop, ((W - bw * 3) // 2, H + 8))
    full.save(str(out) + '_ingame_zoom.png')
    print(f'[ingame] {out}_ingame.png / _ingame_zoom.png（机体 1x = {SUB_D}×{HULL_H}px）')


def preview(out: Path, scaled: np.ndarray, meta: dict) -> None:
    """验收图：对齐后的机体 + `HULL_OUTLINE` + 6 挂点（都是目标坐标 ×2 便于目视）。"""
    Z, K = 2, meta['k']
    W, H = meta['canvasW'] * Z, meta['canvasH'] * Z
    canvas = Image.new('RGB', (W, H), (10, 22, 30))
    body = Image.fromarray(scaled, 'RGBA').resize((W, H), Image.NEAREST)
    canvas.paste(body, (0, 0), body)
    d = ImageDraw.Draw(canvas)
    ox, oy = meta['trunkX'] * Z, meta['trunkY'] * Z

    def P(u, v):
        return (ox + (u * 0.5 + 0.5) * SUB_D * K * Z, oy + (v * 0.5 + 0.5) * HULL_H * K * Z)

    d.line([P(u, v) for u, v in HULL_OUTLINE] + [P(*HULL_OUTLINE[0])], fill=(255, 90, 90), width=2)
    d.line([(ox, oy), (ox + SUB_D * K * Z, oy)], fill=(90, 90, 255), width=1)
    d.line([(ox, oy + HULL_H * K * Z), (ox + SUB_D * K * Z, oy + HULL_H * K * Z)],
           fill=(90, 90, 255), width=1)
    r = MOUNT_RING_R * K * Z
    for i, (u, v) in enumerate(SEAT_MOUNTS):
        x, y = P(u, v)
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 220, 60), width=2)
        d.text((x + r + 3, y - 6), str(i), fill=(255, 220, 60))
    canvas.save(str(out) + '_preview.png')
    print(f'[preview] {out}_preview.png  （红=HULL_OUTLINE，蓝=躯干矩形，黄=6 挂点）')


def diag(rgb: np.ndarray, t: dict, out: Path) -> None:
    """原图上画躯干框，检查「列高众数」定位对不对。"""
    im = Image.fromarray(rgb.copy())
    d = ImageDraw.Draw(im)
    for y, c in ((t['y_top'], (255, 80, 80)), (t['y_bot'], (255, 80, 80)), (t['cy'], (80, 255, 120))):
        d.line([(0, y), (im.width, y)], fill=c, width=3)
    d.rectangle([t['x0'], t['y_top'], t['x1'], t['y_bot']], outline=(255, 220, 60), width=3)
    im.save(str(out) + '_diag.png')
    print(f'[diag] {out}_diag.png')


if __name__ == '__main__':
    raise SystemExit(main())
