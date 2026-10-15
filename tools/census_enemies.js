#!/usr/bin/env node
/**
 * **整局刷怪普查**（V6.79 立的规矩，每次加生物必跑）。
 *
 * 为什么必须有这一步：`LayerDef.mix` 里写了占比，只证明"抽签表里有它"；
 * **玩家能不能遇到**取决于两件与占比无关的事：
 *   ① 那一层玩家**到不到得了**（短局根本走不出 L1 —— V6.79 的真实事故）；
 *   ② 那一波的**总量**够不够（一次刷 14 只的波里，5% = 0.7 只 ⇒ 大概率一只都没有）。
 * 只有跑整局、按层差分统计，才知道答案。
 *
 * 用法：
 *   <node> tools/census_enemies.js <编译产物目录> [局数]
 */

'use strict'

const path = require('path')

const buildDir = process.argv[2]
if (!buildDir) {
  console.error('用法: node tools/census_enemies.js <编译产物目录> [局数]')
  process.exit(2)
}
const N = Number(process.argv[3] ?? 12)

const { DiveWorld, LAYERS, ENEMY_TEX, CODEX_BYPRODUCT_KINDS } = require(path.join(path.resolve(buildDir), 'dive', 'index.js'))

const W = 1304
const H = 749
const DT = 1 / 60

/** 保守走位：绕圈 + 优先往最近的鱼骨游（比"随机游走"更接近真人，也更不容易早死） */
function input(world, i) {
  const a = i * DT * 1.1
  let dx = Math.cos(a) > 0 ? 1 : -1
  let dy = Math.sin(a) > 0 ? 1 : -1
  // 有鱼骨就优先去捡（氧气是本作的生死线 ⇒ 真玩家一定会这么做）
  let best = null, bd = 420
  for (const b of world.bones) {
    const d = Math.hypot(b.x - world.px, b.y - world.py)
    if (d < bd) { bd = d; best = b }
  }
  if (best) {
    dx = Math.sign(best.x - world.px) || dx
    dy = Math.sign(best.y - world.py) || dy
  }
  return { dx, dy, burst: false }
}

/**
 * ⚠️ 这里**从 `ENEMY_TEX` 反推**，不手写清单。
 *
 * V6.83 加第二批 7 种生物时，这个数组还是手写的 12 项 —— 于是那 7 种在
 * 每层构成里**整整消失了一轮**：`spawnWeights` 明明抽出来了，脚本却因为
 * 不在自己的清单里而**没统计**，跑出来像是"加了没生效"。
 * 这与 V6.79/V6.82 栽的是同一个坑（铁律 15：手写的第二份清单必然漂移）。
 */
const KINDS = Object.keys(ENEMY_TEX)
/** 派生体（有怪无鉴）也算进"看得见"，它们是有意不进图鉴的 */
const DERIVED = new Set(CODEX_BYPRODUCT_KINDS)

const perLayer = []          // perLayer[li][kind]
const reached = []           // 有多少局**进过**这一层
const depthHist = []
let runCleared = 0, dead = 0
let peakShard = 0, peakShardAt = 0

