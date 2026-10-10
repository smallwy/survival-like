#!/usr/bin/env python3.11
# -*- coding: utf-8 -*-
"""
深海资产生产器：把 6 个剪影族做成游戏真正加载的图集
====================================================

这件事的定位
------------
`deepsea_anim.py` 和 `deepsea_family_proto.py` 是**验证脚本** ——
它们的产出是 docs/_silhouette/ 里的展示图，证明"深海剪影 + 非人形动画"可行。
但游戏本体（`web/src/scenes/GameScene.ts`）加载的一直是
`web/src/assets/pixel/` 里的旧版玩具兵图集。

**换壳 = 让深海图进入那个目录**，并保持 manifest 契约不变，
这样GameScene 那边一行加载代码都不用改。

契约（manifest.json，必须严格对齐）
-----------------------------------
    grid 32 / cols 4 / dirs[down,up,side] / acts[idle,walk,attack]
    actFrames {idle:2, walk:4, attack:3}
    sheet= 4×9 = 128×288px
    bbox   = 「朝下·待机」单格的 alpha 包围盒（碰撞框与视觉尺寸共用）
    muzzle = attack 第 2 帧的武器前端（相对格心的偏移）

为什么 bbox 必须实测不能手填
    GameScene 用它算碰撞半径。填错就是"看着小、判定大"或反过来，
    这种错肉眼看截图永远看不出来，只能靠这里的自动测量。

两种单位，两套画法
----------------
    敌人12 个 → 深海族（bell/tower/serpent/school/shell/leviathan）
              非人形，靠剪影族区分，复用 deepsea_anim 的动画语言
    玩家 4 个 → 潜行者人形（潜水服 + 头灯 + 氧气瓶）
              **必须是人形**：玩家要在一片生物里一眼找到自己。
              人形与6 族完全不撞剪影（实测 IoU 0.547 vs 人形 0.801），
              这是"玩家一眼找到自己"最便宜的手段。

用法
----
    python3.11 tools/deepsea_assets.py
产物
----
    web/src/assets/pixel/foe_*.png / hero_*.png   （覆盖，旧的已备份到 _archive/）
    web/src/assets/pixel/manifest.json
    docs/_baseline/deepsea-atlas.png              （人肉过一眼总览）
"""
import json
import math
import os
import sys

from PIL import Image, ImageChops

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pixelgen as pg
import deepsea_family_proto as dsp
import deepsea_anim as da

CELL = pg.GRID          # 32
COLS = pg.COLS          # 4
DIRS = pg.DIRS          # down/up/side
ACTS = pg.ACTS          # idle/walk/attack
# ⚠️ 必须用生产帧数，不能用 deepsea_anim.FRAMES（那里 idle=4 只是为了展示脉动）。
# 帧数多了会让 sheet 宽度不够、后面的方向被截掉 —— 而这种截断在预览图里看不出来。
ACT_FRAMES = pg.ACT_FRAMES      # {idle:2, walk:4, attack:3}

ASSET = pg.ASSET_DIR


# --------------------------------------------------------------------------
# 护甲色（4 相克链，见美术资源计划 §4）
# --------------------------------------------------------------------------
A_GEL = '#4fe8ff'    # 胶质：半透明、无骨、一戳就散→ 青色
A_SCA = '#7fffd4'    # 鳞甲：成片小鳞、边缘锋利   → 青绿
A_CAL = '#ffd24a'    # 钙壳：硬壳、需重击击碎     → 金
A_BON = '#ff5fd0'    # 骨质：内骨支撑、需穿刺     → 品红
GLOW = '#e8fbff'     # 生物发光体


