// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/dive/unlocks.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 解锁引擎 —— 把 `profile.ts` 从"记分板"变成"解锁引擎"的那一层。
 *
 * ---------------------------------------------------------------------------
 * 三类解锁 + 一类购买
 * ---------------------------------------------------------------------------
 *   潜航器 / 武器 / 遗物  ← **达成条件**即解锁（`reached(p)`）
 *   永久强化（perk）      ← 花 `bio` **购买**，每项 5 级封顶
 *
 * "已解锁"的判定统一是 **已记录 ∪ 条件已达成**：
 *   `p.unlocks.includes(id) || reached(p)`
 * 为什么不是只看 `p.unlocks`：老存档、以及**从没结算过一句的新档**里
 * `unlocks` 是空的。若只看它，默认武器（机枪/鱼叉/回声）会被锁掉、
 * 第一局连商店都刷不出武器 —— 那是"解锁系统把游戏锁死了"的经典事故。
 * 把 `reached` 也算进来之后，默认项天生可用，而 `settleProgress()` 会在
 * 第一局结算时把它们正式写进 `unlocks`（于是装置坞能显示"已解锁"）。
 *
 * ---------------------------------------------------------------------------
 * 两条设计红线（元系统设计 V6.36 §5 / 计划书 §11）
 * ---------------------------------------------------------------------------
 * 1. **绝不做局外氪金直加局内强度**：perk 满级总增幅 ≤ 单局单件装备的量级
 *    （单局内武器升级 +35%/级、遗物 +12%~+50%），所以三项满级合计约等于
 *    "白送两个遗物"——是"起步更顺"，不是"变强"。
 * 2. **门槛要低**：解锁条件刻画的是"你玩过这类内容"，不是"你肝了多久"。
 *    所以条件都是"遇见 N 次 / 抵达 L3 / 上浮 1 次"这种一眼可达成的量级。
 *
 * ⚠️ 本文件是**引擎无关的共享真源**（`shared/`），零 `cc` / Phaser 依赖。
 */

import type { Profile } from './profile'
import { RELIC_DEF } from './tables'
import { CARD_POOL } from './pool'
// 武器族的顺序表与中文名从 `codex.ts` 取 —— 全局只有那一份（见下方注释）
import { WEAPON_FAMILIES, WEAPON_NAME } from './codex'
import type { UpgradeDef, RelicId, WeaponFamily } from './types'

// ---------------------------------------------------------------------------
// 解锁项（达成即解锁）
// ---------------------------------------------------------------------------
export type UnlockKind = 'sub' | 'weapon' | 'relic'

export interface UnlockDef {
  id: string
  kind: UnlockKind
  name: string
  /** 达成条件的**人话说明**（未解锁时显示在装置坞） */
  cond: string
  /** 条件是否已达成。缺省 = 永不自动达成（留给"纯购买"类，本表里没有） */
  reached?: (p: Profile) => boolean
}

/** 潜航器 id → 展示名（与 `subs.ts` 的顺序一致） */
const SUB_NAME: Record<string, string> = { lumen: '灯艇', raia: '刺鳐', bathy: '深潜者' }

// ⚠️ `WEAPON_FAMILIES` / `WEAPON_NAME` **不在这里定义** —— 唯一的定义在 `codex.ts`。
//    这里曾经有一份副本，V6.46 加三个族时只改了 codex 那份，这份漏掉当场编译报错。
//    两份定义看着"只是重复"，实际是**每个新增武器族都要记得改两处**的陷阱。
/** 默认解锁的武器族（开局能抽到的三把） */
const DEFAULT_WEAPONS: WeaponFamily[] = ['gun', 'harpoon', 'echo']
/** 默认解锁的遗物（其余 6 条按里程碑解锁） */
const DEFAULT_RELICS: RelicId[] = [
  'echo_heart', 'osteoblast', 'tidal_compass', 'gluttony', 'current_fin', 'silent_plating',
]

