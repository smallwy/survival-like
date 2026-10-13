#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Cocos Creator 的 UUID 压缩/解压（与编辑器实现严格等价）。

------------------------------------------------------------------------------
为什么需要它
------------------------------------------------------------------------------
Cocos 的 `.scene` / `.prefab` 里引用**用户脚本**时，写的不是脚本资源的完整
uuid，而是它的**压缩形式**：

    "assets/scripts/view/DiveGame.ts"  →  uuid  7b3c9d10-4e2a-4f68-9c51-8d2e6a0b13f4
                                         压缩  7b3c90QTipPaJxRjS5qCxP0

所以"手写一个预挂组件的场景"这件事，成败全看这个算法对不对：
算错了编辑器会显示 **Missing Script**（画面还能跑，但组件不生效）。

算法有两种保留头长度：
  · min=False → 保留头 5 个 hex、输出 **23** 字符 —— 场景/prefab 序列化用的就是这种；
  · min=True  → 保留头 2 个 hex、输出 **22** 字符 —— 子资源（如 `xxx@spriteFrame`）在用。

------------------------------------------------------------------------------
来源与互逆性
------------------------------------------------------------------------------
`compress_hex` 与编辑器 `compressHex` 逐字等价；`decompress_uuid` 与编辑器
`decompressNormalUuid` 逐字等价。二者互为逆运算已在 20000 组随机 uuid 上验证
（见 `selfcheck()`，`tools/verify_cocos.py` 每次都会跑一遍）。

⚠️ 改这个文件前先想清楚：`selfcheck()` 一旦变红，场景里的脚本引用就全废了。
"""

from __future__ import annotations

import random

# 与引擎 external/compression/base64-values.js 的 BASE64_KEYS 完全一致
BASE64_KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_ASCII_TO_64 = {ord(c): i for i, c in enumerate(BASE64_KEY_CHARS)}


def compress_hex(hex_string: str, reserved_head_length: int) -> str:
    """保留头部 N 个 hex 字符，其余每 3 个 hex（12 bit）→ 2 个 base64 字符。"""
    length = len(hex_string)
    i = reserved_head_length
    head = hex_string[:i]
    out: list[str] = []
    while i < length:
        v1 = int(hex_string[i], 16)
        v2 = int(hex_string[i + 1], 16)
        v3 = int(hex_string[i + 2], 16)
        out.append(BASE64_KEY_CHARS[(v1 << 2) | (v2 >> 2)])
        out.append(BASE64_KEY_CHARS[((v2 & 3) << 4) | v3])
        i += 3
    return head + "".join(out)


def compress_uuid(uuid: str, min_: bool = False) -> str:
    """完整 uuid → 压缩 uuid。min_=False 得 23 字符（场景用），True 得 22 字符（子资源用）。"""
    hexstr = uuid.replace("-", "")
    if len(hexstr) != 32:
        raise ValueError(f"不是完整 uuid：{uuid!r}")
    return compress_hex(hexstr, 2 if min_ else 5)


def decompress_uuid(s: str) -> str:
    """压缩 uuid → 无横线的 32 位 hex（编辑器 decompressNormalUuid 的等价实现）。"""
    if len(s) == 23:
        hexchars: list[str] = []
        for i in range(5, 23, 2):
            lhs = _ASCII_TO_64[ord(s[i])]
            rhs = _ASCII_TO_64[ord(s[i + 1])]
            hexchars.append(format(lhs >> 2, "x"))
            hexchars.append(format(((lhs & 3) << 2) | (rhs >> 4), "x"))
            hexchars.append(format(rhs & 0xF, "x"))
        return s[:5] + "".join(hexchars)
    if len(s) == 22:
        hexchars = []
        for i in range(2, 22, 2):
            lhs = _ASCII_TO_64[ord(s[i])]
            rhs = _ASCII_TO_64[ord(s[i + 1])]
            hexchars.append(format(lhs >> 2, "x"))
            hexchars.append(format(((lhs & 3) << 2) | (rhs >> 4), "x"))
            hexchars.append(format(rhs & 0xF, "x"))
        return s[:2] + "".join(hexchars)
    return s


def is_compressed_uuid(s: str) -> bool:
    """能否被当作压缩 uuid 解出（23 或 22 字符、且字符都在 base64 集里）。"""
    if len(s) not in (22, 23):
        return False
    tail = s[5:] if len(s) == 23 else s[2:]
    return all(ord(c) in _ASCII_TO_64 for c in tail)


def canonical(uuid: str) -> str:
    """统一成 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 小写形式，便于比较。"""
    h = uuid.replace("-", "").lower()
    if len(h) != 32:
        return uuid.lower()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def selfcheck(trials: int = 20000) -> None:
    """compress 与编辑器 decompress 必须严格互逆 —— 不成立就说明算法被改坏了。"""
    rng = random.Random(20261013)
    for _ in range(trials):
        h = "".join(rng.choice("0123456789abcdef") for _ in range(32))
        uuid = f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"
        comp = compress_uuid(uuid)
        if len(comp) != 23:
            raise AssertionError(f"压缩长度应为 23，实得 {len(comp)}：{comp}")
        if decompress_uuid(comp) != h:
            raise AssertionError(f"往返失败：{uuid} → {comp} → {decompress_uuid(comp)}")
        if compress_uuid(uuid, True) != compress_hex(h, 2):
            raise AssertionError(f"min=True 分支异常：{uuid}")


if __name__ == "__main__":
    selfcheck()
    print("[cocos_uuid] 20000 组随机 uuid 往返自检通过")
    print("示例：7b3c9d10-4e2a-4f68-9c51-8d2e6a0b13f4 →",
          compress_uuid("7b3c9d10-4e2a-4f68-9c51-8d2e6a0b13f4"))
