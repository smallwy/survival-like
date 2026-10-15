#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
背景鱼**减密**：把已经出好的一张 env 图里的小鱼（不是动态敌人，是烘进背景图的）
按"保留 N 条"的要求去掉一部分，**其余像素一个不动**。

为什么要在图上做，而不是重出：
  用户定的是「v4b + 背景鱼稀疏点 + 保持和现存图一致」⇒ 这是**定稿上的密度调整**，
  不是重画。重出会把构图/配色/曝光全部换一遍，等于推翻刚拍板的版本。

做法（全部纯 numpy + PIL，不依赖 cv2/scipy）：
  1. 灰度 → **分块中值**估"水背底"（块 24px：水是低频的，鱼是高频的 ⇒ 中值天然忽略鱼）
  2. `d = 灰度 − 背底` ⇒ 鱼 = |d| 超阈值的小团（**符号无关**：背光鱼比水暗、受光鱼比水亮，两种都有）
  3. 形态学开运算去掉 1px 噪点 → **行段并查集**连通域标记（无 scipy 的做法）
  4. 逐团过滤：面积 / 外接框 / 填充率 / 峰值，外加两条"不是鱼"的排除：
       · **环带平坦度** —— 鱼四周是平静的水；岩壁里一切都在高频 ⇒ 环带 mask 密度高 ⇒ 排除
       · 底部海床区（y > 92%）整片排除（那里是烟囱/管虫，不是鱼）
  5. 按面积降序 + **最小间距**抽稀 ⇒ 保留的鱼**散开**，不会剩一坨（密度降了但"聚成团"更难看）
  6. 逐团**补洞**：从最近的"干净水"处整块搬一块同尺寸的贴图盖回来（保水色 + 保悬浮颗粒），
     洞口按高斯羽化 ⇒ 不留疤

用法：
    python tools/thin_fish.py <输入图> --out <输出前缀> --keep 16
    python tools/thin_fish.py <输入图> --out <前缀> --keep 16 --canvas 1536x984
    python tools/thin_fish.py <输入图> --out <前缀> --keep 16 --debug   # 另存一张红框标注图

`--keep` 是"**保留几条**"（不是比例）—— 因为观感取决于"屏幕上有几条"，跟原图有多少条无关。
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

BLOCK = 24          # 背底估计的块尺寸（px）
MIN_AREA = 6        # 小于这个像素数的团当噪声
MAX_AREA = 900      # 大于这个像素数的团当岩壁/烟柱
MAX_SIDE = 64       # 外接框长边上限
RING_FLAT = 0.45    # 环带里"高频像素"占比上限（超过 ⇒ 判定为岩壁内部）
BED_TOP = 0.92      # 百分比：这条线以下不算鱼（海床/烟囱）
MIN_GAP = 110       # 保留鱼之间的最小间距（px）—— 防止"少而聚"
LUMA = np.array([0.299, 0.587, 0.114], np.float32)

# ── 严判（fish-only）：只认"开阔水域里细长的小鱼"，其余高频一律放过 ──
# 宽松阈值会把气泡/悬浮颗粒/烟柱边缘全抓进来（v4b 宽判 1544团 vs 严判 112条）
FISH_TOP = 0.04     # 上边 4% 不算（水面高光带）
FISH_BOT = 0.68     # 下 32% 不算（海床/烟柱/礁石全在这里；鱼群下沿实测≈0.62）
FISH_AR_LO = 1.5# 鱼必细长；太圆的是气泡/光斑
FISH_AR_HI = 5.5    # 细过这个是裂纹/水痕，不是鱼
FISH_FILL = 0.20    # 外接框填充率下限（鱼身是实心的，裂纹是空的）
FISH_A_MIN = 8
FISH_A_MAX = 1200   # 严判要能抓"近处大鱼"（v4b 里最大的鱼 1087px，500 会漏）
FISH_SIDE = 90      # 同上：外接框长边上限（严判单独一份，别改宽判的 MAX_SIDE）


