# 深海回响 · Cocos Creator 前端工程

> 分支：`cocos`（从 `main` @ v6.27 切出）
> 目标：把原 `web/`（Phaser 3.90 + Vite + TS）逐步迁移到 **Cocos Creator 3.8.8**。
> 当前进度：**最小潜水循环已完整移植**（模拟核心 + 渲染/输入/HUD + 三个弹窗）。

---

## 在编辑器里跑起来（三步）

1. **设计分辨率设成 `1304 × 749`**（项目设置 → 项目数据 → 设计分辨率）。
   这个数是原 Phaser 版的调参基准视口（相机钳位、刷怪边距都按它调的）。
2. 在场景的 **Canvas** 下新建空节点 `Game`，position `(0, 0)`，
   挂上组件 **`DiveGame`**。
3. **运行。** 不需要导入任何美术资源 —— 本切片用 `Graphics` 画几何剪影。

组件上的可调项：`designW / designH`（默认 1304 / 749）、`seed`（同 seed ⇒ 同世界线）、
`subIndex`（0 灯艇 / 1 刺鳐 / 2 深潜者）、`cam`（留空则自动找场景相机）。

操作：**WASD / 方向键**移动，**空格或 Shift** 排气爆发（边沿触发，按住不连发），
**Esc** 重开一局。

> 组件挂在 Canvas 上、或挂在 Canvas 的**子节点**上都可以（会自动往上找带
> `UITransform` 的那一层）。挂载节点被拖到哪都不影响画面 —— 世界容器挂在
> UI 宿主下，位置只由它自己决定。

---

## 目录布局

```
cocos/
├─ package.json                  # 工程清单
├─ tsconfig.json                 # extends ./temp/tsconfig.cocos.json（编辑器生成）
├─ assets/                       # ★ 唯一会被 Cocos 编译的目录
│  └─ scripts/
│     ├─ shared/                 # ⚠️ 自动生成，不要手改（见下）
│     │  ├─ theme.ts  subs.ts  gameData.ts  itemArt.ts  index.ts
│     │  └─ dive/                # 潜水循环模拟核心
│     │     ├─ types.ts  tables.ts  rng.ts  pool.ts  world.ts  index.ts
│     └─ view/                   # ★ 手写的渲染/输入层
│        ├─ DiveGame.ts          # 主组件：采样输入 → 跑 world → 消费事件 → 绘制 → HUD
│        ├─ Hud.ts               # 战斗 HUD + 商店/决策/结算弹窗（只读 world）
│        ├─ Gfx.ts               # y 轴翻转的 Graphics 包装 + 颜色工具
│        └─ art.ts               # 可选美术加载（**尚未接线**，见下）
├─ settings/                     # project.json 由编辑器生成，不手写
└─ extensions/                   # 编辑器扩展
```

> 早期骨架里的 `cocos/src/logic/` **已删除**：Cocos 只编译 `assets/` 下的脚本，
> 那个目录永远不会进构建产物，而且已经和真源漂移（它内联了 `0x4fe8ff`，
> 真源用的是 `UI.cyan`）。内容保存在 git 提交 `a86f5f0` 里，需要时能取回。

---

## 单一真源：`shared/` 怎么落到两套引擎

引擎无关的数值表与模拟逻辑只有**一份手写源**：项目根的 `shared/`。
两个前端消费方式不同，原因是硬约束：

```
shared/**  ──(直接引用 @shared/* 别名)──▶  web/      ← Vite 允许引用 root 之外的文件
           └──(tools/sync_shared.py 复制)──▶  cocos/assets/scripts/shared/**
```

**为什么 Cocos 必须复制**：Cocos Creator 只编译 `assets/` 目录下的脚本。
`assets/` 之外的 TS 源码不会进构建产物（外部目录只能放 `.d.ts` 类型声明，
靠 tsconfig paths 被找到；运行时模块不行）。

