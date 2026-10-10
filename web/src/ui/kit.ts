/**
 * 玩具纸盒 UI 组件库
 *
 * 为什么要有这个文件
 * ----------------
 * 之前五个界面（选关 / 点将 / 商店 / 升级 / 结算）各自 `add.rectangle` + `uiText`
 * 手搓一套样式 —— 五套实现 = 五套不一致：字号从 10 到 27 无规律跳、描边 1/2/3 混用、
 * 卡片同色同框看不出主次、点下去没有任何反馈。这是"界面粗糙"的真正来源，
 * 不是配色问题。
 *
 * 这里把「纸盒」这套语言一次定死，五个界面全部复用：
 *
 *  形：深海仪表板（冷黑青底 + 亮字 + 细描边 + 圆角），像潜水器的控制台。
 *      战斗场地永远是暗的（深海无光层），UI 与场地同属暗色系，
 *      靠发光青描边和亮字把交互层从场地里抬起来 —— 不是靠亮底。
 *  色：深水底(board) / 抬起的面板(paper) / 标签(label) / 生物发光青(tape) / 骨质品红 / 鳞甲青绿
 *  字：六档字号（12/14/16/20/26/34），正文最低 14 —— 旧版 11px 满地跑是观感粗糙的主因
 *  反馈：hover 抬升 + 描边变亮，按下整体下沉 2px，锁定态灰化 —— 每个可点物都有反应
 *
 * 命名约定：颜色分两套（沿用 theme.ts 的约定，且这是 Phaser 最常见的隐形 bug 源）——
 *   图形色用 `PAPER.*` / `P.*`（number），文字色用 `INK.*`（'#rrggbb' 串）。混用会黑字黑底。
 */
import Phaser from 'phaser'
import { FONT } from '../config/theme'

// ---------------- 深色仪表板图形色（number） ----------------
//
// ⚠️ 换题材时踩过的坑：这一整套原来是**牛皮纸 + 深墨字**（浅底深字），
// 战斗场地换成深海深水色之后 UI 仍然是浅底 —— 结果主菜单「玩具箱」
// 和战斗内深海看起来像两个游戏。教训：**换题材必须连色板一起换**，
// 只改战斗层是不够的。现在统一成「深底亮字」，
// UI 与海床同属暗色系，靠发光青描边 + 亮字把交互层从场地上"抬"起来。
export const P = {
  /** 全屏压暗底：深海最深处 */
  board: 0x050b13,
  /** 卡片底：冷黑青板 */
  kraft: 0x0e1c28,
  /** 抬起的面板：选中卡片、弹层 */
  paper: 0x142838,
  /** 强调块：亮青面板 */
  label: 0x1d3a4e,
  /** 未选中的次级卡片 */
  kraftDim: 0x0a1620,
  /** 描边：暗青 */
  edge: 0x1f4a5e,
  /** 亮描边：生物发光青 */
  edgeHi: 0x4fe8ff,
  /** 主强调：生物发光青（原「警示黄胶带」） */
  tape: 0x4fe8ff,
  tapeDim: 0x1c6f85,
  /** 危险 / 主行动：骨质品红 */
  red: 0xff5fd0,
  redHi: 0xff8ade,
  /** 鳞甲青绿 */
  green: 0x7fffd4,
  greenHi: 0xa8ffe8,
  /** 深蓝：次要信息 */
  blue: 0x3f8fb4,
  /** 面板阴影块（模拟厚度） */
  shade: 0x030810,
  /** 图形用墨色（亮，因为底是暗的） */
  ink: 0xdff6ff,
} as const

// ---------------- 文字色（'#rrggbb'，深底浅字） ----------------
export const INK = {
  main: '#e4f6ff',
  dim: '#8fb4c4',
  mute: '#5c7f8f',
  tape: '#4fe8ff',
  red: '#ff5fd0',
  green: '#7fffd4',
  blue: '#8fd0e8',
  /** 深色底上的浅字（HUD 面板、弹层） */
  light: '#e4f6ff',
  lightDim: '#8fb4c4',
} as const

