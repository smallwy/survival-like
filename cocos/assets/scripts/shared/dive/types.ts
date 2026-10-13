// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/dive/types.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 潜水战斗循环 · 模拟层类型（引擎无关）
 *
 * 全部从 `web/src/scenes/DiveScene.ts` 抽出（行号对照见 `tables.ts` 与 `world.ts` 的注释）。
 * 这些类型**不含任何渲染概念** —— 没有贴图对象、没有 Graphics、没有相机。
 * 渲染层（Phaser / Cocos）只读这里的字段来画。
 */

/** 敌人类型：游群 / 冲刺 / 水母漂移 / Boss */
export type Kind = 'swarm' | 'dash' | 'drift' | 'boss'

export interface Enemy {
  x: number; y: number
  vx: number; vy: number
  kx: number; ky: number   // 击退速度（V6.9 打击感），指数衰减，与移动叠加
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
  /**
   * 贴图**资源 key**（不是贴图对象！）。模拟层只负责"这条鱼该用哪张图"，
   * 各引擎自己把 key 解析成 Sprite/Node。原实现是 Phaser 的 texture key。
   */
  tex: string
  /** 贴图朝向补偿（弧度）：AI 生成素材的实际头向不可控，绘制时减掉它。 */
  texRot: number
}

/**
 * 鱼骨：鱼被声呐共振后软组织震散，只剩发光骨架。
 * 缓缓下沉 + 缓慢旋转，玩家必须游过去拾取（硬约束①：不做远程磁吸）。
 */
export interface Bone {
  x: number; y: number
  vx: number; vy: number
  /** 淡出计时（秒）。归零后原地淡出消失，**不再凭空消失** */
  fade: number
  /** 回氧量。V6.23 起与 coin 分开 —— 见 BONE_O2 的注释 */
  o2: number
  /** 鱼骨币价值（喂 boneValueMul）。**这条曲线不能动**，dropCap 按它计量 */
  coin: number
  size: number          // 骨架长度（按鱼体大小，大鱼骨更值钱）
  rot: number           // 当前旋转角
  spin: number          // 旋转速度 rad/s
  alive: boolean
}

/**
 * 声呐脉冲：从潜航器发出的一圈向外扩散的波前。
 * 关键手感——波是从「你」身上往外扩的，所以必须贴近鱼群才扫得到。
 */
export interface Pulse {
  x: number; y: number   // 发射点（发射瞬间位置，之后不跟随玩家）
  r: number              // 当前波前半径
  maxR: number           // 最大半径（= 射程）
  dmg: number
  width: number          // 波前判定厚度
  hit: Set<number>       // 已命中（同一条鱼只判定一次）
  alive: boolean
  /** 共振炮（sonar_rs）：波前命中时向邻近敌人溅射 */
  resonant?: boolean
}

export type WeaponId = 'sonar' | 'gun' | 'torpedo' | 'arc'
  | 'gun_gl' | 'gun_sg'        // 加特林 / 霰弹散射
  | 'torp_cl' | 'torp_hv'      // 集束鱼雷 / 重型鱼雷
  | 'arc_ov' | 'arc_st'        // 过载电弧 / 定点雷暴
  | 'sonar_rs' | 'sonar_fc'    // 共振炮 / 定向聚焦
  | 'harpoon' | 'echo' | 'acid'  // V6.18 新增三种基础武器（鱼叉 / 回声 / 酸液）

export type WeaponFamily = 'sonar' | 'gun' | 'torpedo' | 'arc' | 'harpoon' | 'echo' | 'acid'

export interface Weapon {
  id: WeaponId
  iv: number     // 射击间隔（秒）
  timer: number  // 距下次开火的剩余秒数
  dmg: number
  lvl: number    // 等级：每级提升伤害与频率（1..5）
  anchor: number // 只锚定一个敌人时的索敌锚点下标（鱼雷用）
  /** 上一发的**实际间隔**（含等级/齐射/高压供能）—— 装填进度环的分母 */
  ivLast: number
  /** 开火闪光剩余秒数（0.15s）。"施法过程"要看得见，靠的就是这一帧爆发。 */
  fireFlash: number
  /** 发射器**自己的**世界朝向（弧度）。由 `slewTurretAims` 每帧逼近最近目标。 */
  aimAng: number
}

