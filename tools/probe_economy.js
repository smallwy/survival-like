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
 * V6.84 起兼作**多变体扫描器**（用户否决"商店买氧"，改在鱼骨获取端调平）：
 *   --base N     BONE_COIN.base（每块骨的币值；⛕ 与 dropCap 共变才不动氧气，见下）
 *   --capmul F   各层 dropCap × F（掉落预算；币值×预算同时缩放 ⇒ 骨数/氧气不变、只动钱）
 *   --rainc N    BONE_RAIN.coin（骨雨单块币；骨雨**绕过 dropCap**，是独立旋钮）
 * ⚠️ 三个旋钮的耦合（改前必读）：
 *   · dropCap 按**币值**计数（`droppedThisWave += coin`）⇒ 只降 base 不降 cap
 *     = 每波多掉 ~50% 的骨 = 氧气供给暴涨（止损线②）。
 *   · 骨雨绕过 cap ⇒ 只降 base 不动 rainc = 骨雨占比被动升高。
 *   · 收入 = 结算余钱 + 总花费（bank 只随拾取入账，无其它入口）。
 *
 * 用法：
 *   <node> tools/probe_economy.js <编译产物目录> [局数] [--base N --capmul F --rainc N]
 */

'use strict'

const path = require('path')

const buildDir = process.argv[2]
if (!buildDir) {
  console.error('用法: node tools/probe_economy.js <编译产物目录> [局数] [--base N --capmul F --rainc N]')
  process.exit(2)
}
const N = Number(process.argv[3] ?? 8)

const { DiveWorld, LAYERS, CARD_POOL, OFFER_N, BONE_COIN, BONE_RAIN, BONE_O2, ECO_BAL, COST_GROWTH } = require(path.join(path.resolve(buildDir), 'dive', 'index.js'))

// ---- V6.84 多变体旋钮（运行时改常量对象：world.ts 是调用时读属性，不是编译期内联）----
const flags = {}
for (let i = 4; i < process.argv.length; i += 2) {
  const k = process.argv[i]
  if (!k || !k.startsWith('--')) continue
  flags[k.slice(2)] = Number(process.argv[i + 1])
}
if (flags.base !== undefined) BONE_COIN.base = flags.base
if (flags.rainc !== undefined) BONE_RAIN.coin = flags.rainc
if (flags.o2 !== undefined) BONE_O2.o2Base = flags.o2
if (flags.capmul !== undefined) for (const L of LAYERS) L.dropCap = Math.round(L.dropCap * flags.capmul)
// V6.85 通用数值平衡系统：控制器参数也可扫（emin = 乘子地板，ehi = 死区上沿）
if (flags.emin !== undefined) ECO_BAL.min = flags.emin
if (flags.ehi !== undefined) ECO_BAL.hi = flags.ehi
// V6.85 方案 A：卡价随深度上涨
if (flags.costgl !== undefined) COST_GROWTH.perLayer = flags.costgl
if (flags.costgw !== undefined) COST_GROWTH.perWave = flags.costgw
const variant = `base=${BONE_COIN.base} cap×${flags.capmul ?? 1} rainc=${BONE_RAIN.coin} o2=${BONE_O2.o2Base} eco[min=${ECO_BAL.min} hi=${ECO_BAL.hi}] 卡价 +${COST_GROWTH.perLayer}/层`

// ---- V6.84 掉落三口径记账（块数 / 氧 / 币）----
// 为什么必须量：dropCap 按**币值**计数 ⇒ 降币值会**多掉骨** ⇒ 氧气供给跟着涨（止损线②）。
// "改币值不动氧气"不是想当然，要在这里用数字证明（与基线变体的 o2Made 对表）。
const proto = DiveWorld.prototype
const origMkBone = proto.mkBone
let bonesMade = 0, o2Made = 0, coinMade = 0
proto.mkBone = function (x, y, o2, coin, size, spread = 1) {
  origMkBone.call(this, x, y, o2, coin, size, spread)
  bonesMade++; o2Made += o2; coinMade += coin
}

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
  bonesMade = 0; o2Made = 0; coinMade = 0
  let bankPeak = 0
  let spent = 0
  let bought = 0
  let shopVisits = 0
  let offersTotal = 0
  let unaffordable = 0            // 买不起剩在那的卡数（0 = 钱花不完）
  let rerolls = 0                 // 重掷次数（方案 B 的量）
  const bankAtShop = []
  const boughtAtShop = []
  const costMulAtShop = []        // V6.85：每店的卡价乘子（涨价后"买得起几张"必须按它算）
  const coinMulAtShop = []        // V6.85：动态平衡控制器的轨迹（看它有没有在收敛）
  const steps = Math.round(60 * 25 / DT)

  for (let i = 0; i < steps; i++) {
    if (world.phase === 'result') break

    if (world.phase === 'shop') {
      shopVisits++
      bankAtShop.push(world.bank)
      coinMulAtShop.push(world.coinMul)     // 控制器每店结算后的当前乘子
      costMulAtShop.push(world.costMul())   // 当店卡价乘子（不记它，"买得起几张"会被算虚）
      const boughtBefore = bought
      // ★ V6.83 方案 A+B 之后，玩家多了一条"把钱变成选择"的路：**买不完就重掷**。
      //   原脚本只买一次就走，测不出方案 B 的效果 ⇒ 这里模拟"买 → 刷 → 再买"的循环。
      //   ⚠️ 上限 12 轮：真人不会无限刷（那太枯燥），也不能让 bot 把余额刷成 0 来"证明有效"。
      for (let round = 0; round < 12; round++) {
        let got = 0
        // ⚠️ 扣价一律走 `world.offerCost(k)`（**唯一算式**，含 V6.85 的深度涨价）——
        //    写 `u.cost` 会量到一个"比实扣便宜"的假账。
        for (let c = 0; c < OFFER_N; c++) {
          const idx = world.offers.findIndex((u, k) => u && !world.sold[k] && world.offerCost(k) <= world.bank)
          if (idx < 0) break
          spent += world.offerCost(idx)
          bought++; got++
          world.buyCard(idx)
        }
        // ★ 修 V6.85 前的度量 bug：原 `offersTotal += got` 记的是**买走数**，
        //   于是"上架卡总数"和"买走"永远相等，看不出"买得起几张"。
        offersTotal += world.offers.filter(u => u).length
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
      boughtAtShop.push(bought - boughtBefore)
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
    income: world.bank + spent,
    bonesMade, o2Made, coinMade,
    bankAtShop, boughtAtShop, coinMulAtShop, costMulAtShop,
    coinMulEnd: world.coinMul,
  })
}

