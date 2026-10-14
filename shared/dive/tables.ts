/**
 * 潜水战斗循环 · 数值表（引擎无关）
 *
 * 这些常量**逐字**从 `web/src/scenes/DiveScene.ts` 的模块级常量搬来
 * （原文件行号见每个常量上方的注释）。为什么它们是"真源"而不是
 * `shared/gameData.ts`：`gameData.ts` 只被**已废弃的 GameScene** 使用，
 * 而当前正式玩法是 DiveScene，它的数值全是**文件内本地常量**。
 *
 * 约定：
 *   - 本文件零 `cc` / Phaser / Vite 依赖，只有纯数字与结构。
 *   - 百分比类一律存**小数**（0.15 = +15%）。
 *   - 改平衡只改这里，web 与 cocos 各引擎侧都消费同一份。
 */

import { UI } from '../theme'
import type { LayerDef, WaveShape, Stats, RelicDef, RelicId, Kind, WeaponId } from './types'

// ---------------------------------------------------------------------------
// 画布尺寸由调用方注入（Phaser 用 this.scale.width/height，Cocos 用 view 设计分辨率）
// ---------------------------------------------------------------------------

/** 座圈角度刻意避开艏（0°）与艉（180°）。DiveScene.ts:104 */
export const SEAT_ANGLES_DEG = [30, -30, 90, -90, 150, -150]

/**
 * 座圈半径（px，机体中心到塔座中心）。DiveScene.ts:109
 *
 * ⚠️ 2026-10-13 由 40 上调到 48。原因（用户报「炮塔感觉不太好」）：
 *   机体贴图半径 `SUB_D/2 = 44`，而原来座圈半径只有 40 —— 塔座中心**落在机体轮廓之内**，
 *   整座塔被那张亮青色圆盘吃掉，剪影上根本认不出"艇上装了炮"。
 *   48 让塔座中心落在机体外缘（44）之外 4px，塔盘正好压在舷侧，读作"镶嵌在艇缘"。
 *
 * ⚠️ 2026-10-13 补充：渲染层的**机体视觉半径**后来定为 `SEAT_RING_R * 0.90 = 43.2`
 *   （见 `cocos/assets/scripts/view/DiveGame.ts` 的 `BODY_VIS`，用户反馈"机体大了一点点"）。
 *   于是舷侧两座炮心距圆心 `43.3`、球半径 `43.2` → **炮心正好贴在轮廓线上**，
 *   比注释里原写的"压在舷侧"更贴近"镶嵌在艇缘"的本意。**这个值不要跟着改** ——
 *   它是**弹道真值**（子弹出生点），不是画面参数。
 */
export const SEAT_RING_R = 48

/**
 * 座圈的**纵向投影比**（3/4 俯视压扁率）。2026-10-13 新增。
 *
 * ⚠️ 这个值必须与渲染层的机体俯角**一致**（60° 俯角 → 椭圆短轴 = 长轴 × cos60° = 0.5）。
 *
 * 为什么它必须写在**模拟层**而不是渲染层：
 *   `seatPos()` 同时决定「炮塔画在哪」与「子弹从哪出生」（`autoFire` 取 `turretPose`）。
 *   机体既然改成 3/4 斜视，座圈在屏幕上就是**椭圆**；若模拟层还按正圆算，
 *   子弹会从炮口**旁边**飞出来（最坏差 24px）。
 *   把投影放进 `seatPos` → 炮位、炮口闪光、子弹出生点三者在同一坐标系，
 *   整条链路自洽（代价：座圈上下两极的炮位比正圆时**更靠近机体**）。
 */
export const SEAT_RATIO = 0.5

/**
 * 炮圈**摆动**幅度上限（弧度）= 20°。2026-10-13 新增。
 *
 * 用户原话（第十二轮）：「移动的过程中 武器一直在换位置也不太合适」→ 先把座圈**完全冻结**；
 * 看完后回话「完成轻微摆动」→ 改成 **阻尼跟随 + 限幅**。
 *
 * 语义：座圈跟着航向**略微滞后**偏一点（转向时 6 座炮像被"甩"了一点），
 * 站住之后弹簧回中。限幅专治上一版被否掉的毛病 ——
 * 旧版是**整体跟随 aim**，回转体上读作"炮沿着船壳滑一圈"，玩家每秒都在转，非常吵。
 * 20° 小到只当"有生命感的微动"，不足以让炮位换舷。
 */
