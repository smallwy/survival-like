/**
 * 主界面 —— 赛博霓虹深海（移植 `web/src/scenes/TitleScene.ts` 的可见部分）。
 *
 * ---------------------------------------------------------------------------
 * 为什么不是"新建一个 Cocos 场景"，而是同一个场景里的一个类
 * ---------------------------------------------------------------------------
 * web 侧 TitleScene 是独立 Scene，理由是"主界面有持续动画的背景，塞进主 Scene
 * 会让这套动画整局常驻吃 CPU"。
 *
 * Cocos 侧这里选了另一条路：**做成与 `Hud` 同构的"纯类 + 自建节点树"**，
 * 挂在同一个场景里，靠 `setVisible()` 开关。理由是 Cocos 的 `director.loadScene()`
 * 要求目标场景在构建列表里，而"编辑器里点 ▶ 跑的是当前打开的那个场景"——
 * 加第二个 `.scene` 会把已经做好的「打开工程点运行」变成"你得先知道要打开哪个场景"。
 * 而 Title 只是个静态菜单，`root.active = false` 之后就真的不参与渲染与更新，
 * 省 CPU 的目的照样达到。
 *
 * 代价：主界面与战斗的 `update` 由同一个组件分派（见 `DiveGame.update` 里的
 * `if (!this.started)` 分支），两者不会同时跑。
 *
 * ---------------------------------------------------------------------------
 * 视觉参照
 * ---------------------------------------------------------------------------
 * 近黑蓝的整体底色 → 一艘小潜航器悬在中上，**探照灯锥向下劈开黑暗**（画面唯一光源）
 * → 陡峭的深渊峡谷岩壁，只用霓虹轮廓线表达 → 几只自发光水母（色相刻意避开 UI 青蓝，
 * 否则玩家会把它读成 HUD 元素）→ 全屏扫描线 / 舱窗网格（α ≤ .06，只做暗示）。
 *
 * **除三张潜航器立绘外，所有图形都是 100% 运行时几何绘制**：矢量在任何分辨率下
 * 都锐利，不存在像素对齐问题。
 *
 * ---------------------------------------------------------------------------
 * 四个注入 Cocos 后才会暴露的坑（前三个与已有的 Hud.ts 同源）
 * ---------------------------------------------------------------------------
 * ① **layer 必须显式继承**：运行时 `new Node()` 的 layer 是 DEFAULT，而 Canvas 的
 *    UI 相机只渲染 UI_2D —— 漏一处就是"画面上什么都没有"。统一走 `mk()`。
 *
 * ② **Label 的锚点要跟着对齐方式走**：`overflow=NONE` 下 Label 的内容尺寸自适应
 *    文本，锚点 (0.5,0.5) 意味着"文本中心落在节点位置"，于是右对齐的数字右边缘
 *    会随位数漂移。锚点设 0 / 0.5 / 1 才是真贴边。见 `put()`。
 *
 * ③ **椭圆参数语义与 Phaser 反了**：Phaser `fillEllipse` 收直径，Cocos
 *    `ellipse(cx,cy,rx,ry)` 收半径。凡是照搬 web 数值的地方都要 ÷2 ——
 *    漏了不会报错，只会"光晕整整大一倍"，属于最难查的那类。
 *
 * ④ **静态图形只画一次，动画靠节点属性**：探照灯的摇曳改 `UIOpacity.opacity` +
 *    节点 x，扫描线整层平移，水母整体位移 —— 都不重画几何。标题界面在菜单上
 *    会停留很久，每帧重画几百条线是纯浪费。
 *
 * ---------------------------------------------------------------------------
 * 与 web 的一处刻意不同：字体
 * ---------------------------------------------------------------------------
 * web 用 `'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif` 三档回退。
 * Cocos 侧**先不设 `fontFamily`**（用引擎默认系统字体）：多字体回退列表是 CSS 的
 * 语义，在原生平台上不保证等价，而"字体没生效"是那种看不出来但一直不对的问题。
 * 现有 `Hud.ts` 也走默认字体，两边保持一致；等接入字体资源后再统一。
 */

import {
  Node, Label, Graphics, Sprite, UITransform, UIOpacity,
} from 'cc'
import { Gfx, col } from './Gfx'
import {
  neon, neonLine, neonCircle, neonPoly, verticalBands, glowPool, lightCone,
} from './neon'
import { SpriteBank } from './art'
import { UI, TXT, BUILD_TAG } from '../shared/theme'
import { SUBS, SUB_ART_R } from '../shared/subs'
import type { SubDef, SubId } from '../shared/subs'

/** 卡片布局：与 web 逐值一致（改这里就是改"卡面比例"） */
const CW = 268
const CHH = 124
const CGAP = 18
const ART_BOX = 96
const ART_LEFT = 10
const ART_TOP = 14
/** 卡内立绘按**圆盘直径**显示（见 subs.ts 的 SUB_ART_R 说明） */
const DISC_IN_CARD = 72
/** 扫描线一个循环的高度（web 是 `4 * ceil(H/4) + 8`） */
const scanSpan = (H: number) => 4 * Math.ceil(H / 4) + 8

