#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
击杀特效贴图处理 —— 纯黑底 → 透明底（发光贴图的标准做法）。

为什么用「亮度当 alpha」而不是四边泛洪抠底：
  发光特效的底虽然是纯黑，但辉光会一路渐变到接近黑，泛洪阈值**无论如何都切不干净**
  （调低了留一圈黑边，调高了把辉光削掉）。而发光贴图正确的做法是
  **alpha = 亮度**：黑的地方 alpha=0，亮的地方 alpha=1 —— 辉光自然衰减成透明，
  这正是 ADD/SCREEN 叠加想要的形状。RGB 保持原色不变（叠加模式只关心增量）。

用法：
    python tools/process_fx.py <源图.png> --cols 3 --names sh_ring,sh_burst,sh_bubble
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def split(img, n):
    w, h = img.size
    return [img.crop((int(w * i / n), 0, int(w * (i + 1) / n), h)) for i in range(n)]


def to_alpha(im, gamma=0.85, floor=0.03):
    """亮度 → alpha。gamma<1 让中等辉光多留一点；floor 抹掉极暗噪点。"""
    a = np.array(im.convert('RGB')).astype(np.float32) / 255.0
    lum = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
    al = np.clip((lum - floor) / (1 - floor), 0, 1) ** gamma
    out = np.dstack([(a * 255), al * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def trim(im, thr=6):
    ys, xs = np.where(np.array(im)[:, :, 3] > thr)
    if len(ys) == 0:
        return im
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def fit_square(im, size=512, fill=0.94):
    """放进正方形画布、内容占 fill（引擎里按正方形 sprite 用，缩放一致）。"""
    w, h = im.size
    s = min(size * fill / w, size * fill / h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = [a for a in sys.argv[1:] if a.startswith('--')]
    if not argv:
        print(__doc__)
        return 2
    src = argv[0]
    cols = 3
    names = []
    outdir = None
    for f in flags:
        if f.startswith('--cols='):
            cols = int(f.split('=', 1)[1])
        elif f.startswith('--names='):
            names = f.split('=', 1)[1].split(',')
        elif f.startswith('--out='):
            outdir = f.split('=', 1)[1]
    if not outdir:
        outdir = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'fx')
    os.makedirs(outdir, exist_ok=True)

    img = Image.open(src).convert('RGB')
    parts = split(img, cols)
    written = []
    for i, p in enumerate(parts):
        # 先把整块转 alpha 再按内容裁 —— 直接裁会连黑边一起裁进来
        al = to_alpha(p)
        bbox = al.getbbox()
        if bbox:
            al = al.crop(bbox)
        al = fit_square(al)
        name = names[i] if i < len(names) and names[i] else f'fx_{i + 1}'
        path = os.path.join(outdir, f'{name}.png')
        al.save(path)
        written.append(path)
        # 底色版（纯黑底）也留一份，给不支持透明混合的场合
        flat = Image.new('RGB', al.size, (0, 0, 0))
        flat.paste(al, (0, 0), al)
        flat.save(os.path.join(outdir, f'{name}_black.png'))
        # 覆盖率自检：alpha 均值太低=特效太弱，太高=没抠干净
        cover = np.array(al)[:, :, 3].mean() / 255.0
        print(f'  {name}.png  内容占画布 {cover * 100:.1f}%  '
              f'{"✅" if 0.03 < cover < 0.6 else "⚠️ 检查 alpha"}')
    print('输出目录：', outdir)
    return 0


if __name__ == '__main__':
    sys.exit(main())