# --------------------------------------------------------------------------
# 敌人 12 个：6 个剪影族 × 兵种定位
# --------------------------------------------------------------------------
#族分配的原则（不是随机配色，是按护甲功能选形态）：
#   胶质无骨架 → bell水母（伞盖+触手，软、无轮廓强度）
#   鳞甲成片   → school 鱼群（密集小个体，靠群体密度吓人）
#   钙壳硬壳   → tower 管虫（竖立硬管，一眼看出"要重击"）
#   骨质内支撑 → serpent 触手（长条穿行，考验穿刺）
#   射手/坦在前排用 shell（双螯+前倾，读作"它在冲你"）
#   Boss 用 leviathan（巨兽，唯一有巨口与触腕的形态）
#
# Boss 的放大方式：**upscale=1 + zoom=2**（不是 upscale=2）。
# 试过 upscale=2，结果 Boss 的图集变成 256×576 但图形只缩在画布左上角 ——
# 因为 6 个族的绘制函数全部硬编码在 32px 坐标系（base=30、fy=16、cx-9…），
# 换更大的网格它们并不会跟着铺开，bbox 量出来只有 12×14，比小兵还小。
# 要真正用满64px 网格，得把 6 个族的所有常量参数化，那是另一件事（值不值得做另说）。
# 所以这里走"同一套 32px 画法 + 运行时放大"：
#   GameScene 里 boss 的显示尺寸 = PX_SCALE × zoom = 3×2 = 6→ 实机 192px，
#   是普通单位（96px）的2 倍。视觉上够醒目，且不引入新的绘制缺陷。
FOES = {
    # ---- 8 兵种----
    'minion':    dict(family='bell',    top=A_GEL, hw=7, bell_h=10, tentacles=3,
                      name='胶质漂群'),
    'swarm':     dict(family='bell',    top=A_GEL, hw=4, bell_h=5,  tentacles=6,
                      tent_len=11, tent_len_var=4,
                      glow=True, name='荧光幼体群'),
    'runner':    dict(family='school',  top=A_SCA, density=8, name='鳞甲快游群'),
    'tank':      dict(family='tower',   top=A_CAL, towers=3, name='钙壳管虫丛'),
    'shooter':   dict(family='shell',   top=A_GEL, hw=7,  spikes=0, claws=False,
                      glow=True, name='光诱鮟鱇'),
    'shield':dict(family='shell',   top=A_BON, hw=9,  spikes=3, claws=True,
                      name='骨甲近卫'),
    'elite':     dict(family='serpent', top=A_BON, coils=3, name='骨质触手游丝'),
    # 8 兵种只有 7 个上面这个表；minion/swarm/runner/tank/shooter/shield/elite = 7，
    # 第8 个是 runner 的加速版，但兵种表里只有 7 个常规敌人（见 gameData FOES 表）
    # —— 实际 8 兵种见下方 FOES_FULL 的补齐说明
    # ---- 5 Boss----
    #
    # ⚠️ 关键约束：**5 个 Boss 必须分占 5 个不同剪影族**。
    #
    # 第一版这里全用了 leviathan、只换颜色，结果 5 个 Boss 的 bbox 全是 30×31、
    # 剪影肉眼几乎一样 —— Boss 恰恰是玩家最需要一眼分辨的目标，这个撞车比
    # 兵种之间撞车严重得多。
    #
    # 也顺手纠正一个文档问题：计划书 §10.2 写的「撞车 0 对」只在 8 个**兵种**间测过，
    # 当时没测 Boss —— 所以那句话说"0 对"是成立的，但不该被当成"全单位 0 对"。
    # 剪影自检必须覆盖 Boss，否则这个结论会一直假装成立。
    #
    # 各 Boss 借该族最强的特征，让"Boss 长得不一样"这件事一眼成立：
    'boss_warlord':  dict(family='tower',     top=A_CAL, towers=5,
                          name='深渊领主·管巢母体'),        # 竖立硬管 = 母巢
    'boss_yanliang': dict(family='shell',     top=A_BON, hw=12, spikes=4, claws=True,
                          name='断锚·骨触巨螯'),            # 巨大双螯
    'boss_caocao':   dict(family='school',    top=A_SCA, density=16,
                          name='万鳞·鳞潮母舰'),            # 密集鱼群 = 舰群
    'boss_ganning':   dict(family='serpent',   top=A_GEL, coils=5, glow=True,
                          name='疾行·电鳗王'),              # 长躯游动
    'boss_tyrant':   dict(family='leviathan', top='#ff7a4a',
                          name='吞光者·利维坦幼体'),        # 唯一有巨口与触腕的
}