export const SEAT_SWAY_MAX = (20 * Math.PI) / 180

/**
 * 摆动跟随系数：每帧航向增量里，**留多少比例**滞后到炮圈上（0~1）。
 * 0.55 ⇒ 转向的中段能压到 ±16° 上下（限幅内），视觉上"跟得上但有重量"。
 */
export const SEAT_SWAY_FOLLOW = 0.55

/**
 * 摆动的**弹簧回中速率**（1/s）。越大回中越快、越"甩一下就没"。
 * 5 ⇒ 时间常数 0.2s：松手（停转）后约 0.2s 归零，不会一直吊着偏角。
 */
export const SEAT_SWAY_DECAY = 5

/**
 * 圆形塔座半径（px）。DiveScene.ts:111
 *
 * ⚠️ 2026-10-13 由 12 上调到 16。12 → 直径 24px，在这个尺寸上**放不下任何体积线索**
 *   （投影 / 侧壁 / 受光弧 / 暗弧 四条，每条至少 2px）。16 → 直径 32px 才有像素预算。
 */
export const TURRET_R = 16

/** 发射器（插在塔座上的那件武器）基准尺寸。DiveScene.ts:113 —— 14 → 18，同上：炮管要能被认出来 */
export const EMITTER_SIZE = 18

/** 发射器转塔角速度上限（弧度/秒）。DiveScene.ts:122 */
export const TURRET_SPIN = 16

/** 机体圆盘本体直径（px）。DiveScene.ts:147 */
export const SUB_D = 88

/** 挂载座硬上限。DiveScene.ts:150 */
export const MAX_SEATS = 6

/** 开局座数 = 4（前 4 个座位 ±30 / ±90）。DiveScene.ts:152 */
export const BASE_SEATS = 4

/** 商店刷新定价：8 起、每次 +6。DiveScene.ts:163-164 */
export const REROLL_BASE = 8
export const REROLL_STEP = 6

/** 全场唯一近白：鱼骨与受击闪白专用。DiveScene.ts:167-169 */
export const WHITE = 0xffffff
export const BONE = 0xdcfffb

/** 基础镜头倍率（渲染层用，放在这里是为了让两个引擎取同一个值）。DiveScene.ts:596 */
export const CAM_ZOOM = 1.25

// ---------------------------------------------------------------------------
// 氧气基础数值（V6 §4.2）DiveScene.ts:174-190
// ---------------------------------------------------------------------------
export const O2 = {
  max: 100,
  boneSinkV: 42,
  boneFloor: 46,
  boneFade: 1.0,
  boneBlink: 0.9,
  pickupR: 31,
  burstCost: 20,
  burstCd: 12,
  burstR: 250,
}

/** 回氧基数（普通鱼 size=30 → 5 氧；Boss 单独给 24）。DiveScene.ts:205-208 */
export const BONE_O2 = { o2Base: 3.0 }

/** 玩家基础数值。DiveScene.ts:210-223 */
export const PLAYER = {
  speed: 220,
  r: 20,
  dmg: 12,
  cd: 0.42,
  range: 420,
  pulseSpeed: 620,
  pulseWidth: 26,
  pierce: 1,
  killO2: 0,
}

