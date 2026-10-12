import { UI } from './theme'
import SUB_LUMEN from '../assets/sub/sub_lumen.png'
import SUB_RAIA from '../assets/sub/sub_raia.png'
import SUB_BATHY from '../assets/sub/sub_bathy.png'

/**
 * 三台潜航器（计划书 §5.3）。
 *
 * 三者必须是**机制差异**而不是数值差异 —— 计划书 §5.1 定的：
 * "用质变密度补数量不足"。所以每台都带**一条同轴代价**，
 * 否则玩家只会永远选"最强的那个"：
 *
 *   灯艇 Lumen   —— 续航换火力：氧气上限最高、吸附最强，但全局伤害 −15%
 *   刺鳐 Raia    —— 走位换补给：移速最快、撞击伤害，但吸附范围 −40%（更难捞气泡）
 *   深潜者 Bathy —— 火力换续航：氧气上限 −20，但击杀回氧 ×1.5 且**装备槽 +1**
 *
 * 数值都刻意保守：这是"开局差异"，不是"永久强化"。
 * 真正的 build 深度来自武器进化与商店，潜航器只负责给一个**初始倾向**。
 */
export type SubId = 'lumen' | 'raia' | 'bathy'

export interface SubDef {
  id: SubId
  name: string
  en: string
  /** 一句话定位（选择界面显示） */
  tag: string
  /** 主题色（选择界面的强调色） */
  color: number
  /** 氧气上限的**绝对**增减 */
  o2Max: number
  /** 移速加成（加到 st.speed 上，0.35 = +35%） */
  speed: number
  /** 全局伤害倍率（1 = 不变） */
  dmgMul: number
  /** 吸附范围加成（加到 st.pickup 上，可为负） */
  pickup: number
  /** 开局装备槽（基础 4） */
  slots: number
  /** 击杀回氧倍率（1 = 不变） */
  killO2Mul: number
  /** 撞击伤害：玩家撞上敌人时对其造成的伤害（0 = 无此特性） */
  ram: number
}

export const SUBS: SubDef[] = [
  {
    id: 'lumen', name: '灯艇', en: 'LUMEN', tag: '续航流 · 广域捞取',
    color: UI.cyan,
    o2Max: 25, speed: 0, dmgMul: 0.85, pickup: 0.35, slots: 4, killO2Mul: 1, ram: 0,
  },
  {
    id: 'raia', name: '刺鳐', en: 'RAIA', tag: '走位流 · 高速撞击',
    color: UI.jade,
    o2Max: 0, speed: 0.35, dmgMul: 1, pickup: -0.4, slots: 4, killO2Mul: 1, ram: 16,
  },
  {
    id: 'bathy', name: '深潜者', en: 'BATHY', tag: '清怪流 · 少氧多槽',
    color: UI.violet,
    o2Max: -20, speed: 0, dmgMul: 1, pickup: 0, slots: 5, killO2Mul: 1.5, ram: 0,
  },
]

export const DEFAULT_SUB: SubId = 'lumen'

export function getSub(id: SubId | undefined): SubDef {
  return SUBS.find(s => s.id === id) ?? SUBS[0]
}

/**
 * 机体贴图（**正俯视**）。
 *
 * 同一张图担两个职责：**战斗内就是机体本体，选择界面就是立绘** ——
 * Brotato 也是这么做的，好处是玩家在选的时候看到的就是他实际会操控的那一艘，
 * 不会出现"卡面一个样、进游戏另一个样"。
 *
 * 三台的**外轮廓都是正圆**，这一点是硬约束：座圈（装载器环）半径固定，
 * 机体形状一变圆环就会错位浮空。所以区分靠**特征件**而不是外形：
 *   灯艇   —— 外缘一圈 12 个发光舷窗 + 中央大面积光池（明亮 · 开阔）
 *   刺鳐   —— 正前方楔形撞角 + 两侧流线散热鳍 + 梭形核心（尖锐 · 高速）
 *   深潜者 —— 6 段厚重装甲板 + 紫光板缝 + 外缘机械卡座（厚重 · 军械）
 */
export const SUB_ART: Record<SubId, string> = {
  lumen: SUB_LUMEN,
  raia: SUB_RAIA,
  bathy: SUB_BATHY,
}

/**
 * 贴图里**圆盘（机体本体）的半径**，px。
 *
 * ⚠️ 必须与 `tools/process_sub_variants.py` 的 `TARGET_R` 保持一致。
 *
 * 为什么要这个常量：三台的贴图都带突出件（刺鳐有撞角 + 两侧散热鳍，突出比 K=1.55；
 * 灯艇几乎无突出件 K=1.06），若按"贴图整体"来缩放，三台机体在屏幕上会**差一倍**、
 * 边缘光环也会在刺鳐上明显浮空。处理脚本已把三张的圆盘半径统一缩放到本值，
 * 所以游戏里用 `setScale(直径 / (2 * SUB_ART_R))` 就能让圆盘尺寸一致。
 */
export const SUB_ART_R = 180
