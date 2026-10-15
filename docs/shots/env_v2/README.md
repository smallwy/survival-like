# 背景图五带 · 草稿（**未进游戏**）

> 规格与全部数字：`docs/背景图与游戏场景适配_V6.67.md`（含**场景适配四条硬规格**）
> 总览图（五带实机分辨率对照）：**`docs/shots/env_set_v3.png`**（最新）

## 用哪个文件（v3 = 当前推荐）

| 带 | **取用** | 说明 |
|---|---|---|
| L1 阳光带 | **`L1.png`** | 未做补偿。亮部 61.6% / 均值 114 |
| L2 弱光带 | **`L2_lift.png`** | 压暗 gamma 0.80（原样 42.3% 与 L1 太近，分不出带） |
| L3 午夜带 | **`L3v3_lift.png`** | **v3 重出**（开阔，两侧无岩壁）+ 提亮 gamma 1.62。均值 57 |
| L4 热泉带 | **`L4v3_lift.png`** | **v3 重出**（开阔平原 + 5 根远处烟柱）+ 提亮 gamma 1.40。均值 68 |
| L5 深渊带 | **`L5_lift.png`** | 提亮 gamma 1.35。均值 33 |

- `*_ingame.png` = 按 **1304×749 cover** 裁切后的实机观感（**评审看这个**，不是看原图）。
- `L3_exposure_scan.png` = L3 三档曝光对照 —— 用来证明"强行凑 6% 亮部会毁掉午夜带"，**是判据修正的证据，别删**。
- v2 的 L3/L4（封闭构图，已废）保留为 `L3.png / L3_lift.png / L4.png / L4_lift.png`，便于对比。

## 未修的原始出图

`docs/shots/env_draft/深海潜水摄影感_实拍感海洋水下摄影_*_2026-10-15T*.png`
（模型原图，**带角标水印**；本目录的图都已走过 `tools/prep_shot.py` 去水印）

## 启用步骤（⚠️ 会覆盖已交付的 5 张，**需先确认**）

```bash
cp docs/shots/env_v2/L1.webp        web/src/assets/env/L1.webp
cp docs/shots/env_v2/L2_lift.webp   web/src/assets/env/L2.webp
cp docs/shots/env_v2/L3v3_lift.webp web/src/assets/env/L3.webp
cp docs/shots/env_v2/L4v3_lift.webp web/src/assets/env/L4.webp
cp docs/shots/env_v2/L5_lift.webp   web/src/assets/env/L5.webp

python tools/sync_art.py        # web → cocos
python tools/check_art.py env   # 复核
```
