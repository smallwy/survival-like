/**
 * 最小潜水循环 · Cocos Creator 主组件
 *
 * ---------------------------------------------------------------------------
 * 它做什么
 * ---------------------------------------------------------------------------
 * 一个组件管**两个状态**，由 `started` 切换：
 *
 *   ① 标题界面（started = false）——
 *      世界不 update、HUD 不画、只转发输入给 `Title`。
 *      为什么不是独立的 Cocos 场景：见 `Title.ts` 头部（核心是"打开工程点 ▶
 *      跑的是当前打开的场景"，加第二个 .scene 会把已经做好的「打开就能跑」弄没）。
 *
 *   ② 战斗（started = true）——
 *   update(dt) →
 *     ① 采样输入（WASD / 方向键 + 空格排气，空格是**边沿**）
 *     ② world.update(dt, input)            ← 模拟，引擎无关
 *     ③ world.drainEvents() → 生成表现（冲击波/击打痕/火花/飘字/电弧/爆炸环/震屏）
 *     ④ 把 world 的字段画出来（背景/敌人/玩家/炮塔/弹/鱼骨/波前/酸液）
 *     ⑤ 镜头跟随（zoom 1.25 + 边界钳位 + 震屏；弹窗相位归位 1×）
 *     ⑥ 按 world.phase 分派 HUD 与弹窗
 *
 * 跨局纪录（最深层/最佳带出生物质/上次用的艇）走 `view/save.ts` → `sys.localStorage`，
 * 算纪录的纯函数在 `shared/dive/profile.ts`（被无头冒烟测试覆盖）。
 *
 * ---------------------------------------------------------------------------
 * 节点树与绘制顺序（顺序本身就是设计，别随手调）
 * ---------------------------------------------------------------------------
 *   WorldRoot                       ← 锚点(0,0)、尺寸 W×H、位置 (-W/2,-H/2)
 *     ├ gBase     Graphics 不透明底色（外扩铺满）—— **必须在背景图之下**
 *     ├ bg        Sprite   环境背景图（cover 铺满世界，按层换图）
 *     ├ bgOld     Sprite   换带 crossfade 的**旧背景**（压在上面淡出，见 `beginXfade`）
 *     ├ gBg       Graphics 海雪 / 悬浮物（**在背景图之上**）
 *     ├ gVeil     Graphics 环境色调 + 压暗 + 暗角 + 屏幕边框（**必须低于实体**）
 *     ├ gAtmo     Graphics 光照与生态：远景鱼群 / 温跃层扫带
 *     │                    （**必须夹在 gVeil 与 gBack 之间**，见 buildNodes 的注释）
 *     ├ gBack     Graphics 酸液 / 鱼骨 / 声呐波前 / 回声标记 / 爆炸环（**鱼之下**）
 *     ├ fishLayer Node     敌人贴图池
 *     ├ gEnt      Graphics 敌人矢量 + 子弹 + 发光核心（**必须鱼之上**，见 buildNodes 的注释）
 *     ├ subNode   Sprite   潜航器机体
 *     ├ gPlayer   Graphics 玩家矢量件（座圈/炮塔/探照灯）+ Boss 血条
 *     └ gFront    Graphics 受击白闪 / 打击特效 / 火花 / 电弧
 *   Canvas
 *     ├ Hud                   战斗 HUD 与三个弹窗（见 Hud.ts）
 *     └ Title                 主界面（见 Title.ts；战斗期间整根隐藏）
 *
 * 为什么压暗层（gVeil）在**世界坐标**里而不是做成全屏节点 —— 因为 web 侧有一条
 * 铁律："暗幕只能压暗地形，敌人/气泡/玩家必须画在它之上，否则深渊层（可见度
 * 10%）会把 gameplay 信息一起吃掉"。要做成画在实体之上的全屏节点就必然违反它。
 * 于是这里换成"按当前可视矩形在世界坐标里画暗角"，效果等价且不破坏该规则：
 *   · 可视矩形 = 相机中心 ± (画布尺寸 / zoom / 2)
 *   · 带宽用 `屏幕带宽 / zoom`，所以放大后屏幕上的视觉宽度不变
 *
 * 震屏只抖 WorldRoot（HUD 是 Canvas 下的另一支，天然不跟着抖）——
 * 这比 web 好一点：Phaser 的相机震屏会把 scrollFactor=0 的 HUD 一起晃。
 *
 * ---------------------------------------------------------------------------
 * 编辑器里怎么用
 * ---------------------------------------------------------------------------
 * 场景 `assets/scenes/Dive.scene` 已经预挂好本组件（Canvas → Game → 本组件），
 * 设计分辨率也已在 settings/ 里设为 1304 × 749 —— **打开工程点运行即可**：
 * 先进主界面 → 点右下角「开始游戏」或按 Enter 打开**「出击准备」**（选潜航器 + 选开局武器）
 * → 再按 Enter / 点「确认出击」下潜。
 *   · 面板里：↑↓ 换行、←→ 在行内循环、1/2/3 直选潜航器、Esc 或点面板外返回主界面。
 *   · 主界面（面板关着）：1/2/3 或 ←→ 换潜航器（只影响船坞里的机体）。
 *
 * 美术**不需要导入**也能跑：`resources` 下没有图就退回 Graphics 画几何剪影
 * （主界面的三张潜航器立绘那时是空框，其余全是矢量）。
 * 带美术跑：先 `python tools/sync_art.py`（见 `art.ts` 头部说明）。
 *
 * 若从零搭场景，只需两步：
 *   1. 项目设置 → 项目数据 → 设计分辨率 `1304 × 749`；
 *   2. Canvas 下建空节点挂上本组件（节点 layer 必须与 Canvas 同层 = UI_2D）。
 *
 * ---------------------------------------------------------------------------
 * 坐标系（移植时最容易错的一处）
 * ---------------------------------------------------------------------------
 * 模拟层沿用 Phaser 的「左上原点、y 向下」，Cocos 是「左下原点、y 向上」。
 * 转换发生在三处，全部集中：
 *   · 图元 —— 全走 `Gfx` 包装（内部 `y → H - y`）；
 *   · 节点定位 —— `(x, y) → (x, H - y)`；
 *   · 旋转 —— sim 的 `θ`（y 向下、顺时针为正）→ `node.angle = -θ°`。
 *     依据：引擎实现是 `set angle(val) { Quat.fromAngleZ(this._lrot, val) }`，
 *     即 **node.angle 逆时针为正**（y 向上的右手系），与 sim 正好反号。
 */

import {
  _decorator, Component, Node, Graphics, Label, Sprite, SpriteFrame, UITransform, UIOpacity,
  input, Input, EventKeyboard, KeyCode,
} from 'cc'
import { Gfx, col } from './Gfx'
import { neon, neonLine, neonCircle } from './neon'
import { Hud } from './Hud'
import { Title } from './Title'
import { Codex } from './Codex'
import { SpriteBank, frameAspect } from './art'
import { loadProfile, saveProfile } from './save'
import { DiveWorld, ANGLER_GEOM } from '../shared/dive/world'
import { applyRun, defaultProfile, depthLabel, recordLabel } from '../shared/dive/profile'
import {
  settleProgress, unlockName, perkBonus, filterPool,
  canBuyPerk, buyPerk as buyPerkPure,
} from '../shared/dive/unlocks'
import type { PerkId } from '../shared/dive/unlocks'
import { codexGains } from '../shared/dive/codex'
import type { Profile } from '../shared/dive/profile'
import {
  CAM_ZOOM, TURRET_R, EMITTER_SIZE, SUB_D, BASE_SEATS, WEAPON_DEF,
  BONE, weaponFamily, LAYER_ECO, LAYERS,
} from '../shared/dive/tables'
import { UI } from '../shared/theme'
import { SUBS, getSub } from '../shared/subs'
import type { SubId } from '../shared/subs'
import type { SimEvent, InputState, Enemy, WeaponId, WeaponFamily } from '../shared/dive/types'
// 开局武器的默认值 & 候选清单（V6.41）。清单只有一份，在 shared 里 —— 见 loadout.ts 头注
import { DEFAULT_START_WEAPON } from '../shared/dive/loadout'

const { ccclass, property } = _decorator

// ---------------------------------------------------------------------------
// 表现层粒子（模拟层不持有这些 —— 全部由 SimEvent 触发生成）
// ---------------------------------------------------------------------------
interface Shock { x: number; y: number; r: number; rMax: number; life: number; maxLife: number; color: number; width: number; core: number; rings: number; ringDelay: number }
interface Slash { x: number; y: number; ang: number; len: number; life: number; maxLife: number; color: number; width: number }
/**
 * 火星。`ang` 是**自己的飞行方向** —— 命中火星要沿它拉成短条（"溅"不是"点"），
 * 枪口闪光要用它画朝弹道方向的锥形亮弧。缺了它这两个都退化成"圆点"，看不出方向。
 */
interface Spark { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: number; size: number; ang: number; kind: 'hit' | 'flash' }
/** 折线残留。电弧（紫）与网目（玉/青）共用 —— 都是"几条折线段存活 0.2s" */
interface ArcFx { pts: Array<{ x: number; y: number }>; life: number; color?: number; maxLife?: number }
interface BlastFx { x: number; y: number; r: number; life: number }
interface FloatFx { x: number; y: number; vy: number; life: number; text: string; color: number; size: number; delay: number; label: Label }
/**
 * 一颗悬浮物（海雪 / 有机碎屑）。
 *
 * ⚠️ 这里**没有 `vy`** —— 速度不逐条存，而是每帧由 `MOTE_MUL[带] × scrollV` 现算（V6.56）。
 *    逐条存速度的话，换带爆冲（`SCROLL_BURST`）只能推快**新生成**的颗粒，
 *    屏幕上已有的那批还在按老速度走 ⇒ "换带时整片水没一起动"。
 *    `jit` 只是每条 ±20% 的抖动，免得整屏颗粒像一块板在移动。
 */
interface Mote {
  x: number
  y: number
  r: number
  jit: number
  far: boolean
  /** 自身不透明度（**个体固定**，不是每帧随机 —— 每帧随机会闪成"雪花屏"）*/
  a: number
  /** 横向摆动相位（L2 悬浮絮随暗流左右摆；其余带 `wob = 0` 时无敌）*/
  ph: number
}

/**
 * 远景鱼群的一条剪影（V6.53）。
 *
 * 它属于 V6.51 定义的**生态两层**里的「远景剪影层」：
 *   · **无 2px 发光核** —— 那枚核是敌人的定位铁律（见 `drawEnemies` 里的说明与
 *     `DiveGame.ts` 文件头的层序注释）。破了它，玩家会朝打不到的鱼开火；
 *   · 只表示"水里有别的东西"，**不可瞄准、不碰撞**。
 *
 * 侧视下"远近"没有透视可依（正交视角），所以**深度只能用大小 + 明暗表达**
 * （近大而实 / 远小而淡）—— 这也是 V6.55 之后必须把体色压成剪影的原因：
 * 亮色 + 小尺寸在暗水里只读作"雪花"，读不出"那是一条鱼，而且它在远处"。
 */
interface SchoolFish {
  x: number; y: number
  /** 水平游速（符号即方向）。远景鱼群**只横游** —— 斜着游会和"层"的读法打架 */
  vx: number
  /** 体长（px） */
  size: number
  /** 摆尾相位。每条不同，否则一群鱼像一块板 */
  phase: number
  /** 0→1 渐入。换带时新鱼群不能"啪"地出现（那读作 bug） */
  fade: number
  /** 目标不透明度。**硬上限 0.30**（0.35 已接近敌人剪影的可见度） */
  alpha: number
}

/**
 * 远景鱼的**单条轮廓**（V6.64）。归一化坐标：
 *   `u` = 从头到尾 0→1 · `v` = 横向半高比例（正负 = 上下）。
 *
 * ⚠️ **为什么从"椭圆 + 三角尾"换成一条完整轮廓**：椭圆没有**任何鱼的结构特征**
 * —— 没有最厚点的位置、没有尾柄的收细、没有分叉的尾鳍。压到远景尺寸（26~78px）后，
 * "一个扁椭圆 + 一片三角"读作**一片叶子 / 一只蝌蚪**，读不出"鱼"。
 *
 * 一条鱼能被认出来，靠的是**三个结构事实**，缺一个就散：
 *   ① **最厚点在体前 38%**（不是正中）—— 鱼的重心靠前，这是"头在这一端"的读法；
 *   ② **尾柄收细、但收不细过头**（见下方 ⚠️）；
 *   ③ **尾鳍在纵向张开、后缘成 V 形缺口**（上叶 → 缺口 → 下叶）。
 *
 * 用**一个多边形**画完整条鱼还有一个额外好处：**1 个图元/条**（原来是椭圆 + 三角 = 2），
 * L1 的 46 条从 92 图元降到 46 —— 腾出的预算回流给光照层（雾 / 探照灯 / 荧光）。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ V6.64 二次修正：第一版四条点在纵向上几乎重合 ⇒ 整体读作**一支飞镖**
 * ---------------------------------------------------------------------------
 * 第一版尾鳍写的是 `[1.20, 0.70] / [0.94, 0.00] / [1.20, −0.70]`：
 * 尾叶只张开 **0.70 半高**，而身体最厚处是 **1.00** ⇒ 尾比身体**还窄**，
 * 加上尾柄收到 0.22（几乎归零）、身体长达 1.0 ⇒ 剪影上的信息只剩"一个尖角"，
 * 缩到 26px 直接读成**箭头 / 飞镖**（预览图实例）。
 *
 * ⇒ 两条反向修正：
 *   · **尾鳍要张开**：半高抬到 **1.05**，超过身体最厚处（真鱼尾鳍确实宽于体高）；
 *   · **尾柄不能收得太细**：0.22 → **0.38**。尾柄在 26px 上只有约 2px，
 *     收到 0.22 就等于**断开** ⇒ 尾鳍读作"飘在旁边的一块三角"。
 *   · 身体后段（0.62 处）从 0.60 抬到 0.72 ⇒ 后段不收太早，轮廓更饱满。
 */
const FISH_OUTLINE: Array<[number, number]> = [
  // 上边缘：钝头 → 最厚(0.38) → 后段渐收 → 尾柄
  [0.00, 0.16], [0.16, 0.60], [0.38, 1.00], [0.62, 0.72], [0.82, 0.38], [0.98, 0.26],
  // 尾鳍：上叶 → **V 形缺口** → 下叶（张开到 1.05，**宽于体高**）
  [1.24, 1.05], [0.94, 0.10], [1.24, -1.05],
  // 下边缘：从尾根回到头（与上边缘对称）
  [0.98, -0.26], [0.82, -0.38], [0.62, -0.72], [0.38, -1.00], [0.16, -0.60], [0.00, -0.16],
]

/**
 * **每带的水体物质**（V6.51 §9 第 4 步「海雪 → 五带物质」）。
 *
 * 为什么必须分层：五带现在**换了背景图、换了光**，但如果悬浮物还是同一种白点，
 * 玩家会觉得"我只是换了张壁纸"。物质是**最贴脸的深度线索** —— 它就在眼前 20cm 处。
 *
 * | 带 | 物质 | 读法 |
 * |---|---|---|
 * | L1 | 海雪 | 冷白圆点，最亮（阳光穿过，什么都照得见）|
 * | L2 | 悬浮絮 | **拉长成条 + 左右摆** —— 暗流把絮状物拽成丝 |
 * | L3 | 荧光碎屑 | 青紫，**亮度跨度最大**（少数特别亮 = 会闪的东西）|
 * | L4 | 热泉微粒 | 暖橙（被热泉与矿物染过）|
 * | L5 | 深渊雪 | 靛白，最小最暗（这里没有光，只有微弱散射）|
 *
 * `sq` = 长宽比（>1 拉成横条）；`wob` = 横向摆动幅度（px）；
 * `aLo/aHi` 是**近景**的 alpha 区间，中景乘 0.5（见 `drawBg`）。
 */
interface MoteStyle { col: number; sq: number; wob: number; aLo: number; aHi: number; sMul: number }
const MOTE_STYLE: readonly MoteStyle[] = [
  { col: 0xdff2ff, sq: 1, wob: 0,  aLo: 0.18, aHi: 0.34, sMul: 1.00 },   // L1 海雪
  { col: 0xa8d8e0, sq: 5, wob: 16, aLo: 0.14, aHi: 0.26, sMul: 1.15 },   // L2 悬浮絮
  { col: 0x9a86e8, sq: 1, wob: 0,  aLo: 0.16, aHi: 0.52, sMul: 0.85 },   // L3 荧光碎屑
  { col: 0xffb070, sq: 1, wob: 0,  aLo: 0.18, aHi: 0.38, sMul: 1.05 },   // L4 热泉微粒
  { col: 0xa8b8e8, sq: 1, wob: 0,  aLo: 0.10, aHi: 0.20, sMul: 0.75 },   // L5 深渊雪
]

// ---------------------------------------------------------------------------
// 光照层的四个元素（V6.59，V6.51 §4.2–§4.5）
// ---------------------------------------------------------------------------

/**
 * 荧光链（§4.3）。锚点缓慢下沉 + 摆动，`pts` 是**相对锚点**的偏移。
 * 形态是"链"不是"亮一点的点" —— 3–7 个点串成一串才读得出生物。
 */
interface FluoChain {
  x: number; y: number
  pts: Array<{ dx: number; dy: number }>
  /** 呼吸相位。每串独立 ⇒ 整屏不同步（同步读作"脉动 bug"）*/
  ph: number
  /** 用青绿副色（20%）*/
  warm: boolean
}

/** 热泉烟柱（§4.4）：从下方升起、向上扩散的絮状柱 */
interface Vent { x: number; y: number; w: number; ph: number }

/** 深渊呼吸点阵的一颗（§4.5）*/
interface AtmoDot { x: number; y: number; r: number; ph: number; halo: boolean }

/**
 * **交互光反馈**的一条（V6.51 §6）。
 *
 * 解决的问题：**战斗打得再猛，背景一点反应都没有** ⇒ 背景读作"贴纸"。
 * 环境亮一下，就是把"战斗"与"水"缝在一起的那一针。
 *
 * ⚠️ 与 `gBack` 的「爆炸环」**不是一回事**：那个是**冲击波**（几何环、硬边、跟随弹体尺寸），
 *   这个是**环境反光**（亮斑、软边、大范围、低 alpha）。两者叠加才是
 *   "炸了一下，**整个水都亮了**"。
 */
interface AtmoFlash {
  x: number
  y: number
  /** 起止半径（px）。扩散类（爆炸/拾取）r1 > r0；开火是短促亮斑，r1 ≈ r0 */
  r0: number
  r1: number
  /** 已存活 / 总时长（s）*/
  life: number
  dur: number
  col: number
  /** 峰值 alpha（在 `life = 0` 处）*/
  a: number
}

/**
 * **网张开**的一次（V6.61 按物理重写）。
 *
 * V6.60 及以前：`pushShock` 画一圈**同心圆环** —— 那是**冲击波**的形状，不是网的形状。
 * 物理上，撒出去的网（cast net）是**柔性体**：
 *   ① **沿运动方向拉长**：甩出时迎水的一面被向后拖 ⇒ 张开形状是水滴形，不是圆；
 *   ② **网缘是扇贝形**：铅坠（sinkers）是网缘上**离散的**配重块，相邻两颗之间的
 *      网衣被水顶起成弧 ⇒ 边缘是波浪，不是光滑圆；
 *   ③ **先展开后收拢**：靠离心力张开到最大，随后水阻让网衣向网缘堆 ⇒ 会**塌回去**；
 *   ④ **各段不对称**：抛出时网衣折叠不均，每段的下垂量都不同（`ph` 存这个随机量）。
 */
interface NetOpen {
  x: number
  y: number
  /** 抛出方向（rad）＝ 长轴方向 */
  ang: number
  /** 基准半轴（px），等于判定半径 `NET_R` */
  r: number
  col: number
  life: number
  maxLife: number
  /** 12 个网缘分区各自的随机下垂量 `0..1`（打破完美对称）*/
  ph: number[]
}

/** 贴图池里的一条：`key` 让它能被同种敌人复用（与 web 的 fishPool 同构） */
interface Fish { sp: Sprite; key: string }
/**
 * 受击白闪的覆盖层标记（本帧）。
 *
 * 为什么需要一个中间结构：白闪要**盖在鱼身之上**才看得见，而敌人自己画在 `gEnt`
 * —— 那一层在 `fishLayer`（鱼贴图）**之下**，画上去会被鱼身挡住。
 * 所以 `drawEnemies` 只登记位置与透明度，真正绘制挪到 `drawFx`（`gFront`，全场最高层）
 * 的**开头**，与 web 的层序一致：鱼的白色剪影 < 冲击波 < 击打痕 < 火花。
 */
interface FlashMark { x: number; y: number; r: number; alpha: number }

/**
 * 位图击杀特效（V6.40）。与 `Shock` 等矢量特效**并存**，不是替代：
 *   矢量负责"环 + 火花"这类**每帧重画**的几何（便宜、能连续动画）；
 *   位图负责"晶体碎片 / 水泡"这类**手绘质感**（Graphics 画不出锐利的多面碎片）。
 *
 * 三张贴图在 `shared/uiArt.ts` 的 `FX_TEX_PATH` 里登记；选哪张由**敌人类型**决定：
 *   swarm / dash → 环（干净利落）
 *   drift（水母类） → 水泡（呼应"半透明胶质"）
 *   boss / 精英 → 爆散（最大最重的那个）
 */
interface FxBit {
  sp: Sprite
  key: string
  x: number; y: number
  r0: number; r1: number      // 起始 / 结束显示半径（px）
  rot0: number; rot1: number  // 起始 / 结束角度（度）—— 轻微旋转让它"活"
  life: number; maxLife: number
}

/** 从击杀事件挑一张特效贴图。返回 null = 该敌人不配位图特效（走纯矢量）。 */
function fxKeyFor(kind: string, r: number): string | null {
  if (kind === 'drift') return 'fx_bubble'
  if (kind === 'boss') return 'fx_burst'
  // 小怪：体量够大才给（每只都爆一张图 = 十几只同屏时纯浪费，且糊成一片）
  if (r >= 12) return 'fx_ring'
  return null
}

const SHOCK_CAP = 64
const SLASH_CAP = 48
const SPARK_CAP = 260
const FLOAT_CAP = 32
/** 敌人贴图池上限。web 侧的阈值是"同屏 >120 条就整体退回矢量" */
const FISH_CAP = 140

/**
 * 侧视敌人的**最大仰俯倾角**（弧度）。`0.611 ≈ 35°`。
 *
 * V6.52 §2.1。敌人贴图（`fish/swarm.png` / `fish/dash.png`）本身是**侧视画法、头朝左**。
 * 侧视只允许两个自由度：**左右镜像** + **±35° 仰俯**（鱼能仰冲 / 俯冲，但不能翻滚）——
 * 头朝上/头朝下是**俯视**才有的自由度，也正是"体感奇怪"的来源。
 */
const SIDE_TILT = 0.611

/**
 * 远景鱼群的**体色**（按带）。V6.53 新增，**V6.55 从"亮色"整组翻成"背光剪影"**。
 *
 * ---------------------------------------------------------------------------
 * 为什么翻（2026-10-14 用户实机反馈）
 * ---------------------------------------------------------------------------
 *   v1 用了一组亮色（`0xbfe9ff` 淡青白…），想法是"让玩家看得见水里有东西"。
 *   实机后果很糟：在深海背景上，46 条亮青椭圆读作**天上飘的云 / 落的雪**，
 *   完全不像鱼群 —— 用户原话就是「背景的白色」。
 *
 *   物理上也站不住：**水下的鱼绝大多数是背光剪影**。光从上方来，你在下面看远处的鱼，
 *   看到的是"比水体更暗的形状"；只有**自身会发光**的生物才是亮的。所以正确的分档是：
 *     · L1 / L2 / L4 —— **比水体暗的剪影**（背光）；
 *     · L3 午夜带 —— 唯一**亮**的一带（生物荧光，正是 V6.51「光的主权转移」给它的主角位）；
 *     · L5 深渊带 —— 近黑巨影（压迫感来自"一大团黑东西在动"，不是"一团亮"）。
 *
 * ⚠️ 这一层画在 `gVeil`（压暗 + 暗角）**之上**（见文件头层序）⇒ **它不吃压暗**。
 *    选色要按"压暗之后的水色"去配，不要照抄背景图的原始色。
 * ⚠️ 调观感只动这个数组 + `ATM_FISH_ALPHA`，**不要**去改 `drawAtmo` 里的几何。
 */
const ATM_FISH_TINT = [
  0x2b5266,   // L1 阳光带 · **背光剪影**（水是亮的 ⇒ 取比水暗一大截的同色系）
  0x5f97a2,   // L2 弱光带 · 微光轮廓（水已经暗了 ⇒ 再暗就直接消失，只能略亮）
  0x74f2cc,   // L3 午夜带 · **生物荧光**（唯一亮的一带，V6.51 给它的主角位）
  0x8a6a48,   // L4 热泉带 · 暖光轮廓（同 L2 的理由，换成热泉的暖色）
  0x33485c,   // L5 深渊带 · 巨影（近黑水里唯一能读出来的"一团灰蓝"）
]
/**
 * 远景鱼群的**不透明度区间**（按带，`[min, max]`）。
 *
 * ⚠️ 这组数是**在 `tools/preview_atmo.py` 的合成图上试出来的**，不是拍脑袋：
 *   · v1 偏低 ⇒ 暗色剪影在 L2/L4/L5 的暗水里**直接消失**（"没有鱼"也是失败）；
 *   · v1 又偏高 + 用亮色 ⇒ 读作"飘白云"（用户报的问题）。
 * 现在按"**比水体偏一点点**"配：能看到有东西在动，但绝不比敌人抢眼。
 */
const ATM_FISH_ALPHA: ReadonlyArray<readonly [number, number]> = [
  [0.26, 0.44],   // L1 背光剪影
  [0.18, 0.32],   // L2 微光轮廓（亮色，压低免得浮起来）
  [0.22, 0.40],   // L3 生物荧光
  [0.16, 0.30],   // L4 暖光轮廓
  [0.30, 0.48],   // L5 巨影（要"实"，压迫感全靠它）
]

// ===========================================================================
// 光的主权转移（V6.51 §4，2026-10-14 落 V6.59）
// ===========================================================================
/**
 * 大气层的**质量档**（V6.51 §8.2）。低端机只能整体砍这一层，必须留旋钮。
 *
 * `2` = 全开
 * `1` = 关掉"光晕环 / 呼吸环"（L5 点阵光晕、L4 烟柱外段、L3 荧光链光晕）≈ −45 图元
 * `0` = 只留 鱼群 + 探照灯 + 雾（≈ −160 图元）
 *
 * ⚠️ **降级不许动鱼群与探照灯** —— 一个是用户直接点名要的（"不同水域要有海生物、鱼群"），
 *    一个是"我能看见"的因果来源。砍了它们，这一层就没有存在理由了。
 *
 * ⚠️ 显式标 `: number`：不标的话 TS 会把它推成字面量类型 `2`，
 *    于是下面 `ATMO_QUALITY === 0` 这类判断会报 TS2367（"没有重叠"）。
 *    它是**旋钮**，本来就该是 `number`。
 */
const ATMO_QUALITY: number = 2

// ---- 玩家探照灯（§4.7）----
/**
 * 探照灯颜色。冷白但**不是纯白** —— 纯白在深色水里读作"UI 元素"，
 * 玩家会以为那是可交互的东西。
 */
const LAMP_COLOR = 0xbff4ff
/**
 * 探照灯**基准半径**（屏幕 px）。
 * ⚠️ V6.60 从 140 提到 **168**（步长 11→9 ⇒ L5 = 132）：用户实机反馈
 *   「探照灯是柔和光晕**不明显**」。半径是"照到多大一片水"的直接表达 ——
 *   140 在 1304 宽上只覆盖直径 280 ≈ 屏幕宽的 21%，读作"贴了个贴纸在船身上"。
 */
const LAMP_R = 168
/** 每带收缩步长：`LAMP_R - LAMP_STEP × layerIdx` ⇒ L1 168 → L5 132 */
const LAMP_STEP = 9
/**
 * **单层** alpha（内层同 alpha 由外向内叠，中心被覆盖 `LAMP_BANDS` 次）。
 * 0.030 → **0.044**：14 层累积 ≈ 1 − 0.956¹⁴ = **0.47**（原 8 层 ×0.030 ≈ 0.22）。
 * ⚠️ **内层**绝不能用"每层一个不同 alpha"来提亮 —— 那会显出**靶环**（V6.59 预览图实测）。
 *   提亮只能靠**层数**与**单层值**。
 * ⚠️ 但**最外 `LAMP_EDGE_N` 层**必须走淡入梯度（`LAMP_EDGE_RAMP`）：最外那层
 *   是从"零覆盖"直接跳到"一次覆盖"，在**圆的边界**上留下一条可见的圆周线
 *   （V6.60 预览图里就是个清清楚楚的圆盘边）。边界跳变 0.044 → 0.015 之后消失。
 *   区别在于：**外圈的淡入不是靶环**（靶环要的是"内层之间的台阶"）。
 */
const LAMP_ALPHA = 0.044
/** 最外几层做淡入梯度（消掉圆的边界线）*/
const LAMP_EDGE_N = 3
/** 那几层的 alpha 倍率（外 → 内）*/
const LAMP_EDGE_RAMP = [0.35, 0.60, 0.85]
/** 外圈→中心的层数（越大越平滑）*/
const LAMP_BANDS = 14
/**
 * 半径分布指数：`r_i = R × (1 − i/n)^LAMP_POW`。
 * ⚠️ 值 >1 ⇒ **内层更密** ⇒ 覆盖次数在中心快速上升 ⇒ 自然形成一个"亮斑"。
 *   V6.60 第一版是**加两层独立亮芯**（0.30R / 0.15R），预览图里那两层在 0.30R 处
 *   留下一条**清晰的圆周硬边**，读作"圆盘"而不是"光晕"。硬边来自"半径突变的层"，
 *   不来自 alpha —— 所以修法是**换半径分布**，不是调 alpha。
 */
const LAMP_POW = 1.35
/**
 * 探照灯的**淡入深度区间**（`depthM`，m）：120 → 600 线性 0→1。
 *
 * L1 是白天（顶光还在），灯亮着反而假；L2 起才是"光不够了，我把灯打开"。
 * 用深度而不是带的索引 —— 带是离散的，深度是连续的，淡入才不会有台阶。
 */
const LAMP_D0 = 120
const LAMP_D1 = 600

// ---- 交互光反馈（§6）----
/**
 * 同时在场的 flash 上限。开火很频繁（6 座 × 各 0.3s 间隔 ≈ 20 次/s），
 * 0.12s 的命也想叠满 8 个得 66 次/s —— 实际常态 2~3 个，上限只是防御性封顶。
 */
const FLASH_CAP = 8
/** 每条的同心层数（同 alpha 累叠 ⇒ 中心最亮、边缘柔）。3 层 × 8 条 = 24 图元封顶 */
const FLASH_LAYERS = 3
/**
 * 三种触发的参数。`r0 → r1` 是**扩散**：爆炸与拾取要"亮起来并散开"，
 * 开火是短促亮斑（r0 ≈ r1，几乎不散，只是闪一下）。
 *
 * 颜色分工：开火**冷白**（与探照灯同源 = 我的灯打出去的）/ 爆炸**暖白**（高温）/
 * 拾取**青**（与鱼骨、磁吸特效同色 = "这是收入"）。
 */