复制出来的文件带 `GENERATED FILE` 横幅，并且可以检出漂移：

```bash
python tools/sync_shared.py            # 写入/更新副本
python tools/sync_shared.py --check    # 只检查漂移（漂移则 exit 1，并指出第几行不同）
```

于是"两份代码不一致"是**可以被脚本抓到**的，而不是靠人记得。
改平衡/数值**只改 `shared/`**，然后跑一次 `sync_shared.py`。

---

## 坐标系：移植时最容易错的一处

模拟层沿用 Phaser 的「**左上原点、y 向下**」，而 Cocos 2D 是「**左下原点、y 向上**」。
转换只发生在两处，模拟层对此一无所知：

| 位置 | 规则 |
|------|------|
| 图元绘制 | 全走 `Gfx` 包装，内部自动 `y → H - y`；角度取反 `sim θ → -θ` |
| 节点定位 | `V(x, y) = (x, H - y)`；`WorldRoot` 锚点 `(0,0)`、尺寸 `W×H`、位置 `(-W/2, -H/2)` |

因为只有这一条规则，"sim 坐标画到哪里"不会出现第二种解释。
`view/` 里的绘制代码因此与原 Phaser 绘制代码几乎同构 —— 这是刻意换来的可对照性。

---

## 验证：能证明什么、不能证明什么

```bash
python tools/verify_cocos.py      # 一条命令，4 个阶段
```

| 阶段 | 内容 |
|------|------|
| 真源漂移检查 | `shared/` 与 `cocos/assets/scripts/shared/` 逐文件比对 |
| 编译模拟核心 | `shared/dive` → CJS（`tsc --strict`） |
| 无头冒烟 | 真跑 120s 模拟 + 21 条不变量断言（见下） |
| 视图层类型检查 | 用 `tools/cocos_cc_stub.d.ts` 顶上 `cc`，把 `cocos/assets/scripts/**` 全量过 `tsc --strict` |

**✅ 能证明**
- 模拟核心与 `web/src/scenes/DiveScene.ts` 的行为一致：5 层波次推进、清波 → 商店 →
  决策 → 结算、氧气收支、死亡路径、**同 seed 得到完全相同的世界线**（确定性）；
- 视图层**没有用错模拟层 API**（字段名拼错、参数个数不对、类型不匹配）——
  这是移植里最容易出的错，而且只有 `tsc` 抓得住；
- 真源与 Cocos 副本零漂移。

**❌ 不能证明**
- 引擎 API 的**真实行为**。`cc` 声明桩只有签名、没有实现 ——
  `Graphics.circle` 画出来什么样、`Node.layer` 默认值、相机 zoom 与 UI 相机的配合，
  这些都在桩的外面。
- **画面是否真的画对了。这一条只能由你在 Creator 里打开工程、点运行目视确认。**

所以：`verify_cocos.py` 全绿 ≠ 能跑；它绿了只说明"进编辑器之前，代码本身该对的都对上了"。

### 无头冒烟的 21 条断言（当前全通过）

```
[1] 初始化        开局相位=wave、只挂机关枪、氧气上限=125、挂载座=4
[2] 模拟 120 秒   刷怪/开火/命中/击杀/掉骨/耗氧/移动/波次推进
[3] 确定性        同 seed 世界线完全一致；不同 seed 必然不同
[4] 商店经济      抽满 3 张、扣钱标 sold、刷新递增 8→14、锁定格保留、遗物槽受限
[5] 死亡路径      氧气归零 ⇒ result 相位 + win=false + 抛出 dead 事件
```

---

## 迁移进度

### 已移植（最小潜水循环 = 一局完整可玩）

