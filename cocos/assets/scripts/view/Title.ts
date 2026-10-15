/**
 * 主界面 —— 赛博霓虹深海（移植 `web/src/scenes/TitleScene.ts` 的可见部分）。
 *
 * ---------------------------------------------------------------------------
 * 为什么不是"新建一个 Cocos 场景"，而是同一个场景里的一个类
 * ---------------------------------------------------------------------------
 * web 侧 TitleScene 是独立 Scene，理由是"主界面有持续动画的背景，塞进主 Scene
 * 会让这套动画整局常驻吃 CPU"。
 *
 * Cocos 侧这里选了另一条路：**做成与 `Hud` 同构的"纯类 + 自建节点树"**，
 * 挂在同一个场景里，靠 `setVisible()` 开关。理由是 Cocos 的 `director.loadScene()`
 * 要求目标场景在构建列表里，而"编辑器里点 ▶ 跑的是当前打开的那个场景"——
 * 加第二个 `.scene` 会把已经做好的「打开工程点运行」变成"你得先知道要打开哪个场景"。
 * 而 Title 只是个静态菜单，`root.active = false` 之后就真的不参与渲染与更新，
 * 省 CPU 的目的照样达到。
 *
 * 代价：主界面与战斗的 `update` 由同一个组件分派（见 `DiveGame.update` 里的
 * `if (!this.started)` 分支），两者不会同时跑。
 *
 * ---------------------------------------------------------------------------
 * 视觉参照（版式见 `docs/主界面版式_V6.38.md`）
 * ---------------------------------------------------------------------------
 * 近黑蓝的整体底色 → 一艘小潜航器悬在中上，**探照灯锥向下劈开黑暗**（画面唯一光源）
 * → 陡峭的深渊峡谷岩壁，只用霓虹轮廓线表达 → 几只自发光水母（色相刻意避开 UI 青蓝，
 * 否则玩家会把它读成 HUD 元素）→ 全屏扫描线 / 舱窗网格（α ≤ .06，只做暗示）。
 *
 * **前景是 §9.2 的五分区**：顶栏（档案 / 货币 / 设置·帮助）+ 左右分类栏（人数自适应）
 * + 中央区（标题 / **船坞待机动画**）+ **右下角「开始游戏」** + 底栏。
 *
 * V6.41 起中央区不再是"机体选择器"：选艇与选开局武器都移进了「出击准备」面板
 * （点「开始游戏」/ 按 Enter 之后才出现），中央腾出来做船坞待机动画 —— 闸门 +
 * 悬浮的潜航器 + 摆动的机械臂 + 上升气泡 + 掠过的鱼 + 声呐环。
 *
 * ---------------------------------------------------------------------------
 * 素材分工：**静态装饰切图、动态数值留矢量**
 * ---------------------------------------------------------------------------
 * 位图只有两类：① 潜航器机体立绘（战斗内同一张贴图）② 6 个功能入口图标
 * （`ui/icons/`，512×512、单色可染，见 `shared/uiArt.ts`）。
 * 其余（顶栏底 / 槽位底 / 主按钮 / 货币菱形 / 指示点 / 箭头 / 标题）**仍是运行时
 * 几何绘制** —— 它们是连续变化的动态层或纯装饰，切图反而要处理多分辨率对齐。
 *
 * **图标四态靠 `sprite.color` 乘色得到**（`shared/menu.ts` 的 `ICON_TINT`），
 * 所以每个图标只有一张图，不是每态一张。⚠️ 乘法只能压暗不能提亮。
 *
 * ---------------------------------------------------------------------------
 * 四个注入 Cocos 后才会暴露的坑（前三个与已有的 Hud.ts 同源）
 * ---------------------------------------------------------------------------
 * ① **layer 必须显式继承**：运行时 `new Node()` 的 layer 是 DEFAULT，而 Canvas 的
 *    UI 相机只渲染 UI_2D —— 漏一处就是"画面上什么都没有"。统一走 `mk()`。
 *
 * ② **Label 的锚点要跟着对齐方式走**：`overflow=NONE` 下 Label 的内容尺寸自适应
 *    文本，锚点 (0.5,0.5) 意味着"文本中心落在节点位置"，于是右对齐的数字右边缘
 *    会随位数漂移。锚点设 0 / 0.5 / 1 才是真贴边。见 `put()`。
 *
 * ③ **椭圆参数语义与 Phaser 反了**：Phaser `fillEllipse` 收直径，Cocos
 *    `ellipse(cx,cy,rx,ry)` 收半径。凡是照搬 web 数值的地方都要 ÷2 ——
 *    漏了不会报错，只会"光晕整整大一倍"，属于最难查的那类。
 *
 * ④ **静态图形只画一次，动画靠节点属性**：探照灯的摇曳改 `UIOpacity.opacity` +
 *    节点 x，扫描线整层平移，水母整体位移 —— 都不重画几何。标题界面在菜单上
 *    会停留很久，每帧重画几百条线是纯浪费。
 *
 * ---------------------------------------------------------------------------
 * 与 web 的一处刻意不同：字体
 * ---------------------------------------------------------------------------
 * web 用 `'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif` 三档回退。
 * Cocos 侧**先不设 `fontFamily`**（用引擎默认系统字体）：多字体回退列表是 CSS 的
 * 语义，在原生平台上不保证等价，而"字体没生效"是那种看不出来但一直不对的问题。
 * 现有 `Hud.ts` 也走默认字体，两边保持一致；等接入字体资源后再统一。
 */

import {
  Node, Label, Graphics, Sprite, UITransform, UIOpacity,
} from 'cc'
import { Gfx, col } from './Gfx'
// 字号阶梯（V6.74）：**一套阶梯只定义一次**，主界面与战斗 HUD 共用。
// ⚠️ Title 不反向被 Hud 引用 ⇒ `Hud → Title` 无环，这个方向的 import 是安全的。
import { FS } from './Hud'
import {
  neon, neonLine, neonCircle, neonPoly, verticalBands, glowPool, lightCone,
} from './neon'
import { SpriteBank } from './art'
import { UI, TXT, MENU, GLASS, TXT_LIGHT, BUILD_TAG } from '../shared/theme'
import { SUBS, SUB_ART_R } from '../shared/subs'
import type { SubDef, SubId } from '../shared/subs'
import { unlocksByKind, isUnlocked, PERKS } from '../shared/dive/unlocks'
import type { PerkId } from '../shared/dive/unlocks'
import {
  entriesOf, columnBlocks, columnX, MENU_CENTER_Y, ICON_TINT,
  menuHeaderLabel, formatThousands,
} from '../shared/menu'
import type { MenuEntry } from '../shared/menu'
import type { UiIconId } from '../shared/uiArt'
// 出击准备的**开局武器候选**（V6.41）。清单只有一份，在 shared 里 —— 见 loadout.ts 头注。
import { START_WEAPONS, startWeaponIndex } from '../shared/dive/loadout'
// 武器文案（名称 / 说明）取自模拟层的 `WEAPON_DEF`，**不在这里抄第二份**
//
// `SEAT_ANGLES_DEG` 同时用作中央潜航器**六个姿态推进器口**的角位 —— 主界面的机械结构
// 于是和战斗内的座位是同一套语汇，玩家进局后能认出"这就是刚才转的那圈口"。
// ⚠️ 必须从 shared 引，不在视图层抄第二份。
import { WEAPON_DEF, SEAT_ANGLES_DEG } from '../shared/dive/tables'
import type { WeaponId } from '../shared/dive/types'
import type { MetaSource } from './Codex'

// ---------------------------------------------------------------------------
// §3.1 顶栏（常驻记账条）
// ---------------------------------------------------------------------------
const BAR_H = 72
const BAR_PAD = 32
const AVATAR = 40
/** 顶栏工具按钮：视觉 40×40，点击区 48×48（§3.1 / §6 —— 视觉与点击区分离） */
const TOP_BTN_VIS = 40
const TOP_BTN_HIT = 48
const TOP_BTN_Y = 12
/** 相邻两个工具按钮的间距 */
const TOP_BTN_GAP = 8

// ---------------------------------------------------------------------------
// §3.3 中央区：下潜中的潜航器（V6.42）
// ---------------------------------------------------------------------------
// 演化：V6.38「主形象框 + 箭头 + 指示点」→ V6.41「船坞待机」→ V6.42「下潜舱体」
//      → **V6.43「下潜 → 排水 → 上浮」**。
//
// 前三版被否的三条根因（用户原话：「这个中间的没啥用意义吧」「不是平面的」
// 「下潜到底部很突兀的回到上方」）：
//   ① 立绘 `sub_*.png` 本身是**俯视圆盘** ⇒ 放进方框里飘 = "一个孔里飘着一张盘"；
//   ② 闸门 / 机械臂只是造型，机构又全是 **2px 线条** ⇒ 读作"线稿示意图"，不是实物；
//   ③ "沉到底淡出、再从顶部淡入"**没有解释位移**，只是把瞬移藏起来了。
//
// V6.42 的三条硬要求：**真的下潜** + **有体积的实体** + **不留探照锥**。
//   · 下潜：舱体在竖向水体柱里匀速下沉，**全程可见**，到底吹除压载后再上浮回顶部；
//   · 立体：按项目既定的**四条体积线索**逐条落（投影 → 侧壁 → 受光弧 → 暗弧），
//     光源固定在**世界坐标左上**；
//   · 光源层 `dLight` **永不旋转** —— 受光弧/暗弧若跟着装甲环转，会读成
//     "贴纸在打折"（`cocos/README.md` 已知坑表里有这条）。
//
// ⚠️ 中央区 y 已被"标题 176 / 副标题 236 / 装饰线 272"占掉上半屏 ⇒ 柱顶取 284。
// ⚠️ V6.43：柱高从 328 加到 **368**（柱底 612 → 652）。原因是"沉底淡出"这个动作
//    被删掉了 —— 机体现在全程可见，于是暴露出 V6.42 一直存在的越界：
//    `DIVE_Y1 = 600` 时艇心 600 + 外壳 90 = 690，**超出柱底 78px**，
//    艇有一半停在柱子外面。当时淡出把它藏住了（看不清 = 不是问题），
//    现在必须让它在柱内 —— 柱是取景框（鱼群与气泡都不超出它，机体也不能）。
//    柱底 652 与底栏（706）留 54px，且**水平不相交**（柱 x 504–800，底栏文字居中
//    ≈ 502–802 但 y 相距 54px，字高 14 占 699–713，不重叠）。
/** 水体柱：宽 / 高 / 左上角（设计 1304×749）。296 与 368 都是 8 的倍数 */
const SHAFT_W = 296
const SHAFT_H = 368
const SHAFT_X0 = 504
const SHAFT_Y0 = 284
const SHAFT_CX = SHAFT_X0 + SHAFT_W / 2
/**
 * 下潜行程 380 → 556（行程 **176px**）。
 *
 * ⚠️ 起点 380 是**舱体外壳完全进柱**的最低位置（柱顶 284 + 外壳半径 90 = 374，
 *    取 380 留 6px 余量）。再往上抬，入水时机体会压到标题装饰线（272）。
 * ⚠️ 终点 556 + 半径 90 = 646，距柱底 652 还剩 6px ⇒ **艇始终整个在柱内**。
 *    这是"全程可见"带来的硬约束：柱就是取景框，半个艇挂在框外读作"掉出去了"。
 */
const DIVE_Y0 = 380
const DIVE_Y1 = 556
/**
 * 一个**完整循环** = 顶部待机 → 下潜 → 底部吹除压载 → 上浮 → 回到顶部（14.4s）。
 *
 * ⚠️ **没有"沉底淡出再瞬移回顶部"这件事**。V6.42 第一版是"到底淡出、顶部淡入"，
 *    用户判为"很突兀地回到上方" —— 淡入淡出并没有解释位移，只是把瞬移藏起来了。
 *    现在机体**全程可见**，用一段真实的上升把位移走完：看得到它是自己浮上来的。
 *
 * | 段 | 时长 | 位移 | 速度 | 气泡 | 推进器 |
 * |---|---|---|---|---|---|
 * | 顶部待机 | 1.0s | 不动 | — | 艉部零星 | 怠速 |
 * | 下潜 | 6.4s | 380 → 556 **线性** | 27.5px/s 恒定 | 艉部尾迹 | 微推 |
 * | 吹除压载 | 1.4s | 不动 | — | **艇下两侧密集排气** ← 动力来源 | 0 → 全开 |
 * | 上浮 | 5.6s | 556 → 380 **smoothstep** | 峰值 47px/s | 排气持续、逐渐稀疏 | 全开 → 缓 |
 *
 * ⚠️ 上浮用 smoothstep、下潜用线性，**不是**为了好看：这样上浮的峰值速度是下潜的
 *    **1.7 倍**（平均 31 vs 28，但中段 47 vs 28），"被浮力推着跑"和"匀速受控下沉"
 *    才是两种读感。两者都用线性，加速度为零 ⇒ 上浮读成"倒放的下潜"。
 * ⚠️ 上浮比下潜短 0.8s 也是故意的：**回程比去程快**才读作"有余力"。
 */
const T_TOP = 1.0
const T_DOWN = 6.4
const T_BOT = 1.4
const T_UP = 5.6
const DIVE_T = T_TOP + T_DOWN + T_BOT + T_UP
/** 下潜段 / 吹除段结束的绝对时刻（s），供 `stepDiver` 分段用 */
const T_DOWN_END = T_TOP + T_DOWN
const T_BOT_END = T_DOWN_END + T_BOT
/** 入场淡入时长（s）。**只作用于最开始那一次** —— 之后机体常驻可见，不再淡入淡出 */
const ENTER_T = 0.9
/** 俯仰摆幅（度）/ 周期（s）。刻意与 `DIVE_T` **非整数比**，否则会周期性重新同步 */
const TILT_A = 3
const TILT_T = 5.5
/**
 * 舱体外壳半径 / 厚度（侧壁下移量）/ 投影偏移（右下）。
 *
 * ⚠️ 投影偏移**必须小**（9/8 而不是 18/14）：偏到 18 会读成"后面还叠着另一个圆"，
 *    偏 9 才读作"这台机器微微浮着"。水下阴影本来就是弥散的，不是硬轮廓 ——
 *    而且 `Graphics` 画不出模糊，偏移越大越像硬邦邦的两个圆。
 */
const HULL_R = 90
const HULL_DEPTH = 14
const SHADOW_DX = 9
const SHADOW_DY = 8
/**
 * 左右**稳定鳍**：根部极角 / 尖端极角 / 根部半径 / 尖端半径。
 *
 * 它存在的唯一理由：**让整体轮廓不再是圆**。纯圆 + 同心环 = "一块表盘"；
 * 加了两片鳍，第一眼才读作"一台机械"。
 *
 * ⚠️ 角度一律按**右鳍**写（0° = 正右，标准数学角、y 向上），左鳍靠 `x` 取反镜像。
 *    别反过来写"左鳍的角度再镜像" —— `cos(172°)` 本身已经是负的，再乘 −1 会
 *    跑到右边去，两片鳍会叠在同一侧，而且**编译和静态检查都不会报错**（踩过）。
 *
 * ⚠️ 根部 r 58 = 立绘边缘，尖端伸到 132 ⇒ 装甲环带（75–90）会压掉根部，
 *    露出约 42px 的真翼。伸到 106 只能露 16px，读作"两个小刺"而不是"鳍"。
 */
const FIN_ROOT_A = -40
const FIN_ROOT_B = 40
const FIN_TIP_A = -8
const FIN_TIP_B = 8
const FIN_R0 = 58
const FIN_R1 = 132
/**
 * 舱体的**半径层级**（从圆心往外）—— 这套数字是**排队排出来的**，不是随手取的。
 * 任意相邻两层之间必须留 ≥1px 空隙，否则两层会糊成一块：
 *
 * ```
 *   0 – 58    潜航器立绘（`HERO_DISC / 2`）
 *  62.5– 73.5 六个姿态推进器口（中线 `THRUST_R` = 68，凹槽半径 5.5）
 *  74         壳接缝线（1px）
 *  75 – 81    内装甲环带（中线 `RING_B_R` = 78，带宽 6）
 *  82 – 90    外装甲环带（中线 `RING_A_R` = 86，带宽 8）—— 外缘**正好贴到** `HULL_R`
 *  90         外壳边缘 + 外缘描边
 * ```
 *
 * ⚠️ 上一版把外环带放在 r 84–92：**比外壳（90）还大**，环带会悬空在壳外；
 *    推进器口又正好压在立绘边缘（都是 66）。单个常量看不出问题，排成表才暴露 ——
 *    所以这张表比那几个数字本身重要。
 */
const RING_A_R = 86
const RING_A_W = 8
const RING_A_SEG = 19
const RING_B_R = 78
const RING_B_W = 6
const RING_B_SEG = 14
/** 装甲环转速（度/秒）。外环顺时针、内环**逆时针** —— 单向只会读成"转盘" */
const RING_A_SPD = 360 / 44
const RING_B_SPD = -360 / 26
/** 姿态推进器：口所在半径 / 喷发周期（s）/ 单次时长 / 喷流外伸长 */
const THRUST_R = 68
const THRUST_T = 1.5
const THRUST_DUR = 0.55
const THRUST_LEN = 22
/** 核心穹顶：底盘半径 / 呼吸区间 / 呼吸周期（s） */
const CORE_R = 20
const CORE_A = 10
const CORE_B = 14
const CORE_T = 2.4
/** 扫描臂：内端 / 外端半径（外端收到立绘边缘 58 内侧）/ 转速（度每秒，6s 一圈） */
const SCAN_R0 = 24
const SCAN_R1 = 58
const SCAN_SPD = 360 / 6
/**
 * 声呐环：扩散周期（s）/ 最大半径 / 一次几圈。
 *
 * ⚠️ `RY = RMAX × 0.43` ⇒ 竖向 ±64.5px。舱体在柱顶（380）时上缘 315.5、柱底（556）时
 *    下缘 620.5，**两端都在柱内（284–652）** —— V6.43 把行程收进柱内之后，声呐环
 *    也跟着不再溢出。横向 502–802 与柱沿（504–800）齐平，与左右分类栏不相交。
 */
