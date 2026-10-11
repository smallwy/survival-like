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
import { UI, TXT, FONT, MONO } from '../config/theme'
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
 * 4 个侧装挂载点在机体局部坐标里的位置（比例，原点在贴图中心）。
 *
 * 数值往中心收过一次：原来是 ±0.30 / ±0.26，玩家反馈「发射塔和武器大小有点
 * 格格不入，感觉隔离太开」——挂载点离机体中心太远，塔头像是浮在机体外面
 * 的独立小零件，不像"装在艇上的炮"。收到 ±0.21 / ±0.17 后塔头压在机体轮廓上，
 * 视觉上才是一体的。
 */
const HARDPOINTS: Array<[number, number]> = [
  [-0.26, 0.46],   // 后 · 一舷
  [-0.26, -0.46],  // 后 · 另一舷
  [0.26, 0.46],    // 前 · 一舷
  [0.26, -0.46],   // 前 · 另一舷
]

/**
 * 发射塔尺寸（px）—— **长边沿艇身长度、短边沿艇身宽度**。
 *
 * V6.6 之前塔是 30×30 的正方形，而艇身只有 59×31：塔的直径几乎等于艇身宽度，
 * 4 个塔挤在 24.8×10.5 的矩形里必然叠成一团 —— 这就是"叠在一起很难看"的根因。
 *
 * 两件事一起改才能自洽：
 *   ① 艇身放大到 98.8×52（SUB_SIZE 31 → 52），给塔腾出安装空间
 *   ② 塔改成**长条挂架**而不是正方形：长 38 沿艇身长度、宽 26 沿艇身宽度
 *
 * 间距要按**最坏情况**算：塔会随索敌相对艇身旋转最多 ±60°，旋转后矩形在
 * 宽度方向的半投影变成 19·sin60 + 13·cos60 ≈ 22.95，也就是异舷两塔需要
 * 45.9px 才不碰。所以 ly 取 ±0.46（间距 0.92×52 = 47.8px）而不是 ±0.38
 * —— 后者只有 39.5px，塔一转就叠上了。塔中心 ±23.9 仍在艇身半宽 26 之内，
 * 不会变成"浮在艇外的独立零件"。
 *
 * 同舷前后间距 0.52×99 = 51.5px，最坏半投影 19·cos60 + 13·sin60 ≈ 20.8，
 * 需要 41.5px，富余充足。
 */
const TURRET_L = 38      // 沿艇身长度
const TURRET_W = 26      // 沿艇身宽度
/** 发射器（插在挂架上的那件武器）基准尺寸，约为挂架的 0.63 */
const EMITTER_SIZE = 24

/**
 * 潜艇显示尺寸（px）。
 *
 * V6.6 从 59×31 放大到 99×52。挂载点计算（`hx * SUB_LEN, hy * SUB_WID`）
 * 直接用这两个数，所以必须是顶层常量而不是 create() 里的局部变量。
 */
const SUB_LEN = 99
const SUB_WID = 52

/** 挂载位硬上限（4 座 × 双联 = 8 个管位，当前武器上限是 6 台） */
const MAX_MOUNTS = 8

/**
 * 商店刷新定价。
 *
 * 刷新是"用钱换选择权"，必须递增，否则钱多的时候可以无限刷到想要的卡，
 * Build 多样性就没了。8 起、每次 +6：一波攒的 40 币大概够刷两三次，
 * 再多就要牺牲一张卡的钱 —— 这个取舍才是刷新该有的代价。
 */
const REROLL_BASE = 8
const REROLL_STEP = 6

/**
 * 4 个物理座 × 每座 2 个管位 = 最多 8 个管位，但**武器上限是 6 台**（用户定的规格）。
 *
 * 分配规则（`mountPlan()`）：
 *   第 1~4 台 → 座 0~3 的**前管位**（单装形态）
 *   第 5~6 台 → 座 0~1 的**后管位**（这两座变成双联形态）
 *
 * 为什么是"座 0、1 变双联"而不是随机：双联必须发生在**机体中前段**，
 * 放在靠后的座会让艇尾拖两个大塔，剪影变成"螃蟹"。
 *
 * 管位的横向偏移（座局部坐标，沿艇身宽度方向）：前管 -0.07 / 后管 +0.07。
 * 偏移量刻意小于塔头半径的一半 —— 双联要看起来是"并联的两根管"，
 * 分开太多就变回两个独立的小零件，这正是上一轮被吐槽的问题。
 */
const TWIN_OFFSET = [-0.10, 0.10]

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
  boneSinkV: 26,      // 下沉终端速度（px/s）
  boneFloor: 54,      // 沉底深度（距屏幕下缘），到这里停止下沉
  boneFade: 1.6,      // 沉底后原地淡出时长（秒）
  boneBlink: 0.9,     // 淡出末段的闪烁频率提示
  boneBase: 4,        // 鱼骨回氧基数，实际按鱼体大小放大（大鱼骨更值钱）
  pickupR: 26,        // 拾取半径（硬约束①：必须游过去，不做远程磁吸）
  burstCost: 20,      // 排气爆发消耗
  burstCd: 12,        // 排气爆发冷却
  burstR: 250,        // 排气爆发半径
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
  /** 双联座射速加成 */
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
 * ⚠️ dropCap 相对立项书 §3.4「60→30」做了上调，原因写在这里，别再改回去：
 *
 * 立项书那组数是按"越深越难"拍的，但把它和耗氧一起算一遍会发现 L5 必死：
 *   耗氧 3.0/s × 55s ≈ 165 氧/波，而每波掉落上限只有 30 → 净 -135。
 *   氧气上限 60，一波都撑不完，跟操作无关，纯数值死刑。
 *
 * 深层压力应该来自**上限被压缩 + 耗氧变快**（这是 V6 的设计意图，必须保留），
 * 而不是"补给根本不够"。所以让掉落绝对值跟着涨，只让**净收益递减**：
 *
 *   L1 净 +24 → L2 +25 → L3 +20 → L4 +10 → L5 -5
 *
 * 这样 L5 依然是全场最紧的（必须近乎不漏地捡泡），但打得好能活。
 */
interface LayerDef {
  name: string
  sub: string
  o2Max: number     // 氧气上限（越深越窄）
  drain: number     // 每秒耗氧
  dropCap: number   // 每波掉落总量上限（硬约束 ②）
  toll: number      // 下潜门票（从氧气里扣；最后一层为 0）
  vis: number       // 环境可见度 0~1（V4 §2.2）
  depthTop: number  // 层顶深度（米）—— HUD 实时深度显示 + 下潜过渡插值用
  depthBot: number  // 层底深度（米）
  ventPush: number  // 热泉层向上的热流推力（px/s²），0 = 无。生存压迫层用
  tint: number      // 环境主色（与 UI 色解耦，UI规格 §5.1）
  motes: number     // 漂浮颗粒数量
  hpMul: number     // 敌人血量倍率
  cntMul: number    // 敌人数量倍率
  dashMul: number   // 冲刺型占比倍率
  driftRatio: number// 水母型占比
}

const LAYERS: LayerDef[] = [
  { name: '阳光带',   sub: 'SUNLIT',       o2Max: 100, drain: 1.00, dropCap: 70,  toll: 15, vis: 1.00, depthTop: 0,     depthBot: 200,   ventPush: 0,   tint: 0x2a6f8a, motes: 34,  hpMul: 1.00, cntMul: 1.00, dashMul: 0.5, driftRatio: 0.00 },
  { name: '弱光带',   sub: 'TWILIGHT',     o2Max: 100, drain: 1.35, dropCap: 90,  toll: 20, vis: 0.80, depthTop: 200,   depthBot: 1000,  ventPush: 0,   tint: 0x1d5a5a, motes: 48,  hpMul: 1.35, cntMul: 1.25, dashMul: 1.0, driftRatio: 0.12 },
  { name: '午夜带',   sub: 'MIDNIGHT',     o2Max: 85,  drain: 1.80, dropCap: 110, toll: 25, vis: 0.40, depthTop: 1000,  depthBot: 4000,  ventPush: 0,   tint: 0x14203c, motes: 70,  hpMul: 1.80, cntMul: 1.50, dashMul: 1.1, driftRatio: 0.18 },
  { name: '热泉带',   sub: 'HYDROTHERMAL', o2Max: 70,  drain: 2.40, dropCap: 135, toll: 30, vis: 0.25, depthTop: 4000,  depthBot: 6000,  ventPush: 190, tint: 0x3a1a10, motes: 90,  hpMul: 2.40, cntMul: 1.80, dashMul: 1.2, driftRatio: 0.15 },
  { name: '深渊带',   sub: 'THE ABYSS',    o2Max: 60,  drain: 3.00, dropCap: 160, toll: 0,  vis: 0.10, depthTop: 6000,  depthBot: 11000, ventPush: 0,   tint: 0x0a0614, motes: 110, hpMul: 3.20, cntMul: 2.10, dashMul: 1.3, driftRatio: 0.22 },
]

