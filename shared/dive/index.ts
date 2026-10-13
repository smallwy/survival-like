// ============================================================================
// shared/dive —— 潜水战斗循环的**引擎无关模拟核心**
// ============================================================================
//
// 真源：`web/src/scenes/DiveScene.ts`（原 Phaser 场景，6530 行）。
// 这里只保留"状态 + 每帧更新 + 判定"，零 `cc` / Phaser / Vite 依赖；
// 一切表现（粒子、冲击波、飘字、音效、震屏）走 `SimEvent` 事件。
//
// 消费方式：
//   web/   → `@shared/dive` 别名直接引用
//   cocos/ → tools/sync_shared.py 复制到 cocos/assets/scripts/shared/dive/
//
// 典型用法（两个引擎都一样）：
//
//   const world = new DiveWorld({ w: 1304, h: 749, seed: 1234 })
//   world.update(1 / 60, { dx: 1, dy: 0, burst: false })
//   for (const ev of world.drainEvents()) renderer.handle(ev)
//
// ⚠️ 入口分两个（`shared/index.ts` 与 `shared/dive/index.ts`）是**刻意的**：
//    web 侧目前只用配置层（theme/subs/gameData/itemArt），不需要把 1000+ 行
//    模拟核心拉进它的 tsc 构建。要做 cocos/web 同源模拟时再显式 import。
// ============================================================================

export * from './types'
export * from './tables'
export * from './rng'
export * from './pool'
export * from './world'
// 美术 key→路径 的唯一说明。放这里而不是各引擎各写一份，是为了让离线验证
// 能 require 运行时同一份表去跟磁盘对账（见 artKeys.ts 头部说明）。
export * from './artKeys'
