#!/usr/bin/env python3
"""
V6.82 第一批新生物的**占位剪影**生成器。

为什么要"占位剪影"而不是等真图（与 V6.79 的 `orbit.png` 同一条口径）：
**链路先通，美术后补**。一条新生物的落地要牵动 7 处（types / tables / world /
theme / 图 / 图鉴对账 / 冒烟），其中 6 处是"错一位就静默失效"的。先把这 6 处跑通并
被闸门锁住，再让插画岗拿这张剪影当**形状规格**去出真图 —— 反过来做的话，
"图好了但代码接不上"是最常见的返工。

★ 形状语汇见 `shared/dive/world.ts` 文件头那张表（给插画岗的交接单）。
★ 全部**头朝左**（与现有 5 张鱼图同规，`TEX_BASE_ROT` 的基准值是 π）。

用法：
  python tools/gen_fish_placeholder.py            # 写出 6 张到 web/src/assets/fish/
  python tools/gen_fish_placeholder.py --sheet    # 另出一张对照大图到 docs/shots/
"""

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'web', 'src', 'assets', 'fish')
SHOTS = os.path.join(ROOT, 'docs', 'shots')

# 与 shared/theme.ts 的 PALETTE 一致（这里是**出图侧**，改色只改这两处 + world.ts 的 ENEMY_BASE）
JADE = (0x7f, 0xff, 0xd4)
JADE_HI = (0xc4, 0xff, 0xf0)
STEEL = (0x9a, 0xa7, 0xb8)
LIME = (0xa8, 0xd9, 0x4f)
MAGENTA = (0xff, 0x4f, 0xd8)
DANGER = (0xff, 0x2e, 0x63)
INK = (0x08, 0x11, 0x1c)      # panel 色：体内暗部

SS = 4                         # 超采样倍率
W = 512                        # 画布宽（与现有鱼图一致）
BODY_A = 150                   # 体色 alpha（0-255）
CORE_A = 235                   # 发光核 alpha


def _mix(c, k, toward=INK):
    """把颜色朝暗部混 `k` 比例（k=0 原色，k=1 全暗）"""
    return tuple(int(c[i] * (1 - k) + toward[i] * k) for i in range(3))


def _canvas(h):
    return Image.new('RGBA', (W * SS, h * SS), (0, 0, 0, 0))


def _save(im, h, name):
    im = im.resize((W, h), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name + '.png')
    im.save(p)
    return p


def _blob(dr, box, fill, outline, width, k=0.0):
    """一个圆角体：填充 + 描边。`box` 是像素坐标"""
    dr.ellipse(box, fill=fill + (BODY_A,), outline=outline + (255,), width=width)


def _spindle(dr, cx, cy, L, Hh, fill, outline, width):
    """纺锤形（左右两个尖的菱形近似）—— 头朝左"""
    pts = [(cx - L / 2, cy),
           (cx - L * 0.12, cy - Hh),
           (cx + L * 0.34, cy - Hh * 0.78),
           (cx + L / 2, cy),
           (cx + L * 0.34, cy + Hh * 0.78),
           (cx - L * 0.12, cy + Hh)]
    dr.polygon(pts, fill=fill + (BODY_A,))
    dr.line(pts + [pts[0]], fill=outline + (255,), width=width, joint='curve')


# ---------------------------------------------------------------------------
# 六种形状
# ---------------------------------------------------------------------------
def draw_splitter(im=None):
    """裂体：纺锤 + **中段一道裂口**（"它要裂开"是这个形状唯一要说的信息）"""
    h = 330
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 360 * SS, 105 * SS
    _spindle(dr, cx, cy, L, Hh, _mix(JADE, 0.55), JADE, 7 * SS)
    # 裂口：中段一道向内的暗缝（不切断轮廓 —— 断了会读作"两条鱼"）
    for dy in (-1, 1):
        dr.line([(cx + 10 * SS, cy - Hh * 0.62), (cx + 26 * SS, cy), (cx + 10 * SS, cy + Hh * 0.62)],
                fill=INK + (220,), width=9 * SS, joint='curve')
    _eye(dr, cx - L * 0.30, cy - 8 * SS, JADE, 13 * SS)
    return _save(im, h, 'splitter')


