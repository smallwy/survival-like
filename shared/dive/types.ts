/**
 * 潜水战斗循环 · 模拟层类型（引擎无关）
 *
 * 全部从 `web/src/scenes/DiveScene.ts` 抽出（行号对照见 `tables.ts` 与 `world.ts` 的注释）。
 * 这些类型**不含任何渲染概念** —— 没有贴图对象、没有 Graphics、没有相机。
 * 渲染层（Phaser / Cocos）只读这里的字段来画。
 */

/**
 * 敌人类型：游群 / 冲刺 / 水母漂移 / **重甲** / Boss
 *
 * `armor`（V6.62，计划书点名、V6.23 起标红三轮）存在的**唯一理由**是"逼玩家换武器"：
 * 它 HP 厚、走得慢、**不索敌**（直线漂移 ⇒ 你得主动去打它），核心机制是**护甲减伤**，
 * 而**爆炸 / 穿透类伤害无视护甲**。没有护甲的重甲只是"血厚的杂兵"。
 * ⚠️ 区分度来自**行为**（它不追你），不是外形 —— 外形只是给玩家一个"该换武器"的提醒。
 */
export type Kind =
  | 'swarm' | 'dash' | 'drift' | 'armor' | 'orbit'
  // ---- V6.82 第一批新生物（计划书 §5.4「20 种生物图鉴」）----
  | 'splitter'   // 裂体：血空时裂成 2 只幼体
  | 'shard'      // 幼体：**副产品**，不进图鉴（见 codex.ts 的 CODEX_BYPRODUCT_KINDS）
  | 'bulwark'    // 盾鳐：正面 120° 减伤 80%，侧后无防护
  | 'brood'      // 孵卵囊：几乎不动，周期吐幼体
  | 'kamikaze'   // 自爆螺：贴脸 → 前摇 → 自爆
  | 'herder'     // 牧群者：不追你，给周围小怪提速并把它们推向你
  // ---- V6.83 第二批新生物（同一张 20 种总表，见 `docs/生物谱系_20种_V6.82.md` §3）----
  | 'jelly'      // 水母：缓慢漂移，周期性放电（1.6s 前摇 → 半径 70）
  | 'mimic'      // 拟态：静止伪装成海底碎屑，玩家进 160px 才激活扑上
  | 'lancer'     // 枪鱼：从屏外沿直线高速穿过（**不追踪**），对称侧来回最多 3 趟
  | 'burrower'   // 潜沙者：下潜（不可选中）→ 在你附近冒出 → 突进
  | 'bloom'      // 孢囊：缓慢靠近，**死亡留下酸云**
  | 'leech'      // 吸血蛭：接触时把玩家的氧转成自己的血，**不造成常规接触伤害**
  | 'darter'     // 摆尾鱼：接近时正弦横摆，落点难预判
  | 'spitter'    // 喷酸鱼：**保持距离**开火 —— 本作第一个"远程"敌人（V6.83）
  | 'boss'

/** 可刷怪的 `Kind`（去掉 Boss）。`LayerDef.mix` 的键类型 */
export type EnemyKind = Exclude<Kind, 'boss'>

export interface Enemy {
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
   * 贴图**资源 key**（不是贴图对象！）。模拟层只负责"这条鱼该用哪张图"，
   * 各引擎自己把 key 解析成 Sprite/Node。原实现是 Phaser 的 texture key。
   */
  tex: string
  /** 贴图朝向补偿（弧度）：AI 生成素材的实际头向不可控，绘制时减掉它。 */
  texRot: number
  /**
   * **Boss 种类**（V6.62）。非 Boss 无意义（缺省 `'watcher'`）。
   *
   * 两种 Boss 的区分**必须在行为语汇，不在体型**：
   * | | watcher 深渊守望者 | **angler 鮟鱇女王** |
   * |---|---|---|
   * | 压力来源 | **逼近**（范围压 + 冲锋） | **诱捕**（在远处等你来） |
   * | 机制 | 追 → 蓄力 → 砸地 | **亮诱饵光 → 张口吞** |
   * | 玩家解法 | 走位躲冲锋 | **忍住不靠近光** |
   *
   * 它是「生物光诱饵」的**镜像** —— 你放诱饵骗鱼，它放诱饵骗你。
   * 同一个机制语汇的攻防两面，成本最低、新鲜度最高。
   */
  bossKind: 'watcher' | 'angler'
  /**
   * **朝向单位向量**（V6.55）。
   *
   * sim 里"这条鱼面朝哪"的**唯一真相**，每帧由 `world.updateEnemies` 写入。
   * 消费方只有一处：渲染层用它决定贴图的**左右镜像**与 **±35° 仰俯**（侧视语义，
   * 见 `DiveGame.drawEnemies`）。**不参与任何模拟计算**。
   *
   * ⚠️ 为什么不能拿 `vx / vy` 当朝向：那两个字段在模拟层**从不更新**
   *    （`mkEnemy` 里归零之后再没人写过），恒为 `(0, 0)`。
   *    V6.53 的渲染层正是这么踩的 —— `Math.hypot(0, 0) = 0` ⇒
   *    `flip` 恒为 1、`tilt` 恒为 0 ⇒ **屏幕上所有鱼水平朝左**。
   *    用户 2026-10-14 报的"鱼游的方向不对"就是这一条。
   *
   * ⚠️ 存的是**朝目标的方向**（不是本帧位移）：冲刺 / 蓄力时位移可能为 0，
   *    朝向却不该丢（否则鱼会在蓄力瞬间"啪"地转回水平）。
   */
  fx: number; fy: number