// ---------------------------------------------------------------------------
// 器械定义表（V6.3 / V6.17 进化 / V6.18 三基础）DiveScene.ts:236-271
// ---------------------------------------------------------------------------
export const WEAPON_DEF: Record<WeaponId, {
  name: string; desc: string
  iv: number; dmg: number; range: number; color: number
}> = {
  sonar:   { name: '声呐共振',   desc: '环形波前 · 群体伤害', iv: 0.42, dmg: 12, range: 420, color: UI.cyanHi },
  gun:     { name: '脉冲机关枪', desc: '高频连射 · 单体',     iv: 0.11, dmg: 7,  range: 520, color: UI.amber },
  torpedo: { name: '追踪鱼雷',   desc: '低频追踪 · 范围爆炸', iv: 1.50, dmg: 30, range: 620, color: UI.danger },
  arc:     { name: '链式电弧',   desc: '瞬发连锁 · 多目标',   iv: 0.90, dmg: 16, range: 460, color: UI.violet },

  gun_gl:   { name: '加特林',   desc: '射速翻倍 · 射程腰斩', iv: 0.052, dmg: 6,  range: 260, color: UI.amber },
  gun_sg:   { name: '霰弹散射', desc: '一次 5 弹扇形 · 近距', iv: 0.44, dmg: 5,  range: 250, color: UI.amber },
  torp_cl:  { name: '集束鱼雷', desc: '一次 3 枚 · 覆盖面',  iv: 1.75, dmg: 15, range: 620, color: UI.danger },
  torp_hv:  { name: '重型鱼雷', desc: '单发重击 · 爆炸更大', iv: 2.40, dmg: 70, range: 660, color: UI.danger },
  arc_ov:   { name: '过载电弧', desc: '跳跃 +4 · 不衰减',    iv: 1.05, dmg: 15, range: 500, color: UI.violet },
  arc_st:   { name: '定点雷暴', desc: '一次电击全部目标',    iv: 2.30, dmg: 12, range: 430, color: UI.violet },
  sonar_rs: { name: '共振炮',   desc: '命中后向邻近弹射',   iv: 0.55, dmg: 9,  range: 420, color: UI.cyanHi },
  sonar_fc: { name: '定向聚焦', desc: '短距强波 · 高伤',    iv: 0.62, dmg: 30, range: 250, color: UI.cyanHi },

  harpoon: { name: '穿透鱼叉', desc: '直线穿透 · 命中拉拽', iv: 0.75, dmg: 20, range: 520, color: UI.jade },
  echo:    { name: '回声炮',   desc: '延迟爆发 · 需预判',   iv: 1.50, dmg: 40, range: 480, color: UI.magenta },
  acid:    { name: '酸液喷射', desc: '地面持续伤害区',      iv: 1.40, dmg: 6,  range: 380, color: UI.jadeHi },

  // V6.29 三基础武器的进化（各 2 分支）。配平口径与 gun_gl / torp_hv 一致：
  // **用射速/单体伤害交换机制或覆盖面**，价一律 66~74。
  harp_tr: { name: '三重鱼叉', desc: '一次 3 叉扇形 · 群体拉拽', iv: 0.90, dmg: 14, range: 480, color: UI.jade },
  harp_cb: { name: '回旋鱼叉', desc: '到程掉头 · 二次穿刺回氧', iv: 0.95, dmg: 17, range: 560, color: UI.jade },
  echo_mu: { name: '多重回声', desc: '三点延时爆炸 · 群爆回氧', iv: 1.60, dmg: 26, range: 440, color: UI.magenta },
  echo_fo: { name: '聚焦回声', desc: '大半径延时爆发 · 高伤',   iv: 2.20, dmg: 90, range: 520, color: UI.magenta },
  acid_fd: { name: '持久酸池', desc: '更大更久 · 池内省氧',     iv: 1.40, dmg: 6,  range: 380, color: UI.jadeHi },
  acid_ra: { name: '酸雨',     desc: '三池成排 · 封锁一线',     iv: 1.70, dmg: 5,  range: 460, color: UI.jadeHi },

  // ---- V6.46 机制型武器（计划书 §5.2 点名、一直没做的那批）----
  // ⚠️ `range` 对陷阱族**没有意义**：气泡雷落在自己脚下，不索敌。写 0 是给
  //    UI 一个诚实的信号（索敌距离显示为"自机"），不是偷懒。
  mine:    { name: '气泡雷',   desc: '原地布雷 · 需预判走位', iv: 0.55, dmg: 18, range: 0, color: UI.cyanHi },
  mine_ch: { name: '连锁雷',   desc: '引爆邻近地雷 · 连环',   iv: 0.55, dmg: 15, range: 0, color: UI.cyanHi },
  mine_o2: { name: '氧气雷',   desc: '爆炸回氧 · 伤害腰斩',   iv: 0.55, dmg: 11, range: 0, color: UI.jadeHi },
  net:     { name: '网发射器', desc: '减速 50% · 伤害极低',   iv: 1.10, dmg: 8,  range: 400, color: UI.jade },
  net_el:  { name: '电网',     desc: '减速加深 · 附带灼烧',   iv: 1.10, dmg: 6,  range: 400, color: UI.violet },
  net_cv:  { name: '驯化网',   desc: '策反敌人互斗 4s',       iv: 1.10, dmg: 4,  range: 400, color: UI.cyanHi },
  lure:    { name: '生物光诱饵', desc: '聚怪 5s · 完全无伤',  iv: 2.40, dmg: 0,  range: 300, color: UI.amber },
  lure_bo: { name: '爆炸诱饵', desc: '聚怪后自爆',           iv: 2.40, dmg: 55, range: 300, color: UI.amber },
  lure_wl: { name: '光墙',     desc: '三诱饵成排 · 吸引带',   iv: 2.40, dmg: 0,  range: 300, color: UI.amber },
}