def draw_shard(im=None):
    """幼体：小纺锤，**无裂口、无眼** —— "它只是个碎片" """
    h = 210
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 200 * SS, 62 * SS
    _spindle(dr, cx, cy, L, Hh, _mix(JADE_HI, 0.5), JADE_HI, 6 * SS)
    # 只有一颗亮点（不是眼）：它是"刚裂出来的碎片还在发光"
    r = 16 * SS
    dr.ellipse([cx - L * 0.10 - r, cy - r, cx - L * 0.10 + r, cy + r], fill=JADE_HI + (CORE_A,))
    return _save(im, h, 'shard')


def draw_bulwark(im=None):
    """盾鳐：宽扁 + **前缘一块厚甲**（"正面硬"）"""
    h = 300
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 400 * SS, 96 * SS
    # 扁平体：上下各一条长弧（比 spindle 更"压扁"）
    pts = [(cx - L / 2, cy - 6 * SS), (cx - L * 0.14, cy - Hh),
           (cx + L * 0.40, cy - Hh * 0.66), (cx + L / 2, cy),
           (cx + L * 0.40, cy + Hh * 0.66), (cx - L * 0.14, cy + Hh),
           (cx - L / 2, cy + 6 * SS)]
    dr.polygon(pts, fill=_mix(STEEL, 0.58) + (BODY_A,))
    dr.line(pts + [pts[0]], fill=STEEL + (255,), width=7 * SS, joint='curve')
    # 前缘厚甲：左侧一块加厚的竖板（**双线** ⇒ 读作"这是一块板"而不是"这条线粗")
    x0, x1 = cx - L / 2 + 14 * SS, cx - L / 2 + 52 * SS
    dr.rounded_rectangle([x0, cy - Hh * 0.94, x1, cy + Hh * 0.94],
                         radius=14 * SS, fill=_mix(STEEL, 0.30) + (235,), outline=STEEL + (255,), width=6 * SS)
    _eye(dr, cx - L * 0.28, cy - 8 * SS, STEEL, 12 * SS)
    # 尾鳍
    dr.polygon([(cx + L / 2 - 6 * SS, cy), (cx + L / 2 + 40 * SS, cy - 46 * SS), (cx + L / 2 + 40 * SS, cy + 46 * SS)],
               fill=_mix(STEEL, 0.5) + (200,), outline=STEEL + (255,))
    return _save(im, h, 'bulwark')


def draw_brood(im=None):
    """孵卵囊：圆鼓 + 表面一排卵孔（"会生"）"""
    h = 340
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    Rx, Ry = 150 * SS, 138 * SS
    _blob(dr, [cx - Rx, cy - Ry, cx + Rx, cy + Ry], _mix(LIME, 0.55), LIME, 7 * SS)
    # 卵孔：三列小圆（暗孔 + 亮环 ⇒ 读作"里面还有东西"）
    for i, dx in enumerate((-62, 0, 62)):
        for j, dy in enumerate((-52, 14)):
            ox, oy = cx + dx * SS, cy + dy * SS
            r = 24 * SS
            dr.ellipse([ox - r, oy - r, ox + r, oy + r], fill=INK + (230,), outline=LIME + (255,), width=5 * SS)
            r2 = 10 * SS
            dr.ellipse([ox - r2, oy - r2, ox + r2, oy + r2], fill=_mix(LIME, 0.2) + (210,))
    # 顶部一撮短触手（让它不像"一块石头"）
    for k in (-46, -14, 18, 50):
        dr.line([(cx + k * SS, cy - Ry * 0.94), (cx + k * SS * 1.35, cy - Ry * 1.5)],
                fill=LIME + (230,), width=8 * SS)
    return _save(im, h, 'brood')


