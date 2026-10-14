// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/uiArt.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
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
 * 主界面**框架元件**（V6.63 新增，程序化生成）。
 *
 * 与图标 / 背景 / 特效三类的区别：**这些不是 AI 出图的，是脚本算出来的**。
 *
 * 为什么几何元件不交给 AI 出图：框架元件的全部技术指标是 —— 圆角半径、描边宽度、
 * 九宫格边界值、高光带位置。**这四项 AI 一项都给不准**（它给的是"看起来像圆角矩形"，
 * 不是"半径 11px 的圆角矩形"）。圆角算错的后果不是"难看"，是**九宫格角块接不上**
 * （拉伸后四角起毛刺）。程序化还多一个 AI 给不了的东西：**改一个常量重跑就换一版**。
 *
 * 生产脚本 `tools/make_ui_frame.py`（PIL 超采样 ×4 后降采样到 @2× 输出），
 * 取值**逐字对齐 `cocos/assets/scripts/view/Title.ts` 实装**，不按 `主界面版式_V6.38.md`
 * （该文档 §3.3 / §8.2 有三处已被 V6.41 实装取代，见脚本头部的对照表）。
 *
 * ⚠️ key 的命名是 `<元件>_<态>`，与磁盘文件名**字面一致**（去掉 .png）。
 *    态名沿用实装：`off` / `hi` / `press` / `lock`（槽位）、`dis`（按钮禁用）。
 *
 * ⚠️ **面板只出九宫格源图（设计 64×64），不出 880×660 整图** —— 整图 @2× 约 1MB，
 *    源图 128×128 只有几 KB，拉伸后观感一致。代价：面板底**不能带纵向渐变**
 *    （中段会被纵向拉伸 41×），所以面板态刻意只有纯色 + 描边。
 */
export const UI_FRAME_PATH = {
  /** 玻璃槽位底 96×96 r12 —— 四态。锁定态**没有高光**（高光会误导"这个能点"） */
  slot_off: 'ui/frame/slot_off.png',
  slot_hi: 'ui/frame/slot_hi.png',
  slot_press: 'ui/frame/slot_press.png',
  slot_lock: 'ui/frame/slot_lock.png',
  /** 主按钮底 236×62 r11（V6.41 实装值，**不是** 文档 §3.3 的 340×68）—— 四态 */
  btn_off: 'ui/frame/btn_off.png',
  btn_hi: 'ui/frame/btn_hi.png',
  btn_press: 'ui/frame/btn_press.png',
  btn_dis: 'ui/frame/btn_dis.png',
  /** 面板底九宫格源图 64×64 r18 —— 装置坞 / 出击准备共用一张 */
  panel_off: 'ui/frame/panel_off.png',
} as const

export type UiFrameId = keyof typeof UI_FRAME_PATH

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
