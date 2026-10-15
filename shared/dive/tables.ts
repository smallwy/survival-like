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

/**
 * 座圈角度：座位在**机体水平面**内的方位（俯视语汇）。
 *
 * ⚠️ V6.71 起它**不再决定屏幕位置** —— 侧视下炮位的真源是 `SEAT_MOUNTS`。
 * 它剩下的两个作用：
 *   ① `mountPlan().ang`（由 `SEAT_MOUNTS` 反推的自洽值，供调试/商店图示读"座位朝向"）；
 *   ② `Title.ts` 主界面中央潜航器的**六个姿态推进器口** —— 那是真正的俯视环形机构，
 *      与战斗内的侧视炮位是两套视图，不共用几何，只共用"六个、避开艏艉"这套语汇。
 *
 * ⚠️ 仍刻意避开艏（0°）与艉（180°）：主界面那圈口若正对艏艉会读成"推进器"。
 */
export const SEAT_ANGLES_DEG = [30, -30, 90, -90, 150, -150]

/**
 * 机体侧视**总高**（px）。V6.71 从 `DiveGame.ts` 搬到这里 —— 它是**机体尺寸**，
 * 而座位挂点要用"机体半高"做归一化，必须与座位表同源（见 `SEAT_MOUNTS`）。
 * 视图层改 import，不要在渲染层再抄一份。
 */
export const HULL_H = 56

/**
 * 侧视炮位挂点表（V6.71，**取代 `SEAT_RING_R` × `SEAT_RATIO` 的算法**）。
 *
 * ---------------------------------------------------------------------------
 * 为什么推翻算法（用户原话：「座圈不对吧 按照侧视的角度不应该是上下是炮空比较合适吗
 *   炮孔装上去的发射器要有具体感 就像真的装上去 设计一样」）
 * ---------------------------------------------------------------------------
 * 旧算法把 6 座放在「水平面内的一个圆」上，再按 `SEAT_RATIO` 压扁投影到侧视：
 *   `x = R·cos(a)`、`y = R·sin(a)·K` ⇒ 6 座沿一条**扁椭圆**排开。
 * 在 88×56 的梭形上，这个读法有三个硬伤：
 *   ① `±30°/±150°` 四座落在 `x = ±41.6`，而**机体半长只有 44** —— 它们骑在艇身
 *      几乎收尖的艏艉上，炮座一半悬空，读作"沿船边贴了一圈盘子"，而不是"装在艇上的炮口"；
 *   ② `±90°` 两座压在 `y = ±28`（机体最高/最低边缘），另四座在 `y = ±14` ——
 *      **六个 y 值里只有两组**，且上下不对称（0 座时上下各 3 座，但 y 只有 ±28 / ±14），
 *      侧视一眼看过去是"两排",可每一排内部毫无节奏；
 *   ③ 它是**算出来的**，于是"炮口该长在艇体哪个部位"这件事没有落点可改 ——
 *      用户说"要真的装上去的设计"，改算法不如改**安装点**。
 *
 * ---------------------------------------------------------------------------
 * 新读法：**背脊 3 座 + 腹部 3 座**，像真实的潜艇鱼雷舱那样沿艇身纵向排列
 * ---------------------------------------------------------------------------
 * `SEAT_MOUNTS[i] = [u, v]`，归一化到机体轮廓坐标系：
 *   · `u ∈ [-1, 1]` 沿艇长（+1 = 艏），乘 `SUB_D/2`；
 *   · `v ∈ [-1, 1]` 沿艇高（-1 = 艇背/上缘，+1 = 艇腹/下缘），乘 `HULL_H/2`。
 *
 * ⛔ **背是负、腹是正**（sim 的 y 向下为正）—— 写反了整套炮位会翻到艇腹下面去，
 *   而且**不会报错**，只会看着"炮装错地方了"。
 *
 * 排布规则（每一条都由预览图 `tools/preview_hull_side.py --big` 核过）：
 *   · **背脊 3 座全部避开指挥塔**：V6.71 把塔前移到 `u ∈ [0.30, 0.72]`
 *     （真实潜艇的指挥围壳本来就在**前段**，侧视轮廓也更稳），
 *     背脊于是从 `u = 0.12` 起（塔艉侧）一路排到 `u = -0.68`。
 *     ⚠️ 若把塔放回中段（`u ∈ [0.05, 0.43]`），背脊只剩 37px 可用，
 *     塞不下 3 座 —— 这是**塔与背脊炮位争同一条中轴线**，必须一起挪。
 *   · **腹侧 3 座不受此限**（腹部空无一物），且刻意与背脊**交错约 0.06**——
 *     完全对齐的两排会读作"一根竖直的桁架"，交错才读作"两列舱口"。
 *   · 每座的 `v` 都**贴住轮廓线** ⇒ 座心落在艇缘内侧 1~3px。
 *     ⚠️ **艉部两座的 `v` 明显往中间收**（背 -0.79 / 腹 0.73）：
 *     `u = -0.68` 处艇缘只剩 `v ≈ -0.82`，照抄中段的 -0.95 会让炮座**浮在艇外**。
 *     电池排跟着艇身一起收窄，才是"装在艇上的"，不是"一排浮在半空"。
 *
 * ⚠️ **纵向间距不能小于 `MOUNT_BASE_R × 1.6`**（即 6 座之间留出一条缝）：
 *   预览图试过 `u = 0.30 / -0.12 / -0.52`（间距 0.18 × 44 ≈ 8px）——
 *   底板半宽 12px ⇒ **三座底板互相压在一起**，读作"一块长条平台"而不是三门炮。
 *   现在间距 0.46 ≈ 20px，是底板宽度的 1.6 倍刚好留缝。
 *
 * ⚠️ `v` 与 `HULL_OUTLINE` **数值耦合**（改动轮廓点必须重算这张表）：
 *   `u = 0.12` 处轮廓 `v = -0.984`；`u = -0.28` 处约 `-0.964`；`u = -0.68` 处约 `-0.820`。
 *   所以背三座的 `-0.95 / -0.93 / -0.79` 是**贴着这条曲线**取的，不是随手写的整数。
 *
 * ⚠️ 为什么必须写在**模拟层**（这条理由与视角无关，长期成立）：
 *   `seatPos()` 同时决定「炮塔画在哪」与「子弹从哪出生」（`autoFire` 取 `turretPose`）。
 *   挂点若只做在渲染层，子弹会从炮口**旁边**飞出来。
 *
 * ⚠️ 这是**安装位置**，不是**战斗数学**：射程 / 伤害 / 索敌优先级 / 开火频率全部不变，
 *   变的只有「同一个座位在屏幕上画在哪、从哪出弹」。
 */