/**
 * 进化后的 id 归到哪个**基础族** —— autoFire 按族分支，族内只改参数。
 * DiveScene.ts:720-729
 */
export function weaponFamily(id: WeaponId):
  'sonar' | 'gun' | 'torpedo' | 'arc' | 'harpoon' | 'echo' | 'acid'
  | 'mine' | 'net' | 'lure' {
  if (id.startsWith('gun')) return 'gun'
  if (id.startsWith('torp')) return 'torpedo'
  if (id.startsWith('arc')) return 'arc'
  // V6.46 三个新族。`mine_ch` / `net_cv` / `lure_wl` 都靠前缀归族 ——
  // 所以它们的 id **必须**保持 `<族>_<后缀>` 形状（不能用别的命名习惯）。
  if (id.startsWith('mine')) return 'mine'
  if (id.startsWith('net')) return 'net'
  if (id.startsWith('lure')) return 'lure'
  if (id === 'harpoon') return 'harpoon'
  if (id === 'echo') return 'echo'
  if (id === 'acid') return 'acid'
  return 'sonar'
}

/** 商店卡 id → 武器 id 的**修正表**（w_torp / w_harp 是早期缩写）。DiveScene.ts:740-743 */
export const CARD_WEAPON_ID: Record<string, WeaponId> = {
  w_torp: 'torpedo',
  w_harp: 'harpoon',
}

/** 基础武器 → 它的两条进化分支。DiveScene.ts:746-751 */
export const EVOLUTIONS: Record<string, [WeaponId, WeaponId]> = {
  gun: ['gun_gl', 'gun_sg'],
  torpedo: ['torp_cl', 'torp_hv'],
  arc: ['arc_ov', 'arc_st'],
  sonar: ['sonar_rs', 'sonar_fc'],
  // V6.29：补齐三把零进化武器 —— 7 把武器现在**全部**有 2 条分支（共 14 形态）
  harpoon: ['harp_tr', 'harp_cb'],
  echo: ['echo_mu', 'echo_fo'],
  acid: ['acid_fd', 'acid_ra'],
  // V6.46：三把机制武器的分支。A 条深化机制本身，B 条换方向。
  mine: ['mine_ch', 'mine_o2'],
  net: ['net_el', 'net_cv'],
  lure: ['lure_bo', 'lure_wl'],
}

/** 反查：某个进化形态是从哪把基础武器变来的。DiveScene.ts:754-760 */
export function evolutionBase(evo: WeaponId | null): WeaponId | null {
  if (!evo) return null
  for (const base of Object.keys(EVOLUTIONS)) {
    if (EVOLUTIONS[base].includes(evo)) return base as WeaponId
  }
  return null
}

// ---------------------------------------------------------------------------
// 属性系统（V6.8）DiveScene.ts:329-338
// ---------------------------------------------------------------------------
/** 属性上限表。armor / dodge 必须封顶，否则线性叠到 100% 就是无敌。DiveScene.ts:329-331 */
export const STAT_CAP: Partial<Record<keyof Stats, number>> = {
  armor: 0.6, dodge: 0.6, crit: 0.75, twinRate: 0.6,
}

/** 开局属性。killO2 默认 0 = "击杀不回氧"是初始设定，靠卡解锁。DiveScene.ts:334-338 */
export const NEW_STATS = (): Stats => ({
  dmg: 0, rate: 0, crit: 0, critMul: 0.8, range: 0,
  armor: 0, dodge: 0, speed: 0, pickup: 0, luck: 0, regen: 0,
  o2Bonus: 0, killO2: PLAYER.killO2, twinRate: 0,
})

