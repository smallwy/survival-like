/**
 * 探索器 · 下潜（V4 主线玩法）
 *
 * ---------------------------------------------------------------------------
 * 这一幕替代了 V3 的割草 GameScene。核心差异（见《项目计划书》V4 §2）：
 *
 *   - 同屏单位从 300+ 降到 ~35，所以每个都能画精致（糊的问题自动消失）；
 *   - **电量 = 视野 = 生命 = 货币**：同一个数字决定你能看多远、还能活多久、
 *     以及这一趟能带走多少。画面亮度直接映射剩余电量，免教程。
 *   - 单向下潜：越深越值钱，但电量只减不增（热泉是唯一补给），
 *     所以「再往下一点」和「现在上浮」之间的取舍就是全部玩法。
 *
 * 已踩过的坑（改这里之前先读）：
 *   - 按钮热区必须走 ui/hitRouter，且**本幕要自己把 pointer 事件喂进去**。
 *     TitleScene 曾漏了 routeDown 接线，导致所有按钮点了没反应。
 *   - 黑暗遮罩用**同心圆环叠加**实现，不用 RenderTexture.erase / BlendModes.ADD /
 *     fillGradientStyle —— 后三者在 Canvas 渲染器下会退化成实心块或整片白。
 * ---------------------------------------------------------------------------
 */
import Phaser from 'phaser'
import { UI, TXT, FONT, MONO } from '../config/theme'
import {
  neonLine, neonCircle, neonPoly, verticalBands, glowPool, lerpColor,
} from '../render/neon'
import { registerUiHit, routeDown, routeMove } from '../ui/hitRouter'

// ---------------------------------------------------------------- 世界常量
const WORLD_W = 1800
const BAND_H = 1200
const WORLD_H = BAND_H * 5
/** 玩家出生点（世界坐标） */
const SPAWN = { x: WORLD_W / 2, y: 260 }

interface Band {
  id: string
  name: string
  /** 该带顶部深度（米） */
  from: number
  /** 该带底部深度（米） */
  to: number
  /** 电量衰减倍率 */
  mul: number
  /** 背景色（该带中部） */
  tint: number
}

/** 5 层深度带（V4 §6）。深度米数与世界 y 非线性对应，越深每米越"重"。 */
const BANDS: Band[] = [
  { id: 'L1', name: '阳光带', from: 0,    to: 200,  mul: 1.00, tint: 0x113c50 },
  { id: 'L2', name: '暮光带', from: 200,  to: 1000, mul: 1.15, tint: 0x0a2a3d },
  { id: 'L3', name: '无光带', from: 1000, to: 4000, mul: 1.35, tint: 0x061521 },
  { id: 'L4', name: '热泉带', from: 4000, to: 6000, mul: 1.60, tint: 0x0d201c },
  { id: 'L5', name: '深渊带', from: 6000, to: 8200, mul: 2.00, tint: 0x070713 },
]

interface CreatureDef {
  id: string
  name: string
  color: number
  r: number
  value: number
  predator: boolean
  speed: number
  /** 可以出现在哪几层（0-based 索引） */
  bands: number[]
}

/** 生物表。色相遵守 theme 的隔离规则：UI 青蓝绝不出现在这里。 */
const CREATURES: CreatureDef[] = [
  { id: 'shrimp',   name: '磷虾群',     color: UI.jade,    r: 6,  value: 4,  predator: false, speed: 30, bands: [0, 1, 2] },
  { id: 'coral',    name: '珊瑚虫',     color: UI.amber,   r: 7,  value: 9,  predator: false, speed: 10, bands: [0, 1] },
  { id: 'lantern',  name: '灯笼鱼',     color: UI.jade,    r: 9,  value: 6,  predator: false, speed: 26, bands: [0, 1] },
  { id: 'jelly',    name: '深海水母',   color: UI.violet,  r: 12, value: 16, predator: false, speed: 18, bands: [2, 3, 4] },
  { id: 'tube',     name: '管虫',       color: UI.jade,    r: 8,  value: 14, predator: false, speed: 8,  bands: [3] },
  { id: 'snail',    name: '甲壳螺',     color: UI.amber,   r: 10, value: 26, predator: false, speed: 14, bands: [3, 4] },
  { id: 'ray',      name: '刺鳐',       color: UI.magenta, r: 14, value: 22, predator: true,  speed: 64, bands: [1, 2, 3] },
  { id: 'watcher',  name: '深渊守望者', color: UI.violet,  r: 22, value: 90, predator: true,  speed: 52, bands: [4] },
]

interface Creature {
  def: CreatureDef
  x: number
  y: number
  vx: number
  vy: number
  ph: number
  alive: boolean
}

interface Vent { x: number; y: number; r: number }

interface Sample { name: string; value: number; color: number }

type Phase = 'diving' | 'ascending' | 'over'

