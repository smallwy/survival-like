# -*- coding: utf-8 -*-
"""
美术资源同步：web/src/assets  →  cocos/assets/resources

和 `sync_shared.py` 是同一套思路（**单一真源 + 复制 + 漂移检测**），只是这里
复制的是图片而不是代码。理由也一样：Cocos 只能从 `assets/` 下加载资源，而
`resources/` 是 `resources.load()` 唯一认的目录名（必须叫 resources，不能改名）。

---------------------------------------------------------------------------
为什么要做转换，而不是原样复制
---------------------------------------------------------------------------
1) **五层背景是 .webp**。cocos.d.ts 里 `macro.SUPPORT_TEXTURE_FORMATS` 写着
   `['.astc','.pkm','.pvr','.webp','.jpg','.jpeg','.bmp','.png']` —— 但那是
   **引擎运行时**支持的格式，不等于**编辑器导入器**支持。我无法在沙箱里开
   编辑器验证，而一旦不支持，症状是导入失败/图丢失，排查成本远高于转换。
   所以统一转成 PNG。代价是 0.37 MB → 3.6 MB，换来的是零风险。

2) **道具立绘是 1200×600**，23 张共 9.83 MB，而商店卡里的立绘框在 sim 坐标里
   只有约 268×96（设计分辨率 1304×749）。1200 宽是显示尺寸的 4.5 倍，
   纯属浪费内存与加载时间。降到 600×300 正好是**显示尺寸的 2 倍**
   （高分屏够用），体积 9.83 MB → 2.80 MB。

   ⚠️ 这条是**质量中性的降采样**，不是"为了省体积牺牲画质"：
   2× 是 retina 的标准余量，再高在 96px 高的框里看不出来。

3) fish / sub 原样复制（要保留 alpha；体积本来就小）。

---------------------------------------------------------------------------
用法
---------------------------------------------------------------------------
    python tools/sync_art.py            # 同步（写盘）
    python tools/sync_art.py --check    # 只检查漂移，不写盘

`--check` 会读 `tools/art_manifest.json` 里记录的两个哈希做双向核对：
  · 源文件变了（web 侧换了图）→ 提示重新同步
  · 目标文件被改过（cocos 侧手改了副本）→ 提示副本被污染
因此 `--check` **不需要重新编码图片**，也就不会因为 Pillow 版本升级而假报漂移。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src" / "assets"
DEST = ROOT / "cocos" / "assets" / "resources"
MANIFEST = Path(__file__).resolve().parent / "art_manifest.json"

# 道具立绘的降采样目标（见文件头 2)）
ITEM_W, ITEM_H = 600, 300

# ---------------------------------------------------------------------------
# 清单：(源相对路径, 目标相对路径, 变换)
#   copy        原样复制
#   webp2png    webp → PNG（尺寸不变）
#   item        降采样到 ITEM_W×ITEM_H 的 PNG
#
# 只列**实际被代码引用**的资源。web 侧另有 fish/_regen、sub/_regen_v2、
# weapons/*.png 等，都是历史中间产物或已废弃（`w_gun` 这类键现在只出现在
# 卡片 id 字符串里，不作为贴图使用），不进清单。
# ---------------------------------------------------------------------------
_ASSET_RULES: list[tuple[str, str, str]] = [
    # ---- 五层环境背景（DiveScene: ENV_BG / bg.setTexture(`env${layerIdx}`)）----
    ("env/L1.webp", "env/L1.png", "webp2png"),
    ("env/L2.webp", "env/L2.png", "webp2png"),
    ("env/L3.webp", "env/L3.png", "webp2png"),
    ("env/L4.webp", "env/L4.png", "webp2png"),
    ("env/L5.webp", "env/L5.png", "webp2png"),
    # ---- 敌人贴图（key 见 shared/dive/tables.ts ENEMY_TEX）----
    ("fish/swarm.png", "fish/swarm.png", "copy"),
    ("fish/drift.png", "fish/drift.png", "copy"),
    ("fish/dash.png", "fish/dash.png", "copy"),
    # V6.62 第 4 类「重甲」：**必须与 ENEMY_TEX 一一对应** ——
    #   `artKeys.ts` 从 ENEMY_TEX 推导 key，`verify_cocos` 又要求每个 key 在磁盘上有文件，
    #   所以"加了敌人类型却忘了加这一行"会在验证阶段直接红，而不是上线才发现少张图。
    ("fish/armor.png", "fish/armor.png", "copy"),
    # V6.79 第 5 类「盘旋猎手」。同一条硬约束：**ENEMY_TEX 加了 key，这里就欠一行**，
    #   漏了会在验证阶段直接红（`artKeys` 从 ENEMY_TEX 推导、闸门要求 key 落盘）。
    ("fish/orbit.png", "fish/orbit.png", "copy"),
    # V6.82 第一批新生物（6 张：5 种真生物 + 1 个副产品幼体）。
    #   同一条硬约束 —— 这里是从 `ENEMY_TEX` 逐行抄下来的，少了哪一行闸门就红。
    ("fish/splitter.png", "fish/splitter.png", "copy"),
    ("fish/shard.png", "fish/shard.png", "copy"),
    ("fish/bulwark.png", "fish/bulwark.png", "copy"),
    ("fish/brood.png", "fish/brood.png", "copy"),
    ("fish/kamikaze.png", "fish/kamikaze.png", "copy"),
    ("fish/herder.png", "fish/herder.png", "copy"),
    # ---- 潜航器机体（正俯视；SUB_ART_PATH 指向其中三张）----
    ("sub/sub_lumen.png", "sub/sub_lumen.png", "copy"),
    ("sub/sub_raia.png", "sub/sub_raia.png", "copy"),
    ("sub/sub_bathy.png", "sub/sub_bathy.png", "copy"),
    ("sub/sub_body.png", "sub/sub_body.png", "copy"),   # 变体缺失时的兜底
    # V6.75 **侧视位图机体**：战斗里机体本体的贴图（`DiveGame.syncSub` 在用）。
    # 真源由 `tools/prep_sub_art.py` 从 AI 出图对齐产出（抠底 → 各向异性缩放到
    # 88×56 → 用 `HULL_OUTLINE` 裁剪影），**不要手改这张 png**。
    ("sub/sub_hull.png", "sub/sub_hull.png", "copy"),
    # 非道具的三类到此为止（数量固定）；道具立绘见下面的 _item_rules()
]


# ---------------------------------------------------------------------------
# 道具立绘清单：从 `shared/itemArt.ts` 的 `ITEM_ART_PATH` **推导**，不再手写
# ---------------------------------------------------------------------------
# ⚠️ 这里以前是**手写副本**（23 行），和 `ITEM_ART_PATH` 是重复维护的同一份事实。
#    漏补一行的症状是：图在 web 侧有、cocos 侧没有，而同步器**报"已是最新"** ——
#    它压根不知道有这张图。属于本项目最忌讳的**静默缺图**。
#    （V6.30 加 3 张进化立绘时正是踩到这一点：图生成了，脚本却说"写盘 0 个"。）
#
#    源路径 == 目标路径：两边刻意保持同样的子目录结构（见 artKeys.ts 头注）。
def _item_rules() -> list[tuple[str, str, str]]:
    txt = (ROOT / "shared" / "itemArt.ts").read_text(encoding="utf-8")
    pairs = re.findall(r"^\s*([A-Za-z_]\w*)\s*:\s*'(items/[^']+\.png)'", txt, re.M)
    if len(pairs) < 20:
        raise SystemExit(
            "[sync_art] 从 itemArt.ts 只解析出 %d 条道具立绘（预期 >=20），"
            "格式可能变了，先检查 shared/itemArt.ts" % len(pairs)
        )
    return [(p, p, "item") for _, p in pairs]


# ---------------------------------------------------------------------------
# ⚠️ 主界面功能图标**不走本脚本**（2026-10-13 晚改「只做 cocos 单端」）
# ---------------------------------------------------------------------------
# `tools/process_ui_icon.py` 现在**直接写入** `cocos/assets/resources/ui/icons/`，
# 不再经 web 中转 —— web 原型已冻结（用户当日决定，原 `web/src/assets/ui/` 与
# `web/src/config/uiArt.ts` 已删）。
# 保留此注记只为解释：规则表里为什么没有 `ui/icons`（以前有）。
# 本脚本此后只负责**立绘 / 道具**那批（仍为 web → cocos 的老约定）。


RULES: list[tuple[str, str, str]] = _ASSET_RULES + _item_rules()


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def transform(src: Path, kind: str) -> bytes:
    """把源文件变成目标字节。**必须确定性**（同样的输入永远得到同样的输出）。"""
    if kind == "copy":
        return src.read_bytes()

    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        sys.exit(
            "[sync_art] 这个脚本需要 Pillow。用隔离环境的 python 跑：\n"
            "    C:/Users/yu.wang/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/sync_art.py"
        )

    import io

    with Image.open(src) as im:
        if kind == "webp2png":
            # 背景图是 RGB（无 alpha），PNG 无损保留。不用 JPG：
            # 水下背景是大面积平滑渐变，正是 JPG 最容易出带状色阶的场合。
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            return buf.getvalue()

        if kind == "item":
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA")
            # LANCZOS：降采样时唯一不会产生锯齿/摩尔纹的高质量核
            small = im.resize((ITEM_W, ITEM_H), Image.LANCZOS)
            buf = io.BytesIO()
            small.save(buf, "PNG", optimize=True)
            return buf.getvalue()

    raise ValueError(f"未知变换: {kind}")


def load_manifest() -> dict:
    if MANIFEST.is_file():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {"entries": []}


def do_sync() -> int:
    entries: list[dict] = []
    written = 0
    total = 0

    for rel_src, rel_dst, kind in RULES:
        s = SRC / rel_src
        if not s.is_file():
            print(f"[sync_art] ❌ 源文件不存在：{rel_src}")
            return 1
        data = transform(s, kind)
        d = DEST / rel_dst
        d.parent.mkdir(parents=True, exist_ok=True)

        changed = (not d.is_file()) or (d.read_bytes() != data)
        if changed:
            d.write_bytes(data)
            written += 1
        else:
            # 字节一致也要**重写一次**吗？不需要。但 mtime 不入 manifest，所以无所谓。
            pass

        total += len(data)
        entries.append({
            "src": rel_src,
            "dst": rel_dst,
            "transform": kind,
            "src_sha256": sha256_file(s),
            "dst_sha256": sha256_bytes(data),
            "dst_bytes": len(data),
        })
        flag = "写入" if changed else "已是最新"
        print(f"  {flag:6s} {rel_dst:28s} {len(data)/1024:8.1f} KB   ({kind})")

    MANIFEST.write_text(
        json.dumps({"entries": entries}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"\n[sync_art] ✅ 同步完成：{len(entries)} 个资源，实际写盘 {written} 个，"
          f"合计 {total/1024/1024:.2f} MB")
    print(f"            清单：{MANIFEST.relative_to(ROOT).as_posix()}")
    return 0


def do_check() -> int:
    man = load_manifest()
    entries = {e["dst"]: e for e in man.get("entries", [])}
    if not entries:
        print("[sync_art] ❌ 没有清单，先跑一次 python tools/sync_art.py")
        return 1

    problems: list[str] = []
    for rel_src, rel_dst, kind in RULES:
        if rel_dst not in entries:
            problems.append(f"{rel_dst}: 清单里没有这一项（清单过期了？）")
            continue
        e = entries[rel_dst]
        if e.get("transform") != kind:
            problems.append(f"{rel_dst}: 变换方式从 {e.get('transform')} 改成 {kind} 了，需要重新同步")

        s = SRC / rel_src
        if not s.is_file():
            problems.append(f"{rel_src}: 源文件不见了")
        elif sha256_file(s) != e.get("src_sha256"):
            problems.append(f"{rel_src}: **源文件变了** → 重新跑 python tools/sync_art.py")

        d = DEST / rel_dst
        if not d.is_file():
            problems.append(f"cocos/assets/resources/{rel_dst}: 副本不见了")
        elif sha256_file(d) != e.get("dst_sha256"):
            problems.append(
                f"cocos/assets/resources/{rel_dst}: **副本与清单不符** —— "
                "要么有人在 cocos 侧手改了副本（不要手改，改 web 源），要么需要重新同步"
            )

    extra = sorted(set(entries) - {r[1] for r in RULES})
    for x in extra:
        problems.append(f"cocos/assets/resources/{x}: 已从清单移除，但文件还在（建议删掉）")

    if problems:
        print("[sync_art] ❌ 检测到漂移：")
        for p in problems:
            print(f"    {p}")
        return 1
    print(f"[sync_art] ✅ 零漂移（{len(RULES)} 个资源，源与副本哈希全部一致）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="web 美术 → cocos/resources 同步")
    ap.add_argument("--check", action="store_true", help="只检查漂移，不写盘")
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"[sync_art] ❌ 找不到源目录 {SRC}")
        return 1
    return do_check() if args.check else do_sync()


if __name__ == "__main__":
    raise SystemExit(main())
