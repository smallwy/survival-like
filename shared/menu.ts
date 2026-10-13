/**
 * 主界面「常驻框架」的**引擎无关数据与布局公式**。
 *
 * 依据：`docs/主界面版式_V6.38.md`（版式已确认 2026-10-13）。Phaser 与 Cocos 两端
 * 共用本文件 —— 入口的**归属（side）与顺序（slot）只在这里写一次**，
 * 任何坐标都不写死在视图层。
 *
 * ---------------------------------------------------------------------------
 * 为什么入口表是"数据驱动"而不是"在视图层排一遍"
 * ---------------------------------------------------------------------------
 * 用户原话：「**一定要为后面功能扩展留余地**，后面可能还有**任务** ICON 的布局，
 * 可能有可能**会换位置**」。
 *
 * 于是三条约束落到本文件：
 *   ① 加一个入口 = **加一条数据**（不用碰版式）：视图层按 `side` 分组、按 `slot` 排序、
 *      按 `columnBlocks()` 算 y；
 *   ② 换位置 = **改 `side` 一个字段**，坐标全部重算；
 *   ③ 左右**不必等量** —— 每列各自垂直居中于主形象中心，左 3 右 2 也成立。
 *
 * ⚠️ **容量有物理上限**：每列舒适 3 个、极限 4 个，左右合计舒适 **6 个**。
 *    第 7 个系统不是"再加一格"，而是**归类折叠**（入口进二级页）。
 *    这也是"主界面是 hub（分流器）而非功能全集罗列"的落地形式。
 */

import type { UiIconId } from './uiArt'

/** 入口归属列。`top` 是顶栏工具区（设置 / 帮助）。 */
export type MenuSide = 'left' | 'right' | 'top'

/**
 * 入口状态。
 *   · `on`   可点
 *   · `soon` 占位（功能未实现，**显示但压暗**，不接受点击）
 *   · `lock` 锁定（有前置条件未满足，右上角显示锁形角标）
 *   · `off`  显式禁用（保留槽位，完全不显示 —— 给"临时下架"用）
 */
export type MenuState = 'on' | 'soon' | 'lock' | 'off'

export interface MenuEntry {
  /** 同时是 art key 的后缀（`icon_<id>`）与点击回调的路由键 */
  id: string
  /** 块下方标签 / 顶栏提示文字。中文硬下限 14px（`theme.ts` 已写死） */
  label: string
  side: MenuSide
  /** 同侧内的排序号，从 1 起。**决定位置，不代表"槽位天然属于谁"** */
  slot: number
  state: MenuState
  /** 图标 id（见 `shared/uiArt.ts`）。**没有图就先不给** —— 视图层退回空槽位 */
  icon?: UiIconId
  /** 锁定 / 占位的原因，视图层用作 tooltip 或灰字说明 */
  note?: string
  /** 右上角 12×12 角标是否点亮（任务红点）。与锁形角标**同位互斥** */
  badge?: boolean
}

/**
 * 入口表（当前 7 个，含 1 个预留）。
 *
 * | 侧 | 槽 1 | 槽 2 | 槽 3 |
 * |---|---|---|---|
 * | 左 | 图鉴 | 里程碑 | 任务（预留） |
 * | 右 | 装置坞 | 海域（锁定） | — |
 * | 顶栏 | 设置 | 帮助 | — |
 */
export const MENU_ENTRIES: readonly MenuEntry[] = [
  { id: 'codex',     label: '图鉴',   side: 'left',  slot: 1, state: 'on',   icon: 'codex' },
  { id: 'milestone', label: '里程碑', side: 'left',  slot: 2, state: 'on',   icon: 'milestone',
    note: '档案数据已有，视图待接入' },
  // 预留：用户明确"后面可能还有任务 ICON"。**先占位、不点亮**，位置一次留够，
  // 免得功能上线时再改版式（改文档的数字成本≈0，改完版式再改就是重排两端布点）。
  { id: 'quest',     label: '任务',   side: 'left',  slot: 3, state: 'soon', badge: false,
    note: '未实现' },
  { id: 'dock',      label: '装置坞', side: 'right', slot: 1, state: 'on',   icon: 'dock' },
  { id: 'region',    label: '海域',   side: 'right', slot: 2, state: 'lock', icon: 'region',
    note: 'L3 海域选择未实现' },
  { id: 'settings',  label: '设置',   side: 'top',   slot: 1, state: 'on',   icon: 'settings' },
  { id: 'help',      label: '帮助',   side: 'top',   slot: 2, state: 'on',   icon: 'help' },
]

/** 取某一侧的入口，按 `slot` 升序。`off` 的条目会被**过滤掉**（它不占位、不参与居中）。 */
export function entriesOf(side: MenuSide, all: readonly MenuEntry[] = MENU_ENTRIES): MenuEntry[] {
  return all
    .filter(e => e.side === side && e.state !== 'off')
    .slice()
    .sort((a, b) => a.slot - b.slot)
}

