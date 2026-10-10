#!/usr/bin/env python3.11
# -*- coding: utf-8 -*-
"""
横屏 vs 竖屏 · 视野与注意力分布实测
===================================

背景
----
Steam 平台数据（2026-10 调研）已确定做横屏：

  ·同品类所有头部产品（Vampire Survivors / Brotato / Megabonk / Soulstone）
    **全部横屏**
  · Steam 上竖屏 Bullet Heaven 成功案例数 = **0**
  · Steam 桌面横屏分辨率占比 ~87%（16:9 + 16:10）
  · 竖屏获得 Steam Deck Verified 的公开案例 = **0**

但有一件事二手数据回答不了，必须自己算：

  **横屏和竖屏的可见面积完全相同（1920x1080 与 1080x1920 都是 225 格）。**

    横屏 1920x1080 → 20.0 x 11.2 格   玩家可横向拉开 20 格
    竖屏 1080x1920 → 11.2 x 20.0 格   玩家可纵向拉开 20 格

  也就是说：朝向不改变难度总量，只改变**注意力分布的方向**，
  以及**敌人生成点的分布密度**。

本脚本把这个差异量化出来，并输出两种朝向的实机对照图，
用来看"到底哪个更适合深海回响"。

要回答的具体问题
----------------
1. 敌人生成点在两种朝向下各自多密（矩形周长 vs 面积的关系）
2. 玩家在"长边"能拉开多远、在"短边"会被逼多紧
3. 深海题材的**水平层光**在横屏下是否为优势（宽视野 = 横向展开的生物荧光画）
4. 超宽屏（3440x1440）在横屏下的视野是否失控

输出（docs/_silhouette/）
    orientation-landscape.png   横屏实机模拟（含头灯照明）
    orientation-portrait.png    竖屏实机模拟
    orientation-compare.png     两者并排 + 关键指标对照
"""
import os
import sys
import math
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw
import pixelgen as pg
import deepsea_anim as da
import realsize_check as rs

OUT = os.path.join(pg.DOCS_DIR, '_silhouette')
PX_SCALE = 3
U = pg.GRID * PX_SCALE            # 96px

LANDSCAPE = (1920, 1080)          # Steam 主力分辨率
PORTRAIT = (1080, 1920)
ULTRAWIDE = (3440, 1440)


