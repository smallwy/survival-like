/**
 * 本地档案 —— 跨局的纪录 **与解锁**（不是局内存档）。
 *
 * ---------------------------------------------------------------------------
 * 为什么是"新增"而不是"移植"
 * ---------------------------------------------------------------------------
 * web 侧**没有任何存档**：`DiveScene.ts` 全文件不含 localStorage，也没发过任何
 * 网络请求。仓库里的 `server/` 确实有一套完整的 `/api/save` `/api/load`
 * `/api/meta` `/api/leaderboard`（Go，491 行），但前端从未调用过它 —— 是空壳。
 *
 * 所以这里决定：**先做本地档案，不接服务端**。理由：
 *   · 单机进度不需要账号体系；接服务端等于顺带引入登录/身份/网络失败态，
 *     那是另一个量级的工作，且没人要求过；
 *   · Cocos 的 `sys.localStorage` 在 Web 上就是 `window.localStorage`，
 *     在原生平台会落到各平台的本地存储 —— 一套代码全平台可用。
 *
 * ---------------------------------------------------------------------------
 * 为什么逻辑放在 `shared/` 而读写放在视图层
 * ---------------------------------------------------------------------------
 * 本文件是**纯函数 + 纯数据**：不 import 引擎、不碰存储。于是
 *   · 它能被无头冒烟测试直接覆盖（`tools/dive_sim_smoke.js` 里断言过）；
 *   · 换引擎/换存储后端时这份逻辑一行都不用改。
 * 真正"和平台存储打交道"的只有 `cocos/assets/scripts/view/save.ts` 那 20 行。
 *
 * ---------------------------------------------------------------------------
 * 存什么、不存什么
 * ---------------------------------------------------------------------------
 * 只存**跨局有意义**的东西：纪录 + 跨局货币 + 解锁集 + 图鉴计数。
 * 局内的东西（氧气、武器、遗物、当前层）一律不存 —— 那是 roguelike 的一局，
 * 本来就不该续。这也意味着"半途退出"没有损失语义，不需要处理"读档回到一半"。
 *
 * 层号与波次都是 **0 基**（跟 `layerIdx` / `waveInLayer` 对齐），显示时 +1。
 * 显示文案统一走 `depthLabel()`，免得标题屏和结算屏各写一份格式。
 *
 * ---------------------------------------------------------------------------
 * V6.36：v1 → v2（只加不改）
 * ---------------------------------------------------------------------------
 * v1 只有 6 个字段，**全是纪录、0 解锁** —— 死一局，手上选项一件没多。
 * v2 在**原样保留那 6 个字段**的基础上，加了跨局货币 / 解锁集 / 图鉴 / 里程碑。
 *
 * 迁移策略（红线：**存档迁移写错是唯一会让老玩家进度全灭的错误**）：
 *   · v1 是 v2 的**子集**，`normalizeProfile()` 逐字段回退天然完成迁移
 *     —— 旧纪录一个不丢，新字段全走默认值。
 *   · `migrateV1toV2()` 是显式入口（纯函数、可测），语义就是"洗一遍"。
 *   · 存储 key 升到 v2，读档时**先读 v2、没有再回落到 v1**；旧 key 不删（回滚保护）。
 */

import { SUBS } from '../subs'
import type { SubId } from '../subs'

/**
 * 档案版本号。
 *
 * 作用不是"好看"，而是将来加字段时能判断要不要迁移 —— 而不是靠"看字段在不在"
 * 这种一旦字段合法但语义变了就失效的猜想。读到旧版本时按新结构重新洗一遍
 * （缺的字段用默认值），代价是旧字段若被改名会丢，但**不会崩**。
 */
export const PROFILE_VERSION = 2

/**
 * 沉淀率：一局带出的生物质里，有多少比例转成**跨局货币** `bio`。
 *
 * ⚠️ 红线：**≤ 30%**（元系统设计 V6.36 §5）。这里是 25%，留 5% 余量。
 * 为什么不能高：生物质是"下潜 vs 上浮"这条取舍线的筹码，沉淀太多会让玩家
 * 觉得"反正死了也攒得到"，从而削弱 §10 止损线的意义。
 * 25% 的读数：一局带出 400 → 攒 100，三~四局能买一项永久强化的第一级。
 */
export const BANK_RATE = 0.25

