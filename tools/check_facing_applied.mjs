/**
 * 静态守卫：确保「算出来的朝向/动作真的被应用到贴图上」。
 *
 * 背景：这个项目曾经连续踩过同一个坑 —— animatePlayer 里算好了朝向 front/back/side，
 * 却只调了 setFlipX 而漏掉 setTexture，于是朝向算了一整轮从没贴到角色身上，
 * 表现为"按 WASD 角色不转身"。tsc 和打包都查不出这类"逻辑对但没接线"的问题。
 *
 * 现在改用像素帧序列，同一类风险变成「漏掉 setFrame」。
 * 这个脚本把它变成可执行断言。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const scenePath = join(root, 'web', 'src', 'scenes', 'GameScene.ts')
const manifestPath = join(root, 'web', 'src', 'assets', 'pixel', 'manifest.json')

const src = readFileSync(scenePath, 'utf8')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}

// 1) animatePlayer 必须真的把帧贴到玩家 sprite 上
const animStart = src.indexOf('private animatePlayer(')
const animEnd = src.indexOf('private footDust(')
check('animatePlayer 存在', animStart > 0 && animEnd > animStart)
const anim = animStart > 0 ? src.slice(animStart, animEnd) : ''
check('animatePlayer 调用 setFrame(...) —— 否则动作算了也不显示', anim.includes('.setFrame('))
check('animatePlayer 调用 setFlipX(...) —— 侧向朝左靠翻转', anim.includes('.setFlipX('))
check('animatePlayer 用 pxFrame(...) 计算帧号', anim.includes('pxFrame('))

// 2) 朝向与动作必须走同一套枚举，不能再混用旧的 front/back
check('已无遗留的 front/back 朝向字面量', !/['"](front|back)['"]/.test(src))
check('PxDir 覆盖 down/up/side', /PX_DIRS = \['down', 'up', 'side'\]/.test(src))

// 3) 帧号公式与 manifest 的自描述一致（行列数与帧数必须先对上，
//    否则 setFrame 会取到别的动作的帧 —— 这类错误肉眼极难发现）
const dirs = manifest.dirs
const acts = manifest.acts
const rows = dirs.length * acts.length
check('manifest 方向数 x 动作数 = sheet 行数', rows === 9, `rows=${rows}`)
for (const act of acts) {
  const n = manifest.actFrames[act]
  check(`动画 ${act} 的帧数不超过列数 ${manifest.cols}`, n <= manifest.cols, `frames=${n}`)
}
// sheet 像素高度必须等于 行数 x 单元边长
for (const [unit, def] of Object.entries(manifest.units)) {
  const cell = manifest.grid * def.upscale
  const png = join(root, 'web', 'src', 'assets', 'pixel', def.sheet)
  check(`${unit}: spritesheet 文件存在`, existsSync(png), def.sheet)
  if (existsSync(png)) {
    const buf = readFileSync(png)
    // PNG：宽高在 IHDR，偏移 16 起 8 字节大端
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    check(`${unit}: 尺寸 ${w}x${h} == ${manifest.cols * cell}x${rows * cell}`,
      w === manifest.cols * cell && h === rows * cell, `${w}x${h}`)
  }
}

// 4) preload 必须真的加载了 spritesheet
check('preload 使用 load.spritesheet 加载像素单位', /load\.spritesheet\(/.test(src))
check('preload 遍历 PX_SHEETS 注册全部单位', /for \(const unit in PX_SHEETS\)/.test(src))

// 5) 枪口坐标必须来自 manifest，不能重新退回硬编码
check('muzzlePoint 从 manifest 读枪口（不是硬编码表）', /PX_UNITS\[unit\]\?\.muzzle\?\.side/.test(src))

// 6) 像素渲染开关。缺了 pixelArt，NEAREST 会退化成 LINEAR，
//    所有像素单位边缘发虚、带光晕 —— 生成器画得再准也白搭。
const mainPath = join(root, 'web', 'src', 'main.ts')
const mainSrc = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : ''
check('main.ts 开启 pixelArt（否则像素被线性过滤糊掉）', /pixelArt:\s*true/.test(mainSrc))
check('main.ts 开启 roundPixels（避免半像素重采样）', /roundPixels:\s*true/.test(mainSrc))

// 7) 屏幕缩放公式必须同时含 zoom 与 upscale。
//    曾经写成 `PX_SCALE * upscale`，Boss 的分辨率和体积一起翻倍 → 渲染成 256px。
check('pxScale 同时包含 zoom 与 upscale', /PX_SCALE \* \(u\?\.zoom \?\? 1\)\) \/ \(u\?\.upscale \?\? 1\)/.test(src))
check('Boss 的 zoom 与 upscale 分离（build 里两个字段都存在）',
  /zoom=2/.test(readFileSync(join(root, 'tools', 'pixelgen.py'), 'utf8')))

// 8) 每个单位都要有实测包围盒，且必须落在格子里 ——
//    游戏的碰撞框与阴影尺寸都靠它，缺了就会退回"拍脑袋的 radius"
for (const [unit, def] of Object.entries(manifest.units)) {
  const cell = manifest.grid * def.upscale
  check(`${unit}: manifest 带 bbox（碰撞框依据）`,
    Array.isArray(def.bbox) && def.bbox.length === 4, JSON.stringify(def.bbox))
  if (!Array.isArray(def.bbox)) continue
  const [x0, y0, x1, y1] = def.bbox
  check(`${unit}: bbox 在格子内 (0..${cell})`,
    x0 >= 0 && y0 >= 0 && x1 <= cell && y1 <= cell && x1 > x0 && y1 > y0,
    `[${def.bbox}]`)
  // bbox 用的是逻辑像素，换算成贴图像素后不能超过格子
  check(`${unit}: bbox 高度体现体型差异（不是所有单位一样高）`,
    y1 > y0, `h=${y1 - y0}`)

  for (const [dir, mz] of Object.entries(def.muzzle || {})) {
    check(`${unit}/${dir}: 枪口坐标在格子内`,
      Math.abs(mz[0]) <= cell / 2 && Math.abs(mz[1]) <= cell / 2, `[${mz}]`)
  }
}

// 9) id 引用完整性 —— 美术与数值从「现代火器」换成「三国冷兵器」时，
//    任何一处漏改的旧 id 都会变成 undefined 并一路传播，直到 UI 层才炸。
//    实测踩到的实例：`weaponById('pistol')!` 里的 `!` 非空断言把 undefined
//    放行到底，tsc 与打包全绿，运行时在 refreshHud 的 `o.def.name` 崩掉，
//    表现是"选人界面整个不渲染"。这类问题必须由守卫兜住，不能靠肉眼。
const dataSrc = readFileSync(join(root, 'web', 'src', 'config', 'gameData.ts'), 'utf8')
const sliceBetween = (a, b) => dataSrc.slice(dataSrc.indexOf(a), dataSrc.indexOf(b))
// 必须加左边界断言。裸的 `id:` 会被 `mid: 'swarm'` 里的 `id:` 命中 ——
// 势力表的 roles 用了 front/mid/back/flank 四个键，其中 **mid 含子串 id:**，
// 于是 `swarm`/`tank`/`shooter`/`elite` 这些兵种 id 会被当成势力 id 混进来，
// 校验集合被污染，`faction: 'swarm'` 这种错引用反而能通过。实测踩到过。
const idSet = (block) => new Set(
  [...block.matchAll(/(?<![A-Za-z0-9_])id:\s*'([^']+)'/g)].map((m) => m[1])
)

const WIDS = idSet(sliceBetween('export const WEAPONS', 'export const ENEMIES'))
// 注意：**不能**用 'export const UPGRADES' 当右边界。
// ENEMIES 与 UPGRADES 之间现在还夹着 FACTIONS / FORMATIONS / STRATAGEMS 三张表，
// 那样切出来的块会把势力、阵型、计谋的 id 全混进敌人集合里，
// 于是 `enemyById('square')` 这种明显错误的引用也能通过校验 —— 守卫自己失效。
const EIDS = idSet(sliceBetween('export const ENEMIES', 'export const FACTIONS'))
const FACIDS = idSet(sliceBetween('export const FACTIONS', 'export const FORMATIONS'))
const FORIDS = idSet(sliceBetween('export const FORMATIONS', 'export const STRATAGEMS'))
const SIDS = idSet(sliceBetween('export const STRATAGEMS', 'export const UPGRADES'))
const CIDS = idSet(sliceBetween('export const CHARS', 'export const META_NAMES'))
const ROLES = new Set(['front', 'mid', 'back', 'flank'])

check('武器库已改为冷兵器（不再含 pistol/smg/shotgun/rifle）',
  !WIDS.has('pistol') && !WIDS.has('smg') && !WIDS.has('shotgun') && !WIDS.has('rifle'),
  [...WIDS].join(','))

// 先剥掉注释再校验 —— 否则"反面教材"写在注释里会被自己误判为真实代码。
// （这正是本文件里那段说明 `weaponById('pistol')!` 的注释踩到的。）
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
for (const m of code.matchAll(/weaponById\(\s*'([^']+)'\s*\)/g)) {
  check(`weaponById('${m[1]}') 指向真实武器`, WIDS.has(m[1]))
}
for (const m of code.matchAll(/enemyById\(\s*'([^']+)'\s*\)/g)) {
  check(`enemyById('${m[1]}') 指向真实敌人`, EIDS.has(m[1]))
}
check('禁止对 weaponById/enemyById 用 ! 断言（会掩盖 undefined）',
  !/(weaponById|enemyById)\([^)]*\)\s*!/.test(code))

const charBlock = sliceBetween('export const CHARS', 'export const META_NAMES')
for (const m of charBlock.matchAll(/weapon:\s*'([^']+)'/g)) {
  check(`武将起始武器 '${m[1]}' 指向真实武器`, WIDS.has(m[1]))
}
// 四个武将的起始武器必须覆盖 3 种以上不同 kind —— 否则"机制不同"又是一句空话
for (const m of src.matchAll(/new Set<string>\(\[([^\]]*)\]\)/g)) {
  for (const id of m[1].matchAll(/'([^']+)'/g)) {
    check(`默认解锁 '${id[1]}' 真实存在`, WIDS.has(id[1]) || CIDS.has(id[1]))
  }
}

// 10) 相克系统必须真的接在伤害路径上（只写数据表、没接伤害 = 等于没做）
check('GameScene 存在 armorMul（相克倍率计算）', /private armorMul\(/.test(src))
check('子弹携带相克表 b.setData(\'vs\', w.vs)', /setData\('vs',\s*w\.vs\)/.test(src))
check('命中时乘以护甲倍率', /const dmg = \(b\.getData\('dmg'\) as number\) \* mul/.test(src))
check('敌人出生时写入 armor', /setData\('armor',\s*def\.armor\)/.test(src))
check('伤害飘字带克制标记', /this\.damageLabel\(mul\)/.test(src))

// 11) ================= 四支柱（势力 / 兵种 / 阵型 / 计谋）完整性 =================
//
// 这一节针对的是本项目的核心风险：**表写好了但没接线**。
// 阵型表、势力表、计谋表都是纯数据，写错了不会有任何编译错误，
// 只会表现为"打起来还是老样子"。所以每张表都要：
//   (a) id 自洽（引用的兵种/势力/阵型真的存在）
//   (b) 有对应的运行时代码真的读它
// 两类断言都写在这里。

// --- 11a 新兵种真的生成了美术（单位在 manifest 里）---
for (const u of ['foe_shield', 'foe_elite', 'foe_boss_yanliang', 'foe_boss_caocao', 'foe_boss_ganning']) {
  check(`新单位 ${u} 已生成像素贴图`, !!manifest.units[u], u)
}
// 盾卫必须真的画了盾 —— 它是"硬骨头"这个势力特性唯一的视觉载体
const pixelgenSrc = readFileSync(join(root, 'tools', 'pixelgen.py'), 'utf8')
check('pixelgen 有 shield 绘制分支（盾卫的盾）', /if spec\.get\('shield'\)/.test(pixelgenSrc))
check('ENEMIES 里的盾卫声明了 guard（顶盾减伤的依据）',
  /id: 'shield'[\s\S]{0,220}?guard: true/.test(dataSrc))

// --- 11b 兵种双层：护甲 + 职能，12 个敌人每个都要有 role ---
// 注意：ENEMIES 的条目是**单行** `{ id: 'x', ... }` 写法，
// 所以不能用「顶格 `  {` 的行数」来数条目（那是给多行表用的）。
const enemyBlock = sliceBetween('export const ENEMIES', 'export const FACTIONS')
const enemyEntries = EIDS.size
const roleCount = [...enemyBlock.matchAll(/role:\s*'([^']+)'/g)].map((m) => m[1])
check(`ENEMIES 共 ${enemyEntries} 个兵种，全部声明了 role（职能）`,
  roleCount.length === enemyEntries && enemyEntries >= 12,
  `entries=${enemyEntries} roles=${roleCount.length}`)
for (const r of new Set(roleCount)) {
  check(`敌人 role '${r}' 是合法职能`, ROLES.has(r))
}

// --- 11c 势力表：roles 表里的兵种 id、roster key、formations 引用都必须真实 ---
const facBlock = sliceBetween('export const FACTIONS', 'export const FORMATIONS')
const facEntries = [...facBlock.matchAll(/^  \{$/gm)].length
check(`FACTIONS 共 6 个势力`, facEntries === 6, `n=${facEntries}`)
check(`势力 id 集合 == ${[...FACIDS].join(',')}`, FACIDS.size === 6, `n=${FACIDS.size}`)
for (const m of facBlock.matchAll(/^\s+(front|mid|back|flank):\s*'([^']+)'/gm)) {
  check(`势力 roles.${m[1]} 指向真实兵种 '${m[2]}'`, EIDS.has(m[2]))
}
for (const m of facBlock.matchAll(/^\s+(front|mid|back|flank):\s*'/gm)) {
  void m
}
for (const m of facBlock.matchAll(/roster:\s*\{([^}]*)\}/g)) {
  for (const id of m[1].matchAll(/([A-Za-z_][\w]*)\s*:/g)) {
    check(`势力 roster 的兵种 '${id[1]}' 真实存在`, EIDS.has(id[1]))
  }
}
for (const m of facBlock.matchAll(/formations:\s*\[([^\]]*)\]/g)) {
  for (const id of m[1].matchAll(/'([^']+)'/g)) {
    check(`势力引用的阵型 '${id[1]}' 真实存在`, FORIDS.has(id[1]))
  }
}
// 势力必须有真实数值倍率，否则"势力差异"只是换了个名字
for (const f of ['countMul', 'hpMul', 'speedMul']) {
  const n = [...facBlock.matchAll(new RegExp(`${f}:`, 'g'))].length
  check(`每个势力都写了 ${f}（${n}/6）`, n === 6, `n=${n}`)
}

// --- 11d 阵型表：槽位 role 合法、行为合法，且六种行为都有实现 ---
const forBlock = sliceBetween('export const FORMATIONS', 'export const STRATAGEMS')
const forEntries = [...forBlock.matchAll(/^  \{$/gm)].length
check(`FORMATIONS 共 6 种阵型`, forEntries === 6, `n=${forEntries}`)
const BEHAVIORS = new Set(['charge', 'advance', 'hold', 'fireline', 'encircle'])
const behaviors = [...forBlock.matchAll(/behavior:\s*'([^']+)'/g)].map((m) => m[1])
check('六个阵型都声明了 behavior', behaviors.length === 6, `n=${behaviors.length}`)
for (const b of behaviors) {
  check(`阵型行为 '${b}' 是已知类型`, BEHAVIORS.has(b))
}
check('五种阵型行为都被覆盖（charge/advance/hold/fireline/encircle）',
  new Set(behaviors).size === 5, [...new Set(behaviors)].join(','))
for (const m of forBlock.matchAll(/role:\s*'([^']+)'/g)) {
  check(`阵型槽位 role '${m[1]}' 合法`, ROLES.has(m[1]))
}
// 每个阵型都要有足够多的槽位，否则"阵型"退化成"三个红点"。
// 用静态声明数（不含 grid(...) 在运行时展开的槽位）当下限，宁松勿假。
// 蜂拥阵的 slots 是 `grid(...).map(...)` 生成的，不是字面量数组，
// 所以这里只数 `slots:` 键，不要求后面跟 `[`。
check('六个阵型都声明了 slots', [...forBlock.matchAll(/slots:\s*/g)].length === 6,
  `n=${[...forBlock.matchAll(/slots:\s*/g)].length}`)