| 层 | 内容 |
|----|------|
| 模拟核心 | 5 层 × 4 波、3 种敌人 + Boss（深渊守望者）、15 把武器 + 进化分支、属性/遗物系统、氧气收支曲线、鱼骨掉落与拾取、层机制（暗流/涌流/热泉/压力）、商店经济、层末决策、结算 |
| 渲染 | 背景（层色调 + 深度暗带 + 低氧暗角 + 方向性受击暗角 + 海雪）、敌人剪影、子弹、玩家机体（座圈 + 座塔 + 发射器 + 艏灯）、鱼骨、声呐波前、回声标记、酸液云、爆炸环、粒子（冲击波/击打痕/火花/飘字/电弧） |
| 输入 | WASD / 方向键 + 空格排气（边沿语义） |
| HUD | 氧气条（兼计时器）、波次点、器械装填条、遗物槽、层入场卡、状态提示 |
| 弹窗 | 商店三选一（购买/刷新/锁定）、补给站决策（下潜/上浮）、结算（生物质 × 倍率） |
| 镜头 | zoom 1.25 跟随 + 边界钳位；弹窗相位归位 1× 并居中 |

### 尚未移植

- [ ] **`TitleScene`** —— 标题画面 / 潜航器选择 / 主菜单（结算屏的「返回主界面」目前是"重开"）
- [ ] **音效音乐**
- [ ] **美术贴图接线** —— `view/art.ts` 已写好（`SpriteBank` + `ART_PATHS`），
      但 `DiveGame` 还没接。现在跑的是几何剪影，**没有美术也能玩**；
      接图时把源图放 `assets/resources/{sub,fish,env}/` 即可
- [ ] **震屏** —— 模拟层已经抛 `shake` 事件，渲染层还没接（要移动相机节点）
- [ ] 存档 / 局外元进度
- [ ] 音频、手柄、触屏虚拟摇杆

---

## 已知坑（都是"注入 Creator 后才会暴露"的那类）

1. **运行时 `new Node()` 的 layer 是 `DEFAULT`，而 Canvas 的 UI 相机只渲染 `UI_2D`**
   → 漏一处就是"画面上什么都没有"。所以 `view/` 里所有建节点都走
   `mkNode()` / `mk()`，它强制继承父节点 layer。
2. **Label 的锚点要跟着对齐方式走。** 在 `overflow = NONE` 下 Label 内容尺寸自适应
   文本，锚点 `(0.5, 0.5)` 意味着"文本中心落在节点位置" —— 于是右对齐的数字
   右边缘会随位数漂移（`10` 和 `100` 右边不一样齐）。锚点设 `0 / 0.5 / 1` 才是真贴边。
   这是 Phaser 侧 `setOrigin` 干的同一件事，移植时最容易整片漏掉。
3. **Graphics 纪律**：每个图元必须建好路径立刻 `fill/stroke`，且配色紧贴其前。
   不能"先 `rect` 攒着、中途换色"—— 那会把前一个图形也染成新色。
4. **全屏底色不能写死 `(0, 0, W, H)`**：设计分辨率与 `W×H` 宽高比不一致时，
   弹窗两侧会露出清屏色。`Hud.pageFill()` / `DiveGame.drawBg()` 都按 Canvas 实际
   尺寸外扩了。
5. **`cocos/tsconfig.json` 不要用于 CI**：它 `extends ./temp/tsconfig.cocos.json`，
   而 `temp/` 由编辑器首次打开时生成，沙箱里不存在。离线检查走
   `tools/cocos_check.tsconfig.json`（自带 `cc` 声明桩）。

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `shared/` | ★ 引擎无关真源（数值表 + 模拟核心），改这里 |
| `tools/sync_shared.py` | 真源 → Cocos 副本同步 + 漂移检查 |
| `tools/verify_cocos.py` | Cocos 侧离线验证总入口 |
| `tools/dive_sim_smoke.js` | 模拟核心无头冒烟（21 条断言） |
| `tools/cocos_cc_stub.d.ts` | `cc` 最小声明桩（**只为离线类型检查**，非引擎类型） |
| `web/src/scenes/DiveScene.ts` | 移植对照的原始实现（6530 行 Phaser 场景） |
