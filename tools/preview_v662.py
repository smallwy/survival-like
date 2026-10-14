"""
V6.62 机制预览：**六项机制/惊喜点**的"形态可读性"对照图。

回答的问题是同一个：**"这个东西在屏幕上读得出来吗"**。
V6.62 加的都是"要说清状态"的东西（定身 / 倒计时 / 重甲 / 诱饵灯 / 精英 / 骨雨），
它们**全部**是"不报错、不崩溃、图也在、但玩家看不懂"的高发区 —— 所以必须画出来。

六个面板：
  ① 状态标记对照 —— 减速（断续弧环）vs 定身（实环 + 禁止斜杠）**一眼可分**
  ② 地雷倒计时 —— 三档色 + 闪频 0.50→0.08s + 爆炸圈 + 本体膨胀
  ③ 重甲剪影 —— 六边形壳 vs 鱼的三角（**开打前就要看得出"这个不一样"**）
  ④ 鮟鱇诱饵灯 —— 平时微亮 vs 张口全亮（含咬合半径预警圈）
  ⑤ 精英脉冲光晕 —— 复用鱼骨的"发光 = 值得"读法
  ⑥ 连杀骨雨 —— 玩家周围撒一屏骨

! alpha 必须先画到**透明层**再 `alpha_composite` —— `ImageDraw` 在 RGBA 上画**不做混合，
   是直接覆盖**（见 V6.61 日志）。本脚本每个图元单独合成，工具函数与 `preview_v661.py` 同源。

用法：
  python tools/preview_v662.py          # 六面板总图
  python tools/preview_v662.py --p 3    # 只出第 3 面板

输出 `docs/shots/mech_v662.png`。
"""

import math
import os
import random
import sys
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# 与 TS 同步的常量（改一处不改另一处 = 出一张骗人的图）
# ---------------------------------------------------------------------------
W = 1304
PANEL_W, PANEL_H = 634, 372
GAP, MARGIN, HEAD, FOOT = 12, 12, 56, 46
COLS, ROWS = 2, 3
OUT = 'docs/shots'

BG = (10, 26, 36)
PANEL_BG = (16, 38, 50)
PANEL_EDGE = (44, 86, 106)

# ---- shared/theme.ts / UI ----
CYAN_HI = 0xc8f8ff
JADE = 0x7fffd4
AMBER = 0xffd166
STEEL = 0x9aa7b8
DANGER = 0xff2e63

# ---- shared/dive/world.ts / V6.62 常量 ----
NET_ROOT_T, NET_ROOT_IMMUNE = 1.2, 3.0          # 定身时长 / 免疫窗口
MINE_FUSE = 1.8                                  # 引信时长
MINE_R, MINE_CHAIN_R = 110, 118                  # 爆炸半径 / 连锁半径
ARMOR_R, ARMOR_REDUCE = 30, 0.6                  # 重甲半径 / 减伤
ARMOR_SPD_MUL, ARMOR_HP_MUL = 0.4, 6             # 重甲慢 0.4× / 血厚 6×
ELITE_HP_MUL, ELITE_DROP_MUL = 3, 4              # 精英血厚 / 掉落倍率
ANGLER_LURE_R, ANGLER_FLARE_T = 320, 1.6         # 诱饵范围 / 张口预警窗口
ANGLER_BITE_R, ANGLER_BITE_DMG = 190, 26         # 咬合半径 / 伤害
COMBO_WINDOW, COMBO_N = 3.0, 8                   # 连杀窗口 / 触发数
COMBO_BONE0, COMBO_BONE1, COMBO_SPREAD = 6, 10, 150

SWARM_R = 19                                     # 普通鱼半径（对照用）
DASH_R = 25


# ---------------------------------------------------------------------------
# 工具（与 preview_v661.py 同源）
# ---------------------------------------------------------------------------
def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def font(sz, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    try:
        return ImageFont.truetype(path, sz)
    except Exception:
        try:
            return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', sz)
        except Exception:
            return ImageFont.load_default()


def _lay(base):
    return Image.new('RGBA', base.size, (0, 0, 0, 0))


def _scaled(ov, a):
    ov.putalpha(ov.getchannel('A').point(lambda v: int(v * a)))
    return ov


def poly_a(base, pts, col, a):
    if a <= 0.003 or len(pts) < 3:
        return base
    ov = _lay(base)
    ImageDraw.Draw(ov).polygon(pts, fill=rgb(col) + (255,))
    return Image.alpha_composite(base, _scaled(ov, a))


def line_a(base, pts, col, a, w=1):
    if a <= 0.003 or len(pts) < 2:
        return base
    ov = _lay(base)
    ImageDraw.Draw(ov).line(pts, fill=rgb(col) + (255,), width=int(w), joint='curve')
    return Image.alpha_composite(base, _scaled(ov, a))


def ell_a(base, cx, cy, r, col, a):
    if a <= 0.003:
        return base
    ov = _lay(base)
    ImageDraw.Draw(ov).ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgb(col) + (255,))
    return Image.alpha_composite(base, _scaled(ov, a))


