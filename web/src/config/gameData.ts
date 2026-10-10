// 游戏数值与内容数据表（策划向，改这里即可调平衡，不必动逻辑代码）。
//
// 设计定位：**深海 · 生物发光** —— 你是四大潜行者团团的先遣，
// 往下沉，把被生物发光淹没的每一层重新清出来。
//
// 为什么是深海而不是别的：见 docs/项目计划书.md §3（题材决策）。
// 一句话版本——**这里天然有"黑暗中的一束光"**，而这恰好就是核心玩法（光资源）。
//
// 四条支柱（对应 docs/核心玩法与主线规划.md 与 docs/项目计划书.md）：
//
//   军团（谁在打你） → 兵种（用什么兵） → 阵型（怎么摆） → 道具（你怎么破）
//
// 这条链条是**内容量的杠杆**：`6 军团 × 6 阵型` 不是 36 个手工关卡，而是一张可组合的表。
// 新增一个阵型，6 个军团立刻各多一种打法；新增一个军团，6 个阵型立刻多一种填充。
// **并且两者都不产生新贴图 —— 美术成本为零。**
//
// 美术策略（轻美术路线的全部依据）：
// - 游戏内单位：`tools/pixelgen.py` 程序化生成的像素帧（assets/pixel/），
//   动作（朝向/抬手/迈步）是**画出来的帧**，不靠代码变形去猜。
//   深海生物是硬边剪影，正好是像素生成器最擅长画的东西；
//   而且**非人形**（伞盖/管簇/鱼群/触手）比人形更适合像素风——
//   人形一旦细节不够就会退化成"方块人"，水母不会。
// - 敌人走 tools/deepsea_assets.py（6 个深海剪影族 + 族动画语言），
//   玩家 4 名潜行者仍是人形（人形与 6 族剪影实测 IoU 0.547 vs 0.801，
//   一眼能分开，玩家才找得到自己）。
// - 单位体积由 sprite 的实测包围盒决定（见 manifest.json 的 bbox），
//   所以这里**不再有 radius 字段**。
//
// Brotato 化改造（见 docs/项目计划书.md §8.2）：
// - `StageDef.waves`：一关 = N 波，每波固定时长，波间进商店。
// - `ITEMS`：道具池，带**正负修正**，是商店的主要商品，也是内容产能的落点。
// - `WeaponDef.tier`：品质，决定商店出现权重与价格。

export type WeaponKind = 'gun' | 'orbit' | 'beam' | 'aura'

/**
 * 生物护甲 —— 本作的核心相克维度。
 *
 * 为什么从「材质」改成「生物组织」：玩具兵的塑料/金属/发条是与题材无关的抽象标签，
 * 而「胶质 / 鳞甲 / 钙壳 / 骨质」直接对应玩家在屏幕上看到的**剪影形态**——
 * 一眼软塌塌、一身鳞片、硬壳管、软体触手。护甲分类和视觉形态重合之后，
 * 玩家不需要记表，看形状就知道该用什么武器。
 */
export type Armor = 'gel' | 'scale' | 'cal' | 'bone'

/** 战场职能（阵位）。**阵型只定义槽位的 role，具体兵种由军团的 roles 表填。**
 *  这是"阵型骨架 × 军团填充"能组合出内容量的关键。 */
export type ArmyRole = 'front' | 'mid' | 'back' | 'flank'

export const ROLE_NAMES: Record<ArmyRole, string> = {
  front: '前排', mid: '中军', back: '后排', flank: '侧翼'
}

export const ARMOR_NAMES: Record<Armor, string> = {
  gel: '胶质',
  scale: '鳞甲',
  cal: '钙壳',
  bone: '骨质'
}

/** 一关 = 多少秒一波。波末进商店，是 Brotato 化后整个经济循环的节拍器。 */
export const WAVE_SEC = 45

/** 武器槽上限。Brotato 是 6 把，多一把会显著拉低"取舍"的分量。 */
export const WEAPON_SLOTS = 6

export interface WeaponDef {
  id: string
  name: string
  kind: WeaponKind
  /** 品质 1~3：决定商店出现权重与价格（tier 越高越贵越稀有）。 */
  tier: 1 | 2 | 3
  damage: number
  cooldown: number // ms（orbit 用 speed 当角速度）
  speed: number // 子弹速度 px/s（gun）；角速度 rad/s（orbit）
  count: number // 一次发射数（gun）/ 环绕球数（orbit）
  spread: number // 散射角弧度（gun）
  pierce: number // 穿透数（gun）
  radius: number // 半径（orbit / aura）
  range: number // 射程（beam）
  color: number // 16 进制颜色
  desc: string
  /** 克制说明，写在升级卡片上 —— 相克必须**可读**，否则玩家永远发现不了它。 */
  strong: string
  /** 对各类护甲的伤害倍率。未列出的护甲 = 1.0。
   *  相克关系（一句话记法）：声呐枪克胶质、穿甲标枪克鳞甲、探照灯束克钙壳、骨刺长枪克骨质。 */
  vs?: Partial<Record<Armor, number>>
}

export interface EnemyDef {
  id: string
  name: string
  hp: number
  speed: number
  damage: number // 接触伤害（shooter 为 0）
  color: number
  /** 兵种护甲。决定玩家该用哪把武器应对 —— 这是兵种相克的战场。 */
  armor: Armor
  /** 战场职能（阵位）。作为军团 roles 表的默认值与 UI 说明。 */
  role: ArmyRole
  /** 军团标签，用于敌潮叙事与结算展示。 */
  faction: string
  shooter?: boolean // 远程射手
  shootCd?: number // 远程攻击间隔 ms
  shootDmg?: number
  isBoss?: boolean
  bossName?: string
  /** 顶盾：正面减伤（罐兵专属）。见 GameScene 的伤害结算。 */
  guard?: boolean
}

export interface UpgradeDef {
  id: string
  name: string
  desc: string
}

