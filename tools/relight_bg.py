#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
关卡背景「规范 + 重照明」工具。

为什么需要它
------------
L1~L5 是五张独立生成的图，AI 出图**每张的整体曝光都不一样**。靠"再生成一次"
撞亮度是不可控的（每次结果随机）。本工具把「尺寸规范化」与「亮度归一」拆成
两个可重复的步骤，亮度是**算出来的**，不是碰出来的。

用法
----
  # 只看现状（不改文件）
  python tools/relight_bg.py probe cocos/assets/resources/env/L1.png

  # 规范化尺寸 + 按目标亮度重照明 + 去角标，输出到新文件
  python tools/relight_bg.py apply <src> --out <dst> --target 0.35 \
      --size 1536x984 --crop-bottom 40

  # 五层一起体检 + 单调性校验
  python tools/relight_bg.py ladder --dir cocos/assets/resources/env

亮度口径
--------
`sRGB 相对亮度 luma = 0.2126R + 0.7152G + 0.0722B`（0~1，不做 gamma 线性化）。
与 `docs/L1背景亮度规格_V6.40.md` 中的自检脚本**同一口径** —— 两处数字必须能对上。

重照明的做法
------------
**sRGB 域纯 gamma 曲线** `out = v^p`，用二分法解出 `p` 使平均亮度精确等于目标。

为什么不用"线性域乘增益"：亮度是 sRGB 值的线性组合（`luma = Σw·v`），而在线性域
乘 g 等价于 sRGB 域乘 `g^(1/2.2)` —— 两者不是同一个数，直接缩放**打不准目标**
（实测：要 0.34 只到 0.194）。而且亮部会被削顶（光柱变白斑）。

gamma 曲线的三个好处：① 端点不变（纯黑仍纯黑、纯白仍纯白）② 无削顶
③ 提亮时**先抬暗部再抬亮部**，正好符合"深海图要变亮但不能变成一片白"的诉求。
代价是同时改变对比度 —— 对背景图这是可接受的（甚至想要的）。
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def to_arr(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert('RGB'), dtype=np.float32) / 255.0


def luma(a: np.ndarray) -> np.ndarray:
    return a @ LUMA