// ---------------- 字号阶梯（UI 正文最低 14） ----------------
export const FS = {
  caption: 12,
  body: 14,
  sub: 16,
  title: 20,
  head: 26,
  hero: 34,
} as const

// ---------------- 间距阶梯 ----------------
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

/**
 * 弹层版式的最大放大倍数。
 *
 * 弹层都是固定像素设计（商店 900x540、玩具箱 900x646…），窗口比它小时整体缩小。
 * 旧版用 `Math.min(1, ...)` —— 只缩不放，于是 1080p 以上的屏上界面缩在中间一小块，
 * 四周全是黑的，这就是"界面显得小气"的来源之一。
 * 现在允许适度放大，但**必须封顶**：Text 是 canvas 贴图，放大过狠会糊；
 * 像素 sprite 虽然是 NEAREST 硬边、放不糊，但放大过头会变成"大色块"。
 */
export const UI_MAX_ZOOM = 1.25

// ==========================================================================
// 基础绘制
// ==========================================================================

export interface CardOpts {
  /** 选中态：纸面更亮 + 黄胶带描边 */
  selected?: boolean
  /** 锁定态：灰化 */
  locked?: boolean
  /** 强调色（描边） */
  accent?: number
  /** 覆盖底色 */
  fill?: number
  /** 描边宽度 */
  stroke?: number
  /** 圆角 */
  radius?: number
  /** 是否画"卡片厚度"（右下方的暗色偏移） */
  thick?: boolean
}

/**
 * 牛皮纸卡片。坐标按**左上角**给（与 Phaser 的 rectangle(center) 不同，调用处注意）。
 * 「厚度」是这套语言的记忆点：偏移 3px 的暗色块让卡片像一块真的硬纸板，
 * 而不是屏幕上的一块色。
 */
export function card(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, o: CardOpts = {}
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  const r = o.radius ?? 8
  const fill = o.locked ? P.kraftDim : (o.fill ?? (o.selected ? P.paper : P.kraft))
  const edge = o.accent ?? (o.locked ? P.edge : o.selected ? P.tape : P.edge)
  const sw = o.stroke ?? (o.selected ? 3 : 2)
  if (o.thick !== false) {
    g.fillStyle(P.shade, o.locked ? 0.25 : 0.45)
    g.fillRoundedRect(x + 2, y + 3, w, h, r)
  }
  g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, r)
  g.lineStyle(sw, edge, 1).strokeRoundedRect(x, y, w, h, r)
  // 纸面高光：顶部一条浅色带，模拟纸的光泽
  g.fillStyle(0xffffff, o.locked ? 0.06 : 0.16)
  g.fillRoundedRect(x + 3, y + 3, w - 6, Math.max(4, h * 0.22), r - 2)
  return g
}

/** 一片"警示胶带"：斜条纹黄块。用于推荐/重点标记。 */
export function tapeStrip(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, color: number = P.tape
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  g.fillStyle(color, 1).fillRoundedRect(x, y, w, h, 3)
  g.lineStyle(2, P.edgeHi, 0.55).strokeRoundedRect(x, y, w, h, 3)
  return g
}

/** 深色面板（战斗 HUD 用，纸上不适用）：半透明暗底 + 细描边。 */
export function darkPanel(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  fill = 0x1d1813, alpha = 0.92, accent = 0x5c4d33
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  g.fillStyle(fill, alpha).fillRoundedRect(x, y, w, h, 8)
  g.lineStyle(1, accent, 0.9).strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, 8)
  return g
}

// ==========================================================================
// 文本
// ==========================================================================

export function label(
  scene: Phaser.Scene, x: number, y: number, s: string,
  size: number = FS.body, color: string = INK.main,
  opts: Phaser.Types.GameObjects.Text.TextStyle = {}
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, s, {
    fontFamily: FONT, fontSize: `${size}px`, color, ...opts
  })
}

// ==========================================================================
// 交互组件
// ==========================================================================

