#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
深海剪影族验证原型（Silhouette Family Proof-of-Concept）
=====================================================

背景
----
`silhouette_check.py` 已证明：现有 16 个单位的人形剪影
**120 对比对中可区分 0 对，48 对完全撞车（IoU≥0.82）**。

本文件验证：`美术资源计划.md` §3 提出的 **6 个深海剪影族**
能否在 pixelgen 的 32x32 硬边约束下做出**互相可辨**的轮廓。

这是整个美术计划的 **决策点**：
  - 若成立 → 深海美术方案可行，按计划书推进全量改造
  - 若不成立 → 退路为「深色底+ 强描边 + 体型极端化」

本文件是**独立原型**，不修改 `pixelgen.py` 的既有函数；
验证通过后再决定是否合并进主管线。

约束（继承 pixelgen）
--------------------
1. 32x32 逻辑像素网格，硬边无抗锯齿
2. 整数倍NEAREST 放大（保持像素块大小一致）
3. 1px 深色描边
4.脚底对齐（便于行走动画）

族清单
------
    bell       伞形/钟形，底部垂触手   —— 水母
    tower      竖立塔簇，高瘦           —— 管虫/钙壳
    serpent    蛇形盘绕，螺旋           —— 触手/鳗鱼
    shell      圆壳 + 尖刺/双螯         —— 甲壳
    school     密集三角群，无单体       —— 鱼群
    leviathan  巨大阴影占屏 1/4         —— Boss
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw
import pixelgen as pg
import silhouette_check as sc


# --------------------------------------------------------------------------
# 6 个深海剪影族
#
# 每族一个 draw 函数：接收逻辑网格画布 g，在 32x32 内绘制轮廓。
# 统一约定：脚底y=30（与现有 humanoid 族对齐），
# cx=16 居中，动画通过 pose 的 dy / ll / rl 轻微位移实现。
# --------------------------------------------------------------------------

def draw_bell(g, spec, cx, dy, pose, d):
    """伞形族：顶部钟形伞盖 + 底部垂触手。剪影特征 = 圆顶 + 下垂飘带。"""
    col = spec['top']
    hw = spec.get('hw', 9)                      # 伞盖半宽
    ty = 3 + dy                                  # 伞盖顶
    bell = spec.get('bell_h', 12)

    # 动画：伞盖脉动（ext = -1..1，钟状收缩）+ 触手相位滞后（t = 0..1循环）
    ext = pose.get('ext', 0.0)
    ph = pose.get('t', 0.0)
    if ext:
        hw = int(round(hw + ext))                   # 伞盖收缩/舒张
        bell = max(4, int(round(bell - ext * 1.5)))  # 变矮变宽 = 收缩
    # 方向：朝下=伞盖压扁（迎向玩家），朝上=伞盖撑圆（向上加速），侧向=纵向压扁
    _, sq_, st_, _ = _dir_bias(pose, d)
    hw = int(round(hw * sq_))
    bell = max(4, int(round(bell * st_)))

    # 伞盖：半椭圆（用 ellipse 画上半个圆更接近水母伞）
    g.e(cx - hw, ty, cx + hw, ty + bell, col)
    # 伞盖内的凹槽（挖出一点弧度，避免变成纯半圆）
    inner = mixhex(col, 0.72)
    g.e(cx - hw + 2, ty + bell - 5, cx + hw - 2, ty + bell + 1, inner)

    # 触手：3~5 条下垂飘带，长短不一 —— 这是剪影的关键辨识点
    n = spec.get('tentacles', 4)
    #
    # ⚠️ 长度必须能被 spec 覆盖（P1b 剪影自检实测）：
    # 原来长度写死 `7 + (i%3)*3`，而胶质漂群(hw7/bell10/tent3) 与
    # 荧光幼体群(hw5/bell7/tent3) 参数本来就接近、触手数又一样，
    # 结果**两对参数生成出几乎同形的剪影，IoU 0.849** —— 而它们是同屏出现的敌人。
    #
    # 现在加 tent_len / tent_len_var 两个键，让"幼体"可以更长更密：
    # 幼体群 = 6 条长触手，剪影和母群一下就分开了。
    base_len = spec.get('tent_len', 7)
    len_var = spec.get('tent_len_var', 3)
    for i in range(n):
        tx = cx - hw + 2 + i * (2 * hw - 4) // max(1, n - 1)
        ln_len = base_len + (i % 3) * len_var    # 长短交错 → 剪影不对称
        col_t = mixhex(col, 0.85)
        for k in range(ln_len):
            # 摆动：沿触手长度递增的相位差 → 呈波浪状鞭甩，而不是整条平移
            amp = pose.get('amp', 0.0)
            wob = int(round(math.sin((ph + k * 0.16) * math.tau) * (1 + k * 0.12) * amp))
            g.p(tx + wob, ty + bell + 1 + k, col_t)
            g.p(tx + 1 + wob, ty + bell + 1 + k, col_t)

    # 柄部收窄
    g.r(cx - 2, ty + bell, 5, 2, col)