export default class ExploreScene extends Phaser.Scene {
  constructor() { super('explore') }

  // ---- 玩家 ----
  private px = SPAWN.x
  private py = SPAWN.y
  private pvx = 0
  private pvy = 0
  private energy = 100
  private energyMax = 100
  private readonly cargoMax = 6
  private cargo: Sample[] = []
  private invuln = 0
  private hitFlash = 0

  // ---- 电量收支 ----
  private readonly drainBase = 0.85     // 维持
  private readonly drainLight = 1.15    // 灯
  private readonly drainThrust = 0.40   // 推进（移动时才算）
  private readonly ascendMul = 1.55     // 上浮更费电

  private phase: Phase = 'diving'
  private depthM = 0

  // ---- 世界 ----
  private creatures: Creature[] = []
  private vents: Vent[] = []
  private motes: { x: number; y: number; r: number; s: number }[] = []

  // ---- 渲染对象 ----
  private gWorldA!: Phaser.GameObjects.Graphics   // 生物
  private gVents!: Phaser.GameObjects.Graphics    // 热泉
  private gMotes!: Phaser.GameObjects.Graphics    // 海雪
  private gSub!: Phaser.GameObjects.Graphics      // 潜航器
  private gDark!: Phaser.GameObjects.Graphics     // 黑暗遮罩（屏幕空间）
  private gHud!: Phaser.GameObjects.Graphics      // HUD（屏幕空间）
  private hudText: Phaser.GameObjects.Text[] = []
  private toastText!: Phaser.GameObjects.Text
  private toastT = 0

  // ---- 输入 ----
  private kb!: Record<string, Phaser.Input.Keyboard.Key>

  private t = 0

  // ================================================================ 生命周期
  create() {
    this.phase = 'diving'
    this.px = SPAWN.x; this.py = SPAWN.y
    this.pvx = 0; this.pvy = 0
    this.energy = this.energyMax
    this.cargo = []
    this.invuln = 0; this.hitFlash = 0
    this.creatures = []; this.vents = []; this.motes = []
    this.hudText = []
    this.t = 0

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H)
    this.cameras.main.setBackgroundColor(UI.abyss)

    this.buildBackdrop()
    this.buildWalls()
    this.buildVents()
    this.buildMotes()

    this.gVents = this.add.graphics().setDepth(3)
    this.gWorldA = this.add.graphics().setDepth(10)
    this.gMotes = this.add.graphics().setDepth(12)
    this.gSub = this.add.graphics().setDepth(20)
    this.gDark = this.add.graphics().setDepth(30).setScrollFactor(0)
    this.gHud = this.add.graphics().setDepth(50).setScrollFactor(0)

    for (let i = 0; i < 40; i++) this.spawnCreature()

