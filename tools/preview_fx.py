#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
击杀特效「实景预览」—— 把三张特效叠到真实战斗背景上，验证**在暗底上看得清**。

为什么不能只看透明底的单图：特效贴图的 alpha 是**亮度导出的**，它的观感
完全取决于"叠在什么底色上"。在白色查看器里看是一回事，叠在 L3 那种
近黑岩壁上又是另一回事 —— 本脚本就是为了在离线阶段把这件事看清。
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'fx')
ENV = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'env')


def cover(im, w, h):
    iw, ih = im.size
    s = max(w / iw, h / ih)
    im = im.resize((round(iw * s), round(ih * s)), Image.LANCZOS)
    return im.crop(((im.width - w) // 2, (im.height - h) // 2,
                    (im.width - w) // 2 + w, (im.height - h) // 2 + h))


def main():
    out = os.path.join(ROOT, 'docs', 'ui_concept', '预览_击杀特效_实景.png')
    W, H = 1304, 749
    # 用 L3（深渊岩壁）做底 —— 与最终战斗环境一致
    bg = cover(Image.open(os.path.join(ENV, 'L3.png')).convert('RGB'), W, H).convert('RGBA')

    shots = [
        ('sh_ring', 260, (360, 300)),      # 普通小怪：环
        ('sh_burst', 520, (760, 340)),     # Boss：爆散
        ('sh_bubble', 300, (980, 520)),    # 水母：水泡
    ]
    for name, size, (cx, cy) in shots:
        fx = Image.open(os.path.join(FX, name + '.png')).convert('RGBA')
        fx = fx.resize((size, size), Image.LANCZOS)
        # 屏幕叠加：与引擎里的普通 alpha 合成等价（不假装引擎用了 ADD）
        bg.alpha_composite(fx, (cx - size // 2, cy - size // 2))

    bg.convert('RGB').save(out, quality=95)
    print('已输出：', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