export const UNLOCKS: UnlockDef[] = [
  // ---- 潜航器（计划书 §5.3 / 元系统设计 §3.1）----
  { id: 'sub:lumen', kind: 'sub', name: SUB_NAME.lumen, cond: '初始艇',
    reached: () => true },
  { id: 'sub:raia', kind: 'sub', name: SUB_NAME.raia, cond: '累计上浮兑现 ≥ 5 次',
    reached: p => p.surfaced >= 5 },
  { id: 'sub:bathy', kind: 'sub', name: SUB_NAME.bathy, cond: '最深抵达 L4 热泉带',
    reached: p => p.bestLayer >= 3 },

  // ---- 武器（元系统设计 §3.2；条件全部对齐"战斗层真实存在的敌人"）----
  { id: 'weapon:gun', kind: 'weapon', name: WEAPON_NAME.gun, cond: '初始武器',
    reached: () => true },
  { id: 'weapon:harpoon', kind: 'weapon', name: WEAPON_NAME.harpoon, cond: '初始武器',
    reached: () => true },
  { id: 'weapon:echo', kind: 'weapon', name: WEAPON_NAME.echo, cond: '初始武器',
    reached: () => true },
  { id: 'weapon:torpedo', kind: 'weapon', name: WEAPON_NAME.torpedo, cond: '遇见漂移水母 ≥ 20 只',
    reached: p => (p.seen['enemy:drift'] ?? 0) >= 20 },
  { id: 'weapon:sonar', kind: 'weapon', name: WEAPON_NAME.sonar, cond: '遇见游群 ≥ 120 只',
    reached: p => (p.seen['enemy:swarm'] ?? 0) >= 120 },
  { id: 'weapon:arc', kind: 'weapon', name: WEAPON_NAME.arc, cond: '遇见冲刺体 ≥ 80 只',
    reached: p => (p.seen['enemy:dash'] ?? 0) >= 80 },
  { id: 'weapon:acid', kind: 'weapon', name: WEAPON_NAME.acid, cond: '抵达 L3 午夜带',
    reached: p => p.bestLayer >= 2 },
  // V6.46 三把机制武器。三条解锁条件刻意**各用不同维度**（经济 / 遇见 / 深度），
  // 且都排在"玩家已经会玩"之后 —— 这三把都是"换思路"的武器，
  // 开局白送会被当成弱武器跳过，反而没人发现它们的价值。
  { id: 'weapon:mine', kind: 'weapon', name: WEAPON_NAME.mine, cond: '累计沉淀 ≥ 900',
    reached: p => p.totalBanked >= 900 },
  { id: 'weapon:net', kind: 'weapon', name: WEAPON_NAME.net, cond: '遇见冲刺体 ≥ 150 只',
    reached: p => (p.seen['enemy:dash'] ?? 0) >= 150 },
  { id: 'weapon:lure', kind: 'weapon', name: WEAPON_NAME.lure, cond: '抵达 L4 热泉带',
    reached: p => p.bestLayer >= 3 },

  // ---- 遗物（默认 6 + 里程碑 6）----
  ...DEFAULT_RELICS.map((id): UnlockDef => ({
    id: 'relic:' + id, kind: 'relic', name: RELIC_DEF[id].name, cond: '初始可抽',
    reached: () => true,
  })),
  { id: 'relic:resonance_core', kind: 'relic', name: RELIC_DEF.resonance_core.name, cond: '见过深渊守望者',
    reached: p => (p.seen['boss:abyss'] ?? 0) >= 1 },
  { id: 'relic:abyss_mark', kind: 'relic', name: RELIC_DEF.abyss_mark.name, cond: '抵达 L4 热泉带',
    reached: p => p.bestLayer >= 3 },
  { id: 'relic:conductor_coil', kind: 'relic', name: RELIC_DEF.conductor_coil.name, cond: '累计沉淀 ≥ 500 生物质',
    reached: p => p.totalBanked >= 500 },
  { id: 'relic:bleeding_anchor', kind: 'relic', name: RELIC_DEF.bleeding_anchor.name, cond: '累计下潜 ≥ 10 局',
    reached: p => p.runs >= 10 },
  { id: 'relic:resonance_chamber', kind: 'relic', name: RELIC_DEF.resonance_chamber.name, cond: '通关 ≥ 1 次',
    reached: p => p.normalClears >= 1 },
  { id: 'relic:overload_core', kind: 'relic', name: RELIC_DEF.overload_core.name, cond: '单局带出 ≥ 400 生物质',
    reached: p => p.bestBiomass >= 400 },
]

/** 某一类解锁项（装置坞左列 4 个 tab 用） */
export function unlocksByKind(kind: UnlockKind): UnlockDef[] {
  return UNLOCKS.filter(u => u.kind === kind)
}

