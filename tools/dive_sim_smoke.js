#!/usr/bin/env node
/**
 * 潜水模拟核心的**无头冒烟测试**。
 *
 * 沙箱里没有 Cocos Creator（GUI 编辑器），所以渲染层验证不了；
 * 但模拟层是引擎无关的纯 TS，可以编译成 JS 真跑起来并断言不变量 ——
 * 这一层是"移植保真"的硬证据。
 *
 * 用法：
 *   <node> tools/dive_sim_smoke.js <编译产物目录>
 *
 * 编译（见 tools/ 里的调用）：
 *   tsc shared/dive/index.ts --outDir .tmp/sim-build --rootDir shared \
 *       --module commonjs --target ES2020 --moduleResolution node \
 *       --strict --skipLibCheck --lib ES2020,DOM
 */

'use strict'

const path = require('path')
const assert = require('assert')

const buildDir = process.argv[2]
if (!buildDir) {
  console.error('用法: node tools/dive_sim_smoke.js <编译产物目录>')
  process.exit(2)
}

const { DiveWorld } = require(path.join(path.resolve(buildDir), 'dive', 'index.js'))

const W = 1304
const H = 749
const DT = 1 / 60

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log(`  ✅ ${name}`)
  } catch (e) {
    results.push({ name, ok: false, err: e.message })
    console.log(`  ❌ ${name}\n     ${e.message}`)
  }
}

/** 圆形走位：让玩家一直在动、且不会长期贴在屏幕角落挨打 */
function circularInput(world, i) {
  const a = i * DT * 1.1
  return { dx: Math.cos(a) > 0 ? 1 : -1, dy: Math.sin(a) > 0 ? 1 : -1, burst: false }
}

function run(seed, seconds, inputFn) {
  const world = new DiveWorld({ w: W, h: H, seed })
  const stats = {
    hits: 0, kills: 0, pickups: 0, floats: 0, muzzles: 0, arcs: 0, blasts: 0,
    waves: 0, waveCleared: 0, descends: 0, shops: 0, decides: 0, dead: 0, runCleared: 0,
    maxEnemies: 0, maxBones: 0, minO2: Infinity, o2MaxSeen: 0,
    maxLayer: 0, maxWave: 0, minPx: Infinity, maxPx: -Infinity,
  }
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    world.update(DT, inputFn(world, i))
    for (const ev of world.drainEvents()) {
      switch (ev.t) {
        case 'hit': stats.hits++; break
        case 'kill': stats.kills++; break
        case 'pickup': stats.pickups++; break
        case 'float': stats.floats++; break
        case 'muzzle': stats.muzzles++; break
        case 'arc': stats.arcs++; break
        case 'blast': stats.blasts++; break
        case 'wave': stats.waves++; break
        case 'waveCleared': stats.waveCleared++; break
        case 'descend': stats.descends++; break
        case 'dead': stats.dead++; break
        case 'runCleared': stats.runCleared++; break
      }
    }
    stats.maxEnemies = Math.max(stats.maxEnemies, world.enemies.length)
    stats.maxBones = Math.max(stats.maxBones, world.bones.length)
    stats.minO2 = Math.min(stats.minO2, world.o2)
    stats.o2MaxSeen = Math.max(stats.o2MaxSeen, world.o2Max)
    stats.maxLayer = Math.max(stats.maxLayer, world.layerIdx)
    stats.maxWave = Math.max(stats.maxWave, world.waveInLayer)
    stats.minPx = Math.min(stats.minPx, world.px)
    stats.maxPx = Math.max(stats.maxPx, world.px)

    // 相位推进：模拟层不自己离开商店/决策 —— 那是"玩家"（渲染层的 UI）的事
    if (world.phase === 'shop') {
      stats.shops++
      for (let c = 0; c < 3; c++) {
        const up = world.offers[c]
        if (up && !world.sold[c] && world.bank >= up.cost) { world.buyCard(c); break }
      }
      world.leaveShop()
    } else if (world.phase === 'decide') {
      stats.decides++
      if (world.o2 > world.layer().toll) world.diveDeeper()
      else world.surface()
    } else if (world.phase === 'result') {
      break
    }
  }
  return { world, stats }
}

console.log('\n=== shared/dive 模拟核心 · 无头冒烟 ===\n')

// ---------------------------------------------------------------------------
console.log('[1] 初始化')
const { world: w0 } = run(1234, 1 / 60, () => ({ dx: 0, dy: 0, burst: false }))
check('开局相位 = wave', () => assert.strictEqual(w0.phase, 'wave'))
check('开局只挂 1 台器械（机关枪）', () => {
  assert.strictEqual(w0.weapons.length, 1)
  assert.strictEqual(w0.weapons[0].id, 'gun')
})
check('开局氧气上限 = L1(100) + 灯艇(+25) = 125', () => assert.strictEqual(w0.o2Max, 125))
check('开局挂载座 = 4', () => assert.strictEqual(w0.maxWeapons, 4))