def _label(mask: np.ndarray):
    """行段 + 并查集的连通域标记（无 scipy）。返回 (labels, n)。"""
    h, w = mask.shape
    parent: list[int] = []

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    runs = np.zeros(mask.shape, np.int32) - 1
    prev: list[tuple[int, int, int]] = []
    for y in range(h):
        row = mask[y].view(np.int8)
        idx = np.flatnonzero(np.diff(np.concatenate(([0], row, [0]))))
        cur = []
        for s, e in zip(idx[0::2], idx[1::2]):
            lb = len(parent)
            parent.append(lb)
            cur.append((int(s), int(e), lb))
            for ps, pe, plb in prev:
                if ps < e and s < pe:
                    union(lb, plb)
        for s, e, lb in cur:
            runs[y, s:e] = lb
        prev = cur

    lab = np.zeros(mask.shape, np.int32) - 1
    n = 0
    remap: dict[int, int] = {}
    ys, xs = np.nonzero(runs >= 0)
    for y, x in zip(ys.tolist(), xs.tolist()):
        r = find(int(runs[y, x]))
        if r not in remap:
            remap[r] = n
            n += 1
        lab[y, x] = remap[r]
    return lab, n


def _dilate(m: np.ndarray, r: int) -> np.ndarray:
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            src = np.roll(np.roll(m, dy, 0), dx, 1)
            out |= src
    return out


def background(gray: np.ndarray, block: int = BLOCK) -> np.ndarray:
    """分块中值估水背底：块内鱼只占少数像素 ⇒ 中值就是水。"""
    h, w = gray.shape
    bh, bw = h // block, w // block
    crop = gray[:bh * block, :bw * block].reshape(bh, block, bw, block)
    med = np.median(crop.transpose(0, 2, 1, 3).reshape(bh, bw, block * block), axis=2)
    small = Image.fromarray(np.clip(med, 0, 255).astype(np.uint8), 'L')
    return np.asarray(small.resize((w, h), Image.BILINEAR), np.float32)


