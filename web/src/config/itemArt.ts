import GUN from '../assets/items/item_gun.png'
import SONAR from '../assets/items/item_sonar.png'
import TORPEDO from '../assets/items/item_torpedo.png'
import ARC from '../assets/items/item_arc.png'
import HARPOON from '../assets/items/item_harpoon.png'
import ECHO from '../assets/items/item_echo.png'
import ACID from '../assets/items/item_acid.png'
// —— 批 2：进化形态（由基础武器 image-to-image 改造而来）——
import GUN_GL from '../assets/items/item_gun_gl.png'
import GUN_SG from '../assets/items/item_gun_sg.png'
import TORP_CL from '../assets/items/item_torp_cl.png'
import TORP_HV from '../assets/items/item_torp_hv.png'
import ARC_OV from '../assets/items/item_arc_ov.png'
import ARC_ST from '../assets/items/item_arc_st.png'
import SONAR_RS from '../assets/items/item_sonar_rs.png'
import SONAR_FC from '../assets/items/item_sonar_fc.png'
// —— 批 3：遗物（独立物件，键 = RelicId）——
import REL_ECHO_HEART from '../assets/items/item_echo_heart.png'
import REL_OSTEOBLAST from '../assets/items/item_osteoblast.png'
import REL_TIDAL_COMPASS from '../assets/items/item_tidal_compass.png'
import REL_RESONANCE_CORE from '../assets/items/item_resonance_core.png'
import REL_GLUTTONY from '../assets/items/item_gluttony.png'
import REL_ABYSS_MARK from '../assets/items/item_abyss_mark.png'
import REL_CURRENT_FIN from '../assets/items/item_current_fin.png'
import REL_SILENT_PLATING from '../assets/items/item_silent_plating.png'

/**
 * 道具卡立绘（V6.21）。
 *
 * key = **基础武器 id**（即 `WEAPON_DEF` 的键去掉 `w_` 前缀），例如 `'gun'`。
 * 进化形态（`gun_gl` 等）暂时仍由代码画图标 —— 它们的立绘是另一批。
 *
 * 全部是 **1200×600（2:1）** 画布：商店卡的立绘框实测约 200×100，同比例，
 * 所以游戏里按 contain 缩放放进去，任何卡高下都不会变形、也不会被裁。
 * 抠底与画布归一化见 `tools/process_item_art.py`。
 *
 * 视角统一为**侧视 3/4 带俯角**：既能看到武器本体，也能看到底部的圆形炮座。
 * 七件武器都装在**同一种圆形金属炮座**上 —— 这一点是刻意的：游戏里它们本来
 * 就都插在同一种「装载器」上，卡面立绘沿用同一底座，玩家一眼能看出
 * "这些是同一套挂载系统里的东西"。
 */
export const ITEM_ART: Record<string, string> = {
  gun: GUN,
  sonar: SONAR,
  torpedo: TORPEDO,
  arc: ARC,
  harpoon: HARPOON,
  echo: ECHO,
  acid: ACID,
  // 进化形态。键就是 `WEAPON_DEF` 里对应的 id（商店卡是 `e_` + 这个 id）。
  // 它们都是**用基础武器立绘做 image-to-image 改造**出来的，所以和基础武器
  // 同视角、同材质、同底座 —— 玩家一眼能看出"这是同一把枪的升级版"。
  gun_gl: GUN_GL,
  gun_sg: GUN_SG,
  torp_cl: TORP_CL,
  torp_hv: TORP_HV,
  arc_ov: ARC_OV,
  arc_st: ARC_ST,
  sonar_rs: SONAR_RS,
  sonar_fc: SONAR_FC,
  // 遗物。它们**不是**装在炮座上的武器，而是独立物件（器官 / 结晶 / 铭牌…），
  // 所以立绘不带炮台底座 —— 玩家一眼能分清"这是装备"和"这是挂载武器"。
  echo_heart: REL_ECHO_HEART,
  osteoblast: REL_OSTEOBLAST,
  tidal_compass: REL_TIDAL_COMPASS,
  resonance_core: REL_RESONANCE_CORE,
  gluttony: REL_GLUTTONY,
  abyss_mark: REL_ABYSS_MARK,
  current_fin: REL_CURRENT_FIN,
  silent_plating: REL_SILENT_PLATING,
}
