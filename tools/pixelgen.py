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
# 设计意图：**剪影要在 1/8 秒内区分开**。玩家在弹幕里没空看颜色，
# 只认轮廓。所以不同兵种不只是换个色调，而是连体型都拉开：
#   wisp  瘦高  -> 快怪（细长、背生尖刺）
#   brute 宽厚  -> 胖怪 / Boss（宽肩、有角）
# 所有体型的 ty+th+lh 都等于 30 —— 脚底对齐，切换体型不会"浮空"。
BUILD = {
    #         头顶  头底  躯干y 躯干高 腿高 躯干宽 头半宽
    'tiny':   dict(hy0=11, hy1=19, ty=19, th=7,  lh=4, w=8,  hw=4),
    'wisp':   dict(hy0=4,  hy1=15, ty=15, th=9,  lh=6, w=7,  hw=5),
    'slim':   dict(hy0=3,  hy1=15, ty=15, th=10, lh=5, w=9,  hw=6),
    'normal': dict(hy0=2,  hy1=14, ty=15, th=10, lh=5, w=11, hw=6),
    'tall':   dict(hy0=1,  hy1=14, ty=14, th=11, lh=5, w=11, hw=6),
    'wide':   dict(hy0=2,  hy1=14, ty=14, th=11, lh=5, w=13, hw=7),
    'brute':  dict(hy0=3,  hy1=14, ty=13, th=12, lh=5, w=17, hw=7),
}

# --------------------------------------------------------------------------
# 单位定义（配色与原 AI 立绘一致，保证选人卡片和游戏内是"同一个人"）
# --------------------------------------------------------------------------
HEROES = {
    # 鞋色统一压暗。旧版 rookie 用 #f4f4f4 纯白，两只鞋各 6x2 紧挨着画，
    # 在深色地面上连成一条 12px 的白横条 —— 看起来像脚下垫了一块白板。
    'rookie': dict(
        kind='hero', weapon='bow', build='normal', headgear='hood',
        skin='#ffd9b0', hair='#332e3f',
        top='#3ec9b8', bottom='#3f5c8c', shoe='#39415f', trim='#ffffff',
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
        top='#e6ecf5', bottom='#c3cddc', shoe='#525a6b', trim='#d9a52c',
        cape='#c9d4e4', ponytail='#22202b',
    ),
}

