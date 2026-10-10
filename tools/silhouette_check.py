#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
剪影自检工具（Silhouette Self-Check）
===================================

为什么需要这个工具
------------------
本项目现有 16 个单位（4 玩家 + 12 敌人）全部由`pixelgen.py` 的
`draw_head / draw_torso / draw_legs` 绘制 —— 这三个函数是**人形专用骨架**。
每个单位只是换配色 + 头饰，因此：

    **在纯黑剪影下，16 个单位看起来几乎完全一样。**

在弹幕里同屏50+ 单位时，玩家无法判断"哪个是哪个、哪个在打我、哪个要先杀"。
这是可玩性问题，不是审美问题。

这个工具做两件事：
  1. 把现有 16 个单位渲染成 **纯黑剪影掩码**（1-bit mask），
     直观暴露问题严重程度 —— 把主观判断变成客观事实。
  2. 量化分析：逐像素计算单位间的**剪影 IoU（交并比）**，
     给出"哪些单位撞剪影了"的数字结论。

它**不修改任何现有资产**，只读 `pixelgen.py` 的绘制函数。

用法
----
    python3 tools/silhouette_check.py                # 出报告 + 预览图
    python3 tools/silhouette_check.py --scale 8      # 放大预览
    python3 tools/silhouette_check.py --no-image# 只出数字，不出图

输出
----
    docs/_silhouette/silhouette-report.md   分析报告
    docs/_silhouette/silhouette-preview.png 剪影对照图（纯黑）
    docs/_silhouette/silhouette-color.png   对照图（彩色，供参考）
