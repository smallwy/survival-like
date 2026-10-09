// 游戏数值与内容数据表（策划向，改这里即可调平衡，不必动逻辑代码）。
// 美术依赖极低：所有单位都是同一种圆点纹理，仅靠颜色/大小/数值区分。

export interface WeaponDef {
  id: string
  name: string
  damage: number // 每发伤害
  cooldown: number // 发射间隔 ms
  speed: number // 子弹速度 px/s
  count: number // 一次发射几发（霰弹>1）
}

export interface EnemyDef {
  id: string
  name: string
  hp: number
  speed: number
  damage: number
  color: number // 16 进制颜色，仅用于着色
  radius: number // 视觉/碰撞半径
}

export interface UpgradeDef {
  id: string
  name: string
  desc: string
}

// 武器：起始只有手枪，升级可再获得
export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: '手枪', damage: 12, cooldown: 450, speed: 480, count: 1 },
  { id: 'shotgun', name: '霰弹', damage: 7, cooldown: 850, speed: 420, count: 5 },
  { id: 'orbit', name: '环绕球', damage: 9, cooldown: 600, speed: 300, count: 2 }
]

// 敌人：颜色即外观，换数值即可出新怪
export const ENEMIES: EnemyDef[] = [
  { id: 'minion', name: '小怪', hp: 20, speed: 70, damage: 8, color: 0xff6b6b, radius: 10 },
  { id: 'runner', name: '快怪', hp: 14, speed: 130, damage: 6, color: 0xffd93d, radius: 8 },
  { id: 'tank', name: '胖怪', hp: 70, speed: 45, damage: 14, color: 0x6bcb77, radius: 16 }
]

// 升级池：升级时随机抽 3 个让玩家选
export const UPGRADES: UpgradeDef[] = [
  { id: 'dmg', name: '伤害 +20%', desc: '所有武器伤害提升' },
  { id: 'spd', name: '移速 +15%', desc: '玩家移动更快' },
  { id: 'cd', name: '攻速 +15%', desc: '武器冷却缩短' },
  { id: 'hp', name: '血量 +25', desc: '最大生命提升并回满该值' },
  { id: 'magnet', name: '拾取 +', desc: '经验拾取范围扩大' },
  { id: 'newgun', name: '新武器', desc: '随机获得一把武器' }
]

// 全局基线（solo 调平衡从这里改）
export const BALANCE = {
  playerMaxHp: 100,
  playerSpeed: 220,
  expPerKill: 3,
  expToLevel: 10, // 1 级所需经验，之后按 1.25 倍递增
  spawnIntervalMs: 900, // 初始刷怪间隔（随等级缩短，见场景）
  runMinutes: 15 // 单局时长
}