def detect(rgb: np.ndarray, verbose=True, fish_only=True):
    """检鱼团。`fish_only=True` 时只认**开阔水域里细长的小鱼**（严判）。

    ⚠️ 宽判（fish_only=False）会把气泡 / 悬浮颗粒 / 烟柱边缘全抓进来
    （v4b 实测宽判 1544 团 vs 严判 112 条）⇒ 减密必须用严判，否则整张图被抠烂。
    """
    gray = rgb @ LUMA
    bg = background(gray)
    d = gray - bg
    h, w = gray.shape
    if fish_only:
        y_lo, y_hi = int(h * FISH_TOP), int(h * FISH_BOT)
    else:
        y_lo, y_hi = 0, int(h * BED_TOP)
    water = d[y_lo:y_hi]

    mad = np.median(np.abs(water - np.median(water)))
    sigma = 1.4826 * mad
    thr = max(7.0, 4.0 * sigma)
    if verbose:
        print(f'  判定带y∈[{y_lo},{y_hi}) ({y_lo/h:.0%}~{y_hi/h:.0%})'
              f'  灰度 MAD σ={sigma:.2f} ⇒ 阈值 |d| > {thr:.1f}'
              f'{"（严判：只认细长小鱼）" if fish_only else "（宽判）"}')

    m = np.abs(d) > thr
    m[:y_lo] = False
    m[y_hi:] = False
    # 开运算：先腐蚀后膨胀，去掉 1px 噪点
    er = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            er &= np.roll(np.roll(m, dy, 0), dx, 1)
    m = _dilate(er, 1)

    lab, n = _label(m)
    if n == 0:
        return [], gray, bg, d, thr, None

    flat = lab.ravel()
    idx = np.flatnonzero(flat >= 0)
    counts = np.bincount(flat[idx], minlength=n)
    ys, xs = np.divmod(idx, w)
    y0 = np.full(n, 10 ** 9); y1 = np.full(n, -1)
    x0 = np.full(n, 10 ** 9); x1 = np.full(n, -1)
    np.minimum.at(y0, flat[idx], ys); np.maximum.at(y1, flat[idx], ys)
    np.minimum.at(x0, flat[idx], xs); np.maximum.at(x1, flat[idx], xs)
    peak = np.zeros(n)
    np.maximum.at(peak, flat[idx], np.abs(d).ravel()[idx])
    sel = flat[idx]
    cy = np.bincount(sel, weights=ys, minlength=n) / np.maximum(1, counts)
    cx = np.bincount(sel, weights=xs, minlength=n) / np.maximum(1, counts)

    a_min, a_max = (FISH_A_MIN, FISH_A_MAX) if fish_only else (MIN_AREA, MAX_AREA)
    ar_lo, ar_hi = (FISH_AR_LO, FISH_AR_HI) if fish_only else (1.0, 99.0)
    fill_min = FISH_FILL if fish_only else 0.15

    comps = []
    for i in range(n):
        a = int(counts[i])
        if a < a_min or a > a_max:
            continue
        sy, sx = int(y1[i] - y0[i] + 1), int(x1[i] - x0[i] + 1)
        if max(sy, sx) > (FISH_SIDE if fish_only else MAX_SIDE) or min(sy, sx) < 2:
            continue
        ar = max(sy, sx) / min(sy, sx)
        if ar < ar_lo or ar > ar_hi:
            continue
        fill = a / (sy * sx)
        if fill < fill_min:
            continue
        # 环带平坦度：鱼四周该是平整的水（岩壁内部处处高频 ⇒ 环带密度爆表）
        pad = 6
        ry0, ry1 = max(0, int(y0[i]) - pad), min(h, int(y1[i]) + pad + 1)
        rx0, rx1 = max(0, int(x0[i]) - pad), min(w, int(x1[i]) + pad + 1)
        sub = m[ry0:ry1, rx0:rx1]
        core = lab[ry0:ry1, rx0:rx1] == i
        ring = _dilate(core, 5) & ~_dilate(core, 2)
        ring_density = float((sub & ring).sum()) / max(1, int(ring.sum()))
        if ring_density > RING_FLAT:
            continue
        comps.append(dict(id=i, area=a, y0=int(y0[i]), y1=int(y1[i]),
                          x0=int(x0[i]), x1=int(x1[i]), cy=float(cy[i]),
                          cx=float(cx[i]), peak=float(peak[i]),
                          ring=ring_density))
    comps.sort(key=lambda c: -c['area'])
    return comps, gray, bg, d, thr, lab


def pick(comps, keep, gap=MIN_GAP):
    """按面积降序贪心，且保留者之间至少隔 gap —— 让剩下的鱼散开。"""
    kept = []
    for c in comps:
        if all((c['cx'] - k['cx']) ** 2 + (c['cy'] - k['cy']) ** 2 >= gap * gap for k in kept):
            kept.append(c)
        if len(kept) >= keep:
            break
    return kept


def pick_auto(comps, keep, gap_lo=32, gap_hi=400):
    """二分找**最小**间距，使保留数刚好≥ keep —— 即"要N 条就放它们最近"。

    ⚠️ 为什么不能固定 gap：`gap` 太大时不管怎么贪心都放不下 N 条（实测 L1 目标 123 条
    在 gap=110 下最多只放得下 28 条）⇒ 密度对齐目标就落空了。
    `gap_lo` 必须**小于**最终解，否则二分区间不含答案。
    先按目标条数反解间距，才真正做到"和现存图一致"。
    """
    if keep >= len(comps):
        return pick(comps, keep, gap=0)
    best = None
    lo, hi = gap_lo, gap_hi
    for _ in range(14):
        mid = (lo + hi) / 2
        k = pick(comps, keep, gap=mid)
        if len(k) >= keep:
            best = (mid, k)
            hi = mid
        else:
            lo = mid
    if best is None:
        return pick(comps, keep, gap=gap_lo)
    return best[1]


