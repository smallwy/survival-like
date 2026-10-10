import Phaser from 'phaser'
import { UI, TXT, FONT } from '../config/theme'
import { registerUiHit } from '../ui/hitRouter'
import {
  verticalBands, glowPool, lightCone, neonCircle, neonLine, neonPoly
} from '../render/neon'

/**
 * 主界面 —— 赛博霓虹深海（V4）
 *
 * 为什么单独做一个 Scene 而不是塞进主玩法的准备阶段：
 *   1) 主界面有**持续动画的背景**（探照灯摇曳、水母漂浮、浮游粒子、扫描线），
 *      而菜单是静态面板。塞进主 Scene 会让这套动画整局常驻吃 CPU；
 *      独立 Scene 在切走后自动 stop。
 *   2) 主界面是"玩家看到的第一眼"，它的清晰度问题独立隔离便于单独调。
 *
 * 视觉参照：`spec/shots/Video_game_title_screen_concep_*.png`
 *   - 近黑蓝的整体底色（#04070d 一路到更深）
 *   - 一艘小潜航器悬在中上，**探照灯锥向下劈开黑暗**（画面唯一光源）
 *   - 陡峭的深渊峡谷岩壁，只用霓虹轮廓线表达
 *   - 几只自发光水母，色相避开 UI 青蓝
 *   - 全屏扫描线 / 舱窗网格（α ≤ .06，只做暗示）
 *
 * **所有图形 100% 运行时几何绘制**（无 png、无图集）：
 * 这是"不糊"的根本保证——矢量在任何 DPR 下都锐利，不存在像素对齐问题。
 *
 * **Canvas 降级**：不使用 setBlendMode(ADD) / fillGradientStyle()，两者都是
 * WebGL-only，在无头验证环境（Canvas 渲染器）下会画出实心色块。
 */
export class TitleScene extends Phaser.Scene {
  private jellies: { c: Phaser.GameObjects.Container; vy: number; sway: number; t: number }[] = []
  private beams: { g: Phaser.GameObjects.Graphics; t: number }[] = []
  private scanG!: Phaser.GameObjects.Graphics
  private t = 0

  constructor() { super('title') }

  create() {
    const W = this.scale.width
    const H = this.scale.height

    this.buildBackdrop(W, H)
    this.buildCanyon(W, H)
    this.buildLightCone(W, H)
    this.buildJellies(W, H)
    this.buildMotes(W, H)
    this.buildGridAndScan(W, H)
    this.buildForegroundUI(W, H)

    this.scale.on('resize', () => this.scene.restart())
    this.input.keyboard?.on('keydown-ENTER', () => this.startDive())
  }

  // ------------------------------------------------------------ 深渊底色
  private buildBackdrop(W: number, H: number) {
    // 不用 fillGradientStyle（WebGL-only，Canvas 下会填成单色）。
    // 改用 48 条纯色横带模拟竖向渐变，密度足够就看不出台阶。
    const g = this.add.graphics()
    verticalBands(g, 0, 0, W, H, [
      [0.00, 0x071826],   // 顶部：远处的微光还将亮未亮
      [0.30, 0x0a2233],
      [0.58, 0x061019],   // 中：光开始被吞
      [1.00, 0x02050a],   // 底：纯粹的黑
    ], 56)

    // 中央的柔和高光：多圈低透明椭圆叠加，单圈大圆会有明显边界。
    // 不用 ADD 混合——Canvas 渲染器下无效。
    const halo = this.add.graphics()
    glowPool(halo, W * 0.5, H * 0.26, W * 0.95, H * 0.62, UI.cyanDim, 7, 0.028)
    halo.fillStyle(UI.cyan, 0.05)
    halo.fillEllipse(W * 0.5, H * 0.2, W * 0.55, H * 0.3)
  }

  // ------------------------------------------------------------ 峡谷岩壁
  /**
   * 峡谷：两侧向内收拢的岩壁，**只有霓虹轮廓线**，内部用近黑填充挡住背景。
   * 轮廓越往下越暗（深渊里连岩石也不反光），这是深度感最省成本的做法。
   */
  private buildCanyon(W: number, H: number) {
    const g = this.add.graphics()

    const wall = (xFrom: number, dir: number, amp: number, seed: number) => {
      const pts: number[] = []
      const steps = 34
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const y = t * H
        // 越往下越向画面中间侵入（人字形收拢）
        const inset = Math.pow(t, 1.35) * W * 0.26
        const jag = Math.sin(t * 9 + seed) * amp + Math.sin(t * 21 + seed * 2) * amp * 0.45
        pts.push(xFrom + dir * (inset + jag), y)
      }
      // 闭合到画布外侧
      pts.push(xFrom + dir * W, H)
      pts.push(xFrom + dir * W, 0)
      neonPoly(g, pts, UI.rock, { fill: true, fillAlpha: 0.95, bloom: false })
      neonPoly(g, pts, UI.line, { width: 1.5, alpha: 0.85, bloom: false })
    }

