/**
 * HUD 与三个弹窗（战斗 HUD / 波间商店 / 补给站决策 / 结算）。
 *
 * 这是纯表现层：只**读** `DiveWorld` 的字段，所有"改状态"都通过回调交回
 * `DiveGame`（→ 调 `world.buyCard()` 等）。模拟层不知道 UI 存在。
 *
 * 坐标系：HUD 根节点与 WorldRoot 用**同一套 sim 坐标**（左上原点、y 向下），
 * 但**不随镜头缩放** —— 所以它是 Canvas 下独立的一支，位置固定在 (-W/2, -H/2)。
 *
 * 商店卡上的立绘由注入的 `SpriteBank` 提供。**空银行是合法状态**：
 * 没同步美术时立绘框退化成"—"占位，交互一切照旧。
 *
 * ---------------------------------------------------------------------------
 * 五个注入 Creator 后才会暴露的坑（本文件都是按"踩过"的姿态写的）
 * ---------------------------------------------------------------------------
 * ① **layer 必须显式继承**：运行时 `new Node()` 的 layer 是 DEFAULT，而 Canvas
 *    的 UI 相机只渲染 UI_2D —— 漏一处就是"画面上什么都没有"。统一走 `mk()`。
 *
 * ② **Label 的锚点要跟着对齐方式走**：Cocos 的 Label 在 overflow=NONE 下内容尺寸
 *    自适应文本，锚点 (0.5,0.5) 意味着"文本中心落在节点位置"。于是右对齐的数字
 *    右边缘会随位数漂移（10 和 100 不齐）。锚点设 0 / 0.5 / 1 才是真贴边 ——
 *    这是 Phaser 侧 `setOrigin` 干的同一件事，移植时最容易整片漏掉。
 *
 * ③ **Graphics 纪律**：每个图元必须**建好路径立刻 fill/stroke**，且配色紧贴其前。
 *    不能"先 rect 攒着、中途换色"—— 那会把前一个图形也染成新色。
 *    本文件统一用 `fill(c); fillRect(...)` / `line(c,a,w); strokeRect(...)` 成对写法。
 *
 * ④ **不要每帧 new Gfx / new Sprite**：文本、按钮、立绘三类都是池化的。
 *    每帧新建纯属白扔 GC。
 *
 * ⑤ **Sprite 必须 `trim = false`，且比例取 `originalSize`**：`trim` 默认 true，
 *    会按裁剪后的 rect 渲染；而立绘的 contain 缩放要按**整张画布**（`originalSize`）算。
 *    两者**必须一致** —— 只改一半就是玩家报的"发射器变形"（2026-10-13，见 `putArt` 注释）。
 */

import { Node, Label, Graphics, Sprite, SpriteFrame, UITransform } from 'cc'
import { Gfx, col } from './Gfx'
import { neon, neonLine, neonCircle } from './neon'
import { SpriteBank } from './art'
import { UI, TXT, MENU, BRIGHT, TXT_LIGHT } from '../shared/theme'
import {
  LAYERS, RELIC_SLOTS, STAT_META, STAT_CARD, STAT_CAP, WEAPON_DEF, CARD_WEAPON_ID,
  O2, MAX_SEATS, BONE, weaponFamily, evolutionBase, RELIC_DEF, layerO2,
  SEAT_RING_R, SEAT_ANGLES_DEG, TURRET_R, BASE_SEATS,
} from '../shared/dive/tables'
import type { DiveWorld } from '../shared/dive/world'
import type { UpgradeDef, WeaponId, RelicId, Stats } from '../shared/dive/types'

/** 夹到 [0,1] —— 氧条比例、冷却进度、下潜进度都用它 */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 估算一段文字的像素宽（CJK ≈ 字号，ASCII ≈ 0.6×字号）。
 *
 * 用来做卡面文案的**截断**。为什么不用 Label 的真实宽度：`put()` 是池化的、
 * 每帧重设字符串，取真实宽度要等一帧的 layout，而排版必须在本帧内定下来。
 * 估算偏保守（宁可早截）—— 溢出会压到邻卡上，那是可见的事故，多截两个字没人看得出来。
 */
function estWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.6
  return w
}

