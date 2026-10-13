#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把共享真源 `shared/` 同步到各引擎的消费副本。

为什么需要这个脚本
------------------
`shared/` 是引擎无关的唯一手写源。但 **Cocos Creator 只编译 `assets/` 目录下的
脚本**，`assets/` 之外的 TS 源码不会进构建产物（外部目录只能放 `.d.ts` 类型声明，
靠 tsconfig paths 被找到；运行时模块不行）。所以 Cocos 侧只能**复制一份**进去。

web 侧不需要复制：Vite 允许引用 root 之外的文件，走 `@shared/*` 别名直接引用
（见 `web/tsconfig.json` 的 paths 与 `web/vite.config.ts` 的 resolve.alias + fs.allow）。

因此"单一真源"的落地是：
    shared/**  ──(直接引用)──▶  web/
               └─(本脚本复制)─▶  cocos/assets/scripts/shared/**

复制出来的文件带 GENERATED 横幅，并且 `--check` 能检出漂移 —— 这样"两份代码
不一致"这件事是**可以被 CI/verify 抓到**的，而不是靠人记得。

用法
----
    python tools/sync_shared.py            # 写入/更新副本
    python tools/sync_shared.py --check    # 只检查是否漂移（漂移则 exit 1）
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared"

# 目标：cocos 的资源根下镜像同一棵树（相对 import 因此仍然成立）
COCOS_DEST = ROOT / "cocos" / "assets" / "scripts" / "shared"

BANNER_MARK = "GENERATED FILE"


def banner(rel: str) -> str:
    return (
        "// ============================================================================\n"
        f"// ⚠️ {BANNER_MARK} —— 不要手改本文件。\n"
        f"//    真源：shared/{rel}\n"
        "//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）\n"
        "//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。\n"
        "// ============================================================================\n"
    )


# 横幅固定几行（rel 只影响其中一行的内容，不影响行数）—— strip_banner 按它切。
BANNER_LINES = banner("x").count("\n")


def strip_banner(text: str) -> str:
    """去掉开头的 GENERATED 横幅，**只去横幅本身** —— 否则改横幅文案会造成假漂移。

    ⚠️ 这里踩过一个坑（2026-10-13）：早先的实现是"从开头一直吃掉所有以 `//`
    开头的行"，结果把**正文里紧随其后的注释块**也一起吞了。于是
    `shared/index.ts`、`shared/dive/index.ts`、`shared/gameData.ts` 这三个
    "正文本身以 `//` 注释开头"的文件**永远被误报为漂移**（假红），
    而真正改了 shared/ 忘记同步时反而淹没在噪声里 —— 漂移检查因此形同虚设。

    修法：横幅行数是**固定的**（由 banner() 决定，rel 只影响其中一行内容），
    按行数切，不按前缀猜。
    """
    if BANNER_MARK not in text:
        return text
    lines = text.splitlines(keepends=True)
    return "".join(lines[BANNER_LINES:])


def where_diff(got: str, want: str) -> str:
    """指出第一处差异（行号 + 两侧内容）。

    只报"有漂移"而不说差在哪一行，排查就只能靠肉眼 diff —— 实测在这上面
    浪费过一整轮。所以宁可多输出一行。
    """
    g = got.splitlines()
    w = want.splitlines()
    for i in range(min(len(g), len(w))):
        if g[i] != w[i]:
            return f"第 {i + 1} 行起不同：副本={g[i][:70]!r} / 真源={w[i][:70]!r}"
    return f"行数不同：副本 {len(g)} 行 / 真源 {len(w)} 行"


def sources() -> list[Path]:
    """所有需要镜像的 .ts（shared/ 顶层 + shared/dive/），保持相对路径。"""
    out: list[Path] = []
    for p in sorted(SHARED.rglob("*.ts")):
        out.append(p.relative_to(SHARED))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查漂移，不写文件")
    args = ap.parse_args()

    if not SHARED.is_dir():
        print(f"[sync_shared] 找不到真源目录：{SHARED}")
        return 2

    rels = sources()
    if not rels:
        print("[sync_shared] 真源里没有 .ts 文件？")
        return 2

    drift: list[tuple[str, str]] = []
    written = 0

    for rel in rels:
        src = SHARED / rel
        body = src.read_text(encoding="utf-8")
        expect = banner(rel.as_posix()) + body

        dest = COCOS_DEST / rel
        rel_disp = f"cocos/assets/scripts/shared/{rel.as_posix()}"

        if dest.is_file():
            actual = dest.read_text(encoding="utf-8")
            got = strip_banner(actual)
            if got == body:
                continue  # 已同步
            drift.append((rel_disp, where_diff(got, body)))

        if args.check:
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(expect, encoding="utf-8", newline="\n")
        written += 1

    # 清理：目标里存在但真源已不存在的生成物（避免删掉真源后副本变僵尸）
    stale: list[str] = []
    if not args.check and COCOS_DEST.is_dir():
        for p in sorted(COCOS_DEST.rglob("*.ts")):
            relp = p.relative_to(COCOS_DEST)
            if relp not in rels:
                stale.append(str(p.relative_to(ROOT)))
                p.unlink()

    if args.check:
        if drift:
            print("[sync_shared] ❌ 检测到漂移（副本与真源不一致）：")
            for d, why in drift:
                print(f"    {d}")
                print(f"        {why}")
            print("    → 运行 python tools/sync_shared.py 重新生成。")
            return 1
        print(f"[sync_shared] ✅ 已同步（{len(rels)} 个文件，零漂移）")
        return 0

    print(f"[sync_shared] 写入 {written} 个文件 → cocos/assets/scripts/shared/（共 {len(rels)} 个）")
    for s in stale:
        print(f"[sync_shared] 清理僵尸副本：{s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
