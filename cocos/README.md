# 深海回响 · Cocos Creator 前端工程

> 分支：`cocos`（从 `main` @ v6.27 切出）
> 目标：把原 `web/`（Phaser 3.90 + Vite + TS）逐步迁移到 **Cocos Creator 3.8.8**。
> 当前进度：**最小潜水循环已完整移植，含美术贴图**（模拟核心 + 渲染/输入/HUD + 三个弹窗）。

---

## 打开就能跑

工程骨架与美术都已生成/同步好（场景、设计分辨率、2D 模块集、35 张图），
**不需要手动建节点、也不需要手动导入美术**。

1. **Cocos Dashboard → 项目 → 添加**，选中本目录 **`cocos/`** 本身
   （不是仓库根目录 `survivors-game/`）。
2. 用 **3.8.8** 打开。首次会导入资源，约 1–2 分钟，同时生成 `library/ temp/ local/`
   （都在 `.gitignore` 里，不会污染 git）。
3. 场景 **`Dive`** 会自动打开（`settings/v2/packages/scene.json` 里记了当前场景）。
   若没自动打开：资源管理器里双击 `assets/scenes/Dive.scene`。
4. **点 ▶ 运行。**

> **还没跑过 `sync_art.py` 也不会报错**，游戏照跑 —— 只是敌人是几何剪影、
> 背景是纯色块（见「美术」一节）。

画面结构是：`Canvas` → `Game`（挂着 `DiveGame` 组件）+ `Camera`。

> **万一场景没生成成功**（或你想从头搭）——手动三步：
> ① 项目设置 → 项目数据 → 设计分辨率设成 `1304 × 749`；
> ② Canvas 下建空节点 `Game`，position `(0,0)`，挂上组件 `DiveGame`；
> ③ 运行。
> 组件挂在 Canvas 上或它的**子节点**上都可以（会自动往上找带 `UITransform` 的那层）。

**操作**：`WASD` / 方向键移动，`空格` 或 `Shift` 排气爆发（边沿触发，按住不连发），
`Esc` 重开一局。

**组件可调项**：`designW / designH`（1304 / 749）、`seed`（同 seed ⇒ 同世界线）、
`subIndex`（0 灯艇 / 1 刺鳐 / 2 深潜者）。

> 设计分辨率用 **fitWidth**（`settings/v2/packages/project.json`）。
> 想改成 fitHeight 就在项目设置里调，组件按 Canvas **实际**尺寸自适应，不会错位。

---

## 目录布局

```
cocos/
├─ package.json                  # 工程清单（creator.version = 3.8.8）
├─ tsconfig.json                 # extends ./temp/tsconfig.cocos.json（编辑器生成）
├─ .creator/                     # ★ 工程配置，**要入库**
│  └─ default-meta.json          #   图片默认按 sprite-frame 导入
├─ settings/v2/packages/         # ★ 工程设置，**要入库**
│  ├─ project.json               #   设计分辨率 1304×749（fitWidth）
│  ├─ scene.json                 #   记住当前场景 = Dive
│  └─ engine.json                #   引擎模块集（2D：关 3D/物理/骨骼动画…）
├─ assets/                       # ★ 唯一会被 Cocos 编译的目录
│  ├─ scenes/Dive.scene          #   预挂好 DiveGame 的场景
│  ├─ resources/                 # ⚠️ 自动生成，不要手改（见「美术」）—— 必须叫这个名字
│  │  ├─ fish/  swarm.png  drift.png  dash.png
│  │  ├─ sub/   sub_lumen.png  sub_raia.png  sub_bathy.png  sub_body.png
│  │  ├─ env/   L1.png … L5.png
│  │  └─ items/ item_*.png（23 张商店立绘）
│  └─ scripts/
│     ├─ shared/                 # ⚠️ 自动生成，不要手改（见「单一真源」）
│     │  ├─ theme.ts  subs.ts  gameData.ts  itemArt.ts  index.ts
│     │  └─ dive/                # 潜水循环模拟核心 + artKeys.ts（美术 key 表）
│     └─ view/                   # ★ 手写的渲染/输入层
│        ├─ DiveGame.ts          # 主组件：采样输入 → 跑 world → 消费事件 → 绘制 → HUD
│        ├─ Hud.ts               # 战斗 HUD + 商店/决策/结算弹窗（只读 world）
│        ├─ Gfx.ts               # y 轴翻转的 Graphics 包装 + 颜色工具
│        └─ art.ts               # 贴图加载（SpriteBank），缺失时静默退回几何剪影
└─ extensions/                   # 编辑器扩展（空）
```

