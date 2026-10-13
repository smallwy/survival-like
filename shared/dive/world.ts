/**
 * 潜水战斗循环 · 引擎无关模拟世界
 *
 * ---------------------------------------------------------------------------
 * 这是什么
 * ---------------------------------------------------------------------------
 * 把 `web/src/scenes/DiveScene.ts`（6530 行 Phaser 场景）里**与渲染无关**的部分
 * 抽成一个纯数据 + 纯逻辑的世界对象。两个引擎前端都只做两件事：
 *
 *     world.update(dt, input)                  ← 推进一帧
 *     for (const ev of world.drainEvents()) …  ← 消费事件做表现
 *
 * 然后把 `world` 上的字段（px/py/enemies/bones/o2/…）画出来。
 *
 * ---------------------------------------------------------------------------
 * 三条硬约束（为什么这么设计）
 * ---------------------------------------------------------------------------
 * ① **零引擎依赖**：不 import `cc` / Phaser / Vite。渲染概念（贴图对象、Graphics、
 *    相机、tween）一律不出现；`enemies[].tex` 只是一个**资源 key 字符串**。
 * ② **一切表现走事件**：原代码在 `hurt()` 里直接 `spawnShock/spawnSlash/sparks/floats`
 *    —— 这些全部改成 `emit({t:'hit'|'kill'|'float'|…})`。渲染层自己决定
 *    "一个 hit 事件 = 冲击波 + 击打痕 + 火花 + 飘字"。模拟域因此没有任何
 *    粒子池、没有 lifespan、没有绘制调用。
 * ③ **注入式 dt 与确定性 rng**：原代码用 `this.time.now` / `Math.random()`。
 *    这里 dt 由调用方给（内部 `min(dt, 50ms)` 兜底），随机数走 seed 化 RNG，
 *    于是"同一 seed 跑两遍世界线完全相同"——无头冒烟测试才能断言。
 *
 * ⚠️ 每帧调用顺序（`update`）与 `DiveScene.update` 1686-1821 **严格同序**，
 *    顺序本身就是手感的一部分（例如 `slewTurretAims` 必须在 `movePlayer` 之后、
 *    `autoFire` 之前，否则炮口朝向会滞后一帧）。
 */

import { UI } from '../theme'
import { SUBS } from '../subs'
import type { SubDef } from '../subs'
import type {
  Enemy, Bone, Pulse, Bullet, Echo, Acid, Kind, Weapon, WeaponId,
  Stats, LayerDef, WaveShape, RelicId, SimEvent, InputState, UpgradeDef, ShopTarget,
} from './types'
import {
  O2, BONE_O2, PLAYER, WEAPON_DEF, STAT_CAP, NEW_STATS, RELIC_DEF, RELIC_SLOTS,
  LAYERS, LAYER_WAVES, SEAT_ANGLES_DEG, SEAT_RING_R, TURRET_R, TURRET_SPIN,
  MAX_SEATS, BASE_SEATS, REROLL_BASE, REROLL_STEP, BONE, ENEMY_TEX, TEX_BASE_ROT, weaponFamily,
} from './tables'
import { CARD_POOL } from './pool'
import { Rng, clamp, dist, wrapAngle } from './rng'

export interface WorldOptions {
  /** 逻辑画布宽（Phaser 用 this.scale.width；Cocos 用设计分辨率宽） */
  w: number
  /** 逻辑画布高 */
  h: number
  /** 随机种子。同一 seed ⇒ 完全相同的世界线（无头测试用） */
  seed?: number
  /** 本局潜航器（默认灯艇） */
  sub?: SubDef
  /** 商店卡池（默认完整卡池；测试里可传 `[]` 跳过商店） */
  pool?: UpgradeDef[]
}

/** 单帧最大步长（秒）—— 与 `DiveScene`: `Math.min(deltaMs, 50) / 1000` 一致 */
const MAX_DT = 0.05

export class DiveWorld implements ShopTarget {
  // ---- 画布 ----
  readonly W: number
  readonly H: number

  private rng: Rng
  /** 本帧产生的事件队列（渲染层 drain 后清空） */
  private events: SimEvent[] = []

  // ---- 玩家状态 ----
  px: number
  py: number
  o2 = O2.max
  o2Max = O2.max
  biomass = 0
  /** 朝向（弧度）：艇身朝移动方向，静止时保持上一次 */
  aim = 0
  burstTimer = 0
  st: Stats = NEW_STATS()
  sub: SubDef
  /** 撞击伤害的节流计时（刺鳐） */
  ramT = 0
  relics: RelicId[] = []
  /** 连续未受击时长（「洋流鳍」） */
  noHitT = 0
  /** 受击后闪避加成剩余时长（「静默装甲」） */
  plateT = 0
  hurtFlash = 0
  hurtDirX = 0
  hurtDirY = 0
  hurtDirT = 0
  /** 氧气**显示值**，每帧向真实 o2 缓动（HUD 数字连续滚动） */
  o2Shown = O2.max
  moving = false
  /** 本帧受到的热泉上升推力（HUD 提示用） */
  vpPush = 0
  /** 本层暗流强度（HUD 提示用，0 = 无） */
  vpCur = 0
  /** 「涌流」层的固定入场边（0=上 1=右 2=下 3=左），整层不变 */
  surgeSide = 0
  /** 层入场卡的剩余显示时长（秒） */
  layerCardT = 0

  // ---- 实体池（模拟域） ----
  enemies: Enemy[] = []
  bones: Bone[] = []
  pulses: Pulse[] = []
  bullets: Bullet[] = []
  echoes: Echo[] = []
  acids: Acid[] = []
  weapons: Weapon[] = []
  private eid = 0

  // ---- 进度：5 层 × 4 波 ----
  layerIdx = 0
  waveInLayer = 0
  /** 收益倍率：每下潜一层 +0.5 */
  mult = 1.0
  bossDown = false
  /** 深度显示值（米） */
  depthM = 0

  // ---- 波次状态机 ----
  phase: 'wave' | 'shop' | 'decide' | 'descending' | 'result' = 'wave'
  descT = 0
  descFrom = 0
  descTo = 0
  descDur = 2.1
  waveTimer = 0
  spawnLeft = 0
  spawnTimer = 0
  droppedThisWave = 0
  win = false

  // ---- 商店 ----
  offers: UpgradeDef[] = []
  bank = 0
  locked: boolean[] = [false, false, false]
  sold: boolean[] = [false, false, false]
  rerollCost = 0
  pool: UpgradeDef[]
  /** 可挂载器械上限（4 → 5 → 6，靠扩容卡） */
  maxWeapons = 4