const SONAR_PERIOD = 2.6
const SONAR_RMAX = 150
const SONAR_RINGS = 2
/** 气泡：同时在场个数上限 / 上浮速度区间（px/s）/ 寿命（s） */
const BUBBLE_N = 44
const BUBBLE_V0 = 26
const BUBBLE_V1 = 52
const BUBBLE_LIFE = 2.4
/**
 * 两种出生模式各自的**间隔**（s）：越密 = 单位时间排出的气越多 = 看着越有推力。
 *
 * | 模式 | 段 | 间隔 | 每秒个数 | 稳态在场 |
 * |---|---|---|---|---|
 * | `cruise` 艉部零星 | 顶部待机 | 0.30 | 3.3 | ~8 |
 * | `stern` 艉部尾迹 | 下潜 | 0.18 | 5.6 | ~13 |
 * | `vent` 两侧排气 | 吹除压载 | **0.07** | **14** | ~34 |
 * | `vent` 两侧排气 | 上浮 | 0.09 | 11 | ~26 |
 *
 * ⚠️ `vent` 的 0.07 是关键数字，也是 `BUBBLE_N` 必须放到 44 的原因：
 *    稳态在场数 = 每秒个数 × 寿命（2.4s）。按老的 `BUBBLE_N = 26`，排气段会被上限
 *    砍掉 8 个 ⇒ 视觉密度只有设计值的三分之二，"被气泡托上去"读不出来。
 * ⚠️ 也不要把 `cruise` / `stern` 调密：那两个段是"它在动"的暗示，密了就变成
 *    "一直在漏气"，反而稀释了吹除段的爆发感 —— **对比**才是这段的意义。
 */
const BUBBLE_DT_CRUISE = 0.30
const BUBBLE_DT_STERN = 0.18
const BUBBLE_DT_VENT_BLOW = 0.07
const BUBBLE_DT_VENT_UP = 0.09
/**
 * 排气口位置（相对艇心）：横向随机在一侧 76–104，纵向 **+72**（下方偏侧）。
 *
 * 这个位置要同时过**三关**，少一关都不行：
 *
 * | 关 | 条件 | 为什么 |
 * |---|---|---|
 * | ① 出壳 | `√(dx² + dy²) > 外壳 90` | 出生就在艇体轮廓外。`tBubble` 层排在舱体**之下**，壳内的气泡一出生就被艇压住，等于没排 |
 * | ② 不越柱底 | `DIVE_Y1 + dy < 柱底 652` | 艇沉到底时排气口 556 + 72 = 628 < 652 ✓。旧的 `dy = 96` 会到 **652 = 柱底** ⇒ 排气口正好挂在框沿上，一半气泡生在框外 |
 * | ③ 不被艇身挡 | 上升途中横向已张开到壳外 | `dx ≥ 76` 时，爬到艇心高度前横向已散到 ≈90 ⇒ 擦着外壳过去，能看到 |
 *
 * ⚠️ 取 (76, 72) 而不是 (0, 96)（正下方）也是**几何**决定的：正下方要伸到 96 才出壳，
 *    而 96 会让 ② 失败。斜下 45°–80° 这一圈是唯一同时满足三条的解。
 * ⚠️ dx 上界 104 是**柱宽减去横向扩散量**反推的：气泡还要向外侧飘约 33px
 *    （见 `VENT_VX` / `VENT_DECAY`），104 + 33 + 半径 3 = 140 < 柱半宽 148。
 *    再大会飘出水体柱，气泡会跑到背景上，读作"柱子裂了"。
 */
const VENT_DX0 = 76
const VENT_DX1 = 104
const VENT_DY = 72
/**
 * 排气气泡的**绝对**上浮速度区间（px/s）。
 *
 * ⚠️ 这一条是"动力感"成不成的**主开关**，比气泡数量的权重大得多。
 *    排气口是跟着艇走的，气泡若只比艇快一点（旧值 26–52 × 1.45 = 38–75，
 *    而艇的峰值上升速度是 47），两者相对速度只有 0–28px/s ⇒ **气泡几乎粘在艇上**，
 *    读起来是一团气泡陪着艇漂，不是"一股气把它顶上去"。
 *
 * | | 速度 | 相对艇（艇峰值 47） | 读感 |
 * |---|---|---|---|
 * | 旧 | 38–75 | 0–28px/s | 气泡跟着艇走（❌ 本轮要修的） |
 * | 新 | **95–150** | **48–103px/s** | 气泡冲过艇身、越过艇继续往上 —— 气流有方向、有余量 |
 *
 * ⚠️ 也别一味拉高：超过 ~180 会让气泡在 2.4s 内飞完 400px+，整条柱被拉稀，
 *    从"两股气流"退化成"几颗零星气泡"。95–150 × 寿命 2.4s = 上升 228–360px，
 *    正好是"从排气口一路冲到柱顶"的距离。
 */
const VENT_V0 = 95
const VENT_V1 = 150
/** 排气气泡的横向初速（px/s），向**外侧** —— 两股气流各自张开，不是两条平行线 */
const VENT_VX = 40
/**
 * 横向初速的指数衰减率（1/s）。
 *
 * ⚠️ 必须衰减：持续横漂会把气泡推出柱壁（见 `VENT_DX1` 注释）。
 *    衰减率 1.2 ⇒ 横向总位移 ≈ `VENT_VX / VENT_DECAY` ≈ 33px —— 张开感有了，
 *    后半程又转回笔直上升，读作"气泡脱离排气口后跟着水流走"。
 */
const VENT_DECAY = 1.2
/**
 * 中央潜航器的**圆盘直径**（不是贴图尺寸 —— 见 subs.ts 的 SUB_ART_R 说明）。
 *
 * 116 = 半径 58，比战斗内的 `SUB_D`（88）大 32% —— 主界面是"展示位"，该大一号；
 * 但**不能更大**，否则机构区（58–90）被挤没，舱体又变回"一张立绘"。
 */
const HERO_DISC = 116
/** 「出击准备」卡里缩略立绘的圆盘直径。卡片只有 132 高，比中央小一号 */
const SUB_DISC_CARD = 78

// ---------------------------------------------------------------------------
// §3.5 右下角主操作（V6.41）
// ---------------------------------------------------------------------------
// 主界面**只剩一个动作**：右下角「开始游戏」。
// 原版是居中 340×68 的「开始下潜」—— 那是"唯一动作"时代的版式（§3.3）；
// 现在主界面是 hub，居中那块归船坞动画，动作收到右下角。
const START_W = 236
const START_H = 62
/** 距右边距（与 `BAR_PAD` 同为 32，与顶栏右缘对齐） */
const START_PAD_R = 32
/** 按钮中心 y。上要离开右侧栏末标签（540），下要给底栏（706）留位 */
const START_CY = 640
/** 底栏 y（V6.41 从 664 下移到 706 —— 给右下角按钮让位） */
const FOOTER_Y = 706

/** 扫描线一个循环的高度（web 是 `4 * ceil(H/4) + 8`） */
const scanSpan = (H: number) => 4 * Math.ceil(H / 4) + 8

/**
 * **局部圆弧**（只推路径，不 stroke）—— 给舱体这类子节点内部用。
 *
 * 坐标 = 节点局部（**y 向上**），角度 = **标准数学角**（0° = +x、逆时针为正）。
 *
 * ⚠️ 为什么不复用 `Gfx.arc()`：它内部走 `Gfx.y(v) = H - v`，子节点里传 `H = 0`
 *    会把几何**上下镜像**。对称结构看不出来，但"受光弧在左上 / 暗弧在右下"这种
 *    依赖绝对方向的几何一翻，光源就跑到脚底下去了。
 *
 * 采样密度同 `Gfx.arc()`（每 π 分 24 段）—— 半径 90 上相邻两点弦长约 11px，
 * 描边 5px 时看不出折角。
 */
function larc(g: Gfx, cx: number, cy: number, r: number, a0: number, a1: number): void {
  const sweep = a1 - a0
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)))
  g.g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r)
  for (let i = 1; i <= n; i++) {
    const a = a0 + sweep * (i / n)
    g.g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
}

type Align = 'left' | 'center' | 'right'

interface Btn {
  gfx: Gfx
  label: Label
  w: number
  h: number
  primary: boolean
  hover: boolean
  onTap: () => void
}

/** sim 坐标（左上角 + 宽高）的矩形。面板里的卡片 / 按钮都用它传递，避免二十个裸参数。 */
interface Rect { x: number; y: number; w: number; h: number }

/**
 * 一个功能入口（左/右分类栏里的一块）。
 *
 * `e` 是 `shared/menu.ts` 的那条数据 —— **位置全部由它推导**（`side` 分组、
 * `slot` 排序、`columnBlocks()` 算 y），本结构只缓存"算完的结果 + 视图节点"。
 */
interface Entry {
  e: MenuEntry
  art: Sprite
  label: Label
  hit: Node
  /** 槽位底左上角（sim） */
  x: number
  y: number
  /** 块边长（正方形） */
  size: number
  hover: boolean
  press: boolean
}

/** 顶栏工具按钮（设置 / 帮助）。`icon` 为空时不加载贴图。 */
interface ToolBtn {
  e: MenuEntry
  art: Sprite
}

interface Jelly { node: Node; vy: number; sway: number; t: number }
interface Mote { x: number; y: number; r: number; vy: number }
/**
 * 舱体放出的气泡（V6.43）。两种来源，靠 `vx` 是否为 0 区分：
 *
 * | 来源 | 出生点 | 初速 | 语义 |
 * |---|---|---|---|
 * | 艉部尾迹 | 艇心上方 70px（在艇壳内酝酿一段才可见） | 竖直向上 | "它在动" |
 * | 两侧排气 | 艇下 ±64–132、下方 96px | 向上 + **向外侧散** | "它在往外排水，所以浮起来了" |
 *
 * 与 V6.41 的差别是它带 `life`：气泡脱舱后要**淡出消失**（而不是一直浮到柱顶），
 * 否则二十几个气泡会连成两条竖直白线，读作"漏水"而不是"气流"。
 */
interface Bubble {
  x: number
  y: number
  r: number
  /** 竖直上浮速度（px/s，正值向上） */
  v: number
  /** 横向初速（px/s）。**两侧排气才有**，向外侧 —— 让气流张开而不是两条平行线 */
  vx: number
  /** 左右摆动相位（让每个气泡的蛇行不同步） */
  ph: number
  life: number
}

export class Title {
  private readonly root: Node
  /**
   * 背景整图（V6.40）。**排在节点树最底**（第一个建 = 最下层）。
   *
   * 为什么主界面要用整图而不是继续加矢量装饰：概念图里的"深海元素"
   * （岩壁实体 / 珊瑚 / 沉船金属件 / 水母群）是**笔触与材质**，`Graphics` 画不出来 ——
   * 它没有渐变边缘、没有噪声纹理、没有半透明叠加。矢量这条路的天花板就是"霓虹线稿"。
   * 所以整图铺底，矢量层退居**缺图兜底**（见 `syncBgArt()`）。
   */
  private bgArt: Sprite | null = null
  private bgKey = ''
  private readonly gBack: Gfx
  private readonly gCanyon: Gfx
  private readonly gCone: Gfx
  private readonly coneNode: Node
  private readonly coneOpacity: UIOpacity
  private readonly gGrid: Gfx
  private readonly gScan: Gfx
  private readonly scanNode: Node
  private readonly gMotes: Gfx
  private readonly gDeco: Gfx
  /** 顶栏底（只画一次，不参与悬停重绘） */
  private readonly gTop: Gfx
  /** 所有入口槽位底。悬停 / 按下时整体重绘（6 块，代价可忽略） */
  private readonly gSlots: Gfx
  // ---- 中央舞台：下潜中的潜航器（V6.42）----
  /** 竖向水体柱（柱体 + 水面线）。**静态几何**，只画一次 */
  private readonly gStage: Gfx
  /**
   * 尾迹气泡层（每帧重绘 `BUBBLE_N` 个圆）。
   *
   * ⚠️ 刻意挂在 `root` 下走**世界坐标**、不给 `diver` 当子节点：气泡脱舱之后要
   * **留在水里继续上浮**，跟着机体走就成了"贴在图上的六个点"。
   */
  private readonly gBubble: Gfx
  /**
   * 舱体组。**"下潜"= 平移这一个节点。**
   *
   * 投影 / 外壳 / 立绘 / 装甲环 / 核心 / 喷流 / 声呐 / 光源 / 扫描臂全是它的子节点，
   * 于是每帧只要一行 `setPosition`，整台机械一起沉 —— 不需要逐个零件算坐标。
   * 淡入淡出则挂在它的 `UIOpacity` 上（一次性作用于整组）。
   */
  // ⚠️ 下面这批不加 `readonly`：它们由 `buildDiver()` 统一建好再赋值 ——
  //    TS 的只读属性只允许在**构造函数体内直接赋值**，方法里赋值会编译报错。
  //    代价是失去编译期保护，换来的是建造逻辑能聚在一个方法里。
  private diver!: Node
  /**
   * 舱体**每个零件各自**的 `UIOpacity`。
   *
   * ⚠️ 为什么不能只给 `diver` 挂一个 `UIOpacity`：Cocos 的 `UIOpacity` 只作用于
   *    **节点自身**的渲染组件，**不会向下传播到子节点**。挂在父节点上写 opacity
   *    是静默失效 —— 不报错、零件照常全亮，只有"淡入淡出没生效"这一个症状。
   *    所以每个带 `Graphics` / `Sprite` 的零件各挂一个，淡入淡出时统一写这一组。
   */
  private diverOps: UIOpacity[] = []
  /** 舱体外壳：投影 + 侧壁 + 主盘 + 推进器凹槽（静态，圆心 = 局部原点） */
  private gHull!: Gfx
  /** 外 / 内装甲环。几何静态，靠 `node.angle` **反向**旋转 */
  private ringA!: Gfx
  private ringB!: Gfx
  /** 核心穹顶（几何静态，靠 `setScale` 呼吸） */
  private core!: Gfx
  /** 推进器喷流（每帧重绘 6 段） */
  private gThrust!: Gfx
  /** 声呐环（每帧重绘）。挂在 `diver` 下 ⇒ 波前从机体**当前**位置发出 */
  private gSonar!: Gfx
  /**
   * 光源层：受光弧 + 暗弧 + 外缘描边。
   *
   * ⚠️ **永不旋转** —— 光源在世界坐标（左上）。若让受光弧跟着装甲环转，
   * 玩家会读成"贴纸在打折"（`cocos/README.md` 已知坑表第一条）。
   */
  private gLight!: Gfx
  /** 扫描臂（几何朝 +x 画一次，靠 `node.angle` 转） */
  private scanArm!: Gfx
  /** 尾迹气泡状态（每帧步进，出柱顶后回到艉部重新出生） */
  private bubbles: Bubble[] = []
  /** 气泡出生计时（s）。按当前阶段的间隔累加到头就放一个，而不是开局一次性撒满 */
  private bubbleT = 0

  private readonly labels: Label[] = []
  private readonly jellies: Jelly[] = []
  private readonly motes: Mote[] = []
  private readonly btns: Btn[] = []
  /** 左右分类栏的入口（含标签与热区） */
  private readonly entries: Entry[] = []
  /** 顶栏工具按钮 */
  private readonly tools: ToolBtn[] = []

  /**
   * 船坞里悬浮的潜航器立绘。
   *
   * V6.41 起**只负责中央动画**：名称 / 特性行 / 切换箭头 / 指示点已随
   * 「出击准备」面板搬走，所以这里不再有配套的 `heroName` / `heroFeat`。
   */
  private heroArt: Sprite | null = null
  /** 已经实际挂上的立绘贴图 key —— 避免每帧重设 `spriteFrame` */
  private heroKey = ''
  /** 简易 toast（点了未实装的入口时给反馈，**不静默**） */
  private toastLabel: Label | null = null
  private toastT = 0

  private sel = 0
  private t = 0
  private padW = 8
  private padH = 8
  private viewW = 0
  private viewH = 0
  private footer = ''
  private footerLabel: Label | null = null
  private recordsLabel: Label | null = null
  /** 沉淀生物质钱包（顶部右侧）。数值由 `refreshWallet()` 写 */
  private walletLabel: Label | null = null
  private walletIcon: Gfx | null = null
  /** 装置坞（解锁屏）。开着的时候卡片与按钮不响应 —— 否则"点一下关闭"会顺手把选项也换了 */
  private modal: Node | null = null

  // ---- 装置坞 ----
  private gDock: Gfx | null = null
  private dockText: Node | null = null
  private dockHit: Node | null = null
  private dockTab = 0
  /** 装置坞四类（与 `unlocks.ts` 的 UnlockKind + perk 对应） */
  private static readonly DOCK_TABS = ['潜航器', '武器', '遗物', '强化']

  // ---- 出击准备（V6.41）----
  /** 面板根节点。**它也是 `modal` 的判据**（`confirm()` 靠它区分"开面板"与"确认出击"） */
  private loadRoot: Node | null = null
  private gLoad: Gfx | null = null
  private loadText: Node | null = null
  /** 卡片立绘（异步挂上，见 `syncLoadArt()`） */
  private loadSubArt: Sprite[] = []
  private loadWpnArt: Sprite[] = []
  /**
   * 卡片容器。立绘**只建一次**再挂进来（选中态只改 color / 重绘 Gfx，不重建节点），
   * 所以它必须活过 `drawLoadout()` 的多次调用 —— 而 `loadText` 是每次重建的。
   */
  private loadCards: Node | null = null
  /** 悬停中的底部按钮（`'back' | 'go'`），用于画出 hover 高亮；离开时置 null */
  private loadHover: 'back' | 'go' | null = null
  /**
   * 面板里键盘焦点的行（↑↓ 切换）。两行都是横排，所以"左右"只能在**聚焦行内**循环 ——
   * 没有这个字段的话 ← → 就只能改潜航器，武器行永远只能靠鼠标点。
   */
  private loadFocus: 'sub' | 'wpn' = 'sub'
  /**
   * 选中的武器下标（`START_WEAPONS` 的下标）。潜航器沿用 `sel`。
   *
   * 初值取 `startWeaponIndex(undefined)` = **机关枪**（原版一直用的开局武器）——
   * 不是列表第一项。改成声呐会静默改掉所有老玩家的第一局手感。
   */
  private wsel = startWeaponIndex(undefined)

