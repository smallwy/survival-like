#!/usr/bin/env python3.11
# -*- coding: utf-8 -*-
"""
实机尺寸下的可读性检验（Real-Size Legibility Check）
====================================================

为什么需要这个脚本
------------------
`deepsea-color.png` 看起来 6 族一眼可辨——但那张图是按32px 格子**贴出来给人眼审视**的，
不是游戏里的实际观感。真实渲染链路是：

    manifest.cell = 32, upscale = 1, zoom = 1
    GameScene.ts:63  PX_SCALE = 3
    → pxScale(unit) = PX_SCALE × zoom ÷ upscale = 3
    → 屏幕上实际占 32 × 3 = 96 px

也就是说：一个单位在实机上占屏幕高度的 96/650 ≈ **15%**。
这是"能看清"与"能分辨"的分界线所在。

本脚本按实机96px 渲染，并复刻真实敌群密度 + 弹幕 + 近黑深海背景，
检验它在实机视角下的可读性，而不是在展示图上的可读性。

输出（docs/_silhouette/）
    realsize-bullets.png实机 96px 弹幕场景（深海版）
    realsize-bullets-legacy.png   同密度同背景的现状对照
    realsize-strip.png             96px 并排（带族名）
    realsize-silhouette.png        96px 的 1-bit 剪影
"""
import os
import sys
import math
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw
import pixelgen as pg
import deepsea_family_proto as dsp

W, H = 1080, 650
CELL = 32                        # manifest.json 的逻辑单元格
PX_SCALE = 3                     # GameScene.ts:63 硬编码
VIEW = CELL * PX_SCALE           # 96px —— 实机单位屏幕尺寸
random.seed(20261010)

OUT = os.path.join(pg.DOCS_DIR, '_silhouette')


# --------------------------------------------------------------------------
# 深海场景背景：近黑底 + 玩家头灯照亮的中心区+ 远处微光颗粒
# --------------------------------------------------------------------------

