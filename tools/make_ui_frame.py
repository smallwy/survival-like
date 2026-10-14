#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
主界面框架元件生产器：**程序化生成**位图（玻璃槽位底 / 主按钮底 / 面板底九宫格源图）。

---------------------------------------------------------------------------
为什么框架元件用程序化生成，而不是 AI 出图
---------------------------------------------------------------------------
这不是省 credits，是**精度问题**：
  · 框架元件的全部技术指标是 —— 圆角半径、描边宽度、九宫格边界值、高光带位置。
    这四项 AI 出图**一项都给不准**（它给的是"看起来像圆角矩形"，不是"半径 11px 的圆角矩形"）；
  · 圆角算错的后果不是"难看"，是**九宫格角块接不上**（拉伸后四角起毛刺）；
  · 程序化生成还有一个 AI 给不了的东西：**改一个常量重跑就换一版**，脚本即真源。

**AI 出图仍然要做的是 Logo** —— 有机形状 + 品牌感，程序化画不出来。
分工判据：**几何元件 → 程序化；有机元件 → AI**。

---------------------------------------------------------------------------
取值口径：**一律对齐 `Title.ts` 实装，不按规格文档**
---------------------------------------------------------------------------
V6.63 核对实装时发现 `docs/主界面版式_V6.38.md` 有三处已经过时，本脚本按**代码**取：

| 项 | 文档 §3.3/§8.2 | `Title.ts` 实装 | 本脚本取 |
|---|---|---|---|
| 主按钮尺寸 | 340×68 | **236×62**（V6.41 `START_W/START_H`） | **236×62** |
| 面板圆角 | 14 | 装置坞 14 / 出击准备 **18** | **18**（统一，待确认） |
| 面板底色 | `MENU.page` | 出击准备 **GLASS.bar α0.97** | **GLASS.bar** |

⚠️ "面板统一到 r18 + `GLASS.bar`" 是**待用户确认**的挂起项 ——
   脚本先按统一值出图；若不统一，装置坞需另出一张 r14 的源图（Cocos 的 border
   绑在 SpriteFrame 上，一个 SpriteFrame 只有一套九宫格参数，**一个底板两种圆角
   必须出两张图**）。

---------------------------------------------------------------------------
为什么超采样（SS=4）
---------------------------------------------------------------------------
PIL **不做抗锯齿**。圆角与 1px 描边直接画会是一圈阶梯。
所以全部在 **设计尺寸 × 8**（= 2× 输出 × 4 超采样）上绘制，最后 LANCZOS 缩到 2× 输出。
缩图的另一个好处：**描边的有效宽度变成亚像素**，1.2px / 1.6px 的设计描边终于能画出来
（矢量 `Gfx` 画不出这种非整数宽度，这正是位图化的收益之一）。

---------------------------------------------------------------------------
九宫格判断（三类不同）
---------------------------------------------------------------------------
依据是"这块底要不要适配多种尺寸"：

| 元件 | 设计尺寸 | 输出(@2×) | 九宫格 | 依据 |
|---|---|---|---|---|
| 玻璃槽位底 | 96×96 | 192×192 | ❌ 整图 | 尺寸只有 96 / 88 两档，差 8px 直接缩放无视觉损失 |
| 主按钮底 | 236×62 | 472×124 | ✅ inset 16 设计 | 文案长度会变 ⇒ 按钮宽度会变 |
| 面板底 | 64×64（**源图**） | 128×128 | ✅ inset 24 设计 | 装置坞 / 出击准备 / 将来的屏，尺寸会分化 |

⚠️ **面板底只出"九宫格源图"（设计 64×64），不出 880×660 整图** ——
   880×660 @2× = 1760×1320，PNG 约 1MB，而九宫格源图 128×128 只有几 KB，
   拉伸后**视觉效果完全一致**。代价：面板底**不能带纵向渐变**（中心区会被纵向拉伸 41×）。
   ⇒ 面板态刻意只出纯色 + 描边，不出高光带。

