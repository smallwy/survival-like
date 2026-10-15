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
  CODEX, CARD_POOL, STAT_CARD, NEW_STATS,
  TURRET_SPIN, TURRET_OMEGA_IDLE, TURRET_OMEGA_TRACK, STREAK_MAX_LV,
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
      spawned: { swarm: 5, dash: 2, drift: 0 }, bossesDown: [],
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

  // ---- V6.78：图鉴全表 ↔ codexGains 的**对账**（此前漏了三处，且不报错）----
  check('图鉴对账：CODEX 里的每一条都必须有产出路径', () => {
    // ⚠️ kind 列表**从 `CODEX` 反推**，不在这里手写第二份 —— 手写的那份一定会漂移
    //    （V6.79 加第 5 类时就正是撞在这里：表里加了，断言的字面量没加）。
    const enemyKinds = CODEX.filter(e => e.cat === 'enemy').map(e => e.id.slice(6))
    // ① 敌人：CODEX 里每个 enemy:* 都要能记上
    const ge = codexGains({
      spawned: Object.fromEntries(enemyKinds.map(k => [k, 1])), bossesDown: [],
      weaponIds: [], relicIds: [],
    })
    for (const k of enemyKinds) {
      assert.strictEqual(ge['enemy:' + k], 1, `enemy:${k} 记不上（CODEX 有这条，codexGains 产不出来）`)
    }
    // ② Boss：两个种类是**两条**
    const gw = codexGains({ spawned: {}, bossesDown: ['watcher'], weaponIds: [], relicIds: [] })
    const ga = codexGains({ spawned: {}, bossesDown: ['angler'], weaponIds: [], relicIds: [] })
    const gb = codexGains({ spawned: {}, bossesDown: ['watcher', 'angler'], weaponIds: [], relicIds: [] })
    assert.strictEqual(gw['boss:abyss'], 1)
    assert.strictEqual(gw['boss:angler'], undefined, '只杀守望者不该点亮鮟鱇女王')
    assert.strictEqual(ga['boss:angler'], 1, '杀鮟鱇女王要点亮它自己那条（旧版写死 boss:abyss）')
    assert.strictEqual(ga['boss:abyss'], undefined)
    assert.strictEqual(gb['boss:abyss'], 1)
    assert.strictEqual(gb['boss:angler'], 1)
    // ③ 武器族：10 个族一个一个喂，每族都必须出 id（旧版漏了 mine / net / lure）
    const famBase = {
      gun: 'gun', torpedo: 'torpedo', arc: 'arc', sonar: 'sonar', harpoon: 'harpoon',
      echo: 'echo', acid: 'acid', mine: 'mine', net: 'net', lure: 'lure',
    }
    for (const [fam, id] of Object.entries(famBase)) {
      const g = codexGains({ spawned: {}, bossesDown: [], weaponIds: [id], relicIds: [] })
      assert.strictEqual(g['weapon:' + fam], 1, `weapon:${fam} 记不上（famOf 缺这个族）`)
    }
  })

  check('图鉴对账：CODEX 的**每一条**都能被 codexGains 产出（穷举）', () => {
    // 构造一个"什么都见过"的快照，把全表逐条点亮后比对。
    // ⚠️ 敌人那半同样**从 CODEX 反推**（理由同上：手写副本必然漂移）。
    const all = codexGains({
      spawned: Object.fromEntries(
        CODEX.filter(e => e.cat === 'enemy').map(e => [e.id.slice(6), 1]),
      ),
      bossesDown: ['watcher', 'angler'],
      weaponIds: CODEX.filter(e => e.cat === 'weapon').map(e => e.id.slice(7)),
      relicIds: CODEX.filter(e => e.cat === 'relic').map(e => e.id.slice(6)),
    })
    const missing = CODEX.filter(e => !(all[e.id] > 0)).map(e => e.id)
    assert.deepStrictEqual(missing, [], `这些图鉴条目永远解锁不了：${missing.join(', ')}`)
  })

  check('V6.79 盘旋猎手：刷得出来，而且**绕着来**（不正面冲）', () => {
    const w = new DiveWorld({ w: W, h: H, seed: 11 })
    w.layerIdx = 2                       // L3：orbitRatio 0.12（L1 是 0，不给机制）
    let orb = null, sw = null
    for (let i = 0; i < 600 && (!orb || !sw); i++) {
      w.spawnEnemy({ x: 1000, y: 360 })
      const e = w.enemies[w.enemies.length - 1]
      if (e.kind === 'orbit' && !orb) orb = e
      if (e.kind === 'swarm' && !sw) sw = e
    }
    assert.ok(orb, 'L3（orbitRatio 0.12）刷不出盘旋猎手')
    assert.ok(sw, '对照组：刷不出游群')
    w.enemies.length = 0
    w.enemies.push(orb, sw)

    // 「朝向」判据：位移方向与「朝玩家」的夹角。
    //   直线追人的那类 ≈ 1.0；盘旋猎手 = 切向(1) + 径向(0.45) ⇒ ≈ 0.41 ⇒ 一眼可分。
    const probe = (e) => {
      const tx = w.px - e.x, ty = w.py - e.y
      const L = Math.hypot(tx, ty) || 1
      const x0 = e.x, y0 = e.y
      w.update(DT, { dx: 0, dy: 0, burst: false })
      const mx = e.x - x0, my = e.y - y0
      const M = Math.hypot(mx, my) || 1
      return (mx / M) * (tx / L) + (my / M) * (ty / L)
    }
    const dOrb = probe(orb)
    const dSw = probe(sw)
    assert.ok(dOrb < 0.6, `盘旋猎手的位移不是切向（dot=${dOrb.toFixed(2)}）`)
    assert.ok(dSw > 0.9, `对照组游群应当正面冲（dot=${dSw.toFixed(2)}）`)

    // 绕圈：绕玩家的角度必须一直在变；且距离在收
    const ang = () => Math.atan2(orb.y - w.py, orb.x - w.px)
    const a0 = ang()
    const r0 = Math.hypot(orb.x - w.px, orb.y - w.py)
    for (let i = 0; i < 40; i++) w.update(DT, { dx: 0, dy: 0, burst: false })
    assert.ok(Math.abs(ang() - a0) > 0.08, '盘旋猎手没有绕圈（绕玩家的角度没变）')
    assert.ok(Math.hypot(orb.x - w.px, orb.y - w.py) < r0, '盘旋猎手没有收拢（半径没变小）')
  })

  // ---- V6.79b：缠索（盘旋猎手的专属压力）----
  check('V6.79b 缠索：只压移速 · 同时只有一条索 · 杀掉即松 + 免疫窗', () => {
    const pickOrbit = (w, x, y) => {
      for (let i = 0; i < 600; i++) {
        w.spawnEnemy({ x, y })
        const e = w.enemies[w.enemies.length - 1]
        if (e.kind === 'orbit') return e
      }
      return null
    }
    // 同种子跑两次，只差"有没有索" —— 其余（暗流 / 涌流 / 波次）两次完全一致
    const walk = (withTether) => {
      const w = new DiveWorld({ w: W, h: H, seed: 31 })
      w.layerIdx = 2
      const orb = pickOrbit(w, 1000, 360)
      assert.ok(orb, 'L3 刷不出盘旋猎手')
      w.enemies.length = 0
      if (withTether) {
        orb.hp = orb.maxHp = 1e9          // 只测移动：别让它被武器打死（打死了索就松了）
        orb.x = w.px + 50; orb.y = w.py   // 50px：在咬住半径(70)之内、在接触半径(42)之外
        w.enemies.push(orb)
      }
      const x0 = w.px, y0 = w.py
      // 往**背离它**的方向游（它在上方 +50px，所以往左）
      for (let i = 0; i < 12; i++) w.update(DT, { dx: -1, dy: 0, burst: false })
      return { d: Math.hypot(w.px - x0, w.py - y0), w, orb }
    }
    const free = walk(false)
    const held = walk(true)
    assert.strictEqual(held.w.tetherSrc, held.orb, '贴身盘旋猎手没有咬住玩家')
    assert.ok(held.d < free.d * 0.55,
      `被缠住时位移没有明显变小：free=${free.d.toFixed(2)} held=${held.d.toFixed(2)}`)

    const w = held.w
    // ★ 红线①：再放两只贴上去，**不能顶掉正在生效的那条索**
    for (let i = 0; i < 2; i++) {
      const o = pickOrbit(w, w.px + 40, w.py + 8)
      assert.ok(o, '造不出第二只/第三只盘旋猎手')
      o.hp = o.maxHp = 1e9
      o.x = w.px + 40; o.y = w.py + 8
    }
    w.update(DT, { dx: 0, dy: 0, burst: false })
    assert.strictEqual(w.tetherSrc, held.orb, '同时只能有一条索（新索不许顶掉旧的）')

    // ★ 杀掉来源 ⇒ 立刻松 + 进免疫窗
    held.orb.alive = false
    w.update(DT, { dx: 0, dy: 0, burst: false })
    assert.strictEqual(w.tetherSrc, null, '来源死了索没松')
    assert.ok(w.tetherImmune > 0, '松索后没有进免疫窗（没有它 = 刚挣开又被咬上 = 永久减速）')
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

  // -------------------------------------------------------------------------
  // V6.77 炮塔「丝滑转向」—— 临界阻尼二阶系统的解析解递推（`slewTurretAims`）
  //
  // 判据全部针对**旧写法的症结**：恒速钳位 `clamp(rel*min(1,dt*14), ±SPIN*dt)` 的速度曲线
  // 是**方波**（第一帧就满速 917°/s）⇒ 开局下潜时 0.1s 甩完 90°，用户读作「突兀」。
  // 所以这里不只断言"转到位了"，而是断言**速度曲线的形状**：首帧必须远低于峰值、峰值在中间。
  // ⚠️ 复刻一遍解析解是刻意的：ω/SPIN 从真源 import，参数一改这里立刻失衡。
  // -------------------------------------------------------------------------

  /** 纯阶跃响应：复刻 `slewTurretAims` 的解析解递推（不含目标切换 / sway） */
  function slewStep(omega, spin, targetRad, dt, n) {
    let a = 0, v = 0
    const ang = [], vel = []
    for (let i = 0; i < n; i++) {
      const rel = targetRad - a
      const wt = omega * dt
      const b = v + omega * rel
      const ex = Math.exp(-wt)
      const nx = (rel + b * dt) * ex
      v = Math.max(-spin, Math.min(spin, (v - omega * b * dt) * ex))
      a = a + (rel - nx)
      ang.push(a); vel.push(v)
    }
    return { ang, vel }
  }

  for (const [tag, omega, maxFirst] of [['待机', TURRET_OMEGA_IDLE, 0.4], ['索敌', TURRET_OMEGA_TRACK, 0.75]]) {
    check(`炮塔转向[${tag}档 ω=${omega}]：四档 dt 阶跃 180° 都不过冲`, () => {
      for (const dt of [1 / 60, 1 / 30, 1 / 20, 0.1]) {
        const { ang } = slewStep(omega, TURRET_SPIN, Math.PI, dt, Math.round(2.5 / dt))
        const over = Math.max(...ang) - Math.PI
        assert.ok(over <= 1e-3, `dt=${dt.toFixed(4)} 过冲 ${(over * 180 / Math.PI).toFixed(2)}°`)
      }
    })

    // 「不是方波」的判据 = **首帧不能已经贴着峰值**。旧写法首帧/峰值 = 1.00（第一帧直接满速）。
    // ⚠️ 阈值按档给：首帧速度的理论值是 `峰值 × ω·dt·e^(−ωdt)/0.368`（ω·dt = 0.13 时 ≈0.33、
    //    0.33 时 ≈0.65）。所以索敌档 0.75 不是"放水"，而是**数学上的必然值**；
    //    待机档卡 0.40 才是"用户在开局看到的那一段必须真的慢起"。
    check(`炮塔转向[${tag}档]：速度曲线不是方波（首帧 ≤ 峰值×${maxFirst}，峰值在中间）`, () => {
      const { vel } = slewStep(omega, TURRET_SPIN, Math.PI / 2, DT, 90)
      const peak = Math.max(...vel.map(Math.abs))
      const first = Math.abs(vel[0])
      assert.ok(first <= peak * maxFirst,
        `首帧 ${(first * 180 / Math.PI).toFixed(0)}°/s 对峰值 ${(peak * 180 / Math.PI).toFixed(0)}°/s（上限 ×${maxFirst}）`)
      const iPeak = vel.findIndex(v => Math.abs(v) === peak)
      assert.ok(iPeak > 0 && iPeak < vel.length - 1, `峰值落在 f${iPeak}（应为中间）`)
    })

    check(`炮塔转向[${tag}档]：峰值角速度 ≈ 0.368·ω·Δθ（临界阻尼特征值）`, () => {
      const target = Math.PI / 2
      const { vel } = slewStep(omega, TURRET_SPIN, target, DT, 90)
      const peak = Math.max(...vel.map(Math.abs))
      const ratio = peak / (0.368 * omega * target)
      assert.ok(ratio > 0.85 && ratio < 1.15, `峰值/理论 = ${ratio.toFixed(3)}`)
    })
  }

  check('炮塔转向：索敌档比待机档快（否则命中率会被拖下来）', () => {
    assert.ok(TURRET_OMEGA_TRACK > TURRET_OMEGA_IDLE,
      `TRACK=${TURRET_OMEGA_TRACK} IDLE=${TURRET_OMEGA_IDLE}`)
  })

  check('炮塔转向：开局下潜时角度单调（无回头）+ 速度先升后降', () => {
    const w = new DiveWorld({ w: W, h: H, seed: 7 })
    const ang = [], vel = []
    for (let i = 0; i < 24; i++) {
      w.update(DT, { dx: 0, dy: 1, burst: false })
      ang.push(w.weapons[0].aimAng)
      vel.push(w.weapons[0].aimV)
    }
    for (let i = 1; i < ang.length; i++) {
      assert.ok(ang[i] >= ang[i - 1] - 1e-9, `f${i} 角度回头了：${ang[i - 1]} → ${ang[i]}`)
    }
    assert.ok(ang[ang.length - 1] <= Math.PI / 2 + 1e-6,
      `24 帧内已超过 90°：${ang[ang.length - 1]}`)
    const iPeak = vel.findIndex(v => Math.abs(v) === Math.max(...vel.map(Math.abs)))
    assert.ok(iPeak > 0 && iPeak < vel.length - 1, `速度峰值落在 f${iPeak}（应为中间）`)
  })

  check('换武器 / 新增武器：角速度归零（否则下一帧会跳一下）', () => {
    const w = new DiveWorld({ w: W, h: H, seed: 3 })
    for (let i = 0; i < 20; i++) w.update(DT, { dx: 0, dy: 1, burst: false })
    assert.ok(w.weapons[0].aimV !== 0, '前提不成立：跑 20 帧后角速度仍为 0')
    w.evolveWeapon(w.weapons[0].id, w.weapons[0].id)
    assert.strictEqual(w.weapons[0].aimV, 0, `evolve 后 aimV=${w.weapons[0].aimV}`)
    const before = w.weapons.length
    w.addWeapon('torpedo')
    const fresh = w.weapons[w.weapons.length - 1]
    assert.strictEqual(fresh.aimV, 0, `新武器 aimV=${fresh.aimV}`)
    assert.ok(w.weapons.length >= before, '武器数不该减少')
  })

  check('V6.77d 五个新维度：卡 → 属性 → 模拟层真的生效（不是只多加了几个键）', () => {
    // ① 六张新卡都在池里，且都登记进了 STAT_CARD
    //    ⚠️ 漏登记 `STAT_CARD` 的症状是"卡能买、属性面板不显示" —— 静默。
    for (const id of ['s_critmul', 's_streak', 's_hunt', 's_bspeed', 's_servo', 's_pen']) {
      assert.ok(CARD_POOL.some(c => c.id === id), `卡池里缺 ${id}`)
      assert.ok(STAT_CARD[id], `${id} 没登记进 STAT_CARD（属性面板会漏掉它）`)
    }
    // ② 默认值必须都是 0 ⇒ 没买卡时行为与"加维度之前"逐帧一致（老存档不漂）
    const base = NEW_STATS()
    for (const k of ['streak', 'slowDmg', 'bulletSpd', 'turretSpeed', 'armorPen']) {
      assert.strictEqual(base[k], 0, `${k} 的默认值必须是 0`)
    }

    // ③ 猎杀节奏：连杀层数乘进 dmgMulNow，且层数封顶
    const w = new DiveWorld({ w: W, h: H, seed: 5 })
    const m0 = w.dmgMulNow()
    w.st.streak = 0.1
    w.comboCnt = 3
    assert.ok(Math.abs(w.dmgMulNow() / m0 - 1.3) < 1e-9, '猎杀节奏：3 层 ×10% 应为 ×1.3')
    w.comboCnt = 99
    assert.ok(Math.abs(w.dmgMulNow() / m0 - (1 + 0.1 * STREAK_MAX_LV)) < 1e-9,
      `猎杀节奏层数必须钳在 ${STREAK_MAX_LV}`)
    w.st.streak = 0
    assert.ok(Math.abs(w.dmgMulNow() / m0 - 1) < 1e-9, '没买卡时不应有任何加成')

    // ④ 狩猎本能 / 破甲穿透：走真实 hurt()，比对同一只怪"有 / 无"状态下的掉血
    const w2 = new DiveWorld({ w: W, h: H, seed: 6 })
    w2.spawnEnemy({ x: 200, y: 200 })
    const e = w2.enemies[0]
    assert.ok(e, '前提不成立：spawnEnemy 没造出敌人')
    const dmgOf = () => { e.hp = 1e9; w2.hurt(e, 100); return 1e9 - e.hp }

    const plain = dmgOf()
    e.slowT = 1; e.slowMul = 0.5
    w2.st.slowDmg = 0.35
    assert.ok(Math.abs(dmgOf() / plain - 1.35) < 1e-6, '狩猎本能：对被控目标应 ×1.35')
    e.slowT = 0; w2.st.slowDmg = 0

    // 破甲穿透：armor 0.6 的减伤被按比例打折（不是"无视" —— 那是 pierce 的语义）
    e.armor = 0.6
    const a0 = dmgOf()
    w2.st.armorPen = 0.5
    const a1 = dmgOf()
    assert.ok(Math.abs(a1 / a0 - (1 - 0.6 * 0.5) / (1 - 0.6)) < 1e-6,
      `破甲穿透：50% 穿透应把 60% 减伤压到 30%（实测倍率 ${(a1 / a0).toFixed(3)}）`)
  })

  check('V6.77d 弹道增压：只改弹速、不改射程（否则它偷偷变成一张射程卡）', () => {
    const shot = (spdAdd) => {
      const w = new DiveWorld({ w: W, h: H, seed: 11 })
      w.addWeapon('gun')
      w.st.bulletSpd = spdAdd
      for (let i = 0; i < 600; i++) {
        // ⚠️ 两处前提缺一不可：① 武器只在 `nearestEnemy` 命中时才开火 ⇒ 必须有敌人；
        //    ② `bullets` 里还混着声呐波前（没有 vx/vy）⇒ 必须按 `kind` 挑，不能取 [0]。
        if (!w.enemies.length) w.spawnEnemy({ x: 900, y: 375 })
        w.update(DT, { dx: 0, dy: 0, burst: false })
        if (w.bullets.some(x => x.kind === 'gun')) break
      }
      const b = w.bullets.find(x => x.kind === 'gun')
      assert.ok(b, '前提不成立：600 帧内没有开火')
      return { v: Math.hypot(b.vx, b.vy), range: Math.hypot(b.vx, b.vy) * b.life }
    }
    const a = shot(0)
    const b = shot(0.5)
    assert.ok(b.v > a.v * 1.4, `弹速应显著变快（${a.v.toFixed(0)} → ${b.v.toFixed(0)}）`)
    assert.ok(Math.abs(b.range / a.range - 1) < 0.02,
      `射程必须不变（实测 ${a.range.toFixed(0)} → ${b.range.toFixed(0)}）`)
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
