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
  Enemy, Bone, Pulse, Bullet, Echo, Acid, Mine, Lure, Kind, Weapon, WeaponId,
  Stats, LayerDef, WaveShape, RelicId, SimEvent, InputState, UpgradeDef, ShopTarget,
  DamageCause,
} from './types'
import {
  O2, BONE_O2, PLAYER, WEAPON_DEF, STAT_CAP, NEW_STATS, RELIC_DEF, RELIC_SLOTS,
  LAYERS, LAYER_WAVES, SEAT_ANGLES_DEG, SEAT_RING_R, SEAT_RATIO, TURRET_R, TURRET_SPIN,
  SEAT_SWAY_MAX, SEAT_SWAY_FOLLOW, SEAT_SWAY_DECAY,
  MAX_SEATS, BASE_SEATS, REROLL_BASE, REROLL_STEP, BONE, ENEMY_TEX, TEX_BASE_ROT, weaponFamily,
} from './tables'
import { CARD_POOL } from './pool'
import { Rng, clamp, dist, wrapAngle } from './rng'
// 开局武器缺省值（`WorldOptions.weapon` 不传时用）。刻意与 `START_WEAPONS`
// 放同一个文件 —— "开局候选"与"默认开局"是同一件事的两面，分开放迟早会不一致。
import { DEFAULT_START_WEAPON } from './loadout'

export interface WorldOptions {
  /** 逻辑画布宽（Phaser 用 this.scale.width；Cocos 用设计分辨率宽） */
  w: number
  /** 逻辑画布高 */
  h: number
  /** 随机种子。同一 seed ⇒ 完全相同的世界线（无头测试用） */
  seed?: number
  /** 本局潜航器（默认灯艇） */
  sub?: SubDef
  /**
   * 开局第一个武器（V6.41）。缺省 = `DEFAULT_START_WEAPON`（机关枪）。
   * 由「出击准备」面板选定，见 `loadout.ts` 的 `START_WEAPONS`。
   */
  weapon?: WeaponId
  /** 商店卡池（默认完整卡池；测试里可传 `[]` 跳过商店） */
  pool?: UpgradeDef[]
  /**
   * 永久强化（meta）注入的三项加成。缺省 = 全 0（无 meta 的纯模拟）。
   * 见 `unlocks.ts` 的 `perkBonus()` —— 满级总增幅被红线锁死在"两个遗物"量级。
   */
  perk?: { rate?: number; o2Bonus?: number; pickup?: number }
}

/** 单帧最大步长（秒）—— 与 `DiveScene`: `Math.min(deltaMs, 50) / 1000` 一致 */
const MAX_DT = 0.05

// ---------------------------------------------------------------------------
// V6.46 机制型武器的配平常量
// ---------------------------------------------------------------------------
// 集中放在这里而不是散在各武器分支里：这几条数**互相牵制**（雷的触发半径必须
// 大于敌人半径、连锁半径必须大于爆炸半径才有意义），放一起才看得见关系。

/**
 * 气泡雷：布防时长（s）／同时在场上限／存活时长（s）／触发半径／爆炸半径。
 *
 * - `arm` 0.4s：**不加这个，玩家一布雷就自己踩上去** —— 每次都在自己脚下炸，
 *   武器直接废掉。0.4s 是"走出爆炸半径所需时间"的下界（玩家移速约 200px/s，
 *   34px 触发半径 ⇒ 0.17s，留一倍余量）。
 * - `cap` 6 枚：不加上限的话 0.55s 一颗、活 12s ⇒ 稳态 21 枚，满屏是雷，
 *   退化成"地毯式轰炸"，玩家不需要走位也能赢。
 * - `life` 12s：比"一个波次的长度"短，保证场上雷是**这一波布的**。
 */
const MINE_ARM = 0.4
const MINE_CAP = 6
const MINE_LIFE = 12
const MINE_TRIG = 34
const MINE_R = 88
/** 连锁雷的连锁半径（90 = 略大于爆炸半径 88，相邻两枚必然互引） */
const MINE_CHAIN_R = 90
/** 连锁递归深度上限 —— 同 `explode` 的共鸣腔限深理由：不限深会递归到栈溢出 */
const MINE_CHAIN_DEPTH = 4
/** 氧气雷：每炸到一个敌人回氧／**单次爆炸回氧总量上限** */
const MINE_O2_PER = 2.5
const MINE_O2_CAP = 10

/** 网：命中半径／减速倍率／减速时长（s） */
const NET_R = 46
const NET_SLOW_MUL = 0.5
const NET_SLOW_T = 2.0
/** 电网：加深的减速与灼烧 */
const NET_EL_SLOW_MUL = 0.45
const NET_EL_SLOW_T = 2.5
const NET_EL_BURN_DPS = 6
const NET_EL_BURN_T = 3.0
/** 驯化网：内讧时长（s）。与诱饵的吸引时长分开 —— 两者是不同机制 */
const NET_CHARM_T = 4.0

/** 内讧撕咬：单次伤害／节流（s）。10 伤 / 0.5s = 20 dps，4s 能咬死 1–2 只游群 */
const CHARM_BITE = 10