`library/ temp/ local/ build/ profiles/ native/ node_modules/` 都是生成物或本机态，已忽略。

> 早期骨架里的 `cocos/src/logic/` **已删除**：Cocos 只编译 `assets/` 下的脚本，
> 那个目录永远不会进构建产物，而且已经和真源漂移（它内联了 `0x4fe8ff`，
> 真源用的是 `UI.cyan`）。内容保存在 git 提交 `a86f5f0` 里，需要时能取回。

---

## 单一真源（一）：逻辑与数值 `shared/`

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

## 单一真源（二）：美术 `web/src/assets/`

美术同样只有一份手写源（`web/src/assets/`），用脚本同步进 Cocos：

```bash
python tools/sync_art.py            # web/src/assets → cocos/assets/resources
python tools/sync_art.py --check    # 双向漂移检测（源变了 / 副本被手改，都能查出来）
```

同步时会做两处**必要的**转换（理由都在脚本头部注释里）：

| 转换 | 为什么 |
|------|--------|
| 五层背景 `.webp` → `.png` | `cc.d.ts` 里 `SUPPORT_TEXTURE_FORMATS` 含 `.webp`，但那是**引擎运行时**支持的格式，不等于**编辑器导入器**支持。这一点在沙箱里无法验证，而一旦不支持，症状是图丢失 —— 转成 PNG 的代价是 0.37 MB → 3.6 MB，换零风险 |
| 道具立绘 `1200×600` → `600×300` | 立绘框在 sim 坐标里只有约 268×96，1200 宽是显示尺寸的 4.5 倍，纯浪费。600×300 正好是**显示尺寸的 2 倍**（高分屏够用），9.83 MB → 2.80 MB。这是**质量中性的降采样**，不是拿画质换体积 |

`--check` 靠 `tools/art_manifest.json` 里记录的源/目标双哈希核对，所以**不需要重新编码**
（Pillow 升级也不会造成假漂移）。

### 「游戏需要哪些美术」这张表放在 `shared/dive/artKeys.ts`

不是各引擎各写一份。写两份必然漂移，而漂移的症状是**"某个东西没图"—— 它不会报错**，
只会静默退回几何剪影，很难注意到。放在 `shared/` 之后，`verify_cocos.py` 能 require
**运行时同一份表**去跟磁盘对账，于是"表里加了 id、美术却漏了"在离线阶段就会红。

key 全部从既有表推导：`ENEMY_TEX`（敌人）、`LAYERS` 下标（背景）、
`WEAPON_DEF`/`RELIC_DEF` 的 id（商店立绘）、`SUB_ART_PATH`（潜航器）。

### 美术是**增量**，不是前置条件

`resources/` 下缺哪张图就静默跳过，渲染层自动退回 `Gfx` 画的几何剪影。
所以"打开工程 → 点运行"这件事不依赖任何美术步骤。

> **首次在编辑器里打开后**，`assets/resources/**` 下会生成一批 `*.png.meta`。
> 那些 meta **要入库**（它们记录资源的 uuid，跨机器必须稳定）——
> `.gitignore` 已经确认不会忽略它们。

---

## 坐标系与镜头

模拟层沿用 Phaser 的「**左上原点、y 向下**」，而 Cocos 2D 是「**左下原点、y 向上**」。
转换只发生在三处，模拟层对此一无所知：

