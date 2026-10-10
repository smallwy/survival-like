#!/usr/bin/env python3.11
# -*- coding: utf-8 -*-
"""
深海剪影族 · 多帧动画可行性验证
================================

问题
----
`pixelgen.py:231 make_pose()` 的姿态系统完全建立在**人形**假设上：

    fo / bo  侧身前腿/后腿的水平位移（迈步）
    ll / rl  正面/背身左腿/右腿的抬起量
    dy       整体起伏

而深海生物**没有腿**（水母没有、管虫不动、触手软摆、鱼群整体游动）。
直接套用只会得到"整块图形上下抖动"——看起来像呼吸，实际像卡顿。

本脚本为 6 个族各自设计**符合运动方式的动画语言**，并输出完整图集
（3 方向 × 3 动作，与 pixelgen 的 COLS=4 / ROWS=9 规格一致），
验证"程序化生成非人形多帧动画"在 32px 硬边约束下可行。

动画语言设计
------------
    bell      伞盖脉动（伞盖宽度 + 触手相位滞后）—— 水母的钟状收缩
    tower     管体依次伸长（相位错开的正弦）—— 钙壳管虫的伸缩
    serpent   波形沿体长传递（相位差 = f * 0.9rad）—— 触手/鳗鱼游动
    school    整群一致性抖动（无相位差）—— 鱼群受惊的同步反应
    shell     整体前倾 + 双螯开合—— 甲壳冲刺前的蓄力
    leviathan 躯干缓慢起伏 + 触手大幅摆动 —— 巨兽的呼吸

输出（docs/_silhouette/）
    anim-sheets.png        6 族完整图集（照搬生产规格）
    anim-strip.png         idle 4 帧 / walk 4 帧 / attack 3 帧 逐帧并排
    anim-bullets.png       实机 96px、walk 动画第2 帧的弹幕场景
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw
import pixelgen as pg
import deepsea_family_proto as dsp
import silhouette_check as sc

OUT = os.path.join(pg.DOCS_DIR, '_silhouette')
CELL = pg.GRID                 # 32
COLS = pg.COLS                 # 4
ROWS = 9                # 3 方向 × 3 动作
PX_SCALE = 3                   # GameScene.ts:63
VIEW = CELL * PX_SCALE         # 96px
FRAMES = {'idle': 4, 'walk': 4, 'attack': 3}   # 本验证统一 idle=4 以便展示脉动


# --------------------------------------------------------------------------
# 姿态：每个族一套动画语言
# --------------------------------------------------------------------------

def deepsea_pose(family, act, f, d='down'):
    """返回该族在该帧的动画参数。

    字段与 pixelgen.make_pose 对齐（dy/sw/atk 直接复用），
    新增 t（族内相位）与 sq（横向摆幅），由各族的 draw 函数消费。
    """
    n = FRAMES[act]
    # amp 统一门控所有摆动项：amp=0 时输出退化为静态原型（已做回归验证）
    p = dict(dy=0, sw=0, atk=0, t=0.0, sq=0.0, ext=0.0, amp=0.0)
    # 归一化相位：0..1 循环
    t = f / n

    if family == 'bell':
        # 伞盖脉动：收缩-舒张-收缩。触手相位滞后 1/4 拍
        if act == 'idle':
            k = math.sin(t * math.tau - math.pi / 2)          # -1..1
            p['ext'] = k                                        # 伞盖宽度变化
            p['t'] = (t + 0.25) % 1.0                           # 触手滞后
            p['dy'] = int(round(k * 0.5))
            p['amp'] = 1.0
        elif act == 'walk':
            # 靠伞盖倾斜漂移推进：左右轻摆 + 上下浮
            k = math.sin(t * math.tau - math.pi / 2)
            p['sq'] = k
            p['dy'] = int(round(k * 1.2))
            p['ext'] = k * 0.6
            p['t'] = (t + 0.25) % 1.0
            p['amp'] = 1.2
        else:  # attack —— 触手猛然收紧并向下抽
            seq = (-0.4, 1.0, 0.2)
            p['ext'] = seq[f]
            p['t'] = (f / 3 + 0.25) % 1.0
            p['amp'] = 1.4
            p['atk'] = f + 1

    elif family == 'tower':
        # 管体依次伸长：相邻管相位差 0.18
        if act == 'idle':
            p['t'] = t
            p['ext'] = math.sin(t * math.tau - math.pi / 2) * 0.6
            p['amp'] = 1.0
        elif act == 'walk':
            p['t'] = t
            p['ext'] = math.sin(t * math.tau - math.pi / 2)
            p['sq'] = math.sin(t * math.tau - math.pi / 2) * 0.5
            p['amp'] = 1.0
        else:
            p['t'] = t
            p['ext'] = (0.4, 1.4, 0.5)[f]
            p['amp'] = 1.3
            p['atk'] = f + 1

    elif family == 'serpent':
        # 波形沿体长传递：这是"游动"的核心表达
        if act == 'idle':
            p['t'] = t
            p['sq'] = 0.35
            p['dy'] = int(round(math.sin(t * math.tau) * 0.5))
            p['amp'] = 0.8
        elif act == 'walk':
            p['t'] = t
            p['sq'] = 1.0# 大幅波动 = 前进
            p['dy'] = int(round(math.sin(t * math.tau - math.pi / 2)))
            p['amp'] = 1.0
        else:
            p['t'] = (f / 3 + 0.15) % 1.0
            p['amp'] = 1.5
            p['sq'] = 1.4                # 攻击时甩得更狠
            p['atk'] = f + 1

    elif family == 'school':
        # 鱼群：整群**同步**抖动（无相位差）—— 这是它与 serpent 的语义区别
        if act == 'idle':
            k = math.sin(t * math.tau - math.pi / 2)
            p['sq'] = k * 0.3
            p['dy'] = int(round(k))
            p['amp'] = 1.0
        elif act == 'walk':
            k = math.sin(t * math.tau - math.pi / 2)
            p['sq'] = k * 0.9
            p['dy'] = int(round(k * 1.5))
            p['t'] = t                    # t 在 school 中表示"群内个体微异相"
            p['amp'] = 1.0
        else:
            # 鱼群受惊：整群**猛冲**一段距离（sq 是群体级位移，不是内部抖动）
            p['sq'] = (2.2, -1.2, 0.0)[f]
            p['amp'] = 1.3
            p['dy'] = (-1, 1, 0)[f]
            p['atk'] = f + 1

    elif family == 'shell':
        # 甲壳：整体前倾 + 双螯开合
        if act == 'idle':
            # 甲壳待机也不是静止：鞘状步足的小幅起伏 + 壳体极轻的呼吸
            k = math.sin(t * math.tau - math.pi / 2)
            p['ext'] = k * 0.5
            p['sq'] = k * 1.3
            p['dy'] = int(round(math.sin(t * math.tau) * 0.9))
            p['amp'] = 1.0
        elif act == 'walk':
            # 甲壳不会"走"，靠**左右摇摆 + 上下点浮**模拟横向游走
            p['ext'] = 0.4
            p['sq'] = math.sin(t * math.tau - math.pi / 2) * 1.6
            p['dy'] = int(round(math.sin(t * math.tau * 2) * 0.9))
            p['amp'] = 1.0
        else:
            p['ext'] = (0.2, 1.5, 0.4)[f]
            p['amp'] = 1.4
            p['atk'] = f + 1

    elif family == 'leviathan':
        # 巨兽：躯干慢呼吸（周期是其他族的 2 倍）+ 触手大幅摆动
        if act == 'idle':
            p['ext'] = math.sin(t * math.tau/ 2 - math.pi / 2) * 0.8
            p['sq'] = math.sin(t * math.tau - math.pi / 2) * 1.2
            p['dy'] = int(round(math.sin(t * math.tau / 2) * 0.8))
            p['amp'] = 1.4
        elif act == 'walk':
            p['ext'] = math.sin(t * math.tau / 2 - math.pi / 2) * 0.5
            p['sq'] = math.sin(t * math.tau - math.pi / 2) * 2.0
            p['dy'] = int(round(math.sin(t * math.tau / 2) * 1.2))
            p['amp'] = 1.6
        else:
            p['ext'] = (0.3, 1.6, 0.6)[f]
            p['amp'] = 1.8
            p['sq'] = math.sin(f / 3 * math.tau) * 2.2
            p['atk'] = f + 1
    return p


def build_frame(spec, act, f, d='down'):
    """渲染深海单位的一帧（族动画语言 + 光晕）。"""
    fam = spec['family']
    g = pg.G()
    pose = deepsea_pose(fam, act, f, d)
    dsp.FAMILY[fam](g, spec, 16, pose['dy'], pose, d)

    if not spec.get('glow'):
        return pg.outlined(g.im), pose

    solid = pg.outlined(g.im)
    a = solid.getchannel('A').filter(pg.ImageFilter.MaxFilter(7))
    halo = Image.new('RGBA', solid.size, spec['top'])
    halo.putalpha(a.point(lambda v: int(v * 0.30)))
    out = Image.alpha_composite(halo, solid)
    core = pg.outlined(g.im)
    a2 = g.im.getchannel('A').filter(pg.ImageFilter.MaxFilter(3))
    ring = pg.ImageChops.subtract(a2, g.im.getchannel('A'))
    rl = Image.new('RGBA', g.im.size, pg.OUTLINE)
    rl.putalpha(ring)
    return Image.alpha_composite(out, rl), pose


def build_sheet(spec):
    """照搬 pixelgen.build_sheet 的规格：COLS=4 × ROWS=9。"""
    sheet = Image.new('RGBA', (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    for di, d in enumerate(pg.DIRS):
        for ai, act in enumerate(pg.ACTS):
            row = di * len(pg.ACTS) + ai
            for f in range(FRAMES[act]):
                img, _ = build_frame(spec, act, f, d)
                sheet.paste(img, (f * CELL, row * CELL))
    return sheet


# --------------------------------------------------------------------------

def main():
    os.makedirs(OUT, exist_ok=True)
    specs = dict(dsp.PROTO)

    # --- A. 图集总览 ---
    zoom = 3
    labw, head, pad = 150, 66, 12
    cw = CELL * zoom
    # 9 行全画：3 方向 × 3 动作（此前只画 down 的 3 行，三方向补完后必须全览）
    W = labw + cw * ROWS + pad * 2
    H = head + len(specs) * (cw + 46) + pad
    ov = Image.new('RGBA', (W, H), (6, 10, 17, 255))
    d = ImageDraw.Draw(ov)
    fb, fs, ft = pg.load_font(20), pg.load_font(14), pg.load_font(11)
    d.text((16, 12), '深海剪影族 · 完整动画图集', font=fb, fill=(234, 244, 255, 255))
    d.text((16, 36), f'生产规格：COLS={COLS} × ROWS={ROWS}（3 方向 × 3 动作）· cell={CELL} · '
                     f'zoom=1 · GameScene PX_SCALE={PX_SCALE} → 实机 {VIEW}px',
           font=ft, fill=(140, 162, 185, 255))

    y = head
    for key, spec in specs.items():
        sh = build_sheet(spec)
        d.text((14, y + 6), spec['name'], font=fs, fill=(228, 240, 252, 255))
        d.text((14, y + 24), f"{spec['family']}", font=ft, fill=(120, 150, 168, 255))
        # 9 行全展：行 r = 方向序*3 + 动作序
        for r in range(ROWS):
            strip = sh.crop((0, r * CELL, COLS * CELL, r * CELL + CELL))
            big = strip.resize((cw, cw), Image.NEAREST)
            bx = labw + r * (cw + 3)
            ov.paste(big, (bx, y))
            dirn = pg.DIRS[r // len(pg.ACTS)]
            d.text((bx + 3, y + 2), f'{dirn}/{pg.ACTS[r % len(pg.ACTS)]}',
                   font=ft, fill=(255, 255, 255, 210))
        y += cw + 46
    ov.convert('RGB').save(os.path.join(OUT, 'anim-sheets.png'))

    # --- B. 逐帧 strip（idle/walk/attack 三个动作展开）---
    acts = ['idle', 'walk', 'attack']
    colw = CELL * 2 + 14
    SW = 210
    SH = 62 + len(specs) * (len(acts) * (CELL * 2) + 34)
    strip = Image.new('RGBA', (SW + len(acts) * (FRAMES['idle'] * colw) + 20, SH), (7, 11, 18, 255))
    ds = ImageDraw.Draw(strip)
    fs2, fa = pg.load_font(15), pg.load_font(12)
    ds.text((16, 12), '逐帧动画 · 每族的动作语言', font=fs2, fill=(234, 244, 255, 255))
    ds.text((16, 34), 'idle=4帧（脉动/呼吸）· walk=4 帧（位移方式）· attack=3 帧（出手）',
            font=pg.load_font(11), fill=(140, 162, 185, 255))
    y = 62
    for key, spec in specs.items():
        ds.text((16, y + CELL), spec['name'][:7], font=fa, fill=(228, 240, 252, 255))
        ds.text((16, y + CELL + 16), spec['family'], font=fa, fill=(120, 150, 168, 255))
        x = SW
        for act in acts:
            for f in range(FRAMES[act]):
                img, _ = build_frame(spec, act, f)
                big = img.resize((CELL * 2, CELL * 2), Image.NEAREST)
                strip.paste(big, (x, y), big)
                ds.rectangle([x, y, x + CELL * 2, y + CELL * 2], outline=(34, 50, 66, 255))
                ds.text((x + 2, y + CELL * 2 + 3), f'{act}{f}', font=pg.load_font(10),
                        fill=(110, 135, 155, 255))
                x += colw
            x += 8
        y += len(acts) * (CELL * 2) + 34
    strip.convert('RGB').save(os.path.join(OUT, 'anim-strip.png'))

    # --- C. 实机 96px + walk 第2 帧 + 弹幕 ---
    import realsize_check as rs
    canvas = rs.scene_bg()
    px, py = 1080 // 2, 650 // 2 + 40
    ring = rs.enemy_ring(px, py)
    keys = list(specs)
    for i, (x, y2) in enumerate(ring):
        k = keys[i % len(keys)]
        f = 1 + (i % 3)# 让相邻单位处于不同帧，模拟真实播放
        img, _ = build_frame(specs[k], 'walk', f)
        rs.place(canvas, img, x, y2)
    hero = rs.make_hero()
    rs.place(canvas, hero, px, py)
    canvas = rs.bullet_overlay(canvas).convert('RGB')
    rs.hero_ui(canvas, px, py)
    rs.caption(canvas, '实机 96px · walk 动画实拍',
               '相邻单位处于 walk 的不同帧 → 可以看到各自独立的运动相位，群体不再"齐步走"')
    canvas.save(os.path.join(OUT, 'anim-bullets.png'))

    # --- D. 量化：动画是否真的动了（帧间差异）---
    #
    # 指标选择说明（踩过的坑）：
    # silhouette_check.mask_signature 会先 trim 包围盒再归一化到 32x32，
    # 这对"两个不同物种是否撞脸"是对的，但对"同一物种相邻帧差多少"是错的
    # —— 纯位移会被归一化完全抵消，IoU 恒等于 1.000，看起来像"没动"。
    # 动画必须用**未裁剪、固定画布**的掩码。
    def raw_sig(img):
        a = sc.to_mask(img).getchannel('A')
        return [[1 if a.getpixel((x, y)) >= 128 else 0 for x in range(pg.GRID)]
                for y in range(pg.GRID)]

    print('=== 动画帧间差异（相邻帧 IoU，未裁剪掩码；越低=动得越明显）===')
    print(f'{"单位":<10}{"族":<11}{"idle":>8}{"walk":>8}{"attack":>9}')
    tot = {'idle': [], 'walk': [], 'attack': []}
    for key, spec in specs.items():
        row = [spec['name'][:8]]
        for act in ['idle', 'walk', 'attack']:
            sigs = [raw_sig(build_frame(spec, act, f)[0]) for f in range(FRAMES[act])]
            ious = [sc.iou(sigs[i], sigs[i + 1]) for i in range(len(sigs) - 1)]
            m = sum(ious) / len(ious)
            tot[act].append(m)
            row.append(f'{m:.3f}')
        print(f'{row[0]:<10}{spec["family"]:<11}{row[1]:>8}{row[2]:>8}{row[3]:>9}')
    print('-' * 46)
    print(f'{"均值":<21}' + ''.join(f'{sum(tot[a])/len(tot[a]):>8.3f}' if a != 'attack'
                                else f'{sum(tot[a])/len(tot[a]):>9.3f}' for a in
                                ['idle', 'walk', 'attack']))
    print('\n输出目录：', os.path.normpath(OUT))


if __name__ == '__main__':
    main()