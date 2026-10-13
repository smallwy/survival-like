/**
 * 图鉴屏（V6.36 元系统）—— 与 `Title` **同构的"纯类 + 自建节点树"**。
 *
 * ---------------------------------------------------------------------------
 * 为什么又是"纯类"而不是新场景
 * ---------------------------------------------------------------------------
 * 同 Title.ts 头部那条论证：Cocos 的 `director.loadScene()` 要求目标场景在构建
 * 列表里，而"编辑器里点 ▶ 跑的是当前打开的那个场景"—— 加第二个 `.scene` 会把
 * "打开工程点运行"变成"你得先知道要打开哪个场景"。图鉴是开关式的静态面板，
 * `root.active=false` 之后就不参与渲染与更新。
 *
 * ---------------------------------------------------------------------------
 * 坐标系约定（**照抄 Title.ts，别自己发明**）
 * ---------------------------------------------------------------------------
 *   · 根节点 `root` 锚点 (0,0)、尺寸 W×H，放在画布 (-W/2,-H/2)；
 *   · 于是**子节点的局部坐标 = 模拟坐标**：x ∈ [0,W]，y 直接给 sim 的 y（向下）；
 *   · 但节点自身的锚点决定"位置点落在哪"：锚点 (0,0) 的矩形节点，位置要写
 *     `(x, H - y - h)`（因为它的位置点是**左下角**）。
 *   漏了这一步不会报错，只会得到一个位置错一格的透明热区 —— 最难查的一类。
 *
 * ---------------------------------------------------------------------------
 * 三条会直接影响"能不能用"的约束
 * ---------------------------------------------------------------------------
 * ① **未见态用剪影，不用问号块**：剪影保留轮廓信息（玩家能猜"这是个硬壳的"），
 *    才有"我要去补图鉴"的动力。实现是把同一张立绘 `color` 压到近黑 ——
 *    轮廓还在、材质灭了。纯问号块没有任何信息，玩家不会去追。
 * ② **中文下限 14px**（theme.ts:203）：名称 16 / 计数 14 / tab 16，一格不破例。
 * ③ **图层必须显式继承**：运行时 `new Node()` 的 layer 是 DEFAULT，Canvas 的 UI
 *    相机只渲染 UI_2D —— 漏一处就是"面板里什么都没有"。统一走 `mk()`。
 *
 * ⚠️ 沙箱里验证不了画面。`verify_cocos.py` 只能证明"没写错 API / 引用都对得上"，
 *    画面正确性必须在 Creator 里跑一次。
 */

import { Node, Label, Graphics, Sprite, UITransform } from 'cc'
import { Gfx, col } from './Gfx'
import { neon } from './neon'
import { SpriteBank } from './art'
import { MENU, TXT_LIGHT, UI } from '../shared/theme'
import { CODEX, CODEX_CAT_NAME, codexByCat } from '../shared/dive/codex'
import type { CodexCat, CodexEntry } from '../shared/dive/codex'
import type { Profile } from '../shared/dive/profile'

/**
 * 元系统只读视图 —— 就用完整的 `Profile`。
 *
 * 为什么不切一个"只含图鉴/解锁字段"的瘦视图：解锁条件函数（`unlocks.ts`）要读
 * `surfaced / bestLayer / runs / normalClears / totalBanked / bestBiomass / seen`
 * —— 切瘦了就得把 `reached()` 全部重写一遍。直接用 `Profile` 既准确又不会漏字段。
 * 写操作（买强化）一律走回调，视图层不直接改档案。
 */
export type MetaView = Profile
export type MetaSource = () => MetaView

// ---- 规格（元系统设计 V6.36 §4.3）----
const PANEL_W = 1180
const PANEL_H = 700
const COLS = 6
/**
 * 行数。**别再改回 4**：
 *   4 行 × 142 + 3 × 12 = 604，从 `py + 140` 起算 → 网格底 768.5，
 *   而面板底只有 724.5（屏幕底 749）—— 溢出 44px，且第 4 行会压到页脚文字。
 * 之所以之前没暴露：现有最大分类是遗物 12 条，只画 2 行，第 3/4 行根本没内容。
 * 现在的兜底是 `gy` 按「tab 下沿 → 页脚上沿」**垂直居中**算（见 `rebuild()`），
 * 所以只要 `ROWS × CELL_H + (ROWS-1) × GAP` 不超过这条带，增加行数就不会溢。
 * 18 格/页 已经覆盖现有最大分类（遗物 12 条）而有余。
 */