// ---------- 道具（Brotato 化的核心） ----------
// **正负修正是这一版的灵魂**：只有加成的道具 = 自动选最强，玩家没有决策。
// 每件道具都得让玩家犹豫"我到底要不要为这点收益付这个代价"。
export interface ItemMods {
  dmgMul?: number      // 伤害倍率（>1 提升）
  cdMul?: number       // 冷却倍率（<1 攻击更快）
  speedMul?: number    // 移速倍率
  maxHp?: number       // 最大生命增减
  armor?: number       // 固定减伤（每次受击扣减）
  magnet?: number      // 拾取范围
  pierce?: number      // 额外穿透
  lifesteal?: number   // 每次击杀回血
  thorns?: number      // 受击反弹比例（0~1，可叠加）
  regenPerWave?: number // 每波开始回血
  critChance?: number  // 暴击率（0~1）
  critMul?: number     // 暴击倍率（额外倍率，如 0.5 = 150%）
  materials?: number   // 每次拾取额外材料
}

export type ItemRarity = 'common' | 'uncommon' | 'rare'

export interface ItemDef {
  id: string
  name: string
  /** 玩家可读的一行效果说明（含代价） */
  desc: string
  rarity: ItemRarity
  price: number
  mods: ItemMods
}

// 单位被动。四个单位各一种，机制不重叠。
export type PassiveId = 'bounty' | 'lifesteal' | 'thorns' | 'dash'

export interface CharDef {
  id: string
  name: string
  /** 定位/字号，展示在选人卡片与 HUD 上。 */
  title: string
  color: number
  /** 起始武器 id */
  weapon: string
  /** 起始最大生命（覆盖 BALANCE.playerMaxHp） */
  hp: number
  /** 起始移速（覆盖 BALANCE.playerSpeed） */
  speed: number
  passiveId: PassiveId
  passiveName: string
  passiveDesc: string
}

// ---------- 军团 ----------
export interface FactionDef {
  id: string
  name: string
  /** 军团口号，用于章节标题卡与 UI —— 一句话把"这是谁"说清。 */
  motto: string
  color: number
  /** 阵位 -> 兵种 id。**阵型是骨架，军团决定往骨架里填什么兵。** */
  roles: Record<ArmyRole, string>
  /** 未组阵时的散兵刷怪权重 */
  roster: Record<string, number>
  /** 该军团会使用的阵型 id */
  formations: string[]
  /** 军团特性（一句话） */
  trait: string
  // 特性落到**真实数值**，不是文案：
  countMul: number // 数量倍率（一次刷多少）
  hpMul: number    // 单体生命倍率
  speedMul: number // 移速倍率
}

// ---------- 阵型 ----------
export type FormationBehavior = 'charge' | 'advance' | 'hold' | 'fireline' | 'encircle'

export interface FormationDef {
  id: string
  name: string
  /** 一句话说明这个阵型长什么样、危险在哪 */
  desc: string
  /** 破阵提示：玩家该用什么破它 */
  counter: string
  /** 槽位：相对阵心的偏移（屏幕像素）。dy 越大 = 离玩家越远（纵深）。 */
  slots: { dx: number; dy: number; role: ArmyRole }[]
  behavior: FormationBehavior
}

// ---------- 计谋（玩家主动技） ----------
// **重构（2026-10-09）：从"通用六件套"改为"阵型的解"。**
//
// 病根：旧版六个计谋 = 灼烧 / 无敌 / 减速 / 范围伤 / 连线 / 增伤 ——
// 这是任何 survivors-like 都能塞进去的通用件，与"玩具兵"无关，
// 与**阵型系统零关系**。而阵型是本作唯一的差异化资产，计谋却完全不接进去，
// 敌情卡（M3）就只是装饰。
//
// 新结构：前 5 个是**定向解**（每个专破 1~2 种阵型），第 6 个是**通用爆发**
// （保证玩家永远有得选）。破阵的依据是 `counterFormations`，与
// `FormationDef.id` 一一对应 —— 备战界面据此提示"本波推荐计谋"，
// 于是"看敌情 → 选计谋 → 破阵"形成闭环。
export type StratagemKind = 'chain' | 'pull' | 'rebound' | 'spin' | 'stun' | 'buff'

export interface StratagemDef {
  id: string
  name: string
  /** 玩具意象：一句话说清"这是什么玩具、怎么用" */
  quote: string
  desc: string
  cdSec: number
  kind: StratagemKind
  /** 专破的阵型 id（对应 FormationDef.id）。空数组 = 通用，不针对任何阵型。 */
  counterFormations: string[]
}

// ---------- 战役 ----------
export type ObjectiveKind = 'survive' | 'kill' | 'boss'

export interface StageDef {
  index: number
  name: string
  /** 本关波数（Brotato 化的核心：一关 = N 波，每波 WAVE_SEC 秒）。 */
  waves: number
  /** 本关时长上限（秒）= waves × WAVE_SEC。超时未达成目标 = 未通关。 */
  durationSec: number
  objective: ObjectiveKind
  /** kill 目标所需击杀数；survive/boss 忽略。 */
  target: number
  /** Boss 出场波次（第几波出场，1 起），仅 objective==='boss' 使用。 */
  bossWave?: number
  /** 兼容旧逻辑的 Boss 出场秒数（= (bossWave-1) × WAVE_SEC）。 */
  bossAt?: number
  /** 强度倍率：乘在军团的数量/生命上，做关与关之间的梯度。 */
  spawnMul: number
  bossId?: string
}

export interface ChapterDef {
  id: string
  index: number
  name: string
  /** 副标题 */
  subtitle: string
  /** 主军团 id */
  faction: string
  /** 本章阵型池（按顺序逐渐解锁） */
  formations: string[]
  /** 章节色调：全屏低透明度色块，零美术成本制造"这一章不一样"的直觉 */
  tint: number
  /** 首通奖励（meta 解锁项 id） */
  reward: string[]
  stages: StageDef[]
}

