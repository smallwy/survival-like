// 转发到共享真源 `shared/theme.ts`（单一真源，Phaser 与 Cocos 共用）。
// 本文件只是为了让既有 `../config/theme` 的引用路径保持不动。
//
// ⚠️ 不要在这里写任何常量 —— 改色板/字体请改 `shared/theme.ts`。
export * from '@shared/theme'
