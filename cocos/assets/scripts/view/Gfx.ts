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
  /** 闭合当前子路径（多边形要收口，否则描边的最后一条边不会画出来） */
  close(): this { this.g.close(); return this }

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
  /** 填充椭圆。V6.53：**远景鱼群的鱼身** —— 侧视鱼是"压扁的长条"，不是圆 */
  fillEllipse(x: number, y: number, rx: number, ry: number): this {
    this.ellipse(x, y, rx, ry); this.g.fill(); return this
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

  /**
   * 圆角矩形，(x,y) 同样是**左上角**。
   *
   * 引擎的 `Graphics.roundRect(x, y, w, h, r)` 收的是**最小角**（y 向上的左下角），
   * 所以这里跟 `rect()` 一样要把 y 翻到"下边缘"。漏了这一步会得到一个上下镜像、
   * 位置差一个 h 的圆角框 —— 单看一张卡"好像也对"，只有跟坐标一起看才发现错位。
   */
  roundRect(x: number, y: number, w: number, h: number, r: number): this {
    this.g.roundRect(x, this.y(y + h), w, h, r)
    return this
  }
  fillRoundRect(x: number, y: number, w: number, h: number, r: number): this {
    this.roundRect(x, y, w, h, r); this.g.fill(); return this
  }
  strokeRoundRect(x: number, y: number, w: number, h: number, r: number): this {
    this.roundRect(x, y, w, h, r); this.g.stroke(); return this
  }

  /**
   * 圆弧（描边路径）。角度取 **sim 语义**：y 向下、角度增加 = 视觉顺时针（与 Phaser 的
   * `arc` 一致）。引擎的 `Graphics.arc` 在 y 翻转之后方向会镜像，所以这里用**分段折线**
   * 自己画 —— 冷却环 / 倒计时环的方向不会因引擎差异而反。用完记得 `.stroke()`。
   *
   * `cont = true` 时从当前点**连一段直线**到弧起点（与 Phaser `arc` 的行为一致），
   * 用于"线 + 弧"拼成的复合图标（心形、回声弧）。默认 false＝另起子路径。
   */
  arc(x: number, y: number, r: number, a0: number, a1: number, cont = false): this {
    const sweep = a1 - a0
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)))
    const px0 = x + Math.cos(a0) * r, py0 = this.y(y + Math.sin(a0) * r)
    if (cont) this.g.lineTo(px0, py0)
    else this.g.moveTo(px0, py0)
    for (let i = 1; i <= n; i++) {
      const a = a0 + sweep * (i / n)
      this.g.lineTo(x + Math.cos(a) * r, this.y(y + Math.sin(a) * r))
    }
    return this
  }

  /**
   * **椭圆弧**（描边路径）—— 补 `arc()` 只能画正圆所缺的那一半。
   *
   * 用例：3/4 俯视下**赤道挂载带**这类"绕球一圈的环"在屏幕上是个压扁的椭圆，
   * 要做出"前半粗亮 / 后半细暗"的前后分离，就必须能**只画椭圆的半圈** ——
   * 引擎的 `Graphics.arc` 只收单一半径 `r`，画不出椭圆弧。
   *
   * 角度语义与 `arc()` 完全一致（sim 语义：y 向下、角度增加 = 视觉顺时针）。
   * 从 `a0` 扫到 `a1`，采样密度同 `arc()`（每 π 分 24 段）。
   *
   * ⚠️ 起手用 `moveTo`（不是 `lineTo`）**不是随手写的**：Cocos 的 `Graphics`
   * 靠 `moveTo` 推进 `impl.pathOffset` 来隔离"上一次 `stroke()`/`fill()` 画过的路径"，
   * 而 assembler 只遍历 `[pathOffset, pathLength)`（读过 `impl.moveTo` 与
   * `graphics-assembler.stroke`）。所以**连续画多条弧不会互相覆盖** —— 这正是
   * "前半/后半分开描边"能成立的前提。
   */
  ellipseArc(x: number, y: number, rx: number, ry: number, a0: number, a1: number): this {
    const sweep = a1 - a0
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)))
    this.g.moveTo(x + Math.cos(a0) * rx, this.y(y + Math.sin(a0) * ry))
    for (let i = 1; i <= n; i++) {
      const a = a0 + sweep * (i / n)
      this.g.lineTo(x + Math.cos(a) * rx, this.y(y + Math.sin(a) * ry))
    }
    return this
  }

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