const FLASH_MUZZLE = { r0: 20, r1: 38, dur: 0.12, col: 0xdff2ff, a: 0.26 }
const FLASH_BLAST = { r0: 56, r1: 158, dur: 0.28, col: 0xffe6bc, a: 0.30 }
const FLASH_PICK = { r0: 140, r1: 248, dur: 0.20, col: 0x6fe8ff, a: 0.13 }

// ---- 网张开（V6.61 按物理重写）----
/** 张开动画总时长（s）。比爆炸环（0.32）长 —— 柔性体的展开与塌陷比冲击波慢 */
const NET_DUR = 0.52
/**
 * **展开段占比**：`0 → NET_OPEN_END` 是张开，`NET_OPEN_END → 1` 是塌陷收拢。
 * ⚠️ 这段比例是"网"与"冲击波"的分界：一直往外扩 = 爆炸，会让人以为这是个伤害圈。
 */
const NET_OPEN_END = 0.42
/** 沿抛出方向的**拉伸倍率**（在展开段末达到最大）。网迎水的一面被向后拖 ⇒ 沿速度方向拉长 */
const NET_STRETCH = 0.45
/** 水滴形：前端（抛出方向）比后端窄多少。前尖后宽 = 被甩出去的形状 */
const NET_TAPER = 0.22
/** 网缘**扇贝波**的幅度与瓣数（相邻铅坠之间的网衣被水顶起）*/
const NET_SCALLOP = 0.035
const NET_SCALLOP_N = 6
/** 网缘分区数 = 铅坠颗数 */
const NET_SEGS = 12
/** 各分区的随机下垂量幅度（抛出时网衣折叠不均 ⇒ **不能**完美对称）*/
const NET_JITTER = 0.05
/** 塌陷段收拢到的比例 */
const NET_COLLAPSE = 0.82
/** 同屏张开动画上限。网的 cd 是 2.4s 级、动画 0.52s ⇒ 常态 1~2 个，6 足够 */
const NET_CAP = 6

// ---- 能见度雾（§4.6）----
/**
 * 各带的**能见度半径**（屏幕 px）。`0` = 该带不画。
 *
 * ⚠️ 这里是"雾"而不是"黑"：**雾是亮的暗，黑是暗的暗**。
 *    玩家看到黑幕会认为"我瞎了"；看到浑浊的**同色**雾才会认为"我看不了太远"
 *    —— 后者才是潜水感。所以雾取当前带的 `tint`，绝不取 `UI.abyss`。
 */
const FOG_R = [0, 640, 480, 380, 300]
/** 同心环带数（§4.6 原写「8 环」）。**实测加到 12** ——
 *  8 环在 1304×749 上每环跨 ~75px，环与环之间的 alpha 台阶**肉眼可见**
 *  （`tools/preview_lights.py` 的合成图直接看出来了）。12 环仍是 12 个图元，代价可忽略。
 *  ⛔ 仍然禁用径向渐变（会被反复叠加成死黑）—— 环带每像素只覆盖一次。 */
const FOG_BANDS = 12
/** 最外圈的峰值不透明度。内圈几乎为 0 —— 幂曲线才能拉开"近处清、远处浊"，
 *  又不会在 `rIn` 处留下一条硬边（线性会留下一条可见的圆环）。 */
const FOG_ALPHA = 0.22

// ---- 丁达尔光柱（V6.65 **已移除**，原因见下）----
/**
 * ⛔ **光柱 / 光幕渲染已从渲染层移除**（2026-10-15，用户判定「效果太差」）。
 *
 * 移除的不是「物理对不对」，是**技术路线错了**：`Graphics` 没有渐变、没有模糊、
 * 没有软笔触 —— 而体积光的全部观感就来自**边缘的软过渡**。用矢量多边形去凑，
 * 无论物理推导多严谨（Beer–Lambert 衰减 / 分波长吸收 / 散射扩散 / 行波调制），
 * 叠出来的都是**一层带硬边的半透明色块**，越「物理」越像贴纸。
 * 这是 V6.60 → V6.61 → V6.64 三轮都判失败的**同一个根因**。
 *
 * ⇒ **光的表现整体下放到资源层**：丁达尔光柱画进 env 背景图
 *   （见 `docs/资源重出规格_V6.58.md` 与插画岗交接单里的 L1/L2 提示词）。
 *   env 图是真位图，能带真实渐变与散射；渲染层不再画任何「光柱」。
 *
 * ⚠️ 连带移除的还有 `BEAM_LIT_GAIN`（光束内的颗粒被照亮）—— 没有光束就没有
 *   照亮的对象，留着只会让 L1/L2 的颗粒**凭空变亮**且无因。
 */

// ---- 生物荧光群（仅 L3，§4.3）----
/** 荧光链条数（§4.3「6–8 串」）*/
const FLUO_CHAINS = 7
/** 主色 · 青紫 */
const FLUO_COLOR = 0xa88cff
/** 20% 用青绿打破单一 —— 整屏一个色会读作"贴图重复" */
const FLUO_COLOR2 = 0x6ff0d0

// ---- 热泉烟柱（仅 L4，§4.4）----
/** 烟柱条数 */
const VENT_N = 6
/** 核心色（暖）*/
const VENT_HOT = 0xff8a3c
/** 外缘色（浊）*/
const VENT_EDGE = 0x8a3a18

// ---- 深渊呼吸点阵（仅 L5，§4.5）----
/** 点阵颗数 */
const DOTS_N = 48
/**
 * 点阵的**同步呼吸周期**（s）。3.2 与主循环 14.4 取**非整数比**（4.5）——
 * 与其它周期同步会读作"画面在闪"，非整数比才读作"底下有个巨大的东西在呼吸"。
 */
const DOTS_PERIOD = 3.2
/** 点阵避开屏幕中央的半径（px）—— 给战斗留一块干净区域 */
const DOTS_SAFE_R = 260

// ===========================================================================
// 下潜滚动与换带（V6.52 §3.1 / §3.2 / §3.3，2026-10-14 落 V6.56）
// ===========================================================================
/**
 * 悬浮物的**基准上掠速度**（px/s）。玩家下潜 ⇒ 水里的东西**向上掠过**。
 *
 * V6.52 §3.2：现状 `vy = 6~20` 慢了一个数量级 —— 屏幕上几乎看不出在动，
 * 所以"我在下潜"这件事**只有深度数字在说**，画面不说。46 px/s 是
 * "一眼能看出在动、又不至于晕"的档位（≈ 屏幕高的 6%/s，13s 扫过一屏）。
 *
 * ⚠️ **符号约定（极易写反）**：`scrollV` 恒为**正数**，消费者一律用 **`y -= scrollV × …`**
 *    —— sim 坐标 y 向下，只有"减小"才是**向上掠过**。写成 `y += …` 会得到
 *    "颗粒往下飘"（= 上浮），与下潜完全相反，且**不报任何错**（V6.56 踩过一次）。
 */
const SCROLL_BASE = 46
/**
 * 换带时的**爆冲速度**（px/s）。V6.52 §3.1：`4.8×`，指数衰减 `e^(-t/0.9)`。
 *
 * 这是"下潜是**动作**不是**切图**"的核心 —— 换带那一刻世界猛地往上一窜，
 * 玩家读到的是"我在加速下潜"，而不是"背景图跳了一下"。
 * 与 §3.3 的"起势 0.8s"是同一件事的两种描述：瞬时置顶 + 指数衰减，
 * 视觉上就是"猛冲一下然后缓和"。
 */
const SCROLL_BURST = 220
/** 爆冲的指数衰减时间常数（s）。越小收得越快 */
const BURST_TAU = 0.9
/** 温跃层扫带时长（s）。V6.52 §3.3 ② */
const SCAN_DUR = 0.6
/**
 * 背景 crossfade 时长（s）。V6.52 §3.3 ③。
 *
 * ⚠️ **必须 < `descDur`（2.1s）**：下潜相位一结束就 `startWave()`，若 crossfade
 *    还没跑完，屏幕上会留着一个"半透明的中间态"（两张图各一半），
 *    而对面的鱼已经冲过来了。2.0 留 0.1s 余量。
 */
const XFADE_DUR = 2.0
/** 水压环时长（s）。V6.52 §3.4：3 圈从屏幕中心外扩 */
const RING_DUR = 0.9

/**
 * **换波「下探节拍」的爆冲峰值**（px/s）。V6.49 §2 / V6.50 §下探节拍。
 *
 * 为什么它比换带更重要：全流程下潜次数 **5 → 25**。同样 156s 的战斗，
 * 从"我打完 4 波然后换了个地方"变成"**我一直在往下沉**"。
 *
 * ⚠️ **峰值必须明显小于换带**（0.52×）：换带 5 次/局 = **事件**，
 *   换波 20 次/局 = **节拍**。两者同强度的话，节拍会把事件淹掉 ——
 *   **对比度**才是这套设计的核心（同 `SCROLL_BURST` 的 4.8× 逻辑）。
 *   115 px/s ≈ 常态的 **2.5×**：一眼看得出"往下沉了一截"，
 *   但不至于被误读成"换水域了"。
 */
const WAVE_BURST = 115
/** 换波节拍的水压环强度倍率（换带是满环 1.0）。环是"又穿过了一小段水"的确认 */
const WAVE_RING = 0.55

/**
 * 颗粒的**视差系数**（按带，`[近景, 中景]`）。
 *
 * V6.52 §3.2 定的是三档：远景（背景图）静止 / 中景 0.35× / 近景 1.00×。
 * 近快远慢 = 视差 = 深度线索。**远景不滚**（背景图没有可滚的特征，见 §3.1 说明），
 * 所以这里只有两个系数。
 *
 * ⚠️ **L4 热泉带整组反向**：`ventPush = 190` 会把玩家顶开，热流本身是**向下**的
 *    （被顶到上面的冷水沿着泉口往下补），所以那里颗粒逆着走。
 *    **这是机制与视觉第一次说同一句话** —— 玩家看到颗粒往下走，
 *    紧接着手感上被顶开，两件事互相解释。数值取 `-0.62`：反向但不满速，
 *    读作"水流被顶住了"，而不是"整片水在倒流"。
 */
const MOTE_MUL: ReadonlyArray<readonly [number, number]> = [
  [1.00, 0.35],    // L1 阳光带
  [1.00, 0.35],    // L2 弱光带
  [1.00, 0.35],    // L3 午夜带
  [-0.62, -0.22],  // L4 热泉带 · **反向**（ventPush 的视觉证据）
  [1.00, 0.35],    // L5 深渊带
]

/**
 * 鱼骨辉光的**同心圈层数**（V6.48 性能）。
 *
 * 鱼骨是本作唯一可拾取物，"会发光 = 能捡"是玩家唯一能依赖的读法 ⇒ 辉光是**功能**，不能删。
 * 能省的只有"同心圈数"：3 圈的观感与 2 圈几乎不可辨（最外圈 0.10 alpha 只负责把中圈边界化开），
 * 但红线帧（50 块骨）的图元数是 150 → 100。
 *
 * `3` = 原来的三圈（0.10@1.30 + 0.16@1.02 + 骨白 0.14@0.78）
 * `2` = 默认。合并外两圈为 0.20@1.02 + 骨白 0.14@0.78
 * `1` = 只留骨白圈。**辉光会变硬**，只在帧率实在不够时用
 */
const BONE_GLOW = 2
/** 位图击杀特效同屏上限。一帧十几只同屏死是常事，超了就丢最早的。 */
const FXBIT_CAP = 28
/** 单帧最大步长（与模拟层的 MAX_DT 同源，防止后台切回来时世界瞬移） */
const MAX_DT = 0.05

/** 局部 clamp（此处只有相机用，且要传 lo>hi 也不会炸的语义，所以不引 shared 的 clamp） */
function clamp1(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v)
}

/**
 * 两个 `0xRRGGBB` 按 `t` 线性混合（V6.51 §9 第 9 步：`tint` 连续化要用）。
 * 逐通道插值 —— **不能在打包整数上插**（进位会串色，红通道会污染绿通道）。
 */
function mixCol(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
  return ((Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t))
}

/**
 * 带内过渡的**起点**（占比）。本带前 70% 保持本色、后 30% 才开始"变味"。
 * ⛔ 改成 0（全程线性）会让"刚进带就半只脚在下一带"，每带的辨识度全丢 ——
 *   那比"换带台阶"更糟。
 */
const BLEND_FROM = 0.70

/**
 * 机体（玩家潜航器）的船体基色 —— 中亮青蓝。
 *
 * 为什么不用 `UI.cyanDim`（0x1f6a7d）：那个色在深海暗底上太闷，球体只剩一个黑饼，
 * 而**玩家机体必须是画面里最亮的青系**（theme 的色相隔离规则：青蓝 = 我的东西）。
 * 取 0x2f8fa8 让"球面受光的最亮处"接近 `UI.cyan`，同时保留外圈霓虹描边的对比。
 */
const BODY_METAL = 0x2f8fa8

/**
 * 机体侧视**总高**（px）。V6.54 侧视改造新增。
 *
 * `SUB_D = 88` 的语义同时从「圆盘直径」改成「**艇身总长**」——
 * 88 × 56 ≈ 1.57:1，接近真实潜航器的侧视长高比。
 *
 * ⚠️ 56 不是随手取的 —— 它同时锁了两件事：
 *   ① **座圈投影比** `SEAT_RATIO`：±90° 两座要压在机体**高边缘**上（"镶嵌在艇缘"）
 *      ⇒ `SEAT_RING_R × K = 半高` ⇒ `48 × K = 28` ⇒ `K = 28/48`（见 shared/dive/tables.ts）。
 *   ② 舷窗带 / 指挥塔 / 尾鳍的纵向预算（半高 28px 内要塞下围壳 + 一条窗带）。
 * **改这个值必须同步改 `SEAT_RATIO`，否则炮会脱离艇缘。**
 *
 * ⚠️ 旧常量 `BODY_VIS`（0.90 = 机体视觉半径 ÷ 座圈半径）**已作废**：
 *   它的存在理由是"俯视球体半径要收到 43.2 才与旧贴图尺寸对齐"。
 *   侧视下机体尺寸由 `SUB_D`（长）与 `HULL_H`（高）直接定，不再有"半径"这个量。
 */
const HULL_H = 56

/**
 * 机体侧视**轮廓**（归一化：x ∈ [-1,1] 沿艇长，y ∈ [-1,1] 沿艇高，**艏在 +x**）。
 *
 * 14 点梭形：艏艉都是**圆钝端面**（竖边收口），背腹平直 —— 这是潜艇剖面，
 * 不是鱼（鱼是尖艏薄艉）。**这是整条侧视读法的载体**：换成正圆或对称椭圆
 * 立刻退回"橄榄球"，那是俯视残影。
 *
 * ⚠️ **这一组点与 `SEAT_RATIO` 是数值耦合的**，不是随手画的：
 *   y 用满 [-1,1] ⇒ 机体半高 = `HULL_H/2` = 28，于是
 *     · `x=0` 处轮廓 y = -0.993 ⇒ 世界 -27.8 px，**±90° 两座（y=±28）正好骑在边缘上**
 *     · `x=±0.945`（= 41.6 px，±30°/±150° 座位的横向位置）处轮廓 y = ∓0.47 / ∓0.38
 *       ⇒ 世界 ∓13.2 / ∓10.7，与座位 y = ∓14 **只差 0.8 / 3.3 px**（塔盘半宽 8.8）
 *   ⇒ 6 座炮全部**压在艇舷上**而不是飘在旁边。改动轮廓点或改 `SEAT_RATIO`
 *     都必须重算这三组数，否则炮会脱离艇体（**不会报错，只会看起来"炮浮着"**）。
 *
 * ⚠️ `tools/preview_hull_side.py` 复刻了这一组点，**改这里必须同步改那个脚本**，
 *    否则预览图会变成"骗人的图"（比没有预览更糟）。
 */
const HULL_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [1.00, -0.30], [0.86, -0.74], [0.46, -0.96], [-0.10, -1.00],
  [-0.60, -0.90], [-0.88, -0.62], [-1.00, -0.18], [-1.00, 0.18],
  [-0.88, 0.62], [-0.60, 0.90], [-0.10, 1.00], [0.46, 0.96],
  [0.86, 0.74], [1.00, 0.30],
]

/**
 * 明度缩放：把 `0xRRGGBB` 按系数 f 调亮/调暗（f>1 提亮，会夹到 255）。
 *
 * 为什么需要它：机体的球面是靠**同心圆逐层换色**堆出来的（Cocos Graphics 没有
 * 径向渐变、也没有 ADD 混合）。用「同一色 + 逐层降 alpha」叠 30 层会互相透出、
 * 糊成一团灰；必须**每层算出一个不透明实色**再画，才有干净的球面受光。
 * （与 `neon.ts` 的 `lerpColor` 互补：那个是两色插值，这个是单色调明度。）
 */
function shade(hex: number, f: number): number {
  const r = hex >> 16 & 0xff, g = hex >> 8 & 0xff, b = hex & 0xff
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return (c(r) << 16) | (c(g) << 8) | c(b)
}

@ccclass('DiveGame')
export class DiveGame extends Component {
  @property({ tooltip: '逻辑画布宽（sim 坐标）' }) designW = 1304
  @property({ tooltip: '逻辑画布高（sim 坐标）' }) designH = 749
  @property({ tooltip: '随机种子（同 seed ⇒ 同世界线）。第 n 局用 seed+n，所以世界线固定可复现' }) seed = 20261013
  @property({ tooltip: '没有存档时的默认潜航器：0 灯艇 / 1 刺鳐 / 2 深潜者' }) subIndex = 0

  // ---- 世界 ----
  private world!: DiveWorld
  private W = 1304
  private H = 749
  /** 是否已开局。false = 停在标题界面（世界不跑、HUD 不画） */
  private started = false
  /** 本局的 seed。每开一局 +1：世界线可复现，但不会每局都一模一样 */
  private runSeed = 20261013
  /**
   * 本局的开局武器（V6.41）。由「出击准备」面板选定。
   *
   * 为什么要存一份：暂停菜单 / 结算屏的「再来一次」走的是 `restartRun()` ——
   * 它没机会再问一次面板，只能沿用本局开局时选的那把。不存就会静默退回默认值。
   */
  private lastWeapon: WeaponId = DEFAULT_START_WEAPON

  // ---- 跨局档案（见 shared/dive/profile.ts）----
  private profile: Profile = defaultProfile()
  /** 本次结算是否刷新了纪录（结算屏用来画"新纪录"那一行） */
  private runRecord: string | null = null
  /** 本局沉淀进 bio 的数量（结算屏"沉淀 +N"那一行；0 = 不画） */
  private runBanked = 0
  /** 本局新解锁项的名称（结算屏"解锁：××"那一行；空 = 不画） */
  private runUnlocked: string[] = []
  /** 本局是否已经记过档（防"多记一局"，见 finishRun） */
  private runSaved = false

  // ---- 美术 ----
  private readonly art = new SpriteBank()
  private artLoaded = false
  private bgLayer = -1
  // ---- 下潜滚动 / 换带（V6.52 §3，V6.56 落）----
  /**
   * 当前滚动速度（px/s）。**纯表现层 —— 绝不回写 sim**（V6.52 §3.1 的铁律）。
   * 模拟层里没有任何东西读它，改它也不会动到弹道 / 碰撞 / 氧气。
   */
  private scrollV = SCROLL_BASE
  /** 换带爆冲速度（px/s），指数衰减回 0。见 `SCROLL_BURST` */
  private burstV = 0
  /** 温跃层扫带计时（0→`SCAN_DUR`）；`< 0` = 未激活。见 §3.3 ② */
  private scanT = -1
  /** 背景 crossfade 计时（0→`XFADE_DUR`）；`< 0` = 未激活。见 §3.3 ③ */
  private xfadeT = -1
  /** 水压环计时（0→`RING_DUR`）；`< 0` = 未激活。见 §3.4 */
  private ringT = -1
  /** 水压环强度倍率：换带 `1.0` / 换波 `WAVE_RING`。环共用一套代码，只差强度 */
  private ringStr = 1

  // ---- 节点 ----
  private worldRoot!: Node
  private bgNode!: Sprite
  /**
   * **换带时的旧背景**（V6.52 §3.3 ③）。压在 `bgNode` **之上**、以满不透明起步淡出。
   *
   * 为什么是"旧层在上淡出"而不是"两层各淡一半"：
   *   alpha 合成下 `旧×a + 新×(1-a)` **正好等于一次干净的 crossfade**；
   *   两层都半透会先暗一档再亮回来（双重曝光），看起来像"闪了一下"。
   */
  private bgNodeOld!: Sprite
  /** 不透明底色（最底层）。**不能并进 gBg** —— gBg 在背景图之上，会把它盖死 */
  private gBase!: Gfx
  private gBg!: Gfx
  private gVeil!: Gfx
  /** 光照与生态层（V6.53）。**必须夹在 gVeil 与 gBack 之间** —— 见 buildNodes 的注释 */
  private gAtmo!: Gfx
  private gBack!: Gfx
  private gEnt!: Gfx
  private gPlayer!: Gfx
  private gFront!: Gfx
  private fishLayer!: Node
  /** 位图击杀特效层。排在 `gFront` **之下**：矢量火花是"最上层的高光"，不该被碎片盖住。 */
  private fxBitLayer!: Node
  private subNode!: Sprite
  private hud!: Hud
  private title!: Title
  private codex!: Codex

  // ---- 敌人贴图池 ----
  private readonly fishPool: Fish[] = []

  // ---- 相机状态（每帧由 updateCamera 写入，drawVeil 要读）----
  private camX = 0
  private camY = 0
  private zoom = 1

  // ---- 震屏（接 sim 抛的 shake 事件，语义照抄 Phaser，见 shake()）----
  private shakeT = 0
  private shakeDur = 0
  private shakeIntensity = 0

  // ---- 表现池 ----
  private shocks: Shock[] = []
  private slashes: Slash[] = []
  private sparks: Spark[] = []
  private arcs: ArcFx[] = []
  private blasts: BlastFx[] = []
  private readonly fxBits: FxBit[] = []
  private readonly fxBitPool: Fish[] = []
  private floatSlots: Array<FloatFx | null> = new Array(FLOAT_CAP).fill(null)
  private motes: Mote[] = []
  /**
   * 颗粒当前的**物质带**（`-1` = 还没构建过）。
   * ⚠️ 与 `atmoLayer` **分开记**：`drawBg`（颗粒）与 `drawAtmo`（鱼群/光）是两次独立调用，
   *   共用一个字段会出现"先跑的那个把带号改掉，后跑的那个以为已经建过了"⇒ 一半新一半旧。
   *   两个字段各自管自己的整批重建，互不可见。
   */
  private moteLayer = -1
  /** 远景鱼群（V6.53）。换带时整批重建（靠 `atmoLayer` 变号触发） */
  private schools: SchoolFish[] = []
  /**
   * 光照层当前所在带（`-1` = 还没构建过）。**四个元素一起按它重建** ——
   * 它们的参数全都与带绑定（荧光只在 L3、烟柱只在 L4…），分开各记一个
   * "构建过哪一带"迟早会出现"鱼群换了、荧光没换"这种半新半旧的状态。
   */
  private atmoLayer = -1

  // ---- 光照层的四个元素（V6.59）----
  // 时间基准统一用 `w.t`（世界时间，秒）而不是另开一个本地累加器：
  //   `w.t` 在暂停时不推进 ⇒ 呼吸 / 摆动 / 摆尾**一起冻住**，与"暂停画面停住"的语义一致。
  //   自己再累一个计数器，只会做出"暂停时鱼尾不动、光却还在呼吸"的分裂状态。
  /** 生物荧光链（§4.3，仅 L3）*/
  private fluo: FluoChain[] = []
  /** 热泉烟柱（§4.4，仅 L4）*/
  private vents: Vent[] = []
  /** 深渊呼吸点阵（§4.5，仅 L5）*/
  private dots: AtmoDot[] = []
  /** 交互光反馈（§6）：开火 / 爆炸 / 拾取在水里留下的反光。**不随换带清空**（瞬时事件）*/
  private atmoFlashes: AtmoFlash[] = []
  /** 网张开的进行中的动画（V6.61）。**不随换带清空**，但 `clearFx` 要清 */
  private nets: NetOpen[] = []
  /** 表现层计时器（鱼雷气泡尾迹的正弦摆动等用；与 sim 的时间无关） */
  private fxT = 0
  /** 本帧的受击白闪（drawEnemies 登记 → drawFx 消费，见 FlashMark 的注释） */
  private flashMarks: FlashMark[] = []

  // ---- 机体侧视朝向（V6.54）----
  /**
   * 机体侧视**朝向镜像**：`+1` 朝右 / `-1` 朝左。
   *
   * 侧视下机体必须表达艏尾，而 `w.aim` 是连续角。
   * ⛔ **不能**直接用 `aim` 做旋转 —— 那是俯视写法：回转体转起来屏幕上毫无变化，
   *    只会让"炮沿着船壳滑动"（用户 2026-10-13 已明确否过一次）。
   * 侧视用**离散镜像**表达朝向（船不会翻身，只会掉头）。
   *
   * ⚠️ 死区 ±0.25 是必须的：`aim` 在玩家原地微调时会在 ±90° 附近抖，
   *    没有死区就会看到艇身来回抽（比"炮在滑"更难受）。
   *    死区之外的翻转是**立即**的 —— 掉头本来就该干脆。
   */
  private faceX = 1

  // ---- 输入 ----
  private keys: Record<string, boolean> = {}
  private burstEdge = false

  // ---- 暂停（2026-10-13）----
  /**
   * 战斗中暂停：`world` 完全不推进（敌人不动、氧气不掉、技能不走），
   * 画面保持静止，HUD 上盖一层暂停菜单。
   *
   * 为什么必须补它：此前战斗中按 ESC 走的是 `restartRun()` ——
   * 也就是说**局内根本没有"退出"这条路**，玩家想退出只能自杀，
   * 而按 ESC 反而会白打一局重开（`toTitle()` 只被结算屏调用）。
   */
  private paused = false
  /** 暂停菜单的二次确认态（点了「返回主界面」之后）—— 防误点丢一局 */
  private pauseConfirm = false

