/**
 * 三国 · 逐鹿 —— 视觉设计系统
 *
 * 为什么要有这个文件
 * ----------------
 * 旧版 UI 是「满屏科技青 #4ecdc4 + 直角矩形 + 纯白文字」。
 * 那套语言读起来是**赛博/科幻**，放在三国题材上是错位的；而且青绿被同时用作
 * 边框、高亮、强调、进度条 —— 没有层级，什么都强调 = 什么都不强调。
 *
 * 这里把「色 / 形 / 字 / 层级」一次性定死，全 UI 复用：
 *
 *  色：墨（深底）· 鎏金（描边/标题/选中）· 朱红（危险/印章/主行动）
 *       · 青玉（次要强调，克制使用）· 米白（正文，比纯白更"旧"）
 *  形：双线框 + 四角回纹角标；圆角很小（2~6px），保持"木牌/竹简"的硬朗感
 *  字：同一个字体栈；标题用字距拉开的米白/鎏金，正文用米白，注释用暗米
 *  层级：底(ink0) < 面板(ink1) < 抬起(ink2) < 卡片(ink3) < 描边(line)
 *
 * 注意：颜色分**两套**——图形用 `UI.*`（number），文字用 `TXT.*`（'#rrggbb' 串）。
 * 混用会得到"黑字黑底"，这是 Phaser 里最常见的一类隐形 bug。
 */
import Phaser from 'phaser'

// ---------------- 图形色（number） ----------------
export const UI = {
  ink0: 0x08060c,   // 全屏压暗底
  ink1: 0x120e17,   // 面板底
  ink2: 0x1b1524,   // 抬起面（章节条等）
  ink3: 0x261e31,   // 卡片底
  line: 0x3a3046,   // 弱分隔线
  gold: 0xc9a227,   // 鎏金主色
  goldHi: 0xefd489, // 金高光
  goldDim: 0x6a5722,// 金暗（外描边）
  red: 0xb83b2e,    // 朱红
  redHi: 0xe0543c,
  jade: 0x3fbfa8,   // 青玉（次强调）
  jadeHi: 0x7fe0cd,
} as const

// ---------------- 文字色（'#rrggbb'） ----------------
export const TXT = {
  main: '#efe6d2',
  dim: '#a99a80',
  mute: '#7a6f5e',
  gold: '#e8c96a',
  goldHi: '#f3dd9a',
  red: '#e0543c',
  jade: '#7fe0cd',
} as const

export const FONT = "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"

// ---------------- 形状 helper ----------------

export interface PanelOpts {
  fill?: number
  fillAlpha?: number
  /** 强调色：内描边 + 四角角标。默认鎏金。 */
  accent?: number
  /** 角标臂长（px）。传 0 可关掉角标。 */
  corner?: number
}

/**
 * 三国式面板：墨底 + 外侧金暗线 + 内侧强调线 + 四角回纹角标。
 * 坐标按**左上角**给（x, y = 左上），与 Phaser 的 rectangle(center) 不同，
 * 调用处要注意。
 */
export function panel(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  opts: PanelOpts = {}
): Phaser.GameObjects.Graphics {
  const fill = opts.fill ?? UI.ink1
  const alpha = opts.fillAlpha ?? 0.97
  const accent = opts.accent ?? UI.gold
  const L = opts.corner ?? 16
  const T = 3
  const g = scene.add.graphics()
  g.fillStyle(fill, alpha).fillRoundedRect(x, y, w, h, 6)
  g.lineStyle(1, UI.goldDim, 0.9).strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, 6)
  g.lineStyle(1, accent, 0.5).strokeRoundedRect(x + 3.5, y + 3.5, w - 7, h - 7, 4)
  if (L > 0) {
    g.fillStyle(accent, 0.95)
    const ix = x + 3, iy = y + 3
    const rx = x + w - 3, ry = y + h - 3
    g.fillRect(ix, iy, L, T); g.fillRect(ix, iy, T, L)                    // 左上
    g.fillRect(rx - L, iy, L, T); g.fillRect(rx - T, iy, T, L)             // 右上
    g.fillRect(ix, ry - T, L, T); g.fillRect(ix, ry - L, T, L)             // 左下
    g.fillRect(rx - L, ry - T, L, T); g.fillRect(rx - T, ry - L, T, L)     // 右下
  }
  return g
}

/** 一条鎏金分隔线，中间嵌一个小菱形（回纹的简化）—— 用于标题下沿。
 *  `color` 必须显式标 `number`：默认值来自 `as const` 的 UI 表，
 *  不标的话 TS 会把形参收窄成字面量类型 `0xc9a227`，
 *  于是任何传别的颜色的调用点（如分隔线用弱色 UI.line）都会报类型错。 */
export function rule(
  scene: Phaser.Scene, x: number, y: number, w: number, color: number = UI.gold
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  g.fillStyle(color, 0.75).fillRect(x, y, w, 1)
  const cx = x + w / 2
  g.fillStyle(UI.goldHi, 0.95)
  g.fillTriangle(cx - 4, y, cx, y - 4, cx + 4, y)
  g.fillTriangle(cx - 4, y, cx, y + 4, cx + 4, y)
  g.fillStyle(color, 0.8).fillCircle(cx, y, 2)
  return g
}

/**
 * 朱红印章：一个圆角红块 + 白色字。
 * 三国 UI 的"神来之笔"往往就是这方印 —— 它比任何花纹都更像"印章/符信"。
 */
export function seal(
  scene: Phaser.Scene, cx: number, cy: number, size: number, chars: string
): Phaser.GameObjects.Container {
  const c = scene.add.container(cx, cy)
  const g = scene.add.graphics()
  g.fillStyle(UI.red, 0.92).fillRoundedRect(-size / 2, -size / 2, size, size, 4)
  g.lineStyle(2, UI.goldHi, 0.85).strokeRoundedRect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2, 3)
  c.add(g)
  c.add(scene.add.text(0, 0, chars, {
    fontFamily: FONT, fontSize: `${Math.round(size * 0.5)}px`,
    color: '#fdf6e3', fontStyle: 'bold'
  }).setOrigin(0.5))
  return c
}

/** 统一的文字样式工厂，避免各处 fontSize/color 各写各的。 */
export function text(
  scene: Phaser.Scene, x: number, y: number, s: string,
  size = 14, color: string = TXT.main, opts: Phaser.Types.GameObjects.Text.TextStyle = {}
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, s, {
    fontFamily: FONT, fontSize: `${size}px`, color, ...opts
  })
}
