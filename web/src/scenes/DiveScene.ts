/**
 * 波次制下潜场景（V6 核心玩法原型 / S1）
 *
 * 对应《项目计划书》V6 §3-§4、《美术资源计划》V4 §3、《UI规格》V3 §5。
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
import { neon, neonCircle, neonLine } from '../render/neon'
import { registerUiHit, routeDown, routeMove } from '../ui/hitRouter'

/** 氧气泡专用：全场唯一纯白，在混乱中最先被看见（V4 §3.3） */
const WHITE = 0xffffff

// ---------------------------------------------------------------------------
// 数值表（V6 §4.2）
// ---------------------------------------------------------------------------
const O2 = {
  max: 100,           // L1 上限
  drain: 1.0,         // 每秒消耗
  bubbleValue: 5,     // 单个气泡回氧
  bubbleLife: 6.0,    // 气泡存活秒数
  bubbleBlink: 2.0,   // 最后 N 秒开始闪烁
  dropCapPerWave: 60, // 每波掉落总量上限（硬约束 ②）
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

/** 4 波（L1 阳光带，V6 §3.1 每层 4 波） */
const WAVES = [
  { count: 12, dashRatio: 0.00, hpMul: 1.00, dur: 40 },
  { count: 18, dashRatio: 0.25, hpMul: 1.15, dur: 45 },
  { count: 26, dashRatio: 0.35, hpMul: 1.30, dur: 50 },
  { count: 36, dashRatio: 0.45, hpMul: 1.50, dur: 55 },
]

type Kind = 'swarm' | 'dash'

interface Enemy {
  x: number; y: number
  vx: number; vy: number
  hp: number; maxHp: number
  r: number
  kind: Kind
  color: number
  speed: number
  /** 冲刺类：chase → charge（红色预警）→ dash → rest */
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

export default class DiveScene extends Phaser.Scene {
  constructor() { super('dive') }

  // ---- 玩家状态 ----
  private px = 0
  private py = 0
  private o2 = O2.max
  private o2Max = O2.max
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
  /** 受击闪红计时（氧气被撞时） */
  private hurtFlash = 0

  // ---- 实体池 ----
  private enemies: Enemy[] = []
  private bubbles: Bubble[] = []
  private bullets: Bullet[] = []
  private eid = 0

  // ---- 波次状态机 ----
  private phase: 'wave' | 'shop' | 'result' = 'wave'
  private waveIdx = 0
  private waveTimer = 0
  private spawnLeft = 0
  private spawnTimer = 0
  private droppedThisWave = 0
  private win = false

  // ---- 渲染 / 输入 ----
  private g!: Phaser.GameObjects.Graphics
  private gHud!: Phaser.GameObjects.Graphics
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private shopCards: { x: number; y: number; w: number; h: number; up: Upgrade; rect: Phaser.GameObjects.Rectangle }[] = []
  private resultBtns: { x: number; y: number; w: number; h: number; label: string; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private txtPool: Phaser.GameObjects.Text[] = []
  private t = 0

  create(): void {
    const W = this.scale.width
    const H = this.scale.height
    this.px = W / 2
    this.py = H / 2

    this.g = this.add.graphics().setDepth(10)
    this.gHud = this.add.graphics().setScrollFactor(0).setDepth(100)

    const kb = this.input.keyboard!
    this.keys = {
      up: kb.addKey('W'), down: kb.addKey('S'),
      left: kb.addKey('A'), right: kb.addKey('D'),
      // 数字键选升级
      one: kb.addKey('ONE'), two: kb.addKey('TWO'), three: kb.addKey('THREE'),
      burst: kb.addKey('SPACE'),
      esc: kb.addKey('ESC'),
    }

    // 必须自己把 pointer 事件喂给 hitRouter：registerUiHit 只登记热区、不接管输入。
    // 漏了这两行 = 所有按钮点了都没反应（2026-10-10 实测踩过）。
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => routeDown(this, p))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => routeMove(this, p))

    this.scale.on('resize', () => this.layout())
    this.startWave(0)
  }

  // ==========================================================================
  // 波次
  // ==========================================================================
  private startWave(i: number): void {
    this.waveIdx = i
    const w = WAVES[i]
    this.spawnLeft = w.count
    this.spawnTimer = 0
    this.waveTimer = w.dur
    this.droppedThisWave = 0
    this.phase = 'wave'
    this.clearHits()
  }

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

    const w = WAVES[this.waveIdx]
    const isDash = Math.random() < w.dashRatio
    const kind: Kind = isDash ? 'dash' : 'swarm'
    const hp = Math.round((isDash ? 26 : 14) * w.hpMul)

    this.enemies.push({
      x, y, vx: 0, vy: 0,
      hp, maxHp: hp,
      r: isDash ? 15 : 11,
      kind,
      color: isDash ? UI.magenta : UI.jade,
      speed: isDash ? 96 : 68,
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
    })
    this.eid++
  }

  private updateWave(dt: number): void {
    const w = WAVES[this.waveIdx]
    // 出怪
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
      if (cleared || this.enemies.length === 0) {
        if (this.waveIdx >= WAVES.length - 1) this.showResult(true)
        else this.openShop()
        return
      }
    }
    void w
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
      this.autoFire(dt)
      this.drainOxygen(dt)
      this.updateWave(dt)
    } else {
      // 商店 / 结算：只保留气泡动画，战斗暂停
      this.updateBubbles(dt)
    }

    // 键盘选升级（1/2/3）—— 点击之外的兜底通道，也方便自动化测试
    if (this.phase === 'shop') {
      const K = Phaser.Input.Keyboard
      if (K.JustDown(this.keys.one) && this.offers[0]) this.pickUpgrade(this.offers[0])
      else if (K.JustDown(this.keys.two) && this.offers[1]) this.pickUpgrade(this.offers[1])
      else if (K.JustDown(this.keys.three) && this.offers[2]) this.pickUpgrade(this.offers[2])
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) this.scene.start('title')

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
        this.o2 -= 24 * dt
        this.hurtFlash = 0.25
        // 轻微弹开，避免贴脸站桩
        e.x -= nx * 40 * dt
        e.y -= ny * 40 * dt
      }
    }
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
      this.biomass += 1
      // 硬约束 ②：每波掉落总量有上限
      if (this.droppedThisWave < O2.dropCapPerWave) {
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
    this.o2 -= O2.drain * dt
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false) }
  }

  // ==========================================================================
  // 绘制
  // ==========================================================================
  private draw(): void {
    const g = this.g
    g.clear()

    // 场地边界（L1 阳光带：开阔、明亮）
    const W = this.scale.width, H = this.scale.height
    neon(g, UI.cyanDim, () => { g.strokeRect(12, 12, W - 24, H - 24) }, { width: 1, alpha: 0.35, bloom: false })

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
      const charging = e.kind === 'dash' && e.phase === 'charge'
      const c = charging ? UI.danger : col   // 蓄力期转纯红（V4 §3.4）

      if (e.kind === 'swarm') {
        // 纺锤签名：椭圆 + 三角尾。
        // 尾鳍必须接在**椭圆尾端之外**（沿朝向前进方向的反向），
        // 画在椭圆内部会变成"单眼鱼"，剪影验收过不了（第一版实测）。
        const a = Math.atan2(this.py - e.y, this.px - e.x)
        const ca = Math.cos(a), sa = Math.sin(a)
        const rx = e.r * 1.15, ry = e.r * 0.68
        // 椭圆尾端（背向行进方向的一侧）
        const tx = e.x - ca * rx, ty = e.y - sa * ry
        // 尾鳍向后延伸 10px，上下张开
        const nx2 = -ca, ny2 = -sa
        const px2 = -sa, py2 = ca
        neon(g, c, () => {
          g.beginPath()
          g.moveTo(tx, ty)
          g.lineTo(tx + nx2 * 11 + px2 * 7, ty + ny2 * 11 + py2 * 7)
          g.lineTo(tx + nx2 * 11 - px2 * 7, ty + ny2 * 11 - py2 * 7)
          g.closePath(); g.strokePath()
        }, { width: 2, bloom: false })
        neon(g, c, () => { g.strokeEllipse(e.x, e.y, rx * 2, ry * 2) },
          { width: 2, bloom: lod === 0 })
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
        neonLine(g, px2, py2, px2 - ca * 22, py2 - sa * 22, c, { width: 2, bloom: false })
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

    // ② 氧气条（顶部居中，主 HUD）
    //
    // 三段式：已扣氧(空) | 剩余氧(实心) | 本层上限被压缩的余量(灰)
    // 注意 fill 的终点是 o2Max 而不是 100 —— 下潜后上限压缩必须**可见地**变短，
    // 这是玩家理解"越深容错越小"的唯一显式信号（UI规格 V3 §5.2）。
    const bw = 420, bh = 18, bx = cx - bw / 2, by = 26
    const curRatio = Phaser.Math.Clamp(this.o2 / O2.max, 0, 1)
    const capRatio = Phaser.Math.Clamp(this.o2Max / O2.max, 0, 1)
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

    // ③ 波次进度
    const wi = this.waveIdx + 1
    this.txt(`第 ${wi} / ${WAVES.length} 波`, bx + bw + 18, by + 2, '16px', TXT.main, MONO)
    for (let i = 0; i < WAVES.length; i++) {
      const dx = bx + bw + 18 + i * 16, dy = by + bh + 6
      // 结算时当前波还没"完成"，所以最后一个点在 result 相位不点亮
      const done = this.phase === 'result' ? i < this.waveIdx : i <= this.waveIdx
      g.fillStyle(done ? UI.cyan : UI.line, 1)
      g.fillCircle(dx, dy, 4)
    }
    if (this.phase === 'wave') {
      this.txt(`${Math.max(0, Math.ceil(this.waveTimer))}s`, bx + bw + 18, by + bh + 14, '13px', TXT.dim, MONO)
    }

    // ④ 生物质
    this.txt(`生物质 ${this.biomass}`, W - 24, by + 2, '18px', TXT.jade, MONO, 'right')

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
    this.txt('WASD 移动 · 武器自动开火 · 空格 排气爆发(-20 O₂)',
      24, this.scale.height - 92, '13px', TXT.mute, FONT)

    if (this.phase === 'shop') this.drawShop(g)
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
  // 商店：波间三选一
  // ==========================================================================
  private pool: Upgrade[] = [
    { id: 'dmg', name: '锋利叉尖', desc: '伤害 +6', apply: s => { s.dmg += 6 } },
    { id: 'rate', name: '快速装填', desc: '射速 +22%', apply: s => { s.fireCd *= 0.78 } },
    { id: 'pierce', name: '穿透叉', desc: '穿透 +1', apply: s => { s.pierce += 1 } },
    { id: 'speed', name: '增压推进', desc: '移速 +15%', apply: s => { s.speedMul *= 1.15 } },
    { id: 'pickup', name: '吸附鳍', desc: '拾取范围 +40%', apply: s => { s.pickupMul *= 1.4 } },
    { id: 'tank', name: '扩容气瓶', desc: '氧气上限 +20 并回满', apply: s => { s.o2Max += 20; s.o2 = s.o2Max } },
    { id: 'gill', name: '循环鳃', desc: '击杀额外回氧 +3', apply: s => { s.killO2 += 3 } },
  ]

  private offers: Upgrade[] = []
  private hoverCard = -1

  private openShop(): void {
    this.phase = 'shop'
    this.hoverCard = -1
    this.offers = Phaser.Utils.Array.Shuffle(this.pool.slice()).slice(0, 3)
    this.clearHits()
  }

  private clearHits(): void {
    // 必须销毁锚点矩形：只清数组的话旧热区仍然 alive，
    // 会在下一波/下一局里响应已经看不见的点击（实测踩过同类坑）。
    for (const c of this.shopCards) c.rect.destroy()
    for (const b of this.resultBtns) b.rect.destroy()
    this.shopCards = []
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

  private drawShop(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    g.fillStyle(UI.abyss, 0.72); g.fillRect(0, 0, W, H)

    const cw = 220, ch = 240, gap = 24
    const total = cw * 3 + gap * 2
    const x0 = (W - total) / 2
    const y0 = H / 2 - ch / 2

    this.txt('第 ' + (this.waveIdx + 1) + ' 波结束 · 选择一项强化', W / 2, y0 - 56, '18px', TXT.cyber, FONT, 'center')
    this.txt('按 1 / 2 / 3 或点击选择', W / 2, y0 - 28, '13px', TXT.mute, FONT, 'center')

    if (this.shopCards.length === 0) {
      for (let i = 0; i < this.offers.length; i++) {
        const up = this.offers[i]
        const x = x0 + i * (cw + gap), y = y0
        const rect = this.addHit(x + cw / 2, y + ch / 2, cw, ch, () => this.pickUpgrade(up))
        const idx = i
        // 悬停高亮：卡片是纯 Graphics 绘制的，hitRouter 只给矩形，
        // 所以自己维护一个 hover 索引，由 routeMove 驱动
        registerUiHit(this, {
          obj: rect, w: cw, h: ch, onClick: () => this.pickUpgrade(up),
          onHover: v => { this.hoverCard = v ? idx : (this.hoverCard === idx ? -1 : this.hoverCard) },
          alive: () => rect.active,
        })
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
      // 卡面图形：一个简单几何标记
      neonCircle(g, c.x + c.w / 2, c.y + 44, 18, UI.cyan, { width: 2, bloom: false })
    }
  }

  private pickUpgrade(up: Upgrade): void {
    if (this.phase !== 'shop') return
    up.apply(this)
    this.clearHits()
    this.startWave(this.waveIdx + 1)
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
    const pw = 460, ph = 260
    const x = (W - pw) / 2, y = H / 2 - ph / 2
    g.fillStyle(UI.panel, 0.96); g.fillRoundedRect(x, y, pw, ph, 14)
    neon(g, this.win ? UI.cyan : UI.danger, () => { g.strokeRoundedRect(x, y, pw, ph, 14) }, { width: 2, bloom: false })

    this.txt(this.win ? '上浮成功' : '氧气耗尽 · 溺水', W / 2, y + 46, '26px',
      this.win ? TXT.cyber : TXT.warn, FONT, 'center')
    this.txt(`生物质 ${this.biomass}`, W / 2, y + 96, '20px', TXT.jade, MONO, 'center')
    this.txt(this.win ? `抵达第 ${this.waveIdx + 1} 波` : `倒在第 ${this.waveIdx + 1} 波`,
      W / 2, y + 128, '15px', TXT.dim, FONT, 'center')

    if (this.resultBtns.length === 0) {
      const bw = 200, bh = 52
      const mk = (label: string, ox: number, act: () => void) => {
        const bx = W / 2 + ox - bw / 2, by = y + ph - 78
        const rect = this.addHit(bx + bw / 2, by + bh / 2, bw, bh, act)
        this.resultBtns.push({ x: bx, y: by, w: bw, h: bh, label, act, rect })
      }
      mk('再来一次', -110, () => this.restart())
      mk('返回主界面', 110, () => this.scene.start('title'))
    }
    for (const b of this.resultBtns) {
      g.fillStyle(UI.panelHi, 0.9); g.fillRoundedRect(b.x, b.y, b.w, b.h, 10)
      neon(g, UI.cyan, () => { g.strokeRoundedRect(b.x, b.y, b.w, b.h, 10) }, { width: 1, alpha: 0.8, bloom: false })
      this.txt(b.label, b.x + b.w / 2, b.y + b.h / 2, '17px', TXT.cyber, FONT, 'center')
    }
  }

  private restart(): void {
    this.enemies = []; this.bubbles = []; this.bullets = []
    this.o2 = O2.max; this.o2Max = O2.max
    this.biomass = 0; this.dmg = PLAYER.dmg
    this.fireCd = PLAYER.cd; this.pierce = PLAYER.pierce
    this.speedMul = 1; this.pickupMul = 1; this.killO2 = PLAYER.killO2
    this.burstTimer = 0; this.fireTimer = 0
    this.px = this.scale.width / 2; this.py = this.scale.height / 2
    this.clearHits()
    this.startWave(0)
  }

  private layout(): void {
    this.clearHits()   // resize 后热区坐标失效，重绘时重建
  }
}
