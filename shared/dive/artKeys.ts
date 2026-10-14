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
import { UI_ICON_PATH, UI_BG_PATH, FX_TEX_PATH } from '../uiArt'

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

  return out
}

/**
 * 武器立绘的**临时回退**（V6.29 引入 · V6.46 改名 + 复用）。
 *
 * 用途：尚未出图的武器（基础或进化都一样），先复用**语义相近**的已有立绘 ——
 * 这样美术 key 表与磁盘一致、`verify_cocos.py` 不报缺失，也不会静默缺图
 * （症状是商店卡的立绘框里显示的是别的武器）。
 *
 * 原名 `EVO_ART_FALLBACK`（只管进化）；V6.46 新增三把基础武器（气泡雷 / 网 / 诱饵）
 * 也要回退，名字就不准了 —— 改成 `WEAPON_ART_FALLBACK`，基础与进化共用一张。
 *
 * ⚠️ **出图后必须把对应条目从这里删掉**，并在 `items/` 放入 `item_<id>.png`
 *   （走 `tools/process_item_art.py` → `tools/sync_art.py`）。
 *   留着不回退表 = 玩家看到的是别人的图，而管线一声不响。
 */
const WEAPON_ART_FALLBACK: Record<string, string> = {
  // V6.46 三把机制武器 + 六条进化：**立绘待出**，先借语义最近的图占位。
  // 气泡雷族 → 球形主体，借回声系列；网族 → 能量/控制，借电弧系列；
  // 诱饵族 → 发光扩散，借声呐系列。
  mine: 'echo', mine_ch: 'echo', mine_o2: 'echo_mu',
  net: 'arc', net_el: 'arc_ov', net_cv: 'arc_st',
  lure: 'sonar', lure_bo: 'echo_fo', lure_wl: 'sonar_rs',
}

/**
 * 遗物的**临时立绘回退**（V6.33 引入）。
 *
 * 与 `EVO_ART_FALLBACK` 同款：新遗物机制先落地、立绘后补，先复用**语义相近**的
 * 已有遗物图，让 `artPaths()` 与磁盘一致、管线不报缺失，也不静默缺图。
 *
 * ⚠️ 出图后处理：把对应条目从这里删掉，并在 `items/` 放入 `item_<id>.png`
 *   （走 `tools/process_item_art.py` → `tools/sync_art.py`）。
 */
const RELIC_ART_FALLBACK: Record<string, string> = {
  conductor_coil: 'resonance_core',   // 都是"能量耦合"意象
  bleeding_anchor: 'abyss_mark',      // 都是"尖锐/撕裂"意象
  resonance_chamber: 'echo_heart',    // 同属回声家族
  overload_core: 'gluttony',          // 都是"核心件"意象
}
