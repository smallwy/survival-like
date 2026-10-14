// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/dive/codex.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 图鉴（codex）—— **只记录，绝不产生战力**（红线，见元系统设计 V6.36 §5）。
 *
 * ---------------------------------------------------------------------------
 * 为什么图鉴要"只记录"而不是"集齐给加成"
 * ---------------------------------------------------------------------------
 * "集齐换战力"是同一条红线（不做局外氪金直加局内强度）的另一张面孔：
 * 它把收集从"我想去看看那是什么"变成"我必须刷满才不吃亏"。本作的图鉴是
 * **认识深海**的一部分 —— 你死过一局，才会在名册上多一条"哦，那东西叫漂移水母"。
 *
 * ---------------------------------------------------------------------------
 * 计数从哪来
 * ---------------------------------------------------------------------------
 * `codexGains()` 收一局的"快照"（刷怪计数 / 用过的武器 / 装备过的遗物 / 是否打完 Boss），
 * 产出一份 **id → 增量** 的 map，交给 `profile.applyRun()` 累加进 `Profile.seen`。
 * 之所以不让 `codex.ts` 直接改档案：保持"计数怎么来的"和"计数怎么存"两件事分离，
 * 前者可测、后者只管合并。
 *
 * id 命名是**带前缀**的（`enemy:` / `boss:` / `weapon:` / `relic:`）——
 * 一眼能看出这条属于哪一类，且四类的 id 空间不会互相撞车。
 */

import { RELIC_DEF } from './tables'
import type { RelicId, WeaponFamily } from './types'

export type CodexCat = 'enemy' | 'boss' | 'weapon' | 'relic'

/** 图鉴分类的展示名（图鉴屏的 tab 用它） */
export const CODEX_CAT_NAME: Record<CodexCat, string> = {
  enemy: '敌人', boss: '首领', weapon: '武器', relic: '遗物',
}

export interface CodexEntry {
  id: string
  cat: CodexCat
  name: string
  /** 未见时显示的一句"提示"（剪影 + 这句 —— 保留轮廓信息才有补图鉴的动力） */
  hint: string
}

/** 7 个武器族（与 `WeaponFamily` 一一对应） */
/**
 * 武器族的**唯一一份**顺序表与中文名。
 *
 * ⚠️ 这两条曾经在 `codex.ts` 与 `unlocks.ts` **各有一份**（重复真源）。
 *    V6.46 加了三个族时，只改了 codex 那份、unlocks 那份漏了，TS 当场报
 *    "missing properties: mine, net, lure"。现在只有 codex 这一份，unlocks 引用它。
 */
export const WEAPON_FAMILIES: WeaponFamily[] = [
  'gun', 'torpedo', 'arc', 'sonar', 'harpoon', 'echo', 'acid',
  // V6.46 三个机制族
  'mine', 'net', 'lure',
]

export const WEAPON_NAME: Record<WeaponFamily, string> = {
  gun: '脉冲机枪', torpedo: '追踪鱼雷', arc: '链式电弧', sonar: '声呐共振',
  harpoon: '穿透鱼叉', echo: '回声炮', acid: '酸液喷射',
  mine: '气泡雷', net: '网发射器', lure: '生物光诱饵',
}

/**
 * 图鉴条目全表。
 *
 * 敌人只收**战斗层真实存在的 3 种移动体**（swarm/dash/drift）+ Boss 一条 ——
 * 不像策划表那样罗列一堆打不到的兵种（那会让图鉴永远填不满，反而劝退）。
 */
export const CODEX: CodexEntry[] = [
  // ---- 敌人（DiveWorld.spawnEnemy 的 kind）----
  { id: 'enemy:swarm', cat: 'enemy', name: '游群', hint: '成群压上来的基础体，血薄量大' },
  { id: 'enemy:dash', cat: 'enemy', name: '冲刺体', hint: '先蓄力再暴冲，红色预警后要闪开' },
  { id: 'enemy:drift', cat: 'enemy', name: '漂移水母', hint: '慢、肉厚、值钱，是大目标' },
  // ---- 首领 ----
  { id: 'boss:abyss', cat: 'boss', name: '深渊守望者', hint: '深渊带最后一波才现身的东西' },
  // ---- 武器（按族）----
  ...WEAPON_FAMILIES.map((f): CodexEntry => ({
    id: 'weapon:' + f, cat: 'weapon', name: WEAPON_NAME[f], hint: '尚未在商店里见过它',
  })),
  // ---- 遗物（按 id）----
  ...(Object.keys(RELIC_DEF) as RelicId[]).map((id): CodexEntry => ({
    id: 'relic:' + id, cat: 'relic', name: RELIC_DEF[id].name, hint: '被动道具，改变打法而不只是加数字',
  })),
]

/** 图鉴里某一类的条目（图鉴屏按 tab 取） */
export function codexByCat(cat: CodexCat): CodexEntry[] {
  return CODEX.filter(e => e.cat === cat)
}

/** 一局的图鉴快照 —— 全部来自 `DiveWorld` 的现成字段，视图层负责取 */
export interface CodexSnapshot {
  /** 本局刷怪计数（`DiveWorld.spawned`，按 kind 计） */
  spawned: Record<string, number>
  /** 本局是否打完/in 场过 Boss */
  bossDown: boolean
  /** 本局装备/拥有过的武器 id（`world.weapons.map(w => w.id)`） */
  weaponIds: string[]
  /** 本局装备过的遗物 id（`world.relics`） */
  relicIds: string[]
}

/**
 * 由快照产出 **id → 增量**。空增量不写（免得 `seen` 里堆一堆 0）。
 *
 * 敌人按**刷怪计数**记（"遇见次数"），Boss / 武器 / 遗物各记 1 次 ——
 * 后三者没有"遇见几次"的合理语义（一把武器只用 1 次和用 100 次价值一样）。
 */
export function codexGains(snap: CodexSnapshot): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (id: string, n: number) => { if (n > 0) out[id] = (out[id] ?? 0) + n }

  for (const k of ['swarm', 'dash', 'drift'] as const) {
    add('enemy:' + k, snap.spawned[k] ?? 0)
  }
  if (snap.bossDown) add('boss:abyss', 1)

  // 武器：把 id 归到"族"（进化形态也是同一个族，不重复计数）
  const famOf: Record<string, WeaponFamily> = {
    gun: 'gun', gun_gl: 'gun', gun_sg: 'gun',
    torpedo: 'torpedo', torp_cl: 'torpedo', torp_hv: 'torpedo',
    arc: 'arc', arc_ov: 'arc', arc_st: 'arc',
    sonar: 'sonar', sonar_rs: 'sonar', sonar_fc: 'sonar',
    harpoon: 'harpoon', harp_tr: 'harpoon', harp_cb: 'harpoon',
    echo: 'echo', echo_mu: 'echo', echo_fo: 'echo',
    acid: 'acid', acid_fd: 'acid', acid_ra: 'acid',
  }
  const fams = new Set<WeaponFamily>()
  for (const id of snap.weaponIds) { const f = famOf[id]; if (f) fams.add(f) }
  for (const f of fams) add('weapon:' + f, 1)

  for (const id of snap.relicIds) add('relic:' + id, 1)

  return out
}
