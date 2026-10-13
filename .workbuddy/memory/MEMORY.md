# 深海回响 · 项目长期记忆

> 归档跨会话必须遵守的规约。**日常进展看 `YYYY-MM-DD.md`，详细坑位看 `cocos/README.md` 已知坑表。**

## 项目结构（单一真源）

| 目录 | 角色 |
|---|---|
| `shared/` | ★ **引擎无关单一真源**（数值表 + 模拟核心 + 美术 key 表 + 档案逻辑）。改逻辑只改这里 |
| `shared/dive/artKeys.ts` | ★ "游戏需要哪些美术"的唯一说明（两个引擎 + 验证脚本共用） |
| `web/` | Phaser 3.90 + Vite + TS 原型（**移植对照的权威来源**） |
| `cocos/` | Cocos Creator 3.8.8 目标工程（分支 `cocos`） |
| `tools/sync_shared.py` | 真源 → Cocos 副本同步 + 漂移检查（`--check`） |
| `cocos/assets/scripts/shared/` | ⚠️ **自动生成的副本，不要手改** |

`shared/index.ts` 是 `export *` —— 加导出名前**必须先全目录搜同名**，撞名是编译期硬错 `TS2308`。

## 铁规

1. **移植以 `web/` 的当前版本为准，不凭记忆。** 落笔前先 `grep web/src/scenes/DiveScene.ts`
   读对应函数的**现在**长什么样。已踩：按旧版 web 多画了 V6.13 早删除的"空座 + 座圈连线"。
2. **顺序：先落文件、再写引用。** Cocos 增量编译**解析失败不登记依赖边**，
   新文件晚到 = importer 永久带着失败 import 躺缓存 = 编辑器全黑而验证全绿。
   判据在 `cocos/temp/.../resolution-detail-map.json` 的 `__unresolved_*`。
3. **验证是"静态可验"的下界，不是"画面对"的证明。** 全绿之后**必须**在 Creator 里
   跑 `Dive.scene` 目视确认。沙箱验不了引擎真实行为与观感。
4. **左右都要过**：改 `shared/` 后跑 `python tools/verify_cocos.py`（应 7/7）**和**
   `cd web && npx tsc --noEmit`（退出码 0）—— 真源是双端共用的。
5. **Cocos `Graphics` 没有 `translate/rotate/save/restore`。** 旋转零件一律手算坐标。
   配套：`Gfx.arc()`（分段折线，引擎 `arc` 在 y 翻转后方向镜像）、`Gfx.roundRect()`（内部翻 y）。
6. **椭圆：Phaser 收直径、Cocos 收半径。** 从 `web/src/` 抄任何 `*Ellipse(w,h)` 的值都要 `÷2`。
7. **"没报错 + 图也在" ≠ "画出来了"。** 层序（后建=上层）、`active` 开关是静默失效高发区。
   任何 `active=false` 的节点，重开点必须**每帧执行**或有明确的回开事件。
8. **UI 分层语义**：`scrim()`（半透明暗幕，弹窗用）≠ `pageFill()`（不透明铺满，页面用）。
   把弹窗底画成 `pageFill` 就是"全屏、太大"。
9. **换底色必须同时换文字色**（`TXT` ↔ `TXT_LIGHT`），只换底 = 白字白底。
10. **命名规范**：中文名目录加数字前缀（按字符编码排序是乱的）；归档改名说清关系，**归档≠删除**。

## 目标平台参数（已定）

- 设计分辨率 **1304×749**，`fitHeight`（横向空间博弈，高度不能裁）。
- 字号：**正文不低于 12px**（本机桌面应用既定下限）。
- 图集 `AutoAtlas` 上限 **2048×2048**，按「HUD 常驻 / 弹窗 / 商店立绘」三组。
- 九宫格四值**必须写具名值**：Cocos `insetLeft/Top/Right/Bottom`（左上右下）、
  Unity `Border` 是**左下右上**、Unreal/Godot 左上右下、Cocos SpriteFrame 左右上下。

## 皮肤

- `MENU`（暗，菜单/战斗 HUD）：`page < slot < card`，凹槽比卡面**亮**。
- `BRIGHT`（亮，商店/弹窗）：`surface > card > slot`，**凹槽必须比卡面暗**，
  否则立绘跳不出来；对比靠**实底 + 硬边**，不靠发光。

## 分支与提交

- 分支 `cocos`（从 `main` @ v6.27 切出）。`cocos/library/`、`cocos/temp/`、`cocos/profiles/`
  **不入库**（`.gitignore` 不支持行内注释，注释必须独占一行）。
- `.creator/` **不能**加进 `.gitignore`（含工程配置）。