const ROWS = 3
const CELL_W = 168
const CELL_H = 142
const GAP = 12
const ICON = 96
const PAGE = COLS * ROWS           // 18 格/页

const CATS: CodexCat[] = ['enemy', 'boss', 'weapon', 'relic']

/** 敌人的立绘 key（`ENEMY_TEX` 的值；Boss 暂时复用 drift 的图） */
const ENEMY_KEY: Record<string, string> = {
  'enemy:swarm': 'f_swarm', 'enemy:dash': 'f_dash', 'enemy:drift': 'f_drift', 'boss:abyss': 'f_drift',
}

/** 条目 → 立绘 key。武器用**基础族**的立绘（进化共用族图即可） */
function iconKey(e: CodexEntry): string {
  if (e.id in ENEMY_KEY) return ENEMY_KEY[e.id]
  return 'item_' + e.id.slice(e.id.indexOf(':') + 1)
}

interface Cell { sprite: Sprite; key: string; seen: boolean }

export class Codex {
  private readonly root: Node
  private readonly gPanel: Gfx
  private readonly gTabs: Gfx
  /** 随 `show()` 重建的文本层（避免重复 show 时节点泄漏） */
  private shellText: Node | null = null
  private tabText: Node | null = null
  /** 随 `rebuild()` 重建的内容层 */
  private content: Node | null = null
  private cells: Cell[] = []
  private tabIdx = 0
  private page = 0
  private padW = 8
  private padH = 8
  private viewW = 0
  private viewH = 0

  constructor(
    private readonly canvas: Node,
    private readonly W: number,
    private readonly H: number,
    private readonly art: SpriteBank,
    private readonly getMeta: MetaSource,
  ) {
    this.root = this.mk('Codex', canvas)
    const ut = this.root.addComponent(UITransform)
    ut.setAnchorPoint(0, 0)
    ut.setContentSize(W, H)
    this.root.setPosition(-W / 2, -H / 2)

    // 顺序 = 绘制顺序：面板底 → tabs → （scrim 在最下但它是全屏压暗，视觉上等价）
    this.gPanel = new Gfx(this.mk('cxPanel', this.root).addComponent(Graphics), H)
    this.gTabs = new Gfx(this.mk('cxTabs', this.root).addComponent(Graphics), H)

    this.layout(true)
    this.buildHitAreas()
    this.show()            // 先搭一遍内容，再关掉（打开时不闪空白）
    this.root.active = false
  }

  // ---- 基础设施 ----
  private mk(name: string, parent: Node): Node {
    const n = new Node(name)
    n.layer = parent.layer
    n.parent = parent
    return n
  }

  /** 放一段文字。`(x,y)` 是 **sim 坐标**；锚点跟着对齐方式走，右对齐才真贴边。 */
  private put(parent: Node, x: number, y: number, s: string, size: number, color: string,
              mode: 'left' | 'center' | 'right'): Label {
    const l = this.mk('cxl', parent).addComponent(Label)
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
    return l
  }

  /** 画布比设计分辨率大时四周要外扩，否则面板外会露一条清屏色 */
  private layout(force: boolean): void {
    const ut = this.canvas.getComponent(UITransform)
    const cw = ut ? ut.contentSize.width : 0
    const ch = ut ? ut.contentSize.height : 0
    if (!force && cw === this.viewW && ch === this.viewH) return
    this.viewW = cw
    this.viewH = ch
    this.padW = Math.max(0, ((cw > 0 ? cw : this.W) - this.W) / 2) + 8
    this.padH = Math.max(0, ((ch > 0 ? ch : this.H) - this.H) / 2) + 8
  }

  private px(): number { return (this.W - PANEL_W) / 2 }
  private py(): number { return (this.H - PANEL_H) / 2 }

  // ---- 交互热区（只建一次；位置按 sim 坐标算） ----
  private buildHitAreas(): void {
    // scrim：全屏 + 外扩，点面板外关闭
    const scrim = this.mk('cxScrim', this.root)
    const sut = scrim.addComponent(UITransform)
    sut.setAnchorPoint(0, 0)
    sut.setContentSize(this.W + this.padW * 2, this.H + this.padH * 2)
    scrim.setPosition(-this.padW, -this.padH)
    scrim.on(Node.EventType.TOUCH_END, () => this.hide())

    // 面板本体：吞掉点击（否则点面板会顺手关掉它）
    const panel = this.mk('cxPanelHit', this.root)
    const put = panel.addComponent(UITransform)
    put.setAnchorPoint(0, 0)
    put.setContentSize(PANEL_W, PANEL_H)
    panel.setPosition(this.px(), this.H - this.py() - PANEL_H)

    // 四个 tab
    for (let i = 0; i < CATS.length; i++) {
      const r = this.tabRect(i)
      const n = this.mk('cxTabHit', this.root)
      const t = n.addComponent(UITransform)
      t.setAnchorPoint(0, 0)
      t.setContentSize(r.w, r.h)
      n.setPosition(r.x, this.H - r.y - r.h)
      n.on(Node.EventType.TOUCH_END, () => {
        this.tabIdx = i; this.page = 0; this.drawTabs(); this.rebuild()
      })
    }
  }