def _gauss(a: np.ndarray, sigma: float) -> np.ndarray:
    """可分离高斯（纯 numpy，支持任意通道数）。

    ⚠️ 不能用 `Image.fromarray(arr,'F').filter(GaussianBlur)` —— PIL 的 'F' 模式
    只吃二维数组，传 (h,w,3) 直接抛 `Too many dimensions: 3 > 2`。
    """
    if sigma <= 0:
        return a
    r = max(1, int(sigma * 3))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-(x * x) / np.float32(2.0 * sigma * sigma))
    k /= k.sum()
    out = np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), 0, a)
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), 1, out)


def _norm_blur(img: np.ndarray, w: np.ndarray, sigma: float) -> np.ndarray:
    """归一化卷积（push-pull 补洞）：blur(img*w)/blur(w)。

    这是唯一能"既填满又看不出方块"的补洞方式：
    · 分块中值 + 双线性 = **梯田/方块**（V6.69 画面上肉眼可见）
    · 逐团搬贴图 = **接缝 + 搬来鱼**
    · 归一化卷积 = 由四周水色**平滑插值**出来，天然无接缝、无块
    """
    num = _gauss(img * w[:, :, None], sigma)
    den = _gauss(w, sigma)
    return num / np.maximum(den, 1e-3)[:, :, None]