/** 超过 `maxW` 就截断并补省略号 */
function fitText(s: string, size: number, maxW: number): string {
  if (estWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (estWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

interface Btn {
  node: Node
  label: Label
  /** 复用同一个 Gfx 包装（`H = 0`：按钮用节点局部坐标，y 翻转退化为取负） */
  gfx: Gfx
  onTap: () => void
}

type Align = 'left' | 'center' | 'right'

/**
 * 按钮皮肤。缺省（`BTN_DARK`）＝原来的暗色霓虹按钮，
 * 亮色弹窗（商店）传 `BTN_BRIGHT_*`，一次调用就把填充/描边/文字三件套一起换掉 ——
 * **只换底色会得到"白字白底"**，那正是这类改版最常见的事故。
 */
interface BtnStyle {
  /** 填充（启用态）。缺省 = 原暗色 `UI.panelHi` */
  fill?: number
  fillA?: number
  /** 禁用态填充。缺省 = `MENU.slot` */
  offFill?: number
  /** 描边（启用态）。缺省 = `UI.cyan` */
  edge?: number
  /** 描边透明度。缺省 0.8。设 0 配合 `fillA: 0` ⇒ **不可见热区** */
  edgeA?: number
  /** 禁用态描边。缺省 = `MENU.edge` */
  offEdge?: number
  /** 文字（启用态 / 禁用态）。缺省 = 原暗色的 `#c8f8ff` / `#4d6b7c` */
  text?: string
  offText?: string
  /** 圆角。缺省 0（直角）—— 亮色皮肤一律 ≥9 */
  r?: number
  /** 字号。缺省 17 */
  size?: number
}

const BTN_DARK: BtnStyle = {}
const BTN_BRIGHT_PRIMARY: BtnStyle = {
  fill: BRIGHT.accent, edge: BRIGHT.accentEdge, text: TXT_LIGHT.onAccent,
  offFill: 0x33586a, offEdge: 0x4d7183, offText: '#7c9aa8', r: 10, size: 17,
}
const BTN_BRIGHT_SECONDARY: BtnStyle = {
  fill: 0x578ba0, edge: BRIGHT.edge, text: TXT_LIGHT.main,
  offFill: 0x33586a, offEdge: 0x4d7183, offText: '#7c9aa8', r: 10, size: 16,
}
const BTN_BRIGHT_DISABLED: BtnStyle = {
  fill: 0x35586a, edge: 0x53798c, text: TXT_LIGHT.mute,
  offFill: 0x35586a, offEdge: 0x53798c, offText: TXT_LIGHT.mute, r: 9, size: 16,
}
const BTN_BRIGHT_TINY: BtnStyle = { fill: 0x4f7f94, edge: 0x8fb2c4, text: TXT_LIGHT.dim, r: 6, size: 13 }
const BTN_BRIGHT_LOCKED: BtnStyle = { fill: BRIGHT.lockHi, edge: BRIGHT.mount, text: '#ffd894', r: 6, size: 13 }

/**
 * **不可见热区**（2026-10-13 新增）。用于"整张商店卡可点购买"。
 *
 * 背景：商店副标题写着「点卡片或按 1 / 2 / 3 购买」，但 `shopCard` 从来没建过整卡热区
 * （只有右下角那个「购买」按钮真好使）—— 文案承诺的入口是死的。
 *
 * ⚠️ 必须用池化 `this.button` 而不是自建节点：按钮池的**创建顺序 = 节点树顺序 = 命中优先级**，
 *    在 `shopCard` 里**先**申请本热区、**后**申请「锁定 / 购买」按钮，
 *    两个真按钮就天然压在热区之上 —— 否则点「锁定」会被热区抢走变成买卡。
 */
const BTN_HIT: BtnStyle = { fill: 0x000000, fillA: 0, edge: 0x000000, edgeA: 0, r: 0 }

/** 购买按钮按**类型色**着色：器械青 / 挂载琥珀 / 属性紫 / 遗物靛 —— 与卡的描边同一色，一眼对上 */
function lightBuyBtn(accent: number): BtnStyle {
  return { fill: accent, edge: accent, text: TXT_LIGHT.onAccent, r: 9, size: 16 }
}

export class Hud {
  private readonly root: Node
  private readonly g: Gfx
  private readonly labels: Label[] = []
  private readonly btns: Btn[] = []
  private readonly arts: Sprite[] = []
  private labelUsed = 0
  private btnUsed = 0
  private artUsed = 0
  /** 全屏底色的外扩量（见 pageFill）：每帧按实际可视区刷新 */
  private padW = 8
  private padH = 8

  constructor(
    private readonly canvas: Node,
    private readonly W: number,
    private readonly H: number,
    /** 立绘银行。可以为空银行 —— 那就只画底色框，不影响任何交互 */
    private readonly art: SpriteBank,
  ) {
    this.root = this.mk('Hud', canvas)
    const ut = this.root.addComponent(UITransform)
    ut.setAnchorPoint(0, 0)
    ut.setContentSize(W, H)
    this.root.setPosition(-W / 2, -H / 2)

    this.g = new Gfx(this.mk('HudGraphics', this.root).addComponent(Graphics), H)
  }

  /**
   * 建节点并**继承父节点 layer**。
   * 坑 ① 的唯一入口 —— 所有运行时 new 出来的节点都必须走这里。
   */
  private mk(name: string, parent: Node): Node {
    const n = new Node(name)
    n.layer = parent.layer
    n.parent = parent
    return n
  }

  // -------------------------------------------------------------------------
  // 全屏底色
  // -------------------------------------------------------------------------
  /**
   * 全屏底色。
   *
   * 为什么不用 `fillRect(0, 0, W, H)`：那只有在"实际设计分辨率恰好等于 W×H"时才铺满。
   * 设计分辨率换成别的宽高比时，弹窗两侧会露出清屏色 —— 而弹窗只在少数时机出现，
   * 属于"上线后才被用户发现"的那类问题。这里按 Canvas 的真实尺寸外扩。
   */
  private pageFill(color: number, alpha: number): void {
    this.g.fill(color, alpha)
    this.g.fillRect(-this.padW, -this.padH, this.W + this.padW * 2, this.H + this.padH * 2)
  }

  private refreshPad(): void {
    const ut = this.canvas.getComponent(UITransform)
    const cw = ut ? ut.contentSize.width : 0
    const ch = ut ? ut.contentSize.height : 0
    this.padW = cw > 0 ? Math.max(0, (cw - this.W) / 2) + 8 : 8
    this.padH = ch > 0 ? Math.max(0, (ch - this.H) / 2) + 8 : 8
  }

  /**
   * 半透明底幕。
   *
   * 与 `pageFill` 的区别是**语义**：`pageFill` 铺的是不透明页面底（"这是一个界面"），
   * `scrim` 压的是半透明暗幕（"这是浮在游戏上的一个弹窗"）。用户原话
   * 「现在是全屏的 太大了」—— 旧商店用不透明 pageFill，视觉上等于把游戏切走了。
   */
  private scrim(alpha: number): void {
    this.g.fill(BRIGHT.scrim, alpha)
    this.g.fillRect(-this.padW, -this.padH, this.W + this.padW * 2, this.H + this.padH * 2)
  }

  /**
   * 亮色面板：实底 + 硬边 + 上缘高光带 + 一层淡投影。
   *
   * 三条刻意的取舍：
   *   · **硬边不发光** —— 发光会把边缘糊掉 2~3px，而"边缘锐利"正是清晰感的来源；
   *   · 顶栏带用"圆角矩形 + 方角补块"拼（引擎没有"只圆上两角"的 API），
   *     否则顶栏带的下两个圆角会在面板里抠出两个缺口；
   *   · 投影很淡（α.28）—— 底幕已经很暗，再重就是一块脏边。
   */
  private brightPanel(x: number, y: number, w: number, h: number): void {
    const g = this.g
    g.fill(0x000000, 0.38); g.fillRoundRect(x + 5, y + 8, w, h, 16)
    g.fill(BRIGHT.surface, 1); g.fillRoundRect(x, y, w, h, 16)
    g.fill(BRIGHT.header, 1)
    g.fillRoundRect(x, y, w, 48, 16)      // 顶栏带（上圆角）
    g.fillRect(x, y + 32, w, 16)          // 把顶栏带下缘补成方角
    g.fill(0xffffff, 0.22); g.fillRoundRect(x + 18, y + 3, w - 36, 2, 1)  // 面板上缘高光
    g.line(BRIGHT.edge, 0.9, 2); g.strokeRoundRect(x + 1, y + 1, w - 2, h - 2, 15)
  }

  // -------------------------------------------------------------------------
  // 池化工具
  // -------------------------------------------------------------------------
  /** 放一段文字。`(x, y)` 是**锚边**：left 给左边缘、right 给右边缘、center 给中心。 */
  private put(x: number, y: number, s: string, size: number, color: string, mode: Align): void {
    let l = this.labels[this.labelUsed]
    if (!l) {
      l = this.mk('t', this.root).addComponent(Label)
      this.labels.push(l)
    }
    l.node.active = true
    l.string = s
    l.fontSize = size
    l.lineHeight = size + 2
    l.color = col(parseInt(color.slice(1), 16))
    l.horizontalAlign = mode === 'left' ? Label.HorizontalAlign.LEFT
      : mode === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER
    l.verticalAlign = Label.VerticalAlign.CENTER
    // 坑 ②：锚点必须跟着对齐方式走，否则右对齐的数字右边缘会随位数漂移。
    const ut = l.node.getComponent(UITransform)
    if (ut) ut.setAnchorPoint(mode === 'left' ? 0 : mode === 'right' ? 1 : 0.5, 0.5)
    l.node.setPosition(x, this.H - y)
    this.labelUsed++
  }

  private text(x: number, y: number, s: string, size: number, color: string, right = false): void {
    this.put(x, y, s, size, color, right ? 'right' : 'left')
  }

  private center(x: number, y: number, s: string, size: number, color: string): void {
    this.put(x, y, s, size, color, 'center')
  }

  /**
   * 一个按钮。Graphics 画在**节点局部坐标**里：`new Gfx(g, 0)` 之后
   * `rect(-w/2, -h/2, w, h)` 就正好落在节点中心（H=0 时 y 翻转退化为取负）。
   */
  private button(cx: number, cy: number, w: number, h: number, s: string, onTap: () => void,
                 enabled = true, o: BtnStyle = BTN_DARK): void {
    let b = this.btns[this.btnUsed]
    if (!b) {
      const n = this.mk('btn', this.root)
      const ut = n.addComponent(UITransform)
      ut.setAnchorPoint(0.5, 0.5)
      const g = n.addComponent(Graphics)
      const label = this.mk('btnLabel', n).addComponent(Label)
      label.horizontalAlign = Label.HorizontalAlign.CENTER
      label.verticalAlign = Label.VerticalAlign.CENTER
      const rec: Btn = { node: n, label, gfx: new Gfx(g, 0), onTap }
      // 命中判定走节点的 UITransform 矩形，所以上面必须设 contentSize。
      n.on(Node.EventType.TOUCH_END, () => { if (rec.node.active) rec.onTap() })
      b = rec
      this.btns.push(b)
    }
    b.node.active = true
    b.onTap = onTap
    b.node.setPosition(cx, this.H - cy)
    b.node.getComponent(UITransform)!.setContentSize(w, h)
    const size = o.size ?? 17
    b.label.string = s
    b.label.fontSize = size
    b.label.lineHeight = size + 2
    b.label.color = col(parseInt((enabled ? (o.text ?? '#c8f8ff') : (o.offText ?? '#4d6b7c')).slice(1), 16))
    b.label.node.setPosition(0, 0)

    const r = o.r ?? 0
    b.gfx.clear()
    b.gfx.fill(enabled ? (o.fill ?? UI.panelHi) : (o.offFill ?? MENU.slot), o.fillA ?? 0.95)
    if (r > 0) b.gfx.fillRoundRect(-w / 2, -h / 2, w, h, r)
    else b.gfx.fillRect(-w / 2, -h / 2, w, h)
    b.gfx.line(enabled ? (o.edge ?? UI.cyan) : (o.offEdge ?? MENU.edge), o.edgeA ?? 0.8, r > 0 ? 1.5 : 1)
    if (r > 0) b.gfx.strokeRoundRect(-w / 2, -h / 2, w, h, r)
    else b.gfx.strokeRect(-w / 2, -h / 2, w, h)
    this.btnUsed++
  }

  /** 每帧开头调用：清 Graphics、把上一帧多余的文本/按钮/立绘关掉 */
  begin(): void {
    this.g.clear()
    this.refreshPad()
    for (let i = this.labelUsed; i < this.labels.length; i++) this.labels[i].node.active = false
    for (let i = this.btnUsed; i < this.btns.length; i++) this.btns[i].node.active = false
    for (let i = this.artUsed; i < this.arts.length; i++) this.arts[i].node.active = false
    this.labelUsed = 0
    this.btnUsed = 0
    this.artUsed = 0
  }

  /**
   * 一张立绘（contain 缩放：等比缩到**刚好放得进**给定框，多出来的留白）。
   *
   * 为什么是 contain 而不是 cover：素材统一是 2:1，而卡上的立绘框按卡高变化，
   * cover 会把画面裁掉（武器会被切掉枪口）。contain 任何比例都放得下。
   *
   * ⚠️ **比例必须取 `originalSize`（未裁剪的整张画布），不是 `rect`（裁剪后）**（2026-10-13 修）。
   *    素材导入 meta 是 `trimType: auto`：`item_gun` 的 `rect` 只有 344×264，而 `originalSize` 是 600×300。
   *    引擎在 `trim=false` 时按 **`originalSize`** 算顶点（`simple.ts`：`scaleX = cw / ow`），
   *    若这里反用 `rect` 定 contentSize，两边尺寸源打架 → 非等比拉伸。
   *    实测 `item_gun`：contentSize 156×120、trimmedBorder (128,−128,18,−18)
   *    → 实际绘制矩形只有 **89×105**，把 2:1 的立绘横向压掉 35%，就是玩家看到的"发射器变形了"。
   */
  private putArt(cx: number, cy: number, fw: number, fh: number, sf: SpriteFrame | undefined, alpha = 1): void {
    if (!sf) return
    let sp = this.arts[this.artUsed]
    if (!sp) {
      const n = this.mk('art', this.root)
      sp = n.addComponent(Sprite)
      sp.trim = false
      sp.sizeMode = Sprite.SizeMode.CUSTOM
      this.arts.push(sp)
    }
    sp.node.active = true
    sp.spriteFrame = sf
    sp.color = col(0xffffff, alpha)
    // 未裁剪的整张画布尺寸 —— 与引擎 `trim=false` 的顶点定标同源（见方法注释）
    const os = sf.originalSize
    const iw = os.width
    const ih = os.height
    const k = Math.min(fw / Math.max(1, iw), fh / Math.max(1, ih))
    sp.node.getComponent(UITransform)!.setContentSize(iw * k, ih * k)
    sp.node.setPosition(cx, this.H - cy)
    this.artUsed++
  }

  /**
   * 商店卡 → 立绘 key。
   *
   * 两处历史坑（都在 web 侧踩过，注释原文在 DiveScene 的 `CARD_WEAPON_ID`）：
   *   · 武器卡 id 有两种前缀：`w_<id>`（基础）与 `e_<id>`（进化）。
   *   · 但 `w_torp` / `w_harp` 这两张早期卡用的是**缩写**，直接切前缀会得到
   *     `torp` / `harp` —— `WEAPON_DEF` 里查不到 → 立绘取不到 → 卡面空白。
   *     所以必须先过一遍修正表。
   * 遗物卡直接取 `relicId`；其余类型（属性卡等）没有立绘，返回 null。
   */
  private cardArtKey(up: UpgradeDef): string | null {
    if (up.kind === 'relic') return up.relicId ? 'item_' + up.relicId : null
    const wid = this.cardWeaponId(up)
    return wid ? 'item_' + wid : null
  }

  /**
   * 商店卡 → 武器 id（没有则 null）。
   * 与 `cardArtKey` 同源：立绘 key 与"画哪个形状签名图标"必须走**同一套映射**，
   * 否则会出现"有立绘的卡用 A 逻辑、没立绘的卡用 B 逻辑"这种两边各对一半的漂移。
   */
  private cardWeaponId(up: UpgradeDef): WeaponId | null {
    const fixed = CARD_WEAPON_ID[up.id]
    if (fixed) return fixed
    if (up.id.startsWith('w_') || up.id.startsWith('e_')) {
      const raw = up.id.slice(2)
      if ((WEAPON_DEF as Record<string, unknown>)[raw]) return raw as WeaponId
    }
    return null
  }

  // -------------------------------------------------------------------------
  // 战斗 HUD
  // -------------------------------------------------------------------------
  drawCombat(w: DiveWorld, cbs: { onPause?: () => void } = {}): void {
    const W = this.W, H = this.H
    const L = LAYERS[w.layerIdx]
    const t = w.t
    const g = this.g

    // ===== ① 深度指示（左上）：实时米数 + 层名 + 本层机制 =====
    // 米数是"分层体感"的核心：玩家对 "3,400 m" 有真实的压迫联想，对 "L3 午夜带" 只是一个词。
    const dx0 = 24, dy0 = 22
    const depthStr = Math.round(w.depthM).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    this.text(dx0, dy0, depthStr, 30, TXT.cyber)
    this.text(dx0 + 12 + depthStr.length * 15, dy0 + 12, 'm', 12, TXT.dim)
    this.text(dx0, dy0 + 26, `L${w.layerIdx + 1} ${L.name}`, 13, TXT.cyber)
    this.text(dx0, dy0 + 44, L.sub, 12, TXT.mute)
    if (L.mech) this.text(dx0, dy0 + 62, `◆ ${L.mech}`, 13, TXT.amber)
    // 5 层刻度：层色随深度变，让玩家用余光也知道自己在第几层
    for (let i = 0; i < LAYERS.length; i++) {
      const yy = dy0 + 86 + i * 20
      const cur = i === w.layerIdx, done = i < w.layerIdx
      g.fill(cur ? UI.cyan : (done ? UI.cyanDim : UI.line), cur ? 1 : 0.6)
      g.fillRect(dx0, yy, cur ? 26 : 16, 5)
      if (cur) { g.fill(UI.cyan, 0.25); g.fillRect(dx0 + 30, yy - 4, 6, 13) }
    }
    this.text(dx0, dy0 + 86 + LAYERS.length * 20 + 6, `×${w.mult.toFixed(1)}`, 14, TXT.amber)

    // 本层氧耗预测（V6.53）：让"越深越费氧"**可见** ——
    //   这是玩家决定"要不要升氧气罐"的唯一依据；藏在数值表里 = 养成没有目标。
    // ⚠️ 显示的是**当前账户**的预测（含永久强化 `o2Bonus` / `regen`），不是裸表值 ——
    //   否则买了养成也不会有"我能潜得更深了"的反馈。
    // ⚠️ `sec` = 满氧**静止**能撑的秒数，不是平衡数字（实战要移动/爆发/拾取），只给量级。
    const o2f = layerO2(w.layerIdx, w.st.o2Bonus, w.st.regen)
    this.text(dx0, dy0 + 86 + LAYERS.length * 20 + 26,
      `氧耗 ×${o2f.drain.toFixed(2)} · 静止 ${Math.round(o2f.sec)}s`, 12, TXT.dim)

    // ===== ② 氧气条（顶部居中 · 主 HUD）=====
    // 两段式：剩余氧（实心） | 本层上限被压缩的余量（灰）。
    // 分母用 max(基准, 当前上限)：买了扩容气瓶条会**变长**（正反馈可见）又不会超出槽宽；
    // 下潜后上限压缩必须**可见地变短** —— 这是玩家理解"越深容错越小"的唯一显式信号。
    const bw = 420, bh = 20, bx = (W - bw) / 2, by = 26
    const full = Math.max(O2.max, w.o2Max)
    const curRatio = clamp01(w.o2 / full)
    const capRatio = clamp01(w.o2Max / full)
    const pct = w.o2 / Math.max(1, w.o2Max)
    const low = pct < 0.2
    const barCol = low ? UI.danger : (pct < 0.5 ? UI.amber : UI.cyan)
    // 低氧脉冲用**正弦**而不是方波：方波是"闪"，正弦是"呼吸"，更贴近窒息这个生理联想
    const pulse = low ? 0.6 + 0.4 * Math.abs(Math.sin(t * 4.2)) : 1

    g.fill(UI.panel, 0.75); g.fillRoundRect(bx, by, bw, bh, 9)
    if (capRatio < 1) { g.fill(UI.line, 0.5); g.fillRoundRect(bx + bw * capRatio, by, bw * (1 - capRatio), bh, 9) }
    g.fill(barCol, pulse); g.fillRoundRect(bx, by, Math.max(2, bw * curRatio), bh, 9)

    // 刻度：每 20 单位一格，让"还剩几格"可以目测（空条上画细刻度、实心区上画暗色刻度）
    for (let v = 20; v < full; v += 20) {
      const tx = bx + bw * (v / full)
      if (tx > bx + bw - 2) break
      const lit = tx <= bx + bw * curRatio
      g.fill(lit ? UI.abyss : UI.line, lit ? 0.45 : 0.55)
      g.fillRect(tx, by + 4, 1, bh - 8)
    }
    // 危险阈值线：20% 处一条竖线 —— 玩家不该靠心算判断"还剩多少会死"
    const dzX = bx + bw * (0.2 * w.o2Max / full)
    g.fill(UI.danger, 0.55 + 0.35 * Math.abs(Math.sin(t * 2)))
    g.fillRect(dzX - 1, by - 3, 2, bh + 6)
    this.center(dzX, by + bh + 12, '危险', 12, TXT.warn)

    g.line(low ? UI.danger : UI.cyanDim, 0.8, low ? 2 : 1)
    g.strokeRoundRect(bx, by, bw, bh, 9)
    this.center(W / 2, by + bh / 2, `${Math.ceil(w.o2Shown)} / ${w.o2Max}`, 20, low ? TXT.warn : TXT.cyber)
    // 耗氧速率（越深越快，必须显式告诉玩家）
    this.text(bx - 12, by + 2, `-${L.drain.toFixed(1)}/s`, 13, TXT.dim, true)

    // ===== ③ 波次进度（氧气条右侧）=====
    const wx0 = bx + bw + 18
    const total = w.waves().length
    this.text(wx0, by + 2, `第 ${w.waveInLayer + 1} / ${total} 波`, 16, TXT.main)
    for (let i = 0; i < total; i++) {
      const px1 = wx0 + i * 16, py1 = by + bh + 6
      const done = w.phase === 'result' ? i < w.waveInLayer : i <= w.waveInLayer
      g.fill(done ? UI.cyan : UI.line, 1)
      g.fillCircle(px1, py1, 4)
      // 当前波的点加一圈呼吸环：一眼看出"进度停在第几波"
      if (i === w.waveInLayer && w.phase === 'wave') {
        g.line(UI.cyan, 0.5, 1.5)
        g.strokeCircle(px1, py1, 4 + 3 * Math.abs(Math.sin(t * 2.4)))
      }
    }
    if (w.phase === 'wave') {
      // 环形倒计时：弧长 = 本波剩余时间比例（弧度是余光可读的，数字要盯着看才有用）
      const dur = Math.max(1, w.waves()[w.waveInLayer].dur)
      const left = clamp01(w.waveTimer / dur)
      const wcx = wx0 + 18, wcy = by + bh + 36, wr = 15
      g.line(UI.abyss, 0.75, 3); g.strokeCircle(wcx, wcy, wr)
      g.line(left < 0.25 ? UI.danger : UI.cyan, 0.95, 3)
      g.arc(wcx, wcy, wr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); g.stroke()
      this.center(wcx, wcy, `${Math.max(0, Math.ceil(w.waveTimer))}`, 15, left < 0.25 ? TXT.warn : TXT.cyber)
      this.text(wcx + wr + 6, wcy - 6, 's', 12, TXT.dim)
      // 剩余敌人：清波进度的唯一确定信号（计时器到点 ≠ 波次结束，还要清场）
      const alive = w.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
      this.text(wx0, by + bh + 60, w.spawnLeft > 0 ? `剩余 ${alive} · 涌入中` : `剩余 ${alive}`,
        13, alive > 0 ? TXT.dim : TXT.jade)
    } else if (w.phase === 'descending') {
      // 下潜进度条：下潜是一次"过渡"，玩家需要一个明确的进度
      const k = clamp01(w.descT / Math.max(0.01, w.descDur))
      const dw = 120, dx2 = wx0, dy2 = by + bh + 26
      g.fill(UI.panel, 0.7); g.fillRoundRect(dx2, dy2, dw, 8, 4)
      g.fill(UI.cyan, 0.9); g.fillRoundRect(dx2, dy2, Math.max(3, dw * k), 8, 4)
      g.line(UI.cyanDim, 0.7, 1); g.strokeRoundRect(dx2, dy2, dw, 8, 4)
      this.text(dx2, dy2 - 14, '下潜中', 12, TXT.cyan)
      this.text(dx2 + dw + 8, dy2 - 2, `${Math.round(k * 100)}%`, 12, TXT.dim)
    }

    // ===== ③b 鱼情雷达（右上角，V6.55）=====
    // 用户 2026-10-13 点名："右上角用圆圈表示当前平面的鱼情，类似地图导航"。
    //
    // ⚠️ 用户当时**误把波次倒计时那个圆（里面写 27）当成了鱼情** —— 它其实是
    //    ③ 里的波次剩余秒数。所以这块是**新增的一段**，不是改旧组件。
    //
    // 它补的缺口很具体：侧视画面**看不到"四周"**。从正上方游来的敌人在屏幕上是
    // "一条斜着游过去的鱼"，玩家据此判断不出"还有几条、从哪个方向压过来"。
    // 雷达把"平面方位"还给玩家 —— **侧视画面管纵深，雷达管平面**，各说一头。
    //
    // ⚠️ 点位**绝不给 2px 发光核**（那是"可瞄准敌人"的铁律，见 `drawEnemies`）：
    //    雷达点纯信息，给了核会和战斗画面里真正能打的目标混淆。
    const RCX = W - 88, RCY = 164, RR = 52, RPLOT = 44
    // 量程比屏幕半对角线（≈752）略大 ⇒ 画面内出现的敌人**必然**落在圈内；
    // 落在外环上的只可能是"还没进画面"的 —— 那正是"它正从那个方向来"的导航语义。
    const RANGE = 780
    g.fill(UI.panel, 0.58); g.fillCircle(RCX, RCY, RR)
    g.line(UI.cyanDim, 0.5, 1.4); g.strokeCircle(RCX, RCY, RR)
    // 半量程内环 + 十字准线 —— "导航感"来自这两样，不是来自点位本身
    g.line(UI.line, 0.32, 1); g.strokeCircle(RCX, RCY, RR * 0.5)
    g.line(UI.line, 0.22, 1); g.strokeSeg(RCX - RR, RCY, RCX + RR, RCY)
    g.line(UI.line, 0.22, 1); g.strokeSeg(RCX, RCY - RR, RCX, RCY + RR)
    this.center(RCX, RCY - RR + 13, '鱼情', 11, TXT.mute)

    for (const e of w.enemies) {
      if (!e.alive) continue
      const dx = e.x - w.px, dy = e.y - w.py
      const d = Math.hypot(dx, dy)
      const ux = d > 1e-3 ? dx / d : 0, uy = d > 1e-3 ? dy / d : -1
      const k = Math.min(1, d / RANGE)
      const px = RCX + ux * k * RPLOT, py = RCY + uy * k * RPLOT
      if (e.kind === 'boss') {
        // BOSS 是本作唯一"必须提前知道它从哪来"的目标 ⇒ 大点 + 呼吸环
        const br = 6 + 2 * Math.abs(Math.sin(t * 3))
        g.line(UI.violet, 0.7, 1.6); g.strokeCircle(px, py, br)
        g.fill(UI.violet, 1); g.fillCircle(px, py, 3.4)
      } else {
        // 贴边（k=1）的压暗：它还没进画面，只表示"那个方向有东西"
        g.fill(e.color, k >= 1 ? 0.5 : 0.95)
        g.fillCircle(px, py, e.kind === 'drift' ? 3.0 : 2.2)
      }
    }
    // 圆心 = 玩家自己，**最后画**，保证永不被点位盖住。小箭头 = 航向（`w.aim` 是 sim 角度）
    g.fill(UI.cyanHi, 1); g.fillCircle(RCX, RCY, 3)
    g.fill(UI.cyanHi, 0.8); g.fillTri(RCX, RCY, w.aim, 9, 4.5)

    // ===== ④ 生物质（层末才显示）/ 鱼骨（常驻）/ 暂停按钮（常驻·右上角）=====
    // 鱼骨必须**常驻**：玩家要在战斗中就看见数字在涨，才会把"捡鱼骨"和"待会儿能买什么"连起来。
    //
    // 2026-10-13：右上角腾出来常驻一个暂停按钮 —— 此前局内**只有键盘**能退出，
    // 触屏玩家一个出口都没有。代价是鱼骨与生物质整组左移（从贴边 W-106/W-24
    // 挪到 W-150/W-64），让出 56px 的角。两处仍是左/右对齐，位数变化不会左右抖。
    const bY = by + (w.mult > 1 ? 48 : 26)
    g.line(BONE, 0.9, 1.4); g.strokeCircle(W - 150, bY + 8, 7)
    this.text(W - 132, bY, `${w.bank}`, 17, TXT.cyber)
    if (w.phase !== 'wave') {
      this.text(W - 64, by + 2, `生物质 ${w.biomass}`, 18, TXT.jade, true)
      if (w.mult > 1) this.text(W - 64, by + 26, `上浮可得 ${Math.floor(w.biomass * w.mult)}`, 13, TXT.amber, true)
    }

    // 暂停按钮：**视觉 38×38，热区 64×64**（视觉尺寸与点击区分离 ——
    // 38px 在触屏上够不着，但画大了会压住鱼骨）。图标是矢量两条圆角竖杠：
    // 纯 UI 符号、要随状态换色，走位图反而多一层，与"沉淀货币留矢量"同一条分工线。
    if (cbs.onPause) {
      const pbx = W - 32, pby = 30
      g.fill(UI.panel, 0.72)
      g.fillRoundRect(pbx - 19, pby - 19, 38, 38, 9)
      g.line(UI.cyanDim, 0.85, 1.2)
      g.strokeRoundRect(pbx - 19, pby - 19, 38, 38, 9)
      g.fill(UI.cyan, 0.92)
      g.fillRect(pbx - 7.5, pby - 9, 5.5, 18)
      g.fillRect(pbx + 2, pby - 9, 5.5, 18)
      // 只吃点击、不画任何东西的空按钮（fillA / edgeA = 0）
      this.button(pbx, pby, 64, 64, '', cbs.onPause, true, { fillA: 0, edgeA: 0 })
    }

    // ===== ⑤ 装备槽（底部左）=====
    // 每槽同时回答四个问题：装了什么（图形签名）· 多强（等级点）· 什么时候好（冷却环）· 是不是扩容座（角标）
    const sy = H - 50
    const slots = Math.min(w.maxWeapons, MAX_SEATS)
    const sw = 46, gap = 52
    const plan = w.mountPlan()
    for (let i = 0; i < slots; i++) {
      const sx = 24 + i * gap
      const wp = w.weapons[i]
      const ext = !!plan[i]?.ext
      const wcol = wp ? WEAPON_DEF[wp.id].color : UI.line

      g.fill(wp ? UI.panelHi : UI.panel, wp ? 0.9 : 0.55)
      g.fillRoundRect(sx, sy, sw, sw, 9)

      if (!wp) {
        g.line(UI.line, 0.45, 1); g.strokeRoundRect(sx, sy, sw, sw, 9)
        this.center(sx + sw / 2, sy + sw / 2 - 6, String(i + 1), 13, TXT.mute)
        continue
      }

      g.line(wcol, 0.9, ext ? 2.4 : 2); g.strokeRoundRect(sx, sy, sw, sw, 9)
      const icx = sx + sw / 2, icy = sy + 19
      this.weaponIcon(wp.id, icx, icy, 12)

      // 冷却环：绕图标画一圈、从 12 点顺时针填充 —— "转满一圈"直接对应"又射了一发"
      if (wp.timer > 0) {
        const k = clamp01(1 - wp.timer / Math.max(0.01, wp.ivLast || wp.iv))
        g.line(UI.abyss, 0.8, 3); g.strokeCircle(icx, icy, 15)
        g.line(wcol, 0.95, 3)
        g.arc(icx, icy, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); g.stroke()
      }

      // 等级点：最多 5 个小方块
      for (let k2 = 0; k2 < 5; k2++) {
        g.fill(k2 < wp.lvl ? wcol : UI.line, k2 < wp.lvl ? 1 : 0.45)
        g.fillRect(sx + 8 + k2 * 6.5, sy + 35, 4, 4)
      }
      // 扩容座角标（与商店卡里的座圈示意图同一套视觉语言：扩容座 = 琥珀）
      if (ext) {
        g.fill(UI.amber, 0.95)
        g.fillRect(sx + sw - 13, sy + 4, 7, 4)
        g.fillRect(sx + sw - 13, sy + 10, 7, 4)
      }
    }
    this.text(24, sy - 16, `座圈 ${w.weapons.length}/${slots}`,
      12, w.weapons.length < w.maxWeapons ? TXT.dim : TXT.cyan)

    // ===== ⑥ 遗物槽（底部右）=====
    // 遗物必须战斗中也能看见：效果多为条件触发，玩家得知道"我现在有条件可触发"
    {
      const rs = 30, rgap = 36
      const rx0 = W - 24 - RELIC_SLOTS * rgap + (rgap - rs)
      for (let i = 0; i < RELIC_SLOTS; i++) {
        const rx = rx0 + i * rgap
        const id = w.relics[i]
        if (!id) { g.line(UI.line, 0.4, 1); g.strokeRoundRect(rx, sy + 7, rs, rs, 7); continue }
        g.fill(UI.panelHi, 0.8); g.fillRoundRect(rx, sy + 7, rs, rs, 7)
        const live = w.relicActive(id)
        g.line(live ? UI.cyanHi : BONE, live ? 0.95 : 0.6, live ? 2 : 1.2)
        g.strokeRoundRect(rx, sy + 7, rs, rs, 7)
        this.relicIcon(id, rx + rs / 2, sy + 22, 11)
      }
      this.text(W - 24, sy - 16, '遗物', 12, TXT.dim, true)
    }

    // ===== ⑦ 技能冷却（底部中）=====
    const ready = w.burstTimer <= 0
    const kk = ready ? 1 : clamp01(1 - w.burstTimer / O2.burstCd)
    g.line(ready ? UI.cyan : UI.cyanDim, 0.9, 2); g.strokeCircle(W / 2, sy + 22, 20)
    g.fill(ready ? UI.cyan : UI.cyanDim, 0.25); g.fillCircle(W / 2, sy + 22, 20 * kk)
    this.center(W / 2, sy + 22, ready ? '空格' : `${Math.ceil(w.burstTimer)}`, 13, ready ? TXT.cyber : TXT.mute)

    // ===== ⑧ 环境状态提示（左，深度块下方）=====
    let ty = 250
    if (w.vpCur > 0) { this.text(24, ty, `暗流 ${w.vpCur.toFixed(0)}`, 13, TXT.amber); ty += 20 }
    if (w.vpPush > 0) { this.text(24, ty, `热泉上推 ${w.vpPush.toFixed(0)}`, 13, TXT.amber); ty += 20 }
    if (w.burstTimer > 0) this.text(24, ty, `排气冷却 ${w.burstTimer.toFixed(1)}s`, 13, TXT.mute)

    // ===== ⑨ 低氧压迫：心跳边框 + "O₂ 告急" =====
    // 玩家要能把"我为什么喘不上气"归因到正确原因，就必须有常驻显式指示。
    if (pct < 0.32 && (w.phase === 'wave' || w.phase === 'descending')) {
      const urgency = 1 - pct / 0.32
      const beat = Math.max(0, Math.sin(t * (2.2 + urgency * 3.4) * Math.PI))
      const inset = 10 + beat * 14
      g.line(UI.danger, (0.12 + 0.5 * beat) * (0.35 + urgency * 0.65), 3 + beat * 3)
      g.strokeRect(inset / 2, inset / 2, W - inset, H - inset)
      this.center(W / 2, 62, 'O₂ 告急', Math.round(16 + beat * 4), TXT.amber)
    }

    // ===== 层入场卡 =====
    if (w.layerCardT > 0 && L.mech) {
      const a = Math.min(1, w.layerCardT / 0.6)
      g.fill(MENU.page, 0.72 * a)
      g.fillRect(W / 2 - 260, H / 2 - 70, 520, 140)
      this.center(W / 2, H / 2 - 34, `${L.name} · ${L.mech}`, 24, TXT.cyber)
      this.center(W / 2, H / 2 + 4, L.tip, 15, TXT.dim)
    }
  }

  /**
   * 器械槽 / 商店卡的**形状签名图标**（V6.6）。
   *
   * 为什么用形状而不是贴图：只有 5 种配色，光靠颜色分不开 15 种器械形态，形状能。
   * 进化形态（`weaponFamily(id) !== id`）在右上角加一颗小菱形角标 ——
   * "这是同一族的进化版"一眼可辨（V6 §5.2 质变密度原则）。
   */
  private weaponIcon(id: WeaponId, cx: number, cy: number, s: number): void {
    const g = this.g
    const color = WEAPON_DEF[id].color
    const fam = weaponFamily(id)

    if (fam === 'sonar') {
      g.line(color, 0.95, 1.6); g.strokeCircle(cx, cy, s * 0.9)
      // 共振炮：多一层同心回波 —— 读作"伤害会往下传"
      if (id === 'sonar_rs') { g.line(color, 0.55, 1.2); g.strokeCircle(cx, cy, s * 0.66) }
      // 定向聚焦：把环画成一段粗弧（"聚焦" = 只朝一个方向）
      if (id === 'sonar_fc') { g.line(color, 0.95, 3.2); g.arc(cx, cy, s * 0.9, -0.9, 0.9); g.stroke() }
      g.line(color, 0.6, 1.4); g.strokeCircle(cx, cy, s * 0.42)
    } else if (fam === 'gun') {
      // 霰弹画 5 根管（散射感），其余 3 根
      const n = id === 'gun_sg' ? 5 : 3
      for (let i = 0; i < n; i++) {
        const yy = cy + (i - (n - 1) / 2) * (s * 0.44)
        g.line(color, 0.9, id === 'gun_sg' ? 1.3 : 1.6)
        g.strokeSeg(cx - s, yy, cx + s, yy)
      }
      // 加特林：管口加一个转环
      if (id === 'gun_gl') { g.line(color, 0.8, 1.3); g.strokeCircle(cx + s * 0.72, cy, s * 0.42) }
    } else if (fam === 'torpedo') {
      // 集束：3 枚小号；重型：1 枚大号（尾鳍同比例放大）
      const n = id === 'torp_cl' ? 3 : 1
      const k = id === 'torp_cl' ? 0.62 : 1
      for (let i = 0; i < n; i++) {
        const oy = cy + (i - (n - 1) / 2) * (s * 0.62)
        g.line(color, 0.9, 1.5); g.strokeEllipse(cx + s * 0.15, oy, s * 1.35 * k, s * 0.72 * k)
        g.moveTo(cx - s * 0.5 * k, oy)
        g.lineTo(cx - s * 1.05 * k, oy - s * 0.55 * k)
        g.lineTo(cx - s * 1.05 * k, oy + s * 0.55 * k)
        g.close(); g.stroke()
      }
    } else if (fam === 'harpoon') {
      // 长杆 + 倒刺箭头 —— "穿透"读得出来
      g.line(color, 0.9, 1.8); g.strokeSeg(cx - s, cy, cx + s * 0.5, cy)
      g.line(color, 0.9, 1.5)
      g.moveTo(cx + s, cy)
      g.lineTo(cx + s * 0.40, cy - s * 0.44)
      g.lineTo(cx + s * 0.56, cy)
      g.lineTo(cx + s * 0.40, cy + s * 0.44)
      g.close(); g.stroke()
    } else if (fam === 'echo') {
      // 三层同心弧（声波）+ 中心点
      for (let i = 1; i <= 3; i++) {
        g.line(color, i === 1 ? 0.95 : 0.6, 1.5)
        g.arc(cx - s * 0.32, cy, s * 0.34 * i, -0.95, 0.95); g.stroke()
      }
      g.fill(color, 0.95); g.fillCircle(cx - s * 0.32, cy, s * 0.14)
    } else if (fam === 'acid') {
      // 主液滴 + 两枚溅出的小液滴
      g.fill(color, 0.30); g.fillCircle(cx, cy, s * 0.52)
      g.line(color, 0.9, 1.6); g.strokeCircle(cx, cy, s * 0.52)
      g.fill(color, 0.85)
      g.fillCircle(cx + s * 0.74, cy - s * 0.5, s * 0.16)
      g.fillCircle(cx - s * 0.68, cy + s * 0.56, s * 0.13)
    } else if (id === 'arc_st') {
      // 雷暴：放射状多段 —— "一次电击全部目标"
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i / 6) * Math.PI * 2
        g.line(color, 0.85, 1.4)
        g.strokeSeg(cx, cy, cx + Math.cos(a) * s, cy + Math.sin(a) * s)
      }
      g.fill(color, 0.95); g.fillCircle(cx, cy, s * 0.18)
    } else {
      // 折线闪电（基础 / 过载共用主形）
      g.line(color, 0.9, 1.8)
      g.moveTo(cx + s * 0.35, cy - s)
      g.lineTo(cx - s * 0.35, cy + s * 0.12)
      g.lineTo(cx + s * 0.1, cy + s * 0.12)
      g.lineTo(cx - s * 0.3, cy + s)
      g.stroke()
      // 过载：左侧多一道小闪电（"链更长"）
      if (id === 'arc_ov') {
        g.line(color, 0.8, 1.4)
        g.moveTo(cx - s * 0.78, cy - s * 0.9)
        g.lineTo(cx - s * 1.02, cy - s * 0.2)
        g.lineTo(cx - s * 0.82, cy - s * 0.2)
        g.lineTo(cx - s * 1.02, cy + s * 0.35)
        g.stroke()
      }
    }

    // 进化角标：右上角一颗小菱形（`fam !== id` 即"这是进化形态"）
    if (fam !== id) {
      const dx1 = cx + s * 0.88, dy1 = cy - s * 0.88, rr = s * 0.26
      g.fill(color, 0.95)
      g.moveTo(dx1, dy1 - rr); g.lineTo(dx1 + rr, dy1)
      g.lineTo(dx1, dy1 + rr); g.lineTo(dx1 - rr, dy1)
      g.close(); g.fillPath()
    }
  }

  /**
   * 遗物图标（V6.8）。全部用最简几何形，靠**形状**区分而不是颜色 ——
   * 遗物只有 4 个槽，但要能一眼认出装的是哪一个。
   */
  private relicIcon(id: RelicId, cx: number, cy: number, r: number): void {
    const g = this.g
    const c = BONE
    const lw = 2
    g.line(c, 0.95, lw)

    switch (id) {
      case 'echo_heart': {
        // 心形 + 一道裂纹：低氧才发动的东西，画成"破了的心"
        g.moveTo(cx, cy + r * 0.75)
        g.lineTo(cx - r, cy - r * 0.15)
        g.arc(cx - r * 0.5, cy - r * 0.45, r * 0.5, Math.PI * 0.85, Math.PI * 1.9, true)
        g.arc(cx + r * 0.5, cy - r * 0.45, r * 0.5, Math.PI * 1.1, Math.PI * 0.15, true)
        g.close(); g.stroke()
        g.line(UI.danger, 0.9, 1.4)
        g.moveTo(cx - 2, cy - r * 0.5); g.lineTo(cx + 3, cy + r * 0.1); g.lineTo(cx - 3, cy + r * 0.35)
        g.stroke()
        break
      }
      case 'osteoblast': {
        // 骨头：两端各两个圆，中间一根
        g.moveTo(cx - r * 0.45, cy - r * 0.3); g.lineTo(cx + r * 0.45, cy + r * 0.3); g.stroke()
        g.fill(c, 0.9)
        const pts: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
        for (const [sx1, sy1] of pts) g.fillCircle(cx + sx1 * r * 0.5, cy + sy1 * r * 0.38, r * 0.24)
        break
      }
      case 'tidal_compass': {
        // 罗盘：外圈 + 四向指针（菱形）
        g.strokeCircle(cx, cy, r * 0.8)
        g.moveTo(cx, cy - r * 0.7); g.lineTo(cx + r * 0.35, cy)
        g.lineTo(cx, cy + r * 0.7); g.lineTo(cx - r * 0.35, cy)
        g.close(); g.stroke()
        break
      }
      case 'resonance_core': {
        // 同心弧 ×3（双向）+ 中心点：向外扩的共振
        for (let i = 1; i <= 3; i++) {
          g.line(c, 1 - i * 0.2, lw - i * 0.35)
          g.arc(cx, cy, r * 0.3 * i, -0.9, 0.9); g.stroke()
          g.arc(cx, cy, r * 0.3 * i, Math.PI - 0.9, Math.PI + 0.9); g.stroke()
        }
        g.fill(c, 1); g.fillCircle(cx, cy, 3)
        break
      }
      case 'gluttony': {
        // 张开的大口：两段弧 + 三颗尖牙（贪婪）
        g.arc(cx, cy, r * 0.8, Math.PI * 0.15, Math.PI * 0.85); g.stroke()
        g.arc(cx, cy, r * 0.8, Math.PI * 1.15, Math.PI * 1.85); g.stroke()
        g.fill(c, 0.85)
        for (let i = -1; i <= 1; i++) {
          const bx2 = cx + i * r * 0.4
          g.moveTo(bx2 - 4, cy - r * 0.1); g.lineTo(bx2 + 4, cy - r * 0.1); g.lineTo(bx2, cy + r * 0.35)
          g.close(); g.fillPath()
        }
        break
      }
      case 'abyss_mark': {
        // 向下的三层箭头：越深越强
        for (let i = 0; i < 3; i++) {
          const yy = cy - r * 0.5 + i * r * 0.5
          g.line(c, 0.5 + i * 0.25, lw)
          g.moveTo(cx - r * 0.5, yy); g.lineTo(cx, yy + r * 0.3); g.lineTo(cx + r * 0.5, yy)
          g.stroke()
        }
        break
      }
      case 'current_fin': {
        // 鳍：一片三角 + 三条流线
        g.fill(c, 0.85)
        g.moveTo(cx - r * 0.6, cy + r * 0.5); g.lineTo(cx + r * 0.5, cy + r * 0.1); g.lineTo(cx - r * 0.2, cy - r * 0.6)
        g.close(); g.fillPath()
        g.line(UI.cyan, 0.8, 1.3)
        for (let i = 0; i < 3; i++) {
          const yy = cy - r * 0.3 + i * r * 0.35
          g.strokeSeg(cx + r * 0.25, yy, cx + r * 0.9, yy - 4)
        }
        break
      }
      case 'silent_plating': {
        // 盾牌 + 内部竖线（装甲板）
        g.moveTo(cx, cy - r * 0.8); g.lineTo(cx + r * 0.65, cy - r * 0.4)
        g.lineTo(cx + r * 0.5, cy + r * 0.5); g.lineTo(cx, cy + r * 0.8)
        g.lineTo(cx - r * 0.5, cy + r * 0.5); g.lineTo(cx - r * 0.65, cy - r * 0.4)
        g.close(); g.stroke()
        g.line(c, 0.6, 1.2)
        for (let i = -1; i <= 1; i++) g.strokeSeg(cx + i * r * 0.28, cy - r * 0.45, cx + i * r * 0.28, cy + r * 0.45)
        break
      }
      // ---- V6.33 机制型遗物 4 条（形状必须与上面 8 个明显不同，否则缩到 11px 认不出）----
      case 'conductor_coil': {
        // 线圈：三匝弹簧（横向弧），从上到下渐细 —— "缠绕"的意思
        for (let i = 0; i < 3; i++) {
          const yy = cy - r * 0.42 + i * r * 0.42
          g.line(c, 0.9 - i * 0.18, lw - i * 0.25)
          g.arc(cx, yy, r * 0.42, Math.PI * 0.06, Math.PI * 0.94, false)
          g.stroke()
        }
        break
      }
      case 'bleeding_anchor': {
        // 锚：竖杆 + 顶部横杆 + 底部弯钩（下半圆），末端缀一滴血
        g.line(c, 0.95, lw)
        g.moveTo(cx, cy - r * 0.7); g.lineTo(cx, cy + r * 0.5); g.stroke()
        g.moveTo(cx - r * 0.45, cy - r * 0.52); g.lineTo(cx + r * 0.45, cy - r * 0.52); g.stroke()
        g.arc(cx, cy + r * 0.05, r * 0.5, 0, Math.PI); g.stroke()
        g.fill(UI.danger, 0.9); g.fillCircle(cx, cy + r * 0.7, 2.2)
        break
      }
      case 'resonance_chamber': {
        // 腔体：一个开口朝上的碗（下半圆 + 两侧短壁）+ 内里两点回声
        g.line(c, 0.95, lw)
        g.arc(cx, cy - r * 0.1, r * 0.6, 0, Math.PI); g.stroke()
        g.line(c, 0.7, 1.4)
        g.moveTo(cx - r * 0.6, cy - r * 0.1); g.lineTo(cx - r * 0.6, cy - r * 0.62); g.stroke()
        g.moveTo(cx + r * 0.6, cy - r * 0.1); g.lineTo(cx + r * 0.6, cy - r * 0.62); g.stroke()
        g.fill(c, 0.9)
        g.fillCircle(cx, cy + r * 0.02, 2.4)
        g.fillCircle(cx, cy + r * 0.34, 1.7)
        break
      }
      case 'overload_core': {
        // 核心：实心圆 + 一圈断口环 + 三向放射 —— "过载"
        g.line(c, 0.9, 1.4)
        g.arc(cx, cy, r * 0.72, 0.4, Math.PI * 1.0); g.stroke()
        g.arc(cx, cy, r * 0.72, Math.PI * 1.4, Math.PI * 2.0); g.stroke()
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + i * (Math.PI * 2 / 3)
          g.moveTo(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4)
          g.lineTo(cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66)
          g.stroke()
        }
        g.fill(UI.danger, 0.95); g.fillCircle(cx, cy, r * 0.3)
        break
      }
    }
  }

  // -------------------------------------------------------------------------
  // 波间商店
  // -------------------------------------------------------------------------
  /**
   * 属性卡的**大符号**（web `drawStatGlyph` 的移植，11 种属性各一个形状签名）。
   *
   * 为什么必须有：属性卡没有立绘 —— 素材里不可能有"共振强度"这种东西的图。
   * 旧版这块直接画一个 `—`，整张卡看起来像"资源没加载出来"。
   * 这里用几何符号补上，且是**形状**签名而不是颜色签名：缩到 20px 也分得清。
   */
  private statGlyph(k: keyof Stats, cx: number, cy: number, s: number, col: number): void {
    const g = this.g
    const path = (fn: () => void, w = 2.4, a = 1): void =>
      neon(g, col, () => { fn() }, { width: w, alpha: a, bloom: false })
    const seg = (x1: number, y1: number, x2: number, y2: number, w = 2.4, a = 1): void =>
      neonLine(g, x1, y1, x2, y2, col, { width: w, alpha: a, bloom: false })
    /** 折线 → 收口 → 描边。`neon` 会调它 2~3 次，必须每次重新组路径。 */
    const poly = (pts: number[]): (() => void) => () => {
      g.moveTo(pts[0], pts[1])
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
      g.close(); g.stroke()
    }
    switch (k) {
      case 'dmg':      // 向上箭头 = 强度
        path(poly([cx, cy - s * 0.5, cx + s * 0.42, cy + s * 0.06, cx + s * 0.16, cy + s * 0.06,
          cx + s * 0.16, cy + s * 0.5, cx - s * 0.16, cy + s * 0.5, cx - s * 0.16, cy + s * 0.06,
          cx - s * 0.42, cy + s * 0.06]))
        break
      case 'rate':     // 三条速度线
        for (let i = -1; i <= 1; i++) {
          seg(cx - s * 0.46, cy + i * s * 0.3, cx + s * 0.32, cy + i * s * 0.3, 2.4, i === 0 ? 1 : 0.55)
        }
        break
      case 'crit':     // 准星
        neonCircle(g, cx, cy, s * 0.4, col, { width: 2.4, bloom: false })
        seg(cx - s * 0.62, cy, cx - s * 0.2, cy); seg(cx + s * 0.2, cy, cx + s * 0.62, cy)
        seg(cx, cy - s * 0.62, cx, cy - s * 0.2); seg(cx, cy + s * 0.2, cx, cy + s * 0.62)
        break
      case 'range':    // 同心弧
        for (let i = 0; i < 3; i++) {
          path(() => { g.arc(cx - s * 0.34, cy, s * (0.3 + i * 0.2), -0.85, 0.85); g.stroke() }, 2.2, 1 - i * 0.28)
        }
        break
      case 'armor':    // 盾形
        path(poly([cx, cy - s * 0.5, cx + s * 0.42, cy - s * 0.26, cx + s * 0.32, cy + s * 0.3,
          cx, cy + s * 0.52, cx - s * 0.32, cy + s * 0.3, cx - s * 0.42, cy - s * 0.26]))
        break
      case 'dodge':    // 划开的斜线 = 躲开
        seg(cx - s * 0.5, cy + s * 0.42, cx + s * 0.06, cy - s * 0.14, 2.8)
        seg(cx + s * 0.3, cy - s * 0.38, cx + s * 0.5, cy - s * 0.5, 2.8, 0.5)
        seg(cx + s * 0.14, cy - s * 0.52, cx + s * 0.52, cy - s * 0.14, 2.2, 0.55)
        break
      case 'speed':    // 双层人字
        for (let i = 0; i < 2; i++) {
          path(() => {
            g.moveTo(cx - s * 0.46 + i * s * 0.34, cy - s * 0.36)
            g.lineTo(cx - s * 0.08 + i * s * 0.34, cy)
            g.lineTo(cx - s * 0.46 + i * s * 0.34, cy + s * 0.36); g.stroke()
          }, 2.8, 1 - i * 0.4)
        }
        break
      case 'pickup':   // 磁吸：中心圆 + 两侧外弧
        neonCircle(g, cx, cy + s * 0.08, s * 0.26, col, { width: 2.4, bloom: false })
        path(() => { g.arc(cx, cy + s * 0.08, s * 0.5, -0.75, 0.75); g.stroke() }, 2.4, 0.6)
        path(() => { g.arc(cx, cy + s * 0.08, s * 0.5, Math.PI - 0.75, Math.PI + 0.75); g.stroke() }, 2.4, 0.6)
        break
      case 'luck':     // 四角星
        path(poly([cx, cy - s * 0.52, cx + s * 0.14, cy - s * 0.14, cx + s * 0.52, cy,
          cx + s * 0.14, cy + s * 0.14, cx, cy + s * 0.52, cx - s * 0.14, cy + s * 0.14,
          cx - s * 0.52, cy, cx - s * 0.14, cy - s * 0.14]))
        break
      case 'regen':    // 循环箭头
        path(() => { g.arc(cx, cy, s * 0.38, 0.55, Math.PI * 1.72); g.stroke() }, 2.6)
        seg(cx + s * 0.18, cy - s * 0.46, cx + s * 0.46, cy - s * 0.24, 2.4)
        seg(cx + s * 0.46, cy - s * 0.24, cx + s * 0.2, cy - s * 0.16, 2.4)
        break
      case 'killO2':   // 环 + 十字（回氧）
        neonCircle(g, cx, cy, s * 0.44, col, { width: 2.2, bloom: false })
        seg(cx - s * 0.2, cy, cx + s * 0.2, cy, 2.6)
        seg(cx, cy - s * 0.2, cx, cy + s * 0.2, 2.6)
        break
      default:         // o2Bonus · 扩容气瓶：胶囊 + 加号
        path(() => { g.strokeRoundRect(cx - s * 0.28, cy - s * 0.46, s * 0.56, s * 0.92, s * 0.28) }, 2.4)
        seg(cx - s * 0.13, cy, cx + s * 0.13, cy, 2.4)
        seg(cx, cy - s * 0.13, cx, cy + s * 0.13, 2.4)
        break
    }
  }

  /**
   * 属性卡的**进度条**（web `drawStatGauge`）：浅色段 = 买完之后到哪、深色段 = 现在到哪。
   * 两个数字直接可比较，玩家不用心算"再买 3 张是多少"。
   */
  private statGauge(cx: number, cy: number, cardId: string, w: DiveWorld): void {
    const g = this.g
    const MAP: Record<string, { k: keyof Stats; add: number }> = {
      speed: { k: 'speed', add: 0.15 },
      pickup: { k: 'pickup', add: 0.4 },
      tank: { k: 'o2Bonus', add: 20 },
      gill: { k: 'killO2', add: 3 },
      s_dmg: { k: 'dmg', add: 0.12 },
      s_rate: { k: 'rate', add: 0.10 },
      s_crit: { k: 'crit', add: 0.08 },
      s_range: { k: 'range', add: 0.15 },
      s_armor: { k: 'armor', add: 0.08 },
      s_dodge: { k: 'dodge', add: 0.06 },
      s_regen: { k: 'regen', add: 0.4 },
      s_luck: { k: 'luck', add: 0.15 },
    }
    const m = MAP[cardId]
    if (!m) { neonCircle(g, cx, cy, 20, BRIGHT.stat, { width: 2, bloom: false }); return }
    // 满值：有上限的用上限，没有的给一个"看起来合理的"参考刻度
    const full = STAT_CAP[m.k] ?? (m.k === 'o2Bonus' ? 100 : m.k === 'killO2' ? 12 : 1.0)
    const cur = clamp01(w.st[m.k] / full)
    const next = clamp01((w.st[m.k] + m.add) / full)
    const bw = 168, bh = 20
    const x0 = cx - bw / 2, y0 = cy - bh / 2
    // 进度条颜色跟**属性本身**走（和上面的大符号同色）：一律用同一种色等于放弃"余光辨色"
    const gcol = STAT_META.find(x => x.k === m.k)?.col ?? BRIGHT.stat
    g.fill(BRIGHT.slot, 1); g.fillRoundRect(x0, y0, bw, bh, 7)
    g.fill(gcol, 0.35); g.fillRoundRect(x0, y0, Math.max(2, bw * next), bh, 5)
    g.fill(gcol, 0.95); g.fillRoundRect(x0, y0, Math.max(2, bw * cur), bh, 5)
    g.line(BRIGHT.divider, 1, 1); g.strokeRoundRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1, 5)
    // 增量段上标一个箭头 —— 否则玩家看不出"浅色那段是我要买的"
    if (next > cur + 0.01) {
      const mx = x0 + (bw * (cur + next)) / 2
      g.fill(gcol, 0.95)
      g.moveTo(mx - 3, y0 - 4); g.lineTo(mx + 3, y0 - 4); g.lineTo(mx, y0 + 1)
      g.close(); g.fillPath()
    }
    const shown = (m.k === 'o2Bonus' || m.k === 'killO2' || m.k === 'regen')
      ? `${w.st[m.k].toFixed(m.k === 'regen' ? 1 : 0)} → ${(w.st[m.k] + m.add).toFixed(m.k === 'regen' ? 1 : 0)}`
      : `${Math.round(w.st[m.k] * 100)}% → ${Math.round(Math.min(full, w.st[m.k] + m.add) * 100)}%`
    this.center(cx, cy + 22, shown, 12, TXT_LIGHT.accent)
  }

  /**
   * 挂载位示意图（挂载扩容卡）。与战斗内**同一套角度常量与半径比例** ——
   * 图上的记号在游戏里对不上，卡的说明就成废纸（所以这里和 `DiveGame.drawTurret`
   * 共用 `SEAT_ANGLES_DEG` / `SEAT_RING_R` / `TURRET_R`）。
   *
   * ⚠️ 椭圆的参数语义反了：web 的 `strokeEllipse(cx,cy,w,h)` 收**直径**，
   *    Cocos 的 `ellipse` 收**半径** —— web 写 `bodyL*2`，这里必须写 `bodyL`（坑 13）。
   */
  private mountDiagram(cx: number, cy: number, id: string, boxH: number, w: DiveWorld): void {
    const g = this.g
    const target = id === 't_slot5' ? 5 : id === 't_slot6' ? 6 : w.maxWeapons
    const n = Math.max(target, w.maxWeapons)
    // 缩放由**立绘框实际高度**决定，而不是写死系数（写死会在卡高变化时把图示顶出框）
    const needH = SEAT_RING_R * 2 * 1.15 * 1.7 + 16
    const k = Math.max(0.30, Math.min(0.72, (boxH - 8) / needH))
    const R = SEAT_RING_R * k
    const bodyL = 30 * k, bodyW = 15 * k

    // 艇身（俯视椭圆，与实机 99×52 的长宽比一致）
    neon(g, UI.cyanDim, () => { g.ellipse(cx, cy, bodyL, bodyW); g.stroke() },
      { width: 1.2, alpha: 0.45, bloom: false })

    for (let i = 0; i < n; i++) {
      const a = (SEAT_ANGLES_DEG[i] * Math.PI) / 180
      const x = cx + R * Math.cos(a)
      const y = cy + R * Math.sin(a)
      const occupied = i < w.weapons.length
      const isNew = i === target - 1
      const ext = i >= BASE_SEATS
      const col = occupied ? WEAPON_DEF[w.weapons[i].id].color : UI.cyan
      const r = TURRET_R * k * (ext ? 1.15 : 1)
      if (occupied) {
        g.fill(UI.panel, 0.6); g.fillCircle(x, y, r)
        neonCircle(g, x, y, r, col, { width: 1.4, alpha: 0.95, bloom: false })
        g.fill(col, 0.95); g.fillCircle(x, y, r * 0.34)
      } else {
        g.line(isNew ? UI.amber : UI.cyanDim, isNew ? 1 : 0.45, isNew ? 1.8 : 1)
        g.strokeCircle(x, y, r)
      }
      // 新解锁位：外面套一圈闪烁提示环（这是"你买的到底是哪一座"的唯一显式信号）
      if (isNew) {
        const blink = 0.45 + 0.55 * Math.abs(Math.sin(w.t * 5))
        neonCircle(g, x, y, r * 1.7, UI.amber, { width: 1.8, alpha: blink, bloom: false })
      }
    }
    this.center(cx, cy + bodyW + 14, `${w.weapons.length} → ${target} 座`, 12, TXT_LIGHT.dim)
  }

  /** 等级点（web `drawLevelPips`）：5 格，已到的实心、未到的空心描边 */
  private levelPips(cx: number, cy: number, lvl: number, col: number): void {
    const g = this.g
    const n = 5, gap = 11, pw = 7
    const x0 = cx - ((n - 1) * gap) / 2
    for (let i = 0; i < n; i++) {
      const x = x0 + i * gap
      if (i < lvl) { g.fill(col, 0.95); g.fillRect(x - pw / 2, cy - 2.5, pw, 5) }
      else { g.line(col, 0.4, 1); g.strokeRect(x - pw / 2, cy - 2.5, pw, 5) }
    }
  }

  /**
   * 波间商店。
   *
   * -----------------------------------------------------------------------
   * V7 重做：全屏暗色实底 → **半透明暗幕 + 居中面板**（2026-10-13 上午）
   * -----------------------------------------------------------------------
   * 用户原话：「商店你最好重新用UI概念图 现在是全屏的 太大了 我需要亮色的 现在画风很暗」。
   *   · 「全屏的」   → 旧版 `pageFill(MENU.page, 1)` 是一整块**不透明**近黑，等于把游戏切走。
   *                    改成暗幕 + 一块只占屏约 54% 宽的面板，深海与机体留在四周。
   *   · 「太大了」   → 卡片 300×330 → 204×350；面板整体宽 948 → 700。
   *   · 「画风很暗」 → 面板走 `BRIGHT` 皮肤。
   *                    ⚠️ 换底色必须**同时换文字色**（`TXT` → `TXT_LIGHT`），
   *                    只换底会得到"白字白底"，是这类改版最经典的事故。
   *
   * -----------------------------------------------------------------------
   * V8 回调：近白 → **中调**；卡片改成**立绘主导**（2026-10-13 下午）
   * -----------------------------------------------------------------------
   * 用户原话：「商店又太亮了 要中等色差 最要有立绘UI布局感」。两条改动：
   *   · 「太亮 / 中等色差」 → `BRIGHT` 由近白（对比 15:1）降到中调水青（对比 ~5:1），
   *     文字翻成浅色。见 `theme.ts` 的 V8 注释。
   *   · 「立绘 UI 布局感」   → 卡片从"信息为主、立绘是 84px 的小条"改成
   *     **立绘占卡面上半**，且立绘位顶部压一条类型色、
   *     内侧做三层递减暗带伪内凹 —— 视觉上先看到"这是个什么东西"，再读数字。
   *     价格行并进购买按钮（`购买 · 45`），把省下的行高让给立绘。
   *
   * -----------------------------------------------------------------------
   * V9 修 bug + 重排（2026-10-13 傍晚）
   * -----------------------------------------------------------------------
   * 用户原话：「发射器变形了」+「整体重排商店」。
   *   · **变形 = 立绘框比例错**：V8 的框是 **176×148（1.19:1）**，而素材管线下（`process_item_art.py`）
   *     立绘是 **2:1 画布**。框与画布不同比例 ⇒ 立绘放不满 + 上下死空间。
   *     归位 **176×88（2:1）** 后：卡高 356 → **292**，面板高 534 → **470**（占屏 71% → 63%）。
   *     即「太大了」这条反馈是靠**砍死空间**解决的，不是把内容压小。
   *   · 另修 `putArt` 取错尺寸源的 bug（`rect` → `originalSize`），见该方法注释。
   *   · 字号阶梯整体上移：标题 19→20、名称 16→17、描述/副标题/类型/遗物代价 12→**13**、
   *     状态行 12→**14**（关键信息，与描述拉开一档）。
   */
  drawShop(w: DiveWorld, cbs: {
    onBuy: (i: number) => void
    onReroll: () => void
    onLock: (i: number) => void
    onLeave: () => void
  }): void {
    const W = this.W, H = this.H
    const g = this.g

    // 底幕：半透明（不是实黑）—— 让深海透出来，弹窗感才立得住
    this.scrim(0.66)

    // 面板几何：宽度跟随卡片总宽（自适应设计分辨率），高度是各分区之和
    const cw = 204, gap = 18, pad = 26
    const pw = cw * 3 + gap * 2 + pad * 2
    // 2026-10-13：卡高 356 → **292**。立绘框归位 2:1（176×88，见 shopCard）后，
    // 原本框下方那片「立绘放不满、名字又钉在卡底」的死空间随之消失。
    // 面板高 534 → **470**（占屏高 71% → 63%）—— 「商店太大」这条反馈靠**砍死空间**解决，
    // 而不是把卡压小：卡宽仍 204，信息一个没少。
    const headerH = 56, cardH = 292, footH = 56, vpad = 20
    const ph = vpad * 2 + headerH + 12 + cardH + 14 + footH
    const px = (W - pw) / 2
    const py = (H - ph) / 2
    this.brightPanel(px, py, pw, ph)

    const ix = px + pad
    const iy = py + vpad

    // ---- 顶栏：标题 + 副标题 + 骨币胶囊（右）----
    this.text(ix, iy + 18, `L${w.layerIdx + 1} ${LAYERS[w.layerIdx].name} · 波间补给`, 20, TXT_LIGHT.main)
    this.text(ix, iy + 41, `第 ${w.waveInLayer + 1} 波结束 · 点卡片或按 1 / 2 / 3 购买`, 13, TXT_LIGHT.dim)

    const bankStr = `${w.bank}`
    const pillW = 34 + bankStr.length * 11 + 42
    const pillX = px + pw - pad - pillW
    const pillY = iy + 15
    g.fill(BRIGHT.card, 1); g.fillRoundRect(pillX, pillY, pillW, 28, 14)
    g.line(BRIGHT.edge, 0.8, 1); g.strokeRoundRect(pillX + 0.5, pillY + 0.5, pillW - 1, 27, 14)
    g.line(BRIGHT.relic, 0.95, 1.8); g.strokeCircle(pillX + 17, pillY + 14, 7)
    this.text(pillX + 29, pillY + 14, bankStr, 17, TXT_LIGHT.main)
    this.text(pillX + pillW - 9, pillY + 15, '鱼骨', 12, TXT_LIGHT.dim, true)

    // ---- 三张卡 ----
    const cy0 = iy + headerH + 12
    for (let i = 0; i < 3; i++) this.shopCard(ix + i * (cw + gap), cy0, cw, cardH, i, w, cbs)

    // ---- 底栏：刷新（次）/ 继续（主，最亮的那个）----
    const fy = py + ph - vpad - footH / 2
    const bw = 196
    this.button(W / 2 - bw / 2 - 16, fy, bw, 46, `刷新 ${w.rerollCost}`, cbs.onReroll,
      w.bank >= w.rerollCost, BTN_BRIGHT_SECONDARY)
    this.button(W / 2 + bw / 2 + 16, fy, bw, 46, '继续 ▶ 下一波', cbs.onLeave, true, BTN_BRIGHT_PRIMARY)
  }

  /**
   * 商店 · 单张卡（亮色皮肤）。
   *
   * 卡内分区自上而下：键帽/类型/锁定 → 立绘槽 → 名称 → 描述 → 价格 → 购买按钮。
   * 立绘槽**比卡面深**（`BRIGHT.slot` < `BRIGHT.card`）—— 亮色立绘要靠"更深的底"跳出来，
   * 垫光晕只会把画面弄脏（这是 web 量过亮度方差后定下的，不是审美偏好）。
   */
  private shopCard(x: number, y: number, cw: number, ch: number, i: number,
                   w: DiveWorld, cbs: { onBuy: (i: number) => void; onLock: (i: number) => void }): void {
    const g = this.g
    const up: UpgradeDef | undefined = w.offers[i]
    const sold = w.sold[i]
    const locked = w.locked[i]
    const afford = up ? w.bank >= up.cost : false

    // 类型色：器械青 / 挂载琥珀 / 属性紫 / 遗物靛
    const typeCol = !up ? BRIGHT.edge
      : up.kind === 'relic' ? BRIGHT.relic
        : up.kind === 'mount' ? BRIGHT.mount
          : up.kind === 'weapon' ? BRIGHT.weapon : BRIGHT.stat

    // ---- 整卡热区（**必须最先申请** —— 理由见 BTN_HIT：创建顺序即命中优先级）----
    // 副标题承诺「点卡片购买」，这一行把它兑现。`buyCard()` 自带 phase / sold / 付费三重守卫，
    // 所以空卡、已售卡、买不起都不需要在这里再判一次。
    this.button(x + cw / 2, y + ch / 2, cw, ch, '', () => cbs.onBuy(i), true, BTN_HIT)

    // 卡体：中调实底。三态靠"卡面压暗 + 描边亮度"分档（买不起整张压一档）
    g.fill(sold ? BRIGHT.slot : (afford ? BRIGHT.card : BRIGHT.cardOff), 1)
    g.fillRoundRect(x, y, cw, ch, 12)
    // 上缘高光：中调底上压到 α.30 —— 再亮就成了一条白边
    g.fill(0xffffff, sold ? 0.08 : 0.30); g.fillRoundRect(x + 12, y + 2, cw - 24, 2, 1)
    g.line(typeCol, sold ? 0.35 : (afford ? 0.95 : 0.45), 2)
    g.strokeRoundRect(x + 1, y + 1, cw - 2, ch - 2, 11)

    // ---- 键帽 1/2/3（暗示"这个键可以按"）----
    const kc = 22
    g.fill(0x000000, 0.22); g.fillRoundRect(x + 12, y + 13, kc, kc, 6)
    g.fill(0x578ba0, 1); g.fillRoundRect(x + 12, y + 12, kc, kc, 6)
    g.line(afford ? typeCol : BRIGHT.edge, afford ? 0.95 : 0.55, 1)
    g.strokeRoundRect(x + 12.5, y + 12.5, kc - 1, kc - 1, 6)
    this.center(x + 12 + kc / 2, y + 12 + kc / 2, `${i + 1}`, 13,
      afford ? TXT_LIGHT.main : TXT_LIGHT.mute)

    // ---- 类型标签 ----
    if (up) {
      const kindLabel = up.kind === 'weapon' ? '器械'
        : up.kind === 'mount' ? '挂载' : up.kind === 'relic' ? '遗物' : '属性'
      this.text(x + 42, y + 23, kindLabel, 13, TXT_LIGHT.dim)
    }

    // ---- 锁定按钮（右上，**独立热区** —— 和购买按钮挤在一起会误点成买卡）----
    // 2026-10-13：热区由 52×22 抬到 56×30。22px 高远低于 44px 触屏下限，
    // 且它压在整卡热区之上（先申请热区、后申请本按钮），是卡内唯一的误触源。
    // 30 是**不侵入下方立绘槽**（y+48 起）的上限。
    this.button(x + cw - 40, y + 23, 56, 30, locked ? '已锁' : '锁定',
      () => cbs.onLock(i), !sold, locked ? BTN_BRIGHT_LOCKED : BTN_BRIGHT_TINY)

    if (!up) {
      this.center(x + cw / 2, y + ch / 2, sold ? '已购买' : '空', 15, TXT_LIGHT.mute)
      return
    }

    // ---- 立绘区（**卡片主体**：176×88 = **2:1**，与素材画布同比例）----
    // ⚠️ 框的比例不是随便定的：`tools/process_item_art.py` 规定立绘统一 **2:1 画布**、
    //    内容按 FILL=0.86 居中。框一旦不是 2:1，就会出现「立绘放不满 + 上下大片死空间」——
    //    V8 那版是 176×148（1.19:1），正是"死空间"和"看着被拉扁"的来源。
    //    框与画布同比例 ⇒ contain 零浪费、也从不拉伸。
    // 立体感用与战斗里炮塔**同一套语言**：内凹 + 左上受光 + 硬边。
    // 两层递减暗带代替渐变（引擎无渐变填充），让这块读作"凹进去的展示窗"。
    const cxm = x + cw / 2
    const ax = x + 14, ay = y + 48, aw = cw - 28, ah = 88
    g.fill(BRIGHT.slot, 1); g.fillRoundRect(ax, ay, aw, ah, 10)
    g.fill(UI.abyss, 0.18); g.fillRect(ax + 1, ay + 1, aw - 2, 8)
    g.fill(UI.abyss, 0.10); g.fillRect(ax + 1, ay + 9, aw - 2, 5)
    // 顶端压一条**类型色**：扫视时先读到"这是什么类型"，再读名字
    g.fill(typeCol, sold ? 0.35 : 0.9); g.fillRect(ax + 4, ay + 3, aw - 8, 3)
    g.line(BRIGHT.divider, 0.9, 1); g.strokeRoundRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1, 10)
    const artKey = this.cardArtKey(up)
    const artSf = artKey ? this.art.get(artKey) : undefined
    this.putArt(cxm, ay + ah / 2 + 4, aw - 16, ah - 16, artSf, sold ? 0.4 : 1)

    // 没有立绘的卡**按类型补代码图形** —— 旧版这里一律画一个"—"，
    // 属性卡 / 挂载卡整张看起来像"资源没加载出来"。这才是"商店资源不对"的实质。
    const wid = this.cardWeaponId(up)
    const artCy = ay + ah / 2 + 4
    if (!artSf) {
      if (up.kind === 'mount') {
        this.mountDiagram(cxm, artCy - 6, up.id, ah, w)
      } else if (up.kind === 'relic') {
        this.relicIcon((up.relicId ?? 'echo_heart') as RelicId, cxm, artCy, 30)
      } else if (up.kind === 'weapon') {
        // w_all（弹药改良）没有武器 id，用 gun 的形状签名兜底
        this.weaponIcon(wid ?? 'gun', cxm, artCy, 34)
      } else {
        const sk = STAT_CARD[up.id]
        if (sk) {
          const gcol = STAT_META.find(m => m.k === sk)?.col ?? UI.cyan
          // 立绘框 148 → 88 后，图腾 / 量槽的偏移同比收小 ——
          // 否则图腾会戳出框顶、量槽落到框外压到名字（框内高度只剩 88）
          this.statGlyph(sk, cxm, artCy - 16, 48, gcol)
          this.statGauge(cxm, artCy + 32, up.id, w)
        }
      }
    }

    // 已持有的同款武器：在立绘底缘点出**等级点**（+ 台数），否则玩家会以为重复拿是白拿
    if (wid) {
      const heldAll = w.weapons.filter(x2 => x2.id === wid)
      if (heldAll.length) {
        const topLvl = Math.max(...heldAll.map(x2 => x2.lvl))
        this.levelPips(cxm, ay + ah - 10, topLvl, WEAPON_DEF[wid].color)
        if (heldAll.length > 1) this.text(cxm + 36, ay + ah - 16, `×${heldAll.length}`, 12, TXT_LIGHT.accent)
      }
    }

    // ---- 名称 / 描述 ----
    // 行位全部**从卡底往上排**（`ch - N`）而不是写死绝对值 —— 改卡高时下半区整体跟着走，
    // 不会出现"立绘变高了、名字还钉在原地"的错位。
    this.center(cxm, y + ch - 134, up.name, 17, sold ? TXT_LIGHT.mute : TXT_LIGHT.main)
    this.center(cxm, y + ch - 112, fitText(up.desc, 13, cw - 22), 13, TXT_LIGHT.dim)

    // ---- 状态行：**买了会发生什么**必须写死（玩家不该靠猜是"新武器"还是"强化"）----
    let foot = ''
    let footWarn = false
    const evoBase = wid ? evolutionBase(wid) : null
    if (wid && evoBase) {
      // 进化卡要先拦下来：它是"把现役那台改造成新形态"，**不占新座位**
      foot = `进化现役「${WEAPON_DEF[evoBase].name}」· 不占新座位`
    } else if (wid) {
      const held = w.weapons.filter(x2 => x2.id === wid).length
      const cap = Math.min(w.maxWeapons, MAX_SEATS)
      if (held === 0) foot = `新装备 · 占 1 座位（共 ${cap}）`
      else if (w.weapons.length < cap) foot = `加装第 ${held + 1} 台 · 并联开火`
      else { foot = '座位已满 · 并进现役升级'; footWarn = true }
    } else if (up.id === 'w_all') {
      foot = `${w.weapons.length} 台器械同时 +1 级`
    } else if (up.kind === 'mount') {
      foot = up.id === 't_twin' ? '扩容座射速 +25%'
        : `座圈 ${w.maxWeapons} → ${up.id === 't_slot5' ? 5 : 6} 座`
    } else if (up.kind === 'relic') {
      foot = w.relics.length < RELIC_SLOTS
        ? `占用遗物槽 ${w.relics.length + 1} / ${RELIC_SLOTS}` : '遗物槽已满'
      footWarn = w.relics.length >= RELIC_SLOTS
    }
    if (foot) {
      // 状态行是全卡**最关键的一条**（"买了会发生什么"）—— 字号抬到 **14** 与描述（13）拉开一档，
      // 并保留告警色。原来它和描述同色同字号，玩家得自己猜是"新装备"还是"强化"。
      this.center(cxm, y + ch - 92, fitText(foot, 14, cw - 20), 14,
        sold ? TXT_LIGHT.mute : (footWarn ? TXT_LIGHT.warn : TXT_LIGHT.dim))
    }

    // 遗物代价**单独一行、告警色** —— 把它藏在描述里等于骗玩家，他会在第三波才发现氧气少了
    if (up.kind === 'relic' && up.relicId) {
      const cost2 = RELIC_DEF[up.relicId]?.cost2
      if (cost2) {
        this.center(cxm, y + ch - 72, fitText(cost2, 13, cw - 20), 13,
          sold ? TXT_LIGHT.mute : TXT_LIGHT.warn)
      }
    }

    // ---- 购买按钮（按类型色着色，与卡描边同色）----
    // 价格**并进按钮**（`购买 · 45`），把省下的那一行让给立绘。
    // 买不起时直接给**差额**（`缺 7 鱼骨`）—— 「鱼骨不足」这种文案玩家还得自己回顶栏算。
    this.button(cxm, y + ch - 34, cw - 28, 36,
      sold ? '已售出' : (afford ? `购买 · ${up.cost}` : `缺 ${up.cost - w.bank} 鱼骨`),
      () => cbs.onBuy(i), !sold && afford,
      (!sold && afford) ? lightBuyBtn(typeCol) : BTN_BRIGHT_DISABLED)
  }

  // -------------------------------------------------------------------------
  // 层末：补给站决策
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // 暂停（2026-10-13 新增）
  // -------------------------------------------------------------------------
  /**
   * 战斗内暂停菜单。
   *
   * 为什么必须补：此前战斗中按 ESC 走的是 `restartRun()` —— 局内**没有任何**
   * 回到主界面的路径（`toTitle()` 只被结算屏调用），玩家想退出只能自杀，
   * 按 ESC 还会白打一局重开。这是可用性缺陷，不是"少个功能"。
   *
   * `opts.confirm` = 二次确认态（点过「返回主界面」之后才出现）：
   * 一局可能已经打了几分钟，误点一脚回标题 = 白打，所以退到主界面必须再确认一次。
   *
   * 面板语汇沿用商店 / 结算那一套（`MENU.page` 实底 + 描边 + 标题栏分隔线），
   * 不是新开一套皮肤 —— 同一个游戏里的弹窗长得一样，玩家才不用重新学。
   */
  drawPause(w: DiveWorld, cbs: {
    onResume: () => void
    onRestart: () => void
    onAskTitle: () => void
    onConfirmTitle: () => void
    onCancelConfirm: () => void
  }, opts: { confirm: boolean } = { confirm: false }): void {
    const W = this.W, H = this.H
    const cx = W / 2, cy = H / 2
    const g = this.g

    // 半透明压暗（不是实黑）：暂停时背后的战场要看得见，玩家才知道自己停在哪
    this.scrim(0.74)

    const pw = 440, ph = opts.confirm ? 292 : 344
    const px = cx - pw / 2, py = cy - ph / 2
    g.fill(MENU.page, 0.96); g.fillRoundRect(px, py, pw, ph, 16)
    g.line(MENU.edge, 0.95, 1.5); g.strokeRoundRect(px, py, pw, ph, 16)
    // 标题栏分隔线：与商店 / 结算面板同一套语汇（不是新皮肤）
    g.line(UI.cyanDim, 0.7, 1)
    g.strokeSeg(px + 1, py + 62, px + pw - 1, py + 62)

    if (!opts.confirm) {
      this.center(cx, py + 32, '已暂停', 26, TXT.cyber)
      this.center(cx, py + 84, `氧气 ${Math.ceil(w.o2)} / ${w.o2Max} · 敌人与计时已冻结`, 14, TXT.dim)
      const bw = 288, bh = 50
      this.button(cx, cy - 14, bw, bh, '继续游戏', cbs.onResume, true)
      this.button(cx, cy + 56, bw, bh, '重新开始', cbs.onRestart, true)
      this.button(cx, cy + 126, bw, bh, '返回主界面', cbs.onAskTitle, true)
      this.center(cx, py + ph + 28, 'ESC 继续游戏', 13, TXT.mute)
    } else {
      this.center(cx, py + 32, '返回主界面？', 24, TXT.warn)
      this.center(cx, py + 84, '本局进度将丢失', 16, TXT.main)
      this.center(cx, py + 112, '本局带出的生物质按 0 计 · 已沉淀的部分不受影响', 13, TXT.dim)
      const bw = 188, bh = 50
      this.button(cx - 104, cy + 58, bw, bh, '取消', cbs.onCancelConfirm, true)
      this.button(cx + 104, cy + 58, bw, bh, '确认返回', cbs.onConfirmTitle, true)
    }
  }

  drawDecide(w: DiveWorld, cbs: { onDive: () => void; onSurface: () => void }): void {
    const W = this.W, H = this.H
    this.pageFill(MENU.page, 0.88)
    const toll = w.layer().toll
    const canDive = w.o2 > toll
    this.center(W / 2, H / 2 - 90, `L${w.layerIdx + 1} ${w.layer().name} · 补给站`, 24, TXT.cyber)
    this.center(W / 2, H / 2 - 52, '氧气够就继续下潜，收益翻倍；不够就只能带走现有的', 15, TXT.dim)
    this.center(W / 2, H / 2 - 10,
      `当前氧气 ${Math.ceil(w.o2)} / ${w.o2Max}    门票 -${toll} O₂    收益 ×${w.mult.toFixed(1)} → ×${(w.mult + 0.5).toFixed(1)}`,
      15, TXT.main)
    this.button(W / 2 - 120, H / 2 + 70, 210, 50, canDive ? '继续下潜 ↓' : '氧气不足', cbs.onDive, canDive)
    this.button(W / 2 + 120, H / 2 + 70, 210, 50, '上浮兑现 ▲', cbs.onSurface, true)
  }

  // -------------------------------------------------------------------------
  // 结算
  // -------------------------------------------------------------------------
  /**
   * 结算屏（V6.36 起加"沉淀 / 解锁"两行，见元系统设计 §4.2）。
   *
   * 纵向阶梯（H=749）：标题 −104 → 带出 −56 → 公式 −16 → 层波 +12 →
   * 信息行从 +44 起**逐行下移**（只画有内容的行，不留空行）→ 按钮取
   * `max(信息行底 + 40, +140)`，保证信息再多也不会压到按钮。
   *
   * ⚠️ 溺水时**必须显式写"无沉淀"**：不写的话玩家分不清"浅捞一点上浮"
   * 和"全损"的区别，反而削弱 §10 那条"下潜 vs 上浮"的止损线。
   */
  drawResult(w: DiveWorld, cbs: { onRestart: () => void; onTitle: () => void },
             opts: { record?: string | null; banked?: number; bio?: number; unlocked?: string[] } = {}): void {
    const W = this.W, H = this.H
    const record = opts.record ?? null
    const banked = opts.banked ?? 0
    const bio = opts.bio ?? 0
    const unlocked = opts.unlocked ?? []
    this.pageFill(MENU.page, 0.92)
    const finalBio = w.win ? Math.floor(w.biomass * w.mult) : 0
    this.center(W / 2, H / 2 - 104,
      w.win ? (w.bossDown ? '击杀深渊守望者 · 上浮' : '上浮成功') : '氧气耗尽 · 溺水',
      26, w.win ? TXT.cyber : TXT.warn)
    this.center(W / 2, H / 2 - 56, `带出生物质 ${finalBio}`, 28, TXT.jade)
    this.center(W / 2, H / 2 - 16, w.win
      ? `${w.biomass} × ${w.mult.toFixed(1)}（下潜 ${w.layerIdx} 层）`
      : `沉没的 ${Math.floor(w.biomass * w.mult)} 生物质全部损失`, 15, w.win ? TXT.amber : TXT.warn)
    this.center(W / 2, H / 2 + 12, `L${w.layerIdx + 1} ${LAYERS[w.layerIdx].name} · 第 ${w.waveInLayer + 1} 波`, 14, TXT.dim)

    // 信息行：只画有内容的，逐行下移（沿用"没有就不画"的惯例）
    let y = H / 2 + 44
    if (record) { this.center(W / 2, y, record, 16, TXT.cyan); y += 26 }
    if (banked > 0) {
      this.center(W / 2, y, `沉淀 +${banked} 生物质（总额 ${bio}）`, 16, TXT.amber); y += 26
    } else if (!w.win) {
      // 溺水：显式说明"无沉淀"，否则玩家不知道沉淀这一栏为什么消失
      this.center(W / 2, y, '溺水 · 生物质全损，无沉淀', 16, TXT.warn); y += 26
    }
    if (unlocked.length) { this.center(W / 2, y, `解锁：${unlocked.join(' · ')}`, 16, TXT.jade); y += 26 }

    const by = Math.max(y + 40, H / 2 + 140)
    this.button(W / 2 - 115, by, 210, 52, '再来一次', cbs.onRestart, true)
    this.button(W / 2 + 115, by, 210, 52, '返回主界面', cbs.onTitle, true)
  }
}