---------------------------------------------------------------------------
位图专属的"厚度层"（矢量版没有，是位图化的收益）
---------------------------------------------------------------------------
`Gfx` 无渐变 ⇒ 矢量版只能"平涂 + 一条高光短线"。位图可以叠一条极弱的底部暗侧
（α 0.10~0.16），让底"有上下"。这一层在槽位与按钮上开，**面板上不开**（会被拉伸成横条）。

用法：
    python tools/make_ui_frame.py              # 生成并写盘
    python tools/make_ui_frame.py --check      # 只体检尺寸/四角，不写盘
    python tools/make_ui_frame.py --out <dir>  # 换输出目录

输出（默认 `cocos/assets/resources/ui/frame/`）+ 控制台打印**具名九宫格参数**。
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DST_DIR = ROOT / 'cocos' / 'assets' / 'resources' / 'ui' / 'frame'
SPEC_JSON = ROOT / 'tools' / 'ui_frame_spec.json'

SS = 4          # 超采样倍率（绘制 = 设计 × 2 × SS）
OUT_SCALE = 2   # 输出 = 设计 × 2（retina 余量）


# ---------------------------------------------------------------------------
# 色板（逐字取自 shared/theme.ts —— 改色只改那边，这里同步）
# ---------------------------------------------------------------------------
GLASS_BASE, GLASS_HOVER, GLASS_PRESS, GLASS_LOCK = 0x0c202a, 0x12303c, 0x08161c, 0x161c20
GLASS_HI, GLASS_EDGE = 0x56bad0, 0x4fe8ff
GLASS_BAR = 0x081119
UI_PANEL, UI_PANEL_HI = 0x08111c, 0x0e1a29
UI_CYAN, UI_CYAN_HI, UI_CYAN_DIM = 0x4fe8ff, 0xc8f8ff, 0x1f6a7d
UI_ABYSS = 0x04070d
MENU_EDGE = 0x39455a
WHITE = 0xffffff

# 玻璃高光带参数（逐字复刻 Title.ts glassPanel 第 1231-1243 行）
GLASS_HI_FRAC = 0.38     # 高度取 min(w,h) 的 38%，**不是 h 的 38%**
GLASS_HI_BANDS = 24
GLASS_HI_A0 = 0.13       # 常态
GLASS_HI_A0_HOVER = 0.20 # 悬停


def rgb(c: int) -> tuple[int, int, int]:
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def blend(c1: int, c2: int, t: float) -> int:
    r1, g1, b1 = rgb(c1)
    r2, g2, b2 = rgb(c2)
    return (int(r1 + (r2 - r1) * t) << 16) | (int(g1 + (g2 - g1) * t) << 8) | int(b1 + (b2 - b1) * t)


# ---------------------------------------------------------------------------
# 绘制原语
# ---------------------------------------------------------------------------
def rr_span(y: float, w: float, h: float, r: float) -> tuple[float, float]:
    """圆角矩形在第 `y` 行的水平跨度 [x0, x1]。高光带要逐行裁进圆角内。"""
    if y < r:
        dy = r - y
    elif y > h - r:
        dy = y - (h - r)
    else:
        return 0.0, w
    dx = r - math.sqrt(max(0.0, r * r - dy * dy))
    return dx, w - dx


def fill_body(layer: Image.Image, w: float, h: float, r: float, col: int, a: float) -> None:
    ImageDraw.Draw(layer).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=rgb(col) + (int(a * 255),))


def stroke_body(layer: Image.Image, x: float, y: float, w: float, h: float, r: float,
                col: int, a: float, width: float) -> None:
    ImageDraw.Draw(layer).rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=r,
                                            outline=rgb(col) + (int(a * 255),),
                                            width=max(1, int(round(width))))


