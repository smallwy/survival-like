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
 *     ├ bg        Sprite   环境背景图（cover 铺满世界，按层换图）
 *     ├ gBg       Graphics 底色 + 海雪
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
 * 先进主界面，选潜航器（1/2/3 或 ←→ 或鼠标点），Enter 或点「开始下潜」下潜。
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
  _decorator, Component, Node, Graphics, Label, Sprite, SpriteFrame, UITransform,
  input, Input, EventKeyboard, KeyCode,
} from 'cc'
import { Gfx, col } from './Gfx'
import { Hud } from './Hud'
import { Title } from './Title'
import { SpriteBank, frameAspect } from './art'
import { loadProfile, saveProfile } from './save'
import { DiveWorld } from '../shared/dive/world'
import { applyRun, defaultProfile, depthLabel, recordLabel } from '../shared/dive/profile'
import type { Profile } from '../shared/dive/profile'
import {
  CAM_ZOOM, SEAT_RING_R, TURRET_R, EMITTER_SIZE, SUB_D, MAX_SEATS, SEAT_ANGLES_DEG,
} from '../shared/dive/tables'
import { UI } from '../shared/theme'
import { SUBS, SUB_ART_R, getSub } from '../shared/subs'
import type { SubId } from '../shared/subs'
import type { SimEvent, InputState, Enemy } from '../shared/dive/types'

const { ccclass, property } = _decorator

// ---------------------------------------------------------------------------
// 表现层粒子（模拟层不持有这些 —— 全部由 SimEvent 触发生成）
// ---------------------------------------------------------------------------
interface Shock { x: number; y: number; r: number; rMax: number; life: number; maxLife: number; color: number; width: number; core: number; rings: number; ringDelay: number }
interface Slash { x: number; y: number; ang: number; len: number; life: number; maxLife: number; color: number; width: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: number; size: number; kind: 'hit' | 'flash' }
interface ArcFx { pts: Array<{ x: number; y: number }>; life: number }
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

const SHOCK_CAP = 64
const SLASH_CAP = 48
const SPARK_CAP = 260
const FLOAT_CAP = 32
/** 敌人贴图池上限。web 侧的阈值是"同屏 >120 条就整体退回矢量" */
const FISH_CAP = 140
/** 单帧最大步长（与模拟层的 MAX_DT 同源，防止后台切回来时世界瞬移） */
const MAX_DT = 0.05
/** 机体贴图缩放：贴图里圆盘半径是 SUB_ART_R，要它渲染成 SUB_D/2 */
const SUB_SCALE = SUB_D / (2 * SUB_ART_R)

