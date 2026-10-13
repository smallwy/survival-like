/**
 * 霓虹绘制助手 —— `web/src/render/neon.ts` 的 Cocos 版（只搬标题界面用到的部分）。
 *
 * ---------------------------------------------------------------------------
 * 三层发光公式（全项目统一，禁止自己造）
 * ---------------------------------------------------------------------------
 *   bloom  线宽 + 24px   α .12   ← 远看的一点色晕
 *   halo   线宽 +  8px   α .35   ← 柔化，"发光"的来源
 *   core   线宽 +  0px   α 1.0   ← **清晰感的锚点，绝不可省略**
 *
 * 只有 halo/bloom 没有 core = 一团糊光。1–2px 的 100% 实色边保证了即使外层被
 * 缩放拉变形，轮廓依然锐利可读。这是"霓虹但不糊"的全部秘密。
 *
 * ---------------------------------------------------------------------------
 * 移植时的两处差异（都不是可有可无的）
 * ---------------------------------------------------------------------------
 * ① **不做 Canvas 降级那套**：web 侧因为要在无头浏览器（Canvas 渲染器）里截图，
 *    严禁用 `setBlendMode(ADD)` / `fillGradientStyle()`，全部改成"多层纯色叠加"。
 *    Cocos 侧同理不用混合模式 —— 但原因更简单：Graphics 本来就没有 ADD 混合，
 *    而"多层纯色叠加"这套公式照样成立，于是两边视觉一致。
 *
 * ② **椭圆的参数语义反了**：Phaser 的 `fillEllipse(x, y, w, h)` 收的是**直径**，
 *    Cocos 的 `ellipse(cx, cy, rx, ry)` 收的是**半径**。凡是把 web 的数值直接搬
 *    过来的地方都要 `÷ 2`，本文件在 `glowPool` 里显式除以 2 并标注了原因 ——
 *    漏掉这一处，光晕会整整大一倍（而且看起来"也挺正常"，最难查）。
 */

import { Gfx } from './Gfx'

export interface NeonOpts {
  /** core 线宽 / 半径，默认 2 */
  width?: number
  /** 整体透明度乘子（呼吸/淡出用），默认 1 */
  alpha?: number
  /** 是否绘制 bloom 最外层，默认 true */
  bloom?: boolean
  /** 是否填充（而非描边），默认 false */
  fill?: boolean
  /** 填充透明度（fill=true 时生效），默认 1 */
  fillAlpha?: number
}

export const NEON = {
  core: { grow: 0, alpha: 1.0 },
  halo: { grow: 8, alpha: 0.35 },
  bloom: { grow: 24, alpha: 0.12 },
} as const

/**
 * 按三层公式描边/填充一个图形。
 *
 * `draw` 回调只负责"组路径 + 收口"（`fillPath()` / `stroke()`），配色由本函数管 ——
 * 这样调用方不可能漏掉某一层，也不可能把配色写歪。
 */
export function neon(g: Gfx, color: number, draw: () => void, opts: NeonOpts = {}): void {
  const w = opts.width ?? 2
  const aMul = opts.alpha ?? 1

  if (opts.fill) {
    if (opts.bloom !== false) { g.fill(color, NEON.bloom.alpha * aMul); draw() }
    g.fill(color, (opts.fillAlpha ?? 1) * aMul); draw()
    return
  }
  if (opts.bloom !== false) { g.line(color, NEON.bloom.alpha * aMul, w + NEON.bloom.grow); draw() }
  g.line(color, NEON.halo.alpha * aMul, w + NEON.halo.grow); draw()
  g.line(color, NEON.core.alpha * aMul, w); draw()
}

export function neonLine(g: Gfx, x1: number, y1: number, x2: number, y2: number,
                         color: number, opts: NeonOpts = {}): void {
  neon(g, color, () => { g.strokeSeg(x1, y1, x2, y2) }, opts)
}

export function neonCircle(g: Gfx, x: number, y: number, r: number,
                           color: number, opts: NeonOpts = {}): void {
  neon(g, color, () => { g.strokeCircle(x, y, Math.max(1, r)) }, opts)
}