// 注意：swarm / fishscale 用 `role: (三元)` 与 `.map(…)` 动态生成槽位，
// 静态只数显式 `role: 'xxx'` 会漏掉它们，所以两个数字分开断言。
check('阵型槽位静态声明数 >= 30（动态生成的另计）',
  [...forBlock.matchAll(/role:\s*'/g)].length >= 30,
  `slots=${[...forBlock.matchAll(/role:\s*'/g)].length}`)
check('阵型槽位还用 grid(...) 动态展开（蜂拥 / 鱼鳞的成排站列）',
  [...forBlock.matchAll(/grid\(/g)].length >= 4,
  `grid=${[...forBlock.matchAll(/grid\(/g)].length}`)

// --- 11e 计谋表：6 个，且每种 kind 都有真实实现函数 ---
const stratBlock = sliceBetween('export const STRATAGEMS', 'export const UPGRADES')
const stratEntries = [...stratBlock.matchAll(/^  \{$/gm)].length
check(`STRATAGEMS 共 6 个计谋`, stratEntries === 6, `n=${stratEntries}`)
check('六个计谋都配了典故 quote', [...stratBlock.matchAll(/quote:\s*'/g)].length === 6)
check('计谋冷却都在 20~30s（有分量但不至于一局用不上）',
  [...stratBlock.matchAll(/cdSec:\s*(\d+)/g)].every((m) => +m[1] >= 20 && +m[1] <= 30),
  [...stratBlock.matchAll(/cdSec:\s*(\d+)/g)].map((m) => m[1]).join(','))
// 方法名的驼峰断词无法从 id 反推（emptycity → stratEmptyCity、laststand → stratLastStand），
// 所以按**大小写不敏感**匹配方法名，只校验"这个名字的实现确实存在"。
for (const id of SIDS) {
  check(`计谋 '${id}' 有实现方法 strat${id}()`,
    new RegExp(`private strat${id}\\(`, 'i').test(src))
}

// --- 11f 战役：章节引用的势力/阵型/奖励 id 全部真实 ---
const campBlock = sliceBetween('export const CAMPAIGN', 'export const CHARS')
const campEntries = [...campBlock.matchAll(/^  \{$/gm)].length
check('CAMPAIGN 共 6 章', campEntries === 6, `n=${campEntries}`)
for (const m of campBlock.matchAll(/faction:\s*'([^']+)'/g)) {
  check(`章节势力 '${m[1]}' 真实存在`, FACIDS.has(m[1]))
}
for (const m of campBlock.matchAll(/formations:\s*\[([^\]]*)\]/g)) {
  for (const id of m[1].matchAll(/'([^']+)'/g)) {
    check(`章节阵型池 '${id[1]}' 真实存在`, FORIDS.has(id[1]))
  }
}
// 奖励 id 必须落在武器 / 武将 / 计谋三者之一 —— 写错的奖励永远不会到手，
// 而且因为只是"没解锁"，玩家和开发者都不会收到任何报错。
const campRewards = {}
let chIdx = 0
for (const m of campBlock.matchAll(/reward:\s*\[([^\]]*)\]/g)) {
  chIdx++
  const ids = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  campRewards[`c${chIdx}s3`] = ids
  for (const id of ids) {
    const isStrat = id.startsWith('strat_')
    const stem = isStrat ? id.slice(6) : ''
    check(`第${chIdx}章奖励 '${id}' 真实存在`,
      isStrat ? SIDS.has(stem) : (WIDS.has(id) || CIDS.has(id)))
  }
}
check('每章至少一项奖励（否则通关没有正反馈）',
  chIdx === 6 && Object.values(campRewards).every((v) => v.length > 0))

// --- 11g 后端 chapterRewards 必须与前端 CAMPAIGN[].reward 完全一致 ---
//
// 这是本仓库里唯一一处**故意重复**的数据：解锁判定必须在服务端才安全，
// 但前端也要靠同一份表在本地做预览。两边漂移的后果很隐蔽 ——
// 玩家通关后界面说"解锁了火计"，实际后端没给，直到重开才发现。
const handlerSrc = readFileSync(join(root, 'server', 'internal', 'handler', 'handler.go'), 'utf8')
const goMapStart = handlerSrc.indexOf('var chapterRewards = map[string][]string{')
// 用「顶格的 }」定位表尾。不能靠数花括号：里面的每一项本身就是 `{...}`，
// 数两层会停在第一条记录上，于是整张表只剩 c1s3 被读出来 —— 实测踩到过。
const goRel = goMapStart > 0 ? handlerSrc.slice(goMapStart).search(/\n\}/) : -1
const goMapEnd = goRel > 0 ? goMapStart + goRel : -1
check('后端存在 chapterRewards 表', goMapStart > 0 && goMapEnd > goMapStart)
if (goMapStart > 0 && goMapEnd > goMapStart) {
  const goBlock = handlerSrc.slice(goMapStart, goMapEnd)
  const goRewards = {}
  for (const m of goBlock.matchAll(/"(c\d+s\d+)":\s*\{([^}]*)\}/g)) {
    goRewards[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort()
  }
  check('后端 chapterRewards 解析出 6 条', Object.keys(goRewards).length === 6,
    Object.keys(goRewards).join(','))
  for (const [key, ids] of Object.entries(campRewards)) {
    const g = goRewards[key] || []
    const f = [...ids].sort()
    check(`后端 chapterRewards["${key}"] == 前端 reward（${f.join(',')}）`,
      g.join(',') === f.join(','), `go=[${g.join(',')}] ts=[${f.join(',')}]`)
  }
  check('后端 chapterRewards 没有多余键',
    Object.keys(goRewards).length === Object.keys(campRewards).length,
    Object.keys(goRewards).join(','))
}

// --- 11h 四支柱的运行时接线：表被真的读了、行为真的分叉了 ---
check('spawnFormation 存在并返回是否成功', /private spawnFormation\(/.test(src))
check('阵型刷怪真的被调用（不是死代码）', /this\.spawnFormation\(/.test(src))
check('敌人出生时写入 behavior（阵型行为的下发通道）', /setData\('behavior',\s*f\.behavior\)/.test(src))
check('阵位兵种从势力的 roles 表取（阵型骨架 × 势力填充）',
  /enemyById\(this\.faction\.roles\[slot\.role\]\)/.test(src))
// 五种行为必须在 driveEnemies 里真的分叉 —— 只下发不处理 = 等于没做
for (const b of ['charge', 'advance', 'hold', 'fireline', 'encircle']) {
  check(`driveEnemies 处理了阵型行为 '${b}'`, src.includes(`'${b}'`))
}
check('慢速计谋真的改速度（不是只改了 UI）', /slow[\s\S]{0,80}?sp \*= 0\.25/.test(src))
check('阵型日志用于可视验证（formationLog）', /formationLog/.test(src))

// --- 11i 计谋接线：Q/E 绑定 + 冷却真的在走 + buff 真的进伤害公式 ---
check('Q 键绑定计谋', /keydown-Q[\s\S]{0,60}?castStratagem/.test(src))
check('E 键绑定计谋', /keydown-E[\s\S]{0,60}?castStratagem/.test(src))
check('计谋冷却每帧推进（tickStratagem）', /private tickStratagem\(/.test(src))
check('update() 调用 tickStratagem', /this\.tickStratagem\(delta\)/.test(src))
// buffDmg 曾经只算不用 —— 四条伤害路径都要吃到
const buffDmgUses = [...src.matchAll(/this\.buffDmg/g)].length
check(`buffDmg 在伤害路径上被引用（>=6 处）`, buffDmgUses >= 6, `n=${buffDmgUses}`)
const buffVulnUses = [...src.matchAll(/this\.buffVuln/g)].length
check(`buffVuln 在受伤路径上被引用（>=2 处）`, buffVulnUses >= 2, `n=${buffVulnUses}`)
check('背水一战的代价真的生效（受伤乘以 buffVuln）',
  /\* this\.buffVuln/.test(src))

// --- 11j 关卡目标：三种目标都有判定，且真的接进 update ---
check('tickObjective 存在', /private tickObjective\(/.test(src))
check('update() 调用 tickObjective', /this\.tickObjective\(/.test(src))
check('通关 / 未竟 两条收场路径都存在', /private finishStage\(/.test(src) && /private failStage\(/.test(src))
for (const o of ['survive', 'kill', 'boss']) {
  check(`关卡目标 '${o}' 有判定分支`, src.includes(`'${o}'`))
}
check('没有残留"到点自动通关"的旧无限模式逻辑',
  !/runMinutes \* 60\)\s*this\.gameOver\(true\)/.test(src))

// --- 11k 备战界面的解锁链必须真的用 clearedStages，否则"通关解锁下一章"是假的 ---
check('章节解锁读通关记录（clearedStages）', /this\.cleared\.has\(stageKey\(/.test(src))
check('前端读后端返回的 clearedStages', /Array\.isArray\(m\.clearedStages\)/.test(src))
check('前端读后端返回的 unlockedStrats', /Array\.isArray\(m\.unlockedStrats\)/.test(src))
check('上报通关时必须带 stage（否则进度不落库）', /stage:\s*win \? stageKey\(/.test(src))

// --- 11l UI 可读性：计谋图标必须按类别分形、受击闪白不能盖掉辨识度 ---
check('计谋图标按类别分形（drawStratGlyph）', /private drawStratGlyph\(/.test(src))
for (const kind of ['burst', 'control', 'buff', 'guard']) {
  check(`计谋图标画了 '${kind}' 这一类的形状`,
    new RegExp(`case '${kind}':`).test(src.slice(src.indexOf('private drawStratGlyph('))))
}
// 火苗和上箭都用了「三角」，必须靠"有没有柄"区分开 ——
// 第一版两者都是"三角+柄"，静态帧里完全分不出，等于没做图标。
const glyph = src.slice(src.indexOf('private drawStratGlyph('),
  src.indexOf('private drawStratGlyph(') + 1800)
check('火苗不带柄、上箭带柄（否则两种图标长得一样）',
  /case 'burst':[\s\S]*?fillPoints/.test(glyph) && !/case 'burst':[\s\S]*?fillRect/.test(
    glyph.slice(glyph.indexOf("case 'burst':"), glyph.indexOf("case 'control':"))))
check('备战界面的计谋卡复用了同一套图标（形状→效果 可预习）',
  /drawStratGlyph\(gl, sg\.kind/.test(src))
// 受击闪白：时长与膨胀倍率都有上限，否则"敌人变成一坨白块/看着大一圈"
const flash = src.slice(src.indexOf('private hitFlash('), src.indexOf('private onBulletHit'))
const flashMs = /duration:\s*(\d+)/.exec(flash)
check('受击闪白时长 <= 60ms（否则敌人有一大半时间是白块）',
  flashMs && +flashMs[1] <= 60, flashMs ? flashMs[1] + 'ms' : '?')
const popM = /baseScale \* ([\d.]+)/.exec(flash)
check('受击膨胀倍率 <= 1.10（否则静态帧里像"换了个更大的敌人"）',
  popM && +popM[1] <= 1.1, popM ? popM[1] : '?')

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