def inpaint(rgb: np.ndarray, comps, lab: np.ndarray, keep_ids=(), sigma=7.0) -> np.ndarray:
    """把 `comps` 里的鱼换成本地的"水"；`keep_ids` 的鱼原样留下。

    ⚠️ **V6.69 五次返工的共同根因 = 逐团"搬贴图"补洞**：
      ① 搬来的块带鱼 ⇒ 减密反而变密（L4 目标 51 条 → 补完再量 86 条）
      ② 块与原地亮度不连续 ⇒ **接缝本身**变成高频 ⇒ 又被检出成"鱼"
      ③ 羽化边缘 ⇒ 原鱼缘残留成半条
      ④ 换成"块中值背底" ⇒ 没有接缝了，但留下**24px 梯田方块**（2x 放大肉眼可见）
      ⑤ 换成"按高频强弱整图取舍" ⇒ 鱼的抗锯齿边 |残差| 只有 1~3 被当颗粒保留
         ⇒ 鱼只剩一圈"光环"，检出 51 → 72
    ⇒ 正解 = **连通域 mask 定位**（不靠强度阈值，不会留光环）
            + **归一化卷积**填色（`_norm_blur`，无接缝、无方块）
            + 颗粒从"最近干净水"按 0.5 强度叠回（补手感，不是补结构）
    """
    if not comps and not keep_ids:
        return rgb

    h, w = lab.shape
    # 待删鱼 + 3px 膨胀（吃掉抗锯齿边），羽化 2px 做过渡
    rm = np.zeros(lab.shape, bool)
    for c in comps:
        rm |= (lab == c['id'])
    if not rm.any():
        return rgb
    hole = _dilate(rm, 3)
    a = np.asarray(Image.fromarray((hole * 255).astype(np.uint8), 'L')
                   .filter(ImageFilter.GaussianBlur(2.0)), np.float32) / 255.0
    a3 = np.clip(a * 2.0, 0, 1)[:, :, None]        # 中心压到 1，确保鱼身彻底换掉

    # 填色：把洞（含 8px 外扩）当"缺值"，四周水色归一化卷积插值
    zone = _dilate(hole, 8)
    known = (~zone).astype(np.float32)
    fill = _norm_blur(rgb, known, sigma=sigma)

    out = rgb * (1 - a3) + fill * a3

    # 颗粒：补洞后画面会偏"干净"，从最近的干净水取残差（只含悬浮颗粒）
    if comps:
        gray = rgb @ LUMA
        # ⚠️ 残差**必须用平滑高通**，不能用 `background()` 的块中值 ——
        # 块中值本身带24px 梯田，rgb − 块中值 里就有块状误差，搬回来 = **一片方块**（肉眼可见）。
        ones = np.ones(rgb.shape[:2], np.float32)
        resid = rgb - _norm_blur(rgb, ones, sigma=5.0)
        busy = np.zeros(lab.shape, bool)
        for c in comps:
            busy |= (lab == c['id'])
        for c in comps:
            core = lab == c['id']
            y0, y1, x0, x1 = c['y0'], c['y1'], c['x0'], c['x1']
            sy, sx = y1 - y0 + 1, x1 - x0 + 1
            vy0, vy1 = max(0, y0 - 6), min(h, y1 + 7)
            vx0, vx1 = max(0, x0 - 6), min(w, x1 + 7)
            bh, bw = vy1 - vy0, vx1 - vx0
            m = _dilate(core[vy0:vy1, vx0:vx1], 3)
            ma = np.asarray(Image.fromarray((m * 255).astype(np.uint8), 'L')
                            .filter(ImageFilter.GaussianBlur(2.0)), np.float32) / 255.0
            ma3 = (np.clip(ma * 2.0, 0, 1) * 0.5)[:, :, None]   # 颗粒只回 50%，不能盖住鱼

            dist = int(max(sy, sx) * 1.8) + 12
            grain = None
            for k in range(1, 16):
                for ang in (0, 45, 90, 135, 180, 225, 270, 315):
                    r = dist * k
                    dy = int(round(r * np.sin(np.radians(ang))))
                    dx = int(round(r * np.cos(np.radians(ang))))
                    ty0, tx0 = vy0 + dy, vx0 + dx
                    ty1, tx1 = ty0 + bh, tx0 + bw
                    if ty0 < 0 or tx0 < 0 or ty1 > h or tx1 > w:
                        continue
                    if busy[ty0:ty1, tx0:tx1].any():
                        continue
                    grain = resid[ty0:ty1, tx0:tx1].copy()
                    busy[ty0:ty1, tx0:tx1] = True
                    break
                if grain is not None:
                    break
            if grain is None:
                continue
            sub = out[vy0:vy1, vx0:vx1]
            out[vy0:vy1, vx0:vx1] = sub * (1 - ma3) + np.clip(sub + grain, 0, 255) * ma3
    return out


def thin(rgb: np.ndarray, keep_n: int, gap=32, rounds=6, verbose=True):
    """把env 图里的鱼减到 `keep_n` 条（严判口径），**迭代到收敛**。

    为什么要迭代（V6.69 反复踩的坑）：
      · **检出的是"团"不是"条"** —— 一条鱼常被切成 2~3 团 ⇒ "保留 51 团" ≠ "51 条鱼"，
        一次补洞后再量往往 **超**目标（L4：目标 51 → 补完量到 72）。
      · 补洞的过渡边本身也可能造出可检出的团。
    ⇒ 每轮：检测 → 二分选保留 → 按 mask 填色 → **重新检测**，
      把"离已保留鱼太近的新团"也并入待删，直至连续两轮总数不再下降。
    返回 (结果图, 保留团列表, 轮次日志)。
    """
    cur = rgb
    log = []
    keep_xy: list[tuple[float, float]] = []
    for r in range(rounds):
        comps, gray, bg, d, thr, lab = detect(cur, verbose=False)
        if not comps:
            break
        # ⚠️ **已经保留的鱼必须先"认领"**，否则第 2 轮它会被当成待删删掉
        #（一条鱼常被切成多个团，重检测位置也会漂几 px ⇒ 用 24px 容差认领）
        still = []
        rest = []
        for c in comps:
            near = min(((c['cx'] - x) ** 2 + (c['cy'] - y) ** 2) ** .5
                       for x, y in keep_xy) if keep_xy else 1e9
            (still if near <= 24 else rest).append(c)
        need = max(0, keep_n - len(still))
        extra = pick_auto(rest, need, gap_lo=gap) if need else []
        kid = {c['id'] for c in still} | {c['id'] for c in extra}
        # 认领不到的旧位置（本轮没被检出）也保留计数，避免"越迭代越少"
        keep_xy = [(c['cx'], c['cy']) for c in still + extra]
        drop = [c for c in comps if c['id'] not in kid]
        log.append(f'    轮{r + 1}: 检出 {len(comps)}  保留 {len(keep_xy)}'
                   f'（认领{len(still)} + 新选 {len(extra)}）  本轮删 {len(drop)}')
        if not drop or len(drop) == len(comps):
            break
        cur = inpaint(cur, drop, lab)
    if verbose:
        print('\n'.join(log))
        print(f'    ⇒ 迭代 {len(log)} 轮，累计保留 {len(keep_xy)} 团')
    return cur, keep_xy, log


