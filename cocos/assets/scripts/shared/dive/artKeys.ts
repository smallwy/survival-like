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
import { UI_ICON_PATH, UI_BG_PATH, FX_TEX_PATH, UI_FRAME_PATH } from '../uiArt'

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
  // V6.75 **侧视位图机体**（战斗里机体本体，`DiveGame.syncSub` 在用）。
  // ⚠️ 与上面那批正俯视立绘**不是一回事**：那批只在选艇界面（`Title.ts`）用，
  //    战斗里静态的艇身/指挥塔/尾鳍/舷窗全部由这张位图承担 —— 用户 2026-10-15
  //    拍板「不要用矢量画，要有立体感」。
  //    它由 `tools/prep_sub_art.py` 产出：抠底 → 各向异性缩放到 `SUB_D × HULL_H`
  //    → 用 `HULL_OUTLINE` 裁剪影 ⇒ **剪影与挂点基准严格一致**（挂点必然贴轮廓）。
  //    摆放参数（画布尺寸 / 躯干在画布中的位置）见同目录 `sub_hull.json`。
  out.sub_hull = 'sub/sub_hull'

  // 商店立绘：武器与遗物的贴图键**统一**是 `item_<id>`（模拟层只给 id）
  for (const id of Object.keys(WEAPON_DEF)) {
    out['item_' + id] = 'items/item_' + (WEAPON_ART_FALLBACK[id] ?? id)
  }
  // V6.33：遗物同样支持**临时立绘回退**（新遗物未出图时先复用语义相近的已有图）
  for (const id of Object.keys(RELIC_DEF)) {
    out['item_' + id] = 'items/item_' + (RELIC_ART_FALLBACK[id] ?? id)
  }

  // 主界面功能图标（V6.38 新增）。**唯一一份手写来源是 `shared/uiArt.ts`** ——
  // 它没有可推导的上游表（图标不属于模拟层），所以只能手写；手写就必须只有一份。
  // 进这张表的好处：`tools/verify_cocos.py` 的"代码会要的每一张图在磁盘上都有"
  // 自动覆盖图标，**漏同步会红**，而不是运行时安静地出现一个空槽位。
  for (const [id, p] of Object.entries(UI_ICON_PATH)) {
    out['icon_' + id] = p.replace(/\.png$/, '')
  }

  // 主界面背景整图（V6.40）。key 固定 `title_bg` —— 主界面只有一张，不需要按 id 取。
  out.title_bg = UI_BG_PATH.title.replace(/\.png$/, '')

  // 击杀特效（V6.40）。key 是 `fx_<id>`，与 `FX_TEX_PATH` 的 id 字面一致。
  for (const [id, p] of Object.entries(FX_TEX_PATH)) {
    out['fx_' + id] = p.replace(/\.png$/, '')
  }

  // 主界面框架元件（V6.63）。key 是 `frame_<元件>_<态>`，与 `UI_FRAME_PATH` 的 id 字面一致。
  // 这些是 `tools/make_ui_frame.py` **程序化生成**的（不是 AI 出图），同进这张表的好处一样：
  // 少同步一张会**离线就红**，而不是运行时安静地退回矢量绘制。
  for (const [id, p] of Object.entries(UI_FRAME_PATH)) {
    out['frame_' + id] = p.replace(/\.png$/, '')
  }

  return out
}

/**
 * 武器立绘的**临时回退**（V6.29 引入 · V6.46 改名 + 复用 · **V6.77d 清空**）。
 *
 * 用途：尚未出图的武器（基础或进化都一样），先复用**语义相近**的已有立绘 ——
 * 这样美术 key 表与磁盘一致、`verify_cocos.py` 不报缺失，也不会静默缺图
 * （症状是商店卡的立绘框里显示的是别的武器）。
 *
 * ⚠️ **出图后必须把对应条目从这里删掉**，并在 `items/` 放入 `item_<id>.png`
 *   （走 `tools/process_item_art.py` → `tools/sync_art.py`）。
 *   留着不回退表 = 玩家看到的是别人的图，而管线一声不响。
 *
 * 📌 V6.77d：三把机制武器 + 六条进化的立绘**已全部出图**（批 5a），本表清空。
 *   清空后 `artPaths()` 里 `WEAPON_ART_FALLBACK[id] ?? id` 自然指向 `items/item_<id>`。
 *   保留常量占位（与 `EVO_ART_FALLBACK` 同样的处置），下版可连取用处一起删。
 */
const WEAPON_ART_FALLBACK: Record<string, string> = {}

/**
 * 遗物的**临时立绘回退**（V6.33 引入 · **V6.77d 清空**）。
 *
 * 与 `WEAPON_ART_FALLBACK` 同款：新遗物机制先落地、立绘后补，先复用**语义相近**的
 * 已有遗物图，让 `artPaths()` 与磁盘一致、管线不报缺失，也不静默缺图。
 *
 * ⚠️ 出图后处理：把对应条目从这里删掉，并在 `items/` 放入 `item_<id>.png`。
 *
 * 📌 V6.77d：4 件机制遗物（导体缠绕 / 破血锚 / 共鸣腔 / 过载核心）立绘已出图（批 5b），本表清空。
 */
const RELIC_ART_FALLBACK: Record<string, string> = {}