  constructor(
    private readonly canvas: Node,
    private readonly W: number,
    private readonly H: number,
    private readonly art: SpriteBank,
    private readonly cb: {
      /** 确认出击。**两个参数都来自「出击准备」面板**（V6.41 起开局武器可选） */
      onStart: (sub: SubId, weapon: WeaponId) => void
      /** 元系统只读快照（bio / 解锁 / 图鉴 / 强化等级） */
      getMeta: MetaSource
      /** 花 bio 买一项永久强化；返回是否买成（成不成由视图层定，见 DiveGame） */
      onBuyPerk: (id: PerkId) => boolean
      /** 打开图鉴屏（图鉴是独立类，由 DiveGame 持有） */
      onOpenCodex: () => void
    },
  ) {
    this.root = this.mk('Title', canvas)
    const ut = this.root.addComponent(UITransform)
    ut.setAnchorPoint(0, 0)
    ut.setContentSize(W, H)
    this.root.setPosition(-W / 2, -H / 2)

    // 顺序即绘制顺序（§9.2）。网格与扫描线**刻意排在 UI 之后**：它们做"隔着一层玻璃"
    // 的暗示，要连顶栏、标题、入口一起罩住（α ≤ .06，只做暗示）。
    //
    // V6.40：**背景整图必须第一个建**（=最下层）。它之下什么都不该有 ——
    // 建晚了就会盖住渐变、峡谷、水母，症状是"背景图把装饰全吃了"。
    const bgNode = this.mk('tBg', this.root)
    this.bgArt = bgNode.addComponent(Sprite)
    this.bgArt.trim = false
    this.bgArt.sizeMode = Sprite.SizeMode.CUSTOM
    bgNode.active = false                 // 贴图没到位时隐藏，让下面的矢量层顶上
    this.gBack = this.wrap('tBack')
    this.gCanyon = this.wrap('tCanyon')
    this.coneNode = this.mk('tCone', this.root)
    this.gCone = new Gfx(this.coneNode.addComponent(Graphics), H)
    this.coneOpacity = this.coneNode.addComponent(UIOpacity)
    this.gMotes = this.wrap('tMotes')
    this.gDeco = this.wrap('tDeco')
    this.buildJellies()
    // 中央舞台（V6.42）—— 它属于**场景**而不是 UI，所以整组必须建在 `tTop` 之前：
    // 水体柱 → 尾迹气泡 → 下潜舱体（声呐环挂在舱体内部，跟着机体走）。
    // 晚建的后果很具体：舱体下潜经过中央时，装甲环会**盖在左右分类栏的图标上**。
    //
    // ⚠️ 气泡层刻意排在舱体**之下**：气泡从艇身里冒出来，在艇内那一段本就该被挡住；
    //    浮出圆盘上缘之后自然可见。反过来（气泡在上层）会看到气泡盖在艇身上。
    this.gStage = this.wrap('tStage')
    this.gBubble = this.wrap('tBubble')
    this.buildDiver()
    this.drawShaft()
    // 顶栏底与槽位底：**必须晚于背景层**（否则水母会飘在槽位上面），
    // **必须早于其上的图标与标签**（节点顺序就是绘制顺序，晚建会把图标盖住）。
    this.gTop = this.wrap('tTop')
    this.gSlots = this.wrap('tSlots')
    this.buildTopBar()
    this.buildTitleText()
    this.buildEntrances()
    this.buildCta()
    this.buildFooter()
    this.gGrid = this.wrap('tGrid')
    this.scanNode = this.mk('tScan', this.root)
    this.gScan = new Gfx(this.scanNode.addComponent(Graphics), 0)

    this.layout(true)
    this.select(this.sel)
  }

  // -------------------------------------------------------------------------
  // 基础设施
  // -------------------------------------------------------------------------
  /** 建节点并**继承父节点 layer**（坑 ① 的唯一入口） */
  private mk(name: string, parent: Node): Node {
    const n = new Node(name)
    n.layer = parent.layer
    n.parent = parent
    return n
  }

  private wrap(name: string): Gfx {
    return new Gfx(this.mk(name, this.root).addComponent(Graphics), this.H)
  }

  /**
   * 在 `parent` 下建一个 Gfx —— **坐标是 parent 的局部坐标（y 向上为正）**，
   * 与顶层 `wrap()`（sim 语义、y 向下）正好相反。
   *
   * ⚠️ 角度也随之变回**标准数学角**（0° = +x、逆时针为正）—— `Gfx.arc()` 那套
   *    "顺时针"的 sim 语义在这里不适用，所以舱体内部一律走 `larc()`。
   *
   * ⚠️ 舱体内部**只用 `gfx.g` 走路径**：`Gfx` 的 `y()` 恒为 `H - v`，取任何 `H`
   *    都变不出恒等映射，于是 `fillCircle / arc` 这些便捷方法在子节点里会**多翻一次 y**。
   *    对称图形看不出问题，但"受光弧在左上"这种非对称几何会翻到右下。
   *    颜色仍走 `fill() / line()`（它们不碰坐标），路径走 `.g`。
   */
  private sub(parent: Node, name: string): Gfx {
    return new Gfx(this.mk(name, parent).addComponent(Graphics), 0)
  }

  /** 放一段文字。`(x,y)` 是**锚边**：left 给左边缘、right 给右边缘、center 给中心。 */
  private put(x: number, y: number, s: string, size: number, color: string, mode: Align): Label {
    const l = this.mk('t', this.root).addComponent(Label)
    l.string = s
    l.fontSize = size
    l.lineHeight = size + 2
    l.color = col(parseInt(color.slice(1), 16))
    l.verticalAlign = Label.VerticalAlign.CENTER
    l.horizontalAlign = mode === 'left' ? Label.HorizontalAlign.LEFT
      : mode === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER
    const ut = l.node.getComponent(UITransform)
    if (ut) ut.setAnchorPoint(mode === 'left' ? 0 : mode === 'right' ? 1 : 0.5, 0.5)
    l.node.setPosition(x, this.H - y)
    this.labels.push(l)
    return l
  }

  private text(x: number, y: number, s: string, size: number, color: string, right = false): Label {
    return this.put(x, y, s, size, color, right ? 'right' : 'left')
  }

  private center(x: number, y: number, s: string, size: number, color: string): Label {
    return this.put(x, y, s, size, color, 'center')
  }

