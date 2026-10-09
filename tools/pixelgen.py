#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
程序化像素角色生成器（三国幸存者 / Survivors-like）

为什么这么做
------------
AI 立绘是「静态展示品」，它不含任何动作信息。想让它抬手、转身，只能靠代码做
旋转/缩放/位移去猜，猜不对是必然的（之前六轮反复就是这个病根）。

像素风的本质优势不是"画得糙"，而是**动作 = 画出来的帧序列**：
朝向、抬手、迈步都是每一帧里画定的，不需要任何推导。

设计要点
--------
1. 所有单位都在同一张 32x32 的「逻辑像素网格」上用硬边几何图形绘制
   （PIL 在 RGBA 下 ellipse/rectangle 不抗锯齿，天然就是像素风）。
2. 画完统一做 1px 深色描边（alpha 膨胀 - 原 alpha）—— 这是像素风可读性的关键。
3. 更大的单位（Boss）用 NEAREST **整数倍**放大逻辑网格，因此
   **像素块大小在所有单位之间保持一致**（像素游戏的核心美学规则）。
4. 攻击帧「出手帧」的武器前端坐标在生成时就算好并写进 manifest，
   游戏直接读，不再靠猜或量 alpha —— 子弹一定从武器口出来。

产出
----
web/src/assets/pixel/<unit>.png     spritesheet（4 列 x 9 行）
web/src/assets/pixel/manifest.json  帧布局 + 枪口坐标
docs/pixel-preview-hero.png         武将对照预览
docs/pixel-preview-enemy.png        敌人对照预览
"""
import os
import json
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

# --------------------------------------------------------------------------
# 规格
# --------------------------------------------------------------------------
GRID = 32                       # 逻辑像素网格边长（所有单位都在这个网格里画）
COLS = 4                        # spritesheet 每行列数 = 最长动画帧数
DIRS = ('down', 'up', 'side')
ACTS = ('idle', 'walk', 'attack')
ACT_FRAMES = {'idle': 2, 'walk': 4, 'attack': 3}
ROWS = len(DIRS) * len(ACTS)

OUTLINE = (22, 19, 30, 255)
EYE = (26, 22, 36, 255)
EYE_LIGHT = (255, 246, 230, 255)
MOUTH = (120, 62, 58, 255)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET_DIR = os.path.join(ROOT, 'web', 'src', 'assets', 'pixel')
DOCS_DIR = os.path.join(ROOT, 'docs')


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------
def hx(h):
    """'#rrggbb' -> (r, g, b)"""
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def C(h, a=255):
    r, g, b = hx(h)
    return (r, g, b, a)


def mix(h, f):
    """同色系提亮/压暗，f>1 提亮，f<1 压暗"""
    r, g, b = hx(h)
    return (max(0, min(255, int(r * f))),
            max(0, min(255, int(g * f))),
            max(0, min(255, int(b * f))), 255)


def mixhex(h, f):
    """同色系提亮/压暗，仍返回 '#rrggbb'（便于继续参与色彩推导）"""
    r, g, b = hx(h)
    return '#%02x%02x%02x' % (max(0, min(255, int(r * f))),
                              max(0, min(255, int(g * f))),
                              max(0, min(255, int(b * f))))


class G:
    """逻辑像素画布：所有坐标都是整数格，天然硬边"""

    def __init__(self, n=GRID):
        self.n = n
        self.im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def r(self, x, y, w, h, c):
        if w <= 0 or h <= 0:
            return
        self.d.rectangle([x, y, x + w - 1, y + h - 1], fill=c)

    def e(self, x0, y0, x1, y1, c):
        if x1 < x0 or y1 < y0:
            return
        self.d.ellipse([x0, y0, x1, y1], fill=c)

    def p(self, x, y, c):
        if 0 <= x < self.n and 0 <= y < self.n:
            self.d.point((x, y), fill=c)

    def ln(self, x0, y0, x1, y1, c, w=1):
        self.d.line([x0, y0, x1, y1], fill=c, width=w)


def outlined(img, col=OUTLINE):
    """1px 深色描边：alpha 膨胀一圈减去原 alpha"""
    a = img.split()[3]
    grown = a.filter(ImageFilter.MaxFilter(3))
    ring = ImageChops.subtract(grown, a)
    ol = Image.new('RGBA', img.size, col)
    ol.putalpha(ring)
    return Image.alpha_composite(ol, img)


# --------------------------------------------------------------------------
# 体型：所有部件坐标都由这里派生，保证脚底统一落在 y=30
# --------------------------------------------------------------------------
BUILD = {
    #         头顶  头底  躯干y 躯干高 腿高 躯干宽
    'tiny':   dict(hy0=10, hy1=19, ty=19, th=7,  lh=4, w=9),
    'slim':   dict(hy0=3,  hy1=15, ty=15, th=10, lh=5, w=9),
    'normal': dict(hy0=2,  hy1=14, ty=15, th=10, lh=5, w=11),
    'wide':   dict(hy0=2,  hy1=14, ty=14, th=11, lh=5, w=13),
    'tall':   dict(hy0=1,  hy1=14, ty=14, th=11, lh=5, w=11),
}

# --------------------------------------------------------------------------
# 单位定义（配色与原 AI 立绘一致，保证选人卡片和游戏内是"同一个人"）
# --------------------------------------------------------------------------
HEROES = {
    'rookie': dict(
        kind='hero', weapon='pistol', build='normal', headgear='hood',
        skin='#ffd9b0', hair='#332e3f',
        top='#3ec9b8', bottom='#3f5c8c', shoe='#f4f4f4', trim='#ffffff',
    ),
    'guanyu': dict(
        kind='hero', weapon='guandao', build='tall', headgear='crown',
        skin='#c9584a', hair='#241f1c',
        top='#2f8f5b', bottom='#8c2f2f', shoe='#3a3a3a', trim='#d9a52c',
        beard='#141218', long_beard=True,
    ),
    'zhangfei': dict(
        kind='hero', weapon='serpent', build='wide', headgear='turban',
        skin='#e0a884', hair='#1c1a22',
        top='#2f4f7f', bottom='#4a3a2c', shoe='#3a3a3a', trim='#b9c2ce',
        beard='#141218',
    ),
    'zhaoyun': dict(
        kind='hero', weapon='spear', build='slim', headgear='helm',
        skin='#ffd9b0', hair='#22202b',
        top='#e6ecf5', bottom='#c3cddc', shoe='#8a8f99', trim='#d9a52c',
        cape='#c9d4e4', ponytail='#22202b',
    ),
}

# 敌人：「妖兵」——圆头凶目、无发、带角或尖牙，配色沿用 gameData 的 color
FOES = {
    'minion':       dict(kind='foe', weapon='blade', build='normal', upscale=1,
                         top='#ff6b6b', skin='#ff6b6b', horn=False),
    'runner':       dict(kind='foe', weapon='claw', build='slim', upscale=1,
                         top='#ffd93d', skin='#ffd93d', horn=False),
    'tank':         dict(kind='foe', weapon='club', build='wide', upscale=1,
                         top='#6bcb77', skin='#6bcb77', horn=True),
    'swarm':        dict(kind='foe', weapon='claw', build='tiny', upscale=1,
                         top='#ff9f43', skin='#ff9f43', horn=False),
    'shooter':      dict(kind='foe', weapon='staff', build='slim', upscale=1,
                         top='#a55eea', skin='#a55eea', horn=False),
    'boss_warlord': dict(kind='foe', weapon='blade', build='wide', upscale=2,
                         top='#9b59b6', skin='#9b59b6', horn=True),
    'boss_tyrant':  dict(kind='foe', weapon='club', build='wide', upscale=2,
                         top='#ee5253', skin='#ee5253', horn=True),
}


# --------------------------------------------------------------------------
# 姿态
# --------------------------------------------------------------------------
def make_pose(act, f, d):
    """
    dy : 整体上下（走路起伏 / 呼吸）
    fo : 侧身时「前腿」的水平偏移（正=向朝向方向迈出）
    bo : 侧身时「后腿」的水平偏移
    ll : 正面/背身时左腿抬起量
    rl : 正面/背身时右腿抬起量
    sw : 武器挥出量 -1(蓄力) -> 0(常态) -> 1(出手)
    """
    p = dict(dy=0, fo=0, bo=0, ll=0, rl=0, sw=0, atk=0)
    if act == 'idle':
        p['dy'] = -1 if f == 1 else 0
    elif act == 'walk':
        if d == 'side':
            seq = ((2, -2, 0), (0, 0, -1), (-2, 2, 0), (0, 0, -1))
            p['fo'], p['bo'], p['dy'] = seq[f]
        else:
            seq = ((2, 0, 0), (0, 0, -1), (0, 2, 0), (0, 0, -1))
            p['ll'], p['rl'], p['dy'] = seq[f]
    elif act == 'attack':
        p['atk'] = f + 1
        p['sw'] = (-1.0, 1.0, 0.35)[f]
    return p


# --------------------------------------------------------------------------
# 部件绘制
# --------------------------------------------------------------------------
def draw_legs_down(g, b, cx, dy, ll, rl, bottom, shoe):
    y = b['ty'] + b['th']
    lh = b['lh']
    bc, sc = C(bottom), C(shoe)
    for x, lift in ((cx - 5, ll), (cx + 1, rl)):
        h = max(2, lh - lift)
        g.r(x, y + dy, 4, h, bc)
        g.r(x - 1, y + dy + h, 6, 2, sc)


def draw_legs_side(g, b, cx, dy, fo, bo, bottom, shoe):
    y = b['ty'] + b['th']
    lh = b['lh']
    bc, sc = C(bottom), C(shoe)
    # 后腿（先画，被前腿/躯干压住）
    x = cx - 6 + bo
    g.r(x, y + dy, 4, lh, mix(bottom, 0.8))
    g.r(x - 1, y + dy + lh, 6, 2, mix(shoe, 0.8))
    # 前腿
    x = cx - 1 + fo
    g.r(x, y + dy, 4, lh, bc)
    g.r(x - 1, y + dy + lh, 6, 2, sc)


def draw_torso(g, spec, b, cx, dy, d, lean=0):
    w = b['w']
    if spec['build'] == 'wide':
        w += 1
    tx = cx - w // 2 + lean
    ty = b['ty'] + dy
    th = b['th']
    top_s = spec['top']
    base = C(top_s) if d != 'up' else mix(top_s, 0.88)   # 背面压暗
    g.r(tx, ty, w, th, base)
    g.r(tx, ty, w, 2, mix(top_s, 1.18 if d != 'up' else 1.0))   # 顶部高光
    g.r(tx, ty + th - 2, w, 2, mix(top_s, 0.72 if d != 'up' else 0.64))  # 底部阴影
    # 腰带
    if spec['kind'] == 'hero':
        g.r(tx, ty + th - 4, w, 2, C(spec.get('bottom') or spec['top']))
    if spec.get('trim'):
        g.r(tx, ty + 1, 2, th - 3, mix(spec['trim'], 0.95))
        g.r(tx + w - 2, ty + 1, 2, th - 3, mix(spec['trim'], 0.95))
    return tx, ty, w, th


def draw_head(g, spec, b, cx, dy, d):
    hy0 = b['hy0'] + dy
    hy1 = b['hy1'] + dy
    is_foe = spec['kind'] == 'foe'
    skin = spec['skin']
    # 妖兵无发：头部整体用本体色（发型层与脸同色 → 视觉上就是一个圆头）
    hair = skin if is_foe else spec.get('hair', '#2b2b33')
    hw = 6 if spec['build'] != 'tiny' else 4
    face_y0 = hy0 + 2

    if d == 'up':
        # 背面：整个后脑，没有五官
        g.e(cx - hw, hy0, cx + hw, hy1, C(hair))
        g.e(cx - hw, hy0, cx + hw, hy0 + 8, C(hair))
        if spec.get('headgear') in ('crown', 'turban', 'helm'):
            g.e(cx - hw - 1, hy0 - 1, cx + hw + 1, hy0 + 6, C(spec['top']))
        if spec.get('headgear') == 'hood':
            g.e(cx - hw - 1, hy0 - 1, cx + hw + 1, hy1 - 1, C(spec['top']))
        if spec.get('ponytail'):
            g.r(cx + hw - 3, hy0 + 3, 3, 11, C(spec['ponytail']))
        if is_foe:
            _foe_crown(g, spec, cx, hy0, hw)
        return

    if d == 'side':
        # 侧面朝右：后脑在左，脸朝右
        g.e(cx - hw, hy0, cx + hw - 1, hy1, C(hair))            # 后层（后脑）
        g.e(cx - hw + 2, face_y0, cx + hw, hy1 + 1, C(skin))    # 脸
        g.e(cx - hw, hy0, cx + hw - 1, hy0 + 7, C(hair))        # 头顶发
        if not is_foe:
            g.r(cx - hw, hy0 + 3, 3, 8, C(hair))                # 后颈垂发
        if spec.get('ponytail'):
            g.r(cx - hw - 1, hy0 + 4, 3, 10, C(spec['ponytail']))
        _headgear(g, spec, cx, hy0, hy1, hw, d)
        if is_foe:
            _foe_crown(g, spec, cx, hy0, hw)
            g.r(cx + 2, hy0 + 6, 3, 3, EYE_LIGHT)
            g.r(cx + 3, hy0 + 7, 1, 1, (210, 40, 40, 255))
            g.r(cx + 3, hy0 + 10, 3, 1, EYE_LIGHT)              # 尖牙
        else:
            g.r(cx + 3, hy0 + 7, 2, 2, EYE)                     # 单眼
            g.p(cx + hw, hy0 + 8, mix(skin, 0.78)[:3] + (255,))  # 鼻尖
        _beard(g, spec, cx, hy1, d)
        return

    # 正面
    g.e(cx - hw, hy0, cx + hw, hy1, C(hair))
    g.e(cx - hw + 1, face_y0, cx + hw - 1, hy1 + 1, C(skin))
    g.e(cx - hw, hy0, cx + hw, hy0 + 6, C(hair))
    if not is_foe:
        g.r(cx - hw, hy0 + 3, 2, 7, C(hair))
        g.r(cx + hw - 1, hy0 + 3, 2, 7, C(hair))
    else:
        g.r(cx - hw, hy0, hw * 2 + 1, 2, mix(skin, 0.7))        # 妖兵头顶压暗
    _headgear(g, spec, cx, hy0, hy1, hw, d)
    if is_foe:
        _foe_crown(g, spec, cx, hy0, hw)
        g.r(cx - 4, hy0 + 6, 3, 3, EYE_LIGHT)
        g.r(cx + 1, hy0 + 6, 3, 3, EYE_LIGHT)
        g.r(cx - 3, hy0 + 7, 1, 1, (210, 40, 40, 255))
        g.r(cx + 2, hy0 + 7, 1, 1, (210, 40, 40, 255))
        g.r(cx - 3, hy0 + 10, 6, 1, (60, 40, 40, 255))
        for i in range(3):                                       # 尖牙
            g.r(cx - 3 + i * 2, hy0 + 10, 1, 2, EYE_LIGHT)
    else:
        g.r(cx - 3, hy0 + 7, 2, 2, EYE)
        g.r(cx + 1, hy0 + 7, 2, 2, EYE)
        g.r(cx - 1, hy0 + 10, 2, 1, MOUTH)
    _beard(g, spec, cx, hy1, d)


def _foe_crown(g, spec, cx, hy0, hw):
    """妖兵头顶的角"""
    if not spec.get('horn'):
        return
    hc = C(mixhex(spec['top'], 0.5))
    g.r(cx - hw + 1, hy0 - 4, 2, 4, hc)
    g.r(cx + hw - 2, hy0 - 4, 2, 4, hc)
    g.p(cx - hw + 1, hy0 - 5, hc)
    g.p(cx + hw, hy0 - 5, hc)


def _headgear(g, spec, cx, hy0, hy1, hw, d):
    gear = spec.get('headgear')
    if not gear:
        return
    top, trim = spec['top'], spec.get('trim', '#ffffff')
    if gear == 'hood':
        # 连帽衫：兜帽是个大罩子，只露出下半张脸
        g.e(cx - hw - 2, hy0 - 2, cx + hw + 2, hy0 + 9, C(top))
        g.r(cx - hw - 2, hy0 + 6, hw * 2 + 5, 2, mix(top, 0.78))
        if d == 'down':
            g.e(cx - 4, hy0 + 5, cx + 4, hy1 + 1, C(spec['skin']))
            g.r(cx - 4, hy0 + 4, 9, 2, C(spec.get('hair', '#332e3f')))
            g.r(cx - 3, hy0 + 8, 2, 2, EYE)
            g.r(cx + 1, hy0 + 8, 2, 2, EYE)
        return
    if gear == 'crown':
        g.r(cx - hw - 1, hy0 - 2, hw * 2 + 2, 5, C(top))
        g.r(cx - hw - 1, hy0 + 3, hw * 2 + 2, 2, C(trim))
        g.r(cx - hw - 3, hy0 + 4, hw * 2 + 6, 2, mix(trim, 0.9))
        if d == 'down':
            g.r(cx - 4, hy0 + 7, 2, 2, EYE)
            g.r(cx + 1, hy0 + 7, 2, 2, EYE)
    elif gear == 'turban':
        g.e(cx - hw - 1, hy0 - 1, cx + hw + 1, hy0 + 7, C(top))
        g.r(cx - hw - 1, hy0 + 5, hw * 2 + 2, 2, mix(top, 0.78))
        g.r(cx - hw - 3, hy0 + 4, 3, 2, mix(top, 0.9))          # 巾角
        if d == 'down':
            g.r(cx - 4, hy0 + 7, 2, 2, EYE)
            g.r(cx + 1, hy0 + 7, 2, 2, EYE)
    elif gear == 'helm':
        g.e(cx - hw - 1, hy0 - 2, cx + hw + 1, hy0 + 8, C(top))
        g.r(cx - hw - 1, hy0 + 6, hw * 2 + 2, 2, C(trim))
        g.r(cx - 2, hy0 - 4, 3, 3, (192, 57, 43, 255))          # 盔顶红缨
        if d == 'down':
            g.r(cx - 4, hy0 + 8, 2, 2, EYE)
            g.r(cx + 1, hy0 + 8, 2, 2, EYE)


def _beard(g, spec, cx, hy1, d):
    beard = spec.get('beard')
    if not beard:
        return
    ln = 6 if spec.get('long_beard') else 4
    bc = C(beard)
    if d == 'side':
        g.r(cx + 1, hy1 - 2, 3, ln, bc)
    elif d != 'up':
        g.r(cx - 3, hy1 - 2, 5, 3, bc)
        g.r(cx - 2, hy1 + 1, 4, ln - 3, bc)


def draw_cape(g, spec, b, cx, dy, d, tx, ty, w, th):
    cape = spec.get('cape')
    if not cape:
        return
    c = C(cape)
    cb = mix(cape, 0.88)
    if d == 'up':
        g.r(tx - 2, ty, w + 4, th + 3, c)
        g.r(tx - 2, ty + th + 2, w + 4, 2, cb)
    elif d == 'side':
        g.r(tx - 3, ty, 4, th + 4, c)
        g.r(tx - 3, ty + th + 3, 5, 2, cb)
    else:
        g.r(tx - 2, ty, 2, th + 4, c)
        g.r(tx + w, ty, 2, th + 4, c)


# --------------------------------------------------------------------------
# 武器：返回「出手帧」的武器前端逻辑坐标
# --------------------------------------------------------------------------
def draw_weapon(g, spec, cx, hy, d, sw):
    """sw: -1 蓄力 / 0 常态 / 1 出手。返回枪口逻辑坐标或 None"""
    wp = spec['weapon']
    hand_x = cx + 4
    hand_y = hy

    if d == 'up':
        # 背面：武器基本被身体挡住，只露出一点
        if wp in ('guandao', 'spear', 'serpent'):
            g.r(hand_x + 1, hy - 14, 2, 18, C('#8a6b46'))
        return None

    if d == 'down':
        # 正面：武器竖握在右手侧，出手时略举
        lift = -2 if sw > 0.5 else 0
        if wp == 'pistol':
            g.r(hand_x - 1, hand_y - 3 + lift, 3, 3, C('#3a3a44'))
            g.r(hand_x + 1, hand_y - 2 + lift, 4, 2, C('#2a2a33'))
        elif wp in ('guandao', 'spear', 'serpent'):
            top = hy - 15 + lift
            g.r(hand_x, top, 2, 17 - lift, C('#8a6b46'))
            g.r(hand_x - 1, top - 4, 4, 5, C('#d8dee8'))
        else:
            g.r(hand_x - 1, hand_y - 6 + lift, 3, 8, C('#5a5a66'))
        return None

    # ---- 侧面朝右（主视角） ----
    if sw > 0.5:                       # 出手：武器水平指向前方（右）
        if wp == 'pistol':
            g.r(hand_x - 1, hand_y - 1, 8, 3, C('#33333d'))
            g.r(hand_x + 1, hand_y + 1, 3, 4, C('#2a2a33'))
            return (hand_x + 7, hand_y)
        dx, dy = 0.94, -0.34
        ln = 11 if wp != 'guandao' else 12
        wood, blade = '#8a6b46', '#d8dee8'
        mx = hand_x + round(dx * (ln - 6))
        my = hand_y + round(dy * (ln - 6))
        ex = hand_x + round(dx * ln)
        ey = hand_y + round(dy * ln)
        g.ln(hand_x, hand_y, mx, my, C(wood), 2)
        g.ln(mx, my, ex, ey, C(blade), 3 if wp == 'guandao' else 2)
        return (ex, ey)
    if sw < -0.5:                      # 蓄力：武器后仰上举
        dx, dy = -0.35, -0.94
        ln = 13
        mx = hand_x + round(dx * (ln - 6))
        my = hand_y + round(dy * (ln - 6))
        ex = hand_x + round(dx * ln)
        ey = hand_y + round(dy * ln)
        g.ln(hand_x, hand_y, mx, my, C('#8a6b46'), 2)
        g.ln(mx, my, ex, ey, C('#d8dee8'), 3)
        return None

    # 常态：竖握
    if wp == 'pistol':
        g.r(hand_x - 1, hand_y - 2, 6, 3, C('#33333d'))
        g.r(hand_x + 1, hand_y + 1, 3, 4, C('#2a2a33'))
        return None
    top = hy - 16
    wood, blade = '#8a6b46', '#d8dee8'
    g.r(hand_x, top, 2, 18, C(wood))
    if wp == 'guandao':
        g.r(hand_x - 2, top - 4, 6, 5, C(blade))
        g.r(hand_x + 3, top - 1, 4, 3, C(blade))
    elif wp == 'spear':
        g.r(hand_x - 1, top - 4, 4, 5, C(blade))
        g.r(hand_x - 1, top - 2, 4, 2, (192, 57, 43, 255))
    else:
        g.r(hand_x - 1, top - 5, 4, 6, C(blade))
    return None


# --------------------------------------------------------------------------
# 单个单位
# --------------------------------------------------------------------------
def draw_unit(spec, d, act, f):
    g = G()
    b = BUILD[spec['build']]
    pose = make_pose(act, f, d)
    cx = 16
    dy = pose['dy']
    sw = pose['sw']
    muzzle = None

    # 1) 披风（最底层）
    tx = cx - b['w'] // 2
    ty = b['ty'] + dy
    draw_cape(g, spec, b, cx, dy, d, tx, ty, b['w'], b['th'])

    # 2) 腿（敌人没单列裤子/鞋配色，回落到主色）
    bottom_s = spec.get('bottom') or spec['top']
    shoe_s = spec.get('shoe') or mixhex(spec['top'], 0.55)
    if d == 'side':
        draw_legs_side(g, b, cx, dy, pose['fo'], pose['bo'], bottom_s, shoe_s)
    else:
        draw_legs_down(g, b, cx, dy, pose['ll'], pose['rl'], bottom_s, shoe_s)

    # 3) 躯干
    tx, ty, w, th = draw_torso(g, spec, b, cx, dy, d)

    # 4) 手臂
    arm_col = mix(spec['top'], 0.86)
    if d == 'side':
        swing = 1 if (act == 'walk' and f % 2 == 0) else 0
        if sw > 0.5:
            g.ln(tx + w - 2, ty + 2, tx + w + 5, ty + 4, arm_col, 3)
        elif sw < -0.5:
            g.ln(tx + w - 2, ty + 2, tx + w + 2, ty - 2, arm_col, 3)
        else:
            off = 1 if swing else 0
            g.ln(tx + w - 2, ty + 2, tx + w + 2 + off, ty + 6 + off, arm_col, 3)
    else:
        g.r(tx - 3, ty + 1 - (2 if (act == 'walk' and f == 0) else 0), 3, 6, arm_col)
        g.r(tx + w, ty + 1 - (2 if (act == 'walk' and f == 2) else 0), 3, 6, arm_col)

    # 5) 头
    draw_head(g, spec, b, cx, dy, d)

    # 6) 武器
    hand_y = ty + th - 2
    muzzle = draw_weapon(g, spec, cx, hand_y, d, sw)

    img = outlined(g.im)
    up = spec.get('upscale', 1)
    if up > 1:
        img = img.resize((GRID * up, GRID * up), Image.NEAREST)
    return img, muzzle


# --------------------------------------------------------------------------
# 组装 spritesheet
# --------------------------------------------------------------------------
def build_sheet(spec):
    up = spec.get('upscale', 1)
    cell = GRID * up
    sheet = Image.new('RGBA', (COLS * cell, ROWS * cell), (0, 0, 0, 0))
    muzzles = {}
    for di, d in enumerate(DIRS):
        for ai, act in enumerate(ACTS):
            row = di * len(ACTS) + ai
            n = ACT_FRAMES[act]
            for f in range(n):
                img, mz = draw_unit(spec, d, act, f)
                sheet.paste(img, (f * cell, row * cell))
                # 出手帧（f==1）的武器前端 = 枪口
                if act == 'attack' and f == 1 and mz:
                    muzzles[d] = [mz[0] - GRID / 2, mz[1] - GRID / 2]
    return sheet, muzzles, cell


# --------------------------------------------------------------------------
# 预览图
# --------------------------------------------------------------------------
def load_font(size):
    for p in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf',
              r'C:\Windows\Fonts\simsun.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def make_preview(units, path, title):
    """units: [(label, sheet_image, cell)]，每个单位展示 3 方向 x 8 帧"""
    labels = ['待机', '走1', '走2', '走3', '走4', '出手0', '出手1', '出手2']
    picks = [(0, 'idle'), (0, 'walk'), (1, 'walk'), (2, 'walk'), (3, 'walk'),
             (0, 'attack'), (1, 'attack'), (2, 'attack')]
    zoom = 3
    cell = GRID * zoom
    pad = 8
    lab_w = 150
    head = 46
    row_h = cell + pad
    total_h = head + len(units) * (len(DIRS) * row_h + pad * 3)
    total_w = lab_w + 8 * (cell + 2) + pad * 2
    im = Image.new('RGBA', (total_w, total_h), (28, 26, 38, 255))
    dr = ImageDraw.Draw(im)
    f_big = load_font(20)
    f_sm = load_font(13)
    dr.text((16, 12), title, font=f_big, fill=(240, 238, 246, 255))
    y = head
    dir_cn = {'down': '朝下(正面)', 'up': '朝上(背身)', 'side': '朝右(侧面)'}
    for label, sheet, up in units:
        c = GRID * up
        for di, d in enumerate(DIRS):
            for ci, (fi, act) in enumerate(picks):
                ai = ACTS.index(act)
                row = di * len(ACTS) + ai
                box = (fi * c, row * c, fi * c + c, row * c + c)
                tile = sheet.crop(box).resize((cell, cell), Image.NEAREST)
                x = lab_w + ci * (cell + 2)
                dr.rectangle([x, y, x + cell + 1, y + cell + 1], fill=(20, 18, 28, 255))
                im.alpha_composite(tile, (x + 1, y + 1))
            dr.text((12, y + cell // 2 - 8), f'{label}·{dir_cn[d]}',
                    font=f_sm, fill=(200, 198, 212, 255))
            y += row_h
        y += pad * 2
        for ci, lb in enumerate(labels):
            dr.text((lab_w + ci * (cell + 2) + 2, y - pad * 2 + 2), lb,
                    font=f_sm, fill=(150, 148, 168, 255))
    im.convert('RGB').save(path)
    return im.size


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def main():
    os.makedirs(ASSET_DIR, exist_ok=True)
    os.makedirs(DOCS_DIR, exist_ok=True)

    manifest = {
        'grid': GRID,
        'cols': COLS,
        'dirs': list(DIRS),
        'acts': list(ACTS),
        'actFrames': ACT_FRAMES,
        'units': {},
    }

    hero_preview = []
    foe_preview = []

    print(f'{"unit":16s} {"cell":>5s} {"size":>10s}  muzzle(side)')
    for group, table, preview in (('hero', HEROES, hero_preview),
                                  ('foe', FOES, foe_preview)):
        for uid, spec in table.items():
            sheet, muzzles, cell = build_sheet(spec)
            key = f'{group}_{uid}'
            name = f'{key}.png'
            sheet.save(os.path.join(ASSET_DIR, name))
            up = spec.get('upscale', 1)
            manifest['units'][key] = {
                'sheet': name,
                'upscale': up,
                'muzzle': {k: [round(v[0], 2), round(v[1], 2)]
                           for k, v in muzzles.items()},
            }
            preview.append((uid, sheet, up))
            ms = muzzles.get('side', ['-', '-'])
            print(f'{key:16s} {cell:5d} {sheet.size!s:>10s}  '
                  f'({ms[0]}, {ms[1]}) upscale={up}')

    with open(os.path.join(ASSET_DIR, 'manifest.json'), 'w', encoding='utf-8') as fp:
        json.dump(manifest, fp, ensure_ascii=False, indent=2)

    s1 = make_preview(hero_preview, os.path.join(DOCS_DIR, 'pixel-preview-hero.png'),
                      '像素武将 · 帧序列（共 3 方向 x 待机/走路/攻击）')
    s2 = make_preview(foe_preview, os.path.join(DOCS_DIR, 'pixel-preview-enemy.png'),
                      '像素敌人 · 帧序列')
    print(f'\n预览：hero {s1}  enemy {s2}')
    print(f'输出目录：{ASSET_DIR}')


if __name__ == '__main__':
    main()