def circ_a(base, cx, cy, r, col, a, w=1, dash=0):
    """圆环。`dash>0` => 画成断续弧（= V6.46「减速 = 被缠住、还能动」的形状语汇）。"""
    if a <= 0.003:
        return base
    ov = _lay(base)
    d = ImageDraw.Draw(ov)
    if dash <= 0:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=rgb(col) + (255,), width=int(w))
    else:
        seg, span = 6, 0.52
        for k in range(seg):
            a0 = (k / seg) * math.pi * 2 + dash
            d.arc([cx - r, cy - r, cx + r, cy + r],
                  math.degrees(a0), math.degrees(a0 + span), fill=rgb(col) + (255,), width=int(w))
    return Image.alpha_composite(base, _scaled(ov, a))


def hexpoly(cx, cy, r, phase):
    return [(cx + math.cos(phase + k / 6 * math.pi * 2) * r,
             cy + math.sin(phase + k / 6 * math.pi * 2) * r) for k in range(6)]


def tri(cx, cy, ang, ra, rb):
    """与 Gfx.fillTri 同构：沿朝向、长轴 ra、短轴 rb（侧视鱼）。ang=π => 头朝左。"""
    return [(cx + math.cos(ang) * ra, cy + math.sin(ang) * ra),
            (cx + math.cos(ang + 2.6) * rb, cy + math.sin(ang + 2.6) * rb),
            (cx + math.cos(ang - 2.6) * rb, cy + math.sin(ang - 2.6) * rb)]


def bone_shape(cx, cy, size, ang, col, a, base):
    """小鱼骨：一根主轴 + 两侧短枝（与 drawBones 同语汇）。"""
    ca, sa = math.cos(ang), math.sin(ang)
    def P(u, v):
        return (cx + u * ca - v * sa, cy + u * sa + v * ca)
    base = line_a(base, [P(-size * .5, 0), P(size * .5, 0)], col, a, 2)
    for u in (-size * .28, size * .28):
        for s in (-1, 1):
            base = line_a(base, [P(u, 0), P(u + size * .2 * s, size * .3)], col, a * .8, 1)
    return base


# ---------------------------------------------------------------------------
# 面板骨架
# ---------------------------------------------------------------------------
def panel_origin(i):
    col, row = i % COLS, i // COLS
    return MARGIN + col * (PANEL_W + GAP), HEAD + row * (PANEL_H + GAP)


def new_canvas():
    return Image.new('RGBA', (W, HEAD + ROWS * PANEL_H + (ROWS - 1) * GAP + FOOT), BG + (255,))


def draw_panel_frame(base, i, n_zh, sub):
    px, py = panel_origin(i)
    ov = _lay(base)
    ImageDraw.Draw(ov).rounded_rectangle([px, py, px + PANEL_W, py + PANEL_H], 10,
                                         fill=PANEL_BG + (255,), outline=PANEL_EDGE + (255,), width=1)
    base = Image.alpha_composite(base, ov)
    d = ImageDraw.Draw(base)
    d.text((px + 16, py + 12), f'{i + 1}  {n_zh}', fill=rgb(CYAN_HI), font=font(17, True))
    d.text((px + 16, py + 36), sub, fill=(150, 186, 202), font=font(12))
    return base


