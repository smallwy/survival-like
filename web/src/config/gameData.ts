// 游戏数值与内容数据表（策划向，改这里即可调平衡，不必动逻辑代码）。
//
// 设计定位：**三国兵种战争**，不是"贴了三国名字的通用幸存者"。
// 三条落地原则（对应 docs/方向定位与差异化策略.md 的方向 A）：
//   1. 武器全是冷兵器，没有一件现代火器；
//   2. 四个武将**机制真的不同**（起始武器 / 生命 / 移速 / 被动都不一样），
//      而不是"同一套数值换四个颜色"；
//   3. 敌人带**兵种护甲**，武器带**相克倍率** —— 玩家要按敌潮配置换武器，
//      而不是无脑堆数值。这是本作对抗"同质化"的核心钩子。
//
// 美术策略：
// - 游戏内单位：`tools/pixelgen.py` 程序化生成的像素帧（assets/pixel/），
//   动作（朝向/抬手/迈步）是**画出来的帧**，不靠代码变形去猜。
// - 武器外观同样由 pixelgen 画进 sprite（bow/crossbow/guandao/serpent/spear…），
//   见 tools/pixelgen.py 的 HEROES / FOES 表与 draw_weapon()。
// - AI 立绘（assets/portraits/）只用于静态展示：选人卡片、HUD 头像、商店页。
// - 单位体积由 sprite 的实测包围盒决定（见 manifest.json 的 bbox），
//   所以这里**不再有 radius 字段**。
// - 数值配置与图片分离：改此处可调整敌人速度/血量，无需改图。

export type WeaponKind = 'gun' | 'orbit' | 'beam' | 'aura'

/** 兵种护甲。三国兵种相克的落点 —— 见 WEAPONS 的 vs 表。 */
export type Armor = 'none' | 'light' | 'heavy' | 'cavalry'

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
  /** 势力标签，用于敌潮叙事与结算展示。 */
  faction: string
  shooter?: boolean // 远程射手
  shootCd?: number // 远程攻击间隔 ms
  shootDmg?: number
  isBoss?: boolean
  bossName?: string
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
    desc: '一箭穿透三人', strong: '克轻甲', vs: { light: 1.35, heavy: 0.75 }
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
    desc: '横扫周身，无人可近', strong: '克骑甲', vs: { cavalry: 1.3, none: 1.15 }
  }
]

// 敌人。体型与剪影由 pixelgen 的 build 决定（wisp 瘦高 / brute 宽厚 / tiny 矮小），
// armor 决定"该用哪把武器打"，color 只是辅助识别 —— 弹幕里玩家没空看颜色。
export const ENEMIES: EnemyDef[] = [
  { id: 'minion', name: '黄巾力士', hp: 20, speed: 70, damage: 8, color: 0xff6b6b, armor: 'light', faction: '黄巾' },
  { id: 'runner', name: '轻骑', hp: 14, speed: 135, damage: 6, color: 0xffd93d, armor: 'cavalry', faction: '西凉' },
  { id: 'tank', name: '重甲兵', hp: 70, speed: 45, damage: 14, color: 0x6bcb77, armor: 'heavy', faction: '魏' },
  { id: 'swarm', name: '流民贼寇', hp: 8, speed: 95, damage: 4, color: 0xff9f43, armor: 'none', faction: '黄巾' },
  { id: 'shooter', name: '弓弩手', hp: 30, speed: 50, damage: 0, color: 0xa55eea, armor: 'light', faction: '魏', shooter: true, shootCd: 1600, shootDmg: 10 },
  { id: 'boss_warlord', name: '华雄', hp: 1200, speed: 42, damage: 18, color: 0x9b59b6, armor: 'heavy', faction: '西凉', isBoss: true, bossName: '中期 · 西凉华雄' },
  { id: 'boss_tyrant', name: '吕布', hp: 2600, speed: 38, damage: 24, color: 0xee5253, armor: 'heavy', faction: '群雄', isBoss: true, bossName: '终极 · 飞将吕布' }
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

// 波次导演：随时间推进切换阶段，决定刷怪间隔与敌人构成（权重）
// 刷怪节奏。注意 spawnDirector 会在这些值上再叠加「等级 + 时间」的收紧，
// 并按批次成群刷出，所以这里的数字是**基础节拍**，不是实际出场间隔。
// 权重编排刻意让**护甲类型随阶段推移**（早期轻甲 → 中期骑兵 → 后期重甲），
// 这样"换武器应对"才有时间窗口，而不是一上来就四种护甲混着砸过来。
export const WAVE_STAGES: { startMin: number; spawnInterval: number; weights: Record<string, number> }[] = [
  // 第 1 阶段放两种敌人（黄巾力士 + 轻骑），剪影一眼分得开。
  { startMin: 0, spawnInterval: 620, weights: { minion: 3, runner: 1 } },
  { startMin: 2, spawnInterval: 570, weights: { minion: 3, swarm: 2, runner: 1 } },
  { startMin: 5, spawnInterval: 500, weights: { minion: 3, runner: 3, tank: 1, swarm: 2 } },
  { startMin: 8, spawnInterval: 440, weights: { minion: 3, runner: 3, tank: 2, swarm: 3, shooter: 2 } },
  { startMin: 11, spawnInterval: 390, weights: { minion: 2, runner: 4, tank: 2, swarm: 4, shooter: 3 } },
  { startMin: 13, spawnInterval: 340, weights: { runner: 4, tank: 4, swarm: 5, shooter: 4 } }
]

// Boss 时间表：到达指定分钟且未刷过则刷出
export const BOSS_SCHEDULE = [
  { atMin: 8, enemyId: 'boss_warlord' },
  { atMin: 15, enemyId: 'boss_tyrant' }
]

// 武将。**四个人机制真的不同** —— 起始武器、生命、移速、被动四项全不一样。
// 旧版这里只有 id/name/color 三个字段，startRun() 只换外观，是"和三国无关"的直接原因。
export const CHARS: CharDef[] = [
  {
    id: 'rookie', name: '刘备', title: '仁德 · 均衡', color: 0x4ecdc4,
    weapon: 'bow', hp: 100, speed: 220,
    passiveId: 'bounty', passiveName: '仁德', passiveDesc: "拾取范围 +70%"
  },
  {
    id: 'guanyu', name: '关羽', title: '武圣 · 重击', color: 0xd63031,
    weapon: 'guandao', hp: 120, speed: 195,
    passiveId: 'lifesteal', passiveName: '武圣', passiveDesc: '每次击杀回复 3 生命'
  },
  {
    id: 'zhangfei', name: '张飞', title: '断喝 · 坦克', color: 0x0984e3,
    weapon: 'snake', hp: 150, speed: 185,
    passiveId: 'thorns', passiveName: '咆哮', passiveDesc: "受击反弹 60%"
  },
  {
    id: 'zhaoyun', name: '赵云', title: '龙胆 · 机动', color: 0x00b894,
    weapon: 'spear', hp: 90, speed: 265,
    passiveId: 'dash', passiveName: '龙胆', passiveDesc: "移速 +20%，无敌更长"
  }
]

// 解锁项的展示名（用于结算提示）
export const META_NAMES: Record<string, string> = {
  bow: '短弓', crossbow: '连弩', caltrop: '铁蒺藜', heavybow: '强弩',
  spear: '亮银枪', knives: '回旋飞刀', guandao: '青龙偃月', snake: '丈八蛇矛',
  rookie: '刘备', guanyu: '关羽', zhangfei: '张飞', zhaoyun: '赵云'
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
  runMinutes: 15 // 单局时长（与 BOSS_SCHEDULE 末项对齐）
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
