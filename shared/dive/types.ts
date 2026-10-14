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

  // ---- V6.46 机制型武器带来的三个新状态 ----
  /** 减速剩余（s）。> 0 时速度 × `slowMul`（网 / 电网）。每帧递减，见 `world.updateEnemies` */
  slowT: number
  /** 减速倍率（0.5 = 打五折）。只在 `slowT > 0` 时读 */
  slowMul: number
  /** 灼烧剩余（s）与每秒伤害（电网）。DoT 走 0.35s tick，与酸池同频 */
  burnT: number
  burnDps: number
  /** 距下一次灼烧结算的剩余时间（s） */
  burnTick: number
  /**
   * **内讧**剩余时间（s）。`> 0` = 这条鱼被驯化网策反，转而攻击同类（V6.46）。
   *
   * ⚠️ **阵营不变**（不是友军单位）。只是把它的寻路目标改写成"最近的同类"
   * （见 `world.enemyAim()`），咬到同类就造成伤害、并**不再攻击玩家**。
   *
   * 为什么不做"真友军"：真友军要加友方 AI + 独立死亡处理 + 击杀归属 +
   * "掉落的氧泡算谁的"这一串问题，成本高一个数量级，而**玩法效果几乎一样**
   * —— 视觉上都是"敌人内讧"。轻版只用一个字段。
   */
  charmT: number
  /** 内讧攻击节流（s）。咬到同类就掉血，但不能每帧咬 */
  charmTick: number
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
  | 'harp_tr' | 'harp_cb'        // V6.29 三重鱼叉 / 回旋鱼叉
  // V6.46 机制型武器四把（计划书 §5.2 点名但一直没做的那批）
  //   mine 陷阱族（不索敌，靠走位铺）/ net 控场族 / lure 聚怪族 / thruster 位移族
  | 'mine' | 'mine_ch' | 'mine_o2'
  | 'net' | 'net_el' | 'net_cv'
  | 'lure' | 'lure_bo' | 'lure_wl'
  // ⚠️ 水流推进器 `thruster` / `thr_vo` / `thr_ra` **故意不在这里**。
  //    它改的是玩家位移（核心手感），按决策挂到 P0 手感判定之后再上。
  //    `WeaponId` 一加，`Record<WeaponId, …>` 的 `WEAPON_DEF` 就必须同时给全 3 条 ——
  //    那样等于提前实装。所以类型是最后一步加的。
  | 'echo_mu' | 'echo_fo'        // V6.29 多重回声 / 聚焦回声
  | 'acid_fd' | 'acid_ra'        // V6.29 持久酸池 / 酸雨

export type WeaponFamily = 'sonar' | 'gun' | 'torpedo' | 'arc' | 'harpoon' | 'echo' | 'acid'
  // V6.46 三个机制族：陷阱（不索敌）／控场（减速）／聚怪（改寻路目标）
  | 'mine' | 'net' | 'lure'

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
  kind: 'gun' | 'torpedo' | 'harpoon' | 'net'
  hit: Set<number>
  alive: boolean
  /**
   * V6.46 网：这颗弹**飞到尽头或撞到第一个敌人时张开**，对半径 `NET_R` 内所有敌人
   * 施加控制。值是网自己的武器 id（`'net' | 'net_el' | 'net_cv'`），
   * 让 `world.applyNet()` 知道该上哪种效果。
   */
  net?: WeaponId
  /** 爆炸半径倍率：重型鱼雷 1.5、其余默认 1 */
  er?: number
  /** 命中**每个**敌人回氧（回旋鱼叉 = 1）。缺省 0 = 不回氧。V6.29 氧耦合 A */
  o2?: number
  /** 回旋鱼叉：剩余寿命降到此值即掉头（发射时 = 初始寿命的一半）。缺省 = 不回旋 */
  boomerAt?: number
  /** 已掉头（防反复掉头） */
  reversed?: boolean
}

/** 回声标记：落在目标位置，延迟 0.75s 后爆发 */
export interface Echo {
  x: number; y: number
  t: number          // 剩余时间，归零即爆
  dmg: number
  /** 爆炸半径。缺省 130（聚焦回声 286）。V6.29 */
  r?: number
  /** 每炸到一个敌人回氧（多重回声 0.6）。缺省 0。V6.29 氧耦合 A */
  o2per?: number
  /** 连锁深度：共鸣腔生成的小回声 = 1；缺省 0 = 由武器直接投放。≥1 不再连锁。V6.33 */
  depth?: number
}

/**
 * 气泡雷（V6.46 陷阱族）。
 *
 * ⚠️ 它是**全场唯一不索敌**的武器 —— 落点永远是**玩家当前位置**。
 * 所以它的强度取决于"你往哪走"，而不是"它打谁"。**绝不能改成追踪雷**，
 * 那就退化成第 8 把普通武器。
 */