def draw_kamikaze(im=None):
    """自爆螺：短粗圆壳 + **背部一道红缝**（"要炸"）"""
    h = 280
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    Rx, Ry = 176 * SS, 106 * SS
    _blob(dr, [cx - Rx, cy - Ry, cx + Rx, cy + Ry], _mix(MAGENTA, 0.58), MAGENTA, 7 * SS)
    # 螺旋壳纹（两段弧 ⇒ 读作"螺"）
    for k, rr in ((0.72, 62), (0.46, 34)):
        dr.arc([cx - Rx * k, cy - Ry * k, cx + Rx * k, cy + Ry * k], 120, 420,
               fill=_mix(MAGENTA, 0.25) + (220,), width=6 * SS)
    # ★ 背部红缝：**唯一一处 `danger`** —— 与"敌方预警 / 低氧 / 受击"同一支红，
    #   玩家不用学新符号就知道"这里要出事"。
    dr.line([(cx - 26 * SS, cy - Ry - 4 * SS), (cx + 6 * SS, cy - Ry - 16 * SS), (cx + 40 * SS, cy - Ry + 2 * SS)],
            fill=DANGER + (255,), width=11 * SS, joint='curve')
    _eye(dr, cx - Rx * 0.62, cy - 6 * SS, MAGENTA, 13 * SS)
    return _save(im, h, 'kamikaze')


def draw_herder(im=None):
    """牧群者：细长 + **两侧一排须**（"在指挥"）"""
    h = 250
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 430 * SS, 46 * SS
    _spindle(dr, cx, cy, L, Hh, _mix(JADE, 0.62), JADE, 7 * SS)
    # 两侧的须：上下各 5 根短须，**朝后的角度**（像在划水/发信号）
    for i in range(5):
        bx = cx - L * 0.30 + i * L * 0.17
        for s in (-1, 1):
            dr.line([(bx, cy + s * Hh * 0.86), (bx - 22 * SS, cy + s * (Hh + 46 * SS))],
                    fill=JADE + (225,), width=7 * SS)
    # 背鳍（把它和"游群"拉开：游群没有立起来的鳍）
    dr.polygon([(cx - 20 * SS, cy - Hh * 0.9), (cx + 30 * SS, cy - Hh * 0.9), (cx + 60 * SS, cy - Hh * 2.2)],
               fill=_mix(JADE, 0.4) + (225,), outline=JADE + (255,), width=5 * SS)
    _eye(dr, cx - L * 0.34, cy - 6 * SS, JADE, 12 * SS)
    # 发光核（"它是个中枢"）
    r = 20 * SS
    dr.ellipse([cx - r + 8 * SS, cy - r - 40 * SS, cx + r + 8 * SS, cy + r - 40 * SS], fill=JADE + (200,))
    return _save(im, h, 'herder')


