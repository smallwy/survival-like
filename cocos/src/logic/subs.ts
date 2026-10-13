/**
 * 三台潜航器（计划书 §5.3）。
 *
 * ⚠️ 本文件已从 `web/src/config/subs.ts` 抽取并**剥离引擎依赖**：
 *   - 去掉了 `import { UI } from './theme'`，颜色内联为 16 进制（UI.cyan=0x4fe8ff / UI.jade=0x7fffd4 / UI.violet=0xa06bff）。
 *   - 去掉了 Vite 的 `import ...png` 资源导入与 `SUB_ART` 的"已加载图片"映射。
 *   - `SUB_ART` 改为 **id → 相对资源路径** 映射（Cocos 侧按路径从资源数据库取图，不 import URL）。
 *
 * 这样本模块零依赖 `cc` / Phaser / Vite，可被两套前端共用。
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
    color: 0x4fe8ff,
    o2Max: 25, speed: 0, dmgMul: 0.85, pickup: 0.35, slots: 4, killO2Mul: 1, ram: 0,
  },
  {
    id: 'raia', name: '刺鳐', en: 'RAIA', tag: '走位流 · 高速撞击',
    color: 0x7fffd4,
    o2Max: 0, speed: 0.35, dmgMul: 1, pickup: -0.4, slots: 4, killO2Mul: 1, ram: 16,
  },
  {
    id: 'bathy', name: '深潜者', en: 'BATHY', tag: '清怪流 · 少氧多槽',
    color: 0xa06bff,
    o2Max: -20, speed: 0, dmgMul: 1, pickup: 0, slots: 5, killO2Mul: 1.5, ram: 0,
  },
]

export const DEFAULT_SUB: SubId = 'lumen'

export function getSub(id: SubId | undefined): SubDef {
  return SUBS.find(s => s.id === id) ?? SUBS[0]
}

/**
 * 机体贴图（**正俯视**）的 **id → 相对资源路径** 映射。
 *
 * 原 Phaser 版此处是 `import X from '...png'` 拿到的已加载图片对象；
 * Cocos 侧改用资源数据库，按相对路径（相对于 `assets/`）加载即可。
 * 路径命名与 `web/src/assets/sub/` 下的源文件保持一致。
 */
export const SUB_ART: Record<SubId, string> = {
  lumen: 'sub/sub_lumen.png',
  raia: 'sub/sub_raia.png',
  bathy: 'sub/sub_bathy.png',
}

/**
 * 贴图里**圆盘（机体本体）的半径**，px。
 *
 * ⚠️ 必须与 `tools/process_sub_variants.py` 的 `TARGET_R` 保持一致。
 * （纯数值常量，引擎无关，原样保留。）
 */
export const SUB_ART_R = 180