/** 每层 4 波的形状模板（V6 §3.1） */
const WAVE_SHAPE = [
  { count: 12, dashRatio: 0.00, hpMul: 1.00, dur: 40 },
  { count: 18, dashRatio: 0.25, hpMul: 1.15, dur: 45 },
  { count: 26, dashRatio: 0.35, hpMul: 1.30, dur: 50 },
  { count: 36, dashRatio: 0.45, hpMul: 1.50, dur: 55 },
]

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
  value: number         // 回氧量
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
type WeaponId = 'sonar' | 'gun' | 'torpedo' | 'arc'

interface Weapon {
  id: WeaponId
  iv: number     // 射击间隔（秒）
  timer: number  // 距下次开火的剩余秒数
  dmg: number
  lvl: number    // 等级：每级提升伤害与频率（1..5）
  anchor: number // 只锚定一个敌人时的索敌锚点下标（鱼雷用）
}

/** 通用弹：机关枪（直线）与鱼雷（追踪）共用 */
interface Bullet {
  x: number; y: number
  vx: number; vy: number
  life: number; dmg: number
  kind: 'gun' | 'torpedo'
  hit: Set<number>
  alive: boolean
}

/** 电弧折线：瞬发 + 存留 0.18s 的视觉残留 */
interface Arc {
  pts: { x: number; y: number }[]
  life: number
}

