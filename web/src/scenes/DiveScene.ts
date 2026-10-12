/**
 * 波次制下潜场景（V6 核心玩法 / S2 垂直切片）
 *
 * 对应《项目计划书》V6 §3-§4、《美术资源计划》V4 §2-§4、《UI规格》V3 §5。
 *
 * ---------------------------------------------------------------------------
 * 这一版要验证的只有两件事（其余都是次要的）
 * ---------------------------------------------------------------------------
 *   ① 单波战斗自己玩起来爽不爽（30 秒可判断）
 *   ② 氧气条有没有让人产生"要不要去捡那个气泡"的犹豫
 *
 * 这两条不成立，后面 5 层 / 8 武器 / 30 道具全是白做（立项书 §10 止损线）。
 *
 * ---------------------------------------------------------------------------
 * S2 相对 S1 的增量：把「下潜 / 上浮」这个 V6 唯一的结构决策做出来
 * ---------------------------------------------------------------------------
 * S1 只有 1 层 4 波，氧气只是一条会下降的条——玩家判断不了 V6 成立与否，
 * 因为 V6 真正的张力是**每层末的二选一**：
 *
 *      继续下潜（赌）：扣下潜门票氧气，上限被压缩，耗氧更快，但收益倍率 +0.5
 *      上浮兑现（收）：立刻结算，带走 100% 生物质 × 当前倍率
 *
 * 没有这个选择，「氧气四合一」退化成一根换皮血条。所以 S2 必须做完它。
 *
 * ---------------------------------------------------------------------------
 * 与旧 ExploreScene 的关系
 * ---------------------------------------------------------------------------
 * ExploreScene 是 V5 的"下潜探索 + 捕捞"玩法（6000px 纵向世界 + 视野遮罩），
 * 已被 V6 立项书废弃。本场景不复用它的世界与遮罩逻辑，改为**固定竞技场**：
 *   - 场地 = 当前视口，无滚动
 *   - 视野遮罩取消。V6 要求同屏敌人全部可读，黑暗遮罩会毁掉 gameplay 信息
 *     （见《美术资源计划》V4 §2「分层可见度模型」）
 * 保留的是：neon 三层发光绘制、色相隔离、双渲染器兼容（不用 WebGL-only API）。
 */

import Phaser from 'phaser'
import { UI, TXT, FONT, MONO, MENU } from '../config/theme'
import { SUBS, getSub, SUB_ART, SUB_ART_R, type SubDef, type SubId } from '../config/subs'
import { ITEM_ART } from '../config/itemArt'
import { neon, neonCircle, neonLine, glowPool } from '../render/neon'
import { registerUiHit, routeDown, routeMove } from '../ui/hitRouter'
// 五层环境背景（混元生成 → 去水印 → WebP q82）。
//
// 关键设计约束：**背景图里不允许有任何生物**。
// 之前把成群水母画进背景图，结果一屏 40 只静止水母立刻变成壁纸贴纸——
// 真实感来自动作，静态图只有一帧，做不出"活"。
// 所以这里分工明确：静态图只给「地貌 + 光柱 + 悬浮泥沙」，
// 所有生物（远景剪影、伞盖脉冲、触须摆动）全部在 drawEnvDrift() 里用矢量实时驱动。
// 另一层好处：零生物贴图，背景体积 862KB → 378KB。
import BG_L1 from '../assets/env/L1.webp'
import BG_L2 from '../assets/env/L2.webp'
import BG_L3 from '../assets/env/L3.webp'
import BG_L4 from '../assets/env/L4.webp'
import BG_L5 from '../assets/env/L5.webp'

const ENV_BG = [BG_L1, BG_L2, BG_L3, BG_L4, BG_L5]

// ---------------------------------------------------------------------------
// 具象贴图（V6.4）
// ---------------------------------------------------------------------------
// 为什么必须配「边缘光」：素材是深黑机体 + 内部青光，
// 叠到同样深的深海背景上会整体消失（实测过：合成预览里只剩一个青色小点）。
// 解法不是把贴图调亮（会丢掉"深色酷炫"），而是在运行时沿轮廓描一圈 rim light——
// 深色贴图 + 高亮边缘 = 任何背景上都可读。这是《挺进地牢》《Darkest Dungeon》的常用手法。
import SUB_TEX from '../assets/sub/sub_body.png'
import W_GUN_TEX from '../assets/weapons/gun.png'
import W_TORP_TEX from '../assets/weapons/torpedo.png'
import W_ARC_TEX from '../assets/weapons/arc.png'
import F_SWARM_TEX from '../assets/fish/swarm.png'
import F_DRIFT_TEX from '../assets/fish/drift.png'
import F_DASH_TEX from '../assets/fish/dash.png'

/**
 * ============================================================================
 * 炮塔座圈（V6.10 重做：矩形四点 → 圆形座圈）
 * ============================================================================
 *
 * V6.6~V6.9 的布局是「4 个矩形挂载点 (±0.26, ±0.46)」+「每座最多双联」，
 * 塔本身是一个 38×26 的**长条矩形**，靠四角卡榫表达"可拆换"。
 * 它踩过两个坑，都记在这里以免改回去：
 *
 *   坑① 矩形塔会随索敌相对艇身旋转最多 ±60°，旋转后半投影变成
 *        19·sin60 + 13·cos60 ≈ 23px，异舷两塔必须留 46px 才不碰 ——
 *        于是挂载点被迫推到 ±0.46，代价是"塔心离艇身中心 24px，
 *        看起来像浮在机体外面的独立零件"。
 *   坑② 双联（同一座塞两根管）需要额外的连接梁 + 缩到 0.52 倍，
 *        剪影复杂度直接翻倍，满 6 台时艇身糊成一团。
 *
 * V6.10 改成**圆形座圈**之后，这两个坑从根上消失：
 *
 *   · **圆是旋转不变的**。塔座半径恒为 TURRET_R，无论转到哪个角度，
 *     半投影都是 TURRET_R。不需要"按最坏角度算间距"，也就不需要把座推远。
 *   · 座圈半径 SEAT_RING_R 只受"相邻座不重叠"约束：
 *     弦长 = 2·R·sin(π/n)，6 座时 2·40·sin30° = 40 > 2·14 = 28，留 12px 富余。
 *   · 双联概念整个删掉。第 5、6 台就是座圈上**多一个座**，
 *     画一个稍大的外环 + 琥珀卡榫表示"这是扩容解锁出来的座"，
 *     不再需要在同一座上并两根管 + 画连接梁。
 *
 * 座圈角度刻意**避开艏（0°）与艉（180°）**：
 * 艏要留给探照灯锥（它是玩家的朝向指示，V4 §3.1 规则③），
 * 艉要留给推进器尾焰。所以 6 个固定座位是 ±30° / ±90° / ±150°，
 * 前 4 座取 ±30 与 ±90（左右对称、艏艉全空），第 5、6 座才填 ±150。
 */
const SEAT_ANGLES_DEG = [30, -30, 90, -90, 150, -150]

/** 座圈半径（px，机体中心到塔座中心）。
 *  V6.10 从 40 提到 42：塔座半径同时从 14 提到 16（用户"体积还是太小"），
 *  相邻座 60° 的弦长 = 2×42×sin30° = 42，需要 2×16×1.15 = 36.8，富余 5.2px。 */
const SEAT_RING_R = 40
/** 圆形塔座半径（px）—— 座与座不重叠的判据是 2·R·sin(π/n) > 2·TURRET_R */
const TURRET_R = 12
/** 发射器（插在塔座上的那件武器）基准尺寸。略大于塔座 —— 炮管探出座圈是正常的 */
const EMITTER_SIZE = 14
/**
 * 发射器转塔的**角速度上限**（弧度/秒）—— V6.26。
 *
 * 有了独立索敌之后，换目标时炮口要转过去。瞬间"啪"地弹到新角度看起来像贴图错位，
 * 所以让它真的**转**过去；16 rad/s ≈ 2.5 圈/秒，180° 掉头约 0.2s：
 * 长到看得见转向（"发射器在施法"），短到来得及打中正在游走的鱼。
 * 这个值只管"转多快"，不影响"打谁"——后者是每帧重算的最近目标。
 */
const TURRET_SPIN = 16

/**
 * 潜艇显示尺寸（px）。
 *
 * V6.6 从 59×31 放大到 99×52。
 */
/**
 * 机体显示尺寸（V6.13：从横长潜艇改为**圆形装置**）。
 *
 * 用户原话：「我说的就是这个 sub_body.png 要做成非黑色的圆形的装置」。
 * 旧贴图是横长的深色潜艇（平均亮度仅 54），而且 AI 还在艇身上画了 4 个炮座
 * + 4 根天线，和代码画的装载器位置完全错位、两套叠在一起 —— 这就是用户
 * 反复说的"方形黑炮塔、什么都镶嵌在身边太丑"。
 *
 * 现在换成 AI 重新生成的**正圆装置**（银白 + 苍青、中央发光核心、无任何武器），
 * 装载器 / 发射器全部由代码画，位置与造型完全受控；机体**等比显示**，
 * 不再有 99×52 那种把素材拉扁的非等比缩放。
 *
 * ⚠️ V6.20 起这是**圆盘本体的直径**，不是贴图显示尺寸 ——
 * 三台潜航器的贴图各带不同的突出件（刺鳐有撞角和散热鳍），
 * 贴图画布大小一样、但圆盘占比不同。处理脚本已把三张的**圆盘半径统一成
 * `SUB_ART_R`**，所以这里直接用 `setScale(SUB_D / (2 * SUB_ART_R))`，
 * 保证三台机体在屏幕上一样大、边缘光环永远贴着机体。
 */
const SUB_D = 88

/** 挂载座硬上限（座圈上 6 个固定座位，靠商店卡从 4 解锁到 6） */
const MAX_SEATS = 6
/** 开局座数 = 4（= 前 4 个座位 ±30 / ±90）。商店卡解锁到 5、6 */
const BASE_SEATS = 4

/**
 * ============================================================================
 * 商店刷新定价
 * ============================================================================
 *
 * 刷新是"用钱换选择权"，必须递增，否则钱多的时候可以无限刷到想要的卡，
 * Build 多样性就没了。8 起、每次 +6：一波攒的 40 币大概够刷两三次，
 * 再多就要牺牲一张卡的钱 —— 这个取舍才是刷新该有的代价。
 */
const REROLL_BASE = 8
const REROLL_STEP = 6

/** 全场唯一近白：鱼骨与受击闪白专用，在混乱中最先被看见（V4 §3.3） */
const WHITE = 0xffffff
/** 鱼骨色：冷白微青。比 WHITE 略偏青，让骨架在暖色/紫色生物里也能跳出来 */
const BONE = 0xdcfffb

// ---------------------------------------------------------------------------
// 氧气基础数值（V6 §4.2）
// ---------------------------------------------------------------------------
const O2 = {
  max: 100,           // L1 基准上限（绘制用的分母）
  // 鱼骨消失方式（V6.4 用户需求③）：**不是凭空消失**，而是沉到屏幕下缘后原地淡出。
  // 原来的 6 秒硬消失会像 bug——玩家会以为是自己漏捡了。
  //
  // V6.23 把这三个值一起调紧了（26→42 / 54→46 / 1.6→1.0）：
  // 旧值下"没来得及捡"几乎不会发生 —— 骨头慢慢飘到你脚边、还能躺 1.6 秒等你，
  // 等于没有损失。现在沉得快、躺得短，"够不着"才真正变成一个会发生的负反馈。
  boneSinkV: 42,      // 下沉终端速度（px/s）
  boneFloor: 46,      // 沉底深度（距屏幕下缘），到这里停止下沉
  boneFade: 1.0,      // 沉底后原地淡出时长（秒）
  boneBlink: 0.9,     // 淡出末段的闪烁频率提示
  pickupR: 31,        // 拾取半径（V6.23：34→31，配合磁吸削弱一起收紧"顺手就捡到"）
  burstCost: 20,      // 排气爆发消耗
  burstCd: 12,        // 排气爆发冷却
  burstR: 250,        // 排气爆发半径
}

/**
 * 鱼骨的两条曲线**必须分开**（V6.23）。
 *
 * 旧版一根鱼骨同时决定"回多少氧"和"值多少钱"，于是想收紧氧气就必然连带
 * 砍掉商店经济 —— 但这两件事的目标是相反的（氧气要稀缺，钱要给得起）。
 * 拆成 `o2` / `coin` 之后就能只动氧气那一半：
 *
 *   全捡（理论最优）：L1 1.28× → L2 1.22× → L3 1.12× → L4 1.03× → L5 0.98×
 *     —— 连"一个也不漏"都只能勉强不亏，深潜层更是净亏。
 *   常规走位（约 6~7 成拾取率）：0.83 → 0.79 → 0.73 → 0.67 → 0.64
 *
 * 上面这组数就是「要不要去捡」能不能成立的唯一判据，改之前先重算一遍。
 */
const BONE_O2 = {
  /** 回氧基数（普通鱼 size=30 → 5 氧；Boss 单独给 24）。旧版等效是 7 */
  o2Base: 3.0,
}

const PLAYER = {
  speed: 220,
  // V6.6：机体显示尺寸从 59×31 放大到 99×52，碰撞半径同步 16 → 20。
  // 刻意**不到**视觉半宽（26）：判定比视觉略宽容，玩家不会觉得"明明躲开了却挨打"。
  // 敌人也从 11~20 放大到 14~25，两边同时放大，接触频率大致持平。
  r: 20,
  dmg: 12,
  cd: 0.42,           // 声呐脉冲发射间隔（秒）
  range: 420,         // 脉冲最大半径（射程）
  pulseSpeed: 620,    // 波前扩散速度 px/s
  pulseWidth: 26,     // 波前判定厚度（越厚越容易扫中）
  pierce: 1,          // 「声呐功率」：每级给脉冲 +55 射程
  killO2: 0,          // 击杀额外回氧（被动「循环鳃」加这个）
}

// ---------------------------------------------------------------------------
// 器械定义表（V6.3）
// ---------------------------------------------------------------------------
/**
 * 四台器械的定位刻意互不重叠，这样 build 选择才有意义：
 *   声呐   群体 AOE、贴脸才快   —— 扎进鱼群的主力
 *   机关枪 高频单体、伤害稳定   —— 通用 dps
 *   鱼雷   低频追踪、范围爆炸   —— 清成堆的敌人
 *   电弧   瞬发连锁、多目标     —— 敌人分散时的收割
 * 三台同开 ≈ 一整片弹幕，但玩家仍然只操作走位。
 */
const WEAPON_DEF: Record<WeaponId, {
  name: string; desc: string
  iv: number; dmg: number; range: number; color: number
}> = {
  sonar:   { name: '声呐共振',   desc: '环形波前 · 群体伤害', iv: 0.42, dmg: 12, range: 420, color: UI.cyanHi },
  gun:     { name: '脉冲机关枪', desc: '高频连射 · 单体',     iv: 0.11, dmg: 7,  range: 520, color: UI.amber },
  torpedo: { name: '追踪鱼雷',   desc: '低频追踪 · 范围爆炸', iv: 1.50, dmg: 30, range: 620, color: UI.danger },
  arc:     { name: '链式电弧',   desc: '瞬发连锁 · 多目标',   iv: 0.90, dmg: 16, range: 460, color: UI.violet },

  // —— 进化形态（V6.17）：每条都**换机制**，不是加数值 ——
  // 加特林把"射程"换成"射速"：dps 更高但只能贴身打，逼玩家改变站位。
  gun_gl:   { name: '加特林',   desc: '射速翻倍 · 射程腰斩', iv: 0.052, dmg: 6,  range: 260, color: UI.amber },
  // 霰弹把"单体连射"换成"一次 5 弹扇形"：从点杀变面压，近身收益极高
  gun_sg:   { name: '霰弹散射', desc: '一次 5 弹扇形 · 近距', iv: 0.44, dmg: 5,  range: 250, color: UI.amber },
  // 集束把"单发高伤"换成"三枚分摊"：总伤更高但需要目标成团才划算
  torp_cl:  { name: '集束鱼雷', desc: '一次 3 枚 · 覆盖面',  iv: 1.75, dmg: 15, range: 620, color: UI.danger },
  // 重型把"频率"换成"单发质量"：伤害 ×2.3、爆炸半径 ×1.5，但更慢
  torp_hv:  { name: '重型鱼雷', desc: '单发重击 · 爆炸更大', iv: 2.40, dmg: 70, range: 660, color: UI.danger },
  // 过载把"链长"拉满：跳跃 +4 且不再按跳数衰减
  arc_ov:   { name: '过载电弧', desc: '跳跃 +4 · 不衰减',    iv: 1.05, dmg: 15, range: 500, color: UI.violet },
  // 雷暴放弃"链式"，改成一次电击射程内**全部**敌人 —— 清群但单体弱
  arc_st:   { name: '定点雷暴', desc: '一次电击全部目标',    iv: 2.30, dmg: 12, range: 430, color: UI.violet },
  // 共振把"纯伤害"换成"命中后溅射" —— 真正的清群质变（计划书点名的流派）
  sonar_rs: { name: '共振炮',   desc: '命中后向邻近弹射',   iv: 0.55, dmg: 9,  range: 420, color: UI.cyanHi },
  // 聚焦把"全向"换成"短距高伤"：射程腰斩、伤害 ×2.5，逼玩家贴近打
  sonar_fc: { name: '定向聚焦', desc: '短距强波 · 高伤',    iv: 0.62, dmg: 30, range: 250, color: UI.cyanHi },

  // —— V6.18 新增三种基础武器（计划书 §5.2 的武器表）——
  // 三种都是**操作要求不同**，不是数值不同：
  //   鱼叉：穿透 + 把鱼**拉过来**（钩枪），逼你"勾到身边再打"
  //   回声：延迟爆发，逼你**预判**鱼会去哪（唯一需要算提前量的武器）
  //   酸液：在地上留一滩持续伤害区，逼你**引导**鱼群走进酸里（唯一的阵地武器）
  harpoon: { name: '穿透鱼叉', desc: '直线穿透 · 命中拉拽', iv: 0.75, dmg: 20, range: 520, color: UI.jade },
  echo:    { name: '回声炮',   desc: '延迟爆发 · 需预判',   iv: 1.50, dmg: 40, range: 480, color: UI.magenta },
  acid:    { name: '酸液喷射', desc: '地面持续伤害区',      iv: 1.40, dmg: 6,  range: 380, color: UI.jadeHi },
}

// ---------------------------------------------------------------------------
// 属性系统（V6.8）
// ---------------------------------------------------------------------------
/**
 * 之前玩家的成长数值是**散落的裸字段**（speedMul / pickupMul / o2Bonus /
 * killO2 / twinRate 各写各的），带来三个问题：
 *
 *   1. 每加一个新属性就要新开一个字段 + 手改**每一处**用到它的公式，
 *      漏改一处就是"卡买了没效果" —— 这类 bug 最难查。
 *   2. 卡面只能写"移速 +15%"这种一次性描述，没法回答"我现在总共多少"。
 *   3. 属性有上限时（装甲/闪避不能叠到 100%）每个字段各写各的钳位。
 *
 * 所以收进一个扁平 Stats 对象，约定：
 *   - **百分比类存小数**（0.15 = +15%），渲染时 ×100
 *   - 所有加成型卡走加法（Brotato 的做法），不再 `*= 1.15` 叠乘
 *     —— 叠乘会让后期一张卡的价值滚雪球，前期一张卡又弱得没感觉。
 *   - `cap` 表里声明上限，`addStat()` 统一钳位
 */
interface Stats {
  /** 伤害加成（共振强度） */
  dmg: number
  /** 射速加成（高压供能） */
  rate: number
  /** 暴击率 0~1 */
  crit: number
  /** 暴击倍率（0.8 = 暴击造成 180%） */
  critMul: number
  /** 射程加成（声场延伸） */
  range: number
  /** 减伤 0~1（耐压壳） */
  armor: number
  /** 闪避 0~1（流体规避） */
  dodge: number
  /** 移速加成（增压推进） */
  speed: number
  /** 拾取范围加成（吸附鳍） */
  pickup: number
  /** 打捞运：鱼骨价值加成 */
  luck: number
  /** 每秒回氧（循环泵） */
  regen: number
  /** 氧气上限加成（绝对值，扩容气瓶） */
  o2Bonus: number
  /** 击杀回氧（绝对值，循环鳃） */
  killO2: number
  /** 扩容座（第 5/6 座）射速加成 —— 齐射同步卡 */
  twinRate: number
}

/**
 * 属性上限表。
 *
 * 为什么 armor / dodge 必须封顶：它们是**乘算减伤**，线性叠加到 100% 就是无敌，
 * 而且无敌状态下玩家学不到任何东西 —— 走位、氧气管理全部失去意义。
 * 60% 是 Brotato 的量级：能明显感觉到"我变肉了"，但依然会被打死。
 */
const STAT_CAP: Partial<Record<keyof Stats, number>> = {
  armor: 0.6, dodge: 0.6, crit: 0.75, twinRate: 0.6,
}

/** 开局属性。killO2 的默认 0 意味着"击杀不回氧"是初始设定，靠卡解锁 */
const NEW_STATS = (): Stats => ({
  dmg: 0, rate: 0, crit: 0, critMul: 0.8, range: 0,
  armor: 0, dodge: 0, speed: 0, pickup: 0, luck: 0, regen: 0,
  o2Bonus: 0, killO2: PLAYER.killO2, twinRate: 0,
})

/**
 * 属性的显示元数据。
 *
 * 顺序 = 商店属性面板的排列顺序，刻意把"进攻三件套"排前面：
 * 玩家第一眼看的是"我打得疼不疼"，生存类属性是在被打疼之后才开始关心的。
 */
const STAT_META: Array<{
  k: keyof Stats; name: string; pct: boolean; col: number; icon: string
}> = [
  { k: 'dmg',     name: '共振强度', pct: true,  col: UI.danger, icon: 'dmg' },
  { k: 'rate',    name: '供能速率', pct: true,  col: UI.amber,  icon: 'rate' },
  { k: 'crit',    name: '弱点解析', pct: true,  col: UI.violet, icon: 'crit' },
  { k: 'range',   name: '声场射程', pct: true,  col: UI.cyan,   icon: 'range' },
  { k: 'armor',   name: '耐压壳',   pct: true,  col: UI.jade,   icon: 'armor' },
  { k: 'dodge',   name: '流体规避', pct: true,  col: UI.cyanHi, icon: 'dodge' },
  { k: 'speed',   name: '推进效率', pct: true,  col: UI.cyan,   icon: 'speed' },
  { k: 'pickup',  name: '吸附范围', pct: true,  col: UI.jade,   icon: 'pickup' },
  { k: 'luck',    name: '打捞运',   pct: true,  col: BONE,      icon: 'luck' },
  { k: 'regen',   name: '循环泵',   pct: false, col: UI.cyanHi, icon: 'regen' },
  { k: 'killO2',  name: '击杀回氧', pct: false, col: UI.cyanHi, icon: 'kill' },
]

/**
 * 商店属性卡的 **卡 id → Stats 键** 映射（V6.25）。
 *
 * 卡 id 和统计键不同名（`tank` 对应 `o2Bonus`、`gill` 对应 `killO2`、
 * 其余带 `s_` 前缀），所以不能在卡面里直接按 id 查 STAT_META。
 * 抽成模块级常量是为了让「画符号」和「画进度条」共用同一张表。
 */
const STAT_CARD: Record<string, keyof Stats> = {
  speed: 'speed', pickup: 'pickup', tank: 'o2Bonus', gill: 'killO2',
  s_dmg: 'dmg', s_rate: 'rate', s_crit: 'crit', s_range: 'range',
  s_armor: 'armor', s_dodge: 'dodge', s_regen: 'regen', s_luck: 'luck',
}

// ---------------------------------------------------------------------------
// 遗物（被动道具，V6.8）
// ---------------------------------------------------------------------------
/**
 * 遗物和「属性卡」的区别，以及为什么必须两个都要：
 *
 *   属性卡是**数值**（伤害 +12%），买的过程是"我的共振强度又高了一点"，
 *   是线性的、可预期的，负责让每一波都有东西可买。
 *   遗物是**规则**（低氧时伤害 +50%），它会改变玩家的打法本身 ——
 *   拿到回声心脏之后，"该不该故意留着低氧"变成了每时每刻的决策。
 *
 * 只有属性卡的游戏后 10 分钟会变成纯数值堆叠，只有遗物的游戏则前期没东西买。
 * Brotato 把两者都放进同一个商店、同一个货币，这是它 build 深度的来源。
 *
 * 一半的遗物**带代价**：这是设计的核心。纯增益道具不需要抉择，
 * 只要看到就买；带代价的才会让玩家在商店里停下来算"我这局吃不吃得住"。
 */
const RELIC_SLOTS = 4

type RelicId =
  | 'echo_heart'      // 回声心脏：低氧增伤
  | 'osteoblast'      // 骨殖转化：击杀回氧翻倍，氧气上限 -15
  | 'tidal_compass'   // 潮汐罗盘：拾取 + 鱼骨价值
  | 'resonance_core'  // 共振核心：暴击溅射
  | 'gluttony'        // 贪食腺体：鱼骨 ×2，耗氧 +0.6/s
  | 'abyss_mark'      // 深潜印记：每层 +12% 伤害，敌人 +10% 移速
  | 'current_fin'     // 洋流鳍：3 秒不受击 → 移速 +30%
  | 'silent_plating'  // 静默装甲：受击后 1.5s 闪避 +40%

interface RelicDef {
  id: RelicId
  name: string
  /** 正面效果，一行说完，进卡面 */
  desc: string
  /** 代价。有代价的遗物在卡面上用告警色画，玩家不该被"惊喜"到 */
  cost2?: string
  price: number
  /** 装备瞬间的副作用（改 stats / 上限） */
  onEquip?: (s: DiveScene) => void
}

const RELIC_DEF: Record<RelicId, RelicDef> = {
  echo_heart: {
    id: 'echo_heart', name: '回声心脏', price: 60,
    desc: '氧气低于 30% 时，伤害 +50%',
    cost2: '无代价 —— 但你得敢留在那条线上',
  },
  osteoblast: {
    id: 'osteoblast', name: '骨殖转化', price: 45,
    desc: '击杀回氧 ×2',
    cost2: '氧气上限 −15',
    onEquip: s => s.addStat('o2Bonus', -15),
  },
  tidal_compass: {
    id: 'tidal_compass', name: '潮汐罗盘', price: 40,
    desc: '拾取范围 +80% · 鱼骨价值 +30%',
  },
  resonance_core: {
    id: 'resonance_core', name: '共振核心', price: 66,
    desc: '暴击时向最近的另一只溅射 40% 伤害',
  },
  gluttony: {
    id: 'gluttony', name: '贪食腺体', price: 52,
    desc: '鱼骨价值 +100%',
    cost2: '每秒额外耗氧 +0.6',
  },
  abyss_mark: {
    id: 'abyss_mark', name: '深潜印记', price: 58,
    desc: '每下潜一层，伤害 +12%（跨层累积）',
    cost2: '敌人移速 +10% —— 更深的东西也注意到了你',
  },
  current_fin: {
    id: 'current_fin', name: '洋流鳍', price: 44,
    desc: '连续 3 秒未受击时，移速 +30%',
  },
  silent_plating: {
    id: 'silent_plating', name: '静默装甲', price: 48,
    desc: '受击后 1.5 秒内，闪避 +40%',
  },
}

// ---------------------------------------------------------------------------
// 五层（V6 §3.4）
// ---------------------------------------------------------------------------
/**
 * ★ 氧气收支曲线（V6.23 重算 —— **这是 P0 止损线唯一要守的数，别凭手感改**）
 *
 * 旧版的病根是**供给严重过剩**（实测算出来的，不是估的）：
 *
 *   L1 每层总耗氧 156（1.00/s × 156s），而鱼骨可提供 280 → **供需比 1.79×**
 *   L5 每层总耗氧 468（3.00/s × 156s），鱼骨 640            → **1.37×**
 *
 * 再叠加「软磁吸 81px 自动吸附 + 沉底后 1.6s 宽限」，氧气条永远贴着上限。
 * 结果就是玩家反馈的那句「氧气条没有产生『要不要去捡』的犹豫」——
 * **没有稀缺，就没有取舍**；氧气退化成一根不会掉的换皮血条。
 *
 * 现在的目标：让**捡满也才勉强盈余**，把「拾取率」变成玩家的操作杠杆。
 * 手段是动「鱼骨回氧」这个供给阀门（`BONE.o2Base`），而**不动 dropCap** ——
 * 因为 dropCap 同时是鱼骨币的产出口，动它会连商店经济一起推翻。
 *
 *   全捡（理论最优，实际做不到）：
 *     L1 1.28× → L2 1.22× → L3 1.12× → L4 1.03× → L5 0.98×
 *   常规走位（约 6~7 成拾取率，削弱磁吸后的量级）：
 *     0.83× → 0.79× → 0.73× → 0.67× → 0.64×
 *
 * → 想活就必须**主动绕路去捡**。这就是"犹豫"的落点：
 *   是继续站在安全位置输出，还是离开掩体去够那串骨头。
 *
 * ⚠️ 两个可调阀门（改之前先重算上面这张表）：
 *   · `BONE_O2.o2Base` —— 回氧总供给（现在 3.0，等效普通鱼 5 氧；旧版是 7）
 *   · `updateBones` 里的磁吸倍率 —— 决定"拾取率"能到多少（现在 1.7×，旧版 2.4×）
 *   注意这两者是**乘算关系**：一起收紧会把深层直接压成不可能。
 *
 * ⚠️ 改 LAYER_WAVES 时每层 4 波的总时长必须各自保持 **156s**，
 *   否则每层的耗氧总量会跟着变，上面这张表就失效了。
 */
interface LayerDef {
  name: string
  sub: string
  /** 本层核心机制的短名（HUD 小标签 + 入场卡标题）。空串 = 本层无额外机制 */
  mech: string
  /** 机制的一句话解释（入场卡副标题） */
  tip: string
  o2Max: number     // 氧气上限（越深越窄）
  drain: number     // 每秒耗氧
  dropCap: number   // 每波掉落总量上限（硬约束 ②）—— 单位是**鱼骨币**，回氧与它解耦
  toll: number      // 下潜门票（从氧气里扣；最后一层为 0）
  vis: number       // 环境可见度 0~1（V4 §2.2）
  depthTop: number  // 层顶深度（米）—— HUD 实时深度显示 + 下潜过渡插值用
  depthBot: number  // 层底深度（米）
  /** 热泉上升流（px/s²，L4）。**是加速度不是速度偏移** —— 见 movePlayer */
  ventPush: number
  /** 暗流强度（px/s²，L2）。方向随时间缓慢旋转；敌人吃满、玩家吃一半 */
  current: number
  /** 每波开始再压缩的氧气上限比例（0.06 = 再压 6%，L5）。压力型耐力层用 */
  pressure: number
  /** 涌流：本层敌人全部从**同一侧**涌入，逼玩家先选好退路（L3） */
  surge: boolean
  tint: number      // 环境主色（与 UI 色解耦，UI规格 §5.1）
  motes: number     // 漂浮颗粒数量
  hpMul: number     // 敌人血量倍率
  cntMul: number    // 敌人数量倍率
  dashMul: number   // 冲刺型占比倍率
  driftRatio: number// 水母型占比
}

const LAYERS: LayerDef[] = [
  // L1 阳光带：教学层，**不给机制** —— 先把「游动 / 开火 / 捡骨」三件事练顺
  { name: '阳光带', sub: 'SUNLIT', mech: '', tip: '没有额外机制 —— 先把手感练顺',
    o2Max: 100, drain: 1.00, dropCap: 70,  toll: 15, vis: 1.00, depthTop: 0,     depthBot: 200,
    ventPush: 0,  current: 0,  pressure: 0,    surge: false, tint: 0x2a6f8a, motes: 34,  hpMul: 1.00, cntMul: 1.00, dashMul: 0.5, driftRatio: 0.00 },
  // L2 弱光带：**暗流** —— 水流在缓慢旋转，鱼群和你都被带偏，站位不再"放好就不动"
  { name: '弱光带', sub: 'TWILIGHT', mech: '暗流', tip: '水流在缓慢旋转，鱼群和你都会被带偏',
    o2Max: 100, drain: 1.35, dropCap: 90,  toll: 20, vis: 0.80, depthTop: 200,   depthBot: 1000,
    ventPush: 0,  current: 34, pressure: 0,    surge: false, tint: 0x1d5a5a, motes: 48,  hpMul: 1.35, cntMul: 1.25, dashMul: 1.0, driftRatio: 0.12 },
  // L3 午夜带：**涌流** —— 所有敌人同侧涌入，被包围就再也挤不出去，逼你先选退路
  { name: '午夜带', sub: 'MIDNIGHT', mech: '涌流', tip: '它们从同一个方向压上来 —— 退路只有一条',
    o2Max: 85,  drain: 1.80, dropCap: 110, toll: 25, vis: 0.40, depthTop: 1000,  depthBot: 4000,
    ventPush: 0,  current: 0,  pressure: 0,    surge: true,  tint: 0x14203c, motes: 70,  hpMul: 1.80, cntMul: 1.50, dashMul: 1.1, driftRatio: 0.18 },
  // L4 热泉带：**热泉**（沿用 V6 已有的 ventPush）—— 没有地方能稳稳停住
  { name: '热泉带', sub: 'HYDROTHERMAL', mech: '热泉', tip: '上升的热流会顶开你 —— 停不住',
    o2Max: 70,  drain: 2.40, dropCap: 135, toll: 30, vis: 0.25, depthTop: 4000,  depthBot: 6000,
    ventPush: 190, current: 0, pressure: 0,   surge: false, tint: 0x3a1a10, motes: 90,  hpMul: 2.40, cntMul: 1.80, dashMul: 1.2, driftRatio: 0.15 },
  // L5 深渊带：**压力** —— 每过一波上限再被压掉 6%，拖得越久容错越小，必须速决
  { name: '深渊带', sub: 'THE ABYSS', mech: '压力', tip: '每过一波，舱体再压掉一截氧气上限',
    o2Max: 60,  drain: 3.00, dropCap: 160, toll: 0,  vis: 0.10, depthTop: 6000,  depthBot: 11000,
    ventPush: 0,  current: 0,  pressure: 0.06, surge: false, tint: 0x0a0614, motes: 110, hpMul: 3.20, cntMul: 2.10, dashMul: 1.3, driftRatio: 0.22 },
]

/** 一波的形状：数量 / 冲刺占比 / 血倍率 / 时长 */
interface WaveShape {
  count: number
  dashRatio: number
  hpMul: number
  dur: number
}

/**
 * 每层 4 波的**节奏签名**（V6.23 从"全局一张表"拆开）。
 *
 * 拆之前 5 层共用同一张 `WAVE_SHAPE`，玩家换层只感觉到"同样的波变多变硬"——
 * 这正是「每一层可玩性没有差异化」的根因。拆开后每层有自己的**波形**：
 *
 *   L1 缓坡   20→32→44→60  时长 34→38→40→44   数量与时间同步拉长，可预测（教学）
 *   L2 前压   52→42→34→28  时长 44→40→38→34   **第一波就最密最长**，一上来就得选站位
 *   L3 锯齿   44→22→48→26  时长 42→30→46→38   多-少-多-少，波谷才敢出去捡氧
 *   L4 阶梯   30→42→54→60  时长 30→34→40→52   一波比一波密，最后一段最长最狠
 *   L5 耐力   14→26→40→66  时长 46→38→34→38   前三波稀少但硬，末波总攻
 *
 * ⚠️ **每层 4 个 dur 之和必须 = 156s**。耗氧是按时间线性扣的，
 *    改动总时长会直接改掉上面 LAYERS 注释里那张收支表。
 */
const LAYER_WAVES: WaveShape[][] = [
  [ { count: 20, dashRatio: 0.00, hpMul: 1.00, dur: 34 },
    { count: 32, dashRatio: 0.16, hpMul: 1.10, dur: 38 },
    { count: 44, dashRatio: 0.26, hpMul: 1.20, dur: 40 },
    { count: 60, dashRatio: 0.30, hpMul: 1.35, dur: 44 } ],

  [ { count: 52, dashRatio: 0.20, hpMul: 1.00, dur: 44 },
    { count: 42, dashRatio: 0.28, hpMul: 1.10, dur: 40 },
    { count: 34, dashRatio: 0.34, hpMul: 1.20, dur: 38 },
    { count: 28, dashRatio: 0.38, hpMul: 1.35, dur: 34 } ],

  [ { count: 44, dashRatio: 0.34, hpMul: 1.20, dur: 42 },
    { count: 22, dashRatio: 0.28, hpMul: 1.45, dur: 30 },
    { count: 48, dashRatio: 0.42, hpMul: 1.30, dur: 46 },
    { count: 26, dashRatio: 0.38, hpMul: 1.50, dur: 38 } ],

  [ { count: 30, dashRatio: 0.34, hpMul: 1.05, dur: 30 },
    { count: 42, dashRatio: 0.44, hpMul: 1.15, dur: 34 },
    { count: 54, dashRatio: 0.52, hpMul: 1.25, dur: 40 },
    { count: 60, dashRatio: 0.60, hpMul: 1.40, dur: 52 } ],

  [ { count: 14, dashRatio: 0.48, hpMul: 1.20, dur: 46 },
    { count: 26, dashRatio: 0.54, hpMul: 1.30, dur: 38 },
    { count: 40, dashRatio: 0.62, hpMul: 1.35, dur: 34 },
    { count: 66, dashRatio: 0.75, hpMul: 1.50, dur: 38 } ],
]

/** 基础镜头倍率（V6.9 可读性）：Brotato 的「一眼看清」来自角色占屏比例大，
 *  世界坐标不变，把视野缩到 1/1.25 并让镜头始终跟随潜航器。 */
const CAM_ZOOM = 1.25

type Kind = 'swarm' | 'dash' | 'drift' | 'boss'

/**
 * 素材实际基准角补偿（弧度）。
 * **基准值是 π（= Math.PI），不是 0。**
 *
 * 踩过的坑：一度以为贴图「朝右」，只给了 ±0.1 的微调，结果游戏里**鱼尾朝前游**
 * ——玩家一眼就看出来不对（「不是鱼头往前移动吗」）。
 *
 * 实测依据（alpha 质量分布，逐列统计）：三张贴图都是**鱼头朝左**：
 *   swarm 左半质量 6026 / 右半 4116，尾部列高递减到 0
 *   drift 左半 9382 / 右半 3784
 *   dash  左半 2619 / 右半 1016
 * 贴图 rotation=0 时鱼头指向 -X 方向，角度就是 π。
 * 所以绘制时的基准补偿必须是 π，各素材再在此基础上加微调。
 */
const TEX_BASE_ROT: Partial<Record<Kind, number>> = {
  swarm: Math.PI - 0.10,   // 朝左 + 素材略带俯角
  dash: Math.PI + 0.02,
  drift: Math.PI,          // 水母虽俯视对称，实测也是头朝左，同样要补偿
}

interface Enemy {
  x: number; y: number
  vx: number; vy: number
  kx: number; ky: number   // 击退速度（V6.9 打击感），指数衰减，与移动叠加
  hp: number; maxHp: number
  r: number
  kind: Kind
  color: number
  speed: number
  /** chase → charge（红色预警）→ dash → rest */
  phase: 'chase' | 'charge' | 'dash' | 'rest'
  t: number
  dirX: number; dirY: number
  alive: boolean
  flash: number      // 命中闪白计时
  /**
   * 贴图朝向补偿（弧度）。
   *
   * AI 生成的鱼贴图**实际朝向不可控**：prompt 里说"面朝右"，模型可能画成 3/4 视角偏上。
   * 所以 spawn 时用素材实际基准角算一次补偿，绘制时把它减掉，
   * 保证逻辑上的"朝向玩家"在视觉上真的对准。
   */
  texRot: number
  /** 对应的贴图 key */
  tex: string
}

/**
 * 鱼骨：鱼被声呐共振后软组织震散，只剩发光骨架。
 * 缓缓下沉 + 缓慢旋转，玩家必须游过去拾取（硬约束①：不做远程磁吸）。
 */
interface Bone {
  x: number; y: number
  vx: number; vy: number
  /** 淡出计时（秒）。归零后原地淡出消失，**不再凭空消失** */
  fade: number
  /** 回氧量。V6.23 起与 coin 分开 —— 见 BONE 的注释 */
  o2: number
  /** 鱼骨币价值（喂 boneValueMul）。**这条曲线不能动**，dropCap 按它计量 */
  coin: number
  size: number          // 骨架长度（按鱼体大小，大鱼骨更值钱）
  rot: number           // 当前旋转角
  spin: number          // 旋转速度 rad/s
  alive: boolean
}

/**
 * 声呐脉冲：从潜航器发出的一圈向外扩散的波前。
 * 关键手感——波是从「你」身上往外扩的，所以必须贴近鱼群才扫得到，
 * 这就把「多捞几只」和「别被围住」绑成了同一个决策。
 */
interface Pulse {
  x: number; y: number   // 发射点（发射瞬间位置，之后不跟随玩家）
  r: number              // 当前波前半径
  maxR: number           // 最大半径（= 射程）
  dmg: number
  width: number          // 波前判定厚度
  hit: Set<number>       // 已命中（同一条鱼只判定一次）
  alive: boolean
  /** 共振炮（sonar_rs）：波前命中时向邻近敌人溅射（见 updatePulses） */
  resonant?: boolean
}

/** 肉屑：共振时震散的软组织碎片，纯表现层，不参与任何判定 */
interface Debris {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  color: number
  r: number
  alive: boolean
}

// ---------------------------------------------------------------------------
// 器械（V6.3 多武器系统）
// ---------------------------------------------------------------------------
/**
 * 玩家同时挂载最多 3 台器械，各自独立冷却、**同时自动开火**。
 * 这是 Brotato 的核心手感：屏幕上的火力来自多个来源，
 * 玩家的操作仍然只有「走位 + 空格排气」，不引入瞄准（保持轻动作）。
 */
/**
 * 武器 ID。
 *
 * V6.17 起每把基础武器有 **2 条进化分支**（计划书 §5.2「质变密度」）：
 * 进化 = **改机制**（弹数 / 散射 / 链数 / 溅射 / 射程换射速），不是 +X% 伤害。
 * 这是应对"我们做不出 Brotato 数百道具"的唯一手段 —— 用少数但质变的升级，
 * 把 build 空间撑开。
 */
type WeaponId = 'sonar' | 'gun' | 'torpedo' | 'arc'
  | 'gun_gl' | 'gun_sg'        // 加特林 / 霰弹散射
  | 'torp_cl' | 'torp_hv'      // 集束鱼雷 / 重型鱼雷
  | 'arc_ov' | 'arc_st'        // 过载电弧 / 定点雷暴
  | 'sonar_rs' | 'sonar_fc'    // 共振炮 / 定向聚焦
  | 'harpoon' | 'echo' | 'acid'  // V6.18 新增三种基础武器（鱼叉 / 回声 / 酸液）

/**
 * 进化后的 id 归到哪个**基础族** —— `autoFire` 按族分支，族内只改参数。
 * 新加一种武器 = 这里加一行 + autoFire 加一个分支，不动其它。
 */
function weaponFamily(id: WeaponId):
  'sonar' | 'gun' | 'torpedo' | 'arc' | 'harpoon' | 'echo' | 'acid' {
  if (id.startsWith('gun')) return 'gun'
  if (id.startsWith('torp')) return 'torpedo'
  if (id.startsWith('arc')) return 'arc'
  if (id === 'harpoon') return 'harpoon'
  if (id === 'echo') return 'echo'
  if (id === 'acid') return 'acid'
  return 'sonar'
}

/**
 * 商店卡 id → 武器 id 的**修正表**。
 *
 * 绝大多数武器卡是 `w_` + 武器 id（`w_gun` → `gun`），但有两张早期定的卡用了缩写：
 *   `w_torp` → `torpedo`、`w_harp` → `harpoon`。
 * 不做修正的话，这两张卡取到的 id 是 `torp` / `harp`，在 `WEAPON_DEF` 里查不到
 * → `wid = null` → 卡面落到属性分支被画成一根**空仪表**。
 * 也就是说**鱼雷卡和鱼叉卡一直是没有图示的**（V6.21 才发现）。
 */
const CARD_WEAPON_ID: Record<string, WeaponId> = {
  w_torp: 'torpedo',
  w_harp: 'harpoon',
}

/** 基础武器 → 它的两条进化分支（出商店卡用） */
const EVOLUTIONS: Record<string, [WeaponId, WeaponId]> = {
  gun: ['gun_gl', 'gun_sg'],
  torpedo: ['torp_cl', 'torp_hv'],
  arc: ['arc_ov', 'arc_st'],
  sonar: ['sonar_rs', 'sonar_fc'],
}

/** 反查：某个进化形态是从哪把基础武器变来的（商店卡文案要用） */
function evolutionBase(evo: WeaponId | null): WeaponId | null {
  if (!evo) return null
  for (const base of Object.keys(EVOLUTIONS)) {
    if (EVOLUTIONS[base].includes(evo)) return base as WeaponId
  }
  return null
}

interface Weapon {
  id: WeaponId
  iv: number     // 射击间隔（秒）
  timer: number  // 距下次开火的剩余秒数
  dmg: number
  lvl: number    // 等级：每级提升伤害与频率（1..5）
  anchor: number // 只锚定一个敌人时的索敌锚点下标（鱼雷用）
  /** 上一发的**实际间隔**（含等级/齐射/高压供能）—— 装载器画装填进度环的分母。
   *  用基础 `iv` 会让进度环在升级后和实际节奏对不上。 */
  ivLast: number
  /** 开火闪光剩余秒数（0.15s）。"施法过程"要看得见，靠的就是这一帧爆发。 */
  fireFlash: number
  /**
   * 发射器**自己的**世界朝向（弧度）—— V6.26。
   *
   * 为什么要存在武器上而不是每帧现算：发射器和装载器是**两个独立部件**，
   * 发射器自己索敌、自己转塔。旧版把塔角写成
   * `机体朝向 + clamp(目标角 - 机体朝向, ±70°)`，等于把炮的指向**绑在移动方向**上
   * —— 玩家往上走，全船炮口就一起抬到上面，哪怕鱼在下方。
   * 用户原话：「发射器不会选择就近射击，会受上下左右影响…我移动上面就一直射击上面」。
   *
   * 现在这个值由 `slewTurretAims` 每帧逼近"我这座塔最近的目标"，
   * 画塔（drawSub）与出弹（turretPose）**共用同一个值**，
   * 保证"炮口指哪、弹就从哪出"，不会再出现两套角度打架。
   */
  aimAng: number
}

/** 通用弹：机关枪（直线）与鱼雷（追踪）共用 */
interface Bullet {
  x: number; y: number
  vx: number; vy: number
  life: number; dmg: number
  kind: 'gun' | 'torpedo' | 'harpoon'
  hit: Set<number>
  alive: boolean
  /** 爆炸半径倍率：重型鱼雷 1.5、其余默认 1（见 updateBullets 里的 explode 调用） */
  er?: number
}

/**
 * 回声标记（回声炮 V6.18）：落在目标位置，延迟 0.75s 后爆发。
 *
 * 为什么是"延迟"而不是立刻爆：这是全场唯一需要**预判**的武器 ——
 * 要打向敌人**将会去的地方**，而不是它现在的位置。其它武器都是"瞄准即命中"，
 * 只有回声要求玩家读敌人的移动方向。这种"操作要求不同"才是新武器该有的差异。
 */
interface Echo {
  x: number; y: number
  t: number          // 剩余时间，归零即爆
  dmg: number
}

/**
 * 酸液云（酸液喷射 V6.18）：在目标位置持续 3s，每 0.35s 结算一次伤害。
 *
 * 它是全场唯一的**阵地武器** —— 不追人，而是把一块地变成禁区。
 * 配合"敌人朝玩家直冲"的行为，正确用法是把它铺在自己和鱼群之间。
 */
interface Acid {
  x: number; y: number
  r: number
  life: number
  tick: number       // 距下一次伤害结算的剩余时间
  dmg: number
}

/** 电弧折线：瞬发 + 存留 0.18s 的视觉残留 */
interface Arc {
  pts: { x: number; y: number }[]
  life: number
}

/** 鱼雷爆炸的冲击环（纯表现） */
interface Blast { x: number; y: number; r: number; life: number }

/**
 * 冲击波（V6.10 打击/击杀特效的核心件）。
 *
 * ---------------------------------------------------------------------------
 * 为什么必须有它
 * ---------------------------------------------------------------------------
 * V6.9 的打击感只靠三样东西：白闪（setTintFill）、击退位移、掉血飘字。
 * 实机看下来三者**都不够**：
 *
 *   · **白闪太短**。0.09s 的闪白在 60fps 下只有 5~6 帧，而机关枪 0.11s 一发，
 *     于是"闪白"和"下一次闪白"几乎连成一片持续的亮，玩家分辨不出
 *     "刚才那下打到了没有"。
 *   · **击退是位移，不是事件**。敌人被推开 20px 会动，但**为什么动**
 *     不可见 —— 玩家分不清"我打中了"还是"它自己在游"。
 *   · **飘字被禁用之后**（V6.10 取消了敌人小血条，满屏飘字又被去掉了底板），
 *     "我造成了伤害"这件事在敌人身上**不再有任何可见痕迹**。
 *
 * 冲击波补的正是这个洞：它从命中点**向外扩一个可见的圈**，
 * 圈扩到最大就消失 —— 玩家看到的是一个"从这里炸开的动作"，
 * 而不是一个"某处闪了一下"的静态结果。
 *
 * 两条规格刻意不同，因为它们的语义不同：
 *   命中 `hit`  —— 小、快、白。密集但轻，是"节拍器"。
 *   击杀 `kill` —— 大、慢、带色 + 实心闪核。稀疏但重，是"句号"。
 * 全部命中都出大圈会变成满屏涟漪；全部击杀都出小圈则打死了也没有回报感。
 */
interface Shock {
  x: number; y: number
  r: number         // 当前半径
  rMax: number      // 最大半径
  life: number
  maxLife: number
  color: number
  /** 线宽（px），随生命衰减 */
  width: number
  /** 实心闪核半径：命中时一小团白，击杀时是整个尸体炸开的亮斑 */
  core: number
  /** 环的数量：命中 1 圈，击杀 2 圈（内圈延迟半拍，形成"双波"） */
  rings: number
  /** 内圈延迟比例（0 = 与主圈同步） */
  ringDelay: number
}

/**
 * 击打痕（V6.10 打击感补强）。
 *
 * 为什么单有冲击环还不够：环是"从中心向外扩"的，它表达的是**炸开**，
 * 但真实命中首先是"弹头撞上去、火花朝弹道反向溅"。
 * 少了这个方向性，打击感只剩"闪了一下"，没有"被东西打中"的实感。
 *
 * 击打痕就是那条**垂直于弹道方向**的短亮条：
 * 它跟着命中方向摆，所以玩家能从条的朝向反推出"子弹是从哪打过来的"，
 * 加上同心火花，才凑成一次完整的命中。
 *
 * 生命期只有 0.10s：再长就从"击打"变成"划痕"残留，画面会脏。
 */
interface Slash {
  x: number; y: number
  /** 弹道方向（弧度）—— 击打痕与之垂直 */
  ang: number
  len: number
  life: number
  maxLife: number
  color: number
  width: number
}

/**
 * 火花：命中迸溅 / 枪口闪光共用的短命粒子。
 * `ang`/`spd` 决定飞散方向，`kind` 决定画法（'flash' 枪口闪 · 'hit' 命中迸溅）。
 */
interface Spark {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  color: number
  size: number
  ang: number
  kind: 'flash' | 'hit'
}

/**
 * 飘字：拾取 / 回氧 / 波次这类"发生了什么"的即时数字反馈。
 *
 * 用户诉求：「获取鱼骨 氧气增加的飘字」。之前完全没这个系统 ——
 * 捡到鱼骨只是氧气条悄悄涨一点，玩家**不知道自己捡到了什么、加了多少**。
 * 飘字把这个因果变成看得见的事件。
 *
 * 三条设计约束：
 *   ① **上浮 + 淡出**，不是原地消失。上浮符合"气泡往上升"的水下直觉
 *   ② 带 `scalePop`：出生瞬间放大再回落，没有这一下"弹跳"会显得呆板
 *   ③ 同帧多个飘字必须**错开**（stagger），否则叠在一起糊成一团读不出数字
 */
interface FloatText {
  x: number; y: number
  vy: number
  life: number; maxLife: number
  text: string
  color: number
  size: number
  /** 出生后延迟多久才开始上浮（错开同帧多个飘字） */
  delay: number
}

/**
 * 商店卡。
 *
 * `kind` 决定卡面视觉分区（V6.6 新增）：
 *   'weapon' 装/升一台器械 —— 画真实器械图标 + 等级条
 *   'mount'  挂载位扩容 —— 画座/管位示意图，这是"塔升级"的成长线
 *   'surv'   生存/机动 —— 抽象环
 *
 * `maxed` 用于判断这张卡是否还有意义（槽位已满时不再提供扩容卡），
 * 避免出现"买了没效果"的卡 —— 那是商店最伤玩家信任的事。
 */
interface Upgrade {
  id: string
  name: string
  desc: string
  kind: 'weapon' | 'mount' | 'stat' | 'relic'
  /**
   * 售价（鱼骨）。
   *
   * 定价基准：L1 每波掉落上限 70（dropCap），鱼骨单个 value 5~7，
   * 实测拾取率约六成 —— 也就是**一波大约能攒 40 币**。
   * 所以常规定价 22~38（一波买一张还有富余），挂载扩容这种结构性卡 45~70
   * （要攒一波多，是真正的投资）。刷新另算。
   */
  cost: number
  apply: (s: DiveScene) => void
  /** 返回 true 表示这张卡当前无效，不该出现在三选一里 */
  dead?: (s: DiveScene) => boolean
  /** 遗物卡专用：卡面对应的遗物 id（画图标、查代价文案要用） */
  relicId?: RelicId
}

interface Mote { x: number; y: number; r: number; vy: number; vx: number; a: number }

/**
 * 远景生物（纯装饰，永不参与碰撞）。
 *
 * 为什么必须用矢量实时画而不是贴图：
 * 贴图是死的，而**真实感的来源就是动作**。两个动作做到位，剪影就能"活"：
 *   ① 伞盖收缩（pulse）：水母靠收缩伞盖喷水推进，这是它唯一的动力来源；
 *   ② 触须滞后摆动（sway）：触须跟着伞盖走但慢半拍，所以会有拖曳感。
 * 这两个动作一加，剪影就不再是贴纸。
 */
interface DriftLife {
  x: number; y: number
  /** 伞盖半径基准 */
  r: number
  /** 游动方向（弧度） */
  a: number
  /** 移动速度 */
  sp: number
  /** 伞盖收缩相位 */
  ph: number
  /** 触须长度系数 */
  tent: number
  /** 低对比配色，保证绝不与敌人抢注意力 */
  col: number
}

/** UI 合理性审计用的节点登记项（屏幕坐标系，左上角 + 尺寸）。 */
interface UINode {
  kind: 'text' | 'panel' | 'hit'
  x: number; y: number; w: number; h: number
  color?: string      // text/hit 颜色（'#rrggbb'）
  fill?: string       // panel 填充色（用于对比度计算）
  edge?: string       // panel 描边色
  size?: number       // text 字号 px
  text?: string       // text 内容（截断）
  cat?: 'ui' | 'float'  // float = 飘字（瞬态，审计时可剔除）
}

export default class DiveScene extends Phaser.Scene {
  constructor() { super('dive') }

  // ---- 玩家状态 ----
  private px = 0
  private py = 0
  private o2 = O2.max
  private o2Max = O2.max
  private biomass = 0
  /** 朝向（弧度）：艇身朝移动方向，静止时保持上一次 */
  private aim = 0
  private burstTimer = 0
  /**
   * 玩家属性总表（V6.8）。
   *
   * 所有成长数值都收在这里，任何一处要读"玩家现在多强"都走 `st`，
   * 不再有散落的裸字段。详见 `interface Stats` 的注释。
   */
  private st: Stats = NEW_STATS()
  /** 本局选的潜航器（V6.19）。所有加成在 `startRun` 里统一落地，不散在各读取点。 */
  private sub: SubDef = SUBS[0]
  /** 撞击伤害的节流计时（刺鳐）：不加节流会变成每帧狂打同一只鱼 */
  private ramT = 0
  /** 已装备的遗物（被动道具，上限 RELIC_SLOTS） */
  private relics: RelicId[] = []
  /** 连续未受击时长（「洋流鳍」） */
  private noHitT = 0
  /** 受击后闪避加成剩余时长（「静默装甲」） */
  private plateT = 0
  /** 受击闪白计时（氧气被撞时） */
  private hurtFlash = 0
  /**
   * 最后一次受击的来向（单位向量，指向"敌人所在的那一边"）。
   * 用于**方向性暗角**：屏幕那一侧先红，玩家不用看血条也知道该往反方向跑。
   */
  private hurtDirX = 0
  private hurtDirY = 0
  /** 方向性暗角剩余时长（秒） */
  private hurtDirT = 0
  /**
   * 氧气**显示值**，每帧向真实 `o2` 缓动。
   *
   * 为什么需要：氧气既是血条又是计时器，掉得很快。直接打印真实值会让数字
   * 每帧乱跳，玩家读不出"我大概剩多少"。补间后数字是连续滚动的，
   * 掉氧的**速率**也变成可读的视觉信号（滚得快 = 在挨打）。
   */
  private o2Shown = O2.max
  /** 本帧是否在移动（推进器尾焰长度用） */
  private moving = false
  /** 本帧受到的热泉上升推力（HUD 用来提示"正在被顶"，0 = 无） */
  private vpPush = 0
  /** 本层暗流强度（HUD 提示用，0 = 本层无暗流） */
  private vpCur = 0
  /**
   * 「涌流」层的固定入场边（0=上 1=右 2=下 3=左），V6.23 的 L3 用。
   * 在每层第一波时随机定一次、整层不变 —— 玩家能提前看见"它们只从哪来"，
   * 才有"把退路留在另一侧"这个决策。每波随机的话这条机制就等于没有。
   */
  private surgeSide = 0
  /** 层入场卡的剩余显示时长（秒）。下潜过渡开始时置位，之后自然淡出 */
  private layerCardT = 0

  // ---- 实体池 ----
  private enemies: Enemy[] = []
  private bones: Bone[] = []
  private pulses: Pulse[] = []
  private bullets: Bullet[] = []
  private arcs: Arc[] = []
  private blasts: Blast[] = []
  /** 回声标记（回声炮）：延迟爆发的落点 */
  private echoes: Echo[] = []
  /** 酸液云（酸液喷射）：地面持续伤害区 */
  private acids: Acid[] = []
  /**
   * 打击 / 击杀冲击波（V6.10）。
   *
   * 与 `sparks`（细碎火星）的分工：**火花是"溅"，冲击波是"事件"**。
   * 火花多而轻、随机、瞬灭；冲击波少而重、有确定的起点和终点。
   * 满屏只有火花时玩家感觉"打得很热闹但不知道打到了什么"，
   * 加上冲击波之后每一次命中都变成一个可定位的动作。
   *
   * 硬上限 48：机关枪 0.11s 一发 × 6 座 = 约 54 圈/秒，
   * 0.3s 生命期意味着稳态约 16 个；但电弧链击一次能命中 7 个目标，
   * 爆发时瞬时可能翻倍，超了直接丢最老的（和 sparks 同一套策略）。
   */
  private shocks: Shock[] = []
  /**
   * 击打痕（垂直于弹道方向的短亮条）。上限 40：
   * 机关枪 0.11s 一发 × 6 座 ≈ 54 条/秒，0.10s 生命期稳态约 6 条，
   * 但电弧链击一次命中 7 个目标会瞬时翻倍，超了丢最老的。
   */
  private slashes: Slash[] = []
  /**
   * 命中火花 / 枪口闪光。
   *
   * 玩家反馈「发射的子弹不够酷炫」——除了把弹体本身做厚，
   * 还需要**两个瞬间**：开火瞬间的枪口闪光、命中瞬间的火花迸溅。
   * 没有这两个瞬间，射击只是"一条线飞过去"，没有打击感。
   * 火花是短命对象（0.22s），用固定上限数组防爆炸性增长。
   */
  private sparks: Spark[] = []
  /** 飘字（拾取 / 回氧 / 波次提示）。上限 24，超出丢最老的 */
  private floats: FloatText[] = []
  /** 玩家当前挂载的器械（各自独立冷却、同时自动开火） */
  private weapons: Weapon[] = []
  /**
   * 当前可挂载的器械上限。开局 4（= 4 个物理座），靠商店的
   * 「双联挂载 I / II」卡解锁到 5 / 6。
   *
   * 为什么初始不是 6：一开局就满槽会让"拿新武器"这件事没有成长感，
   * 也会让 4 个座上直接挂满双联 —— 艇身剪影会糊成一团。
   */
  private maxWeapons = 4
  private debris: Debris[] = []
  private motes: Mote[] = []
  /** 远景生物（纯装饰，不参与碰撞）—— 见DriftLife 注释 */
  private drift: DriftLife[] = []
  private eid = 0

  // ---- 进度：5 层 × 4 波 ----
  private layerIdx = 0
  private waveInLayer = 0
  /** 收益倍率：每下潜一层 +0.5。上浮结算时乘到生物质上 */
  private mult = 1.0
  /** 本局是否击败 Boss */
  private bossDown = false

  // ---- 波次状态机 ----
  private phase: 'wave' | 'shop' | 'decide' | 'descending' | 'result' = 'wave'
  /** 下潜过渡：进度秒数 / 起止深度（米）/ 时长 */
  private descT = 0
  private descFrom = 0
  private descTo = 0
  private descDur = 2.1
  private waveTimer = 0
  private spawnLeft = 0
  private spawnTimer = 0
  private droppedThisWave = 0
  private win = false

  // ---- 渲染 / 输入 ----
  /** 每层的环境背景图（混元生成）。depth=1，在 gBg 之下被矢量层与暗幕叠加 */
  private bg!: Phaser.GameObjects.Image
  /** 深度显示值（米）：随波次推进递增，下潜过渡时做插值动画 */
  private depthM = 0
  /** 具象潜航器机体（贴图）。depth 在实体层之上，旋转对准移动方向 */
  private subImg!: Phaser.GameObjects.Image
  /** 敌人贴图池（复用，避免每波创建/销毁 70+ 个 Image） */
  private fishPool: Phaser.GameObjects.Image[] = []
  // （V6.6：塔头贴图池 turretImgs / turretTex 已删除。
  //  塔改成「通用挂架 + 可插拔发射器」的矢量绘制，画在 gTurret(depth 62) 上，
  //  不再需要每种武器一张塔贴图 —— 新增武器也不用再生图。）
  private gBg!: Phaser.GameObjects.Graphics    // 环境（被暗幕压暗）
  private gDim!: Phaser.GameObjects.Graphics   // 暗幕（只压环境，不压实体）
  private g!: Phaser.GameObjects.Graphics      // 实体（永远全亮）
  /** 发射塔层：在机体贴图(60)之上、HUD(100)之下 */
  private gTurret!: Phaser.GameObjects.Graphics
  private gHud!: Phaser.GameObjects.Graphics
  /**
   * UI 专用相机（V6.11）。
   *
   * 为什么必须独立：主相机带 CAM_ZOOM=1.25 变焦并跟随玩家，而 Phaser 的
   * `setScrollFactor(0)` 只免疫相机的**滚动**，**不免疫缩放** —— UI 仍会以
   * 屏幕中心为原点被放大 1.25 倍。结果贴在屏幕四周的 HUD 全部被推出可视区
   * （实测视口 1304×749、zoom 1.25 时，左上角深度文字 x 落到 −133，
   * 顶部氧气条 y 落到 −49，底部武器条掉出下缘）。用户原话：
   * 「整个战斗界面很多 UI 是不是没显示出来呢，像之前的氧气、海底深度显示」。
   *
   * 修法：单独一台 zoom 恒为 1 的相机专管 UI，世界对象与 UI 对象用
   * `ignore()` 互斥分配（见 create()），两者不重复渲染。
   */
  private uiCam!: Phaser.Cameras.Scene2D.Camera
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private shopCards: { x: number; y: number; w: number; h: number; up: Upgrade; rect: Phaser.GameObjects.Rectangle }[] = []
  private decideBtns: { x: number; y: number; w: number; h: number; label: string; sub: string; enabled: boolean; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private resultBtns: { x: number; y: number; w: number; h: number; label: string; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private txtPool: Phaser.GameObjects.Text[] = []
  /**
   * 商店卡的**立绘图层**（V6.21）。三张卡各一个 Image，循环复用。
   *
   * 为什么不用 Graphics 画：Body 是 1200×600 的位图，Graphics 画不了贴图；
   * 也不能每帧 add/remove（会持续创建销毁对象）。所以开局建 3 个、常驻复用，
   * 只切 `visible` 与 `texture`。
   *
   * 相机归属：和商店里的文字一样归 **UI 相机**（`cameras.main.ignore`），
   * 这样它压在卡片背景（主相机的 `this.g`）之上、又在文字（UI 相机 depth 101）之下。
   */
  private shopArt: Phaser.GameObjects.Image[] = []
  /** UI 合理性审计：每帧 draw 阶段累积的 UI 节点（__dive.uiProbe 导出） */
  private ui: UINode[] = []
  private t = 0

  preload(): void {
    // 五张 WebP 共 378KB，preload 里一次加载完，避免换层时闪白
    for (let i = 0; i < ENV_BG.length; i++) {
      this.load.image(`env${i}`, ENV_BG[i] as unknown as string)
    }
    // 具象贴图：潜航器机体 + 4 个可转炮塔塔头
    this.load.image('sub_body', SUB_TEX as unknown as string)
    this.load.image('w_gun', W_GUN_TEX as unknown as string)
    this.load.image('w_torpedo', W_TORP_TEX as unknown as string)
    this.load.image('w_arc', W_ARC_TEX as unknown as string)
    // 敌方具象贴图：普通鱼半透明 + 描边，Boss 贴用翼型掠食鱼放大
    //
    // 采样必须强制 LINEAR —— 这是踩出来的坑：
    // 全局 `pixelArt: true`（见 main.ts）是为了让像素世界图保持硬边方块，
    // 它把默认采样设成 NEAREST。鱼/潜航器/炮塔是**连续色调**贴图，
    // 256px 要缩到 14~40px，NEAREST 在这种缩放比下只取到极少数源像素，
    // 几乎必然命中高光边缘 → 每条鱼渲染成一个**白色碎片**（L4 实测，
    // 满屏"白色小飞虫"）。LINEAR 双线性插值后，缩小到 14px 仍是可辨识的鱼形色块。
    for (const [key, tex] of [
      ['f_swarm', F_SWARM_TEX], ['f_drift', F_DRIFT_TEX], ['f_dash', F_DASH_TEX],
      ['sub_body', SUB_TEX], ['w_gun', W_GUN_TEX], ['w_torpedo', W_TORP_TEX], ['w_arc', W_ARC_TEX],
      // 三台潜航器的机体贴图（正俯视）。`sub_body` 保留作未知 id 的兜底。
      ['sub_lumen', SUB_ART.lumen], ['sub_raia', SUB_ART.raia], ['sub_bathy', SUB_ART.bathy],
    ] as Array<[string, unknown]>) {
      // TitleScene 已经加载过的话这里会重复入队，Phaser 会打警告 —— 先判断缓存
      if (!this.textures.exists(key)) this.load.image(key, tex as string)
    }
    // 道具卡立绘（V6.21）：键名 `item_<武器id>`，商店卡里按 contain 缩放放进立绘框
    for (const [id, url] of Object.entries(ITEM_ART)) {
      if (!this.textures.exists('item_' + id)) {
        this.load.image('item_' + id, url as unknown as string)
      }
    }
    this.load.once('complete', () => {
      for (const key of ['f_swarm', 'f_drift', 'f_dash',
        'sub_body', 'w_gun', 'w_torpedo', 'w_arc',
        'sub_lumen', 'sub_raia', 'sub_bathy',
        ...Object.keys(ITEM_ART).map(id => 'item_' + id)]) {
        if (this.textures.exists(key)) {
          this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR)
        }
      }
    })
  }

  create(data?: { sub?: SubId }): void {
    // 从标题页带过来的潜航器选择（V6.19）；直接刷新页面没带 data 时落到默认值
    this.sub = getSub(data?.sub)
    const W = this.scale.width
    const H = this.scale.height
    this.px = W / 2
    this.py = H / 2

    // 环境背景图：先建，depth=1，压在所有矢量环境层之下
    this.bg = this.add.image(0, 0, `env${this.layerIdx}`).setOrigin(0, 0).setDepth(1)
    this.layoutBg()

    // 具象潜航器 + 4 个炮塔。size:31 是反复试出来的：40px 时贴图细节糊成一团，
    // 28px 以下又认不出机械感。玩家单位只占屏幕极小一块，这个尺寸够用。
    // 机体从 59×31 放大到 99×52：塔要装得下、装得像"艇上的炮"，艇身必须先够大。
    // 机体贴图按**选中的潜航器**取（V6.20）：三台的立绘不同，战斗内直接看到的就是自己选的那艘
    const artKey = 'sub_' + this.sub.id
    this.subImg = this.add.image(0, 0, this.textures.exists(artKey) ? artKey : 'sub_body').setDepth(60)
    // 无论贴图是标题场景加载的还是这里加载的，都确保 LINEAR 采样
    // （loader 的 complete 回调在"文件全部命中缓存、无需下载"时不一定触发）
    if (this.textures.exists(artKey)) {
      this.textures.get(artKey).setFilter(Phaser.Textures.FilterMode.LINEAR)
    }
    this.subImg.setScale(SUB_D / (2 * SUB_ART_R))
    // 深度分层：**环境 → 暗幕 → 实体 → HUD**。
    // 暗幕夹在中间是 V4 §2 的铁律——它只能压暗地形，敌人/气泡/玩家必须画在它之上，
    // 否则深渊层（可见度 10%）会把 gameplay 信息一起吃掉。
    this.gBg = this.add.graphics().setScrollFactor(0).setDepth(5)
    this.gDim = this.add.graphics().setScrollFactor(0).setDepth(7)
    this.g = this.add.graphics().setDepth(10)
    // 发射塔专用层：**必须在机体贴图(60)之上**，否则塔会被艇身盖住。
    // 塔改成矢量绘制后就没法再借用 Image 的 depth 61，得自己开一层。
    this.gTurret = this.add.graphics().setDepth(62)
    this.gHud = this.add.graphics().setScrollFactor(0).setDepth(100)

    // —— UI 相机（V6.11）：把 HUD 从主相机的 1.25× 变焦里隔离出来 ——
    // 世界对象 → 只由主相机画（uiCam.ignore）；UI 对象 → 只由 UI 相机画
    // （mainCam.ignore）。两者互斥，杜绝重复渲染造成的"重影"。
    this.uiCam = this.cameras.add(0, 0, W, H)
    this.uiCam.setScroll(0, 0).setZoom(1).setName('ui')
    this.uiCam.ignore([this.bg, this.g, this.gTurret, this.subImg])
    this.cameras.main.ignore([this.gHud])

    // 商店立绘图层：3 个常驻 Image（三张卡各一个），depth 95 =
    // 压在卡面背景之上、卡面文字（101）之下
    this.shopArt = []
    for (let i = 0; i < 3; i++) {
      const img = this.add.image(0, 0, 'item_gun').setDepth(95).setVisible(false)
      img.setScrollFactor(0)
      this.cameras.main.ignore(img)
      this.shopArt.push(img)
    }

    const kb = this.input.keyboard!
    this.keys = {
      up: kb.addKey('W'), down: kb.addKey('S'),
      left: kb.addKey('A'), right: kb.addKey('D'),
      // 数字键：商店 1/2/3，层末决策 1=下潜 / 2=上浮
      one: kb.addKey('ONE'), two: kb.addKey('TWO'), three: kb.addKey('THREE'),
      burst: kb.addKey('SPACE'),
      esc: kb.addKey('ESC'),
    }

    // 必须自己把 pointer 事件喂给 hitRouter：registerUiHit 只登记热区、不接管输入。
    // 漏了这两行 = 所有按钮点了都没反应（2026-10-10 实测踩过）。
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => routeDown(this, p))
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => routeMove(this, p))

    // V6.9 商店：Tab 键切换「艇体状态」面板（点击页签同效）。capture 防止 Tab 抢走焦点。
    kb.addCapture('TAB')
    kb.on('keydown-TAB', () => { if (this.phase === 'shop') this.shopInfoOpen = !this.shopInfoOpen })

    this.scale.on('resize', () => this.layout())
    this.startRun()
    this.exposeProbe()
  }

  private layer(): LayerDef { return LAYERS[this.layerIdx] }

  /**
   * 当前层的 4 波节奏表。V6.23 之前是全局一张 `WAVE_SHAPE`，5 层共用 ——
   * 那是「每层感觉一样」的根因。现在按层取。
   */
  private waves(): WaveShape[] { return LAYER_WAVES[this.layerIdx] }

  // ==========================================================================
  // 进度
  // ==========================================================================
  private startRun(): void {
    this.layerIdx = 0
    this.waveInLayer = 0
    this.mult = 1.0
    this.bossDown = false
    // —— 潜航器加成（V6.19）——
    // 全部加成**只在这一处落地**：换一台潜航器重开，只需要改这里，
    // 不会漏掉某个读取点。属性表也在这里重置，避免重开时叠加两份。
    this.st = NEW_STATS()
    this.st.speed += this.sub.speed        // 刺鳐 +35% 移速
    this.st.pickup += this.sub.pickup      // 灯艇 +35% / 刺鳐 −40% 吸附
    this.ramT = 0
    this.o2Max = LAYERS[0].o2Max + this.sub.o2Max
    this.o2 = this.o2Max
    this.o2Shown = this.o2Max     // 补间值不复位的话，新局开头数字会从上一局的残值滚上来
    // 挂载位必须复位：不复位的话重开一局直接带 6 座 + 满射速加成，
    // 「靠商店卡解锁挂载」这条成长线会在第二局凭空消失。
    // 潜航器偏移叠在基础 4 之上（深潜者 slots=5 → 开局就有 5 座）。
    this.maxWeapons = 4 + (this.sub.slots - 4)
    this.hurtDirT = 0
    this.layerCardT = 2.6                 // 开局也播一次 L1 的层卡（和换层同一套语汇）
    this.weapons = []
    this.bullets = []; this.arcs = []; this.blasts = []; this.echoes = []; this.acids = []
    // 开局武器：**机关枪**。用户反馈「一开始是声呐在击杀吗，这个有点奇怪，
    // 一开始用机枪吧」—— 声呐是全向波前、看不见"打谁"，开局手感不直观。
    // 声呐之后仍然可以在商店买到（它是本作的核心机制，但不是开局该给的）。
    this.addWeapon('gun')            // 其余靠波次间拾取 / 商店购买
    this.startWave()
  }

  private startWave(): void {
    const L = this.layer()
    const s = this.waves()[this.waveInLayer]
    this.spawnLeft = Math.round(s.count * L.cntMul)
    this.spawnTimer = 0
    this.waveTimer = s.dur
    this.droppedThisWave = 0
    this.phase = 'wave'
    this.clearHits()
    this.buildMotes()
    this.buildDrift()    // 远景生物层：每层生态不同，换层必须重建
    this.syncEnv()      // 换层换背景 + 深度读数

    // —— L5「压力」：每开一波，氧气上限再被压掉一截 ——
    // 为什么放在 startWave 而不是 drainOxygen：压力是**波次事件**，
    // 玩家要在"新一波开始"这个瞬间看到上限条缩短，才能把它和"别拖"连起来。
    // 下限 40%：压到太低会变成纯数值死刑，失去"速决"的博弈感。
    if (L.pressure > 0) {
      const floor = LAYERS[this.layerIdx].o2Max * 0.4
      this.o2Max = Math.max(floor, this.o2Max * (1 - L.pressure))
      if (this.o2 > this.o2Max) this.o2 = this.o2Max
    }

    // —— L3「涌流」：本层每一波都从同一个方向涌入 ——
    // 玩家第一波就能看见"它们只从左边来"，于是提前把退路选在右边；
    // 若随机方向，这条机制就退化成普通的四面刷怪。
    if (L.surge && this.waveInLayer === 0) {
      this.surgeSide = Phaser.Math.Between(0, 3)
    }

    // 波次开场提示：飘在玩家上方。**必须用世界坐标**（飘字现在归世界相机）——
    // 之前写的是 `scale.width/2, scale.height*0.26`（屏幕坐标），在相机变焦 +
    // 跟随之后会飘到画面外。
    this.spawnFloat(this.px, this.py - this.scale.height * 0.24,
      `第 ${this.waveInLayer + 1} 波`, UI.cyanHi, 26)

    // L5 最后一波：深渊守望者
    if (this.layerIdx === LAYERS.length - 1 && this.waveInLayer === this.waves().length - 1) {
      this.spawnBoss()
    }
  }

  /**
   * 一波打完后的推进。
   *   层内波（1~3 结束）→ 商店三选一 → 下一波
   *   层末波（第 4 波结束）→ 补给站决策（下潜 / 上浮）；最后一层则通关
   */
  private advance(): void {
    if (this.waveInLayer < this.waves().length - 1) {
      this.waveInLayer++
      this.openShop()
      return
    }
    // 层末
    if (this.layerIdx >= LAYERS.length - 1) { this.showResult(true); return }
    this.openDecide()
  }

  // ==========================================================================
  // 生成
  // ==========================================================================
  /**
   * 这一波该从哪条边刷怪。
   *
   * 平时四面随机；**涌流层（L3）永远返回同一侧** —— 这是该层的核心机制：
   * 敌人只从一个方向压上来，玩家只要站到对面就有一整条安全走廊，
   * 但一旦贪心多打两波再走，缺口就会被堵死。
   */
  private pickSpawnSide(): number {
    return this.layer().surge ? this.surgeSide : Phaser.Math.Between(0, 3)
  }

  private spawnEnemy(at?: { x: number; y: number }): void {
    const W = this.scale.width
    const H = this.scale.height
    // 屏幕外生成，游入屏幕（V4 §3.1 规则 ⑤：不在玩家视野内凭空出现）。
    // `at` 由成群刷怪传入（同一入口点 + 小抖动），单只刷怪时为 undefined。
    const m = 60
    let x = at ? at.x : 0
    let y = at ? at.y : 0
    if (!at) {
      const side = this.pickSpawnSide()
      if (side === 0) { x = Phaser.Math.Between(0, W); y = -m }
      else if (side === 1) { x = W + m; y = Phaser.Math.Between(0, H) }
      else if (side === 2) { x = Phaser.Math.Between(0, W); y = H + m }
      else { x = -m; y = Phaser.Math.Between(0, H) }
    }

    const L = this.layer()
    const s = this.waves()[this.waveInLayer]
    const hpScale = L.hpMul * s.hpMul

    // 三种体型按层配比随机（回答"不同深度的生物应该不一样"）
    const r = Math.random()
    const dashP = s.dashRatio * L.dashMul
    let kind: Kind
    if (r < L.driftRatio) kind = 'drift'
    else if (r < L.driftRatio + dashP) kind = 'dash'
    else kind = 'swarm'

    const base = kind === 'drift' ? 110 : kind === 'dash' ? 52 : 30
    const hp = Math.round(base * hpScale)
    // 深潜印记的代价：敌人整体 +10% 移速。你变强了，但它们也更快追上你
    const relicSpd = this.hasRelic('abyss_mark') ? 1.1 : 1
    const spd = (kind === 'drift' ? 42 : kind === 'dash' ? 96 : 68) * relicSpd

    this.enemies.push({
      x, y, vx: 0, vy: 0, kx: 0, ky: 0,
      hp, maxHp: hp,
      // V6.10 再放大一档（用户：敌方个体还是太小）。
      // 显示尺寸 = r × 2.4，配合镜头 1.25× 后实机约为 57 / 75 / 102 px。
      r: kind === 'drift' ? 34 : kind === 'dash' ? 25 : 19,
      kind,
      color: kind === 'drift' ? UI.amber : kind === 'dash' ? UI.magenta : UI.jade,
      speed: spd,
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
      // 贴图与朝向补偿：swarm 贴梭形鲨、drift 贴水母、dash 贴翼型掠食鱼
      tex: kind === 'drift' ? 'f_drift' : kind === 'dash' ? 'f_dash' : 'f_swarm',
      texRot: TEX_BASE_ROT[kind] ?? 0,
    })
    this.eid++
  }

  /**
   * 一次刷怪节拍：**有概率刷一整群**，而不是永远刷单只。
   *
   * 为什么必须成群（用户："应该有群体是不是好点"）：
   * 单只从四个边均匀刷进来时，屏幕上是一堆互不相关的点 ——
   * 玩家读不出"这是一波鱼潮"，也没有"往哪躲"的方向感，只能在原地转圈。
   * 成群进场（同一入口、按一种形状排好）之后，玩家看到的是"一群鱼压过来"，
   * 这既是深海题材最强的画面直觉，也把"该往哪躲"变成一个可判断的问题。
   *
   * 三种排布只取最易读的三种（不做 gameData 里那套六阵型，那需要 slot 系统和
   * 行为分派，是另一个量级的事）：
   *   blob  乱堆 —— 无形状靠数量，压迫感来自"堵住一片"
   *   line  横排 —— 一排齐头并进，压迫感来自"封住一条线"
   *   wedge 楔形 —— 箭头朝前，压迫感来自"对着你冲"
   *
   * 返回本次实际刷了几只，由 updateWave 从 spawnLeft 里扣掉 ——
   * 不扣的话总怪数会随群规模膨胀，波次强度就失控了。
   */
  private spawnCluster(): number {
    // 群概率随波次上升：开局先让玩家适应单只，中后期以群为主。
    // 上限 0.8 而不是 1.0：全群会让屏幕没有"零散游动的个体"，
    // 满屏整齐反而失去生物的随机感。
    const groupP = Phaser.Math.Clamp(0.34 + this.waveInLayer * 0.13, 0, 0.8)
    if (Math.random() > groupP) { this.spawnEnemy(); return 1 }

    const n = Phaser.Math.Between(3 + this.waveInLayer, 5 + this.waveInLayer * 2)
    const W = this.scale.width, H = this.scale.height
    const m = 60
    // 入口：先定一个边，再在这个边上定锚点。
    // 涌流层（L3）由 pickSpawnSide 固定成同一侧，全层都从那一边压上来。
    const side = this.pickSpawnSide()
    let ax = 0, ay = 0
    if (side === 0) { ax = Phaser.Math.Between(0, W); ay = -m }
    else if (side === 1) { ax = W + m; ay = Phaser.Math.Between(0, H) }
    else if (side === 2) { ax = Phaser.Math.Between(0, W); ay = H + m }
    else { ax = -m; ay = Phaser.Math.Between(0, H) }

    // 排布方向：从入口指向玩家。楔形/横排都要按这个方向摆，
    // 否则从左边进场的一队会横着排（垂直于来向）—— 看起来像"一字长蛇飘过去"，
    // 完全读不出"冲着你来"。
    const ddx = this.px - ax, ddy = this.py - ay
    const dl = Math.max(1, Math.hypot(ddx, ddy))
    const ux = ddx / dl, uy = ddy / dl        // 前向
    const vx = -uy, vy = ux                   // 侧向

    const shapes: Array<'blob' | 'line' | 'wedge'> = ['blob', 'line', 'wedge']
    const shape = shapes[Phaser.Math.Between(0, 2)]
    // 间距按放大后的体型给：太密会糊成一坨看不出"几只"，
    // 太疏就散成散兵、又失去"群"的意义。
    const gap = 46

    for (let i = 0; i < n; i++) {
      let f = 0, s = 0                          // 前向 / 侧向偏移
      if (shape === 'blob') {
        f = (Math.random() - 0.5) * gap * 2.2
        s = (Math.random() - 0.5) * gap * 2.2
      } else if (shape === 'line') {
        s = (i - (n - 1) / 2) * gap
      } else {
        // 楔形：顶点在前，越往后越宽（和 gameData 的 arrow 阵同构）
        const row = Math.floor(i / 2) + (i === 0 ? 0 : 1)
        f = -row * gap * 0.75
        s = (i === 0 ? 0 : (i % 2 === 1 ? -1 : 1)) * row * gap * 0.55
      }
      this.spawnEnemy({ x: ax + ux * f + vx * s, y: ay + uy * f + vy * s })
    }
    return n
  }

  private spawnBoss(): void {
    const W = this.scale.width
    const hp = Math.round(1500 * this.layer().hpMul)
    this.enemies.push({
      x: W / 2, y: -90, vx: 0, vy: 0, kx: 0, ky: 0,
      hp, maxHp: hp,
      r: 44, kind: 'boss',
      color: UI.violet,
      speed: 46 * (this.hasRelic('abyss_mark') ? 1.1 : 1),
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
      tex: 'f_dash',       // Boss 复用翼型掠食鱼贴图，放大到44px 当专属剪影
      texRot: TEX_BASE_ROT.dash ?? 0,
    })
  }

  private buildMotes(): void {
    const W = this.scale.width, H = this.scale.height
    const n = this.layer().motes
    this.motes = []
    for (let i = 0; i < n; i++) {
      this.motes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.8 + Math.random() * 1.8,
        vy: -6 - Math.random() * 14,      // 海雪缓慢上浮
        vx: (Math.random() - 0.5) * 8,
        a: 0.12 + Math.random() * 0.3,
      })
    }
  }

  /**
   * 生成远景生物层。
   *
   * 每层的生态不同、数量也不同，但有一条铁律：
   * **它们永远不与敌人抢注意力**——低对比 + 小尺寸 + 边缘游动。
   * 中央 46% 宽度是战斗区，不生成任何生物（spawnDrift() 里强制）。
   */
  private buildDrift(): void {
    const W = this.scale.width, H = this.scale.height
    this.drift = []
    const li = this.layerIdx
    // 每层的生态配置：[数量, 配色, 尺寸基准]
    const table: Array<[number, number, number]> = [
      [4, UI.cyanDim, 13],      // L1：少量透明浮游生物剪影
      [5, UI.cyanDim, 16],      // L2：漂游水母
      [7, UI.violet, 19],       // L3：水母雨（这层的招牌生态）
      [5, UI.amber, 15],        // L4：热液旁的漂浮管虫幼体
      [3, UI.violet, 22],       // L5：极稀疏，深渊不该热闹
    ]
    const [n, col, r0] = table[li]
    for (let i = 0; i < n; i++) this.spawnDrift(col, r0)
  }

  /** 生成一只远景生物：强制落在左右两侧的边缘带，中央战斗区不放 */
  private spawnDrift(col: number, r0: number): void {
    const W = this.scale.width, H = this.scale.height
    // 边缘带 = 左右各 27% 宽度。中央 46% 是战斗区，永远留空
    const side = Math.random() < 0.5 ? 0 : 1
    const bandW = W * 0.27
    const x = side === 0
      ? Math.random() * bandW
      : W - Math.random() * bandW
    this.drift.push({
      x,
      y: Math.random() * H,
      r: r0 * (0.65 + Math.random() * 0.7),
      // 缓慢的随机游动方向，主要靠伞盖脉冲推进
      a: Math.random() * Math.PI * 2,
      sp: 5 + Math.random() * 9,
      ph: Math.random() * Math.PI * 2,
      tent: 0.8 + Math.random() * 0.7,
      col,
    })
  }

  /**
   * 远景生物运动。核心是**伞盖收缩产生推进力**：
   * 收缩时（pulse 上升段）向前加速，舒张时惯性滑行减速。
   * 这样它们的运动本身就是有机的，而不是匀速平移。
   */
  private updateDrift(dt: number): void {
    const W = this.scale.width, H = this.scale.height
    for (const d of this.drift) {
      d.ph += dt * 1.5
      // pulse: 0→1→0 的不对称收缩周期（喷水推进是脉冲式的，不是正弦）
      const pulse = Math.pow((Math.sin(d.ph) + 1) / 2, 3)
      // 收缩期推进，舒张期滑行
      const thrust = pulse * d.sp
      d.x += Math.cos(d.a) * thrust * dt
      d.y += Math.sin(d.a) * thrust * dt
      // 极缓慢的自转 + 转向摆动，避免直线运动
      d.a += Math.sin(this.t * 0.4 + d.ph) * 0.35 * dt
      // 轻微上浮（真实水母多数被动上升）
      d.y -= 3 * dt
      // 出界回收
      if (d.x < -60 || d.x > W + 60 || d.y < -80 || d.y > H + 80) {
        this.spawnDrift(d.col, d.r)
      }
    }
  }

  private updateWave(dt: number): void {
    this.spawnTimer -= dt
    if (this.spawnLeft > 0 && this.spawnTimer <= 0) {
      // V6.10：一个节拍可能刷一整群（3~9 只），所以按**实际刷出数**扣 spawnLeft，
      // 否则总怪数会随群规模膨胀、波次强度失控。
      const n = this.spawnCluster()
      this.spawnLeft = Math.max(0, this.spawnLeft - n)
      this.spawnTimer = 0.22
    }

    this.waveTimer -= dt
    const cleared = this.spawnLeft === 0 && this.enemies.length === 0
    if (cleared || this.waveTimer <= 0) {
      // 清场：剩余敌人离场
      this.enemies.forEach(e => { e.phase = 'rest'; e.t = 0 })
      if (cleared || this.enemies.length === 0) { this.advance(); return }
    }
  }

  // ==========================================================================
  // 主循环
  // ==========================================================================
  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000
    this.t += dt

    if (this.hurtFlash > 0) this.hurtFlash -= dt
    if (this.hurtDirT > 0) this.hurtDirT -= dt
    if (this.layerCardT > 0) this.layerCardT -= dt
    if (this.ramT > 0) this.ramT -= dt          // 刺鳐·撞击伤害的节流计时
    // 氧气显示值补间：指数逼近，8/s 的速率在大落差时约 0.3s 追平，
    // 既能看清"在掉"又不至于滞后到骗人（掉氧停止后立刻停住）。
    this.o2Shown += (this.o2 - this.o2Shown) * Math.min(1, dt * 8)
    if (Math.abs(this.o2 - this.o2Shown) < 0.05) this.o2Shown = this.o2

    if (this.phase === 'descending') {
      // 下潜过渡：深度滚动 + 气泡上涌（阶段结束后才开战）
      this.descT += dt
      const k = Math.min(1, this.descT / this.descDur)
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2   // easeInOutQuad
      this.depthM = this.descFrom + (this.descTo - this.descFrom) * e
      this.updateMotes(dt)
      this.updateDrift(dt)
      if (k >= 1) { this.phase = 'wave'; this.startWave() }
    } else if (this.phase === 'wave') {
      this.movePlayer(dt)
      // 发射器转塔必须在 movePlayer **之后**（座圈世界坐标依赖本帧的 px/py/aim），
      // 又必须在 autoFire **之前**（开火时读的就是这一帧算好的炮口朝向）。
      this.slewTurretAims(dt)
      this.updateEnemies(dt)
      this.updatePulses(dt)
      this.updateBullets(dt)
      this.updateEchoes(dt)
      this.updateAcids(dt)
      this.updateArcs(dt)
      this.updateBones(dt)
      this.updateDebris(dt)
      this.updateMotes(dt)
      this.updateDrift(dt)
      this.updateSparks(dt)
      this.updateFloats(dt)
      this.autoFire(dt)
      this.drainOxygen(dt)
      this.updateWave(dt)
      // 遗物的"状态类"计时器：必须每帧推进，否则条件永远不成立
      this.noHitT += dt
      if (this.plateT > 0) this.plateT -= dt
    } else {
      // 商店 / 决策 / 结算：战斗暂停，只保留环境动画。
      // 冲击波仍然推进 —— 进商店的那一刻玩家刚打完一波，
      // 场上可能还挂着几个没收的圈。如果这里冻结，它们会以"静止的圆圈"
      // 永远留在弹窗背景上（updateShocks 只在 wave 相位跑就再也不清）。
      this.updateBones(dt)
      this.updateDebris(dt)
      this.updateShocks(dt)
      this.updateMotes(dt)
      this.updateDrift(dt)
    }

    // 键盘：商店 1/2/3，层末决策 1=下潜 / 2=上浮
    const K = Phaser.Input.Keyboard
    if (this.phase === 'shop') {
      // 商店变成"鱼骨经济"后，1/2/3 是**购买**而不是"选一张就走"：
      // 买完还留在商店里，可以继续买第二张、刷新，或点"继续"开下一波。
      if (K.JustDown(this.keys.one)) this.buyCard(0)
      else if (K.JustDown(this.keys.two)) this.buyCard(1)
      else if (K.JustDown(this.keys.three)) this.buyCard(2)
    } else if (this.phase === 'decide') {
      if (K.JustDown(this.keys.one)) this.diveDeeper()
      else if (K.JustDown(this.keys.two)) this.surface()
    }
    if (K.JustDown(this.keys.esc)) this.scene.start('title')

    this.ui.length = 0   // 审计：每帧重算 UI 节点（draw 阶段累积，供 __dive.uiProbe 导出）

    // 镜头跟随 + 拉近（V6.9）：Brotato 的可读性来自「角色占屏比例大」。
    // 世界坐标不变，把视野缩到 1/CAM_ZOOM 并始终以潜航器为中心（setBounds 防越界）。
    //
    // ⚠️ 弹窗相位（shop/decide/result）必须把镜头**归位到 1× 且对准屏幕中心**。
    // 这些弹窗是按 `this.scale.width/height`（屏幕坐标）排版、画在世界层
    // `this.g` 上的，而变焦相机也会作用到世界层的 Graphics 上 ——
    // 于是整块 UI 被放大 1.25 倍并随玩家位置漂移：顶栏被推出画面、
    // 卡片位置和算好的坐标对不上。这就是用户说的"商店界面完全是乱的"
    // 的根因之一（另一个是实体压在 UI 上，见下面的 draw() 门控）。
    const cam = this.cameras.main
    const isPopup = this.phase === 'shop' || this.phase === 'decide' || this.phase === 'result'
    if (isPopup) {
      cam.setZoom(1)
      cam.centerOn(this.scale.width / 2, this.scale.height / 2)
    } else {
      cam.setBounds(0, 0, this.scale.width, this.scale.height)
      // 基础变焦。低氧心跳的那点额外缩放（drawHud 里的 ±1%）在本帧稍后生效，
      // 两处都会调 setZoom，顺序是 update → drawHud，所以后者是最终值，不冲突。
      cam.setZoom(CAM_ZOOM)
      cam.centerOn(this.px, this.py)
    }

    this.drawEnv()
    // 弹窗相位**不画战斗实体**（鱼 / 艇 / 炮塔）。
    // 它们分别画在 depth 40 / 60 / 62，而弹窗画在世界层 this.g 上、
    // depth 比它们低 —— 结果是潜艇和炮塔**直接压在商店卡片上**
    // （用户截图里第 2 张卡内可以看到潜艇和炮塔，就是这个）。这是第二根因。
    // 背景层 drawEnv() 仍然画，所以弹窗背后还有深海氛围、不是黑屏。
    if (isPopup) {
      this.g.clear()
      this.hideFish()
      this.subImg.setVisible(false)
      this.gTurret.clear()
    } else {
      this.draw()
    }
    // 弹窗相位（shop/decide/result）**不画战斗 HUD** —— 否则氧气条、波次点、
    // 武器条、排气提示全叠在弹窗上，这正是之前"弹窗界面很乱"的主因。
    // 弹窗各自画需要的上下文（鱼骨余额 / 下潜赌注 / 层数），不再复用战斗 HUD。
    if (this.phase === 'wave' || this.phase === 'descending') this.drawHud()
    else {
      // 弹窗相位：HUD 图形清掉、UI 文本隐藏。飘字要**单独清** ——
      // hideTexts 现在只处理 UI 层（飘字归世界层），而弹窗相位不跑 drawFloats，
      // 不主动清就会把上一帧的伤害数字冻在卡片上。
      this.gHud.clear()
      this.hideTexts()
      for (const t of this.txtPool) if (t.getData('cat') === 'float') t.setVisible(false)
      this.floats.length = 0
    }
    // 弹窗分派（原在 drawHud 末尾，drawHud 相位门控后必须独立出来）
    //
    // ⚠️ 商店立绘的显隐归**相位**管，不能交给 drawShop 自己管（V6.26 修）：
    // drawShop 只在 `phase === 'shop'` 时被调用，它内部那句"每帧先全隐"
    // 因此在离开商店后就再也不会执行 —— 而离开商店那一帧的最后状态是"亮着的"，
    // 于是那张立绘**永久冻在世界里**，跟着镜头漂、还压在战斗画面上
    // （depth 95，比鱼/艇/炮塔都高）。用户实测：
    // 「选择发射器之后 场景中还有遗留」——残留物就是商店中卡那张武器的立绘。
    // 修法：把"全隐"提到相位分派之前，只留 `shop` 这一帧例外（由 drawShop 点亮）。
    if (this.phase !== 'shop') for (const im of this.shopArt) im.setVisible(false)
    if (this.phase === 'shop') this.drawShop(this.g)
    if (this.phase === 'decide') this.drawDecide(this.g)
    if (this.phase === 'result') this.drawResult(this.g)
  }

  private movePlayer(dt: number): void {
    const W = this.scale.width, H = this.scale.height
    let dx = 0, dy = 0
    if (this.keys.left.isDown) dx -= 1
    if (this.keys.right.isDown) dx += 1
    if (this.keys.up.isDown) dy -= 1
    if (this.keys.down.isDown) dy += 1
    // 移速 = 基础 × (卡加成 + 洋流鳍的条件加成)
    // 洋流鳍奖励的是"干净地躲开"这件事本身，所以条件是**连续 3 秒未受击**，
    // 而不是"移动时"——后者等于白送。
    const spdMul = 1 + this.st.speed
      + (this.hasRelic('current_fin') && this.noHitT >= 3 ? 0.3 : 0)
    if (dx || dy) {
      const l = Math.hypot(dx, dy)
      this.aim = Math.atan2(dy, dx)
      this.px += (dx / l) * PLAYER.speed * spdMul * dt
      this.py += (dy / l) * PLAYER.speed * spdMul * dt
      this.moving = true
    } else {
      this.moving = false
    }

    // 热泉上升流（L4 ventPush）：持续的向上推力。
    // 为什么必须是**加速度**而不是速度偏移：加速度会自然地和玩家输入对抗，
    // 玩家想往下潜就得一直按着，静止时会明显被"顶"走——
    // 这正是深海热泉区的生存体感：**没有稳定的地方可以停**。
    const push = this.layer().ventPush
    if (push > 0) {
      // 靠近屏幕底部（热泉口方向）时推力更强，形成"越想躲越被顶"的梯度
      const grad = 1 + (this.py / H) * 0.8
      this.py -= push * grad * dt
      this.vpPush = push * grad
    } else {
      this.vpPush = 0
    }

    // —— L2「暗流」：同样的旋转水流，玩家吃**一半**强度 ——
    // 折算一半是刻意的：敌人吃满才有"鱼群被带歪"的可读画面，
    // 玩家吃一半则是"会偏、但不至于被推着走控制不了"。
    // 两者叠加正好构成「站位会漂」的体感 —— 氧气又变紧了，
    // 于是"要不要再多打一轮再去捡骨"这个判断每一波都得重做一次。
    const cur = this.layer().current
    if (cur > 0) {
      this.px += Math.cos(this.t * 0.28) * cur * 0.5 * dt
      this.py += Math.sin(this.t * 0.28) * cur * 0.5 * dt
    }
    // HUD 暗流提示用（0 = 本层无暗流）
    this.vpCur = cur

this.px = Phaser.Math.Clamp(this.px, 24, W - 24)
    this.py = Phaser.Math.Clamp(this.py, 24, H - 24)

    // 排气爆发
    this.burstTimer -= dt
    if (Phaser.Input.Keyboard.JustDown(this.keys.burst) && this.burstTimer <= 0 && this.o2 > O2.burstCost) {
      this.o2 -= O2.burstCost
      this.burstTimer = O2.burstCd
      for (const e of this.enemies) {
        if (Phaser.Math.Distance.Between(this.px, this.py, e.x, e.y) <= O2.burstR) this.hurt(e, 40)
      }
    }
  }

  private updateEnemies(dt: number): void {
    const dx0 = this.px, dy0 = this.py
    const cur = this.layer().current
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.flash > 0) e.flash -= dt
      const d = Phaser.Math.Distance.Between(e.x, e.y, dx0, dy0) || 1
      const nx = (dx0 - e.x) / d, ny = (dy0 - e.y) / d

      // —— L2「暗流」：整片水域在缓慢旋转的横向水流里 ——
      // 加在敌人身上而不是只加在玩家身上，是为了让它同时改变**两个**东西：
      //   ① 鱼的来向被带歪 → 你的预判和瞄准要跟着修
      //   ② 你自己的落点会被推 → 站位不再"放好就不动"
      // 方向取 this.t 的慢速旋转（约 22 秒一圈），玩家能感觉到周期性但不会晕。
      if (cur > 0 && e.kind !== 'boss') {
        e.x += Math.cos(this.t * 0.28) * cur * dt
        e.y += Math.sin(this.t * 0.28) * cur * dt
      }

      if (e.kind === 'swarm') {
        e.x += nx * e.speed * dt
        e.y += ny * e.speed * dt
      } else if (e.kind === 'drift') {
        // 水母：脉冲式漂移（一鼓一缩），慢但体型大，是"挡视线"型障碍
        const pulse = 0.6 + 0.4 * Math.sin(this.t * 2.2 + e.x * 0.01)
        e.x += nx * e.speed * pulse * dt
        e.y += ny * e.speed * pulse * dt
      } else if (e.kind === 'boss') {
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * dt
          e.y += ny * e.speed * dt
          if (e.t >= 5) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          if (e.t >= 1.2) { this.bossSlam(e); e.phase = 'dash'; e.t = 0 }
        } else {
          if (e.t >= 1.6) { e.phase = 'chase'; e.t = 0 }
        }
      } else {
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * dt
          e.y += ny * e.speed * dt
          if (d < 240) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          e.dirX = nx; e.dirY = ny
          if (e.t >= 0.5) { e.phase = 'dash'; e.t = 0 }
        } else if (e.phase === 'dash') {
          e.x += e.dirX * 460 * dt
          e.y += e.dirY * 460 * dt
          if (e.t >= 0.35) { e.phase = 'rest'; e.t = 0 }
        } else {
          if (e.t >= 0.7) { e.phase = 'chase'; e.t = 0 }
        }
      }

      // 击退积分与衰减（V6.9 打击感）：命中推离玩家的位移，指数衰减归零
      if (e.kx !== 0 || e.ky !== 0) {
        e.x += e.kx * dt
        e.y += e.ky * dt
        const dec = Math.exp(-9 * dt)
        e.kx *= dec; e.ky *= dec
        if (Math.abs(e.kx) < 2) e.kx = 0
        if (Math.abs(e.ky) < 2) e.ky = 0
      }

      // 接触伤害：氧气就是血条（V6 §3.2）。贴着不放 = 24 氧/秒。
      if (d < e.r + PLAYER.r) {
        // 刺鳐的**撞击伤害**（V6.19）：撞上来的敌人也吃一份，
        // 于是"贴脸"对它从"危险"变成"交易" —— 这正是它该有的玩法差异。
        // 必须节流 0.25s：不节流就是每帧结算，贴脸秒杀一切。
        if (this.sub.ram > 0 && this.ramT <= 0) {
          this.ramT = 0.25
          this.hurt(e, this.sub.ram)
          this.spawnHitSparks(this.px, this.py, Math.atan2(ny, nx), UI.jade)
        }
        // 护甲（耐压壳）在这里生效：持续磨损按乘算减免。
        // 闪避**不参与**持续伤害 —— 按帧掷骰会让掉氧忽快忽慢，
        // 玩家学不到任何规律。闪避只免疫一次性打击（见 damagePlayer）。
        this.o2 -= (e.kind === 'boss' ? 34 : 24) * dt * (1 - this.st.armor)
        this.hurtFlash = 0.25
        this.noHitT = 0
        this.plateT = 1.5      // 静默装甲：任何时候被碰到就进入规避窗口
        // 记下来向。注意 nx/ny 是「敌人 → 玩家」（敌人就是沿它追过来的），
        // 所以要**取反**才是伤害的来向；直接存 nx 会让暗角红在错误的那一侧。
        this.hurtDirX = -nx; this.hurtDirY = -ny; this.hurtDirT = 0.45
        // 轻微弹开，避免贴脸站桩
        e.x -= nx * 40 * dt
        e.y -= ny * 40 * dt
      }
    }
  }

  /**
   * 对玩家造成一次**一次性**打击（Boss 震击）。
   *
   * 闪避只在这里掷骰：一次性打击才有"躲开了"这个瞬间可读的事件，
   * 配上飘字就成了正反馈。持续接触伤害走的是护甲乘算，不走这里。
   */
  private damagePlayer(amount: number, dirX: number, dirY: number): void {
    const dodge = Math.min(0.9, this.st.dodge + (this.plateT > 0 ? 0.4 : 0))
    if (Math.random() < dodge) {
      this.spawnFloat(this.px, this.py - 34, '闪避', UI.cyanHi, 16)
      this.plateT = 1.5
      return
    }
    const d = amount * (1 - this.st.armor)
    this.o2 -= d
    // 氧气归零 = 溺水 = 失败结算（与 drainOxygen 一致，否则 boss 震击打死玩家
    // 却卡在战斗帧不进结算屏，实测 o2 被打到 -2710 仍停在 decide 相位）。
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false); return }
    this.hurtFlash = 0.35
    this.noHitT = 0
    this.plateT = 1.5
    this.hurtDirX = dirX; this.hurtDirY = dirY; this.hurtDirT = 0.6
    this.spawnFloat(this.px, this.py - 30, `-${Math.round(d)}`, UI.danger, 16)
  }

  /** Boss 震击：红圈预警 1.2s 后爆发 */
  private bossSlam(e: Enemy): void {
    const R = 220
    if (Phaser.Math.Distance.Between(this.px, this.py, e.x, e.y) <= R) {
      // Boss 震击是全屏伤害，但仍有来向：从玩家指向 Boss
      const dx = e.x - this.px, dy = e.y - this.py
      const len = Math.max(1, Math.hypot(dx, dy))
      this.damagePlayer(18, dx / len, dy / len)
    }
    this.cameras.main.shake(220, 0.008)
  }

  /**
   * 声呐脉冲：波前向外扩散，扫到谁伤谁。
   * 注意波是「环形」不是「射线」——射程内但波前还没扩过去的鱼不会受伤，
   * 所以离你越近的鱼越快被打到。这是"贴脸打鱼"手感的机制来源。
   */
  private updatePulses(dt: number): void {
    for (const p of this.pulses) {
      if (!p.alive) continue
      p.r += PLAYER.pulseSpeed * dt
      if (p.r > p.maxR) { p.alive = false; continue }
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.alive || p.hit.has(i)) continue
        const d = Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y)
        // 波前是一条有厚度的环带：鱼心到发射点距离落在环带内即命中
        if (Math.abs(d - p.r) < p.width * 0.5 + e.r) {
          p.hit.add(i)
          e.flash = 0.08            // 命中闪白（替代伤害数字，V4 §3.1 规则 ④）
          this.hurt(e, p.dmg)
          // 共振炮（sonar_rs）：命中后向**邻近敌人**弹射 40% 伤害。
          // 这是它相对基础声呐的质变 —— 基础声呐只扫一圈，共振会把伤害沿
          // 鱼群传下去，拿到就等于有了清群手段（计划书 §5.2 点名的流派）。
          if (p.resonant) {
            let best: Enemy | null = null, bd = 150
            for (const o of this.enemies) {
              if (!o.alive || o === e) continue
              const dd = Phaser.Math.Distance.Between(e.x, e.y, o.x, o.y)
              if (dd < bd) { bd = dd; best = o }
            }
            if (best) { best.flash = 0.06; this.hurt(best, p.dmg * 0.4) }
          }
        }
      }
    }
    this.pulses = this.pulses.filter(p => p.alive)
  }

  /** 回声标记更新：倒计时归零 → 范围爆发（半径 130，比鱼雷的 120 更大，补偿延迟） */
  private updateEchoes(dt: number): void {
    for (const e of this.echoes) {
      e.t -= dt
      if (e.t <= 0) this.explode(e.x, e.y, 130, e.dmg)
    }
    this.echoes = this.echoes.filter(e => e.t > 0)
  }

  /** 酸液云更新：每 0.35s 对圈内敌人结算一次伤害，本体持续 3s */
  private updateAcids(dt: number): void {
    for (const a of this.acids) {
      a.life -= dt
      a.tick -= dt
      if (a.tick <= 0) {
        a.tick = 0.35
        for (const e of this.enemies) {
          if (!e.alive) continue
          if (Phaser.Math.Distance.Between(a.x, a.y, e.x, e.y) < a.r + e.r) {
            e.flash = 0.05
            this.hurt(e, a.dmg)
          }
        }
      }
    }
    this.acids = this.acids.filter(a => a.life > 0)
  }

  /**
   * 对一条敌人造成一次伤害。
   *
   * **所有伤害都必须走这个函数** —— 声呐波前、机关枪弹、鱼雷直击与爆炸、
   * 电弧链击，一共五条路径都在这里汇合。属性加成（伤害 % / 暴击）放在这层，
   * 新加一条伤害来源就自动吃到加成，不用在每个调用点各补一遍。
   * 反过来，若加成写在调用点，漏一处就是"这张卡买了没效果"。
   */
  private hurt(e: Enemy, dmg: number): void {
    // 暴击：全局属性，所有伤害来源共享（和 Brotato 一致）
    const crit = Math.random() < this.st.crit
    let d = dmg * this.dmgMulNow()
    if (crit) d *= 1 + this.st.critMul
    e.hp -= d
    // 受击反馈（V6.9 打击感 → V6.10 补冲击波）：
    // 白闪 + 击退 + 冲击波 + 迸溅火星 + 掉血漂字，五件套。
    // 缺任何一件都会让"打到了"这件事在敌人身上不留痕迹（见 Shock 接口注释）。
    e.flash = Math.max(e.flash, 0.09)
    let nx = 0, ny = 0
    if (e.kind !== 'boss') {
      const kd = e.kind === 'drift' ? 46 : 120
      const dd = Phaser.Math.Distance.Between(e.x, e.y, this.px, this.py) || 1
      nx = (e.x - this.px) / dd; ny = (e.y - this.py) / dd
      e.kx += nx * kd
      e.ky += ny * kd
    }
    // 冲击波从**身体中心**发出，而不是命中边缘 —— 中心是玩家视线锁定的地方，
    // 边缘会随敌人朝向乱跳，圈看起来像"从旁边擦过去"而不是"打在身上"。
    this.spawnShock(e.x, e.y, {
      rMax: e.r * 1.35, dur: 0.17, color: crit ? UI.violet : 0xdff4ff,
      width: crit ? 2.6 : 1.8, core: crit ? e.r * 0.9 : e.r * 0.62, rings: 1,
    })
    // 击打痕：垂直于弹道方向的短亮条。nx/ny 是"敌人→玩家"（= 击退方向），
    // 弹道方向正好是它的反向，所以这里用 (nx, ny) 当弹道法向即可。
    this.spawnSlash(e.x, e.y, Math.atan2(-ny, -nx), crit ? 1.35 : 1, crit ? UI.violet : e.color)
    // 迸溅火星：沿弹道方向反向喷一小簇，让"子弹从哪来"也有痕迹。
    // 3 颗封顶，再多就变成烟花而不是命中了。
    const sparkN = crit ? 6 : 4
    for (let i = 0; i < sparkN; i++) {
      const spread = (Math.random() - 0.5) * 1.5
      const base = Math.atan2(-ny, -nx) + spread
      const sp = 110 + Math.random() * 190
      this.sparks.push({
        x: e.x, y: e.y,
        vx: Math.cos(base) * sp, vy: Math.sin(base) * sp,
        life: 0.14 + Math.random() * 0.1, maxLife: 0.24,
        color: crit ? UI.violet : e.color,
        size: 1.3 + Math.random() * 1.5, ang: base, kind: 'hit',
      })
    }
    // 命中震屏：只给暴击。普通命中的频率太高（每秒几十次），
    // 每次都震会变成持续抖动，反而廉价且让人晕。
    if (crit) this.cameras.main.shake(90, 0.0022)
    if (crit) {
      e.flash = 0.14
      this.spawnFloat(e.x, e.y - e.r - 14, `暴击 ${Math.round(d)}`, UI.violet, 17)
      // 共振核心：暴击溅射到最近的另一只 —— 让高暴击 build 有清群能力
      if (this.hasRelic('resonance_core')) {
        let best: Enemy | null = null, bd = 220
        for (const o of this.enemies) {
          if (!o.alive || o === e) continue
          const dd = Phaser.Math.Distance.Between(e.x, e.y, o.x, o.y)
          if (dd < bd) { bd = dd; best = o }
        }
        // 溅射也走 hurt()：它同样是一次"命中"，同样该有冲击波与火星，
        // 否则暴击流 build 的视觉反馈会比非暴击还弱（等级反了）。
        if (best) { best.hp -= d * 0.4; best.flash = 0.1
          this.spawnShock(best.x, best.y, {
            rMax: best.r * 1.1, dur: 0.15, color: UI.violet,
            width: 1.6, core: best.r * 0.5, rings: 1,
          }) }
      }
    } else {
      // 普通命中小漂字：Brotato 每跳伤害都有数字，这是「打疼了」的基本节奏
      this.spawnFloat(e.x + (Math.random() * 16 - 8), e.y - e.r - 12,
        `${Math.round(d)}`, 0xe8f4ff, 12)
    }
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.biomass += e.kind === 'boss' ? 20 : 1
      if (e.kind === 'boss') this.bossDown = true
      // —— 击杀特效（V6.10）：大圈 + 实心闪核 + 环形碎片 ——
      // 规格刻意与命中拉开：命中是"节拍"，击杀是"句号"。
      this.spawnKillFx(e)
      this.spawnDebris(e)          // 软组织被共振震散
      this.dropBone(e)             // 只剩发光骨架
      // 击杀回氧飘字。注意：鱼骨是**另外一笔**收益（捡到才给），
      // 这里是击杀瞬间给的，两笔来源不同，飘字位置也错开（击杀在鱼身上、
      // 拾取在鱼骨上），玩家能分清"打死的"和"捡到的"
      // 深潜者的"击杀回氧 ×1.5"在这里落地（与"循环鳃"遗物相乘，不是相加）
      const kO2 = this.st.killO2 * this.sub.killO2Mul * (this.hasRelic('osteoblast') ? 2 : 1)
      if (kO2 > 0) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + kO2)
        if (this.o2 - before > 0.5) {
          this.spawnFloat(e.x, e.y - e.r - 6, `+${Math.round(this.o2 - before)}`,
            UI.cyanHi, 15)
        }
      }
      // Boss 击杀是全屏级事件，用大号飘字
      if (e.kind === 'boss') {
        this.spawnFloat(e.x, e.y - 40, 'BOSS 击破', UI.violet, 24)
      }
    }
  }

  /**
   * 击杀特效：三层同时发生，缺一层就"不够爽"。
   *
   *   ① **外扩冲击波**（双色双圈）：内圈白、外圈敌人本色，延迟半拍跟进。
   *      双圈的必要性：单圈在满屏都是同一色（青/品红）的环境里不显眼，
   *      而"白 + 本色"在任何背景上都能跳出来。
   *   ② **实心闪核**：一团体积按体型缩放的白斑，0.12s 内从满尺寸缩到 0。
   *      它是"炸开"的那一瞬间，比扩散的圈更有冲击力（圈是余韵，核是事件）。
   *   ③ **径向碎片**：8~14 片沿放射线飞出的短条，比圆点更能读出"炸开"的方向感。
   *
   * Boss 的三样全部放大并加一圈紫色外环 + 震屏，让它读起来是"里程碑"而不是"大鱼"。
   */
  private spawnKillFx(e: Enemy): void {
    const isBoss = e.kind === 'boss'
    const R = e.r
    this.spawnShock(e.x, e.y, {
      rMax: R * (isBoss ? 4.2 : 2.6), dur: isBoss ? 0.5 : 0.32,
      color: e.color, width: isBoss ? 4 : 2.6,
      core: R * (isBoss ? 1.5 : 1.0), rings: 2, ringDelay: 0.35,
    })
    // 白色内圈：与本色外圈形成双色双波
    this.spawnShock(e.x, e.y, {
      rMax: R * (isBoss ? 2.6 : 1.7), dur: isBoss ? 0.32 : 0.2,
      color: 0xffffff, width: isBoss ? 3 : 2,
      core: R * (isBoss ? 0.9 : 0.62), rings: 1,
    })
    // 径向碎片
    const n = isBoss ? 26 : 8 + Math.round(R * 0.25)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5
      const sp = (isBoss ? 200 : 120) + Math.random() * (isBoss ? 280 : 160)
      this.sparks.push({
        x: e.x, y: e.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.2 + Math.random() * 0.22, maxLife: 0.42,
        color: i % 3 === 0 ? WHITE : e.color,
        size: (isBoss ? 2.4 : 1.6) + Math.random() * 1.6, ang: a, kind: 'hit',
      })
    }
    // 击杀震屏：按体型分三档，频率越高的震得越轻。
    //   普通小鱼（swarm/dash）不震 —— 每秒可能死十几只，全震就是持续抖动；
    //   大水母（drift，r=27）轻震一记 —— 它是"值得打的大目标"，死了该有反馈；
    //   Boss 重震 —— 一局一次，必须有分量。
    if (isBoss) this.cameras.main.shake(320, 0.012)
    else if (e.kind === 'drift') this.cameras.main.shake(120, 0.0035)
  }

  /**
   * 掉鱼骨。
   * 硬约束 ②：每波掉落总量有上限（按层配置）——否则"击杀补氧"会退化成
   * 打得多就无限续命，氧气条失去意义。Boss 骨架不受上限限制（它是里程碑）。
   */
  private dropBone(e: Enemy): void {
    const isBoss = e.kind === 'boss'
    // 大鱼留大骨架：让"挑大鱼打"成为真实选择，而不只是打最近的
    const size = isBoss ? 44 : Phaser.Math.Clamp(e.r * 1.7, 14, 30)
    // 回氧：基数被压到 BONE.o2Base（普通鱼 5 氧，旧版 7）—— 这是"氧气稀缺化"的阀门
    const o2 = isBoss ? 24 : Math.max(2, Math.round(BONE_O2.o2Base * (size / 18)))
    // 鱼骨币：**沿用旧公式，不要改** —— dropCap 是按它计量的，
    // 改它会连带推翻商店经济（而商店经济这次不在讨论范围内）
    const coin = isBoss ? 24 : Math.max(3, Math.round(4 * (size / 18)))
    // 上限只卡**钱**。它是经济阀门，不该顺手把氧气供应也卡掉 ——
    // 氧气那一边已经由 o2Base 这个阀门单独管了。
    if (!isBoss && this.droppedThisWave >= this.layer().dropCap) return
    this.droppedThisWave += coin
    const a = Math.random() * Math.PI * 2
    const sp = 30 + Math.random() * 45
    this.bones.push({
      x: e.x, y: e.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
      fade: O2.boneFade, o2, coin, size,
      rot: a, spin: (Math.random() - 0.5) * 1.6,
      alive: true,
    })
  }

  /** 共振把软组织震散：一小撮肉屑向外飞散后淡出（纯表现，不参与判定） */
  private spawnDebris(e: Enemy): void {
    const n = e.kind === 'boss' ? 16 : 6
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 60 + Math.random() * 130
      this.debris.push({
        x: e.x + Math.cos(a) * e.r * 0.5,
        y: e.y + Math.sin(a) * e.r * 0.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.42 + Math.random() * 0.3, maxLife: 0.72,
        color: e.color, r: 1.6 + Math.random() * 2.2,
        alive: true,
      })
    }
  }

  /**
   * 鱼骨：缓慢下沉 + 阻尼 + 自转，玩家游过去拾取。
   * 只有进入拾取半径才吸收——不做远程磁吸，否则走位就没意义了（硬约束①）。
   */
  /**
   * 鱼骨：先下沉，触底后**原地淡出**（用户需求③：沉到某个深度后原地淡出）。
   *
   * 为什么不是"到时间直接消失"：直接消失会像 bug，玩家会以为是自己漏捡了。
   * 沉底 + 渐隐能让玩家看懂"它沉下去了，我够不着了"，是明确的负反馈而非错误感。
   */
  private updateBones(dt: number): void {
    // 拾取半径 = 基础 × (吸附鳍 + 潮汐罗盘)
    const pr = O2.pickupR * (1 + this.st.pickup + (this.hasRelic('tidal_compass') ? 0.8 : 0))
    const H = this.scale.height
    for (const b of this.bones) {
      if (!b.alive) continue
      // 软磁吸（V6.9 引入，V6.23 **削弱**）：游得很近时鱼骨往身上漂一点。
      //
      // 旧值 2.4× 拾取半径 = 81px，实际上是一个"自动吸尘器"：正常走位就顺手
      // 把周围骨头全吸走了，拾取率接近百分百 —— 这直接抹掉了「要不要游过去」
      // 这个动作。现在削到 1.7×（约 53px），性质从"吸尘器"变成"最后一下的顺手"：
      // 你仍然得**主动走到骨头附近**，磁吸只负责省掉最后几像素的精度。
      const dpx = this.px - b.x, dpy = this.py - b.y
      const dp = Math.hypot(dpx, dpy)
      const pulled = dp < pr * 1.7 && dp > 1
      if (pulled) {
        b.vx += (dpx / dp) * 380 * dt
        b.vy += (dpy / dp) * 380 * dt
      }
      // 下沉：比气泡"上浮"更有重量感（被吸住时不强制下沉）
      b.vy += 34 * dt
      if (!pulled && b.vy > O2.boneSinkV) b.vy = O2.boneSinkV
      if (!pulled) b.vx *= 0.94                    // 水阻
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.rot += b.spin * dt
      b.spin *= 0.985
      // 到达沉底深度：停止下沉，转为原地淡出（正被吸住的骨不结算沉底）
      if (!pulled && b.y >= H - O2.boneFloor) {
        b.y = H - O2.boneFloor
        b.vy = 0; b.vx = 0
        b.fade -= dt
        if (b.fade <= 0) { b.alive = false; continue }
      }
      if (Phaser.Math.Distance.Between(b.x, b.y, this.px, this.py) < pr) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + b.o2)
        const gained = this.o2 - before
        b.alive = false
        // 鱼骨**同时是货币**：捡到既有氧也有钱。
        // 这两件事必须一起给 —— 只给钱的话氧气系统（血条+计时器）会失去
        // 唯一的正向补充来源，只给氧的话"捡鱼骨"又和商店无关，循环还是断的。
        //
        // 注意 V6.23 起这两条曲线**数值上已经解耦**（见 BONE_O2）：
        // 回氧基数被压过，钱保持原样。但两者仍**同时结算** —— 解耦的是数值，
        // 不是行为；"捡一根骨头 = 补氧 + 攒钱"这个动作必须还是一个。
        //
        // 钱按**加成后的**价值算（打捞运 / 潮汐罗盘 / 贪食腺体），
        // 回氧仍按基础值 —— 否则运气属性会顺带变成生存属性，
        // 一张"打捞运"卡同时解决经济和血线，就没有取舍了。
        const coin = Math.round(b.coin * this.boneValueMul())
        this.bank += coin
        // 回氧飘字。氧满时（gained ≈ 0）不飘 ——
        // 飘一个 "+0" 是在嘲笑玩家，那是最糟糕的反馈
        if (gained > 0.5) {
          this.spawnFloat(b.x, b.y - 8, `+${Math.round(gained)} O₂`, UI.cyan, 17)
        } else {
          this.spawnFloat(b.x, b.y - 8, '氧气已满', UI.cyanDim, 14)
        }
        // 钱另飘一行（错开延迟，两行不打架）：让"这是在攒钱"变成可见的
        this.spawnFloat(b.x, b.y - 26, `+${coin} 骨`, BONE, 14)
        // 拾取时鱼骨位置炸一小簇青色粒子，让"吸进来了"有实感
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2
          this.sparks.push({
            x: b.x, y: b.y,
            vx: Math.cos(a) * 60, vy: Math.sin(a) * 60,
            life: 0.2, maxLife: 0.2, color: UI.cyan,
            size: 1.5, ang: a, kind: 'hit',
          })
        }
      }
    }
    this.bones = this.bones.filter(b => b.alive)
    this.enemies = this.enemies.filter(e => e.alive)
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      if (!d.alive) continue
      d.life -= dt
      if (d.life <= 0) { d.alive = false; continue }
      d.x += d.vx * dt; d.y += d.vy * dt
      d.vx *= 0.90; d.vy *= 0.90
    }
    this.debris = this.debris.filter(d => d.alive)
  }

  private updateMotes(dt: number): void {
    const W = this.scale.width, H = this.scale.height
    for (const m of this.motes) {
      m.y += m.vy * dt
      m.x += m.vx * dt
      if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W }
      if (m.x < -4) m.x = W + 4
      if (m.x > W + 4) m.x = -4
    }
  }

  /**
   * 索敌：射程内最近的敌人。
   *
   * `ox/oy` 是可选原点 —— V6.26 起发射器**以自己塔座为原点**索敌：
   * 船有 6 个座、座圈半径 40px，按机体中心算的话艉侧的座会把"自己鼻子底下
   * 的鱼"判成远处目标，出现"这座塔明明贴着鱼却转头打远的那条"。
   */
  private nearestEnemy(range: number, ox = this.px, oy = this.py): Enemy | null {
    let best: Enemy | null = null, bd = range
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = Phaser.Math.Distance.Between(ox, oy, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  /** 按等级算出某台器械的实际数值（等级越高：更快、更痛、更远） */
  private weaponStats(id: WeaponId, lvl: number): { iv: number; dmg: number; range: number } {
    const d = WEAPON_DEF[id]
    const k = lvl - 1
    return {
      iv: d.iv / (1 + k * 0.12),
      dmg: d.dmg * (1 + k * 0.35),
      range: d.range + k * 26,
    }
  }

  /**
   * 挂载一台器械。**槽位没满就优先占新槽**，即使是已经在用的同款 ——
   * 这跟 Brotato 一致：6 个槽可以放 6 把一样的枪，每把各占一座、各开一次火。
   * 火力来源是「台数」而不是「单台等级」，所以重复挂载本身就是一种成长。
   *
   * 只有**槽位满了**才走合并升级：优先喂给同 id 且还没满级的那台；
   * 找不到就挤掉最早挂载的那台（保持台数恒定，玩家不会莫名掉火力）。
   *
   * 槽位上限由 `maxWeapons` 决定：开局 4（对应 4 个物理座），
   * 靠商店的「双联挂载」卡解锁到 5、6 —— 这就是"塔升级靠商店卡驱动"。
   */
  private addWeapon(id: WeaponId, lvl = 1): void {
    const st = this.weaponStats(id, lvl)
    if (this.weapons.length >= this.maxWeapons) {
      const exist = this.weapons.find(w => w.id === id && w.lvl < 5)
      if (exist) {
        exist.lvl = Math.min(5, exist.lvl + 1)
        const s2 = this.weaponStats(id, exist.lvl)
        exist.iv = s2.iv; exist.dmg = s2.dmg
        return
      }
      this.weapons.shift()
    }
    this.weapons.push({ id, iv: st.iv, timer: 0, dmg: st.dmg, lvl, anchor: 0,
      ivLast: st.iv, fireFlash: 0, aimAng: this.aim })
  }

  /**
   * 把一台已满级的武器**进化**成指定形态（V6.17）。
   *
   * 计划书 §5.2 定的规矩：进化 = **改机制**，不是加数值。
   * 除了换 id / 数值，这里还要重置 timer —— 否则进化完会带着旧武器的冷却
   * 节奏（比如从 1.5s 的鱼雷进化成 2.4s 的重型，却立刻按旧节奏开火）。
   */
  private evolveWeapon(from: WeaponId, to: WeaponId): void {
    const w = this.weapons.find(x => x.id === from)
    if (!w) return
    const st = this.weaponStats(to, w.lvl)
    w.id = to
    w.iv = st.iv
    w.dmg = st.dmg
    w.timer = 0            // 进化完立刻能打第一发
    w.ivLast = st.iv
    w.fireFlash = 0.25     // 进化瞬间闪一下，给个"换装了"的反馈
  }

  /**
   * 武器槽位 → 座圈座位分配表。
   *
   * V6.10（圆形座圈）：座位是**固定角度**的 `SEAT_ANGLES_DEG`，
   * 按顺序取前 N 个。所以：
   *   第 1~4 台 → ±30° / ±90°（艏艉全空的稳定四座）
   *   第 5~6 台 → 补上 ±150°（尾侧两座）
   *
   * `ext` 标记这个座位是扩容卡解锁出来的（索引 ≥ BASE_SEATS），
   * 画的时候加一圈琥珀色外环，让"我的艇变强了"在剪影上直接看得见。
   *
   * 角度固定（而不是均分 N 份）是刻意的：均分会让第 5 台入手时
   * 已有 4 座全部转位，玩家看着自己的炮"突然跳了一下"，会以为是 bug。
   */
  private mountPlan(): Array<{ ang: number; ext: boolean }> {
    const plan: Array<{ ang: number; ext: boolean }> = []
    for (let i = 0; i < this.weapons.length && i < MAX_SEATS; i++) {
      plan.push({
        ang: SEAT_ANGLES_DEG[i] * Math.PI / 180,
        ext: i >= BASE_SEATS,
      })
    }
    return plan
  }

  /** 第 i 座塔座的**世界坐标**（座圈随艇身朝向一起转，发射器则独立瞄准）。 */
  private seatPos(i: number): { x: number; y: number } | null {
    const slot = this.mountPlan()[i]
    if (!slot) return null
    const ca = Math.cos(this.aim), sa = Math.sin(this.aim)
    const sx = SEAT_RING_R * Math.cos(slot.ang)
    const sy = SEAT_RING_R * Math.sin(slot.ang)
    return { x: this.px + sx * ca - sy * sa, y: this.py + sx * sa + sy * ca }
  }

  /** 第 i 座在**射程内**最近的目标（以**塔座**而不是机体中心为原点） */
  private seatTarget(i: number): { tgt: Enemy | null; rng: number } | null {
    const w = this.weapons[i]
    const p = this.seatPos(i)
    if (!w || !p) return null
    const def = WEAPON_DEF[w.id]
    // 射程算法必须和 autoFire 一致，否则塔会指向一个实际打不到的目标
    const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
    return { tgt: this.nearestEnemy(rng, p.x, p.y), rng }
  }

  /**
   * 发射器独立索敌（V6.26）。
   *
   * 旧的炮塔角是 `机体朝向 + clamp(目标角 − 机体朝向, ±70°)` —— 这个式子
   * 把"打谁"和"往哪走"绑死了：往上游，全船炮只能在上方 ±70° 里挑，
   * 于是"移动上面就一直射击上面"（用户实测）。而 Brotato 的手感恰恰相反：
   * 火力来自多个**各自为战**的来源，玩家的操作只有走位。
   *
   * 现在改为：每座塔**从自己座位的坐标**出发，独立锁定射程内最近的敌人，
   * 以 TURRET_SPIN 的角速度转过去；射程内没有目标就回到艇首方向待机。
   * 结果 = 装载器（座圈，跟着艇身转）+ 发射器（旋回部，自己找鱼）两件东西各转各的，
   * 这才是"插在座上的独立发射器"该有的样子。
   */
  private slewTurretAims(dt: number): void {
    for (let i = 0; i < this.weapons.length; i++) {
      const w = this.weapons[i]
      const st = this.seatTarget(i)
      if (!st) continue
      const p = this.seatPos(i)!
      const want = st.tgt
        ? Math.atan2(st.tgt.y - p.y, st.tgt.x - p.x)
        : this.aim
      const rel = Phaser.Math.Angle.Wrap(want - w.aimAng)
      // 指数逼近（转得快时也不会甩过头）+ 角速度硬上限（防止一帧内绕大半圈）
      const step = Phaser.Math.Clamp(
        rel * Math.min(1, dt * 14), -TURRET_SPIN * dt, TURRET_SPIN * dt)
      w.aimAng = Phaser.Math.Angle.Wrap(w.aimAng + step)
    }
  }

  /**
   * 第 i 台器械的**炮塔位姿**（世界坐标 + 实际朝向）。
   *
   * 为什么必须抽成函数而不是在 autoFire 里各算一遍：
   * 以前子弹和枪口闪光都从 `this.px/this.py`（机体正中心）出，
   * 而炮塔画在半径 40 的座圈上 —— 结果是"炮在边上、弹从中间冒"，
   * 玩家根本看不出是哪个炮开的火。用户原话：
   * 「需要衔接发射器，视觉上可以很清楚看到发射器转向发射」。
   *
   * 朝向直接取 `w.aimAng`（由 `slewTurretAims` 每帧算好），
   * 和 `drawSub` 画塔用的是**同一个值** —— 任何一处另算一套，
   * 弹就会从炮管旁边飞出来。V6.26 之前两处各写了一遍限幅公式，
   * 这次合并成一个来源，就是为了根除这种"两处算法必须手动同步"的隐患。
   * 返回 null 表示这台没占到位（不该发生，兜底用）。
   */
  private turretPose(i: number): { x: number; y: number; ang: number } | null {
    const slot = this.mountPlan()[i]
    const w = this.weapons[i]
    if (!slot || !w) return null
    const p = this.seatPos(i)
    if (!p) return null
    return { x: p.x, y: p.y, ang: w.aimAng }
  }

  /** 全部器械升一级（「弹药改良」升级卡用） */
  private levelAllWeapons(): void {
    for (const w of this.weapons) {
      w.lvl = Math.min(5, w.lvl + 1)
      const s = this.weaponStats(w.id, w.lvl)
      w.iv = s.iv; w.dmg = s.dmg
    }
  }

  /**
   * 多器械同时开火。每台各自冷却、各自索敌，玩家仍然只操作走位。
   * 这是 Brotato 的核心手感：火力来自多个来源，操作只有一个。
   */
  private autoFire(dt: number): void {
    const plan = this.mountPlan()
    for (let wi = 0; wi < this.weapons.length; wi++) {
      const w = this.weapons[wi]
      // 钳到 0：没打到目标时 timer 会一直累加负值，
      // HUD 的冷却条按 timer/iv 算，负值会让进度条反向画满。
      w.timer = Math.max(0, w.timer - dt)
      w.fireFlash = Math.max(0, w.fireFlash - dt)
      if (w.timer > 0) continue
      const def = WEAPON_DEF[w.id]
      // 射程 = (基础 + 等级) × 声场延伸。放在索敌处算而不是写进武器数值，
      // 这样属性卡买到手立刻生效，不用回头重算每台武器的缓存值。
      const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
      // 扩容座（ext = 第 5/6 座）享受齐射同步加成。见 Stats.twinRate 注释
      const seatBoost = (plan[wi]?.ext) ? (1 + this.st.twinRate) : 1
      // 这一台炮塔的世界位姿。**弹、枪口闪光、电弧起点全部以它为准**，
      // 不再用机体中心 —— 否则"炮在座圈上、弹从中间冒"，玩家看不出是谁开的火。
      const pose = this.turretPose(wi)
      // 炮口在塔心再往外探出炮塔半径，弹才像"从管子里打出来"而不是"从塔心穿透"
      const MUZ = TURRET_R * 1.05

      // 按**武器族**分支：进化形态归到基础族，族内只改参数 / 弹数 / 散射。
      // 这样以后再加第三、第四条进化分支，不用动 autoFire 的骨架。
      const fam = weaponFamily(w.id)
      const wcol = WEAPON_DEF[w.id].color

      if (fam === 'sonar') {
        // 声呐是全向的：射程内有鱼就发一圈波，不需要瞄准。
        // 但波从自己身上往外扩，所以「贴得越近越早被打到」——
        // 这把「扎进鱼群多捞几只」和「别被围住」绑成了同一个决策。
        if (!this.nearestEnemy(rng)) continue
        this.pulses.push({
          x: pose ? pose.x : this.px, y: pose ? pose.y : this.py,
          r: PLAYER.r * 0.6, maxR: rng,
          dmg: w.dmg, width: PLAYER.pulseWidth,
          hit: new Set<number>(), alive: true,
          resonant: w.id === 'sonar_rs',   // 共振炮：命中溅射，见 updatePulses
        })
      } else if (fam === 'gun') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        // 霰弹（gun_sg）：一次 5 弹扇形，从"点杀"变"面压"。
        // 加特林（gun_gl）：仍是单发，靠 iv 极短（用射程腰斩来换）。
        const pellets = w.id === 'gun_sg' ? 5 : 1
        const spread = 0.36
        const spd = w.id === 'gun_gl' ? 640 : 780
        for (let p = 0; p < pellets; p++) {
          const a = pellets > 1
            ? base + (p / (pellets - 1) - 0.5) * spread * 2
            : base + (Math.random() - 0.5) * 0.05
          this.bullets.push({
            x: ox, y: oy,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            life: rng / spd, dmg: w.dmg, kind: 'gun',
            hit: new Set<number>(), alive: true,
          })
        }
        // 枪口闪光：从**炮口**喷，和弹的出生点重合 ——
        // 两者差几个像素就会看到"闪光和弹各在一处"，非常出戏
        this.spawnMuzzleFlash(ox, oy, base, wcol)
      } else if (fam === 'torpedo') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        // 集束（torp_cl）：一次 3 枚微散 —— 目标成团才划算。
        // 重型（torp_hv）：单枚，但伤害 ×2.3、爆炸半径 ×1.5（er）。
        const pellets = w.id === 'torp_cl' ? 3 : 1
        const spread = 0.26
        for (let p = 0; p < pellets; p++) {
          const a = pellets > 1
            ? base + (p / (pellets - 1) - 0.5) * spread * 2
            : base
          this.bullets.push({
            x: ox, y: oy,
            vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
            life: 3.0, dmg: w.dmg, kind: 'torpedo',
            hit: new Set<number>(), alive: true,
            er: w.id === 'torp_hv' ? 1.5 : 1,
          })
        }
        this.spawnMuzzleFlash(ox, oy, base, wcol)
      } else if (fam === 'harpoon') {
        // 鱼叉（V6.18）：直线**穿透**（弹不销毁，`hit` 保证同一只鱼只中一次），
        // 而且命中后会把鱼**拉向玩家**（见 updateBullets）。逼你"勾到身边再打"。
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.bullets.push({
          x: ox, y: oy,
          vx: Math.cos(base) * 900, vy: Math.sin(base) * 900,
          life: rng / 900, dmg: w.dmg, kind: 'harpoon',
          hit: new Set<number>(), alive: true,
        })
        this.spawnMuzzleFlash(ox, oy, base, wcol)
      } else if (fam === 'echo') {
        // 回声（V6.18）：在目标处留标记，0.75s 后**范围爆发**。
        // 给一半提前量（0.5）—— 完全预判会让"预判"这件事失去意义，
        // 不预判则永远打不中移动目标。半量 + 130px 大爆炸半径是手感折中。
        const e = this.nearestEnemy(rng); if (!e) continue
        const LEAD = 0.5, DLY = 0.75
        const ex = e.x + e.vx * DLY * LEAD
        const ey = e.y + e.vy * DLY * LEAD
        this.echoes.push({ x: ex, y: ey, t: DLY, dmg: w.dmg })
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.spawnMuzzleFlash(ox, oy, base, wcol)
      } else if (fam === 'acid') {
        // 酸液（V6.18）：在目标位置铺一滩，持续 3s —— 全场唯一的阵地武器。
        // 正确用法是把它铺在"鱼群要经过的路"上，而不是追着鱼铺。
        const e = this.nearestEnemy(rng); if (!e) continue
        this.acids.push({ x: e.x, y: e.y, r: 62, life: 3.0, tick: 0, dmg: w.dmg })
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + Math.sin(base) * MUZ : this.py
        this.spawnMuzzleFlash(ox, oy, base, wcol)
      } else {
        const first = this.nearestEnemy(rng); if (!first) continue
        this.fireArc(first, w, pose)
      }
      // 射速：高压供能（st.rate）在这里生效。改的是**下一次冷却的长度**
      // 而不是已有 timer，所以属性变化立刻反映在下一发上。
      // 记下这一发的**实际间隔**：装载器的装填进度环用它做分母，
      // 用 def.iv（基础值）会在升级/齐射加成后对不上实际节奏。
      w.ivLast = def.iv / ((1 + (w.lvl - 1) * 0.12) * seatBoost * (1 + this.st.rate))
      w.timer = w.ivLast
      w.fireFlash = 0.15   // 开火闪光：这一瞬装载器环 + 炮口一起烧白
    }
  }

  /** 链式电弧：从 first 开始向后跳，跳数随等级增加。
   *  `pose` = 开火那座炮塔的位姿；电弧第一段从炮口起跳，而不是从机体中心，
   *  否则玩家看到的是"闪电从潜艇中间连到鱼"，而不是"这座塔放电打了那条鱼"。 */
  private fireArc(first: Enemy, w: Weapon,
                  pose: { x: number; y: number; ang: number } | null = null): void {
    // 链数：基础 Lv1 跳 3 个 → Lv5 跳 7 个。
    //   过载电弧（arc_ov）：再 +4 跳 —— "纵向更深"
    //   定点雷暴（arc_st）：不设上限，一次把射程内连得到的全串起来 —— "横向更广"
    const chain = w.id === 'arc_st' ? 99
      : 2 + w.lvl + (w.id === 'arc_ov' ? 4 : 0)
    const pts = [{ x: pose ? pose.x : this.px, y: pose ? pose.y : this.py }]
    const hit = new Set<Enemy>()
    let cur: Enemy | null = first
    while (cur && hit.size < chain) {
      hit.add(cur)
      pts.push({ x: cur.x, y: cur.y })
      cur.flash = 0.08
      this.hurt(cur, w.dmg)
      let next: Enemy | null = null, bd = 190
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e)) continue
        const d = Phaser.Math.Distance.Between(cur!.x, cur!.y, e.x, e.y)
        if (d < bd) { bd = d; next = e }
      }
      cur = next
    }
    this.arcs.push({ pts, life: 0.18 })
  }

  /** 通用弹更新：机关枪直线、鱼雷追踪 + 命中爆炸 */
  private updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) continue
      b.life -= dt
      if (b.life <= 0) { b.alive = false; continue }

      if (b.kind === 'torpedo') {
        const tgt = this.nearestEnemy(WEAPON_DEF.torpedo.range)
        if (tgt) {
          const want = Math.atan2(tgt.y - b.y, tgt.x - b.x)
          const cur = Math.atan2(b.vy, b.vx)
          // 转向速率有上限，否则鱼雷会像狗一样贴着敌人抽搐
          const diff = Phaser.Math.Clamp(
            Phaser.Math.Angle.Wrap(want - cur), -3.6 * dt, 3.6 * dt)
          const na = cur + diff
          const sp = Math.hypot(b.vx, b.vy)
          b.vx = Math.cos(na) * sp
          b.vy = Math.sin(na) * sp
        }
      }

      b.x += b.vx * dt
      b.y += b.vy * dt
      // 出屏即销毁（屏幕外生成原则的延续）
      const W = this.scale.width, H = this.scale.height
      if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) { b.alive = false; continue }

      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.alive || b.hit.has(i)) continue
        if (Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y) < e.r + 6) {
          b.hit.add(i)
          e.flash = 0.08
          this.hurt(e, b.dmg)
          // 命中火花：沿弹道方向扇形迸溅，方向跟着弹走而不是随机散
          // （随机散会看不出"这一发打中了"，跟弹道走才读得出打击方向）
          this.spawnHitSparks(b.x, b.y, Math.atan2(b.vy, b.vx),
            b.kind === 'gun' ? UI.amber : UI.danger)
          // 爆炸半径吃 er：重型鱼雷 1.5 倍 —— "单发重击"的体感就来自这里
          if (b.kind === 'torpedo') { this.explode(b.x, b.y, 120 * (b.er ?? 1), b.dmg * 0.6); b.alive = false; break }
          // 鱼叉（V6.18）：**穿透**（不销毁）+ 把命中的鱼**拉向玩家**。
          // 拉拽 = 在敌人身上加一个朝向玩家的冲量（hurt 里加的是"远离"，反向即拉近）。
          if (b.kind === 'harpoon') {
            const dd = Phaser.Math.Distance.Between(e.x, e.y, this.px, this.py) || 1
            e.kx -= (e.x - this.px) / dd * 300
            e.ky -= (e.y - this.py) / dd * 300
          }
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.alive)
  }

  // ==========================================================================
  // 火花：命中迸溅 + 枪口闪光
  // ==========================================================================

  /**
   * 命中火花：沿弹道方向**扇形迸溅**（±55°），而不是全向随机散。
   *
   * 全向随机散会看不出"这一发打中了哪里、从哪打来"；
   * 跟弹道走才读得出打击方向，打击感来自方向一致性。
   */
  private spawnHitSparks(x: number, y: number, ang: number, color: number): void {
    const n = 5
    for (let i = 0; i < n; i++) {
      const spread = -0.96 + (i / (n - 1)) * 1.92          // ±55°
      const a = ang + Math.PI + spread                      // 主要朝弹道的反方向溅
      const spd = 90 + Math.random() * 130
      this.sparks.push({
        x, y,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        life: 0.22, maxLife: 0.22,
        color, size: 1.6 + Math.random() * 1.8, ang: a, kind: 'hit',
      })
    }
  }

  /**
   * 枪口闪光：开火瞬间在炮口喷一小簇锥形火星。
   * 只画 3 颗 + 一记闪光弧，多了会糊成一团、也拖性能。
   */
  private spawnMuzzleFlash(x: number, y: number, ang: number, color: number): void {
    this.sparks.push({
      x, y, vx: 0, vy: 0,
      life: 0.11, maxLife: 0.11,
      color, size: 7, ang, kind: 'flash',
    })
    for (let i = 0; i < 3; i++) {
      const a = ang + (Math.random() - 0.5) * 0.7
      const spd = 70 + Math.random() * 90
      this.sparks.push({
        x, y,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        life: 0.16, maxLife: 0.16,
        color, size: 1.4 + Math.random() * 1.2, ang: a, kind: 'hit',
      })
    }
  }

  private updateSparks(dt: number): void {
    for (const s of this.sparks) {
      s.life -= dt
      if (s.life <= 0) continue
      if (s.kind === 'hit') {
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vx *= 1 - 3.4 * dt          // 水的阻尼：火花在水里很快就停
        s.vy *= 1 - 3.4 * dt
      }
    }
    this.sparks = this.sparks.filter(s => s.life > 0)
    // 硬上限：满屏鱼 + 高射速时火花可能爆炸性增长，超了直接丢最老的
    if (this.sparks.length > 220) this.sparks.splice(0, this.sparks.length - 220)
  }

  private drawSparks(g: Phaser.GameObjects.Graphics): void {
    for (const s of this.sparks) {
      const k = Phaser.Math.Clamp(s.life / s.maxLife, 0, 1)   // 1 → 0
      if (s.kind === 'flash') {
        // 枪口闪光：一记朝弹道方向的锥形亮弧 + 中心白核
        const L = s.size * (1.6 - k * 0.6)
        const ca = Math.cos(s.ang), sa = Math.sin(s.ang)
        const pa = -sa, pb = ca
        g.fillStyle(WHITE, k * 0.85)
        g.beginPath()
        g.moveTo(s.x + ca * L * 1.25, s.y + sa * L * 1.25)
        g.lineTo(s.x + pa * s.size * 0.62, s.y + pb * s.size * 0.62)
        g.lineTo(s.x - pa * s.size * 0.62, s.y - pb * s.size * 0.62)
        g.closePath(); g.fillPath()
        g.fillStyle(s.color, k * 0.55)
        g.fillCircle(s.x, s.y, s.size * 0.5)
      } else {
        // 命中火星：沿飞行方向拉成短条（"溅"不是"点"），越老越细越淡
        const L = 4 + s.size * 2.2
        const ca = Math.cos(s.ang), sa = Math.sin(s.ang)
        neonLine(g, s.x, s.y, s.x - ca * L * k, s.y - sa * L * k, s.color,
          { width: s.size * k, alpha: k, bloom: false })
      }
    }
  }

  // ==========================================================================
  // 飘字：把"发生了什么"变成看得见的事件
  // ==========================================================================

  /**
   * 生成一条飘字。
   *
   * `delay` 用来错开同帧的多个飘字：满屏鱼骨时一帧可能连捡 5 个，
   * 全部同时从同一个点上浮会叠成一坨看不清。每个错开 0.07s 就能读清。
   */
  private spawnFloat(x: number, y: number, text: string, color: number, size = 18): void {
    // 同帧已有几条就往后排几条，实现"错开"
    const same = this.floats.filter(f => f.life > f.maxLife - 0.12).length
    this.floats.push({
      x, y,
      vy: -46 - Math.random() * 14,
      life: 0.95, maxLife: 0.95,
      text, color, size,
      delay: Math.min(0.35, same * 0.07),
    })
    if (this.floats.length > 24) this.floats.splice(0, this.floats.length - 24)
  }

  private updateFloats(dt: number): void {
    for (const f of this.floats) {
      if (f.delay > 0) { f.delay -= dt; continue }
      f.life -= dt
      // 上浮减速（水的阻尼），不是匀速 —— 匀速会像 UI 动画不像水里冒出来的
      f.vy *= 1 - 1.6 * dt
      f.y += f.vy * dt
    }
    this.floats = this.floats.filter(f => f.life > 0)
  }

  private drawFloats(g: Phaser.GameObjects.Graphics): void {
    // ⚠️ 每帧先把上一帧的飘字文本全部隐藏，再按当前存活列表重新点亮。
    // 飘字对象在池里是复用的：不主动隐藏，旧对象就一直 visible，
    // `txt()` 的 `find(o => !o.visible)` 永远找不到可复用项 → 池无限增长。
    // 隐藏放在这里（而不是 hideTexts）是因为 hideTexts 在 drawFloats **之后**
    // 才跑，两者一起改会把飘字清空（见 hideTexts 注释）。
    for (const t of this.txtPool) if (t.getData('cat') === 'float') t.setVisible(false)
    // V6.10：飘字底板已删除。
    //
    // 原来每条飘字下面都垫一块 abyss 圆角板（alpha 0.55）。单条看是为了
    // 「压在鱼群上还能读清」，但满屏飘字时它变成了**满屏黑色小方块**——
    // 玩家反馈的"飘字底板很丑"就是这个：真正刺眼的不是底板本身，
    // 而是它把画面切成了一个个不透明的小格子，霓虹的整体感全没了。
    //
    // 替代方案：`txt()` 本身已经带 3px 深色描边（setStroke('#04070d', 3)），
    // 描边跟着字形走，只压住笔画背后的几个像素，既保可读又完全不遮画面。
    // 这里只给飘字**额外加粗一档描边**，替代底板提供的对比度。
    for (const f of this.floats) {
      if (f.delay > 0) continue
      const k = Phaser.Math.Clamp(f.life / f.maxLife, 0, 1)      // 1 → 0
      // 出生弹跳：0.15s 内从 1.35× 回落到 1×
      const pop = k > 0.85 ? 1 + (k - 0.85) / 0.15 * 0.35 : 1
      // 末段淡出 + 略微上飘加速（"飘走"而不是"原地消失"）
      const a = k > 0.4 ? 1 : k / 0.4
      const size = Math.round(f.size * pop)
      const t = this.txt(f.text, f.x, f.y, `${size}px`, this.hexOf(f.color), MONO, 'center', 'float')
        .setAlpha(a)
      // 描边随字号缩放：小数字（12px 伤害数）用 2.5 就够，大字（26px 波次提示）
      // 用 3.5，否则细描边压不住大字周围的复杂背景。
      t.setStroke('#04070d', size >= 20 ? 4 : size >= 14 ? 3 : 2.5)
    }
  }

  /** 把 0xRRGGBB 转成 '#rrggbb'（txt() 收字符串色） */
  private hexOf(c: number): string {
    return '#' + c.toString(16).padStart(6, '0')
  }

  /** 鱼雷爆炸：范围伤害随距离衰减 + 震屏 */
  private explode(x: number, y: number, r: number, dmg: number): void {
    this.cameras.main.shake(130, 0.006)
    this.blasts.push({ x, y, r, life: 0.32 })
    // 爆炸冲击波（V6.10）：与击杀同款的双色双圈，规格按爆炸半径缩放。
    // 之前爆炸只有一圈 blasts 环 + 肉屑，而鱼雷是低频大招（1.5s 一发），
    // 低频大招如果视觉和普通命中差不多重，玩家就感受不到"这一发很重"。
    this.spawnShock(x, y, {
      rMax: r * 1.15, dur: 0.36, color: UI.amber, width: 3,
      core: r * 0.5, rings: 2, ringDelay: 0.3,
    })
    this.spawnShock(x, y, {
      rMax: r * 0.7, dur: 0.22, color: 0xffffff, width: 2.2,
      core: r * 0.34, rings: 1,
    })
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = Phaser.Math.Distance.Between(x, y, e.x, e.y)
      if (d < r + e.r) {
        e.flash = 0.08
        const falloff = 1 - Phaser.Math.Clamp(d / (r + e.r), 0, 1) * 0.5
        this.hurt(e, dmg * falloff)
      }
    }
    // 爆炸也会震落肉屑，命中感更实
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 90 + Math.random() * 180
      this.debris.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.2, maxLife: 0.5,
        color: UI.amber, r: 1.6 + Math.random() * 2, alive: true,
      })
    }
  }

  private updateArcs(dt: number): void {
    for (const a of this.arcs) a.life -= dt
    this.arcs = this.arcs.filter(a => a.life > 0)
    for (const b of this.blasts) b.life -= dt
    this.blasts = this.blasts.filter(b => b.life > 0)
    this.updateShocks(dt)
  }

  // ==========================================================================
  // 冲击波（V6.10 打击 / 击杀特效）
  // ==========================================================================

  /**
   * 生成一圈冲击波。参数用对象传入而不是位置参数 ——
   * 七个参数里有五个是可选的调参项，位置参数会导致调用处全是裸数字，
   * 读代码根本不知道 `2.6` 是半径倍率还是生命期。
   */
  private spawnShock(x: number, y: number, o: {
    rMax: number; dur: number; color: number
    width: number; core: number; rings: number; ringDelay?: number
  }): void {
    this.shocks.push({
      x, y, r: 0, rMax: o.rMax,
      life: o.dur, maxLife: o.dur,
      color: o.color, width: o.width, core: o.core,
      rings: o.rings, ringDelay: o.ringDelay ?? 0,
    })
  }

  private updateShocks(dt: number): void {
    for (const s of this.shocks) s.life -= dt
    this.shocks = this.shocks.filter(s => s.life > 0)
    // 硬上限：电弧链击一次命中 7 个目标、6 座齐射时爆发极密，
    // 超了直接丢最老的（保最新 = 保玩家正在看的那个）
    if (this.shocks.length > 48) this.shocks.splice(0, this.shocks.length - 48)
    for (const s of this.slashes) s.life -= dt
    this.slashes = this.slashes.filter(s => s.life > 0)
    if (this.slashes.length > 40) this.slashes.splice(0, this.slashes.length - 40)
  }

  /**
   * 生成一条击打痕。`ang` 是**弹道方向**，条与之垂直。
   * `scale` 用来区分普通命中（1.0）与暴击（1.35：更长更亮）。
   */
  private spawnSlash(x: number, y: number, ang: number, scale: number, color: number): void {
    this.slashes.push({
      x, y, ang,
      len: (7 + Math.random() * 6) * scale,
      life: 0.10, maxLife: 0.10,
      color, width: 2.2 * scale,
    })
  }

  /**
   * 画击打痕。画在冲击波之上、火花之下：
   * 它必须盖住鱼身（否则读不出"打在这条鱼身上"），
   * 但不能盖住火花（火花是更亮的那一层）。
   */
  private drawSlashes(g: Phaser.GameObjects.Graphics): void {
    for (const s of this.slashes) {
      const k = Phaser.Math.Clamp(s.life / s.maxLife, 0, 1)   // 1 → 0
      // 前 40% 时间还在"伸长"（撞击瞬间的应力条），后 60% 原地淡出
      const grow = k > 0.6 ? 1 + (k - 0.6) / 0.4 * 0.5 : 1
      const len = s.len * grow
      // 垂直于弹道：把弹道角旋转 90°
      const pa = s.ang + Math.PI / 2
      const ca = Math.cos(pa), sa = Math.sin(pa)
      neonLine(g, s.x - ca * len / 2, s.y - sa * len / 2,
        s.x + ca * len / 2, s.y + sa * len / 2, s.color,
        { width: s.width, alpha: k, bloom: false })
      // 中心一个白点：让"撞在哪里"有一个明确的定位
      g.fillStyle(WHITE, k * 0.9)
      g.fillCircle(s.x, s.y, 1.6)
    }
  }

  /**
   * 画冲击波。绘制顺序在**敌人之上、弹幕之下**：
   * 圈必须盖住鱼身（不然圈画在鱼下面，看起来像"鱼旁边有个圈"而不是"打中了鱼"），
   * 但不能盖住玩家的曳光弹（弹是玩家操作的结果，优先级更高）。
   */
  private drawShocks(g: Phaser.GameObjects.Graphics): void {
    for (const s of this.shocks) {
      const t = 1 - s.life / s.maxLife          // 0 → 1
      // 半径用 **easeOut**：起步快、收尾慢。匀速外扩看起来像"圆圈在滑动"，
      // 而真实爆炸是"啪地一下炸开然后很快消散"。
      const ease = 1 - Math.pow(1 - t, 2.4)
      const fade = t < 0.7 ? 1 : (1 - t) / 0.3   // 末 30% 淡出

      for (let ri = 0; ri < s.rings; ri++) {
        // 内圈按 ringDelay 延后：它从 0 开始扩，所以视觉上像"余波追上主波"
        const tt = Phaser.Math.Clamp((t - ri * s.ringDelay) / (1 - ri * s.ringDelay || 1), 0, 1)
        if (tt <= 0) continue
        const ease2 = 1 - Math.pow(1 - tt, 2.4)
        const fade2 = tt < 0.7 ? 1 : (1 - tt) / 0.3
        const r = s.rMax * ease2
        // 线宽随扩散变细：起手粗（"炸"）、收尾细（"散"）
        const w = s.width * (1 - ease2 * 0.65)
        neonCircle(g, s.x, s.y, Math.max(1, r), s.color,
          { width: Math.max(0.6, w), alpha: fade2 * 0.9, bloom: false })
      }

      // 实心闪核：只在生命前 45% 出现，且从满尺寸缩到 0 ——
      // 这是"炸开的那一瞬间"，扩散的圈只是余韵
      if (t < 0.45) {
        const k = 1 - t / 0.45
        const cr = s.core * k
        if (cr > 0.6) {
          g.fillStyle(s.color, 0.5 * k)
          g.fillCircle(s.x, s.y, cr)
          g.fillStyle(WHITE, 0.85 * k)
          g.fillCircle(s.x, s.y, cr * 0.45)
        }
      }
    }
  }

  private drainOxygen(dt: number): void {
    // 净耗氧 = 层数基础 − 循环泵回氧 + 贪食腺体的代谢代价
    let net = this.layer().drain
    if (this.hasRelic('gluttony')) net += 0.6
    net -= this.st.regen
    this.o2 -= net * dt
    // 循环泵在耗氧为负时应该是"回氧"，但仍然要封顶在上限内，
    // 否则会出现"氧气 100/100 但还在涨"的读数。
    if (this.o2 > this.o2Max) this.o2 = this.o2Max
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false) }
  }

  // ==========================================================================
  // 环境绘制（会被暗幕压暗）
  // ==========================================================================
  /**
   * 下潜过渡演出。
   *
   * 解决的是「层与层之间只是换了个底色」——这里让玩家**看见自己在下潜**：
   * 压力舱排气（气泡上涌）+ 深度数字滚动 + 暗角收缩 + 下一层名预告。
   * 三者叠加才有"失重 + 压力 + 未知"的紧张感，缺一个都只是转场动画。
   */
  private drawDescending(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    const k = Math.min(1, this.descT / this.descDur)
    const L = this.layer()
    const cx = W / 2

    // 覆盖层：0 → 0.72 → 0.28（进场压黑、出场放行）
    const cover = k < 0.45 ? (k / 0.45) * 0.72 : 0.72 - ((k - 0.45) / 0.55) * 0.44
    g.fillStyle(0x03060c, cover)
    g.fillRect(0, 0, W, H)

    // 气泡上涌：速度/大小各异，制造被排气推着走的失重感。
    // 用空心圈而不是实心点——实心点在深色背景上像"一堆灰斑"，不像气泡
    for (let i = 0; i < 70; i++) {
      const seed = i * 97.13
      const t2 = (this.descT * (1.1 + (seed % 1) * 0.9) + (seed % 1)) % 1
      const x = (seed * 7.31) % W
      const y = H + 30 - t2 * (H + 90)
      const r = 1.4 + (seed % 5) * 0.9
      const a = 0.42 * (1 - t2) * (1 - t2)
      g.lineStyle(1.2, 0xdff8ff, a)
      g.strokeCircle(x, y, r)
      if (seed % 4 < 1) g.fillStyle(0xffffff, a * 0.5), g.fillCircle(x - r * 0.3, y - r * 0.3, r * 0.22)
    }

    // 深度数字居中滚动（52px MONO ≈ 31px/字，按位数估算居中）
    const dstr = Math.round(this.depthM).toLocaleString()
    const dw = dstr.length * 31
    this.txt(dstr, cx - dw / 2 - 12, H * 0.38, '52px', TXT.cyber, MONO)
    this.txt('m', cx + dw / 2 + 4, H * 0.38 + 34, '18px', TXT.dim, MONO)

    // 下一层预告
    const label = `下潜至 L${this.layerIdx + 1} ${L.name}`
    const ny = H * 0.38 + 86
    this.txt(label, cx - label.length * 8.5, ny, '17px', TXT.cyber, FONT)
    this.txt(L.sub, cx - L.sub.length * 6, ny + 26, '12px', TXT.mute, MONO)
  }

  /**
   * 环境绘制（depth=5，压在背景图 depth=1 之上，会被暗幕压暗）。
   *
   * V6.3 变更：静态地貌**全部交给背景图**（混元生成的五层实景），
   * 这里只保留「会动」的东西——海雪、热流、气泡、生物冷光。
   *
   * 为什么这么改：以前每层画一堆 alpha 0.05~0.16 的几何剪影，
   * 被暗幕一压几乎看不见，玩家只感觉到"屏幕变暗了"，
   * 感觉不到自己在不同深度。这是「分层没有体感」的根因之一。
   */
  private drawEnv(): void {
    const g = this.gBg
    g.clear()
    const W = this.scale.width, H = this.scale.height
    const L = this.layer()

    // —— 弹窗相位（商店 / 决策 / 结算）**不画环境层** ——
    // 那几个页面是一整张实底页，环境层（海雪 / 每层动态 / 远景生物剪影）
    // 不该透上来。而且它**一定会透上来**：gBg 没进 `uiCam.ignore` 名单，
    // 于是被 uiCam 再画一遍、盖在商店底色之上 —— depth 5 < 10 也挡不住，
    // 因为这是两个相机的渲染次序问题，不是深度问题。
    // 实机证据：商店截图的左右两侧能看到远处水母剪影在卡片之间飘。
    if (this.phase === 'shop' || this.phase === 'decide' || this.phase === 'result') {
      this.gDim.clear()
      return
    }

    // 极淡的一层环境色，把背景图色调往 UI 色系拉一点（不能压死画面）
    g.fillStyle(L.tint, 0.10)
    g.fillRect(0, 0, W, H)

    // 海雪：越深越密。它是「我确实在水里」最直接的证据
    for (const m of this.motes) {
      g.fillStyle(0xbfd8e6, m.a * 0.5)
      g.fillCircle(m.x, m.y, m.r)
    }

    // ---- 每层的动态层（静态世界交给背景图）----
    if (this.layerIdx === 3) {
      // L4 热泉带：上升热流。背景图是静帧，这里补上流动感。
      // 关键：热流必须**和 movePlayer 里的 ventPush 用同一个空间梯度**（越靠下越强），
      // 否则玩家看到热流在动、却被一股看不见的力顶走，会认为是 bug。
      for (let i = 0; i < 3; i++) {
        const bx = W * (0.18 + i * 0.32)
        for (let k = 0; k < 10; k++) {
          const tt = (this.t * 0.35 + k / 10) % 1
          const yy = H - 130 - tt * 250
          const ww = 10 + tt * 34
          g.fillStyle(UI.amber, 0.055 * (1 - tt))
          g.fillEllipse(bx + Math.sin(tt * 6 + i) * 16, yy, ww, ww * 0.6)
        }
        // 泉口：底部固定的一个暗红热源，标出"推力从哪来"
        const px2 = bx + Math.sin(this.t * 2 + i) * 6
        glowPool(g, px2, H - 122, 90, 44, UI.amber, 4, 0.13)
      }
      // 全屏上升条纹：把"整片水都在往上走"画出来，这是玩家被顶的视觉解释
      for (let i = 0; i < 16; i++) {
        const sx = (i * 97 + ((this.t * 70) % 97)) % W
        const sy = H - ((this.t * 70 + i * 133) % (H + 160))
        g.fillStyle(UI.amber, 0.05)
        g.fillRect(sx, sy, 2, 26)
      }
    } else if (this.layerIdx === 4) {
      // L5 深渊带：远处生物的冷光，缓慢明灭
      for (let i = 0; i < 6; i++) {
        const bx = (i * 233) % W
        const by = (i * 151) % H
        const a = 0.06 + 0.04 * Math.sin(this.t * 0.6 + i)
        glowPool(g, bx, by, 120, 90, UI.violet, 4, a * 0.5)
      }
    } else if (this.layerIdx === 0) {
      // L1 阳光带：光柱里缓慢上升的泡泡，强化「浅层还有光」
      for (let i = 0; i < 7; i++) {
        const cx = 120 + (i % 4) * (W - 240) / 3
        const tt = (this.t * 0.12 + i * 0.143) % 1
        g.fillStyle(0xdff8ff, 0.11 * (1 - tt))
        g.strokeCircle(cx + Math.sin(tt * 5 + i) * 12, H * 0.78 - tt * H * 0.62, 3 + tt * 7)
      }
    }

    // ---- 远景生物层（矢量实时绘制，绝不用贴图）----
    //
    // 画法要点，三个动作叠起来才有"活"的感觉：
    //   ① 伞盖随 pulse 收缩（半径 ×0.78→1.0，横向略宽、纵向略扁）
    //   ② 触须**滞后摆动**：用上一帧的伞盖相位驱动，所以触须比身体慢半拍
    //   ③ 半透明伞盖 + 实心边缘：远景生物不该有实心填充，会和敌人抢读
    for (const d of this.drift) {
      const pulse = Math.pow((Math.sin(d.ph) + 1) / 2, 3)
      const rw = d.r * (1 - pulse * 0.16)
      const rh = d.r * (1 - pulse * 0.28)
      const alpha = 0.13 + (1 - (1 - L.vis)) * 0.04   // 深水层稍微可见度高一点
      // 伞盖：半透明填充 + 描边
      g.fillStyle(d.col, alpha * 0.5)
      g.fillEllipse(d.x, d.y, rw * 2, rh * 2)
      neon(g, d.col, () => { g.strokeEllipse(d.x, d.y, rw * 2, rh * 2) },
        { width: 1.2, alpha: alpha * 2.4, bloom: false })
      // 触须：用**滞后相位**（d.ph - 0.9）驱动，视觉上比身体慢
      const lag = Math.sin(d.ph - 0.9)
      for (let k = -2; k <= 2; k++) {
        const ox = k * rw * 0.42
        const len = d.r * d.tent * (2.4 + Math.abs(lag) * 0.5)
        neonLine(g, d.x + ox, d.y + rh * 0.6,
          d.x + ox + lag * 6 * (1 + Math.abs(k) * 0.3), d.y + rh * 0.6 + len,
          d.col, { width: 1, alpha: alpha * 1.3, bloom: false })
      }
    }

    // 场地边界
    // 全屏边框：极淡的"仪表盘边缘"暗示，alpha 从 0.35 压到 0.15，否则太抢眼
    neon(g, UI.cyanDim, () => { g.strokeRect(12, 12, W - 24, H - 24) }, { width: 1, alpha: 0.15, bloom: false })

    // ---- 暗幕：压暗背景图 + 矢量层；实体在它之上绘制（V4 §2 铁律）----
    const dim = this.gDim
    dim.clear()
    // 基础压暗比 V6.2 轻：背景图本身已带明暗关系，
    // 再套旧公式 (1-vis)*0.88 会把 L3/L4 的实景压成一片死黑
    dim.fillStyle(UI.abyss, (1 - L.vis) * 0.42)
    dim.fillRect(0, 0, W, H)

    // ---- 暗角（vignette）：「视野被深度压缩」的压迫感来源 ----
    // 用同心环带由外向内叠加，每像素只画一次。若用渐变矩形直接填充，
    // 中心会被反复叠加成死黑（Canvas 无径向渐变，fillGradientStyle 是 WebGL-only）。
    const BANDS = 18
    const band = Math.min(W, H) / BANDS
    // 下潜过渡时暗角额外收缩一次（压力舱闭合的视觉暗示），叠加在深度曲线上
    const descBoost = this.phase === 'descending'
      ? Math.sin(Math.min(1, this.descT / this.descDur) * Math.PI) * 0.38
      : 0
    const strength = 0.16 + (1 - L.vis) * 0.72 + descBoost
    for (let i = 0; i < BANDS; i++) {
      const o = i * band
      const e = o + band
      const a = Math.pow(1 - i / BANDS, 2.4) * strength
      if (a < 0.004) continue
      dim.fillStyle(UI.abyss, a)
      dim.fillRect(o, o, W - o * 2, e - o)                 // 上
      dim.fillRect(o, H - e, W - o * 2, e - o)             // 下
      dim.fillRect(o, e, e - o, H - e * 2)                 // 左
      dim.fillRect(W - e, e, e - o, H - e * 2)             // 右
    }
  }

  // ==========================================================================
  // 实体绘制
  // ==========================================================================
  private draw(): void {
    const g = this.g
    g.clear()
    this.hideFish()   // 贴图是复用的，必须先全部隐藏再按存活状态显示

    // 共振肉屑（最底层，纯表现，不抢 gameplay 信息）
    this.drawDebris(g)
    // 声呐波前：画在敌人之下，避免一圈圈环把鱼群剪影盖住
    this.drawPulses(g)

    // 敌人：只画轮廓 + 发光核心，不填实体色（V4 §3.1 规则 ①）
    const lod = this.enemies.length > 80 ? 2 : this.enemies.length > 40 ? 1 : 0
    for (const e of this.enemies) {
      const col = e.flash > 0 ? WHITE : e.color
      const charging = (e.kind === 'dash' && e.phase === 'charge')
        || (e.kind === 'boss' && e.phase === 'charge')
      const c = charging ? UI.danger : col   // 蓄力期转纯红（V4 §3.4）

      // 暗色衬底：以前只有霓虹描边，在 L1 亮珊瑚背景上会被背景亮度吃掉。
      // 这层让「敌人发光核心任何层可见」的铁律在**亮背景**侧也成立
      // （V4 §2.2 原本只保证了暗背景侧）。深色背景下它几乎不可见，不影响 L2-L5。
      // ---- 具象鱼体（半透明贴图）+ 霓虹描边 ----
      //
      // 分工：贴图负责「具体形象」（形状、体积、鳞片），描边 + 2px 发光核心负责「可读性」。
      // 半透明是刻意的——满屏 70+ 条鱼时，实心贴图互相遮挡就分不清谁在动；
      // alpha 0.55 让重叠时还能透出后面的轮廓，而描边保证每条都有自己的边界。
      // 蓄力（charge）时切到纯红并提到 0.85 alpha，预警必须醒目（V4 §3.4）。
      const sprite = this.fishSprite(e, c)
      if (sprite) {
        // ---- 深色层的可读性兜底（L3-L5）----
        //
        // 鱼贴图本身是暗色（深蓝灰 + 发光内脏线），叠到同样深的 L3-L5 背景上
        // 会「糊进背景」，远距离只剩一个亮点。
        //
        // 踩过的坑：**先做了一版「暗色实心椭圆衬底」，结果更糟**。
        // 小鱼（r=6，贴图才17px）身上那个 2.5r×1.8r 的实心椭圆比鱼本身还大，
        // 直接把鱼盖成一坨白色亮斑，满屏看起来就是「白色小飞虫」（L4 实测）。
        //
        // 现在只留**描边环**（不填充）：它给出清晰的定位圈 + 把鱼从背景里分离，
        // 又不会遮挡鱼身。描边半径必须贴合鱼的实际显示尺寸（贴图留了边距，
        // 所以 2.05r 刚好圈住轮廓），不能再放大。
        const darkLayer = this.layer().vis < 0.5
        if (darkLayer && lod < 2) {
          const rw = e.r * 2.05, rh = e.r * 1.5
          neon(g, c, () => {
            g.strokeEllipse(e.x, e.y, rw, rh)
          }, { width: 1.4, alpha: 0.62, bloom: false })
        }
        sprite.setPosition(e.x, e.y)
        // 水母是俯视对称、靠上下浮动，不做旋转；其余鱼身朝玩家
        const face = Math.atan2(this.py - e.y, this.px - e.x)
        sprite.setRotation(face - e.texRot)
        // 贴图素材已经按「缩小到 40px 仍保色」预处理过（高光压到~130、饱和度×1.45），
        // 所以这里可以给足 alpha，不需要再人为压暗。压暗反而在深色层里丢细节。
        sprite.setAlpha(charging ? 0.92 : 0.88)
        // tint 在 WebGL 下是加色混合：给白色会把暗色鱼身烧成一片亮白（L4 实测）。
        // 所以常态用 clear（不染色），只有蓄力时才叠一层红。
        // 受击白闪（V6.9 打击感）：用 setTintFill 烧成纯白剪影，命中瞬间"啪"地亮一下
        if (e.flash > 0) sprite.setTintFill(0xffffff)
        else if (charging) sprite.setTint(0xff6060)
        else sprite.clearTint()
        sprite.setVisible(true)
        // 蓄力预警圈画在贴图之上，必须压得住
        if (charging && e.kind !== 'boss') {
          neonCircle(g, e.x, e.y, e.r * 1.6, UI.danger, { width: 2, alpha: 0.7, bloom: false })
        }
        // Boss 血条 + 蓄力预警圈（Boss 用矢量画，贴图只做剪影）
        if (e.kind === 'boss') {
          const bwid = 220, bx = e.x - bwid / 2, by = e.y - e.r - 26
          g.fillStyle(UI.panel, 0.8); g.fillRect(bx, by, bwid, 8)
          g.fillStyle(UI.violet, 1); g.fillRect(bx, by, bwid * Math.max(0, e.hp / e.maxHp), 8)
          g.lineStyle(1, UI.line, 0.9); g.strokeRect(bx, by, bwid, 8)
          if (charging) {
            const kk = e.t / 1.2
            neonCircle(g, e.x, e.y, 220 * (0.6 + 0.4 * kk), UI.danger,
              { width: 3, alpha: 0.5 + 0.4 * kk, bloom: false })
          }
        }
        // 发光核心（铁律：每条鱼都有，远距离也能定位）。必须画在贴图之上。
        g.fillStyle(c, 1)
        g.fillCircle(e.x, e.y, 2)
        // V6.10：普通敌人的小血条已移除。理由见 drawBones 上方注释 ——
        // 满屏 40+ 条鱼时，每个受损个体头顶一条 3.5px 的横条，
        // 画面会被切成"一堆带横杠的图标"，比没有更乱。
        // 血量信息改由**体型 + 掉血飘字 + 击杀反馈**承担（见 hurt / spawnDeathFx）。
        continue    // 贴图路径已画完，矢量轮廓跳过
      }

      // 小体型（走矢量路径的小鱼）不能给满强度描边。
      // neon() 会叠三层（外发光 + 光晕 + 芯线），在 r=11 这种尺寸上三层叠加
      // 等于一根实心亮环 —— 满屏看就是"白色小飞虫"（L4 实测）。
      // 体型越小描边越细、bloom 关掉，靠发光核心保证可见性即可。
      const small = e.r < 14
      const sw = small ? 1.2 : 2
      const sb = small ? false : lod === 0

      if (lod < 2) {
        g.fillStyle(UI.abyss, 0.30)
        g.fillCircle(e.x, e.y, e.r * 1.18)
      }

      if (e.kind === 'swarm') {
        // 纺锤签名：椭圆 + 三角尾。
        // 尾鳍必须接在**椭圆尾端之外**（沿朝向前进方向的反向），
        // 画在椭圆内部会变成"单眼鱼"，剪影验收过不了（第一版实测）。
        const a = Math.atan2(this.py - e.y, this.px - e.x)
        const ca = Math.cos(a), sa = Math.sin(a)
        const rx = e.r * 1.15, ry = e.r * 0.68
        const tx = e.x - ca * rx, ty = e.y - sa * ry
        const nx2 = -ca, ny2 = -sa
        const px2 = -sa, py2 = ca
        if (lod < 2) {
          neon(g, c, () => {
            g.beginPath()
            g.moveTo(tx, ty)
            g.lineTo(tx + nx2 * 11 + px2 * 7, ty + ny2 * 11 + py2 * 7)
            g.lineTo(tx + nx2 * 11 - px2 * 7, ty + ny2 * 11 - py2 * 7)
            g.closePath(); g.strokePath()
          }, { width: sw, bloom: false })
        }
        neon(g, c, () => { g.strokeEllipse(e.x, e.y, rx * 2, ry * 2) },
          { width: sw, bloom: sb, alpha: small ? 0.7 : 1 })
      } else if (e.kind === 'drift') {
        // 钟形水母：半圆顶 + 触须
        const pulse = 1 + 0.12 * Math.sin(this.t * 2.2 + e.x * 0.01)
        const rr = e.r * pulse
        neon(g, c, () => {
          g.beginPath()
          g.arc(e.x, e.y, rr, Math.PI, 0, false)
          g.closePath(); g.strokePath()
        }, { width: sw, bloom: sb, alpha: small ? 0.66 : 1 })
        if (lod < 2) {
          for (let k = -1; k <= 1; k++) {
            const ox = k * rr * 0.5
            neonLine(g, e.x + ox, e.y + 2, e.x + ox + Math.sin(this.t * 3 + k) * 6, e.y + rr * 1.5,
              c, { width: 1, alpha: small ? 0.34 : 0.6, bloom: false })
          }
        }
      } else if (e.kind === 'boss') {
        // 深渊守望者：巨环 + 内部旋转多角 + Boss 血条
        const rot = this.t * 0.5
        neonCircle(g, e.x, e.y, e.r, c, { width: 3, bloom: true })
        neonCircle(g, e.x, e.y, e.r * 1.45, c, { width: 1, alpha: 0.35, bloom: false })
        neon(g, c, () => {
          g.beginPath()
          for (let k = 0; k < 7; k++) {
            const a2 = rot + (k / 7) * Math.PI * 2
            const rr = e.r * (0.42 + 0.16 * Math.sin(this.t * 2 + k))
            const xx = e.x + Math.cos(a2) * rr
            const yy = e.y + Math.sin(a2) * rr
            if (k === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy)
          }
          g.closePath(); g.strokePath()
        }, { width: 2, bloom: true })
        // Boss 血条（全场唯一允许显示血条的敌人）
        const bwid = 220, bx = e.x - bwid / 2, by = e.y - e.r - 26
        g.fillStyle(UI.panel, 0.8); g.fillRect(bx, by, bwid, 8)
        g.fillStyle(UI.violet, 1); g.fillRect(bx, by, bwid * Math.max(0, e.hp / e.maxHp), 8)
        g.lineStyle(1, UI.line, 0.9); g.strokeRect(bx, by, bwid, 8)
        // 蓄力预警圈
        if (charging) {
          const kk = e.t / 1.2
          neonCircle(g, e.x, e.y, 220 * (0.6 + 0.4 * kk), UI.danger,
            { width: 3, alpha: 0.5 + 0.4 * kk, bloom: false })
        }
      } else {
        // 菱形翼签名 + 长尾
        const a = Math.atan2(this.py - e.y, this.px - e.x)
        const ca = Math.cos(a), sa = Math.sin(a)
        const px1 = e.x + ca * e.r * 1.5, py1 = e.y + sa * e.r * 1.5
        const px2 = e.x - ca * e.r, py2 = e.y - sa * e.r
        const wx = -sa * e.r * 1.1, wy = ca * e.r * 1.1
        neon(g, c, () => {
          g.beginPath()
          g.moveTo(px1, py1); g.lineTo(e.x + wx, e.y + wy)
          g.lineTo(px2, py2); g.lineTo(e.x - wx, e.y - wy)
          g.closePath(); g.strokePath()
        }, { width: 2, bloom: lod === 0 })
        if (lod < 2) neonLine(g, px2, py2, px2 - ca * 22, py2 - sa * 22, c, { width: 2, bloom: false })
        // 蓄力预警线（红色指示线 + core 转红）
        if (charging) {
          neonLine(g, e.x, e.y, e.x + e.dirX * 60, e.y + e.dirY * 60, UI.danger, { width: 2, bloom: false })
        }
      }
      // 发光核心：远距离也能看见的一个 2px 亮点（铁律）
      g.fillStyle(c, 1)
      g.fillCircle(e.x, e.y, 2)
      // 受击白闪（矢量路径）：叠一层白色椭圆剪影，命中瞬间"啪"地亮一下
      if (e.flash > 0) {
        g.fillStyle(0xffffff, Phaser.Math.Clamp(e.flash / 0.09, 0, 1) * 0.62)
        g.fillEllipse(e.x, e.y, e.r * 2.3, e.r * 1.7)
      }
      // V6.10：矢量路径同样不再画小血条（与贴图路径保持一致）
    }

    // 弹幕（曳光弹 / 鱼雷 / 电弧 / 爆炸环）画在敌人之上：玩家的攻击必须看得见
    this.drawProjectiles(g)
    // 回声标记与酸液云画在弹幕同层：它们是"玩家放下的东西"，必须看得见
    this.drawEchoes(g)
    this.drawAcids(g)
    // 冲击波（V6.10）：压在敌人之上、弹幕之下。
    // 必须在弹幕之下 —— 曳光弹正飞向目标时，如果圈盖住弹道，
    // 玩家会以为弹打歪了。圈是"结果"，弹是"过程"，过程优先。
    this.drawShocks(g)
    // 击打痕（V6.10）：压在冲击波之上、火花之下
    this.drawSlashes(g)
    // 火花画在弹幕之上：命中迸溅和枪口闪光是"最亮的那一瞬间"，
    // 被弹体盖住就失去意义了
    this.drawSparks(g)
    // 飘字画在火花之上：数字必须是最清晰的层，不能被粒子盖住
    this.drawFloats(g)

    // 鱼骨（画在敌人之上：V4 §3.3 掉落物必须最先被看见）
    this.drawBones(g)

    // 玩家潜航器（V4 §3.1 规则 ③：永远最亮的青蓝）
    this.drawSub(g)

    // 排气爆发环
    if (this.burstTimer > O2.burstCd - 0.4) {
      const k = 1 - (this.burstTimer - (O2.burstCd - 0.4)) / 0.4
      neonCircle(g, this.px, this.py, O2.burstR * k, WHITE, { width: 3, alpha: 1 - k, bloom: false })
    }
  }

  // ==========================================================================
  // 表现层：声呐波前 / 肉屑 / 鱼骨 / 潜航器
  // ==========================================================================

  /**
   * 声呐波前 —— **已按用户要求移除圆环视觉**。
   *
   * 原本是从潜航器向外扩散的同心圆环（主环 + 内侧余波 + 外侧预兆）。
   * 玩家反馈「弹射圆圈是啥，这个不需要」：满屏扩散的圆环既不像声呐，
   * 又和弹幕混在一起干扰读图。
   *
   * `pulses` 数据结构**保留**：它承载声呐的伤害判定（环形波前扫过敌人），
   * 移除的只是绘制。命中反馈改用已有的 `e.flash` 命中闪白 —— 命中时鱼身
   * 自己亮一下，比从玩家身上扩散一个大圈更直接，也不挡视野。
   */
  private drawPulses(_g: Phaser.GameObjects.Graphics): void {
    return
  }

  /**
   * 弹幕层：机关枪曳光 / 鱼雷与尾迹 / 链式电弧 / 爆炸冲击环。
   *
   * 三条表现铁律（V4 §3.2「玩家攻击必须比敌人更亮」）：
   *   ① 曳光弹带**尾迹**，长度随速度，玩家能读出弹道方向而不需要瞄准辅助；
   *   ② 鱼雷必须有尾迹 + 前部亮点，否则追踪弹看起来像随机飞行的点；
   *   ③ 电弧是锯齿折线且**瞬亮瞬灭**（0.18s），如果做成常驻线条会变成
   *      「一堆看不懂的网」——瞬发性才是"放电"和"连线"的区别。
   */
  /**
   * 器械图形签名。图标必须在 11px 这种极小尺寸下还能区分，
   * 所以用**形状差异**而不是颜色差异：环 / 三道平行线 / 鱼形 / 折线闪电。
   * 玩家不该靠读文字才知道自己装了什么。
   *
   * V6.17：进化形态沿用它所属**族**的基础形状（形状记忆不重置），
   * 只在细节上变化（散弹管更多 / 鱼雷多枚 / 闪电多段 / 环多一层），
   * 右上角再加一个**菱形角标** —— 一眼分出"这是进化形态"。
   */
  private drawWeaponIcon(g: Phaser.GameObjects.Graphics, id: WeaponId,
                         cx: number, cy: number, s: number): void {
    const col = WEAPON_DEF[id].color
    const fam = weaponFamily(id)
    if (fam === 'sonar') {
      neonCircle(g, cx, cy, s * 0.9, col, { width: 1.6, alpha: 0.95, bloom: false })
      // 共振炮：多一层同心回波 —— 读作"伤害会往下传"
      if (id === 'sonar_rs') {
        neonCircle(g, cx, cy, s * 0.66, col, { width: 1.2, alpha: 0.55, bloom: false })
      }
      // 定向聚焦：把环画成一段粗弧（"聚焦" = 只朝一个方向）
      if (id === 'sonar_fc') {
        neon(g, col, () => {
          g.beginPath(); g.arc(cx, cy, s * 0.9, -0.9, 0.9); g.strokePath()
        }, { width: 3.2, bloom: false })
      }
      neonCircle(g, cx, cy, s * 0.42, col, { width: 1.4, alpha: 0.6, bloom: false })
    } else if (fam === 'gun') {
      // 霰弹画 5 根管（散射感），其余 3 根
      const n = id === 'gun_sg' ? 5 : 3
      for (let i = 0; i < n; i++) {
        const y = cy + (i - (n - 1) / 2) * (s * 0.44)
        neonLine(g, cx - s, y, cx + s, y, col,
          { width: id === 'gun_sg' ? 1.3 : 1.6, alpha: 0.9, bloom: false })
      }
      // 加特林：管口加一个转环
      if (id === 'gun_gl') {
        neonCircle(g, cx + s * 0.72, cy, s * 0.42, col, { width: 1.3, alpha: 0.8, bloom: false })
      }
    } else if (fam === 'torpedo') {
      // 集束：3 枚小号；重型：1 枚大号（尾鳍同比例放大）
      const n = id === 'torp_cl' ? 3 : 1
      const k = id === 'torp_cl' ? 0.62 : 1
      for (let i = 0; i < n; i++) {
        const oy = cy + (i - (n - 1) / 2) * (s * 0.62)
        neon(g, col, () => { g.strokeEllipse(cx + s * 0.15, oy, s * 1.35 * k, s * 0.72 * k) },
          { width: 1.5, bloom: false })
        g.beginPath()
        g.moveTo(cx - s * 0.5 * k, oy)
        g.lineTo(cx - s * 1.05 * k, oy - s * 0.55 * k)
        g.lineTo(cx - s * 1.05 * k, oy + s * 0.55 * k)
        g.closePath(); g.strokePath()
      }
    } else if (fam === 'harpoon') {
      // 鱼叉（V6.18）：长杆 + 倒刺箭头 —— "穿透"读得出来
      neonLine(g, cx - s, cy, cx + s * 0.5, cy, col, { width: 1.8, alpha: 0.9, bloom: false })
      neon(g, col, () => {
        g.beginPath()
        g.moveTo(cx + s, cy)
        g.lineTo(cx + s * 0.40, cy - s * 0.44)
        g.lineTo(cx + s * 0.56, cy)
        g.lineTo(cx + s * 0.40, cy + s * 0.44)
        g.closePath(); g.strokePath()
      }, { width: 1.5, bloom: false })
    } else if (fam === 'echo') {
      // 回声（V6.18）：三层同心弧（声波）+ 中心点
      for (let i = 1; i <= 3; i++) {
        neon(g, col, () => {
          g.beginPath(); g.arc(cx - s * 0.32, cy, s * 0.34 * i, -0.95, 0.95); g.strokePath()
        }, { width: 1.5, alpha: i === 1 ? 0.95 : 0.6, bloom: false })
      }
      g.fillStyle(col, 0.95); g.fillCircle(cx - s * 0.32, cy, s * 0.14)
    } else if (fam === 'acid') {
      // 酸液（V6.18）：主液滴 + 两枚溅出的小液滴
      g.fillStyle(col, 0.30); g.fillCircle(cx, cy, s * 0.52)
      neon(g, col, () => { g.strokeCircle(cx, cy, s * 0.52) }, { width: 1.6, bloom: false })
      g.fillStyle(col, 0.85)
      g.fillCircle(cx + s * 0.74, cy - s * 0.5, s * 0.16)
      g.fillCircle(cx - s * 0.68, cy + s * 0.56, s * 0.13)
    } else {
      if (id === 'arc_st') {
        // 雷暴：放射状多段 —— "一次电击全部目标"
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i / 6) * Math.PI * 2
          neonLine(g, cx, cy, cx + Math.cos(a) * s, cy + Math.sin(a) * s, col,
            { width: 1.4, alpha: 0.85, bloom: false })
        }
        g.fillStyle(col, 0.95); g.fillCircle(cx, cy, s * 0.18)
      } else {
        // 折线闪电（基础 / 过载共用主形）
        neon(g, col, () => {
          g.beginPath()
          g.moveTo(cx + s * 0.35, cy - s)
          g.lineTo(cx - s * 0.35, cy + s * 0.12)
          g.lineTo(cx + s * 0.1, cy + s * 0.12)
          g.lineTo(cx - s * 0.3, cy + s)
          g.strokePath()
        }, { width: 1.8, bloom: false })
        // 过载：左侧多一道小闪电（"链更长"）
        if (id === 'arc_ov') {
          neon(g, col, () => {
            g.beginPath()
            g.moveTo(cx - s * 0.78, cy - s * 0.9)
            g.lineTo(cx - s * 1.02, cy - s * 0.2)
            g.lineTo(cx - s * 0.82, cy - s * 0.2)
            g.lineTo(cx - s * 1.02, cy + s * 0.35)
            g.strokePath()
          }, { width: 1.4, alpha: 0.8, bloom: false })
        }
      }
    }
    // 进化角标：右上角一个小菱形（`fam !== id` 即"这是进化形态"）
    if (fam !== id) {
      const dx = cx + s * 0.88, dy = cy - s * 0.88, r = s * 0.26
      g.fillStyle(col, 0.95)
      g.beginPath()
      g.moveTo(dx, dy - r); g.lineTo(dx + r, dy)
      g.lineTo(dx, dy + r); g.lineTo(dx - r, dy)
      g.closePath(); g.fillPath()
    }
  }

  /**
   * 取一个敌人贴图对象（池化）。
   *
   * 返回 null 表示"这条敌人该走矢量路径"——三种情况：
   *   ① 同屏敌人 >80：贴图数量太多（每条都是独立 draw call），退回纯矢量
   *   ② 贴图未就绪（preload 未完成）：退回矢量，至少不崩
   *   ③ **体型太小（显示尺寸 < 26px）**：这是实测踩出来的第三条。
   *      水母贴图 60% 面积是细触须，缩到 14px 后触须和伞盖糊成一团白，
   *      屏幕上就是一颗"白色小飞虫"。贴图的优势是细节，细节在 14px 上
   *      反而变成噪声 —— 所以小体型一律走矢量：水母本来就是半透明飘浮的
   *      矢量生物更合适，梭形鱼/翼型鱼这些小体型则保留矢量轮廓 + 发光核心。
   */
  private fishSprite(e: Enemy, col: number): Phaser.GameObjects.Image | null {
    if (this.enemies.length > 120) return null
    // 显示尺寸阈值：低于 26px 贴图细节会糊成一团，走矢量
    if (e.r * 2.4 < 26 && e.kind !== 'boss') return null
    const key = e.tex
    let img = this.fishPool.find(im => im.getData('key') === key && !im.visible)
    if (!img) {
      if (!this.textures.exists(key)) return null
      img = this.add.image(0, 0, key).setDepth(40)
      this.uiCam.ignore(img)   // 敌人贴图是世界对象：只归主相机
      this.fishPool.push(img)
    }
    // 显示尺寸：**必须按素材真实宽高比**，不能一律拉成正方形。
    //
    // 踩过的坑（2026-10-12，用户："海生物还是黑色的 / 看不清"）：
    // 旧代码是 `setDisplaySize(s, drift ? s*0.8 : s)` —— 非水母一律给正方形，
    // 而素材内容宽高比实测是 swarm 1.99 / drift 1.54 / dash 0.55，
    // 于是被拉伸 1.54~1.99 倍：**一条 2:1 的长鱼被压成一个方块**。
    // 这既毁掉了"这是条鱼"的剪影识别，也是它看起来像"黑块"的物理原因之一。
    //
    // 现在：长边固定 = r × 3.1（比原来的 2.4 更大，回应"体积还是太小"），
    // 短边按素材比例算。碰撞半径 r 不变，所以只改视觉、不改平衡。
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number }
    const ar = (src && src.height) ? src.width / src.height : 1
    const L = e.r * 3.1
    const dw = ar >= 1 ? L : L * ar
    const dh = ar >= 1 ? L / ar : L
    img.setDisplaySize(dw, dh)
    img.setData('key', key)
    img.setBlendMode(Phaser.BlendModes.NORMAL)
    return img
  }

  /** 隐藏所有敌人贴图（每帧绘制前调用，避免上一帧残留） */
  private hideFish(): void {
    for (const im of this.fishPool) im.setVisible(false)
  }

  private drawProjectiles(g: Phaser.GameObjects.Graphics): void {
    // —— 爆炸冲击环：先画（在最底层），压住后面的曳光弹 ——
    for (const b of this.blasts) {
      const k = 1 - b.life / 0.32                 // 1 → 0
      neonCircle(g, b.x, b.y, b.r * (0.35 + 0.75 * k), UI.amber,
        { width: 3 * (1 - k) + 0.6, alpha: (1 - k) * 0.85, bloom: false })
      if (k < 0.5) {
        neonCircle(g, b.x, b.y, b.r * 0.5 * (1 - k * 2), UI.danger,
          { width: 2, alpha: 0.5 * (1 - k * 2), bloom: false })
      }
    }

    // —— 链式电弧：锯齿折线 + 外发光 ——
    for (const a of this.arcs) {
      const al = Phaser.Math.Clamp(a.life / 0.18, 0, 1)
      for (let pass = 0; pass < 2; pass++) {
        const wide = pass === 0
        neon(g, wide ? UI.violet : WHITE, () => {
          g.beginPath()
          for (let i = 0; i < a.pts.length - 1; i++) {
            const p0 = a.pts[i], p1 = a.pts[i + 1]
            if (i === 0) g.moveTo(p0.x, p0.y)
            // 每段切成 4 小节，每节加一个垂直方向的随机偏移 → 锯齿
            const dx = p1.x - p0.x, dy = p1.y - p0.y
            const nx = -dy, ny = dx
            const nl = Math.max(1, Math.hypot(nx, ny))
            for (let s = 1; s <= 4; s++) {
              const t = s / 4
              const off = s === 4 ? 0
                : (Math.sin(this.t * 60 + i * 7 + s * 3.1) * 13) / nl
              g.lineTo(p0.x + dx * t + nx * off, p0.y + dy * t + ny * off)
            }
          }
          g.strokePath()
        }, { width: wide ? 5 : 1.8, alpha: (wide ? 0.30 : 0.95) * al, bloom: false })
      }
    }

    // —— 通用弹：机关枪曳光 / 鱼雷 ——
    //
    // 玩家反馈「发射的子弹不够酷炫」。旧版是一条单色直线 + 一个白点，
    // 在满屏特效里完全没有存在感。重写成三段式：
    //   ① **多层递减拖尾**：不是一条线，是 4 层叠出来的锥形残影，
    //      越往后越细越淡 —— 速度感来自"长度梯度"而不是长度本身
    //   ② **外发光晕**：弹头外包一层同色大半径低透明圆，让弹在深色层也发光
    //   ③ **亮核**：白点 + 一圈本色环，弹头必须是全屏最亮的东西之一
    // 鱼雷额外画**真实弹体轮廓**（尖头 + 圆柱身 + 尾翼），不再是一根线段。
    for (const b of this.bullets) {
      const sp = Math.max(1, Math.hypot(b.vx, b.vy))
      const ux = b.vx / sp, uy = b.vy / sp
      // 垂直于弹道的方向，用来画鱼雷弹体的宽度
      const px2 = -uy, py2 = ux

      if (b.kind === 'gun') {
        const col = UI.amber
        // ① 4 层递减拖尾
        for (let i = 0; i < 4; i++) {
          const L0 = 10 + i * 7, L1 = L0 + 8
          neonLine(g,
            b.x - ux * L0, b.y - uy * L0,
            b.x - ux * L1, b.y - uy * L1,
            col, { width: 3.4 - i * 0.7, alpha: 0.9 / (i + 1.4), bloom: false })
        }
        // ② 外发光晕
        g.fillStyle(col, 0.22)
        g.fillCircle(b.x, b.y, 6.5)
        g.fillStyle(col, 0.40)
        g.fillCircle(b.x, b.y, 3.6)
        // ③ 亮核 + 本色环
        neonCircle(g, b.x, b.y, 2.6, col, { width: 1.6, alpha: 0.9, bloom: false })
        g.fillStyle(WHITE, 1)
        g.fillCircle(b.x, b.y, 1.7)
      } else {
        const col = UI.danger
        // ① 气泡尾迹：鱼雷在水里跑，尾迹应该是气泡不是焰火
        for (let i = 1; i <= 5; i++) {
          const bx = b.x - ux * i * 7, by = b.y - uy * i * 7
          const wob = Math.sin(this.t * 9 + i * 1.7) * (1.6 + i * 0.5)
          g.fillStyle(col, 0.5 / i)
          g.fillCircle(bx + px2 * wob, by + py2 * wob, 3.2 - i * 0.42)
        }
        // ② 外发光晕
        g.fillStyle(col, 0.20)
        g.fillCircle(b.x, b.y, 9)
        // ③ 真实弹体轮廓：尖头 + 圆柱身 + 尾翼（沿弹道方向的局部坐标）
        const Nose = 7, Tail = 8, Half = 3.4
        neon(g, UI.danger, () => {
          g.beginPath()
          g.moveTo(b.x + ux * Nose, b.y + uy * Nose)                       // 弹头尖
          g.lineTo(b.x - ux * Tail + px2 * Half, b.y - uy * Tail + py2 * Half)  // 身尾·右
          g.lineTo(b.x - ux * (Tail + 3) + px2 * (Half + 2.6),             // 尾翼·右
            b.y - uy * (Tail + 3) + py2 * (Half + 2.6))
          g.lineTo(b.x - ux * (Tail + 3) - px2 * (Half + 2.6),             // 尾翼·左
            b.y - uy * (Tail + 3) - py2 * (Half + 2.6))
          g.lineTo(b.x - ux * Tail - px2 * Half, b.y - uy * Tail - py2 * Half)  // 身尾·左
          g.closePath(); g.strokePath()
        }, { width: 1.8, alpha: 1, bloom: false })
        // 弹体填色（暗红实心，让它有"实体"而不是线框）
        g.fillStyle(UI.danger, 0.55)
        g.beginPath()
        g.moveTo(b.x + ux * Nose, b.y + uy * Nose)
        g.lineTo(b.x - ux * Tail + px2 * Half, b.y - uy * Tail + py2 * Half)
        g.lineTo(b.x - ux * Tail - px2 * Half, b.y - uy * Tail - py2 * Half)
        g.closePath(); g.fillPath()
        // ④ 头部亮点
        g.fillStyle(WHITE, 1)
        g.fillCircle(b.x + ux * 4, b.y + uy * 4, 2.3)
      }
    }
  }

  /** 共振震散的软组织碎片：向外飞散并淡出（纯表现） */
  /** 回声标记：收缩环 + 中心点 —— 环越小 = 越快爆，一眼读出"还剩多久" */
  private drawEchoes(g: Phaser.GameObjects.Graphics): void {
    for (const e of this.echoes) {
      const k = Phaser.Math.Clamp(e.t / 0.75, 0, 1)
      const col = UI.magenta
      neonCircle(g, e.x, e.y, 130 * k, col,
        { width: 2, alpha: 0.35 + 0.45 * (1 - k), bloom: false })
      neonCircle(g, e.x, e.y, 8 + 46 * (1 - k), col,
        { width: 1.4, alpha: 0.7, bloom: false })
      g.fillStyle(col, 0.9); g.fillCircle(e.x, e.y, 3)
    }
  }

  /** 酸液云：外圈 + 内部漂浮的酸泡，读作"这块地现在是酸的" */
  private drawAcids(g: Phaser.GameObjects.Graphics): void {
    for (const a of this.acids) {
      const k = Phaser.Math.Clamp(a.life / 3.0, 0, 1)
      const col = UI.jadeHi
      g.fillStyle(col, 0.10 * k)
      g.fillCircle(a.x, a.y, a.r)
      neonCircle(g, a.x, a.y, a.r, col,
        { width: 1.6, alpha: 0.30 + 0.30 * k, bloom: false })
      for (let i = 0; i < 5; i++) {
        const ang = i * 1.257 + a.life * 1.6
        const rr = a.r * (0.32 + 0.42 * ((i % 3) / 3))
        g.fillStyle(col, 0.45 * k)
        g.fillCircle(a.x + Math.cos(ang) * rr, a.y + Math.sin(ang) * rr, 2.6)
      }
    }
  }

  private drawDebris(g: Phaser.GameObjects.Graphics): void {
    for (const d of this.debris) {
      const a = Math.max(0, d.life / d.maxLife)
      g.fillStyle(d.color, a * 0.7)
      g.fillCircle(d.x, d.y, d.r)
    }
  }

  /**
   * 鱼骨：击杀后留下的发光骨架——脊椎 + 肋骨 + 头骨 + 尾鳍骨，自转下沉。
   * 用全场唯一的近白色 BONE，满屏混乱时最先被看见（V4 §3.3）。
   * 大鱼留大骨架，所以"挑大鱼打"在视觉上直接可读，不用看数值。
   */

  private drawBones(g: Phaser.GameObjects.Graphics): void {
    for (const b of this.bones) {
      // 沉底后开始淡出：用 alpha 渐隐 + 末段闪烁提示"要没了"
      const f = Phaser.Math.Clamp(b.fade / O2.boneFade, 0, 1)
      const blink = f < 0.4 ? (Math.sin(this.t * 25) > 0 ? 1 : 0.4) : 1
      // 淡出期间略微变暗，制造"沉进黑暗里"的感觉而不是单纯变透明
      const sink = 0.55 + 0.45 * f
      const ca = Math.cos(b.rot), sa = Math.sin(b.rot)
      const X = (lx: number, ly: number) => b.x + lx * ca - ly * sa
      const Y = (lx: number, ly: number) => b.y + lx * sa + ly * ca
      const L = b.size, half = L / 2
      const a = 0.55 * blink * f          // V6.9 提亮：拾取物必须一眼可辨（旧 0.42 太隐身）

      // 柔光晕 + 呼吸脉冲环：让「这是能捡的」从剪影层面就读得懂，不再像散落白骨
      g.fillStyle(BONE, 0.06 * f)
      g.fillCircle(b.x, b.y, L * 1.05)
      g.fillStyle(UI.cyan, 0.05 * f)
      g.fillCircle(b.x, b.y, L * 1.5)
      const pk = (this.t * 0.7 + b.rot) % 1
      g.lineStyle(1.2, BONE, 0.26 * (1 - pk) * f)
      g.strokeCircle(b.x, b.y, L * (0.5 + pk * 0.75))

      neonLine(g, X(-half, 0), Y(-half, 0), X(half, 0), Y(half, 0), BONE, { width: 1.6, alpha: a, bloom: false })
      // 肋骨 4 对：中间宽、两端窄
      for (let i = 0; i < 4; i++) {
        const lx = -half + (i + 1) * L / 5
        const h = L * 0.20 * Math.sin(((i + 1) / 5) * Math.PI)
        neonLine(g, X(lx, -h), Y(lx, -h), X(lx, h), Y(lx, h), BONE, { width: 1.2, alpha: a * 0.8, bloom: false })
      }
      // 头骨（前端小三角）
      neon(g, BONE, () => {
        g.beginPath()
        g.moveTo(X(half + 3, 0), Y(half + 3, 0))
        g.lineTo(X(half - 2, -3.2), Y(half - 2, -3.2))
        g.lineTo(X(half - 2, 3.2), Y(half - 2, 3.2))
        g.closePath(); g.strokePath()
      }, { width: 1.4, alpha: a, bloom: false })
      // 尾鳍骨（后端分叉）
      neon(g, BONE, () => {
        g.beginPath()
        g.moveTo(X(-half, 0), Y(-half, 0))
        g.lineTo(X(-half - 5, -4.5), Y(-half - 5, -4.5))
        g.moveTo(X(-half, 0), Y(-half, 0))
        g.lineTo(X(-half - 5, 4.5), Y(-half - 5, 4.5))
        g.strokePath()
      }, { width: 1.2, alpha: a * 0.85, bloom: false })
      // 核心亮点：任何距离都看得见（V4 §2.2 铁律）
      g.fillStyle(BONE, a)
      g.fillCircle(b.x, b.y, 1.8)
    }
  }

  /**
   * 玩家潜航器。
   * 之前是"一个圆点 + 一条朝向线"，剪影零辨识度。改成小型单人潜航器：
   * 艇身朝移动方向，艇首的**探照灯锥天然指示朝向**（不用再画指示线），
   * 而且**灯越深越亮**——L1 阳光带几乎看不见灯，L5 深渊带灯是唯一照明。
   * 这一条把 V4 §2.2「分层可见度」直接落到了玩家自己身上。
   */
  /**
   * 具象潜航器 + 独立转向炮塔（V6.4）。
   *
   * 三层结构，从下到上：
   *   ① 边缘光（rim light）：椭圆高亮描边，让深色贴图在任何背景上都能读出来
   *   ② 机体贴图：跟随移动方向旋转
   *   ③ 炮塔塔头：4 个挂载点，**各自独立瞄准最近的敌人**（不是跟着机体转）
   *
   * 为什么炮塔要限幅在±60°：转太多会甩到机体前方，视觉上像"武器被甩出去"，
   * 而且会挡住潜航器本体。玩家感受得到"塔在瞄准"，但不会觉得失控。
   */
  private drawSub(g: Phaser.GameObjects.Graphics): void {
    const ca = Math.cos(this.aim), sa = Math.sin(this.aim)
    // 受击表现：**机体短促抖动**，而不是把整圈边缘光换成白框。
    //
    // 用户原话：「受击特效 为啥会白色亮框 应该是本体抖动比较好吧」——
    // 旧版 `pcol = hurtFlash > 0 ? WHITE : cyan` 会让 rim 椭圆在受击瞬间
    // 整圈变白，读起来像给艇"扣了一个白色亮框"，和"被打到"没有因果感。
    // 改成位移抖动：本体（连同座圈、炮塔、探照灯锥，它们都基于 X/Y）在
    // 0.35s 内做 ±3.5px 随机抖动 —— 这是"挨了一下"最直觉的反馈。
    const hb = this.hurtFlash > 0 ? Phaser.Math.Clamp(this.hurtFlash / 0.35, 0, 1) : 0
    const jx = hb ? (Math.random() - 0.5) * 7 * hb : 0
    const jy = hb ? (Math.random() - 0.5) * 7 * hb : 0
    const bx = this.px + jx, by = this.py + jy
    const X = (lx: number, ly: number) => bx + lx * ca - ly * sa
    const Y = (lx: number, ly: number) => by + lx * sa + ly * ca
    // 边缘光颜色 = **该潜航器的主题色**（V6.20）。用户要"进游戏也要有区分感"：
    // 贴图已经不同，再给一圈主题色 rim，三台在满屏混战里也能一眼分辨。
    const pcol = this.sub.color

    // ---- ① 边缘光：深色贴图在深背景上可读的唯一保障 ----
    // 比机体贴图略大一圈的椭圆描边，颜色用玩家专属的青蓝（永远是全场最亮的青）。
    // 边缘光椭圆跟着机体一起放大：原来 34×19 是配 59×31 的艇身，
    // 艇身放大到 99×52 后 rim 必须同比放大，否则光晕缩在机体中间像颗蛋。
    // 圆形机体的边缘光：**正圆**（机体是圆盘，再用椭圆描边会露出破绽）
    const rimR = SUB_D / 2 + 4
    neon(g, pcol, () => { g.strokeCircle(bx, by, rimR) },
      { width: 2.4, alpha: 0.85, bloom: true })
    // 内圈用**中性冷白**而不是固定青色：外圈已经跟着潜航器主题色变了，
    // 内圈再固定青色会在刺鳐（玉绿）/ 深潜者（紫）上撞出脏边。
    neon(g, 0xeafcff, () => { g.strokeCircle(bx, by, rimR - 5) },
      { width: 1, alpha: 0.35, bloom: false })

    // ---- ② 机体贴图 ----
    // ⚠️ 必须**每帧恢复可见**：弹窗相位（商店 / 决策 / 结算）会把它
    // `setVisible(false)` 藏掉（那时它压在卡片上）。如果这里不恢复，
    // 玩家只要进过一次商店，机体就永久消失 —— 用户实测反馈
    // 「玩一会 机体本身不见了」，根因就是这个。
    this.subImg.setVisible(true)
    this.subImg.setPosition(bx, by)
    this.subImg.setRotation(this.aim)
    this.subImg.setTint(0xffffff)
    this.subImg.setAlpha(1)

    // ---- ③ 探照灯锥（从机体外缘向前展开）----
    const beamA = 0.09 + (1 - this.layer().vis) * 0.18
    const beamLen = 120, half = 0.34
    const beamX = SUB_D * 0.42
    g.fillStyle(0xdff8ff, beamA)
    g.beginPath()
    g.moveTo(X(beamX, 0), Y(beamX, 0))
    for (let i = 0; i <= 8; i++) {
      const ang = -half + (i / 8) * half * 2
      const lx = beamX + Math.cos(ang) * beamLen
      const ly = Math.sin(ang) * beamLen
      g.lineTo(X(lx, ly), Y(lx, ly))
    }
    g.closePath(); g.fillPath()

    // ---- ④ 发射塔：**圆形座圈 + 可插拔发射器**（V6.10 重做）----
    //
    // V6.6 的做法是「矩形挂架 + 同座双联」，代价有两个：
    //   · 矩形会随索敌旋转，旋转后与邻座重叠 → 必须把座推到 ±0.46 才不碰，
    //     结果塔心离艇身 24px，看起来像浮在机体外的独立零件；
    //   · 双联要在同一座塞两根管 + 画连接梁，满 6 台时剪影糊成一团。
    // 改成圆座之后这两条都不成立：**圆是旋转不变的**，塔转到任何角度
    // 半投影都还是 TURRET_R，座圈半径只需要满足"相邻座弦长 > 2·塔半径"。
    const gt = this.gTurret
    gt.clear()
    const plan = this.mountPlan()

    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]
      const w = this.weapons[i]
      if (!slot || !w) continue
      const seatX = SEAT_RING_R * Math.cos(slot.ang)
      const seatY = SEAT_RING_R * Math.sin(slot.ang)
      const mountX = X(seatX, seatY)
      const mountY = Y(seatX, seatY)

      // 独立索敌：塔的朝向**不在这里算**，直接取 slewTurretAims 每帧维护的
      // `w.aimAng` —— 出弹（turretPose）读的是同一个值，两处绝不会打架。
      // V6.26 之前这里另算了一遍 `机体朝向 + clamp(±70°)`，结果是
      // 「往上走就一直朝上打」：炮口被移动方向锁住了。
      const ang = w.aimAng
      // 装填进度 0..1：分母用**上一发的实际间隔**（含等级/齐射/高压供能），
      // 这样升级后装填环的转速和真实开火节奏仍然一致。
      const ivD = w.ivLast > 0 ? w.ivLast : w.iv
      const charge = Phaser.Math.Clamp(1 - w.timer / ivD, 0, 1)
      this.drawTurret(gt, mountX, mountY, ang, w, slot.ext, charge)
    }

    // ---- 空座：**不绘制**（V6.13）----
    //
    // 用户原话：「人家只有特定的镶嵌，其他都内置进去、不显示出来」。
    // 之前这里画 4 段虚线弧表示"还有空位"，但它和机体、装载器叠在一起
    // 就是一堆"挂在身边"的装饰，正是用户说的"太丑"。玩家需要知道还有空位
    // 的时机是**商店**（那里有专门的座 / 管位示意图），战斗里保持机体干净。
    void MAX_SEATS

    // ---- 座圈连线：**已删**（V6.13）----
    // 同样按用户的"其他都内置、不显示"处理：装载器之间不再用环线串起来，
    // 只留实际装配的装载器本身 —— Brotato 的武器也是各自独立挂着的。
    void SEAT_ANGLES_DEG

    // ---- ⑤ 推进器尾焰（移动时更长）----
    if (this.moving) {
      // 尾焰从圆形机体的后缘喷出（SUB_D/2 = 机体半径）
      const flame = Math.sin(this.t * 26) * 2.4 + 5
      const tail = -SUB_D * 0.46
      neonLine(g, X(tail, 0), Y(tail, 0), X(tail - flame, 0), Y(tail - flame, 0),
        UI.cyanHi, { width: 3, alpha: 0.75, bloom: true })
    }
  }

  /**
   * 发射塔 = **圆形转塔座**（g.save/rotate 后以 0,0 为中心）。
   *
   * 塔座本身用**通用色**（cyanDim），**不带武器色** —— 这是刻意的：
   * 座是艇上的固定设施，武器是可换的。如果塔座也染成武器色，
   * "这座塔能换装别的炮"这件事就说不通了。武器色只出现在发射器上。
   *
   * 三层结构（由内到外）：
   *   ① 底座实心圆（半透明，压在艇身上但不吃掉艇身）
   *   ② 转环缺口圆 —— 表达"这座会转"
   *   ③ 发射器（按 weapon id 画），指向局部 +x
   *
   * `ext` = 扩容解锁出来的座：加一圈琥珀色外环 + 略大 15% 半径。
   * 让"我的艇变强了"在**剪影**上直接看得见，而不是只能读 HUD 数字。
   */
  /**
   * 装载器（用户术语）+ 镶嵌其上的发射器。
   *
   * 用户需求（V6.12 / V6.13）：
   *   「装载器改成圆形的、重新立绘、不要是黑色的；发射器镶在装载器上；
   *     子弹跟随发射器；能很清晰看到发射器施法的过程」
   *   「需要小一点，能高点立体科技感吗，同时能镶嵌发射装置」
   *
   * 立体感怎么来（俯视角、光源在上，纯 Graphics，不依赖贴图 / 渐变）：
   *   ① 底盘分两层 —— 外环带（受光，中亮青）+ 内凹槽（背光，暗且**向下偏移**）。
   *      一亮一暗、再加一点点错位，就读作"一个有厚度的金属盘，中间凹下去"。
   *   ② 每道环都配**上亮下暗两条弧**（画整圆会平，画一段弧就足以骗过眼睛）。
   *   ③ 中心毂做成凸起：先投暗影 → 再压亮面 → 最后点一个左上高光点。
   *
   * 科技感：装填进度环（最外，12 点顺时针扫满）+ 凹槽壁受光弧 + 外缘金属高光弧。
   *
   * `charge` = 0..1 装填进度（1 = 就绪），由调用方用 `w.timer / w.ivLast` 算出。
   */
  private drawTurret(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                     ang: number, w: Weapon, ext: boolean, charge: number): void {
    const R = TURRET_R * (ext ? 1.15 : 1)
    const hot = w.fireFlash > 0
    g.save()
    g.translateCanvas(cx, cy)

    // ① 底盘外环带（受光面）：中亮青实底 —— 不填黑
    g.fillStyle(UI.cyanDim, 0.55)
    g.fillCircle(0, 0, R)
    // 环带上缘亮弧 / 下缘暗弧：一趟弧线就做出"圆柱侧面"的受光
    g.lineStyle(R * 0.22, UI.cyanHi, 0.34)
    g.beginPath(); g.arc(0, 0, R * 0.86, Math.PI * 1.08, Math.PI * 1.78); g.strokePath()
    g.lineStyle(R * 0.22, UI.abyss, 0.30)
    g.beginPath(); g.arc(0, 0, R * 0.86, Math.PI * 0.08, Math.PI * 0.78); g.strokePath()

    // ② 内凹槽（发射器的安装位）：暗面 + 向下偏移 = 凹进去
    g.fillStyle(UI.abyss, 0.40)
    g.fillCircle(0, R * 0.10, R * 0.72)
    // 凹槽内壁：左上受光
    g.lineStyle(R * 0.16, UI.cyanHi, 0.45)
    g.beginPath(); g.arc(0, R * 0.10, R * 0.66, Math.PI * 1.08, Math.PI * 1.72); g.strokePath()
    // 凹槽外沿投影：右下加深
    g.lineStyle(R * 0.16, UI.abyss, 0.28)
    g.beginPath(); g.arc(0, R * 0.06, R * 0.78, Math.PI * 0.12, Math.PI * 0.72); g.strokePath()

    // ③ 外缘亮环 + 左上金属高光弧
    neon(g, hot ? WHITE : UI.cyan, () => { g.strokeCircle(0, 0, R) },
      { width: 2.2, alpha: 0.95, bloom: hot })
    g.lineStyle(1.6, WHITE, 0.55)
    g.beginPath(); g.arc(0, 0, R * 0.92, Math.PI * 1.12, Math.PI * 1.56); g.strokePath()

    // ④ 装填进度环（最外，12 点起顺时针）—— "施法过程可见"的主件
    const a0 = -Math.PI / 2
    const progCol = hot ? WHITE : (charge > 0.985 ? UI.cyanHi : charge > 0.55 ? UI.cyan : UI.amber)
    neon(g, progCol, () => {
      g.beginPath()
      g.arc(0, 0, R * 1.38, a0, a0 + Math.PI * 2 * Math.max(0.001, charge))
      g.strokePath()
    }, { width: 2.0, alpha: 0.92, bloom: hot || charge > 0.985 })
    g.fillStyle(UI.cyanDim, 0.85)
    g.fillRect(-1.0, -R * 1.50, 2.0, 4)

    // ⑤ 中心毂（凸起）：暗影 → 亮面 → 高光点
    g.fillStyle(UI.abyss, 0.45)
    g.fillCircle(0, R * 0.07, R * 0.30)
    g.fillStyle(hot ? WHITE : UI.cyanHi, 0.95)
    g.fillCircle(0, 0, R * 0.26)
    g.fillStyle(WHITE, 0.9)
    g.fillCircle(-R * 0.08, -R * 0.08, R * 0.08)

    // ⑥ 扩容座：琥珀环 + 4 卡榫（和基础座一眼分开）
    if (ext) {
      neon(g, UI.amber, () => { g.strokeCircle(0, 0, R * 1.30) },
        { width: 1.4, alpha: 0.8, bloom: false })
      g.fillStyle(UI.amber, 0.9)
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4
        g.fillCircle(Math.cos(a) * R * 1.20, Math.sin(a) * R * 1.20, 1.4)
      }
    }

    // ⑦ 发射器：嵌在凹槽里，随索敌角旋转（子弹 / 枪口闪光也以它为准）
    g.rotateCanvas(ang)
    neonLine(g, 0, 0, R * 0.9, 0, hot ? WHITE : UI.cyanHi,
      { width: 2.0, alpha: 0.95, bloom: false })
    neon(g, hot ? WHITE : UI.cyanDim, () => { g.strokeCircle(0, 0, R * 0.46) },
      { width: 1.2, alpha: 0.8, bloom: false })
    this.drawEmitter(g, w.id, EMITTER_SIZE, hot)
    g.restore()
  }

  /**
   * 发射器（可插拔部件）。坐标系已被 `drawTurret` 平移旋转到挂架中心，
   * **指向局部 +x**，所以这里只管朝右画。
   *
   * 新增武器 = 新增一个分支，挂架那套完全不用动 —— 这就是"通用安装"的落点。
   */
  private drawEmitter(g: Phaser.GameObjects.Graphics, id: WeaponId,
                      s: number, firing: boolean): void {
    const col = WEAPON_DEF[id].color
    if (id === 'sonar') {
      // 声呐：三层同心弧，开口朝 +x（喇叭形辐射面）
      for (let i = 1; i <= 3; i++) {
        g.lineStyle(1.8, col, firing ? 1 : 0.7)
        g.beginPath(); g.arc(0, 0, s * 0.26 * i, -1.0, 1.0); g.strokePath()
      }
      g.fillStyle(col, 0.9); g.fillCircle(0, 0, s * 0.12)
    } else if (id === 'gun') {
      // 机关枪：三根平行枪管
      for (let i = -1; i <= 1; i++) {
        const yy = i * s * 0.3
        g.lineStyle(2.4, col, i === 0 ? 1 : 0.65)
        g.beginPath(); g.moveTo(-s * 0.35, yy); g.lineTo(s * 0.8, yy); g.strokePath()
      }
      // 枪口亮点：开火瞬间烧白，给"它在射击"的反馈
      g.fillStyle(firing ? WHITE : col, 0.95)
      g.fillCircle(s * 0.8, 0, s * 0.11)
    } else if (id === 'torpedo') {
      // 鱼雷发射管：粗筒 + 管口环。
      //
      // ⚠️ 这里**绝对不能填 UI.panelHi**（0x0e1a29，近黑）。曾经用 0.95 alpha 的
      // 近黑填充画管身，在 L1 明亮水层背景下就是一块**纯黑矩形** ——
      // 这正是用户反复反馈的"击杀之后有一个黑色方块"的真凶：
      // 鱼雷炮塔是座圈 4 座之一，它一亮相（或被命中闪白把周围衬托得更亮时）
      // 就能看到那块近黑的圆角矩形。炮塔本体和武器是同一个坐标系，
      // 所以它看起来像"凭空出现的黑方块"而不是"炮管"。
      // 现在改成「本色半透明管身 + 亮描边 + 亮管口环」，任何背景下都是发光炮管。
      g.fillStyle(col, 0.32)
      g.fillRoundedRect(-s * 0.4, -s * 0.3, s * 1.0, s * 0.6, 3)
      neon(g, col, () => { g.strokeRoundedRect(-s * 0.4, -s * 0.3, s * 1.0, s * 0.6, 3) },
        { width: 1.6, alpha: 0.95, bloom: false })
      // 管口环 + 内壁高光（让"这是个管口"有体积感，而不是一块实心色板）
      g.lineStyle(2, firing ? WHITE : col, 0.95)
      g.beginPath(); g.moveTo(s * 0.55, -s * 0.32); g.lineTo(s * 0.55, s * 0.32); g.strokePath()
      g.fillStyle(WHITE, firing ? 0.9 : 0.35)
      g.fillEllipse(s * 0.42, 0, s * 0.22, s * 0.4)
    } else {
      // 电弧：两根电极柱 + 中间跳跃的弧光
      g.lineStyle(2, col, 0.95)
      g.beginPath(); g.moveTo(-s * 0.2, -s * 0.36); g.lineTo(s * 0.5, -s * 0.36); g.strokePath()
      g.beginPath(); g.moveTo(-s * 0.2, s * 0.36); g.lineTo(s * 0.5, s * 0.36); g.strokePath()
      neon(g, firing ? WHITE : col, () => {
        g.beginPath()
        g.moveTo(s * 0.5, -s * 0.36)
        g.lineTo(s * 0.26, -s * 0.06)
        g.lineTo(s * 0.62, s * 0.06)
        g.lineTo(s * 0.38, s * 0.36)
        g.strokePath()
      }, { width: 1.6, bloom: firing })
    }
  }

  /** 空座：座圈上的空心圆点 + 中心十字，表示"这个位子还空着、可以装"。
   *  与 drawSub 里画的战斗内空座同源，商店里用小一号的版本。 */
  private drawEmptyMount(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                         ang: number, R: number): void {
    g.save()
    g.translateCanvas(cx, cy)
    g.lineStyle(1.2, UI.line, 0.5)
    g.strokeCircle(0, 0, R * 0.55)
    g.lineStyle(1, UI.line, 0.35)
    g.beginPath()
    g.moveTo(-4, 0); g.lineTo(4, 0)
    g.moveTo(0, -4); g.lineTo(0, 4)
    g.strokePath()
    g.restore()
  }

  // ==========================================================================
  // HUD（对应 UI规格 V3 §5）
  // ==========================================================================
  private drawHud(): void {
    const g = this.gHud
    g.clear()
    this.hideTexts()
    const W = this.scale.width
    const cx = W / 2
    const L = this.layer()

    // ① 深度指示（左侧）：**实时米数** + 层名
    //
    // 米数是「分层体感」的核心：玩家对 "3,400 m" 有真实的压迫联想，
    // 对 "L3 午夜带" 只是一个词。深度随本波推进连续增长（下潜感），
    // 而不是每波跳一次。
    const dx0 = 24, dy0 = 30
    const prog = 1 - this.waveTimer / Math.max(1, this.waves()[this.waveInLayer].dur)
    const depthNow = Phaser.Math.Clamp(
      L.depthTop + (L.depthBot - L.depthTop) * ((this.waveInLayer + prog) / this.waves().length),
      L.depthTop, L.depthBot)
    this.depthM = depthNow
    this.txt(Math.round(depthNow).toLocaleString(), dx0, dy0 - 8, '30px', TXT.cyber, MONO)
    // "m" 紧跟数字：按字符数估算宽度（30px MONO ≈ 17px/字），固定偏移会随位数漂移
    this.txt('m', dx0 + 14 + Math.round(depthNow).toLocaleString().length * 17, dy0 + 12, '12px', TXT.dim, MONO)
    this.txt(`L${this.layerIdx + 1} ${L.name}`, dx0, dy0 + 26, '13px', TXT.cyber, FONT)
    this.txt(L.sub, dx0, dy0 + 44, '12px', TXT.mute, MONO)
    // 本层机制标签（V6.23）：和入场卡同一个词，玩家能把"卡片上写的"和
    // "屏幕左上角一直是这个"对上号。无机制的层（L1）不显示，避免噪声。
    if (L.mech) {
      this.txt(`◆ ${L.mech}`, dx0, dy0 + 62, '13px', TXT.amber, FONT)
    }
    for (let i = 0; i < LAYERS.length; i++) {
      const yy = dy0 + 86 + i * 20
      const cur = i === this.layerIdx
      const done = i < this.layerIdx
      g.fillStyle(cur ? UI.cyan : (done ? UI.cyanDim : UI.line), cur ? 1 : 0.6)
      g.fillRect(dx0, yy, cur ? 26 : 16, 5)
      if (cur) {
        g.fillStyle(UI.cyan, 0.25)
        g.fillRect(dx0 + 30, yy - 4, 6, 13)
      }
    }
    this.txt(`×${this.mult.toFixed(1)}`, dx0, dy0 + 86 + LAYERS.length * 20 + 6, '14px', TXT.amber, MONO)

    // ② 氧气条（顶部居中，主 HUD）
    //
    // 两段式：剩余氧(实心) | 本层上限被压缩的余量(灰)
    // 分母用 max(基准, 当前上限)，这样买了扩容气瓶后条会**变长**（正反馈可见），
    // 又不会超出槽宽。下潜后上限压缩必须可见地变短——这是玩家理解
    // "越深容错越小"的唯一显式信号（UI规格 V3 §5.2）。
    const bw = 420, bh = 20, bx = cx - bw / 2, by = 26
    const full = Math.max(O2.max, this.o2Max)
    const curRatio = Phaser.Math.Clamp(this.o2 / full, 0, 1)
    const capRatio = Phaser.Math.Clamp(this.o2Max / full, 0, 1)
    const pct = this.o2 / this.o2Max
    const low = pct < 0.2
    const col = low ? UI.danger : (pct < 0.5 ? UI.amber : UI.cyan)
    // 低氧脉冲改**正弦**而不是方波：方波是"闪"，正弦是"呼吸"。
    // 呼吸感更接近窒息这个生理联想，而且不会在低帧率下抖动成噪点。
    const pulse = low ? 0.6 + 0.4 * Math.abs(Math.sin(this.t * 4.2)) : 1

    // 槽底 + 被压缩掉的上限余量（灰）
    g.fillStyle(UI.panel, 0.75); g.fillRoundedRect(bx, by, bw, bh, 9)
    if (capRatio < 1) {
      g.fillStyle(UI.line, 0.5); g.fillRoundedRect(bx + bw * capRatio, by, bw * (1 - capRatio), bh, 9)
    }
    // 剩余氧（实心）
    g.fillStyle(col, pulse)
    g.fillRoundedRect(bx, by, Math.max(2, bw * curRatio), bh, 9)

    // —— 刻度：每 20 单位一格，让"还剩几格"可以目测 ——
    // 空条上画细刻度，实心区上画暗色刻度（保证两种底色下都看得见）。
    const TICK = 20
    for (let v = TICK; v < full; v += TICK) {
      const tx = bx + bw * (v / full)
      if (tx > bx + bw - 2) break
      const lit = tx <= bx + bw * curRatio
      g.fillStyle(lit ? UI.abyss : UI.line, lit ? 0.45 : 0.55)
      g.fillRect(tx, by + 4, 1, bh - 8)
    }
    // —— 危险阈值线：20% 处一条竖线，越线即死 ——
    // 玩家不该靠心算判断"还剩多少会死"，把阈值画进条里。
    const dzX = bx + bw * (0.2 * this.o2Max / full)
    g.fillStyle(UI.danger, 0.55 + 0.35 * Math.abs(Math.sin(this.t * 2)))
    g.fillRect(dzX - 1, by - 3, 2, bh + 6)
    // 字号下限 12px（用户明确要求正文不得低于 12px，原来这里是 9px）
    this.txt('危险', dzX, by + bh + 12, '12px', TXT.warn, FONT, 'center')

    neon(g, low ? UI.danger : UI.cyanDim, () => { g.strokeRoundedRect(bx, by, bw, bh, 9) },
      { width: low ? 2 : 1, alpha: 0.8, bloom: false })
    // 数值用补间后的 o2Shown：连续滚动，掉氧速率可读
    this.txt(`${Math.ceil(this.o2Shown)} / ${this.o2Max}`, cx, by + bh / 2, '20px',
      low ? TXT.warn : TXT.cyber, MONO, 'center')
    // 耗氧速率（越深越快，必须显式告诉玩家）
    this.txt(`-${L.drain.toFixed(1)}/s`, bx - 12, by + 2, '13px', TXT.dim, MONO, 'right')

    // ③ 波次进度（V6.6：环倒计时 + 剩余敌人 + 下潜进度）
    const wx0 = bx + bw + 18
    const wi = this.waveInLayer + 1
    this.txt(`第 ${wi} / ${this.waves().length} 波`, wx0, by + 2, '16px', TXT.main, MONO)
    for (let i = 0; i < this.waves().length; i++) {
      const px1 = wx0 + i * 16, py1 = by + bh + 6
      // 结算时当前波还没"完成"，所以最后一个点在 result 相位不点亮
      const done = this.phase === 'result' ? i < this.waveInLayer : i <= this.waveInLayer
      g.fillStyle(done ? UI.cyan : UI.line, 1)
      g.fillCircle(px1, py1, 4)
      // 当前波的点加一圈呼吸环：一眼看出"进度停在第几波"
      if (i === this.waveInLayer && this.phase === 'wave') {
        const br = 4 + 3 * Math.abs(Math.sin(this.t * 2.4))
        g.lineStyle(1.5, UI.cyan, 0.5)
        g.strokeCircle(px1, py1, br)
      }
    }

    if (this.phase === 'wave') {
      // —— 环形倒计时：弧长 = 本波剩余时间比例 ——
      // 比纯数字强的点在于：扫一眼弧度就知道"这波还剩多久"，
      // 数字只在你盯着看时有用，弧度是余光可读的。
      const dur = Math.max(1, this.waves()[this.waveInLayer].dur)
      const left = Phaser.Math.Clamp(this.waveTimer / dur, 0, 1)
      const wcx = wx0 + 18, wcy = by + bh + 36, wr = 15
      g.lineStyle(3, UI.abyss, 0.75)
      g.beginPath(); g.arc(wcx, wcy, wr, 0, Math.PI * 2); g.strokePath()
      const wcol = left < 0.25 ? UI.danger : UI.cyan
      g.lineStyle(3, wcol, 0.95)
      g.beginPath(); g.arc(wcx, wcy, wr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left)
      g.strokePath()
      this.txt(`${Math.max(0, Math.ceil(this.waveTimer))}`, wcx, wcy, '15px',
        left < 0.25 ? TXT.warn : TXT.cyber, MONO, 'center')
      this.txt('s', wcx + wr + 6, wcy - 6, '12px', TXT.dim, MONO)

      // —— 剩余敌人：清波进度的唯一确定信号 ——
      // 波次计时器到点不等于波次结束（还要清场），必须让"还剩几只"可见，
      // 否则玩家不知道为什么还不进商店。
      const alive = this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
      const spawning = this.spawnLeft > 0
      this.txt(spawning ? `剩余 ${alive} · 涌入中` : `剩余 ${alive}`,
        wx0, by + bh + 60, '13px', alive > 0 ? TXT.dim : TXT.jade, MONO)
    } else if (this.phase === 'descending') {
      // —— 下潜进度条：下潜是一次"过渡"，玩家需要一个明确的进度 ——
      const k = Math.min(1, this.descT / this.descDur)
      const dw = 120, dx2 = wx0, dy2 = by + bh + 26
      g.fillStyle(UI.panel, 0.7); g.fillRoundedRect(dx2, dy2, dw, 8, 4)
      g.fillStyle(UI.cyan, 0.9); g.fillRoundedRect(dx2, dy2, Math.max(3, dw * k), 8, 4)
      neon(g, UI.cyanDim, () => { g.strokeRoundedRect(dx2, dy2, dw, 8, 4) },
        { width: 1, alpha: 0.7, bloom: false })
      this.txt('下潜中', dx2, dy2 - 14, '12px', TXT.cyan, FONT)
      this.txt(`${Math.round(k * 100)}%`, dx2 + dw + 8, dy2 - 2, '12px', TXT.dim, MONO)
    }

    // ④ 生物质：只在层末决策（decide）/ 下潜时显示。
    // 战斗中显示它是噪音——玩家此刻关心的是波次和鱼骨，不是"上浮能换多少"。
    // 而且它和下方常驻的鱼骨 bank 视觉重复（都在右上），两笔数字挤一起看不懂。
    if (this.phase !== 'wave') {
      const est = Math.floor(this.biomass * this.mult)
      this.txt(`生物质 ${this.biomass}`, W - 24, by + 2, '18px', TXT.jade, MONO, 'right')
      if (this.mult > 1) {
        this.txt(`上浮可得 ${est}`, W - 24, by + 26, '13px', TXT.amber, MONO, 'right')
      }
    }
    // 鱼骨（商店货币）必须**常驻** HUD，不能只在商店里出现。
    // 玩家要在战斗中就看见数字在涨，才会把"捡鱼骨"和"待会儿能买什么"连起来 ——
    // 这也是"击杀→掉落→拾取→商店"这条链路以前最薄弱的一环。
    const bY = by + (this.mult > 1 ? 48 : 26)
    neonCircle(g, W - 106, bY + 8, 7, BONE, { width: 1.4, bloom: false })
    this.txt(`${this.bank}`, W - 88, bY, '17px', TXT.cyber, MONO)

    // ⑤ 武器条（V6.3 建立，V6.6 重做，V6.10 对齐座圈）
    //
    // 槽数 = `maxWeapons`（4 → 靠商店卡解锁到 6），**不再写死 3**。
    // 每槽必须同时回答四个问题：
    //   装了什么（图形签名）· 多强（等级点）· 什么时候好（冷却环）· 是不是扩容座（角标）
    // 冷却进度是 Brotato 手感的可读性核心：玩家要能学会"机关枪在转、等下"。
    const sy = this.scale.height - 50
    const slots = Math.min(this.maxWeapons, MAX_SEATS)
    const sw = 46, gap = 52
    const plan = this.mountPlan()
    for (let i = 0; i < slots; i++) {
      const sx = 24 + i * gap
      const w = this.weapons[i]
      const ext = !!plan[i]?.ext
      const wcol = w ? WEAPON_DEF[w.id].color : UI.line

      g.fillStyle(w ? UI.panelHi : UI.panel, w ? 0.9 : 0.55)
      g.fillRoundedRect(sx, sy, sw, sw, 9)

      if (!w) {
        // 空槽：只画暗描边 + 序号，不画"空"字（字在小方块里反而更乱）
        neon(g, UI.line, () => { g.strokeRoundedRect(sx, sy, sw, sw, 9) },
          { width: 1, alpha: 0.45, bloom: false })
        this.txt(String(i + 1), sx + sw / 2, sy + sw / 2 - 6, '13px', TXT.mute, MONO, 'center')
        continue
      }

      neon(g, wcol, () => { g.strokeRoundedRect(sx, sy, sw, sw, 9) },
        { width: ext ? 2.4 : 2, alpha: 0.9, bloom: false })

      const icx = sx + sw / 2, icy = sy + 19
      this.drawWeaponIcon(g, w.id, icx, icy, 12)

      // —— 冷却环：绕图标画一圈进度弧，从 12 点顺时针填充 ——
      // 用环而不是底部细条：环的"转满一圈"直接对应"又射了一发"，
      // 6 把武器同时转的时候，火力节奏是**看得见的**。
      if (w.timer > 0) {
        // 分母用**实际间隔** ivLast（与装载器进度环同源）。用基础 w.iv 会在
        // 升级 / 齐射加成之后让 HUD 环和实体装载器对不上节奏。
        const k = Phaser.Math.Clamp(1 - w.timer / Math.max(0.01, w.ivLast || w.iv), 0, 1)
        g.lineStyle(3, UI.abyss, 0.8)
        g.beginPath(); g.arc(icx, icy, 15, 0, Math.PI * 2); g.strokePath()
        g.lineStyle(3, wcol, 0.95)
        g.beginPath(); g.arc(icx, icy, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k)
        g.strokePath()
      }

      // 等级点：最多 5 个小方块，从左到右填充
      for (let k = 0; k < 5; k++) {
        const px1 = sx + 8 + k * 6.5, py1 = sy + 35
        g.fillStyle(k < w.lvl ? wcol : UI.line, k < w.lvl ? 1 : 0.45)
        g.fillRect(px1, py1, 4, 4)
      }

      // —— 扩容座角标：右上角一圈琥珀小方块 ——
      // 和商店卡里的座圈示意图用同一套视觉语言（扩容座 = 琥珀），
      // 玩家在卡面学到的记号，在 HUD 上能直接认出来。
      if (ext) {
        g.fillStyle(UI.amber, 0.95)
        g.fillRect(sx + sw - 13, sy + 4, 7, 4)
        g.fillRect(sx + sw - 13, sy + 10, 7, 4)
      }
    }
    // 挂载计数：解锁卡买了之后这里会跳，是"塔在成长"的即时反馈
    this.txt(`座圈 ${this.weapons.length}/${Math.min(this.maxWeapons, MAX_SEATS)}`,
      24, sy - 16, '12px', this.weapons.length < this.maxWeapons ? TXT.dim : TXT.cyan, MONO)

    // —— 遗物槽（右下角）——
    // 遗物必须**战斗中也能看见**：它们的效果大多是条件触发的
    // （低氧增伤、连续不受击加速），玩家得知道"我现在有条件可触发"，
    // 否则这些规则等于不存在 —— 他永远不知道自己为什么突然变快了。
    {
      const rs = 30, rgap = 36
      const rx0 = this.scale.width - 24 - RELIC_SLOTS * rgap + (rgap - rs)
      for (let i = 0; i < RELIC_SLOTS; i++) {
        const rx = rx0 + i * rgap
        const id = this.relics[i]
        if (!id) {
          g.lineStyle(1, UI.line, 0.4)
          g.strokeRoundedRect(rx, sy + 7, rs, rs, 7)
          continue
        }
        g.fillStyle(UI.panelHi, 0.8); g.fillRoundedRect(rx, sy + 7, rs, rs, 7)
        // 生效中的遗物加一圈呼吸光：条件触发类的遗物需要"它现在有用"的提示
        const live = this.relicActive(id)
        neon(g, live ? UI.cyanHi : BONE,
          () => { g.strokeRoundedRect(rx, sy + 7, rs, rs, 7) },
          { width: live ? 2 : 1.2, alpha: live ? 0.95 : 0.6, bloom: live })
        this.drawRelicIcon(g, id, rx + rs / 2, sy + 22, 11)
      }
      this.txt('遗物', this.scale.width - 24, sy - 16, '12px', TXT.dim, MONO, 'right')
    }
    // 技能冷却
    const ready = this.burstTimer <= 0
    const k = ready ? 1 : 1 - this.burstTimer / O2.burstCd
    neonCircle(g, cx, sy + 22, 20, ready ? UI.cyan : UI.cyanDim, { width: 2, bloom: false })
    g.fillStyle(ready ? UI.cyan : UI.cyanDim, 0.25)
    g.fillCircle(cx, sy + 22, 20 * k)
    this.txt(ready ? '空格' : `${Math.ceil(this.burstTimer)}`, cx, sy + 22, '13px',
      ready ? TXT.cyber : TXT.mute, MONO, 'center')

    // 操作提示：只在开局引导，打久了就不该再占屏幕
    if (this.phase === 'wave' && this.layerIdx === 0 && this.waveInLayer <= 1) {
      this.txt('WASD 移动 · 武器自动开火 · 空格 排气爆发(-20 O₂)',
        24, this.scale.height - 92, '13px', TXT.mute, FONT)
    }

    // ⑥ 生存压迫指示（V6.3）
    //
    // 两种压迫都必须有**常驻显式指示**，玩家才能把「我为什么喘不上气」归因到正确的原因：
    //   低氧 → 红色心跳边框（越低频越快，直接映射"心跳"这个生理联想）
    //   热泉 → 底部上升箭头 + 提示（归因到环境，而不是"我操作有问题"）
    const lowPct = this.o2 / this.o2Max
    const H = this.scale.height
    const gasping = lowPct < 0.32 && (this.phase === 'wave' || this.phase === 'descending')
    if (gasping) {
      const urgency = 1 - lowPct / 0.32                // 0→1 越低越急
      const rate = 2.2 + urgency * 3.4
      const beat = Math.max(0, Math.sin(this.t * rate * Math.PI))
      const a = (0.12 + 0.5 * beat) * (0.35 + urgency * 0.65)
      const bw2 = 10 + beat * 14
      neon(g, UI.danger, () => { g.strokeRect(bw2 / 2, bw2 / 2, W - bw2, H - bw2) },
        { width: 3 + beat * 3, alpha: a, bloom: beat > 0.7 })
      this.txt('O₂ 告急', W / 2, 62, `${Math.round(16 + beat * 4)}px`,
        TXT.amber, FONT, 'center')
      // 心跳式缩放：镜头跟着心跳微微"吸"一下。
      // 幅度刻意压到 1% 以内 —— 这个信号要能被**感觉到**而不是被看到，
      // 再大就会干扰走位判断，那是玩法不能接受的代价。
      this.cameras.main.setZoom(CAM_ZOOM + beat * 0.009 * urgency)
    } else {
      // 必须每帧显式复位：只在高氧时不设的话，镜头会卡在最后一次缩放上
      this.cameras.main.setZoom(CAM_ZOOM)
    }

    // —— 受击方向性暗角（V6.6）——
    //
    // 受击只给"闪一下"是无方向的信息，玩家不知道该往哪躲。
    // 让**伤害来的那一侧**先红，方向信息就变成了本能反应。
    // 用多层递减 alpha 的矩形模拟渐变（Graphics 没有渐变填充）。
    if (this.hurtDirT > 0) {
      const k = Phaser.Math.Clamp(this.hurtDirT / 0.45, 0, 1)
      const wR = Math.max(0, this.hurtDirX)      // 敌人在右 → 右边红
      const wL = Math.max(0, -this.hurtDirX)
      const wD = Math.max(0, this.hurtDirY)
      const wU = Math.max(0, -this.hurtDirY)
      const NL = 6, dep = 120, band = dep / NL
      for (let i = 0; i < NL; i++) {
        const t = i / NL
        const al = 0.5 * k * (1 - t)
        if (al <= 0.004) continue
        const ins = t * dep
        if (wR > 0.01) {
          g.fillStyle(UI.danger, al * wR)
          g.fillRect(W - ins - band, ins, band + 1, H - ins * 2)
        }
        if (wL > 0.01) {
          g.fillStyle(UI.danger, al * wL)
          g.fillRect(ins, ins, band + 1, H - ins * 2)
        }
        if (wD > 0.01) {
          g.fillStyle(UI.danger, al * wD)
          g.fillRect(ins, H - ins - band, W - ins * 2, band + 1)
        }
        if (wU > 0.01) {
          g.fillStyle(UI.danger, al * wU)
          g.fillRect(ins, ins, W - ins * 2, band + 1)
        }
      }
    }
    // —— 缺氧暗角（V6.23）——
    //
    // 氧气既是血条又是计时器，"低氧"本该是全局最紧张的状态；但旧版只有一个
    // 数字在变小，玩家直到归零那一刻才发现自己快死了。
    // 这里把"缺氧"从**读数**升级成**生理感受**：四周向内收缩的红色暗角 + 呼吸脉动。
    //
    // 为什么不能复用上面的"受击暗角"：那个是**方向性**的（告诉你怎么躲），
    // 这个是**全向**的（告诉你该去补给了）—— 语义不同，混用会把两个信息都搞糊。
    // 另外暗角本身也是"要不要去捡"的一环：屏幕越红，玩家越倾向冒险出去补氧，
    // 而这个动作恰好是危险的那一个。
    const o2pct = this.o2 / Math.max(1, this.o2Max)
    if (o2pct < 0.28 && this.phase === 'wave') {
      const sev = Phaser.Math.Clamp((0.28 - o2pct) / 0.28, 0, 1)
      const breath = 0.55 + 0.45 * Math.sin(this.t * 5.2)   // 正弦是"喘"，方波是"闪"
      const H = this.scale.height
      // 强度刻意压在 0.26 以内：这是一条**常驻**警示（低于 28% 就一直亮着），
      // 太浓会变成一层红滤镜盖住战场信息。第一版取 0.34 / 深入 96px，
      // 实机截图里整屏套了个红框，敌人颜色都被改写了 —— 那是"看不清"而不是"紧张"。
      const NL = 7, dep = 20 + 74 * sev, band = dep / NL
      for (let i = 0; i < NL; i++) {
        const t = i / NL
        const al = 0.26 * sev * breath * (1 - t)
        if (al <= 0.004) continue
        const ins = t * dep
        g.fillStyle(UI.danger, al)
        g.fillRect(ins, ins, W - ins * 2, band + 1)
        g.fillRect(ins, H - ins - band, W - ins * 2, band + 1)
        g.fillRect(ins, ins, band + 1, H - ins * 2)
        g.fillRect(W - ins - band, ins, band + 1, H - ins * 2)
      }
    }

    // —— L2「暗流」提示（V6.23）——
    // 暗流是**看不见的机制**：不显式提示，玩家只会觉得"手感莫名发飘"，
    // 而不会意识到"有个力在推我"。用一个随水流方向转的箭头把它变成可读信息。
    // （水流方向 = this.t * 0.28，与 movePlayer / updateEnemies 用的是同一个式子，
    //   改一处必须三处一起改。）
    if (this.vpCur > 0) {
      const curAng = this.t * 0.28
      const ax = W / 2, ay = this.scale.height - 78
      for (let i = 0; i < 3; i++) {
        const off = ((this.t * 0.9 + i * 0.33) % 1)
        const d = off * 30
        neonLine(g, ax + Math.cos(curAng) * (d - 26), ay + Math.sin(curAng) * (d - 26),
          ax + Math.cos(curAng) * d, ay + Math.sin(curAng) * d, UI.jade,
          { width: 2.2, alpha: 0.55 * (1 - off), bloom: false })
      }
      this.txt('暗流 · 水流持续把你带偏', W / 2, ay - 32, '13px', TXT.jade, FONT, 'center')
    }

    if (this.vpPush > 0) {
      const byy = this.scale.height - 108
      for (let i = 0; i < 3; i++) {
        const off = ((this.t * 1.8 + i * 0.33) % 1)
        const ax = W / 2 + (i - 1) * 22
        const ay = byy + 12 - off * 22
        g.fillStyle(UI.amber, 0.28 * (1 - off))
        g.fillTriangle(ax, ay - 7, ax - 5, ay + 3, ax + 5, ay + 3)
      }
this.txt('热泉上升流 · 按住 ↓ 压住艇身', W / 2, byy - 12, '13px', TXT.amber, FONT, 'center')
    }

    // 下潜过渡演出先画（它是全屏覆盖层）—— 层入场卡必须画在它**之后**，
    // 否则会被那层 0.72 的压黑盖掉。
    if (this.phase === 'descending') this.drawDescending(g)

    // —— 层入场卡（V6.23）——
    // 「每层要有差异」不能只做在数值里：玩家换层时必须**当场被告知**这一层
    // 有什么不一样，否则机制再不同，他的感受也只是"底色变了"。
    // 卡片在下潜过渡时浮现、2.6 秒内淡出。纵向放在 24% 处而不是 30% ——
    // drawDescending 的深度大数字在 38% 处（52px 高），0.30 会紧贴到只差 1px。
    if (this.layerCardT > 0) {
      const LC = this.layer()
      const k = Phaser.Math.Clamp(this.layerCardT / 2.6, 0, 1)
      const a = k > 0.85 ? (1 - k) / 0.15 : (k < 0.35 ? k / 0.35 : 1)
      const cardW = 580
      const cardH = LC.mech ? 118 : 86
      const cardX = W / 2 - cardW / 2
      const cardY = this.scale.height * 0.24 - cardH / 2
      g.fillStyle(UI.abyss, 0.74 * a)
      g.fillRoundedRect(cardX, cardY, cardW, cardH, 14)
      neon(g, LC.tint, () => { g.strokeRoundedRect(cardX, cardY, cardW, cardH, 14) },
        { width: 1.6, alpha: 0.75 * a, bloom: false })
      // 左侧主题竖条：和商店卡 / 潜航器选择卡同一套"物件卡"语汇
      g.fillStyle(LC.tint, 0.95 * a)
      g.fillRoundedRect(cardX + 4, cardY + 18, 5, cardH - 36, 2)
      this.txt(`L${this.layerIdx + 1}  ${LC.name}`, W / 2, cardY + 20, '30px',
        TXT.cyber, FONT, 'center').setAlpha(a)
      this.txt(LC.sub, W / 2, cardY + 60, '12px', TXT.mute, MONO, 'center').setAlpha(a * 0.85)
      if (LC.mech) {
        this.txt(`【${LC.mech}】${LC.tip}`, W / 2, cardY + 86, '15px',
          TXT.amber, FONT, 'center').setAlpha(a)
      }
    }
    // shop/decide/result 的弹窗分派已移到 update() —— drawHud 被相位门控后，
    // 放在这里的分派在弹窗相位永远执行不到（踩过的坑：弹窗直接消失，
    // 且 HUD 的独立 Graphics 不再 clear，画面残留最后一帧战斗 HUD）。
  }

  // ---- 文字对象池：避免每帧 new Text 造成 GC 抖动 ----
  private hideTexts(): void {
    // 只隐藏 **UI 层** 文本。飘字（cat='float'）归世界相机，由 drawFloats 自己
    // 管理生命周期 —— 若在这里连飘字一起隐藏就坏了：update() 的顺序是
    // `draw()`(含 drawFloats，点亮飘字) → `drawHud()`(含 hideTexts，清掉)，
    // 结果是"受击完全没有扣血飘字"（用户反馈之一）。这是它的直接根因。
    for (const t of this.txtPool) if (t.getData('cat') !== 'float') t.setVisible(false)
  }
  private txt(s: string, x: number, y: number, size: string, color: string,
              font: string, align: 'left' | 'center' | 'right' = 'left',
              cat: 'ui' | 'float' = 'ui', stroke = true)
    : Phaser.GameObjects.Text {
    // 池按 **屏幕层 / 世界层** 分开复用：
    //   · UI 文本（氧气读数、深度、卡面标题…）→ 归 UI 相机（zoom 1，屏幕坐标）
    //   · 飘字（伤害数字、拾取弹出）→ 归主相机（世界坐标，跟着敌人一起动）
    // 两者绝不能混用同一个对象 —— 一旦混用，ignore 归属就错了：飘字要么被
    // 主相机放大、要么被 UI 相机按屏幕坐标错误放置（这正是"受击看不到扣血
    // 飘字"的根因：世界坐标 × scrollFactor(0)，相机一滚动就飘出屏幕）。
    let t = this.txtPool.find(o => !o.visible && o.getData('cat') === cat)
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: font, fontSize: size, color }).setDepth(101)
      if (cat === 'float') {
        t.setScrollFactor(1)               // 世界坐标：随敌人 + 随相机变焦
        this.uiCam.ignore(t)
      } else {
        t.setScrollFactor(0)               // 屏幕坐标：贴屏
        this.cameras.main.ignore(t)
      }
      t.setData('cat', cat)
      this.txtPool.push(t)
    }
    t.setText(s).setStyle({ fontFamily: font, fontSize: size, color })
    t.setPosition(x, y).setVisible(true)
    // 显式复位透明度：池里的对象是复用的，哪个调用方设过 alpha（飘字淡出、
    // 层入场卡淡入）就会**留给下一个使用者** —— 不在这里复位的话，
    // 后面被复用的文本会莫名半透明。这是加层入场卡时暴露出来的。
    t.setAlpha(1)
    if (align === 'center') t.setOrigin(0.5)
    else if (align === 'right') t.setOrigin(1, 0)
    else t.setOrigin(0)
    // 深色描边保证文字在任何背景上立得住。**但亮底按钮上的深色字必须关掉它** ——
    // 否则深色字 + 深色描边 = 一团糊（V6.25 的"实心主按钮"需要这个开关）。
    if (stroke) t.setStroke('#04070d', 3)
    else t.setStroke('rgba(0,0,0,0)', 0)
    // UI 合理性审计：把文字节点登记进 this.ui（屏幕坐标 + 颜色），供 __dive.uiProbe 导出
    const b = t.getBounds()
    this.ui.push({
      kind: 'text', x: b.x, y: b.y, w: Math.max(1, b.width), h: Math.max(1, b.height),
      color, size: parseInt(size, 10) || 12, text: s.slice(0, 48), cat,
    })
    // 返回对象是为了让调用方能再设 alpha（飘字淡出要用）。
    // 之前返回 void，飘字只能"瞬间消失"不能淡出，这就是那个坑。
    return t
  }

  /**
   * 按像素宽度折行（中文按 1em、ASCII 按 0.56em 估算）。
   *
   * V6.10 商店梳理新增：卡面描述从单行改成自动折行。
   * 之前 desc 是一行 `txt(..., 'center')`，而商店卡净宽只有 184px，
   * 于是「拾取范围 +80% · 鱼骨价值 +30%」「每次拾取 +2 材料，最大生命 −15」
   * 这类描述**直接顶出卡外**，压在相邻卡上 —— 玩家看到的是"三张卡糊成一坨"。
   *
   * 为什么不用 Phaser 的 setWordWrap：它在设置时就按当时的字体度量算好了，
   * 而我们的文字全部走对象池复用 + 每帧 setText，wrap 宽度不会重算；
   * 而且 setWordWrap 只在 `\n` 处断行，对中文（无空格）等于没用。
   * 所以这里在**字符串层面**按字符宽度切，行数完全可控。
   */
  private wrapByWidth(s: string, fontPx: number, maxW: number, maxLines = 3): string[] {
    const lines: string[] = []
    let cur = ''
    let curW = 0
    // ASCII（含数字/半角符号）实际宽度约为中文的一半，用 0.56 是个贴合实测的经验值
    const wOf = (ch: string) => (ch.charCodeAt(0) < 0x2e80 ? fontPx * 0.56 : fontPx)
    for (const ch of s) {
      const w = wOf(ch)
      if (curW + w > maxW && cur.length > 0) {
        lines.push(cur)
        cur = ''; curW = 0
        if (lines.length >= maxLines) break
      }
      cur += ch
      curW += w
    }
    if (cur.length > 0 && lines.length < maxLines) lines.push(cur)
    // 放不下时补省略号，让玩家知道"还有内容"而不是"就这么多"
    if (lines.length >= maxLines && curW + [...s].reduce((a, c) => a + wOf(c), 0) > maxW * maxLines) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'
    }
    return lines
  }

  // ==========================================================================
  // 通用热区
  // ==========================================================================
  private clearHits(): void {
    // 必须销毁锚点矩形：只清数组的话旧热区仍然 alive，
    // 会在下一波/下一局里响应已经看不见的点击（实测踩过同类坑）。
    for (const c of this.shopCards) c.rect.destroy()
    for (const b of this.shopBtns) b.rect.destroy()
    for (const b of this.decideBtns) b.rect.destroy()
    for (const b of this.resultBtns) b.rect.destroy()
    this.shopCards = []
    this.shopBtns = []
    this.rerollBtnRect = null
    this.leaveBtnRect = null
    this.decideBtns = []
    this.resultBtns = []
  }

  /**
   * 登记一个点击热区。
   * hitRouter 需要的是**矩形对象**（沿父容器链换算屏幕坐标），不是裸坐标；
   * 且热区原点在**中心**（判定是 |dx| <= w/2），所以这里传中心点。
   */
  private addHit(cx: number, cy: number, w: number, h: number,
                 onClick: () => void): Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(cx, cy, w, h, 0x000000, 0)
    rect.setScrollFactor(0).setDepth(102)
    this.cameras.main.ignore(rect)   // 热区是纯 UI：只归 UI 相机（顺带修正点击判定）
    registerUiHit(this, { obj: rect, w, h, onClick, alive: () => rect.active })
    return rect
  }

  /** 带悬停高亮的热区：卡片是纯 Graphics 绘制的，hover 态必须手绘 */
  private addHoverHit(cx: number, cy: number, w: number, h: number,
                      onClick: () => void, onHover: (v: boolean) => void)
    : Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(cx, cy, w, h, 0x000000, 0)
    rect.setScrollFactor(0).setDepth(102)
    this.cameras.main.ignore(rect)   // 热区是纯 UI：只归 UI 相机（顺带修正点击判定）
    registerUiHit(this, { obj: rect, w, h, onClick, onHover, alive: () => rect.active })
    return rect
  }

  // ==========================================================================
  // 属性与遗物（V6.8）
  // ==========================================================================

  /**
   * 加一点属性（唯一入口）。
   *
   * 所有加成型卡都必须走这里，好处是**上限只在这个函数里钳一次**。
   * 之前每张卡自己写 `Math.min(0.6, x + 0.25)`，漏一张就出 bug。
   */
  addStat(k: keyof Stats, v: number): void {
    const cap = STAT_CAP[k]
    this.st[k] = cap === undefined ? this.st[k] + v : Math.min(cap, this.st[k] + v)
  }

  /** 本局是否已装备某个遗物 */
  private hasRelic(id: RelicId): boolean { return this.relics.includes(id) }

  /**
   * 遗物的"代价"在这里生效（拿到时立即结算一次）。
   *
   * 为什么代价要写进 apply 而不是写成负的 stats：Brotato 的道具设计精髓就是
   * **有取舍**。纯增益的道具不需要抉择，只是"拿到就变强"；带代价的道具才会
   * 让玩家在商店里停下来想"我这局的 build 吃不吃得住这个副作用"。
   */
  private equipRelic(id: RelicId): void {
    if (this.relics.includes(id) || this.relics.length >= RELIC_SLOTS) return
    this.relics.push(id)
    const r = RELIC_DEF[id]
    if (r.onEquip) r.onEquip(this)
    // 装备瞬间必须重算一次上限：有遗物会改 o2Bonus（如「骨殖转化」-15）
    this.o2Max = this.layer().o2Max + this.st.o2Bonus
    if (this.o2 > this.o2Max) this.o2 = this.o2Max
  }

  /**
   * 这个遗物的条件**此刻**是否满足。
   *
   * 只用于 HUD 的呼吸光提示。条件触发类遗物的最大问题是"玩家不知道它生效了"，
   * 光效一亮，因果关系立刻建立："哦，我现在没挨打所以更快了"。
   * 常驻生效的遗物（贪食腺体这类）返回 false —— 一直亮着的光等于没有光。
   */
  private relicActive(id: RelicId): boolean {
    switch (id) {
      case 'echo_heart': return this.o2 / this.o2Max < 0.3
      case 'current_fin': return this.noHitT >= 3
      case 'silent_plating': return this.plateT > 0
      case 'abyss_mark': return this.layerIdx > 0
      default: return false
    }
  }

  /** 鱼骨换钱的倍率（打捞运 + 潮汐罗盘 + 贪食腺体）。只影响钱，不影响回氧 */
  private boneValueMul(): number {
    return 1 + this.st.luck
      + (this.hasRelic('tidal_compass') ? 0.3 : 0)
      + (this.hasRelic('gluttony') ? 1 : 0)
  }

  /**
   * 动态伤害加成。
   *
   * 和 `st.dmg`（静态卡加成）分开，因为这一部分是**逐帧变化的**——
   * 「回声心脏」在低氧时才给伤害，必须每次开火时现算，不能存进 stats。
   */
  private dmgMulNow(): number {
    // 潜航器的基础伤害倍率（灯艇 −15%）乘在最外层 —— 它是"机体特性"，
    // 应该缩放**所有**后续加成，而不是被它们稀释掉。
    let m = (1 + this.st.dmg) * this.sub.dmgMul
    // 回声心脏：低氧时增伤。氧气既是血又是输出 —— 这是"敢不敢贴着死亡线打"的赌注
    if (this.hasRelic('echo_heart') && this.o2 / this.o2Max < 0.3) m *= 1.5
    // 深潜印记：每下潜一层 +12%，跨层累积（越深越强，鼓励赌下潜）
    if (this.hasRelic('abyss_mark')) m *= 1 + 0.12 * this.layerIdx
    return m
  }

  // ==========================================================================
  // 商店：波间三选一
  // ==========================================================================
  private pool: Upgrade[] = [
    // —— 器械卡（V6.3）——
    // 这三张是 Brotato 手感的核心：火力来源变多，但玩家操作**不变**（仍然只走位）。
    // 弓与枪的定位不重叠，所以拿到哪张都会明显改变手感。
    { id: 'w_sonar', name: '声呐共振', desc: '环形波前 · 群体伤害', kind: 'weapon',
      cost: 32, apply: s => s.addWeapon('sonar') },

    // —— V6.18 新增三种基础武器（计划书 §5.2 武器表）。——
    // 三者都是"操作要求不同"：鱼叉勾人、回声要预判、酸液要引导。
    { id: 'w_harp', name: '穿透鱼叉', desc: '直线穿透 · 命中拉拽', kind: 'weapon',
      cost: 34, apply: s => s.addWeapon('harpoon') },
    { id: 'w_echo', name: '回声炮', desc: '延迟爆发 · 需预判', kind: 'weapon',
      cost: 36, apply: s => s.addWeapon('echo') },
    { id: 'w_acid', name: '酸液喷射', desc: '地面持续伤害区', kind: 'weapon',
      cost: 34, apply: s => s.addWeapon('acid') },

    { id: 'w_gun', name: '脉冲机关枪', desc: '高频连射 · 单体', kind: 'weapon',
      cost: 30,
      apply: s => s.addWeapon('gun'),
    },
    {
      id: 'w_torp', name: '追踪鱼雷', desc: '低频追踪 · 范围爆炸', kind: 'weapon',
      cost: 38,
      apply: s => s.addWeapon('torpedo'),
    },
    {
      id: 'w_arc', name: '链式电弧', desc: '瞬发连锁 · 多目标', kind: 'weapon',
      cost: 34,
      apply: s => s.addWeapon('arc'),
    },
    {
      id: 'w_all', name: '弹药改良', desc: '全部器械 +1 级', kind: 'weapon',
      cost: 26,
      apply: s => s.levelAllWeapons(),
      dead: s => s.weapons.length === 0,
    },

    // —— 进化卡（V6.17）：每把武器 2 条分支，满级（Lv5）后才会出现在池里 ——
    //
    // 计划书 §5.2 的"质变密度"落点：不做数百个道具，而是让**已有的 4 把武器**
    // 各自长出两种完全不同的玩法。`dead` 反着写：返回 true = "这张卡不该刷出"。
    // 进化是**换机制**（弹数 / 散射 / 链数 / 溅射 / 射程换射速），不是 +X% 伤害。
    { id: 'e_gun_gl', name: '进化 · 加特林', desc: '射速翻倍 · 射程腰斩', kind: 'weapon',
      cost: 66, apply: s => s.evolveWeapon('gun', 'gun_gl'),
      dead: s => !s.weapons.some(w => w.id === 'gun' && w.lvl >= 5) },
    { id: 'e_gun_sg', name: '进化 · 霰弹散射', desc: '一次 5 弹扇形 · 近距', kind: 'weapon',
      cost: 66, apply: s => s.evolveWeapon('gun', 'gun_sg'),
      dead: s => !s.weapons.some(w => w.id === 'gun' && w.lvl >= 5) },

    { id: 'e_torp_cl', name: '进化 · 集束鱼雷', desc: '一次 3 枚 · 覆盖面', kind: 'weapon',
      cost: 74, apply: s => s.evolveWeapon('torpedo', 'torp_cl'),
      dead: s => !s.weapons.some(w => w.id === 'torpedo' && w.lvl >= 5) },
    { id: 'e_torp_hv', name: '进化 · 重型鱼雷', desc: '单发重击 · 爆炸更大', kind: 'weapon',
      cost: 74, apply: s => s.evolveWeapon('torpedo', 'torp_hv'),
      dead: s => !s.weapons.some(w => w.id === 'torpedo' && w.lvl >= 5) },

    { id: 'e_arc_ov', name: '进化 · 过载电弧', desc: '跳跃 +4 · 串得更远', kind: 'weapon',
      cost: 70, apply: s => s.evolveWeapon('arc', 'arc_ov'),
      dead: s => !s.weapons.some(w => w.id === 'arc' && w.lvl >= 5) },
    { id: 'e_arc_st', name: '进化 · 定点雷暴', desc: '一次电击全部目标', kind: 'weapon',
      cost: 70, apply: s => s.evolveWeapon('arc', 'arc_st'),
      dead: s => !s.weapons.some(w => w.id === 'arc' && w.lvl >= 5) },

    { id: 'e_sonar_rs', name: '进化 · 共振炮', desc: '命中后向邻近弹射', kind: 'weapon',
      cost: 70, apply: s => s.evolveWeapon('sonar', 'sonar_rs'),
      dead: s => !s.weapons.some(w => w.id === 'sonar' && w.lvl >= 5) },
    { id: 'e_sonar_fc', name: '进化 · 定向聚焦', desc: '短距强波 · 高伤', kind: 'weapon',
      cost: 70, apply: s => s.evolveWeapon('sonar', 'sonar_fc'),
      dead: s => !s.weapons.some(w => w.id === 'sonar' && w.lvl >= 5) },

    // —— 挂载位扩容卡（V6.6 建立，V6.10 改为座圈语义）——
    //
    // 这是"潜航器养成"的成长线：座圈上开 4 座，扩容卡把上限抬到 5 → 6，
    // 第 5、6 座落在 ±150°（尾侧），画成**带琥珀外环的圆座**，
    // 和开局 4 座在剪影上一眼分得开。
    //
    // 顺序很重要：必须先 5 再 6。直接跳到 6 会让座圈上凭空多出两个座，
    // 玩家看不出发生了什么 —— 逐级解锁才有"我的艇在变强"的实感。
    {
      id: 't_slot5', name: '挂载扩容 I', desc: '座圈解锁第 5 座 · 尾侧新增炮位', kind: 'mount',
      cost: 55,
      apply: s => { s.maxWeapons = 5 },
      dead: s => s.maxWeapons >= 5,
    },
    {
      id: 't_slot6', name: '挂载扩容 II', desc: '座圈解锁第 6 座 · 火力上限 +1', kind: 'mount',
      cost: 70,
      apply: s => { s.maxWeapons = 6 },
      // 前置：必须先有 5 座。没拿到 I 就不该刷出 II
      dead: s => s.maxWeapons !== 5,
    },
    {
      id: 't_twin', name: '齐射同步', desc: '扩容座（第 5/6 座）射速 +25%', kind: 'mount',
      cost: 45,
      apply: s => s.addStat('twinRate', 0.25),
      // 没扩容座就没意义
      dead: s => s.maxWeapons < 5,
    },

    // —— 属性卡（V6.8）——
    //
    // 这一组和「遗物」的分工：属性卡是**可预期的线性成长**（伤害 +12%），
    // 买它的过程是"我的共振强度又高了一点"。它保证每一波都有东西可买 ——
    // 如果商店只有遗物，前期没攒够钱时就会出现"什么都买不起"的空波次。
    //
    // 定价逻辑：伤害/射速这类直接提升 dps 的定 30 上下（一波收入的 3/4），
    // 生存类（护甲/闪避）定 26~28（便宜一点，因为它们的收益是"不死"
    // 而不是"打得快"，玩家的感知更弱，得靠低价推着买）。
    {
      id: 'speed', name: '增压推进', desc: '移速 +15%', kind: 'stat',
      cost: 24,
      apply: s => s.addStat('speed', 0.15),
    },
    {
      id: 'pickup', name: '吸附鳍', desc: '拾取范围 +40%', kind: 'stat',
      cost: 22,
      apply: s => s.addStat('pickup', 0.4),
    },
    {
      id: 'tank', name: '扩容气瓶', desc: '氧气上限 +20 并回满', kind: 'stat',
      cost: 36,
      apply: s => { s.addStat('o2Bonus', 20); s.o2Max = s.layer().o2Max + s.st.o2Bonus; s.o2 = s.o2Max },
    },
    {
      id: 'gill', name: '循环鳃', desc: '击杀额外回氧 +3', kind: 'stat',
      cost: 28,
      apply: s => s.addStat('killO2', 3),
    },
    {
      id: 's_dmg', name: '共振放大', desc: '伤害 +12%', kind: 'stat',
      cost: 32,
      apply: s => s.addStat('dmg', 0.12),
    },
    {
      id: 's_rate', name: '高压供能', desc: '射速 +10%', kind: 'stat',
      cost: 30,
      apply: s => s.addStat('rate', 0.10),
    },
    {
      id: 's_crit', name: '弱点解析', desc: '暴击率 +8%', kind: 'stat',
      cost: 28,
      apply: s => s.addStat('crit', 0.08),
      dead: s => s.st.crit >= 0.75,
    },
    {
      id: 's_range', name: '声场延伸', desc: '射程 +15%', kind: 'stat',
      cost: 26,
      apply: s => s.addStat('range', 0.15),
    },
    {
      id: 's_armor', name: '耐压装甲', desc: '受到的伤害 −8%', kind: 'stat',
      cost: 30,
      apply: s => s.addStat('armor', 0.08),
      dead: s => s.st.armor >= 0.6,
    },
    {
      id: 's_dodge', name: '流体规避', desc: '一次性打击闪避 +6%', kind: 'stat',
      cost: 28,
      apply: s => s.addStat('dodge', 0.06),
      dead: s => s.st.dodge >= 0.6,
    },
    {
      id: 's_regen', name: '循环泵', desc: '每秒回氧 +0.4', kind: 'stat',
      cost: 34,
      apply: s => s.addStat('regen', 0.4),
    },
    {
      id: 's_luck', name: '打捞直觉', desc: '鱼骨换钱 +15%', kind: 'stat',
      cost: 24,
      apply: s => s.addStat('luck', 0.15),
    },

    // —— 遗物（被动道具，V6.8）——
    //
    // 卡池里最贵的一类，也是唯一**会改变打法**的一类。
    // 两个出现条件：① 槽位没满 ② 打过 2 波以上。
    // ② 是刻意的：开局就刷出遗物的话，玩家还没建立"武器 + 属性"的基础认知，
    // 面对一个带代价的道具无从判断值不值，只会随机乱买。
    ...(Object.keys(RELIC_DEF) as RelicId[]).map(id => {
      const r = RELIC_DEF[id]
      return {
        id: `r_${id}`, name: r.name, desc: r.desc, kind: 'relic' as const,
        cost: r.price,
        relicId: id,
        apply: (s: DiveScene) => s.equipRelic(id),
        dead: (s: DiveScene) => s.relics.length >= RELIC_SLOTS
          || s.relics.includes(id)
          || s.layerIdx * 4 + s.waveInLayer < 2,
      }
    }),
  ]

  private offers: Upgrade[] = []
  /**
   * 鱼骨存量 —— 商店货币（V6.7）。
   *
   * 之前商店是"每波免费三选一"，鱼骨只回氧、本质是变相分数，
   * 于是"击杀 → 掉落 → 游过去捡 → 进商店"这条链路里，**捡**这个动作
   * 对商店没有任何影响，循环是断的。现在鱼骨直接是钱：
   * 捡得多 → 买得起更好的卡 → 打得更快 → 掉得更多。
   */
  private bank = 0
  /** 三张卡的锁定状态：锁定后刷新不会被换掉（攒钱买下一波） */
  private locked: boolean[] = [false, false, false]
  /** 三张卡的售出状态：买过的格子留空，不重复卖同一格 */
  private sold: boolean[] = [false, false, false]
  /** 刷新价格：每次刷新递增，离开商店时重置 */
  private rerollCost = 0
  private hoverCard = -1
  private shopInfoOpen = false   // V6.9 商店：右侧艇体状态面板默认收起，点击页签/Tab 展开
  private hoverBtn = -1
  /** 商店底部按钮（锁定 / 刷新 / 继续）的热区，和 shopCards 一样要随 clearHits 销毁 */
  private shopBtns: { x: number; y: number; w: number; h: number; rect: Phaser.GameObjects.Rectangle }[] = []
  /** 刷新 / 继续按钮的绘制矩形（热区创建时记下来，绘制时要用） */
  private rerollBtnRect: { x: number; y: number; w: number; h: number } | null = null
  private leaveBtnRect: { x: number; y: number; w: number; h: number } | null = null

  private openShop(): void {
    this.phase = 'shop'
    this.hoverCard = -1
    this.locked = [false, false, false]
    this.sold = [false, false, false]
    this.rerollCost = REROLL_BASE
    // 开局先发一点启动资金：第一波还没捡到鱼骨时也能买一张便宜卡，
    // 否则商店第一波必然空手而归，"鱼骨=钱"的第一印象就是负的。
    if (this.bank < REROLL_BASE) this.bank = 20
    this.rollOffers(true)
    this.clearHits()
    // 弹幕/波前/特效必须一起清掉。
    // 以前不清的后果：上一波还在飞的曳光弹和声呐波前会**带进下一波**，
    // 在玩家还没看到新敌人时就先打到它们 —— 实测是无故掉血 + 莫名击杀。
    // 冲击波与击打痕留着只会被商店底板盖住，但它们是纯表现，一起清更干净。
    this.bullets = []; this.pulses = []; this.sparks = []; this.echoes = []; this.acids = []
    this.shocks = []; this.slashes = []; this.arcs = []
  }

  /**
   * 抽三张（`fresh = true` 表示全新的三张，否则保留锁定格）。
   *
   * 先过滤"死卡"再抽。死卡 = 买了没有效果的卡（槽位已满还刷扩容卡、
   * 一台武器都没有还刷"全部升级"）。一张无效卡会挤掉一个有效选项 ——
   * 三选一本来就只有三个位置，出现废卡等于这一波商店白给，
   * 是最伤玩家信任的事。
   */
  private rollOffers(fresh: boolean): void {
    const alive = this.pool.filter(u => !u.dead || !u.dead(this))
    // 兜底：极端情况下全被过滤光了（不该发生），退回全池，至少不崩
    const from = alive.length >= 3 ? alive : this.pool
    const next = Phaser.Utils.Array.Shuffle(from.slice()).slice(0, 3)
    if (!fresh) {
      // 锁定格保留原卡：这是"攒钱买下一波"的唯一途径
      for (let i = 0; i < 3; i++) {
        if (this.locked[i] && !this.sold[i] && this.offers[i]) next[i] = this.offers[i]
      }
    }
    this.offers = next
  }

  /** 买第 i 张。钱不够就什么都不做 —— 卡面会画成灰色，不用弹提示打断节奏 */
  private buyCard(i: number): void {
    if (this.phase !== 'shop') return
    const up = this.offers[i]
    if (!up || this.sold[i]) return
    if (this.bank < up.cost) return
    this.bank -= up.cost
    up.apply(this)
    this.sold[i] = true
    this.locked[i] = false
    // 买完要重建热区：同一波还能继续买第二张、第三张
    this.clearHits()
  }

  private reroll(): void {
    if (this.phase !== 'shop') return
    if (this.bank < this.rerollCost) return
    this.bank -= this.rerollCost
    this.rerollCost += REROLL_STEP
    this.rollOffers(false)
    this.clearHits()
  }

  private toggleLock(i: number): void {
    if (this.sold[i]) return
    this.locked[i] = !this.locked[i]
  }

  /**
   * 离开商店。
   *
   * 注意是 startWave() 而不是 advance()：waveInLayer 已经在 advance 里加过了，
   * 再走 advance 会多跳一波。
   */
  private leaveShop(): void {
    if (this.phase !== 'shop') return
    this.clearHits()
    this.startWave()
  }

  private drawShop(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    // 立绘每帧先全隐，下面按卡逐个点亮（避免卡片数量变化时残留上一帧的立绘）
    for (const im of this.shopArt) im.setVisible(false)
    // ==========================================================================
    // V6.25 商店视觉重做：从「霓虹半透明」改成「实底 + 清晰层级」
    // ==========================================================================
    //
    // 为什么推翻 V6.10 那一版（有实测数据，不是审美偏好）：
    // 量用户截图发现 **卡与卡之间的背景亮度 62 / 方差 51，而卡内只有 34 / 29**
    // —— 全场最抢眼的东西是卡片背后的霓虹装饰，不是玩家该做的决策。
    // 根因两条：① 背景还在画海景（圆环、网纹、光点）
    //           ② 卡面是半透明的，背景辉光直接透进卡里
    //              （实测立绘区内部亮度方差 26.6，一张实底卡应该接近 0）
    //
    // Brotato 反过来做：背景近纯黑（亮度 ~15、方差 ~5），卡是不透明实底、
    // 比背景**亮一档**。**"清晰简单"来自对比，不来自装饰。**
    //
    // 所以这一版只做三件事：背景实黑、卡面实底、描边去辉光改硬边。
    g.fillStyle(MENU.page, 1)
    g.fillRect(0, 0, W, H)
    // 上下两条极淡的压暗带：留一点"页面"感（有顶栏/底栏的边界），
    // 但亮度压得极低，绝不与卡片争焦点。
    g.fillStyle(0x000000, 0.4)
    g.fillRect(0, 0, W, 66)
    g.fillRect(0, H - 86, W, 86)

    // ==========================================================================
    // V6.10 商店梳理：把「三张卡 + 顶栏 + 底栏」重排成一条清晰的视觉轴
    // ==========================================================================
    //
    // 改之前的问题（都是实机看出来的，不是推测）：
    //   ① **描述顶出卡外**。卡宽 220、净宽 184，但 desc 是一行不折行的，
    //      「拾取范围 +80% · 鱼骨价值 +30%」这类文案直接压到邻卡上。
    //   ② **字号全挤在 10~15px**，卡面层级读不出来：名称 20 / 描述 15 /
    //      状态 12 / 代价 11，四级差值太小，扫一眼分不出主次。
    //   ③ **顶部鱼骨数字悬空**。图标在 bankX−96、数字在 −76、单位在 −42，
    //      三个手工偏移拼出来的间距，数字一变（3 位数）就对不齐。
    //   ④ **"查看艇体状态"页签飘在右上角**，和它控制的两个面板没有视觉关联，
    //      玩家不知道点它会发生什么。
    //   ⑤ **锁定按钮塞在价格行右侧**，和价格挤在一起，两个都是小方块，
    //      误点率高（点锁变成买卡）。
    //
    // 改后的布局轴（自上而下，间距按"信息优先级递减"排）：
    //   ┌ 顶栏：标题行 + 鱼骨胶囊（居中，永远对齐）
    //   ├ 卡区：三张等宽卡，卡内分区（类型带/立绘/名称/描述/状态/价格）
    //   └ 底栏：刷新 · 继续（主次分明：继续是主按钮，刷新是次按钮）
    // 侧栏（属性/遗物）默认收起，点顶栏右侧页签展开 —— 收起到顶栏里，
    // 页签和它控制的东西在同一行，关联关系一眼可见（治 ④）。

    // 卡区高度必须**跟着视口算**，不能写死，也不该留一大片空白。
    //
    // V6.10b 修的两个实测缺陷（用户："商店界面完全是乱的"）：
    //   ① **卡内有大空洞**。上一版把 ch 钳在 268~344，而立绘高度是"扣掉所有
    //      固定分区后的余量"，且分区按**最坏情况**预留（3 行描述 + 遗物代价行），
    //      于是没有代价行的卡在描述和价格之间空掉约 100px。
    //      现在：ch 用满可用高度（上限 470），固定分区按**实际会发生的情况**预留
    //      （描述 2 行、代价 1 行），余量全部给立绘 —— 立绘从 61px 变成约 200px。
    //   ② **底栏两行文字叠在一起**。"刷新卡面"（17px，从中心-9 起）与
    //      "已锁定的卡会保留"（12px，从中心+11 起）实际重叠。
    //      现在按钮高 46→56，两行按 9 / 32 排，不再互相压。
    // 顶栏高 = 68（原 54）。**54 装不下"标题 + 鱼骨胶囊"两行**：
    // 标题 18px 从 barY+10 起占 10~28，胶囊 24px 中心在 barY+33 占 21~45 ——
    // 实测重叠 7px（截图里标题和胶囊压在一起）。
    // 68 时：标题 barY+9 占 9~27，胶囊中心 barY+45 占 33~57，中间留 6px。
    const BAR_H = 68
    const BTN_H = 56
    const chrome = BAR_H + 24 /*提示行*/ + 30 /*卡↔底栏*/ + BTN_H + 34 /*上下留白*/
    const cw = 248, gap = 24
    const total = cw * 3 + gap * 2
    const x0 = (W - total) / 2
    const ch = Phaser.Math.Clamp(H - chrome, 320, 470)
    const y0 = Math.max(BAR_H + 46, Math.round((H - ch) / 2))

    // ---- 顶栏：标题 + 鱼骨胶囊 + 侧栏页签（同一行，视觉一体）----
    const barY = y0 - BAR_H - 30
    // 顶栏也用**实底**（原来 0.72 半透明）—— 半透明会把背景的漂浮物透上来，
    // 顶栏是"这是哪一关"的锚点，不该是磨砂玻璃。
    g.fillStyle(MENU.card, 1); g.fillRoundedRect(W / 2 - total / 2 - 24, barY, total + 48, BAR_H, 12)
    g.lineStyle(2, MENU.divider, 1)
    g.strokeRoundedRect(W / 2 - total / 2 - 23, barY + 1, total + 46, BAR_H - 2, 11)

    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 第 ${this.waveInLayer + 1} 波结束`,
      W / 2, barY + 9, '18px', TXT.cyber, FONT, 'center')

    // 鱼骨胶囊：**先算宽度再居中**，不再手工拼偏移（治 ③）。
    // 放在标题下方一行（中心 barY+45），与标题拉开 6px。
    const bankStr = `${this.bank}`
    const bankW = 34 + bankStr.length * 15 + 40
    const bankX = W / 2, bankY = barY + 45
    g.fillStyle(MENU.slot, 1); g.fillRoundedRect(bankX - bankW / 2, bankY - 12, bankW, 24, 12)
    g.lineStyle(1, MENU.divider, 1)
    g.strokeRoundedRect(bankX - bankW / 2 + 0.5, bankY - 11.5, bankW - 1, 23, 12)
    neonCircle(g, bankX - bankW / 2 + 17, bankY, 7.5, BONE, { width: 1.6, bloom: false })
    this.txt(bankStr, bankX + 6, bankY - 10, '18px', TXT.cyber, MONO, 'center')
    this.txt('鱼骨', bankX + bankW / 2 - 13, bankY - 8, '13px', TXT.dim, FONT, 'right')

    // 操作提示：顶栏正下方一行。
    // ⚠️ 这行**不是**卡内文字，但审计脚本会拿它和卡边界比 ——
    // 所以它的 y 必须落在 y0 之上（实测越界 346px 就是因为它被算进了卡区）。
    this.txt('点击卡片购买 · 卡片右上角锁定 · 1 / 2 / 3 快捷购买 · Tab 展开状态',
      W / 2, barY + BAR_H + 5, '13px', TXT.dim, FONT, 'center')

    // ---- 侧栏页签：移到顶栏右端，与被它控制的面板同一行（治 ④）----
    const tabW = 130, tabH = 30
    const tabX = W / 2 + total / 2 + 24 - tabW, tabY = barY + (BAR_H - tabH) / 2
    g.fillStyle(this.shopInfoOpen ? MENU.cardHi : MENU.card, 1)
    g.fillRoundedRect(tabX, tabY, tabW, tabH, 8)
    g.lineStyle(2, this.shopInfoOpen ? MENU.edge : MENU.divider, 1)
    g.strokeRoundedRect(tabX + 1, tabY + 1, tabW - 2, tabH - 2, 7)
    this.txt(this.shopInfoOpen ? '收起状态 ▴' : '查看状态 ▾',
      tabX + tabW / 2, tabY + 8, '13px', this.shopInfoOpen ? TXT.cyber : TXT.main, FONT, 'center')

    // ---- 侧栏面板：展开时贴在页签正下方，形成「从页签长出来」的关系 ----
    if (this.shopInfoOpen) {
      this.drawStatPanel(g, 20, tabY + tabH + 12)
      this.drawRelicSlots(g, W - 20 - 250, tabY + tabH + 12)
    }

    // ---- 卡内竖向分区：从**底部往上**排，剩余空间全给立绘 ----
    //
    // 为什么必须从下往上排（而不是从卡顶往下依次累加）：
    // 从上往下累加时，ch 一变，后面所有分区都会跟着漂 ——
    // 上一版把 `footY / costY` 写成 `descY0 + 60` 这种链式偏移，
    // 结果 ch 变小的那一刻立绘被压到 56px，而状态行和价格行仍然按
    // 原来的绝对偏移画，直接**压在价格底板上**（实机截图可见）。
    //
    // 从下往上排则保证：价格行永远贴卡底，状态/代价/描述/名称依次向上排，
    // 立绘拿剩下的全部空间 —— 视口再小也不会有分区互相重叠。
    const PRICE_H = 42
    // 分区高度按"实际会发生的最坏情况"预留，而不是"理论最大值"：
    //   描述最长的几条（"暴击时向最近的另一只溅射 40% 伤害" 等）在 212px 净宽下
    //   最多折成 2 行；遗物代价最长 1 行。上一版按 3 行 + 2 行预留，
    //   多出来的约 60px 就成了卡里的空洞（用户："商店界面完全是乱的"）。
    const H_COST = 26      // 遗物代价（1 行 16 + 间距 10），有则画、无则留白
    const H_FOOT = 20      // 状态行
    const H_DESC = 2 * 19 + 8 // 描述最多 2 行 × 19 + 行后留白（行距与绘制处一致）
    const H_NAME = 30      // 名称
    // ⚠️ 下面四个值全部是**相对卡顶的偏移**（不是绝对屏幕坐标）。
    // 上一版 priceY() 里写了 y0 +，得到的 footY 已是绝对坐标，
    // 绘制处再 `c.y + footY` 就多加了一次卡顶 y —— 结果状态行被推到卡外，
    // 直接压在价格底板上（审计报交叠 13px）。这里统一成相对量。
    const priceRel = ch - PRICE_H - 14// 价格行顶：贴卡底
    // —— 内容块（名称 + 描述 + 状态 + 代价）整体在"立绘底 → 价格顶"之间**居中** ——
    // 之前是"从立绘框底依次往下堆"，于是属性卡（没有状态行 / 代价行）的下半张卡
    // 就是一大片空白 —— 用户说的"商店很粗糙"很大一部分来自这里。
    // 现在把预留区当成一个整体块居中，空白被均分到上下，版面立刻平衡。
    const BLOCK_H = H_NAME + H_DESC + H_FOOT + H_COST
    const artTop = 42// 色带 + 首行
    const artH = Phaser.Math.Clamp(priceRel - 14 - artTop - BLOCK_H - 10, 70, 200)
    const zoneTop = artTop + artH + 6
    const zoneBot = priceRel - 10
    const blockTop = zoneTop + Math.max(0, (zoneBot - zoneTop - BLOCK_H) / 2)
    const nameRel = blockTop
    const descRel = nameRel + H_NAME + 2
    const footRel = descRel + H_DESC + 2
    const costRel = footRel + H_FOOT + 2

    if (this.shopCards.length === 0) {
      for (let i = 0; i < 3; i++) {
        const up = this.offers[i] ?? this.pool[0]
        const x = x0 + i * (cw + gap), y = y0
        const idx = i
        // 卡主体热区避开价格行与锁定按钮（否则点锁会变成买卡）
        const bodyH = ch - PRICE_H - 20
        const rect = this.addHoverHit(x + cw / 2, y + bodyH / 2, cw, bodyH,
          () => this.buyCard(idx),
          v => { this.hoverCard = v ? idx : (this.hoverCard === idx ? -1 : this.hoverCard) })
        this.shopCards.push({ x, y, w: cw, h: ch, up, rect })
        // 锁定按钮：**独立放在卡面右上角**，不与价格行挤在一处（治 ⑤）。
        // 语义上也更对：它是这张卡的操作，不是价格的一部分。
        const lockX = x + cw - 62 - 14, lockY = y + 14
        const lrect = this.addHoverHit(lockX + 31, lockY + 13, 62, 26,
          () => this.toggleLock(idx), () => {})
        this.shopBtns.push({ x: lockX, y: lockY, w: 62, h: 26, rect: lrect })
      }
      // 底部动作按钮：刷新（次）/ 继续（主）
      const byy = y0 + ch + 34, bw2 = 172
      const rrect = this.addHoverHit(W / 2 - bw2 - 12, byy, bw2, BTN_H, () => this.reroll(), () => {})
      this.shopBtns.push({ x: W / 2 - bw2 - 12, y: byy - BTN_H / 2, w: bw2, h: BTN_H, rect: rrect })
      const grect = this.addHoverHit(W / 2 + 12, byy, bw2, BTN_H, () => this.leaveShop(), () => {})
      this.shopBtns.push({ x: W / 2 + 12, y: byy - BTN_H / 2, w: bw2, h: BTN_H, rect: grect })
      this.rerollBtnRect = { x: W / 2 - bw2 - 12, y: byy - BTN_H / 2, w: bw2, h: BTN_H }
      this.leaveBtnRect = { x: W / 2 + 12, y: byy - BTN_H / 2, w: bw2, h: BTN_H }
      // 侧栏页签热区（点击切换，键盘 Tab 亦可）
      const trect = this.addHoverHit(tabX + tabW / 2, tabY + tabH / 2, tabW, tabH,
        () => { this.shopInfoOpen = !this.shopInfoOpen }, () => {})
      this.shopBtns.push({ x: tabX, y: tabY, w: tabW, h: tabH, rect: trect })
    }

    for (let i = 0; i < this.shopCards.length; i++) {
      const c = this.shopCards[i]
      const up = c.up
      const hov = this.hoverCard === i
      const cx = c.x + c.w / 2
      const isSold = this.sold[i]
      const isLocked = this.locked[i]
      const afford = this.bank >= up.cost

      // 类型色：青=器械 / 琥珀=挂载 / 紫=属性 / 骨白=遗物
      const bandCol = up.kind === 'weapon' ? UI.cyan
        : up.kind === 'mount' ? UI.amber
        : up.kind === 'relic' ? BONE : UI.violet

      // —— 卡体：**不透明实底**。三态靠「描边亮度」分档，不靠透明度 ——
      // 半透明是这一版要根治的病：卡一旦透明，背景的辉光就变成卡内的噪点。
      g.fillStyle(isSold ? MENU.slot : (hov && afford ? MENU.cardHi : MENU.card), 1)
      g.fillRoundedRect(c.x, c.y, c.w, c.h, 12)
      // 上缘 1px 冷高光：给卡面一点"实体"的读感。
      // 不做投影 —— 背景已经近黑，投影本来就看不见，画了只是白费。
      g.fillStyle(0xffffff, isSold ? 0.03 : 0.08)
      g.fillRoundedRect(c.x + 12, c.y + 2, c.w - 24, 1, 0.5)

      // —— 描边：**颜色分类型、亮度分状态**（Brotato 的做法）——
      // Brotato 用边框区分稀有度，我们用它区分类型：整条边都在说同一件事，
      // 比"卡顶一条小色带"可读得多（那一条只有 3px 高，余光根本扫不到）。
      // 买不起时整条边压到 0.26 —— 类型仍然认得出，但一眼知道"现在买不了"。
      // 用 lineStyle 硬边而不是 neon()：辉光会把卡边糊掉 2~3px，
      // 而"边缘锐利"正是那种清楚感的来源。
      const edgeCol = isSold ? MENU.edge : bandCol
      const edgeA = isSold ? 0.4 : (afford ? (hov ? 1 : 0.7) : 0.26)
      g.lineStyle(hov && afford ? 3 : 2, edgeCol, edgeA)
      g.strokeRoundedRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2, 11)

      // —— 类型标识：**左侧通高竖条**（物品卡的语汇）——
      // 和边框同色，一起构成"这张卡属于哪一类"的第二重提示。
      g.fillStyle(bandCol, isSold ? 0.28 : (afford ? 1 : 0.4))
      g.fillRoundedRect(c.x + 2, c.y + 18, 4, c.h - 36, 2)

      // —— 首行：序号（快捷键提示）+ 类型标签 + 锁定按钮 ——
      this.txt(`[${i + 1}]`, c.x + 16, c.y + 20, '15px',
        afford && !isSold ? TXT.cyan : TXT.mute, MONO)
      const kindLabel = up.kind === 'weapon' ? '器械'
        : up.kind === 'mount' ? '挂载' : up.kind === 'relic' ? '遗物' : '属性'
      const kindCol = up.kind === 'mount' ? TXT.amber
        : up.kind === 'relic' ? TXT.bone : TXT.dim
      // 类型标签紧跟序号放在**左上角**。之前右对齐到锁定按钮左侧，
      // 结果是"属性"两个字被锁定按钮压住（实机截图可见）。
      this.txt(kindLabel, c.x + 46, c.y + 21, '13px', kindCol, FONT)

      // —— 立绘位：比卡面**更深**的实底槽 + 1px 细边 ——
      // 深底让亮色立绘"跳"出来（Brotato 的图标位也是这种"底比卡深"的关系）。
      // 这里**必须不透明**：原来的 0.62 会让背景辉光透进画框，
      // 实测量到的画框内亮度方差 26.6 —— 那不是"氛围"，那是噪点。
      const ax = c.x + 16, ay = c.y + artTop, aw = c.w - 32, ah = artH
      g.fillStyle(MENU.slot, 1)
      g.fillRoundedRect(ax, ay, aw, ah, 8)
      g.lineStyle(1, MENU.divider, isSold ? 0.5 : 1)
      g.strokeRoundedRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1, 8)
      // 原「展台」（椭圆光晕 + 透视网纹）已删除：那是三条叠在立绘下面的装饰线，
      // 在实底槽上只会把画面弄脏。图示"有分量"靠的是深底对比，不是垫光。

      // —— 立绘内容：按类型画不同的东西（统一以立绘框中心为基准）——
      const artY = ay + ah / 2
      const artS = Phaser.Math.Clamp(ah * 0.42, 24, 50)
      // 武器卡有两种 id：`w_xxx`（基础）与 `e_xxx`（进化，V6.17）。
      // 用 `WEAPON_DEF` 的存在性判断，比枚举四个基础 id 更能容纳后续新形态。
      const rawWid = (up.id.startsWith('w_') || up.id.startsWith('e_')) ? up.id.slice(2) : null
      // 先查修正表（w_torp / w_harp 这两个缩写的坑，见 CARD_WEAPON_ID 注释）
      const wid = CARD_WEAPON_ID[up.id]
        ?? ((rawWid && (WEAPON_DEF as Record<string, unknown>)[rawWid])
          ? rawWid as WeaponId : null)

      // —— 立绘图片（V6.21 起）：武器卡与遗物卡都用真立绘 ——
      // id 来源分两种：武器卡取武器 id（`wid`）、遗物卡取遗物 id（`up.relicId`），
      // 两者的贴图键都统一是 `item_<id>`。只要图存在就用，代码图标只作兜底。
      // contain 缩放：贴图是 1200×600（2:1），立绘框约 200×100（同为 2:1），
      // 所以任何卡高下都等比放得下，不会被裁。
      const relicId = up.kind === 'relic' ? (up.relicId ?? null) : null
      const artId = wid ?? relicId
      const artImg = this.shopArt[i]
      const artKey = artId ? 'item_' + artId : ''
      const hasArt = !!artId && this.textures.exists(artKey)
      if (artImg) {
        if (hasArt) {
          artImg.setTexture(artKey)
          const k = Math.min((aw - 8) / artImg.width, (ah - 8) / artImg.height)
          artImg.setScale(k).setPosition(cx, artY).setVisible(true)
        } else {
          artImg.setVisible(false)
        }
      }

      if (wid) {
        // 有真立绘就不叠代码图标（会糊成一团）；没有的（进化形态）才画
        if (!hasArt) {
          // 器械：画真实器械图标（形状差异而非颜色，缩小也分得清）
          this.drawWeaponIcon(g, wid, cx, artY - artS * 0.18, artS)
        }
        // 等级点：画**最高**那台的等级；同款挂了多台时补一个 ×N。
        // 「同款可以挂多台」是 V6.6 的改动，卡面必须把台数也表达出来，
        // 否则玩家会以为重复拿同一把是白拿。
        // 位置跟着走：有立绘时贴到立绘框底缘（立绘画布自带约 8% 透明边，
        // 那一条是空的，点画上去不会压到武器）。
        const heldAll = this.weapons.filter(w => w.id === wid)
        if (heldAll.length) {
          const topLvl = Math.max(...heldAll.map(w => w.lvl))
          const pipY = hasArt ? ay + ah - 10 : artY + artS * 0.92
          this.drawLevelPips(g, cx, pipY, topLvl, WEAPON_DEF[wid].color)
          if (heldAll.length > 1) {
            this.txt(`×${heldAll.length}`, cx + 36, pipY - 6, '14px',
              TXT.cyan, MONO, 'left')
          }
        }
      } else if (up.kind === 'mount') {
        // 挂载扩容：**画座圈示意图** —— 让玩家看见"艇上多了哪个位置"。
        // 传ah（立绘框高）进去，让图示按框缩放，任何卡高下都不顶出框。
        this.drawMountDiagram(g, cx, artY - 6, up.id, ah)
      } else if (up.kind === 'relic') {
        // 遗物：有真立绘就不叠代码符号（会糊成一团），没有的才画一帧专属符号
        if (!hasArt) this.drawRelicIcon(g, up.relicId ?? 'echo_heart', cx, artY, artS)
      } else {
        // 属性卡：**大符号 + 进度条**（V6.25）。
        // 原来这块只有一根细条，占着整个立绘位却几乎没内容 —— 这是"卡面空、
        // 看着粗糙"的最后一个来源。Brotato 的属性卡是"一个图标 + 一行绿字"：
        // **图标负责被记住，数字负责被比较**，两者缺一不可。
        const sk = STAT_CARD[up.id]
        if (sk) {
          const gcol = STAT_META.find(m => m.k === sk)?.col ?? UI.cyan
          this.drawStatGlyph(g, sk, cx, artY - ah * 0.20, Math.min(46, ah * 0.44), gcol)
        }
        this.drawStatGauge(g, cx, artY + ah * 0.26, up.id)
      }

      // —— 名称：卡面最大字号，**纯白** ——
      // 原来是青色（TXT.cyber）。改白是刻意的：Brotato 的卡名就是白字，
      // 在深色实底上白字对比度最高；青色留给"数值"用，别让两种信息抢同一种颜色。
      this.txt(up.name, cx, c.y + nameRel, '22px', isSold ? TXT.mute : '#ffffff', FONT, 'center')

      // —— 描述：**绿色**，这是"这张卡给我什么"的收益行 ——
      // Brotato 把收益写成绿字（+5生命再生），说明写成灰字。层级靠颜色分，不靠字号。
      const descLines = this.wrapByWidth(up.desc, 14, c.w - 40, 3)
      for (let li = 0; li < descLines.length; li++) {
        this.txt(descLines[li], cx, c.y + descRel + li * 19, '14px',
          isSold ? TXT.mute : TXT.jade, FONT, 'center')
      }

      // —— 状态行：这张卡买了会发生什么，必须写死 ——
      // 玩家不该靠猜来判断"买到的是新武器还是强化"
      let foot = ''
      let footCol: string = TXT.amber
      // 进化卡要先拦下来：它是"把现役那台改造成新形态"，**不占新座位**。
      // 如果不拦，它会落到下面的"新装备 · 占用 1 个座位"分支 —— 那是错的。
      const evoBase = evolutionBase(wid)
      if (wid && evoBase) {
        foot = `进化现役的「${WEAPON_DEF[evoBase].name}」· 不占新座位`
        footCol = TXT.cyber
      } else if (wid) {
        const heldAll = this.weapons.filter(w => w.id === wid)
        const cap = Math.min(this.maxWeapons, MAX_SEATS)
        if (heldAll.length === 0) {
          foot = `新装备 · 占用 1 个座位（共 ${cap}）`
          footCol = TXT.cyan
        } else if (this.weapons.length < cap) {
          // 还有空位 → 同款再加一台，火力来自台数
          foot = `加装第 ${heldAll.length + 1} 台 · 与现役并联开火`
          footCol = TXT.cyan
        } else {
          // 满了 → 只能并进已有的一台去升级
          const lv = Math.min(...heldAll.map(w => w.lvl))
          foot = `座位已满 · 升级一台 Lv${lv} → Lv${Math.min(5, lv + 1)}`
          footCol = TXT.amber
        }
      } else if (up.id === 'w_all') {
        // 弹药改良（w_all）的 id 不是武器 id，`wid` 会被算成 null，
        // 所以这里必须按 **卡 id** 判断，不能再写 `wid === 'all'`。
        foot = `${this.weapons.length} 台器械同时 +1 级`
      } else if (up.kind === 'mount') {
        foot = up.id === 't_twin'
          ? `扩容座射速 +25%（当前 +${Math.round(this.st.twinRate * 100)}%）`
          : `座圈 ${this.maxWeapons} → ${up.id === 't_slot5' ? 5 : 6} 座`
      } else if (up.kind === 'relic') {
        // 遗物：写清占哪个槽 + 代价。**代价必须用告警色单独一行** ——
        // 把代价藏在描述里等于骗玩家，他会在第三波才发现自己氧气少了 15。
        foot = this.relics.length < RELIC_SLOTS
          ? `占用遗物槽 ${this.relics.length + 1} / ${RELIC_SLOTS}`
          : '遗物槽已满'
      }
      // 状态行统一降为灰字 —— 它是**元信息**（占几个座位 / 进化哪台），
      // Brotato 这一行也是灰的。只有"受阻"这类要提醒的（footCol 为告警色）保留橙。
      if (foot) {
        const fc = isSold ? TXT.mute : (footCol === TXT.amber ? TXT.amber : TXT.dim)
        this.txt(foot, cx, c.y + footRel, '13px', fc, FONT, 'center')
      }

      // 遗物的代价单独一行，告警色，画在状态行下方（字号 12，与状态行拉开一档）
      if (up.kind === 'relic' && up.relicId) {
        const c2 = RELIC_DEF[up.relicId].cost2
        // 代价也折行：最长那条「无代价 —— 但你得敢留在那条线上」有 15 个中文字，
        // 12px 下约 180px，逼近卡净宽 196px；不折行迟早会顶到邻卡。
        if (c2) {
          const cLines = this.wrapByWidth(c2, 12, c.w - 40, 2)
          for (let li = 0; li < cLines.length; li++) {
            this.txt(cLines[li], cx, c.y + costRel + li * 16, '12px',
              isSold ? TXT.mute : TXT.warn, FONT, 'center')
          }
        }
      }

      const pY = c.y + c.h - PRICE_H - 12
      // 价格条：改成**不透明深底**（原来是 0.6 半透明）。
      // 它要在视觉上"托住"价格数字，半透明会让卡面纹理透上来、把数字糊掉。
      g.fillStyle(MENU.slot, 1); g.fillRoundedRect(c.x + 12, pY, c.w - 24, PRICE_H, 8)
      g.lineStyle(1, MENU.divider, isSold ? 0.5 : 1)
      g.strokeRoundedRect(c.x + 12.5, pY + 0.5, c.w - 25, PRICE_H - 1, 8)

      if (isSold) {
        // 已售出：不画价格，画一条贯穿的"已购入"
        g.fillStyle(UI.jade, 0.6)
        g.fillRect(c.x + 24, pY + PRICE_H / 2, c.w - 48, 1)
        this.txt('已购入', cx, pY + PRICE_H / 2 - 10, '17px', TXT.jade, FONT, 'center')
      } else {
        // 鱼骨币图标 + 价格 + 状态词：**三段宽度都算出来再排**，
        // 不用"图标位置 + 数字长度 × 系数"这种会随位数漂移的手工偏移。
        const costStr = `${up.cost}`
        const stateStr = afford ? '点击购买' : '鱼骨不足'
        const wIcon = 8, wCost = costStr.length * 13, wState = stateStr.length * 12
        const grpW = wIcon * 2 + 7 + wCost + 10 + wState
        let gx = cx - grpW / 2
        neonCircle(g, gx + wIcon, pY + PRICE_H / 2, wIcon, BONE, { width: 1.4, bloom: false })
        gx += wIcon * 2 + 7
        this.txt(costStr, gx, pY + PRICE_H / 2 - 11, '21px',
          afford ? TXT.cyber : TXT.warn, MONO, 'left')
        // 买不起时不弹提示（打断节奏），而是把价格转告警色，
        // 玩家自己会得出"我得再捡一波"的结论 —— 这就是鱼骨经济该教的判断。
        this.txt(stateStr, gx + wCost + 10, pY + PRICE_H / 2 - 8, '12px',
          afford ? TXT.dim : TXT.warn, FONT)
      }

      // —— 锁定按钮（右上角）：V6.10 从价格行挪到这里，与价格彻底分开 ——
      {
        const lockX = c.x + c.w - 62 - 14, lockY = c.y + 14
        const lockH = 26
        g.fillStyle(isLocked ? UI.amber : (isSold ? UI.panel : UI.panelHi), isLocked ? 0.9 : 0.72)
        g.fillRoundedRect(lockX, lockY, 62, lockH, 6)
        g.lineStyle(1.2, isLocked ? UI.amber : UI.line, isLocked ? 1 : 0.6)
        g.strokeRoundedRect(lockX, lockY, 62, lockH, 6)
        // 锁图标：锁定时闭合（实心方块 + 梁），未锁定时开口
        const lcx2 = lockX + 15, lcy2 = lockY + lockH / 2
        g.lineStyle(1.8, isLocked ? UI.abyss : UI.cyanDim, 0.95)
        g.beginPath()
        if (isLocked) g.strokeRect(lcx2 - 5, lcy2 - 1, 10, 8)
        else { g.moveTo(lcx2 - 5, lcy2 + 3); g.lineTo(lcx2 - 5, lcy2 - 1)
               g.lineTo(lcx2 + 5, lcy2 - 1); g.lineTo(lcx2 + 5, lcy2 + 3) }
        g.strokePath()
        this.txt(isLocked ? '已锁定' : '锁定', lockX + 26, lockY + 7, '12px',
          isLocked ? TXT.amber : TXT.mute, FONT)
      }
    }

    // —— 底部动作按钮 ——
    // V6.10：主次分明。「继续」是这一屏唯一的主行动（绿色实心描边 + 更亮），
    // 「刷新」是次行动（青色细描边）。之前两个按钮同色同重，
    // 玩家的视线没有落点，会犹豫"我该点哪个"。
    if (this.rerollBtnRect) {
      const r = this.rerollBtnRect
      const canRoll = this.bank >= this.rerollCost
      // 次按钮：**扁平实色块 + 硬边 + 单行内容**。
      // 原来是"两行文字塞进霓虹描边块"，读起来像信息堆而不是一个按钮。
      // Brotato 的刷新按钮就一行（图标 + 数字 + 文字），剩下的空间用来呼吸。
      g.fillStyle(canRoll ? MENU.card : MENU.slot, 1)
      g.fillRoundedRect(r.x, r.y, r.w, r.h, 10)
      g.lineStyle(2, canRoll ? MENU.edge : MENU.divider, 1)
      g.strokeRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 9)
      const priceStr = `${this.rerollCost}`
      const titleStr = '刷新'
      const wIcon = 8, wPrice = priceStr.length * 12, wTitle = titleStr.length * 19
      const grpW = wIcon * 2 + 8 + wPrice + 16 + wTitle
      let gx = r.x + (r.w - grpW) / 2
      neonCircle(g, gx + wIcon, r.y + r.h / 2, wIcon, BONE, { width: 1.4, bloom: false })
      gx += wIcon * 2 + 8
      this.txt(priceStr, gx, r.y + r.h / 2 - 12, '20px',
        canRoll ? TXT.bone : TXT.mute, MONO, 'left')
      this.txt(titleStr, gx + wPrice + 16, r.y + r.h / 2 - 11, '19px',
        canRoll ? TXT.main : TXT.mute, FONT, 'left')
    }
    if (this.leaveBtnRect) {
      const b = this.leaveBtnRect
      // 主按钮：**实心亮块 + 深色字**。反白是"这就是你要点的那一个"最强的信号 ——
      // 霓虹描边做不到这件事（满屏都在发光，就没有重点）。
      // 深色字必须关掉 txt 的默认描边（见 txt 的 stroke 参数）。
      g.fillStyle(UI.jade, 0.95)
      g.fillRoundedRect(b.x, b.y, b.w, b.h, 10)
      this.txt('继续 · 下一波', b.x + b.w / 2, b.y + 9, '20px',
        '#04140f', FONT, 'center', 'ui', false)
      this.txt(`剩余 ${this.bank} 鱼骨保留`, b.x + b.w / 2, b.y + 34, '12px',
        '#0a2a22', FONT, 'center', 'ui', false)
    }
  }

  /** 等级点：5 格，已达成实心 + 发光，未达成空心 */
  private drawLevelPips(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                        lvl: number, col: number): void {
    const n = 5, gap = 11, w = 7
    const x0 = cx - ((n - 1) * gap) / 2
    for (let i = 0; i < n; i++) {
      const x = x0 + i * gap
      if (i < lvl) {
        g.fillStyle(col, 0.95); g.fillRect(x - w / 2, cy - 2.5, w, 5)
      } else {
        g.lineStyle(1, col, 0.4); g.strokeRect(x - w / 2, cy - 2.5, w, 5)
      }
    }
  }

  /**
   * 挂载位示意图（挂载扩容卡专用）。
   *
   * V6.10 重做成**与战斗内一致的座圈俯视图**：中间一条艇身椭圆，
   * 周围按 `SEAT_ANGLES_DEG` 摆 6 个座位点。
   * 已占用的画实心（器械本色），**这张卡会新解锁的那一个画闪烁的琥珀空心圈**。
   *
   * 为什么必须画示意、而且必须和战斗里长得一样：
   * 扩容卡的收益是"多一座炮"，纯文字（"解锁第 5 挂载位"）玩家无法判断价值；
   * 而如果示意图和实机画法不同（图上是横排方块、实机是圆座），
   * 玩家在图上学的记号到游戏里对不上，卡的说明就是废的。
   * 两处共用同一套角度常量与半径比例，改一处必须改两处。
   */
  private drawMountDiagram(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                           id: string, boxH: number): void {
    const target = id === 't_slot5' ? 5 : id === 't_slot6' ? 6 : this.maxWeapons
    const n = Math.max(target, this.maxWeapons)
    // 缩放由**立绘框实际高度**决定，而不是写死系数。
    // 上一版固定 k=0.62，在ch 变小 → 立绘框压到 46px 时，
    // 座圈直径（R·2·1.15 ≈ 57px）直接顶出画框，卡面上像"图示浮在框外"。
    // 这里把「座圈 + 新位闪烁环 + 座位文字」整套所需高度一起算进缩放，
    // 保证任何卡高下图示都完整落在框内。
    const needH = SEAT_RING_R * 2 * 1.15 * 1.7 + 16   // 环 + 闪烁环 + 文字
    const k = Phaser.Math.Clamp((boxH - 8) / needH, 0.30, 0.72)
    const R = SEAT_RING_R * k
    const bodyL = 30 * k, bodyW = 15 * k

    // 艇身（俯视椭圆）—— 与实机 99×52 的长宽比一致
    neon(g, UI.cyanDim, () => {
      g.strokeEllipse(cx, cy, bodyL * 2, bodyW * 2)
    }, { width: 1.2, alpha: 0.45, bloom: false })

    const plan = this.mountPlan()
    for (let i = 0; i < n; i++) {
      const a = SEAT_ANGLES_DEG[i] * Math.PI / 180
      const x = cx + R * Math.cos(a)
      const y = cy + R * Math.sin(a)
      const occupied = i < this.weapons.length
      const isNew = i === target - 1
      const ext = i >= BASE_SEATS
      const col = occupied ? WEAPON_DEF[this.weapons[i].id].color : UI.cyan
      const r = TURRET_R * k * (ext ? 1.15 : 1)

      if (occupied) {
        g.fillStyle(UI.panel, 0.6); g.fillCircle(x, y, r)
        neon(g, col, () => { g.strokeCircle(x, y, r) },
          { width: 1.4, alpha: 0.95, bloom: false })
        g.fillStyle(col, 0.95); g.fillCircle(x, y, r * 0.34)
      } else {
        const a2 = isNew ? 1 : 0.45
        const c2 = isNew ? UI.amber : UI.cyanDim
        g.lineStyle(isNew ? 1.8 : 1, c2, a2)
        g.strokeCircle(x, y, r)
      }

      // 新解锁位：外面套一圈闪烁提示环
      if (isNew) {
        const blink = 0.45 + 0.55 * Math.abs(Math.sin(this.t * 5))
        neonCircle(g, x, y, r * 1.7, UI.amber, { width: 1.8, alpha: blink, bloom: false })
      }
    }
    // 座圈编号：告诉玩家"这是第几座"（扩容卡的价值 = 序号递进）
    void plan
    this.txt(`${this.weapons.length} → ${target} 座`, cx, cy + bodyW + 12, '12px',
      TXT.dim, MONO, 'center')
  }

  /**
   * 属性面板（商店左侧）。
   *
   * 每行：色块 + 名称 + 数值。数值为 0 的行用 mute 色压暗 ——
   * 这样一眼能看出"我这一局往哪几个方向点了"，而不是一整列数字。
   * 触顶的属性（护甲/闪避）在数值后补一个 MAX 标记，
   * 否则玩家会一直买，然后困惑为什么没变化。
   */
  private drawStatPanel(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const w = 250, rowH = 30
    const h = 44 + STAT_META.length * rowH
    // 审计：每帧登记侧栏面板（用于对比度计算）
    this.ui.push({ kind: 'panel', x, y, w, h, fill: '#' + (UI.panel as number).toString(16).padStart(6, '0') })
    g.fillStyle(UI.panel, 0.88); g.fillRoundedRect(x, y, w, h, 10)
    neon(g, UI.cyanDim, () => { g.strokeRoundedRect(x, y, w, h, 10) },
      { width: 1, alpha: 0.5, bloom: false })
    this.txt('潜航器属性', x + 14, y + 11, '14px', TXT.cyber, FONT)
    g.fillStyle(UI.cyanDim, 0.6)
    g.fillRect(x + 14, y + 32, w - 28, 1)

    for (let i = 0; i < STAT_META.length; i++) {
      const m = STAT_META[i]
      const v = this.st[m.k]
      const ry = y + 40 + i * rowH
      const on = v > 0.0001
      // 色块：既是装饰也是色标，和卡面顶部的类型色条同一套语言
      g.fillStyle(m.col, on ? 0.95 : 0.3)
      g.fillRect(x + 14, ry + 4, 4, 12)
      this.txt(m.name, x + 26, ry + 2, '13px', on ? TXT.main : TXT.dim, FONT)

      const cap = STAT_CAP[m.k]
      const maxed = cap !== undefined && v >= cap - 0.0001
      const vTxt = m.pct ? `${Math.round(v * 100)}%` : (m.k === 'regen' ? v.toFixed(1) : `${Math.round(v)}`)
      this.txt(maxed ? `${vTxt} MAX` : vTxt, x + w - 14, ry + 2, '14px',
        maxed ? TXT.amber : (on ? TXT.cyber : TXT.mute), MONO, 'right')
    }
  }

  /**
   * 遗物槽（商店右侧）。
   *
   * 已装的画图标 + 名称 + 代价（代价用告警色小字），空槽画虚框 + 序号。
   * 代价**必须在槽里也写一遍**：玩家在第 8 波看到氧气上限变低时，
   * 需要一个地方回查"这是哪个遗物带来的"，否则他会认为是 bug。
   */
  private drawRelicSlots(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const w = 250
    const cellH = 74
    const h = 44 + RELIC_SLOTS * cellH
    // 审计：每帧登记侧栏面板（用于对比度计算）
    this.ui.push({ kind: 'panel', x, y, w, h, fill: '#' + (UI.panel as number).toString(16).padStart(6, '0') })
    g.fillStyle(UI.panel, 0.88); g.fillRoundedRect(x, y, w, h, 10)
    neon(g, BONE, () => { g.strokeRoundedRect(x, y, w, h, 10) },
      { width: 1, alpha: 0.5, bloom: false })
    this.txt(`遗物槽 ${this.relics.length} / ${RELIC_SLOTS}`, x + 14, y + 11, '14px', TXT.bone, FONT)
    g.fillStyle(BONE, 0.35)
    g.fillRect(x + 14, y + 32, w - 28, 1)

    for (let i = 0; i < RELIC_SLOTS; i++) {
      const ry = y + 38 + i * cellH
      const bx = x + 12, bw = w - 24, bh = cellH - 8
      const id = this.relics[i]
      if (!id) {
        g.lineStyle(1, UI.line, 0.5)
        g.strokeRoundedRect(bx, ry, bw, bh, 8)
        this.txt(`空槽 ${i + 1}`, bx + bw / 2, ry + bh / 2 - 8, '12px', TXT.mute, FONT, 'center')
        continue
      }
      const r = RELIC_DEF[id]
      g.fillStyle(UI.panelHi, 0.75); g.fillRoundedRect(bx, ry, bw, bh, 8)
      neon(g, BONE, () => { g.strokeRoundedRect(bx, ry, bw, bh, 8) },
        { width: 1.2, alpha: 0.75, bloom: false })
      this.drawRelicIcon(g, id, bx + 26, ry + bh / 2, 14)
      this.txt(r.name, bx + 50, ry + 7, '14px', TXT.bone, FONT)
      // 描述可能较长，**折行**（槽宽 226，14px 中文约 16 字/行）
      // 原来是一行 10px 不折行，「拾取范围 +80% · 鱼骨价值 +30%」直接顶出槽外。
      const dLines = this.wrapByWidth(r.desc, 12, bw - 62, 2)
      for (let li = 0; li < dLines.length; li++) {
        this.txt(dLines[li], bx + 50, ry + 26 + li * 15, '12px', TXT.dim, FONT)
      }
      if (r.cost2) {
        const cLines = this.wrapByWidth(r.cost2, 12, bw - 62, 2)
        for (let li = 0; li < cLines.length; li++) {
          this.txt(cLines[li], bx + 50, ry + 27 + dLines.length * 15 + li * 15, '12px', TXT.warn, FONT)
        }
      }
    }
  }

  /**
   * 遗物图标。八个遗物各自一个**形状签名**，刻意不靠颜色区分 ——
   *
   * 商店里三张卡并排，颜色在小尺寸下会互相污染（尤其都带 bloom 时），
   * 形状不会。玩家第二次看到"带裂纹的心形"就会认出回声心脏，
   * 这才叫"认得出来"，颜色只能做到"看起来不一样"。
   */
  private drawRelicIcon(g: Phaser.GameObjects.Graphics, id: RelicId,
                        cx: number, cy: number, r: number): void {
    const col = BONE
    const lw = 2
    g.lineStyle(lw, col, 0.95)
    switch (id) {
      case 'echo_heart': {
        // 心形 + 一道裂纹：低氧才发动的东西，画成"破了的心"
        g.beginPath()
        g.moveTo(cx, cy + r * 0.75)
        g.lineTo(cx - r, cy - r * 0.15)
        g.arc(cx - r * 0.5, cy - r * 0.45, r * 0.5, Math.PI * 0.85, Math.PI * 1.9)
        g.arc(cx + r * 0.5, cy - r * 0.45, r * 0.5, Math.PI * 1.1, Math.PI * 0.15)
        g.closePath(); g.strokePath()
        g.lineStyle(1.4, UI.danger, 0.9)
        g.beginPath()
        g.moveTo(cx - 2, cy - r * 0.5); g.lineTo(cx + 3, cy + r * 0.1)
        g.lineTo(cx - 3, cy + r * 0.35)
        g.strokePath()
        break
      }
      case 'osteoblast': {
        // 骨头：两端各两个圆，中间一根
        g.beginPath(); g.moveTo(cx - r * 0.45, cy - r * 0.3); g.lineTo(cx + r * 0.45, cy + r * 0.3)
        g.strokePath()
        for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
          g.fillStyle(col, 0.9)
          g.fillCircle(cx + sx * r * 0.5, cy + sy * r * 0.38, r * 0.24)
        }
        break
      }
      case 'tidal_compass': {
        // 罗盘：外圈 + 四向指针（菱形）
        g.strokeCircle(cx, cy, r * 0.8)
        g.beginPath()
        g.moveTo(cx, cy - r * 0.7); g.lineTo(cx + r * 0.35, cy)
        g.lineTo(cx, cy + r * 0.7); g.lineTo(cx - r * 0.35, cy)
        g.closePath(); g.strokePath()
        break
      }
      case 'resonance_core': {
        // 同心弧 ×3 + 中心点：向外扩的共振
        for (let i = 1; i <= 3; i++) {
          g.lineStyle(lw - i * 0.35, col, 1 - i * 0.2)
          g.beginPath(); g.arc(cx, cy, r * 0.3 * i, -0.9, 0.9); g.strokePath()
          g.beginPath(); g.arc(cx, cy, r * 0.3 * i, Math.PI - 0.9, Math.PI + 0.9); g.strokePath()
        }
        g.fillStyle(col, 1); g.fillCircle(cx, cy, 3)
        break
      }
      case 'gluttony': {
        // 张开的大口：一个扇形 + 三颗尖牙（贪婪）
        g.beginPath(); g.arc(cx, cy, r * 0.8, Math.PI * 0.15, Math.PI * 0.85); g.strokePath()
        g.beginPath(); g.arc(cx, cy, r * 0.8, Math.PI * 1.15, Math.PI * 1.85); g.strokePath()
        g.fillStyle(col, 0.85)
        for (let i = -1; i <= 1; i++) {
          g.fillTriangle(cx + i * r * 0.4 - 4, cy - r * 0.1,
                         cx + i * r * 0.4 + 4, cy - r * 0.1,
                         cx + i * r * 0.4, cy + r * 0.35)
        }
        break
      }
      case 'abyss_mark': {
        // 向下的三层箭头：越深越强
        for (let i = 0; i < 3; i++) {
          const yy = cy - r * 0.5 + i * r * 0.5
          g.lineStyle(lw, col, 0.5 + i * 0.25)
          g.beginPath()
          g.moveTo(cx - r * 0.5, yy); g.lineTo(cx, yy + r * 0.3); g.lineTo(cx + r * 0.5, yy)
          g.strokePath()
        }
        break
      }
      case 'current_fin': {
        // 鳍：三条流线 + 一片三角
        g.fillStyle(col, 0.85)
        g.fillTriangle(cx - r * 0.6, cy + r * 0.5, cx + r * 0.5, cy + r * 0.1, cx - r * 0.2, cy - r * 0.6)
        g.lineStyle(1.3, UI.cyan, 0.8)
        for (let i = 0; i < 3; i++) {
          const yy = cy - r * 0.3 + i * r * 0.35
          g.beginPath(); g.moveTo(cx + r * 0.25, yy); g.lineTo(cx + r * 0.9, yy - 4); g.strokePath()
        }
        break
      }
      case 'silent_plating': {
        // 盾牌 + 内部竖线（装甲板）
        g.beginPath()
        g.moveTo(cx, cy - r * 0.8); g.lineTo(cx + r * 0.65, cy - r * 0.4)
        g.lineTo(cx + r * 0.5, cy + r * 0.5); g.lineTo(cx, cy + r * 0.8)
        g.lineTo(cx - r * 0.5, cy + r * 0.5); g.lineTo(cx - r * 0.65, cy - r * 0.4)
        g.closePath(); g.strokePath()
        g.lineStyle(1.2, col, 0.6)
        for (let i = -1; i <= 1; i++) {
          g.beginPath(); g.moveTo(cx + i * r * 0.28, cy - r * 0.45)
          g.lineTo(cx + i * r * 0.28, cy + r * 0.45); g.strokePath()
        }
        break
      }
    }
  }

  /**
   * 属性卡的"当前进度条"。
   *
   * 为什么画进度而不是抽象图标：属性卡的价值取决于**我已经堆了多少**。
   * 同样的"暴击 +8%"，在 0% 和 60% 时是完全不同的两个决策（后者快触顶了）。
   * 条里同时画出"现在"和"买了之后"，玩家不用心算。
   */
  /**
   * 属性卡的符号（V6.25）。全部用最简几何形，靠**形状**区分而不是颜色 ——
   * 12 种属性在 40px 下要能一眼分开，颜色只有 5 种，不够用。
   * 这些符号只承担"被记住"：数值比较交给下面的进度条。
   */
  private drawStatGlyph(g: Phaser.GameObjects.Graphics, k: keyof Stats,
                        cx: number, cy: number, s: number, col: number): void {
    const path = (fn: () => void, w = 2.4, a = 1) =>
      neon(g, col, () => { g.beginPath(); fn(); g.strokePath() }, { width: w, alpha: a, bloom: false })
    const seg = (x1: number, y1: number, x2: number, y2: number, w = 2.4, a = 1) =>
      neonLine(g, x1, y1, x2, y2, col, { width: w, alpha: a, bloom: false })
    switch (k) {
      case 'dmg':      // 向上箭头 = 强度
        path(() => {
          g.moveTo(cx, cy - s * 0.5); g.lineTo(cx + s * 0.42, cy + s * 0.06)
          g.lineTo(cx + s * 0.16, cy + s * 0.06); g.lineTo(cx + s * 0.16, cy + s * 0.5)
          g.lineTo(cx - s * 0.16, cy + s * 0.5); g.lineTo(cx - s * 0.16, cy + s * 0.06)
          g.lineTo(cx - s * 0.42, cy + s * 0.06); g.closePath()
        })
        break
      case 'rate':     // 三条速度线
        for (let i = -1; i <= 1; i++) {
          seg(cx - s * 0.46, cy + i * s * 0.3, cx + s * 0.32, cy + i * s * 0.3, 2.4, i === 0 ? 1 : 0.55)
        }
        break
      case 'crit':     // 准星
        neonCircle(g, cx, cy, s * 0.4, col, { width: 2.4, bloom: false })
        seg(cx - s * 0.62, cy, cx - s * 0.2, cy); seg(cx + s * 0.2, cy, cx + s * 0.62, cy)
        seg(cx, cy - s * 0.62, cx, cy - s * 0.2); seg(cx, cy + s * 0.2, cx, cy + s * 0.62)
        break
      case 'range':    // 同心弧
        for (let i = 0; i < 3; i++) {
          path(() => { g.arc(cx - s * 0.34, cy, s * (0.3 + i * 0.2), -0.85, 0.85) },
            2.2, 1 - i * 0.28)
        }
        break
      case 'armor':    // 盾形
        path(() => {
          g.moveTo(cx, cy - s * 0.5); g.lineTo(cx + s * 0.42, cy - s * 0.26)
          g.lineTo(cx + s * 0.32, cy + s * 0.3); g.lineTo(cx, cy + s * 0.52)
          g.lineTo(cx - s * 0.32, cy + s * 0.3); g.lineTo(cx - s * 0.42, cy - s * 0.26)
          g.closePath()
        })
        break
      case 'dodge':    // 划开的斜线 = 躲开
        seg(cx - s * 0.5, cy + s * 0.42, cx + s * 0.06, cy - s * 0.14, 2.8)
        seg(cx + s * 0.3, cy - s * 0.38, cx + s * 0.5, cy - s * 0.5, 2.8, 0.5)
        seg(cx + s * 0.14, cy - s * 0.52, cx + s * 0.52, cy - s * 0.14, 2.2, 0.55)
        break
      case 'speed':    // 双层人字
        for (let i = 0; i < 2; i++) {
          path(() => {
            g.moveTo(cx - s * 0.46 + i * s * 0.34, cy - s * 0.36)
            g.lineTo(cx - s * 0.08 + i * s * 0.34, cy)
            g.lineTo(cx - s * 0.46 + i * s * 0.34, cy + s * 0.36)
          }, 2.8, 1 - i * 0.4)
        }
        break
      case 'pickup':   // 磁吸：中心圆 + 两侧外弧
        neonCircle(g, cx, cy + s * 0.08, s * 0.26, col, { width: 2.4, bloom: false })
        path(() => { g.arc(cx, cy + s * 0.08, s * 0.5, -0.75, 0.75) }, 2.4, 0.6)
        path(() => { g.arc(cx, cy + s * 0.08, s * 0.5, Math.PI - 0.75, Math.PI + 0.75) }, 2.4, 0.6)
        break
      case 'luck':     // 四角星
        path(() => {
          g.moveTo(cx, cy - s * 0.52); g.lineTo(cx + s * 0.14, cy - s * 0.14)
          g.lineTo(cx + s * 0.52, cy); g.lineTo(cx + s * 0.14, cy + s * 0.14)
          g.lineTo(cx, cy + s * 0.52); g.lineTo(cx - s * 0.14, cy + s * 0.14)
          g.lineTo(cx - s * 0.52, cy); g.lineTo(cx - s * 0.14, cy - s * 0.14)
          g.closePath()
        })
        break
      case 'regen':    // 循环箭头
        path(() => { g.arc(cx, cy, s * 0.38, 0.55, Math.PI * 1.72) }, 2.6)
        seg(cx + s * 0.18, cy - s * 0.46, cx + s * 0.46, cy - s * 0.24, 2.4)
        seg(cx + s * 0.46, cy - s * 0.24, cx + s * 0.2, cy - s * 0.16, 2.4)
        break
      case 'killO2':   // 环 + 十字（回氧）
        neonCircle(g, cx, cy, s * 0.44, col, { width: 2.2, bloom: false })
        seg(cx - s * 0.2, cy, cx + s * 0.2, cy, 2.6)
        seg(cx, cy - s * 0.2, cx, cy + s * 0.2, 2.6)
        break
      default:         // o2Bonus · 扩容气瓶：胶囊 + 加号
        neon(g, col, () => {
          g.strokeRoundedRect(cx - s * 0.28, cy - s * 0.46, s * 0.56, s * 0.92, s * 0.28)
        }, { width: 2.4, bloom: false })
        seg(cx - s * 0.13, cy, cx + s * 0.13, cy, 2.4)
        seg(cx, cy - s * 0.13, cx, cy + s * 0.13, 2.4)
        break
    }
  }

  private drawStatGauge(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                        cardId: string): void {
    // 卡 id → 属性键 + 这一张给多少
    const MAP: Record<string, { k: keyof Stats; add: number }> = {
      speed:   { k: 'speed',   add: 0.15 },
      pickup:  { k: 'pickup',  add: 0.4 },
      tank:    { k: 'o2Bonus', add: 20 },
      gill:    { k: 'killO2',  add: 3 },
      s_dmg:   { k: 'dmg',     add: 0.12 },
      s_rate:  { k: 'rate',    add: 0.10 },
      s_crit:  { k: 'crit',    add: 0.08 },
      s_range: { k: 'range',   add: 0.15 },
      s_armor: { k: 'armor',   add: 0.08 },
      s_dodge: { k: 'dodge',   add: 0.06 },
      s_regen: { k: 'regen',   add: 0.4 },
      s_luck:  { k: 'luck',    add: 0.15 },
    }
    const m = MAP[cardId]
    if (!m) { neonCircle(g, cx, cy, 20, UI.violet, { width: 2, bloom: false }); return }
    // 满值：有上限的用上限，没有的给一个"看起来合理的"参考刻度
    const full = STAT_CAP[m.k] ?? (m.k === 'o2Bonus' ? 100 : m.k === 'killO2' ? 12 : 1.0)
    const cur = Phaser.Math.Clamp(this.st[m.k] / full, 0, 1)
    const next = Phaser.Math.Clamp((this.st[m.k] + m.add) / full, 0, 1)
    // 长条尺寸随立绘框走。曾经写死 116×12 —— 立绘框放大到约 212×200 之后，
    // 一根 116×12 的细条孤零零浮在中间，卡面看起来"空且没重点"。
    // 现在按立绘框宽度取 0.72，高度 12 → 22，并加一层外框与刻度。
    const w = 172, h = 20
    const x0 = cx - w / 2, y0 = cy - h / 2

    const gcol = STAT_META.find(x => x.k === m.k)?.col ?? UI.violet
    // 槽底改**不透明**（原来 0.9）：卡面已经是实底，槽底也必须实底，
    // 否则那一点透上来的纹理会把"两个数字叠在一起比较"的关系搅浑。
    // 进度条的颜色改跟**属性本身**走（和上面的大符号同色），
    // 原来一律用紫色，12 种属性长一个样，等于放弃了"余光辨色"这条通道。
    g.fillStyle(MENU.slot, 1); g.fillRoundedRect(x0, y0, w, h, 7)
    g.fillStyle(gcol, 0.35); g.fillRoundedRect(x0, y0, Math.max(2, w * next), h, 5)
    g.fillStyle(gcol, 0.95); g.fillRoundedRect(x0, y0, Math.max(2, w * cur), h, 5)
    g.lineStyle(1, MENU.divider, 1)
    g.strokeRoundedRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1, 5)

    // 增量段标一个箭头，避免玩家看不出"浅色那段是我要买的"
    if (next > cur + 0.01) {
      const mx = x0 + w * (cur + next) / 2
      g.fillStyle(UI.cyanHi, 0.9)
      g.fillTriangle(mx - 3, y0 - 4, mx + 3, y0 - 4, mx, y0 + 1)
    }
    const shown = m.k === 'o2Bonus' || m.k === 'killO2' || m.k === 'regen'
      ? `${this.st[m.k].toFixed(m.k === 'regen' ? 1 : 0)} → ${(this.st[m.k] + m.add).toFixed(m.k === 'regen' ? 1 : 0)}`
      : `${Math.round(this.st[m.k] * 100)}% → ${Math.round(Math.min(full, this.st[m.k] + m.add) * 100)}%`
    this.txt(shown, cx, cy + 18, '14px', TXT.cyber, MONO, 'center')
  }

  // （V6.7：pickUpgrade 已拆成 buyCard / reroll / toggleLock / leaveShop，
  //  商店从"免费三选一"改成鱼骨经济后可以买多张。）

  // ==========================================================================
  // 层末补给站：下潜 / 上浮（V6 相对 Brotato 的唯一结构增量）
  // ==========================================================================
  private openDecide(): void {
    this.phase = 'decide'
    this.hoverBtn = -1
    this.clearHits()
  }

  /** 继续下潜：扣门票氧气 → 上限压缩 → 收益倍率 +0.5 */
  private diveDeeper(): void {
    if (this.phase !== 'decide') return
    const toll = this.layer().toll
    if (this.o2 <= toll) return       // 氧气不够买门票，只能上浮
    this.layerIdx++
    this.waveInLayer = 0
    this.mult += 0.5
    const L = this.layer()
    this.o2Max = L.o2Max + this.st.o2Bonus
    this.o2 = Math.min(this.o2 - toll, this.o2Max)
    this.clearHits()
    this.enemies = []; this.bones = []; this.pulses = []; this.debris = []
    this.bullets = []; this.arcs = []; this.blasts = []; this.echoes = []; this.acids = []
    this.sparks = []; this.shocks = []; this.slashes = []; this.floats = []
    this.hurtDirT = 0; this.hurtFlash = 0   // 旧层的受击暗角不能带进新层
    // 背景立刻切到新层：过渡中点 cover=0.72 时几乎看不见旧景，
    // 后半段 cover 降到 0.28 自然就露出新层，衔接不跳变。
    // 注意不能调 syncEnv()——它会重算 depthM，把过渡的插值覆盖掉。
    this.bg.setTexture(`env${this.layerIdx}`)
    this.layoutBg()
    // 先扣门票、改层参数，但**不立刻开战**——先进下潜过渡演出。
    // 以前是瞬间黑屏切换，玩家只感觉到"换了个底色"，感觉不到自己在下潜。
    const from = LAYERS[this.layerIdx - 1].depthBot
    this.descFrom = from
    // 目标不是下一层顶，而是它的 35% 处：一次滚过头，比"刚好到顶"更像还在继续下潜
    this.descTo = L.depthTop + (L.depthBot - L.depthTop) * 0.35
    this.descT = 0
    this.phase = 'descending'
    this.layerCardT = 2.6                 // 层入场卡：换层时必须"当场被告知"这层不一样
    this.cameras.main.shake(260, 0.004)   // 压力舱推进的闷响
  }

  /** 上浮兑现：结算，带走 100% */
  private surface(): void {
    if (this.phase !== 'decide') return
    this.showResult(true)
  }

  private drawDecide(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    this.drawSeaBackdrop(g, W, H, 0.80)

    const pw = Math.min(720, W - 60)
    const ph = Math.min(420, H - 60)
    const x = (W - pw) / 2, y = (H - ph) / 2
    this.glassPanel(g, x, y, pw, ph, UI.cyanDim)

    const toll = this.layer().toll
    const next = LAYERS[Math.min(this.layerIdx + 1, LAYERS.length - 1)]
    const canDive = this.o2 > toll

    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 补给站`,
      W / 2, y + 34, '24px', TXT.cyber, FONT, 'center')
    this.txt('氧气够就继续下潜，收益翻倍；不够就只能带走现有的',
      W / 2, y + 68, '14px', TXT.dim, FONT, 'center')

    // ---- 决策信息：把赌注的三个数字全部摊开 ----
    const infoY = y + 108
    const cols: [string, string, string][] = [
      ['当前氧气', `${Math.ceil(this.o2)} / ${this.o2Max}`, TXT.cyan],
      ['下潜门票', `-${toll} O₂`, TXT.warn],
      ['收益倍率', `×${this.mult.toFixed(1)} → ×${(this.mult + 0.5).toFixed(1)}`, TXT.amber],
    ]
    const colW = pw / 3
    for (let i = 0; i < 3; i++) {
      const ccx = x + colW * i + colW / 2
      this.txt(cols[i][0], ccx, infoY, '13px', TXT.mute, FONT, 'center')
      this.txt(cols[i][1], ccx, infoY + 24, '22px', cols[i][2], MONO, 'center')
      if (i < 2) {
        g.fillStyle(UI.line, 0.7)
        g.fillRect(x + colW * (i + 1), infoY - 6, 1, 58)
      }
    }

    // ---- 下一层的代价预览（让"更紧"是可见的，不是猜的）----
    const riskY = infoY + 66
    g.fillStyle(UI.panelHi, 0.7); g.fillRoundedRect(x + 40, riskY, pw - 80, 62, 10)
    this.txt(`下潜后：L${this.layerIdx + 2} ${next.name}`, x + 60, riskY + 12, '15px', TXT.cyber, FONT)
    this.txt(`氧气上限 ${next.o2Max}`, x + 60, riskY + 36, '13px', TXT.cyan, MONO)
    this.txt(`耗氧 -${next.drain.toFixed(1)}/s`, x + 210, riskY + 36, '13px', TXT.warn, MONO)
    this.txt(`可见度 ${Math.round(next.vis * 100)}%`, x + pw - 300, riskY + 36, '13px', TXT.dim, MONO)
    const visBarW = 120
    g.fillStyle(UI.line, 0.8); g.fillRect(x + pw - 120, riskY + 36, visBarW, 8)
    g.fillStyle(UI.amber, 0.9); g.fillRect(x + pw - 120, riskY + 36, visBarW * next.vis, 8)

    // ---- 两个按钮：必须同尺寸、同权重（UI规格 §5.6）----
    const bwid = Math.min(260, (pw - 80) / 2 - 12), bh = 64
    const byy = y + ph - 96
    if (this.decideBtns.length === 0) {
      const mk = (label: string, sub: string, ox: number, enabled: boolean, act: () => void) => {
        const bx = W / 2 + ox - bwid / 2
        const idx = this.decideBtns.length
        const rect = enabled
          ? this.addHoverHit(bx + bwid / 2, byy + bh / 2, bwid, bh, act,
              v => { this.hoverBtn = v ? idx : (this.hoverBtn === idx ? -1 : this.hoverBtn) })
          : this.addHit(bx + bwid / 2, byy + bh / 2, bwid, bh, () => { /* 氧气不足，禁用 */ })
        this.decideBtns.push({ x: bx, y: byy, w: bwid, h: bh, label, sub, enabled, act, rect })
      }
      mk('继续下潜', canDive ? `1 · 消耗 ${toll} O₂` : '氧气不足 · 只能上浮',
        -(bwid / 2 + 10), canDive, () => this.diveDeeper())
      mk('上浮兑现', `2 · 带走 ${Math.floor(this.biomass * this.mult)}`,
        (bwid / 2 + 10), true, () => this.surface())
    }

    for (let i = 0; i < this.decideBtns.length; i++) {
      const b = this.decideBtns[i]
      const hov = this.hoverBtn === i && b.enabled
      const bcol = i === 0 ? UI.amber : UI.cyan
      g.fillStyle(b.enabled ? (hov ? UI.panelHi : UI.panel) : UI.panel, b.enabled ? 0.95 : 0.6)
      g.fillRoundedRect(b.x, b.y, b.w, b.h, 10)
      neon(g, b.enabled ? bcol : UI.line, () => { g.strokeRoundedRect(b.x, b.y, b.w, b.h, 10) },
        { width: hov ? 3 : 2, bloom: hov })
      this.txt(b.label, b.x + b.w / 2, b.y + 18, '19px',
        b.enabled ? (i === 0 ? TXT.amber : TXT.cyber) : TXT.mute, FONT, 'center')
      this.txt(b.sub, b.x + b.w / 2, b.y + 42, '13px',
        b.enabled ? TXT.dim : TXT.warn, MONO, 'center')
    }
  }

  // ==========================================================================
  // 结算
  // ==========================================================================
  private showResult(win: boolean): void {
    this.win = win
    this.phase = 'result'
    this.clearHits()
  }

  private drawResult(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    this.drawSeaBackdrop(g, W, H, 0.85)
    const pw = Math.min(500, W - 60), ph = 300
    const x = (W - pw) / 2, y = H / 2 - ph / 2
    this.glassPanel(g, x, y, pw, ph, this.win ? UI.cyan : UI.danger)

    // 死亡 = 溺水 = 全损（V6 §3.1）：一分钱都带不走，这是赌的代价
    const finalBio = this.win ? Math.floor(this.biomass * this.mult) : 0

    this.txt(this.win ? (this.bossDown ? '击杀深渊守望者 · 上浮' : '上浮成功') : '氧气耗尽 · 溺水',
      W / 2, y + 40, '24px', this.win ? TXT.cyber : TXT.warn, FONT, 'center')

    this.txt(`带出生物质 ${finalBio}`, W / 2, y + 88, '26px', TXT.jade, MONO, 'center')
    if (this.win && this.mult > 1) {
      this.txt(`${this.biomass} × ${this.mult.toFixed(1)}（下潜 ${this.layerIdx} 层）`,
        W / 2, y + 122, '13px', TXT.amber, MONO, 'center')
    }
    if (!this.win) {
      this.txt(`沉没的 ${Math.floor(this.biomass * this.mult)} 生物质全部损失`,
        W / 2, y + 122, '13px', TXT.warn, MONO, 'center')
    }
    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 第 ${this.waveInLayer + 1} 波`,
      W / 2, y + 152, '14px', TXT.dim, FONT, 'center')

    if (this.resultBtns.length === 0) {
      const bw = Math.min(200, (pw - 60) / 2), bh = 52
      const mk = (label: string, ox: number, act: () => void) => {
        const bx = W / 2 + ox - bw / 2, by = y + ph - 74
        const rect = this.addHit(bx + bw / 2, by + bh / 2, bw, bh, act)
        this.resultBtns.push({ x: bx, y: by, w: bw, h: bh, label, act, rect })
      }
      mk('再来一次', -(bw / 2 + 8), () => this.restart())
      mk('返回主界面', (bw / 2 + 8), () => this.scene.start('title'))
    }
    for (const b of this.resultBtns) {
      g.fillStyle(UI.panelHi, 0.9); g.fillRoundedRect(b.x, b.y, b.w, b.h, 10)
      neon(g, UI.cyan, () => { g.strokeRoundedRect(b.x, b.y, b.w, b.h, 10) }, { width: 1, alpha: 0.8, bloom: false })
      this.txt(b.label, b.x + b.w / 2, b.y + b.h / 2, '17px', TXT.cyber, FONT, 'center')
    }
  }

  // ==========================================================================
  // 弹窗氛围 / 玻璃面板（V6.8b：深海玻璃拟态）
  // ==========================================================================
  /**
   * 弹窗背景：替代原来纯色压暗蒙版，改成「深海渐变 + 漂浮光点 + 中心柔光晕」，
   * 让波间商店 / 补给站 / 结算有"潜入深海舱"的氛围，而不是一块死黑。
   * baseA 控制底色压暗：商店更透（看得见身后战斗残影），结算更暗（死亡是严肃时刻）。
   */
  private drawSeaBackdrop(g: Phaser.GameObjects.Graphics, W: number, H: number, baseA: number): void {
    g.fillStyle(UI.abyss, baseA); g.fillRect(0, 0, W, H)
    // 顶部渗下的青光（分带模拟渐变；Canvas 无径向渐变，fillGradientStyle 是 WebGL-only）
    for (let i = 0; i < 7; i++) {
      g.fillStyle(UI.cyan, 0.035 * (1 - i / 7)); g.fillRect(0, i * 13, W, 13)
    }
    // 底部渗上的紫光（深渊）
    for (let i = 0; i < 7; i++) {
      g.fillStyle(UI.violet, 0.04 * (1 - i / 7)); g.fillRect(0, H - (i + 1) * 13, W, 13)
    }
    // 中心柔光晕（呼吸）
    const glow = 0.05 + 0.02 * Math.sin(this.t * 1.1)
    for (let r = 7; r >= 1; r--) {
      g.fillStyle(UI.cyan, glow * (r / 7)); g.fillEllipse(W / 2, H / 2, r * 150, r * 100)
    }
    // 漂浮光点：固定种子，缓慢上浮 + 呼吸，营造"水中微粒"感
    for (let i = 0; i < 16; i++) {
      const sx = (i * 103.7 + 11) % W
      const span = (this.t * (10 + (i % 6) * 3)) % H
      const yy = (H - span + (i * 61.3) % H) % H
      const a = 0.09 + 0.07 * (0.5 + 0.5 * Math.sin(this.t * 1.4 + i * 1.7))
      g.fillStyle(i % 4 === 0 ? UI.jade : UI.cyan, a)
      g.fillCircle(sx, yy, 1.2 + (i % 3) * 0.5)
    }
  }

  /**
   * 玻璃拟态面板：半透明深色主体 + 顶部高光 + 内描边 + 霓虹外描边 + 四角铆钉。
   * 三个弹窗的中央容器统一走这里，视觉语言一致。
   */
  private glassPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
                     edge: number, bloom = false): void {
    g.fillStyle(UI.panel, 0.95); g.fillRoundedRect(x, y, w, h, 14)
    g.fillStyle(0xffffff, 0.05); g.fillRoundedRect(x + 3, y + 3, w - 6, 11, 6)   // 顶部高光
    g.lineStyle(1, UI.cyanDim, 0.22); g.strokeRoundedRect(x + 2.5, y + 2.5, w - 5, h - 5, 12)  // 内描边
    neon(g, edge, () => { g.strokeRoundedRect(x, y, w, h, 14) }, { width: 2, bloom })
    // 审计：登记面板（填充色用于对比度计算，描边色用于可视化）
    const pf = '#' + (UI.panel as number).toString(16).padStart(6, '0')
    this.ui.push({ kind: 'panel', x, y, w, h, fill: pf, edge: '#' + edge.toString(16).padStart(6, '0') })
    // 四角铆钉
    for (const [dx, dy] of [[x + 11, y + 11], [x + w - 11, y + 11], [x + 11, y + h - 11], [x + w - 11, y + h - 11]]) {
      g.fillStyle(edge, 0.7); g.fillCircle(dx, dy, 2.4)
    }
  }

  private restart(): void {
    this.enemies = []; this.bones = []; this.pulses = []; this.debris = []
    this.sparks = []; this.shocks = []; this.slashes = []; this.floats = []
    this.biomass = 0
    this.bank = 0            // 鱼骨货币也要清零，否则重开一局带着上局的存款
    this.st = NEW_STATS()
    this.relics = []         // 遗物同理：带着上局的遗物重开会让难度曲线失真
    this.noHitT = 0; this.plateT = 0
    this.burstTimer = 0
    this.px = this.scale.width / 2; this.py = this.scale.height / 2
    this.clearHits()
    this.startRun()
  }

  private layout(): void {
    this.clearHits()   // resize 后热区坐标失效，重绘时重建
    this.buildMotes()
    this.buildDrift()
    this.layoutBg()
  }

  /** 背景 cover 铺满：等比缩放直到覆盖画布，再居中裁掉溢出部分 */
  private layoutBg(): void {
    if (!this.bg || !this.bg.texture) return
    const src = this.bg.texture.source[0]
    if (!src || !src.width) return
    const W = this.scale.width, H = this.scale.height
    const s = Math.max(W / src.width, H / src.height)
    this.bg.setScale(s)
    this.bg.setPosition((W - src.width * s) / 2, (H - src.height * s) / 2)
  }

  /** 换层时同步背景贴图 + 当前深度读数 */
  private syncEnv(): void {
    if (this.bg) this.bg.setTexture(`env${this.layerIdx}`)
    this.layoutBg()
    const L = this.layer()
    this.depthM = L.depthTop + (L.depthBot - L.depthTop) * (this.waveInLayer / this.waves().length)
  }

  // ==========================================================================
  // 自动化测试探针（无头验证脚本读这些值，不要删）
  // ==========================================================================
  private exposeProbe(): void {
    // 注意：window.__sg 已被 main.ts 占用（挂的是 Phaser.Game 实例）。
    // 这里必须用另一个名字，否则会把 game 实例覆盖掉，
    // 验证脚本里 __sg.scene.getScenes(true) 会直接报错。
    const w = window as unknown as { __dive?: unknown }
    w.__dive = {
      probe: () => ({
        phase: this.phase,
        layer: this.layerIdx + 1,
        layerName: this.layer().name,
        wave: this.waveInLayer + 1,
        o2: Math.round(this.o2),
        o2Max: this.o2Max,
        mult: this.mult,
        enemies: this.enemies.length,
        bones: this.bones.length,
        biomass: this.biomass,
        boss: this.bossDown,
        bossAlive: this.enemies.some(e => e.kind === 'boss'),
        canDive: this.phase === 'decide' ? this.o2 > this.layer().toll : null,
        depthM: Math.round(this.depthM),
        // 测试用：直接把波次推到只剩 0.5s，用来抓下潜过渡的中间帧
        fastForward: () => { this.waveTimer = 0.5 },
      }),
      // 无头环境下 JustDown 检测不到同帧的 keyDown+keyUp，
      // 所以直接暴露热区回调给验证脚本调用
      hits: () => (this as unknown as { __uiHitRoutes: { onClick: () => void }[] }).__uiHitRoutes ?? [],
      dive: () => this.diveDeeper(),
      surface: () => this.surface(),
      // 测试专用：立刻清场并推进（否则无头验证要真等 40-55 秒一波）
      skip: () => { this.enemies = []; this.spawnLeft = 0; this.advance() },
      // V6.7：商店改成鱼骨经济后，pick 是"买第 i 张"（不再是一选就走）
      pick: (i: number) => this.buyCard(i),
      buy: (i: number) => this.buyCard(i),
      reroll: () => this.reroll(),
      lock: (i: number) => this.toggleLock(i),
      leaveShop: () => this.leaveShop(),
      // UI 合理性审计：导出当前帧的 UI 节点 + 主题底色（供 ui_audit 工具计算
      // 越界 / 重叠 / 对比度 / 密度）。任何场景只要实现同样的 __dive.uiProbe
      // 契约，就能被这套通用工具审计。
      // 注意：热区/卡片只在首次绘制时建一次（数组持久），但 this.ui 每帧重置，
      // 所以面板与热区必须从**持久数组**每帧补登记，否则弹窗帧读不到。
      uiProbe: () => {
        const pf = '#' + (UI.panel as number).toString(16).padStart(6, '0')
        const nodes: UINode[] = this.ui.slice()
        for (const c of this.shopCards) nodes.push({ kind: 'panel', x: c.x, y: c.y, w: c.w, h: c.h, fill: pf })
        for (const b of this.shopBtns) nodes.push({ kind: 'hit', x: b.x, y: b.y, w: b.w, h: b.h })
        // 注：reroll/leave 按钮已包含在 shopBtns 中，rerollBtnRect/leaveBtnRect
        // 只是它的副本，勿重复登记（否则自我重叠 ratio=1.0 误报）。
        for (const b of this.decideBtns) nodes.push({ kind: 'hit', x: b.x, y: b.y, w: b.w, h: b.h })
        for (const b of this.resultBtns) nodes.push({ kind: 'hit', x: b.x, y: b.y, w: b.w, h: b.h })
        return {
          phase: this.phase,
          W: this.scale.width,
          H: this.scale.height,
          nodes,
          theme: { abyss: '#04070d', panel: '#08111c', panelHi: '#0e1a29' },
        }
      },
      bank: () => this.bank,
      setBank: (v: number) => { this.bank = v },
      // V6.8：属性与遗物
      stats: () => ({ ...this.st }),
      addStat: (k: keyof Stats, v: number) => this.addStat(k, v),
      relics: () => this.relics.slice(),
      equipRelic: (id: RelicId) => this.equipRelic(id),
      dmgMul: () => this.dmgMulNow(),
      boneMul: () => this.boneValueMul(),
      noHit: () => this.noHitT,
      setNoHit: (v: number) => { this.noHitT = v },
      hurtPlayer: (amount: number) => this.damagePlayer(amount, 0, 1),
      refill: () => { this.o2 = this.o2Max },
      hit: (i: number) => {
        const rs = (this as unknown as { __uiHitRoutes: { onClick: () => void }[] }).__uiHitRoutes ?? []
        if (rs[i]) rs[i].onClick()
      },
    }
  }
}