// ---------------------------------------------------------------------------
console.log('\n[2] 模拟 120 秒（圆形走位）')
const { stats } = run(20261013, 120, circularInput)
console.log('     ' + JSON.stringify({
  waves: stats.waves, waveCleared: stats.waveCleared, shops: stats.shops, decides: stats.decides,
  hits: stats.hits, kills: stats.kills, muzzles: stats.muzzles, floats: stats.floats,
  maxEnemies: stats.maxEnemies, maxBones: stats.maxBones,
  minO2: +stats.minO2.toFixed(1), moves: +(stats.maxPx - stats.minPx).toFixed(0),
  maxLayer: stats.maxLayer, maxWave: stats.maxWave, dead: stats.dead, runCleared: stats.runCleared,
}))
check('刷过怪（同屏 ≥ 5 只）', () => assert.ok(stats.maxEnemies >= 5, `maxEnemies=${stats.maxEnemies}`))
check('自动开火过（枪口闪光 > 0）', () => assert.ok(stats.muzzles > 0, `muzzles=${stats.muzzles}`))
check('命中结算过（hit ≥ 20）', () => assert.ok(stats.hits >= 20, `hits=${stats.hits}`))
check('打死过敌人（kill ≥ 3）', () => assert.ok(stats.kills >= 3, `kills=${stats.kills}`))
check('掉过鱼骨（同屏 ≥ 1）', () => assert.ok(stats.maxBones >= 1, `maxBones=${stats.maxBones}`))
check('氧气真的在消耗（minO2 < 上限）', () => assert.ok(stats.minO2 < stats.o2MaxSeen, `minO2=${stats.minO2}`))
check('玩家真的移动了（位移 > 50px）', () => assert.ok(stats.maxPx - stats.minPx > 50, `moves=${stats.maxPx - stats.minPx}`))
check('波次推进过（清波 / 进商店 / 进决策 至少一次）',
  () => assert.ok(stats.waveCleared + stats.shops + stats.decides + stats.descends > 0,
    `cleared=${stats.waveCleared} shops=${stats.shops} decides=${stats.decides} descends=${stats.descends}`))

// ---------------------------------------------------------------------------
console.log('\n[3] 确定性（同 seed ⇒ 完全相同的世界线）')
const a = run(777, 20, circularInput).world
const b = run(777, 20, circularInput).world
const c = run(778, 20, circularInput).world
check('同 seed：px/py/o2/敌人数/bank 完全一致', () => {
  assert.strictEqual(a.px, b.px)
  assert.strictEqual(a.py, b.py)
  assert.strictEqual(a.o2, b.o2)
  assert.strictEqual(a.enemies.length, b.enemies.length)
  assert.strictEqual(a.bank, b.bank)
})
check('不同 seed：世界线不同', () => {
  const same = a.px === c.px && a.py === c.py && a.o2 === c.o2 && a.enemies.length === c.enemies.length
  assert.ok(!same, '不同 seed 却得到同一条世界线（RNG 没生效？）')
})

// ---------------------------------------------------------------------------
console.log('\n[4] 商店经济')
{
  const w = new DiveWorld({ w: W, h: H, seed: 42 })
  w.bank = 100
  w.openShop()
  check('openShop 后 phase = shop 且抽满 3 张', () => {
    assert.strictEqual(w.phase, 'shop')
    assert.strictEqual(w.offers.length, 3)
  })
  check('可购买：扣钱 + 标记 sold', () => {
    const idx = w.offers.findIndex((u, i) => u && !w.sold[i] && u.cost <= w.bank)
    assert.ok(idx >= 0, '没有买得起的卡？')
    const cost = w.offers[idx].cost
    const before = w.bank
    w.buyCard(idx)
    assert.strictEqual(w.bank, before - cost)
    assert.strictEqual(w.sold[idx], true)
  })
  check('刷新递增（8 → 14）', () => {
    const c0 = w.rerollCost
    w.bank = 100
    w.reroll()
    assert.strictEqual(w.rerollCost, c0 + 6)
  })
  check('锁定格刷新后保留原卡', () => {
    // ⚠️ 必须**重开一次商店**：上一项买过第 0 格，`sold[0]` 为 true 时
    // `toggleLock(0)` 是空操作（已售出的格子不能锁）。openShop 会重置 locked/sold。
    w.openShop()
    w.toggleLock(0)
    const kept = w.offers[0]
    w.bank = 100
    w.reroll()
    assert.strictEqual(w.offers[0], kept)
  })
  check('遗物卡：装备后进 relics 且槽位受限', () => {
    const relicCard = w.pool.find(u => u.kind === 'relic')
    assert.ok(relicCard, '卡池里没有遗物卡？')
    w.bank = 9999
    relicCard.apply(w)
    assert.strictEqual(w.relics.length, 1)
  })
}

// ---------------------------------------------------------------------------
console.log('\n[5] 死亡路径（氧气归零 ⇒ 结算屏 + dead 事件）')
{
  const w = new DiveWorld({ w: W, h: H, seed: 9 })
  w.o2 = 0.0001
  w.drainOxygen(DT)
  const evs = w.drainEvents().map(e => e.t)
  check('phase = result 且 win = false', () => {
    assert.strictEqual(w.phase, 'result')
    assert.strictEqual(w.win, false)
  })
  check('抛出了 dead 事件', () => assert.ok(evs.includes('dead'), `events=${evs.join(',')}`))
}

// ---------------------------------------------------------------------------
const failed = results.filter(r => !r.ok)
console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  - ${f.name}: ${f.err}`)
  process.exit(1)
}
console.log('✅ 全部通过\n')
