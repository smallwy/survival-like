/**
 * 卡牌图标 —— 全程序化矢量图形
 *
 * 为什么用矢量而不是再做一套像素位图
 * ----------------------------------
 * 项目里已经有一个程序化像素生成器（tools/pixelgen.py），补一套 24x24 的
 * 武器/道具位图在技术上完全可行。但没有这么做，原因有三：
 *
 *  1. **风格必须和计谋图标一致**。备战页六个计谋已经用 Graphics 画成了矢量
 *     （drawStratGlyph：骨牌/U 磁铁/折线皮筋/陀螺/盒子/电池），玩家已经建立了
 *     "形状 = 效果"的认知。武器/道具如果换成像素位图，同一块面板上会出现
 *     两种图形语言，反而更像"拼出来的"。
 *  2. **零资源、零构建步骤**。不用跑生成器、不用进 manifest、不用给 Vite 加
 *     图片导入，改一个形状只是改几行代码。
 *  3. **任意缩放不糊**。界面本身会按窗口尺寸整体缩放（UI_MAX_ZOOM），矢量图形
 *     在这一层永远清晰；位图放大到 1.25 倍就要开始补像素。
 *
 * 坐标约定：所有路径都按 **±13 的设计尺寸**写，调用方给 k 缩放
 * （图标槽 48px 时传 k=1，图标槽 32px 时传 k≈0.7）。原点在图标中心。
 *
 * 配色约定：主形状一律用纸上的**墨色**（P.ink），强调色（accent）只用在
 * 一个点缀元素上 —— 图标要能在牛皮纸底色上"读"出来，纯用亮黄/塑料绿会发飘。
 */
import Phaser from 'phaser'
import { P } from './kit'

type G = Phaser.GameObjects.Graphics

// ---------------------------------------------------------------------------
// 武器图标：按 WeaponDef.id 分发
// ---------------------------------------------------------------------------

export function drawWeaponGlyph(g: G, id: string, accent: number, k = 1): void {
  const s = (v: number) => v * k
  const ink = P.ink
  const lw = Math.max(1, s(2.4))
  g.lineStyle(lw, ink, 1)
  g.fillStyle(ink, 1)

  switch (id) {
    // 声呐枪：Y 形发射器，一条声波
    case 'bow':
      g.lineStyle(lw, ink, 1)
      g.lineBetween(s(0), s(11), s(-9), s(-8))
      g.lineBetween(s(0), s(11), s(9), s(-8))
      g.lineStyle(Math.max(1, s(1.6)), accent, 1)
      g.lineBetween(s(-9), s(-8), s(9), s(-8))
      g.fillStyle(ink, 1).fillCircle(s(0), s(-1), s(3))
      break

    // 连发声呐：同款发射器，三道声波
    case 'crossbow':
      g.lineStyle(lw, ink, 1)
      g.lineBetween(s(0), s(12), s(-10), s(-9))
      g.lineBetween(s(0), s(12), s(10), s(-9))
      g.lineStyle(Math.max(1, s(1.6)), accent, 1)
      for (let i = 0; i < 3; i++) {
        const yy = s(-11 + i * 4)
        g.lineBetween(s(-8), yy, s(8), yy)
      }
      break

    // 图钉散弹：一枚大图钉 + 周围散开的钉头
    case 'caltrop':
      g.fillStyle(ink, 1).fillTriangle(s(0), s(-11), s(9), s(7), s(-9), s(7))
      g.fillStyle(accent, 1).fillCircle(s(0), s(-2), s(2.5))
      g.fillStyle(ink, 1)
      g.fillCircle(s(-11), s(-8), s(2))
      g.fillCircle(s(11), s(-8), s(2))
      g.fillCircle(s(0), s(11), s(2))
      break

    // 铅笔弩：一支削尖的铅笔
    case 'heavybow':
      g.fillStyle(ink, 1).fillRect(s(-4), s(-6), s(8), s(13))
      g.fillTriangle(s(-4), s(-6), s(4), s(-6), s(0), s(-13))
      g.fillStyle(accent, 1).fillRect(s(-4), s(-2), s(8), s(3))
      g.fillStyle(ink, 1).fillRect(s(-6), s(7), s(12), s(3))
      break

    // 长柄螺丝刀：竖杆 + 顶端十字刀头
    case 'spear':
      g.fillStyle(ink, 1).fillRect(s(-2), s(-4), s(4), s(16))
      g.fillRect(s(-7), s(-9), s(14), s(4))
      g.fillRect(s(-2), s(-13), s(4), s(11))
      g.fillStyle(accent, 1).fillRect(s(-7), s(6), s(14), s(3))
      break

    // 弹珠环绕：中心球 + 一圈轨道 + 轨道上的珠子
    case 'knives':
      g.lineStyle(Math.max(1, s(1.6)), ink, 1)
      g.strokeEllipse(s(0), s(0), s(24), s(13))
      g.fillStyle(ink, 1).fillCircle(s(0), s(0), s(4.5))
      g.fillStyle(accent, 1).fillCircle(s(11), s(0), s(3))
      g.fillStyle(ink, 1).fillCircle(s(-11), s(0), s(3))
      break

    // 探照灯束：灯圈 + 手柄 + 右侧射出的光柱
    case 'guandao':
      g.lineStyle(Math.max(1, s(2.6)), ink, 1)
      g.strokeCircle(s(-3), s(-3), s(6.5))
      g.lineBetween(s(2), s(2), s(10), s(10))
      g.lineStyle(Math.max(1, s(1.8)), accent, 1)
      g.lineBetween(s(6), s(-6), s(12), s(-6))
      g.lineBetween(s(6), s(-1), s(12), s(-1))
      g.lineBetween(s(6), s(4), s(12), s(4))
      break

    // 泡泡枪：三个渐小的泡泡
    default:
      g.lineStyle(Math.max(1, s(1.8)), ink, 1)
      g.strokeCircle(s(-4), s(4), s(6))
      g.strokeCircle(s(5), s(-2), s(4.5))
      g.lineStyle(Math.max(1, s(1.8)), accent, 1)
      g.strokeCircle(s(10), s(-9), s(3))
      break
  }
}

