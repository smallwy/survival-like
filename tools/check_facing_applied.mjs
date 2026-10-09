/**
 * 守卫检查：确认「朝向真的被应用到角色贴图上」。
 *
 * 背景：曾经 animatePlayer 里只写了 setFlipX 却漏掉 setTexture —— 朝向
 * (front/back/side) 算了一整轮、贴图却永远是正面图。表现就是"按 WASD 角色不转身"，
 * 而且肉眼很难分辨到底是逻辑没生效还是素材不够，只能反复猜。
 * 这里把该约束固化成可执行的断言，避免以后又悄悄丢掉这一行。
 *
 * 用法：node tools/check_facing_applied.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'web', 'src', 'scenes', 'GameScene.ts'), 'utf8')

// 截出 animatePlayer 的函数体
const start = src.indexOf('private animatePlayer')
if (start < 0) {
  console.error('FAIL  找不到 animatePlayer')
  process.exit(1)
}
const rest = src.slice(start)
const end = rest.indexOf('\n  private ', 10)
const fn = end > 0 ? rest.slice(0, end) : rest

let bad = 0
const checks = [
  ['setTexture', '按朝向切换贴图 —— 转身的核心动作'],
  ['setFlipX', '侧身朝左时的水平翻转'],
  ['curDir', '缓存当前朝向，避免每帧重复切图'],
  ['setScale', '走路起伏 / 后坐的压缩拉伸']
]
for (const [needle, why] of checks) {
  const ok = fn.includes(needle)
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  animatePlayer 含 ${needle.padEnd(11)} ${why}`)
}

// 三个朝向的贴图都必须在 preload 注册，否则 setTexture 会贴成"缺图绿框"
for (const dir of ['front', 'back', 'side']) {
  const n = (src.match(new RegExp(`charTex\\('[a-z]+', '${dir}'\\)`, 'g')) || []).length
  const ok = n >= 4
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  preload 已注册 ${dir.padEnd(5)} 贴图 x${n}（应为 4 个角色）`)
}

if (bad > 0) {
  console.error(`\n有 ${bad} 项未通过`)
  process.exit(1)
}
console.log('\n全部通过')