// ---------------------------------------------------------------------------
// §3.2 布局公式（N 自适应）
// ---------------------------------------------------------------------------

/** 中央主形象的中心 y —— **左右两列各自垂直居中对齐到这里**（§3.3） */
export const MENU_CENTER_Y = 392
/** 块底 → 标签顶的间距 */
export const MENU_LABEL_GAP = 16
/** 标签行高 */
export const MENU_LABEL_H = 20
/** 左栏 x（列左上角），右栏 x = 1304 − 32 − 块边长 */
export const MENU_COL_X = 32
/** 设计宽 */
export const DESIGN_W = 1304
/** 设计高 */
export const DESIGN_H = 749

export interface ColumnLayout {
  /** 块边长（正方形） */
  size: number
  /** 相邻两块顶部之间的距离 */
  pitch: number
  /** 整列高：`(N−1) × pitch + size + labelGap + labelH` */
  height: number
  /** 第 1 块顶部的 y（整列与之垂直居中于 `MENU_CENTER_Y`） */
  y0: number
  /** 每块的顶部 y 数组，长度 = N */
  tops: number[]
  /** 每块标签中心 y 数组，长度 = N */
  labelCenters: number[]
}

/**
 * 按入口数 N 算一列的几何。
 *
 * 块边长与节距取自 §3.2 的实测表（**不是公式推出来的，是"塞得进 749 高"的实测结果**）：
 *
 * | N | 块 | 节距 | 块 1 顶 | 末标签底 | 判定 |
 * |---|---|---|---|---|---|
 * | 2 | 96 | 184 | 234 | 550 | ✅ 舒适 |
 * | 3 | 88 | 164 | 166 | 618 | ✅ 舒适（16:9 与 21:9 均可见）|
 * | 4 | 80 | 140 | 124 | 660 | ⚠️ **仅 16:9 可行**，21:9 裁尾 |
 *
 * N=0 返回零尺寸（视图层据此跳过整列绘制）。
 */
export function columnBlocks(n: number): ColumnLayout {
  if (n <= 0) {
    return { size: 0, pitch: 0, height: 0, y0: MENU_CENTER_Y, tops: [], labelCenters: [] }
  }
  const size = n <= 2 ? 96 : n === 3 ? 88 : 80
  const pitch = n <= 2 ? 184 : n === 3 ? 164 : 140
  const height = (n - 1) * pitch + size + MENU_LABEL_GAP + MENU_LABEL_H
  const y0 = MENU_CENTER_Y - height / 2
  const tops: number[] = []
  const labelCenters: number[] = []
  for (let i = 0; i < n; i++) {
    tops.push(y0 + i * pitch)
    labelCenters.push(y0 + i * pitch + size + MENU_LABEL_GAP + MENU_LABEL_H / 2)
  }
  return { size, pitch, height, y0, tops, labelCenters }
}

/** 一列的 x 起点：左栏靠左边距，右栏靠右边距（宽度都是块边长）。 */
export function columnX(side: 'left' | 'right', size: number): number {
  return side === 'left' ? MENU_COL_X : DESIGN_W - MENU_COL_X - size
}

// ---------------------------------------------------------------------------
// 顶栏文案（**两端共用一份** —— 各写各的迟早会漂移）
// ---------------------------------------------------------------------------

/**
 * 档案行文案。只依赖两个字段，所以**结构化取参**而不 import `Profile` ——
 * 这样 menu.ts 不绑死在存档结构上，存档加字段不用动这里。
 *
 * 没下潜过就说"首次下潜"，**不显示一排 0**（那会让人以为是纪录）。
 */
export function menuHeaderLabel(p: { runs: number; bestLayer: number }): string {
  if (p.runs <= 0) return '潜航员 · 首次下潜'
  return `潜航员 · 下潜 ${p.runs} 次 · 最深 L${p.bestLayer + 1}`
}

/** 千分位。货币数值用等宽字体右对齐，位数变化时不会让整组左右抖动。 */
export function formatThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ---------------------------------------------------------------------------
// §7.3 四态 → 乘色值
// ---------------------------------------------------------------------------
// 位图时代四态**全部靠乘色得到**，每个图标只需一张图（不是每态一张）。
// ⚠️ 乘法只能压暗、不能提亮，所以这里的值都必须是"够亮的乘数"——
//    常态色一旦偏暗，图标暗面会直接糊成黑块（首次预览实测过）。

export const ICON_TINT = {
  /** 常态：比 `UI.cyanDim` 亮一档（原值会把图标暗面压到接近黑，实测书本/扳手糊掉） */
  normal: 0x4fb9d4,
  /** 悬停：`UI.cyan`，成品观感就是它 */
  hover: 0x4fe8ff,
  /** 按下：`UI.cyanHi` */
  down: 0xc8f8ff,
  /** 锁定：暗冷灰 —— 乘法做不到真去饱和，用低明度近似（§7.3 已记此代价） */
  lock: 0x6b7c88,
} as const
