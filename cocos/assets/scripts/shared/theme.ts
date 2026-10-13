// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/theme.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 视觉设计系统 —— 赛博霓虹深海（V4）
 *
 * ---------------------------------------------------------------------------
 * 为什么整套色板被换掉（2026-10-10，V3 → V4）
 * ---------------------------------------------------------------------------
 * 旧版是"程序化像素 + 32×32 源图"，在没有整数倍缩放保证的浏览器环境里**必然糊**
 * （论证见《项目计划书》V4 §1.1）。V4 改用**矢量几何 + 多层霓虹发光**：
 * 模糊在霓虹风里读作"辉光溢出"，非整数缩放反而加成。
 *
 * 三条硬规则（违反会导致可读性崩坏，都已踩过坑）：
 *
 *   ① **色相隔离**：青蓝系（cyan*）只给 UI 与玩家；生物发光用 jade / magenta /
 *      amber / violet。玩家看到青蓝就知道"这是我的仪表"，看到别的色就知道
 *      "那是活物"。混用会分不清 HUD 与敌人。
 *
 *   ② **必须有 core 层**：发光一律三层叠加
 *        bloom(+24px, α .12) → halo(+8px, α .35) → core(1-2px, α 1.0)
 *      其中 core 的 100% 实色是**整体清晰感的锚点**——即使 halo / bloom 被缩放
 *      拉变形，1px 实色边依然锐利。只有柔光没有 core = 一团糊光。
 *      实现见 `render/neon.ts`。
 *
 *   ③ **双渲染器兼容**：`setBlendMode(ADD)` 与 `fillGradientStyle()` 是 WebGL-only，
 *      Canvas 渲染器下会把图形画成实心白 / 青块（搭建 TitleScene 时实测）。
 *      所有发光与渐变都必须有 Canvas 降级写法。
 *
 * 注意：颜色分**两套**——图形用 `UI.*`（number），文字用 `TXT.*`（'#rrggbb' 串）。
 * 混用会得到"黑字黑底"，这是 Phaser 里最常见的一类隐形 bug（本项目已踩过）。
 */
// ---------------- 图形色（number） ----------------
/** 底色板。别名区（见下方 UI）要在对象外合成，否则会出现自引用的循环推断。 */
const PALETTE = {
  // —— 底 ——
  abyss:   0x04070d,   // 全场底色（近黑蓝），比任何东西都暗
  panel:   0x08111c,   // 面板底
  panelHi: 0x0e1a29,   // 抬起面 / 悬停面
  rock:    0x16283c,   // 岩壁轮廓（低饱和暗蓝）
  line:    0x1b3348,   // 弱分隔线

  // —— 主色 · 青蓝（UI + 玩家 + 探测器专属）——
  cyan:    0x4fe8ff,
  cyanHi:  0xc8f8ff,
  cyanDim: 0x1f6a7d,

  // —— 生物发光色（禁止用于 UI）——
  jade:     0x7fffd4,  // 青绿 · 常见生物
  jadeHi:   0xc4fff0,
  magenta:  0xff4fd8,  // 品红 · 稀有 / 危险生物
  amber:    0xffd166,  // 琥珀 · 资源 / 热泉 / 拾取物
  violet:   0xa06bff,  // 紫 · 深渊 / Boss

  // —— 危险（全场唯一纯红，只允许用在致命预警）——
  danger:    0xff2e63,
  dangerDim: 0x5c1024,
} as const

export const UI = {
  ...PALETTE,

  // =====================================================================
  // 已废弃的旧色名（V3「暖黑 + 鎏金」遗留）。
  // 保留它们的唯一目的是让 GameScene 仍能编译，全部指向新的霓虹等价色。
  // GameScene 在 V4 中已被 ExploreScene 取代，S3 阶段随 GameScene 一并删除。
  // =====================================================================
  /** @deprecated 用 UI.cyan（旧称"鎏金"，实际早已是生物发光青） */
  gold:    PALETTE.cyan,
  /** @deprecated 用 UI.cyanHi */
  goldHi:  PALETTE.cyanHi,
  /** @deprecated 用 UI.cyanDim */
  goldDim: PALETTE.cyanDim,
  /** @deprecated 用 UI.abyss */
  ink0:    PALETTE.abyss,
  /** @deprecated 用 UI.panel */
  ink1:    PALETTE.panel,
  /** @deprecated 用 UI.panelHi */
  ink2:    PALETTE.panelHi,
  /** @deprecated 用 UI.rock */
  ink3:    PALETTE.rock,
  /** @deprecated 用 UI.danger */
  red:     PALETTE.danger,
  /** @deprecated 用 UI.jadeHi */
  redHi:   PALETTE.jadeHi,
} as const

// ---------------- 文字色（'#rrggbb'） ----------------
export const TXT = {
  main:  '#dceef5',   // 正文 · 冷白
  dim:   '#7f9bab',   // 次要
  mute:  '#4d6b7c',   // 禁用 / 未激活
  cyan:  '#7fefff',   // 强调数值
  cyber: '#c8f8ff',   // 高亮数值
  jade:  '#c4fff0',   // 成功 / 生物
  amber: '#ffe0a3',   // 资源 / 提示
  warn:  '#ff85a8',   // 告警
  bone:  '#dcfffb',   // 鱼骨（货币）/ 遗物——和 BONE 图形色 0xdcfffb 对齐

  // ---- 废弃别名，随 GameScene 一并删除 ----
  /** @deprecated 用 TXT.cyan */
  gold:   '#7fefff',
  /** @deprecated 用 TXT.cyber */
  goldHi: '#c8f8ff',
  /** @deprecated 用 TXT.warn */
  red:    '#ff85a8',
} as const

