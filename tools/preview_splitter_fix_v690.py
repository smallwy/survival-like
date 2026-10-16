# -*- coding: utf-8 -*-
"""splitter 修正前后对照图（V6.90）。

左/上：V6.87（"彻底断开"） 右/下：V6.90（近距裂口 + 连丝）

用法：<python> tools/preview_splitter_fix_v690.py
输出：docs/shots/splitter_fix_v690.png
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = os.path.join(ROOT, '.tmp', 'prev', 'splitter_v687_成品.png')
NEW = os.path.join(ROOT, 'web', 'src', 'assets', 'fish', 'splitter.png')
OUT = os.path.join(ROOT, 'docs', 'shots', 'splitter_fix_v690.png')

BG = (10, 18, 27)
TXT = (216, 244, 255)
DIM = (150, 170, 190)
GOOD = (79, 232, 255)
BAD = (255, 140, 120)


def font(sz):
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def stats(p):
    im = Image.open(p).convert('RGBA')
    a = np.array(im.getchannel('A'))
    m = a > 8
    w, h = im.size
    col = m.sum(axis=0)
    empty = np.where(col == 0)[0]
    runs = []
    if len(empty):
        s = prev = empty[0]
        for x in empty[1:]:
            if x != prev + 1:
                runs.append((int(s), int(prev))); s = x
            prev = x
        runs.append((int(s), int(prev)))
    inner = [r for r in runs if r[0] > 0 and r[1] < w - 1]
    return {'im': im, 'w': w, 'h': h,
            'fill': 100 * m.sum() / m.size,
            'inner_empty': inner,
            'n_empty_cols': sum(r[1] - r[0] + 1 for r in inner)}


f12, f13, f15, f18, f20 = font(12), font(13), font(15), font(18), font(20)

o, n = stats(OLD), stats(NEW)
W = 760
PADX = 24
top = 110
ROW = 44 + 300 + 78
H = top + ROW * 2 + 210

im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)

d.text((PADX, 14), 'splitter 立绘修正 · V6.87 → V6.90', font=f20, fill=TXT)
d.text((PADX, 46), '起因：在 21 张全览图里看到「中间断了」。根因是任务单要求的识别特征被执行过头，'
                   '不是抠底或管线问题。', font=f13, fill=DIM)
d.text((PADX, 66), '处置：近距裂口 + 贯穿肌丝 + 尾段实心化（保留 36px 剪影区分度）。', font=f13, fill=DIM)
d.text((PADX, 86), '底图 = 该图自带 raw · image-to-image · input_fidelity=medium · 重出 1 版', font=f13, fill=DIM)

y = top


def panel(tag, st, y, accent, lines):
    d.text((PADX, y), tag, font=f18, fill=accent)
    im.paste(st['im'], ((W - st['w']) // 2, y + 28), st['im'])
    yy = y + 28 + st['h'] + 10
    for i, t in enumerate(lines):
        d.text((PADX, yy + i * 18), t, font=f13, fill=DIM if i else accent)
    return 28 + st['h'] + 10 + len(lines) * 18 + 24


y += panel('改前 · V6.87  任务单原文：「中段一道彻底断开的口，前后两段露出背景」', o, y, BAD, [
    f'抠底后：连通块 16 个 · 主块 86.2% / 次块 13.6%',
    f'两段之间空列 {o["n_empty_cols"]} 列（{len(o["inner_empty"])} 段连续空白）· 空档 34px',
    '尾段是空心筒（135x97 里仅 5341px，填充率 41%）',
    '连丝只有 63px 像素、肉眼不可见',
    '实机读作「图裂了 / 渲染残片」，不是「分裂中的生物」',
])

y += panel('改后 · V6.90  近距裂口 + 贯穿肌丝 + 尾段实心化', n, y, GOOD, [
    '抠底后：连通块 1 个（100%）· 连丝贯穿，无空列',
    f'透明率 {n["fill"]:.1f}% · 画布 {n["w"]}x{n["h"]}（长边 512 达标）',
    '尾段实心：与鱼身同材质、带发光脊柱与甲片、末端是正常叉状尾鳍',
    '前段断面有肌肉纤维纹理 · 连丝 3-4 根、最细处列高 16px',
    '连丝清晰可见 → 读作「正在分裂的鱼」而不是「两块残片」',
])

by = H - 196
for i, (t, c) in enumerate([
    ('闸门 1  check_art fish → 21/21 全绿（splitter 512x213 重心 49%）', TXT),
    ('闸门 2  check_fish_silhouette → splitter 相关最高 IoU 0.658（阈值 0.72）PASS', TXT),
    ('闸门 3  gen_fish_meta --dir fish → meta 已修正（trimType: none）', TXT),
    ('闸门 4  verify_cocos → 7/7 PASS · sync_art 实际写盘 1 个', TXT),
    ('', DIM),
    ('实机换算：显示长边 = r x 3.1 = 21 x 3.1 = 65px', DIM),
    ('本图是 512 原尺寸，实机看起来比这再小 8 倍', DIM),
    ('唯一 FAIL 仍是 brood - kamikaze 0.722（V6.88 既有，与本次无关）', DIM),
    ('改前图存档：_regen/v687/splitter_成品.png', DIM),
]):
    d.text((PADX, by + i * 20), t, font=f13 if i < 4 else f12, fill=c)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
im.save(OUT)
print('对照图 ->', os.path.relpath(OUT, ROOT).replace('\\', '/'))