# ---------------------------------------------------------------------------
# V6.83 第二批七种
#   ★ 判据同 V6.82：**形状只负责"一眼读出这是什么行为"**，不负责"像不像某种鱼"。
#     所以每一种的重点都是"**哪个部位在说话**"（长吻 / 吸盘 / 垂须 / 分节甲 …）。
#   ★ 色仍按语义归族（lime 软体 / steel 甲壳 / magenta 危险 / jade 常见），
#     三种 `lime` 之间的区分**全靠剪影** —— 这正是"色是语义槽，种类靠形状"的验收点。
# ---------------------------------------------------------------------------
def draw_jelly(im=None):
    """浮游水母：钟形伞盖 + 下方五条垂须（"不碰你也能伤你"）"""
    h = 340
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    Rx, Ry = 168 * SS, 118 * SS
    # 伞盖：上半圆 + 下缘一条平线（水母钟形 —— 下方是平的，须从那里垂下来）
    dr.pieslice([cx - Rx, cy - Ry, cx + Rx, cy + Ry], 180, 360, fill=_mix(LIME, 0.58) + (BODY_A,))
    dr.arc([cx - Rx, cy - Ry, cx + Rx, cy + Ry], 180, 360, fill=LIME + (255,), width=7 * SS)
    dr.line([(cx - Rx, cy), (cx + Rx, cy)], fill=LIME + (255,), width=7 * SS)
    # 垂须：长短交错（下缘是它和"半球形"唯一的区别所在）
    for i, dx in enumerate((-108, -54, 0, 54, 108)):
        x0 = cx + dx * SS
        ln = (116 if i % 2 == 0 else 88) * SS
        pts = [(x0, cy)]
        for k in range(1, 4):
            pts.append((x0 + (18 if k % 2 else -18) * SS, cy + ln * k / 3))
        dr.line(pts, fill=LIME + (200,), width=6 * SS, joint='curve')
    # 充能环：体表一圈微亮（"它在攒电"的静态提示，动态里由 `phase='charge'` 加强）
    dr.arc([cx - Rx * 0.72, cy - Ry * 0.80, cx + Rx * 0.72, cy + Ry * 0.80],
           205, 335, fill=(0xff, 0xff, 0xff, 170), width=5 * SS)
    return _save(im, h, 'jelly')


def draw_mimic(im=None):
    """拟态碎屑：**不规则多角块，无眼无鳍** —— 伪装本身就是它的形状"""
    h = 300
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    # ⚠️ 刻意**不对称** —— 对称的形状会被读作"生物"，那就露馅了
    pts = [(cx - 168 * SS, cy + 24 * SS), (cx - 122 * SS, cy - 74 * SS),
           (cx - 30 * SS, cy - 116 * SS), (cx + 74 * SS, cy - 88 * SS),
           (cx + 156 * SS, cy - 14 * SS), (cx + 118 * SS, cy + 78 * SS),
           (cx + 6 * SS, cy + 112 * SS), (cx - 96 * SS, cy + 88 * SS)]
    dr.polygon(pts, fill=_mix(STEEL, 0.72) + (BODY_A,))
    dr.line(pts + [pts[0]], fill=_mix(STEEL, 0.28) + (255,), width=6 * SS, joint='curve')
    # 碎裂纹：内部几条折线（读作"岩石"而不是"一团色块"）
    for a, b, c in (((-112, -40), (-30, 4), (52, -34)),
                    ((-88, 62), (-6, 22), (86, 58)),
                    ((-30, 4), (-6, 22), (0, 0))):
        dr.line([(cx + a[0] * SS, cy + a[1] * SS), (cx + b[0] * SS, cy + b[1] * SS),
                 (cx + c[0] * SS, cy + c[1] * SS)], fill=INK + (190,), width=5 * SS, joint='curve')
    return _save(im, h, 'mimic')


def draw_lancer(im=None):
    """枪鱼：极细长纺锤 + **前端一根长吻** + 大尾鳍（"它只走直线"）"""
    h = 250
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 430 * SS, 62 * SS
    _spindle(dr, cx + 20 * SS, cy, L, Hh, _mix(MAGENTA, 0.60), MAGENTA, 6 * SS)
    # 长吻：从头部往前收窄成尖 —— **枪**的语汇（同 V6.79「前端收敛成尖 = 箭头」的反用：
    #   这里确实要它读作"一根刺"）
    dr.polygon([(cx - L / 2 + 10 * SS, cy - 15 * SS), (cx - L / 2 - 112 * SS, cy),
                (cx - L / 2 + 10 * SS, cy + 15 * SS)],
               fill=_mix(MAGENTA, 0.32) + (240,), outline=MAGENTA + (255,))
    # 大尾鳍：高速穿场的推进面
    dr.polygon([(cx + L / 2 + 10 * SS, cy), (cx + L / 2 + 74 * SS, cy - 58 * SS),
                (cx + L / 2 + 74 * SS, cy + 58 * SS)],
               fill=_mix(MAGENTA, 0.50) + (205,), outline=MAGENTA + (255,))
    _eye(dr, cx - L * 0.24, cy - 8 * SS, MAGENTA, 11 * SS)
    return _save(im, h, 'lancer')


