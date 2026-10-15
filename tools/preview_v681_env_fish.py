#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V6.81 背景图"冻结的鱼"诊断 + 去鱼对照 —— **参数级示意，非实机渲染**。

为什么要有这张图
----------------
用户 2026-10-15：**「每个场景底图都有冻结的鱼一样 是静态的 感觉很假」**。
这是**同一条被报第二次** —— V6.70 已经给过一版补丁（`stepBgDrift()`：让整张背景图
按 Lissajous 慢漂 ±26px / 周期 31s·47s）。本次要先证明"那版为什么不够"，再给方案。

图里说三件事
------------
① **背景图确实带鱼**，且五带都有（`cocos/assets/resources/env/L*.png`）。
② **去鱼之后长什么样**（真图，用与 `thin_fish.py` 同一套归一化卷积补洞）。
③ **"减密"为什么没解决**：`thin_fish.detect()` 的严判口径是"细长小鱼"，
   L1 上检出 169 条里 **135 条落在 y<300**（丁达尔光柱里的细碎斑点），
   而玩家一眼看到的那排大鱼（长边 40~90px）**只有 5 个**被抓到
   ⇒ 它的密度指标 ≠ 玩家看到的东西。

⚠️ 去鱼只是**提案预览**，不是已交付资产：补洞会留极淡的"水痕"（见 AFTER 里鱼的位置），
   正式落地要么重出图（提示词里排除生物），要么人工精修。
⚠️ 本文件与 `cocos/assets/scripts/view/DiveGame.ts` 的 `stepBgDrift` 常量耦合：改那边要同步。