export interface BtnOpts {
  /** 主行动：塑料红底 + 白字 */
  primary?: boolean
  /** 次要行动：纸底 + 墨字 */
  ghost?: boolean
  /** 禁用 */
  disabled?: boolean
  color?: number
  /** 点击回调 */
  onClick?: () => void
  /** 副标题（可选，小字） */
  sub?: string
}

/**
 * 按钮：纸盒风格。hover 时整体上抬 2px 并加亮描边，按下时下沉回原位 ——
 * 这 2px 的位移是"手感"的全部来源，比换颜色有效得多。
 * 返回的 container 可继续 add 到别的容器里。
 */
export function button(
  scene: Phaser.Scene, cx: number, cy: number, w: number, h: number,
  text: string, o: BtnOpts = {}
): Phaser.GameObjects.Container {
  const c = scene.add.container(cx, cy)
  const base = o.disabled
    ? P.kraftDim
    : o.primary ? P.red : o.ghost ? P.kraft : P.paper
  const txtCol = o.disabled
    ? INK.mute
    : o.primary ? '#fff4ec' : INK.main
  const edge = o.disabled ? P.edge : o.primary ? P.edgeHi : P.tape

  const shadow = scene.add.graphics()
  shadow.fillStyle(P.shade, o.disabled ? 0.2 : 0.5)
  shadow.fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, 8)
  const face = scene.add.graphics()
  face.fillStyle(base, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 8)
  face.lineStyle(3, edge, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 8)
  face.fillStyle(0xffffff, o.disabled ? 0.05 : 0.18)
  face.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, Math.max(4, h * 0.3), 6)
  c.add([shadow, face])

  const t = label(scene, 0, o.sub ? -6 : 0, text,
    o.primary ? FS.title : FS.sub, txtCol, { fontStyle: 'bold' })
    .setOrigin(0.5)
  c.add(t)
  if (o.sub) {
    c.add(label(scene, 0, 14, o.sub, FS.caption,
      o.primary ? '#f6d9cf' : INK.dim).setOrigin(0.5))
  }

  if (!o.disabled) {
    const hit = scene.add.rectangle(0, 0, w, h, 0xffffff, 0.001)
    hit.setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => { c.setY(cy - 2); face.lineStyle(3, P.tape, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 8) })
    hit.on('pointerout', () => { c.setY(cy); face.lineStyle(3, edge, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 8) })
    hit.on('pointerdown', () => {
      c.setY(cy + 2)
      scene.time.delayedCall(70, () => c.setY(cy))
      if (o.onClick) o.onClick()
    })
    c.add(hit)
  }
  return c
}

/** 小标签（tag）：用于品质、克制、阵位等。 */
export function tag(
  scene: Phaser.Scene, cx: number, cy: number, text: string,
  color: number = P.tape, textColor: string = INK.main, size = FS.caption
): Phaser.GameObjects.Container {
  const c = scene.add.container(cx, cy)
  const t = label(scene, 0, 0, text, size, textColor, { fontStyle: 'bold' }).setOrigin(0.5)
  const w = Math.max(28, t.width + 14)
  const h = size + 8
  const g = scene.add.graphics()
  g.fillStyle(color, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 4)
  g.lineStyle(1.5, P.edgeHi, 0.5).strokeRoundedRect(-w / 2, -h / 2, w, h, 4)
  c.add([g, t])
  return c
}

/** 资源胶囊：材料 / 波次 等。深色底 + 浅字，用于战斗 HUD 与商店。 */
export function pill(
  scene: Phaser.Scene, cx: number, cy: number, text: string,
  color = P.tape, textColor = INK.main
): Phaser.GameObjects.Container {
  const c = scene.add.container(cx, cy)
  const t = label(scene, 0, 0, text, FS.body, textColor, { fontStyle: 'bold' }).setOrigin(0.5)
  const w = t.width + 22
  const h = 24
  const g = scene.add.graphics()
  g.fillStyle(color, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 12)
  g.lineStyle(1.5, P.edgeHi, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h, 12)
  c.add([g, t])
  return c
}

