// 游戏数值与内容数据表（策划向，改这里即可调平衡，不必动逻辑代码）。
//
// 设计定位：**三国兵种战争**，不是"贴了三国名字的通用幸存者"。
// 四条支柱（对应 docs/核心玩法与主线规划.md 与 docs/项目计划书.md）：
//
//   势力（谁在打你） → 兵种（用什么兵） → 阵型（怎么摆） → 计谋（你怎么破）
//
// 这条链条是**内容量的杠杆**：`6 势力 × 6 阵型` 不是 36 个手工关卡，而是一张可组合的表。
// 新增一个阵型，6 个势力立刻各多一种打法；新增一个势力，6 个阵型立刻多一种填充。
// **并且两者都不产生新贴图 —— 美术成本为零。**
//
// 美术策略：
// - 游戏内单位：`tools/pixelgen.py` 程序化生成的像素帧（assets/pixel/），
//   动作（朝向/抬手/迈步）是**画出来的帧**，不靠代码变形去猜。
// - 武器外观同样由 pixelgen 画进 sprite（bow/crossbow/guandao/serpent/spear…），
//   见 tools/pixelgen.py 的 HEROES / FOES 表与 draw_weapon()。
// - AI 立绘（assets/portraits/）只用于静态展示：选人卡片、HUD 头像、商店页。
// - 单位体积由 sprite 的实测包围盒决定（见 manifest.json 的 bbox），
//   所以这里**不再有 radius 字段**。

export type WeaponKind = 'gun' | 'orbit' | 'beam' | 'aura'

/** 兵种护甲。三国兵种相克的落点 —— 见 WEAPONS 的 vs 表。 */
export type Armor = 'none' | 'light' | 'heavy' | 'cavalry'

/** 战场职能（阵位）。**阵型只定义槽位的 role，具体兵种由势力的 roles 表填。**
 *  这是"阵型骨架 × 势力填充"能组合出内容量的关键。 */
export type ArmyRole = 'front' | 'mid' | 'back' | 'flank'

export const ROLE_NAMES: Record<ArmyRole, string> = {
  front: '前排', mid: '中军', back: '后排', flank: '侧翼'
}

export const ARMOR_NAMES: Record<Armor, string> = {
  none: '无甲',
  light: '轻甲',
  heavy: '重甲',
  cavalry: '骑甲'
}

export interface WeaponDef {
  id: string
  name: string
  kind: WeaponKind
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
   *  相克关系（一句话记法）：弓弩克轻甲、重兵器克重甲、蒺藜/长枪克骑甲。 */
  vs?: Partial<Record<Armor, number>>
}

export interface EnemyDef {
  id: string
  name: string
  hp: number
  speed: number
  damage: number // 接触伤害（shooter 为 0）
  color: number
  /** 兵种护甲。决定玩家该用哪把武器应对 —— 这是三国兵种相克的战场。 */
  armor: Armor
  /** 战场职能（阵位）。作为势力 roles 表的默认值与 UI 说明。 */
  role: ArmyRole
  /** 势力标签，用于敌潮叙事与结算展示。 */
  faction: string
  shooter?: boolean // 远程射手
  shootCd?: number // 远程攻击间隔 ms
  shootDmg?: number
  isBoss?: boolean
  bossName?: string
  /** 顶盾：正面减伤（盾卫专属）。见 GameScene 的伤害结算。 */
  guard?: boolean
}

export interface UpgradeDef {
  id: string
  name: string
  desc: string
}

// 武将被动。四人各一种，机制不重叠。
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

