#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
UI 功能图标（主界面入口）的后处理：**已切好的透明底单件图 → 512×512 规范画布**。

为什么不能直接复用 `tools/process_item_art.py`（见 `docs/主界面版式_V6.38.md` §7.5 末）：
  · 立绘画布是 **2:1**（1200×600，`FILL=0.86`），图标是 **1:1**（512×512，`FILL=0.72`）；
  · 立绘靠"外周一圈深色描边"挡住泛洪，图标描边更粗但**内部暗面明度仅 48%**，
    与背景反差小，泛洪阈值必须重标，否则会吃进图形内部。

所以本脚本**不做抠底** —— 它吃的是已经抠好、已经切好单件的 png（alpha 通道即轮廓）。
抠底那一步在 `tools/preview_icon_tint.py` 里（出图 → 抠底 → 切分 → 乘色预览），
本脚本负责**最后一道"入引擎前的规范化"**：

  ① 按 alpha 裁剪到内容 bbox；
  ② 等比缩放到「外接圆直径 = 画布 72%」（`docs/主界面版式_V6.38.md` §7.1 A 表第 6 行）；
  ③ 居中贴到 512×512 全透明画布；
  ④ **单色化**（§7.1 B 表「单色化兜底」）：取明度 → 锁到冷白色相（R<G<B），
     并把 P99 明度归一化到满值。AI 出图对"只用一个色相"的服从度低，
     色相统一交给管线，让模型的自由度只服务于**形状**；
  ⑤ 自检并打印：可染性（P90 明度 ≥ 0.90）、留白率、内容尺寸。

为什么要"单色可染"：运行时四态（常态／悬停／按下／锁定）**全部靠 `sprite.color` 乘色得到**
（§7.3）。乘法只能压暗、不能提亮，所以基底必须接近纯白，否则 `UI.cyanDim` 会把图压成黑块。

用法：
    python tools/process_ui_icon.py                       # 全量处理并写盘
    python tools/process_ui_icon.py --check               # 只体检，不写盘
    python tools/process_ui_icon.py --silhouette          # 额外输出 24px 剪影自检条
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# 输入：出图 → 抠底 → 切分后的单件图（中文名，见 tools/preview_icon_tint.py）
SRC_DIR = ROOT / 'docs' / 'ui_concept' / 'icons_cut'
# 输出：**目标工程 cocos 的资源目录**（2026-10-13 晚改为单端；web 原型已冻结）。
# `resources/` 是 `resources.load()` 唯一认的目录名 —— 与 29 张立绘同一个落点根。
DST_DIR = ROOT / 'cocos' / 'assets' / 'resources' / 'ui' / 'icons'

CANVAS = 512        # 正方形画布边长（§7.1 A 表第 1 行）
FILL = 0.72         # 图形外接圆直径占画布比例（§7.1 A 表第 6 行，512 → 368px）
ALPHA_MIN = 40      # 低于此 alpha 视为透明（与 process_item_art.py 同口径）

# 冷白色相：**只定比例，不定绝对亮度**（绝对亮度会随 icons_cut/ 的画法漂移）
COLD_RGB = (0.94, 0.97, 1.00)

# 中文文件名 → 引擎 id。**id 是 art key 的一部分**（`icon_<id>`），
# 与 shared/uiArt.ts 的 UI_ICON_PATH 必须**一字不差**，否则 verify_cocos 会红。
NAME_MAP: dict[str, str] = {
    '图鉴':   'codex',
    '里程碑': 'milestone',
    '装置坞': 'dock',
    '海域':   'region',
    '设置':   'settings',
    '帮助':   'help',
}


def mono(im: Image.Image) -> Image.Image:
    """取明度 → 锁冷白色相 → P99 归一化到满值。

    只做**提亮**（增益 ≥ 1），永不压暗 —— 压暗会同时毁掉可染性与体积线索。
    冷白色相用 R<G<B 的比例表达：这是"一个色相"，不是三个色。
    """
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    op = alpha > ALPHA_MIN
    if not op.any():
        return im
    lum = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
    p99 = float(np.percentile(lum[op], 99))
    gain = 1.0 if p99 <= 1.0 else min(255.0 / p99, 1.15)   # 上限 1.15：防过曝削平受光面
    lum = np.clip(lum * gain, 0, 255)
    out = np.dstack([lum * COLD_RGB[0], lum * COLD_RGB[1], lum * COLD_RGB[2], alpha])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')