/** 通用弹：机关枪（直线）、鱼雷（追踪）、鱼叉（穿透+拉拽）共用 */
export interface Bullet {
  x: number; y: number
  vx: number; vy: number
  life: number; dmg: number
  kind: 'gun' | 'torpedo' | 'harpoon'
  hit: Set<number>
  alive: boolean
  /** 爆炸半径倍率：重型鱼雷 1.5、其余默认 1 */
  er?: number
}

/** 回声标记：落在目标位置，延迟 0.75s 后爆发 */
export interface Echo {
  x: number; y: number
  t: number          // 剩余时间，归零即爆
  dmg: number
}

/** 酸液云：在目标位置持续 3s，每 0.35s 结算一次伤害 */
export interface Acid {
  x: number; y: number
  r: number
  life: number
  tick: number       // 距下一次伤害结算的剩余时间
  dmg: number
}

/** 电弧折线：瞬发 + 存留 0.18s 的视觉残留 */
export interface Arc {
  pts: { x: number; y: number }[]
  life: number
}

/**
 * 玩家属性总表（V6.8）。
 *
 * 约定：**百分比类存小数**（0.15 = +15%）；加成型卡走加法（Brotato 做法）；
 * `STAT_CAP` 里声明上限，`addStat()` 统一钳位。
 */
export interface Stats {
  dmg: number
  rate: number
  crit: number
  critMul: number
  range: number
  armor: number
  dodge: number
  speed: number
  pickup: number
  luck: number
  regen: number
  o2Bonus: number
  killO2: number
  twinRate: number
}

export interface LayerDef {
  name: string
  sub: string
  mech: string
  tip: string
  o2Max: number
  drain: number
  dropCap: number
  toll: number
  vis: number
  depthTop: number
  depthBot: number
  /** 热泉上升流（px/s²，L4）。**是加速度不是速度偏移** */
  ventPush: number
  /** 暗流强度（px/s²，L2）。方向随时间缓慢旋转；敌人吃满、玩家吃一半 */
  current: number
  /** 每波开始再压缩的氧气上限比例（0.06 = 再压 6%，L5） */
  pressure: number
  surge: boolean
  tint: number
  motes: number
  hpMul: number
  cntMul: number
  dashMul: number
  driftRatio: number
}

/** 一波的形状：数量 / 冲刺占比 / 血倍率 / 时长 */
export interface WaveShape {
  count: number
  dashRatio: number
  hpMul: number
  dur: number
}

export type RelicId =
  | 'echo_heart'      // 回声心脏：低氧增伤
  | 'osteoblast'      // 骨殖转化：击杀回氧翻倍，氧气上限 -15
  | 'tidal_compass'   // 潮汐罗盘：拾取 + 鱼骨价值
  | 'resonance_core'  // 共振核心：暴击溅射
  | 'gluttony'        // 贪食腺体：鱼骨 ×2，耗氧 +0.6/s
  | 'abyss_mark'      // 深潜印记：每层 +12% 伤害，敌人 +10% 移速
  | 'current_fin'     // 洋流鳍：3 秒不受击 → 移速 +30%
  | 'silent_plating'  // 静默装甲：受击后 1.5s 闪避 +40%

export interface RelicDef {
  id: RelicId
  name: string
  desc: string
  /** 代价。有代价的遗物在卡面上用告警色画 */
  cost2?: string
  price: number
  /**
   * 装备瞬间的副作用。
   * 原实现是 `(s: DiveScene) => void`（直接改场景字段）；这里改成
   * **数据化**（`stat` + `delta`），由 `DiveWorld.equipRelic()` 落地 ——
   * 目的是让遗物表不依赖任何具体世界实现，两个引擎共用。
   */
  onEquip?: { stat: keyof Stats; delta: number }
}

