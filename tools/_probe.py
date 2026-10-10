# -*- coding: utf-8 -*-
"""视觉体检 v2：暗角曲线 / 画面填充度 / 敌人剪影种类。用完即删。"""
import os
from PIL import Image, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'docs', 'shots')
OUT = os.path.join(ROOT, '_diag')
os.makedirs(OUT, exist_ok=True)

# 去掉 HUD 区域后剩下的就是「游戏画面」
HUD = (0, 0, 400, 135)
HUD2 = (810, 0, 960, 62)   # 右上时间块
HINT = (0, 600, 960, 660)  # 底部提示


def luminance(img):
    return ImageStat.Stat(img.convert('L')).mean[0]


def play_area(im):
    c = im.copy()
    for b in (HUD, HUD2, HINT):
        c.paste((0, 0, 0), b)
    return c


def vignette_probe(im, name):
    w, h = im.size
    p = play_area(im)
    core = luminance(p.crop((w // 2 - 120, h // 2 - 90, w // 2 + 120, h // 2 + 90)))
    s = 30
    edges = [
        ('上边中点', luminance(p.crop((w // 2 - 60, 4, w // 2 + 60, 4 + s)))),
        ('下边中点', luminance(p.crop((w // 2 - 60, h - 4 - s, w // 2 + 60, h - 4)))),
        ('左边中点', luminance(p.crop((4, h // 2 - 40, 4 + s, h // 2 + 40)))),
        ('右边中点', luminance(p.crop((w - 4 - s, h // 2 - 40, w - 4, h // 2 + 40)))),
        ('左上角  ', luminance(p.crop((4, 4, 4 + s, 4 + s)))),
        ('右下角  ', luminance(p.crop((w - 4 - s, h - 4 - s, w - 4, h - 4)))),
    ]
    print(f'--- {name} 暗角（中心亮度 {core:.1f}）---')
    for n, v in edges:
        print(f'  {n} {v:6.1f}   比值 {v / core:5.2f}')


def density_probe(im, name):
    """画面填充度：把"明显亮于地面底色"的像素算作实体（单位/子弹/拾取物）。"""
    w, h = im.size
    p = play_area(im).convert('RGB')
    px = p.load()
    solid = 0
    total = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            total += 1
            if max(r, g, b) > 78 or (max(r, g, b) - min(r, g, b)) > 46:
                solid += 1
    print(f'--- {name} 填充度 {solid / total * 100:5.2f}%  '
          f'({solid} / {total} 采样点)')


def blob_probe(im, name, predicate, label):
    """连通域计数：数屏幕上大致有几个「东西」"""
    from collections import deque
    w, h = im.size
    p = play_area(im).convert('RGB')
    px = p.load()
    m = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if predicate(*px[x, y]):
                m[y][x] = True
    vis = [[False] * w for _ in range(h)]
    blobs = []
    for y in range(h):
        for x in range(w):
            if m[y][x] and not vis[y][x]:
                q = deque([(x, y)]); vis[y][x] = True; n = 0
                while q:
                    cx, cy = q.popleft(); n += 1
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and m[ny][nx] and not vis[ny][nx]:
                            vis[ny][nx] = True; q.append((nx, ny))
                if n >= 30:
                    blobs.append(n)
    print(f'--- {name} {label}: {len(blobs)} 块  {sorted(blobs, reverse=True)[:12]}')


def crop(im, box, name, scale=4):
    c = im.crop(box)
    c = c.resize((c.width * scale, c.height * scale), Image.NEAREST)
    c.save(os.path.join(OUT, name))


for fn in ('3-交火.png', '5-长局.png', '2-走路.png'):
    path = os.path.join(SHOTS, fn)
    if not os.path.exists(path):
        continue
    im = Image.open(path).convert('RGB')
    print('=====', fn, im.size, '=====')
    vignette_probe(im, fn)
    density_probe(im, fn)

im = Image.open(os.path.join(SHOTS, '3-交火.png')).convert('RGB')
blob_probe(im, '3-交火.png', lambda r, g, b: r > 150 and r > g + 55 and r > b + 55, '红色敌兵')
blob_probe(im, '3-交火.png', lambda r, g, b: g > 110 and g > r + 45 and g > b + 35, '绿色经验球')
blob_probe(im, '3-交火.png', lambda r, g, b: g > 150 and b > 120 and r < 140, '青色玩家')
crop(im, (440, 280, 540, 390), 'player_now.png', 5)