// ---------------------------------------------------------------------------
// 道具图标：按效果类别分发
// ---------------------------------------------------------------------------

/**
 * 道具 → 图标类别的映射。
 *
 * 为什么不按 id 逐个画（24 个道具）：玩家记的是"这件东西给我什么"，
 * 不是"这件东西叫什么"。按效果归类之后，24 件道具只用 11 个形状，
 * 而且**同类道具的图标天然长得像** —— 这正是我们要的：
 * 一眼看出"这几件都是加伤害的"，再读名字比大小。
 */
const ITEM_ICON: Record<string, string> = {
  // ---- 伤害 ----
  band: 'dmg', booster: 'dmg',
  // ---- 攻速 ----
  tape: 'cd', gearset: 'cd', doubletape: 'cd',
  // ---- 移速 ----
  bearing: 'speed', spring: 'speed', gyro: 'speed',
  // ---- 生命 ----
  armor: 'hp', titan: 'hp', ration: 'regen',
  vest: 'armor', weldred: 'armor',
  // ---- 暴击 ----
  scope: 'crit', luckycoin: 'crit',
  // ---- 拾取 ----
  magnetcore: 'magnet', airgun: 'magnet',
  // ---- 穿透 ----
  drill: 'pierce',
  // ---- 回复 / 吸血 ----
  fangs: 'regen', matchbox: 'regen',
  // ---- 材料 ----
  scrapbag: 'materials', recycler: 'materials',
  // ---- 反弹 ----
  spike: 'thorns',
  // ---- 综合 ----
  battery: 'dmg',
}

export function itemIconTag(id: string): string {
  return ITEM_ICON[id] ?? 'misc'
}

