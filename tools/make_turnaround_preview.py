"""
生成"角色四向转身"对照预览图：把每个角色的正面/背身/侧面姿态拼在一起。

用途：开发期自检（换朝向时人物身高是否一致、侧身是否明显更窄），
以及给非技术同学一眼看清"转向"到底做了什么。
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "web", "src", "assets", "portraits")
OUT_DIR = os.path.join(ROOT, "docs")
OUT = os.path.join(OUT_DIR, "turnaround-preview.png")

BG = (18, 18, 38)
FRAME = (46, 50, 78)
TXT = (232, 232, 240)
DIM = (150, 150, 170)
ACCENT = (78, 205, 196)

CELL = 256
PAD = 12
NAME_W = 156
HEAD = 92

ROWS = [("rookie", "深潜者 · 默认"), ("guanyu", "拾光者"), ("zhangfei", "铸壳者"), ("zhaoyun", "电鳗使")]
# (文件名后缀, 列标题, 是否水平翻转后显示)
COLS = [
    ("front", "正面 / 按下", False),
    ("back", "背身 / 按上", False),
    ("side", "侧身 / 按右", False),
    ("side", "侧身 / 按左", True),
]


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def paste_center(canvas, im, cx, cy):
    canvas.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)), im)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    W = NAME_W + len(COLS) * (CELL + PAD) + PAD
    H = HEAD + len(ROWS) * (CELL + 46 + PAD) + PAD
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    f_title = font(30)
    f_col = font(20)
    f_name = font(24)
    f_sub = font(16)

    d.text((PAD + 4, 20), "角色四向转身 · 姿态图对照", font=f_title, fill=ACCENT)
    d.text((PAD + 4, 58), "每格为游戏内实际使用的贴图（透明底合成到深色背景上）", font=f_sub, fill=DIM)

    # 列标题
    for ci, (_suffix, label, _flip) in enumerate(COLS):
        x = NAME_W + PAD + ci * (CELL + PAD) + CELL / 2
        d.text((x, HEAD - 26), label, font=f_col, fill=TXT, anchor="mm")

    for ri, (cid, cname) in enumerate(ROWS):
        y0 = HEAD + ri * (CELL + 46 + PAD)
        cy = y0 + CELL / 2
        d.text((PAD + 4, cy - 14), cname, font=f_name, fill=TXT)

        for ci, (suffix, _label, flip) in enumerate(COLS):
            x0 = NAME_W + PAD + ci * (CELL + PAD)
            d.rectangle([x0, y0, x0 + CELL, y0 + CELL], fill=(26, 26, 50), outline=FRAME, width=2)

            # 正面图沿用历史命名 <角色>.png，背身/侧面为 <角色>_<朝向>.png
            fname = f"{cid}.png" if suffix == "front" else f"{cid}_{suffix}.png"
            im = Image.open(os.path.join(SRC, fname)).convert("RGBA")
            if im.size != (CELL, CELL):
                im = im.resize((CELL, CELL), Image.LANCZOS)
            if flip:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            paste_center(canvas, im, x0 + CELL / 2, cy)

            # 标注该朝向贴图里角色的实际内容宽度（侧身应明显窄于正面）
            box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
            w = 0 if not box else box[2] - box[0]
            d.text((x0 + CELL / 2, y0 + CELL + 14), f"内容宽 {w}px", font=f_sub, fill=DIM, anchor="mm")

    canvas.save(OUT, optimize=True)
    print("saved:", OUT, canvas.size)


if __name__ == "__main__":
    main()