type Align = 'left' | 'center' | 'right'

interface Btn {
  gfx: Gfx
  label: Label
  w: number
  h: number
  primary: boolean
  hover: boolean
  onTap: () => void
}

interface Card {
  art: Sprite
  labels: Label[]
  /** 卡左边缘（sim x）。绘制与命中区都从它算，避免两处各算一遍 */
  x: number
}

interface Jelly { node: Node; vy: number; sway: number; t: number }
interface Mote { x: number; y: number; r: number; vy: number }

export class Title {
  private readonly root: Node
  private readonly gBack: Gfx
  private readonly gCanyon: Gfx
  private readonly gCone: Gfx
  private readonly coneNode: Node
  private readonly coneOpacity: UIOpacity
  private readonly gGrid: Gfx
  private readonly gScan: Gfx
  private readonly scanNode: Node
  private readonly gMotes: Gfx
  private readonly gCards: Gfx
  private readonly gDeco: Gfx

  private readonly labels: Label[] = []
  private readonly cards: Card[] = []
  private readonly jellies: Jelly[] = []
  private readonly motes: Mote[] = []
  private readonly btns: Btn[] = []

  private sel = 0
  private t = 0
  private padW = 8
  private padH = 8
  private viewW = 0
  private viewH = 0
  private footer = ''
  private footerLabel: Label | null = null
  private recordsLabel: Label | null = null
  /** 装置坞占位面板。开着的时候卡片与按钮不响应 —— 否则"点一下关闭"会顺手把选项也换了 */
  private modal: Node | null = null

  constructor(
    private readonly canvas: Node,
    private readonly W: number,
    private readonly H: number,
    private readonly art: SpriteBank,
    private readonly cb: { onStart: (sub: SubId) => void },
  ) {
    this.root = this.mk('Title', canvas)
    const ut = this.root.addComponent(UITransform)
    ut.setAnchorPoint(0, 0)
    ut.setContentSize(W, H)
    this.root.setPosition(-W / 2, -H / 2)

    // 顺序即绘制顺序。网格与扫描线**刻意排在 UI 之后**：web 给了它们 depth 50/51，
    // 也就是"隔着一层玻璃"的暗示连标题字和卡片一起罩住（α ≤ .06，只做暗示）。
    this.gBack = this.wrap('tBack')
    this.gCanyon = this.wrap('tCanyon')
    this.coneNode = this.mk('tCone', this.root)
    this.gCone = new Gfx(this.coneNode.addComponent(Graphics), H)
    this.coneOpacity = this.coneNode.addComponent(UIOpacity)
    this.gMotes = this.wrap('tMotes')
    this.gDeco = this.wrap('tDeco')
    this.buildJellies()
    this.buildTitleText()
    // 卡体描边单独一层，且**必须早于卡上的文字与立绘**创建 ——
    // 节点顺序就是绘制顺序，晚建的话卡体会盖住文字。
    this.gCards = this.wrap('tCards')
    this.buildCards()
    this.buildButtons()
    this.buildHints()
    this.gGrid = this.wrap('tGrid')
    this.scanNode = this.mk('tScan', this.root)
    this.gScan = new Gfx(this.scanNode.addComponent(Graphics), 0)

    this.layout(true)
    this.select(0)
  }

  // -------------------------------------------------------------------------
  // 基础设施
  // -------------------------------------------------------------------------
  /** 建节点并**继承父节点 layer**（坑 ① 的唯一入口） */
  private mk(name: string, parent: Node): Node {
    const n = new Node(name)
    n.layer = parent.layer
    n.parent = parent
    return n
  }

  private wrap(name: string): Gfx {
    return new Gfx(this.mk(name, this.root).addComponent(Graphics), this.H)
  }

  /** 放一段文字。`(x,y)` 是**锚边**：left 给左边缘、right 给右边缘、center 给中心。 */
  private put(x: number, y: number, s: string, size: number, color: string, mode: Align): Label {
    const l = this.mk('t', this.root).addComponent(Label)
    l.string = s
    l.fontSize = size
    l.lineHeight = size + 2
    l.color = col(parseInt(color.slice(1), 16))
    l.verticalAlign = Label.VerticalAlign.CENTER
    l.horizontalAlign = mode === 'left' ? Label.HorizontalAlign.LEFT
      : mode === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER
    const ut = l.node.getComponent(UITransform)
    if (ut) ut.setAnchorPoint(mode === 'left' ? 0 : mode === 'right' ? 1 : 0.5, 0.5)
    l.node.setPosition(x, this.H - y)
    this.labels.push(l)
    return l
  }

