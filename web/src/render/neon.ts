import Phaser from 'phaser'

/**
 * 霓虹绘制系统（V4 美术基石）
 *
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件
 * ---------------------------------------------------------------------------
 * V3 的画面糊，根因是"32×32 像素图 + 非整数倍缩放"（见《项目计划书》V4 §1.1）。
 * V4 改为**运行时几何绘制**：没有 png、没有图集、没有 manifest，
 * 形状与发光参数都是代码，因此在任何 DPR / 任何视口下都无损清晰。
 *
 * ---------------------------------------------------------------------------
 * 三层发光公式（全项目统一，禁止自己造）
 * ---------------------------------------------------------------------------
 *   bloom  size + 24px   α .12   ← 远看的一点色晕
 *   halo   size +  8px   α .35   ← 柔化，"发光"的来源
 *   core   size +  0px   α 1.0   ← **清晰感的锚点，绝不可省略**
 *
 * 只有 halo/bloom 没有 core = 一团糊光。1-2px 的 100% 实色边保证了
 * 即使外层被缩放拉变形，轮廓依然锐利可读。这是"霓虹但不糊"的全部秘密。
 *
 * ---------------------------------------------------------------------------
 * Canvas 降级（硬约束，已踩过坑）
 * ---------------------------------------------------------------------------
 * `setBlendMode(ADD)` 与 `fillGradientStyle()` 是 **WebGL-only**。
 * 在 Canvas 渲染器（无头验证环境 `--disable-gpu`）下：
 *   - ADD  → 图形被画成实心白 / 青色块
 *   - 渐变 → 被忽略，填成单色
 * 所以本文件**不使用任何 WebGL 专属 API**，全部用"多层纯色叠加"实现发光。
 */

/** 发光的三层默认值。调这些数就是调整体"柔光硬度"。 */
export const NEON = {
  core:  { grow: 0,  alpha: 1.0 },
  halo:  { grow: 8,  alpha: 0.35 },
  bloom: { grow: 24, alpha: 0.12 },
} as const

export interface NeonOpts {
  /** core 线宽/半径，默认 2 */
  width?: number
  /** 整体透明度乘子（用于呼吸/淡出），默认 1 */
  alpha?: number
  /** 是否绘制 bloom 最外层，默认 true */
  bloom?: boolean
  /** 是否填充（而非描边），默认 false */
  fill?: boolean
  /** 填充透明度（fill=true 时生效） */
  fillAlpha?: number
}

/**
 * 霓虹描边 / 填充一个 Graphics 指令。
 *
 * 用法：把"如何画这个形状"作为回调传入，本函数负责按三层重复执行它。
 *
 *   neonLine(g, UI.cyan, () => { g.strokeCircle(x, y, r) })
 */
export function neon(g: Phaser.GameObjects.Graphics, color: number,
                     draw: () => void, opts: NeonOpts = {}) {
  const w = opts.width ?? 2
  const aMul = opts.alpha ?? 1

  if (opts.fill) {
    // 填充的"外发光"用同色低透明大一圈来模拟（不能用 ADD）
    if (opts.bloom !== false) {
      g.fillStyle(color, NEON.bloom.alpha * aMul)
      draw()
    }
    g.fillStyle(color, (opts.fillAlpha ?? 1) * aMul)
    draw()
    return
  }

  if (opts.bloom !== false) {
    g.lineStyle(w + NEON.bloom.grow, color, NEON.bloom.alpha * aMul)
    draw()
  }
  g.lineStyle(w + NEON.halo.grow, color, NEON.halo.alpha * aMul)
  draw()
  g.lineStyle(w, color, NEON.core.alpha * aMul)
  draw()
}

/** 霓虹直线 */
export function neonLine(g: Phaser.GameObjects.Graphics, x1: number, y1: number,
                         x2: number, y2: number, color: number, opts: NeonOpts = {}) {
  neon(g, color, () => { g.strokeLineShape(new Phaser.Geom.Line(x1, y1, x2, y2)) }, opts)
}

/** 霓虹圆（描边） */
export function neonCircle(g: Phaser.GameObjects.Graphics, x: number, y: number,
                           r: number, color: number, opts: NeonOpts = {}) {
  neon(g, color, () => { g.strokeCircle(x, y, Math.max(1, r)) }, opts)
}

/** 霓虹矩形（描边） */
export function neonRect(g: Phaser.GameObjects.Graphics, x: number, y: number,
                         w: number, h: number, color: number, opts: NeonOpts = {}) {
  neon(g, color, () => { g.strokeRect(x, y, w, h) }, opts)
}

/**
 * 霓虹多边形。
 * @param pts 顶点数组（世界坐标，相对 Graphics 自身）
 */
