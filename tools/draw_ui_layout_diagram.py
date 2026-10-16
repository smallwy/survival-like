# -*- coding: utf-8 -*-
"""版式**示意图**：锚点重排 vs 固定框（Steam PC / 窗口自由缩放）。

⚠️ 这是一张**说明性示意图**（画的是模型差异），不是"复刻实机"的预览 ——
   与 `preview_hull_side.py` 那类预览性质不同，不承担"与实机逐像素一致"的义务。
用途：`docs/UI规格_主界面与出击准备_V2.md` §2 的基准图。
复现：python tools/draw_ui_layout_diagram.py  →  docs/shots/ui_layout_anchor_ab.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = "docs/shots/ui_layout_anchor_ab.png"

BG       = (11, 17, 22)
WIN      = (16, 26, 34)
WIN_BRD  = (58, 92, 110)
SAFE     = (79, 232, 255)
BAR      = (34, 58, 72)
BLOCK    = (58, 118, 148)
BLOCK_ON = (120, 200, 230)
HERO     = (79, 185, 212)
BTN      = (79, 224, 255)
TXT      = (238, 248, 253)
DIM      = (139, 171, 185)
WARN     = (255, 157, 180)


def font(size):
    for p in ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


F13, F15, F17, F26 = font(13), font(15), font(17), font(26)


def scene(d, w, oy, k, inner_h):
    """一整套菜单内容。y=0 为窗口顶；内容顶在 oy（负 = 向上溢出，会被裁掉）。"""
    m = 32 * k
    bh = 72 * k
    d.rectangle([0, oy, w, oy + bh], fill=BAR)                       # 顶栏
    av = 40 * k
    d.rectangle([m, oy + (bh - av) / 2, m + av, oy + (bh + av) / 2], fill=BLOCK)
    for i in range(2):
        s = 48 * k
        bx = w - m - s - i * (s + 8 * k)
        d.rectangle([bx, oy + (bh - s) / 2, bx + s, oy + (bh + s) / 2],
                    outline=BLOCK, width=1)
    bs, pitch = 88 * k, 164 * k
    colh = 2 * pitch + bs
    ccy = oy + inner_h / 2 - colh / 2
    for i in range(3):                                               # 左列（3 块）
        d.rectangle([m, ccy + i * pitch, m + bs, ccy + i * pitch + bs],
                    fill=BLOCK_ON if i == 0 else BLOCK, outline=SAFE, width=1)
    for i in range(2):                                               # 右列（2 块）
        bx = w - m - bs
        d.rectangle([bx, ccy + i * pitch, bx + bs, ccy + i * pitch + bs],
                    fill=BLOCK, outline=SAFE, width=1)
    cx, cy = w / 2, oy + inner_h / 2                                 # 中央主形象
    r = 58 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=HERO, width=2)
    fh = 40 * k                                                      # 底栏
    d.rectangle([0, oy + inner_h - fh, w, oy + inner_h], fill=BAR)


def main():
    W, H = 1980, 700
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((40, 16), "适配模型 · 锚点重排 vs 固定框", font=F26, fill=TXT)
    d.text((40, 54), "Steam PC / 窗口自由缩放 —— 同一套 UI 在 21:9 超宽窗口下的两种表现",
           font=F13, fill=DIM)

    KD = 0.36                        # 绘制 px / 设计 px
    h = int(round(1080 * KD))        # 389
    w = int(round(2560 * KD))        # 922  (2560x1080 = 21:9)
    y0 = 132

    # ---------------- A 现状：fitWidth + 固定内容框 ----------------
    ax = 40
    d.text((ax, y0 - 42), "×  现状：fitWidth + 固定内容框 1304x749", font=F17, fill=WARN)
    k = w / 1304.0
    inner_h = 749 * k
    over = (inner_h - h) / 2.0
    layer = Image.new("RGBA", (w, h), (14, 22, 30, 255))
    scene(ImageDraw.Draw(layer), w, -over, k, inner_h)
    ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    od.rectangle([0, 0, w, over], fill=(255, 90, 120, 78))           # 被裁区（上）
    od.rectangle([0, h - over, w, h], fill=(255, 90, 120, 78))       # 被裁区（下）
    d.rectangle([ax, y0, ax + w, y0 + h], fill=WIN, outline=WIN_BRD, width=2)
    img.paste(Image.alpha_composite(layer, ov).convert("RGB"), (ax, y0))
    d.rectangle([ax, y0, ax + w, y0 + h], outline=WARN, width=2)
    d.text((ax + 10, y0 + 8), "被裁 ≈99 设计px", font=F13, fill=WARN)
    d.text((ax + 10, y0 + h - 24), "被裁 ≈99 设计px", font=F13, fill=WARN)
    d.text((ax + 2, y0 + h + 12),
           "21:9（2560x1080）：可见设计高仅 550 ⇒ 菜单末行与面板被切", font=F13, fill=WARN)

    # ---------------- B 方案：fitHeight + 锚点重排 ----------------
    bx0 = ax + w + 46
    d.text((bx0, y0 - 42), "√  方案：fitHeight + 锚点重排（流式）", font=F17, fill=SAFE)
    layer = Image.new("RGBA", (w, h), (WIN[0], WIN[1], WIN[2], 255))
    ld = ImageDraw.Draw(layer)
    scene(ld, w, 0, KD, h)                                            # 内容整高=窗口高
    m = 32 * KD
    ld.rectangle([m, m, w - m, h - m], outline=SAFE, width=1)         # 安全区
    bw, bh2 = 236 * KD, 62 * KD                                       # 主按钮锚右下
    ld.rectangle([w - m - bw, h - m - bh2, w - m, h - m], fill=BTN, outline=TXT, width=1)
    ld.line([w / 2, 4, w / 2, h - 4], fill=(40, 70, 86), width=1)
    d.rectangle([bx0, y0, bx0 + w, y0 + h], fill=WIN, outline=WIN_BRD, width=2)
    img.paste(layer.convert("RGB"), (bx0, y0))
    d.rectangle([bx0, y0, bx0 + w, y0 + h], outline=SAFE, width=2)
    d.text((bx0 + 2, y0 + h + 12),
           "21:9（2560x1080）：内容全可见 —— 左右列贴边外移、中央仍居中", font=F13, fill=SAFE)

    # ---------------- 图例 ----------------
    ly = y0 + h + 52
    d.text((40, ly), "图例", font=F15, fill=TXT)
    yy = ly + 30
    d.rectangle([40, yy, 64, yy + 14], outline=SAFE, width=1)
    d.text((72, yy - 2), "安全区（四周内缩 32）", font=F13, fill=DIM)
    d.rectangle([330, yy, 354, yy + 14], fill=BLOCK, outline=SAFE, width=1)
    d.text((362, yy - 2), "贴边锚定（顶/底栏、左右菜单列）", font=F13, fill=DIM)
    d.ellipse([700, yy - 2, 720, yy + 18], outline=HERO, width=2)
    d.text((728, yy - 2), "居中锚定（主形象、面板）", font=F13, fill=DIM)
    d.rectangle([1000, yy, 1024, yy + 14], fill=BTN)
    d.text((1032, yy - 2), "锚右下（主按钮）", font=F13, fill=DIM)
    d.text((40, yy + 34),
           "要点：没有任何元素用「距左边缘固定 x」定位 —— 左列锚左、右列锚右、中央锚中心，"
           "所以任意宽高比都不裁、不挤。", font=F13, fill=DIM)

    os.makedirs("docs/shots", exist_ok=True)
    img.save(OUT)
    print("已出图:", OUT, img.size)


if __name__ == "__main__":
    main()
