# -*- coding: utf-8 -*-
"""三台潜航器侧视立绘**同框对比**（V6.85）：真实 L1 背景 + 实机 1× 尺寸 + 3× 放大。

为什么需要：三台现在走 `prep_sub_art.py` → `normalize_sub_art.py` 两道工序，判据不是"好不好看"，
而是三件事在**同一张图上**能不能同时成立：
  ① 三台**剪影互不混淆**（36px 涂黑还认得出是三个不同的东西）；
  ② 轴心一致 —— 躯干矩形都是 `SUB_D × HULL_H`，所以三台在屏幕上的**体量必须一样**；
  ③ 实机 1×（102×90.25）下还读不读得出特征（灯带 / 撞角 / 紫缝）。

用法：python tools/preview_subs_ab.py   → docs/shots/subs_ab.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUB = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'sub')
ENV = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'env', 'L1.png')
OUT = os.path.join(ROOT, 'docs', 'shots', 'subs_ab.png')

IDS = [('sub_lumen', '灯艇 LUMEN'), ('sub_raia', '刺鳐 RAIA'), ('sub_bathy', '深潜者 BATHY')]
W, H = 1304, 749
DISPLAY_W = 102           # SUB_HULL.w（1× 实机尺寸）


def font(size):
    for p in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main():
    bg = Image.open(ENV).convert('RGB')
    # cover 到 W×H
    s = max(W / bg.width, H / bg.height)
    bg = bg.resize((int(bg.width * s), int(bg.height * s)), Image.LANCZOS)
    bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2,
                  (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))

    im = bg.copy()
    d = ImageDraw.Draw(im)

    for i, (sid, label) in enumerate(IDS):
        art = Image.open(os.path.join(SUB, sid + '.png')).convert('RGBA')
        # ① 实机 1×：整张画布 408px → 102px
        k = DISPLAY_W / art.width
        small = art.resize((int(art.width * k), int(art.height * k)), Image.LANCZOS)
        # ② 放大 4×（看清质感）
        big = art.resize((art.width // 2, art.height // 2), Image.LANCZOS)

        col = i % 3
        cx = 60 + col * 420
        # 大图（诊断质感）
        im.paste(big, (cx, 90), big)
        # 小图（实机尺寸，压在深色底上才看得清）
        boxx, boxy = cx + 10, 300
        d.rectangle([boxx, boxy, boxx + 110, boxy + 100], fill=(6, 14, 20))
        im.paste(small, (boxx + 4, boxy + 5), small)
        d.text((cx + 10, 60), label, fill=(200, 240, 255), font=font(22))
        d.text((boxx + 4, boxy + 104), f'实机 1× = {DISPLAY_W}px 宽', fill=(150, 200, 210), font=font(15))

    d.text((60, 20), 'V6.85 · 三台潜航器侧视立绘（上＝2× 质感，下＝实机 1× 尺寸）',
           fill=(220, 250, 255), font=font(24))
    d.text((60, 430), '判据：① 三台剪影互不混淆 ② 躯干都 = SUB_D×HULL_H ⇒ 体量一致 '
                      '③ 1× 下配得上"灯位 / 撞角 / 紫缝"三个名号',
           fill=(160, 210, 220), font=font(17))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    im.save(OUT)
    print('→', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