  private tabRect(i: number): { x: number; y: number; w: number; h: number } {
    const w = 150, h = 44, gap = 14
    const total = CATS.length * w + (CATS.length - 1) * gap
    const x0 = this.px() + (PANEL_W - total) / 2
    return { x: x0 + i * (w + gap), y: this.py() + 74, w, h }
  }

  // ---- 绘制 ----
  private drawShell(): void {
    if (this.shellText) this.shellText.destroy()
    this.shellText = this.mk('cxShellText', this.root)

    const g = this.gPanel
    const x = this.px(), y = this.py()
    g.clear()

    // scrim：**半透明压暗**（不是实黑）—— 深海要透出来，但内容要立得住
    g.fill(MENU.page, 0.90)
    g.fillRect(-this.padW, -this.padH, this.W + this.padW * 2, this.H + this.padH * 2)

    // 面板：实底 + 硬边（清晰感来自"实底 + 硬边"，不来自发光）
    g.fill(UI.abyss, 0.98)
    g.fillRoundRect(x, y, PANEL_W, PANEL_H, 14)
    neon(g, UI.cyan, () => { g.roundRect(x, y, PANEL_W, PANEL_H, 14); g.stroke() },
      { width: 1.5, alpha: 0.85, bloom: false })

    // 顶栏横梁
    // ⚠️ `MENU` **没有** `header` 这个键（`header` 属于 `BRIGHT`，是"中调舱内"那套）；
    //    这里面板底是 `UI.abyss`，所以梁取同族的 `UI.panelHi`（"抬起面"）——
    //    既明显亮于面板、读作"一条横梁"，又不用给 MENU 硬塞新色。
    g.fill(UI.panelHi, 0.9)
    g.fillRoundRect(x, y, PANEL_W, 62, 14)
    g.fill(UI.panelHi, 0.9)
    g.fillRect(x, y + 48, PANEL_W, 14)

    this.put(this.shellText, x + 28, y + 32, '图 鉴', 26, TXT_LIGHT.main, 'left')
    const meta = this.getMeta()
    const seenN = CODEX.filter(e => (meta.seen[e.id] ?? 0) > 0).length
    this.put(this.shellText, x + PANEL_W - 28, y + 32, `已见 ${seenN} / ${CODEX.length}`, 16, TXT_LIGHT.dim, 'right')
    this.put(this.shellText, x + PANEL_W - 28, y + PANEL_H - 20, '点击面板外任何位置关闭', 14, TXT_LIGHT.mute, 'right')
    this.put(this.shellText, x + 28, y + PANEL_H - 20, '未见条目显示为剪影 —— 遇见一次即点亮', 14, TXT_LIGHT.mute, 'left')
  }

  private drawTabs(): void {
    if (this.tabText) this.tabText.destroy()
    this.tabText = this.mk('cxTabText', this.root)

    const g = this.gTabs
    g.clear()
    for (let i = 0; i < CATS.length; i++) {
      const r = this.tabRect(i)
      const on = i === this.tabIdx
      g.fill(on ? MENU.cardHi : MENU.slot, on ? 1 : 0.9)
      g.fillRoundRect(r.x, r.y, r.w, r.h, 9)
      neon(g, on ? UI.cyan : UI.line, () => { g.roundRect(r.x, r.y, r.w, r.h, 9); g.stroke() },
        { width: on ? 2 : 1.2, alpha: on ? 1 : 0.5, bloom: false })
      const n = codexByCat(CATS[i]).length
      this.put(this.tabText, r.x + r.w / 2, r.y + r.h / 2, `${CODEX_CAT_NAME[CATS[i]]} ${n}`, 16,
        on ? TXT_LIGHT.main : TXT_LIGHT.dim, 'center')
    }
  }