/** 局部 clamp（此处只有相机用，且要传 lo>hi 也不会炸的语义，所以不引 shared 的 clamp） */
function clamp1(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v)
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

  // ---- 跨局档案（见 shared/dive/profile.ts）----
  private profile: Profile = defaultProfile()
  /** 本次结算是否刷新了纪录（结算屏用来画"新纪录"那一行） */
  private runRecord: string | null = null
  /** 本局是否已经记过档（防"多记一局"，见 finishRun） */
  private runSaved = false

  // ---- 美术 ----
  private readonly art = new SpriteBank()
  private artLoaded = false
  private bgLayer = -1

  // ---- 节点 ----
  private worldRoot!: Node
  private bgNode!: Sprite
  private gBg!: Gfx
  private gVeil!: Gfx
  private gBack!: Gfx
  private gEnt!: Gfx
  private gPlayer!: Gfx
  private gFront!: Gfx
  private fishLayer!: Node
  private subNode!: Sprite
  private hud!: Hud
  private title!: Title

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
  private floatSlots: Array<FloatFx | null> = new Array(FLOAT_CAP).fill(null)
  private motes: Mote[] = []
  /** 本帧的受击白闪（drawEnemies 登记 → drawFx 消费，见 FlashMark 的注释） */
  private flashMarks: FlashMark[] = []

  // ---- 输入 ----
  private keys: Record<string, boolean> = {}
  private burstEdge = false

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
  private mkWorld(): DiveWorld {
    return new DiveWorld({
      w: this.W,
      h: this.H,
      seed: this.runSeed,
      sub: SUBS[Math.max(0, Math.min(SUBS.length - 1, this.subIndex))],
    })
  }

  /**
   * 开一局新的。
   *
   * 为什么是**重建世界**而不是 `world.restart()`：潜航器是在构造时注入的
   * （`opts.sub`），换艇只能重建 —— 而"标题界面能换艇"正是这轮加的东西。
   * seed 每局 +1：世界线仍然完全可复现（`seed`、`seed+1`、`seed+2`…），
   * 但不会每局都是同一张图；出问题时按 `数字 = seed + 局数` 就能复现那一局。
   */
  private startRun(sub: SubId): void {
    const idx = SUBS.findIndex(s => s.id === sub)
    this.subIndex = idx >= 0 ? idx : 0
    this.runSeed = this.seed + this.profile.runs

    this.world = this.mkWorld()
    this.world.drainEvents()

    this.started = true
    this.runRecord = null
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

  /** 回标题界面（结算屏的「返回主界面」，以及开局前的初始状态） */
  private toTitle(): void {
    this.started = false
    this.clearFx()
    this.hideWorld()
    this.title.setRecords(depthLabel(this.profile), this.profile.runs > 0)
    this.title.pick(this.subIndex)
    this.title.setVisible(true)
  }

  /** 开一局新的（同一个潜航器）。ESC 与结算屏的「再来一次」都走它。 */
  private restartRun(): void {
    this.startRun(getSub(this.world.sub.id).id)
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
    this.bgNode = this.mkNode('bg', this.worldRoot).addComponent(Sprite)
    this.bgNode.trim = false                         // 保留透明边，cover 计算才准
    this.bgNode.sizeMode = Sprite.SizeMode.CUSTOM    // 尺寸由 cover 计算显式给
    this.bgNode.node.active = false                  // 没图就不参与渲染

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

    this.gPlayer = this.mkWrapped('gPlayer', this.worldRoot)
    this.gFront = this.mkWrapped('gFront', this.worldRoot)

    this.hud = new Hud(host, this.W, this.H, this.art)
    // Title 建在 Hud 之后 = 在它之上。两者不会同时有内容：
    // 标题期间 HUD 每个 label/button 都被 begin() 关掉，战斗期间 Title 整根隐藏。
    this.title = new Title(host, this.W, this.H, this.art, {
      onStart: (sub) => this.startRun(sub),
    })
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
      if (k >= KeyCode.DIGIT_1 && k <= KeyCode.DIGIT_3) this.title.pick(k - KeyCode.DIGIT_1)
      else if (k >= KeyCode.NUM_1 && k <= KeyCode.NUM_3) this.title.pick(k - KeyCode.NUM_1)
      else if (k === KeyCode.ARROW_LEFT) this.title.move(-1)
      else if (k === KeyCode.ARROW_RIGHT) this.title.move(1)
      else if (k === KeyCode.ENTER || k === KeyCode.SPACE) this.title.confirm()
      return
    }

    if (this.isBurstKey(k) && !this.keys['burst']) this.burstEdge = true
    this.keys[this.keyName(k)] = true
    if (k === KeyCode.ESCAPE) this.restartRun()
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

    // ---- 标题界面：世界不跑、HUD 不画，只更新主界面自己 ----
    // 注意**照样要清 Graphics**：不清的话上一局最后一帧的图形会原地留在屏幕上
    // （Graphics 是累积顶点，不 clear 就一直画）。
    if (!this.started) {
      this.title.update(dt)
      this.gBg.clear(); this.gVeil.clear(); this.gBack.clear()
      this.gEnt.clear(); this.gPlayer.clear(); this.gFront.clear()
      this.hud.begin()
      return
    }

    const w = this.world
    const combat = w.phase === 'wave' || w.phase === 'descending'

    w.update(dt, combat ? this.sampleInput() : { dx: 0, dy: 0, burst: false })
    for (const ev of w.drainEvents()) this.handleEvent(ev)

    this.stepFx(dt)
    this.syncBg(w)               // 换层换背景（只在 layerIdx 变化时真正干活）
    this.updateCamera(dt)

    this.gBg.clear(); this.gVeil.clear(); this.gBack.clear()
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

    this.hud.begin()
    if (combat) {
      this.hud.drawCombat(w)
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
      this.hud.drawResult(w, { onRestart: () => this.restartRun(), onTitle: () => this.toTitle() },
        this.runRecord)
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
  /** 背景：按层换图。cover 铺满世界（等比放大到盖住，多出来的居中裁掉） */
  private syncBg(w: DiveWorld): void {
    if (!this.artLoaded || this.bgLayer === w.layerIdx) return
    const sf = this.art.get('env' + w.layerIdx)
    if (!sf) return
    this.bgLayer = w.layerIdx
    this.bgNode.spriteFrame = sf
    this.bgNode.node.active = true
    const iw = sf.rect.width
    const ih = sf.rect.height
    const s = Math.max(this.W / iw, this.H / ih)
    const ut = this.bgNode.node.getComponent(UITransform)!
    ut.setContentSize(iw * s, ih * s)
    this.bgNode.node.setPosition(this.W / 2, this.H / 2)
  }

  /** 潜航器机体：位置 / 朝向每帧更新；贴图只在换艇时换 */
  private syncSub(w: DiveWorld): void {
    const sf = this.art.get('sub_' + w.sub.id) ?? this.art.get('sub_body')
    if (!sf) {
      this.subNode.node.active = false
      return
    }
    if (this.subNode.spriteFrame !== sf) {
      this.subNode.spriteFrame = sf
      const ut = this.subNode.node.getComponent(UITransform)!
      ut.setContentSize(sf.rect.width, sf.rect.height)
      // 三张变体的"圆盘半径"已由素材处理脚本统一成 SUB_ART_R，
      // 所以这一个缩放比能让三台机体的圆盘在屏幕上一样大（含突出件也不变）。
      this.subNode.node.setScale(SUB_SCALE, SUB_SCALE, 1)
    }
    this.subNode.node.active = true
    this.subNode.node.setPosition(w.px, this.H - w.py)
    this.subNode.node.angle = -(w.aim * 180) / Math.PI
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
  // 事件 → 表现
  // =========================================================================
  private handleEvent(ev: SimEvent): void {
    switch (ev.t) {
      case 'hit':
        this.pushShock(ev.x, ev.y, ev.r * 1.35, 0.17, ev.crit ? UI.violet : 0xdff4ff,
          ev.crit ? 2.6 : 1.8, ev.crit ? ev.r * 0.9 : ev.r * 0.62, 1)
        this.pushSlash(ev.x, ev.y, Math.atan2(-ev.ny, -ev.nx), ev.crit ? 1.35 : 1, ev.crit ? UI.violet : ev.color)
        this.pushSparks(ev.x, ev.y, Math.atan2(-ev.ny, -ev.nx), ev.color, ev.crit ? 6 : 4)
        break
      case 'kill':
        this.pushShock(ev.x, ev.y, ev.r * (ev.kind === 'boss' ? 4.2 : 2.6), ev.kind === 'boss' ? 0.5 : 0.32,
          ev.color, ev.kind === 'boss' ? 4 : 2.6, ev.r * (ev.kind === 'boss' ? 1.5 : 1), 2)
        this.pushShock(ev.x, ev.y, ev.r * (ev.kind === 'boss' ? 2.6 : 1.7), ev.kind === 'boss' ? 0.32 : 0.2,
          0xffffff, ev.kind === 'boss' ? 3 : 2, ev.r * (ev.kind === 'boss' ? 0.9 : 0.62), 1)
        this.pushRadialSparks(ev.x, ev.y, ev.kind === 'boss' ? 26 : 8 + Math.round(ev.r * 0.25),
          ev.kind === 'boss' ? 200 : 120, ev.kind === 'boss' ? 280 : 160, ev.kind === 'boss' ? 2.4 : 1.6, ev.color)
        break
      case 'pickup':
        this.pushRadialSparks(ev.x, ev.y, 3, 60, 0, 1.5, UI.cyan)
        break
      case 'float':
        this.pushFloat(ev.x, ev.y, ev.text, ev.color, ev.size)
        break
      case 'muzzle':
        this.pushMuzzle(ev.x, ev.y, ev.ang, ev.color)
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
    const out = applyRun(this.profile, {
      biomass: w.win ? Math.floor(w.biomass * w.mult) : 0,
      layer: w.layerIdx,
      wave: w.waveInLayer,
      bossDown: w.bossDown,
      sub: w.sub.id,
    })
    this.profile = out.profile
    this.runRecord = recordLabel(out)
    saveProfile(this.profile)
  }

  private pushShock(x: number, y: number, rMax: number, dur: number, color: number, width: number, core: number, rings: number): void {
    this.shocks.push({ x, y, r: 0, rMax, life: dur, maxLife: dur, color, width, core, rings, ringDelay: rings > 1 ? 0.3 : 0 })
    if (this.shocks.length > SHOCK_CAP) this.shocks.splice(0, this.shocks.length - SHOCK_CAP)
  }

  private pushSlash(x: number, y: number, ang: number, scale: number, color: number): void {
    this.slashes.push({ x, y, ang, len: 26 * scale, life: 0.1, maxLife: 0.1, color, width: 2.2 * scale })
    if (this.slashes.length > SLASH_CAP) this.slashes.splice(0, this.slashes.length - SLASH_CAP)
  }

  private pushSparks(x: number, y: number, baseAng: number, color: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = baseAng + (Math.random() - 0.5) * 1.5
      const sp = 110 + Math.random() * 190
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.14 + Math.random() * 0.1, maxLife: 0.24,
        color, size: 1.3 + Math.random() * 1.5, kind: 'hit',
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
        color: i % 3 === 0 ? 0xffffff : color, size: size + Math.random() * 1.6, kind: 'hit',
      })
    }
    this.trimSparks()
  }

  private pushMuzzle(x: number, y: number, ang: number, color: number): void {
    for (let i = 0; i < 3; i++) {
      const a = ang + (Math.random() - 0.5) * 0.5
      const sp = 120 + Math.random() * 120
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.08, maxLife: 0.08, color, size: 1.6 + Math.random(), kind: 'flash',
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
      f = { x, y, vy: -34, life: 0.9, text, color, size, delay: 0, label: l }
      this.floatSlots[idx] = f
    }
    f.x = x; f.y = y; f.life = 0.9; f.text = text; f.color = color; f.size = size
    f.delay = 0.05 * idx        // 同帧多个飘字错开，避免叠成一团读不出数字
    f.label.string = text
    f.label.fontSize = size
    f.label.lineHeight = size + 2
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
    for (const f of this.floatSlots) {
      if (!f) continue
      f.life = 0
      f.label.node.active = false
    }
  }

  private stepFx(dt: number): void {
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
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vx *= 0.90
      s.vy *= 0.90
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
  /** 底色 + 海雪。（背景图与压暗各由一个节点负责，见节点树） */
  private drawBg(w: DiveWorld, dt: number): void {
    // 底 + 外扩：设计分辨率宽高比与 W×H 不一致时，屏幕边缘会露出清屏色的一条
    // 细带（只在某些机型上出现，最难查的那类 bug）。所以按可视区外扩。
    const view = this.viewWorld()
    const pw = Math.max(0, (view.w - this.W) / 2) + 8
    const ph = Math.max(0, (view.h - this.H) / 2) + 8
    this.gBg.fill(UI.abyss, 1)
    this.gBg.fillRect(-pw, -ph, this.W + pw * 2, this.H + ph * 2)

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

    // ---- 鱼骨 ----
    for (const b of w.bones) {
      const s = b.size * 0.5
      const blinking = b.fade < 0.35 && Math.sin(b.fade * 30) > 0
      this.gBack.fill(0xdcfffb, blinking ? 0.3 : 0.95)
      this.gBack.fillCircle(b.x, b.y, Math.max(2, s * 0.26))
      this.gBack.line(0xdcfffb, 0.85, 1.4)
      this.gBack.strokeSeg(b.x - s * 0.7, b.y - s * 0.2, b.x + s * 0.7, b.y + s * 0.2)
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

    // ---- 子弹 ----
    for (const b of w.bullets) {
      if (!b.alive) continue
      const a = Math.atan2(b.vy, b.vx)
      const len = b.kind === 'torpedo' ? 14 : b.kind === 'harpoon' ? 18 : 9
      const c = b.kind === 'torpedo' ? UI.danger : b.kind === 'harpoon' ? UI.jade : UI.amber
      this.gEnt.line(c, 1, b.kind === 'gun' ? 2 : 3)
      this.gEnt.strokeSeg(b.x - Math.cos(a) * len, b.y - Math.sin(a) * len, b.x, b.y)
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

      // 受击白闪：只登记，绘制在 drawFx 开头（那才在鱼身之上）。
      // 透明度公式与 web 逐字一致：Clamp(flash / 0.09, 0, 1) * 0.62
      if (e.flash > 0) {
        this.flashMarks.push({ x: e.x, y: e.y, r: e.r, alpha: Math.min(1, e.flash / 0.09) * 0.62 })
      }
    }
  }

  private drawPlayer(w: DiveWorld): void {
    const R = SUB_D / 2

    // ---- 机体 ----
    // 有贴图时由 subNode 画；没有才用矢量兜底。半径取 R×0.85 而不是更小，
    // 是为了和贴图版的机体外径（= R）大致对齐，切换时不会"忽然胖一圈"。
    if (!this.subNode.node.active) {
      this.gPlayer.fill(UI.panelHi, 0.95); this.gPlayer.fillCircle(w.px, w.py, R * 0.85)
      this.gPlayer.line(w.hurtFlash > 0 ? UI.danger : UI.cyan, 0.9, 2)
      this.gPlayer.strokeCircle(w.px, w.py, R * 0.85)
    }
    this.gPlayer.line(UI.cyanHi, 0.45, 1)
    this.gPlayer.strokeCircle(w.px, w.py, R * 0.95)

    // ---- 座圈（装载器）：随艇身朝向一起转 ----
    this.gPlayer.line(UI.cyanDim, 0.35, 1)
    this.gPlayer.strokeCircle(w.px, w.py, SEAT_RING_R)
    const plan = w.mountPlan()
    const ca = Math.cos(w.aim), sa = Math.sin(w.aim)
    for (let i = 0; i < MAX_SEATS; i++) {
      const a = (SEAT_ANGLES_DEG[i] * Math.PI) / 180
      const sx = SEAT_RING_R * Math.cos(a), sy = SEAT_RING_R * Math.sin(a)
      const x = w.px + sx * ca - sy * sa
      const y = w.py + sx * sa + sy * ca
      const has = i < plan.length
      this.gPlayer.fill(has ? (plan[i].ext ? UI.amber : UI.panelHi) : UI.panel, has ? 0.95 : 0.35)
      this.gPlayer.fillCircle(x, y, TURRET_R * 0.8)
    }

    // ---- 艏部探照灯（朝向指示）----
    const hx = w.px + Math.cos(w.aim) * (R * 0.95 + 16)
    const hy = w.py + Math.sin(w.aim) * (R * 0.95 + 16)
    this.gPlayer.fill(UI.cyanHi, 0.95)
    this.gPlayer.fillCircle(hx, hy, EMITTER_SIZE * 0.3)

    // ---- 发射器：每台武器一座，朝向取 sim 的 aimAng（与出弹点同源）----
    for (let i = 0; i < w.weapons.length; i++) {
      const pose = w.turretPose(i)
      if (!pose) continue
      const fire = w.weapons[i].fireFlash > 0
      const ang = pose.ang
      this.gPlayer.line(fire ? 0xffffff : UI.cyanHi, fire ? 1 : 0.85, 3)
      this.gPlayer.strokeSeg(
        pose.x, pose.y,
        pose.x + Math.cos(ang) * EMITTER_SIZE * 1.5,
        pose.y + Math.sin(ang) * EMITTER_SIZE * 1.5,
      )
    }

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
      const k = Math.max(0, a.life / 0.18)
      this.gFront.line(0xa06bff, 0.9 * k, 3); this.gFront.strokePolyline(a.pts)
      this.gFront.line(0xffffff, 0.7 * k, 1.2); this.gFront.strokePolyline(a.pts)
    }

    for (const s of this.sparks) {
      const k = Math.max(0, s.life / s.maxLife)
      if (s.kind === 'flash') {
        this.gFront.fill(s.color, Math.min(1, k))
        this.gFront.fillCircle(s.x, s.y, s.size * 1.6)
      } else {
        const a = Math.atan2(s.vy, s.vx)
        const L = 6 * k + 2
        this.gFront.line(s.color, Math.min(1, k), s.size * 0.7)
        this.gFront.strokeSeg(s.x, s.y, s.x - Math.cos(a) * L, s.y - Math.sin(a) * L)
      }
    }
  }
}