  /** 世界时间（秒）—— 暗流/漂移的相位用它 */
  t = 0

  constructor(opts: WorldOptions) {
    this.W = opts.w
    this.H = opts.h
    this.rng = new Rng(opts.seed ?? 0xc0ffee)
    this.sub = opts.sub ?? SUBS[0]
    this.pool = opts.pool ?? CARD_POOL
    this.px = this.W / 2
    this.py = this.H / 2
    this.o2 = O2.max
    this.o2Max = O2.max
    this.o2Shown = O2.max
    this.startRun()
  }

  // ==========================================================================
  // 事件
  // ==========================================================================
  private emit(e: SimEvent): void { this.events.push(e) }

  /** 取出本帧事件并清空（渲染层每帧调用一次） */
  drainEvents(): SimEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  // ==========================================================================
  // 查询
  // ==========================================================================
  /** 当前层定义。DiveScene.ts:1327 */
  layer(): LayerDef { return LAYERS[this.layerIdx] }
  /** 当前层的 4 波节奏表。DiveScene.ts:1333 */
  waves(): WaveShape[] { return LAYER_WAVES[this.layerIdx] }
  /** 本局是否已装备某个遗物。DiveScene.ts:4846 */
  hasRelic(id: RelicId): boolean { return this.relics.includes(id) }

  // ==========================================================================
  // 进度
  // ==========================================================================
  /** DiveScene.ts:1338-1366 */
  startRun(): void {
    this.layerIdx = 0
    this.waveInLayer = 0
    this.mult = 1.0
    this.bossDown = false
    this.st = NEW_STATS()
    this.st.speed += this.sub.speed
    this.st.pickup += this.sub.pickup
    this.ramT = 0
    this.o2Max = LAYERS[0].o2Max + this.sub.o2Max
    this.o2 = this.o2Max
    this.o2Shown = this.o2Max
    this.maxWeapons = 4 + (this.sub.slots - 4)
    this.hurtDirT = 0
    this.layerCardT = 2.6
    this.weapons = []
    this.bullets = []; this.echoes = []; this.acids = []
    // 开局武器：机关枪（声呐之后仍然可以在商店买到）
    this.addWeapon('gun')
    this.startWave()
  }

  /** DiveScene.ts:1368-1408 */
  startWave(): void {
    const L = this.layer()
    const s = this.waves()[this.waveInLayer]
    this.spawnLeft = Math.round(s.count * L.cntMul)
    this.spawnTimer = 0
    this.waveTimer = s.dur
    this.droppedThisWave = 0
    this.phase = 'wave'
    this.depthM = L.depthTop + (L.depthBot - L.depthTop) * (this.waveInLayer / this.waves().length)

    // —— L5「压力」：每开一波，氧气上限再被压掉一截（下限 40%）——
    if (L.pressure > 0) {
      const floor = LAYERS[this.layerIdx].o2Max * 0.4
      this.o2Max = Math.max(floor, this.o2Max * (1 - L.pressure))
      if (this.o2 > this.o2Max) this.o2 = this.o2Max
    }

    // —— L3「涌流」：本层每一波都从同一个方向涌入 ——
    if (L.surge && this.waveInLayer === 0) {
      this.surgeSide = this.rng.int(0, 3)
    }

    this.emit({ t: 'wave', n: this.waveInLayer, layer: this.layerIdx })

    // L5 最后一波：深渊守望者
    if (this.layerIdx === LAYERS.length - 1 && this.waveInLayer === this.waves().length - 1) {
      this.spawnBoss()
    }
  }

  /**
   * 一波打完后的推进。DiveScene.ts:1415-1424
   *   层内波（1~3 结束）→ 商店三选一 → 下一波
   *   层末波（第 4 波结束）→ 补给站决策（下潜 / 上浮）；最后一层则通关
   */
  advance(): void {
    this.emit({ t: 'waveCleared', layer: this.layerIdx, wave: this.waveInLayer })
    if (this.waveInLayer < this.waves().length - 1) {
      this.waveInLayer++
      this.openShop()
      return
    }
    if (this.layerIdx >= LAYERS.length - 1) { this.showResult(true); return }
    this.openDecide()
  }

  // ==========================================================================
  // 生成
  // ==========================================================================
  /** 这一波该从哪条边刷怪（涌流层永远是同一侧）。DiveScene.ts:1436-1438 */
  pickSpawnSide(): number {
    return this.layer().surge ? this.surgeSide : this.rng.int(0, 3)
  }

  /** DiveScene.ts:1440-1490 */
  spawnEnemy(at?: { x: number; y: number }): void {
    const W = this.W
    const H = this.H
    const m = 60
    let x = at ? at.x : 0
    let y = at ? at.y : 0
    if (!at) {
      const side = this.pickSpawnSide()
      if (side === 0) { x = this.rng.int(0, W); y = -m }
      else if (side === 1) { x = W + m; y = this.rng.int(0, H) }
      else if (side === 2) { x = this.rng.int(0, W); y = H + m }
      else { x = -m; y = this.rng.int(0, H) }
    }

    const L = this.layer()
    const s = this.waves()[this.waveInLayer]
    const hpScale = L.hpMul * s.hpMul

    const r = this.rng.next()
    const dashP = s.dashRatio * L.dashMul
    let kind: Kind
    if (r < L.driftRatio) kind = 'drift'
    else if (r < L.driftRatio + dashP) kind = 'dash'
    else kind = 'swarm'

    const base = kind === 'drift' ? 110 : kind === 'dash' ? 52 : 30
    const hp = Math.round(base * hpScale)
    const relicSpd = this.hasRelic('abyss_mark') ? 1.1 : 1
    const spd = (kind === 'drift' ? 42 : kind === 'dash' ? 96 : 68) * relicSpd

    this.enemies.push({
      x, y, vx: 0, vy: 0, kx: 0, ky: 0,
      hp, maxHp: hp,
      r: kind === 'drift' ? 34 : kind === 'dash' ? 25 : 19,
      kind,
      color: kind === 'drift' ? UI.amber : kind === 'dash' ? UI.magenta : UI.jade,
      speed: spd,
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
      tex: ENEMY_TEX[kind],
      texRot: TEX_BASE_ROT[kind] ?? 0,
    })
    this.eid++
  }