/** 解锁项是否"已可用" = 已记录 **或** 条件已达成（见文件头说明） */
export function isUnlocked(p: Profile, id: string): boolean {
  if (p.unlocks.includes(id)) return true
  const def = UNLOCKS.find(u => u.id === id)
  return def?.reached ? def.reached(p) : false
}

/** 本局新达成的解锁项（用于结算屏"解锁：××"那一行） */
export function evalUnlocks(p: Profile): string[] {
  const out: string[] = []
  for (const u of UNLOCKS) {
    if (p.unlocks.includes(u.id)) continue
    if (u.reached?.(p)) out.push(u.id)
  }
  return out
}

// ---------------------------------------------------------------------------
// 里程碑（纯展示成就，不产生战力）
// ---------------------------------------------------------------------------
export interface MilestoneDef {
  id: string
  name: string
  reached: (p: Profile) => boolean
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'mile:first_surface', name: '首次上浮', reached: p => p.surfaced >= 1 },
  { id: 'mile:reach_l3', name: '抵达午夜带', reached: p => p.bestLayer >= 2 },
  { id: 'mile:reach_l5', name: '抵达深渊带', reached: p => p.bestLayer >= 4 },
  { id: 'mile:boss_down', name: '击破守望者', reached: p => p.normalClears >= 1 },
  { id: 'mile:bank_1000', name: '累计沉淀 1000', reached: p => p.totalBanked >= 1000 },
  { id: 'mile:runs_25', name: '下潜 25 次', reached: p => p.runs >= 25 },
]

/** 本局新达成的里程碑 */
export function evalMilestones(p: Profile): string[] {
  return MILESTONES.filter(m => !p.milestones.includes(m.id) && m.reached(p)).map(m => m.id)
}

export interface ProgressOutcome {
  profile: Profile
  /** 本次新解锁的项 id */
  unlocked: string[]
  /** 本次新达成的里程碑 id */
  milestones: string[]
}

/**
 * 一局结束后的**进度结算**（解锁 + 里程碑）。纯函数。
 *
 * 视图层顺序：`applyRun()`（纪录/沉淀/图鉴）→ `settleProgress()`（解锁/里程碑）。
 * 拆成两步是因为解锁要读武器/遗物表，属另一层职责；而且这样两步都能单独测。
 */
export function settleProgress(p: Profile): ProgressOutcome {
  const unlocked = evalUnlocks(p)
  const milestones = evalMilestones(p)
  if (unlocked.length === 0 && milestones.length === 0) return { profile: p, unlocked, milestones }
  return {
    profile: { ...p, unlocks: [...p.unlocks, ...unlocked], milestones: [...p.milestones, ...milestones] },
    unlocked,
    milestones,
  }
}

/** 解锁 id → 展示名（结算屏"解锁：刺鳐"用） */
export function unlockName(id: string): string {
  return UNLOCKS.find(u => u.id === id)?.name ?? id
}

// ---------------------------------------------------------------------------
// 永久强化（perk）：bio 购买，5 级封顶
// ---------------------------------------------------------------------------
export type PerkId = 'reload' | 'hull' | 'sonar'

export interface PerkDef {
  id: PerkId
  name: string
  /** 一句话效果（含每级数值） */
  desc: string
  stat: 'rate' | 'o2Bonus' | 'pickup'
  /** 每级增量（rate/pickup 是百分比小数；o2Bonus 是绝对值） */
  perLvl: number
  maxLvl: number
  /** 价格表：买**第 n 级**用 `prices[n-1]`（长度 = maxLvl） */
  prices: number[]
}

/**
 * 三项永久强化。
 *
 * ⚠️ 满级总增幅是**硬约束**（红线 1）：装填 +10% / 氧气上限 +15 / 吸附 +20%，
 * 合计约等于两个遗物 —— 单局内一件装备的分量。再高就会让"开局就比别人强"
 * 盖过"这一局你打得好不好"。
 */
export const PERKS: PerkDef[] = [
  { id: 'reload', name: '装填效率', desc: '全局射速 +2% / 级', stat: 'rate', perLvl: 0.02, maxLvl: 5, prices: [40, 60, 80, 100, 120] },
  { id: 'hull', name: '结构强化', desc: '氧气上限 +3 / 级', stat: 'o2Bonus', perLvl: 3, maxLvl: 5, prices: [40, 60, 80, 100, 120] },
  { id: 'sonar', name: '声呐调校', desc: '拾取范围 +4% / 级', stat: 'pickup', perLvl: 0.04, maxLvl: 5, prices: [40, 60, 80, 100, 120] },
]

