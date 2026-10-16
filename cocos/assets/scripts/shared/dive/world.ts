// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/dive/world.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 潜水战斗循环 · 引擎无关模拟世界
 *
 * ---------------------------------------------------------------------------
 * 这是什么
 * ---------------------------------------------------------------------------
 * 把 `web/src/scenes/DiveScene.ts`（6530 行 Phaser 场景）里**与渲染无关**的部分
 * 抽成一个纯数据 + 纯逻辑的世界对象。两个引擎前端都只做两件事：
 *
 *     world.update(dt, input)                  ← 推进一帧
 *     for (const ev of world.drainEvents()) …  ← 消费事件做表现
 *
 * 然后把 `world` 上的字段（px/py/enemies/bones/o2/…）画出来。
 *
 * ---------------------------------------------------------------------------
 * 三条硬约束（为什么这么设计）
 * ---------------------------------------------------------------------------
 * ① **零引擎依赖**：不 import `cc` / Phaser / Vite。渲染概念（贴图对象、Graphics、
 *    相机、tween）一律不出现；`enemies[].tex` 只是一个**资源 key 字符串**。
 * ② **一切表现走事件**：原代码在 `hurt()` 里直接 `spawnShock/spawnSlash/sparks/floats`
 *    —— 这些全部改成 `emit({t:'hit'|'kill'|'float'|…})`。渲染层自己决定
 *    "一个 hit 事件 = 冲击波 + 击打痕 + 火花 + 飘字"。模拟域因此没有任何
 *    粒子池、没有 lifespan、没有绘制调用。
 * ③ **注入式 dt 与确定性 rng**：原代码用 `this.time.now` / `Math.random()`。
 *    这里 dt 由调用方给（内部 `min(dt, 50ms)` 兜底），随机数走 seed 化 RNG，
 *    于是"同一 seed 跑两遍世界线完全相同"——无头冒烟测试才能断言。
 *
 * ⚠️ 每帧调用顺序（`update`）与 `DiveScene.update` 1686-1821 **严格同序**，
 *    顺序本身就是手感的一部分（例如 `slewTurretAims` 必须在 `movePlayer` 之后、
 *    `autoFire` 之前，否则炮口朝向会滞后一帧）。
 */

import { UI } from '../theme'
import { SUBS } from '../subs'
import type { SubDef } from '../subs'
import type {
  Enemy, Bone, Pulse, Bullet, Echo, Acid, Mine, Lure, EnemyShot, Kind, Weapon, WeaponId,
  Stats, LayerDef, WaveShape, RelicId, SimEvent, InputState, UpgradeDef, ShopTarget,
  DamageCause,
} from './types'
import {
  O2, BONE_O2, PLAYER, WEAPON_DEF, STAT_CAP, NEW_STATS, RELIC_DEF, RELIC_SLOTS,
  LAYERS, LAYER_WAVES, SEAT_MOUNTS, HULL_H, SUB_D, MOUNT_BASE_R, TURRET_OUT,
  TURRET_SPIN, TURRET_OMEGA_IDLE, TURRET_OMEGA_TRACK, STREAK_MAX_LV,
  SEAT_SWAY_MAX, SEAT_SWAY_FOLLOW, SEAT_SWAY_DECAY,
  MAX_SEATS, BASE_SEATS, REROLL_BASE, REROLL_STEP, BONE, ENEMY_TEX, TEX_BASE_ROT, weaponFamily,
  spawnWeights,
} from './tables'
import { CARD_POOL } from './pool'
import { Rng, clamp, dist, wrapAngle } from './rng'
// 开局武器缺省值（`WorldOptions.weapon` 不传时用）。刻意与 `START_WEAPONS`
// 放同一个文件 —— "开局候选"与"默认开局"是同一件事的两面，分开放迟早会不一致。
import { DEFAULT_START_WEAPON } from './loadout'

export interface WorldOptions {
  /** 逻辑画布宽（Phaser 用 this.scale.width；Cocos 用设计分辨率宽） */
  w: number
  /** 逻辑画布高 */
  h: number
  /** 随机种子。同一 seed ⇒ 完全相同的世界线（无头测试用） */
  seed?: number
  /** 本局潜航器（默认灯艇） */
  sub?: SubDef
  /**
   * 开局第一个武器（V6.41）。缺省 = `DEFAULT_START_WEAPON`（机关枪）。
   * 由「出击准备」面板选定，见 `loadout.ts` 的 `START_WEAPONS`。
   */
  weapon?: WeaponId
  /** 商店卡池（默认完整卡池；测试里可传 `[]` 跳过商店） */
  pool?: UpgradeDef[]
  /**
   * 永久强化（meta）注入的三项加成。缺省 = 全 0（无 meta 的纯模拟）。
   * 见 `unlocks.ts` 的 `perkBonus()` —— 满级总增幅被红线锁死在"两个遗物"量级。
   */
  perk?: { rate?: number; o2Bonus?: number; pickup?: number }
}

/** 单帧最大步长（秒）—— 与 `DiveScene`: `Math.min(deltaMs, 50) / 1000` 一致 */
const MAX_DT = 0.05

// ---------------------------------------------------------------------------
// V6.46 机制型武器的配平常量
// ---------------------------------------------------------------------------
// 集中放在这里而不是散在各武器分支里：这几条数**互相牵制**（雷的触发半径必须
// 大于敌人半径、连锁半径必须大于爆炸半径才有意义），放一起才看得见关系。

/**
 * 气泡雷：布防时长（s）／同时在场上限／存活时长（s）／触发半径／爆炸半径。
 *
 * - `arm` 0.4s：**不加这个，玩家一布雷就自己踩上去** —— 每次都在自己脚下炸，
 *   武器直接废掉。0.4s 是"走出爆炸半径所需时间"的下界（玩家移速约 200px/s，
 *   34px 触发半径 ⇒ 0.17s，留一倍余量）。
 * - `cap` 6 枚：不加上限的话 0.55s 一颗、活 12s ⇒ 稳态 21 枚，满屏是雷，
 *   退化成"地毯式轰炸"，玩家不需要走位也能赢。
 * - `life` 12s：比"一个波次的长度"短，保证场上雷是**这一波布的**。
 */
const MINE_ARM = 0.4
const MINE_CAP = 6
const MINE_LIFE = 12
/**
 * **引信时长（s）**（V6.62，取代 `MINE_TRIG 34` 的踩触发）。
 * 1.8s = 一个"看得见、算得准、又够短"的预判窗口：典型敌人速度 68 ⇒ 1.8s 走 122px，
 * 等于"一颗雷管住半屏外的一条线"。再长就变成"随机埋雷"，再短玩家来不及算。
 */
const MINE_FUSE = 1.8
/**
 * 爆炸半径 88 → **110**（V6.62）。
 * 定时雷的价值全在**预判** —— 半径太小则"算准了也炸不到"，预判无意义。
 * ⚠️ 连锁半径 `MINE_CHAIN_R` 必须同步 ≥ 新半径（否则相邻雷不互引）。
 */
const MINE_R = 110
/** 连锁雷的连锁半径（118 = 略大于爆炸半径 110，相邻两枚必然互引） */
const MINE_CHAIN_R = 118
/** 连锁递归深度上限 —— 同 `explode` 的共鸣腔限深理由：不限深会递归到栈溢出 */
const MINE_CHAIN_DEPTH = 4
/** 氧气雷：每炸到一个敌人回氧／**单次爆炸回氧总量上限** */
const MINE_O2_PER = 2.5
const MINE_O2_CAP = 10

/** 网：命中半径（形状参数，**未随 V6.62 改动**） */
const NET_R = 46
/**
 * **定身时长（s）**（V6.62，取代 `NET_SLOW_T 2.0` 的减速）。
 * 1.2s = "完全不动"的时长：够玩家把火力倾泻上去，又不至于把敌人钉死在那。
 */
const NET_ROOT_T = 1.2
/**
 * **定身免疫窗口（s）**（V6.62）。⚠️ **配平红线，缺这条直接无敌，不能省。**
 *
 * 网 `iv` ≈ 1.1s + 弹道飞行 ⇒ 若无免疫，单体被定时间 ≥40%。
 * 一屏 150 敌里定住 40 只不动 = Bullet Heaven 变靶场。
 * 3.0s = "被定一次后，至少要过 2 个网周期才能再被定"，把"控场"和"牢笼"分开。
 */
const NET_ROOT_IMMUNE = 3.0
/** 电网：定身更久 + 灼烧 */
const NET_EL_ROOT_T = 1.6
const NET_EL_BURN_DPS = 6
const NET_EL_BURN_T = 3.0
/** 驯化网：内讧时长（s）。与诱饵的吸引时长分开 —— 两者是不同机制 */
const NET_CHARM_T = 4.0

// ---------------------------------------------------------------------------
// V6.62 敌人区分度（第 4 类重甲）与战斗惊喜点（精英 / 连杀骨雨）
// ---------------------------------------------------------------------------

/**
 * **重甲**（计划书点名，V6.23 起标红三轮）。
 *
 * 存在的唯一理由是**逼玩家换武器** —— 没有护甲的重甲只是"血厚的杂兵"。
 * 三条一起构成它与其它类的区分度：**血厚（6×）+ 慢（0.4×）+ 不索敌（直线漂移）**。
 * 最后一条最关键：它不追你 ⇒ **你得主动去打它**，行为语汇与另外三类完全不同。
 */
const ARMOR_HP_MUL = 6
const ARMOR_SPD_MUL = 0.4
const ARMOR_R = 30
/** 护甲减伤比例。**爆炸 / 穿透无视它** —— 这是逼玩家换武器的唯一手段 */
const ARMOR_REDUCE = 0.6

/**
 * **盘旋猎手**（V6.79）：不正面冲，**切向绕圈 + 半径收缩**（螺旋），贴身才咬。
 *
 * 与另外四类的区分全在**行为**：swarm/dash 直线、drift 脉冲直漂、armor 不理你巡逻，
 * 而它**绕着来** ⇒ **直线后退对它无效**，玩家必须横向位移 / 绕桩。
 * 区分度落在行为上、不落在颜色上 —— 这条是 V6.49 §4.1 立下的。
 */
/** 停止收缩的半径（px）：再近就贴脸抖动，而贴身后切向速度已足够读出"缠住" */
const ORBIT_R_MIN = 46
/** 径向收缩系数（× speed）。0 = 纯绕圈永不近身；1 = 直冲。0.45 = 明显在收，但第一眼仍是"绕" */
const ORBIT_SHRINK = 0.45

/**
 * **缠索**（V6.79b）：盘旋猎手的**专属压力** —— 本作第一个"作用于玩家**操作能力**"的敌人。
 * 此前所有敌人都只作用于玩家的**血量 / 氧量**（本作"氧气就是血条"）。
 *
 * 把压力轴摆开才看得出它填的格子是空的：
 *   直接扣氧（游群 / 冲刺体 / 漂移水母）· 逼你换武器（甲壳重甲）·
 *   改你的**位置**（鮟鱇女王张口时把你拽进去）· **改你的操作能力（空）**。
 *
 * ⚠️ 与鮟鱇女王必须读成两回事：**它"拽你"（改位置），索"压你"（改速度、不挪你）**。
 *    判据：被缠期间玩家位置**不被索单独改变**，只有你自己的输入决定你往哪走。
 *
 * ---
 * ★ 三条配平红线（缺一条就崩）
 * ① **同时只有一条索** —— 一屏最多 150 敌，几只一起缠 = 玩家被钉死。
 *    实现方式：`tetherSrc` 是**单个字段**，不可能是多条。
 * ② **必须有免疫窗** —— 与网的 `NET_ROOT_IMMUNE` 同一条理由：没有它，刚挣开又被咬上 = 永久减速。
 * ③ **它不在"锚住"距离上扣氧** —— 咬住半径 70 > 接触半径 `PLAYER.r + e.r` = 42
 *    ⇒ 被索住 ≠ 被贴脸打，两条压力天然不叠加（**不需要额外写排除**，见 `updateTether` 的注释）。
 */
/** 咬住半径（px）。★ 必须 > `ORBIT_R_MIN`(46)，否则它永远够不着玩家 */
const TETHER_R = 70
/** 被缠住时的移速倍率。**只乘进 `movePlayer` 的 `spdMul`** —— 不压射速、不动氧气、不扣氧 */
const TETHER_SLOW = 0.45
/** 朝**背离**它的方向累计移动满这么久 ⇒ 挣断（220px/s × 0.7 ≈ 154px，等于"游出去一个身位"） */
const BREAK_T = 0.7
/** 挣断后的免疫窗（s）。见红线 ② */
const TETHER_IMMUNE = 2.5
/**
 * 被拉开到 `TETHER_R ×` 这个倍数以外 ⇒ 自动松。
 *
 * ⚠️ **2.4 不是随手取的**：设计稿原定 1.6（=112px），但按 220×0.45=99px/s 往外游，
 *    **0.42s 就会撞上这条**，于是"往外游 0.7s 挣断"那条主规则**变成死代码**。
 *    2.4 ⇒ 168px ⇒ 需要 0.99s > 0.7s，主规则先触发；这条降级成**安全网**
 *    （防的是"被爆炸击退把索的来源甩到很远"这类异常状态）。
 */
const TETHER_SLIP_MUL = 2.4
/** "在往外游"的判定阈值：移动方向与"背离它"的余弦。0.35 ≈ 70° 以内算数 —— 贴着它转圈不算 */
const TETHER_AWAY_DOT = 0.35

/**
 * **精英**（V6.62 §5-A）：每波随机 1–2 只。
 * HP ×3 · 掉落 ×4 · 必掉一个「囊」。
 * 复用"发光 = 值得"的既读法（与鱼骨同一套），玩家不用学新符号。
 */
const ELITE_HP_MUL = 3
const ELITE_DROP_MUL = 4
const ELITE_MIN = 1
const ELITE_MAX = 2

// ---------------------------------------------------------------------------
// V6.82 第一批新生物（计划书 §5.4「20 种生物图鉴」）
//
// ★ 五种各带来**一个新的玩家动作**，不许只是"换个颜色的杂兵"（V6.49 §4.1）：
//   ① splitter 裂体   → "别用单发高伤去收残血"（击杀会分裂）
//   ② bulwark 盾鳐    → "绕到侧后 / 换爆炸·穿透"（正面免疫）
//   ③ brood   孵卵囊  → "先点掉后排"（不点 = 场上小怪无限增）
//   ④ kamikaze 自爆螺 → "在它贴上来之前处理 / 拉开"（贴脸站桩被罚）
//   ⑤ herder  牧群者  → "先杀 buff 源"（不杀 = 全场提速）
//
// ⚠️ 三条配平红线：
//   ① **新生物一律不进 L1**（`mix` 只在 L2–L5）：教学层不给机制，与 drift/armor 同规。
//   ② **L5 不给 self-destruct**：那一层已经是"上限被压 + 耗氧 3.0/s"，
//      再叠自爆就是"数值死刑"（§3.4 的 2026-10-11 修正写过同一条）。
//   ③ **自爆 / 分裂出来的单位不给击杀收益**（不掉骨、不回氧）——
//      否则"让它炸"变成刷氧手段，与氧气三道硬约束打架。
// ---------------------------------------------------------------------------

/** 裂体：本体血量（介于游群 30 与重甲之间），死亡时裂成 `SHARD_N` 只幼体 */
const SPLITTER_HP = 46
const SPLITTER_SPD = 62
const SPLITTER_R = 21
/** 裂出来的只数。★ 必须是**偶数**：对称分裂读作"裂开"，奇数读作"掉了半只" */
const SHARD_N = 2
/** 幼体继承本体的血量比例（0.35 = 一只幼体 ≈ 1/3 条裂体）。总血量增加 = 惩罚"收残血" */
const SHARD_HP_MUL = 0.35
/** 幼体体型比例与速度倍率：更小、更快（"幼"要一眼看出来） */
const SHARD_R_MUL = 0.55
const SHARD_SPD_MUL = 1.7

/** 盾鳐：正面盾半角（弧度）。120° 全角 ⇒ 玩家有 240° 的安全弧，绕后有明确收益 */
const BULWARK_ARC = (120 * Math.PI) / 180 / 2
/** 正面减伤比例。0.8 而不是 1.0 —— 完全免疫会让"正面硬打"彻底无解，只剩"绕后"一条 */
const BULWARK_CUT = 0.8
/**
 * 盾鳐的**转向角速度**（rad/s）。
 *
 * ★ 这个数字是"方向性免疫"能不能成立的全部 —— 见 `updateEnemies` 的 bulwark 分支。
 * 取 0.9 的依据：玩家移速 220px/s，绕一圈半径 150px ⇒ 角速度 1.47 rad/s。
 * 只要盾的转速明显低于它，**横向绕圈就能绕到侧后**；再低（<0.6）它就僵得像木桩，
 * 再高（>1.3）就追得上玩家、绕后失效。
 */
const BULWARK_TURN = 0.9
const BULWARK_HP = 90
const BULWARK_SPD = 52
const BULWARK_R = 25

/** 孵卵囊：几乎不动（`spd = 14`），周期性吐幼体 */
const BROOD_HP = 70
const BROOD_SPD = 14
const BROOD_R = 26
/** 产卵间隔（s）。3.2s × 4 波 ≈ 每只囊一局能生 6–10 只 —— 不点它就会滚起来 */
const BROOD_HATCH_T = 3.2
/** 每胎只数 */
const BROOD_LITTER = 2
/**
 * 场上**存活上限**（所有孵卵囊合计）。★ 防的是"滚雪球"：
 * 没有它，第 4 波刷 8 只囊 = 每秒吐 5 只 ⇒ 敌人数指数发散，直接撞 `ENEMY_CAP` 后
 * 帧率崩掉（而且玩家看不清发生了什么）。
 */
const BROOD_MAX_ALIVE = 26
/** 出生后第一次产卵的延迟（s）：给它一点"刚孵化"的读图时间，不是立刻喷 */
const BROOD_FIRST_DELAY = 1.6

/** 自爆螺：贴到这个距离就点火 */
const KAMI_ARM_R = 46
/** 引信时长（s）：鼓胀 + 变红 = 预警窗。0.45 够玩家做一个侧移 */
const KAMI_FUSE_T = 0.45
/** 自爆半径与伤害。半径 78 略大于 `PLAYER.r + 螺 r`（42），所以"贴着也躲不掉" */
const KAMI_BLAST_R = 78
const KAMI_BLAST_DMG = 14
const KAMI_HP = 34
const KAMI_SPD = 88
const KAMI_R = 17
/** 自爆范围内对**玩家**的伤害（不走 `hurt`——那是"敌人受伤"的入口） */
const KAMI_PLAYER_DMG = 26

/** 牧群者：不追玩家，给半径内的小怪提速并把它们朝玩家方向推 */
const HERDER_HP = 120
const HERDER_SPD = 40
const HERDER_R = 24
/** 影响半径（px） */
const HERDER_RANGE = 150
/** 受益小怪的移速倍率 */
const HERDER_SPD_MUL = 1.35
/**
 * 受益的 kind。**只给"直线压上"的那几类**——给 dash / armor 提速没有意义：
 * dash 有自己的冲锋节奏、armor 根本不索敌，给它们加 buff 是数值噪声。
 */
const HERDER_TARGETS: Kind[] = ['swarm', 'shard', 'splitter']

// ---------------------------------------------------------------------------
// V6.83 第二批（7 种，全部零新子系统）
//   同一张 20 种总表：`docs/生物谱系_20种_V6.82.md` §3
//   ⚠️ 层位**不完全按规格**：`mimic` / `bloom` 从 L4–L5 下放到 L3 —— 见 `tables.ts`
//      的 LAYERS 注释（L4 到达率 8% / L5 是 0%，放那儿等于没做）。
// ---------------------------------------------------------------------------

/** 水母：缓慢漂移 + 周期放电 */
const JELLY_HP = 60
const JELLY_SPD = 30
const JELLY_R = 22
/** 放电周期（s）与其中的**前摇**时长：`charge` 那 1.6s 是它能被躲开的全部理由 */
const JELLY_CYCLE = 2.6
const JELLY_WINDUP = 1.6
/** 放电半径（px）与伤害。半径略大于玩家体积 ⇒ 站着不动必吃 */
const JELLY_ZAP_R = 70
const JELLY_ZAP_DMG = 16

/** 拟态：静止伪装，进 `MIMIC_ARM_R` 才激活 */
const MIMIC_HP = 58
const MIMIC_SPD = 120
const MIMIC_R = 21
/**
 * 激活半径。160 的依据：玩家移速 220 ⇒ 全速掠过只需 0.73s，
 * **不冲刺来得及、贴脸才发现就晚了** —— 它要惩罚的是"没注意地上的碎屑"，
 * 不是"没看见一只鱼在追你"。（撞上 `dash` 的 240 蓄力距离也不会互相盖住：
 * 那个是"已经在追你"，这个是"你还没发现它"。）
 */
const MIMIC_ARM_R = 160

/** 枪鱼：屏外直线穿场，**不追踪**（与 dash 的"追你"是两套压力语汇） */
const LANCER_HP = 40
const LANCER_SPD = 300
const LANCER_R = 18
/** 最多穿几趟（对称来回）。3 趟 = 左右左，够形成"等它走完再过去"的节奏 */
const LANCER_PASSES = 3

/** 潜沙者：下潜 → 冒出 → 突进 */
const BURROW_HP = 66
const BURROW_SPD = 90
const BURROW_R = 22
/** 一个循环里三段的时长（s） */
const BURROW_DIVE_T = 1.2
const BURROW_EMERGE_T = 0.45
const BURROW_DASH_T = 0.8
/** 冒出时离玩家的距离（px）—— 太近读不出"它钻出来了"，太远又够不着 */
const BURROW_EMERGE_DIST = 150
/**
 * 一个完整循环 3.5s = 地面 1.05 + 下潜 1.2 + 冒出 0.45 + 突进 0.8。
 * ⚠️ 四个数**必须正好相加**，否则循环会漂（`t` 是分段重置的，不靠总时长兜）。
 */
const BURROW_SURFACE_T = 1.05
/**
 * 突进速度倍率（× 基础 90 = **198 px/s**）。
 * 取 198 的依据：**必须低于玩家 220** —— 否则"钻到你脚下再突进"是无解的一次判定，
 * 玩家做什么都没用；只要略慢于玩家，"冒出来 → 横移"就是一个可执行的解。
 */
const BURROW_DASH_MUL = 2.2

/** 孢囊：慢速靠近，**死亡留下酸云** */
const BLOOM_HP = 80
const BLOOM_SPD = 46
const BLOOM_R = 24
const BLOOM_CLOUD_R = 46
const BLOOM_CLOUD_T = 3.0
const BLOOM_CLOUD_DPS = 6

/** 吸血蛭：接触把玩家的氧转成自己的血，**不造成常规接触伤害** */
const LEECH_HP = 50
const LEECH_SPD = 76
const LEECH_R = 19
/** 每秒吸多少氧（`LEECH_HEAL_PER_O2` 是"每 1 氧换几滴血"） */
const LEECH_DRAIN = 4
const LEECH_HEAL_PER_O2 = 2

/** 摆尾鱼：接近时正弦横摆 */
const DARTER_HP = 42
const DARTER_SPD = 104
const DARTER_R = 19
/** 横摆振幅（px）与频率（Hz）。90px 的依据：接触半径才 39 ⇒ 摆动幅度必须是它的 2 倍以上，
 *  "瞄着它打"才会明显打空；再大（>140）就变成"绕着圈飞"，读不出是摆动 */
