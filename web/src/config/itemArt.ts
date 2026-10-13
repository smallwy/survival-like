// 道具卡立绘：关系转发到共享真源 `shared/itemArt.ts`，本文件只负责**引擎专属的美术解析**。
//
// ⚠️ id ↔ 文件 的关系请改 `shared/itemArt.ts`（`ITEM_ART_PATH`）。
//
// 这里把"相对路径"解析成 Vite 加载好的图片 URL。
// 用 glob 派生而不是手写 25 行 `import`，保证与真源不能漂移；
// 真源里指向的文件不存在时，启动即抛错（而不是在商店里画出一个空框）。
import { ITEM_ART_PATH } from '@shared/itemArt'

const itemModules = import.meta.glob('../assets/items/*.png', {
  eager: true, import: 'default',
}) as Record<string, string>

function itemUrl(rel: string): string {
  const key = `../assets/${rel}`
  const url = itemModules[key]
  if (!url) {
    throw new Error(`[itemArt] 道具立绘缺失：${key}（shared/itemArt.ts 的 ITEM_ART_PATH 指向的文件不存在）`)
  }
  return url
}

/** 道具卡立绘 —— id → Vite 解析后的图片 URL */
export const ITEM_ART: Record<string, string> = Object.fromEntries(
  Object.entries(ITEM_ART_PATH).map(([id, rel]) => [id, itemUrl(rel)]),
)
