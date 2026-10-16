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
  CAM_ZOOM, MOUNT_RING_R, SEAT_PORT_R, SEAT_MOUNTS, MAX_SEATS,
  SLOT_HW, SLOT_HD, TURRET_OUT,
  EMITTER_SIZE, SUB_D, HULL_H, BASE_SEATS, WEAPON_DEF,
  BONE, weaponFamily, LAYER_ECO, LAYERS, OFFER_N,} from '../shared/dive/tables'
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

/**
 * **远景鱼群的「远层」**（V6.81）。用户："每个场景底图都有冻结的鱼一样 是静态的 感觉很假"。
 *
 * ---------------------------------------------------------------------------
 * 为什么加（不是"多画一层"，是"接管一层"）
 * ---------------------------------------------------------------------------
 *   背景图里烘焙的鱼是**死的**：V6.70 的 `stepBgDrift()` 只能让整张图平移，
 *   于是**一群鱼以完全相同的速度和方向滑过去** —— 位图里的鱼不能摆尾、不能分层，
 *   无论图怎么动，读到的都是"照片在平移"。⇒ 背景图的鱼已全部去掉
 *   （`tools/defish_env.py`），**鱼只剩这一个来源**，所以：
 *     · 它必须比原来更耐看（近层＋远层 = 有纵深，不是一张平铺的贴纸）；
 *     · 它必须老实会动（摆尾相位逐条错开 + 与 `scrollV` 同一个速度场）。
 *
 * ⚠️ 四条系数都**小于 1**，且方向一致 —— 远 = 小 / 淡 / 慢，这是唯一的深度线索。
 * ⛔ 别把 `alphaMul` 调上去"让鱼更清楚"：远景鱼抢眼 = 玩家分不清哪个能打
 *    （敌人定位铁律：远景鱼**不可瞄准、不碰撞**，视觉上也必须明显更弱）。
 */
const FAR_FISH = {
  /** 条数 = 近层 × 0.6 */
  ratio: 0.6,
  /** 尺寸 = 近层 × 0.45（L1 近层 26px ⇒ 远层 ~12px） */
  sizeMul: 0.45,
  /** 速度 = 近层 × 0.35（越远越慢） */
  spdMul: 0.35,
  /** 不透明度 = 近层 × 0.5 */
  alphaMul: 0.5,
  /** 更大的团（远层密集成点会读作"屏幕脏了"，见 `buildSchools` 的注释） */
  perCluster: 8,
  /** 团更散 */
  spread: 78,
}

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
 * **背景出血系数**（V6.70）。cover 之外再放大这么多，给背景漂移留出可动范围。
 *
 * ⚠️ 与 `stepBgDrift` 的位移幅度**必须成对**：图 1536×984 覆盖 1304×749 时
 *    横向本来就刚好（scale 由宽决定），纵向多出约 84px；乘 1.07 后四周各多约 45px。
 *    漂移幅度 ±26/±16 远小于它 ⇒ 任何时刻都不会露边。
 *    ⛔ 只改漂移不改这个系数 = 屏幕边缘露底色（症状：画面四周一条黑边在闪）。
 */
const BG_BLEED = 1.07
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
/**
 * 换带 crossfade 的**垂直轻推幅度**（px，V6.81）。
 *
 * 用户："不同层之间的衔接没有做好"。原来两张图只是**原地交叉淡入**（旧图在上淡出），
 * 过渡期读作"两张照片叠在一起"的双影。改成**垂直推移**：新图从下方进入、旧图向上移出
 * —— 方向与"我在往下沉 ⇒ 东西向上掠过"（`SCROLL_BASE` 的符号约定）**一致**，
 * 于是它读作"我沉进了新的一层"，而不是"图层交叉淡入"。
 *
 * ⚠️ **必须 < 纵向出血**：`BG_BLEED` 1.07 下纵向各多 ≈72px，而 `stepBgDrift` 还占 ±16
 *    ⇒ 40 + 16 = 56 < 72，安全。⛔ 调大这个数要同时核 `BG_BLEED`（超了就是屏幕上下露黑边）。
 * ⛔ **不能推到半屏**（那要 ~350px）：现有图纵向只有 ~145px 的余量，
 *    真要做"整屏推入"必须新出 1536×1180 的无缝图（V6.56 §3 已记）。
 */
const XFADE_PUSH = 40
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
 * **位图机体**（V6.75）的摆放参数 —— 由 `tools/prep_sub_art.py` 打印，换图必须同步。
 *
 * 语义：贴图是一张**画布**，画布中央有一块"躯干矩形"（= `SUB_D × HULL_H` = 88×56），
 * 指挥塔与尾鳍作为**出血**伸出躯干矩形之外（所以画布比 88×56 大）。
 *   · `w/h`  = 画布尺寸（1x px）
 *   · `cx/cy`= **躯干中心**在画布中的占比 ⇒ 由它反推节点该摆在哪（见 `syncSub`）
 *
 * ⚠️ 为什么必须精确：挂点（`SEAT_MOUNTS`）是按 `SUB_D/HULL_H` 归一化的，
 *   而位图的剪影在产出时已被 `HULL_OUTLINE` 裁过 ⇒ **只要躯干矩形对齐，
 *   6 个炮位就必然落在机体上**。这四个数字错了，炮会整体平移出艇身 ——
 *   **不报错，只是看着炮飘在旁边**。
 * ⚠️ `HULL_H` 是唯一真源（`shared/dive/tables.ts`）；这里只写"画布比例"。
 */
const SUB_HULL = {
  w: 102.0,           // 408 / 4
  h: 84.75,           // 339 / 4
  cx: 0.5000,         // (28 + 352/2) / 408
  cy: 0.5841,         // (86 + 224/2) / 339  —— >0.5：塔在画布上方
} as const

/**
 * 发射槽**槽口**相对座心的法向外移量（px）。
 *
 * 座心（`SEAT_MOUNTS`）落在艇缘内侧约 0.8~1.0px（见 `tables.ts` 的注释，
 * 六座的实测值都在这一档），而位图上挖的槽是**从艇缘往下**的
 * ⇒ 槽口在座心**外侧**约 0.9px。取 0.8：封板的外缘于是刚好压在艇缘上。
 * ⚠️ 取大了（试过 1.8）封板会**浮在艇缘之上**变成一个小舌片 —— 剪影上看得出来，
 *   而那正是本轮要消灭的"画上去的凸出物"。
 */
const SLOT_EDGE_OFF = 0.8