输出：docs/shots/v681_env_fish.png
"""

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import thin_fish as T  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_DIR = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'env')
# ⚠️ "现状"必须读**去鱼之前的原图**。V6.81 已把 `env/L*.png` 换成去鱼版，
#    所以 BEFORE 列只能取备份（`defish_env.py --write` 时自动落的）。
BEFORE_DIR = os.path.join(ROOT, 'docs', 'shots', 'env_v2', '_backup_pre_defish_V6.81')
OUT = os.path.join(ROOT, 'docs', 'shots', 'v681_env_fish.png')

W, H = 1304, 749                     # 实机设计分辨率
SG_W, SG_H = 560, 322                # 每格缩略图（= 实机裁切 ×0.4295）
PAD, GAP = 18, 10
HEAD, FOOT = 74, 138
COL1 = (30, 40, 52)

# ---- 去鱼的判定参数（每个都有依据，见脚本 docstring）----
TOPY, BOTY = 0.30, 0.72              # 不碰光柱区 / 不碰海床
AMIN, AMAX = 60, 4000
SIDE_MAX, FILL_MIN = 200, 0.34
SIGMA = 8.0
THR = 5.0

# ---- 主题色 ----
C_CYAN = (79, 232, 255)
C_CYAN_HI = (200, 248, 255)
C_AMBER = (255, 209, 102)
C_DANGER = (255, 46, 99)
C_DIM = (128, 160, 176)
C_JADE = (127, 255, 212)

FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'
_fonts: dict[int, ImageFont.FreeTypeFont] = {}


def F(size: int) -> ImageFont.FreeTypeFont:
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(FONT_PATH, size)
    return _fonts[size]


# ---------------------------------------------------------------------------
# 去鱼：口径在 `tools/defish_env.py`（★ 单一真源，⛔ 别在这里再抄一份）
# ---------------------------------------------------------------------------
import defish_env as DF  # noqa: E402


def ingame(path_or_arr) -> Image.Image:
    """按 1304×749 cover 裁切（与实机 `bgNode` 的 cover 算法同口径）。"""
    if isinstance(path_or_arr, str):
        im = Image.open(path_or_arr).convert('RGB')
    else:
        im = Image.fromarray(np.clip(path_or_arr, 0, 255).astype(np.uint8))
    W0, H0 = im.size
    s = max(W / W0, H / H0)
    big = im.resize((int(W0 * s + 0.5), int(H0 * s + 0.5)), Image.LANCZOS)
    return big.crop(((big.width - W) // 2, (big.height - H) // 2,
                     (big.width - W) // 2 + W, (big.height - H) // 2 + H))


def detect_n(arr: np.ndarray) -> int:
    return len(T.detect(arr, verbose=False)[0])


def main() -> int:
    strip = ['L1', 'L2', 'L3', 'L4', 'L5']
    data = []
    for name in strip:
        # BEFORE = 备份的原图；AFTER = **已经落到工程里**的去鱼版（cocos PNG）
        # —— 不再在这里重跑一遍去鱼，否则这张图会变成"算法的预览"而不是"交付的样子"。
        b_arr = DF.to_rgb(Image.open(os.path.join(BEFORE_DIR, name + '.webp')))
        a_arr = DF.to_rgb(Image.open(os.path.join(ENV_DIR, name + '.png')))
        n0, n1 = detect_n(b_arr), detect_n(a_arr)
        data.append((name, ingame(b_arr), ingame(a_arr), f'{n0} → {n1}'))
        print(f'{name}: 检出 {n0} → {n1} 条')

    # L1 主证据（两格大图）+ 五带条带（每带 现状/去鱼 两小格）
    BAND_W, BAND_H = 240, 138
    BW = PAD * 2 + BAND_W * 5 + GAP * 4
    w = max(PAD * 2 + SG_W * 2 + GAP, BW)
    ROW1 = SG_H + GAP + 46
    ROW2 = BAND_H + GAP + 24
    h = HEAD + ROW1 + ROW2 + FOOT
    im = Image.new('RGB', (w, h), COL1)
    d = ImageDraw.Draw(im)

    d.text((PAD, 12), '背景图「冻结的鱼」· 诊断与去鱼对照（V6.81）', font=F(19), fill=C_CYAN_HI)
    d.text((PAD, 42), '实机 1304×749 cover 裁切 · 参数级示意（非实机渲染）· 左=现状 / 右=去鱼后',
           font=F(12), fill=C_DIM)

    # ---- 第 1 行：L1 主证据 ----
    name, before, after, n = data[0]
    for c, (img, tag, col) in enumerate(((before, '现状', C_AMBER), (after, '去鱼后', C_JADE))):
        x0 = PAD + c * (SG_W + GAP)
        im.paste(img.resize((SG_W, SG_H), Image.LANCZOS), (x0, HEAD))
        d.rectangle([x0, HEAD, x0 + SG_W - 1, HEAD + SG_H - 1], outline=(60, 80, 96))
        d.text((x0 + 2, HEAD + SG_H + 5), f'L1 阳光带 · 背景图{tag}', font=F(13), fill=col)
    # 红框圈出「玩家一眼看到的那排鱼」（ingame 坐标由 cover 反推：实图 y545~580 → 实机 y420~450）
    d.rectangle([PAD + 110 * SG_W // W, HEAD + 400 * SG_H // H,
                 PAD + 780 * SG_W // W, HEAD + 470 * SG_H // H], outline=C_DANGER)
    d.text((PAD + SG_W + GAP + 6, HEAD + 8),
           '红框 = 玩家一眼看到的那排鱼', font=F(12), fill=C_DANGER)

    # ---- 第 2 行：五带条带 ----
    y0 = HEAD + ROW1
    d.text((PAD, y0 - 20), '五带背景图（每格：上=现状 / 下=去鱼后）', font=F(13), fill=C_CYAN_HI)
    for i, (nm, bf, af, cnt) in enumerate(data):
        x0 = PAD + i * (BAND_W + GAP)
        half = BAND_H // 2
        im.paste(bf.resize((BAND_W, half), Image.LANCZOS), (x0, y0))
        im.paste(af.resize((BAND_W, half), Image.LANCZOS), (x0, y0 + half))
        d.rectangle([x0, y0, x0 + BAND_W - 1, y0 + BAND_H - 1], outline=(60, 80, 96))
        d.line((x0, y0 + half, x0 + BAND_W, y0 + half), fill=C_DANGER, width=1)
        d.text((x0 + 2, y0 + BAND_H + 4), f'{nm}  检出 {cnt} 条', font=F(12), fill=C_DIM)

    fy = h - FOOT + 6
    d.text((PAD, fy), '为什么 V6.70 的「整图慢漂」救不回来：', font=F(14), fill=C_DANGER)
    d.text((PAD, fy + 22),
           '位图里的鱼不能摆尾、不能分层，整张图平移 ⇒ 一群鱼以完全相同的速度和方向滑过去，'
           '读作「照片在平移」，不读作「鱼在游」。', font=F(12), fill=C_DIM)
    d.text((PAD, fy + 44),
           '为什么「减密到参照密度」也没解决：detect() 严判只认细长小鱼 ⇒ L1 检出 169 条里 135 条在 y<300'
           '（光柱碎斑），玩家看到的 40~90px 大鱼只命中 5 个。', font=F(12), fill=C_DIM)
    d.text((PAD, fy + 66),
           '结论：鱼只能有一个来源 —— 会动的那一层（渲染层远景鱼群）。背景图里的鱼应清零。',
           font=F(13), fill=C_JADE)
    d.text((PAD, fy + 88),
           '⚠️ 「检出」是 thin_fish 的严判口径，且**经过 webp q95 之后会把编码噪声也算成鱼**'
           '（L1 实测：纯 PNG 结果 11 条，webp 往返后 25 条）—— 这部分肉眼不可见，不是没去掉。',
           font=F(12), fill=C_DIM)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT)
    print(f'-> {OUT}  {im.size}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
