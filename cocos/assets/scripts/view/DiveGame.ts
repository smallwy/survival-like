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
 *     ├ gBg       Graphics 海雪（**在背景图之上**）
 *     ├ gVeil     Graphics 环境色调 + 压暗 + 暗角 + 屏幕边框（**必须低于实体**）
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
import { DiveWorld } from '../shared/dive/world'
import { applyRun, defaultProfile, depthLabel, recordLabel } from '../shared/dive/profile'
import {
  settleProgress, unlockName, perkBonus, filterPool,
  canBuyPerk, buyPerk as buyPerkPure,
} from '../shared/dive/unlocks'
import type { PerkId } from '../shared/dive/unlocks'
import { codexGains } from '../shared/dive/codex'
import type { Profile } from '../shared/dive/profile'
import {
  CAM_ZOOM, TURRET_R, EMITTER_SIZE, SUB_D, BASE_SEATS, WEAPON_DEF, SEAT_RATIO, SEAT_RING_R,
  BONE, weaponFamily,
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
interface Mote { x: number; y: number; r: number; vy: number }
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
/** 位图击杀特效同屏上限。一帧十几只同屏死是常事，超了就丢最早的。 */
const FXBIT_CAP = 28
/** 单帧最大步长（与模拟层的 MAX_DT 同源，防止后台切回来时世界瞬移） */
const MAX_DT = 0.05

/** 局部 clamp（此处只有相机用，且要传 lo>hi 也不会炸的语义，所以不引 shared 的 clamp） */
function clamp1(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v)
}

/**
 * 机体（玩家潜航器）的船体基色 —— 中亮青蓝。
 *
 * 为什么不用 `UI.cyanDim`（0x1f6a7d）：那个色在深海暗底上太闷，球体只剩一个黑饼，
 * 而**玩家机体必须是画面里最亮的青系**（theme 的色相隔离规则：青蓝 = 我的东西）。
 * 取 0x2f8fa8 让"球面受光的最亮处"接近 `UI.cyan`，同时保留外圈霓虹描边的对比。
 */
const BODY_METAL = 0x2f8fa8

/**
 * 机体**视觉半径** ÷ 座圈半径（`SEAT_RING_R`）。2026-10-13 新增。
 *
 * 用户反馈：「机体感觉大了一点点」。
 * 原因两条叠加：① 矢量机体的球半径原与座圈同值 `48`，而旧贴图半径是 `SUB_D/2 = 44`
 * （大了 ~9%）；② 旧贴图带透明边，现在是一个**满半径的实心圆**，视觉上更显大。
 * `0.90 × 48 = 43.2 ≈ 44` → 与旧机体尺寸对齐。
 *
 * 顺带得到一个正确的结果：收缩后 6 座炮**正好骑在艇缘上** ——
 * 舷侧两座（±30°/±150°）距圆心 `43.3`，球半径 `43.2`，炮心贴在轮廓线上；
 * 上下两座仍落在赤道挂载带上。这正是 `SEAT_RING_R` 当初上调到 48 的设计意图
 * （tables.ts：塔座中心落在机体外缘之外，读作"镶嵌在艇缘"）。
 *
 * ⚠️ 这是**纯视觉**系数：`SEAT_RING_R`（= 座位 = 子弹出生点）不动，**弹道零变化**。
 */