    wall(0, 1, 26, 0.7)       // 左壁
    wall(W, -1, 30, 2.3)      // 右壁
  }

  // ------------------------------------------------------------ 探照灯锥
  /** 画面唯一的"人造光源"：从上方潜航器位置向下劈出的宽光锥。 */
  private buildLightCone(W: number, H: number) {
    const cx = W * 0.5
    const g = this.add.graphics()
    lightCone(g, cx, H * 0.10, H * 1.02, W * 0.05, W * 0.52, UI.cyanHi, 30, 0.085)
    this.beams.push({ g, t: 0 })
  }

  // ------------------------------------------------------------ 发光水母
  /**
   * 水母用「伞」的几何签名 + 专属发光色。
   * 色相刻意避开 UI 青蓝：jade / magenta / violet / amber 都可以，独独不能有青蓝，
   * 否则玩家会把它读成 HUD 元素（详见《UI规格》§2.3 色相隔离）。
   */
  private buildJellies(W: number, H: number) {
    const specs = [
      { x: 0.18, y: 0.60, s: 1.0, col: UI.violet },
      { x: 0.84, y: 0.48, s: 1.35, col: UI.magenta },
      { x: 0.64, y: 0.80, s: 0.78, col: UI.jade },
      { x: 0.33, y: 0.30, s: 0.66, col: UI.magenta },
      { x: 0.92, y: 0.22, s: 0.58, col: UI.jade },
    ]
    for (const sp of specs) {
      const c = this.add.container(W * sp.x, H * sp.y)
      this.drawJelly(c, sp.s, sp.col)
      c.setAlpha(0.72)
      this.jellies.push({ c, vy: -6 * sp.s, sway: 14 * sp.s, t: Math.random() * 6.28 })
    }
  }

  /**
   * 画一只水母 = 几何签名「伞」。
   * 三段式：外发光多层 → 伞盖实体 → 白色内核（core，清晰感的来源）→ 触须。
   */
  private drawJelly(c: Phaser.GameObjects.Container, s: number, col: number) {
    const R = 42 * s

    const bell = this.add.graphics()
    // 外发光：多层低透明大圈（代替 Canvas 不支持的 ADD）
    for (let i = 4; i >= 1; i--) {
      bell.fillStyle(col, 0.055)
      bell.fillCircle(0, 0, R + i * 8)
    }
    bell.fillStyle(col, 0.42)
    bell.fillEllipse(0, 0, R * 1.7, R * 1.35)
    c.add(bell)

    // 伞盖轮廓：core 层的 1.5px 实色边
    const edge = this.add.graphics()
    neonPoly(edge, this.arcPts(0, 0, R * 0.85, R * 0.68, Math.PI, Math.PI * 2, 20),
      col, { width: 1.5, bloom: false })
    c.add(edge)

    // 内核（core）：100% 实色的高亮，让水母"实"起来而不是一团光
    const core = this.add.graphics()
    core.fillStyle(0xffffff, 0.82)
    core.fillEllipse(0, -R * 0.16, R * 0.62, R * 0.44)
    c.add(core)

    // 触须：4 条随水流摆动的折线
    const tent = this.add.graphics()
    tent.lineStyle(2.2 * s, col, 0.6)
    for (let k = 0; k < 4; k++) {
      const x0 = (-1.5 + k) * R * 0.32
      tent.beginPath()
      tent.moveTo(x0, R * 0.5)
      tent.lineTo(x0 * 1.25, R * 0.5 + R * 0.9)
      tent.lineTo(x0 * 1.6, R * 0.5 + R * 1.75)
      tent.strokePath()
    }
    c.add(tent)
  }

  /** 生成一段椭圆弧的顶点序列 */
  private arcPts(cx: number, cy: number, rw: number, rh: number,
                 a0: number, a1: number, seg: number): number[] {
    const out: number[] = []
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg)
      out.push(cx + Math.cos(a) * rw, cy + Math.sin(a) * rh)
    }
    return out
  }

  // ------------------------------------------------------------ 浮游微粒
  private buildMotes(W: number, H: number) {
    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillCircle(2, 2, 2)
    g.generateTexture('title_mote', 4, 4)
    g.destroy()
    this.add.particles(0, 0, 'title_mote', {
      x: { min: 0, max: W },
      y: { min: 0, max: H },
      lifespan: 9000,
      speedY: { min: -13, max: -3 },
      speedX: { min: -5, max: 5 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.5, end: 0 },
      quantity: 1,
      frequency: 200,
      tint: [UI.cyan, UI.jadeHi, 0xffffff]
      // 不设 blendMode: ADD —— Canvas 渲染器下会渲染成白色方块。
    })
  }

  // --------------------------------------------------- 舱窗网格 + 扫描线
  /**
   * α 全部 ≤ .06：这一层的作用是**暗示隔着一层玻璃**，而不是真的显示网格。
   * 强度一高就会把画面搅浑——这也是"看起来糊"的常见成因之一。
   */
  private buildGridAndScan(W: number, H: number) {
    const g = this.add.graphics()
    g.lineStyle(1, UI.cyanDim, 0.035)
    for (let x = 0; x <= W; x += 64) g.strokeLineShape(new Phaser.Geom.Line(x, 0, x, H))
    for (let y = 0; y <= H; y += 64) g.strokeLineShape(new Phaser.Geom.Line(0, y, W, y))
    // 四角框：舱窗的感觉
    g.lineStyle(1, UI.cyan, 0.10)
    const m = 18, len = 46
    for (const [sx, sy, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      g.strokeLineShape(new Phaser.Geom.Line(sx, sy, sx + dx * len, sy))
      g.strokeLineShape(new Phaser.Geom.Line(sx, sy, sx, sy + dy * len))
    }
    g.setDepth(50)

    // 扫描线单独一层，update 里缓慢上移
    this.scanG = this.add.graphics()
    this.scanG.lineStyle(1, UI.cyan, 0.030)
    for (let y = 0; y < H + 8; y += 4) {
      this.scanG.strokeLineShape(new Phaser.Geom.Line(0, y, W, y))
    }
    this.scanG.setDepth(51)
  }

  // ------------------------------------------------------------ 前景 UI
  private buildForegroundUI(W: number, H: number) {
    const cx = W / 2
    const titleY = H * 0.30

    // 标题：core 是白色实字 + 深色描边，发光靠低透明副本（不用 ADD）
    const glow = this.add.text(cx, titleY, '深 海 回 响', {
      fontFamily: FONT, fontSize: '76px', color: TXT.cyan, fontStyle: 'bold'
    }).setOrigin(0.5).setAlpha(0.32).setScale(1.04)
    glow.setStroke(TXT.cyan, 10)

    const title = this.add.text(cx, titleY, '深 海 回 响', {
      fontFamily: FONT, fontSize: '76px', color: '#eafcff', fontStyle: 'bold'
    }).setOrigin(0.5)
    title.setStroke('#040810', 7)

    this.add.text(cx, titleY + 58, 'D  E  E  P     S  E  A     E  C  H  O', {
      fontFamily: FONT, fontSize: '17px', color: TXT.cyan
    }).setOrigin(0.5).setAlpha(0.88)

    this.add.text(cx, titleY + 98, '在光到不了的地方，沉下去', {
      fontFamily: FONT, fontSize: '20px', color: TXT.dim
    }).setOrigin(0.5)

    // 标题两侧的霓虹装饰线
    const deco = this.add.graphics()
    neonLine(deco, cx - 300, titleY - 62, cx + 300, titleY - 62, UI.cyan, { width: 1, alpha: 0.55, bloom: false })
    neonLine(deco, cx - 300, titleY + 124, cx + 300, titleY + 124, UI.cyan, { width: 1, alpha: 0.55, bloom: false })
    neonCircle(deco, cx - 300, titleY - 62, 3, UI.cyanHi, { width: 1.5, bloom: false })
    neonCircle(deco, cx + 300, titleY - 62, 3, UI.cyanHi, { width: 1.5, bloom: false })

    const btnY = H * 0.70
    this.makeNeonButton(cx, btnY, '开 始 下 潜', true, () => this.startDive())
    this.makeNeonButton(cx, btnY + 78, '装 置 坞', false, () => this.showSettings())

    this.add.text(cx, H - 28, 'Enter 开始下潜', {
      fontFamily: FONT, fontSize: '15px', color: TXT.mute
    }).setOrigin(0.5)

    void glow
  }

  /**
   * 霓虹按钮：近黑底 + 青描边 + 外侧 halo。
   * 不用"实心青填充"——大面积高饱和会把标题压下去，而且不符合 U艇仪表调性。
   */
  private makeNeonButton(cx: number, cy: number, text: string, primary: boolean,
                         onClick: () => void) {
    const w = primary ? 300 : 200
    const h = primary ? 66 : 48
    const c = this.add.container(cx, cy)

    const draw = (hover: boolean) => {
      const face = c.getAt(0) as Phaser.GameObjects.Graphics
      face.clear()
      const accent = primary ? UI.cyan : UI.cyanDim
      // 外发光（多层描边，不用 ADD）
      if (hover) {
        face.lineStyle(3, accent, 0.10)
        face.strokeRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 14)
        face.lineStyle(2, accent, 0.28)
        face.strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 13)
      }
      face.fillStyle(hover ? UI.panelHi : UI.panel, 0.94)
      face.fillRoundedRect(-w / 2, -h / 2, w, h, 11)
      face.lineStyle(hover ? 2 : 1.5, hover ? UI.cyanHi : accent, hover ? 1 : 0.85)
      face.strokeRoundedRect(-w / 2, -h / 2, w, h, 11)
      // 左上角的高光短线（玻璃反光暗示）
      face.lineStyle(2, UI.cyanHi, hover ? 0.5 : 0.28)
      face.strokeLineShape(new Phaser.Geom.Line(-w / 2 + 10, -h / 2 + 5, -w / 2 + 10 + w * 0.28, -h / 2 + 5))
    }

    const face = this.add.graphics()
    c.add(face)
    draw(false)

    const t = this.add.text(0, 0, text, {
      fontFamily: FONT,
      fontSize: primary ? '28px' : '20px',
      color: primary ? TXT.cyber : TXT.main,
      fontStyle: 'bold'
    }).setOrigin(0.5)
    t.setStroke('#040810', primary ? 3 : 2)
    c.add(t)

    const hit = this.add.rectangle(0, 0, w, h, 0xffffff, 0.001)
    registerUiHit(this, {
      obj: hit, w, h,
      onClick,
      onHover: (v) => {
        c.setScale(v ? 1.035 : 1)
        draw(v)
        t.setColor(v ? '#ffffff' : (primary ? TXT.cyber : TXT.main))
      },
      alive: () => !!hit.scene
    })
    c.add(hit)
    return c
  }

  /** 装置坞占位 —— PortScene 落地后替换为真实界面 */
  private showSettings() {
    if ((this as unknown as { _panel?: Phaser.GameObjects.Container })._panel) return
    const W = this.scale.width
    const H = this.scale.height
    const p = this.add.container(W / 2, H / 2).setDepth(60)
    const pw = 440, ph = 240

    const bg = this.add.graphics()
    bg.fillStyle(UI.abyss, 0.94).fillRoundedRect(-pw / 2, -ph / 2, pw, ph, 14)
    bg.lineStyle(1.5, UI.cyan, 0.9).strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, 14)
    bg.lineStyle(3, UI.cyan, 0.10).strokeRoundedRect(-pw / 2 - 3, -ph / 2 - 3, pw + 6, ph + 6, 16)
    p.add(bg)

    p.add(this.add.text(0, -ph / 2 + 38, '装 置 坞', {
      fontFamily: FONT, fontSize: '27px', color: TXT.cyber, fontStyle: 'bold'
    }).setOrigin(0.5).setStroke('#040810', 3))

    p.add(this.add.text(0, 6, '尚未接入：港口与装置升级树在 S4 阶段落地', {
      fontFamily: FONT, fontSize: '16px', color: TXT.dim
    }).setOrigin(0.5))

    p.add(this.add.text(0, 38, '当前潜航器：型号 I　·　电量 100　·　货舱 6', {
      fontFamily: FONT, fontSize: '15px', color: TXT.mute
    }).setOrigin(0.5))

    p.add(this.add.text(0, ph / 2 - 28, '点击任意处关闭', {
      fontFamily: FONT, fontSize: '14px', color: TXT.mute
    }).setOrigin(0.5))

    const hit = this.add.rectangle(0, 0, W, H, 0xffffff, 0.001)
    registerUiHit(this, {
      obj: hit, w: W, h: H,
      onClick: () => {
        p.destroy(); hit.destroy()
        delete (this as unknown as { _panel?: unknown })._panel
      },
      alive: () => !!p.scene
    })
    p.add(hit)
    ;(this as unknown as { _panel?: Phaser.GameObjects.Container })._panel = p
  }

  private startDive() {
    this.scene.start('game')
  }

  update(_time: number, delta: number) {
    this.t += delta / 1000
    const W = this.scale.width
    const H = this.scale.height

    for (const j of this.jellies) {
      j.c.y += j.vy * delta / 1000
      j.c.x += Math.sin(this.t * 0.6 + j.t) * j.sway * 0.02
      if (j.c.y < -120) {
        j.c.y = H + 120
        j.c.x = Phaser.Math.Between(70, Math.max(90, W - 70))
      }
    }

    // 探照灯摇曳：整体透明度低频正弦 + 轻微横移，像水面透下来的光在动
    for (const b of this.beams) {
      b.g.setAlpha(0.72 + 0.28 * Math.sin(this.t * 0.5))
      b.g.x = Math.sin(this.t * 0.28) * 14
    }

    // 扫描线缓慢上移，移过一个周期就跳回
    if (this.scanG) {
      const span = 4 * Math.ceil(H / 4) + 8
      this.scanG.y = -((this.t * 9) % span) + span - H - 8
    }
  }
}