/** 模拟对外抛出的**事件**（打击感/音效/HUD 由渲染层消费，不进入模拟域） */
export type SimEvent =
  | { t: 'hit'; x: number; y: number; r: number; color: number; crit: boolean; dmg: number; nx: number; ny: number }
  | { t: 'kill'; x: number; y: number; r: number; color: number; kind: Kind }
  | { t: 'pickup'; x: number; y: number; o2: number; coin: number }
  | { t: 'float'; x: number; y: number; text: string; color: number; size: number }
  | { t: 'playerHurt'; dirX: number; dirY: number; amount: number }
  | { t: 'dodge'; x: number; y: number }
  | { t: 'shake'; ms: number; intensity: number }
  | { t: 'muzzle'; x: number; y: number; ang: number; color: number }
  | { t: 'burst'; x: number; y: number; r: number }
  /** 电弧折线（链式电弧）。点位只有模拟层知道，所以必须由事件带出来。 */
  | { t: 'arc'; pts: { x: number; y: number }[] }
  /** 鱼雷 / 回声爆点（渲染层画 blast 环 + 冲击波）。 */
  | { t: 'blast'; x: number; y: number; r: number }
  | { t: 'wave'; n: number; layer: number }
  | { t: 'waveCleared'; layer: number; wave: number }
  /** 下潜过渡开始（渲染层播下潜演出 + 换背景） */
  | { t: 'descend'; layer: number }
  | { t: 'layerCleared'; layer: number }
  | { t: 'runCleared' }
  | { t: 'dead' }

/** 玩家本帧输入（由渲染层采样后注入） */
export interface InputState {
  /** -1 / 0 / 1 */
  dx: number
  dy: number
  /**
   * 排气爆发。语义是**边沿**（原实现用 `JustDown`）：
   * 只有"这一帧刚按下"才为 true，按住不放不会连发。由输入层负责边沿判定。
   */
  burst: boolean
}

// ---------------------------------------------------------------------------
// 商店卡（Upgrade 的数据化形式）
// ---------------------------------------------------------------------------

/**
 * 商店卡定义（V6.6 起卡面按 `kind` 分区）。
 *
 * ⚠️ 与 web 版的一处**刻意差异**：原实现是 `apply: (s: DiveScene) => void`，
 * 直接抓着 Phaser 场景改字段。这里改成收 `ShopTarget`（结构接口，见下），
 * 于是卡池变成**纯数据 + 纯函数**，两个引擎共用同一份，且可以在无头测试里跑。
 */
export interface UpgradeDef {
  id: string
  name: string
  desc: string
  kind: 'weapon' | 'mount' | 'stat' | 'relic'
  /** 售价（鱼骨）。定价基准：L1 每波掉落上限 70，一波约攒 40 币 */
  cost: number
  apply: (s: ShopTarget) => void
  /** 返回 true 表示这张卡当前无效，不该出现在三选一里（"买了没效果"是最伤信任的事） */
  dead?: (s: ShopTarget) => boolean
  /** 遗物卡专用：卡面对应的遗物 id */
  relicId?: RelicId
}

/**
 * 商店卡的**落地接口** —— 卡池 `apply`/`dead` 只依赖这些成员，
 * 不依赖 `DiveWorld` 的具体实现（避免 card pool ↔ world 的循环依赖）。
 */
export interface ShopTarget {
  addWeapon(id: WeaponId, lvl?: number): void
  evolveWeapon(from: WeaponId, to: WeaponId): void
  levelAllWeapons(): void
  addStat(k: keyof Stats, v: number): void
  equipRelic(id: RelicId): void
  layer(): LayerDef
  weapons: Weapon[]
  relics: RelicId[]
  st: Stats
  maxWeapons: number
  o2Max: number
  o2: number
  layerIdx: number
  waveInLayer: number
}
