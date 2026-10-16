# -*- coding: utf-8 -*-
"""三台潜航器**挂点贴合检查**（V6.85b）：实机 3× 尺寸 + `HULL_OUTLINE` + 6 个挂点 + 发射槽。

为什么需要：用户原话「**实机里要看到刺鳐/灯艇的炮座发飘**」。
`prep_sub_art.py` 会打印一个"轮廓内透明占比"，那个数**只说明总体差多少**，
看不出**具体哪一座**浮空。这张图把判据画在机体上：

  · **红折线** = `HULL_OUTLINE`（挂点基准 / 也是渲染层画霓虹轮廓的那条线）
  · **黄圈**   = 6 个 `SEAT_MOUNTS`（炮塔画在哪、子弹从哪出）
  · **青圆角矩形** = 位图里挖的**发射槽**（槽在图上 ⇒ 发射器从槽里长出来）

★ 判据：**黄圈必须整个落在不透明的艇身像素上**。落在透明处 = 实机上炮座悬空
（本体不出来、只有一圈描边飘在水里），而**引擎不报错**。

用法：python tools/preview_sub_mounts.py   → docs/shots/sub_mounts_ab.png
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import preview_hull_side as P  # noqa: E402  复用已与 TS 同源的几何常量

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUB_DIR = os.path.join(ROOT, 'cocos', 'assets', 'resources', 'sub')
OUT = os.path.join(ROOT, 'docs', 'shots', 'sub_mounts_ab.png')

# 归一化画布几何（`normalize_sub_art.py` 的统一口径）
CV = (408, 361)
TRUNK = (28, 102, 352, 224)          # x, y, w, h

IDS = [('sub_lumen', '灯艇 LUMEN'), ('sub_raia', '刺鳐 RAIA'), ('sub_bathy', '深潜者 BATHY')]
SCALE = 3                            # 实机 1× 是 102×90.25，放大 3 倍看细节


def font(size):
    for p in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def to_canvas(u: float, v: float):
    """归一化 (u,v) → 统一画布像素。u 沿艇长（+1 = 艏），v 沿艇高（负 = 背）。"""
    tx, ty, tw, th = TRUNK
    return tx + (u + 1) / 2 * tw, ty + (v + 1) / 2 * th


def opaque_at(img, px, x, y, r=3):
    """(x,y) 附近是否有不透明像素 —— 判"这座下面有没有艇身"。"""
    w, h = img.size
    for dx in range(-r, r + 1, 2):
        for dy in range(-r, r + 1, 2):
            xx, yy = int(x + dx), int(y + dy)
            if 0 <= xx < w and 0 <= yy < h and px[xx, yy][3] > 128:
                return True
    return False


def main():
    panels = []
    for sid, label in IDS:
        art = Image.open(os.path.join(SUB_DIR, sid + '.png')).convert('RGBA')
        px = art.load()
        d = ImageDraw.Draw(art)

        # ① 轮廓（红）：改画在单独一层，避免被机体盖住
        pts = [to_canvas(u, v) for (u, v) in P.HULL_OUTLINE]
        d.line(pts + [pts[0]], fill=(255, 70, 70, 235), width=3)

        # ② 6 个挂点（黄圈 + 十字）+ ③ 槽（青圆角矩形）
        bad = []
        for i, (u, v) in enumerate(P.SEAT_MOUNTS):
            x, y = to_canvas(u, v)
            ok = opaque_at(art, px, x, y)
            if not ok:
                bad.append(i)
            col = (255, 210, 60, 245) if ok else (255, 0, 200, 255)
            d.ellipse([x - 5, y - 5, x + 5, y + 5], outline=col, width=3)
            d.line([x - 9, y, x + 9, y], fill=col, width=1)
            d.line([x, y - 9, x, y + 9], fill=col, width=1)
        # 槽：以座心为基准，沿法线外移 SLOT_EDGE_OFF，再往里 SLOT_HD
        for (u, v) in P.SEAT_MOUNTS:
            x, y = to_canvas(u, v)
            hw = P.SLOT_HW / P.SUB_D * TRUNK[2]
            hd = P.SLOT_HD / P.HULL_H * TRUNK[3]
            sgn = -1 if v < 0 else 1                  # 背 = 负
            y0 = y + sgn * (0.8 / P.HULL_H * TRUNK[3])
            y1 = y0 + sgn * hd
            d.rounded_rectangle([x - hw, min(y0, y1), x + hw, max(y0, y1)],
                                radius=4, outline=(80, 230, 255, 200), width=2)

        # 实机 3×（画布 408 → 102*3 = 306）
        k = (102 * SCALE) / art.width
        big = art.resize((int(art.width * k), int(art.height * k)), Image.LANCZOS)
        panels.append((big, label, bad))

    pw = max(p[0].width for p in panels) + 24
    ph = max(p[0].height for p in panels) + 84
    sheet = Image.new('RGB', (pw * 3, ph + 76), (6, 13, 20))
    dd = ImageDraw.Draw(sheet)
    dd.text((16, 12), 'V6.85b · 挂点贴合检查（实机 3×）  红=HULL_OUTLINE  黄圈=6 挂点  '
                      '青框=发射槽  品红圈=该座下**没有艇身**（会飘）',
            fill=(210, 245, 255), font=font(20))
    for i, (big, label, bad) in enumerate(panels):
        x0 = i * pw + 12
        sheet.paste(big, (x0, 52), big)
        verdict = '✅ 6 座全部落在艇身上' if not bad else f'❌ 悬空座：{bad}'
        dd.text((x0, 52 + big.height + 6), f'{label}   {verdict}',
                fill=(255, 255, 255) if not bad else (255, 120, 200), font=font(19))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print('→', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
