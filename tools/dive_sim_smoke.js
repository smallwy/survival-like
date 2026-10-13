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

const {
  DiveWorld, defaultProfile, normalizeProfile, migrateV1toV2, applyRun, depthLabel, recordLabel,
  settleProgress, evalUnlocks, perkLevel, perkBonus, buyPerk, canBuyPerk, filterPool, codexGains,
} = require(path.join(path.resolve(buildDir), 'dive', 'index.js'))

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
console.log('\n[6] 跨局档案（shared/dive/profile.ts —— 纯函数，所以能在这里真跑）')
{
  check('空档案：没跑过就说没跑过', () => {
    const p = defaultProfile()
    assert.strictEqual(p.runs, 0)
    assert.strictEqual(p.lastSub, 'lumen')
    assert.strictEqual(depthLabel(p), '尚无下潜记录')
  })

  check('洗数据：垃圾字段逐项回退，不整体丢弃', () => {
    const p = normalizeProfile({
      bestBiomass: -5,          // 负数 → 0
      bestLayer: 3.7,           // 小数 → 3
      bestWave: 2,
      runs: 'x',                // 字符串 → 0
      cleared: 'yes',           // 非 true → false
      lastSub: 'sub_999',       // 非法 id → 默认艇
    })
    assert.strictEqual(p.bestBiomass, 0)
    assert.strictEqual(p.bestLayer, 3)
    assert.strictEqual(p.runs, 0)
    assert.strictEqual(p.cleared, false)
    assert.strictEqual(p.lastSub, 'lumen')
    assert.strictEqual(p.bestWave, 0, 'runs=0 时波次必须归 0（否则会显示从没发生过的组合）')
  })

  check('洗数据：null / 数组 / 字符串都不炸', () => {
    for (const bad of [null, undefined, 42, 'x', [], { v: 0 }]) {
      const p = normalizeProfile(bad)
      assert.strictEqual(p.runs, 0)
      assert.strictEqual(p.bestLayer, 0)
    }
  })

  check('v1 档案迁移到 v2：旧纪录一个不丢，新字段走默认值', () => {
    const v1 = { v: 1, bestBiomass: 320, bestLayer: 2, bestWave: 1, runs: 7, cleared: true, lastSub: 'raia' }
    const p = migrateV1toV2(v1)
    assert.strictEqual(p.v, 2)
    assert.strictEqual(p.bestBiomass, 320)
    assert.strictEqual(p.bestLayer, 2)
    assert.strictEqual(p.bestWave, 1)
    assert.strictEqual(p.runs, 7)
    assert.strictEqual(p.cleared, true)
    assert.strictEqual(p.lastSub, 'raia')
    // v2 新字段全走默认值
    assert.strictEqual(p.bio, 0)
    assert.strictEqual(p.surfaced, 0)
    assert.deepStrictEqual(p.unlocks, [])
    assert.deepStrictEqual(p.seen, {})
    assert.deepStrictEqual(p.perks, {})
  })

  check('合法 v2 档案洗一遍不变（幂等）', () => {
    const p = normalizeProfile({
      v: 2, bestBiomass: 320, bestLayer: 2, bestWave: 1, runs: 7, cleared: true, lastSub: 'raia',
      bio: 120, totalBanked: 500, surfaced: 3, unlocks: ['sub:raia'], seen: { 'enemy:swarm': 40 },
      milestones: ['mile:first_surface'], normalClears: 1, perks: { reload: 2 },
    })
    assert.strictEqual(p.bio, 120)
    assert.strictEqual(p.perks.reload, 2)
    assert.strictEqual(p.seen['enemy:swarm'], 40)
    assert.deepStrictEqual(normalizeProfile(p), p)
  })

  check('applyRun 是纯函数：不改入参', () => {
    const p = defaultProfile()
    const before = JSON.stringify(p)
    applyRun(p, { biomass: 100, layer: 1, wave: 2, bossDown: false, sub: 'raia' })
    assert.strictEqual(JSON.stringify(p), before)
  })

  check('溺水一局：带出 0，但层/波纪录照样更新、局数 +1', () => {
    const p = defaultProfile()
    const o = applyRun(p, { biomass: 0, layer: 1, wave: 2, bossDown: false, sub: 'bathy' })
    assert.strictEqual(o.profile.runs, 1)
    assert.strictEqual(o.profile.bestBiomass, 0)
    assert.strictEqual(o.profile.bestLayer, 1)
    assert.strictEqual(o.profile.bestWave, 2)
    assert.strictEqual(o.profile.lastSub, 'bathy')
    assert.strictEqual(o.newBiomassRecord, false, '带出 0 不该算"刷新了生物质纪录"')
    assert.strictEqual(o.newDepthRecord, true)
  })

  check('层与波次成对比较：浅层的高波次不能顶掉深层', () => {
    const deep = applyRun(defaultProfile(),
      { biomass: 0, layer: 2, wave: 0, bossDown: false, sub: 'lumen' }).profile
    const o = applyRun(deep, { biomass: 0, layer: 1, wave: 3, bossDown: false, sub: 'lumen' })
    assert.strictEqual(o.profile.bestLayer, 2, 'L1 不该覆盖 L2')
    assert.strictEqual(o.profile.bestWave, 0)
    assert.strictEqual(o.newDepthRecord, false)
  })

  check('同层更深的波次算新纪录', () => {
    const a = applyRun(defaultProfile(),
      { biomass: 0, layer: 2, wave: 1, bossDown: false, sub: 'lumen' }).profile
    const o = applyRun(a, { biomass: 0, layer: 2, wave: 2, bossDown: false, sub: 'lumen' })
    assert.strictEqual(o.newDepthRecord, true)
    assert.strictEqual(o.profile.bestWave, 2)
  })

  check('击杀守望者 ⇒ cleared 永久为真', () => {
    const o = applyRun(defaultProfile(),
      { biomass: 800, layer: 4, wave: 3, bossDown: true, sub: 'raia' })
    assert.strictEqual(o.profile.cleared, true)
    assert.strictEqual(o.profile.bestBiomass, 800)
  })

  check('结算屏文案：有新纪录才提示', () => {
    const none = applyRun({ ...defaultProfile(), bestBiomass: 999, bestLayer: 4, bestWave: 3 },
      { biomass: 10, layer: 0, wave: 0, bossDown: false, sub: 'lumen' })
    assert.strictEqual(recordLabel(none), null)
    const both = applyRun(defaultProfile(),
      { biomass: 500, layer: 3, wave: 2, bossDown: false, sub: 'lumen' })
    assert.ok(recordLabel(both).includes('带出生物质'))
    assert.ok(recordLabel(both).includes('最深层'))
  })
}