export const SEAT_MOUNTS: ReadonlyArray<readonly [number, number]> = [
  [0.12, -0.95],    // 0 背·前（紧贴指挥塔艉侧）
  [0.06, 0.95],     // 1 腹·前（与背脊交错 0.06）
  [-0.28, -0.93],   // 2 背·中
  [-0.34, 0.92],    // 3 腹·中
  [-0.68, -0.79],   // 4 背·后（扩容座）—— 艇身在此收窄，v跟着抬下来
  [-0.74, 0.73],    // 5 腹·后（扩容座）
]

/**
 * 槽底**内孔**半径（px）—— 发射器炮口真正穿过去的那一圈。
 *
 * V6.76 起它是"槽里的第二级"：外圈是 `SLOT_HW/SLOT_HD` 的**发射槽**（在位图上，
 * 见下），槽底中央再开这个圆孔 ⇒ 两级进深 = 「通到艇内的发射口」。
 * 取值仍受约束：必须 **小于槽半宽** 且 **大于发射器根部半宽**。
 */
export const SEAT_PORT_R = 4

/**
 * **发射槽**（机体位图自带的开孔）。V6.76 新增 —— 用户原话：
 *   「我要的是你机型图自带开孔的发射槽，发射装置是直接装上去的，漏出发射头，
 *     不是你画上去的突兀感」。
 *
 * 症结：V6.74 的插座是**矢量画在艇身外面**的梯形悬臂台（`MOUNT_BASE_R=15` ⇒
 * 台面整个伸在 `HULL_OUTLINE` 之外），所以六座读作"贴在艇上的积木"。
 * ⇒ 改成**机体位图自己带槽**：`tools/prep_sub_art.py` 按这张表在图上挖 6 个
 *   圆角矩形凹槽（含内壁阴影 / 槽口亮沿），渲染层不再画任何凸出物，
 *   发射器**从槽里长出来**、只露发射头。
 *
 * 几何语义（与 `SEAT_MOUNTS` 同坐标系）：
 *   · `SLOT_HW` = 槽**半宽**（沿艇长方向，乘 `SUB_D/2` 的那条轴）；
 *   · `SLOT_HD` = 槽**深度**（沿挂点法线**往艇内**量，从座心起算）。
 *
 * 取值判据（三个数一起看，动一个必须核另外两个）：
 *   ① 槽宽 `2×SLOT_HW = 13px` < 相邻座间距 `0.46×44 ≈ 20px` ⇒ 六槽之间留得住缝
 *      （连成一条长沟就变成了"一道导轨槽"，不是六个发射位）；
 *   ② 槽深 `SLOT_HD = 6px` 必须 ≥ 发射器机匣的**尾部入槽量**（见 `drawTurret`
 *      的 `rOut`，尾端落在 `−4.1px`）—— 否则机匣尾巴会压在艇身皮肤上，
 *      读作"炮躺在甲板上"；同一条也决定"槽露在柱脚两侧的那段暗边有多长"，
 *      太浅（试过 5px）在实机上只剩一条缝。
 *   ③ 槽宽要略小于转座直径（`2×MOUNT_RING_R = 14`）⇒ 装炮时转座**正好塞满槽口**，
 *      读作"插件塞进槽里"，而不是"槽比插件大，插件在里面晃"。
 */
export const SLOT_HW = 6.5
export const SLOT_HD = 6

