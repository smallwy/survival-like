# 验证证据（图与数据，不是决策文档）

> **决策全部写在 `docs/项目计划书.md`。** 这里只放支撑决策的验证产物。

## 复现全部验证

```bash
cd tools
python3.11 silhouette_check.py    # 剪影 IoU 自检（现有 16 单位）
python3.11 realsize_check.py       # 实机96px 尺寸 + 真实弹幕密度
python3.11 orientation_check.py    # 朝向与超宽屏视野指标
python3.11 deepsea_family_proto.py # 6 剪影族原型 + IoU
python3.11 deepsea_anim.py         # 多帧动画 + 三方向
# 下面这个要前端 dev server 在 5173跑着（实机开一局，6 种分辨率各拍一张）
python3.11 view_check.py           # 视野短边钳制实机验证
```

## 图目录

### 现状诊断（玩具兵，2026-10-10 早）
| 文件 | 说明 |
|---|---|
| `silhouette-color.png` | 16 个人形单位的彩色图—— **看它们几乎一样** |
| `silhouette-preview.png` | 同上，纯黑1-bit 掩码 |
| `silhouette-blindtest.png` | 6 题盲测（1 参考 + 4 候选） |
| `silhouette-report.md` | 自动生成的 IoU 报告 |

**结论**：IoU 均值 0.801，**120 对可区分 0 对**，48 对完全撞车
（最差 `铁皮将军(BOSS) ↔ 吸尘器怪(BOSS)` IoU=1.000）。
玩家与敌人也撞车（`小绿兵 ↔ 射手` IoU=0.945）。

### 实机尺寸验证（96px）
| 文件 | 说明 |
|---|---|
| `realsize-bullets-legacy.png` | 现状：同密度同背景，玩家与敌人同一种人形 |
| `realsize-bullets.png` | 深海版：6 族在实机尺寸下依然可辨 |
| `realsize-strip.png` | 96px 并排（带族名） |
| `realsize-silhouette.png` | 96px 下的 1-bit 剪影 |

**关键教训**：展示图是32px，实机是 `PX_SCALE=3` → **96px**。
视觉验证必须在目标尺寸下做。

### 剪影族 + 动画
| 文件 | 说明 |
|---|---|
| `deepsea-color.png` / `deepsea-silhouette.png` | 6 族原型（4 倍展示图） |
| `anim-sheets.png` | **完整图集**：6 族 × 3 方向 × 3 动作（生产规格） |
| `anim-strip.png` | 逐帧动作展开（idle4/walk4/attack3） |
| `anim-3dir.png` | 三方向差异对照 |
| `anim-bullets.png` | 实机 96px、walk 动画中的弹幕场景 |

### 朝向验证
| 文件 | 说明 |
|---|---|
| `orientation-compare.png` | 横屏/竖屏并排 + 超宽屏风险 |
| `inside-landscape.png` / `inside-portrait.png` / `inside-ultrawide.png` | 敌群在视野内的真实分布 |

### 文字结论
| 文件 | 说明 |
|---|---|
| `验证记录-剪影与动画.md` | 剪影自检 + 6 族原型验证的详细记录与 4 个已修缺陷 |

## 核心数字速查

| 指标 | 玩具兵 | 深海 |
|---|---|---|
| IoU 均值 | 0.801 | **0.547** |
| 可区分（<0.65） | 0 / 120 | **18-21 / 28** |
| 撞车（≥0.82） | 48 对 | **0 对** |
| 动画动作组合在动 | 无多帧 | **24 / 24** |
| 三方向可区分 | 0（原本相同） | **32 / 32** |