/** 进度条（生命 / 波次进度）。 */
export function statBar(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
  pct: number, color: number, bg = 0x3a3128
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  const p = Math.max(0, Math.min(1, pct))
  g.fillStyle(bg, 0.9).fillRoundedRect(x, y, w, h, h / 2)
  if (p > 0) g.fillStyle(color, 1).fillRoundedRect(x, y, Math.max(h, w * p), h, h / 2)
  g.lineStyle(1.5, P.edgeHi, 0.7).strokeRoundedRect(x, y, w, h, h / 2)
  return g
}

/** 图标槽：一个方形凹槽，用来放像素图标（武器/道具/计谋）。 */
export function iconSlot(
  scene: Phaser.Scene, cx: number, cy: number, size: number,
  color: number = P.paper, edge: number = P.edge
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  const h = size / 2
  g.fillStyle(P.edge, 0.22).fillRoundedRect(cx - h, cy - h, size, size, 6)
  g.fillStyle(color, 1).fillRoundedRect(cx - h + 2, cy - h + 2, size - 4, size - 4, 5)
  g.lineStyle(2, edge, 0.9).strokeRoundedRect(cx - h + 2, cy - h + 2, size - 4, size - 4, 5)
  return g
}

// ==========================================================================
// 版式外壳
// ==========================================================================

export interface ShellOpts {
  /** 标题 */
  title: string
  /** 副标题 */
  subtitle?: string
  /** 标题栏强调色 */
  accent?: number
}

/**
 * 弹层外壳：纸板 + 顶部标题胶带 + 内容区。
 * 返回 { g, titleY } —— titleY 是内容区起始 y（相对外壳中心的坐标）。
 */
export function shell(
  scene: Phaser.Scene, w: number, h: number, o: ShellOpts
): { bg: Phaser.GameObjects.Graphics; titleY: number } {
  const accent = o.accent ?? P.tape
  const bg = scene.add.graphics()
  const x = -w / 2
  const y = -h / 2
  bg.fillStyle(P.shade, 0.55).fillRoundedRect(x + 4, y + 6, w, h, 12)
  bg.fillStyle(P.paper, 1).fillRoundedRect(x, y, w, h, 12)
  bg.lineStyle(3, P.edgeHi, 1).strokeRoundedRect(x, y, w, h, 12)
  // 顶部标题条：**低透明度强调色填充 + 亮描边**，不是实心色块。
  //
  // 为什么：旧版 accent 是警示黄（#f0b429），实心填充读作"贴上去的胶带"，
  // 在暖色 UI 上很协调。换成深海生物发光青（#4fe8ff）之后，
  // 一整条 868x46 的实心高亮青直接盖住整个面板顶部 ——
  // 实机截图里主菜单第一眼不是内容，是这条青带。
  //
  // 保留强调色的语义（这里是"这是什么屏"的标识），
  // 但把实心改成 0.14 透明度的着色 + accent 实色描边：
  // 依然是"发光的框"，不再是"发光的板"。
  bg.fillStyle(accent, 0.14).fillRoundedRect(x + 16, y + 14, w - 32, 46, 8)
  bg.lineStyle(2, accent, 0.75).strokeRoundedRect(x + 16, y + 14, w - 32, 46, 8)
  return { bg, titleY: y + 46 + 26 }
}

/** 外壳标题文字（单独返回，方便调用方按需放置）。
 *  `subColor` 单独给出：副标题在深色胶带（红/绿）上必须换浅色，
 *  沿用纸上的墨色会在深底上糊成一片看不清。 */
export function shellTitle(
  scene: Phaser.Scene, w: number, h: number, title: string, subtitle?: string,
  color: string = INK.main, subColor: string = INK.dim
): Phaser.GameObjects.Container {
  const c = scene.add.container(0, -h / 2 + 37)
  c.add(label(scene, 0, subtitle ? -8 : 0, title, FS.head, color,
    { fontStyle: 'bold', letterSpacing: 4 }).setOrigin(0.5))
  if (subtitle) c.add(label(scene, 0, 13, subtitle, FS.caption, subColor).setOrigin(0.5))
  return c
}