/**
 * 炮圈**摆动**幅度上限（弧度）= 20°。
 *
 * ⚠️ V6.71 **语义变了**：挂点从「可旋转的座圈」改成「焊在艇身上的固定炮位」
 *   （`SEAT_MOUNTS`）之后，**炮座本身不再移动** —— 真实潜艇的炮位就是螺栓固定的，
 *   转向时艇转、炮座跟着艇转，不存在"座圈在机体上滑"。
 *   摆动因此改挂在**炮管的待机角**上（`slewTurretAims` 的无目标分支：炮口朝向
 *   `aim + sway`），效果是"转向时炮口略微滞后"，而座与孔的关系始终刚性。
 *
 * ⚠️ 历史（本条被否掉的写法，留档）：旧版把 `sway` 加在**座位角**上、于是 6 座炮
 *   沿座圈一起偏 —— 用户 2026-10-13 的原话是「移动的过程中 武器一直在换位置也不太合适」，
 *   当时只压到 ±20° 才勉强接受。V6.71 换成"只摆炮口、不摆炮座"后，
 *   这个限幅可以保留（它现在治的是炮口滞后过冲），但**绝不能**再拿它位移座。
 */
export const SEAT_SWAY_MAX = (20 * Math.PI) / 180

/**
 * 摆动跟随系数：每帧航向增量里，**留多少比例**滞后到炮口上（0~1）。
 * 0.55 ⇒ 转向的中段能压到 ±16° 上下（限幅内），视觉上"跟得上但有重量"。
 */
export const SEAT_SWAY_FOLLOW = 0.55

/**
 * 摆动的**弹簧回中速率**（1/s）。越大回中越快、越"甩一下就没"。
 * 5 ⇒ 时间常数 0.2s：松手（停转）后约 0.2s 归零，不会一直吊着偏角。
 */
export const SEAT_SWAY_DECAY = 5

/**
 * ⛔ **V6.76 起它不再是任何几何的尺寸** —— 保留常量只为两处旧消费者：
 *   ① `world.ts` 的出弹点外推（`MUZ = MOUNT_BASE_R × 0.85`，**刻意不动数值**，
 *      弹道属于战斗手感，不该跟着视觉一起改）；
 *   ② `Hud.ts` 商店里的炮位示意图（那里画的是"最多 6 个座"的示意，不是实机安装件）。
 *
 * 历史语义（V6.71 立、V6.76 废）：炮座**安装底板**半径，"底板 → 炮口开孔 →
 * 炮身转座 → 炮管"四级台阶里的第一级。
 * ⚠️ 之所以废掉：那块底板的台面**整个伸在 `HULL_OUTLINE` 之外**（`dOut = 15.75px`），
 *   六座因此读作"贴在艇上的六块积木"——用户 2026-10-15 的原话是
 *   「不是你画上去的突兀感」。`Graphics` 在艇身外面画任何零件都必然是贴纸。
 *   ⇒ 安装结构改成「**机体位图自带的槽**（`SLOT_HW/SLOT_HD`）+ 插进槽里的柱脚」
 *     （`DiveGame.drawTurret` 的 `rOut = MOUNT_RING_R × 0.90`），底板整段删除。
 */
export const MOUNT_BASE_R = 15

/**
 * 炮身**转座**半径（px）。装进槽里的柱脚**顶端**那一圈。
 *
 * 约束：`SEAT_PORT_R(4)` < `SLOT_HW(6.5)` ≲ `MOUNT_RING_R(7)`，且相邻两级的
 * **外缘半径差 ≥ 3px**（`4→6.5` 差 2.5 / `6.5→7` 差 0.5 —— 槽那一级靠**明暗**
 * 而不是靠半径读出来，所以不受这条约束）。
 * ⚠️ `MOUNT_RING_R` 与 `SLOT_HW` 必须**接近**：转座正好压在槽口上 ⇒
 * "插件塞满槽口"；转座比槽小一大圈 ⇒ "在里面晃"，比槽大 ⇒ 又变成"盖在艇上"。
 */
export const MOUNT_RING_R = 7

/**
 * 旧「圆形塔座半径」—— **V6.71 已作废**，保留名字以免旧引用静默变 0。
 *
 * 它的存在理由（俯视球核时代）是"塔座中心要落在机体轮廓之外"；侧视下座焊在艇缘上，
 * 不再需要"落在机体外"，所以半径改由上面三个 `MOUNT_*` 分工承担。
 * ⛔ 不要在渲染层再引用它 —— 用 `MOUNT_BASE_R` / `MOUNT_RING_R` / `SEAT_PORT_R`。
 */
export const TURRET_R = MOUNT_BASE_R

export const EMITTER_SIZE = 18

/**
 * 发射器转塔**角速度安全上限**（弧度/秒）。DiveScene.ts:122
 *
 * ⚠️ 值**保持旧的 16 不变**：V6.77 改的只是"怎么逼近目标"（见下面两个 `TURRET_OMEGA_*`），
 *    这个上限继续当**兜底**用 —— 常规转向的峰值由 `0.368·ω·Δθ` 决定，够不到它；
 *    只有 180° 掉头（峰值 `0.368·ω_track·π ≈ 23`）才会贴住。
 */
export const TURRET_SPIN = 16

