// 转发到共享真源 `shared/gameData.ts`（单一真源，Phaser 与 Cocos 共用）。
//
// ⚠️ 不要在这里写任何数值 —— 改平衡请改 `shared/gameData.ts`。
//
// 注意：本表只被**已废弃**的 GameScene（`'game'` 场景，V6 起不再路由过去）使用；
// 当前正式玩法 DiveScene 的数值表在 `shared/dive/tables.ts`。
export * from '@shared/gameData'