const DARTER_AMP = 90
const DARTER_HZ = 2.2

// ---------------------------------------------------------------------------
// V6.83 敌方投射物（`spitter` 专用；这是**新子系统**，不是一个新分支）
//   详细设计见 `types.ts` 的 `EnemyShot`
// ---------------------------------------------------------------------------

/** 喷酸鱼：**保持距离**的远程 */
const SPITTER_HP = 44
const SPITTER_SPD = 58
const SPITTER_R = 20
/**
 * 交战带（px）：保持在这个区间里开火。
 * 220–300 的依据 —— 玩家射程 `PLAYER.range = 420`，所以它**仍在射程内**
 * （不会变成"打不到的敌人"），但已经远到"要么冲进去、要么躲弹"的抉择成立。
 * 内边界 220 = 玩家的 1 倍身位多一点：再近它就退了，读作"它怕你靠近"。
 */
const SPITTER_NEAR = 220
const SPITTER_FAR = 300
/** 应急后撤距离：进了这个圈就**只顾后退、不再开火**（"贴脸 = 打断它的输出"） */
const SPITTER_PANIC = 160
/** 开火间隔（s） */
const SPITTER_IV = 2.2
/** 吐弹前摇（s）：张嘴蓄力的预警 —— 与 dash 的 charge 同一套"先预警再发生"的语汇 */
const SPITTER_WINDUP = 0.4

/** 酸弹：直线飞，到点爆开 */
const ESPEED = 260
/** 寿命（s）⇒ 射程 260 × 1.2 = **312px**。比玩家射程短，所以"它打得到你，你多半也打得到它" */
const ELIFE = 1.2
const EDMG = 9
const ER = 9
/** 命中半径（与玩家碰撞）—— 比视觉小一点，给"擦过去"留余地 */
const EHIT_R = 13
/** 爆开半径与爆开伤害（范围小、伤害略高于直击，逼玩家别贴着炸点站） */
const EBLAST_R = 34
const EBLAST_DMG = 12

// ---------------------------------------------------------------------------
// V6.83 四条"机制化"卡的运行时参数
// ---------------------------------------------------------------------------

/**
 * **循环泵**（`s_regen`）：回氧与缺氧程度的换算系数。
 *
 * 曲线 = `regen × REGEN_MISS_K × miss`，`miss = 1 − o2/o2Max`。
 * ⇒ 满氧时回 0、空氧时回 `2.5 × regen`。
 *
 * ★ 2.5 是**按平均值反推**的：要让"平均回氧量"与改之前的恒定 +0.4/s 相当，
 *   需要 `K = 1 / E[miss]`；而玩家实际大部分时间在 50%~75% 氧之间
 *   ⇒ `E[miss] ≈ 0.4` ⇒ `K ≈ 2.5`。
 * ⚠️ **这个 2.5 依赖"玩家平均氧气水平"这个体感假设，是四条里最需要实机校准的一个。**
 *    偏高 ⇒ 中后期氧气永远满（把 `drainOxygen` 的意义架空）；
 *    偏低 ⇒ 这张卡变成"没买"。
 */
const REGEN_MISS_K = 2.5

/**
 * **流体规避**（`s_dodge`）：判定"静止"的门槛（s）。
 *
 * 取 1.2s 的依据：玩家 220px/s ⇒ 1.2 秒能跑 264px（大半个屏幕宽）。
 * 门槛再低（<0.6）就变成"每次微调都白拿闪避"，失去了"停下来是一个决定"的意思；
 * 再高（>2.0）在与热泉带对抗时基本不可能达成。
 */
const STILL_T = 1.2

/**
 * **先规格，后出图**的落点（本专家的工作方式）：
 * 五种的**形状语汇**（给插画岗的交接）。
 *
 * | kind | 剪影 | 读数 |
 * |---|---|---|
 * | splitter | 纺锤 + **中段一道裂口** | "它要裂开" |
 * | shard | 小纺锤，**无眼** | "幼体" |
 * | bulwark | 宽扁，**前缘一块厚甲** | "正面硬" |
 * | brood | 圆鼓，**表面一排卵孔** | "会生" |
 * | kamikaze | 短粗圆壳，**背部一道红缝** | "要炸" |
 * | herder | 细长，**两侧一排须** | "在指挥" |
 *
 * ### 配色口径（★ 与"加一个敌人就新开一支色"相反）
 *
 * `theme.ts` 的前七支色是**语义槽**，不是"每类一个"：
 * `jade` 常见生物 · `magenta` 稀有/危险 · `amber` 资源 · `violet` 深渊/Boss ·
 * `steel` 甲壳/金属 · `lime` 软体 · `danger` 致命预警（全场唯一纯红）。
 *
 * ⇒ 新生物**按语义归族取色，不新开槽**；**种类靠剪影 + 行为**（V6.49 §4.1 立下的）。
 * 加一支色要动 `theme.ts` 的整个语义表，代价远大于收益 —— 而"颜色认种类"本来
 * 就不是本作的读法（满屏 150 只时，颜色分不出 30 种，剪影才能）。
 *
 * | kind | 色 | 归族理由 |
 * |---|---|---|
 * | splitter | `jade` | 常见生物 |
 * | shard | `jadeHi` | 同族幼体 ⇒ 用同色**高亮版**（"这是刚才那只的碎片"） |
 * | bulwark | `steel` | 甲壳 / 金属（与重甲同族，差别全在**方向性**） |
 * | brood | `lime` | 软体 / 会动的活物（与盘旋猎手同族：都不是鱼形） |
 * | kamikaze | `magenta` | 危险生物（"自爆"是全场最危险的行为） |
 * | herder | `jade` | 常见生物（它的"新"在**指挥**这个行为，不在配色） |
 */

/**
 * 各 `Kind` 的**基础数值**（V6.82）。
 *
 * ⚠️ 收成一张表而不是散在 `spawnEnemy` 的四条三目链里：V6.82 之前
 *    `hp / spd / r / color` 各是一条 `kind === 'x' ? … : …` 的链，
 *    加一种生物要同时改四行、且**看不出漏了哪一行**（漏了会静默落进默认分支）。
 *    表的形式让"加一种生物"变成**只加一行**，漏了 TS 直接报 missing property。
 *
 * ⚠️ `armor` 的 `hp / spd` 是**基础值**，还要在 `spawnEnemy` 里乘 `ARMOR_HP_MUL` /
 *    `ARMOR_SPD_MUL` —— 那些倍率同时被别的分支读（如精英判定），不能并进来。
 * ⚠️ `boss` 这一行只是为了让 `Record<Kind, …>` 齐全；实际数值由 `spawnBoss` 覆盖。
 */
const ENEMY_BASE: Record<Kind, { hp: number; spd: number; r: number; color: number }> = {
  swarm:    { hp: 30,           spd: 68,  r: 19,       color: UI.jade },
  dash:     { hp: 52,           spd: 96,  r: 25,       color: UI.magenta },
  drift:    { hp: 110,          spd: 42,  r: 34,       color: UI.amber },
  armor:    { hp: 40,           spd: 68,  r: ARMOR_R,  color: UI.steel },
  orbit:    { hp: 38,           spd: 74,  r: 22,       color: UI.lime },
  // ---- V6.82 第一批 ----
  splitter: { hp: SPLITTER_HP,  spd: SPLITTER_SPD, r: SPLITTER_R, color: UI.jade },
  shard:    { hp: 14,           spd: 104, r: 12,       color: UI.jadeHi },
  bulwark:  { hp: BULWARK_HP,   spd: BULWARK_SPD,  r: BULWARK_R,  color: UI.steel },
  brood:    { hp: BROOD_HP,     spd: BROOD_SPD,    r: BROOD_R,    color: UI.lime },
  kamikaze: { hp: KAMI_HP,      spd: KAMI_SPD,     r: KAMI_R,     color: UI.magenta },
  herder:   { hp: HERDER_HP,    spd: HERDER_SPD,   r: HERDER_R,   color: UI.jade },
  // ---- V6.83 第二批（色按语义归族，**不新开槽**；区分靠剪影 + 行为）----
  jelly:    { hp: JELLY_HP,     spd: JELLY_SPD,    r: JELLY_R,    color: UI.lime },
  mimic:    { hp: MIMIC_HP,     spd: MIMIC_SPD,    r: MIMIC_R,    color: UI.steel },
  lancer:   { hp: LANCER_HP,    spd: LANCER_SPD,   r: LANCER_R,   color: UI.magenta },
  burrower: { hp: BURROW_HP,    spd: BURROW_SPD,   r: BURROW_R,   color: UI.jade },
  bloom:    { hp: BLOOM_HP,     spd: BLOOM_SPD,    r: BLOOM_R,    color: UI.lime },
  leech:    { hp: LEECH_HP,     spd: LEECH_SPD,    r: LEECH_R,    color: UI.magenta },
  darter:   { hp: DARTER_HP,    spd: DARTER_SPD,   r: DARTER_R,   color: UI.jade },
  spitter:  { hp: SPITTER_HP,   spd: SPITTER_SPD,  r: SPITTER_R,  color: UI.magenta },
  boss:     { hp: 900,          spd: 46,  r: 52,       color: UI.violet },
}

/**
 * **连杀骨雨**（V6.62 §5-B）：`COMBO_WINDOW` 秒内连杀 ≥ `COMBO_N` 只 ⇒ 结算一次骨雨。
 * 奖励"**打得好**"而不是"走得远"：把爽感从位置轴挪到操作轴。
 */
const COMBO_WINDOW = 3.0
const COMBO_N = 8
/** 骨雨块数区间（额外掉落，绕过 dropCap） */
const COMBO_BONE0 = 6
const COMBO_BONE1 = 10
/** 骨雨落点相对玩家的散布半径 */
const COMBO_SPREAD = 150

/**
 * **鮟鱇女王**（V6.62 §4.2）—— 诱捕型 Boss。
 *
 * 与守望者的区分全在**行为语汇**：守望者靠"逼近"施压，它靠"在远处等你来"。
 * 三段：进入 `LURE_R` ⇒ 张口**诱饵灯全亮**（`FLARE_T` 的预警窗口，同时**停住不动**）
 * ⇒ 咬合（还在 `BITE_R` 内就吃重击）。
 *
 * ⚠️ 诱捕要成立，"光"必须**真的能把玩家拽过去** —— 否则玩家站远点打就完胜，
 *    这个 Boss 就退化成"一个不动的大血包"。所以张口期有一道**朝向它的水流**
 *    （`PULL`）：你不主动往外游，就会被慢慢带进咬合半径。这才是"忍住别贪"。
 */
const ANGLER_LURE_R = 320
const ANGLER_FLARE_T = 1.6
const ANGLER_BITE_R = 190
const ANGLER_BITE_DMG = 26
/** 诱饵光的**牵引加速度**（px/s²）。玩家移速约 200 ⇒ 130 可抗衡但费力 */
const ANGLER_PULL = 130

/**
 * **游群的扑击前摇**（V6.80）。
 * 用户 2026-10-15：「鱼准备撞击我方的时候 有一个前摇冲刺动作最好」。
 *
 * 现状：只有 `dash`（冲刺体）有前摇（`chase → charge 0.5s → dash 460px/s → rest`）。
 *   而 `swarm` 是**数量最多**的一类，却一路直冲、**零兆** ——
 *   玩家被撞了也不知道"刚才那条鱼是要撞我"，挨打读起来像"莫名掉氧"。
 *   这里给 swarm 补一个**轻量**的扑击循环（与 dash 同构，但更短、更近、有冷却）。
 *
 * ★ 三条克制（不克制的后果写在每条后面）：
 *   ① **只在贴脸前触发**（`SWARM_LUNGE_R = 130`）—— 触发距离一大，会变成
 *      "一屏鱼集体停在半路发呆"。
 *   ② **有冷却**（`SWARM_REST_T = 1.2`）—— 没有冷却，一群鱼会反复原地抽搐，
 *      比原来的直冲**更**难看。
 *   ③ **蓄力不位移，但冲刺速度照乘 `slow`**（同 `dash`）—— 否则
 *      "网住了但一个扑击就窜到脸上"，控场武器当场白给（`dash` 分支里那条注释同理）。
 *
 * ⚠️ 蓄力期**冻结位移**是刻意的：**"停下 = 要冲了"** 是这一整套前摇唯一的读法；
 *    把位移写进蓄力，玩家的闪避窗口就没了，前摇也退回成装饰。
 */
const SWARM_LUNGE_R = 130
const SWARM_CHARGE_T = 0.30
/** 扑击速度倍率（× `e.speed`）。必须 > 1，否则"顿一下再同样速度"读不出是扑击 */
const SWARM_DASH_MUL = 1.75
const SWARM_DASH_T = 0.26
const SWARM_REST_T = 1.2

/**
 * 鮟鱇女王的**几何参数**，导出给渲染层画预警圈。
 * ⚠️ 只导出几何（半径），**不导出伤害 / 时长** —— 那些是玩法数值，
 *    留在本文件里，避免视图层读到数值后做出与模拟不一致的表现。
 */
export const ANGLER_GEOM = { lureR: ANGLER_LURE_R, biteR: ANGLER_BITE_R }

/** 内讧撕咬：单次伤害／节流（s）。10 伤 / 0.5s = 20 dps，4s 能咬死 1–2 只游群 */
const CHARM_BITE = 10

/** 诱饵：吸引半径／存活时长（s）／爆炸诱饵的自爆半径 */
const LURE_R = 130
const LURE_LIFE = 5.0
const LURE_BOOM_R = 120
/** 光墙：一次三个，间距 / 各自的吸引半径（比单诱饵小 —— 三个叠加会过强） */
const LURE_WALL_GAP = 70
const LURE_WALL_R = 90

export class DiveWorld implements ShopTarget {
  // ---- 画布 ----
  readonly W: number
  readonly H: number

  private rng: Rng
  /** 本帧产生的事件队列（渲染层 drain 后清空） */
  private events: SimEvent[] = []

  // ---- 玩家状态 ----
  px: number
  py: number
  o2 = O2.max
  o2Max = O2.max
  biomass = 0
  /** 朝向（弧度）：艇身朝移动方向，静止时保持上一次 */
  aim = 0
  /**
   * 炮圈**摆动角**（弧度）。2026-10-13 新增。
   * 阻尼跟随航向的**增量**、限幅 ±`SEAT_SWAY_MAX`：转向时 6 座炮略微滞后偏一点，
   * 停转后弹簧回中。**与 `seatPos()` 同源** ⇒ 炮位、炮口闪光、子弹出生点三者一致，弹道不劈叉。
   */
  sway = 0
  /** 上一帧航向（仅用于算摆动增量，绕到最短弧） */
  private prevAim = 0
  burstTimer = 0
  st: Stats = NEW_STATS()
  sub: SubDef
  /** 撞击伤害的节流计时（刺鳐） */
  ramT = 0
  /**
   * 本轮 `updateEnemies` 里**已经被牧群者推过**的小怪（V6.82）。
   *
   * ⚠️ 必须是**每帧清空的临时集合**，不是持久状态：它的唯一作用是"同一帧别叠加两次"。
   *    写成持久状态会变成"这只小怪一辈子只吃一次 buff"，与设计意图完全相反。
   */
  private readonly herded = new Set<Enemy>()
  /**
   * **待落地的幼体队列**（V6.82，裂体分裂）。
   *
   * 为什么不在 `tryKill` 里直接 push：`tryKill` 可能在遍历 `this.enemies` 的过程中
   * 被调用（`updateEnemies` 的灼烧 tick、`updateBullets`、`explode`）。
   * 在遍历中途改被遍历的数组，新元素会被**同一帧再遍历一次** —— 行为不明确。
   * ⇒ 排队，帧末 `flushShards()` 统一落地。
   */
  private readonly pendingShards: Array<{ x: number; y: number; hpScale: number; spd: number; spread: number }> = []
  relics: RelicId[] = []
  /** 连续未受击时长（「洋流鳍」） */
  noHitT = 0
  /** 受击后闪避加成剩余时长（「静默装甲」） */
  plateT = 0
  /**
   * **连续静止时长**（s）。`s_dodge` 流体规避的判定依据。
   * 每帧由 `movePlayer` 维护：有输入归零、无输入累加。
   * ⚠️ 它是**世界状态**而不是 `Stats`（Stats 只存卡的数值），与 `plateT`/`noHitT` 同类。
   */
  stillT = 0
  hurtFlash = 0
  hurtDirX = 0
  hurtDirY = 0
  hurtDirT = 0
  /** 氧气**显示值**，每帧向真实 o2 缓动（HUD 数字连续滚动） */
  o2Shown = O2.max
  moving = false
  /** 本帧受到的热泉上升推力（HUD 提示用） */
  vpPush = 0
  /** 本层暗流强度（HUD 提示用，0 = 无） */
  vpCur = 0
  /** 「涌流」层的固定入场边（0=上 1=右 2=下 3=左），整层不变 */
  surgeSide = 0
  /** 层入场卡的剩余显示时长（秒） */
  layerCardT = 0

  // ---- 实体池（模拟域） ----
  enemies: Enemy[] = []
  bones: Bone[] = []
  pulses: Pulse[] = []
  bullets: Bullet[] = []
  echoes: Echo[] = []
  acids: Acid[] = []
  /** V6.46 气泡雷：玩家脚下布下的雷。**唯一不索敌**的实体 */
  mines: Mine[] = []
  /**
   * **敌方投射物池**（V6.83）。见 `types.ts` 的 `EnemyShot`。
   *
   * ⚠️ 与玩家的 `bullets` 是**两个池**，刻意不合并：两者的"归属"不同，
   *    合并等于每个消费点都要先问"这颗是谁的"，而漏问一处就是**敌弹打敌人 /
   *    自己弹打自己**（不报错、只表现为"手感很怪"）。
   */
  eShots: EnemyShot[] = []
  /** V6.46 生物光诱饵：半径内敌人改追它 */
  lures: Lure[] = []
  weapons: Weapon[] = []
  private eid = 0

  // ---- 进度：5 层 × 4 波 ----
  layerIdx = 0
  waveInLayer = 0
  /** 收益倍率：每下潜一层 +0.5 */
  mult = 1.0
  bossDown = false
  /**
   * 本局**击杀过的 Boss 种类**（V6.78）。
   *
   * 为什么不是一个布尔量：V6.62 之后有两个 Boss（L3 末 鮟鱇女王 / L5 末 深渊守望者），
   * 而图鉴要**各点一条**。旧写法（`bossDown: boolean` + 图鉴里写死 `boss:abyss`）
   * 让 `boss:angler` 永远解锁不了，而且**不报错** —— 图鉴屏只会一直显示剪影。
   *
   * `bossDown` 保留：它是"本局通关"的语义（里程碑 / 结算文案在用），
   * 与"杀了哪几个"是两个问题，别合并。
   */
  readonly bossesDown = new Set<'watcher' | 'angler'>()

  // ---- 缠索（V6.79b）----
  /**
   * 当前咬住玩家的盘旋猎手（`null` = 没有索）。
   * ⚠️ 存**对象引用**而不是 id：`Enemy` 没有身份字段（`eid` 只是个计数器，从没写进敌人）。
   * ★ **同时只有一条索** —— 这一个字段本身就是那条配平红线的实现。
   */
  tetherSrc: Enemy | null = null
  /** 已累计的"背离移动"时长（s）。达到 `BREAK_T` 就挣断 */
  breakT = 0
  /** 挣断后的免疫剩余（s）。> 0 时不会被任何盘旋猎手咬住 */
  tetherImmune = 0
  /** 深度显示值（米） */
  depthM = 0

  // ---- 波次状态机 ----
  phase: 'wave' | 'shop' | 'decide' | 'descending' | 'result' = 'wave'
  descT = 0
  descFrom = 0
  descTo = 0
  descDur = 2.1
  waveTimer = 0
  spawnLeft = 0
  spawnTimer = 0
  droppedThisWave = 0
  /** 本波已刷出的**精英**数（V6.62 §5-A）。每波重置，上限 `ELITE_MAX` */
  eliteWave = 0
  /**
   * **连杀**（V6.62 §5-B）：`window` 内击杀计数。
   * 每击杀 +1，距上次击杀超过 `COMBO_WINDOW` 就清零；达到 `COMBO_N` 结算一次骨雨。
   */
  comboCnt = 0
  /** 距上次击杀的时间（s）。超过 `COMBO_WINDOW` ⇒ 连杀断 */
  comboT = 0
  win = false

  // ---- 商店 ----
  offers: UpgradeDef[] = []
  bank = 0
  locked: boolean[] = [false, false, false]
  sold: boolean[] = [false, false, false]
  rerollCost = 0
  pool: UpgradeDef[]
  /** 可挂载器械上限（4 → 5 → 6，靠扩容卡） */
  maxWeapons = 4

  /** 世界时间（秒）—— 暗流/漂移的相位用它 */
  t = 0

  /**
   * 本局**刷怪计数**（按 kind）。只增不减，用于图鉴"遇见次数"（`codexGains()`）。
   *
   * 为什么放在模拟层而不是渲染层去数敌人数：一是确定性（同 seed ⇒ 同计数，
   * 能在无头测试里断言），二是渲染层会因为"贴图池复用"根本数不准。
   */
  spawned: Record<string, number> = {}

  /** 永久强化注入的三项（见 WorldOptions.perk） */
  private readonly perkRate: number
  private readonly perkO2: number
  private readonly perkPickup: number

  /**
   * 本局的开局武器（`WorldOptions.weapon` 或默认值）。
   *
   * 为什么存成字段而不是直接塞给 `startRun()`：`startRun()` 也会被重开路径
   * （`restart()`，本文件 1559 行附近）调用 —— 那时作用域里没有 `opts`。
   * 存成字段才能让"新局"与"同一局重开"两条路用同一把开局武器。
   */
  private readonly startWeapon: WeaponId

  constructor(opts: WorldOptions) {
    this.W = opts.w
    this.H = opts.h
    this.rng = new Rng(opts.seed ?? 0xc0ffee)
    this.sub = opts.sub ?? SUBS[0]
    this.pool = opts.pool ?? CARD_POOL
    this.perkRate = opts.perk?.rate ?? 0
    this.perkO2 = opts.perk?.o2Bonus ?? 0
    this.perkPickup = opts.perk?.pickup ?? 0
    // ⚠️ 必须在 `startRun()` 之前赋值 —— 它内部就靠这个字段装第一把武器。
    this.startWeapon = opts.weapon ?? DEFAULT_START_WEAPON
    this.px = this.W / 2
    this.py = this.H / 2
    this.o2 = O2.max
    this.o2Max = O2.max
    this.o2Shown = O2.max
    this.startRun()
  }

  // ==========================================================================
  // 事件
  // ==========================================================================
  private emit(e: SimEvent): void { this.events.push(e) }

  /** 取出本帧事件并清空（渲染层每帧调用一次） */
  drainEvents(): SimEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  // ==========================================================================
  // 查询
  // ==========================================================================
  /** 当前层定义。DiveScene.ts:1327 */
  layer(): LayerDef { return LAYERS[this.layerIdx] }
  /** 当前层的 4 波节奏表。DiveScene.ts:1333 */
  waves(): WaveShape[] { return LAYER_WAVES[this.layerIdx] }
  /** 本局是否已装备某个遗物。DiveScene.ts:4846 */
  hasRelic(id: RelicId): boolean { return this.relics.includes(id) }