def draw_tower(g, spec, cx, dy, pose, d):
    """塔形族：竖立高瘦管簇。剪影特征 = 垂直线 + 顶部小冠 + 高低起伏。

    第一版的问题：所有管子等高 → 剪影是个方块（上沿平直），
    缺少辨识度。修正为**中间高两侧矮**，形成阶梯状上沿。
    """
    col = spec['top']
    n = int(spec.get('towers', 4))
    base = 30
    ext = pose.get('ext', 0.0)
    ph = pose.get('t', 0.0)
    sq = pose.get('sq', 0.0)
    _, sq_, st_, _ = _dir_bias(pose, d)
    # 鱼群的**朝向读法**：横向切入 → 拉成横队；向上冲 → 挤成纵队
    ax = 1.0 if d == 'side' else 0.62
    ay = 0.55 if d == 'side' else 1.0
    _, sq_, st_, _ = _dir_bias(pose, d)
    for i in range(n):
        # 相邻管相位差 0.18 → 依次伸长的波浪（管虫伸缩的真实观感）
        local = math.sin((ph + i * 0.18) * math.tau)
        tx = cx - 9 + i * 5 + (1 if i % 2 else 0) * int(round(sq * 0.8))
        tx = int(round(cx + (tx - cx) * sq_))
        # 中间高两侧矮：h = 22,19,16,13,10 → 阶梯状
        h = 22 - abs(i - (n - 1) / 2) * 3
        h = int(round((h + ext * 3 * local) * st_))
        w = 3
        g.r(tx, base - h, w, h, col)                    # 垂直管体
        g.r(tx - 1, base - h - 2, w + 2, 2, mixhex(col, 0.8))   # 顶部小冠
        # 管壁横向纹（钙壳质感）
        for k in range(3, h - 2, 4):
            g.p(tx, base - h + k, mixhex(col, 0.72))
            g.p(tx + w - 1, base - h + k, mixhex(col, 0.72))
        # 底部根盘
        g.r(tx - 1, base - 1, w + 2, 1, mixhex(col, 0.6))
    # 顶部悬浮孢子（钙壳的辨识钩子）—— 随主相位上下浮动
    g.p(cx + 2, base - 26 + int(round(math.sin(ph * math.tau) * 1.5 * pose.get('amp', 0.0))), mixhex(col, 1.0))