  /**
   * 一次刷怪节拍：有概率刷一整群。返回本次实际刷了几只。
   * DiveScene.ts:1510-1559
   */
  spawnCluster(): number {
    // 群概率随波次上升，上限 0.8
    const groupP = clamp(0.34 + this.waveInLayer * 0.13, 0, 0.8)
    if (this.rng.next() > groupP) { this.spawnEnemy(); return 1 }

    const n = this.rng.int(3 + this.waveInLayer, 5 + this.waveInLayer * 2)
    const W = this.W, H = this.H
    const m = 60
    const side = this.pickSpawnSide()
    let ax = 0, ay = 0
    if (side === 0) { ax = this.rng.int(0, W); ay = -m }
    else if (side === 1) { ax = W + m; ay = this.rng.int(0, H) }
    else if (side === 2) { ax = this.rng.int(0, W); ay = H + m }
    else { ax = -m; ay = this.rng.int(0, H) }

    const ddx = this.px - ax, ddy = this.py - ay
    const dl = Math.max(1, Math.hypot(ddx, ddy))
    const ux = ddx / dl, uy = ddy / dl        // 前向
    const vx = -uy, vy = ux                   // 侧向

    const shape = this.rng.pick(['blob', 'line', 'wedge'] as const)
    const gap = 46

    for (let i = 0; i < n; i++) {
      let f = 0, s = 0                          // 前向 / 侧向偏移
      if (shape === 'blob') {
        f = (this.rng.next() - 0.5) * gap * 2.2
        s = (this.rng.next() - 0.5) * gap * 2.2
      } else if (shape === 'line') {
        s = (i - (n - 1) / 2) * gap
      } else {
        const row = Math.floor(i / 2) + (i === 0 ? 0 : 1)
        f = -row * gap * 0.75
        s = (i === 0 ? 0 : (i % 2 === 1 ? -1 : 1)) * row * gap * 0.55
      }
      this.spawnEnemy({ x: ax + ux * f + vx * s, y: ay + uy * f + vy * s })
    }
    return n
  }

  /** DiveScene.ts:1561-1575 */
  spawnBoss(): void {
    const W = this.W
    const hp = Math.round(1500 * this.layer().hpMul)
    this.enemies.push({
      x: W / 2, y: -90, vx: 0, vy: 0, kx: 0, ky: 0,
      hp, maxHp: hp,
      r: 44, kind: 'boss',
      color: UI.violet,
      speed: 46 * (this.hasRelic('abyss_mark') ? 1.1 : 1),
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
      tex: ENEMY_TEX.boss,
      texRot: TEX_BASE_ROT.dash ?? 0,
    })
  }

