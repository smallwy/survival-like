"""
把 AI 生成的 chibi 立绘处理成：真透明底 + 角色填满画布 + 统一 256x256。

解决三个问题：
1) 白底：ImageGen 返回的多是"白底"而非真透明，直接进游戏每个单位会套一个白方块。
   用「从四周边界开始的 flood fill」只删除与边缘连通的近白像素——角色内部的白
   （眼白等）被彩色像素包围、不与边缘连通，会被保留。
2) 角色没填满画布：AI 图角色通常只占画布中央约 60%，若按整张 1024 算 scale，
   实际显示只有约 12px，所以游戏里敌人小到看不清。这里裁切到角色边界后放大，
   让角色撑满画布，代码里 radius 就等于角色真实身高的半径，所见即所得。
3) 包体：1024 PNG 共约 11MB → 统一 256 后约 1MB。

降采样走预乘 alpha（RGBa）+ LANCZOS，避免透明边缘出现白边。
原图备份到 portraits_raw/（已 gitignore），仓库只保留处理后的小图。
"""
import os
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "web", "src", "assets", "portraits")
RAW = os.path.join(ROOT, "web", "src", "assets", "portraits_raw")
TARGET = 256
THR = 205   # 通道下限：>= 此值算"近白"（放得比 232 松，以覆盖米白/青白背景）
TOL = 45    # 通道间最大差：容许偏色白，避免误删角色浅色


def is_whiteish(r, g, b, thr=THR, tol=TOL):
    return r >= thr and g >= thr and b >= thr and (max(r, g, b) - min(r, g, b)) <= tol


def make_transparent(im):
    """若本来就有真透明底则原样返回；否则 flood fill 抠掉与边缘连通的近白背景。"""
    a = im.getchannel("A")
    hist = a.histogram()
    if hist[0] / (im.size[0] * im.size[1]) > 0.02:
        return im, -1  # 已有透明底

    w, h = im.size
    src = im.load()
    visited = bytearray(w * h)
    dq = deque()

    def seed(x, y):
        idx = y * w + x
        if not visited[idx] and is_whiteish(*src[x, y][:3]):
            visited[idx] = 1
            dq.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while dq:
        x, y = dq.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                idx = ny * w + nx
                if not visited[idx]:
                    r, g, b, al = src[nx, ny]
                    if al > 0 and is_whiteish(r, g, b):
                        visited[idx] = 1
                        dq.append((nx, ny))

    out = im.copy()
    dst = out.load()
    removed = 0
    for y in range(h):
        row = y * w
        for x in range(w):
            if visited[row + x]:
                dst[x, y] = (0, 0, 0, 0)
                removed += 1
    return out, removed


def normalize(im):
    """裁切到角色边界 -> 等比放大到 TARGET -> 居中贴到 TARGET x TARGET 透明画布。"""
    bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        return im
    cropped = im.crop(bbox)
    cw, ch = cropped.size
    k = TARGET / max(cw, ch)
    nw, nh = max(1, round(cw * k)), max(1, round(ch * k))
    scaled = cropped.convert("RGBa").resize((nw, nh), Image.LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
    canvas.paste(scaled, ((TARGET - nw) // 2, (TARGET - nh) // 2))
    return canvas


def main():
    os.makedirs(RAW, exist_ok=True)
    names = [n for n in sorted(os.listdir(SRC)) if n.lower().endswith(".png")]
    for n in names:
        src_path = os.path.join(SRC, n)
        raw_path = os.path.join(RAW, n)
        if not os.path.exists(raw_path):
            Image.open(src_path).convert("RGBA").save(raw_path)  # 备份原图

        im = Image.open(src_path).convert("RGBA")
        im, removed = make_transparent(im)
        im = normalize(im)
        im.save(src_path)

        chk = Image.open(src_path).convert("RGBA")
        a0 = chk.getchannel("A").histogram()[0] / (TARGET * TARGET)
        box = chk.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        pct = "  已有透明底" if removed < 0 else f"抠掉 {100.0 * removed / (1024 * 1024):5.1f}%"
        print(f"{n:26s} {pct}  角落alpha={chk.getpixel((1, 1))[3]:3d}  "
              f"透明占比={a0 * 100:4.1f}%  内容框={box}")
    print("DONE")


if __name__ == "__main__":
    main()