# ---------------------------------------------------------------------------
# ① 状态标记对照：减速 vs 定身
# ---------------------------------------------------------------------------
def panel_states(base):
    px, py = panel_origin(0)
    base = draw_panel_frame(base, 0, '状态标记对照：减速 vs 定身',
                            '不靠颜色（深海会把亮度压掉），靠**形状**：断续 = 还能动 / 实环+斜杠 = 不动')
    cy = py + PANEL_H // 2 + 16
    for half, rooted in ((0, False), (1, True)):
        cx = px + PANEL_W * (0.27 + 0.46 * half)
        r = 26
        base = poly_a(base, tri(cx, cy, math.pi, r * 1.25, r * 0.85), JADE, 0.85)   # 鱼身
        base = ell_a(base, cx - r * 0.9, cy + 5, 2.6, 0x0e1a24, 0.8)
        if not rooted:
            rr = r * 1.52
            base = circ_a(base, cx, cy, rr, CYAN_HI, 0.62, 2, dash=0.6)             # 断续弧环
            for k in range(3):
                a0 = (k / 3) * math.pi * 2 - 0.6
                base = line_a(base, [(cx + math.cos(a0) * rr, cy + math.sin(a0) * rr),
                                     (cx + math.cos(a0) * r * 0.55, cy + math.sin(a0) * r * 0.55)],
                              CYAN_HI, 0.34, 1)
            lab, labc, sub = '减速', CYAN_HI, '被缠住 / 还能动 / 断续（松）'
        else:
            rr = r * 1.3
            base = circ_a(base, cx, cy, rr, CYAN_HI, 0.92, 3)                        # 收紧实环
            base = line_a(base, [(cx - rr * .72, cy + rr * .72), (cx + rr * .72, cy - rr * .72)],
                          DANGER, 0.88, 3)                                              # 禁止斜杠
            lab, labc, sub = '定身', CYAN_HI, '完全不动 / 实环 + 禁止斜杠'
        d = ImageDraw.Draw(base)
        d.text((cx, cy + 62), lab, fill=rgb(labc), font=font(16, True), anchor='mm')
        d.text((cx, cy + 84), sub, fill=(158, 194, 210), font=font(12), anchor='mm')
    d = ImageDraw.Draw(base)
    d.text((px + 16, py + PANEL_H - 30),
           f'定身 {NET_ROOT_T}s + 免疫窗口 {NET_ROOT_IMMUNE}s（免疫期内不再被定 => 不被连续锁死）',
           fill=(140, 175, 190), font=font(12))
    return base


# ---------------------------------------------------------------------------
# ② 地雷倒计时
# ---------------------------------------------------------------------------
def panel_mine(base):
    px, py = panel_origin(1)
    base = draw_panel_frame(base, 1, '地雷倒计时（定时引信）',
                            f'闪频 0.50s → 0.08s（12 倍频差）＋ 三档色 => 余光就能读时钟；爆炸圈 r={MINE_R}')
    ks = (0.90, 0.55, 0.30, 0.08)
    wt = 3.7                                     # 统一采样时刻（真实同屏就是各自 beat 不同）
    cy = py + PANEL_H // 2 + 6
    for i, k in enumerate(ks):
        cx = px + PANEL_W * (0.145 + i * 0.237)
        period = 0.08 + 0.42 * k
        beat = 0.5 + 0.5 * math.sin(wt * (math.pi * 2 / period))
        col = CYAN_HI if k > 0.5 else (AMBER if k > 0.2 else DANGER)
        # 爆炸范围圈（预判用：算好 1.8s 后它游到哪要有边界参照）
        base = circ_a(base, cx, cy, 74, col, 0.12 + 0.10 * beat, 1)
        # 本体：三层同心 + 呼吸膨胀
        swell = 1 + (1 - k) * 0.5
        base = ell_a(base, cx, cy, 14 + beat * 2 + (1 - k) * 6, col, (0.14 + 0.10 * beat) * swell)
        base = ell_a(base, cx, cy, 8.5, col, 0.52 + 0.30 * beat * (1 - k))
        base = circ_a(base, cx, cy, 15 + beat * 4, col, 0.24 + 0.16 * beat, 2)
        base = ell_a(base, cx - 3, cy - 3, 2.4, 0xffffff, 0.85)
        d = ImageDraw.Draw(base)
        d.text((cx, cy + 92), f'k={k:.2f}', fill=rgb(col), font=font(13, True), anchor='mm')
        tag = '安全' if k > 0.5 else ('过半' if k > 0.2 else '临爆')
        d.text((cx, cy + 110), f'{tag}  {period:.2f}s/闪', fill=(150, 186, 202), font=font(11), anchor='mm')
    return base