def scene_bg(light=True):
    """深海近黑底：玩家头灯的**径向衰减**照明 + 稀疏微光颗粒。

    注意：颗粒必须稀疏且极暗。密集颗粒叠加会把底色整体抬亮，
    在近黑底题材里这是致命的——真实深海是 95% 以上的纯黑。
    """
    bg = Image.new('RGBA', (W, H), (3, 5, 9, 255))
    px = bg.load()
    cx, cy, rad = W / 2, H / 2 + 40, 300.0
    if light:
        for y in range(H):
            for x in range(0, W, 2):
                d = math.hypot(x - cx, y - cy) / rad
                if d >= 1:
                    continue
                a = (1 - d) ** 2.8# 快速衰减
                r0, g0, b0, _ = px[x, y]
                px[x, y] = (r0 + int(a * 4), g0 + int(a * 16), b0 + int(a * 22), 255)
    # 稀疏微光颗粒：只在光照半径内，且亮度上限压到 18
    for _ in range(260):
        x, y = random.randrange(W), random.randrange(H)
        d = math.hypot(x - cx, y - cy) / rad
        if d >= 0.92:
            continue
        v = random.randrange(6, 18)
        r0, g0, b0, _ = px[x, y]
        px[x, y] = (min(255, r0 + v // 5), min(255, g0 + v), min(255, b0 + v), 255)
    return bg


def place(dst, sprite, cx, cy, scale=VIEW):
    """按实机 pxScale 放大后贴到场景（NEAREST，保持像素块）。"""
    if scale != sprite.width:
        sprite = sprite.resize((scale, scale), Image.NEAREST)
    dst.paste(sprite, (int(cx - scale / 2), int(cy - scale / 2)), sprite)


def make_hero():
    """玩家占位：暖金色潜行者（头灯发光点）。与深海族色系刻意区分。"""
    g = pg.G()
    g.r(11, 8, 10, 12, pg.C('#ffd68c'))# 头/头盔
    g.r(9, 19, 14, 8, pg.C('#f0a03c'))              # 躯干
    g.r(13, 6, 6, 4, pg.C('#fff6d8'))               # 头灯
    solid = pg.outlined(g.im)
    a = solid.getchannel('A').filter(pg.ImageFilter.MaxFilter(9))
    halo = Image.new('RGBA', solid.size, (255, 200, 110, 255))
    halo.putalpha(a.point(lambda v: int(v * 0.42)))
    core = pg.outlined(g.im)
    a2 = g.im.getchannel('A').filter(pg.ImageFilter.MaxFilter(3))
    ring = pg.ImageChops.subtract(a2, g.im.getchannel('A'))
    rl = Image.new('RGBA', g.im.size, pg.OUTLINE)
    rl.putalpha(ring)
    return Image.alpha_composite(Image.alpha_composite(halo, core), rl)


def enemy_ring(px, py):
    """复刻实机截图的包围阵型：内圈稀疏 + 外圈密集。"""
    pts = []
    for i in range(44):
        a = i / 44 * math.tau + 0.2
        r = 300 + random.uniform(-30, 55)
        pts.append((px + math.cos(a) * r * 1.5, py + math.sin(a) * r * 0.72))
    for i in range(13):
        a = i / 13 * math.tau + 0.7
        r = 215
        pts.append((px + math.cos(a) * r * 1.45, py + math.sin(a) * r * 0.70))
    return pts


def bullet_overlay(base):
    """弹幕：右上 → 左下的点阵（复刻 7-弹幕辉光.png 的弹幕线）。"""
    for row in range(5):
        for i in range(34):
            t = i / 33
            x = W - 30 - t * 700
            y = 60 + row * 26 + math.sin(t * 3) * 18
            dot = Image.new('RGBA', (6, 6), (255, 150, 110, 235))
            a = dot.getchannel('A').filter(pg.ImageFilter.MaxFilter(3)).point(lambda v: int(v * 0.35))
            gl = Image.new('RGBA', (6, 6), (255, 120, 80, 255))
            gl.putalpha(a)
            base.paste(Image.alpha_composite(gl, dot), (int(x), int(y)))
    return base


def hero_ui(canvas, px, py):
    """极简 HUD：左上血条 + 右上波次，复刻实机信息层级。"""
    d = ImageDraw.Draw(canvas)
    fb, fs = pg.load_font(20), pg.load_font(13)
    d.rectangle([16, 14, 300, 74], outline=(70, 90, 110, 255))
    d.rectangle([26, 46, 274, 62], fill=(40, 60, 50, 255))
    d.rectangle([26, 46, 226, 62], fill=(90, 200, 130, 255))
    d.text((26, 20), '潜行者-01    Lv.1', font=fs, fill=(220, 236, 255, 255))
    d.rectangle([W - 190, 14, W - 16, 62], outline=(70, 90, 110, 255))
    d.text((W - 180, 22), '第3 / 20 波', font=fb, fill=(232, 244, 255, 255))
    d.text((W - 180, 48), '光量 68%', font=fs, fill=(150, 210, 230, 255))
    return canvas


def caption(canvas, text, sub):
    d = ImageDraw.Draw(canvas)
    fb, fs = pg.load_font(22), pg.load_font(13)
    bar = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(bar).rectangle([0, 0, canvas.width, 52], fill=(8, 12, 20, 210))
    canvas.paste(bar, (0, 0), bar)
    d = ImageDraw.Draw(canvas)
    d.text((18, 8), text, font=fb, fill=(235, 245, 255, 255))
    d.text((18, 32), sub, font=fs, fill=(150, 172, 195, 255))
    return canvas


# --------------------------------------------------------------------------

def main():
    os.makedirs(OUT, exist_ok=True)
    units = []
    for key, spec in dsp.PROTO.items():
        s = dsp.build_proto(spec)
        assert s.size == (CELL, CELL), (key, s.size)
        units.append((key, spec, s))
    hero = make_hero()

    px, py = W // 2, H // 2 + 40
    ring = enemy_ring(px, py)

    # --- A. 深海版· 实机弹幕场景 ---
    canvas = scene_bg()
    for i, (x, y) in enumerate(ring):
        place(canvas, units[i % len(units)][2], x, y)
    place(canvas, hero, px, py)
    canvas = bullet_overlay(canvas).convert('RGB')
    hero_ui(canvas, px, py)
    caption(canvas, '实机尺寸检验 · 深海版',
            f'manifest cell=32 × GameScene PX_SCALE=3 → 实机 96px · 57 个单位 + 弹幕 · 近黑深海底')
    canvas.save(os.path.join(OUT, 'realsize-bullets.png'))

    # --- B. 旧版对照：同样密度、同样背景，放现有人形单位 ---
    man = []
    for uid, fp in [('hero_rookie', 'hero_rookie'), ('foe_minion', 'foe_minion'),
                    ('foe_runner', 'foe_runner'), ('foe_tank', 'foe_tank')]:
        p = os.path.join(os.path.join(os.path.dirname(pg.DOCS_DIR), "web", "src", "assets", "pixel"), f'{fp}.png')
        if os.path.exists(p):
            im = Image.open(p).convert('RGBA')
            # 取 idle/walk 首帧（左上角一格）
            man.append(im.crop((0, 0, CELL, CELL)))
    old = scene_bg()
    for i, (x, y) in enumerate(ring):
        if man:
            place(old, man[i % len(man)], x, y)
    if man:
        place(old, man[0], px, py)
    old = bullet_overlay(old).convert('RGB')
    hero_ui(old, px, py)
    caption(old, '实机尺寸检验 · 现状（玩具兵）',
            '同一密度、同一背景、同一96px —— 对照用')
    old.save(os.path.join(OUT, 'realsize-bullets-legacy.png'))

    # --- C. 32px 原始尺寸并排 ---
    n = len(units)
    colw = VIEW + 24
    strip = Image.new('RGBA', (n * colw + 20, VIEW + 70), (6, 10, 16, 255))
    ds = ImageDraw.Draw(strip)
    fs, ft = pg.load_font(14), pg.load_font(12)
    for i, (key, spec, s) in enumerate(units):
        b = s.resize((VIEW, VIEW), Image.NEAREST)
        x0 = 20 + i * colw
        strip.paste(b, (x0, 14), b)
        ds.rectangle([x0, 14, x0 + VIEW, 14 + VIEW], outline=(38, 56, 74, 255))
        ds.text((x0 - 2, VIEW + 22), spec['name'][:7], font=fs, fill=(228, 240, 252, 255))
        ds.text((x0 - 2, VIEW + 44), f"{spec['family']} · 96px", font=ft, fill=(120, 150, 168, 255))
    strip.convert('RGB').save(os.path.join(OUT, 'realsize-strip.png'))

    # --- D. 32px 原始尺寸的 1-bit 剪影（可辨性上限） ---
    sil = Image.new('RGBA', (n * colw + 20, VIEW + 70), (255, 255, 255, 255))
    dd = ImageDraw.Draw(sil)
    f16, f12 = pg.load_font(14), pg.load_font(12)
    for i, (key, spec, s) in enumerate(units):
        # 剪影版：白色底+ 纯黑轮廓（与主预览一致，便于肉眼判形）
        g2 = pg.G()
        dsp.FAMILY[spec['family']](g2, spec, 16, 0,
                                    {'dy': 0, 'sw': 0, 'll': 0, 'rl': 0, 'fo': 0, 'bo': 0}, 'down')
        mk = g2.im.resize((VIEW, VIEW), Image.NEAREST)
        x0 = 20 + i * colw
        sil.paste(mk, (x0, 14), mk)
        dd.text((x0 - 2, VIEW + 22), spec['name'][:7], font=f16, fill=(20, 20, 24, 255))
        dd.text((x0 - 2, VIEW + 44), spec['family'], font=f12, fill=(110, 110, 118, 255))
    sil.convert('RGB').save(os.path.join(OUT, 'realsize-silhouette.png'))

    # --- E.量化：在 32px 原始尺寸下重算 IoU（不做归一化放大）---
    import silhouette_check as sc
    print('=== 32px 原始尺寸下的剪影 IoU ===')
    items = [{'key': k, 'name': spec['name'], 'group': spec['family'], 'build': spec['family'],
              'sig': sc.mask_signature(s), 'img': s} for k, spec, s in units]
    pairs, same, close, ok, stats, _ = sc.analyse(items)
    print(f'单位 {len(items)}  比对 {stats["pairs"]} 对')
    print(f'IoU 均值 {stats["mean"]:.3f}  最高 {stats["max"]:.3f}  最低 {stats["min"]:.3f}')
    print(f'撞车(≥0.82) {stats["same"]}  相似 {stats["close"]}  可区分(<0.65) {stats["ok"]}')
    for v, a, b, _, _ in sorted(pairs, reverse=True)[:8]:
        flag = 'OK ' if v < 0.65 else '!! '
        print(f'  {flag}{v:.3f}  {a}↔  {b}')
    print('\n输出目录：', os.path.normpath(OUT))


if __name__ == '__main__':
    main()