/** 诱饵：吸引半径／存活时长（s）／爆炸诱饵的自爆半径 */
const LURE_R = 130
const LURE_LIFE = 5.0
const LURE_BOOM_R = 120
/** 光墙：一次三个，间距 / 各自的吸引半径（比单诱饵小 —— 三个叠加会过强） */
const LURE_WALL_GAP = 70
const LURE_WALL_R = 90

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
  /**
   * 炮圈**摆动角**（弧度）。2026-10-13 新增。
   * 阻尼跟随航向的**增量**、限幅 ±`SEAT_SWAY_MAX`：转向时 6 座炮略微滞后偏一点，
   * 停转后弹簧回中。**与 `seatPos()` 同源** ⇒ 炮位、炮口闪光、子弹出生点三者一致，弹道不劈叉。
   */
  sway = 0
  /** 上一帧航向（仅用于算摆动增量，绕到最短弧） */
  private prevAim = 0
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
  /** V6.46 气泡雷：玩家脚下布下的雷。**唯一不索敌**的实体 */
  mines: Mine[] = []
  /** V6.46 生物光诱饵：半径内敌人改追它 */
  lures: Lure[] = []
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

  /**
   * 本局**刷怪计数**（按 kind）。只增不减，用于图鉴"遇见次数"（`codexGains()`）。
   *
   * 为什么放在模拟层而不是渲染层去数敌人数：一是确定性（同 seed ⇒ 同计数，
   * 能在无头测试里断言），二是渲染层会因为"贴图池复用"根本数不准。
   */
  spawned: Record<string, number> = {}

  /** 永久强化注入的三项（见 WorldOptions.perk） */
  private readonly perkRate: number
  private readonly perkO2: number
  private readonly perkPickup: number

  /**
   * 本局的开局武器（`WorldOptions.weapon` 或默认值）。
   *
   * 为什么存成字段而不是直接塞给 `startRun()`：`startRun()` 也会被重开路径
   * （`restart()`，本文件 1559 行附近）调用 —— 那时作用域里没有 `opts`。
   * 存成字段才能让"新局"与"同一局重开"两条路用同一把开局武器。
   */
  private readonly startWeapon: WeaponId

  constructor(opts: WorldOptions) {
    this.W = opts.w
    this.H = opts.h
    this.rng = new Rng(opts.seed ?? 0xc0ffee)
    this.sub = opts.sub ?? SUBS[0]
    this.pool = opts.pool ?? CARD_POOL
    this.perkRate = opts.perk?.rate ?? 0
    this.perkO2 = opts.perk?.o2Bonus ?? 0
    this.perkPickup = opts.perk?.pickup ?? 0
    // ⚠️ 必须在 `startRun()` 之前赋值 —— 它内部就靠这个字段装第一把武器。
    this.startWeapon = opts.weapon ?? DEFAULT_START_WEAPON
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
    // 永久强化：并进 `st` 而不是直接加 `o2Max` —— 因为 `equipRelic()` 会
    // 用 `layer().o2Max + st.o2Bonus` **整份重算** o2Max，若只加到 o2Max 上，
    // 玩家一装"骨殖转化"（o2Bonus −15）就会把永久强化的氧气加成一起冲掉。
    this.st.rate += this.perkRate
    this.st.o2Bonus += this.perkO2
    this.st.pickup += this.perkPickup
    this.ramT = 0
    this.o2Max = LAYERS[0].o2Max + this.sub.o2Max + this.st.o2Bonus
    this.o2 = this.o2Max
    this.o2Shown = this.o2Max
    this.maxWeapons = 4 + (this.sub.slots - 4)
    this.hurtDirT = 0
    this.layerCardT = 2.6
    this.weapons = []
    this.bullets = []; this.echoes = []; this.acids = []
    this.mines = []; this.lures = []
    // 开局武器：由「出击准备」面板选定（V6.41）；不传则回落到机关枪
    // —— 这是原版一直用的开局武器，缺省值保持它以免改变老存档玩家的第一局手感。
    // 其余三把基础武器（声呐 / 鱼雷 / 电弧）在商店里都能买到，所以选谁都不锁死 build。
    // 走 `startWeapon` 字段而不是 `opts`：`startRun()` 也被重开路径调用，那里没有 `opts`。
    this.addWeapon(this.startWeapon)
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

    this.enemies.push(this.mkEnemy({
      x, y,
      hp,
      r: kind === 'drift' ? 34 : kind === 'dash' ? 25 : 19,
      kind,
      color: kind === 'drift' ? UI.amber : kind === 'dash' ? UI.magenta : UI.jade,
      speed: spd,
      tex: ENEMY_TEX[kind],
      texRot: TEX_BASE_ROT[kind] ?? 0,
    }))
    this.eid++
    this.spawned[kind] = (this.spawned[kind] ?? 0) + 1
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

  /**
   * 敌人对象的**字段全集工厂**。`spawnEnemy` 与 `spawnBoss` 都从这里展开。
   *
   * ⚠️ 抽这个工厂是有代价换来的：V6.46 加三个控制字段（slow/burn/charm）时，
   *    手写两处对象字面量**只改了一处**，TS 立刻报了一串 "not assignable"。
   *    以后新增字段只改这里 ⇒ 物理上不可能只改一半。
   *
   * 调用方只需给"这个敌人才有的"字段，其余（速度归零 / 相位 / 控制状态）自动补齐。
   */
  private mkEnemy(p: Partial<Enemy> & Pick<Enemy, 'x' | 'y' | 'hp' | 'r' | 'kind' | 'color' | 'speed' | 'tex'>): Enemy {
    return {
      vx: 0, vy: 0, kx: 0, ky: 0,
      maxHp: p.hp,
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
      texRot: 0,
      // 初始朝向朝左（贴图基准方向）。**必须给非零值** —— 全零会让渲染层
      // `Math.hypot(0,0)=0` 掉进"无朝向"分支，出生那一帧方向是空的。
      fx: -1, fy: 0,
      slowT: 0, slowMul: 1,
      burnT: 0, burnDps: 0, burnTick: 0,
      charmT: 0, charmTick: 0,
      ...p,
    }
  }

  /** DiveScene.ts:1561-1575 */
  spawnBoss(): void {
    const W = this.W
    const hp = Math.round(1500 * this.layer().hpMul)
    this.enemies.push(this.mkEnemy({
      x: W / 2, y: -90,
      hp,
      r: 44, kind: 'boss',
      color: UI.violet,
      speed: 46 * (this.hasRelic('abyss_mark') ? 1.1 : 1),
      tex: ENEMY_TEX.boss,
      texRot: TEX_BASE_ROT.dash ?? 0,
    }))
    this.spawned.boss = (this.spawned.boss ?? 0) + 1
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
      // 炮圈摆动夹在两者中间：先按本帧航向摆到位，再让炮管对着（摆动后的）原点索敌。
      this.slewSeatSway(dt)
      this.slewTurretAims(dt)
      // V6.46：诱饵寿命**先**推进（本帧 `enemyAim()` 读到的是最新状态）；
      // 地雷触发**后**结算（用敌人移动后的最新位置判"踩没踩到"）。
      this.updateLures(dt)
      this.updateEnemies(dt)
      this.updateMines(dt)
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
        if (dist(this.px, this.py, e.x, e.y) <= O2.burstR) this.hurt(e, 40, 'blast')
      }
    }
  }

  // ==========================================================================
  // 敌人 AI
  // ==========================================================================
  /** DiveScene.ts:1886-1977 */
  /**
   * 这条敌人**这一帧该往哪追**（V6.46）。
   *
   * 优先级：**内讧 > 诱饵 > 玩家**。
   * - 内讧（`charmT > 0`）：追**最近的同类**，返回的 `mob` 非空 ⇒ 接触时改为咬同类；
   * - 诱饵：半径内有诱饵就追它（不改阵营，只是被牵着走）；
   * - 默认：玩家。
   *
   * 把"追谁"集中到一个函数是刻意的：三个机制（驯化网 / 诱饵 / 光墙）本质都是
   * "改写寻路目标"，分散在各自的 update 里写会互相打架。
   *
   * ⚠️ 内讧分支是 O(k × n)（k = 被策反的数量）。**这里不需要空间索引**：
   *    网的 `iv` 是 1.1s、策反只持续 4s ⇒ 同时被策反的最多 3–4 只。
   *    150 敌人时约 600 次距离比较/帧，可以忽略。如果哪天有武器能**群体**策反，
   *    这里必须改成网格查询 —— 那时 k 会等于 n。
   */
  private enemyAim(e: Enemy): { x: number; y: number; mob: Enemy | null } {
    if (e.charmT > 0) {
      let best: Enemy | null = null
      let bd = Infinity
      for (const o of this.enemies) {
        if (o === e || !o.alive) continue
        if (o.charmT > 0) continue              // 不去咬同样被策反的（否则两只互咬成死循环）
        const d = dist(e.x, e.y, o.x, o.y)
        if (d < bd) { bd = d; best = o }
      }
      // ⚠️ 找不到同类就回落到"追玩家"而不是原地发呆 —— 否则一只被策反的鱼
      //    在场上只剩自己时会杵在原地，读作"卡死了"。
      if (best) return { x: best.x, y: best.y, mob: best }
    }
    for (const l of this.lures) {
      if (!l.alive) continue
      if (dist(e.x, e.y, l.x, l.y) < l.r) return { x: l.x, y: l.y, mob: null }
    }
    return { x: this.px, y: this.py, mob: null }
  }

  updateEnemies(dt: number): void {
    const cur = this.layer().current
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.flash > 0) e.flash -= dt

      // ---- V6.46 控制状态结算（放在位移之前 ⇒ 本帧立即生效，不滞后一帧）----
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT < 0) e.slowT = 0 }
      if (e.charmT > 0) { e.charmT -= dt; if (e.charmT < 0) e.charmT = 0 }
      if (e.burnT > 0) {
        e.burnT -= dt
        e.burnTick -= dt
        if (e.burnTick <= 0) {
          e.burnTick = 0.35                      // 与酸池同频，复用同一套手感
          e.flash = 0.05
          this.hurt(e, e.burnDps * 0.35, 'burn')
          if (!e.alive) continue                 // 灼烧可能当场烧死
        }
      }
      const slow = e.slowT > 0 ? e.slowMul : 1

      // 目标改写（内讧 / 诱饵 / 玩家三选一）
      const aim = this.enemyAim(e)
      const da = dist(e.x, e.y, aim.x, aim.y) || 1
      const nx = (aim.x - e.x) / da, ny = (aim.y - e.y) / da

      // ---- 朝向（V6.55）----
      // 见 types.ts `fx/fy`：这是 sim 里**唯一**一处写"这条鱼面朝哪"的地方，
      // 供渲染层做左右镜像 + 仰俯限幅。用**朝目标的方向**而不是本帧位移 ——
      // dash 蓄力/冲刺期间位移会归零或突变，朝向却不该跟着闪。
      // ⚠️ 绝不能指望 `vx/vy`：那两个字段在这里（以及任何地方）都不会被更新。
      e.fx = nx; e.fy = ny

      // L2「暗流」：加在敌人身上（敌人吃满）
      if (cur > 0 && e.kind !== 'boss') {
        e.x += Math.cos(this.t * 0.28) * cur * dt
        e.y += Math.sin(this.t * 0.28) * cur * dt
      }

      if (e.kind === 'swarm') {
        e.x += nx * e.speed * slow * dt
        e.y += ny * e.speed * slow * dt
      } else if (e.kind === 'drift') {
        // 水母：脉冲式漂移（一鼓一缩）
        const pulse = 0.6 + 0.4 * Math.sin(this.t * 2.2 + e.x * 0.01)
        e.x += nx * e.speed * pulse * slow * dt
        e.y += ny * e.speed * pulse * slow * dt
      } else if (e.kind === 'boss') {
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          if (e.t >= 5) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          if (e.t >= 1.2) { this.bossSlam(e); e.phase = 'dash'; e.t = 0 }
        } else {
          if (e.t >= 1.6) { e.phase = 'chase'; e.t = 0 }
        }
      } else {
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          if (da < 240) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          e.dirX = nx; e.dirY = ny
          if (e.t >= 0.5) { e.phase = 'dash'; e.t = 0 }
        } else if (e.phase === 'dash') {
          // ⚠️ 冲刺速度也吃减速：否则"网住了但一个冲刺就飞走"，减速就白给了
          e.x += e.dirX * 460 * slow * dt
          e.y += e.dirY * 460 * slow * dt
          // 冲刺时朝**冲刺方向**而不是朝玩家 —— 否则它会歪着身子横冲（V6.55 朝向）
          e.fx = e.dirX; e.fy = e.dirY
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

      // ---- V6.46 内讧：咬同类（此时它**不**攻击玩家）----
      if (aim.mob) {
        const m = aim.mob
        if (m.alive && dist(e.x, e.y, m.x, m.y) < e.r + m.r) {
          e.charmTick -= dt
          if (e.charmTick <= 0) {
            e.charmTick = 0.5
            m.flash = 0.06
            this.hurt(m, CHARM_BITE, 'bite')
          }
          e.x -= nx * 30 * dt
          e.y -= ny * 30 * dt
        } else {
          e.charmTick = 0                          // 脱离接触就重置节流，下一次贴上立刻咬
        }
        continue                                   // 内讧中不再结算"咬玩家"
      }

      // 接触伤害：氧气就是血条。贴着不放 = 24 氧/秒
      const d = dist(e.x, e.y, this.px, this.py) || 1
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
        const px = (this.px - e.x) / d, py = (this.py - e.y) / d
        this.hurtDirX = -px; this.hurtDirY = -py; this.hurtDirT = 0.45
        // 轻微弹开，避免贴脸站桩
        e.x -= px * 40 * dt
        e.y -= py * 40 * dt
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
    this.emit({ t: 'float', x: this.px, y: this.py - 30, text: `-${Math.round(d)}`, color: UI.danger, size: 18 })
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
          this.hurt(e, p.dmg, 'pulse')
          // 共振炮：命中后向**邻近敌人**弹射 40% 伤害
          if (p.resonant) {
            let best: Enemy | null = null, bd = 150
            for (const o of this.enemies) {
              if (!o.alive || o === e) continue
              const dd = dist(e.x, e.y, o.x, o.y)
              if (dd < bd) { bd = dd; best = o }
            }
            if (best) { best.flash = 0.06; this.hurt(best, p.dmg * 0.4, 'pulse') }
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
      if (e.t <= 0) this.explode(e.x, e.y, e.r ?? 130, e.dmg, e.o2per ?? 0, e.depth ?? 0)
    }
    this.echoes = this.echoes.filter(e => e.t > 0)
  }

  /**
   * 生物光诱饵（V6.46 聚怪族）。寿命归零：爆炸诱饵自爆，普通诱饵只是消失。
   *
   * ⚠️ 诱饵本身**不造成任何伤害**（`lure` / `lure_wl` 的 `boom` 为 false）——
   *    它的回报必须来自"把怪聚起来让别的 AoE 打"，这是它占一个槽的代价。
   */
  updateLures(dt: number): void {
    for (const l of this.lures) {
      if (!l.alive) continue
      l.life -= dt
      if (l.life <= 0) {
        l.alive = false
        if (l.boom) this.explode(l.x, l.y, l.br, l.dmg)
      }
    }
    this.lures = this.lures.filter(l => l.alive)
  }

  /**
   * 气泡雷（V6.46 陷阱族）：布防 → 待机 → 敌人进入触发半径即爆。
   *
   * 三层状态在**同一个 for 里**推进（不拆成三个循环）：
   * 布防 0.4s → 激活（画面上点亮）→ 有人踩 / 超时自毁。
   */
  updateMines(dt: number): void {
    // ⚠️ 倒序遍历：`detonateMine` 可能连锁引爆数组里的**其它**雷（改动数组长度），
    //    正序会在 splice 后跳过元素，读起来像"雷偶尔不漏爆"。
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]
      if (!m.alive) continue
      if (m.arm > 0) { m.arm -= dt; continue }       // 布防中：**不触发**
      m.life -= dt
      if (m.life <= 0) { m.alive = false; continue } // 超时**自毁**（不爆）
      for (const e of this.enemies) {
        if (!e.alive) continue
        // ⚠️ 友军化的敌人不踩雷（内讧中它正忙着咬同类，不该被自己的雷炸）
        if (e.charmT > 0) continue
        if (dist(m.x, m.y, e.x, e.y) < m.trig + e.r) {
          this.detonateMine(m, 0)
          break
        }
      }
    }
    this.mines = this.mines.filter(m => m.alive)
  }

  /**
   * 引爆一枚雷。`depth` = 连锁递归深度（0 = 被踩 / 自爆的原始雷）。
   *
   * ⚠️ 连锁必须限深：A→B→A 的互引会无限递归（同 `explode` 共鸣腔的限深理由）。
   */
  detonateMine(m: Mine, depth: number): void {
    if (!m.alive) return
    m.alive = false
    // 回氧上限在**这一颗雷**上钳制（不是整场），所以把 cap 透传给 explode
    this.explode(m.x, m.y, m.r, m.dmg, m.o2per, 0, m.o2cap)
    if (depth >= MINE_CHAIN_DEPTH) return
    for (const o of this.mines) {
      if (!o.alive || o.arm > 0) continue             // 还在布防的不参与连锁
      if (dist(m.x, m.y, o.x, o.y) <= o.chainR) {
        this.detonateMine(o, depth + 1)
      }
    }
  }

  /**
   * 网**张开**：把一颗 `kind === 'net'` 的弹转成一片覆盖（V6.46）。
   *
   * 两个入口共用：① 撞到第一个敌人 ② 飞到射程尽头。两处都必须调用它，
   * 否则会出现"网飞到头就凭空消失"。分裂逻辑放在这里，不在调用点内联。
   */
  private openNet(b: Bullet): void {
    if (!b.net) return
    // 视觉先于伤害：先抛事件（渲染层这一帧就能画网），再结算效果
    this.emit({ t: 'burst', x: b.x, y: b.y, r: NET_R })
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.charmT > 0) continue                  // 已是友方的别再网一遍
      if (dist(b.x, b.y, e.x, e.y) < NET_R + e.r) this.applyNet(b.net, e)
    }
  }

  /**
   * 网张开：对半径 `NET_R` 内所有敌人施加控制（V6.46）。
   *
   * 三种网共用这一处，只有参数不同：
   * | id | 减速 | 灼烧 | 策反 |
   * |---|---|---|---|
   * | `net` | 50% × 2.0s | — | — |
   * | `net_el` | 55% × 2.5s | 6 dps × 3.0s | — |
   * | `net_cv` | 50% × 2.0s | — | **4s 内讧** |
   */
  private applyNet(id: WeaponId, e: Enemy): void {
    const el = id === 'net_el'
    e.slowT = el ? NET_EL_SLOW_T : NET_SLOW_T
    e.slowMul = el ? NET_EL_SLOW_MUL : NET_SLOW_MUL
    if (el) { e.burnT = NET_EL_BURN_T; e.burnDps = NET_EL_BURN_DPS; e.burnTick = 0.35 }
    if (id === 'net_cv') {
      // ⚠️ **Boss 免疫策反**。否则"网住 Boss 让它帮你打小怪"直接摧毁关卡设计意图
      //    （Boss 是压力源，不该能被解除）。减速仍然生效 —— 弱化但不取消控制。
      if (e.kind !== 'boss') { e.charmT = NET_CHARM_T; e.charmTick = 0 }
    }
    e.flash = 0.08
    this.hurt(e, WEAPON_DEF[id].dmg, 'net')
  }

  /**
   * 敌人**密度最高处**（V6.46 诱饵投放点）。
   *
   * 判据是"以它为中心 `LURE_R` 内有几个敌人"，不是"离我最近"。
   * ⚠️ 复杂度 O(n²)：150 敌人 = 22.5k 次距离比较，而诱饵 `iv` 是 2.4s ⇒
   *    约每 2.4s 才跑一次 ⇒ 完全可接受。**不要**把它挪进每帧路径。
   */
  private densestSpot(): { x: number; y: number } | null {
    let best: Enemy | null = null
    let bestN = 0
    for (const a of this.enemies) {
      if (!a.alive || a.charmT > 0) continue
      let n = 0
      for (const b of this.enemies) {
        if (!b.alive || b.charmT > 0) continue
        if (dist(a.x, a.y, b.x, b.y) < LURE_R) n++
      }
      if (n > bestN) { bestN = n; best = a }
    }
    return best ? { x: best.x, y: best.y } : null
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
            this.hurt(e, a.dmg, 'burn')
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
  /**
   * @param cause 伤害来源（V6.46）。**只影响表现**，不影响数值 ——
   *   渲染层按它选打击/击杀特效的形状。缺省 `'bullet'` ⇒ 老调用点一行都不用改。
   */
  hurt(e: Enemy, dmg: number, cause: DamageCause = 'bullet'): void {
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
    this.emit({ t: 'hit', x: e.x, y: e.y, r: e.r, color: crit ? UI.violet : e.color, crit, dmg: d, nx, ny, cause })
    if (crit) {
      // 命中震屏：只给暴击（普通命中频率太高，每次都震会变廉价且让人晕）
      this.emit({ t: 'shake', ms: 90, intensity: 0.0022 })
      e.flash = 0.14
      this.emit({ t: 'float', x: e.x, y: e.y - e.r - 14, text: `暴击 ${Math.round(d)}`, color: UI.violet, size: 22 })
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
      // ---- 伤害飘字字号阶梯（2026-10-13 用户「伤害飘字小了点 字体改下」）----
      // 层级：普通 16 = 击破回氧 16 ＜ 玩家受伤 18 ＜ 暴击 22 ＜ BOSS 击破 26
      // 依据：① 普通伤害是**最高频**的一条，12px 在满屏火花/拖尾里读不出，16 是「扫一眼就能读到数字」的下限；
      //       ② 暴击 22 = 普通的 1.375 倍，让玩家**不看颜色也知道这刀更重**（原来 17 vs 12 差得不够）；
      //       ③ 玩家自己掉血（18）优先级高于打怪，因为它直接关联生死。
      // 加粗 + 深色描边在渲染层（DiveGame.pushFloat）统一加，描边宽随字号比例走。
      this.emit({ t: 'float', x: e.x, y: e.y - e.r - 12, text: `${Math.round(d)}`, color: 0xe8f4ff, size: 16 })
    }
    this.tryKill(e, cause)
  }

  /**
   * 死亡结算：血量归零 → 掉骨 / 击杀回氧 / 震屏 / 事件。
   *
   * **V6.33 从 `hurt()` 抽出**：破血锚的穿透补刀走独立轻量结算（`rendTick()`，
   * 刻意不吃暴击与共振核心以防连锁），但它**必须**能触发死亡 —— 抽成共用函数，
   * 避免"补刀打死了怪却不掉骨头"这类静默错。
   */
  tryKill(e: Enemy, cause: DamageCause = 'bullet'): void {
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.biomass += e.kind === 'boss' ? 20 : 1
      if (e.kind === 'boss') this.bossDown = true
      this.emit({ t: 'kill', x: e.x, y: e.y, r: e.r, color: e.color, kind: e.kind, cause })
      // 击杀震屏：按体型分三档，**频率越高的震得越轻**。
      //   普通小鱼（swarm/dash）不震 —— 每秒可能死十几只，全震就是持续抖动；
      //   大水母（drift，r=27）轻震一记 —— 它是"值得打的大目标"，死了该有反馈；
      //   Boss 重震 —— 一局一次，必须有分量。DiveScene.ts:2226-2231
      if (e.kind === 'boss') this.emit({ t: 'shake', ms: 320, intensity: 0.012 })
      else if (e.kind === 'drift') this.emit({ t: 'shake', ms: 120, intensity: 0.0035 })
      this.dropBone(e)
      // 击杀回氧（深潜者 ×1.5 与「骨殖转化」×2 相乘）
      const kO2 = this.st.killO2 * this.sub.killO2Mul * (this.hasRelic('osteoblast') ? 2 : 1)
      if (kO2 > 0) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + kO2)
        if (this.o2 - before > 0.5) {
          this.emit({ t: 'float', x: e.x, y: e.y - e.r - 6, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 16 })
        }
      }
      if (e.kind === 'boss') {
        this.emit({ t: 'float', x: e.x, y: e.y - 40, text: 'BOSS 击破', color: UI.violet, size: 26 })
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
          this.emit({ t: 'float', x: b.x, y: b.y - 8, text: '氧气已满', color: UI.cyanDim, size: 15 })
        }
        this.emit({ t: 'float', x: b.x, y: b.y - 26, text: `+${coin} 骨`, color: BONE, size: 15 })
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
      // 过载核心：满级 +12% / 未满级 −8%（无该遗物时 = 1）。V6.33
      dmg: d.dmg * (1 + k * 0.35) * this.relicDmgMul(lvl),
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

  /**
   * 第 i 座塔座的世界坐标。DiveScene.ts:2489-2496
   *
   * ⚠️ 2026-10-13 定了两轮：
   *   ① 用户「移动的过程中武器一直在换位置也不太合适」→ 座圈**不再整体随 `aim` 旋转**；
   *   ② 用户「完成轻微摆动」→ 改成**阻尼跟随 + 限幅 ±20°**（见 `slewSeatSway`）。
   *
   *    为什么不能整体跟随 `aim`：机体是**回转体**，转动它本身在屏幕上毫无变化，
   *    于是观感变成"炮在自己沿着船壳滑动"，而不是"潜艇转了向"；且角度完全跟随 `aim`，
   *    玩家一转向（survivors 里每秒都在转）就整体甩一圈，非常吵。
   *    为什么"轻微摆动"是对的：A2 层叠后"6 挺任何朝向都可见"已成目标，
   *    炮圈只需**一点点**生命感 —— 滞后偏角当"有重量的炮塔环"读，站住即回正，不换舷。
   *    航向提示由**艏部探照灯**（`DiveGame.drawPlayer`）与摆动共同承担。
   *
   *    注意：这是**站位**层面的改动，`turretPose().ang` 的索敌转向不受影响 ——
   *    炮管照样转过去打最近的敌人。
   *
   * ⚠️ 摆动加在这里（而非渲染层）的原因同 `SEAT_RATIO`：`seatPos()` 同时决定
   *    「炮塔画在哪」与「子弹从哪出生」（`autoFire` 取 `turretPose`）。
   */
  seatPos(i: number): { x: number; y: number } | null {
    const slot = this.mountPlan()[i]
    if (!slot) return null
    const a = slot.ang + this.sway               // 站位 + 炮圈摆动滞后
    const sx = SEAT_RING_R * Math.cos(a)
    const sy = SEAT_RING_R * Math.sin(a)
    // 侧视投影（V6.54）：座圈在机体**水平面内**定死（含摆动），侧视相机只保留两个自由度 ——
    //   横向（沿艇长）= 满比例 `cos`，纵向（沿艇高）= `sin × SEAT_RATIO`。
    // 效果：±90° 两座压在机体的高边缘（"镶嵌在艇缘"），±30°/±150° 四座沿艇长铺开。
    // 见 tables.ts SEAT_RATIO：炮位与子弹出生点共用这一处，改这里等于同时改两者。
    return { x: this.px + sx, y: this.py + sy * SEAT_RATIO }
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
  /**
   * 炮圈摆动（2026-10-13，用户「完成轻微摆动」）。
   *
   * 阻尼跟随 + 限幅：每帧把航向增量的一部分**滞留给**炮圈（船向右转 → 炮圈落后 → 读作轻微左偏），
   * 再以弹簧回中；整体限幅 ±`SEAT_SWAY_MAX`（20°）。
   *
   * ⚠️ 必须在 `slewTurretAims` **之前**：后者的瞄准原点取自 `seatPos()`，
   *    炮圈先摆到位，炮管的索敌转向才对着正确的原点算。
   * ⚠️ 与 `seatPos()` 同源 ⇒ 子弹出生点跟着摆，弹道不会与画面劈叉。
   */
  slewSeatSway(dt: number): void {
    const dAim = wrapAngle(this.aim - this.prevAim)   // 本帧转向增量（绕到最短弧）
    this.prevAim = this.aim
    this.sway -= dAim * SEAT_SWAY_FOLLOW              // 一部分转角滞留给炮圈
    this.sway -= this.sway * Math.min(1, dt * SEAT_SWAY_DECAY)  // 弹簧回中
    this.sway = clamp(this.sway, -SEAT_SWAY_MAX, SEAT_SWAY_MAX)
  }

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
        const sx = pose ? pose.x : this.px, sy = pose ? pose.y : this.py
        this.pulses.push({
          x: sx, y: sy,
          r: PLAYER.r * 0.6, maxR: rng,
          dmg: w.dmg, width: PLAYER.pulseWidth,
          hit: new Set<number>(), alive: true,
          resonant: w.id === 'sonar_rs',
        })
        // V6.46：声呐原来**一个开火事件都不发** —— 波前从机体扩散出去是"结果"，
        // 但"我开火了"这个**因**没有任何反馈。补一个无方向的爆闪。
        this.emit({ t: 'muzzle', x: sx, y: sy, ang: 0, color: wcol, fam: 'sonar' })
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
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'gun', power: pellets > 1 ? 2 : 1 })
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
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'torpedo', power: 2 })
      } else if (fam === 'harpoon') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        // V6.29 三重鱼叉：3 叉扇形；回旋鱼叉：单叉 + 到程掉头 + 命中回氧
        const pikes = w.id === 'harp_tr' ? 3 : 1
        const spread = 0.30
        for (let p = 0; p < pikes; p++) {
          const a = pikes > 1 ? base + (p / (pikes - 1) - 0.5) * spread * 2 : base
          const life0 = rng / 900
          const b: Bullet = {
            x: ox, y: oy,
            vx: Math.cos(a) * 900, vy: Math.sin(a) * 900,
            life: life0, dmg: w.dmg, kind: 'harpoon',
            hit: new Set<number>(), alive: true,
          }
          if (w.id === 'harp_cb') { b.o2 = 1; b.boomerAt = life0 * 0.5 }
          this.bullets.push(b)
        }
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'harpoon' })
      } else if (fam === 'echo') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const LEAD = 0.5, DLY = 0.75
        const big = w.id === 'echo_fo'
        // V6.29 多重回声：落点三点三角分布；聚焦回声：单个大半径回声
        const spots = w.id === 'echo_mu'
          ? [[0, -70], [-62, 40], [62, 40]]
          : [[0, 0]]
        for (const [dx, dy] of spots) {
          const ec: Echo = {
            x: e.x + e.vx * DLY * LEAD + dx,
            y: e.y + e.vy * DLY * LEAD + dy,
            t: big ? 1.2 : DLY,
            dmg: w.dmg,
          }
          if (big) ec.r = 286
          if (w.id === 'echo_mu') ec.o2per = 0.6
          this.echoes.push(ec)
        }
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'echo', power: big ? 3 : 2 })
      } else if (fam === 'acid') {
        const e = this.nearestEnemy(rng); if (!e) continue
        // V6.29 持久酸池：更大更久；酸雨：落点三池成排
        const big = w.id === 'acid_fd'
        const ar = big ? 100 : 62
        const alife = big ? 5.0 : 3.0
        const spots = w.id === 'acid_ra' ? [[-70, 0], [0, 0], [70, 0]] : [[0, 0]]
        for (const [dx, dy] of spots) {
          this.acids.push({ x: e.x + dx, y: e.y + dy, r: ar, life: alife, tick: 0, dmg: w.dmg })
        }
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'acid' })
      } else if (fam === 'mine') {
        // 气泡雷：**落在自己脚下**，不索敌 —— 这是它与其他 10 把武器的根本区别。
        // ⚠️ 场上有上限：满了就 `continue`（不消耗 timer）⇒ 一旦有空位立刻补一颗。
        //    这读作"布雷节奏被走位卡住"，而不是"武器坏了"。
        let live = 0
        for (const m of this.mines) if (m.alive) live++
        if (live >= MINE_CAP) continue
        const o2per = w.id === 'mine_o2' ? MINE_O2_PER : 0
        this.mines.push({
          x: this.px, y: this.py,
          arm: MINE_ARM, life: MINE_LIFE,
          dmg: w.dmg, trig: MINE_TRIG, r: MINE_R,
          o2per, o2cap: o2per > 0 ? MINE_O2_CAP : Infinity,
          chainR: w.id === 'mine_ch' ? MINE_CHAIN_R : 0,
          alive: true,
        })
        // 布雷的位置反馈：不发光环的话，玩家不知道雷落在哪（尤其是移动中）
        this.emit({ t: 'burst', x: this.px, y: this.py, r: MINE_TRIG })
      } else if (fam === 'net') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        // 网是**慢速弹**（420，比枪弹 780 慢一半）⇒ 看得见飞出去的过程，
        // 才能预判"网要在哪张开"。这是控场武器该有的可读性。
        this.bullets.push({
          x: ox, y: oy,
          vx: Math.cos(base) * 420, vy: Math.sin(base) * 420,
          life: rng / 420, dmg: w.dmg, kind: 'net',
          hit: new Set<number>(), alive: true,
          net: w.id,
        })
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'net', power: 2 })
      } else if (fam === 'lure') {
        // 诱饵：投放点是**敌人密度最高处**，不是最近敌人 ——
        // 投在最近敌人身上没用，它本来就在朝你来了（见 `densestSpot`）。
        const spot = this.densestSpot()
        if (!spot) continue
        const wall = w.id === 'lure_wl'
        const n = wall ? 3 : 1
        for (let k = 0; k < n; k++) {
          const off = wall ? (k - 1) * LURE_WALL_GAP : 0
          this.lures.push({
            x: spot.x + off, y: spot.y,
            life: LURE_LIFE,
            r: wall ? LURE_WALL_R : LURE_R,
            boom: w.id === 'lure_bo', dmg: w.dmg, br: LURE_BOOM_R,
            alive: true,
          })
        }
        // 投放反馈用 `burst`（扩散环）而不是 muzzle：诱饵是"放下去"不是"打出去"
        this.emit({ t: 'burst', x: spot.x, y: spot.y, r: wall ? LURE_R : LURE_R * 0.8 })
      } else {
        const first = this.nearestEnemy(rng); if (!first) continue
        this.fireArc(first, w, pose)
      }
      // 射速：高压供能（st.rate）在这里生效；记下这一发的**实际间隔**
      w.ivLast = def.iv / ((1 + (w.lvl - 1) * 0.12) * seatBoost * (1 + this.st.rate)) * this.relicIvMul(w.lvl)
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
    let o2Gain = 0
    while (cur && hit.size < chain) {
      hit.add(cur)
      pts.push({ x: cur.x, y: cur.y })
      cur.flash = 0.08
      this.hurt(cur, w.dmg, 'arc')
      // 导体缠绕：每跳回氧。V6.33 —— 把「续航」接到「电弧跳数」上
      if (this.hasRelic('conductor_coil')) o2Gain += 0.8
      let next: Enemy | null = null, bd = 190
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e)) continue
        const d = dist(cur.x, cur.y, e.x, e.y)
        if (d < bd) { bd = d; next = e }
      }
      cur = next
    }
    this.emit({ t: 'arc', pts })
    // 单次开火回氧上限 4（防止 arc_ov 的 11 跳一次灌满 → 氧又用不完）
    if (o2Gain > 0) {
      o2Gain = Math.min(o2Gain, 4)
      const before = this.o2
      this.o2 = Math.min(this.o2Max, this.o2 + o2Gain)
      if (this.o2 - before > 0.5) {
        this.emit({ t: 'float', x: this.px, y: this.py - 34, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 15 })
      }
    }
  }

  /** 通用弹更新：机关枪直线、鱼雷追踪 + 命中爆炸。DiveScene.ts:2740-2791 */
  updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) continue
      b.life -= dt
      if (b.life <= 0) {
        // V6.46 网：飞到射程尽头也要**张开**再消失。不张开的话"打了但没网到"
        // 在视觉上等同于"子弹凭空消失"，玩家读不出这是控场武器。
        if (b.net) this.openNet(b)
        b.alive = false
        continue
      }

      // 回旋鱼叉：到程掉头（清 hit ⇒ 回程可对同一目标二次穿刺）。V6.29
      if (b.boomerAt !== undefined && !b.reversed && b.life <= b.boomerAt) {
        b.reversed = true
        b.vx = -b.vx; b.vy = -b.vy
        b.hit.clear()
      }

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
          // 网：**撞到第一个敌人就张开**（半径内的全部一起网住），然后消散。
          // ⚠️ 用 `openNet` 而不是在这里内联 —— 射程尽头也要走同一段逻辑，
          //    分开写迟早只有一处生效（而漏的那处不会有任何报错）。
          if (b.kind === 'net') { this.openNet(b); b.alive = false; break }
          // 爆炸半径吃 er：重型鱼雷 1.5 倍
          if (b.kind === 'torpedo') { this.explode(b.x, b.y, 120 * (b.er ?? 1), b.dmg * 0.6); b.alive = false; break }
          // 鱼叉：穿透（不销毁）+ 把命中的鱼**拉向玩家**
          if (b.kind === 'harpoon') {
            const dd = dist(e.x, e.y, this.px, this.py) || 1
            e.kx -= (e.x - this.px) / dd * 300
            e.ky -= (e.y - this.py) / dd * 300
            // 回旋鱼叉：每次穿刺回氧。V6.29 氧耦合 A
            if (b.o2) {
              const before = this.o2
              this.o2 = Math.min(this.o2Max, this.o2 + b.o2)
              if (this.o2 - before > 0.5) {
                this.emit({ t: 'float', x: e.x, y: e.y - e.r - 6, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 16 })
              }
            }
            // 破血锚：对本发**已穿过的其他敌人**补刀。V6.33
            this.rendTick(b, i)
          }
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.alive)
  }

  /** 鱼雷爆炸：范围伤害随距离衰减。DiveScene.ts:2955-2988 */
  /** `o2per` = 每炸到一个敌人回氧（多重回声 0.6）。缺省 0 = 不回氧。V6.29 氧耦合 A */
  /** `depth` = 连锁深度：0 = 武器直接投放（可触发共鸣腔）；≥1 = 小回声（不再连锁）。V6.33 */
  /** `o2cap` = **单次爆炸**的回氧总量上限。缺省 `Infinity`。V6.46 氧气雷的第三条锁 */
  explode(x: number, y: number, r: number, dmg: number, o2per = 0, depth = 0, o2cap = Infinity): void {
    this.emit({ t: 'shake', ms: 130, intensity: 0.006 })
    this.emit({ t: 'blast', x, y, r })
    let o2gain = 0
    const seen = new Set<Enemy>()      // 同一敌人只计一次（爆炸环可能重叠判定）
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = dist(x, y, e.x, e.y)
      if (d < r + e.r) {
        e.flash = 0.08
        const falloff = 1 - clamp(d / (r + e.r), 0, 1) * 0.5
        this.hurt(e, dmg * falloff, 'blast')
        if (!seen.has(e)) { seen.add(e); o2gain += o2per }
      }
    }
    // ⚠️ 封顶：不封顶的话，一次炸到 8 个敌人就是 +20 氧（氧气雷 2.5×8），
    //    "站雷堆里无限回血" —— 直接把氧气机制作废。见 `MINE_O2_CAP` 的三条锁。
    if (o2gain > o2cap) o2gain = o2cap
    if (o2gain > 0) {
      const before = this.o2
      this.o2 = Math.min(this.o2Max, this.o2 + o2gain)
      if (this.o2 - before > 0.5) {
        this.emit({ t: 'float', x, y: y - 10, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 16 })
      }
    }
    // 共鸣腔：**大回声**（depth 0）引爆时，在最近 2 个未被波及的敌人处各生成一个小回声。V6.33
    // ⚠️ 必须限深：三敌互相指向会无限递归。
    if (depth === 0 && this.hasRelic('resonance_chamber')) {
      const cands: Enemy[] = []
      for (const e of this.enemies) {
        if (!e.alive) continue
        if (dist(x, y, e.x, e.y) < r + e.r) continue   // 已被这次爆炸波及的跳过
        cands.push(e)
      }
      cands.sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y))
      for (const t of cands.slice(0, 2)) {
        this.echoes.push({ x: t.x, y: t.y, r: r * 0.55, dmg: dmg * 0.4, t: 0.4, o2per: 0, depth: 1 })
      }
    }
  }

  /** 层基础耗氧 − 循环泵回氧 + 贪食腺体代谢代价。DiveScene.ts:3107-3117 */
  drainOxygen(dt: number): void {
    let net = this.layer().drain
    if (this.hasRelic('gluttony')) net += 0.6
    net -= this.st.regen
    // 持久酸池：站在自己的酸池里，环境氧耗减半。V6.29 氧耦合 C（场地换氧）
    if (net > 0 && this.weapons.some(w => w.id === 'acid_fd')
      && this.acids.some(a => dist(this.px, this.py, a.x, a.y) < a.r)) {
      net *= 0.5
    }
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
    // 过载核心：`w.dmg` 是装备武器时算好的**缓存值** —— 遗物买得晚，就必须重算已有武器，
    // 否则"先挂的武器不吃加成"。不报错，只是数值悄悄不对。V6.33
    this.refreshWeaponDmg()
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

  // ---------------------------------------------------------------------------
  // V6.33 机制型遗物：绑武器行为的四条（导体缠绕 / 破血锚 / 共鸣腔 / 过载核心）
  // ---------------------------------------------------------------------------
  /** 过载核心 · 伤害：满级（Lv5）+12%，未满级 −8%。无该遗物 = 1。V6.33 */
  private relicDmgMul(lvl: number): number {
    if (!this.hasRelic('overload_core')) return 1
    return lvl >= 5 ? 1.12 : 0.92
  }

  /** 过载核心 · 射速：满级武器间隔 ×0.8（= 射速 +25%）。未满级不惩罚。V6.33 */
  private relicIvMul(lvl: number): number {
    if (!this.hasRelic('overload_core')) return 1
    return lvl >= 5 ? 1 / 1.25 : 1
  }

  /**
   * 重算所有武器的**缓存伤害**。遗物一旦影响武器数值（过载核心），
   * 装备后必须调用 —— 否则"先挂的武器不吃加成"。V6.33
   */
  refreshWeaponDmg(): void {
    for (const w of this.weapons) w.dmg = this.weaponStats(w.id, w.lvl).dmg
  }

  /**
   * 破血锚：鱼叉命中时，对本发**已穿过的其他敌人**各补一刀。V6.33
   *
   * 伤害 = 本发伤害 × 当前暴击倍率 × 30%（**固定值**，不再吃随机暴击）。
   *
   * ⚠️ 刻意**不走 `hurt()`**：否则每次补刀都会命中 `resonance_core` 的暴击溅射分支，
   *    两个遗物同时装会互相引爆。死亡结算复用 `tryKill()`，保证掉骨 / 回氧正常。
   */
  private rendTick(b: Bullet, curIdx: number): void {
    if (!this.hasRelic('bleeding_anchor')) return
    if (b.hit.size <= 1) return
    const rend = b.dmg * (1 + this.st.critMul) * 0.3 * this.dmgMulNow()
    let n = 0
    for (const idx of b.hit) {
      if (idx === curIdx || n >= 3) continue     // 每发最多补 3 次
      const t = this.enemies[idx]
      if (!t || !t.alive) continue
      t.hp -= rend
      t.flash = Math.max(t.flash, 0.12)
      this.emit({ t: 'hit', x: t.x, y: t.y, r: t.r, color: UI.violet, crit: true, dmg: rend, nx: 0, ny: 0 })
      this.tryKill(t)
      n++
    }
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
    // 换层震屏：压力舱推进的闷响。放在 descend 之后 —— 渲染层处理 descend 时会
    // clearFx() 清表现池，震屏状态不在表现池里，但顺序上"先换层再震"更自然。
    this.emit({ t: 'shake', ms: 260, intensity: 0.004 })
  }

  /** 上浮兑现：结算，带走 100%。DiveScene.ts:6216-6219 */
  surface(): void {
    if (this.phase !== 'decide') return
    this.showResult(true)
  }

  /**
   * 结算。DiveScene.ts:6305-6309
   *
   * ⚠️ **必须幂等**：`drainOxygen()` 判定溺水后当帧 `updateWave()` 仍会跑完
   * （`update()` 的分支在本帧开头就选定了），于是"最后一波最后一个敌人打死的那一刻
   * 氧气刚好归零"会**同帧**再走一次 `advance() → showResult(true)`。
   * 那会让一局同时抛出 `dead` 与 `runCleared`，并把 `win` 覆盖成 true ——
   * 结算屏显示"上浮成功"，而这一局实际上是淹死的。所以这里挡住第二次调用。
   */
  showResult(win: boolean): void {
    if (this.phase === 'result') return
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
