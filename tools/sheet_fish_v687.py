# -*- coding: utf-8 -*-
"""
敌人立绘**成品全览图**（V6.87）—— 21 张新立绘并排，供人眼一次看完全部风格是否同源。

与 `check_fish_silhouette.py` 的分工：
  · 那张图判**可分性**（涂黑剪影、36px、只比形状）
  · 这张图判**风格一致性**（原色、等比缩放 —— 一眼看出"哪张不像这一批"）

⚠️ 本图是**从真源 PNG 直接排出来的**，不是实机截图。
   实机还要过 `drawVeil` 压暗与 tint ⇒ 亮度以此图为准、色调以实机为准。

用法：<python> tools/sheet_fish_v687.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'web', 'src', 'assets', 'fish')
OUT = os.path.join(ROOT, 'docs', 'shots', 'fish_art_v687.png')

# 按族分组排（同族相邻 ⇒ 风格漂移与"雷同"同时看得见）
GROUPS = [
    ('A 鱼形',  ['swarm', 'dash', 'splitter', 'darter', 'lancer', 'herder']),
    ('B 盘形',  ['drift', 'armor', 'orbit', 'jelly', 'kamikaze', 'bulwark']),
    ('C 巢形',  ['brood', 'bloom', 'spitter']),
    ('D 虫形',  ['leech', 'burrower']),
    ('E 碎屑',  ['mimic', 'shard']),
    ('S Boss', ['boss_watcher', 'boss_angler']),
]
NEW = set()   # V6.87 本轮新出（用角标区分）
for _, names in GROUPS:
    NEW |= set(names)
NEW -= {'swarm', 'dash', 'drift', 'armor'}   # 这 4 张是真图基线，不是本轮产物

COLS = 6
CELL_W, CELL_H = 208, 208
PAD = 12
HEAD = 76


def font(sz):
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    n = sum(len(v) for _, v in GROUPS)
    rows = (n + COLS - 1) // COLS
    W = COLS * CELL_W + PAD * 2
    H = HEAD + rows * CELL_H + PAD * 2 + 40
    im = Image.new('RGB', (W, H), (10, 18, 27))
    d = ImageDraw.Draw(im)
    ft, fs, fn = font(22), font(15), font(12)

    d.text((PAD + 4, 14), '深海回响 · 敌人立绘成品全览 V6.87', font=ft, fill=(216, 244, 255))
    d.text((PAD + 4, 44), '按族排列（同族相邻）· 青框 = 本轮新出 18 张 · 灰框 = 原有真图 4 张 · '
                          '本图由真源 PNG 排出，非实机截图', font=fn, fill=(150, 170, 190))

    idx = 0
    for gname, names in GROUPS:
        for nm in names:
            cx = PAD + (idx % COLS) * CELL_W
            cy = HEAD + (idx // COLS) * CELL_H
            im_ = Image.open(os.path.join(SRC, nm + '.png')).convert('RGBA')
            box = Image.new('RGB', (CELL_W - 10, CELL_H - 10), (16, 26, 37))
            k = min((CELL_W - 40) / im_.width, (CELL_H - 66) / im_.height)
            th = im_.resize((max(1, round(im_.width * k)), max(1, round(im_.height * k))),
                            Image.LANCZOS)
            box.paste(th, ((box.width - th.width) // 2, (box.height - th.height) // 2 - 6), th)
            im.paste(box, (cx, cy))
            isnew = nm in NEW
            d.rectangle([cx, cy, cx + CELL_W - 10, cy + CELL_H - 10],
                        outline=(79, 232, 255) if isnew else (70, 86, 104), width=2)
            d.text((cx + (CELL_W - 10) // 2, cy + CELL_H - 34), nm, font=fs,
                   fill=(216, 244, 255), anchor='mm')
            d.text((cx + (CELL_W - 10) // 2, cy + CELL_H - 17),
                   '%s · %dx%d' % (gname, im_.width, im_.height), font=fn,
                   fill=(120, 140, 160), anchor='mm')
            idx += 1

    d.text((PAD + 4, H - 28),
           '判据：① 同族内不许共用模板（靠"前长/后长/断口"分开）'
           '  ② 风格锚点逐字复用 ⇒ 不该有哪张"不像这一批"', font=fn, fill=(120, 140, 160))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT)
    print('成品全览 -> %s  (%d 张)' % (os.path.relpath(OUT, ROOT).replace('\\', '/'), n))


if __name__ == '__main__':
    main()