def grad_band(layer: Image.Image, w: float, h: float, r: float,
              col: int, a0: float, frac: float = 0.38, power: float = 2.0,
              from_bottom: bool = False) -> None:
    """
    竖向渐变带（**横向均匀 ⇒ 九宫格横向拉伸不影响它**）。
    `from_bottom=True` 时从底缘向上渐隐（位图专属的"厚度"收口）。
    """
    d = ImageDraw.Draw(layer)
    span = max(1, int(round(h * frac)))
    for i in range(span):
        t = i / max(1, span - 1)
        a = int(255 * a0 * ((1.0 - t) ** power))
        if a <= 0:
            continue
        y = (h - 1 - i) if from_bottom else i
        x0, x1 = rr_span(y, w, h, r)
        d.line([(x0, y), (x1 - 0.5, y)], fill=rgb(col) + (a,))


def hi_line(layer: Image.Image, x0: float, y: float, x1: float, col: int, a: float, width: float) -> None:
    """按钮左上角的高光短线（玻璃反光暗示，逐字复刻 drawButton 第 1952-1953 行）。"""
    ImageDraw.Draw(layer).line([(x0, y), (x1, y)], fill=rgb(col) + (int(a * 255),),
                               width=max(1, int(round(width))))


# ---------------------------------------------------------------------------
# 元件定义
# ---------------------------------------------------------------------------
# 每个态的字段：
#   bg    (色, α)                      底
#   edge  (色, α, 宽[设计px])           描边
#   hi    (色, α0, 占比) | None         顶部高光带（二次衰减）
#   line  (色, α, 宽, 起点x, y, 长度比)  顶部高光短线
#   inner (色, α, 宽, 内缩)             内侧细白线（玻璃厚度感）
#   lo    (色, α0, 占比) | None         底部暗侧（**位图专属**，矢量版没有）
ELEMENTS = [
    # ---------------------------------------------------------------- 玻璃槽位
    dict(
        id='slot', name='玻璃槽位底', w=96, h=96, r=12, nine=False, inset=None,
        # 逐字对齐 Title.ts glassPanel()（1221-1264）
        states=[
            ('off', dict(bg=(GLASS_BASE, 0.82), edge=(GLASS_EDGE, 0.35, 1.2),
                         hi=(GLASS_HI, 0.13, 0.38), inner=(WHITE, 0.06, 1.0, 3.0),
                         lo=(UI_ABYSS, 0.14, 0.20))),
            ('hi', dict(bg=(GLASS_HOVER, 0.90), edge=(UI_CYAN, 1.0, 1.6),
                        hi=(GLASS_HI, 0.20, 0.38), inner=(WHITE, 0.06, 1.0, 3.0),
                        lo=(UI_ABYSS, 0.10, 0.18))),
            ('press', dict(bg=(GLASS_PRESS, 0.90), edge=(UI_CYAN_HI, 1.0, 1.6),
                           hi=(GLASS_HI, 0.13, 0.38), inner=(WHITE, 0.06, 1.0, 3.0),
                           lo=(UI_ABYSS, 0.22, 0.24))),
            # 锁定态：代码里**不画高光、不画内侧白线**（高光会误导"这个能点"）
            ('lock', dict(bg=(GLASS_LOCK, 0.86), edge=(MENU_EDGE, 0.45, 1.0),
                          hi=None, inner=None, lo=(UI_ABYSS, 0.16, 0.18))),
        ],
    ),
    # ---------------------------------------------------------------- 主按钮
    dict(
        id='btn', name='主按钮底', w=236, h=62, r=11, nine=True, inset=16,
        # 逐字对齐 Title.ts drawButton()（1936-1956）+ START_W/START_H（360-361）
        states=[
            ('off', dict(bg=(UI_PANEL, 0.94), edge=(UI_CYAN, 0.85, 1.5), hi=None,
                         line=(UI_CYAN_HI, 0.28, 2.0, 10.0, 5.0, 0.28),
                         lo=(UI_ABYSS, 0.14, 0.22))),
            ('hi', dict(bg=(UI_PANEL_HI, 0.94), edge=(UI_CYAN_HI, 1.0, 2.0), hi=None,
                        line=(UI_CYAN_HI, 0.50, 2.0, 10.0, 5.0, 0.28),
                        lo=(UI_ABYSS, 0.10, 0.20))),
            # press / dis 是**设计扩展**：实装目前只有 hover 二态，
            # 但四态矩阵是 UI 上线后最常见的返工点，位图一次出齐。
            ('press', dict(bg=(blend(UI_PANEL, UI_ABYSS, 0.45), 0.95), edge=(UI_CYAN, 0.70, 1.5),
                           hi=None, line=(UI_CYAN_HI, 0.16, 2.0, 10.0, 5.0, 0.28),
                           lo=(UI_ABYSS, 0.28, 0.26))),
            ('dis', dict(bg=(0x1a2026, 0.85), edge=(MENU_EDGE, 0.40, 1.0),
                         hi=None, line=None, lo=(UI_ABYSS, 0.18, 0.20))),
        ],
    ),
    # ---------------------------------------------------------------- 面板底
    dict(
        id='panel', name='面板底（九宫格源图）', w=64, h=64, r=18, nine=True, inset=24,
        panel_design=(880, 660),   # 装置坞（出击准备是 1040×600，同一张源图拉出来）
        states=[
            # 逐字对齐 Title.ts drawLoadout()（2369-2372）：GLASS.bar α0.97 + r18 +
            # neon(UI.cyan, width 1.6, alpha 0.8)
            # ⚠️ **不出高光带 / 不出厚度层** —— 源图只有 64×64，中段会被纵向拉伸 41×，
            #    任何纵向渐变都会被拉成横条。面板的"厚度"由**顶栏横梁**（代码画）给。
            ('off', dict(bg=(GLASS_BAR, 0.97), edge=(UI_CYAN, 0.80, 1.6), hi=None, lo=None)),
        ],
    ),
]


