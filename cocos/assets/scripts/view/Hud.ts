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
import { neon, neonLine, neonCircle, lerpColor } from './neon'
import { SpriteBank } from './art'
import { UI, TXT, MENU, BRIGHT, TXT_LIGHT } from '../shared/theme'
import {
  LAYERS, RELIC_SLOTS, STAT_META, STAT_CARD, STAT_CAP, WEAPON_DEF, CARD_WEAPON_ID,
  O2, MAX_SEATS, BONE, weaponFamily, evolutionBase, RELIC_DEF, layerO2, EVOLUTIONS,
  SEAT_MOUNTS, MOUNT_BASE_R, HULL_H, SUB_D, BASE_SEATS,
} from '../shared/dive/tables'
import type { DiveWorld } from '../shared/dive/world'
import type { UpgradeDef, WeaponId, RelicId, Stats } from '../shared/dive/types'

/** 夹到 [0,1] —— 氧条比例、冷却进度、下潜进度都用它 */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 深度读数的**阻尼跟随**速率（1/s）。换波时 `w.depthM` 是**阶跃**的
 * （`L.depthTop + (bot−top) × wave/total`），直接显示会"啪"地跳一个数字 ——
 * 那是"计数器更新"，不是"我下沉了一截"。让它以时间常数 ≈0.17s 追上去才有滚动感。
 * ⛔ 不改模拟层：`w.depthM` 仍是真值，**只有显示滞后**。
 */
const DEPTH_FOLLOW = 6

/**
 * **字号阶梯**（V6.74 · 用户："整个界面的字体规划下字体 以及颜色"）。
 *
 * 为什么必须收敛成一个阶梯而不是各处写字号：HUD 上原先散落着
 * 11/12/13/15/16/17/18/20 七档，相邻两档只差 1px —— 差 1px 时人眼读不出
 * "这是标题还是正文"，只会读成"排版不齐"。而且本项目**没有任何 ttf/otf**
 * （`Label` 走 `useSystemFont`）⇒ 层级只能靠**字号 + 字色 + 描边**三件事表达，
 * 字号再糊掉就一件都不剩了。
 *
 * 六档的语义（从大到小只表示"重要程度"，不表示"位置"）：
 *   huge  26  一整屏只有一个（主数值）
 *   big   20  关键数值（氧气量）
 *   title 17  区块标题（波次 / 鱼骨 / 生物质）
 *   lead  15  强调行（剩余秒数 / 倒计时数字）
 *   body  13  正文（默认档）
 *   micro 12  角标 / 槽位编号
 *
 * ⚠️ **micro = 12 是硬下限**（用户长期规约：正文不低于 12px）—— 原来有 11px
 *    的角标，那一档全部抬到 12。
 * ⚠️ 相邻档差 ≥2px：差 1px 的两档在 1304×749 上不可分辨，等于白分。
 */
export const FS = {
  micro: 12,
  body: 13,
  lead: 15,
  title: 17,
  big: 20,
  huge: 26,
} as const

/**
 * **换带提示条的几何**（V6.82 从"通栏压条"改成"居中浮条"）。
 *
 * 用户 2026-10-15 两条：
 *   · 「这个需要高一点」 ⇒ `BAND_Y` 150 → 96；
 *   · 「这个太长了吧 一个提示不应该**适中**提示然后**渐变消失**吗」
 *     ⇒ 通栏（`x24~1080`，1056px）收成 **620×78 居中浮条**，
 *       并且从"整条硬边到点消失"改成**最后 1.0s 渐隐**（原来只有 0.40s）。
 *
 * 为什么原来会是通栏：V6.81 我把"屏幕正中的入场大卡"降级成"上 1/5 压条"，
 * 只解决了"挡住战场"，没解决"提示的**体量**应当是提示级的" —— 一条横跨全屏的
 * 实心条读作"血条 / 加载条"，不读作"提示"。**信息量只有两行，却占了 1056px 宽。**
 *
 * 让位核算（实机 px，与原通栏同源）：
 *   · 氧气条 y 28~42（居中 x 360~690）⇒ 条顶 96 起，不压；
 *   · 波次块 x 760~900 / y 22~70     ⇒ 条右缘 962 与它同高时只到 y 174，无交叠；
 *   · 鱼情雷达 x 1106 起            ⇒ 条右缘 962 < 1106，永久不相交。
 */
