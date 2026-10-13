// ============================================================================
// shared/ —— 引擎无关的**共享真源**
// ============================================================================
//
// 这一层零依赖 `cc` / Phaser / Vite，Phaser（web/）与 Cocos（cocos/）两套前端
// 共用同一份。改平衡/数值**只改这里**，避免两套表漂移。
//
// 消费方式（两边不同，因为 Cocos 只编译 assets/ 下的脚本）：
//   web/    → `@shared/*` 别名直接引用 `../shared/*`（见 tsconfig.json + vite.config.ts）
//   cocos/  → 由 `tools/sync_shared.py` 复制到 `cocos/assets/scripts/shared/`（带 GENERATED 横幅）
//
// 美术映射**不在这里**：这里只有 `SUB_ART_PATH` / `ITEM_ART_PATH` 这种
// "id → 相对资源路径" 的关系；各引擎自己解析成可用的图片对象。
// ============================================================================

export * from './theme'
export * from './subs'
export * from './gameData'
export * from './itemArt'