  // ---- V6.46 机制型武器带来的三个新状态 ----
  /** 减速剩余（s）。> 0 时速度 × `slowMul`。每帧递减，见 `world.updateEnemies`。
   *  ⚠️ V6.62 起**网不再用它**（网改硬控 `rootT`）—— 保留字段以便将来别的来源做软控，
   *    但当前没有生产者，渲染层的减速标记也随之不会被触发。 */
  slowT: number
  /** 减速倍率（0.5 = 打五折）。只在 `slowT > 0` 时读 */
  slowMul: number

  // ---- V6.62 硬控与装甲 ----
  /**
   * **定身剩余（s）**。> 0 时速度**归零**（不是打折）—— 网从"慢一半"升级成"完全不动"。
   *
   * ⚠️ 配平红线：**必须有 `rootImmune`**。网 iv 1.1s + 弹道飞行，若无免疫，
   *    单体被定时间会 ≥40%；一屏 150 敌里定住 40 只不动 = Bullet Heaven 变靶场。
   */
  rootT: number
  /**
   * **定身免疫剩余（s）**。> 0 时**不再被定身**（但网仍结算伤害）。
   * 被定身一次后进入 3.0s 免疫窗口 —— 这是"网是控场不是牢笼"的机关。
   */
  rootImmune: number
  /**
   * **护甲减伤比例**（0 = 无甲；0.6 = 减伤 60%）。仅重甲类 > 0。
   * ⚠️ **爆炸（`blast`）与穿透（`pierce`）无视护甲** —— 这是它逼玩家换武器的唯一手段。
   */
  armor: number
  /**
   * **精英标记**（V6.62 §5-A）：每波随机 1–2 只。HP ×3 · 掉落 ×4 · **必掉一个「囊」**。
   * 复用"发光 = 值得"的既读法（与鱼骨同一套），玩家不用学新符号。
   */
  elite: boolean
  /** 灼烧剩余（s）与每秒伤害（电网）。DoT 走 0.35s tick，与酸池同频 */
  burnT: number
  burnDps: number
  /** 距下一次灼烧结算的剩余时间（s） */
  burnTick: number
  /**
   * **内讧**剩余时间（s）。`> 0` = 这条鱼被驯化网策反，转而攻击同类（V6.46）。
   *
   * ⚠️ **阵营不变**（不是友军单位）。只是把它的寻路目标改写成"最近的同类"
   * （见 `world.enemyAim()`），咬到同类就造成伤害、并**不再攻击玩家**。
   *
   * 为什么不做"真友军"：真友军要加友方 AI + 独立死亡处理 + 击杀归属 +
   * "掉落的氧泡算谁的"这一串问题，成本高一个数量级，而**玩法效果几乎一样**
   * —— 视觉上都是"敌人内讧"。轻版只用一个字段。
   */
  charmT: number
  /** 内讧攻击节流（s）。咬到同类就掉血，但不能每帧咬 */
  charmTick: number

  // ---- V6.82 第一批新生物的三个状态字段（全可选，多数敌人不用）----
  /**
   * **正面盾的半角（弧度）**。`undefined` / 0 = 无盾。
   *
   * 命中判定：弹道**来向**与"敌 → 玩家"轴夹角 ≤ `shieldArc` ⇒ 走 `shieldCut` 减伤。
   * 与 `armor`（全向减伤、且**不索敌**）的差别是**方向性 + 它会主动追你**
   * ⇒ 玩家不能用"站桩输出"解决，必须**绕到侧后**或改用爆炸 / 穿透。
   */
  shieldArc?: number
  /** 正面盾的减伤比例（0.8 = 减 80%）。只在 `shieldArc` 有效时读 */
  shieldCut?: number
  /**
   * **自爆引信（s）**。`> 0` = 已经贴近并进入前摇，倒计时归零即自爆（kamikaze）。
   * 前摇期间**停住不动**（"停下 = 要炸了"），与 dash 的 charge 同一套预警语汇。
   */
  fuse?: number
  /** **产卵计时（s）**，归零则吐出一只幼体并重置（brood）。也用 `phase` 做"临产"闪烁 */
  hatch?: number

  /**
   * **已经穿过的趟数**（`lancer`）。0 起步，每飞出一侧 +1，达到 `LANCER_PASSES` 就离场。
   *
   * 为什么值得单独开一个字段，而不是复用 `t`：`t` 被这条鱼的四个阶段（进入 /
   * 穿行 / 换边 / 退场）反复重置，用它兼职"趟数"必然在换边那一刻被清零。
   * ⚠️ 这正是「两个语义不能塞进同一个变量」的典型 —— 同 `plateT` 兼不成冷却。
   */
  passes?: number
}