// ---------- 势力 ----------
export interface FactionDef {
  id: string
  name: string
  /** 势力口号，用于章节标题卡与 UI —— 一句话把"这是谁"说清。 */
  motto: string
  color: number
  /** 阵位 -> 兵种 id。**阵型是骨架，势力决定往骨架里填什么兵。** */
  roles: Record<ArmyRole, string>
  /** 未组阵时的散兵刷怪权重 */
  roster: Record<string, number>
  /** 该势力会使用的阵型 id */
  formations: string[]
  /** 势力特性（一句话） */
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

// ---------- 计谋 ----------
export type StratagemKind = 'burst' | 'control' | 'buff' | 'guard'

export interface StratagemDef {
  id: string
  name: string
  /** 典故出处，增强三国味与辨识度 */
  quote: string
  desc: string
  cdSec: number
  kind: StratagemKind
}

// ---------- 战役 ----------
export type ObjectiveKind = 'survive' | 'kill' | 'boss'

export interface StageDef {
  index: number
  name: string
  /** 本关时长上限（秒）。超时未达成目标 = 未通关。 */
  durationSec: number
  objective: ObjectiveKind
  /** kill 目标所需击杀数；survive/boss 忽略。 */
  target: number
  /** Boss 出场时间（秒），仅 objective==='boss' 使用。 */
  bossAt?: number
  /** 强度倍率：乘在势力的数量/生命上，做关与关之间的梯度。 */
  spawnMul: number
  bossId?: string
}

export interface ChapterDef {
  id: string
  index: number
  name: string
  /** 史实引 / 副标题 */
  subtitle: string
  /** 主势力 id */
  faction: string
  /** 本章阵型池（按顺序逐渐解锁） */
  formations: string[]
  /** 章节色调：全屏低透明度色块，零美术成本制造"这一章不一样"的直觉 */
  tint: number
  /** 首通奖励（meta 解锁项 id） */
  reward: string[]
  stages: StageDef[]
}

// ---------- 武器：全冷兵器，8 件 ----------
// 起始只有短弓与连弩，其余靠 meta 解锁后才能在升级里获得。
// vs 表是兵种相克的全部实现 —— 想调克制强度只改这里。
export const WEAPONS: WeaponDef[] = [
  {
    id: 'bow', name: '短弓', kind: 'gun', damage: 12, cooldown: 450, speed: 480,
    count: 1, spread: 0, pierce: 0, radius: 0, range: 0, color: 0xe8d59a,
    desc: '基础远程，均衡无短板', strong: '克轻甲', vs: { light: 1.3, cavalry: 0.8 }
  },
  {
    id: 'crossbow', name: '连弩', kind: 'gun', damage: 6, cooldown: 140, speed: 540,
    count: 1, spread: 0.12, pierce: 0, radius: 0, range: 0, color: 0xf0c674,
    desc: '高射速低伤，清轻甲杂兵', strong: '克轻甲', vs: { light: 1.25, heavy: 0.7 }
  },
  {
    id: 'caltrop', name: '铁蒺藜', kind: 'gun', damage: 7, cooldown: 850, speed: 420,
    count: 5, spread: 0.5, pierce: 0, radius: 0, range: 0, color: 0xd9a52c,
    desc: '近距散射，专治冲阵骑兵', strong: '克骑甲', vs: { cavalry: 1.5, light: 0.9 }
  },
  {
    id: 'heavybow', name: '强弩', kind: 'gun', damage: 20, cooldown: 700, speed: 720,
    count: 1, spread: 0, pierce: 3, radius: 0, range: 0, color: 0xe0b64a,
    desc: '一箭穿透三人，破鱼鳞阵', strong: '克轻甲', vs: { light: 1.35, heavy: 0.75 }
  },
  {
    id: 'spear', name: '亮银枪', kind: 'gun', damage: 16, cooldown: 620, speed: 620,
    count: 1, spread: 0, pierce: 2, radius: 0, range: 0, color: 0xcfe0f5,
    desc: '穿刺，克骑兵与列阵', strong: '克骑甲', vs: { cavalry: 1.4, heavy: 0.85 }
  },
  {
    id: 'knives', name: '回旋飞刀', kind: 'orbit', damage: 9, cooldown: 0, speed: 2.2,
    count: 3, spread: 0, pierce: 0, radius: 95, range: 0, color: 0x8fd6ff,
    desc: '环绕护身，被围时最稳', strong: '克轻甲', vs: { light: 1.2, heavy: 0.8 }
  },
  {
    id: 'guandao', name: '青龙偃月', kind: 'beam', damage: 38, cooldown: 1500, speed: 0,
    count: 1, spread: 0, pierce: 0, radius: 0, range: 420, color: 0x7ef0c0,
    desc: '直线重斩，破甲第一', strong: '克重甲', vs: { heavy: 1.5, cavalry: 1.15 }
  },
  {
    id: 'snake', name: '丈八蛇矛', kind: 'aura', damage: 7, cooldown: 480, speed: 0,
    count: 0, spread: 0, pierce: 0, radius: 78, range: 0, color: 0xffb347,
    desc: '横扫周身，破蜂拥阵', strong: '克骑甲', vs: { cavalry: 1.3, none: 1.15 }
  }
]

// 敌人。体型与剪影由 pixelgen 的 build 决定（wisp 瘦高 / brute 宽厚 / tiny 矮小），
// armor 决定"该用哪把武器打"，role 决定"在阵型里站哪"，color 只是辅助识别
// —— 弹幕里玩家没空看颜色，只认轮廓。
export const ENEMIES: EnemyDef[] = [
  { id: 'minion', name: '黄巾力士', hp: 20, speed: 70, damage: 8, color: 0xff6b6b, armor: 'light', role: 'front', faction: '黄巾' },
  { id: 'swarm', name: '流民贼寇', hp: 8, speed: 95, damage: 4, color: 0xff9f43, armor: 'none', role: 'mid', faction: '黄巾' },
  { id: 'runner', name: '轻骑', hp: 14, speed: 135, damage: 6, color: 0xffd93d, armor: 'cavalry', role: 'flank', faction: '西凉' },
  { id: 'shield', name: '盾卫', hp: 60, speed: 52, damage: 11, color: 0x8fa8c8, armor: 'heavy', role: 'front', faction: '魏', guard: true },
  { id: 'tank', name: '重甲兵', hp: 70, speed: 45, damage: 14, color: 0x6bcb77, armor: 'heavy', role: 'mid', faction: '魏' },
  { id: 'shooter', name: '弓弩手', hp: 30, speed: 50, damage: 0, color: 0xa55eea, armor: 'light', role: 'back', faction: '魏', shooter: true, shootCd: 1600, shootDmg: 10 },
  { id: 'elite', name: '骁将', hp: 95, speed: 88, damage: 16, color: 0xe05c9f, armor: 'heavy', role: 'flank', faction: '群雄' },
  // Boss：五章五个，剪影各不相同（brute 厚重 / wide 横宽 / wisp 瘦高带背刺）
  { id: 'boss_warlord', name: '华雄', hp: 1200, speed: 42, damage: 18, color: 0x9b59b6, armor: 'heavy', role: 'front', faction: '西凉', isBoss: true, bossName: '汜水关 · 华雄' },
  { id: 'boss_yanliang', name: '颜良', hp: 1800, speed: 46, damage: 20, color: 0x7f5af0, armor: 'heavy', role: 'front', faction: '河北', isBoss: true, bossName: '界桥 · 颜良' },
  { id: 'boss_caocao', name: '曹操', hp: 2400, speed: 44, damage: 22, color: 0xc9a227, armor: 'heavy', role: 'mid', faction: '魏', isBoss: true, bossName: '长坂坡 · 曹操' },
  { id: 'boss_ganning', name: '甘宁', hp: 2000, speed: 62, damage: 20, color: 0xe8613c, armor: 'heavy', role: 'flank', faction: '吴', isBoss: true, bossName: '赤壁 · 锦帆甘宁' },
  { id: 'boss_tyrant', name: '吕布', hp: 3200, speed: 40, damage: 26, color: 0xee5253, armor: 'heavy', role: 'front', faction: '群雄', isBoss: true, bossName: '白门楼 · 飞将吕布' }
]

// ---------- 势力：决定"往阵型骨架里填什么兵" + 真实数值倍率 ----------
// 玩家不需要读表 —— 他在黄巾章被淹、在西凉章被撞飞、在魏章砍不动，
// 三次之后就自己记住了这些特性。
export const FACTIONS: FactionDef[] = [
  {
    id: 'yellowturban', name: '黄巾', motto: '苍天已死，黄天当立',
    color: 0xd9a52c,
    roles: { front: 'minion', mid: 'swarm', back: 'swarm', flank: 'minion' },
    roster: { minion: 3, swarm: 2 },
    formations: ['swarm', 'crescent'],
    trait: '人多势众，单体脆弱',
    countMul: 1.5, hpMul: 0.72, speedMul: 1.0
  },
  {
    id: 'xiliang', name: '西凉', motto: '铁骑踏阵，所向披靡',
    color: 0xffd93d,
    roles: { front: 'runner', mid: 'minion', back: 'runner', flank: 'runner' },
    roster: { runner: 4, minion: 2 },
    formations: ['swarm', 'arrow'],
    trait: '铁骑冲锋，接触即撞退',
    countMul: 0.85, hpMul: 1.0, speedMul: 1.25
  },
  {
    id: 'hebei', name: '河北', motto: '四世三公，兵多将广',
    color: 0x7f5af0,
    roles: { front: 'shield', mid: 'minion', back: 'shooter', flank: 'runner' },
    roster: { minion: 3, shield: 2, shooter: 2 },
    formations: ['fishscale', 'wildgoose'],
    trait: '盾前弓后，硬骨头',
    countMul: 1.3, hpMul: 1.0, speedMul: 0.95
  },
  {
    id: 'wei', name: '魏', motto: '虎豹骑，重甲锐士',
    color: 0x4a7fd6,
    roles: { front: 'shield', mid: 'tank', back: 'shooter', flank: 'elite' },
    roster: { tank: 2, shield: 3, shooter: 2, elite: 1 },
    formations: ['square', 'fishscale'],
    trait: '重甲精锐，寸步不让',
    countMul: 0.9, hpMul: 1.3, speedMul: 0.9
  },
  {
    id: 'wu', name: '吴', motto: '水军弓弩，火攻见长',
    color: 0xe8613c,
    roles: { front: 'minion', mid: 'shooter', back: 'shooter', flank: 'elite' },
    roster: { shooter: 4, minion: 2, elite: 1 },
    formations: ['wildgoose', 'crescent'],
    trait: '箭雨覆盖，近身即溃',
    countMul: 1.0, hpMul: 0.95, speedMul: 1.05
  },
  {
    id: 'qunxiong', name: '群雄', motto: '天下大乱，各怀异心',
    color: 0xee5253,
    roles: { front: 'tank', mid: 'elite', back: 'shooter', flank: 'runner' },
    roster: { tank: 2, runner: 2, shooter: 2, elite: 2 },
    formations: ['crescent', 'square', 'arrow'],
    trait: '混编无短板，最考验应变',
    countMul: 1.0, hpMul: 1.1, speedMul: 1.05
  }
]

// ---------- 阵型：六种骨架 ----------
// 所有幸存者类都在做"密度"，没人做"**阵形**"。
// 而阵形是三国战争最核心的视觉记忆 —— 玩家一眼能认出、一句话能说出。
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
    id: 'swarm', name: '蜂拥', behavior: 'charge',
    desc: '无阵散冲，靠人多淹',
    counter: '环形 / 范围武器',
    // 松散网格，逐只在生成时再加抖动 —— 太整齐就不像"蜂拥"了
    slots: grid(4, 3, 34, 30).map((s, i) => ({
      ...s, role: (i < 4 ? 'front' : i < 8 ? 'mid' : 'back') as ArmyRole
    }))
  },
  {
    id: 'arrow', name: '锋矢', behavior: 'charge',
    desc: '楔形冲锋，箭头最厚',
    counter: '长兵 / 铁蒺藜硬顶',
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
    id: 'fishscale', name: '鱼鳞', behavior: 'advance',
    desc: '多层横排，层层叠叠推线',
    counter: '穿透（强弩 / 亮银枪）',
    // 横排层叠：一排前排 + 一排中军 + 一排后排，交错错位像鱼鳞
    slots: [
      ...grid(5, 1, 40, 0).map((s) => ({ ...s, role: 'front' as ArmyRole })),
      ...grid(4, 1, 40, 0).map((s) => ({ ...s, dx: s.dx + 20, dy: 28, role: 'mid' as ArmyRole })),
      ...grid(3, 1, 46, 0).map((s) => ({ ...s, dy: 56, role: 'back' as ArmyRole }))
    ]
  },
  {
    id: 'wildgoose', name: '雁行', behavior: 'fireline',
    desc: 'V 字两翼展开，弓手在翼',
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
    id: 'square', name: '方圆', behavior: 'hold',
    desc: '外圈盾内圈弓，久攻不下',
    counter: '破甲（青龙偃月）',
    // 3x3 方阵：四角与前排是盾，中心是弓 —— 保护后排
    slots: [
      { dx: -46, dy: 0, role: 'front' }, { dx: 0, dy: 0, role: 'front' }, { dx: 46, dy: 0, role: 'front' },
      { dx: -46, dy: 44, role: 'mid' }, { dx: 0, dy: 44, role: 'back' }, { dx: 46, dy: 44, role: 'mid' },
      { dx: -46, dy: 88, role: 'mid' }, { dx: 0, dy: 88, role: 'mid' }, { dx: 46, dy: 88, role: 'mid' }
    ]
  },
  {
    id: 'crescent', name: '偃月', behavior: 'encircle',
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

// ---------- 计谋：玩家唯一的主动操作 ----------
// 设计约束：
//   1. **不打断自动攻击** —— 计谋是"战术按钮"，不是重构操作。
//   2. **必须改变战局**，而不是 +20% 数值。
//   3. 冷却 20~30 秒：一局能用十几次，够用但每次都要想。
export const STRATAGEMS: StratagemDef[] = [
  {
    id: 'fire', name: '火计', quote: '火烧连营', kind: 'burst', cdSec: 22,
    desc: '身前放出三道火墙，持续灼烧 4 秒'
  },
  {
    id: 'emptycity', name: '空城计', quote: '抚琴退敌', kind: 'guard', cdSec: 26,
    desc: '2.5 秒无敌，并把全场敌人击退'
  },
  {
    id: 'slowdown', name: '缓兵计', quote: '长坂断喝', kind: 'control', cdSec: 24,
    desc: '全场敌军减速 75%，持续 4 秒'
  },
  {
    id: 'ambush', name: '十面埋伏', quote: '垓下之围', kind: 'burst', cdSec: 28,
    desc: '以自身为心，半径 220 内落下八波箭雨'
  },
  {
    id: 'chain', name: '连环计', quote: '铁索横江', kind: 'control', cdSec: 26,
    desc: '最近的十个敌人被铁索连起，共享一次重击'
  },
  {
    id: 'laststand', name: '背水一战', quote: '破釜沉舟', kind: 'buff', cdSec: 30,
    desc: '攻击 +70% 持续 10 秒，但受伤 +50%'
  }
]

// 升级池：升级时随机抽 3 个让玩家选
export const UPGRADES: UpgradeDef[] = [
  { id: 'dmg', name: '伤害 +20%', desc: '所有武器伤害提升' },
  { id: 'spd', name: '移速 +15%', desc: '玩家移动更快' },
  { id: 'cd', name: '攻速 +15%', desc: '武器冷却缩短' },
  { id: 'hp', name: '血量 +25', desc: '最大生命提升并回满该值' },
  { id: 'magnet', name: '拾取 +', desc: '经验拾取范围扩大' },
  { id: 'pierce', name: '穿透 +1', desc: '子弹多穿透一个敌人' },
  { id: 'regen', name: '回血', desc: '立即恢复 30 点生命' },
  { id: 'newgun', name: '新武器', desc: '获得一把已解锁的冷兵器' }
]

// 波次强度曲线：与过去不同，**这里不再决定"出什么怪"**（那由章节势力与阵型决定），
// 只决定"刷得多快"和"多大比例以阵型整组出场"。
// 阵型比例刻意从 0 开始爬：开局先给散兵让玩家热身，再让成建制的阵型压上来。
export const WAVE_RAMP: { startMin: number; spawnInterval: number; formationChance: number }[] = [
  { startMin: 0, spawnInterval: 900, formationChance: 0 },
  { startMin: 1, spawnInterval: 780, formationChance: 0.45 },
  { startMin: 2.5, spawnInterval: 660, formationChance: 0.62 },
  { startMin: 4, spawnInterval: 570, formationChance: 0.75 },
  { startMin: 6, spawnInterval: 490, formationChance: 0.88 },
  { startMin: 8, spawnInterval: 430, formationChance: 1 }
]

// ---------- 战役：6 章 x 3 关 ----------
// 每章 = 一个势力 + 一个阵型池 + 一个 Boss + 一套色调。
// 每章 3 关 = 同一势力的三种强度与目标（前哨 / 鏖战 / 决战）。
// 敌人是上一章势力的对手，符合演义时间线：黄巾 → 董卓(西凉) → 袁绍(河北) → 曹操(魏) → 赤壁 → 吕布。
const stage = (
  index: number, name: string, durationSec: number,
  objective: ObjectiveKind, target: number, spawnMul: number, bossId?: string
): StageDef => ({
  index, name, durationSec, objective, target, spawnMul, bossId,
  bossAt: bossId ? Math.round(durationSec * 0.3) : undefined
})

export const CAMPAIGN: ChapterDef[] = [
  {
    id: 'c1', index: 1, name: '黄巾之乱', subtitle: '苍天已死，黄天当立',
    faction: 'yellowturban', formations: ['swarm', 'crescent'], tint: 0x3a2a10,
    reward: ['strat_fire'],
    stages: [
      stage(1, '前哨', 240, 'survive', 0, 0.85),
      stage(2, '鏖战', 300, 'kill', 120, 1.0),
      stage(3, '颍川决战', 360, 'survive', 0, 1.15)
    ]
  },
  {
    id: 'c2', index: 2, name: '汜水关', subtitle: '温酒斩华雄',
    faction: 'xiliang', formations: ['swarm', 'arrow'], tint: 0x3a3018,
    reward: ['caltrop', 'strat_ambush'],
    stages: [
      stage(1, '关前哨骑', 240, 'survive', 0, 0.85),
      stage(2, '铁骑冲阵', 300, 'kill', 140, 1.0),
      stage(3, '斩华雄', 420, 'boss', 0, 1.15, 'boss_warlord')
    ]
  },
  {
    id: 'c3', index: 3, name: '界桥之战', subtitle: '河北四庭柱',
    faction: 'hebei', formations: ['fishscale', 'wildgoose'], tint: 0x1e2a2a,
    reward: ['zhangfei', 'strat_emptycity'],
    stages: [
      stage(1, '界桥前哨', 240, 'survive', 0, 0.85),
      stage(2, '盾弓齐进', 300, 'kill', 150, 1.0),
      stage(3, '斩颜良', 420, 'boss', 0, 1.15, 'boss_yanliang')
    ]
  },
  {
    id: 'c4', index: 4, name: '长坂坡', subtitle: '百万军中藏阿斗',
    faction: 'wei', formations: ['square', 'fishscale'], tint: 0x1a2438,
    reward: ['heavybow', 'strat_chain'],
    stages: [
      stage(1, '当阳道', 240, 'survive', 0, 0.85),
      stage(2, '重甲围阵', 300, 'kill', 150, 1.0),
      stage(3, '拒曹操', 420, 'boss', 0, 1.15, 'boss_caocao')
    ]
  },
  {
    id: 'c5', index: 5, name: '赤壁之战', subtitle: '东风不与周郎便',
    faction: 'wu', formations: ['wildgoose', 'crescent'], tint: 0x3a1414,
    reward: ['zhaoyun', 'strat_laststand'],
    stages: [
      stage(1, '江上哨探', 240, 'survive', 0, 0.85),
      stage(2, '箭雨蔽江', 300, 'kill', 150, 1.0),
      stage(3, '破甘宁', 420, 'boss', 0, 1.15, 'boss_ganning')
    ]
  },
  {
    id: 'c6', index: 6, name: '白门楼', subtitle: '天下英雄，唯使君与操耳',
    faction: 'qunxiong', formations: ['crescent', 'square', 'arrow'], tint: 0x2e2410,
    reward: ['guandao'],
    stages: [
      stage(1, '下邳合围', 240, 'survive', 0, 0.9),
      stage(2, '混编死斗', 300, 'kill', 160, 1.05),
      stage(3, '白门楼 · 斩吕布', 450, 'boss', 0, 1.2, 'boss_tyrant')
    ]
  }
]

// 武将。**四个人机制真的不同** —— 起始武器、生命、移速、被动四项全不一样。
export const CHARS: CharDef[] = [
  {
    id: 'rookie', name: '刘备', title: '仁德 · 均衡', color: 0x4ecdc4,
    weapon: 'bow', hp: 100, speed: 220,
    passiveId: 'bounty', passiveName: '仁德', passiveDesc: '拾取范围 +70%'
  },
  {
    id: 'guanyu', name: '关羽', title: '武圣 · 重击', color: 0xd63031,
    weapon: 'guandao', hp: 120, speed: 195,
    passiveId: 'lifesteal', passiveName: '武圣', passiveDesc: '每次击杀回复 3 生命'
  },
  {
    id: 'zhangfei', name: '张飞', title: '断喝 · 坦克', color: 0x0984e3,
    weapon: 'snake', hp: 150, speed: 185,
    passiveId: 'thorns', passiveName: '咆哮', passiveDesc: '受击反弹 60%'
  },
  {
    id: 'zhaoyun', name: '赵云', title: '龙胆 · 机动', color: 0x00b894,
    weapon: 'spear', hp: 90, speed: 265,
    passiveId: 'dash', passiveName: '龙胆', passiveDesc: '移速 +20%，无敌更长'
  }
]

// 解锁项的展示名（用于结算提示与备战界面）
export const META_NAMES: Record<string, string> = {
  bow: '短弓', crossbow: '连弩', caltrop: '铁蒺藜', heavybow: '强弩',
  spear: '亮银枪', knives: '回旋飞刀', guandao: '青龙偃月', snake: '丈八蛇矛',
  rookie: '刘备', guanyu: '关羽', zhangfei: '张飞', zhaoyun: '赵云',
  strat_fire: '计谋·火计', strat_emptycity: '计谋·空城计', strat_slowdown: '计谋·缓兵计',
  strat_ambush: '计谋·十面埋伏', strat_chain: '计谋·连环计', strat_laststand: '计谋·背水一战'
}

export const BALANCE = {
  // 下面两项只是**兜底默认值** —— 实际以 CHARS 里每个武将的 hp/speed 为准，
  // 见 GameScene.startRun()。保留它们是为了在没有选中武将时也能安全初始化。
  playerMaxHp: 100,
  playerSpeed: 220,
  // 经验曲线。旧值（每杀 3 点、首级 10 点）会让玩家在前 17 秒连升 3 级 ——
  // 升级面板会**暂停整个游戏**，等于开局 17 秒里被反复打断三次。
  // 现在首级要 7 杀、之后约 1.3 倍递增，节奏落到"第一分钟升 2~3 级"。
  expPerKill: 2,
  expToLevel: 14,
  /** 兜底时长：只有理论上"没有章节"时才用得上，正常由 StageDef.durationSec 决定。 */
  runMinutes: 15
}

export function enemyById(id: string): EnemyDef {
  return ENEMIES.find((e) => e.id === id) || ENEMIES[0]
}
export function weaponById(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id)
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
