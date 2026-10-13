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
  O2, MAX_SEATS, BONE, weaponFamily,
} from '../shared/dive/tables'
import type { DiveWorld } from '../shared/dive/world'
import type { UpgradeDef, WeaponId, RelicId } from '../shared/dive/types'

/** 夹到 [0,1] —— 氧条比例、冷却进度、下潜进度都用它 */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

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

    // ===== ④ 生物质（层末才显示）/ 鱼骨（常驻）=====
    // 鱼骨必须**常驻**：玩家要在战斗中就看见数字在涨，才会把"捡鱼骨"和"待会儿能买什么"连起来。
    const bY = by + (w.mult > 1 ? 48 : 26)
    g.line(BONE, 0.9, 1.4); g.strokeCircle(W - 106, bY + 8, 7)
    this.text(W - 88, bY, `${w.bank}`, 17, TXT.cyber)
    if (w.phase !== 'wave') {
      this.text(W - 24, by + 2, `生物质 ${w.biomass}`, 18, TXT.jade, true)
      if (w.mult > 1) this.text(W - 24, by + 26, `上浮可得 ${Math.floor(w.biomass * w.mult)}`, 13, TXT.amber, true)
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
  drawResult(w: DiveWorld, cbs: { onRestart: () => void; onTitle: () => void },
             record: string | null = null): void {
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
    // 新纪录（由 DiveGame 用 shared 的 applyRun 算出来，没有就不画这一行）
    if (record) this.center(W / 2, H / 2 + 60, record, 16, TXT.cyan)
    this.button(W / 2 - 115, H / 2 + 100, 210, 52, '再来一次', cbs.onRestart, true)
    this.button(W / 2 + 115, H / 2 + 100, 210, 52, '返回主界面', cbs.onTitle, true)
  }
}