/**
 * 霓虹多边形。`pts` 是扁平的 `[x0,y0,x1,y1,…]`（跟 web 一致，方便对照）。
 *
 * 注意每次 `draw()` 都必须**重新组一遍路径**：Cocos 的 Graphics 在 `fill()/stroke()`
 * 之后路径不会自动清空，不重组就会把同一个多边形叠加画出三层（看起来像"颜色很实"，
 * 实际是三次半透明叠加 —— 这正是那种"参数都对但看着不对"的坑）。
 */
export function neonPoly(g: Gfx, pts: number[], color: number, opts: NeonOpts = {}): void {
  const draw = () => {
    if (pts.length < 6) return
    g.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
    g.close()
    if (opts.fill) g.fillPath(); else g.stroke()
  }
  neon(g, color, draw, opts)
}

/** 线性插值两个 0xRRGGBB 颜色 */
export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  return (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t)
}

/**
 * 竖向渐变 —— 必须是"多条纯色横带"，不能用渐变 API。
 * （web 侧的 `fillGradientStyle` 是 WebGL-only，Canvas 下会被填成单色；
 *   Cocos 侧索性用同一套带渲染，两边逐条对齐、改数值不会各偏一点。）
 *
 * @param stops 从上到下的 `[位置 0~1, 颜色]` 关键点
 * @param rows  拆多少条带（40 条以上肉眼无台阶）
 */
export function verticalBands(g: Gfx, x: number, y: number, w: number, h: number,
                              stops: Array<[number, number]>, rows = 48): void {
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1)
    let c = stops[0][1]
    for (let s = 0; s < stops.length - 1; s++) {
      const [p0, c0] = stops[s]
      const [p1, c1] = stops[s + 1]
      if (t >= p0 && t <= p1) { c = lerpColor(c0, c1, (t - p0) / (p1 - p0 || 1)); break }
    }
    g.fill(c, 1)
    // 每条多画 1px：浮点高度累加会在带之间留出亚像素缝（屏幕上是"扫描线"）
    g.fillRect(x, y + (i / rows) * h, w, h / rows + 1)
  }
}

/**
 * 广发光团（多级低透明椭圆叠加）—— 代替 ADD 混合的"光晕"。
 * 单圈大圆有明显边界，多层同心椭圆互相融合才看不出台阶。
 *
 * ⚠️ 这里必须 `÷2`：web 的 `fillEllipse` 收直径，Cocos 的 `ellipse` 收半径。
 */
export function glowPool(g: Gfx, x: number, y: number, rw: number, rh: number,
                         color: number, rings = 6, alpha = 0.03): void {
  for (let i = rings; i >= 1; i--) {
    const k = i / rings
    g.fill(color, alpha)
    g.ellipse(x, y, (rw * k) / 2, (rh * k) / 2)
    g.fillPath()
  }
}

/**
 * 探照灯锥（朝下的光束）—— 画面唯一的"人造光源"。
 * 用多条纯色横带实现"上亮下灭"，底端自然淡出、不留硬边。
 * （整块梯形会在画布底边切出硬线。）
 */
export function lightCone(g: Gfx, cx: number, top: number, bottom: number,
                          wTop: number, wBot: number, color: number,
                          rows = 26, maxAlpha = 0.09): void {
  const h = bottom - top
  for (let r = 0; r < rows; r++) {
    const t0 = r / rows
    const t1 = (r + 1) / rows
    const y0 = top + t0 * h
    const y1 = top + t1 * h
    const w0 = wTop + (wBot - wTop) * t0
    const w1 = wTop + (wBot - wTop) * t1
    // 越往下越淡（1 - t^1.6），末尾垫一点底光，否则最底部会"突然没了"
    const a = maxAlpha * (1 - Math.pow(t0, 1.6)) + maxAlpha * 0.14
    if (a <= 0) continue
    g.fill(color, a)
    g.moveTo(cx - w0, y0)
    g.lineTo(cx + w0, y0)
    g.lineTo(cx + w1, y1)
    g.lineTo(cx - w1, y1)
    g.close()
    g.fillPath()
  }
}