const CARD_W = 620
const CARD_Y = 96
const CARD_H = 78

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
  /** 深度**显示值**（阻尼跟随 `w.depthM`，见 `DEPTH_FOLLOW`）。`-1` = 尚未初始化 */
  private depthShown = -1
  /** 上一帧的 `w.t`，用来推 dt。`-1` = 尚未初始化 */
  private lastT = -1
  /**
   * 本轮换带卡**见到过的 `layerCardT` 最大值**（V6.81）。
   *
   * 存在的理由：压条的滑入进度是 `已过时间 = 初值 − layerCardT`，而"初值"写在
   * `world.ts`（2.6）。在这里再写一个 2.6 就是**第二份副本** —— 那边改了这里不报错，
   * 只会让滑入时长静默错位。改成"记住峰值"就只依赖 `layerCardT` 自己。
   * `layerCardT` 归零时清 0，下一带重新记。
   */
  private cardPeak = 0
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

  /**
   * 居中文字。
   *
   * ⚠️ `stroke` / `strokeW`（V6.70 新增）：压在**高饱和色块上**的文字必须有描边。
   * Cocos `Label` 没有 outline 组件（`LabelOutline` 需要 `enableOutline`，但它会额外
   * 走一遍渲染批次，HUD 里上百个 Label 代价太高）⇒ 用**同一段文字画两遍**实现描边：
   * 先画偏移的深色底，再画本色。`Label` 是节点，按 `labels[]` 池取两个即可。
   * 「字号小」这个表象的常见真因就是没描边 —— 深底上 12px 灰字根本读不出来。
   */
  private center(x: number, y: number, s: string, size: number, color: string,
                 right = false, stroke = 0, strokeCol = '#000000'): void {
    if (stroke > 0) {
      const r = Math.max(1, Math.round(stroke * 0.5))
      for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, -r], [-r, r], [r, r]]) {
        this.put(x + dx, y + dy, s, size, strokeCol, right ? 'right' : 'center')
      }
    }
    this.put(x, y, s, size, color, right ? 'right' : 'center')
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
  drawCombat(w: DiveWorld, cbs: {
    onPause?: () => void
    /** 当前展开的槽位说明卡（V6.82）；`null` / 缺省 = 收起 */
    inspect?: { kind: 'seat' | 'relic'; i: number } | null
    /** 点了某个座圈 / 遗物槽（再次点同一个 = 收起 —— 翻转由调用方做） */
    onInspect?: (kind: 'seat' | 'relic', i: number) => void
  } = {}): void {
    const W = this.W, H = this.H
    const L = LAYERS[w.layerIdx]
    const t = w.t
    const g = this.g

    // ===== ① 深度指示（左上）：实时米数 + 层名 + 本层机制 =====
    // 米数是"分层体感"的核心：玩家对 "3,400 m" 有真实的压迫联想，对 "L3 午夜带" 只是一个词。
    //
    // ⚠️ 显示值走**阻尼跟随**（`DEPTH_FOLLOW`）：`w.depthM` 在换波时是**阶跃**的，
    //   直接显示会"啪"地跳一个数字 —— 那是"计数器更新"，不是"我下沉了一截"。
    //   让它追上去（时间常数 ≈0.17s）才有**滚动**的观感。⛔ 模拟层不动，只滞后显示。
    const dx0 = 24, dy0 = 22
    const dt = this.lastT < 0 ? 0 : Math.max(0, Math.min(0.1, t - this.lastT))
    this.lastT = t
    if (this.depthShown < 0) this.depthShown = w.depthM
    // 重新开局会从 11,000m 直接回到 0m —— 大跳变**直接对齐**（否则数字要从头滚一遍，
    // 那读作"这局从深海开始"）。换波最大单跳 ≈1250m（L5），不会误触发。
    if (Math.abs(w.depthM - this.depthShown) > 2000) this.depthShown = w.depthM
    this.depthShown += (w.depthM - this.depthShown) * Math.min(1, dt * DEPTH_FOLLOW)
    const depthStr = Math.round(this.depthShown).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    this.text(dx0, dy0, depthStr, 30, TXT.cyber)
    this.text(dx0 + 12 + depthStr.length * 15, dy0 + 12, 'm', 12, TXT.dim)
    this.text(dx0, dy0 + 26, `L${w.layerIdx + 1} ${L.name}`, 13, TXT.cyber)
    this.text(dx0, dy0 + 44, L.sub, 12, TXT.mute)
    if (L.mech) this.text(dx0, dy0 + 62, `◆ ${L.mech}`, 13, TXT.amber)
    this.text(dx0, dy0 + 86, `×${w.mult.toFixed(1)}`, FS.lead, TXT.amber)

    // ===== ①b 深度计（左侧竖直 · V6.51 §9 第 12 步）=====
    // 原先是 5 条小横杠：它只能回答"我在第几层"，回答不了"我在这一层的哪儿"。
    // 而本作的核心体感恰恰是「我想再往下一点，但氧不够了」—— 那就必须**看得见还剩多深**。
    //
    // ⚠️ 五段**等分**（不是按真实米数比例）：0–200m 只占总深度的 1.8%，
    //   按真实比例 L1 会是一条 7px 的线。这是**地铁图式**的刻意失真 ——
    //   深度计的主信息是"我在旅程的哪一站"（米数由左上角的大字负责）；
    //   而**段内游标仍按真实深度插值** ⇒ 带内是连续的，"刻度失真"没换来"进度失真"。
    {
      const mgX = dx0, mgW = 9
      const mgY0 = 262, mgY1 = H - 128
      const mgH = mgY1 - mgY0, segH = mgH / LAYERS.length
      g.fill(UI.abyss, 0.5); g.fillRect(mgX, mgY0, mgW, mgH)
      for (let i = 0; i < LAYERS.length; i++) {
        const sy = mgY0 + i * segH
        const cur = i === w.layerIdx, done = i < w.layerIdx
        // 段色取该带的 `tint` 并**提亮 38%**（tint 是水色，直接当 UI 色太暗、L5 更是近黑）。
        // 用 tint 而不是另配一套色板：**深度计的颜色与水里看到的颜色对上**，玩家不用学两套配色。
        const sc = lerpColor(LAYERS[i].tint, 0xffffff, 0.38)
        g.fill(sc, done ? 0.75 : (cur ? 1 : 0.30))
        g.fillRect(mgX, sy + 1.5, mgW, segH - 3)
        if (i > 0) { g.line(UI.line, 0.5, 1); g.strokeSeg(mgX - 4, sy, mgX, sy) }
        this.text(mgX + mgW + 12, sy + segH / 2 - 7, LAYERS[i].name, FS.micro,
          cur ? TXT.cyber : (done ? TXT.dim : TXT.mute))
      }
      g.line(UI.cyanDim, 0.6, 1); g.strokeRect(mgX, mgY0, mgW, mgH)

      // 游标：带内按真实深度插值（见上方 ⚠️），所以越往下走它越慢/越快是真实比例
      // ⚠️ 游标跟着**显示值**走（不是 `w.depthM`）：否则数字在滚动、游标已经跳到位，
      //    两者不同步会比都不滚更假。
      const Lc = LAYERS[w.layerIdx]
      const kIn = clamp01((this.depthShown - Lc.depthTop) / Math.max(1, Lc.depthBot - Lc.depthTop))
      const py = mgY0 + (w.layerIdx + kIn) * segH
      g.line(UI.cyanHi, 0.95, 2); g.strokeSeg(mgX - 5, py, mgX + mgW + 5, py)
      g.fill(UI.cyanHi, 1); g.fillRect(mgX + mgW + 1, py - 3, 5, 6)
      g.fill(UI.cyanHi, 0.45 + 0.55 * Math.abs(Math.sin(t * 2.2)))
      g.fillCircle(mgX + mgW / 2, py, 2.6)          // 呼吸锚点：余光里"我在这儿"
    }

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
    //
    // ⚠️ **V6.70 优化（用户："氧气条需要优化"）**。原来这条只有 `当前/上限` + `-x.x/s`
    //   + 一个「危险」线，玩家真正想知道的两件事都没给：
    //   ① **还能撑多久**（秒）—— 玩家要判断的是"够不够打完这一波"，不是"还剩多少点"。
    //   ② **现在处在哪个危险段** —— 原来只有 20% 一根线，是"连续量"却只给一个阈值。
    //   ⇒ 加：分段色阶（≥50% 青 / 20–50% 琥珀 / <20% 危红）+ **剩余秒数**大字 + 临界闪烁。
    //   ⚠️ 秒数必须按**当前真实净耗氧**算（`drain − regen`，且算上当前上限），
    //      拿表里的裸 `drain` 算会和条上显示的速率对不上 —— 两个数字打架比没数字更糟。
    const bw = 420, bh = 20, bx = (W - bw) / 2, by = 26
    const full = Math.max(O2.max, w.o2Max)
    const curRatio = clamp01(w.o2 / full)
    const capRatio = clamp01(w.o2Max / full)
    const pct = w.o2 / Math.max(1, w.o2Max)
    const low = pct < 0.2
    const mid = !low && pct < 0.5
    const barCol = low ? UI.danger : (mid ? UI.amber : UI.cyan)
    // 低氧脉冲用**正弦**而不是方波：方波是"闪"，正弦是"呼吸"，更贴近窒息这个生理联想
    const pulse = low ? 0.6 + 0.4 * Math.abs(Math.sin(t * 4.2)) : 1

    g.fill(UI.panel, 0.75); g.fillRoundRect(bx, by, bw, bh, 9)
    if (capRatio < 1) { g.fill(UI.line, 0.5); g.fillRoundRect(bx + bw * capRatio, by, bw * (1 - capRatio), bh, 9) }

    // 分段底色：先铺一层"当前所处危险段"的整条底色，再在上面画实心剩余量。
    // 这样**空条本身也带语义**（只剩 15% 时，那条槽一眼就是红的），而不是"空的"。
    g.fill(low ? UI.danger : (mid ? UI.amber : UI.cyanDim), low ? 0.16 + 0.10 * Math.abs(Math.sin(t * 4.2)) : 0.12)
    g.fillRoundRect(bx, by, bw, bh, 9)
    g.fill(barCol, pulse); g.fillRoundRect(bx, by, Math.max(2, bw * curRatio), bh, 9)

    // 刻度：每 20 单位一格，让"还剩几格"可以目测（空条上画细刻度、实心区上画暗色刻度）
    for (let v = 20; v < full; v += 20) {
      const tx = bx + bw * (v / full)
      if (tx > bx + bw - 2) break
      const lit = tx <= bx + bw * curRatio
      g.fill(lit ? UI.abyss : UI.line, lit ? 0.45 : 0.55)
      g.fillRect(tx, by + 4, 1, bh - 8)
    }
    // 危险阈值线：20% / 50% 两档 —— 玩家不该靠心算判断"还剩多少会死"
    for (const [frac, isDz] of [[0.5, false], [0.2, true]] as const) {
      const tx = bx + bw * (frac * w.o2Max / full)
      const blink = isDz ? 0.55 + 0.35 * Math.abs(Math.sin(t * 2)) : 0.42
      g.fill(isDz ? UI.danger : UI.amber, blink)
      g.fillRect(tx - (isDz ? 1 : 0.5), by - 3, isDz ? 2 : 1, bh + 6)
    }
    this.center(bx + bw * (0.2 * w.o2Max / full), by + bh + 12, '危险', FS.body, TXT.warn)

    g.line(low ? UI.danger : UI.cyanDim, 0.8, low ? 2 : 1)
    g.strokeRoundRect(bx, by, bw, bh, 9)
    this.center(W / 2, by + bh / 2, `${Math.ceil(w.o2Shown)} / ${w.o2Max}`, FS.big, low ? TXT.warn : TXT.cyber)

    // ---- 剩余秒数（V6.70 新增 · 条**下方**右端）----
    // ⚠️ **不能放条右侧**：`wx0 = bx+bw+18 = 880` 就是波次面板的左边界，
    //    往右写会被「第 N 波 / 环形倒计时 / 剩余 N」整块盖住（画在 `gHud` 同一层，
    //    谁后画谁盖 —— 两个 HUD 块打架是最难查的那类 bug）。
    //    条下方（y = by+bh+12，与「危险」标签同一行）到 x=862 之间是空的，安全。
    // ⛔ `drain ≤ regen`（养满再生）时净耗氧 ≤ 0，秒数是无穷大 ⇒ 必须换文案，
    //   显示成 99+ 会让玩家以为卡住了。
    const sy2 = by + bh + 12
    if (L.drain <= 0.001) {
      this.text(bx + bw, sy2 - 5, '回氧中', FS.lead, TXT.jade, true)
    } else {
      const secs = w.o2 / Math.max(0.05, L.drain)
      const sCol = secs < 10 ? TXT.warn : (secs < 25 ? TXT.amber : TXT.dim)
      this.text(bx + bw, sy2 - 5, `${secs >= 99 ? '99+' : Math.floor(secs)}s`, FS.lead, sCol, true)
    }
    // 耗氧速率（越深越快，必须显式告诉玩家）
    this.text(bx - 12, by + 2, `-${L.drain.toFixed(1)}/s`, FS.body, TXT.dim, true)

    // ===== ③ 波次进度（氧气条右侧）=====
    const wx0 = bx + bw + 18
    const total = w.waves().length
    this.text(wx0, by + 2, `第 ${w.waveInLayer + 1} / ${total} 波`, FS.title, TXT.main)
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
      this.center(wcx, wcy, `${Math.max(0, Math.ceil(w.waveTimer))}`, FS.lead, left < 0.25 ? TXT.warn : TXT.cyber)
      this.text(wcx + wr + 6, wcy - 6, 's', FS.body, TXT.dim)
      // 剩余敌人：清波进度的唯一确定信号（计时器到点 ≠ 波次结束，还要清场）
      const alive = w.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
      this.text(wx0, by + bh + 60, w.spawnLeft > 0 ? `剩余 ${alive} · 涌入中` : `剩余 ${alive}`,
        FS.body, alive > 0 ? TXT.dim : TXT.jade)
    } else if (w.phase === 'descending') {
      // 下潜进度条：下潜是一次"过渡"，玩家需要一个明确的进度
      const k = clamp01(w.descT / Math.max(0.01, w.descDur))
      const dw = 120, dx2 = wx0, dy2 = by + bh + 26
      g.fill(UI.panel, 0.7); g.fillRoundRect(dx2, dy2, dw, 8, 4)
      g.fill(UI.cyan, 0.9); g.fillRoundRect(dx2, dy2, Math.max(3, dw * k), 8, 4)
      g.line(UI.cyanDim, 0.7, 1); g.strokeRoundRect(dx2, dy2, dw, 8, 4)
      this.text(dx2, dy2 - 14, '下潜中', FS.body, TXT.cyan)
      this.text(dx2 + dw + 8, dy2 - 2, `${Math.round(k * 100)}%`, FS.body, TXT.dim)
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
    // 2026-10-14 用户：「鱼情图小了点」⇒ 外环 52→64。
    // 2026-10-15 用户：「鱼情局这个圆圈需要大点」⇒ 外环 64 → **88**（+37.5%）。
    //
    // ⚠️ **放大必须同时挪点位**，否则一定撞上别的东西：
    //    ① 上方波次环形倒计时的底 ≈ y 97 ⇒ `RCY − RR ≥ 110`
    //    ② 右侧屏幕边 ⇒ `RCX + RR ≤ W − 22`
    //   RR=88 时这两条把 y 压到 198、x 压到 W−110 —— 也就是**必须往下挪**，
    //   而下面就是装备槽（左）与鱼骨/暂停（右下），所以半径只能涨到 88 就该停。
    //   真要再大，得先把波次环挪走，那是另一个改动。
    const RCX = W - 110, RCY = 198, RR = 88, RPLOT = 74
    // 量程比屏幕半对角线（≈752）略大 ⇒ 画面内出现的敌人**必然**落在圈内；
    // 落在外环上的只可能是"还没进画面"的 —— 那正是"它正从那个方向来"的导航语义。
    const RANGE = 780
    g.fill(UI.panel, 0.58); g.fillCircle(RCX, RCY, RR)
    g.line(UI.cyanDim, 0.5, 1.6); g.strokeCircle(RCX, RCY, RR)
    // 半量程内环 + 十字准线 —— "导航感"来自这两样，不是来自点位本身
    g.line(UI.line, 0.32, 1); g.strokeCircle(RCX, RCY, RR * 0.5)
    g.line(UI.line, 0.22, 1); g.strokeSeg(RCX - RR, RCY, RCX + RR, RCY)
    g.line(UI.line, 0.22, 1); g.strokeSeg(RCX, RCY - RR, RCX, RCY + RR)
    // 外环加一道"量程刻度"：四向短齿，让放大后的圆不至于只是一条空线圈
    g.line(UI.cyanDim, 0.45, 1.4)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const r0 = RR - (i % 3 === 0 ? 9 : 5)
      g.strokeSeg(RCX + Math.cos(a) * r0, RCY + Math.sin(a) * r0,
        RCX + Math.cos(a) * RR, RCY + Math.sin(a) * RR)
    }
    // ---- V6.78：副标题「声呐扫描」**整行删除** ----
    // 用户 2026-10-15：「鱼情局 后面的声呐扫描去掉」。
    // ⚠️ **只删副标题，圈的几何与标题都不动**：`RCX/RCY/RR = W−110 / 198 / 88`、
    //    标题 `鱼情局` 仍钉在 `RCY − RR + 15`（圈内上沿）。
    //    ⚠️ 别顺手把标题往上挪到 `RCY − RR + 30` 去"补空" —— 那是原副标题的位置，
    //       `RR=88` 时它离圈顶只剩 30px，会把标题压到刻度齿上。
    this.center(RCX, RCY - RR + 15, '鱼情局', FS.title, TXT.cyber)

    for (const e of w.enemies) {
      if (!e.alive) continue
      const dx = e.x - w.px, dy = e.y - w.py
      const d = Math.hypot(dx, dy)
      const ux = d > 1e-3 ? dx / d : 0, uy = d > 1e-3 ? dy / d : -1
      const k = Math.min(1, d / RANGE)
      const px = RCX + ux * k * RPLOT, py = RCY + uy * k * RPLOT
      if (e.kind === 'boss') {
        // BOSS 是本作唯一"必须提前知道它从哪来"的目标 ⇒ 大点 + 呼吸环
        const br = 9.5 + 3.2 * Math.abs(Math.sin(t * 3))
        g.line(UI.violet, 0.7, 1.8); g.strokeCircle(px, py, br)
        g.fill(UI.violet, 1); g.fillCircle(px, py, 5.6)
      } else {
        // 贴边（k=1）的压暗：它还没进画面，只表示"那个方向有东西"
        // ⚠️ 点位半径随圈一起放大（3.0/2.2 → 4.6/3.3）—— 圈大了点没大，
        //    在更大的空画面里点会读成一粒灰噪（用户看到的"圈里很空"就是这个）。
        g.fill(e.color, k >= 1 ? 0.5 : 0.95)
        g.fillCircle(px, py, e.kind === 'drift' ? 4.6 : 3.3)
      }
    }
    // 圆心 = 玩家自己，**最后画**，保证永不被点位盖住。小箭头 = 航向（`w.aim` 是 sim 角度）
    g.fill(UI.cyanHi, 1); g.fillCircle(RCX, RCY, 4.6)
    g.fill(UI.cyanHi, 0.8); g.fillTri(RCX, RCY, w.aim, 13, 6.5)

    // ===== ④ 生物质（层末才显示）/ 暂停按钮（常驻·**右下角**）=====
    //
    // ⛔ **右上角鱼骨计数 —— V6.80 整段删除**
    //   用户 2026-10-15：「这个 12 鱼骨很突兀 直接去掉 没有任何说明 不要放在鱼情局上面」。
    //   旧位置 `(W−106, by + 26 + 8)` 与鱼情雷达（圆心 `W−110 / 198`、半径 88）**同一列**，
    //   那个圈 + 数字正好悬在雷达的正上方；而且它**没有标签** ——
    //   裸的一个圆加一个"12"，玩家根本读不出那是鱼骨（"没有任何说明"的实处）。
    //   ⇒ 直接删除。代价要说清楚：战斗中不再常驻显示购买力（这是 V6.78 立的判据）——
    //     鱼骨数现在只在**商店相位顶栏**与**结算屏**出现，那两处都带"鱼骨"文字标签。
    //   ⚠️ **别顺手把它挪到别处"补回来"**：用户的诉求是这个位置突兀，不是"换个位置"。
    //
    // 2026-10-14：暂停按钮**从右上角移到右下角**（用户："那个退出暂停的可以放在右下角"）。
    //   右上角现在被鱼情雷达占着，三个组挤在一列会互相抢注意力；而右下角天然是"出口"的
    //   位置（拇指最容易够到、与其他信息块最远）。
    if (w.phase !== 'wave') {
      this.text(W - 24, by + 2, `生物质 ${w.biomass}`, FS.title, TXT.jade, true)
      if (w.mult > 1) this.text(W - 24, by + 26, `上浮可得 ${Math.floor(w.biomass * w.mult)}`, 13, TXT.amber, true)
    }

    // ---- 暂停按钮（右下角）----
    // 用户 2026-10-14：「这个退出 icon 太简单了」。旧版是面板上两条素竖杠，读起来像
    // 一个占位符。现在按**实体按键**画五层，把"这一块是可以按下去的"先立住：
    //   ① 投影（右下偏移暗圆角块）
    //   ② 键体（UI.panel 圆角 12）
    //   ③ 按键面（内缩 3.5px、**比框亮**的 UI.panelHi ⇒ 读作凸起的键帽，不是一块平贴）
    //   ④ 顶边受光带 + 四角铆钉（深海仪器的语汇：手轮/舱门都是四角固定的）
    //   ⑤ 双竖杠（**圆头**：fillRoundRect 而不是 fillRect —— 方头是"两条色块"，
    //     圆头才是"两根实体按键柱"），每根右侧压一条暗线 ⇒ 竖杠本身也有厚度
    // ⚠️ 视觉 46×46，热区 76×76（视觉尺寸与点击区分离）。热区同心，点击中心不偏。
    if (cbs.onPause) {
      const pbx = W - 46, pby = H - 27, PS = 46, ph = PS / 2, pr = 12
      g.fill(UI.abyss, 0.45)
      g.fillRoundRect(pbx - ph + 2, pby - ph + 3, PS, PS, pr)      // ① 投影
      g.fill(UI.panel, 0.94)
      g.fillRoundRect(pbx - ph, pby - ph, PS, PS, pr)              // ② 键体
      g.fill(UI.panelHi, 0.92)
      g.fillRoundRect(pbx - ph + 3.5, pby - ph + 3.5, PS - 7, PS - 7, 9)  // ③ 键帽面
      g.line(UI.abyss, 0.75, 1.6)
      g.strokeRoundRect(pbx - ph, pby - ph, PS, PS, pr)            // 外描边
      g.line(UI.cyanDim, 0.55, 1)
      g.strokeRoundRect(pbx - ph + 1.2, pby - ph + 1.2, PS - 2.4, PS - 2.4, pr - 1)
      g.line(UI.cyanHi, 0.26, 2.2)                                 // ④ 顶边受光带
      g.strokeSeg(pbx - ph + 7, pby - ph + 2, pbx + ph - 7, pby - ph + 2)
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {        // 四角铆钉
        g.fill(UI.cyanDim, 0.5); g.fillCircle(pbx + sx * 15, pby + sy * 15, 1.5)
      }
      g.fill(UI.cyan, 0.95)                                        // ⑤ 圆头双竖杠
      g.fillRoundRect(pbx - 7.6, pby - 9, 5.6, 18, 2.8)
      g.fillRoundRect(pbx + 2.0, pby - 9, 5.6, 18, 2.8)
      g.fill(UI.abyss, 0.5)
      g.fillRoundRect(pbx - 2.0, pby - 9, 1.4, 18, 0.7)            // 两柱之间的凹槽
      // 只吃点击、不画任何东西的空按钮（fillA / edgeA = 0）
      this.button(pbx, pby, 76, 76, '', cbs.onPause, true, { fillA: 0, edgeA: 0 })
    }

    // ===== ⑤ 装备槽 · 座圈（底部左）=====
    // 每槽回答四个问题：装的是**哪台发射器**（立绘）· 多强（等级点）·
    // 什么时候好（冷却条）· 是不是扩容座（角标）
    //
    // ---- V6.78：槽内图标从"矢量重画的弹体"改成**发射器立绘本身** ----
    // 用户第三次点名（2026-10-15）：
    //   「目前这几个区域 我一直强调要放对应的发射器的图片 波次间选卡那种」。
    // 前两版分别画过「发射器侧视小像」(V6.73) 与「发射物弹体」(V6.74)—— 都是
    // **在 46px 的方槽里用 Graphics 重画一遍**。而用户要的是**那张图本身**：
    // 商店 / 波间选卡卡面上的 `item_<id>.png`。
    // ★ 判据：**同一个东西在两张界面里必须长得一模一样**。卡面用立绘、座圈用矢量，
    //   两边就必然对不上 —— 这正是这条需求反复三轮没落地的根因（不是尺寸不够，
    //   是"换了个东西画"，V6.74b 把 s 从 12 提到 16 也救不了）。
    //
    // 尺寸依据（两个硬约束，动之前先算）：
    //   ① 立绘素材统一 **2:1**（600×300，`tools/process_item_art.py` 规定内容 FILL=0.86 居中）
    //      ⇒ 窗口必须 2:1，否则 contain 后上下留大片死空间（垫光晕只会把画面弄脏）；
    //   ② 槽宽是**上限**：6 座时右端 = `24 + 5×100 + 88 = 612`，而技能冷却圆环的左缘
    //      在 `W/2 − 20 = 632` ⇒ 88 是能放下的最大宽度（再宽就撞冷却环）。
    //   ⇒ 槽 88×52 / 立绘窗 80×40。
    const sy = H - 50
    const seatY = H - 56
    const slots = Math.min(w.maxWeapons, MAX_SEATS)
    const sw = 88, sh = 52, gap = 100
    const plan = w.mountPlan()
    for (let i = 0; i < slots; i++) {
      const sx = 24 + i * gap
      const wp = w.weapons[i]
      const ext = !!plan[i]?.ext
      const wcol = wp ? WEAPON_DEF[wp.id].color : UI.line

      g.fill(wp ? UI.panelHi : UI.panel, wp ? 0.9 : 0.55)
      g.fillRoundRect(sx, seatY, sw, sh, 9)

      // 窗口几何（空槽也要画）—— 空槽画同样的 2:1 窗，玩家开打前就知道
      // "这里能插一台横过来的东西"，而不是一个空白方块
      const ax = sx + 4, ay = seatY + 4, aw = sw - 8, ah = sh - 12

      if (!wp) {
        g.line(UI.line, 0.45, 1); g.strokeRoundRect(sx, seatY, sw, sh, 9)
        g.fill(UI.abyss, 0.22); g.fillRoundRect(ax, ay, aw, ah, 7)
        this.center(ax + aw / 2, ay + ah / 2, String(i + 1), FS.body, TXT.mute)
        continue
      }

      g.line(wcol, 0.9, ext ? 2.4 : 2); g.strokeRoundRect(sx, seatY, sw, sh, 9)

      // ---- 立绘窗（2:1，与商店卡 `shopCard` 的立绘槽同一套语言）----
      // 窗底**比卡面深**：亮色立绘要靠"更深的底"跳出来（`BRIGHT.slot` < `BRIGHT.card`
      // 是同一条依据；垫光晕只会把画面弄脏）。
      g.fill(UI.abyss, 0.55); g.fillRoundRect(ax, ay, aw, ah, 7)
      g.line(wcol, 0.35, 1); g.strokeRoundRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1, 7)
      // ⚠️ key 与商店卡 `cardArtKey()` 同源（`item_<武器id>`），**不要另起一套映射** ——
      //    漂移的症状是"卡面是声呐、座圈是回声"，两边各对一半。
      // ⚠️ `artPaths()` 已为每把武器解析过回退路径，所以 `item_mine` 这类
      //    尚未出图的 id **也能取到图**（借语义最近的），不会静默空窗。
      const seatSf = this.art.get('item_' + wp.id)
      if (seatSf) this.putArt(ax + aw / 2, ay + ah / 2, aw - 4, ah - 2, seatSf)
      // 银行里真没有时才退回矢量弹体（"美术没接上"不该表现成"槽是空的"）
      else this.weaponIcon(wp.id, ax + aw / 2, ay + ah / 2, 30)

      // ---- 冷却条（贴在窗口下沿）----
      // 换成横条不是审美：窗口已经是 2:1，画不下 r=15 的环；而"从 12 点顺时针转一圈"
      // 这个语义在横条上就是"从左往右填满"，读数反而更稳。
      if (wp.timer > 0) {
        const k = clamp01(1 - wp.timer / Math.max(0.01, wp.ivLast || wp.iv))
        const cbx = sx + 6, cby = seatY + sh - 5, cbw = sw - 12
        g.fill(UI.abyss, 0.85); g.fillRoundRect(cbx, cby, cbw, 3, 1.5)
        g.fill(wcol, 0.95); g.fillRoundRect(cbx, cby, Math.max(2, cbw * k), 3, 1.5)
      }

      // ---- 等级点（叠在窗口左下角**内侧**）----
      // 位置不是随便挑的：立绘内容按 FILL=0.86 居中，左下角是**透明**的 ⇒ 压上去
      // 不会和枪身打架，也不用在 52px 高的卡里再切一行出来。
      for (let k2 = 0; k2 < 5; k2++) {
        g.fill(k2 < wp.lvl ? wcol : UI.line, k2 < wp.lvl ? 1 : 0.45)
        g.fillRect(ax + 5 + k2 * 6, ay + ah - 7, 4, 4)
      }
      // 扩容座角标（与商店卡里的座圈示意图同一套视觉语言：扩容座 = 琥珀）
      // ⚠️ 先垫一层暗底：琥珀压在亮色立绘上会读不出来（角标的全部意义就是"看得见"）
      if (ext) {
        g.fill(UI.abyss, 0.6); g.fillRoundRect(ax + aw - 17, ay + 2, 15, 16, 4)
        g.fill(UI.amber, 0.95)
        g.fillRect(ax + aw - 14, ay + 4, 7, 4)
        g.fillRect(ax + aw - 14, ay + 10, 7, 4)
      }
      // ---- V6.82 说明卡热区（隐形，见 `BTN_HIT`）----
      // 用户 2026-10-15 两次：「点击座圈那几个发射物没有出来说明这个发射物的信息 …遗物也是」。
      // ⚠️ 与商店热区同一条铁律：**先申请热区、后申请真按钮**（按钮池的创建顺序
      //    = 命中优先级）—— 本热区与后面那颗暂停键不相交，顺序无碍，但别倒置。
      this.button(sx + sw / 2, seatY + sh / 2, sw, sh, '',
        () => cbs.onInspect?.('seat', i), true, BTN_HIT)
    }
    this.text(24, seatY - 16, `座圈 ${w.weapons.length}/${slots}`,
      FS.body, w.weapons.length < w.maxWeapons ? TXT.dim : TXT.cyan)

    // ===== ⑥ 遗物槽（底部右）=====
    // 遗物必须战斗中也能看见：效果多为条件触发，玩家得知道"我现在有条件可触发"
    // ⚠️ 2026-10-14：右端从 `W-24` 退到 `W-92` —— 给右下角的暂停键让出 23px 间隔。
    //    底部这一行现在是**从右往左**排的：暂停键 → 遗物槽 → (空) → 技能冷却 → 装备槽。
    {
      // ---- V6.74 遗物槽重做（用户：「遗物也没有任何显示」）----
      // 三件事一起补，缺一件都还是"没有显示"：
      //   ① **槽位放大 + 图标放大**（30→34 / 11→14）：11px 的遗物图标在 34px 槽里
      //      只是一粒灰点，用户看到的"没有任何显示"有一半是这个；
      //   ② **空槽也画编号**：原来空槽是一条空心框，玩家数不出"我一共能带几个"；
      //   ③ **激活反馈从"描边变亮"升级为"槽内呼吸填充 + 顶部生效条"** ——
      //      遗物的效果多为条件触发（低氧 / 3 秒无伤 / 深潜），玩家必须能看见
      //      "它此刻正在起作用"，否则整件遗物等于不存在。
      const rs = 34, rgap = 40
      const rx0 = W - 92 - RELIC_SLOTS * rgap + (rgap - rs)
      for (let i = 0; i < RELIC_SLOTS; i++) {
        const rx = rx0 + i * rgap
        const id = w.relics[i]
        if (!id) {
          g.fill(UI.panel, 0.4); g.fillRoundRect(rx, sy + 5, rs, rs, 7)
          g.line(UI.line, 0.4, 1); g.strokeRoundRect(rx, sy + 5, rs, rs, 7)
          this.center(rx + rs / 2, sy + 5 + rs / 2, String(i + 1), FS.micro, TXT.mute)
          continue
        }
        const live = w.relicActive(id)
        g.fill(UI.panelHi, 0.85); g.fillRoundRect(rx, sy + 5, rs, rs, 7)
        // 激活：槽内一层呼吸填充（由外向内叠的第二层，不是换底色）
        if (live) {
          const br = 0.10 + 0.08 * Math.abs(Math.sin(t * 3.2))
          g.fill(UI.cyanHi, br); g.fillRoundRect(rx, sy + 5, rs, rs, 7)
        }
        g.line(live ? UI.cyanHi : BONE, live ? 0.95 : 0.6, live ? 2.2 : 1.2)
        g.strokeRoundRect(rx, sy + 5, rs, rs, 7)
        this.relicIcon(id, rx + rs / 2, sy + 5 + rs / 2, 14)
        if (live) {
          // 顶部一条"生效"小条：条件触发的遗物必须常驻告知，不能只靠描边呼吸
          g.fill(UI.cyanHi, 0.9); g.fillRoundRect(rx + 5, sy + 1, rs - 10, 2.4, 1.2)
        }
        // ---- V6.82 说明卡热区（与座圈同一套，见 ⑤）----
        this.button(rx + rs / 2, sy + 5 + rs / 2, rs, rs, '',
          () => cbs.onInspect?.('relic', i), true, BTN_HIT)
      }
      this.text(W - 92, sy - 16, `遗物 ${w.relics.length}/${RELIC_SLOTS}`, FS.body, TXT.dim, true)
    }

    // ===== ⑦ 技能冷却（底部中）=====
    const ready = w.burstTimer <= 0
    const kk = ready ? 1 : clamp01(1 - w.burstTimer / O2.burstCd)
    g.line(ready ? UI.cyan : UI.cyanDim, 0.9, 2); g.strokeCircle(W / 2, sy + 22, 20)
    g.fill(ready ? UI.cyan : UI.cyanDim, 0.25); g.fillCircle(W / 2, sy + 22, 20 * kk)
    this.center(W / 2, sy + 22, ready ? '空格' : `${Math.ceil(w.burstTimer)}`, FS.body, ready ? TXT.cyber : TXT.mute)

    // ===== ⑧ 环境状态提示（左，**深度计右侧**）=====
    // x 从 24 移到 106：深度计的带名标签占到 x≈78，两个挤在一起会互相压字。
    let ty = 250
    if (w.vpCur > 0) { this.text(106, ty, `暗流 ${w.vpCur.toFixed(0)}`, FS.body, TXT.amber); ty += 20 }
    if (w.vpPush > 0) { this.text(106, ty, `热泉上推 ${w.vpPush.toFixed(0)}`, FS.body, TXT.amber); ty += 20 }
    if (w.burstTimer > 0) this.text(106, ty, `排气冷却 ${w.burstTimer.toFixed(1)}s`, FS.body, TXT.mute)

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

    // ===== ⑩ 换带提示条（V6.81 立 · V6.82 收成居中浮条 + 渐隐）=====
    // 用户：「不同层之间的衔接没有做好 文字描述需要有UI概念图 给人一种兴奋感的提示吧」
    //      →「这个太长了…一个提示不应该适中提示然后渐变消失吗」。
    //
    // ★ 兴奋感来自四处（都是"能读到的量"，不是形容词）：
    //   ① **深度区间**（`0 – 200 m`）—— 数字，不是名字；
    //   ② **氧耗倍率**（`×1.80`）—— "这一层更难"的唯一显式信号（与左上面板**同一个
    //      `layerO2()`**，⛔ 不另算一份，否则两处会漂）；
    //   ③ **端头竖条取该带 tint** —— 与左侧深度计**同一套色**（不用学两套配色）；
    //   ④ **入场高光**从左扫到右 —— 读作"扫描完成，新一层已确认"。
    //
    // ⚠️ `layerCardT` 从 2.6 倒数（`world.ts`）。这里**不复制那个 2.6**，
    //   而是用 `cardPeak` 记住本轮见到过的最大值 ⇒ 只依赖 `layerCardT` 本身。
    if (w.layerCardT > 0) {
      if (w.layerCardT > this.cardPeak) this.cardPeak = w.layerCardT
      const el = this.cardPeak - w.layerCardT             // 已过时间
      const kIn = clamp01(el / 0.25)
      const tf = 1 - (1 - kIn) * (1 - kIn) * (1 - kIn)    // 滑入·缓出
      // ★ 渐隐：**最后 1.0s** 才淡出（原来 0.40s —— 那是一记"啪"的消失，
      //   不是"提示说完自己退场"）。2.6s 里前 1.6s 全亮、后 1.0s 线性淡出。
      const a = clamp01(Math.min(kIn, w.layerCardT / 1.0))
      const cx0 = (W - CARD_W) / 2
      const by0 = CARD_Y - (1 - tf) * 24                  // 只上滑 24px（浮条不该整块冲进来）
      const edge = lerpColor(L.tint, 0xffffff, 0.38)
      // `Graphics` 收 0xRRGGBB（number），`Label` 收 '#rrggbb'（string）——
      // 同一个色要两份表示。⛔ 别在两处各写一个字面量，那样改一处必然漏一处。
      const edgeCss = `#${edge.toString(16).padStart(6, '0')}`

      g.fill(MENU.page, 0.84 * a)
      g.fillRoundRect(cx0, by0, CARD_W, CARD_H, 12)
      g.line(UI.line, 0.9 * a, 1.2); g.strokeRoundRect(cx0, by0, CARD_W, CARD_H, 12)
      g.fill(edge, a)
      g.fillRoundRect(cx0, by0, 3, CARD_H, 1.5)
      g.fillRoundRect(cx0 + CARD_W - 3, by0, 3, CARD_H, 1.5)

      // 入场高光：一条 2px 竖线从左扫到右（0.30s，压在滑入之后）
      const hk = clamp01((el - 0.25) / 0.30)
      if (hk > 0 && hk < 1) {
        g.fill(UI.cyanHi, (1 - hk) * 0.85 * a)
        g.fillRect(cx0 + CARD_W * hk, by0, 2, CARD_H)
      }

      // ---- 主行：层号 + 带名 + 副名 / 深度区间（右）----
      const tx = cx0 + 20
      const ty = by0 + 12
      this.text(tx, ty, `L${w.layerIdx + 1}`, FS.huge, edgeCss)
      this.text(tx + 42, ty, L.name, FS.huge, TXT.cyber)
      this.text(tx + 42 + L.name.length * FS.huge + 12, ty + 12, L.sub, FS.micro, TXT.mute)
      this.text(cx0 + CARD_W - 20, ty + 4,
        `${L.depthTop.toLocaleString()} – ${L.depthBot.toLocaleString()} m`, FS.big,
        TXT.amber, true)

      // ---- 次行：机制 + tip（按可用宽截断）/ 氧耗（右）----
      const sy = by0 + 48
      const rightW = 184                                    // 「氧耗 ×1.80 · 静止 78s」这串
      if (L.mech) this.text(tx, sy, `◆ ${L.mech}`, FS.lead, TXT.amber)
      const tipX = tx + (L.mech ? 76 : 0)
      this.text(tipX, sy + 2,
        fitText(L.tip, FS.body, CARD_W - 40 - rightW - (L.mech ? 76 : 0)), FS.body, TXT.dim)
      const o2f = layerO2(w.layerIdx, w.st.o2Bonus, w.st.regen)
      this.text(cx0 + CARD_W - 20, sy + 1,
        `氧耗 ×${o2f.drain.toFixed(2)} · 静止 ${Math.round(o2f.sec)}s`, FS.body, TXT.amber, true)
    } else {
      this.cardPeak = 0
    }

    // ===== ⑪ 槽位说明卡（V6.82）—— 最后画，压在一切 HUD 之上 =====
    if (cbs.inspect) this.drawInspect(w, cbs.inspect)
  }

  /**
   * **槽位说明卡**（V6.82）。点座圈 / 遗物槽 → 弹出这一件东西的说明。
   *
   * 用户 2026-10-15 两次：「点击座圈那几个发射物没有出来说明这个发射物的信息 …遗物也是」。
   * 通用规则（三件套，每种槽位都照这个读法）：
   *   ① **是什么** —— 名称 + 立绘/图标（与槽位/商店卡**同一张图**，见 V6.78 判据）；
   *   ② **多强** —— 器械：单发伤害 / 间隔（含全部射速乘区后的 `ivLast`）/ 射程 / 等级点；
   *      遗物：效果描述 + 代价 + 此刻是否生效；
   *   ③ **往哪走** —— 基础形态标注"可进化为 X"，进化形态标注"由 X 进化"。
   *
   * 几何：卡 **344×138**，出现在槽位**正上方 12px**，x 向钳回屏内；槽位顶边到卡底
   * 之间一枚小三角指针指回槽位（"这张卡说的是哪一个"）。收起：再点一次 / 点别的槽 / 8s。
   */
  private drawInspect(w: DiveWorld, ins: { kind: 'seat' | 'relic'; i: number }): void {
    const W = this.W, H = this.H
    const g = this.g
    const CW = 344, CH = 138
    // ---- 锚点（槽位矩形）----
    let ax: number, ay: number, aw: number, ah: number
    if (ins.kind === 'seat') { ax = 24 + ins.i * 100; ay = H - 56; aw = 88; ah = 52 }
    else {
      const rs = 34, rgap = 40
      ax = W - 92 - RELIC_SLOTS * rgap + (rgap - rs) + ins.i * rgap
      ay = H - 50 + 5; aw = rs; ah = rs
    }
    const x = Math.max(12, Math.min(W - CW - 12, ax + aw / 2 - CW / 2))
    const y = ay - 12 - CH

    g.fill(UI.panel, 0.96); g.fillRoundRect(x, y, CW, CH, 10)
    g.line(UI.cyanDim, 0.9, 1.4); g.strokeRoundRect(x, y, CW, CH, 10)
    // 指针：从卡底指回槽位（钳在槽口范围内）
    const px0 = Math.max(x + 14, Math.min(x + CW - 14, ax + aw / 2))
    g.fill(UI.panel, 0.96)
    g.moveTo(px0 - 7, y + CH - 0.5); g.lineTo(px0 + 7, y + CH - 0.5); g.lineTo(px0, y + CH + 9)
    g.close(); g.fillPath()

    if (ins.kind === 'seat') {
      const wp = w.weapons[ins.i]
      if (!wp) return
      const def = WEAPON_DEF[wp.id]
      const st = w.weaponStats(wp.id, wp.lvl)
      const iv = wp.ivLast || st.iv || def.iv
      // ① 立绘窗（与座圈/商店卡同一张图 —— V6.78 判据）
      g.fill(UI.abyss, 0.55); g.fillRoundRect(x + 12, y + 12, 100, 50, 7)
      const sf = this.art.get('item_' + wp.id)
      if (sf) this.putArt(x + 62, y + 37, 96, 46, sf)
      else this.weaponIcon(wp.id, x + 62, y + 37, 26)
      // ② 名称 + 等级
      this.text(x + 124, y + 14, def.name, FS.title, TXT.cyber)
      this.levelPips(x + 124, y + 40, wp.lvl, def.color)
      // ③ 数值行：伤害 / 间隔（**ivLast** —— 含等级·座·遗物的全部乘区）/ 射程
      this.text(x + 124, y + 58,
        `单发 ${st.dmg.toFixed(1)} · 每 ${iv.toFixed(2)}s · 射程 ${Math.round(st.range)}`,
        FS.body, TXT.dim)
      this.text(x + 124, y + 78,
        `秒伤 ≈ ${(st.dmg / Math.max(0.01, iv)).toFixed(1)}`, FS.body, TXT.amber)
      // ④ 描述 + 进化去向
      this.text(x + 12, y + 100, fitText(def.desc, FS.body, CW - 24), FS.body, TXT.dim)
      const base = evolutionBase(wp.id)
      if (base) this.text(x + 12, y + 120, `由 ${WEAPON_DEF[base].name} 进化而来`, FS.body, TXT.mute)
      else if (EVOLUTIONS[wp.id]) {
        const evos = (EVOLUTIONS[wp.id] as WeaponId[]).map(e => WEAPON_DEF[e].name).join(' / ')
        this.text(x + 12, y + 120, fitText(`可进化为 ${evos}`, FS.body, CW - 24), FS.body, TXT.mute)
      }
    } else {
      const id = w.relics[ins.i]
      if (!id) return
      const def = RELIC_DEF[id]
      const live = w.relicActive(id)
      // ① 图标（与槽位同一枚）
      g.fill(UI.abyss, 0.5); g.fillRoundRect(x + 12, y + 12, 56, 56, 8)
      this.relicIcon(id, x + 40, y + 40, 20)
      // ② 名称 + 生效态
      this.text(x + 82, y + 14, def.name, FS.title, live ? TXT.cyan : TXT.cyber)
      if (live) this.text(x + CW - 14, y + 16, '生效中', FS.body, TXT.cyan, true)
      // ③ 效果 + 代价
      this.text(x + 82, y + 40, fitText(def.desc, FS.body, CW - 94), FS.body, TXT.dim)
      if (def.cost2) this.text(x + 82, y + 60, fitText(`代价：${def.cost2}`, FS.body, CW - 94),
        FS.body, TXT.amber)
      this.text(x + 12, y + 100, fitText('条件触发的遗物满足条件时自动生效（槽框呼吸提示）',
        FS.micro, CW - 24), FS.micro, TXT.mute)
    }
  }

  /**
   * 器械槽 / 商店卡的**形状签名图标**（V6.6）。
   *
   * 为什么用形状而不是贴图：只有 5 种配色，光靠颜色分不开 15 种器械形态，形状能。
   * 进化形态（`weaponFamily(id) !== id`）在右上角加一颗小菱形角标 ——
   * "这是同一族的进化版"一眼可辨（V6 §5.2 质变密度原则）。
   */
  /** 通用**弹丸**（枪族 / 兜底）：尖头 + 圆柱身 + 尾翼，朝右飞。 */
  private iconShot(cx: number, cy: number, s: number, c: number): void {
    const g = this.g
    g.fill(c, 0.55)
    g.moveTo(cx + s * 0.62, cy)
    g.lineTo(cx - s * 0.18, cy - s * 0.17)
    g.lineTo(cx - s * 0.42, cy - s * 0.24)
    g.lineTo(cx - s * 0.42, cy + s * 0.24)
    g.lineTo(cx - s * 0.18, cy + s * 0.17)
    g.close(); g.fillPath()
    g.line(c, 1, 1.5)
    g.moveTo(cx + s * 0.62, cy)
    g.lineTo(cx - s * 0.18, cy - s * 0.17)
    g.lineTo(cx - s * 0.42, cy - s * 0.24)
    g.lineTo(cx - s * 0.42, cy + s * 0.24)
    g.lineTo(cx - s * 0.18, cy + s * 0.17)
    g.close(); g.stroke()
    g.fill(0xffffff, 0.95); g.fillCircle(cx + s * 0.34, cy, s * 0.13)
  }

  /** **鱼雷弹体**：钝头圆柱 + 尾鳍 + 螺旋桨，朝右飞（与实机 `drawShots` 同型）。 */
  private iconTorpedo(cx: number, cy: number, s: number, c: number): void {
    const g = this.g
    const N = 0.72, T = 0.62, H = 0.30
    const body = () => {
      g.moveTo(cx + s * N, cy)
      g.lineTo(cx - s * T, cy - s * H)
      g.lineTo(cx - s * (T + 0.16), cy - s * (H + 0.20))
      g.lineTo(cx - s * (T + 0.16), cy + s * (H + 0.20))
      g.lineTo(cx - s * T, cy + s * H)
      g.close()
    }
    g.fill(c, 0.5); body(); g.fillPath()
    g.line(c, 1, 1.6); body(); g.stroke()
    // 螺旋桨（尾端一个十字 + 外圈）—— "水里跑的"与"空气里飞的"的分界
    g.line(c, 0.9, 1.3)
    g.strokeSeg(cx - s * (T + 0.06), cy - s * 0.34, cx - s * (T + 0.06), cy + s * 0.34)
    g.strokeSeg(cx - s * (T + 0.24), cy - s * 0.30, cx - s * (T + 0.24), cy + s * 0.30)
    g.fill(0xffffff, 0.9); g.fillCircle(cx + s * (N - 0.16), cy, s * 0.11)
  }

  /** **鱼叉**：长杆 + 倒刺箭头；`spin` = 回旋鱼叉加一道回旋弧。 */
  private iconHarpoon(cx: number, cy: number, s: number, c: number, spin: boolean): void {
    const g = this.g
    g.line(c, 1, 1.8)
    g.strokeSeg(cx - s * 0.52, cy, cx + s * 0.24, cy)
    g.line(c, 1, 1.5)
    g.moveTo(cx + s * 0.70, cy)
    g.lineTo(cx + s * 0.14, cy - s * 0.36)
    g.lineTo(cx + s * 0.30, cy)
    g.lineTo(cx + s * 0.14, cy + s * 0.36)
    g.close(); g.stroke()
    if (spin) {
      g.line(c, 0.6, 1.2)
      g.arc(cx - s * 0.60, cy, s * 0.30, -1.2, 1.2); g.stroke()
    }
    g.fill(0xffffff, 0.9); g.fillCircle(cx + s * 0.50, cy, s * 0.10)
  }

  private weaponIcon(id: WeaponId, cx: number, cy: number, s: number): void {
    const g = this.g
    const color = WEAPON_DEF[id].color
    const fam = weaponFamily(id)

    // ---- V6.74：图标 = **发射物（打出去的那颗东西）**----
    // 用户两轮反馈：
    //   2026-10-15「座圈 毫无改变 我需要的是发射物的显示」。
    // 上一版（V6.73）画的是"发射器侧视小像"（机匣 + 炮管）—— 那仍然回答的是
    // "这台机器长什么样"，而装备槽要回答的是**"它打出去的是什么"**：
    //   玩家在战斗中看到的是**满屏飞的弹体**，不是艇上那台机器。
    //   槽位图标必须与"我正在躲/正在看的那颗东西"同型，否则图标与战场对不上号。
    // ⚠️ 统一朝右飞（与机体默认朝向一致）—— 弹体是有方向的，方向错 = 读成另一种武器。
    // ⚠️ 只画**弹体本体 + 一点拖尾**：46px 槽里塞机匣 + 炮管 + 弹体 = 三样都读不出。

    // ⓪ 共用的"飞行辉光"：三层同 alpha 由外向内叠（Canvas 下没有 ADD，
    //    这是唯一可靠的辉光写法，见 theme.ts 硬规约 ②）
    g.fill(color, 0.10); g.fillCircle(cx + s * 0.16, cy, s * 0.86)
    g.fill(color, 0.18); g.fillCircle(cx + s * 0.16, cy, s * 0.56)

    // ① 拖尾：所有族都从**尾部后方**拉一道（越远越淡越细）
    for (let i = 1; i <= 3; i++) {
      g.line(color, 0.5 / i, 2.4 - i * 0.5)
      g.strokeSeg(cx - s * (0.30 + i * 0.20), cy, cx - s * (0.52 + i * 0.20), cy)
    }

    // ② 弹体本体（按族路由；进化形态靠 `weaponFamily` 归族，不再掉进 else）
    if (fam === 'gun') {
      if (id === 'gun_sg') {
        // 霰弹：**三颗弹丸**扇形散开（不是 5 —— 槽里 5 颗会糊成一团）
        for (const [ox, oy] of [[0.34, -0.30], [0.52, 0], [0.34, 0.30]] as const) {
          this.iconShot(cx + s * ox, cy + s * oy, s * 0.86, color)
        }
      } else if (id === 'gun_gl') {
        // 加特林：一颗弹 + 后面**三颗待装弹**（弹链 = 射速翻倍的视觉签名）
        this.iconShot(cx + s * 0.46, cy, s * 0.92, color)
        for (const ox of [-0.24, -0.46, -0.68]) {
          g.line(color, 0.5, 1.2)
          g.strokeRoundRect(cx + s * ox - s * 0.11, cy - s * 0.13, s * 0.22, s * 0.26, 1.5)
        }
      } else {
        // 脉冲机关枪：单发高速弹（细长尖头）
        this.iconShot(cx + s * 0.46, cy, s * 1.05, color)
      }
    } else if (fam === 'torpedo') {
      const n = id === 'torp_cl' ? 3 : 1
      const sc = id === 'torp_hv' ? 1.0 : id === 'torp_cl' ? 0.62 : 0.86
      for (let i = 0; i < n; i++) {
        const oy = n === 1 ? 0 : (i - 1) * s * 0.34
        this.iconTorpedo(cx + (n === 1 ? s * 0.18 : s * 0.10), cy + oy, s * sc, color)
      }
    } else if (fam === 'harpoon') {
      const n = id === 'harp_tr' ? 3 : 1
      for (let i = 0; i < n; i++) {
        const oy = n === 1 ? 0 : (i - 1) * s * 0.32
        this.iconHarpoon(cx + s * 0.10, cy + oy, s * (n === 1 ? 1.0 : 0.66), color, id === 'harp_cb')
      }
    } else if (fam === 'sonar') {
      // 声呐的"发射物"是**波前**：一个被推出去的开口环 + 内部两圈递减
      const fx = cx + s * 0.30
      if (id === 'sonar_fc') {
        // 聚焦 = 短而粗的波束（梯形）
        g.fill(color, 0.34)
        g.moveTo(fx - s * 0.30, cy - s * 0.30); g.lineTo(fx + s * 0.44, cy - s * 0.52)
        g.lineTo(fx + s * 0.44, cy + s * 0.52); g.lineTo(fx - s * 0.30, cy + s * 0.30)
        g.close(); g.fillPath()
        g.line(color, 0.95, 2.2)
        g.moveTo(fx - s * 0.30, cy - s * 0.30); g.lineTo(fx + s * 0.44, cy - s * 0.52)
        g.lineTo(fx + s * 0.44, cy + s * 0.52); g.lineTo(fx - s * 0.30, cy + s * 0.30)
        g.close(); g.stroke()
      } else {
        for (let i = 1; i <= 3; i++) {
          g.line(color, 0.95 - i * 0.22, 2.6 - i * 0.5)
          g.arc(fx, cy, s * (0.30 + i * 0.22), -1.0, 1.0); g.stroke()
        }
        g.fill(color, 0.95); g.fillCircle(fx, cy, s * 0.13)
      }
      if (id === 'sonar_rs') {
        // 共振：弹跳的两颗小点（"命中后向邻近弹射"）
        for (const [ox, oy] of [[0.62, -0.46], [0.78, 0.40]] as const) {
          g.fill(color, 0.9); g.fillCircle(cx + s * ox, cy + s * oy, s * 0.12)
        }
      }
    } else if (fam === 'arc') {
      // 电弧的发射物 = **电球**（球体 + 放射折线）
      const bx2 = cx + s * 0.28, by2 = cy
      const r = id === 'arc_st' ? s * 0.42 : s * 0.34
      g.fill(color, 0.30); g.fillCircle(bx2, by2, r * 1.9)
      g.fill(0xffffff, 0.92); g.fillCircle(bx2, by2, r * 0.52)
      g.line(color, 1, id === 'arc_st' ? 2.4 : 2)
      const nB = id === 'arc_st' ? 6 : 4
      for (let i = 0; i < nB; i++) {
        const a0 = (i / nB) * Math.PI * 2
        const L = r * (id === 'arc_ov' ? 1.9 : 1.5)
        g.moveTo(bx2 + Math.cos(a0) * r, by2 + Math.sin(a0) * r)
        g.lineTo(bx2 + Math.cos(a0 + 0.3) * L * 0.6, by2 + Math.sin(a0 + 0.3) * L * 0.6)
        g.lineTo(bx2 + Math.cos(a0 - 0.18) * L, by2 + Math.sin(a0 - 0.18) * L)
        g.stroke()
      }
    } else if (fam === 'echo') {
      // 回声 = **还没炸的弹**：球体 + 内部一圈引信环（"延迟爆发"写到脸上）
      const n = id === 'echo_mu' ? 3 : 1
      for (let i = 0; i < n; i++) {
        const ox = n === 1 ? s * 0.22 : s * (0.02 + i * 0.30)
        const oy = n === 1 ? 0 : (i - 1) * s * 0.34
        const r = s * (id === 'echo_fo' ? 0.40 : 0.30)
        g.fill(color, 0.26); g.fillCircle(cx + ox, cy + oy, r * 1.8)
        g.fill(color, 0.9); g.fillCircle(cx + ox, cy + oy, r)
        g.line(0xffffff, 0.8, 1.2)
        g.strokeCircle(cx + ox, cy + oy, r * 0.55)
      }
    } else if (fam === 'acid') {
      // 酸液 = **液滴**（上圆下尖的水滴形）+ 后方两颗飞散小滴
      const dx0 = cx + s * 0.30, r = s * 0.42
      g.fill(color, 0.26); g.fillCircle(dx0, cy, r * 1.7)
      g.fill(color, 0.92)
      g.moveTo(dx0, cy + r * 1.35)
      g.lineTo(dx0 - r * 0.86, cy - r * 0.1)
      g.arc(dx0, cy - r * 0.1, r * 0.86, Math.PI, Math.PI * 2, true)
      g.close(); g.fillPath()
      g.fill(0xffffff, 0.55); g.fillCircle(dx0 - r * 0.3, cy - r * 0.35, r * 0.22)
      for (const [ox, oy] of [[-0.44, -0.34], [-0.62, 0.26]] as const) {
        g.fill(color, 0.7); g.fillCircle(cx + s * ox, cy + s * oy, s * 0.13)
      }
    } else if (fam === 'mine') {
      // 气泡雷 = 球体 + **引信闪**（红点）—— "原地布雷需预判"的签名
      const r = s * 0.44
      g.fill(color, 0.24); g.fillCircle(cx + s * 0.14, cy, r * 1.7)
      g.fill(color, 0.9); g.fillCircle(cx + s * 0.14, cy, r)
      g.line(0xffffff, 0.7, 1.2); g.strokeCircle(cx + s * 0.14, cy, r * 0.6)
      g.fill(UI.danger, 0.95); g.fillCircle(cx + s * 0.14, cy - r * 0.5, s * 0.10)
    } else if (fam === 'net') {
      // 网弹 = **收拢的网束**（梭形 + 两道网目）—— 与实机飞行态同一读法
      const c2 = id === 'net_el' ? UI.violet : id === 'net_cv' ? UI.cyanHi : UI.jade
      g.fill(c2, 0.30)
      g.moveTo(cx + s * 0.72, cy); g.lineTo(cx - s * 0.20, cy - s * 0.34)
      g.lineTo(cx - s * 0.62, cy); g.lineTo(cx - s * 0.20, cy + s * 0.34)
      g.close(); g.fillPath()
      g.line(c2, 0.95, 1.6)
      g.moveTo(cx + s * 0.72, cy); g.lineTo(cx - s * 0.20, cy - s * 0.34)
      g.lineTo(cx - s * 0.62, cy); g.lineTo(cx - s * 0.20, cy + s * 0.34)
      g.close(); g.stroke()
      g.line(c2, 0.6, 1.1)
      g.strokeSeg(cx - s * 0.30, cy - s * 0.17, cx + s * 0.40, cy - s * 0.17)
      g.strokeSeg(cx - s * 0.30, cy + s * 0.17, cx + s * 0.40, cy + s * 0.17)
    } else if (fam === 'lure') {
      // 光饵 = 发光球 + 外扩光环（"它在吸引东西"）
      g.fill(color, 0.22); g.fillCircle(cx + s * 0.18, cy, s * 0.66)
      g.fill(color, 0.85); g.fillCircle(cx + s * 0.18, cy, s * 0.34)
      g.line(color, 0.75, 1.4); g.strokeCircle(cx + s * 0.18, cy, s * 0.56)
    } else {
      // 兜底：通用弹体
      this.iconShot(cx + s * 0.40, cy, s * 0.9, color)
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
      // ---- V6.77d 五个新维度：每个都要有**能缩到 20px 的形状签名** ----
      // ⚠️ 不能用颜色区分（属性卡的色板只有那几种，撞色就认不出）——
      //    这条规则来自本函数开头的注释，新加的同样适用。
      case 'streak':   // 三段递增竖条 = 连杀计数
        for (let i = 0; i < 3; i++) {
          const h = s * (0.26 + i * 0.24)
          g.fill(col, i === 2 ? 1 : 0.5)
          g.fillRect(cx - s * 0.34 + i * s * 0.26, cy + s * 0.46 - h, s * 0.17, h)
        }
        break
      case 'slowDmg':  // 准星 = "只对这类目标加伤"
        neonCircle(g, cx, cy, s * 0.42, col, { width: 2.2, bloom: false })
        seg(cx - s * 0.62, cy, cx - s * 0.32, cy, 2.4)
        seg(cx + s * 0.32, cy, cx + s * 0.62, cy, 2.4)
        seg(cx, cy - s * 0.62, cx, cy - s * 0.32, 2.4)
        seg(cx, cy + s * 0.32, cx, cy + s * 0.62, 2.4)
        break
      case 'bulletSpd': // 前倾速度线 + 箭头（与 rate 的"水平三线"刻意不同角度）
        for (let i = -1; i <= 1; i++) {
          seg(cx - s * 0.46, cy + i * s * 0.26 + s * 0.14,
            cx + s * 0.24, cy + i * s * 0.26 - s * 0.14, 2.2, i === 0 ? 1 : 0.5)
        }
        seg(cx + s * 0.14, cy - s * 0.42, cx + s * 0.48, cy, 2.4)
        seg(cx + s * 0.48, cy, cx + s * 0.14, cy + s * 0.42, 2.4)
        break
      case 'turretSpeed':  // 开口弧 + 轴心 = 转台
        path(() => { g.arc(cx, cy, s * 0.42, -Math.PI * 0.72, Math.PI * 0.38); g.stroke() }, 2.6)
        g.fill(col, 1); g.fillCircle(cx, cy, s * 0.13)
        break
      case 'armorPen':     // 淡描的甲片 + 斜穿箭头
        path(() => { g.strokeRoundRect(cx - s * 0.34, cy - s * 0.46, s * 0.68, s * 0.92, s * 0.12) }, 2.2, 0.55)
        seg(cx - s * 0.46, cy + s * 0.32, cx + s * 0.28, cy - s * 0.3, 2.4)
        seg(cx + s * 0.28, cy - s * 0.3, cx + s * 0.04, cy - s * 0.34, 2.4)
        seg(cx + s * 0.28, cy - s * 0.3, cx + s * 0.24, cy - s * 0.05, 2.4)
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
   *
   * ⚠️ **V6.70 三个错位一起修**（用户截图："商店现在还有文字排版错乱"）：
   *   ① **数值与卡名重叠** —— 数值原画在 `cy + 22`（框内 y+150），卡名在 `y + ch-134`
   *      （y+158），12px 与 17px 字只差 8px 基线，必然压在一起。
   *      ⇒ 数值改为**画进条内**（左=现在 / 右=买完），不再单独占一行。
   *   ② **横向溢出** —— 条宽 168 > 立绘框内宽 160（`cw-28-16`），两端各出框 4px。
   *   ③ **纵向溢出** —— 条 `cy+32` 落在 y+118~138，已越过框底 y+136。
   * 三条必须一起改：只动位置不管宽度，框内会左右出血；只动宽度不管数值，压字照旧。
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
    // 148 < 立绘框内宽 160（`cw-28-16`）⇒ 左右各留 6px 余量，不会顶到框线
    const bw = 148, bh = 22
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
    // ⚠️ 数值**写在条内**（左=现在 / 右=买完），不再另起一行 —— 见方法注释 ①
    const isRaw = m.k === 'o2Bonus' || m.k === 'killO2' || m.k === 'regen'
    const fmt = (v: number) => isRaw
      ? v.toFixed(m.k === 'regen' ? 1 : 0)
      : `${Math.round(Math.min(full, v) * 100)}%`
    const txt = `${fmt(w.st[m.k])} → ${fmt(w.st[m.k] + m.add)}`
    // 深色描边保证压在 0.95 强度的色条上也读得出来（浮字硬规约：必须描边）
    this.center(x0 + 8, cy, txt, 12, '#0d1a22', false, 2)
    this.center(x0 + 8, cy, txt, 12, TXT_LIGHT.main)
  }

  /**
   * 挂载位示意图（挂载扩容卡）。V6.71 从**俯视椭圆**改成**侧视舱段图**。
   *
   * ⚠️ 为什么必须跟着改（这张图和战斗内共用同一套真源）：
   *   战斗内的炮位真源已从「座圈角度 + 压扁投影」换成 `SEAT_MOUNTS`（背3 + 腹 3）。
   *   图上还画俯视椭圆 ⇒ 卡上标的"新增第5 座"在游戏里根本找不到对应位置，
   *   而这个图的**全部意义**就是告诉玩家"你买的是哪一座"。
   *
   * 画法：一条缩略的艇身轮廓（梭形），6 个舱位按 `SEAT_MOUNTS` 的 u/v 落点，
   * 上排=背脊、下排=腹部；已装备的画成实心带本色描边，空座画虚圈，
   * 本次要解锁的那座套一圈闪烁提示环（琥珀）。
   *
   * ⚠️ Cocos 的 `ellipse` 收**半径**不是直径（坑 13）—— web 的
   *   `strokeEllipse(cx,cy,w,h)` 在这里必须写成 `bodyL` 而非 `bodyL*2`。
   */
  private mountDiagram(cx: number, cy: number, id: string, boxH: number, w: DiveWorld): void {
    const g = this.g
    const target = id === 't_slot5' ? 5 : id === 't_slot6' ? 6 : w.maxWeapons
    const n = Math.max(target, w.maxWeapons)

    // 缩放由**立绘框实际高度**决定，而不是写死系数（写死会在卡高变化时把图示顶出框）。
    // needH 要装下：艇身高 + 上下两排炮座 + 闪烁环 + 底部文字。
    const needH = (HULL_H * 1.30 + MOUNT_BASE_R * 2.4) + 30
    const k = Math.max(0.30, Math.min(1.10, (boxH - 8) / needH))
    const HL = (SUB_D / 2) * k, HH = (HULL_H / 2) * k

    // 艇身：沿艇背/艇腹两条弧各画一段 —— 侧视的"舱段示意"语汇，与战斗内同源。
    const rail = (sgn: number) => {
      g.moveTo(cx + HL * 0.92, cy + sgn * HH * 0.30)
      g.lineTo(cx + HL * 0.30, cy + sgn * HH * 0.88)
      g.lineTo(cx - HL * 0.55, cy + sgn * HH * 0.92)
      g.lineTo(cx - HL * 0.92, cy + sgn * HH * 0.34)
    }
    g.line(UI.cyanDim, 0.55, 2.2); rail(-1); g.stroke()
    g.line(UI.cyanDim, 0.55, 2.2); rail(1); g.stroke()

    for (let i = 0; i < n; i++) {
      const m = SEAT_MOUNTS[i]
      if (!m) break
      const x = cx + m[0] * HL
      const y = cy + m[1] * HH
      const occupied = i < w.weapons.length
      const isNew = i === target - 1
      const ext = i >= BASE_SEATS
      const col = occupied ? WEAPON_DEF[w.weapons[i].id].color : UI.cyan
      const r = MOUNT_BASE_R * k * (ext ? 1.10 : 1) * 0.92
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
    this.center(cx, cy + HH + 22, `${w.weapons.length} → ${target} 座`, 12, TXT_LIGHT.dim)
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
    this.text(ix, iy + 18, `L${w.layerIdx + 1} ${LAYERS[w.layerIdx].name} · 波间补给`, FS.big, TXT_LIGHT.main)
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
          // ⚠️ V6.70：图腾与量槽**必须都留在立绘框内**（框 = y+48 ~ y+136，高 88）。
          //    旧值 图腾 y-16 / 量槽 y+32 会被框顶的 3px 类型色压住、并让量槽下沿越框。
          //    现在：图腾占上半（中心 y-14，尺寸 40），量槽占下半（中心 y+26，高 22）。
          this.statGlyph(sk, cxm, artCy - 14, 40, gcol)
          this.statGauge(cxm, artCy + 26, up.id, w)
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
      this.center(cxm, y + ch - 92, fitText(foot, FS.body, cw - 20), FS.body,
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
      this.center(cx, py + 84, `氧气 ${Math.ceil(w.o2)} / ${w.o2Max} · 敌人与计时已冻结`, FS.body, TXT.dim)
      const bw = 288, bh = 50
      this.button(cx, cy - 14, bw, bh, '继续游戏', cbs.onResume, true)
      this.button(cx, cy + 56, bw, bh, '重新开始', cbs.onRestart, true)
      this.button(cx, cy + 126, bw, bh, '返回主界面', cbs.onAskTitle, true)
      this.center(cx, py + ph + 28, 'ESC 继续游戏', 13, TXT.mute)
    } else {
      this.center(cx, py + 32, '返回主界面？', 24, TXT.warn)
      this.center(cx, py + 84, '本局进度将丢失', FS.title, TXT.main)
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
    this.center(W / 2, H / 2 + 12, `L${w.layerIdx + 1} ${LAYERS[w.layerIdx].name} · 第 ${w.waveInLayer + 1} 波`, FS.body, TXT.dim)

    // 信息行：只画有内容的，逐行下移（沿用"没有就不画"的惯例）
    let y = H / 2 + 44
    if (record) { this.center(W / 2, y, record, FS.title, TXT.cyan); y += 26 }
    if (banked > 0) {
      this.center(W / 2, y, `沉淀 +${banked} 生物质（总额 ${bio}）`, FS.title, TXT.amber); y += 26
    } else if (!w.win) {
      // 溺水：显式说明"无沉淀"，否则玩家不知道沉淀这一栏为什么消失
      this.center(W / 2, y, '溺水 · 生物质全损，无沉淀', FS.title, TXT.warn); y += 26
    }
    if (unlocked.length) { this.center(W / 2, y, `解锁：${unlocked.join(' · ')}`, FS.title, TXT.jade); y += 26 }

    const by = Math.max(y + 40, H / 2 + 140)
    this.button(W / 2 - 115, by, 210, 52, '再来一次', cbs.onRestart, true)
    this.button(W / 2 + 115, by, 210, 52, '返回主界面', cbs.onTitle, true)
  }
}