// ---------- 武器：8 件，深海探勘装备 ----------
// 起始只有声呐枪与连发声呐，其余靠 meta 解锁后才能在商店/升级里获得。
// vs 表是兵种相克的全部实现 —— 想调克制强度只改这里。
export const WEAPONS: WeaponDef[] = [
  {
    id: 'bow', name: '声呐枪', kind: 'gun', tier: 1,
    damage: 12, cooldown: 450, speed: 480,
    count: 1, spread: 0, pierce: 0, radius: 0, range: 0, color: 0x4fe8ff,
    desc: '基础远程，均衡无短板', strong: '克胶质', vs: { gel: 1.3, bone: 0.8 }
  },
  {
    id: 'crossbow', name: '连发声呐', kind: 'gun', tier: 1,
    damage: 6, cooldown: 140, speed: 540,
    count: 1, spread: 0.12, pierce: 0, radius: 0, range: 0, color: 0x8ff4ff,
    desc: '高射速低伤，清胶质幼体', strong: '克胶质', vs: { gel: 1.25, cal: 0.7 }
  },
  {
    id: 'caltrop', name: '磷光散射', kind: 'gun', tier: 2,
    damage: 7, cooldown: 850, speed: 420,
    count: 5, spread: 0.5, pierce: 0, radius: 0, range: 0, color: 0x7fffd4,
    desc: '近距散射，专治鳞甲快游群', strong: '克鳞甲', vs: { scale: 1.5, gel: 0.9 }
  },
  {
    id: 'heavybow', name: '穿甲标枪', kind: 'gun', tier: 2,
    damage: 20, cooldown: 700, speed: 720,
    count: 1, spread: 0, pierce: 3, radius: 0, range: 0, color: 0x8fd6ff,
    desc: '一枪穿透三体，破密集鱼群', strong: '克鳞甲', vs: { scale: 1.35, cal: 0.75 }
  },
  {
    id: 'spear', name: '骨刺长枪', kind: 'gun', tier: 2,
    damage: 16, cooldown: 620, speed: 620,
    count: 1, spread: 0, pierce: 2, radius: 0, range: 0, color: 0xff5fd0,
    desc: '穿刺，克骨质与长躯', strong: '克骨质', vs: { bone: 1.4, cal: 0.85 }
  },
  {
    id: 'knives', name: '浮游光球', kind: 'orbit', tier: 2,
    damage: 9, cooldown: 0, speed: 2.2,
    count: 3, spread: 0, pierce: 0, radius: 95, range: 0, color: 0xe8fbff,
    desc: '环绕护身，被围时最稳', strong: '克胶质', vs: { gel: 1.2, cal: 0.8 }
  },
  {
    id: 'guandao', name: '探照灯束', kind: 'beam', tier: 3,
    damage: 38, cooldown: 1500, speed: 0,
    count: 1, spread: 0, pierce: 0, radius: 0, range: 420, color: 0xffe9a8,
    desc: '直线强光，破钙壳第一', strong: '克钙壳', vs: { cal: 1.5, bone: 1.15 }
  },
  {
    id: 'snake', name: '电弧泡幕', kind: 'aura', tier: 3,
    damage: 7, cooldown: 480, speed: 0,
    count: 0, spread: 0, pierce: 0, radius: 78, range: 0, color: 0xa88fff,
    desc: '横扫周身，破密集集群', strong: '克鳞甲', vs: { scale: 1.3, gel: 1.15 }
  }
]

// 敌人。剪影族由 tools/deepsea_assets.py 决定（bell 水母 / school 鱼群 /
// tower 管虫 / serpent 触手 / shell 双螯 / leviathan 巨兽），
// armor 决定"该用哪把武器打"，role 决定"在阵型里站哪"。
// armor 与剪影族**刻意对齐**：胶质→bell（一戳就散的软体）、
// 鳞甲→school（密集小个体）、钙壳→tower（硬管）、骨质→serpent（长条穿行）。
// 看形状就知道该换什么武器，不用背表。
//
// ⚠️ 数值（hp/speed/damage）本轮**没动**：换题材和改平衡同时做，
// 一旦手感出问题就分不清是题材改坏了还是数值改坏了。平衡是P4 的事。
export const ENEMIES: EnemyDef[] = [
  { id: 'minion', name: '胶质漂群', hp: 20, speed: 70, damage: 8, color: 0x4fe8ff, armor: 'gel', role: 'front', faction: '胶质群落' },
  { id: 'swarm', name: '荧光幼体', hp: 8, speed: 95, damage: 4, color: 0x8ff4ff, armor: 'gel', role: 'mid', faction: '胶质群落' },
  { id: 'runner', name: '鳞甲快游群', hp: 14, speed: 135, damage: 6, color: 0x7fffd4, armor: 'scale', role: 'flank', faction: '鳞甲鱼群' },
  { id: 'shield', name: '骨甲近卫', hp: 60, speed: 52, damage: 11, color: 0xff5fd0, armor: 'bone', role: 'front', faction: '骨质触丛', guard: true },
  { id: 'tank', name: '钙壳管虫丛', hp: 70, speed: 45, damage: 14, color: 0xffd24a, armor: 'cal', role: 'mid', faction: '钙壳礁群' },
  { id: 'shooter', name: '光诱鮟鱇', hp: 30, speed: 50, damage: 0, color: 0x4fe8ff, armor: 'gel', role: 'back', faction: '鮟鱇独行', shooter: true, shootCd: 1600, shootDmg: 10 },
  { id: 'elite', name: '骨质触手游丝', hp: 95, speed: 88, damage: 16, color: 0xff5fd0, armor: 'bone', role: 'flank', faction: '骨质触丛' },
  // Boss：五章五个，**分占 5 个不同剪影族**（tower/shell/school/serpent/leviathan）。
  // 这一点是硬约束：第一版 5 个 Boss 全用 leviathan 只换颜色，bbox 全是 30×31、
  // 肉眼几乎一样 —— 而 Boss 恰恰是玩家最需要一眼分辨的目标。
  { id: 'boss_warlord', name: '管巢母体', hp: 1200, speed: 42, damage: 18, color: 0xffd24a, armor: 'cal', role: 'front', faction: '钙壳礁群', isBoss: true, bossName: '礁壁 · 管巢母体' },
  { id: 'boss_yanliang', name: '骨触巨螯', hp: 1800, speed: 46, damage: 20, color: 0xff5fd0, armor: 'bone', role: 'front', faction: '骨质触丛', isBoss: true, bossName: '海沟 · 骨触巨螯' },
  { id: 'boss_caocao', name: '鳞潮母舰', hp: 2400, speed: 44, damage: 22, color: 0x7fffd4, armor: 'scale', role: 'mid', faction: '鳞甲鱼群', isBoss: true, bossName: '沙床 · 鳞潮母舰' },
  { id: 'boss_ganning', name: '电鳗王', hp: 2000, speed: 62, damage: 20, color: 0x4fe8ff, armor: 'gel', role: 'flank', faction: '胶质群落', isBoss: true, bossName: '暗渠 · 电鳗王' },
  { id: 'boss_tyrant', name: '利维坦幼体', hp: 3200, speed: 40, damage: 26, color: 0xff7a4a, armor: 'bone', role: 'front', faction: '深渊', isBoss: true, bossName: '海沟最深处 · 吞光者' }
]