  /** DiveScene.ts:1664-1681 */
  updateWave(dt: number): void {
    this.spawnTimer -= dt
    if (this.spawnLeft > 0 && this.spawnTimer <= 0) {
      const n = this.spawnCluster()
      this.spawnLeft = Math.max(0, this.spawnLeft - n)
      this.spawnTimer = 0.22
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
  /**
   * 推进一帧。**子系统调用顺序与 DiveScene.update(1686-1821) 严格一致。**
   * 与渲染有关的步骤（相机跟随、drawEnv/draw/drawHud、弹窗分派、商店立绘显隐）
   * 不在模拟域内 —— 它们由各引擎的渲染层自己做。
   */
  update(rawDt: number, input: InputState = { dx: 0, dy: 0, burst: false }): void {
    const dt = Math.min(rawDt, MAX_DT)
    this.t += dt

    if (this.hurtFlash > 0) this.hurtFlash -= dt
    if (this.hurtDirT > 0) this.hurtDirT -= dt
    if (this.layerCardT > 0) this.layerCardT -= dt
    if (this.ramT > 0) this.ramT -= dt
    // 氧气显示值补间（指数逼近，8/s）
    this.o2Shown += (this.o2 - this.o2Shown) * Math.min(1, dt * 8)
    if (Math.abs(this.o2 - this.o2Shown) < 0.05) this.o2Shown = this.o2

    if (this.phase === 'descending') {
      this.descT += dt
      const k = Math.min(1, this.descT / this.descDur)
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2   // easeInOutQuad
      this.depthM = this.descFrom + (this.descTo - this.descFrom) * e
      if (k >= 1) { this.phase = 'wave'; this.startWave() }
    } else if (this.phase === 'wave') {
      this.movePlayer(dt, input)
      // 转塔必须在 movePlayer 之后（座圈世界坐标依赖本帧的 px/py/aim），
      // 又必须在 autoFire 之前（开火时读的就是这一帧算好的炮口朝向）。
      this.slewTurretAims(dt)
      this.updateEnemies(dt)
      this.updatePulses(dt)
      this.updateBullets(dt)
      this.updateEchoes(dt)
      this.updateAcids(dt)
      this.updateBones(dt)
      this.autoFire(dt)
      this.drainOxygen(dt)
      this.updateWave(dt)
      // 遗物的"状态类"计时器：必须每帧推进
      this.noHitT += dt
      if (this.plateT > 0) this.plateT -= dt
    } else {
      // 商店 / 决策 / 结算：战斗暂停，只保留鱼骨漂流（它会被同帧的
      // `updateBones` 顺带把死亡的敌人从数组里压掉）。
      this.updateBones(dt)
    }
  }

  // ==========================================================================
  // 玩家
  // ==========================================================================
  /** DiveScene.ts:1823-1884 */
  movePlayer(dt: number, input: InputState): void {
    const W = this.W, H = this.H
    const dx = clamp(input.dx, -1, 1)
    const dy = clamp(input.dy, -1, 1)
    const spdMul = 1 + this.st.speed
      + (this.hasRelic('current_fin') && this.noHitT >= 3 ? 0.3 : 0)
    if (dx || dy) {
      const l = Math.hypot(dx, dy)
      this.aim = Math.atan2(dy, dx)
      this.px += (dx / l) * PLAYER.speed * spdMul * dt
      this.py += (dy / l) * PLAYER.speed * spdMul * dt
      this.moving = true
    } else {
      this.moving = false
    }

    // 热泉上升流（L4 ventPush）：**加速度**而不是速度偏移
    const push = this.layer().ventPush
    if (push > 0) {
      const grad = 1 + (this.py / H) * 0.8
      this.py -= push * grad * dt
      this.vpPush = push * grad
    } else {
      this.vpPush = 0
    }

    // L2「暗流」：玩家吃**一半**强度（敌人吃满）
    const cur = this.layer().current
    if (cur > 0) {
      this.px += Math.cos(this.t * 0.28) * cur * 0.5 * dt
      this.py += Math.sin(this.t * 0.28) * cur * 0.5 * dt
    }
    this.vpCur = cur

    this.px = clamp(this.px, 24, W - 24)
    this.py = clamp(this.py, 24, H - 24)

    // 排气爆发（边沿触发）
    this.burstTimer -= dt
    if (input.burst && this.burstTimer <= 0 && this.o2 > O2.burstCost) {
      this.o2 -= O2.burstCost
      this.burstTimer = O2.burstCd
      this.emit({ t: 'burst', x: this.px, y: this.py, r: O2.burstR })
      for (const e of this.enemies) {
        if (dist(this.px, this.py, e.x, e.y) <= O2.burstR) this.hurt(e, 40)
      }
    }
  }

  // ==========================================================================
  // 敌人 AI
  // ==========================================================================
  /** DiveScene.ts:1886-1977 */
  updateEnemies(dt: number): void {
    const dx0 = this.px, dy0 = this.py
    const cur = this.layer().current
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.flash > 0) e.flash -= dt
      const d = dist(e.x, e.y, dx0, dy0) || 1
      const nx = (dx0 - e.x) / d, ny = (dy0 - e.y) / d

      // L2「暗流」：加在敌人身上（敌人吃满）
      if (cur > 0 && e.kind !== 'boss') {
        e.x += Math.cos(this.t * 0.28) * cur * dt
        e.y += Math.sin(this.t * 0.28) * cur * dt
      }

      if (e.kind === 'swarm') {
        e.x += nx * e.speed * dt
        e.y += ny * e.speed * dt
      } else if (e.kind === 'drift') {
        // 水母：脉冲式漂移（一鼓一缩）
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

      // 击退积分与衰减（命中推离玩家的位移，指数衰减归零）
      if (e.kx !== 0 || e.ky !== 0) {
        e.x += e.kx * dt
        e.y += e.ky * dt
        const dec = Math.exp(-9 * dt)
        e.kx *= dec; e.ky *= dec
        if (Math.abs(e.kx) < 2) e.kx = 0
        if (Math.abs(e.ky) < 2) e.ky = 0
      }

      // 接触伤害：氧气就是血条。贴着不放 = 24 氧/秒
      if (d < e.r + PLAYER.r) {
        // 刺鳐的撞击伤害（节流 0.25s）
        if (this.sub.ram > 0 && this.ramT <= 0) {
          this.ramT = 0.25
          this.hurt(e, this.sub.ram)
        }
        // 护甲在这里生效：持续磨损按乘算减免。闪避**不参与**持续伤害。
        this.o2 -= (e.kind === 'boss' ? 34 : 24) * dt * (1 - this.st.armor)
        this.hurtFlash = 0.25
        this.noHitT = 0
        this.plateT = 1.5
        // nx/ny 是「敌人 → 玩家」，取反才是伤害的来向
        this.hurtDirX = -nx; this.hurtDirY = -ny; this.hurtDirT = 0.45
        // 轻微弹开，避免贴脸站桩
        e.x -= nx * 40 * dt
        e.y -= ny * 40 * dt
      }
    }
  }

  /** 对玩家造成一次**一次性**打击（Boss 震击）。DiveScene.ts:1985-2002 */
  damagePlayer(amount: number, dirX: number, dirY: number): void {
    const dodge = Math.min(0.9, this.st.dodge + (this.plateT > 0 ? 0.4 : 0))
    if (this.rng.chance(dodge)) {
      this.emit({ t: 'dodge', x: this.px, y: this.py })
      this.emit({ t: 'float', x: this.px, y: this.py - 34, text: '闪避', color: UI.cyanHi, size: 16 })
      this.plateT = 1.5
      return
    }
    const d = amount * (1 - this.st.armor)
    this.o2 -= d
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false); return }
    this.hurtFlash = 0.35
    this.noHitT = 0
    this.plateT = 1.5
    this.hurtDirX = dirX; this.hurtDirY = dirY; this.hurtDirT = 0.6
    this.emit({ t: 'playerHurt', dirX, dirY, amount: d })
    this.emit({ t: 'float', x: this.px, y: this.py - 30, text: `-${Math.round(d)}`, color: UI.danger, size: 16 })
  }

  /** DiveScene.ts:2005-2014 */
  bossSlam(e: Enemy): void {
    const R = 220
    if (dist(this.px, this.py, e.x, e.y) <= R) {
      const dx = e.x - this.px, dy = e.y - this.py
      const len = Math.max(1, Math.hypot(dx, dy))
      this.damagePlayer(18, dx / len, dy / len)
    }
    this.emit({ t: 'shake', ms: 220, intensity: 0.008 })
  }

  /** 声呐脉冲：波前向外扩散。DiveScene.ts:2021-2051 */
  updatePulses(dt: number): void {
    for (const p of this.pulses) {
      if (!p.alive) continue
      p.r += PLAYER.pulseSpeed * dt
      if (p.r > p.maxR) { p.alive = false; continue }
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.alive || p.hit.has(i)) continue
        const d = dist(p.x, p.y, e.x, e.y)
        // 波前是一条有厚度的环带
        if (Math.abs(d - p.r) < p.width * 0.5 + e.r) {
          p.hit.add(i)
          e.flash = 0.08
          this.hurt(e, p.dmg)
          // 共振炮：命中后向**邻近敌人**弹射 40% 伤害
          if (p.resonant) {
            let best: Enemy | null = null, bd = 150
            for (const o of this.enemies) {
              if (!o.alive || o === e) continue
              const dd = dist(e.x, e.y, o.x, o.y)
              if (dd < bd) { bd = dd; best = o }
            }
            if (best) { best.flash = 0.06; this.hurt(best, p.dmg * 0.4) }
          }
        }
      }
    }
    this.pulses = this.pulses.filter(p => p.alive)
  }

  /** 回声标记：倒计时归零 → 范围爆发（半径 130）。DiveScene.ts:2054-2060 */
  updateEchoes(dt: number): void {
    for (const e of this.echoes) {
      e.t -= dt
      if (e.t <= 0) this.explode(e.x, e.y, 130, e.dmg)
    }
    this.echoes = this.echoes.filter(e => e.t > 0)
  }

  /** 酸液云：每 0.35s 结算一次，本体持续 3s。DiveScene.ts:2063-2079 */
  updateAcids(dt: number): void {
    for (const a of this.acids) {
      a.life -= dt
      a.tick -= dt
      if (a.tick <= 0) {
        a.tick = 0.35
        for (const e of this.enemies) {
          if (!e.alive) continue
          if (dist(a.x, a.y, e.x, e.y) < a.r + e.r) {
            e.flash = 0.05
            this.hurt(e, a.dmg)
          }
        }
      }
    }
    this.acids = this.acids.filter(a => a.life > 0)
  }

  /**
   * 对一条敌人造成一次伤害。**所有伤害都必须走这个函数**
   * （声呐波前 / 机关枪弹 / 鱼雷直击与爆炸 / 电弧链击 / 撞角 / 排气爆发）。
   * 属性加成（伤害 % / 暴击）放在这层，新加伤害来源自动吃到加成。
   * DiveScene.ts:2089-2185
   */
  hurt(e: Enemy, dmg: number): void {
    const crit = this.rng.chance(this.st.crit)
    let d = dmg * this.dmgMulNow()
    if (crit) d *= 1 + this.st.critMul
    e.hp -= d
    e.flash = Math.max(e.flash, 0.09)
    let nx = 0, ny = 0
    if (e.kind !== 'boss') {
      const kd = e.kind === 'drift' ? 46 : 120
      const dd = dist(e.x, e.y, this.px, this.py) || 1
      nx = (e.x - this.px) / dd; ny = (e.y - this.py) / dd
      e.kx += nx * kd
      e.ky += ny * kd
    }
    // 命中事件（渲染层据此画：冲击波 + 击打痕 + 迸溅火星 + 飘字）
    this.emit({ t: 'hit', x: e.x, y: e.y, r: e.r, color: crit ? UI.violet : e.color, crit, dmg: d, nx, ny })
    if (crit) {
      // 命中震屏：只给暴击（普通命中频率太高，每次都震会变廉价且让人晕）
      this.emit({ t: 'shake', ms: 90, intensity: 0.0022 })
      e.flash = 0.14
      this.emit({ t: 'float', x: e.x, y: e.y - e.r - 14, text: `暴击 ${Math.round(d)}`, color: UI.violet, size: 17 })
      // 共振核心：暴击溅射到最近的另一只
      if (this.hasRelic('resonance_core')) {
        let best: Enemy | null = null, bd = 220
        for (const o of this.enemies) {
          if (!o.alive || o === e) continue
          const dd = dist(e.x, e.y, o.x, o.y)
          if (dd < bd) { bd = dd; best = o }
        }
        if (best) {
          best.hp -= d * 0.4
          best.flash = 0.1
          this.emit({ t: 'hit', x: best.x, y: best.y, r: best.r, color: UI.violet, crit: true, dmg: d * 0.4, nx: 0, ny: 0 })
        }
      }
    } else {
      this.emit({ t: 'float', x: e.x, y: e.y - e.r - 12, text: `${Math.round(d)}`, color: 0xe8f4ff, size: 12 })
    }
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.biomass += e.kind === 'boss' ? 20 : 1
      if (e.kind === 'boss') this.bossDown = true
      this.emit({ t: 'kill', x: e.x, y: e.y, r: e.r, color: e.color, kind: e.kind })
      this.dropBone(e)
      // 击杀回氧（深潜者 ×1.5 与「骨殖转化」×2 相乘）
      const kO2 = this.st.killO2 * this.sub.killO2Mul * (this.hasRelic('osteoblast') ? 2 : 1)
      if (kO2 > 0) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + kO2)
        if (this.o2 - before > 0.5) {
          this.emit({ t: 'float', x: e.x, y: e.y - e.r - 6, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 15 })
        }
      }
      if (e.kind === 'boss') {
        this.emit({ t: 'float', x: e.x, y: e.y - 40, text: 'BOSS 击破', color: UI.violet, size: 24 })
      }
    }
  }

  /** 掉鱼骨。硬约束 ②：每波掉落总量有上限（Boss 不受限）。DiveScene.ts:2239-2261 */
  dropBone(e: Enemy): void {
    const isBoss = e.kind === 'boss'
    const size = isBoss ? 44 : clamp(e.r * 1.7, 14, 30)
    const o2 = isBoss ? 24 : Math.max(2, Math.round(BONE_O2.o2Base * (size / 18)))
    const coin = isBoss ? 24 : Math.max(3, Math.round(4 * (size / 18)))
    if (!isBoss && this.droppedThisWave >= this.layer().dropCap) return
    this.droppedThisWave += coin
    const a = this.rng.next() * Math.PI * 2
    const sp = 30 + this.rng.next() * 45
    this.bones.push({
      x: e.x, y: e.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
      fade: O2.boneFade, o2, coin, size,
      rot: a, spin: (this.rng.next() - 0.5) * 1.6,
      alive: true,
    })
  }

  /**
   * 鱼骨漂流 + 拾取。顺带把死亡的敌人从数组里压掉
   * （原实现就是在这里 `filter(e => e.alive)`，保持同序）。DiveScene.ts:2290-2365
   */
  updateBones(dt: number): void {
    const pr = O2.pickupR * (1 + this.st.pickup + (this.hasRelic('tidal_compass') ? 0.8 : 0))
    const H = this.H
    for (const b of this.bones) {
      if (!b.alive) continue
      const dpx = this.px - b.x, dpy = this.py - b.y
      const dp = Math.hypot(dpx, dpy)
      const pulled = dp < pr * 1.7 && dp > 1
      if (pulled) {
        b.vx += (dpx / dp) * 380 * dt
        b.vy += (dpy / dp) * 380 * dt
      }
      b.vy += 34 * dt
      if (!pulled && b.vy > O2.boneSinkV) b.vy = O2.boneSinkV
      if (!pulled) b.vx *= 0.94                    // 水阻
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.rot += b.spin * dt
      b.spin *= 0.985
      if (!pulled && b.y >= H - O2.boneFloor) {
        b.y = H - O2.boneFloor
        b.vy = 0; b.vx = 0
        b.fade -= dt
        if (b.fade <= 0) { b.alive = false; continue }
      }
      if (dist(b.x, b.y, this.px, this.py) < pr) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + b.o2)
        const gained = this.o2 - before
        b.alive = false
        const coin = Math.round(b.coin * this.boneValueMul())
        this.bank += coin
        this.emit({ t: 'pickup', x: b.x, y: b.y, o2: b.o2, coin })
        if (gained > 0.5) {
          this.emit({ t: 'float', x: b.x, y: b.y - 8, text: `+${Math.round(gained)} O₂`, color: UI.cyan, size: 17 })
        } else {
          this.emit({ t: 'float', x: b.x, y: b.y - 8, text: '氧气已满', color: UI.cyanDim, size: 14 })
        }
        this.emit({ t: 'float', x: b.x, y: b.y - 26, text: `+${coin} 骨`, color: BONE, size: 14 })
      }
    }
    this.bones = this.bones.filter(b => b.alive)
    this.enemies = this.enemies.filter(e => e.alive)
  }

  /** 索敌：射程内最近的敌人（`ox/oy` 可选原点）。DiveScene.ts:2396-2404 */
  nearestEnemy(range: number, ox: number = this.px, oy: number = this.py): Enemy | null {
    let best: Enemy | null = null, bd = range
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = dist(ox, oy, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  // ==========================================================================
  // 器械
  // ==========================================================================
  /** 按等级算器械实际数值。DiveScene.ts:2407-2415 */
  weaponStats(id: WeaponId, lvl: number): { iv: number; dmg: number; range: number } {
    const d = WEAPON_DEF[id]
    const k = lvl - 1
    return {
      iv: d.iv / (1 + k * 0.12),
      dmg: d.dmg * (1 + k * 0.35),
      range: d.range + k * 26,
    }
  }

  /** 挂载一台器械（槽位没满就占新槽；满了才走合并升级）。DiveScene.ts:2428-2442 */
  addWeapon(id: WeaponId, lvl = 1): void {
    const st = this.weaponStats(id, lvl)
    if (this.weapons.length >= this.maxWeapons) {
      const exist = this.weapons.find(w => w.id === id && w.lvl < 5)
      if (exist) {
        exist.lvl = Math.min(5, exist.lvl + 1)
        const s2 = this.weaponStats(id, exist.lvl)
        exist.iv = s2.iv; exist.dmg = s2.dmg
        return
      }
      this.weapons.shift()
    }
    this.weapons.push({
      id, iv: st.iv, timer: 0, dmg: st.dmg, lvl, anchor: 0,
      ivLast: st.iv, fireFlash: 0, aimAng: this.aim,
    })
  }

  /** 进化（V6.17）：进化 = **改机制**，不是加数值。DiveScene.ts:2451-2461 */
  evolveWeapon(from: WeaponId, to: WeaponId): void {
    const w = this.weapons.find(x => x.id === from)
    if (!w) return
    const st = this.weaponStats(to, w.lvl)
    w.id = to
    w.iv = st.iv
    w.dmg = st.dmg
    w.timer = 0
    w.ivLast = st.iv
    w.fireFlash = 0.25
  }

  /** 武器槽位 → 座圈座位分配表。DiveScene.ts:2477-2486 */
  mountPlan(): Array<{ ang: number; ext: boolean }> {
    const plan: Array<{ ang: number; ext: boolean }> = []
    for (let i = 0; i < this.weapons.length && i < MAX_SEATS; i++) {
      plan.push({
        ang: SEAT_ANGLES_DEG[i] * Math.PI / 180,
        ext: i >= BASE_SEATS,
      })
    }
    return plan
  }

  /** 第 i 座塔座的世界坐标。DiveScene.ts:2489-2496 */
  seatPos(i: number): { x: number; y: number } | null {
    const slot = this.mountPlan()[i]
    if (!slot) return null
    const ca = Math.cos(this.aim), sa = Math.sin(this.aim)
    const sx = SEAT_RING_R * Math.cos(slot.ang)
    const sy = SEAT_RING_R * Math.sin(slot.ang)
    return { x: this.px + sx * ca - sy * sa, y: this.py + sx * sa + sy * ca }
  }

  /** 第 i 座在射程内最近的目标（以**塔座**为原点）。DiveScene.ts:2499-2507 */
  seatTarget(i: number): { tgt: Enemy | null; rng: number } | null {
    const w = this.weapons[i]
    const p = this.seatPos(i)
    if (!w || !p) return null
    const def = WEAPON_DEF[w.id]
    const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
    return { tgt: this.nearestEnemy(rng, p.x, p.y), rng }
  }

  /**
   * 发射器独立索敌（V6.26）：每座塔从**自己座位**出发锁定最近敌人，
   * 以 TURRET_SPIN 的角速度转过去；无目标就回到艇首方向待机。
   * DiveScene.ts:2522-2537
   */
  slewTurretAims(dt: number): void {
    for (let i = 0; i < this.weapons.length; i++) {
      const w = this.weapons[i]
      const st = this.seatTarget(i)
      if (!st) continue
      const p = this.seatPos(i)!
      const want = st.tgt
        ? Math.atan2(st.tgt.y - p.y, st.tgt.x - p.x)
        : this.aim
      const rel = wrapAngle(want - w.aimAng)
      const step = clamp(rel * Math.min(1, dt * 14), -TURRET_SPIN * dt, TURRET_SPIN * dt)
      w.aimAng = wrapAngle(w.aimAng + step)
    }
  }

  /** 第 i 台器械的炮塔位姿（世界坐标 + 实际朝向）。DiveScene.ts:2554-2561 */
  turretPose(i: number): { x: number; y: number; ang: number } | null {
    const slot = this.mountPlan()[i]
    const w = this.weapons[i]
    if (!slot || !w) return null
    const p = this.seatPos(i)
    if (!p) return null
    return { x: p.x, y: p.y, ang: w.aimAng }
  }

  /** 全部器械升一级（「弹药改良」）。DiveScene.ts:2564-2570 */
  levelAllWeapons(): void {
    for (const w of this.weapons) {
      w.lvl = Math.min(5, w.lvl + 1)
      const s = this.weaponStats(w.id, w.lvl)
      w.iv = s.iv; w.dmg = s.dmg
    }
  }

  /** 多器械同时开火。DiveScene.ts:2576-2708 */
  autoFire(dt: number): void {
    const plan = this.mountPlan()
    for (let wi = 0; wi < this.weapons.length; wi++) {
      const w = this.weapons[wi]
      w.timer = Math.max(0, w.timer - dt)
      w.fireFlash = Math.max(0, w.fireFlash - dt)
      if (w.timer > 0) continue
      const def = WEAPON_DEF[w.id]
      const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
      const seatBoost = (plan[wi]?.ext) ? (1 + this.st.twinRate) : 1
      const pose = this.turretPose(wi)
      const MUZ = TURRET_R * 1.05

      const fam = weaponFamily(w.id)
      const wcol = WEAPON_DEF[w.id].color

      if (fam === 'sonar') {
        if (!this.nearestEnemy(rng)) continue
        this.pulses.push({
          x: pose ? pose.x : this.px, y: pose ? pose.y : this.py,
          r: PLAYER.r * 0.6, maxR: rng,
          dmg: w.dmg, width: PLAYER.pulseWidth,
          hit: new Set<number>(), alive: true,
          resonant: w.id === 'sonar_rs',
        })
      } else if (fam === 'gun') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        const pellets = w.id === 'gun_sg' ? 5 : 1
        const spread = 0.36
        const spd = w.id === 'gun_gl' ? 640 : 780
        for (let p = 0; p < pellets; p++) {
          const a = pellets > 1
            ? base + (p / (pellets - 1) - 0.5) * spread * 2
            : base + (this.rng.next() - 0.5) * 0.05
          this.bullets.push({
            x: ox, y: oy,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            life: rng / spd, dmg: w.dmg, kind: 'gun',
            hit: new Set<number>(), alive: true,
          })
        }
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol })
      } else if (fam === 'torpedo') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        const pellets = w.id === 'torp_cl' ? 3 : 1
        const spread = 0.26
        for (let p = 0; p < pellets; p++) {
          const a = pellets > 1
            ? base + (p / (pellets - 1) - 0.5) * spread * 2
            : base
          this.bullets.push({
            x: ox, y: oy,
            vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
            life: 3.0, dmg: w.dmg, kind: 'torpedo',
            hit: new Set<number>(), alive: true,
            er: w.id === 'torp_hv' ? 1.5 : 1,
          })
        }
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol })
      } else if (fam === 'harpoon') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.bullets.push({
          x: ox, y: oy,
          vx: Math.cos(base) * 900, vy: Math.sin(base) * 900,
          life: rng / 900, dmg: w.dmg, kind: 'harpoon',
          hit: new Set<number>(), alive: true,
        })
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol })
      } else if (fam === 'echo') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const LEAD = 0.5, DLY = 0.75
        const ex = e.x + e.vx * DLY * LEAD
        const ey = e.y + e.vy * DLY * LEAD
        this.echoes.push({ x: ex, y: ey, t: DLY, dmg: w.dmg })
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol })
      } else if (fam === 'acid') {
        const e = this.nearestEnemy(rng); if (!e) continue
        this.acids.push({ x: e.x, y: e.y, r: 62, life: 3.0, tick: 0, dmg: w.dmg })
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol })
      } else {
        const first = this.nearestEnemy(rng); if (!first) continue
        this.fireArc(first, w, pose)
      }
      // 射速：高压供能（st.rate）在这里生效；记下这一发的**实际间隔**
      w.ivLast = def.iv / ((1 + (w.lvl - 1) * 0.12) * seatBoost * (1 + this.st.rate))
      w.timer = w.ivLast
      w.fireFlash = 0.15
    }
  }

  /** 链式电弧：从 first 往后跳。DiveScene.ts:2713-2737 */
  fireArc(first: Enemy, w: Weapon, pose: { x: number; y: number; ang: number } | null = null): void {
    const chain = w.id === 'arc_st' ? 99
      : 2 + w.lvl + (w.id === 'arc_ov' ? 4 : 0)
    const pts = [{ x: pose ? pose.x : this.px, y: pose ? pose.y : this.py }]
    const hit = new Set<Enemy>()
    let cur: Enemy | null = first
    while (cur && hit.size < chain) {
      hit.add(cur)
      pts.push({ x: cur.x, y: cur.y })
      cur.flash = 0.08
      this.hurt(cur, w.dmg)
      let next: Enemy | null = null, bd = 190
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e)) continue
        const d = dist(cur.x, cur.y, e.x, e.y)
        if (d < bd) { bd = d; next = e }
      }
      cur = next
    }
    this.emit({ t: 'arc', pts })
  }

  /** 通用弹更新：机关枪直线、鱼雷追踪 + 命中爆炸。DiveScene.ts:2740-2791 */
  updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) continue
      b.life -= dt
      if (b.life <= 0) { b.alive = false; continue }

      if (b.kind === 'torpedo') {
        const tgt = this.nearestEnemy(WEAPON_DEF.torpedo.range)
        if (tgt) {
          const want = Math.atan2(tgt.y - b.y, tgt.x - b.x)
          const cur = Math.atan2(b.vy, b.vx)
          // 转向速率有上限，否则鱼雷会像狗一样贴着敌人抽搐
          const diff = clamp(wrapAngle(want - cur), -3.6 * dt, 3.6 * dt)
          const na = cur + diff
          const sp = Math.hypot(b.vx, b.vy)
          b.vx = Math.cos(na) * sp
          b.vy = Math.sin(na) * sp
        }
      }

      b.x += b.vx * dt
      b.y += b.vy * dt
      const W = this.W, H = this.H
      if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) { b.alive = false; continue }

      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.alive || b.hit.has(i)) continue
        if (dist(b.x, b.y, e.x, e.y) < e.r + 6) {
          b.hit.add(i)
          e.flash = 0.08
          this.hurt(e, b.dmg)
          // 爆炸半径吃 er：重型鱼雷 1.5 倍
          if (b.kind === 'torpedo') { this.explode(b.x, b.y, 120 * (b.er ?? 1), b.dmg * 0.6); b.alive = false; break }
          // 鱼叉：穿透（不销毁）+ 把命中的鱼**拉向玩家**
          if (b.kind === 'harpoon') {
            const dd = dist(e.x, e.y, this.px, this.py) || 1
            e.kx -= (e.x - this.px) / dd * 300
            e.ky -= (e.y - this.py) / dd * 300
          }
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.alive)
  }

  /** 鱼雷爆炸：范围伤害随距离衰减。DiveScene.ts:2955-2988 */
  explode(x: number, y: number, r: number, dmg: number): void {
    this.emit({ t: 'shake', ms: 130, intensity: 0.006 })
    this.emit({ t: 'blast', x, y, r })
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = dist(x, y, e.x, e.y)
      if (d < r + e.r) {
        e.flash = 0.08
        const falloff = 1 - clamp(d / (r + e.r), 0, 1) * 0.5
        this.hurt(e, dmg * falloff)
      }
    }
  }

  /** 层基础耗氧 − 循环泵回氧 + 贪食腺体代谢代价。DiveScene.ts:3107-3117 */
  drainOxygen(dt: number): void {
    let net = this.layer().drain
    if (this.hasRelic('gluttony')) net += 0.6
    net -= this.st.regen
    this.o2 -= net * dt
    if (this.o2 > this.o2Max) this.o2 = this.o2Max
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false) }
  }

  // ==========================================================================
  // 属性与遗物
  // ==========================================================================
  /** 加一点属性（唯一入口，上限只在这里钳一次）。DiveScene.ts:4840-4843 */
  addStat(k: keyof Stats, v: number): void {
    const cap = STAT_CAP[k]
    this.st[k] = cap === undefined ? this.st[k] + v : Math.min(cap, this.st[k] + v)
  }

  /** 遗物的"代价"在这里生效。DiveScene.ts:4855-4863 */
  equipRelic(id: RelicId): void {
    if (this.relics.includes(id) || this.relics.length >= RELIC_SLOTS) return
    this.relics.push(id)
    const r = RELIC_DEF[id]
    if (r.onEquip) this.addStat(r.onEquip.stat, r.onEquip.delta)
    this.o2Max = this.layer().o2Max + this.st.o2Bonus
    if (this.o2 > this.o2Max) this.o2 = this.o2Max
  }

  /** 这个遗物的条件**此刻**是否满足（HUD 呼吸光用）。DiveScene.ts:4872-4880 */
  relicActive(id: RelicId): boolean {
    switch (id) {
      case 'echo_heart': return this.o2 / this.o2Max < 0.3
      case 'current_fin': return this.noHitT >= 3
      case 'silent_plating': return this.plateT > 0
      case 'abyss_mark': return this.layerIdx > 0
      default: return false
    }
  }

  /** 鱼骨换钱的倍率（只影响钱，不影响回氧）。DiveScene.ts:4883-4887 */
  boneValueMul(): number {
    return 1 + this.st.luck
      + (this.hasRelic('tidal_compass') ? 0.3 : 0)
      + (this.hasRelic('gluttony') ? 1 : 0)
  }

  /** 动态伤害加成（逐帧变化的那些：回声心脏 / 深潜印记）。DiveScene.ts:4895-4904 */
  dmgMulNow(): number {
    let m = (1 + this.st.dmg) * this.sub.dmgMul
    if (this.hasRelic('echo_heart') && this.o2 / this.o2Max < 0.3) m *= 1.5
    if (this.hasRelic('abyss_mark')) m *= 1 + 0.12 * this.layerIdx
    return m
  }

  // ==========================================================================
  // 商店
  // ==========================================================================
  /** DiveScene.ts:5126-5143 */
  openShop(): void {
    this.phase = 'shop'
    this.locked = [false, false, false]
    this.sold = [false, false, false]
    this.rerollCost = REROLL_BASE
    if (this.bank < REROLL_BASE) this.bank = 20
    this.rollOffers(true)
    this.bullets = []; this.pulses = []; this.echoes = []; this.acids = []
  }

  /** 抽三张（fresh=true 全换；否则保留锁定格）。DiveScene.ts:5153-5165 */
  rollOffers(fresh: boolean): void {
    const alive = this.pool.filter(u => !u.dead || !u.dead(this))
    const from = alive.length >= 3 ? alive : this.pool
    const next = this.rng.shuffle(from.slice()).slice(0, 3)
    if (!fresh) {
      for (let i = 0; i < 3; i++) {
        if (this.locked[i] && !this.sold[i] && this.offers[i]) next[i] = this.offers[i]
      }
    }
    this.offers = next
  }

  /** 买第 i 张。钱不够就什么都不做。DiveScene.ts:5168-5179 */
  buyCard(i: number): void {
    if (this.phase !== 'shop') return
    const up = this.offers[i]
    if (!up || this.sold[i]) return
    if (this.bank < up.cost) return
    this.bank -= up.cost
    up.apply(this)
    this.sold[i] = true
    this.locked[i] = false
  }

  /** DiveScene.ts:5181-5188 */
  reroll(): void {
    if (this.phase !== 'shop') return
    if (this.bank < this.rerollCost) return
    this.bank -= this.rerollCost
    this.rerollCost += REROLL_STEP
    this.rollOffers(false)
  }

  /** DiveScene.ts:5190-5193 */
  toggleLock(i: number): void {
    if (this.sold[i]) return
    this.locked[i] = !this.locked[i]
  }

  /** 离开商店。注意是 startWave() 而不是 advance()。DiveScene.ts:5201-5205 */
  leaveShop(): void {
    if (this.phase !== 'shop') return
    this.startWave()
  }

  // ==========================================================================
  // 层末决策 / 结算
  // ==========================================================================
  /** DiveScene.ts:6176-6180 */
  openDecide(): void {
    this.phase = 'decide'
  }

  /** 继续下潜：扣门票氧气 → 上限压缩 → 收益倍率 +0.5。DiveScene.ts:6183-6213 */
  diveDeeper(): void {
    if (this.phase !== 'decide') return
    const toll = this.layer().toll
    if (this.o2 <= toll) return       // 氧气不够买门票，只能上浮
    this.layerIdx++
    this.waveInLayer = 0
    this.mult += 0.5
    const L = this.layer()
    this.o2Max = L.o2Max + this.st.o2Bonus
    this.o2 = Math.min(this.o2 - toll, this.o2Max)
    this.enemies = []; this.bones = []; this.pulses = []
    this.bullets = []; this.echoes = []; this.acids = []
    this.hurtDirT = 0; this.hurtFlash = 0
    const from = LAYERS[this.layerIdx - 1].depthBot
    this.descFrom = from
    // 目标不是下一层顶，而是它的 35% 处
    this.descTo = L.depthTop + (L.depthBot - L.depthTop) * 0.35
    this.descT = 0
    this.phase = 'descending'
    this.layerCardT = 2.6
    this.emit({ t: 'descend', layer: this.layerIdx })
  }

  /** 上浮兑现：结算，带走 100%。DiveScene.ts:6216-6219 */
  surface(): void {
    if (this.phase !== 'decide') return
    this.showResult(true)
  }

  /** DiveScene.ts:6305-6309 */
  showResult(win: boolean): void {
    this.win = win
    this.phase = 'result'
    this.emit(win ? { t: 'runCleared' } : { t: 'dead' })
  }

  /** 结算屏「再来一次」。DiveScene.ts:6406-6418 */
  restart(): void {
    this.enemies = []; this.bones = []; this.pulses = []
    this.biomass = 0
    this.bank = 0
    this.st = NEW_STATS()
    this.relics = []
    this.noHitT = 0; this.plateT = 0
    this.burstTimer = 0
    this.px = this.W / 2; this.py = this.H / 2
    this.startRun()
  }
}
