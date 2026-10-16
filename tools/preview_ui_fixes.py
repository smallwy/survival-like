# -*- coding: utf-8 -*-
"""
V6.85g UI 修复对照图（**按代码几何复算的示意图，不是实机截图**）。

三处问题各出一张：
  1. `docs/shots/shop_card_compare.png`    商店卡 cw 122 → 176（类型标签被锁定按钮压住 14px）
  2. `docs/shots/loadout_art_compare.png`  「出击准备」机体立绘 67px → 100px（原来比武器还小）
  3. `docs/shots/title_blackdot.png`       主界面中央"黑点"= drawCore 遗留（关掉前后）

⚠️ 这是**版式示意图**：只复算坐标关系，不还原材质/光影 —— 实机请以 Creator 为准。
"""
import os
from PIL import Image, ImageDraw, ImageFont

F = "C:/Windows/Fonts/msyh.ttc"
def f(sz):
    return ImageFont.truetype(F, sz)

BG = (10, 17, 25)
CARD = (206, 220, 228)
CARD_OFF = (176, 192, 202)
SLOT = (168, 188, 200)
EDGE = (86, 148, 176)
TXT = (18, 38, 48)
DIM = (86, 106, 118)
RED = (226, 66, 66)
CYAN = (86, 214, 232)
OUT = "docs/shots"


# ---------------------------------------------------------------- 商店卡
def shop_card(d, x, y, cw, ch, label, hot=False):
    ah = (cw - 28) // 2
    d.rounded_rectangle([x, y, x + cw, y + ch], 12, fill=CARD, outline=EDGE, width=2)
    d.text((x + cw / 2, y - 16), label, font=f(14), fill=CYAN, anchor="mm")
    # 键帽
    d.rounded_rectangle([x + 12, y + 12, x + 34, y + 34], 6, fill=(87, 139, 160))
    d.text((x + 23, y + 23), "1", font=f(11), fill=(240, 250, 255), anchor="mm")
    # 类型标签
    d.text((x + 42, y + 23), "器械", font=f(13), fill=DIM, anchor="lm")
    # 锁定按钮（中心 x+cw-40，宽 56，高 30）
    bx0, bx1 = x + cw - 68, x + cw - 12
    d.rounded_rectangle([bx0, y + 8, bx1, y + 38], 8, fill=(226, 236, 242),
                        outline=(60, 110, 140), width=1)
    d.text(((bx0 + bx1) / 2, y + 23), "锁定", font=f(12), fill=(40, 70, 90), anchor="mm")
    # 立绘框
    d.rounded_rectangle([x + 14, y + 48, x + 14 + cw - 28, y + 48 + ah], 10,
                        fill=SLOT, outline=EDGE)
    # 名称(17)/描述(13)/状态行(13)/按钮
    d.text((x + cw / 2, y + ch - 134), "脉冲机关枪", font=f(15), fill=TXT, anchor="mm")
    d.text((x + cw / 2, y + ch - 112), "高频连射 · 单体", font=f(11), fill=DIM, anchor="mm")
    d.text((x + cw / 2, y + ch - 92), "新装备 · 占 1 座位", font=f(11), fill=DIM, anchor="mm")
    d.rounded_rectangle([x + 14, y + ch - 52, x + cw - 14, y + ch - 16], 10,
                        fill=(152, 202, 220), outline=EDGE)
    d.text((x + cw / 2, y + ch - 34), "购买 · 45", font=f(13), fill=(14, 34, 44), anchor="mm")
    if hot:
        # 标出类型标签与锁定按钮的重叠区 [x+54, x+68] × [y+8, y+38]
        d.rectangle([x + 54, y + 8, x + 68, y + 38], outline=RED, width=2)
        d.text((x + 61, y + 46), "重叠14px", font=f(11), fill=RED, anchor="mm")


def fig_shop():
    W, H = 900, 448
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((24, 24), "商店卡：类型标签 与 锁定按钮 的物理冲突", font=f(19), fill=CYAN)
    d.text((24, 50), "V6.83 把卡宽从 204 砍到 122 → 锁定按钮左移 82px，直接压到「器械」上",
           font=f(13), fill=(150, 172, 186))
    shop_card(d, 120, 130, 122, 251, "cw = 122  (V6.83 · 用户报错版)", hot=True)
    shop_card(d, 400, 130, 176, 278, "cw = 176  (V6.85g · 修后)")
    d.text((120, 406), "类型标签[x+42, x+68]   锁定按钮[x+54, x+110]", font=f(12), fill=RED)
    d.text((120, 424), "两者 x / y 区间同时重叠 14px → 「器械」被按钮压住", font=f(12), fill=RED)
    im.save(os.path.join(OUT, "shop_card_compare.png"))
    print("saved shop_card_compare.png")