| 位置 | 规则 |
|------|------|
| 图元绘制 | 全走 `Gfx` 包装，内部自动 `y → H - y` |
| 节点定位 | `(x, y) → (x, H - y)`；`WorldRoot` 锚点 `(0,0)`、尺寸 `W×H` |
| 旋转 | `node.angle = -θ°`。依据：引擎实现是 `Quat.fromAngleZ(this._lrot, val)`，即 **`node.angle` 逆时针为正**，与 sim 正好反号 |

因为只有这一条规则，"sim 坐标画到哪里"不会出现第二种解释。
`view/` 里的绘制代码因此与原 Phaser 绘制代码几乎同构 —— 这是刻意换来的可对照性。

**镜头缩放不用相机。** `CAM_ZOOM = 1.25` 是通过**缩放 `WorldRoot` 节点**做的，
不是改相机。原因见「已知坑」第 5 条。节点缩放还能顺带白拿一个正确行为：
HUD 挂在 Canvas 下、是世界根节点的**兄弟**，天然不跟着缩。

暗角/压暗层（`gVeil`）也画在**世界坐标**里，而不是做成全屏节点 —— 因为 web 侧有一条
铁律：「暗幕只能压暗地形，敌人/气泡/玩家必须画在它之上，否则深渊层（可见度 10%）
会把 gameplay 信息一起吃掉」。做成画在实体之上的全屏节点就必然违反它。
现在的做法是"按当前可视矩形在世界坐标里画暗角"，效果等价且不破坏该规则。

---

## 验证：能证明什么、不能证明什么

```bash
python tools/verify_cocos.py      # 一条命令，6 个阶段
```

| 阶段 | 内容 |
|------|------|
| 真源漂移检查 | `shared/` 与 `cocos/assets/scripts/shared/` 逐文件比对 |
| 编译模拟核心 | `shared/dive` → CJS（`tsc --strict`） |
| 无头冒烟 | 真跑 120s 模拟 + 21 条不变量断言（见下） |
| 视图层类型检查 | `cocos/assets/scripts/**` 全量过 `tsc --strict`，**优先用引擎自带的 `cc.d.ts`** |
| 美术完整性 | 源↔副本哈希一致；代码会去要的每个 key 在磁盘上都有（反向也查残留） |
| 工程资源完整性 | 场景 `__id__` 引用、`_id` 唯一性、**脚本类 id ↔ `.ts.meta` uuid 是否对得上**、压缩 uuid 算法往返自检 |

### 类型检查优先用**引擎真声明**，这件事很关键

脚本按这个顺序找 `cc.d.ts`：环境变量 `COCOS_ENGINE_DTS` → 本机 Cocos 安装目录
（`C:/ProgramData/cocos/editors/Creator/<版本>/…/bin/.declarations/cc.d.ts`）→
都找不到才退回 `tools/cocos_cc_stub.d.ts`。

**为什么值得单独说**：手写的声明桩是"按我的理解"写的，它只能验证"代码是否符合我的
假设"。本项目**真的因此漏过一次** —— 桩里我顺手写了 `Camera.zoom`，于是检查全绿；
换成引擎真声明后立刻报错：Cocos 3.8 的 `Camera` **根本没有 `zoom` 属性**，
只有 `orthoHeight`，而那是 `Canvas` 组件托管的状态。**桩越像真的，假绿越危险。**

**✅ 能证明**
- 模拟核心与 `web/src/scenes/DiveScene.ts` 的行为一致：5 层波次推进、清波 → 商店 →
  决策 → 结算、氧气收支、死亡路径、**同 seed 得到完全相同的世界线**（确定性）；
- 视图层**没有用错模拟层 API，也没有用错引擎 API**（字段名拼错、参数个数不对、
  属性根本不存在……）—— 这是移植里最容易出的错，而且只有 `tsc` 抓得住；
- 真源与 Cocos 副本零漂移；美术亦然，且"表里加了 id、图却没同步"会红；
- **工程骨架自洽**：打开编辑器不会遇到 Missing Script / 悬空引用。

**❌ 不能证明**
- 引擎 API 的**运行期真实行为**。类型只说明签名对 ——
  `Graphics.ellipse` 画出来什么样、节点缩放与 UI 相机的配合、Sprite 的混合模式，
  这些都在类型的外面。