/**
 * 转塔转向的**临界阻尼固有频率**（弧度/秒）—— 待机 / 索敌**两档**，这是刻意的。
 *
 * 症结（用户 2026-10-15）：「现在有个点 是开局往下射 有点突兀」「要有丝滑的旋转感觉」。
 * 无头探针实测旧写法：开局下潜（`aim` 从 0 跳到 +90°）时炮口 **0.1s 就转完 90°** ——
 * 旧写法 `step = clamp(rel*min(1,dt*14), ±TURRET_SPIN*dt)` 是**恒速钳位**：
 * 第一帧直接满速（917°/s）、最后一帧直降为 0 ⇒ 速度曲线是**方波**，读起来就是"啪"一下。
 *
 * 新写法 = 临界阻尼二阶系统，`slewTurretAims` 里用**解析解**递推（见那里的注释）：
 *   · **构造上不过冲**（临界阻尼是最快的无过冲响应）⇒ 炮口不会越过目标再回头；
 *   · **速度曲线天生是钟形**（起转加速 / 到位减速）—— "丝滑"的全部来源；
 *   · 解析解对**任意 dt** 都精确 ⇒ 帧率抖动不会让它变成过冲。
 *
 * 为什么是**两档**（这一条是实测逼出来的，不是设计洁癖）：
 *   单速度试过 —— 冒烟场景 `run(20261013, 120s)` 在一档 ω≤8 时**溺水**（`minO2 = 0`）。
 *   但全档位扫描又显示 `hits` 只在 146~152 之间抖（噪声级），说明**命中率对转速不敏感**，
 *   真正决定生死的是 O2 掉落的连锁运气 —— 也就是说"单速度会不会过"是**混沌**决定的。
 *   ⇒ 与其把 ω 卡在悬崖边上，不如把两件事分开：
 *   · **待机归中**（无目标，`want = aim + sway`）：慢、丝滑 —— 用户在开局/巡航时**看的就是这一段**；
 *   · **索敌跟随**（有目标）：保持接近旧值的响应，**不动战斗手感**。
 *   领域上也自洽：待机归位是"机械臂缓慢回中"，索敌是"伺服锁上去"，本来就该是两个观感。
 *
 * 量级（step = 90°）：峰值 `0.368·ω·Δθ`、到 90% `≈2.3/ω`、到 ±2% `≈5.8/ω`。
 * | 档 | ω | 峰值角速度 | 到 90% | 到 ±2% |
 * |---|---|---|---|---|
 * | 待机 | `7.8` | 258°/s | 0.30s | 0.74s |
 * | 索敌 | `20` | 663°/s | 0.12s | 0.29s |
 * | （旧写法） | — | **917°/s** | 0.07s | 0.22s |
 *
 * ⚠️ **这两档不是纯表现参数**：炮口角同时是子弹的出膛方向（`autoFire` 取 `turretPose().ang`），
 *    索敌档因此必须保持"跟得上"。⛔ 改之前先跑 `tools/dive_sim_smoke.js` 的波次推进断言。
 * ⚠️ 它同时给出**机械滞后**：目标匀速移动时稳定滞后 ≈ `2·目标角速度/ω`（待机档更明显）
 *    —— 这正是"炮口略微滞后"的既有观感，不要去补偿掉。
 */
export const TURRET_OMEGA_IDLE = 7.8

/** 索敌档频率（见上表）。⚠️ 它决定命中率，改动必须过冒烟闸门。 */
export const TURRET_OMEGA_TRACK = 20

/**
 * 机体**艇身总长**（px）。2026-10-14 侧视改造（V6.54）后，语义由「圆盘直径」
 * 改为「**艇长**」—— 艇高见同文件的 `HULL_H = 56`（88:56 ≈ 1.57:1）。
 *
 * ⚠️ 与 `HULL_H` 一起构成**座位的归一化基准**（`SEAT_MOUNTS` 的 u/v 分别乘这两个的一半），
 *   且 `HULL_OUTLINE`（视图层）的 y 用满 `[-1,1]` ⇒ 改这两个值必须重算 `SEAT_MOUNTS` 的 v，
 *   否则炮位会脱离艇缘（**不报错，只是看着炮浮在艇外**）。
 */
export const SUB_D = 88

/** 挂载座硬上限。DiveScene.ts:150 */
export const MAX_SEATS = 6

