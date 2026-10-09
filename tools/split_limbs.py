"""
把玩家立绘切成 上半身 / 下半身 两层，供运行时做"抬手施法"动作。

背景：
单张静态立绘只能做整体位移/缩放（看起来是"身体在晃"，不是抬手）。
要让手臂真的抬起来，必须把角色分层，让**上半身（含头+手臂+武器）绕腰部旋转**。

关键设计（第一版踩过的坑）：
上下两层必须**共享同一缩放比例且保持内容原始坐标**。
若各自独立归一化/重排，两张图缩放比不同，拼起来会错位
（实测张飞上半身内容高 221px、下半身仅 67px，差 3 倍）。
所以本脚本：整图统一缩放一次到 256，然后**直接按像素切分、不重排**，
两层内容仍位于原图中的坐标。运行时用相同 scale 与 position 摆放即可精确还原原图。

输出：
  portraits/<name>_upper.png / <name>_lower.png   均为 256x256，内容坐标与原图一致
  src/config/limbs.json                          各角色腰线比例（供运行时定旋转支点）

运行时用法（见 GameScene）：
  lower: origin(0.5, 0.5), position(0, 0)
  upper: origin(0.5, waist), position(0, 0)，rotation 即绕腰旋转
其中 waist = limbs.json 的比例 * 256 * PLAYER_SCALE（像素）。
"""
import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "web", "src", "assets", "portraits")
RAW = os.path.join(ROOT, "web", "src", "assets", "portraits_raw")
OUT_JSON = os.path.join(ROOT, "web", "src", "config", "limbs.json")
TARGET = 256
PLAYERS = ["rookie", "guanyu", "zhangfei", "zhaoyun"]
OVERLAP = 6  # 上半身向下多带像素，防止旋转时腰部露缝


def load_clean(path):
    """读入并保证透明底：portraits_raw 是 AI 原图（白底），需先 flood fill 抠底。"""
    im = Image.open(path).convert("RGBA")
    a = im.getchannel("A").histogram()[0]
    if a / (im.size[0] * im.size[1]) > 0.02:
        return im
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from process_portraits import make_transparent
    im, _ = make_transparent(im)
    return im


def scale_whole(im):
    """整图统一缩放到 256x256（保持比例、居中）。两层共用此结果，比例天然一致。"""
    bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        return None
    cropped = im.crop(bbox)
    cw, ch = cropped.size
    k = TARGET / max(cw, ch)
    nw, nh = max(1, round(cw * k)), max(1, round(ch * k))
    scaled = cropped.convert("RGBa").resize((nw, nh), Image.LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
    canvas.paste(scaled, ((TARGET - nw) // 2, (TARGET - nh) // 2))
    return canvas


def find_waist(im):
    """在 38%~72% 高度找 alpha 非透明像素宽度的局部最小值作为腰线。"""
    a = im.getchannel("A")
    w, h = a.size
    px = a.load()
    widths = []
    for y in range(h):
        cnt = 0
        for x in range(w):
            if px[x, y] > 16:
                cnt += 1
        widths.append(cnt)
    lo, hi = int(h * 0.38), int(h * 0.72)
    best_y, best_w = hi, None
    for y in range(lo, hi):
        if best_w is None or widths[y] < best_w:
            best_w, best_y = widths[y], y
    return best_y, best_w or 0


def main():
    manifest = {}
    print(f"{'角色':10s} {'腰线y':>6s} {'腰宽':>5s} {'waist比例':>10s}")
    for name in PLAYERS:
        raw = os.path.join(RAW, name + ".png")
        cur = os.path.join(SRC, name + ".png")
        im = load_clean(raw if os.path.exists(raw) else cur)

        full = scale_whole(im)
        if full is None:
            print(f"{name:10s} 跳过（无有效内容）")
            continue

        wy, ww = find_waist(full)

        # 直接按像素切分，内容坐标保持不变（这是对齐的关键）
        upper = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
        upper.paste(full.crop((0, 0, TARGET, min(TARGET, wy + OVERLAP))), (0, 0))
        lower = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
        lower.paste(full.crop((0, wy, TARGET, TARGET)), (0, 0))

        upper.save(os.path.join(SRC, name + "_upper.png"))
        lower.save(os.path.join(SRC, name + "_lower.png"))

        manifest[name] = round(wy / TARGET, 4)
        print(f"{name:10s} {wy:6d} {ww:5d} {wy / TARGET:10.3f}")

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\n已写出 {OUT_JSON}")
    print("DONE")


if __name__ == "__main__":
    main()