/**
 * ⚠️ **V6.71：`HULL_H` 已搬到 `shared/dive/tables.ts`** —— 座位挂点表`SEAT_MOUNTS`
 *   的 `v` 分量要拿"机体半高"做归一化，两者必须同源，所以它属于数值表而不是渲染层。
 *   本文件改`import { HULL_H }`（见文件头的 tables 导入）。
 *
 * ---------------------------------------------------------------------------
 * 历史：`HULL_H` 曾定义在下面这段注释所描述的位置（V6.54 侧视改造时新增）。
 * ---------------------------------------------------------------------------
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

/**
 * 机体侧视**轮廓**（归一化：x ∈ [-1,1] 沿艇长，y ∈ [-1,1] 沿艇高，**艏在 +x**）。
 *
 * 14 点梭形：艏艉都是**圆钝端面**（竖边收口），背腹平直 —— 这是潜艇剖面，
 * 不是鱼（鱼是尖艏薄艉）。**这是整条侧视读法的载体**：换成正圆或对称椭圆
 * 立刻退回"橄榄球"，那是俯视残影。
 *
 * ⚠️ **这一组点与 `SEAT_MOUNTS` 的 v 分量数值耦合**（V6.71），不是随手画的：
 *   y 用满 [-1,1] ⇒ 机体半高 = `HULL_H/2` = 28，于是
 *     · `u = -0.10` 处轮廓 `v = -1.00`、`u = -0.52` 处约 `-0.93`、`u = -0.74` 处约 `-0.755`
 *       ⇒ 背脊三座的 `v = -0.96 / -0.93 / -0.87` 就是贴这条曲线取的（座心在轮廓内侧1~2px）
 *     · `u = -0.74` 处轮廓只剩 `v ≈ -0.755`（半高 21px），所以**没有第三排更靠艉的座位** ——
 *       再往后艇身就收得太窄，炮座会有一半悬空（那正是旧算法的问题）
 *   ⚠️ 改动轮廓点或改 `HULL_H` 都**必须重算 `SEAT_MOUNTS` 的 v**，
 *     否则炮位会脱离艇体（**不会报错，只会看起来"炮浮着"**）。
 *
 * ⚠️ `tools/preview_hull_side.py` 复刻了这一组点**和 `SEAT_MOUNTS`**，
 *    改这里必须同步改那个脚本，否则预览图会变成"骗人的图"（比没有预览更糟）。
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
  /** 背景慢漂移计时（V6.70）。与 `scrollV` 解耦，只跟时间走。 */
  private bgDriftT = 0
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
  /**
   * ⛔ **`subShadow` 已整体删除**（V6.77c —— 用户 2026-10-15：「我说的是截图这块的黑色」）。
   *
   * 它原来是**同一张机体贴图的近黑副本**（`col(0x040d14, 0.5)`）右下偏移 (5,8)。
   * 副本是**硬边**（贴图 alpha 直接乘 0.5，没有模糊），露在剪影之外的那部分
   * 读作「机体底下粘了一块黑胶布」，而不是"投影" —— 用户连着两轮报它
   * （上一轮的原话是「黑底遮罩」）。
   *
   * 📏 实机截图实测（`docs/shots/sub_shadow_ab.png`）：右端露出 6~8px、
   *    腹下露出 11px 的一条 luma≈59 的**硬边**暗带；同一处水体 luma 148
   *    ⇒ 反差 2.5×，而水下漫射光根本给不出这种硬边。
   *
   * ⚠️ **不要再把这段恢复**：潜航器是**漂在水里**的，不存在"地面投影"。
   *    真要"托一下"机体，做法是做一张**高斯模糊过**的软阴影位图
   *    （规格见 `docs/机体位图规格_V6.75.md` §9），⛔ 绝不是把贴图副本加回来。
   */
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
  /**
   * 当前查看中的槽位说明卡（V6.82）。`null` = 没有弹出。
   * `inspectT` 是它已展开的秒数（8s 自动收起，见 `update`）。
   */
  private inspect: { kind: 'seat' | 'relic'; i: number } | null = null
  private inspectT = 0

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
    this.bgDriftT = 0// 漂移相位归零，否则新开局第一帧背景会停在上一局的偏移上
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
    // （`subShadow` 已于 V6.77c 整体删除，这里不再需要显式关它。）
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

    // ⛔ `subShadow` 已整体删除（V6.77c）—— 理由见字段声明处那段注释。
    //    节点树因此变成 `gEnt → sub → fxBits → gPlayer`（少了一个常驻 Sprite）。

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
      // V6.83：商店位 3 → `OFFER_N`(5)，数字键同步扩到 DIGIT_5。
      // ⚠️ 键位必须与 `OFFER_N` 对齐 —— 少一处就会出现"画了 5 张但只能按 1~3 买"。
      if (k >= KeyCode.DIGIT_1 && k <= KeyCode.DIGIT_1 + OFFER_N - 1) {
        this.world.buyCard(k - KeyCode.DIGIT_1)
      }
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
    // ---- 槽位说明卡（V6.82）：点座圈 / 遗物槽 → 弹出该件东西的信息 ----
    // 用户 2026-10-15 两次：「点击座圈那几个发射物没有出来说明这个发射物的信息 …遗物也是」。
    // 状态放这里而不是 Hud：超时归零需要 dt，而 Hud 是纯绘制器（只有 `cardPeak` 一个
    // 例外）。8s 自动收起；再点同一槽 = 收起；点别的槽 = 换内容。
    if (this.inspect) {
      this.inspectT += dt
      if (this.inspectT > 8 || !combat) this.inspect = null
    }
    if (combat) {
      this.hud.drawCombat(w, {
        onPause: () => this.togglePause(true),
        inspect: this.inspect,
        onInspect: (kind, i) => {
          const cur = this.inspect
          this.inspect = cur && cur.kind === kind && cur.i === i ? null : { kind, i }
          this.inspectT = 0
        },
      })
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
      // ⚠️ **V6.70：必须多留一圈"出血"**。原版严格 cover（`s = max(W/iw, H/ih)`），
      //    画面正好被铺满 —— 一旦给背景图加任何位移（见 `stepBgDrift`），
      //    屏幕边缘立刻露出底色，症状是"画面四周在闪一条黑边"。
      //    ⇒ 按 `BG_BLEED` 放大，位移幅度**必须小于**多出来的那一半，两条一起改。
      const s = Math.max(this.W / iw, this.H / ih) * BG_BLEED
      const ut = this.bgNode.node.getComponent(UITransform)!
      ut.setContentSize(iw * s, ih * s)
      this.bgNode.node.setPosition(this.W / 2, this.H / 2)
    }
    this.bgNode.node.active = true
  }

  /**
   * **背景缓慢漂移**（V6.70 · 用户："背景图贴死的一动不动的鱼群 肯定是不合理的"）。
   *
   * 问题：五张 env 图里的鱼是**画在位图上**的 —— 不管 `scrollV` 多大，它们永远钉在
   * 同一个像素上。而中景/近景的海雪在动 ⇒ 玩家看到"近处的水在流、远处的鱼钉死"，
   * 这在物理上是矛盾的（同一片水里没有哪一层是静止的），也是"背景像贴图"的直接来源。
   *
   * 做法：让**背景图本身**以极慢的 Lissajous 轨迹平移（横向 + 纵向不同周期，
   * 合成一个不重复的慢循环）。于是图上的鱼群整体缓慢横移 —— 不用重出图，
   * 也不用逐条给鱼做动画（位图里的鱼本来也动不了）。
   *
   * ⚠️ 三条硬约束：
   *   ① 幅度**远小于** `BG_BLEED` 留出的出血（±26px vs 出血 ~90px）⇒ 永不露边。
   *   ② 速度**极慢**（周期 31s / 47s）—— 这是"远景视差"，快了就是"背景在飘"。
   *   ③ **与 `scrollV` 解耦**：下潜爆冲时背景不该跟着猛冲（爆冲是水在流，不是画在动），
   *      慢漂移只跟时间走。中景/近景已经承担了速度感。
   */
  private stepBgDrift(dt: number): void {
    this.bgDriftT += dt
    const t = this.bgDriftT
    const x = this.W / 2 + Math.sin(t / 31) * 26
    const y = this.H / 2 + Math.sin(t / 47 + 1.7) * 16

    // V6.81 换带「垂直轻推」：新图从下方进入（-PUSH → 0），旧图向上移出（0 → +PUSH）。
    // ⚠️ 节点 y 是**上为正**（`syncSub` 里 `ny = H - simY` 是同一套坐标），
    //    所以"从下方来"是 **负** 偏移 —— 写反了它就从上方掉下来，且不报错。
    let dyNew = 0
    let dyOld = 0
    if (this.xfadeT >= 0) {
      const k = Math.min(1, this.xfadeT / XFADE_DUR)
      dyNew = (1 - k) * -XFADE_PUSH
      dyOld = k * XFADE_PUSH
    }

    this.bgNode.node.setPosition(x, y + dyNew)
    // 旧图（crossfade 用）必须**同步跟着漂**，否则过渡那 2s 里两张图会相对滑动
    if (this.bgNodeOld.node.active) this.bgNodeOld.node.setPosition(x, y + dyOld)
  }

  /**
   * 潜航器机体的**摆放**（V6.75 起机体是**位图**，不再由 `drawBody()` 画）。
   *
   * 用户 2026-10-15 拍板：「机体不要用矢量画，要有立体感、真实美感、挂点要对」。
   * 矢量那套的硬天花板是 `Graphics` **无渐变 / 无模糊 / 无笔触** —— 56px 量级上
   * 怎么调都只是"一块有明暗的板"，所以艇身整体换成 `sub_hull` 位图。
   *
   * ---------------------------------------------------------------------------
   * 挂点为什么仍然对得上（这是本次改造的关键，别改坏）
   * ---------------------------------------------------------------------------
   *   位图在**产出阶段**就被处理成「躯干矩形 == `SUB_D × HULL_H`」：
   *   `tools/prep_sub_art.py` 把 AI 出图抠底后**各向异性缩放**到 88×56，
   *   再用 `HULL_OUTLINE` **裁掉轮廓之外的 alpha**（塔/鳍的出血保留）。
   *   ⇒ 渲染层只要把"躯干矩形"对准 `(w.px, w.py)`，`SEAT_MOUNTS` 的 6 个炮位
   *     就必然落在机体上。**这几个数字错了不会报错，只会让炮整体平移出艇身。**
   *
   * ⚠️ 三件容易漏的事：
   *   ① **y 取反**：`Gfx` 的世界 y 是 `H - simY`（见 `Gfx.y()`），而 Sprite 是裸节点
   *      —— 它不经过 `Gfx` 包装，必须自己翻。
   *   ② **镜像只翻 x**（`scale.x = faceX`）：船不会翻身，只会掉头。
   *      位图必须跟着翻，否则艏艉与塔的前后位置对不上朝向。
   *   ③ **投影节点已删除**（V6.77c）：它原来是 `gPlayer` 之下的一个
   *      "同形近黑副本"，硬边露在剪影之外 ⇒ 读作"机体底下粘了块黑胶布"。
   *      理由与被删的实测数据见字段声明处那段注释。
   */
  private syncSub(w: DiveWorld): void {
    this.updateFace(w)

    const sf = this.artLoaded ? this.art.get('sub_hull') : null
    const n = this.subNode.node
    if (!sf) {
      // 缺图：位图关掉，但**不能退回矢量机体**（V6.75 已整段删除）。
      // 机体仍由 `drawBody` 的导轨 / 插座 / 炮 + 霓虹轮廓兜底 —— 能玩、能定位。
      n.active = false
      return
    }

    this.subNode.spriteFrame = sf

    const nx = w.px + (0.5 - SUB_HULL.cx) * SUB_HULL.w
    const ny = this.H - (w.py - (SUB_HULL.cy - 0.5) * SUB_HULL.h)

    const ut = n.getComponent(UITransform)!
    ut.setContentSize(SUB_HULL.w, SUB_HULL.h)
    n.setScale(this.faceX, 1)
    n.setPosition(nx, ny)
    n.active = true
  }

  /**
   * 朝向镜像（每帧一次，离散）。**单一入口** —— `syncSub`（在位图摆放前）调用，
   * `drawPlayer` 不再自己更新（两处更新会差一帧，位图的朝向与炮位的朝向就对不上）。
   */
  private updateFace(w: DiveWorld): void {
    const wantX = Math.cos(w.aim)
    if (wantX > 0.25) this.faceX = 1
    else if (wantX < -0.25) this.faceX = -1
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
      // ⚠️ V6.70 加内爆环：暴击已经够响了，但**内圈**空着 ⇒ 大部分覆盖仍落在鱼体外围。
      this.pushShock(ev.x, ev.y, ev.r * 1.5, 0.19, UI.violet, 2.8, ev.r, 1)
      this.pushShock(ev.x, ev.y, ev.r * 0.72, 0.11, 0xffffff, 3, ev.r * 0.32, 1)
      this.pushSlash(ev.x, ev.y, ang, 1.8, UI.violet)
      this.pushSparks(ev.x, ev.y, ang, UI.violet, 7)
      this.pushSparks(ev.x, ev.y, ang, 0xffffff, 3)
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
        // ⚠️ V6.70 加一层**收紧环**：网命中要读作"网正在收拢"，而不是"鱼身上多了个 X"。
        //   同源铁律：⛔ 不用池化之外的手段（见 default 分支的双⛔⛔ 注释）。
        this.pushShock(ev.x, ev.y, ev.r * 0.9, 0.16, UI.jade, 2, ev.r * 0.34, 1)
        return
      case 'bite':
        // 内讧撕咬：品红。**不与玩家造成的伤害共用颜色** ——
        // 玩家要能区分"这是我打的"和"它们在自相残杀"，否则会以为自己漏了输出。
        this.pushShock(ev.x, ev.y, ev.r * 1.15, 0.14, 0xff4fd8, 1.8, ev.r * 0.48, 1)
        this.pushSparks(ev.x, ev.y, ang, 0xff4fd8, 3)
        return
      default:
        // 弹丸（枪弹 / 鱼叉 / 鱼雷直击）：方向感最完整的一套。
        // ⚠️ **V6.70 加厚**（用户："技能buff受击特效不够丰满"）。原来三层都偏薄：
        //   环 r×1.35 / 斩击 26px / 火花 4 颗 ⇒ 打在一条 20px 的鱼身上，
        //   实际覆盖不到鱼体 1/3，看起来就是"鱼身上闪了一下"，不是"被打中了"。
        //   现在按四件事各给一层：
        //     ① 冲击环（外）—— "被打中了"的整体位移
        //     ② 斩击痕      —— 沿弹道的方向感（**"子弹"与"爆炸"的唯一区别**）
        //     ③ 迸溅火花    —— 力量的实体感（4 → 7，且**双色**：本色 + 白芯）
        //     ④ **内爆环**  —— 贴着命中点的一圈小亮环（缺它前三层都在鱼体外围飘）
        //
        // ⛔⛔ **只能用池化图元，绝不能在这里 `this.gEnt.fill*`**：
        //    事件处理（`handleEvent`）发生在**每帧 clear 之前**（见 update 的顺序注释），
        //    直接往 Graphics 里画 ⇒ 同一帧就被 `gEnt.clear()` 抹掉，**且不报任何错**。
        //    这正是"三层静默失效"里的第三类（读一个从不被写的字段的同构版）。
        this.pushShock(ev.x, ev.y, ev.r * 1.35, 0.17, 0xdff4ff, 1.8, ev.r * 0.62, 1)
        // ④ 内爆环：小而快，半径只有外环的 1/2 ⇒ 读作"扎进去的那一下"而不是"第二个环"
        this.pushShock(ev.x, ev.y, ev.r * 0.66, 0.10, ev.color, 2.6, ev.r * 0.30, 1)
        this.pushSlash(ev.x, ev.y, ang, 1.35, ev.color)
        this.pushSparks(ev.x, ev.y, ang, ev.color, 5)
        this.pushSparks(ev.x, ev.y, ang, 0xffffff, 2)
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

    // V6.73 击杀气泡 —— 深海死法独有的"尸体余韵"：2~3 颗慢速上飘的小泡。
    // 火星迸溅到处都有，但"气泡从尸体位置升走"只有水下成立 ——
    // 它是"刚死的是一条活鱼"的视觉签名，成本 3 个池化图元。
    for (let i = 0; i < 3; i++) {
      this.sparks.push({
        x: ev.x + (Math.random() - 0.5) * ev.r, y: ev.y + (Math.random() - 0.5) * ev.r * 0.6,
        vx: (Math.random() - 0.5) * 14, vy: -26 - Math.random() * 20,
        life: 0.55, maxLife: 0.55, color: 0xbfe8ff, size: 1.4 + Math.random() * 1.2,
        ang: -Math.PI / 2, kind: 'flash',
      })
    }

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
      case 'eshotDown':
        this.eshotDownFx(ev)
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
        // V6.74：光有"环 + 反光"只是"闪了一下"。补两样才读作"炸"：
        //   · 被抛出的**破片**（径向火花，橙色 —— 与水的青蓝对立，一眼看见）
        //   · 一圈比爆心更大的**外扩冲击环**（爆炸把周围的水推开）
        this.pushRadialSparks(ev.x, ev.y,
          Math.min(14, 6 + Math.round(ev.r * 0.05)), 90, 130, 2.2, 0xffb347)
        this.pushShock(ev.x, ev.y, ev.r * 1.6, 0.34, 0xffd166, 2.2, ev.r * 0.10, 1)
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
      case 'playerHurt': {
        // V6.80（用户：「我方收到攻击不要全屏 只需要我身上有特效」）：
        //   全屏红带已删（见 `drawVeil`）。受击反馈**全部落在自机上**，三样：
        //     ① 自机冲击环（短促 + 小半径 ⇒ "我被打了一下"，不是"炸了"）
        //     ② 受击面溅射：`dirX/dirY` = **从玩家指向伤害来源** ⇒ 火花朝**反方向**溅
        //        （"从那个方向打进来、碎片往里飞"，与 `hurtDir` 的语义对齐）
        //     ③ 方向弧由 `drawPlayer` 每帧按 `hurtDirT` 画（持续 0.6s，比这两样长）
        const px = this.world.px, py = this.world.py
        const ia = Math.atan2(ev.dirY, ev.dirX)
        this.pushShock(px, py, 40, 0.20, UI.danger, 2.4, 14, 1)
        for (let i = 0; i < 8; i++) {
          const a = ia + Math.PI + (Math.random() - 0.5) * 1.7
          const sp = 100 + Math.random() * 140
          this.sparks.push({
            x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.22, maxLife: 0.22, color: i < 2 ? 0xffffff : UI.danger,
            size: 1.6 + Math.random() * 1.5, ang: a, kind: 'hit',
          })
        }
        this.trimSparks()
        break
      }
      // 以下事件本切片不产生额外表现（相位可直接读 world 字段）：
      //   dodge、wave / layerCleared
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
        // V6.78：传**整份**击杀列表（两个 Boss 是两条图鉴），不再是布尔量
        bossesDown: [...w.bossesDown],
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
    // ⓪ 背景慢漂移（V6.70）—— 必须排在 crossfade 之前，让 `bgNodeOld` 拿到同一位置。
    this.stepBgDrift(dt)

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
    // ⛔ **全屏方向性受击红带（V6.80 删除）**
    // 用户 2026-10-15：「我方收到攻击不要全屏 只需要我身上有特效 不要蔓延到其他敌方」。
    //   旧版按受击来向在**整个屏幕高度**上铺 6 条红带（每条横贯 vr.h）——
    //   它把"我挨了一下"读成了"整个画面在受击"，连画面里的敌人都被染红，
    //   这正是用户说的"蔓延到其他敌方"。
    //   ⇒ 判据：**受击是自机身上的事** ⇒ 来向信息改由「机身上的受击弧 +
    //      自机冲击环 + 受击面溅射」三样承担（见 `drawPlayer` 的受击弧与
    //      `handleEvent` 的 `playerHurt`）。屏幕层（`gVeil`）不再参与受击表达。
    //   ⚠️ `w.hurtDirT / hurtDirX / hurtDirY` **没有变成死字段** —— 两个消费点都在上面那两处。
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

    // ⚠️ **必须成团，不能均匀撒满**（2026-10-14）：旧版 `x`/`y` 各自独立随机
    //    ⇒ 屏幕上是一层**均匀的点**，读作"雪花 / 星星 / 屏幕脏了"，**不是鱼群**。
    //    真实的鱼群是"几团密集 + 大片空白"。**同样 46 条鱼，成团之后才第一次
    //    读得出"一群鱼"** —— 用户报的"背景的白色"有一半是这一条（另一半是漏 clear）。
    const big = eco.schoolSize > 2
    const sizeBase = 26 * eco.schoolSize

    // 近层（V6.53 原有口径）：团密（6 条/团），速度 12~32；深渊巨影慢（6~12）
    this.pushSchool(eco.school, big ? 1 : 6, 62, sizeBase,
      big ? 6 : 12, big ? 12 : 32, aLo, aHi)
    // 远层（V6.81）：小 / 淡 / 慢，补"画面里有生物"且**全部会动**
    this.pushSchool(eco.school * FAR_FISH.ratio, FAR_FISH.perCluster, FAR_FISH.spread,
      sizeBase * FAR_FISH.sizeMul,
      (big ? 6 : 12) * FAR_FISH.spdMul, (big ? 12 : 32) * FAR_FISH.spdMul,
      aLo * FAR_FISH.alphaMul, aHi * FAR_FISH.alphaMul)
  }

  /**
   * 远景鱼群的**一层**（近层 / 远层共用）。
   *
   * 为什么抽成函数而不是复制一段：两层的生成规则**完全相同**，只有系数不同
   * —— 复制一份之后，改近层（比如"同团同速"的抖动范围）必然忘记远层，
   * 而这类漂移**不报错**，只会让远层慢慢变成"另一种鱼"。
   */
  private pushSchool(cnt: number, perCluster: number, spread: number, size0: number,
                     spdLo: number, spdHi: number, aLo: number, aHi: number): void {
    const clusters = Math.max(1, Math.round(cnt / perCluster))
    for (let c = 0; c < clusters; c++) {
      // 团心留 40px 边距：整团贴在屏幕边上会读作"被裁掉了"
      const cx0 = 40 + Math.random() * (this.W - 80)
      const cy0 = 40 + Math.random() * (this.H - 80)
      // **同团同向**：一群鱼朝同一个方向游才叫群；每条各自随机 = 一锅乱炖
      const dir = Math.random() < 0.5 ? -1 : 1
      // **同团同速**（±12% 抖动）：速度差太大会把团拉成长条，几秒后就散掉
      const spd = spdLo + Math.random() * (spdHi - spdLo)

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

    // ---- 声呐波前（V6.80 重做）----
    // 用户 2026-10-15：「声纳往外扩 感觉没有什么特色 参考其他游戏 做做创新 扩的圈子是不是太大了」
    //   旧版 = 两条**完整同心圆**（一条粗低透 7px + 一条细高亮 1.6px）⇒ 读作"一个空圈在变大"：
    //   既没有"声呐"的身份（换成任何武器都成立），又在 420px 半径上横跨整个屏幕（"太大"）。
    // ★ 新形态 = **三重递减波前 + 声呐束纹 + 距离衰减**，三条同时解决"没特色 / 太空 / 太大"：
    //   ① 三重波前：主前（亮）+ 两道**滞后回声**（0.83r / 0.66r，更暗更细）——
    //      这是"脉冲在介质里拖出回响"的形状，不是"一个圈"。
    //      ⚠️ 滞后环**共用同一个 `p.r` 做基准**（不是各扩各的）——各扩各的会读成
    //         "三个独立武器同时开火"，那正好毁掉"这是一个脉冲"的语义。
    //   ② 声呐束纹：沿主前均布 24 道**短径向齿**（声呐屏的刻度语汇），整组缓慢自转。
    //      ⛔ 相位**不用 `Math.random()`** —— 同帧多道波前时随机相位会让画面抖
    //         （与爆炸破片同一条判据，见 `blasts` 的注释）。
    //   ③ 距离衰减：`fade = 1 − 0.72k` ⇒ **外圈自己淡掉**，玩家感知到的范围自然收回
    //      （这是"看起来没那么大"的正确解法）。
    //      ⛔ **绝不为好看去缩视觉半径** —— 视觉必须画在**真实判定半径**上
    //         （`p.maxR` 就是伤害半径），画小了就是骗判定。真要变小得改 `range`，那是配平。
    for (const p of w.pulses) {
      if (!p.alive || p.r < 1) continue
      const k = Math.max(0, Math.min(1, p.r / Math.max(1, p.maxR)))
      const fade = 1 - k * 0.72
      // ① 三重递减波前
      for (let i = 0; i < 3; i++) {
        const rr = p.r * (1 - i * 0.17)
        if (rr < 1) continue
        const a = fade * (i === 0 ? 1 : 0.46 - i * 0.12)
        this.gBack.line(0x4fe8ff, 0.20 * a, i === 0 ? 6 : 3)
        this.gBack.strokeCircle(p.x, p.y, rr)
        this.gBack.line(0xc8f8ff, (i === 0 ? 0.62 : 0.28) * a, i === 0 ? 1.6 : 1.1)
        this.gBack.strokeCircle(p.x, p.y, rr)
      }
      // ② 声呐束纹（整组缓慢自转；齿**不长在半径上** ⇒ 波前推进时齿不会变形）
      this.gBack.line(0xc8f8ff, 0.34 * fade, 1.2)
      for (let i = 0; i < 24; i++) {
        const a2 = (i / 24) * Math.PI * 2 + this.fxT * 0.9
        const t0 = p.r * 0.965, t1 = p.r * 1.045
        this.gBack.strokeSeg(p.x + Math.cos(a2) * t0, p.y + Math.sin(a2) * t0,
          p.x + Math.cos(a2) * t1, p.y + Math.sin(a2) * t1)
      }
    }

    // ---- 回声标记 ----
    for (const e of w.echoes) {
      const k = 1 - Math.max(0, e.t / 0.75)
      this.gBack.line(0xff4fd8, 0.75, 2); this.gBack.strokeCircle(e.x, e.y, Math.max(1, 130 * k))
      this.gBack.fill(0xff4fd8, 0.9); this.gBack.fillCircle(e.x, e.y, 4)
    }

    // ---- 爆炸（V6.74：从"一圈细环"升级为**冲击波 + 核心闪 + 破片**）----
    // 用户：「发出去的爆破 要加上爆破物在远处 爆破特效」——
    //   旧版只有一圈 3px 金环（`0xffd166`，alpha `0.7*(1-k)`），在满屏拖尾里它读作
    //   "扫过去一道光"，**不像"炸了一下"**。爆炸要成立至少得有三层：
    //     ① 冲击波（外环 + 一圈**迟半步**的内环）—— 内环延迟才有"波在往外推"的物理感，
    //        同步扩的两个圈读作"一个圈变粗了"；
    //     ② 核心闪（白 → 金 → 橙，**同 α 由外向内叠**并随 k 收缩）—— 光的体积
    //        只能靠覆盖次数堆，⛔ 不能用径向渐变、⛔ 不能用内层分档 alpha（=靶环）；
    //     ③ 破片（8 条沿半径飞出的短楔）—— 唯一能读出"有东西被炸飞了"的元素。
    //   ⚠️ 破片角度不用 `Math.random()`：同帧多声爆炸时随机相位会让画面"跳"，
    //      改用固定步长 + 与 `b.r` 相关的常量相位 ⇒ 每次爆炸形状一致。
    //   ⚠️ 核心闪画在 `gFront`（爆炸的亮芯应该在机体/敌人之上），冲击波留在 `gBack`。
    for (const b of this.blasts) {
      const k = 1 - Math.max(0, b.life / 0.32)     // 0 → 1
      const kr = b.r * k
      // ① 冲击波：外环（随 k 变细）+ 内环（迟 22% 起跑）
      this.gBack.line(0xffd166, 0.78 * (1 - k), 3.6 * (1 - k) + 0.9)
      this.gBack.strokeCircle(b.x, b.y, kr)
      const k2 = (k - 0.22) / 0.78
      if (k2 > 0 && k2 < 1) {
        this.gBack.line(0xfff2c0, 0.5 * (1 - k2), 2); this.gBack.strokeCircle(b.x, b.y, b.r * k2)
      }
      // ② 核心闪：亮芯存在时间只有冲击波的 2/3（"闪"比"波"短，这是爆炸的节奏）
      const cf = Math.max(0, 1 - k * 1.5)
      if (cf > 0.01) {
        this.gFront.fill(0xff8a3c, 0.16 * cf); this.gFront.fillCircle(b.x, b.y, kr * 0.60)
        this.gFront.fill(0xffd166, 0.22 * cf); this.gFront.fillCircle(b.x, b.y, kr * 0.36)
        this.gFront.fill(0xffffff, 0.44 * cf); this.gFront.fillCircle(b.x, b.y, kr * 0.15)
      }
      // ③ 破片：短楔从 `0.45r` 处起跑，长到 `0.30r`
      if (k > 0.12 && k < 0.86) {
        const fr = (k - 0.12) / 0.74
        const L = b.r * 0.30 * fr
        this.gBack.line(0xffb347, 0.75 * (1 - fr), 2.2)
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + b.r * 0.07
          const r0 = b.r * (0.45 + 0.55 * fr)
          this.gBack.strokeSeg(
            b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0,
            b.x + Math.cos(a) * (r0 + L), b.y + Math.sin(a) * (r0 + L),
          )
        }
      }
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
        // ④ **实体弹体**（V6.70 · 用户："发射的子弹能做成实体的子弹打出去吗"）
        //    旧版枪弹是"一条拖尾 + 一个亮圆点" —— 无论拖尾多长，它永远是**一个点**。
        //    玩家看到的不是"打出去了什么东西"，而是"这里闪过一道光"。
        //    现在按 torpedo 的弹体轮廓做，但**更细更长更亮**（枪弹是高速轻武器）：
        //      尖头 → 身尾 → 尾翼 → 身尾，四点围成，描边 + 半透填色 + 头部亮点。
        //    ⚠️ 比例必须比鱼雷**细**（`Half` 3.4→2.2）：同样是 15px 长时，
        //    一样粗就分不清"这是子弹还是鱼雷"，两种武器的辨识度就没了。
        const Nose = 7.5, Tail = 9, Half = 2.2
        const gunBody = () => {
          this.gEnt.moveTo(b.x + ux * Nose, b.y + uy * Nose)                             // 弹头尖
          this.gEnt.lineTo(b.x - ux * Tail + px2 * Half, b.y - uy * Tail + py2 * Half)   // 身尾·右
          this.gEnt.lineTo(b.x - ux * (Tail + 3.5) + px2 * (Half + 2.2),
            b.y - uy * (Tail + 3.5) + py2 * (Half + 2.2))                              // 尾翼·右
          this.gEnt.lineTo(b.x - ux * (Tail + 3.5) - px2 * (Half + 2.2),
            b.y - uy * (Tail + 3.5) - py2 * (Half + 2.2))                              // 尾翼·左
          this.gEnt.lineTo(b.x - ux * Tail - px2 * Half, b.y - uy * Tail - py2 * Half)   // 身尾·左
          this.gEnt.close()
        }
        // ① 四层递减拖尾（**从弹尾之后**起画，不要盖住弹体）
        for (let i = 0; i < 4; i++) {
          const L0 = 12 + i * 7, L1 = L0 + 8
          neonLine(this.gEnt,
            b.x - ux * L0, b.y - uy * L0, b.x - ux * L1, b.y - uy * L1,
            c, { width: 3.4 - i * 0.7, alpha: 0.9 / (i + 1.4), bloom: false })
        }
        // ② 外发光晕（两层同心低透明圆，保证深色层也发光）
        this.gEnt.fill(c, 0.20); this.gEnt.fillCircle(b.x, b.y, 6.5)
        this.gEnt.fill(c, 0.38); this.gEnt.fillCircle(b.x, b.y, 3.4)
        // ③ 弹体：描边 ← `neon` 会连画两层，每层都必须**重新组一遍路径**
        neon(this.gEnt, c, () => { gunBody(); this.gEnt.stroke() },
          { width: 1.6, alpha: 1, bloom: false })
        this.gEnt.fill(c, 0.52); gunBody(); this.gEnt.fillPath()
        // ④ 头部亮点（弹头必须是全屏最亮的东西之一 —— 那是"往哪打"的唯一指示）
        this.gEnt.fill(0xffffff, 0.95); this.gEnt.fillCircle(b.x + ux * 3.4, b.y + uy * 3.4, 2)
      } else if (b.kind === 'net') {
        // 网（**V6.82 重做"飞行态"**）
        // 用户 2026-10-15：「撒网**不要把那个不规则的网显示出来** 只显示击中时候的特效」。
        //   V6.80 的"自转网兜 + 收口索 + 铅坠 + 牵引绳"在实机尺寸下就是一团
        //   不规则的线 —— 玩家读不出"网"，只读出"一坨乱线在飞"。
        //   而且**判定在 `openNet` 张开那一瞬才成立**（`world.openNet`），飞行途中
        //   画成网反而让玩家以为路上就有判定范围。
        // ⇒ 飞行态收敛成**一颗收拢的投掷物**（与商店卡 `fam === 'net'` 的"收拢网束"
        //   同一读法）：小梭形 + 短拖尾；"网"的全部信息留给**命中那一瞬**的
        //   张网特效（`case 'net'` 的网目弧）与捆住态的缠绕绳圈。
        const c = b.net === 'net_el' ? UI.violet : b.net === 'net_cv' ? UI.cyanHi : UI.jade
        // ① 短拖尾（两层递减）
        for (let i = 0; i < 2; i++) {
          const L0 = 7 + i * 6, L1 = L0 + 7
          neonLine(this.gEnt,
            b.x - ux * L0, b.y - uy * L0, b.x - ux * L1, b.y - uy * L1,
            c, { width: 2.6 - i * 0.8, alpha: 0.7 / (i + 1.3), bloom: false })
        }
        // ② 收拢的网束：沿弹道略长的实心梭形（有体积，不是一条线）
        const NL = 7.5, NW = 3.4
        const pouch = () => {
          this.gEnt.moveTo(b.x + ux * NL, b.y + uy * NL)
          this.gEnt.lineTo(b.x - uy * NW, b.y + ux * NW)
          this.gEnt.lineTo(b.x - ux * NL * 0.7, b.y - uy * NL * 0.7)
          this.gEnt.lineTo(b.x + uy * NW, b.y - ux * NW)
          this.gEnt.close()
        }
        this.gEnt.fill(c, 0.30); pouch(); this.gEnt.fillPath()
        neon(this.gEnt, c, () => { pouch(); this.gEnt.stroke() },
          { width: 1.4, alpha: 0.95, bloom: false })
        // ③ 头部亮点（"往哪扔"的唯一指示）
        this.gEnt.fill(0xffffff, 0.9); this.gEnt.fillCircle(b.x + ux * 4, b.y + uy * 4, 1.6)
      } else if (b.kind === 'torpedo') {
        // ---- 追踪鱼雷（V6.80 重做）----
        // 用户 2026-10-15：「追踪鱼雷 红色有点突兀 而且这个三角形也不合适吧 不应该是个鱼雷状么」
        // 两处硬伤，逐条对应：
        //   ① **颜色**：旧版走 `UI.danger`（纯红）—— 而 `danger` 的定位是
        //      「全场唯一纯红，只允许用在**致命预警**」（见 `theme.ts`）⇒
        //      玩家自己的弹体染成预警色，分不清"这是危险还是我的武器"。
        //      ⇒ 改 `UI.ember`（暖橙 · 爆破物专属色）。
        //   ② **形状**：旧版与鱼叉共用同一套轮廓（"尖头 → 身尾 → 尾翼"）⇒
        //      前段一路收成一个尖 ⇒ 读作一个**三角锥**（用户说的"三角形"），不是鱼雷。
        //      ★ 鱼雷的剪影判据（= 它与子弹 / 箭的分界），三条缺一不可：
        //        · 头**钝圆**（尖 = 子弹/箭的语汇，收了尖就一定读成"箭头"）
        //        · 身**等宽**（上下两条平行线 ⇒ 有"桶"感；锥形是火箭，不是鱼雷）
        //        · 尾翼**张得比身宽**（否则看不出它靠什么在水里走直线）
        const c = UI.ember
        const RL = 10.5                                   // 身长（中心 → 头/尾）
        const RW = 3.2                                    // 身半径（等宽段）
        const NX = b.x + ux * RL, NY = b.y + uy * RL      // 弹头中心
        const TX = b.x - ux * RL, TY = b.y - uy * RL      // 弹尾中心
        // ① 螺旋桨气泡尾迹 —— **水里跑的不是焰火**，鱼雷的尾迹是气泡
        for (let i = 1; i <= 6; i++) {
          const q = i / 6
          const bx = TX - ux * i * 4.6, by = TY - uy * i * 4.6
          const wob = Math.sin(this.fxT * 10 + i * 1.6) * (2.0 + i * 0.55)
          this.gEnt.fill(c, 0.40 * (1 - q) + 0.06)
          this.gEnt.fillCircle(bx + px2 * wob, by + py2 * wob, 3.0 - q * 1.7)
        }
        // ② 外发光晕（深色层也要看得见）
        this.gEnt.fill(c, 0.18); this.gEnt.fillCircle(b.x, b.y, 11)
        // ③ 弹体：**等宽圆柱**（上下两条平行线）+ 描边 + 半透实心
        const tBody = () => {
          this.gEnt.moveTo(NX + px2 * RW, NY + py2 * RW)
          this.gEnt.lineTo(TX + px2 * RW, TY + py2 * RW)
          this.gEnt.lineTo(TX - px2 * RW, TY - py2 * RW)
          this.gEnt.lineTo(NX - px2 * RW, NY - py2 * RW)
          this.gEnt.close()
        }
        neon(this.gEnt, c, () => { tBody(); this.gEnt.stroke() },
          { width: 1.8, alpha: 1, bloom: false })
        this.gEnt.fill(c, 0.50); tBody(); this.gEnt.fillPath()
        // ④ **钝圆头**（实心圆）—— ★ 这一颗圆头就是"鱼雷"与"子弹 / 箭"的分界线
        this.gEnt.fill(shade(c, 0.88), 1); this.gEnt.fillCircle(NX, NY, RW)
        // ⑤ **后掠尾翼**（翼尖张到身的 1.85 倍宽、整个挂在**身尾之后**）—— 侧视只看得见上下两片。
        //    ⚠️ 翼展不能太大（第一版 2.5×）：翼比身宽一倍多时，剪影被翼吃掉 ⇒ 又读成"一个箭头"。
        //       1.85× + 翼根起点**退到身尾**（不再盖住圆柱段）⇒ 等宽身与圆头才露得出来。
        for (const sd of [-1, 1]) {
          this.gEnt.fill(shade(c, 0.92), 1)
          this.gEnt.moveTo(TX + px2 * sd * RW * 0.90, TY + py2 * sd * RW * 0.90)
          this.gEnt.lineTo(TX + px2 * sd * RW * 1.85, TY + py2 * sd * RW * 1.85)
          this.gEnt.lineTo(TX - ux * 5.0 + px2 * sd * RW * 1.15,
            TY - uy * 5.0 + py2 * sd * RW * 1.15)
          this.gEnt.close(); this.gEnt.fillPath()
        }
        // ⑥ **战斗部引信灯**（V6.74 判据：「它带着一颗会炸的东西」）——
        //    亮核 + 一圈随 `fxT` 呼吸的光环；环最亮那一瞬正好对应"它要炸了"。
        //    重型鱼雷（`er > 1`）环更大，与它"炸得更大"对得上。
        //    ⚠️ 光环半径**不能大过弹体太多** —— 1.8× 时那颗球会盖住"钝圆头"这个关键剪影，
        //       鱼雷又退回成"一坨光"。1.45× 刚好是"头上一圈光晕"而圆头仍然读得出来。
        const wr = 2.6 * (b.er ?? 1)
        const beat = 0.5 + 0.5 * Math.sin(this.fxT * 9 + b.life * 3)
        this.gEnt.fill(c, 0.30 + 0.30 * beat)
        this.gEnt.fillCircle(NX - ux * 3, NY - uy * 3, wr * 1.45)
        this.gEnt.line(0xffffff, 0.48 + 0.40 * beat, 1.2)
        this.gEnt.strokeCircle(NX - ux * 3, NY - uy * 3, wr * 1.05)
        this.gEnt.fill(0xffffff, 0.95)
        this.gEnt.fillCircle(NX - ux * 3, NY - uy * 3, 1.6)
      } else {
        // 鱼叉（jade）—— **穿刺武器**，走"细长 + 有厚度"的弹体轮廓。
        // ⚠️ 鱼叉**不画圆头 / 不画引信**（V6.74 立的判据）：鱼叉是扎进去的、没有战斗部，
        //    给它圆头或引信，就把"扎进去"读成"炸开"，两种武器的辨识度一起丢。
        const c = UI.jade
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

    // 敌方投射物（V6.83）：画在玩家子弹之后（最上层）—— 弹必须压得住鱼群，
    // 否则"一颗正在飞来的东西"会被 30 只鱼盖住，而它恰恰是最需要被看到的东西。
    this.drawEShots(w)

    this.drawPlayer(w)
  }

  /**
   * 敌人。分工与 web 一致：**贴图负责"具体形象"，2px 发光核心负责"可读性"**。
   * 核心必须有一条在贴图之上 —— 那是"每条鱼都能被定位"的铁律，远距离只剩一个点时靠它。
   */
  /**
   * **敌方投射物**（V6.83）。
   *
   * ★ 与玩家的子弹必须在**形状语汇**上分开，不能只靠颜色：
   *   玩家的弹 = **锐利弹体 + 长拖尾**（"打出去的东西"）
   *   敌方的弹 = **圆团 + 脉动环 + 短拖尾**（"飘过来的东西"）
   *   拖尾长度尤其关键 —— 它同时编码速度：玩家弹快（长尾），酸弹慢（短尾）。
   *
   * ⚠️ 坐标用 `gEnt` ⇒ **直接给 sim 坐标**（`Gfx` 层内部已做 y 翻转）。
   *    只有裸 Sprite 才需要 `this.H - y`（见 `drawEnemies` 的 `sp.node.setPosition`）。
   *    这两者写混了会得到"弹在屏幕上下镜像的位置"——**不报错、只是位置不对**。
   */
  private drawEShots(w: DiveWorld): void {
    if (!w.eShots.length) return
    const g = this.gEnt
    for (const s of w.eShots) {
      if (!s.alive) continue
      // 脉动：越接近到点越快（`life` 归零就是它爆开的时刻）—— 预警做在物体自己身上
      const near = 1 - Math.max(0, s.life) / 1.2
      const pulse = 1 + Math.sin(s.t * (12 + near * 18)) * (0.10 + near * 0.10)

      const sp = Math.max(1, Math.hypot(s.vx, s.vy))
      const ux = s.vx / sp, uy = s.vy / sp
      const px2 = -uy, py2 = ux

      // ① 酸雾外晕（两层低透明圆 ⇒ 深色层里也亮）
      g.fill(UI.magenta, 0.12); g.fillCircle(s.x, s.y, 15 * pulse)
      g.fill(UI.magenta, 0.24); g.fillCircle(s.x, s.y, 9.5 * pulse)
      // ② 短拖尾（**短**才读得出"它慢" —— 拖尾长度就是速度的编码）
      for (let i = 0; i < 3; i++) {
        const L0 = 9 + i * 7, L1 = L0 + 7
        neonLine(g, s.x - ux * L0, s.y - uy * L0, s.x - ux * L1, s.y - uy * L1,
          UI.magenta, { width: 3.0 - i * 0.6, alpha: 0.7 / (i + 1.3), bloom: false })
      }
      // ③ 酸团本体（不规则感：两个偏心圆叠一层，避免"完美圆点"的塑料感）
      g.fill(UI.magenta, 0.85)
      g.fillCircle(s.x, s.y, 6.4)
      g.fillCircle(s.x + px2 * 2.2 - ux * 1.6, s.y + py2 * 2.2 - uy * 1.6, 4.2 * pulse)
      // ④ 亮核
      g.fill(0xffffff, 0.92); g.fillCircle(s.x, s.y, 2.6)
      // ⑤ 脉动环：**"这是个会炸的东西"** —— 没有环它会被当成可以忽略的小点
      g.line(UI.magenta, 0.35 + near * 0.4, 1.5)
      g.strokeEllipse(s.x, s.y, 11 * pulse, 11 * pulse)
    }
  }

  /**
   * **敌弹被清除**（V6.83）。★ 用户明确要求"一定要考虑技能相关的特效" —— 就是这里。
   *
   * 五种 `cause` 必须画成**五句不同的话**，因为玩家要知道"我刚才是怎么处理掉它的"：
   * ```
   * blast 爆炸抵消 → 外扩冲击环（"炸掉了"，语汇同 explosion）
   * net   网拦截   → 向内收拢的网目（"网收走了"，与爆炸**方向相反**）
   * ram   撞角撞碎 → 一撮碎片 + 短促闪（"撞碎了"，语汇同 `hit`）
   * hit   打到玩家 → 玩家受击（`playerHurt` 自己会表现）⇒ 这里只补一个小爆
   * spent 到点爆开 → blast 环（它自己炸的，与"被抵消"共用 explosion 语汇）
   * ```
   * ⚠️ `blast` 与 `spent` 看起来一样是**故意的** —— 对玩家而言"它炸了"和"我把它炸了"
   *    的结果都是"不用躲了"，区别由**爆炸的来历**（玩家那一发有没有 muzzle/blast）交代。
   */
  private eshotDownFx(ev: Extract<SimEvent, { t: 'eshotDown' }>): void {
    switch (ev.cause) {
      case 'blast':
        this.pushShock(ev.x, ev.y, ev.r * 2.4, 0.22, UI.amber, 2.2, ev.r * 0.7, 1)
        this.pushRadialSparks(ev.x, ev.y, 5, 90, 40, 1.2, UI.amber)
        break
      case 'spent':
        this.pushShock(ev.x, ev.y, ev.r * 3.0, 0.26, UI.magenta, 2.4, ev.r * 0.8, 1)
        this.pushRadialSparks(ev.x, ev.y, 7, 130, 60, 1.3, UI.magenta)
        break
      case 'net':
        // 网目**向内**收（与爆炸相反的方向）—— 复用 `killFx` 里 net 死法的语汇
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + 0.4
          const r1 = ev.r * 2.2
          this.arcs.push({
            pts: [
              { x: ev.x + Math.cos(a) * r1, y: ev.y + Math.sin(a) * r1 },
              { x: ev.x + Math.cos(a + 0.6) * r1 * 0.42, y: ev.y + Math.sin(a + 0.6) * r1 * 0.42 },
            ], life: 0.18, maxLife: 0.18,
          })
        }
        this.pushShock(ev.x, ev.y, ev.r * 1.8, 0.2, UI.cyan, 2, 0, 1)
        break
      case 'ram':
        this.pushShock(ev.x, ev.y, ev.r * 1.7, 0.16, UI.steel, 2, ev.r * 0.6, 1)
        this.pushRadialSparks(ev.x, ev.y, 6, 150, 60, 1.6, UI.steel)
        break
      case 'hit':
        // 玩家挨打的主表现由 `playerHurt` 负责，这里只留一个小爆点做"弹消耗掉了"的收束
        this.pushShock(ev.x, ev.y, ev.r * 1.6, 0.14, UI.danger, 2, 0, 1)
        break
    }
  }

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
      // V6.80：`swarm`（数量最多的一类）也进入蓄力 —— 扑击前摇，见 `world.SWARM_LUNGE_R`
      const charging = (e.kind === 'dash' && e.phase === 'charge')
        || (e.kind === 'swarm' && e.phase === 'charge')
        || (e.kind === 'boss' && e.bossKind !== 'angler' && e.phase === 'charge')
      // ⚠️ 本地变量不要叫 `col` —— 会遮蔽从 Gfx 导入的同名颜色构造函数。
      // ⚠️ swarm **不整机泛红**：蓄力期一屏可能同时有十几只，整机变红会让画面糊成一片红点。
      const body = (charging && e.kind !== 'swarm')
        ? UI.danger : (e.flash > 0 ? 0xffffff : e.color)

      // ---- V6.73 冲刺前摇（用户实机反馈：「冲刺前的应该有个动作特效吧」）----
      // 旧表现只有一个**静止的红色圆环** —— 鱼在 0.5s 蓄力期一动不动，
      // 玩家读到的是"莫名其妙一个圈"，而不是"这条鱼正在攒力"。
      // 现在蓄力期给三段动作：**后拉（弹簧压缩）→ 高频颤抖（最后 45%）→ 弹出（dash 相位）**。
      // ⚠️ 只改渲染层的绘制坐标，**不写模拟层** —— 蓄力期模拟层本来就冻结
      //    （`updateEnemies` 的 charge 分支不位移），把后拉写进 `e.x` 会改变碰撞与命中。
      let wx = 0, wy = 0                       // 蓄力位移（渲染层专用）
      let cp = 0                               // 蓄力进度 0→1（预警圈动画用）
      if (charging) {
        // V6.80：swarm 的蓄力更短（0.30s）—— 它的扑击是"贴脸前的短促一窜"，
        //   不是 dash 那种"远处起手、长距离冲刺"。
        const dur = e.kind === 'boss' ? 1.2 : e.kind === 'swarm' ? 0.30 : 0.5
        cp = Math.max(0, Math.min(1, e.t / dur))
        const back = e.r * 0.34 * Math.min(1, cp / 0.6)      // 前 60% 把"弹簧"压满
        const tr = cp > 0.55 ? Math.sin(e.t * 44) * e.r * 0.055 * ((cp - 0.55) / 0.45) : 0
        wx = -e.dirX * back - e.dirY * tr                    // 后拉 + 垂直颤抖
        wy = -e.dirY * back + e.dirX * tr
      }

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
        sp.node.setPosition(e.x + wx, this.H - (e.y + wy))
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
          this.gEnt.strokeEllipse(e.x + wx, e.y + wy, (e.r * 2.05) / 2, (e.r * 1.5) / 2)
        }
      } else {
        // 矢量兜底（美术未就绪 / 太小 / 太多）—— 必须与贴图**同一套侧视语汇**，
        //   否则同屏 >120 条整体退回矢量时画风突变（贴图是斜着游的鱼、矢量是朝玩家的三角）。
        this.gEnt.fill(body, 0.95)
        if (e.kind === 'boss') this.gEnt.fillCircle(e.x + wx, e.y + wy, e.r)
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
          this.gEnt.fillTri(e.x + wx, e.y + wy, ux < 0 ? Math.PI - va : va, e.r * 1.25, e.r * 0.85)
        }
      }

      // 蓄力预警圈（V4 §3.4：致命预警必须醒目）—— V6.73 从**静止环**改成**动画**：
      //   外环由外向内收（"收紧"才是蓄力的语汇，静止的圈读作"这里有个圈"）+
      //   末段白色内环咬合 + 冲刺方向箭标高频闪 —— 三件事一起说"它要从这里冲出来了"。
      if (charging && e.kind !== 'boss') {
        const cxr = e.x + wx, cyr = e.y + wy
        if (e.kind === 'swarm') {
          // ---- 游群扑击前摇（V6.80，**轻量版**）----
          // 用户 2026-10-15：「鱼准备撞击我方的时候 有一个前摇冲刺动作最好」。
          // 后拉 + 颤抖由上面的 `wx/wy` 提供（与 dash 共用一套，"弹簧压缩"的语汇一致）；
          // 这里只补两样，且**刻意做轻**：
          //   ⛔ **不画整圈预警环** —— swarm 一屏可达数十只，人手一圈就是满屏红环，
          //      正是用户刚在精英标记上报过的"自己画的圈"那一类（铁规 14）。
          //   ✓ **后侧收势弧**（背向冲刺方向的 1.8rad 短弧）—— "它在往回缩"；
          //   ✓ **细箭杆**（更长更细的杆，无两翼）—— 说得出"要从这里窜出去"就够。
          const ba = Math.atan2(e.dirY, e.dirX) + Math.PI
          this.gEnt.line(UI.danger, 0.30 + 0.45 * cp, 2)
          this.gEnt.arc(cxr, cyr, e.r * (1.55 - 0.35 * cp), ba - 0.9, ba + 0.9); this.gEnt.stroke()
          if (cp > 0.35 && Math.sin(e.t * 34) > -0.5) {
            const d0x = cxr + e.dirX * e.r * 1.15, d0y = cyr + e.dirY * e.r * 1.15
            const d1x = cxr + e.dirX * e.r * 1.90, d1y = cyr + e.dirY * e.r * 1.90
            this.gEnt.line(UI.danger, 0.40 + 0.45 * cp, 1.6)
            this.gEnt.strokeSeg(d0x, d0y, d1x, d1y)
          }
        } else {
          this.gEnt.line(UI.danger, 0.25 + 0.5 * cp, 2)
          this.gEnt.strokeCircle(cxr, cyr, e.r * (2.2 - 1.0 * cp))
          if (cp > 0.6) {
            const q = (cp - 0.6) / 0.4
            this.gEnt.line(0xffffff, 0.15 + q * 0.45, 1.2)
            this.gEnt.strokeCircle(cxr, cyr, e.r * (0.95 - 0.30 * q))
          }
          if (cp > 0.3 && Math.sin(e.t * 34) > -0.5) {
            // 冲刺方向箭标：短杆 + 两翼 —— "它要从这里冲出去"（蓄力早期不画，避免常亮噪声）
            const d0x = cxr + e.dirX * e.r * 1.25, d0y = cyr + e.dirY * e.r * 1.25
            const d1x = cxr + e.dirX * e.r * 1.95, d1y = cyr + e.dirY * e.r * 1.95
            const px = -e.dirY, py = e.dirX
            this.gEnt.line(UI.danger, 0.45 + 0.45 * cp, 2)
            this.gEnt.strokeSeg(d0x, d0y, d1x, d1y)
            this.gEnt.strokeSeg(d1x, d1y,
              d1x - (e.dirX * 0.35 + px * 0.28) * e.r, d1y - (e.dirY * 0.35 + py * 0.28) * e.r)
            this.gEnt.strokeSeg(d1x, d1y,
              d1x - (e.dirX * 0.35 - px * 0.28) * e.r, d1y - (e.dirY * 0.35 - py * 0.28) * e.r)
          }
        }
      }

      // 发光核心：铁律，必须画在贴图之上
      this.gEnt.fill(body, 1)
      this.gEnt.fillCircle(e.x + wx, e.y + wy, 2)

      // ---- V6.46 控制状态标记 ----
      // 为什么要单独做这三个标记：控场型武器的**全部手感都在"我怎么知道它生效了"**。
      // 打伤害的武器不需要状态标记（掉血条自己在说），但网 / 诱饵 / 策反不改血量，
      // 没有标记时玩家的判断只能是"这条鱼好像慢了？" —— 那等于没做。
      // 三种状态用**三种不同的形状语汇**（弧环 / 闪烁圈 / 双箭环），不靠颜色区分：
      // 深海里颜色会被亮度压暗，形状不会。
      if (e.slowT > 0) {
        // 网住：断续弧环（6 段）+ 三条缠索。断续是"被缠住"而不是"套了个圈"的关键。
        // ⚠️ V6.70 **加"挣扎"**：用户原话「撒网应该是把鱼捆住 鱼有动作才能」。
        //    只有环 = 静态标记，玩家读到的是"它身上有个图标"，不是"它正在被捆着"。
        //    ⇒ 环的**半径与弧长都按 6Hz 抖动**（相位取 `e.x` 避免整片同步），
        //    缠索内端跟着抖 ⇒ 读作"网在收紧、鱼在挣"。抖动幅度必须小（±7% / ±0.1rad），
        //    大了会读成"这条鱼在瞬移"。
        const strain = Math.sin(w.t * 6.4 + e.x * 0.07)       // ±1 的挣扎信号
        const rr = e.r * 1.52 * (1 + strain * 0.07)
        this.gEnt.line(UI.cyanHi, 0.62, 1.5)
        for (let k = 0; k < 6; k++) {
          const a0 = (k / 6) * Math.PI * 2 + w.t * 0.7
          const span = 0.52 * (1 + strain * 0.10)
          this.gEnt.arc(e.x, e.y, rr, a0, a0 + span).stroke()
        }
        this.gEnt.line(UI.cyanHi, 0.34, 1)
        for (let k = 0; k < 3; k++) {
          const a0 = (k / 3) * Math.PI * 2 - w.t * 0.7
          const inner = e.r * (0.55 + strain * 0.10)
          this.gEnt.strokeSeg(e.x + Math.cos(a0) * rr, e.y + Math.sin(a0) * rr,
            e.x + Math.cos(a0) * inner, e.y + Math.sin(a0) * inner)
        }
      }
      if (e.rootT > 0) {
        // ---- **被网困住**（V6.80 重做）
        // 用户 2026-10-15：「之前说的 丢渔网 应该是抛出去 **捆住**有一个受击特效」。
        // ★ 关键事实：`rootT` **只由网族写入**（`world.applyNet` —— `net` / `net_el` / `net_cv`），
        //   所以这里可以放心画"网"本身，而不只是画一个通用的"定身"符号。
        //   旧版是"实环 + 禁止斜杠"：它说得出"你被定住了"，却说不出**是被什么定住的** ——
        //   而玩家前一秒刚扔出去一张网，他期待看到的是"网缠在它身上"。
        // ★ 三条语汇，缺一条就退回"一个圈"：
        //   ① **缠绕的绳圈**：沿**体轴**排布的三道**椭圆**环（垂直于体轴 ⇒ 有"缠"的方向感；
        //      同心正圆没有方向，读作"套在它外面的一圈"）；
        //   ② **纵向收口索**：把三道绳圈串起来的索 ⇒ 有交叉才读作"网"，孤立三个环不是网；
        //   ③ **收紧的白闪**：只在被网住最初 0.25s（"捆住"的那一下 = 用户要的**受击特效**），
        //      外加挣扎抖动（**动的是网、不是鱼** —— 与"定身 = 完全不动"不矛盾）。
        // ⚠️ 必须与「缠索」（玩家侧负面状态，`w.tetherSrc`）一眼分开：
        //   那边是"索 + 向外拽的短须"，这边是"横向绳圈"。
        const bfm = Math.hypot(e.fx, e.fy)
        const bux = bfm > 0.5 ? e.fx / bfm : 1
        const buy = bfm > 0.5 ? e.fy / bfm : 0
        const bpx = -buy, bpy = bux                       // 垂直于体轴 = 绳圈的长轴
        const left = Math.max(0, Math.min(1, e.rootT / 1.2))
        const pull = 1 - left                             // 0 → 1（越往后越紧）
        const wob = Math.sin(w.t * 9 + e.x * 0.05) * e.r * 0.06 * left
        // ① 三道缠绕绳圈（椭圆：长轴垂直体轴、短轴沿体轴）
        for (let i = -1; i <= 1; i++) {
          const ccx = e.x + bux * i * e.r * 0.55 + wob
          const ccy = e.y + buy * i * e.r * 0.55
          const a2 = e.r * (0.92 - pull * 0.16)            // 长轴
          const b2 = e.r * 0.30                            // 短轴（沿体轴 ⇒ 被"勒"进去）
          this.gEnt.line(UI.cyanHi, 0.84, 1.9)
          for (let k = 0; k <= 18; k++) {
            const th = (k / 18) * Math.PI * 2
            const ox = Math.cos(th) * a2, oy = Math.sin(th) * b2
            const qx = ccx + bpx * ox + bux * oy
            const qy = ccy + bpy * ox + buy * oy
            if (k === 0) this.gEnt.moveTo(qx, qy); else this.gEnt.lineTo(qx, qy)
          }
          this.gEnt.close(); this.gEnt.stroke()
        }
        // ② 纵向收口索（两条，把三道圈串起来）
        this.gEnt.line(UI.jade, 0.58, 1.2)
        for (const sx of [-1, 1]) {
          this.gEnt.strokeSeg(
            e.x + bpx * sx * e.r * 0.84 - bux * e.r * 0.62 + wob,
            e.y + bpy * sx * e.r * 0.84 - buy * e.r * 0.62,
            e.x + bpx * sx * e.r * 0.84 + bux * e.r * 0.62 + wob,
            e.y + bpy * sx * e.r * 0.84 + buy * e.r * 0.62)
        }
        // ③ 捆住那一下的收紧张力闪（只在前 0.25s）
        if (e.rootT > 0.95) {
          const q = (e.rootT - 0.95) / 0.25
          this.gEnt.line(0xffffff, 0.80 * q, 2.6)
          this.gEnt.strokeCircle(e.x + wob, e.y, e.r * (1.7 - 0.5 * q))
        }
      }
      if (e.elite) {
        // ---- 精英（V6.62 §5-A）----
        // V6.80 重构（用户 2026-10-15：「个别身上有黄色的圆圈是什么意思 很突兀」）：
        //   ⛔ 旧版是一个 **r×1.8 的琥珀色闭合空圈**。两个问题叠在一起：
        //     ① **空圈没有含义** —— 用户根本读不出它是什么（"很突兀"的直接来源）；
        //     ② 闭合亮环 = **UI 框的语汇**（铁规 14）—— 一群有贴图的鱼里，
        //        那条线框圈是"画上去的"，不是鱼身上的东西。
        //   ★ 改法：把"值得打"的读法落回**鱼自己在发光**（与鱼骨的"发光 = 值得"同源）——
        //     分层低透明填充（体表辉光）+ 两颗沿体表绕游的光点。
        //   ⛔ **不画任何闭合线**：一有轮廓就退化成"一个圈"，这正是要拆掉的东西。
        const pulse = 0.5 + 0.5 * Math.sin(w.t * 3.4 + e.x * 0.01)
        this.gEnt.fill(UI.amber, 0.05 + 0.045 * pulse)
        this.gEnt.fillCircle(e.x, e.y, e.r * 2.05)
        this.gEnt.fill(UI.amber, 0.08 + 0.07 * pulse)
        this.gEnt.fillCircle(e.x, e.y, e.r * 1.45)
        this.gEnt.fill(UI.amber, 0.14 + 0.10 * pulse)
        this.gEnt.fillCircle(e.x, e.y, e.r * 0.98)
        for (let k = 0; k < 2; k++) {
          const a = w.t * 1.9 + k * Math.PI
          this.gEnt.fill(UI.amber, 0.55 + 0.35 * pulse)
          this.gEnt.fillCircle(e.x + Math.cos(a) * e.r * 1.30,
            e.y + Math.sin(a) * e.r * 1.05, 1.9)
        }
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
    // 朝向镜像**已改由 `syncSub` → `updateFace` 每帧更新**（那一位在同一帧更早执行）：
    // 位图的朝向与炮位的朝向必须用**同一个** `faceX`，两处各更新一次会差一帧。

    // ---- 机体：**位图**（由 `syncSub` 摆好）----
    // 本层只画**压在位图之上**的东西：安装导轨 / 6 个炮位插座 / 炮 / 霓虹轮廓
    // / 炮口照明 / 受击泛红。艇身本体（含塔、鳍、舷窗）已搬去位图，见 `drawBody`。
    this.drawBody(w)

    // ---- 艏部探照灯（V6.77b **整段删除**）----
    // 用户 2026-10-15：「还是有白色的划线  扫描仪不要  白点 和三角形 全去掉」
    //   · 「白点」 = `fill(UI.cyanHi, 0.95); fillCircle(bx, by, EMITTER_SIZE*0.3)`
    //     —— 5.4px 的近白圆，α0.95 ⇒ 在深水里读作一个纯白点。
    //   · 「三角形」= 它外侧那支 `moveTo / lineTo / close / fillPath` 的光锥
    //     —— α0.15 的半透明三角，本意是"灯朝哪一头"。
    //   两样都**贴在 `HULL_OUTLINE` 之外**（`bx = HL + 10`）⇒ 正是铁规 12 那句
    //   「安装件只要超出剪影就读作画上去的」。与上一轮删掉的白圈 / 黄环同一条判据。
    //
    //   ⚠️ **删掉不影响朝向可读**：机体位图自己吃 `faceX` 镜像（`subNode.scale.x = faceX`），
    //      艏/艉 + 塔的前后位置一起翻 ⇒ 看艇头朝哪边就够了，不需要额外挂一个标记点
    //      （历史段 v3 的结论"机体整机不与 aim 挂钩"仍然成立）。
    //   ⚠️ `drawLamp` 那团**探照灯光晕保留** —— 它是"光的主权转移"的一环（L2 起），
    //      且是同心圆由外向内叠出来的**柔光**、没有任何轮廓线，与这个指示点是两回事。
    //   ⚠️ `HL` 只被这一段用过，因此一并删除（留着会变成"永远不读的常量"，下一个人不敢动）。

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

    // ---- 缠索（V6.79b）----
    // 判据（设计稿 §4）：这是**玩家侧**的负面状态 ⇒ 语汇必须与「敌人被定身」**方向相反** ——
    //   那边是"**它**不动"（收紧的实环 + 禁止斜杠），这边是"**我**被拽"（一条下坠的索 + 圈向外拽的短须）。
    //   形状上也刻意分开：那边整圈、这边**只有短须**。
    // ⚠️ 颜色只走 `UI.danger` 的低透明版 —— 它是负向状态，借生物荧光色
    //    （jade / magenta / amber / violet 是"敌人"的语汇）会被读成"我的增益"。
    if (w.tetherSrc) {
      const s = w.tetherSrc
      const px = w.px, py = w.py
      const d = Math.hypot(s.x - px, s.y - py) || 1
      const ux = (s.x - px) / d, uy = (s.y - py) / d      // 玩家 → 它
      const tight = Math.max(0, Math.min(1, 1 - (d - 40) / 72))   // 越近越"绷"

      // ① 索：3 段，段间留缝 + 中间**垂坠** —— "索"与"射线"的区别全在这两样上
      const SEG = 3
      for (let i = 0; i < SEG; i++) {
        const t0 = i / SEG, t1 = (i + 0.66) / SEG
        const sag = Math.sin(Math.PI * t0) * 7 * (1 - tight)      // 松时垂，绷紧时拉直
        const nx2 = -uy, ny2 = ux                                 // 法线
        this.gPlayer.line(UI.danger, 0.34 + 0.30 * tight, 2.4)
        this.gPlayer.strokeSeg(
          px + (s.x - px) * t0 + nx2 * sag, py + (s.y - py) * t0 + ny2 * sag,
          px + (s.x - px) * t1 + nx2 * sag * 0.7, py + (s.y - py) * t1 + ny2 * sag * 0.7)
      }

      // ② 束缚环：机体外围**一圈断续的** danger 弧（8 段，慢慢反向转）—— 读作"我被箍住了"。
      //    ⚠️ 半轴 48×32 **略在机体剪影（88×56 ⇒ 44×28）之外**，这是**刻意**的：
      //       ① 铁规 12 管的是"装上去的**零件**不许超出剪影"（那会被读成贴纸）；
      //          这一圈要读的是"**作用在你身上的状态**"，必须与机体本身分开。
      //       ② 走**断续弧**而不是整圈 + 低 α，就是为了不和"UI 选中框"混。
      //    ⛔ 别把它改成整圈实环 —— 那是"敌人被定身"的语汇（见 drawEnemies）。
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2 + w.t * 0.9              // 与索的颤动区分开：慢转
        const a1 = a0 + (Math.PI * 2 / 8) * 0.58                  // 58% 占空 = 断续
        this.gPlayer.line(UI.danger, 0.24 + 0.20 * tight, 1.8)
        this.gPlayer.strokeSeg(px + Math.cos(a0) * 48, py + Math.sin(a0) * 32,
                               px + Math.cos(a1) * 48, py + Math.sin(a1) * 32)
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

    // ⓪~②d **已整体删除**（V6.75）。艇身本体（投影 / 侧壁 / 主体 / 受光面 / 暗带 /
    //    金属高光带 / 铆钉排）现在全部由 `SUB_HULL` **位图**承担 —— 用户 2026-10-15
    //    拍板「不要用矢量画，要有立体感、真实美感」。矢量那套的硬天花板是
    //    **无渐变 / 无模糊 / 无笔触**（见被删代码的历史注释），怎么调都只是
    //    "一块有明暗的板"，所以整段搬去做位图，不再回来。
    //
    //    ⚠️ 位图节点 `subNode` 在本层（`gPlayer`）**之下**（节点树顺序：
    //       `gEnt → sub → fxBits → gPlayer`），所以这里画的导轨 /
    //       插座 / 炮**自然压在位图上**，不需要额外处理层序。
    //    ⚠️ 投影（`subShadow`）**V6.77c 已整体删除** —— 理由见字段声明处。

    // ③ 背脊挂载带 —— 炮座就镶在这条线上。
    //
    //    ⚠️ **V6.77b 改成暗缝**（用户 2026-10-15：「还是有白色的划线」）。
    //    原来是 `shade(tint, 1.12)` + α0.92 + 宽 3.0 —— 一条**比艇身亮的主题色粗线**
    //    躺在艇背上。它犯的错与 ⑧ 兜底轮廓、炮口环、转座白圈**完全同一条**（铁规 14）：
    //    **长条 + 亮色 = "UI 框"的语汇** ⇒ 在 88px 的艇上读作"有人拿白笔画了一道"，
    //    而不是"这条舱段上有一条挂载导轨"。用户两次报"白描边"里，它是**第二条**。
    //
    //    ⇒ 现在：色相仍取艇种色（三台潜航器仍一眼可分），但明度压到艇身**之下**
    //      ⇒ 读作"凹进去的一条槽"，与位图上烘好的 6 个凹槽是同一套语汇。
    //    ⚠️ **不能整条删**：它是"炮座为什么坐在这一列"的机械依据 —— 炮座的柱脚正落在
    //      它上面；删掉之后 6 门炮又回到"贴在一张光滑的壳上"（V6.76 之前的读法）。
    g.line(shade(tint, 0.34), 0.72, 2.4); edge(0, 5, 0.78, -2, -6); g.stroke()

    // ③b 腹部挂载带（V6.71）—— 炮位改成**背脊 3 座 + 腹部 3 座**之后，
    //     腹部这一列也必须有导轨，否则下半排的炮座读作"贴在艇腹上的圆盘"，
    //     而上半排读作"坐在导轨上" —— 两种读法不一致，6 座就不像一个系统。
    //    ⚠️ 与 ③ 同为**内缩**导轨（不是描边）：对称才能读作"同一套舱段"。
    //    ⚠️ 同样改成暗缝（V6.77b）；α 比背脊再低一档（腹部本来就背光）。
    g.line(shade(tint, 0.34), 0.60, 2.4)
    for (let i = 7; i <= 12; i++) {
      const px = cx + HULL_OUTLINE[i][0] * HL * 0.80 * m
      const py = cy + HULL_OUTLINE[i][1] * HH * 0.86 + 5
      if (i === 7) g.moveTo(px, py); else g.lineTo(px, py)
    }
    g.stroke()

    // ③c 炮位插座层（V6.74）—— 把「最多 6 个发射孔、慢慢解锁」画在机体上。
    //     必须在导轨**之后**、指挥塔之前：插座是"开在导轨上的孔"。
    this.drawSeatSockets(w)

    // ④~⑦b **已整体删除**（V6.75）：指挥塔 + 观察窗 + 潜望镜 / 尾舵 / 舷窗带 /
    //     艉部推进器 + 散热格栅，全部改由 `SUB_HULL` **位图**承担。
    //
    //     ⚠️ 为什么这些能删：它们原本是"**突破剪影**的三处锚"（塔破上缘、尾舵破
    //       上下缘、舷窗是"这是侧视"的最强线索）—— 位图里这些结构**本来就有**
    //        （`prep_sub_art.py` 的裁剪规则刻意保住塔/鳍的出血，见该脚本头注），
    //        再画一遍就是**两套塔叠在一起**（比缺更糟：错位会读成重影）。
    //     ⚠️ 位图是**垂直于艇身的镜像**（`subNode.scale.x = faceX`），所以艏艉
    //        与塔的前后位置跟着一起翻，朝向提示仍然成立。
    //     ⚠️ 塔在几何上仍是"挂点基准的一部分"：`SEAT_MOUNTS` 的背脊三座之所以
    //        从 `u = 0.12` 起，就是为了避开 `u ∈ [0.30, 0.72]` 的塔 ——
    //        换位图时**必须保证图上的塔落在同一段 u 上**，否则炮会装到塔上。

    // ⑧ 兜底轮廓 —— **暗缝**，不是亮边（V6.77 改，用户 2026-10-15 报「机体为啥还是有白色的描边」）。
    //
    //   为什么原来是 `UI.cyan` α0.55：V6.75 换位图时担心"位图自带的青蓝描边缩到 88px
    //   会和背景糊在一起"，于是补一条与 `HULL_OUTLINE` 严格同源的矢量线兜清晰度。
    //
    //   ⚠️ **这条兜底本身是"造白描边"的主因**。原因是两条判据叠加：
    //     ① **闭环 + 高亮 = "UI 框"的语汇**（铁规 14）—— 无论颜色多对，读出来都是
    //        "贴上去的一块板，还描了一圈白边"，而不是"金属在光里的边"；
    //     ② 位图**自己也有一圈亮 rim**（实测最外圈比内侧亮 30~49%）⇒ 两道叠在一起，
    //        在深色层上那圈白得刺眼。
    //   ⇒ 兜底的作用是"让机体和背景分开"，**暗缝同样能做到**（亮背景靠压暗、暗背景靠
    //     位图自带 rim 的亮），而暗缝不会读成"描上去的一圈"。
    //     这就是铁规 14 的原话：**封板/补板一律走暗缝，给了亮边就变回"贴上去的一块"**。
    //   ⚠️ 想验证哪个是主因：把这条线整段注释掉跑一次 —— 边缘仍有余亮（位图 rim），
    //      但刺眼的那圈没了（见 `docs/shots/hull_outline_ab.png` 的 B 列）。
    //   ⚠️ 仍不加 bloom：线宽挂在这条轮廓上会外扩成一圈比机体还大的光环（历史段 v2 坑 ⑤）。
    //   ⚠️ 改这里必须同步 `tools/preview_hull_side.py` 的 `paste_hull`（预览要复刻实机）。
    g.line(UI.abyss, 0.45, 1.3); hull(1.0, 0, 0); g.stroke()

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

    // 受击反馈：① 整机泛红（矢量机体没有"红描边"，改整机压色）
    if (w.hurtFlash > 0) {
      g.fill(UI.danger, 0.30 * Math.min(1, w.hurtFlash / 0.2))
      hull(1.0, 0, 0); g.fillPath()
    }
    // ② **机身上的受击弧**（V6.80）—— 全屏红带被删之后（见 `drawVeil`），来向落在机体上。
    //    判据：**受击是自机身上的事** ⇒ 方向也画在我身上，屏幕层不参与。
    //    ⚠️ 形状**只覆盖来向 ~145°，不是闭合环** —— 闭合环是"UI 框"的语汇（铁规 14）。
    //    ⚠️ 半径 `SUB_D * 0.52 ≈ 45.8` **略在剪影（88×56 ⇒ 半宽 44）之外 1.8px**：
    //       受击弧要"贴着船壳外面亮一下"才是被击中的边，压在船身上会读成船体花屏。
    if (w.hurtDirT > 0) {
      const hk = Math.min(1, w.hurtDirT / 0.6)
      const ha = Math.atan2(w.hurtDirY, w.hurtDirX)      // 玩家 → 伤害来源
      const hr = SUB_D * 0.52
      g.line(UI.danger, 0.62 * hk, 2.6)
      g.arc(w.px, w.py, hr, ha - 1.25, ha + 1.25); g.stroke()
      g.line(0xffffff, 0.34 * hk, 1.2)
      g.arc(w.px, w.py, hr * 0.84, ha - 0.95, ha + 0.95); g.stroke()
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
   * **炮管**（V6.70 · 用户："发射空不应该是个炮台出口吗 小火炮的形状吧"）。
   *
   * 问题：旧版每个发射器都是**几条 2px 的直线**（`drawEmitter` 的 gun/torpedo 分支），
   * 无论怎么调颜色和粗细，它永远是"一根线"—— 侧视里没有体积、没有口径、
   * 没有"这是根管子"的开口感。用户说的"看起来是个平面"就是这个。
   *
   * 判据（沿用机体那条"有厚度 = 有侧壁"）：一根管子要读成立体，缺的不是细节，
   * 而是**三样**：
   *   ① **管身**：不是一个宽度的线，而是一根**有上下缘的圆柱**（上缘亮、下缘暗）
   *   ② **炮口**：管口要有**内孔**（暗）—— V6.77 之前还有一道**口环**（亮），
   *      用户 2026-10-15 拍板去掉（见下方"V6.77 去黄"），出口现在只由内孔回答
   *   ③ **根部收窄**：管根略收，与炮座外罩交接处不出现"直线插进圆里"的硬接缝
   *
   * ⚠️ 光源处理（与机体/炮座那条铁律的**有意的例外**，写清理由）：
   *    机体是"不随朝向转"的大件，所以光源必须固定世界左上；但炮管是
   *    **随索敌角旋转**的小部件，转向时"哪边朝上"本来就在变，
   *    把光源反旋进局部系反而会让炮口经过某个角度时突然明暗翻转（更假）。
   *    ⇒ 这里亮缘恒在局部上侧。代价是转向时高光会跟着转，收益是**没有翻转跳变**。
   *
   * -----------------------------------------------------------------------
   * ⛔ V6.77 **去黄**（用户原话：「A吧 黄色的描绘能改下吗 不改的话 像是画上去的」
   *    →「选择A2 同时炮口的黄色半圆也去掉」）—— 两条都别再改回去：
   *      · **管身轮廓**：本色亮线 ⇒ **暗缝**（`UI.abyss` 0.62）；
   *      · **炮口**：删掉那道 `ang ± 1.5` 的 172° 口环弧，内孔内圈改金属色。
   *    判据是**同一条**（铁规 14）：闭合**或半闭合**的亮色轮廓 = "UI 框"的语汇。
   *    管身那圈是闭合的、炮口那圈是 172° 的半圆 —— 两者读出来都是"描上去的一圈线"，
   *    所以**必须一起改**（只改管身的话，黄只是从"管身"移动到了"管口"，用户一眼还是看得出）。
   *    代价与收益都写清楚：武器身份不再由颜色回答，改由**形状**（管数 / 口径 / 族特征）
   *    + 开火时的枪口闪光色回答。这不是丢信息 —— 颜色在 56px 的艇上本来也分不开，
   *    真正分得开的是"一根管还是两根管、管口多粗"。
   */
  private barrel(cx: number, cy: number, ang: number, l0: number, l1: number,
                 hh: number, col0: number, bore = true, warmEdge = false): void {
    const g = this.gPlayer
    const P = (lx: number, ly: number) => this.rot(cx, cy, ang, lx, ly)

    // ① 管身：根部收窄的**锥形圆柱**（四边围成，不是线）
    const body = () => {
      const a = P(l0, -hh * 0.82), b = P(l1, -hh)
      const c = P(l1, hh), d = P(l0, hh * 0.82)
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y)
      g.close()
    }
    g.fill(shade(BODY_METAL, 0.60), 1); body(); g.fillPath()
    // 上缘受光带（贴轮廓内缩，模拟圆柱顶面的镜面高光）
    const hi = P(l0 + 1.5, -hh * 0.58), hi2 = P(l1 - 1.2, -hh * 0.72)
    // ⚠️ `warmEdge` = 把**武器本色搬进这条受光带**（本色 ← 金属高光 45%）。
    //    默认 `false`：V6.77 用户拍板「去黄」⇒ 枪族全身上下**不留一处本色**。
    //    开关留着是因为"本色去受光带"是唯一正确的位置（形状由几何定、颜色只是光的一部分）；
    //    将来要给某族恢复身份色，**从这儿开，别回去描边**。
    g.line(warmEdge ? mixCol(col0, shade(BODY_METAL, 1.30), 0.45) : shade(BODY_METAL, 1.30),
      0.80, Math.max(1, hh * 0.30))
    g.strokeSeg(hi.x, hi.y, hi2.x, hi2.y)
    // 下缘暗线（厚度线索的另一半：上亮下暗）
    const lo = P(l0 + 1.5, hh * 0.64), lo2 = P(l1 - 1.2, hh * 0.78)
    g.line(UI.abyss, 0.50, Math.max(1, hh * 0.26))
    g.strokeSeg(lo.x, lo.y, lo2.x, lo2.y)
    // ② 轮廓：**暗缝**（V6.77；旧版是本色亮线 `col0`）。
    //    ⛔ 别改回本色 —— 一条闭合的高饱和亮边就是"UI 框"的语汇（铁规 14）：
    //       无论颜色多对，读出来都是"贴纸的边"，不是"金属零件在光里的边"。
    //       "管子与背景的分界"本来就是**暗**的 ⇒ 用 `UI.abyss` 半透走一圈。
    g.line(UI.abyss, 0.62, 1.3); body(); g.stroke()

    // ③ 炮口：**只剩内孔**（V6.77 删掉了那道 172° 的口环弧）。
    //    为什么要删：口环是**半闭合的亮弧**，与 ② 那条闭合亮边是同一条判据 ——
    //    "看着像半圆、读法是管口描了一圈黄"。出口的可读性改由**内孔本身**承担。
    //    ⚠️ 内孔的参数边界（别动）：`rIn = hh × 0.46` 是预览图试出来的 ——
    //       `hh × 0.62` 时 6× 下整根管子读成"两个黑洞"（内孔喧宾夺主）；
    //       更小则读作"管子上贴了个亮点"而不是"这里有个洞能打出东西"。
    const mo = P(l1, 0)
    const rIn = hh * 0.46
    if (bore) {
      g.fill(UI.abyss, 0.72); g.fillCircle(mo.x, mo.y, rIn)
      g.line(shade(BODY_METAL, 1.30), 0.40, 1); g.strokeCircle(mo.x, mo.y, rIn * 0.66)
    }
  }

  /**
   * **变径金属管**（V6.79）—— `barrel` 的兄弟，唯一差别是**两端半径可以不同**。
   *
   * 为什么新开一个方法而不是给 `barrel` 加参数：`barrel` 已被枪族 / 鱼雷族 / 机匣
   * 三处共用，它那几个参数（`hh` / `bore` / `rIn = hh×0.46`）都是预览图试出来的
   * 边界值（见它的注释）。动它 = 同时动三处已验收的观感，风险大于收益。
   * 这里**逐条复刻** `barrel` 的四条体积线索，保证两者是**同一套语汇** ——
   * 玩家不该看出"这两族是两套零件"：
   *   ① 管身 = 四边围成的锥形圆柱（不是一条线）；
   *   ② 上缘受光带 / 下缘暗线（上亮下暗 = 圆柱感）；
   *   ③ 轮廓走**暗缝** —— ⛔ 不描本色亮边（铁规 14：闭合的亮色轮廓 = "UI 框"的语汇，
   *      那正是用户说的"像是画上去的"）；
   *   ④ 前端可选内孔。
   *
   * 用途就是**族特征本身**：**喇叭**（`h0 < h1`，声呐）× **喷嘴**（`h0 > h1`，酸液）——
   * 这两个形态等半径的 `barrel` 画不出来，而它们恰恰是"这一族长什么样"的全部内容。
   */
  private metalTube(cx: number, cy: number, ang: number,
                    l0: number, h0: number, l1: number, h1: number,
                    bore = false, boreR = 0.46): void {
    const g = this.gPlayer
    const P = (lx: number, ly: number) => this.rot(cx, cy, ang, lx, ly)
    // ① 管身：两端半径不同的锥形圆柱
    const body = () => {
      const a = P(l0, -h0 * 0.82), b = P(l1, -h1)
      const c = P(l1, h1), d = P(l0, h0 * 0.82)
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y)
      g.close()
    }
    g.fill(shade(BODY_METAL, 0.60), 1); body(); g.fillPath()
    // ② 上缘受光带 / 下缘暗线。线宽取**两端较细的那一端** —— 取粗端会让细端
    //    的高光糊出管外（细端本来就只有几 px）。
    const hmin = Math.min(h0, h1)
    const hi = P(l0 + 1.5, -h0 * 0.58), hi2 = P(l1 - 1.2, -h1 * 0.72)
    g.line(shade(BODY_METAL, 1.30), 0.80, Math.max(1, hmin * 0.42))
    g.strokeSeg(hi.x, hi.y, hi2.x, hi2.y)
    const lo = P(l0 + 1.5, h0 * 0.64), lo2 = P(l1 - 1.2, h1 * 0.78)
    g.line(UI.abyss, 0.50, Math.max(1, hmin * 0.36))
    g.strokeSeg(lo.x, lo.y, lo2.x, lo2.y)
    // ③ 轮廓：暗缝
    g.line(UI.abyss, 0.62, 1.3); body(); g.stroke()
    // ④ 前端内孔
    if (bore) {
      const mo = P(l1, 0)
      const rIn = h1 * boreR
      g.fill(UI.abyss, 0.72); g.fillCircle(mo.x, mo.y, rIn)
      g.line(shade(BODY_METAL, 1.30), 0.40, 1); g.strokeCircle(mo.x, mo.y, rIn * 0.66)
    }
  }

/**
   * 炮位总成 = **焊在艇体上的炮口 + 坐在炮口上的发射器**（V6.71 重做）。
   *
   * -----------------------------------------------------------------------
   * V6.71 用户原话：「座圈不对吧 按照侧视的角度不应该是上下是炮空比较合适吗
   *   炮孔装上去的发射器要有具体感 就像真的装上去 设计一样」
   * -----------------------------------------------------------------------
   * ① **座圈不再是座圈**：位置真源改成 `shared/dive/tables.ts` 的 `SEAT_MOUNTS` ——
   *    **背脊 3 座 + 腹部 3 座**，沿艇身纵向排开（像真实潜艇的鱼雷舱）。
   *    旧算法（`SEAT_RING_R × cos/sin` 再乘 `SEAT_RATIO` 压扁）把 6 座摊成一条扁椭圆，
   *    在 88×56 的梭形上读作"沿船边贴了一圈盘子"。
   *
   * ② **安装结构改成四级台阶**（这是"有具体感/真的装上去"的落点）：
   *    ① 安装底板（焊在艇体上、朝外伸出的一段：投影+侧壁+顶面+镜面亮痕+螺栓）
   *    ② 炮口开孔（画在**机体那一侧**，是"艇体上的一个洞"）
   *    ③ 炮身转座（**只有这一层吃 `ang`**，随索敌转向，带耳轴）
   *    ④ 发射器（枪族炮管）
   *
   * ⚠️ **只有 ③④ 吃 `ang`**：底板与炮口是**焊死的**，跟着机体转、朝向由挂点定。
   *    让底板也吃 `ang` 就是"炮座在艇表面转动" —— 用户驳回过两次的读法。
   *
   * -----------------------------------------------------------------------
   * 动效（用户要「给点立体感 在移动」）
   * -----------------------------------------------------------------------
   *   · 后坐：开火瞬间沿炮管**反方向**退 `5.5px`，阻尼振荡归位（**只推发射器**）；
   *   · 待机微浮：`sin(t*1.6 + i*2.3) * 0.7px`，每座错相位；
   *   · 索敌转向由 `slewTurretAims`（sim 层，`TURRET_SPIN` 限速）驱动，渲染层不重复做。
   *   ⚠️ 后坐/浮沉只作用在 `fore` 上，而 `fore` 只喂给 ③ 转座与 ④ 发射器 ——
   *     ①② 是焊在机体上的，不能跟着晃。
   *
   * -----------------------------------------------------------------------
   * V6.72 底板改梯形悬臂（`--mount` 预览图否掉等宽矩形）
   * -----------------------------------------------------------------------
   *   等宽矩形 + 大面积暗侧壁读成「机体外面套了六个黑方块」—— 那正是用户
   *   驳回过的"外挂圆盘"读法，只是从圆换成方。改成**根部宽 / 外端收窄**的
   *   梯形后，它读作「从艇体伸出的一段结构」；侧壁同时由 0.42 抬到 0.66，
   *   侧壁回到「厚度」的职责，不再是「暗块」。
   */
  /**
   * **炮位插座层**（V6.74）。用户原话：
   *   「机体…要兼容这些发射器 **最大6个发射孔** 是慢慢解锁的 需要在养成中解锁」。
   *
   * ---------------------------------------------------------------------
   * 为什么必须画在机体上，而不是只写在 HUD/商店里
   * ---------------------------------------------------------------------
   * 养成线给玩家的回报只有一种能"看得见"：**机体上多了一个孔、并且里面装上了炮**。
   * 若机体只有 4 个孔，玩家解锁第 5 座时**屏幕上什么都不会变**（多一门炮而已，
   * 而那门炮本来就长得和别的炮一样）⇒ 这笔投入在实机上等于没有反馈。
   * 反过来：机体上**六个孔一直看得见**，其中两个是**焊死的封板** ——
   * 玩家每局都在看着"我还差两个孔"，这才是养成线的广告位。
   *
   * ---------------------------------------------------------------------
   * 三种状态（`SEAT_MOUNTS` 六个位置一个不落地遍历）
   * ---------------------------------------------------------------------
   *   ① 已装武器（`i < weapons.length`）→ **完全不画**：`drawTurret` 的四级安装
   *      台阶会盖住这里，画了只会透出边（"炮座外围有一圈多余的盘"）。
   *   ② 已解锁 · 空座（`weapons.length ≤ i < maxWeapons`）→ **敞开的插座**：
   *      一圈亮环 + 内凹暗孔 ⇒ "这个孔我有了，还没装东西"。
   *   ③ 未解锁（`i ≥ maxWeapons`）→ **焊死的封板**：实心盘（**没有孔**）+ 中央十字
   *      焊缝 + 四颗螺栓 + 无高光 ⇒ "这个孔还锁着"。
   *
   * ⚠️ ②③ 的差别**不能靠颜色**（深海会把亮度整体压掉，琥珀/青在这种面积上分不开），
   *    只能靠**有没有孔**：②中心是一个**暗孔**，③中心是**实心板 + 焊缝**。
   * ⚠️ ③ 刻意**不给镜面高光**：高光 = "这是块会反光的活金属"，
   *    封板要读作"死在那儿的一块补丁"。给了高光它就和底板混成同一类零件了。
   */
  /**
   * **炮位槽的两种"非装机"状态**（V6.76）。用户原话：
   *   「我要的是你机型图自带开孔的发射槽，发射装置是直接装上去的，漏出发射头，
   *     不是你画上去的突兀感」。
   *
   * ---------------------------------------------------------------------
   * V6.76 之前错在哪（别再走回头路）
   * ---------------------------------------------------------------------
   * 槽是**用 `Graphics` 画在艇身外面**的：一块 `MOUNT_BASE_R=15` 的梯形悬臂台
   * （台面整个伸在 `HULL_OUTLINE` 之外）+ 台面上的孔。六座因此读作
   * **"贴在艇上的六块积木"** —— 这就是「画上去的突兀感」。
   * `Graphics` 无渐变/无模糊/无笔触，**在艇身外面画任何零件都必然是贴纸**。
   *
   * ⇒ 现在：**槽由机体位图自带**（`tools/prep_sub_art.py` 的 `bake_slots()` 在
   *   `sub_hull.png` 上按 `SEAT_MOUNTS` 挖 6 个凹坑，含内壁明暗 / 槽底翻边 /
   *   相邻艇缘提亮）。位图已被对齐成「躯干矩形 == SUB_D × HULL_H」⇒ 槽位与挂点
   *   **必然重合**，不可能错。
   *   本函数于是只剩两件事：**空座的那个内孔**、**未解锁的那块齐平封板**。
   *
   * ---------------------------------------------------------------------
   * 两种状态（`SEAT_MOUNTS` 六个位置一个不落地遍历）
   * ---------------------------------------------------------------------
   *   ① 已装武器（`i < weapons.length`）→ **完全不画**：`drawTurret` 的柱脚会
   *      从槽底长出来，把它盖住；画了只会在柱脚边上透出一圈多余的边。
   *   ② 已解锁 · 空座（`weapons.length ≤ i < maxWeapons`）→ **槽底一个发射口
   *      + 一点呼吸光**。槽本身在位图上，这里**不再画任何轮廓**（再画一遍就会
   *      把图上那条"受光的艇缘"盖掉）。
   *   ③ 未解锁（`i ≥ maxWeapons`）→ **齐平封板**：一块正好填掉那个槽的板
   *      （外缘与艇缘齐平、**不凸出**）+ 十字焊缝 + 两颗螺栓 ⇒ "这个口还锁着"。
   *      ⚠️ 位置**必须与槽逐像素同尺寸**：封板比槽小 ⇒ 板边露出一圈暗缝
   *      （读作"没盖严"）；比槽大一圈又回到"凸出的一块补丁"。
   *
   * ⚠️ ②③ 的差别**不能靠颜色**（深海会把亮度整体压掉，琥珀/青在这种面积上分不开），
   *    只能靠**有没有孔**：②中心是一个**暗孔**，③是一块**实心板 + 焊缝**。
   * ⚠️ ③ 刻意**不给镜面高光**：高光 = "这是块会反光的活金属"，
   *    封板要读作"死在那儿的一块补板"。
   */
  private drawSeatSockets(w: DiveWorld): void {
    const g = this.gPlayer
    const m = this.faceX                          // 朝向镜像（只翻 x）
    for (let i = 0; i < MAX_SEATS; i++) {
      if (i < w.weapons.length) continue          // ① 已装武器 → 交给 drawTurret
      const sm = SEAT_MOUNTS[i]
      const sgn = sm[1] < 0 ? -1 : 1              // 背脊(-1) / 腹部(+1)：槽往哪边挖
      const open = i < w.maxWeapons               // ② 敞开 / ③ 焊死
      const ext = i >= BASE_SEATS
      const cx2 = w.px + sm[0] * (SUB_D / 2) * m
      const cy2 = w.py + sm[1] * (HULL_H / 2)
      const HW = SLOT_HW * (ext ? 1.10 : 1)
      const HD = SLOT_HD * (ext ? 1.10 : 1)
      const PR = SEAT_PORT_R * (ext ? 1.10 : 1)
      const metal = ext ? UI.amber : UI.cyanHi
      const yOut = cy2 + sgn * SLOT_EDGE_OFF      // 槽口侧（≈ 艇缘）
      const yIn = cy2 - sgn * HD                  // 槽底侧

      if (open) {
        // ---- ② 空座：槽底一个**发射口** + 呼吸光 ----
        const cyf = cy2 - sgn * (HD * 0.58)       // 槽底中央
        g.fill(UI.abyss, 0.72); g.fillCircle(cx2, cyf, PR)
        // 翻边弧朝**槽口**那一侧（光源世界左上 ⇒ 背脊槽的翻边在上、腹部槽在下）
        g.line(metal, 0.36, Math.max(1, PR * 0.30))
        g.arc(cx2, cyf, PR * 0.94, sgn > 0 ? Math.PI * 0.06 : Math.PI * 1.06,
          sgn > 0 ? Math.PI * 0.94 : Math.PI * 1.94)
        g.stroke()
        // ⛔ V6.76 **不给"可装"加呼吸光**（试过 `fCircle(PR*2.1)` + 呼吸 α）：
        //    那是**又一层画上去的东西**，在 3.2× 验收图里读作"艇身上糊了一块灰斑"，
        //    正是用户这轮要消灭的观感。空座的信息量已经够：**槽（图上）+ 槽底内孔**。
        //
        // ⛔ V6.82 修一个**被注释吞掉的分支**：这一行行尾原来写着 `      } else {`，
        //    它落在 `//` 之后 ⇒ `else` 整个失效 —— 后果是「已解锁空座把封板也画一遍」
        //    （内孔被板盖住，读作这个座封死了）、而「真正未解锁的座什么都不画」
        //    （养成线还差两个孔的广告位消失）。tsc 不报错（括号仍配平）。
      } else {
        // ---- ③ 未解锁：**齐平封板**（正好填掉位图上的那个槽）----
        // ⚠️ 外缘只溢 0.4px：位图上的槽是像素级的，不留余量会在板边露出一圈暗缝
        //    （读作"没盖严"）；溢多了又变成凸起（试过 0.6 就已经浮在艇缘之上）。
        const hx = HW + 0.5
        const yo = yOut + sgn * 0.4
        const yt = Math.min(yo, yIn), hb = Math.abs(yIn - yo)
        g.fill(shade(BODY_METAL, 0.50), 1); g.fillRect(cx2 - hx, yt, hx * 2, hb)
        g.fill(shade(BODY_METAL, 0.62), 1)
        g.fillRect(cx2 - hx + 0.9, yt + 0.9, (hx - 0.9) * 2, Math.max(0.8, hb - 1.6))
        // 十字焊缝（"焊死"的语汇；门/舱盖同一套）+ 板沿暗缝
        const ws = Math.max(1, Math.min(HW, HD) * 0.34)
        g.line(shade(BODY_METAL, 0.86), 0.9, ws)
        const ymid = cy2 - sgn * HD * 0.5
        g.strokeSeg(cx2 - HW * 0.62, ymid, cx2 + HW * 0.62, ymid)
        g.strokeSeg(cx2, cy2 - sgn * HD * 0.16, cx2, cy2 - sgn * HD * 0.84)
        g.line(UI.abyss, 0.42, 1.1)
        g.strokeSeg(cx2 - hx, yOut - sgn * 0.2, cx2 + hx, yOut - sgn * 0.2)
        // ⚠️ 外框走**暗缝**不走主题色（V6.74 用的是 `metal`）：主题色描边是"UI 框"的
        //    语汇，会给封板加一圈亮边 ⇒ 它又变成"贴上去的一块"。封板要读作
        //    "艇身上焊了一块板"，全靠**暗缝 + 焊缝**，有没有亮边完全不参与叙事。
        g.line(UI.abyss, 0.55, 1); g.strokeRect(cx2 - hx, yt, hx * 2, hb)
      }
    }
  }

  private drawTurret(w: DiveWorld, i: number): void {
    const wp = w.weapons[i]
    const pose = w.turretPose(i)
    if (!wp || !pose) return
    const g = this.gPlayer
    const cx = pose.x, cy = pose.y, ang = pose.ang
    // ext = 容器扩容解锁出来的第 5、6 座：挂点略大 10% + 琥珀描边，
    // 让"我的艇变强了"在**剪影**上直接看得见，而不是只能读 HUD 数字。
    const ext = i >= BASE_SEATS
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

    const sgn = SEAT_MOUNTS[i][1] < 0 ? -1 : 1   // 背脊(-1) / 腹部(+1)：槽往哪边挖
    const RR = MOUNT_RING_R * (ext ? 1.10 : 1)
    const PR = SEAT_PORT_R * (ext ? 1.10 : 1)
    const HW = SLOT_HW * (ext ? 1.10 : 1)
    const HD = SLOT_HD * (ext ? 1.10 : 1)
    // 转座**受光弧**的颜色（V6.77）：扩容座泛暖，其余纯金属提亮。
    // ⚠️ 这个色**只能落在"受光弧"上**（见 ③）—— 别回去描边：
    //    闭合的亮色轮廓 = "UI 框"的语汇（铁规 14），那正是用户说的"像是画上去的"。
    const hiCol = ext ? mixCol(UI.amber, shade(BODY_METAL, 1.34), 0.55) : shade(BODY_METAL, 1.34)
    // ⚠️ 转座中心沿挂点法线的外移量，V6.76 从 `MOUNT_BASE_R×0.58 ≈ 8.7` 降到 `RR×0.90`。
    //    8.7 那个值是为**台面**配的（发射器机匣要整体趴在台面上）。
    //    现在台子删了、槽在座心±几 px 之内 ⇒ 外移量必须跟着降，否则发射器会**悬在槽上方**。
    //    `0.90×RR ≈ 6.3` 是让"机匣尾端伸进槽内"成立的唯一取值：
    //    尾端 = `rOut − 0.58×EMITTER_SIZE = 6.3 − 10.4 = −4.1`，而槽底在 `−SLOT_HD = −6`
    //    ⇒ **尾巴落在槽里**（这正是"插进去"的机械依据）。再来一次：改 `SLOT_HD` 或
    //    `EMITTER_SIZE` 都要重核这个不等式。
    // ⚠️ V6.82：`rOut` 改用共享常量 `TURRET_OUT` —— sim 的出弹点（`world` 的
    //    `OUT_Y`）与这里的转座心**必须同源**，否则子弹从炮管旁边飞出来。
    const rOut = TURRET_OUT * (ext ? 1.10 : 1)

    // ---- ① 柱脚：从**槽底**长到转座的一段低矮基座 ----
    //  V6.76 **删掉了 V6.74 的"安装底板"**（`MOUNT_BASE_R = 15` 的梯形悬臂台）：
    //  台面整个伸在 `HULL_OUTLINE` **之外** ⇒ 六座读作"贴在艇上的六块积木"，
    //  这正是用户 2026-10-15 驳回的「你画上去的突兀感」。
    //  ⇒ 现在孔由**机体位图自带**（`tools/prep_sub_art.py` 的 `bake_slots()`），
    //    这里只画一根**插进槽里的柱脚**。
    //  ⚠️ 柱脚**必须比槽窄**，而且要窄出一眼可见的量：现在 `2×PR = 8px` 对
    //     `2×SLOT_HW = 13px` ⇒ 槽左右各露 ~2.5px 暗腔（整条槽深都有）。
    //     **那 2.5px 就是"插件塞进槽里"的全部证据** ——
    //     试过 `PR+0.5`（9px），露出的暗边只有 2px 且被柱脚描边吃掉，实机上看不出来。
    //     柱脚一旦画得比槽宽，读法立刻退回"一块盖在艇上的东西"。
    const hwFoot = PR, hwTop = RR * 0.75
    const yFoot = cy - sgn * (HD - 0.6)   // 生根在槽底（收进 0.6px，别压掉槽底翻边）
    const yTop = cy + sgn * rOut
    const leg = (hx0: number, hx1: number, ay: number, by: number, dy: number) => {
      g.moveTo(cx - hx0, ay + dy); g.lineTo(cx + hx0, ay + dy)
      g.lineTo(cx + hx1, by + dy); g.lineTo(cx - hx1, by + dy); g.close()
    }
    // 投影：右下偏移 (1.6,1.6)。小偏移 = "微微浮着"，大偏移读成"后面还跟着一条船"。
    g.fill(UI.abyss, 0.32); leg(hwFoot, hwTop, yFoot, yTop, 1.6); g.fillPath()
    // 侧壁（厚度）：比正面暗一档 —— 有厚度才不是"贴在艇上的一块色斑"
    g.fill(shade(BODY_METAL, 0.50), 1); leg(hwFoot, hwTop, yFoot, yTop, 0); g.fillPath()
    // 正面：只**外缘一侧**受光；根部收 0.9px 留一道暗口 = "从这里插进槽"
    g.fill(shade(BODY_METAL, 0.86), 1)
    leg(hwFoot - 0.8, hwTop - 0.8, yFoot - sgn * 0.9, yTop - sgn * 1.0, 0); g.fillPath()
    g.line(shade(BODY_METAL, 1.30), 0.70, 1.1)
    g.strokeSeg(cx - (hwTop - 1.8), yTop - sgn * 2.2, cx + (hwTop - 1.8), yTop - sgn * 2.2)
    // ⚠️ V6.77：柱脚外轮廓走**暗缝**（旧版是 `metal` 亮线）——
    //    "柱脚与艇面的交界"本来就是暗的；描一条主题色亮边会让柱脚立刻读作
    //    "盖在艇上的一块"，正是本轮要消灭的那种观感。
    g.line(UI.abyss, 0.50, 1.1); leg(hwFoot, hwTop, yFoot, yTop, 0); g.stroke()

    // ---- ② 槽底的暗口：柱脚与槽底的交界（**横跨整个槽宽**）----
    //  它在柱脚两侧各露出一小段 ⇒ 读作"柱脚是从这个洞里升上来的"，
    //  而不是"柱子落在了甲板上"。与 `drawSeatSockets` 的槽底同高，两种状态对得上。
    g.line(UI.abyss, 0.58, 1.6)
    g.strokeSeg(cx - HW * 0.92, cy - sgn * (HD - 1.0), cx + HW * 0.92, cy - sgn * (HD - 1.0))

    // ---- ③ 炮身转座：**坐在槽口上**的那圈，随 `ang` 转（索敌转向）----
    //  耳轴 = 转座两侧那对横向短轴，最直接地说明"这是能转的"。
    //  ⚠️ 转座不能直接落在座心：那样柱脚只剩 0 高、槽被盖死，"装在槽里"读不出来。
    //     外移量见上面 `rOut` 的推导。
    // ⚠️ V6.82 **转座心不再吃 `fore`**：`drawEmitter` 内部已经统一加了 `fore`
    //    （`P` / `ox` / `bs` 都以传入的 cx,cy 为基准再偏移），而这里 `rx,ry` 又加一次
    //    ⇒ 后坐位移被算了**两遍**（开火瞬间炮口后退 ~11px，子弹却出现在未后退的
    //    位置 —— 用户说的"出弹口没对准炮口"有一半是这条）。现在转座静止、
    //    只有炮管/机匣以 1× 后坐。
    const rx = cx
    const ry = cy + sgn * rOut
    // ⛔ V6.77 **删掉那圈近白整圆**（用户原话：「还是有一层白圈呢」）。
    //    旧写法 `g.line(metal, …); g.strokeCircle(rx, ry, RR)` 给转座描了一圈亮边 ——
    //    闭合 + 极亮 ⇒ 读作"UI 框"；而且发射器画在它上面只会露出一牙白月牙。
    //    ⇒ 改成「**暗金属实心 + 单侧受光弧 + 对侧暗弧**」三件套：形体由**明暗**说，
    //      不由描边说（位图负责质感、矢量只负责几何 —— 铁规 11）。
    g.fill(shade(BODY_METAL, 0.58), 1); g.fillCircle(rx, ry, RR)
    // 左上受光弧（~176°→292°）+ 右下暗弧（~8°→126°）。角度与预览脚本逐值一致。
    // ⚠️ Cocos `Graphics.arc` 在这里是 **canvas 语义**（0° = 正 x 轴、角度顺时针增加），
    //    与 `rot()` 的 sim 语义一致（y 向下）⇒ **角度可以照抄预览，不需要翻 y**。
    //    验证方式：V6.76 原有的 `PI*1.02 → PI*1.46` 在预览里复刻的就是"左上弧"，
    //    两处对得上 ⇒ 语义相同（这一点搞错的话弧会跑到右下，而且不会报错）。
    g.line(hiCol, hot ? 0.85 : 0.62, Math.max(1.2, RR * 0.24))
    g.arc(rx, ry, RR, Math.PI * 0.978, Math.PI * 1.622); g.stroke()
    g.line(UI.abyss, 0.42, Math.max(1, RR * 0.16))
    g.arc(rx, ry, RR, Math.PI * 0.044, Math.PI * 0.700); g.stroke()
    // 轴颈：从转座**伸出来的一段短轴**（V6.77；旧版是两颗孤立小圆点 ——
    //  圆点读作"浮在旁边的点"，有连接段才读作"零件"）。世界固定左上受光 ⇒ 左侧更亮。
    for (const sx of [-1, 1]) {
      const a1 = this.rot(rx, ry, ang, 0, sx * RR * 1.30)
      const b1 = this.rot(rx, ry, ang, 0, sx * RR * 0.60)
      g.line(shade(BODY_METAL, sx > 0 ? 0.44 : 0.62), 1, Math.max(2, RR * 0.34))
      g.strokeSeg(b1.x, b1.y, a1.x, a1.y)
      g.line(shade(BODY_METAL, sx < 0 ? 1.22 : 0.80), 1, Math.max(1, RR * 0.15))
      g.strokeSeg(b1.x, b1.y, a1.x, a1.y)
    }

    // ⛔ V6.71 已删：旧的「底座圆盘 + 内凹槽 + 方形外罩」三层；V6.76 又删掉了
    //   V6.74 的「梯形悬臂台」（台面伸在机体轮廓之外 ⇒ 六座像"贴在艇上的积木"）。
    //   现在的安装结构收敛成**两级**：位图上的槽（开孔在图上）+ 插进槽里的柱脚 + 转座。
    //   ⛔ 不要再用 `Graphics` 在艇身**外面**画任何安装件 —— 判据：一个零件只要
    //      超出 `HULL_OUTLINE`，它就必然是"画上去的"，这是本轮返工的根因。

    // 发射器：坐在转座里，随索敌角旋转（子弹与枪口闪光也以它为准）
    // 发射器从**转座**里长出来（不是从座心）—— 与 ③ 同心，炮管才有「立在座上」的样子
    this.drawEmitter(wp.id, rx, ry, ang, hot, fore)

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
        // ⛔ V6.82 **删掉两道收拢圆环**（用户 2026-10-15 实机截图圈出「莫名的绘制体」）：
        //    闭合亮环 = "UI 框"的语汇（铁规 14），而且颜色取 `WEAPON_DEF.color`
        //    —— 回声炮是 `UI.magenta`，那是**敌人**的语汇（见 `theme.ts` ①），
        //    挂在自己炮口上读不出任何含义。与精英黄圈 / 定身青环**同一根因**。
        // ⇒ 改成**画在炮口自己身上**的充能柔光（与 `drawLamp` 同一手法：
        //    同心圆由外向内叠、**没有任何轮廓线**），越接近发射越亮越大。
        //    位置 = 炮口（`rx` 现在就是转座心 ⇒ 炮口 = 沿 aim 再伸 `MUZ`≈管长 12.24）。
        const chR = EMITTER_SIZE * 0.71
        const mx = rx + Math.cos(ang) * chR
        const my = ry + Math.sin(ang) * chR
        const cc = WEAPON_DEF[wp.id].color
        const gr = 2.6 + p * 4.4
        this.gFront.fill(cc, 0.10 * p); this.gFront.fillCircle(mx, my, gr * 2.3)
        this.gFront.fill(cc, 0.22 * p); this.gFront.fillCircle(mx, my, gr * 1.4)
        this.gFront.fill(cc, 0.42 * p); this.gFront.fillCircle(mx, my, gr)
        this.gFront.fill(0xffffff, 0.30 * p); this.gFront.fillCircle(mx, my, gr * 0.42)
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

    // ---- ⓪ 机匣（V6.73，**全族共用**）----
    // 用户实机反馈：「只有脉冲机关枪装在炮头上是很适配的，其他的器械都没做好吗」。
    // 真因：V6.70 只把**枪族**重做成了"真有炮管的硬件"，其余五族还是
    // "发光贴纸"（弧 / 液滴 / 折线）—— 没有一个**坐在转座里的身体**，
    // 读不出"这件武器是装上去的"。⇒ 每族先画一段**金属机匣**（尾厚前薄、
    // 上缘受光 / 下缘暗线，与 `barrel` 同一套圆柱语汇），族特征只负责**前端**。
    // ⚠️ 描边用武器本色 —— 机匣是金属，但"这是谁的枪"仍由颜色回答。
    // ⚠️ 尾端（`-0.58s ≈ -10.4px`）要**伸进槽里**：尾端相对座心的法向位置 =
    //    `rOut − 10.4 = 6.3 − 10.4 = −4.1`，而槽底在 `−SLOT_HD = −6` ⇒ 尾巴**在槽内**，
    //    这就是"发射器插在槽里"的机械依据（不是靠遮挡演的）。
    //    改 `EMITTER_SIZE` / `SLOT_HD` / `rOut` 任一个都要重核这个不等式，
    //    否则尾巴会压到艇身皮肤上，读作"炮躺在甲板上"。
    // ⚠️ 参数顺序：`barrel` 在 `l1` 端最粗，所以**倒着传**（l0=前端 / l1=尾端）
    //    才能得到"尾厚前薄"的机匣；`bore=false` 只留尾箍环、不画内孔。
    this.barrel(ox, oy, ang, s * 0.06, -s * 0.58, s * 0.34, c, false)

    if (fam === 'sonar') {
      // 声呐族（V6.79 **硬件化**）：**外扩的喇叭换能器**。
      //
      // ⛔ 旧版画的是「3 条同心弧 + 一个中心点」—— 那是**声波的符号**，不是零件。
      //    弧线没有任何厚度，`Graphics` 又画不出柔化 ⇒ 实机尺寸下读作"水面上浮着
      //    三道括弧"。符号能描述"它在发声"，但描述不了"**有个东西装在座上**" ——
      //    而后者才是发射器要回答的第一个问题。
      // ⇒ 改：**喇叭**（`h0 < h1` 的变径管）+ 开口环 + 振子，三条体积线索把它钉成
      //    一个金属件；"发声"改由**开火时**才出现的一道口环弧回答（效果不常驻）。
      //    共振炮（`sonar_fc`）喇叭更大 + 口部双环；散射（`sonar_rs`）口外三颗小振子。
      const fc = id === 'sonar_fc'
      const hornL = s * (fc ? 0.62 : 0.52)
      const hornR = s * (fc ? 0.46 : 0.40)
      this.metalTube(ox, oy, ang, s * 0.02, s * 0.12, hornL, hornR)
      // 口部走**开口环**（不是实心圆）—— 开口才读作"喇叭"；封死就退化成一个圆盘，
      // 而那正是回声族的样子（两族必须一眼可分）。
      const ho = this.rot(ox, oy, ang, hornL, 0)
      g.fill(UI.abyss, 0.74); g.fillCircle(ho.x, ho.y, hornR * 0.62)
      g.line(shade(BODY_METAL, 1.30), 0.52, Math.max(1, hornR * 0.24))
      g.strokeCircle(ho.x, ho.y, hornR * 0.62)
      // 振子：口内一颗小球头（金属亮面）—— "里面有东西在发波"
      g.fill(shade(BODY_METAL, 0.94), 1); g.fillCircle(ho.x, ho.y, hornR * 0.24)
      if (fc) {
        // 共振炮：口部第二道环 —— "更粗"要写成**结构**，不只是更大
        g.line(shade(BODY_METAL, 1.30), 0.42, 1)
        g.strokeCircle(ho.x, ho.y, hornR * 0.86)
      }
      if (id === 'sonar_rs') {
        // 散射：口外三颗小振子（保留变体语言，改成实心金属点）
        for (const da of [-0.9, 0, 0.9]) {
          const p = P(hornL + s * 0.26, Math.sin(da) * s * 0.34)
          g.fill(shade(BODY_METAL, 1.10), 1); g.fillCircle(p.x, p.y, s * 0.085)
          g.line(UI.abyss, 0.45, 1); g.strokeCircle(p.x, p.y, s * 0.085)
        }
      }
      // 开火：口部一道**前向弧** —— "发出声波"该出现的位置与时机
      if (firing) {
        g.line(0xffffff, 0.85, 1.8)
        g.arc(ho.x, ho.y, hornR * 1.35, ang - 0.85, ang + 0.85); g.stroke()
      }
    } else if (fam === 'gun') {
      // 机关枪族（V6.70 重做）：**真有炮管**的双管/五管 + 喇叭口。
      // 旧版是三条 1px 线 + 一个点 —— 侧视里读作"几根彩色划痕"，不是武器。
      const n = 2
      const pitch = id === 'gun_gl' ? s * 0.19 : s * 0.26
      for (let i = 0; i < n; i++) {
        const yy = (i - (n - 1) / 2) * pitch
        // 每根管子沿**局部 y** 偏移（用 rot 反算，不用 translate —— Graphics 没有变换 API）
        const bs = { x: cx + Math.cos(ang) * fore - Math.sin(ang) * yy,
                     y: cy + Math.sin(ang) * fore + Math.cos(ang) * yy }
        const l0 = -s * 0.30, l1 = s * 0.68
        const hh = id === 'gun_gl' ? s * 0.185 : s * 0.155
        this.barrel(bs.x, bs.y, ang, l0, l1, hh, c)
        // 开火时炮口内孔短暂发亮 —— "刚刚射出去"的那一下
        if (firing) {
          const mo = this.rot(bs.x, bs.y, ang, l1, 0)
          g.fill(0xffffff, 0.9); g.fillCircle(mo.x, mo.y, hh * 0.6)
        }
      }
      // 加特林额外两根细管（画成小口径管，不用主炮那么粗）
      if (id === 'gun_gl') {
        for (const k of [-1.5, 1.5]) {
          const yy = k * s * 0.19
          const bs = { x: cx + Math.cos(ang) * fore - Math.sin(ang) * yy,
                       y: cy + Math.sin(ang) * fore + Math.cos(ang) * yy }
          this.barrel(bs.x, bs.y, ang, -s * 0.22, s * 0.50, s * 0.075, c, false)
        }
      }
      // 霰弹：炮口外扩喇叭（两条短斜撑），把"散射"写到枪管上。
      // ⚠️ **只在霰弹上画**：画在所有枪族上时，两根炮口之间会多出一对交叉斜撑，
      //    6× 预览下读成一个 "X" 螺旋桨（第一版预览被否掉的就是这个）。
      //    同源铁律：加法只在**语义成立**的那一个变体上做。
      if (id === 'gun_sg') {
        const bs = { x: cx + Math.cos(ang) * fore, y: cy + Math.sin(ang) * fore }
        const m0 = this.rot(bs.x, bs.y, ang, s * 0.68, 0)
        for (const sgn of [-1, 1]) {
          const m1 = this.rot(bs.x, bs.y, ang, s * 0.88, sgn * s * 0.34)
          g.line(c, 0.9, 1.8)
          g.strokeSeg(m0.x, m0.y, m1.x, m1.y)
        }
      }
    } else if (fam === 'torpedo') {
      // 鱼雷族（V6.70 重做）：**粗管 + 管口环**，集束三管口；重型更粗 + 双环。
      // ⚠️ 管身**绝不能填近黑**：曾经用近黑填管身，在明亮水层下就是一块纯黑矩形 ——
      //    那正是用户反复反馈的"击杀之后有一个黑色方块"的真凶。
      //    `barrel` 用 `shade(BODY_METAL, 0.60)` 而非 abyss，就是为了守住这条。
      const wide = id === 'torp_hv'
      if (id === 'torp_cl') {
        // 集束：三根细管并排（真实鱼雷发射器的形态）
        for (const yy of [-s * 0.21, 0, s * 0.21]) {
          const bs = { x: cx + Math.cos(ang) * fore - Math.sin(ang) * yy,
                       y: cy + Math.sin(ang) * fore + Math.cos(ang) * yy }
          this.barrel(bs.x, bs.y, ang, -s * 0.42, s * 0.62, s * 0.115, c)
        }
      } else {
        const bs = { x: cx + Math.cos(ang) * fore, y: cy + Math.sin(ang) * fore }
        this.barrel(bs.x, bs.y, ang, -s * 0.46, s * 0.66, wide ? s * 0.36 : s * 0.26, c)
        if (wide) {
          // 重型：管身第二道箍环（把"更粗"写成结构，不只是更宽）
          const m3 = this.rot(bs.x, bs.y, ang, s * 0.16, 0)
          g.line(c, 0.75, 1.8)
          g.arc(m3.x, m3.y, s * 0.40, ang - 1.4, ang + 1.4); g.stroke()
        }
        if (firing) {
          const mo = this.rot(bs.x, bs.y, ang, s * 0.66, 0)
          g.fill(0xffffff, 0.85)
          g.fillCircle(mo.x, mo.y, (wide ? s * 0.36 : s * 0.26) * 0.55)
        }
      }
    } else if (fam === 'arc') {
      // 电弧族（V6.79 **硬件化**）：**两根金属电极柱 + 球头**；中间那束电是效果层。
      //
      // ⛔ 旧版把"两根电极"本身画成 2px 线 ⇒ **零件与效果同宽同质感**，实机尺寸下
      //    整体读作"一撮彩色划痕"：分不出哪里是硬件、哪里在通电。
      // ⇒ 电极改成有体积的柱（`metalTube`）+ 顶端**球头**（放电点必须是实体，
      //    否则"从哪打出去"没有答案）。电弧仍是细折线 —— **电离空气本来就没有厚度**，
      //    这与"体积光必须位图"同源：承不承认边缘模糊，决定该用哪种语汇。
      // ⚠️ 电极**必须够粗**：第一版 `eR = s*0.075` ⇒ 直径 3px、球头 4px，
      //    实机 1× 下两根柱 + 两个球头全糊成**一条黑竖条**（管身是 `shade(BODY_METAL,0.60)`
      //    的暗体，3px 宽时暗体没有受光带可读 ⇒ 只剩"黑"）。同样尺寸下枪族管径是这个的 2 倍。
      const eR = s * 0.125
      const eL0 = s * 0.04
      const eL1 = s * (id === 'arc_ov' ? 0.56 : 0.48)
      const eOff = s * 0.34
      // ⚠️ `TIP_R` = 球头中心相对于中线的收拢比例，它同时决定**两根球头的间距**
      //    （= 2×eOff×TIP_R）。第一版取 0.34 ⇒ 间距比球头直径还小，
      //    两个球头**叠在一起**、读作"一根粗棒的两个头"。0.48 才分得开。
      const TIP_R = 0.48
      const nvx = -Math.sin(ang), nvy = Math.cos(ang)     // 法向（背 -1 / 腹 +1）
      const fwx = Math.cos(ang), fwy = Math.sin(ang)      // 前向
      // ⚠️ 两根电极柱必须**向前收拢**（尖端靠近）—— 平行朝前读作"两根炮管"；
      //    收拢 + 球头相对，才读作"一对电极在放电"。
      const tipX: number[] = [], tipY: number[] = []
      for (const sy of [-1, 1]) {
        const p0x = ox + nvx * sy * eOff, p0y = oy + nvy * sy * eOff
        const p1x = ox + nvx * sy * eOff * TIP_R + fwx * eL1
        const p1y = oy + nvy * sy * eOff * TIP_R + fwy * eL1
        this.metalTube(p0x, p0y, Math.atan2(p1y - p0y, p1x - p0x), eL0, eR * 1.20,
                       Math.hypot(p1x - p0x, p1y - p0y), eR * 0.90)
        // 球头（放电点必须是实体，否则"从哪打出去"没有答案）
        g.fill(shade(BODY_METAL, 0.86), 1); g.fillCircle(p1x, p1y, eR * 1.5)
        g.line(shade(BODY_METAL, 1.34), 0.60, Math.max(1, eR * 0.7))
        g.arc(p1x, p1y, eR * 1.5, Math.PI * 0.98, Math.PI * 1.62); g.stroke()
        tipX.push(p1x); tipY.push(p1y)
      }
      if (id === 'arc_st') {
        // 定点雷暴：向四周放射（效果层 —— 细线）
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          const p = P(Math.cos(a) * s * 0.66, Math.sin(a) * s * 0.66)
          g.line(firing ? 0xffffff : c, 0.85, 1.4)
          g.strokeSeg(ox, oy, p.x, p.y)
        }
      } else {
        // 两根**球头之间**跳跃的折线：`t` 沿柱长 0→1、`v` 在 ±1 之间来回。
        // ⚠️ 端点必须收在球头上 —— 沿用旧的固定坐标会让电弧**悬空**，读作"飘着的线"。
        const tz = id === 'arc_ov' ? [0, 0.20, 0.42, 0.68, 1] : [0, 0.34, 0.66, 1]
        const vz = id === 'arc_ov' ? [1, -0.15, 1.15, -0.25, -1] : [1, -0.15, 1.15, -1]
        // ⚠️ 两个坑，都只有**放大图**才能发现：
        //   ① 端点必须落在**两个球头**上（`vz = ±1` ⇒ 正好是 `eOff × TIP_R` 那两点）。
        //      沿用旧的固定坐标会让电弧**悬空**，读作"飘在旁边的一根线"。
        //   ② **必须带前向抖动**（`dz`）—— 只改法向偏移的话所有点共线，
        //      折线退化成一条直线，6× 下读成一个**实心色块**（第一版就是这样）。
        const midX = (tipX[0] + tipX[1]) * 0.5, midY = (tipY[0] + tipY[1]) * 0.5
        const dz = id === 'arc_ov' ? [0, 0.12, -0.08, 0.10, 0] : [0, 0.12, -0.08, 0]
        const z = tz.map((_: number, i: number) => {
          const off = eOff * TIP_R * vz[i]
          const push = s * 0.05 * dz[i]
          return { x: midX + nvx * off + fwx * push, y: midY + nvy * off + fwy * push }
        })
        neon(g, firing ? 0xffffff : c, () => {
          g.moveTo(z[0].x, z[0].y)
          for (let i = 1; i < z.length; i++) g.lineTo(z[i].x, z[i].y)
          g.stroke()
        }, { width: 1.6, bloom: firing })
      }
    } else if (fam === 'harpoon') {
      // 鱼叉族（V6.79 **硬件化**）：**粗杆 + 亮箍 + 向前张开的三齿**（一支装上去的叉头）。
      //
      // ⛔ 旧版是"2.2px 的线 + 两条斜线当倒钩" —— 用户截图里圈的那个**箭头**就是它。
      // ★★ 这一族前后试了**三版**才想明白，"箭头"这个读法必须从**字形**上根除：
      //   ① "细线 + V 形倒钩" = 箭头（用户圈的就是它）；
      //   ② "粗杆 + 实心三角矛头 + 倒钩" = **还是箭头**，加粗只让它更像箭头
      //      —— 一根杆 + 一个三角，那就是"箭头"的字形本身；
      //   ③ "粗杆 + 菱形叶片 + 向后大张的长倒须" = 6× 读成 **X / 星号**，1× 退回来仍是 "→"。
      //   ⇒ 结论：**只要前端收敛成一个尖，它就一定是箭头**。粗细 / 形状 / 倒钩方向
      //      都改不出这个坑。要跳出去，**前端必须分成多股** ——
      //      而鱼叉本来就是**叉**：杆 → 亮箍（装叉头的接头）→ 2~3 根**向前张开**的齿。
      //   ⚠️ 齿必须**张开**（尖端离轴）；收拢 = 又变回一个尖 = 又是箭头。
      //      `harp_tr`（三重）= 三根平行杆 + **张得更开、更长**；基础款三齿束在一根杆上；
      //      回旋（`harp_cb`）尾端配重环。
      const tri = id === 'harp_tr'
      const shafts = tri ? [-1, 0, 1] : [0]
      const gap = tri ? s * 0.15 : 0
      for (const k of shafts) {
        const yy = k * gap
        const bc = { x: ox - Math.sin(ang) * yy, y: oy + Math.cos(ang) * yy }
        // 杆：尾粗前细，但**整体与枪族管径同量级** —— 实机尺寸（`EMITTER_SIZE=18`
        //   ⇒ 整台发射器约 36px）下"细"是读不出来的，能读的只有剪影大形。
        this.metalTube(bc.x, bc.y, ang, -s * 0.42, s * 0.13, s * 0.60, s * 0.10)
      }
      const Q = (lx: number, ly: number) => this.rot(ox, oy, ang, lx, ly)
      // 亮箍：叉杆 → 叉头的接头（"这是一支装上去的叉头"的全部证据）
      const fw = tri ? s * 0.20 : s * 0.145
      this.metalTube(ox, oy, ang, s * 0.52, fw * 0.80, s * 0.66, fw)
      // 齿：向前**张开** —— ★ 与箭头分界的那一条。
      //   ⚠️ **基础款也必须是三齿**：二齿在 1× 下外轮廓就是 `—<`，仍旧读作箭头。
      //      中央那根**伸得比两侧长**，露出叉口之外 ⇒ 剪影是 `—Ψ`，箭头读法才被破掉。
      //   `harp_tr` 只是**张得更开、更粗**，并配三根平行杆。
      const prongs: Array<[number, number]> = tri
        ? [[0, 1.20], [-1, 1.04], [1, 1.04]]
        : [[0, 1.16], [-1, 0.96], [1, 0.96]]
      const spread = tri ? 0.34 : 0.28
      for (const [sy, ex] of prongs) {
        const a0 = Q(s * 0.62, sy * s * 0.054)
        const a1 = Q(s * ex, sy * s * spread)
        // 齿径 `s*0.078 → s*0.030`（实机 2.8→1.1px）在 1× 下细成"须"，
        // 读作"线画的叉"；提到 `s*0.105 → s*0.050` 才是**有厚度的齿**。
        this.metalTube(a0.x, a0.y, Math.atan2(a1.y - a0.y, a1.x - a0.x),
                       0, s * 0.105, Math.hypot(a1.x - a0.x, a1.y - a0.y), s * 0.050)
        // 齿尖球头（"着力点"——齿是零件，不是一个箭头符号）
        g.fill(shade(BODY_METAL, 0.96), 1); g.fillCircle(a1.x, a1.y, s * 0.060)
        g.line(UI.abyss, 0.46, 1); g.strokeCircle(a1.x, a1.y, s * 0.060)
      }
      if (id === 'harp_cb') {
        // 回旋：尾端**配重环**（实心环，不是细圈）
        const lp = P(-s * 0.58, 0)
        g.fill(shade(BODY_METAL, 0.70), 1); g.fillCircle(lp.x, lp.y, s * 0.22)
        g.fill(UI.abyss, 0.66); g.fillCircle(lp.x, lp.y, s * 0.11)
        g.line(shade(BODY_METAL, 1.26), 0.55, 1.2); g.strokeCircle(lp.x, lp.y, s * 0.22)
      }
      if (firing) {
        const mz = P(tri ? s * 1.30 : s * 1.22, 0)
        g.fill(0xffffff, 0.85); g.fillCircle(mz.x, mz.y, s * 0.12)
      }
    } else if (fam === 'echo') {
      // 回声族（V6.79 **硬件化**）：**短粗筒 + 封闭厚盘** —— 与声呐的**开口喇叭**
      // 共用同一套变径管语汇（同一个方法、方向相反，就是两种零件）。
      //
      // ⛔ 旧版是"一个实心圆 + 前方另一个圆 + 一圈细环"，三个**平面圆**没有任何
      //    厚度线索 ⇒ 实机下读作"枪管前面画了个靶心"；而且与声呐长得像（都是圆）。
      //    用户圈的那个"炮塔图形"就是二者之一 —— 两族本来就该靠**剪影**分开。
      // ⇒ 回声 = **封死的厚盘**（端面 + 中心凸起 + 受光弧 + 对侧暗弧）；
      //    声呐 = **张口的喇叭**。一个像铆钉头、一个像扩音器。
      const big = id === 'echo_fo'
      const diskL = s * (big ? 0.40 : 0.34)
      const diskR = s * (big ? 0.32 : 0.26)
      this.metalTube(ox, oy, ang, s * 0.02, s * 0.13, diskL, diskR)
      const dp = this.rot(ox, oy, ang, diskL, 0)
      // 端面：实心盘 + 上缘受光弧 + 右下暗弧（厚度线索的另一半）
      g.fill(shade(BODY_METAL, 0.94), 1); g.fillCircle(dp.x, dp.y, diskR)
      g.line(shade(BODY_METAL, 1.34), 0.55, Math.max(1, diskR * 0.22))
      g.arc(dp.x, dp.y, diskR * 0.94, Math.PI * 0.98, Math.PI * 1.64); g.stroke()
      g.line(UI.abyss, 0.42, Math.max(1, diskR * 0.18))
      g.arc(dp.x, dp.y, diskR * 0.94, Math.PI * 0.06, Math.PI * 0.68); g.stroke()
      // 中心凸起（振膜中心）—— "敲一下再听回声"的那个点
      g.fill(shade(BODY_METAL, 1.20), 1); g.fillCircle(dp.x, dp.y, diskR * 0.30)
      g.line(UI.abyss, 0.40, 1); g.strokeCircle(dp.x, dp.y, diskR * 0.30)
      if (id === 'echo_mu') {
        // 多重：盘外三颗小振子（金属化 —— 保留变体语言）
        for (const k of [-1, 0, 1]) {
          const p = P(diskL + s * 0.24, k * s * 0.30)
          g.fill(shade(BODY_METAL, 1.06), 1); g.fillCircle(p.x, p.y, s * 0.10)
          g.line(UI.abyss, 0.45, 1); g.strokeCircle(p.x, p.y, s * 0.10)
        }
      } else if (id === 'echo_fo') {
        // 聚焦：盘外一道粗环 —— "把回声聚成一束"
        const p = P(diskL + s * 0.30, 0)
        g.line(shade(BODY_METAL, 1.24), 0.55, 1.8)
        g.strokeCircle(p.x, p.y, s * 0.30)
      }
      if (firing) {
        g.fill(0xffffff, 0.9); g.fillCircle(dp.x, dp.y, diskR * 0.52)
      }
    } else {
      // 酸液族（V6.79 **硬件化**）：**收细的喷嘴锥** —— 与声呐的**外扩喇叭**是同一个
      // 变径管语汇，**方向相反就是两种零件**（这是"7 族共用一套硬件语言"的最小证明）。
      //
      // ⛔ 旧版是一个 `fill(c, 0.28)` 的空三角 + 描边，零体积线索 ⇒ 实机下读作
      //    "枪管前面画了个三角形"。它和鱼叉那个"箭头"是同一类问题：
      //    **线框符号冒充零件**。
      // ⇒ 现在：从粗到细的锥 + 前端喷口内孔；"喷"由开火时的口部亮点回答。
      const big = id === 'acid_fd'
      const nz0 = s * (big ? 0.40 : 0.34)      // 尾端半径（接机匣）
      const nz1 = s * 0.11                     // 喷嘴口半径
      const nzL = s * (big ? 0.56 : 0.64)
      this.metalTube(ox, oy, ang, -s * 0.16, nz0, nzL, nz1, true, 0.52)
      const mz = this.rot(ox, oy, ang, nzL, 0)
      if (id === 'acid_ra') {
        // 酸雨：口外三颗液滴（它们是**抛射物**，允许保留本色与亮面 —— 与零件区分开）
        for (const k of [-1, 0, 1]) {
          const p = P(nzL + s * 0.28, k * s * 0.28)
          g.fill(firing ? 0xffffff : c, 0.9); g.fillCircle(p.x, p.y, s * 0.09)
        }
      } else if (id === 'acid_fd') {
        // 持久酸池：尾端配重环
        const p = P(-s * 0.30, 0)
        g.line(shade(BODY_METAL, 1.22), 0.55, 1.4)
        g.strokeCircle(p.x, p.y, s * 0.24)
      }
      if (firing) {
        g.fill(0xffffff, 0.9); g.fillCircle(mz.x, mz.y, nz1 * 1.1)
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

    // ---- 折线残影（两种东西共用这一个数组，**必须按颜色分流**）----
    // · **紫 = 电弧**（`color` 缺省）：V6.74 升级成"雷电"（见下）
    // · **带色 = 网目**（`color` 有值，玉/青）：保持"两遍描边"的朴素写法 ——
    //   网是**实体绳索**，不是电离空气；给它加辉光和分叉会读成"网上带电"。
    for (const a of this.arcs) {
      const k = Math.max(0, a.life / (a.maxLife ?? 0.18))
      const c = a.color ?? 0xa06bff
      const pts = a.pts
      if (pts.length < 2) continue

      if (a.color !== undefined) {
        // 网目：原样（粗 + 细两遍）
        this.gFront.line(c, 0.9 * k, 3); this.gFront.strokePolyline(pts)
        this.gFront.line(0xffffff, 0.7 * k, 1.2); this.gFront.strokePolyline(pts)
        continue
      }

      // ---- **闪电链**（V6.80；用户：「电弧 施法特效也太简单粗暴了 可以做成闪电链
      //      被击中的敌方 在一定范围内可以被传导」）----
      // 演进：V6.29 两遍描边 → V6.74 四层宽度梯度 + 分叉（"像雷电"了）→ **本版：链**。
      //  V6.74 把**一根弧**画好了，但 `pts` 是"玩家 → 敌1 → 敌2 → …"的折线，
      //  两段之间是**直线** ⇒ 读到的是"一根线拐了个弯"，读不出"电**跳**到了下一只身上"。
      //  ⚠️ **传导机制早已存在**（`world.fireArc`：链 2+lvl 跳、跳距 190、`arc_ov` +4 不衰减）——
      //     本次**一个字都没改模拟层**，改的纯粹是"这一串跳跃长什么样"。
      // ★ 链的三条判据，缺一条就退回"一根线"：
      //   ① **每一跳 = 独立的一条闪电路径**：段内插值 + 垂直抖动（`fxT` 驱动）⇒ 每帧噼啪；
      //      ⚠️ 抖动包络取 `sin(πt)` ⇒ **两端为 0**，必须钉死在敌人身上，
      //        否则看起来"电没打中"。中间鼓、两头收，这才是两点之间的放电。
      //   ② **逐跳衰减**：第 n 跳更细更暗 ⇒ "传导有损耗"，也让"跳到了第几只"可读。
      //   ③ **落点爆闪 + 缠绕弧**：每只被跳中的敌人身上 3 段短弧 + 亮核 ⇒
      //      "它**中电了**"，而不是"有根线从它身上穿过"。
      // ⚠️ 全部只插值 `pts`，不碰模拟层（命中判定与外观无关，同 V6.74）。
      const n = pts.length
      const jitSeg = (seg: number) => {
        const a = pts[seg], b2 = pts[seg + 1]
        const dx = b2.x - a.x, dy = b2.y - a.y
        const L = Math.hypot(dx, dy) || 1
        const nx2 = -dy / L, ny2 = dx / L
        const out: Array<{ x: number; y: number }> = []
        for (let i = 0; i <= 6; i++) {
          const t = i / 6
          const env = Math.sin(Math.PI * t)
          const off = Math.sin(this.fxT * 41 + seg * 1.7 + i * 2.3) * (7 + 3 * seg) * env
          out.push({ x: a.x + dx * t + nx2 * off, y: a.y + dy * t + ny2 * off })
        }
        return out
      }
      for (let seg = 0; seg < n - 1; seg++) {
        const segPts = jitSeg(seg)
        const dec = 1 / (1 + seg * 0.42)
        this.gFront.line(c, 0.13 * k * dec, 9 * dec); this.gFront.strokePolyline(segPts)
        this.gFront.line(c, 0.34 * k * dec, 4.6 * dec); this.gFront.strokePolyline(segPts)
        this.gFront.line(c, 0.95 * k * dec, 2.1 * dec); this.gFront.strokePolyline(segPts)
        this.gFront.line(0xffffff, 0.85 * k * dec, Math.max(0.7, dec))
        this.gFront.strokePolyline(segPts)
      }
      // ③ 端点：起点（我自己）小闪 + 四向短芒；**落点**（被跳中的敌人）爆闪 + 缠绕弧
      for (let i = 0; i < n; i++) {
        const q = pts[i]
        const dec = 1 / (1 + i * 0.34)
        const pu = 1 + 0.25 * Math.sin(this.fxT * 46 + i)
        if (i === 0) {
          this.gFront.fill(0xffffff, 0.9 * k); this.gFront.fillCircle(q.x, q.y, 2.6)
          this.gFront.line(c, 0.7 * k, 1.4)
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            this.gFront.strokeSeg(q.x + ax * 5, q.y + ay * 5, q.x + ax * 12, q.y + ay * 12)
          }
          continue
        }
        // ★ 落点 = "它中电了"的全部证据
        this.gFront.fill(c, 0.24 * k * dec); this.gFront.fillCircle(q.x, q.y, 13 * pu * dec)
        this.gFront.fill(c, 0.50 * k * dec); this.gFront.fillCircle(q.x, q.y, 6 * pu * dec)
        this.gFront.fill(0xffffff, 0.90 * k * dec); this.gFront.fillCircle(q.x, q.y, 2.6 * dec)
        this.gFront.line(c, 0.75 * k * dec, 1.7)
        for (let j = 0; j < 3; j++) {
          const a0 = this.fxT * 6.5 + i * 1.3 + j * (Math.PI * 2 / 3)
          this.gFront.arc(q.x, q.y, 12 * pu * dec, a0, a0 + 1.15); this.gFront.stroke()
        }
      }
      // ④ 电荷沿**整条链**跑（"电在导线里走"）
      const prog = (this.fxT * 1.7) % 1
      const fi = prog * (n - 1)
      const i0 = Math.floor(fi), i1 = Math.min(n - 1, i0 + 1)
      const ft = fi - i0
      this.gFront.fill(0xffffff, 0.95 * k)
      this.gFront.fillCircle(pts[i0].x + (pts[i1].x - pts[i0].x) * ft,
        pts[i0].y + (pts[i1].y - pts[i0].y) * ft, 2.2)
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
