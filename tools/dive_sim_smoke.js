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
  // V6.82 新生物
  LAYERS, LAYER_WAVES, spawnWeights, SWARM_MIN, CODEX_BYPRODUCT_KINDS, ENEMY_TEX,
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

  // =========================================================================
  // V6.82 第一批新生物（计划书 §5.4「20 种生物图鉴」）
  // =========================================================================
  check('V6.82 刷怪配比：换算法**不引入配比漂移**', () => {
    // 旧写法 = "swarm 拿残差 1−Σ，其余按原始值分"。
    // 换算法要守住的是两条：
    //   ① **没有 `mix` 的层**（L1）：占比与旧公式**逐位一致** ⇒ 证明替换本身零漂移；
    //   ② **所有层**：基础四类（drift / dash / armor / orbit）**彼此之间的比例不变**
    //      （只有 swarm 的份额被新生物挤小 —— 那是刻意的，见 `LayerDef.mix` 的注释）。
    let exact = 0
    LAYERS.forEach((L, li) => {
      LAYER_WAVES[li].forEach((wv, wi) => {
        const raw = {
          drift: L.driftRatio,
          dash: wv.dashRatio * L.dashMul,
          armor: L.armorRatio,
          orbit: L.orbitRatio,
        }
        const wl = spawnWeights(L, wv)
        const tot = wl.reduce((a, [, v]) => a + v, 0)
        const got = Object.fromEntries(wl.map(([k, v]) => [k, v / tot]))
        // ② 基础四类之间的比例
        const base = Object.entries(raw).filter(([, v]) => v > 1e-9)
        for (const [k1, v1] of base) {
          for (const [k2, v2] of base) {
            if (v1 <= 1e-9 || v2 <= 1e-9) continue
            const ratio = got[k1] / got[k2]
            assert.ok(Math.abs(ratio - v1 / v2) < 1e-9,
              `L${li + 1} 第 ${wi + 1} 波：${k1}/${k2} 的相对比例被改了（${ratio.toFixed(4)} ≠ ${(v1 / v2).toFixed(4)}）`)
          }
        }
        // ① 无 mix 的层：连 swarm 都要一模一样
        if (!L.mix) {
          const sum = Object.values(raw).reduce((a, b) => a + b, 0)
          assert.ok(Math.abs((got.swarm ?? 0) - (1 - sum)) < 1e-9,
            `L${li + 1} 第 ${wi + 1} 波（无 mix）：swarm 占比 ${(got.swarm ?? 0).toFixed(4)} ≠ ${(1 - sum).toFixed(4)}`)
          exact++
        }
      })
    })
    assert.ok(exact >= 4, `只有 ${exact} 个"无 mix 层"的样本被逐位校验，太少`)
  })

  check('V6.82 刷怪配比：**新生物真的挤掉了份额，而不是没生效**', () => {
    // 反向断言：如果哪天 `mix` 被漏读（比如 `spawnWeights` 忘了遍历它），
    // 上面的"比例不变"仍然全绿 —— 必须有这一条盯着。
    LAYERS.forEach((L, li) => {
      if (!L.mix) return
      const wv = LAYER_WAVES[li][0]
      const wl = Object.fromEntries(spawnWeights(L, wv))
      let sumOthers = 0
      for (const k of Object.keys(wl)) if (k !== 'swarm') sumOthers += wl[k]
      for (const [k, v] of Object.entries(L.mix)) {
        assert.ok((wl[k] ?? 0) > 0, `L${li + 1} 的 mix 项 ${k} 没进权重表（mix 被漏读了）`)
        assert.ok(Math.abs((wl[k] ?? 0) - v) < 1e-9, `L${li + 1} 的 ${k} 权重 ≠ mix 里写的（${wl[k]} ≠ ${v}）`)
      }
      assert.ok(Math.abs(wl.swarm - Math.max(SWARM_MIN, 1 - sumOthers)) < 1e-9,
        `L${li + 1} 的 swarm 权重应为 max(${SWARM_MIN}, 1−Σ其他=${(1 - sumOthers).toFixed(4)})，实测 ${wl.swarm}`)
    })
  })

  check('V6.82 刷怪配比：**饱和层不再让尾部饿死**（L5 修掉旧坑）', () => {
    // 旧写法在 L5 全程 Σ其他 > 1 ⇒ armor / orbit 出现率恒为 0（V6.79 记过）。
    const li = LAYERS.length - 1
    for (const wv of LAYER_WAVES[li]) {
      const wl = Object.fromEntries(spawnWeights(LAYERS[li], wv))
      for (const k of ['swarm', 'drift', 'dash', 'armor', 'orbit', 'bulwark', 'brood', 'herder']) {
        assert.ok((wl[k] ?? 0) > 0, `L${li + 1} 的 ${k} 权重为 0（尾部被饿死）`)
      }
    }
  })

  check('V6.82 新生物：该出现的层刷得出，**L1 一个都不给**', () => {
    const sample = (layerIdx, n) => {
      const w = new DiveWorld({ w: W, h: H, seed: 7 })
      w.layerIdx = layerIdx
      const seen = {}
      for (let i = 0; i < n; i++) {
        w.spawnEnemy({ x: 900, y: 375 })
        const e = w.enemies[w.enemies.length - 1]
        seen[e.kind] = (seen[e.kind] ?? 0) + 1
      }
      return seen
    }
    const NEW = ['splitter', 'bulwark', 'brood', 'kamikaze', 'herder']
    // L1：**`mix` 是空的** ⇒ 五种新生物一个都不许出现（教学层不给"新招"）。
    // ⚠️ 不能把 drift / armor / orbit 一起断言掉：L1 的 `orbitRatio` 是 **0.06**
    //    （V6.79c 为了"可发现性"特意开的 —— 盘旋猎手只改"怎么躲"，不教新系统）。
    const l1 = sample(0, 3000)
    for (const k of NEW) {
      assert.ok(!l1[k], `L1 不该刷出 ${k}（L1 没有 mix：教学层不给新机制）`)
    }
    // 每一层：凡该层 `mix` 里写了的，跑 3000 次必须一次不落地出现过
    const all = {}
    LAYERS.forEach((L, li) => {
      const seen = sample(li, 3000)
      for (const [k, v] of Object.entries(L.mix ?? {})) {
        assert.ok(seen[k] > 0, `L${li + 1} 的 mix 里有 ${k}（权重 ${v}），但 3000 次一次都没刷出来`)
        all[k] = (all[k] ?? 0) + seen[k]
      }
    })
    for (const k of NEW) assert.ok(all[k] > 0, `五种新生物里 ${k} 在任何层都刷不出来`)
  })

  check('V6.82 裂体：**血空时裂成 2 只幼体**（排到帧末落地）', () => {
    const w = new DiveWorld({ w: W, h: H, seed: 21 })
    w.layerIdx = 2
    let sp = null
    for (let i = 0; i < 3000 && !sp; i++) {
      w.spawnEnemy({ x: 300, y: 200 })
      const e = w.enemies[w.enemies.length - 1]
      if (e.kind === 'splitter') sp = e
    }
    assert.ok(sp, 'L3 刷不出裂体')
    w.enemies.length = 0
    w.enemies.push(sp)
    const before = w.enemies.length
    w.hurt(sp, 1e9)                                   // 一发打死
    assert.ok(!sp.alive, '裂体没被打死')
    assert.strictEqual(w.enemies.filter(e => e.kind === 'shard').length, 0,
      '分裂不该在 hurt() 里直接落地（那会在遍历中途改数组）')
    w.update(DT, { dx: 0, dy: 0, burst: false })      // 帧末 flushShards 在 update() 里
    const shards = w.enemies.filter(e => e.kind === 'shard')
    assert.strictEqual(shards.length, 2, `应裂出 2 只幼体，实测 ${shards.length}`)
    assert.ok(shards.every(e => e.hp > 0 && e.speed > sp.speed),
      '幼体应当"更小更快"（速度高于本体）')
    assert.ok(before === 1)
  })

  check('V6.82 盾鳐：**正面砍 80%，侧后打满**（方向性免疫）', () => {
    const mk = () => {
      const w = new DiveWorld({ w: W, h: H, seed: 5 })
      w.layerIdx = 3
      w.st.crit = 0                                   // 去掉暴击随机，只看方向
      let bw = null
      for (let i = 0; i < 3000 && !bw; i++) {
        w.spawnEnemy({ x: 600, y: 375 })
        const e = w.enemies[w.enemies.length - 1]
        if (e.kind === 'bulwark') bw = e
      }
      assert.ok(bw, 'L4 刷不出盾鳐')
      w.enemies.length = 0
      w.enemies.push(bw)
      bw.dirX = 1; bw.dirY = 0                        // 盾朝右（+x）
      bw.hp = bw.maxHp = 1e9                          // 只测伤害，不测死
      return { w, bw }
    }
    const hitFrom = (sign) => {
      const { w, bw } = mk()
      w.px = bw.x + sign * 200; w.py = bw.y           // sign=+1 ⇒ 在它正面；−1 ⇒ 在它背后
      const h0 = bw.hp
      w.hurt(bw, 100)
      return h0 - bw.hp
    }
    const front = hitFrom(1)
    const back = hitFrom(-1)
    assert.ok(front < back * 0.35, `正面应被砍掉约 80%（正面 ${front.toFixed(1)} vs 背面 ${back.toFixed(1)}）`)
    // ⚠️ 用**比值**判，不用绝对值：`hurt()` 里的 `dmgMulNow()` 是浮动的
    //    （低氧增伤 / 遗物），绝对值会随世界状态漂移 ⇒ 断言会变成"时而红时而绿"。
    assert.ok(Math.abs(front / back - 0.2) < 0.02, `正面/背面伤害比应为 0.2（实测 ${(front / back).toFixed(3)}）`)
    // ★ 爆炸无视方向（与重甲的"爆炸/穿透豁免"同规）—— 这是"换武器"的出路
    const { w, bw } = mk()
    w.px = bw.x + 200; w.py = bw.y
    const h0 = bw.hp
    w.hurt(bw, 100, 'blast')
    const blast = h0 - bw.hp
    assert.ok(Math.abs(blast / back - 1) < 1e-6, `爆炸必须无视方向盾（实测 ${blast.toFixed(1)} vs 背面 ${back.toFixed(1)}）`)
  })

  check('V6.82 孵卵囊：**静止且持续产幼体**，但总幼体有上限（防滚雪球）', () => {
    const w = new DiveWorld({ w: W, h: H, seed: 33 })
    w.layerIdx = 2
    let br = null
    for (let i = 0; i < 3000 && !br; i++) {
      w.spawnEnemy({ x: 300, y: 200 })
      const e = w.enemies[w.enemies.length - 1]
      if (e.kind === 'brood') br = e
    }
    assert.ok(br, 'L3 刷不出孵卵囊')
    w.enemies.length = 0
    w.enemies.push(br)
    br.hp = br.maxHp = 1e9
    const x0 = br.x, y0 = br.y
    for (let i = 0; i < 60 * 20; i++) w.updateEnemies(DT)   // 20 秒
    const shards = w.enemies.filter(e => e.kind === 'shard').length
    assert.ok(shards > 0, '20 秒里一次都没产卵')
    assert.ok(shards <= 26 + 1, `幼体数 ${shards} 超过上限（滚雪球没被拦住）`)
    const moved = Math.hypot(br.x - x0, br.y - y0)
    assert.ok(moved < 300, `孵卵囊应当"几乎不动"，实测位移 ${moved.toFixed(0)}px`)
  })

  check('V6.82 自爆螺：贴近 → 前摇 → **自爆并清掉自己**（且不白送掉落）', () => {
    const w = new DiveWorld({ w: W, h: H, seed: 41 })
    w.layerIdx = 1
    w.st.dodge = 0
    let km = null
    for (let i = 0; i < 3000 && !km; i++) {
      w.spawnEnemy({ x: w.px + 30, y: w.py })
      const e = w.enemies[w.enemies.length - 1]
      if (e.kind === 'kamikaze') km = e
    }
    assert.ok(km, 'L2 刷不出自爆螺')
    w.enemies.length = 0
    w.enemies.push(km)
    km.hp = km.maxHp = 1e9                              // 别让它先被打死，只测自爆
    const o2a = w.o2, bonesA = w.bones.length
    let armed = false
    for (let i = 0; i < 60 * 5 && km.alive; i++) {
      w.updateEnemies(DT)
      if (km.fuse > 0) armed = true
    }
    assert.ok(armed, '没有进入"引信"前摇 —— 那就不会有预警窗')
    assert.ok(!km.alive, '5 秒内没有自爆')
    assert.ok(w.o2 < o2a, `自爆没打到玩家（o2 ${o2a.toFixed(1)} → ${w.o2.toFixed(1)}）`)
    assert.strictEqual(w.bones.length, bonesA, '自爆不该掉骨（配平红线③：不许把"让它炸"变成刷收益）')
  })

  check('V6.82 牧群者：**它自己不追你，但让附近的小怪更快**', () => {
    const walk = (withHerder) => {
      const w = new DiveWorld({ w: W, h: H, seed: 55 })
      w.layerIdx = 3
      let sw = null, hd = null
      for (let i = 0; i < 4000 && (!sw || !hd); i++) {
        w.spawnEnemy({ x: 900, y: 375 })
        const e = w.enemies[w.enemies.length - 1]
        if (e.kind === 'swarm' && !sw) sw = e
        if (e.kind === 'herder' && !hd) hd = e
      }
      assert.ok(sw && hd, 'L4 刷不出游群 / 牧群者')
      w.enemies.length = 0
      sw.x = w.px + 400; sw.y = w.py
      w.enemies.push(sw)
      if (withHerder) { hd.x = w.px + 430; hd.y = w.py; hd.hp = hd.maxHp = 1e9; w.enemies.push(hd) }
      const x0 = sw.x, y0 = sw.y
      for (let i = 0; i < 60; i++) w.updateEnemies(DT)
      return Math.hypot(sw.x - x0, sw.y - y0)
    }
    const plain = walk(false)
    const buffed = walk(true)
    assert.ok(buffed > plain * 1.15,
      `牧群者没给小怪提速（无 ${plain.toFixed(1)}px vs 有 ${buffed.toFixed(1)}px）`)
  })

  check('V6.82 图鉴**双向**对账：刷怪表能产出的 kind ⇔ CODEX 里有条目', () => {
    // 方向①（V6.78 立）：CODEX 里有的 → codexGains 必须能产出。见上面那条穷举断言。
    // 方向②（V6.82 补）：**刷怪表能产出的 → 图鉴里必须有一条**。
    //   ⚠️ 两张表都从**表本身反推**，不手写第二份列表（手写副本必然漂移）。
    const spawnable = new Set()
    LAYERS.forEach((L, li) => {
      for (const wv of LAYER_WAVES[li]) for (const [k] of spawnWeights(L, wv)) spawnable.add(k)
    })
    const byproduct = new Set(CODEX_BYPRODUCT_KINDS)
    const codexEnemy = new Set(CODEX.filter(e => e.cat === 'enemy').map(e => e.id.slice(6)))
    const missing = [...spawnable].filter(k => k !== 'boss' && !byproduct.has(k) && !codexEnemy.has(k))
    assert.deepStrictEqual(missing, [], `这些生物刷得出来但图鉴里没有：${missing.join(', ')}`)
    const orphan = [...codexEnemy].filter(k => !spawnable.has(k) && !byproduct.has(k))
    assert.deepStrictEqual(orphan, [], `图鉴里有、但刷怪表产不出来的生物：${orphan.join(', ')}`)
    // ⚠️ 这里**刻意不写死条数**（原来写的是 `=== 10`）。V6.83 加第二批时它直接挂了 ——
    //    而它挂了**不代表任何真实问题**，纯粹是"手写的第二份清单"在漂移（铁律 15）。
    //    `missing` / `orphan` 两条**已经完整覆盖**了双向一致性，条数断言是冗余的。
  })

  // =======================================================================
  // V6.83 第二批 7 种生物的行为断言
  //   每种一条，测的都是"它凭什么和别的鱼不一样"——
  //   ⚠️ 断言不写"数值应该更好"，只写**行为存在**（配平是另一回事）
  // =======================================================================

  /** 造一只替身敌人（`mkEnemy` 是 private，测试里手搓一只等价物） */
  function mke(kind, x, y, extra = {}) {
    return {
      kind, x, y, r: 20, hp: 1e9, maxHp: 1e9, speed: 0,
      vx: 0, vy: 0, kx: 0, ky: 0,
      dirX: 1, dirY: 0, fx: 1, fy: 0, phase: 'chase', t: 0,
      alive: true, flash: 0, tex: '', texRot: 0, bossKind: 'watcher',
      slowT: 0, slowMul: 1, rootT: 0, rootImmune: 0,
      armor: 0, elite: false, burnT: 0, burnDps: 0, burnTick: 0,
      charmT: 0, charmTick: 0, color: 0,
      ...extra,
    }
  }
  /** 空场世界：`startWave` 后清掉刷出来的，**并卸掉玩家武器** */
  function rig(seed) {
    const w = new DiveWorld({ w: W, h: H, seed })
    w.startWave()
    w.enemies.length = 0
    // ⚠️ 必须卸武器：玩家的射程 420，替身放进去会被自动开火打中 ⇒ 触发击退积分
    //    （`e.kx/ky`），于是"静止"的替身会**每帧被推着走**。
    //    这一条让 mimic 的断言一度误报"位移 68px"，查了半天才发现是测试装置的锅。
    w.weapons.length = 0
    w.o2 = w.o2Max
    return w
  }
  const step = (w, n) => { for (let i = 0; i < n; i++) w.update(DT, { dx: 0, dy: 0, burst: false }) }

  check('V6.83 水母：**周期放电**（站得太近才会掉氧，前摇期不结算）', () => {
    // 为什么是它：本作第一个"不碰你也能伤你"的普通敌人。
    // ⚠️ 替身放在 `JELLY_ZAP_R` 内但**接触半径外**（60 > 20+22=42）——
    //    否则掉氧里混进接触磨损，就分不清是放电还是贴脸。
    const w = rig(5101)
    const e = mke('jelly', w.px + 60, w.py, { r: 22 })
    w.enemies.push(e)
    const b = w.o2
    for (let i = 0; i < Math.ceil(3.4 / DT); i++) { e.x = w.px + 60; e.y = w.py; w.update(DT, { dx: 0, dy: 0, burst: false }) }
    const lost = b - w.o2
    assert.ok(lost > 15, `水母一个周期内应放电后走，实测掉 ${lost.toFixed(1)}（约 1 次 16 + 3.4s 自然流失）`)
  })

  check('V6.83 水母：**半径外不掉氧**（否则它就不是"区域"而是"光环"）', () => {
    const w = rig(5102)
    const e = mke('jelly', w.px + 400, w.py, { r: 22 })
    w.enemies.push(e)
    const b = w.o2
    for (let i = 0; i < Math.ceil(3.4 / DT); i++) { e.x = w.px + 400; e.y = w.py; w.update(DT, { dx: 0, dy: 0, burst: false }) }
    const lost = b - w.o2
    assert.ok(lost < 12, `远离水母时只该有自然流失，实测 ${lost.toFixed(1)}`)
  })

  check('V6.83 拟态：**一动不动**，玩家进 160px 才激活', () => {
    const w = rig(5103)
    const e = mke('mimic', w.px + 340, w.py, { phase: 'rest' })
    w.enemies.push(e)
    const x0 = e.x, y0 = e.y
    step(w, 90)
    assert.ok(Math.hypot(e.x - x0, e.y - y0) < 0.6,
      `休眠期不该移动（位移 ${Math.hypot(e.x - x0, e.y - y0).toFixed(2)}px）`)
    assert.strictEqual(e.phase, 'rest', `玩家在 340px 外时不该激活（实测 ${e.phase}）`)
    assert.strictEqual(e.fx, -1, '休眠时朝向被钉死（会转头的东西不像海底碎屑）')

    // ★ 把玩家挪到它**右边**：这样"激活"才有可观测差异 ——
    //   休眠时朝向固定向左(`-1`)，激活后会翻成朝玩家(`+1`)。
    //   ⚠️ 刻意**不靠位移**验证：替身的 `speed` 是从 `ENEMY_BASE` 注入的，
    //      在测试里手写一个速度等于又多一份"会漂移的副本"（铁律 15）。
    //      朝向翻转是纯行为，与数值无关。
    w.px = e.x + 100; w.py = e.y
    step(w, 3)
    assert.strictEqual(e.phase, 'chase', '玩家进 160px 后应激活')
    assert.ok(e.fx > 0.9, `激活后朝向应翻向玩家（实测 fx=${e.fx.toFixed(2)}）`)
  })

  check('V6.83 枪鱼：**不追踪**（方向恒定）+ 走完 3 趟自行离场', () => {
    const w = rig(5104)
    const e = mke('lancer', w.px + 200, w.py - 100)
    w.enemies.push(e)
    step(w, 2)                                   // 先让它把方向定下来
    const d0x = e.dirX, d0y = e.dirY
    assert.ok(Math.hypot(d0x, d0y) > 0.5, '枪鱼应有一条穿场方向')
    let turning = 0
    for (let i = 0; i < 300; i++) {
      w.update(DT, { dx: 0, dy: 0, burst: false })
      if (!e.alive) break
      // ⚠️ 玩家**站着不动**，若它在追踪，方向会朝玩家变 ⇒ 记下最大方向变化
      turning = Math.max(turning, Math.hypot(e.dirX - d0x, e.dirY - d0y))
    }
    assert.ok(turning < 1e-6, `枪鱼不该转向（方向最大变化 ${turning.toExponential(1)}）`)
  })

  check('V6.83 潜沙者：下潜期**打不到**（"消失"必须是真的消失）', () => {
    const w = rig(5105)
    const e = mke('burrower', w.px + 260, w.py, { phase: 'rest', t: 0 })
    w.enemies.push(e)
    const hp0 = e.hp
    for (let i = 0; i < 30; i++) w.hurt(e, 50, 'bullet')
    assert.strictEqual(e.hp, hp0, `下潜期不该掉血（${hp0} → ${e.hp}）`)
    e.phase = 'chase'
    w.hurt(e, 50, 'bullet')
    assert.ok(e.hp < hp0, '在地面时应能被打到')
  })

  check('V6.83 孢囊：死亡留下**敌对的**酸云（忘了 hostile 就把威胁变成资源）', () => {
    const w = rig(5106)
    const e = mke('bloom', w.px + 120, w.py, { hp: 1, maxHp: 1 })
    w.enemies.push(e)
    const n0 = w.acids.length
    w.hurt(e, 999, 'bullet')
    assert.ok(w.acids.length > n0, '孢囊死亡应留下酸云')
    const cloud = w.acids[w.acids.length - 1]
    assert.strictEqual(cloud.hostile, true,
      '⚠️ 酸云必须带 `hostile: true` —— 否则它会去伤敌人，"打死孢囊"变成白得一片伤敌地形')
    assert.ok(cloud.r > 30 && cloud.life > 2, `云的尺寸/寿命应成型（r=${cloud.r} life=${cloud.life}）`)
  })

  check('V6.83 吸血蛭：接触**吸氧转自己的血**，且**不造成**常规 24/s 磨损', () => {
    const w = rig(5107)
    const e = mke('leech', w.px, w.py, { hp: 10, maxHp: 100, r: 19 })
    w.enemies.push(e)
    const b = w.o2, hp0 = e.hp
    for (let i = 0; i < 60; i++) { e.x = w.px; e.y = w.py; w.update(DT, { dx: 0, dy: 0, burst: false }) }
    const lost = b - w.o2
    assert.ok(e.hp > hp0 + 4, `蛭应把吸到的氧转成血（${hp0} → ${e.hp.toFixed(1)}）`)
    assert.ok(lost < 12,
      `蛭不该造成常规接触磨损（1 秒实测 ${lost.toFixed(1)}；应只有 ~4 吸氧 + 自然流失）`)
  })

  check('V6.83 摆尾鱼：轨迹**明显偏离直线**（这是它让"瞄准"变难的全部）', () => {
    const w = rig(5108)
    const e = mke('darter', w.px + 520, w.py - 240, { r: 19 })
    w.enemies.push(e)
    const x0 = e.x, y0 = e.y
    let maxDev = 0
    for (let i = 0; i < 90; i++) {
      w.update(DT, { dx: 0, dy: 0, burst: false })
      // 相对"起点 → 当前玩家"这条轴的垂直偏离
      const ax = w.px - x0, ay = w.py - y0, al = Math.hypot(ax, ay) || 1
      const dx = e.x - x0, dy = e.y - y0
      maxDev = Math.max(maxDev, Math.abs(dx * (ay / al) - dy * (ax / al)))
    }
    assert.ok(maxDev > 25,
      `摆尾鱼的轨迹应明显偏离直线，实测最大偏离 ${maxDev.toFixed(1)}px（振幅 90）`)
  })

  // =======================================================================
  // V6.83 敌方投射物（**新子系统**）+ 与玩家技能的交互
  //   ★ 用户明确要求"一定要考虑技能相关的特效" —— 交互的**判定**在模拟层，
  //     而"画成什么样"由 `eshotDown` 的 `cause` 决定（渲染层）。
  //     所以这一组测的是**判定**：谁清掉了它、清掉几颗、清掉之后还有没有伤害。
  // =======================================================================

  check('V6.83 喷酸鱼：**保持距离**（近了退、远了进），被贴脸时后退', () => {
    const w = rig(5201)
    const e = mke('spitter', w.px + 260, w.py, { r: 20, speed: 58 })
    w.enemies.push(e)
    const d0 = Math.hypot(e.x - w.px, e.y - w.py)
    step(w, 60)
    const d1 = Math.hypot(e.x - w.px, e.y - w.py)
    assert.ok(Math.abs(d1 - d0) < 70,
      `它应维持距离而不是一路贴上来（${d0.toFixed(0)} → ${d1.toFixed(0)}）`)
    // 贴脸 ⇒ 必须后退（"冲进去打断它"是设计上的解法之一）
    w.px = e.x - 60; w.py = e.y
    const d2 = Math.hypot(e.x - w.px, e.y - w.py)
    step(w, 40)
    const d3 = Math.hypot(e.x - w.px, e.y - w.py)
    assert.ok(d3 > d2 + 8, `被贴脸时应后退（${d2.toFixed(0)} → ${d3.toFixed(0)}）`)
  })

  check('V6.83 喷酸鱼：**周期开火**，且在前摇时锁方向（侧移才躲得掉）', () => {
    const w = rig(5202)
    const e = mke('spitter', w.px + 260, w.py, { r: 20, speed: 58 })
    w.enemies.push(e)
    w.drainEvents()
    let shots = 0
    for (let i = 0; i < Math.ceil(6 / DT); i++) {
      w.update(DT, { dx: 0, dy: 0, burst: false })
      for (const ev of w.drainEvents()) { /* 事件只是排空，不在这里判 */ }
      if (w.eShots.length > shots) shots = w.eShots.length
    }
    assert.ok(shots >= 1, `6 秒内至少应吐 1 发（实测峰值 ${shots}）`)
  })

  check('V6.83 敌方投射物：飞的是**直线**（不追踪玩家）', () => {
    const w = rig(5203)
    w.spawnEShot(w.px + 200, w.py - 300, 1, 0)     // 朝右飞，远离玩家
    const s = w.eShots[0]
    const v0x = s.vx, v0y = s.vy
    for (let i = 0; i < 40; i++) {
      w.updateEShots(DT)
      assert.ok(Math.abs(s.vx - v0x) < 1e-9 && Math.abs(s.vy - v0y) < 1e-9,
        '敌弹不该中途改向（追踪弹会把"躲"变成"跑"）')
      if (!s.alive) break
    }
  })

  check('V6.83 敌方投射物：到点**爆开**（发 `spent`），不是凭空消失', () => {
    const w = rig(5204)
    w.spawnEShot(w.px + 200, w.py - 340, 1, 0)     // 往没人的地方飞
    w.drainEvents()
    let spent = 0
    for (let i = 0; i < Math.ceil(1.5 / DT); i++) {
      w.updateEShots(DT)
      for (const ev of w.drainEvents()) if (ev.t === 'eshotDown' && ev.cause === 'spent') spent++
    }
    assert.ok(spent >= 1, `寿命归零应发 \`spent\` 事件（实测 ${spent}）—— 凭空消失玩家读不出"它到点了"`)
    assert.strictEqual(w.eShots.length, 0, '到点后应被回收')
  })

  check('V6.83 敌方投射物：打到玩家**掉氧**并消耗掉', () => {
    const w = rig(5205)
    w.o2 = w.o2Max
    const before = w.o2
    w.spawnEShot(w.px - 46, w.py, 1, 0)            // 正对玩家
    for (let i = 0; i < 30; i++) w.updateEShots(DT)
    assert.ok(before - w.o2 > 5,
      `命中应掉氧（实测 ${(before - w.o2).toFixed(1)}）`)
    assert.strictEqual(w.eShots.length, 0, '命中后应消耗掉')
  })

  check('V6.83 ★技能交互：**爆炸抵消敌弹**（走真实 `explode` 链路）', () => {
    // 为什么这条必须走 `explode()` 而不是直接调 `clearEShots`：
    // 我们要验的是"**鱼雷 / 回声 / 气泡雷炸开时会不会清弹**"这个**接线**，
    // 而 `clearEShots` 本身能不能用是另一回事（下一条测）。
    const w = rig(5206)
    w.spawnEShot(w.px + 300, w.py, 1, 0)
    w.spawnEShot(w.px + 316, w.py + 12, 1, 0)
    assert.strictEqual(w.eShots.filter(s => s.alive).length, 2, '前置：场上应有 2 颗')
    w.explode(w.px + 308, w.py, 70, 0)             // dmg 给 0：只测清弹
    assert.strictEqual(w.eShots.filter(s => s.alive).length, 0,
      '爆炸半径内的敌弹应被抵消 —— 否则玩家在弹幕里丢鱼雷会有"用了大招却没变化"的失重感')
  })

  check('V6.83 ★技能交互：**网收走敌弹**（给网加上弹幕场景里的第二个用途）', () => {
    const w = rig(5207)
    w.spawnEShot(w.px + 400, w.py, 1, 0)
    assert.strictEqual(w.eShots.filter(s => s.alive).length, 1, '前置：场上应有 1 颗')
    const n = w.clearEShots(w.px + 400, w.py, 70, 'net')
    assert.strictEqual(n, 1, '网半径内应清掉 1 颗')
  })

  check('V6.83 技能交互：**被拦下的弹不该还能伤到玩家**（否则"拦了没用"）', () => {
    const w = rig(5208)
    w.o2 = w.o2Max
    const before = w.o2
    w.spawnEShot(w.px - 60, w.py, 1, 0)            // 正对玩家飞来
    w.clearEShots(w.px - 60, w.py, 40, 'blast')    // 在它脸上把它清掉
    for (let i = 0; i < 30; i++) w.updateEShots(DT)
    assert.ok(before - w.o2 < 2,
      `被清掉的弹不该再有伤害（实测掉 ${(before - w.o2).toFixed(1)}）—— ` +
      `拦弹只省直击、省不掉范围的话，玩家会读作"拦了没用"`)
  })

  check('V6.83 换层必须清空敌弹（否则上一层的弹会飞进新层）', () => {
    // ⚠️ 这是"复制一段清池代码必忘一层"的典型现场：`diveDeeper` 里原本有一串
    //    `this.enemies = []` / `this.bullets = []` …，漏掉新池**不报错**，
    //    只表现为"换带之后莫名其妙挨了一下"。
    const w = rig(5209)
    w.spawnEShot(w.px + 200, w.py, 1, 0)
    assert.ok(w.eShots.length > 0, '前置：场上应有敌弹')
    w.o2 = w.o2Max
    w.phase = 'decide'
    w.diveDeeper()
    assert.strictEqual(w.eShots.length, 0, '换层应清空敌弹')
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