# ---------------------------------------------------------------- 出击准备立绘
def sub_art(d, cx, cy, canvas_w, canvas_h, content_w, content_h, col):
    """画布(虚线) + 机体内容(实心胶囊)"""
    cw, chh = canvas_w, canvas_h
    d.rectangle([cx - cw / 2, cy - chh / 2, cx + cw / 2, cy + chh / 2],
                outline=(70, 96, 112), width=1)
    w2, h2 = content_w / 2, content_h / 2
    # 胶囊机体
    r = min(h2, w2 * 0.34)
    d.rounded_rectangle([cx - w2, cy + (canvas_h - content_h) * 0.0 - h2,
                         cx + w2, cy + (canvas_h - content_h) * 0.0 + h2],
                        r, fill=col, outline=(140, 226, 240))


def fig_loadout():
    W, H = 900, 330
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((24, 22), "「出击准备」立绘：机体 67px  vs  武器 93px", font=f(19), fill=CYAN)
    d.text((24, 48), "机体按「画布宽 408」缩放 → 机体内容只有 67×43；武器内容 93×80 → 用户：潜航艇比武器还小",
           font=f(13), fill=(150, 172, 186))

    # 旧机体
    sub_art(d, 130, 190, 78, 69, 67, 43, (196, 222, 234))
    d.text((130, 240), "机体 旧  k=78/408", font=f(13), fill=RED, anchor="mm")
    d.text((130, 260), "内容 67 × 43", font=f(12), fill=(170, 190, 202), anchor="mm")

    # 新机体
    sub_art(d, 350, 186, 116, 103, 100, 64, (206, 232, 244))
    d.text((350, 248), "机体 新  k=100/352", font=f(13), fill=(120, 230, 150), anchor="mm")
    d.text((350, 268), "内容 100 × 64", font=f(12), fill=(170, 190, 202), anchor="mm")

    # 武器
    bx = 620
    d.rectangle([bx - 93, 190 - 46.5, bx + 93, 190 + 46.5], outline=(70, 96, 112), width=1)
    d.rounded_rectangle([bx - 46, 190 - 40, bx + 46, 190 + 40], 14,
                        fill=(190, 208, 216), outline=(220, 180, 120))
    d.rectangle([bx - 60, 182, bx - 30, 198], fill=(200, 214, 220))
    d.text((bx, 240), "武器  框 186×93 (2:1)", font=f(13), fill=(220, 190, 120), anchor="mm")
    d.text((bx, 260), "内容 93 × 80", font=f(12), fill=(170, 190, 202), anchor="mm")
    d.text((bx, 285), "(画布 600×300, 无留白)", font=f(11), fill=(120, 140, 152), anchor="mm")

    im.save(os.path.join(OUT, "loadout_art_compare.png"))
    print("saved loadout_art_compare.png")


# ---------------------------------------------------------------- 主界面黑点
def fig_blackdot():
    W, H = 900, 300
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((24, 22), "主界面中央：drawCore 遗留 → 机身正中的「黑点」", font=f(19), fill=CYAN)
    d.text((24, 48), "V6.85b 用 HULL_SHELL_OFF 关了 drawHull/drawRing/drawLight，唯独漏了 drawCore",
           font=f(13), fill=(150, 172, 186))

    for i, (cx, title, show_core) in enumerate([
            (230, "修前：机身 + 遗留核心穹顶", True),
            (660, "修后：只剩机身（= 战斗内）", False)]):
        cy = 175
        # 机身：宽 99 高 57（实测）
        d.rounded_rectangle([cx - 49.5, cy - 28, cx + 49.5, cy + 28], 20,
                            fill=(206, 232, 244), outline=(140, 226, 240), width=2)
        # 舷窗
        for k in range(5):
            xx = cx - 30 + k * 15
            d.ellipse([xx - 2.5, cy + 6, xx + 2.5, cy + 11], fill=(120, 180, 200))
        if show_core:
            d.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=(8, 22, 31))
            d.ellipse([cx - 12.4, cy - 9.4, cx + 12.4, cy + 15.4], fill=(60, 140, 165))
            d.ellipse([cx - 8, cy - 1, cx, cy + 7], fill=(150, 235, 250))
            d.rectangle([cx - 22, cy - 22, cx + 22, cy + 22], outline=RED, width=2)
            d.text((cx, cy + 44), "近黑底盘 0x08161f  Ø40", font=f(12), fill=RED, anchor="mm")
        else:
            d.text((cx, cy + 44), "无遗留零件", font=f(12), fill=(120, 230, 150), anchor="mm")
        d.text((cx, cy - 52), title, font=f(14), fill=CYAN, anchor="mm")

    im.save(os.path.join(OUT, "title_blackdot.png"))
    print("saved title_blackdot.png")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    fig_shop()
    fig_loadout()
    fig_blackdot()