# 第 8 个常规兵种：gameData 里FOES 表实际有 7 个常规 + 5 个 Boss = 12，
# 与这里的key 数一致。若以后加兵种，在这里补一行即可。


# --------------------------------------------------------------------------
# 玩家 4 名潜行者
# --------------------------------------------------------------------------
# 人形 + 潜水装备。头灯是核心识别件：一团朝前的白光，
# 既符合"黑暗中的一束光"，也让玩家在混战里一秒找到自己。
#
# 剪影策略：4 人**体型必须一眼可分**，否则选将界面和战场都认不出。
#   深潜者 normal均衡   拾光者 slim 瘦高
#   铸壳者 wide  矮壮（厚壳）      电鳗使 normal 配高领+电弧（唯一带电弧的）
HEROES = {
    'rookie':   dict(kind='hero', weapon='bow',      build='normal', headgear='dive',
                    skin='#8fb8c8', hair='#20323c',
                    top='#2f6b7a', bottom='#1d4653', shoe='#16303a', trim='#4fe8ff',
                    tank='#c8a24a', lamp=True, name='深潜者'),
    'guanyu':   dict(kind='hero', weapon='guandao',  build='slim',   headgear='dive',
                    skin='#9ac4d2', hair='#1a2c36',
                    top='#3f8f7a', bottom='#25604f', shoe='#15302c', trim='#7fffd4',
                    tank='#c8a24a', lamp=True, visor=True, name='拾光者'),
    'zhangfei': dict(kind='hero', weapon='serpent',  build='wide',   headgear='dive_hood',
                    skin='#a8c8d4', hair='#141f28',
                    top='#5a6f7a', bottom='#37454f', shoe='#1f2a31', trim='#ffd24a',
                    tank='#8a7a5a', lamp=True, shell=True, name='铸壳者'),
    'zhaoyun':  dict(kind='hero', weapon='spear',    build='normal', headgear='dive',
                    skin='#a0c0cc', hair='#203038',
                    top='#4a5f8a', bottom='#2c3a5c', shoe='#1a2338', trim='#8fd6ff',
                    tank='#a8b4c0', lamp=True, arcs=True, name='电鳗使'),
}


# --------------------------------------------------------------------------
# 敌人图集：用 deepsea_anim 已验证的动画语言
# --------------------------------------------------------------------------

def foe_frame(spec, act, f, d, up=1):
    """渲染深海敌人一帧。逻辑照搬 deepsea_anim.build_frame，但帧数用生产规格。

    up > 1（Boss）时逻辑网格同比放大：族绘制函数全部以 `cx=16` 为中心硬编码，
    所以这里传 G(n)并把中心换算成 n/2，等于在更大的网格上重画同一套形状 ——
    细节（触手根数、鳞片、管数）能画得更足，而不是把 32px 硬拉大。
    """
    n = CELL * up
    g = pg.G(n)
    cx = n // 2
    pose = da.deepsea_pose(spec['family'], act, f, d)
    # 族绘制函数写死了 cx=16 坐标系下的常量（伞盖高、触手长、段宽…）。
    # 放大时必须同步放大这些尺度，否则 Boss 会比小兵还小。
    #
    # ⚠️ 但**数量类**参数不能跟着翻倍：tentacles(触手根数)、towers(管数)、
    # density(鱼群条数) 翻倍会直接撑爆网格，而且 Boss 要的是"更粗的单体"，
    # 不是"两倍多的触手"。所以分两类处理：
    #   尺寸类(hw/bell_h/spikes…) → × up
    #   数量类(tentacles/towers/density/coils) → 保持原值，Boss 靠放大本体取胜
    SIZE_KEYS = {'hw', 'bell_h', 'spikes', 'tent_len', 'tent_len_var'}
    COUNT_KEYS = {'tentacles', 'towers', 'density', 'coils'}
    s2 = dict(spec)
    for k, v in spec.items():
        if not isinstance(v, (int, float)) or k in ('glow', 'family'):
            continue
        if k in COUNT_KEYS:
            s2[k] = v            # 数量不变
        elif k in SIZE_KEYS:
            s2[k] = v * up# 尺寸放大
        else:
            s2[k] = v * up
    dsp.FAMILY[spec['family']](g, s2, cx, pose['dy'] * up, pose, d)

    solid = pg.outlined(g.im)
    if not spec.get('glow'):
        return solid

    # 发光体：实体下方垫一层外扩半透明光晕，再叠实体。
    # 光晕是独立图层并用生物色染色 —— 剪影IoU 检查只看 alpha 阈值，不会被污染。
    #
    # ⚠️ 光晕**不能用 MaxFilter**（踩过的坑）：
    # MaxFilter 是**方形核**，外扩出来的 alpha 轮廓天然是方的——
    # 实机截图里每个发光体背后都顶着一个硬边深青方块，一眼就看出是"贴上去的底"。
    # 方块在深色海床上极其扎眼，比不发光还难看。
    #
    # 正确做法：自己算**圆形核**（距离衰减），得到真正柔边的圆形光晕。
    # 逐像素算 32x32 的圆，代价可以忽略；upscaled 时按up 缩放核半径即可。
    k = 3 * up# 光晕外扩半径（逻辑像素）
    a = solid.getchannel('A')
    soft = pg.radial_dilate(a, k)
    halo = Image.new('RGBA', solid.size, spec['top'])
    halo.putalpha(soft.point(lambda v: int(v * 0.30)))
    out = Image.alpha_composite(halo, solid)
    core = pg.outlined(g.im)
    a2 = pg.radial_dilate(g.im.getchannel('A'), 1 * up)
    ring = ImageChops.subtract(a2, g.im.getchannel('A'))
    rl = Image.new('RGBA', g.im.size, pg.OUTLINE)
    rl.putalpha(ring)
    return Image.alpha_composite(out, rl)