/** 开局座数 = 4（背 2 + 腹 2）。DiveScene.ts:152 */
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
//
// ★★ **V6.80 射速重定标**（用户 2026-10-15：「脉冲机关枪和其他的发射器的施法速度
//    是不是太快了 你评估下」）：
//
//   病根不是基础射速，是**射速复利** —— `ivLast` 上有 4 个乘数叠在同一轴：
//       等级(÷1.48 @5级) × 双联座(1+twinRate) × 高压供能(1+rate) × 过载核心(÷1.25)
//   ⇒ `gun_gl` 成型后实测 **≈74 发/秒**（屏幕上是一条不间断的光带，看不见单发）。
//
//   口径（用户拍板 = **抬基础 + 等比补伤害**）：
//     · 只动**基础款 iv < 1.0s** 的族（gun / sonar / arc / harpoon / mine）——
//       它们的"快"是设计问题；`torpedo`(1.5) / `echo`(1.5) / `acid`(1.4) /
//       `net`(1.1) / `lure`(2.4) 本来就慢，**一律不动**。
//     · 整族 **iv ×1.36**，**dmg 按同一比例补偿** ⇒ **DPS 逐条不变**，
//       只是"每发更大更稀"。★ 这条是硬约束：DPS 一动，击杀速度就动，
//       **P0 收支曲线**（全捡 1.28×→0.98× / 常规 0.83×→0.64×）跟着动。
//     · `gun_gl` 是离群值（基础 19.2 发/秒）⇒ 单独多压一档到 **0.08**（×1.54），
//       dmg 同步按 ×1.54 补。
//   ⚠️ 本口径**没有**给复利设上限 —— 成型后仍会比 1 级快得多（复利保留是刻意的：
//      那是养成手感的一部分）。若实机仍嫌密，再谈"封顶"（见 `docs/武器与战斗表现问题归纳_V6.80.md` §2 方案 A）。
// ---------------------------------------------------------------------------
export const WEAPON_DEF: Record<WeaponId, {
  name: string; desc: string
  iv: number; dmg: number; range: number; color: number
}> = {
  sonar:   { name: '声呐共振',   desc: '环形波前 · 群体伤害', iv: 0.57, dmg: 16.3, range: 420, color: UI.cyanHi },
  gun:     { name: '脉冲机关枪', desc: '高频连射 · 单体',     iv: 0.15, dmg: 9.5,  range: 520, color: UI.amber },
  // ★ V6.80：`torpedo` 族颜色 `danger` → `ember`。
  //   `danger` 的定位是「全场唯一纯红，只允许用在致命预警」（见 `theme.ts`）——
  //   玩家自己的弹体染预警色 ⇒ 分不清"这是危险还是我的武器"（用户：「红色有点突兀」）。
  torpedo: { name: '追踪鱼雷',   desc: '低频追踪 · 范围爆炸', iv: 1.50, dmg: 30, range: 620, color: UI.ember },
  arc:     { name: '链式电弧',   desc: '瞬发连锁 · 多目标',   iv: 1.22, dmg: 21.8, range: 460, color: UI.violet },

  gun_gl:   { name: '加特林',   desc: '射速翻倍 · 射程腰斩', iv: 0.080, dmg: 9.2,  range: 260, color: UI.amber },
  gun_sg:   { name: '霰弹散射', desc: '一次 5 弹扇形 · 近距', iv: 0.60, dmg: 6.8,  range: 250, color: UI.amber },
  torp_cl:  { name: '集束鱼雷', desc: '一次 3 枚 · 覆盖面',  iv: 1.75, dmg: 15, range: 620, color: UI.ember },
  torp_hv:  { name: '重型鱼雷', desc: '单发重击 · 爆炸更大', iv: 2.40, dmg: 70, range: 660, color: UI.ember },
  arc_ov:   { name: '过载电弧', desc: '跳跃 +4 · 不衰减',    iv: 1.43, dmg: 20.4, range: 500, color: UI.violet },
  arc_st:   { name: '定点雷暴', desc: '一次电击全部目标',    iv: 3.13, dmg: 16.3, range: 430, color: UI.violet },
  sonar_rs: { name: '共振炮',   desc: '命中后向邻近弹射',   iv: 0.75, dmg: 12.2, range: 420, color: UI.cyanHi },
  sonar_fc: { name: '定向聚焦', desc: '短距强波 · 高伤',    iv: 0.84, dmg: 40.8, range: 250, color: UI.cyanHi },

  harpoon: { name: '穿透鱼叉', desc: '直线穿透 · 命中拉拽', iv: 1.02, dmg: 27.2, range: 520, color: UI.jade },
  echo:    { name: '回声炮',   desc: '延迟爆发 · 需预判',   iv: 1.50, dmg: 40, range: 480, color: UI.magenta },
  acid:    { name: '酸液喷射', desc: '地面持续伤害区',      iv: 1.40, dmg: 6,  range: 380, color: UI.jadeHi },

  // V6.29 三基础武器的进化（各 2 分支）。配平口径与 gun_gl / torp_hv 一致：
  // **用射速/单体伤害交换机制或覆盖面**，价一律 66~74。
  harp_tr: { name: '三重鱼叉', desc: '一次 3 叉扇形 · 群体拉拽', iv: 1.22, dmg: 19.0, range: 480, color: UI.jade },
  harp_cb: { name: '回旋鱼叉', desc: '到程掉头 · 二次穿刺回氧', iv: 1.29, dmg: 23.1, range: 560, color: UI.jade },
  echo_mu: { name: '多重回声', desc: '三点延时爆炸 · 群爆回氧', iv: 1.60, dmg: 26, range: 440, color: UI.magenta },
  echo_fo: { name: '聚焦回声', desc: '大半径延时爆发 · 高伤',   iv: 2.20, dmg: 90, range: 520, color: UI.magenta },
  acid_fd: { name: '持久酸池', desc: '更大更久 · 池内省氧',     iv: 1.40, dmg: 6,  range: 380, color: UI.jadeHi },
  acid_ra: { name: '酸雨',     desc: '三池成排 · 封锁一线',     iv: 1.70, dmg: 5,  range: 460, color: UI.jadeHi },

  // ---- V6.46 机制型武器（计划书 §5.2 点名、一直没做的那批）----
  // ⚠️ `range` 对陷阱族**没有意义**：气泡雷落在自己脚下，不索敌。写 0 是给
  //    UI 一个诚实的信号（索敌距离显示为"自机"），不是偷懒。
  // ⚠️ V6.80：陷阱族 `iv` 是**布雷速率**（0.55 → 1.8 颗/秒 = 铺满屏），同样按 ×1.36 压到 0.75。
  mine:    { name: '气泡雷',   desc: '原地布雷 · 需预判走位', iv: 0.75, dmg: 24.5, range: 0, color: UI.cyanHi },
  mine_ch: { name: '连锁雷',   desc: '引爆邻近地雷 · 连环',   iv: 0.75, dmg: 20.4, range: 0, color: UI.cyanHi },
  mine_o2: { name: '氧气雷',   desc: '爆炸回氧 · 伤害腰斩',   iv: 0.75, dmg: 15.0, range: 0, color: UI.jadeHi },
  // ⚠️ 控场族（net / lure）**不动**：它们本来就慢（1.10 / 2.40），
  //    而且 `iv` 在这里控制的是**控场频率**不是 DPS —— 加长 = 纯削弱，不属于本口径。
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
  // ---- V6.77d 新维度上限 ----
  // ⚠️ 这四条都必须封顶，理由各自不同（不是照抄）：
  //   · `slowDmg` / `armorPen` —— 都是"对方减免"的抵消项，>1 就变成**加伤**，
  //     不再是"对特定目标有效"的定向卡 ⇒ 会退化成一张纯 dmg 卡。
  //   · `bulletSpd` —— 弹速本身不影响 DPS（射程被 life 同步抵消），但太快会让
  //     子弹在一帧内跨过敌人（`dt` 20ms × 2000px/s = 40px > 敌人直径）⇒ **打不中**。
  //     1.0（2 倍）已接近上限，写死 1.0。
  //   · `turretSpeed` —— 再高炮塔就是"瞬间转向"，转座动画失去意义（手感反而更差）。
  slowDmg: 0.9, bulletSpd: 1.0, turretSpeed: 1.2, armorPen: 0.8,
}