  /** 重建内容区（切 tab / 翻页 / 打开时调） */
  private rebuild(): void {
    if (this.content) { this.content.destroy(); this.content = null }
    this.cells = []
    const content = this.mk('cxContent', this.root)
    this.content = content

    const list = codexByCat(CATS[this.tabIdx])
    const maxPage = Math.max(0, Math.ceil(list.length / PAGE) - 1)
    if (this.page > maxPage) this.page = 0
    const shown = list.slice(this.page * PAGE, this.page * PAGE + PAGE)

    const gw = COLS * CELL_W + (COLS - 1) * GAP
    const gh = ROWS * CELL_H + (ROWS - 1) * GAP
    const gx = this.px() + (PANEL_W - gw) / 2
    // 网格在「tab 下沿 (74+44) → 页脚上沿 (PANEL_H-34)」之间**垂直居中**。
    // 硬写 `py + 140` 会随 ROWS 增大而把最后一行推出面板底（4 行时溢出 44px，见 ROWS 处的注释）。
    const bandTop = this.py() + 74 + 44
    const bandBot = this.py() + PANEL_H - 34
    const gy = bandTop + Math.max(0, (bandBot - bandTop - gh) / 2)
    const meta = this.getMeta()

    const g = new Gfx(this.mk('cxGrid', content).addComponent(Graphics), this.H)
    for (let i = 0; i < shown.length; i++) {
      const c = i % COLS, r = Math.floor(i / COLS)
      const x = gx + c * (CELL_W + GAP)
      const y = gy + r * (CELL_H + GAP)
      const n = meta.seen[shown[i].id] ?? 0
      const seen = n > 0

      // 状态矩阵（元系统设计 §4.3）：已见 = 亮底 + jade 描边；未见 = 深底 + 中性描边
      g.fill(seen ? MENU.card : MENU.slot, 1)
      g.fillRoundRect(x, y, CELL_W, CELL_H, 10)
      neon(g, seen ? UI.jade : MENU.edge, () => { g.roundRect(x, y, CELL_W, CELL_H, 10); g.stroke() },
        { width: seen ? 1.5 : 1, alpha: seen ? 0.9 : 0.6, bloom: false })
      // 图标位：比卡面**更深**一档，让亮色立绘跳出来
      g.fill(MENU.slot, 0.85)
      g.fillRoundRect(x + (CELL_W - ICON) / 2, y + 10, ICON, ICON, 8)

      this.put(content, x + CELL_W / 2, y + CELL_H - 22, seen ? shown[i].name : '？ ？ ？',
        seen ? 16 : 14, seen ? TXT_LIGHT.main : TXT_LIGHT.mute, 'center')
      if (seen) {
        this.put(content, x + CELL_W / 2, y + CELL_H - 6, `遇见 ${n}`, 14, TXT_LIGHT.dim, 'center')
      }

      const sp = this.mk('cxIc', content).addComponent(Sprite)
      sp.trim = false
      sp.sizeMode = Sprite.SizeMode.CUSTOM
      sp.node.setPosition(x + CELL_W / 2, this.H - (y + 10 + ICON / 2))
      sp.node.active = false
      this.cells.push({ sprite: sp, key: iconKey(shown[i]), seen })
    }
    this.syncIcons()

    // 分页（当前每类都 ≤ 24，按钮不会出现；逻辑留着，条目变多即生效）
    if (maxPage > 0) {
      this.put(content, this.px() + PANEL_W / 2, this.py() + PANEL_H - 44,
        `第 ${this.page + 1} / ${maxPage + 1} 页`, 14, TXT_LIGHT.dim, 'center')
    }
  }

  /** 立绘异步到达：拿到图就换上；未见态压成剪影 */
  private syncIcons(): void {
    for (const c of this.cells) {
      if (c.sprite.node.active) continue
      const sf = this.art.get(c.key)
      if (!sf) continue
      c.sprite.spriteFrame = sf
      const ut = c.sprite.node.getComponent(UITransform)!
      ut.setContentSize(sf.rect.width, sf.rect.height)
      const k = ICON / Math.max(1, Math.max(sf.rect.width, sf.rect.height))
      c.sprite.node.setScale(k, k, 1)
      // 已见 = 原色；未见 = 压到近黑（轮廓仍在 = 剪影）
      c.sprite.color = c.seen ? col(0xffffff) : col(0x161b22)
      c.sprite.node.active = true
    }
  }

  // ---- 开 / 关 ----
  show(): void {
    this.layout(false)
    this.drawShell()
    this.drawTabs()
    this.rebuild()
    this.root.active = true
  }
  hide(): void { this.root.active = false }
  get open(): boolean { return this.root.active }

  /** 每帧：只在打开时做立绘补图（图已到齐就几乎零开销） */
  update(): void {
    if (!this.root.active) return
    this.layout(false)
    this.syncIcons()
  }
}