/** 鱼雷爆炸的冲击环（纯表现） */
interface Blast { x: number; y: number; r: number; life: number }

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

  // ---- 实体池 ----
  private enemies: Enemy[] = []
  private bones: Bone[] = []
  private pulses: Pulse[] = []
  private bullets: Bullet[] = []
  private arcs: Arc[] = []
  private blasts: Blast[] = []
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
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private shopCards: { x: number; y: number; w: number; h: number; up: Upgrade; rect: Phaser.GameObjects.Rectangle }[] = []
  private decideBtns: { x: number; y: number; w: number; h: number; label: string; sub: string; enabled: boolean; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private resultBtns: { x: number; y: number; w: number; h: number; label: string; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private txtPool: Phaser.GameObjects.Text[] = []
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
    ] as Array<[string, unknown]>) {
      this.load.image(key, tex as string)
    }
    this.load.once('complete', () => {
      for (const key of ['f_swarm', 'f_drift', 'f_dash',
        'sub_body', 'w_gun', 'w_torpedo', 'w_arc']) {
        if (this.textures.exists(key)) {
          this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR)
        }
      }
    })
  }

  create(): void {
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
    this.subImg = this.add.image(0, 0, 'sub_body').setDepth(60)
    this.subImg.setDisplaySize(SUB_LEN, SUB_WID)
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

    this.scale.on('resize', () => this.layout())
    this.startRun()
    this.exposeProbe()
  }

  private layer(): LayerDef { return LAYERS[this.layerIdx] }

  // ==========================================================================
  // 进度
  // ==========================================================================
  private startRun(): void {
    this.layerIdx = 0
    this.waveInLayer = 0
    this.mult = 1.0
    this.bossDown = false
    this.o2Max = LAYERS[0].o2Max
    this.o2 = this.o2Max
    this.o2Shown = this.o2Max     // 补间值不复位的话，新局开头数字会从上一局的残值滚上来
    // 挂载位必须复位：不复位的话重开一局直接带 6 座 + 满射速加成，
    // 「靠商店卡解锁挂载」这条成长线会在第二局凭空消失。
    this.maxWeapons = 4
    this.hurtDirT = 0
    this.weapons = []
    this.bullets = []; this.arcs = []; this.blasts = []
    this.addWeapon('sonar')          // 开局只有声呐，其余靠波次间拾取
    this.startWave()
  }

  private startWave(): void {
    const L = this.layer()
    const s = WAVE_SHAPE[this.waveInLayer]
    this.spawnLeft = Math.round(s.count * L.cntMul)
    this.spawnTimer = 0
    this.waveTimer = s.dur
    this.droppedThisWave = 0
    this.phase = 'wave'
    this.clearHits()
    this.buildMotes()
    this.buildDrift()    // 远景生物层：每层生态不同，换层必须重建
    this.syncEnv()      // 换层换背景 + 深度读数
    // 波次开场提示：屏幕中央上方飘一行，玩家知道"新一波开始了"。
    // 放在这里而不是 HUD 上，是因为 HUD 上的波次点太小，
    // 战斗正酣时没人会去看角落里的进度点。
    this.spawnFloat(this.scale.width / 2, this.scale.height * 0.26,
      `第 ${this.waveInLayer + 1} 波`, UI.cyanHi, 26)

    // L5 最后一波：深渊守望者
    if (this.layerIdx === LAYERS.length - 1 && this.waveInLayer === WAVE_SHAPE.length - 1) {
      this.spawnBoss()
    }
  }

  /**
   * 一波打完后的推进。
   *   层内波（1~3 结束）→ 商店三选一 → 下一波
   *   层末波（第 4 波结束）→ 补给站决策（下潜 / 上浮）；最后一层则通关
   */
  private advance(): void {
    if (this.waveInLayer < WAVE_SHAPE.length - 1) {
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
  private spawnEnemy(): void {
    const W = this.scale.width
    const H = this.scale.height
    // 屏幕外生成，游入屏幕（V4 §3.1 规则 ⑤：不在玩家视野内凭空出现）
    const m = 60
    let x = 0, y = 0
    const side = Phaser.Math.Between(0, 3)
    if (side === 0) { x = Phaser.Math.Between(0, W); y = -m }
    else if (side === 1) { x = W + m; y = Phaser.Math.Between(0, H) }
    else if (side === 2) { x = Phaser.Math.Between(0, W); y = H + m }
    else { x = -m; y = Phaser.Math.Between(0, H) }

    const L = this.layer()
    const s = WAVE_SHAPE[this.waveInLayer]
    const hpScale = L.hpMul * s.hpMul

    // 三种体型按层配比随机（回答"不同深度的生物应该不一样"）
    const r = Math.random()
    const dashP = s.dashRatio * L.dashMul
    let kind: Kind
    if (r < L.driftRatio) kind = 'drift'
    else if (r < L.driftRatio + dashP) kind = 'dash'
    else kind = 'swarm'

    const base = kind === 'drift' ? 55 : kind === 'dash' ? 26 : 14
    const hp = Math.round(base * hpScale)
    // 深潜印记的代价：敌人整体 +10% 移速。你变强了，但它们也更快追上你
    const relicSpd = this.hasRelic('abyss_mark') ? 1.1 : 1
    const spd = (kind === 'drift' ? 42 : kind === 'dash' ? 96 : 68) * relicSpd

    this.enemies.push({
      x, y, vx: 0, vy: 0,
      hp, maxHp: hp,
      // V6.6 放大体型：机体从 59px 放大到 99px 后，22~40px 的敌人显得格外小，
      // 既看不清种类也看不清有没有被打中。半径整体放大约 30%
      // （显示尺寸 = r×2.4，所以 swarm 22px → 34px、drift 40px → 60px）。
      r: kind === 'drift' ? 25 : kind === 'dash' ? 19 : 14,
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

  private spawnBoss(): void {
    const W = this.scale.width
    const hp = Math.round(1100 * this.layer().hpMul)
    this.enemies.push({
      x: W / 2, y: -90, vx: 0, vy: 0,
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
      this.spawnEnemy()
      this.spawnLeft--
      this.spawnTimer = 0.28
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
      this.updateEnemies(dt)
      this.updatePulses(dt)
      this.updateBullets(dt)
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
      // 商店 / 决策 / 结算：战斗暂停，只保留环境动画
      this.updateBones(dt)
      this.updateDebris(dt)
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
    this.drawEnv()
    this.draw()
    // 弹窗相位（shop/decide/result）**不画战斗 HUD** —— 否则氧气条、波次点、
    // 武器条、排气提示全叠在弹窗上，这正是之前"弹窗界面很乱"的主因。
    // 弹窗各自画需要的上下文（鱼骨余额 / 下潜赌注 / 层数），不再复用战斗 HUD。
    if (this.phase === 'wave' || this.phase === 'descending') this.drawHud()
    else { this.gHud.clear(); this.hideTexts() }   // 弹窗相位：HUD 图形在独立 Graphics 上、
                             // 数字文字在 txtPool 对象池上，两者都只在 drawHud 内清/隐藏；
                             // 不调它（被门控）就残留最后一帧战斗 HUD，叠在弹窗上
    // 弹窗分派（原在 drawHud 末尾，drawHud 相位门控后必须独立出来）
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
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.flash > 0) e.flash -= dt
      const d = Phaser.Math.Distance.Between(e.x, e.y, dx0, dy0) || 1
      const nx = (dx0 - e.x) / d, ny = (dy0 - e.y) / d

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

      // 接触伤害：氧气就是血条（V6 §3.2）。贴着不放 = 24 氧/秒。
      if (d < e.r + PLAYER.r) {
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
        }
      }
    }
    this.pulses = this.pulses.filter(p => p.alive)
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
        if (best) { best.hp -= d * 0.4; best.flash = 0.1 }
      }
    }
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.biomass += e.kind === 'boss' ? 20 : 1
      if (e.kind === 'boss') this.bossDown = true
      this.spawnDebris(e)          // 软组织被共振震散
      this.dropBone(e)             // 只剩发光骨架
      // 击杀回氧飘字。注意：鱼骨是**另外一笔**收益（捡到才给），
      // 这里是击杀瞬间给的，两笔来源不同，飘字位置也错开（击杀在鱼身上、
      // 拾取在鱼骨上），玩家能分清"打死的"和"捡到的"
      const kO2 = this.st.killO2 * (this.hasRelic('osteoblast') ? 2 : 1)
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
   * 掉鱼骨。
   * 硬约束 ②：每波掉落总量有上限（按层配置）——否则"击杀补氧"会退化成
   * 打得多就无限续命，氧气条失去意义。Boss 骨架不受上限限制（它是里程碑）。
   */
  private dropBone(e: Enemy): void {
    const isBoss = e.kind === 'boss'
    // 大鱼留大骨架、回氧更多：让"挑大鱼打"成为真实选择，而不只是打最近的
    const size = isBoss ? 44 : Phaser.Math.Clamp(e.r * 1.7, 14, 30)
    const value = isBoss ? 24 : Math.max(3, Math.round(O2.boneBase * (size / 18)))
    if (!isBoss && this.droppedThisWave >= this.layer().dropCap) return
    this.droppedThisWave += value
    const a = Math.random() * Math.PI * 2
    const sp = 30 + Math.random() * 45
    this.bones.push({
      x: e.x, y: e.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
      fade: O2.boneFade, value, size,
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
      // 下沉：比气泡"上浮"更有重量感
      b.vy += 34 * dt
      if (b.vy > O2.boneSinkV) b.vy = O2.boneSinkV
      b.vx *= 0.94                    // 水阻
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.rot += b.spin * dt
      b.spin *= 0.985
      // 到达沉底深度：停止下沉，转为原地淡出
      if (b.y >= H - O2.boneFloor) {
        b.y = H - O2.boneFloor
        b.vy = 0; b.vx = 0
        b.fade -= dt
        if (b.fade <= 0) { b.alive = false; continue }
      }
      if (Phaser.Math.Distance.Between(b.x, b.y, this.px, this.py) < pr) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + b.value)
        const gained = this.o2 - before
        b.alive = false
        // 鱼骨**同时是货币**：捡到既有氧也有钱。
        // 这两件事必须一起给 —— 只给钱的话氧气系统（血条+计时器）会失去
        // 唯一的正向补充来源，只给氧的话"捡鱼骨"又和商店无关，循环还是断的。
        //
        // 钱按**加成后的**价值算（打捞运 / 潮汐罗盘 / 贪食腺体），
        // 回氧仍按基础值 —— 否则运气属性会顺带变成生存属性，
        // 一张"打捞运"卡同时解决经济和血线，就没有取舍了。
        const coin = Math.round(b.value * this.boneValueMul())
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

  /** 索敌：射程内最近的敌人 */
  private nearestEnemy(range: number): Enemy | null {
    let best: Enemy | null = null, bd = range
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = Phaser.Math.Distance.Between(this.px, this.py, e.x, e.y)
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
    this.weapons.push({ id, iv: st.iv, timer: 0, dmg: st.dmg, lvl, anchor: 0 })
  }

  /**
   * 槽位 → 挂载点分配表。
   *
   * 返回每项 `{ seat, barrel }`：seat 是 4 个物理座之一，barrel 是 0(前)/1(后)。
   * 前 4 台各占一座的前管；第 5、6 台落到座 0、1 的后管 → 那两座变成双联。
   */
  private mountPlan(): Array<{ seat: number; barrel: number }> {
    const plan: Array<{ seat: number; barrel: number }> = []
    for (let i = 0; i < this.weapons.length; i++) {
      if (i < HARDPOINTS.length) plan.push({ seat: i, barrel: 0 })
      else plan.push({ seat: i - HARDPOINTS.length, barrel: 1 })
    }
    return plan
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
      if (w.timer > 0) continue
      const def = WEAPON_DEF[w.id]
      // 射程 = (基础 + 等级) × 声场延伸。放在索敌处算而不是写进武器数值，
      // 这样属性卡买到手立刻生效，不用回头重算每台武器的缓存值。
      const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
      // 双联座的射速加成只作用于后管位（见 Stats.twinRate 注释）
      const twinBoost = (plan[wi]?.barrel === 1) ? (1 + this.st.twinRate) : 1

      if (w.id === 'sonar') {
        // 声呐是全向的：射程内有鱼就发一圈波，不需要瞄准。
        // 但波从自己身上往外扩，所以「贴得越近越早被打到」——
        // 这把「扎进鱼群多捞几只」和「别被围住」绑成了同一个决策。
        if (!this.nearestEnemy(rng)) continue
        this.pulses.push({
          x: this.px, y: this.py,
          r: PLAYER.r * 0.6, maxR: rng,
          dmg: w.dmg, width: PLAYER.pulseWidth,
          hit: new Set<number>(), alive: true,
        })
      } else if (w.id === 'gun') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const a = Math.atan2(e.y - this.py, e.x - this.px)
        this.bullets.push({
          x: this.px, y: this.py,
          vx: Math.cos(a) * 780, vy: Math.sin(a) * 780,
          life: rng / 780, dmg: w.dmg, kind: 'gun',
          hit: new Set<number>(), alive: true,
        })
        // 枪口闪光：从炮塔位置喷，而不是从机体中心喷 ——
        // 喷在中心会看不出是"哪台武器开的火"
        this.spawnMuzzleFlash(this.px + Math.cos(a) * 14, this.py + Math.sin(a) * 14,
          a, WEAPON_DEF.gun.color)
      } else if (w.id === 'torpedo') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const a = Math.atan2(e.y - this.py, e.x - this.px)
        this.bullets.push({
          x: this.px, y: this.py,
          vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
          life: 3.0, dmg: w.dmg, kind: 'torpedo',
          hit: new Set<number>(), alive: true,
        })
        this.spawnMuzzleFlash(this.px + Math.cos(a) * 14, this.py + Math.sin(a) * 14,
          a, WEAPON_DEF.torpedo.color)
      } else {
        const first = this.nearestEnemy(rng); if (!first) continue
        this.fireArc(first, w)
      }
      // 射速：高压供能（st.rate）在这里生效。改的是**下一次冷却的长度**
      // 而不是已有 timer，所以属性变化立刻反映在下一发上。
      w.timer = def.iv / ((1 + (w.lvl - 1) * 0.12) * twinBoost * (1 + this.st.rate))
    }
  }

  /** 链式电弧：从 first 开始向后跳，跳数随等级增加 */
  private fireArc(first: Enemy, w: Weapon): void {
    const chain = 2 + w.lvl                       // Lv1 跳 3 个 → Lv5 跳 7 个
    const pts = [{ x: this.px, y: this.py }]
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
          if (b.kind === 'torpedo') { this.explode(b.x, b.y, 120, b.dmg * 0.6); b.alive = false; break }
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
    for (const f of this.floats) {
      if (f.delay > 0) continue
      const k = Phaser.Math.Clamp(f.life / f.maxLife, 0, 1)      // 1 → 0
      // 出生弹跳：0.15s 内从 1.35× 回落到 1×
      const pop = k > 0.85 ? 1 + (k - 0.85) / 0.15 * 0.35 : 1
      // 末段淡出 + 略微上飘加速（"飘走"而不是"原地消失"）
      const a = k > 0.4 ? 1 : k / 0.4
      const size = Math.round(f.size * pop)
      // 描边：飘字压在花花绿绿的背景/鱼群上，没有深色描边会看不清
      const w = f.text.length * size * 0.58
      g.fillStyle(UI.abyss, 0.55 * a)
      g.fillRoundedRect(f.x - w / 2 - 4, f.y - size * 0.72, w + 8, size * 1.32, 4)
      this.txt(f.text, f.x, f.y, `${size}px`, this.hexOf(f.color), MONO, 'center', 'float')
        .setAlpha(a)
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
    this.txt(L.sub, cx - L.sub.length * 5.5, ny + 26, '11px', TXT.mute, MONO)
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
        sprite.setTint(charging ? 0xff6060 : 0xffffff)
        if (!charging) sprite.clearTint()
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
    }

    // 弹幕（曳光弹 / 鱼雷 / 电弧 / 爆炸环）画在敌人之上：玩家的攻击必须看得见
    this.drawProjectiles(g)
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
   * 器械图形签名。四个图标必须在 11px 这种极小尺寸下还能区分，
   * 所以用**形状差异**而不是颜色差异：环 / 三道平行线 / 鱼形 / 折线闪电。
   * 玩家不该靠读文字才知道自己装了什么。
   */
  private drawWeaponIcon(g: Phaser.GameObjects.Graphics, id: WeaponId,
                         cx: number, cy: number, s: number): void {
    const col = WEAPON_DEF[id].color
    if (id === 'sonar') {
      neonCircle(g, cx, cy, s * 0.9, col, { width: 1.6, alpha: 0.95, bloom: false })
      neonCircle(g, cx, cy, s * 0.42, col, { width: 1.4, alpha: 0.6, bloom: false })
    } else if (id === 'gun') {
      for (let i = -1; i <= 1; i++) {
        neonLine(g, cx - s, cy + i * s * 0.42, cx + s, cy + i * s * 0.42, col,
          { width: 1.6, alpha: i === 0 ? 1 : 0.6, bloom: false })
      }
    } else if (id === 'torpedo') {
      // 鱼形：椭圆身 + 三角尾
      neon(g, col, () => { g.strokeEllipse(cx + s * 0.15, cy, s * 1.35, s * 0.72) },
        { width: 1.6, bloom: false })
      g.beginPath()
      g.moveTo(cx - s * 0.5, cy)
      g.lineTo(cx - s * 1.05, cy - s * 0.55)
      g.lineTo(cx - s * 1.05, cy + s * 0.55)
      g.closePath(); g.strokePath()
    } else {
      // 折线闪电
      neon(g, col, () => {
        g.beginPath()
        g.moveTo(cx + s * 0.35, cy - s)
        g.lineTo(cx - s * 0.35, cy + s * 0.12)
        g.lineTo(cx + s * 0.1, cy + s * 0.12)
        g.lineTo(cx - s * 0.3, cy + s)
        g.strokePath()
      }, { width: 1.8, bloom: false })
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
    if (this.enemies.length > 80) return null
    // 显示尺寸阈值：低于 26px 贴图细节会糊成一团，走矢量
    if (e.r * 2.4 < 26 && e.kind !== 'boss') return null
    const key = e.tex
    let img = this.fishPool.find(im => im.getData('key') === key && !im.visible)
    if (!img) {
      if (!this.textures.exists(key)) return null
      img = this.add.image(0, 0, key).setDepth(40)
      this.fishPool.push(img)
    }
    // 显示尺寸：碰撞半径 ×2.4。系数从 2.9 降到 2.4 是因为深色层的定位描边环
    // 半径是 2.05r，贴图再放大就会明显溢出描边圈，看起来像"贴图比碰撞体大"。
    const s = e.r * 2.4
    img.setDisplaySize(s, e.kind === 'drift' ? s * 0.8 : s)
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
      const a = 0.42 * blink * f          // f: 沉底后线性渐隐 —— 骨头是「待拾取物」不是主角，
                                          // 亮度必须低于敌人与子弹，否则满场白骨抢走全部注意力

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
    const X = (lx: number, ly: number) => this.px + lx * ca - ly * sa
    const Y = (lx: number, ly: number) => this.py + lx * sa + ly * ca
    const pcol = this.hurtFlash > 0 ? WHITE : UI.cyan

    // ---- ① 边缘光：深色贴图在深背景上可读的唯一保障 ----
    // 比机体贴图略大一圈的椭圆描边，颜色用玩家专属的青蓝（永远是全场最亮的青）。
    // 边缘光椭圆跟着机体一起放大：原来 34×19 是配 59×31 的艇身，
    // 艇身放大到 99×52 后 rim 必须同比放大，否则光晕缩在机体中间像颗蛋。
    const rimW = 57, rimH = 32
    neon(g, pcol, () => { g.strokeEllipse(this.px, this.py, rimW, rimH) },
      { width: 2.4, alpha: 0.85, bloom: true })
    neon(g, UI.cyanHi, () => { g.strokeEllipse(this.px, this.py, rimW - 5, rimH - 5) },
      { width: 1, alpha: 0.35, bloom: false })

    // ---- ② 机体贴图 ----
    this.subImg.setPosition(this.px, this.py)
    this.subImg.setRotation(this.aim)
    // 受击闪白：贴图整体提亮（Phaser 的 tint 用加色，配合高 alpha 更接近"过曝"）
    this.subImg.setTint(this.hurtFlash > 0 ? 0xffffff : 0xffffff)
    this.subImg.setAlpha(this.hurtFlash > 0 ? 0.9 : 1)

    // ---- ③ 探照灯锥（贴图自带灯，但仍画一层矢量光锥增强存在感）----
    const beamA = 0.09 + (1 - this.layer().vis) * 0.18
    const beamLen = 120, half = 0.34
    g.fillStyle(0xdff8ff, beamA)
    g.beginPath()
    g.moveTo(X(14, 0), Y(14, 0))
    for (let i = 0; i <= 8; i++) {
      const ang = -half + (i / 8) * half * 2
      const lx = 14 + Math.cos(ang) * beamLen
      const ly = Math.sin(ang) * beamLen
      g.lineTo(X(lx, ly), Y(lx, ly))
    }
    g.closePath(); g.fillPath()

    // ---- ④ 发射塔：**通用挂架 + 可插拔发射器**（V6.6 重做）----
    //
    // 之前塔是一整张武器贴图，塔和武器是**同一个东西**，所以：
    //   · 想放大塔 → 武器也跟着放大 → 挤成一团
    //   · 想加新武器 → 必须重画整座塔（连带挂架）
    // 现在拆成两层：
    //   **挂架（mount）** —— 通用、所有武器共用一套画法，代表"艇上的安装位"
    //   **发射器（emitter）** —— 按 weapon id 画，插在挂架的转环上
    // 以后新增第 5、6、N 种武器，只需要加一个 emitter 分支，挂架一律不动。
    const gt = this.gTurret
    gt.clear()
    const plan = this.mountPlan()
    // 挂载点局部坐标（比例 × 机体显示尺寸）
    const MP = (seat: number, off: number) => {
      const [hx, hy] = HARDPOINTS[seat]
      return [X(hx * SUB_LEN, (hy + off) * SUB_WID), Y(hx * SUB_LEN, (hy + off) * SUB_WID)]
    }

    for (let i = 0; i < MAX_MOUNTS; i++) {
      const slot = plan[i]
      const w = this.weapons[i]
      if (!slot || !w) continue
      const [mountX, mountY] = MP(slot.seat, TWIN_OFFSET[slot.barrel])

      // 独立索敌：优先当前锁定目标，否则取射程内最近的
      const def = WEAPON_DEF[w.id]
      // 必须和 autoFire 用同一个射程，否则塔会指向一个实际打不到的目标
      const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
      const tgt = this.nearestEnemy(rng)
      let want = this.aim
      if (tgt) want = Math.atan2(tgt.y - mountY, tgt.x - mountX)
      // 限幅：塔相对机体朝向最多偏 ±60°，防止甩出去挡住本体
      const rel = Phaser.Math.Angle.Wrap(want - this.aim)
      const ang = this.aim + Phaser.Math.Clamp(rel, -1.05, 1.05)
      // 双联的两根管缩到 0.52×：一座上挂两个全尺寸挂架会把艇身撑爆。
      // 0.52 是配合 TWIN_OFFSET ±0.10（中心距 10.4px）算出来的 ——
      // 缩得太少，两根管的 13.5px 半宽会在 10.4px 的间距上糊成一块厚板，
      // 看不出"这是两根管"。
      const k = slot.barrel === 1 ? 0.52 : 1
      this.drawTurret(gt, mountX, mountY, ang, TURRET_L * k, TURRET_W * k, w)
    }

    // ---- 空挂架：已移到商店「挂载示意图」中展示 ----
    // 战斗中不在艇身画空座虚框：开局 3 个悬浮圆角框随艇身旋转，
    // 玩家完全看不懂（实测被当成"bug 框框"）。玩家真正需要理解"还有空位"
    // 的时机是在商店看扩容卡，那里有专用的座/管位示意图，比战斗里悬浮框清晰。

    // ---- 双联连接梁：两根管之间一道短横梁 ----
    // 没有这道梁，双联看起来就是"两个挨着的独立塔"而不是"并联的一座"
    for (let s = 0; s < HARDPOINTS.length; s++) {
      if (plan.filter(p => p.seat === s).length < 2) continue
      const [ax, ay] = MP(s, TWIN_OFFSET[0])
      const [bx, by] = MP(s, TWIN_OFFSET[1])
      neonLine(gt, ax, ay, bx, by, UI.cyanDim, { width: 3.2, alpha: 0.85, bloom: false })
      neonLine(gt, ax, ay, bx, by, UI.cyanHi, { width: 1, alpha: 0.6, bloom: false })
    }

    // ---- ⑤ 推进器尾焰（移动时更长）----
    if (this.moving) {
      // 尾焰起点跟着艇身放大：-14 是配 59px 艇身的，现在半长 49.5 要挪到艇尾
      const flame = Math.sin(this.t * 26) * 2.4 + 5
      const tail = -SUB_LEN * 0.48
      neonLine(g, X(tail, 0), Y(tail, 0), X(tail - flame, 0), Y(tail - flame, 0),
        UI.cyanHi, { width: 3, alpha: 0.75, bloom: true })
    }
  }

  /**
   * 发射塔 = **通用挂架**（g.save/rotate 后以 0,0 为中心，长边沿局部 +x）。
   *
   * 挂架本身用**通用色**（cyanDim），**不带武器色** —— 这是刻意的：
   * 座是艇上的固定设施，武器是可换的。如果挂架也染成武器色，
   * "这座塔能换装别的炮"这件事就说不通了。武器色只出现在发射器上。
   */
  private drawTurret(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                     ang: number, L: number, W: number, w: Weapon): void {
    g.save()
    g.translateCanvas(cx, cy)
    g.rotateCanvas(ang)

    // 挂架底：深色圆角矩形，压住艇身贴图让塔"有实体"
    g.fillStyle(UI.panel, 0.94)
    g.fillRoundedRect(-L / 2, -W / 2, L, W, 7)
    neon(g, UI.cyanDim, () => { g.strokeRoundedRect(-L / 2, -W / 2, L, W, 7) },
      { width: 1.6, alpha: 0.9, bloom: false })

    // 四角卡榫：表达"发射器是插上去的、可拆换"，这是通用挂架最关键的符号
    g.fillStyle(UI.cyanDim, 0.85)
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        g.fillRect(sx * (L / 2 - 5) - 2, sy * (W / 2 - 4) - 1.5, 4, 3)
      }
    }
    // 中央转环：发射器的安装座
    g.lineStyle(1, UI.cyanDim, 0.55)
    g.strokeCircle(0, 0, W * 0.34)

    // 发射器（按武器种类，插在转环上，指向局部 +x）
    const k = L / TURRET_L
    this.drawEmitter(g, w.id, EMITTER_SIZE * k, w.timer > 0)
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
      // 鱼雷发射管：粗筒 + 管口环
      g.fillStyle(UI.panelHi, 0.95)
      g.fillRoundedRect(-s * 0.4, -s * 0.3, s * 1.0, s * 0.6, 3)
      g.lineStyle(1.8, col, 0.95)
      g.strokeRoundedRect(-s * 0.4, -s * 0.3, s * 1.0, s * 0.6, 3)
      g.lineStyle(2, firing ? WHITE : col, 0.9)
      g.beginPath(); g.moveTo(s * 0.55, -s * 0.32); g.lineTo(s * 0.55, s * 0.32); g.strokePath()
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

  /** 空挂架：暗色虚框 + 中心十字，表示"这个位子还空着、可以装" */
  private drawEmptyMount(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                         ang: number, L: number, W: number): void {
    g.save()
    g.translateCanvas(cx, cy)
    g.rotateCanvas(ang)
    g.lineStyle(1.2, UI.line, 0.5)
    g.strokeRoundedRect(-L / 2, -W / 2, L, W, 7)
    g.lineStyle(1, UI.line, 0.35)
    g.beginPath()
    g.moveTo(-L * 0.16, 0); g.lineTo(L * 0.16, 0)
    g.moveTo(0, -W * 0.2); g.lineTo(0, W * 0.2)
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
    const prog = 1 - this.waveTimer / Math.max(1, WAVE_SHAPE[this.waveInLayer].dur)
    const depthNow = Phaser.Math.Clamp(
      L.depthTop + (L.depthBot - L.depthTop) * ((this.waveInLayer + prog) / WAVE_SHAPE.length),
      L.depthTop, L.depthBot)
    this.depthM = depthNow
    this.txt(Math.round(depthNow).toLocaleString(), dx0, dy0 - 8, '30px', TXT.cyber, MONO)
    // "m" 紧跟数字：按字符数估算宽度（30px MONO ≈ 17px/字），固定偏移会随位数漂移
    this.txt('m', dx0 + 14 + Math.round(depthNow).toLocaleString().length * 17, dy0 + 12, '12px', TXT.dim, MONO)
    this.txt(`L${this.layerIdx + 1} ${L.name}`, dx0, dy0 + 26, '13px', TXT.cyber, FONT)
    this.txt(L.sub, dx0, dy0 + 44, '10px', TXT.mute, MONO)
    for (let i = 0; i < LAYERS.length; i++) {
      const yy = dy0 + 64 + i * 20
      const cur = i === this.layerIdx
      const done = i < this.layerIdx
      g.fillStyle(cur ? UI.cyan : (done ? UI.cyanDim : UI.line), cur ? 1 : 0.6)
      g.fillRect(dx0, yy, cur ? 26 : 16, 5)
      if (cur) {
        g.fillStyle(UI.cyan, 0.25)
        g.fillRect(dx0 + 30, yy - 4, 6, 13)
      }
    }
    this.txt(`×${this.mult.toFixed(1)}`, dx0, dy0 + 64 + LAYERS.length * 20 + 6, '14px', TXT.amber, MONO)

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
    this.txt('危险', dzX, by + bh + 12, '9px', TXT.warn, FONT, 'center')

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
    this.txt(`第 ${wi} / ${WAVE_SHAPE.length} 波`, wx0, by + 2, '16px', TXT.main, MONO)
    for (let i = 0; i < WAVE_SHAPE.length; i++) {
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
      const dur = Math.max(1, WAVE_SHAPE[this.waveInLayer].dur)
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
      this.txt('s', wcx + wr + 6, wcy - 6, '10px', TXT.dim, MONO)

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

    // ⑤ 武器条（V6.3 建立，V6.6 重做）
    //
    // 槽数 = `maxWeapons`（4 → 靠商店卡解锁到 6），**不再写死 3**。
    // 每槽必须同时回答四个问题：
    //   装了什么（图形签名）· 多强（等级点）· 什么时候好（冷却环）· 是不是双联（角标）
    // 冷却进度是 Brotato 手感的可读性核心：玩家要能学会"机关枪在转、等下"。
    const sy = this.scale.height - 50
    const slots = this.maxWeapons
    const sw = 46, gap = 52
    const plan = this.mountPlan()
    for (let i = 0; i < slots; i++) {
      const sx = 24 + i * gap
      const w = this.weapons[i]
      const twin = plan[i]?.barrel === 1
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
        { width: twin ? 1.6 : 2, alpha: 0.9, bloom: false })

      const icx = sx + sw / 2, icy = sy + 19
      this.drawWeaponIcon(g, w.id, icx, icy, 12)

      // —— 冷却环：绕图标画一圈进度弧，从 12 点顺时针填充 ——
      // 用环而不是底部细条：环的"转满一圈"直接对应"又射了一发"，
      // 6 把武器同时转的时候，火力节奏是**看得见的**。
      if (w.timer > 0) {
        const k = Phaser.Math.Clamp(1 - w.timer / Math.max(0.01, w.iv), 0, 1)
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

      // —— 双联角标：右上角上下两个琥珀小方块 ——
      // 和商店卡里的挂载示意图用同一套视觉语言（双联 = 一上一下两个半块），
      // 玩家在卡面学到的记号，在 HUD 上能直接认出来。
      if (twin) {
        g.fillStyle(UI.amber, 0.95)
        g.fillRect(sx + sw - 11, sy + 4, 5, 4)
        g.fillRect(sx + sw - 11, sy + 10, 5, 4)
      }
    }
    // 挂载计数：解锁卡买了之后这里会跳，是"塔在成长"的即时反馈
    this.txt(`挂载 ${this.weapons.length}/${this.maxWeapons}`,
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
      this.cameras.main.setZoom(1 + beat * 0.009 * urgency)
    } else {
      // 必须每帧显式复位：只在高氧时不设的话，镜头会卡在最后一次缩放上
      this.cameras.main.setZoom(1)
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

    if (this.phase === 'descending') this.drawDescending(g)
    // shop/decide/result 的弹窗分派已移到 update() —— drawHud 被相位门控后，
    // 放在这里的分派在弹窗相位永远执行不到（踩过的坑：弹窗直接消失，
    // 且 HUD 的独立 Graphics 不再 clear，画面残留最后一帧战斗 HUD）。
  }

  // ---- 文字对象池：避免每帧 new Text 造成 GC 抖动 ----
  private hideTexts(): void {
    for (const t of this.txtPool) t.setVisible(false)
  }
  private txt(s: string, x: number, y: number, size: string, color: string,
              font: string, align: 'left' | 'center' | 'right' = 'left',
              cat: 'ui' | 'float' = 'ui')
    : Phaser.GameObjects.Text {
    let t = this.txtPool.find(o => !o.visible)
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: font, fontSize: size, color })
        .setScrollFactor(0).setDepth(101)
      this.txtPool.push(t)
    }
    t.setText(s).setStyle({ fontFamily: font, fontSize: size, color })
    t.setPosition(x, y).setVisible(true)
    if (align === 'center') t.setOrigin(0.5)
    else if (align === 'right') t.setOrigin(1, 0)
    else t.setOrigin(0)
    t.setStroke('#04070d', 3)
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
    registerUiHit(this, { obj: rect, w, h, onClick, alive: () => rect.active })
    return rect
  }

  /** 带悬停高亮的热区：卡片是纯 Graphics 绘制的，hover 态必须手绘 */
  private addHoverHit(cx: number, cy: number, w: number, h: number,
                      onClick: () => void, onHover: (v: boolean) => void)
    : Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(cx, cy, w, h, 0x000000, 0)
    rect.setScrollFactor(0).setDepth(102)
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
    let m = 1 + this.st.dmg
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
    {
      id: 'w_gun', name: '脉冲机关枪', desc: '高频连射 · 单体', kind: 'weapon',
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

    // —— 挂载位扩容卡（V6.6：塔升级走商店卡驱动）——
    //
    // 这是"潜航器养成"的成长线：4 个物理座开局就画在艇身上（空 U 型托架），
    // 玩家一眼能看见"还有位置没装"。扩容卡把上限从 4 → 5 → 6，
    // 第 5、6 台会把座 0、1 变成**双联**（一根座上并联两根炮管 + 连接梁）。
    //
    // 顺序很重要：必须先 5 再 6。直接跳到 6 会让艇身上凭空多出两个塔，
    // 玩家看不出发生了什么 —— 逐级解锁才有"我的艇在变强"的实感。
    {
      id: 't_slot5', name: '双联挂载 I', desc: '解锁第 5 挂载位 · 首座改双联', kind: 'mount',
      cost: 55,
      apply: s => { s.maxWeapons = 5 },
      dead: s => s.maxWeapons >= 5,
    },
    {
      id: 't_slot6', name: '双联挂载 II', desc: '解锁第 6 挂载位 · 次座改双联', kind: 'mount',
      cost: 70,
      apply: s => { s.maxWeapons = 6 },
      // 前置：必须先有 5 槽。没拿到 I 就不该刷出 II
      dead: s => s.maxWeapons !== 5,
    },
    {
      id: 't_twin', name: '齐射同步', desc: '双联座射速 +25%', kind: 'mount',
      cost: 45,
      apply: s => s.addStat('twinRate', 0.25),
      // 没双联就没意义
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
    this.drawSeaBackdrop(g, W, H, 0.70)

    const cw = 220, ch = 268, gap = 24
    const total = cw * 3 + gap * 2
    const x0 = (W - total) / 2
    const y0 = H / 2 - ch / 2 - 24

    // —— 顶部：鱼骨存量 ——
    // 这是"鱼骨=钱"能否被理解的关键：钱必须和卡同时出现在视野里，
    // 玩家才能把"刚才捡的那些骨"和"现在能买什么"连起来。
    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 第 ${this.waveInLayer + 1} 波结束`,
      W / 2, y0 - 74, '17px', TXT.cyber, FONT, 'center')
    const bankX = W / 2
    neonCircle(g, bankX - 96, y0 - 34, 13, BONE, { width: 1.6, bloom: false })
    this.txt(`${this.bank}`, bankX - 76, y0 - 42, '26px', TXT.cyber, MONO)
    this.txt('鱼骨', bankX - 42, y0 - 34, '13px', TXT.dim, FONT)
    this.txt('点击卡片购买 · 右键锁 · 1/2/3 快捷购买', W / 2, y0 - 8, '12px', TXT.mute, FONT, 'center')

    // —— 两侧常驻面板：左边属性、右边遗物 ——
    // Brotato 的商店把属性表放在卡片旁边而不是藏进二级页面，原因是：
    // 玩家的购买决策**依赖**当前属性（我暴击已经 60% 了，再买 +8% 意义不大）。
    // 属性看不见，商店就只能靠瞎买，build 也就无从谈起。
    this.drawStatPanel(g, 24, y0 - 40)
    this.drawRelicSlots(g, W - 24 - 250, y0 - 40)

    if (this.shopCards.length === 0) {
      for (let i = 0; i < 3; i++) {
        const up = this.offers[i] ?? this.pool[0]
        const x = x0 + i * (cw + gap), y = y0
        const idx = i
        // 卡主体热区**避开底部价格行**（锁定按钮在那儿，否则点锁就变成买卡）
        const rect = this.addHoverHit(x + cw / 2, y + (ch - 46) / 2, cw, ch - 46,
          () => this.buyCard(idx),
          v => { this.hoverCard = v ? idx : (this.hoverCard === idx ? -1 : this.hoverCard) })
        this.shopCards.push({ x, y, w: cw, h: ch, up, rect })
        // 锁定按钮（卡底部右侧）
        const lrect = this.addHoverHit(x + cw - 46, y + ch - 30, 62, 26,
          () => this.toggleLock(idx), () => {})
        this.shopBtns.push({ x: x + cw - 77, y: y + ch - 43, w: 62, h: 26, rect: lrect })
      }
      // 底部动作按钮：刷新 / 继续
      const byy = y0 + ch + 30, bw2 = 168, bh2 = 44
      const rrect = this.addHoverHit(W / 2 - bw2 / 2 - 10, byy, bw2, bh2, () => this.reroll(), () => {})
      this.shopBtns.push({ x: W / 2 - bw2 - 10, y: byy - bh2 / 2, w: bw2, h: bh2, rect: rrect })
      const grect = this.addHoverHit(W / 2 + bw2 / 2 + 10, byy, bw2, bh2, () => this.leaveShop(), () => {})
      this.shopBtns.push({ x: W / 2 + 10, y: byy - bh2 / 2, w: bw2, h: bh2, rect: grect })
      this.rerollBtnRect = { x: W / 2 - bw2 - 10, y: byy - bh2 / 2, w: bw2, h: bh2 }
      this.leaveBtnRect = { x: W / 2 + 10, y: byy - bh2 / 2, w: bw2, h: bh2 }
    }

    for (let i = 0; i < this.shopCards.length; i++) {
      const c = this.shopCards[i]
      const up = c.up
      const hov = this.hoverCard === i
      const cx = c.x + c.w / 2
      const isSold = this.sold[i]
      const isLocked = this.locked[i]
      const afford = this.bank >= up.cost

      // —— 卡体 ——
      // 三态必须一眼分开：可买（亮）/ 买不起（压暗）/ 已售出（最暗 + 划掉）
      const bodyA = isSold ? 0.5 : (afford ? 0.94 : 0.72)
      g.fillStyle(isSold ? UI.panel : (hov && afford ? UI.panelHi : UI.panel), bodyA)
      g.fillRoundedRect(c.x, c.y, c.w, c.h, 12)
      // 悬停时描边加亮加粗——纯 Graphics 卡片没有自带 hover 态，必须手绘
      const edgeCol = isSold ? UI.line : (isLocked ? UI.amber : (afford ? (hov ? UI.cyanHi : UI.cyan) : UI.line))
      neon(g, edgeCol, () => { g.strokeRoundedRect(c.x, c.y, c.w, c.h, 12) },
        { width: hov && afford ? 3 : 2, bloom: hov && afford })

      // —— 顶部类型色条：四类卡一眼分开，不用读文字 ——
      // 青=器械 / 琥珀=挂载扩容 / 紫=属性 / 骨白=遗物
      const bandCol = up.kind === 'weapon' ? UI.cyan
        : up.kind === 'mount' ? UI.amber
        : up.kind === 'relic' ? BONE : UI.violet
      g.fillStyle(bandCol, hov ? 1 : 0.8)
      g.fillRoundedRect(c.x + 10, c.y + 10, c.w - 20, 3, 2)

      this.txt(String(i + 1), c.x + 16, c.y + 24, '14px', TXT.mute, MONO)
      // 类型标签（右上角）
      const kindLabel = up.kind === 'weapon' ? '器械'
        : up.kind === 'mount' ? '挂载' : up.kind === 'relic' ? '遗物' : '属性'
      const kindCol = up.kind === 'mount' ? TXT.amber
        : up.kind === 'relic' ? TXT.bone : TXT.mute
      this.txt(kindLabel, c.x + c.w - 16, c.y + 24, '12px', kindCol, FONT, 'right')

      // —— 中部图示：按类型画不同的东西 ——
      const wid = up.id.startsWith('w_') ? up.id.slice(2) : null
      if (wid === 'gun' || wid === 'torpedo' || wid === 'arc' || wid === 'sonar') {
        // 器械：画真实器械图标（形状差异而非颜色，11px 也分得清）
        this.drawWeaponIcon(g, wid, cx, c.y + 62, 20)
        // 等级点：画**最高**那台的等级；同款挂了多台时补一个 ×N。
        // 「同款可以挂多台」是 V6.6 的改动，卡面必须把台数也表达出来，
        // 否则玩家会以为重复拿同一把是白拿。
        const heldAll = this.weapons.filter(w => w.id === wid)
        if (heldAll.length) {
          const topLvl = Math.max(...heldAll.map(w => w.lvl))
          this.drawLevelPips(g, cx, c.y + 92, topLvl, WEAPON_DEF[wid].color)
          if (heldAll.length > 1) {
            this.txt(`×${heldAll.length}`, cx + 32, c.y + 92, '12px', TXT.cyan, MONO, 'left')
          }
        }
      } else if (up.kind === 'mount') {
        // 挂载扩容：**画座/管位示意图** —— 让玩家看见"艇上多了哪个位置"
        this.drawMountDiagram(g, cx, c.y + 62, up.id)
      } else if (up.kind === 'relic') {
        // 遗物：画一帧专属符号（每个遗物形状不同，不靠颜色区分）
        this.drawRelicIcon(g, up.relicId ?? 'echo_heart', cx, c.y + 62, 22)
      } else {
        // 属性卡：画一个**进度条**，条里填的是"这个属性现在到哪了"
        // 比抽象圆环有用：玩家能看见"共振强度已经 +24%，再加 12% 就到 36%"
        this.drawStatGauge(g, cx, c.y + 62, up.id)
      }

      this.txt(up.name, cx, c.y + 122, '20px', TXT.cyber, FONT, 'center')
      this.txt(up.desc, cx, c.y + 156, '15px', TXT.main, FONT, 'center')

      // —— 底部状态行：这张卡买了会发生什么，必须写死 ——
      // 玩家不该靠猜来判断"买到的是新武器还是强化"
      let foot = ''
      let footCol: string = TXT.amber
      if (wid && wid !== 'all') {
        const heldAll = this.weapons.filter(w => w.id === wid)
        if (heldAll.length === 0) {
          foot = `新装备 · 占用 1 个挂载位`
          footCol = TXT.cyan
        } else if (this.weapons.length < this.maxWeapons) {
          // 还有空位 → 同款再加一台，火力来自台数
          foot = `加装第 ${heldAll.length + 1} 台 · 与现役并联开火`
          footCol = TXT.cyan
        } else {
          // 满了 → 只能并进已有的一台去升级
          const lv = Math.min(...heldAll.map(w => w.lvl))
          foot = `槽位已满 · 升级一台 Lv${lv} → Lv${Math.min(5, lv + 1)}`
          footCol = TXT.amber
        }
      } else if (wid === 'all') {
        foot = `${this.weapons.length} 台器械同时 +1 级`
      } else if (up.kind === 'mount') {
        foot = up.id === 't_twin'
          ? `双联座射速 +25%（当前 +${Math.round(this.st.twinRate * 100)}%）`
          : `挂载位 ${this.maxWeapons} → ${up.id === 't_slot5' ? 5 : 6}`
      } else if (up.kind === 'relic') {
        // 遗物：写清占哪个槽 + 代价。**代价必须用告警色单独一行** ——
        // 把代价藏在描述里等于骗玩家，他会在第三波才发现自己氧气少了 15。
        foot = this.relics.length < RELIC_SLOTS
          ? `占用遗物槽 ${this.relics.length + 1} / ${RELIC_SLOTS}`
          : '遗物槽已满'
      }
      if (foot) this.txt(foot, cx, c.y + 196, '12px', footCol, FONT, 'center')

      // 遗物的代价单独一行，告警色，画在状态行下方
      if (up.kind === 'relic' && up.relicId) {
        const c2 = RELIC_DEF[up.relicId].cost2
        if (c2) this.txt(c2, cx, c.y + 214, '11px', TXT.warn, FONT, 'center')
      }

      // —— 底部价格行：鱼骨图标 + 价格 + 锁定按钮 ——
      const pyRow = c.y + c.h - 30
      if (isSold) {
        // 已售出：不画价格，画一条贯穿的"已购入"
        g.fillStyle(UI.jade, 0.5)
        g.fillRect(c.x + 14, pyRow + 4, c.w - 28, 1)
        this.txt('已购入', cx, pyRow - 2, '16px', TXT.jade, FONT, 'center')
      } else {
        // 鱼骨币图标（小圆 + 十字，和飘字/HUD 用同一套记号）
        const bx2 = cx - 44
        neonCircle(g, bx2, pyRow + 4, 8, BONE, { width: 1.4, bloom: false })
        this.txt(`${up.cost}`, bx2 + 13, pyRow - 4, '20px', afford ? TXT.cyber : TXT.warn, MONO)
        // 买不起时不弹提示（打断节奏），而是把整张卡压暗 + 价格转告警色，
        // 玩家自己会得出"我得再捡一波"的结论 —— 这就是鱼骨经济该教的判断。
        this.txt(afford ? '购买' : '鱼骨不足', bx2 + 13 + String(up.cost).length * 12 + 8,
          pyRow + 2, '12px', afford ? TXT.dim : TXT.warn, FONT)

        // 锁定按钮
        const lbx = c.x + c.w - 77, lby = c.y + c.h - 43
        g.fillStyle(isLocked ? UI.amber : UI.panelHi, isLocked ? 0.9 : 0.7)
        g.fillRoundedRect(lbx, lby, 62, 26, 6)
        g.lineStyle(1.2, isLocked ? UI.amber : UI.line, isLocked ? 1 : 0.6)
        g.strokeRoundedRect(lbx, lby, 62, 26, 6)
        // 锁图标：锁定时闭合（实心方块 + 梁），未锁定时开口
        const lcx2 = lbx + 15, lcy2 = lby + 13
        g.lineStyle(1.8, isLocked ? UI.abyss : UI.cyanDim, 0.95)
        g.beginPath()
        if (isLocked) g.strokeRect(lcx2 - 5, lcy2 - 1, 10, 8)
        else { g.moveTo(lcx2 - 5, lcy2 + 3); g.lineTo(lcx2 - 5, lcy2 - 1)
               g.lineTo(lcx2 + 5, lcy2 - 1); g.lineTo(lcx2 + 5, lcy2 + 3) }
        g.strokePath()
        this.txt(isLocked ? '已锁定' : '锁定', lbx + 26, lby + 6, '12px',
          isLocked ? TXT.amber : TXT.mute, FONT)
      }
    }

    // —— 底部动作按钮 ——
    if (this.rerollBtnRect) {
      const r = this.rerollBtnRect
      const canRoll = this.bank >= this.rerollCost
      g.fillStyle(canRoll ? UI.panelHi : UI.panel, canRoll ? 0.92 : 0.6)
      g.fillRoundedRect(r.x, r.y, r.w, r.h, 10)
      neon(g, canRoll ? UI.cyan : UI.line, () => { g.strokeRoundedRect(r.x, r.y, r.w, r.h, 10) },
        { width: 1.6, alpha: canRoll ? 0.9 : 0.5, bloom: false })
      this.txt(`刷新  ${this.rerollCost} 骨`, r.x + r.w / 2, r.y + 8, '17px',
        canRoll ? TXT.cyber : TXT.mute, FONT, 'center')
      this.txt('保留已锁定的卡', r.x + r.w / 2, r.y + 26, '11px', TXT.dim, FONT, 'center')
    }
    if (this.leaveBtnRect) {
      const b = this.leaveBtnRect
      g.fillStyle(UI.panelHi, 0.92); g.fillRoundedRect(b.x, b.y, b.w, b.h, 10)
      neon(g, UI.jade, () => { g.strokeRoundedRect(b.x, b.y, b.w, b.h, 10) },
        { width: 2, alpha: 0.95, bloom: false })
      this.txt('继续 · 进入下一波', b.x + b.w / 2, b.y + 8, '17px', TXT.jade, FONT, 'center')
      this.txt(`剩余 ${this.bank} 鱼骨将保留`, b.x + b.w / 2, b.y + 26, '11px', TXT.dim, FONT, 'center')
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
   * 画一根横向的"挂载梁"，上面按当前挂载数摆方块：
   * 已占用的画实心（器械本色），**这张卡会新解锁的那一个画闪烁的空心框**。
   *
   * 为什么必须画示意：只写"解锁第 5 挂载位"是抽象数字，玩家不知道
   * 第 5 位长在哪、和前 4 个有什么不同。画出"第 5 位会挂在第 1 座旁边变成双联"，
   * 这张卡的价值才是看得见的。
   */
  private drawMountDiagram(g: Phaser.GameObjects.Graphics, cx: number, cy: number,
                           id: string): void {
    const target = id === 't_slot5' ? 5 : id === 't_slot6' ? 6 : this.maxWeapons
    const n = Math.max(target, this.maxWeapons)
    const gap = 15, bw = 11, bh = 13
    const x0 = cx - ((n - 1) * gap) / 2

    // 挂载梁
    neonLine(g, x0 - 8, cy, x0 + (n - 1) * gap + 8, cy, UI.cyanDim,
      { width: 2, alpha: 0.7, bloom: false })

    const plan = this.mountPlan()
    for (let i = 0; i < n; i++) {
      const x = x0 + i * gap
      const occupied = i < this.weapons.length
      // 这张卡新解锁的那一位：闪烁空心框
      const isNew = i === target - 1
      // 双联位（第 5、6 位）画成"上下两个半块"，直观表达并联
      const twin = i >= HARDPOINTS.length

      if (twin) {
        // 双联：一上一下两个半块
        const col = occupied ? WEAPON_DEF[this.weapons[i].id].color : UI.cyan
        for (const dir of [-1, 1]) {
          const yy = cy + dir * 4
          if (occupied) {
            g.fillStyle(col, 0.95); g.fillRect(x - bw / 2, yy - bh / 5, bw, bh / 2.2)
          } else {
            g.lineStyle(1, isNew ? UI.amber : UI.cyanDim, isNew ? 1 : 0.45)
            g.strokeRect(x - bw / 2, yy - bh / 5, bw, bh / 2.2)
          }
        }
      } else {
        const col = occupied ? WEAPON_DEF[this.weapons[i].id].color : UI.cyan
        if (occupied) {
          g.fillStyle(col, 0.95); g.fillRect(x - bw / 2, cy - bh / 2, bw, bh)
        } else {
          const a = isNew ? 1 : 0.45
          const c2 = isNew ? UI.amber : UI.cyanDim
          g.lineStyle(isNew ? 1.6 : 1, c2, a)
          g.strokeRect(x - bw / 2, cy - bh / 2, bw, bh)
        }
      }

      // 新解锁位：外面套一圈闪烁提示环
      if (isNew) {
        const blink = 0.45 + 0.55 * Math.abs(Math.sin(this.t * 5))
        neonCircle(g, x, cy, 11, UI.amber, { width: 1.6, alpha: blink, bloom: false })
      }
    }
    // 座编号（双联位标成 "1·B" 这种，说明它挂在第 1 座的后管）
    void plan
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
    g.fillStyle(UI.panel, 0.6); g.fillRoundedRect(x, y, w, h, 10)
    neon(g, UI.cyanDim, () => { g.strokeRoundedRect(x, y, w, h, 10) },
      { width: 1, alpha: 0.5, bloom: false })
    this.txt('潜航器状态', x + 14, y + 12, '14px', TXT.cyber, FONT)

    for (let i = 0; i < STAT_META.length; i++) {
      const m = STAT_META[i]
      const v = this.st[m.k]
      const ry = y + 40 + i * rowH
      const on = v > 0.0001
      // 色块：既是装饰也是色标，和卡面顶部的类型色条同一套语言
      g.fillStyle(m.col, on ? 0.95 : 0.3)
      g.fillRect(x + 14, ry + 4, 4, 12)
      this.txt(m.name, x + 26, ry + 2, '13px', on ? TXT.main : TXT.mute, FONT)

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
    g.fillStyle(UI.panel, 0.6); g.fillRoundedRect(x, y, w, h, 10)
    neon(g, BONE, () => { g.strokeRoundedRect(x, y, w, h, 10) },
      { width: 1, alpha: 0.5, bloom: false })
    this.txt(`遗物 ${this.relics.length} / ${RELIC_SLOTS}`, x + 14, y + 12, '14px', TXT.bone, FONT)

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
      this.txt(r.name, bx + 50, ry + 8, '14px', TXT.bone, FONT)
      // 描述可能较长，用小字挤进两行宽度的空间（槽宽 226，14px 约 16 字/行）
      this.txt(r.desc, bx + 50, ry + 27, '10px', TXT.dim, FONT)
      if (r.cost2) this.txt(r.cost2, bx + 50, ry + 44, '10px', TXT.warn, FONT)
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
    const w = 116, h = 12
    const x0 = cx - w / 2, y0 = cy - h / 2

    g.fillStyle(UI.panel, 0.85); g.fillRoundedRect(x0, y0, w, h, 5)
    // "买了会到哪"先画一层浅色，再在上面盖"现在已经到哪" ——
    // 两层叠着看，增量就是中间那段差值，一眼可见
    g.fillStyle(UI.violet, 0.35); g.fillRoundedRect(x0, y0, Math.max(2, w * next), h, 5)
    g.fillStyle(UI.violet, 0.95); g.fillRoundedRect(x0, y0, Math.max(2, w * cur), h, 5)
    neon(g, UI.violet, () => { g.strokeRoundedRect(x0, y0, w, h, 5) },
      { width: 1.2, alpha: 0.8, bloom: false })

    // 增量段标一个箭头，避免玩家看不出"浅色那段是我要买的"
    if (next > cur + 0.01) {
      const mx = x0 + w * (cur + next) / 2
      g.fillStyle(UI.cyanHi, 0.9)
      g.fillTriangle(mx - 3, y0 - 4, mx + 3, y0 - 4, mx, y0 + 1)
    }
    const shown = m.k === 'o2Bonus' || m.k === 'killO2' || m.k === 'regen'
      ? `${this.st[m.k].toFixed(m.k === 'regen' ? 1 : 0)} → ${(this.st[m.k] + m.add).toFixed(m.k === 'regen' ? 1 : 0)}`
      : `${Math.round(this.st[m.k] * 100)}% → ${Math.round(Math.min(full, this.st[m.k] + m.add) * 100)}%`
    this.txt(shown, cx, cy + 14, '12px', TXT.cyber, MONO, 'center')
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
    this.bullets = []; this.arcs = []; this.blasts = []   // 旧弹不能飘进新层
    this.sparks = []; this.floats = []
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
    this.sparks = []; this.floats = []
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
    this.depthM = L.depthTop + (L.depthBot - L.depthTop) * (this.waveInLayer / WAVE_SHAPE.length)
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
