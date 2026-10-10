/**
 * 波次制下潜场景（V6 核心玩法 / S2 垂直切片）
 *
 * 对应《项目计划书》V6 §3-§4、《美术资源计划》V4 §2-§4、《UI规格》V3 §5。
 *
 * ---------------------------------------------------------------------------
 * 这一版要验证的只有两件事（其余都是次要的）
 * ---------------------------------------------------------------------------
 *   ① 单波战斗自己玩起来爽不爽（30 秒可判断）
 *   ② 氧气条有没有让人产生"要不要去捡那个气泡"的犹豫
 *
 * 这两条不成立，后面 5 层 / 8 武器 / 30 道具全是白做（立项书 §10 止损线）。
 *
 * ---------------------------------------------------------------------------
 * S2 相对 S1 的增量：把「下潜 / 上浮」这个 V6 唯一的结构决策做出来
 * ---------------------------------------------------------------------------
 * S1 只有 1 层 4 波，氧气只是一条会下降的条——玩家判断不了 V6 成立与否，
 * 因为 V6 真正的张力是**每层末的二选一**：
 *
 *      继续下潜（赌）：扣下潜门票氧气，上限被压缩，耗氧更快，但收益倍率 +0.5
 *      上浮兑现（收）：立刻结算，带走 100% 生物质 × 当前倍率
 *
 * 没有这个选择，「氧气四合一」退化成一根换皮血条。所以 S2 必须做完它。
 *
 * ---------------------------------------------------------------------------
 * 与旧 ExploreScene 的关系
 * ---------------------------------------------------------------------------
 * ExploreScene 是 V5 的"下潜探索 + 捕捞"玩法（6000px 纵向世界 + 视野遮罩），
 * 已被 V6 立项书废弃。本场景不复用它的世界与遮罩逻辑，改为**固定竞技场**：
 *   - 场地 = 当前视口，无滚动
 *   - 视野遮罩取消。V6 要求同屏敌人全部可读，黑暗遮罩会毁掉 gameplay 信息
 *     （见《美术资源计划》V4 §2「分层可见度模型」）
 * 保留的是：neon 三层发光绘制、色相隔离、双渲染器兼容（不用 WebGL-only API）。
 */

import Phaser from 'phaser'
import { UI, TXT, FONT, MONO } from '../config/theme'
import { neon, neonCircle, neonLine, glowPool } from '../render/neon'
import { registerUiHit, routeDown, routeMove } from '../ui/hitRouter'

/** 氧气泡专用：全场唯一纯白，在混乱中最先被看见（V4 §3.3） */
const WHITE = 0xffffff

// ---------------------------------------------------------------------------
// 氧气基础数值（V6 §4.2）
// ---------------------------------------------------------------------------
const O2 = {
  max: 100,           // L1 基准上限（绘制用的分母）
  bubbleValue: 5,     // 单个气泡回氧
  bubbleLife: 6.0,    // 气泡存活秒数
  bubbleBlink: 2.0,   // 最后 N 秒开始闪烁
  pickupR: 26,        // 拾取半径
  burstCost: 20,      // 排气爆发消耗
  burstCd: 12,        // 排气爆发冷却
  burstR: 250,        // 排气爆发半径
}

const PLAYER = {
  speed: 220,
  r: 16,
  dmg: 12,
  cd: 0.42,           // 射击间隔（秒）
  range: 420,
  bulletSpeed: 620,
  pierce: 1,
  killO2: 0,          // 击杀额外回氧（被动「循环鳃」加这个）
}

// ---------------------------------------------------------------------------
// 五层（V6 §3.4）
// ---------------------------------------------------------------------------
/**
 * ⚠️ dropCap 相对立项书 §3.4「60→30」做了上调，原因写在这里，别再改回去：
 *
 * 立项书那组数是按"越深越难"拍的，但把它和耗氧一起算一遍会发现 L5 必死：
 *   耗氧 3.0/s × 55s ≈ 165 氧/波，而每波掉落上限只有 30 → 净 -135。
 *   氧气上限 60，一波都撑不完，跟操作无关，纯数值死刑。
 *
 * 深层压力应该来自**上限被压缩 + 耗氧变快**（这是 V6 的设计意图，必须保留），
 * 而不是"补给根本不够"。所以让掉落绝对值跟着涨，只让**净收益递减**：
 *
 *   L1 净 +24 → L2 +25 → L3 +20 → L4 +10 → L5 -5
 *
 * 这样 L5 依然是全场最紧的（必须近乎不漏地捡泡），但打得好能活。
 */
interface LayerDef {
  name: string
  sub: string
  o2Max: number     // 氧气上限（越深越窄）
  drain: number     // 每秒耗氧
  dropCap: number   // 每波掉落总量上限（硬约束 ②）
  toll: number      // 下潜门票（从氧气里扣；最后一层为 0）
  vis: number       // 环境可见度 0~1（V4 §2.2）
  tint: number      // 环境主色（与 UI 色解耦，UI规格 §5.1）
  motes: number     // 漂浮颗粒数量
  hpMul: number     // 敌人血量倍率
  cntMul: number    // 敌人数量倍率
  dashMul: number   // 冲刺型占比倍率
  driftRatio: number// 水母型占比
}

const LAYERS: LayerDef[] = [
  { name: '阳光带',   sub: 'SUNLIT',       o2Max: 100, drain: 1.00, dropCap: 70,  toll: 15, vis: 1.00, tint: 0x2a6f8a, motes: 34,  hpMul: 1.00, cntMul: 1.00, dashMul: 0.5, driftRatio: 0.00 },
  { name: '弱光带',   sub: 'TWILIGHT',     o2Max: 100, drain: 1.35, dropCap: 90,  toll: 20, vis: 0.80, tint: 0x1d5a5a, motes: 48,  hpMul: 1.35, cntMul: 1.25, dashMul: 1.0, driftRatio: 0.12 },
  { name: '午夜带',   sub: 'MIDNIGHT',     o2Max: 85,  drain: 1.80, dropCap: 110, toll: 25, vis: 0.40, tint: 0x14203c, motes: 70,  hpMul: 1.80, cntMul: 1.50, dashMul: 1.1, driftRatio: 0.18 },
  { name: '热泉带',   sub: 'HYDROTHERMAL', o2Max: 70,  drain: 2.40, dropCap: 135, toll: 30, vis: 0.25, tint: 0x3a1a10, motes: 90,  hpMul: 2.40, cntMul: 1.80, dashMul: 1.2, driftRatio: 0.15 },
  { name: '深渊带',   sub: 'THE ABYSS',    o2Max: 60,  drain: 3.00, dropCap: 160, toll: 0,  vis: 0.10, tint: 0x0a0614, motes: 110, hpMul: 3.20, cntMul: 2.10, dashMul: 1.3, driftRatio: 0.22 },
]

/** 每层 4 波的形状模板（V6 §3.1） */
const WAVE_SHAPE = [
  { count: 12, dashRatio: 0.00, hpMul: 1.00, dur: 40 },
  { count: 18, dashRatio: 0.25, hpMul: 1.15, dur: 45 },
  { count: 26, dashRatio: 0.35, hpMul: 1.30, dur: 50 },
  { count: 36, dashRatio: 0.45, hpMul: 1.50, dur: 55 },
]

type Kind = 'swarm' | 'dash' | 'drift' | 'boss'

interface Enemy {
  x: number; y: number
  vx: number; vy: number
  hp: number; maxHp: number
  r: number
  kind: Kind
  color: number
  speed: number
  /** chase → charge（红色预警）→ dash → rest */
  phase: 'chase' | 'charge' | 'dash' | 'rest'
  t: number
  dirX: number; dirY: number
  alive: boolean
  flash: number      // 命中闪白计时
}

interface Bubble { x: number; y: number; life: number; value: number; alive: boolean }