  // ==========================================================================
  // 进度
  // ==========================================================================
  /** DiveScene.ts:1338-1366 */
  startRun(): void {
    this.layerIdx = 0
    // 缠索：换局必须归零（否则上一局的索会跨局生效）
    this.tetherSrc = null; this.breakT = 0; this.tetherImmune = 0
    this.waveInLayer = 0
    this.mult = 1.0
    this.bossDown = false
    this.bossesDown.clear()
    this.st = NEW_STATS()
    this.st.speed += this.sub.speed
    this.st.pickup += this.sub.pickup
    // 永久强化：并进 `st` 而不是直接加 `o2Max` —— 因为 `equipRelic()` 会
    // 用 `layer().o2Max + st.o2Bonus` **整份重算** o2Max，若只加到 o2Max 上，
    // 玩家一装"骨殖转化"（o2Bonus −15）就会把永久强化的氧气加成一起冲掉。
    this.st.rate += this.perkRate
    this.st.o2Bonus += this.perkO2
    this.st.pickup += this.perkPickup
    this.ramT = 0
    this.o2Max = LAYERS[0].o2Max + this.sub.o2Max + this.st.o2Bonus
    this.o2 = this.o2Max
    this.o2Shown = this.o2Max
    this.maxWeapons = 4 + (this.sub.slots - 4)
    this.hurtDirT = 0
    this.layerCardT = 2.6
    this.weapons = []
    this.bullets = []; this.echoes = []; this.acids = []; this.eShots = []
    this.mines = []; this.lures = []
    // 开局武器：由「出击准备」面板选定（V6.41）；不传则回落到机关枪
    // —— 这是原版一直用的开局武器，缺省值保持它以免改变老存档玩家的第一局手感。
    // 其余三把基础武器（声呐 / 鱼雷 / 电弧）在商店里都能买到，所以选谁都不锁死 build。
    // 走 `startWeapon` 字段而不是 `opts`：`startRun()` 也被重开路径调用，那里没有 `opts`。
    this.addWeapon(this.startWeapon)
    this.startWave()
  }

  /** DiveScene.ts:1368-1408 */
  startWave(): void {
    const L = this.layer()
    const s = this.waves()[this.waveInLayer]
    this.spawnLeft = Math.round(s.count * L.cntMul)
    this.spawnTimer = 0
    this.waveTimer = s.dur
    this.droppedThisWave = 0
    this.eliteWave = 0            // 每波重新抽精英（V6.62 §5-A）
    this.phase = 'wave'
    this.depthM = L.depthTop + (L.depthBot - L.depthTop) * (this.waveInLayer / this.waves().length)

    // —— L5「压力」：每开一波，氧气上限再被压掉一截（下限 40%）——
    if (L.pressure > 0) {
      const floor = LAYERS[this.layerIdx].o2Max * 0.4
      this.o2Max = Math.max(floor, this.o2Max * (1 - L.pressure))
      if (this.o2 > this.o2Max) this.o2 = this.o2Max
    }

    // —— L3「涌流」：本层每一波都从同一个方向涌入 ——
    if (L.surge && this.waveInLayer === 0) {
      this.surgeSide = this.rng.int(0, 3)
    }

    this.emit({ t: 'wave', n: this.waveInLayer, layer: this.layerIdx })

    // Boss 投放（V6.62：两种，放在中段与终局各一次）。
    //   L3 末波 = **鮟鱇女王**（诱捕型）—— 让玩家在中段遭遇一次与"逼近"完全不同的压力；
    //   L5 末波 = **深渊守望者**（逼近型）—— 终局保持原有分量。
    // ⚠️ 两者**语汇不同**，撞在一起才有"这是另一个 Boss"的感觉，而不是"守望者换皮"。
    if (this.waveInLayer === this.waves().length - 1) {
      if (this.layerIdx === 2) this.spawnBoss('angler')
      else if (this.layerIdx === LAYERS.length - 1) this.spawnBoss('watcher')
    }
  }

  /**
   * 一波打完后的推进。DiveScene.ts:1415-1424
   *   层内波（1~3 结束）→ 商店三选一 → 下一波
   *   层末波（第 4 波结束）→ 补给站决策（下潜 / 上浮）；最后一层则通关
   */
  advance(): void {
    this.emit({ t: 'waveCleared', layer: this.layerIdx, wave: this.waveInLayer })
    if (this.waveInLayer < this.waves().length - 1) {
      this.waveInLayer++
      this.openShop()
      return
    }
    if (this.layerIdx >= LAYERS.length - 1) { this.showResult(true); return }
    this.openDecide()
  }

  // ==========================================================================
  // 生成
  // ==========================================================================
  /** 这一波该从哪条边刷怪（涌流层永远是同一侧）。DiveScene.ts:1436-1438 */
  pickSpawnSide(): number {
    return this.layer().surge ? this.surgeSide : this.rng.int(0, 3)
  }

  /** DiveScene.ts:1440-1490 */
  spawnEnemy(at?: { x: number; y: number }): void {
    const W = this.W
    const H = this.H
    const m = 60
    let x = at ? at.x : 0
    let y = at ? at.y : 0
    if (!at) {
      const side = this.pickSpawnSide()
      if (side === 0) { x = this.rng.int(0, W); y = -m }
      else if (side === 1) { x = W + m; y = this.rng.int(0, H) }
      else if (side === 2) { x = this.rng.int(0, W); y = H + m }
      else { x = -m; y = this.rng.int(0, H) }
    }

    const L = this.layer()
    const s = this.waves()[this.waveInLayer]
    const hpScale = L.hpMul * s.hpMul

    // 类型抽签：**归一化加权抽样**（V6.82，权重表见 `tables.spawnWeights`）。
    // ⚠️ V6.79 之前这里是一条顺序 if/else（drift → dash → armor → orbit → swarm）。
    //    那条链在 `Σ其他 > 1` 的波里是**先到先得**：排在前面的桶把区间吃满，
    //    后面的桶**一次也刷不出来，而且不报错**。实测 L5 全程 + L4 第 4 波都撞在上面
    //    （`drift .22 + dash .75×1.3 = 1.195`）⇒ 深渊带一整层刷不出 armor / orbit / swarm。
    //    换成加权抽样后：`Σ ≤ 1` 时各带占比与旧写法**逐位一致**，`Σ > 1` 时按权重比例分。
    const wl = spawnWeights(L, s)
    let total = 0
    for (const [, w] of wl) total += w
    const r = this.rng.next() * total
    let kind: Kind = wl[wl.length - 1][0]
    let acc = 0
    for (const [k, w] of wl) { acc += w; if (r < acc) { kind = k; break } }

    const B = ENEMY_BASE[kind]
    let hp = Math.round(B.hp * hpScale)
    if (kind === 'armor') hp = Math.round(hp * ARMOR_HP_MUL)   // 血厚 6×
    const relicSpd = this.hasRelic('abyss_mark') ? 1.1 : 1
    let spd = B.spd * relicSpd
    if (kind === 'armor') spd *= ARMOR_SPD_MUL                 // 慢 0.4×

    // ---- 精英标记（V6.62 §5-A）----
    // 每波随机 1–2 只：**同一只不能既是重甲又是精英**（两者都是"值得打的"，叠加会读作数值失控）。
    // ⚠️ V6.82 起自爆螺也排除：它**按设计一定会死**（自爆），
    //    把精英名额给它 = 那一波白少一只"值得打的目标"。
    let elite = false
    if (kind !== 'armor' && kind !== 'kamikaze' && kind !== 'shard') {
      const want = ELITE_MIN + this.rng.int(0, ELITE_MAX - ELITE_MIN)
      if (this.eliteWave < want && this.rng.next() < 0.5) {
        elite = true
        this.eliteWave++
        hp = Math.round(hp * ELITE_HP_MUL)
      }
    }

    // 重甲的直线漂移方向（随机单位向量）。放这里而不是 updateEnemies：
    // 方向是**出生时定死**的，每帧重算就变成"随机游走"了（那是另一种 AI）。
    const armorAng = this.rng.next() * Math.PI * 2

    this.enemies.push(this.mkEnemy({
      x, y,
      hp,
      r: B.r,
      kind,
      color: B.color,
      speed: spd,
      tex: ENEMY_TEX[kind],
      texRot: TEX_BASE_ROT[kind] ?? 0,
      armor: kind === 'armor' ? ARMOR_REDUCE : 0,
      elite,
      dirX: kind === 'armor' ? Math.cos(armorAng) : 0,
      dirY: kind === 'armor' ? Math.sin(armorAng) : 0,
      fx: kind === 'armor' ? Math.cos(armorAng) : -1,
      fy: kind === 'armor' ? Math.sin(armorAng) : 0,
      // ---- V6.82 第一批量种：各自的专属状态 ----
      // 盾鳐：正面盾（半角 + 减伤）。`undefined` = 无盾 ⇒ 与旧敌人完全一致。
      shieldArc: kind === 'bulwark' ? BULWARK_ARC : undefined,
      shieldCut: kind === 'bulwark' ? BULWARK_CUT : undefined,
      // 孵卵囊：出生后先给 `BROOD_FIRST_DELAY` 的缓冲再开产
      hatch: kind === 'brood' ? BROOD_FIRST_DELAY : undefined,
      // ---- V6.83 第二批 ----
      // 拟态：出生即**休眠**（完全静止 + 不动朝向）。"地上有一块碎屑"是它的全部伪装，
      //   所以它连 `fx` 都不该动 —— 一条会左右转头的东西不会被认为是石头。
      phase: kind === 'mimic' ? 'rest' : 'chase',
      // 枪鱼：趟数从 0 起。⚠️ 它**不能借 `t`**（`t` 在四段里被反复重置），
      //   见 `Enemy.passes` 的注释。
      passes: kind === 'lancer' ? 0 : undefined,
    }))
    this.eid++
    this.spawned[kind] = (this.spawned[kind] ?? 0) + 1
  }

  /**
   * 造一只**幼体**（`shard`）—— 裂体死亡分裂（`tryKill`）与孵卵囊产卵共用。
   *
   * ⚠️ 刻意**不走 `spawnEnemy`**：那个函数带"抽签 + 精英判定 + 从屏边出生"三件事，
   *    而幼体是**在场上某点凭空出现**的，且**不参与精英**。共用会让"裂体裂出来的
   *    小鱼有可能是精英"这种荒谬情况出现。
   * ⚠️ 不出现在 `spawned` 计数里 —— 图鉴按"遇见哪种"记，幼体是**副产品**不是物种。
   *    但它确实进 `enemies` ⇒ 会被打死、会掉骨（体量小，掉落按 `r` 算自然很小）。
   */
  private spawnShard(x: number, y: number, hpScale: number, spd: number, spread: number): void {
    const B = ENEMY_BASE.shard
    const a = this.rng.next() * Math.PI * 2
    const hp = Math.max(1, Math.round(B.hp * hpScale))
    this.enemies.push(this.mkEnemy({
      x: x + Math.cos(a) * spread,
      y: y + Math.sin(a) * spread,
      hp,
      r: B.r,
      kind: 'shard',
      color: B.color,
      speed: spd,
      tex: ENEMY_TEX.shard,
      texRot: TEX_BASE_ROT.shard ?? 0,
      fx: -1, fy: 0,
    }))
    this.eid++
  }

  /** 场上存活的幼体数（孵卵囊的滚雪球上限 `BROOD_MAX_ALIVE` 按它算） */
  private shardAlive(): number {
    let n = 0
    for (const e of this.enemies) if (e.alive && e.kind === 'shard') n++
    return n
  }

  /** 把这一帧排队的幼体落地（裂体分裂）。见 `pendingShards` 的注释 */
  private flushShards(): void {
    if (!this.pendingShards.length) return
    for (const p of this.pendingShards) this.spawnShard(p.x, p.y, p.hpScale, p.spd, p.spread)
    this.pendingShards.length = 0
  }

  /**
   * 当前层 + 当前波的**血量倍率**（`LayerDef.hpMul × WaveShape.hpMul`）。
   * `spawnEnemy` 与"分裂 / 产卵出来的幼体"都要用它 —— 幼体不继承倍率的话，
   * 深渊带裂出来的小鱼会是**一层薄纸**，玩家会觉得"分裂反而是好事"。
   */
  private hpScaleNow(): number {
    return this.layer().hpMul * this.waves()[this.waveInLayer].hpMul
  }

  /**
   * 一次刷怪节拍：有概率刷一整群。返回本次实际刷了几只。
   * DiveScene.ts:1510-1559
   */
  spawnCluster(): number {
    // 群概率随波次上升，上限 0.8
    const groupP = clamp(0.34 + this.waveInLayer * 0.13, 0, 0.8)
    if (this.rng.next() > groupP) { this.spawnEnemy(); return 1 }

    const n = this.rng.int(3 + this.waveInLayer, 5 + this.waveInLayer * 2)
    const W = this.W, H = this.H
    const m = 60
    const side = this.pickSpawnSide()
    let ax = 0, ay = 0
    if (side === 0) { ax = this.rng.int(0, W); ay = -m }
    else if (side === 1) { ax = W + m; ay = this.rng.int(0, H) }
    else if (side === 2) { ax = this.rng.int(0, W); ay = H + m }
    else { ax = -m; ay = this.rng.int(0, H) }

    const ddx = this.px - ax, ddy = this.py - ay
    const dl = Math.max(1, Math.hypot(ddx, ddy))
    const ux = ddx / dl, uy = ddy / dl        // 前向
    const vx = -uy, vy = ux                   // 侧向

    const shape = this.rng.pick(['blob', 'line', 'wedge'] as const)
    const gap = 46

    for (let i = 0; i < n; i++) {
      let f = 0, s = 0                          // 前向 / 侧向偏移
      if (shape === 'blob') {
        f = (this.rng.next() - 0.5) * gap * 2.2
        s = (this.rng.next() - 0.5) * gap * 2.2
      } else if (shape === 'line') {
        s = (i - (n - 1) / 2) * gap
      } else {
        const row = Math.floor(i / 2) + (i === 0 ? 0 : 1)
        f = -row * gap * 0.75
        s = (i === 0 ? 0 : (i % 2 === 1 ? -1 : 1)) * row * gap * 0.55
      }
      this.spawnEnemy({ x: ax + ux * f + vx * s, y: ay + uy * f + vy * s })
    }
    return n
  }

  /**
   * 敌人对象的**字段全集工厂**。`spawnEnemy` 与 `spawnBoss` 都从这里展开。
   *
   * ⚠️ 抽这个工厂是有代价换来的：V6.46 加三个控制字段（slow/burn/charm）时，
   *    手写两处对象字面量**只改了一处**，TS 立刻报了一串 "not assignable"。
   *    以后新增字段只改这里 ⇒ 物理上不可能只改一半。
   *
   * 调用方只需给"这个敌人才有的"字段，其余（速度归零 / 相位 / 控制状态）自动补齐。
   */
  private mkEnemy(p: Partial<Enemy> & Pick<Enemy, 'x' | 'y' | 'hp' | 'r' | 'kind' | 'color' | 'speed' | 'tex'>): Enemy {
    return {
      vx: 0, vy: 0, kx: 0, ky: 0,
      maxHp: p.hp,
      phase: 'chase', t: 0, dirX: 0, dirY: 0,
      alive: true, flash: 0,
      texRot: 0,
      bossKind: 'watcher',
      // 初始朝向朝左（贴图基准方向）。**必须给非零值** —— 全零会让渲染层
      // `Math.hypot(0,0)=0` 掉进"无朝向"分支，出生那一帧方向是空的。
      fx: -1, fy: 0,
      slowT: 0, slowMul: 1,
      // V6.62：硬控 / 护甲 / 精英默认全关 —— 只有对应分支才打开
      rootT: 0, rootImmune: 0, armor: 0, elite: false,
      burnT: 0, burnDps: 0, burnTick: 0,
      charmT: 0, charmTick: 0,
      ...p,
    }
  }

  /**
   * 刷 Boss（V6.62：两种）。
   *
   * `kind` 决定**压力语汇**：`watcher` 是"逼近"（追→蓄力→砸地），
   * `angler` 是"诱捕"（亮诱饵 → 张口吞）。见 `types.ts` 的 `bossKind` 表。
   *
   * ⚠️ 两者共用 `kind: 'boss'`（掉落 / 图鉴 / 震屏 / wave 清场都按 `'boss'` 走）。
   *    区分只在 `bossKind` 与 AI 分支 —— 不新增第五个 `Kind`，否则每一处
   *    `e.kind === 'boss'` 都要审一遍，是纯粹的返工风险。
   */
  spawnBoss(bk: 'watcher' | 'angler' = 'watcher'): void {
    const W = this.W
    const hp = Math.round((bk === 'angler' ? 1100 : 1500) * this.layer().hpMul)
    this.enemies.push(this.mkEnemy({
      x: W / 2, y: -90,
      hp,
      r: bk === 'angler' ? 38 : 44, kind: 'boss',
      bossKind: bk,
      // 鮟鱇女王用**琥珀**（诱饵光的颜色，与它的机制同源）；守望者保持紫。
      color: bk === 'angler' ? UI.amber : UI.violet,
      speed: (bk === 'angler' ? 30 : 46) * (this.hasRelic('abyss_mark') ? 1.1 : 1),
      tex: ENEMY_TEX.boss,
      texRot: TEX_BASE_ROT.dash ?? 0,
    }))
    this.spawned.boss = (this.spawned.boss ?? 0) + 1
  }

  /** DiveScene.ts:1664-1681 */
  updateWave(dt: number): void {
    this.spawnTimer -= dt
    if (this.spawnLeft > 0 && this.spawnTimer <= 0) {
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
  /**
   * 推进一帧。**子系统调用顺序与 DiveScene.update(1686-1821) 严格一致。**
   * 与渲染有关的步骤（相机跟随、drawEnv/draw/drawHud、弹窗分派、商店立绘显隐）
   * 不在模拟域内 —— 它们由各引擎的渲染层自己做。
   */
  update(rawDt: number, input: InputState = { dx: 0, dy: 0, burst: false }): void {
    const dt = Math.min(rawDt, MAX_DT)
    this.t += dt

    if (this.hurtFlash > 0) this.hurtFlash -= dt
    if (this.hurtDirT > 0) this.hurtDirT -= dt
    if (this.layerCardT > 0) this.layerCardT -= dt
    if (this.ramT > 0) this.ramT -= dt
    // 连杀断链（V6.62 §5-B）：距上次击杀超过窗口 ⇒ 计数清零。
    // ⚠️ 放这里（主循环）而不是 `updateWave`：`updateWave` 在 `descending` 相位不跑，
    //    而连杀窗口是**按真实时间**计的 —— 下潜途中不该"冻结"连杀。
    if (this.comboCnt > 0) {
      this.comboT += dt
      if (this.comboT > COMBO_WINDOW) { this.comboCnt = 0; this.comboT = 0 }
    }
    // 氧气显示值补间（指数逼近，8/s）
    this.o2Shown += (this.o2 - this.o2Shown) * Math.min(1, dt * 8)
    if (Math.abs(this.o2 - this.o2Shown) < 0.05) this.o2Shown = this.o2

    if (this.phase === 'descending') {
      this.descT += dt
      const k = Math.min(1, this.descT / this.descDur)
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2   // easeInOutQuad
      this.depthM = this.descFrom + (this.descTo - this.descFrom) * e
      if (k >= 1) { this.phase = 'wave'; this.startWave() }
    } else if (this.phase === 'wave') {
      // 缠索（V6.79b）：必须**先于 `movePlayer`**（这一帧的 `spdMul` 要读 `tetherSrc`），
      // 又必须**先于 `updateEnemies`**（那里面的盘旋猎手要读 `tetherSrc === e` 决定停不停）。
      this.updateTether(dt)
      this.movePlayer(dt, input)
      // 转塔必须在 movePlayer 之后（座圈世界坐标依赖本帧的 px/py/aim），
      // 又必须在 autoFire 之前（开火时读的就是这一帧算好的炮口朝向）。
      // 炮圈摆动夹在两者中间：先按本帧航向摆到位，再让炮管对着（摆动后的）原点索敌。
      this.slewSeatSway(dt)
      this.slewTurretAims(dt)
      // V6.46：诱饵寿命**先**推进（本帧 `enemyAim()` 读到的是最新状态）；
      // 地雷触发**后**结算（用敌人移动后的最新位置判"踩没踩到"）。
      this.updateLures(dt)
      this.updateEnemies(dt)
      this.updateMines(dt)
      this.updatePulses(dt)
      this.updateBullets(dt)
      this.updateEchoes(dt)
      this.updateAcids(dt)
      this.updateEShots(dt)
      // ★ 裂体的分裂**延迟到这一帧的伤害结算全部跑完之后**（V6.82）：
      //   直接在同一次 `hurt()` 里 `enemies.push`，等于**在 `for (const e of this.enemies)`
      //   的遍历中途改数组** —— JS 会让新加的元素在同一帧被再遍历一次，
      //   于是"这一帧刚裂出来的幼体立刻又挨了同一发爆炸"。
      //   那样到底该不该挨，是个说不清的问题（物理上该，节奏上不该）。
      //   排队 + 帧末统一落地 ⇒ 行为确定：幼体从**下一帧**起才参与碰撞与伤害。
      this.flushShards()
      this.updateBones(dt)
      this.autoFire(dt)
      this.drainOxygen(dt)
      this.updateWave(dt)
      // 遗物的"状态类"计时器：必须每帧推进
      this.noHitT += dt
      if (this.plateT > 0) this.plateT -= dt
    } else {
      // 商店 / 决策 / 结算：战斗暂停，只保留鱼骨漂流（它会被同帧的
      // `updateBones` 顺带把死亡的敌人从数组里压掉）。
      this.updateBones(dt)
    }
  }

  // ==========================================================================
  // 玩家
  // ==========================================================================
  /** DiveScene.ts:1823-1884 */
  movePlayer(dt: number, input: InputState): void {
    const W = this.W, H = this.H
    const dx = clamp(input.dx, -1, 1)
    const dy = clamp(input.dy, -1, 1)
    const spdMul = (1 + this.st.speed
      + (this.hasRelic('current_fin') && this.noHitT >= 3 ? 0.3 : 0))
      // ---- 缠索（V6.79b）：只压**移动速度**，不压射速、不动氧气、不扣氧 ----
      // 这就是"一条压力只配一个解"：它的解只有一个 —— 往外游。
      * (this.tetherSrc ? TETHER_SLOW : 1)
    // ★ V6.83 流体规避：维护"连续静止时长"。判据用**输入**而不是位移 ——
    //   缠索/减速下"想动但动不了"不该算静止（那会让这张卡在负面状态下白送收益）。
    if (dx || dy) this.stillT = 0
    else this.stillT += dt
    if (dx || dy) {
      const l = Math.hypot(dx, dy)
      this.aim = Math.atan2(dy, dx)
      this.px += (dx / l) * PLAYER.speed * spdMul * dt
      this.py += (dy / l) * PLAYER.speed * spdMul * dt
      this.moving = true
      // 挣断的**输入侧**：只有"明确朝背离它的方向游"才累计；
      // 贴着它绕圈 / 原地不动都不算（`TETHER_AWAY_DOT`）。
      if (this.tetherSrc) {
        const ax = this.px - this.tetherSrc.x, ay = this.py - this.tetherSrc.y
        const al = Math.hypot(ax, ay) || 1
        if (((dx / l) * ax + (dy / l) * ay) / al > TETHER_AWAY_DOT) this.breakT += dt
      }
    } else {
      this.moving = false
    }

    // 热泉上升流（L4 ventPush）：**加速度**而不是速度偏移
    const push = this.layer().ventPush
    if (push > 0) {
      const grad = 1 + (this.py / H) * 0.8
      this.py -= push * grad * dt
      this.vpPush = push * grad
    } else {
      this.vpPush = 0
    }

    // L2「暗流」：玩家吃**一半**强度（敌人吃满）
    const cur = this.layer().current
    if (cur > 0) {
      this.px += Math.cos(this.t * 0.28) * cur * 0.5 * dt
      this.py += Math.sin(this.t * 0.28) * cur * 0.5 * dt
    }
    this.vpCur = cur

    this.px = clamp(this.px, 24, W - 24)
    this.py = clamp(this.py, 24, H - 24)

    // 排气爆发（边沿触发）
    this.burstTimer -= dt
    if (input.burst && this.burstTimer <= 0 && this.o2 > O2.burstCost) {
      this.o2 -= O2.burstCost
      this.burstTimer = O2.burstCd
      this.emit({ t: 'burst', x: this.px, y: this.py, r: O2.burstR })
      for (const e of this.enemies) {
        if (dist(this.px, this.py, e.x, e.y) <= O2.burstR) this.hurt(e, 40, 'blast')
      }
    }
  }

  // ==========================================================================
  // 敌人 AI
  // ==========================================================================
  /** DiveScene.ts:1886-1977 */
  /**
   * 这条敌人**这一帧该往哪追**（V6.46）。
   *
   * 优先级：**内讧 > 诱饵 > 玩家**。
   * - 内讧（`charmT > 0`）：追**最近的同类**，返回的 `mob` 非空 ⇒ 接触时改为咬同类；
   * - 诱饵：半径内有诱饵就追它（不改阵营，只是被牵着走）；
   * - 默认：玩家。
   *
   * 把"追谁"集中到一个函数是刻意的：三个机制（驯化网 / 诱饵 / 光墙）本质都是
   * "改写寻路目标"，分散在各自的 update 里写会互相打架。
   *
   * ⚠️ 内讧分支是 O(k × n)（k = 被策反的数量）。**这里不需要空间索引**：
   *    网的 `iv` 是 1.1s、策反只持续 4s ⇒ 同时被策反的最多 3–4 只。
   *    150 敌人时约 600 次距离比较/帧，可以忽略。如果哪天有武器能**群体**策反，
   *    这里必须改成网格查询 —— 那时 k 会等于 n。
   */
  private enemyAim(e: Enemy): { x: number; y: number; mob: Enemy | null } {
    if (e.charmT > 0) {
      let best: Enemy | null = null
      let bd = Infinity
      for (const o of this.enemies) {
        if (o === e || !o.alive) continue
        if (o.charmT > 0) continue              // 不去咬同样被策反的（否则两只互咬成死循环）
        const d = dist(e.x, e.y, o.x, o.y)
        if (d < bd) { bd = d; best = o }
      }
      // ⚠️ 找不到同类就回落到"追玩家"而不是原地发呆 —— 否则一只被策反的鱼
      //    在场上只剩自己时会杵在原地，读作"卡死了"。
      if (best) return { x: best.x, y: best.y, mob: best }
    }
    for (const l of this.lures) {
      if (!l.alive) continue
      if (dist(e.x, e.y, l.x, l.y) < l.r) return { x: l.x, y: l.y, mob: null }
    }
    return { x: this.px, y: this.py, mob: null }
  }

  updateEnemies(dt: number): void {
    const cur = this.layer().current
    // ★ 牧群者的"这一帧已经被推过"集合（V6.82）。每帧清空 —— 见 `herder` 分支：
    //   两只牧群者同时覆盖一只小怪时，只应加一次 35%，不是 70%（那是瞬移）。
    this.herded.clear()
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.flash > 0) e.flash -= dt

      // ---- V6.46 控制状态结算（放在位移之前 ⇒ 本帧立即生效，不滞后一帧）----
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT < 0) e.slowT = 0 }
      // V6.62 硬控：定身与它的免疫窗口都在这里递减（免疫比定身长，所以两个独立计时）
      if (e.rootT > 0) { e.rootT -= dt; if (e.rootT < 0) e.rootT = 0 }
      if (e.rootImmune > 0) { e.rootImmune -= dt; if (e.rootImmune < 0) e.rootImmune = 0 }
      if (e.charmT > 0) { e.charmT -= dt; if (e.charmT < 0) e.charmT = 0 }
      if (e.burnT > 0) {
        e.burnT -= dt
        e.burnTick -= dt
        if (e.burnTick <= 0) {
          e.burnTick = 0.35                      // 与酸池同频，复用同一套手感
          e.flash = 0.05
          this.hurt(e, e.burnDps * 0.35, 'burn')
          if (!e.alive) continue                 // 灼烧可能当场烧死
        }
      }
      // **定身 > 减速**：`rootT > 0` ⇒ 速度因子 0（完全不动）。
      // 定身结束时若 `slowT` 还在，减速会接管 —— 两层控制叠加不打架（先硬后软）。
      const slow = e.rootT > 0 ? 0 : (e.slowT > 0 ? e.slowMul : 1)