/**
 * V6.77d 猎杀节奏的**层数上限**（`st.streak` 是每层加成，本值管"最多叠几层"）。
 *
 * 为什么不放进 `STAT_CAP`：那里管的是**属性值本身**的钳位，而这里钳的是
 * **连杀层数**（一个世界状态）。两者混在一起会让"买第 7 张猎杀节奏"的行为
 * 变得不可预测（值封顶了但层数还在涨）。
 */
export const STREAK_MAX_LV = 6

/** 开局属性。killO2 默认 0 = "击杀不回氧"是初始设定，靠卡解锁。DiveScene.ts:334-338 */
export const NEW_STATS = (): Stats => ({
  dmg: 0, rate: 0, crit: 0, critMul: 0.8, range: 0,
  armor: 0, dodge: 0, speed: 0, pickup: 0, luck: 0, regen: 0,
  o2Bonus: 0, killO2: PLAYER.killO2, twinRate: 0,
  // V6.77d：五个新维度都是"0 = 没买过这张卡"，行为与加卡之前**逐帧一致**
  // （`streak` 乘 1、`slowDmg` 不触发、`bulletSpd` 不缩放、`turretSpeed` 不缩放、
  //  `armorPen` 不减甲）⇒ 老存档 / 冒烟基线不会因为"多了几个键"而变数。
  streak: 0, slowDmg: 0, bulletSpd: 0, turretSpeed: 0, armorPen: 0,
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
  // ---- V6.77d 新维度（被动 24 → 30）。顺序 = 商店属性面板排列顺序 ----
  // ⚠️ 面板的行距按**最长的名字**算，加这 5 行后仍在一屏内；
  //    以后再扩优先合并/换行，不要直接往下列（会压到下面的遗物区）。
  { k: 'streak',     name: '猎杀节奏', pct: true, col: UI.danger, icon: 'streak' },
  { k: 'slowDmg',    name: '狩猎本能', pct: true, col: UI.jade,   icon: 'slowDmg' },
  { k: 'bulletSpd',  name: '弹道增压', pct: true, col: UI.amber,  icon: 'bulletSpd' },
  { k: 'turretSpeed', name: '伺服转台', pct: true, col: UI.cyan,  icon: 'turretSpeed' },
  { k: 'armorPen',   name: '破甲穿透', pct: true, col: UI.steel,  icon: 'armorPen' },
]

/** 商店属性卡的 卡 id → Stats 键 映射（tank→o2Bonus、gill→killO2）。DiveScene.ts:369-373 */
export const STAT_CARD: Record<string, keyof Stats> = {
  speed: 'speed', pickup: 'pickup', tank: 'o2Bonus', gill: 'killO2',
  s_dmg: 'dmg', s_rate: 'rate', s_crit: 'crit', s_range: 'range',
  s_armor: 'armor', s_dodge: 'dodge', s_regen: 'regen', s_luck: 'luck',
  // ---- V6.77d 六条新属性卡（各占一个新维度，见 types.ts 的 Stats 长注释）----
  s_critmul: 'critMul', s_streak: 'streak', s_hunt: 'slowDmg',
  s_bspeed: 'bulletSpd', s_servo: 'turretSpeed', s_pen: 'armorPen',
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
 *
 * ---------------------------------------------------------------------------
 * `tint` / `vis` 的口径（V6.51 §2.2 / §2.3，2026-10-14 重定）
 * ---------------------------------------------------------------------------
 * 这两个字段**只被渲染层消费**（全仓已搜：`drawVeil` 的色调/压暗/暗角 + `drawEnemies`
 * 的 `darkLayer` 分支），**不参与任何模拟** ⇒ 改它们不会动到弹道 / 碰撞 / 氧气。
 *
 * 规则从旧版的「**去饱和到黑**」改成「**转色相保饱和**」：
 *   · 旧值 L3 `0x14203c` / L4 `0x3a1a10` / L5 `0x0a0614` 全是「越来越黑」，
 *     再叠上压暗层 ⇒ 深层屏幕中央实测亮度 ≈ 9（黑屏），玩家看不见生物。
 *   · 新值按每一带的**光的主角**定色相：L3 青紫（生物荧光）/ L4 橙红（热泉自发光）/
 *     L5 靛蓝（**不是黑** —— 深渊要有颜色，只是暗）。
 *
 * `vis` 是**能见度**（只喂压暗与暗角强度），旧值一路降到 0.10 ⇒ 压暗几乎拉满。
 * 新值整体抬高（L2 0.92 / L3 0.68 / L4 0.60 / L5 0.46）：**暗要靠"雾"而不是靠"黑"**
 * （见 DiveGame.ts 的 `drawFog`）。⚠️ 抬 `vis` = 减压暗 ⇒ 背景图会更显底噪，
 * 所以它与 env 图重出（`docs/资源重出规格_V6.58.md`）是同一件事的两半。
 */
export const LAYERS: LayerDef[] = [
  // L1 阳光带：教学层，**不给机制**
  { name: '阳光带', sub: 'SUNLIT', mech: '', tip: '没有额外机制 —— 先把手感练顺',
    o2Max: 100, drain: 1.00, dropCap: 70,  toll: 15, vis: 1.00, depthTop: 0,     depthBot: 200,
    ventPush: 0,  current: 0,  pressure: 0,    surge: false, tint: 0x2a6f8a, motes: 34,  hpMul: 1.00, cntMul: 1.00, dashMul: 0.5, driftRatio: 0.00, armorRatio: 0.00, orbitRatio: 0.06 },
  // L2 弱光带：**暗流**
  { name: '弱光带', sub: 'TWILIGHT', mech: '暗流', tip: '水流在缓慢旋转，鱼群和你都会被带偏',
    o2Max: 100, drain: 1.35, dropCap: 90,  toll: 20, vis: 0.92, depthTop: 200,   depthBot: 1000,
    ventPush: 0,  current: 34, pressure: 0,    surge: false, tint: 0x1d6b7a, motes: 48,  hpMul: 1.35, cntMul: 1.25, dashMul: 1.0, driftRatio: 0.12, armorRatio: 0.05, orbitRatio: 0.12 },
  // L3 午夜带：**涌流**
  { name: '午夜带', sub: 'MIDNIGHT', mech: '涌流', tip: '它们从同一个方向压上来 —— 退路只有一条',
    o2Max: 85,  drain: 1.80, dropCap: 110, toll: 25, vis: 0.68, depthTop: 1000,  depthBot: 4000,
    ventPush: 0,  current: 0,  pressure: 0,    surge: true,  tint: 0x352f6b, motes: 70,  hpMul: 1.80, cntMul: 1.50, dashMul: 1.1, driftRatio: 0.18, armorRatio: 0.09, orbitRatio: 0.12 },
  // L4 热泉带：**热泉**
  { name: '热泉带', sub: 'HYDROTHERMAL', mech: '热泉', tip: '上升的热流会顶开你 —— 停不住',
    o2Max: 70,  drain: 2.40, dropCap: 135, toll: 30, vis: 0.60, depthTop: 4000,  depthBot: 6000,
    ventPush: 190, current: 0, pressure: 0,   surge: false, tint: 0x7a3a16, motes: 90,  hpMul: 2.40, cntMul: 1.80, dashMul: 1.2, driftRatio: 0.15, armorRatio: 0.11, orbitRatio: 0.08 },
  // L5 深渊带：**压力**
  { name: '深渊带', sub: 'THE ABYSS', mech: '压力', tip: '每过一波，舱体再压掉一截氧气上限',
    o2Max: 60,  drain: 3.00, dropCap: 160, toll: 0,  vis: 0.46, depthTop: 6000,  depthBot: 11000,
    ventPush: 0,  current: 0,  pressure: 0.06, surge: false, tint: 0x1a1740, motes: 110, hpMul: 3.20, cntMul: 2.10, dashMul: 1.3, driftRatio: 0.22, armorRatio: 0.14, orbitRatio: 0.14 },
]

/**
 * 每层 4 波的**节奏签名**（V6.23 从"全局一张表"拆开）。
 * ⚠️ **每层 4 个 dur 之和必须 = 156s**。DiveScene.ts:567-592
 */

/**
 * 每带的**生态配套**（V6.53）。
 *
 * 为什么单独一张表而不是塞进 `LayerDef`：`LayerDef` 是**玩法**字段（氧耗 / 敌人倍率 / 视距），
 * 这张表是**表现**字段（鱼群 / 海生物 / 叙述）。分开的理由两条 ——
 * ① 表现字段被渲染层与插画岗同时消费，混进玩法表会让"改画面"看起来像"改平衡"；
 * ② 将来低端机要按平台降级表现（少画鱼群），不该动到玩法表。
 *
 * ⚠️ 必须与 `LAYERS` **同序同长**（5 条）。索引即 `world.layerIdx`。
 */
export interface LayerEco {
  /** 远景鱼群条数（渲染层）。`0` = 该带不画 */
  school: number
  /** 鱼群单鱼尺寸倍率（相对远景基准长 26px）。深渊给 3.0 = 巨影 */
  schoolSize: number
  /** 该带的代表鱼种（图鉴 / 鱼情雷达 / 敌人贴图分配用） */
  species: string
  /** 生态元素清单（插画岗出图与渲染层程序化**共用同一份口径**） */
  bio: string[]
  /** 氧耗叙述（HUD 深度计）：这一层**为什么**更费氧 */
  o2Note: string
}

export const LAYER_ECO: LayerEco[] = [
  // L1 阳光带 —— 开阔水体：**没有底**（用户点名"浅层不该见底"），靠光柱与密集小鱼群撑"丰富"
  { school: 46, schoolSize: 0.75, species: '表层鱼群',
    bio: ['丁达尔光柱', '水面焦散', '密集小鱼群', '远处海龟剪影', '悬浮气泡'],
    o2Note: '近水面 · 氧耗 ×1.0' },
  // L2 弱光带 —— 鱼群变稀、开始出现中大型剪影；光只剩远处零星光斑
  { school: 30, schoolSize: 0.85, species: '中层鱼群',
    bio: ['远处光斑', '稀疏横游鱼群', '大型生物剪影', '暗流纹路'],
    o2Note: '暗流推着你 · 氧耗 ×1.35' },
  // L3 午夜带 —— **生物荧光**是这一带的主角：鱼群自身发光、连成链
  { school: 38, schoolSize: 0.95, species: '荧光链鱼群',
    bio: ['荧光浮游链', '发光水母群', '链状鱼群', '生物光斑'],
    o2Note: '涌流不给退路 · 氧耗 ×1.8' },
  // L4 热泉带 —— 鱼群**避开热泉**（散开、不聚团）；橙红辐射把水染暖
  { school: 20, schoolSize: 0.90, species: '热泉散鱼',
    bio: ['热泉烟柱', '橙红辐射', '避热散鱼', '管虫丛'],
    o2Note: '热流顶着你 · 氧耗 ×2.4' },
  // L5 深渊带 —— 不画鱼群，画**两条巨影**（schoolSize 3.0）：少而大 = 压迫
  { school: 3, schoolSize: 3.00, species: '深渊巨影',
    bio: ['呼吸点阵', '巨影横过', '稀疏发光点'],
    o2Note: '压力每波再压上限 · 氧耗 ×3.0' },
]

/**
 * 该层的**氧耗预测** —— 给玩家"我撑不撑得过这一层"的指引，也是养成卡属性的依据。
 *
 * 为什么不直接用 `LAYERS[i].drain`：玩家看到的应当是**自己的**账户（含永久强化
 * `o2Bonus` / `regen`），而不是裸数值 —— 否则买了养成也不会有"我变强了"的反馈。
 *
 * `sec` = "满氧静止能撑多少秒"。**它不是平衡数字**（实战要移动 / 爆发 / 拾取），
 * 只用来给玩家一个可比较的量级（"L3 连 L1 的一半都不到"）。
 */
export function layerO2(layerIdx: number, o2Bonus = 0, regen = 0): { drain: number; cap: number; sec: number } {
  const L = LAYERS[Math.max(0, Math.min(LAYERS.length - 1, layerIdx))]
  const drain = Math.max(0.05, L.drain - regen)
  const cap = L.o2Max + o2Bonus
  return { drain, cap, sec: cap / drain }
}

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
  armor: Math.PI,        // 重甲：素材同规，头朝左
  orbit: Math.PI,        // V6.79 盘旋猎手：素材同规，头朝左
}

/** 敌人贴图 key（渲染层按它取资源）。DiveScene.ts:1486 / 1572 */
export const ENEMY_TEX: Record<Kind, string> = {
  swarm: 'f_swarm',
  dash: 'f_dash',
  drift: 'f_drift',
  armor: 'f_armor',      // V6.62 第 4 类重甲
  orbit: 'f_orbit',      // V6.79 第 5 类盘旋猎手
  boss: 'f_dash',
}
