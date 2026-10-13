// 潜航器：数据转发到共享真源 `shared/subs.ts`，本文件只负责**引擎专属的美术解析**。
//
// ⚠️ 数据（SUBS / SubDef / getSub / SUB_ART_R）请改 `shared/subs.ts`。
//
// 真源里只有 `SUB_ART_PATH`（id → 相对资源路径）这一层"关系"；
// 这里是 Phaser/Vite 侧的适配层：把路径解析成 Vite 加载好的图片 URL。
// 用 glob 派生而不是手写 import，保证与真源的路径**不可能漂移** ——
// 真源里加一台潜航器，这里自动跟着有；路径写错会立刻在启动时抛错。
import { SUB_ART_PATH, type SubId } from '@shared/subs'

export * from '@shared/subs'

const subModules = import.meta.glob('../assets/sub/*.png', {
  eager: true, import: 'default',
}) as Record<string, string>

function subUrl(rel: string): string {
  const key = `../assets/${rel}`
  const url = subModules[key]
  if (!url) {
    throw new Error(`[subs] 机体贴图缺失：${key}（shared/subs.ts 的 SUB_ART_PATH 指向的文件不存在）`)
  }
  return url
}

/** 机体贴图（正俯视）—— id → Vite 解析后的图片 URL */
export const SUB_ART = Object.fromEntries(
  Object.entries(SUB_ART_PATH).map(([id, rel]) => [id, subUrl(rel)]),
) as Record<SubId, string>
