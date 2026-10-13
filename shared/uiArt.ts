/**
 * UI 功能图标的 **id → 相对资源路径**（引擎无关）。
 *
 * ---------------------------------------------------------------------------
 * 为什么单独一份，而不是塞进 `shared/dive/artKeys.ts`
 * ---------------------------------------------------------------------------
 * `artKeys.ts` 是「**模拟层会去要的**美术」的说明（敌人 / 背景 / 机体 / 商店立绘），
 * 由 `ENEMY_TEX` / `LAYERS` / `WEAPON_DEF` 等**从既有表推导**。
 * UI 图标不属于模拟层 —— 它是**主界面的框架素材**，没有可推导的上游表，
 * 所以只能手写。手写就必须**只有一份**：这里。
 *
 * 两处消费，全部指向本文件：
 *   · `shared/dive/artKeys.ts`     —— 合并进 `artPaths()`，于是 `verify_cocos.py` 的
 *      "代码会要的每一张图在磁盘上都有" 自动覆盖图标（漏出图会红，而不是静默空槽位）；
 *   · `tools/process_ui_icon.py`   —— 按本文件的 id 命名，写到
 *      `cocos/assets/resources/ui/icons/`。
 *
 * ⚠️ **2026-10-13 晚：web 原型已冻结**（用户决定「只做 cocos 单端」）。
 *    原 Phaser 侧适配层 `web/src/config/uiArt.ts` 已删，图标只落 cocos 一处。
 *
 * ---------------------------------------------------------------------------
 * 两条硬约束（写错任一条都会在运行时静默出错）
 * ---------------------------------------------------------------------------
 * 1. **路径不带前导 `assets/`** —— 相对资源根 `cocos/assets/resources/`。
 * 2. **文件名里的 id 与 `shared/menu.ts` 的 `MenuEntry.icon` 必须字面一致**。
 *    对不上的症状是"某个入口没有图标"，**它不报错**，只会安静地退回空槽位。
 *
 * 出图与后处理见 `tools/process_ui_icon.py`（512×512 · 外接圆 72% · 单色可染），
 * 规格依据 `docs/主界面版式_V6.38.md` §7。
 *
 * 为什么是**单色冷白**而不是彩色：四态（常态／悬停／按下／锁定）全部靠运行时
 * `sprite.color` **乘色**得到（§7.3），每个图标只需一张图。乘法只能压暗不能提亮，
 * 所以基底必须接近纯白 —— 彩色底再乘彩色会变暗变脏。
 */

/** id → 相对资源路径（带扩展名，与 `SUB_ART_PATH` 同口径） */
export const UI_ICON_PATH = {
  /** 图鉴：打开的书 + 页线 */
  codex: 'ui/icons/icon_codex.png',
  /** 里程碑：旗杆 + 三角旗 */
  milestone: 'ui/icons/icon_milestone.png',
  /** 装置坞：扳手 + 六角螺母（工程件 —— 刻意避开"齿轮"，防与设置认错） */
  dock: 'ui/icons/icon_dock.png',
  /** 海域：水滴形地图定位针 */
  region: 'ui/icons/icon_region.png',
  /**
   * 设置：**三条水平滑杆**（`tune` 字形）。
   * ⚠️ 为什么不是"竖直双滑杆"：竖直版天然宽高比 1:2.6（实测切出 149×382），
   * 按 contain 缩进 24px 方框后**宽度只剩约 9px，就是一根细线**。
   * **凡是进 24 档的图标，图形本身必须接近正方** —— 这是 24 档的选形约束。
   */
  settings: 'ui/icons/icon_settings.png',
  /** 帮助：粗圆环 + 问号 */
  help: 'ui/icons/icon_help.png',
} as const

export type UiIconId = keyof typeof UI_ICON_PATH

/**
 * 主界面背景整图（V6.40 新增）。
 *
 * 为什么背景要进位图表：它同样**没有可推导的上游表**（不是模拟层要的东西），
 * 手写就必须只有一份；进 `artPaths()` 后 `verify_cocos.py` 会替我们看着 ——
 * 少同步一张背景不会静默变成"黑背景"，而是离线就红。
 *
 * ⚠️ **这是主界面专用**，与战斗内的 `env/L1..L5.png` 是两套东西：
 *   · 主界面背景 = 单张、静态、信息量高（岩壁 / 珊瑚 / 沉船 / 水母群）；
 *   · 战斗背景 = 五层深度递进、几乎纯暗（HUD 与弹药要在上面读得清）。
 * 两者**不可互借** —— 把主界面这张铺进战斗，敌人会在珊瑚丛里消失。
 */
export const UI_BG_PATH = {
  /** 主界面：深海深渊峡谷（1536×1024，铺满用 cover，中央偏上留暗区给标题） */
  title: 'ui/title_bg.png',
} as const

export type UiBgId = keyof typeof UI_BG_PATH

/**
 * 击杀特效贴图（V6.40 新增）。
 *
 * 出图规范与图标**不同**，别照抄：
 *   · 背景是**纯黑**而非纯白 —— 特效是发光，黑底在 ADD/SCREEN 叠加下天然透明；
 *   · 处理方式是 **alpha = 亮度**（`tools/process_fx.py`），不是四边泛洪抠底 ——
 *     辉光会一路渐变到接近黑，任何泛洪阈值都切不干净。
 * 尺寸 512×512、内容占画布 94%（`process_fx.py` 的 `fill`）。
 */
export const FX_TEX_PATH = {
  /** 冲击波环：击杀瞬间向外扩散的一圈白青环，主用 */
  ring: 'fx/sh_ring.png',
  /** 爆散闪光：中心高亮核 + 放射碎片，重击 / Boss 用 */
  burst: 'fx/sh_burst.png',
  /** 水泡迸散：向上飞散的气泡，胶质 / 水母类击杀用 */
  bubble: 'fx/sh_bubble.png',
} as const

export type FxTexId = keyof typeof FX_TEX_PATH

/**
 * 图标画布边长（px）。**512 是出图与后处理的基准**，不是显示尺寸。
 *
 * 显示尺寸见 `shared/menu.ts` 的 `columnBlocks()`：侧栏 96 / 88，顶栏 24。
 * 从 512 缩到 96 是 5.3× —— 这不是浪费：引擎缩图时用 LANCZOS 降采样，
 * 采样余量越大，四档明暗的边界越干净（低分辨率源缩下来描边会起锯齿）。
 */
export const UI_ICON_CANVAS = 512

/**
 * 图形外接圆直径占画布的比例（`tools/process_ui_icon.py` 的 `FILL`）。
 * 与 §7.1 A 表第 6 行同值 —— 改这里必须同步改脚本，反之亦然。
 */
export const UI_ICON_FILL = 0.72
