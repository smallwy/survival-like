# -*- coding: utf-8 -*-
"""把三张预处理好的侧视机体**统一到同一张画布**，再落到真源目录。

为什么必须统一：`DiveGame.ts` 的 `SUB_HULL` 只有**一套**几何（画布尺寸 + 躯干在画布中的位置）。
三张图各自 `prep_sub_art.py` 出来的画布高不同、躯干 y 不同 ⇒ 直接装上去，
挂点会整体平移出艇身，而**引擎不报错**。

做法：按**躯干**对齐 —— 三张的躯干都已被预处理成 352×224，所以只要把每张
平移，让躯干落在同一位置 (28, 102)，画布统一 408×361 即可。

V6.85b 追加：`hue` = 可选的**色相旋转（度）**。理由见下面 RAIA 那条。

用法：python tools/normalize_sub_art.py
"""
import colorsys
import os
from PIL import Image

CANVAS = (408, 361)          # 统一画布（取三张里最大的边距）
TRUNK_XY = (28, 102)         # 统一后的躯干左上角

# (源文件, 目标, 源图里躯干左上 y, 色相旋转)
JOBS = [
    ('docs/shots/sub_art/02_v3_lumen.png',      'web/src/assets/sub/sub_lumen.png',  26, 0),
    # ★ RAIA 为什么用第一版主体 + 换色：
    #   第二版（尖锐梭形 + 大翼）在 `prep_sub_art.py` 里**过不了几何关** ——
    #   预处理用"每列高度的众数"量躯干（本意是排除鳍），但大翼横跨太多列 ⇒ 被算进躯干 ⇒
    #   垂直拉伸 2.5×（判据 ≤1.8×），出来是个被压扁的绿球、鳍还被轮廓裁掉。
    #   ⇒ 保留第一版**能过几何**的胖体+撞角+侧鳍，用**色相**补区分度（teal → jade，见 subs.ts 的主题色）。
    ('docs/shots/sub_art/02_对齐成品_raia.png', 'web/src/assets/sub/sub_raia.png',   98, -38),
    ('docs/shots/sub_art/02_v3_bathy.png',      'web/src/assets/sub/sub_bathy.png',  87, 0),
]


def hue_rotate(im: Image.Image, deg: float) -> Image.Image:
    """整图色相旋转（保住 alpha 与明度）。用于把机体挪到它自己的主题色上。"""
    if deg == 0:
        return im
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, ll, ss = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            hh = (hh + deg / 360.0) % 1.0
            r2, g2, b2 = colorsys.hls_to_rgb(hh, ll, ss)
            px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    return im


def main():
    for src, dst, trunk_y, hue in JOBS:
        im = Image.open(src).convert('RGBA')
        im = hue_rotate(im, hue)
        canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
        dy = TRUNK_XY[1] - trunk_y          # 正 = 往下挪（顶部超出部分自然被裁）
        canvas.alpha_composite(im, (0, dy))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        canvas.save(dst)
        a = canvas.split()[3]
        fg = sum(1 for p in a.get_flattened_data() if p > 8)
        print(f'{os.path.basename(dst):18s} {CANVAS[0]}x{CANVAS[1]}  dy={dy:+d}  hue={hue:+d}°  '
              f'前景 {fg / (CANVAS[0] * CANVAS[1]) * 100:.2f}%')


if __name__ == '__main__':
    main()