- **画面是否真的画对了。这一条只能由你打开 Creator 点运行目视确认。**

所以：`verify_cocos.py` 全绿 ≠ 能跑；它绿了只说明"进编辑器之前，代码与工程骨架该对的都对上了"。

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
| 美术 | 三种鱼贴图（按素材宽高比定尺寸，不拉成方块）、五层环境背景（cover 铺满 + 换层换图）、潜航器机体贴图（按 `SUB_ART_R` 统一圆盘半径）、23 张商店立绘；全部可缺省（退回几何剪影） |
| 渲染 | 背景 + 环境色调 + `(1-vis)×0.42` 压暗 + 18 环暗角 + 屏幕边框 + 低氧暗角 + 方向性受击暗角 + 海雪、敌人（贴图 + 发光核心 + 深层定位环 + 蓄力预警圈）、Boss 血条、子弹、玩家机体（机体贴图 + 座圈 + 座塔 + 发射器 + 艏灯）、鱼骨、声呐波前、回声标记、酸液云、爆炸环、粒子（冲击波/击打痕/火花/飘字/电弧） |
| 输入 | WASD / 方向键 + 空格排气（边沿语义） |
| HUD | 氧气条（兼计时器）、波次点、器械装填条、遗物槽、层入场卡、状态提示 |
| 弹窗 | 商店三选一（立绘 + 购买/刷新/锁定）、补给站决策（下潜/上浮）、结算（生物质 × 倍率） |
| 镜头 | zoom 1.25 跟随 + 边界钳位；弹窗相位归位 1× 并居中 |

### 尚未移植 / 未做

- [ ] **`TitleScene`** —— 标题画面 / 潜航器选择 / 主菜单（结算屏的「返回主界面」目前是"重开"）
- [ ] **震屏** —— 模拟层已经抛 `shake` 事件，渲染层还没接（渲染层另有 `dodge` /
      `playerHurt` 两个事件也没接）。都还没接到表现上。
- [ ] **音效音乐** —— 注意：**web 版本本来就没有音效**（全仓搜不到音频文件，
      也没有任何 `AudioContext` 代码）。所以这不是"移植缺口"，是要**新增**的功能。
- [ ] 存档 / 局外元进度
- [ ] 手柄、触屏虚拟摇杆

---

## 已知坑（都是"注入 Creator 后才会暴露"的那类）

1. **运行时 `new Node()` 的 layer 是 `DEFAULT`，而 Canvas 的 UI 相机只渲染 `UI_2D`**
   → 漏一处就是"画面上什么都没有"。所以 `view/` 里所有建节点都走
   `mkNode()` / `mk()`，它强制继承父节点 layer。**场景里手写的节点同理**：
   `Dive.scene` 里 `Game` 节点的 `_layer` 必须是 `33554432`（UI_2D）。
2. **Sprite 要 `trim = false`。** `trim` 默认 `true`，会按"N 宫格/图集裁剪后的区域"
   渲染；而立绘的 contain 缩放是按**原图**比例算的，裁了就偏。
   同理取素材宽高比要用 `SpriteFrame.rect`（原图矩形），不要用 `originalSize`。
3. **敌人贴图必须按素材宽高比定尺寸，不能拉成正方形。** web 侧为此踩过一次并留了
   记录：素材实际比例是 swarm 1.99 / drift 1.54 / dash 0.55，旧代码统一
   `setDisplaySize(s, s)`，于是"一条 2:1 的长鱼被压成方块"，玩家看到的是**黑块**。
   现在的规则：长边 = `r × 3.1`，短边按比例算（只改视觉，不动碰撞半径）。
   另外**显示尺寸 < 26px 时退回矢量** —— 小尺寸上贴图细节会变成噪声（水母 60% 面积
   是细触须，缩到 14px 就糊成"白色小飞虫"）。
4. **Label 的锚点要跟着对齐方式走。** 在 `overflow = NONE` 下 Label 内容尺寸自适应
   文本，锚点 `(0.5, 0.5)` 意味着"文本中心落在节点位置" —— 于是右对齐的数字
   右边缘会随位数漂移（`10` 和 `100` 右边不一样齐）。锚点设 `0 / 0.5 / 1` 才是真贴边。
   这是 Phaser 侧 `setOrigin` 干的同一件事，移植时最容易整片漏掉。