# ---------------------------------------------------------------------------
# ③ 重甲剪影
# ---------------------------------------------------------------------------
def panel_armor(base):
    px, py = panel_origin(2)
    base = draw_panel_frame(base, 2, '敌人第 4 类「重甲」剪影',
                            '轮廓语汇必须与鱼的三角**完全不同** => 开打前就看出"这个不一样"')
    cy = py + PANEL_H // 2 + 10
    # 左：普通鱼（三角 + 侧视）
    cx = px + PANEL_W * 0.28
    base = poly_a(base, tri(cx, cy, math.pi, SWARM_R * 1.25, SWARM_R * 0.85), JADE, 0.9)
    base = ell_a(base, cx - 14, cy + 4, 2.2, 0x0e1a24, 0.8)
    d = ImageDraw.Draw(base)
    d.text((cx, cy + 54), 'swarm 普通鱼 / 三角', fill=rgb(JADE), font=font(13, True), anchor='mm')
    d.text((cx, cy + 74), f'r={SWARM_R} / 追击玩家', fill=(150, 186, 202), font=font(11), anchor='mm')
    # 右：重甲（六边形壳 + 中缝 + 航向刺）
    cx = px + PANEL_W * 0.70
    R = ARMOR_R * 1.18
    hx = hexpoly(cx, cy, R, 0.35)
    base = poly_a(base, hx, STEEL, 0.92)
    base = line_a(base, hx + [hx[0]], 0xffffff, 0.38, 1.2)
    base = line_a(base, [(cx - R * .86, cy), (cx + R * .86, cy)], 0x0e1a24, 0.55, 2)   # 装甲接缝
    base = line_a(base, [(cx, cy), (cx + R * 1.5, cy)], STEEL, 0.9, 2)                 # 航向刺（不索敌）
    d = ImageDraw.Draw(base)
    d.text((cx, cy + 62), 'armor 重甲 / 六边形壳', fill=rgb(STEEL), font=font(13, True), anchor='mm')
    d.text((cx, cy + 82), f'r={ARMOR_R} / 血 ×{ARMOR_HP_MUL} / 速 ×{ARMOR_SPD_MUL} / 减伤 {int(ARMOR_REDUCE * 100)}%',
           fill=(150, 186, 202), font=font(11), anchor='mm')
    d.text((px + 16, py + PANEL_H - 30),
           '不索敌 => 直线漂移（撞边界反弹，否则飘出屏幕 = 该波永不结束）',
           fill=(140, 175, 190), font=font(12))
    return base


# ---------------------------------------------------------------------------
# ④ 鮟鱇诱饵灯
# ---------------------------------------------------------------------------
def panel_angler(base):
    px, py = panel_origin(3)
    base = draw_panel_frame(base, 3, '第二 Boss「鮟鱇女王」诱饵灯',
                            f'诱饵范围 {ANGLER_LURE_R} / 咬合半径 {ANGLER_BITE_R} / 张口预警 {ANGLER_FLARE_T}s')
    cy = py + PANEL_H // 2 + 6
    for half, flaring in ((0, False), (1, True)):
        cx = px + PANEL_W * (0.27 + 0.46 * half)
        big = 34
        base = ell_a(base, cx, cy + 6, big, 0x1b3a4a, 0.9)            # 大体型
        k = 1.0 if flaring else 0.0
        bright = (0.55 + 0.45 * k) if flaring else 0.20
        base = ell_a(base, cx, cy, 26 + 12 * k, AMBER, min(1, 0.18 * bright * 2))
        base = ell_a(base, cx, cy, 13, AMBER, min(1, 0.34 * bright * 2))
        base = ell_a(base, cx, cy, 5, 0xffffff, min(1, 0.9 * bright))
        if flaring:
            base = circ_a(base, cx, cy, ANGLER_BITE_R * 0.34, DANGER, 0.26 + 0.34 * k, 2)  # 咬合圈（缩放展示）
            base = circ_a(base, cx, cy, ANGLER_LURE_R * 0.34, AMBER, 0.14, 1)              # 诱饵范围（缩放展示）
            lab, labc, sub = '张口（charge）', AMBER, '诱饵全亮 + 咬合圈（0.34 缩放示意）=> 退到哪才安全'
        else:
            lab, labc, sub = '平时（idle）', AMBER, '微亮 0.20 => 只是"我在这"，不构成威胁'
        d = ImageDraw.Draw(base)
        d.text((cx, cy + 60), lab, fill=rgb(labc), font=font(14, True), anchor='mm')
        d.text((cx, cy + 80), sub, fill=(158, 194, 210), font=font(11), anchor='mm')
    d = ImageDraw.Draw(base)
    d.text((px + 16, py + PANEL_H - 30),
           '! 与守望者共用 charge 相位名但**表现必须分开**：守望者蓄力=危险红（该躲）／鮟鱇张口=诱饵亮（该忍）',
           fill=(190, 150, 150), font=font(11))
    return base