def normalize(im: Image.Image) -> Image.Image:
    """裁剪 → 按外接圆缩到 72% → 居中贴 512×512 全透明画布。"""
    im = im.convert('RGBA')
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    target = round(CANVAS * FILL)
    k = target / max(im.width, im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(im, ((CANVAS - im.width) // 2, (CANVAS - im.height) // 2))
    return canvas


def audit(canvas: Image.Image) -> dict:
    """§7.1 B 表的可验项。

    ⚠️ **判据是"受光面"，不是"所有不透明像素的中位数"**（这里踩过一次）：
    第一版用 P90 当"基底明度"，结果「帮助」（粗圆环 + 问号）和「设置」（三条粗滑杆）
    被判不达标 —— 它们**大面积都是描边档**（本来就该是暗的，§7.1 A 表第 4 行 24%），
    P90 自然落进暗区。那测的是"描边占多大比例"，不是"基底够不够亮"。

    正确的两个数：
      · `face` = P99 → **受光面**明度。可染性硬约束（≥ 0.95）：它决定乘 `UI.cyanDim`
        之后还出不出得来饱和青。§7.1 B "基底明度 ≥ 90%" 指的就是这个。
      · `dark` = P25 → **暗面档**明度（诊断，不阻塞）。低于 0.18 时乘 0.34 的常态色
        会接近纯黑，形状会糊 —— 这时该提亮**常态乘色**，而不是重出图。
    """
    b = np.asarray(canvas).astype(np.float32)
    op = b[:, :, 3] > ALPHA_MIN
    n = int(op.sum())
    if n == 0:
        return {'ok': False, 'why': '整张图是空的（alpha 全为 0）'}
    lum = (b[:, :, 0] * 0.2126 + b[:, :, 1] * 0.7152 + b[:, :, 2] * 0.0722)[op] / 255.0
    ys, xs = np.where(op)
    w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    return {
        'ok': True,
        'content': (int(w), int(h)),
        'fill_pct': 100.0 * max(w, h) / CANVAS,
        'cover_pct': 100.0 * n / (CANVAS * CANVAS),
        'face': float(np.percentile(lum, 99)),
        'dark': float(np.percentile(lum, 25)),
        'p50': float(np.percentile(lum, 50)),
    }


def silhouette(images: list[tuple[str, Image.Image]], dst: Path) -> None:
    """§7.4 的可辨识性判据：缩到 24px **涂成纯黑剪影**，还认得出来才算过。

    小尺寸那两张（设置 / 帮助）是**按 24 档单独出图**的，所以这里一并缩到 24 看最坏情况。
    """
    cell, gap = 96, 24
    w = len(images) * cell + (len(images) + 1) * gap
    h = cell + gap * 2 + 24
    sheet = Image.new('RGB', (w, h), (250, 252, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(images):
        x = gap + i * (cell + gap)
        small = im.resize((24, 24), Image.LANCZOS)
        a = np.asarray(small)[:, :, 3]
        sil = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
        sil.putalpha(Image.fromarray(a))
        px = np.asarray(sil).copy()
        px[:, :, :3] = 0                     # 纯黑
        sil = Image.fromarray(px, 'RGBA')
        bg = Image.new('RGB', (cell, cell), (250, 252, 255))
        bg.paste(sil, ((cell - 24) // 2, (cell - 24) // 2), sil)
        sheet.paste(bg, (x, gap))
        d.text((x + cell // 2 - 12, gap + cell + 4), name, fill=(60, 80, 95))
    sheet.save(dst)
    print(f'  · 24px 剪影自检 → {dst.relative_to(ROOT).as_posix()}')


def main() -> int:
    ap = argparse.ArgumentParser(description='UI 图标规范化（512×512 · 72% · 单色可染）')
    ap.add_argument('--check', action='store_true', help='只体检，不写盘')
    ap.add_argument('--silhouette', action='store_true', help='额外输出 24px 剪影自检条')
    ap.add_argument('--src', default=str(SRC_DIR))
    ap.add_argument('--dst', default=str(DST_DIR))
    args = ap.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    if not src.is_dir():
        print(f'[ui_icon] ❌ 找不到输入目录 {src}')
        return 1

    files = sorted(src.glob('*.png'))
    if not files:
        print(f'[ui_icon] ❌ {src} 下没有 png')
        return 1

    if not args.check:
        dst.mkdir(parents=True, exist_ok=True)

    print(f'[ui_icon] 画布 {CANVAS}×{CANVAS} · 外接圆 {round(CANVAS * FILL)}px '
          f'({FILL:.0%}) · 输入 {len(files)} 张')
    print(f'  {"id":10s} {"内容":>11s} {"留白率":>7s} {"覆盖":>6s} '
          f'{"受光面":>7s} {"中间":>6s} {"暗面":>6s}  判定')

    bad: list[str] = []
    kept: list[tuple[str, Image.Image]] = []
    unknown: list[str] = []

    for f in files:
        cid = NAME_MAP.get(f.stem)
        if cid is None:
            unknown.append(f.stem)
            continue
        canvas = normalize(mono(Image.open(f)))
        r = audit(canvas)
        if not r['ok']:
            bad.append(f'{cid}: {r["why"]}')
            print(f'  {cid:10s}  —— {r["why"]}')
            continue

        # 可染性硬约束（§7.1 B 表）：受光面 < 0.95 ⇒ 乘 UI.cyanDim 出的青不饱和
        notes = []
        if r['face'] < 0.95:
            notes.append(f'⚠️ 受光面 {r["face"]:.3f} < 0.95（可染性不达标）')
            bad.append(f'{cid}: 受光面明度 {r["face"]:.3f} < 0.95（可染性不达标）')
        if r['dark'] < 0.18:
            notes.append(f'⚠️ 暗面 {r["dark"]:.3f} 偏黑（乘常态色会糊，建议提亮常态乘色）')
        print(f'  {cid:10s} {r["content"][0]:>5d}×{r["content"][1]:<5d} '
              f'{r["fill_pct"]:>6.1f}% {r["cover_pct"]:>5.1f}% '
              f'{r["face"]:>7.3f} {r["p50"]:>6.3f} {r["dark"]:>6.3f}  '
              f'{"ok" if not notes else " / ".join(notes)}')

        kept.append((cid, canvas))
        if not args.check:
            out = dst / f'icon_{cid}.png'
            canvas.save(out, 'PNG', optimize=True)

    # 清单完整性：NAME_MAP 里的每个 id 都必须有对应输入 ——
    # 少一张的症状是"引擎里某个入口没图"，而它**不报错**，只会静默退回空槽位。
    got = {c for c, _ in kept}
    miss = sorted(set(NAME_MAP.values()) - got)
    if miss:
        bad.append('缺少图标：' + ' / '.join(miss))
    if unknown:
        bad.append('无法识别的文件名（检查 NAME_MAP）：' + ' / '.join(unknown))

    if args.silhouette and kept:
        silhouette(kept, ROOT / 'docs' / 'ui_concept' / '自检_24px剪影.png')

    if args.check:
        print('\n[ui_icon] （--check：未写盘）')
    else:
        print(f'\n[ui_icon] ✅ 写入 {len(kept)} 张 → {dst.relative_to(ROOT).as_posix()}')
        print('           这是 cocos 工程的资源目录（resources/ 下），无需再同步')

    if bad:
        print(f'\n[ui_icon] ❌ {len(bad)} 个问题：')
        for x in bad:
            print('  ✗ ' + x)
        return 1
    print('[ui_icon] ✅ 全部通过（可染性：受光面 ≥ 0.95 / 留白率 72% / 清单完整）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