// ---------- 军团：决定"往阵型骨架里填什么兵" + 真实数值倍率 ----------
// 玩家不需要读表 —— 他在胶质群落里被漂群淹没、在鳞甲鱼群里被撞散、
// 在钙壳礁群上砍不动硬壳，三次之后就自己记住了这些特性。
//
// 命名原则：**按护甲群落命名**，不按形态。军团和护甲是同一条轴——
// 一个军团的所有成员共享一种生物组织，玩家看到成片的同色同形态就知道
// "这一波是钙壳，要换重武器"。
export const FACTIONS: FactionDef[] = [
  {
    id: 'gelcolony', name: '胶质群落', motto: '软，但是多',
    color: 0x4fe8ff,
    roles: { front: 'minion', mid: 'swarm', back: 'swarm', flank: 'runner' },
    //掺3 成 runner（school 族）是**必做项**，不是口味问题：
    // 上一版是 { minion:3, swarm:2 }，两个兵种**同属 bell 族**，
    // 实机截图里第一章从第 1 关到第 5 关满屏全是水母 ——
    // 6 个深海族里有 5 个在第一章永远登不了场，
    // 「6族剪影各不相同」这条美术投入等于白做。
    // 掺 runner 后第一章就有 bell + school 两族交替，开篇即能看出剪影差别。
    roster: { minion: 3, swarm: 2, runner: 1 },
    formations: ['swarm', 'crescent'],
    trait: '人多势众，单体脆弱',
    countMul: 1.5, hpMul: 0.72, speedMul: 1.0
  },
  {
    id: 'scaleschool', name: '鳞甲鱼群', motto: '成群游动，撞散一切',
    color: 0x7fffd4,
    roles: { front: 'runner', mid: 'minion', back: 'runner', flank: 'runner' },
    roster: { runner: 4, minion: 2 },
    formations: ['swarm', 'arrow'],
    trait: '高速冲刺，接触即撞退',
    countMul: 0.85, hpMul: 1.0, speedMul: 1.25
  },
  {
    id: 'bonereef', name: '骨质触丛', motto: '软体撑起硬刺',
    color: 0xff5fd0,
    roles: { front: 'shield', mid: 'minion', back: 'shooter', flank: 'runner' },
    roster: { minion: 3, shield: 2, shooter: 2 },
    formations: ['fishscale', 'wildgoose'],
    trait: '盾前刺后，缠住你',
    countMul: 1.3, hpMul: 1.0, speedMul: 0.95
  },
  {
    id: 'calcareef', name: '钙壳礁群', motto: '硬壳直立，难啃',
    color: 0xffd24a,
    roles: { front: 'shield', mid: 'tank', back: 'shooter', flank: 'elite' },
    roster: { tank: 2, shield: 3, shooter: 2, elite: 1 },
    formations: ['square', 'fishscale'],
    trait: '重壳精锐，寸步不让',
    countMul: 0.9, hpMul: 1.3, speedMul: 0.9
  },
  {
    id: 'angler', name: '鮟鱇独行', motto: '一盏灯，一点光',
    color: 0xa88fff,
    roles: { front: 'minion', mid: 'shooter', back: 'shooter', flank: 'elite' },
    roster: { shooter: 4, minion: 2, elite: 1 },
    formations: ['wildgoose', 'crescent'],
    trait: '诱光覆盖，近身即溃',
    countMul: 1.0, hpMul: 0.95, speedMul: 1.05
  },
  {
    id: 'abyss', name: '深渊混编', motto: '五花八门，各怀绝技',
    color: 0xff7a4a,
    roles: { front: 'tank', mid: 'elite', back: 'shooter', flank: 'runner' },
    roster: { tank: 2, runner: 2, shooter: 2, elite: 2 },
    formations: ['crescent', 'square', 'arrow'],
    trait: '混编无短板，最考验应变',
    countMul: 1.0, hpMul: 1.1, speedMul: 1.05
  }
]

// ---------- 阵型：六种骨架 ----------
// 所有幸存者类都在做"密度"，没人做"**阵形**"。
// 而深海生物成列游动是最直观的视觉记忆 —— 鱼群天生就是拿来列队的。
// slots 的 dy 越大 = 离玩家越远（纵深方向），阵心放在玩家外侧。
const grid = (cols: number, rows: number, sx: number, sy: number) => {
  const out: { dx: number; dy: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ dx: (c - (cols - 1) / 2) * sx, dy: r * sy })
    }
  }
  return out
}