/**
 * 鱼骨：鱼被声呐共振后软组织震散，只剩发光骨架。
 * 缓缓下沉 + 缓慢旋转，玩家必须游过去拾取（硬约束①：不做远程磁吸）。
 */
export interface Bone {
  x: number; y: number
  vx: number; vy: number
  /** 淡出计时（秒）。归零后原地淡出消失，**不再凭空消失** */
  fade: number
  /** 回氧量。V6.23 起与 coin 分开 —— 见 BONE_O2 的注释 */
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
 * 关键手感——波是从「你」身上往外扩的，所以必须贴近鱼群才扫得到。
 */
export interface Pulse {
  x: number; y: number   // 发射点（发射瞬间位置，之后不跟随玩家）
  r: number              // 当前波前半径
  maxR: number           // 最大半径（= 射程）
  dmg: number
  width: number          // 波前判定厚度
  hit: Set<number>       // 已命中（同一条鱼只判定一次）
  alive: boolean
  /** 共振炮（sonar_rs）：波前命中时向邻近敌人溅射 */
  resonant?: boolean
}

export type WeaponId = 'sonar' | 'gun' | 'torpedo' | 'arc'
  | 'gun_gl' | 'gun_sg'        // 加特林 / 霰弹散射
  | 'torp_cl' | 'torp_hv'      // 集束鱼雷 / 重型鱼雷
  | 'arc_ov' | 'arc_st'        // 过载电弧 / 定点雷暴
  | 'sonar_rs' | 'sonar_fc'    // 共振炮 / 定向聚焦
  | 'harpoon' | 'echo' | 'acid'  // V6.18 新增三种基础武器（鱼叉 / 回声 / 酸液）
  | 'harp_tr' | 'harp_cb'        // V6.29 三重鱼叉 / 回旋鱼叉
  // V6.46 机制型武器四把（计划书 §5.2 点名但一直没做的那批）
  //   mine 陷阱族（不索敌，靠走位铺）/ net 控场族 / lure 聚怪族 / thruster 位移族
  | 'mine' | 'mine_ch' | 'mine_o2'
  | 'net' | 'net_el' | 'net_cv'
  | 'lure' | 'lure_bo' | 'lure_wl'
  // ⚠️ 水流推进器 `thruster` / `thr_vo` / `thr_ra` **故意不在这里**。
  //    它改的是玩家位移（核心手感），按决策挂到 P0 手感判定之后再上。
  //    `WeaponId` 一加，`Record<WeaponId, …>` 的 `WEAPON_DEF` 就必须同时给全 3 条 ——
  //    那样等于提前实装。所以类型是最后一步加的。
  | 'echo_mu' | 'echo_fo'        // V6.29 多重回声 / 聚焦回声
  | 'acid_fd' | 'acid_ra'        // V6.29 持久酸池 / 酸雨

export type WeaponFamily = 'sonar' | 'gun' | 'torpedo' | 'arc' | 'harpoon' | 'echo' | 'acid'
  // V6.46 三个机制族：陷阱（不索敌）／控场（减速）／聚怪（改寻路目标）
  | 'mine' | 'net' | 'lure'

export interface Weapon {
  id: WeaponId
  iv: number     // 射击间隔（秒）
  timer: number  // 距下次开火的剩余秒数
  dmg: number
  lvl: number    // 等级：每级提升伤害与频率（1..5）
  anchor: number // 只锚定一个敌人时的索敌锚点下标（鱼雷用）
  /** 上一发的**实际间隔**（含等级/齐射/高压供能）—— 装填进度环的分母 */
  ivLast: number
  /** 开火闪光剩余秒数（0.15s）。"施法过程"要看得见，靠的就是这一帧爆发。 */
  fireFlash: number
  /** 发射器**自己的**世界朝向（弧度）。由 `slewTurretAims` 每帧逼近最近目标。 */
  aimAng: number
  /**
   * 炮口**角速度**（弧度/秒）。V6.77 新增 —— 状态量，不持久化。
   *
   * ⚠️ 它是"丝滑转向"的全部秘密：`slewTurretAims` 用**角加速度限制**推它，再积分成 `aimAng`。
   *    只写 `aimAng` 的话速度曲线必然是方波（第一帧满速、最后一帧归零）= "啪"地甩过去。
   * ⚠️ 换武器（`evolveWeapon`）时必须**归零** —— 否则残留角速度会让下一帧的角度跳一下，
   *    而那种跳变不会有任何报错。
   */
  aimV: number
}

/** 通用弹：机关枪（直线）、鱼雷（追踪）、鱼叉（穿透+拉拽）共用 */
export interface Bullet {
  x: number; y: number
  vx: number; vy: number
  life: number; dmg: number
  kind: 'gun' | 'torpedo' | 'harpoon' | 'net'
  hit: Set<number>
  alive: boolean
  /**
   * V6.46 网：这颗弹**飞到尽头或撞到第一个敌人时张开**，对半径 `NET_R` 内所有敌人
   * 施加控制。值是网自己的武器 id（`'net' | 'net_el' | 'net_cv'`），
   * 让 `world.applyNet()` 知道该上哪种效果。
   */
  net?: WeaponId
  /** 爆炸半径倍率：重型鱼雷 1.5、其余默认 1 */
  er?: number
  /** 命中**每个**敌人回氧（回旋鱼叉 = 1）。缺省 0 = 不回氧。V6.29 氧耦合 A */
  o2?: number
  /** 回旋鱼叉：剩余寿命降到此值即掉头（发射时 = 初始寿命的一半）。缺省 = 不回旋 */
  boomerAt?: number
  /** 已掉头（防反复掉头） */
  reversed?: boolean
}

/** 回声标记：落在目标位置，延迟 0.75s 后爆发 */
export interface Echo {
  x: number; y: number
  t: number          // 剩余时间，归零即爆
  dmg: number
  /** 爆炸半径。缺省 130（聚焦回声 286）。V6.29 */
  r?: number
  /** 每炸到一个敌人回氧（多重回声 0.6）。缺省 0。V6.29 氧耦合 A */
  o2per?: number
  /** 连锁深度：共鸣腔生成的小回声 = 1；缺省 0 = 由武器直接投放。≥1 不再连锁。V6.33 */
  depth?: number
}

/**
 * 气泡雷（V6.46 陷阱族）。
 *
 * ⚠️ 它是**全场唯一不索敌**的武器 —— 落点永远是**玩家当前位置**。
 * 所以它的强度取决于"你往哪走"，而不是"它打谁"。**绝不能改成追踪雷**，
 * 那就退化成第 8 把普通武器。
 *
 * ⚠️ **V6.62 触发从"踩触发"改为"定时引信"**（V6.49 §3.2）：
 *    - 旧：`trig = 34`，敌人进 34px 才爆 ⇒ 爆不爆由**敌人走位**决定（玩家被动）。
 *    - 新：`fuse = 1.8s`，**到时必爆**（此处有没有敌人无关）⇒ 玩家主动预判
 *      "我算好它 1.8 秒后会游到那里"。
 *    - **二选一，不能同时保留踩触发** —— 双重触发会让玩家读不出"它为什么现在爆"
 *      （是踩到了还是到点了？可读性直接崩）。
 */
export interface Mine {
  x: number; y: number
  /** 布防剩余（s）。> 0 时**不引爆**，否则玩家一放下就自己炸 */
  arm: number
  /** 存活剩余（s）。归零自毁（**不爆**） */
  life: number
  dmg: number
  /**
   * **引信剩余（s）**。归零 ⇒ 引爆（V6.62）。这是雷的**主时钟**。
   * 渲染层按 `fuse / fuseMax` 画倒计时（越接近越急）—— 那是它区别于旧踩触发的
   * **全部可读性来源**：踩触发靠"敌人靠近"传达，定时靠"自己的心跳"传达。
   */
  fuse: number
  /** 引信总时长（s），常量快照。渲染层算倒计时比例用，避免它再去读世界常量 */
  fuseMax: number
  /** 爆炸半径 */
  r: number
  /** 每炸到一个敌人回氧（氧气雷 2.5）。缺省 0 */
  o2per: number
  /** 单次爆炸的回氧总量上限（氧气雷 10）。`Infinity` = 不封顶 */
  o2cap: number
  /** 连锁：引爆邻近地雷的半径（连锁雷 90）。0 = 不连锁 */
  chainR: number
  alive: boolean
}

/**
 * 生物光诱饵（V6.46 聚怪族）。
 *
 * 半径内的敌人把寻路目标改写成诱饵坐标（见 `world.enemyAim()`）。
 * ⚠️ 投放位置是**敌人密度最高处**，不是最近敌人 —— 投在最近敌人身上没用，
 *    它本来就在朝你来了。
 */
export interface Lure {
  x: number; y: number
  life: number
  /** 吸引半径 */
  r: number
  /** 存活结束时是否自爆（爆炸诱饵） */
  boom: boolean
  dmg: number
  /** 自爆半径 */
  br: number
  alive: boolean
}

/** 酸液云：在目标位置持续 3s，每 0.35s 结算一次伤害 */
export interface Acid {
  x: number; y: number
  r: number
  life: number
  tick: number       // 距下一次伤害结算的剩余时间
  dmg: number
  /**
   * **归属方**（V6.83）。缺省 / `false` = **玩家的**酸液（伤敌人）；
   * `true` = **敌人的**酸云（伤玩家，`bloom` 死亡时留的那片）。
   *
   * 为什么加一个标记而不是另开一个池：两者的生命周期、tick 频率、形状、
   * 渲染方式**完全一样**，只差"结算在谁身上"。另开一个池等于把
   * `updateAcids` 抄一遍 —— 而抄一遍的东西下次改参数必忘一处（V6.79 教训）。
   */
  hostile?: boolean
}

/** 电弧折线：瞬发 + 存留 0.18s 的视觉残留 */
export interface Arc {
  pts: { x: number; y: number }[]
  life: number
}

/**
 * **敌方投射物**（V6.83 · 计划书 §3.5「深渊螺（远程）」拖到这一版才落地）。
 *
 * 【为什么值得单开一个池，而不是"给敌人加个远程攻击"】
 *   在此之前，**敌人的一切伤害都是"贴上来才发生"**（接触磨损 + 两个 Boss 的范围技）。
 *   于是玩家面对任何敌人都只有一个动作：**离开它**。远程敌人第一次引入第二种解法 ——
 *   **躲一颗正在飞来的东西**（方向、提前量、路径），它与"贴着你不放"是两种时间结构：
 *   接触是**持续态**（现在就在掉氧），投射物是**未来态**（再过 0.4 秒会掉氧）。
 *   ⇒ 这正是「每种生物必须带来一个新的玩家动作」（V6.49 §4.1）里最缺的那一个。
 *
 * 【为什么是直线，不追踪】
 *   追踪弹会把"躲"变成"跑"（跑不掉，只能拼速度）。直线弹才让"读出那条线"成为技能 ——
 *   同 `lancer` 的穿场（不追踪）与 `dash` 的追人（追踪）是两种压力语汇。
 *
 * 【与玩家技能的交互（★ 用户明确要求"一定要考虑技能相关的特效"）】
 *   本池**可以被清除**，且清除者携带 `cause` ⇒ 渲染层能画出"被谁清掉的"：
 *     · `blast` 爆炸抵消（鱼雷 / 回声 / 气泡雷 / 氧气雷 —— 凡走 `explode()` 的都算）
 *     · `net`   网拦截（网张开的那一瞬，`NET_R` 内的弹被收走）
 *     · `ram`   刺鳐撞角（贴脸时撞碎）
 *     · `hit`   打到玩家（弹自己消耗掉）
 *   ⚠️ **刻意不做"能被子弹逐个击落"**：那会让远程敌人退化成"多打一个目标"，
 *      威胁归零（与接触伤害那次教训同源 —— 多一条廉价解法 = 少一个压力来源）。
 *      清除手段只留给**有代价 / 有冷却**的技能：爆炸要消耗一发、网要打得准、撞角要贴脸。
 */
export interface EnemyShot {
  x: number; y: number
  vx: number; vy: number
  /** 剩余寿命（s）。归零即爆开（*不是*凭空消失 —— 那样玩家读不出"它到点了"） */
  life: number
  dmg: number
  /** 与玩家的碰撞半径 */
  r: number
  /** 爆开半径（寿命归零 / 命中玩家 / 被清除时）。0 = 不爆 */
  blastR: number
  alive: boolean
  /** 已存活时间（s）。**只给渲染层做脉动相位**，不参与任何判定 */
  t: number
}

/**
 * 玩家属性总表（V6.8）。
 *
 * 约定：**百分比类存小数**（0.15 = +15%）；加成型卡走加法（Brotato 做法）；
 * `STAT_CAP` 里声明上限，`addStat()` 统一钳位。
 *
 * ---- V6.77d：新增 5 维（被动道具 24 → 30）----
 * ★ **为什么是这 5 个，而不是"再堆六条数值卡"**：
 *   原 12 条属性卡把 `Stats` 的每个键都占满了（dmg/rate/crit/range/armor/dodge/
 *   speed/pickup/luck/regen/tank-o2Bonus/gill-killO2）⇒ 再加卡只能重复效果。
 *   所以本轮**先扩维度、再补卡**，且这 5 个的共同点是：
 *   ① **都改"打起来的手感/反馈"，而不是单纯加一个百分比**（呼应 P0「单波爽」）；
 *   ② 都**不在 `dmgMulNow()` 之外另开口子**——伤害类全落在同一个入口，好审计；
 *   ③ 都能**用世界状态直接算出来**，不需要新增计时器状态机（`streak` 复用现有
 *      `comboCnt`、`slowDmg` 读敌人自己的 `slowT/rootT`）。
 * ⚠️ `critMul` 是**已有键但一直没有卡**（默认 0.8 = 暴击 1.8×），本轮的破甲弹头
 *   是第一张动它的卡；它不新增字段，但同属"补齐一个空维度"。
 */
export interface Stats {
  dmg: number
  rate: number
  crit: number
  critMul: number
  range: number
  armor: number
  dodge: number
  speed: number
  pickup: number
  luck: number
  regen: number
  o2Bonus: number
  killO2: number
  twinRate: number
  /** V6.77d 猎杀节奏：连杀**每层**的伤害加成（乘在 `dmgMulNow()`）。上限由 `STREAK_MAX_LV` 定 */
  streak: number
  /** V6.77d 狩猎本能：对**被减速 / 定身**的敌人附加的伤害倍率 —— 与网族/定身雷协同 */
  slowDmg: number
  /** V6.77d 弹道增压：子弹初速倍率。⚠️ **同步缩 `life`** ⇒ 射程不变，只改"命中提前量" */
  bulletSpd: number
  /** V6.77d 伺服转台：炮塔追踪角速度倍率（`TURRET_OMEGA_TRACK` 乘它） */
  turretSpeed: number
  /** V6.77d 破甲穿透：**无视敌方护甲的百分比**（重甲的 60% 减伤按此打折） */
  armorPen: number

