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
  [-0.21, 0.17],   // 左后
  [-0.21, -0.17],  // 左前
  [0.21, 0.17],    // 右后
  [0.21, -0.17],   // 右前
]

/** 塔头显示尺寸（px）。从 20 放大到 30 —— 20px 在 59px 的艇身上是"小零件"比例 */
const TURRET_SIZE = 30

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
  r: 16,
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

interface Upgrade {
  id: string
  name: string
  desc: string
  apply: (s: DiveScene) => void
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

export default class DiveScene extends Phaser.Scene {
  constructor() { super('dive') }

  // ---- 玩家状态 ----
  private px = 0
  private py = 0
  private o2 = O2.max
  private o2Max = O2.max
  /** 升级带来的额外上限（跨层保留） */
  private o2Bonus = 0
  private biomass = 0
  /** 朝向（弧度）：艇身朝移动方向，静止时保持上一次 */
  private aim = 0
  private burstTimer = 0
  private speedMul = 1
  private pickupMul = 1
  private killO2 = PLAYER.killO2
  /** 受击闪白计时（氧气被撞时） */
  private hurtFlash = 0
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
  /** 玩家当前挂载的器械（最多 3 台，各自独立冷却、同时自动开火） */
  private weapons: Weapon[] = []
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
  /** 4 个独立转向的炮塔塔头（贴图），未装配的槽位不显示 */
  private turretImgs: Phaser.GameObjects.Image[] = []
  /** WeaponId -> 贴图 key */
  private turretTex!: Record<string, string>
  private gBg!: Phaser.GameObjects.Graphics    // 环境（被暗幕压暗）
  private gDim!: Phaser.GameObjects.Graphics   // 暗幕（只压环境，不压实体）
  private g!: Phaser.GameObjects.Graphics      // 实体（永远全亮）
  private gHud!: Phaser.GameObjects.Graphics
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private shopCards: { x: number; y: number; w: number; h: number; up: Upgrade; rect: Phaser.GameObjects.Rectangle }[] = []
  private decideBtns: { x: number; y: number; w: number; h: number; label: string; sub: string; enabled: boolean; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private resultBtns: { x: number; y: number; w: number; h: number; label: string; act: () => void; rect: Phaser.GameObjects.Rectangle }[] = []
  private txtPool: Phaser.GameObjects.Text[] = []
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
    const SUB_SIZE = 31
    this.subImg = this.add.image(0, 0, 'sub_body').setDepth(60)
    this.subImg.setDisplaySize(SUB_SIZE * 1.9, SUB_SIZE)
    const TEX_OF: Record<string, string> = {
      gun: 'w_gun', torpedo: 'w_torpedo', arc: 'w_arc',
    }
    for (let i = 0; i < HARDPOINTS.length; i++) {
      const img = this.add.image(0, 0, 'w_gun').setDepth(61).setVisible(false)
      this.turretImgs.push(img)
    }
    this.turretTex = TEX_OF

    // 深度分层：**环境 → 暗幕 → 实体 → HUD**。
    // 暗幕夹在中间是 V4 §2 的铁律——它只能压暗地形，敌人/气泡/玩家必须画在它之上，
    // 否则深渊层（可见度 10%）会把 gameplay 信息一起吃掉。
    this.gBg = this.add.graphics().setScrollFactor(0).setDepth(5)
    this.gDim = this.add.graphics().setScrollFactor(0).setDepth(7)
    this.g = this.add.graphics().setDepth(10)
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
    this.o2Bonus = 0
    this.o2Max = LAYERS[0].o2Max
    this.o2 = this.o2Max
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
    const spd = kind === 'drift' ? 42 : kind === 'dash' ? 96 : 68

    this.enemies.push({
      x, y, vx: 0, vy: 0,
      hp, maxHp: hp,
      r: kind === 'drift' ? 20 : kind === 'dash' ? 15 : 11,
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
      speed: 46,
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
      this.autoFire(dt)
      this.drainOxygen(dt)
      this.updateWave(dt)
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
      if (K.JustDown(this.keys.one) && this.offers[0]) this.pickUpgrade(this.offers[0])
      else if (K.JustDown(this.keys.two) && this.offers[1]) this.pickUpgrade(this.offers[1])
      else if (K.JustDown(this.keys.three) && this.offers[2]) this.pickUpgrade(this.offers[2])
    } else if (this.phase === 'decide') {
      if (K.JustDown(this.keys.one)) this.diveDeeper()
      else if (K.JustDown(this.keys.two)) this.surface()
    }
    if (K.JustDown(this.keys.esc)) this.scene.start('title')

    this.drawEnv()
    this.draw()
    this.drawHud()
  }

  private movePlayer(dt: number): void {
    const W = this.scale.width, H = this.scale.height
    let dx = 0, dy = 0
    if (this.keys.left.isDown) dx -= 1
    if (this.keys.right.isDown) dx += 1
    if (this.keys.up.isDown) dy -= 1
    if (this.keys.down.isDown) dy += 1
    if (dx || dy) {
      const l = Math.hypot(dx, dy)
      this.aim = Math.atan2(dy, dx)
      this.px += (dx / l) * PLAYER.speed * this.speedMul * dt
      this.py += (dy / l) * PLAYER.speed * this.speedMul * dt
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
        this.o2 -= (e.kind === 'boss' ? 34 : 24) * dt
        this.hurtFlash = 0.25
        // 轻微弹开，避免贴脸站桩
        e.x -= nx * 40 * dt
        e.y -= ny * 40 * dt
      }
    }
  }