const avg = (f) => perRun.reduce((a, r) => a + f(r), 0) / N

console.log(`\n=== 经济普查：${N} 局（保守走位）· 变体 ${variant} ===`)
console.log('\n【每局均值】')
console.log(`  最深到达        L${(avg(r => r.maxLayer) + 1).toFixed(1)}`)
console.log(`  进商店次数      ${avg(r => r.shopVisits).toFixed(1)} 次`)
console.log(`  上架卡总数      ${avg(r => r.offersTotal).toFixed(1)} 张`)
console.log(`  买走            ${avg(r => r.bought).toFixed(1)} 张（花 ${avg(r => r.spent).toFixed(0)} 金）`)
console.log(`  **重掷**        ${avg(r => r.rerolls).toFixed(1)} 次   ← 方案 B 的效果在这`)
console.log(`  **买不起剩在那的** ${avg(r => r.unaffordable).toFixed(1)} 张   ← 0 就说明"钱花不完"；V6.84 目标 0.3-2`)
console.log(`  总收入          ${avg(r => r.income).toFixed(0)} 金（结算余钱 + 总花费）`)
console.log(`  结算时余钱      ${avg(r => r.bankEnd).toFixed(0)} 金 = 收入的 ${(avg(r => r.bankEnd) / avg(r => r.income) * 100).toFixed(0)}%   ← V6.84 目标 ≤40%`)
console.log(`  第 1 次商店     ${avg(r => r.bankAtShop[0] ?? 0).toFixed(0)} 金 / 买 ${avg(r => r.boughtAtShop[0] ?? 0).toFixed(1)} 张   ← V6.84 目标"仍能买 1-2 张"`)
console.log(`  掉落（每局）    ${avg(r => r.bonesMade).toFixed(0)} 块 / ${avg(r => r.o2Made).toFixed(0)} 氧 / ${avg(r => r.coinMade).toFixed(0)} 币   ← 氧必须与基线持平（止损线②）`)

console.log('\n【逐次商店的余额】每局第 n 次进商店时手上有多少（平均）')
// ★ V6.85：真正决定"有没有选择犹豫感"的不是余钱率，而是**这次商店买得起几张**：
//   `可买张数 < 上架张数` 才有取舍；`≥` 就是"总能买光" = 没有犹豫（实测基线 ≈ 买光 30/30）。
const medianCost = CARD_POOL.map(c => c.cost).sort((a, b) => a - b)[Math.floor(CARD_POOL.length / 2)]
const maxVisits = Math.max(...perRun.map(r => r.bankAtShop.length))
for (let k = 0; k < maxVisits; k++) {
  const vals = perRun.map(r => r.bankAtShop[k]).filter(v => v !== undefined)
  const m = vals.reduce((a, b) => a + b, 0) / vals.length
  const bar = '█'.repeat(Math.min(40, Math.round(m / 40)))
  const cmv = perRun.map(r => r.costMulAtShop[k]).filter(v => v !== undefined)
  const cm = cmv.length ? cmv.reduce((a, b) => a + b, 0) / cmv.length : 1
  const afford = (m / (medianCost * cm)).toFixed(1)
  console.log(`  第 ${k + 1} 次  ${bar}  ${m.toFixed(0)} 金 ≈ 买得起 **${afford}** 张 / 上架 ${OFFER_N} 张`
    + `（卡价 ×${cm.toFixed(2)} · ${vals.length} 局到过）`)
}

// ---- V6.85 动态平衡控制器：它到底有没有在工作？----
console.log('\n【动态币值控制器】（通用数值平衡系统 · 每店调一档）')
const mulEnd = avg(r => r.coinMulEnd)
console.log(`  控制器终值 coinMul  ${mulEnd.toFixed(2)}   ← 1.00=没介入；<1=在压钱；>1=在补钱`)
const mulTrail = []
for (let k = 0; k < maxVisits; k++) {
  const vals = perRun.map(r => r.coinMulAtShop[k]).filter(v => v !== undefined)
  if (!vals.length) break
  mulTrail.push((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
}
console.log(`  逐店轨迹  ${mulTrail.join(' → ')}`)
const engaged = perRun.filter(r => r.coinMulEnd < 0.999).length
console.log(`  ${engaged}/${N} 局触发过压缩（= 钱确实溢出过，控制器在兜）`)

console.log('\n【参考】卡价中位 = ' + medianCost + ' 金')
console.log('')