interface Bullet {
  x: number; y: number
  vx: number; vy: number
  life: number; dmg: number; pierce: number
  hit: Set<number>
  alive: boolean
}

interface Upgrade {
  id: string
  name: string
  desc: string
  apply: (s: DiveScene) => void
}

interface Mote { x: number; y: number; r: number; vy: number; vx: number; a: number }

export default class DiveScene extends Phaser.Scene {
  constructor() { super('dive') }

  // ---- 玩家状态 ----
  private px = 0
  private py = 0
  private o2 = O2.max
  private o2Max = O2.max
  /** 升级带来的额外上限（跨层保留） */
  private o2Bonus = 0
  private biomass = 0
  private fireTimer = 0
  private burstTimer = 0
  private dmg = PLAYER.dmg
  private fireCd = PLAYER.cd
  private pierce = PLAYER.pierce
  private speedMul = 1
  private pickupMul = 1
  private killO2 = PLAYER.killO2
  /** 朝向（弧度）。用于绘制朝向指示线；静止时保持上一次方向 */
  private aim = 0
  /** 受击闪白计时（氧气被撞时） */
  private hurtFlash = 0

  // ---- 实体池 ----
  private enemies: Enemy[] = []
  private bubbles: Bubble[] = []
  private bullets: Bullet[] = []
  private motes: Mote[] = []
  private eid = 0

  // ---- 进度：5 层 × 4 波 ----
  private layerIdx = 0
  private waveInLayer = 0
  /** 收益倍率：每下潜一层 +0.5。上浮结算时乘到生物质上 */
  private mult = 1.0
  /** 本局是否击败 Boss */
  private bossDown = false

  // ---- 波次状态机 ----
  private phase: 'wave' | 'shop' | 'decide' | 'result' = 'wave'
  private waveTimer = 0
  private spawnLeft = 0
  private spawnTimer = 0
  private droppedThisWave = 0
  private win = false

  // ---- 渲染 / 输入 ----
  private gBg!: Phaser.GameObjects.Graphics    // 环境（被暗幕压暗）
  private gDim!: Phaser.GameObjects.Graphics   // 暗幕（只压环境，不压实体）
  private g!: Phaser.GameObjects.Graphics      // 实体（永远全亮）
  private gHud!: Phaser.GameObjects.Graphics
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private shopCards: { x: number; y: number; w: number; h: number; up: Upgrade; rect: Phaser.GameObjects.Rectangle }[] = []
  private decideBtns: { x: number; y: number; w: number; h: number; label: string; sub: string; enabled: boolean; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private resultBtns: { x: number; y: number; w: number; h: number; label: string; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private txtPool: Phaser.GameObjects.Text[] = []
  private t = 0

  create(): void {
    const W = this.scale.width
    const H = this.scale.height
    this.px = W / 2
    this.py = H / 2

    // 深度分层：**环境 → 暗幕 → 实体 → HUD**。
    // 暗幕夹在中间是 V4 §2 的铁律——它只能压暗地形，敌人/气泡/玩家必须画在它之上，
    // 否则深渊层（可见度 10%）会把 gameplay 信息一起吃掉。
    this.gBg = this.add.graphics().setScrollFactor(0).setDepth(5)
    this.gDim = this.add.graphics().setScrollFactor(0).setDepth(7)
    this.g = this.add.graphics().setDepth(10)
    this.gHud = this.add.graphics().setScrollFactor(0).setDepth(100)

    const kb = this.input.keyboard!
    this.keys = {
      up: kb.addKey('W'), down: kb.addKey('S'),
      left: kb.addKey('A'), right: kb.addKey('D'),
      // 数字键：商店 1/2/3，层末决策 1=下潜 / 2=上浮
      one: kb.addKey('ONE'), two: kb.addKey('TWO'), three: kb.addKey('THREE'),
      burst: kb.addKey('SPACE'),
      esc: kb.addKey('ESC'),
    }

    // 必须自己把 pointer 事件喂给 hitRouter：registerUiHit 只登记热区、不接管输入。
    // 漏了这两行 = 所有按钮点了都没反应（2026-10-10 实测踩过）。
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => routeDown(this, p))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => routeMove(this, p))

    this.scale.on('resize', () => this.layout())
    this.startRun()
    this.exposeProbe()
  }

  private layer(): LayerDef { return LAYERS[this.layerIdx] }

  // ==========================================================================
  // 进度
  // ==========================================================================
  private startRun(): void {
    this.layerIdx = 0
    this.waveInLayer = 0
    this.mult = 1.0
    this.bossDown = false
    this.o2Bonus = 0
    this.o2Max = LAYERS[0].o2Max
    this.o2 = this.o2Max
    this.startWave()
  }

  private startWave(): void {
    const L = this.layer()
    const s = WAVE_SHAPE[this.waveInLayer]
    this.spawnLeft = Math.round(s.count * L.cntMul)
    this.spawnTimer = 0
    this.waveTimer = s.dur
    this.droppedThisWave = 0
    this.phase = 'wave'
    this.clearHits()
    this.buildMotes()

    // L5 最后一波：深渊守望者
    if (this.layerIdx === LAYERS.length - 1 && this.waveInLayer === WAVE_SHAPE.length - 1) {
      this.spawnBoss()
    }
  }

  /**
   * 一波打完后的推进。
   *   层内波（1~3 结束）→ 商店三选一 → 下一波
   *   层末波（第 4 波结束）→ 补给站决策（下潜 / 上浮）；最后一层则通关
   */
  private advance(): void {
    if (this.waveInLayer < WAVE_SHAPE.length - 1) {
      this.waveInLayer++
      this.openShop()
      return
    }
    // 层末
    if (this.layerIdx >= LAYERS.length - 1) { this.showResult(true); return }
    this.openDecide()
  }

  // ==========================================================================
  // 生成
  // ==========================================================================
  private spawnEnemy(): void {
    const W = this.scale.width
    const H = this.scale.height
    // 屏幕外生成，游入屏幕（V4 §3.1 规则 ⑤：不在玩家视野内凭空出现）
    const m = 60
    let x = 0, y = 0
    const side = Phaser.Math.Between(0, 3)
    if (side === 0) { x = Phaser.Math.Between(0, W); y = -m }
    else if (side === 1) { x = W + m; y = Phaser.Math.Between(0, H) }
    else if (side === 2) { x = Phaser.Math.Between(0, W); y = H + m }
    else { x = -m; y = Phaser.Math.Between(0, H) }

    const L = this.layer()
    const s = WAVE_SHAPE[this.waveInLayer]
    const hpScale = L.hpMul * s.hpMul

    // 三种体型按层配比随机（回答"不同深度的生物应该不一样"）
    const r = Math.random()
    const dashP = s.dashRatio * L.dashMul
    let kind: Kind
    if (r < L.driftRatio) kind = 'drift'
    else if (r < L.driftRatio + dashP) kind = 'dash'
    else kind = 'swarm'

    const base = kind === 'drift' ? 55 : kind === 'dash' ? 26 : 14
    const hp = Math.round(base * hpScale)
    const spd = kind === 'drift' ? 42 : kind === 'dash' ? 96 : 68

    this.enemies.push({
      x, y, vx: 0, vy: 0,
      hp, maxHp: hp,
      r: kind === 'drift' ? 20 : kind === 'dash' ? 15 : 11,
      kind,
      color: kind === 'drift' ? UI.amber : kind === 'dash' ? UI.magenta : UI.jade,
      speed: spd,
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
    })
    this.eid++
  }

  private spawnBoss(): void {
    const W = this.scale.width
    const hp = Math.round(1100 * this.layer().hpMul)
    this.enemies.push({
      x: W / 2, y: -90, vx: 0, vy: 0,
      hp, maxHp: hp,
      r: 44, kind: 'boss',
      color: UI.violet,
      speed: 46,
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
    })
  }