export interface Mine {
  x: number; y: number
  /** 布防剩余（s）。> 0 时**不触发**，否则玩家一放下就自己踩炸 */
  arm: number
  /** 存活剩余（s）。归零自毁（**不爆**） */
  life: number
  dmg: number
  /** 触发半径：敌人中心进入即爆 */
  trig: number
  /** 爆炸半径 */
  r: number
  /** 每炸到一个敌人回氧（氧气雷 2.5）。缺省 0 */
  o2per: number
  /** 单次爆炸的回氧总量上限（氧气雷 10）。`Infinity` = 不封顶 */
  o2cap: number
  /** 连锁：引爆邻近地雷的半径（连锁雷 90）。0 = 不连锁 */
  chainR: number
  alive: boolean
}

/**
 * 生物光诱饵（V6.46 聚怪族）。
 *
 * 半径内的敌人把寻路目标改写成诱饵坐标（见 `world.enemyAim()`）。
 * ⚠️ 投放位置是**敌人密度最高处**，不是最近敌人 —— 投在最近敌人身上没用，
 *    它本来就在朝你来了。
 */
export interface Lure {
  x: number; y: number
  life: number
  /** 吸引半径 */
  r: number
  /** 存活结束时是否自爆（爆炸诱饵） */
  boom: boolean
  dmg: number
  /** 自爆半径 */
  br: number
  alive: boolean
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
  // ---- V6.33 机制型遗物 4 条（P1-#4：绑武器行为，做「遗物 × 武器」乘法空间）----
  | 'conductor_coil'    // 导体缠绕：链式电弧每跳回 0.8 氧，氧气上限 −10
  | 'bleeding_anchor'   // 破血锚：鱼叉命中 → 对已穿过的敌人各补 30% 暴击伤害
  | 'resonance_chamber' // 共鸣腔：回声爆炸 → 最近 2 个未被波及的敌人各生成小回声
  | 'overload_core'     // 过载核心：满级武器射速 +25% / 伤害 +12%，未满级 −8%

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
/**
 * 伤害**来源**（V6.46）。模拟层本来不关心"谁打的"，但渲染层必须关心 ——
 * 打击特效与击杀终结特效要按来源给不同形状，否则 11 把武器的命中反馈全一样。
 *
 * 缺省 `'bullet'`：枪弹 / 鱼叉 / 鱼雷这类"一颗东西飞过去打中"的通用情形。
 * 只有**有明显视觉特征**的来源才单独列出 —— 列的越多，渲染层的分支越难维护。
 */
export type DamageCause =
  | 'bullet'   // 枪弹 / 鱼叉 / 鱼雷直击（默认）
  | 'pulse'    // 声呐波前（环形，无方向）
  | 'arc'      // 链式电弧（折线）
  | 'blast'    // 爆炸：鱼雷 / 回声 / 气泡雷 / 诱饵自爆
  | 'burn'     // 灼烧持续伤害（电网）
  | 'net'      // 网命中（低伤，但可能是最后一击）
  | 'bite'     // 内讧撕咬（同类互咬）

export type SimEvent =
  | { t: 'hit'; x: number; y: number; r: number; color: number; crit: boolean; dmg: number; nx: number; ny: number; cause?: DamageCause }
  | { t: 'kill'; x: number; y: number; r: number; color: number; kind: Kind; cause?: DamageCause }
  /**
   * 开火枪口（施法特效）。`fam` 决定画成什么形状 ——
   * 同一个黄色小火花用在 11 把武器上，等于没有施法反馈。
   */
  | { t: 'muzzle'; x: number; y: number; ang: number; color: number; fam?: WeaponFamily; power?: number }
  // ⚠️ **刻意没有 `charge`（前摇）事件**：蓄力进度完全可以从现成字段推出来 ——
  //    `world.weapons[i].timer / ivLast` 就是"这一发还剩多久"。渲染层读它画收拢环即可，
  //    模拟层不该为了表现再维护一份"我正在蓄力"的状态（两份状态必然会不一致）。
  | { t: 'pickup'; x: number; y: number; o2: number; coin: number }
  | { t: 'float'; x: number; y: number; text: string; color: number; size: number }
  | { t: 'playerHurt'; dirX: number; dirY: number; amount: number }
  | { t: 'dodge'; x: number; y: number }
  | { t: 'shake'; ms: number; intensity: number }
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
  /**
   * 武器卡专用：这张卡属于哪个**武器族**。
   *
   * 用途只有一个 —— 解锁过滤（`unlocks.ts` 的 `filterPool`）：族没解锁就把它
   * 连同它的进化卡一起从抽池里摘掉。不带此字段的武器卡（如"弹药改良"）永远保留。
   * ⚠️ 加了新武器卡**必须**补这个字段，否则它会绕过解锁、锁了也照抽。
   */
  family?: WeaponFamily
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
