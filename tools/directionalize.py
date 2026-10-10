"""
把 AI 生成的"多朝向"立绘（背身 / 侧面）处理成游戏内可用的透明底小图。

背景：
    主角原本只有一张正面立绘，左右翻转在视觉上几乎无差别（正面站姿基本对称），
    所以按 WASD 时玩家会觉得"角色不会转身"。这里补上背身（向上移动）与侧面
    （向左/右移动）两套姿态，4 向转向才真正看得出来。

处理流程与 process_portraits.py 完全一致，保证新图与已有正面图**同一基准**：
    1) flood fill 抠掉与画布边缘连通的近白背景（角色内部眼白保留）
    2) 裁切到角色边界后等比放大到 256x256 画布（max 边 = 256）
       —— 正面图当年就是这么归一化的，用同一逻辑才能保证换朝向时人物大小不跳变
    3) 原图备份到 portraits_raw/directional/，仓库只留 256 小图

输出命名：web/src/assets/portraits/<role>_<dir>.png
    dir: front(已有的正面图，不动) / back / side(朝右，朝左靠 flipX)
"""
import os
import shutil

from process_portraits import TARGET, make_transparent, normalize, SRC, RAW
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "tools", "directional_raw")
RAW_BACKUP = os.path.join(RAW, "directional")

# 生成结果 -> 目标文件名。名字带时间戳且多张撞车过，故按内容人工映射一次。
JOBS = {
    "rookie_back":    "Chibi_anime_game_sprite_sheet__2026-10-09T04-52-57.png",
    "rookie_side":    "Chibi_anime_game_sprite__full__2026-10-09T04-53-20.png",
    "guanyu_back":    "Chibi_anime_game_sprite__BACK__2026-10-09T04-55-30.png",
    "guanyu_side":    "Chibi_anime_game_sprite__full__2026-10-09T04-55-31.png",
    "zhangfei_side":  "Chibi_anime_game_sprite__full__2026-10-09T04-55-30.png",
    "zhangfei_back":  "tmp_zy_side/Chibi_anime_game_sprite__BACK__2026-10-09T04-56-06.png",
    "zhaoyun_back":   "Chibi_anime_game_sprite__BACK__2026-10-09T04-55-29.png",
    "zhaoyun_side":   "tmp_zy_side/Chibi_anime_game_sprite__full__2026-10-09T04-56-06.png",
}


def main():
    os.makedirs(RAW_BACKUP, exist_ok=True)
    os.makedirs(SRC, exist_ok=True)
    print(f"{'file':22s} {'抠掉':>7s}  {'内容框(w x h)':>16s}  {'占画布':>7s}")
    for name, rel in JOBS.items():
        src = os.path.join(RAW_DIR, rel)
        if not os.path.exists(src):
            print(f"{name:22s}  !! 缺原图 {rel}")
            continue

        shutil.copy2(src, os.path.join(RAW_BACKUP, name + ".png"))

        im = Image.open(src).convert("RGBA")
        im, removed = make_transparent(im)
        im = normalize(im)

        out = os.path.join(SRC, name + ".png")
        im.save(out, optimize=True)

        chk = Image.open(out).convert("RGBA")
        box = chk.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        w = box[2] - box[0]
        h = box[3] - box[1]
        pct = "      已有透明底" if removed < 0 else f"{100.0 * removed / (1024 * 1024):6.1f}%"
        print(f"{name:22s} {pct}  {w:6d} x {h:5d}  {100.0 * w / TARGET:5.1f}% x {100.0 * h / TARGET:5.1f}%")

    # 顺带把已有正面图的内容框也打出来，用于核对各朝向的身高是否接近
    print("\n---- 已有正面图基准 ----")
    for ch in ("rookie", "guanyu", "zhangfei", "zhaoyun"):
        p = os.path.join(SRC, ch + ".png")
        im = Image.open(p).convert("RGBA")
        box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        w = box[2] - box[0]
        h = box[3] - box[1]
        print(f"{ch:22s}         {w:6d} x {h:5d}  {100.0 * w / TARGET:5.1f}% x {100.0 * h / TARGET:5.1f}%")
    print("DONE")


if __name__ == "__main__":
    main()
