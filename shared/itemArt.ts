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
  // —— V6.30 批 4：6 条新进化（鱼叉/回声/酸液 三族各 2 条）——
  // harp_tr 三重鱼叉 / echo_fo 聚焦回声 / acid_fd 持久酸池（第一批）
  // harp_cb 回旋鱼叉 / echo_mu 多重回声 / acid_ra 酸雨（第二批）
  // 全部 image-to-image 由基础武器改造。
  // ⚠️ V6.46 起回退表改名 `WEAPON_ART_FALLBACK` 并**重新启用**（三把新机制武器尚未出图，
  //    先借语义相近的图）。本清单只列**已出图**的条目 —— 新武器出图后才加到这里。
  harp_tr: 'items/item_harp_tr.png',
  echo_fo: 'items/item_echo_fo.png',
  acid_fd: 'items/item_acid_fd.png',
  harp_cb: 'items/item_harp_cb.png',
  echo_mu: 'items/item_echo_mu.png',
  acid_ra: 'items/item_acid_ra.png',
  // —— V6.77d 批 5a：3 把机制武器（V6.46 实装机制、本版补立绘）——
  // 三族的载体是新的（碟形布雷器 / 网筒抛网器 / 球囊诱饵器），没有可改造的祖先图，
  // 所以它们是 **text-to-image 从零生成**（不是 image-to-image）。
  // ⚠️ 六个进化形态里，`mine_ch` / `mine_o2` / `lure_bo` 三个**必须是 text-to-image**：
  //    实测 image-to-image 下模型拒绝改变整机长宽比（连出两版 AR 都与基础图差 <2%），
  //    而"三族剪影两两不同"是本批的主要设计约束 ⇒ 整体比例只能靠从零生成控制。
  mine: 'items/item_mine.png',
  net: 'items/item_net.png',
  lure: 'items/item_lure.png',
  // —— V6.77d 批 5a：6 条进化 ——
  mine_ch: 'items/item_mine_ch.png',
  mine_o2: 'items/item_mine_o2.png',
  net_el: 'items/item_net_el.png',
  net_cv: 'items/item_net_cv.png',
  lure_bo: 'items/item_lure_bo.png',
  lure_wl: 'items/item_lure_wl.png',
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
  // —— V6.77d 批 5b：4 件机制遗物（V6.33 实装机制、本版补立绘）——
  // 与武器不同：**没有炮座底座**，各是一件独立物件（线圈柱 / 三爪锚 / 中空腔体 / 核心球），
  // 形状彼此不撞，也与已有 8 件不撞（腺体 / 罗盘 / 骨骼簇 / 装甲板 / 鳍 / 铭牌 / 水晶 / 心脏）。
  conductor_coil: 'items/item_conductor_coil.png',
  bleeding_anchor: 'items/item_bleeding_anchor.png',
  resonance_chamber: 'items/item_resonance_chamber.png',
  overload_core: 'items/item_overload_core.png',
}
