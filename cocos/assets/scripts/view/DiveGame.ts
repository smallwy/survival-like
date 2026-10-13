/**
 * 最小潜水循环 · Cocos Creator 主组件
 *
 * ---------------------------------------------------------------------------
 * 它做什么
 * ---------------------------------------------------------------------------
 * 把 `shared/dive` 的模拟世界接到 Cocos 的渲染/输入上：
 *
 *   update(dt) →
 *     ① 采样输入（WASD / 方向键 + 空格排气，空格是**边沿**）
 *     ② world.update(dt, input)            ← 模拟，引擎无关
 *     ③ world.drainEvents() → 生成表现（冲击波/击打痕/火花/飘字/电弧/爆炸环）
 *     ④ 把 world 的字段画出来（背景/敌人/玩家/炮塔/弹/鱼骨/波前/酸液）
 *     ⑤ 镜头跟随（zoom 1.25 + 边界钳位；弹窗相位归位 1×）
 *     ⑥ 按 world.phase 分派 HUD 与弹窗
 *
 * ---------------------------------------------------------------------------
 * 节点树与绘制顺序（顺序本身就是设计，别随手调）
 * ---------------------------------------------------------------------------
 *   WorldRoot                       ← 锚点(0,0)、尺寸 W×H、位置 (-W/2,-H/2)
 *     ├ bg        Sprite   环境背景图（cover 铺满世界，按层换图）
 *     ├ gBg       Graphics 底色 + 海雪
 *     ├ gVeil     Graphics 环境色调 + 压暗 + 暗角 + 屏幕边框（**必须低于实体**）
 *     ├ gBack     Graphics 酸液 / 鱼骨 / 声呐波前 / 回声标记 / 爆炸环
 *     ├ gEnt      Graphics 敌人矢量 + 子弹
 *     ├ fishLayer Node     敌人贴图池
 *     ├ subNode   Sprite   潜航器机体
 *     ├ gPlayer   Graphics 玩家矢量件（座圈/炮塔/探照灯）+ Boss 血条
 *     └ gFront    Graphics 打击特效 / 火花 / 电弧
 *   Canvas
 *     └ Hud                   战斗 HUD 与三个弹窗（见 Hud.ts）
 *
 * 为什么压暗层（gVeil）在**世界坐标**里而不是做成全屏节点 —— 因为 web 侧有一条
 * 铁律："暗幕只能压暗地形，敌人/气泡/玩家必须画在它之上，否则深渊层（可见度
 * 10%）会把 gameplay 信息一起吃掉"。要做成画在实体之上的全屏节点就必然违反它。
 * 于是这里换成"按当前可视矩形在世界坐标里画暗角"，效果等价且不破坏该规则：
 *   · 可视矩形 = 相机中心 ± (画布尺寸 / zoom / 2)
 *   · 带宽用 `屏幕带宽 / zoom`，所以放大后屏幕上的视觉宽度不变
 *
 * ---------------------------------------------------------------------------
 * 编辑器里怎么用
 * ---------------------------------------------------------------------------
 * 场景 `assets/scenes/Dive.scene` 已经预挂好本组件（Canvas → Game → 本组件），
 * 设计分辨率也已在 settings/ 里设为 1304 × 749 —— **打开工程点运行即可**。
 *
 * 美术**不需要导入**也能跑：`resources` 下没有图就退回 Graphics 画几何剪影。
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
import { SpriteBank, frameAspect } from './art'
import { DiveWorld } from '../shared/dive/world'
import {
  CAM_ZOOM, SEAT_RING_R, TURRET_R, EMITTER_SIZE, SUB_D, MAX_SEATS, SEAT_ANGLES_DEG,
} from '../shared/dive/tables'
import { UI } from '../shared/theme'
import { SUBS, SUB_ART_R } from '../shared/subs'
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
  @property({ tooltip: '随机种子（同 seed ⇒ 同世界线）' }) seed = 20261013
  @property({ tooltip: '潜航器：0 灯艇 / 1 刺鳐 / 2 深潜者' }) subIndex = 0

  // ---- 世界 ----
  private world!: DiveWorld
  private W = 1304
  private H = 749

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

  // ---- 敌人贴图池 ----
  private readonly fishPool: Fish[] = []

  // ---- 相机状态（每帧由 updateCamera 写入，drawVeil 要读）----
  private camX = 0
  private camY = 0
  private zoom = 1

  // ---- 表现池 ----
  private shocks: Shock[] = []
  private slashes: Slash[] = []
  private sparks: Spark[] = []
  private arcs: ArcFx[] = []
  private blasts: BlastFx[] = []
  private floatSlots: Array<FloatFx | null> = new Array(FLOAT_CAP).fill(null)
  private motes: Mote[] = []

  // ---- 输入 ----
  private keys: Record<string, boolean> = {}
  private burstEdge = false

  // =========================================================================
  // 生命周期
  // =========================================================================
  onLoad(): void {
    this.W = this.designW
    this.H = this.designH
    this.buildNodes()

    this.world = new DiveWorld({
      w: this.W,
      h: this.H,
      seed: this.seed,
      sub: SUBS[Math.max(0, Math.min(SUBS.length - 1, this.subIndex))],
    })
    this.world.drainEvents()      // 丢掉开局那批事件（没有表现需要补播）

    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this)
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this)

    // 美术异步加载：**不阻塞开局**。加载完成前先跑几何剪影，
    // 拿到图之后下一帧自动换成贴图（不需要重建世界）。
    void this.loadArt()
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
    this.gBack = this.mkWrapped('gBack', this.worldRoot)
    this.gEnt = this.mkWrapped('gEnt', this.worldRoot)

    this.fishLayer = this.mkNode('fishLayer', this.worldRoot)

    this.subNode = this.mkNode('sub', this.worldRoot).addComponent(Sprite)
    this.subNode.trim = false
    this.subNode.sizeMode = Sprite.SizeMode.CUSTOM
    this.subNode.node.active = false

    this.gPlayer = this.mkWrapped('gPlayer', this.worldRoot)
    this.gFront = this.mkWrapped('gFront', this.worldRoot)

    this.hud = new Hud(host, this.W, this.H, this.art)
  }

  // =========================================================================
  // 输入
  // =========================================================================
  private onKeyDown(e: EventKeyboard): void {
    const k = e.keyCode
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
    const w = this.world
    const combat = w.phase === 'wave' || w.phase === 'descending'

    w.update(dt, combat ? this.sampleInput() : { dx: 0, dy: 0, burst: false })
    for (const ev of w.drainEvents()) this.handleEvent(ev)

    this.stepFx(dt)
    this.syncBg(w)               // 换层换背景（只在 layerIdx 变化时真正干活）
    this.updateCamera()

    this.gBg.clear(); this.gVeil.clear(); this.gBack.clear()
    this.gEnt.clear(); this.gPlayer.clear(); this.gFront.clear()

    this.drawBg(w, dt)
    if (combat) {
      this.syncSub(w)
      this.drawWorld(w)
    } else {
      this.hideFish()
      this.subNode.node.active = false
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
      this.hud.drawResult(w, { onRestart: () => this.restartRun(), onTitle: () => this.restartRun() })
    }
  }

  /** 重开一局。标题场景尚未移植 —— 迁完 TitleScene 后这里改成 `director.loadScene('title')`。 */
  private restartRun(): void {
    this.world.restart()
    this.clearFx()
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
  private updateCamera(): void {
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

    this.worldRoot.setScale(this.zoom, this.zoom, 1)
    this.worldRoot.setPosition(-this.zoom * this.camX, this.zoom * (this.camY - this.H))
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
   *   ③ 命中闪白：贴图是乘色混合，白不了。web 用 `setTintFill` 烧成纯白剪影，
   *      Cocos 的 Sprite 没有等价的 tintFill，所以闪白这一帧退回矢量白色剪影。
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
      // 以下事件本切片不产生额外表现（相位可直接读 world 字段）：
      //   shake（Cocos 要移动相机节点，见 docs）、playerHurt、dodge、
      //   wave / waveCleared / layerCleared / runCleared / dead
      default:
        break
    }
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
      const sp = e.flash > 0 ? null : this.fishSprite(e)

      if (sp) {
        sp.node.setPosition(e.x, this.H - e.y)
        sp.node.angle = -((face - e.texRot) * 180) / Math.PI
        sp.color = col(0xffffff, charging ? 0.92 : 0.88)
        // 深层的可读性兜底：只留**描边环**（不填充）。
        // web 明确否掉了"暗色实心椭圆衬底"那版 —— 衬底比小鱼还大，把鱼盖成亮斑。
        if (darkLayer && lod < 2) {
          this.gEnt.line(charging ? UI.danger : e.color, 0.62, 1.4)
          this.gEnt.strokeEllipse(e.x, e.y, e.r * 2.05, e.r * 1.5)
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