/** 属性的显示元数据（顺序 = 商店属性面板排列顺序）。DiveScene.ts:346-360 */
export const STAT_META: Array<{
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

/** 商店属性卡的 卡 id → Stats 键 映射（tank→o2Bonus、gill→killO2）。DiveScene.ts:369-373 */
export const STAT_CARD: Record<string, keyof Stats> = {
  speed: 'speed', pickup: 'pickup', tank: 'o2Bonus', gill: 'killO2',
  s_dmg: 'dmg', s_rate: 'rate', s_crit: 'crit', s_range: 'range',
  s_armor: 'armor', s_dodge: 'dodge', s_regen: 'regen', s_luck: 'luck',
}

// ---------------------------------------------------------------------------
// 遗物（被动道具，V6.8）DiveScene.ts:392-454
// ---------------------------------------------------------------------------
/**
 * 被动槽（遗物槽）上限。**V6.30 P0-②：4 → 6**（对齐计划书 §5.1 的"被动槽 6"）。
 *
 * 为什么是 6 而不是 8：6 是"扩 1.5× build 空间"的拐点（V6.28 §5.2），
 * 再多会稀释 —— 遗物池当前只有 8 个，槽 8 等于全装，select 就没了。
 *
 * ⚠️ **这个值单独改没有意义，必须与 P1-4 一起做**：槽 4→6 而遗物池仍是 8 个，
 *    每次商店能凑出的组合反而变少（更多空槽 → 更容易"没得挑"）。
 *    真正拉开组合空间的是"遗物改武器行为"（P1-4），不是槽数本身。
 */
export const RELIC_SLOTS = 6

/**
 * 遗物定义表。
 *
 * ⚠️ 与 web 版的一处**刻意差异**：原实现 `onEquip?: (s: DiveScene) => void`
 * 直接改场景字段；这里改写成**数据化**的 `{ stat, delta }`，由
 * `DiveWorld.equipRelic()` 落地。目的是让遗物表不依赖任何具体世界实现，
 * 两个引擎共用同一份。当前唯一用到的是 osteoblast（o2Bonus −15）。
 */
export const RELIC_DEF: Record<RelicId, RelicDef> = {
  echo_heart: {
    id: 'echo_heart', name: '回声心脏', price: 60,
    desc: '氧气低于 30% 时，伤害 +50%',
    cost2: '无代价 —— 但你得敢留在那条线上',
  },
  osteoblast: {
    id: 'osteoblast', name: '骨殖转化', price: 45,
    desc: '击杀回氧 ×2',
    cost2: '氧气上限 −15',
    onEquip: { stat: 'o2Bonus', delta: -15 },
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
  // -------------------------------------------------------------------------
  // V6.33 机制型遗物 4 条（P1-#4）
  // 判据：**必须改变武器行为**，不能是"全局 +X%"。这 4 条分别绑
  //       电弧 / 鱼叉 / 回声 / 武器等级 四个维度 —— 组合空间才是这一刀的价值。
  // -------------------------------------------------------------------------
  conductor_coil: {
    id: 'conductor_coil', name: '导体缠绕', price: 62,
    desc: '链式电弧每跳一次回 0.8 氧',
    cost2: '氧气上限 −10 —— 线圈本身也在漏',
    onEquip: { stat: 'o2Bonus', delta: -10 },
  },
  bleeding_anchor: {
    id: 'bleeding_anchor', name: '破血锚', price: 58,
    desc: '鱼叉命中时，对本次已穿过的敌人各补 30% 暴击伤害（每发最多 3 次）',
  },
  resonance_chamber: {
    id: 'resonance_chamber', name: '共鸣腔', price: 60,
    desc: '回声爆炸时，在最近 2 个未被波及的敌人处各生成一个小回声（55% 半径 / 40% 伤害）',
  },
  overload_core: {
    id: 'overload_core', name: '过载核心', price: 68,
    desc: '满级（Lv5）武器：射速 +25% / 伤害 +12%',
    cost2: '未满级武器伤害 −8% —— 它逼你专精，不奖励平均铺',
  },
}

// ---------------------------------------------------------------------------
// 五层（V6 §3.4）DiveScene.ts:521-542
// ---------------------------------------------------------------------------
/**
 * ★ 氧气收支曲线（V6.23 重算 —— **这是 P0 止损线唯一要守的数，别凭手感改**）
 *
 * 全捡（理论最优）：L1 1.28× → L2 1.22× → L3 1.12× → L4 1.03× → L5 0.98×
 * 常规走位（约 6~7 成拾取率）：0.83 → 0.79 → 0.73 → 0.67 → 0.64
 *
 * ⚠️ 改 LAYER_WAVES 时每层 4 波的总时长必须各自保持 **156s**。
 */
export const LAYERS: LayerDef[] = [
  // L1 阳光带：教学层，**不给机制**
  { name: '阳光带', sub: 'SUNLIT', mech: '', tip: '没有额外机制 —— 先把手感练顺',
    o2Max: 100, drain: 1.00, dropCap: 70,  toll: 15, vis: 1.00, depthTop: 0,     depthBot: 200,
    ventPush: 0,  current: 0,  pressure: 0,    surge: false, tint: 0x2a6f8a, motes: 34,  hpMul: 1.00, cntMul: 1.00, dashMul: 0.5, driftRatio: 0.00 },
  // L2 弱光带：**暗流**
  { name: '弱光带', sub: 'TWILIGHT', mech: '暗流', tip: '水流在缓慢旋转，鱼群和你都会被带偏',
    o2Max: 100, drain: 1.35, dropCap: 90,  toll: 20, vis: 0.80, depthTop: 200,   depthBot: 1000,
    ventPush: 0,  current: 34, pressure: 0,    surge: false, tint: 0x1d5a5a, motes: 48,  hpMul: 1.35, cntMul: 1.25, dashMul: 1.0, driftRatio: 0.12 },
  // L3 午夜带：**涌流**
  { name: '午夜带', sub: 'MIDNIGHT', mech: '涌流', tip: '它们从同一个方向压上来 —— 退路只有一条',
    o2Max: 85,  drain: 1.80, dropCap: 110, toll: 25, vis: 0.40, depthTop: 1000,  depthBot: 4000,
    ventPush: 0,  current: 0,  pressure: 0,    surge: true,  tint: 0x14203c, motes: 70,  hpMul: 1.80, cntMul: 1.50, dashMul: 1.1, driftRatio: 0.18 },
  // L4 热泉带：**热泉**
  { name: '热泉带', sub: 'HYDROTHERMAL', mech: '热泉', tip: '上升的热流会顶开你 —— 停不住',
    o2Max: 70,  drain: 2.40, dropCap: 135, toll: 30, vis: 0.25, depthTop: 4000,  depthBot: 6000,
    ventPush: 190, current: 0, pressure: 0,   surge: false, tint: 0x3a1a10, motes: 90,  hpMul: 2.40, cntMul: 1.80, dashMul: 1.2, driftRatio: 0.15 },
  // L5 深渊带：**压力**
  { name: '深渊带', sub: 'THE ABYSS', mech: '压力', tip: '每过一波，舱体再压掉一截氧气上限',
    o2Max: 60,  drain: 3.00, dropCap: 160, toll: 0,  vis: 0.10, depthTop: 6000,  depthBot: 11000,
    ventPush: 0,  current: 0,  pressure: 0.06, surge: false, tint: 0x0a0614, motes: 110, hpMul: 3.20, cntMul: 2.10, dashMul: 1.3, driftRatio: 0.22 },
]

/**
 * 每层 4 波的**节奏签名**（V6.23 从"全局一张表"拆开）。
 * ⚠️ **每层 4 个 dur 之和必须 = 156s**。DiveScene.ts:567-592
 */
export const LAYER_WAVES: WaveShape[][] = [
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

/**
 * 素材实际基准角补偿（弧度）。**基准值是 π，不是 0**（三张贴图都头朝左）。
 * DiveScene.ts:614-618
 */
export const TEX_BASE_ROT: Partial<Record<Kind, number>> = {
  swarm: Math.PI - 0.10,
  dash: Math.PI + 0.02,
  drift: Math.PI,
}

/** 敌人贴图 key（渲染层按它取资源）。DiveScene.ts:1486 / 1572 */
export const ENEMY_TEX: Record<Kind, string> = {
  swarm: 'f_swarm',
  dash: 'f_dash',
  drift: 'f_drift',
  boss: 'f_dash',
}
