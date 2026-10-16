# -*- coding: utf-8 -*-
"""V6.88 敌立绘修正对照图（orbit / spitter）。

左 = 用户报的**旧图**（直接从他的截图裁），右 = 修正版。
⚠️ 本图是**说明性示意**，不是实机截图；尺寸/占比是从 PNG 实测值填进标注的。
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT = os.path.join(ROOT, 'docs', 'shots')
OLD_SHOT = ('C:/Users/yu.wang/.workbuddy/clipboard-images/'
            'clipboard-2026-10-16T07-15-50-861Z-c1147d7b.png')
OUT = os.path.join(SHOT, 'fish_fix_v688.png')

BG = (10, 18, 27)
CARD = (17, 28, 40)
LINE = (38, 56, 76)
HI = (216, 244, 255)
DIM = (140, 162, 184)
RED = (255, 96, 112)
GRN = (94, 226, 168)


def font(sz, bold=False):
    for n in (('msyhbd.ttc' if bold else 'msyh.ttc'), 'Deng.ttf', 'simhei.ttf'):
        p = 'C:/Windows/Fonts/' + n
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


W, H = 980, 640
im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
ft, fs, fn, fl = font(22, True), font(15, True), font(13), font(12)

d.text((20, 16), '敌立绘修正 · orbit / spitter', font=ft, fill=HI)
d.text((20, 46), '左 = 旧版（你标的）　右 = 修正版　※ 示意对照图，非实机截图', font=fn, fill=DIM)

# ---- 旧图：从用户截图裁两格 ----
old = Image.open(OLD_SHOT).convert('RGB')
ow, oh = old.size                                     # 202 x 396
old_orbit = old.crop((2, 6, ow - 2, int(oh * 0.48)))
old_spitter = old.crop((2, int(oh * 0.50), ow - 2, oh))

ROWS = [
    ('orbit', old_orbit, 'orbit.png',
     '一根**均匀粗管**盘成圈，看不出生物',
     ['环内背景**没抠掉**：填充率 62%（实心盘量级）',
      '36px 剪影 = 一个实心黑盘 → 中空特征丢失'],
     '极细触须绕成环 + 中心空洞 + 左端小身体',
     ['环内已抠空：填充率 **15%**（细线量级）',
      '36px 剪影 = **中空环** → 特征回来了'], ),
    ('spitter', old_spitter, 'spitter.png',
     '**三层球**（上囊＋中体＋下球），像乐器/器皿',
     ['512×358 —— 下球把画布顶满',
      '中段纵向有 10 个连续峰 → 一坨球'],
     '单囊体 + 唯一背膜囊，黄绿半透明',
     ['512×244 —— 下球消失，底部成连续弧线',
      '补了眼睛与软体褶皱 → 读作活物'], ),
]

y = 74
for name, oimg, newfile, otxt, olines, ntxt, nlines in ROWS:
    row_h = 268
    # 卡片
    d.rectangle([16, y, W - 16, y + row_h - 12], fill=CARD, outline=LINE)
    d.line([16, y + 34, W - 16, y + 34], fill=LINE)
    d.text((28, y + 8), name, font=fs, fill=HI)
    d.text((100, y + 10), '旧版', font=fn, fill=RED)
    d.text((520, y + 10), '修正版', font=fn, fill=GRN)

    # 左：旧
    oi = oimg.copy()
    k = 150 / max(oi.size)
    oi = oi.resize((max(1, round(oi.width * k)), max(1, round(oi.height * k))), Image.LANCZOS)
    im.paste(oi, (36, y + 46))
    ty = y + 46
    for ln in olines:
        d.text((190, ty), ln.replace('**', ''), font=fl, fill=RED if '62%' in ln or '实心' in ln else DIM)
        ty += 18
    d.text((190, ty + 2), otxt.replace('**', ''), font=fl, fill=DIM)

    # 右：新
    ni = Image.open(os.path.join(ROOT, 'web', 'src', 'assets', 'fish', newfile)).convert('RGBA')
    bgc = Image.new('RGB', ni.size, CARD)
    bgc.paste(ni, (0, 0), ni)
    k2 = 168 / max(ni.size)
    ni2 = bgc.resize((max(1, round(ni.width * k2)), max(1, round(ni.height * k2))), Image.LANCZOS)
    im.paste(ni2, (530, y + 46))
    ty = y + 46
    for ln in nlines:
        d.text((726, ty), ln.replace('**', ''), font=fl, fill=GRN)
        ty += 18
    d.text((726, ty + 2), ntxt.replace('**', ''), font=fl, fill=DIM)

    y += row_h

d.text((20, H - 26), '判据来源：check_art.py fish（尺寸/重心/四角）· check_fish_silhouette.py（36px 剪影 IoU）',
       font=fn, fill=DIM)

os.makedirs(SHOT, exist_ok=True)
im.save(OUT)
print('对照图 -> %s' % os.path.relpath(OUT, ROOT).replace('\\', '/'))