  /** Boss 震击：红圈预警 1.2s 后爆发 */
  private bossSlam(e: Enemy): void {
    const R = 220
    if (Phaser.Math.Distance.Between(this.px, this.py, e.x, e.y) <= R) {
      this.o2 -= 18
      this.hurtFlash = 0.35
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

  private hurt(e: Enemy, dmg: number): void {
    e.hp -= dmg
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.biomass += e.kind === 'boss' ? 20 : 1
      if (e.kind === 'boss') this.bossDown = true
      this.spawnDebris(e)          // 软组织被共振震散
      this.dropBone(e)             // 只剩发光骨架
      if (this.killO2 > 0) this.o2 = Math.min(this.o2Max, this.o2 + this.killO2)
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
    const pr = O2.pickupR * this.pickupMul
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
        this.o2 = Math.min(this.o2Max, this.o2 + b.value)
        b.alive = false
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

  /** 挂载一台器械。超过 3 台时替换 id 相同的那台（不会无限堆） */
  private addWeapon(id: WeaponId, lvl = 1): void {
    const st = this.weaponStats(id, lvl)
    const exist = this.weapons.find(w => w.id === id)
    if (exist) {
      exist.lvl = Math.min(5, exist.lvl + 1)
      const s2 = this.weaponStats(id, exist.lvl)
      exist.iv = s2.iv; exist.dmg = s2.dmg
      return
    }
    if (this.weapons.length >= 3) this.weapons.shift()
    this.weapons.push({ id, iv: st.iv, timer: 0, dmg: st.dmg, lvl, anchor: 0 })
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
    for (const w of this.weapons) {
      // 钳到 0：没打到目标时 timer 会一直累加负值，
      // HUD 的冷却条按 timer/iv 算，负值会让进度条反向画满。
      w.timer = Math.max(0, w.timer - dt)
      if (w.timer > 0) continue
      const def = WEAPON_DEF[w.id]
      const rng = def.range + (w.lvl - 1) * 26

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
      w.timer = def.iv / (1 + (w.lvl - 1) * 0.12)
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
    this.o2 -= this.layer().drain * dt
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
    neon(g, UI.cyanDim, () => { g.strokeRect(12, 12, W - 24, H - 24) }, { width: 1, alpha: 0.35, bloom: false })

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
      const a = 0.95 * blink * f          // f: 沉底后线性渐隐

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
    const rimW = 34, rimH = 19
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

    // ---- ④ 炮塔塔头：独立瞄准 ----
    // 4 个挂载点固定在机体上（跟随机体旋转），但塔头自身再转一次去瞄准目标。
    for (let i = 0; i < HARDPOINTS.length; i++) {
      const img = this.turretImgs[i]
      const w = this.weapons[i]
      if (!w) { img.setVisible(false); continue }
      // 挂载点局部坐标（以机体长宽为单位的比例）× 机体显示尺寸
      const [hx, hy] = HARDPOINTS[i]
      const mountX = X(hx * 59, hy * 31)
      const mountY = Y(hx * 59, hy * 31)

      // 独立索敌：优先当前锁定目标，否则取射程内最近的
      const def = WEAPON_DEF[w.id]
      const rng = def.range + (w.lvl - 1) * 26
      const tgt = this.nearestEnemy(rng)
      let want = this.aim
      if (tgt) want = Math.atan2(tgt.y - mountY, tgt.x - mountX)
      // 限幅：塔相对机体朝向最多偏 ±60°，防止甩出去挡住本体
      const rel = Phaser.Math.Angle.Wrap(want - this.aim)
      const clamped = Phaser.Math.Clamp(rel, -1.05, 1.05)
      img.setVisible(true)
      img.setTexture(this.turretTex[w.id] ?? 'w_gun')
      img.setPosition(mountX, mountY)
      img.setRotation(this.aim + clamped)
      img.setDisplaySize(TURRET_SIZE, TURRET_SIZE)
      // 开火瞬间塔头发亮，给"它在射击"的反馈
      img.setTint(w.timer > 0 ? 0xffffff : 0xbfd0ff)
    }

    // ---- ⑤ 推进器尾焰（移动时更长）----
    if (this.moving) {
      const flame = Math.sin(this.t * 26) * 2.4 + 5
      neonLine(g, X(-14, 0), Y(-14, 0), X(-14 - flame, 0), Y(-14 - flame, 0),
        UI.cyanHi, { width: 3, alpha: 0.75, bloom: true })
    }
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
    const bw = 420, bh = 18, bx = cx - bw / 2, by = 26
    const full = Math.max(O2.max, this.o2Max)
    const curRatio = Phaser.Math.Clamp(this.o2 / full, 0, 1)
    const capRatio = Phaser.Math.Clamp(this.o2Max / full, 0, 1)
    const pct = this.o2 / this.o2Max
    const low = pct < 0.2
    const col = low ? UI.danger : (pct < 0.5 ? UI.amber : UI.cyan)
    const pulse = low ? (this.t * 4 % 1 < 0.5 ? 1 : 0.55) : 1

    g.fillStyle(UI.panel, 0.75); g.fillRoundedRect(bx, by, bw, bh, 9)
    if (capRatio < 1) {
      g.fillStyle(UI.line, 0.5); g.fillRoundedRect(bx + bw * capRatio, by, bw * (1 - capRatio), bh, 9)
    }
    g.fillStyle(col, pulse)
    g.fillRoundedRect(bx, by, Math.max(2, bw * curRatio), bh, 9)
    neon(g, low ? UI.danger : UI.cyanDim, () => { g.strokeRoundedRect(bx, by, bw, bh, 9) },
      { width: 1, alpha: 0.8, bloom: false })
    this.txt(`${Math.ceil(this.o2)} / ${this.o2Max}`, cx, by + bh / 2, '20px', TXT.cyber, MONO, 'center')
    // 耗氧速率（越深越快，必须显式告诉玩家）
    this.txt(`-${L.drain.toFixed(1)}/s`, bx - 12, by + 2, '13px', TXT.dim, MONO, 'right')

    // ③ 波次进度
    const wi = this.waveInLayer + 1
    this.txt(`第 ${wi} / ${WAVE_SHAPE.length} 波`, bx + bw + 18, by + 2, '16px', TXT.main, MONO)
    for (let i = 0; i < WAVE_SHAPE.length; i++) {
      const px1 = bx + bw + 18 + i * 16, py1 = by + bh + 6
      // 结算时当前波还没"完成"，所以最后一个点在 result 相位不点亮
      const done = this.phase === 'result' ? i < this.waveInLayer : i <= this.waveInLayer
      g.fillStyle(done ? UI.cyan : UI.line, 1)
      g.fillCircle(px1, py1, 4)
    }
    if (this.phase === 'wave') {
      this.txt(`${Math.max(0, Math.ceil(this.waveTimer))}s`, bx + bw + 18, by + bh + 14, '13px', TXT.dim, MONO)
    }

    // ④ 生物质（含倍率后的预估值，让"再赌一层"的收益可见）
    const est = Math.floor(this.biomass * this.mult)
    this.txt(`生物质 ${this.biomass}`, W - 24, by + 2, '18px', TXT.jade, MONO, 'right')
    if (this.mult > 1) {
      this.txt(`上浮可得 ${est}`, W - 24, by + 26, '13px', TXT.amber, MONO, 'right')
    }

    // ⑤ 武器槽（V6.3）
    //
    // 三个槽 = 最多挂三台器械。每槽必须同时回答三个问题：
    //   装了什么（图形签名）· 多强（等级点）· 什么时候好（冷却进度）
    // 冷却进度是 Brotato 手感的可读性核心：玩家要能学会"机关枪在转、等下"。
    const sy = this.scale.height - 46
    for (let i = 0; i < 3; i++) {
      const sx = 24 + i * 52, sw = 44
      const w = this.weapons[i]
      g.fillStyle(w ? UI.panelHi : UI.panel, w ? 0.9 : 0.6)
      g.fillRoundedRect(sx, sy, sw, sw, 8)
      neon(g, w ? WEAPON_DEF[w.id].color : UI.line,
        () => { g.strokeRoundedRect(sx, sy, sw, sw, 8) },
        { width: w ? 2 : 1, alpha: w ? 0.9 : 0.5, bloom: false })
      if (!w) {
        this.txt('空', sx + sw / 2, sy + sw / 2, '11px', TXT.mute, FONT, 'center')
        continue
      }
      this.drawWeaponIcon(g, w.id, sx + sw / 2, sy + 18, 11)
      // 等级点：最多 5 个小方块，从左到右填充
      for (let k = 0; k < 5; k++) {
        const px1 = sx + 8 + k * 6, py1 = sy + 34
        g.fillStyle(k < w.lvl ? WEAPON_DEF[w.id].color : UI.line, k < w.lvl ? 1 : 0.5)
        g.fillRect(px1, py1, 4, 4)
      }
      // 冷却进度：底部细条，ready 时不画（避免"永远亮着"的噪声）
      if (w.timer > 0) {
        const k = 1 - w.timer / Math.max(0.01, w.iv)
        g.fillStyle(UI.abyss, 0.7); g.fillRect(sx + 3, sy + sw - 6, sw - 6, 3)
        g.fillStyle(WEAPON_DEF[w.id].color, 0.95)
        g.fillRect(sx + 3, sy + sw - 6, (sw - 6) * k, 3)
      }
    }
    // 技能冷却
    const ready = this.burstTimer <= 0
    const k = ready ? 1 : 1 - this.burstTimer / O2.burstCd
    neonCircle(g, cx, sy + 22, 20, ready ? UI.cyan : UI.cyanDim, { width: 2, bloom: false })
    g.fillStyle(ready ? UI.cyan : UI.cyanDim, 0.25)
    g.fillCircle(cx, sy + 22, 20 * k)
    this.txt(ready ? '空格' : `${Math.ceil(this.burstTimer)}`, cx, sy + 22, '13px',
      ready ? TXT.cyber : TXT.mute, MONO, 'center')

    // 操作提示
    if (this.phase === 'wave') {
      this.txt('WASD 移动 · 武器自动开火 · 空格 排气爆发(-20 O₂)',
        24, this.scale.height - 92, '13px', TXT.mute, FONT)
    }

    // ⑥ 生存压迫指示（V6.3）
    //
    // 两种压迫都必须有**常驻显式指示**，玩家才能把「我为什么喘不上气」归因到正确的原因：
    //   低氧 → 红色心跳边框（越低频越快，直接映射"心跳"这个生理联想）
    //   热泉 → 底部上升箭头 + 提示（归因到环境，而不是"我操作有问题"）
    const lowPct = this.o2 / this.o2Max
    if (lowPct < 0.32 && (this.phase === 'wave' || this.phase === 'descending')) {
      const urgency = 1 - lowPct / 0.32                // 0→1 越低越急
      const rate = 2.2 + urgency * 3.4
      const beat = Math.max(0, Math.sin(this.t * rate * Math.PI))
      const a = (0.12 + 0.5 * beat) * (0.35 + urgency * 0.65)
      const bw2 = 10 + beat * 14
      neon(g, UI.danger, () => { g.strokeRect(bw2 / 2, bw2 / 2, W - bw2, this.scale.height - bw2) },
        { width: 3 + beat * 3, alpha: a, bloom: beat > 0.7 })
      this.txt('O₂ 告急', W / 2, 62, `${Math.round(16 + beat * 4)}px`,
        TXT.amber, FONT, 'center')
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
    if (this.phase === 'shop') this.drawShop(g)
    if (this.phase === 'decide') this.drawDecide(g)
    if (this.phase === 'result') this.drawResult(g)
  }

  // ---- 文字对象池：避免每帧 new Text 造成 GC 抖动 ----
  private hideTexts(): void {
    for (const t of this.txtPool) t.setVisible(false)
  }
  private txt(s: string, x: number, y: number, size: string, color: string,
              font: string, align: 'left' | 'center' | 'right' = 'left'): void {
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
  }

  // ==========================================================================
  // 通用热区
  // ==========================================================================
  private clearHits(): void {
    // 必须销毁锚点矩形：只清数组的话旧热区仍然 alive，
    // 会在下一波/下一局里响应已经看不见的点击（实测踩过同类坑）。
    for (const c of this.shopCards) c.rect.destroy()
    for (const b of this.decideBtns) b.rect.destroy()
    for (const b of this.resultBtns) b.rect.destroy()
    this.shopCards = []
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
  // 商店：波间三选一
  // ==========================================================================
  private pool: Upgrade[] = [
    // —— 器械卡（V6.3）——
    // 这三张是 Brotato 手感的核心：火力来源变多，但玩家操作**不变**（仍然只走位）。
    // 弓与枪的定位不重叠，所以拿到哪张都会明显改变手感。
    {
      id: 'w_gun', name: '脉冲机关枪', desc: '高频连射 · 单体',
      apply: s => s.addWeapon('gun'),
    },
    {
      id: 'w_torp', name: '追踪鱼雷', desc: '低频追踪 · 范围爆炸',
      apply: s => s.addWeapon('torpedo'),
    },
    {
      id: 'w_arc', name: '链式电弧', desc: '瞬发连锁 · 多目标',
      apply: s => s.addWeapon('arc'),
    },
    {
      id: 'w_all', name: '弹药改良', desc: '全部器械 +1 级',
      apply: s => s.levelAllWeapons(),
    },
    // —— 生存 / 机动 ——
    { id: 'speed', name: '增压推进', desc: '移速 +15%', apply: s => { s.speedMul *= 1.15 } },
    { id: 'pickup', name: '吸附鳍', desc: '拾取范围 +40%', apply: s => { s.pickupMul *= 1.4 } },
    {
      id: 'tank', name: '扩容气瓶', desc: '氧气上限 +20 并回满',
      apply: s => { s.o2Bonus += 20; s.o2Max = s.layer().o2Max + s.o2Bonus; s.o2 = s.o2Max },
    },
    { id: 'gill', name: '循环鳃', desc: '击杀额外回氧 +3', apply: s => { s.killO2 += 3 } },
  ]

  private offers: Upgrade[] = []
  private hoverCard = -1
  private hoverBtn = -1

  private openShop(): void {
    this.phase = 'shop'
    this.hoverCard = -1
    this.offers = Phaser.Utils.Array.Shuffle(this.pool.slice()).slice(0, 3)
    this.clearHits()
  }

  private drawShop(g: Phaser.GameObjects.Graphics): void {
    const W = this.scale.width, H = this.scale.height
    g.fillStyle(UI.abyss, 0.72); g.fillRect(0, 0, W, H)

    const cw = 220, ch = 240, gap = 24
    const total = cw * 3 + gap * 2
    const x0 = (W - total) / 2
    const y0 = H / 2 - ch / 2

    this.txt(`L${this.layerIdx + 1} ${this.layer().name} · 第 ${this.waveInLayer + 1} 波结束`,
      W / 2, y0 - 56, '18px', TXT.cyber, FONT, 'center')
    this.txt('按 1 / 2 / 3 或点击选择', W / 2, y0 - 28, '13px', TXT.mute, FONT, 'center')

    if (this.shopCards.length === 0) {
      for (let i = 0; i < this.offers.length; i++) {
        const up = this.offers[i]
        const x = x0 + i * (cw + gap), y = y0
        const idx = i
        const rect = this.addHoverHit(x + cw / 2, y + ch / 2, cw, ch,
          () => this.pickUpgrade(up),
          v => { this.hoverCard = v ? idx : (this.hoverCard === idx ? -1 : this.hoverCard) })
        this.shopCards.push({ x, y, w: cw, h: ch, up, rect })
      }
    }

    for (let i = 0; i < this.shopCards.length; i++) {
      const c = this.shopCards[i]
      const hov = this.hoverCard === i
      g.fillStyle(hov ? UI.panelHi : UI.panel, 0.94); g.fillRoundedRect(c.x, c.y, c.w, c.h, 12)
      // 悬停时描边加亮加粗——纯 Graphics 卡片没有自带 hover 态，必须手绘
      neon(g, hov ? UI.cyanHi : UI.cyan, () => { g.strokeRoundedRect(c.x, c.y, c.w, c.h, 12) },
        { width: hov ? 3 : 2, bloom: hov })
      this.txt(String(i + 1), c.x + 16, c.y + 14, '14px', TXT.mute, MONO)
      // 器械卡画真实图标，属性卡保留抽象环
      const wid = c.up.id.startsWith('w_') ? c.up.id.slice(2) : null
      if (wid === 'gun' || wid === 'torpedo' || wid === 'arc' || wid === 'sonar') {
        this.drawWeaponIcon(g, wid, c.x + c.w / 2, c.y + 44, 18)
      } else {
        neonCircle(g, c.x + c.w / 2, c.y + 44, 18, UI.cyan, { width: 2, bloom: false })
      }
      this.txt(c.up.name, c.x + c.w / 2, c.y + 90, '20px', TXT.cyber, FONT, 'center')
      this.txt(c.up.desc, c.x + c.w / 2, c.y + 128, '15px', TXT.main, FONT, 'center')
      // 已持有的器械卡标出「升级 Lv N→N+1」，否则玩家不知道买到的是新武器还是强化
      const held = wid && wid !== 'all' ? this.weapons.find(w => w.id === wid) : null
      if (held) {
        this.txt(`已持有 · Lv${held.lvl} → Lv${Math.min(5, held.lvl + 1)}`,
          c.x + c.w / 2, c.y + 162, '12px', TXT.amber, FONT, 'center')
      } else if (wid === 'all') {
        this.txt(`${this.weapons.length} 台器械同时 +1 级`,
          c.x + c.w / 2, c.y + 162, '12px', TXT.amber, FONT, 'center')
      }
    }
  }

  private pickUpgrade(up: Upgrade): void {
    if (this.phase !== 'shop') return
    up.apply(this)
    this.clearHits()
    // 注意是 startWave() 而不是 advance()：waveInLayer 已经在 advance 里加过了，
    // 再走 advance 会多跳一波。
    this.startWave()
  }

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
    this.o2Max = L.o2Max + this.o2Bonus
    this.o2 = Math.min(this.o2 - toll, this.o2Max)
    this.clearHits()
    this.enemies = []; this.bones = []; this.pulses = []; this.debris = []
    this.bullets = []; this.arcs = []; this.blasts = []   // 旧弹不能飘进新层
    this.sparks = []
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
    g.fillStyle(UI.abyss, 0.80); g.fillRect(0, 0, W, H)

    const pw = Math.min(720, W - 60)
    const ph = Math.min(420, H - 60)
    const x = (W - pw) / 2, y = (H - ph) / 2
    g.fillStyle(UI.panel, 0.96); g.fillRoundedRect(x, y, pw, ph, 14)
    neon(g, UI.cyanDim, () => { g.strokeRoundedRect(x, y, pw, ph, 14) }, { width: 1, alpha: 0.9, bloom: false })

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
    g.fillStyle(UI.abyss, 0.85); g.fillRect(0, 0, W, H)
    const pw = Math.min(500, W - 60), ph = 300
    const x = (W - pw) / 2, y = H / 2 - ph / 2
    g.fillStyle(UI.panel, 0.96); g.fillRoundedRect(x, y, pw, ph, 14)
    neon(g, this.win ? UI.cyan : UI.danger, () => { g.strokeRoundedRect(x, y, pw, ph, 14) }, { width: 2, bloom: false })

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

  private restart(): void {
    this.enemies = []; this.bones = []; this.pulses = []; this.debris = []
    this.sparks = []
    this.biomass = 0
    this.speedMul = 1; this.pickupMul = 1; this.killO2 = PLAYER.killO2
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
      pick: (i: number) => { if (this.offers[i]) this.pickUpgrade(this.offers[i]) },
      refill: () => { this.o2 = this.o2Max },
      hit: (i: number) => {
        const rs = (this as unknown as { __uiHitRoutes: { onClick: () => void }[] }).__uiHitRoutes ?? []
        if (rs[i]) rs[i].onClick()
      },
    }
  }
}
