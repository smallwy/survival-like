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

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