  private opacityOf(n: Node): UIOpacity {
    return n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity)
  }

  // -------------------------------------------------------------------------
  // 铺满屏幕的静态层
  // -------------------------------------------------------------------------
  /**
   * 设计分辨率与实际画布宽高比不一致时，四周会露出清屏色的一条带 ——
   * 只在某些机型上出现，属于"上线后才被发现"的那类。所以按 Canvas 真实尺寸外扩。
   * 画布尺寸变化（首帧、拖窗口、改 DPR）时本函数会被再调一次。
   */
  private layout(force: boolean): void {
    const ut = this.canvas.getComponent(UITransform)
    const cw = ut ? ut.contentSize.width : 0
    const ch = ut ? ut.contentSize.height : 0
    if (!force && cw === this.viewW && ch === this.viewH) return
    this.viewW = cw
    this.viewH = ch
    this.padW = Math.max(0, ((cw > 0 ? cw : this.W) - this.W) / 2) + 8
    this.padH = Math.max(0, ((ch > 0 ? ch : this.H) - this.H) / 2) + 8
    this.drawBackdrop()
    this.drawCanyon()
    this.drawCone()
    this.drawScanlines()
    this.buildGrid()
    this.updateFooter()
    this.layoutBg()
  }

  /**
   * 背景整图按 **cover** 铺满（保比例、裁溢出）。
   *
   * 为什么不是 contain：contain 会在宽屏两侧留出清屏色条带 —— 那是"上线才被发现"的
   * 那类问题（本项目已经因为同一原因把所有铺满层外扩过一次，见 `layout()` 注释）。
   * 背景图宁可裁掉两侧一点岩壁，也不能露底。
   */
  private layoutBg(): void {
    const art = this.bgArt
    if (!art || !art.node.active) return
    const sf = art.spriteFrame
    if (!sf) return
    const iw = sf.originalSize.width
    const ih = sf.originalSize.height
    const ut = art.node.getComponent(UITransform) ?? art.node.addComponent(UITransform)
    ut.setContentSize(iw, ih)
    ut.setAnchorPoint(0.5, 0.5)
    const k = Math.max(this.viewW > 0 ? this.viewW / iw : this.W / iw,
      this.viewH > 0 ? this.viewH / ih : this.H / ih)
    art.node.setScale(k, k, 1)
    // ⚠️ root 的锚点是 (0,0) 且位于左下角（见构造函数）—— 所以"屏幕中心"是本地
    //    (W/2, H/2)，**不是 (0,0)**。写成 (0,0) 会让整图贴到左下角去。
    art.node.setPosition(this.W / 2, this.H / 2)
  }

  /**
   * 背景整图异步到达。
   *
   * 到位后**关掉矢量装饰层**（渐变 / 峡谷 / 探照灯 / 水母 / 浮游微粒）——
   * 整图里已经有这些东西了，再叠一层就是"两套岩壁错位"。
   * 扫描线 / 网格 / 四角框**留着**：那几层是"隔着舷窗"的暗示，与背景内容不冲突。
   */
  private syncBgArt(): void {
    const art = this.bgArt
    if (!art) return
    if (!this.art.has('title_bg')) return          // 没出图 → 矢量层照常，不影响启动
    if (art.node.active && this.bgKey === 'title_bg') return
    art.spriteFrame = this.art.get('title_bg')!
    art.node.active = true
    this.bgKey = 'title_bg'
    // 矢量装饰层退场（缺图时它们就是主角，所以只在挂上整图后关）
    this.gBack.g.node.active = false
    this.gCanyon.g.node.active = false
    this.coneNode.active = false
    this.gMotes.g.node.active = false
    this.gDeco.g.node.active = false
    for (const j of this.jellies) j.node.active = false
    this.layoutBg()
  }

  private drawBackdrop(): void {
    const x = -this.padW
    const y = -this.padH
    const w = this.W + this.padW * 2
    const h = this.H + this.padH * 2
    this.gBack.clear()
    // 不用渐变 API：56 条纯色横带模拟竖向渐变，密度足够就看不出台阶
    verticalBands(this.gBack, x, y, w, h, [
      [0.00, 0x071826],   // 顶部：远处的微光还将亮未亮
      [0.30, 0x0a2233],
      [0.58, 0x061019],   // 中：光开始被吞
      [1.00, 0x02050a],   // 底：纯粹的黑
    ], 56)
    // 中央柔和高光：多圈低透明椭圆叠加（单圈大圆会有明显边界）
    glowPool(this.gBack, this.W * 0.5, this.H * 0.26, this.W * 0.95, this.H * 0.62, UI.cyanDim, 7, 0.028)
    this.gBack.fill(UI.cyan, 0.05)
    this.gBack.ellipse(this.W * 0.5, this.H * 0.2, (this.W * 0.55) / 2, (this.H * 0.3) / 2)
    this.gBack.fillPath()
  }

  /**
   * 峡谷：两侧向内收拢的岩壁，**只有霓虹轮廓线**，内部用近黑填充挡住背景。
   * 轮廓越往下越暗（深渊里连岩石也不反光），这是深度感最省成本的做法。
   */
  private drawCanyon(): void {
    const W = this.W
    const H = this.H
    this.gCanyon.clear()

    const wall = (xFrom: number, dir: number, amp: number, seed: number) => {
      const pts: number[] = []
      const steps = 34
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        // 越往下越向画面中间侵入（人字形收拢）
        const inset = Math.pow(t, 1.35) * W * 0.26
        const jag = Math.sin(t * 9 + seed) * amp + Math.sin(t * 21 + seed * 2) * amp * 0.45
        pts.push(xFrom + dir * (inset + jag), t * H)
      }
      pts.push(xFrom + dir * W, H)   // 闭合到画布外侧
      pts.push(xFrom + dir * W, 0)
      neonPoly(this.gCanyon, pts, UI.rock, { fill: true, fillAlpha: 0.95, bloom: false })
      neonPoly(this.gCanyon, pts, UI.line, { width: 1.5, alpha: 0.85, bloom: false })
    }

    wall(0, 1, 26, 0.7)        // 左壁
    wall(W, -1, 30, 2.3)       // 右壁
  }

  /** 探照灯锥：画面唯一的"人造光源"，从上方潜航器位置向下劈出的宽光锥 */
  private drawCone(): void {
    this.gCone.clear()
    lightCone(this.gCone, this.W * 0.5, this.H * 0.10, this.H * 1.02,
      this.W * 0.05, this.W * 0.52, UI.cyanHi, 30, 0.085)
  }

  /** 舱窗网格 + 四角框（α 全部 ≤ .06：这一层是"隔着玻璃"的暗示，不是真网格） */
  private buildGrid(): void {
    this.gGrid.clear()
    const W = this.W
    const H = this.H
    this.gGrid.line(UI.cyanDim, 0.035, 1)
    for (let x = 0; x <= W; x += 64) this.gGrid.strokeSeg(x, 0, x, H)
    for (let y = 0; y <= H; y += 64) this.gGrid.strokeSeg(0, y, W, y)
    this.gGrid.line(UI.cyan, 0.10, 1)
    const m = 18
    const len = 46
    for (const [sx, sy, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      this.gGrid.strokeSeg(sx, sy, sx + dx * len, sy)
      this.gGrid.strokeSeg(sx, sy, sx, sy + dy * len)
    }
  }

  /**
   * 扫描线：**只建一次几何，之后整层平移**（每帧重画 380 条线纯属白扔 CPU）。
   *
   * 用 `new Gfx(g, 0)`：H=0 时 y 翻转退化为取负，于是这里可以按"屏幕坐标"直觉写，
   * 平移交给节点位置。**画到 `span` 那么高**是为了让"移上去再跳回"这个循环无缝 ——
   * 只画一屏高的话，跳回瞬间底部会空一截。
   */
  private drawScanlines(): void {
    this.gScan.clear()
    const span = scanSpan(this.H)
    const x0 = -this.padW
    const x1 = this.W + this.padW
    this.gScan.line(UI.cyan, 0.030, 1)
    for (let v = span + 8; v >= -(this.H + this.padH + 8); v -= 4) {
      this.gScan.strokeSeg(x0, v, x1, v)
    }
  }

  // -------------------------------------------------------------------------
  // 水母（几何签名：伞盖 + 白色内核 + 触须）
  // -------------------------------------------------------------------------
  /**
   * 色相刻意避开 UI 青蓝：jade / magenta / violet / amber 都可以，独独不能有青蓝，
   * 否则玩家会把它读成 HUD 元素（《UI规格》§2.3 色相隔离）。
   */
  private buildJellies(): void {
    const specs = [
      { x: 0.18, y: 0.60, s: 1.0, c: UI.violet },
      { x: 0.84, y: 0.48, s: 1.35, c: UI.magenta },
      { x: 0.64, y: 0.80, s: 0.78, c: UI.jade },
      { x: 0.33, y: 0.30, s: 0.66, c: UI.magenta },
      { x: 0.92, y: 0.22, s: 0.58, c: UI.jade },
    ]
    for (const sp of specs) {
      const n = this.mk('jelly', this.root)
      // H=0：内部按 web 的"y 向下"直觉写坐标，摆放交给节点位置
      const g = new Gfx(n.addComponent(Graphics), 0)
      this.drawJelly(g, sp.s, sp.c)
      this.opacityOf(n).opacity = Math.round(0.72 * 255)
      n.setPosition(this.W * sp.x, this.H - this.H * sp.y)
      this.jellies.push({ node: n, vy: -6 * sp.s, sway: 14 * sp.s, t: Math.random() * 6.28 })
    }
  }

  /**
   * 画一只水母 = 三段式：外发光多层 → 伞盖实体 → **白色内核**（清晰感的来源）→ 触须。
   *
   * ⚠️ 所有椭圆都要 ÷2：web 的 `fillEllipse` 收直径，Cocos 的 `ellipse` 收半径。
   */
  private drawJelly(g: Gfx, s: number, c: number): void {
    const R = 42 * s

    // 外发光：多层低透明大圈（代替 Canvas 不支持的 ADD 混合）
    for (let i = 4; i >= 1; i--) {
      g.fill(c, 0.055)
      g.circle(0, 0, R + i * 8)
      g.fillPath()
    }
    g.fill(c, 0.42)
    g.ellipse(0, 0, (R * 1.7) / 2, (R * 1.35) / 2)
    g.fillPath()

    // 伞盖轮廓：core 层的 1.5px 实色边（半圈，拱面朝上；闭合弦落在伞盖根部）
    const arc: number[] = []
    const seg = 20
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI + Math.PI * (i / seg)
      arc.push(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.68)
    }
    neonPoly(g, arc, c, { width: 1.5, bloom: false })

    // 内核（core）：100% 实色的高亮，让水母"实"起来而不是一团光
    g.fill(0xffffff, 0.82)
    g.ellipse(0, -R * 0.16, (R * 0.62) / 2, (R * 0.44) / 2)
    g.fillPath()

    // 触须：4 条折线（web 侧也是静态形状，摆动由整体位移表达）
    g.line(c, 0.6, 2.2 * s)
    for (let k = 0; k < 4; k++) {
      const x0 = (-1.5 + k) * R * 0.32
      g.moveTo(x0, R * 0.5)
      g.lineTo(x0 * 1.25, R * 0.5 + R * 0.9)
      g.lineTo(x0 * 1.6, R * 0.5 + R * 1.75)
      g.stroke()
    }
  }

  // -------------------------------------------------------------------------
  // 标题文字与装饰
  // -------------------------------------------------------------------------
  private buildTitleText(): void {
    const cx = this.W / 2
    // §3.3：标题中心 y=176（H1 64）、副标题 y=236（Body 16）
    const titleY = 176

    // 标题：core 是白色实字 + 深色描边，发光靠低透明副本（不用 ADD 混合）
    const glow = this.center(cx, titleY, '深 海 回 响', 64, TXT.cyan)
    glow.enableOutline = true
    glow.outlineColor = col(parseInt(TXT.cyan.slice(1), 16))
    glow.outlineWidth = 9
    glow.isBold = true
    glow.node.setScale(1.04, 1.04, 1)
    this.opacityOf(glow.node).opacity = Math.round(0.32 * 255)

    const title = this.center(cx, titleY, '深 海 回 响', 64, '#eafcff')
    title.enableOutline = true
    title.outlineColor = col(0x040810)
    title.outlineWidth = 6
    title.isBold = true

    // ⚠️ 副标题已移除（V6.44）。原来在 y=236 放的是「在光到不了的地方，沉下去」——
    //    它和标题「深海回响」说的是同一件事，属于**重复文案**：玩家读完标题后
    //    不会再读第二行解释同一句话的话。留白比复述好。
    //    y=236 现在空着，装饰线 128 / 272 构成的"品牌框"保持不变 ——
    //    中央区柱顶 284 是**按装饰线 272 反推**的（见 §3.3 常量注释），动它会连锁。

    // 品牌区上下各一条霓虹装饰线，把标题"框"起来（装饰层，不承载信息）
    neonLine(this.gDeco, cx - 300, 128, cx + 300, 128, UI.cyan,
      { width: 1, alpha: 0.5, bloom: false })
    neonLine(this.gDeco, cx - 300, 272, cx + 300, 272, UI.cyan,
      { width: 1, alpha: 0.5, bloom: false })
    neonCircle(this.gDeco, cx - 300, 128, 3, UI.cyanHi, { width: 1.5, bloom: false })
    neonCircle(this.gDeco, cx + 300, 128, 3, UI.cyanHi, { width: 1.5, bloom: false })
  }

  // -------------------------------------------------------------------------
  // §3.1 顶栏（常驻记账条）
  // -------------------------------------------------------------------------
  /**
   * 顶栏 = 档案（左）+ 沉淀货币（中）+ 设置 / 帮助（右）。
   *
   * 三段的横向归属是**刻意的**：档案靠左、工具按钮靠右、货币**整体居中** ——
   * 货币是"记账条"的主体，居中才读得出它是常驻资源。旧版把它挤在右上角，
   * 结果是"玩家不知道局外核心资源存在"（§0 诊断第 2 条）。
   */
  private buildTopBar(): void {
    const W = this.W
    const g = this.gTop
    g.clear()
    g.fill(GLASS.bar, GLASS.barAlpha)
    g.fillRect(0, 0, W, BAR_H)
    g.line(GLASS.edge, 0.28, 1)
    g.strokeSeg(0, BAR_H, W, BAR_H)

    // 档案头像框（40×40 圆角 10）。没有头像素材 —— 用几何剪影占位，**不引新色**。
    g.fill(GLASS.base, 0.9)
    g.fillRoundRect(BAR_PAD, 16, AVATAR, AVATAR, 10)
    g.line(GLASS.edge, GLASS.edgeAlpha, 1)
    g.strokeRoundRect(BAR_PAD, 16, AVATAR, AVATAR, 10)
    g.fill(UI.cyanDim, 0.9)
    g.fillCircle(BAR_PAD + AVATAR / 2, 32, 6)
    g.fill(UI.cyanDim, 0.55)
    g.ellipse(BAR_PAD + AVATAR / 2, 50, 11, 8)
    g.fillPath()

    // 档案文字（左对齐，与头像框同在 y 中心 36）
    this.recordsLabel = this.put(BAR_PAD + AVATAR + 12, 36,
      menuHeaderLabel(this.cb.getMeta()), 16, TXT_LIGHT.dim, 'left')

    // 沉淀货币：菱形图标（矢量，§7.2 明确**不出图**）+ 数值 + 标签。
    // 数值**右对齐** —— 位数变化时整组不左右抖动。
    // 横向按"最坏位数"排：图标右缘 602 → 数值右缘 684（留 82px 给数字与间距，
    // 够 6 位数）→ 标签中心 702。整组跨 582~716，中心 ≈649（≈ 屏心 652）。
    const cy = 36
    this.walletIcon = new Gfx(this.mk('tWalletIcon', this.root).addComponent(Graphics), this.H)
    this.drawWalletIcon(592, cy)
    this.walletLabel = this.put(684, cy, '0', 24, TXT_LIGHT.accent, 'right')
    this.put(702, cy, '沉淀', 14, TXT_LIGHT.mute, 'center')

    for (const e of entriesOf('top')) this.buildToolButton(e)
    this.refreshWallet()      // 读档先于建节点，所以这里直接就能显示真实余额
  }

  /** 顶栏工具按钮。位置由 `slot` 决定：右缘距边 32，向左依次排开，间距 8。 */
  private buildToolButton(e: MenuEntry): void {
    const i = e.slot - 1
    const x = this.W - BAR_PAD - TOP_BTN_HIT - i * (TOP_BTN_HIT + TOP_BTN_GAP)
    const y = TOP_BTN_Y

    const art = this.mk('toolArt', this.root).addComponent(Sprite)
    art.trim = false
    art.sizeMode = Sprite.SizeMode.CUSTOM
    this.setIconBox(art, TOP_BTN_VIS)
    art.node.setPosition(x + TOP_BTN_HIT / 2, this.H - (y + TOP_BTN_HIT / 2))
    art.node.active = false                            // 贴图没到位时隐藏，别留一个白方块
    art.color = col(ICON_TINT.normal)

    const hit = this.hitRect(this.root, x, y, TOP_BTN_HIT, TOP_BTN_HIT)
    hit.on(Node.EventType.MOUSE_ENTER, () => {
      if (this.modal) return
      art.color = col(ICON_TINT.hover)
      art.node.setScale(1.08, 1.08, 1)
    })
    hit.on(Node.EventType.MOUSE_LEAVE, () => {
      art.color = col(ICON_TINT.normal)
      art.node.setScale(1, 1, 1)
    })
    hit.on(Node.EventType.TOUCH_END, () => this.onEntry(e))
    this.tools.push({ e, art })
  }

  // -------------------------------------------------------------------------
  // §3.2 左右分类栏（N 自适应）
  // -------------------------------------------------------------------------
  /**
   * 入口块：**完全由 `shared/menu.ts` 的数据驱动**。
   *
   * 视图层只做三件事 —— 按 `side` 分组、按 `slot` 排序、按 `columnBlocks()` 算 y。
   * **任何坐标都不写死在这里**：新增一个功能入口 = 改一行数据；把入口换到另一列 =
   * 改一个 `side` 字段。这正是用户明确要求的两条（"为后面功能扩展留余地"、
   * "可能有可能**会换位置**"）的落地形式。
   */
  private buildEntrances(): void {
    for (const side of ['left', 'right'] as const) {
      const list = entriesOf(side)
      const col = columnBlocks(list.length)
      if (!col.height) continue
      const x = columnX(side, col.size)
      for (let i = 0; i < list.length; i++) {
        const e = list[i]
        const on = e.state === 'on'

        const art = this.mk('entArt', this.root).addComponent(Sprite)
        art.trim = false
        art.sizeMode = Sprite.SizeMode.CUSTOM
        this.setIconBox(art, col.size)
        art.node.setPosition(x + col.size / 2, this.H - (col.tops[i] + col.size / 2))
        art.node.active = false

        const label = this.center(x + col.size / 2, col.labelCenters[i], e.label, FS.title,
          on ? TXT_LIGHT.dim : TXT_LIGHT.mute)

        const hit = this.hitRect(this.root, x, col.tops[i], col.size, col.size)
        const it: Entry = {
          e, art, label, hit, x, y: col.tops[i], size: col.size, hover: false, press: false,
        }
        hit.on(Node.EventType.MOUSE_ENTER, () => {
          if (this.modal || !on) return
          it.hover = true
          this.drawEntrances()
        })
        hit.on(Node.EventType.MOUSE_LEAVE, () => {
          it.hover = false
          it.press = false
          this.drawEntrances()
        })
        hit.on(Node.EventType.TOUCH_START, () => {
          if (this.modal || !on) return
          it.press = true
          this.drawEntrances()
        })
        hit.on(Node.EventType.TOUCH_CANCEL, () => {
          it.press = false
          this.drawEntrances()
        })
        hit.on(Node.EventType.TOUCH_END, () => {
          it.press = false
          this.drawEntrances()
          this.onEntry(e)
        })
        this.entries.push(it)
      }
    }
    this.drawEntrances()
  }

  /**
   * 重绘所有槽位底。四态（§7.3）**全靠三件事组合**：①槽位底换色 ②图标乘色 ③整体缩放。
   * 位图时代没有"描边 1px"这种参数 —— 每个图标只有一张图，四态是现场算出来的。
   *
   * V6.40：底色从 `MENU.slot`（近黑方块）换成 **`GLASS`深青玻璃槽**（见 theme.ts 的
   * `GLASS` 注释 —— 用户报"ICON 下面底色都是黑色也是不对的"）。
   */
  private drawEntrances(): void {
    const g = this.gSlots
    const r = 12
    g.clear()
    for (const it of this.entries) {
      const s = it.size
      const on = it.e.state === 'on'
      const dim = !on                       // soon / lock：压暗、不接受点击
      const st = dim ? 'lock' : it.press ? 'press' : it.hover ? 'hover' : 'normal'
      this.glassSlot(g, it.x, it.y, s, r, st)

      if (it.hover && on) {
        // halo：多层同色描边（不用 ADD 混合 —— Canvas 渲染器下 ADD 会画成实心白块）
        g.line(UI.cyan, 0.12, 3); g.strokeRoundRect(it.x - 6, it.y - 6, s + 12, s + 12, r + 3)
        g.line(UI.cyan, 0.28, 2); g.strokeRoundRect(it.x - 3, it.y - 3, s + 6, s + 6, r + 2)
      }

      // 角标位 12×12（右上角）：**锁定角标与红点同位互斥**（§7.2）
      if (it.e.state === 'lock') this.drawLockBadge(g, it.x + s - 20, it.y + 8, UI.amber)
      else if (it.e.badge) { g.fill(UI.amber, 1); g.fillCircle(it.x + s - 12, it.y + 12, 6) }

      // 还没有图标素材的占位槽（当前只有"任务"）：画一个内框，别留一块纯空白
      if (!it.e.icon) {
        g.line(GLASS.edge, 0.22, 1)
        g.strokeRoundRect(it.x + s * 0.30, it.y + s * 0.30, s * 0.40, s * 0.40, 6)
      }

      // 图标乘色（§7.3）。乘法只能压暗 —— 所以 `ICON_TINT` 那几个值都取得够亮
      it.art.color = col(dim ? ICON_TINT.lock
        : it.press ? ICON_TINT.down
          : it.hover ? ICON_TINT.hover : ICON_TINT.normal)
      const lc = on ? (it.hover ? TXT_LIGHT.main : TXT_LIGHT.dim) : TXT_LIGHT.mute
      it.label.color = col(parseInt(lc.slice(1), 16))
    }
  }

  /**
   * 画一个「深青玻璃槽」（V6.40）。四态由 `st` 决定：normal / hover / press / lock。
   *
   * 手法的三条要点（Graphics 没有渐变，只能手搓）：
   *   ① **底是半透明深青**（不是实心）—— 背景的珊瑚/微光透上来，槽位才"贴"在场景上；
   *   ② **顶部一条受光高光带**，向下渐隐：用 24 条横向色带 + 圆角内缩模拟，
   *      这是"玻璃"与"黑板"唯一的分界；
   *   ③ **描边用青的低透明版**，悬停时才升到实色 —— 常态若用实色青，六个槽位会一起抢眼。
   */
  private glassSlot(g: Gfx, x: number, y: number, s: number, r: number, st: string): void {
    this.glassPanel(g, x, y, s, s, r, st)
  }

  /**
   * 同上的**矩形版**（V6.41 抽出）。「出击准备」的卡片是 312×132 / 230×148，
   * 不是正方形 —— 但玻璃的读法完全一样（半透明深青 + 顶部受光带 + 霓虹描边），
   * 所以只做"正方形 = 矩形的一个特例"这一处抽象，不复制第二份画法。
   *
   * ⚠️ 高光带的**高度取 min(h, w) 的 38%**，不是 h 的 38%：宽扁的卡片上
   *    若按高度取，高光会压掉大半张卡，变成"上亮下暗"而不是"一片玻璃"。
   */
  private glassPanel(g: Gfx, x: number, y: number, w: number, h: number, r: number, st: string): void {
    const bg = st === 'lock' ? GLASS.lock
      : st === 'press' ? GLASS.press
        : st === 'hover' ? GLASS.hover : GLASS.base
    const bgA = st === 'lock' ? 0.86 : st === 'hover' ? 0.9 : st === 'press' ? 0.9 : GLASS.baseAlpha
    g.fill(bg, bgA)
    g.fillRoundRect(x, y, w, h, r)

    // 顶部高光带：只在非锁定态画（锁定态的高光会误导"这个能点"）
    if (st !== 'lock') {
      const hh = Math.min(w, h) * 0.38
      const bands = 24
      const a0 = st === 'hover' ? 0.20 : 0.13
      for (let i = 0; i < bands; i++) {
        const t = i / bands
        const yy = y + t * hh
        const a = a0 * (1 - t) * (1 - t)          // 二次衰减：上亮下无
        if (a < 0.01) continue
        // 圆角内缩：距顶 dy 处，横向内缩 insetX（圆弧之外不画）
        const dy = t * hh
        const insetX = dy < r ? r - Math.sqrt(Math.max(0, r * r - (r - dy) * (r - dy))) : 0
        g.fill(GLASS.hi, a)
        g.fillRect(x + insetX + 1, yy, w - 2 * insetX - 2, hh / bands + 1)
      }
    }

    // 描边
    if (st === 'hover') {
      g.line(UI.cyan, 1, 1.6)
    } else if (st === 'press') {
      g.line(UI.cyanHi, 1, 1.6)
    } else if (st === 'lock') {
      g.line(MENU.edge, 0.45, 1)
    } else {
      g.line(GLASS.edge, GLASS.edgeAlpha, 1.2)
    }
    g.strokeRoundRect(x, y, w, h, r)

    // 内侧细白线（玻璃厚度感）—— α 极低，只做"这道边是玻璃的"暗示
    if (st !== 'lock') {
      g.line(0xffffff, 0.06, 1)
      g.strokeRoundRect(x + 3, y + 3, w - 6, h - 6, Math.max(2, r - 2))
    }
  }

  /** 锁定角标：一把 12×12 的小挂锁（锁梁上半圆 + 锁体圆角矩形）。 */
  private drawLockBadge(g: Gfx, x: number, y: number, c: number): void {
    g.line(c, 1, 2)
    g.arc(x + 6, y + 5, 4, Math.PI, Math.PI * 2)
    g.stroke()
    g.fill(c, 1)
    g.fillRoundRect(x, y + 4, 12, 8, 2)
  }

  // -------------------------------------------------------------------------
  // §3.3 中央区：品牌 + 主形象 + 主操作
  // -------------------------------------------------------------------------
  /**
   * 主形象 = **单张大立绘 + 左右箭头 + 指示点**（Brotato 式）。
   *
   * 为什么换掉"三张并排卡"（§0 诊断第 4 条）：卡片读起来像商店货架，没有视觉焦点，
   * 玩家看不出"我选的是这艘船"。单张大立绘 + 箭头才是"我在挑一艘船"。
   *
   * 立绘用**战斗内同一张机体贴图** —— 选的时候看到的就是待会要操控的那一艘。
   * 按**圆盘半径**缩放（不是整体贴图）：三台的突出件差很多（刺鳐的撞角 + 鳍把
   * 画布撑大），按整体缩放会让它们在屏幕上差一倍。
   */
  /**
   * 中央：**一艘正在下潜的潜航器**（V6.42）。
   *
   * 用户原话「让它真的下潜」「是个**立体感的实物**，不是平面的」「探照锥不要留着」。
   * 三条逐条落地：
   *
   * | 要求 | 怎么落 |
   * |---|---|
   * | **真的下潜** | 舱体在竖向水体柱里走一个**四段循环**（14.4s）：顶部待机 1.0 → 匀速下潜 6.4 → 底部吹除压载 1.4 → smoothstep 上浮 5.6。整台机械是 `diver` **一个节点**的子节点 ⇒ 位移 = 平移这一个节点。**全程不做淡入淡出**（V6.43）—— 见 `T_TOP` 的注释 |
   * | **立体感的实物** | 按项目既定的**四条体积线索**逐条落：⓪ 投影（右下偏移暗盘）→ ① 侧壁（同形下移 + 变暗）→ ② 受光弧（左上粗弧）→ ③ 暗弧（右下粗弧）。装甲环画成 **8px 宽的实体带**而不是 2px 线 —— 上一版"读作示意图"的病根就在这儿 |
   * | **不留探照锥** | 删掉。方向线索交给受光弧 / 暗弧 / 投影 —— 它们本来就在定义光源方向，去掉锥之后全场只剩一个光源说法，反而更统一 |
   *
   * ⚠️ 舱体内部坐标是**局部坐标（y 向上）**，与顶层 `wrap()` 的 sim 语义（y 向下）相反 ——
   *    原因与规避办法写在 `sub()` 和 `larc()` 的注释里（不能用 `Gfx.arc()`）。
   *
   * ⚠️ 潜航器立绘 `heroArt` 与「出击准备」面板、战斗内共用**同一张贴图**，只是缩放不同；
   *    切换潜航器时这里跟着换（`syncHeroArt()` 每帧对 key）。
   */
  private buildDiver(): void {
    // 舱体组：下潜 = 平移它，俯仰 = 转它的 `angle`
    this.diver = this.mk('tDiver', this.root)

    // 层序（早建 = 下层）：外壳 → 立绘 → 装甲环 → 核心 → 喷流 → 声呐 → 光源 → 扫描臂
    //
    // ⚠️ 每个零件都是**"一个节点 = 一个 Graphics"**，不再往下套子节点：`UIOpacity`
    //    不向下传播（见 `diverOps`），套一层就会漏掉那一层的淡入淡出。
    //    需要旋转 / 缩放的零件（装甲环 / 核心 / 扫描臂）就在**同一个节点**上做 ——
    //    于是 `Graphics` 与变换天然一起动，不需要额外同步。
    this.gHull = this.sub(this.diver, 'dHull')
    this.drawHull()

    this.heroArt = this.mk('dArt', this.diver).addComponent(Sprite)
    this.heroArt.trim = false
    this.heroArt.sizeMode = Sprite.SizeMode.CUSTOM
    // 圆心 = 舱体中心。**不写屏幕坐标** —— 下潜由 `diver` 统一带，这里永远是 (0,0)
    this.heroArt.node.setPosition(0, 0)
    this.heroArt.node.active = false

    this.ringA = this.sub(this.diver, 'dRingA')
    this.drawRing(this.ringA, RING_A_R, RING_A_W, RING_A_SEG)
    this.ringB = this.sub(this.diver, 'dRingB')
    this.drawRing(this.ringB, RING_B_R, RING_B_W, RING_B_SEG)

    this.core = this.sub(this.diver, 'dCore')
    this.drawCore(this.core)

    this.gThrust = this.sub(this.diver, 'dThrust')
    this.gSonar = this.sub(this.diver, 'dSonar')

    // ⚠️ 光源层排在最上：光是打在**所有**结构上的，受光弧必须压住装甲环。
    //    且它挂在 `diver` 下而**不是** `ringA` 上 ⇒ 环转时光斑不动（见 `drawHull` 注释）。
    this.gLight = this.sub(this.diver, 'dLight')
    this.drawLight()

    this.scanArm = this.sub(this.diver, 'dScan')
    this.drawScanArm(this.scanArm)

    // 淡入淡出：每个零件各挂一个 `UIOpacity`（立绘是 Sprite，节点单独取）
    this.diverOps = [
      this.gHull, this.ringA, this.ringB, this.core,
      this.gThrust, this.gSonar, this.gLight, this.scanArm,
    ].map(g => this.opacityOf(g.g.node))
    this.diverOps.push(this.opacityOf(this.heroArt.node))
  }

  /**
   * 竖向水体柱 —— 中央区的"取景框"。
   *
   * 给"舱体正在**一柱水里**往下沉"一个空间锚。三条边线 + 顶部水面线，
   * **不画刻度、不画深度数字**（用户已定不显示）。
   *
   * 底部特意压一层渐暗：给"沉下去"一个终点暗示 —— 没有它，舱体淡出会像是"凭空消失"。
   */
  private drawShaft(): void {
    const g = this.gStage
    const x = SHAFT_X0
    const y = SHAFT_Y0
    g.clear()

    // 柱体：比背景略深的一层，把舱体从峡谷背景里"抠"出来
    g.fill(0x040c14, 0.42)
    g.fillRect(x, y, SHAFT_W, SHAFT_H)

    // 左右两条竖向边线：给出"这是一柱水"的边界
    g.line(GLASS.edge, 0.16, 1)
    g.strokeSeg(x, y, x, y + SHAFT_H)
    g.strokeSeg(x + SHAFT_W, y, x + SHAFT_W, y + SHAFT_H)

    // 顶部水面线：略亮的横线 + 上方一层很淡的辉光（"水面在发光"）
    g.line(UI.cyan, 0.30, 1.4)
    g.strokeSeg(x, y, x + SHAFT_W, y)
    glowPool(g, SHAFT_CX, y + 6, SHAFT_W * 0.5, 24, UI.cyanDim, 4, 0.05)

    // 底部渐暗：越深越看不见
    g.fill(0x02060c, 0.5)
    g.fillRect(x, y + SHAFT_H - 40, SHAFT_W, 40)
  }

  /**
   * 舱体外壳 —— **立体感的四条线索，前两条落在这里**：
   *
   * ```
   * ⓪ 投影       右下 (+18,−14) 的暗盘        ← 先画，被主盘压掉大半，只在右下露出月牙
   * ① 侧壁(厚度) 主盘**下移 10px** 的暗色同形盘 ← 同样被主盘压掉，只在下方露出一条边
   * ② 受光弧     左上 80°–190° 粗 5            ← 在 `drawLight()`（不随机构转）
   * ③ 暗弧       右下 260°–370° 粗 5           ← 同上
   * ```
   *
   * 为什么 ②③ 不在这一层而要单独一层：**光源在世界坐标（左上）固定不动**，
   * 而装甲环要转。把受光弧画进旋转层，光斑就会跟着环转 —— 玩家会读成
   * "一张贴纸在打折"（`cocos/README.md` 已知坑表第一条）。
   *
   * ⚠️ 主盘不是单色平盘：加了一道壳接缝线（r 74）。这不是装饰 ——
   *    单色圆 + 一圈描边 = "一个圆盘"；有一条接缝才读作"上下两半压合出来的壳"。
   */
  private drawHull(): void {
    const g = this.gHull
    g.clear()

    // ⓪ 投影：右下略微偏移的暗盘，被主盘压掉大半 ⇒ 只在右下露出一圈月牙
    g.fill(0x02060b, 0.40)
    g.g.circle(SHADOW_DX, -SHADOW_DY, HULL_R + 4)
    g.g.fill()

    // ① 侧壁（厚度）：主盘下移 HULL_DEPTH 的同形暗盘 ⇒ 下方露出一条月牙 = "这坨东西有 10px 厚"
    g.fill(0x0a1a26, 1)
    g.g.circle(0, -HULL_DEPTH, HULL_R)
    g.g.fill()

    // 主盘：金属中调。比 `GLASS.base` 亮一档、偏冷 ⇒ 从深青背景里"浮"出来
    g.fill(0x1b3243, 1)
    g.g.circle(0, 0, HULL_R)
    g.g.fill()

    // 左右稳定鳍 —— **打破圆形轮廓**的那一笔（见 `FIN_*` 常量注释）。
    // 画在外壳层 ⇒ 装甲环带会压住它的根部，露出来的正好是"鳍穿出装甲环"的一段。
    // 厚度 = 同形下移 5px 的暗色副本（配合光源在左上 ⇒ 厚度朝下偏）。
    for (const sgn of [-1, 1]) {
      const pt = (deg: number, r: number): [number, number] => {
        const a = (deg * Math.PI) / 180
        return [sgn * Math.cos(a) * r, Math.sin(a) * r]
      }
      const [rx1, ry1] = pt(FIN_ROOT_A, FIN_R0)
      const [rx2, ry2] = pt(FIN_ROOT_B, FIN_R0)
      const [tx1, ty1] = pt(FIN_TIP_A, FIN_R1)
      const [tx2, ty2] = pt(FIN_TIP_B, FIN_R1)
      const quad = (dx: number, dy: number) => {
        g.g.moveTo(rx1 + dx, ry1 + dy)
        g.g.lineTo(tx1 + dx, ty1 + dy)
        g.g.lineTo(tx2 + dx, ty2 + dy)
        g.g.lineTo(rx2 + dx, ry2 + dy)
        g.g.close()
      }
      g.fill(0x0a1c28, 1); quad(0, -5); g.g.fill()
      g.fill(0x264458, 1); quad(0, 0); g.g.fill()
      g.line(0x40708a, 0.85, 1.4); quad(0, 0); g.g.stroke()
    }

    // 壳接缝线：r 74，落在推进器口与内装甲环带之间的空隙里（见半径层级表）。
    // ⚠️ 只在**机构区**（r ≥ 58）画 —— 立绘底下画什么都看不见，白费图元。
    g.line(0x0d1c28, 0.55, 1.5)
    larc(g, 0, 0, 74, 0, Math.PI * 2)
    g.g.stroke()

    // 六个姿态推进器口的**凹槽**（物理结构，固定不随环转）
    // ⚠️ 角位直接用模拟层的 `SEAT_ANGLES_DEG`：主界面这圈口与战斗内的座位是同一套语汇，
    //    玩家进局后能认出"这就是刚才转的那圈口"。
    for (const deg of SEAT_ANGLES_DEG) {
      const a = (deg * Math.PI) / 180
      const tx = Math.cos(a) * THRUST_R
      const ty = Math.sin(a) * THRUST_R
      g.fill(0x08131d, 1)
      g.g.circle(tx, ty, 5.5)
      g.g.fill()
      // 上缘亮线 / 下缘暗线：一个凹坑的最小证据（缺了就只是"一个圆点"）
      g.line(UI.cyanHi, 0.30, 1.2)
      larc(g, tx, ty, 5.5, Math.PI * 0.15, Math.PI * 0.85)
      g.g.stroke()
      g.line(0x040a10, 0.7, 1.2)
      larc(g, tx, ty, 5.5, Math.PI * 1.15, Math.PI * 1.85)
      g.g.stroke()
    }
  }

  /**
   * 一条装甲环带：画成**实体带**（`w` px 宽的描边弧）而不是 2px 线。
   *
   * ⚠️ **必须有缺口**：没有缺口的圆环，旋转时屏幕上完全看不出在转 ——
   *    "看见机构在动"这件事全靠这些缺口扫过去。段数取 19 / 14，与 6 个推进器口
   *    不成整数比 ⇒ 缺口永远不会跟喷口对齐成固定图案。
   *
   * ⚠️ 这里只画**结构**，不画明暗 —— 明暗归 `drawLight()`（理由见 `drawHull`）。
   */
  private drawRing(g: Gfx, r: number, w: number, seg: number): void {
    const step = (Math.PI * 2) / seg
    const duty = 0.62                        // 占空比：剩下 38% 是缺口
    g.line(0x2a465c, 1, w)
    for (let i = 0; i < seg; i++) {
      const a0 = i * step
      larc(g, 0, 0, r, a0, a0 + step * duty)
      g.g.stroke()
    }
    // 带的内外缘各描一道细线 —— "一条压在壳上的带"，不是"一圈光"
    g.line(0x0b1a26, 0.8, 1)
    larc(g, 0, 0, r - w / 2, 0, Math.PI * 2)
    g.g.stroke()
    larc(g, 0, 0, r + w / 2, 0, Math.PI * 2)
    g.g.stroke()
  }

  /**
   * 核心穹顶：舱盖正中的能量核心。**呼吸（缩放）是全场唯一的"软"运动** ——
   * 周围机构全是硬边转动，有它才有视觉锚点。
   *
   * 体积线索同 `drawHull`：底暗盘 → 上移的亮盘（穹顶）→ 左上高光点。
   */
  private drawCore(g: Gfx): void {
    g.fill(0x08161f, 1)
    g.g.circle(0, 0, CORE_R)
    g.g.fill()
    // 穹顶：整体**上移 3px** 的亮盘 ⇒ 下方露出底盘的暗边 = 厚度
    g.fill(UI.cyanDim, 0.92)
    g.g.circle(0, 3, CORE_R * 0.62)
    g.g.fill()
    g.fill(UI.cyanHi, 0.75)
    g.g.circle(-4, 7, CORE_R * 0.2)
    g.g.fill()
    g.line(GLASS.edge, 0.35, 1.2)
    larc(g, 0, 0, CORE_R, 0, Math.PI * 2)
    g.g.stroke()
  }

  /**
   * 光源层 —— **永不旋转**，因为它代表"光从哪来"，而光不跟着机构转。
   *
   * 分四步，**顺序不能换**（后画的压前面的）：
   *
   * | 步 | 内容 | 作用 |
   * |---|---|---|
   * | ① | 左上受光椭圆 + 右下背光椭圆（**覆盖整个舱体**） | 球面明暗 —— 立体感的主体 |
   * | ② | 受光弧 80°–190°（左上）粗 6，`cyanHi` α .50 | 亮边 = "这面朝着光" |
   * | ③ | 暗弧 258°–372°（右下）粗 6，近黑 α .55 | 暗边 = "这面背着光" |
   * | ④ | 外缘整圈 1.6，`GLASS.edge` α .32 | 硬边 = 全局轮廓（清晰感的唯一来源） |
   *
   * ⚠️ 第 ① 步是**整个方案里最关键的一步**，也是 preview 迭代出来的：只在壳面做明暗，
   *    读作"边缘一圈装饰"；把明暗铺满整个圆（含立绘与装甲环），才读作"一块金属
   *    被光从左上照到"。对比图见 `docs/shots/diver_layers.png` 的左下 ↔ 右下两格。
   *
   * ⚠️ `Graphics` **没有 clip**，两个椭圆必须各自落在 `HULL_R` 圆内，否则明暗会糊出壳外。
   *    校验：受光最远 14 + 62 = 76 < 90 ✓；背光最远 20 + 62 = 82 < 90 ✓。改大就得重算。
   *
   * ⚠️ 两条弧刻意**只覆盖 110° 而不是半圈**：全覆盖会变成"一个亮环 + 一个暗环"，
   *    读作描边；两端留出过渡区，明暗才有"从有到无"的衰减感 —— `Graphics` 没有真渐变，
   *    只能靠角度截断近似（同玻璃高光带用 24 条色带的做法）。
   */
  private drawLight(): void {
    const g = this.gLight

    // ① 球面明暗：左上受光 / 右下背光（两个偏心大椭圆）
    g.fill(UI.cyanHi, 0.26)
    g.g.ellipse(-14, 14, 62, 50)
    g.g.fill()
    g.fill(0x02060b, 0.5)
    g.g.ellipse(20, -20, 62, 50)
    g.g.fill()

    // ②③ 受光弧 / 暗弧 —— 永不旋转（光源在世界坐标左上）
    const r = HULL_R - 4                     // 略收进外壳 ⇒ 压在装甲环之上
    g.line(UI.cyanHi, 0.5, 6)
    larc(g, 0, 0, r, (80 * Math.PI) / 180, (190 * Math.PI) / 180)
    g.g.stroke()
    g.line(0x02060b, 0.55, 6)
    larc(g, 0, 0, r, (258 * Math.PI) / 180, (372 * Math.PI) / 180)
    g.g.stroke()

    // ④ 外缘硬边
    g.line(GLASS.edge, 0.32, 1.6)
    larc(g, 0, 0, HULL_R, 0, Math.PI * 2)
    g.g.stroke()
  }

  /**
   * 扫描臂：从 `SCAN_R0` 伸到 `SCAN_R1`，末端带探头。
   *
   * 几何朝 **+x** 画一次，之后靠 `node.angle` 转 —— 这是本项目"静态几何 + 节点属性
   * 驱动动画"的固定做法（同扫描线整层平移），**不每帧重画**。
   *
   * 探头也给了体积：上缘亮线 + 下缘暗线（光源在左上，与全场一致）。
   */
  private drawScanArm(g: Gfx): void {
    g.line(UI.cyan, 0.45, 2)
    g.g.moveTo(SCAN_R0, 0)
    g.g.lineTo(SCAN_R1 - 8, 0)
    g.g.stroke()
    g.fill(0x16303f, 1)
    g.g.rect(SCAN_R1 - 8, -4, 8, 8)
    g.g.fill()
    g.line(UI.cyanHi, 0.6, 1.4)
    g.g.moveTo(SCAN_R1 - 8, 4); g.g.lineTo(SCAN_R1, 4)
    g.g.stroke()
    g.line(0x050d14, 0.7, 1.4)
    g.g.moveTo(SCAN_R1 - 8, -4); g.g.lineTo(SCAN_R1, -4)
    g.g.stroke()
  }

  /**
   * 中央舱体每帧步进（V6.43）。
   *
   * 开销全部压在"每帧几十个图元"量级 —— 主界面会停留很久，所以这里**不能**出现
   * "每帧重画一屏几何"的写法：
   *
   * | 动作 | 实现 | 每帧代价 |
   * |---|---|---|
   * | ① 位移（四段循环） | 只写 `diver.setPosition` + 逐个写 `diverOps`（淡入只做一次） | **零重绘** |
   * | ② 俯仰摆动 | 只写 `diver.angle` | **零重绘** |
   * | ③ 装甲环旋转 | 只写 `ringA/ringB.g.node.angle` | **零重绘** |
   * | ④ 核心呼吸（幅度随 `boost`） | 只写 `core.g.node.setScale` | **零重绘** |
   * | ⑤ 扫描臂 | 只写 `scanArm.angle` | **零重绘** |
   * | ⑥ 喷流（长度/亮度随 `boost`） | 每帧重绘 6 段线 | 12 个图元 |
   * | ⑦ 声呐环 | 每帧重绘 2 圈弧 | 2 个图元 |
   * | ⑧ 气泡 | 每帧重绘 ≤ `BUBBLE_N` 个圆 | 88 个图元（44 × 描边 + 高光） |
   *
   * `boost` 是**唯一的动力变量**（0 = 怠速，1 = 全功率）：推进器喷流、核心呼吸幅度
   * 都由它调制。这样"看起来很用力"和"数值上在用力"是同一个量，不会各说各话。
   */
  private stepDiver(dt: number): void {
    const ph = this.t % DIVE_T

    // ---- 分段：算出位移、推进器增益、气泡模式 ----
    // `boost` 同时驱动"喷流长度/亮度"和"核心呼吸幅度"，是唯一的**动力变量**：
    // 它在吹除段 0 → 1、在上浮段保持高位 ⇔ 玩家看到的是"开足马力往上顶"。
    let y: number
    let boost: number
    let mode: 'cruise' | 'stern' | 'vent'
    let gap: number
    if (ph < T_TOP) {
      y = DIVE_Y0
      boost = 0
      mode = 'cruise'
      gap = BUBBLE_DT_CRUISE
    } else if (ph < T_DOWN_END) {
      // 下潜：**线性**。匀速受控下沉，峰值速度 = 平均 = 29px/s
      y = DIVE_Y0 + ((ph - T_TOP) / T_DOWN) * (DIVE_Y1 - DIVE_Y0)
      boost = 0.18
      mode = 'stern'
      gap = BUBBLE_DT_STERN
    } else if (ph < T_BOT_END) {
      // 吹除压载：**原地不动 + 两侧狂排气**。这一段是因果链的关键 ——
      // 先排掉压载水（看得见），机器"变轻"之后才开始动（看得见的逻辑）。
      y = DIVE_Y1
      boost = (ph - T_DOWN_END) / T_BOT
      mode = 'vent'
      gap = BUBBLE_DT_VENT_BLOW
    } else {
      // 上浮：**smoothstep**（起步加速 → 中段最快 → 到顶收敛）。
      // 峰值速度 50px/s ≈ 下潜的 1.7 倍，这是"被浮力托起来"而不是"倒放的下潜"。
      const u = (ph - T_BOT_END) / T_UP
      y = DIVE_Y1 - u * u * (3 - 2 * u) * (DIVE_Y1 - DIVE_Y0)
      boost = 1 - 0.3 * u
      mode = 'vent'
      gap = BUBBLE_DT_VENT_UP
    }

    // ① + ② 位移 + 俯仰摆动
    this.diver.setPosition(SHAFT_CX, this.H - y)
    // ⚠️ 逐个零件写：`UIOpacity` 不向下传播，只写 `diver` 那一个是静默失效的
    // V6.43：**机体全程常驻可见**，淡入只在最开始那 `ENTER_T` 里做一次 ——
    // 循环里再淡入淡出等于把"我看不清它怎么回来的"这句话再说一遍。
    const alpha = Math.min(1, this.t / ENTER_T)
    const op = Math.round(alpha * 255)
    for (const o of this.diverOps) o.opacity = op
    // ⚠️ 摆动周期 5.5s 与循环周期 16.8s **非整数比**：整数比会让"下潜"和"摆动"
    //    每隔几秒重新同步一次，读起来像"一边下潜一边脉动"。
    this.diver.angle = Math.sin((this.t / TILT_T) * Math.PI * 2) * TILT_A

    // ③ 装甲环：外环顺时针、内环**逆时针** —— 双向反向才读作"机构在咬合"
    this.ringA.g.node.angle = (this.t * RING_A_SPD) % 360
    this.ringB.g.node.angle = (this.t * RING_B_SPD) % 360

    // ④ 核心呼吸：半径在 CORE_A ↔ CORE_B 之间（靠缩放，底盘 r=CORE_R）
    //    幅度跟着 `boost` 走 —— 输出越大核心越亮越大，读作"反应堆在使劲"
    const breath = 0.5 + 0.5 * Math.sin((this.t / CORE_T) * Math.PI * 2)
    const ca0 = CORE_A + (CORE_B - CORE_A) * breath
    const cs = (ca0 + boost * 3) / CORE_R
    this.core.g.node.setScale(cs, cs, 1)

    // ⑤ 扫描臂
    this.scanArm.g.node.angle = (this.t * SCAN_SPD) % 360

    // ⑥ 推进器喷流：6 个各错开 `THRUST_T/6` —— 依次点火才有环形点火感，同时喷 = 一坨光
    const tg = this.gThrust
    tg.clear()
    for (let i = 0; i < SEAT_ANGLES_DEG.length; i++) {
      const a = (SEAT_ANGLES_DEG[i] * Math.PI) / 180
      const p = ((this.t + (i * THRUST_T) / SEAT_ANGLES_DEG.length) % THRUST_T) / THRUST_DUR
      if (p >= 1) continue
      // `boost` 在这里变成看得见的"马力"：喷流拉长 1.85 倍、亮度提上来
      const len = (6 + p * (THRUST_LEN - 6)) * (1 + boost * 0.85)
      const al = (1 - p) * (0.55 + 0.45 * boost)
      const r0 = THRUST_R + 4
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      tg.line(UI.cyan, al, 3)
      tg.g.moveTo(ca * r0, sa * r0)
      tg.g.lineTo(ca * (r0 + len), sa * (r0 + len))
      tg.g.stroke()
      tg.fill(UI.cyanHi, al * 0.6)              // 喷口亮斑：点火瞬间最亮
      tg.g.circle(ca * r0, sa * r0, 2.2)
      tg.g.fill()
    }

    // ⑦ 声呐环：从机体**当前**位置周期扩散（`gSonar` 挂在 `diver` 下 ⇒ 局部原点即机体中心）
    //    椭圆压扁（ry = rx × 0.43）而不是正圆 —— 3/4 俯视口径，正圆会读成"光环"。
    const sg = this.gSonar
    sg.clear()
    for (let i = 0; i < SONAR_RINGS; i++) {
      const sp = ((this.t / SONAR_PERIOD) + i / SONAR_RINGS) % 1
      const r = sp * SONAR_RMAX
      const a = (1 - sp) * (1 - sp) * 0.34
      if (a < 0.015 || r < 8) continue
      sg.line(UI.cyan, a, 1.6)
      sg.g.ellipse(0, 0, r, r * 0.43)
      sg.g.stroke()
    }

    // ⑧ 气泡（世界坐标，独立于舱体 —— 见 `stepBubbles`）
    this.stepBubbles(dt, y, mode, gap)
  }

  /**
   * 尾迹气泡：从舱体**艉部**出生，向上浮，出柱顶或寿命到就回收。
   *
   * ⚠️ 出生点在舱体圆盘**内部**（局部 y = +70 < 外壳 r 90）是故意的：气泡先在艇里
   *    "酝酿"约 0.5s，浮出圆盘上缘才可见。直接生在艇外会读作"水里本来就有气泡"，
   *    跟机体没关系 —— 而这正是 V6.41 被判"没有意义"的病根之一。
   *    （这也要求 `tBubble` 层排在舱体**之下**，见构造函数注释。）
   */
  private stepBubbles(dt: number, diveY: number, mode: 'cruise' | 'stern' | 'vent', gap: number): void {
    this.bubbleT += dt
    while (this.bubbleT >= gap) {
      this.bubbleT -= gap
      this.bubbles.push(this.newBubble(SHAFT_CX, diveY, mode))
    }
    // ⚠️ 数量兜底不能删：`vent` 段密度是巡航段的 5.5 倍，刚切进来那一帧 `bubbleT`
    //    的残留够再放好几个。没有这个上限，切换瞬间在场气泡会翻几倍。
    while (this.bubbles.length > BUBBLE_N) this.bubbles.shift()

    const g = this.gBubble
    g.clear()
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]
      b.life -= dt
      b.y -= b.v * dt                                   // sim 语义：y 减小 = 向上
      // 横向：出生初速向外，**指数衰减** ⇒ 两股气流"张开一下"就转为笔直上升。
      // ⚠️ 不衰减的话持续横漂会把气泡送到柱壁外（`VENT_DX1` 104 + 33px 才刚好在柱内）。
      b.vx *= Math.max(0, 1 - dt * VENT_DECAY)
      b.x += (b.vx + Math.sin(this.t * 1.6 + b.ph) * 7) * dt
      // ⚠️ 回收线在柱顶**内侧**（+2 而不是 −6）：柱是取景框，气泡浮出框沿会露在
      //    背景上，看起来像"画面里的气泡漏出来了"。V6.42 的 −6 就是这么错的。
      if (b.life <= 0 || b.y < SHAFT_Y0 + 2) { this.bubbles.splice(i, 1); continue }
      // 两段淡出相乘：① 寿命末段 ② 靠近柱顶 30px 内 —— 后者保证它不会"撞线消失"，
      // 而是在框内化掉，读作"气泡破在水面下"。
      const fade = Math.min(1, b.life / 0.5) * Math.min(1, Math.max(0, (b.y - SHAFT_Y0) / 30))
      // ⚠️ 亮度是这条线索能不能读出来的**第二道闸**（第一道是速度差，见 `VENT_V0`）。
      //    水体柱本身是暗的，气泡是柱里**唯一的高亮元素** —— 用 v6.42 的 0.30 / 1px
      //    在 Creator 里是"要凑近才看得见"。提到 0.55 / 1.4 才是"一眼看到两股气流"。
      //    这里不用 ADD 混合（项目铁规）：Canvas 下会画成实心白块。
      g.line(GLASS.hi, 0.55 * fade, 1.4)
      g.strokeCircle(b.x, b.y, b.r)
      g.fill(0xffffff, 0.20 * fade)                     // 高光点：让气泡是"球"不是"圈"
      g.fillCircle(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.34)
    }
  }

  /**
   * 造一个气泡。`mode` 决定它是"尾迹"还是"排气"（两者的几何与初速完全不同）。
   */
  private newBubble(cx: number, diveY: number, mode: 'cruise' | 'stern' | 'vent'): Bubble {
    if (mode === 'vent') {
      const side = Math.random() < 0.5 ? -1 : 1
      return {
        x: cx + side * (VENT_DX0 + Math.random() * (VENT_DX1 - VENT_DX0)),
        y: diveY + VENT_DY,
        r: 1.8 + Math.random() * 3.4,
        v: VENT_V0 + Math.random() * (VENT_V1 - VENT_V0),
        vx: side * VENT_VX * (0.6 + Math.random() * 0.8),
        ph: Math.random() * 6.28,
        life: BUBBLE_LIFE,
      }
    }
    // 艉部尾迹：横向在 `cx ± 44` 抖，sim y = 艇心 **−70**（减 = 向上）
    return {
      x: cx - 44 + Math.random() * 88,
      y: diveY - 70,
      r: 1.6 + Math.random() * 3.4,
      v: BUBBLE_V0 + Math.random() * (BUBBLE_V1 - BUBBLE_V0),
      vx: 0,
      ph: Math.random() * 6.28,
      life: BUBBLE_LIFE,
    }
  }

  /**
   * 给图标 Sprite 设定显示尺寸。
   *
   * 源图是 512×512、图形外接圆占 **72%**（§7.1 A 表第 6 行）。这里把 **canvas 显示成
   * 容器边长** ⇒ 图形实际落在容器的 72%，四边自然留出呼吸。一条规则同时适用于
   * 侧栏 96/88 与顶栏 40，不需要为每档记一个魔法数。
   */
  private setIconBox(art: Sprite, box: number): void {
    const ut = art.node.getComponent(UITransform) ?? art.node.addComponent(UITransform)
    ut.setContentSize(box, box)
  }

  /** 入口点击路由。`soon` / `lock` 一律不响应，但**给一句 toast**（不静默）。 */
  private onEntry(e: MenuEntry): void {
    if (this.modal) return
    if (e.state !== 'on') {
      this.toast(`${e.label} · ${e.note ?? '暂未开放'}`)
      return
    }
    switch (e.id) {
      case 'codex': this.cb.onOpenCodex(); break
      case 'dock': this.showDock(); break
      default: this.toast(`${e.label} · 视图待接入`)
    }
  }

  /** 简易 toast：停留 2.2s，最后 0.6s 淡出。给"点了没反应"一个交代。 */
  private toast(msg: string): void {
    if (!this.toastLabel) this.toastLabel = this.center(this.W / 2, 700, '', FS.title, TXT.amber)
    this.toastLabel.string = msg
    this.opacityOf(this.toastLabel.node).opacity = 255
    this.toastT = 2.2
  }

  /**
   * 把潜航器特性转成文本行（**收益绿、代价橙** —— 代价不能藏起来）。
   *
   * 当前主形象区把这些拼成**一行**居中显示（§3.3 特性行净宽 ≤420px），所以只取前 3 条。
   */
  private subFeatLines(s: SubDef): Array<{ t: string; c: string }> {
    const out: Array<{ t: string; c: string }> = []
    const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
    if (s.o2Max) out.push({ t: `氧气上限 ${s.o2Max > 0 ? '+' : ''}${s.o2Max}`, c: s.o2Max > 0 ? TXT.jade : TXT.warn })
    if (s.speed) out.push({ t: `移速 ${pct(s.speed)}`, c: TXT.jade })
    if (s.dmgMul !== 1) out.push({ t: `伤害 ${pct(s.dmgMul - 1)}`, c: s.dmgMul > 1 ? TXT.jade : TXT.warn })
    if (s.pickup) out.push({ t: `吸附 ${pct(s.pickup)}`, c: s.pickup > 0 ? TXT.jade : TXT.warn })
    if (s.slots !== 4) out.push({ t: `装备槽 ${s.slots}`, c: TXT.jade })
    if (s.killO2Mul !== 1) out.push({ t: `击杀回氧 ×${s.killO2Mul}`, c: TXT.jade })
    if (s.ram) out.push({ t: `撞击伤害 ${s.ram}`, c: TXT.jade })
    // 特性行净宽 ≤420px，四行会顶到主按钮，压到 3 条（§3.3）
    return out.slice(0, 3)
  }

  // -------------------------------------------------------------------------
  // 主操作 / 底栏
  // -------------------------------------------------------------------------
  /**
   * 主操作：右下角「开始游戏」（V6.41，236×62）。
   *
   * 版式上这是把主界面从"功能罗列"改成 **hub（分流器）**：居中那块让给船坞动画，
   * 动作收到右下角；点它进「出击准备」，在那里选潜航器与首个武器。
   *
   * 点击区：236×62 = 14632 px²，高度 62 > 触屏舒适下限 48，面积远超 88×88 逻辑像素
   * 的下限（本项目 UI 规格 §6）。所以**视觉尺寸直接当点击区**，不再另做放大热区 ——
   * 多一层不可见热区反而会让"看起来没挨着按钮却点到了"。
   */
  private buildCta(): void {
    this.makeButton(this.W - START_PAD_R - START_W / 2, START_CY,
      '开 始 游 戏', true, () => this.confirm(), START_W, START_H)
  }

  /**
   * 底栏（§3.4）：左 = 快捷键提示，右 = 版本角标。
   * 版本角标**必须留着** —— 它是"到底有没有跑到新代码"的唯一客观依据（本项目反复吃过的亏）。
   */
  private buildFooter(): void {
    this.put(BAR_PAD, FOOTER_Y, 'Enter 出击 · 1/2/3 或 ←→ 换潜航器', 14, TXT.mute, 'left')
    this.updateFooter()
  }

  /** 钱包图标：一个小菱形（＝"沉淀物"）。故意不用 emoji/字形 —— 默认字体不一定有。 */
  private drawWalletIcon(cx: number, cy: number): void {
    const g = this.walletIcon
    if (!g) return
    g.clear()
    g.fill(UI.amber, 0.9)
    g.moveTo(cx, cy - 10); g.lineTo(cx + 10, cy); g.lineTo(cx, cy + 10); g.lineTo(cx - 10, cy)
    g.close(); g.fillPath()
    // 外描边用同色低透明：既收口又不抢眼（不引新色，PALETTE 里没有 amberHi）
    g.line(UI.amber, 0.45, 1.2)
    g.strokeSeg(cx, cy - 10, cx + 10, cy)
    g.strokeSeg(cx + 10, cy, cx, cy + 10)
  }

  /** 刷新钱包数字（开局、结算后、买完强化后都调一次）。千分位避免位数变化时整组抖动。 */
  refreshWallet(): void {
    if (!this.walletLabel) return
    this.walletLabel.string = formatThousands(this.cb.getMeta().bio)
  }

  /** 版本角标：一眼确认"跑的是哪个版本、适配成了多大"（本项目反复吃过的亏） */
  private updateFooter(): void {
    const s = `${BUILD_TAG} · ${Math.round(this.viewW)}×${Math.round(this.viewH)}`
    if (s === this.footer) return
    this.footer = s
    if (!this.footerLabel) {
      this.footerLabel = this.text(this.W - BAR_PAD, FOOTER_Y, s, FS.body, TXT.mute, true)
      this.opacityOf(this.footerLabel.node).opacity = Math.round(0.9 * 255)
    } else {
      this.footerLabel.string = s
    }
  }

  /**
   * 霓虹按钮：近黑底 + 青描边 + 外侧 halo。
   * 不用"实心青填充"——大面积高饱和会把标题压下去，也不符合 U 艇仪表的调性。
   */
  private makeButton(cx: number, cy: number, s: string, primary: boolean, onTap: () => void,
                     widthOverride?: number, heightOverride?: number): void {
    const w = widthOverride ?? (primary ? 300 : 200)
    const h = heightOverride ?? (primary ? 68 : 48)
    const n = this.mk('tbtn', this.root)
    const ut = n.addComponent(UITransform)
    ut.setAnchorPoint(0.5, 0.5)
    ut.setContentSize(w, h)
    n.setPosition(cx, this.H - cy)
    const gfx = new Gfx(n.addComponent(Graphics), 0)
    const l = this.mk('tbtnLabel', n).addComponent(Label)
    l.string = s
    l.fontSize = primary ? 28 : 20
    l.lineHeight = (primary ? 28 : 20) + 2
    l.horizontalAlign = Label.HorizontalAlign.CENTER
    l.verticalAlign = Label.VerticalAlign.CENTER
    l.isBold = true
    l.enableOutline = true
    l.outlineColor = col(0x040810)
    l.outlineWidth = primary ? 3 : 2

    const b: Btn = { gfx, label: l, w, h, primary, hover: false, onTap }
    n.on(Node.EventType.TOUCH_END, () => { if (!this.modal) b.onTap() })
    n.on(Node.EventType.MOUSE_ENTER, () => { if (this.modal) return; b.hover = true; this.drawButton(b) })
    n.on(Node.EventType.MOUSE_LEAVE, () => { b.hover = false; this.drawButton(b) })
    this.btns.push(b)
    this.drawButton(b)
  }

  private drawButton(b: Btn): void {
    const g = b.gfx
    const accent = b.primary ? UI.cyan : UI.cyanDim
    const hw = b.w / 2
    const hh = b.h / 2
    g.clear()
    if (b.hover) {
      // 外发光用多层描边（不用 ADD 混合）
      g.line(accent, 0.10, 3); g.strokeRoundRect(-hw - 6, -hh - 6, b.w + 12, b.h + 12, 14)
      g.line(accent, 0.28, 2); g.strokeRoundRect(-hw - 3, -hh - 3, b.w + 6, b.h + 6, 13)
    }
    g.fill(b.hover ? UI.panelHi : UI.panel, 0.94)
    g.fillRoundRect(-hw, -hh, b.w, b.h, 11)
    g.line(b.hover ? UI.cyanHi : accent, b.hover ? 1 : 0.85, b.hover ? 2 : 1.5)
    g.strokeRoundRect(-hw, -hh, b.w, b.h, 11)
    // 左上角的高光短线（玻璃反光暗示）
    g.line(UI.cyanHi, b.hover ? 0.5 : 0.28, 2)
    g.strokeSeg(-hw + 10, -hh + 5, -hw + 10 + b.w * 0.28, -hh + 5)
    b.label.node.setScale(b.hover ? 1.035 : 1, b.hover ? 1.035 : 1, 1)
    b.label.color = col(b.hover ? 0xffffff : parseInt((b.primary ? TXT.cyber : TXT.main).slice(1), 16))
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------
  /**
   * 切换当前潜航器（船坞里的机体 + 出击准备面板的选中项）。
   *
   * **不重建任何节点** —— 立绘是同一个 key 的贴图、文本只改 `string`，所以切换是零分配。
   *
   * ⚠️ V6.41：名称 / 特性行已随「出击准备」面板搬走（原先画在中央区 §3.3 的两行）。
   * 面板关着时切换只影响船坞里的机体立绘；面板开着时同步刷新卡片选中态。
   */
  private select(i: number): void {
    if (i < 0 || i >= SUBS.length) return
    this.sel = i
    this.heroKey = ''            // 强制 `syncHeroArt()` 重挂贴图（船坞里的机体会跟着换）
    if (this.loadRoot) this.drawLoadout()   // 面板开着时就手选中态跟着走
  }

  /**
   * ← → ：循环切换。
   *
   * 「出击准备」面板开着时只在**当前聚焦行**内循环（↑↓ 换行）—— 两行都是横排，
   * 让 ←→ 同时改"艇"和"枪"会变成猜谜。面板关着时就是单纯的潜航器循环。
   */
  move(d: number): void {
    if (this.loadRoot) {
      if (this.loadFocus === 'sub') {
        this.select((this.sel + d + SUBS.length) % SUBS.length)
      } else {
        const n = START_WEAPONS.length
        this.wsel = (this.wsel + d + n) % n
        this.drawLoadout()
      }
      return
    }
    this.select((this.sel + d + SUBS.length) % SUBS.length)
  }

  /** ↑ ↓ ：面板开着时在「潜航器 / 首个武器」两行间切焦点（`d<0` = 上一行）。 */
  focusRow(d: number): void {
    if (!this.loadRoot) return
    const next: 'sub' | 'wpn' = d < 0 ? 'sub' : 'wpn'
    if (next === this.loadFocus) return
    this.loadFocus = next
    this.drawLoadout()
  }

  /** Esc：面板开着就关掉它。返回 true = 这次 ESC 已被消费（`DiveGame` 不再往下走）。 */
  back(): boolean {
    if (!this.loadRoot) return false
    this.closeLoadout()
    return true
  }

  /**
   * Enter / 点「开始游戏」。
   *
   * ⚠️ V6.41 起**不再直接开局**，而是先开「出击准备」—— 用户要求"进入游戏给个选项"。
   * 于是同一个 Enter 有两种语义，靠"面板是不是开着"区分：
   *   面板没开 → 打开出击准备；面板开着 → 确认出击。
   */
  confirm(): void {
    if (this.loadRoot) { this.launch(); return }
    if (this.modal) return
    this.showLoadout()
  }

  /** 数字直选（1/2/3） */
  pick(i: number): void {
    this.select(i)
  }

  setVisible(v: boolean): void {
    this.root.active = v
  }

  get selection(): number {
    return this.sel
  }

  /** 战绩文案（DiveGame 在开局前 / 回标题时写入）。现在落在顶栏的**档案文字**上。 */
  setRecords(label: string, hasRuns: boolean): void {
    if (!this.recordsLabel) return
    this.recordsLabel.string = label
    // 没跑过时它是"说明"而不是"战绩"，用弱一档的颜色，别让人以为那是纪录
    this.recordsLabel.color = col(parseInt((hasRuns ? TXT_LIGHT.dim : TXT_LIGHT.mute).slice(1), 16))
  }

  // -------------------------------------------------------------------------
  // 装置坞（解锁屏）—— V6.36：接真解锁集与永久强化，替换原来的占位面板
  // -------------------------------------------------------------------------
  private static readonly DOCK_PW = 880
  private static readonly DOCK_PH = 660

  private dockX0(): number { return (this.W - Title.DOCK_PW) / 2 }
  private dockY0(): number { return (this.H - Title.DOCK_PH) / 2 }

  /** 左列 4 个 tab 的矩形（sim 坐标，左上角） */
  private dockTabRect(i: number): { x: number; y: number; w: number; h: number } {
    return { x: this.dockX0() + 20, y: this.dockY0() + 84 + i * 68, w: 140, h: 56 }
  }

  /**
   * 建一个 UITransform 命中矩形（**sim 坐标**，锚点 (0,0)）。
   *
   * ⚠️ 位置必须写 `(x, H - y - h)`：锚点 (0,0) 的节点位置点是它的**左下角**，
   *    而 sim 的 (x,y) 是左上角。漏了这一步不会报错，只会得到一个错一格的透明热区。
   */
  private hitRect(parent: Node, x: number, y: number, w: number, h: number): Node {
    const n = this.mk('hit', parent)
    const ut = n.addComponent(UITransform)
    ut.setAnchorPoint(0, 0)
    ut.setContentSize(w, h)
    n.setPosition(x, this.H - y - h)
    return n
  }

  private closeDock(): void {
    if (this.dockHit) { this.dockHit.destroy(); this.dockHit = null }
    this.gDock = null
    this.dockText = null
    this.modal = null
  }

  /** 装置坞：解锁屏。开着时卡片与按钮不响应（`this.modal` 挡着）。 */
  private showDock(): void {
    if (this.modal) return
    this.dockTab = 0

    const root = this.mk('dockRoot', this.root)
    this.modal = root
    this.dockHit = root
    this.gDock = new Gfx(this.mk('dockG', root).addComponent(Graphics), this.H)

    // 全屏关闭区（点面板外关闭；盖住画布含外扩，否则弹窗两侧点不动）
    const scrim = this.hitRect(root, -this.padW, -this.padH, this.W + this.padW * 2, this.H + this.padH * 2)
    scrim.on(Node.EventType.TOUCH_END, () => this.closeDock())

    // 面板本体：吞掉点击（否则点面板会顺手关掉它）
    this.hitRect(root, this.dockX0(), this.dockY0(), Title.DOCK_PW, Title.DOCK_PH)

    // 关闭按钮 ×（44×44，右上角）
    const cbtn = this.hitRect(root, this.dockX0() + Title.DOCK_PW - 56, this.dockY0() + 10, 44, 44)
    cbtn.on(Node.EventType.TOUCH_END, () => this.closeDock())

    // 左列 4 个 tab
    for (let i = 0; i < 4; i++) {
      const r = this.dockTabRect(i)
      const n = this.hitRect(root, r.x, r.y, r.w, r.h)
      n.on(Node.EventType.TOUCH_END, () => { if (this.dockTab !== i) { this.dockTab = i; this.drawDock() } })
    }

    this.drawDock()
  }

  /** 重画装置坞内容（切 tab / 买完强化后调）。文本层与行热区整体重建，避免节点泄漏。 */
  private drawDock(): void {
    if (!this.gDock || !this.dockHit) return
    const root = this.dockHit
    if (this.dockText) this.dockText.destroy()
    const text = this.mk('dockText', root)
    this.dockText = text
    const line = (x: number, y: number, s: string, size: number, color: string,
                  mode: 'left' | 'center' | 'right' = 'left') => {
      const l = this.mk('dl', text).addComponent(Label)
      l.string = s
      l.fontSize = size
      l.lineHeight = size + 2
      l.color = col(parseInt(color.slice(1), 16))
      l.verticalAlign = Label.VerticalAlign.CENTER
      l.horizontalAlign = mode === 'left' ? Label.HorizontalAlign.LEFT
        : mode === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER
      const ut = l.node.getComponent(UITransform)
      if (ut) ut.setAnchorPoint(mode === 'left' ? 0 : mode === 'right' ? 1 : 0.5, 0.5)
      l.node.setPosition(x, this.H - y)
    }

    const g = this.gDock
    const x0 = this.dockX0(), y0 = this.dockY0()
    const PW = Title.DOCK_PW, PH = Title.DOCK_PH
    const meta = this.cb.getMeta()
    g.clear()
    g.fill(MENU.page, 0.9)
    g.fillRect(-this.padW, -this.padH, this.W + this.padW * 2, this.H + this.padH * 2)
    g.fill(UI.abyss, 0.98)
    g.fillRoundRect(x0, y0, PW, PH, 14)
    neon(g, UI.cyan, () => { g.roundRect(x0, y0, PW, PH, 14); g.stroke() },
      { width: 1.5, alpha: 0.85, bloom: false })
    // 顶栏横梁（同 Codex：`MENU` 没有 `header`，梁取 `UI.panelHi`「抬起面」）
    g.fill(UI.panelHi, 0.9)
    g.fillRoundRect(x0, y0, PW, 62, 14)
    g.fill(UI.panelHi, 0.9)
    g.fillRect(x0, y0 + 48, PW, 14)

    line(x0 + 28, y0 + 32, '装 置 坞', 26, TXT_LIGHT.main, 'left')
    line(x0 + PW - 72, y0 + 32, `${meta.bio} 沉淀`, 16, TXT_LIGHT.accent, 'right')
    line(x0 + PW - 28, y0 + PH - 22, '点击面板外关闭', 14, TXT_LIGHT.mute, 'right')
    line(x0 + 28, y0 + PH - 22, '达成条件即解锁；强化用沉淀生物质购买', 14, TXT_LIGHT.mute, 'left')

    // 关闭按钮的 ×
    g.line(UI.cyan, 0.85, 2)
    const cxp = x0 + PW - 34, cyp = y0 + 32
    g.strokeSeg(cxp - 8, cyp - 8, cxp + 8, cyp + 8)
    g.strokeSeg(cxp + 8, cyp - 8, cxp - 8, cyp + 8)

    // 左列 tab
    for (let i = 0; i < 4; i++) {
      const r = this.dockTabRect(i)
      const on = i === this.dockTab
      g.fill(on ? MENU.cardHi : MENU.slot, 1)
      g.fillRoundRect(r.x, r.y, r.w, r.h, 9)
      neon(g, on ? UI.cyan : UI.line, () => { g.roundRect(r.x, r.y, r.w, r.h, 9); g.stroke() },
        { width: on ? 2 : 1.2, alpha: on ? 1 : 0.5, bloom: false })
      line(r.x + r.w / 2, r.y + r.h / 2, Title.DOCK_TABS[i], 16, on ? TXT_LIGHT.main : TXT_LIGHT.dim, 'center')
    }

    // 右区列表
    const lx = x0 + 180
    const lw = PW - 180 - 24
    const rowH = 38
    const pitch = 42
    const yTop = y0 + 86

    // 行热区容器（强化行才有点击）
    const rows = this.mk('dockRows', root)

    if (this.dockTab === 3) {
      // ---- 永久强化（可购买）----
      for (let i = 0; i < PERKS.length; i++) {
        const d = PERKS[i]
        const ry = yTop + i * pitch
        const cur = Math.max(0, Math.min(d.maxLvl, Math.floor(meta.perks[d.id] ?? 0)))
        const cost = cur >= d.maxLvl ? null : d.prices[cur]
        const afford = cost !== null && meta.bio >= cost
        g.fill(MENU.card, 1)
        g.fillRoundRect(lx, ry, lw, rowH, 8)
        neon(g, cost !== null && afford ? UI.amber : MENU.edge, () => { g.roundRect(lx, ry, lw, rowH, 8); g.stroke() },
          { width: 1.2, alpha: 0.75, bloom: false })
        line(lx + 12, ry + rowH / 2, d.name, 16, TXT_LIGHT.main)
        line(lx + 132, ry + rowH / 2, `${d.desc}　Lv ${cur}/${d.maxLvl}`, 14, TXT_LIGHT.dim)
        const chip = cost === null ? '已满级' : `${cost} 沉淀`
        line(lx + lw - 12, ry + rowH / 2, chip, 14,
          cost === null ? TXT_LIGHT.mute : afford ? TXT_LIGHT.accent : TXT_LIGHT.warn, 'right')
        if (cost !== null) {
          const hit = this.hitRect(rows, lx, ry, lw, rowH)
          hit.on(Node.EventType.TOUCH_END, () => {
            if (this.cb.onBuyPerk(d.id)) this.drawDock()
          })
        }
      }
    } else {
      // ---- 潜航器 / 武器 / 遗物（达成即解锁，只读）----
      const kind = (['sub', 'weapon', 'relic'] as const)[this.dockTab]
      const list = unlocksByKind(kind)
      for (let i = 0; i < list.length && i < 12; i++) {
        const u = list[i]
        const ry = yTop + i * pitch
        const ok = isUnlocked(meta, u.id)
        g.fill(ok ? MENU.card : MENU.slot, 1)
        g.fillRoundRect(lx, ry, lw, rowH, 8)
        neon(g, ok ? UI.jade : MENU.edge, () => { g.roundRect(lx, ry, lw, rowH, 8); g.stroke() },
          { width: ok ? 1.4 : 1, alpha: ok ? 0.9 : 0.55, bloom: false })
        line(lx + 12, ry + rowH / 2, u.name, 16, ok ? TXT_LIGHT.main : TXT_LIGHT.mute)
        line(lx + 152, ry + rowH / 2, u.cond, 14, ok ? TXT_LIGHT.dim : TXT_LIGHT.mute)
        line(lx + lw - 12, ry + rowH / 2, ok ? '已解锁' : '未达成', 14,
          ok ? TXT_LIGHT.good : TXT_LIGHT.mute, 'right')
      }
    }
  }

  // -------------------------------------------------------------------------
  // 出击准备（V6.41）—— 「开始游戏」之后的第 2 步
  // -------------------------------------------------------------------------
  /**
   * 一个全屏面板，一次做完两件事：**选潜航器 + 选开局第一个武器**。
   *
   * 为什么合成一屏而不是分两步走：这两个选择是**互相牵制**的（深潜者少 20 氧气上限
   * 但多一个装备槽 ⇒ 更愿意带鱼雷这种慢枪），分两屏玩家得来回翻。同屏并列放，
   * 一次就能看出"艇 + 枪"的组合长什么样。
   *
   * 结构照搬装置坞（同一个 `modal` 机制）：全屏 scrim 关闭 + 面板本体吞点击 +
   * 右上角关闭叉号。**面板开着时底下的卡片与右下角按钮都不响应**（`modal` 挡着）——
   * 否则"点面板外关闭"会顺手把底下的「开始游戏」也点掉，变成"关不掉"。
   */
  private static readonly LOAD_PW = 1040
  private static readonly LOAD_PH = 600
  private static readonly SUB_CARD_W = 312
  private static readonly SUB_CARD_H = 132
  private static readonly WPN_CARD_W = 230
  private static readonly WPN_CARD_H = 148
  private static readonly CARD_GAP = 16

  private loadX0(): number { return (this.W - Title.LOAD_PW) / 2 }
  private loadY0(): number { return (this.H - Title.LOAD_PH) / 2 }

  /** 潜航器卡矩形（3 张等宽横向居中） */
  private subCardRect(i: number): Rect {
    const w = Title.SUB_CARD_W, h = Title.SUB_CARD_H, gap = Title.CARD_GAP
    const total = SUBS.length * w + (SUBS.length - 1) * gap
    return { x: this.loadX0() + (Title.LOAD_PW - total) / 2 + i * (w + gap), y: this.loadY0() + 112, w, h }
  }

  /** 武器卡矩形（4 张等宽横向居中） */
  private wpnCardRect(i: number): Rect {
    const w = Title.WPN_CARD_W, h = Title.WPN_CARD_H, gap = Title.CARD_GAP
    const n = START_WEAPONS.length
    const total = n * w + (n - 1) * gap
    return { x: this.loadX0() + (Title.LOAD_PW - total) / 2 + i * (w + gap), y: this.loadY0() + 290, w, h }
  }

  /** 底部两键矩形。`go` 宽一档 —— 它是主操作，视觉权重本来就该更大。 */
  private loadBtnRect(which: 'back' | 'go'): Rect {
    const cx = this.loadX0() + Title.LOAD_PW / 2
    const y = this.loadY0() + 480
    return which === 'back' ? { x: cx - 230, y, w: 160, h: 56 } : { x: cx - 30, y, w: 260, h: 56 }
  }

  private showLoadout(): void {
    if (this.modal) return
    const root = this.mk('loadRoot', this.root)
    this.loadRoot = root
    this.modal = root
    this.gLoad = new Gfx(this.mk('loadG', root).addComponent(Graphics), this.H)
    this.loadCards = this.mk('loadCards', root)
    this.loadSubArt = []
    this.loadWpnArt = []
    this.loadFocus = 'sub'      // 每次开面板都从"潜航器"行起（键盘玩家的默认焦点）

    // 全屏关闭区（盖住画布含外扩，否则弹窗两侧点不动）
    const scrim = this.hitRect(root, -this.padW, -this.padH,
      this.W + this.padW * 2, this.H + this.padH * 2)
    scrim.on(Node.EventType.TOUCH_END, () => this.closeLoadout())
    // 面板本体：吞掉点击（否则点面板会顺手关掉它）
    this.hitRect(root, this.loadX0(), this.loadY0(), Title.LOAD_PW, Title.LOAD_PH)
    // 关闭叉号（44×44，右上角）
    const cbtn = this.hitRect(root, this.loadX0() + Title.LOAD_PW - 56, this.loadY0() + 10, 44, 44)
    cbtn.on(Node.EventType.TOUCH_END, () => this.closeLoadout())

    // 卡片立绘节点：**只建一次**，选中态只改 `color` / 重绘 Gfx，不重建节点
    for (let i = 0; i < SUBS.length; i++) {
      const r = this.subCardRect(i)
      const art = this.mk('loadSubArt', this.loadCards).addComponent(Sprite)
      art.trim = false
      art.sizeMode = Sprite.SizeMode.CUSTOM
      art.node.setPosition(r.x + 66, this.H - (r.y + r.h / 2))
      art.node.active = false
      this.loadSubArt.push(art)
      const hit = this.hitRect(root, r.x, r.y, r.w, r.h)
      hit.on(Node.EventType.TOUCH_END, () => this.select(i))
    }
    for (let i = 0; i < START_WEAPONS.length; i++) {
      const r = this.wpnCardRect(i)
      const art = this.mk('loadWpnArt', this.loadCards).addComponent(Sprite)
      art.trim = false
      art.sizeMode = Sprite.SizeMode.CUSTOM
      const ut = art.node.getComponent(UITransform) ?? art.node.addComponent(UITransform)
      // ⚠️ 武器立绘是 2:1 画布（`itemArt.ts`），容器**必须同比例**。
      //    容器比例错了不会报错，只会非等比拉伸 —— 项目记忆里"立绘框必须与
      //    素材画布同比例"那条就是这么踩出来的。
      const aw = Title.WPN_CARD_W - 44
      ut.setContentSize(aw, aw / 2)
      art.node.setPosition(r.x + r.w / 2, this.H - (r.y + 58))
      art.node.active = false
      this.loadWpnArt.push(art)
      const hit = this.hitRect(root, r.x, r.y, r.w, r.h)
      hit.on(Node.EventType.TOUCH_END, () => { this.wsel = i; this.drawLoadout() })
    }

    // 底部两键
    for (const which of ['back', 'go'] as const) {
      const r = this.loadBtnRect(which)
      const n = this.hitRect(root, r.x, r.y, r.w, r.h)
      n.on(Node.EventType.MOUSE_ENTER, () => { this.loadHover = which; this.drawLoadout() })
      n.on(Node.EventType.MOUSE_LEAVE, () => { if (this.loadHover === which) { this.loadHover = null; this.drawLoadout() } })
      n.on(Node.EventType.TOUCH_END, () => { which === 'back' ? this.closeLoadout() : this.launch() })
    }

    this.drawLoadout()
  }

  /** 重画「出击准备」内容（切选中 / 悬停按钮时调）。文本层整体重建，避免节点泄漏。 */
  private drawLoadout(): void {
    if (!this.gLoad || !this.loadRoot) return
    if (this.loadText) this.loadText.destroy()
    const text = this.mk('loadText', this.loadRoot)
    this.loadText = text
    const line = (x: number, y: number, s: string, size: number, color: string,
                  mode: 'left' | 'center' | 'right' = 'left') => {
      const l = this.mk('ll', text).addComponent(Label)
      l.string = s
      l.fontSize = size
      l.lineHeight = size + 2
      l.color = col(parseInt(color.slice(1), 16))
      l.verticalAlign = Label.VerticalAlign.CENTER
      l.horizontalAlign = mode === 'left' ? Label.HorizontalAlign.LEFT
        : mode === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER
      const ut = l.node.getComponent(UITransform)
      if (ut) ut.setAnchorPoint(mode === 'left' ? 0 : mode === 'right' ? 1 : 0.5, 0.5)
      l.node.setPosition(x, this.H - y)
    }

    const g = this.gLoad
    const x0 = this.loadX0(), y0 = this.loadY0()
    const PW = Title.LOAD_PW, PH = Title.LOAD_PH
    g.clear()

    // scrim：**半透明暗幕**（弹窗用 scrim，不是 pageFill —— 见项目铁规第 8 条）
    g.fill(0x03070b, 0.74)
    g.fillRect(-this.padW, -this.padH, this.W + this.padW * 2, this.H + this.padH * 2)

    // 面板底：沿用主界面的 GLASS 语汇（同一套"深青玻璃"，不是另起一套弹窗配色）
    g.fill(GLASS.bar, 0.97)
    g.fillRoundRect(x0, y0, PW, PH, 18)
    neon(g, UI.cyan, () => { g.roundRect(x0, y0, PW, PH, 18); g.stroke() },
      { width: 1.6, alpha: 0.8, bloom: false })

    // 顶栏横梁
    g.fill(UI.panelHi, 0.9)
    g.fillRoundRect(x0, y0, PW, 62, 18)
    g.fill(UI.panelHi, 0.9)
    g.fillRect(x0, y0 + 46, PW, 16)
    line(x0 + 28, y0 + 31, '出 击 准 备', 26, TXT_LIGHT.main)
    line(x0 + PW - 72, y0 + 31, `${this.cb.getMeta().bio} 沉淀`, 16, TXT_LIGHT.accent, 'right')
    g.line(UI.cyan, 0.85, 2)
    const cxp = x0 + PW - 34, cyp = y0 + 31
    g.strokeSeg(cxp - 8, cyp - 8, cxp + 8, cyp + 8)
    g.strokeSeg(cxp + 8, cyp - 8, cxp - 8, cyp + 8)

    // 分段标题 + 一句话说明（说明放在右侧，讲"选了会怎样"，不是复述标题）
    // ↑↓ 焦点所在的行标题提一档色 —— 键盘玩家要知道"现在 ←→ 会改哪一行"。
    const subOn = this.loadFocus === 'sub'
    const wpnOn = this.loadFocus === 'wpn'
    line(x0 + 40, y0 + 96, '潜 航 器', 18, subOn ? TXT_LIGHT.accent : TXT_LIGHT.dim)
    line(x0 + PW - 40, y0 + 96, '决定开局倾向 · 不锁死后续 build', 14, TXT_LIGHT.mute, 'right')
    line(x0 + 40, y0 + 274, '首 个 武 器', 18, wpnOn ? TXT_LIGHT.accent : TXT_LIGHT.dim)
    line(x0 + PW - 40, y0 + 274, '开局即装载 · 其余武器在商店购买', 14, TXT_LIGHT.mute, 'right')
    // 焦点行的左缘竖条（与卡片的选中竖条同一语汇，位置在标题左侧）
    const focusY = subOn ? y0 + 112 : y0 + 290
    const focusH = subOn ? Title.SUB_CARD_H : Title.WPN_CARD_H
    g.fill(subOn ? UI.cyan : UI.jade, 0.9)
    g.fillRoundRect(x0 + 26, focusY, 3, focusH, 1.5)

    // ---- 潜航器卡 ----
    for (let i = 0; i < SUBS.length; i++) {
      const r = this.subCardRect(i)
      const on = i === this.sel
      this.glassPanel(g, r.x, r.y, r.w, r.h, 12, on ? 'hover' : 'normal')
      if (on) {
        g.line(UI.cyan, 0.14, 3)
        g.strokeRoundRect(r.x - 5, r.y - 5, r.w + 10, r.h + 10, 15)
        // 左侧选中竖条：**给"当前选的是哪张"一个不依赖颜色的第二线索**
        g.fill(UI.cyan, 0.95)
        g.fillRoundRect(r.x + 4, r.y + 18, 3, r.h - 36, 1.5)
      }
      const s = SUBS[i]
      line(r.x + 128, r.y + 38, s.name, 22, on ? '#eafcff' : TXT_LIGHT.dim)
      line(r.x + 128, r.y + 68, s.tag, 15, on ? TXT_LIGHT.accent : TXT_LIGHT.mute)
      // 特性行：一个 Label 只有一种颜色，所以这里**不分色**（代价在文档里单列）。
      line(r.x + 128, r.y + 96, this.subFeatLines(s).map(f => f.t).join(' · '), 13, TXT_LIGHT.dim)
    }

    // ---- 武器卡 ----
    for (let i = 0; i < START_WEAPONS.length; i++) {
      const r = this.wpnCardRect(i)
      const on = i === this.wsel
      this.glassPanel(g, r.x, r.y, r.w, r.h, 12, on ? 'hover' : 'normal')
      if (on) {
        g.line(UI.cyan, 0.14, 3)
        g.strokeRoundRect(r.x - 5, r.y - 5, r.w + 10, r.h + 10, 15)
      }
      const w = WEAPON_DEF[START_WEAPONS[i]]
      line(r.x + r.w / 2, r.y + 110, w.name, 17, on ? '#eafcff' : TXT_LIGHT.dim, 'center')
      line(r.x + r.w / 2, r.y + 132, w.desc, 12, TXT_LIGHT.mute, 'center')
    }

    // 立绘乘色：选中亮、未选压暗。**乘法只能压暗**，所以底色取的是浅灰而不是纯白。
    for (let i = 0; i < this.loadSubArt.length; i++) {
      this.loadSubArt[i].color = col(i === this.sel ? 0xffffff : 0x93aab4)
    }
    for (let i = 0; i < this.loadWpnArt.length; i++) {
      this.loadWpnArt[i].color = col(i === this.wsel ? 0xffffff : 0x93aab4)
    }

    // ---- 底部两键 ----
    const btn = (which: 'back' | 'go', label: string, primary: boolean) => {
      const r = this.loadBtnRect(which)
      const hov = this.loadHover === which
      const accent = primary ? UI.cyan : UI.cyanDim
      if (hov) {
        g.line(accent, 0.12, 3); g.strokeRoundRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12, 15)
      }
      g.fill(hov ? UI.panelHi : UI.panel, 0.95)
      g.fillRoundRect(r.x, r.y, r.w, r.h, 12)
      g.line(hov ? UI.cyanHi : accent, hov ? 1 : 0.85, hov ? 2 : 1.5)
      g.strokeRoundRect(r.x, r.y, r.w, r.h, 12)
      g.line(UI.cyanHi, hov ? 0.5 : 0.28, 2)
      g.strokeSeg(r.x + 10, r.y + 5, r.x + 10 + r.w * 0.28, r.y + 5)
      line(r.x + r.w / 2, r.y + r.h / 2, label, primary ? 22 : 18,
        hov ? '#ffffff' : (primary ? TXT_LIGHT.main : TXT_LIGHT.dim), 'center')
    }
    btn('back', '返 回', false)
    btn('go', '确 认 出 击', true)

    line(x0 + 40, y0 + PH - 22, 'Esc 或点面板外 = 返回主界面', 14, TXT_LIGHT.mute)
  }

  /**
   * 卡片立绘异步到达。
   *
   * 与 `syncHeroArt()` 同一模式：每帧对一次 key，命中就 `return`。
   * 潜航器用的是**船坞里同一张贴图** `sub_<id>`；武器用商店那张 `item_<id>`。
   *
   * ⚠️ 潜航器缩放走 **`SUB_DISC_CARD / (2 * SUB_ART_R)`**（按圆盘半径）——
   *    与船坞、战斗内三处同源。按整体缩放会让三台在卡片里差一倍。
   */
  private syncLoadArt(): void {
    for (let i = 0; i < this.loadSubArt.length; i++) {
      const a = this.loadSubArt[i]
      if (a.node.active) continue
      const key = 'sub_' + SUBS[i].id
      const sf = this.art.get(this.art.has(key) ? key : 'sub_body')
      if (!sf) continue
      a.spriteFrame = sf
      const ut = a.node.getComponent(UITransform) ?? a.node.addComponent(UITransform)
      ut.setContentSize(sf.originalSize.width, sf.originalSize.height)
      const k = SUB_DISC_CARD / (2 * SUB_ART_R)
      a.node.setScale(k, k, 1)
      a.node.active = true
    }
    for (let i = 0; i < this.loadWpnArt.length; i++) {
      const a = this.loadWpnArt[i]
      if (a.node.active) continue
      const sf = this.art.get('item_' + START_WEAPONS[i])
      if (!sf) continue
      a.spriteFrame = sf
      a.node.active = true
    }
  }

  /** 关面板。`modal` 必须一起清 —— 否则关了面板整个主界面还是点不动。 */
  private closeLoadout(): void {
    if (this.loadRoot) { this.loadRoot.destroy(); this.loadRoot = null }
    this.gLoad = null
    this.loadText = null
    this.loadCards = null
    this.loadSubArt = []
    this.loadWpnArt = []
    this.loadHover = null
    this.loadFocus = 'sub'
    this.modal = null
  }

  /** 确认出击：把选中的两项交给 `DiveGame`。先关面板再回调（否则 modal 挡着）。 */
  private launch(): void {
    if (!this.loadRoot) return
    const sub = SUBS[this.sel].id
    const wpn = START_WEAPONS[this.wsel]
    this.closeLoadout()
    this.cb.onStart(sub, wpn)
  }

  /** 「出击准备」是否开着（DiveGame 的键盘分支要靠它决定 Enter / Esc 的语义）。 */
  get loadoutOpen(): boolean { return this.loadRoot !== null }

  // -------------------------------------------------------------------------
  // 每帧
  // -------------------------------------------------------------------------
  update(dt: number): void {
    if (!this.root.active) return
    this.t += dt
    this.layout(false)
    this.syncBgArt()
    // 船坞待机动画：只写 setPosition / angle / opacity，不重画几何（常驻界面不每帧重画）
    this.stepDiver(dt)

    // 背景整图挂上后，矢量装饰层已隐藏 —— 跳过它们的每帧重绘（否则白算一屏几何）
    if (!this.bgKey) {
      // 探照灯摇曳：整体透明度低频正弦 + 轻微横移，像水面透下来的光在动
      this.coneOpacity.opacity = Math.round(255 * Math.min(1, Math.max(0, 0.72 + 0.28 * Math.sin(this.t * 0.5))))
      this.coneNode.setPosition(Math.sin(this.t * 0.28) * 14, 0)

      // 水母：缓慢上浮，飘出顶部就回到底部随机横位
      for (const j of this.jellies) {
        const p = j.node.position
        // web 里 vy 为负 = 向上；Cocos 的 y 轴向上，所以这里取负号
        const ny = p.y - j.vy * dt
        if (ny > this.H + 120) {
          j.node.setPosition(70 + Math.random() * Math.max(20, this.W - 140), -120)
        } else {
          j.node.setPosition(p.x + Math.sin(this.t * 0.6 + j.t) * j.sway * 0.02, ny)
        }
      }

      // 浮游微粒
      if (this.motes.length === 0) {
        for (let i = 0; i < 40; i++) {
          this.motes.push({
            x: Math.random() * this.W,
            y: Math.random() * this.H,
            r: 0.8 + Math.random() * 1.4,
            vy: -3 - Math.random() * 10,
          })
        }
      }
      this.gMotes.clear()
      for (const m of this.motes) {
        m.y += m.vy * dt
        if (m.y < -4) { m.y = this.H + 4; m.x = Math.random() * this.W }
        this.gMotes.fill(0xffffff, 0.35)
        this.gMotes.fillCircle(m.x, m.y, m.r)
      }
    }

    // 扫描线：整层平移，移过一个周期就跳回
    this.scanNode.setPosition(0, (this.t * 9) % scanSpan(this.H))

    // toast 淡出（最后 0.6s）
    if (this.toastT > 0) {
      this.toastT -= dt
      if (this.toastLabel) {
        const o = Math.max(0, Math.min(1, this.toastT / 0.6))
        this.opacityOf(this.toastLabel.node).opacity = Math.round(o * 255)
      }
    }

    this.syncHeroArt()
    this.syncLoadArt()
    this.syncIcons()
    this.syncBgArt()
    this.updateFooter()
  }

  /**
   * 主形象立绘异步到达 / 切换潜航器时更新。
   *
   * 每帧对一次即可（直接比 key，命中就 return）：标题界面会停留很久，但一次比较的
   * 代价可以忽略；反过来"只挂一次"会在美术后到位时永远显示不出图。
   *
   * ⚠️ 缩放走 **`HERO_DISC / (2 * SUB_ART_R)`**（按**圆盘半径**），不是按贴图整体 ——
   * 否则三台会因突出件不同而大小不一（§9.4 已写死这条）。
   */
  private syncHeroArt(): void {
    const art = this.heroArt
    if (!art) return
    const want = 'sub_' + SUBS[this.sel].id
    const useKey = this.art.has(want) ? want : (this.art.has('sub_body') ? 'sub_body' : '')
    if (!useKey) return
    if (art.node.active && this.heroKey === useKey) return
    const sf = this.art.get(useKey)!
    art.spriteFrame = sf
    const ut = art.node.getComponent(UITransform) ?? art.node.addComponent(UITransform)
    // ⚠️ 用 **`originalSize`**（未裁剪的整张画布），**不是 `rect`**。
    // 素材 meta 是 `trimType: auto` ⇒ `rect` 是裁剪后的；而 `trim=false` 时引擎按
    // 整张画布定标 ⇒ 用 `rect` 会**非等比拉伸**（实测横向压掉 35%，已记在项目记忆里）。
    ut.setContentSize(sf.originalSize.width, sf.originalSize.height)
    const k = HERO_DISC / (2 * SUB_ART_R)
    art.node.setScale(k, k, 1)
    art.node.active = true
    this.heroKey = useKey
  }

  /**
   * 图标异步到达：拿到图就换上。
   *
   * key 规则 `'icon_' + MenuEntry.icon`，与 `shared/uiArt.ts` 的 id **必须字面一致** ——
   * 对不上的症状是"某个入口没有图标"，**它不报错**，只会安静地留一个空槽位。
   */
  private syncIcons(): void {
    const jobs: Array<[Sprite, UiIconId | undefined]> = [
      ...this.entries.map(it => [it.art, it.e.icon] as [Sprite, UiIconId | undefined]),
      ...this.tools.map(t => [t.art, t.e.icon] as [Sprite, UiIconId | undefined]),
    ]
    for (const [art, id] of jobs) {
      if (!id || art.node.active) continue
      const sf = this.art.get('icon_' + id)
      if (!sf) continue
      art.spriteFrame = sf
      art.node.active = true
    }
  }
}
