# -*- coding: utf-8 -*-
"""缠索（V6.79b）预览 —— **与 `DiveGame.drawPlayer` 同一组参数重画**。

为什么要这张图：沙箱里开不了 Cocos Creator，"索长什么样"只能靠合成图回答。
⚠️ 改 `DiveGame.drawPlayer` 里那段缠索，**必须同步改这里**（否则预览比实机差一层）。

用法：python tools/preview_tether.py
产物：docs/shots/tether_preview.png
"""
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = 'D:/project/survivors-game/'
SC = 3                      # 放大倍率（22px 的敌人肉眼看不清）
CW, CH = 760, 470
CX, CY = 300, 245           # 玩家（机体）中心
D = 68                      # 缠索距离（px，sim）—— 仍在咬住半径 70 内，但留出看得见索的间距
DANGER = (255, 46, 99)

# 参数必须与 drawPlayer 一致 -------------------------------------------------
TIGHT = max(0.0, min(1.0, 1 - (D - 40) / 72))
A_LINE = 0.34 + 0.30 * TIGHT
A_RAY = 0.24 + 0.20 * TIGHT
SEG = 3

img = Image.new('RGB', (CW, CH), (26, 23, 64))          # L3 的 tint 0x352f6b 压暗
d = ImageDraw.Draw(img, 'RGBA')
for y in range(CH):                                     # 极简的水深渐变
    k = y / CH
    d.line([(0, y), (CW, y)], fill=(int(38 - 14 * k), int(32 - 12 * k), int(84 - 30 * k)))

def spr(path, cx, cy, w):
    im = Image.open(ROOT + path).convert('RGBA')
    h = round(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    img.paste(im, (round(cx - w / 2), round(cy - h / 2)), im)

# 敌人（盘旋猎手）在玩家**右侧** D*SC 处
spr('web/src/assets/fish/orbit.png', CX + D * SC, CY, round(52 * SC))
# 机体
spr('web/src/assets/sub/sub_hull.png', CX, CY, round(88 * SC))

# ---- 缠索：与 drawPlayer 同一套画法 ----------------------------------------
sx, sy = CX + D * SC, CY
dx, dy = sx - CX, sy - CY
dl = math.hypot(dx, dy) or 1
ux, uy = dx / dl, dy / dl
for i in range(SEG):
    t0, t1 = i / SEG, (i + 0.66) / SEG
    sag = math.sin(math.pi * t0) * 7 * SC * (1 - TIGHT)
    nx, ny = -uy, ux
    d.line([(CX + dx * t0 + nx * sag, CY + dy * t0 + ny * sag),
            (CX + dx * t1 + nx * sag * 0.7, CY + dy * t1 + ny * sag * 0.7)],
           fill=DANGER + (round(A_LINE * 255),), width=round(2.4 * SC * 0.62))
for i in range(8):
    a0 = (i / 8) * math.pi * 2 + 0.35
    a1 = a0 + (math.pi * 2 / 8) * 0.58
    d.line([(CX + math.cos(a0) * 48 * SC, CY + math.sin(a0) * 32 * SC),
            (CX + math.cos(a1) * 48 * SC, CY + math.sin(a1) * 32 * SC)],
           fill=DANGER + (round(A_RAY * 255),), width=round(1.8 * SC * 0.62))

f1 = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 21)
f2 = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 14)
# ⚠️ 这两行**含中文**，必须用中文字体 —— consola 是 ASCII 字体，中文会变方块
f3 = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 13)
d.text((20, 16), '缠索（V6.79b）· 按 drawPlayer 的同一组参数重画', font=f1, fill=(214, 236, 248))
d.text((20, 46), '被咬住：机体外一圈断续的束缚弧 + 一条带垂坠的索连到它；移速 ×0.45（只压移动）',
       font=f2, fill=(126, 160, 182))
d.text((20, CH - 46), 'd = %d px（咬住半径 70 内 · 接触半径 42 外 ⇒ 与"扣氧"天然不叠加）' % D,
       font=f3, fill=(150, 172, 188))
d.text((20, CH - 26), 'tight = %.2f   line α = %.2f   ray α = %.2f' % (TIGHT, A_LINE, A_RAY),
       font=f3, fill=(150, 172, 188))
img.save(ROOT + 'docs/shots/tether_preview.png')
print('saved docs/shots/tether_preview.png', img.size, 'tight=%.2f' % TIGHT)