  private buildMotes(): void {
    const W = this.scale.width, H = this.scale.height
    const n = this.layer().motes
    this.motes = []
    for (let i = 0; i < n; i++) {
      this.motes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.8 + Math.random() * 1.8,
        vy: -6 - Math.random() * 14,      // 海雪缓慢上浮
        vx: (Math.random() - 0.5) * 8,
        a: 0.12 + Math.random() * 0.3,
      })
    }
  }

  private updateWave(dt: number): void {
    this.spawnTimer -= dt
    if (this.spawnLeft > 0 && this.spawnTimer <= 0) {
      this.spawnEnemy()
      this.spawnLeft--
      this.spawnTimer = 0.28
    }

    this.waveTimer -= dt
    const cleared = this.spawnLeft === 0 && this.enemies.length === 0
    if (cleared || this.waveTimer <= 0) {
      // 清场：剩余敌人离场
      this.enemies.forEach(e => { e.phase = 'rest'; e.t = 0 })
      if (cleared || this.enemies.length === 0) { this.advance(); return }
    }
  }

  // ==========================================================================
  // 主循环
  // ==========================================================================
  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000
    this.t += dt

    if (this.hurtFlash > 0) this.hurtFlash -= dt
    if (this.phase === 'wave') {
      this.movePlayer(dt)
      this.updateEnemies(dt)
      this.updateBullets(dt)
      this.updateBubbles(dt)
      this.updateMotes(dt)
      this.autoFire(dt)
      this.drainOxygen(dt)
      this.updateWave(dt)
    } else {
      // 商店 / 决策 / 结算：战斗暂停，只保留环境动画
      this.updateBubbles(dt)
      this.updateMotes(dt)
    }

    // 键盘：商店 1/2/3，层末决策 1=下潜 / 2=上浮
    const K = Phaser.Input.Keyboard
    if (this.phase === 'shop') {
      if (K.JustDown(this.keys.one) && this.offers[0]) this.pickUpgrade(this.offers[0])
      else if (K.JustDown(this.keys.two) && this.offers[1]) this.pickUpgrade(this.offers[1])
      else if (K.JustDown(this.keys.three) && this.offers[2]) this.pickUpgrade(this.offers[2])
    } else if (this.phase === 'decide') {
      if (K.JustDown(this.keys.one)) this.diveDeeper()
      else if (K.JustDown(this.keys.two)) this.surface()
    }
    if (K.JustDown(this.keys.esc)) this.scene.start('title')

    this.drawEnv()
    this.draw()
    this.drawHud()
  }

  private movePlayer(dt: number): void {
    let dx = 0, dy = 0
    if (this.keys.left.isDown) dx -= 1
    if (this.keys.right.isDown) dx += 1
    if (this.keys.up.isDown) dy -= 1
    if (this.keys.down.isDown) dy += 1
    if (dx || dy) {
      const l = Math.hypot(dx, dy)
      this.aim = Math.atan2(dy, dx)
      this.px += (dx / l) * PLAYER.speed * this.speedMul * dt
      this.py += (dy / l) * PLAYER.speed * this.speedMul * dt
    }
    const W = this.scale.width, H = this.scale.height
    this.px = Phaser.Math.Clamp(this.px, 24, W - 24)
    this.py = Phaser.Math.Clamp(this.py, 24, H - 24)

    // 排气爆发
    this.burstTimer -= dt
    if (Phaser.Input.Keyboard.JustDown(this.keys.burst) && this.burstTimer <= 0 && this.o2 > O2.burstCost) {
      this.o2 -= O2.burstCost
      this.burstTimer = O2.burstCd
      for (const e of this.enemies) {
        if (Phaser.Math.Distance.Between(this.px, this.py, e.x, e.y) <= O2.burstR) this.hurt(e, 40)
      }
    }
  }

  private updateEnemies(dt: number): void {
    const dx0 = this.px, dy0 = this.py
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.flash > 0) e.flash -= dt
      const d = Phaser.Math.Distance.Between(e.x, e.y, dx0, dy0) || 1
      const nx = (dx0 - e.x) / d, ny = (dy0 - e.y) / d

      if (e.kind === 'swarm') {
        e.x += nx * e.speed * dt
        e.y += ny * e.speed * dt
      } else if (e.kind === 'drift') {
        // 水母：脉冲式漂移（一鼓一缩），慢但体型大，是"挡视线"型障碍
        const pulse = 0.6 + 0.4 * Math.sin(this.t * 2.2 + e.x * 0.01)
        e.x += nx * e.speed * pulse * dt
        e.y += ny * e.speed * pulse * dt
      } else if (e.kind === 'boss') {
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * dt
          e.y += ny * e.speed * dt
          if (e.t >= 5) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          if (e.t >= 1.2) { this.bossSlam(e); e.phase = 'dash'; e.t = 0 }
        } else {
          if (e.t >= 1.6) { e.phase = 'chase'; e.t = 0 }
        }
      } else {
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * dt
          e.y += ny * e.speed * dt
          if (d < 240) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          e.dirX = nx; e.dirY = ny
          if (e.t >= 0.5) { e.phase = 'dash'; e.t = 0 }
        } else if (e.phase === 'dash') {
          e.x += e.dirX * 460 * dt
          e.y += e.dirY * 460 * dt
          if (e.t >= 0.35) { e.phase = 'rest'; e.t = 0 }
        } else {
          if (e.t >= 0.7) { e.phase = 'chase'; e.t = 0 }
        }
      }

      // 接触伤害：氧气就是血条（V6 §3.2）。贴着不放 = 24 氧/秒。
      if (d < e.r + PLAYER.r) {
        this.o2 -= (e.kind === 'boss' ? 34 : 24) * dt
        this.hurtFlash = 0.25
        // 轻微弹开，避免贴脸站桩
        e.x -= nx * 40 * dt
        e.y -= ny * 40 * dt
      }
    }
  }

  /** Boss 震击：红圈预警 1.2s 后爆发 */
  private bossSlam(e: Enemy): void {
    const R = 220
    if (Phaser.Math.Distance.Between(this.px, this.py, e.x, e.y) <= R) {
      this.o2 -= 18
      this.hurtFlash = 0.35
    }
    this.cameras.main.shake(220, 0.008)
  }

  private updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) continue
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (b.life <= 0) { b.alive = false; continue }
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.alive || b.hit.has(i)) continue
        if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) < e.r + 6) {
          b.hit.add(i)
          e.flash = 0.08            // 命中闪白（替代伤害数字，V4 §3.1 规则 ④）
          this.hurt(e, b.dmg)
          if (b.hit.size >= b.pierce) { b.alive = false; break }
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.alive)
  }

  private hurt(e: Enemy, dmg: number): void {
    e.hp -= dmg
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.biomass += e.kind === 'boss' ? 20 : 1
      if (e.kind === 'boss') this.bossDown = true
      // 硬约束 ②：每波掉落总量有上限（按层配置）
      const cap = this.layer().dropCap
      if (this.droppedThisWave < cap) {
        this.bubbles.push({ x: e.x, y: e.y, life: O2.bubbleLife, value: O2.bubbleValue, alive: true })
        this.droppedThisWave += O2.bubbleValue
      }
      if (this.killO2 > 0) this.o2 = Math.min(this.o2Max, this.o2 + this.killO2)
    }
  }

  private updateBubbles(dt: number): void {
    const pr = O2.pickupR * this.pickupMul
    for (const b of this.bubbles) {
      if (!b.alive) continue
      b.life -= dt
      b.y -= 12 * dt   // 缓慢上升（V4 §3.3：最亮 + 在动 = 最先被看见）
      if (b.life <= 0) { b.alive = false; continue }
      if (Phaser.Math.Distance.Between(b.x, b.y, this.px, this.py) < pr) {
        this.o2 = Math.min(this.o2Max, this.o2 + b.value)
        b.alive = false
      }
    }
    this.bubbles = this.bubbles.filter(b => b.alive)
    this.enemies = this.enemies.filter(e => e.alive)
  }

  private updateMotes(dt: number): void {
    const W = this.scale.width, H = this.scale.height
    for (const m of this.motes) {
      m.y += m.vy * dt
      m.x += m.vx * dt
      if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W }
      if (m.x < -4) m.x = W + 4
      if (m.x > W + 4) m.x = -4
    }
  }

  private autoFire(dt: number): void {
    this.fireTimer -= dt
    if (this.fireTimer > 0) return
    // 自动锁定最近敌人（Brotato 核心：武器自动开火，玩家只管走位）
    let best = -1, bd = PLAYER.range
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]
      const d = Phaser.Math.Distance.Between(this.px, this.py, e.x, e.y)
      if (d < bd) { bd = d; best = i }
    }
    if (best < 0) return
    const e = this.enemies[best]
    const a = Math.atan2(e.y - this.py, e.x - this.px)
    this.bullets.push({
      x: this.px, y: this.py,
      vx: Math.cos(a) * PLAYER.bulletSpeed,
      vy: Math.sin(a) * PLAYER.bulletSpeed,
      life: 1.1, dmg: this.dmg, pierce: this.pierce,
      hit: new Set<number>(), alive: true,
    })
    this.fireTimer = this.fireCd
  }

  private drainOxygen(dt: number): void {
    this.o2 -= this.layer().drain * dt
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false) }
  }

  // ==========================================================================
  // 环境绘制（会被暗幕压暗）
  // ==========================================================================
  private drawEnv(): void {
    const g = this.gBg
    g.clear()
    const W = this.scale.width, H = this.scale.height
    const L = this.layer()

    // 底噪：整场环境色铺一层极淡的底，让"层"在第一眼就被感知
    g.fillStyle(L.tint, 0.16)
    g.fillRect(0, 0, W, H)

    // 漂浮颗粒（海雪）：越深越密
    for (const m of this.motes) {
      g.fillStyle(0xbfd8e6, m.a * 0.5)
      g.fillCircle(m.x, m.y, m.r)
    }

    // 每层签名地貌 —— 必须放**边缘**，绝不遮挡中央战斗区（V4 §4.2）
    switch (this.layerIdx) {
      case 0: {
        // L1 阳光带：顶部光柱 + 底部珊瑚剪影
        for (let i = 0; i < 4; i++) {
          const cx = 120 + i * (W - 240) / 3
          const wTop = 26 + i * 8
          const a = 0.05 + 0.02 * Math.sin(this.t * 0.7 + i)
          g.fillStyle(0x9fe8ff, a)
          g.beginPath()
          g.moveTo(cx - wTop, 0); g.lineTo(cx + wTop, 0)
          g.lineTo(cx + wTop * 2.4, H * 0.55); g.lineTo(cx - wTop * 2.4, H * 0.55)
          g.closePath(); g.fillPath()
        }
        g.fillStyle(L.tint, 0.5)
        for (let i = 0; i < 9; i++) {
          const bx = 40 + i * (W - 80) / 8
          const bh = 24 + (i % 3) * 16
          g.fillTriangle(bx - 16, H, bx + 16, H, bx, H - bh)
        }
        break
      }
      case 1: {
        // L2 弱光带：两侧漂浮水母群（装饰，不参与战斗）
        for (let i = 0; i < 7; i++) {
          const side = i % 2 === 0 ? 1 : -1
          const bx = side > 0 ? 26 + (i % 3) * 20 : W - 26 - (i % 3) * 20
          const by = (H * 0.2) + ((i * 137) % Math.max(1, Math.floor(H * 0.6)))
            + Math.sin(this.t * 0.5 + i) * 18
          g.fillStyle(UI.jade, 0.10)
          g.fillEllipse(bx, by, 26, 20)
          g.lineStyle(1, UI.jade, 0.16)
          g.strokeEllipse(bx, by, 26, 20)
        }
        break
      }
      case 2: {
        // L3 午夜带：底部巨大骨架剪影（只露轮廓，制造"巨大"感）
        g.lineStyle(2, 0x2b4a6e, 0.35)
        g.beginPath()
        g.moveTo(W * 0.06, H - 10)
        g.lineTo(W * 0.30, H - 96)
        g.lineTo(W * 0.52, H - 40)
        g.lineTo(W * 0.74, H - 120)
        g.lineTo(W * 0.96, H - 16)
        g.strokePath()
        for (let i = 0; i < 14; i++) {
          const rx = W * 0.08 + i * (W * 0.84) / 13
          g.lineStyle(1, 0x2b4a6e, 0.22)
          g.strokeLineShape(new Phaser.Geom.Line(rx, H - 12, rx, H - 52 - (i % 4) * 10))
        }
        break
      }
      case 3: {
        // L4 热泉带：底部黑烟囱 + 上升热流（橙）
        for (let i = 0; i < 3; i++) {
          const bx = W * (0.18 + i * 0.32)
          g.fillStyle(0x120a08, 0.85)
          g.fillRect(bx - 22, H - 130, 44, 130)
          g.fillStyle(0x1e1008, 0.85)
          g.fillRect(bx - 30, H - 26, 60, 26)
          for (let k = 0; k < 10; k++) {
            const tt = (this.t * 0.35 + k / 10) % 1
            const yy = H - 130 - tt * 250
            const ww = 10 + tt * 34
            g.fillStyle(UI.amber, 0.055 * (1 - tt))
            g.fillEllipse(bx + Math.sin(tt * 6 + i) * 16, yy, ww, ww * 0.6)
          }
        }
        break
      }
      default: {
        // L5 深渊带：几乎什么都没有，只有稀疏紫色冷光点
        for (let i = 0; i < 6; i++) {
          const bx = (i * 233) % W
          const by = (i * 151) % H
          const a = 0.06 + 0.04 * Math.sin(this.t * 0.6 + i)
          glowPool(g, bx, by, 120, 90, UI.violet, 4, a * 0.5)
        }
        break
      }
    }

    // 场地边界
    neon(g, UI.cyanDim, () => { g.strokeRect(12, 12, W - 24, H - 24) }, { width: 1, alpha: 0.35, bloom: false })

    // ---- 暗幕：只压暗上面这些环境；实体在它之上绘制 ----
    const dim = this.gDim
    dim.clear()
    if (L.vis < 1) {
      dim.fillStyle(UI.abyss, (1 - L.vis) * 0.88)
      dim.fillRect(0, 0, W, H)
    }
  }

  // ==========================================================================
  // 实体绘制
  // ==========================================================================
  private draw(): void {
    const g = this.g
    g.clear()

    // 氧气泡（画在敌人之上，V4 §3.3）
    for (const b of this.bubbles) {
      const blink = b.life < O2.bubbleBlink
        ? (Math.sin(this.t * 25) > 0 ? 1 : 0.35)
        : 1
      neon(g, WHITE, () => { g.fillCircle(b.x, b.y, 5) }, { fill: true, fillAlpha: 0.95 * blink, bloom: false })
      neon(g, WHITE, () => { g.strokeCircle(b.x, b.y, 8) }, { width: 1, alpha: 0.5 * blink, bloom: false })
    }

    // 敌人：只画轮廓 + 发光核心，不填实体色（V4 §3.1 规则 ①）
    const lod = this.enemies.length > 80 ? 2 : this.enemies.length > 40 ? 1 : 0
    for (const e of this.enemies) {
      const col = e.flash > 0 ? WHITE : e.color
      const charging = (e.kind === 'dash' && e.phase === 'charge')
        || (e.kind === 'boss' && e.phase === 'charge')
      const c = charging ? UI.danger : col   // 蓄力期转纯红（V4 §3.4）

      if (e.kind === 'swarm') {
        // 纺锤签名：椭圆 + 三角尾。
        // 尾鳍必须接在**椭圆尾端之外**（沿朝向前进方向的反向），
        // 画在椭圆内部会变成"单眼鱼"，剪影验收过不了（第一版实测）。
        const a = Math.atan2(this.py - e.y, this.px - e.x)
        const ca = Math.cos(a), sa = Math.sin(a)
        const rx = e.r * 1.15, ry = e.r * 0.68
        const tx = e.x - ca * rx, ty = e.y - sa * ry
        const nx2 = -ca, ny2 = -sa
        const px2 = -sa, py2 = ca
        if (lod < 2) {
          neon(g, c, () => {
            g.beginPath()
            g.moveTo(tx, ty)
            g.lineTo(tx + nx2 * 11 + px2 * 7, ty + ny2 * 11 + py2 * 7)
            g.lineTo(tx + nx2 * 11 - px2 * 7, ty + ny2 * 11 - py2 * 7)
            g.closePath(); g.strokePath()
          }, { width: 2, bloom: false })
        }
        neon(g, c, () => { g.strokeEllipse(e.x, e.y, rx * 2, ry * 2) },
          { width: 2, bloom: lod === 0 })
      } else if (e.kind === 'drift') {
        // 钟形水母：半圆顶 + 触须
        const pulse = 1 + 0.12 * Math.sin(this.t * 2.2 + e.x * 0.01)
        const rr = e.r * pulse
        neon(g, c, () => {
          g.beginPath()
          g.arc(e.x, e.y, rr, Math.PI, 0, false)
          g.closePath(); g.strokePath()
        }, { width: 2, bloom: lod === 0 })
        if (lod < 2) {
          for (let k = -1; k <= 1; k++) {
            const ox = k * rr * 0.5
            neonLine(g, e.x + ox, e.y + 2, e.x + ox + Math.sin(this.t * 3 + k) * 6, e.y + rr * 1.5,
              c, { width: 1, alpha: 0.6, bloom: false })
          }
        }
      } else if (e.kind === 'boss') {
        // 深渊守望者：巨环 + 内部旋转多角 + Boss 血条
        const rot = this.t * 0.5
        neonCircle(g, e.x, e.y, e.r, c, { width: 3, bloom: true })
        neonCircle(g, e.x, e.y, e.r * 1.45, c, { width: 1, alpha: 0.35, bloom: false })
        neon(g, c, () => {
          g.beginPath()
          for (let k = 0; k < 7; k++) {
            const a2 = rot + (k / 7) * Math.PI * 2
            const rr = e.r * (0.42 + 0.16 * Math.sin(this.t * 2 + k))
            const xx = e.x + Math.cos(a2) * rr
            const yy = e.y + Math.sin(a2) * rr
            if (k === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy)
          }
          g.closePath(); g.strokePath()
        }, { width: 2, bloom: true })
        // Boss 血条（全场唯一允许显示血条的敌人）
        const bwid = 220, bx = e.x - bwid / 2, by = e.y - e.r - 26
        g.fillStyle(UI.panel, 0.8); g.fillRect(bx, by, bwid, 8)
        g.fillStyle(UI.violet, 1); g.fillRect(bx, by, bwid * Math.max(0, e.hp / e.maxHp), 8)
        g.lineStyle(1, UI.line, 0.9); g.strokeRect(bx, by, bwid, 8)
        // 蓄力预警圈
        if (charging) {
          const kk = e.t / 1.2
          neonCircle(g, e.x, e.y, 220 * (0.6 + 0.4 * kk), UI.danger,
            { width: 3, alpha: 0.5 + 0.4 * kk, bloom: false })
        }
      } else {
        // 菱形翼签名 + 长尾
        const a = Math.atan2(this.py - e.y, this.px - e.x)
        const ca = Math.cos(a), sa = Math.sin(a)
        const px1 = e.x + ca * e.r * 1.5, py1 = e.y + sa * e.r * 1.5
        const px2 = e.x - ca * e.r, py2 = e.y - sa * e.r
        const wx = -sa * e.r * 1.1, wy = ca * e.r * 1.1
        neon(g, c, () => {
          g.beginPath()
          g.moveTo(px1, py1); g.lineTo(e.x + wx, e.y + wy)
          g.lineTo(px2, py2); g.lineTo(e.x - wx, e.y - wy)
          g.closePath(); g.strokePath()
        }, { width: 2, bloom: lod === 0 })
        if (lod < 2) neonLine(g, px2, py2, px2 - ca * 22, py2 - sa * 22, c, { width: 2, bloom: false })
        // 蓄力预警线（红色指示线 + core 转红）
        if (charging) {
          neonLine(g, e.x, e.y, e.x + e.dirX * 60, e.y + e.dirY * 60, UI.danger, { width: 2, bloom: false })
        }
      }
      // 发光核心：远距离也能看见的一个 2px 亮点（铁律）
      g.fillStyle(c, 1)
      g.fillCircle(e.x, e.y, 2)
    }

    // 子弹
    for (const b of this.bullets) {
      neonLine(g, b.x, b.y, b.x - b.vx * 0.02, b.y - b.vy * 0.02, UI.cyanHi, { width: 2, bloom: false })
    }

    // 玩家：永远最亮的青蓝（V4 §3.1 规则 ③）。
    // 受击时短暂转白——这是"氧气被撞了"的唯一反馈，必须有。
    const pcol = this.hurtFlash > 0 ? WHITE : UI.cyan
    neonCircle(g, this.px, this.py, PLAYER.r, pcol, { width: 2 })
    neon(g, UI.cyan, () => { g.fillCircle(this.px, this.py, 5) }, { fill: true, fillAlpha: 1, bloom: false })
    // 朝向指示：跟随移动方向，不是固定朝右
    neonLine(g, this.px, this.py,
      this.px + Math.cos(this.aim) * 24, this.py + Math.sin(this.aim) * 24,
      UI.cyan, { width: 2, alpha: 0.65, bloom: false })

    // 排气爆发环
    if (this.burstTimer > O2.burstCd - 0.4) {
      const k = 1 - (this.burstTimer - (O2.burstCd - 0.4)) / 0.4
      neonCircle(g, this.px, this.py, O2.burstR * k, WHITE, { width: 3, alpha: 1 - k, bloom: false })
    }
  }

  // ==========================================================================
  // HUD（对应 UI规格 V3 §5）
  // ==========================================================================
  private drawHud(): void {
    const g = this.gHud
    g.clear()
    this.hideTexts()
    const W = this.scale.width
    const cx = W / 2
    const L = this.layer()

    // ① 深度指示（左侧）：玩家必须随时知道"我在第几层、还能下几层"
    const dx0 = 24, dy0 = 30
    this.txt(`L${this.layerIdx + 1} ${L.name}`, dx0, dy0, '17px', TXT.cyber, FONT)
    this.txt(L.sub, dx0, dy0 + 24, '11px', TXT.mute, MONO)
    for (let i = 0; i < LAYERS.length; i++) {
      const yy = dy0 + 48 + i * 20
      const cur = i === this.layerIdx
      const done = i < this.layerIdx
      g.fillStyle(cur ? UI.cyan : (done ? UI.cyanDim : UI.line), cur ? 1 : 0.6)
      g.fillRect(dx0, yy, cur ? 26 : 16, 5)
      if (cur) {
        g.fillStyle(UI.cyan, 0.25)
        g.fillRect(dx0 + 30, yy - 4, 6, 13)
      }
    }
    this.txt(`×${this.mult.toFixed(1)}`, dx0, dy0 + 48 + LAYERS.length * 20 + 6, '14px', TXT.amber, MONO)

    // ② 氧气条（顶部居中，主 HUD）
    //
    // 两段式：剩余氧(实心) | 本层上限被压缩的余量(灰)
    // 分母用 max(基准, 当前上限)，这样买了扩容气瓶后条会**变长**（正反馈可见），
    // 又不会超出槽宽。下潜后上限压缩必须可见地变短——这是玩家理解
    // "越深容错越小"的唯一显式信号（UI规格 V3 §5.2）。
    const bw = 420, bh = 18, bx = cx - bw / 2, by = 26
    const full = Math.max(O2.max, this.o2Max)
    const curRatio = Phaser.Math.Clamp(this.o2 / full, 0, 1)
    const capRatio = Phaser.Math.Clamp(this.o2Max / full, 0, 1)
    const pct = this.o2 / this.o2Max
    const low = pct < 0.2
    const col = low ? UI.danger : (pct < 0.5 ? UI.amber : UI.cyan)
    const pulse = low ? (this.t * 4 % 1 < 0.5 ? 1 : 0.55) : 1

    g.fillStyle(UI.panel, 0.75); g.fillRoundedRect(bx, by, bw, bh, 9)
    if (capRatio < 1) {
      g.fillStyle(UI.line, 0.5); g.fillRoundedRect(bx + bw * capRatio, by, bw * (1 - capRatio), bh, 9)
    }
    g.fillStyle(col, pulse)
    g.fillRoundedRect(bx, by, Math.max(2, bw * curRatio), bh, 9)
    neon(g, low ? UI.danger : UI.cyanDim, () => { g.strokeRoundedRect(bx, by, bw, bh, 9) },
      { width: 1, alpha: 0.8, bloom: false })
    this.txt(`${Math.ceil(this.o2)} / ${this.o2Max}`, cx, by + bh / 2, '20px', TXT.cyber, MONO, 'center')
    // 耗氧速率（越深越快，必须显式告诉玩家）
    this.txt(`-${L.drain.toFixed(1)}/s`, bx - 12, by + 2, '13px', TXT.dim, MONO, 'right')

    // ③ 波次进度
    const wi = this.waveInLayer + 1
    this.txt(`第 ${wi} / ${WAVE_SHAPE.length} 波`, bx + bw + 18, by + 2, '16px', TXT.main, MONO)
    for (let i = 0; i < WAVE_SHAPE.length; i++) {
      const px1 = bx + bw + 18 + i * 16, py1 = by + bh + 6
      // 结算时当前波还没"完成"，所以最后一个点在 result 相位不点亮
      const done = this.phase === 'result' ? i < this.waveInLayer : i <= this.waveInLayer
      g.fillStyle(done ? UI.cyan : UI.line, 1)
      g.fillCircle(px1, py1, 4)
    }
    if (this.phase === 'wave') {
      this.txt(`${Math.max(0, Math.ceil(this.waveTimer))}s`, bx + bw + 18, by + bh + 14, '13px', TXT.dim, MONO)
    }

    // ④ 生物质（含倍率后的预估值，让"再赌一层"的收益可见）
    const est = Math.floor(this.biomass * this.mult)
    this.txt(`生物质 ${this.biomass}`, W - 24, by + 2, '18px', TXT.jade, MONO, 'right')
    if (this.mult > 1) {
      this.txt(`上浮可得 ${est}`, W - 24, by + 26, '13px', TXT.amber, MONO, 'right')
    }

    // ⑤ 装备槽
    const sy = this.scale.height - 46
    for (let i = 0; i < 3; i++) {
      const sx = 24 + i * 52
      g.fillStyle(i === 0 ? UI.panelHi : UI.panel, 0.8)
      g.fillRoundedRect(sx, sy, 44, 44, 8)
      neon(g, i === 0 ? UI.cyan : UI.line, () => { g.strokeRoundedRect(sx, sy, 44, 44, 8) },
        { width: 1, alpha: 0.7, bloom: false })
      if (i === 0) {
        neonLine(g, sx + 10, sy + 22, sx + 34, sy + 22, UI.cyan, { width: 2, bloom: false })
        neonLine(g, sx + 34, sy + 22, sx + 30, sy + 18, UI.cyan, { width: 2, bloom: false })
        neonLine(g, sx + 34, sy + 22, sx + 30, sy + 26, UI.cyan, { width: 2, bloom: false })
      }
    }
    // 技能冷却
    const ready = this.burstTimer <= 0
    const k = ready ? 1 : 1 - this.burstTimer / O2.burstCd
    neonCircle(g, cx, sy + 22, 20, ready ? UI.cyan : UI.cyanDim, { width: 2, bloom: false })
    g.fillStyle(ready ? UI.cyan : UI.cyanDim, 0.25)
    g.fillCircle(cx, sy + 22, 20 * k)
    this.txt(ready ? '空格' : `${Math.ceil(this.burstTimer)}`, cx, sy + 22, '13px',
      ready ? TXT.cyber : TXT.mute, MONO, 'center')

    // 操作提示
    if (this.phase === 'wave') {
      this.txt('WASD 移动 · 武器自动开火 · 空格 排气爆发(-20 O₂)',
        24, this.scale.height - 92, '13px', TXT.mute, FONT)
    }

    if (this.phase === 'shop') this.drawShop(g)
    if (this.phase === 'decide') this.drawDecide(g)
    if (this.phase === 'result') this.drawResult(g)
  }

  // ---- 文字对象池：避免每帧 new Text 造成 GC 抖动 ----
  private hideTexts(): void {
    for (const t of this.txtPool) t.setVisible(false)
  }
  private txt(s: string, x: number, y: number, size: string, color: string,
              font: string, align: 'left' | 'center' | 'right' = 'left'): void {
    let t = this.txtPool.find(o => !o.visible)
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: font, fontSize: size, color })
        .setScrollFactor(0).setDepth(101)
      this.txtPool.push(t)
    }
    t.setText(s).setStyle({ fontFamily: font, fontSize: size, color })
    t.setPosition(x, y).setVisible(true)
    if (align === 'center') t.setOrigin(0.5)
    else if (align === 'right') t.setOrigin(1, 0)
    else t.setOrigin(0)
    t.setStroke('#04070d', 3)
  }

  // ==========================================================================
  // 通用热区
  // ==========================================================================
  private clearHits(): void {
    // 必须销毁锚点矩形：只清数组的话旧热区仍然 alive，
    // 会在下一波/下一局里响应已经看不见的点击（实测踩过同类坑）。
    for (const c of this.shopCards) c.rect.destroy()
    for (const b of this.decideBtns) b.rect.destroy()
    for (const b of this.resultBtns) b.rect.destroy()
    this.shopCards = []
    this.decideBtns = []
    this.resultBtns = []
  }

  /**
   * 登记一个点击热区。
   * hitRouter 需要的是**矩形对象**（沿父容器链换算屏幕坐标），不是裸坐标；
   * 且热区原点在**中心**（判定是 |dx| <= w/2），所以这里传中心点。
   */
  private addHit(cx: number, cy: number, w: number, h: number,
                 onClick: () => void): Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(cx, cy, w, h, 0x000000, 0)
    rect.setScrollFactor(0).setDepth(102)
    registerUiHit(this, { obj: rect, w, h, onClick, alive: () => rect.active })
    return rect
  }

  /** 带悬停高亮的热区：卡片是纯 Graphics 绘制的，hover 态必须手绘 */
  private addHoverHit(cx: number, cy: number, w: number, h: number,
                      onClick: () => void, onHover: (v: boolean) => void)
    : Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(cx, cy, w, h, 0x000000, 0)
    rect.setScrollFactor(0).setDepth(102)
    registerUiHit(this, { obj: rect, w, h, onClick, onHover, alive: () => rect.active })
    return rect
  }

  // ==========================================================================
  // 商店：波间三选一
  // ==========================================================================
  private pool: Upgrade[] = [
    { id: 'dmg', name: '锋利叉尖', desc: '伤害 +6', apply: s => { s.dmg += 6 } },
    { id: 'rate', name: '快速装填', desc: '射速 +22%', apply: s => { s.fireCd *= 0.78 } },
    { id: 'pierce', name: '穿透叉', desc: '穿透 +1', apply: s => { s.pierce += 1 } },
    { id: 'speed', name: '增压推进', desc: '移速 +15%', apply: s => { s.speedMul *= 1.15 } },
    { id: 'pickup', name: '吸附鳍', desc: '拾取范围 +40%', apply: s => { s.pickupMul *= 1.4 } },
    { id: 'tank', name: '扩容气瓶', desc: '氧气上限 +20 并回满', apply: s => { s.o2Bonus += 20; s.o2Max = s.layer().o2Max + s.o2Bonus; s.o2 = s.o2Max } },
    { id: 'gill', name: '循环鳃', desc: '击杀额外回氧 +3', apply: s => { s.killO2 += 3 } },
  ]

  private offers: Upgrade[] = []
  private hoverCard = -1
  private hoverBtn = -1

  private openShop(): void {
    this.phase = 'shop'
    this.hoverCard = -1
    this.offers = Phaser.Utils.Array.Shuffle(this.pool.slice()).slice(0, 3)
    this.clearHits()
  }

  private drawShop(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    g.fillStyle(UI.abyss, 0.72); g.fillRect(0, 0, W, H)

    const cw = 220, ch = 240, gap = 24
    const total = cw * 3 + gap * 2
    const x0 = (W - total) / 2
    const y0 = H / 2 - ch / 2

    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 第 ${this.waveInLayer + 1} 波结束`,
      W / 2, y0 - 56, '18px', TXT.cyber, FONT, 'center')
    this.txt('按 1 / 2 / 3 或点击选择', W / 2, y0 - 28, '13px', TXT.mute, FONT, 'center')

    if (this.shopCards.length === 0) {
      for (let i = 0; i < this.offers.length; i++) {
        const up = this.offers[i]
        const x = x0 + i * (cw + gap), y = y0
        const idx = i
        const rect = this.addHoverHit(x + cw / 2, y + ch / 2, cw, ch,
          () => this.pickUpgrade(up),
          v => { this.hoverCard = v ? idx : (this.hoverCard === idx ? -1 : this.hoverCard) })
        this.shopCards.push({ x, y, w: cw, h: ch, up, rect })
      }
    }

    for (let i = 0; i < this.shopCards.length; i++) {
      const c = this.shopCards[i]
      const hov = this.hoverCard === i
      g.fillStyle(hov ? UI.panelHi : UI.panel, 0.94); g.fillRoundedRect(c.x, c.y, c.w, c.h, 12)
      // 悬停时描边加亮加粗——纯 Graphics 卡片没有自带 hover 态，必须手绘
      neon(g, hov ? UI.cyanHi : UI.cyan, () => { g.strokeRoundedRect(c.x, c.y, c.w, c.h, 12) },
        { width: hov ? 3 : 2, bloom: hov })
      this.txt(String(i + 1), c.x + 16, c.y + 14, '14px', TXT.mute, MONO)
      this.txt(c.up.name, c.x + c.w / 2, c.y + 90, '20px', TXT.cyber, FONT, 'center')
      this.txt(c.up.desc, c.x + c.w / 2, c.y + 128, '15px', TXT.main, FONT, 'center')
      neonCircle(g, c.x + c.w / 2, c.y + 44, 18, UI.cyan, { width: 2, bloom: false })
    }
  }

  private pickUpgrade(up: Upgrade): void {
    if (this.phase !== 'shop') return
    up.apply(this)
    this.clearHits()
    // 注意是 startWave() 而不是 advance()：waveInLayer 已经在 advance 里加过了，
    // 再走 advance 会多跳一波。
    this.startWave()
  }

  // ==========================================================================
  // 层末补给站：下潜 / 上浮（V6 相对 Brotato 的唯一结构增量）
  // ==========================================================================
  private openDecide(): void {
    this.phase = 'decide'
    this.hoverBtn = -1
    this.clearHits()
  }

  /** 继续下潜：扣门票氧气 → 上限压缩 → 收益倍率 +0.5 */
  private diveDeeper(): void {
    if (this.phase !== 'decide') return
    const toll = this.layer().toll
    if (this.o2 <= toll) return       // 氧气不够买门票，只能上浮
    this.layerIdx++
    this.waveInLayer = 0
    this.mult += 0.5
    const L = this.layer()
    this.o2Max = L.o2Max + this.o2Bonus
    this.o2 = Math.min(this.o2 - toll, this.o2Max)
    this.clearHits()
    this.startWave()
  }

  /** 上浮兑现：结算，带走 100% */
  private surface(): void {
    if (this.phase !== 'decide') return
    this.showResult(true)
  }

  private drawDecide(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    g.fillStyle(UI.abyss, 0.80); g.fillRect(0, 0, W, H)

    const pw = Math.min(720, W - 60)
    const ph = Math.min(420, H - 60)
    const x = (W - pw) / 2, y = (H - ph) / 2
    g.fillStyle(UI.panel, 0.96); g.fillRoundedRect(x, y, pw, ph, 14)
    neon(g, UI.cyanDim, () => { g.strokeRoundedRect(x, y, pw, ph, 14) }, { width: 1, alpha: 0.9, bloom: false })

    const toll = this.layer().toll
    const next = LAYERS[Math.min(this.layerIdx + 1, LAYERS.length - 1)]
    const canDive = this.o2 > toll

    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 补给站`,
      W / 2, y + 34, '24px', TXT.cyber, FONT, 'center')
    this.txt('氧气够就继续下潜，收益翻倍；不够就只能带走现有的',
      W / 2, y + 68, '14px', TXT.dim, FONT, 'center')

    // ---- 决策信息：把赌注的三个数字全部摊开 ----
    const infoY = y + 108
    const cols: [string, string, string][] = [
      ['当前氧气', `${Math.ceil(this.o2)} / ${this.o2Max}`, TXT.cyan],
      ['下潜门票', `-${toll} O₂`, TXT.warn],
      ['收益倍率', `×${this.mult.toFixed(1)} → ×${(this.mult + 0.5).toFixed(1)}`, TXT.amber],
    ]
    const colW = pw / 3
    for (let i = 0; i < 3; i++) {
      const ccx = x + colW * i + colW / 2
      this.txt(cols[i][0], ccx, infoY, '13px', TXT.mute, FONT, 'center')
      this.txt(cols[i][1], ccx, infoY + 24, '22px', cols[i][2], MONO, 'center')
      if (i < 2) {
        g.fillStyle(UI.line, 0.7)
        g.fillRect(x + colW * (i + 1), infoY - 6, 1, 58)
      }
    }

    // ---- 下一层的代价预览（让"更紧"是可见的，不是猜的）----
    const riskY = infoY + 66
    g.fillStyle(UI.panelHi, 0.7); g.fillRoundedRect(x + 40, riskY, pw - 80, 62, 10)
    this.txt(`下潜后：L${this.layerIdx + 2} ${next.name}`, x + 60, riskY + 12, '15px', TXT.cyber, FONT)
    this.txt(`氧气上限 ${next.o2Max}`, x + 60, riskY + 36, '13px', TXT.cyan, MONO)
    this.txt(`耗氧 -${next.drain.toFixed(1)}/s`, x + 210, riskY + 36, '13px', TXT.warn, MONO)
    this.txt(`可见度 ${Math.round(next.vis * 100)}%`, x + pw - 300, riskY + 36, '13px', TXT.dim, MONO)
    const visBarW = 120
    g.fillStyle(UI.line, 0.8); g.fillRect(x + pw - 120, riskY + 36, visBarW, 8)
    g.fillStyle(UI.amber, 0.9); g.fillRect(x + pw - 120, riskY + 36, visBarW * next.vis, 8)

    // ---- 两个按钮：必须同尺寸、同权重（UI规格 §5.6）----
    const bwid = Math.min(260, (pw - 80) / 2 - 12), bh = 64
    const byy = y + ph - 96
    if (this.decideBtns.length === 0) {
      const mk = (label: string, sub: string, ox: number, enabled: boolean, act: () => void) => {
        const bx = W / 2 + ox - bwid / 2
        const idx = this.decideBtns.length
        const rect = enabled
          ? this.addHoverHit(bx + bwid / 2, byy + bh / 2, bwid, bh, act,
              v => { this.hoverBtn = v ? idx : (this.hoverBtn === idx ? -1 : this.hoverBtn) })
          : this.addHit(bx + bwid / 2, byy + bh / 2, bwid, bh, () => { /* 氧气不足，禁用 */ })
        this.decideBtns.push({ x: bx, y: byy, w: bwid, h: bh, label, sub, enabled, act, rect })
      }
      mk('继续下潜', canDive ? `1 · 消耗 ${toll} O₂` : '氧气不足 · 只能上浮',
        -(bwid / 2 + 10), canDive, () => this.diveDeeper())
      mk('上浮兑现', `2 · 带走 ${Math.floor(this.biomass * this.mult)}`,
        (bwid / 2 + 10), true, () => this.surface())
    }

    for (let i = 0; i < this.decideBtns.length; i++) {
      const b = this.decideBtns[i]
      const hov = this.hoverBtn === i && b.enabled
      const bcol = i === 0 ? UI.amber : UI.cyan
      g.fillStyle(b.enabled ? (hov ? UI.panelHi : UI.panel) : UI.panel, b.enabled ? 0.95 : 0.6)
      g.fillRoundedRect(b.x, b.y, b.w, b.h, 10)
      neon(g, b.enabled ? bcol : UI.line, () => { g.strokeRoundedRect(b.x, b.y, b.w, b.h, 10) },
        { width: hov ? 3 : 2, bloom: hov })
      this.txt(b.label, b.x + b.w / 2, b.y + 18, '19px',
        b.enabled ? (i === 0 ? TXT.amber : TXT.cyber) : TXT.mute, FONT, 'center')
      this.txt(b.sub, b.x + b.w / 2, b.y + 42, '13px',
        b.enabled ? TXT.dim : TXT.warn, MONO, 'center')
    }
  }

  // ==========================================================================
  // 结算
  // ==========================================================================
  private showResult(win: boolean): void {
    this.win = win
    this.phase = 'result'
    this.clearHits()
  }

  private drawResult(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    g.fillStyle(UI.abyss, 0.85); g.fillRect(0, 0, W, H)
    const pw = Math.min(500, W - 60), ph = 300
    const x = (W - pw) / 2, y = H / 2 - ph / 2
    g.fillStyle(UI.panel, 0.96); g.fillRoundedRect(x, y, pw, ph, 14)
    neon(g, this.win ? UI.cyan : UI.danger, () => { g.strokeRoundedRect(x, y, pw, ph, 14) }, { width: 2, bloom: false })

    // 死亡 = 溺水 = 全损（V6 §3.1）：一分钱都带不走，这是赌的代价
    const finalBio = this.win ? Math.floor(this.biomass * this.mult) : 0

    this.txt(this.win ? (this.bossDown ? '击杀深渊守望者 · 上浮' : '上浮成功') : '氧气耗尽 · 溺水',
      W / 2, y + 40, '24px', this.win ? TXT.cyber : TXT.warn, FONT, 'center')

    this.txt(`带出生物质 ${finalBio}`, W / 2, y + 88, '26px', TXT.jade, MONO, 'center')
    if (this.win && this.mult > 1) {
      this.txt(`${this.biomass} × ${this.mult.toFixed(1)}（下潜 ${this.layerIdx} 层）`,
        W / 2, y + 122, '13px', TXT.amber, MONO, 'center')
    }
    if (!this.win) {
      this.txt(`沉没的 ${Math.floor(this.biomass * this.mult)} 生物质全部损失`,
        W / 2, y + 122, '13px', TXT.warn, MONO, 'center')
    }
    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 第 ${this.waveInLayer + 1} 波`,
      W / 2, y + 152, '14px', TXT.dim, FONT, 'center')

    if (this.resultBtns.length === 0) {
      const bw = Math.min(200, (pw - 60) / 2), bh = 52
      const mk = (label: string, ox: number, act: () => void) => {
        const bx = W / 2 + ox - bw / 2, by = y + ph - 74
        const rect = this.addHit(bx + bw / 2, by + bh / 2, bw, bh, act)
        this.resultBtns.push({ x: bx, y: by, w: bw, h: bh, label, act, rect })
      }
      mk('再来一次', -(bw / 2 + 8), () => this.restart())
      mk('返回主界面', (bw / 2 + 8), () => this.scene.start('title'))
    }
    for (const b of this.resultBtns) {
      g.fillStyle(UI.panelHi, 0.9); g.fillRoundedRect(b.x, b.y, b.w, b.h, 10)
      neon(g, UI.cyan, () => { g.strokeRoundedRect(b.x, b.y, b.w, b.h, 10) }, { width: 1, alpha: 0.8, bloom: false })
      this.txt(b.label, b.x + b.w / 2, b.y + b.h / 2, '17px', TXT.cyber, FONT, 'center')
    }
  }

  private restart(): void {
    this.enemies = []; this.bubbles = []; this.bullets = []
    this.biomass = 0; this.dmg = PLAYER.dmg
    this.fireCd = PLAYER.cd; this.pierce = PLAYER.pierce
    this.speedMul = 1; this.pickupMul = 1; this.killO2 = PLAYER.killO2
    this.burstTimer = 0; this.fireTimer = 0
    this.px = this.scale.width / 2; this.py = this.scale.height / 2
    this.clearHits()
    this.startRun()
  }

  private layout(): void {
    this.clearHits()   // resize 后热区坐标失效，重绘时重建
    this.buildMotes()
  }

  // ==========================================================================
  // 自动化测试探针（无头验证脚本读这些值，不要删）
  // ==========================================================================
  private exposeProbe(): void {
    // 注意：window.__sg 已被 main.ts 占用（挂的是 Phaser.Game 实例）。
    // 这里必须用另一个名字，否则会把 game 实例覆盖掉，
    // 验证脚本里 __sg.scene.getScenes(true) 会直接报错。
    const w = window as unknown as { __dive?: unknown }
    w.__dive = {
      probe: () => ({
        phase: this.phase,
        layer: this.layerIdx + 1,
        layerName: this.layer().name,
        wave: this.waveInLayer + 1,
        o2: Math.round(this.o2),
        o2Max: this.o2Max,
        mult: this.mult,
        enemies: this.enemies.length,
        bubbles: this.bubbles.length,
        biomass: this.biomass,
        boss: this.bossDown,
        bossAlive: this.enemies.some(e => e.kind === 'boss'),
        canDive: this.phase === 'decide' ? this.o2 > this.layer().toll : null,
      }),
      // 无头环境下 JustDown 检测不到同帧的 keyDown+keyUp，
      // 所以直接暴露热区回调给验证脚本调用
      hits: () => (this as unknown as { __uiHitRoutes: { onClick: () => void }[] }).__uiHitRoutes ?? [],
      dive: () => this.diveDeeper(),
      surface: () => this.surface(),
      // 测试专用：立刻清场并推进（否则无头验证要真等 40-55 秒一波）
      skip: () => { this.enemies = []; this.spawnLeft = 0; this.advance() },
      pick: (i: number) => { if (this.offers[i]) this.pickUpgrade(this.offers[i]) },
      refill: () => { this.o2 = this.o2Max },
      hit: (i: number) => {
        const rs = (this as unknown as { __uiHitRoutes: { onClick: () => void }[] }).__uiHitRoutes ?? []
        if (rs[i]) rs[i].onClick()
      },
    }
  }
}
