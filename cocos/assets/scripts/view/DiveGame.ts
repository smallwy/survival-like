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
 * 编辑器里怎么用
 * ---------------------------------------------------------------------------
 * 场景 `assets/scenes/Dive.scene` 已经预挂好本组件（Canvas → Game → 本组件），
 * 设计分辨率也已在 settings/ 里设为 1304 × 749 —— **打开工程点运行即可**。
 *
 * 美术**不需要导入**也能跑：本切片用 Graphics 画几何剪影；
 * 贴图层的接入见 `art.ts`（下一增量）。
 *
 * 若从零搭场景，只需两步：
 *   1. 项目设置 → 项目数据 → 设计分辨率 `1304 × 749`；
 *   2. Canvas 下建空节点挂上本组件（节点 layer 必须与 Canvas 同层 = UI_2D）。
 *
 * ---------------------------------------------------------------------------
 * 坐标系（移植时最容易错的一处）
 * ---------------------------------------------------------------------------
 * 模拟层沿用 Phaser 的「左上原点、y 向下」，Cocos 是「左下原点、y 向上」。
 * 转换只发生在两处：
 *   · 图元 —— 全走 `Gfx` 包装（内部 `y → H - y`）；
 *   · 节点定位 —— `V(x,y) = (x, H - y)`，WorldRoot 锚点 (0,0)、位置 (-W/2,-H/2)。
 * 角度取反：sim 的 `θ`（y 向下）→ node 的 `-θ`。模拟层对这些一无所知。
 */

import {
  _decorator, Component, Node, Graphics, Label, UITransform, Camera,
  input, Input, EventKeyboard, KeyCode, director,
} from 'cc'
import { Gfx, col } from './Gfx'
import { Hud } from './Hud'
import { DiveWorld } from '../shared/dive/world'
import {
  CAM_ZOOM, SEAT_RING_R, TURRET_R, EMITTER_SIZE, SUB_D, MAX_SEATS, SEAT_ANGLES_DEG,
} from '../shared/dive/tables'
import { UI } from '../shared/theme'
import { SUBS } from '../shared/subs'
import type { SimEvent, InputState } from '../shared/dive/types'

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