/**
 * 构建标记 —— 显示在标题画面右下角。
 *
 * 存在的唯一目的：让"我到底有没有拿到新代码"这件事**不用猜**。
 * 之前多次出现"你改了但我这边没变化"，排查全耗在确认代码版本上。
 * 改一次代码就 +1，用户看一眼右下角就知道 pull 生效没有。
 */
export const BUILD_TAG = 'v6.27'

/**
 * 菜单/弹窗专用"实底色"（V6.25）。
 *
 * 为什么不复用上面的霓虹色板（有实测依据，不是审美偏好）：
 * 量用户对商店截图的反馈发现——**卡与卡之间的背景亮度 62、方差 51，
 * 而卡内只有 34 / 29**。也就是说全场最抢眼的是卡片背后的霓虹装饰，
 * 而不是玩家该做的决策。根因两条：① 背景还在画海景装饰 ② 卡面半透明，
 * 背景辉光直接透进卡里（实测立绘区内部亮度方差 26.6）。
 *
 * Brotato 的做法相反：背景近纯黑（亮度 ~15、方差 ~5），卡是不透明实底、
 * 比背景亮一档。**"清晰简单"来自对比，不来自装饰。**
 *
 * 所以菜单页单独一套：卡面/槽位/描边全部**不透明**，且满足
 *   page < slot < card < cardHi
 * 这条明度阶梯。游戏内 HUD 仍然用霓虹半透明（那里要的是氛围与穿透）。
 */
export const MENU = {
  page:     0x0a0e14,   // 页面底（近纯黑，比 UI.abyss 略亮一档但不是蓝）
  card:     0x1a212c,   // 卡面实底 —— 必须明显亮于 page
  cardHi:   0x232c39,   // 悬停卡面
  slot:     0x0c1117,   // 立绘/图标位（比卡面**更深**，让亮色立绘跳出来）
  divider:  0x2b3543,   // 卡内分隔
  edge:     0x39455a,   // 中性描边（已售出 / 无类型色时用）
} as const

/**
 * 亮色弹窗皮肤（V7「浅海」方向）。
 *
 * 与 `MENU`（暗色实底）并列 —— 菜单页有两套皮肤，按场景选：
 *   · `MENU`   —— 暗色，用于战斗内的层入场卡等"不能跳出画面"的场合；
 *   · `BRIGHT` —— 亮色，用于**商店**这种"玩家要停下来做决策"的整幅弹窗。
 *
 * ⚠️ 名字不能叫 `LIGHT`：`gameData.ts` 已有一个 `LIGHT`（关卡光照定义），
 *    而 `shared/index.ts` 是 `export *` 重导出，同名会直接编译报 TS2308。
 *
 * 为什么商店要亮（用户原话：「我需要亮色的 现在画风很暗」）：
 *   暗色实底面板在**明亮水层**（L1/L2）本来就吃亏 —— 一整块近黑把背景切走，
 *   既是"全屏感"的来源，也让卡上的立绘失去参照。亮色面板则是"深海里的潜水终端"
 *   这个直觉：面板自己发光、浮在水里，背景的海还在四周露出来。
 *
 * 明度阶梯（**卡内凹槽必须比卡面暗**，否则亮色立绘跳不出来）：
 *   surface > card > slot      （header 介于 surface 与 card 之间）
 * 对比由"实底 + 硬边"给，不靠发光 —— 发光会把边缘糊掉 2~3px，而那正是清晰感的来源。
 */
export const BRIGHT = {
  scrim:   0x06121c,   // 底幕：**半透明**压暗（不是实黑），让深海透出来
  surface: 0xeef7fb,   // 面板底（近白的水青）
  header:  0xd8ecf6,   // 顶栏带
  card:    0xffffff,   // 卡面实底
  cardOff: 0xf2f7fa,   // 买不起的卡面（压一档，但仍亮）
  slot:    0xdceaf2,   // 立绘 / 图标位（**比卡面深**）
  lockHi:  0xfff3d9,   // 已锁定：琥珀浅底
  edge:    0x8fb9cd,   // 中性描边
  divider: 0xc2dbe7,   // 卡内分隔
  // 类型色（亮底上要压深才够对比 —— 直接拿霓虹色会在白底上"化开"）
  weapon:  0x0e8fb5,   // 器械
  mount:   0xc47a00,   // 挂载
  stat:    0x7048cf,   // 属性
  relic:   0x0e9b8e,   // 遗物
  // 主操作色（"继续"这种主按钮），比 weapon 再亮一档以便承载白字
  accent:     0x0fa8cf,
  accentEdge: 0x0b7a97,
} as const

/** 亮色弹窗的文字色（对应 `BRIGHT`） */
export const TXT_LIGHT = {
  main:   '#0d2b3a',   // 主文字（深藏青，12px 以下也清楚）
  dim:    '#43647a',   // 次要
  mute:   '#7d97a8',   // 禁用
  accent: '#0a7d9e',   // 强调（比 LIGHT.weapon 再深一档，用于数字）
  warn:   '#cd3f66',   // 买不起 / 危险
  good:   '#0e8f7a',   // 成功
  onAccent: '#ffffff', // 主按钮上的文字
} as const

export const FONT = "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
/** 等宽 numerals —— 数值跳动时整行不会左右抖动 */
export const MONO = "'DIN Alternate', 'Roboto Mono', ui-monospace, monospace"

/**
 * 霓虹文字的写法：
 *
 *   txt.setStroke('#04070d', Math.max(2, Math.round(size / 12)))
 *
 * core 描边保证锐利，深底描边保证在任何背景上都立得住。
 * **14px 以下的中文会糊成一团 —— 禁用，改用图标。**
 */