      // 目标改写（内讧 / 诱饵 / 玩家三选一）
      const aim = this.enemyAim(e)
      const da = dist(e.x, e.y, aim.x, aim.y) || 1
      const nx = (aim.x - e.x) / da, ny = (aim.y - e.y) / da

      // ---- 朝向（V6.55）----
      // 见 types.ts `fx/fy`：这是 sim 里**唯一**一处写"这条鱼面朝哪"的地方，
      // 供渲染层做左右镜像 + 仰俯限幅。用**朝目标的方向**而不是本帧位移 ——
      // dash 蓄力/冲刺期间位移会归零或突变，朝向却不该跟着闪。
      // ⚠️ 绝不能指望 `vx/vy`：那两个字段在这里（以及任何地方）都不会被更新。
      e.fx = nx; e.fy = ny

      // L2「暗流」：加在敌人身上（敌人吃满）
      if (cur > 0 && e.kind !== 'boss') {
        e.x += Math.cos(this.t * 0.28) * cur * dt
        e.y += Math.sin(this.t * 0.28) * cur * dt
      }

      if (e.kind === 'swarm') {
        // ---- 游群：**扑击前摇**（V6.80；配平红线见 `SWARM_LUNGE_R` 的注释）----
        // 与 `dash` 同构（chase → charge → dash → rest），但更短、更近、有冷却。
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          // ⚠️ 只在**没被硬控**时起手：定身中还起手 = "被网住了照样扑"，与网的语义打架。
          //    （减速**不**拦截 —— 慢归慢，它仍该有扑击意图。）
          if (da < SWARM_LUNGE_R && e.rootT <= 0) {
            e.phase = 'charge'; e.t = 0
            e.dirX = nx; e.dirY = ny      // ★ 起手瞬间**锁死方向**：前摇存在的意义就是"我冲这里"
          }
        } else if (e.phase === 'charge') {
          // 蓄力：**原地不动**（"停下 = 要冲了"）；朝向仍指着玩家（它在瞄）——
          // `e.fx/e.fy` 已在上方统一写过，这里不动它。
          if (e.t >= SWARM_CHARGE_T) { e.phase = 'dash'; e.t = 0 }
        } else if (e.phase === 'dash') {
          e.x += e.dirX * e.speed * SWARM_DASH_MUL * slow * dt
          e.y += e.dirY * e.speed * SWARM_DASH_MUL * slow * dt
          e.fx = e.dirX; e.fy = e.dirY   // 冲刺时朝**冲刺方向**（同 dash，V6.55）
          if (e.t >= SWARM_DASH_T) { e.phase = 'rest'; e.t = 0 }
        } else {
          // 冷却期**照常追**（不是站着不动）—— 否则"顿一下"会读成"卡住了"
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          if (e.t >= SWARM_REST_T) { e.phase = 'chase'; e.t = 0 }
        }
      } else if (e.kind === 'drift') {
        // 水母：脉冲式漂移（一鼓一缩）
        const pulse = 0.6 + 0.4 * Math.sin(this.t * 2.2 + e.x * 0.01)
        e.x += nx * e.speed * pulse * slow * dt
        e.y += ny * e.speed * pulse * slow * dt
      } else if (e.kind === 'armor') {
        // ---- 重甲（V6.62）：**不索敌**，沿固定方向直线漂移 ----
        // 这是它与另外三类的**行为区分**：swarm/dash 都追你，drift 脉冲式追你，
        // 而重甲**根本不理你** ⇒ "你得主动去打它"（它的血厚 + 慢都服务于这一条）。
        // 撞到边界就反弹 ⇒ 它在屏内**巡逻**而不是飘走。
        //   ⚠️ 反弹不是装饰：不反弹它就会飘出屏幕，而清波条件是 `enemies.length === 0`
        //      ⇒ **这一波永远结束不了**（静默死锁）。这是可以自己撞上的坑。
        e.x += e.dirX * e.speed * slow * dt
        e.y += e.dirY * e.speed * slow * dt
        if (e.x < e.r) { e.x = e.r; e.dirX = Math.abs(e.dirX) }
        else if (e.x > this.W - e.r) { e.x = this.W - e.r; e.dirX = -Math.abs(e.dirX) }
        if (e.y < e.r) { e.y = e.r; e.dirY = Math.abs(e.dirY) }
        else if (e.y > this.H - e.r) { e.y = this.H - e.r; e.dirY = -Math.abs(e.dirY) }
        e.fx = e.dirX; e.fy = e.dirY
      } else if (e.kind === 'orbit') {
        // ---- 盘旋猎手（V6.79）：**切向绕圈 + 半径收缩**（螺旋），从不正面冲 ----
        // "直线冲向玩家"是 swarm/dash 的语汇；它的语汇是**绕着来** ⇒ 直线后退对它无效。
        if (this.tetherSrc === e) {
          // ★ 咬住时**停止旋回**，锚在玩家身上（V6.79b）。
          //   读作"它咬住了"，不是"它还在绕" —— 停住本身就是"它已经得手"的信号。
          //   朝向仍指向玩家：它现在是在"拽"，不是在"绕"。
          e.fx = nx; e.fy = ny
        } else {
          const ang = Math.atan2(e.y - this.py, e.x - this.px)
          const rad = dist(this.px, this.py, e.x, e.y) || 1
          // 切向单位向量 = 垂直于「敌 → 我」⇒ 这一项负责"绕"
          const tanX = -Math.sin(ang), tanY = Math.cos(ang)
          // 径向单位向量（朝我）⇒ 这一项负责"越绕越近"
          const inX = (this.px - e.x) / rad, inY = (this.py - e.y) / rad
          const shrink = rad > ORBIT_R_MIN ? ORBIT_SHRINK : 0
          e.x += (tanX + inX * shrink) * e.speed * slow * dt
          e.y += (tanY + inY * shrink) * e.speed * slow * dt
          // ⚠️ 朝向取**切向**（不是朝我）：玩家一眼看出"它在绕，不是在冲"。
          //    必须在上面那次 `e.fx/e.fy` 赋值**之后**覆盖，否则会退回"朝玩家"。
          e.fx = tanX; e.fy = tanY
        }
      } else if (e.kind === 'splitter') {
        // ---- 裂体（V6.82）：**直线稳定压上**，不带扑击 ----
        // 它的"新"不在移动，在**死亡**：血空时裂成 2 只幼体（见 `tryKill`）。
        // 移动上刻意朴素 —— 如果它还会扑击，玩家读到的是"另一款游群"，
        // 而分裂那一刻的意外感会被"它刚才还扑了我一下"冲淡。
        e.x += nx * e.speed * slow * dt
        e.y += ny * e.speed * slow * dt
      } else if (e.kind === 'shard') {
        // ---- 幼体（副产品）：小、快、直线。没有自己的招式 ----
        // 它是"分裂"这个动作的**可见后果**，不再是独立的物种。
        e.x += nx * e.speed * slow * dt
        e.y += ny * e.speed * slow * dt
      } else if (e.kind === 'bulwark') {
        // ---- 盾鳐（V6.82）：正面打不动，但**它转得比玩家慢** ----
        // 与 `armor` 的差别是本作最需要说清的一处：
        //   `armor`  = 全向减伤 60% + **不索敌**（你得主动去打它）
        //   `bulwark`= **方向性免疫**（正面 120° 减伤 80%）+ **主动追你**
        //
        // ⚠️ 关键约束：**朝向必须用"限速转向"而不是"直接指向玩家"**。
        //    如果它每帧把盾对准玩家，那"绕后"在物理上不可能 ⇒ 玩家只剩"换爆炸武器"
        //    一条解，方向性免疫就退化成"另一种全向减伤"。
        //    限速转向（`BULWARK_TURN`）让**横向绕圈**成为可行解：
        //    玩家在 150px 半径上以 220px/s 绕 = 1.47 rad/s > 0.9 rad/s ⇒ 追得上它的转角。
        const want = Math.atan2(this.py - e.y, this.px - e.x)
        const curA = Math.atan2(e.dirY, e.dirX)
        let diff = wrapAngle(want - curA)
        const step = BULWARK_TURN * dt
        if (diff > step) diff = step
        else if (diff < -step) diff = -step
        const a2 = curA + diff
        e.dirX = Math.cos(a2); e.dirY = Math.sin(a2)
        // 走**它面朝的方向**（不是直指玩家）—— 盾在前、身在后，这是它能被绕后的原因
        e.x += e.dirX * e.speed * slow * dt
        e.y += e.dirY * e.speed * slow * dt
        e.fx = e.dirX; e.fy = e.dirY
      } else if (e.kind === 'brood') {
        // ---- 孵卵囊（V6.82）：**几乎不动**，周期吐幼体 ----
        // 它是本作第一个**静止的威胁**（重甲会巡逻、其它都会追）—— "不动"本身就是信号：
        // 玩家一眼能扫到那个不参与围殴的圆鼓，从而学会"先点掉后排"。
        // ⚠️ 仍要以极慢速度漂向玩家，否则玩家一直退它就永远不出画，
        //    变成"我根本没看见那里有个囊在生"。
        e.x += nx * e.speed * slow * dt
        e.y += ny * e.speed * slow * dt
        // 产卵：`hatch` 归零就吐一胎，并重置。`phase = 'charge'` 当"临产"信号给渲染层。
        const alive = this.shardAlive()
        e.hatch = (e.hatch ?? BROOD_HATCH_T) - dt
        e.phase = e.hatch < 0.7 ? 'charge' : 'chase'
        if (e.hatch <= 0) {
          e.hatch = BROOD_HATCH_T
          if (alive < BROOD_MAX_ALIVE) {
            const hpScale = this.hpScaleNow()
            const spd = ENEMY_BASE.shard.spd * (this.hasRelic('abyss_mark') ? 1.1 : 1)
            for (let i = 0; i < BROOD_LITTER; i++) {
              if (this.shardAlive() >= BROOD_MAX_ALIVE) break
              this.spawnShard(e.x, e.y, hpScale, spd, 10)
            }
            // 产卵的可见信号 = **幼体自己从囊里冒出来**，不另开事件：
            // 新加一个 `SimEvent` 类型要同时改两个渲染端，而这一处的表现
            // 完全能由"凭空多出来的两只小鱼"承担。
          }
        }
      } else if (e.kind === 'kamikaze') {
        // ---- 自爆螺（V6.82）：贴近 → 前摇 → 自爆 ----
        // 结构上它和 `dash` 同源（靠近 → 停下蓄力 → 爆发），但**爆发的后果不同**：
        // dash 是"冲过去撞你"，它是"把自己炸掉"。前摇（鼓胀 + 变红）是唯一的预警，
        // 所以那 0.45s 必须**完全静止** —— 边动边炸读不出"要炸了"。
        if (e.fuse === undefined || e.fuse <= 0) {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          if (da < KAMI_ARM_R && e.rootT <= 0) {
            e.fuse = KAMI_FUSE_T
            e.phase = 'charge'
            e.t = 0
          }
        } else {
          // 前摇：原地不动，`phase = 'charge'` 让渲染层画鼓胀
          e.phase = 'charge'
          e.fuse -= dt
          if (e.fuse <= 0) {
            // ★ 自爆：走 `explode` 打敌人（守方利），再单独打玩家（攻方害）。
            //   `explode` 的 `dmg` 给 0 —— 它是**敌人的自爆**，不该顺手清掉同伴
            //   （否则"引来一群自爆螺"会成为清场手段，正好把威胁变成资源）。
            this.emit({ t: 'shake', ms: 140, intensity: 0.008 })
            this.emit({ t: 'blast', x: e.x, y: e.y, r: KAMI_BLAST_R })
            const pd = dist(e.x, e.y, this.px, this.py)
            if (pd < KAMI_BLAST_R + PLAYER.r) {
              // 来向 = 「爆心 → 玩家」
              this.damagePlayer(KAMI_PLAYER_DMG, (this.px - e.x) / (pd || 1), (this.py - e.y) / (pd || 1))
            }
            e.alive = false
            // ⚠️ 刻意**不走 `tryKill`**：自爆不该给击杀收益（不掉骨 / 不回氧 / 不计连杀）。
            //    理由见文件头"配平红线 ③"——给了收益就等于把"让它炸"变成刷氧手段。
            this.emit({ t: 'kill', x: e.x, y: e.y, r: e.r, color: e.color, kind: e.kind, cause: 'blast' })
          }
        }
      } else if (e.kind === 'herder') {
        // ---- 牧群者（V6.82）：**不追你**，它指挥别人追你 ----
        // 全作第二个"作用于玩家环境而非玩家本人"的敌人（第一个是盘旋猎手的缠索）。
        // 它的压力是**间接的**：只要它活着，附近的小怪就更快、更贴。
        // ⇒ 玩家学会"先杀 buff 源"，这是 Bullet Heaven 里很典型的优先级判断。
        const keep = 260
        if (da > keep + 40) { e.x += nx * e.speed * slow * dt; e.y += ny * e.speed * slow * dt }
        else if (da < keep - 40) { e.x -= nx * e.speed * slow * dt; e.y -= ny * e.speed * slow * dt }
        // 施压：给范围内的直线类小怪**额外一段朝玩家的位移**（等效于 ×1.35 速度），
        // 但**每帧每只只推一次** —— 两只牧群者叠加会把小怪推成瞬移。
        for (const t of this.enemies) {
          if (!t.alive || t === e) continue
          if (!HERDER_TARGETS.includes(t.kind)) continue
          if (this.herded.has(t)) continue
          const td = dist(e.x, e.y, t.x, t.y)
          if (td > HERDER_RANGE) continue
          this.herded.add(t)
          const ux2 = this.px - t.x, uy2 = this.py - t.y
          const ul = Math.hypot(ux2, uy2) || 1
          t.x += (ux2 / ul) * t.speed * (HERDER_SPD_MUL - 1) * slow * dt
          t.y += (uy2 / ul) * t.speed * (HERDER_SPD_MUL - 1) * slow * dt
        }
        e.phase = 'chase'
      } else if (e.kind === 'jelly') {
        // ---- 水母（V6.83）：缓慢漂移 + **周期放电** ----
        // 本作第一个"不碰你也能伤你"的普通敌人。压力语汇 = **一片会定时放电的区域**
        // ⇒ 玩家学会读前摇（体表环亮）、然后绕开或先点掉，而不是靠走位躲接触。
        e.x += nx * e.speed * slow * dt
        e.y += ny * e.speed * slow * dt
        e.t += dt
        if (e.t >= JELLY_CYCLE) {
          e.t = 0
          // ★ 放电走 `damagePlayer()` —— 它是一次**爆发**（不是持续磨损），
          //   所以**应该**吃闪避与无敌帧，与接触伤害刻意相反（见 `tables.ts` 的对照）。
          const jd = dist(e.x, e.y, this.px, this.py) || 1
          this.emit({ t: 'blast', x: e.x, y: e.y, r: JELLY_ZAP_R })
          if (jd < JELLY_ZAP_R + PLAYER.r) {
            this.damagePlayer(JELLY_ZAP_DMG, (this.px - e.x) / jd, (this.py - e.y) / jd)
          }
        }
        // 前摇 = 周期的最后 `JELLY_WINDUP` 秒（渲染层按 `charge` 画体表环）。
        // ⚠️ 用的是"剩余时间"而不是另开一个计时器 —— 少一个会漂的状态。
        e.phase = e.t >= JELLY_CYCLE - JELLY_WINDUP ? 'charge' : 'chase'
      } else if (e.kind === 'mimic') {
        // ---- 拟态（V6.83）：静止伪装 → 进 160px 才高速扑上 ----
        // 它的"静止"是**有信息量的**：满屏都在动，只有它不动 —— 那本身就是信号。
        // 它收的是**注意力税**，不是操作税（撞上 `dash` 的 240 蓄力也不重叠：
        // 那个是"已经在追你"，这个是"你还没发现它"）。
        if (e.phase === 'rest') {
          // 休眠：连朝向都不更新 —— 会转头的东西不会被当成海底碎屑
          e.fx = -1; e.fy = 0
          if (da < MIMIC_ARM_R) { e.phase = 'chase'; e.t = 0 }
        } else {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
        }
      } else if (e.kind === 'lancer') {
        // ---- 枪鱼（V6.83）：屏外直线**穿场**，不追踪 ----
        // 与 `dash` 的唯一差别就是"追不追"，但解法完全不同：
        //   dash 要"横移躲开"，它要**读出那条线、然后站到线外**（一次决策 vs 一次反应）。
        if (e.passes === undefined) e.passes = 0
        if (e.dirX === 0 && e.dirY === 0) {
          // 首次：定成一条穿过全场的直线（从当前点指向构图对侧）
          const tx = this.W - e.x, ty = this.H - e.y
          const tl = Math.hypot(tx, ty) || 1
          e.dirX = tx / tl; e.dirY = ty / tl
        }
        // ⚠️ **必须覆盖**上面那句 `e.fx = nx`（那是"朝目标"，而它不追人）。
        //    否则渲染层会把一条直线穿场的鱼画成"扭头追你"，语汇就错了。
        e.fx = e.dirX; e.fy = e.dirY
        e.x += e.dirX * e.speed * slow * dt
        e.y += e.dirY * e.speed * slow * dt
        // 出界 ⇒ 从**对称的另一侧**再来一趟；够 `LANCER_PASSES` 趟就撤
        if (e.x < -60 || e.x > this.W + 60 || e.y < -60 || e.y > this.H + 60) {
          e.passes++
          if (e.passes >= LANCER_PASSES) {
            // ⚠️ 直接 `alive = false`，**不走 `tryKill`** —— 它不是被打死的，
            //    不该掉骨 / 回氧 / 计连杀（同自爆螺不白送收益的道理）。
            e.alive = false
          } else {
            e.x = this.W - e.x
            e.y = this.H - e.y
          }
        }
      } else if (e.kind === 'burrower') {
        // ---- 潜沙者（V6.83）：下潜（不可选中）→ 在你附近冒出 → 突进 ----
        // 压力语汇 = **"它去哪儿了"**。全场都在场，只有它会消失。
        // ⚠️ 下潜期间**必须真的打不到**（见 `hurt()` 的相位判定）——
        //    否则"消失"只剩视觉，玩家照打不误，威胁归零。
        // 三段复用 `phase` 的四个值（语义刚好吻合，**不新增枚举**）：
        //   `chase` 地面游走 · `rest` 下潜（不动）· `charge` 冒出预警 · `dash` 突进
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          if (e.t >= BURROW_SURFACE_T) { e.phase = 'rest'; e.t = 0 }
        } else if (e.phase === 'rest') {
          if (e.t >= BURROW_DIVE_T) {
            // 冒出：落在玩家周围一圈上（**不是脚下** —— 脚下 = 无解）
            const a = this.rng.next() * Math.PI * 2
            e.x = clamp(this.px + Math.cos(a) * BURROW_EMERGE_DIST, 30, this.W - 30)
            e.y = clamp(this.py + Math.sin(a) * BURROW_EMERGE_DIST, 30, this.H - 30)
            e.phase = 'charge'; e.t = 0
          }
        } else if (e.phase === 'charge') {
          // 冒出预警：停在原地（"钻出来了"那一下必须可读）
          if (e.t >= BURROW_EMERGE_T) {
            e.phase = 'dash'; e.t = 0
            // 突进方向在**这一刻锁定**，中途不再转向 —— 会拐弯的突进就又变回"追你"了
            e.dirX = nx; e.dirY = ny
          }
        } else {
          e.x += e.dirX * e.speed * BURROW_DASH_MUL * slow * dt
          e.y += e.dirY * e.speed * BURROW_DASH_MUL * slow * dt
          e.fx = e.dirX; e.fy = e.dirY
          if (e.t >= BURROW_DASH_T) { e.phase = 'chase'; e.t = 0 }
        }
      } else if (e.kind === 'bloom') {
        // ---- 孢囊（V6.83）：缓慢靠近，**死亡留下酸云** ----
        // 它的威胁不是它自己，而是**它死在哪儿**：玩家被迫在"打掉它"和
        // "别在必经通道上打掉它"之间做选择。酸云复用 `acids` 池
        // （与酸液武器的地面池同一种东西 ⇒ 玩家不用学新符号）。
        // 埋云的落点在 `tryKill()` —— 只有那里知道"它是被打死的"。
        e.x += nx * e.speed * slow * dt
        e.y += ny * e.speed * slow * dt
        e.phase = 'chase'
      } else if (e.kind === 'leech') {
        // ---- 吸血蛭（V6.83）：接触时把玩家的氧转成自己的血 ----
        // 它是唯一"放着不管会越长越硬"的敌人 ⇒ 逼玩家分出火力去点它。
        // 吸氧 / 回血都在**接触判定那一处**结算（只有那里知道"贴上了"），这里只管走。
        // ⚠️ 它**不造成常规接触伤害** —— 见接触分支的 `continue`。
        e.x += nx * e.speed * slow * dt
        e.y += ny * e.speed * slow * dt
        e.phase = 'chase'
      } else if (e.kind === 'darter') {
        // ---- 摆尾鱼（V6.83）：接近时**正弦横摆** ----
        // 其它敌人都是直线压上，只有它的轨迹是波 —— 它让"瞄准"本身变难。
        // ⚠️ 摆动的垂直方向取**当帧的"敌→玩家"法线**（不是世界轴）：
        //    用世界轴的话，玩家只要换个站位就能让摆动变成"迎面上下晃"，反而更好打。
        // ★★ 这里写的是**位置**的正弦，取相邻两帧之差当位移。
        //    写成"横向速度 = AMP·sin(ωt)"是个隐蔽的量纲错 —— 那样位置振幅只有
        //    `AMP/ω = 90/13.8 ≈ 6.5px`（比设计值小 14 倍），而且**看起来也在摆**，
        //    只有量出来才发现幅度不对。
        e.t += dt
        const om = Math.PI * 2 * DARTER_HZ
        const sw = (Math.sin(e.t * om) - Math.sin((e.t - dt) * om)) * DARTER_AMP
        e.x += nx * e.speed * slow * dt - ny * sw
        e.y += ny * e.speed * slow * dt + nx * sw
        e.fx = nx; e.fy = ny
      } else if (e.kind === 'spitter') {
        // ---- 喷酸鱼（V6.83）：**保持距离**开火 ----
        // 本作第一个**远程**敌人。它引入的压力与前 17 种都不同：
        // 别的敌人逼你"离开它"，它逼你**处理一颗正在飞来的东西**
        // —— 接触是"现在就在掉氧"，投射物是"再过 0.4 秒会掉氧"。
        // ⇒ 玩家的两条解法：**冲进去贴脸**（它会后退，输出被打断）或**躲弹**。
        e.t += dt
        if (e.phase === 'charge') {
          // 前摇：**站住不动**（"停下 = 要吐了"，与 dash 的 charge 同一套预警语汇）
          e.fx = e.dirX; e.fy = e.dirY      // 前摇期间朝**锁定的方向**，不是朝玩家
          if (e.t >= SPITTER_WINDUP) {
            // 出弹口在**身体前端**（不是中心）—— 从中心吐会读作"原地冒出来"
            this.spawnEShot(e.x + e.dirX * (e.r + 6), e.y + e.dirY * (e.r + 6), e.dirX, e.dirY)
            e.phase = 'chase'
            e.t = 0
          }
        } else {
          // 走位：把自己维持在交战带里
          if (da < SPITTER_PANIC) {
            // 应急后撤。⚠️ 这时**压住开火计时** —— 否则"被贴脸时刚好到点"会让它
            //    边退边吐，读作"贴脸也没用"，而"贴脸能打断它的输出"是它设计上的解法之一。
            e.x -= nx * e.speed * slow * dt
            e.y -= ny * e.speed * slow * dt
            e.t = Math.min(e.t, SPITTER_IV * 0.5)
          } else if (da < SPITTER_NEAR) {
            e.x -= nx * e.speed * slow * dt
            e.y -= ny * e.speed * slow * dt
          } else if (da > SPITTER_FAR) {
            e.x += nx * e.speed * slow * dt
            e.y += ny * e.speed * slow * dt
          }
          // 到点就起手（+60 的宽容：刚出带一点也允许，否则它一直在走位、永不开火）
          if (e.t >= SPITTER_IV && da < SPITTER_FAR + 60 && e.rootT <= 0) {
            e.phase = 'charge'
            e.t = 0
            // ⚠️ 方向在**前摇开始**时锁定 —— 前摇那 0.4s 里玩家还能挪，
            //    而"它瞄的是 0.4 秒前的你"才让"侧移躲弹"成立。
            e.dirX = nx; e.dirY = ny
          }
        }
      } else if (e.kind === 'boss') {
        e.t += dt
        if (e.bossKind === 'angler') {
          // ---- 鮟鱇女王：诱捕（亮诱饵光 → 张口吞）----
          if (e.phase === 'chase') {
            // 缓慢靠近（30 px/s，比守望者慢）—— 它**不靠速度施压**，靠"你忍不住靠近"
            e.x += nx * e.speed * slow * dt
            e.y += ny * e.speed * slow * dt
            if (da < ANGLER_LURE_R) { e.phase = 'charge'; e.t = 0 }
          } else if (e.phase === 'charge') {
            // 张口：**停住不动 + 诱饵灯全亮**。这是它的预警窗口，也是玩家的"忍住别贪"考验。
            // 诱捕的物理落点：一道**朝向它的水流**把玩家往咬合半径里拽。
            // ⚠️ 没有这道水流，"光"就只是装饰，玩家站远点打 = 完胜，Boss 退化成大血包。
            const dd = dist(this.px, this.py, e.x, e.y) || 1
            if (dd < ANGLER_LURE_R) {
              const pull = ANGLER_PULL * (1 - dd / ANGLER_LURE_R) * dt   // 越近拉力越强
              this.px += (e.x - this.px) / dd * pull
              this.py += (e.y - this.py) / dd * pull
            }
            if (e.t >= ANGLER_FLARE_T) { this.anglerBite(e); e.phase = 'dash'; e.t = 0 }
          } else if (e.phase === 'dash') {
            if (e.t >= 0.5) { e.phase = 'rest'; e.t = 0 }
          } else {
            if (e.t >= 1.2) { e.phase = 'chase'; e.t = 0 }
          }
        } else if (e.phase === 'chase') {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          if (e.t >= 5) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          if (e.t >= 1.2) { this.bossSlam(e); e.phase = 'dash'; e.t = 0 }
        } else {
          if (e.t >= 1.6) { e.phase = 'chase'; e.t = 0 }
        }
      } else {
        e.t += dt
        if (e.phase === 'chase') {
          e.x += nx * e.speed * slow * dt
          e.y += ny * e.speed * slow * dt
          if (da < 240) { e.phase = 'charge'; e.t = 0 }
        } else if (e.phase === 'charge') {
          e.dirX = nx; e.dirY = ny
          if (e.t >= 0.5) { e.phase = 'dash'; e.t = 0 }
        } else if (e.phase === 'dash') {
          // ⚠️ 冲刺速度也吃减速：否则"网住了但一个冲刺就飞走"，减速就白给了
          e.x += e.dirX * 460 * slow * dt
          e.y += e.dirY * 460 * slow * dt
          // 冲刺时朝**冲刺方向**而不是朝玩家 —— 否则它会歪着身子横冲（V6.55 朝向）
          e.fx = e.dirX; e.fy = e.dirY
          if (e.t >= 0.35) { e.phase = 'rest'; e.t = 0 }
        } else {
          if (e.t >= 0.7) { e.phase = 'chase'; e.t = 0 }
        }
      }

      // 击退积分与衰减（命中推离玩家的位移，指数衰减归零）
      if (e.kx !== 0 || e.ky !== 0) {
        e.x += e.kx * dt
        e.y += e.ky * dt
        const dec = Math.exp(-9 * dt)
        e.kx *= dec; e.ky *= dec
        if (Math.abs(e.kx) < 2) e.kx = 0
        if (Math.abs(e.ky) < 2) e.ky = 0
      }

      // ---- V6.46 内讧：咬同类（此时它**不**攻击玩家）----
      if (aim.mob) {
        const m = aim.mob
        if (m.alive && dist(e.x, e.y, m.x, m.y) < e.r + m.r) {
          e.charmTick -= dt
          if (e.charmTick <= 0) {
            e.charmTick = 0.5
            m.flash = 0.06
            this.hurt(m, CHARM_BITE, 'bite')
          }
          e.x -= nx * 30 * dt
          e.y -= ny * 30 * dt
        } else {
          e.charmTick = 0                          // 脱离接触就重置节流，下一次贴上立刻咬
        }
        continue                                   // 内讧中不再结算"咬玩家"
      }

      // 接触伤害：氧气就是血条。贴着不放 = 24 氧/秒
      const d = dist(e.x, e.y, this.px, this.py) || 1
      if (d < e.r + PLAYER.r) {
        // ★ 吸血蛭（V6.83）：**不造成常规接触伤害**，改成"吸玩家的氧 → 回自己的血"。
        //   对玩家的净损失反而更大（氧照掉，而且它越吸越硬），但它**不触发受击闪白**：
        //   这是刻意的 —— 要读作"它在吸我"而不是"我在挨打"（两套视觉语汇）。
        //   ⚠️ `noHitT` 仍然归零：它确实在造成损失，不能算"无伤"
        //      （否则"无伤"类遗物会在蛭堆里白嫖）。
        if (e.kind === 'leech') {
          const suck = LEECH_DRAIN * dt
          this.o2 -= suck
          e.hp = Math.min(e.maxHp, e.hp + suck * LEECH_HEAL_PER_O2)
          this.noHitT = 0
          // 弹开只有常规的一半：它必须**贴得住**才有意义
          e.x -= ((this.px - e.x) / d) * 20 * dt
          e.y -= ((this.py - e.y) / d) * 20 * dt
          if (this.o2 <= 0) { this.o2 = 0; this.showResult(false); return }
          continue
        }
        // 刺鳐的撞击伤害（节流 0.25s）
        if (this.sub.ram > 0 && this.ramT <= 0) {
          this.ramT = 0.25
          this.hurt(e, this.sub.ram)
        }
        // 护甲在这里生效：持续磨损按乘算减免。闪避**不参与**持续伤害。
        this.o2 -= (e.kind === 'boss' ? 34 : 24) * dt * (1 - this.st.armor)
        this.hurtFlash = 0.25
        this.noHitT = 0
        this.plateT = 1.5
        // nx/ny 是「敌人 → 玩家」，取反才是伤害的来向
        const px = (this.px - e.x) / d, py = (this.py - e.y) / d
        this.hurtDirX = -px; this.hurtDirY = -py; this.hurtDirT = 0.45
        // 轻微弹开，避免贴脸站桩
        e.x -= px * 40 * dt
        e.y -= py * 40 * dt
      }
    }
  }

  /**
   * **缠索**（V6.79b）。每帧一次：先推进免疫 → 校验 / 释放已有的索 → 再判断要不要新咬。
   *
   * 接口顺序：必须在 `movePlayer` 与 `updateEnemies` **之前**（两处都要这一帧的最新结论）。
   *
   * ⚠️ 关于红线 ③「它不在锚住距离上扣氧」：**这里刻意不写任何排除**。
   *    咬住半径 `TETHER_R`(70) **大于**接触半径 `PLAYER.r + e.r`(42) ⇒
   *    "被索住"与"被贴脸打"本来就是两段不同的距离，两条压力天然不叠加。
   *    若在这里额外把接触伤害关掉，反而会产生一个**反向激励**：贴着它站 ⇒ 它一点氧都不扣。
   *    ⇒ 红线 ③ 的**意图**（别把两条压力叠成一次不可挽回的失误）已经由半径差满足了。
   */
  private updateTether(dt: number): void {
    if (this.tetherImmune > 0) this.tetherImmune = Math.max(0, this.tetherImmune - dt)

    const s = this.tetherSrc
    if (s) {
      // ① 来源没了（被击杀 / 换波清场）⇒ 立刻松。**杀它是最干脆的解，也该是最被奖励的解**
      if (!s.alive || !this.enemies.includes(s)) { this.dropTether(); return }
      const d = dist(this.px, this.py, s.x, s.y)
      // ② 被拉开 —— 安全网，不是主规则（见 `TETHER_SLIP_MUL` 的注释）
      if (d > TETHER_R * TETHER_SLIP_MUL) { this.dropTether(); return }
      // ③ 往外游够久 ⇒ 挣断（主规则）
      if (this.breakT >= BREAK_T) { this.dropTether(); return }
      return
    }

    // ④ 没有索：找最近的、在半径内的盘旋猎手。
    //    ★ 免疫窗在这里生效 —— 刚挣开就被咬上 = 永久减速（同网的 `rootImmune` 那条红线）。
    if (this.tetherImmune > 0) return
    let best: Enemy | null = null
    let bd = TETHER_R
    for (const e of this.enemies) {
      if (!e.alive || e.kind !== 'orbit') continue
      const d = dist(this.px, this.py, e.x, e.y)
      if (d <= bd) { bd = d; best = e }
    }
    if (best) { this.tetherSrc = best; this.breakT = 0 }
  }

  /** 松索并进免疫窗。**唯一的出口** —— 击杀 / 游开 / 被拉开 都走这里。 */
  private dropTether(): void {
    this.tetherSrc = null
    this.breakT = 0
    this.tetherImmune = TETHER_IMMUNE
  }

  /** 对玩家造成一次**一次性**打击（Boss 震击）。DiveScene.ts:1985-2002 */
  damagePlayer(amount: number, dirX: number, dirY: number): void {
    // ★ V6.83 流体规避：**静止够久**时额外闪避（"停得住才灵活"）。
    const dodge = Math.min(0.9, this.st.dodge
      + (this.plateT > 0 ? 0.4 : 0)
      + (this.stillT >= STILL_T ? this.st.stillDodge : 0))
    if (this.rng.chance(dodge)) {
      this.emit({ t: 'dodge', x: this.px, y: this.py })
      this.emit({ t: 'float', x: this.px, y: this.py - 34, text: '闪避', color: UI.cyanHi, size: 16 })
      this.plateT = 1.5
      return
    }
    // ★ V6.83 耐压装甲：**受击后 2 秒内额外减伤**（`plateT` 是"刚被打过"的现成计时器）。
    //   ⚠️ 必须在**扣血之前**读 `plateT` —— 这一击本身会把它重置成 1.5s，
    //      若放在赋值之后读，就变成"永远处于减伤窗口内"（每一下都吃到额外减免）。
    const ar = Math.min(0.9, this.st.armor + (this.plateT > 0 ? this.st.plateArmor : 0))
    const d = amount * (1 - ar)
    this.o2 -= d
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false); return }
    this.hurtFlash = 0.35
    this.noHitT = 0
    this.plateT = 1.5
    this.hurtDirX = dirX; this.hurtDirY = dirY; this.hurtDirT = 0.6
    this.emit({ t: 'playerHurt', dirX, dirY, amount: d })
    this.emit({ t: 'float', x: this.px, y: this.py - 30, text: `-${Math.round(d)}`, color: UI.danger, size: 18 })
  }

  /** DiveScene.ts:2005-2014 */
  bossSlam(e: Enemy): void {
    const R = 220
    if (dist(this.px, this.py, e.x, e.y) <= R) {
      const dx = e.x - this.px, dy = e.y - this.py
      const len = Math.max(1, Math.hypot(dx, dy))
      this.damagePlayer(18, dx / len, dy / len)
    }
    this.emit({ t: 'shake', ms: 220, intensity: 0.008 })
  }

  /**
   * **鮟鱇女王咬合**（V6.62）：张口结束时，玩家还在咬合半径内 ⇒ 重击。
   *
   * 与 `bossSlam`（守望者的范围砸地）的差别在**因果**：砸地是"它主动打你"，
   * 咬合是"**你被自己的贪心带进去了**" —— 同一个伤害数字，两种心理体验。
   * 伤害更高（26 > 18）也是刻意的：被诱捕的代价该比被砸一下更疼。
   */
  anglerBite(e: Enemy): void {
    this.emit({ t: 'shake', ms: 240, intensity: 0.009 })
    if (dist(this.px, this.py, e.x, e.y) <= ANGLER_BITE_R) {
      const dx = e.x - this.px, dy = e.y - this.py
      const len = Math.max(1, Math.hypot(dx, dy))
      this.damagePlayer(ANGLER_BITE_DMG, dx / len, dy / len)
    }
  }

  /** 声呐脉冲：波前向外扩散。DiveScene.ts:2021-2051 */
  updatePulses(dt: number): void {
    for (const p of this.pulses) {
      if (!p.alive) continue
      p.r += PLAYER.pulseSpeed * dt
      if (p.r > p.maxR) { p.alive = false; continue }
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.alive || p.hit.has(i)) continue
        const d = dist(p.x, p.y, e.x, e.y)
        // 波前是一条有厚度的环带
        if (Math.abs(d - p.r) < p.width * 0.5 + e.r) {
          p.hit.add(i)
          e.flash = 0.08
          this.hurt(e, p.dmg, 'pulse')
          // 共振炮：命中后向**邻近敌人**弹射 40% 伤害
          if (p.resonant) {
            let best: Enemy | null = null, bd = 150
            for (const o of this.enemies) {
              if (!o.alive || o === e) continue
              const dd = dist(e.x, e.y, o.x, o.y)
              if (dd < bd) { bd = dd; best = o }
            }
            if (best) { best.flash = 0.06; this.hurt(best, p.dmg * 0.4, 'pulse') }
          }
        }
      }
    }
    this.pulses = this.pulses.filter(p => p.alive)
  }

  /** 回声标记：倒计时归零 → 范围爆发（半径 130）。DiveScene.ts:2054-2060 */
  updateEchoes(dt: number): void {
    for (const e of this.echoes) {
      e.t -= dt
      if (e.t <= 0) this.explode(e.x, e.y, e.r ?? 130, e.dmg, e.o2per ?? 0, e.depth ?? 0)
    }
    this.echoes = this.echoes.filter(e => e.t > 0)
  }

  /**
   * 生物光诱饵（V6.46 聚怪族）。寿命归零：爆炸诱饵自爆，普通诱饵只是消失。
   *
   * ⚠️ 诱饵本身**不造成任何伤害**（`lure` / `lure_wl` 的 `boom` 为 false）——
   *    它的回报必须来自"把怪聚起来让别的 AoE 打"，这是它占一个槽的代价。
   */
  updateLures(dt: number): void {
    for (const l of this.lures) {
      if (!l.alive) continue
      l.life -= dt
      if (l.life <= 0) {
        l.alive = false
        if (l.boom) this.explode(l.x, l.y, l.br, l.dmg)
      }
    }
    this.lures = this.lures.filter(l => l.alive)
  }

  /**
   * 气泡雷（V6.46 陷阱族）：布防 → 倒计时 → **到时必爆**（V6.62 定时引信）。
   *
   * 三层状态在**同一个 for 里**推进（不拆成三个循环）：
   * 布防 0.4s → 引信 1.8s（画面上红→橙闪频递增）→ 引爆。
   *
   * ⚠️ **V6.62 从"踩触发"改成"定时引信"**（V6.49 §3.2）：爆不爆不再由敌人走位决定，
   *    而由**玩家预判**决定 —— "我算好它 1.8 秒后会游到那里"。
   *    二选一，**不能同时保留踩触发**（双重触发会让玩家读不出"它为什么现在爆"）。
   */
  updateMines(dt: number): void {
    // ⚠️ 倒序遍历：`detonateMine` 可能连锁引爆数组里的**其它**雷（改动数组长度），
    //    正序会在 splice 后跳过元素，读起来像"雷偶尔不漏爆"。
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]
      if (!m.alive) continue
      if (m.arm > 0) { m.arm -= dt; continue }       // 布防中：**引信不走**（否则一放下就响）
      m.life -= dt
      m.fuse -= dt
      // **主时钟**：引信归零 ⇒ 引爆，与附近有没有敌人**无关**。
      if (m.fuse <= 0) { this.detonateMine(m, 0); continue }
      // 兜底自毁（不爆）。`fuse(2.2s) < life(12s)` ⇒ 正常永远走不到这里；
      // 留着是给"将来有人把引信调得比存活还长"留一条不出错的退路。
      if (m.life <= 0) { m.alive = false; continue }
    }
    this.mines = this.mines.filter(m => m.alive)
  }

  /**
   * 引爆一枚雷。`depth` = 连锁递归深度（0 = 被踩 / 自爆的原始雷）。
   *
   * ⚠️ 连锁必须限深：A→B→A 的互引会无限递归（同 `explode` 共鸣腔的限深理由）。
   */
  detonateMine(m: Mine, depth: number): void {
    if (!m.alive) return
    m.alive = false
    // 回氧上限在**这一颗雷**上钳制（不是整场），所以把 cap 透传给 explode
    this.explode(m.x, m.y, m.r, m.dmg, m.o2per, 0, m.o2cap)
    if (depth >= MINE_CHAIN_DEPTH) return
    for (const o of this.mines) {
      if (!o.alive || o.arm > 0) continue             // 还在布防的不参与连锁
      if (dist(m.x, m.y, o.x, o.y) <= o.chainR) {
        this.detonateMine(o, depth + 1)
      }
    }
  }

  /**
   * 网**张开**：把一颗 `kind === 'net'` 的弹转成一片覆盖（V6.46）。
   *
   * 两个入口共用：① 撞到第一个敌人 ② 飞到射程尽头。两处都必须调用它，
   * 否则会出现"网飞到头就凭空消失"。分裂逻辑放在这里，不在调用点内联。
   */
  private openNet(b: Bullet): void {
    if (!b.net) return
    // 视觉先于伤害：先抛事件（渲染层这一帧就能画网），再结算效果
    // `ang` = 抛出方向：网是柔性体，张开形状沿运动方向拉长（不是圆），渲染层需要它
    this.emit({ t: 'burst', x: b.x, y: b.y, r: NET_R, ang: Math.atan2(b.vy, b.vx) })
    // ★ **网收走敌方投射物**（V6.83）。网是"控制一片区域"，把飞进区域的弹一并卷走
    //   与它的语义完全一致 —— 而且这让"网"在弹幕场景里多了一个用途，
    //   而它原本只有一个（定身）。
    this.clearEShots(b.x, b.y, NET_R, 'net')
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (e.charmT > 0) continue                  // 已是友方的别再网一遍
      if (dist(b.x, b.y, e.x, e.y) < NET_R + e.r) this.applyNet(b.net, e)
    }
  }

  /**
   * 网张开：对半径 `NET_R` 内所有敌人施加控制（V6.46）。
   *
   * 三种网共用这一处，只有参数不同（V6.62：减速 → **定身**）：
   * | id | 定身 | 灼烧 | 策反 |
   * |---|---|---|---|
   * | `net` | **1.2s 完全不动**（+3.0s 免疫） | — | — |
   * | `net_el` | **1.6s**（+3.0s 免疫） | 6 dps × 3.0s | — |
   * | `net_cv` | **1.2s**（+3.0s 免疫） | — | **4s 内讧** |
   *
   * ⚠️ 网必须保持**弹道**（420 速度，见 `fireWeapons`）。改成"命中即定"的瞬时判定，
   *    它就退化成被动光环 —— **"要打得准"是网值这个武器位的唯一理由**。
   */
  private applyNet(id: WeaponId, e: Enemy): void {
    const el = id === 'net_el'
    // ---- V6.62 定身（硬控）----
    // ⚠️ `rootImmune` 是配平红线：免疫窗口内**不再被定**（伤害照结算）。
    //    没有它 ⇒ 单体被定时间 ≥40%（网 iv 1.1s + 弹道），一屏定住 40 只 = 靶场。
    // ⚠️ Boss **允许**被定（这是"打得准"该有的回报），但同样受免疫窗口约束。
    if (e.rootImmune <= 0) {
      e.rootT = el ? NET_EL_ROOT_T : NET_ROOT_T
      e.rootImmune = NET_ROOT_IMMUNE
    }
    // 电网的灼烧与定身**独立**：即使这网没定住（在免疫期），烧仍然上 ——
    // 否则玩家在免疫窗口内打网 = 白打，读作"武器时好时坏"。
    if (el) { e.burnT = NET_EL_BURN_T; e.burnDps = NET_EL_BURN_DPS; e.burnTick = 0.35 }
    if (id === 'net_cv') {
      // ⚠️ **Boss 免疫策反**。否则"网住 Boss 让它帮你打小怪"直接摧毁关卡设计意图
      //    （Boss 是压力源，不该能被解除）。减速仍然生效 —— 弱化但不取消控制。
      if (e.kind !== 'boss') { e.charmT = NET_CHARM_T; e.charmTick = 0 }
    }
    e.flash = 0.08
    this.hurt(e, WEAPON_DEF[id].dmg, 'net')
  }

  /**
   * 敌人**密度最高处**（V6.46 诱饵投放点）。
   *
   * 判据是"以它为中心 `LURE_R` 内有几个敌人"，不是"离我最近"。
   * ⚠️ 复杂度 O(n²)：150 敌人 = 22.5k 次距离比较，而诱饵 `iv` 是 2.4s ⇒
   *    约每 2.4s 才跑一次 ⇒ 完全可接受。**不要**把它挪进每帧路径。
   */
  private densestSpot(): { x: number; y: number } | null {
    let best: Enemy | null = null
    let bestN = 0
    for (const a of this.enemies) {
      if (!a.alive || a.charmT > 0) continue
      let n = 0
      for (const b of this.enemies) {
        if (!b.alive || b.charmT > 0) continue
        if (dist(a.x, a.y, b.x, b.y) < LURE_R) n++
      }
      if (n > bestN) { bestN = n; best = a }
    }
    return best ? { x: best.x, y: best.y } : null
  }

  /** 酸液云：每 0.35s 结算一次，本体持续 3s。DiveScene.ts:2063-2079 */
  // ==========================================================================
  // 敌方投射物（V6.83 · 新子系统）
  // ==========================================================================

  /** 吐一发酸弹。`dx/dy` 是**单位方向**（前摇开始时锁定的那个） */
  spawnEShot(x: number, y: number, dx: number, dy: number): void {
    this.eShots.push({
      x, y,
      vx: dx * ESPEED, vy: dy * ESPEED,
      life: ELIFE, dmg: EDMG, r: EHIT_R, blastR: EBLAST_R,
      alive: true, t: 0,
    })
  }

  /**
   * **清除**半径内的敌方投射物（V6.83）。
   *
   * 这是"技能能拦弹"的**唯一入口** —— 三种手段都走它，只有 `cause` 不同
   * （爆炸抵消 / 网拦截 / 撞角撞碎），渲染层据此画不同的反馈。
   *
   * ⚠️ 刻意**不在这里结算爆开伤害**：被拦下来的弹不该还能伤到玩家 ——
   *    否则"拦弹"只省了直击、省不掉范围，玩家会读作"拦了没用"。
   * ⚠️ 也不在这里 `filter`：本函数可能在遍历别的数组的过程中被调用
   *    （`explode` 来自 `updateBullets` / `updateEnemies`）。清理留给 `updateEShots`。
   *
   * @returns 清掉的颗数（调用方据此决定要不要给"拦到了"的正反馈）
   */
  clearEShots(x: number, y: number, r: number, cause: 'blast' | 'net' | 'ram'): number {
    let n = 0
    for (const s of this.eShots) {
      if (!s.alive) continue
      if (dist(s.x, s.y, x, y) > r + s.r) continue
      s.alive = false
      n++
      this.emit({ t: 'eshotDown', x: s.x, y: s.y, r: s.r, cause })
    }
    return n
  }

  /** 一颗弹"用掉"了：命中玩家（`hit`）或飞到寿命尽头爆开（`spent`） */
  private spendEShot(s: EnemyShot, cause: 'hit' | 'spent'): void {
    s.alive = false
    this.emit({ t: 'eshotDown', x: s.x, y: s.y, r: s.blastR || s.r, cause })
    // 只有"到点"才爆 —— 命中玩家已经是直击，再来一发范围就是双重惩罚
    if (cause !== 'spent' || s.blastR <= 0) return
    const d = dist(s.x, s.y, this.px, this.py)
    if (d < s.blastR + PLAYER.r) {
      this.damagePlayer(EBLAST_DMG, (this.px - s.x) / (d || 1), (this.py - s.y) / (d || 1))
    }
  }

  /**
   * 推进敌方投射物。`update()` 每帧一次。
   *
   * ⚠️ `filter` 放在**帧末**（与 `acids` 同规）：本函数内部还会通过
   *    `spendEShot` / `clearEShots` 之外的路径改 `alive`，边遍历边删会让
   *    新元素被跳过。
   */
  updateEShots(dt: number): void {
    for (const s of this.eShots) {
      if (!s.alive) continue
      s.t += dt
      s.life -= dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      // 出界即灭。⚠️ 不给"绕回来"—— 那是 `bones` 的规则，弹绕回来会变成
      //    玩家读不出"它去哪了"的第二段攻击。
      if (s.x < -40 || s.x > this.W + 40 || s.y < -40 || s.y > this.H + 40) {
        s.alive = false
        this.emit({ t: 'eshotDown', x: s.x, y: s.y, r: s.r, cause: 'spent' })
        continue
      }
      const d = dist(s.x, s.y, this.px, this.py)
      // 刺鳐撞角：贴得极近时把弹撞碎（复用 `sub.ram`，不新开机制）
      if (this.sub.ram > 0 && d < s.r + PLAYER.r + 24) {
        s.alive = false
        this.emit({ t: 'eshotDown', x: s.x, y: s.y, r: s.r, cause: 'ram' })
        continue
      }
      if (d < s.r + PLAYER.r) {
        this.damagePlayer(s.dmg, (this.px - s.x) / (d || 1), (this.py - s.y) / (d || 1))
        this.spendEShot(s, 'hit')
        continue
      }
      if (s.life <= 0) this.spendEShot(s, 'spent')
    }
    this.eShots = this.eShots.filter(s => s.alive)
  }

  updateAcids(dt: number): void {
    for (const a of this.acids) {
      a.life -= dt
      a.tick -= dt
      if (a.tick <= 0) {
        a.tick = 0.35
        if (a.hostile) {
          // ★ 敌人的酸云（V6.83 `bloom`）：只在**玩家站在里面**时结算。
          //   走 `damagePlayer` —— 它是一次**范围爆发**（同水母放电），
          //   该吃闪避与无敌帧（与接触磨损刻意相反）。
          const ad = dist(a.x, a.y, this.px, this.py)
          if (ad < a.r + PLAYER.r) {
            this.damagePlayer(a.dmg, (this.px - a.x) / (ad || 1), (this.py - a.y) / (ad || 1))
          }
          continue
        }
        for (const e of this.enemies) {
          if (!e.alive) continue
          if (dist(a.x, a.y, e.x, e.y) < a.r + e.r) {
            e.flash = 0.05
            this.hurt(e, a.dmg, 'burn')
          }
        }
      }
    }
    this.acids = this.acids.filter(a => a.life > 0)
  }

  /**
   * 对一条敌人造成一次伤害。**所有伤害都必须走这个函数**
   * （声呐波前 / 机关枪弹 / 鱼雷直击与爆炸 / 电弧链击 / 撞角 / 排气爆发）。
   * 属性加成（伤害 % / 暴击）放在这层，新加伤害来源自动吃到加成。
   * DiveScene.ts:2089-2185
   */
  /**
   * @param cause 伤害来源（V6.46）。**只影响表现**，不影响数值 ——
   *   渲染层按它选打击/击杀特效的形状。缺省 `'bullet'` ⇒ 老调用点一行都不用改。
   */
  hurt(e: Enemy, dmg: number, cause: DamageCause = 'bullet'): void {
    // ★ 潜沙者下潜期**完全免伤**（V6.83）。
    //   这条是它"消失"这个行为的**全部意义** —— 打不到才算真的消失；
    //   否则它就只是一条半透明的鱼，玩家照打不误，压力归零。
    //   ⚠️ 放在最前面（连 `crit` 都不掷）：没有"打中了但不疼"这种中间态，
    //      要么这一击不存在，要么照常结算。
    if (e.kind === 'burrower' && e.phase === 'rest') return
    // ★ V6.83 弱点解析：对**满血**敌人额外暴击（"开新刀最疼，补刀不给力"）。
    //   ⚠️ 用 `hp >= maxHp` 而不是 `hp === maxHp`：浮点叠加/回血可能让它差一点点，
    //      而"差 0.0001 就不触发"是**不报错的静默失灵**。
    const critRate = this.st.crit + (e.hp >= e.maxHp ? this.st.fullHpCrit : 0)
    const crit = this.rng.chance(critRate)
    let d = dmg * this.dmgMulNow()
    if (crit) d *= 1 + this.st.critMul
    // ---- V6.77d 狩猎本能：对**已被控住**的目标加伤 ----
    // ⚠️ 读的是敌人自己身上的 `slowT` / `rootT`（网族与定身雷写的），
    //    不是"玩家有没有带控制武器" ⇒ 队友/多武器协同也算数。
    // ⚠️ 与 `breakRoot()` 的先后：这里只**读**、不改，所以"这一击打断了定身"
    //    的场景里，破定身的那一击**仍然吃满加伤**（先算伤害再处理控制解除）。
    if (this.st.slowDmg > 0 && (e.slowT > 0 || e.rootT > 0)) d *= 1 + this.st.slowDmg
    // ---- V6.62 重甲护甲：减伤 60%，但**爆炸 / 穿透无视** ----
    // 这两条豁免不是"网开一面"，而是重甲存在的**全部意义**：它逼玩家在
    // 「低伤高射速」和「高伤爆炸/穿透」之间做武器选择。没有豁免 ⇒ 它只是血厚的杂兵。
    const ignoreArmor = cause === 'blast' || cause === 'pierce'
    const blocked = e.armor > 0 && !ignoreArmor
    // V6.77d 破甲穿透：★ 与 `pierce` **语义不同** —— `pierce` 是"完全无视"，
    //   本卡是"把减伤按比例打折"（45% 穿透 ⇒ 60% 减伤只剩 33%）⇒ 保留重甲的存在感。
    if (blocked) d *= (1 - e.armor * (1 - this.st.armorPen))
    // ---- V6.82 盾鳐的**方向性**盾 ----
    // 与 `armor`（全向减伤）的差别就在这里：只在**正面 120°** 生效。
    //
    // ⚠️ 「来向」用**玩家位置**当代理，不是弹道起点：模拟层没把弹道起点传进 `hurt()`
    //    （那要给 10 个调用点改签名），而本作所有伤害都源自玩家（或其召唤物）
    //    ⇒ "玩家在不在它正面"与"这一击从不在它正面来"是同一件事。
    //    代价：一个已经被抛出、从背后飞来的子弹，也会按"玩家现在的位置"判定。
    //    可接受 —— 盾鳐追你，玩家在正面时本来也绕不到背后。
    const shielded = !!e.shieldArc && !ignoreArmor && (
      (() => {
        const dx = this.px - e.x, dy = this.py - e.y
        const L = Math.hypot(dx, dy) || 1
        // 盾朝向 = `dirX/dirY`（限速转向，见 bulwark 分支）
        const fdot = (dx / L) * e.dirX + (dy / L) * e.dirY
        return fdot > Math.cos(e.shieldArc!)
      })()
    )
    if (shielded) d *= (1 - (e.shieldCut ?? 0) * (1 - this.st.armorPen))
    e.hp -= d
    e.flash = Math.max(e.flash, 0.09)
    let nx = 0, ny = 0
    if (e.kind !== 'boss') {
      const kd = e.kind === 'drift' ? 46 : 120
      const dd = dist(e.x, e.y, this.px, this.py) || 1
      nx = (e.x - this.px) / dd; ny = (e.y - this.py) / dd
      e.kx += nx * kd
      e.ky += ny * kd
    }
    // 命中事件（渲染层据此画：冲击波 + 击打痕 + 迸溅火星 + 飘字）
    // ⚠️ 被护甲格挡时把火花换成**钢灰**：玩家第一次打重甲就能从颜色学到"这玩意抗弹、该换武器"，
    //    不用先去看图鉴。这是"逼玩家换武器"这条设计意图在**反馈层**的落点。
    //    V6.82 盾鳐同规 —— 方向盾被挡时也是钢灰，玩家据此学会"这个方向打不动，换个角度"。
    const hitCol = (blocked || shielded) ? UI.steel : (crit ? UI.violet : e.color)
    this.emit({ t: 'hit', x: e.x, y: e.y, r: e.r, color: hitCol, crit, dmg: d, nx, ny, cause })
    if (crit) {
      // 命中震屏：只给暴击（普通命中频率太高，每次都震会变廉价且让人晕）
      this.emit({ t: 'shake', ms: 90, intensity: 0.0022 })
      e.flash = 0.14
      this.emit({ t: 'float', x: e.x, y: e.y - e.r - 14, text: `暴击 ${Math.round(d)}`, color: UI.violet, size: 22 })
      // 共振核心：暴击溅射到最近的另一只
      if (this.hasRelic('resonance_core')) {
        let best: Enemy | null = null, bd = 220
        for (const o of this.enemies) {
          if (!o.alive || o === e) continue
          const dd = dist(e.x, e.y, o.x, o.y)
          if (dd < bd) { bd = dd; best = o }
        }
        if (best) {
          best.hp -= d * 0.4
          best.flash = 0.1
          this.emit({ t: 'hit', x: best.x, y: best.y, r: best.r, color: UI.violet, crit: true, dmg: d * 0.4, nx: 0, ny: 0 })
        }
      }
    } else {
      // ---- 伤害飘字字号阶梯（2026-10-13 用户「伤害飘字小了点 字体改下」）----
      // 层级：普通 16 = 击破回氧 16 ＜ 玩家受伤 18 ＜ 暴击 22 ＜ BOSS 击破 26
      // 依据：① 普通伤害是**最高频**的一条，12px 在满屏火花/拖尾里读不出，16 是「扫一眼就能读到数字」的下限；
      //       ② 暴击 22 = 普通的 1.375 倍，让玩家**不看颜色也知道这刀更重**（原来 17 vs 12 差得不够）；
      //       ③ 玩家自己掉血（18）优先级高于打怪，因为它直接关联生死。
      // 加粗 + 深色描边在渲染层（DiveGame.pushFloat）统一加，描边宽随字号比例走。
      this.emit({ t: 'float', x: e.x, y: e.y - e.r - 12, text: `${Math.round(d)}`, color: 0xe8f4ff, size: 16 })
    }
    this.tryKill(e, cause)
  }

  /**
   * 死亡结算：血量归零 → 掉骨 / 击杀回氧 / 震屏 / 事件。
   *
   * **V6.33 从 `hurt()` 抽出**：破血锚的穿透补刀走独立轻量结算（`rendTick()`，
   * 刻意不吃暴击与共振核心以防连锁），但它**必须**能触发死亡 —— 抽成共用函数，
   * 避免"补刀打死了怪却不掉骨头"这类静默错。
   */
  tryKill(e: Enemy, cause: DamageCause = 'bullet'): void {
    if (e.hp <= 0 && e.alive) {
      e.alive = false
      this.biomass += e.kind === 'boss' ? 20 : 1
      if (e.kind === 'boss') {
        this.bossDown = true
        // 图鉴按**种类**记（两个 Boss = 两条），见 `bossesDown` 的注释
        this.bossesDown.add(e.bossKind)
      }
      this.emit({ t: 'kill', x: e.x, y: e.y, r: e.r, color: e.color, kind: e.kind, cause })
      // ---- 连杀计数（V6.62 §5-B）----
      // ⚠️ **Boss 不计**：Boss 是一场长战，杀它本身不该算进"3 秒 8 只"的节奏里
      //    （否则打 Boss 的过程中混进来 7 只小怪就白送一次骨雨，读作"随机发钱"）。
      if (e.kind !== 'boss') {
        this.comboCnt++
        this.comboT = 0
        if (this.comboCnt >= COMBO_N) { this.comboRain(); this.comboCnt = 0 }
      }
      // 击杀震屏：按体型分三档，**频率越高的震得越轻**。
      //   普通小鱼（swarm/dash）不震 —— 每秒可能死十几只，全震就是持续抖动；
      //   大水母（drift，r=27）轻震一记 —— 它是"值得打的大目标"，死了该有反馈；
      //   Boss 重震 —— 一局一次，必须有分量。DiveScene.ts:2226-2231
      if (e.kind === 'boss') this.emit({ t: 'shake', ms: 320, intensity: 0.012 })
      else if (e.kind === 'drift') this.emit({ t: 'shake', ms: 120, intensity: 0.0035 })
      // ---- V6.82 裂体：死亡时裂成 `SHARD_N` 只幼体 ----
      // ★ 这是它存在的**全部**意义（移动上它和游群几乎一样）：
      //   惩罚"用单发高伤去收残血"——那一发的高伤害会被浪费在分裂上。
      //   ⚠️ 幼体**血量按本体的比例**继承（`SHARD_HP_MUL`）而不是固定值：
      //      固定值会让它在低层"裂出一堆肉"，在深渊带"裂出两团空气"。
      //   ⚠️ 排进 `pendingShards`，不在这里直接 push（见该字段的注释）。
      if (e.kind === 'splitter') {
        const spd = ENEMY_BASE.shard.spd * (this.hasRelic('abyss_mark') ? 1.1 : 1)
        for (let i = 0; i < SHARD_N; i++) {
          this.pendingShards.push({
            x: e.x, y: e.y,
            hpScale: this.hpScaleNow() * SHARD_HP_MUL,
            spd,
            spread: 14,
          })
        }
      }
      // ---- V6.83 孢囊：**死亡的处才是威胁** ----
      // 它的压力不在活着的时候（走得很慢），而在"你不得不在某处把它打掉"。
      // ⇒ 云埋在这具尸体下，玩家下一步就得绕开这里 —— 一张**随战斗动态生成的地形**。
      // ⚠️ `hostile: true`：这是**敌人留下的**云。忘了它就变成"打死它反而白得一片
      //    伤敌地形"，威胁瞬间反转成资源（这正是"复用现有池"最容易踩的坑）。
      if (e.kind === 'bloom') {
        this.acids.push({
          x: e.x, y: e.y, r: BLOOM_CLOUD_R,
          life: BLOOM_CLOUD_T, tick: 0, dmg: BLOOM_CLOUD_DPS,
          hostile: true,
        })
      }
      // ⚠️ 自爆螺**不走这里**（它自爆时直接 `e.alive = false`，不过在 `tryKill` 里兜一下
      //    也没问题：如果它先被打死，那就该享受正常击杀收益 —— "抢在它炸之前打掉"
      //    本来就是它设计上鼓励的解法）。所以这里**没有** kamikaze 的特判。
      this.dropBone(e)
      // 击杀回氧（深潜者 ×1.5 与「骨殖转化」×2 相乘）
      const kO2 = this.st.killO2 * this.sub.killO2Mul * (this.hasRelic('osteoblast') ? 2 : 1)
      if (kO2 > 0) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + kO2)
        if (this.o2 - before > 0.5) {
          this.emit({ t: 'float', x: e.x, y: e.y - e.r - 6, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 16 })
        }
      }
      if (e.kind === 'boss') {
        this.emit({ t: 'float', x: e.x, y: e.y - 40, text: 'BOSS 击破', color: UI.violet, size: 26 })
      }
    }
  }

  /**
   * 造一块鱼骨。**掉落的统一入口** —— `dropBone`（击杀）与 `comboRain`（骨雨）都走它。
   * `spread` = 初速倍率（骨雨用更小的值让骨落在原地，别溅一屏）。
   */
  private mkBone(x: number, y: number, o2: number, coin: number, size: number, spread = 1): void {
    const a = this.rng.next() * Math.PI * 2
    const sp = (30 + this.rng.next() * 45) * spread
    this.bones.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
      fade: O2.boneFade, o2, coin, size,
      rot: a, spin: (this.rng.next() - 0.5) * 1.6,
      alive: true,
    })
  }

  /** 掉鱼骨。硬约束 ②：每波掉落总量有上限（Boss / 精英不受限）。DiveScene.ts:2239-2261 */
  dropBone(e: Enemy): void {
    const isBoss = e.kind === 'boss'
    const size = isBoss ? 44 : clamp(e.r * 1.7, 14, 30)
    const o2 = isBoss ? 24 : Math.max(2, Math.round(BONE_O2.o2Base * (size / 18)))
    const coin = isBoss ? 24 : Math.max(3, Math.round(4 * (size / 18)))
    // ---- 精英（V6.62 §5-A）：掉落 ×4 + **必掉一个「囊」** ----
    // ⚠️ 精英**整体绕过 dropCap** —— "必掉"就是必掉，不能被波预算吃掉。
    //    （否则"打得好的那一波反倒没掉落"，正好把奖励设计反了。）
    if (e.elite) {
      this.mkBone(e.x, e.y, o2, coin * ELITE_DROP_MUL, size)
      this.mkBone(e.x, e.y, 18, 0, 34, 0.7)     // 囊：大块 + 一大口氧
      return
    }
    if (!isBoss && this.droppedThisWave >= this.layer().dropCap) return
    this.droppedThisWave += coin
    this.mkBone(e.x, e.y, o2, coin, size)
  }

  /**
   * **连杀骨雨**（V6.62 §5-B）。
   *
   * `COMBO_WINDOW` 秒内连杀 ≥ `COMBO_N` 只 ⇒ 在玩家周围撒一屏骨（额外 6–10 块，绕过 dropCap）。
   * 为什么这么设计：奖励"**打得好**"而不是"走得远" —— 把爽感从**位置轴**挪到**操作轴**。
   * 落点散布在玩家周围而不是原地：玩家刚杀完一片，骨雨从"他所在的位置"下才是最贴切的嘉奖。
   */
  private comboRain(): void {
    const n = COMBO_BONE0 + this.rng.int(0, COMBO_BONE1 - COMBO_BONE0)
    for (let i = 0; i < n; i++) {
      const a = this.rng.next() * Math.PI * 2
      const r = this.rng.next() * COMBO_SPREAD
      const x = clamp(this.px + Math.cos(a) * r, 20, this.W - 20)
      const y = clamp(this.py + Math.sin(a) * r, 20, this.H - 20)
      this.mkBone(x, y, 2, 3, 20, 0.6)
    }
    // 结算反馈：一句飘字（"骨雨"是这个惊喜点的**名字**，玩家得看得见它发生了）
    this.emit({ t: 'float', x: this.px, y: this.py - 46, text: `连杀 ×${COMBO_N} · 骨雨`, color: UI.amber, size: 22 })
    this.emit({ t: 'shake', ms: 120, intensity: 0.004 })
  }

  /**
   * 鱼骨漂流 + 拾取。顺带把死亡的敌人从数组里压掉
   * （原实现就是在这里 `filter(e => e.alive)`，保持同序）。DiveScene.ts:2290-2365
   */
  updateBones(dt: number): void {
    const pr = O2.pickupR * (1 + this.st.pickup + (this.hasRelic('tidal_compass') ? 0.8 : 0))
    const H = this.H
    for (const b of this.bones) {
      if (!b.alive) continue
      const dpx = this.px - b.x, dpy = this.py - b.y
      const dp = Math.hypot(dpx, dpy)
      const pulled = dp < pr * 1.7 && dp > 1
      if (pulled) {
        b.vx += (dpx / dp) * 380 * dt
        b.vy += (dpy / dp) * 380 * dt
      }
      b.vy += 34 * dt
      if (!pulled && b.vy > O2.boneSinkV) b.vy = O2.boneSinkV
      if (!pulled) b.vx *= 0.94                    // 水阻
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.rot += b.spin * dt
      b.spin *= 0.985
      if (!pulled && b.y >= H - O2.boneFloor) {
        b.y = H - O2.boneFloor
        b.vy = 0; b.vx = 0
        b.fade -= dt
        if (b.fade <= 0) { b.alive = false; continue }
      }
      if (dist(b.x, b.y, this.px, this.py) < pr) {
        const before = this.o2
        this.o2 = Math.min(this.o2Max, this.o2 + b.o2)
        const gained = this.o2 - before
        b.alive = false
        const coin = Math.round(b.coin * this.boneValueMul())
        this.bank += coin
        this.emit({ t: 'pickup', x: b.x, y: b.y, o2: b.o2, coin })
        if (gained > 0.5) {
          this.emit({ t: 'float', x: b.x, y: b.y - 8, text: `+${Math.round(gained)} O₂`, color: UI.cyan, size: 17 })
        } else {
          this.emit({ t: 'float', x: b.x, y: b.y - 8, text: '氧气已满', color: UI.cyanDim, size: 15 })
        }
        this.emit({ t: 'float', x: b.x, y: b.y - 26, text: `+${coin} 骨`, color: BONE, size: 15 })
      }
    }
    this.bones = this.bones.filter(b => b.alive)
    this.enemies = this.enemies.filter(e => e.alive)
  }

  /** 索敌：射程内最近的敌人（`ox/oy` 可选原点）。DiveScene.ts:2396-2404 */
  nearestEnemy(range: number, ox: number = this.px, oy: number = this.py): Enemy | null {
    let best: Enemy | null = null, bd = range
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = dist(ox, oy, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  // ==========================================================================
  // 器械
  // ==========================================================================
  /** 按等级算器械实际数值。DiveScene.ts:2407-2415 */
  weaponStats(id: WeaponId, lvl: number): { iv: number; dmg: number; range: number } {
    const d = WEAPON_DEF[id]
    const k = lvl - 1
    return {
      iv: d.iv / (1 + k * 0.12),
      // 过载核心：满级 +12% / 未满级 −8%（无该遗物时 = 1）。V6.33
      dmg: d.dmg * (1 + k * 0.35) * this.relicDmgMul(lvl),
      range: d.range + k * 26,
    }
  }

  /** 挂载一台器械（槽位没满就占新槽；满了才走合并升级）。DiveScene.ts:2428-2442 */
  addWeapon(id: WeaponId, lvl = 1): void {
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
    this.weapons.push({
      id, iv: st.iv, timer: 0, dmg: st.dmg, lvl, anchor: 0,
      ivLast: st.iv, fireFlash: 0, aimAng: this.aim, aimV: 0,
    })
  }

  /** 进化（V6.17）：进化 = **改机制**，不是加数值。DiveScene.ts:2451-2461 */
  evolveWeapon(from: WeaponId, to: WeaponId): void {
    const w = this.weapons.find(x => x.id === from)
    if (!w) return
    const st = this.weaponStats(to, w.lvl)
    w.id = to
    w.iv = st.iv
    w.dmg = st.dmg
    w.timer = 0
    w.ivLast = st.iv
    w.fireFlash = 0.25
    // ⚠️ 角速度必须归零：不归零的话残留角速度会在下一帧把角度多推一段，
    //    读作"进化的一瞬间炮口自己跳了一下"，且不会有任何报错。
    w.aimV = 0
  }

  /** 武器槽位 → 座圈座位分配表。DiveScene.ts:2477-2486 */
  mountPlan(): Array<{ ang: number; ext: boolean }> {
    const plan: Array<{ ang: number; ext: boolean }> = []
    for (let i = 0; i < this.weapons.length && i < MAX_SEATS; i++) {
      // `ang` 现在是**由挂点反推**的自洽值（世界角），不再读`SEAT_ANGLES_DEG` ——
      // 侧视下炮位是焊在艇身上的固定安装点，"座位朝向"只能是挂点位置推出来的，
      // 而不是独立的一组角度（两者各自独立 = 迟早对不上，且不会报错）。
      // 无目标时炮口回到 `aim + sway` 待机，所以实际朝向由 `slewTurretAims` 决定，不吃这里的值。
      const m = SEAT_MOUNTS[i]
      plan.push({
        ang: Math.atan2(m[1] * (HULL_H / 2), m[0] * (SUB_D / 2)),
        ext: i >= BASE_SEATS,
      })
    }
    return plan
  }

  /**
   * 第 i 座塔座的世界坐标。DiveScene.ts:2489-2496
   *
   * 第 i 座塔座的世界坐标。DiveScene.ts:2489-2496
   *
   * -----------------------------------------------------------------------
   * V6.71 重写（用户原话：「座圈不对吧 按照侧视的角度不应该是上下是炮空比较合适吗
   *   炮孔装上去的发射器要有具体感 就像真的装上去 设计一样」）
   * -----------------------------------------------------------------------
   * 旧写法 `x = R·cos(a)`、`y = R·sin(a)·SEAT_RATIO` 把 6 座摊在一条扁椭圆上，
   * 在 88×56 的梭形上读作"沿船边贴了一圈盘子"。新写法直接读 `SEAT_MOUNTS` 的
   * **归一化安装点**：**背脊 3 座 + 腹部 3 座**，沿艇身纵向排开，像真实潜艇的鱼雷舱。
   *
   * ⚠️ **`sway` 不再位移座**（这次改动最重要的一条）：
   *   挂点既然是"螺栓固定在艇体上的炮口"，转向时它就**必须刚性跟着机体**。
   *   旧写法把 `sway` 加在座位角上 ⇒ 6 座炮在机体表面滑动，正是用户
   *   「移动的过程中 武器一直在换位置也不太合适」所指的毛病。
   *   摆动改挂在**炮口待机角**上（见 `slewTurretAims`）：座不动，炮口略微滞后。
   *
   * ⚠️ 挂点若只做在渲染层，子弹会从炮口**旁边**飞出来 —— `autoFire` 取 `turretPose`
   *   而 `turretPose` 取 `seatPos`，所以三条链路（炮塔 / 炮口闪光 / 子弹出生点）同源。
   */
  seatPos(i: number): { x: number; y: number } | null {
    const m = SEAT_MOUNTS[i]
    if (!m) return null
    return {
      x: this.px + m[0] * (SUB_D / 2),
      y: this.py + m[1] * (HULL_H / 2),
    }
  }

  /** 第 i 座在射程内最近的目标（以**塔座**为原点）。DiveScene.ts:2499-2507 */
  seatTarget(i: number): { tgt: Enemy | null; rng: number } | null {
    const w = this.weapons[i]
    const p = this.seatPos(i)
    if (!w || !p) return null
    const def = WEAPON_DEF[w.id]
    const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
    return { tgt: this.nearestEnemy(rng, p.x, p.y), rng }
  }

  /**
   * 发射器独立索敌（V6.26）：每座塔从**自己座位**出发锁定最近敌人，
   * 以 TURRET_SPIN 的角速度转过去；无目标就回到艇首方向待机。
 * DiveScene.ts:2522-2537
   */
  /**
   * 炮口摆动（2026-10-13 用户「完成轻微摆动」；V6.71 改了作用对象）。
   *
   * 阻尼跟随 + 限幅：每帧把航向增量的一部分**滞留给**炮口（船向右转 → 炮口落后
   * → 读作轻微左偏），再以弹簧回中；整体限幅 ±`SEAT_SWAY_MAX`（20°）。
   *
   * ⚠️ V6.71：**不再位移炮座**，只偏炮口朝向（消费点见 `slewTurretAims` 的 `want`）。
   *   炮座现在是 `SEAT_MOUNTS` 里焊死的安装点 —— 让它跟着摆，用户一眼就会看到
   *   "炮在艇表面滑动"，那正是他两次驳回的读法。
   * ⚠️ 必须在 `slewTurretAims` **之前**：后者要用 `this.sway` 算待机朝向。
   */
  slewSeatSway(dt: number): void {
    const dAim = wrapAngle(this.aim - this.prevAim)   // 本帧转向增量（绕到最短弧）
    this.prevAim = this.aim
    this.sway -= dAim * SEAT_SWAY_FOLLOW              // 一部分转角滞留给炮口
    this.sway -= this.sway * Math.min(1, dt * SEAT_SWAY_DECAY)  // 弹簧回中
    this.sway = clamp(this.sway, -SEAT_SWAY_MAX, SEAT_SWAY_MAX)
  }

  slewTurretAims(dt: number): void {
    for (let i = 0; i < this.weapons.length; i++) {
      const w = this.weapons[i]
      const st = this.seatTarget(i)
      if (!st) continue
      const p = this.seatPos(i)!
      // 无目标 ⇒ 炮口朝艇首**加摆动偏角**（V6.71：摆动在这里落地，不再位移座）
      const want = st.tgt
        ? Math.atan2(st.tgt.y - p.y, st.tgt.x - p.x)
        : this.aim + this.sway
      const rel = wrapAngle(want - w.aimAng)
      // ---- V6.77「丝滑转向」：临界阻尼二阶系统的**解析解**递推 ----
      // 旧写法 `step = clamp(rel*min(1,dt*14), ±TURRET_SPIN*dt)` 是**恒速钳位**：
      //   第一帧直接给到满速（16 rad/s ≈ 917°/s），最后一帧直降为 0 —— 速度曲线是**方波**。
      //   开局下潜（`aim` 0 → +90°）时 0.1s 就甩完，用户读作「有点突兀」。
      // 新写法：`ẍ + 2ω·ẋ + ω²·x = 0`（x = 残差），初值 `x0 = rel`、`v0 = aimV`，闭式解：
      //     x(t) = (x0 + b·t)·e^(−ωt)      v(t) = (v0 − ω·b·t)·e^(−ωt)      b = v0 + ω·x0
      //   ⇒ 本帧转过的角度 = `x0 − x(dt)`，新角速度 = `v(dt)`。
      // ⚠️ 为什么用解析解而不是半隐式欧拉：欧拉在 `dt·ω ≳ 1` 时会过冲，而 `dt` 会被掉帧
      //    拉大；解析解对**任意 dt** 都精确 ⇒ 帧率抖动不会让炮口越过目标。
      // ⚠️ **待机 / 索敌两档 ω**（见 `tables.ts` 的长注释）：用户在开局看到的是待机档。
      // ⚠️ 顺序不能反：先用**本帧初值**算 x/v，再写回。先写角度会让速度用错基准。
      // ⚠️ `wrapAngle` 取的是**最短弧** ⇒ 170° 会走 −190° 那一侧（不是绕远路）。
      // V6.77d 伺服转台：**待机 / 索敌两档同乘**。
      // ⚠️ 只加"索敌档"会读不出来 —— 待机时炮口归位同样慢，而玩家在没敌人时
      //    更常盯着机体看。两档一起加，"转台变利索了"才是完整的一句话。
      const om = (st.tgt ? TURRET_OMEGA_TRACK : TURRET_OMEGA_IDLE) * (1 + this.st.turretSpeed)
      const wt = om * dt
      const b = w.aimV + om * rel
      const ex = Math.exp(-wt)
      const nx = (rel + b * dt) * ex
      w.aimV = clamp((w.aimV - om * b * dt) * ex, -TURRET_SPIN, TURRET_SPIN)
      w.aimAng = wrapAngle(w.aimAng + (rel - nx))
    }
  }

  /** 第 i 台器械的炮塔位姿（世界坐标 + 实际朝向）。DiveScene.ts:2554-2561 */
  turretPose(i: number): { x: number; y: number; ang: number } | null {
    const slot = this.mountPlan()[i]
    const w = this.weapons[i]
    if (!slot || !w) return null
    const p = this.seatPos(i)
    if (!p) return null
    return { x: p.x, y: p.y, ang: w.aimAng }
  }

  /** 全部器械升一级（「弹药改良」）。DiveScene.ts:2564-2570 */
  levelAllWeapons(): void {
    for (const w of this.weapons) {
      w.lvl = Math.min(5, w.lvl + 1)
      const s = this.weaponStats(w.id, w.lvl)
      w.iv = s.iv; w.dmg = s.dmg
    }
  }

  /** 多器械同时开火。DiveScene.ts:2576-2708 */
  autoFire(dt: number): void {
    const plan = this.mountPlan()
    for (let wi = 0; wi < this.weapons.length; wi++) {
      const w = this.weapons[wi]
      w.timer = Math.max(0, w.timer - dt)
      w.fireFlash = Math.max(0, w.fireFlash - dt)
      if (w.timer > 0) continue
      const def = WEAPON_DEF[w.id]
      const rng = (def.range + (w.lvl - 1) * 26) * (1 + this.st.range)
      const seatBoost = (plan[wi]?.ext) ? (1 + this.st.twinRate) : 1
      const pose = this.turretPose(wi)
      // 炮口出生点 = 炮座中心沿炮管方向外推。
      // ⚠️ V6.71 跟着炮座改造一起换了基数：`TURRET_R`（已作废）→ `MOUNT_BASE_R`。
      //    0.85 的来历：枪族炮管末端在局部 x ≈ `EMITTER_SIZE × 0.68` ≈ 12.2px，
      //    而底板半径 15 ⇒ 出弹点必须落在**炮管口上**、不能还在底板里面。
      // ⚠️ V6.76 **数值刻意不动**：安装结构从"艇外悬臂台（`MOUNT_BASE_R=15`）"改成
      //    "位图上的槽 + 插进槽里的柱脚"，转座心从 8.7px 收到 6.3px ⇒ 12.75 现在
      //    **比旧版更靠外**（相对新转座心是 +6.4，相对炮管口 6.3+12.2=18.5 仍在其内侧）。
      //    即"出弹点落在炮管里、且不会落在安装件后面"这条不变式**仍然成立**，
      //    而弹道属于战斗手感 ⇒ 没有理由跟着视觉一起动（动了是行为变更，不是修正）。
      const MUZ = MOUNT_BASE_R * 0.85
      // ★ V6.82 **法向偏移**：视图的炮管从**转座心**（座心 + `TURRET_OUT` 法向外移）
      //   沿 aim 伸出 ⇒ 出弹点必须同源，否则子弹从炮管**旁边**飞出来
      //   （用户 2026-10-15「子弹出口 没对准炮口」）。取值见 `tables.TURRET_OUT`。
      const OUT_Y = pose ? (SEAT_MOUNTS[wi][1] < 0 ? -1 : 1) * TURRET_OUT : 0

      const fam = weaponFamily(w.id)
      const wcol = WEAPON_DEF[w.id].color

      if (fam === 'sonar') {
        if (!this.nearestEnemy(rng)) continue
        const sx = pose ? pose.x : this.px, sy = pose ? pose.y : this.py
        this.pulses.push({
          x: sx, y: sy,
          r: PLAYER.r * 0.6, maxR: rng,
          dmg: w.dmg, width: PLAYER.pulseWidth,
          hit: new Set<number>(), alive: true,
          resonant: w.id === 'sonar_rs',
        })
        // V6.46：声呐原来**一个开火事件都不发** —— 波前从机体扩散出去是"结果"，
        // 但"我开火了"这个**因**没有任何反馈。补一个无方向的爆闪。
        this.emit({ t: 'muzzle', x: sx, y: sy, ang: 0, color: wcol, fam: 'sonar' })
      } else if (fam === 'gun') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + OUT_Y + Math.sin(base) * MUZ : this.py
        const pellets = w.id === 'gun_sg' ? 5 : 1
        const spread = 0.36
        // V6.77d 弹道增压：**速度与寿命同乘 / 同除** ⇒ 射程 `rng` 不变，
        // 变的只是"子弹飞到目标要多久"（命中提前量）。下面 `life: rng / spd`
        // 天然跟着新速度走，所以这里只需要改 `spd` 一处。
        const spd = (w.id === 'gun_gl' ? 640 : 780) * (1 + this.st.bulletSpd)
        for (let p = 0; p < pellets; p++) {
          const a = pellets > 1
            ? base + (p / (pellets - 1) - 0.5) * spread * 2
            : base + (this.rng.next() - 0.5) * 0.05
          this.bullets.push({
            x: ox, y: oy,
            vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            life: rng / spd, dmg: w.dmg, kind: 'gun',
            hit: new Set<number>(), alive: true,
          })
        }
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'gun', power: pellets > 1 ? 2 : 1 })
      } else if (fam === 'torpedo') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + OUT_Y + Math.sin(base) * MUZ : this.py
        const pellets = w.id === 'torp_cl' ? 3 : 1
        const spread = 0.26
        // V6.77d 弹道增压。⚠️ 鱼雷的射程是**写死的 `life: 3.0` × 速度**（不是
        // `rng / spd`）⇒ 这里必须**显式**把寿命除回去，否则加速会直接变远。
        const bs = 1 + this.st.bulletSpd
        for (let p = 0; p < pellets; p++) {
          const a = pellets > 1
            ? base + (p / (pellets - 1) - 0.5) * spread * 2
            : base
          this.bullets.push({
            x: ox, y: oy,
            vx: Math.cos(a) * 300 * bs, vy: Math.sin(a) * 300 * bs,
            life: 3.0 / bs, dmg: w.dmg, kind: 'torpedo',
            hit: new Set<number>(), alive: true,
            er: w.id === 'torp_hv' ? 1.5 : 1,
          })
        }
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'torpedo', power: 2 })
      } else if (fam === 'harpoon') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + OUT_Y + Math.sin(base) * MUZ : this.py
        // V6.29 三重鱼叉：3 叉扇形；回旋鱼叉：单叉 + 到程掉头 + 命中回氧
        const pikes = w.id === 'harp_tr' ? 3 : 1
        const spread = 0.30
        // V6.77d 弹道增压。⚠️ `boomerAt`（回旋鱼叉的掉头时刻）是 `life0` 的一半 ⇒
        // 必须跟着 `life0` 一起缩，否则"加速后回旋点提前/推后"，回旋半径会漂。
        const bs = 1 + this.st.bulletSpd
        for (let p = 0; p < pikes; p++) {
          const a = pikes > 1 ? base + (p / (pikes - 1) - 0.5) * spread * 2 : base
          const life0 = rng / (900 * bs)
          const b: Bullet = {
            x: ox, y: oy,
            vx: Math.cos(a) * 900 * bs, vy: Math.sin(a) * 900 * bs,
            life: life0, dmg: w.dmg, kind: 'harpoon',
            hit: new Set<number>(), alive: true,
          }
          if (w.id === 'harp_cb') { b.o2 = 1; b.boomerAt = life0 * 0.5 }
          this.bullets.push(b)
        }
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'harpoon' })
      } else if (fam === 'echo') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const LEAD = 0.5, DLY = 0.75
        const big = w.id === 'echo_fo'
        // V6.29 多重回声：落点三点三角分布；聚焦回声：单个大半径回声
        const spots = w.id === 'echo_mu'
          ? [[0, -70], [-62, 40], [62, 40]]
          : [[0, 0]]
        for (const [dx, dy] of spots) {
          const ec: Echo = {
            x: e.x + e.vx * DLY * LEAD + dx,
            y: e.y + e.vy * DLY * LEAD + dy,
            t: big ? 1.2 : DLY,
            dmg: w.dmg,
          }
          if (big) ec.r = 286
          if (w.id === 'echo_mu') ec.o2per = 0.6
          this.echoes.push(ec)
        }
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + OUT_Y + Math.sin(base) * MUZ : this.py
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'echo', power: big ? 3 : 2 })
      } else if (fam === 'acid') {
        const e = this.nearestEnemy(rng); if (!e) continue
        // V6.29 持久酸池：更大更久；酸雨：落点三池成排
        const big = w.id === 'acid_fd'
        const ar = big ? 100 : 62
        const alife = big ? 5.0 : 3.0
        const spots = w.id === 'acid_ra' ? [[-70, 0], [0, 0], [70, 0]] : [[0, 0]]
        for (const [dx, dy] of spots) {
          this.acids.push({ x: e.x + dx, y: e.y + dy, r: ar, life: alife, tick: 0, dmg: w.dmg })
        }
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + OUT_Y + Math.sin(base) * MUZ : this.py
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'acid' })
      } else if (fam === 'mine') {
        // 气泡雷：**落在自己脚下**，不索敌 —— 这是它与其他 10 把武器的根本区别。
        // ⚠️ 场上有上限：满了就 `continue`（不消耗 timer）⇒ 一旦有空位立刻补一颗。
        //    这读作"布雷节奏被走位卡住"，而不是"武器坏了"。
        let live = 0
        for (const m of this.mines) if (m.alive) live++
        if (live >= MINE_CAP) continue
        const o2per = w.id === 'mine_o2' ? MINE_O2_PER : 0
        this.mines.push({
          x: this.px, y: this.py,
          arm: MINE_ARM, life: MINE_LIFE,
          dmg: w.dmg, fuse: MINE_FUSE, fuseMax: MINE_FUSE, r: MINE_R,
          o2per, o2cap: o2per > 0 ? MINE_O2_CAP : Infinity,
          chainR: w.id === 'mine_ch' ? MINE_CHAIN_R : 0,
          alive: true,
        })
        // 布雷的位置反馈：不发光环的话，玩家不知道雷落在哪（尤其是移动中）。
        // 半径取 44（不再是踩触发半径 34）：布雷是"我放了个东西在这"，不是"有人踩到了"。
        this.emit({ t: 'burst', x: this.px, y: this.py, r: 44 })
      } else if (fam === 'net') {
        const e = this.nearestEnemy(rng); if (!e) continue
        const base = pose ? pose.ang : Math.atan2(e.y - this.py, e.x - this.px)
        const ox = pose ? pose.x + Math.cos(base) * MUZ : this.px
        const oy = pose ? pose.y + OUT_Y + Math.sin(base) * MUZ : this.py
        // 网是**慢速弹**（420，比枪弹 780 慢一半）⇒ 看得见飞出去的过程，
        // 才能预判"网要在哪张开"。这是控场武器该有的可读性。
        this.bullets.push({
          x: ox, y: oy,
          vx: Math.cos(base) * 420, vy: Math.sin(base) * 420,
          life: rng / 420, dmg: w.dmg, kind: 'net',
          hit: new Set<number>(), alive: true,
          net: w.id,
        })
        this.emit({ t: 'muzzle', x: ox, y: oy, ang: base, color: wcol, fam: 'net', power: 2 })
      } else if (fam === 'lure') {
        // 诱饵：投放点是**敌人密度最高处**，不是最近敌人 ——
        // 投在最近敌人身上没用，它本来就在朝你来了（见 `densestSpot`）。
        const spot = this.densestSpot()
        if (!spot) continue
        const wall = w.id === 'lure_wl'
        const n = wall ? 3 : 1
        for (let k = 0; k < n; k++) {
          const off = wall ? (k - 1) * LURE_WALL_GAP : 0
          this.lures.push({
            x: spot.x + off, y: spot.y,
            life: LURE_LIFE,
            r: wall ? LURE_WALL_R : LURE_R,
            boom: w.id === 'lure_bo', dmg: w.dmg, br: LURE_BOOM_R,
            alive: true,
          })
        }
        // 投放反馈用 `burst`（扩散环）而不是 muzzle：诱饵是"放下去"不是"打出去"
        this.emit({ t: 'burst', x: spot.x, y: spot.y, r: wall ? LURE_R : LURE_R * 0.8 })
      } else {
        const first = this.nearestEnemy(rng); if (!first) continue
        this.fireArc(first, w, pose)
      }
      // 射速：高压供能（st.rate）在这里生效；记下这一发的**实际间隔**
      w.ivLast = def.iv / ((1 + (w.lvl - 1) * 0.12) * seatBoost * (1 + this.st.rate)) * this.relicIvMul(w.lvl)
      w.timer = w.ivLast
      w.fireFlash = 0.15
    }
  }

  /** 链式电弧：从 first 往后跳。DiveScene.ts:2713-2737 */
  fireArc(first: Enemy, w: Weapon, pose: { x: number; y: number; ang: number } | null = null): void {
    const chain = w.id === 'arc_st' ? 99
      : 2 + w.lvl + (w.id === 'arc_ov' ? 4 : 0)
    const pts = [{ x: pose ? pose.x : this.px, y: pose ? pose.y : this.py }]
    const hit = new Set<Enemy>()
    let cur: Enemy | null = first
    let o2Gain = 0
    while (cur && hit.size < chain) {
      hit.add(cur)
      pts.push({ x: cur.x, y: cur.y })
      cur.flash = 0.08
      this.hurt(cur, w.dmg, 'arc')
      // 导体缠绕：每跳回氧。V6.33 —— 把「续航」接到「电弧跳数」上
      if (this.hasRelic('conductor_coil')) o2Gain += 0.8
      let next: Enemy | null = null, bd = 190
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e)) continue
        const d = dist(cur.x, cur.y, e.x, e.y)
        if (d < bd) { bd = d; next = e }
      }
      cur = next
    }
    this.emit({ t: 'arc', pts })
    // 单次开火回氧上限 4（防止 arc_ov 的 11 跳一次灌满 → 氧又用不完）
    if (o2Gain > 0) {
      o2Gain = Math.min(o2Gain, 4)
      const before = this.o2
      this.o2 = Math.min(this.o2Max, this.o2 + o2Gain)
      if (this.o2 - before > 0.5) {
        this.emit({ t: 'float', x: this.px, y: this.py - 34, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 15 })
      }
    }
  }

  /** 通用弹更新：机关枪直线、鱼雷追踪 + 命中爆炸。DiveScene.ts:2740-2791 */
  updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) continue
      b.life -= dt
      if (b.life <= 0) {
        // V6.46 网：飞到射程尽头也要**张开**再消失。不张开的话"打了但没网到"
        // 在视觉上等同于"子弹凭空消失"，玩家读不出这是控场武器。
        if (b.net) this.openNet(b)
        b.alive = false
        continue
      }

      // 回旋鱼叉：到程掉头（清 hit ⇒ 回程可对同一目标二次穿刺）。V6.29
      if (b.boomerAt !== undefined && !b.reversed && b.life <= b.boomerAt) {
        b.reversed = true
        b.vx = -b.vx; b.vy = -b.vy
        b.hit.clear()
      }

      if (b.kind === 'torpedo') {
        const tgt = this.nearestEnemy(WEAPON_DEF.torpedo.range)
        if (tgt) {
          const want = Math.atan2(tgt.y - b.y, tgt.x - b.x)
          const cur = Math.atan2(b.vy, b.vx)
          // 转向速率有上限，否则鱼雷会像狗一样贴着敌人抽搐
          const diff = clamp(wrapAngle(want - cur), -3.6 * dt, 3.6 * dt)
          const na = cur + diff
          const sp = Math.hypot(b.vx, b.vy)
          b.vx = Math.cos(na) * sp
          b.vy = Math.sin(na) * sp
        }
      }

      b.x += b.vx * dt
      b.y += b.vy * dt
      const W = this.W, H = this.H
      if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) { b.alive = false; continue }

      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]
        if (!e.alive || b.hit.has(i)) continue
        if (dist(b.x, b.y, e.x, e.y) < e.r + 6) {
          b.hit.add(i)
          e.flash = 0.08
          // V6.62：鱼叉是**穿透**伤害 ⇒ 无视重甲护甲（这是"逼玩家换武器"的另一半：
          //   爆炸与穿透两条豁免里，玩家手里的武器至少要占一条，否则重甲无解）。
          this.hurt(e, b.dmg, b.kind === 'harpoon' ? 'pierce' : 'bullet')
          // 网：**撞到第一个敌人就张开**（半径内的全部一起网住），然后消散。
          // ⚠️ 用 `openNet` 而不是在这里内联 —— 射程尽头也要走同一段逻辑，
          //    分开写迟早只有一处生效（而漏的那处不会有任何报错）。
          if (b.kind === 'net') { this.openNet(b); b.alive = false; break }
          // 爆炸半径吃 er：重型鱼雷 1.5 倍
          if (b.kind === 'torpedo') { this.explode(b.x, b.y, 120 * (b.er ?? 1), b.dmg * 0.6); b.alive = false; break }
          // 鱼叉：穿透（不销毁）+ 把命中的鱼**拉向玩家**
          if (b.kind === 'harpoon') {
            const dd = dist(e.x, e.y, this.px, this.py) || 1
            e.kx -= (e.x - this.px) / dd * 300
            e.ky -= (e.y - this.py) / dd * 300
            // 回旋鱼叉：每次穿刺回氧。V6.29 氧耦合 A
            if (b.o2) {
              const before = this.o2
              this.o2 = Math.min(this.o2Max, this.o2 + b.o2)
              if (this.o2 - before > 0.5) {
                this.emit({ t: 'float', x: e.x, y: e.y - e.r - 6, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 16 })
              }
            }
            // 破血锚：对本发**已穿过的其他敌人**补刀。V6.33
            this.rendTick(b, i)
          }
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.alive)
  }

  /** 鱼雷爆炸：范围伤害随距离衰减。DiveScene.ts:2955-2988 */
  /** `o2per` = 每炸到一个敌人回氧（多重回声 0.6）。缺省 0 = 不回氧。V6.29 氧耦合 A */
  /** `depth` = 连锁深度：0 = 武器直接投放（可触发共鸣腔）；≥1 = 小回声（不再连锁）。V6.33 */
  /** `o2cap` = **单次爆炸**的回氧总量上限。缺省 `Infinity`。V6.46 氧气雷的第三条锁 */
  explode(x: number, y: number, r: number, dmg: number, o2per = 0, depth = 0, o2cap = Infinity): void {
    this.emit({ t: 'shake', ms: 130, intensity: 0.006 })
    this.emit({ t: 'blast', x, y, r })
    // ★ **爆炸抵消敌方投射物**（V6.83）。为什么爆炸该有这条：
    //   爆炸本来就是"清场"的语汇，而被弹幕压制的玩家最自然的反应就是"炸一下清空"。
    //   反过来说，如果爆炸清不掉弹，玩家在弹幕里丢鱼雷会有强烈的"我用了大招却没变化"的失重感。
    //   ⚠️ 只有**爆炸**有这条（网 / 撞角各在自己的入口）—— 别在"所有 AoE"上统一加，
    //      那会把"清弹"变成零门槛，远程敌人立刻退化（见 `EnemyShot` 的注释）。
    this.clearEShots(x, y, r, 'blast')
    let o2gain = 0
    const seen = new Set<Enemy>()      // 同一敌人只计一次（爆炸环可能重叠判定）
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = dist(x, y, e.x, e.y)
      if (d < r + e.r) {
        e.flash = 0.08
        const falloff = 1 - clamp(d / (r + e.r), 0, 1) * 0.5
        this.hurt(e, dmg * falloff, 'blast')
        if (!seen.has(e)) { seen.add(e); o2gain += o2per }
      }
    }
    // ⚠️ 封顶：不封顶的话，一次炸到 8 个敌人就是 +20 氧（氧气雷 2.5×8），
    //    "站雷堆里无限回血" —— 直接把氧气机制作废。见 `MINE_O2_CAP` 的三条锁。
    if (o2gain > o2cap) o2gain = o2cap
    if (o2gain > 0) {
      const before = this.o2
      this.o2 = Math.min(this.o2Max, this.o2 + o2gain)
      if (this.o2 - before > 0.5) {
        this.emit({ t: 'float', x, y: y - 10, text: `+${Math.round(this.o2 - before)}`, color: UI.cyanHi, size: 16 })
      }
    }
    // 共鸣腔：**大回声**（depth 0）引爆时，在最近 2 个未被波及的敌人处各生成一个小回声。V6.33
    // ⚠️ 必须限深：三敌互相指向会无限递归。
    if (depth === 0 && this.hasRelic('resonance_chamber')) {
      const cands: Enemy[] = []
      for (const e of this.enemies) {
        if (!e.alive) continue
        if (dist(x, y, e.x, e.y) < r + e.r) continue   // 已被这次爆炸波及的跳过
        cands.push(e)
      }
      cands.sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y))
      for (const t of cands.slice(0, 2)) {
        this.echoes.push({ x: t.x, y: t.y, r: r * 0.55, dmg: dmg * 0.4, t: 0.4, o2per: 0, depth: 1 })
      }
    }
  }

  /** 层基础耗氧 − 循环泵回氧 + 贪食腺体代谢代价。DiveScene.ts:3107-3117 */
  drainOxygen(dt: number): void {
    let net = this.layer().drain
    if (this.hasRelic('gluttony')) net += 0.6
    // ★ V6.83 循环泵：回氧**与缺氧程度成正比**（0 氧时 2.5×，满氧时 0）。
    //   把"低氧"从纯危险态变成一种**资源态** —— 与 `echo_heart`（低氧增伤）是同一套语汇。
    //   ⚠️ `regen === 0`（没买这张卡）时整项仍为 0，与加卡之前逐帧一致。
    net -= this.st.regen * (this.st.regen > 0
      ? REGEN_MISS_K * (1 - this.o2 / this.o2Max)
      : 0)
    // 持久酸池：站在自己的酸池里，环境氧耗减半。V6.29 氧耦合 C（场地换氧）
    if (net > 0 && this.weapons.some(w => w.id === 'acid_fd')
      && this.acids.some(a => dist(this.px, this.py, a.x, a.y) < a.r)) {
      net *= 0.5
    }
    this.o2 -= net * dt
    if (this.o2 > this.o2Max) this.o2 = this.o2Max
    if (this.o2 <= 0) { this.o2 = 0; this.showResult(false) }
  }

  // ==========================================================================
  // 属性与遗物
  // ==========================================================================
  /** 加一点属性（唯一入口，上限只在这里钳一次）。DiveScene.ts:4840-4843 */
  addStat(k: keyof Stats, v: number): void {
    const cap = STAT_CAP[k]
    this.st[k] = cap === undefined ? this.st[k] + v : Math.min(cap, this.st[k] + v)
  }

  /** 遗物的"代价"在这里生效。DiveScene.ts:4855-4863 */
  equipRelic(id: RelicId): void {
    if (this.relics.includes(id) || this.relics.length >= RELIC_SLOTS) return
    this.relics.push(id)
    const r = RELIC_DEF[id]
    if (r.onEquip) this.addStat(r.onEquip.stat, r.onEquip.delta)
    this.o2Max = this.layer().o2Max + this.st.o2Bonus
    if (this.o2 > this.o2Max) this.o2 = this.o2Max
    // 过载核心：`w.dmg` 是装备武器时算好的**缓存值** —— 遗物买得晚，就必须重算已有武器，
    // 否则"先挂的武器不吃加成"。不报错，只是数值悄悄不对。V6.33
    this.refreshWeaponDmg()
  }

  /** 这个遗物的条件**此刻**是否满足（HUD 呼吸光用）。DiveScene.ts:4872-4880 */
  relicActive(id: RelicId): boolean {
    switch (id) {
      case 'echo_heart': return this.o2 / this.o2Max < 0.3
      case 'current_fin': return this.noHitT >= 3
      case 'silent_plating': return this.plateT > 0
      case 'abyss_mark': return this.layerIdx > 0
      default: return false
    }
  }

  /** 鱼骨换钱的倍率（只影响钱，不影响回氧）。DiveScene.ts:4883-4887 */
  boneValueMul(): number {
    return 1 + this.st.luck
      + (this.hasRelic('tidal_compass') ? 0.3 : 0)
      + (this.hasRelic('gluttony') ? 1 : 0)
  }

  /** 动态伤害加成（逐帧变化的那些：回声心脏 / 深潜印记）。DiveScene.ts:4895-4904 */
  dmgMulNow(): number {
    let m = (1 + this.st.dmg) * this.sub.dmgMul
    if (this.hasRelic('echo_heart') && this.o2 / this.o2Max < 0.3) m *= 1.5
    if (this.hasRelic('abyss_mark')) m *= 1 + 0.12 * this.layerIdx
    // ---- V6.77d 猎杀节奏 ----
    // ⚠️ **复用 `comboCnt`**（V6.62 骨雨那套连杀计数），不另起一个计时器 ——
    //    两个"连杀"各自计时必然出现"骨雨刚触发、增伤却清零"这种读不出来的错位。
    // ⚠️ 层数用 `Math.min` 钳，**不是**往 `STAT_CAP` 里塞：`st.streak` 是"每层加成"，
    //    买第 7 张的行为必须是"加成更高"而不是"层数更多"（否则面板数值会骗人）。
    if (this.st.streak > 0) m *= 1 + this.st.streak * Math.min(this.comboCnt, STREAK_MAX_LV)
    return m
  }

  // ---------------------------------------------------------------------------
  // V6.33 机制型遗物：绑武器行为的四条（导体缠绕 / 破血锚 / 共鸣腔 / 过载核心）
  // ---------------------------------------------------------------------------
  /** 过载核心 · 伤害：满级（Lv5）+12%，未满级 −8%。无该遗物 = 1。V6.33 */
  private relicDmgMul(lvl: number): number {
    if (!this.hasRelic('overload_core')) return 1
    return lvl >= 5 ? 1.12 : 0.92
  }

  /** 过载核心 · 射速：满级武器间隔 ×0.8（= 射速 +25%）。未满级不惩罚。V6.33 */
  private relicIvMul(lvl: number): number {
    if (!this.hasRelic('overload_core')) return 1
    return lvl >= 5 ? 1 / 1.25 : 1
  }

  /**
   * 重算所有武器的**缓存伤害**。遗物一旦影响武器数值（过载核心），
   * 装备后必须调用 —— 否则"先挂的武器不吃加成"。V6.33
   */
  refreshWeaponDmg(): void {
    for (const w of this.weapons) w.dmg = this.weaponStats(w.id, w.lvl).dmg
  }

  /**
   * 破血锚：鱼叉命中时，对本发**已穿过的其他敌人**各补一刀。V6.33
   *
   * 伤害 = 本发伤害 × 当前暴击倍率 × 30%（**固定值**，不再吃随机暴击）。
   *
   * ⚠️ 刻意**不走 `hurt()`**：否则每次补刀都会命中 `resonance_core` 的暴击溅射分支，
   *    两个遗物同时装会互相引爆。死亡结算复用 `tryKill()`，保证掉骨 / 回氧正常。
   */
  private rendTick(b: Bullet, curIdx: number): void {
    if (!this.hasRelic('bleeding_anchor')) return
    if (b.hit.size <= 1) return
    const rend = b.dmg * (1 + this.st.critMul) * 0.3 * this.dmgMulNow()
    let n = 0
    for (const idx of b.hit) {
      if (idx === curIdx || n >= 3) continue     // 每发最多补 3 次
      const t = this.enemies[idx]
      if (!t || !t.alive) continue
      t.hp -= rend
      t.flash = Math.max(t.flash, 0.12)
      this.emit({ t: 'hit', x: t.x, y: t.y, r: t.r, color: UI.violet, crit: true, dmg: rend, nx: 0, ny: 0 })
      this.tryKill(t)
      n++
    }
  }

  // ==========================================================================
  // 商店
  // ==========================================================================
  /** DiveScene.ts:5126-5143 */
  openShop(): void {
    this.phase = 'shop'
    this.locked = [false, false, false]
    this.sold = [false, false, false]
    this.rerollCost = REROLL_BASE
    if (this.bank < REROLL_BASE) this.bank = 20
    this.rollOffers(true)
    this.bullets = []; this.pulses = []; this.echoes = []; this.acids = []; this.eShots = []
  }

  /** 抽三张（fresh=true 全换；否则保留锁定格）。DiveScene.ts:5153-5165 */
  rollOffers(fresh: boolean): void {
    const alive = this.pool.filter(u => !u.dead || !u.dead(this))
    const from = alive.length >= 3 ? alive : this.pool
    const next = this.rng.shuffle(from.slice()).slice(0, 3)
    if (!fresh) {
      for (let i = 0; i < 3; i++) {
        if (this.locked[i] && !this.sold[i] && this.offers[i]) next[i] = this.offers[i]
      }
    }
    this.offers = next
  }

  /** 买第 i 张。钱不够就什么都不做。DiveScene.ts:5168-5179 */
  buyCard(i: number): void {
    if (this.phase !== 'shop') return
    const up = this.offers[i]
    if (!up || this.sold[i]) return
    if (this.bank < up.cost) return
    this.bank -= up.cost
    up.apply(this)
    this.sold[i] = true
    this.locked[i] = false
  }

  /** DiveScene.ts:5181-5188 */
  reroll(): void {
    if (this.phase !== 'shop') return
    if (this.bank < this.rerollCost) return
    this.bank -= this.rerollCost
    this.rerollCost += REROLL_STEP
    this.rollOffers(false)
  }

  /** DiveScene.ts:5190-5193 */
  toggleLock(i: number): void {
    if (this.sold[i]) return
    this.locked[i] = !this.locked[i]
  }

  /** 离开商店。注意是 startWave() 而不是 advance()。DiveScene.ts:5201-5205 */
  leaveShop(): void {
    if (this.phase !== 'shop') return
    this.startWave()
  }

  // ==========================================================================
  // 层末决策 / 结算
  // ==========================================================================
  /** DiveScene.ts:6176-6180 */
  openDecide(): void {
    this.phase = 'decide'
  }

  /** 继续下潜：扣门票氧气 → 上限压缩 → 收益倍率 +0.5。DiveScene.ts:6183-6213 */
  diveDeeper(): void {
    if (this.phase !== 'decide') return
    const toll = this.layer().toll
    if (this.o2 <= toll) return       // 氧气不够买门票，只能上浮
    this.layerIdx++
    this.waveInLayer = 0
    this.mult += 0.5
    const L = this.layer()
    this.o2Max = L.o2Max + this.st.o2Bonus
    this.o2 = Math.min(this.o2 - toll, this.o2Max)
    this.enemies = []; this.bones = []; this.pulses = []
    this.bullets = []; this.echoes = []; this.acids = []; this.eShots = []
    this.hurtDirT = 0; this.hurtFlash = 0
    const from = LAYERS[this.layerIdx - 1].depthBot
    this.descFrom = from
    // 目标不是下一层顶，而是它的 35% 处
    this.descTo = L.depthTop + (L.depthBot - L.depthTop) * 0.35
    this.descT = 0
    this.phase = 'descending'
    this.layerCardT = 2.6
    this.emit({ t: 'descend', layer: this.layerIdx })
    // 换层震屏：压力舱推进的闷响。放在 descend 之后 —— 渲染层处理 descend 时会
    // clearFx() 清表现池，震屏状态不在表现池里，但顺序上"先换层再震"更自然。
    this.emit({ t: 'shake', ms: 260, intensity: 0.004 })
  }

  /** 上浮兑现：结算，带走 100%。DiveScene.ts:6216-6219 */
  surface(): void {
    if (this.phase !== 'decide') return
    this.showResult(true)
  }

  /**
   * 结算。DiveScene.ts:6305-6309
   *
   * ⚠️ **必须幂等**：`drainOxygen()` 判定溺水后当帧 `updateWave()` 仍会跑完
   * （`update()` 的分支在本帧开头就选定了），于是"最后一波最后一个敌人打死的那一刻
   * 氧气刚好归零"会**同帧**再走一次 `advance() → showResult(true)`。
   * 那会让一局同时抛出 `dead` 与 `runCleared`，并把 `win` 覆盖成 true ——
   * 结算屏显示"上浮成功"，而这一局实际上是淹死的。所以这里挡住第二次调用。
   */
  showResult(win: boolean): void {
    if (this.phase === 'result') return
    this.win = win
    this.phase = 'result'
    this.emit(win ? { t: 'runCleared' } : { t: 'dead' })
  }

  /** 结算屏「再来一次」。DiveScene.ts:6406-6418 */
  restart(): void {
    this.enemies = []; this.bones = []; this.pulses = []
    this.biomass = 0
    this.bank = 0
    this.st = NEW_STATS()
    this.relics = []
    this.noHitT = 0; this.plateT = 0
    this.burstTimer = 0
    this.px = this.W / 2; this.py = this.H / 2
    this.startRun()
  }
}
