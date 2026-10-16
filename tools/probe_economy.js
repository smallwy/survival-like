#!/usr/bin/env node
/**
 * **经济普查**（V6.83）。用户实机反馈：「鱼骨商店购买毫无压力，满屏的鱼骨获取」
 *
 * 这句话包含两个独立的指控，必须分开量：
 *   ① **掉落端**：一局到底产出多少钱？（"满屏鱼骨"是观感，钱是数字）
 *   ② **消费端**：商店有地方花吗？（每波只出 3 张卡，而一局的波数有限）
 * ⇒ 只有把两端都读出来，才知道该改哪一头 —— 也可能两头都不用改，
 *   而是**中期之后没有可买的东西**（钱多 = 没得花，不是赚太快）。
 *
 * 用法：
 *   <node> tools/probe_economy.js <编译产物目录> [局数]
 */

'use strict'

const path = require('path')

const buildDir = process.argv[2]
if (!buildDir) {
  console.error('用法: node tools/probe_economy.js <编译产物目录> [局数]')
  process.exit(2)
}
const N = Number(process.argv[3] ?? 8)

const { DiveWorld, LAYERS, CARD_POOL, OFFER_N } = require(path.join(path.resolve(buildDir), 'dive', 'index.js'))

const W = 1304
const H = 749
const DT = 1 / 60

/** 与 `census_enemies.js` 同一个走位（保守绕圈 + 优先捡骨）—— 保证两次普查可比 */
function input(world, i) {
  const a = i * DT * 1.1
  let dx = Math.cos(a) > 0 ? 1 : -1
  let dy = Math.sin(a) > 0 ? 1 : -1
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

const perRun = []

for (let s = 0; s < N; s++) {
  const world = new DiveWorld({ w: W, h: H, seed: 7000 + s * 41 })
  let bankPeak = 0
  let spent = 0
  let bought = 0
  let shopVisits = 0
  let offersTotal = 0
  let unaffordable = 0            // 买不起剩在那的卡数（0 = 钱花不完）
  let rerolls = 0                 // 重掷次数（方案 B 的量）
  const bankAtShop = []
  const steps = Math.round(60 * 25 / DT)

  for (let i = 0; i < steps; i++) {
    if (world.phase === 'result') break

    if (world.phase === 'shop') {
      shopVisits++
      bankAtShop.push(world.bank)
      // ★ V6.83 方案 A+B 之后，玩家多了一条"把钱变成选择"的路：**买不完就重掷**。
      //   原脚本只买一次就走，测不出方案 B 的效果 ⇒ 这里模拟"买 → 刷 → 再买"的循环。
      //   ⚠️ 上限 12 轮：真人不会无限刷（那太枯燥），也不能让 bot 把余额刷成 0 来"证明有效"。
      for (let round = 0; round < 12; round++) {
        let got = 0
        for (let c = 0; c < OFFER_N; c++) {
          const idx = world.offers.findIndex((u, k) => u && !world.sold[k] && u.cost <= world.bank)
          if (idx < 0) break
          spent += world.offers[idx].cost
          bought++; got++
          world.buyCard(idx)
        }
        offersTotal += got
        // 刷不动 / 刷不起 / 已经买满一整轮就不再刷
        if (world.bank < world.rerollCost + 40) break
        if (got === 0 && round >= 3) break
        spent += world.rerollCost
        rerolls++
        world.reroll()
        const left0 = world.offers.filter((u, k) => u && !world.sold[k])
        unaffordable += left0.length
      }
      world.leaveShop()
      continue
    }
    if (world.phase === 'decide') {
      const toll = LAYERS[world.layerIdx].toll
      if (world.o2 > toll + 25) world.diveDeeper()
      else world.surface()
      continue
    }

    world.update(DT, input(world, i))
    if (world.bank > bankPeak) bankPeak = world.bank
  }

  perRun.push({
    maxLayer: world.layerIdx, bankPeak, spent, bought, rerolls,
    shopVisits, offersTotal, unaffordable,
    bankEnd: world.bank,
    bankAtShop,
  })
}

const avg = (f) => perRun.reduce((a, r) => a + f(r), 0) / N

console.log(`\n=== 经济普查：${N} 局（保守走位）===`)
console.log('\n【每局均值】')
console.log(`  最深到达        L${(avg(r => r.maxLayer) + 1).toFixed(1)}`)
console.log(`  进商店次数      ${avg(r => r.shopVisits).toFixed(1)} 次`)
console.log(`  上架卡总数      ${avg(r => r.offersTotal).toFixed(1)} 张`)
console.log(`  买走            ${avg(r => r.bought).toFixed(1)} 张（花 ${avg(r => r.spent).toFixed(0)} 金）`)
console.log(`  **重掷**        ${avg(r => r.rerolls).toFixed(1)} 次   ← 方案 B 的效果在这`)
console.log(`  **买不起剩在那的** ${avg(r => r.unaffordable).toFixed(1)} 张   ← 0 就说明"钱花不完"`)
console.log(`  钱峰值          ${avg(r => r.bankPeak).toFixed(0)} 金`)
console.log(`  结算时余钱      ${avg(r => r.bankEnd).toFixed(0)} 金`)

console.log('\n【逐次商店的余额】每局第 n 次进商店时手上有多少（平均）')
const maxVisits = Math.max(...perRun.map(r => r.bankAtShop.length))
for (let k = 0; k < maxVisits; k++) {
  const vals = perRun.map(r => r.bankAtShop[k]).filter(v => v !== undefined)
  const m = vals.reduce((a, b) => a + b, 0) / vals.length
  const bar = '█'.repeat(Math.min(40, Math.round(m / 40)))
  console.log(`  第 ${k + 1} 次  ${bar}  ${m.toFixed(0)} 金（${vals.length} 局到过）`)
}

console.log('\n【参考】卡价中位 = ' +
  CARD_POOL.map(c => c.cost).sort((a, b) => a - b)[Math.floor(CARD_POOL.length / 2)] + ' 金')
console.log('')
