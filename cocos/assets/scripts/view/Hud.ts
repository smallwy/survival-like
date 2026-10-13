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
 * ⑤ **Sprite 必须 `trim = false`**：`trim` 默认 true，会裁掉透明边并按裁剪后的
 *    尺寸渲染 —— 而立绘的 contain 缩放是按**原图**比例算的，裁了就偏。
 */

import { Node, Label, Graphics, Sprite, SpriteFrame, UITransform } from 'cc'
import { Gfx, col } from './Gfx'
import { SpriteBank } from './art'
import { UI, TXT, MENU } from '../shared/theme'
import {
  LAYERS, RELIC_SLOTS, STAT_META, STAT_CARD, WEAPON_DEF, CARD_WEAPON_ID,
} from '../shared/dive/tables'
import type { DiveWorld } from '../shared/dive/world'
import type { UpgradeDef } from '../shared/dive/types'

interface Btn {
  node: Node
  label: Label
  /** 复用同一个 Gfx 包装（`H = 0`：按钮用节点局部坐标，y 翻转退化为取负） */
  gfx: Gfx
  onTap: () => void
}

type Align = 'left' | 'center' | 'right'

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
  private button(cx: number, cy: number, w: number, h: number, s: string, onTap: () => void, enabled = true): void {
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
    b.label.string = s
    b.label.fontSize = 17
    b.label.lineHeight = 19
    b.label.color = col(enabled ? 0xc8f8ff : 0x4d6b7c)
    b.label.node.setPosition(0, 0)

    b.gfx.clear()
    b.gfx.fill(enabled ? UI.panelHi : MENU.slot, 0.95)
    b.gfx.fillRect(-w / 2, -h / 2, w, h)
    b.gfx.line(enabled ? UI.cyan : MENU.edge, 0.8, 1)
    b.gfx.strokeRect(-w / 2, -h / 2, w, h)
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
    const iw = sf.rect.width
    const ih = sf.rect.height
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
    const fixed = CARD_WEAPON_ID[up.id]
    if (fixed) return 'item_' + fixed
    if (up.id.startsWith('w_') || up.id.startsWith('e_')) {
      const raw = up.id.slice(2)
      if ((WEAPON_DEF as Record<string, unknown>)[raw]) return 'item_' + raw
    }
    return null
  }

  // -------------------------------------------------------------------------
  // 战斗 HUD
  // -------------------------------------------------------------------------
  drawCombat(w: DiveWorld): void {
    const W = this.W
    const L = LAYERS[w.layerIdx]

    this.text(24, 26, `L${w.layerIdx + 1} ${L.name}`, 18, TXT.cyber)
    this.text(24, 48, `${w.depthM.toFixed(0)} m`, 14, TXT.dim)

    this.text(W - 24, 26, `${w.bank}`, 20, TXT.bone, true)
    this.text(W - 24, 48, '鱼骨', 12, TXT.dim, true)

    // ---- 顶部氧气条（既是血条也是计时器）----
    const bw = Math.min(420, W - 260)
    const bx = (W - bw) / 2
    const by = 22
    const frac = Math.max(0, Math.min(1, w.o2 / Math.max(1, w.o2Max)))
    const low = frac < 0.3
    this.g.fill(UI.panel, 0.75); this.g.fillRect(bx, by, bw, 12)
    this.g.fill(low ? 0xff85a8 : UI.cyan, 1); this.g.fillRect(bx + 1, by + 1, (bw - 2) * frac, 10)
    this.g.line(low ? UI.danger : UI.cyanDim, 0.9, 1); this.g.strokeRect(bx, by, bw, 12)
    this.center(W / 2, by + 6, `${Math.round(w.o2Shown)} / ${Math.round(w.o2Max)}`, 12, TXT.main)

    // ---- 波次点 ----
    const pips = w.waves().length
    for (let i = 0; i < pips; i++) {
      const px = W / 2 - (pips - 1) * 9 + i * 18
      const py = by + 26
      const c = i < w.waveInLayer ? UI.cyanDim : (i === w.waveInLayer ? UI.cyanHi : UI.panelHi)
      this.g.fill(c, 1)
      this.g.fillCircle(px, py, i === w.waveInLayer ? 5 : 3.5)
    }

    // ---- 左下：器械条（装填进度环的矩形版）----
    const wx = 24
    let wy = this.H - 76
    for (const wp of w.weapons) {
      const d = WEAPON_DEF[wp.id]
      const load = 1 - Math.max(0, Math.min(1, wp.timer / Math.max(0.0001, wp.ivLast)))
      this.g.fill(UI.panel, 0.7); this.g.fillRect(wx, wy, 132, 12)
      this.g.fill(d.color, 0.9); this.g.fillRect(wx + 1, wy + 1, 130 * load, 10)
      this.text(wx + 138, wy + 6, `${d.name} Lv${wp.lvl}`, 12, TXT.main)
      wy -= 20
    }

    // ---- 右下：遗物槽 ----
    const rx = W - 32
    let ry = this.H - 56
    for (let i = 0; i < RELIC_SLOTS; i++) {
      const id = w.relics[i]
      const on = !!id
      const active = on && w.relicActive(id!)
      this.g.fill(on ? (active ? UI.cyanHi : UI.cyanDim) : UI.panel, on ? 0.95 : 0.5)
      this.g.fillCircle(rx, ry, 7)
      ry -= 20
    }

    // ---- 状态提示 ----
    let ty = 76
    if (w.vpCur > 0) { this.text(24, ty, `暗流 ${w.vpCur.toFixed(0)}`, 13, TXT.amber); ty += 20 }
    if (w.vpPush > 0) { this.text(24, ty, `热泉上推 ${w.vpPush.toFixed(0)}`, 13, TXT.amber); ty += 20 }
    if (w.burstTimer > 0) this.text(24, ty, `排气冷却 ${w.burstTimer.toFixed(1)}s`, 13, TXT.mute)

    // ---- 层入场卡 ----
    if (w.layerCardT > 0 && L.mech) {
      const a = Math.min(1, w.layerCardT / 0.6)
      this.g.fill(MENU.page, 0.72 * a)
      this.g.fillRect(W / 2 - 260, this.H / 2 - 70, 520, 140)
      this.center(W / 2, this.H / 2 - 34, `${L.name} · ${L.mech}`, 24, TXT.cyber)
      this.center(W / 2, this.H / 2 + 4, L.tip, 15, TXT.dim)
    }
  }

  // -------------------------------------------------------------------------
  // 波间商店
  // -------------------------------------------------------------------------
  drawShop(w: DiveWorld, cbs: {
    onBuy: (i: number) => void
    onReroll: () => void
    onLock: (i: number) => void
    onLeave: () => void
  }): void {
    const W = this.W, H = this.H
    this.pageFill(MENU.page, 1)

    this.center(W / 2, 40, `L${w.layerIdx + 1} ${LAYERS[w.layerIdx].name} · 波间补给`, 22, TXT.cyber)
    this.text(W - 24, 40, `${w.bank} 鱼骨`, 18, TXT.bone, true)
    this.text(24, 40, `第 ${w.waveInLayer + 1} 波`, 16, TXT.dim)

    const cw = 300, ch = 330, gap = 24
    const x0 = (W - cw * 3 - gap * 2) / 2
    const y0 = H / 2 - ch / 2 + 10

    for (let i = 0; i < 3; i++) {
      const up: UpgradeDef | undefined = w.offers[i]
      const x = x0 + i * (cw + gap)
      const sold = w.sold[i]
      const afford = up ? w.bank >= up.cost : false
      const bg = sold ? MENU.slot : (w.locked[i] ? UI.panelHi : MENU.card)
      this.g.fill(bg, 1)
      this.g.fillRect(x, y0, cw, ch)
      const edge = !up ? MENU.edge
        : up.kind === 'relic' ? UI.violet
          : up.kind === 'mount' ? UI.amber
            : up.kind === 'weapon' ? UI.jade : UI.cyan
      this.g.line(edge, sold ? 0.25 : 0.9, 2)
      this.g.strokeRect(x, y0, cw, ch)

      if (!up) { this.center(x + cw / 2, y0 + ch / 2, sold ? '已购买' : '空', 16, TXT.mute); continue }

      // ---- 立绘框 ----
      // 卡面唯一的实底深色块（MENU 的明度阶梯是 page < slot < card）：
      // 亮色立绘要靠"比卡面更深"的底才跳得出来，垫光晕只会把画面弄脏。
      const ax = x + 14, ay = y0 + 50, aw = cw - 28, ah = 96
      this.g.fill(MENU.slot, 1); this.g.fillRect(ax, ay, aw, ah)
      this.g.line(MENU.divider, 0.8, 1); this.g.strokeRect(ax, ay, aw, ah)
      const artKey = this.cardArtKey(up)
      const artSf = artKey ? this.art.get(artKey) : undefined
      this.putArt(x + cw / 2, ay + ah / 2, aw - 8, ah - 8, artSf, sold ? 0.35 : 1)
      // 没有立绘的（属性卡 / 加装卡）在框里放一个"无图"提示，
      // 免得玩家以为卡坏了 —— 空框比缺图更含糊。
      if (!artSf) this.center(x + cw / 2, ay + ah / 2, '—', 20, TXT.mute)

      this.center(x + cw / 2, y0 + 30, up.name, 20, sold ? TXT.mute : TXT.cyber)
      this.center(x + cw / 2, y0 + 168, up.desc, 14, TXT.dim)
      if (up.relicId) this.center(x + cw / 2, y0 + 190, `遗物 · 上限 ${RELIC_SLOTS}`, 12, TXT.amber)

      // 属性卡显示"当前值"
      const statKey = STAT_CARD[up.id]
      if (statKey) {
        const meta = STAT_META.find(m => m.k === statKey)
        if (meta) {
          const cur = w.st[statKey]
          const show = meta.pct ? `${(cur * 100).toFixed(0)}%` : cur.toFixed(1)
          this.center(x + cw / 2, y0 + 214, `${meta.name} 现 ${show}`, 13, TXT.main)
        }
      }
      this.center(x + cw / 2, y0 + 250, sold ? '已购买' : `${up.cost} 鱼骨`, 18,
        sold ? TXT.mute : (afford ? TXT.bone : TXT.warn))

      const bw2 = (cw - 44) / 2, bh = 40
      this.button(x + 16 + bw2 / 2, y0 + ch - 40, bw2, bh, sold ? '已售出' : '购买',
        () => cbs.onBuy(i), !sold && afford)
      this.button(x + 16 + bw2 + 12 + bw2 / 2, y0 + ch - 40, bw2, bh, w.locked[i] ? '已锁定' : '锁定',
        () => cbs.onLock(i), !sold)
    }

    this.button(W / 2 - 130, H - 52, 200, 46, `刷新 ${w.rerollCost}`, cbs.onReroll, w.bank >= w.rerollCost)
    this.button(W / 2 + 130, H - 52, 200, 46, '继续 ▶ 下一波', cbs.onLeave, true)
  }

  // -------------------------------------------------------------------------
  // 层末：补给站决策
  // -------------------------------------------------------------------------
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
  drawResult(w: DiveWorld, cbs: { onRestart: () => void; onTitle: () => void }): void {
    const W = this.W, H = this.H
    this.pageFill(MENU.page, 0.92)
    const finalBio = w.win ? Math.floor(w.biomass * w.mult) : 0
    this.center(W / 2, H / 2 - 90,
      w.win ? (w.bossDown ? '击杀深渊守望者 · 上浮' : '上浮成功') : '氧气耗尽 · 溺水',
      26, w.win ? TXT.cyber : TXT.warn)
    this.center(W / 2, H / 2 - 40, `带出生物质 ${finalBio}`, 28, TXT.jade)
    this.center(W / 2, H / 2 + 2, w.win
      ? `${w.biomass} × ${w.mult.toFixed(1)}（下潜 ${w.layerIdx} 层）`
      : `沉没的 ${Math.floor(w.biomass * w.mult)} 生物质全部损失`, 15, w.win ? TXT.amber : TXT.warn)
    this.center(W / 2, H / 2 + 32, `L${w.layerIdx + 1} ${LAYERS[w.layerIdx].name} · 第 ${w.waveInLayer + 1} 波`, 14, TXT.dim)
    this.button(W / 2 - 115, H / 2 + 100, 210, 52, '再来一次', cbs.onRestart, true)
    this.button(W / 2 + 115, H / 2 + 100, 210, 52, '返回主界面', cbs.onTitle, true)
  }
}