# 敌人：「妖兵」——圆头凶目、无发、带角或尖牙，配色沿用 gameData 的 color。
# 参考 gameData 的数值：快怪 speed=135 最灵活 / 胖怪 hp=70 radius 最大 /
# 虫群最弱最小 / 射手远程。体型与特征件都按这个定位画，做到"看轮廓就知道威胁"。
FOES = {
    'minion':       dict(kind='foe', weapon='blade', build='normal', upscale=1,
                         top='#ff6b6b', skin='#ff6b6b', horn=False),
    'runner':       dict(kind='foe', weapon='blade', build='wisp', upscale=1,
                         top='#ffd93d', skin='#ffd93d', horn=False, spikes=3),
    'tank':         dict(kind='foe', weapon='club', build='brute', upscale=1,
                         top='#6bcb77', skin='#6bcb77', horn=True,
                         shoulder='#2f6b3c', trim='#bfe6c6'),
    'swarm':        dict(kind='foe', weapon='claw', build='tiny', upscale=1,
                         top='#ff9f43', skin='#ff9f43', horn=False),
    'shooter':      dict(kind='foe', weapon='bow', build='slim', upscale=1,
                         top='#a55eea', skin='#a55eea', horn=False,
                         third_eye=True, trim='#d9b8ff'),
    # zoom：显示倍率（相对普通单位）。upscale 只管"画得精细些"，
    # 两者分开才不会出现"分辨率和体积一起翻倍"→ Boss 渲染成 256px 的荒唐结果。
    'boss_warlord': dict(kind='foe', weapon='blade', build='brute', upscale=2, zoom=2,
                         top='#9b59b6', skin='#9b59b6', horn=True,
                         shoulder='#4a2a63', trim='#e0c3ff', cape='#33193f'),
    'boss_tyrant':  dict(kind='foe', weapon='guandao', build='brute', upscale=2, zoom=2,
                         top='#ee5253', skin='#ee5253', horn=True,
                         shoulder='#7d2323', trim='#ffd0cd', cape='#45161a'),
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
        # 鞋宽 5（不是 6）：两只脚之间留出 1px，否则两条鞋连成一根横条
        g.r(x - 1, y + dy + h, 5, 2, sc)


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
    hw = b['hw']
    face_y0 = hy0 + 2

    if d == 'up':
        # 背面：整个后脑，没有五官 —— 但"没有五官"不等于"没有信息"。
        # 旧版兜帽分支直接拿 top 色把整颗头填满，玩家朝上走时看到的是一颗没有任何
        # 细节的青色圆蛋（截图里非常明显）。背面靠这几样东西建立体积：
        # 帽壳的明暗分层、中缝脊线、帽檐下摆阴影、露出来的后颈。
        g.e(cx - hw, hy0, cx + hw, hy1, C(hair))
        g.e(cx - hw, hy0, cx + hw, hy0 + 8, C(hair))
        topc = spec['top']
        if spec.get('headgear') in ('crown', 'turban', 'helm'):
            g.e(cx - hw - 1, hy0 - 1, cx + hw + 1, hy0 + 6, C(topc))
            g.r(cx - hw - 1, hy0 + 5, hw * 2 + 2, 2, mix(topc, 0.76))
            g.r(cx - hw, hy0 - 1, hw * 2, 2, mix(topc, 1.12))          # 顶面高光
            g.r(cx - 1, hy0 - 1, 3, 6, mix(topc, 1.18))                # 背面中缝
            if spec.get('headgear') == 'turban':
                g.r(cx + hw - 1, hy0 + 4, 4, 2, mix(topc, 1.1))        # 巾角结
                g.r(cx + hw + 1, hy0 + 5, 2, 5, mix(topc, 0.88))
            if spec.get('headgear') == 'helm':
                g.r(cx - 2, hy0 - 4, 3, 3, (192, 57, 43, 255))         # 盔顶红缨
        if spec.get('headgear') == 'hood':
            # 兜帽背面：帽壳 + 脊线 + 下摆阴影 + 露出的后颈头发
            g.e(cx - hw - 1, hy0 - 1, cx + hw + 1, hy0 + 7, C(topc))
            g.r(cx - hw - 1, hy0 - 1, hw * 2 + 3, 2, mix(topc, 1.1))   # 顶面高光
            g.r(cx - 1, hy0 - 1, 3, 8, mix(topc, 1.2))                 # 中缝脊线
            g.r(cx - hw - 1, hy0 + 6, hw * 2 + 3, 2, mix(topc, 0.7))   # 下摆阴影
            g.e(cx - 4, hy0 + 7, cx + 4, hy1 + 1, C(hair))             # 后颈
            g.r(cx - 3, hy0 + 8, 2, 6, mix(hair, 1.3))                 # 露出的发丝
            g.r(cx + 2, hy0 + 9, 1, 5, mix(hair, 1.3))
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
        # 连帽衫：兜帽只罩住头顶到眉线，脸必须露出来。
        # （旧版兜帽是个罩到 hy0+9 的大罩子，把整张脸吃掉，侧身更是整颗头一个绿块）
        g.e(cx - hw - 1, hy0 - 1, cx + hw + 1, hy0 + 6, C(top))
        g.r(cx - hw - 1, hy0 + 4, hw * 2 + 3, 2, mix(top, 0.78))   # 帽檐阴影
        g.r(cx - hw - 1, hy0 - 1, hw * 2 + 3, 3, mix(top, 1.2))    # 帽顶高光
        if d == 'down':
            g.e(cx - 4, hy0 + 6, cx + 4, hy1 + 1, C(spec['skin']))
            g.r(cx - 4, hy0 + 5, 9, 2, C(spec.get('hair', '#332e3f')))
            g.r(cx - 3, hy0 + 8, 2, 2, EYE)
            g.r(cx + 1, hy0 + 8, 2, 2, EYE)
            g.r(cx - 1, hy0 + 11, 2, 1, MOUTH)
        elif d == 'side':
            # 侧面：兜帽右缘往后收，露出朝前的半张脸
            g.e(cx - 1, hy0 + 5, cx + hw, hy1, C(spec['skin']))
            g.r(cx - 1, hy0 + 5, 3, 2, C(spec.get('hair', '#332e3f')))
            g.r(cx + 2, hy0 + 8, 2, 2, EYE)
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
    # 胡须从下巴往下挂，不要压到脸上 —— 原来起点是 hy1-2，正面会糊掉半个脸
    if d == 'side':
        g.r(cx + 2, hy1 - 1, 2, ln, bc)
        g.r(cx + 2, hy1 - 1, 2, 1, C(mixhex(beard, 1.8)))
    elif d != 'up':
        g.r(cx - 3, hy1 - 1, 5, 3, bc)
        g.r(cx - 2, hy1 + 1, 4, ln - 3, bc)


def draw_marks(g, spec, b, cx, dy, d, tx, ty, w, th):
    """兵种特征件：肩甲 / 背刺 / 第三眼。

    这是**剪影辨识**的主要手段 —— 玩家在弹幕里没时间看颜色，只认轮廓。
    肩甲让 brate 体型横向再撑出 3px，背刺让快怪侧面明显带锯齿，
    第三眼让远程单位在人群里一眼可辨。
    """
    sh = spec.get('shoulder')
    if sh:
        pad = 3
        if d == 'side':
            g.r(tx + w - 2, ty, pad + 2, 4, C(sh))
            g.r(tx + w - 1, ty, pad + 2, 2, mix(sh, 1.3))
        else:
            g.r(tx - pad, ty, pad + 1, 4, C(sh))
            g.r(tx + w - 1, ty, pad + 1, 4, C(sh))
            g.r(tx - pad, ty, pad + 1, 2, mix(sh, 1.3))
            g.r(tx + w - 1, ty, pad + 1, 2, mix(sh, 1.3))

    sp = spec.get('spikes')
    if sp:
        sc = C(mixhex(spec['top'], 0.55))
        if d == 'up':
            for i in range(sp):
                g.r(cx - 1, ty - 3 + i * 2, 2, 2, sc)
        elif d == 'side':
            for i in range(sp):
                g.r(tx - 2, ty + 1 + i * 3, 3, 2, sc)
                g.p(tx - 3, ty + 1 + i * 3, sc)

    if spec.get('third_eye') and d == 'down':
        g.r(cx - 2, b['hy0'] + dy + 4, 4, 3, C('#33204a'))
        g.r(cx - 1, b['hy0'] + dy + 5, 2, 1, C('#ff6bff'))


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
def draw_weapon(g, spec, cx, hy, d, sw, hw):
    """sw: -1 蓄力 / 0 常态 / 1 出手。返回枪口逻辑坐标或 None

    两条约束（都是踩过的坑）：
      1. 握持点必须移到头部轮廓**右侧之外**（hand_x = cx + hw + 2）。旧版固定在
         cx+4，武器会压在脑袋上，侧身帧看起来就是"头顶糊了一块白布"。
      2. 敌兵武器比武将压暗一档、缩短一档。近白刃色在深色背景上会糊成一团亮斑，
         反而抢掉了"谁是自己人"的视觉层级。
    """
    wp = spec['weapon']
    foe = spec['kind'] == 'foe'
    hand_x = cx + hw + 2
    hand_y = hy
    wood = '#5a4630' if foe else '#8a6b46'
    blade = '#98a4b6' if foe else '#d8dee8'

    if d == 'up':
        # 背面：武器基本被身体挡住，只露出一点
        if wp == 'bow':
            g.ln(hand_x + 1, hy - 10, hand_x + 1, hy + 3, C(wood), 2)
        elif wp in ('guandao', 'spear', 'serpent'):
            g.r(hand_x + 1, hy - 14, 2, 18, C(wood))
        elif foe:
            g.r(hand_x + 1, hy - 8, 2, 10, C(wood))
        return None

    if d == 'down':
        # 正面：武器竖握在右手侧，出手时略举
        lift = -2 if sw > 0.5 else 0
        if wp == 'pistol':
            g.r(hand_x - 1, hand_y - 3 + lift, 3, 3, C('#3a3a44'))
            g.r(hand_x + 1, hand_y - 2 + lift, 4, 2, C('#2a2a33'))
        elif wp in ('guandao', 'spear', 'serpent'):
            top = hy - 15 + lift
            g.r(hand_x, top, 2, 17 - lift, C(wood))
            g.r(hand_x - 1, top - 4, 4, 5, C(blade))
        elif wp == 'blade':                     # 短刀：立着的刀身 + 十字护手
            g.r(hand_x - 1, hand_y - 10 + lift, 3, 9, C(blade))
            g.r(hand_x - 2, hand_y - 2 + lift, 5, 2, C(wood))
        elif wp == 'club':                      # 木棒：棒身 + 粗头
            g.r(hand_x - 1, hand_y - 9 + lift, 3, 8, C(wood))
            g.r(hand_x - 2, hand_y - 14 + lift, 5, 6,
                C(mixhex(spec['top'], 0.68)))
        elif wp == 'bow':                       # 弓：竖握的弓身 + 弓弦
            g.r(hand_x - 1, hand_y - 9 + lift, 2, 17, C(wood))
            g.r(hand_x - 3, hand_y - 10 + lift, 3, 2, C(wood))
            g.r(hand_x - 3, hand_y + 8 + lift, 3, 2, C(wood))
            g.r(hand_x + 2, hand_y - 8 + lift, 1, 16, C(blade))
        elif wp == 'staff':                     # 法杖：杖 + 顶端宝珠
            g.r(hand_x - 1, hand_y - 13 + lift, 2, 13, C(wood))
            g.r(hand_x - 2, hand_y - 17 + lift, 4, 4, C('#ff6bff'))
        else:                                   # 利爪：三根短刃
            for i in range(3):
                g.r(hand_x - 1 + i * 2, hand_y - 5 + lift + i, 2, 6, C(blade))
        return None

    # ---- 侧面朝右（主视角） ----
    # 32 格里给武器留的横向空间只有「握点 → 格子右缘」这一小段（约 7px），
    # 所以出手姿态统一取「向前上方约 37°」：既读得出"捅出去了"，
    # 刀尖也不会被格子裁掉（旧版 dx=0.94 水平捅出，关羽/张飞/赵云全部超出格子，
    # 表现是侧面攻击时刀头齐刷刷被切平）。
    if sw > 0.5:                       # 出手
        if wp == 'pistol':
            g.r(hand_x - 1, hand_y - 1, 8, 3, C('#33333d'))
            g.r(hand_x + 1, hand_y + 1, 3, 4, C('#2a2a33'))
            return (hand_x + 7, hand_y)
        if wp == 'claw':
            for i in range(3):
                g.ln(hand_x, hand_y, hand_x + 5 - i, hand_y - 4 + i * 3, C(blade), 2)
            return (hand_x + 5, hand_y - 1)
        if wp == 'staff':
            g.ln(hand_x, hand_y, hand_x + 6, hand_y - 4, C(wood), 2)
            g.r(hand_x + 5, hand_y - 8, 3, 4, C('#ff6bff'))
            return (hand_x + 7, hand_y - 6)
        if wp == 'bow':
            # 出手：弓臂前推，箭已离弦。
            # 箭尖只到 hand_x+6 —— 32 格右缘的余量只有这么多
            # （hand_x = 16 + hw + 2，normal 体型已占 24），再多一格就会被裁掉，
            # 这正是之前关羽侧身刀头被切平的同一个坑。
            g.ln(hand_x - 1, hand_y - 6, hand_x + 3, hand_y - 1, C(wood), 2)
            g.ln(hand_x - 1, hand_y + 4, hand_x + 3, hand_y - 1, C(wood), 2)
            g.ln(hand_x + 1, hand_y - 2, hand_x + 6, hand_y - 2, C(blade), 1)
            return (hand_x + 6, hand_y - 2)
        dx, dy = 0.8, -0.6
        ln = 6 if foe else 8
        mx = hand_x + round(dx * (ln - 4))
        my = hand_y + round(dy * (ln - 4))
        ex = hand_x + round(dx * ln)
        ey = hand_y + round(dy * ln)
        g.ln(hand_x, hand_y, mx, my, C(wood), 2)
        g.ln(mx, my, ex, ey, C(blade), 3)
        return (ex, ey)
    if sw < -0.5:                      # 蓄力：举到身前上方（不再甩到脑后压住脸）
        if wp == 'bow':
            # 张弓搭箭：弦拉到身后，箭尖朝前
            g.ln(hand_x - 1, hand_y - 6, hand_x + 3, hand_y - 1, C(wood), 2)
            g.ln(hand_x - 1, hand_y + 4, hand_x + 3, hand_y - 1, C(wood), 2)
            g.ln(hand_x + 4, hand_y - 2, hand_x - 2, hand_y - 2, C(blade), 1)
            return None
        dx, dy = 0.2, -0.98
        ln = 9 if foe else 11
        mx = hand_x + round(dx * (ln - 4))
        my = hand_y + round(dy * (ln - 4))
        ex = hand_x + round(dx * ln)
        ey = hand_y + round(dy * ln)
        g.ln(hand_x, hand_y, mx, my, C(wood), 2)
        g.ln(mx, my, ex, ey, C(blade), 3)
        return None

    # 常态：竖握。敌兵杆子明显短一截，刃端不会高过头顶
    if wp == 'pistol':
        g.r(hand_x - 1, hand_y - 2, 6, 3, C('#33333d'))
        g.r(hand_x + 1, hand_y + 1, 3, 4, C('#2a2a33'))
        return None
    if wp == 'bow':
        # 常态：弓竖握在身前，弓弦朝外
        g.r(hand_x, hy - 9, 2, 17, C(wood))
        g.r(hand_x - 2, hy - 10, 3, 2, C(wood))
        g.r(hand_x - 2, hy + 7, 3, 2, C(wood))
        g.r(hand_x + 2, hy - 8, 1, 15, C(blade))
        return None
    top = hy - (8 if foe else 16)
    g.r(hand_x, top, 2, (10 if foe else 18), C(wood))
    if wp == 'guandao':
        g.r(hand_x - 2, top - 4, 6, 5, C(blade))
        g.r(hand_x + 3, top - 1, 4, 3, C(blade))
    elif wp == 'spear':
        g.r(hand_x - 1, top - 4, 4, 5, C(blade))
        g.r(hand_x - 1, top - 2, 4, 2, (192, 57, 43, 255))
    elif wp == 'club':
        g.r(hand_x - 2, top - 4, 6, 6, C(mixhex(spec['top'], 0.68)))
    elif wp == 'staff':
        g.r(hand_x - 2, top - 4, 5, 4, C('#ff6bff'))
    elif wp == 'claw':
        for i in range(3):
            g.r(hand_x - 1 + i, top, 2, 5, C(blade))
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

    # 3b) 兵种特征件（肩甲 / 背刺 / 第三眼）—— 肩甲要压在手臂下面，先画
    draw_marks(g, spec, b, cx, dy, d, tx, ty, w, th)

    # 4) 手臂。侧身的持械手必须真的伸到武器握点，
    #    否则武器会"浮"在身体外面，看着像掉在地上的道具。
    arm_col = mix(spec['top'], 0.86)
    hx = cx + b['hw'] + 2
    hand_y = ty + th - 2
    if d == 'side':
        sx, sy = tx + w - 2, ty + 2
        g.ln(sx, sy, hx - 1, hand_y - (3 if sw > 0.5 else 5), arm_col, 3)
    else:
        g.r(tx - 3, ty + 1 - (2 if (act == 'walk' and f == 0) else 0), 3, 6, arm_col)
        g.r(tx + w, ty + 1 - (2 if (act == 'walk' and f == 2) else 0), 3, 6, arm_col)

    # 5) 头
    draw_head(g, spec, b, cx, dy, d)

    # 6) 武器
    muzzle = draw_weapon(g, spec, cx, hand_y, d, sw, b['hw'])

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

    # 量「朝下 · 待机」这一格的 alpha 包围盒，换算回逻辑像素写进 manifest。
    # 游戏用它算碰撞框与视觉尺寸 —— 这样"看着多大就打到多大"，不会再出现
    # "胖怪视觉不大、判定却比身体宽"这种视觉与手感错配。
    # 只量单格：整行会把 4 列动画并起来，量出来永远是整张 sheet 的宽度。
    bb = sheet.crop((0, 0, cell, cell)).getbbox()
    bbox = [round(v / up, 2) for v in bb] if bb else None
    return sheet, muzzles, cell, bbox


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
            sheet, muzzles, cell, bbox = build_sheet(spec)
            key = f'{group}_{uid}'
            name = f'{key}.png'
            sheet.save(os.path.join(ASSET_DIR, name))
            up = spec.get('upscale', 1)
            manifest['units'][key] = {
                'sheet': name,
                'upscale': up,
                'zoom': spec.get('zoom', 1),
                'cell': cell,
                'bbox': bbox,
                'muzzle': {k: [round(v[0], 2), round(v[1], 2)]
                           for k, v in muzzles.items()},
            }
            preview.append((uid, sheet, up))
            ms = muzzles.get('side', ['-', '-'])
            vis = (f'{bbox[2] - bbox[0]:.0f}x{bbox[3] - bbox[1]:.0f}'
                   if bbox else 'n/a')
            print(f'{key:16s} cell={cell:3d} {sheet.size!s:>10s}  '
                  f'可视={vis:>8s}  muzzle=({ms[0]}, {ms[1]})  up={up}')

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