def scene(w, h, land=True):
    """近黑深海场景：头灯径向照明（椭圆，匹配画面比例）。"""
    bg = Image.new('RGBA', (w, h), (3, 5, 9, 255))
    px = bg.load()
    cx, cy = w / 2, h / 2
    rad_x, rad_y = w * 0.30, h * 0.30
    for y in range(h):
        for x in range(0, w, 2):
            d = math.hypot((x - cx) / rad_x, (y - cy) / rad_y)
            if d >= 1:
                continue
            a = (1 - d) ** 2.8
            r0, g0, b0, _ = px[x, y]
            px[x, y] = (r0 + int(a * 4), g0 + int(a * 16), b0 + int(a * 22), 255)
    for _ in range(int(w * h / 4000)):
        x, y = random.randrange(w), random.randrange(h)
        d = math.hypot((x - cx) / rad_x, (y - cy) / rad_y)
        if d >= 0.92:
            continue
        v = random.randrange(6, 18)
        r0, g0, b0, _ = px[x, y]
        px[x, y] = (min(255, r0 + v // 5), min(255, g0 + v), min(255, b0 + v), 255)
    return bg


def spawn_points(w, h, n, land=True, pad=70, seed=7):
    """复刻 GameScene:3231 的矩形周长出生算法。"""
    rnd = random.Random(seed)
    hw, hh = w / 2 + pad, h / 2 + pad
    pw, ph = hw * 2, hh * 2
    pts = []
    for _ in range(n):
        t = rnd.random() * (pw * 2 + ph * 2)
        if t < pw:
            pts.append((-hw + t, -hh))
        elif (t - (pw)) < pw:
            pts.append((hw - (t - pw), hh))
        elif (t - (pw * 2)) < ph:
            pts.append((-hw, -hh + (t - pw * 2)))
        else:
            tt = t - pw * 2 - ph
            pts.append((hw, hh - tt))
    return pts


def metrics(w, h):
    """朝向的核心指标。"""
    rw, rh = w / U, h / U
    long_side, short_side = max(rw, rh), min(rw, rh)
    # 敌人生成密度：周长/面积 = 敌人沿边界堆得有多密
    pad = 70
    perim = 2 * (w + h) + 8 * pad
    area = (w + 2 * pad) * (h + 2 * pad)
    # 注意力分布：单位面积对应的边界长度（越高=敌人越容易"同时从多边来"）
    return dict(
        grid=f'{rw:.1f} x {rh:.1f}',
        area=rw * rh,
        long=long_side, short=short_side,
        aspect=w / h,
        perim_per_area=perim / area * 100,
        # 短边方向的拥挤度：短边越小，单位时间被"贴脸"的概率越高
        short_pressure=area / short_side / 100,
    )


def render_inside(w, h, land, title, sub, path, n_foe=54, out_w=None):
    """敌**已在场内**的对照：直接看注意力分布，而不是看空画面。"""
    random.seed(20261010)
    canvas = scene(w, h, land)
    px, py = w / 2, h / 2
    hw, hh = w / 2, h / 2
    keys = list(da.dsp.PROTO)
    # 在可见区域内均匀撒点（模拟已进入视野的敌群）
    for i in range(n_foe):
        fx = random.random()
        fy = random.random()
        dx = (fx - 0.5) * 2 * (hw - U * 0.6)
        dy = (fy - 0.5) * 2 * (hh - U * 0.6)
        spec = da.dsp.PROTO[keys[i % len(keys)]]
        img, _ = da.build_frame(spec, 'walk', i % 4)
        img = img.resize((U, U), Image.NEAREST)
        canvas.paste(img, (int(px + dx - U / 2), int(py + dy - U / 2)), img)
    hero = rs.make_hero().resize((U, U), Image.NEAREST)
    canvas.paste(hero, (int(px - U / 2), int(py - U / 2)), hero)
    canvas = canvas.convert('RGB')
    if out_w and out_w != canvas.width:
        canvas = canvas.resize((out_w, int(canvas.height * out_w / canvas.width)),
                               Image.LANCZOS)
    d = ImageDraw.Draw(canvas)
    fb, ft = pg.load_font(26), pg.load_font(13)
    bar = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(bar).rectangle([0, 0, canvas.width, 60], fill=(8, 12, 20, 215))
    canvas.paste(bar, (0, 0), bar)
    d = ImageDraw.Draw(canvas)
    d.text((20, 8), title, font=fb, fill=(235, 246, 255, 255))
    d.text((20, 36), sub, font=ft, fill=(150, 174, 198, 255))
    m = metrics(w, h)
    d.text((canvas.width - 20, 36),
           f'可见 {m["grid"]} 格 · 短边 {m["short"]:.1f} 格',
           font=ft, fill=(120, 200, 225, 255))
    canvas.save(path)
    return m


def render(w, h, land, title, sub, path, n_foe=54, out_w=None):
    """out_w: 输出宽度（内部按真实分辨率渲染，再等比缩小）—— 保证指标是真实分辨率的。"""
    real_w, real_h = w, h
    random.seed(20261010)
    canvas = scene(w, h, land)
    px, py = w / 2, h / 2
    pts = spawn_points(w, h, n_foe, land, seed=11)
    keys = list(da.dsp.PROTO)
    for i, (dx, dy) in enumerate(pts):
        spec = da.dsp.PROTO[keys[i % len(keys)]]
        f = i % 4
        img, _ = da.build_frame(spec, 'walk', f)
        canvas.paste(img.resize((U, U), Image.NEAREST),
                     (int(px + dx - U / 2), int(py + dy - U / 2)), img.resize((U, U), Image.NEAREST))
    # 玩家
    hero = rs.make_hero().resize((U, U), Image.NEAREST)
    canvas.paste(hero, (int(px - U / 2), int(py - U / 2)), hero)
    canvas = rs.bullet_overlay(canvas).convert('RGB')
    d = ImageDraw.Draw(canvas)
    fb, fs, ft = pg.load_font(26), pg.load_font(15), pg.load_font(13)
    bar = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(bar).rectangle([0, 0, canvas.width, 64], fill=(8, 12, 20, 215))
    canvas.paste(bar, (0, 0), bar)
    d = ImageDraw.Draw(canvas)
    _ = real_w, real_h
    d.text((20, 8), title, font=fb, fill=(235, 246, 255, 255))
    d.text((20, 40), sub, font=ft, fill=(150, 174, 198, 255))
    m = metrics(w, h)
    info = (f'可见 {m["grid"]} 格 · 面积 {m["area"]:.0f} · '
            f'长边 {m["long"]:.1f} / 短边 {m["short"]:.1f} · '
            f'边界密度 {m["perim_per_area"]:.2f}')
    d.text((canvas.width - 20, 40), info, font=ft, fill=(120, 200, 225, 255))
    if out_w and out_w != canvas.width:
        canvas = canvas.resize((out_w, int(canvas.height * out_w / canvas.width)),
                               Image.LANCZOS)
    canvas.save(path)
    return m


def main():
    os.makedirs(OUT, exist_ok=True)

    # 内部按真实分辨率渲染，再等比缩小输出（控制文件体积，但指标是真实的）
    OUTW = 1500

    print('=== 朝向指标对照（单位：96px 格）===')
    hdr = f'{"朝向":<12}{"分辨率":<14}{"网格":<14}{"面积":>7}{"长/短边":>14}{"边界密度":>10}'
    print(hdr)
    print('-' * len(hdr))
    rows = []
    for name, (w, h), land in [
        ('横屏 16:9', LANDSCAPE, True),
        ('横屏 16:10', (2560, 1600), True),
        ('横屏 21:9', ULTRAWIDE, True),
        ('竖屏 9:16', PORTRAIT, False),
        ('竖屏 9:19.5', (1080, 2340), False),
    ]:
        m = metrics(w, h)
        rows.append((name, w, h, m, land))
        print(f'{name:<12}{w}x{h:<8}{m["grid"]:<14}{m["area"]:>7.0f}'
              f'{m["long"]:>7.1f}/{m["short"]:<6.1f}{m["perim_per_area"]:>10.3f}')

    lm = metrics(LANDSCAPE[0], LANDSCAPE[1])
    pm = metrics(PORTRAIT[0], PORTRAIT[1])
    print()
    print(f'面积对比：横屏 {lm["area"]:.0f} vs 竖屏 {pm["area"]:.0f} → '
          f'{"完全相同" if abs(lm["area"]-pm["area"]) < 1 else "不同"}')
    print(f'短边对比：横屏 {lm["short"]:.1f} 格 vs 竖屏 {pm["short"]:.1f} 格 → '
          f'横屏短边是竖屏的 {lm["short"]/pm["short"]:.2f} 倍')

    m1 = render(*LANDSCAPE, True, '横屏 16:9 · Steam 主力（1920x1080 真实分辨率）',
                '头灯照明随画面比例拉伸 · 54 个敌人按矩形周长出生',
                os.path.join(OUT, 'orientation-landscape.png'), out_w=OUTW)
    m2 = render(*PORTRAIT, False, '竖屏 9:16 · 移动端惯例（1080x1920 真实分辨率）',
                '同一套内容、同一套敌群、同一出生算法',
                os.path.join(OUT, 'orientation-portrait.png'), out_w=850)
    m3 = render(*ULTRAWIDE, True, '横屏 21:9 超宽（3440x1440 真实分辨率）',
                '检查视野是否失控 —— 难度公平性问题',
                os.path.join(OUT, 'orientation-ultrawide.png'), out_w=OUTW)

    # 敌人在场内的对照（真正体现注意力分布的那一张）
    ia = render_inside(*LANDSCAPE, True, '横屏 16:9（1920x1080 真实分辨率）',
                       '敌群已在视野内 · 60 个单位 · 深色照明',
                       os.path.join(OUT, 'inside-landscape.png'), n_foe=60, out_w=980)
    ib = render_inside(*PORTRAIT, False, '竖屏 9:16（1080x1920 真实分辨率）',
                       '敌群已在视野内 · 60 个单位',
                       os.path.join(OUT, 'inside-portrait.png'), n_foe=60, out_w=560)
    ic = render_inside(*ULTRAWIDE, True, '横屏 21:9 超宽（3440x1440 真实分辨率）',
                       '视野长边是 16:9 的 1.79 倍 —— 同屏敌人数相同但活动空间更大',
                       os.path.join(OUT, 'inside-ultrawide.png'), n_foe=60, out_w=980)

    # 并排对照
    cmp = Image.new('RGB', (1000, 1160), (10, 14, 22))
    a = Image.open(os.path.join(OUT, 'inside-landscape.png'))
    b = Image.open(os.path.join(OUT, 'inside-portrait.png'))
    a = a.resize((700, 394), Image.LANCZOS)
    b = b.resize((394, 700), Image.LANCZOS)
    cmp.paste(a, (20, 70))
    cmp.paste(b, (740, 70))
    d = ImageDraw.Draw(cmp)
    fb, fs, ft = pg.load_font(24), pg.load_font(15), pg.load_font(13)
    d.text((20, 14), '朝向对照 · 同内容同敌群，仅改画面比例', font=fb,
           fill=(236, 246, 255, 255))
    d.text((20, 42), f'横屏 可见 {m1["grid"]} 格 / 短边 {m1["short"]:.1f} 格　·　'
                     f'竖屏 可见 {m2["grid"]} 格 / 短边 {m2["short"]:.1f} 格',
           font=ft, fill=(150, 174, 198, 255))
    ty = 500
    for txt in [
        ('横屏 16:9：横向 20 格可拉开 → 走位自由度更高，但横向弹幕覆盖更广、',
         '需要玩家做「横向拉扯」，这是Brotato 的手感来源'),
        ('竖屏 9:16：纵向 20 格可拉开 → 注意力集中在上下，横向躲避空间仅 11 格，',
         '但玩家更习惯「上下拉扯」（手机/魂斗罗的肌肉记忆）'),
        ('两者可见面积完全相同（225 格）→ 朝向不改变难度总量，只改变分布方向。',
         '所以难度曲线可以照搬，不需要重做平衡。'),
    ]:
        for ln in ([txt[0], txt[1]] if isinstance(txt, tuple) else [txt]):
            d.text((20, ty), ln, font=fs, fill=(190, 210, 228, 255))
            ty += 26
        ty += 8
    ty += 6
    for ln, col in [
        ('真正的风险不在横竖，在超宽屏：', (240, 170, 130, 255)),
        ('21:9 的可见范围 35.8 x 15.0 格，长边是 16:9 的 1.79 倍。', (240, 170, 130, 255)),
        ('同屏敌人数量相同，但玩家活动空间几乎翻倍 → 超宽屏玩家难度显著更低。', (240, 170, 130, 255)),
        ('解法：视野按「短边」对齐，长边超出部分用黑暗封住 —— 而这正好契合', (130, 220, 240, 255)),
        ('深海回响「黑暗中的一束光」：没照到的地方本来就不该看见。', (130, 220, 240, 255)),
    ]:
        d.text((20, ty), ln, font=fs, fill=col)
        ty += 26
    cmp.save(os.path.join(OUT, 'orientation-compare.png'))

    print(f'\n超宽屏 21:9 → {m3["grid"]} 格，长边 {m3["long"]:.1f} 格 '
          f'（16:9 的 {m3["long"]/lm["long"]:.2f} 倍）')
    print('\n输出目录：', os.path.normpath(OUT))


if __name__ == '__main__':
    main()