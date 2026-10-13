/**
 * 道具卡立绘映射（V6.21）—— **引擎无关的共享真源**（`shared/`）。
 *
 * ⚠️ 这里只保留 **id → 相对资源路径** 的关系，不带任何加载器语法
 *    （Phaser 侧的 `import X from '...png'`、Cocos 侧的 `resources.load` 都不在这儿）。
 *
 * key = 武器/遗物 id（与 `DiveScene.ts` 的 `WEAPON_DEF` / `RelicId` 对齐）。
 * 全部 1200×600（2:1）画布，商店卡按 contain 缩放，不变形不裁切。
 *
 * 路径相对于各引擎的资源根（Phaser `web/src/assets/`；Cocos `assets/`）。
 * 抠底与画布归一化见 `tools/process_item_art.py`。
 *
 * 视角统一为**侧视 3/4 带俯角**：既能看到武器本体，也能看到底部的圆形炮座。
 * 七件武器都装在**同一种圆形金属炮座**上 —— 这一点是刻意的：游戏里它们本来
 * 就都插在同一种「装载器」上，卡面立绘沿用同一底座，玩家一眼能看出
 * "这些是同一套挂载系统里的东西"。
 */
export const ITEM_ART_PATH: Record<string, string> = {
  // —— 基础武器 ——
  gun: 'items/item_gun.png',
  sonar: 'items/item_sonar.png',
  torpedo: 'items/item_torpedo.png',
  arc: 'items/item_arc.png',
  harpoon: 'items/item_harpoon.png',
  echo: 'items/item_echo.png',
  acid: 'items/item_acid.png',
  // —— 进化形态（由基础武器 image-to-image 改造而来）——
  // 键就是 `WEAPON_DEF` 里对应的 id（商店卡是 `e_` + 这个 id）。
  // 它们都是**用基础武器立绘做 image-to-image 改造**出来的，所以和基础武器
  // 同视角、同材质、同底座 —— 玩家一眼能看出"这是同一把枪的升级版"。
  gun_gl: 'items/item_gun_gl.png',
  gun_sg: 'items/item_gun_sg.png',
  torp_cl: 'items/item_torp_cl.png',
  torp_hv: 'items/item_torp_hv.png',
  arc_ov: 'items/item_arc_ov.png',
  arc_st: 'items/item_arc_st.png',
  sonar_rs: 'items/item_sonar_rs.png',
  sonar_fc: 'items/item_sonar_fc.png',
  // —— 遗物（独立物件，键 = RelicId，立绘不带炮台底座）——
  // 它们**不是**装在炮座上的武器，而是独立物件（器官 / 结晶 / 铭牌…），
  // 所以立绘不带炮台底座 —— 玩家一眼能分清"这是装备"和"这是挂载武器"。
  echo_heart: 'items/item_echo_heart.png',
  osteoblast: 'items/item_osteoblast.png',
  tidal_compass: 'items/item_tidal_compass.png',
  resonance_core: 'items/item_resonance_core.png',
  gluttony: 'items/item_gluttony.png',
  abyss_mark: 'items/item_abyss_mark.png',
  current_fin: 'items/item_current_fin.png',
  silent_plating: 'items/item_silent_plating.png',
}
