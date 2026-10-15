# 背景图五带 · 草稿 v2（**未进游戏**）

> 规格与全部数字：`docs/背景图五带打样_V6.66.md`
> 总览图（五带实机分辨率对照）：`docs/shots/env_set_v2.png`

## 用哪个文件

| 带 | **取用（曝光补偿后）** | 出图原样 | 说明 |
|---|---|---|---|
| L1 阳光带 | **`L1.png`** | 同（未做补偿） | 亮部 61.6% |
| L2 弱光带 | **`L2_lift.png`** | `L2.png` | 原样 42.3% 与 L1 太近，**压暗 gamma 0.80** → 21.3% |
| L3 午夜带 | **`L3_lift.png`** | `L3.png` | 提亮 gamma 1.45 |
| L4 热泉带 | **`L4_lift.png`** | `L4.png` | 提亮 gamma 1.40 |
| L5 深渊带 | **`L5_lift.png`** | `L5.png` | 提亮 gamma 1.35 |

- `*_ingame.png` = 按 **1304×749 cover** 裁切后的实机观感（评审看这个，不是看原图）。
- `L3_exposure_scan.png` = L3 三档曝光对照（原始 / 1.45 / 2.1）——
  **用来证明"强行凑 6% 亮部会把午夜带毁掉"**，是判据修正的证据，别删。

## 未修的原始出图

`docs/shots/env_draft/深海潜水摄影感_实拍感海洋水下摄影_*_2026-10-15T*.png`
（模型原图，**带角标水印**；本目录的图已走过 `tools/prep_shot.py` 去水印）

## 启用步骤（⚠️ 会覆盖已交付的 5 张，**需先确认**）

```bash
# 1) 用取用列的文件覆盖真源（web 是 env 图的真源，cocos 由脚本同步）
cp docs/shots/env_v2/L1.webp       ../web/src/assets/env/L1.webp
cp docs/shots/env_v2/L2_lift.webp  ../web/src/assets/env/L2.webp
cp docs/shots/env_v2/L3_lift.webp  ../web/src/assets/env/L3.webp
cp docs/shots/env_v2/L4_lift.webp  ../web/src/assets/env/L4.webp
cp docs/shots/env_v2/L5_lift.webp  ../web/src/assets/env/L5.webp

# 2) 同步到 cocos + 复核
python tools/sync_art.py
python tools/check_art.py env
```