export const FORMATIONS: FormationDef[] = [
  {
    id: 'swarm', name: '乱堆', behavior: 'charge',
    desc: '无阵散冲，靠人多淹',
    counter: '环形 / 范围武器',
    // 松散网格，逐只在生成时再加抖动 —— 太整齐就不像"乱堆"了
    slots: grid(4, 3, 34, 30).map((s, i) => ({
      ...s, role: (i < 4 ? 'front' : i < 8 ? 'mid' : 'back') as ArmyRole
    }))
  },
  {
    id: 'arrow', name: '尖刀', behavior: 'charge',
    desc: '楔形冲锋，箭头最厚',
    counter: '远程穿透（磷光散射）硬顶',
    // 楔形：尖端朝玩家（dy 小），越往后越宽
    slots: [
      { dx: 0, dy: 0, role: 'front' },
      { dx: -14, dy: 16, role: 'front' }, { dx: 14, dy: 16, role: 'front' },
      { dx: -30, dy: 32, role: 'front' }, { dx: 0, dy: 30, role: 'front' }, { dx: 30, dy: 32, role: 'front' },
      { dx: -46, dy: 50, role: 'mid' }, { dx: 46, dy: 50, role: 'mid' },
      { dx: -62, dy: 68, role: 'back' }, { dx: 62, dy: 68, role: 'back' }
    ]
  },
  {
    id: 'fishscale', name: '叠砖', behavior: 'advance',
    desc: '多层横排，层层叠叠推线',
    counter: '穿透（穿甲标枪 / 骨刺长枪）',
    // 横排层叠：一排前排 + 一排中军 + 一排后排，交错错位像叠砖
    slots: [
      ...grid(5, 1, 40, 0).map((s) => ({ ...s, role: 'front' as ArmyRole })),
      ...grid(4, 1, 40, 0).map((s) => ({ ...s, dx: s.dx + 20, dy: 28, role: 'mid' as ArmyRole })),
      ...grid(3, 1, 46, 0).map((s) => ({ ...s, dy: 56, role: 'back' as ArmyRole }))
    ]
  },
  {
    id: 'wildgoose', name: '人字', behavior: 'fireline',
    desc: 'V 字两翼展开，射手在翼',
    counter: '近身贴脸 / 环绕',
    // 两翼向前（dy 小），中军在后 —— 站定即齐射
    slots: [
      { dx: 0, dy: 54, role: 'mid' },
      { dx: -22, dy: 36, role: 'back' }, { dx: 22, dy: 36, role: 'back' },
      { dx: -44, dy: 20, role: 'back' }, { dx: 44, dy: 20, role: 'back' },
      { dx: -66, dy: 4, role: 'back' }, { dx: 66, dy: 4, role: 'back' },
      { dx: -88, dy: -10, role: 'flank' }, { dx: 88, dy: -10, role: 'flank' }
    ]
  },
  {
    id: 'square', name: '铁桶', behavior: 'hold',
    desc: '外圈铁皮内圈弓，久攻不下',
    counter: '破甲（探照灯束）',
    // 3x3 方阵：四角与前排是铁皮，中心是弓 —— 保护后排
    slots: [
      { dx: -46, dy: 0, role: 'front' }, { dx: 0, dy: 0, role: 'front' }, { dx: 46, dy: 0, role: 'front' },
      { dx: -46, dy: 44, role: 'mid' }, { dx: 0, dy: 44, role: 'back' }, { dx: 46, dy: 44, role: 'mid' },
      { dx: -46, dy: 88, role: 'mid' }, { dx: 0, dy: 88, role: 'mid' }, { dx: 46, dy: 88, role: 'mid' }
    ]
  },
  {
    id: 'crescent', name: '月牙', behavior: 'encircle',
    desc: '弧形包夹，两翼先到',
    counter: '位移 / 击退',
    // 弧形：两翼比中军更靠前（dy 为负 = 越过阵心），走位绕到玩家侧面
    slots: [
      { dx: 0, dy: 36, role: 'mid' },
      { dx: -42, dy: 28, role: 'front' }, { dx: 42, dy: 28, role: 'front' },
      { dx: -82, dy: 12, role: 'front' }, { dx: 82, dy: 12, role: 'front' },
      { dx: -120, dy: -8, role: 'flank' }, { dx: 120, dy: -8, role: 'flank' }
    ]
  }
]

// ---------- 计谋：每个都是"某一种阵型的解" ----------
// 设计约束：
//   1. **不打断自动攻击** —— 计谋是"战术按钮"，不是重构操作。
//   2. **必须破一种阵** —— 效果要能对着敌情卡说"这一波该带它"。
//   3. **必须能看见** —— 形态各不相同，玩家一眼能认出自己按的是哪个。
//   4. 冷却 22~30 秒：一局能用十几次，够用但每次都要想。
export const STRATAGEMS: StratagemDef[] = [
  {
    id: 'domino', name: '共鸣脉冲', quote: '一次震动，后面全部跟倒',
    kind: 'chain', cdSec: 24, counterFormations: ['fishscale', 'swarm'],
    desc: '击中一个敌人后，伤害沿横排相邻目标传导 3 级（每级 80%）—— 专破成排推进的鱼鳞阵'
  },
  {
    id: 'magnetball', name: '诱光潮', quote: '跟着光过来，全给我过来',
    kind: 'pull', cdSec: 26, counterFormations: ['crescent', 'arrow'],
    desc: '把全场敌人吸向一点并聚拢 1.2 秒，弧形包夹会被拉直 —— 专破月牙阵的两翼'
  },
  {
    id: 'rubber', name: '声呐冲击', quote: '一记声波，撞回去',
    kind: 'rebound', cdSec: 22, counterFormations: ['arrow', 'swarm'],
    desc: '身前打出一道声波，撞上的敌人以 2 倍速弹回并撞散后排 —— 专破尖刀冲锋'
  },
  {
    id: 'spinner', name: '环形回旋', quote: '转起来，谁也近不了身',
    kind: 'spin', cdSec: 25, counterFormations: ['swarm', 'crescent'],
    desc: '自身旋转 3 秒，近身持续击退并造成伤害 —— 被乱堆围住时的解'
  },
  {
    id: 'puzzlebox', name: '捕光陷阱', quote: '把发光体全部收进来',
    kind: 'stun', cdSec: 28, counterFormations: ['wildgoose', 'square'],
    desc: '把全场远程单位"吸进陷阱"定身 3 秒，近战不受影响 —— 专破雁行阵的射手翼'
  },
  {
    id: 'overclock', name: '过载脉冲', quote: '全力放电，也更容易散架',
    kind: 'buff', cdSec: 30, counterFormations: [],
    desc: '攻速 +70%、伤害 +30% 持续 8 秒，但受伤 +50% —— 不带针对性时的通用爆发'
  }
]

