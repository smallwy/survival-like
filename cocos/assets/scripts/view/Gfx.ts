/**
 * Cocos 渲染工具：坐标/颜色 + **y 轴翻转的 Graphics 包装**。
 *
 * ---------------------------------------------------------------------------
 * 为什么需要这个包装（这是从 Phaser 移植最容易错的一处）
 * ---------------------------------------------------------------------------
 * 模拟层（`shared/dive`）沿用 Phaser 的坐标系：**原点在左上角、y 向下**。
 * 而 Cocos Creator 的 2D 坐标是**原点在左下角、y 向上**。
 *
 * 处理方式（只在这一层做转换，模拟层完全不用知道）：
 *   1. 世界容器 `WorldRoot` 的 UITransform 锚点设成 (0,0)、尺寸 = 逻辑画布 W×H；
 *   2. 子节点坐标用 `V(x, y) = (x, H - y)`；
 *   3. Graphics 的所有图元坐标走本类的包装函数，内部自动 `H - y`；
 *   4. 角度取反：sim 的 `θ`（y 向下）对应 node 的 `-θ`（y 向上）。
 *
 * 于是"sim 坐标画到哪里"只有这一处规则，渲染代码其余部分读起来和
 * 原 Phaser 绘制代码几乎同构 —— 这是刻意换来的可对照性。
 */

import { Graphics, Color } from 'cc'

/** 0xRRGGBB + alpha(0~1) → cc.Color */
export function col(hex: number, alpha = 1): Color {
  return new Color(
    (hex >> 16) & 0xff,
    (hex >> 8) & 0xff,
    hex & 0xff,
    Math.round(alpha * 255),
  )
}

export class Gfx {
  constructor(readonly g: Graphics, private readonly H: number) {}

  /** 逻辑画布高（sim 坐标系的高） */
  get height(): number { return this.H }

  clear(): void { this.g.clear() }

  // ---- 坐标变换 ----
  /** sim 的 y → node 的 y */
  y(v: number): number { return this.H - v }
  /** sim 的角度（y 向下，顺时针为正）→ node 的角度（弧度） */
  ang(a: number): number { return -a }

  // ---- 状态 ----
  fill(hex: number, alpha = 1): this { this.g.fillColor = col(hex, alpha); return this }
  line(hex: number, alpha = 1, w = 1): this {
    this.g.strokeColor = col(hex, alpha)
    this.g.lineWidth = w
    return this
  }
  /** 把当前累积的路径填充掉（`moveTo/lineTo` 组完一条折线后调用） */
  fillPath(): this { this.g.fill(); return this }
  /** 把当前累积的路径描边掉 */
  stroke(): this { this.g.stroke(); return this }
  /** 起始一个新的子路径（避免上一条折线被再次描边） */
  moveTo(x: number, y: number): this { this.g.moveTo(x, this.y(y)); return this }
  lineTo(x: number, y: number): this { this.g.lineTo(x, this.y(y)); return this }

  // ---- 图元（一律收 **sim 坐标**）----

  /** 描边/填充圆 */
  circle(x: number, y: number, r: number): this { this.g.circle(x, this.y(y), r); return this }
  fillCircle(x: number, y: number, r: number): this { this.circle(x, y, r); this.g.fill(); return this }
  strokeCircle(x: number, y: number, r: number): this { this.circle(x, y, r); this.g.stroke(); return this }

  /**
   * 椭圆（半轴 rx/ry）。
   *
   * 用途单一但重要：**深层的敌人定位环**。L3-L5 的鱼贴图本身是暗色，叠在同样
   * 深的背景上会糊成一片 —— web 侧为此画过一个"贴合鱼轮廓的描边环"，
   * 而且明确否掉了"暗色实心椭圆衬底"那版（实心底比小鱼还大，把鱼盖成亮斑，
   * 满屏看起来像白色小飞虫）。所以这里只要描边。
   */
  ellipse(x: number, y: number, rx: number, ry: number): this {
    this.g.ellipse(x, this.y(y), rx, ry); return this
  }
  strokeEllipse(x: number, y: number, rx: number, ry: number): this {
    this.ellipse(x, y, rx, ry); this.g.stroke(); return this
  }

  /** 矩形，(x,y) 是**左上角** */
  rect(x: number, y: number, w: number, h: number): this {
    const yb = this.y(y + h)
    this.g.moveTo(x, yb)
    this.g.lineTo(x + w, yb)
    this.g.lineTo(x + w, yb + h)
    this.g.lineTo(x, yb + h)
    this.g.close()
    return this
  }
  fillRect(x: number, y: number, w: number, h: number): this { this.rect(x, y, w, h); this.g.fill(); return this }
  strokeRect(x: number, y: number, w: number, h: number): this { this.rect(x, y, w, h); this.g.stroke(); return this }

  /** 线段 */
  seg(x1: number, y1: number, x2: number, y2: number): this {
    this.g.moveTo(x1, this.y(y1))
    this.g.lineTo(x2, this.y(y2))
    return this
  }
  strokeSeg(x1: number, y1: number, x2: number, y2: number): this {
    this.seg(x1, y1, x2, y2); this.g.stroke(); return this
  }

  /** 折线（电弧用） */
  polyline(pts: Array<{ x: number; y: number }>): this {
    if (pts.length < 2) return this
    this.g.moveTo(pts[0].x, this.y(pts[0].y))
    for (let i = 1; i < pts.length; i++) this.g.lineTo(pts[i].x, this.y(pts[i].y))
    return this
  }
  strokePolyline(pts: Array<{ x: number; y: number }>): this { this.polyline(pts); this.g.stroke(); return this }

  /** 三角（敌人剪影兜底用） */
  tri(x: number, y: number, angRad: number, len: number, halfW: number): this {
    const a = this.ang(angRad)
    const ca = Math.cos(a), sa = Math.sin(a)
    const T = (f: number, s: number) => ({
      x: x + f * ca - s * sa,
      y: this.y(y) + f * sa + s * ca,
    })
    const p1 = T(len, 0), p2 = T(-len * 0.6, halfW), p3 = T(-len * 0.6, -halfW)
    this.g.moveTo(p1.x, p1.y)
    this.g.lineTo(p2.x, p2.y)
    this.g.lineTo(p3.x, p3.y)
    this.g.close()
    return this
  }
  fillTri(x: number, y: number, angRad: number, len: number, halfW: number): this {
    this.tri(x, y, angRad, len, halfW); this.g.fill(); return this
  }
}

/** 世界容器 + 子节点的工具：把 sim 坐标转成节点局部坐标 */
export function v3(x: number, y: number, H: number, out?: { x: number; y: number }) {
  // 只做纯数值计算，避免每帧 new Vec3
  if (out) { out.x = x; out.y = H - y; return out }
  return { x, y: H - y }
}