  private text(x: number, y: number, s: string, size: number, color: string, right = false): Label {
    return this.put(x, y, s, size, color, right ? 'right' : 'left')
  }

  private center(x: number, y: number, s: string, size: number, color: string): Label {
    return this.put(x, y, s, size, color, 'center')
  }

  private opacityOf(n: Node): UIOpacity {
    return n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity)
  }

  // -------------------------------------------------------------------------
  // 铺满屏幕的静态层
  // -------------------------------------------------------------------------
  /**
   * 设计分辨率与实际画布宽高比不一致时，四周会露出清屏色的一条带 ——
   * 只在某些机型上出现，属于"上线后才被发现"的那类。所以按 Canvas 真实尺寸外扩。
   * 画布尺寸变化（首帧、拖窗口、改 DPR）时本函数会被再调一次。
   */
  private layout(force: boolean): void {
    const ut = this.canvas.getComponent(UITransform)
    const cw = ut ? ut.contentSize.width : 0
    const ch = ut ? ut.contentSize.height : 0
    if (!force && cw === this.viewW && ch === this.viewH) return
    this.viewW = cw
    this.viewH = ch
    this.padW = Math.max(0, ((cw > 0 ? cw : this.W) - this.W) / 2) + 8
    this.padH = Math.max(0, ((ch > 0 ? ch : this.H) - this.H) / 2) + 8
    this.drawBackdrop()
    this.drawCanyon()
    this.drawCone()
    this.drawScanlines()
    this.buildGrid()
    this.updateFooter()
  }

  private drawBackdrop(): void {
    const x = -this.padW
    const y = -this.padH
    const w = this.W + this.padW * 2
    const h = this.H + this.padH * 2
    this.gBack.clear()
    // 不用渐变 API：56 条纯色横带模拟竖向渐变，密度足够就看不出台阶
    verticalBands(this.gBack, x, y, w, h, [
      [0.00, 0x071826],   // 顶部：远处的微光还将亮未亮
      [0.30, 0x0a2233],
      [0.58, 0x061019],   // 中：光开始被吞
      [1.00, 0x02050a],   // 底：纯粹的黑
    ], 56)
    // 中央柔和高光：多圈低透明椭圆叠加（单圈大圆会有明显边界）
    glowPool(this.gBack, this.W * 0.5, this.H * 0.26, this.W * 0.95, this.H * 0.62, UI.cyanDim, 7, 0.028)
    this.gBack.fill(UI.cyan, 0.05)
    this.gBack.ellipse(this.W * 0.5, this.H * 0.2, (this.W * 0.55) / 2, (this.H * 0.3) / 2)
    this.gBack.fillPath()
  }

  /**
   * 峡谷：两侧向内收拢的岩壁，**只有霓虹轮廓线**，内部用近黑填充挡住背景。
   * 轮廓越往下越暗（深渊里连岩石也不反光），这是深度感最省成本的做法。
   */
  private drawCanyon(): void {
    const W = this.W
    const H = this.H
    this.gCanyon.clear()

    const wall = (xFrom: number, dir: number, amp: number, seed: number) => {
      const pts: number[] = []
      const steps = 34
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        // 越往下越向画面中间侵入（人字形收拢）
        const inset = Math.pow(t, 1.35) * W * 0.26
        const jag = Math.sin(t * 9 + seed) * amp + Math.sin(t * 21 + seed * 2) * amp * 0.45
        pts.push(xFrom + dir * (inset + jag), t * H)
      }
      pts.push(xFrom + dir * W, H)   // 闭合到画布外侧
      pts.push(xFrom + dir * W, 0)
      neonPoly(this.gCanyon, pts, UI.rock, { fill: true, fillAlpha: 0.95, bloom: false })
      neonPoly(this.gCanyon, pts, UI.line, { width: 1.5, alpha: 0.85, bloom: false })
    }

    wall(0, 1, 26, 0.7)        // 左壁
    wall(W, -1, 30, 2.3)       // 右壁
  }

  /** 探照灯锥：画面唯一的"人造光源"，从上方潜航器位置向下劈出的宽光锥 */
  private drawCone(): void {
    this.gCone.clear()
    lightCone(this.gCone, this.W * 0.5, this.H * 0.10, this.H * 1.02,
      this.W * 0.05, this.W * 0.52, UI.cyanHi, 30, 0.085)
  }

  /** 舱窗网格 + 四角框（α 全部 ≤ .06：这一层是"隔着玻璃"的暗示，不是真网格） */
  private buildGrid(): void {
    this.gGrid.clear()
    const W = this.W
    const H = this.H
    this.gGrid.line(UI.cyanDim, 0.035, 1)
    for (let x = 0; x <= W; x += 64) this.gGrid.strokeSeg(x, 0, x, H)
    for (let y = 0; y <= H; y += 64) this.gGrid.strokeSeg(0, y, W, y)
    this.gGrid.line(UI.cyan, 0.10, 1)
    const m = 18
    const len = 46
    for (const [sx, sy, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      this.gGrid.strokeSeg(sx, sy, sx + dx * len, sy)
      this.gGrid.strokeSeg(sx, sy, sx, sy + dy * len)
    }
  }

  /**
   * 扫描线：**只建一次几何，之后整层平移**（每帧重画 380 条线纯属白扔 CPU）。
   *
   * 用 `new Gfx(g, 0)`：H=0 时 y 翻转退化为取负，于是这里可以按"屏幕坐标"直觉写，
   * 平移交给节点位置。**画到 `span` 那么高**是为了让"移上去再跳回"这个循环无缝 ——
   * 只画一屏高的话，跳回瞬间底部会空一截。
   */
  private drawScanlines(): void {
    this.gScan.clear()
    const span = scanSpan(this.H)
    const x0 = -this.padW
    const x1 = this.W + this.padW
    this.gScan.line(UI.cyan, 0.030, 1)
    for (let v = span + 8; v >= -(this.H + this.padH + 8); v -= 4) {
      this.gScan.strokeSeg(x0, v, x1, v)
    }
  }

  // -------------------------------------------------------------------------
  // 水母（几何签名：伞盖 + 白色内核 + 触须）
  // -------------------------------------------------------------------------
  /**
   * 色相刻意避开 UI 青蓝：jade / magenta / violet / amber 都可以，独独不能有青蓝，
   * 否则玩家会把它读成 HUD 元素（《UI规格》§2.3 色相隔离）。
   */
  private buildJellies(): void {
    const specs = [
      { x: 0.18, y: 0.60, s: 1.0, c: UI.violet },
      { x: 0.84, y: 0.48, s: 1.35, c: UI.magenta },
      { x: 0.64, y: 0.80, s: 0.78, c: UI.jade },
      { x: 0.33, y: 0.30, s: 0.66, c: UI.magenta },
      { x: 0.92, y: 0.22, s: 0.58, c: UI.jade },
    ]
    for (const sp of specs) {
      const n = this.mk('jelly', this.root)
      // H=0：内部按 web 的"y 向下"直觉写坐标，摆放交给节点位置
      const g = new Gfx(n.addComponent(Graphics), 0)
      this.drawJelly(g, sp.s, sp.c)
      this.opacityOf(n).opacity = Math.round(0.72 * 255)
      n.setPosition(this.W * sp.x, this.H - this.H * sp.y)
      this.jellies.push({ node: n, vy: -6 * sp.s, sway: 14 * sp.s, t: Math.random() * 6.28 })
    }
  }

  /**
   * 画一只水母 = 三段式：外发光多层 → 伞盖实体 → **白色内核**（清晰感的来源）→ 触须。
   *
   * ⚠️ 所有椭圆都要 ÷2：web 的 `fillEllipse` 收直径，Cocos 的 `ellipse` 收半径。
   */
  private drawJelly(g: Gfx, s: number, c: number): void {
    const R = 42 * s

    // 外发光：多层低透明大圈（代替 Canvas 不支持的 ADD 混合）
    for (let i = 4; i >= 1; i--) {
      g.fill(c, 0.055)
      g.circle(0, 0, R + i * 8)
      g.fillPath()
    }
    g.fill(c, 0.42)
    g.ellipse(0, 0, (R * 1.7) / 2, (R * 1.35) / 2)
    g.fillPath()

    // 伞盖轮廓：core 层的 1.5px 实色边（半圈，拱面朝上；闭合弦落在伞盖根部）
    const arc: number[] = []
    const seg = 20
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI + Math.PI * (i / seg)
      arc.push(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.68)
    }
    neonPoly(g, arc, c, { width: 1.5, bloom: false })

    // 内核（core）：100% 实色的高亮，让水母"实"起来而不是一团光
    g.fill(0xffffff, 0.82)
    g.ellipse(0, -R * 0.16, (R * 0.62) / 2, (R * 0.44) / 2)
    g.fillPath()

    // 触须：4 条折线（web 侧也是静态形状，摆动由整体位移表达）
    g.line(c, 0.6, 2.2 * s)
    for (let k = 0; k < 4; k++) {
      const x0 = (-1.5 + k) * R * 0.32
      g.moveTo(x0, R * 0.5)
      g.lineTo(x0 * 1.25, R * 0.5 + R * 0.9)
      g.lineTo(x0 * 1.6, R * 0.5 + R * 1.75)
      g.stroke()
    }
  }

  // -------------------------------------------------------------------------
  // 标题文字与装饰
  // -------------------------------------------------------------------------
  private buildTitleText(): void {
    const cx = this.W / 2
    const titleY = this.H * 0.30

    // 标题：core 是白色实字 + 深色描边，发光靠低透明副本（不用 ADD 混合）
    const glow = this.center(cx, titleY, '深 海 回 响', 76, TXT.cyan)
    glow.enableOutline = true
    glow.outlineColor = col(parseInt(TXT.cyan.slice(1), 16))
    glow.outlineWidth = 10
    glow.isBold = true
    glow.node.setScale(1.04, 1.04, 1)
    this.opacityOf(glow.node).opacity = Math.round(0.32 * 255)

    const title = this.center(cx, titleY, '深 海 回 响', 76, '#eafcff')
    title.enableOutline = true
    title.outlineColor = col(0x040810)
    title.outlineWidth = 7
    title.isBold = true

    this.center(cx, titleY + 58, 'D  E  E  P     S  E  A     E  C  H  O', 17, TXT.cyan)
    this.center(cx, titleY + 98, '在光到不了的地方，沉下去', 20, TXT.dim)

    // 标题两侧的霓虹装饰线
    neonLine(this.gDeco, cx - 300, titleY - 62, cx + 300, titleY - 62, UI.cyan,
      { width: 1, alpha: 0.55, bloom: false })
    neonLine(this.gDeco, cx - 300, titleY + 124, cx + 300, titleY + 124, UI.cyan,
      { width: 1, alpha: 0.55, bloom: false })
    neonCircle(this.gDeco, cx - 300, titleY - 62, 3, UI.cyanHi, { width: 1.5, bloom: false })
    neonCircle(this.gDeco, cx + 300, titleY - 62, 3, UI.cyanHi, { width: 1.5, bloom: false })
  }

  // -------------------------------------------------------------------------
  // 潜航器三选一
  // -------------------------------------------------------------------------
  /**
   * 三台潜航器（计划书 §5.3）：**机制差异，不是数值差异**，每台都带一条同轴代价，
   * 否则玩家永远只选"最强的那个"。
   *
   * 卡面布局 = **左立绘 + 右信息**。立绘用的是**战斗内同一张机体贴图** ——
   * 选的时候看到的就是待会要操控的那一艘，不会卡面一个样、进游戏另一个样。
   * 立绘按**圆盘半径**缩放（不是按整体贴图），否则三台会因突出件不同而大小不一
   * （刺鳐的撞角 + 鳍把画布撑大，圆盘看起来只有一半）。
   */
  private buildCards(): void {
    const cyy = this.cardTop()
    const tx = ART_LEFT + ART_BOX + 12
    const cx0 = this.W / 2 - (CW * 3 + CGAP * 2) / 2

    for (let i = 0; i < SUBS.length; i++) {
      const s = SUBS[i]
      const x = cx0 + i * (CW + CGAP)
      const labels: Label[] = []
      labels.push(this.text(x + tx, cyy + 14, `${i + 1}`, 13, TXT.dim))
      labels.push(this.text(x + tx + 22, cyy + 8, s.name, 20, '#eafcff'))
      labels.push(this.text(x + CW - 14, cyy + 16, s.en, 11, TXT.dim, true))
      labels.push(this.text(x + tx, cyy + 38, s.tag, 11, TXT.main))
      this.subFeatLines(s).forEach((f, k) => {
        labels.push(this.text(x + tx, cyy + 58 + k * 16, f.t, 12, f.c))
      })

      const art = this.mk('subArt', this.root).addComponent(Sprite)
      art.trim = false                                   // 保留透明边，圆盘缩放才准
      art.sizeMode = Sprite.SizeMode.CUSTOM              // 尺寸由贴图原始尺寸显式给
      art.node.setPosition(x + ART_LEFT + ART_BOX / 2, this.H - (cyy + ART_TOP + ART_BOX / 2))
      art.node.active = false                            // 美术没同步时隐藏，别留一个白方块

      // 命中区：与 Hud 的按钮同一套已验证模式（判定矩形来自节点的 UITransform）
      const hit = this.mk('cardHit', this.root)
      const hut = hit.addComponent(UITransform)
      hut.setAnchorPoint(0.5, 0.5)
      hut.setContentSize(CW, CHH)
      hit.setPosition(x + CW / 2, this.H - (cyy + CHH / 2))
      // 悬停即选中（web 的 onHover 也是选中）—— 手感上"鼠标扫过去就是在挑"
      hit.on(Node.EventType.MOUSE_ENTER, () => { if (!this.modal) this.select(i) })
      hit.on(Node.EventType.TOUCH_END, () => { if (!this.modal) this.select(i) })

      this.cards.push({ art, labels, x })
    }
  }

  /**
   * 卡片顶边的 sim y。
   * web 的纵向预算（H=749 实测）：装饰线 349 → 卡顶 358 → 卡底 482 → 主按钮顶 491，
   * 所以卡片**不能**再往下挪 —— 挪了就压到"开始下潜"。
   */
  private cardTop(): number {
    return this.H * 0.70 - 166
  }

  /** 把潜航器特性转成卡片文本行（**收益绿、代价橙** —— 代价不能藏起来） */
  private subFeatLines(s: SubDef): Array<{ t: string; c: string }> {
    const out: Array<{ t: string; c: string }> = []
    const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
    if (s.o2Max) out.push({ t: `氧气上限 ${s.o2Max > 0 ? '+' : ''}${s.o2Max}`, c: s.o2Max > 0 ? TXT.jade : TXT.warn })
    if (s.speed) out.push({ t: `移速 ${pct(s.speed)}`, c: TXT.jade })
    if (s.dmgMul !== 1) out.push({ t: `伤害 ${pct(s.dmgMul - 1)}`, c: s.dmgMul > 1 ? TXT.jade : TXT.warn })
    if (s.pickup) out.push({ t: `吸附 ${pct(s.pickup)}`, c: s.pickup > 0 ? TXT.jade : TXT.warn })
    if (s.slots !== 4) out.push({ t: `装备槽 ${s.slots}`, c: TXT.jade })
    if (s.killO2Mul !== 1) out.push({ t: `击杀回氧 ×${s.killO2Mul}`, c: TXT.jade })
    if (s.ram) out.push({ t: `撞击伤害 ${s.ram}`, c: TXT.jade })
    // 卡面文字列净宽只有约 120px，四行会顶到卡片下缘，压到 3 行
    return out.slice(0, 3)
  }

  // -------------------------------------------------------------------------
  // 按钮 / 提示
  // -------------------------------------------------------------------------
  private buildButtons(): void {
    const cx = this.W / 2
    const by = this.H * 0.70
    this.makeButton(cx, by, '开 始 下 潜', true, () => this.confirm())
    this.makeButton(cx, by + 78, '装 置 坞', false, () => this.showDock())
  }

  private buildHints(): void {
    const cx = this.W / 2
    this.center(cx, this.H - 28, 'Enter 开始下潜　·　1/2/3 或 ←→ 选潜航器', 15, TXT.mute)
    // 纪录行。web 侧没有这一行 —— 放**顶部**是因为纵向布局已经排满
    // （副标题 322 / 装饰线 349 / 卡顶 358 之间没有空档），而 0–180 整条是空的。
    this.recordsLabel = this.center(cx, 38, '尚无下潜记录', 14, TXT.mute)
  }

  /** 版本角标：一眼确认"跑的是哪个版本、适配成了多大"（本项目反复吃过的亏） */
  private updateFooter(): void {
    const s = `${BUILD_TAG} · ${Math.round(this.viewW)}×${Math.round(this.viewH)}`
    if (s === this.footer) return
    this.footer = s
    if (!this.footerLabel) {
      this.footerLabel = this.text(this.W - 12, this.H - 8, s, 13, TXT.mute, true)
      this.opacityOf(this.footerLabel.node).opacity = Math.round(0.75 * 255)
    } else {
      this.footerLabel.string = s
    }
  }

  /**
   * 霓虹按钮：近黑底 + 青描边 + 外侧 halo。
   * 不用"实心青填充"——大面积高饱和会把标题压下去，也不符合 U 艇仪表的调性。
   */
  private makeButton(cx: number, cy: number, s: string, primary: boolean, onTap: () => void): void {
    const w = primary ? 300 : 200
    const h = primary ? 66 : 48
    const n = this.mk('tbtn', this.root)
    const ut = n.addComponent(UITransform)
    ut.setAnchorPoint(0.5, 0.5)
    ut.setContentSize(w, h)
    n.setPosition(cx, this.H - cy)
    const gfx = new Gfx(n.addComponent(Graphics), 0)
    const l = this.mk('tbtnLabel', n).addComponent(Label)
    l.string = s
    l.fontSize = primary ? 28 : 20
    l.lineHeight = (primary ? 28 : 20) + 2
    l.horizontalAlign = Label.HorizontalAlign.CENTER
    l.verticalAlign = Label.VerticalAlign.CENTER
    l.isBold = true
    l.enableOutline = true
    l.outlineColor = col(0x040810)
    l.outlineWidth = primary ? 3 : 2

    const b: Btn = { gfx, label: l, w, h, primary, hover: false, onTap }
    n.on(Node.EventType.TOUCH_END, () => { if (!this.modal) b.onTap() })
    n.on(Node.EventType.MOUSE_ENTER, () => { if (this.modal) return; b.hover = true; this.drawButton(b) })
    n.on(Node.EventType.MOUSE_LEAVE, () => { b.hover = false; this.drawButton(b) })
    this.btns.push(b)
    this.drawButton(b)
  }

  private drawButton(b: Btn): void {
    const g = b.gfx
    const accent = b.primary ? UI.cyan : UI.cyanDim
    const hw = b.w / 2
    const hh = b.h / 2
    g.clear()
    if (b.hover) {
      // 外发光用多层描边（不用 ADD 混合）
      g.line(accent, 0.10, 3); g.strokeRoundRect(-hw - 6, -hh - 6, b.w + 12, b.h + 12, 14)
      g.line(accent, 0.28, 2); g.strokeRoundRect(-hw - 3, -hh - 3, b.w + 6, b.h + 6, 13)
    }
    g.fill(b.hover ? UI.panelHi : UI.panel, 0.94)
    g.fillRoundRect(-hw, -hh, b.w, b.h, 11)
    g.line(b.hover ? UI.cyanHi : accent, b.hover ? 1 : 0.85, b.hover ? 2 : 1.5)
    g.strokeRoundRect(-hw, -hh, b.w, b.h, 11)
    // 左上角的高光短线（玻璃反光暗示）
    g.line(UI.cyanHi, b.hover ? 0.5 : 0.28, 2)
    g.strokeSeg(-hw + 10, -hh + 5, -hw + 10 + b.w * 0.28, -hh + 5)
    b.label.node.setScale(b.hover ? 1.035 : 1, b.hover ? 1.035 : 1, 1)
    b.label.color = col(b.hover ? 0xffffff : parseInt((b.primary ? TXT.cyber : TXT.main).slice(1), 16))
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------
  /** 选中态重画：卡体整体重绘 + 文字/立绘只改透明度（不重建任何对象） */
  private select(i: number): void {
    if (i < 0 || i >= SUBS.length) return
    this.sel = i
    const cyy = this.cardTop()
    const g = this.gCards
    g.clear()
    for (let k = 0; k < SUBS.length; k++) {
      const s = SUBS[k]
      const x = this.cards[k].x
      const y = cyy
      const on = k === this.sel
      // 卡体：选中 = 主题色粗描边 + 提亮底；未选中 = 暗底细边
      g.fill(on ? UI.panelHi : UI.panel, on ? 0.95 : 0.68)
      g.fillRoundRect(x, y, CW, CHH, 12)
      neon(g, on ? s.color : UI.line, () => { g.roundRect(x, y, CW, CHH, 12); g.stroke() },
        { width: on ? 2.4 : 1.4, alpha: on ? 1 : 0.5, bloom: on })
      // 左侧主题竖条（和商店卡同一套"物品卡"语汇）
      g.fill(s.color, on ? 1 : 0.45)
      g.fillRoundRect(x + 2, y + 14, 4, CHH - 28, 2)
      // 选中角标：右上角一个小三角
      if (on) {
        g.fill(s.color, 0.85)
        g.moveTo(x + CW - 24, y + 1)
        g.lineTo(x + CW - 1, y + 1)
        g.lineTo(x + CW - 1, y + 24)
        g.close()
        g.fillPath()
      }
      // 立绘框：深底 + 主题色描边 + 底部反光，让机体看起来是"摆在台面上"
      const ax = x + ART_LEFT
      const ay = y + ART_TOP
      g.fill(UI.abyss, 0.55)
      g.fillRoundRect(ax, ay, ART_BOX, ART_BOX, 10)
      g.fill(s.color, on ? 0.12 : 0.06)
      g.fillRoundRect(ax, ay, ART_BOX, ART_BOX, 10)
      neon(g, s.color, () => { g.roundRect(ax, ay, ART_BOX, ART_BOX, 10); g.stroke() },
        { width: 1.2, alpha: on ? 0.7 : 0.35, bloom: false })
      g.fill(s.color, on ? 0.18 : 0.09)
      g.ellipse(ax + ART_BOX / 2, ay + ART_BOX - 12, (ART_BOX * 0.5) / 2, 5)
      g.fillPath()

      for (const l of this.cards[k].labels) {
        this.opacityOf(l.node).opacity = Math.round((on ? 1 : 0.55) * 255)
      }
      this.opacityOf(this.cards[k].art.node).opacity = Math.round((on ? 1 : 0.5) * 255)
    }
  }

  /** 循环切换（← →） */
  move(d: number): void {
    this.select((this.sel + d + SUBS.length) % SUBS.length)
  }

  /** Enter / 点"开始下潜" */
  confirm(): void {
    if (this.modal) return
    this.cb.onStart(SUBS[this.sel].id)
  }

  /** 数字直选（1/2/3） */
  pick(i: number): void {
    this.select(i)
  }

  setVisible(v: boolean): void {
    this.root.active = v
  }

  get selection(): number {
    return this.sel
  }

  /** 战绩文案（DiveGame 在开局前 / 回标题时写入） */
  setRecords(label: string, hasRuns: boolean): void {
    if (!this.recordsLabel) return
    this.recordsLabel.string = label
    // 没跑过时它是"说明"而不是"战绩"，用弱一档的颜色，别让人以为那是纪录
    this.recordsLabel.color = col(parseInt((hasRuns ? TXT.main : TXT.mute).slice(1), 16))
  }

  /** 装置坞占位面板 —— 港口与装置升级树还没做，这里只说明"还没接入"，不假装有内容。 */
  private showDock(): void {
    if (this.modal) return
    const m = this.mk('dockModal', this.root)
    const pw = 440
    const ph = 240
    m.setPosition(this.W / 2, this.H / 2)

    const g = new Gfx(this.mk('dockBg', m).addComponent(Graphics), 0)
    g.fill(UI.abyss, 0.94)
    g.fillRoundRect(-pw / 2, -ph / 2, pw, ph, 14)
    g.line(UI.cyan, 0.9, 1.5)
    g.strokeRoundRect(-pw / 2, -ph / 2, pw, ph, 14)
    g.line(UI.cyan, 0.10, 3)
    g.strokeRoundRect(-pw / 2 - 3, -ph / 2 - 3, pw + 6, ph + 6, 16)

    const line = (y: number, s: string, size: number, color: string) => {
      const l = this.mk('dockText', m).addComponent(Label)
      l.string = s
      l.fontSize = size
      l.lineHeight = size + 2
      l.color = col(parseInt(color.slice(1), 16))
      l.horizontalAlign = Label.HorizontalAlign.CENTER
      l.verticalAlign = Label.VerticalAlign.CENTER
      l.node.setPosition(0, y)
    }
    line(ph / 2 - 38, '装 置 坞', 27, TXT.cyber)
    line(6, '尚未接入：港口与装置升级树还没做', 16, TXT.dim)
    line(38, `当前潜航器：${SUBS[this.sel].name}　·　装备槽 ${SUBS[this.sel].slots}`, 15, TXT.mute)
    line(-ph / 2 + 28, '点击任意处关闭', 14, TXT.mute)

    // 全屏关闭区：盖住整块画布（含外扩），否则弹窗两侧点不动
    const hit = this.mk('dockHit', this.root)
    const ut = hit.addComponent(UITransform)
    ut.setAnchorPoint(0, 0)
    ut.setContentSize(this.W + this.padW * 2, this.H + this.padH * 2)
    hit.setPosition(-this.W / 2 - this.padW, -this.H / 2 - this.padH)
    hit.on(Node.EventType.TOUCH_END, () => {
      m.destroy()
      this.modal = null
    })
    this.modal = m
  }

  // -------------------------------------------------------------------------
  // 每帧
  // -------------------------------------------------------------------------
  update(dt: number): void {
    if (!this.root.active) return
    this.t += dt
    this.layout(false)

    // 探照灯摇曳：整体透明度低频正弦 + 轻微横移，像水面透下来的光在动
    this.coneOpacity.opacity = Math.round(255 * Math.min(1, Math.max(0, 0.72 + 0.28 * Math.sin(this.t * 0.5))))
    this.coneNode.setPosition(Math.sin(this.t * 0.28) * 14, 0)

    // 水母：缓慢上浮，飘出顶部就回到底部随机横位
    for (const j of this.jellies) {
      const p = j.node.position
      // web 里 vy 为负 = 向上；Cocos 的 y 轴向上，所以这里取负号
      const ny = p.y - j.vy * dt
      if (ny > this.H + 120) {
        j.node.setPosition(70 + Math.random() * Math.max(20, this.W - 140), -120)
      } else {
        j.node.setPosition(p.x + Math.sin(this.t * 0.6 + j.t) * j.sway * 0.02, ny)
      }
    }

    // 扫描线：整层平移，移过一个周期就跳回
    this.scanNode.setPosition(0, (this.t * 9) % scanSpan(this.H))

    // 浮游微粒
    if (this.motes.length === 0) {
      for (let i = 0; i < 40; i++) {
        this.motes.push({
          x: Math.random() * this.W,
          y: Math.random() * this.H,
          r: 0.8 + Math.random() * 1.4,
          vy: -3 - Math.random() * 10,
        })
      }
    }
    this.gMotes.clear()
    for (const m of this.motes) {
      m.y += m.vy * dt
      if (m.y < -4) { m.y = this.H + 4; m.x = Math.random() * this.W }
      this.gMotes.fill(0xffffff, 0.35)
      this.gMotes.fillCircle(m.x, m.y, m.r)
    }

    this.syncCardArt()
    this.updateFooter()
  }

  /** 立绘异步到达：拿到图就换上（标题会在开局前一直显示，所以每帧对一次即可） */
  private syncCardArt(): void {
    for (let i = 0; i < this.cards.length; i++) {
      const art = this.cards[i].art
      if (art.node.active) continue
      const sf = this.art.get('sub_' + SUBS[i].id) ?? this.art.get('sub_body')
      if (!sf) continue
      art.spriteFrame = sf
      art.node.getComponent(UITransform)!.setContentSize(sf.rect.width, sf.rect.height)
      const k = DISC_IN_CARD / (2 * SUB_ART_R)
      art.node.setScale(k, k, 1)
      art.node.active = true
    }
  }
}