def draw_serpent(g, spec, cx, dy, pose, d):
    """蛇形族：S 形盘绕。剪影特征 = 连续的曲线缠绕（唯一的曲线剪影）。

    实现要点：每段画**实心方块**并让相邻段重叠 1px，保证剪影是
    **连续曲线**而不是虚线（这是第一版的 bug：段间距 > 段宽导致断开）。
    """
    col = spec['top']
    coils = int(spec.get('coils', 3))
    seg = 5# 每段 5px
    seg_w = 3                     # 段宽（> 间距才连续）
    step = seg - 1                # 相邻段中心间距 = 4 <段宽 3+1 → 重叠
    thickness = 3

    ph = pose.get('t', 0.0)
    amp = pose.get('sq', 0.0)
    gate = pose.get('amp', 0.0)
    _, sq_, st_, lean = _dir_bias(pose, d)
    if d == 'side':
        amp *= 1.6                # 横向游动：波动更明显
    elif d == 'up':
        amp *= 0.75               # 向上逃逸：波动收敛（加速姿态）

    if gate > 0:
        # 动画版：**单条连续的盘绕躯干**（原版是 3 根水平并列的 S 柱，
        # 读起来像楼梯而不是蛇 —— 这是 6 族里造型最弱的一个）。
        #
        # 踩过的坑，写在这里避免重犯：
        #  1. 横向摆幅开大 → 相邻段中心距 > 块宽 3px → 重叠断开 → 碎成阶梯方块。
        #     所以横移必须**夹在有界范围**，保证相邻段永远贴合。
        #  2. 改用"参数曲线 + 密集采样"整体重绘 → 横纵同时跳变，块错位叠出毛边，
        #     糊成一团。曲线采样适合连续形体，不适合 3px 方块链。
        # 结论：方块链的动画只能靠**有界位移**，不能改拓扑。
        thick = 4# 躯干加粗到 4px，让它在32px 网格上读得出"一条蛇"
        n = coils * seg                     # 总段数
        for c in range(n):
            u = c / max(1, n - 1)            # 沿体长0..1
            # 水平：三段往复（连续 S），波沿体长传递 → 鞭浪
            w = math.sin((ph + u * 2.5) * math.tau) * amp
            lane = 3 if (c // seg) % 2 else 0      # 每 seg 段换一个横向车道
            sx = cx - 6 + lane + int(round(w * 1.2))
            sx = max(cx - 8, min(cx + 6, sx))
            # 垂直：严格每 step 上行一格，保证相邻段重叠
            sy = 30 - c * 2 + dy + int(round(w * 0.3))
            g.r(sx, sy, thick, thick, col)
            if lean:
                pass
    else:
        for c in range(coils):
            for s in range(seg):
                dx = (s % 2) * (seg_w - 1)
                yy = 30 - s * step + dy
                xx = cx - 10 + c * 3 + dx
                g.r(xx, yy, thickness, thickness, col)
    # 头部（带眼）
    hx = cx - 11 + int(round(math.sin(ph * math.tau) * amp * 2.0))
    hy = 30 - coils * step + dy + 4 + int(round(math.sin((ph + 1) * math.tau) * amp))
    if d == 'side':
        hx -= 2# 侧向：头前伸
    elif d == 'up':
        hy -= 2              # 上冲：头抬高
    g.r(hx, hy, 6, 4, col)
    g.p(hx + 1, hy + 1, pg.EYE)
    g.p(hx + 4, hy + 1, pg.EYE)
    # 尾须
    g.r(cx - 10 + coils * 3, 28 + int(round(math.sin(ph * math.tau) * amp * 1.5)), 2, 3, col)


def draw_shell(g, spec, cx, dy, pose, d):
    """壳形族：圆壳 + 尖刺或双螯。剪影特征 = 半球 + 外突结构。"""
    col = spec['top']
    hw = spec.get('hw', 9)
    ty = 8 + dy
    # 动画：ext = 蓄力/开合幅度；甲壳类靠"壳体压扁 + 外突结构张开"表达发力
    ext = pose.get('ext', 0.0)
    sq = pose.get('sq', 0.0)
    _, sq_, st_, _ = _dir_bias(pose, d)
    cx = cx + int(round(sq * 2))                 # 整体横向摇（游走）
    hw = int(round((hw + ext * 1.5) * sq_))
    ty = 8 + dy + int(round(ext * 1.2))# 蓄力时下沉
    # 半球壳
    g.e(cx - hw, ty, cx + hw, ty + hw * 2, col)
    # 内壳凹面（朝向偏移：背向时凹面压到顶部 → 读作"壳背朝我"）
    off = 0 if d != 'up' else -4
    g.e(cx - hw + 3, ty + 5 + off, cx + hw - 3, ty + hw * 2 + 3 + off,
        mixhex(col, 0.7))
    # 尖刺（数量可辨）
    spikes = spec.get('spikes', 0)
    for i in range(spikes):
        sx = cx - hw + 2 + i * (2 * hw - 4) // max(1, spikes - 1)
        for k in range(4):
            g.p(sx, ty - 1 - k, col)            # 壳顶向上刺
    # 双螯（可选：船型）
    if spec.get('claws'):
        for s in (-1, 1):
            # 螯随 ext 张开（左右外扩 + 上下错位）
            ax = cx + s * int(round(hw + 3 + ext * 2))
            ay = ty + 8 - int(round(ext * 2))
            g.r(ax - 2, ay, 4, 6, col)
            g.r(ax - 3, ay - 2 + int(round(ext * 3)), 6, 2, mixhex(col, 0.85))  # 螯尖
    # 底部足
    g.r(cx - 4, 28, 3, 2, mixhex(col, 0.8))
    g.r(cx + 1, 28, 3, 2, mixhex(col, 0.8))


def draw_school(g, spec, cx, dy, pose, d):
    """鱼群族：密集三角群，无单体。剪影特征 = 一团密集小三角构成的菱形块。

    第一版的问题：体量太小（半径2.2~9.7），在32px 网格里只占 1/4，
    弹幕中太小看不清。修正为占屏约 2/3（半径 3~13）。
    """
    col = spec['top']
    n = int(spec.get('density', 11))
    gold = 2.39996                             # 黄金角，避免规则排布
    ph = pose.get('t', 0.0)
    sq = pose.get('sq', 0.0)
    _, sq_, st_, _ = _dir_bias(pose, d)
    # 鱼群的**朝向读法**：横向切入 → 拉成横队；向上冲 → 挤成纵队
    ax = 1.0 if d == 'side' else 0.62
    ay = 0.55 if d == 'side' else 1.0
    # 鱼群语义：**整群同步**（同相位），只有极小的个体异相 —— 这是它与
    # serpent（行波）的本质区别，玩家能靠运动方式区分这两个兵种。
    for i in range(n):
        ang = i * gold
        rad = 3.0 + (i / max(1, n - 1)) * 10.0  # 3~13，占屏 2/3
        micro = math.sin((ph + i * 0.05) * math.tau) * 0.5 * pose.get('amp', 0.0)
        fx = cx + int(math.cos(ang) * rad * ax * sq_ + sq + micro)
        fy = 16 + int(math.sin(ang) * rad * 0.66 * ay * st_ + sq * 0.35)
        # 每条鱼 = 2px 高的小三角（横置）
        fc = col if i % 3 else mixhex(col, 0.82)  # 轻微色阶 → 群体感
        g.r(fx, fy, 4, 2, fc)
        g.p(fx - 1, fy, fc)                       # 尾
    # 核心团块（更密，形成实体感）
    ox = int(round(sq))
    oy = int(round(sq * 0.35))
    cw2 = int(round(11 * (ax if d == 'side' else 0.72)))
    g.r(cx - cw2 // 2 + ox, 14 + oy, cw2, 6, mixhex(col, 0.92))
    g.r(cx - cw2 // 2 + 2 + ox, 13 + oy, max(3, cw2 - 4), 3, col)


def draw_leviathan(g, spec, cx, dy, pose, d):
    """巨兽族：巨大阴影占屏 1/4。剪影特征 = 体量 + 触手 + 巨口。"""
    col = spec['top']
    ext = pose.get('ext', 0.0)
    ph = pose.get('t', 0.0)
    amp = pose.get('sq', 0.0)
    _, sq_, st_, _ = _dir_bias(pose, d)
    amp *= 1.5 if d == 'side' else 0.8# 侧向甩得更开
    # 巨躯（几乎填满上半屏）—— ext 驱动"吸气膨胀"，慢周期
    hw = int(round((14 + ext * 1.2) * sq_))
    g.e(cx - hw, 2 + dy, cx + hw, 20, col)
    g.e(cx - 9, 0 + dy + int(round(ext * 0.8)), cx + 9, 8 + dy, col)   # 头顶隆起
    # 巨口（内部挖空）
    # 巨口：朝下时在躯体下部（张口扑来），朝上时移到顶部（背向），侧向时压扁居中
    mo = 0
    mw = 8
    if d == 'up':
        mo = -9
    elif d == 'side':
        mw = 10
        mo = 0
    g.e(cx - mw, 10 + dy + mo + int(round(ext)), cx + mw,
        18 + dy + mo + int(round(ext)), mixhex(col, 0.55))
    # 眼（发光）
    ey = 7 + dy + (0 if d != 'up' else -3)
    ex = 6 if d != 'side' else 9
    g.r(cx - ex, ey, 3, 2, pg.EYE_LIGHT)
    g.r(cx + ex - 2, ey, 3, 2, pg.EYE_LIGHT)
    # 粗触手（4条，明显更粗）
    # 触手：每条一个相位（i*0.25），摆幅沿长度递增 → 大幅鞭甩
    for i in range(4):
        for k in range(10):
            wob = int(round(math.sin((ph + i * 0.25 + k * 0.09) * math.tau) * amp * (k * 0.22)))
            tx = cx - 12 + i * 8 + wob
            w = 3 if k < 6 else 2
            g.r(tx, 20 + k, w, 1, col if k < 6 else mixhex(col, 0.85))


# --------------------------------------------------------------------------
# 方向：深海生物没有正面背面，所以**不做图像翻转**，改用运动方式表达方向
#
# 这是本项目最重要的方向方案（详见 docs/朝向决策.md 与上线标准评估 §4.3）：
#   down  朝向玩家（向下俯冲）  → 形体压低、前倾、纵向拉伸
#   up    背向玩家（向上逃逸）  → 形体拉长、纵向收缩（游走加速）
#   side  横向切入             → 形体横向压扁 + 侧倾（横向游动）
#
# 如果三个方向画成一模一样，玩家就分不清敌人在冲还是在撤——
# 成建制列阵的包抄可读性直接失效。
# --------------------------------------------------------------------------

def _dir_bias(pose, d):
    """把方向翻译成 (dy, 横压扁, 纵拉伸, 侧倾) 四个通用偏移。

    各族 draw 函数取用自己关心的部分。
    """
    dy = pose.get('dy', 0)
    squash = 1.0     # 横向压扁系数
    stretch = 1.0   # 纵向拉伸系数
    lean = 0# 侧倾（横向位移随高度递增）
    if d == 'down':
        squash, stretch, lean = 0.94, 1.06, 0   # 压低、前倾
    elif d == 'up':
        squash, stretch, lean = 1.06, 0.94, 0   # 拉长、加速上冲
    elif d == 'side':
        squash, stretch, lean = 1.10, 0.92, 1    # 压扁 + 侧倾
    return dy, squash, stretch, lean


FAMILY = {
    'bell':      draw_bell,
    'tower':     draw_tower,
    'serpent':   draw_serpent,
    'shell':     draw_shell,
    'school':    draw_school,
    'leviathan': draw_leviathan,
}


def mixhex(h, f):
    return pg.mixhex(h, f)


# --------------------------------------------------------------------------
# 原型单位表：8 个深海兵种，逐个指定剪影族与特征参数
# --------------------------------------------------------------------------
#护甲色（与美术资源计划 theme.ts 一致）
A_GEL = '#4fe8ff'    # 胶质- 青
A_SCA = '#7fffd4'    # 鳞甲 - 青绿
A_CAL = '#ffd700'    # 钙壳 - 金
A_BON = '#ff4fd8'    # 骨质 - 品红
GLOW = '#ffffff'    # 发光体

PROTO = {
    # ---- 普通兵种 8 ----
    'gelatin':   dict(family='bell',      top=A_GEL, hw=9,  bell_h=12, tentacles=4,
                      name='胶质漂群'),
    'jelly':     dict(family='bell',      top=A_GEL, hw=13, bell_h=10, tentacles=5,
                      name='电水母群', glow=True),
    'scale':     dict(family='school',    top=A_SCA, density=9, name='鳞甲鱼群'),
    'calcium':   dict(family='tower',     top=A_CAL, towers=3, name='钙壳管虫'),
    'bone':      dict(family='serpent',   top=A_BON, coils=3, name='骨质触手'),
    'angler':    dict(family='shell',     top=A_GEL, hw=8,  spikes=0, claws=False,
                      name='光诱鮟鱇', glow=True),
    'guard':     dict(family='shell',     top=A_BON, hw=10, spikes=3, claws=True,
                      name='骨甲近卫'),
    'levy':      dict(family='leviathan', top=A_CAL, name='巨兽幼体', glow=True),
}


def build_proto(spec):
    """渲染原型单位的一帧（朝下·待机），返回 RGBA 图。"""
    g = pg.G()
    cx = 16
    dy = 0
    pose = {'dy': 0, 'sw': 0, 'll': 0, 'rl': 0, 'fo': 0, 'bo': 0}
    FAMILY[spec['family']](g, spec, cx, dy, pose, 'down')

    # 发光体：在实体下方垫一层外扩的半透明光晕，再叠实体。
    # 关键：光晕是**独立图层**并用实体色染色，纯黑剪影检查时会被排除
    #（to_mask 只看 alpha 阈值），所以不会污染剪影 IoU 的判定。
    if not spec.get('glow'):
        return pg.outlined(g.im)

    solid = pg.outlined(g.im)                              # 实体 + 描边
    a = solid.getchannel('A').filter(pg.ImageFilter.MaxFilter(7))
    halo = Image.new('RGBA', solid.size, spec['top'])      # 用生物色染色
    halo.putalpha(a.point(lambda v: int(v * 0.30)))# 降低透明度 →柔光
    out = Image.alpha_composite(halo, solid)

    # 光晕会吃掉描边（深色描边被半透明光晕覆盖 → 边界变软）。
    # 深海背景下单位必须"边界硬"，否则弹幕中糊成一片。
    # 修法：在光晕之上再叠一次描边环（只保留描边本身，不重复实体）。
    core = g.im                                             # 原始实体（无描边）
    core_out = pg.outlined(core)                            # 带描边
    a2 = core.getchannel('A').filter(pg.ImageFilter.MaxFilter(3))
    ring = pg.ImageChops.subtract(a2, core.getchannel('A'))  # 纯描边环
    ring_layer = Image.new('RGBA', core.size, pg.OUTLINE)
    ring_layer.putalpha(ring)
    return Image.alpha_composite(out, ring_layer)


def main():
    out = os.path.join(pg.DOCS_DIR, '_silhouette')
    os.makedirs(out, exist_ok=True)

    items = []
    for uid, spec in PROTO.items():
        img = build_proto(spec)
        items.append({
            'key': uid, 'uid': uid, 'group': 'proto',
            'name': spec['name'], 'build': spec['family'],
            'img': img, 'sil': sc.to_mask(img),
            'sig': sc.mask_signature(img),
            'w': img.size[0], 'h': img.size[1],
        })

    # 复用自检工具的分析与出图
    pairs, same, close, ok, stats, by_build = sc.analyse(items)
    print('=== 深海剪影族验证 ===')
    print(f'单位：{len(items)}  比对：{stats["pairs"]} 对')
    print(f'IoU 均值 {stats["mean"]:.3f}   最高 {stats["max"]:.3f}   最低 {stats["min"]:.3f}')
    print(f'撞车(≥0.82)：{stats["same"]}   相似(0.65~0.82)：{stats["close"]}   可区分(<0.65)：{stats["ok"]}')

    if same:
        print('\n撞车清单：')
        for v, a, b, _, _ in same[:10]:
            print(f'  {v:.3f}  {a} ↔ {b}')

    # 出图
    zoom = 4
    cell = pg.GRID * zoom
    pad = 10
    lab_w = 190
    head = 56
    row_h = cell + pad
    W = lab_w + cell + pad * 2
    H = head + len(items) * row_h + pad

    # 彩色版（深色背景，模拟实际游戏）
    imc = Image.new('RGBA', (W, H), pg.THEME_BG if hasattr(pg, 'THEME_BG') else (10, 18, 32, 255))
    dc = ImageDraw.Draw(imc)
    fb, fs, ft = pg.load_font(20), pg.load_font(13), pg.load_font(11)
    dc.text((16, 12), '深海剪影族 · 彩色版（深色游戏背景）',
            font=fb, fill=(232, 244, 255, 255))
    dc.text((16, 34), f'6 个族 / {len(items)} 个单位 · 纯发光，无描边依赖',
            font=ft, fill=(159, 179, 200, 255))

    # 剪影版
    ims = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    ds = ImageDraw.Draw(ims)
    ds.text((16, 12), '深海剪影族 · 纯黑1-bit 掩码', font=fb, fill=(20, 20, 24, 255))
    ds.text((16, 34), '与玩具兵版本对比：这里的轮廓是否互相可辨？',
            font=ft, fill=(110, 110, 118, 255))

    y = head
    for it in items:
        r = it['img'].resize((cell, cell), Image.NEAREST)
        dc.rectangle([lab_w, y, lab_w + cell, y + cell], outline=(40, 60, 80, 255))
        dc.text((14, y + cell // 2 - 20), it['name'], font=fs, fill=(232, 244, 255, 255))
        dc.text((14, y + cell // 2 - 4), f"{it['build']}", font=ft, fill=(255, 210, 127, 255))
        dc.text((14, y + cell // 2 + 12), f"{it['w']}x{it['h']}px", font=ft, fill=(120, 150, 175, 255))
        imc.paste(r, (lab_w, y), r)

        rs = it['sil'].resize((cell, cell), Image.NEAREST)
        ds.rectangle([lab_w, y, lab_w + cell, y + cell], outline=(200, 200, 205, 255))
        ds.text((14, y + cell // 2 - 20), it['name'], font=fs, fill=(20, 20, 24, 255))
        ds.text((14, y + cell // 2 - 4), f"{it['build']}", font=ft, fill=(110, 110, 118, 255))
        ds.text((14, y + cell // 2 + 12), f"{it['w']}x{it['h']}px", font=ft, fill=(120, 120, 128, 255))
        ims.paste(rs, (lab_w, y), rs)
        y += row_h

    fc = os.path.join(out, 'deepsea-color.png')
    fs_ = os.path.join(out, 'deepsea-silhouette.png')
    imc.save(fc)
    ims.save(fs_)
    print(f'\n输出：\n  {fc}\n  {fs_}')

    # 盲测
    qs = sc.human_test(items, same, close)
    bt = sc.build_human_test_sheet(qs, scale=3)
    fb_path = os.path.join(out, 'deepsea-blindtest.png')
    bt.save(fb_path)
    print(f'  {fb_path}')


if __name__ == '__main__':
    main()