const SHOCK_CAP = 64
const SLASH_CAP = 48
const SPARK_CAP = 260
const FLOAT_CAP = 32
/** 单帧最大步长（与模拟层的 MAX_DT 同源，防止后台切回来时世界瞬移） */
const MAX_DT = 0.05

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
  @property({ type: Camera, tooltip: '可留空；留空则自动找场景里的相机' }) cam: Camera | null = null

  // ---- 世界 ----
  private world!: DiveWorld
  private W = 1304
  private H = 749

  // ---- 节点 ----
  private worldRoot!: Node
  private gBg!: Gfx
  private gBack!: Gfx
  private gEnt!: Gfx
  private gFront!: Gfx
  private hud!: Hud

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
  }

  onDestroy(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this)
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this)
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

  private buildNodes(): void {
    const host = this.uiHost()

    this.worldRoot = this.mkNode('WorldRoot', host)
    const utr = this.worldRoot.addComponent(UITransform)
    utr.setAnchorPoint(0, 0)
    utr.setContentSize(this.W, this.H)
    this.worldRoot.setPosition(-this.W / 2, -this.H / 2)

    const mkG = (name: string): Gfx => {
      const n = this.mkNode(name, this.worldRoot)
      return new Gfx(n.addComponent(Graphics), this.H)
    }
    this.gBg = mkG('gBg')
    this.gBack = mkG('gBack')
    this.gEnt = mkG('gEnt')
    this.gFront = mkG('gFront')

    this.hud = new Hud(host, this.W, this.H)

    if (!this.cam) {
      try {
        const c = this.node.scene ? this.node.scene.getComponentInChildren(Camera) : null
        if (c) this.cam = c
      } catch { /* 场景里没有相机就不做跟随 */ }
    }
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
    this.updateCamera()

    this.gBg.clear(); this.gBack.clear(); this.gEnt.clear(); this.gFront.clear()
    this.drawBg(w, dt)
    if (combat) this.drawWorld(w)
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

  /** 重开一局。标题场景尚未移植 —— 迁完 TitleScene 后改成 director.loadScene('title')。 */
  private restartRun(): void {
    this.world.restart()
    this.clearFx()
    void director
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

  private updateCamera(): void {
    const cam = this.cam
    if (!cam) return
    const w = this.world
    const popup = w.phase === 'shop' || w.phase === 'decide' || w.phase === 'result'
    if (popup) {
      cam.zoom = 1
      this.worldRoot.setPosition(-this.W / 2, -this.H / 2)
      return
    }
    const Z = CAM_ZOOM
    const view = this.viewWorld()
    const hw = view.w / (2 * Z)
    const hh = view.h / (2 * Z)
    // 可视区比世界还大（宽高比差异大）时直接居中：此时 W - hw < hw，
    // 下界会大于上界，普通 clamp 的结果是错的。
    const camX = this.W <= hw * 2 ? this.W / 2 : clamp1(w.px, hw, this.W - hw)
    const camY = this.H <= hh * 2 ? this.H / 2 : clamp1(w.py, hh, this.H - hh)
    cam.zoom = Z
    // 推导：要让 sim(camX,camY) 落在屏幕中心，WorldRoot 必须摆在这个位置
    this.worldRoot.setPosition(-camX, camY - this.H)
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
      // 以下事件本切片不产生额外表现（震屏/受击暗角/闪避已由世界字段驱动）：
      //   shake（Cocos 要移动相机节点，见 docs）、playerHurt、dodge、
      //   wave / waveCleared / layerCleared / runCleared / dead（相位可读）
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
  private drawBg(w: DiveWorld, dt: number): void {
    const L = w.layer()
    // 底 + 层色调要**外扩**覆盖可视区：设计分辨率宽高比与 W×H 不一致时，
    // 屏幕边缘会露出清屏色的一条细带（只在某些机型上出现，最难查的那类 bug）。
    const view = this.viewWorld()
    const pw = Math.max(0, (view.w - this.W) / 2) + 8
    const ph = Math.max(0, (view.h - this.H) / 2) + 8
    const bw = this.W + pw * 2, bh = this.H + ph * 2
    this.gBg.fill(0x04070d, 1); this.gBg.fillRect(-pw, -ph, bw, bh)
    this.gBg.fill(L.tint, 0.55); this.gBg.fillRect(-pw, -ph, bw, bh)
    // 深度暗带（越深越暗）
    const bands = 8
    for (let i = 0; i < bands; i++) {
      this.gBg.fill(0x000000, 0.05 + 0.03 * i)
      this.gBg.fillRect(0, (this.H / bands) * i, this.W, this.H / bands + 2)
    }
    // 低氧暗角
    const frac = w.o2 / Math.max(1, w.o2Max)
    if (frac < 0.35) {
      const m = 90
      this.gBg.fill(0x501313, Math.min(0.45, (0.35 - frac) * 0.9))
      this.gBg.fillRect(0, 0, this.W, m)
      this.gBg.fillRect(0, this.H - m, this.W, m)
    }
    // 方向性受击暗角：受击来向那一侧先红
    if (w.hurtDirT > 0) {
      const k = Math.min(1, w.hurtDirT / 0.6)
      const side = w.hurtDirX > 0 ? 1 : -1
      for (let i = 0; i < 6; i++) {
        const bwid = this.W * 0.08 * (1 - (i / 7) * 0.3)
        const x = side > 0 ? this.W - bwid * (i + 1) : bwid * i
        this.gBg.fill(UI.danger, 0.12 * k)
        this.gBg.fillRect(x, 0, bwid, this.H)
      }
    }
    // 海雪（纯表现）
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

    // ---- 敌人 ----
    for (const e of w.enemies) {
      if (!e.alive) continue
      const ang = Math.atan2(w.py - e.y, w.px - e.x)
      const body = e.flash > 0 ? 0xffffff : e.color
      this.gEnt.fill(body, 0.95)
      if (e.kind === 'boss') this.gEnt.fillCircle(e.x, e.y, e.r)
      else this.gEnt.fillTri(e.x, e.y, ang, e.r * 1.25, e.r * 0.85)
      // 冲刺型预警（charge 相位挂红环，对应"红色预警"）
      if (e.kind === 'dash' && e.phase === 'charge') {
        this.gEnt.line(UI.danger, 0.9, 2)
        this.gEnt.strokeCircle(e.x, e.y, e.r + 8)
      }
    }

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

  private drawPlayer(w: DiveWorld): void {
    const R = SUB_D / 2
    // 机体（圆盘）
    this.gEnt.fill(UI.panelHi, 0.95); this.gEnt.fillCircle(w.px, w.py, R * 0.62)
    this.gEnt.line(w.hurtFlash > 0 ? UI.danger : UI.cyan, 0.9, 2)
    this.gEnt.strokeCircle(w.px, w.py, R * 0.62)
    this.gEnt.line(UI.cyanHi, 0.45, 1)
    this.gEnt.strokeCircle(w.px, w.py, R * 0.62 + 5)

    // 座圈（装载器）：随艇身朝向一起转
    this.gEnt.line(UI.cyanDim, 0.35, 1)
    this.gEnt.strokeCircle(w.px, w.py, SEAT_RING_R)
    const plan = w.mountPlan()
    for (let i = 0; i < MAX_SEATS; i++) {
      const a = (SEAT_ANGLES_DEG[i] * Math.PI) / 180
      const ca = Math.cos(w.aim), sa = Math.sin(w.aim)
      const sx = SEAT_RING_R * Math.cos(a), sy = SEAT_RING_R * Math.sin(a)
      const x = w.px + sx * ca - sy * sa
      const y = w.py + sx * sa + sy * ca
      const has = i < plan.length
      this.gEnt.fill(has ? (plan[i].ext ? UI.amber : UI.panelHi) : UI.panel, has ? 0.95 : 0.35)
      this.gEnt.fillCircle(x, y, TURRET_R * 0.8)
    }

    // 艏部探照灯（朝向指示）
    const hx = w.px + Math.cos(w.aim) * (R * 0.62 + 16)
    const hy = w.py + Math.sin(w.aim) * (R * 0.62 + 16)
    this.gEnt.fill(UI.cyanHi, 0.95)
    this.gEnt.fillCircle(hx, hy, EMITTER_SIZE * 0.3)

    // 发射器：每台武器一座，朝向取 sim 的 aimAng（与出弹点同源）
    for (let i = 0; i < w.weapons.length; i++) {
      const pose = w.turretPose(i)
      if (!pose) continue
      const fire = w.weapons[i].fireFlash > 0
      const ang = pose.ang
      this.gEnt.line(fire ? 0xffffff : UI.cyanHi, fire ? 1 : 0.85, 3)
      this.gEnt.strokeSeg(
        pose.x, pose.y,
        pose.x + Math.cos(ang) * EMITTER_SIZE * 1.5,
        pose.y + Math.sin(ang) * EMITTER_SIZE * 1.5,
      )
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