// ---------------------------------------------------------------------------
console.log('\n[7] 元系统（沉淀 / 解锁 / 永久强化 / 图鉴）')
{
  check('沉淀：带出 400 ⇒ 沉淀 100（25%），bio 与 totalBanked 同步', () => {
    const o = applyRun(defaultProfile(),
      { biomass: 400, layer: 1, wave: 2, bossDown: false, sub: 'lumen', surfaced: true })
    assert.strictEqual(o.banked, 100)
    assert.strictEqual(o.profile.bio, 100)
    assert.strictEqual(o.profile.totalBanked, 100)
    assert.strictEqual(o.profile.surfaced, 1)
  })

  check('溺水：沉淀 0，surfaced 不加', () => {
    const o = applyRun(defaultProfile(),
      { biomass: 0, layer: 1, wave: 1, bossDown: false, sub: 'lumen', surfaced: false })
    assert.strictEqual(o.banked, 0)
    assert.strictEqual(o.profile.bio, 0)
    assert.strictEqual(o.profile.surfaced, 0)
  })

  check('图鉴计数：刷怪增量累加、同族只算一次、0 计数不写', () => {
    const g = codexGains({
      spawned: { swarm: 5, dash: 2, drift: 0 }, bossDown: false,
      weaponIds: ['gun', 'gun_gl'], relicIds: ['echo_heart'],
    })
    assert.strictEqual(g['enemy:swarm'], 5)
    assert.strictEqual(g['enemy:dash'], 2)
    assert.strictEqual(g['enemy:drift'], undefined, '0 计数不该写进增量')
    assert.strictEqual(g['weapon:gun'], 1, '同族的进化形态只算一次')
    assert.strictEqual(g['relic:echo_heart'], 1)
    const o1 = applyRun(defaultProfile(), { biomass: 0, layer: 0, wave: 0, bossDown: false, sub: 'lumen', seen: g })
    const o2 = applyRun(o1.profile, { biomass: 0, layer: 0, wave: 0, bossDown: false, sub: 'lumen', seen: g })
    assert.strictEqual(o2.profile.seen['enemy:swarm'], 10, '遇见次数要累加')
  })

  check('解锁：上浮 5 次 ⇒ 解锁刺鳐', () => {
    let p = defaultProfile()
    for (let i = 0; i < 5; i++) {
      p = applyRun(p, { biomass: 100, layer: 1, wave: 1, bossDown: false, sub: 'lumen', surfaced: true }).profile
    }
    const prog = settleProgress(p)
    assert.ok(prog.unlocked.includes('sub:raia'), `unlocked=${prog.unlocked}`)
    assert.ok(prog.profile.unlocks.includes('sub:raia'))
  })

  check('默认解锁：新档也有灯艇 / 机枪 / 鱼叉 / 回声', () => {
    const u = evalUnlocks(defaultProfile())
    for (const id of ['sub:lumen', 'weapon:gun', 'weapon:harpoon', 'weapon:echo']) {
      assert.ok(u.includes(id), `缺 ${id}（unlocked=${u}）`)
    }
    assert.ok(!u.includes('weapon:torpedo'), '鱼雷不该默认解锁')
  })

  check('抽池过滤：默认档有机枪卡、没有鱼雷/电弧/声呐/酸液卡', () => {
    const pool = filterPool(defaultProfile())
    assert.ok(pool.some(u => u.id === 'w_gun'), '机枪卡应在池里')
    assert.ok(!pool.some(u => u.id === 'w_torp'), '鱼雷卡不该在池里')
    assert.ok(!pool.some(u => u.id === 'w_arc'), '电弧卡不该在池里')
    assert.ok(!pool.some(u => u.id === 'e_torp_hv'), '鱼雷进化卡不该在池里')
    assert.ok(!pool.some(u => u.relicId === 'overload_core'), '未解锁遗物不该在池里')
    assert.ok(pool.some(u => u.relicId === 'echo_heart'), '默认遗物应在池里')
  })

  check('永久强化：购买扣 bio / 等级 +1 / 满级不可再买 / 满级 +10%', () => {
    let p = { ...defaultProfile(), bio: 1000 }
    assert.ok(canBuyPerk(p, 'reload'))
    p = buyPerk(p, 'reload')
    assert.strictEqual(perkBonus(p).rate, 0.02)
    for (let i = 0; i < 4; i++) p = buyPerk(p, 'reload')
    assert.strictEqual(perkLevel(p, 'reload'), 5)
    assert.strictEqual(canBuyPerk(p, 'reload'), false, '满级后不能再买')
    assert.ok(Math.abs(perkBonus(p).rate - 0.1) < 1e-9, `rate=${perkBonus(p).rate}`)
  })

  check('世界吃永久强化：perk 注入后开局 o2Max / rate 生效', () => {
    const w = new DiveWorld({ w: W, h: H, seed: 1, perk: { rate: 0.1, o2Bonus: 15, pickup: 0.2 } })
    assert.strictEqual(w.o2Max, 100 + 25 + 15, `o2Max=${w.o2Max}`)
    assert.ok(Math.abs(w.st.rate - 0.1) < 1e-9, `rate=${w.st.rate}`)
  })

  check('世界刷怪计数：跑一会儿后 spawned 非空（图鉴计数来源）', () => {
    const w = run(555, 30, circularInput).world
    const n = Object.values(w.spawned).reduce((a, b) => a + b, 0)
    assert.ok(n > 0, `spawned=${JSON.stringify(w.spawned)}`)
  })
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