def render(el: dict, st: dict) -> Image.Image:
    """按设计尺寸 × 8 绘制，缩到 ×2 输出。"""
    K = OUT_SCALE * SS
    W, H, R = el['w'] * K, el['h'] * K, el['r'] * K

    base = Image.new('RGBA', (int(W), int(H)), (0, 0, 0, 0))

    # ① 底（半透明实色）
    ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
    fill_body(ov, W, H, R, *st['bg'])
    base = Image.alpha_composite(base, ov)

    # ② 顶部高光带（玻璃受光，逐行裁进圆角内；二次衰减）
    if st.get('hi'):
        col, a0, frac = st['hi']
        ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
        grad_band(ov, W, H, R, col, a0, frac, 2.0)
        base = Image.alpha_composite(base, ov)

    # ③ 顶部高光短线（按钮的"玻璃反光"暗示）
    if st.get('line'):
        col, a, lw, x0, y, ratio = st['line']
        ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
        hi_line(ov, x0 * K, y * K, (x0 + el['w'] * ratio) * K, col, a, lw * K / OUT_SCALE)
        base = Image.alpha_composite(base, ov)

    # ④ 底部暗侧（位图专属厚度层；面板态不开）
    if st.get('lo'):
        col, a0, frac = st['lo']
        ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
        grad_band(ov, W, H, R, col, a0, frac, 1.2, from_bottom=True)
        base = Image.alpha_composite(base, ov)

    # ⑤ 内侧细白线（玻璃厚度感）—— 先于描边，被描边压住外缘
    if st.get('inner'):
        col, a, lw, m = st['inner']
        ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
        stroke_body(ov, m * K, m * K, W - 2 * m * K, H - 2 * m * K,
                    max(1.0, R - m * K), col, a, lw * K / OUT_SCALE)
        base = Image.alpha_composite(base, ov)

    # ⑥ 描边（最后画，保证轮廓干净）
    col, a, lw = st['edge']
    ov = Image.new('RGBA', base.size, (0, 0, 0, 0))
    stroke_body(ov, 0, 0, W, H, R, col, a, lw * K / OUT_SCALE)
    base = Image.alpha_composite(base, ov)

    return base.resize((el['w'] * OUT_SCALE, el['h'] * OUT_SCALE), Image.LANCZOS)


