"""V6.80 武器 / 战斗表现改动 —— **参数级示意对照图**（before → after）。

⚠️ **这不是实机渲染**。它用与 `cocos/assets/scripts/view/DiveGame.ts` **同一组数字**
   在 PIL 里重画了一遍，目的是让你**先看形态**，不必为了看一眼就开 Creator。
   ⛔ 别把它当验收依据 —— 着色器采样、位图与矢量的叠合、粒子时序，PIL 都复现不出来。

出图：`docs/shots/v680_fx_before_after.png`

对照的 6 项（编号对应用户 2026-10-15 的清单）：
  2 追踪鱼雷：红三角锥 → **暖橙钝圆头 + 等宽身 + 后掠尾翼**
  3 声纳波前：两条同心空圈 → **三重递减波前 + 声呐束纹 + 距离衰减**
  4 电弧：一根折线 → **闪电链**（每跳独立放电路径 + 落点缠绕弧）
  6 渔网：整圈 + 禁止斜杠 → **横向缠绕绳圈 + 纵向收口索 + 捆住白闪**
  5 精英：空琥珀闭合环 → **体表分层辉光 + 绕游光点**（⛔ 无轮廓）
 10 受击：全屏 6 条红带 → **只落在自机**（冲击环 + 受击面溅射 + 机身受击弧）
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'shots')

BG = (4, 20, 28)
PANEL = (10, 28, 38)
LINE = (27, 51, 72)
CYAN = (79, 232, 255)
CYAN_HI = (200, 248, 255)
CYAN_DIM = (31, 106, 125)
AMBER = (255, 209, 102)
JADE = (127, 255, 212)
VIOLET = (160, 107, 255)
DANGER = (255, 46, 99)
EMBER = (255, 138, 60)
WHITE = (255, 255, 255)

_F: dict = {}


def F(sz: int):
    if sz not in _F:
        try:
            _F[sz] = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', sz)
        except Exception:
            _F[sz] = ImageFont.load_default()
    return _F[sz]


def mix(c, a: float, bg=BG):
    a = max(0.0, min(1.0, a))
    return tuple(int(c[i] * a + bg[i] * (1 - a)) for i in range(3))


def circ(d, cx, cy, r, fill=None, outline=None, w=1):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=outline, width=w)


def ell_pts(cx, cy, rx, ry, rot=0.0, n=28):
    """椭圆点列（rot 为整椭圆的旋转；点集沿 (cos, sin) → (rx, ry)）"""
    out = []
    for i in range(n):
        th = (i / n) * math.pi * 2
        lx, ly = math.cos(th) * rx, math.sin(th) * ry
        out.append((cx + lx * math.cos(rot) - ly * math.sin(rot),
                    cy + lx * math.sin(rot) + ly * math.cos(rot)))
    return out


# ---------------------------------------------------------------------------
# 2 追踪鱼雷
# ---------------------------------------------------------------------------
def torpedo_before(d, cx, cy, S=5.0):
    Nose, Tail, Half = 7, 8, 3.4
    pts = [(cx + Nose * S, cy),
           (cx - Tail * S, cy + Half * S),
           (cx - (Tail + 3) * S, cy + (Half + 2.6) * S),
           (cx - (Tail + 3) * S, cy - (Half + 2.6) * S),
           (cx - Tail * S, cy - Half * S)]
    d.polygon(pts, fill=mix(DANGER, 0.55), outline=DANGER, width=3)
    circ(d, cx + 4 * S, cy, 2.3 * S, fill=WHITE)


def torpedo_after(d, cx, cy, S=5.0):
    RL, RW = 10.5, 3.2
    NX, TX = cx + RL * S, cx - RL * S
    # ① 螺旋桨气泡尾迹
    for i in range(1, 7):
        q = i / 6
        bx = TX - i * 4.6 * S
        wob = math.sin(0.37 * 10 + i * 1.6) * (2.0 + i * 0.55) * S
        r = (3.0 - q * 1.7) * S
        circ(d, bx, cy + wob, r, fill=mix(EMBER, 0.34 * (1 - q) + 0.05))
    # ② 外发光晕
    circ(d, cx, cy, 11 * S * 0.62, fill=mix(EMBER, 0.18))
    # ③ 等宽圆柱身（上下两条平行线）
    d.rectangle([TX, cy - RW * S, NX, cy + RW * S], fill=mix(EMBER, 0.50), outline=EMBER, width=3)
    # ④ 钝圆头
    circ(d, NX, cy, RW * S, fill=mix(EMBER, 0.88))
    # ⑤ 后掠尾翼（翼尖 1.85 倍宽、挂在身尾之后）
    for sd in (-1, 1):
        d.polygon([(TX, cy + sd * RW * 0.90 * S),
                   (TX, cy + sd * RW * 1.85 * S),
                   (TX - 5.0 * S, cy + sd * RW * 1.15 * S)], fill=mix(EMBER, 0.92))
    # ⑥ 战斗部引信灯（1.45× / 1.05× —— 大了会盖住钝圆头）
    beat = 0.5 + 0.5 * math.sin(0.37 * 9)
    circ(d, NX - 3 * S, cy, 2.6 * 1.45 * S, fill=mix(EMBER, 0.30 + 0.30 * beat))
    circ(d, NX - 3 * S, cy, 2.6 * 1.05 * S, outline=mix(WHITE, 0.48 + 0.40 * beat), w=2)
    circ(d, NX - 3 * S, cy, 1.6 * S, fill=WHITE)


# ---------------------------------------------------------------------------
# 3 声纳波前
# ---------------------------------------------------------------------------
def sonar_before(d, cx, cy, r=170):
    circ(d, cx, cy, r, outline=mix((79, 232, 255), 0.16), w=7)
    circ(d, cx, cy, r, outline=mix((200, 248, 255), 0.55), w=2)


def sonar_after(d, cx, cy, r=170, k=0.86):
    fade = 1 - k * 0.72
    for i in range(3):
        rr = r * (1 - i * 0.17)
        a = fade * (1 if i == 0 else 0.46 - i * 0.12)
        circ(d, cx, cy, rr, outline=mix((79, 232, 255), 0.20 * a), w=(6 if i == 0 else 3))
        circ(d, cx, cy, rr, outline=mix((200, 248, 255), (0.62 if i == 0 else 0.28) * a),
             w=(2 if i == 0 else 1))
    for i in range(24):
        a2 = (i / 24) * math.pi * 2 + 0.37 * 0.9
        t0, t1 = r * 0.965, r * 1.045
        d.line([cx + math.cos(a2) * t0, cy + math.sin(a2) * t0,
                cx + math.cos(a2) * t1, cy + math.sin(a2) * t1],
               fill=mix((200, 248, 255), 0.34 * fade), width=2)


# ---------------------------------------------------------------------------
# 4 电弧
# ---------------------------------------------------------------------------
def arc_before(d, pts):
    d.line(pts, fill=mix(VIOLET, 0.34), width=10)
    d.line(pts, fill=mix(VIOLET, 0.95), width=5)
    d.line(pts, fill=WHITE, width=2)


def arc_after(d, pts, fxT=0.37):
    n = len(pts)
    for seg in range(n - 1):
        a, b = pts[seg], pts[seg + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx2, ny2 = -dy / L, dx / L
        p = []
        for i in range(7):
            t = i / 6
            env = math.sin(math.pi * t)
            off = math.sin(fxT * 41 + seg * 1.7 + i * 2.3) * (7 + 3 * seg) * 1.5 * env
            p.append((a[0] + dx * t + nx2 * off, a[1] + dy * t + ny2 * off))
        dec = 1 / (1 + seg * 0.42)
        for w, al in ((9, 0.13), (4.6, 0.34), (2.1, 0.95)):
            d.line(p, fill=mix(VIOLET, al * dec), width=max(1, int(w * dec)))
        d.line(p, fill=mix(WHITE, 0.85 * dec), width=1)
    for i in range(n):
        q = pts[i]
        dec = 1 / (1 + i * 0.34)
        pu = 1 + 0.25 * math.sin(fxT * 46 + i)
        if i == 0:
            circ(d, q[0], q[1], 2.6, fill=WHITE)
            for ax, ay in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                d.line([q[0] + ax * 5, q[1] + ay * 5, q[0] + ax * 12, q[1] + ay * 12],
                       fill=VIOLET, width=2)
            continue
        circ(d, q[0], q[1], 13 * pu * dec, fill=mix(VIOLET, 0.24 * dec))
        circ(d, q[0], q[1], 6 * pu * dec, fill=mix(VIOLET, 0.50 * dec))
        circ(d, q[0], q[1], 2.6 * dec, fill=mix(WHITE, 0.90 * dec))
        for j in range(3):
            a0 = fxT * 6.5 + i * 1.3 + j * (math.pi * 2 / 3)
            d.arc([q[0] - 12 * pu * dec, q[1] - 12 * pu * dec,
                   q[0] + 12 * pu * dec, q[1] + 12 * pu * dec],
                  math.degrees(a0), math.degrees(a0 + 1.15), fill=mix(VIOLET, 0.75 * dec), width=2)


# ---------------------------------------------------------------------------
# 6 渔网捆住
# ---------------------------------------------------------------------------
def net_before(d, cx, cy, r=42):
    circ(d, cx, cy, r, outline=mix(CYAN_HI, 0.92), w=3)
    d.line([cx - r * 0.72, cy + r * 0.72, cx + r * 0.72, cy - r * 0.72],
           fill=mix(DANGER, 0.88), width=3)


def net_after(d, cx, cy, r=42):
    # ① 三道缠绕绳圈（鱼身横放 ⇒ 短轴沿体轴(x)、长轴垂直体轴(y) = 竖直椭圆）
    for i in (-1, 0, 1):
        ccx = cx + i * r * 0.55
        p = ell_pts(ccx, cy, r * 0.30, r * 0.92)
        d.line(p + [p[0]], fill=mix(CYAN_HI, 0.84), width=2)
    # ② 两条纵向收口索（沿体轴把三道圈串起来）
    for sx in (-1, 1):
        d.line([cx - r * 0.62, cy + sx * r * 0.84, cx + r * 0.62, cy + sx * r * 0.84],
               fill=mix(JADE, 0.58), width=2)
    # ③ 捆住那一下的收紧张力闪
    circ(d, cx, cy, r * 1.7, outline=mix(WHITE, 0.80), w=3)


# ---------------------------------------------------------------------------
# 5 精英标记
# ---------------------------------------------------------------------------
def elite_before(d, cx, cy, r=24):
    circ(d, cx, cy, r * 1.8 + 3.5 * 0.5, outline=mix(AMBER, 0.40 + 0.36 * 0.5), w=2)


def elite_after(d, cx, cy, r=24, pulse=0.5):
    circ(d, cx, cy, r * 2.05, fill=mix(AMBER, 0.05 + 0.045 * pulse))
    circ(d, cx, cy, r * 1.45, fill=mix(AMBER, 0.08 + 0.07 * pulse))
    circ(d, cx, cy, r * 0.98, fill=mix(AMBER, 0.14 + 0.10 * pulse))
    for k in range(2):
        a = 1.3 + k * math.pi
        circ(d, cx + math.cos(a) * r * 1.30, cy + math.sin(a) * r * 1.05, 1.9,
             fill=mix(AMBER, 0.55 + 0.35 * pulse))


# ---------------------------------------------------------------------------
# 10 受击反馈
# ---------------------------------------------------------------------------
def hurt_before(d, x0, y0, w, h):
    bw = w * 0.08
    for i in range(6):
        xx = x0 + w - bw * (i + 1)
        d.rectangle([xx, y0, xx + bw, y0 + h], fill=mix(DANGER, 0.12))


def hurt_after(d, cx, cy):
    HW, HH = 44, 28                       # 机体剪影半尺寸（88×56）
    d.rounded_rectangle([cx - HW, cy - HH, cx + HW, cy + HH], radius=10,
                        fill=(22, 46, 60), outline=mix(CYAN_DIM, 0.6), width=2)
    d.rectangle([cx - HW, cy - HH, cx + HW, cy + HH], fill=mix(DANGER, 0.18))
    # 受击弧（来向 = 右侧，只覆盖 ±72°，**不是闭合环**）—— `SUB_D * 0.52 = 45.8`
    hr = 45.8
    d.arc([cx - hr, cy - hr, cx + hr, cy + hr], -72, 72, fill=mix(DANGER, 0.62), width=3)
    d.arc([cx - hr * 0.84, cy - hr * 0.84, cx + hr * 0.84, cy + hr * 0.84],
          -54, 54, fill=mix(WHITE, 0.34), width=2)
    # 自机冲击环
    circ(d, cx, cy, 40, outline=mix(DANGER, 0.55), w=3)
    # 受击面溅射（朝反方向溅）
    for i in range(8):
        a = math.pi + (i / 8 - 0.5) * 1.7
        L0, L1 = 12, 26 + (i % 3) * 4
        d.line([cx + math.cos(a) * L0, cy + math.sin(a) * L0,
                cx + math.cos(a) * L1, cy + math.sin(a) * L1],
               fill=mix(WHITE if i < 2 else DANGER, 0.85), width=2)


# ---------------------------------------------------------------------------
ROW = [
    ('② 追踪鱼雷', '红三角锥（UI.danger）', '暖橙钝圆头 + 等宽身 + 后掠尾翼',
     lambda d, x, y, w, h: torpedo_before(d, x + w * 0.5, y + h * 0.5),
     lambda d, x, y, w, h: torpedo_after(d, x + w * 0.5, y + h * 0.5)),
    ('③ 声纳波前', '两条同心空圈 · 一直扩到射程', '三重递减波前 + 声呐束纹 + 距离衰减',
     lambda d, x, y, w, h: sonar_before(d, x + w * 0.5, y + h * 0.5, min(w, h) * 0.42),
     lambda d, x, y, w, h: sonar_after(d, x + w * 0.5, y + h * 0.5, min(w, h) * 0.42)),
    ('④ 电弧', '一根折线（4 层描边）', '闪电链：每跳独立放电 + 落点缠绕弧',
     lambda d, x, y, w, h: arc_before(d, [(x + w * 0.10, y + h * 0.62), (x + w * 0.45, y + h * 0.34),
                                          (x + w * 0.82, y + h * 0.66)]),
     lambda d, x, y, w, h: arc_after(d, [(x + w * 0.10, y + h * 0.62), (x + w * 0.45, y + h * 0.34),
                                         (x + w * 0.82, y + h * 0.66)])),
    ('⑥ 渔网捆住', '整圈实环 + 禁止斜杠', '横向缠绕绳圈 + 纵向收口索 + 捆住白闪',
     lambda d, x, y, w, h: net_before(d, x + w * 0.5, y + h * 0.5, min(w, h) * 0.30),
     lambda d, x, y, w, h: net_after(d, x + w * 0.5, y + h * 0.5, min(w, h) * 0.30)),
    ('⑤ 精英标记', '空琥珀闭合环（无含义 + UI 框语汇）', '体表分层辉光 + 绕游光点（⛔ 无轮廓）',
     lambda d, x, y, w, h: elite_before(d, x + w * 0.5, y + h * 0.5, min(w, h) * 0.18),
     lambda d, x, y, w, h: elite_after(d, x + w * 0.5, y + h * 0.5, min(w, h) * 0.18)),
    ('⑩ 受击反馈', '全屏 6 条红带（连敌人一起染红）', '只落自机：冲击环 + 溅射 + 机身受击弧',
     lambda d, x, y, w, h: hurt_before(d, x, y, w, h),
     lambda d, x, y, w, h: hurt_after(d, x + w * 0.5, y + h * 0.5)),
]

LAB_W, CELL_W, CELL_H, PAD = 244, 470, 132, 14
W = PAD + LAB_W + CELL_W + PAD + CELL_W + PAD
HEAD = 78
FOOT = 46
H = HEAD + len(ROW) * (CELL_H + PAD) + FOOT


def main():
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((PAD, 10), 'V6.80 武器 / 战斗表现改动 · 参数级示意对照（⚠️ 非实机渲染）',
           fill=CYAN_HI, font=F(20))
    d.text((PAD, 40), '用与 DiveGame.ts 同一组数字在 PIL 里重画，只用于看形态；验收仍以 Creator 实机为准。',
           fill=(150, 182, 198), font=F(12))
    d.text((PAD + LAB_W + PAD // 2, HEAD - 20), 'BEFORE', fill=EMBER, font=F(15))
    d.text((PAD + LAB_W + CELL_W + PAD + PAD // 2, HEAD - 20), 'AFTER', fill=CYAN_HI, font=F(15))

    for ri, (title, bl, al, fb, fa) in enumerate(ROW):
        y = HEAD + ri * (CELL_H + PAD)
        d.text((PAD, y + 8), title, fill=CYAN_HI, font=F(15))
        d.text((PAD, y + 32), '旧 · ' + bl, fill=(150, 182, 198), font=F(11))
        d.text((PAD, y + 50), '新 · ' + al, fill=(150, 182, 198), font=F(11))
        for ci, fn in ((0, fb), (1, fa)):
            x = PAD + LAB_W + ci * (CELL_W + PAD)
            d.rounded_rectangle([x, y, x + CELL_W, y + CELL_H], radius=10,
                                fill=PANEL, outline=LINE, width=1)
            fn(d, x, y, CELL_W, CELL_H)

    d.text((PAD, H - FOOT + 8),
           '⚠️ 声纳：**判定半径一点没动**（`p.maxR` = 伤害半径，视觉必须画在真半径上）；'
           '"看起来没那么大"是靠**外圈距离衰减**做的，不是缩视觉骗判定。',
           fill=AMBER, font=F(12))
    d.text((PAD, H - FOOT + 26),
           '⚠️ 精英 / 受击两项改了 `DiveGame.ts`；② ③ ④ ⑥ 无 `shared/` 改动之外的机制变化 '
           '（④ 的传导机制从 V6.33 起就有，本次只改表现）。',
           fill=(150, 182, 198), font=F(12))

    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, 'v680_fx_before_after.png')
    img.save(p)
    print('已出图:', p)


if __name__ == '__main__':
    main()