export function neonPoly(g: Phaser.GameObjects.Graphics, pts: number[],
                         color: number, opts: NeonOpts = {}) {
  const draw = () => {
    g.beginPath()
    g.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
    g.closePath()
    if (opts.fill) g.fillPath(); else g.strokePath()
  }
  const w = opts.width ?? 2
  const aMul = opts.alpha ?? 1
  if (opts.fill) {
    if (opts.bloom !== false) { g.fillStyle(color, NEON.bloom.alpha * aMul); draw() }
    g.fillStyle(color, (opts.fillAlpha ?? 1) * aMul)
    draw()
    return
  }
  if (opts.bloom !== false) { g.lineStyle(w + NEON.bloom.grow, color, NEON.bloom.alpha * aMul); draw() }
  g.lineStyle(w + NEON.halo.grow, color, NEON.halo.alpha * aMul); draw()
  g.lineStyle(w, color, NEON.core.alpha * aMul); draw()
}

/** 霓虹折线（点序列 [x0,y0,x1,y1,...]） */
export function neonCurve(g: Phaser.GameObjects.Graphics, pts: number[],
                          color: number, opts: NeonOpts = {}) {
  const draw = () => {
    g.beginPath()
    g.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
    if (opts.fill) g.fillPath(); else g.strokePath()
  }
  const w = opts.width ?? 2
  const aMul = opts.alpha ?? 1
  if (opts.fill) { g.fillStyle(color, (opts.fillAlpha ?? 1) * aMul); draw(); return }
  if (opts.bloom !== false) { g.lineStyle(w + NEON.bloom.grow, color, NEON.bloom.alpha * aMul); draw() }
  g.lineStyle(w + NEON.halo.grow, color, NEON.halo.alpha * aMul); draw()
  g.lineStyle(w, color, NEON.core.alpha * aMul); draw()
}

/**
 * 竖向渐变 —— 必须是 bandRenderer，因为 fillGradientStyle 是 WebGL-only。
 *
 * @param stops 从上到下的 [位置 0~1, 颜色] 关键点
 * @param rows  拆多少条纯色带（40 条以上肉眼无台阶）
 */
export function verticalBands(g: Phaser.GameObjects.Graphics, x: number, y: number,
                              w: number, h: number,
                              stops: [number, number][], rows = 48) {
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1)
    let col = stops[0][1]
    for (let s = 0; s < stops.length - 1; s++) {
      const [p0, c0] = stops[s]
      const [p1, c1] = stops[s + 1]
      if (t >= p0 && t <= p1) { col = lerpColor(c0, c1, (t - p0) / (p1 - p0 || 1)); break }
    }
    g.fillStyle(col, 1)
    g.fillRect(x, y + (i / rows) * h, w, h / rows + 1)
  }
}

/** 线性插值两个 0xRRGGBB 颜色 */
export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const gg = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (gg << 8) | bl
}

/**
 * 广发光团（多级低透明椭圆叠加）—— 代替 ADD 混合的"光晕"。
 * 单圈大圆会有明显边界，多层同心椭圆互相融合才看不出台阶。
 */
export function glowPool(g: Phaser.GameObjects.Graphics, x: number, y: number,
                         rw: number, rh: number, color: number, rings = 6, alpha = 0.03) {
  for (let i = rings; i >= 1; i--) {
    g.fillStyle(color, alpha)
    const k = i / rings
    g.fillEllipse(x, y, rw * k, rh * k)
  }
}

/**
 * 探照灯锥（朝下的光束）。
 * 用多条纯色横带实现"上亮下灭"，底端自然淡出、不留硬边。
 * （整块梯形会在画布底边切出硬线，且依赖 ADD 混合。）
 */
export function lightCone(g: Phaser.GameObjects.Graphics, cx: number, top: number,
                          bottom: number, wTop: number, wBot: number,
                          color: number, rows = 26, maxAlpha = 0.09) {
  const h = bottom - top
  for (let r = 0; r < rows; r++) {
    const t0 = r / rows
    const t1 = (r + 1) / rows
    const y0 = top + t0 * h
    const y1 = top + t1 * h
    const w0 = wTop + (wBot - wTop) * t0
    const w1 = wTop + (wBot - wTop) * t1
    const a = maxAlpha * (1 - Math.pow(t0, 1.6)) + maxAlpha * 0.14
    g.fillStyle(color, Math.max(0, a))
    g.beginPath()
    g.moveTo(cx - w0, y0)
    g.lineTo(cx + w0, y0)
    g.lineTo(cx + w1, y1)
    g.lineTo(cx - w1, y1)
    g.closePath()
    g.fillPath()
  }
}

/**
 * 九宫格霓虹面板。
 * @param corner 角块尺寸；圆角用描边实现，避免 9-slice 拉伸变形
 */
export function neonPanel(g: Phaser.GameObjects.Graphics, x: number, y: number,
                          w: number, h: number, corner: number,
                          fillColor: number, strokeColor: number, alpha = 1) {
  g.fillStyle(fillColor, 0.92 * alpha)
  g.fillRoundedRect(x, y, w, h, corner)
  g.lineStyle(1, strokeColor, 0.9 * alpha)
  g.strokeRoundedRect(x, y, w, h, corner)
  // 外侧 halo（Canvas 安全的"发光"）
  g.lineStyle(3, strokeColor, 0.10 * alpha)
  g.strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, corner + 2)
}