export function perkDef(id: PerkId): PerkDef {
  return PERKS.find(p => p.id === id) ?? PERKS[0]
}

/** 当前等级（钳到 [0, maxLvl] —— 存档被手改也不越界） */
export function perkLevel(p: Profile, id: PerkId): number {
  const d = perkDef(id)
  const v = p.perks[id]
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
  return Math.max(0, Math.min(d.maxLvl, n))
}

/** 升到下一级的价格；已满级返回 null */
export function perkCost(p: Profile, id: PerkId): number | null {
  const d = perkDef(id)
  const lvl = perkLevel(p, id)
  return lvl >= d.maxLvl ? null : d.prices[lvl]
}

/** 买得起吗（已满级也算 false） */
export function canBuyPerk(p: Profile, id: PerkId): boolean {
  const c = perkCost(p, id)
  return c !== null && p.bio >= c
}

/** 购买（纯函数）：扣 bio、等级 +1。调用方须先 `canBuyPerk()` 判过 */
export function buyPerk(p: Profile, id: PerkId): Profile {
  const c = perkCost(p, id)
  if (c === null || p.bio < c) return p
  return { ...p, bio: p.bio - c, perks: { ...p.perks, [id]: perkLevel(p, id) + 1 } }
}

export interface PerkBonus {
  /** 加到 `st.rate` 上 */
  rate: number
  /** 加到 `st.o2Bonus` 上 */
  o2Bonus: number
  /** 加到 `st.pickup` 上 */
  pickup: number
}

/** 开局注入 `DiveWorld` 的三项加成（`WorldOptions.perk`） */
export function perkBonus(p: Profile): PerkBonus {
  let rate = 0, o2Bonus = 0, pickup = 0
  for (const d of PERKS) {
    const v = d.perLvl * perkLevel(p, d.id)
    if (d.stat === 'rate') rate += v
    else if (d.stat === 'o2Bonus') o2Bonus += v
    else pickup += v
  }
  return { rate, o2Bonus, pickup }
}

// ---------------------------------------------------------------------------
// 抽池过滤：把没解锁的武器/遗物从商店里摘掉
// ---------------------------------------------------------------------------
/**
 * 已解锁的武器族。
 *
 * ⚠️ 这是本方案**唯一动到局内**的地方 —— 不改这里，武器"锁了也照抽"（静默失效）。
 * 做法是**在构造世界时过滤卡池**（`DiveGame.mkWorld` 传 `pool: filterPool(profile)`），
 * 而不是改 `pool.ts` 的抽取逻辑 —— 过滤是纯函数、可测，且不影响模拟层的逐帧行为。
 */
export function unlockedWeaponFamilies(p: Profile): Set<WeaponFamily> {
  const out = new Set<WeaponFamily>()
  for (const f of WEAPON_FAMILIES) {
    if (isUnlocked(p, 'weapon:' + f)) out.add(f)
  }
  return out
}

/** 已解锁的遗物 */
export function unlockedRelics(p: Profile): Set<RelicId> {
  const out = new Set<RelicId>()
  for (const id of Object.keys(RELIC_DEF) as RelicId[]) {
    if (isUnlocked(p, 'relic:' + id)) out.add(id)
  }
  return out
}

/**
 * 按解锁状态过滤卡池。
 *
 * 规则：
 *   · `kind === 'weapon'` 且带 `family` 的卡（含进化卡）→ 族锁了就摘掉；
 *     `w_all`（弹药改良，全武器 +1 级）不带 family，永远保留。
 *   · `kind === 'relic'` 的卡 → 遗物没解锁就摘掉。
 *   · 其余（挂载/属性卡）不动。
 */
export function filterPool(p: Profile, pool: UpgradeDef[] = CARD_POOL): UpgradeDef[] {
  const fams = unlockedWeaponFamilies(p)
  const rels = unlockedRelics(p)
  return pool.filter(u => {
    if (u.kind === 'weapon' && u.family && !fams.has(u.family)) return false
    if (u.kind === 'relic' && u.relicId && !rels.has(u.relicId)) return false
    return true
  })
}