// 升级池：升级时随机抽 3 个让玩家选（免费小升级；商店是花钱买大件）
export const UPGRADES: UpgradeDef[] = [
  { id: 'dmg', name: '伤害 +20%', desc: '所有武器伤害提升' },
  { id: 'spd', name: '移速 +15%', desc: '玩家移动更快' },
  { id: 'cd', name: '攻速 +15%', desc: '武器冷却缩短' },
  { id: 'hp', name: '血量 +25', desc: '最大生命提升并回满该值' },
  { id: 'magnet', name: '拾取 +', desc: '经验拾取范围扩大' },
  { id: 'pierce', name: '穿透 +1', desc: '子弹多穿透一个敌人' },
  { id: 'regen', name: '回血', desc: '立即恢复 30 点生命' },
  { id: 'newgun', name: '新武器', desc: '获得一把已解锁的武器' }
]

// ---------- 道具池：商店的主要商品 ----------
// 24 件，三档稀有度。**每件都带代价** —— 无代价的道具 = 没有选择题。
export const ITEMS: ItemDef[] = [
  // common
  { id: 'band', name: '弹簧护腕', desc: '伤害 +25%，最大生命 -10', rarity: 'common', price: 12, mods: { dmgMul: 1.25, maxHp: -10 } },
  { id: 'tape', name: '胶带缠绕', desc: '攻速 +12%，移速 -5%', rarity: 'common', price: 12, mods: { cdMul: 0.88, speedMul: 0.95 } },
  { id: 'bearing', name: '滚珠轴承', desc: '移速 +15%，减伤 -1', rarity: 'common', price: 11, mods: { speedMul: 1.15, armor: -1 } },
  { id: 'armor', name: '强化装甲', desc: '最大生命 +30，移速 -8%', rarity: 'common', price: 13, mods: { maxHp: 30, speedMul: 0.92 } },
  { id: 'magnetcore', name: '磁铁块', desc: '拾取范围 +60', rarity: 'common', price: 9, mods: { magnet: 60 } },
  { id: 'spike', name: '尖刺披风', desc: '受击反弹 +40%', rarity: 'common', price: 12, mods: { thorns: 0.4 } },
  { id: 'scrapbag', name: '拾荒袋', desc: '每次拾取 +1 材料', rarity: 'common', price: 12, mods: { materials: 1 } },
  // uncommon
  { id: 'battery', name: '电池组', desc: '伤害 +15%，攻速 +5%，生命 -5', rarity: 'uncommon', price: 20, mods: { dmgMul: 1.15, cdMul: 0.95, maxHp: -5 } },
  { id: 'scope', name: '狙击镜', desc: '暴击率 +15%，攻速 -10%', rarity: 'uncommon', price: 21, mods: { critChance: 0.15, cdMul: 1.1 } },
  { id: 'spring', name: '弹簧腿', desc: '移速 +20%，最大生命 -15', rarity: 'uncommon', price: 19, mods: { speedMul: 1.2, maxHp: -15 } },
  { id: 'vest', name: '防弹背心', desc: '减伤 +3', rarity: 'uncommon', price: 22, mods: { armor: 3 } },
  { id: 'ration', name: '军粮', desc: '每波开始回复 8 生命', rarity: 'uncommon', price: 18, mods: { regenPerWave: 8 } },
  { id: 'drill', name: '钻头', desc: '穿透 +1，伤害 -5%', rarity: 'uncommon', price: 20, mods: { pierce: 1, dmgMul: 0.95 } },
  { id: 'gearset', name: '齿轮组', desc: '攻速 +15%，减伤 -1', rarity: 'uncommon', price: 21, mods: { cdMul: 0.85, armor: -1 } },
  { id: 'gyro', name: '陀螺仪', desc: '移速 +10%，攻速 +10%，生命 -8', rarity: 'uncommon', price: 21, mods: { speedMul: 1.1, cdMul: 0.9, maxHp: -8 } },
  { id: 'luckycoin', name: '幸运币', desc: '暴击率 +10%，暴击伤害 +50%', rarity: 'uncommon', price: 19, mods: { critChance: 0.1, critMul: 0.5 } },
  { id: 'weldred', name: '焊接面罩', desc: '伤害 +10%，减伤 +1，移速 -5%', rarity: 'uncommon', price: 22, mods: { dmgMul: 1.1, armor: 1, speedMul: 0.95 } },
  // rare
  { id: 'booster', name: '增压器', desc: '伤害 +40%，攻速 -20%', rarity: 'rare', price: 32, mods: { dmgMul: 1.4, cdMul: 1.2 } },
  { id: 'titan', name: '钛合金壳', desc: '最大生命 +50，移速 -15%', rarity: 'rare', price: 30, mods: { maxHp: 50, speedMul: 0.85 } },
  { id: 'airgun', name: '空气炮', desc: '伤害 +20%，拾取 +40，生命 -10', rarity: 'rare', price: 31, mods: { dmgMul: 1.2, magnet: 40, maxHp: -10 } },
  { id: 'recycler', name: '回收机', desc: '每次拾取 +2 材料，最大生命 -15', rarity: 'rare', price: 28, mods: { materials: 2, maxHp: -15 } },
  { id: 'fangs', name: '吸血牙', desc: '每次击杀回复 2 生命', rarity: 'rare', price: 30, mods: { lifesteal: 2 } },
  { id: 'doubletape', name: '强力双面胶', desc: '攻速 +10%，移速 +8%', rarity: 'rare', price: 29, mods: { cdMul: 0.9, speedMul: 1.08 } },
  { id: 'matchbox', name: '火柴盒', desc: '每波回复 5 生命，伤害 +10%', rarity: 'rare', price: 29, mods: { regenPerWave: 5, dmgMul: 1.1 } }
]

