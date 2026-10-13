/**
 * 道具卡立绘映射（V6.21，已从 `web/src/config/itemArt.ts` 抽取）。
 *
 * ⚠️ 已剥离 Vite 的 `import X from '...png'`（那是 Phaser 侧拿"已加载图片对象"的写法）。
 * 这里只保留 **id → 相对资源路径** 的关系，Cocos 侧按路径从资源数据库取图。
 * 路径命名与 `web/src/assets/items/` 下的源文件保持一致（相对 `assets/`）。
 *
 * key = 武器/遗物 id（与 `gameData.ts` 的 WEAPONS / 遗物 id 对齐）。
 * 全部 1200×600（2:1）画布，商店卡按 contain 缩放，不变形不裁切。
 */
export const ITEM_ART: Record<string, string> = {
  // —— 基础武器 ——
  gun: 'items/item_gun.png',
  sonar: 'items/item_sonar.png',
  torpedo: 'items/item_torpedo.png',
  arc: 'items/item_arc.png',
  harpoon: 'items/item_harpoon.png',
  echo: 'items/item_echo.png',
  acid: 'items/item_acid.png',
  // —— 进化形态（由基础武器 image-to-image 改造而来）——
  gun_gl: 'items/item_gun_gl.png',
  gun_sg: 'items/item_gun_sg.png',
  torp_cl: 'items/item_torp_cl.png',
  torp_hv: 'items/item_torp_hv.png',
  arc_ov: 'items/item_arc_ov.png',
  arc_st: 'items/item_arc_st.png',
  sonar_rs: 'items/item_sonar_rs.png',
  sonar_fc: 'items/item_sonar_fc.png',
  // —— 遗物（独立物件，键 = RelicId，立绘不带炮台底座）——
  echo_heart: 'items/item_echo_heart.png',
  osteoblast: 'items/item_osteoblast.png',
  tidal_compass: 'items/item_tidal_compass.png',
  resonance_core: 'items/item_resonance_core.png',
  gluttony: 'items/item_gluttony.png',
  abyss_mark: 'items/item_abyss_mark.png',
  current_fin: 'items/item_current_fin.png',
  silent_plating: 'items/item_silent_plating.png',
}
