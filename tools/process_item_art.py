#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
道具卡立绘（武器 / 遗物…）的后处理：抠掉生成图的底色 → 裁到内容 → 补到 2:1 画布。

为什么立绘框是 **2:1**：商店卡的立绘框实测约 200×100（`aw = c.w - 36`、
`ah = artH`），是横向长条。所以道具立绘统一成 1200×600（2:1），
游戏里按 contain 缩放放进框内，任何卡高下都不会变形。

抠底策略（与潜航器那批**不同**，注意区分）：
  · 潜航器那批返回的是**假透明棋盘格**（两种灰度交替），要靠"局部窗口两种色都出现"判据；
  · 这批返回的是**均匀近白底**（实测四角 248~251、饱和 ≤5），
    而武器本身也有大片银白 —— 不能只按亮度判背景。
    这里靠 **从四边泛洪 + 紧容差**：武器有一圈深色描边，泛洪会停在描边上，
    不会漏进机身内部的白。
"""
import glob
import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

CANVAS_W, CANVAS_H = 1200, 600      # 2:1，与商店卡立绘框同比例
FILL = 0.86                          # 内容占画布长边的比例（两侧各留 7%）
BG_LUM_DROP = 32                     # 背景亮度门槛 = 四角参考亮度 − 本值
BG_SAT_MARGIN = 13                   # 背景饱和度门槛 = 四角参考饱和度 + 本值
BG_STEP = 64                         # 与**已接受的邻居**的亮度差上限（见 flood_bg）


BG_STEP = 12                         # 平底分支：与已接受邻居的亮度差上限（见 flood_bg）
CHK_WIN = 20                         # 棋盘格分支：判断"两种格色都出现"的窗口半径
CHK_RATIO = 0.15                     # 该窗口内每种格色出现的最小占比


def box_mean(img: np.ndarray, r: int) -> np.ndarray:
    """半径 r 的方框均值（积分图实现，不依赖 scipy）。"""
    h, w = img.shape
    ii = np.pad(np.cumsum(np.cumsum(img, 0), 1), ((1, 0), (1, 0)))
    ys, xs = np.arange(h), np.arange(w)
    y0, y1 = np.clip(ys - r, 0, h), np.clip(ys + r + 1, 0, h)
    x0, x1 = np.clip(xs - r, 0, w), np.clip(xs + r + 1, 0, w)
    s = ii[np.ix_(y1, x1)] - ii[np.ix_(y0, x1)] - ii[np.ix_(y1, x0)] + ii[np.ix_(y0, x0)]
    n = (y1 - y0)[:, None] * (x1 - x0)[None, :]
    return s / np.maximum(1, n)


def flood_mask(mask: np.ndarray) -> np.ndarray:
    """从四边泛洪，返回与边框连通的区域（给定 mask，无额外判据）。"""
    h, w = mask.shape
    vis = np.zeros((h, w), np.uint8)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not vis[y, x]:
                vis[y, x] = 1; dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not vis[y, x]:
                vis[y, x] = 1; dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not vis[ny, nx]:
                vis[ny, nx] = 1; dq.append((nx, ny))
    return vis.astype(bool)


def checker_pair_global(lum: np.ndarray, sat: np.ndarray):
    """在**全图**里找棋盘格的两个格色；找不到返回 None。

    ⚠️ 不能只看四角（V6.21 批 2 踩过）：有几张图是**四角平白、中间一块棋盘格**，
    只看四角会判成"平底"而漏掉中间的棋盘 → 成品里留一块浅色矩形。
    判据改成：在"亮且低饱和"的像素里找**两个质量都够大的亮度峰**（各占 >5%、相差 >12）。
    平底图只有一个峰（≈249）→ 返回 None，自动不启用棋盘分支。
    """
    m = (lum > 150) & (sat < 20)
    vals = np.round(lum[m]).astype(int)
    if vals.size < 1000:
        return None
    u, c = np.unique(vals, return_counts=True)
    order = np.argsort(-c)
    v1 = float(u[order[0]])
    for idx in order[1:]:
        v = float(u[idx])
        if abs(v - v1) > 12 and c[idx] > 0.05 * vals.size:
            return v1, v
    return None


def border_spread(lum: np.ndarray) -> float:
    """最外 8px 一圈的亮度跨度（1%~99% 分位）。

    这是**自适应容差的依据**：平底图的边框几乎同值（跨度 ≈ 3），
    带渐晕的图边框本身就跨了 30+（四角最暗）。用同一套固定容差必然在某一类上翻车。
    """
    r = 8
    ring = np.concatenate([lum[:r].ravel(), lum[-r:].ravel(),
                           lum[:, :r].ravel(), lum[:, -r:].ravel()])
    return float(np.percentile(ring, 99) - np.percentile(ring, 1))


def corner_stats(rgb: np.ndarray) -> tuple:
    """四角 64×64 的均值 / 均值亮度 / 均值饱和度 / **标准差**。

    标准差是**背景类型的判据**（V6.21）：
      · 平底（纯白或带渐晕的灰）→ 四角像素几乎同值，std ≈ 1.3~1.7；
      · **棋盘格**（生成器把"透明"画成棋盘）→ 两种格色交替，std ≈ 10。
    两种背景必须走不同的抠法，用同一套阈值一定会在某一类上图毁掉。
    """
    k = 64
    rgb_p = np.concatenate([
        rgb[:k, :k].reshape(-1, 3), rgb[:k, -k:].reshape(-1, 3),
        rgb[-k:, :k].reshape(-1, 3), rgb[-k:, -k:].reshape(-1, 3)])
    ref = rgb_p.mean(axis=0)
    return ref, float(ref.mean()), float(ref.max() - ref.min()), float(rgb_p.mean(axis=1).std())


def checker_pair(rgb: np.ndarray) -> tuple:
    """取棋盘格的两个格色（四角直方图里出现最多的两个亮度值）。"""
    k = 64
    lp = np.concatenate([
        rgb[:k, :k].mean(axis=2).ravel(), rgb[:k, -k:].mean(axis=2).ravel(),
        rgb[-k:, :k].mean(axis=2).ravel(), rgb[-k:, -k:].mean(axis=2).ravel()])
    u, c = np.unique(np.round(lp).astype(int), return_counts=True)
    order = u[np.argsort(-c)]
    v1 = float(order[0])
    v2 = next((float(v) for v in order[1:] if abs(float(v) - v1) > 8), v1 + 1)
    return v1, v2


def corner_ref(rgb: np.ndarray) -> np.ndarray:
    """四角 64×64 的均值色 = 该图的背景参考色。"""
    return corner_stats(rgb)[0]


def flood_bg(lum: np.ndarray, sat: np.ndarray,
             lum_floor: float, sat_cap: float) -> np.ndarray:
    """从四边泛洪，返回与边框连通的背景区域。

    ⚠️ 门槛**必须相对该图自己的背景参考色**来定，不能写死（V6.21 踩了两次）：
      · 第一批 6 张是**纯白底**（四角 249、饱和 1），写死 `lum>232 & sat<16` 够用；
      · 重出的电弧是**带渐晕的浅灰底**（四角 238、边缘最暗 216、且暗部带一点色偏）——
        亮度 216 过不了写死的 232，泛洪铺开 2.9% 就断，**整块背景留在成品里**
        （实机能看到一块浅灰方块）。
    所以：亮度门槛取 `参考亮度 − BG_LUM_DROP`（容得下渐晕），
    饱和度门槛取 `参考饱和度 + BG_SAT_MARGIN`（白底图自动收紧到 14，
    刚好挡住酸液罐体浅绿反锯齿处那条"低饱和桥"，不会被漏进去）。

    另有**连续性**要求：只接受与已接受邻居亮度差 < BG_STEP 的像素。
    这一步挡的是"背景与武器之间只有很弱的过渡"的情况；但上限必须**足够大**：
    重出的电弧那张背景是**棋盘格**，相邻两格亮度差约 42 ——
    上限卡在 12 时泛洪跨不过格子边界，只在起始格子里打转，
    结果是成品里留了一整块 783×516 的矩形（实机就是个浅色方块）。
    取 64：跨得过棋盘格（42），又挡得住机身外圈深色描边那种大跳变。
    """
    h, w = lum.shape
    vis = np.zeros((h, w), np.uint8)
    dq = deque()

    def seed(x: int, y: int) -> None:
        if not vis[y, x] and lum[y, x] > lum_floor and sat[y, x] < sat_cap:
            vis[y, x] = 1
            dq.append((x, y))

    for x in range(w):
        seed(x, 0); seed(x, h - 1)
    for y in range(h):
        seed(0, y); seed(w - 1, y)
    while dq:
        x, y = dq.popleft()
        l0 = lum[y, x]
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not vis[ny, nx] \
                    and sat[ny, nx] < sat_cap and abs(lum[ny, nx] - l0) < BG_STEP:
                vis[ny, nx] = 1
                dq.append((nx, ny))
    return vis.astype(bool)


def keep_components(alpha: np.ndarray) -> np.ndarray:
    """丢掉零散噪点（水印、抠底残留），但**保留所有像样的连通域**。

    ⚠️ 不能只保留"最大的那一个"（V6.21 踩过）：电弧那张的**电极臂与紫色闪电**
    和炮身之间是分开的独立连通域，只留最大块会把它们一起丢掉 ——
    成品内容宽度从应有的约 780px 掉到 404px，比原来那版竖直构图还窄。
    判据改成"面积 ≥ 最大块的 3% 且 ≥ 64px"，噪点仍然会被清掉。
    """
    h, w = alpha.shape
    fg = alpha > 40
    vis = np.zeros((h, w), np.uint8)
    comps = []
    for sy in range(0, h, 4):
        for sx in range(0, w, 4):
            if not fg[sy, sx] or vis[sy, sx]:
                continue
            dq = deque([(sx, sy)]); vis[sy, sx] = 1; pts = [(sx, sy)]
            while dq:
                x, y = dq.popleft()
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and fg[ny, nx] and not vis[ny, nx]:
                        vis[ny, nx] = 1; dq.append((nx, ny)); pts.append((nx, ny))
            comps.append(pts)
    if not comps:
        return alpha
    biggest = max(len(p) for p in comps)
    out = np.zeros((h, w), np.uint8)
    for pts in comps:
        if len(pts) < 64 or len(pts) < biggest * 0.03:
            continue
        xs, ys = zip(*pts)
        xi, yi = np.array(xs), np.array(ys)
        out[yi, xi] = alpha[yi, xi]
    return out


def process(src: str, dst: str) -> dict:
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    rgb = a.astype(float)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)

    ref, ref_lum, ref_sat, ref_std = corner_stats(rgb)
    lum_floor = ref_lum - BG_LUM_DROP
    sat_cap = ref_sat + BG_SAT_MARGIN

    # 先做棋盘格检测：它的结果会决定下面平底分支用多紧的容差
    pair = checker_pair_global(lum, sat)

    # ---- 分支 1：平底（纯白 / 带渐晕的浅灰）----
    # ⚠️ 容差必须**自适应**，不能写死（批 2 的 arc_ov 就是被写死的宽门槛啃碎的：
    # 那张是"纯白武器压在纯白底上"，机身没有强描边，门槛一松泛洪就直接漏进机身，
    # 把电极臂和炮身冲散成几块）。
    #   · **有棋盘格** → 紧容差 9。棋盘格那一路会覆盖其余背景，这里只要别误伤白机身
    #     （基础电弧就是这么被反向带坏的：底是棋盘格、机身是白的，宽松门槛一开就漏）。
    #   · **无棋盘格** → 容差 = 边框自己的亮度跨度 + 6：平底跨度≈3 → 9；
    #     带渐晕跨度≈35 → 41（容得下渐晕）。
    spread = border_spread(lum)
    tol = 9.0 if pair else max(9.0, spread + 6)
    ok = (np.abs(lum - ref_lum) <= tol) & (sat < sat_cap) & (lum > ref_lum - 70)
    bg = flood_mask(ok)

    # ---- 分支 2：棋盘格（生成器把"透明"画成棋盘）----
    # 必须**另起一次判定并取并集**：有几张是"四角平白 + 中间一块棋盘格"，
    # 二选一必然漏掉一边（实测 gun_sg / torp_hv / arc_ov 都留了一块棋盘矩形）。
    # 结构判据：**任一局部窗口里两种格色都出现**（交替）→ 背景；机身白是一整片单色 → 不是。
    if pair:
        v1, v2 = pair
        e1 = np.abs(lum - v1) <= 5
        e2 = np.abs(lum - v2) <= 5
        near = e1 | e2
        b1 = box_mean(e1.astype(float), CHK_WIN)
        b2 = box_mean(e2.astype(float), CHK_WIN)
        striped = (b1 > CHK_RATIO) & (b2 > CHK_RATIO)
        chk = striped & near & (sat < ref_sat + 26) & (lum > ref_lum - 60)
        bg = bg | chk
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # 吃 1px 去白边（浅底尤其明显）+ 轻微羽化
    alpha = np.asarray(Image.fromarray(alpha)
                       .filter(ImageFilter.MinFilter(3))
                       .filter(ImageFilter.GaussianBlur(0.5)))
    alpha = keep_components(alpha)

    # 全透明像素的 RGB 填成主体均值色，避免缩放时把透明区的黑混进边缘
    out = np.dstack([a.astype(np.uint8), alpha])
    img = Image.fromarray(out, 'RGBA')
    op = np.asarray(img)[:, :, 3] > 40
    arr = np.asarray(img).astype(np.float32).copy()
    if op.sum():
        arr[~op, :3] = arr[op, :3].mean(axis=0)
    img = Image.fromarray(arr.astype(np.uint8), 'RGBA')
    bb = img.getbbox()
    if bb:
        img = img.crop(bb)
    cw, ch = img.size
    k = min(CANVAS_W * FILL / cw, CANVAS_H * FILL / ch)
    img = img.resize((max(1, round(cw * k)), max(1, round(ch * k))), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    canvas.paste(img, ((CANVAS_W - img.width) // 2, (CANVAS_H - img.height) // 2))
    canvas.save(dst)

    b = np.asarray(canvas).astype(float)
    m = b[:, :, 3] > 10
    l2 = b[:, :, :3][m].mean(axis=1)
    return {'size': canvas.size, 'cover': 100 * m.mean(),
            'mean': l2.mean(), 'hi': 100 * (l2 > 150).mean(),
            'content': (img.width, img.height)}


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    regen = os.path.join(root, 'web', 'src', 'assets', 'items', '_regen')
    dest = os.path.join(root, 'web', 'src', 'assets', 'items')
    files = sorted(glob.glob(os.path.join(regen, '*.png')))
    if not files:
        raise SystemExit('_regen 下没有生成图')
    for f in files:
        base = os.path.basename(f)
        # 用文件名里的关键词判断是哪个道具。
        # ⚠️ 生成的文件名是**提示词前 16 个汉字的截断**，所以：
        #   ① 提示词必须**以道具名开头**，否则 7 张的前 16 字完全一样、无法区分；
        #   ② 关键词要用靠前的片段，不能写完整词（"机关枪"会被截掉）。
        name = None
        for kw, nid in (
                        # 批 5b：V6.77d 四件机制遗物（独立物件，无炮座底座）
                        ('导体缠绕', 'conductor_coil'), ('破血锚', 'bleeding_anchor'),
                        ('共鸣腔', 'resonance_chamber'), ('过载核心', 'overload_core'),
                        # 批 5a：V6.47 三把机制武器 + 六条进化（V6.77d 实际出图）
                        #   ⚠️ 必须排在批 4 之前：新词"雷"字族与旧词「定点雷」同尾，
                        #      且"生物光诱饵"含"光"、与「光墙」同首 —— 靠前 3 字区分，故全部前置。
                        ('气泡雷', 'mine'), ('连锁雷', 'mine_ch'), ('氧气雷', 'mine_o2'),
                        ('网发射', 'net'), ('电网', 'net_el'), ('驯化网', 'net_cv'),
                        ('生物光', 'lure'), ('爆炸诱', 'lure_bo'), ('光墙', 'lure_wl'),
                        # 批 4：V6.30 新增进化（image-to-image 由基础武器改造）
                        # ⚠️ 必须排在最前："聚焦回声炮" 里含 "回声炮" 三个连续字，
                        #    排在基础武器之后就永远匹配不到。
                        ('三重鱼', 'harp_tr'), ('回旋鱼', 'harp_cb'),
                        ('多重回', 'echo_mu'), ('聚焦回', 'echo_fo'),
                        ('持久酸', 'acid_fd'), ('酸雨', 'acid_ra'),
                        # 批 3：遗物（独立物件，键 = RelicId）
                        ('回声心脏', 'echo_heart'), ('骨殖转化', 'osteoblast'),
                        ('潮汐罗盘', 'tidal_compass'), ('共振核心', 'resonance_core'),
                        ('贪食腺体', 'gluttony'), ('深潜印记', 'abyss_mark'),
                        # ⚠️ 这条提示词里"鳍"被打成了"鰍"，文件名同错 —— 用"洋流"匹配
                        ('洋流', 'current_fin'), ('静默装甲', 'silent_plating'),
                        # 批 1：基础武器
                        ('六管脉', 'gun'), ('声呐共', 'sonar'), ('双联追', 'torpedo'),
                        ('链式电', 'arc'), ('穿透鱼', 'harpoon'),
                        ('回声炮', 'echo'), ('酸液喷', 'acid'),
                        # 批 2：进化形态（image-to-image 由基础武器改造而来，见 ITEM_ART）
                        ('加特林', 'gun_gl'), ('霰弹散', 'gun_sg'),
                        ('集束鱼', 'torp_cl'), ('重型鱼', 'torp_hv'),
                        ('过载电', 'arc_ov'), ('定点雷', 'arc_st'),
                        ('共振声', 'sonar_rs'), ('定向聚', 'sonar_fc')):
            if kw in base:
                name = nid
                break
        if not name:
            print('跳过无法识别的文件:', base)
            continue
        dst = os.path.join(dest, 'item_%s.png' % name)
        r = process(f, dst)
        print('[%-8s] 内容 %dx%d -> 画布 %dx%d  覆盖 %.1f%%  平均亮度 %.0f  亮部>150 %.1f%%'
              % (name, r['content'][0], r['content'][1], r['size'][0], r['size'][1],
                 r['cover'], r['mean'], r['hi']))