// ---------- 波内强度曲线 ----------
// 只决定"刷得多快"和"多大比例以阵型整组出场"，**不决定出什么怪**（那由军团与阵型决定）。
// startSec 是**全局游戏时长（秒）**：8 波 = 360 秒，曲线大约在第 5~6 波到顶。
// 阵型比例刻意从 0 开始爬：开局先给散兵让玩家热身，再让成建制的阵型压上来。
export const WAVE_RAMP: { startSec: number; spawnInterval: number; formationChance: number }[] = [
  { startSec: 0, spawnInterval: 900, formationChance: 0 },
  { startSec: 30, spawnInterval: 800, formationChance: 0.3 },
  { startSec: 80, spawnInterval: 700, formationChance: 0.5 },
  { startSec: 150, spawnInterval: 600, formationChance: 0.65 },
  { startSec: 230, spawnInterval: 500, formationChance: 0.8 },
  { startSec: 320, spawnInterval: 420, formationChance: 1 }
]

// ---------- 光资源（P2 核心） ----------
//
// 设计：**光不是一条独立的弹药条，它就是光照半径本身。**
//
// 为什么这么定：本作的核心是「黑暗中的一束光」。如果光做成"子弹弹药"，
// 玩家会理解成"我快没子弹了，去捡"—— 于是光退化成了第二种材料，
// 「黑暗」只是个滤镜。而让**光照半径**随开火收缩，玩家会直接感到：
// 我不停开火，眼前就暗下去，敌人从黑暗里压过来。
// 光资源因此不是数值，是**当前处境的可视化**。
//
// 消耗的算法只有一条规则：**每次开火按伤害扣光**。
// 于是「高伤武器更费光」是自动成立的，不需要另配一张平衡表——
// 玩家自己就能感觉到标枪贵、连发声呐便宜。
export interface LightDef {
  /** 光量上限 */
  max: number
  /** 每秒自然回光（站着不动时的续航） */
  regenPerSec: number
  /**
   * 光量 ≥ 此值时照出「战术半径」—— 看得到、能瞄准、能预判。
   * 低于它就衰减到「头灯半径」—— 只看得到一圈轮廓，必须靠计谋和直觉。
   *
   * 两段而不是连续曲线：连续变化在实机上读不出数值，
   * 玩家只会觉得"画面有点糊"。分段给出的是**能记住的状态**。
   */
  tacticalFrac: number
  /** 战术半径（px） */
  tacticalR: number
  /** 头灯半径（px） */
  lampR: number
}

export const LIGHT: LightDef = {
  max: 100,
  regenPerSec: 7,
  tacticalFrac: 0.45,
  tacticalR: 420,
  lampR: 150
}

// ---------- 战役：6 章 × 3 关 ----------
// 每章 = 一个群落 + 一个阵型池 + 一个 Boss + 一套色调。
// 每章 3 关 = 同一群落的三种强度与目标（前哨 / 鏖战 / 决战）。
//
// **深度就是难度**：战场一路从阳光透光层下沉到无光深渊，每章更暗、更挤、更硬。
// 亮度不是氛围装饰 —— 它和"光照半径=视野"是同一个机制，玩家在第4 章之后
// 真的只能看见头灯照到的那一圈，这一条本身就是难度曲线。
//
// tint 的选择规则：**越深越冷、越深越暗**。浅海偏青绿（能见度高），
// 深渊偏品红（生物发光在无光背景上最抢眼），保证暗处仍然读得出轮廓。
//
// **计谋解锁的递进设计**：初始给「环形回旋」（破乱堆/月牙），正好对付第 1 章胶质群落；
// 之后每通一章解锁的计谋，恰好是**下一章阵型的解** ——
//   ch1 胶质(乱堆/月牙)  ← 环形回旋(初始)
//   ch2 鳞甲(乱堆/尖刀)  ← 通关 ch1 得 声呐冲击(破尖刀)
//   ch3 骨质(鱼鳞/雁行)  ← 通关 ch2 得 捕光陷阱(破鱼鳞)
//   ch4 钙壳(方阵/鱼鳞)  ← 通关 ch3 得 穿甲标枪(破方阵)
//   ch5 鮟鱇(雁行/月牙)  ← 通关 ch4 得 诱光潮(破月牙)
//   ch6 深渊混编         ← 通关 ch5 得 过载脉冲(通用)
// 于是"通关 → 拿到新工具 → 正好克下一章"形成正反馈，玩家自然学会看敌情选计谋。
const stage = (
  index: number, name: string, waves: number,
  objective: ObjectiveKind, target: number, spawnMul: number, bossId?: string
): StageDef => ({
  index, name, waves,
  durationSec: waves * WAVE_SEC,
  objective, target, spawnMul, bossId,
  bossWave: bossId ? Math.max(1, waves - 1) : undefined,
  bossAt: bossId ? Math.max(1, waves - 1) * WAVE_SEC : undefined
})

