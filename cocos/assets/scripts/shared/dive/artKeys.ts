// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/dive/artKeys.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 美术资源的 **key → 相对路径** 映射（引擎无关）。
 *
 * ---------------------------------------------------------------------------
 * 为什么这份表放在 `shared/`，而不是各引擎各写一份
 * ---------------------------------------------------------------------------
 * 这张表是**"这个游戏需要哪些美术"的唯一说明**。写两份就会漂移，而漂移的症状是
 * "某个东西在游戏里没图" —— 它**不会报错**，只会静默退回几何剪影，很难注意到。
 *
 * 放在这里之后，`tools/verify_cocos.py` 可以直接 require **运行时用的同一份表**
 * 去跟磁盘上的文件对账；不需要在验证脚本里把映射逻辑再抄一遍（抄一遍就等于
 * 又造了一个会漂移的副本）。
 *
 * ---------------------------------------------------------------------------
 * 路径约定
 * ---------------------------------------------------------------------------
 * 相对**各引擎的资源根**：Cocos 为 `cocos/assets/resources/`，
 * Phaser 为 `web/src/assets/`。两边刻意保持同样的子目录结构，
 * 所以同一份路径字符串两边通用。
 *
 * **不含扩展名** —— Cocos 的 `resources.load` 按不带扩展名的路径查找。
 *
 * 全部从既有表推导，所以"表里加了一种敌人 / 一件遗物，美术却漏了"这类漏配
 * 不会静默通过。
 */
import { ENEMY_TEX, LAYERS, WEAPON_DEF, RELIC_DEF } from './tables'
import { SUB_ART_PATH } from '../subs'

export function artPaths(): Record<string, string> {
  const out: Record<string, string> = {}

  // 敌人贴图：key 就是 `ENEMY_TEX` 的值（f_swarm / f_dash / f_drift），
  // 文件名是 web 侧原文件名，去掉 `f_` 前缀。Boss 复用 dash 的图，自然去重。
  for (const key of Object.values(ENEMY_TEX)) {
    out[key] = 'fish/' + key.replace(/^f_/, '')
  }

  // 环境背景：key 是 `env<层下标>`（渲染层按 layerIdx 取），文件是 `L<层号>.png`
  for (let i = 0; i < LAYERS.length; i++) {
    out['env' + i] = 'env/L' + (i + 1)
  }

  // 潜航器：`SUB_ART_PATH` 已是各引擎资源根下的相对路径（带 .png），去扩展名即可
  for (const [id, p] of Object.entries(SUB_ART_PATH)) {
    out['sub_' + id] = p.replace(/\.png$/, '')
  }
  out.sub_body = 'sub/sub_body'   // 变体图缺失时的兜底机体

  // 商店立绘：武器与遗物的贴图键**统一**是 `item_<id>`（模拟层只给 id）
  for (const id of Object.keys(WEAPON_DEF)) out['item_' + id] = 'items/item_' + id
  for (const id of Object.keys(RELIC_DEF)) out['item_' + id] = 'items/item_' + id

  return out
}
