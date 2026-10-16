#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
战斗内潜航器**侧视剖面**（V6.54）静态预览渲染器。

干什么用
--------
`DiveGame.ts` 的 `drawBody()` 是运行时 `Graphics` 画的，改一个比例常量要开 Creator
才能看到结果，一轮反馈几分钟。这个脚本用 PIL 复刻同一套几何
（**常量从 DiveGame.ts 抄，改了要同步**），直接出图 ——
艇形像不像潜艇、炮位有没有压在艇舷上、缩到 44px 还认不认得出，看一眼就知道。

它**不是**像素级还原：Cocos 的描边端点、抗锯齿与 PIL 不同，
但"哪层压着哪层""炮心在轮廓内还是外"这类判断是一致的。

用法
----
    python tools/preview_hull_side.py --bitmap     # ★ V6.75 位图机体（**唯一代表实机**）
    python tools/preview_hull_side.py --unlock     # 6 孔渐进解锁（已改为位图机体底）
    python tools/preview_hull_side.py --mount      # 炮座四级台阶（零件级，不含机体）
    python tools/preview_hull_side.py              # 出主图（矢量几何参考，见下方 ⛔）
    python tools/preview_hull_side.py --big        # 3 倍放大（看体积线索）
    python tools/preview_hull_side.py --sheet      # 分层拆解
    python tools/preview_hull_side.py --tex        # 质感对照（有无结构层，V6.57）
    python tools/preview_hull_side.py --silhouette # 剪影辨识度测试（100% / 75% / 50%）
    python tools/preview_hull_side.py --flip       # 左右朝向对比（验镜像）

⛔ **V6.75 起机体是位图，矢量机体已从渲染层整体删除。**
   上表里凡走 `draw_hull(...)` 的模式（无参数 / `--sheet` / `--tex` / `--silhouette`
   / `--flip` / 旧 `--turret`）现在**只作几何参考**（`HULL_OUTLINE` 形状、挂点位置、
   炮座零件画法），**不再代表实机画面**。要判实机一律看 `--bitmap`。