  // =========================================================================
  // 生命周期
  // =========================================================================
  onLoad(): void {
    this.W = this.designW
    this.H = this.designH
    this.runSeed = this.seed

    // 先读档再建节点：标题屏要立刻显示纪录、并默认选中上次用的那台潜航器。
    // 读档失败只会得到一份默认档案（save.ts 里不抛异常）。
    this.profile = loadProfile()
    this.subIndex = this.profile.runs > 0
      ? Math.max(0, SUBS.findIndex(s => s.id === this.profile.lastSub))
      : Math.max(0, Math.min(SUBS.length - 1, this.subIndex))

    this.buildNodes()

    // 占位世界：标题期间不 update，但字段要存在（避免每个绘制函数都判空）。
    // 真正开跑时 startRun() 会按选中的潜航器重建一份。
    this.world = this.mkWorld()
    this.world.drainEvents()      // 丢掉开局那批事件（没有表现需要补播）

    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this)
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this)

    // 美术异步加载：**不阻塞开局**。加载完成前先跑几何剪影，
    // 拿到图之后下一帧自动换成贴图（不需要重建世界）。
    void this.loadArt()

    // 初始就停在标题界面：世界那几层先藏好，把纪录与"上次用的艇"摆上
    this.hideWorld()
    this.title.setRecords(depthLabel(this.profile), this.profile.runs > 0)
    this.title.pick(this.subIndex)
  }

  /** 按当前 runSeed + 当前潜航器建一份新世界。开新局、以及"没有存档时"都走它。 */
  private mkWorld(weapon: WeaponId = DEFAULT_START_WEAPON): DiveWorld {
    return new DiveWorld({
      w: this.W,
      h: this.H,
      seed: this.runSeed,
      sub: SUBS[Math.max(0, Math.min(SUBS.length - 1, this.subIndex))],
      // 未解锁的武器/遗物**不进抽池**（解锁引擎唯一动局内的点，见 unlocks.ts filterPool）
      pool: filterPool(this.profile),
      // 永久强化：满级总增幅被红线锁在"两个遗物"量级（见 unlocks.ts PERKS）
      perk: perkBonus(this.profile),
      // 开局武器（V6.41）：面板选定；缺省 = 机关枪
      weapon,
    })
  }

  /**
   * 开一局新的。
   *
   * 为什么是**重建世界**而不是 `world.restart()`：潜航器与开局武器都是在构造时
   * 注入的（`opts.sub` / `opts.weapon`），换艇换枪只能重建 —— 而"标题界面能选
   * 艇和枪"正是这轮加的东西。
   * seed 每局 +1：世界线仍然完全可复现（`seed`、`seed+1`、`seed+2`…），
   * 但不会每局都是同一张图；出问题时按 `数字 = seed + 局数` 就能复现那一局。
   *
   * `weapon` 缺省 = `DEFAULT_START_WEAPON`（机关枪），供 `restartRun()` 之外的
   * 无参调用（如构造期的占位世界）使用。
   */
  private startRun(sub: SubId, weapon: WeaponId = DEFAULT_START_WEAPON): void {
    const idx = SUBS.findIndex(s => s.id === sub)
    this.subIndex = idx >= 0 ? idx : 0
    this.lastWeapon = weapon
    this.runSeed = this.seed + this.profile.runs

    this.world = this.mkWorld(weapon)
    this.world.drainEvents()

    this.started = true
    this.paused = false
    this.pauseConfirm = false
    this.runRecord = null
    this.runBanked = 0
    this.runUnlocked = []
    this.runSaved = false
    this.clearFx()
    this.bgLayer = -1              // 强制重设背景（换层/重开都可能换了图）
    // 别把上一局的余速带进新局：爆冲 / 扫带 / crossfade 三个计时器一律归零
    this.burstV = 0
    this.scrollV = SCROLL_BASE
    this.scanT = -1
    this.xfadeT = -1
    this.ringT = -1
    this.shakeT = 0                // 别把上一局的余震带进新局
    this.title.setVisible(false)
    this.hideWorld()

    // 选中即记住：不用等一局结束，下次打开工程就默认是它
    this.profile = { ...this.profile, lastSub: SUBS[this.subIndex].id }
    saveProfile(this.profile)
  }

  /** 回标题界面（结算屏的「返回主界面」、暂停菜单的「返回主界面」，以及开局前的初始状态） */
  private toTitle(): void {
    this.started = false
    this.paused = false
    this.pauseConfirm = false
    this.clearFx()
    this.hideWorld()
    this.title.setRecords(depthLabel(this.profile), this.profile.runs > 0)
    this.title.refreshWallet()
    this.title.pick(this.subIndex)
    this.title.setVisible(true)
  }

  /**
   * 开一局新的（同一个潜航器）。暂停菜单与结算屏的「再来一次」都走它。
   *
   * 开局武器沿用 `lastWeapon` —— 这条路径不会再弹一次「出击准备」，
   * 所以"再来一次"必须保持上一局的枪，否则玩家会莫名其妙被换武器。
   */
  private restartRun(): void {
    this.paused = false
    this.pauseConfirm = false
    this.keys = {}
    this.burstEdge = false
    this.startRun(getSub(this.world.sub.id).id, this.lastWeapon)
  }

  // -------------------------------------------------------------------------
  // 暂停（2026-10-13 新增）
  // -------------------------------------------------------------------------
  /**
   * 开关暂停。**必须同时清空按键状态** —— 否则暂停期间按住的
   * W/A/S/D 会留在 `keys` 里，恢复后机体自己一直往那个方向漂。
   * （同一个坑在标题界面的注释里记过：ESC 曾被记成移动键。）
   */
  private togglePause(v: boolean = !this.paused): void {
    this.paused = v
    this.pauseConfirm = false
    if (v) {
      for (const k of ['left', 'right', 'up', 'down', 'burst']) this.keys[k] = false
      this.burstEdge = false
    }
  }

  /** 暂停菜单里的 ESC：确认态 → 退回菜单；菜单态 → 继续游戏 */
  private pauseBack(): void {
    if (this.pauseConfirm) this.pauseConfirm = false
    else this.togglePause(false)
  }

  /**
   * 把世界那几层藏起来。
   *
   * 必须逐个关节点，不能只靠"这一帧不画"：Graphics 每帧 clear 所以不画就没了，
   * 但 **Sprite（背景图、机体贴图）是持久节点** —— 不显式关掉的话，
   * 回标题时上一局的背景图和潜航器会一直挂在那儿。
   */
  private hideWorld(): void {
    this.hideFish()
    this.subNode.node.active = false
    this.bgNode.node.active = false
    // bgOld 是 Sprite（持久节点），同样必须显式关 —— 否则一次换带正是
    // 跑到一半时退回标题屏，那张旧背景会**一直挂在标题界面上**。
    this.bgNodeOld.node.active = false
    // 位图特效是常驻节点（池化），必须一起关 —— 否则退回标题屏时
    // 上一波击杀的碎片会**留在屏幕上**（Graphics 那几层都被 clear 了，只有它不会自动清）。
    for (const f of this.fxBitPool) f.sp.node.active = false
    this.fxBits.length = 0
  }

  onDestroy(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this)
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this)
  }

  private async loadArt(): Promise<void> {
    const n = await this.art.loadAll()
    this.artLoaded = n > 0
    this.bgLayer = -1              // 强制下一帧重设背景
    if (!this.art.has('f_swarm')) {
      // 一张都没加载到属于"正常但值得知道"的情况：游戏照跑，只是全矢量。
      console.log('[DiveGame] 未加载到美术资源，使用几何剪影（跑 python tools/sync_art.py 同步）')
    }
  }

  /**
   * 建节点树。
   * ⚠️ 运行时 `new Node()` 的 layer 默认是 DEFAULT，而 Canvas 的 UI 相机只渲染
   *    UI_2D —— 所以**必须显式继承父节点 layer**，否则画面上什么都没有。
   */
  private mkNode(name: string, parent: Node): Node {
    const n = new Node(name)
    n.layer = parent.layer
    n.parent = parent
    return n
  }

  private mkWrapped(name: string, parent: Node): Gfx {
    return new Gfx(this.mkNode(name, parent).addComponent(Graphics), this.H)
  }

  private buildNodes(): void {
    const host = this.uiHost()

    this.worldRoot = this.mkNode('WorldRoot', host)
    const utr = this.worldRoot.addComponent(UITransform)
    utr.setAnchorPoint(0, 0)
    utr.setContentSize(this.W, this.H)
    this.worldRoot.setPosition(-this.W / 2, -this.H / 2)

    // 顺序即绘制顺序（见文件头节点树）
    // ⚠️ gBase（不透明底色）**必须排在 bg 之前**。它等价于 web 的 `main.ts`
    //    里 `backgroundColor:'#04070d'`（画布清屏色）—— 在所有东西之下。
    //    曾经把"铺满全屏的 UI.abyss 纯色"并进 gBg 画：而 gBg 排在背景图**之后**，
    //    于是那层不透明色正好把 env 背景图整个盖死，屏幕上只剩纯深蓝 + 星星。
    this.gBase = this.mkWrapped('gBase', this.worldRoot)

    this.bgNode = this.mkNode('bg', this.worldRoot).addComponent(Sprite)
    this.bgNode.trim = false                         // 保留透明边，cover 计算才准
    this.bgNode.sizeMode = Sprite.SizeMode.CUSTOM    // 尺寸由 cover 计算显式给
    this.bgNode.node.active = false                  // 没图就不参与渲染

    // bgOld（V6.52 §3.3 ③）：**换带 crossfade 的旧图**，压在 `bgNode` 之上淡出。
    //   顺序就是设计：旧的在上、新的在下且恒满不透明 ⇒ 合成结果 = 干净的一次交叉淡入。
    this.bgNodeOld = this.mkNode('bgOld', this.worldRoot).addComponent(Sprite)
    this.bgNodeOld.trim = false
    this.bgNodeOld.sizeMode = Sprite.SizeMode.CUSTOM
    this.bgNodeOld.node.active = false

    // gBg：海雪。**在背景图之上**才是对的（雪是"我在水里"的近景证据，
    // 压在背景图下面等于看不见），但绝不能在这里画不透明底色。
    this.gBg = this.mkWrapped('gBg', this.worldRoot)
    this.gVeil = this.mkWrapped('gVeil', this.worldRoot)
    // gAtmo（V6.53）：**光照与生态层** —— 远景鱼群 / 能见度雾 / 荧光群 / 热泉烟柱 / 呼吸点阵。
    //   ⚠️ 必须夹在 gVeil 与 gBack **之间**：
    //     · 插在 gVeil **之下** ⇒ 光被自己的压暗层吃掉（等于没画，白工）；
    //     · 插在 gBack **之上** ⇒ 盖住敌人（战斗可读性崩）。
    //   这是全项目最容易放错的一层。
    this.gAtmo = this.mkWrapped('gAtmo', this.worldRoot)
    // web 的原话："声呐波前画在敌人之下，避免一圈圈环把鱼群剪影盖住"。
    this.gBack = this.mkWrapped('gBack', this.worldRoot)

    this.fishLayer = this.mkNode('fishLayer', this.worldRoot)

    // ⚠️ gEnt 必须排在 fishLayer **之后**。
    //    它装的是敌人矢量剪影、子弹，以及每条约鱼那枚 2px 发光核心 ——
    //    核心是"每条鱼都能被定位"的铁律（远距离只剩一个点时全靠它），**必须压在贴图之上**；
    //    子弹同理（web 的规矩："玩家的攻击必须看得见"）。
    //    放在 fishLayer 之前不会报任何错，只会让每条大鱼的贴图精准地盖住自己的定位核心 ——
    //    在 L3-L5 那种深色层里最要命（鱼和背景本来就糊成一片）。
    this.gEnt = this.mkWrapped('gEnt', this.worldRoot)

    this.subNode = this.mkNode('sub', this.worldRoot).addComponent(Sprite)
    this.subNode.trim = false
    this.subNode.sizeMode = Sprite.SizeMode.CUSTOM
    this.subNode.node.active = false

    // 位图击杀特效层：排在 `gEnt` 之后、`gPlayer`/`gFront` 之前。
    // 为什么在 `gFront` 之下：`gFront` 装的是冲击波 / 火花 / 飘字 —— 那是"最后的高光"，
    // 碎片压在上面会让命中瞬间变浑浊。
    this.fxBitLayer = this.mkNode('fxBits', this.worldRoot)

    this.gPlayer = this.mkWrapped('gPlayer', this.worldRoot)
    this.gFront = this.mkWrapped('gFront', this.worldRoot)

    this.hud = new Hud(host, this.W, this.H, this.art)
    // Title 建在 Hud 之后 = 在它之上。两者不会同时有内容：
    // 标题期间 HUD 每个 label/button 都被 begin() 关掉，战斗期间 Title 整根隐藏。
    this.title = new Title(host, this.W, this.H, this.art, {
      onStart: (sub, weapon) => this.startRun(sub, weapon),
      getMeta: () => this.profile,
      onBuyPerk: (id) => this.buyPerk(id),
      onOpenCodex: () => this.codex.show(),
    })
    // 图鉴建在 Title 之后 = 在它之上（这样它的 scrim 能挡住标题屏的按钮）
    this.codex = new Codex(host, this.W, this.H, this.art, () => this.profile)
  }

  /**
   * 花沉淀生物质买一项永久强化。
   *
   * ⚠️ 返回**布尔**而不是 void：Title 靠它决定"要不要重画装置坞"（买失败不重画）。
   * 买成之后主动 `refreshWallet()`，否则顶部的钱包要点开装置坞才更新。
   */
  private buyPerk(id: PerkId): boolean {
    if (!canBuyPerk(this.profile, id)) return false
    this.profile = buyPerkPure(this.profile, id)
    saveProfile(this.profile)
    this.title.refreshWallet()
    return true
  }

  // =========================================================================
  // 输入
  // =========================================================================
  private onKeyDown(e: EventKeyboard): void {
    const k = e.keyCode

    // ---- 标题界面：数字直选 / 左右循环 / Enter 开局 ----
    // 这里必须**整体接管并 return**：否则 ←→ 会被记成移动键（下一局开局时
    // 玩家会"莫名其妙一直在往左漂"），ESC 会直接开局。
    if (!this.started) {
      // 图鉴开着时整体接管：ESC 关闭，其余键不透传（否则 ←→ 会在背后换潜航器）
      if (this.codex.open) {
        if (k === KeyCode.ESCAPE) this.codex.hide()
        return
      }
      // 「出击准备」面板开着时整体接管（V6.41）。**必须 return** ——
      // 否则面板里的 ↑↓ 会漏到下面被记成移动键，下一局开局时角色自己漂。
      //   Esc 关面板（不是退出游戏）/ ↑↓ 换行 / ←→ 行内循环 / Enter 确认出击
      if (this.title.loadoutOpen) {
        if (k === KeyCode.ESCAPE) this.title.back()
        else if (k === KeyCode.ARROW_UP) this.title.focusRow(-1)
        else if (k === KeyCode.ARROW_DOWN) this.title.focusRow(1)
        else if (k >= KeyCode.DIGIT_1 && k <= KeyCode.DIGIT_3) this.title.pick(k - KeyCode.DIGIT_1)
        else if (k >= KeyCode.NUM_1 && k <= KeyCode.NUM_3) this.title.pick(k - KeyCode.NUM_1)
        else if (k === KeyCode.ARROW_LEFT) this.title.move(-1)
        else if (k === KeyCode.ARROW_RIGHT) this.title.move(1)
        else if (k === KeyCode.ENTER || k === KeyCode.SPACE) this.title.confirm()
        return
      }
      if (k >= KeyCode.DIGIT_1 && k <= KeyCode.DIGIT_3) this.title.pick(k - KeyCode.DIGIT_1)
      else if (k >= KeyCode.NUM_1 && k <= KeyCode.NUM_3) this.title.pick(k - KeyCode.NUM_1)
      else if (k === KeyCode.ARROW_LEFT) this.title.move(-1)
      else if (k === KeyCode.ARROW_RIGHT) this.title.move(1)
      else if (k === KeyCode.ENTER || k === KeyCode.SPACE) this.title.confirm()
      return
    }

    // ---- 暂停中：整体接管，只认 ESC ----
    // 和标题界面同一个理由：不透传就不会把按键记进 `keys`。
    // 漏了这层的话，暂停时按住的 ←→ 会在恢复后继续生效（角色自己漂）。
    if (this.paused) {
      if (k === KeyCode.ESCAPE) this.pauseBack()
      return
    }

    // ---- 战斗中 ESC = 暂停（2026-10-13 改）----
    // 原先是 `restartRun()` —— 那是把"退出"写成了"重开"，
    // 局内没有任何路径能回到主界面，玩家只能自杀。现在 ESC 开暂停菜单，
    // "重新开始"收进菜单里当第二个选项（多一次确认，也少一次误触丢局）。
    if (k === KeyCode.ESCAPE) {
      // 结算屏已经结束，没有"暂停"可言；战斗 / 商店 / 补给站都能叫出菜单
      if (this.world.phase !== 'result') this.togglePause(true)
      return
    }

    if (this.isBurstKey(k) && !this.keys['burst']) this.burstEdge = true
    this.keys[this.keyName(k)] = true

    // ---- 商店：数字直购 ----
    // 2026-10-13 补：DIGIT_1..3 此前**只在标题界面**有分支，商店阶段的副标题却写着
    // 「点卡片或按 1 / 2 / 3 购买」—— 那句话是完整的两张空头支票。这里兑现键盘那一半。
    // `buyCard()` 自带 phase / 越界 / sold / 买不起 四重守卫，所以无脑转发即可。
    if (this.world.phase === 'shop') {
      if (k >= KeyCode.DIGIT_1 && k <= KeyCode.DIGIT_3) this.world.buyCard(k - KeyCode.DIGIT_1)
      else if (k >= KeyCode.NUM_1 && k <= KeyCode.NUM_3) this.world.buyCard(k - KeyCode.NUM_1)
    }
  }

  private onKeyUp(e: EventKeyboard): void {
    this.keys[this.keyName(e.keyCode)] = false
  }

  private isBurstKey(k: KeyCode): boolean {
    return k === KeyCode.SPACE || k === KeyCode.SHIFT_LEFT || k === KeyCode.SHIFT_RIGHT
  }

  private keyName(k: KeyCode): string {
    if (k === KeyCode.KEY_A || k === KeyCode.ARROW_LEFT) return 'left'
    if (k === KeyCode.KEY_D || k === KeyCode.ARROW_RIGHT) return 'right'
    if (k === KeyCode.KEY_W || k === KeyCode.ARROW_UP) return 'up'
    if (k === KeyCode.KEY_S || k === KeyCode.ARROW_DOWN) return 'down'
    if (this.isBurstKey(k)) return 'burst'
    return 'other'
  }

  private sampleInput(): InputState {
    let dx = 0, dy = 0
    if (this.keys['left']) dx -= 1
    if (this.keys['right']) dx += 1
    if (this.keys['up']) dy -= 1
    if (this.keys['down']) dy += 1
    const burst = this.burstEdge
    this.burstEdge = false      // 边沿：只有"这一帧刚按下"才为 true
    return { dx, dy, burst }
  }

  // =========================================================================
  // 每帧
  // =========================================================================
  update(dtSec: number): void {
    const dt = Math.min(dtSec, MAX_DT)
    this.codex?.update()

    // ---- 标题界面：世界不跑、HUD 不画，只更新主界面自己 ----
    // 注意**照样要清 Graphics**：不清的话上一局最后一帧的图形会原地留在屏幕上
    // （Graphics 是累积顶点，不 clear 就一直画）。
    if (!this.started) {
      this.title.update(dt)
      this.gBase.clear(); this.gBg.clear(); this.gVeil.clear(); this.gAtmo.clear(); this.gBack.clear()
      this.gEnt.clear(); this.gPlayer.clear(); this.gFront.clear()
      this.hud.begin()
      return
    }

    const w = this.world
    const combat = w.phase === 'wave' || w.phase === 'descending'

    // ---- 暂停：只跳过"推进"，不跳过绘制 ----
    // 跳过推进 ⇒ 敌人不动、氧气不掉、技能冷却不走、特效不衰减；
    // 保留绘制 ⇒ 画面停在上一帧的样子，而不是被清成黑屏。
    // （标题界面那段注释解释过为什么"不推进也必须清 Graphics"：
    //   Graphics 是累积顶点，不 clear 就会一直留在屏幕上。）
    if (!this.paused) {
      w.update(dt, combat ? this.sampleInput() : { dx: 0, dy: 0, burst: false })
      for (const ev of w.drainEvents()) this.handleEvent(ev)
      this.stepFx(dt)
      this.stepFxBits(dt)
      this.updateCamera(dt)
    }
    this.syncBg(w)               // 换层换背景（只在 layerIdx 变化时真正干活）
    this.stepWater(dt)           // 下潜滚动 + 换带过渡（爆冲衰减 / 扫带 / crossfade）

    // ⚠️ **每一层都要在这里 clear** —— Graphics 是累积顶点，漏一个 = 那一层每帧叠加
    //    成一团拖影。2026-10-14 踩过：`gAtmo`（V6.53 新增）漏在这一行之外，
    //    46 条远景鱼在几秒内叠成铺满全屏的白色云带，看起来像"背景画错了"，
    //    实际是漏了一个 clear。**新增任何 Graphics 层，第一件事是加进这张名单。**
    this.gBase.clear(); this.gBg.clear(); this.gVeil.clear(); this.gAtmo.clear(); this.gBack.clear()
    this.gEnt.clear(); this.gPlayer.clear(); this.gFront.clear()

    this.drawBg(w, dt)
    if (combat) {
      this.syncSub(w)
      this.drawWorld(w)
    } else {
      this.hideWorld()
    }
    this.drawVeil(w)
    this.drawAtmo(w, dt)
    this.drawFx(dtSec)
    this.drawFxBits()

    this.hud.begin()
    if (combat) {
      this.hud.drawCombat(w, { onPause: () => this.togglePause(true) })
    } else if (w.phase === 'shop') {
      this.hud.drawShop(w, {
        onBuy: i => w.buyCard(i),
        onReroll: () => w.reroll(),
        onLock: i => w.toggleLock(i),
        onLeave: () => w.leaveShop(),
      })
    } else if (w.phase === 'decide') {
      this.hud.drawDecide(w, { onDive: () => w.diveDeeper(), onSurface: () => w.surface() })
    } else if (w.phase === 'result') {
      this.hud.drawResult(w, { onRestart: () => this.restartRun(), onTitle: () => this.toTitle() }, {
        record: this.runRecord,
        banked: this.runBanked,
        bio: this.profile.bio,
        unlocked: this.runUnlocked,
      })
    }

    // 暂停菜单**最后画**，盖在任何阶段之上（战斗中 / 商店 / 补给站都叫得出来）。
    // 写在分支外面而不是塞进某个分支：四个绘制分支一行不用动，暂停只是"多盖一层"。
    if (this.paused) {
      this.hud.drawPause(w, {
        onResume: () => this.togglePause(false),
        onRestart: () => this.restartRun(),
        onAskTitle: () => { this.pauseConfirm = true },
        onConfirmTitle: () => this.toTitle(),
        onCancelConfirm: () => { this.pauseConfirm = false },
      }, { confirm: this.pauseConfirm })
    }
  }

  /**
   * 真正承载 UI 的节点 —— 带 UITransform 的那一层（通常就是 Canvas）。
   *
   * 组件挂在 Canvas 上、或挂在 Canvas 的**子节点**上都能用：这里自动往上找一层。
   * 找到之后 WorldRoot 与 HUD 都挂在**它**下面，于是画面的世界坐标只由 WorldRoot
   * 自己的位置决定 —— 组件所在节点被拖到哪都不会影响画面（少一类"莫名其妙偏移"）。
   */
  private uiHost(): Node {
    if (this.node.getComponent(UITransform)) return this.node
    const p = this.node.parent
    if (p && p.getComponent(UITransform)) return p
    return this.node
  }

  /** UI 宿主的 UITransform，它的尺寸就是实际设计分辨率（见 viewWorld）。 */
  private canvasUT(): UITransform | null {
    return this.uiHost().getComponent(UITransform)
  }

  /** zoom=1 时可视区覆盖的世界尺寸。取不到就退回组件上的 designW/designH。 */
  private viewWorld(): { w: number; h: number } {
    const ut = this.canvasUT()
    if (ut) {
      const w = ut.contentSize.width
      const h = ut.contentSize.height
      // 首帧 Canvas 可能还没被 Widget 撑开，此时 contentSize 是 0 —— 必须挡掉，
      // 否则钳位区间会翻转成 [hw, W-hw] 里 lo>hi，相机瞬移到世界外。
      if (w > 0 && h > 0) return { w, h }
    }
    return { w: this.W, h: this.H }
  }

  /**
   * 镜头跟随。
   *
   * ⚠️ **不用相机缩放**。Cocos 3.8 的 `Camera` 根本没有 `zoom` 属性（只有
   * `orthoHeight`），而 `orthoHeight` 是 `Canvas` 组件自己托管的 —— 去改它等于
   * 跟引擎抢同一份状态，什么时候被覆盖回去取决于 Canvas 的实现时机，而这条
   * 在沙箱里验证不了。这里改成**缩放 WorldRoot 节点**：视觉完全等价、不碰
   * 引擎托管状态，而且 HUD 是 Canvas 下的另一支、天然不跟着缩 —— 正好是我们要的。
   *
   * （这个错是"换成真 cc.d.ts 做类型检查"当天抓出来的；之前手写的声明桩里
   *   我自己写了 `Camera.zoom`，于是检查通过的是我的假设，不是引擎。）
   *
   * 推导：WorldRoot 锚点 (0,0)，子节点局部坐标 = (x, H − y)。要让
   * sim(camX, camY) 落在屏幕中心（Canvas 原点），需
   *     P + zoom × (camX, H − camY) = 0
   * 即 P = (−zoom·camX, zoom·(camY − H))。zoom = 1 时退化为原来的 (−camX, camY − H)。
   */
  private updateCamera(dt: number): void {
    const view = this.viewWorld()
    const w = this.world
    const popup = w.phase === 'shop' || w.phase === 'decide' || w.phase === 'result'

    if (popup) {
      this.zoom = 1
      this.camX = this.W / 2
      this.camY = this.H / 2
    } else {
      const Z = CAM_ZOOM
      const hw = view.w / (2 * Z)
      const hh = view.h / (2 * Z)
      // 可视区比世界还大（宽高比差异大）时直接居中：此时 W - hw < hw，
      // 下界会大于上界，普通 clamp 的结果是错的。
      this.zoom = Z
      this.camX = this.W <= hw * 2 ? this.W / 2 : clamp1(w.px, hw, this.W - hw)
      this.camY = this.H <= hh * 2 ? this.H / 2 : clamp1(w.py, hh, this.H - hh)
    }

    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt)

    this.worldRoot.setScale(this.zoom, this.zoom, 1)
    // 震屏偏移加在**屏幕空间**：WorldRoot 的父节点是 Canvas，所以 setPosition
    // 直接就是画布像素。世界所有层（背景/敌人/玩家/特效）一起抖，
    // 而 HUD 是 Canvas 下的另一支、天然不跟着抖 —— 正好是我们要的。
    // （web 的 Phaser 震屏会把 scrollFactor=0 的 HUD 一起晃，GameScene 里有专门
    //   注释吐槽过这件事；这里是 Cocos 版顺手修掉的一个体验问题。）
    const jitter = (px: number) => {
      if (this.shakeT <= 0) return 0
      return this.shakeIntensity * px * (Math.random() * 2 - 1)
    }
    this.worldRoot.setPosition(
      -this.zoom * this.camX + jitter(view.w),
      this.zoom * (this.camY - this.H) + jitter(view.h),
    )
  }

  /**
   * 震屏。语义**照抄 Phaser**（实现见
   * `web/node_modules/phaser/src/cameras/2d/effects/Shake.js`）：
   *
   *   · 幅度 = `intensity × 视口宽/高`，**整段时长内不衰减**，到点直接归零。
   *     它不是"逐渐平息"，就是一段定幅随机抖动然后戛然而止 —— 看着很"脆"，
   *     但那是原版手感，改凉了会跟 web 对不上，所以照搬。
   *   · 已经在震的时候**忽略**新来的（Phaser 的 `force=false` 语义）。
   *     这条是刻意设计的："每秒几十次"的暴击震屏不会叠成持续抖动 ——
   *     别改成取最大值或累加，那会把"只给暴击"的取舍（见 world.ts 的命中医治）
   *     直接废掉。
   *
   * 一处已知的近似：Phaser 还会再乘一次 `camera.zoom`（而世界相机 zoom=1.25），
   * 即它实际位移比 `intensity × 宽` 更大一点。这里按**屏幕像素**直接给
   * `intensity × 宽`（1304 宽时 0.008 ≈ ±10px）。若目视觉得比 web 震得轻，
   * 就在这里补一个 `× CAM_ZOOM` —— 那是唯一需要动的地方。
   */
  private shake(ms: number, intensity: number): void {
    if (this.shakeT > 0) return
    this.shakeDur = Math.max(1, ms) / 1000
    this.shakeT = this.shakeDur
    this.shakeIntensity = intensity
  }

  /** 当前可视区在 **sim 坐标**下的矩形（已含 zoom） */
  private viewRect(): { x: number; y: number; w: number; h: number } {
    const view = this.viewWorld()
    const z = this.zoom > 0 ? this.zoom : 1
    const w = view.w / z
    const h = view.h / z
    return { x: this.camX - w / 2, y: this.camY - h / 2, w, h }
  }

  // =========================================================================
  // 美术接入
  // =========================================================================
  /**
   * 背景：按层换图。cover 铺满世界（等比放大到盖住，多出来的居中裁掉）。
   *
   * ⚠️ **激活与否不能只在"换层"时决定**：弹窗相位（商店/决策/结算）会走
   * `hideWorld()` 把 `bgNode` 关掉，而同层内 `layerIdx` 不变 —— 如果这里
   * 只在层变化时才 `active = true`，那么**第一次进商店之后，同层内背景图就再也不会
   * 出现**（只剩 `gBase` 的近黑底色，看起来就是"画面又黑了"）。
   * 所以贴图只在换层时换，`active` 每帧按"当前该不该显示"设置。
   */
  private syncBg(w: DiveWorld): void {
    if (!this.artLoaded) return
    if (this.bgLayer !== w.layerIdx) {
      const sf = this.art.get('env' + w.layerIdx)
      if (!sf) return
      this.bgLayer = w.layerIdx
      this.bgNode.spriteFrame = sf
      const iw = sf.rect.width
      const ih = sf.rect.height
      const s = Math.max(this.W / iw, this.H / ih)
      const ut = this.bgNode.node.getComponent(UITransform)!
      ut.setContentSize(iw * s, ih * s)
      this.bgNode.node.setPosition(this.W / 2, this.H / 2)
    }
    this.bgNode.node.active = true
  }

  /**
   * 潜航器机体**贴图**节点 —— 2026-10-13 起机体改由 `drawBody()` **矢量实时绘制**，
   * 这张正俯视贴图不再参与战斗渲染，所以这里把它**恒定关闭**（`hideWorld` 里也关一次）。
   *
   * 为什么保留节点而不删：`subNode` 是 `Dive.scene` 里已序列化的结构，
   * 删节点要同步改场景文件 + uuid 引用（收益低、风险高）；留着还保有一个口子 ——
   * 以后若要给机体叠一层贴图（涂装 / 贴花 / 受伤纹理）可以直接复用这个 Sprite。
   * 三台潜航器的**立绘**仍用同一批贴图 —— 那是选艇界面（`Title.ts`）在用，与本函数无关。
   */
  private syncSub(_w: DiveWorld): void {
    this.subNode.node.active = false
  }

  /**
   * 取一条敌人贴图（池化）。返回 null 表示"这条该走矢量路径"。
   *
   * 三个退回矢量的条件，全部照抄 web（每一条都是踩出来的）：
   *   ① 同屏太多：贴图是逐条一个 draw call，量大了不划算；
   *   ② 体型太小（显示尺寸 < 26px）：**水母贴图 60% 面积是细触须**，
   *      缩到 14px 后触须和伞盖糊成一团白，屏幕上就是"一颗白色小飞虫" ——
   *      贴图的优势是细节，细节在小尺寸上反而变成噪声；
   *   ③ 命中闪白：贴图是乘色混合，白不了 —— web 用 `setTintFill` 把贴图整个烧成纯白剪影，
   *      Cocos 的 Sprite 没有等价的 tintFill。**但补救办法不是把贴图换成矢量三角**
   *      （那会得到一颗白色实心三角，见 drawEnemies 里的注释），
   *      而是照 web 矢量路径的做法：贴图留着，另外叠一层白色椭圆闪光（见 flashMarks）。
   */
  private fishSprite(e: Enemy): Sprite | null {
    if (!this.artLoaded) return null
    if (this.world.enemies.length > 120) return null
    if (e.r * 2.4 < 26 && e.kind !== 'boss') return null
    const sf = this.art.get(e.tex)
    if (!sf) return null
    const sp = this.acquireFish(e.tex, sf)
    if (!sp) return null

    // 显示尺寸：长边 = r × 3.1，短边按**素材真实宽高比**算 ——
    // 绝不能拉成正方形（web 侧的教训：2:1 的长鱼被压成方块，看起来就是个黑块）。
    // 碰撞半径 r 不变，所以这里只改视觉、不动平衡。
    const ar = frameAspect(sf)
    const L = e.r * 3.1
    sp.node.getComponent(UITransform)!.setContentSize(
      ar >= 1 ? L : L * ar,
      ar >= 1 ? L / ar : L,
    )
    return sp
  }

  private acquireFish(key: string, sf: SpriteFrame): Sprite | null {
    for (const f of this.fishPool) {
      if (f.key === key && !f.sp.node.active) {
        f.sp.node.active = true
        return f.sp
      }
    }
    if (this.fishPool.length >= FISH_CAP) return null
    const n = this.mkNode('fish', this.fishLayer)
    const sp = n.addComponent(Sprite)
    sp.trim = false
    sp.sizeMode = Sprite.SizeMode.CUSTOM
    sp.spriteFrame = sf
    this.fishPool.push({ sp, key })
    return sp
  }

  private hideFish(): void {
    for (const f of this.fishPool) f.sp.node.active = false
  }

  // =========================================================================
  // 事件 → 表现（V6.46：打击 / 击杀 / 施法按**来源**分化）
  // =========================================================================
  /**
   * 打击特效。
   *
   * **为什么必须分化**：V6.45 之前 11 把武器共用同一套
   * `冲击环 + 斩击痕 + 4 颗火花`，只有暴击换色 —— 于是"被枪打中"和"被声呐扫到"
   * 在屏幕上一模一样。打击感是这类游戏的主要爽点来源，一套反馈摊平用在所有武器上，
   * 等于把"这把武器手感如何"这条信息整个删掉。
   *
   * ⚠️ 分化的是**形状语汇**，不是**图元数量**：每条分支都与原来**持平或更省**。
   *    靠加粒子做区分会在满屏时糊成一团 —— 那正是"特效不够"的另一种表现。
   * ⚠️ **暴击是覆盖式的**：不管什么来源，暴击一律换成紫罗兰 + 加大。
   *    "这刀更重"这个信号优先于"这是什么武器打的"，两者冲突时前者赢。
   */
  private hitFx(ev: Extract<SimEvent, { t: 'hit' }>): void {
    const ang = Math.atan2(-ev.ny, -ev.nx)
    if (ev.crit) {
      this.pushShock(ev.x, ev.y, ev.r * 1.5, 0.19, UI.violet, 2.8, ev.r, 1)
      this.pushSlash(ev.x, ev.y, ang, 1.5, UI.violet)
      this.pushSparks(ev.x, ev.y, ang, UI.violet, 7)
      return
    }
    switch (ev.cause ?? 'bullet') {
      case 'blast':
        // 爆炸：**不画斩击痕** —— 爆炸没有来向，画了会读作"被刀砍了"。
        // 换成双层同心环 + 无方向迸溅（那才是"被炸了"的形状语汇）。
        this.pushShock(ev.x, ev.y, ev.r * 1.9, 0.22, ev.color, 2.4, ev.r * 0.85, 2)
        this.pushRadialSparks(ev.x, ev.y, 5, 90, 120, 1.4, ev.color)
        return
      case 'pulse':
        // 声呐：纯同心环。波前是从中心扫过来的，永远不可能有"来向"
        this.pushShock(ev.x, ev.y, ev.r * 1.32, 0.2, 0x4fe8ff, 1.8, ev.r * 0.58, 1)
        return
      case 'arc':
        // 电弧：沿来向拉一道**折线**残影 —— 链击的辨识度全在"电是折的"这件事上
        this.arcs.push({
          pts: [
            { x: ev.x - Math.cos(ang) * ev.r * 2.4, y: ev.y - Math.sin(ang) * ev.r * 2.4 },
            { x: ev.x - Math.cos(ang) * ev.r * 1.1 + ev.r * 0.35, y: ev.y - Math.sin(ang) * ev.r * 1.1 },
            { x: ev.x, y: ev.y },
          ], life: 0.14, maxLife: 0.18,
        })
        this.pushShock(ev.x, ev.y, ev.r * 1.1, 0.14, UI.violet, 1.6, ev.r * 0.5, 1)
        return
      case 'burn':
        // 灼烧：只冒余烬，**环和斩都不画** —— DoT 每 0.35s 结算一次，
        // 每次都画环会在敌人身上叠出一圈不散的亮圈，看着像"中了状态"而不是"在烧"
        for (let i = 0; i < 2; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
          this.sparks.push({
            x: ev.x + (Math.random() - 0.5) * ev.r, y: ev.y + (Math.random() - 0.5) * ev.r,
            vx: Math.cos(a) * 26, vy: Math.sin(a) * 46,
            life: 0.34, maxLife: 0.34, color: 0xff9a3c, size: 2, ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        return
      case 'net':
        // 网：十字**网目**（折线），加一圈小环 —— 控场武器的命中要读作"缠上了"
        // 而不是"打疼了"。颜色也切开：玉/青，不是伤害色。
        const rr = ev.r * 1.5
        const ca = Math.cos(ang) * rr, sa = Math.sin(ang) * rr
        this.arcs.push({
          pts: [
            { x: ev.x - ca - sa * 0.75, y: ev.y - sa + ca * 0.75 },
            { x: ev.x, y: ev.y },
            { x: ev.x + ca + sa * 0.75, y: ev.y + sa - ca * 0.75 },
          ], life: 0.22, maxLife: 0.24, color: UI.jade,
        })
        this.arcs.push({
          pts: [
            { x: ev.x - ca + sa * 0.75, y: ev.y - sa - ca * 0.75 },
            { x: ev.x, y: ev.y },
            { x: ev.x + ca - sa * 0.75, y: ev.y + sa + ca * 0.75 },
          ], life: 0.22, maxLife: 0.24, color: UI.jade,
        })
        return
      case 'bite':
        // 内讧撕咬：品红。**不与玩家造成的伤害共用颜色** ——
        // 玩家要能区分"这是我打的"和"它们在自相残杀"，否则会以为自己漏了输出。
        this.pushShock(ev.x, ev.y, ev.r * 1.15, 0.14, 0xff4fd8, 1.8, ev.r * 0.48, 1)
        this.pushSparks(ev.x, ev.y, ang, 0xff4fd8, 3)
        return
      default:
        // 弹丸（枪弹 / 鱼叉 / 鱼雷直击）：方向感最完整的一套，保持不变
        this.pushShock(ev.x, ev.y, ev.r * 1.35, 0.17, 0xdff4ff, 1.8, ev.r * 0.62, 1)
        this.pushSlash(ev.x, ev.y, ang, 1, ev.color)
        this.pushSparks(ev.x, ev.y, ang, ev.color, 4)
        return
    }
  }

  /**
   * 击杀特效。基础层（双层冲击环 + 径向迸溅 + 位图碎块）保留，
   * 在其上按**死因**补一条"终结语汇"（V6.46）。
   *
   * 为什么不只按 `kind` 分：原来只有"boss 大一点"，于是"被炸死"和"被电死"
   * 结束得一模一样。击杀是玩家获得反馈最密集的时刻，死因不同却终结相同，
   * 会让"我换了一把武器"这件事在视觉上失去重量。
   */
  private killFx(ev: Extract<SimEvent, { t: 'kill' }>): void {
    const boss = ev.kind === 'boss'
    this.pushShock(ev.x, ev.y, ev.r * (boss ? 4.2 : 2.6), boss ? 0.5 : 0.32,
      ev.color, boss ? 4 : 2.6, ev.r * (boss ? 1.5 : 1), 2)
    this.pushShock(ev.x, ev.y, ev.r * (boss ? 2.6 : 1.7), boss ? 0.32 : 0.2,
      0xffffff, boss ? 3 : 2, ev.r * (boss ? 0.9 : 0.62), 1)
    this.pushRadialSparks(ev.x, ev.y, boss ? 26 : 8 + Math.round(ev.r * 0.25),
      boss ? 200 : 120, boss ? 280 : 160, boss ? 2.4 : 1.6, ev.color)
    this.pushFxBit(ev.x, ev.y, ev.kind, ev.r)

    // 终结语汇：按死因补一条。每一条都只加 1–2 个图元
    switch (ev.cause ?? 'bullet') {
      case 'blast':
        // 炸死：补一圈**外扩**的冲击（爆炸应有余波），无方向
        this.pushShock(ev.x, ev.y, ev.r * (boss ? 3.4 : 2.0) * 1.5, boss ? 0.34 : 0.24,
          0xffd166, boss ? 2.4 : 1.8, 0, 1)
        break
      case 'arc':
        // 电死：四条短折线向外炸开（"被电散了"）
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.random() * 0.6
          const r0 = ev.r * 0.5, r1 = ev.r * (1.6 + Math.random() * 1.2)
          this.arcs.push({
            pts: [
              { x: ev.x + Math.cos(a) * r0, y: ev.y + Math.sin(a) * r0 },
              { x: ev.x + Math.cos(a) * (r0 + r1) * 0.55 + Math.cos(a + 1.2) * ev.r * 0.4,
                y: ev.y + Math.sin(a) * (r0 + r1) * 0.55 + Math.sin(a + 1.2) * ev.r * 0.4 },
              { x: ev.x + Math.cos(a) * r1, y: ev.y + Math.sin(a) * r1 },
            ], life: 0.16, maxLife: 0.18,
          })
        }
        break
      case 'burn':
        // 烧死：余烬**上飘**（唯一一条带方向的死法语汇 —— "烧完会升起来"）
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
          const sp = 40 + Math.random() * 60
          this.sparks.push({
            x: ev.x + (Math.random() - 0.5) * ev.r, y: ev.y + (Math.random() - 0.5) * ev.r,
            vx: Math.cos(a) * sp * 0.4, vy: Math.sin(a) * sp,
            life: 0.5, maxLife: 0.5, color: 0xff9a3c, size: 1.8 + Math.random() * 1.4,
            ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        break
      case 'bite':
        // 被同类咬死：品红双环（"这不是你干的"）
        this.pushShock(ev.x, ev.y, ev.r * 1.5, 0.22, 0xff4fd8, 2, 0, 2)
        break
      case 'net':
        // 网死：一圈收拢的网目（线**向内**收，与爆炸相反）
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.4
          const r1 = ev.r * 1.8
          this.arcs.push({
            pts: [
              { x: ev.x + Math.cos(a) * r1, y: ev.y + Math.sin(a) * r1 },
              { x: ev.x + Math.cos(a + 0.5) * ev.r * 0.6, y: ev.y + Math.sin(a + 0.5) * ev.r * 0.6 },
              { x: ev.x + Math.cos(a + 1.0) * r1, y: ev.y + Math.sin(a + 1.0) * r1 },
            ], life: 0.24, maxLife: 0.26, color: UI.jade,
          })
        }
        break
      case 'pulse':
        // 声呐击杀：一圈干净的同心环（被"震散"的感觉，不带火）
        this.pushShock(ev.x, ev.y, ev.r * 2.2, 0.26, 0x4fe8ff, 2, 0, 1)
        break
      default:
        break   // 弹丸击杀：基础三层已经够了，不再叠（叠了会糊）
    }
  }

  /**
   * 施法特效（枪口）。按武器族给不同形状 —— V6.45 之前所有武器共用
   * "一个黄色小闪光 + 3 颗火花"，于是加特林和满蓄重炮看起来一样大。
   *
   * `power` 由模拟层给（1 = 常规，2 = 重型，3 = 大招），只改尺寸不改形状：
   * 形状认族、尺寸认威力，两条信息正交，不会互相干扰。
   */
  private muzzleFx(x: number, y: number, ang: number, color: number, fam?: WeaponFamily, power = 1): void {
    const S = power >= 3 ? 1.9 : power >= 2 ? 1.4 : 1
    switch (fam) {
      case 'sonar':
        // 声呐：**无方向**的爆闪环（波前从机体往外扩，没有"枪口方向"）
        this.pushShock(x, y, 26 * S, 0.14, 0x4fe8ff, 2, 7 * S, 1)
        this.pushRadialSparks(x, y, 3, 50, 60, 1.2, 0x4fe8ff)
        return
      case 'gun':
        // 枪（V6.57 加强「弹射感」）：**焰芯 + 前向长焰 + 火花** 三层。
        //   ⚠️ 旧版只有一颗 0.11s 的**静止**短闪（`kind:'flash'` 不移动）。
        //      60fps 下它只存在 6~7 帧，而且没有任何"往前喷"的元素 ——
        //      读起来是"枪口亮了一下"，不是"一发打出去了"。
        //   现在补的那条"前向长焰"是**关键**：它有速度、且寿命更短（0.09s），
        //   一闪即逝 = 有方向、有初速，这正是"弹射"的语汇。
        this.sparks.push({
          x, y, vx: 0, vy: 0, life: 0.15, maxLife: 0.15,
          color, size: 9 * S, ang, kind: 'flash',
        })
        this.sparks.push({
          x: x + Math.cos(ang) * 7 * S, y: y + Math.sin(ang) * 7 * S,
          vx: Math.cos(ang) * 130 * S, vy: Math.sin(ang) * 130 * S,
          life: 0.09, maxLife: 0.09, color: 0xffffff, size: 3.4 * S, ang, kind: 'flash',
        })
        for (let i = 0; i < (power >= 2 ? 8 : 5); i++) {
          const a = ang + (Math.random() - 0.5) * 0.7
          const sp = (95 + Math.random() * 120) * S
          this.sparks.push({
            x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.18, maxLife: 0.18, color, size: 1.4 + Math.random() * 1.2, ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        return
      case 'torpedo':
        // 鱼雷：**双层**——内冷焰 + 外压力环。发射管要有"喷出去"的推背感
        this.sparks.push({
          x, y, vx: 0, vy: 0, life: 0.16, maxLife: 0.16,
          color: 0xfff0d0, size: 11 * S, ang, kind: 'flash',
        })
        this.pushShock(x, y, 22 * S, 0.18, color, 2.4, 0, 1)
        for (let i = 0; i < 5; i++) {
          const a = ang + (Math.random() - 0.5) * 0.42
          const sp = 90 + Math.random() * 110
          this.sparks.push({
            x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.2, maxLife: 0.2, color, size: 1.8 + Math.random() * 1.4, ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        return
      case 'harpoon':
        // 鱼叉：**细长**的直线喷流（"一根东西穿出去"，不是一团火）。
        // ⚠️ 用 4 颗沿弹道排列的高速火花拼出来，**不能**直接画到 `gFront` ——
        //    那一层每帧 `clear()` 重画，直接画只会活一帧（16ms，看不见）。
        for (let i = 0; i < 4; i++) {
          const d = (4 + i * 8) * S
          this.sparks.push({
            x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d,
            vx: Math.cos(ang) * 130, vy: Math.sin(ang) * 130,
            life: 0.14, maxLife: 0.14,
            color: i === 0 ? 0xffffff : color,
            size: 2.6 - i * 0.4, ang, kind: 'hit',
          })
        }
        this.trimSparks()
        return
      case 'echo':
        // 回声：紫环**反向收拢**（它打的是"延迟爆发"，枪口该是"聚"不是"放"）
        for (let k = 0; k < 3; k++) {
          const rr = (30 - k * 8) * S
          this.sparks.push({
            x: x + Math.cos(ang) * rr, y: y + Math.sin(ang) * rr,
            vx: 0, vy: 0, life: 0.14 + k * 0.03, maxLife: 0.2,
            color: k === 1 ? 0xffffff : color, size: 5 * S, ang, kind: 'flash',
          })
        }
        this.trimSparks()
        return
      case 'acid':
        // 酸液：**锥形雾团**（喷嘴雾化，不是火光）
        for (let i = 0; i < 4; i++) {
          const a = ang + (Math.random() - 0.5) * 0.9
          const d = 12 + Math.random() * 26
          this.sparks.push({
            x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
            vx: Math.cos(a) * 40, vy: Math.sin(a) * 40,
            life: 0.3, maxLife: 0.3, color, size: 3 + Math.random() * 2.4, ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        return
      case 'net':
        // 网：三根**散开的细索**（枪口把网"射"出去，落点才张开）
        for (let i = 0; i < 3; i++) {
          const a = ang + (i - 1) * 0.24
          this.sparks.push({
            x, y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
            life: 0.18, maxLife: 0.18, color, size: 1.6, ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        return
      default:
        // arc 与未知族：紫电火花
        for (let i = 0; i < 5; i++) {
          const a = ang + (Math.random() - 0.5) * 1.4
          const sp = 90 + Math.random() * 120
          this.sparks.push({
            x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.15, maxLife: 0.15, color: 0xd8c4ff, size: 1.4, ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        return
    }
  }

  // =========================================================================
  // 事件 → 表现
  // =========================================================================
  private handleEvent(ev: SimEvent): void {
    switch (ev.t) {
      case 'hit':
        this.hitFx(ev)
        break
      case 'kill':
        this.killFx(ev)
        break
      case 'pickup':
        // 拾取反馈原来只有 3 颗火花 —— 磁吸**收割一串**鱼骨时几乎看不见。
        // 补一圈扩散环：环是"已进账"的确认信号，在余光里比火花更容易被感知到。
        this.pushShock(ev.x, ev.y, 30, 0.24, UI.cyan, 2, 14, 1)
        this.pushRadialSparks(ev.x, ev.y, 6, 70, 30, 1.6, UI.cyan)
        // §6：环境也亮一下（"这片水因为我的收入而亮"）—— 特效是"东西"，反光是"水"
        this.pushFlash(ev.x, ev.y, FLASH_PICK)
        break
      case 'float':
        this.pushFloat(ev.x, ev.y, ev.text, ev.color, ev.size)
        break
      case 'muzzle':
        this.muzzleFx(ev.x, ev.y, ev.ang, ev.color, ev.fam, ev.power ?? 1)
        this.pushFlash(ev.x, ev.y, FLASH_MUZZLE)         // §6：枪口把周围的水照亮一下
        break
      case 'burst':
        // 同一个 `burst` 事件承载**两种物理**，靠 `ang` 分流（见 types.ts 的注释）：
        if (ev.ang !== undefined) {
          // ① **撒网张开**（有抛出方向）：柔性体 ⇒ 水滴形 + 扇贝边 + 展开→塌陷。
          //    ⚠️ V6.60 及以前这里也是同心圆环 —— 那是**冲击波**的形状，不是网的形状。
          //       网沿速度方向被甩长、网缘挂着铅坠、张开后受水阻塌回去（见 `drawNets`）。
          this.pushNet(ev.x, ev.y, ev.r, ev.ang, UI.jade)
        } else {
          // ② **全向爆炸**（氧气雷 / 水雷 / 诱饵引爆）：各向同性 ⇒ 冲击波环。
          //    没有方向可言，别硬套网状（那会把"炸开"画成"抛出"）。
          this.pushShock(ev.x, ev.y, ev.r, 0.4, UI.cyanHi, 3, ev.r * 0.12, 1)
        }
        break
      case 'arc':
        this.arcs.push({ pts: ev.pts, life: 0.18 })
        break
      case 'blast':
        this.blasts.push({ x: ev.x, y: ev.y, r: ev.r, life: 0.32 })
        // §6：硬边冲击波（`blasts`）+ 软边环境反光（这里）叠加才是"炸了一下，整个水都亮了"
        this.pushFlash(ev.x, ev.y, FLASH_BLAST)
        break
      case 'descend':
        this.clearFx()
        // V6.52 §3.1 / §3.3：换带的三个表现同时起 ——
        //   ① 爆冲（世界猛地往上一窜 = "我在加速下潜"，不是"背景跳了一下"）
        //   ② 温跃层扫带（一条波纹带从下往上扫过 = "我穿过了一层水"）
        //   ③ 双图 crossfade（旧图淡出 = 新水域"化"出来，而不是"啪"地切）
        // ⚠️ `beginXfade()` 必须在**本帧 `syncBg()` 之前**调 —— 那时 `bgNode` 上还是旧图。
        //    `handleEvent` 天然满足（它在本帧 update 里、`syncBg` 在其后），别把这个顺序改掉。
        this.burstV = SCROLL_BURST
        this.scanT = 0
        this.ringT = 0
        this.ringStr = 1                            // 换带 = 满环（换波只有 0.55，见 WAVE_RING）
        this.beginXfade()
        break
      case 'waveCleared':
        // **波间下探节拍**（V6.49 §2：这条是"下潜体感"里唯一能单独成立的改动）——
        // 每波结束都"往下沉一截"：世界再窜一下（小幅）+ 一圈水压环掠过。
        // ⚠️ 用 `max` 而不是直接赋值：若换带的 220 还在衰减中就清了这一波，
        //   不该把它**拉低**到 115（那会读作"节拍反而变弱了"）。
        this.burstV = Math.max(this.burstV, WAVE_BURST)
        this.ringT = 0
        this.ringStr = WAVE_RING
        break
      case 'shake':
        this.shake(ev.ms, ev.intensity)
        break
      // 一局结束（上浮成功 / 溺水）：把成绩并进档案并落盘。
      // 两个事件都由 `world.showResult()` 抛出，而它是幂等的（见 world.ts 的注释），
      // 所以这里天然只会执行一次 —— 再兜一层 runSaved 是因为"多记一局"这种错
      // 在存档里会一直在，属于宁可贵一点的防御。
      case 'runCleared':
      case 'dead':
        this.finishRun()
        break
      // 以下事件本切片不产生额外表现（相位可直接读 world 字段）：
      //   playerHurt、dodge、wave / layerCleared
      //   （`waveCleared` 已在上面接了「波间下探节拍」，不在这一组）
      default:
        break
    }
  }

  /**
   * 一局结束：把成绩并进档案并落盘。
   *
   * 「带出生物质」的口径必须与结算屏一致（见 Hud.drawResult）：溺水一局全损失，
   * 所以 `win=false` 时按 0 记 —— 否则"死得越深纪录越高"，档案会变成反向激励。
   */
  private finishRun(): void {
    if (this.runSaved) return
    this.runSaved = true
    const w = this.world
    // ① 纪录 + 沉淀 + 图鉴（纯函数，见 profile.ts applyRun）
    const out = applyRun(this.profile, {
      biomass: w.win ? Math.floor(w.biomass * w.mult) : 0,
      layer: w.layerIdx,
      wave: w.waveInLayer,
      bossDown: w.bossDown,
      sub: w.sub.id,
      surfaced: w.win,
      seen: codexGains({
        spawned: w.spawned,
        bossDown: w.bossDown,
        weaponIds: w.weapons.map(x => x.id),
        relicIds: w.relics.slice(),
      }),
    })
    // ② 解锁 + 里程碑（要读武器/遗物表，所以是独立一步，见 unlocks.ts settleProgress）
    const prog = settleProgress(out.profile)
    this.profile = prog.profile
    this.runRecord = recordLabel(out)
    this.runBanked = out.banked
    this.runUnlocked = prog.unlocked.map(unlockName)
    saveProfile(this.profile)
    // 结算后立刻刷新标题屏的钱包（否则要点开装置坞才更新）
    this.title?.refreshWallet()
  }

  /**
   * 登记一次**网张开**（V6.61）。
   *
   * `ang` 是抛出方向 —— 网沿它拉长。这个值必须由模拟层给出（`openNet` 传子弹速度方向），
   * 渲染层猜不出来：同一个位置往上扔和往右扔，网的形状完全不同。
   */
  private pushNet(x: number, y: number, r: number, ang: number, col: number): void {
    const ph: number[] = []
    for (let i = 0; i < NET_SEGS; i++) ph.push(Math.random())
    this.nets.push({ x, y, ang, r, col, life: 0, maxLife: NET_DUR, ph })
    if (this.nets.length > NET_CAP) this.nets.splice(0, this.nets.length - NET_CAP)
  }

  private pushShock(x: number, y: number, rMax: number, dur: number, color: number, width: number, core: number, rings: number): void {
    this.shocks.push({ x, y, r: 0, rMax, life: dur, maxLife: dur, color, width, core, rings, ringDelay: rings > 1 ? 0.3 : 0 })
    if (this.shocks.length > SHOCK_CAP) this.shocks.splice(0, this.shocks.length - SHOCK_CAP)
  }

  /**
   * 位图击杀特效（V6.40）。贴图没加载 / 该敌人不配 → **静默跳过**（矢量特效照旧）——
   * 主界面的"没有美术也能跑"同一条原则：缺图不该让战斗出错。
   *
   * 尺寸取"敌人半径的倍数"而不是固定像素：小怪的小爆、Boss 的大爆，
   * 同一个道理（和 `pushShock` 用 `ev.r * 2.6` 是同一套算法）。
   */
  private pushFxBit(x: number, y: number, kind: string, r: number): void {
    if (!this.artLoaded) return
    const key = fxKeyFor(kind, r)
    if (!key) return
    const sf = this.art.get(key)
    if (!sf) return
    const sp = this.acquireFxBit(key, sf)
    if (!sp) return
    const boss = kind === 'boss'
    const drift = kind === 'drift'
    const r0 = boss ? r * 1.2 : drift ? r * 1.0 : r * 0.9
    const r1 = boss ? r * 5.4 : drift ? r * 3.0 : r * 2.6
    this.fxBits.push({
      sp, key, x, y,
      r0, r1,
      rot0: (Math.random() - 0.5) * 26,
      rot1: (Math.random() - 0.5) * 26 + (boss ? 40 : 16),
      life: boss ? 0.52 : drift ? 0.46 : 0.34,
      maxLife: boss ? 0.52 : drift ? 0.46 : 0.34,
    })
    if (this.fxBits.length > FXBIT_CAP) {
      const drop = this.fxBits.splice(0, this.fxBits.length - FXBIT_CAP)
      for (const d of drop) d.sp.node.active = false
    }
  }

  private acquireFxBit(key: string, sf: SpriteFrame): Sprite | null {
    for (const f of this.fxBitPool) {
      if (f.key === key && !f.sp.node.active) {
        f.sp.node.active = true
        return f.sp
      }
    }
    if (this.fxBitPool.length >= FXBIT_CAP) return null
    const n = this.mkNode('fxb', this.fxBitLayer)
    const sp = n.addComponent(Sprite)
    sp.trim = false
    sp.sizeMode = Sprite.SizeMode.CUSTOM
    sp.spriteFrame = sf
    // 贴图是 512×512 的正方形，alpha 已由 `process_fx.py` 从亮度导出 —— 直接用。
    this.fxBitPool.push({ sp, key })
    return sp
  }

  /** 每帧推进位图特效：位置固定，半径放大、旋转、淡出。 */
  private stepFxBits(dt: number): void {
    for (const f of this.fxBits) f.life -= dt
    for (let i = this.fxBits.length - 1; i >= 0; i--) {
      if (this.fxBits[i].life <= 0) {
        this.fxBits[i].sp.node.active = false
        this.fxBits.splice(i, 1)
      }
    }
  }

  /** 画位图特效（在 `stepFxBits` 之后调，画在 `gFront` 那层之下）。 */
  private drawFxBits(): void {
    for (const f of this.fxBits) {
      const t = 1 - Math.max(0, f.life / f.maxLife)    // 0 → 1
      const r = f.r0 + (f.r1 - f.r0) * (1 - Math.pow(1 - t, 2))   // ease-out
      const ang = f.rot0 + (f.rot1 - f.rot0) * t
      const a = t < 0.14 ? t / 0.14 : Math.pow(1 - (t - 0.14) / 0.86, 1.35)  // 快速起、慢收
      const ut = f.sp.node.getComponent(UITransform)
      if (ut) ut.setContentSize(r * 2, r * 2)
      f.sp.node.setPosition(f.x, this.H - f.y)
      f.sp.node.angle = ang
      const op = f.sp.node.getComponent(UIOpacity) ?? f.sp.node.addComponent(UIOpacity)
      op.opacity = Math.round(Math.max(0, Math.min(1, a)) * 255)
    }
  }

  private pushSlash(x: number, y: number, ang: number, scale: number, color: number): void {
    this.slashes.push({ x, y, ang, len: 26 * scale, life: 0.1, maxLife: 0.1, color, width: 2.2 * scale })
    if (this.slashes.length > SLASH_CAP) this.slashes.splice(0, this.slashes.length - SLASH_CAP)
  }

  /** 命中火星：沿弹道方向的反向**扇形迸溅 ±43°**（不是全向散，全向散读不出打击方向） */
  private pushSparks(x: number, y: number, baseAng: number, color: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = baseAng + (Math.random() - 0.5) * 1.5
      const sp = 110 + Math.random() * 190
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.14 + Math.random() * 0.1, maxLife: 0.24,
        color, size: 1.3 + Math.random() * 1.5, ang: a, kind: 'hit',
      })
    }
    this.trimSparks()
  }

  private pushRadialSparks(x: number, y: number, n: number, spMin: number, spVar: number, size: number, color: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.5
      const sp = spMin + Math.random() * spVar
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.2 + Math.random() * 0.22, maxLife: 0.42,
        color: i % 3 === 0 ? 0xffffff : color, size: size + Math.random() * 1.6, ang: a, kind: 'hit',
      })
    }
    this.trimSparks()
  }

  /**
   * 枪口闪光（web 的 `spawnMuzzleFlash`）：**锥形亮弧 + 中心白核**，
   * 喷在**炮口位置**而不是机体中心 —— 中心喷会看不出是哪台武器开的火。
   * 再加 3 颗朝弹道方向的小火星，让"火力从这出去"更实。
   */
  private pushMuzzle(x: number, y: number, ang: number, color: number): void {
    this.sparks.push({
      x, y, vx: 0, vy: 0,
      life: 0.11, maxLife: 0.11, color, size: 7, ang, kind: 'flash',
    })
    for (let i = 0; i < 3; i++) {
      const a = ang + (Math.random() - 0.5) * 0.7
      const sp = 70 + Math.random() * 90
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.16, maxLife: 0.16, color, size: 1.4 + Math.random() * 1.2, ang: a, kind: 'hit',
      })
    }
    this.trimSparks()
  }

  private trimSparks(): void {
    if (this.sparks.length > SPARK_CAP) this.sparks.splice(0, this.sparks.length - SPARK_CAP)
  }

  /** 飘字：固定槽位池，没有空槽就顶掉剩余寿命最短的那个（绝不无限增长） */
  private pushFloat(x: number, y: number, text: string, color: number, size: number): void {
    let idx = -1
    let minLife = Infinity
    for (let i = 0; i < FLOAT_CAP; i++) {
      const f = this.floatSlots[i]
      if (!f || f.life <= 0) { idx = i; break }
      if (f.life < minLife) { minLife = f.life; idx = i }
    }
    if (idx < 0) idx = 0
    let f = this.floatSlots[idx]
    if (!f) {
      const n = this.mkNode('float', this.worldRoot)
      const l = n.addComponent(Label)
      l.horizontalAlign = Label.HorizontalAlign.CENTER
      l.verticalAlign = Label.VerticalAlign.CENTER
      // 2026-10-13：飘字**加粗 + 深色描边**。深海背景 + 满屏火花/拖尾/爆环里，
      // 细体无描边的数字会被背景吃掉 —— 这是"小了点"的**真正成因**（只放大不加描边，
      // 边缘仍会被亮特效用同化）。描边宽度随字号走，见下方 outlineWidth。
      l.isBold = true
      l.enableOutline = true
      l.outlineColor = col(0x040810)
      f = { x, y, vy: -34, life: 0.9, text, color, size, delay: 0, label: l }
      this.floatSlots[idx] = f
    }
    f.x = x; f.y = y; f.life = 0.9; f.text = text; f.color = color; f.size = size
    f.delay = 0.05 * idx        // 同帧多个飘字错开，避免叠成一团读不出数字
    f.label.string = text
    f.label.fontSize = size
    f.label.lineHeight = size + 2
    // 描边宽随字号比例走（≈0.16×字号，下限 2）—— 固定值会在小字上糊成一圈、大字上又太细
    f.label.outlineWidth = Math.max(2, Math.round(size * 0.16))
    f.label.color = col(color)
    f.label.node.active = true
    f.label.node.setPosition(x, this.H - y)
  }

  private clearFx(): void {
    this.shocks.length = 0
    this.slashes.length = 0
    this.sparks.length = 0
    this.arcs.length = 0
    this.blasts.length = 0
    // 环境反光（§6）也归零：换带/结算之后不该还留着一团 0.2s 前的亮斑
    this.atmoFlashes.length = 0
    this.nets.length = 0                 // 网张开：换带/结算之后不该还挂着一张 0.5s 前的网
    this.fxBits.length = 0
    for (const f of this.fxBitPool) f.sp.node.active = false
    for (const f of this.floatSlots) {
      if (!f) continue
      f.life = 0
      f.label.node.active = false
    }
  }

  private stepFx(dt: number): void {
    this.fxT += dt
    for (const s of this.shocks) { s.life -= dt; s.r = s.rMax * (1 - Math.max(0, s.life / s.maxLife)) }
    this.shocks = this.shocks.filter(s => s.life > 0)

    for (const s of this.slashes) s.life -= dt
    this.slashes = this.slashes.filter(s => s.life > 0)

    for (const a of this.arcs) a.life -= dt
    this.arcs = this.arcs.filter(a => a.life > 0)

    for (const b of this.blasts) b.life -= dt
    this.blasts = this.blasts.filter(b => b.life > 0)

    for (const s of this.sparks) {
      s.life -= dt
      if (s.kind !== 'hit') continue        // 枪口闪光原地不动
      s.x += s.vx * dt
      s.y += s.vy * dt
      // 水的阻尼：火星在水里很快就停（web 的 1 - 3.4*dt）。dt 上限 0.05 → 系数 ≥0.83，不会翻号。
      s.vx *= 1 - 3.4 * dt
      s.vy *= 1 - 3.4 * dt
    }
    this.sparks = this.sparks.filter(s => s.life > 0)

    for (const f of this.floatSlots) {
      if (!f || f.life <= 0) continue
      if (f.delay > 0) { f.delay -= dt; continue }
      f.life -= dt
      if (f.life <= 0) { f.label.node.active = false; continue }
      f.y += f.vy * dt
      f.label.color = col(f.color, Math.min(1, f.life / 0.3))
      f.label.node.setPosition(f.x, this.H - f.y)
    }
  }

  // =========================================================================
  // 绘制
  // =========================================================================
  /**
   * 推进**下潜滚动**与**换带过渡**（V6.52 §3.1 / §3.3，V6.56 落）。
   *
   * 四件事，全是**表现层状态**，模拟层零改动：
   *   ① 换带爆冲的指数衰减 → `scrollV`（`SCROLL_BASE + burstV`）
   *   ② 温跃层扫带的推进
   *   ③ 水压环的推进
   *   ④ 背景 crossfade 的推进
   *
   * ⚠️ 与海雪一样**不受暂停影响**：暂停是"停住战斗"，不是"把水冻成冰"。
   *    （`w.update` 被跳过，但 `gBg` / `gAtmo` 照旧每帧重画，这已经是既有口径。）
   */
  private stepWater(dt: number): void {
    // ① 爆冲衰减（§3.1）：低于 0.05 直接归零，免得永远吊着一条看不见的尾巴
    this.burstV = this.burstV > 0.05 ? this.burstV * Math.exp(-dt / BURST_TAU) : 0
    this.scrollV = SCROLL_BASE + this.burstV

    // ② 温跃层扫带（§3.3 ②）
    if (this.scanT >= 0) {
      this.scanT += dt
      if (this.scanT > SCAN_DUR) this.scanT = -1
    }

    // ③ 水压环（§3.4）
    if (this.ringT >= 0) {
      this.ringT += dt
      if (this.ringT > RING_DUR) this.ringT = -1
    }

    // ④ 背景 crossfade（§3.3 ③）：旧图在上**淡出**、新图在下面**恒定满不透明**
    //    ⇒ 合成结果 = `旧×a + 新×(1-a)`，一次干净的交叉淡入（两层各半透会先暗一档再亮回来）
    if (this.xfadeT >= 0) {
      this.xfadeT += dt
      const k = Math.min(1, this.xfadeT / XFADE_DUR)
      const e = k * k * (3 - 2 * k)                       // smoothstep
      this.bgNodeOld.color = col(0xffffff, 1 - e)
      if (k >= 1) { this.xfadeT = -1; this.bgNodeOld.node.active = false }
    }
  }

  /**
   * 开始换带 crossfade：把**当前正显示的**背景图拷到 `bgNodeOld` 上准备淡出。
   *
   * ⚠️ 调用时机只有一处且不能挪：`handleEvent` 里处理 `descend` 的那一帧。
   *    那时 `diveDeeper()` 已经把 `layerIdx` 加了 1，而本帧的 `syncBg()` **还没跑**
   *    —— `bgNode` 上仍是**旧图**。挪到 `syncBg` 之后再调，拷到的就是新图（= 没有过渡）。
   */
  private beginXfade(): void {
    if (!this.artLoaded || !this.bgNode.node.active || !this.bgNode.spriteFrame) return
    const ut = this.bgNode.node.getComponent(UITransform)!
    this.bgNodeOld.spriteFrame = this.bgNode.spriteFrame
    this.bgNodeOld.node.getComponent(UITransform)!
      .setContentSize(ut.contentSize.width, ut.contentSize.height)
    this.bgNodeOld.node.setPosition(this.bgNode.node.position.x, this.bgNode.node.position.y)
    this.bgNodeOld.color = col(0xffffff, 1)
    this.bgNodeOld.node.active = true
    this.xfadeT = 0
  }

  /**
   * 不透明底色（gBase）+ 海雪（gBg）。
   *
   * ⚠️ 两件事必须分两层：底色进 `gBase`（在背景图之下），海雪进 `gBg`（在背景图之上）。
   *    早期把两者都塞进 `gBg`，而 `gBg` 排在背景图之后 —— 那层不透明的
   *    `UI.abyss` 就把 env 背景图整体盖住了，"背景图不显示"就是这么来的。
   */
  private drawBg(w: DiveWorld, dt: number): void {
    // 底 + 外扩：设计分辨率宽高比与 W×H 不一致时，屏幕边缘会露出清屏色的一条
    // 细带（只在某些机型上出现，最难查的那类 bug）。所以按可视区外扩。
    const view = this.viewWorld()
    const pw = Math.max(0, (view.w - this.W) / 2) + 8
    const ph = Math.max(0, (view.h - this.H) / 2) + 8
    this.gBase.fill(UI.abyss, 1)
    this.gBase.fillRect(-pw, -ph, this.W + pw * 2, this.H + ph * 2)


    // ---- 海雪 / 悬浮物（V6.50 §3.2 + V6.53 + V6.56）----
    // 四条，缺一条就读不出"在往下走"：
    //   ① **提速**：原 `vy = -6~-20 px/s` 方向是对的（**负值** = y 减小 = 向上掠 = 下潜感），
    //      但**慢一个数量级**，屏幕上几乎看不出在动 ⇒ "我在下潜"只有深度数字在说、画面不说。
    //      ⚠️ **符号千万别丢**：V6.56 重写时写成 `m.y += +scrollV`（正值），
    //      在 sim 坐标（**y 向下**）里就是把颗粒推向**屏幕下方** —— 视觉上变成"上浮"，
    //      与"下潜"正好相反，而且不报任何错。判据只有一条：**`SCROLL_BASE` 正数 ⇒ 用 `-=`**。
    //   ② **三层视差**：远景（背景图）静止 / 中景 0.35× / 近景 1.00×。**视差本身就是深度线索**。
    //   ③ **数量走 `LAYERS.motes`**（34/48/70/90/110）：越深越密。原值写死 60。
    //   ④ **速度走 `scrollV`**（V6.56）：这样换带爆冲能**同时**推快整片水，
    //      而不是只有背景图在动。L4 反向见 `MOTE_MUL`。
    // ⛔ 深度**不影响速度** —— 别做"越深越慢"，那会削弱下潜感。深度只影响密度/尺寸/亮度。
    const want = w.layer().motes
    const idx = Math.min(MOTE_STYLE.length - 1, w.layerIdx)
    const st = MOTE_STYLE[idx]
    // ⑤ **换带整批重建**（V6.59+）：物质随带变（颜色/形状/摆动），逐条改属性反而更绕。
    //    与 `schools` 同规：换带瞬间整片水"换了一种东西"，本来就有扫带+爆冲盖住这一帧。
    if (this.moteLayer !== idx) {
      this.moteLayer = idx
      this.motes.length = 0
    }
    while (this.motes.length < want) this.motes.push(this.newMote(this.motes.length % 2 === 0, idx))
    while (this.motes.length > want) this.motes.pop()
    const mul = MOTE_MUL[idx] ?? MOTE_MUL[0]
    for (const m of this.motes) {
      // **减号**：`scrollV > 0` ⇒ y 减小 ⇒ 颗粒向上掠过（见上方 ① 的符号说明）
      m.y -= (m.far ? mul[1] : mul[0]) * this.scrollV * m.jit * dt
      // ⚠️ 回绕必须**双向**：L4 的颗粒是往下走的（`MOTE_MUL` 里的负数 ⇒ y 增大），
      //    只判 `y < -4` 会让它们在屏幕下方越积越多，最后糊成一条静止的亮带。
      if (m.y < -4) { m.y = this.H + 4; m.x = Math.random() * this.W }
      else if (m.y > this.H + 4) { m.y = -4; m.x = Math.random() * this.W }
      // 近景更亮更大、中景更暗更小 —— Graphics 没有景深，"远近"只能这样读出来
      let a = m.a * (m.far ? 0.5 : 1)
      const r = m.r * st.sMul
      // ⚠️ 原「光柱照亮的颗粒」已随光柱一起移除（V6.65）：光束与"被照亮的悬浮物"
      //   都由重出的 env 位图一并给出，渲染层不再模拟丁达尔的因果。
      this.gBg.fill(st.col, a)
      if (st.sq > 1) {
        // 悬浮絮：拉成横条 + 随暗流左右摆（`wob`）。**摆动是 L2 机制的可见化** ——
        //   玩家光看数字不知道"有暗流"，但看到絮被拽着走就知道了。
        this.gBg.fillEllipse(m.x + Math.sin(w.t * 2.6 + m.ph) * st.wob, m.y, r, r / st.sq)
      } else {
        this.gBg.fillCircle(m.x, m.y, r)
      }
    }
  }

  /**
   * 生成一颗悬浮物（V6.50 §3.2 / V6.56）。
   * `far = true` ⇒ 中景（0.35× 速度、更小更暗）；否则近景（全速、更大更亮）。
   */
  private newMote(far: boolean, idx: number): Mote {
    const st = MOTE_STYLE[Math.min(MOTE_STYLE.length - 1, idx)] ?? MOTE_STYLE[0]
    return {
      x: Math.random() * this.W,
      y: Math.random() * this.H,
      r: far ? 0.7 + Math.random() * 1.0 : 1.3 + Math.random() * 2.2,
      jit: 0.8 + Math.random() * 0.4,     // ±20% 抖动：免得整屏颗粒像一块板在移动
      far,
      // 亮度**个体固定**（不是每帧随机）：L3 的 aHi 特意拉到 0.52，
      //   靠"少数颗粒明显更亮"做出"水里有会闪的东西"，每帧随机会把这件事冲掉。
      a: st.aLo + Math.random() * (st.aHi - st.aLo),
      ph: Math.random() * Math.PI * 2,
    }
  }

  /**
   * 环境色调 + 压暗 + 暗角 + 屏幕边框。
   *
   * V6.51 §2.3 重定：**光改由 `gAtmo` 提供，压暗层必须让位**。
   *   · 色调 `0.10 → 0.16`（0.10 太淡，色相跳变根本读不出来）；
   *   · 压暗 `(1-vis)×0.42 → ×0.24`；
   *   · 暗角 `0.16+(1-vis)×0.72 → 0.10+(1-vis)×0.42`。
   * 旧值是一路压到黑（L5 屏幕中央实测亮度 ≈ 9）—— 那是"我瞎了"，不是"深水"。
   * 暗要改由 `drawFog` 的同色雾来表达（**亮的暗 ≠ 暗的暗**）。
   *
   * 暗角必须用**同心环带**而不是径向渐变：环带每像素只画一次，渐变会被反复叠加成死黑。
   */
  /**
   * **连续化**：按 `depthM` 在相邻带之间插值 `tint` / `vis` / 雾半径（V6.51 §9 第 9 步）。
   *
   * 为什么只有这三样必须连续：带每 156s 才跳一次，但水色与能见度是**一直**在变的。
   * 玩家在带内划水时，画面应该"缓慢地越来越深"，而不是到了 `depthBot` 那一帧"啪"地换色。
   * 台阶在"下潜"这个题材里是致命的 —— 它把**"我在深处"**变成**"我触发了换带事件"**。
   *
   * 过渡形状：本带**前 `BLEND_FROM` 保持本色**（保住每带的辨识度），
   * **后 1−BLEND_FROM 才开始"变味"** —— 那段就是"我快到了"的预告。
   * ⛔ 全程线性会让"刚进带就半只脚在下一带"，段感全丢（那比台阶更糟）。
   */
  private layerBlend(w: DiveWorld): { tint: number; vis: number; fogR: number } {
    const i = Math.max(0, Math.min(LAYERS.length - 1, w.layerIdx))
    const L = LAYERS[i]
    const fog0 = FOG_R[Math.min(FOG_R.length - 1, i)]
    const nx = i + 1 < LAYERS.length ? LAYERS[i + 1] : null
    if (!nx) return { tint: L.tint, vis: L.vis, fogR: fog0 }
    const span = Math.max(1, nx.depthTop - L.depthTop)
    const k = clamp1((w.depthM - L.depthTop) / span, 0, 1)
    const r = clamp1((k - BLEND_FROM) / (1 - BLEND_FROM), 0, 1)
    const t = r * r * (3 - 2 * r)                  // smoothstep：两头都平，接缝看不见
    const fog1 = FOG_R[Math.min(FOG_R.length - 1, i + 1)]
    return {
      tint: mixCol(L.tint, nx.tint, t),
      vis: L.vis + (nx.vis - L.vis) * t,
      // L1 的"无雾"是**设计**（阳光带全清）⇒ `fog0 = 0` 时整段都不长雾，别插值
      fogR: fog0 <= 0 ? 0 : fog0 + (fog1 - fog0) * t,
    }
  }

  private drawVeil(w: DiveWorld): void {
    // 弹窗相位不画环境层：那几个页面是一整张实底页，环境不该透上来。
    if (w.phase === 'shop' || w.phase === 'decide' || w.phase === 'result') return

    const vr = this.viewRect()
    // ⚠️ V6.60 §9-9：颜色与能见度走**连续曲线**（`layerBlend`），不再取 `w.layer()` 的常量 ——
    //    取常量就会在 `depthBot` 那一帧"啪"地换色，把"我在深处"变成"我触发了换带事件"。
    const bl = this.layerBlend(w)
    const z = this.zoom > 0 ? this.zoom : 1

    this.gVeil.fill(bl.tint, 0.16); this.gVeil.fillRect(vr.x, vr.y, vr.w, vr.h)
    this.gVeil.fill(UI.abyss, (1 - bl.vis) * 0.24); this.gVeil.fillRect(vr.x, vr.y, vr.w, vr.h)

    // 暗角：环带宽度按 zoom 折算，这样放大后屏幕上的视觉宽度保持一致
    const BANDS = 18
    const band = Math.min(vr.w, vr.h) / BANDS
    const descBoost = w.phase === 'descending' ? 0.38 : 0
    const strength = 0.10 + (1 - bl.vis) * 0.42 + descBoost
    for (let i = 0; i < BANDS; i++) {
      const o = i * band
      const e = o + band
      const a = Math.pow(1 - i / BANDS, 2.4) * strength
      if (a < 0.004) continue
      this.gVeil.fill(UI.abyss, a)
      this.gVeil.fillRect(vr.x + o, vr.y + o, vr.w - o * 2, e - o)                   // 上
      this.gVeil.fillRect(vr.x + o, vr.y + vr.h - e, vr.w - o * 2, e - o)            // 下
      this.gVeil.fillRect(vr.x + o, vr.y + e, e - o, vr.h - e * 2)                   // 左
      this.gVeil.fillRect(vr.x + vr.w - e, vr.y + e, e - o, vr.h - e * 2)            // 右
    }

    // 极淡的屏幕边框（"仪表盘边缘"的暗示，不能抢眼）
    const ins = 12 / z
    this.gVeil.line(UI.cyanDim, 0.15, 1 / z)
    this.gVeil.strokeRect(vr.x + ins, vr.y + ins, vr.w - ins * 2, vr.h - ins * 2)

    // 低氧暗角：上下各一条红带
    const frac = w.o2 / Math.max(1, w.o2Max)
    if (frac < 0.35) {
      const m = 90 / z
      this.gVeil.fill(0x501313, Math.min(0.45, (0.35 - frac) * 0.9))
      this.gVeil.fillRect(vr.x, vr.y, vr.w, m)
      this.gVeil.fillRect(vr.x, vr.y + vr.h - m, vr.w, m)
    }
    // 方向性受击暗角：受击来向那一侧先红
    if (w.hurtDirT > 0) {
      const k = Math.min(1, w.hurtDirT / 0.6)
      const side = w.hurtDirX > 0 ? 1 : -1
      for (let i = 0; i < 6; i++) {
        const bw = (vr.w * 0.08 * (1 - (i / 7) * 0.3)) / z
        const x = side > 0 ? vr.x + vr.w - bw * (i + 1) : vr.x + bw * i
        this.gVeil.fill(UI.danger, 0.12 * k)
        this.gVeil.fillRect(x, vr.y, bw, vr.h)
      }
    }
  }

  /**
   * **光照与生态层**（V6.53 建层 / V6.59 补全六元素）。
   *
   * 为什么单独一层：**"越深越黑"物理上正确、游戏上是死路** —— 玩家需要"看得见水里有东西"，
   * 而不是"一团黑"。所以每一带换一个「光的主角」来替代被减掉的亮度：
   *   L1 阳光（**光柱已下放到 env 背景图**）→ L2 残光 + 探照灯 → L3 生物荧光 →
   *   L4 热泉自发光 → L5 探照灯 + 呼吸点阵。
   * 详见 `docs/水域光照与生态规格_V6.51.md`。
   *
   * ⚠️ **这里的绘制顺序 = 物理顺序**，不是"想到哪画到哪"：
   *     ① 远景鱼群（最远）→ ② 能见度雾（压水体，**不压光源**）→ ③ 探照灯 + 按带光源
   *     → ④ 换带过渡（扫带 / 水压环，压全场）。
   *   把光源画到雾**下面** = 屏幕边缘的光柱被雾掐掉一半，看起来像渲染 bug（§3.2）。
   *
   * ⚠️ 鱼群**绝不给 2px 发光核**（那是敌人的定位铁律，见 `drawEnemies`）：
   *    远景剪影不可瞄准、不碰撞，给了核玩家会朝打不到的鱼开火。
   */
  private drawAtmo(w: DiveWorld, dt: number): void {
    // 弹窗相位不画环境层（与 `drawVeil` 同规）：那几个页面是一整张实底页，环境不该透上来。
    if (w.phase === 'shop' || w.phase === 'decide' || w.phase === 'result') return

    const idx = Math.min(LAYER_ECO.length - 1, w.layerIdx)
    if (this.atmoLayer !== idx) this.buildAtmo(idx)

    this.drawSchools(w, idx, dt)
    this.drawFog(w)
    this.drawLamp(w)
    this.drawLayerLights(w, idx, dt)
    // 交互反光：**画在光源之上**（它是"刚发生的事"，不该被雾压暗），
    // 但在扫带之下（换带的仪式感要压住一切瞬时特效）。
    this.drawFlashes(dt)
    this.drawScanBand(w)
    this.drawPressureRings()
  }

  /**
   * **交互光反馈**（V6.51 §6）：让战斗在**水**上留下反应。
   *
   * 每条 = `FLASH_LAYERS` 个同心圆、**同一个 alpha** 由外向内叠 ⇒ 中心亮、边缘柔。
   * （同 `drawLamp` 的道理；同心异 alpha 会显出硬环。）
   *
   * 衰减用 `e²`（先快后慢）：闪光要"炸开就收"，线性衰减会显得绵软。
   */
  private drawFlashes(dt: number): void {
    for (let i = this.atmoFlashes.length - 1; i >= 0; i--) {
      const f = this.atmoFlashes[i]
      f.life += dt
      const t = f.life / f.dur
      if (t >= 1) { this.atmoFlashes.splice(i, 1); continue }
      const e = 1 - t
      const a = f.a * e * e
      const r = f.r0 + (f.r1 - f.r0) * t
      // 层数是**降级旋钮**的一部分：flash 会叠加（齐射时同时好几条），
      //   极端情况下它是光照层里最不可控的一项 ⇒ 降级时先砍它（3 → 2 层）。
      const layers = ATMO_QUALITY >= 2 ? FLASH_LAYERS : 2
      for (let k = 0; k < layers; k++) {
        this.gAtmo.fill(f.col, a)
        this.gAtmo.fillCircle(f.x, f.y, r * (0.45 + 0.275 * k))
      }
    }
  }

  /** 追加一条环境反光（超上限时丢最旧的）。参数直接用 §6 的三个常量表 */
  private pushFlash(x: number, y: number, p: { r0: number; r1: number; dur: number; col: number; a: number }): void {
    if (this.atmoFlashes.length >= FLASH_CAP) this.atmoFlashes.shift()
    this.atmoFlashes.push({ x, y, r0: p.r0, r1: p.r1, life: 0, dur: p.dur, col: p.col, a: p.a })
  }

  /**
   * **远景鱼群剪影**（V6.53）。用户点名要的「不同水域要有海生物、鱼群」。
   *
   * 与水**同一个速度场**（中景档）。换带爆冲时它也跟着窜 —— 否则
   * "颗粒在往上冲、鱼却钉在原地"，一看就是两个世界的东西。
   * ⚠️ 纵向同样是 **`-=`**（见 `SCROLL_BASE` 的符号约定）：L4 的 `mul[1]` 是负数 ⇒ 鱼群下沉。
   */
  private drawSchools(w: DiveWorld, idx: number, dt: number): void {
    const mul = MOTE_MUL[idx] ?? MOTE_MUL[0]
    for (const f of this.schools) {
      f.x += f.vx * dt
      f.y -= mul[1] * this.scrollV * dt
      f.fade = Math.min(1, f.fade + dt / 0.6)     // 渐入（换带时不能"啪"地出现）
      // 两侧回绕：比"出屏销毁 + 重新生成"省事，也不会出现鱼群凭空冒出来
      const wrap = f.size * 1.6
      if (f.vx > 0 && f.x > this.W + wrap) f.x = -wrap
      else if (f.vx < 0 && f.x < -wrap) f.x = this.W + wrap
      // 上下回绕同理（L4 里 `mul[1]` 是负数 ⇒ 鱼群缓慢下沉）
      const wY = f.size * 1.2
      if (f.y < -wY) f.y = this.H + wY
      else if (f.y > this.H + wY) f.y = -wY
      if (f.fade <= 0.01) continue

      const a = f.alpha * f.fade
      const L = f.size
      const H = L * 0.20                       // 半高（与旧的 `h*0.5 = L*0.2` 同值）
      const s = f.vx > 0 ? 1 : -1              // 头在游向那一端
      const tailPhase = w.t * 5 + f.phase      // 摆尾相位逐条错开，否则一群鱼像一块板
      const swing = Math.sin(tailPhase) * H * 0.55

      // 一条完整轮廓 = **1 个图元**（旧版是椭圆 + 三角 = 2）。**无发光核**。
      const pts: Array<{ x: number; y: number }> = []
      for (const [u, v] of FISH_OUTLINE) {
        // 越靠尾摆得越多（头几乎不动）—— 游动是"尾巴在推"，整条平移读作贴图
        const wTail = Math.max(0, (u - 0.6) / 0.4)
        // 身体**中段**的轻微起伏（`sin(u*π)` ⇒ 两端为 0，不破坏头尾的接驳）
        const bend = Math.sin(tailPhase - 0.8) * H * 0.12 * Math.sin(u * Math.PI)
        pts.push({ x: f.x + s * (0.5 - u) * L, y: f.y + v * H + bend + swing * wTail })
      }
      this.gAtmo.fill(ATM_FISH_TINT[idx] ?? 0x24455c, a)
      this.gAtmo.polyline(pts)
      this.gAtmo.fillPath()
    }
  }

  /**
   * **能见度雾**（V6.51 §4.6，全带）。
   *
   * ⚠️ **靠"雾"而不是靠"黑"**：雾取**当前带的 `tint`**，绝不取 `UI.abyss`。
   *   「亮的暗」读作"我看不了太远"（这才是潜水感）；「暗的暗」读作"我瞎了"。
   *   这条与 `drawVeil` 里**减半**的压暗是配套的 —— 压暗让位给雾。
   *
   * 半径随深度收（L1 无限 → L5 300px），**中心只给摄像头**（不是玩家）：
   *   玩家被镜头跟着，两者本就几乎重合；但玩家贴世界边界时镜头会被钳住，
   *   此时以玩家为中心会让雾圈整个甩到屏幕一侧（一闪一闪的）。
   *
   * ⛔ **禁用径向渐变**（项目已有教训：渐变被反复叠加成死黑）⇒ 用**同心环带**：
   *   每像素只被一条环带覆盖一次，不叠加。
   */
  private drawFog(w: DiveWorld): void {
    // 半径与颜色都走 `layerBlend`（§9-9）：雾是**最不该跳变**的一样 —— 它铺满整个屏幕，
    // 一旦在换带那一帧突然换色，玩家会以为"画面闪了一下"。
    const bl = this.layerBlend(w)
    const r0 = bl.fogR
    if (r0 <= 0 || ATMO_QUALITY === 0) return      // L1 是白天：能见度无限
    const vr = this.viewRect()
    const z = this.zoom > 0 ? this.zoom : 1
    const rIn = r0 / z                              // 规格给的是**屏幕 px** ⇒ 折回世界单位
    const rOut = Math.hypot(vr.w, vr.h) * 0.55     // 覆盖到屏幕四角（略超，免得边角漏）
    const band = Math.max(20, (rOut - rIn) / FOG_BANDS)
    const cx = vr.x + vr.w / 2
    const cy = vr.y + vr.h / 2
    const tint = bl.tint
    for (let i = 0; i < FOG_BANDS; i++) {
      const k = (i + 0.5) / FOG_BANDS
      // 内圈几乎为 0（近处是清的）→ 外圈最浊。
      // ⚠️ 用 `k^1.6` 而**不是** `k^2`：平方在 `rIn` 附近的斜率太小、在外圈又太大，
      //    结果是一条可见的硬边 + 外圈糊成一片。幂 1.6 两头都平。
      const a = FOG_ALPHA * Math.pow(k, 1.6)
      this.gAtmo.line(tint, a, band + 2)
      this.gAtmo.strokeCircle(cx, cy, rIn + band * (i + 0.5))
    }
  }

  /**
   * **玩家探照灯**（V6.51 §4.7，L2 起）。
   *
   * 它是「我能看见」的**因果来源**：没有它，深水就是"环境本身很亮"；
   * 有了它才是"**我在**照亮环境"。
   *
   * 半径随带收缩（168 → 132）：越深越聚焦 —— 这不是物理，是**叙事**
   * （光够不到那么远了）。淡入走 `depthM` **连续插值**而不是带的索引：
   * 带是离散的，用索引一定会有台阶（L1 是白天不需要灯，L2 起逐渐登场）。
   *
   * ⚠️ **每个圆用同一个 alpha 由外向内叠**，而不是"每档算一个 alpha"：
   *   前者每个像素被覆盖的次数 = 它到中心之间有几层 ⇒ alpha 平滑爬升；
   *   后者会在深底上显出一圈圈**靶环**（`tools/preview_lights.py` 的合成图里当场看见，
   *   5 档 alpha 之间的 0.045 台阶肉眼可辨）。这条与 `drawFog` 的环带**相反** ——
   *   雾要空心的中心（近处不挡），灯要实心的中心（近处最亮）。
   *
   * ⚠️ 与 V6.42 删掉的「主界面探照锥」**不是一回事**：那个是装饰性锥形，
   *   这个是功能性的同心光晕 —— 语义与位置都不同，不是复活旧设计。
   */
  private drawLamp(w: DiveWorld): void {
    const k = clamp1((w.depthM - LAMP_D0) / (LAMP_D1 - LAMP_D0), 0, 1)
    if (k <= 0.01) return                            // L1 是白天：不需要灯
    const z = this.zoom > 0 ? this.zoom : 1
    const R = (LAMP_R - LAMP_STEP * w.layerIdx) / z
    const bands = ATMO_QUALITY >= 2 ? LAMP_BANDS : (ATMO_QUALITY >= 1 ? 6 : 4)
    const a = LAMP_ALPHA * k
    // **每层同一个 alpha**，靠"被覆盖几次"爬升 —— 硬边只能来自半径突变，不能来自 alpha。
    // 半径走 `^LAMP_POW`（内层密）⇒ 亮斑自然收在中心，不需要额外的亮芯层。
    for (let i = 0; i < bands; i++) {
      const edge = i < LAMP_EDGE_N ? LAMP_EDGE_RAMP[i] : 1
      this.gAtmo.fill(LAMP_COLOR, a * edge)
      this.gAtmo.fillCircle(w.px, w.py, R * Math.pow(1 - i / bands, LAMP_POW))
    }
  }

  /**
   * **按带互斥的「光的主角」**（V6.51 §4.2–§4.5）。
   *
   * 关键：这四组**同一时刻只开一组** —— 这正是图元预算守得住的原因
   * 关键：这四组**同一时刻只开一组** —— 这正是图元预算守得住的原因。
   * ⚠️ L1/L2 已**不再画光柱**（V6.65）：阳光由 env 位图承载，矢量层做不出体积光。
   */
  private drawLayerLights(w: DiveWorld, idx: number, dt: number): void {
    if (ATMO_QUALITY === 0) return
    switch (idx) {
      // ⚠️ L1/L2 的光柱**已移除**（V6.65）—— 光的表现下放到 env 背景图。
      //   矢量层做不出体积光（无渐变/无模糊），三轮尝试都判失败。
      //   保留 case 0/1 的空分支是为了不动"按带互斥"的预算结构。
      case 0:
      case 1: break
      case 2: this.drawFluo(w, dt); break
      case 3: this.drawVents(dt); break
      case 4: this.drawDots(w); break
    }
  }

  /**
   * **生物荧光群**（§4.3，仅 L3）。
   *
   * L3 的光的主角。**不是"更亮的点"，是"会呼吸的链"** —— 3–7 个点串成一串，
   * 成串缓慢下沉 + 摆动。整屏一个色会读作"贴图重复"，故 20% 用青绿。
   *
   * ⚠️ 每串**独立相位**：同步会读作"整屏在脉动"（那是 bug）。
   *   （§4.5 的深渊点阵**相反** —— 那里要的就是全场同步。）
   * ⚠️ 不给每个点画光晕环，靠 alpha 呼吸表达 —— 省 36 个图元。
   */
  private drawFluo(w: DiveWorld, dt: number): void {
    for (const c of this.fluo) {
      c.y += 11 * dt                                        // 缓慢下沉
      c.x += Math.sin(w.t * 0.7 + c.ph) * 7 * dt            // 横向微摆（像水里的悬浮物）
      if (c.y > this.H + 30) { c.y = -30; c.x = Math.random() * this.W }
      const breathe = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(w.t * 1.7 + c.ph))
      const hue = c.warm ? FLUO_COLOR2 : FLUO_COLOR
      for (const p of c.pts) {
        this.gAtmo.fill(hue, breathe * 0.85)
        this.gAtmo.fillCircle(c.x + p.dx, c.y + p.dy, 2.2)
      }
    }
  }

  /**
   * **热泉烟柱**（§4.4，仅 L4）。
   *
   * **全场最暖、最亮的地方** —— 深渊题材里最反直觉的视觉反转点（L4 比 L3 亮）。
   * 每条 = 4 段逐渐放大 + 变淡的椭圆（模拟扩散）。
   *
   * ⚠️ 与 V6.50 的"热泉反向颗粒"**配套**：**烟柱向上 + 颗粒被顶住**，
   *   两者叠起来才是 `ventPush 190` 的完整视觉证据（机制与视觉说同一句话）。
   * ⚠️ 底部热源辉光**只画一份**（3 环），不是每条一份 —— 图元预算（§8.1）。
   */
  private drawVents(dt: number): void {
    for (const v of this.vents) {
      // 热流向上、且比海雪更快更浊（颗粒被顶住，烟柱照冲）
      v.y -= 62 * dt
      if (v.y < -80) { v.y = this.H + 80; v.x = Math.random() * this.W }
      // ⚠️ **段间距必须小于椭圆自身高度**，否则 4 段读作 4 个独立的橙色飞碟
      //   （`preview_lights.py` 的第一版就是这个症状：间距 2.6w vs 半高 0.25w）。
      //   收紧到 0.55w + 加高椭圆 ⇒ 4 段互相吃到，才连成一根**柱**。
      for (let i = 0; i < 4; i++) {
        const k = i / 3
        const yy = v.y - k * v.w * 0.55
        const rr = v.w * (0.52 + k * 0.95)
        this.gAtmo.fill(i < 2 ? VENT_HOT : VENT_EDGE, 0.15 - 0.11 * k)
        this.gAtmo.fillEllipse(v.x + Math.sin(v.ph + k * 2.1) * 7, yy, rr, rr * 0.72)
      }
    }
    if (ATMO_QUALITY >= 1) {
      const gy = this.H - 20
      for (let i = 0; i < 3; i++) {
        this.gAtmo.fill(VENT_HOT, 0.09 - i * 0.025)
        this.gAtmo.fillEllipse(this.W / 2, gy + i * 16, 380 - i * 100, 26 - i * 6)
      }
    }
  }

  /**
   * **深渊呼吸点阵**（§4.5，仅 L5）。
   *
   * L5 的光的主角。**全场点阵同步明灭**（周期 3.2s）。周期与主循环 14.4s、
   * 与荧光链的呼吸都取**非整数比** ⇒ 四种周期永远错开，读作
   * "底下有个巨大的东西在缓缓动着"，而不是"画面在闪"。
   * ⚠️ 点阵**避开中央** `DOTS_SAFE_R`：那是战斗区，不该有东西干扰可读性。
   */
  private drawDots(w: DiveWorld): void {
    const pulse = 0.5 + 0.5 * Math.sin((w.t / DOTS_PERIOD) * Math.PI * 2)
    const base = 0.10 + 0.55 * pulse
    for (const d of this.dots) {
      const a = base * (0.7 + 0.3 * Math.sin(w.t * 1.3 + d.ph))
      // 20% 的颗给 3 环渐隐光晕 —— 制造"那个大的东西就在那里"的错觉（成本 3 图元/个）
      if (d.halo && ATMO_QUALITY >= 1) {
        for (let i = 3; i >= 1; i--) {
          this.gAtmo.fill(UI.cyanHi, a * 0.10 * i)
          this.gAtmo.fillCircle(d.x, d.y, d.r + i * 3.2)
        }
      }
      this.gAtmo.fill(UI.cyanHi, a)
      this.gAtmo.fillCircle(d.x, d.y, d.r)
    }
  }

  /**
   * **水压环**（V6.52 §3.4）：换带时从屏幕中心外扩 3 圈，0.9s。
   *
   * 它是"下潜这件事有重量"的体感补充 —— 扫带说的是"我在穿过一层水"，
   * 水压环说的是"**这一层比上一层更压**"。共用 `xfadeT` 计时（同一时刻起），
   * 所以不需要第二个计时器；0.9s 之后自然不再画。
   */
  private drawPressureRings(): void {
    if (this.ringT < 0) return
    const k = this.ringT / RING_DUR
    // 强度只调 alpha，不调半径：换波与换带的环大小差 9% 肉眼看不出来，
    // 但 alpha 差 45% 一眼可辨 —— **对比度要花在能被感知的量上**。
    const a = 0.42 * this.ringStr * (1 - k)
    for (let i = 0; i < 3; i++) {
      const kk = k - i * 0.12
      if (kk <= 0) continue
      const rr = 120 + kk * 520
      this.gAtmo.line(UI.cyanHi, a, 2.5)
      this.gAtmo.strokeEllipse(this.W / 2, this.H / 2, rr, rr)
    }
  }

  /**
   * **温跃层扫带**（V6.52 §3.3 ②）。换带时一条横向波纹带**从下往上**扫过屏幕。
   *
   * 为什么非有不可：crossfade 单独用读作"图片在化开"，那是**过渡**不是**运动**。
   * 屏幕上有一样东西**真的在位移**，玩家才读得出"我在动"（用户原话："不是坐电梯"）。
   * 扫带 = 温跃层，是下潜这件事在物理上真实存在的界面。
   *
   * 三个图元（§3.3 原文"3 图元"）：① 亮而细的头线（正在扫过的那个面）
   * ② 它下方的过渡带 ③ 更淡的余晖（刚扫过的水还没静下来）。
   * 分段 + 正弦偏移 = 波纹（`fillRect` 画不出曲线，用 26 段折出来）。
   *
   * ⛔ **不做全屏闪白**（§3.4）：深海里一次全白会瞬间毁掉"暗"的基调。
   */
  private drawScanBand(w: DiveWorld): void {
    if (this.scanT < 0) return
    const k = this.scanT / SCAN_DUR          // 0→1
    const y = this.H * (1 - k)               // 底 → 顶
    const a = 1 - k                          // 尾段自然收掉
    const seg = 26
    const sw = this.W / seg + 1
    for (let i = 0; i < seg; i++) {
      const yy = y + Math.sin(i * 0.85 + w.t * 5) * 6
      this.gAtmo.fill(UI.cyanHi, 0.34 * a)
      this.gAtmo.fillRect(i * sw, yy - 2, sw, 3)      // ① 头线
      this.gAtmo.fill(UI.cyan, 0.13 * a)
      this.gAtmo.fillRect(i * sw, yy + 1, sw, 14)     // ② 过渡带
      this.gAtmo.fill(UI.cyanDim, 0.09 * a)
      this.gAtmo.fillRect(i * sw, yy - 26, sw, 22)    // ③ 余晖
    }
  }

  /**
   * 按当前带**整批重建**光照层的五个元素（V6.53 的 `buildSchools` 升级，V6.59）。
   *
   * 为什么不增量调整：换带时**连种类与尺寸都变了**（L1 是 46 条小鱼，
   * L5 是 1–2 条巨影 + 呼吸点阵），逐条改属性反而更绕。整批重建 + 渐入，
   * 读起来就是"换了一片水域"。
   *
   * ⚠️ 渐入是必须的：换带瞬间几十条鱼 / 几十个光点"啪"地出现会读作 bug
   *    （用户在意的正是"丝滑"）。
   * ⚠️ 五个元素**共用 `atmoLayer` 一个"已构建"标记** —— 分开各记一个迟早会出现
   *    "鱼群换了、光柱没换"的半新半旧状态（那种错不报错、只是看着别扭）。
   */
  private buildAtmo(layerIdx: number): void {
    this.atmoLayer = layerIdx
    this.buildSchools(layerIdx)
    this.buildFluo(layerIdx)
    this.buildVents(layerIdx)
    this.buildDots(layerIdx)
  }

  /** 远景鱼群（V6.53）。按带整批重建，`fade` 渐入 */
  private buildSchools(layerIdx: number): void {
    const eco = LAYER_ECO[layerIdx]
    const [aLo, aHi] = ATM_FISH_ALPHA[layerIdx] ?? [0.28, 0.48]
    this.schools.length = 0

    // 巨影（深渊）要慢：体型越大越慢，否则读作"一条大鱼在冲刺"
    const big = eco.schoolSize > 2
    // ⚠️ **必须成团，不能均匀撒满**（2026-10-14）：旧版 `x`/`y` 各自独立随机
    //    ⇒ 屏幕上是一层**均匀的点**，读作"雪花 / 星星 / 屏幕脏了"，**不是鱼群**。
    //    真实的鱼群是"几团密集 + 大片空白"。**同样 46 条鱼，成团之后才第一次
    //    读得出"一群鱼"** —— 用户报的"背景的白色"有一半是这一条（另一半是漏 clear）。
    const perCluster = big ? 1 : 6
    const clusters = Math.max(1, Math.round(eco.school / perCluster))
    const spread = 62

    for (let c = 0; c < clusters; c++) {
      // 团心留 40px 边距：整团贴在屏幕边上会读作"被裁掉了"
      const cx0 = 40 + Math.random() * (this.W - 80)
      const cy0 = 40 + Math.random() * (this.H - 80)
      // **同团同向**：一群鱼朝同一个方向游才叫群；每条各自随机 = 一锅乱炖
      const dir = Math.random() < 0.5 ? -1 : 1
      // **同团同速**（±12% 抖动）：速度差太大会把团拉成长条，几秒后就散掉
      const spd = big ? 6 + Math.random() * 6 : 12 + Math.random() * 20
      const size0 = 26 * eco.schoolSize

      for (let i = 0; i < perCluster; i++) {
        // 三角分布（两次均匀求和）≈ 团心密、边缘疏 —— 这**就是**"群"的形状
        const gx = (Math.random() + Math.random() - 1) * spread
        const gy = (Math.random() + Math.random() - 1) * spread * 0.7
        this.schools.push({
          x: cx0 + gx,
          y: cy0 + gy,
          vx: dir * spd * (0.88 + Math.random() * 0.24),
          size: size0 * (0.78 + Math.random() * 0.44),
          phase: Math.random() * Math.PI * 2,
          fade: 0,
          // 区间随带变化（剪影要"实"、荧光要"稳"，见 ATM_FISH_ALPHA）
          alpha: aLo + Math.random() * (aHi - aLo),
        })
      }
    }
  }

  /** 生物荧光链（§4.3）：**仅 L3**。3–7 个点串成一串，20% 用青绿副色 */
  private buildFluo(layerIdx: number): void {
    this.fluo.length = 0
    if (layerIdx !== 2) return
    for (let c = 0; c < FLUO_CHAINS; c++) {
      const n = 3 + Math.floor(Math.random() * 5)
      const dir = Math.random() < 0.5 ? -1 : 1
      const pts: Array<{ dx: number; dy: number }> = []
      for (let i = 0; i < n; i++) {
        // 间距 8–18px 并在纵向抖一点 —— 一条笔直的线读作"栅栏"，不是"链"
        pts.push({
          dx: dir * i * (8 + Math.random() * 10),
          dy: (Math.random() - 0.5) * 22,
        })
      }
      this.fluo.push({
        x: Math.random() * this.W,
        y: Math.random() * this.H,
        pts,
        ph: Math.random() * Math.PI * 2,
        warm: Math.random() < 0.2,
      })
    }
  }

  /** 热泉烟柱（§4.4）：**仅 L4**。宽 30–90px（要有宽窄差） */
  private buildVents(layerIdx: number): void {
    this.vents.length = 0
    if (layerIdx !== 3) return
    for (let i = 0; i < VENT_N; i++) {
      this.vents.push({
        x: this.W * ((i + 0.5 + (Math.random() - 0.5) * 0.6) / VENT_N),
        y: Math.random() * this.H,
        w: 30 + Math.random() * 60,
        ph: Math.random() * Math.PI * 2,
      })
    }
  }

  /**
   * 深渊呼吸点阵（§4.5）：**仅 L5**。
   * ⚠️ 必须避开中央战斗区（`DOTS_SAFE_R`）—— 拒绝采样最多试 8 次，兜底换到外圈。
   */
  private buildDots(layerIdx: number): void {
    this.dots.length = 0
    if (layerIdx !== 4) return
    const cx = this.W / 2, cy = this.H / 2
    for (let i = 0; i < DOTS_N; i++) {
      let x = 0, y = 0, ok = false
      for (let t = 0; t < 8; t++) {
        x = Math.random() * this.W
        y = Math.random() * this.H
        if (Math.hypot(x - cx, y - cy) > DOTS_SAFE_R) { ok = true; break }
      }
      if (!ok) {
        const a = Math.random() * Math.PI * 2
        x = cx + Math.cos(a) * (DOTS_SAFE_R + 40)
        y = cy + Math.sin(a) * (DOTS_SAFE_R + 40)
      }
      this.dots.push({
        x, y,
        r: 1.4 + Math.random() * 1.4,
        ph: Math.random() * Math.PI * 2,
        halo: Math.random() < 0.2,
      })
    }
  }

  private drawWorld(w: DiveWorld): void {
    // ---- 酸液云（地面持续伤害区）----
    for (const a of w.acids) {
      this.gBack.fill(0x7fffd4, 0.10); this.gBack.fillCircle(a.x, a.y, a.r)
      this.gBack.line(0xc4fff0, 0.35, 1); this.gBack.strokeCircle(a.x, a.y, a.r)
    }

    // ---- 气泡雷（V6.46 陷阱族）----
    // ⚠️ **布防态与已激活态必须一眼可分** —— 玩家要靠它判断"现在踩上去会不会炸"
    //    （布防中 0.4s 不炸，是"不炸自己脚"的机制保证）。所以未激活画暗壳 + 虚线圈，
    //    激活后画亮球 + 呼吸光环。只用一个状态画，玩家永远在猜。
    for (const m of w.mines) {
      if (!m.alive) continue
      const armed = m.arm <= 0
      if (!armed) {
        // 布防中：暗壳 + 8 段虚线圈（半径按爆炸半径画 —— 那是"待会儿这里会炸多大"）
        this.gBack.fill(0x14232f, 0.8); this.gBack.fillCircle(m.x, m.y, 8)
        this.gBack.line(0x4a7c91, 0.55, 1)
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2
          this.gBack.arc(m.x, m.y, m.r, a0, a0 + 0.34).stroke()
        }
      } else {
        // ---- 已激活（V6.62 定时引信）----
        // ⚠️ **倒计时是定时雷区别于踩触发的全部可读性来源**：踩触发靠"敌人靠近"传达，
        //    定时靠"自己的心跳"传达。所以闪频必须**越接近越急** —— 玩家用余光就能读时钟。
        const k = clamp1(m.fuse / m.fuseMax, 0, 1)          // 1 = 刚布下 → 0 = 就要爆
        // 闪周期 0.50s → 0.08s：越接近越急（12 倍频差，一眼可辨）
        const period = 0.08 + 0.42 * k
        const beat = 0.5 + 0.5 * Math.sin(w.t * (Math.PI * 2 / period))
        // 颜色三档：氧青（安全）→ 琥珀（过半）→ 危险红（临爆）
        const col = k > 0.5 ? UI.cyanHi : (k > 0.2 ? UI.amber : UI.danger)
        // 爆炸范围圈：**画出来玩家才敢去预判** —— "算好它 1.8 秒后游到哪"要有边界可参照
        this.gBack.line(col, 0.12 + 0.10 * beat, 1)
        this.gBack.strokeCircle(m.x, m.y, m.r)
        // 本体：三层同心 + 呼吸（呼吸幅度随倒计时增大 ⇒ 越接近越"鼓"）
        const swell = 1 + (1 - k) * 0.5
        this.gBack.fill(col, (0.14 + 0.10 * beat) * swell)
        this.gBack.fillCircle(m.x, m.y, 14 + beat * 2 + (1 - k) * 6)
        this.gBack.fill(col, 0.52 + 0.30 * beat * (1 - k)); this.gBack.fillCircle(m.x, m.y, 8.5)
        this.gBack.line(col, 0.24 + 0.16 * beat, 1.5)
        this.gBack.strokeCircle(m.x, m.y, 15 + beat * 4)
        this.gBack.fill(0xffffff, 0.85); this.gBack.fillCircle(m.x - 3, m.y - 3, 2.4)
        // 连锁雷：把射程内的伙伴连起来 —— "它们是一串"必须画出来，
        // 否则玩家只看到一排独立的雷，连锁炸开时会莫名其妙。
        if (m.chainR > 0) {
          this.gBack.line(UI.cyanHi, 0.3, 1.2)
          for (const o of w.mines) {
            if (o === m || !o.alive || o.arm > 0) continue
            if (Math.hypot(o.x - m.x, o.y - m.y) <= m.chainR) this.gBack.strokeSeg(m.x, m.y, o.x, o.y)
          }
        }
      }
    }

    // ---- 生物光诱饵（V6.46 聚怪族）----
    for (const l of w.lures) {
      if (!l.alive) continue
      // 最后 0.6s 淡出：诱饵是"会消失的东西"，不能等它啪一下不见（那读作 bug）
      const fade = Math.min(1, l.life / 0.6)
      const breathe = 0.5 + 0.5 * Math.sin(w.t * 2.2 + l.x * 0.01)
      // ① 吸引范围：16 段虚线圈。**必须画** —— 玩家要知道"怪会往哪跑"，
      //    不画的话这把武器就变成"扔个球，看不出效果"
      this.gBack.line(UI.amber, 0.17 * fade, 1)
      for (let k = 0; k < 16; k++) {
        const a0 = (k / 16) * Math.PI * 2
        this.gBack.arc(l.x, l.y, l.r, a0, a0 + 0.2).stroke()
      }
      // ② 光球：三层同心 + 呼吸
      this.gBack.fill(UI.amber, (0.09 + 0.07 * breathe) * fade); this.gBack.fillCircle(l.x, l.y, 32)
      this.gBack.fill(UI.amber, (0.28 + 0.12 * breathe) * fade); this.gBack.fillCircle(l.x, l.y, 15)
      this.gBack.fill(0xfff4d0, 0.88 * fade); this.gBack.fillCircle(l.x, l.y, 5.5)
      // ③ 触须 ×6：长度与角度都带摆动 —— 「生物光」必须有生物感，
      //    纯光球会读作"一个灯泡"，加触须才有"活的东西在发光"
      this.gBack.line(UI.amber, 0.42 * fade, 1.4)
      for (let k = 0; k < 6; k++) {
        const a0 = (k / 6) * Math.PI * 2 + Math.sin(w.t * 1.4 + k * 1.1) * 0.13
        const r1 = 15 + 22 + 11 * Math.sin(w.t * 2.4 + k * 1.7)
        this.gBack.strokeSeg(l.x + Math.cos(a0) * 15, l.y + Math.sin(a0) * 15,
          l.x + Math.cos(a0) * r1, l.y + Math.sin(a0) * r1)
      }
    }

    // ---- 鱼骨（击杀掉落 · 氧气 + 骨币）----
    // 旧版是「一个白点 + 一根斜线」：在暗海里既读不出"这是个能捡的东西"，更读不出是"鱼骨"。
    // 重画成**真鱼骨**（脊柱 + 4 对肋骨），整体吃 `b.rot` ——
    //   模拟层一直在积 `spin` 做自旋，旧渲染层**根本没接**（白算），接上后"漂着的碎骨"才活。
    // 外面罩氧青 + 骨白辉光（圈数见 `BONE_GLOW`）：它是本作**唯一可拾取的东西**，
    //   "会发光 = 能捡"是玩家唯一能依赖的读法 —— 光晕不是装饰，是功能。
    for (const b of w.bones) {
      const s = b.size * 0.5
      const blinking = b.fade < 0.35 && Math.sin(b.fade * 30) > 0
      const al = blinking ? 0.35 : 1
      const ca = Math.cos(b.rot), sa = Math.sin(b.rot)
      // ① 辉光：氧青（外层）→ 骨白（内层）
      //    ⚠️ **辉光是功能不是装饰** —— "会发光 = 能捡"是本作唯一可拾取物给玩家的读法。
      //    所以省图元的做法只能是**合并同心圆**，不能是"删掉辉光"。
      //    实测（V6.48 压测）：三圈 50 块骨 = **150 图元/帧**，是红线帧里仅次于敌人的单项。
      //    最外圈（0.10 alpha、1.30× 半径）在暗海里几乎不可辨，它的全部作用是把中圈边界"化开" ——
      //    把中圈 alpha 从 0.16 提到 **0.20** 就能补上同样的观感。
      //    ⇒ 2 圈（省 50 图元/帧）。改 `BONE_GLOW` 为 1 可再省 50，代价是辉光更硬、边界更清楚。
      if (BONE_GLOW >= 3) {
        this.gBack.fill(0x4fe8ff, 0.10 * al); this.gBack.fillCircle(b.x, b.y, s * 1.30)
      }
      this.gBack.fill(0x4fe8ff, (BONE_GLOW >= 3 ? 0.16 : 0.20) * al); this.gBack.fillCircle(b.x, b.y, s * 1.02)
      this.gBack.fill(BONE, 0.14 * al); this.gBack.fillCircle(b.x, b.y, s * 0.78)
      // ② 脊柱（贯穿全身）
      this.gBack.line(BONE, 0.95 * al, Math.max(1.2, s * 0.16))
      this.gBack.strokeSeg(b.x - s * ca, b.y - s * sa, b.x + s * ca, b.y + s * sa)
      // ③ 肋骨 ×4：`|k-1.5|` 让中间两根最长、两端收 —— 剪影才读作"鱼骨"而不是"梯子"
      this.gBack.line(BONE, 0.80 * al, Math.max(1, s * 0.11))
      for (let k = 0; k < 4; k++) {
        const lx = (-0.55 + k * 0.32) * s
        const len = (0.62 - Math.abs(k - 1.5) * 0.12) * s
        this.gBack.strokeSeg(b.x + lx * ca - len * sa, b.y + lx * sa + len * ca,
          b.x + lx * ca + len * sa, b.y + lx * sa - len * ca)
      }
      // ④ 头端亮核：给鱼骨一个"头"，扫视时视线先落在这里
      this.gBack.fill(0xffffff, 0.95 * al)
      this.gBack.fillCircle(b.x + s * 0.92 * ca, b.y + s * 0.92 * sa, Math.max(1.6, s * 0.18))
    }

    // ---- 声呐波前 ----
    for (const p of w.pulses) {
      if (!p.alive) continue
      this.gBack.line(0x4fe8ff, 0.16, 7); this.gBack.strokeCircle(p.x, p.y, p.r)
      this.gBack.line(0xc8f8ff, 0.55, 1.6); this.gBack.strokeCircle(p.x, p.y, p.r)
    }

    // ---- 回声标记 ----
    for (const e of w.echoes) {
      const k = 1 - Math.max(0, e.t / 0.75)
      this.gBack.line(0xff4fd8, 0.75, 2); this.gBack.strokeCircle(e.x, e.y, Math.max(1, 130 * k))
      this.gBack.fill(0xff4fd8, 0.9); this.gBack.fillCircle(e.x, e.y, 4)
    }

    // ---- 爆炸环 ----
    for (const b of this.blasts) {
      const k = 1 - Math.max(0, b.life / 0.32)
      this.gBack.line(0xffd166, 0.7 * (1 - k), 3); this.gBack.strokeCircle(b.x, b.y, b.r * k)
    }

    this.drawEnemies(w)

    // ---- 子弹（三段式；见 docs/美术资源计划.md §15.4）----
    // 旧版是"一条单色线 + 一个白点"，在满屏特效里完全没有存在感。重写成：
    //   ① 多层递减拖尾 —— 速度感来自**长度梯度**，不是长度本身
    //   ② 外发光晕     —— 双层同色大半径圆，保证深色层也发光
    //   ③ 亮核 + 本色环 —— 弹头必须是全屏最亮的东西之一
    // 鱼雷/鱼叉额外画**弹体轮廓**（尖头 + 圆柱身 + 尾翼），尾迹改**气泡**
    // （水里跑的不是焰火）。
    for (const b of w.bullets) {
      if (!b.alive) continue
      const sp = Math.max(1, Math.hypot(b.vx, b.vy))
      const ux = b.vx / sp, uy = b.vy / sp
      const px2 = -uy, py2 = ux          // 垂直弹道方向（画弹体宽度用）

      if (b.kind === 'gun') {
        const c = UI.amber
        // ① 四层递减拖尾
        for (let i = 0; i < 4; i++) {
          const L0 = 10 + i * 7, L1 = L0 + 8
          neonLine(this.gEnt,
            b.x - ux * L0, b.y - uy * L0, b.x - ux * L1, b.y - uy * L1,
            c, { width: 3.4 - i * 0.7, alpha: 0.9 / (i + 1.4), bloom: false })
        }
        // ② 外发光晕（两层同心低透明圆）
        this.gEnt.fill(c, 0.22); this.gEnt.fillCircle(b.x, b.y, 6.5)
        this.gEnt.fill(c, 0.40); this.gEnt.fillCircle(b.x, b.y, 3.6)
        // ③ 亮核 + 本色环
        neonCircle(this.gEnt, b.x, b.y, 2.6, c, { width: 1.6, alpha: 0.9, bloom: false })
        this.gEnt.fill(0xffffff, 1); this.gEnt.fillCircle(b.x, b.y, 1.7)
      } else if (b.kind === 'net') {
        // 网（V6.46）：飞行中是**收拢的网束**（3 道横索 + 收口目），
        // 张开那一瞬由 `openNet` 抛的 `burst` 事件接管（渲染层画扩张环）。
        // ⚠️ 收拢态不能画成"一个大网" —— 那会让玩家以为它在飞行途中就有判定范围。
        const c = b.net === 'net_el' ? UI.violet : b.net === 'net_cv' ? UI.cyanHi : UI.jade
        // ① 三道横索（越前越亮 = 有方向感）
        for (let i = 0; i < 3; i++) {
          const d = i * 5 - 5
          this.gEnt.line(c, 0.72 - i * 0.18, 1.5)
          this.gEnt.strokeSeg(b.x + ux * d + px2 * 5.5, b.y + uy * d + py2 * 5.5,
            b.x + ux * d - px2 * 5.5, b.y + uy * d - py2 * 5.5)
        }
        // ② 收口网目（两条斜索收向头部）
        this.gEnt.line(c, 0.45, 1)
        for (const sgn of [-1, 1]) {
          this.gEnt.strokeSeg(b.x + ux * 4 + px2 * sgn * 5.5, b.y + uy * 4 + py2 * sgn * 5.5,
            b.x - ux * 10, b.y - uy * 10)
        }
        // ③ 拖尾绳
        this.gEnt.line(c, 0.26, 1.2)
        this.gEnt.strokeSeg(b.x - ux * 8, b.y - uy * 8, b.x - ux * 22, b.y - uy * 22)
        this.gEnt.fill(0xffffff, 0.9); this.gEnt.fillCircle(b.x + ux * 4, b.y + uy * 4, 2)
      } else {
        // 鱼叉走同一套弹体轮廓，只是配色偏玉（jade）；鱼叉更快更细，观感对得上
        const c = b.kind === 'harpoon' ? UI.jade : UI.danger
        // ① 气泡尾迹：横向正弦摆动，越往后越淡越小
        for (let i = 1; i <= 5; i++) {
          const bx = b.x - ux * i * 7, by = b.y - uy * i * 7
          const wob = Math.sin(this.fxT * 9 + i * 1.7) * (1.6 + i * 0.5)
          this.gEnt.fill(c, 0.5 / i)
          this.gEnt.fillCircle(bx + px2 * wob, by + py2 * wob, 3.2 - i * 0.42)
        }
        // ② 外发光晕
        this.gEnt.fill(c, 0.20); this.gEnt.fillCircle(b.x, b.y, 9)
        // ③ 弹体轮廓（沿弹道的局部坐标）：尖头 → 身尾 → 尾翼 → 身尾，收口
        const Nose = 7, Tail = 8, Half = 3.4
        const body = () => {
          this.gEnt.moveTo(b.x + ux * Nose, b.y + uy * Nose)                              // 弹头尖
          this.gEnt.lineTo(b.x - ux * Tail + px2 * Half, b.y - uy * Tail + py2 * Half)    // 身尾·右
          this.gEnt.lineTo(b.x - ux * (Tail + 3) + px2 * (Half + 2.6),
            b.y - uy * (Tail + 3) + py2 * (Half + 2.6))                                   // 尾翼·右
          this.gEnt.lineTo(b.x - ux * (Tail + 3) - px2 * (Half + 2.6),
            b.y - uy * (Tail + 3) - py2 * (Half + 2.6))                                   // 尾翼·左
          this.gEnt.lineTo(b.x - ux * Tail - px2 * Half, b.y - uy * Tail - py2 * Half)    // 身尾·左
          this.gEnt.close()
        }
        // 描边 ← 注意 `neon` 会连画两层，每层都必须**重新组一遍路径**
        neon(this.gEnt, c, () => { body(); this.gEnt.stroke() },
          { width: 1.8, alpha: 1, bloom: false })
        // 弹体填色（暗色实心，让它有"实体"而不是线框）
        this.gEnt.fill(c, 0.55); body(); this.gEnt.fillPath()
        // ④ 头部亮点
        this.gEnt.fill(0xffffff, 1); this.gEnt.fillCircle(b.x + ux * 4, b.y + uy * 4, 2.3)
      }
    }

    this.drawPlayer(w)
  }

  /**
   * 敌人。分工与 web 一致：**贴图负责"具体形象"，2px 发光核心负责"可读性"**。
   * 核心必须有一条在贴图之上 —— 那是"每条鱼都能被定位"的铁律，远距离只剩一个点时靠它。
   */
  private drawEnemies(w: DiveWorld): void {
    this.hideFish()
    this.flashMarks.length = 0        // 本帧重新登记（上一帧的已由 drawFx 消费掉）
    const n = w.enemies.length
    const lod = n > 80 ? 2 : n > 40 ? 1 : 0
    // ⚠️ 判据用 `layerIdx` 而**不是** `vis < 0.5`：`vis` 是"能见度"（V6.51 §2.3 已整体抬高），
    //    拿它当"是不是深层"的代理，一改 `vis` 就会把 L3/L4 的可读性兜底悄悄关掉
    //    （**不报错、只能靠肉眼发现**）。深层 = L3/L4/L5 是设计事实，直接写索引。
    const darkLayer = w.layerIdx >= 2

    for (const e of w.enemies) {
      if (!e.alive) continue
      // ⚠️ 鮟鱇女王的 `charge` 是**亮诱饵**（诱捕的诱），不是守望者的"蓄力砸地"（危险的兆）。
      //    两者共用 `charge` 这个名字只是复用相位机，**表现必须分开**：
      //    守望者蓄力 → 危险红（该躲了）；鮟鱇张口 → 诱饵亮（该忍住了）。
      const charging = (e.kind === 'dash' && e.phase === 'charge')
        || (e.kind === 'boss' && e.bossKind !== 'angler' && e.phase === 'charge')
      // ⚠️ 本地变量不要叫 `col` —— 会遮蔽从 Gfx 导入的同名颜色构造函数。
      const body = charging ? UI.danger : (e.flash > 0 ? 0xffffff : e.color)

      // ---- 侧视朝向（V6.52 §2.1，2026-10-14）----
      // 贴图（`fish/swarm.png`、`fish/dash.png`）本身就是**侧视画法、头朝左**。
      // 旧写法 `angle = -((atan2(玩家-敌) - texRot) × 180/π)` 是**俯视语义** ——
      //   它把贴图对着玩家整圈旋转，于是从正上/正下方游来的敌人被转 90°，
      //   屏幕上就是"一条头朝下的鱼"。这就是用户说的「体感奇怪」的直接来源。
      // 侧视只给两个自由度：**左右镜像** + **±35° 仰俯**（`SIDE_TILT`）。
      // ⚠️ 镜像必须用 `scale.x = -1`，不能用旋转 180° —— 转 180° 会把鱼**肚皮朝上**。
      // ⚠️ 后续新增敌人的贴图**必须与 swarm/dash 同向（头朝左）**，否则镜像基准要改。
      //
      // ⚠️ **2026-10-14 修正数据源**：这段原先读 `e.vx / e.vy`，而那两个字段在模拟层
      //    **从不更新**（`mkEnemy` 归零之后再没人写过）⇒ `spd` 恒为 0 ⇒
      //    `flip` 恒为 1、`tilt` 恒为 0 ⇒ **屏幕上所有鱼水平朝左**。
      //    用户报的"鱼游的方向不对"就是这一条。改用 `e.fx / e.fy`
      //    （`updateEnemies` 每帧写入的朝向单位向量，见 types.ts `fx/fy`）。
      const fm = Math.hypot(e.fx, e.fy)
      let flip = 1
      let tilt = 0
      if (fm > 0.5) {
        const ux = e.fx / fm
        const uy = e.fy / fm                      // **sim 与屏幕同为 y 向下** ⇒ uy > 0 = 往下游
        flip = ux > 0 ? -1 : 1                    // 朝右游 ⇒ 水平镜像（贴图基准朝左）
        // 抬头的分量是 `-uy`；`|ux|` 让仰角恒落在右半平面 ⇒ 天然不翻滚
        //   （否则从正上/正下方来的敌人会被转 90°，又退回俯视语义）。
        const a = Math.atan2(-uy, Math.abs(ux) + 1e-4)
        tilt = Math.max(-SIDE_TILT, Math.min(SIDE_TILT, a))
      }
      // ⚠️ 闪白**绝不能**把贴图置空。曾经写成 `e.flash > 0 ? null : this.fishSprite(e)`，
      //    于是命中那一瞬间掉进下面的矢量兜底 → `fillTri` → 屏幕上变成一颗**白色实心三角**，
      //    既认不出是鱼、也读不出"打中了哪一条"。
      //    Cocos 的 Sprite 是乘色混合、没有 web 的 `setTintFill`（能把贴图烧成纯白剪影），
      //    但那不该以"换成三角"为代价 —— 现在与 web 的矢量路径同构：
      //    **鱼身照常留着，另外在它上面叠一层白色椭圆闪光**。
      const sp = this.fishSprite(e)

      if (sp) {
        sp.node.setPosition(e.x, this.H - e.y)
        sp.node.setScale(flip, 1, 1)              // 侧视镜像（贴图基准朝左）
        // ⚠️ 倾角**必须乘上 `flip`**：节点变换是 T·R·S（先缩放、后旋转），
        //    `scale.x = -1` 会把**旋转的视觉方向一并翻转** —— 同一个 angle 值，
        //    镜像前后"抬头 / 低头"正好相反。漏掉 `flip` 会出现
        //    "朝右游的鱼抬着头往水底扎"。
        //    基准：本项目约定 `node.angle = -θ°`（θ = sim 的 y 向下、顺时针为正的角，
        //    见本文件顶部坐标约定）⇒ **`node.angle` 正值 = 视觉逆时针**。
        sp.node.angle = (-flip * tilt * 180) / Math.PI   // 侧视仰俯（±35°，不翻滚）
        sp.color = col(0xffffff, charging ? 0.92 : 0.88)
        // 深层的可读性兜底：只留**描边环**（不填充）。
        // web 明确否掉了"暗色实心椭圆衬底"那版 —— 衬底比小鱼还大，把鱼盖成亮斑。
        if (darkLayer && lod < 2) {
          this.gEnt.line(charging ? UI.danger : e.color, 0.62, 1.4)
          // ⚠️ `Gfx.ellipse` 收的是**半轴**，而 web 的 `strokeEllipse` 收的是**直径** ——
          //    照抄 web 数值必须 ÷2。曾漏掉这一步，这个环一直比设计值大一倍。
          this.gEnt.strokeEllipse(e.x, e.y, (e.r * 2.05) / 2, (e.r * 1.5) / 2)
        }
      } else {
        // 矢量兜底（美术未就绪 / 太小 / 太多）—— 必须与贴图**同一套侧视语汇**，
        //   否则同屏 >120 条整体退回矢量时画风突变（贴图是斜着游的鱼、矢量是朝玩家的三角）。
        this.gEnt.fill(body, 0.95)
        if (e.kind === 'boss') this.gEnt.fillCircle(e.x, e.y, e.r)
        else if (e.kind === 'armor') {
          // ---- 重甲（V6.62）：**六边形装甲壳 + 中缝** ----
          // ⚠️ 必须与鱼的"三角"是**完全不同的轮廓语汇** —— 玩家要在开打之前就能一眼看出
          //    "这个不一样"。它抗弹、它不追你，这两件事都先从剪影读出来。
          const R = e.r * 1.18
          const hex = (fn: 'fill' | 'line') => {
            if (fn === 'fill') this.gEnt.fill(body, 0.92)
            else this.gEnt.line(0xffffff, 0.38, 1.2)
            for (let k = 0; k < 6; k++) {
              const a = 0.35 + (k / 6) * Math.PI * 2
              const px = e.x + Math.cos(a) * R, py = e.y + Math.sin(a) * R
              if (k === 0) this.gEnt.moveTo(px, py)
              else this.gEnt.lineTo(px, py)
            }
            this.gEnt.close()
            if (fn === 'fill') this.gEnt.fillPath()
            else this.gEnt.stroke()
          }
          hex('fill'); hex('line')
          // 装甲板接缝（横中缝）—— 有缝才读作"拼出来的壳"，无缝就只是一块多边形
          this.gEnt.line(0x0e1a24, 0.55, 1.6)
          this.gEnt.strokeSeg(e.x - R * 0.86, e.y, e.x + R * 0.86, e.y)
          // 航向刺（沿 dirX/dirY）—— 顺便告诉玩家"它往哪走"，因为它**不朝你**，
          // 光看不出来它要飘向哪。这一条是"不索敌"这个行为语汇的可见化。
          this.gEnt.line(body, 0.9, 2)
          this.gEnt.strokeSeg(e.x, e.y, e.x + e.fx * R * 1.5, e.y + e.fy * R * 1.5)
        } else {
          // 沿朝向、限幅 ±35°、朝左时反射到左半平面 —— 与贴图分支同一套侧视语汇。
          // ⚠️ `Gfx.tri` 的 `angRad` 收的是 **sim 角度**（y 向下、顺时针为正，
          //    见 Gfx.ang），所以这里直接喂 sim 分量，**不要**再手动取负。
          const ux = fm > 0.5 ? e.fx / fm : 1
          const uy = fm > 0.5 ? e.fy / fm : 0
          let va = Math.atan2(uy, Math.abs(ux) + 1e-4)
          va = Math.max(-SIDE_TILT, Math.min(SIDE_TILT, va))
          this.gEnt.fillTri(e.x, e.y, ux < 0 ? Math.PI - va : va, e.r * 1.25, e.r * 0.85)
        }
      }

      // 蓄力预警圈（V4 §3.4：致命预警必须醒目）
      if (charging && e.kind !== 'boss') {
        this.gEnt.line(UI.danger, 0.7, 2)
        this.gEnt.strokeCircle(e.x, e.y, e.r * 1.6)
      }

      // 发光核心：铁律，必须画在贴图之上
      this.gEnt.fill(body, 1)
      this.gEnt.fillCircle(e.x, e.y, 2)

      // ---- V6.46 控制状态标记 ----
      // 为什么要单独做这三个标记：控场型武器的**全部手感都在"我怎么知道它生效了"**。
      // 打伤害的武器不需要状态标记（掉血条自己在说），但网 / 诱饵 / 策反不改血量，
      // 没有标记时玩家的判断只能是"这条鱼好像慢了？" —— 那等于没做。
      // 三种状态用**三种不同的形状语汇**（弧环 / 闪烁圈 / 双箭环），不靠颜色区分：
      // 深海里颜色会被亮度压暗，形状不会。
      if (e.slowT > 0) {
        // 网住：断续弧环（6 段）+ 三条缠索。断续是"被缠住"而不是"套了个圈"的关键
        const rr = e.r * 1.52
        this.gEnt.line(UI.cyanHi, 0.62, 1.5)
        for (let k = 0; k < 6; k++) {
          const a0 = (k / 6) * Math.PI * 2 + w.t * 0.7
          this.gEnt.arc(e.x, e.y, rr, a0, a0 + 0.52).stroke()
        }
        this.gEnt.line(UI.cyanHi, 0.34, 1)
        for (let k = 0; k < 3; k++) {
          const a0 = (k / 3) * Math.PI * 2 - w.t * 0.7
          this.gEnt.strokeSeg(e.x + Math.cos(a0) * rr, e.y + Math.sin(a0) * rr,
            e.x + Math.cos(a0) * e.r * 0.55, e.y + Math.sin(a0) * e.r * 0.55)
        }
      }
      if (e.rootT > 0) {
        // ---- 定身（V6.62）----
        // 语汇必须与减速（上面的**断续**弧环）**一眼可分**：
        //   减速 = 被缠住、还能动 ⇒ 断续（松）；
        //   定身 = **完全不动** ⇒ 收紧的**实环** + 一道「禁止」斜杠。
        // ⚠️ 不靠颜色区分（深海会把亮度压掉），靠**形状**。
        const rr = e.r * 1.3
        this.gEnt.line(UI.cyanHi, 0.92, 2.2)
        this.gEnt.strokeCircle(e.x, e.y, rr)
        this.gEnt.line(UI.danger, 0.88, 2)
        this.gEnt.strokeSeg(e.x - rr * 0.72, e.y + rr * 0.72, e.x + rr * 0.72, e.y - rr * 0.72)
      }
      if (e.elite) {
        // ---- 精英（V6.62 §5-A）----
        // 脉冲光晕。**刻意复用鱼骨的"发光 = 值得"读法** —— 玩家不用学新符号就知道该先打它。
        const pulse = 0.5 + 0.5 * Math.sin(w.t * 3.4 + e.x * 0.01)
        this.gEnt.line(UI.amber, 0.40 + 0.36 * pulse, 2)
        this.gEnt.strokeCircle(e.x, e.y, e.r * 1.8 + pulse * 3.5)
      }
      // ---- 鮟鱇女王：诱饵灯（V6.62 §4.2）----
      // 它是"诱捕"这个压力的**唯一可见载体**：光在亮 = 它准备咬 = 你该往外游。
      // 平时只是微亮（"我在这"），张口期全亮 + 把**咬合半径**画出来（"退到哪才安全"）。
      if (e.kind === 'boss' && e.bossKind === 'angler') {
        const flaring = e.phase === 'charge'
        const k = flaring ? Math.min(1, e.t / 1.6) : 0          // 预警窗口进度 0→1
        const bright = flaring ? 0.55 + 0.45 * k : 0.20
        this.gEnt.fill(UI.amber, Math.min(1, 0.18 * bright * 2))
        this.gEnt.fillCircle(e.x, e.y, 26 + 12 * k)
        this.gEnt.fill(UI.amber, Math.min(1, 0.34 * bright * 2))
        this.gEnt.fillCircle(e.x, e.y, 13)
        this.gEnt.fill(0xffffff, Math.min(1, 0.9 * bright))
        this.gEnt.fillCircle(e.x, e.y, 5)
        if (flaring) {
          // 咬合半径预警圈：**必须画** —— 玩家要知道"退到哪才安全"，
          // 否则"忍住不靠近光"这条解法就变成了盲猜。
          this.gEnt.line(UI.danger, 0.26 + 0.34 * k, 2)
          this.gEnt.strokeCircle(e.x, e.y, ANGLER_GEOM.biteR)
        }
      }
      if (e.burnT > 0) {
        // 灼烧：外圈橙弧按 18Hz 闪（**不填充** —— 实心圈会把鱼盖成一坨亮斑）
        const fl = 0.34 + 0.32 * Math.sin(w.t * 18 + e.x * 0.05)
        this.gEnt.line(UI.amber, fl, 2)
        this.gEnt.strokeCircle(e.x, e.y, e.r * 1.3)
        this.gEnt.line(0xff9a3c, fl * 0.7, 3)
        this.gEnt.strokeCircle(e.x, e.y, e.r * 1.46)
      }
      if (e.charmT > 0) {
        // 内讧：青色实环 + 两段**反向**品红弧（双箭头语汇 ⇒ "它在朝同伴去"）
        const rr = e.r * 1.66
        this.gEnt.line(UI.cyanHi, 0.78, 1.8)
        this.gEnt.strokeCircle(e.x, e.y, rr)
        this.gEnt.line(0xff4fd8, 0.92, 2.4)
        for (let k = 0; k < 2; k++) {
          const a0 = (k / 2) * Math.PI * 2 + w.t * 2.4
          this.gEnt.arc(e.x, e.y, rr, a0, a0 + Math.PI * 0.62).stroke()
        }
      }

      // 受击白闪：只登记，绘制在 drawFx 开头（那才在鱼身之上）。
      // 透明度公式与 web 逐字一致：Clamp(flash / 0.09, 0, 1) * 0.62
      if (e.flash > 0) {
        this.flashMarks.push({ x: e.x, y: e.y, r: e.r, alpha: Math.min(1, e.flash / 0.09) * 0.62 })
      }
    }
  }

  private drawPlayer(w: DiveWorld): void {
    // ---- 朝向镜像（每帧一次，见 faceX 的注释）----
    const wantX = Math.cos(w.aim)
    if (wantX > 0.25) this.faceX = 1
    else if (wantX < -0.25) this.faceX = -1

    // ---- 机体：矢量「侧视剖面」（V6.54）----
    // 2026-10-13 首次由 `sub_body.png` 正俯视贴图改为矢量实时绘制（方案 A）；
    // V6.54 侧视改造把**画法**也换掉了：球核是俯视语义，侧视必须画梭形剖面。
    // 朝向由 `faceX` 离散镜像表达，**不再读 `w.aim` 做旋转**（见 faceX 注释）。
    this.drawBody(w)

    // ---- 艏部探照灯 + 一小段光锥（朝向指示）----
    // 侧视下"艏"就在机体**长度方向的端点**，所以灯点直接挂在轮廓之外，
    // 不需要 3/4 投影（`SEAT_RATIO` 在侧视下已改成"高度投影"，不是"压扁率"）。
    // ⚠️ 光锥不能省：只画一个点的话，"灯在哪一头"要靠轮廓去猜，等于没指示。
    const HL = SUB_D / 2
    const bx = w.px + this.faceX * (HL + 10)
    const by = w.py - 3
    this.gPlayer.fill(UI.cyanHi, 0.15)
    this.gPlayer.moveTo(bx, by - 4)
    this.gPlayer.lineTo(bx + this.faceX * 30, by - 14)
    this.gPlayer.lineTo(bx + this.faceX * 30, by + 8)
    this.gPlayer.close(); this.gPlayer.fillPath()
    this.gPlayer.fill(UI.cyanHi, 0.95)
    this.gPlayer.fillCircle(bx, by, EMITTER_SIZE * 0.3)

    // ---- 发射器总成：每台武器一座（底盘 + 转环 + 镶嵌其上的发射器）----
    //
    // ⚠️ **空座与座圈连线一律不画** —— web V6.13 早已删除，用户原话：
    //    「人家只有特定的镶嵌，其他都内置进去、不显示出来」。
    //    旧版这里画「座圈整圆 + 一圈空座圆点（UI.panel α.35 的深色小圆）」，
    //    机体周围就糊出一圈深灰圆点 —— 这正是用户反馈的"装射器和武器没有镶嵌上"
    //    （看着像六个空洞，而不是装在艇上的炮）。战斗里只画**实际装配的发射器本身**，
    //    Brotato 的武器也是各自独立挂着的。玩家需要知道"还有空位"的时机是**商店**。
    for (let i = 0; i < w.weapons.length; i++) this.drawTurret(w, i)

    // ---- Boss 血条（画在贴图之上；Boss 复用鱼贴图，没有血条就认不出它是 Boss）----
    for (const e of w.enemies) {
      if (!e.alive || e.kind !== 'boss') continue
      const bw = 220
      const bx = e.x - bw / 2
      const by = e.y - e.r - 26
      this.gPlayer.fill(UI.panel, 0.8); this.gPlayer.fillRect(bx, by, bw, 8)
      this.gPlayer.fill(UI.violet, 1)
      this.gPlayer.fillRect(bx, by, bw * Math.max(0, e.hp / Math.max(1, e.maxHp)), 8)
      this.gPlayer.line(UI.line, 0.9, 1); this.gPlayer.strokeRect(bx, by, bw, 8)
      if (e.phase === 'charge') {
        const kk = Math.min(1, e.t / 1.2)
        this.gPlayer.line(UI.danger, 0.5 + 0.4 * kk, 3)
        this.gPlayer.strokeCircle(e.x, e.y, 220 * (0.6 + 0.4 * kk))
      }
    }
  }

  /**
   * 机体 —— 矢量「**侧视剖面**」潜航器（V6.54 定稿）。
   *
   * -----------------------------------------------------------------------
   * 为什么把「球核」整个换掉（V6.52 §2.2）
   * -----------------------------------------------------------------------
   *   旧版（见下方「历史」段）是**俯视语义**的 3/4 球：60° 俯角、赤道挂载带、
   *   六座炮绕圆环一圈。它本身画得不差 —— 问题是**背景图、敌人贴图、乃至主界面
   *   中央区全是侧视画法**（有海底线、两侧岩壁、顶光光柱）。于是画面在说
   *   "你正往下潜"，机体却在说"我在一个平面上打转"：两套视角打架 ——
   *   这才是用户反复说的"体感奇怪"。机体是最后一个俯视残留，不换掉整条链断在这里。
   *
   * -----------------------------------------------------------------------
   * 侧视剖面 = 七条线索（与 V6.53 敌人侧视同源）
   * -----------------------------------------------------------------------
   *   ⓪ 投影        同形右下偏移的暗影（**偏移要小** —— 水下阴影是弥散的）
   *   ① 侧壁(厚度)  同形下移 6px 的暗色副本 ⇒ 下缘露出一条边 = "这坨东西有厚度"
   *   ② 主体        14 点梭形，中调金属色
   *   ②b 上缘受光  同形**缩放 + 上移**的亮色副本 ⇒ 光在世界左上，上缘亮下缘暗
   *   ③ 背脊挂载带  沿艇背一条主题色导轨 —— 炮座镶在这条线上（"赤道"在侧视里不存在）
   *   ④ 指挥塔      背部靠前的梯形围壳 + 潜望镜，**突破剪影**（无它 = 一条鱼）
   *   ⑤ 尾鳍        艉部上下两片剪刀形 —— 第二处破剪影，与指挥塔形成上下呼应
   *   ⑥ 舷窗带      一排亮点 ⇒ **"这是侧视"最强的单一线索**
   *   ⑦ 霓虹外轮廓  沿梭形描一道青边 + 上缘受光弧 + 下缘暗弧
   *
   * -----------------------------------------------------------------------
   * 三条硬约束
   * -----------------------------------------------------------------------
   *   · **不读 `w.aim`**。朝向由 `faceX` **离散镜像**表达 —— 船不会翻身，只会掉头。
   *   · **尺寸 `SUB_D`(长 88) × `HULL_H`(高 56) 与 `SEAT_RATIO` 数值耦合** ——
   *     见 `HULL_OUTLINE` / `HULL_H` 的注释（改一个必须重算另两个，否则炮脱离艇缘）。
   *   · **光源固定在世界左上**，全部明暗用世界固定方向，没有任何部件吃朝向。
   *     与 `drawTurret` 同源铁律 —— **形状的朝向不该进它自己的明暗参数**。
   *
   * 配色：机体基调用通用水青 `BODY_METAL`，**主题色只落在背脊带**（`w.sub.color`）——
   * 三台潜航器一眼可分，但机体本身不染艇种色（否则"这座台能换装"就说不通了）。
   *
   * -----------------------------------------------------------------------
   * 历史 · 俯视球核版（V6.53 及以前，**已整段作废**，留档说明踩过什么）
   * -----------------------------------------------------------------------
   *   · 为什么当时改成矢量（用户 2026-10-13 拍板方案 A）：`sub_body.png` 是正俯视
   *     平面贴图，任何角度都读作"平贴的圆盘"、没有体积；矢量把球面明暗算成参数。
   *   · v3 定稿「机体整机不与 `aim` 挂钩」（用户原话：「机体感觉大了一点点 移动的
   *     过程中 武器一直在换位置也不太合适」）：**回转体的转动看不见**，转它只会让
   *     "炮在自己滑动"更明显 ⇒ 航向提示改由艏部探照灯承担。
   *     ⚠️ **这条结论在侧视下依然成立**（见上方「三条硬约束」第一条）。
   *   · v2 修过 5 个"看着不对但参数都对"的坑：① 球体最外层 `0.55` 太暗、与暗水糊成
   *     一体；② 正圆球 + 正圆霓虹 + 椭圆带三层同圆心读作"靶盘"；③ 舷窗 y 半径忘了
   *     乘 K（真 bug）；④ 穹顶落在剪影内只是一个浅色斑；⑤ 霓虹 bloom 线宽 +50% 抢戏。
   *     ⚠️ 这 5 条里**只有 ①④⑤ 与"明暗/剪影"有关、在侧视下仍适用**；
   *        ②③ 是 3/4 投影特有的，随球核一起作废。
   */
  private drawBody(w: DiveWorld): void {
    const g = this.gPlayer
    const cx = w.px, cy = w.py
    const HL = SUB_D / 2                    // 半长 44
    const HH = HULL_H / 2                   // 半高 28
    const m = this.faceX                    // 朝向镜像（**只翻 x**：背永远是背）
    const tint = w.sub.color                // 潜航器主题色（只用于背脊带）

    // 归一化轮廓点 → 世界坐标。`sc` 缩放、`dx/dy` 为世界 px 平移。
    // ⚠️ 镜像只乘在 x 上 —— 若连 y 一起翻，掉头时艇腹会朝天（俯视时代转 180° 的同款错误）。
    const hull = (sc: number, dx: number, dy: number) => {
      for (let i = 0; i < HULL_OUTLINE.length; i++) {
        const px = cx + dx + HULL_OUTLINE[i][0] * HL * sc * m
        const py = cy + dy + HULL_OUTLINE[i][1] * HH * sc
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.close()
    }
    // 沿轮廓的某一**段**画折线（受光弧 / 暗弧 / 背脊带共用）。
    // ⚠️ 起手必须是 `moveTo`：引擎靠它推进 `pathOffset` 来隔离上一条路径，
    //    否则前一次 `stroke()` 的线会被再描一遍（Gfx.ellipseArc 的注释里有同源说明）。
    const edge = (i0: number, i1: number, sc: number, dx: number, dy: number) => {
      for (let i = i0; i <= i1; i++) {
        const px = cx + dx + HULL_OUTLINE[i][0] * HL * sc * m
        const py = cy + dy + HULL_OUTLINE[i][1] * HH * sc
        if (i === i0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
    }

    // ⓪ 投影 —— 同形右下偏移的暗影。**偏移必须小**：偏 (18,14) 会读成"后面还跟着
    //    一条船"，偏 (7,11) 才读作"这条船微微浮着"。水下阴影本来就是弥散的。
    g.fill(UI.abyss, 0.42); hull(1.0, 5, 8); g.fillPath()

    // ① 侧壁（厚度）—— 同形下移 6px 的不透明暗色副本，被主体压掉大半 ⇒ 下缘露一条边
    g.fill(shade(BODY_METAL, 0.28), 1); hull(0.99, 0, 6); g.fillPath()

    // ② 主体 —— 梭形中调。**不透明实色**（逐层 alpha 叠色会互相透出、糊成灰，
    //    见 `shade()` 的注释；Cocos Graphics 没有径向渐变）。
    g.fill(shade(BODY_METAL, 0.74), 1); hull(1.0, 0, 0); g.fillPath()

    // ②b 上缘受光 —— **两级**：「上半壳轻微提亮」+「贴轮廓的渐变光带」。
    //     ⚠️ 两个被预览图否掉的写法，别再走回头路：
    //       · 整块同形缩放上移 ⇒ 整个艇身盖成一块亮色，读作"一块肥皂"；
    //       · 单层上半壳（亮很多）⇒ 留下一条**硬水平边界**，读作"贴了一条亮纸"。
    //     现在是"面 + 线"两级：面负责"上半比下半亮"，线负责"边缘在发光" ——
    //     两级之间靠**亮度差不大**来避免硬边（0.74 → 0.88，而不是 0.74 → 1.16）。
    g.fill(shade(BODY_METAL, 0.88), 1)
    for (let i = 0; i <= 6; i++) {
      const px = cx + HULL_OUTLINE[i][0] * HL * 0.95 * m
      const py = cy - 3 + HULL_OUTLINE[i][1] * HH * 0.90
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.close(); g.fillPath()
    // 上缘光带：宽→窄、淡→亮，全部**贴轮廓**走（光源在世界左上，不吃朝向）
    g.line(shade(BODY_METAL, 1.24), 0.26, 10); edge(0, 6, 0.90, 0, -2); g.stroke()
    g.line(shade(BODY_METAL, 1.42), 0.40, 4.5); edge(0, 6, 0.94, 0, -2); g.stroke()

    // ②c 下腹暗带 —— 两级粗暗弧，坐实"下方是船腹"（不是一整块漂浮物）
    g.line(UI.abyss, 0.26, 10); edge(8, 11, 0.92, 0, 3); g.stroke()
    g.line(UI.abyss, 0.42, 5); edge(8, 11, 0.96, 1, 4); g.stroke()

    // ②d 金属高光带（V6.57）—— 用户：「机体本身没有质感」。
    //
    //     矢量渲染的硬天花板是**无渐变 / 无模糊 / 无笔触**。三个被预览图否掉的方案，
    //     别再走回头路：
    //       · 三条贯穿全艇的**竖板缝**（近黑 2.4px）⇒ 读作**铁笼**；收细、改艇身暗调、
    //         跨度收到 62% 之后**仍然是栅栏**。根因：`HULL_H` 只有 56px，
    //         任何贯穿艇高的竖线都只可能读作"这条船被切开了"。
    //       · 舷窗套**暗色窗框**/凹槽阴影 ⇒ 一排窗变成**一排黑洞**（"长了一排眼睛"）。
    //       · 几块**低频明暗斑** ⇒ 读作"锈斑 / 污渍"，不是"反光不均匀"。
    //     ⇒ 结论：56px 量级上，"金属质感"**不来自结构线、也不来自斑块**，
    //       只来自**一条集中的镜面亮痕**（人眼认金属靠的就是这条会随角度走的高光）。
    //     这条带子与 ②b 的宽软光带**叠在一起**：软光带负责"上半比下半亮"，
    //     硬高光负责"上背有一条被天光扫出的亮痕"。两者缺一，都只是"一块有明暗的板"。
    g.line(0xdcfeff, 0.50, 2.6); edge(1, 5, 0.86, -1, -8); g.stroke()
    g.line(0xffffff, 0.34, 1.2); edge(1, 5, 0.88, -1, -8); g.stroke()

    // 背脊铆钉排：沿背脊带（`edge(0,5,…)` 内缩线 y ≈ −0.45~−0.99）下方一排固定件。
    //     ⚠️ 密集的小固定件是"制造物"最强的一类信号 —— 这一条**保留**（它不切形、也不成块）。
    for (let i = 0; i < 5; i++) {
      const tt = i / 4
      const u = 0.60 - 1.12 * tt
      const yy = -0.52 - 0.30 * tt
      g.fill(UI.abyss, 0.5); g.fillCircle(cx + u * HL * m, cy + yy * HH + 1.2, 1.5)
      g.fill(UI.cyanHi, 0.5); g.fillCircle(cx + u * HL * m, cy + yy * HH, 1.45)
    }

    // ③ 背脊挂载带 —— 炮座就镶在这条线上，**主题色唯一的落点**。
    //    侧视里不存在"赤道"（那是个圆），所以改成沿艇背内缩的一条导轨。
    g.line(shade(tint, 1.12), 0.92, 3.0); edge(0, 5, 0.78, -2, -6); g.stroke()

    // ④ 指挥塔（围壳）+ 潜望镜 —— **突破剪影**的那一笔。
    //    没有它就是"一条鱼"：鱼没有围壳。暗底（厚度）先铺，亮面压上去。
    const tower = (dy: number, c: number) => {
      const T: ReadonlyArray<readonly [number, number]> =
        [[0.50, -0.88], [0.05, -0.96], [0.13, -1.46], [0.43, -1.46]]
      g.fill(c, 1)
      for (let i = 0; i < T.length; i++) {
        const px = cx + T[i][0] * HL * m
        const py = cy + T[i][1] * HH + dy
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.close(); g.fillPath()
    }
    tower(5, UI.abyss)                                   // 暗底（厚度，下移 5px）
    tower(0, shade(BODY_METAL, 0.88))
    g.line(shade(BODY_METAL, 1.50), 0.85, 1.6)           // 塔顶受光棱
    g.moveTo(cx + 0.14 * HL * m, cy - 1.46 * HH)
    g.lineTo(cx + 0.42 * HL * m, cy - 1.46 * HH)
    g.stroke()
    // ④b 观察窗（V6.57）—— 围壳上的一条横窗：指挥塔此前是一块**实心梯形**，
    //     加上这一条才读作"里面有人在看"（与舷窗同一套语汇，塔上再来一次）。
    //     ⚠️ 亮度**低于**舷窗（0.62 vs 0.95）：塔窗是"结构缝"不是"发光口"，
    //        给到舷窗那么亮，指挥塔会变成整机最抢眼的一块（预览图试出来的）。
    {
      const wy = cy - 1.18 * HH
      const wxa = cx + 0.14 * HL * m, wxb = cx + 0.42 * HL * m
      const lx = Math.min(wxa, wxb), rx2 = Math.max(wxa, wxb)
      g.line(UI.abyss, 0.5, 2.6); g.strokeSeg(lx, wy, rx2, wy)
      g.line(UI.cyanHi, 0.62, 1.2); g.strokeSeg(lx + 1, wy, rx2 - 1, wy)
    }
    g.line(shade(BODY_METAL, 1.34), 0.9, 1.5)            // 潜望镜（再破一次剪影）
    g.moveTo(cx + 0.29 * HL * m, cy - 1.46 * HH)
    g.lineTo(cx + 0.27 * HL * m, cy - 1.78 * HH)
    g.stroke()

    // ⑤ 尾舵 —— 艉部上下两片，**向后上 / 后下伸出**（第二处破剪影，与指挥塔呼应）。
    //    ⚠️ 三点必须"根在艇内、尖在艇外"：根部藏进艇体被主体压住，只有伸出去的一段可见
    //       —— 与 Title.ts 稳定鳍同一手法。
    //       旧值 `(-0.70,±0.82) → (-1.06,±0.26)` 是**横向**的，整片埋在艇身里、看不见
    //       （预览脚本一眼看出来的）。
    const FIN: ReadonlyArray<readonly [number, number]> =
      [[-0.70, -0.62], [-1.02, -1.42], [-0.86, -0.30]]
    for (const sgn of [1, -1]) {
      g.fill(shade(BODY_METAL, 0.55), 1)
      for (let i = 0; i < FIN.length; i++) {
        const px = cx + FIN[i][0] * HL * m
        const py = cy + FIN[i][1] * HH * sgn
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.close(); g.fillPath()
    }

    // ⑥ 舷窗带 —— **"这是侧视"最强的单一线索**：一排窗沿艇身横向排开。
    //    俯视画法里根本不存在"一排窗"（那一条是"围一圈"，见历史段 v2 坑 ③）。
    //    中间一颗放大 —— 手电筒之外的第二个视觉锚点，也帮眼睛定"哪边是艏"。
    // ⚠️ V6.57：素圆点 + **一圈光晕**。就这一处、就这一改。
    //    ⚠️ 加过"暗色窗框"和"下方凹槽阴影"，两版都被预览图否掉：任何比玻璃
    //       更大的暗环/暗斑贴在 2.2px 的窗上，都会把一排舷窗变成**一排黑洞**
    //       （整机读作"长了一排眼睛"）。窗只做加法 —— **只加光，不加暗**。
    for (let i = 0; i < 5; i++) {
      const px = cx + (-0.34 + 0.22 * i) * HL * m
      const py = cy - 0.30 * HH
      const r = i === 2 ? 2.8 : 2.2
      g.fill(UI.cyanHi, 0.11); g.fillCircle(px, py, r * 2.0)       // 光晕
      g.fill(UI.cyanHi, 0.95); g.fillCircle(px, py, r)             // 玻璃
      g.fill(0xffffff, 0.9)                                        // 高光点（光源左上）
      g.fillCircle(px - r * 0.32 * m, py - r * 0.34, r * 0.34)
    }

    // ⑦ 艉部推进器 —— 侧视**第二强线索**（第一是舷窗）：艉端面上一个竖椭圆护罩 +
    //    中心轴亮点。它把"哪一头是艉"锁死 —— 只看轮廓是猜不出来的。
    const pxTail = cx - HL * m
    g.line(shade(BODY_METAL, 1.30), 0.85, 1.6)
    g.ellipse(pxTail, cy, HH * 0.26, HH * 0.64); g.stroke()
    g.fill(UI.cyanHi, 0.78); g.fillCircle(pxTail, cy, 2.0)
    // ⑦b 散热格栅（V6.57）：护罩前方三条横向鳍片 —— 给艉部一个"在散热"的机械开口。
    //     与 ⑦ 同源：艉端是机体上唯一"必须有大量小结构"的地方（动力舱）。
    for (let i = 0; i < 3; i++) {
      const u = -0.60 - i * 0.085
      const sx2 = cx + u * HL * m
      g.line(UI.abyss, 0.26, 1.1)
      g.strokeSeg(sx2, cy - HH * 0.20, sx2, cy + HH * 0.22)
    }

    // ⑧ 霓虹外轮廓 + 明暗弧 —— 玩家机体必须是画面里最亮的青系。
    //    ⚠️ 不加 bloom：线宽挂在这条轮廓上会外扩成一圈比机体还大的光环（历史段 v2 坑 ⑤）。
    g.line(UI.cyan, 0.88, 1.6); hull(1.0, 0, 0); g.stroke()
    // 上缘受光弧（粗亮）—— **光源固定在世界坐标，不吃朝向**（与 drawTurret 同源铁律）
    g.line(UI.cyanHi, 0.32, 3.0); edge(0, 3, 0.97, -1, -3); g.stroke()

    // ⑨ 炮口照明（V6.57）—— 开火瞬间，炮口的光**打回机体**。
    //    "发射装置像贴图"的第三半：没有这一层，开火只是"船**外面**亮了一下"，
    //    机身上收不到任何来自自己武器的光 ⇒ 炮塔与船读作两件不相干的东西。
    //    取全场最大的 `fireFlash`（多座齐射一起照亮，不叠加过曝），整机提一层冷光。
    //    颜色用青白而不是枪口焰的暖色：深海整体冷光环境下，船壳反射用冷色更成立。
    let mzL = 0
    for (const wp2 of w.weapons) {
      if (wp2.fireFlash > 0) mzL = Math.max(mzL, Math.min(1, wp2.fireFlash / 0.15))
    }
    if (mzL > 0) {
      g.fill(UI.cyanHi, 0.11 * mzL); hull(1.0, 0, 0); g.fillPath()
    }

    // 受击反馈：整机泛红（矢量机体没有"红描边"，改整机压色）
    if (w.hurtFlash > 0) {
      g.fill(UI.danger, 0.30 * Math.min(1, w.hurtFlash / 0.2))
      hull(1.0, 0, 0); g.fillPath()
    }
  }

  /**
   * 局部坐标 → 世界坐标的**旋转**（sim 语义：原点左上、y 向下、`ang` 顺时针为正）。
   *
   * 为什么手算而不是用引擎的 `translate/rotate`：Cocos 3.8.8 的 `Graphics`
   * **没有** `save/translate/rotate/restore`（读过 `cocos/2d/components/graphics.ts`）。
   * 手算还顺带避开一层坑 —— 角度语义与 sim 完全一致，不必再叠一次 y 翻转的心算。
   */
  private rot(cx: number, cy: number, ang: number, lx: number, ly: number): { x: number; y: number } {
    const c = Math.cos(ang), s = Math.sin(ang)
    return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }
  }

  /**
   * 发射机枪总成 = **赤道挂载带上的挂点 + 镶嵌其上的发射器**。
   *
   * -----------------------------------------------------------------------
   * 2026-10-13 重做（用户拍板「A2 层叠 + 装填环去掉」）
   * -----------------------------------------------------------------------
   *   ① 塔座**不再是独立的圆形底盘**：6 个挂点直接嵌在机体的赤道挂载带上
   *      （`drawBody` ④ 那条椭圆环）。座圈位置由 `seatPos()` 给出，**已含 3/4 投影**，
   *      所以"炮位 = 炮口 = 子弹出生点"天然对齐（改投影只需改那一处）。
   *   ② **装填进度环整条删掉**（用户明确要求）。"还要等多久"的信息交给 HUD 的冷却环，
   *      战斗里不再有塔座外圈那条转动的小弧。
   *   ③ 层叠走 **A2**：机体先画、6 挺机枪全画在机体**之上**（不按远近做遮挡排序）——
   *      这样"我装了几门炮"任何朝向都一眼可见（用户硬要求：机枪必须清晰可见）。
   *
   * -----------------------------------------------------------------------
   * ⚠️ 光源**固定在屏幕左上**，不随炮管转
   * -----------------------------------------------------------------------
   *   **旋转的只有发射器**；挂点的明暗一律用**世界固定角**（左上 180°~266°）。
   *   判据：形状的朝向不该进它自己的明暗参数 —— 否则炮管一转亮面跟着转，
   *   视觉上就是"贴纸在打折"（旧版踩过，且**不报错**，只有盯着连续转向才看得出）。
   *
   * -----------------------------------------------------------------------
   * 动效（用户要「给点立体感 在移动」）
   * -----------------------------------------------------------------------
   *   · 后坐：开火瞬间沿炮管**反方向**退 `3px`，随 `fireFlash` 衰减归位（只推发射器）；
   *   · 待机微浮：`sin(t*1.6 + i*2.3) * 0.7px`，每座错相位；
   *   · 索敌转向由 `slewTurretAims`（sim 层，`TURRET_SPIN` 限速）驱动，渲染层不重复做。
   */
  private drawTurret(w: DiveWorld, i: number): void {
    const wp = w.weapons[i]
    const pose = w.turretPose(i)
    if (!wp || !pose) return
    const g = this.gPlayer
    const cx = pose.x, cy = pose.y, ang = pose.ang
    // ext = 容器扩容解锁出来的第 5、6 座：挂点略大 10% + 琥珀描边，
    // 让"我的艇变强了"在**剪影**上直接看得见，而不是只能读 HUD 数字。
    const ext = i >= BASE_SEATS
    const pad = TURRET_R * 0.55 * (ext ? 1.10 : 1)
    const hot = wp.fireFlash > 0
    // 后坐位移（沿炮管局部 x，负 = 后退）。
    // V6.57「弹射感」：行程 3 → **5.5px**，并且**不是线性归位**。
    //   ⚠️ 线性归位（旧写法 `3 * k`）读起来是"贴图滑回原位"—— 匀速退回没有任何冲击感。
    //   真实后坐的形状是**阻尼振荡的第一段**：猛地退到底 → 快速回位 → 回位时**轻微过冲**
    //   再归中。用 `exp(-e)·cos(e)` 一次给全（e = 经过的时间比例，0→1）。
    //   末尾 10% 乘线性窗口收口，避免 fireFlash 结束时残值跳变。
    const kf = Math.min(1, wp.fireFlash / 0.15)
    const e = 1 - kf
    const kick = hot
      ? 5.5 * Math.exp(-e * 3.4) * Math.cos(e * 6.2) * (e > 0.9 ? (1 - e) / 0.1 : 1)
      : 0
    const bob = Math.sin(w.t * 1.6 + i * 2.3) * 0.7
    const fore = -kick - bob

    // 挂点 = **底座 + 内凹槽** 两级（V6.57）。
    //   用户：「发射装置像贴图」。旧版挂点是"一个深色实心圆 + 一圈描边" ——
    //   读作"贴上去的一个圆点"，上面浮着一根炮管，两者之间没有安装关系。
    //   补上"这东西是**装上去的**"所需的四层：投影 → 底座侧壁 → 底座顶面 →
    //   内凹槽（发射器坐在槽里）。判据和机体同源：**有厚度 = 有侧壁**。
    //   ⚠️ 光源固定世界左上：受光弧恒在 1.05π~1.45π（左上象限），**不随 `ang` 转**。
    //   ⚠️ 尺寸**必须只比挂点大一点点**（`pad × 1.28`）。预览放大图否掉过 `× 1.55` 的版本：
    //      6 个底座直径 27px 挂在 88×56 的机体上，直接读作"机体外面套了六个黑盘"——
    //      比不改更"贴图"。底座的作用是给挂点**一圈厚度**，不是自己成为主体。
    //   ⚠️ 光源固定世界左上：受光弧恒在 1.05π~1.45π（左上象限），**不随 `ang` 转**。
    const base = pad * 1.28
    g.fill(UI.abyss, 0.40); g.fillCircle(cx + pad * 0.14, cy + pad * 0.30, base)   // 投影
    g.fill(shade(BODY_METAL, 0.34), 1); g.fillCircle(cx, cy + 1.6, base)           // 底座侧壁
    g.fill(shade(BODY_METAL, 0.52), 1); g.fillCircle(cx, cy, base)                 // 底座顶面
    g.line(UI.cyanHi, 0.42, Math.max(1, base * 0.16))                              // 顶面左上受光弧
    g.arc(cx, cy, base * 0.84, Math.PI * 1.05, Math.PI * 1.45); g.stroke()
    g.line(ext ? UI.amber : UI.cyanDim, 0.9, 1.3); g.strokeCircle(cx, cy, base)    // 底座外沿
    // 内凹槽：发射器坐在里面。顶面刻意压暗，让**本色发射器**从槽里跳出来（"机枪清晰可见"）。
    g.fill(UI.abyss, 0.58); g.fillCircle(cx, cy, pad)
    g.line(UI.cyanHi, 0.50, Math.max(1, pad * 0.22))
    g.arc(cx, cy, pad * 0.74, Math.PI * 1.02, Math.PI * 1.48); g.stroke()
    g.line(ext ? UI.amber : UI.cyanHi, hot ? 1 : 0.8, 1.4)
    g.strokeCircle(cx, cy, pad)

    // 发射器外罩（V6.57）：沿炮管方向的短壳体，把发射器**根部**罩住 ——
    //   "像贴图"的另一半：发射器必须是从挂点上"长出来"的，不是浮在旁边的。
    //   壳口在 `L1`，发射器从壳口伸出（`drawEmitter` 本体长到局部 x ≈ s*0.8 > L1）。
    //   受光按**局部上/下**分（上亮下暗），与底座同源。
    {
      const L0 = -pad * 0.55, L1 = pad * 1.45, W2 = pad * 1.05
      const q = [
        this.rot(cx, cy, ang, L0, -W2), this.rot(cx, cy, ang, L1, -W2),
        this.rot(cx, cy, ang, L1, W2), this.rot(cx, cy, ang, L0, W2),
      ]
      g.fill(shade(BODY_METAL, 0.50), 1)
      for (let k = 0; k < 4; k++) {
        if (k === 0) g.moveTo(q[k].x, q[k].y); else g.lineTo(q[k].x, q[k].y)
      }
      g.close(); g.fillPath()
      const e0 = this.rot(cx, cy, ang, L0 + 1.5, -W2 * 0.92)
      const e1 = this.rot(cx, cy, ang, L1 - 1.5, -W2 * 0.92)
      g.line(shade(BODY_METAL, 1.18), 0.85, 1.5); g.strokeSeg(e0.x, e0.y, e1.x, e1.y)
      const f0 = this.rot(cx, cy, ang, L0 + 1.5, W2 * 0.92)
      const f1 = this.rot(cx, cy, ang, L1 - 1.5, W2 * 0.92)
      g.line(UI.abyss, 0.45, 1.5); g.strokeSeg(f0.x, f0.y, f1.x, f1.y)
      // 壳口环：把"炮管从这里出来"写死（缺它，壳体与炮管是两个不相干的块）
      const c0 = this.rot(cx, cy, ang, L1, 0)
      g.line(ext ? UI.amber : UI.cyanHi, 0.75, 1.3)
      g.arc(c0.x, c0.y, W2 * 0.72, ang - 1.35, ang + 1.35); g.stroke()
    }

    // 发射器：嵌在挂点上，随索敌角旋转（子弹与枪口闪光也以它为准）
    this.drawEmitter(wp.id, cx, cy, ang, hot, fore)

    // ---- V6.46 前摇蓄力环 ----
    // 「施法特效不够」的真正解药**不是**开火时多画点东西，而是**让开火有预告**：
    // 一个没有任何前摇的攻击，无论命中时多大特效，读起来都只是"突然发生了"。
    //
    // 只给长 CD 武器（`ivLast ≥ 1.4`：鱼雷 / 回声 / 诱饵）：它们每 1.5–2.4s 才打一发，
    // 有足够时间铺这条预告；短 CD 武器（枪 0.11s、电弧 0.9s）加进去只会变成常亮噪声。
    //
    // ⚠️ 数据直接读 `wp.timer / wp.ivLast`，**模拟层不需要多维护一份"正在蓄力"状态** ——
    //    两份状态迟早会不一致，而那种不一致不会有任何报错。
    // ⚠️ 事件不能走 `pushShock`：那是"一次性扩散"的池，收拢环要**每帧**重画，
    //    走池会每帧 push 一个、把 SHOCK_CAP 挤爆（症状是打击特效整体消失）。
    if (wp.ivLast >= 1.4 && wp.fireFlash <= 0) {
      const ready = 1 - Math.max(0, Math.min(1, wp.timer / wp.ivLast))
      const WARM = 0.72                      // 最后 28% 的装填时间才进入预警窗口
      if (ready > WARM) {
        const p = (ready - WARM) / (1 - WARM)
        const rr = 36 - p * 27               // 36 → 9：**向内收拢**才是"蓄力"的语汇
        const mx = cx + Math.cos(ang) * pad
        const my = cy + Math.sin(ang) * pad
        this.gFront.line(WEAPON_DEF[wp.id].color, 0.20 + p * 0.62, 1.6 + p * 1.5)
        this.gFront.strokeCircle(mx, my, rr)
        if (p > 0.45) {
          // 内环反向收（两环一正一反读作"在咬合"，单个环只读作"在缩"）
          this.gFront.line(0xffffff, ((p - 0.45) / 0.55) * 0.5, 1)
          this.gFront.strokeCircle(mx, my, rr * 0.52)
        }
      }
    }
  }

  /**
   * 发射器（可插拔部件）—— web `drawEmitter` 的逐值移植，只把 `g.save/translate/rotate`
   * 换成手算旋转（Cocos Graphics 没有变换 API，见 `rot`）。
   *
   * 新增武器 = 新增一个分支，装载器那套完全不用动 —— 这就是"通用安装"的落点。
   */
  private drawEmitter(id: WeaponId, cx: number, cy: number, ang: number, firing: boolean, fore = 0): void {
    const g = this.gPlayer
    const s = EMITTER_SIZE
    const c = WEAPON_DEF[id].color
    // `fore` = 后坐 / 待机微浮的位移（沿炮管局部 x）。整个发射器**整体平移**、形状不变 ——
    // 这样"炮在动"读起来是机械行程，而不是零件被拉伸。
    const P = (lx: number, ly: number) => this.rot(cx, cy, ang, lx + fore, ly)
    // 少数图元（同心弧）直接以塔心为圆心，也得吃同一份位移，否则弧和管会错开
    const ox = cx + Math.cos(ang) * fore
    const oy = cy + Math.sin(ang) * fore

    // ⚠️ 一律按**族**路由（`weaponFamily`），不是 `id === 'xxx'` 严格相等 ——
    //    之前用严格相等时，8 个进化形态（gun_gl/torp_hv/sonar_fc…）全都掉进最后的
    //    `else`（电弧造型），即"进化了但外观没变、还都长成电弧"。2026-10-13 修。
    const fam = weaponFamily(id)
    if (fam === 'sonar') {
      // 声呐族：同心弧。定向聚焦改"短而粗"；共振炮额外三颗散射点。
      const fc = id === 'sonar_fc'
      const arcs = fc ? 2 : 3
      for (let i = 1; i <= arcs; i++) {
        g.line(c, firing ? 1 : 0.7, fc ? 2.6 : 1.8)
        g.arc(ox, oy, s * (fc ? 0.2 : 0.26) * i, ang - (fc ? 0.62 : 1.0), ang + (fc ? 0.62 : 1.0))
        g.stroke()
      }
      g.fill(c, 0.9); g.fillCircle(ox, oy, s * 0.12)
      if (id === 'sonar_rs') {
        for (const da of [-0.9, 0, 0.9]) {
          const p = P(Math.cos(da) * s * 0.5, Math.sin(da) * s * 0.5)
          g.fill(c, 0.85); g.fillCircle(p.x, p.y, s * 0.09)
        }
      }
    } else if (fam === 'gun') {
      // 机关枪族：平行枪管。加特林 5 管；霰弹 3 管 + 外扩喇叭口。
      const n = id === 'gun_gl' ? 5 : 3
      for (let i = 0; i < n; i++) {
        const yy = (i - (n - 1) / 2) * (id === 'gun_gl' ? s * 0.16 : s * 0.3)
        const p1 = P(-s * 0.35, yy), p2 = P(s * 0.8, yy)
        g.line(c, i === ((n - 1) >> 1) ? 1 : 0.65, 2.2)
        g.strokeSeg(p1.x, p1.y, p2.x, p2.y)
      }
      if (id === 'gun_sg') {
        const m0 = P(s * 0.8, 0), m1 = P(s * 1.0, -s * 0.34), m2 = P(s * 1.0, s * 0.34)
        g.line(c, 0.9, 1.8)
        g.strokeSeg(m0.x, m0.y, m1.x, m1.y)
        g.strokeSeg(m0.x, m0.y, m2.x, m2.y)
      }
      const mz = P(s * 0.8, 0)
      g.fill(firing ? 0xffffff : c, 0.95); g.fillCircle(mz.x, mz.y, s * 0.11)
    } else if (fam === 'torpedo') {
      // 鱼雷族：管身 + 管口环。集束三管口；重型更粗 + 双环。
      // ⚠️ 管身**绝不能填近黑**：曾经用近黑填管身，在明亮水层下就是一块纯黑矩形 ——
      //    那正是用户反复反馈的"击杀之后有一个黑色方块"的真凶。
      const wide = id === 'torp_hv'
      const hh = wide ? s * 0.42 : s * 0.3
      const q = [P(-s * 0.4, -hh), P(s * 0.6, -hh), P(s * 0.6, hh), P(-s * 0.4, hh)]
      const quad = () => {
        g.moveTo(q[0].x, q[0].y); g.lineTo(q[1].x, q[1].y)
        g.lineTo(q[2].x, q[2].y); g.lineTo(q[3].x, q[3].y); g.close()
      }
      g.fill(c, 0.32); quad(); g.fillPath()
      g.line(c, 0.95, 1.6); quad(); g.stroke()
      if (id === 'torp_cl') {
        for (const yy of [-s * 0.22, 0, s * 0.22]) {
          const p = P(s * 0.55, yy)
          g.line(c, 0.9, 1.4); g.strokeCircle(p.x, p.y, s * 0.12)
        }
      } else {
        const m1 = P(s * 0.55, -hh * 0.9), m2 = P(s * 0.55, hh * 0.9)
        g.line(firing ? 0xffffff : c, 0.95, wide ? 2.6 : 2)
        g.strokeSeg(m1.x, m1.y, m2.x, m2.y)
        if (wide) {
          const m3 = P(s * 0.72, -s * 0.3), m4 = P(s * 0.72, s * 0.3)
          g.line(c, 0.7, 1.6); g.strokeSeg(m3.x, m3.y, m4.x, m4.y)
        }
        const mo = P(s * 0.42, 0)
        g.fill(0xffffff, firing ? 0.9 : 0.35); g.fillCircle(mo.x, mo.y, s * (wide ? 0.2 : 0.16))
      }
    } else if (fam === 'arc') {
      // 电弧族：两根电极柱 + 跳跃弧光。过载加一段；定点雷暴向四周放射。
      const e1a = P(-s * 0.2, -s * 0.36), e1b = P(s * 0.5, -s * 0.36)
      const e2a = P(-s * 0.2, s * 0.36), e2b = P(s * 0.5, s * 0.36)
      g.line(c, 0.95, 2)
      g.strokeSeg(e1a.x, e1a.y, e1b.x, e1b.y)
      g.strokeSeg(e2a.x, e2a.y, e2b.x, e2b.y)
      if (id === 'arc_st') {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          const p = P(Math.cos(a) * s * 0.66, Math.sin(a) * s * 0.66)
          g.line(firing ? 0xffffff : c, 0.85, 1.4)
          g.strokeSeg(ox, oy, p.x, p.y)
        }
      } else {
        const z = id === 'arc_ov'
          ? [P(s * 0.5, -s * 0.36), P(s * 0.2, -s * 0.16), P(s * 0.62, -s * 0.02), P(s * 0.28, s * 0.14), P(s * 0.62, s * 0.36)]
          : [P(s * 0.5, -s * 0.36), P(s * 0.26, -s * 0.06), P(s * 0.62, s * 0.06), P(s * 0.38, s * 0.36)]
        neon(g, firing ? 0xffffff : c, () => {
          g.moveTo(z[0].x, z[0].y)
          for (let i = 1; i < z.length; i++) g.lineTo(z[i].x, z[i].y)
          g.stroke()
        }, { width: 1.6, bloom: firing })
      }
    } else if (fam === 'harpoon') {
      // 鱼叉族（V6.29 新增造型）：一根长矛 + 前端倒钩。三重鱼叉三根平行；回旋鱼叉尾端带环。
      const shafts = id === 'harp_tr' ? [-1, 0, 1] : [0]
      for (const k of shafts) {
        const yy = k * s * 0.28
        const a1 = P(-s * 0.42, yy), a2 = P(s * 0.86, yy)
        g.line(c, k === 0 ? 1 : 0.7, 2.2)
        g.strokeSeg(a1.x, a1.y, a2.x, a2.y)
        const t0 = P(s * 0.86, yy), t1 = P(s * 0.64, yy - s * 0.16), t2 = P(s * 0.64, yy + s * 0.16)
        g.line(c, 0.95, 1.6)
        g.strokeSeg(t0.x, t0.y, t1.x, t1.y)
        g.strokeSeg(t0.x, t0.y, t2.x, t2.y)
      }
      if (id === 'harp_cb') {
        const lp = P(-s * 0.62, 0)
        g.line(firing ? 0xffffff : c, 0.9, 1.6)
        g.strokeCircle(lp.x, lp.y, s * 0.22)
      }
    } else if (fam === 'echo') {
      // 回声族（V6.29 新增造型）：后方发射盘 + 前方聚焦点。多重三点；聚焦一个大点 + 双环。
      const bp = P(-s * 0.12, 0)
      g.fill(c, 0.85); g.fillCircle(bp.x, bp.y, s * (id === 'echo_fo' ? 0.3 : 0.22))
      if (id === 'echo_mu') {
        for (const k of [-1, 0, 1]) {
          const p = P(s * 0.55, k * s * 0.34)
          g.fill(firing ? 0xffffff : c, 0.95); g.fillCircle(p.x, p.y, s * 0.13)
        }
      } else if (id === 'echo_fo') {
        const p = P(s * 0.62, 0)
        g.fill(firing ? 0xffffff : c, 0.95); g.fillCircle(p.x, p.y, s * 0.22)
        g.line(c, 0.8, 1.6); g.strokeCircle(p.x, p.y, s * 0.36)
      } else {
        const p = P(s * 0.55, 0)
        g.fill(firing ? 0xffffff : c, 0.9); g.fillCircle(p.x, p.y, s * 0.15)
        g.line(c, 0.6, 1.2); g.strokeCircle(p.x, p.y, s * 0.26)
      }
    } else {
      // 酸液族（V6.29 新增造型）：朝前的喷嘴锥。持久酸池尾端带池环；酸雨三点。
      const n0 = P(-s * 0.4, -s * 0.34), n1 = P(-s * 0.4, s * 0.34), n2 = P(s * 0.7, 0)
      g.fill(c, 0.28)
      g.moveTo(n0.x, n0.y); g.lineTo(n1.x, n1.y); g.lineTo(n2.x, n2.y); g.close(); g.fillPath()
      g.line(c, 0.95, 1.6)
      g.moveTo(n0.x, n0.y); g.lineTo(n1.x, n1.y); g.lineTo(n2.x, n2.y); g.close(); g.stroke()
      if (id === 'acid_ra') {
        for (const k of [-1, 0, 1]) {
          const p = P(s * 0.95, k * s * 0.3)
          g.fill(firing ? 0xffffff : c, 0.95); g.fillCircle(p.x, p.y, s * 0.1)
        }
      } else {
        if (id === 'acid_fd') {
          const p = P(-s * 0.5, 0)
          g.line(c, 0.8, 1.4); g.strokeCircle(p.x, p.y, s * 0.24)
        }
        const mz = P(s * 0.7, 0)
        g.fill(firing ? 0xffffff : c, 0.9); g.fillCircle(mz.x, mz.y, s * (id === 'acid_fd' ? 0.12 : 0.14))
      }
    }
  }

  private drawFx(dt: number): void {
    // ---- 受击白闪最先画 ----
    // web 的层序是「鱼的白色剪影 < 冲击波 < 击打痕 < 火花」，闪白属于敌人那一层，
    // 所以它必须排在冲击波之前 —— 被冲击波压住就看不出"是这条鱼挨打了"。
    for (const m of this.flashMarks) {
      this.gFront.fill(0xffffff, m.alpha)
      // ⚠️ 半轴：web 的 `fillEllipse` 收直径（e.r*2.3 × e.r*1.7），这里必须 ÷2。
      this.gFront.ellipse(m.x, m.y, (m.r * 2.3) / 2, (m.r * 1.7) / 2)
      this.gFront.fillPath()
    }
    // 消费掉：下一帧由 drawEnemies 重新登记。放在这里而不是 clearFx，
    // 是因为非战斗相位（商店/结算）不会调 drawEnemies —— 靠"消费"而不是"清理"
    // 才能保证这一帧画的一定是这一帧登记的那批，不留幻影。
    this.flashMarks.length = 0

    for (const s of this.shocks) {
      const k = Math.max(0, s.life / s.maxLife)
      const wdt = s.width * (0.4 + 0.6 * k)
      this.gFront.line(s.color, Math.min(1, k * 1.2), wdt)
      this.gFront.strokeCircle(s.x, s.y, Math.max(1, s.r))
      if (s.rings > 1) {
        const r2 = s.r - s.rMax * s.ringDelay
        if (r2 > 0.6) {
          this.gFront.line(0xffffff, Math.min(0.8, k), wdt * 0.6)
          this.gFront.strokeCircle(s.x, s.y, r2)
        }
      }
      if (s.core * k > 0.6) {
        this.gFront.fill(0xffffff, Math.min(0.9, k * 1.1))
        this.gFront.fillCircle(s.x, s.y, s.core * k)
      }
    }

    for (const s of this.slashes) {
      const k = Math.max(0, s.life / s.maxLife)
      const nx = Math.sin(s.ang), ny = -Math.cos(s.ang)
      this.gFront.line(s.color, Math.min(1, k), s.width)
      this.gFront.strokeSeg(
        s.x - nx * s.len * 0.5, s.y - ny * s.len * 0.5,
        s.x + nx * s.len * 0.5, s.y + ny * s.len * 0.5,
      )
    }

    for (const a of this.arcs) {
      const k = Math.max(0, a.life / (a.maxLife ?? 0.18))
      const c = a.color ?? 0xa06bff          // 缺省紫 = 电弧；网目自己带玉/青色
      this.gFront.line(c, 0.9 * k, 3); this.gFront.strokePolyline(a.pts)
      this.gFront.line(0xffffff, 0.7 * k, 1.2); this.gFront.strokePolyline(a.pts)
    }

    for (const s of this.sparks) {
      const k = Math.max(0, s.life / s.maxLife)   // 1 → 0
      if (s.kind === 'flash') {
        // 枪口闪光：朝弹道方向的**锥形亮弧 + 中心白核**（不是一圈圆点）
        const L = s.size * (1.6 - k * 0.6)
        const ca = Math.cos(s.ang), sa = Math.sin(s.ang)
        const pa = -sa, pb = ca
        this.gFront.fill(0xffffff, k * 0.85)
        this.gFront.moveTo(s.x + ca * L * 1.25, s.y + sa * L * 1.25)
        this.gFront.lineTo(s.x + pa * s.size * 0.62, s.y + pb * s.size * 0.62)
        this.gFront.lineTo(s.x - pa * s.size * 0.62, s.y - pb * s.size * 0.62)
        this.gFront.close()
        this.gFront.fillPath()
        this.gFront.fill(s.color, k * 0.55)
        this.gFront.fillCircle(s.x, s.y, s.size * 0.5)
      } else {
        // 命中火星：沿飞行方向拉成**短条**（"溅"不是"点"），越老越细越淡
        const L = 4 + s.size * 2.2
        const ca = Math.cos(s.ang), sa = Math.sin(s.ang)
        neonLine(this.gFront, s.x, s.y, s.x - ca * L * k, s.y - sa * L * k, s.color,
          { width: Math.max(0.5, s.size * k), alpha: k, bloom: false })
      }
    }

    // 网张开排在最后：它是**面积最大**的特效，压在火星之上才不会被自己的碎屑糊住
    this.drawNets(dt)
  }

  /**
   * **网张开**（V6.61 按物理重写）。画在 `gFront`（敌人之上），四件事：
   *   ① **网衣**（极淡填充）—— 让网"有面"，不是一圈线；
   *   ② **网缘**（主轮廓）—— 12 颗铅坠 + 扇贝波；
   *   ③ **网目** —— 径向索（中心 → 每颗铅坠）+ 两圈环向索；
   *   ④ **铅坠** —— 网缘上的配重块，也是网最先下沉的地方。
   *
   * ⛔ **不要退化成"同心圆环 + 径向线"**：那读作冲击波 / 雷达，不是网。
   *    网之所以是网，靠的是**环向索**（把径向索连起来的那些圈）—— 有它才有"网格"。
   *
   * 时序两段：**先展开（0 → `NET_OPEN_END`）后塌陷收拢**（`NET_OPEN_END` → 1）。
   * 一直往外扩 = 爆炸，玩家会以为这是个伤害圈；网恰恰相反，张开到最大后要**塌回去缠住猎物**。
   */
  private drawNets(dt: number): void {
    for (let i = this.nets.length - 1; i >= 0; i--) {
      const n = this.nets[i]
      n.life += dt
      const t = n.life / n.maxLife
      if (t >= 1) { this.nets.splice(i, 1); continue }

      const open = t < NET_OPEN_END
      const kIn = open ? t / NET_OPEN_END : (t - NET_OPEN_END) / (1 - NET_OPEN_END)
      // ① 展开 0.35r → 1.0r（网从收拢的网束张开）；② 塌陷 1.0r → 0.82r
      const spread = open ? 0.35 + 0.65 * kIn : 1 - (1 - NET_COLLAPSE) * kIn
      // 沿抛出方向**越飞越长**：迎水的一面被向后拖（柔性体，不是刚性圆）
      const a1 = n.r * spread * (1 + NET_STRETCH * (open ? kIn : 1))
      const b1 = n.r * spread
      // alpha：展开期由淡转实；塌陷期淡出
      const al = open ? 0.30 + 0.55 * kIn : 0.85 * (1 - kIn)

      const ca = Math.cos(n.ang), sa = Math.sin(n.ang)
      const px: number[] = [], py: number[] = []
      for (let k = 0; k < NET_SEGS; k++) {
        const th = (k / NET_SEGS) * Math.PI * 2
        // **水滴**（前尖后宽）× **扇贝**（铅坠之间网衣被水顶起）× **各段随机**（打破完美对称）
        const w = (1 - NET_TAPER * Math.cos(th))
          * (1 + NET_SCALLOP * Math.sin(NET_SCALLOP_N * th) + (n.ph[k] - 0.5) * NET_JITTER)
        const lx = a1 * w * Math.cos(th), ly = b1 * w * Math.sin(th)
        px.push(n.x + lx * ca - ly * sa)
        py.push(n.y + lx * sa + ly * ca)
      }
      const outline = () => {
        this.gFront.moveTo(px[0], py[0])
        for (let k = 1; k < NET_SEGS; k++) this.gFront.lineTo(px[k], py[k])
        this.gFront.close()
      }

      // ① 网衣
      this.gFront.fill(n.col, al * 0.12); outline(); this.gFront.fillPath()
      // ② 网缘
      this.gFront.line(n.col, al, 1.5); outline(); this.gFront.stroke()
      // ③ 径向索（只连到 0.92 —— 留出铅坠的位置）
      this.gFront.line(n.col, al * 0.5, 0.8)
      for (let k = 0; k < NET_SEGS; k++) {
        this.gFront.strokeSeg(n.x + (px[k] - n.x) * 0.92, n.y + (py[k] - n.y) * 0.92, px[k], py[k])
      }
      // ④ 环向索：两圈，把径向索**连起来** ⇒ 这才读作"网"
      for (const fr of [0.38, 0.66]) {
        this.gFront.line(n.col, al * 0.42, 0.7)
        this.gFront.moveTo(n.x + (px[0] - n.x) * fr, n.y + (py[0] - n.y) * fr)
        for (let k = 1; k < NET_SEGS; k++) {
          this.gFront.lineTo(n.x + (px[k] - n.x) * fr, n.y + (py[k] - n.y) * fr)
        }
        this.gFront.close()
        this.gFront.stroke()
      }
      // ⑤ 铅坠
      this.gFront.fill(n.col, al * 0.85)
      for (let k = 0; k < NET_SEGS; k++) this.gFront.fillCircle(px[k], py[k], 1.8)
    }
  }
}
