# -*- coding: utf-8 -*-
"""放大截图局部，看清像素单位到底长什么样 / UI 有没有互相压字。

用法：python tools/zoom_shot.py <png> <x0> <y0> <x1> <y1> [倍数] [out.png]
"""
import sys
from PIL import Image

src = sys.argv[1]
x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
scale = int(sys.argv[6]) if len(sys.argv) > 6 else 4
out = sys.argv[7] if len(sys.argv) > 7 else '_zoom.png'

im = Image.open(src).convert('RGB')
crop = im.crop((x0, y0, x1, y1))
crop = crop.resize((crop.width * scale, crop.height * scale), Image.NEAREST)
crop.save(out)
print(f'{src} 裁 ({x0},{y0})-({x1},{y1}) x{scale} -> {out} {crop.size}')