export function drawItemGlyph(g: G, tag: string, accent: number, k = 1): void {
  const s = (v: number) => v * k
  const ink = P.ink
  const lw = Math.max(1, s(2.2))
  g.lineStyle(lw, ink, 1)
  g.fillStyle(ink, 1)

  switch (tag) {
    // 伤害：粗上箭头
    case 'dmg':
      g.fillTriangle(s(0), s(-12), s(10), s(-2), s(-10), s(-2))
      g.fillRect(s(-4), s(-2), s(8), s(13))
      g.fillStyle(accent, 1).fillRect(s(-4), s(7), s(8), s(4))
      break

    // 攻速：齿轮（8 齿 + 中心孔）
    case 'cd': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const x = Math.cos(a)
        const y = Math.sin(a)
        g.fillRect(s(x * 9 - 2.2), s(y * 9 - 2.2), s(4.4), s(4.4))
      }
      g.fillCircle(s(0), s(0), s(7))
      g.fillStyle(accent, 1).fillCircle(s(0), s(0), s(2.8))
      break
    }

    // 移速：双右箭头
    case 'speed':
      g.fillTriangle(s(-12), s(-8), s(-4), s(0), s(-12), s(8))
      g.fillRect(s(-13), s(-3), s(5), s(6))
      g.fillTriangle(s(2), s(-8), s(10), s(0), s(2), s(8))
      g.fillStyle(accent, 1).fillRect(s(1), s(-3), s(5), s(6))
      break

    // 生命：心形（两圆 + 三角）
    case 'hp':
      g.fillCircle(s(-5), s(-3), s(6))
      g.fillCircle(s(5), s(-3), s(6))
      g.fillTriangle(s(-10.7), s(0), s(10.7), s(0), s(0), s(12))
      g.fillStyle(accent, 1).fillCircle(s(-5), s(-5), s(2.2))
      break

    // 护甲：盾牌
    case 'armor':
      g.fillPoints([
        { x: s(-10), y: s(-10) }, { x: s(10), y: s(-10) },
        { x: s(10), y: s(2) }, { x: s(0), y: s(12) }, { x: s(-10), y: s(2) }
      ] as Phaser.Types.Math.Vector2Like[], true)
      g.fillStyle(accent, 1).fillRect(s(-2), s(-8), s(4), s(12))
      break

    // 暴击：五角星
    case 'crit': {
      const pts: Phaser.Types.Math.Vector2Like[] = []
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 12 : 5
        pts.push({ x: s(Math.cos(a) * r), y: s(Math.sin(a) * r) })
      }
      g.fillPoints(pts, true)
      g.fillStyle(accent, 1).fillCircle(s(0), s(-1), s(2.6))
      break
    }

    // 拾取：U 形磁铁
    case 'magnet':
      g.fillRect(s(-11), s(-11), s(7), s(18))
      g.fillRect(s(4), s(-11), s(7), s(18))
      g.fillRect(s(-11), s(5), s(22), s(7))
      g.fillStyle(accent, 1)
      g.fillRect(s(-11), s(-11), s(7), s(5))
      g.fillRect(s(4), s(-11), s(7), s(5))
      break

    // 穿透：钻头
    case 'pierce':
      g.fillTriangle(s(0), s(13), s(8), s(-4), s(-8), s(-4))
      g.fillRect(s(-8), s(-12), s(16), s(5))
      g.fillStyle(accent, 1).fillRect(s(-6), s(-3), s(12), s(3))
      break

    // 回复：十字
    case 'regen':
      g.fillRect(s(-3.5), s(-11), s(7), s(22))
      g.fillRect(s(-11), s(-3.5), s(22), s(7))
      g.fillStyle(accent, 1).fillRect(s(-3.5), s(-11), s(7), s(6))
      break

    // 材料：扎口布袋
    case 'materials':
      g.fillRoundedRect(s(-11), s(-6), s(22), s(18), s(5))
      g.fillTriangle(s(-5), s(-6), s(5), s(-6), s(0), s(-13))
      g.fillStyle(accent, 1).fillRect(s(-3), s(-14), s(6), s(4))
      break

    // 反弹：尖刺
    case 'thorns':
      for (let i = 0; i < 5; i++) {
        const x = s(-10 + i * 5)
        g.fillTriangle(x, s(-4), x + s(2.5), s(-12), x + s(5), s(-4))
      }
      g.fillRect(s(-11), s(-4), s(22), s(6))
      g.fillStyle(accent, 1).fillRect(s(-11), s(4), s(22), s(4))
      break

    // 兜底：问号块
    default:
      g.fillRoundedRect(s(-10), s(-10), s(20), s(20), s(5))
      g.fillStyle(accent, 1).fillRect(s(-4), s(-4), s(8), s(8))
      break
  }
}