"""
import os
import sys
import json
import argparse

# 让本文件能 import 同目录的 pixelgen
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont
import pixelgen as pg

OUT_DIR = os.path.join(pg.DOCS_DIR, '_silhouette')


# --------------------------------------------------------------------------
# 1-bit 剪影化
# --------------------------------------------------------------------------
def to_mask(img):
    """RGBA → 纯黑剪影（1-bit mask）：不透明处纯黑，透明处挖空。

    刻意**不做高斯模糊 / 不做描边** —— 要看的就是最原始的轮廓事实。
    描边会"填满"凹陷，让本来可辨的形状变得不可辨，反而掩盖问题。
    """
    alpha = img.getchannel('A')
    # 阈值二值化：alpha >= 128 视为实心
    mask = alpha.point(lambda a: 255 if a >= 128 else 0)
    solid = Image.new('RGBA', img.size, (0, 0, 0, 255))
    solid.putalpha(mask)
    return solid


def trim(img):
    """裁到 alpha 包围盒 —— 剪影对比必须按"实际占位"比，否则体型差异会被画布稀释。"""
    bb = img.getbbox()
    return img.crop(bb) if bb else img


def mask_signature(img):
    """把剪影归一化到固定网格，返回布尔矩阵（用于 IoU 计算）。"""
    t = trim(to_mask(img))
    if t.size[0] == 0 or t.size[1] == 0:
        return [[]]
    # 归一化到 32x32，保留长宽比（contain 而非 stretch，避免细长形被压胖）
    n = 32
    scale = min(n / t.size[0], n / t.size[1])
    w, h = max(1, int(t.size[0] * scale)), max(1, int(t.size[1] * scale))
    r = t.resize((w, h), Image.NEAREST)
    canvas = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    canvas.paste(r, ((n - w) // 2, (n - h) // 2), r)
    a = canvas.getchannel('A')
    return [[1 if a.getpixel((x, y)) >= 128 else 0 for x in range(n)]
            for y in range(n)]


def iou(sig_a, sig_b):
    """交并比：1.0 = 剪影完全相同；< 0.4 = 肉眼可区分；> 0.7 = 高度撞车。"""
    inter = union = 0
    for ra, rb in zip(sig_a, sig_b):
        for a, b in zip(ra, rb):
            if a or b:
                union += 1
                if a and b:
                    inter += 1
    return inter / union if union else 0.0


# --------------------------------------------------------------------------
# 报告
# --------------------------------------------------------------------------
CN_NAME = {
    'rookie': '深潜者（玩家）', 'guanyu': '拾光者（玩家）',
    'zhangfei': '铸壳者（玩家）', 'zhaoyun': '电鳗使（玩家）',
    'minion': '胶质漂群', 'runner': '鳞甲快游群', 'tank': '钙壳管虫丛',
    'swarm': '荧光幼体群', 'shooter': '光诱鮟鱇', 'shield': '骨甲近卫',
    'elite': '骨质触手游丝',
    'boss_warlord': '深渊领主·管巢母体（BOSS / tower）',
    'boss_yanliang': '断锚·骨触巨螯（BOSS / shell）',
    'boss_caocao': '万鳞·鳞潮母舰（BOSS / school）',
    'boss_ganning': '疾行·电鳗王（BOSS / serpent）',
    'boss_tyrant': '吞光者·利维坦幼体（BOSS / leviathan）',
}


def collect():
    """收集所有单位的朝下·待机帧（剪影最容易暴露问题的姿态）。

    ⚠️ 关键改动（P1b 换壳时）：**直接读 `web/src/assets/pixel/*.png` 的实际产物**，
    不再调`pixelgen.draw_unit()`。

    为什么必须这样：换壳后深海单位由 `tools/deepsea_assets.py` 的 6 个**族绘制函数**
    生成，跟 `pixelgen.draw_unit()` 的人形骨架已经完全没关系了。
    继续调旧函数的话，脚本跑出来的报告描述的是**玩具兵**那一套资产 ——
    报告里出现"锡兵上校 ↔ 发条侦察兵 IoU 0.947"，而游戏里根本没有这些单位。
    一份描述旧资产的报告比没有报告更糟：它看起来是有效的验证。

    读实际 PNG 还有个额外好处：**这就是游戏加载的那张图**。
    之前"验证的资产"和"游戏用的资产"是两条线，中间隔着一层绘制函数调用，
    任何生成环节的改动都不会被这个检查捕捉到。
    """
    items = []
    mf_path = os.path.join(pg.ASSET_DIR, 'manifest.json')
    with open(mf_path, encoding='utf-8') as f:
        mf = json.load(f)
    units = mf['units']
    cell = int(mf['grid'])

    for key in sorted(units):
        spec = units[key]
        path = os.path.join(pg.ASSET_DIR, spec['sheet'])
        if not os.path.exists(path):
            continue
        sheet = Image.open(path).convert('RGBA')
        # 第 0 行第 0 列 = 朝下 · 待机 · 帧 0
        frame = sheet.crop((0, 0, cell, cell))
        up = int(spec.get('upscale', 1))
        if up != 1:
            frame = frame.resize((cell, cell), Image.NEAREST)
        group = 'hero' if key.startswith('hero_') else 'foe'
        uid = key.split('_', 1)[1]
        items.append({
            'key': key,
            'uid': uid,
            'group': group,
            'name': CN_NAME.get(uid, uid),
            'build': f"zoom{spec.get('zoom', 1)}",
            'img': frame,
            'sil': to_mask(frame),
            'sig': mask_signature(frame),
            'w': frame.size[0], 'h': frame.size[1],
        })
    return items


def analyse(items, thr_same=0.82, thr_close=0.65):
    """两两比对剪影，输出撞车分组。"""
    pairs = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            v = iou(items[i]['sig'], items[j]['sig'])
            pairs.append((v, items[i]['name'], items[j]['name'],
                          items[i]['key'], items[j]['key']))
    pairs.sort(reverse=True)

    same = [p for p in pairs if p[0] >= thr_same]
    close = [p for p in pairs if thr_close <= p[0] < thr_same]
    ok = [p for p in pairs if p[0] < thr_close]

    stats = {}
    if pairs:
        vals = [p[0] for p in pairs]
        stats['pairs'] = len(pairs)
        stats['max'] = max(vals)
        stats['mean'] = sum(vals) / len(vals)
        stats['min'] = min(vals)
        stats['same'] = len(same)
        stats['close'] = len(close)
        stats['ok'] = len(ok)

    # 按体型分组，验证"体型差异是否有效"
    by_build = {}
    for it in items:
        by_build.setdefault(it['build'], []).append(it['name'])

    return pairs, same, close, ok, stats, by_build


def make_preview(items, scale=4, mode='sil'):
    """生成对照图。mode='sil' 纯黑剪影，mode='color' 彩色参考。"""
    zoom = scale
    cell = pg.GRID * zoom
    pad = 10
    lab_w = 168
    head = 52
    row_h = cell + pad
    total_h = head + len(items) * row_h + pad
    total_w = lab_w + cell + pad * 2

    bg = (255, 255, 255, 255) if mode == 'sil' else (24, 22, 32, 255)
    im = Image.new('RGBA', (total_w, total_h), bg)
    dr = ImageDraw.Draw(im)
    f_big = pg.load_font(20)
    f_sm = pg.load_font(13)
    f_tiny = pg.load_font(11)

    title = ('剪影自检 · 纯黑1-bit 掩码（去掉所有颜色与描边）'
             if mode == 'sil' else
             '剪影自检 · 彩色对照（同样去掉描边，仅供参考）')
    tcol = (20, 20, 24, 255) if mode == 'sil' else (240, 238, 246, 255)
    dr.text((16, 12), title, font=f_big, fill=tcol)
    dr.text((16, 34), '如果这些轮廓看起来一样 → 弹幕中玩家无法区分单位',
            font=f_tiny, fill=(110, 110, 118, 255) if mode == 'sil'
            else (150, 148, 160, 255))

    y = head
    for it in items:
        src = it['sil'] if mode == 'sil' else it['img']
        r = src.resize((cell, cell), Image.NEAREST)
        # 网格参考线（每 4 逻辑像素）
        dr.rectangle([lab_w, y, lab_w + cell, y + cell],
                     outline=(200, 200, 205, 255) if mode == 'sil'
                     else (60, 60, 70, 255))
        for gy in range(1, 4):
            yy = y + cell * gy // 4
            dr.line([lab_w, yy, lab_w + cell, yy],
                    fill=(225, 225, 230, 255) if mode == 'sil'
                    else (44, 44, 52, 255))

        dr.text((14, y + cell // 2 - 18), it['name'], font=f_sm, fill=tcol)
        dr.text((14, y + cell // 2 - 2), f"build={it['build']}",
                font=f_tiny, fill=(120, 120, 128, 255))
        dr.text((14, y + cell // 2 + 12), f"{it['w']}x{it['h']}px",
                font=f_tiny, fill=(120, 120, 128, 255))
        im.paste(r, (lab_w, y), r)
        y += row_h
    return im


# --------------------------------------------------------------------------
# 人工辨识测试
# --------------------------------------------------------------------------
def human_test(items, same, close):
    """生成盲测题：随机 6 组「参考剪影 + 4 选项」，供人工/多人测试辨识率。

    这是把"1/8 秒可辨"从口号变成可测指标的工具。
    """
    import random
    random.seed(20261010)
    qs = []
    pool = [it for it in items]
    for n in range(6):
        ref = random.choice(pool)
        distract = [it for it in pool if it['key'] != ref['key']]
        random.shuffle(distract)
        opts = distract[:3] + [ref]
        random.shuffle(opts)
        qs.append((ref, opts))
    return qs


def build_human_test_sheet(qs, scale=3):
    """输出盲测图：左侧参考剪影，右侧 4 个候选（编号 A/B/C/D）。"""
    zoom = scale
    cell = pg.GRID * zoom
    pad = 12
    head = 54
    row_h = cell + pad * 2
    total_h = head + len(qs) * row_h + pad
    total_w = 64 + cell + pad + 4 * (cell + pad)
    im = Image.new('RGBA', (total_w, total_h), (255, 255, 255, 255))
    dr = ImageDraw.Draw(im)
    f_big = pg.load_font(20)
    f_sm = pg.load_font(13)
    dr.text((16, 12), '剪影辨识盲测 · 参考 vs 4 个候选',
            font=f_big, fill=(20, 20, 24, 255))
    dr.text((16, 34), '请在 1 秒内选出与参考相同的一个，记下耗时与是否正确',
            font=f_sm, fill=(110, 110, 118, 255))

    y = head
    for i, (ref, opts) in enumerate(qs, 1):
        dr.text((16, y + cell // 2), f'第{i} 题', font=f_sm, fill=(20, 20, 24, 255))
        r = ref['sil'].resize((cell, cell), Image.NEAREST)
        dr.rectangle([64, y, 64 + cell, y + cell], outline=(170, 170, 176, 255))
        im.paste(r, (64, y), r)
        x = 64 + cell + pad
        for k, opt in enumerate(opts):
            letter = 'ABCD'[k]
            dr.text((x, y + 4), letter, font=f_sm, fill=(90, 90, 98, 255))
            o = opt['sil'].resize((cell, cell), Image.NEAREST)
            dr.rectangle([x, y, x + cell, y + cell], outline=(210, 210, 216, 255))
            im.paste(o, (x, y), o)
            x += cell + pad
        y += row_h
    return im


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--no-image', action='store_true')
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    items = collect()
    pairs, same, close, ok, stats, by_build = analyse(items)

    print(f'采集单位：{len(items)} 个')
    print(f'两两比对：{stats["pairs"]} 对')
    print(f'  IoU 均值 {stats["mean"]:.3f}   最高 {stats["max"]:.3f}   最低 {stats["min"]:.3f}')
    print(f'  撞车(≥0.82剪影几乎相同)：{stats["same"]} 对')
    print(f'  高度相似(0.65~0.82)     ：{stats["close"]} 对')
    print(f'  可区分(<0.65)          ：{stats["ok"]} 对')

    if same:
        print('\n【撞车清单】IoU ≥ 0.82 —— 剪影几乎完全相同：')
        for v, a, b, ka, kb in same[:20]:
            print(f'  {v:.3f}  {a}  ↔  {b}')

    if not args.no_image:
        p1 = make_preview(items, args.scale, 'sil')
        f1 = os.path.join(OUT_DIR, 'silhouette-preview.png')
        p1.save(f1)
        p2 = make_preview(items, args.scale, 'color')
        f2 = os.path.join(OUT_DIR, 'silhouette-color.png')
        p2.save(f2)
        qs = human_test(items, same, close)
        p3 = build_human_test_sheet(qs)
        f3 = os.path.join(OUT_DIR, 'silhouette-blindtest.png')
        p3.save(f3)
        print(f'\n输出：\n  {f1}\n  {f2}\n  {f3}')

        answers = [{'q': i, 'ref': r['name'], 'ref_key': r['key'],
                    'options': [o['name'] for o in opts],
                    'answer': 'ABCD'[[o['key'] for o in opts].index(r['key'])]}
                   for i, (r, opts) in enumerate(qs, 1)]

        # Markdown 报告
        L = []
        A = L.append
        A('# 剪影自检报告')
        A('')
        A(f'> 自动生成 · {len(items)} 个单位 · IoU = 剪影交并比'
          f'（1.0=完全相同，<0.4=肉眼可区分）')
        A('')
        A('## 结论')
        A('')
        if stats['same']:
            A(f"**❌ 剪影撞车严重** —— {stats['same']} 对单位的剪影几乎完全相同"
              f"（IoU ≥ 0.82）。这意味着在弹幕中玩家无法区分它们。")
        else:
            A(f"**✅ 剪影基本可辨** —— 无IoU ≥ 0.82 的撞车对。")
        A('')
        A('| 指标 | 数值 |')
        A('|---|---|')
        A(f"| 采集单位 | {len(items)} |")
        A(f"| 比对对数 | {stats['pairs']} |")
        A(f"| IoU 均值 | **{stats['mean']:.3f}** |")
        A(f"| IoU 最高 | {stats['max']:.3f} |")
        A(f"| 撞车（≥0.82） | **{stats['same']}** |")
        A(f"| 高度相似（0.65~0.82） | {stats['close']} |")
        A(f"| 可区分（<0.65） | {stats['ok']} |")
        A('')
        A('## 撞车清单（剪影几乎相同）')
        A('')
        if same:
            A('| IoU | 单位 A | 单位 B |')
            A('|---|---|---|')
            for v, a, b, _, _ in same[:30]:
                A(f'| {v:.3f} | {a} | {b} |')
        else:
            A('无。')
        A('')
        A('## 相似度 Top 15')
        A('')
        A('| IoU | 单位 A | 单位 B | 判定 |')
        A('|---|---|---|---|')
        for v, a, b, _, _ in pairs[:15]:
            j = '🔴 撞车' if v >= 0.82 else ('🟠 相似' if v >= 0.65 else '🟢 可辨')
            A(f'| {v:.3f} | {a} | {b} | {j} |')
        A('')
        A('## 按体型分组')
        A('')
        A('| build | 单位数 | 单位 |')
        A('|---|---|---|')
        for k, v in sorted(by_build.items(), key=lambda x: -len(x[1])):
            A(f"| `{k}` | {len(v)} | {'、'.join(v)} |")
        A('')
        A('> **`build` 是唯一区分手段** —— 单位全部共用同一套人形骨架，'
          '颜色与头饰在纯黑剪影下不产生任何差异。')
        A('')
        A('## 盲测题答案')
        A('')
        A('`docs/_silhouette/silhouette-blindtest.png` · 6 题，每题 4 选项')
        A('')
        A('| 题号 | 参考 | 答案 |')
        A('|---|---|---|')
        for a_ in answers:
            A(f"| {a_['q']} | {a_['ref']} | **{a_['answer']}** |")
        A('')
        A('## 后续动作')
        A('')
        A('1. 按 `美术资源计划.md` §3 扩展 6 个剪影族（bell/tower/serpent/shell/school/leviathan）')
        A('2. 重跑本工具，验证 IoU 是否降到 0.65 以下')
        A('3. 用盲测图实测辨识率，目标 ≥ 90%')
        A('')
        f_md = os.path.join(OUT_DIR, 'silhouette-report.md')
        with open(f_md, 'w', encoding='utf-8') as fp:
            fp.write('\n'.join(L))
        print(f'  {f_md}')


if __name__ == '__main__':
    main()