export const CAMPAIGN: ChapterDef[] = [
  {
    id: 'c1', index: 1, name: '透光层', subtitle: '阳光还能照到底',
    faction: 'gelcolony', formations: ['swarm', 'crescent'], tint: 0x123a3a,
    reward: ['strat_rubber'],
    stages: [
      stage(1, '浅滩前哨', 5, 'survive', 0, 0.85),
      stage(2, '漂群鏖战', 6, 'kill', 120, 1.0),
      stage(3, '胶潮决战', 6, 'survive', 0, 1.15)
    ]
  },
  {
    id: 'c2', index: 2, name: '珊瑚林', subtitle: '光被切碎了',
    faction: 'scaleschool', formations: ['swarm', 'arrow'], tint: 0x14352c,
    reward: ['caltrop', 'strat_domino'],
    stages: [
      stage(1, '林间哨游', 5, 'survive', 0, 0.85),
      stage(2, '鳞潮冲锋', 6, 'kill', 140, 1.0),
      stage(3, '斩管巢母体', 8, 'boss', 0, 1.15, 'boss_warlord')
    ]
  },
  {
    id: 'c3', index: 3, name: '沉骨沟', subtitle: '触手动得比你想的多',
    faction: 'bonereef', formations: ['fishscale', 'wildgoose'], tint: 0x1e2036,
    reward: ['zhangfei', 'strat_puzzlebox'],
    stages: [
      stage(1, '沟口前哨', 6, 'survive', 0, 0.85),
      stage(2, '触丛齐进', 7, 'kill', 150, 1.0),
      stage(3, '破骨触巨螯', 8, 'boss', 0, 1.15, 'boss_yanliang')
    ]
  },
  {
    id: 'c4', index: 4, name: '钙壳礁', subtitle: '硬得像石头',
    faction: 'calcareef', formations: ['square', 'fishscale'], tint: 0x24240f,
    reward: ['heavybow', 'strat_magnetball'],
    stages: [
      stage(1, '礁外围', 6, 'survive', 0, 0.85),
      stage(2, '重壳围阵', 7, 'kill', 150, 1.0),
      stage(3, '拒鳞潮母舰', 8, 'boss', 0, 1.15, 'boss_caocao')
    ]
  },
  {
    id: 'c5', index: 5, name: '无光层', subtitle: '只剩下诱光',
    faction: 'angler', formations: ['wildgoose', 'crescent'], tint: 0x3a1424,
    reward: ['zhaoyun', 'strat_overclock'],
    stages: [
      stage(1, '暗处哨探', 6, 'survive', 0, 0.85),
      stage(2, '诱光蔽空', 7, 'kill', 150, 1.0),
      stage(3, '破电鳗王', 8, 'boss', 0, 1.15, 'boss_ganning')
    ]
  },
  {
    id: 'c6', index: 6, name: '海沟底', subtitle: '吞光的东西来了',
    faction: 'abyss', formations: ['crescent', 'square', 'arrow'], tint: 0x2e1018,
    reward: ['guandao'],
    stages: [
      stage(1, '沟底合围', 7, 'survive', 0, 0.9),
      stage(2, '混编死斗', 8, 'kill', 160, 1.05),
      stage(3, '海沟底 · 吞光者', 9, 'boss', 0, 1.2, 'boss_tyrant')
    ]
  }
]

// 可操控单位（潜行者）。**四个人机制真的不同** ——
// 起始武器、生命、移速、被动四项全不一样。
export const CHARS: CharDef[] = [
  {
    id: 'rookie', name: '深潜者', title: '声呐· 均衡', color: 0x4fe8ff,
    weapon: 'bow', hp: 100, speed: 220,
    passiveId: 'bounty', passiveName: '光量上限', passiveDesc: '光量上限 +15%'
  },
  {
    id: 'guanyu', name: '拾光者', title: '诱饵 · 机动', color: 0x7fffd4,
    weapon: 'guandao', hp: 120, speed: 195,
    passiveId: 'lifesteal', passiveName: '拾光', passiveDesc: '每次击杀回复 3 生命'
  },
  {
    id: 'zhangfei', name: '铸壳者', title: '钙壳 · 减伤', color: 0xffd24a,
    weapon: 'snake', hp: 150, speed: 185,
    passiveId: 'thorns', passiveName: '钙壳', passiveDesc: '受击减伤 20%'
  },
  {
    id: 'zhaoyun', name: '电鳗使', title: '电弧 · 爆发', color: 0xa88fff,
    weapon: 'spear', hp: 90, speed: 265,
    passiveId: 'dash', passiveName: '放电冲刺', passiveDesc: '攻速 +25%；受击伤害 +10%'
  }
]

// 解锁项的展示名（用于结算提示与备战界面）
export const META_NAMES: Record<string, string> = {
  bow: '声呐枪', crossbow: '连发声呐', caltrop: '磷光散射', heavybow: '穿甲标枪',
  spear: '骨刺长枪', knives: '浮游光球', guandao: '探照灯束', snake: '电弧泡幕',
  rookie: '深潜者', guanyu: '拾光者', zhangfei: '铸壳者', zhaoyun: '电鳗使',
  strat_domino: '共鸣脉冲', strat_magnetball: '诱光潮', strat_rubber: '声呐冲击',
  strat_spinner: '环形回旋', strat_puzzlebox: '捕光陷阱', strat_overclock: '过载脉冲'
}

export const BALANCE = {
  // 下面两项只是**兜底默认值** —— 实际以 CHARS 里每个单位的 hp/speed 为准，
  // 见 GameScene.startRun()。保留它们是为了在没有选中单位时也能安全初始化。
  playerMaxHp: 100,
  playerSpeed: 220,
  // 经验曲线。首级要 7 杀、之后约 1.3 倍递增，节奏落到"第一分钟升 2~3 级"。
  expPerKill: 2,
  expToLevel: 14,
  /** 兜底时长：只有理论上"没有章节"时才用得上，正常由 StageDef.durationSec 决定。 */
  runMinutes: 15,

  // ---------- Brotato 化参数 ----------
  /** 每波时长（秒）。改这里就等于改整个经济循环的节拍。 */
  waveSec: WAVE_SEC,
  /** 武器槽上限 */
  weaponSlots: WEAPON_SLOTS,
  /** 商店每次上架几件商品 */
  shopOffers: 4,
  /** 商店刷新价格（材料） */
  shopRerollCost: 6,
  /** 每击杀获得的基础材料 */
  materialPerKill: 1,
  /** 关内每波结束的固定补给材料（保底，防止"打不动就没钱"死循环） */
  materialPerWave: 3
}

export function enemyById(id: string): EnemyDef {
  return ENEMIES.find((e) => e.id === id) || ENEMIES[0]
}
export function weaponById(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id)
}
export function itemById(id: string): ItemDef | undefined {
  return ITEMS.find((i) => i.id === id)
}
export function charById(id: string): CharDef | undefined {
  return CHARS.find((c) => c.id === id)
}
export function factionById(id: string): FactionDef {
  return FACTIONS.find((f) => f.id === id) || FACTIONS[0]
}
export function formationById(id: string): FormationDef {
  return FORMATIONS.find((f) => f.id === id) || FORMATIONS[0]
}
export function stratagemById(id: string): StratagemDef | undefined {
  return STRATAGEMS.find((s) => s.id === id)
}
export function chapterById(id: string): ChapterDef {
  return CAMPAIGN.find((c) => c.id === id) || CAMPAIGN[0]
}
/** 关卡唯一键，用于存档："c2s3" */
export const stageKey = (chapterId: string, stageIndex: number) => `${chapterId}s${stageIndex}`
