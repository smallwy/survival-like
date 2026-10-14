"""下潜滚动 / 换带过渡的**静态预览**（V6.56，对应 `DiveGame.ts` §3.1~§3.3）。

为什么需要它：这一轮改的是"**时间上的东西**" —— 爆冲怎么衰减、扫带扫多快、
颗粒两档差多少。这些在**单帧截图里完全看不出来**（每一帧的数值都合法），
只有把**时间轴画出来**才能提前发现问题。与 `preview_hull_side.py`（几何）、
`preview_atmo.py`（合成观感）同一套路，各管一类。

⚠️ 这里复刻的是 `cocos/assets/scripts/view/DiveGame.ts` 里那几个常量与公式。
   **改 TS 必须同步改本文件**，否则这张图会变成"骗人的图"（比没有图更糟）。
   对照位置（V6.56 提交时的行号）：
     · SCROLL_BASE / SCROLL_BURST / BURST_TAU / SCAN_DUR / XFADE_DUR —— 常量区
     · MOTE_MUL —— 常量区（视差系数 [近景, 中景]）
     · stepWater() —— 爆冲衰减 + 扫带推进 + crossfade 推进
     · drawScanBand() —— 26 段正弦波纹带的三层图元

用法：
  python tools/preview_descent.py            # 出一张总览拼图
  python tools/preview_descent.py --curve    # 只出速度曲线（放大）
  python tools/preview_descent.py --scan     # 只出扫带时序
  python tools/preview_descent.py --parallax # 只出颗粒视差对比（L1 vs L4）
"""

import argparse
import math
import os

from PIL import Image, ImageDraw, ImageFont

# --- 与 DiveGame.ts 同步的常量 ---------------------------------------------
W, H = 1304, 749            # 设计分辨率
SCROLL_BASE = 46.0          # px/s
SCROLL_BURST = 220.0        # 换带爆冲
BURST_TAU = 0.9             # 指数衰减时间常数
SCAN_DUR = 0.6
XFADE_DUR = 2.0

MOTE_MUL = {
    'L1/L2/L3/L5': (1.00, 0.35),
    'L4 热泉带': (-0.62, -0.22),
}

# 配色（照抄 shared/theme.ts，只取用到的几个）
C_BG = (0x04, 0x07, 0x0d)          # UI.abyss
C_CYAN = (0x4f, 0xe8, 0xff)        # UI.cyan
C_CYAN_HI = (0xc8, 0xf8, 0xff)     # UI.cyanHi
C_CYAN_DIM = (0x1f, 0x6a, 0x7d)    # UI.cyanDim
C_GRID = (0x24, 0x2c, 0x36)
C_TXT = (0xa8, 0xb8, 0xc4)

OUT = 'docs/shots'
os.makedirs(OUT, exist_ok=True)

# PIL 默认字体没有汉字，不加载的话满屏都是"豆腐块"
_FONT_CANDIDATES = (
    'C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc', '/System/Library/Fonts/PingFang.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
)


def font(size=14):
    for p in _FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def txt(d, xy, s, fill=C_TXT, size=14):
    d.text(xy, s, fill=fill, font=font(size))


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def v_scroll(t, burst0=SCROLL_BURST):
    """换带发生在 t=0：瞬时置顶 + 指数衰减。与 stepWater() 同式。"""
    b = burst0 * math.exp(-t / BURST_TAU) if t >= 0 else 0.0
    return SCROLL_BASE + b


# ---------------------------------------------------------------------------
# ① 速度曲线
# ---------------------------------------------------------------------------
def draw_curve(d, x0, y0, w, h, tmax=4.0, title=''):
    # 轴
    d.rectangle([x0, y0, x0 + w, y0 + h], outline=C_GRID)
    vmax = SCROLL_BURST + SCROLL_BASE
    # 稳态参考线（SCROLL_BASE）
    ybase = y0 + h - int(SCROLL_BASE / vmax * h)
    d.line([x0, ybase, x0 + w, ybase], fill=(0x3a, 0x5a, 0x66))
    txt(d, (x0 + 4, ybase - 12), f'稳态 {SCROLL_BASE:.0f} px/s', fill=C_TXT)

    pts = []
    n = 400
    for i in range(n + 1):
        t = tmax * i / n
        v = v_scroll(t)
        pts.append((x0 + int(w * t / tmax), y0 + h - int(v / vmax * h)))
    d.line(pts, fill=C_CYAN, width=2)

    # 三个时间常数点：τ / 2τ / 3τ（衰减到 37% / 14% / 5%）
    for k, lab in ((1, 'τ'), (2, '2τ'), (3, '3τ')):
        t = k * BURST_TAU
        if t > tmax:
            continue
        px = x0 + int(w * t / tmax)
        py = y0 + h - int(v_scroll(t) / vmax * h)
        d.line([px, y0, px, y0 + h], fill=(0x2a, 0x3a, 0x46))
        d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=C_CYAN_HI)
        txt(d, (px + 3, py - 14), f'{lab} {v_scroll(t):.0f}', fill=C_CYAN_HI)

    txt(d, (x0, y0 - 20), f'{title}  t=0 换带瞬时置 {SCROLL_BURST:.0f} → 指数衰减',
        fill=C_TXT)
    txt(d, (x0 + w - 60, y0 + h + 4), f'{tmax:.0f}s', fill=C_TXT)