def draw_burrower(im=None):
    """潜沙者：粗短纺锤 + **背部分节甲** + 前端一对铲颚（"它会钻下去"）"""
    h = 300
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 330 * SS, 100 * SS
    _spindle(dr, cx, cy, L, Hh, _mix(JADE, 0.62), JADE, 7 * SS)
    # 分节：四道**竖弧**（甲壳的读法；横线会被读作"被切成段"）
    for i in range(4):
        x = cx - L * 0.30 + i * L * 0.20
        dr.arc([x - 26 * SS, cy - Hh * 0.86, x + 26 * SS, cy + Hh * 0.86],
               270, 90, fill=INK + (200,), width=6 * SS)
    # 铲颚：前端上下两片（掘沙的器官）
    for sy in (-1, 1):
        dr.polygon([(cx - L / 2 + 6 * SS, cy + sy * 20 * SS),
                    (cx - L / 2 - 76 * SS, cy + sy * 44 * SS),
                    (cx - L / 2 + 6 * SS, cy + sy * 54 * SS)],
                   fill=_mix(JADE, 0.40) + (225,), outline=JADE + (255,))
    _eye(dr, cx - L * 0.22, cy - 26 * SS, JADE, 12 * SS)
    return _save(im, h, 'burrower')


def draw_bloom(im=None):
    """孢囊：球体 + **顶部喷口** + 底部根须（"死了会留下一片"）"""
    h = 330
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    R = 132 * SS
    _blob(dr, [cx - R, cy - R, cx + R, cy + R], _mix(LIME, 0.50), LIME, 7 * SS)
    # 内部孢子团：三个偏心亮球（"里面装满东西，快撑不住了"）
    for dx, dy, rr in ((-38, -24, 34), (30, -6, 26), (-8, 42, 30)):
        dr.ellipse([cx + (dx - rr) * SS, cy + (dy - rr) * SS,
                    cx + (dx + rr) * SS, cy + (dy + rr) * SS],
                   fill=LIME + (95,), outline=_mix(LIME, 0.20) + (190,), width=4 * SS)
    # 顶喷口：一段朝上的短颈 + 开口（唯一指出"往哪儿排"的结构）
    dr.rounded_rectangle([cx - 26 * SS, cy - R - 54 * SS, cx + 26 * SS, cy - R + 16 * SS],
                         radius=12 * SS, fill=_mix(LIME, 0.36) + (240,),
                         outline=LIME + (255,), width=6 * SS)
    # 根须：底部四条短须（"扎在那里" ⇒ 与会漂的 brood 分开）
    for dx in (-74, -26, 26, 74):
        x0 = cx + dx * SS
        dr.line([(x0, cy + R * 0.86), (x0 + (14 if dx > 0 else -14) * SS, cy + R + 52 * SS)],
                fill=LIME + (185,), width=5 * SS)
    return _save(im, h, 'bloom')


def draw_leech(im=None):
    """吸血蛭：长条蠕虫 + **环形分节** + 前端同心圆**吸盘**（"它在吸我"）"""
    h = 250
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 400 * SS, 70 * SS
    _spindle(dr, cx + 16 * SS, cy, L, Hh, _mix(MAGENTA, 0.66), MAGENTA, 6 * SS)
    # 环形分节：七道竖弧（蠕虫的读法；横线会读作"鳞片"）
    for i in range(7):
        x = cx - L * 0.34 + i * L * 0.11
        dr.arc([x - 22 * SS, cy - Hh * 0.92, x + 22 * SS, cy + Hh * 0.92],
               270, 90, fill=_mix(MAGENTA, 0.12) + (200,), width=6 * SS)
    # 吸盘：前端**同心圆环** —— 全作唯一的这个形状，一眼认出"那是嘴"
    sx = cx - L / 2 + 4 * SS
    for rr, wd in ((42, 7), (26, 6)):
        dr.ellipse([sx - rr * SS, cy - rr * SS, sx + rr * SS, cy + rr * SS],
                   outline=MAGENTA + (215,), width=wd * SS)
    dr.ellipse([sx - 9 * SS, cy - 9 * SS, sx + 9 * SS, cy + 9 * SS], fill=(0xff, 0xff, 0xff, 205))
    return _save(im, h, 'leech')