5. **Cocos 3.8 的 `Camera` 没有 `zoom` 属性。** 只有 `orthoHeight`，而它是 `Canvas`
   组件自己托管的状态 —— 去改它等于跟引擎抢同一份状态，什么时候被覆盖回去取决于
   Canvas 的实现时机，而这条在沙箱里验证不了。所以镜头缩放改成**缩放 `WorldRoot` 节点**。
   （`Dive.scene` 里曾经序列化过 `"cam"` 指向相机，已一并删掉；相机仍由 Canvas 的
   `_cameraComponent` 持有，不会悬空。）
6. **Graphics 纪律**：每个图元必须建好路径立刻 `fill/stroke`，且配色紧贴其前。
   不能"先 `rect` 攒着、中途换色"—— 那会把前一个图形也染成新色。
7. **别把局部变量命名成 `col`**：`view/` 里的颜色构造函数就叫 `col`（来自 `Gfx`），
   同名局部变量会把它遮蔽掉，报错形式是莫名其妙的 "Type 'Number' has no call signatures"。
8. **全屏底色不能写死 `(0, 0, W, H)`**：设计分辨率与 `W×H` 宽高比不一致时，
   弹窗两侧会露出清屏色。`Hud.pageFill()` / `DiveGame.drawBg()` 都按 Canvas 实际
   尺寸外扩了。
9. **`cocos/tsconfig.json` 不要用于 CI**：它 `extends ./temp/tsconfig.cocos.json`，
   而 `temp/` 由编辑器首次打开时生成，沙箱里不存在。离线检查的 tsconfig 由
   `tools/verify_cocos.py` **现场生成**（因为 `cc` 声明的位置是机器相关的，
   静态文件必须"按机器改"，那就一定会有人忘了改、然后得到一份假绿）。
10. **`.creator/` 不能加进 `.gitignore`**：里面的 `default-meta.json` 是**工程配置**
    （图片按 sprite-frame 导入），官方 `empty-2d` 模板就是入库的。
    （本目录的 `.gitignore` 里有注释专门标注这一点。）
11. **场景里引用用户脚本用的是脚本资源的压缩 uuid**，不是完整 uuid。
    所以"用文本生成一个预挂组件的场景"这件事，成败全看压缩算法对不对；
    算错的症状是编辑器显示 **Missing Script**（画面还能跑，但组件不生效）。
    算法在 `tools/cocos_uuid.py`，`verify_cocos.py` 每次都会跑往返自检 + 引用比对。

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `shared/` | ★ 引擎无关真源（数值表 + 模拟核心 + 美术 key 表），改这里 |
| `shared/dive/artKeys.ts` | ★ "游戏需要哪些美术"的唯一说明（被两个引擎 + 验证脚本共用） |
| `tools/sync_shared.py` | 逻辑真源 → Cocos 副本同步 + 漂移检查 |
| `tools/sync_art.py` | 美术真源 → `cocos/assets/resources` 同步（含 webp→PNG、立绘降采样） |
| `tools/art_manifest.json` | 美术同步清单（源/目标双哈希，供 `--check` 双向核对） |
| `tools/verify_cocos.py` | Cocos 侧离线验证总入口（6 阶段，含真 `cc.d.ts` 类型检查） |
| `tools/dive_sim_smoke.js` | 模拟核心无头冒烟（21 条断言） |
| `tools/cocos_cc_stub.d.ts` | `cc` 最小声明桩（**仅在找不到引擎安装时兜底**，非引擎类型） |
| `tools/cocos_uuid.py` | Cocos 压缩 uuid 算法（与编辑器严格互逆，带自检） |
| `tools/gen_cocos_scene.py` | 工程骨架生成器（脚手架；默认拒绝覆盖已有场景） |
| `web/src/scenes/DiveScene.ts` | 移植对照的原始实现（6530 行 Phaser 场景） |
