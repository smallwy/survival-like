#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
海生物素材「重新打光」后处理：抠浅色底 -> 裁到内容 -> 保持原宽高比缩放。

为什么需要它（2026-10-12）
--------------------------
用户反复反馈「海生物还是黑色的」。实测原素材（swarm/drift/dash）平均亮度只有
36~46（满值 255），亮部（>150）占比 0.0% —— 是资产本身没有中间调和高光，
不是渲染问题。解法是走图生图（image-to-image）保住原剪影与朝向，只重新打光。

生成模型返回的是**浅灰底 RGB 1024×1024**（请求 transparent 也不生效），
所以必须抠底，流程与 clean_portrait.py 一致：从画布边框泛洪，只清除与边缘
连通的浅色，生物内部的亮部（水母伞盖）被深色描边包住、不会被误删。

与 clean_portrait.py 的两点差异（都是本项目特有的）：
  1) **不归一化到 256×256 正方形**。游戏里贴图是按 setDisplaySize 拉伸显示的，
     曾经把它拉成正方形，而素材内容宽高比是 1.99/1.54/0.55 —— 等于把一条
     2:1 的长鱼压成方块（实测拉伸 1.54~1.99 倍）。所以这里**保持内容原始
     宽高比**输出，由游戏侧按比例显示。
  2) 输出长边 512（不是 256）：单位在屏幕上最大约 102px，512 有足够余量，
     而全项目只有 3 张敌人图，体积可忽略。
"""
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

KEY = (255, 0, 255)          # 泛洪用的键色（品红，生物本体几乎不可能正好是这个值）
BG_MIN = 170                 # 认为"这是背景"的亮度下限
OUT_LONG = 512               # 输出长边


def border_bg_mask(lum, thr=BG_MIN):
    """从画布四边出发，把与边缘连通的"亮像素"全标记出来。

    为什么不用 `PIL.ImageDraw.floodfill`：在 1024×1024 上实测**只填了 0.3%**
    （四角都变成了键色，但 (900,100) 仍是背景色），也就是泛洪中途就停了，
    而且不报错 —— 结果就是"抠图看起来跑了、其实背景还在"。
    自己的 BFS 是 O(N) 且行为确定的，调试成本低得多。
    """
    from collections import deque
    h, w = lum.shape
    bg = lum >= thr
    reach = np.zeros_like(bg)
    # 种子 = 四边上的亮像素
    seeds = []
    for x in range(w):
        if bg[0, x]: reach[0, x] = True; seeds.append((0, x))
        if bg[h - 1, x]: reach[h - 1, x] = True; seeds.append((h - 1, x))
    for y in range(h):
        if bg[y, 0]: reach[y, 0] = True; seeds.append((y, 0))
        if bg[y, w - 1]: reach[y, w - 1] = True; seeds.append((y, w - 1))
    dq = deque(seeds)
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not reach[ny, nx]:
                reach[ny, nx] = True
                dq.append((ny, nx))
    return reach


def clean(src, dst):
    im = Image.open(src).convert('RGB')
    arr = np.asarray(im).astype(np.int16)
    lum = arr.mean(axis=2)
    bg = border_bg_mask(lum)

    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # 腐蚀 1px：浅底抠图会在边缘留一圈浅色描边，吃掉一圈再补一点模糊，
    # 避免进游戏后每个单位套一圈白边。
    am = Image.fromarray(alpha).filter(ImageFilter.MinFilter(3))
    am = am.filter(ImageFilter.GaussianBlur(0.6))
    rgb = np.asarray(im).astype(np.uint8).copy()
    # 边缘像素仍带浅底，向深色方向钳一下，进一步压白边
    amv = np.asarray(am)
    edge = (amv > 0) & (amv < 250)
    rgb[edge] = (rgb[edge].astype(np.int16) * 0.75).astype(np.uint8)

    out = Image.fromarray(np.dstack([rgb, amv]), 'RGBA')
    bb = out.getbbox()
    if bb:
        out = out.crop(bb)
    # 保持宽高比：只按长边缩放
    k = OUT_LONG / max(out.size)
    if k < 1:
        out = out.resize((max(1, round(out.size[0] * k)), max(1, round(out.size[1] * k))),
                         Image.LANCZOS)
    out.save(dst)
    return 100 * bg.mean(), out


def stats(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(float)
    m = a[:, :, 3] > 10
    if m.sum() == 0:
        return None
    lum = a[:, :, :3][m].mean(axis=1)
    return im.size, 100 * m.mean(), lum.mean(), np.median(lum), 100 * (lum > 150).mean()


def old_ar(regen, name):
    """旧素材的内容宽高比（用来对照"是否还把长鱼拉成方块"）。"""
    im = Image.open(os.path.join(regen, name + '.png')).convert('RGBA')
    a = np.asarray(im)
    ys, xs = np.where(a[:, :, 3] > 10)
    return (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)


if __name__ == '__main__':
    regen = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         'web', 'src', 'assets', 'fish')
    files = sorted(glob.glob(os.path.join(regen, '_regen', '*.png')))
    if not files:
        sys.exit('_regen 下没有生成图')
    for f in files:
        # 用提示词里的关键词判断是哪一张（生成文件名是提示词截断）
        base = os.path.basename(f)
        if '梭形' in base:
            name = 'swarm'
        elif '水母' in base:
            name = 'drift'
        elif '翼型' in base:
            name = 'dash'
        else:
            print('跳过无法识别的文件:', base)
            continue
        dst = os.path.join(regen, '_regen', 'clean_%s.png' % name)
        bgpct, out = clean(f, dst)
        s = stats(dst)
        o = stats(os.path.join(regen, name + '.png'))
        print('[%s] 判为背景 %.1f%%  -> %dx%d' % (name, bgpct, out.size[0], out.size[1]))
        print('      新: 覆盖 %.1f%%  平均亮度 %.1f  亮部>150 占 %.1f%%'
              % (s[1], s[2], s[4]))
        print('      旧: 平均亮度 %.1f  亮部>150 占 %.1f%%  宽高比 %.2f -> 新 %.2f'
              % (o[2], o[4], old_ar(regen, name), out.size[0] / out.size[1]))