def draw_darter(im=None):
    """摆尾鱼：细长鱼 + **分叉大尾鳍** + 体侧波纹（"它的路线是波浪"）"""
    h = 260
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2
    L, Hh = 340 * SS, 66 * SS
    _spindle(dr, cx - 10 * SS, cy, L, Hh, _mix(JADE, 0.60), JADE, 6 * SS)
    # 分叉大尾鳍：摆动的动力面 —— 尾鳍越大越读得出"它在扑腾"
    tx = cx - 10 * SS + L / 2
    for sy in (-1, 1):
        dr.polygon([(tx - 6 * SS, cy), (tx + 86 * SS, cy + sy * 92 * SS),
                    (tx + 14 * SS, cy + sy * 16 * SS)],
                   fill=_mix(JADE, 0.48) + (215,), outline=JADE + (255,))
    # 体侧波纹：三道波浪线（横摆的静态提示）
    for y0 in (-30, 0, 30):
        pts = []
        for k in range(9):
            pts.append((cx - L * 0.34 + k * L * 0.085, cy + y0 * SS + (10 if k % 2 else -10) * SS))
        dr.line(pts, fill=_mix(JADE, 0.10) + (150,), width=4 * SS, joint='curve')
    _eye(dr, cx - L * 0.26, cy - 8 * SS, JADE, 12 * SS)
    return _save(im, h, 'darter')


def draw_spitter(im=None):
    """喷酸鱼：**短粗身 + 前端大口径喷嘴 + 背部毒囊**（V6.83）

    ★ 刻意**不用 `_spindle`** —— 那是"所有鱼"的通用形，用多了剪影就雷同。
    它的读法必须是"**它靠喷东西**"，而"喷"这个动作要有一个**形状上的解释**：
    前端一个突出的**大圆口** + 背上一个**鼓起来的囊**（酸从哪来）。
    与 `lancer` 的长吻区别：那个是**细而长的刺**，这个是**短而大的口**。
    """
    h = 320
    im = _canvas(h)
    dr = ImageDraw.Draw(im)
    cx, cy = W * SS / 2, h * SS / 2

    # 身体：前宽后窄的"瓶子"（不是纺锤 —— 前后不对称才读得出朝向）
    body = [(cx - 152 * SS, cy - 88 * SS), (cx - 40 * SS, cy - 100 * SS),
            (cx + 96 * SS, cy - 74 * SS), (cx + 176 * SS, cy - 20 * SS),
            (cx + 176 * SS, cy + 20 * SS), (cx + 96 * SS, cy + 74 * SS),
            (cx - 40 * SS, cy + 100 * SS), (cx - 152 * SS, cy + 88 * SS)]
    dr.polygon(body, fill=_mix(MAGENTA, 0.64) + (BODY_A,))
    dr.line(body + [body[0]], fill=MAGENTA + (255,), width=7 * SS, joint='curve')

    # 背部毒囊：一个鼓在上面的包（"酸从哪来"的形状解释）
    dr.ellipse([cx - 30 * SS, cy - 176 * SS, cx + 118 * SS, cy - 44 * SS],
               fill=_mix(MAGENTA, 0.44) + (215,), outline=MAGENTA + (255,), width=6 * SS)
    for k in range(3):                       # 囊内的酸液纹（三层同心弧 ⇒ 读作"装满了")
        rr = (18 + k * 16) * SS
        dr.arc([cx + 44 * SS - rr, cy - 110 * SS - rr, cx + 44 * SS + rr, cy - 110 * SS + rr],
               200, 340, fill=(0xff, 0xff, 0xff, 170 - k * 40), width=5 * SS)

    # ★ 前端喷嘴：一段**大口径的短管** + 一个**双层圆环开口**
    #   （双层环是全作唯一这个形状 —— 一眼认出"那是口"）
    dr.rounded_rectangle([cx - 232 * SS, cy - 46 * SS, cx - 128 * SS, cy + 46 * SS],
                         radius=16 * SS, fill=_mix(MAGENTA, 0.30) + (245,),
                         outline=MAGENTA + (255,), width=6 * SS)
    for rr, wd in ((34, 7), (20, 6)):
        dr.ellipse([cx - 202 * SS - rr * SS * 0.5, cy - rr * SS * 0.5,
                    cx - 202 * SS + rr * SS * 0.5, cy + rr * SS * 0.5],
                   outline=MAGENTA + (235,), width=wd * SS)
    dr.ellipse([cx - 208 * SS, cy - 7 * SS, cx - 196 * SS, cy + 7 * SS], fill=(0xff, 0xff, 0xff, 210))

    # 尾鳍：小而分叉（它不是靠游得快 —— 尾鳍刻意画小，与 lancer 的大尾鳍对照）
    for sy in (-1, 1):
        dr.polygon([(cx + 170 * SS, cy), (cx + 236 * SS, cy + sy * 62 * SS), (cx + 190 * SS, cy + sy * 14 * SS)],
                   fill=_mix(MAGENTA, 0.52) + (205,), outline=MAGENTA + (255,))

    _eye(dr, cx - 52 * SS, cy - 30 * SS, MAGENTA, 12 * SS)
    return _save(im, h, 'spitter')