def luma_stats(im: Image.Image):
    g = im.convert('L')
    hist = g.histogram()
    tot = sum(hist)
    bright = 100.0 * sum(hist[91:]) / tot
    mean = sum(i * c for i, c in enumerate(hist)) / tot
    p = [luma_pct(g, q) for q in (50, 98, 99)]
    return bright, mean, p


def luma_pct(g: Image.Image, q: float) -> float:
    h = g.histogram()
    tot = sum(h)
    acc, target = 0, tot * q / 100.0
    for i, c in enumerate(h):
        acc += c
        if acc >= target:
            return float(i)
    return 255.0


def measure(path: str) -> int:
    """量一张图的鱼条数（同一套严判口径）⇒ 用来做"和参照图同密度"。"""
    rgb = np.asarray(Image.open(path).convert('RGB'), np.float32)
    comps, *_ = detect(rgb, verbose=False)
    return len(comps)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', required=True)
    ap.add_argument('--keep', type=int, default=None, help='保留几条鱼（与 --keep-frac 二选一）')
    ap.add_argument('--keep-frac', type=float, default=None, help='保留比例 0~1（按检出总数）')
    ap.add_argument('--gap', type=int, default=32, help='保留鱼之间的最小间距 px 下限（防"少而聚"；默认 32 交给二分反解）')
    ap.add_argument('--match', default=None, help='参照图路径：按它的鱼条数对齐（"和现存图一致"）')
    ap.add_argument('--auto-gap', action='store_true',
                    help='二分反解最小间距以放满 --keep/--match 的条数（默认开，--fixed-gap 关）')
    ap.add_argument('--fixed-gap', action='store_true', help='用固定 --gap，不用二分反解')
    ap.add_argument('--canvas', default=None, help='如 1536x984：中心裁到该画布（与现存图一致）')
    ap.add_argument('--wide', action='store_true', help='宽判（把气泡/颗粒/烟柱边缘也算进来）—— 减密别用')
    ap.add_argument('--rounds', type=int, default=6, help='迭代收敛轮数上限（检出的是"团"不是"条"，一次必偏多）')
    ap.add_argument('--measure-only', action='store_true', help='只量鱼密度，不出图')
    ap.add_argument('--debug', action='store_true')
    a = ap.parse_args()
    a.auto_gap = not a.fixed_gap

    src = Image.open(a.src).convert('RGB')
    print(f'[{Path(a.src).name}] {src.size[0]}x{src.size[1]}')

    # ⚠️ 先裁到目标画布再检测 —— 判定带是**按画布比例**算的
    #（1024 高图上66% 与 984 高图上 66% 差 26px 判定区，会切掉最下一排鱼）
    if a.canvas:
        cw, ch = (int(v) for v in a.canvas.lower().split('x'))
        w0, h0 = src.size
        if (cw, ch) != (w0, h0):
            src = src.crop(((w0 - cw) // 2, (h0 - ch) // 2,
                            (w0 - cw) // 2 + cw, (h0 - ch) // 2 + ch))
            print(f'  画布中心裁 {w0}x{h0} -> {src.size[0]}x{src.size[1]}（与现存图一致）')

    rgb = np.asarray(src, np.float32)
    if a.measure_only:
        n = len(detect(rgb, fish_only=not a.wide, verbose=False)[0])
        print(f'  鱼团{n} 条| {n / (src.size[0] * src.size[1] / 1e6):.1f} 条/百万像素')
        return 0

    if a.keep is not None:
        keep_n = a.keep
    elif a.keep_frac is not None:
        n0 = len(detect(rgb, fish_only=not a.wide, verbose=False)[0])
        keep_n = max(1, int(round(n0 * a.keep_frac)))
    elif a.match is not None:
        keep_n = measure(a.match)
        print(f'  参照 {Path(a.match).name} ⇒ 目标保留 {keep_n} 条（迭代收敛口径）')
    else:
        keep_n = 16
    gap_txt = f'间距二分反解，下限 {a.gap}px' if a.auto_gap else f'间距下限 {a.gap}px（固定）'
    print(f'  {gap_txt}')

    out, keep_xy, log = thin(rgb, keep_n, gap=a.gap, rounds=a.rounds)

    if a.debug:
        comps, *_ = detect(out, verbose=False)
        dbg = out.copy()
        for c in comps:
            col = (40, 255, 90)
            dbg[c['y0']:c['y1'] + 1, c['x0']:c['x0'] + 2] = col
            dbg[c['y0']:c['y1'] + 1, c['x1'] - 1:c['x1'] + 1] = col
            dbg[c['y0']:c['y0'] + 2, c['x0']:c['x1'] + 1] = col
            dbg[c['y1'] - 1:c['y1'] + 1, c['x0']:c['x1'] + 1] = col
        pp = Path(a.out).with_name(Path(a.out).name + '_debug')
        Image.fromarray(np.clip(dbg, 0, 255).astype(np.uint8)).save(pp.with_suffix('.png'))
        print(f'  -> {pp.with_suffix(".png")}（绿框 = 最终保留的鱼）')

    final_n = len(detect(out, verbose=False)[0])
    print(f'  收敛后实测{final_n} 条 | 目标 {keep_n} 条'
          f'（{"达标" if final_n <= keep_n * 1.15 else "仍偏多，请调 --keep"}）')
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


    op = Path(a.out)
    im.save(op.with_suffix('.png'))
    # ⚠️ quality 必须 95（= 现存游戏 webp 的档，反推自字节数112614@1536x984）。
    # 降到 82 会引入 8x8 块伪影，`measure_fish` 把它当鱼检出（L4 实测 60 → 89 条），
    # 也会让画面出现"看不见但存在"的块噪声。
    im.save(op.with_suffix('.webp'), quality=95, method=6)
    W, H = im.size
    s = max(1304 / W, 749 / H)
    big = im.resize((int(W * s + 0.5), int(H * s + 0.5)), Image.LANCZOS)
    big.crop(((big.width - 1304) // 2, (big.height - 749) // 2,
              (big.width - 1304) // 2 + 1304, (big.height - 749) // 2 + 749)) \
       .save(op.with_name(op.stem + '_ingame.png'))

    b, m, (p50, p98, p99) = luma_stats(im)
    print(f'  亮部(>90) {b:.1f}% | 均值 {m:.1f} | p50/p98/p99 {p50:.0f}/{p98:.0f}/{p99:.0f}')
    print(f'  L4 判据（局部光源）：p99>=130 {"PASS" if p99 >= 130 else "FAIL"} | 亮部>=1.5% '
          f'{"PASS" if b >= 1.5 else "FAIL"}')
    print(f'  -> {op.with_suffix(".png")} | {op.with_suffix(".webp")} | {op.stem}_ingame.png')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
