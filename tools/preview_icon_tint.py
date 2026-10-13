#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
图标「乘色预览」—— 验证「单色可染」规格：**白色不是成品色，是等着被染的底。**

为什么图标出图是白的（`docs/主界面版式_V6.38.md` §7.1）：
  运行时用 `sprite.color` **乘法**染色，而乘法只能压暗、不能提亮。
  所以基底必须接近纯白（明度 ≥90%），乘上 `UI.cyan` 才能得到饱和的青。
  素材本身若有彩色，再乘彩色 ⇒ 变暗变脏。

本脚本做三件事，把上面这条从"说法"变成"看得见的图"：
  ① 抠掉纯色背景（四边泛洪，与 `process_item_art.py` 同一策略）
  ② 按色板乘色（常态 / 悬停 / 按下 / 锁定四态）
  ③ 合成到真实的菜单槽位底上（`MENU.slot` / `cardHi` / `page`）

用法：
    python tools/preview_icon_tint.py <源图.png> [输出图.png]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_item_art import keep_components  # noqa: E402  （复用管线里的连通域过滤）

# ---- 色板（与 shared/theme.ts 对齐，改色板必须同步这里） ----
UI_CYAN = (0x4F, 0xE8, 0xFF)   # UI.cyan     悬停
UI_CYAN_HI = (0xC8, 0xF8, 0xFF)  # UI.cyanHi   按下
UI_CYAN_DIM = (0x1F, 0x6A, 0x7D)  # UI.cyanDim  常态
LOCK_GRAY = (0x6B, 0x7C, 0x88)  # 锁定态近似「去色 + 压暗」

MENU_PAGE = (0x0A, 0x0E, 0x14)
MENU_SLOT = (0x0C, 0x11, 0x17)
MENU_CARD_HI = (0x23, 0x2C, 0x39)
MENU_EDGE = (0x39, 0x45, 0x5A)

DEEP = (0x04, 0x07, 0x0D)  # 深海底（概念图同款）

# ---- 版式 ----
CELL = 200      # 单元格边长
GAP = 24        # 单元格间距
INNER = 36      # 图标距单元格边
RADIUS = 22     # 槽位底圆角

# 列 = 状态（第一列是「原样白」对照）
STATES = [
    ("原样", None, MENU_SLOT),          # 不染色，看基准
    ("常态", UI_CYAN_DIM, MENU_SLOT),
    ("悬停", UI_CYAN, MENU_CARD_HI),
    ("按下", UI_CYAN_HI, MENU_SLOT),
    ("锁定", LOCK_GRAY, MENU_PAGE),
]

MAGIC = (255, 0, 255)


def erode(mask: np.ndarray, n: int = 1) -> np.ndarray:
    """二值图内缩 n 圈（去掉泛洪后残留的抗锯齿浅边）。"""
    for _ in range(n):
        p = np.pad(mask, 1, constant_values=0)
        mask = np.minimum(
            np.minimum(p[:-2, 1:-1], p[2:, 1:-1]),
            np.minimum(p[1:-1, :-2], p[1:-1, 2:]),
        )
    return mask


def cutout(path: str) -> Image.Image:
    """四边泛洪抠底色，返回 RGBA。"""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    flood = im.copy()
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(flood, seed, MAGIC, thresh=14)
    f = np.array(flood)
    is_bg = (f[:, :, 0] == 255) & (f[:, :, 1] == 0) & (f[:, :, 2] == 255)
    alpha = (~is_bg).astype(np.uint8) * 255
    alpha = erode(alpha, 1)              # 收 1px，削掉边缘光晕
    alpha = keep_components(alpha)       # 甩掉底部水印与零散噪点（保留所有像样的连通域）
    rgba = np.dstack([np.array(im), alpha])
    return Image.fromarray(rgba, "RGBA")


def keep_largest(mask: np.ndarray) -> np.ndarray:
    """只保留**面积最大的连通域**（4 连通，走 PIL 的 floodfill，C 实现够快）。

    为什么切分需要它：列是**等宽**切的，而图标在画布上并不严格等距 ——
    相邻图标只要有一角越过列边界，就会被算进本格的 bbox。
    实测出现的症状：装置坞（舱门）那格右侧多出一条 20 列的竖直残条
    （实际是海域那卷轴的左端卷筒越界），bbox 从 355×355 涨到 380×355，
    预览里就是"图标右边挂着一条细线"。
    每格只应有一个图标主体，所以取最大簇即可。
    """
    m = mask > 0
    if not m.any():
        return mask
    img = Image.fromarray((m * 255).astype(np.uint8), "L")
    h, w = m.shape
    seen = np.zeros((h, w), bool)
    best = None
    best_area = 0
    ys_all, xs_all = np.nonzero(m)
    for y0, x0 in zip(ys_all.tolist(), xs_all.tolist()):
        if seen[y0, x0]:
            continue
        f = img.copy()
        ImageDraw.floodfill(f, (x0, y0), 128, thresh=0)
        comp = (np.array(f) == 128) & m
        seen |= comp
        area = int(comp.sum())
        if area > best_area:
            best_area, best = area, comp
    if best is None:
        return mask
    return best.astype(np.uint8) * 255


