# 深海回响 · Cocos Creator 前端工程

> 分支：`cocos`（从 `main` @ v6.27 切出）
> 目标：把原 `web/`（Phaser 3.90 + Vite + TS）的前端逐步迁移到 **Cocos Creator 3.8.x**。

---

## ⚠️ 当前状态：骨架阶段（不是可运行工程）

本目录目前是**工程骨架 + 已抽取的引擎无关纯逻辑**，还不能在 Cocos Creator 里直接跑通。

### 为什么不能在这里"跑通构建"
Cocos Creator 是 **GUI 编辑器（Electron）**，且：
- `settings/project.json`、资源数据库（`.meta`、`.library`）由编辑器在**首次打开工程时生成/补全**；
  手写这个文件很容易写错 schema 导致工程打不开，所以**本骨架不手写它**（见 `settings/.gitkeep`）。
- 场景（`.scene`）、预制体（`.prefab`）、材质需要**在编辑器里可视化创建**。
- 无头构建需要编辑器本体，**当前沙箱环境没有 Cocos Creator，也无法无头构建**。

### 因此本骨架交付的是
1. 正确的**工程目录规范**（`package.json` / `tsconfig.json` / `.gitignore` / `assets` / `settings` / `extensions`）。
2. 真正可验证的部分：**引擎无关的纯逻辑模块** `src/logic/`（已用 `tsc --noEmit` 独立编译通过，零 `cc` / Phaser / Vite 依赖）。
3. 一份 **Phaser → Cocos 移植对照表**，作为后续填工程的路线图。

### 你（有 Cocos Creator 的机器上）下一步
1. 用 Cocos Creator 3.8.x **打开 `cocos/` 文件夹** → 编辑器自动生成 `settings/project.json` 与 `assets` 资源索引。
2. 在编辑器里建第一个空场景（`assets/scenes/bootstrap.scene`）并设为启动场景。
3. 把 `src/logic/` 的纯逻辑作为共享 TS 模块引入（Cocos 的 TS 工程直接吃 `src/**/*.ts`）。
4. 按下方对照表，从**垂直切片**（如商店 UI 或最小潜水循环）开始填渲染/输入层。

---

## 目录布局

```
cocos/
├─ package.json          # 工程清单：name/uuid + 引擎依赖 "cc": "3.8.5"
├─ tsconfig.json         # TS 配置（target ES2020，strict，types:[] 以便逻辑层独立编译）
├─ .gitignore            # 排除 library/temp/local/build（编辑器缓存不入库）
├─ assets/               # 资源根（首次打开后由编辑器注入 .meta / 索引）
├─ settings/             # 工程设置（project.json 由编辑器生成，不手写）
├─ extensions/           # 编辑器扩展（自定义构建/资产检查器）
└─ src/
   └─ logic/             # ★ 引擎无关纯逻辑（已从 web/src/config 抽取，可独立编译）
      ├─ gameData.ts     # 武器/敌人/军团/阵型/计谋/战役/单位/道具/光资源 全量表 + 查找函数
      ├─ theme.ts        # 色板(UI/TXT/MENU)、字体常量、BUILD_TAG
      ├─ subs.ts         # 潜航器定义（已剥离 UI.* 颜色与 SUB_ART 资源映射）
      ├─ itemArt.ts      # 道具卡 id → 相对资源路径 映射（已剥离 Vite import ...png）
      └─ index.ts        # 桶导出
```

---

## 已抽取的纯逻辑（可复用资产）

| 模块 | 来源 | 处理方式 | 复用度 |
|------|------|----------|--------|
| `gameData.ts` | `web/src/config/gameData.ts` | **原样搬**（本身零引擎依赖） | 100% |
| `theme.ts` | `web/src/config/theme.ts` | **原样搬**（纯常量） | 100% |
| `subs.ts` | `web/src/config/subs.ts` | 剥离 `UI.*` 颜色（内联 hex）、删 `SUB_ART` 资源映射与 PNG import | ~70%（数据保留，art 映射归 Cocos 资产层） |
| `itemArt.ts` | `web/src/config/itemArt.ts` | 剥离 Vite `import ...png`，改为 `id → '相对资源路径'` 字符串映射 | ~60%（id↔文件 关系保留，URL 解析归 Cocos） |

> 这些就是"能用"的那 ~25%：数值/平衡/内容表 + 色板 + id↔美术 关系。
> 它们不依赖任何渲染 API，Cocos 与 Phaser 共用同一份即可。

---

## Phaser → Cocos 移植对照（路线图）

| Phaser 概念 | Cocos Creator 等价物 | 工作量 | 备注 |
|-------------|----------------------|--------|------|
| `Phaser.Scene` / `DiveScene` (6530 行) | `cc.Component` + 节点树 / 一个 `GameScene.ts` 脚本挂场景节点 | 极高 | 最大的重写块，建议按子系统拆 |
| `this.add.image/sprite` | `cc.Sprite` + `cc.Node` | 高 | 资源走 Cocos 资源数据库，不用 URL import |
| `Graphics` 程序化绘制（键帽/圆角/对勾/分隔线） | `cc.Graphics`（API 不同，需逐行重移植） | 中 | 或改用 prefab UI 组件 |
| `this.txt()` 文本 | `cc.Label`（`cc.RichText` 用于富文本） | 中 | 分辨率/字体由 Cocos 原生管 |
| 输入 `pointerdown` / 键盘 `1/2/3` | `cc.input`、`cc.systemEvent` / 节点 `Button` 组件 | 中 | 键帽"按 1/2/3 购买"重做 |
| 相机/缩放 + **我们刚写的 DPR 根治方案** | **作废** → 用 Cocos 原生多分辨率适配（`Canvas` + `Widget` + Fit/ShowAll） | — | 这是 Cocos 的强项，直接替掉我们的自定义 hack |
| Tween（`this.tweens`） | `cc.tween()` / 动画编辑器 | 中 | |
| 粒子 VFX（`render/neon.ts`） | `cc.ParticleSystem2D` / 自定义 shader | 高 | 霓虹辉光需重做材质 |
| 资源加载（`import X from '...png'`） | Cocos 资源数据库 + `resources.load` / 编辑器拖拽引用 | — | URL import 模式整体废弃 |
| 构建（Vite） | Cocos Creator 构建面板（Web/小游戏/原生） | — | 不再有 Vite |

**不搬、直接作废的**：`main.ts` 的 DPR/分辨率处理、Vite 配置、`render/neon.ts` 的 Phaser 专属辉光写法。

---

## 已知限制 / 待办

- [ ] 用 Cocos Creator 打开后生成 `settings/project.json` 与资源索引（本骨架未含）。
- [ ] 建首个启动场景 `assets/scenes/bootstrap.scene`。
- [ ] 决定 `cc` 引擎确切版本（当前写 `3.8.5`，按实际安装调整）。
- [ ] 选定第一个垂直切片（建议：商店 UI 或最小潜水循环）开始填渲染层。
- [ ] 长期：把 `src/logic/` 提升为 Phaser 与 Cocos **共享**模块（避免双份数值表漂移）；当前是副本，改平衡需同步两处。