def metrics(im: Image.Image) -> dict:
    a = to_arr(im)
    L = luma(a)
    h = L.shape[0]
    return {
        'w': im.size[0], 'h': im.size[1],
        'mean': float(L.mean()),
        'median': float(np.median(L)),
        'p90': float(np.percentile(L, 90)),
        'p99': float(np.percentile(L, 99)),
        'top': float(L[: h // 3, :].mean()),
        'bottom': float(L[int(h * 0.66):, :].mean()),
        'center_sd': float(L[h // 5: h * 4 // 5, L.shape[1] // 5: L.shape[1] * 4 // 5].std()),
    }


def report(name: str, m: dict) -> None:
    print(f"{name:<22} {m['w']}x{m['h']:<6} "
          f"mean={m['mean']:.3f}  p90={m['p90']:.3f}  上1/3={m['top']:.3f}  "
          f"下1/3={m['bottom']:.3f}  中央sd={m['center_sd']:.3f}")


def resize_cover(im: Image.Image, tw: int, th: int) -> Image.Image:
    """缩放到目标尺寸。比目标宽就按高对齐裁两侧，反之按宽对齐裁上下。"""
    sw, sh = im.size
    k = max(tw / sw, th / sh)
    nw, nh = max(tw, round(sw * k)), max(th, round(sh * k))
    im = im.resize((nw, nh), Image.LANCZOS)
    x = (nw - tw) // 2
    y = (nh - th) // 2
    return im.crop((x, y, x + tw, y + th))


def erase_corner(im: Image.Image, w: int, h: int, feather: int = 16) -> Image.Image:
    """把**右下角 w×h** 的区域用其正上方的**纵向镜像**内容填掉 —— 用于抹掉角标/水印。

    为什么是"镜像正上方"而不是"模糊/涂黑"：
      · 镜像的首行 = 紧邻其上的那一行 ⇒ **上接缝天然连续**，不会出现硬边；
      · 该区域（深海图的右下角）是低细节暗部岩壁，纹理方向反转看不出来；
      · 比高斯模糊强 —— 模糊会留下一块"明显被抹过"的平板。
    左接缝做 `feather` 像素线性羽化，与未改动区域过渡。
    """
    a = np.asarray(im.convert('RGB'), dtype=np.float32) / 255.0
    H, W = a.shape[:2]
    b = min(h, H)
    ww = min(w, W)
    x0, y0 = W - ww, H - b
    top = max(0, y0 - b)
    src = a[top:y0, x0:W]
    if src.shape[0] < b:                      # 上方空间不够，直接复制可用部分
        src = np.concatenate([np.repeat(src[:1], b - src.shape[0], axis=0), src], axis=0)
    patch = src[::-1].copy()
    for k in range(min(feather, ww)):         # 左接缝羽化
        t = (k + 1) / (feather + 1)
        patch[:, k] = a[y0:H, x0 + k] * (1 - t) + patch[:, k] * t
    a[y0:H, x0:W] = patch
    return Image.fromarray((np.clip(a, 0, 1) * 255.0 + 0.5).astype(np.uint8), 'RGB')


def relight(im: Image.Image, target: float, tol: float = 0.002) -> Image.Image:
    """把整图平均亮度精确拉到 target（sRGB 域 gamma 曲线 + 二分求解）。

    `luma` 是 sRGB 通道值的线性组合，所以可以直接用**各通道幂后的均值**加权求和，
    不必逐像素展开（省一半内存、快很多）。
    """
    a = np.clip(to_arr(im), 0.0, 1.0)
    cur = float(luma(a).mean())
    if cur <= 1e-6 or abs(cur - target) < tol:
        return im

    def mean_at(p: float) -> float:
        # E[luma(v^p)] = w·E[v^p] —— 线性组合可先对通道求均值
        ch = np.power(a, p).mean(axis=(0, 1), dtype=np.float64)
        return float(ch @ LUMA)

    lo, hi = 0.15, 4.0          # p 越大越暗；mean_at 关于 p 单调递减
    for _ in range(28):
        mid = (lo + hi) * 0.5
        if mean_at(mid) > target:
            lo = mid            # 太亮 -> 需要更大的 p
        else:
            hi = mid
        if hi - lo < 1e-4:
            break
    p = (lo + hi) * 0.5
    out = np.power(a, p)
    print(f'   relight: 亮度 {cur:.3f} -> {mean_at(p):.3f}  (gamma p={p:.4f})')
    return Image.fromarray((np.clip(out, 0, 1) * 255.0 + 0.5).astype(np.uint8), 'RGB')


def cmd_probe(args: argparse.Namespace) -> int:
    for p in args.paths:
        if not os.path.exists(p):
            print(f'MISSING {p}')
            continue
        im = Image.open(p)
        report(os.path.basename(p), metrics(im))
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    im = Image.open(args.src)
    if args.crop_bottom:
        w, h = im.size
        im = im.crop((0, 0, w, h - args.crop_bottom))
    if args.size:
        tw, th = (int(v) for v in args.size.lower().split('x'))
        im = resize_cover(im, tw, th)
    if args.erase_corner:
        ew, eh = (int(v) for v in args.erase_corner.lower().split('x'))
        im = erase_corner(im, ew, eh)
        print(f'   erase_corner: 抹掉右下角 {ew}x{eh}')
    if args.target:
        im = relight(im, args.target)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    im.save(args.out)
    print(f'-> {args.out}')
    report(os.path.basename(args.out), metrics(im))
    return 0


def cmd_ladder(args: argparse.Namespace) -> int:
    ms = []
    for i in range(1, 6):
        p = os.path.join(args.dir, f'L{i}.png')
        if not os.path.exists(p):
            print(f'MISSING {p}')
            continue
        m = metrics(Image.open(p))
        ms.append((i, m))
        report(f'L{i}.png', m)
    if len(ms) >= 2:
        means = [m['mean'] for _, m in ms]
        mono = all(means[k] > means[k + 1] for k in range(len(means) - 1))
        print(f"\n单调递降 L1>L2>L3>L4>L5 : {'OK' if mono else '✗ 违反'}")
        for k in range(len(means) - 1):
            d = means[k] - means[k + 1]
            flag = '  <-- 逆序!' if d <= 0 else ''
            print(f'  L{ms[k][0]}->L{ms[k+1][0]}  Δ={d:+.3f}{flag}')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description='关卡背景规范化 / 重照明')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p1 = sub.add_parser('probe', help='只读体检')
    p1.add_argument('paths', nargs='+')
    p1.set_defaults(func=cmd_probe)

    p2 = sub.add_parser('apply', help='规范化 + 重照明')
    p2.add_argument('src')
    p2.add_argument('--out', required=True)
    p2.add_argument('--target', type=float, default=None, help='目标平均亮度，如 0.35')
    p2.add_argument('--size', default=None, help='目标尺寸，如 1536x984')
    p2.add_argument('--crop-bottom', type=int, default=0, help='先裁掉底部 N 像素（去角标）')
    p2.add_argument('--erase-corner', default=None,
                    help='再用镜像填充抹掉右下角 WxH（如 200x70）—— 比裁剪更省内容')
    p2.set_defaults(func=cmd_apply)

    p3 = sub.add_parser('ladder', help='五层亮度体检 + 单调性校验')
    p3.add_argument('--dir', required=True)
    p3.set_defaults(func=cmd_ladder)

    args = ap.parse_args()
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