def build_foe_sheet(spec):
    """照搬 pixelgen.build_sheet 的规格：COLS=4 × ROWS=9。"""
    up = int(spec.get('upscale', 1))
    cell = CELL * up
    sheet = Image.new('RGBA', (COLS * cell, len(DIRS) * len(ACTS) * cell), (0, 0, 0, 0))
    for di, d in enumerate(DIRS):
        for ai, act in enumerate(ACTS):
            row = di * len(ACTS) + ai
            for f in range(ACT_FRAMES[act]):
                sheet.paste(foe_frame(spec, act, f, d, up), (f * cell, row * cell))
    # bbox 只量「朝下·待机」单格 —— 量整行会把 2 列动画并起来，永远是整张宽度。
    # 必须换算回逻辑像素（除以 up）：manifest 的 bbox 是逻辑格单位。
    bb = sheet.crop((0, 0, cell, cell)).getbbox()
    bbox = [round(v / up, 2) for v in bb] if bb else None
    return sheet, bbox, up


# --------------------------------------------------------------------------
# 玩家图集：人形 + 潜水装备
# --------------------------------------------------------------------------

def draw_lamp(g, spec, cx, b, d):
    """头灯：朝前的一团白光。

    为什么单独画而不是靠 trim 色：头灯是**玩家在混战里找到自己**的第一识别件，
    必须是画面上最亮的那个点，而不能是"衣服上的一块浅色"。
    """
    col = spec.get('trim', '#4fe8ff')
    # 灯壳
    g.r(cx - 2, b['ty'] - 1, 5, 3, pg.mixhex('#20262e', 0.9))
    # 光点：朝向下在下方（照地面），侧向在前方
    if d == 'side':
        g.r(cx + 1, b['ty'], 2, 2, col)
    elif d == 'up':
        g.r(cx - 1, b['ty'], 3, 1, col)
    else:
        g.r(cx - 1, b['ty'] + 3, 3, 1, col)