for (let s = 0; s < N; s++) {
  const world = new DiveWorld({ w: W, h: H, seed: 1000 + s * 37 })
  const seen = {}
  let maxLayer = 0
  const steps = Math.round(60 * 20 / DT)     // 最多模拟 20 分钟
  for (let i = 0; i < steps; i++) {
    // ★ 相位推进：普查必须**自己把局打完**，否则 4 波之后卡在 `decide` 永远不动 ——
    //   那样统计出来的"玩家遇不到 L2+"是**测试脚本的锅**，不是配比的锅。
    if (world.phase === 'shop') {
      // 先买能买得起的（让 build 长起来 ⇒ 能走到更深，才看得到后面的层）
      for (let c = 0; c < 3; c++) {
        const idx = world.offers.findIndex((u, k) => u && !world.sold[k] && u.cost <= world.bank)
        if (idx < 0) break
        world.buyCard(idx)
      }
      world.leaveShop()
      continue
    }
    if (world.phase === 'decide') {
      const toll = LAYERS[world.layerIdx].toll
      // 氧气宽裕就继续赌，紧就收手（比"永远下潜"更接近真人）
      if (world.o2 > toll + 25) world.diveDeeper()
      else world.surface()
      continue
    }
    if (world.phase === 'result') break

    const before = { ...world.spawned }
    world.update(DT, input(world, i))
    maxLayer = Math.max(maxLayer, world.layerIdx)
    // 幼体（shard）是副产品、不进 `spawned` ⇒ 单独看**峰值同屏**，判断"分裂/产卵有没有滚起来"
    let sh = 0
    for (const e of world.enemies) if (e.alive && e.kind === 'shard') sh++
    if (sh > peakShard) { peakShard = sh; peakShardAt = world.layerIdx }
    // 差分：`spawned` 是累计计数，逐帧差分才能按"当时在哪一层"归属
    for (const k of KINDS) {
      const d = (world.spawned[k] ?? 0) - (before[k] ?? 0)
      if (d > 0) {
        perLayer[world.layerIdx] = perLayer[world.layerIdx] ?? {}
        perLayer[world.layerIdx][k] = (perLayer[world.layerIdx][k] ?? 0) + d
        seen[k] = (seen[k] ?? 0) + d
      }
    }
  }
  for (let li = 0; li <= maxLayer; li++) reached[li] = (reached[li] ?? 0) + 1
  depthHist.push(maxLayer)
  if (world.phase === 'result') {
    if (world.layerIdx >= 4 && world.waveInLayer >= 3) runCleared++
    else dead++
  }
}

console.log(`\n=== 整局刷怪普查：${N} 局（保守走位 · 优先捡骨）===`)
console.log('\n【到达率】每层有多少局走到过')
const LN = ['L1 阳光带', 'L2 弱光带', 'L3 午夜带', 'L4 热泉带', 'L5 深渊带']
for (let li = 0; li < 5; li++) {
  const n = reached[li] ?? 0
  const bar = '█'.repeat(Math.round(n / N * 24)).padEnd(24, '·')
  console.log(`  ${LN[li]}  ${bar}  ${String(n).padStart(2)}/${N}  ${(n / N * 100).toFixed(0)}%`)
}
console.log(`\n  最深分布：${depthHist.map((d, i) => `#${i + 1}→L${d + 1}`).join('  ')}`)
console.log(`  结局：${dead} 局阵亡 · ${runCleared} 局打通 · ${N - dead - runCleared} 局超时`)

console.log('\n【每层刷怪构成】括号内是该层占比')
for (let li = 0; li < 5; li++) {
  const m = perLayer[li] ?? {}
  const tot = Object.values(m).reduce((a, b) => a + b, 0) || 1
  const parts = KINDS.filter(k => m[k]).map(k => `${k} ${m[k]}(${(m[k] / tot * 100).toFixed(1)}%)`)
  console.log(`  ${LN[li]}  共 ${tot} 只\n      ${parts.join(' · ') || '（没到过这层）'}`)
}

console.log('\n【全部生物总览】按"平均每局遇到几只"排序 —— 从少到多')
console.log('  （★ 不写死"哪些是新的"：排序本身就能一眼指出谁看不见，且**永远不会漏**）')
const grand = perLayer.reduce((a, m) => { for (const k of KINDS) a[k] = (a[k] ?? 0) + (m[k] ?? 0); return a }, {})
const all = Object.values(grand).reduce((a, b) => a + b, 0) || 1
const rows = KINDS.filter(k => k !== 'boss').map(k => ({ k, per: (grand[k] ?? 0) / N }))
rows.sort((a, b) => a.per - b.per)
for (const r of rows) {
  const tag = DERIVED.has(r.k) ? '（派生体）' : ''
  const flag = r.per < 1 ? '  ⚠️ 平均每局不到 1 只 —— 玩家大概率看不到' : ''
  console.log(`  ${r.k.padEnd(9)}${tag.padEnd(6)} 合计 ${String(grand[r.k] ?? 0).padStart(4)}  ` +
    `平均每局 ${r.per.toFixed(1)} 只  占全场 ${((grand[r.k] ?? 0) / all * 100).toFixed(1)}%${flag}`)
}
console.log(`\n  幼体（shard·副产品）峰值同屏：${peakShard} 只（出现在 L${peakShardAt + 1}）`)
console.log(`  ⇒ 回答的是"分裂 / 产卵有没有滚起来"；它不进图鉴也不进上面的占比表。`)
console.log('')
