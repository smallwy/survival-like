// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/dive/profile.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 本地档案 —— 跨局的纪录（不是局内存档）。
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
 * 只存**跨局有意义**的纪录。局内的东西（氧气、武器、遗物、当前层）一律不存 ——
 * 那是 roguelike 的一局，本来就不该续。这也意味着"半途退出"没有损失语义，
 * 不需要处理"读档回到一半"的一堆边界情况。
 *
 * 层号与波次都是 **0 基**（跟 `layerIdx` / `waveInLayer` 对齐），显示时 +1。
 * 显示文案统一走 `depthLabel()`，免得标题屏和结算屏各写一份格式。
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
export const PROFILE_VERSION = 1

export interface Profile {
  v: number
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
}

export interface RunOutcome {
  profile: Profile
  /** 刷新了「带出生物质」纪录 */
  newBiomassRecord: boolean
  /** 刷新了「最深层 / 最远波次」纪录 */
  newDepthRecord: boolean
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
  }
}

/**
 * 一局结束 → 新档案 + 是否刷新了纪录。
 *
 * 纯函数：不修改入参，返回新对象。这样"算纪录"和"写存储"彻底分开，
 * 前者可测、后者可失败（写不进去也只影响"纪录没留下"）。
 */
export function applyRun(p: Profile, r: RunResult): RunOutcome {
  const next: Profile = { ...p }

  next.runs = count(p.runs) + 1
  if (isSubId(r.sub)) next.lastSub = r.sub
  if (r.bossDown) next.cleared = true

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

  return { profile: next, newBiomassRecord, newDepthRecord }
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