def audit(img: Image.Image, el: dict) -> dict:
    """体检：尺寸 / alpha 分布 / 四角必须全透明 / 中心必须不透明。"""
    w, h = img.size
    px = img.load()
    corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    alphas = [px[x, y][3] for y in range(0, h, max(1, h // 24)) for x in range(0, w, max(1, w // 24))]
    return dict(
        size=(w, h), expect=(el['w'] * OUT_SCALE, el['h'] * OUT_SCALE),
        corner_alpha=corners, corner_clear=all(a == 0 for a in corners),
        center_alpha=px[w // 2, h // 2][3],
        alpha_min=min(alphas), alpha_max=max(alphas),
    )


def main() -> int:
    ap = argparse.ArgumentParser(description='主界面框架元件生产（程序化位图 + 九宫格参数）')
    ap.add_argument('--out', default=str(DST_DIR))
    ap.add_argument('--check', action='store_true', help='只体检，不写盘')
    args = ap.parse_args()

    out_dir = Path(args.out)
    if not args.check:
        out_dir.mkdir(parents=True, exist_ok=True)

    spec = {}
    keys = []
    bad = 0
    for el in ELEMENTS:
        for state_name, st in el['states']:
            img = render(el, st)
            info = audit(img, el)
            tag = f"{el['id']}_{state_name}"
            keys.append(tag)
            ok = info['size'] == info['expect'] and info['corner_clear'] and info['center_alpha'] > 0
            if not ok:
                bad += 1
            print(f"[{'OK ' if ok else 'BAD'}] {tag:<12} {info['size'][0]}x{info['size'][1]} "
                  f"角落透明={info['corner_clear']} 中心a={info['center_alpha']} "
                  f"a范围[{info['alpha_min']},{info['alpha_max']}]")
            if not args.check:
                img.save(out_dir / f'{tag}.png')

        spec[el['id']] = dict(
            name=el['name'], w=el['w'], h=el['h'], radius=el['r'],
            nine=el['nine'], out_scale=OUT_SCALE,
            source_px=[el['w'] * OUT_SCALE, el['h'] * OUT_SCALE],
            # ⚠️ 九宫格四值**一律写具名值**，不写序列 ——
            #    四家引擎的字段顺序不同（Unity Border 是"左下右上"，其余是"左上右下"），
            #    写序列必然接反。引擎侧按具名属性填（见打印的落地表）。
            inset_design=None if el['inset'] is None else dict(
                left=el['inset'], top=el['inset'], right=el['inset'], bottom=el['inset']),
            inset_source_px=None if el['inset'] is None else dict(
                left=el['inset'] * OUT_SCALE, top=el['inset'] * OUT_SCALE,
                right=el['inset'] * OUT_SCALE, bottom=el['inset'] * OUT_SCALE),
            states=[s for s, _ in el['states']],
        )

    if not args.check:
        spec['_keys'] = keys
        SPEC_JSON.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'\n已写盘 -> {out_dir}  ({len(keys)} 张)')
        print(f'规格表 -> {SPEC_JSON}')

    print('\n---- 九宫格具名参数（填给引擎时按名字填，不要按顺序填）----')
    for k, v in spec.items():
        if k.startswith('_'):
            continue
        if v['nine']:
            i = v['inset_source_px']
            print(f"  {k:<6} 源图 {v['source_px'][0]}x{v['source_px'][1]} | "
                  f"insetLeft={i['left']} insetTop={i['top']} insetRight={i['right']} insetBottom={i['bottom']} "
                  f"(源图像素，= 设计 {v['inset_design']['left']}px x2)")
        else:
            print(f"  {k:<6} 源图 {v['source_px'][0]}x{v['source_px'][1]} | 整图，不切九宫格")
    return 1 if bad else 0


if __name__ == '__main__':
    raise SystemExit(main())