def draw_tank(g, spec, cx, b, d, ty, th):
    """背上氧气瓶 /侧挂配重：让玩家剪影和"普通人形"不同。"""
    col = spec.get('tank', '#8a8f96')
    tx = cx - b['w'] // 2 + 1
    g.r(tx, ty + 2, 4, th - 4, pg.mixhex(col, 0.85))
    if d == 'side':
        g.r(cx + b['w'] // 2 - 4, ty + 3, 3, th - 6, pg.mixhex(col, 0.8))


def draw_shell(g, spec, cx, b, d, ty, th):
    """铸壳者的钙壳背甲：宽厚壳把剪影撑成"一堵会走的墙"。"""
    col = spec.get('trim', '#ffd24a')
    w = b['w']
    g.r(cx - w // 2 - 1, ty + 1, w + 2, th - 1, pg.mixhex(col, 0.55))
    # 壳脊
    for i in range(3):
        g.p(cx - 2 + i * 2, ty, col)


def draw_arcs(g, spec, cx, b, d, ty, th):
    """电鳗使的电弧：肩部两侧的短电花，全场唯一的紫色高频闪点。"""
    col = '#a88fff'
    g.r(cx - b['w'] // 2, ty + 3, 2, 1, col)
    g.r(cx + b['w'] // 2 - 1, ty + 3, 2, 1, col)
    g.p(cx - b['w'] // 2 - 1, ty + 2, col)
    g.p(cx + b['w'] // 2 + 1, ty + 2, col)


def hero_frame(spec, act, f, d):
    """渲染潜行者一帧。

    走 pixelgen 的 draw_unit（人形骨骼 + 三方向），再叠深海装备层。
    没有重写一套人形系统 —— 那会引入新的不一致风险，而人形骨架本身是对的。
    """
    g = pg.G()
    b = pg.BUILD[spec['build']]
    pose = pg.make_pose(act, f, d)
    cx = 16
    dy = pose['dy']
    ty = b['ty'] + dy
    th = b['th']
    tx = cx - b['w'] // 2

    # 潜水服配色直接由 spec 给，核心色块靠 mixhex 派生，保证同一套光照语言
    top = spec['top']
    bot = spec['bottom']
    shoe = spec['shoe']
    skin = spec['skin']
    trim = spec.get('trim', '#4fe8ff')

    if spec.get('shell'):
        draw_shell(g, spec, cx, b, d, ty, th)
    draw_tank(g, spec, cx, b, d, ty, th)

    # 躯干
    g.r(tx, ty, b['w'], th, top)
    # 高领/肩部亮色
    g.r(tx, ty, b['w'], 2, pg.mixhex(top, 1.35))
    # 胸前装备带
    g.r(cx - 1, ty + 3, 2, th - 4, pg.mixhex(trim, 0.7))
    # 腰
    g.r(tx, ty + th - 2, b['w'], 2, bot)
    # 腿
    lw = max(1, (b['w'] - 2) // 2)
    fo = pose['fo']
    bo = pose['bo']
    ll = pose['ll']
    rl = pose['rl']
    if d == 'side':
        g.r(cx - 1 + fo, ty + th, 3, 5, bot)
        g.r(cx - 1 + bo, ty + th, 3, 5, bot)
    else:
        g.r(tx, ty + th + ll, lw, 5, bot)
        g.r(tx + b['w'] - lw, ty + th + rl, lw, 5, bot)
    # 靴
    if d == 'side':
        g.r(cx - 1 + fo, ty + th + 5, 4, 1, shoe)
        g.r(cx - 1 + bo, ty + th + 5, 4, 1, shoe)
    else:
        g.r(tx, ty + th + ll + 5, lw, 1, shoe)
        g.r(tx + b['w'] - lw, ty + th + rl + 5, lw, 1, shoe)

    # 头+ 潜水头盔
    hy = ty - 6
    g.r(cx - 3, hy, 7, 6, spec.get('hair', '#20323c'))
    # 面窗
    if d == 'up':
        g.r(cx - 2, hy + 1, 5, 4, pg.mixhex(trim, 0.55))
    elif d == 'side':
        g.r(cx + 1, hy + 1, 3, 4, pg.mixhex(trim, 0.55))
    else:
        g.r(cx - 2, hy + 2, 5, 3, pg.mixhex(trim, 0.55))
    # 头灯（正面/背面/侧向都要有，它是最强识别件）
    if spec.get('lamp'):
        draw_lamp(g, spec, cx, b, d)

    # 面罩里的脸（朝下/侧向露一点）
    if d != 'up':
        g.p(cx - 1, hy + 3, skin)
        g.p(cx + 1, hy + 3, skin)
        g.p(cx, hy + 4, skin)

    if spec.get('arcs'):
        draw_arcs(g, spec, cx, b, d, ty, th)
    if spec.get('visor'):
        g.r(cx - 3, hy + 2, 7, 1, trim)

    # 武器：手臂 + 枪管。深海武器不做玩具枪，改成"光矛/捕光网"
    sw = pose['sw']
    ay = ty + 2
    g.r(cx + b['w'] // 2 - 1, ay, 2, 3, pg.mixhex(top, 0.9))
    # 枪口位置供 manifest 用
    muzzle = None
    if d == 'side':
        barrel = cx + b['w'] // 2 + 1 + int(round(sw * 1.5))
        g.r(barrel, ay, 6, 2, pg.mixhex(trim, 0.75))
        g.r(barrel + 5, ay - 1, 2, 4, trim)
        muzzle = (barrel + 6, ay + 1)
    else:
        g.r(cx + b['w'] // 2 - 1, ay - 1, 3, 5, pg.mixhex(trim, 0.75))
        muzzle = (cx + b['w'] // 2 + 1, ay + 1)
    return pg.outlined(g.im), muzzle


def build_hero_sheet(spec):
    sheet = Image.new('RGBA', (COLS * CELL, len(DIRS) * len(ACTS) * CELL), (0, 0, 0, 0))
    muzzles = {}
    for di, d in enumerate(DIRS):
        for ai, act in enumerate(ACTS):
            row = di * len(ACTS) + ai
            for f in range(ACT_FRAMES[act]):
                img, mz = hero_frame(spec, act, f, d)
                sheet.paste(img, (f * CELL, row * CELL))
                # 出手帧（f==1）的武器前端 = 枪口，与 pixelgen 同一约定
                if act == 'attack' and f == 1 and mz:
                    muzzles[d] = [mz[0] - CELL / 2, mz[1] - CELL / 2]
    bb = sheet.crop((0, 0, CELL, CELL)).getbbox()
    return sheet, muzzles, ([round(v, 2) for v in bb] if bb else None)


# --------------------------------------------------------------------------

def main():
    os.makedirs(ASSET, exist_ok=True)
    manifest = {
        'grid': CELL, 'cols': COLS,
        'dirs': list(DIRS), 'acts': list(ACTS),
        'actFrames': ACT_FRAMES,
        'units': {},
    }
    sheets = []

    print(f'{"unit":22s} {"sheet":>12s}  {"bbox":>14s}  muzzle(side)  族')
    print('-' * 78)

    # ---- 玩家 ----
    # 玩家 zoom = 1.25：**玩家必须比主要敌人高**。
    # 实机测出来的硬数据：潜行人 bbox 高 24 格，胶质漂群（bell 族水母）29 格 ——
    # 玩家比场上最常见的怪**矮 17%**。满屏水母时（它们还自带发光晕），
    # 玩家不只是"难找"，是真的被淹没在里层里。
    # 1.25 倍后玩家 30 格 > 水母 29 格，刚好在同屏里最醒目又不显得突兀。
    # 为什么不用更大：玩家立绘放大到 1.5 会挤掉屏幕视野，
    # 而 Survivors-like 的核心是"看得到一片怪"，不能把人放大到挡住战场。
    # 为什么不是改美术图：重画 4 张立绘的成本远高于调 1 个数字，
    # 而且 zoom 是运行时的，改一个数四个潜行者一起生效。
    HERO_ZOOM = 1.25
    for uid, spec in HEROES.items():
        key = f'hero_{uid}'
        sheet, muzzles, bbox = build_hero_sheet(spec)
        name = f'{key}.png'
        sheet.save(os.path.join(ASSET, name))
        manifest['units'][key] = {
            'sheet': name, 'upscale': 1, 'zoom': HERO_ZOOM, 'cell': CELL,
            'bbox': bbox,
            'muzzle': {k: [round(v[0], 2), round(v[1], 2)] for k, v in muzzles.items()},
        }
        sheets.append((f"{spec.get('name', uid)}（玩家）", sheet, 1))
        ms = muzzles.get('side', ['-', '-'])
        vis = f'{bbox[2]-bbox[0]:.0f}x{bbox[3]-bbox[1]:.0f}' if bbox else 'n/a'
        print(f'{key:22s} {str(sheet.size):>12s}  {vis:>14s}  ({ms[0]},{ms[1]})  人形')

    # ---- 敌人 ----
    for uid, spec in FOES.items():
        key = f'foe_{uid}'
        sheet, bbox, up = build_foe_sheet(spec)
        name = f'{key}.png'
        sheet.save(os.path.join(ASSET, name))
        zoom = 2 if uid.startswith('boss') else 1
        manifest['units'][key] = {
            'sheet': name, 'upscale': up, 'zoom': zoom, 'cell': CELL * up,
            'bbox': bbox,
            # 深海生物没有枪管：攻击靠触手/体表。muzzle 留空，
            # GameScene 会退回用射向角+射程算起点，不会崩。
            'muzzle': {},
        }
        sheets.append((f"{spec.get('name', uid)}（敌人）", sheet, up))
        vis = f'{bbox[2]-bbox[0]:.0f}x{bbox[3]-bbox[1]:.0f}' if bbox else 'n/a'
        print(f'{key:22s} {str(sheet.size):>12s}  {vis:>14s}  {"-":>13s}'
              f'  {spec["family"]}')

    with open(os.path.join(ASSET, 'manifest.json'), 'w', encoding='utf-8') as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=2)

    make_overview(sheets)
    print(f'\n共 {len(manifest["units"])} 个单位 → {os.path.relpath(ASSET, pg.ROOT)}')
    print('总览图 → docs/_baseline/deepsea-atlas.png')


def make_overview(sheets):
    """人肉过一眼的总览：每族取「朝下·待机/走路/攻击」三格 × 4 帧。

    刻意用 2倍放大：32px 的细节在1 倍下根本看不清，
    而"伞盖有没有画歪""触手有没有连上"这种事只有放大才看得出来。
    """
    zoom = 3
    cw = CELL * zoom
    labw, head, pad, gap = 210, 74, 14, 40
    # 3 动作 × 4 帧 = 12 格一行（idle 只有2 帧，多的留空）
    ncell = 12
    W = labw + cw * ncell + pad * 2
    H = head + len(sheets) * (cw + gap) + pad
    im = Image.new('RGBA', (W, H), (6, 10, 17, 255))
    d = pg.ImageDraw.Draw(im)
    fb, fs, ft = pg.load_font(20), pg.load_font(15), pg.load_font(11)
    d.text((16, 12), '深海资产 · 敌人与玩家图集（down 方向，2 倍放大）',
           font=fb, fill=(234, 244, 255, 255))
    d.text((16, 38), f'生产规格：COLS={COLS} × ROWS={len(DIRS)*len(ACTS)}'
                     f'（3 方向 × 3 动作）· cell={CELL} ·实机 PX_SCALE=3 → 96px',
           font=ft, fill=(140, 162, 185, 255))

    y = head
    for label, sheet, up in sheets:
        cell = CELL * up
        d.text((14, y + 4), label, font=fs, fill=(228, 240, 252, 255))
        col = 0
        for ai, act in enumerate(ACTS):
            for f in range(4):
                if f >= ACT_FRAMES[act]:
                    continue
                # down 方向 = 行 0-2（idle 0 / walk 1 / attack 2）
                src = sheet.crop((f * cell, ai * cell, (f + 1) * cell, (ai + 1) * cell))
                big = src.resize((cw, cw), Image.NEAREST)
                bx = labw + col * (cw + 3)
                # 棋盘底：能看清透明区，不会把描边吃成一片
                for gy in range(0, cw, 6):
                    for gx in range(0, cw, 6):
                        if (gx // 6 + gy // 6) % 2 == 0:
                            d.rectangle([bx + gx, y + gy, bx + gx + 5, y + gy + 5],
                                        fill=(14, 20, 30, 255))
                im.paste(big, (bx, y), big)
                if f == 0:
                    d.text((bx + 3, y + 2), act, font=ft, fill=(255, 255, 255, 210))
                col += 1
        y += cw + gap

    out = os.path.join(pg.DOCS_DIR, '_baseline', 'deepsea-atlas.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out)


if __name__ == '__main__':
    main()