def split_row(im: Image.Image, n: int, largest: bool = False) -> list:
    """按等宽列切出 n 个图标，各自按内容 bbox 收紧。

    ⚠️ 这里**不能**用"最长连续非空段"去甩水印：内容本身可能是多块分离的
    （三条水平滑杆之间就有整行空白），那样只会留下最长的那一条 ——
    实测把 453×134（一条滑杆）当成了整个图标。水印的正确去处是
    `cutout()` 里的 `keep_components()`，按**连通域面积**甩。

    `largest=True` 时每格只保留最大连通域（见 `keep_largest`）——
    批量出图（一图多图标）时应当打开，否则相邻图标会互相越界污染。
    """
    w, h = im.size
    a = np.array(im)
    out = []
    for i in range(n):
        x0, x1 = int(w * i / n), int(w * (i + 1) / n)
        seg = a[:, x0:x1].copy()
        if largest:
            seg[:, :, 3] = keep_largest(seg[:, :, 3])
        ys, xs = np.where(seg[:, :, 3] > 16)
        if len(ys) == 0:
            continue
        crop = seg[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        out.append(Image.fromarray(crop, "RGBA"))
    return out


def fit(im: Image.Image, box: int) -> Image.Image:
    w, h = im.size
    s = min(box / w, box / h)
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def tinted(im: Image.Image, color) -> Image.Image:
    """乘法染色：结果 = 素材色 × 目标色。基底不够亮就压成黑 —— 这正是规格要防的。"""
    a = np.array(im).astype(np.float32)
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    if color is None:
        return im
    t = np.array(color, np.float32)
    rgb = rgb * (t / 255.0)
    return Image.fromarray(
        np.dstack([rgb.clip(0, 255).astype(np.uint8), alpha.astype(np.uint8)]), "RGBA"
    )


def render(icons: list, names: list, out_path: str, title: str = "") -> str:
    cols, rows = len(STATES), len(icons)
    W = GAP + cols * (CELL + GAP)
    H = GAP + (40 if title else 0) + rows * (CELL + GAP)
    canvas = Image.new("RGB", (W, H), DEEP)
    d = ImageDraw.Draw(canvas)
    top = GAP + (40 if title else 0)

    for r, ic in enumerate(icons):
        for c, (_, color, bg) in enumerate(STATES):
            x = GAP + c * (CELL + GAP)
            y = top + r * (CELL + GAP)
            d.rounded_rectangle(
                [x, y, x + CELL, y + CELL], radius=RADIUS,
                fill=bg, outline=MENU_EDGE, width=2,
            )
            icon = fit(tinted(ic, color), CELL - 2 * INNER)
            canvas.paste(icon, (x + (CELL - icon.width) // 2,
                                y + (CELL - icon.height) // 2), icon)

    canvas.save(out_path)
    return out_path


def save_cut(icons: list, names: list, outdir: str) -> list:
    """把每个图标单独存成 RGBA png —— 这才是能进引擎的素材。"""
    os.makedirs(outdir, exist_ok=True)
    written = []
    for i, ic in enumerate(icons):
        name = names[i] if i < len(names) and names[i] else f"icon_{i + 1}"
        p = os.path.join(outdir, f"{name}.png")
        ic.save(p)
        written.append(p)
    return written


def main() -> int:
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    if not argv:
        print(__doc__)
        return 2

    src = argv[0]
    cols = 3
    for f in flags:
        if f.startswith("--cols="):
            cols = int(f.split("=", 1)[1])

    names = []
    for f in flags:
        if f.startswith("--names="):
            names = f.split("=", 1)[1].split(",")

    cutdir = None
    for f in flags:
        if f.startswith("--cut="):
            cutdir = f.split("=", 1)[1]

    stem = os.path.splitext(os.path.basename(src))[0][:24]
    out = argv[1] if len(argv) > 1 else os.path.join(
        os.path.dirname(src), f"预览_乘色_{stem}.png"
    )

    sheet = cutout(src)
    icons = split_row(sheet, cols, largest="--largest" in flags)
    print(f"切出 {len(icons)} 个图标：{[i.size for i in icons]}")

    if cutdir:
        for p in save_cut(icons, names, cutdir):
            print("  已存素材：", p)

    # 先跑一遍「基底够不够亮」检查。
    # ⚠️ 判据是**受光面（P99）**，不是全部不透明像素的 P90 —— 与
    #    `tools/process_ui_icon.py` 的 `audit()` 保持一致（那里记录了踩坑经过）：
    #    P90 测的是"描边占多大比例"，描边多的图标（如粗圆环）会无辜被判不达标。
    for i, ic in enumerate(icons, 1):
        a = np.array(ic).astype(np.float32)
        opaque = a[:, :, 3] > 200
        if opaque.sum() == 0:
            continue
        lum = (0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]) / 255.0
        face = np.percentile(lum[opaque], 99)
        dark = np.percentile(lum[opaque], 25)
        verdict = "✅" if face >= 0.90 else ("⚠️ 偏低" if face >= 0.75 else "❌ 太暗")
        print(f"  图标{i}：受光面 {face:.3f} / 暗面 {dark:.3f}  {verdict}")

    p = render(icons, [], out)
    print("已输出：", p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