# ---------------------------------------------------------------------------
# ⑤ 精英脉冲光晕
# ---------------------------------------------------------------------------
def panel_elite(base):
    px, py = panel_origin(4)
    base = draw_panel_frame(base, 4, '惊喜点 A：精英标记怪',
                            f'脉冲光晕复用鱼骨的「发光 = 值得」读法 => 不用学新符号就知道先打它 / 血 ×{ELITE_HP_MUL} 掉落 ×{ELITE_DROP_MUL}')
    cy = py + PANEL_H // 2 + 6
    for i, pulse in enumerate((0.15, 0.55, 0.92)):
        cx = px + PANEL_W * (0.24 + i * 0.26)
        r = 24
        base = poly_a(base, tri(cx, cy, math.pi, r * 1.25, r * 0.85), JADE, 0.88)
        base = circ_a(base, cx, cy, r * 1.8 + pulse * 3.5, AMBER, 0.40 + 0.36 * pulse, 2.6)
        d = ImageDraw.Draw(base)
        d.text((cx, cy + 60), f'pulse={pulse:.2f}', fill=rgb(AMBER), font=font(12), anchor='mm')
    d = ImageDraw.Draw(base)
    d.text((px + 16, py + PANEL_H - 48),
           '精英掉落**绕过 dropCap** —— 否则"打得好的那一波反倒没掉落"，正好把奖励设计反了',
           fill=(140, 175, 190), font=font(12))
    d.text((px + 16, py + PANEL_H - 28),
           '每波精英数 = 1~2（ELITE_MIN/MAX），必掉囊：大骨 + 一口氧（18）',
           fill=(140, 175, 190), font=font(12))
    return base


# ---------------------------------------------------------------------------
# ⑥ 连杀骨雨
# ---------------------------------------------------------------------------
def panel_combo(base):
    px, py = panel_origin(5)
    base = draw_panel_frame(base, 5, '惊喜点 B：连杀骨雨',
                            f'{COMBO_WINDOW:.0f}s 内连杀 ≥ {COMBO_N} 只 => 在玩家周围撒一屏骨（额外 {COMBO_BONE0}~{COMBO_BONE1} 块）')
    cx, cy = px + PANEL_W // 2, py + PANEL_H // 2 + 16
    rnd = random.Random(11)
    n = 9
    for _ in range(n):
        ang = rnd.random() * math.pi * 2
        r = rnd.random() * COMBO_SPREAD * 0.72
        bx, by = cx + math.cos(ang) * r, cy + math.sin(ang) * r * 0.55
        base = bone_shape(bx, by, 34, rnd.random() * math.pi, CYAN_HI, 0.9, base)
    base = circ_a(base, cx, cy, 16, CYAN_HI, 0.5, 2)
    base = ell_a(base, cx, cy, 5, CYAN_HI, 0.9)
    d = ImageDraw.Draw(base)
    d.text((cx, cy - 92), f'连杀 ×{COMBO_N} / 骨雨', fill=rgb(AMBER), font=font(19, True), anchor='mm')
    d.text((cx, cy + 96), f'COMBO_WINDOW={COMBO_WINDOW:.0f}s 内断杀 => 计数清零（放主循环，下潜途中不冻结）',
           fill=(158, 194, 210), font=font(11), anchor='mm')
    d.text((px + 16, py + PANEL_H - 30),
           '骨雨走 mkBone 统一入口（与击杀掉落同一条路）=> 绕过 dropCap，不掉多余的囊',
           fill=(140, 175, 190), font=font(12))
    return base


PANELS = (panel_states, panel_mine, panel_armor, panel_angler, panel_elite, panel_combo)


def main():
    os.makedirs(OUT, exist_ok=True)
    only = None
    if '--p' in sys.argv:
        only = int(sys.argv[sys.argv.index('--p') + 1]) - 1
    base = new_canvas()
    d = ImageDraw.Draw(base)
    d.text((MARGIN, 14), 'V6.62 机制与惊喜点 —— 形态可读性对照',
           fill=rgb(CYAN_HI), font=font(22, True))
    d.text((MARGIN, 40), '撒网定身 / 定时爆破 / 重甲 / 鮟鱇女王 / 精英标记 / 连杀骨雨',
           fill=(150, 186, 202), font=font(13))
    for i, fn in enumerate(PANELS):
        if only is not None and i != only:
            continue
        base = fn(base)
    if only is None:
        d = ImageDraw.Draw(base)
        d.text((MARGIN, base.size[1] - 30),
               '控场型武器的全部手感都在「我怎么知道它生效了」 —— 三种状态用三种形状语汇（弧环 / 实环+斜杠 / 光晕），不靠颜色',
               fill=(140, 175, 190), font=font(13))
    p = os.path.join(OUT, 'mech_v662.png')
    base.convert('RGB').save(p)
    print('已出图:', p)


if __name__ == '__main__':
    main()