  // ---- V6.83 四条"机制化"的新维度 ----
  //
  // ★ 为什么要新开维度、而不是直接改现有键的值：
  //   一张卡从"恒定 +X%"变成"**条件下 +X%**"，需要一个**只在该条件下生效**的独立数值。
  //   复用现有键（比如让 `armor` 本身浮动）会让所有其他加护甲的来源**一起**变成条件式 ——
  //   那不是这一张卡的事。所以：**基础值与条件值必须分开存**。
  //
  // ⚠️ 三条都遵守 V6.77d 立下的规矩：**新键默认值必须为 0**，
  //    否则没买卡的人也会吃到这些效果（而且不会有任何报错）。

  /** **受击后**的额外减伤（`s_armor` 耐压装甲）。在 `damagePlayer` 里按 `plateT > 0` 读 */
  plateArmor: number
  /** **静止**时的额外闪避（`s_dodge` 流体规避）。在闪避判定里按 `stillT` 读 */
  stillDodge: number
  /** 对**满血**敌人的额外暴击率（`s_crit` 弱点解析）。在 `hurt` 里按 `e.hp >= e.maxHp` 读 */
  fullHpCrit: number

  // ---- V6.83 第二批机制卡的条件值（同上：默认必须为 0）----
  /** **缺氧时**的额外拾取范围（`pickup` 吸附鳍）：缺氧时你更需要自动收骨 */
  lowPickup: number
  /** **远距离命中**的额外伤害（`s_range` 声场延伸）：鼓励保持距离输出 */
  farDmg: number
  /** **静止后起步**的额外移速（`speed` 增压推进）：与 `s_dodge` 共用 `stillT` */
  startBoost: number
  /** **每波第一块骨**的额外价值（`s_luck` 打捞直觉）："开门红" */
  firstBone: number
}

export interface LayerDef {
  name: string
  sub: string
  mech: string
  tip: string
  o2Max: number
  drain: number
  dropCap: number
  toll: number
  vis: number
  depthTop: number
  depthBot: number
  /** 热泉上升流（px/s²，L4）。**是加速度不是速度偏移** */
  ventPush: number
  /** 暗流强度（px/s²，L2）。方向随时间缓慢旋转；敌人吃满、玩家吃一半 */
  current: number
  /** 每波开始再压缩的氧气上限比例（0.06 = 再压 6%，L5） */
  pressure: number
  surge: boolean
  tint: number
  motes: number
  hpMul: number
  cntMul: number
  dashMul: number
  driftRatio: number
  /**
   * **重甲占比**（V6.62）。0 = 该带不刷重甲。
   * 与 `driftRatio` 同一套"占比"语义，在 `spawnEnemy` 里依次判定。
   * ⚠️ L1 必须为 0 —— 教学层不给机制（与 `driftRatio` 同规）。
   */
  armorRatio: number
  /**
   * **盘旋猎手占比**（V6.79）。0 = 该带不刷盘旋猎手。
   * 与 `driftRatio` / `armorRatio` 同一套"占比"语义，在 `spawnEnemy` 里**最后**判定。
   * ⚠️ L1 必须为 0 —— 教学层不给机制（与 `driftRatio` 同规）。
   * ⚠️ 硬约束：`driftRatio + dashRatio×dashMul + armorRatio + orbitRatio + Σmix ≤ 1`
   *    （超了后面的桶永远刷不出来，**且不报错**）。
   *    ★ **V6.82 起这条硬约束由 `spawnWeights()` 接管**：改成**归一化加权抽样** ——
   *      Σ ≤ 1 时行为与旧的顺序 if/else **逐位一致**；Σ > 1 时从"先到先得（尾部饿死）"
   *      变成"按权重按比例"，修掉 L5 后段 `armor` / `orbit` 刷不出来的既有坑。
   */
  orbitRatio: number
  /**
   * **V6.82 新增生物的占比表**（键 = `EnemyKind`）。
   *
   * ⚠️ 为什么不在 `LayerDef` 上再开 6 个 `xxxRatio` 字段：每加一种生物就要动
   *    类型定义 + 5 行层配置 + `spawnEnemy` 的判定链，而 `spawnEnemy` 里那条
   *    顺序 `if/else` 已经长到"插错位置就静默改配比"（V6.79 的教训）。
   *    收成一张表 ⇒ **加生物只改这一处 + `ENEMY_TEX`**。
   * ⚠️ `swarm` 不在这张表里 —— 它是**残差**（权重 `max(0, 1 − Σ其他)`），
   *    与旧口径一致：不加新生物时，各带配比与 V6.79 完全相同。
   */
  mix?: Partial<Record<EnemyKind, number>>
}

/** 一波的形状：数量 / 冲刺占比 / 血倍率 / 时长 */
export interface WaveShape {
  count: number
  dashRatio: number
  hpMul: number
  dur: number
}

export type RelicId =
  | 'echo_heart'      // 回声心脏：低氧增伤
  | 'osteoblast'      // 骨殖转化：击杀回氧翻倍，氧气上限 -15
  | 'tidal_compass'   // 潮汐罗盘：拾取 + 鱼骨价值
  | 'resonance_core'  // 共振核心：暴击溅射
  | 'gluttony'        // 贪食腺体：鱼骨 ×2，耗氧 +0.6/s
  | 'abyss_mark'      // 深潜印记：每层 +12% 伤害，敌人 +10% 移速
  | 'current_fin'     // 洋流鳍：3 秒不受击 → 移速 +30%
  | 'silent_plating'  // 静默装甲：受击后 1.5s 闪避 +40%
  // ---- V6.33 机制型遗物 4 条（P1-#4：绑武器行为，做「遗物 × 武器」乘法空间）----
  | 'conductor_coil'    // 导体缠绕：链式电弧每跳回 0.8 氧，氧气上限 −10
  | 'bleeding_anchor'   // 破血锚：鱼叉命中 → 对已穿过的敌人各补 30% 暴击伤害
  | 'resonance_chamber' // 共鸣腔：回声爆炸 → 最近 2 个未被波及的敌人各生成小回声
  | 'overload_core'     // 过载核心：满级武器射速 +25% / 伤害 +12%，未满级 −8%

export interface RelicDef {
  id: RelicId
  name: string
  desc: string
  /** 代价。有代价的遗物在卡面上用告警色画 */
  cost2?: string
  price: number
  /**
   * 装备瞬间的副作用。
   * 原实现是 `(s: DiveScene) => void`（直接改场景字段）；这里改成
   * **数据化**（`stat` + `delta`），由 `DiveWorld.equipRelic()` 落地 ——
   * 目的是让遗物表不依赖任何具体世界实现，两个引擎共用。
   */
  onEquip?: { stat: keyof Stats; delta: number }
}

/** 模拟对外抛出的**事件**（打击感/音效/HUD 由渲染层消费，不进入模拟域） */
/**
 * 伤害**来源**（V6.46）。模拟层本来不关心"谁打的"，但渲染层必须关心 ——
 * 打击特效与击杀终结特效要按来源给不同形状，否则 11 把武器的命中反馈全一样。
 *
 * 缺省 `'bullet'`：枪弹 / 鱼叉 / 鱼雷这类"一颗东西飞过去打中"的通用情形。
 * 只有**有明显视觉特征**的来源才单独列出 —— 列的越多，渲染层的分支越难维护。
 */
export type DamageCause =
  | 'bullet'   // 枪弹 / 鱼雷直击（默认）
  | 'pierce'   // **穿透**：鱼叉（贯穿式，V6.62 起独立）—— **无视重甲护甲**
  | 'pulse'    // 声呐波前（环形，无方向）
  | 'arc'      // 链式电弧（折线）
  | 'blast'    // 爆炸：鱼雷 / 回声 / 气泡雷 / 诱饵自爆 —— **无视重甲护甲**
  | 'burn'     // 灼烧持续伤害（电网）
  | 'net'      // 网命中（低伤，但可能是最后一击）
  | 'bite'     // 内讧撕咬（同类互咬）

export type SimEvent =
  | { t: 'hit'; x: number; y: number; r: number; color: number; crit: boolean; dmg: number; nx: number; ny: number; cause?: DamageCause }
  | { t: 'kill'; x: number; y: number; r: number; color: number; kind: Kind; cause?: DamageCause }
  /**
   * 开火枪口（施法特效）。`fam` 决定画成什么形状 ——
   * 同一个黄色小火花用在 11 把武器上，等于没有施法反馈。
   */
  | { t: 'muzzle'; x: number; y: number; ang: number; color: number; fam?: WeaponFamily; power?: number }
  // ⚠️ **刻意没有 `charge`（前摇）事件**：蓄力进度完全可以从现成字段推出来 ——
  //    `world.weapons[i].timer / ivLast` 就是"这一发还剩多久"。渲染层读它画收拢环即可，
  //    模拟层不该为了表现再维护一份"我正在蓄力"的状态（两份状态必然会不一致）。
  | { t: 'pickup'; x: number; y: number; o2: number; coin: number }
  | { t: 'float'; x: number; y: number; text: string; color: number; size: number }
  | { t: 'playerHurt'; dirX: number; dirY: number; amount: number }
  | { t: 'dodge'; x: number; y: number }
  | { t: 'shake'; ms: number; intensity: number }
  /**
   * 网张开（V6.46 `openNet`）。
   *
   * `ang` = **抛出方向**（rad）。渲染层需要它 —— 网是**柔性体**，被甩出去时迎水的一面
   * 被向后拖 ⇒ 张开形状是**沿运动方向拉长的水滴形**，不是圆。没有方向就只能画同心圆环，
   * 那是"冲击波"的形状，不是网的形状（V6.61 按物理修正）。
   */
  // `ang` = 抛出方向（弧度）。**仅撒网有** —— 柔性网是沿速度方向甩出去的；
  //   氧气雷 / 水雷 / 诱饵的引爆是**全向**的，没有方向可言（`ang` 缺省 ⇒ 渲染层画各向同性爆点）。
  //   别为了"字段统一"给它们编一个方向：那会把"爆炸"画成"抛出"。
  | { t: 'burst'; x: number; y: number; r: number; ang?: number }
  /** 电弧折线（链式电弧）。点位只有模拟层知道，所以必须由事件带出来。 */
  | { t: 'arc'; pts: { x: number; y: number }[] }
  /** 鱼雷 / 回声爆点（渲染层画 blast 环 + 冲击波）。 */
  | { t: 'blast'; x: number; y: number; r: number }
  | { t: 'wave'; n: number; layer: number }
  | { t: 'waveCleared'; layer: number; wave: number }
  /** 下潜过渡开始（渲染层播下潜演出 + 换背景） */
  | { t: 'descend'; layer: number }
  | { t: 'layerCleared'; layer: number }
  | { t: 'runCleared' }
  | { t: 'dead' }
  /**
   * **敌弹被清除**（V6.83）。
   *
   * 为什么必须由模拟层抛事件、而不是渲染层"发现弹少了就自己画"：
   * 渲染层看到的只是 `eShots` 数组少了一项 —— 它**分不出**这颗弹是
   * ①打到玩家了 ②被爆炸抵消了 ③被网收走了 ④被撞角撞碎了 ⑤自然到点爆开。
   * 而这五种在画面上必须是**五句不同的话**（"被谁清掉的"是技能反馈的核心）。
   *
   * ⚠️ `cause` 只有模拟层知道（判定发生在那儿），所以**不能省**。
   */
  | { t: 'eshotDown'; x: number; y: number; r: number; cause: 'blast' | 'net' | 'ram' | 'hit' | 'spent' }

/** 玩家本帧输入（由渲染层采样后注入） */
export interface InputState {
  /** -1 / 0 / 1 */
  dx: number
  dy: number
  /**
   * 排气爆发。语义是**边沿**（原实现用 `JustDown`）：
   * 只有"这一帧刚按下"才为 true，按住不放不会连发。由输入层负责边沿判定。
   */
  burst: boolean
}

// ---------------------------------------------------------------------------
// 商店卡（Upgrade 的数据化形式）
// ---------------------------------------------------------------------------

/**
 * 商店卡定义（V6.6 起卡面按 `kind` 分区）。
 *
 * ⚠️ 与 web 版的一处**刻意差异**：原实现是 `apply: (s: DiveScene) => void`，
 * 直接抓着 Phaser 场景改字段。这里改成收 `ShopTarget`（结构接口，见下），
 * 于是卡池变成**纯数据 + 纯函数**，两个引擎共用同一份，且可以在无头测试里跑。
 */
export interface UpgradeDef {
  id: string
  name: string
  desc: string
  kind: 'weapon' | 'mount' | 'stat' | 'relic'
  /** 售价（鱼骨）。定价基准：L1 每波掉落上限 70，一波约攒 40 币 */
  cost: number
  apply: (s: ShopTarget) => void
  /** 返回 true 表示这张卡当前无效，不该出现在三选一里（"买了没效果"是最伤信任的事） */
  dead?: (s: ShopTarget) => boolean
  /** 遗物卡专用：卡面对应的遗物 id */
  relicId?: RelicId
  /**
   * 武器卡专用：这张卡属于哪个**武器族**。
   *
   * 用途只有一个 —— 解锁过滤（`unlocks.ts` 的 `filterPool`）：族没解锁就把它
   * 连同它的进化卡一起从抽池里摘掉。不带此字段的武器卡（如"弹药改良"）永远保留。
   * ⚠️ 加了新武器卡**必须**补这个字段，否则它会绕过解锁、锁了也照抽。
   */
  family?: WeaponFamily
}

/**
 * 商店卡的**落地接口** —— 卡池 `apply`/`dead` 只依赖这些成员，
 * 不依赖 `DiveWorld` 的具体实现（避免 card pool ↔ world 的循环依赖）。
 */
export interface ShopTarget {
  addWeapon(id: WeaponId, lvl?: number): void
  evolveWeapon(from: WeaponId, to: WeaponId): void
  levelAllWeapons(): void
  addStat(k: keyof Stats, v: number): void
  equipRelic(id: RelicId): void
  layer(): LayerDef
  weapons: Weapon[]
  relics: RelicId[]
  st: Stats
  maxWeapons: number
  o2Max: number
  o2: number
  layerIdx: number
  waveInLayer: number
}