export interface Profile {
  v: number
  // ---- v1 原样保留（迁移时不丢）----
  /** 历史最佳「带出生物质」（溺水为 0 —— 见 web 的结算公式） */
  bestBiomass: number
  /** 历史最深到达的层（0 基） */
  bestLayer: number
  /** 在上述那一层里到达的最远波次（0 基）。层与波次必须成对看： */
  /** "第 3 层第 2 波"比"第 5 层第 0 波"浅，单看波次没有意义。 */
  bestWave: number
  /** 累计下潜局数（标题屏用来区分"新玩家"与"老玩家"） */
  runs: number
  /** 是否击杀过深渊守望者 */
  cleared: boolean
  /** 上次选的潜航器（标题屏默认选中它） */
  lastSub: SubId
  // ---- v2 新增 ----
  /** 跨局货币（沉淀生物质），持久。用来买永久强化 */
  bio: number
  /** 累计沉淀总量（条件判断用，如"累计沉淀 ≥ 1000"） */
  totalBanked: number
  /** 成功上浮兑现的局数（溺水不计）—— 刺鳐的解锁条件 */
  surfaced: number
  /** 已解锁项 id 集合（见 `unlocks.ts` 的 `UnlockDef.id`） */
  unlocks: string[]
  /** 图鉴：id → 遇见次数（>0 即"已见"）。只记录，**绝不产生战力** */
  seen: Record<string, number>
  /** 已达成的里程碑 id */
  milestones: string[]
  /** 通关次数（将来难度阶梯用） */
  normalClears: number
  /** 永久强化等级：perk id → 等级（见 `unlocks.ts` 的 `PERKS`） */
  perks: Record<string, number>
}

/** 一局的结算结果（由视图层从 `DiveWorld` 现成字段里取，不用自己算） */
export interface RunResult {
  /** **带出的**生物质；溺水时调用方应传 0 */
  biomass: number
  /** 0 基层号 */
  layer: number
  /** 0 基波次 */
  wave: number
  bossDown: boolean
  sub: SubId
  /** 本局是不是**成功上浮兑现**（溺水 = false）。只有上浮才计 `surfaced` */
  surfaced?: boolean
  /** 本局新见到的图鉴条目增量（id → +n）。由 `codex.ts` 的 `codexGains()` 产出 */
  seen?: Record<string, number>
}

export interface RunOutcome {
  profile: Profile
  /** 刷新了「带出生物质」纪录 */
  newBiomassRecord: boolean
  /** 刷新了「最深层 / 最远波次」纪录 */
  newDepthRecord: boolean
  /** 本局沉淀进 `bio` 的数量（溺水必为 0）—— 结算屏"沉淀 +N"用 */
  banked: number
}

export function defaultProfile(): Profile {
  return {
    v: PROFILE_VERSION,
    bestBiomass: 0,
    bestLayer: 0,
    bestWave: 0,
    runs: 0,
    cleared: false,
    lastSub: SUBS[0].id,
    bio: 0,
    totalBanked: 0,
    surfaced: 0,
    unlocks: [],
    seen: {},
    milestones: [],
    normalClears: 0,
    perks: {},
  }
}

/** 是不是合法的潜航器 id（存档被手改成 `"sub_999"` 也不能让开局崩） */
export function isSubId(v: unknown): v is SubId {
  return typeof v === 'string' && SUBS.some(s => s.id === v)
}

/** 非负整数。NaN / Infinity / 负数 / 小数 / 字符串 / null 一律归 0。 */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * 洗成合法的 `string[]`。
 *
 * ⚠️ 为什么存数组而不是 `Set`：JSON 不认 Set，`JSON.stringify(new Set([1]))` 得到 `{}`
 * —— 静默丢光数据。档案量级只有几十条，`includes` 的开销可忽略。
 */
function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (typeof x !== 'string' || !x || seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

/** 洗成 `Record<string, number>`（正计数）。非法项丢弃，不从整体丢弃。 */
function countMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const n = count(val)
    if (n > 0) out[k] = n
  }
  return out
}

/**
 * 把任意来源的数据洗成合法 `Profile`。
 *
 * 不信任磁盘上的任何一个字段 —— 存档可能来自旧版本、被用户手改过、
 * 或者在写入过程中被强杀导致半截 JSON（那一步在 `JSON.parse` 就抛了）。
 * 这里的原则是**逐字段回退**：一项不合法只重置那一项，不整体丢弃档案 ——
 * 否则用户会莫名其妙丢掉所有纪录。
 */
export function normalizeProfile(raw: unknown): Profile {
  const d = defaultProfile()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d
  const o = raw as Record<string, unknown>
  const runs = count(o.runs)
  return {
    v: PROFILE_VERSION,
    bestBiomass: count(o.bestBiomass),
    bestLayer: count(o.bestLayer),
    // 波次必须依附于"真的下潜过"这一事实：从没跑过（runs=0）时波次归 0，
    // 否则残留字段会显示成"最深处 L1 · 第 4 波"这种从没发生过的组合。
    bestWave: runs > 0 ? count(o.bestWave) : 0,
    runs,
    cleared: o.cleared === true,
    lastSub: isSubId(o.lastSub) ? o.lastSub : d.lastSub,
    bio: count(o.bio),
    totalBanked: count(o.totalBanked),
    surfaced: count(o.surfaced),
    unlocks: strArray(o.unlocks),
    seen: countMap(o.seen),
    milestones: strArray(o.milestones),
    normalClears: count(o.normalClears),
    perks: countMap(o.perks),
  }
}

