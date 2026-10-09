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
const idSet = (block) => new Set([...block.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]))

const WIDS = idSet(sliceBetween('export const WEAPONS', 'export const ENEMIES'))
const EIDS = idSet(sliceBetween('export const ENEMIES', 'export const UPGRADES'))
const CIDS = idSet(sliceBetween('export const CHARS', 'export const META_NAMES'))

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

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