    const K = Phaser.Input.Keyboard.KeyCodes
    const kb = this.input.keyboard!
    this.kb = {
      w: kb.addKey(K.W), a: kb.addKey(K.A), s: kb.addKey(K.S), d: kb.addKey(K.D),
      up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
      space: kb.addKey(K.SPACE), e: kb.addKey(K.E), esc: kb.addKey(K.ESC),
    }
    kb.on('keydown-SPACE', () => { if (this.phase === 'diving') this.harvest() })
    kb.on('keydown-E', () => { if (this.phase === 'diving') this.beginAscend() })
    kb.on('keydown-ESC', () => this.backToTitle())

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => routeDown(this, p))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => routeMove(this, p))

    this.toastText = this.add.text(this.scale.width / 2, this.scale.height * 0.30, '', {
      fontFamily: FONT, fontSize: '20px', color: TXT.amber,
    }).setOrigin(0.5).setDepth(60).setScrollFactor(0).setAlpha(0)

    this.cameras.main.startFollow(this.gSub, true, 0.14, 0.14)
    this.cameras.main.setZoom(1)
    this.scale.on('resize', () => this.scene.restart())
  }

  // ================================================================ 世界构建
  private buildBackdrop() {
    // 全世界的竖向渐变：5 层色带过渡到近黑
    const stops: [number, number][] = [
      [0.00, 0x123f54],
      [0.16, 0x0d3145],
      [0.34, 0x08202f],
      [0.50, 0x061521],
      [0.66, 0x0b1e1b],   // 热泉带偏暖
      [0.80, 0x080a16],
      [1.00, 0x03040a],
    ]
    const g = this.add.graphics().setDepth(0)
    verticalBands(g, 0, 0, WORLD_W, WORLD_H, stops, 90)

    // 每层的分界横线：一条极淡的青线，让"下潜过层"有明确的视觉事件
    const line = this.add.graphics().setDepth(1)
    for (let i = 1; i < BANDS.length; i++) {
      const y = i * BAND_H
      neonLine(line, 0, y, WORLD_W, y, UI.cyanDim, { width: 1.5, alpha: 0.35, bloom: false })
    }
  }

  /** 峡谷岩壁：随深度摆动的两条曲线，内部填近黑挡住背景。 */
  private wallX(y: number, left: boolean): number {
    if (left) return 210 + Math.sin(y * 0.0040) * 95 + Math.sin(y * 0.011 + 1.1) * 34
    return WORLD_W - 200 - Math.sin(y * 0.0035 + 1.7) * 88 - Math.sin(y * 0.009 + 0.4) * 30
  }

  private buildWalls() {
    const g = this.add.graphics().setDepth(2)
    for (const left of [true, false]) {
      const pts: number[] = []
      for (let y = 0; y <= WORLD_H; y += 60) pts.push(this.wallX(y, left), y)
      const edge = left ? -400 : WORLD_W + 400
      pts.push(edge, WORLD_H)
      pts.push(edge, 0)
      neonPoly(g, pts, UI.rock, { fill: true, fillAlpha: 0.97, bloom: false })
      neonPoly(g, pts, UI.line, { width: 1.5, alpha: 0.8, bloom: false })
    }
  }

  /** 热泉：唯一补给点，只在中深层出现。 */
  private buildVents() {
    this.vents = []
    for (let i = 0; i < 7; i++) {
      const band = 2 + (i % 3)          // L3 / L4 / L5
      const y = band * BAND_H + Phaser.Math.Between(220, BAND_H - 220)
      const l = this.wallX(y, true), r = this.wallX(y, false)
      this.vents.push({ x: Phaser.Math.Between(Math.round(l + 90), Math.round(r - 90)), y, r: 120 })
    }
  }

  private buildMotes() {
    for (let i = 0; i < 90; i++) {
      this.motes.push({
        x: Phaser.Math.Between(0, WORLD_W),
        y: Phaser.Math.Between(0, WORLD_H),
        r: Phaser.Math.FloatBetween(0.8, 2.2),
        s: Phaser.Math.FloatBetween(6, 20),
      })
    }
  }

  private spawnCreature() {
    // 在玩家附近的深度窗口内生成，保证同屏数量恒定（性能与观感双保险）
    const y = Phaser.Math.Clamp(
      this.py + Phaser.Math.Between(-900, 1400), 60, WORLD_H - 60
    )
    const bandIdx = Math.min(BANDS.length - 1, Math.floor(y / BAND_H))
    const pool = CREATURES.filter(d => d.bands.includes(bandIdx))
    const def = pool.length ? Phaser.Utils.Array.GetRandom(pool) : CREATURES[0]
    const l = this.wallX(y, true), r = this.wallX(y, false)
    this.creatures.push({
      def,
      x: Phaser.Math.Between(Math.round(l + 60), Math.round(r - 60)),
      y,
      vx: Phaser.Math.FloatBetween(-1, 1) * def.speed,
      vy: Phaser.Math.FloatBetween(-0.4, 0.4) * def.speed,
      ph: Phaser.Math.FloatBetween(0, Math.PI * 2),
      alive: true,
    })
  }

  // ================================================================ 主循环
  update(_time: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000
    this.t += dt

    if (this.phase !== 'over') {
      this.tickPlayer(dt)
      this.tickEnergy(dt)
      this.tickCreatures(dt)
      this.tickVents(dt)
      this.tickMotes(dt)
    }
    this.drawSub()
    this.drawCreatures()
    this.drawVents()
    this.drawMotes()
    this.drawDarkness()
    this.drawHud()

    if (this.toastT > 0) {
      this.toastT -= dt
      this.toastText.setAlpha(Math.min(1, this.toastT * 2))
    }
  }

  private tickPlayer(dt: number) {
    if (this.phase === 'ascending') {
      // 自动上浮：向上推进，直到出海面
      this.pvy = -260
      this.pvx *= 0.9
      this.py += this.pvy * dt
      this.px += this.pvx * dt
      if (this.py <= 40) { this.py = 40; this.finish(true); return }
    } else {
      const ax = (this.kb.d.isDown || this.kb.right.isDown ? 1 : 0) - (this.kb.a.isDown || this.kb.left.isDown ? 1 : 0)
      const ay = (this.kb.s.isDown || this.kb.down.isDown ? 1 : 0) - (this.kb.w.isDown || this.kb.up.isDown ? 1 : 0)
      const len = Math.hypot(ax, ay) || 1
      const accel = 620
      this.pvx += (ax / len) * accel * dt
      this.pvy += (ay / len) * accel * dt
      // 水阻：松手会滑行一小段，手感比急停好
      this.pvx *= Math.pow(0.14, dt)
      this.pvy *= Math.pow(0.14, dt)
      const maxV = 240
      const v = Math.hypot(this.pvx, this.pvy)
      if (v > maxV) { this.pvx = this.pvx / v * maxV; this.pvy = this.pvy / v * maxV }
      this.px += this.pvx * dt
      this.py += this.pvy * dt
    }

    // 岩壁碰撞
    const l = this.wallX(this.py, true), r = this.wallX(this.py, false)
    if (this.px < l + 34) { this.px = l + 34; this.pvx = Math.abs(this.pvx) * 0.3 }
    if (this.px > r - 34) { this.px = r - 34; this.pvx = -Math.abs(this.pvx) * 0.3 }
    if (this.py < 30) { this.py = 30; this.pvy = Math.max(0, this.pvy) }
    if (this.py > WORLD_H - 30) { this.py = WORLD_H - 30; this.pvy = Math.min(0, this.pvy) }

    this.depthM = this.depthAt(this.py)
    if (this.invuln > 0) this.invuln -= dt
    if (this.hitFlash > 0) this.hitFlash -= dt
  }

  /** 世界 y → 深度米数（层内线性，层间非线性，越深越"重"）。 */
  private depthAt(y: number): number {
    const i = Phaser.Math.Clamp(Math.floor(y / BAND_H), 0, BANDS.length - 1)
    const b = BANDS[i]
    const t = Phaser.Math.Clamp((y - i * BAND_H) / BAND_H, 0, 1)
    return b.from + (b.to - b.from) * t
  }

  private bandIdxAt(y: number): number {
    return Phaser.Math.Clamp(Math.floor(y / BAND_H), 0, BANDS.length - 1)
  }

  private tickEnergy(dt: number) {
    const band = BANDS[this.bandIdxAt(this.py)]
    const moving = Math.hypot(this.pvx, this.pvy) > 24
    let drain = this.drainBase + this.drainLight + (moving ? this.drainThrust : 0)
    drain *= band.mul
    if (this.phase === 'ascending') drain *= this.ascendMul
    this.energy -= drain * dt
    if (this.energy <= 0) { this.energy = 0; this.finish(false) }
  }

  private tickCreatures(dt: number) {
    // 数量维持：太少就补，太远就删
    while (this.creatures.length < 34) this.spawnCreature()
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i]
      if (Math.abs(c.y - this.py) > 2000) { this.creatures.splice(i, 1); continue }
      if (!c.alive) { this.creatures.splice(i, 1); continue }

      if (c.def.predator) {
        // 趋光：灯越亮越吸引掠食者 —— 这是"亮度即风险"的机制表达
        const d = Phaser.Math.Distance.Between(c.x, c.y, this.px, this.py)
        if (d < this.lightR() * 1.15) {
          const a = Math.atan2(this.py - c.y, this.px - c.x)
          c.vx += Math.cos(a) * c.def.speed * 2.4 * dt
          c.vy += Math.sin(a) * c.def.speed * 2.4 * dt
        }
      } else {
        // 非掠食者：缓慢游荡，靠近时轻微逃离
        c.ph += dt * 0.6
        c.vx += Math.cos(c.ph * 1.7) * 12 * dt
        c.vy += Math.sin(c.ph) * 9 * dt
        const d = Phaser.Math.Distance.Between(c.x, c.y, this.px, this.py)
        if (d < 90) {
          const a = Math.atan2(c.y - this.py, c.x - this.px)
          c.vx += Math.cos(a) * 40 * dt
          c.vy += Math.sin(a) * 40 * dt
        }
      }
      const sp = Math.hypot(c.vx, c.vy)
      const cap = c.def.speed * 1.6
      if (sp > cap) { c.vx = c.vx / sp * cap; c.vy = c.vy / sp * cap }
      c.x += c.vx * dt
      c.y += c.vy * dt

      // 岩壁夹住
      const l = this.wallX(c.y, true), r = this.wallX(c.y, false)
      if (c.x < l + 20) { c.x = l + 20; c.vx = Math.abs(c.vx) }
      if (c.x > r - 20) { c.x = r - 20; c.vx = -Math.abs(c.vx) }

      // 接触判定
      if (Phaser.Math.Distance.Between(c.x, c.y, this.px, this.py) < c.def.r + 22) {
        if (c.def.predator && this.invuln <= 0) {
          this.energy = Math.max(0, this.energy - (c.def.id === 'watcher' ? 22 : 13))
          this.invuln = 0.9
          this.hitFlash = 0.35
          this.cameras.main.shake(180, 0.008)
          this.toast(c.def.id === 'watcher' ? '深渊守望者撞击！电量 -22' : '遭到掠食者撞击！电量 -13')
        }
      }
    }
  }

  private tickVents(dt: number) {
    for (const v of this.vents) {
      if (Math.abs(v.y - this.py) > 1400) continue
      if (Phaser.Math.Distance.Between(v.x, v.y, this.px, this.py) < v.r) {
        const before = this.energy
        this.energy = Math.min(this.energyMax, this.energy + 16 * dt)
        if (Math.floor(before) !== Math.floor(this.energy) && Math.floor(this.energy) % 10 === 0) {
          this.toast('热泉补给中… +电量')
        }
      }
    }
  }

  private tickMotes(dt: number) {
    for (const m of this.motes) {
      m.y += m.s * dt
      if (m.y > WORLD_H) { m.y = 0; m.x = Phaser.Math.Between(0, WORLD_W) }
      if (Math.abs(m.y - this.py) > 900) {
        // 回收到玩家附近，保证始终看得见海雪
        if (m.y < this.py) m.y += 1800
        else m.y -= 1800
      }
    }
  }

  // ================================================================ 玩法动作
  /** 电量 → 光照半径。画面亮度就是剩余电量（免教程的状态条）。 */
  private lightR(): number {
    return 150 + this.energy * 2.6
  }

  private harvest() {
    let best: Creature | null = null
    let bestD = 130
    for (const c of this.creatures) {
      if (!c.alive) continue
      const d = Phaser.Math.Distance.Between(c.x, c.y, this.px, this.py)
      if (d < bestD) { bestD = d; best = c }
    }
    if (!best) { this.toast('附近没有可采集的样本'); return }
    if (best.def.predator) { this.toast(`${best.def.name} 无法采集 —— 它会先撞你`); return }
    if (this.cargo.length >= this.cargoMax) {
      this.toast('货舱已满 —— 按 E 上浮卸货')
      return
    }
    this.cargo.push({ name: best.def.name, value: best.def.value, color: best.def.color })
    best.alive = false
    this.toast(`采集 ${best.def.name}　+${best.def.value}`)
  }

  private beginAscend() {
    this.phase = 'ascending'
    this.toast('开始上浮 —— 撑住电量')
  }

  private finish(success: boolean) {
    if (this.phase === 'over') return
    this.phase = 'over'
    const total = this.cargo.reduce((s, c) => s + c.value, 0)
    const banked = success ? total : 0
    const prev = (this.registry.get('bank') as number) ?? 0
    this.registry.set('bank', prev + banked)
    this.showResult(success, total, banked, prev + banked)
  }

  private toast(msg: string) {
    this.toastText.setText(msg)
    this.toastT = 1.6
  }

  private backToTitle() {
    this.scene.start('title')
  }

  // ================================================================ 绘制
  private drawSub() {
    const g = this.gSub
    g.clear()
    g.setPosition(this.px, this.py)
    const ang = Math.hypot(this.pvx, this.pvy) > 12
      ? Math.atan2(this.pvy, this.pvx) : Math.PI / 2
    g.setRotation(ang)

    // 探照灯锥（朝向前方）两层，不用 ADD
    const cone = 300
    const spread = 0.42
    const tip: number[] = [cone, 0]
    const a: number[] = [Math.cos(-spread) * cone, Math.sin(-spread) * cone]
    const b: number[] = [Math.cos(spread) * cone, Math.sin(spread) * cone]
    g.fillStyle(UI.cyanHi, 0.045)
    g.fillTriangle(10, 0, a[0], a[1], b[0], b[1])
    g.fillStyle(UI.cyanHi, 0.055)
    g.fillTriangle(10, 0, tip[0] * 0.55, tip[1] * 0.55 - 40, tip[0] * 0.55, tip[1] * 0.55 + 40)

    // 外发光
    g.fillStyle(UI.cyan, 0.10); g.fillEllipse(0, 0, 76, 46)
    g.fillStyle(UI.cyan, 0.20); g.fillEllipse(0, 0, 58, 34)
    // 舱体
    g.fillStyle(UI.panelHi, 1); g.fillEllipse(0, 0, 44, 26)
    g.lineStyle(2, UI.cyan, 1); g.strokeEllipse(0, 0, 44, 26)
    // 舱窗（朝前）
    g.fillStyle(UI.cyanHi, 0.95); g.fillCircle(11, 0, 6)
    // 尾翼
    g.lineStyle(2, UI.cyanDim, 0.9)
    g.strokeLineShape(new Phaser.Geom.Line(-20, -12, -30, -18))
    g.strokeLineShape(new Phaser.Geom.Line(-20, 12, -30, 18))
    // 受击闪红
    if (this.hitFlash > 0) {
      g.fillStyle(UI.danger, 0.5 * (this.hitFlash / 0.35)); g.fillEllipse(0, 0, 52, 32)
    }
  }

  private drawCreatures() {
    const g = this.gWorldA
    g.clear()
    for (const c of this.creatures) {
      if (Math.abs(c.y - this.py) > 1100) continue
      const col = c.def.color
      // 三层发光（core 是清晰感锚点）
      g.fillStyle(col, 0.12); g.fillCircle(c.x, c.y, c.def.r * 2.4)
      g.fillStyle(col, 0.28); g.fillCircle(c.x, c.y, c.def.r * 1.5)
      g.fillStyle(col, 0.95); g.fillCircle(c.x, c.y, c.def.r)
      g.fillStyle(0xffffff, 0.75); g.fillCircle(c.x, c.y, Math.max(1.2, c.def.r * 0.28))
      if (c.def.predator) {
        g.lineStyle(1.5, UI.danger, 0.85)
        g.strokeCircle(c.x, c.y, c.def.r + 9)
      }
    }
  }

  private drawVents() {
    const g = this.gVents
    g.clear()
    for (const v of this.vents) {
      if (Math.abs(v.y - this.py) > 1200) continue
      const pulse = 0.7 + Math.sin(this.t * 2 + v.x) * 0.3
      g.fillStyle(UI.amber, 0.05); g.fillCircle(v.x, v.y, v.r * pulse)
      g.fillStyle(UI.amber, 0.10); g.fillCircle(v.x, v.y, v.r * 0.6 * pulse)
      g.fillStyle(UI.amber, 0.85); g.fillCircle(v.x, v.y, 12)
      g.fillStyle(0xfff0d0, 0.9); g.fillCircle(v.x, v.y, 5)
      // 上升的热流
      g.fillStyle(UI.amber, 0.06)
      g.fillEllipse(v.x, v.y - 60 * pulse, 26, 90)
    }
  }

  private drawMotes() {
    const g = this.gMotes
    g.clear()
    for (const m of this.motes) {
      if (Math.abs(m.y - this.py) > 700) continue
      g.fillStyle(0xbfe8f5, 0.22); g.fillCircle(m.x, m.y, m.r)
    }
  }

  /**
   * 黑暗遮罩：同心圆环由内向外叠加，环越外越黑。
   *
   * 为什么不用 RenderTexture.erase / 径向渐变：前者在 Canvas 渲染器下行为不一致，
   * 后者（fillGradientStyle）是 WebGL-only。圆环法两个渲染器都成立，
   * 而且天然带出柔和的边缘衰减 —— 正好就是"灯光边界"该有的样子。
   */
  private drawDarkness() {
    const g = this.gDark
    g.clear()
    const cam = this.cameras.main
    const sx = this.px - cam.scrollX
    const sy = this.py - cam.scrollY
    const W = this.scale.width, H = this.scale.height
    // 覆盖到屏幕最远角
    const maxR = Math.max(
      Math.hypot(sx, sy), Math.hypot(W - sx, sy),
      Math.hypot(sx, H - sy), Math.hypot(W - sx, H - sy)
    ) + 40
    const r0 = this.lightR()
    // 电量越低视野越小 —— 但即使归零也留一点，免得完全看不见自己
    const inner = Math.max(70, r0)
    const rings = 20
    const step = (maxR - inner) / rings
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1)
      const rr = inner + step * (i + 0.5)
      // 边缘柔和：内侧几乎透明，外侧压到近全黑
      const a = 0.06 + Math.pow(t, 0.75) * 0.92
      g.lineStyle(step + 2, 0x01040a, a)
      g.strokeCircle(sx, sy, rr)
    }
  }

  // ================================================================ HUD
  private drawHud() {
    const g = this.gHud
    g.clear()
    for (const t of this.hudText) t.destroy()
    this.hudText = []

    const W = this.scale.width
    const H = this.scale.height
    const mk = (x: number, y: number, s: string, size: number, color: string,
                origin = 0, mono = false) => {
      const t = this.add.text(x, y, s, {
        fontFamily: mono ? MONO : FONT, fontSize: `${size}px`, color,
      }).setOrigin(origin, 0.5).setDepth(51).setScrollFactor(0)
      t.setStroke('#04070d', Math.max(2, Math.round(size / 12)))
      this.hudText.push(t)
      return t
    }

    // ---- ① 电量环（左上）----
    const ecx = 88, ecy = 88, er = 46
    const ratio = Phaser.Math.Clamp(this.energy / this.energyMax, 0, 1)
    glowPool(g, ecx, ecy, er * 2.4, er * 2.4, UI.cyanDim, 4, 0.05)
    neonCircle(g, ecx, ecy, er, UI.cyanDim, { width: 6, alpha: 0.5, bloom: false })
    const start = Phaser.Math.DegToRad(-90)
    const col = ratio > 0.5 ? UI.cyan : (ratio > 0.22 ? UI.amber : UI.danger)
    g.lineStyle(6, col, 1)
    g.beginPath()
    g.arc(ecx, ecy, er, start, start + Math.PI * 2 * ratio, false)
    g.strokePath()
    // 低电量脉动
    if (ratio <= 0.22) {
      g.lineStyle(10, UI.danger, 0.18 + Math.sin(this.t * 8) * 0.14)
      g.strokeCircle(ecx, ecy, er + 8)
    }
    mk(ecx, ecy, String(Math.ceil(this.energy)), 26, ratio > 0.22 ? TXT.cyber : TXT.warn, 0.5, true)
    mk(ecx, ecy + er + 16, '电量', 14, TXT.mute, 0.5)

    // ---- ② 深度柱（左侧）----
    const dx = 26, dy0 = 176, dh = H - dy0 - 96
    g.fillStyle(UI.panel, 0.8)
    g.fillRoundedRect(dx - 7, dy0 - 7, 20, dh + 14, 8)
    g.lineStyle(1, UI.cyanDim, 0.6)
    g.strokeRoundedRect(dx - 7, dy0 - 7, 20, dh + 14, 8)
    for (let i = 0; i < BANDS.length; i++) {
      const y = dy0 + (i / BANDS.length) * dh
      const h = dh / BANDS.length
      const here = i === this.bandIdxAt(this.py)
      g.fillStyle(here ? UI.cyan : UI.line, here ? 0.55 : 0.28)
      g.fillRect(dx - 3, y + 1, 12, h - 2)
    }
    const dt2 = Phaser.Math.Clamp(this.py / WORLD_H, 0, 1)
    const my = dy0 + dt2 * dh
    g.fillStyle(UI.cyanHi, 1)
    g.fillTriangle(dx + 16, my, dx + 26, my - 6, dx + 26, my + 6)
    mk(dx + 34, my, `${Math.round(this.depthM)}m`, 15, TXT.cyan, 0, true)
    const band = BANDS[this.bandIdxAt(this.py)]
    mk(dx - 3, dy0 - 22, band.name, 16, TXT.cyber)

    // ---- ③ 声呐盘（底部中央）----
    const scx = W / 2, scy = H - 96, sr = 72
    glowPool(g, scx, scy, sr * 2.6, sr * 2.6, UI.cyanDim, 4, 0.045)
    g.fillStyle(UI.abyss, 0.75); g.fillCircle(scx, scy, sr)
    neonCircle(g, scx, scy, sr, UI.cyanDim, { width: 1.5, alpha: 0.8, bloom: false })
    neonCircle(g, scx, scy, sr * 0.62, UI.cyanDim, { width: 1, alpha: 0.5, bloom: false })
    // 扫描指针
    const sweep = this.t * 1.6 % (Math.PI * 2)
    g.lineStyle(2, UI.cyan, 0.5)
    g.strokeLineShape(new Phaser.Geom.Line(scx, scy, scx + Math.cos(sweep) * sr, scy + Math.sin(sweep) * sr))
    // 光点
    const range = 900
    for (const c of this.creatures) {
      const d = Phaser.Math.Distance.Between(c.x, c.y, this.px, this.py)
      if (d > range) continue
      const a = Math.atan2(c.y - this.py, c.x - this.px)
      const rr = (d / range) * sr
      const bc = c.def.predator ? UI.danger : c.def.color
      g.fillStyle(bc, 0.9); g.fillCircle(scx + Math.cos(a) * rr, scy + Math.sin(a) * rr, 3)
    }
    g.fillStyle(UI.cyanHi, 1); g.fillCircle(scx, scy, 3.5)
    mk(scx, scy + sr + 16, `声呐 ${range}m`, 13, TXT.mute, 0.5)

    // ---- ④ 货舱（右上）----
    const slot = 30, gap = 5
    const n = this.cargoMax
    const cw = n * slot + (n - 1) * gap
    const cx0 = W - 28 - cw
    const cy0 = 34
    mk(W - 28, cy0 - 16, `货舱 ${this.cargo.length}/${this.cargoMax}`, 15,
       this.cargo.length >= this.cargoMax ? TXT.warn : TXT.dim, 1)
    for (let i = 0; i < n; i++) {
      const x = cx0 + i * (slot + gap)
      const s = this.cargo[i]
      g.fillStyle(UI.panel, 0.85); g.fillRoundedRect(x, cy0, slot, slot, 5)
      g.lineStyle(1, s ? s.color : UI.line, s ? 0.95 : 0.6)
      g.strokeRoundedRect(x, cy0, slot, slot, 5)
      if (s) { g.fillStyle(s.color, 0.9); g.fillCircle(x + slot / 2, cy0 + slot / 2, 7) }
    }
    if (this.cargo.length >= this.cargoMax) {
      g.lineStyle(2, UI.danger, 0.3 + Math.sin(this.t * 5) * 0.25)
      g.strokeRoundedRect(cx0 - 4, cy0 - 4, cw + 8, slot + 8, 7)
    }

    // ---- ⑤ 底部提示 ----
    const tip = this.phase === 'ascending'
      ? '上浮中… 撑住电量'
      : 'WASD 移动　·　空格 采集　·　E 上浮结算　·　Esc 主界面'
    mk(W / 2, H - 14, tip, 15, this.phase === 'ascending' ? TXT.amber : TXT.mute, 0.5)

    // ---- 受击红闪 ----
    if (this.hitFlash > 0) {
      g.fillStyle(UI.danger, 0.10 * (this.hitFlash / 0.35))
      g.fillRect(0, 0, W, H)
    }
  }

  // ================================================================ 结算
  private showResult(success: boolean, total: number, banked: number, bank: number) {
    const W = this.scale.width, H = this.scale.height
    const p = this.add.container(W / 2, H / 2).setDepth(80).setScrollFactor(0)
    const pw = 520, ph = 400

    const bg = this.add.graphics()
    bg.fillStyle(UI.abyss, 0.95).fillRoundedRect(-pw / 2, -ph / 2, pw, ph, 16)
    bg.lineStyle(2, success ? UI.cyan : UI.danger, 0.95)
    bg.strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, 16)
    bg.lineStyle(4, success ? UI.cyan : UI.danger, 0.10)
    bg.strokeRoundedRect(-pw / 2 - 4, -ph / 2 - 4, pw + 8, ph + 8, 18)
    p.add(bg)

    const head = success ? '上 浮 成 功' : '沉 没 · 全 损'
    p.add(this.add.text(0, -ph / 2 + 46, head, {
      fontFamily: FONT, fontSize: '34px', color: success ? TXT.cyber : TXT.warn, fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#04070d', 4))

    p.add(this.add.text(0, -ph / 2 + 84, success
      ? `本次带回 ${banked} 样本值`
      : '电量耗尽 —— 货舱样本全部遗失', {
      fontFamily: FONT, fontSize: '17px', color: success ? TXT.dim : TXT.warn,
    }).setOrigin(0.5))

    // 样本清单
    const byName = new Map<string, { n: number; v: number; c: number }>()
    for (const s of this.cargo) {
      const e = byName.get(s.name) ?? { n: 0, v: 0, c: s.color }
      e.n++; e.v += s.value; byName.set(s.name, e)
    }
    let iy = -ph / 2 + 130
    if (byName.size === 0) {
      p.add(this.add.text(0, iy, '（空舱）', {
        fontFamily: FONT, fontSize: '16px', color: TXT.mute,
      }).setOrigin(0.5))
      iy += 30
    } else {
      for (const [name, e] of byName) {
        const row = this.add.container(-pw / 2 + 60, iy)
        const dot = this.add.graphics()
        dot.fillStyle(e.c, 0.95).fillCircle(0, 0, 6)
        row.add(dot)
        row.add(this.add.text(16, 0, `${name} ×${e.n}`, {
          fontFamily: FONT, fontSize: '16px', color: TXT.main,
        }).setOrigin(0, 0.5))
        row.add(this.add.text(pw - 120, 0, `+${e.v}`, {
          fontFamily: MONO, fontSize: '16px', color: TXT.cyan,
        }).setOrigin(1, 0.5))
        p.add(row)
        iy += 30
      }
    }

    p.add(this.add.text(0, ph / 2 - 96, `港口累计样本值：${bank}`, {
      fontFamily: MONO, fontSize: '18px', color: TXT.amber,
    }).setOrigin(0.5))

    // 按钮
    const btn = (label: string, ox: number, primary: boolean, fn: () => void) => {
      const bw = 170, bh = 48
      const c = this.add.container(ox, ph / 2 - 48)
      const bg2 = this.add.graphics()
      bg2.fillStyle(UI.panelHi, 0.95).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 10)
      bg2.lineStyle(primary ? 2 : 1.5, primary ? UI.cyanHi : UI.cyanDim, 1)
      bg2.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 10)
      c.add(bg2)
      c.add(this.add.text(0, 0, label, {
        fontFamily: FONT, fontSize: '19px', color: primary ? TXT.cyber : TXT.main,
      }).setOrigin(0.5).setStroke('#04070d', 2))
      const hit = this.add.rectangle(0, 0, bw, bh, 0xffffff, 0.001)
      registerUiHit(this, {
        obj: hit, w: bw, h: bh,
        onClick: fn,
        onHover: (v) => {
          c.setScale(v ? 1.04 : 1)
          bg2.clear()
          bg2.fillStyle(v ? UI.panelHi : UI.panel, 0.95).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 10)
          bg2.lineStyle(primary ? 2 : 1.5, v ? UI.cyanHi : (primary ? UI.cyan : UI.cyanDim), 1)
          bg2.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 10)
        },
        alive: () => !!p.scene,
      })
      c.add(hit)
      p.add(c)
    }
    btn('再 次 下 潜', -96, true, () => this.scene.restart())
    btn('返 回 主 界 面', 96, false, () => this.backToTitle())
  }
}