/**
 * v1 → v2 迁移（纯函数、可测）。
 *
 * v1 的 6 个字段是 v2 的**子集**，所以迁移 = 洗一遍 —— 旧纪录一个不丢，
 * 新字段全走默认值。单独留一个具名入口，是为了让"迁移"这件事在测试里
 * **能被点名断言**（红线：迁移写错 = 老玩家进度全灭），而不是散在
 * `normalizeProfile` 的默认值里看不见。
 */
export function migrateV1toV2(raw: unknown): Profile {
  return normalizeProfile(raw)
}

/**
 * 一局结束 → 新档案 + 是否刷新了纪录。
 *
 * 纯函数：不修改入参，返回新对象。这样"算纪录"和"写存储"彻底分开，
 * 前者可测、后者可失败（写不进去也只影响"纪录没留下"）。
 *
 * ⚠️ 职责边界：本函数只管**纪录 + 沉淀 + 图鉴合并**，**不管解锁判定** ——
 * 解锁条件写在 `unlocks.ts`（它要读武器/遗物表，属另一层）。视图层的顺序是
 * `applyRun()` → `settleProgress()`（后者内部做解锁 + 里程碑）。
 */
export function applyRun(p: Profile, r: RunResult): RunOutcome {
  const next: Profile = { ...p }

  next.runs = count(p.runs) + 1
  if (isSubId(r.sub)) next.lastSub = r.sub
  if (r.bossDown) next.cleared = true
  if (r.bossDown) next.normalClears = count(p.normalClears) + 1

  const biomass = count(r.biomass)
  const newBiomassRecord = biomass > next.bestBiomass
  if (newBiomassRecord) next.bestBiomass = biomass

  // 层与波次成对比较 / 成对更新（见 Profile.bestWave 的注释）
  const layer = count(r.layer)
  const wave = count(r.wave)
  const newDepthRecord = layer > p.bestLayer || (layer === p.bestLayer && wave > p.bestWave)
  if (newDepthRecord) {
    next.bestLayer = layer
    next.bestWave = wave
  }

  // 沉淀：只有成功上浮才会有非 0 的 biomass（溺水时调用方传 0），所以这里不必再判 win
  const banked = Math.floor(biomass * BANK_RATE)
  if (banked > 0) {
    next.bio = count(p.bio) + banked
    next.totalBanked = count(p.totalBanked) + banked
  }
  if (r.surfaced) next.surfaced = count(p.surfaced) + 1

  // 图鉴合并：累加计数（不是取最大值 —— "遇见次数"要能增长）
  if (r.seen) {
    const merged: Record<string, number> = { ...next.seen }
    for (const [k, v] of Object.entries(r.seen)) {
      const n = count(v)
      if (n <= 0) continue
      merged[k] = count(merged[k]) + n
    }
    next.seen = merged
  }

  return { profile: next, newBiomassRecord, newDepthRecord, banked }
}

/** 标题屏一行纪录文案。没跑过就说没跑过 —— 别显示一堆 0 让人以为是纪录。 */
export function depthLabel(p: Profile): string {
  if (p.runs <= 0) return '尚无下潜记录'
  const parts = [`最深处 L${p.bestLayer + 1} · 第 ${p.bestWave + 1} 波`]
  if (p.bestBiomass > 0) parts.push(`带出 ${p.bestBiomass}`)
  parts.push(`下潜 ${p.runs} 次`)
  return parts.join(' · ')
}

/** 结算屏的"新纪录"提示。没有新纪录返回 null（调用方据此决定要不要画那一行）。 */
export function recordLabel(o: RunOutcome): string | null {
  const tag: string[] = []
  if (o.newBiomassRecord) tag.push('带出生物质')
  if (o.newDepthRecord) tag.push('最深层')
  return tag.length ? `新纪录 · ${tag.join(' / ')}` : null
}

/** 结算屏的"沉淀"提示。0 沉淀时返回 null（溺水那局不留空行，见元系统设计 §4.2）。 */
export function bankedLabel(o: RunOutcome): string | null {
  return o.banked > 0 ? `沉淀 +${o.banked} 生物质（总额 ${o.profile.bio}）` : null
}
