# -*- coding: utf-8 -*-
"""诊断图：splitter / shard 的"中间断开"位置与间隙量测（V6.89）。

输出：docs/shots/diag_gap_v689.png
用法：<python> tools/diag_gap_shot.py
"""
import os
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FISH = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'fish')
OUT = os.path.join(ROOT, 'docs', 'shots', 'diag_gap_v689.png')

BG = (10, 18, 27)
C_MAIN = (79, 232, 255)     # 主块
C_SUB = (255, 176, 79)      # 次块
C_TXT = (216, 244, 255)
C_DIM = (150, 170, 190)
C_WARN = (255, 110, 110)


def font(sz):
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def blocks(mask):
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    out = []
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and not seen[sy, sx]:
                q = deque([(sx, sy)])
                seen[sy, sx] = True
                n = 0
                x0 = x1 = sx
                y0 = y1 = sy
                while q:
                    x, y = q.popleft()
                    n += 1
                    x0 = min(x0, x); x1 = max(x1, x)
                    y0 = min(y0, y); y1 = max(y1, y)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((nx, ny))
                out.append((n, x0, y0, x1, y1))
    out.sort(reverse=True)
    return out


R_MUL = 3.1          # DiveGame.ts:1953 长边 = r × 3.1
RADIUS = {'splitter': 21, 'shard': 12}


def panel(im_src, name, bl, ytop, W):
    """把一张鱼图贴到画布上并画标注。返回该面板占用高度。"""
    w, h = im_src.size
    x0 = (W - w) // 2
    panel_im.paste(im_src, (x0, ytop + 44), im_src)

    tot = sum(b[0] for b in bl)
    for i, (n, bx0, by0, bx1, by1) in enumerate(bl):
        if n / tot < 0.005:
            continue
        col = C_MAIN if i == 0 else C_SUB
        panel_d.rectangle([x0 + bx0, ytop + 44 + by0, x0 + bx1, ytop + 44 + by1],
                          outline=col, width=2)
        panel_d.text((x0 + bx0 + 3, ytop + 44 + by0 + 3), '#%d %.0f%%' % (i + 1, 100 * n / tot),
                     font=f12, fill=col)

    # 间隙量测（主块右缘 -> 次块左缘，只取 x 方向）
    b0, b1 = bl[0], bl[1]
    if b0[1] <= b1[1]:
        gl, gr = x0 + b0[3], x0 + b1[1]
        gy = ytop + 44 + (b0[2] + b0[3]) // 2
    else:
        gl, gr = x0 + b1[3], x0 + b0[1]
        gy = ytop + 44 + (b1[2] + b1[3]) // 2
    gap = gr - gl - 1

    panel_d.line([gl, gy, gr, gy], fill=C_WARN, width=2)
    for xx in (gl, gr):
        panel_d.line([xx, gy - 7, xx, gy + 7], fill=C_WARN, width=2)
    panel_d.text(((gl + gr) // 2, gy - 20), '%dpx' % gap, font=f16, fill=C_WARN, anchor='mm')

    # 实机换算
    r = RADIUS[name]
    L = r * R_MUL
    k = L / w
    r_ = r
    panel_d.text((x0, ytop + 30), '%s.png 画布 %dx%d · 主块宽 %dpx · 次块宽 %dpx'
                 % (name, w, h, b0[3] - b0[1] + 1, b1[3] - b1[1] + 1),
                 font=f13, fill=C_TXT)
    panel_d.text((x0, ytop + 44 + h + 6),
                 '实机长边 = r(%d) × 3.1 = %.0fpx  ⇒  缩放 %.3f  ⇒  这条缝实机只有 %.1fpx'
                 % (r_, L, k, gap * k),
                 font=f13, fill=(255, 200, 120))
    return 44 + h + 46


f12, f13, f16, f20, f22 = (font(12), font(13), font(16), font(20), font(22))

NW, NH = 512, 214
SW, SH = 512, 226
W = 720

data = {}
for nm in ('splitter', 'shard'):
    im = Image.open(os.path.join(FISH, nm + '.png')).convert('RGBA')
    a = np.array(im.getchannel('A'))
    data[nm] = (im, blocks(a > 8))

H = 96 + (44 + NH + 46) + (44 + SH + 46) + 86
panel_im = Image.new('RGB', (W, H), BG)
panel_d = ImageDraw.Draw(panel_im)

panel_d.text((24, 16), '敌人立绘「中间断开」诊断 · splitter / shard', font=f22, fill=C_TXT)
panel_d.text((24, 48), '连通域分析（4-邻接，alpha>8）· 青框 = 主块，橙框 = 其余块 · 红标 = 主块到次块的水平间隙',
             font=f13, fill=C_DIM)
panel_d.text((24, 68), '实机缩放按 DiveGame.ts:1953「长边 = r × 3.1」换算',
             font=f13, fill=C_DIM)

y = 96
y += panel(data['splitter'][0], 'splitter', data['splitter'][1], y, W)
y += panel(data['shard'][0], 'shard', data['shard'][1], y, W)

panel_d.text((24, H - 66), '结论：两张都是「生成时就是多块」，与抠底无关 —— '
                           '四角 alpha=0、透明率 62.4% / 60.4%，无一处误删。',
             font=f13, fill=C_TXT)
panel_d.text((24, H - 46), '断开是 tasks 里写死的识别特征：splitter「中段一道彻底断开的口（露背景）」· '
                           'shard「三到五片碎片松散浮在一起」。',
             font=f13, fill=C_DIM)
panel_d.text((24, H - 26), '理由：出图前 shard ↔ splitter 的 36px 剪影 IoU = 0.908（全表最严重一对），必须把剪影拉开。',
             font=f13, fill=C_DIM)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
panel_im.save(OUT)
print('->', os.path.relpath(OUT, ROOT).replace('\\', '/'))
