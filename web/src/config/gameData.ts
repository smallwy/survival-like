// 游戏数值与内容数据表（策划向，改这里即可调平衡，不必动逻辑代码）。
// 美术策略：
// - 玩家 + 敌人/BOSS：使用 AI 生成的 1024x1024 chibi 立绘 PNG（按半径缩放显示，见 portraits/）。
// - 子弹/敌人子弹/拾取/环绕球：白色圆点运行时着色。
// - 数值配置与图片分离：改此处可调整敌人大小/速度/血量，无需改图。

export type WeaponKind = 'gun' | 'orbit' | 'beam' | 'aura'

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
}

export interface EnemyDef {
  id: string
  name: string
  hp: number
  speed: number
  damage: number // 接触伤害（shooter 为 0）
  color: number
  radius: number
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

// 武器：起始只有手枪，其余靠 meta 解锁后才能在升级里获得
export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: '手枪', kind: 'gun', damage: 12, cooldown: 450, speed: 480, count: 1, spread: 0, pierce: 0, radius: 0, range: 0, color: 0xffe066, desc: '基础远程' },
  { id: 'smg', name: '冲锋枪', kind: 'gun', damage: 6, cooldown: 140, speed: 540, count: 1, spread: 0.12, pierce: 0, radius: 0, range: 0, color: 0xffe066, desc: '高射速低伤' },
  { id: 'shotgun', name: '霰弹枪', kind: 'gun', damage: 7, cooldown: 850, speed: 420, count: 5, spread: 0.5, pierce: 0, radius: 0, range: 0, color: 0xffa502, desc: '近距散射' },
  { id: 'rifle', name: '穿透步枪', kind: 'gun', damage: 20, cooldown: 700, speed: 720, count: 1, spread: 0, pierce: 3, radius: 0, range: 0, color: 0xff7f50, desc: '穿透多个敌人' },
  { id: 'orbit', name: '环绕球', kind: 'orbit', damage: 9, cooldown: 0, speed: 2.2, count: 3, spread: 0, pierce: 0, radius: 95, range: 0, color: 0x4ecdc4, desc: '环绕自动撞击' },
  { id: 'beam', name: '激光束', kind: 'beam', damage: 38, cooldown: 1500, speed: 0, count: 1, spread: 0, pierce: 0, radius: 0, range: 420, color: 0xff6bff, desc: '瞬发直线高伤' },
  { id: 'aura', name: '灼烧光环', kind: 'aura', damage: 7, cooldown: 480, speed: 0, count: 0, spread: 0, pierce: 0, radius: 75, range: 0, color: 0xff4757, desc: '持续范围灼烧' }
]

// 敌人：radius = 角色真实身高的半径（立绘已归一化到 256 画布且填满，所见即所得）
export const ENEMIES: EnemyDef[] = [
  { id: 'minion', name: '小怪', hp: 20, speed: 70, damage: 8, color: 0xff6b6b, radius: 17 },
  { id: 'runner', name: '快怪', hp: 14, speed: 135, damage: 6, color: 0xffd93d, radius: 15 },
  { id: 'tank', name: '胖怪', hp: 70, speed: 45, damage: 14, color: 0x6bcb77, radius: 25 },
  { id: 'swarm', name: '虫群', hp: 8, speed: 95, damage: 4, color: 0xff9f43, radius: 12 },
  { id: 'shooter', name: '射手', hp: 30, speed: 50, damage: 0, color: 0xa55eea, radius: 19, shooter: true, shootCd: 1600, shootDmg: 10 },
  { id: 'boss_warlord', name: '霸主', hp: 1200, speed: 42, damage: 18, color: 0x9b59b6, radius: 52, isBoss: true, bossName: '中期 Boss · 霸主' },
  { id: 'boss_tyrant', name: '暴君', hp: 2600, speed: 38, damage: 24, color: 0xee5253, radius: 66, isBoss: true, bossName: '终极 Boss · 暴君' }
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
  { id: 'newgun', name: '新武器', desc: '获得一把已解锁的武器' }
]

// 波次导演：随时间推进切换阶段，决定刷怪间隔与敌人构成（权重）
export const WAVE_STAGES: { startMin: number; spawnInterval: number; weights: Record<string, number> }[] = [
  { startMin: 0, spawnInterval: 900, weights: { minion: 1 } },
  { startMin: 2, spawnInterval: 800, weights: { minion: 3, runner: 2 } },
  { startMin: 5, spawnInterval: 700, weights: { minion: 3, runner: 3, tank: 1, swarm: 2 } },
  { startMin: 8, spawnInterval: 600, weights: { minion: 3, runner: 3, tank: 2, swarm: 3, shooter: 2 } },
  { startMin: 11, spawnInterval: 520, weights: { minion: 2, runner: 4, tank: 2, swarm: 4, shooter: 3 } },
  { startMin: 13, spawnInterval: 450, weights: { runner: 4, tank: 3, swarm: 5, shooter: 4 } }
]

// Boss 时间表：到达指定分钟且未刷过则刷出
export const BOSS_SCHEDULE = [
  { atMin: 8, enemyId: 'boss_warlord' },
  { atMin: 15, enemyId: 'boss_tyrant' }
]

// 三国皮肤（仅换着色与名字，美术零成本，作为 meta 解锁的可选皮肤）
export const CHARS = [
  { id: 'rookie', name: '新人', color: 0x4ecdc4 },
  { id: 'guanyu', name: '关二哥', color: 0xd63031 },
  { id: 'zhangfei', name: '张三爷', color: 0x0984e3 },
  { id: 'zhaoyun', name: '赵子龙', color: 0x00b894 }
]

// 解锁项的展示名（用于结算提示）
export const META_NAMES: Record<string, string> = {
  pistol: '手枪', smg: '冲锋枪', shotgun: '霰弹枪', rifle: '穿透步枪',
  orbit: '环绕球', beam: '激光束', aura: '灼烧光环',
  rookie: '新人', guanyu: '关二哥', zhangfei: '张三爷', zhaoyun: '赵子龙'
}

export const BALANCE = {
  playerMaxHp: 100,
  playerSpeed: 220,
  expPerKill: 3,
  expToLevel: 10, // 1 级所需经验，之后按 1.25 倍递增
  runMinutes: 15 // 单局时长（与 BOSS_SCHEDULE 末项对齐）
}

export function enemyById(id: string): EnemyDef {
  return ENEMIES.find((e) => e.id === id) || ENEMIES[0]
}
export function weaponById(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id)
}