def _eye(dr, x, y, color, r):
    dr.ellipse([x - r, y - r, x + r, y + r], fill=INK + (240,), outline=color + (255,), width=4 * SS)
    r2 = r * 0.45
    dr.ellipse([x - r2, y - r2, x + r2, y + r2], fill=(0xff, 0xff, 0xff, 235))


DRAWERS = [
    ('splitter', draw_splitter),
    ('shard', draw_shard),
    ('bulwark', draw_bulwark),
    ('brood', draw_brood),
    ('kamikaze', draw_kamikaze),
    ('herder', draw_herder),
    # V6.83 第二批
    ('jelly', draw_jelly),
    ('mimic', draw_mimic),
    ('lancer', draw_lancer),
    ('burrower', draw_burrower),
    ('bloom', draw_bloom),
    ('leech', draw_leech),
    ('darter', draw_darter),
    ('spitter', draw_spitter),
]


def main():
    for name, fn in DRAWERS:
        p = fn()
        print(f'  ✓ {name:9s} → {os.path.relpath(p, ROOT)}  ({Image.open(p).size})')
    if '--sheet' in sys.argv:
        names = [n for n, _ in DRAWERS]
        ims = [Image.open(os.path.join(OUT, n + '.png')) for n in names]
        sc = 0.62
        pad = 12
        Wt = int(max(i.width for i in ims) * sc) + pad * 2
        Ht = int(sum(i.height for i in ims) * sc) + pad * (len(ims) + 1)
        sheet = Image.new('RGBA', (Wt, Ht), (0x04, 0x07, 0x0d, 255))
        y = pad
        for i in ims:
            t = i.resize((int(i.width * sc), int(i.height * sc)), Image.LANCZOS)
            sheet.alpha_composite(t, (pad, y))
            y += t.height + pad
        os.makedirs(SHOTS, exist_ok=True)
        out = os.path.join(SHOTS, 'v682_fish_placeholder.png')
        sheet.save(out)
        print(f'  ✓ 对照大图 → {os.path.relpath(out, ROOT)}  ({sheet.size})')


if __name__ == '__main__':
    main()