const BODY_VIS = 0.90

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

  // ---- 节点 ----
  private worldRoot!: Node
  private bgNode!: Sprite
  /** 不透明底色（最底层）。**不能并进 gBg** —— gBg 在背景图之上，会把它盖死 */
  private gBase!: Gfx
  private gBg!: Gfx
  private gVeil!: Gfx
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
  /** 表现层计时器（鱼雷气泡尾迹的正弦摆动等用；与 sim 的时间无关） */
  private fxT = 0
  /** 本帧的受击白闪（drawEnemies 登记 → drawFx 消费，见 FlashMark 的注释） */
  private flashMarks: FlashMark[] = []

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

    // gBg：海雪。**在背景图之上**才是对的（雪是"我在水里"的近景证据，
    // 压在背景图下面等于看不见），但绝不能在这里画不透明底色。
    this.gBg = this.mkWrapped('gBg', this.worldRoot)
    this.gVeil = this.mkWrapped('gVeil', this.worldRoot)
    // gBack：地面性质的东西（酸液云 / 鱼骨 / 声呐波前 / 爆炸环）—— 画在鱼**之下**。
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
      this.gBase.clear(); this.gBg.clear(); this.gVeil.clear(); this.gBack.clear()
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

    this.gBase.clear(); this.gBg.clear(); this.gVeil.clear(); this.gBack.clear()
    this.gEnt.clear(); this.gPlayer.clear(); this.gFront.clear()

    this.drawBg(w, dt)
    if (combat) {
      this.syncSub(w)
      this.drawWorld(w)
    } else {
      this.hideWorld()
    }
    this.drawVeil(w)
    this.drawFx()
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
        // 枪：尖头短闪 + 少量火花（原样，只把尺寸交给 S）
        this.sparks.push({
          x, y, vx: 0, vy: 0, life: 0.11, maxLife: 0.11,
          color, size: 7 * S, ang, kind: 'flash',
        })
        for (let i = 0; i < (power >= 2 ? 6 : 3); i++) {
          const a = ang + (Math.random() - 0.5) * 0.7
          const sp = (70 + Math.random() * 90) * S
          this.sparks.push({
            x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.16, maxLife: 0.16, color, size: 1.4 + Math.random() * 1.2, ang: a, kind: 'hit',
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
        break
      case 'float':
        this.pushFloat(ev.x, ev.y, ev.text, ev.color, ev.size)
        break
      case 'muzzle':
        this.muzzleFx(ev.x, ev.y, ev.ang, ev.color, ev.fam, ev.power ?? 1)
        break
      case 'burst':
        this.pushShock(ev.x, ev.y, ev.r, 0.4, UI.cyanHi, 3, ev.r * 0.12, 1)
        break
      case 'arc':
        this.arcs.push({ pts: ev.pts, life: 0.18 })
        break
      case 'blast':
        this.blasts.push({ x: ev.x, y: ev.y, r: ev.r, life: 0.32 })
        break
      case 'descend':
        this.clearFx()
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
      //   playerHurt、dodge、wave / waveCleared / layerCleared
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

    // 海雪（纯表现）。越深越密是 web 的做法，这里密度固定 60，够用。
    if (this.motes.length === 0) {
      for (let i = 0; i < 60; i++) {
        this.motes.push({ x: Math.random() * this.W, y: Math.random() * this.H, r: 0.8 + Math.random() * 1.8, vy: -6 - Math.random() * 14 })
      }
    }
    for (const m of this.motes) {
      m.y += m.vy * dt
      if (m.y < -4) { m.y = this.H + 4; m.x = Math.random() * this.W }
      this.gBg.fill(0x9fe1cb, 0.16)
      this.gBg.fillCircle(m.x, m.y, m.r)
    }
  }

  /**
   * 环境色调 + 压暗 + 暗角 + 屏幕边框。
   *
   * 数值全部来自 web：色调 0.10（只是把背景图的色相往 UI 色系拉一点，压死画面就废了）、
   * 压暗 `(1 - vis) × 0.42`、暗角 18 环 `pow(1 - i/18, 2.4) × strength`。
   * 暗角必须用**同心环带**而不是径向渐变：环带每像素只画一次，渐变会被反复叠加成死黑。
   */
  private drawVeil(w: DiveWorld): void {
    // 弹窗相位不画环境层：那几个页面是一整张实底页，环境不该透上来。
    if (w.phase === 'shop' || w.phase === 'decide' || w.phase === 'result') return

    const vr = this.viewRect()
    const L = w.layer()
    const z = this.zoom > 0 ? this.zoom : 1

    this.gVeil.fill(L.tint, 0.10); this.gVeil.fillRect(vr.x, vr.y, vr.w, vr.h)
    this.gVeil.fill(UI.abyss, (1 - L.vis) * 0.42); this.gVeil.fillRect(vr.x, vr.y, vr.w, vr.h)

    // 暗角：环带宽度按 zoom 折算，这样放大后屏幕上的视觉宽度保持一致
    const BANDS = 18
    const band = Math.min(vr.w, vr.h) / BANDS
    const descBoost = w.phase === 'descending' ? 0.38 : 0
    const strength = 0.16 + (1 - L.vis) * 0.72 + descBoost
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
      const breathe = 0.5 + 0.5 * Math.sin(w.t * 3.1 + m.x * 0.02)
      if (!armed) {
        // 布防中：暗壳 + 8 段虚线圈
        this.gBack.fill(0x14232f, 0.8); this.gBack.fillCircle(m.x, m.y, 8)
        this.gBack.line(0x4a7c91, 0.55, 1)
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2
          this.gBack.arc(m.x, m.y, m.trig, a0, a0 + 0.34).stroke()
        }
      } else {
        // 已激活：氧青球（三层）+ 呼吸光环 + 高光点（高光让它读作"球"不是"圈"）
        this.gBack.fill(UI.cyanHi, 0.14 + 0.10 * breathe)
        this.gBack.fillCircle(m.x, m.y, 14 + breathe * 2)
        this.gBack.fill(UI.cyanHi, 0.52); this.gBack.fillCircle(m.x, m.y, 8.5)
        this.gBack.line(UI.cyanHi, 0.24 + 0.16 * breathe, 1.5)
        this.gBack.strokeCircle(m.x, m.y, 15 + breathe * 4)
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
    // 外面罩两层氧青 + 一层骨白辉光：它是本作**唯一可拾取的东西**，
    //   "会发光 = 能捡"是玩家唯一能依赖的读法 —— 光晕不是装饰，是功能。
    for (const b of w.bones) {
      const s = b.size * 0.5
      const blinking = b.fade < 0.35 && Math.sin(b.fade * 30) > 0
      const al = blinking ? 0.35 : 1
      const ca = Math.cos(b.rot), sa = Math.sin(b.rot)
      // ① 辉光：氧青（外两层）→ 骨白（内层）
      this.gBack.fill(0x4fe8ff, 0.10 * al); this.gBack.fillCircle(b.x, b.y, s * 1.30)
      this.gBack.fill(0x4fe8ff, 0.16 * al); this.gBack.fillCircle(b.x, b.y, s * 1.02)
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
    const darkLayer = w.layer().vis < 0.5

    for (const e of w.enemies) {
      if (!e.alive) continue
      const charging = (e.kind === 'dash' && e.phase === 'charge')
        || (e.kind === 'boss' && e.phase === 'charge')
      // ⚠️ 本地变量不要叫 `col` —— 会遮蔽从 Gfx 导入的同名颜色构造函数。
      const body = charging ? UI.danger : (e.flash > 0 ? 0xffffff : e.color)
      const face = Math.atan2(w.py - e.y, w.px - e.x)
      // ⚠️ 闪白**绝不能**把贴图置空。曾经写成 `e.flash > 0 ? null : this.fishSprite(e)`，
      //    于是命中那一瞬间掉进下面的矢量兜底 → `fillTri` → 屏幕上变成一颗**白色实心三角**，
      //    既认不出是鱼、也读不出"打中了哪一条"。
      //    Cocos 的 Sprite 是乘色混合、没有 web 的 `setTintFill`（能把贴图烧成纯白剪影），
      //    但那不该以"换成三角"为代价 —— 现在与 web 的矢量路径同构：
      //    **鱼身照常留着，另外在它上面叠一层白色椭圆闪光**。
      const sp = this.fishSprite(e)

      if (sp) {
        sp.node.setPosition(e.x, this.H - e.y)
        sp.node.angle = -((face - e.texRot) * 180) / Math.PI
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
        // 矢量兜底（美术未就绪 / 太小 / 太多 / 闪白那一帧）
        this.gEnt.fill(body, 0.95)
        if (e.kind === 'boss') this.gEnt.fillCircle(e.x, e.y, e.r)
        else this.gEnt.fillTri(e.x, e.y, face, e.r * 1.25, e.r * 0.85)
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
    const R = SUB_D / 2

    // ---- 机体：矢量「球形深潜核」（方案 B · 俯角 60°）----
    // 2026-10-13：机体由 `sub_body.png` 正俯视平面贴图**改为矢量实时绘制**（用户拍板方案 A），
    // 所以这里不再依赖 `subNode`（syncSub 已把它常关）。朝向 = 移动方向 `w.aim`，
    // 机体随之转动，舷窗 / 稳定鳍 / 挂载带一起转 → "移动时能看到不同角度的装载"。
    this.drawBody(w)

    // ---- 艏部探照灯（朝向指示）----
    // 也走 3/4 投影（y 压扁），否则它会飘在机体椭圆之外、读不出"艏在哪个方向"。
    const bow = R * 1.02 + 16
    const hx = w.px + Math.cos(w.aim) * bow
    const hy = w.py + Math.sin(w.aim) * bow * SEAT_RATIO
    this.gPlayer.fill(UI.cyanHi, 0.95)
    this.gPlayer.fillCircle(hx, hy, EMITTER_SIZE * 0.3)

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
   * 机体 —— 矢量「球形深潜核」（方案 B）· 俯角 60° 的 3/4 斜视。
   *
   * -----------------------------------------------------------------------
   * 为什么改成矢量（用户 2026-10-13 拍板方案 A）
   * -----------------------------------------------------------------------
   *   `sub_body.png` 是**正俯视**平面贴图 —— 任何角度都读作"平贴的圆盘"，没有体积。
   *   要做出 3/4 斜视（俯角 60°）的体积感，就得有**受光面 + 赤道椭圆 + 破剪影的穹顶**
   *   这一整套随俯角走的结构；一张斜视贴图又没法 `setRotation` 复用（转 180° 后
   *   "厚度朝下、受光在左上"整条立体线索穿帮）。矢量绘制把"球面明暗"算成参数，
   *   与朝向彻底解耦 ⇒ 怎么摆都成立。代价只是每帧几十个图元（88px 尺寸可控）。
   *
   *   ⚠️ 注意：**机体本身不参与航向旋转**（见下面 v3 段）。
   *      "矢量"在这里买到的是"立体感可参数化"，不是"可以随便转"。
   *
   * -----------------------------------------------------------------------
   * 立体感 = 七条线索，少一条就"平"（v2 定稿 2026-10-13）
   * -----------------------------------------------------------------------
   *   ⓪ 悬浮光晕（多层同心椭圆，机体**下方**）—— 先让机体"离地"
   *   ① 底部稳定鳍 ×4 —— 打破正圆的"靶盘感"
   *   ② 球体主舱：34 层同心**正圆**逐层换色 ＋ 暗部地板抬高 ＋ 受光点左上偏
   *   ②b 水下反光弧（右下）—— 水体散射光打回球的下缘，暗部不再是死黑
   *   ③ 下腹暗带 —— 坐实"下方是船腹"
   *   ④ 赤道挂载带：**前半粗亮 / 后半细暗**（3/4 椭圆环，这条是"球面成立"的关键）
   *   ⑤ 霓虹外圈（halo + core 两层）
   *   ⑥ 顶部穹顶观察舱（**突破剪影** + 暗描边）+ 发光核心
   *   ⑦ 舷窗灯带（沿船腹一条微弯的弧，**吃 K**）
   *
   * -----------------------------------------------------------------------
   * v3 · 机体**整机不与 `aim` 挂钩**（2026-10-13 用户反馈后定稿）
   * -----------------------------------------------------------------------
   *   用户原话：「机体感觉大了一点点 移动的过程中 武器一直在换位置也不太合适」。
   *   ① 尺寸：视觉半径由 `SEAT_RING_R`(48) 收成 `SEAT_RING_R * BODY_VIS`(43.2) —— 见 BODY_VIS。
   *   ② 站位：座圈**不再随航向旋转**（改在 `world.ts seatPos()`），机体自身也一并冻结 ——
   *      鳍、舷窗、挂载带全部固定。**回转体的转动看不见**，转它只会让"炮在自己滑动"更明显。
   *      航向提示改由**艏部探照灯**（`drawPlayer`）单独承担。
   *   ⇒ 现在整个 `drawBody` **不读 `w.aim`**，只读位置与潜航器配色。
   *
   * -----------------------------------------------------------------------
   * v2 修掉的 5 个"看着不对但参数都对"的坑（2026-10-13）
   * -----------------------------------------------------------------------
   *   1. 球体最外层明度 `0.55` 太暗 → 暗部与背景暗水融成一体，**球看着只有 0.6R**；
   *      抬到 `0.68` 且衰减指数 0.85→0.72，整圆剪影才读得满。
   *   2. 球（正圆）＋霓虹圈（正圆）＋挂载带（椭圆）**三层同圆心**且带子整圈同亮 →
   *      读作"靶盘"。改**前半粗亮/后半细暗**，前后分离一出，球面立刻成立。
   *   3. **舷窗 y 半径忘了乘 K** → 6 个白点围成竖椭圆并跑出球外（真 bug）；
   *      改成船腹一排窗、`u²` 微弯、全程吃 K。
   *   4. 穹顶只比球亮一点、无描边、落在剪影内 → 只是一个浅色斑；改**抬高破剪影 + 暗描边**。
   *   5. 霓虹 `bloom` 的 `+24px` 线宽挂在 48px 半径上 ≈ 半径 +50% → 一大圈光环抢戏；
   *      **关掉 bloom**，只留 halo + core。
   *
   * ⚠️ 光源**固定在屏幕左上**：全部明暗一律用世界固定方向，**没有任何部件吃 `aim`**。
   *    与 drawTurret 的铁律同源 —— **形状的朝向不该进它自己的明暗参数**。
   *
   * 配色：机体基调用通用水青 `BODY_METAL`，**主题色只落在挂载带**（`w.sub.color`）——
   * 三台潜航器一眼可分，但机体本身不染艇种色（否则"这座台能换装"就说不通了）。
   */
  private drawBody(w: DiveWorld): void {
    const g = this.gPlayer
    const cx = w.px, cy = w.py
    const K = SEAT_RATIO                    // 3/4 俯视压扁率（只压"赤道带"，不压球）
    // 视觉半径 = 座圈半径 × BODY_VIS（见 BODY_VIS 注释：用户反馈"机体大了一点点"）。
    // ⚠️ 机体**不再读取 `w.aim`** —— 回转体的转动看不出变化，只会让"炮在自己滑动"更明显
    //    （见 world.ts seatPos 的说明）。航向提示由艏部探照灯承担。
    const rb = SEAT_RING_R * BODY_VIS
    const tint = w.sub.color                // 潜航器主题色（只用于挂载带）

    // ⓪ 悬浮光晕 —— 机体下方的一片青色光池
    for (let i = 8; i >= 1; i--) {
      const k = i / 8
      g.fill(UI.cyanHi, 0.024)
      g.ellipse(cx, cy + rb * K * 1.00, (rb * 2.35 * k) / 2, (rb * 2.35 * K * 0.55 * k) / 2)
      g.fillPath()
    }

    // ① 底部稳定鳍 ×4 —— 打破"正圆靶盘感"，给机体一个下盘。
    //    ⚠️ 与座圈同步**冻结**：机体是回转体，固定 45°/135°/225°/315° 四个方位。
    //    若鳍还跟着 `aim` 转，就会出现"炮不动、鳍在转"的自相矛盾，更怪。
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2
      const ca = Math.cos(a), sa = Math.sin(a)
      const bx = cx + ca * rb * 0.50, by = cy + sa * rb * K * 0.50
      const tx = cx + ca * rb * 1.16, ty = cy + sa * rb * K * 1.16 + rb * K * 0.40
      const wd = rb * 0.26
      g.fill(UI.abyss, 0.94)                       // 暗底（整片）
      g.moveTo(bx, by)
      g.lineTo(tx - sa * wd, ty + ca * wd * K)
      g.lineTo(tx + sa * wd, ty - ca * wd * K)
      g.close(); g.fillPath()
      g.fill(shade(BODY_METAL, 0.82), 1)           // 亮面（受光半边）
      g.moveTo(bx, by)
      g.lineTo(tx - sa * wd, ty + ca * wd * K)
      g.lineTo(tx, ty)
      g.close(); g.fillPath()
    }

    // ② 球体主舱 —— **正圆**逐层换色（球的剪影恒为圆，压扁就成"盘子"），受光点向左上偏
    //    暗部地板抬到 0.68（原 0.55 太暗，最外几层与背景暗水糊成一体 → 球看着只有 0.6R），
    //    衰减指数 0.72（原 0.85）让亮度更快爬到中调，整圆剪影读得满。
    const N = 34
    for (let i = N; i >= 1; i--) {
      const t = i / N
      const ox = cx - rb * 0.34 * (1 - t)
      const oy = cy - rb * 0.34 * (1 - t)
      const rr = rb * t
      g.fill(shade(BODY_METAL, 0.68 + 1.02 * Math.pow(1 - t, 0.72)), 1)
      g.ellipse(ox, oy, rr, rr)
      g.fillPath()
    }

    // ②b 水下反光弧（右下 1/4）—— 水体自身的散射光打回球的下缘，
    //     是"这颗球浸在发光水体里"的物理线索；缺了它，暗部只有一片死黑。
    g.line(UI.cyanHi, 0.29, rb * 0.075)
    g.arc(cx, cy, rb * 0.93, (18 * Math.PI) / 180, (96 * Math.PI) / 180)
    g.stroke()

    // ③ 下腹暗带 —— 球的下 1/3 压暗，坐实"下方是船腹"（不是一整颗漂浮的球）
    g.line(UI.abyss, 0.38, rb * 0.30)
    g.arc(cx, cy, rb * 0.97, (24 * Math.PI) / 180, (156 * Math.PI) / 180)
    g.stroke()

    // ④ 赤道挂载带 —— 6 挺机枪嵌入的环。**这里是 3/4 椭圆的唯一落点**：
    //    短轴吃 K，与 `seatPos()` 的投影同源，所以炮位天然落在带上。
    //
    //    ⚠️ 2026-10-13 v2：带子**拆成前半/后半分别描边** —— 这是整颗球"转起来"的关键。
    //    前半（下半，靠近观察者）粗而亮、后半（上半，远离观察者）细而暗；
    //    两半同圆心同半径、只有线宽与明度不同，眼睛立刻读成"一条环绕球面的带子"。
    //    旧版整圈一样粗一样亮 → 读作平面上两个同心圆（"靶盘"）。
    //    可行性已实证：引擎 `moveTo` 会推进 `pathOffset`，两次 `stroke()` 互不覆盖。
    //    后半（远）：π→2π，sin≤0 ⇒ 画在 cy 之上
    g.line(UI.abyss, 0.78, rb * 0.110)
    g.ellipseArc(cx, cy, rb, rb * K, Math.PI, Math.PI * 2); g.stroke()
    g.line(shade(tint, 0.68), 1, rb * 0.075)
    g.ellipseArc(cx, cy, rb, rb * K, Math.PI, Math.PI * 2); g.stroke()
    // 前半（近）：0→π，sin≥0 ⇒ 画在 cy 之下
    g.line(UI.abyss, 0.94, rb * 0.135)
    g.ellipseArc(cx, cy, rb, rb * K, 0, Math.PI); g.stroke()
    g.line(shade(tint, 1.18), 1, rb * 0.095)
    g.ellipseArc(cx, cy, rb, rb * K, 0, Math.PI); g.stroke()

    // ⑤ 霓虹外圈（三层公式）—— 玩家机体必须是画面里最亮的青系
    //    ⚠️ v2 关掉 bloom：`+24px` 的线宽挂在 rb=48 上等于半径的 +50%，
    //    在屏幕上是一圈比机体还大的光环，既抢戏又盖掉球体边缘的明暗过渡。
    //    只留 halo(+8px) + core(±0) —— 发光仍在，但轮廓归机体自己。
    neonCircle(g, cx, cy, rb, UI.cyan, { width: 1.4, alpha: 0.90, bloom: false })

    // ⑥ 顶部穹顶观察舱 + 发光核心
    //    v2：抬到 `cy - rb*0.86` 让穹顶**突破球体剪影**、并补一圈暗描边 ——
    //    旧版落在剪影内、只比球亮一点点，读出来只是一个浅色圆斑，不是"舱"。
    const db = cy - rb * 0.86
    const dome = (ox: number, oy: number, rx: number, ry: number, c: number, oc: number, oa: number) => {
      g.fill(c, 1)
      g.moveTo(ox - rx, oy)
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI + (Math.PI * i) / 16      // π→2π：sin≤0 ⇒ 画在 oy 之上
        g.lineTo(ox + Math.cos(a) * rx, oy + Math.sin(a) * ry)
      }
      g.close(); g.fillPath()
      g.line(oc, oa, rb * 0.026)
      g.moveTo(ox - rx, oy)
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI + (Math.PI * i) / 16
        g.lineTo(ox + Math.cos(a) * rx, oy + Math.sin(a) * ry)
      }
      g.close(); g.stroke()
    }
    dome(cx, db, rb * 0.36, rb * 0.36 * K, shade(BODY_METAL, 1.10), UI.abyss, 0.67)
    dome(cx - rb * 0.10, db - rb * 0.06 * K, rb * 0.19, rb * 0.19 * K, shade(BODY_METAL, 1.62), UI.abyss, 0.55)
    // 核心光晕**必须收进球体轮廓内**：半径堆到 0.4R 会戳出球外，
    // 在暗底上读成"机体头上顶着一块灰斑"（本项目踩过）。
    const gy = db - rb * 0.14
    for (let i = 6; i >= 1; i--) {
      g.fill(UI.cyanHi, 0.10)
      g.fillCircle(cx, gy, rb * 0.035 * i)
    }
    g.fill(0xffffff, 0.95); g.fillCircle(cx, gy, rb * 0.030)

    // ⑦ 舷窗灯带 —— **船腹一排窗**，横向排布且**吃 K**
    //    ⚠️ v2 修 bug：旧版 y 半径写死 `rb*0.78` **忘了乘 K**，脱离 3/4 投影几何 ——
    //    6 个白点围成一个竖椭圆、还跑到球体剪影之外，越看越像"漂浮的杂点"。
    //    现在沿船腹一条微微下弯的弧排开（`u²` 项），与俯角同源。
    for (let i = 0; i < 5; i++) {
      const u = (i - 2) / 2
      const px = cx + u * rb * 0.60
      const py = cy + rb * 0.34 + (u * u) * rb * 0.22 * K
      g.fill(UI.cyanHi, 0.92)
      g.fillCircle(px, py, Math.max(1, rb * 0.048))
    }

    // 受击反馈：整机泛红（机体改矢量后没有"红描边"了，改整机压色）
    if (w.hurtFlash > 0) {
      g.fill(UI.danger, 0.30 * Math.min(1, w.hurtFlash / 0.2))
      g.ellipse(cx, cy, rb, rb)
      g.fillPath()
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
    // 后坐位移（沿炮管局部 x，负 = 后退）。fireFlash 寿命 0.15~0.25s，
    // 这里按 0.15 归一化 → 开火瞬间满行程，随后线性归位。
    const kick = hot ? 3.0 * Math.min(1, wp.fireFlash / 0.15) : 0
    const bob = Math.sin(w.t * 1.6 + i * 2.3) * 0.7
    const fore = -kick - bob

    // 挂点：投影（右下偏移）→ 暗底顶面 → 左上受光弧 → 描边。
    // 顶面刻意压暗，让**本色发射器**从挂点上跳出来（"机枪清晰可见"的第一条）。
    g.fill(UI.abyss, 0.45); g.fillCircle(cx + pad * 0.16, cy + pad * 0.26, pad)
    g.fill(UI.abyss, 0.62); g.fillCircle(cx, cy, pad)
    g.line(UI.cyanHi, 0.55, Math.max(1, pad * 0.24))
    g.arc(cx, cy, pad * 0.76, Math.PI * 1.02, Math.PI * 1.48); g.stroke()
    g.line(ext ? UI.amber : UI.cyanHi, hot ? 1 : 0.8, 1.4)
    g.strokeCircle(cx, cy, pad)

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

  private drawFx(): void {
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
  }
}