输出在 `docs/shots/hull_side_*.png`（位图那张是 `hull_bitmap.png`）。
"""

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

_FONT_CACHE = {}


def F(size):
    """中文字体（PIL 默认字体没有 CJK ⇒ 不加载会满屏豆腐块）。"""
    if size not in _FONT_CACHE:
        try:
            _FONT_CACHE[size] = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)
        except Exception:
            _FONT_CACHE[size] = ImageFont.load_default()
    return _FONT_CACHE[size]


def txt(d, xy, s, fill, size=14):
    d.text(xy, s, fill=fill, font=F(size))

# ---------------------------------------------------------------------------
# ⚠️ 下面这组常量必须与 `cocos/assets/scripts/view/DiveGame.ts` 保持同步。
#    改了 TS 那边忘了改这里，这张预览就变成"骗人的图" —— 比没有更糟。
# ---------------------------------------------------------------------------
SUB_D = 88                      # 艇身总长
HULL_H = 56                     # 艇高
MOUNT_BASE_R = 15               # 炮座安装底板半径（⛔ V6.76 已废：只在出弹点外推里还活着）
MOUNT_RING_R = 7               # 炮身转座半径
SEAT_PORT_R = 4                 # 槽底内孔半径
SLOT_HW = 6.5                   # ★ 发射槽半宽（机体位图自带的开孔 → 见 prep_sub_art.bake_slots）
SLOT_HD = 6.0                   # ★ 发射槽深度（从座心往艇内量）
SLOT_EDGE_OFF = 0.8             # ★ 槽口相对座心的法向外移量（≈ 座心到艇缘的距离）

# ---- V6.77 基座：两种做法（A 只改渲染层 / B 烘进位图）----
# ⚠️ 这两个常量**只在 B 版有作用**。A 版的基座完全落在槽内 ⇒ 不碰剪影。
PED_H = 3.0                     # B 版凸台高度（实机 px）：局部剪影抬高的量
PED_OVER = 2.2                  # B 版凸台比槽**单侧**多出去的量（半宽增量）
# V6.71：炮位真源从「座圈角度 + 压扁投影」换成**归一化安装点**（背脊 3 + 腹部 3）。
# 必须与 `shared/dive/tables.ts` 的 `SEAT_MOUNTS` 逐值一致 —— 这里的预览图是唯一的
# 目视验收手段，不一致就等于"骗人的图"。注意**背是负、腹是正**（sim 的 y 向下）。
SEAT_MOUNTS = [
    (0.66, 0.75), (0.60, -0.80), (0.24, 0.93),
    (-0.22, 0.93), (-0.62, 0.80), (-0.70, -0.67),
]

# 14 点梭形：艏在 +x、艏艉都是圆钝端面、背腹平直
HULL_OUTLINE = [
    (1.00, -0.30), (0.86, -0.74), (0.46, -0.96), (-0.10, -1.00),
    (-0.60, -0.90), (-0.88, -0.62), (-1.00, -0.18), (-1.00, 0.18),
    (-0.88, 0.62), (-0.60, 0.90), (-0.10, 1.00), (0.46, 0.96),
    (0.86, 0.74), (1.00, 0.30),
]
TOWER = [(0.72, -0.86), (0.30, -0.94), (0.40, -1.56), (0.64, -1.56)]   # 指挥塔（V6.71 前移+加高）   # 指挥塔（围壳）
FIN = [(-0.70, -0.62), (-1.02, -1.42), (-0.86, -0.30)]                 # 尾舵（上片）

# 颜色（对应 shared/theme.ts 与 BODY_METAL）
C_BODY = 0x2f8fa8
C_ABYSS = 0x04070d
C_CYAN = 0x4fe8ff
C_CYAN_HI = 0xc8f8ff
C_CYAN_DIM = 0x1f6a7d
C_AMBER = 0xffd166
C_BG = 0x081824
BG_RGB = (0x08, 0x18, 0x24)     # = C_BG，用于半透明图元的混合底

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'shots')


def shade(hexv, f):
    """同 TS 的 `shade()`：单色按系数调明度，夹到 0..255。"""
    r, g, b = (hexv >> 16) & 0xff, (hexv >> 8) & 0xff, hexv & 0xff
    c = lambda v: max(0, min(255, round(v * f)))            # noqa: E731
    return (c(r), c(g), c(b))


def rgb(hexv, f=1.0):
    return shade(hexv, f)


def blend(fg, bg, a):
    return tuple(round(fg[i] * a + bg[i] * (1 - a)) for i in range(3))


def draw_hull(d, cx, cy, scale=1.0, m=1, layers=None, tint=C_BODY):
    """在 (cx, cy) 画一台侧视潜航器。`m` = 朝向镜像(+1 右 / -1 左)。"""
    L = layers or {'shadow', 'side', 'body', 'lit', 'belly', 'detail', 'spine', 'tower',
                   'fins', 'windows', 'prop', 'neon', 'seats'}
    HL = (SUB_D / 2) * scale
    HH = (HULL_H / 2) * scale

    def P(x, y, sc=1.0, dx=0.0, dy=0.0, ysgn=1.0):
        return (cx + dx * scale + x * HL * sc * m,
                cy + dy * scale + y * HH * sc * ysgn)

    def poly(pl, fill):
        d.polygon([(round(p[0]), round(p[1])) for p in pl], fill=fill)

    def line(pl, fill, w):
        d.line([(round(p[0]), round(p[1])) for p in pl],
               fill=fill, width=max(1, int(round(w * scale))), joint='curve')

    # ⓪ 投影（半透明 → 近似混到底色）
    if 'shadow' in L:
        poly([P(x, y, 1.0, 5, 8) for (x, y) in HULL_OUTLINE], blend(rgb(C_ABYSS), BG_RGB, 0.42))
    # ① 侧壁（厚度）
    if 'side' in L:
        poly([P(x, y, 0.99, 0, 6) for (x, y) in HULL_OUTLINE], rgb(C_BODY, 0.28))
    # ② 主体
    if 'body' in L:
        poly([P(x, y) for (x, y) in HULL_OUTLINE], rgb(C_BODY, 0.74))
    # ②b 上缘受光（上半壳轻微提亮 + 贴轮廓的两级渐变光带）
    if 'lit' in L:
        poly([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.95, 0, -3)
              for i in range(0, 7)], rgb(C_BODY, 0.88))
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.90, 0, -2) for i in range(0, 7)],
             blend(rgb(C_BODY, 1.24), BG_RGB, 0.26), 10.0)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.94, 0, -2) for i in range(0, 7)],
             blend(rgb(C_BODY, 1.42), BG_RGB, 0.40), 4.5)
    # ②c 下腹暗带（两级）
    if 'belly' in L:
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.92, 0, 3) for i in range(8, 12)],
             blend(rgb(C_ABYSS), BG_RGB, 0.26), 10.0)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.96, 1, 4) for i in range(8, 12)],
             blend(rgb(C_ABYSS), BG_RGB, 0.42), 5.0)
    # ②d 金属高光带 + 背脊铆钉（V6.57）
    #     ⚠️ 三版被否的方案：竖板缝（读作铁笼）、舷窗暗框（读作一排黑洞）、
    #        低频明暗斑（读作锈渍）。56px 量级上"金属感"只来自**一条集中的镜面亮痕**。
    if 'detail' in L:
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.86, -1, -8) for i in range(1, 6)],
             blend((0xdc, 0xfe, 0xff), BG_RGB, 0.50), 2.6)
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.88, -1, -8) for i in range(1, 6)],
             blend((255, 255, 255), BG_RGB, 0.34), 1.2)
        for i in range(5):
            tt = i / 4
            px = cx + (0.60 - 1.12 * tt) * HL * m
            py = cy + (-0.52 - 0.30 * tt) * HH
            r = 1.45 * scale
            d.ellipse([px - r + 1, py - r + 1, px + r + 1, py + r + 1],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.5))
            d.ellipse([px - r, py - r, px + r, py + r],
                      fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.5))
    # ③ 背脊挂载带（主题色，预览里用 tint）
    if 'spine' in L:
        line([P(HULL_OUTLINE[i][0], HULL_OUTLINE[i][1], 0.78, -2, -6) for i in range(0, 6)],
             rgb(tint, 1.12), 3.0)
    # ④ 指挥塔 + 潜望镜 + 观察窗
    if 'tower' in L:
        poly([P(x, y, 1.0, 0, 5) for (x, y) in TOWER], rgb(C_ABYSS))
        poly([P(x, y) for (x, y) in TOWER], rgb(C_BODY, 0.88))
        line([P(0.42, -1.56), P(0.62, -1.56)], rgb(C_BODY, 1.50), 1.6)
        # 观察窗（V6.57，结构层关掉时不画）
        if 'detail' in L:
            wy = cy - 1.22 * HH
            ax, bx = cx + 0.42 * HL * m, cx + 0.62 * HL * m
            line([(min(ax, bx), wy), (max(ax, bx), wy)], blend(rgb(C_ABYSS), BG_RGB, 0.5), 2.6)
            line([(min(ax, bx) + 1 * scale, wy), (max(ax, bx) - 1 * scale, wy)],
                 blend(rgb(C_CYAN_HI), BG_RGB, 0.62), 1.2)
        line([P(0.52, -1.56), P(0.50, -1.90)], rgb(C_BODY, 1.34), 1.5)
    # ⑤ 尾舵（上下两片）
    if 'fins' in L:
        for sgn in (1, -1):
            poly([P(x, y, ysgn=sgn) for (x, y) in FIN], rgb(C_BODY, 0.55))
    # ⑥ 舷窗带（V6.57：光晕 + 暗窗框 + 玻璃 + 高光点；关掉 detail 走 V6.54 的素圆点）
    if 'windows' in L:
        for i in range(5):
            px, py = P(-0.34 + 0.22 * i, -0.30)
            r = (2.8 if i == 2 else 2.2) * scale
            if 'detail' not in L:
                d.ellipse([px - r, py - r, px + r, py + r], fill=rgb(C_CYAN_HI))
                continue
            gr = r * 2.0
            d.ellipse([px - gr, py - gr, px + gr, py + gr],
                      fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.11))
            d.ellipse([px - r, py - r, px + r, py + r], fill=rgb(C_CYAN_HI))
            hx, hy2, hr = px - r * 0.32 * m, py - r * 0.34, r * 0.34
            d.ellipse([hx - hr, hy2 - hr, hx + hr, hy2 + hr], fill=(255, 255, 255))
    # ⑦ 艉部推进器（竖椭圆护罩 + 轴心）+ 散热格栅
    if 'prop' in L:
        tx, ty = P(-1.00, 0.0)
        rx, ry = HH * 0.26, HH * 0.64
        d.ellipse([tx - rx, ty - ry, tx + rx, ty + ry],
                  outline=rgb(C_BODY, 1.30), width=max(1, int(round(1.6 * scale))))
        r = 2.0 * scale
        d.ellipse([tx - r, ty - r, tx + r, ty + r], fill=rgb(C_CYAN_HI))
        for i in range(3):                                   # 散热格栅（V6.57）
            if 'detail' not in L:
                break
            sx = cx + (-0.60 - i * 0.085) * HL * m
            line([(sx, cy - HH * 0.20), (sx, cy + HH * 0.22)],
                 blend(rgb(C_ABYSS), BG_RGB, 0.26), 1.1)
    # ⑧ 兜底轮廓 —— **V6.85g 实机已整段删除**（与实机 `drawBody` 的 ⑧ 同步）。
    #    用户 2026-10-16：「浮在机体外的霓虹兜底线要我一起收掉，不要其他的描绘」。
    #    这条线画在 `HULL_OUTLINE` 上，而三台位图**涂抹出来的艇身比轮廓瘦**
    #    （艏艉两端差得最多）⇒ 兜线在端部跑出机体外，就是用户看到的那圈霓虹线。
    #    ⛔ **不换成沿 alpha 边缘描线**（用户「不要其他的描绘」）—— 机体与背景的分界
    #       改由位图自带 rim + `drawVeil` 承担。预览必须同删，否则几何参考模式会继续误导。
    #    ⚠️ 保留 `'neon'` 层名（no-op）= 调用点不用改；**别再把这条线画回来**。
    if 'neon' in L:
        pass
    # ⑨ 六个炮位（**校验用**：腹 4 + 背两端 2，座心必须骑在艇缘上，不能浮在外面）
    #     V6.71：与 DiveGame.drawTurret 的 ①②③ 三级同步。
    if 'seats' in L:
        TOP = rgb(C_BODY, 0.52)          # 座叠在**机体**上，不是叠在背景上
        for i, (mu, mv) in enumerate(SEAT_MOUNTS):
            # ⚠️ `HL`/`HH` 在函数开头**已经乘过 scale**（第 109/110 行），这里不能再乘 ——
        #    乘两次会让 6 座飞到机体外面去（旧代码里 `SEAT_RING_R * scale` 是裸半径，才乘）。
            sx = cx + mu * HL * m
            sy = cy + mv * HH
            sgn = -1 if mv < 0 else 1
            ext = i >= 4
            BR = MOUNT_BASE_R * scale * (1.10 if ext else 1)
            RR = MOUNT_RING_R * scale * (1.10 if ext else 1)
            PR = SEAT_PORT_R * scale * (1.10 if ext else 1)
            metal = rgb(C_AMBER if ext else C_CYAN_HI)
            d_in, d_out, hw = BR * 0.34, BR * 1.05, BR * 0.50
            y0, y1 = sy + sgn * d_in, sy + sgn * d_out
            # ① 安装底板：悬臂台 —— **根部宽、外端收窄**（梯形），不是等宽方块。
            #    等宽矩形 + 大面积暗侧壁 = 「机体外面套了六个黑方块」（用户驳回过的读法）。
            hw_out = hw * 0.66
            y_lo, y_hi = min(y0, y1), max(y0, y1)
            # 投影（右下偏移暗盘）
            d.polygon([(sx - hw + 1.5, y_lo + 2.2), (sx + hw + 1.5, y_lo + 2.2),
                       (sx + hw_out + 1.5, y_hi + 2.2), (sx - hw_out + 1.5, y_hi + 2.2)],
                      fill=blend(rgb(C_ABYSS), TOP, 0.34))
            # 侧壁：抬到 0.66 —— 侧壁是"厚度"，不是"暗块"；压太暗就变成外挂黑板
            d.polygon([(sx - hw, y0), (sx + hw, y0), (sx + hw_out, y1), (sx - hw_out, y1)],
                      fill=rgb(C_BODY, 0.66))
            # 顶面（亮一档 + 一条集中的镜面亮痕）
            t_in, t_out = BR * 0.10, BR * 0.14
            hw_top0, hw_top1 = hw - t_in, hw_out - t_in * 0.5
            ty0 = (y0 + sgn * t_in)
            ty1 = (y1 - sgn * t_out)
            d.polygon([(sx - hw_top0, ty0), (sx + hw_top0, ty0),
                       (sx + hw_top1, ty1), (sx - hw_top1, ty1)],
                      fill=rgb(C_BODY, 1.06))
            d.line([(sx - hw_top1, ty0 + (ty1 - ty0) * 0.62), (sx + hw_top1, ty0 + (ty1 - ty0) * 0.62)],
                   fill=blend(rgb(C_BODY, 1.42), BG_RGB, 0.45),
                   width=max(1, round(BR * 0.13)))
            # 螺栓：收在**根部**（宽的那一头）—— 根部才是真正拧在艇体上的位置
            for bx in (-1, 1):
                bpx, bpy = sx + bx * (hw - BR * 0.24), y0 + sgn * (d_out - d_in) * 0.30
                d.ellipse([bpx - BR * .115, bpy - BR * .115 + .6, bpx + BR * .115, bpy + BR * .115 + .6],
                          fill=blend(rgb(C_ABYSS), BG_RGB, 0.55))
                d.ellipse([bpx - BR * .10, bpy - BR * .10, bpx + BR * .10, bpy + BR * .10],
                          fill=rgb(C_BODY, 1.30))
            d.polygon([(sx - hw, y0), (sx + hw, y0), (sx + hw_out, y1), (sx - hw_out, y1)],
                      outline=blend(metal, BG_RGB, 0.45), width=max(1, round(1.2 * scale)))
            # ② 炮口开孔：画在机体那一侧（sy），不是底板上
            d.ellipse([sx - PR, sy - PR, sx + PR, sy + PR],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.66))
            a0 = math.degrees(0.06 * math.pi) if sgn > 0 else math.degrees(1.06 * math.pi)
            d.arc([sx - PR * .94, sy - PR * .94, sx + PR * .94, sy + PR * .94],
                  a0, a0 + math.degrees(0.88 * math.pi),
                  fill=blend(metal, BG_RGB, 0.58), width=max(1, round(PR * 0.30)))
            # ③ 炮身转座（待机姿态：炮管朝艏；实机里这一圈才吃 ang）
            a_rad = math.radians(0 if m > 0 else 180)
            r_out = BR * 0.58          # 转座沿法线外移，别把炮口开孔盖住
            ring_c = (sx, sy + sgn * r_out)
            d.ellipse([ring_c[0] - RR, ring_c[1] - RR, ring_c[0] + RR, ring_c[1] + RR],
                      fill=rgb(C_BODY, 0.50))
            d.ellipse([ring_c[0] - RR, ring_c[1] - RR, ring_c[0] + RR, ring_c[1] + RR],
                      outline=metal, width=max(1, round(1.3 * scale)))
            # ④ 发射器：待机朝艏（实机里这一层吃 ang 转向）
            ang_idle = 0 if m >= 0 else math.pi
            for k in (-0.5, 0.5):
                by = k * EMITTER_SIZE * scale * 0.26
                bx = ring_c[0] - math.sin(ang_idle) * by
                bcy = ring_c[1] + math.cos(ang_idle) * by
                draw_barrel(d, bx, bcy, ang_idle, -EMITTER_SIZE * scale * 0.30,
                            EMITTER_SIZE * scale * 0.68, EMITTER_SIZE * scale * 0.155,
                            rgb(C_AMBER), scale, True, False)

def canvas(w, h, bg=C_BG):
    img = Image.new('RGB', (w, h), rgb(bg))
    return img, ImageDraw.Draw(img)


# ---------------------------------------------------------------------------
# V6.75 **位图机体**（`sub_hull`）
# ---------------------------------------------------------------------------
# ⛔ **矢量机体已从渲染层整体删除**（V6.75，用户 2026-10-15 拍板
#    「不要用矢量画，要有立体感、真实美感、挂点要对」）。
#    ⇒ 本脚本里所有 `draw_hull(...)` 的模式（`--sheet` / `--tex` / `--unlock` 的旧版 /
#      `--silhouette` / `--flip`）现在只作**几何参考**（`HULL_OUTLINE` 的形状、
#      挂点位置、炮座零件的画法），**不再代表实机画面**。
#      要判实机，用 `--bitmap` / `--unlock` / `--mount` —— 那三个已改成贴位图机体。
#
# ⚠️ 参数必须与 `DiveGame.ts` 的 `SUB_HULL` **逐值一致**（同源铁规）；
#    真源由 `tools/prep_sub_art.py` 打印（画布尺寸 + 躯干中心占比）。
SUB_HULL_ART = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'cocos', 'assets', 'resources', 'sub', 'sub_hull.png')
SUB_HULL = {'w': 102.0, 'h': 90.25, 'cx': 0.5000, 'cy': 0.5928}

# ---------------------------------------------------------------------------
# 机体投影（实机的 `subShadow`）怎么画。**这是"实机在画什么"的单一真源** ——
# `paste_hull` 的默认值就是它，⛔ 别在调用点写死 `'hard'`：
#   · `'none'` —— **V6.77c 实机采纳**：投影节点已整体删除（用户 2026-10-15
#     「我说的是截图这块的黑色」）。潜航器漂在水里，不存在"地面投影"。
#   · `'hard'` —— V6.75~V6.77b 的实机行为：同形近黑副本 `(4,13,20)` @α0.5，
#     右下偏移 (5,8)。硬边露在剪影外 ⇒ 读作"粘了块黑胶布"。**仅作历史对照**。
#   · `'soft'` —— 提案（**未实装**）：轮廓 alpha 高斯模糊 + 低 α ⇒ 读作弥散阴影。
# ⚠️ 实机截图实测（2026-10-15）：`'hard'` 在右端露 6~8px、腹下露 11px，
#    暗带 luma≈59 而同一处水体 luma 148（反差 2.5×）。
# ---------------------------------------------------------------------------
SHADOW = 'none'


def hull_edge(img, cx, cy, scale=1.0, m=1):
    """⑧ **兜底轮廓** —— V6.85g 起**实机已整段删除**，本函数保留为 no-op。

    用户 2026-10-16：「浮在机体外的霓虹兜底线要我一起收掉，不要其他的描绘」。
    这条线画在 `HULL_OUTLINE` 上，而三台位图**涂抹出来的艇身比轮廓瘦**（艏艉差最多）
    ⇒ 兜线在端部跑出机体外。⛔ **不换成沿 alpha 边缘描线**（用户「不要其他的描绘」）。

    历史：V6.75 换位图时它曾是"唯一让机体从背景里分出来"的一层；V6.77 从亮 `UI.cyan`
    改成暗 `UI.abyss`（铁规 14：闭环 + 高亮 = "UI 框"的语汇）—— 但**暗缝同样贴在轮廓上**，
    端部照样跑出机体 ⇒ V6.85g 整段删除。分界改由位图自带 rim + `drawVeil` 承担。
    ⚠️ 保留函数签名 = `paste_hull` 调用点不用改；**别再把线画回来**。
    """
    return  # V6.85g：⑧ 已删除


def hull_rails(img, cx, cy, scale=1.0, m=1, dark=True, tint=C_CYAN):
    """复刻 `DiveGame.drawBody` 的 ③/③b **挂载带**（背脊 + 腹部导轨）。

    ⚠️ 这一层在预览里**曾经整层缺失** —— 与 ⑧ 兜底轮廓同一个坑（V6.75 换位图时只贴了
       图、忘了同步）。⇒ 出给用户看的合成图比实机少一层，"实机有这个、图里却没有"的
       错觉就是这么来的。**实机画什么，预览就画什么。**

    参数逐值对齐实机：
      · 背脊：`edge(0, 5, sc=0.78, dx=-2, dy=-6)`
      · 腹部：`HULL_OUTLINE[7..12]`，x 走 `×0.80`、y 走 `×0.86` 再 `+5`
        （⚠️ **两个缩放不同**，照抄，别"统一成一个"）

    `dark=True` = V6.77b 的**暗缝**（`shade(tint, 0.34)`，α 0.72/0.60，宽 2.4）；
    `dark=False` = V6.77 之前的**亮主题色线**（`shade(tint, 1.12)`，宽 3.0）——
    只用于"改前"对照，⛔ 别当成当前实机。
    """
    d = ImageDraw.Draw(img, 'RGBA')
    HL, HH = SUB_D / 2 * scale, HULL_H / 2 * scale
    if dark:
        col, a1, a2, w = shade(tint, 0.34), 0.72, 0.60, 2.4
    else:
        col, a1, a2, w = shade(tint, 1.12), 0.92, 0.72, 3.0
    spine = [(cx - 2 * scale + HULL_OUTLINE[i][0] * HL * 0.78 * m,
              cy - 6 * scale + HULL_OUTLINE[i][1] * HH * 0.78) for i in range(0, 6)]
    belly = [(cx + HULL_OUTLINE[i][0] * HL * 0.80 * m,
              cy + HULL_OUTLINE[i][1] * HH * 0.86 + 5 * scale) for i in range(7, 13)]
    lw = max(1, int(round(w * scale)))
    d.line([(round(p[0]), round(p[1])) for p in spine],
           fill=blend(col, BG_RGB, a1), width=lw, joint='curve')
    d.line([(round(p[0]), round(p[1])) for p in belly],
           fill=blend(col, BG_RGB, a2), width=lw, joint='curve')


def paste_hull(img, cx, cy, scale=1.0, m=1, shadow=None, edge=False,
               rails=True, rails_dark=True):
    """贴**位图机体**到 `(cx, cy)` —— 该点是**躯干中心**，与 `SEAT_MOUNTS` 同一基准。

    与 `DiveGame.syncSub` 同一套摆放（躯干矩形 == `SUB_D × HULL_H` ⇒ 挂点必然贴合）。
    `shadow` 取 `'none' | 'hard' | 'soft'`；**默认 `None` = 跟随模块级 `SHADOW`**，
    也就是"实机当前在画什么"（V6.77c 起 = `'none'`，投影节点已删）。
    ⛔ 别在调用点把 `shadow='hard'` 写死 —— 那正是"预览比实机差一层"的老坑
    （与 `draw_turret` 默认值踩过的是同一个）。
    `rails=True` 时画 ③/③b 挂载带（见 `hull_rails`，V6.77b = 暗缝）；
    `edge` 参数保留但 **V6.85g 起默认 `False`** —— 实机已删 ⑧ 兜底轮廓
    （`hull_edge` 现为 no-op，见它）；传 `True` 不再有任何效果。
    返回 False 表示磁盘上还没有位图（此时应退回 `draw_hull` 的几何参考）。
    """
    if not os.path.exists(SUB_HULL_ART):
        return False
    art = Image.open(SUB_HULL_ART).convert('RGBA')
    w = max(1, int(round(SUB_HULL['w'] * scale)))
    h = max(1, int(round(SUB_HULL['h'] * scale)))
    art = art.resize((w, h), Image.LANCZOS)
    if m < 0:
        art = art.transpose(Image.FLIP_LEFT_RIGHT)
    tx, ty = SUB_HULL['cx'] * w, SUB_HULL['cy'] * h
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sh = SHADOW if shadow is None else shadow
    if sh == 'hard':
        # V6.75~V6.77b 的实机行为（现已删除，留作对照）。
        s1 = Image.new('RGBA', art.size, (4, 13, 20, 255))
        s1.putalpha(art.getchannel('A').point(lambda v: int(v * 0.5)))
        layer.alpha_composite(s1, (int(round(cx - tx + 5 * scale)),
                                   int(round(cy - ty + 8 * scale))))
    elif sh == 'soft':
        # 提案（未实装）：模糊 + 低 α + 小偏移。判据是"还认不认得出边缘"。
        a2 = art.getchannel('A').filter(ImageFilter.GaussianBlur(2.6 * scale))
        a2 = a2.point(lambda v: int(v * 0.34))
        s2 = Image.new('RGBA', art.size, (6, 18, 26, 255))
        s2.putalpha(a2)
        layer.alpha_composite(s2, (int(round(cx - tx + 2 * scale)),
                                   int(round(cy - ty + 5 * scale))))
    layer.alpha_composite(art, (int(round(cx - tx)), int(round(cy - ty))))
    img.paste(layer, (0, 0), layer)
    if rails:
        hull_rails(img, cx, cy, scale, m, rails_dark)
    if edge:
        hull_edge(img, cx, cy, scale, m)
    return True


# ---------------------------------------------------------------------------
# 炮塔预览（V6.57）：复刻 drawTurret 的「底座 + 内凹槽 + 壳体 + 枪族发射器」
# ⚠️ 与 DiveGame.ts 的 drawTurret / drawEmitter('gun') 同步，改那边要改这里。
# 目的：用户「发射装置像贴图」—— 放大 6 倍看挂点有没有厚度、炮管是不是从壳里出来的。
# ---------------------------------------------------------------------------
# ⚠️ 必须 = `tables.ts` 的 `EMITTER_SIZE`。曾经写 13（而真源是 18）⇒ 预览里的枪
#    一直是**小一号**的，看"机匣尾端有没有伸进槽里"这种判据时会被骗（0.58×13=7.5 对
#    0.58×18=10.4，尾端深度差 3px）。2026-10-15 修正。
EMITTER_SIZE = 18


def _R(cx, cy, ang, lx, ly):
    c, s = math.cos(ang), math.sin(ang)
    return (cx + lx * c - ly * s, cy + lx * s + ly * c)


def draw_sockets(d, cx, cy, installed, maxw, scale=1.0, m=1, top=None):
    """V6.74 **炮位插座层** —— 把「最多 6 个发射孔、慢慢解锁」画在机体上。

    与 `DiveGame.drawSeatSockets` **同规则、同参数**（改 TS 必须同步改这里）：
      · `i < installed`        → **不画**（`draw_turret` 的四级台阶会盖住这一带）
      · `installed ≤ i < maxw` → **敞开的插座**：底板 + 内凹暗孔 + 翻边
      · `i ≥ maxw`             → **焊死的盖帽**：底板压暗 + 转座位置一颗实心盖
                                 （十字焊缝 + 四颗螺栓），**没有孔、没有高光**

    ⚠️ **几何必须与 `draw_turret` 同源**：第一版这里自己写了一套
       `ellipse(BR*0.92)`（Ø28 大圆），而炮座底板其实是 **15×11 的梯形** ——
       于是"空座"比"装好的炮"还大一圈，6 座像贴了六个碟子。
       **同一物理位置的两种状态，几何只能有一处定义。**
    ⚠️ ②③ 的差别**只能靠"有没有孔"**，不能靠颜色（深海会压掉亮度，15px 上分不开）。
    """
    TOP = top if top is not None else rgb(C_BODY, 0.74)
    for i, (mu, mv) in enumerate(SEAT_MOUNTS):
        if i < installed:
            continue
        sgn = -1 if mv < 0 else 1
        is_open = i < maxw
        ext = i >= 4
        x = cx + mu * (SUB_D / 2) * scale * m
        y = cy + mv * (HULL_H / 2) * scale
        PR = SEAT_PORT_R * scale * (1.10 if ext else 1.0)
        HW = SLOT_HW * scale * (1.10 if ext else 1.0)
        HD = SLOT_HD * scale * (1.10 if ext else 1.0)
        metal = rgb(C_AMBER if ext else C_CYAN_HI)
        y_out = y + sgn * SLOT_EDGE_OFF * scale
        y_in = y - sgn * HD

        # ⛔ V6.76：**不再画安装底板**（V6.74 的梯形悬臂台整个伸在艇身轮廓之外，
        #    六座读作"贴在艇上的积木"）。槽由**机体位图自带**（prep_sub_art.bake_slots），
        #    这里只剩"空座的内孔"与"未解锁的齐平封板"两件事。
        if is_open:
            # 空座：槽底一个发射口 + 一点呼吸光（槽本身在位图上）
            cyf = y - sgn * (HD * 0.58)
            d.ellipse([x - PR, cyf - PR, x + PR, cyf + PR], fill=blend(rgb(C_ABYSS), TOP, 0.72))
            box = [x - PR * 0.94, cyf - PR * 0.94, x + PR * 0.94, cyf + PR * 0.94]
            a0, a1 = (0.06, 0.94) if sgn > 0 else (1.06, 1.94)
            d.arc(box, start=a0 * 180, end=a1 * 180,
                  fill=blend(metal, TOP, 0.36), width=max(1, round(PR * 0.30)))
            # ⛔ V6.76 不给"可装"+加呼吸光（那是又一层画上去的东西，3.2× 下糊成灰斑）
        else:
            # 未解锁：**齐平封板**（正好填掉图上那个槽，外缘与艇缘齐平、不凸出）
            hx = HW + 0.5 * scale
            yo = y_out + sgn * 0.4 * scale
            yt, yb2 = min(yo, y_in), max(yo, y_in)
            hr = max(1, int(round(0.9 * scale)))
            d.rectangle([x - hx, yt, x + hx, yb2], fill=rgb(C_BODY, 0.50))
            d.rectangle([x - hx + hr, yt + hr, x + hx - hr, yb2 - hr], fill=rgb(C_BODY, 0.62))
            wseg = max(1, round(min(HW, HD) * 0.34))
            ymid = y - sgn * HD * 0.5
            d.line([(x - HW * 0.62, ymid), (x + HW * 0.62, ymid)],
                   fill=rgb(C_BODY, 0.86), width=wseg)
            d.line([(x, y - sgn * HD * 0.16), (x, y - sgn * HD * 0.84)],
                   fill=rgb(C_BODY, 0.86), width=wseg)
            d.line([(x - hx, y_out - sgn * 0.2 * scale), (x + hx, y_out - sgn * 0.2 * scale)],
                   fill=blend(rgb(C_ABYSS), TOP, 0.42), width=max(1, round(1.1 * scale)))
            d.rectangle([x - hx, yt, x + hx, yb2], outline=blend(rgb(C_ABYSS), TOP, 0.55),
                        width=max(1, round(1.0 * scale)))


def draw_turret(d, cx, cy, ang_deg, scale=6.0, ext=False, firing=False, sgn=1, base='A',
                ro=None, tail=None, plain=True, warm_edge=False, no_ring=True,
                fam='gun', wid=None):
    """V6.76 安装结构的 Python 复刻（与 `DiveGame.drawTurret` 同步）。

    ★ V6.76 大改：**删掉 V6.74 的"梯形悬臂台"**（`MOUNT_BASE_R=15` 的底板，
    台面整个伸在 `HULL_OUTLINE` 之外 ⇒ 六座读作"贴在艇上的积木"，用户驳回的
    「你画上去的突兀感」）。现在安装结构 = **机体位图上的槽**（开孔在图上）
    + 插进槽里的柱脚 + 转座。柱脚**比槽窄** ⇒ 槽左右露出约 2px 暗腔 = "插进去"。

    ★ V6.77 新增 `base` —— **转座的画法**，三档（见 `--base` 模式）：
      · `'now'` = V6.76 原样（转座描一圈**近白整圆**）—— 只作对照锚点；
      · `'A'`   = 座圈做成**槽内金属衬环** + 转座改成"暗体 + 单侧受光弧"（**只改渲染层**，
                 剪影/挂点/弹道**零改动**）；
      · `'B'`   = 同 A 的转座，但整体**抬高 `PED_H`**（因为机体图上长了一圈凸台，
                 见 `draw_pedestal`）—— 最像"机体自带"，但炮口视觉高度会 +2.5px。

    `sgn` = -1 背脊 / +1 腹部。柱脚与槽底暗口**不吃 `ang`**，只有转座/发射器吃。

    ⚠️ **默认值 = 实机当前采纳的样式**（`base='A', plain=True, no_ring=True`）：
       用户 2026-10-15 拍板「选择A2  同时炮口的黄色半圆也去掉」。
       ⇒ 所有"代表实机"的预览（`--combat` / `--bitmap` / `--unlock` / `--mount` / `--turret`）
         **不传参就是对的**；要画"改前"必须**显式**传 `base='now', plain=False, no_ring=False`
         （`--emit` / `--base` 那两个历史对照模式就是这么做的 —— 别把它们的显式值删掉）。
       ⚠️ 这一条是踩出来的：默认值一度停在旧样式，于是 `--combat` 一直在给用户看
         **实机上已经不存在的黄色炮**（"预览比实机差一层"的同款坑）。
    """
    ang = math.radians(ang_deg)          # sim 语义：y 向下、顺时针为正
    S = EMITTER_SIZE * scale
    RR = MOUNT_RING_R * scale * (1.10 if ext else 1)
    PR = SEAT_PORT_R * scale * (1.10 if ext else 1)
    HW = SLOT_HW * scale * (1.10 if ext else 1)
    HD = SLOT_HD * scale * (1.10 if ext else 1)
    metal = rgb(C_AMBER if ext else C_CYAN_HI)
    # B 版：整座（柱脚 + 转座 + 发射器）随凸台一起抬高 `PED_H`。
    # ⚠️ 必须在这里定义 —— ① 柱脚就要用它（挪到 ③ 那段会 UnboundLocalError）。
    lift = (PED_H * scale * sgn) if base == 'B' else 0.0

    # ① 柱脚：从槽底长到转座（**比槽窄**，`2(PR+0.5)=9px < 2·SLOT_HW=13px`）
    #   ★ V6.77 `ro` = 覆盖"转座心相对座心的外移量"（实机 px，不含 scale）。
    #     默认 `RR*0.90 ≈ 6.3`；把它收到 `SLOT_EDGE_OFF` 附近 = 「**绑定发射口**」。
    #     ⚠️ 收小 `ro` 会**缩短柱脚** ⇒ 柱脚太短时槽会被转座盖死，"装在槽里"读不出来；
    #        `r_out` 与 `tail` 是**一对**（尾端 = `r_out − tail×EMITTER_SIZE` 必须 ≥ `−SLOT_HD`）。
    r_out = (RR * 0.90) if ro is None else (ro * scale * (1.10 if ext else 1))
    tail_f = 0.58 if tail is None else tail
    hw_foot, hw_top = PR, RR * 0.75
    # ⚠️ B 版：柱脚**生根在凸台顶面**（不是槽底）—— 否则柱脚会穿过凸台，读作"两根柱子"。
    y_foot = (cy + sgn * PED_H * scale) if base == 'B' else (cy - sgn * (HD - 0.6 * scale))
    y_top = cy + sgn * r_out + lift
    leg = lambda h0, h1, ay, by, dy: [(cx - h0, ay + dy), (cx + h0, ay + dy),
                                      (cx + h1, by + dy), (cx - h1, by + dy)]  # noqa: E731
    d.polygon(leg(hw_foot, hw_top, y_foot, y_top, 1.6 * scale),
              fill=blend(rgb(C_ABYSS), BG_RGB, 0.32))
    d.polygon(leg(hw_foot, hw_top, y_foot, y_top, 0), fill=rgb(C_BODY, 0.50))
    d.polygon(leg(hw_foot - 0.8 * scale, hw_top - 0.8 * scale,
                  y_foot - sgn * 0.9 * scale, y_top - sgn * 1.0 * scale, 0),
              fill=rgb(C_BODY, 0.86))
    d.line([(cx - (hw_top - 1.8 * scale), y_top - sgn * 2.2 * scale),
            (cx + (hw_top - 1.8 * scale), y_top - sgn * 2.2 * scale)],
           fill=blend(rgb(C_BODY, 1.30), BG_RGB, 0.30), width=max(1, round(1.1 * scale)))
    # 柱脚外轮廓：`plain` 下同样走暗缝（"柱脚与艇面的交界"是暗的，不是描的一条亮线）
    d.polygon(leg(hw_foot, hw_top, y_foot, y_top, 0),
              outline=(blend(rgb(C_ABYSS), BG_RGB, 0.50) if plain
                       else blend(metal, BG_RGB, 0.40)),
              width=max(1, round(1.1 * scale)))

    # ② 槽底暗口：横跨**整个槽宽**（柱脚两侧各露一段 ⇒ "柱脚是从洞里升上来的"）
    #   ⚠️ B 版跳过：凸台顶上已经有一个同义的暗孔（见 `draw_pedestal`），两个都画 = 两个洞。
    if base != 'B':
        yb = cy - sgn * (HD - 1.0 * scale)
        d.line([(cx - HW * 0.92, yb), (cx + HW * 0.92, yb)],
               fill=blend(rgb(C_ABYSS), BG_RGB, 0.58), width=max(1, round(1.6 * scale)))

    # ③ 炮身转座（**这一圈才吃 ang**）+ 轴颈
    #   ⚠️ V6.77：`base='now'`（对照锚点）**原样保留 V6.76 的画法** —— 那圈 `outline=metal`
    #      的**近白整圆**正是用户说的「还是有一层白圈呢」。A/B 两版都换成
    #      「**暗金属实心 + 单侧受光弧 + 右下暗弧**」：
    #      闭合的近白圆是"UI 框"的语汇（铁规 14 的同一条判据），金属只能靠
    #      **暗体 + 一条受光弧** 读出来；整圈闭合反而把它拉回"描上去的一根线"。
    #   ⚠️ 耳轴同理：孤立的两颗小圆点（V6.76）读作"浮在旁边的点"，
    #      改成从转座**伸出来的一段轴颈**（有连接段）才读作零件。
    rx, ry = cx, cy + sgn * r_out + lift
    if base == 'now':
        d.ellipse([rx - RR, ry - RR, rx + RR, ry + RR], fill=rgb(C_BODY, 0.50))
        d.arc([rx - RR * .76, ry - RR * .76, rx + RR * .76, ry + RR * .76],
              math.degrees(math.pi * 1.02), math.degrees(math.pi * 1.46),
              fill=blend(rgb(C_BODY, 1.34), BG_RGB, 0.38), width=max(1, round(RR * 0.24)))
        d.ellipse([rx - RR, ry - RR, rx + RR, ry + RR], outline=metal, width=max(1, round(1.3 * scale)))
        for sx in (-1, 1):
            tx, ty = _R(rx, ry, ang, 0, sx * RR * 1.02)
            d.ellipse([tx - RR * .20, ty - RR * .20 + .7, tx + RR * .20, ty + RR * .20 + .7],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.55))
            d.ellipse([tx - RR * .17, ty - RR * .17, tx + RR * .17, ty + RR * .17],
                      fill=rgb(C_BODY, 1.28 if sx < 0 else 0.72))
    else:
        # ⛔ 这里**不能**再画"比转座大的衬环"：转座本身就比槽口略大
        #    （`2×MOUNT_RING_R = 14` > `2×SLOT_HW = 13`，刻意让转座正好塞满槽口），
        #    任何大于 `RR` 的环都会**伸出槽外** ⇒ 立刻读作"画上去的一圈"（铁规 12）。
        #    ⇒ A 版的"基座"只能是**图上那个槽 + 槽底翻边**（已由 `bake_slots()` 烘好），
        #     渲染层只负责把转座从"描上去的白圈"改成**金属实体**。
        #    试过 RR×1.36（9.5px）的衬环，实机图上一眼就是"炮底下垫了个盘子"。
        # 转座本体：暗金属实心 + 单侧（左上）受光弧 + 右下暗弧 —— **没有闭合亮圈**
        d.ellipse([rx - RR, ry - RR, rx + RR, ry + RR], fill=rgb(C_BODY, 0.58))
        # ⚠️ 受光弧的颜色**逐值对齐游戏**（`DiveGame.drawTurret` 的 `hiCol`）：
        #    扩容座（ext）泛暖 ← amber 与提亮金属 55% 混合；开火时弧更亮（0.62 → 0.85）。
        hi_arc = (blend(rgb(C_AMBER), rgb(C_BODY, 1.34), 0.55) if ext
                  else rgb(C_BODY, 1.34))
        d.arc([rx - RR, ry - RR, rx + RR, ry + RR], 176, 292,
              fill=blend(hi_arc, BG_RGB, 0.85 if firing else 0.62),
              width=max(1, round(RR * 0.24)))
        d.arc([rx - RR, ry - RR, rx + RR, ry + RR], 8, 126,
              fill=blend(rgb(C_ABYSS), BG_RGB, 0.42), width=max(1, round(RR * 0.16)))
        # 轴颈：从转座伸出来的一段短轴（有连接段，不是孤立圆点）
        for sx in (-1, 1):
            ax, ay = _R(rx, ry, ang, 0, sx * RR * 1.30)
            bx, by = _R(rx, ry, ang, 0, sx * RR * 0.60)
            d.line([(bx, by), (ax, ay)], fill=rgb(C_BODY, 0.44 if sx > 0 else 0.62),
                   width=max(2, round(RR * 0.34)))
            d.line([(bx, by), (ax, ay)], fill=rgb(C_BODY, 1.22 if sx < 0 else 0.80),
                   width=max(1, round(RR * 0.15)))

    # ---- 发射器：**7 族**（V6.79 起全部硬件化）----
    #  ⚠️ 2026-10-15 修正：旧版漏画了**机匣**、管径比也是自己编的（0.20 vs 真源 0.155），
    #     而"机匣尾端伸进槽内"正是"插上去"的机械依据 ⇒ 漏了它，这张图就在骗人。
    #  ★ V6.79：族特征**全部交给 `draw_emitter`**（与 `DiveGame.drawEmitter` 同源），
    #     这里只负责 **机匣 + 枪族开火焰** 这两件全族共用的事。
    #     ⚠️ 替换掉了原来内联的"双管"，所以 `gun` 分支的 pitch/管径只剩一处定义。
    c_emit = rgb(C_AMBER)
    # ⓪ 机匣（全族共用）：尾厚前薄，尾端要**伸进槽里**。`warm=False` ⇒ 不给本色
    draw_barrel(d, rx, ry, ang, S * 0.06, -S * tail_f, S * 0.34, c_emit, scale,
                bore=False, plain=plain, warm=False, no_ring=no_ring)
    # ① 族特征
    draw_emitter(d, fam, rx, ry, ang, S, c_emit, scale, firing, wid=wid)
    # ② 开火：枪口焰 + 前向长焰（**枪族专属**；其余族的"开火"写在各自分支里）
    if firing and fam == 'gun':
        mx, my = _R(rx, ry, ang, S * 0.86, 0)
        fr = 9 * scale
        d.ellipse([mx - fr, my - fr, mx + fr, my + fr], fill=blend(rgb(C_AMBER), BG_RGB, 0.9))
        tx, ty = _R(cx, cy, ang, S * 0.86 + 7 * scale, 0)
        tr = 3.4 * scale
        d.ellipse([tx - tr, ty - tr, tx + tr, ty + tr], fill=(255, 255, 255))


def draw_pedestal(d, cx, cy, sc, sgn):
    """V6.77 **B 版**的凸台 —— 模拟"机体位图里本来就长着这一圈矮环"。

    ⛔ 这一版**必须改剪影**（凸台高出艇面 `PED_H` 实机 px），所以实装时还欠两件事：
      ① `HULL_OUTLINE` 的霓虹外轮廓要在凸台处**跟着抬** —— 否则轮廓线会把凸台切在
         艇体之外，它立刻读作"露在艇外的异物"（正是 V6.76 返工的同一个根因）；
      ② 炮口视觉高度 +`PED_H`，必须**同步核 `MUZ`**（`world.ts` 的出弹点外推），
         否则子弹会从炮管**下方**飞出来。
    ⇒ 这两条就是图里"B 版要付的代价"。

    画法只用四条体积线索（投影 → 侧壁 → 顶面 → 外沿受光弧 → 顶面暗孔），
    ⛔ **不给任何闭合亮边**（那会把它变回"描上去的一圈"）。
    """
    h = PED_H * sc
    top = cy + sgn * h
    hw0 = (SLOT_HW + PED_OVER) * sc           # 底半宽（与艇面相交处）
    hw1 = (SLOT_HW + PED_OVER * 0.55) * sc    # 顶半宽（收一点 ⇒ 读作拔模斜度）
    r = h * 1.35
    # ⓪ 投影（右下偏移）
    d.polygon([(cx - hw0 + 1.4 * sc, cy + 1.4 * sc), (cx + hw0 + 1.4 * sc, cy + 1.4 * sc),
               (cx + hw1 + 1.4 * sc, top + 1.4 * sc), (cx - hw1 + 1.4 * sc, top + 1.4 * sc)],
              fill=blend(rgb(C_ABYSS), BG_RGB, 0.30))
    # ① 侧壁（暗一档 = 有厚度）
    d.polygon([(cx - hw0, cy), (cx + hw0, cy), (cx + hw1, top), (cx - hw1, top)],
              fill=rgb(C_BODY, 0.44))
    # ② 顶面（受光面）
    d.ellipse([cx - hw1, top - r, cx + hw1, top + r], fill=rgb(C_BODY, 0.74))
    # ③ 外沿受光弧：只给**上侧**一段（光源固定世界左上）
    d.arc([cx - hw1, top - r, cx + hw1, top + r], 178, 302,
          fill=blend(rgb(C_BODY, 1.26), BG_RGB, 0.50), width=max(1, round(1.0 * sc)))
    # ④ 顶面暗孔：柱脚从这里长出来（与 A 版的"槽底暗口"同义）
    b = SEAT_PORT_R * sc * 1.15
    d.ellipse([cx - b, top - b * 0.55, cx + b, top + b * 0.55], fill=rgb(C_ABYSS, 0.60))


def draw_barrel(d, cx, cy, ang, l0, l1, hh, col, scale=1.0, bore=True, firing=False,
                plain=False, warm=False, warm_edge=False, no_ring=False):
    """V6.70 `DiveGame.barrel` 的 Python 复刻（炮管：锥形圆柱 + 炮口内孔 + 口环）。

    ⚠️ 与 `cocos/assets/scripts/view/DiveGame.ts` 的 `barrel()` 同步，改那边要改这里。
    三条缺一不可：① 管身是**有上下缘的圆柱**（不是一条线）② 炮口**内孔 + 口环**
    ③ 根部收窄（不出现"直线插进圆里"的硬接缝）。

    ★ V6.77 `plain` —— **把"本色描边"从亮线换成暗缝**。
      用户 2026-10-15：「黄色的描绘能改下吗 不改的话 像是画上去的」。
      原因是**闭合的亮色轮廓 = "UI 框"的语汇**（铁规 14）——
      一根管子整圈描一条高饱和亮线，无论颜色多对，读出来都是"贴纸的边"，
      不是"金属零件在光里的边"。⇒ `plain` 模式下：
        · 管身外轮廓 → 走**暗缝**（`UI.abyss` 半透）＝"管子与背景的分界"，
          这是**暗**的，符合"金属靠明暗读，不靠描边读"；
        · 武器本色只留在**炮口口环**（本来就是圆环，闭合是几何正确的）
          和一个很淡的内孔圈上 ⇒ 身份还在，但不再是"框"。
      ⚠️ 别把本色彻底删掉 —— "这是谁的枪"仍要由颜色回答（见 `DiveGame` 机匣注释）。
    """
    P = lambda lx, ly: _R(cx, cy, ang, lx, ly)
    S = lambda v: max(1, round(v))          # 线宽下限 1px（0.5px 会被 PIL 抹掉）

    body = [P(l0, -hh * 0.82), P(l1, -hh), P(l1, hh), P(l0, hh * 0.82)]
    d.polygon([(round(p[0]), round(p[1])) for p in body], fill=rgb(C_BODY, 0.60))
    # 上缘高光 / 下缘暗线（上亮下暗 = 圆柱感）
    # ⚠️ `warm_edge`：把**武器本色搬进这条受光带**（本色 ← 金属高光，45%）。
    #    这是"黄的"最好的去处 —— 它不再是**轮廓**（闭合亮线 = UI 框的语汇），
    #    而是**同一块金属上被光照到的那条边**：形状由几何决定，颜色只是光的一部分。
    hi0, hi1 = P(l0 + 1.5, -hh * 0.58), P(l1 - 1.2, -hh * 0.72)
    hi_col = (blend(col, rgb(C_BODY, 1.30), 0.45) if warm_edge
              else blend(rgb(C_BODY, 1.30), BG_RGB, 0.80))
    d.line([(round(hi0[0]), round(hi0[1])), (round(hi1[0]), round(hi1[1]))],
           fill=hi_col, width=S(hh * 0.30))
    lo0, lo1 = P(l0 + 1.5, hh * 0.64), P(l1 - 1.2, hh * 0.78)
    d.line([(round(lo0[0]), round(lo0[1])), (round(lo1[0]), round(lo1[1]))],
           fill=blend(rgb(C_ABYSS), BG_RGB, 0.50), width=S(hh * 0.26))
    # 轮廓：本色亮线（旧） / 暗缝（`plain`）
    edge = blend(rgb(C_ABYSS), BG_RGB, 0.62) if plain else col
    d.polygon([(round(p[0]), round(p[1])) for p in body],
              outline=edge, width=S(1.3))
    # 炮口：口环（亮弧）+ 内孔（暗）
    # ★ V6.77 用户拍板原话：「选择A2  同时炮口的黄色半圆也去掉」。
    #   `no_ring=True` ⇒ **整条口环弧不画**，内孔内圈也不再吃本色（改金属色）。
    #   为什么口环也该去：它是 ~172° 的弧 —— **看着是半圆，读法是"管口描了一圈黄"**，
    #   与管身那道闭合亮边是**同一条判据**（铁规 14：闭合/半闭合的亮色轮廓 = "UI 框"的语汇）。
    #   ⇒ 炮口的可读性改由**内孔本身**承担（暗孔 + 一圈很淡的金属内壁 = "这里有洞"）。
    mo = P(l1, 0)
    rOut, rIn = hh * 1.16, hh * 0.46
    if not no_ring:
        # ⚠️ `plain` 下口环走暖色受光金属，⛔ 别用 `blend(col, BG_RGB)` —— 那会把琥珀
        #    混成**褐色**（6× 下读成"锈斑"，比原来的亮线还糟）。`warm` 才给本色：
        #    机匣的尾环也是 `l1` 端，给它上暖色 ⇒ 每把枪屁股后面挂一块锈斑（试过）。
        if not plain:
            ring = blend(col, BG_RGB, 0.95)
        elif warm and not warm_edge:
            ring = blend(col, rgb(C_BODY, 1.34), 0.55)
        else:
            ring = blend(rgb(C_BODY, 1.30), BG_RGB, 0.75)
        d.arc([mo[0] - rOut, mo[1] - rOut, mo[0] + rOut, mo[1] + rOut],
              math.degrees(ang - 1.5), math.degrees(ang + 1.5),
              fill=ring, width=S(max(1.2, hh * 0.24)))
    if bore:
        d.ellipse([mo[0] - rIn, mo[1] - rIn, mo[0] + rIn, mo[1] + rIn],
                  fill=blend(rgb(C_ABYSS), BG_RGB, 0.72))
        ic = (blend(rgb(C_BODY, 1.30), BG_RGB, 0.40) if no_ring
              else blend(col, BG_RGB, 0.32 if not plain else 0.22))
        d.ellipse([mo[0] - rIn * .66, mo[1] - rIn * .66, mo[0] + rIn * .66, mo[1] + rIn * .66],
                  outline=ic, width=S(1))
    if firing:
        d.ellipse([mo[0] - rIn * .9, mo[1] - rIn * .9, mo[0] + rIn * .9, mo[1] + rIn * .9],
                  fill=blend((255, 255, 255), BG_RGB, 0.9))


def draw_tube(d, cx, cy, ang, l0, h0, l1, h1, scale=6.0, bore=False, bore_r=0.46):
    """V6.79 `DiveGame.metalTube` 的 Python 复刻（**变径**金属管）。

    ⚠️ 与 `cocos/assets/scripts/view/DiveGame.ts` 的 `metalTube()` 同步，改那边要改这里。
    逐条复刻 `barrel` 的四条体积线索，唯一差别是**两端半径可不同**：
      ① 管身 = 四边围成的锥形圆柱（不是一条线）
      ② 上缘受光带 / 下缘暗线（上亮下暗 = 圆柱感）
      ③ 轮廓走**暗缝**（⛔ 不描本色亮边 —— 闭合亮色轮廓是「UI 框」的语汇）
      ④ 前端可选内孔
    用途：**喇叭**（`h0 < h1`，声呐）× **喷嘴**（`h0 > h1`，酸液）——
    这两个形态等半径的 `barrel` 画不出来，而它们正是"这一族长什么样"的全部。

    ⚠️ 轮廓/内孔的线宽这里**随 `scale` 缩放**（`draw_barrel` 是 `S(1.3)`，1.3 未随 scale
       缩放 ⇒ 6× 下轮廓只有 1px、几乎看不见）。预览是给人看的诊断图，粗一点才读得出形态。
    """
    P = lambda lx, ly: _R(cx, cy, ang, lx, ly)          # noqa: E731
    SW = lambda v: max(1, round(v))                      # noqa: E731
    body = [P(l0, -h0 * 0.82), P(l1, -h1), P(l1, h1), P(l0, h0 * 0.82)]
    d.polygon([(round(p[0]), round(p[1])) for p in body], fill=rgb(C_BODY, 0.60))
    hmin = min(h0, h1)
    hi0, hi1 = P(l0 + 1.5 * scale, -h0 * 0.58), P(l1 - 1.2 * scale, -h1 * 0.72)
    d.line([(round(hi0[0]), round(hi0[1])), (round(hi1[0]), round(hi1[1]))],
           fill=blend(rgb(C_BODY, 1.30), BG_RGB, 0.80), width=SW(hmin * 0.42))
    lo0, lo1 = P(l0 + 1.5 * scale, h0 * 0.64), P(l1 - 1.2 * scale, h1 * 0.78)
    d.line([(round(lo0[0]), round(lo0[1])), (round(lo1[0]), round(lo1[1]))],
           fill=blend(rgb(C_ABYSS), BG_RGB, 0.50), width=SW(hmin * 0.36))
    d.polygon([(round(p[0]), round(p[1])) for p in body],
              outline=blend(rgb(C_ABYSS), BG_RGB, 0.62), width=SW(1.3 * scale))
    if bore:
        mo = P(l1, 0)
        r_in = h1 * bore_r
        d.ellipse([mo[0] - r_in, mo[1] - r_in, mo[0] + r_in, mo[1] + r_in],
                  fill=blend(rgb(C_ABYSS), BG_RGB, 0.72))
        d.ellipse([mo[0] - r_in * .66, mo[1] - r_in * .66,
                   mo[0] + r_in * .66, mo[1] + r_in * .66],
                  outline=blend(rgb(C_BODY, 1.30), BG_RGB, 0.40), width=SW(1 * scale))


def _disk(d, cx, cy, r, lum, arc_hi=True, dark=True, scale=6.0):
    """厚盘端面（回声族用）：实心盘 + 上缘受光弧 + 对侧暗弧。

    ⚠️ 三个线索缺一不可 —— 少了受光弧/暗弧，圆盘会退化回"平面的圆"（那正是旧版的问题）。
    """
    SW = lambda v: max(1, round(v))                     # noqa: E731
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgb(C_BODY, lum))
    if arc_hi:
        d.arc([cx - r * .94, cy - r * .94, cx + r * .94, cy + r * .94], 176, 295,
              fill=blend(rgb(C_BODY, 1.34), BG_RGB, 0.55), width=SW(r * 0.22))
    if dark:
        d.arc([cx - r * .94, cy - r * .94, cx + r * .94, cy + r * .94], 10, 122,
              fill=blend(rgb(C_ABYSS), BG_RGB, 0.42), width=SW(r * 0.18))


def draw_emitter(d, fam, cx, cy, ang, S, col, scale=6.0, firing=False, shotgun=False,
                 wid=None):
    """`DiveGame.drawEmitter` 的 Python 复刻（**V6.79：7 族全部硬件化**）。

    ⚠️ 与 `cocos/assets/scripts/view/DiveGame.ts` 的 `drawEmitter()` 同步，改那边要改这里。

    ★ V6.79 之前的实况：只有 `gun` / `torpedo` 是**真零件**（走 `barrel`），其余 5 族是
      "细线 + 实心圆"的粗符号 ⇒ 用户在两轮里分别报
      「只有脉冲机关枪装在炮头上是很适配的，其他的器械都没做好吗」（V6.70）
      与「为什么还有自己画的箭头这些」（V6.79，截图上圈的是鱼叉=箭头 / 声呐·回声=圆形）。
      V6.73 只补了**全族共用的尾部机匣** ⇒ 解决了"有没有身体"，**前端族特征一直是符号**。

    ⇒ 现在 5 族统一改走 `draw_tube`（变径管）+ 厚盘语汇，与枪族共用同一套四条体积线索。
      族与族的差别**全部落在剪影上**（下面这张表就是全部内容）：
        gun     = 双平行管（大口径）
        torpedo = 单粗管 / 集束三管
        sonar   = **外扩喇叭**（h0<h1）+ 开口环 + 振子
        acid    = **收细喷嘴锥**（h0>h1）+ 喷口内孔
        harpoon = **粗杆 + 亮箍 + 2~3 根前张的齿**（★ 鱼叉就是"叉"；"前端收敛成一个尖"
                  必然读作箭头，前后三版都栽在这条线上 —— 详见 `DiveGame.ts` 该分支的注释）
        echo    = 短粗筒 + **封闭厚盘** + 中心凸起
        arc     = **两根短粗电极柱** + 球头（电弧是效果层，仍是细线）
      ⛔ 声呐与回声的分界 = **开口 vs 封死**（喇叭 vs 厚盘）—— 它们曾经都是一个圆，
         正是必须靠剪影分开的那一对。

    ⚠️ 本函数只画**族特征**；全族共用的**尾部机匣**由 `draw_turret` 在调用前画
       （`DiveGame.drawEmitter` 里机匣与族特征是同一个函数，这里为了单独对比族形态拆开了）。
    """
    if fam == 'gun':
        # ⚠️ `plain=True, no_ring=True` = **实机 V6.77 拍板的「去黄」样式，必须显式传** ——
        #    `draw_barrel` 的默认值是**旧样式**（本色口环 + 本色管身轮廓），
        #    漏传就会画出实机上**已经不存在**的黄色炮口（"预览比实机差一层"的老坑，
        #    见 `draw_turret` 的 docstring；本次第一版 7 族图又踩了一次）。
        # 双管（加特林另加两根细管）
        for i in range(2):
            yy = (i - 0.5) * S * 0.26
            bs = (cx - math.sin(ang) * yy, cy + math.cos(ang) * yy)
            draw_barrel(d, bs[0], bs[1], ang, -S * 0.30, S * 0.68,
                        S * 0.185, col, scale, True, firing, plain=True, no_ring=True)
        # 加特林：两根细管（小口径，不给内孔 —— 那是主炮的特权）
        for k in (-1.5, 1.5):
            yy = k * S * 0.19
            bs = (cx - math.sin(ang) * yy, cy + math.cos(ang) * yy)
            draw_barrel(d, bs[0], bs[1], ang, -S * 0.22, S * 0.50, S * 0.075,
                        col, scale, False, False, plain=True, no_ring=True)
        # 霰弹喇叭口：**只在霰弹上画**（画在所有枪族上会让两根炮口之间多出一对交叉斜撑，
        # 6× 下读成一个 "X"  propeller —— 那正是第一版预览被否掉的原因）
        if shotgun:
            m0 = _R(cx, cy, ang, S * 0.68, 0)
            for sgn in (-1, 1):
                m1 = _R(cx, cy, ang, S * 0.88, sgn * S * 0.34)
                d.line([(round(m0[0]), round(m0[1])), (round(m1[0]), round(m1[1]))],
                       fill=blend(col, BG_RGB, 0.9), width=max(1, round(1.8 * scale)))
    elif fam == 'torpedo':
        for yy in (-S * 0.21, 0, S * 0.21):      # 集束三管
            bs = (cx - math.sin(ang) * yy, cy + math.cos(ang) * yy)
            draw_barrel(d, bs[0], bs[1], ang, -S * 0.42, S * 0.62,
                        S * 0.115, col, scale, True, firing, plain=True, no_ring=True)
    # ===== 以下 5 族 = V6.79 新增（改走变径管 / 厚盘语汇）=====
    elif fam == 'sonar':
        SW = lambda v: max(1, round(v * scale))         # noqa: E731  # 参数是实机 px
        fc = (wid == 'sonar_fc')
        hornL = S * (0.62 if fc else 0.52)
        hornR = S * (0.46 if fc else 0.40)
        draw_tube(d, cx, cy, ang, S * 0.02, S * 0.12, hornL, hornR, scale)
        ho = _R(cx, cy, ang, hornL, 0)
        rr = hornR * 0.62
        d.ellipse([ho[0] - rr, ho[1] - rr, ho[0] + rr, ho[1] + rr],
                  fill=blend(rgb(C_ABYSS), BG_RGB, 0.74))
        d.ellipse([ho[0] - rr, ho[1] - rr, ho[0] + rr, ho[1] + rr],
                  outline=blend(rgb(C_BODY, 1.30), BG_RGB, 0.52), width=SW(hornR * 0.24))
        rz = hornR * 0.24
        d.ellipse([ho[0] - rz, ho[1] - rz, ho[0] + rz, ho[1] + rz], fill=rgb(C_BODY, 0.94))
        if fc:
            d.ellipse([ho[0] - hornR * .86, ho[1] - hornR * .86,
                       ho[0] + hornR * .86, ho[1] + hornR * .86],
                      outline=blend(rgb(C_BODY, 1.30), BG_RGB, 0.42), width=SW(1))
        if wid == 'sonar_rs':
            for da in (-0.9, 0, 0.9):
                p = _R(cx, cy, ang, hornL + S * 0.26, math.sin(da) * S * 0.34)
                d.ellipse([p[0] - S * .085, p[1] - S * .085, p[0] + S * .085, p[1] + S * .085],
                          fill=rgb(C_BODY, 1.10))
                d.ellipse([p[0] - S * .085, p[1] - S * .085, p[0] + S * .085, p[1] + S * .085],
                          outline=blend(rgb(C_ABYSS), BG_RGB, 0.45), width=SW(1))
        if firing:
            r = hornR * 1.35
            d.arc([ho[0] - r, ho[1] - r, ho[0] + r, ho[1] + r],
                  math.degrees(ang - 0.85), math.degrees(ang + 0.85),
                  fill=(255, 255, 255), width=SW(1.8))
    elif fam == 'arc':
        SW = lambda v: max(1, round(v * scale))         # noqa: E731
        # ⚠️ 电极**必须够粗**：第一版 eR=0.075S ⇒ 直径 3px、球头 4px，
        #    实机 1× 下两根柱 + 两个球头全糊成**一条黑竖条**（管身是暗体，
        #    3px 宽时没有受光带可读 ⇒ 只剩"黑"）。
        eR, eL0 = S * 0.125, S * 0.04
        eL1 = S * (0.56 if wid == 'arc_ov' else 0.48)
        eOff = S * 0.34
        TIP_R = 0.48      # 球头收拢比例；0.34 会让两颗球头**叠在一起**（读作一根粗棒）
        nvx, nvy = -math.sin(ang), math.cos(ang)     # 法向（背 -1 / 腹 +1）
        fwx, fwy = math.cos(ang), math.sin(ang)      # 前向
        # ⚠️ 两根电极柱**向前收拢**（尖端靠近）—— 平行朝前读作"两根炮管"。
        tips = []
        for sy in (-1, 1):
            p0 = (cx + nvx * sy * eOff, cy + nvy * sy * eOff)
            p1 = (cx + nvx * sy * eOff * TIP_R + fwx * eL1,
                  cy + nvy * sy * eOff * TIP_R + fwy * eL1)
            d_ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
            draw_tube(d, p0[0], p0[1], d_ang, eL0, eR * 1.20,
                      math.hypot(p1[0] - p0[0], p1[1] - p0[1]), eR * 0.90, scale)
            d.ellipse([p1[0] - eR * 1.5, p1[1] - eR * 1.5, p1[0] + eR * 1.5, p1[1] + eR * 1.5],
                      fill=rgb(C_BODY, 0.86))
            d.arc([p1[0] - eR * 1.5, p1[1] - eR * 1.5, p1[0] + eR * 1.5, p1[1] + eR * 1.5],
                  176, 292, fill=blend(rgb(C_BODY, 1.34), BG_RGB, 0.60), width=SW(eR * 0.7))
            tips.append(p1)
        if wid == 'arc_st':
            for i in range(8):
                a = (i / 8) * math.pi * 2
                p = _R(cx, cy, ang, math.cos(a) * S * 0.66, math.sin(a) * S * 0.66)
                d.line([(cx, cy), p], fill=(255, 255, 255) if firing else col, width=SW(1.4))
        else:
            tz = [0, 0.20, 0.42, 0.68, 1] if wid == 'arc_ov' else [0, 0.34, 0.66, 1]
            vz = [1, -0.15, 1.15, -0.25, -1] if wid == 'arc_ov' else [1, -0.15, 1.15, -1]
            # ⚠️ 必须带**前向抖动**（dz）—— 只改法向偏移的话所有点共线，
            #    折线退化成一条直线，6× 下读成一个实心色块（第一版就是这样）。
            dz = [0, 0.12, -0.08, 0.10, 0] if wid == 'arc_ov' else [0, 0.12, -0.08, 0]
            mx = (tips[0][0] + tips[1][0]) / 2
            my = (tips[0][1] + tips[1][1]) / 2
            z = [(mx + nvx * eOff * TIP_R * v + fwx * S * 0.05 * dd,
                  my + nvy * eOff * TIP_R * v + fwy * S * 0.05 * dd)
                 for v, dd in zip(vz, dz)]
            # ⚠️ 实机上电弧走 `neon()`（**外辉光 + 白核**）。预览不给辉光的话，
            #    6× 下那几段会读成"一个实心黄色块"（第一版就是）——
            #    那是**预览的失真**，不是实机的问题。这里按三层模拟：辉光 / 主弧 / 白核。
            for w, f in ((4.0, blend(col, BG_RGB, 0.30)),
                         (1.8, (255, 255, 255) if firing else blend(col, BG_RGB, 0.95)),
                         (1.0, (255, 255, 255))):
                for i in range(1, len(z)):
                    d.line([z[i - 1], z[i]], fill=f, width=SW(w))
    elif fam == 'harpoon':
        SW = lambda v: max(1, round(v * scale))         # noqa: E731
        # ★★ 三版教训：**只要前端收敛成一个尖，它一定是箭头**（细线+V / 粗杆+三角 /
        #   菱形叶+长倒须 三版全否）。鱼叉本就是**叉** ⇒ 前端**分成多股、向前张开**。
        tri = (wid == 'harp_tr')
        for k in ((-1, 0, 1) if tri else (0,)):
            yy = k * (S * 0.15 if tri else 0)
            bc = (cx - math.sin(ang) * yy, cy + math.cos(ang) * yy)
            draw_tube(d, bc[0], bc[1], ang, -S * 0.42, S * 0.13, S * 0.60, S * 0.10, scale)
        Q = lambda lx, ly: _R(cx, cy, ang, lx, ly)      # noqa: E731
        # 亮箍：叉杆 → 叉头的接头
        fw = S * (0.20 if tri else 0.145)
        draw_tube(d, cx, cy, ang, S * 0.52, fw * 0.80, S * 0.66, fw, scale)
        # 齿：向前张开（★ 与箭头分界）。**基础款也必须是三齿** —— 二齿的外轮廓
        #   在 1× 下就是 `—<`，仍旧读作箭头；中央那根**伸得更长**露出叉口，才破掉这个读法。
        prongs = ([(0, 1.20), (-1, 1.04), (1, 1.04)] if tri
                  else [(0, 1.16), (-1, 0.96), (1, 0.96)])
        spread = 0.34 if tri else 0.28
        for sy, ex in prongs:
            a0, a1 = Q(S * 0.62, sy * S * 0.054), Q(S * ex, sy * S * spread)
            # 齿径 0.078→0.030S 在 1× 下细成"须" ⇒ 提到 0.105→0.050S 才是**有厚度的齿**
            draw_tube(d, a0[0], a0[1], math.atan2(a1[1] - a0[1], a1[0] - a0[0]),
                      0, S * 0.105, math.hypot(a1[0] - a0[0], a1[1] - a0[1]), S * 0.050, scale)
            d.ellipse([a1[0] - S * .060, a1[1] - S * .060, a1[0] + S * .060, a1[1] + S * .060],
                      fill=rgb(C_BODY, 0.96),
                      outline=blend(rgb(C_ABYSS), BG_RGB, 0.46), width=SW(1))
        if wid == 'harp_cb':
            lp = _R(cx, cy, ang, -S * 0.58, 0)
            d.ellipse([lp[0] - S * .22, lp[1] - S * .22, lp[0] + S * .22, lp[1] + S * .22],
                      fill=rgb(C_BODY, 0.70))
            d.ellipse([lp[0] - S * .11, lp[1] - S * .11, lp[0] + S * .11, lp[1] + S * .11],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.66))
            d.ellipse([lp[0] - S * .22, lp[1] - S * .22, lp[0] + S * .22, lp[1] + S * .22],
                      outline=blend(rgb(C_BODY, 1.26), BG_RGB, 0.55), width=SW(1.2))
        if firing:
            mz = _R(cx, cy, ang, S * (1.30 if tri else 1.22), 0)
            d.ellipse([mz[0] - S * .12, mz[1] - S * .12, mz[0] + S * .12, mz[1] + S * .12],
                      fill=(255, 255, 255))
    elif fam == 'echo':
        SW = lambda v: max(1, round(v * scale))         # noqa: E731
        big = (wid == 'echo_fo')
        diskL = S * (0.40 if big else 0.34)
        diskR = S * (0.32 if big else 0.26)
        draw_tube(d, cx, cy, ang, S * 0.02, S * 0.13, diskL, diskR, scale)
        dp = _R(cx, cy, ang, diskL, 0)
        _disk(d, dp[0], dp[1], diskR, 0.94, scale=scale)
        d.ellipse([dp[0] - diskR * .30, dp[1] - diskR * .30,
                   dp[0] + diskR * .30, dp[1] + diskR * .30], fill=rgb(C_BODY, 1.20))
        d.ellipse([dp[0] - diskR * .30, dp[1] - diskR * .30,
                   dp[0] + diskR * .30, dp[1] + diskR * .30],
                  outline=blend(rgb(C_ABYSS), BG_RGB, 0.40), width=SW(1))
        if wid == 'echo_mu':
            for k in (-1, 0, 1):
                p = _R(cx, cy, ang, diskL + S * 0.24, k * S * 0.30)
                d.ellipse([p[0] - S * .10, p[1] - S * .10, p[0] + S * .10, p[1] + S * .10],
                          fill=rgb(C_BODY, 1.06))
                d.ellipse([p[0] - S * .10, p[1] - S * .10, p[0] + S * .10, p[1] + S * .10],
                          outline=blend(rgb(C_ABYSS), BG_RGB, 0.45), width=SW(1))
        elif big:
            p = _R(cx, cy, ang, diskL + S * 0.30, 0)
            d.ellipse([p[0] - S * .30, p[1] - S * .30, p[0] + S * .30, p[1] + S * .30],
                      outline=blend(rgb(C_BODY, 1.24), BG_RGB, 0.55), width=SW(1.8))
        if firing:
            d.ellipse([dp[0] - diskR * .52, dp[1] - diskR * .52,
                       dp[0] + diskR * .52, dp[1] + diskR * .52], fill=(255, 255, 255))
    else:   # acid
        SW = lambda v: max(1, round(v * scale))         # noqa: E731
        big = (wid == 'acid_fd')
        nz0 = S * (0.40 if big else 0.34)
        nz1 = S * 0.11
        nzL = S * (0.56 if big else 0.64)
        draw_tube(d, cx, cy, ang, -S * 0.16, nz0, nzL, nz1, scale, bore=True, bore_r=0.52)
        mz = _R(cx, cy, ang, nzL, 0)
        if wid == 'acid_ra':
            for k in (-1, 0, 1):
                p = _R(cx, cy, ang, nzL + S * 0.28, k * S * 0.28)
                d.ellipse([p[0] - S * .09, p[1] - S * .09, p[0] + S * .09, p[1] + S * .09],
                          fill=(255, 255, 255) if firing else col)
        elif big:
            p = _R(cx, cy, ang, -S * 0.30, 0)
            d.ellipse([p[0] - S * .24, p[1] - S * .24, p[0] + S * .24, p[1] + S * .24],
                      outline=blend(rgb(C_BODY, 1.22), BG_RGB, 0.55), width=SW(1.4))
        if firing:
            d.ellipse([mz[0] - nz1 * 1.1, mz[1] - nz1 * 1.1,
                       mz[0] + nz1 * 1.1, mz[1] + nz1 * 1.1], fill=(255, 255, 255))


def draw_emitter_old(d, fam, cx, cy, ang, S, col, scale=6.0, wid=None):
    """V6.29–V6.78 的**旧**族特征（❌ 已从实机删除，**只作对照图用**）。

    ⛔ 不要在任何"代表实机"的模式（`--bitmap` / `--combat` / `--unlock` / `--mount` /
       `--turret`）里调用它 —— 它是用来给用户看"改前长什么样"的，不是当前画面。
    逐值翻译自 V6.78 的 `DiveGame.drawEmitter`（那一版的 sonar/arc/harpoon/echo/acid
    五个分支）。共同点：**全部是线 + 实心圆**，没有一处体积线索 —— 这正是用户说的
    「自己画的箭头这些」。
    """
    PX = lambda v: max(1, round(v * scale / 6.0))       # noqa: E731  # 实机 px → 本图 px
    P = lambda lx, ly: _R(cx, cy, ang, lx, ly)          # noqa: E731
    if fam == 'sonar':
        fc = (wid == 'sonar_fc')
        for i in range(1, (2 if fc else 3) + 1):
            r = S * (0.2 if fc else 0.26) * i
            d.arc([cx - r, cy - r, cx + r, cy + r],
                  math.degrees(ang - (0.62 if fc else 1.0)),
                  math.degrees(ang + (0.62 if fc else 1.0)),
                  fill=blend(col, BG_RGB, 1.0 if i == 1 else 0.7),
                  width=PX(2.6 if fc else 1.8))
        r = S * 0.12
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=blend(col, BG_RGB, 0.9))
    elif fam == 'arc':
        for sy in (-1, 1):
            d.line([P(-S * 0.2, sy * S * 0.36), P(S * 0.5, sy * S * 0.36)],
                   fill=blend(col, BG_RGB, 0.95), width=PX(2))
        if wid == 'arc_st':
            for i in range(8):
                a = (i / 8) * math.pi * 2
                d.line([(cx, cy), P(math.cos(a) * S * 0.66, math.sin(a) * S * 0.66)],
                       fill=blend(col, BG_RGB, 0.85), width=PX(1.4))
        else:
            zz = ([(S * 0.5, -S * 0.36), (S * 0.2, -S * 0.16), (S * 0.62, -S * 0.02),
                   (S * 0.28, S * 0.14), (S * 0.62, S * 0.36)] if wid == 'arc_ov' else
                  [(S * 0.5, -S * 0.36), (S * 0.26, -S * 0.06),
                   (S * 0.62, S * 0.06), (S * 0.38, S * 0.36)])
            pts = [P(a, b) for a, b in zz]
            for i in range(1, len(pts)):
                d.line([pts[i - 1], pts[i]], fill=blend(col, BG_RGB, 0.95), width=PX(1.6))
    elif fam == 'harpoon':
        for k in ((-1, 0, 1) if wid == 'harp_tr' else (0,)):
            yy = k * S * 0.28
            d.line([P(-S * 0.42, yy), P(S * 0.86, yy)],
                   fill=blend(col, BG_RGB, 1.0 if k == 0 else 0.7), width=PX(2.2))
            t0, t1, t2 = P(S * 0.86, yy), P(S * 0.64, yy - S * 0.16), P(S * 0.64, yy + S * 0.16)
            d.line([t0, t1], fill=blend(col, BG_RGB, 0.95), width=PX(1.6))
            d.line([t0, t2], fill=blend(col, BG_RGB, 0.95), width=PX(1.6))
        if wid == 'harp_cb':
            lp = P(-S * 0.62, 0)
            d.ellipse([lp[0] - S * .22, lp[1] - S * .22, lp[0] + S * .22, lp[1] + S * .22],
                      outline=blend(col, BG_RGB, 0.9), width=PX(1.6))
    elif fam == 'echo':
        bp = P(S * 0.18, 0)
        r = S * (0.3 if wid == 'echo_fo' else 0.22)
        d.ellipse([bp[0] - r, bp[1] - r, bp[0] + r, bp[1] + r], fill=blend(col, BG_RGB, 0.85))
        if wid == 'echo_mu':
            for k in (-1, 0, 1):
                p = P(S * 0.55, k * S * 0.34)
                d.ellipse([p[0] - S * .13, p[1] - S * .13, p[0] + S * .13, p[1] + S * .13],
                          fill=blend(col, BG_RGB, 0.95))
        elif wid == 'echo_fo':
            p = P(S * 0.62, 0)
            d.ellipse([p[0] - S * .22, p[1] - S * .22, p[0] + S * .22, p[1] + S * .22],
                      fill=blend(col, BG_RGB, 0.95))
            d.ellipse([p[0] - S * .36, p[1] - S * .36, p[0] + S * .36, p[1] + S * .36],
                      outline=blend(col, BG_RGB, 0.8), width=PX(1.6))
        else:
            p = P(S * 0.55, 0)
            d.ellipse([p[0] - S * .15, p[1] - S * .15, p[0] + S * .15, p[1] + S * .15],
                      fill=blend(col, BG_RGB, 0.9))
            d.ellipse([p[0] - S * .26, p[1] - S * .26, p[0] + S * .26, p[1] + S * .26],
                      outline=blend(col, BG_RGB, 0.6), width=PX(1.2))
    else:   # acid
        n0, n1, n2 = P(-S * 0.4, -S * 0.34), P(-S * 0.4, S * 0.34), P(S * 0.7, 0)
        d.polygon([n0, n1, n2], fill=blend(col, BG_RGB, 0.28))
        d.polygon([n0, n1, n2], outline=blend(col, BG_RGB, 0.95), width=PX(1.6))
        if wid == 'acid_ra':
            for k in (-1, 0, 1):
                p = P(S * 0.95, k * S * 0.3)
                d.ellipse([p[0] - S * .1, p[1] - S * .1, p[0] + S * .1, p[1] + S * .1],
                          fill=blend(col, BG_RGB, 0.95))
        else:
            if wid == 'acid_fd':
                p = P(-S * 0.5, 0)
                d.ellipse([p[0] - S * .24, p[1] - S * .24, p[0] + S * .24, p[1] + S * .24],
                          outline=blend(col, BG_RGB, 0.8), width=PX(1.4))
            mz = P(S * 0.7, 0)
            r = S * (0.12 if wid == 'acid_fd' else 0.14)
            d.ellipse([mz[0] - r, mz[1] - r, mz[0] + r, mz[1] + r], fill=blend(col, BG_RGB, 0.9))


def main():
    global SHADOW
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    # `--shadow=none|hard|soft`：覆盖投影画法（默认跟随模块级 `SHADOW` = 实机行为）。
    for a in sys.argv[1:]:
        if a.startswith('--shadow='):
            SHADOW = a.split('=', 1)[1]
            assert SHADOW in ('none', 'hard', 'soft'), '未知 --shadow 值: ' + SHADOW
    os.makedirs(OUT_DIR, exist_ok=True)

    if mode == '--shadowab':
        # V6.77c 三方案对照：① 硬边副本（V6.75~b 实机）② 删除（V6.77c 采纳）③ 软阴影（提案）。
        # 并**打印每列的暗带实测值** —— 判据是数，不是"看着差不多"。
        ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        W, H = 1304, 749
        cx, cy = W / 2, H / 2
        try:
            # ⚠️ 用 **L1 原亮度**（p50≈117），不是 `--combat` 的 L2×0.55：
            #    用户那张截图的艇周水体 luma≈148（浅海）—— 投影的可见度**完全由背景亮度决定**
            #    （L2×0.55 下 硬边/删除 只差 7 luma，看不出问题，等于白出图）。
            bg0 = Image.open(os.path.join(ROOT, 'web', 'src', 'assets', 'env', 'L1.webp'))
            bg0 = bg0.convert('RGB').resize((W, H), Image.LANCZOS)
        except Exception:
            bg0 = Image.new('RGB', (W, H), rgb(C_BG))
        LW = (0.2126, 0.7152, 0.0722)

        def band_luma(im):
            # 取"腹下暗带"实测：躯干下沿外 3px 处、机腹正中那一段
            px = im.load()
            vals = []
            for x in range(int(cx - 30), int(cx + 30), 4):
                y = int(cy + HULL_H / 2 + 3)
                p = px[x, y]
                vals.append(LW[0] * p[0] + LW[1] * p[1] + LW[2] * p[2])
            return sum(vals) / len(vals)

        cols = [('1  BEFORE  hard sprite copy  (live until V6.77b)', 'hard', (255, 150, 140)),
                ('2  AFTER   removed  (V6.77c, adopted)', 'none', (150, 245, 175)),
                ('3  ALT     soft blur  (proposal, NOT implemented)', 'soft', (255, 215, 120))]
        sc = 3
        zoom = 5
        cw, ch = 200 * sc, 142 * sc
        zw, zh = 112 * zoom, 74 * zoom
        GAP, HEAD = 16, 100
        img = Image.new('RGB', (cw * 3 + GAP * 4, HEAD + ch + zh + 62), (8, 16, 22))
        D = ImageDraw.Draw(img)
        try:
            F_T = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 21)
            F_M = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
            F_S = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 15)
        except Exception:
            F_T = F_M = F_S = ImageFont.load_default()
        D.text((GAP, 10), 'SUB SHADOW  (the black the user boxed)   L1 shallow water, real in-game 1x',
               fill=(120, 225, 245), font=F_T)
        D.text((GAP + 4, 38),
               'luma 8px under the belly:  water = %.0f   |   left-to-right = old / removed / soft-proposal'
               % band_luma(bg0), fill=(255, 220, 120), font=F_M)
        D.text((GAP + 4, 58), 'user screenshot measured:  hard band luma ~59  vs  water 148   (2.5x)',
               fill=(150, 182, 198), font=F_S)

        for c, (lab, modev, colr) in enumerate(cols):
            bg = bg0.copy()
            paste_hull(bg, cx, cy, 1.0, shadow=modev)
            d = ImageDraw.Draw(bg)
            seat_ang = [math.degrees(math.atan2(SEAT_MOUNTS[i][1] * (HULL_H / 2),
                                                SEAT_MOUNTS[i][0] * (SUB_D / 2)))
                        for i in range(len(SEAT_MOUNTS))]
            for i in range(len(SEAT_MOUNTS)):
                draw_turret(d, cx + SEAT_MOUNTS[i][0] * (SUB_D / 2),
                            cy + SEAT_MOUNTS[i][1] * (HULL_H / 2),
                            seat_ang[i], 1.0, ext=(i >= 4),
                            sgn=(-1 if SEAT_MOUNTS[i][1] < 0 else 1))
            x = GAP + c * (cw + GAP)
            D.text((x + 2, HEAD - 18), lab, fill=colr, font=F_S)
            c1 = bg.crop((int(cx - 100), int(cy - 71), int(cx + 100), int(cy + 71)))
            img.paste(c1.resize((cw, ch), Image.NEAREST), (x, HEAD))
            c2 = bg.crop((int(cx - 6), int(cy - 6), int(cx + 106), int(cy + 68)))
            img.paste(c2.resize((zw, zh), Image.NEAREST), (x, HEAD + ch + 22))
            D.text((x + 2, HEAD + ch + 4), 'top: whole sub   bottom: %dx  belly/starboard' % zoom,
                   fill=(140, 175, 190), font=F_S)
            print('  %-52s 腹下暗带 luma = %5.1f' % (lab[:52], band_luma(bg)))

        p = os.path.join(OUT_DIR, 'sub_shadow_ab.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode in ('--combat', '--combatmix'):
        # V6.75 **实机合成图** —— 真实背景 + 位图机体 + 6 门炮 + 探照灯。
        # 这是唯一能回答"用户在屏幕上到底看到什么"的图：
        # 判据 ① 88px 宽的艇在真实背景上认不认得出是潜艇
        #      ② 6 门炮有没有"装在艇上"（圆心贴轮廓）
        #      ③ 机体与深海背景的对比度够不够（位图是暗青金属，最容易糊在暗水里）
        # V6.79：`--combatmix` = **6 个炮位装 6 族不同武器** —— 直接回答用户那句
        #   「不都要改吗」：混装时是否还能一眼看出"每门都是装在座上的零件"。
        ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        W, H = 1304, 749
        try:
            bg = Image.open(os.path.join(ROOT, 'web', 'src', 'assets', 'env', 'L2.webp')).convert('RGB')
            bg = bg.resize((W, H), Image.LANCZOS).point(lambda v: int(v * 0.55))
        except Exception:
            bg = Image.new('RGB', (W, H), rgb(C_BG))
        cx, cy = W / 2, H / 2
        if not paste_hull(bg, cx, cy, 1.0):
            print('⚠️ 位图机体缺失，先跑 tools/prep_sub_art.py')
            return
        d = ImageDraw.Draw(bg)
        seat_ang = [math.degrees(math.atan2(SEAT_MOUNTS[i][1] * (HULL_H / 2),
                                            SEAT_MOUNTS[i][0] * (SUB_D / 2)))
                    for i in range(len(SEAT_MOUNTS))]
        # 混装表（6 座，按座号）—— 覆盖 7 族里的 6 族，剩一族见 --emit7
        MIX = [('sonar', 'sonar'), ('acid', 'acid'), ('echo', 'echo'),
               ('arc', 'arc'), ('harpoon', 'harpoon'), ('torpedo', 'torp_cl')]
        # 艏部探照灯（白点 + 光锥）**已删除**（V6.77b）：用户 2026-10-15「扫描仪不要
        # 白点 和三角形 全去掉」。⛔ 别再把这一段加回来 —— 它贴在 HULL_OUTLINE 之外，
        # 正是"读作画上去的"那一类（铁规 12）。朝向由位图自身的 faceX 镜像承担。
        for i in range(len(SEAT_MOUNTS)):
            fam, wid = MIX[i] if mode == '--combatmix' else ('gun', None)
            draw_turret(d, cx + SEAT_MOUNTS[i][0] * (SUB_D / 2),
                        cy + SEAT_MOUNTS[i][1] * (HULL_H / 2),
                        seat_ang[i], 1.0, ext=(i >= 4), fam=fam, wid=wid,
                        sgn=(-1 if SEAT_MOUNTS[i][1] < 0 else 1))
        tag = 'mix' if mode == '--combatmix' else ''
        path = os.path.join(OUT_DIR, f'hull_combat{tag}.png')
        bg.save(path)
        print('已出图:', path)
        # 局部 3× 放大（以机体为中心，看"炮有没有装在艇上"）
        bx0, by0 = int(cx - 160), int(cy - 110)
        crop = bg.crop((bx0, by0, bx0 + 320, by0 + 220))
        crop = crop.resize((320 * 3, 220 * 3), Image.NEAREST)
        p2 = os.path.join(OUT_DIR, f'hull_combat{tag}_zoom.png')
        crop.save(p2)
        print('已出图:', p2)
        return

    if mode in ('--bitmap', '--hull'):
        # V6.75 **位图机体验收图** —— 机体位图化之后，**这是唯一代表实机画面的**机体预览。
        # 三档同框，每档判一件事：
        #   1x → 实机验收尺度（88px 宽的艇上还读不读得出结构）
        #   2x → 细节/接口（导轨与挂点有没有对上）
        #   4x → 结构 + **两条校验线**：红 = `HULL_OUTLINE`（位图剪影必须与它重合，
        #        否则说明躯干没对齐）、黄 = `SEAT_MOUNTS` 的 6 个挂点（圆心必须落在艇身上）
        if not paste_hull(Image.new('RGB', (8, 8)), 4, 4):
            print(f'⚠️ 没找到位图机体 {SUB_HULL_ART}\n'
                  '   先跑：python tools/prep_sub_art.py <出图.png> --out docs/shots/sub_art/sub_D\n'
                  '   再复制到 web/src/assets/sub/sub_hull.png 并跑 tools/sync_art.py')
            return
        cells = [(1.0, '1x  in-game scale (final check)'),
                 (2.0, '2x  rails / mounts'),
                 (4.0, '4x  structure  red=HULL_OUTLINE  amber=SEAT_MOUNTS')]
        cell = 420
        img, d = canvas(cell * len(cells), cell + 34)
        for k, (sc, lbl) in enumerate(cells):
            cx, cy = k * cell + cell / 2, cell / 2
            paste_hull(img, cx, cy, sc)
            if sc >= 4:
                pts = [(cx + u * (SUB_D / 2) * sc, cy + v * (HULL_H / 2) * sc)
                       for u, v in HULL_OUTLINE]
                d.line(pts + [pts[0]], fill=rgb(0xff5a5a), width=2)
            for i, (mu, mv) in enumerate(SEAT_MOUNTS):
                x = cx + mu * (SUB_D / 2) * sc
                y = cy + mv * (HULL_H / 2) * sc
                r = MOUNT_BASE_R * 0.5 * sc
                d.ellipse([x - r, y - r, x + r, y + r], outline=rgb(C_AMBER), width=2)
                if sc >= 2:
                    txt(d, (x + r + 2, y - 7), str(i), rgb(C_AMBER), 13)
            txt(d, (k * cell + 8, cell + 10), lbl, rgb(C_CYAN_DIM), 13)
        p = os.path.join(OUT_DIR, 'hull_bitmap.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--sheet':
        rows = [
            ('1 仅主体（无体积线索）', {'body'}),
            ('2 +侧壁（厚度）', {'body', 'side'}),
            ('3 +上缘受光（光源）', {'body', 'side', 'lit'}),
            ('4 +投影+下腹暗带', {'body', 'side', 'lit', 'belly', 'shadow'}),
            ('5 +指挥塔/尾舵（破剪影）', {'body', 'side', 'lit', 'belly', 'shadow', 'tower', 'fins'}),
            ('6 +背脊带/舷窗/推进器/霓虹', {'shadow', 'side', 'body', 'lit', 'belly',
                                          'spine', 'tower', 'fins', 'windows', 'prop', 'neon'}),
            ('7 +结构层（V6.57 质感）', None),
        ]
        cell, cols = 320, 3
        rowsn = (len(rows) + cols - 1) // cols
        img, d = canvas(cell * cols, rowsn * (cell + 30))
        for i, (name, layers) in enumerate(rows):
            gx, gy = (i % cols) * cell, (i // cols) * (cell + 30)
            draw_hull(d, gx + cell / 2, gy + cell / 2, scale=2.6, m=1, layers=layers)
            txt(d, (gx + 8, gy + cell + 8), name, fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_layers.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--tex':
        # V6.57 质感对照：两组只差「结构层」这一个变量（板缝/铆钉/窗框/格栅）
        base = {'shadow', 'side', 'body', 'lit', 'belly', 'spine', 'tower',
                'fins', 'windows', 'prop', 'neon'}
        cell = 360
        img, d = canvas(cell * 2, cell + 32)
        draw_hull(d, cell / 2, cell / 2, scale=2.9, m=1, layers=base)
        draw_hull(d, cell * 1.5, cell / 2, scale=2.9, m=1, layers=base | {'detail'})
        txt(d, (10, cell + 10), 'V6.54 定稿（无结构层）', fill=rgb(C_CYAN_DIM))
        txt(d, (cell + 10, cell + 10), 'V6.57 +结构层', fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_tex.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--slots':
        # V6.76 **发射槽**验收图 —— 本轮唯一要判的东西：
        #   「开孔在**机体位图**上（不是画上去的）、发射器**插在孔里**、只露发射头」。
        # 四格（前三格 3.2× 看结构，最后一格 1.6× 看实机尺度）：
        #   ① 全空        → 六个孔必须**都在图上**（暗腔 + 亮翻边 + 相邻艇缘提亮）
        #   ② 4装/1空/1封 → 三种状态同框，判"装上去"与"空座"的差别
        #   ③ 全装        → 六根柱脚各插进自己的槽，槽在柱脚左右各露一条暗边
        #   ④ 1.6× 全装   → 实机尺度：还读不读得出"插在艇上的孔里"
        SEAT_ANG = [math.degrees(math.atan2(SEAT_MOUNTS[i][1] * (HULL_H / 2),
                                            SEAT_MOUNTS[i][0] * (SUB_D / 2)))
                    for i in range(len(SEAT_MOUNTS))]

        def _panel(img, d, cx, cy, sc, installed, maxw):
            if not paste_hull(img, cx, cy, sc):
                return False
            for i in range(installed):
                draw_turret(d, cx + SEAT_MOUNTS[i][0] * (SUB_D / 2) * sc,
                            cy + SEAT_MOUNTS[i][1] * (HULL_H / 2) * sc,
                            SEAT_ANG[i], sc, ext=(i >= 4),
                            sgn=(-1 if SEAT_MOUNTS[i][1] < 0 else 1))
            draw_sockets(d, cx, cy, installed, maxw, scale=sc, m=1)
            return True

        cell = 400
        img, d = canvas(cell * 2, (cell + 30) * 2)
        panels = [(0, 0, 3.2, 0, 6, '3.2x  all empty  -> 6 openings are IN the bitmap'),
                  (1, 0, 3.2, 4, 5, '3.2x  4 mounted / 1 open / 1 sealed'),
                  (0, 1, 3.2, 6, 6, '3.2x  all 6 mounted  -> plug sits IN the slot'),
                  (1, 1, 1.6, 6, 6, '1.6x  in-game scale')]
        for gx, gy, sc, inst, maxw, lbl in panels:
            cx = gx * cell + cell / 2
            cy = gy * (cell + 30) + cell / 2
            if not _panel(img, d, cx, cy, sc, inst, maxw):
                print('⚠️ 位图机体缺失，先跑 tools/prep_sub_art.py')
                return
            txt(d, (gx * cell + 8, gy * (cell + 30) + cell + 8), lbl, rgb(C_CYAN_DIM), 13)
        p = os.path.join(OUT_DIR, 'seat_slots.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--emit':
        # V6.77 **发射器画法对比** —— 用户 2026-10-15（在看完 A/B 图之后）：
        #   「A吧 黄色的描绘能改下吗 不改的话 像是画上去的
        #     能直接对齐我带的发射器吗 绑定发射口」
        #
        # 当时拆成两件事，最终**只做第 ①**：
        #   ① **去黄**（采纳）：管身那条**闭合的琥珀亮边**是"UI 框"的语汇（铁规 14）⇒
        #      改成暗缝 + 金属受光；连**炮口那 172° 的半圆环**也一并去掉
        #      （半闭合的亮弧与闭合亮边是同一条判据）。
        #   ② ~~绑口~~（**未采纳**）：`ro` 6.3 → 0.8 让炮口视觉位置对上 `MUZ`。
        #      这个方案在下面 `MUZ` 注释里留了完整推导 —— **不是错，是这轮没选**，
        #      将来要"子弹从炮口正前方出来"时直接照它做（`ro` + `tail` 是一对）。
        #
        # ★ 用户 2026-10-15 最终拍板：「选择A2  同时炮口的黄色半圆也去掉」
        #   ⇒ 采纳 = **A2 + 无炮口环**（下面第三列）。
        # 三列（都基于用户已定的 **A 版：只改渲染层**）：
        #   ① `now`  现状锚点（白圈 + 琥珀描边 + 炮口琥珀半圆环）
        #   ② `A2`   去白圈 + 去黄（**口环还在**）—— 留作对照，指出"黄"到底在哪一处
        #   ③ `A2r`  同 A2 + **炮口黄环也去掉** ← 采纳版
        if not paste_hull(Image.new('RGB', (8, 8)), 4, 4):
            print('⚠️ 位图机体缺失，先跑 tools/prep_sub_art.py')
            return
        SEAT_ANG = [math.degrees(math.atan2(SEAT_MOUNTS[i][1] * (HULL_H / 2),
                                            SEAT_MOUNTS[i][0] * (SUB_D / 2)))
                    for i in range(len(SEAT_MOUNTS))]
        # (标题, 副标题, kwargs)
        # ⚠️ `MUZ`（真出弹点）= `MOUNT_BASE_R × 0.85` = **12.75px**（`world.ts`）。
        #    视觉炮口到座心的距离 = `ro + 0.68×EMITTER_SIZE` = `ro + 12.24`。
        #    ⇒ 现状 6.3 时是 **18.54**，比出弹点远 5.8px —— 子弹其实从**炮管中段**冒出来。
        #    这就是"绑定发射口"的能量化定义：让 `ro + 12.24 ≈ 12.75` ⇒ **`ro ≈ 0.5`**，
        #    而 `SLOT_EDGE_OFF = 0.8` ⇒ 两者本来就该是同一个数（"转座坐在发射口上"）。
        MUZ = 12.75
        COLS = [
            ('now', 'now   现状（锚点）',
             '转座整圈亮线（白圈）+ 管子整圈琥珀亮边 + 炮口琥珀半圆环',
             dict(base='now', plain=False, no_ring=False)),
            ('A2', 'A2   去白圈 + 去黄（口环还在）',
             '管身 = 暗缝 + 金属受光带；黄只剩炮口那圈半圆',
             dict(base='A', plain=True, no_ring=False)),
            ('A2r', 'A2   炮口黄环也去掉   <== 采纳',
             '口环整条不画；内孔内圈改金属色 => 枪族身上没有一处黄',
             dict(base='A', plain=True, no_ring=True)),
        ]
        FOOT = ('判据：闭合或半闭合的亮色轮廓 = "UI 框"的语汇（铁规 14）—— 管身那条闭合亮边、'
                '炮口那 172 度半圆环，读出来都是"描上去的一圈线"，不是"金属在光里的边"。',
                '采纳版（第三列）：管身轮廓走暗缝、炮口只留暗孔（内孔内圈改金属色）'
                '=> 枪族身上没有一处黄色；武器身份改由"形状"回答（双管 + 机匣 + 转座）。',
                '安位不动（ro 保持 RR x 0.90 = 6.3）：本轮只改"怎么画"，不动挂点、不动弹道、不动剪影。')

        def _rig(timg, td, hx, hy, sc, i, kw):
            if not paste_hull(timg, hx, hy, sc):
                return False
            for k in range(len(SEAT_MOUNTS)):
                draw_turret(td, hx + SEAT_MOUNTS[k][0] * (SUB_D / 2) * sc,
                            hy + SEAT_MOUNTS[k][1] * (HULL_H / 2) * sc,
                            SEAT_ANG[k], sc, ext=(k >= 4), sgn=(-1 if SEAT_MOUNTS[k][1] < 0 else 1),
                            **kw)
            return True

        CW, CH, HDR = 430, 400, 46
        img, d = canvas(CW * 3, HDR + (CH + 30) * 2 + 76)
        for ci, (tag, title, sub, kw) in enumerate(COLS):
            txt(d, (ci * CW + 12, 6), title, rgb(C_CYAN), 15)
            txt(d, (ci * CW + 12, 26), sub, rgb(C_CYAN_DIM), 12)
            for ri, (sc, zoom) in enumerate(((5.0, True), (1.6, False))):
                gx, gy = ci * CW, HDR + ri * (CH + 30)
                tmp = Image.new('RGB', (CW, CH), rgb(C_BG))
                td = ImageDraw.Draw(tmp)
                if zoom:
                    mu, mv = SEAT_MOUNTS[2]          # 背脊中：正对炮座，能看全柱脚
                    hx = CW / 2 - mu * (SUB_D / 2) * sc
                    hy = CH * 0.62 - mv * (HULL_H / 2) * sc
                else:
                    hx, hy = CW / 2, CH / 2
                if not _rig(tmp, td, hx, hy, sc, ci, kw):
                    print('⚠️ 位图机体缺失，先跑 tools/prep_sub_art.py')
                    return
                img.paste(tmp, (gx, gy))
                txt(d, (gx + 12, gy + CH + 8),
                    ('5.5x  ' if zoom else '1.6x  ') + ('structure' if zoom else 'in-game scale'),
                    rgb(C_CYAN_DIM), 12)
        fy = HDR + (CH + 30) * 2 + 8
        for k, line in enumerate(FOOT):
            txt(d, (14, fy + k * 20), line, rgb(C_CYAN_DIM), 12)
        p = os.path.join(OUT_DIR, 'emit_ab.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--base':
        # V6.77 **基座 A/B 对比图** —— 用户 2026-10-15：
        #   「还是有一层白圈呢」「能不能做成机体本身提供基座 发射物装在上面 可以 360 度旋转」
        #
        # 六格 = 2 行 × 3 列，列 = 三种做法，行 = 两个尺度：
        #   上排 6×  → 结构（基座到底长什么样、"白圈"还在不在）
        #   下排 1.6× → 实机尺度（88px 宽的艇上还读不读得出来）
        # 三列：
        #   ① `now` = V6.76 现状：转座描一圈**近白整圆** ← 用户说的那一层白圈
        #   ② `A`   = **只改渲染层**：基座 = 槽内金属衬环；转座 = 暗体 + 单侧受光弧
        #   ③ `B`   = **烘进位图**：机体图上长一圈矮凸台（剪影抬高 `PED_H`）
        # ⚠️ 这一张图就是拿来拍板的 ⇒ 取舍必须写在图里（列标题的副标题行），不能只写在代码里。
        if not paste_hull(Image.new('RGB', (8, 8)), 4, 4):
            print('⚠️ 位图机体缺失，先跑 tools/prep_sub_art.py')
            return
        SEAT_ANG = [math.degrees(math.atan2(SEAT_MOUNTS[i][1] * (HULL_H / 2),
                                            SEAT_MOUNTS[i][0] * (SUB_D / 2)))
                    for i in range(len(SEAT_MOUNTS))]
        COLS = [('now', 'now   V6.76 现状',
                 '转座描一圈近白整圆 = 你说的白圈；耳轴是两颗浮点'),
                ('A', 'A  只改渲染层',
                 '白圈 → 暗金属 + 单侧受光弧；基座 = 图上那个槽（已烘）+ 柱脚'),
                ('B', 'B  烘进位图',
                 '机体图上长一圈矮凸台，转座坐在凸台顶面（最像"机体自带"）')]
        # ⚠️ 图内文字**不要带 Markdown 标记**（`**` 会原样印出来 —— 上一轮踩过）。
        FOOT = ('两版共同点：都删掉那圈近白闭合圆（闭合亮边 = "UI 框"的语汇，铁规 14）。',
                f'差别只在"基座要不要凸出艇面"：A 剪影 / 挂点 / 弹道零改动；'
                f'B 要付两笔 —— HULL_OUTLINE 得跟着抬 + 炮口高度 +{PED_H:g}px 必须核 MUZ。')

        def _draw_rig(timg, td, hx, hy, sc, base):
            if not paste_hull(timg, hx, hy, sc):
                return False
            # ⚠️ 顺序：**先所有凸台，再所有炮**。逐个座位"凸台+炮"混着画的话，
            #    相邻座位的凸台会盖到已经画好的炮身上（放大后离得近，一盖就看得出来）。
            if base == 'B':
                for i in range(len(SEAT_MOUNTS)):
                    draw_pedestal(td, hx + SEAT_MOUNTS[i][0] * (SUB_D / 2) * sc,
                                  hy + SEAT_MOUNTS[i][1] * (HULL_H / 2) * sc, sc,
                                  -1 if SEAT_MOUNTS[i][1] < 0 else 1)
            for i in range(len(SEAT_MOUNTS)):
                # ⚠️ 显式冻结"改前"样式（`plain=False, no_ring=False`）：`--base` 是**decision
                #    document**（2026-10-15 拍板 A/B 那一轮），列内容必须永远与当时一致 ——
                #    `draw_turret` 的默认值后来改成采纳版（暗缝 + 无口环），不显式传就会
                #    "历史图自己变了"。
                draw_turret(td, hx + SEAT_MOUNTS[i][0] * (SUB_D / 2) * sc,
                            hy + SEAT_MOUNTS[i][1] * (HULL_H / 2) * sc,
                            SEAT_ANG[i], sc, ext=(i >= 4), base=base,
                            plain=False, no_ring=False,
                            sgn=(-1 if SEAT_MOUNTS[i][1] < 0 else 1))
            return True

        CW, CH, HDR = 430, 350, 46
        img, d = canvas(CW * 3, HDR + (CH + 30) * 2 + 52)
        for ci, (base, title, sub) in enumerate(COLS):
            txt(d, (ci * CW + 12, 6), title, rgb(C_CYAN), 15)
            txt(d, (ci * CW + 12, 26), sub, rgb(C_CYAN_DIM), 12)
            for ri, (sc, zoom) in enumerate(((5.0, True), (1.6, False))):
                gx, gy = ci * CW, HDR + ri * (CH + 30)
                # ⚠️ 每格**独立画布**再贴回来：放大档里艇（88px × 5 = 440px）比格子还宽，
                #    直接画在总图上会**溢出到邻格**（一眼就看得出是"三张图糊在一起"）。
                tmp = Image.new('RGB', (CW, CH), rgb(C_BG))
                td = ImageDraw.Draw(tmp)
                if zoom:
                    # 放大档：让 **2 号座（背脊中）** 落在格子上方 40% 处，
                    # 下半留出艇身 ⇒ 能同时看到"座"和"它坐在什么上"
                    mu, mv = SEAT_MOUNTS[2]
                    hx = CW / 2 - mu * (SUB_D / 2) * sc
                    hy = CH * 0.40 - mv * (HULL_H / 2) * sc
                else:
                    hx, hy = CW / 2, CH / 2
                if not _draw_rig(tmp, td, hx, hy, sc, base):
                    print('⚠️ 位图机体缺失，先跑 tools/prep_sub_art.py')
                    return
                img.paste(tmp, (gx, gy))
                txt(d, (gx + 12, gy + CH + 8),
                    ('5x  ' if zoom else '1.6x  ') + ('structure' if zoom else 'in-game scale'),
                    rgb(C_CYAN_DIM), 12)
        # 脚注（★ 这张图就是拿来拍板的 ⇒ 取舍必须落在图上，不能只写在代码里）
        fy = HDR + (CH + 30) * 2 + 8
        for k, line in enumerate(FOOT):
            txt(d, (14, fy + k * 20), line, rgb(C_CYAN_DIM), 12)
        p = os.path.join(OUT_DIR, 'base_ab.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--unlock':
        # V6.74 「最大 6 个发射孔、慢慢解锁」验收图。
        # 三态**同框**（装 4 座 / 解锁到 5 座 ⇒ ⑤ = 敞开插座、⑥ = 焊死封板）：
        #   左 1.6× / 右 3.2×，两个尺度各判一件事 ——
        #     1.6× 判"实机上读不读得出"（最终验收尺度），3.2× 判结构对不对。
        # ⚠️ 这张图存在的理由：机体上"还差几个孔"是养成线**唯一**的可见回报。
        #    若机体只有 4 个孔，玩家解锁第 5 座时**屏幕毫无变化**，这笔投入等于白花。
        cell = 360
        img, d = canvas(cell * 2, cell + 34)
        SEAT_ANG = [math.degrees(math.atan2(SEAT_MOUNTS[i][1] * (HULL_H / 2),
                                            SEAT_MOUNTS[i][0] * (SUB_D / 2)))
                    for i in range(len(SEAT_MOUNTS))]
        for k, sc in enumerate((1.6, 3.2)):
            cx, cy = k * cell + cell / 2, cell / 2
            # V6.75：机体改成**位图**（与实机一致）；位图不在磁盘上时才退回矢量几何参考。
            if not paste_hull(img, cx, cy, sc):
                draw_hull(d, cx, cy, scale=sc, m=1,
                          layers={'shadow', 'side', 'body', 'lit', 'belly', 'detail', 'spine',
                                  'tower', 'fins', 'windows', 'prop', 'neon'})
            # 已装的 4 座：走完整的四级安装台阶
            for i in range(4):
                draw_turret(d, cx + SEAT_MOUNTS[i][0] * (SUB_D / 2) * sc,
                            cy + SEAT_MOUNTS[i][1] * (HULL_H / 2) * sc,
                            SEAT_ANG[i], sc, ext=False,
                            sgn=(-1 if SEAT_MOUNTS[i][1] < 0 else 1))
            # ⑤ 敞开插座 / ⑥ 焊死封板
            draw_sockets(d, cx, cy, installed=4, maxw=5, scale=sc, m=1)
            txt(d, (k * cell + 8, cell + 8),
                f'{sc:g}x   installed 4 | unlocked 5 | max 6',
                fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'seat_unlock.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--mount':
        # V6.71「炮孔装上去的发射器要有具体感」验收图（V6.76 已更新到插槽式结构）：
        # **背脊座 / 腹部座 × 不同炮口角**。安装结构现在是
        # 「位图上的槽 → 插进槽里的柱脚 → 转座+耳轴 → 炮管」，**没有底板**。
        # 上排给 6× 放大（看结构），下排给实机1× 与 2×（真正的验收尺度）。
        SC = 6.0
        cell = 340
        img, d = canvas(cell * 4, cell * 2 + 96)
        for j, (sg, lbl) in enumerate(((-1, 'dorsal 背脊座'), (1, 'ventral 腹部座'))):
            for i, angd in enumerate((-40, 0, 40, 90)):
                gx = i * cell + cell / 2
                gy = j * (cell + 40) + cell / 2
                draw_turret(d, gx, gy, angd, SC, sgn=sg)
                txt(d, (i * cell + 8, gy - cell / 2 + 6), f'{lbl}  ang={angd}',
                    rgb(C_CYAN_DIM))
        txt(d, (8, cell * 2 + 62), 'V6.76: slot (bitmap) + plug leg + trunnion ring + barrel',
            rgb(C_CYAN_DIM, 0.9))
        p = os.path.join(OUT_DIR, 'mount_tiers.png')
        img.save(p)
        print('已出图:', p)

        # 实机尺度：1× / 2× —— 判据是「26px 的座上还读得出是装上去的」
        cell2 = 150
        img2, d2 = canvas(cell2 * 4, cell2 * 2 + 40)
        for i, sc in enumerate((1.0, 2.0)):
            for j, sg in enumerate((-1, 1)):
                gy = i * (cell2 + 16) + j * cell2 / 2 + cell2 / 2
                for k, angd in enumerate((0, 35)):
                    gx = k * cell2 + cell2 / 2
                    draw_turret(d2, gx, gy, angd, sc, sgn=sg)
                txt(d2, (6, i * (cell2 + 16) + 4 + j * (cell2 / 2)),
                    f'{sc:g}x  dorsal' if sg < 0 else f'{sc:g}x  ventral', rgb(C_CYAN_DIM))
        p2 = os.path.join(OUT_DIR, 'mount_ingame.png')
        img2.save(p2)
        print('已出图:', p2)
        return

    if mode == '--emit7':
        # ===== V6.79：**7 族发射器硬件化**对照（改前 vs 改后）=====
        # 判据两条：① 7 族剪影**互不相同**（不靠颜色也能分辨）；
        #           ② 实机尺寸（1x / 2x）下都读得出是**金属件**，而不是"线画的东西"。
        ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        OUTD = os.path.join(ROOT, 'docs', 'shots')
        os.makedirs(OUTD, exist_ok=True)
        # (家族, 变体 id, 标签)
        FAM = [('gun', 'gun', 'gun'), ('torpedo', 'torp_cl', 'torpedo'),
               ('sonar', 'sonar', 'sonar'), ('arc', 'arc', 'arc'),
               ('harpoon', 'harpoon', 'harpoon'), ('echo', 'echo', 'echo'),
               ('acid', 'acid', 'acid')]
        col = rgb(C_AMBER)
        cell, SC = 240, 5.0
        S = EMITTER_SIZE * SC
        ROWH, HEAD = cell + 26, 52
        img, d = canvas(cell * 7, HEAD + ROWH * 2 + 30)
        txt(d, (8, 8),
            'BEFORE  (V6.78 实机：枪/雷两族已是硬件 —— 其余五族仍是"线 + 实心圆")',
            rgb(C_AMBER, 0.95))
        txt(d, (8, HEAD + ROWH - 16),
            'AFTER   (V6.79: 七族统一到 metalTube / 厚盘 —— 与枪族同一套四条体积线索)',
            rgb(C_CYAN_HI))
        txt(d, (8, HEAD + ROWH * 2 + 8),
            '注：本图只对比**族特征**，未画全族共用的尾部机匣；'
            '装到炮座上的完整样子见 --turret / --combat。', rgb(C_CYAN_DIM, 0.9))
        for i, (fam, wid, lab) in enumerate(FAM):
            gx = i * cell + cell / 2
            yB = HEAD + cell / 2
            yA = HEAD + ROWH + cell / 2
            txt(d, (i * cell + 8, HEAD - 16), lab, rgb(C_CYAN_DIM))
            if fam in ('gun', 'torpedo'):
                # ⚠️ 这两族 **V6.70 就已硬件化** —— 用户正是拿它们当"正确"的标杆。
                #    BEFORE 行必须画**实机同款**；把它们画成"三条线"是伪造历史，
                #    会让读者以为"枪族也刚被改"，反而看不出 5 族的落差在哪。
                draw_emitter(d, fam, gx, yB, 0.0, S, col, SC, wid=wid)
            else:
                draw_emitter_old(d, fam, gx, yB, 0.0, S, col, SC, wid=wid)
            draw_emitter(d, fam, gx, yA, 0.0, S, col, SC, wid=wid)
        p = os.path.join(OUTD, 'emitter_7fam.png')
        img.save(p)
        print('已出图:', p)

        # ---- 实机尺寸：AFTER 在 1x / 2x 下的可读性（**真正的验收尺度**）----
        cell2 = 150
        img2, d2 = canvas(cell2 * 7, cell2 * 2 + 60)
        for row, (sc, rl) in enumerate(((1.0, '1x  (EMITTER_SIZE = 18, 实机尺寸)'),
                                        (2.0, '2x'))):
            gy = row * (cell2 + 30) + cell2 / 2 + 16
            txt(d2, (6, row * (cell2 + 30) + 2), rl, rgb(C_CYAN_HI))
            for i, (fam, wid, lab) in enumerate(FAM):
                gx = i * cell2 + cell2 / 2
                if row == 0:
                    txt(d2, (i * cell2 + 6, cell2 + 20), lab, rgb(C_CYAN_DIM))
                draw_emitter(d2, fam, gx, gy, 0.0, EMITTER_SIZE * sc, col, sc, wid=wid)
        p2 = os.path.join(OUTD, 'emitter_7fam_ingame.png')
        img2.save(p2)
        print('已出图:', p2)
        return

    if mode == '--turret':
        # 「发射装置像贴图」对照：旧版（挂点=单色实心圆）vs V6.57（底座+凹槽+壳体+开火）
        cell, SC = 300, 6.0
        img, d = canvas(cell * 3, cell + 32)

        def old(cx, cy, ang_deg):
            ang = math.radians(ang_deg)
            pad, S = 16 * 0.55 * SC, EMITTER_SIZE * SC   # 16 = 旧 TURRET_R（对照用，已作废）
            d.ellipse([cx + pad * 0.16 - pad, cy + pad * 0.26 - pad,
                       cx + pad * 0.16 + pad, cy + pad * 0.26 + pad],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.45))
            d.ellipse([cx - pad, cy - pad, cx + pad, cy + pad],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.62))
            d.arc([cx - pad * 0.76, cy - pad * 0.76, cx + pad * 0.76, cy + pad * 0.76],
                  180 + 3.6, 180 + 86.4, fill=blend(rgb(C_CYAN_HI), BG_RGB, 0.55),
                  width=max(1, round(pad * 0.24)))
            d.ellipse([cx - pad, cy - pad, cx + pad, cy + pad],
                      outline=rgb(C_CYAN_HI), width=max(1, round(1.4 * SC)))
            for i in range(3):
                yy = (i - 1) * S * 0.3
                p1, p2 = _R(cx, cy, ang, -S * 0.35, yy), _R(cx, cy, ang, S * 0.8, yy)
                d.line([p1, p2], fill=rgb(C_AMBER, 1 if i == 1 else 0.65),
                       width=max(1, round(2.2 * SC)))

        old(cell / 2, cell / 2, -30)
        draw_turret(d, cell * 1.5, cell / 2, -30, SC)
        draw_turret(d, cell * 2.5, cell / 2, -30, SC, firing=True)
        txt(d, (10, cell + 10), 'V6.54 挂点（单色实心圆）', rgb(C_CYAN_DIM))
        txt(d, (cell + 10, cell + 10), 'V6.57 底座+凹槽+壳体', rgb(C_CYAN_DIM))
        txt(d, (cell * 2 + 10, cell + 10), 'V6.57 +开火（后坐/枪口焰）', rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'turret_tex.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--barrel':
        # V6.70「发射装置像平面」对照：**旧版（3 条线）vs 新版（炮管）**
        # 两行分别看 6× 放大与实机尺寸 —— 判据是"实机尺寸下还读得出是根管子"。
        cell, SC = 300, 6.0

        def old_lines(cx, cy, ang_deg):
            """旧版枪族：3 条 2.2px 平行线 + 枪口一点。"""
            ang = math.radians(ang_deg)
            S = EMITTER_SIZE * SC
            for i in range(3):
                yy = (i - 1) * S * 0.3
                p1, p2 = _R(cx, cy, ang, -S * 0.35, yy), _R(cx, cy, ang, S * 0.8, yy)
                d.line([(round(p1[0]), round(p1[1])), (round(p2[0]), round(p2[1]))],
                       fill=rgb(C_AMBER, 1 if i == 1 else 0.65),
                       width=max(1, round(2.2 * SC)))
            mz = _R(cx, cy, ang, S * 0.8, 0)
            d.ellipse([mz[0] - S * .11, mz[1] - S * .11, mz[0] + S * .11, mz[1] + S * .11],
                      fill=rgb(C_AMBER))

        # ---- 上排：6× 放大（看结构） ----
        img, d = canvas(cell * 4, cell * 2 + 64)
        for i, angd in enumerate((-30, 0, 30, 60)):
            gx = i * cell + cell / 2
            pad = 16 * 0.55 * SC   # 旧 TURRET_R=16（对照基线）
            base = pad * 1.28
            for (ox, oy, col) in ((pad * .14, pad * .30, blend(rgb(C_ABYSS), BG_RGB, 0.40)),
                                  (0, 1.6 * SC, rgb(C_BODY, 0.34)),
                                  (0, 0, rgb(C_BODY, 0.52))):
                d.ellipse([gx + ox - base, cell / 2 + oy - base, gx + ox + base, cell / 2 + oy + base],
                          fill=col)
            d.ellipse([gx - pad, cell / 2 - pad, gx + pad, cell / 2 + pad],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.58), outline=rgb(C_CYAN_HI))
            old_lines(gx, cell / 2, angd)
            txt(d, (i * cell + 8, cell - 6), f'OLD 旧版 {angd}deg', rgb(C_AMBER, 0.8))

            gy = cell + 32 + cell / 2
            for (ox, oy, col) in ((pad * .14, pad * .30, blend(rgb(C_ABYSS), BG_RGB, 0.40)),
                                  (0, 1.6 * SC, rgb(C_BODY, 0.34)),
                                  (0, 0, rgb(C_BODY, 0.52))):
                d.ellipse([gx + ox - base, gy + oy - base, gx + ox + base, gy + oy + base], fill=col)
            d.ellipse([gx - pad, gy - pad, gx + pad, gy + pad],
                      fill=blend(rgb(C_ABYSS), BG_RGB, 0.58), outline=rgb(C_CYAN_HI))
            draw_emitter(d, 'gun', gx, gy, math.radians(angd), EMITTER_SIZE * SC,
                         rgb(C_AMBER), SC)
            txt(d, (i * cell + 8, cell + 26), f'NEW 炮管 {angd}deg', rgb(C_CYAN_HI))

        txt(d, (10, cell + 4), 'OLD: 3 parallel lines', rgb(C_AMBER, 0.8))
        txt(d, (10, cell * 2 + 42), 'NEW: conical barrel + bore + muzzle ring', rgb(C_CYAN_HI))
        p = os.path.join(OUT_DIR, 'turret_barrel.png')
        img.save(p)
        print('已出图:', p)

        # ---- 下排：实机尺寸（1× 与 2×）—— 真正的验收尺度 ----
        cell2 = 150
        img2, d2 = canvas(cell2 * 4, cell2 * 2 + 46)
        for i, (sc, lbl) in enumerate(((1.0, '实机 1x (EMITTER_SIZE=18)'),
                                       (2.0, '2x'))):
            gy = i * (cell2 + 18) + cell2 / 2
            SCi = sc
            for j, angd in enumerate((-30, 0, 45)):
                gx = j * cell2 + cell2 / 2
                pad = 16 * 0.55 * SC   # 旧 TURRET_R=16（对照基线）i
                base = pad * 1.28
                for (ox, oy, col) in ((pad * .14, pad * .30, blend(rgb(C_ABYSS), BG_RGB, 0.40)),
                                      (0, 1.6 * SCi, rgb(C_BODY, 0.34)),
                                      (0, 0, rgb(C_BODY, 0.52))):
                    d2.ellipse([gx + ox - base, gy + oy - base, gx + ox + base, gy + oy + base], fill=col)
                d2.ellipse([gx - pad, gy - pad, gx + pad, gy + pad],
                           fill=blend(rgb(C_ABYSS), BG_RGB, 0.58), outline=rgb(C_CYAN_HI))
                draw_emitter(d2, 'gun', gx, gy, math.radians(angd),
                             EMITTER_SIZE * SCi, rgb(C_AMBER), SCi)
            txt(d2, (6, i * (cell2 + 18) + 4), lbl, rgb(C_CYAN_DIM))
        p2 = os.path.join(OUT_DIR, 'turret_barrel_ingame.png')
        img2.save(p2)
        print('已出图:', p2)
        return

    if mode == '--silhouette':
        # 验收 §9-1：**纯黑剪影下，潜航器必须一眼是「侧视」**
        scales = [('100% (88px)', 1.0), ('75% (66px)', 0.75), ('50% (44px)', 0.5)]
        cell = 300
        img, d = canvas(cell * 3, cell + 34)
        for i, (name, sc) in enumerate(scales):
            gx, gy = i * cell + cell / 2, cell / 2
            HL, HH = (SUB_D / 2) * sc * 3.0, (HULL_H / 2) * sc * 3.0
            d.polygon([(gx + x * HL, gy + y * HH) for (x, y) in HULL_OUTLINE], fill=(0, 0, 0))
            d.polygon([(gx + x * HL, gy + y * HH) for (x, y) in TOWER], fill=(0, 0, 0))
            for sgn in (1, -1):
                d.polygon([(gx + x * HL, gy + y * sgn * HH) for (x, y) in FIN], fill=(0, 0, 0))
            txt(d, (i * cell + 8, cell + 10), name, fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_silhouette.png')
        img.save(p)
        print('已出图:', p)
        return

    if mode == '--flip':
        # 左右朝向对比：镜像**只翻 x** ⇒ 背永远是背（翻 y 会让艇腹朝天）
        cell = 380
        img, d = canvas(cell * 2, cell)
        draw_hull(d, cell / 2, cell / 2, scale=2.8, m=1)
        draw_hull(d, cell * 1.5, cell / 2, scale=2.8, m=-1)
        txt(d, (10, 10), 'faceX = +1 (朝右)', fill=rgb(C_CYAN_DIM))
        txt(d, (cell + 10, 10), 'faceX = -1 (朝左)', fill=rgb(C_CYAN_DIM))
        p = os.path.join(OUT_DIR, 'hull_side_flip.png')
        img.save(p)
        print('已出图:', p)
        return

    scale = 3.0 if mode == '--big' else 2.6
    pad = int(SUB_D * scale + 90)
    img, d = canvas(pad * 2, pad * 2)
    draw_hull(d, pad, pad, scale, m=1)
    p = os.path.join(OUT_DIR, 'hull_side_big.png' if mode == '--big' else 'hull_side.png')
    img.save(p)
    print('已出图:', p, img.size)


if __name__ == '__main__':
    main()