# ---------------------------------------------------------------------------
# ② 扫带时序（复刻 drawScanBand 的 26 段正弦波纹）
# ---------------------------------------------------------------------------
def draw_scan_frame(d, x0, y0, w, h, t, w_t=0.0):
    k = min(1.0, max(0.0, t / SCAN_DUR))
    if t > SCAN_DUR:
        k = 1.0
    y = h * (1 - k)          # 底 → 顶
    a = 1 - k
    seg = 26
    sw = w / seg + 1
    for i in range(seg):
        yy = y + math.sin(i * 0.85 + w_t * 5) * 6
        # ① 头线 / ② 过渡带 / ③ 余晖
        for (off, hh, col, aa) in ((-2, 3, C_CYAN_HI, 0.34),
                                   (1, 14, C_CYAN, 0.13),
                                   (-26, 22, C_CYAN_DIM, 0.09)):
            a2 = max(0.0, aa * a)
            if a2 < 0.01:
                continue
            px, py = x0 + i * sw, y0 + yy + off
            d.rectangle([px, py, px + sw, py + hh], fill=mix(C_BG, col, a2))
    d.rectangle([x0, y0, x0 + w, y0 + h], outline=C_GRID)


# ---------------------------------------------------------------------------
# ③ 颗粒视差（同一批颗粒，不同带的系数）
# ---------------------------------------------------------------------------
def draw_parallax(d, x0, y0, w, h, label, mul, t=1.6):
    d.rectangle([x0, y0, x0 + w, y0 + h], outline=C_GRID)
    txt(d, (x0 + 4, y0 + 3), f'{label}   近景 {mul[0]:+.2f}× / 中景 {mul[1]:+.2f}×',
           fill=C_TXT)
    d.line([x0 + w - 46, y0 + 6, x0 + w - 46, y0 + h - 6], fill=(0x2a, 0x3a, 0x46))
    txt(d, (x0 + w - 40, y0 + 6), '↑上', fill=C_TXT)
    # 24 颗：近景亮小、中景暗大（与 drawBg 的口径一致）
    seed = 12345
    items = []
    for i in range(24):
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        fx = (seed % 1000) / 1000
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        fy = (seed % 1000) / 1000
        far = (i % 2 == 0)
        items.append((fx, fy, far))
    for (fx, fy, far) in items:
        m = mul[1] if far else mul[0]
        # 拖尾：t 秒内的位移
        dy = m * SCROLL_BASE * t
        px = x0 + 12 + fx * (w - 60)
        py = y0 + h - 16 - fy * (h - 40)
        col = mix(C_BG, (0x9f, 0xe1, 0xcb), 0.15 if far else 0.30)
        r = 1.0 if far else 2.2
        # 起点（暗）
        d.ellipse([px - r, py - r, px + r, py + r],
                  fill=mix(C_BG, (0x9f, 0xe1, 0xcb), 0.06))
        # 终点（亮）+ 轨迹
        ey = py - dy
        d.line([px, py, px, ey], fill=mix(C_BG, (0x9f, 0xe1, 0xcb), 0.14))
        d.ellipse([px - r, ey - r, px + r, ey + r], fill=col)


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--curve', action='store_true')
    ap.add_argument('--scan', action='store_true')
    ap.add_argument('--parallax', action='store_true')
    a = ap.parse_args()
    only = a.curve or a.scan or a.parallax

    if a.curve or not only:
        im = Image.new('RGB', (W, 300), C_BG)
        d = ImageDraw.Draw(im)
        draw_curve(d, 40, 66, W - 80, 190, 4.0, '① 下潜滚动速度 vScroll')
        im.save(f'{OUT}/descent_curve.png')
        print('→ descent_curve.png')

    if a.scan or not only:
        im = Image.new('RGB', (W, 340), C_BG)
        d = ImageDraw.Draw(im)
        fw, fh = (W - 80) // 6 - 10, 240
        for i in range(6):
            t = i * SCAN_DUR / 5
            x0 = 40 + i * (fw + 10)
            draw_scan_frame(d, x0, 50, fw, fh, t, w_t=t * 3)
            txt(d, (x0, 30), f't={t:.2f}s', fill=C_TXT)
        txt(d, (40, 300), '② 温跃层扫带（底 → 顶，0.6s，26 段正弦；'
                          '头线 / 过渡带 / 余晖 三层）', fill=C_TXT)
        im.save(f'{OUT}/descent_scan.png')
        print('→ descent_scan.png')

    if a.parallax or not only:
        im = Image.new('RGB', (W, 300), C_BG)
        d = ImageDraw.Draw(im)
        hw = (W - 120) // 2
        draw_parallax(d, 40, 40, hw, 200, '③-a 常规带', MOTE_MUL['L1/L2/L3/L5'])
        draw_parallax(d, 80 + hw, 40, hw, 200, '③-b L4 热泉带（反向）',
                      MOTE_MUL['L4 热泉带'])
        txt(d, (40, 258), '③ 颗粒视差（1.6s 拖尾；近景细线上掠、中景短线；'
                          'L4 两条都朝下 = 热泉反冲）', fill=C_TXT)
        im.save(f'{OUT}/descent_parallax.png')
        print('→ descent_parallax.png')

    if not only:
        # 总览：三张竖着拼
        ims = [Image.open(f'{OUT}/descent_{k}.png')
               for k in ('curve', 'scan', 'parallax')]
        sheet = Image.new('RGB', (max(i.width for i in ims),
                                  sum(i.height for i in ims) + 20), C_BG)
        y = 0
        for i in ims:
            sheet.paste(i, (0, y))
            y += i.height + 10
        sheet.save(f'{OUT}/descent_sheet.png')
        print('→ descent_sheet.png')


if __name__ == '__main__':
    main()
