import Phaser from 'phaser'
import {
  WEAPONS, ENEMIES, UPGRADES, WAVE_RAMP, CHARS, ITEMS,
  FACTIONS, FORMATIONS, STRATAGEMS, CAMPAIGN, META_NAMES,
  BALANCE, ARMOR_NAMES, ROLE_NAMES, WEAPON_SLOTS, LIGHT,
  WeaponDef, EnemyDef, CharDef, Armor, ArmyRole, ItemDef,
  FactionDef, FormationDef, StratagemDef, ChapterDef, StageDef,
  enemyById, weaponById, charById, itemById,
  factionById, formationById, stratagemById, chapterById, stageKey
} from '../config/gameData'
// 战斗 HUD 的设计系统（夜色 · 亮黄 · 橙红 · 塑料绿 · 冷白，见 config/theme.ts）。
//
// **只服务对局内的 HUD**（主面板 / 势力档案 / 时间块 / 目标条 / 计谋槽 / 横幅 / toast）。
// 五个菜单屏（主菜单 / 选关 / 点将 / 升级 / 结算）与商店一律走 `ui/kit.ts` 的纸盒系统 ——
// 场地是"深海海底"（暗），菜单是"摆在海底沙地上的一套装备板"（纸盒）。
// 两套表面各司其职，这不是不一致，是分层。
// 图形色用 `UI.*`（number），文字色用 `TXT.*`（'#rrggbb'）—— 两者不能混用，
// 混了就是"黑字黑底"这种最难查的隐形 bug。
import { UI, TXT, FONT } from '../config/theme'
// 装备板 UI 组件库（2026-10-09 新增）。菜单/商店/主界面统一用它，
// 战斗 HUD 仍走 theme.ts 的暗色系统 —— 场地是"深海海底"（暗），
// 而菜单是"摆在这场地上的一副桌游"（纸盒），两套表面各司其职。
import { P, INK, FS, UI_MAX_ZOOM, card, button, tag, statBar, shell, shellTitle, label, iconSlot, pill, tapeStrip } from '../ui/kit'
// 卡牌图标（矢量，见 ui/glyphs.ts）：武器按 id、道具按效果类别分发。
import { drawWeaponGlyph, drawItemGlyph, itemIconTag } from '../ui/glyphs'
// 立绘策略：不再加载 AI 生成的人物立绘，
// HUD 头像与选人卡片一律改用**游戏内像素单位的放大帧** —— 风格统一、
// 零额外美术资源，而且卡片上看到的和场上跑的永远是同一个形象。

// 程序化生成的像素单位（tools/pixelgen.py 产出，规格见 manifest.json）
import pixelManifest from '../assets/pixel/manifest.json'
import pxHeroRookie from '../assets/pixel/hero_rookie.png'
import pxHeroGuanyu from '../assets/pixel/hero_guanyu.png'
import pxHeroZhangfei from '../assets/pixel/hero_zhangfei.png'
import pxHeroZhaoyun from '../assets/pixel/hero_zhaoyun.png'
import pxFoeMinion from '../assets/pixel/foe_minion.png'
import pxFoeRunner from '../assets/pixel/foe_runner.png'
import pxFoeTank from '../assets/pixel/foe_tank.png'
import pxFoeSwarm from '../assets/pixel/foe_swarm.png'
import pxFoeShooter from '../assets/pixel/foe_shooter.png'
import pxFoeShield from '../assets/pixel/foe_shield.png'
import pxFoeElite from '../assets/pixel/foe_elite.png'
import pxFoeBossWarlord from '../assets/pixel/foe_boss_warlord.png'
import pxFoeBossYanliang from '../assets/pixel/foe_boss_yanliang.png'
import pxFoeBossCaocao from '../assets/pixel/foe_boss_caocao.png'
import pxFoeBossGanning from '../assets/pixel/foe_boss_ganning.png'
import pxFoeBossTyrant from '../assets/pixel/foe_boss_tyrant.png'

// ---------------------------------------------------------------------------
// 像素单位规格
// 由 tools/pixelgen.py 程序化生成（帧布局见 assets/pixel/manifest.json）。
// 每个单位都在 32x32 的「逻辑像素网格」里绘制，整数倍放大以保证像素块锐利；
// 帧序列 = 3 方向 x (待机 2 / 走路 4 / 攻击 3)。
// 关键：朝向与抬手都是**画出来的**，不存在"靠旋转猜动作"这回事。
// ---------------------------------------------------------------------------
const PX_DIRS = ['down', 'up', 'side'] as const
const PX_ACTS = ['idle', 'walk', 'attack'] as const
const PX_COLS = 4
// 逻辑像素 -> 屏幕像素（整数倍，像素块才锐利）。
// 2 → 3 是本轮专门调的："场景太大、单位太小"的直接解法 ——
// 单位在屏幕上大 50%，视野比例随之收紧，压迫感来自"近"而不是"多"。
// 只能用整数倍：1.5 会把像素块拉成宽窄不一（NEAREST 采样），是最刺眼的瑕疵。
const PX_SCALE = 3

/**
 * 视野基准画面比例（决策 D3，见 docs/项目计划书.md §9.3）。
 *
 * 短边对齐，长边最多是短边的这个倍数，多出来的部分封进黑暗。
 * 16:9 = 1.778（约 1.78）覆盖绝大多数桌面屏；
 * 21:9 = 2.333 会被压到 1.78 → 长边从 35.8 格降到 20 格，和 16:9 完全一致。
 *
 * 不要设成更大：设成 2.0 就会让 16:9 玩家（占 87%）多出一圈黑边。
 */
const BASE_ASPECT = 16 / 9

/**
 * 非像素单位对象（子弹 / 曳光 / 拖尾 / 战场装饰）同步放大的系数。
 *
 * 这些贴图不是按"逻辑格"绘制的，不会跟随 PX_SCALE 自动变化；
 * 不乘这一下就会变成"单位大了一圈、子弹和装饰还停在旧尺寸"，
 * 比例一失衡，画面立刻能看出"子弹太小、场景太空"。
 */
const FX_SCALE = PX_SCALE / 2

/** 右上角关卡目标进度条的宽度（逻辑像素，实际再乘 hudK）。
 *  必须窄于「画布宽 - 左侧潜行者面板宽」，否则会压到面板上。 */
const OBJ_BAR_W = 200

/**
 * 相机缩放 —— **保持 1，不要用 zoom 来"拉近视野"**。
 *
 * 踩过的坑（代价是一整轮验证 4 条断言集体 FAIL）：
 * Phaser 的相机 zoom 会连 `scrollFactor = 0` 的对象一起缩放、一起偏移。
 * HUD 与备战界面**全部**是 scrollFactor 0 的屏幕坐标对象，于是
 * 左上角 8px 的面板被算成 `(8 - w/2) * zoom + w/2`，直接飞到屏幕外；
 * 玩家看到的界面位置与代码里的坐标彻底对不上（点击全部落空）。
 * 要让 HUD 不受 zoom 影响，必须给它单独一个相机（+ Layer 分组），
 * 那是一次全局重构，不值得为"视野"付这个代价。
 *
 * 正确的做法是**放大像素倍率**（PX_SCALE）：世界单位变大、视野随之显得更紧，
 * 而 HUD 完全不受影响。像素倍率本来就是整数倍，也顺手保住了像素锐利。
 */
const CAM_ZOOM = 1

/**
 * 生物护甲 → 脚下标识环的形态。
 *
 * `w` 是相对可视宽度的倍数，`h` 是绝对高度，`a` 是不透明度（0 = 不画）。
 * 用「形状」而不是颜色区分护甲：颜色已经用来表示生物发光色了，
 * 两个维度必须用两套通道，否则玩家读到的是"一团有色的东西"。
 *
 * 环的形状对应护甲的**物理直觉**，不是抽象编号：
 *   gel   胶质无骨架 → 不画环（软塌塌的东西没有硬边轮廓）
 *   scale 鳞甲成片   → 细密环（鳞片感）
 *   cal   钙壳硬壳   → 又大又厚的双线环（一整块壳）
 *   bone  骨质支撑   → 又宽又扁的支撑环
 */
const ARMOR_RING: Record<Armor, { w: number; h: number; a: number }> = {
  gel: { w: 0, h: 0, a: 0 },                 // 胶质：无骨架，不画
  scale: { w: 1.05, h: 22, a: 0.55 },        // 鳞甲：细环
  cal: { w: 1.40, h: 33, a: 0.78 },          // 钙壳：又大又厚的双线环
  bone: { w: 1.55, h: 15, a: 0.66 }          // 骨质：又宽又扁
}

/**
 * 深海生物发光的配色池。
 *
 * 装饰贴图统一用**白色明度层次**画，摆进场景时从这组颜色里随机 tint——
 * 一套贴图能出十几种颜色，而且整体色调天然统一（都落在生物发光的青蓝色域里）。
 * 逐个贴图写死颜色的话，既做不到变化，也容易调出刺眼配色。
 */
const BIOLUM_COLORS = [0x4fe8ff, 0x7fffd4, 0xff5fd0, 0xffd24a, 0xa88fff, 0xff7a4a]

type PxDir = typeof PX_DIRS[number]
type PxAct = typeof PX_ACTS[number]

interface PxUnit {
  sheet: string
  upscale: number // 美术分辨率倍数：格子多大（只影响清晰度）
  zoom: number    // 显示倍率：单位多大（只影响体积）
  cell: number
  bbox: [number, number, number, number] | null // 「朝下·待机」帧的 alpha 包围盒（逻辑像素）
  muzzle: Record<string, [number, number]>
}
const PX_UNITS = pixelManifest.units as unknown as Record<string, PxUnit>

const pxKey = (unit: string) => 'px_' + unit
const pxCell = (unit: string) => (pixelManifest.grid as number) * (PX_UNITS[unit]?.upscale ?? 1)
/** 屏幕缩放 = 基础倍率 × 体积倍率 ÷ 美术分辨率倍率。
 *  分开的理由：以前 `PX_SCALE * upscale` 让 Boss 的分辨率和体积一起翻倍，
 *  64 格 × 4 倍 = 256px —— 在 800 高的屏幕上占掉三分之一，纯属事故。 */
const pxScale = (unit: string) => {
  const u = PX_UNITS[unit]
  return (PX_SCALE * (u?.zoom ?? 1)) / (u?.upscale ?? 1)
}
/** 单位可视尺寸（屏幕像素）。注意用一个「逻辑格 → 屏幕」的固定比例，
 *  而不是 sprite 的 scale —— bbox 的单位是逻辑格，两者在 Boss 上不是一回事。 */
const PX_LOGICAL = (unit: string) => PX_SCALE * (PX_UNITS[unit]?.zoom ?? 1)
const pxVisH = (unit: string) => {
  const bb = PX_UNITS[unit]?.bbox
  return (bb ? bb[3] - bb[1] : 30) * PX_LOGICAL(unit)
}
const pxVisW = (unit: string) => {
  const bb = PX_UNITS[unit]?.bbox
  return (bb ? bb[2] - bb[0] : 20) * PX_LOGICAL(unit)
}

// HUD 三档字号（用户对字号敏感，给一个自己可调的档位：按 F 循环）
const HUD_SCALES = [1, 1.22, 1.45]
const HUD_LABELS = ['标准', '大', '特大']

/** spritesheet 内的帧号：行 = 方向 x 动作，列 = 该动画的帧序号 */
function pxFrame(dir: PxDir, act: PxAct, f: number): number {
  const row = PX_DIRS.indexOf(dir) * PX_ACTS.length + PX_ACTS.indexOf(act)
  return row * PX_COLS + f
}

/** 各单位 spritesheet 与素材文件的对应关系 */
const PX_SHEETS: Record<string, string> = {
  hero_rookie: pxHeroRookie,
  hero_guanyu: pxHeroGuanyu,
  hero_zhangfei: pxHeroZhangfei,
  hero_zhaoyun: pxHeroZhaoyun,
  foe_minion: pxFoeMinion,
  foe_runner: pxFoeRunner,
  foe_tank: pxFoeTank,
  foe_swarm: pxFoeSwarm,
  foe_shooter: pxFoeShooter,
  foe_shield: pxFoeShield,
  foe_elite: pxFoeElite,
  foe_boss_warlord: pxFoeBossWarlord,
  foe_boss_yanliang: pxFoeBossYanliang,
  foe_boss_caocao: pxFoeBossCaocao,
  foe_boss_ganning: pxFoeBossGanning,
  foe_boss_tyrant: pxFoeBossTyrant
}

// 立绘：256x256 透明底，仅供**静态展示**（HUD 头像 / 选人卡片），见 tools/process_portraits.py
const TEX = 256
const PLAYER_SCALE = 0.22 // 256 * 0.22 ~= 56px

interface WeaponRT { def: WeaponDef; cd: number; angle: number }

// 幸存者类核心场景：
// 移动 + 多类型自动武器 + 波次导演刷怪 + 射手远程 + Boss + 经验升级三选一 + 计时结算 + meta 解锁。
// 表现层：主角走路动画（bob/倾斜/压扁/扬尘）、枪口火光 + 曳光弹 + 后坐力、命中火花与闪白、震屏。
export class GameScene extends Phaser.Scene {
  // 玩家用 Container 承载 AI 立绘：可见层是缩放后的立绘图片，物理碰撞框独立设为世界单位，
  // 避免大图缩放把 Arcade 圆形碰撞框带成超大/超小（不同 Phaser 版本行为不一致）。
  private player!: Phaser.GameObjects.Container
  // 主角立绘：单张图，按朝向(front/back/side)直接换贴图。
  // 之所以不再做"上下半身分层绕腰旋转"：静态正面图无论怎么转都转不出侧面/背面，
  // 反而会把身体切歪。现在改用三张真实姿态图，转向与施法都靠换图 + 姿态变形完成。
  private heroImg!: Phaser.GameObjects.Sprite
  private curDir: PxDir = 'down' // 当前实际贴在图上的朝向，避免每帧重复 setFrame
  private shadow!: Phaser.GameObjects.Image
  private vig!: Phaser.GameObjects.Image
  private enemies!: Phaser.Physics.Arcade.Group
  private bullets!: Phaser.Physics.Arcade.Group
  private pickups!: Phaser.Physics.Arcade.Group
  private enemyBullets!: Phaser.Physics.Arcade.Group
  private orbits!: Phaser.Physics.Arcade.Group
  private keys!: any

  private hp = 0
  private maxHp = 0
  private speed = 0
  private level = 1
  private exp = 0
  private expNeed = 0
  private score = 0
  private kills = 0
  private elapsed = 0
  private fireCdScale = 1
  private dmgScale = 1
  private magnet = 160
  private pierceBonus = 0
  private weapons: WeaponRT[] = []
  private spawnAccum = 0
  private orbitAngle = 0
  private bossesSpawned = new Set<string>()
  /** 当前波次强度阶段下标（WAVE_RAMP）。初值 -1 是为了让第 0 阶段（开场敌潮）也播报一次，
   *  否则玩家永远听不到「黄巾力士是轻甲、短弓可克」这条最关键的入门提示。 */
  private waveIdx = -1
  private eidSeq = 0
  /** 受击无敌剩余时间（ms）。见 tickInvuln 的说明 —— 这是本作唯一一条
   *  能把「被围住」从必死改成可操作的保护机制。 */
  private invuln = 0
  /** 当前升级面板抽到的 3 个选项 id。仅供自动化测试读取，不参与游戏逻辑。 */
  private upgradePicks: string[] = []

  // ---------------- 战役（章节 / 关卡 / 目标） ----------------
  // 主线的三层结构：章 = 一个势力 + 阵型池 + Boss + 色调；关 = 章节内的三种强度与目标。
  private chapter: ChapterDef = CAMPAIGN[0]
  private stage: StageDef = CAMPAIGN[0].stages[0]
  private faction: FactionDef = FACTIONS[0]
  /** 已通关的关卡键（形如 "c2s3"）。跨局持久化，决定章节解锁。 */
  private cleared = new Set<string>()
  /** 本关目标是否已达成（kill 关 = 击杀达标；boss 关 = 击杀 Boss） */
  private objDone = false
  private objProgress = 0
  private objLabel = ''
  private objText!: Phaser.GameObjects.Text
  private objBar!: Phaser.GameObjects.Graphics
  /** 章节色调叠加层：零美术成本制造"这一章不一样"的直觉 */
  private chapterTint!: Phaser.GameObjects.Rectangle
  /** 本关是否已判负（超时未达成目标） */
  private objFailed = false
  /** boss 关：Boss 是否已被击杀 */
  private bossDown = false

  // ---------------- 计谋（玩家唯一的主动操作） ----------------
  private stratagem: StratagemDef | null = null
  private unlockedS = new Set<string>()
  /** 计谋冷却剩余（ms） */
  private stratCd = 0
  private stratText!: Phaser.GameObjects.Text
  private stratIcon!: Phaser.GameObjects.Graphics
  private stratRing!: Phaser.GameObjects.Graphics
  private stratReady = 0
  /** 超频电池：临时伤害倍率 / 攻速倍率 / 受伤倍率 / 剩余时间 */
  private buffDmg = 1
  private buffAtk = 1
  private buffVuln = 1
  private buffT = 0
  /** 减速效果截止时间（秒） */
  private slowUntil = -1
  /** 护罩光晕：需要跟随玩家移动，所以存在场景上、由 update 每帧同步位置。 */
  private guardAura: Phaser.GameObjects.Image | null = null
  /**
   * 护罩最近一次**实际授予**的无敌时长（ms），施放瞬间记录。
   *
   * 仅供自动化验证读取，不参与游戏逻辑。
   * 为什么要单独记：断言原本是"施放后等 0.45s 再读 s.invuln，必须 > 1500"，
   * 而 invuln 是**真实时间衰减**的 —— 机器卡一下（CDP 首轮很常见）就会读到 1400 上下，
   * 一次偶发失败会被误读成"护罩坏了"。记下授予值就没有这个时间噪声了。
   */
  private lastGuardMs = 0
  /** 最近生成的阵型 id（仅供自动化测试读取，判断阵型是否真的生效） */
  private formationLog: string[] = []

  // ---------------- Brotato 化：波次 / 材料 / 商店 / 道具 ----------------
  /** 材料：波间商店的货币。来源 = 击杀 + 拾取 + 每波保底。 */
  private materials = 0
  /** 当前波（1 起）。一关 = stage.waves 波，每波 WAVE_SEC 秒。 */
  private wave = 1
  /** 当前波内已过时间（秒），用于 HUD 的波内进度显示。 */
  private waveT = 0
  /** 是否停留在波间商店（此时游戏暂停）。 */
  private inShop = false
  /** 已购道具。 */
  private items: ItemDef[] = []
  /** 道具累计修正 —— 全部是**加法累积**，与升级的乘法倍率分开计算。 */
  private armorFlat = 0          // 每次受击固定减伤
  private critChance = 0         // 暴击率
  private critMul = 0            // 暴击额外倍率（0.5 = 150%）
  private lifestealBonus = 0     // 每次击杀额外回血
  private thornsBonus = 0        // 受击反弹比例（与被动叠加）
  private regenPerWave = 0       // 每波开始回血
  private materialsPerPickup = 0 // 每次拾取额外材料
  /** 商店当前上架的商品。 */
  private shopOffers: { kind: 'weapon' | 'item'; id: string; price: number; sold: boolean }[] = []
  private shopOverlay: Phaser.GameObjects.Container | null = null
  /** 商店的压暗底：必须场景级（面板在小窗口下会整体 setScale 缩放，底跟着缩会漏边）。 */
  private shopBackdrop: Phaser.GameObjects.Rectangle | null = null
  /** 商店的 window 键盘监听（与备战界面同一类风险，必须场景级唯一）。 */
  private shopKeyHandler: ((ev: KeyboardEvent) => void) | null = null
  /** 商店 UI 里随材料变化需要重绘的文字（材料数 / 商品可买态）。 */
  private shopRefresh: (() => void) | null = null

  private hpText!: Phaser.GameObjects.Text
  private lvText!: Phaser.GameObjects.Text
  private nameText!: Phaser.GameObjects.Text
  private statText!: Phaser.GameObjects.Text
  private weaponText!: Phaser.GameObjects.Text
  /** 左上主面板下方的「当前势力档案」：色块 + 势力名 + 特性。
   *  势力是四支柱之一，但玩家在局内原本看不到任何势力信息 —— 只知道"有人在打我"。 */
  private factionChip!: Phaser.GameObjects.Rectangle
  private factionText!: Phaser.GameObjects.Text
  private timeText!: Phaser.GameObjects.Text
  private timePanel!: Phaser.GameObjects.Rectangle
  private expBar!: Phaser.GameObjects.Graphics
  private hpBar!: Phaser.GameObjects.Graphics
  /** HUD 头像：用游戏内像素单位的放大帧（不再用 AI 立绘）。 */
  private portrait!: Phaser.GameObjects.Sprite
  // HUD 整体重排用：所有 UI 对象集中登记，切档时整体销毁重建（比逐个改字号可靠）
  private hudObjs: Phaser.GameObjects.GameObject[] = []
  private hudTier = 0
  private hudK = 1
  private hudBarX = 96
  private hudBarW = 190
  private hudHpY = 44
  private hudExpY = 68
  // 玩家脚下的指示环：任何背景下都能一眼找到自己
  private ring!: Phaser.GameObjects.Image
  private playerHalo!: Phaser.GameObjects.Image

  // ================= P2 · 光资源与光照半径 =================
  //
  // 光量 = 光照半径本身（见 gameData.LIGHT 的注释：这是一个数值，不是两条）。
  // 玩家开火 → 光量掉 → 视野收窄；停火 → 光回涨 → 视野重新铺开。
  /** 当前光量 0..LIGHT.max */
  private light = 0
  /** 当前光照半径（px），每帧从 light 平滑插值得到 —— 直接跳变会像屏幕闪了一下 */
  private lightR = 0
  /** 黑暗遮罩：用一张 Canvas 纹理，中心透明、四周压黑，size 跟着 lightR 变 */
  private darkMask!: Phaser.GameObjects.Image
  /** 玩家头灯：ADD 混合的一圈柔光，depth 36（在黑暗遮罩 35 之上） */
  private heroLamp!: Phaser.GameObjects.Image
  /** 玩家轮廓光：ADD 混合的亮青描边，depth 37 */
  private heroEdge!: Phaser.GameObjects.Image
  /** 光量 HUD 条 */
  private lightBar!: Phaser.GameObjects.Graphics
  private lightText!: Phaser.GameObjects.Text
  /** 光低于 tacticalFrac 时闪一次，用于提示"你进入头灯范围了" */
  private lightWarned = false

  // 视野黑幕：超宽屏溢出部分压成纯黑+ 内侧渐隐条。详见 viewClamp() / buildViewMask()
  private viewMaskL!: Phaser.GameObjects.Rectangle
  private viewMaskR!: Phaser.GameObjects.Rectangle
  private viewMaskT!: Phaser.GameObjects.Rectangle
  private viewMaskB!: Phaser.GameObjects.Rectangle
  /** 每侧 4 条递减透明度的窄条，共 16 条；下标 side*4+i */
  private viewMaskSoft: Phaser.GameObjects.Rectangle[] = []
  // 伤害飘字对象池：Text 每次创建都要烘焙一张贴图，逐发新建会拖帧
  private dmgPool: Phaser.GameObjects.Text[] = []
  /** 飘字错位状态：同点连击时把新数字往上/左右推开，避免叠成一团。 */
  private lastPopAt = 0
  private lastPopX = 0
  private lastPopY = 0
  private popStack = 0
  private hintText!: Phaser.GameObjects.Text
  private paused = false
  private over = false
  private started = false
  private restarting = false
  private selectOverlay!: Phaser.GameObjects.Container | null
  // 备战界面的选择状态（不随面板重建而丢失）
  private prepIdx = 0
  private prepChar: CharDef = CHARS[0]
  private prepStrat = ''
  /** 备战分两步：'stage' = 战役·选关，'deploy' = 帐前·点将。 */
  private prepStep: 'hub' | 'stage' | 'deploy' = 'hub'
  /** 选关页当前选中的关卡序号（默认 = 该章第一个未通关的关）。 */
  private prepStage = 1
  /** 生涯战绩（Hub 展示用）。本地存档，离线也能显示。 */
  private bestWave = 0
  private totalKills = 0
  /**
   * 备战界面的全屏压暗底。
   *
   * **必须是场景级、不随面板缩放的对象**：备战面板是 900x646 的固定版式，
   * 窗口比它小时会整体 `setScale(fit)` 缩小 —— 如果把压暗底放进这个容器里，
   * 它会跟着一起缩，四周漏出 10 来像素的局内画面（实测截图四条边都有暗缝）。
   * 压暗底的任务是"彻底盖住下面那层"，它不能受面板版式影响。
   */
  private prepBackdrop: Phaser.GameObjects.Rectangle | null = null
  /**
   * 备战界面挂在 window 上的键盘处理函数。
   *
   * **必须存在场景上、且全局只有一份。** 见 bindPrepKeys() 的说明 ——
   * 之前把它挂在每次重建都会新建的容器上，于是"摘掉旧监听"永远摘不到，
   * 监听只增不减，最后表现为「对局中按方向键会把备战面板重新弹出来」。
   */
  private prepKeyHandler: ((ev: KeyboardEvent) => void) | null = null

  private bg!: Phaser.GameObjects.TileSprite
  /** 战场装饰池：固定一批对象循环复用（离玩家太远就搬到前方的环带上），
   *  这样地图"无限大"但对象数恒定，不会随着走动越积越多。 */
  private props: Phaser.GameObjects.Image[] = []
  private propAccum = 0
  private moving = false
  private moveVx = 0        // 本帧输入方向（-1/0/1）
  private moveVy = 0
  private facing: PxDir = 'down'    // 由移动输入决定的朝向（down/up/side）
  private faceRight = true          // facing==='side' 时是否面向右（决定 flipX）
  private lastVx = 1                // 记忆最近一次的水平方向：上下移动时保持左右朝向不跳
  private aimFacing = 1             // 施法瞬间锁定的左右朝向（+1 右 / -1 左）
  private aimDir: PxDir = 'side'    // 施法瞬间锁定的姿态
  private aimLock = 0               // 施法朝向锁剩余时间(ms)：开火期间朝向不被移动输入覆盖
  private walkAnimT = 0     // 走路帧动画计时(ms)
  private castAnim = 0      // 抬手施法/开火动作进度（1 -> 0）
  private fxStopping = false // hitStop 防重入：顿帧进行中不叠加第二次
  private fireAngle = 0     // 最近一次施法方向
  private dustTimer = 0     // 走路扬尘计时
  // ---- 后期辉光与粒子（弹幕"发光"的唯一来源，见 setupPostFX / setupParticles）----
  private bloomFX: Phaser.FX.Bloom | null = null
  private pSpark!: Phaser.GameObjects.Particles.ParticleEmitter
  private pEmber!: Phaser.GameObjects.Particles.ParticleEmitter
  private pSmoke!: Phaser.GameObjects.Particles.ParticleEmitter

  // meta（跨局解锁）
  private unlockedW = new Set<string>(['bow', 'crossbow'])
  private unlockedC = new Set<string>(['rookie'])
  private activeChar = CHARS[0]
  private pid = 'local'

  constructor() { super('game') }

  preload() {
    // 游戏内单位：像素帧序列（每张 sheet 4 列 x 9 行 = 3 方向 x 3 动作）
    for (const unit in PX_SHEETS) {
      const c = pxCell(unit)
      this.load.spritesheet(pxKey(unit), PX_SHEETS[unit], { frameWidth: c, frameHeight: c })
    }
  }

  create() {
    // 程序贴图只生成一次：scene.restart() 会再跑一遍 create，
    // 不判断就会重复 generateTexture（Phaser 会告警且浪费显存）
    if (!this.textures.exists('ground')) this.makeTextures()

    // 重开一局时实例字段不会自动清空，必须显式重置整局状态 ——
    // 否则第二局会带着上一局的分数、等级、Boss 已刷记录和掉血后的血量。
    this.level = 1
    this.exp = 0
    this.score = 0
    this.kills = 0
    this.elapsed = 0
    this.fireCdScale = 1
    this.dmgScale = 1
    this.pierceBonus = 0
    this.spawnAccum = 0
    this.orbitAngle = 0
    this.eidSeq = 0
    this.invuln = 0
    this.over = false
    this.paused = false
    this.started = false
    this.restarting = false
    this.selectOverlay = null
    this.prepBackdrop = null
    // 场景重启（scene.restart）会复用同一个实例，window 上那份备战监听
    // 必须显式摘掉 —— window 不属于场景，场景销毁不会替你清。
    if (this.prepKeyHandler) {
      window.removeEventListener('keydown', this.prepKeyHandler)
      this.prepKeyHandler = null
    }
    this.prepStep = 'stage'
    this.dmgPool = []
    this.hudObjs = []
    this.moving = false
    this.castAnim = 0
    // 顿帧（hitStop）改写过 time/tweens 的 timeScale，重开必须复位，否则残留会拖慢整局
    this.fxStopping = false
    this.time.timeScale = 1
    this.tweens.timeScale = 1
    this.upgradePicks = []
    this.aimLock = 0
    this.walkAnimT = 0
    this.facing = 'down'
    this.faceRight = true
    this.bossesSpawned = new Set<string>()
    this.waveIdx = -1
    this.popStack = 0
    this.lastPopAt = 0
    // 战役与计谋的局内状态（跨局数据如 cleared / unlockedS 在 loadMeta 里恢复，不在这里清）
    this.objDone = false
    this.objFailed = false
    this.bossDown = false
    this.objProgress = 0
    this.stratCd = 0
    this.stratReady = 0
    this.buffDmg = 1
    this.buffAtk = 1
    this.buffVuln = 1
    this.buffT = 0
    this.slowUntil = -1
    this.guardAura = null
    this.lastGuardMs = 0
    this.formationLog = []
    // Brotato 化的局内状态（重开必须全部归零，否则会带着上一局的道具和材料）
    this.materials = 0
    this.wave = 1
    this.waveT = 0
    this.inShop = false
    this.items = []
    this.armorFlat = 0
    this.critChance = 0
    this.critMul = 0
    this.lifestealBonus = 0
    this.thornsBonus = 0
    this.regenPerWave = 0
    this.materialsPerPickup = 0
    this.shopOffers = []
    this.shopOverlay = null
    this.shopBackdrop = null
    this.shopRefresh = null
    if (this.shopKeyHandler) {
      window.removeEventListener('keydown', this.shopKeyHandler)
      this.shopKeyHandler = null
    }

    this.pid = this.resolvePid()
    this.loadCareer()
    this.hp = this.maxHp = BALANCE.playerMaxHp
    this.speed = BALANCE.playerSpeed
    this.expNeed = BALANCE.expToLevel
    // 光满开局：玩家一进场就该看得见全场，
    // 「视野收缩」必须是**他自己开火打出来的**，不是一开始就被罚。
    this.light = LIGHT.max
    this.lightR = LIGHT.tacticalR
    this.lightWarned = false
    this.magnet = 160
    // 初始武器只是个占位，真正生效的起手武器由 applyCharStats() 按潜行者写入。
    // **不要写 `weaponById('pistol')!`** —— 武器库换成冷兵器后 'pistol' 已不存在，
    // `!` 断言会把这个 undefined 一路放行到 refreshHud 里 `o.def.name` 才炸，
    // 表现是选人界面整个不渲染（异常发生在 buildHud → create 的中途）。
    const starter = weaponById(CHARS[0].weapon) || WEAPONS[0]
    this.weapons = [{ def: starter, cd: 0, angle: 0 }]

    const cx = this.scale.width / 2
    const cy = this.scale.height / 2

    // 石板地面：跟随镜头移动，制造"在场地里跑"的空间感。
    // tileScale 必须等于相机 zoom，否则背景会相对地面**打滑** ——
    // 内容位移按 1:1 而世界按 zoom 倍走，一走起来就能看出地面在飘。
    this.bg = this.add.tileSprite(cx, cy, this.scale.width, this.scale.height, 'ground')
      .setScrollFactor(0)
      .setDepth(-20)
      .setTileScale(CAM_ZOOM, CAM_ZOOM)

    // 玩家脚下的阴影
    this.shadow = this.add.image(cx, cy + 30, 'blob')
      .setDisplaySize(38, 13)
      .setDepth(-1)

    // 游戏内主角 = 像素帧序列。帧号由「方向 x 动作」决定（见 pxFrame），
    // 转身与抬手都是换帧，不再靠旋转/缩放去模拟。
    const heroUnit = 'hero_' + this.activeChar.id
    this.heroImg = this.add.sprite(0, 0, pxKey(heroUnit), pxFrame('down', 'idle', 0))
      .setScale(pxScale(heroUnit))
      .setOrigin(0.5, 0.5)
      .setDepth(9)
    this.player = this.add.container(cx, cy, [this.heroImg])
    this.physics.add.existing(this.player)
    const pbody = this.player.body as Phaser.Physics.Arcade.Body
    pbody.setSize(42, 42)
    pbody.setOffset(-21, -21)

    // 脚下指示环：把"我在哪"从"看清立绘"里解耦出来。
    // 满屏敌人 + 暗色地面时，玩家第一眼找不到自己是最伤体验的问题。
    //
    // 为什么是**双环 + 实心盘**：换壳成深海之后单靠细环不够用了。
    // bell 族水母自带发光晕，晕的直径比玩家立绘还大，
    // 玩家混在一堆发光块中间时，细环会被邻敌的晕直接盖住 ——
    // 实机截图里就是这样：满屏都在闪，玩家"不见了"。
    // 所以改成：外圈实心暗底盘（把背景压下去）+ 内圈亮青环（认位置），
    // 底盘的直径大于最大敌人的发光晕，保证任何情况下都压得住。
    this.playerHalo = this.add.image(cx, cy + 30, 'blob')
      .setDisplaySize(96, 40).setTint(0x000000)
      .setAlpha(0.5).setDepth(6)
    this.ring = this.add.image(cx, cy + 30, 'ring')
      .setTint(UI.jadeHi).setAlpha(0.95).setDepth(7)
      .setDisplaySize(64, 26)

    // 暗角叠加：矩形暗框直接拉伸到屏幕尺寸，边缘和四角一起变暗
    this.vig = this.add.image(cx, cy, 'vignette')
      .setScrollFactor(0).setDepth(85)
      .setDisplaySize(this.scale.width, this.scale.height)

    // 章节色调：每章一色，低透明度铺满全屏。
    // 这是**零美术成本**的视觉身份 —— 换一个色块，玩家立刻知道"这章不一样"。
    // 深度放在暗角之下（84），这样它压不住暗角收拢视线的作用。
    this.chapterTint = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, this.chapter.tint, 0.22)
      .setScrollFactor(0).setDepth(84).setBlendMode(Phaser.BlendModes.ADD)

    // ---- P2 · 黑暗遮罩 ----
    //
    // 深度选 35 是有讲究的，必须同时满足三件事：
    //   >9   盖住玩家自己？**不能** —— 玩家必须在光里，否则看不见自己。
    //        玩家 depth 9，所以遮罩要大于 9 才会压住玩家。
    //        这里用 35 是因为它同时也盖住了敌人（depth 0-9）——
    //        玩家之所以还能看见，靠的是下面那圈 depth 6-7 的
    //        playerHalo + ring：它们虽然深度更低，但**本就在光圈内**，
    //        遮罩中心半径内 alpha=0，不影响。
    //   <40 盖住特效？**要盖**。敌人死了要冒出粒子，深处的爆点比敌人更该看见，
    //        所以特效层（40-63）留在遮罩之上。
    //   <84 不盖 HUD。HUD 在 99，永远亮着 —— 玩家永远能读到自己的血量。
    //
    // 放在 chapterTint(84) 之下是为了让章节色**铺在黑暗里**而不是盖住黑暗，
    // 否则深处的海底会被章节色提亮，"无光层"就没了。
    this.darkMask = this.add.image(cx, cy, 'darkmask')
      .setDepth(35).setAlpha(0)

    // 玩家头灯：复用现成的 'glow' 径向柔光贴图，ADD 混合。
    // 深度 36 = 刚好压在黑暗遮罩(35) 之上 —— 差1 就够，差多了会被特效层干扰。
    this.heroLamp = this.add.image(cx, cy, 'glow')
      .setDepth(36).setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0x4fe8ff)

    // 玩家轮廓描边：depth 37，压在头灯之上、敌人之上。
    //
    // 为什么需要它：P2 上光之后实测发现玩家还是会"看不见"，
    // 但根因不是层级（玩家 depth 9 已经高于敌人的 0），
    // 而是**水母的发光晕太大** —— bell 族的柔光半径有 100+px，
    // 叠在玩家身上就把深色潜水服整个盖掉了。
    //
    // 一圈亮青描边（ADD 混合）等于给玩家画了一个"轮廓光"，
    // 这是深海题材的合理语言（生物发光的边缘），
    // 也是所有动作游戏解决"角色陷进同色背景"的标准手法。
    this.heroEdge = this.add.image(cx, cy - 6, 'ring')
      .setDepth(37).setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0x7fffd4).setAlpha(0.8)

    this.buildViewMask()

    // 战场装饰：无限地图上"随处有东西可看"，而不是一片空石板
    this.initProps()

    this.enemies = this.physics.add.group()
    this.bullets = this.physics.add.group()
    this.pickups = this.physics.add.group()
    this.enemyBullets = this.physics.add.group()
    this.orbits = this.physics.add.group()

    this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHit as any, undefined, this)
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerHit as any, undefined, this)
    this.physics.add.overlap(this.player, this.pickups, this.onPickup as any, undefined, this)
    this.physics.add.overlap(this.player, this.enemyBullets, this.onEnemyBulletHit as any, undefined, this)
    this.physics.add.overlap(this.orbits, this.enemies, this.onOrbitHit as any, undefined, this)

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1)
    // 恒为 1：**刻意不用 zoom 拉近视野**，原因见 CAM_ZOOM 的注释
    // （zoom 会把 scrollFactor=0 的整个 HUD 一起缩放并推出屏幕）。
    // "单位太小 / 场景太空"靠 PX_SCALE 解决。
    this.cameras.main.setZoom(CAM_ZOOM)
    this.cameras.main.setBackgroundColor('#0b0910')

    // 辉光必须在 HUD 建起来之前挂上（同一台相机全会吃到），
    // 粒子发射器要先有贴图，所以都放在这里 —— makeTextures 已在 create 之前跑完。
    this.setupPostFX()
    this.setupParticles()

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT')

    // B：开关辉光。
    // 辉光是整层特效里**唯一有真实 GPU 成本**的一项（全屏多趟模糊），
    // 实测即便在软件渲染下也吃掉约三分之一帧时间。低配机 / 集成显卡上
    // 值得让玩家自己关掉 —— 关掉之后弹幕依然有拖尾和粒子，只是不再过曝。
    this.input.keyboard!.on('keydown-B', () => {
      if (!this.bloomFX) return
      this.bloomFX.active = !this.bloomFX.active
      this.toast(`辉光：${this.bloomFX.active ? '开' : '关'}`)
    })

    // F：循环 HUD 三档大小。字号是这个用户明确敏感的项，给他自己放大的能力，
    // 而不是替他固定一个尺寸。
    this.input.keyboard!.on('keydown-F', () => {
      this.hudTier = (this.hudTier + 1) % HUD_SCALES.length
      this.rebuildHud()
      this.toast(`界面大小：${HUD_LABELS[this.hudTier]}`)
    })
    // Q / E：释放计谋。这是玩家除走位外的**第二个决策点** ——
    // 所以按键必须好按（左手不用离开移动键），且两个键都认（不同人的习惯不同）。
    this.input.keyboard!.on('keydown-Q', () => this.castStratagem())
    this.input.keyboard!.on('keydown-E', () => this.castStratagem())
    this.scale.on('resize', this.layout, this)
    this.buildHud()
    this.loadMeta()
  }

  /**
   * 相机在**世界坐标**下的可视半宽/半高。
   *
   * 相机的 zoom 同时改变两件事：「看得见多大范围」和「单位多大」。
   * 所有"屏幕外生成"的半径都必须用它折算 —— 否则 zoom 越大，
   * 敌人从越远的地方生成、要走越久才进场，主观上就是"地图很空、
   * 明明刷了怪却半天见不到"。
   *
   * ⚠️ 这里返回的是**钳制后**的视野（见 viewClamp），不是屏幕的真实半宽。
   * 敌人生成、索敌、边界判定全部走这里，所以钳制一旦生效，
   * 全局难度会随屏幕比例自动对齐。
   */
  private viewHalf(): { hw: number; hh: number } {
    const z = this.cameras.main.zoom || 1
    const c = this.viewClamp()
    return { hw: c.w / (2 * z), hh: c.h / (2 * z) }
  }

  /**
   * 视野钳制：**按短边对齐，超宽屏多出来的长边封进黑暗**。
   *
   * 为什么要做（决策 D3，见 docs/项目计划书.md §9.3）：
   *
   *  单位在屏幕上占 `PX_SCALE × cell = 96px`。换成"单位格"看可见范围：
   *
   *    16:9  1920×1080 → 20.0 × 11.2 格
   *    21:9  3440×1440 → 35.8 × 15.0 格   ← 长边是 16:9 的 1.79 倍
   *
   *  波次配置是固定的（"这波刷 80 只"），所以 21:9 玩家能拉开 1.79 倍的
   *  逃跑纵深，而敌人数量不变 —— **难度被系统性地降低了**。
   *  21:9 占比虽只有 3%，但这批人更愿意买和更愿意口碑，得当。
   *
   * 顺带一个好处：这个题材是「黑暗中的一束光」，封黑不是妥协，
   *  而是**把设计约束变成美术语言** —— 没照到的地方本来就不该看见。
   *
   *  实现：按短边推出"基准画面比例"（BASE_ASPECT），
   *  长边超出部分 = 两侧黑幕 + 顶部遮罩。所有玩法逻辑只认钳制后的范围，
   *  因此 21:9 与 16:9 的难度完全一致。
   */
  private viewClamp(): { w: number; h: number; barW: number; barH: number } {
    const w = this.scale.width
    const h = this.scale.height
    // 短边对齐：短边就是"高度基准"，长边最多是它的 BASE_ASPECT 倍
    const shortSide = Math.min(w, h)
    const longSide = Math.max(w, h)
    const maxLong = shortSide * BASE_ASPECT
    const clampedLong = Math.min(longSide, maxLong)
    const overflow = (longSide - clampedLong) / 2
    // 未溢出时 bar 宽高为 0（Rectangle 设 0 宽高是安全的，且不占渲染）
    return {
      w: clampedLong,
      h: shortSide,
      barW: w > h ? overflow : 0,
      barH: w > h ? 0 : overflow,
    }
  }

  /**
   * 两侧黑幕 + 顶部遮罩，把超宽屏溢出的部分压成纯黑。
   *
   * 为什么是纯黑而不是半透明：游戏本体是近黑深海底，
   * 半透明黑幕会露出"墙后面还有战场"，反而让人以为能走进去。
   * 纯黑 + 渐隐才是"照不到"。
   *
   * 深度 86：在暗角（85）之上、章节色调（84）之下，
   * 保证它压得住整个画面但不影响 HUD（HUD 在 400+）。
   */
  private buildViewMask() {
    const c = this.viewClamp()
    const mk = (x: number, y: number, bw: number, bh: number) =>
      this.add.rectangle(x, y, Math.max(0, bw), Math.max(0, bh), 0x000000, 1)
        .setScrollFactor(0).setDepth(86).setOrigin(0.5)

    this.viewMaskL = mk(c.barW / 2, this.scale.height / 2, c.barW, this.scale.height)
    this.viewMaskR = mk(this.scale.width - c.barW / 2, this.scale.height / 2, c.barW, this.scale.height)
    this.viewMaskT = mk(this.scale.width / 2, c.barH / 2, this.scale.width, c.barH)
    this.viewMaskB = mk(this.scale.width / 2, this.scale.height - c.barH / 2, this.scale.width, c.barH)

    // 软边：黑幕内侧压 4 条递减透明度的窄条，避免硬边看起来像"渲染 bug"。
    // 成本远低于做一张渐变贴图，视觉上够用。
    //
    // ⚠️ 必须是 4侧 × 4条 = **16 条**，不是 8 条。layoutViewMask 里按下标
    // side*4+i 取（下标 0-15），少建就会在下标 8-15 取到 undefined，
    // create() 直接抛 `Cannot read properties of undefined` —— 整个游戏开不起来。
    // 这个坑踩过一次：条目数与访问公式对不上，而 TS 查不出来（数组下标返回 T 不报 strict）。
    this.viewMaskSoft = []
    for (let i = 0; i < 16; i++) {
      const a = 0.28 * (1 - Math.floor(i / 4) / 4)
      this.viewMaskSoft.push(
        this.add.rectangle(0, 0, 0, 0, 0x030509, a)
          .setScrollFactor(0).setDepth(86).setOrigin(0.5),
      )
    }
    this.layoutViewMask()
  }

  /** 窗口尺寸变化时重排视野黑幕 */
  private layoutViewMask() {
    // 尺寸未定/尚未建好时直接返回：resize 事件可能早于 buildViewMask 触发，
    // 那时字段还是 undefined，硬set 会抛异常把整个场景打断。
    if (!this.viewMaskL) return
    // 黑暗遮罩同样要跟着resize 兜底：窗口变了但遮罩尺寸还是旧的，
    // 光圈就会和画面错位。buildViewMask 尚未跑过时它也可能是 undefined。
    if (this.darkMask) {
      const CLEAR_FRAC = 0.14
      const coverR = Math.max(
        this.lightR / CLEAR_FRAC,
        Math.hypot(this.scale.width, this.scale.height) / 2)
      this.darkMask.setDisplaySize(coverR * 2, coverR * 2)
    }
    const c = this.viewClamp()
    const w = this.scale.width
    const h = this.scale.height
    const SOFT = 46 // 渐隐总宽度（px）
    const set = (r: Phaser.GameObjects.Rectangle, x: number, y: number, bw: number, bh: number) => {
      r.setPosition(x, y).setSize(Math.max(0, bw), Math.max(0, bh))
    }
    set(this.viewMaskL, c.barW / 2, h / 2, c.barW, h)
    set(this.viewMaskR, w - c.barW / 2, h / 2, c.barW, h)
    set(this.viewMaskT, w / 2, c.barH / 2, w, c.barH)
    set(this.viewMaskB, w / 2, h - c.barH / 2, w, c.barH)

    // 只有溢出方向才有渐隐；没溢出就全部归零（不渲染，也不出错）。
    const bar = c.barW > 0 ? c.barW : c.barH
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < 4; i++) {
        const r = this.viewMaskSoft[side * 4 + i]
        if (!r) continue
        if (bar <= 0) {
          r.setSize(0, 0)
          continue
        }
        // 越靠画面中心越宽、越透明
        const t = (i + 1) / 4
        const bw = 2 + SOFT * t * 0.5
        const inset = bar + SOFT * t
        // side: 0=左 1=右 2=上 3=下
        if (side === 0) set(r, inset, h / 2, bw, h)
        else if (side === 1) set(r, w - inset, h / 2, bw, h)
        else if (side === 2) set(r, w / 2, inset, w, bw)
        else set(r, w / 2, h - inset, w, bw)
      }
    }
  }

  /** 窗口尺寸变化时重排常驻 UI（RESIZE 模式下画布会变，位置必须跟着走） */
  private layout() {
    const w = this.scale.width
    const h = this.scale.height
    this.bg.setPosition(w / 2, h / 2).setSize(w, h)
    this.vig.setPosition(w / 2, h / 2).setDisplaySize(w, h)
    this.layoutViewMask()
    if (this.chapterTint) {
      this.chapterTint.setPosition(w / 2, h / 2).setSize(w, h)
    }
    if (this.prepBackdrop) this.prepBackdrop.setSize(w + 4, h + 4)
    this.placeTimePanel()
    this.placeObjective()
    this.placeStratSlot()
    if (this.hintText) this.hintText.setPosition(10, h - 22)
  }

  /** 顶部中央的目标条：本关"要干什么"必须常驻可见，否则玩家只是在无目的挨打 */
  private placeObjective() {
    if (!this.objText) return
    const k = this.hudK
    const w = this.scale.width
    const right = w - Math.round(12 * k)
    this.objText.setPosition(right, Math.round(58 * k))
    // 进度条也是右对齐：右端与文字、与上面的时间块对齐成一条线。
    // 注意 bar 是从 **负 x 画到 0**（refreshObjective 里 `fillRect(-W, 0, W, H)`），
    // 所以这里要放"右端"，不是"左端" —— 写成 `right - OBJ_BAR_W * k` 会让它
    // 整体左移一个条宽，右端对不齐。
    this.objBar.setPosition(right, Math.round(96 * k))
  }

  /** 右下角计谋槽：图标 + 环形冷却 + 就绪脉冲，位置随窗口走 */
  private placeStratSlot() {
    if (!this.stratIcon) return
    const k = this.hudK
    const w = this.scale.width
    const h = this.scale.height
    const cx = w - Math.round(58 * k)
    const cy = h - Math.round(58 * k)
    this.stratIcon.setPosition(cx, cy)
    this.stratText.setPosition(cx, cy + Math.round(36 * k))
    this.stratRing.setPosition(cx, cy)
  }

  /** 屏幕右上角的时间块：带底衬，否则会被走到角落的敌人盖住看不清 */
  private placeTimePanel() {
    const k = this.hudK
    const w = this.scale.width
    const pw = Math.round(150 * k)
    const ph = Math.round(40 * k)
    // 面板 origin 是 (0,0)，所以 x 必须是「右边缘 - 面板宽 - 边距」。
    // 旧版写成 w - 边距，整块底衬被推到屏幕外，只剩左边框露出来像半个括号。
    this.timePanel
      .setPosition(w - Math.round(10 * k) - pw, Math.round(10 * k))
      .setSize(pw, ph)
    this.timeText.setPosition(w - Math.round(10 * k) - pw / 2, Math.round(10 * k) + ph / 2)
  }

  private toastLive = 0

  private toast(msg: string) {
    // 走设计系统的墨底 + 鎏金细边，而不是旧版那种一块纯黑贴片。
    // 计谋就绪 / 播报 / 界面档位都会用到它，是出现频率最高的一个 UI 元素。
    const t = this.add.text(0, 0, msg, {
      fontFamily: FONT,
      fontSize: `${Math.max(12, Math.round(15 * this.hudK))}px`,
      color: TXT.main, padding: { x: 14, y: 7 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(420)
    const w = Math.round(t.width * 0.5) + 4
    const h = Math.round(t.height) + 4
    const box = this.add.graphics().setScrollFactor(0).setDepth(419)
    box.fillStyle(UI.ink1, 0.94).fillRoundedRect(-w, -h / 2, w * 2, h, 4)
    box.lineStyle(1, UI.gold, 0.7).strokeRoundedRect(-w, -h / 2, w * 2, h, 4)
    // 多条 toast 必须**往上叠**，不能都钉在同一个 y 上。
    // 「计谋就绪」和「施计」经常前后脚出现（按 Q 的时机正是它就绪的瞬间），
    // 两条叠在同一点会糊成一团谁都不读不清 —— 实测截图里就是这样。
    const idx = this.toastLive++
    const cy = this.scale.height - 48 - idx * 34
    const cx = this.scale.width / 2
    t.setPosition(cx, cy)
    box.setPosition(cx, cy)
    this.tweens.add({
      targets: [t, box], alpha: 0, y: cy - 16, delay: 900, duration: 420,
      onComplete: () => {
        t.destroy(); box.destroy()
        this.toastLive = Math.max(0, this.toastLive - 1)
      }
    })
  }

  private rebuildHud() {
    for (const o of this.hudObjs) o.destroy()
    this.hudObjs = []
    this.buildHud()
  }

  /** 底部操作提示。带上当前界面档位 —— 按 F 的用户需要知道自己在哪一档。 */
  private hintLine(): string {
    return 'WASD 移动　·　攻击自动瞄准最近敌人　·　Q / E 施计谋　·　波间进商店（1~4 购买）'
      + `　·　F 界面大小（当前：${HUD_LABELS[this.hudTier]}）　·　B 辉光`
  }

  private resolvePid(): string {
    const p = new URLSearchParams(location.search).get('pid')
    if (p) return p
    const k = 'sg_pid'
    let v = localStorage.getItem(k)
    if (!v) { v = 'u_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(k, v) }
    return v
  }

  /**
   * 生涯战绩读写。
   *
   * 单独落在 `sg_career` 而不是混进 pid：pid 是身份标识，战绩是会变的数值，
   * 两者生命周期不同（换设备继承 pid 时不该把别人的战绩一起继承过来）。
   * 后端拿不到这两个数（/api/meta 只回进度），所以必须本地存 —— 离线也要能显示。
   */
  private loadCareer() {
    try {
      const raw = localStorage.getItem('sg_career')
      if (!raw) return
      const o = JSON.parse(raw) as { bestWave?: number; totalKills?: number }
      this.bestWave = Math.max(0, Math.floor(Number(o.bestWave) || 0))
      this.totalKills = Math.max(0, Math.floor(Number(o.totalKills) || 0))
    } catch { /* 存档损坏就当新号 */ }
  }

  private saveCareer() {
    try {
      localStorage.setItem('sg_career',
        JSON.stringify({ bestWave: this.bestWave, totalKills: this.totalKills }))
    } catch { /* 隐私模式写不了，忽略 */ }
  }

  // 程序绘制贴图：dot / tracer / glow / ground / flash / ring / vignette / shard / blob
  private makeTextures() {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(8, 8, 8)
    g.generateTexture('dot', 16, 16)
    g.destroy()

    // 曳光弹：外层柔光 + 高亮核心，旋转后沿速度方向像一条弹道
    const t = this.make.graphics({ x: 0, y: 0 }, false)
    t.fillStyle(0xffffff, 0.3)
    t.fillEllipse(14, 4.5, 28, 9)
    t.fillStyle(0xffffff, 0.75)
    t.fillEllipse(14, 4.5, 19, 6)
    t.fillStyle(0xffffff, 1)
    t.fillEllipse(15, 4.5, 11, 3.5)
    t.generateTexture('tracer', 28, 9)
    t.destroy()

    // 径向光晕（叠加混合用）：越靠近中心越亮
    const gl = this.make.graphics({ x: 0, y: 0 }, false)
    for (let r = 24; r > 0; r--) {
      gl.fillStyle(0xffffff, 0.05)
      gl.fillCircle(24, 24, r)
    }
    gl.generateTexture('glow', 48, 48)
    gl.destroy()

    // 地面：深色木地板。
    //
    // 这里踩过一个很典型的坑：原先每块石板四周留了 2px 的深色接缝
    // （0x16162a 压在 0x232340 上），结果整屏看起来像铺了一层电子表格 ——
    // **等距的深色直线比石板本身更抢眼**，格子成了画面的主导图案。
    // 现在只靠「板条亮度差 + 极淡的上沿受光 + 木纹」表达材质，不画通缝。
    //
    // 题材上：换成深海之后，地面必须是**海床**，不是木地板也不是石板。
    //
    // 踩过的坑（同一块地面换了三次题材，每次都栽在这里）：
    // 换题材只换了单位和文案，地面没跟着换 —— 第一次是"第一章叫地毯前哨，
    // 脚下却是紫灰石砖"，第二次是"脚还是木地板、水里却在下雨"。
    // **凡是能一眼认出材质的东西，都必须跟着题材换**，不然画面自己会拆台。
    //
    // 海床的表达方式：**没有任何直线结构**。
    // 木地板靠板条缝、石板靠网格线，两者都会形成主导图案；
    // 海床是沉积沙+碎石，只能靠随机斑点与柔和起伏表达，
    // 所以这里刻意不画任何贯穿整格的线条 —— 那是"这不是地板"的保证。
    //
    // 上一版用 fillRect 画沉积斑块，截图里一眼看出"方格地板"。
    // 原因不是颜色，是**形状**：矩形斑块在大片平铺下会露出自己的直边，
    // 26 个 18~52px 的矩形足以拼出规则的视觉节律，看起来就是砖。
    // 换成 fillCircle：圆斑没有方向性，任意相邻都不会连成线，
    // 这是"看不出平铺"的关键 —— 平铺感来自形状的边，不来自色差。
    const gr = this.make.graphics({ x: 0, }, false)
    const SEABED = 0x0d1a24           // 沙底基色（冷黑青）
    gr.fillStyle(SEABED, 1)
    gr.fillRect(0, 0, 128, 128)
    // 沉积起伏：低频随机**圆斑**，模拟沙面的凹凸。必须低对比——
    // 对比一高就变成"花纹地板"，反而暴露了平铺。
    for (let i = 0; i < 34; i++) {
      const r = Phaser.Math.FloatBetween(7, 20)
      const light = Math.random() < 0.5
      gr.fillStyle(light ? 0x14232f : 0x08131b,
        Phaser.Math.FloatBetween(0.16, 0.4))
      gr.fillCircle(Phaser.Math.FloatBetween(0, 128), Phaser.Math.FloatBetween(0, 128), r)
    }
    // 细砂颗粒：小点，密度不均（成片的粗糙区 + 干净的细沙区）
    for (let i = 0; i < 420; i++) {
      gr.fillStyle(Math.random() < 0.3 ? 0x1c3040 : 0x060e15,
        Phaser.Math.FloatBetween(0.18, 0.5))
      gr.fillRect(Math.floor(Phaser.Math.FloatBetween(0, 128)),
        Math.floor(Phaser.Math.FloatBetween(0, 128)), 1, 1)
    }
    // 碎石与贝壳碎片：少量小点。刻意**不用短斜线**——
    // 斜块在平铺下会连成方向性纹理，正是上一版"方格感"的残留来源。
    for (let i = 0; i < 30; i++) {
      gr.fillStyle(0x223a48, Phaser.Math.FloatBetween(0.3, 0.7))
      gr.fillCircle(Phaser.Math.FloatBetween(0, 128),
        Phaser.Math.FloatBetween(0, 128), Phaser.Math.FloatBetween(0.6, 1.4))
    }
    gr.generateTexture('ground', 128, 128)
    gr.destroy()

    // 枪口火光：小十字星。旧版直接拿 48px 的 radial glow 放大加色，
    // 结果在暗背景上是一坨 40px 的黄色椭圆（像荷包蛋），还一次出现好几个。
    const fl = this.make.graphics({ x: 0, y: 0 }, false)
    fl.fillStyle(0xffffff, 1)
    fl.fillRect(9, 1, 2, 16)
    fl.fillRect(2, 8, 16, 2)
    fl.fillRect(6, 5, 8, 8)
    fl.fillStyle(0xffffff, 0.5)
    fl.fillRect(4, 7, 12, 4)
    fl.fillRect(7, 4, 4, 12)
    fl.generateTexture('flash', 20, 18)
    fl.destroy()

    // 脚下指示环（玩家专用）。
    // 直接画椭圆而不是"画圆然后压扁"：非等比缩放会把环形描边切成一圈虚线，
    // 在画面里看着像渲染故障。
    const rg = this.make.graphics({ x: 0, y: 0 }, false)
    rg.lineStyle(2, 0xffffff, 1)
    rg.strokeEllipse(32, 14, 50, 18)
    rg.lineStyle(2, 0xffffff, 0.4)
    rg.strokeEllipse(32, 14, 58, 24)
    rg.generateTexture('ring', 64, 28)
    rg.destroy()

    // 圆形冲击环（命中/施法扩散用）。和地面指示用的椭圆 ring 区分开：
    // 这里要的是"从一个点炸开的一圈"，必须正圆，tint 后可复用于火/冰/金/盾各色。
    const crTex = this.make.graphics({ x: 0, y: 0 }, false)
    crTex.lineStyle(4, 0xffffff, 1); crTex.strokeCircle(32, 32, 28)
    crTex.lineStyle(2, 0xffffff, 0.55); crTex.strokeCircle(32, 32, 19)
    crTex.generateTexture('cring', 64, 64)
    crTex.destroy()

    // ===================== 技能特效贴图（全部程序化） =====================
    //
    // 「特效是不是美术搞不定」的答案就在这里：**不靠画师，靠形状语言 + 时序**。
    //
    // 统一性来自共用同一套底形（符印 / 火星 / 冰晶 / 斩弧 / 火舌 / 落箭 / 电弧），
    // 差异化来自「谁用哪个底形 + 什么颜色 + 什么时序」。
    // 只要底形本身足够有辨识度，六个计谋就能在一屏之内被区分开 ——
    // 这也是为什么这里每一种底形都刻意做成**轮廓完全不同**的形状，
    // 而不是同一颗圆点换七个颜色（那正是上一版"特效单一"的病根）。
    //
    // 地面符印：外环 + 内环 + 八条辐条。所有计谋施法瞬间都会"踩"在它上面，
    // 它承担的是"这一下是我主动按的"这个身份标识。
    const ru = this.make.graphics({ x: 0, y: 0 }, false)
    ru.lineStyle(3, 0xffffff, 1); ru.strokeCircle(32, 32, 29)
    ru.lineStyle(2, 0xffffff, 0.75); ru.strokeCircle(32, 32, 20)
    ru.lineStyle(1.5, 0xffffff, 0.6); ru.strokeCircle(32, 32, 11)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      ru.lineStyle(2, 0xffffff, 0.85)
      ru.lineBetween(32 + Math.cos(a) * 12, 32 + Math.sin(a) * 12,
        32 + Math.cos(a) * 28, 32 + Math.sin(a) * 28)
    }
    ru.generateTexture('fx_rune', 64, 64)
    ru.destroy()

    // 火星 / 尘土：小菱形（和"经验球是菱形晶体"同一套形状语言）
    const em = this.make.graphics({ x: 0, y: 0 }, false)
    em.fillStyle(0xffffff, 1)
    em.fillTriangle(5, 0, 10, 5, 0, 5)
    em.fillTriangle(5, 10, 10, 5, 0, 5)
    em.generateTexture('fx_ember', 10, 10)
    em.destroy()

    // 冰晶：六角雪花（减速专用）。六角是"结晶"最不容易被误读的形状。
    const ish = this.make.graphics({ x: 0, y: 0 }, false)
    ish.lineStyle(2, 0xffffff, 1)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const tx = 8 + Math.cos(a) * 7, ty = 8 + Math.sin(a) * 7
      ish.lineBetween(8, 8, tx, ty)
      ish.lineBetween(8 + Math.cos(a) * 4, 8 + Math.sin(a) * 4,
        8 + Math.cos(a + 0.75) * 6.2, 8 + Math.sin(a + 0.75) * 6.2)
      ish.lineBetween(8 + Math.cos(a) * 4, 8 + Math.sin(a) * 4,
        8 + Math.cos(a - 0.75) * 6.2, 8 + Math.sin(a - 0.75) * 6.2)
    }
    ish.generateTexture('fx_shard', 16, 16)
    ish.destroy()

    // 斩击弧：月牙。近战命中贴一道，和远程的"点命中"在轮廓上直接分开。
    const sl = this.make.graphics({ x: 0, y: 0 }, false)
    sl.lineStyle(8, 0xffffff, 0.95)
    sl.beginPath(); sl.arc(32, 30, 22, Math.PI * 1.12, Math.PI * 1.88, false); sl.strokePath()
    sl.lineStyle(3, 0xffffff, 0.6)
    sl.beginPath(); sl.arc(32, 34, 13, Math.PI * 1.18, Math.PI * 1.82, false); sl.strokePath()
    sl.generateTexture('fx_slash', 64, 40)
    sl.destroy()

    // 火舌：上尖下圆的"水滴"（和计谋图标里的火同形）。
    const f2 = this.make.graphics({ x: 0, y: 0 }, false)
    f2.fillStyle(0xffffff, 0.4)
    f2.fillCircle(9, 22, 9)
    f2.fillStyle(0xffffff, 1)
    f2.fillTriangle(9, 0, 17, 20, 1, 20)
    f2.fillCircle(9, 22, 8)
    f2.generateTexture('fx_flame', 18, 32)
    f2.destroy()

    // 落箭：箭头朝**下**（下落方向），尾羽在上 —— 落地插着时方向也正确。
    const af = this.make.graphics({ x: 0, y: 0 }, false)
    af.fillStyle(0xffffff, 1)
    af.fillRect(2, 2, 2, 18)
    af.fillTriangle(0, 20, 6, 20, 3, 26)
    af.fillTriangle(0, 1, 6, 1, 3, 8)
    af.generateTexture('fx_arrowfall', 6, 27)
    af.destroy()

    // 电弧：锯齿折线（连环计的铁索放电）
    const boz = this.make.graphics({ x: 0, y: 0 }, false)
    boz.lineStyle(2, 0xffffff, 1)
    boz.beginPath()
    boz.moveTo(4, 0); boz.lineTo(0, 5); boz.lineTo(6, 9); boz.lineTo(1, 14); boz.lineTo(4, 20)
    boz.strokePath()
    boz.generateTexture('fx_bolt', 8, 21)
    boz.destroy()

    // 落地阴影（单位脚下那块暗色椭圆）——用贴图而不是矢量椭圆，
    // 因为矢量图形是按屏幕分辨率抗锯齿的，和像素单位放一起会"脏"
    const bl = this.make.graphics({ x: 0, y: 0 }, false)
    bl.fillStyle(0x000000, 0.36)
    bl.fillEllipse(14, 5, 28, 6)
    bl.fillStyle(0x000000, 0.3)
    bl.fillEllipse(14, 5, 20, 10)
    bl.generateTexture('blob', 28, 11)
    bl.destroy()

    // 死亡碎片
    const sd = this.make.graphics({ x: 0, y: 0 }, false)
    sd.fillStyle(0xffffff, 1)
    sd.fillRect(0, 0, 4, 4)
    sd.generateTexture('shard', 4, 4)
    sd.destroy()

    // 经验球用菱形晶体，不用圆点。
    // 之前经验球和敌方子弹都是 16px 圆贴图、只差一个 tint，满屏小亮点时玩家
    // 根本分不清哪个能捡、哪个会打死自己。**形状区分比颜色区分可靠得多** ——
    // 弹幕里靠轮廓认威胁等级，不靠配色。
    const cr = this.make.graphics({ x: 0, y: 0 }, false)
    cr.fillStyle(0xffffff, 0.3)
    cr.fillTriangle(8, 0, 16, 8, 0, 8)
    cr.fillTriangle(8, 16, 16, 8, 0, 8)
    cr.fillStyle(0xffffff, 1)
    cr.fillTriangle(8, 3, 13, 8, 3, 8)
    cr.fillTriangle(8, 13, 13, 8, 3, 8)
    cr.generateTexture('crystal', 16, 16)
    cr.destroy()

    // 暗角：把注意力收拢到画面中心，同时让屏幕边缘的敌人不至于"贴脸突然出现"。
    // 踩过的两个坑：
    //   1. 用同心圆环 + strokeCircle 画渐变时，**步长必须等于线宽**。步长小于线宽
    //      相邻环会 source-over 累加，实测把屏幕四边压到只剩 20% 亮度，整屏发灰。
    //   2. 圆形暗角贴不住矩形屏幕。按对角线铺满后，屏幕四边中点落在贴图半径
    //      约一半的位置，alpha 只剩 0.12 —— 实测四角 21~31 / 中部 36~40，肉眼
    //      完全看不出暗角，等于白做。
    // 现在改成**矩形暗框**：alpha 由「到最近边的距离」决定，贴图拉伸到屏幕尺寸，
    // 边缘与四角自然一起变暗。直接用 canvas 写像素，一次算完，没有重叠问题。
    const S = 256
    const BAND = Math.round(S * 0.32) // 暗带宽 = 贴图的 32%
    // 最外圈最大不透明度。实测标定：0.42 时边缘/中心亮度比 0.55，暗得有点闷；
    // 0.30 时约 0.70 —— 边缘明确变暗但仍然读得清，是大部分游戏暗角的落点。
    const AMAX = 0.30
    const cv = this.textures.createCanvas('vignette', S, S)
    if (!cv) return
    const ctx = cv.getContext()
    const img = ctx.createImageData(S, S)
    const dat = img.data
    for (let y = 0; y < S; y++) {
      const dy = Math.min(y, S - 1 - y)
      for (let x = 0; x < S; x++) {
        const d = Math.min(x, S - 1 - x, dy)
        const t = d >= BAND ? 0 : 1 - d / BAND
        const p = (y * S + x) * 4
        // 只写 alpha，RGB 恒为 0（纯黑）
        dat[p + 3] = Math.round(AMAX * t * t * 255)
      }
    }
    ctx.putImageData(img, 0, 0)
    cv.refresh()

    // -----------------------------------------------------------------------
    // P2 · 黑暗遮罩贴图（**中心透明、四周压黑**，与 vignette 正好相反）
    //
    // 为什么必须另做一张而不是反色复用 vignette：
    //   vignette 是「边缘轻微变暗」，alpha 最大 0.30 —— 那是氛围。
    //   黑暗遮罩是「光圈之外完全看不见」，alpha 要到 0.94——
    //   玩家必须真的**看不到**远处的怪，这是核心玩法而不是氛围。
    // 反色 vignette 会得到「边缘亮、中心黑」的相反结果。
    //
    // 形状用**径向**而不是矩形框：光源是玩家，头灯是圆锥，
    // 用径向衰减才符合「一束光」。渐变用平方曲线（t²），
    // 与 vignette 的边缘带同一个手感：近处变化缓、远处迅速压黑。
    //
    // CLEAR 必须**很小**（0.14）：贴图里 52% 以内全透明、52%→100% 才渐变到全黑，
    // 而遮罩尺寸按 `光半径 / CLEAR` 换算，CLEAR 越大换算出的遮罩越小 ——
    // 实测 CLEAR=0.52 时战术半径下遮罩只有 840px，**盖不满 960px 的屏**，
    // 屏幕两侧漏出两条亮边，看着像个黑色甜甜圈。
    // 改成 0.14 之后：遮罩直径 = 光半径/0.14×2 ≈ 14 倍，稳盖全屏，
    // 而渐变带（贴图的 14%~100%）覆盖了整个视野跨度，光边依然柔和。
    const DS = 512
    const dc = this.textures.createCanvas('darkmask', DS, DS)
    if (dc) {
      const dctx = dc.getContext()
      const dimg = dctx.createImageData(DS, DS)
      const ddat = dimg.data
      const dcx = DS / 2
      const AMAX2 = 0.94              // 光圈外：几乎全黑，但不是纯黑（留一丝海底轮廓）
      const CLEAR = 0.14              // 半径 14% 以内完全透明（见上方注释）
      for (let y = 0; y < DS; y++) {
        for (let x = 0; x < DS; x++) {
          const d = Math.sqrt((x - dcx) ** 2 + (y - dcx) ** 2) / dcx
          // d< CLEAR 全透明；CLEAR..1 之间按 t^2 渐变到 AMAX2
          //
          // ⚠️ 方向必须对：**t=0（中心）→ alpha=0，t=1（外缘）→ alpha=AMAX**。
          // 写成 (1-t)^2 就是反的：中心全黑、边缘透明 ——
          // 实机截图里表现为「完全看不到效果」，
          // 因为整块遮罩本来就是alpha≈0，等于没盖。
          let t = (d - CLEAR) / (1 - CLEAR)
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const p = (y * DS + x) * 4
          ddat[p] = 2
          ddat[p + 1] = 8
          ddat[p + 2] = 14
          ddat[p + 3] = Math.round(AMAX2 * t * t * 255)
        }
      }
      dctx.putImageData(dimg, 0, 0)
      dc.refresh()
    }

    // -----------------------------------------------------------------------
    // 弹体贴图：每种武器一张，用**形状**而不是颜色区分「这是什么弹」。
    //
    // 旧版所有远程武器共用一张 tracer（一条淡白色椭圆），只靠 setTint 换色 ——
    // 玩家看到的永远是一根白线，分不出短弓的箭、连弩的矢、铁蒺藜的钉。
    // 这里每张图只写**白色明度层次**（1.0 高光 / 0.7 主体 / 0.45 暗部），
    // tint 后自然变成同色系的立体形，形状与颜色互不干扰。
    // 全部朝 +x 绘制（fireWeapon 里 setRotation(角度) 绕中心旋转）。
    // -----------------------------------------------------------------------

    // 箭（短弓）：尾羽 → 箭杆 → 锐利箭头
    const ar = this.make.graphics({ x: 0, y: 0 }, false)
    ar.fillStyle(0xffffff, 0.45); ar.fillTriangle(1, 1, 8, 4, 1, 7)
    ar.fillStyle(0xffffff, 0.72); ar.fillRect(6, 3, 11, 2)
    ar.fillStyle(0xffffff, 1); ar.fillTriangle(14, 0, 25, 4, 14, 8)
    ar.generateTexture('b_arrow', 26, 8)
    ar.destroy()

    // 弩矢（连弩）：短杆 + 方头，读作「小而多的钉子」
    const bo = this.make.graphics({ x: 0, y: 0 }, false)
    bo.fillStyle(0xffffff, 0.62); bo.fillRect(1, 3, 10, 2)
    bo.fillStyle(0xffffff, 1); bo.fillRect(11, 1, 5, 6)
    bo.fillTriangle(16, 1, 19, 4, 16, 7)
    bo.generateTexture('b_bolt', 20, 8)
    bo.destroy()

    // 铁蒺藜：四向尖刺 + 核心，投出去旋转时最有辨识度
    const sp = this.make.graphics({ x: 0, y: 0 }, false)
    sp.fillStyle(0xffffff, 0.8)
    sp.fillTriangle(8, 0, 5, 8, 11, 8)
    sp.fillTriangle(8, 16, 5, 8, 11, 8)
    sp.fillTriangle(0, 8, 8, 5, 8, 11)
    sp.fillTriangle(16, 8, 8, 5, 8, 11)
    sp.fillStyle(0xffffff, 1); sp.fillCircle(8, 8, 4)
    sp.generateTexture('b_spike', 16, 16)
    sp.destroy()

    // 重箭（强弩）：更长更宽，一眼看出「这一发很重」
    const ga = this.make.graphics({ x: 0, y: 0 }, false)
    ga.fillStyle(0xffffff, 0.4); ga.fillTriangle(1, 1, 12, 5, 1, 9)
    ga.fillStyle(0xffffff, 0.66); ga.fillRect(9, 3, 15, 4)
    ga.fillStyle(0xffffff, 1); ga.fillTriangle(22, 0, 36, 5, 22, 10)
    ga.generateTexture('b_greatarrow', 38, 10)
    ga.destroy()

    // 枪影（亮银枪）：长拖尾 + 细长枪尖，飞出去像一道银光
    const sq = this.make.graphics({ x: 0, y: 0 }, false)
    sq.fillStyle(0xffffff, 0.22); sq.fillRect(0, 2, 20, 3)
    sq.fillStyle(0xffffff, 0.6); sq.fillRect(13, 2, 13, 2)
    sq.fillStyle(0xffffff, 1); sq.fillTriangle(24, 0, 37, 3.5, 24, 7)
    sq.generateTexture('b_spear', 38, 7)
    sq.destroy()

    // 飞刀（回旋飞刀）：柳叶刀身 + 短柄，环绕时是「刀刃在转」而不是「光点在转」
    const kf = this.make.graphics({ x: 0, y: 0 }, false)
    kf.fillStyle(0xffffff, 0.5); kf.fillRect(1, 3, 6, 2)
    kf.fillStyle(0xffffff, 0.8)
    kf.fillPoints([{ x: 6, y: 1 }, { x: 20, y: 4 }, { x: 6, y: 7 }], true)
    kf.fillStyle(0xffffff, 1); kf.fillRect(13, 3, 6, 2)
    kf.generateTexture('b_knife', 22, 8)
    kf.destroy()

    // -----------------------------------------------------------------------
    // 战场装饰：让「无限大的地图」不再是一片空海床的唯一手段。
    // 全部画成**低对比**（depth -8），是背景层，绝不和单位抢主体；
    // 只有发光珊瑚是亮的（那点光是黑暗海底唯一的方向感）。
    // 除发光珊瑚/海草外，贴图一律用白色明度层次，摆放时按玩具色池 tint
    // （详见 placeProp）—— 一套贴图出十几种颜色，色调还自动统一。
    // -----------------------------------------------------------------------

    // ---- 装饰贴图：海床上的 6 类地标 ----
    //
    // key 沿用旧名（p_tent/p_cart/...）不改：下游 placeProp 的抽取权重、
    // 存档、以及 _archive/toy_era 的对照图都按 key 引用，
    // 改 key 会让"换壳前后对比"这件事变得需要改一堆代码。名字是历史，形状是现在。
    //
    // 统一约束：**全部画成白色明度层次**，摆放时按 BIOLUM_COLORS tint。
    // 一套贴图出十几种颜色，且色调自动统一。
    // 唯一的例外是发光珊瑚（p_brazier）——它必须自带固定色相，
    // 因为"黑暗里唯一的暖光"是本作的核心视觉，不能被随机成别的颜色。

    // p_tent ← 软珊瑚丛（原来"抱枕"）：海床上最软的一类，靠圆弧堆叠读出软。
    const tn = this.make.graphics({ x: 0, y: 0 }, false)
    tn.fillStyle(0x000000, 0.26)
    tn.fillEllipse(48, 58, 84, 11)                // 落地影
    // 三丛高低不一的圆弧瓣：软珊瑚没有硬边，全是圆弧
    tn.fillStyle(0xffffff, 0.5)
    tn.fillEllipse(26, 44, 34, 30)
    tn.fillEllipse(52, 38, 42, 40)
    tn.fillEllipse(72, 48, 30, 24)
    tn.fillStyle(0xffffff, 0.72)                 // 上部受光
    tn.fillEllipse(52, 28, 34, 24)
    tn.fillEllipse(26, 36, 26, 20)
    tn.fillStyle(0xffffff, 0.3)                  // 瓣间凹陷（压暗分瓣）
    tn.fillEllipse(40, 52, 22, 14)
    tn.fillEllipse(64, 54, 18, 12)
    tn.generateTexture('p_tent', 96, 68)
    tn.destroy()

    // p_cart ← 沉船残骸（原来"玩具小车"）：海底的硬物，带肋骨状船体。
    const ct = this.make.graphics({ x: 0, y: 0 }, false)
    ct.fillStyle(0x000000, 0.3); ct.fillEllipse(40, 46, 66, 10)
    // 船体：倾覆的弧形，不是方的
    ct.fillStyle(0xffffff, 0.5)
    ct.fillPoints([{ x: 4, y: 40 }, { x: 20, y: 16 }, { x: 68, y: 14 },
      { x: 76, y: 38 }, { x: 60, y: 44 }, { x: 20, y: 44 }], true)
    ct.fillStyle(0xffffff, 0.74)                        // 船背上沿受光
    ct.fillPoints([{ x: 20, y: 16 }, { x: 68, y: 14 }, { x: 66, y: 20 },
      { x: 22, y: 22 }], true)
    // 肋骨：竖向暗条，是"这是船"的最强识别件
    ct.fillStyle(0x000000, 0.4)
    for (let i = 0; i < 5; i++) ct.fillRect(26 + i * 9, 22, 3, 20)
    // 断桅：斜插的杆
    ct.fillStyle(0xffffff, 0.44)
    ct.fillPoints([{ x: 46, y: 16 }, { x: 50, y: 16 }, { x: 62, y: 4 },
      { x: 58, y: 2 }], true)
    // 附着藤壶：不规则的深色小点
    ct.fillStyle(0x000000, 0.26)
    for (let i = 0; i < 10; i++) ct.fillCircle(20 + (i * 13) % 54, 26 + (i * 7) % 16, 1.8)
    ct.generateTexture('p_cart', 80, 52)
    ct.destroy()

    // p_brazier ← 发光珊瑚簇（原来"台灯"）：**唯一自带固定色相的装饰**。
    //
    // 它的作用和台灯当年完全一样：一片近乎全黑的画面里，这点光是玩家
    // 唯一的方向参照物。换题材后它从"暖黄台灯"变成"青蓝发光珊瑚"——
    // 但**必须还是暖色系之外的冷色**，理由见 theme.ts：HUD 主色是生物发光青，
    // 装饰若也发青会和 UI 混在一起，装饰若发黄则和 enemy 预警色撞。
    // 这里取品红：既不像 HUD 青，也不像敌人预警的红。
    const bz = this.make.graphics({ x: 0, y: 0 }, false)
    bz.fillStyle(0x000000, 0.32); bz.fillEllipse(24, 60, 38, 9)
    // 珊瑚枝：分叉的细杆，全部向上
    const GLOW_C = 0xff5fd0
    bz.fillStyle(0xffffff, 0.42)
    bz.fillPoints([{ x: 22, y: 56 }, { x: 27, y: 56 }, { x: 26, y: 34 },
      { x: 21, y: 34 }], true)                      // 主干
    bz.fillPoints([{ x: 24, y: 36 }, { x: 28, y: 36 }, { x: 20, y: 20 },
      { x: 17, y: 22 }], true)                      // 左分枝
    bz.fillPoints([{ x: 25, y: 34 }, { x: 29, y: 34 }, { x: 38, y: 18 },
      { x: 34, y: 16 }], true)                      // 右分枝
    // 枝顶发光球：珊瑚的辨识钩子
    bz.fillStyle(GLOW_C, 1)
    bz.fillCircle(18, 17, 3); bz.fillCircle(36, 15, 3.4); bz.fillCircle(24, 32, 2.4)
    bz.fillStyle(GLOW_C, 0.32)                       // 光晕
    bz.fillCircle(18, 17, 8); bz.fillCircle(36, 15, 9); bz.fillCircle(24, 32, 6)
    bz.fillStyle(GLOW_C, 0.16)                       // 更大范围的环境辉光
    bz.fillCircle(26, 22, 17)
    // 底盘：珊瑚附着在石上
    bz.fillStyle(0x243842, 1); bz.fillEllipse(24, 57, 26, 8)
    bz.fillStyle(0x2f4a56, 1); bz.fillEllipse(24, 55, 18, 5)
    bz.generateTexture('p_brazier', 48, 64)
    bz.destroy()

    // p_rock ← 礁石（原来"积木块"）：海底的硬地貌，带贝壳附着与凿痕。
    const rk = this.make.graphics({ x: 0, y: 0 }, false)
    rk.fillStyle(0x000000, 0.3); rk.fillEllipse(18, 23, 34, 7)
    // 不规则多边形礁体：绝不能画成方的/圆的（那就还是积木）
    rk.fillStyle(0xffffff, 0.5)
    rk.fillPoints([{ x: 4, y: 21 }, { x: 7, y: 10 }, { x: 15, y: 5 },
      { x: 27, y: 7 }, { x: 32, y: 16 }, { x: 30, y: 22 }], true)
    rk.fillStyle(0xffffff, 0.74)                      // 顶面受光
    rk.fillPoints([{ x: 7, y: 10 }, { x: 15, y: 5 }, { x: 27, y: 7 },
      { x: 22, y: 12 }, { x: 11, y: 13 }], true)
    rk.fillStyle(0x000000, 0.26)                      // 凿痕/裂缝
    rk.fillPoints([{ x: 17, y: 8 }, { x: 19, y: 8 }, { x: 22, y: 21 },
      { x: 20, y: 21 }], true)
    rk.fillStyle(0xffffff, 0.66)                      // 附着贝壳
    rk.fillCircle(9, 18, 2.4); rk.fillCircle(28, 19, 2)
    rk.generateTexture('p_rock', 36, 26)
    rk.destroy()

    // p_grass ← 海草/浮游微粒（原来"草簇"）：**自带颜色**不上 tint。
    // 海草必须是绿的——它不发光，颜色是玩家判断"这里能藏东西"的依据。
    const gs = this.make.graphics({ x: 0, y: 0 }, false)
    // 三丛摇摆的海草叶片（用细长圆弧代替折线，弯弧才像在水里）
    const blades: [number, number, number, number][] = [
      // 起点x, 起点y, 弯曲方向, 颜色
      [8, 19, 1, 0x2f7a5a], [14, 19, -1, 0x3f9a6a], [20, 19, 1, 0x2a6e52]
    ]
    for (const [bx, by, bend, bc] of blades) {
      gs.fillStyle(bc, 1)
      let cxp = bx, cyp = by
      for (let k = 0; k < 7; k++) {
        gs.fillRect(Math.round(cxp), Math.round(cyp), 2, 3)
        // 越往上弯得越明显：水流在上层更强
        cxp += bend * (0.2 + k * 0.22)
        cyp -= 2.2
      }
    }
    // 漂浮的微粒：几颗半透明亮点，强化"水里"的感觉
    gs.fillStyle(0x9fe8d8, 0.5)
    gs.fillCircle(25, 8, 1.1); gs.fillCircle(4, 10, 0.9); gs.fillCircle(21, 5, 0.8)
    gs.generateTexture('p_grass', 28, 20)
    gs.destroy()

    // p_banner ← 海葵丛（原来"玩具兵小旗"）：白色明度层次，按势力色 tint。
    // 保留"旗"这个 key 是因为它承担的是**领地标识**的语义：
    // 玩家看到成片同色的海葵就知道这一带是谁的地盘。
    const bn = this.make.graphics({ x: 0, y: 0 }, false)
    bn.fillStyle(0xffffff, 0.34); bn.fillEllipse(21, 84, 22, 7)      // 附着基盘
    // 触手：上粗下细、顶端张开，一丛人高
    const ten: [number, number, number][] = [
      [8, 78, 10], [14, 78, 3], [20, 78, -4], [26, 78, -10], [33, 78, -14]
    ]
    for (const [bx, by, tx] of ten) {
      bn.fillStyle(0xffffff, 0.55)
      // 触手画成**两段折线**：根部竖直、顶端甩开 —— 这才有触手感
      bn.fillPoints([
        { x: bx, y: by }, { x: bx + 3, y: by }, { x: bx + 3 + (tx - bx) * 0.4, y: by - 30 },
        { x: bx + (tx - bx) * 0.4, y: by - 30 }
      ], true)
      bn.fillStyle(0xffffff, 0.8)
      bn.fillPoints([
        { x: bx + (tx - bx) * 0.4, y: by - 30 }, { x: bx + 3 + (tx - bx) * 0.4, y: by - 30 },
        { x: tx, y: by - 52 }, { x: tx + 2.5, y: by - 52 }
      ], true)
      // 触手顶端的小球：海葵的辨识点
      bn.fillStyle(0xffffff, 1)
      bn.fillCircle(tx + 1.5, by - 54, 3)
      bn.fillStyle(0xffffff, 0.62)
      bn.fillCircle(tx + 1.5, by - 54, 1.6)
    }
    bn.generateTexture('p_banner', 42, 90)
    bn.destroy()

    // 兜底断言：装饰贴图的 key 一旦拼错或漏生成，Phaser 会**静默**渲染成
    // 绿色带斜线的"缺失纹理"方块 —— 在暗色木地板上还挺显眼，但极容易被当成
    // "某个新加的地砖"而放过去（实测就漏过一次 p_banner，八个绿框飘在场上）。
    for (const k of ['p_grass', 'p_rock', 'p_banner', 'p_brazier', 'p_tent', 'p_cart']) {
      if (!this.textures.exists(k)) console.warn('[assets] 缺失装饰贴图：', k)
    }
  }

  // ==========================================================================
  // 战场装饰
  // ==========================================================================
  /**
   * 装饰类型抽取。权重刻意让**海草/礁石**占多数：珊瑚、沉船、发光珊瑚是"地标"，
   * 满地都是就不再是地标了 —— 稀疏才显得出"这一带有什么"。
   */
  private pickPropKind(): string {
    const r = Math.random()
    if (r < 0.34) return 'p_grass'      // 散落小零件
    if (r < 0.62) return 'p_rock'       // 积木块
    if (r < 0.76) return 'p_banner'     // 玩具小旗
    // 台灯只占 3%：它是**地标**，46 个装饰里出 1~2 个才有"房间里有一盏灯"的分量。
    // 10% 的话一屏能看到六七个台灯，暖光反而成了最廉价的元素。
    if (r < 0.79) return 'p_brazier'    // 台灯
    if (r < 0.89) return 'p_tent'       // 抱枕
    return 'p_cart'                     // 玩具小车
  }

  /** 摆一个装饰：随机大小 + 底边对齐地面（origin 下移，看起来立在木地板上） */
  private placeProp(p: Phaser.GameObjects.Image, x: number, y: number) {
    const kind = p.getData('kind') as string
    p.setPosition(x, y)
      .setScale(Phaser.Math.FloatBetween(0.78, 1.24) * FX_SCALE)
      .setAlpha(kind === 'p_grass' ? 0.8 : 0.95)
      .setOrigin(0.5, 0.86)
      .setDepth(-8)
    // tint 规则分三类：
    //   台灯/小零件 —— 自带色相，不动（台灯的暖光是场景里唯一的方向感；小零件本来就是彩色的）
    //   小旗       —— 用**当前势力色**，「这一带是谁的地盘」不靠文字，靠旗色
    //   其余       —— 从生物发光色池随机取，一套贴图出十几种颜色
    if (kind === 'p_brazier' || kind === 'p_grass') p.clearTint()
    else if (kind === 'p_banner') p.setTint(this.faction.color)
    else p.setTint(Phaser.Utils.Array.GetRandom(BIOLUM_COLORS))
  }

  private initProps() {
    for (const p of this.props) p.destroy()
    this.props = []
    const vh = this.viewHalf()
    const R = Math.hypot(vh.hw, vh.hh)
    // 58 个：从 46 提到 58 是为了让一屏稳定出现十来个装饰。
    // 少于此数时，玩家跑动中会出现"跑着跑着前面空了"的断档感。
    const N = 58
    for (let i = 0; i < N; i++) {
      const k = this.pickPropKind()
      const p = this.add.image(0, 0, k)
      p.setData('kind', k)
      // 开局就要铺满**整个可见范围**（而不只是外圈），否则一进场四下空荡
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * R * 1.35
      this.placeProp(p, this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r)
      this.props.push(p)
    }
  }

  /**
   * 装饰随玩家移动"生长"。
   *
   * 超过回收半径的装饰会被搬到**刚出视野**的环带上 ——
   * 玩家往哪走，前面就长出新的营帐与旗子，身后的一点点退场。
   * 于是"地图很大"不再等于"地图很空"。
   */
  private scatterProps() {
    const vh = this.viewHalf()
    const R = Math.hypot(vh.hw, vh.hh)
    const keep = R * 1.4
    for (const p of this.props) {
      const d = Phaser.Math.Distance.Between(p.x, p.y, this.player.x, this.player.y)
      if (d <= keep) continue
      // 三成概率换一种装饰，避免固定的这几十个类型反复出现被看穿
      if (Math.random() < 0.32) {
        const k = this.pickPropKind()
        p.setTexture(k)
        p.setData('kind', k)
      }
      const a = Math.random() * Math.PI * 2
      const r = R * Phaser.Math.FloatBetween(1.02, 1.55)
      this.placeProp(p, this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r)
    }
  }

  // HUD 重排。旧版的三个问题：血条盖着数字、经验条挤在嘴角、时间悬在屏幕最右上
  // 会被走到角落的敌人遮住。现在按「一栏一条」排，并把时间加独立底衬。
  private buildHud() {
    const k = HUD_SCALES[this.hudTier]
    this.hudK = k
    const px = (v: number) => Math.round(v * k)
    const D = 99
    const fs = (v: number) => `${Math.max(12, Math.round(v * k))}px`

    this.hudObjs = []
    const reg = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.hudObjs.push(o)
      return o
    }

    const W = px(384)
    const H = px(112)
    this.hudBarX = 98
    this.hudBarW = 190
    this.hudHpY = 58
    this.hudExpY = 80

    // ---- 左上主面板 ----
    // 不透明度刻意给到 0.9：0.74 时**底下走过的东西会透上来**
    // （加了战场装饰之后尤其明显 —— 营帐、旗子从面板里"穿"出来，
    // 读血条时视线一直被抢）。半透明是为了看到战场，不是为了看见噪点。
    //
    // 配色走 theme 的「墨底 + 鎏金」：底是墨(ink1)，外描边用金暗色收边，
    // 顶部一条鎏金高光带作为"这是潜行者牌"的身份线。
    // 旧版这里是科技青 0x4ecdc4，和描边、进度条、计谋框全都同一个颜色 ——
    // 什么都在强调 = 什么都不强调。
    reg(this.add.rectangle(px(8), px(8), W, H, UI.ink1, 0.92)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D)
      .setStrokeStyle(1, UI.goldDim, 0.9))
    reg(this.add.rectangle(px(8), px(8), W, px(3), UI.gold, 0.9)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D + 1))

    reg(this.add.rectangle(px(20), px(28), px(64), px(72), UI.ink2, 1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D + 1)
      .setStrokeStyle(1, UI.goldDim, 0.8))
    // 头像 = 游戏内像素单位的放大「朝下·待机」帧（2 倍整数放大才锐利）。
    // 用像素单位而不是 AI 立绘：卡片上看到的和场上跑的永远是同一个形象。
    const hudPortraitUnit = 'hero_' + this.activeChar.id
    this.portrait = reg(this.add.sprite(px(52), px(64), pxKey(hudPortraitUnit),
      pxFrame('down', 'idle', 0))
      .setScale(2 * k).setScrollFactor(0).setDepth(D + 2))

    this.nameText = reg(this.add.text(px(98), px(16), '', {
      fontSize: fs(16), color: TXT.main, stroke: '#000000', strokeThickness: 3
    }).setScrollFactor(0).setDepth(D + 2))
    this.lvText = reg(this.add.text(px(98), px(38), '', {
      fontSize: fs(13), color: TXT.gold, stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(D + 2))
    this.statText = reg(this.add.text(px(98), px(88), '', {
      fontSize: fs(13), color: TXT.dim, stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(D + 2))
    // 当前握持的冷兵器。相克系统的回报必须**常驻可见**，
    // 否则玩家永远不知道自己手上这把是克什么的。
    this.weaponText = reg(this.add.text(px(98), px(104), '', {
      fontSize: fs(12), color: TXT.gold, stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(D + 2))
    // 血量数字直接压在血条上：旧版把数字放在条上方，读血要来回找
    this.hpText = reg(this.add.text(px(98 + 95), px(58 + 7), '', {
      fontSize: fs(12), color: TXT.main, stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 3))

    this.hpBar = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 2))
    this.expBar = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 2))
    // 光量条：本作最重要的一条 HUD，必须和血量条**同样强调**。
    //
    // 放在血条正下方而不是经验条旁边 —— 因为它不是"进度"，
    // 是**当前处境**：血量告诉我还能挨几下，光量告诉我还能看清几下。
    // 位置紧贴血条，读的时候视线不用跳。
    this.lightBar = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 2))
    this.lightText = reg(this.add.text(px(98 + 95), px(62 + 5), '', {
      fontSize: fs(11), color: TXT.main, stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 3))

    // ---- 左上（主面板正下方）：当前势力档案 ----
    // 「谁在打我」必须常驻可见。色块用的就是**势力色** ——
    // 和敌人脚下标识环、战场战旗、阵型横幅同一个颜色，
    // 玩家不用读字也能把"这片蓝色 = 魏"连起来。
    reg(this.add.rectangle(px(8), px(128), W, px(32), UI.ink1, 0.9)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D)
      .setStrokeStyle(1, UI.goldDim, 0.55))
    this.factionChip = reg(this.add.rectangle(px(8), px(128), px(5), px(32), this.faction.color, 1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D + 1))
    this.factionText = reg(this.add.text(px(22), px(136), '', {
      fontSize: fs(14), color: TXT.main, stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(D + 2))
    this.factionText.setText(`${this.faction.name}军　${this.faction.trait}`)

    // ---- 右上时间块（带底衬，避免被敌人盖住）----
    this.timePanel = reg(this.add.rectangle(0, 0, px(116), px(40), UI.ink1, 0.92)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D)
      .setStrokeStyle(1, UI.goldDim, 0.8))
    // 时间块改显示「第 N/M 波」——Brotato 化后，玩家最关心的节拍是波次而不是总时长
    this.timeText = reg(this.add.text(0, 0, '', {
      fontSize: fs(15), color: TXT.goldHi, stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2))

    // ---- 右上角（时间块下方）：本关目标 ----
    // 幸存者类的默认体验是"无目的地挨打"，主线必须把"这一关要干什么"钉在屏幕上。
    //
    // **为什么放右上而不是顶部居中**：左上角是潜行者面板（宽约 380px），
    // 顶部居中的目标条实测会**压在面板上**（目标文字左端 297px < 面板右边界 390px），
    // 两段文字叠在一起谁都看不清。右上角时间块正下方是唯一一块常年空着的区域，
    // 而且"关卡目标"和"本局计时"本来就该挨着读。
    this.objText = reg(this.add.text(0, 0, '', {
      fontSize: fs(15), color: TXT.gold, stroke: '#000000', strokeThickness: 3,
      align: 'right', lineSpacing: 4
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2))
    this.objBar = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 2))

    // ---- 右下角：计谋槽 ----
    // 玩家唯一的主动操作，必须常驻且冷却状态一眼可读（环形指示比数字快）。
    this.stratIcon = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 2))
    this.stratRing = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 3))
    this.stratText = reg(this.add.text(0, 0, '', {
      fontSize: fs(12), color: TXT.main, stroke: '#000000', strokeThickness: 2
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 3))

    // ---- 底部操作提示 ----
    this.hintText = reg(this.add.text(10, this.scale.height - 22, this.hintLine(), {
      fontSize: fs(12), color: TXT.dim
    }).setScrollFactor(0).setDepth(D))

    this.placeTimePanel()
    this.placeObjective()
    this.placeStratSlot()
    this.refreshHud()
  }

  private refreshHud() {
    const k = this.hudK
    const px = (v: number) => Math.round(v * k)
    this.hpText.setText(`${Math.max(0, Math.ceil(this.hp))} / ${this.maxHp}`)
    this.nameText.setText(`${this.activeChar.name}　${this.activeChar.passiveName}`)
    this.lvText.setText(`Lv.${this.level}`)
    // 材料是波间商店的货币，必须常驻可见 —— 否则玩家在局内根本不知道自己攒了多少
    this.statText.setText(`击杀 ${this.kills}　　材料 ${this.materials}`)
    // 武器栏只显示名字：克制关系由敌潮播报 + 伤害飘字（"克38"）承担教学，
    // 常驻栏位放不下「声呐枪(克胶质)·探照灯束(克钙壳)…」这种长串。
    const wnames = this.weapons.map((o) => o.def.name)
    this.weaponText.setText(wnames.length > 3
      ? `${wnames.slice(0, 3).join('·')} +${wnames.length - 3}`
      : wnames.join('·'))
    // 时间块 = 波次进度（Brotato 化后的节拍器）
    this.timeText.setText(`第 ${Math.min(this.wave, this.stage.waves)}/${this.stage.waves} 波`)

    const bx = px(this.hudBarX)
    const bw = px(this.hudBarW)

    const hpY = px(this.hudHpY)
    const hpH = px(15)
    const hpPct = Math.max(0, Math.min(1, this.hp / this.maxHp))
    const hpColor = hpPct > 0.5 ? 0x6bcb77 : hpPct > 0.25 ? 0xffd93d : 0xff6b6b
    this.hpBar.clear()
    this.hpBar.fillStyle(0x000000, 0.6).fillRect(bx, hpY, bw, hpH)
    this.hpBar.fillStyle(hpColor, 1).fillRect(bx + 1, hpY + 1, Math.max(0, (bw - 2) * hpPct), hpH - 2)
    this.hpBar.fillStyle(0xffffff, 0.16).fillRect(bx + 1, hpY + 1, Math.max(0, (bw - 2) * hpPct), px(3))

    const exY = px(this.hudExpY)
    const exH = px(6)
    const exPct = Math.min(1, this.exp / this.expNeed)
    this.expBar.clear()
    this.expBar.fillStyle(0x000000, 0.5).fillRect(bx, exY, bw, exH)
    this.expBar.fillStyle(UI.jade, 1).fillRect(bx + 1, exY + 1, Math.max(0, (bw - 2) * exPct), exH - 2)

    this.refreshObjective()
    this.refreshStratSlot()
  }

  /** 顶部目标条：文字 + 进度 + 剩余时间，三者缺一玩家就不知道"还有多久" */
  private refreshObjective() {
    const k = this.hudK
    if (!this.objText) return
    // Brotato 化后，"还有多久"的单位从"整关剩余"变成"本波剩余" —— 后者是玩家真正在盯的
    const leftWave = Math.max(0, BALANCE.waveSec - this.waveT)
    const ls = String(Math.ceil(leftWave)).padStart(2, '0')
    const tag = this.objDone ? '　✓ 已达成' : this.objFailed ? '　✗ 未达成' : ''
    // 上一版写的是 `0:24 / 3:35`，两个数字一个是"已过"一个是"剩余"却用了同一个
    // 斜杠分隔 —— 玩家会读成"0:24 除以 3:35"，完全不知道 3:35 是什么。
    // 改成明确标注「已 / 余」，剩多少一眼可读。
    this.objText.setText(
      `第${this.chapter.index}章 ${this.chapter.name} · ${this.stage.name}${tag}\n`
      + `${this.objLabel}　本波余 ${ls}s`)
    this.objText.setColor(this.objDone ? '#9fe6a0' : this.objFailed ? TXT.red : TXT.gold)

    const W = Math.round(OBJ_BAR_W * k)
    const H = Math.round(8 * k)
    const x = -W
    this.objBar.clear()
    this.objBar.fillStyle(0x000000, 0.55).fillRect(x, 0, W, H)
    this.objBar.fillStyle(this.objDone ? 0x6bcb77 : UI.gold, 1)
      .fillRect(x + 1, 1, Math.max(0, (W - 2) * this.objProgress), H - 2)
    this.objBar.lineStyle(1, 0xffffff, 0.22).strokeRect(x, 0, W, H)

    // 把实际绘制的矩形记下来，供自动化布局自检读取。
    // Graphics 没有 getBounds()（实测 TypeError），而"目标条有没有压在潜行者面板上"
    // 这个断言必须能量到真实像素，否则只能靠人眼在截图里找 —— 那就等于没验。
    this.objBar.setData('rect', {
      l: this.objBar.x - W, t: this.objBar.y, w: W, h: H
    })
  }

  /**
   * 计谋槽：图标 + 环形冷却。
   *
   * 用**环形**而不是数字倒计时：环形是"还剩多少"的空间直觉，一眼可读；
   * 数字要停下来看。就绪时方框整体脉冲一次，提醒"你现在有一个按钮可按"。
   */
  private refreshStratSlot() {
    const k = this.hudK
    if (!this.stratIcon || !this.stratText) return
    const r = Math.round(30 * k)
    const g = this.stratIcon
    g.clear()
    const ready = this.stratCd <= 0
    // 就绪脉冲：0~1 的呼吸，配合下方的 ready 窗口
    const pulse = this.stratReady > 0 ? 0.5 + 0.5 * Math.sin(this.time.now / 90) : 0
    g.fillStyle(UI.ink0, 0.85).fillRect(-r, -r, r * 2, r * 2)
    g.lineStyle(2, ready ? UI.gold : UI.line, 1).strokeRect(-r, -r, r * 2, r * 2)
    if (pulse > 0) {
      g.lineStyle(3, UI.goldHi, pulse * 0.8).strokeRect(-r - 4, -r - 4, (r + 4) * 2, (r + 4) * 2)
    }
    this.drawStratGlyph(g, this.stratagem ? this.stratagem.kind : '', ready ? UI.goldHi : 0x4a4436, k)

    this.stratText.setText(this.stratagem
      ? `${this.stratagem.name} ${ready ? '[Q]' : Math.ceil(this.stratCd / 1000) + 's'}`
      : '无计谋')

    const ring = this.stratRing
    ring.clear()
    if (!ready && this.stratagem) {
      const pct = 1 - this.stratCd / (this.stratagem.cdSec * 1000)
      // 顺时针扫过的弧 = 已恢复的进度
      ring.lineStyle(Math.round(4 * k), UI.jade, 0.9)
      ring.beginPath()
      ring.arc(0, 0, Math.round(36 * k), -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2, false)
      ring.strokePath()
    }
  }

  /**
   * 计谋图标：按**类别**画不同形状，零贴图成本。
   *
   * 设计约束：六个图标必须在 16px 下**互相分得开**，且形状要能直译成玩具物件。
   * 上一版（火苗/雪花/上箭/盾形）的问题是形状与机制无关，玩家只能去读下面那行小字。
   * 这一版每个图标 = 它的玩具本体：
   *   chain   多米诺  —— 两块斜靠的骨牌
   *   pull    磁铁球  —— U 形磁铁
   *   rebound 声呐冲击  —— 一圈扩散的声波（折线）
   *   spin    陀螺    —— 上尖下宽的陀螺 + 一圈旋转箭头
   *   stun    拼图盒  —— 一个盒子 + 顶部拼图凸起
   *   buff    电池    —— 电池外壳 + 中间的闪电
   */
  private drawStratGlyph(g: Phaser.GameObjects.Graphics, kind: string, color: number, k: number) {
    const s = (v: number) => Math.round(v * k)
    g.fillStyle(color, 1)
    g.lineStyle(Math.max(2, s(2)), color, 1)
    switch (kind) {
      case 'chain':
        // 多米诺：两块斜靠的骨牌（右块压向左块）
        g.fillRoundedRect(s(-11), s(-8), s(9), s(16), s(2))
        g.fillRoundedRect(s(1), s(-6), s(9), s(16), s(2))
        g.lineStyle(Math.max(1, s(1)), 0x1a1208, 0.9)
        g.lineBetween(s(-11), s(0), s(-2), s(0))
        g.lineBetween(s(1), s(2), s(10), s(2))
        break
      case 'pull':
        // U 形磁铁：两道竖臂 + 底部横梁，两臂顶端各一极
        g.fillRect(s(-11), s(-11), s(7), s(16))
        g.fillRect(s(4), s(-11), s(7), s(16))
        g.fillRect(s(-11), s(3), s(22), s(7))
        g.fillStyle(0xffffff, 1)
        g.fillRect(s(-11), s(-11), s(7), s(4))
        g.fillRect(s(4), s(-11), s(7), s(4))
        break
      case 'rebound':
        // 声呐冲击：一圈扩散出去又回卷的声波（"被推出去又弹回来"）
        g.lineStyle(Math.max(3, s(3)), color, 1)
        g.beginPath()
        g.moveTo(s(-12), s(4))
        g.lineTo(s(-5), s(-8)); g.lineTo(s(2), s(3)); g.lineTo(s(9), s(-8))
        g.lineTo(s(13), s(2))
        g.strokePath()
        break
      case 'spin':
        // 陀螺：倒三角 + 顶钮 + 两侧旋转弧
        g.fillTriangle(s(0), s(-9), s(9), s(6), s(-9), s(6))
        g.fillRect(s(-2), s(-13), s(4), s(4))
        g.fillRect(s(-1), s(6), s(2), s(6))
        g.lineStyle(Math.max(2, s(2)), color, 0.85)
        g.beginPath(); g.arc(0, 0, s(13), -Math.PI * 0.75, -Math.PI * 0.2, false); g.strokePath()
        g.beginPath(); g.arc(0, 0, s(13), Math.PI * 0.25, Math.PI * 0.8, false); g.strokePath()
        break
      case 'stun':
        // 拼图盒：方盒 + 顶部一个拼图凸起
        g.fillRoundedRect(s(-11), s(-6), s(22), s(17), s(3))
        g.fillCircle(s(0), s(-8), s(5))
        g.lineStyle(Math.max(1, s(1)), 0x1a1208, 0.9)
        g.strokeRoundedRect(s(-11), s(-6), s(22), s(17), s(3))
        break
      case 'buff':
        // 电池：外壳 + 顶钮 + 中央闪电
        g.fillRoundedRect(s(-7), s(-11), s(14), s(23), s(3))
        g.fillRect(s(-3), s(-15), s(6), s(4))
        g.fillStyle(0x1a1208, 1)
        g.fillTriangle(s(1), s(-6), s(-4), s(3), s(-1), s(3))
        g.fillTriangle(s(-1), s(10), s(4), s(1), s(1), s(1))
        break
      default:
        // 无计谋：留一个斜杠，表示"这里本该有东西"
        g.lineBetween(s(-8), s(8), s(8), s(-8))
    }
  }

  update(_t: number, delta: number) {
    if (!this.started || this.over || this.paused) return
    this.elapsed += delta / 1000
    this.tickInvuln(delta)
    this.tickStratagem(delta)
    this.tickLight(delta)
    this.handleMove()
    this.animatePlayer(delta)
    this.tickWeapons(delta)
    this.driveBullets()
    this.driveOrbits(delta)
    this.spawnDirector(delta)
    this.driveEnemies(delta)
    this.driveEnemyBullets()
    this.drivePickups()
    this.refreshHud()
    this.tickWave()
    // 护罩要跟着玩家走（它是"我身上有一层罩子"，不是"地上有个圈"）
    if (this.guardAura) this.guardAura.setPosition(this.player.x, this.player.y)

    this.bg.tilePositionX = this.cameras.main.scrollX
    this.bg.tilePositionY = this.cameras.main.scrollY
    // 装饰重投不必每帧做：150ms 一次肉眼完全看不出"新长出"的接缝，
    // 却省下每帧 46 次距离计算的浪费。
    this.propAccum += delta
    if (this.propAccum > 150) {
      this.propAccum = 0
      this.scatterProps()
    }
  }

  // ==========================================================================
  // 计谋：玩家唯一的主动操作
  // ==========================================================================
  /**
   * 计谋冷却与增益计时。
   *
   * 三个计时器合在一处：
   *  - stratCd：技能冷却（HUD 的环形指示靠它）
   *  - buffT：背水一战的持续时间（到点要把攻击/受伤倍率还原，否则会永久生效）
   *  - slowUntil：全场减速的减速窗口（用绝对时间戳而不是倒计时，
   *    这样每次敌人被驱动时只需比较一次，不必逐只维护计时器）
   */
  private tickStratagem(delta: number) {
    if (this.stratCd > 0) {
      this.stratCd = Math.max(0, this.stratCd - delta)
      if (this.stratCd === 0) {
        this.stratReady = 600
        this.toast(`计谋就绪：${this.stratagem?.name ?? ''}`)
      }
    }
    if (this.stratReady > 0) this.stratReady = Math.max(0, this.stratReady - delta)
    if (this.buffT > 0) {
      this.buffT -= delta
      if (this.buffT <= 0) {
        this.buffT = 0
        this.buffDmg = 1
        this.buffAtk = 1
        this.buffVuln = 1
      }
    }
  }

  /**
   * 释放计谋。
   *
   * 设计约束（见 docs/核心玩法与主线规划.md §1.4）：
   *   1. **不打断自动攻击** —— 它只是"再按一个键"，不是重构操作；
   *   2. **必须改变战局**，所以每个计谋都要创造一个可感知的场面变化；
   *   3. 冷却 20~30 秒 —— 一局能用十几次，够用但每次都要想。
   */
  private castStratagem() {
    if (!this.started || this.over || this.paused) return
    if (!this.stratagem || this.stratCd > 0) return
    const s = this.stratagem
    this.stratCd = s.cdSec * 1000
    this.stratReady = 0
    // 释放的视觉：一次不震屏的白色脉冲 + 一圈扩散环，强调"这是你按的"
    this.stratBurst()
    switch (s.id) {
      case 'domino': this.stratDomino(); break
      case 'magnetball': this.stratMagnetBall(); break
      case 'rubber': this.stratRubber(); break
      case 'spinner': this.stratSpinner(); break
      case 'puzzlebox': this.stratPuzzleBox(); break
      case 'overclock': this.stratOverclock(); break
    }
    this.toast(`${s.name} · ${s.quote}`)
  }

  /** 当前朝向的单位向量（计谋需要知道"我面朝哪边"）。 */
  private facingAngle(): number {
    return Math.atan2(
      this.moveVy || (this.facing === 'up' ? -1 : 1),
      this.moveVx || (this.facing === 'side' ? (this.faceRight ? 1 : -1) : 0)
    )
  }

  /** 场内活着的敌人。六个计谋共用，省得每处都写一遍 filter。 */
  private activeEnemies(): Phaser.Physics.Arcade.Image[] {
    return (this.enemies.getChildren() as Phaser.Physics.Arcade.Image[])
      .filter((e) => e.active)
  }

  /**
   * 多米诺：击中一个敌人后，伤害沿**最近邻**逐级传导 3 级（每级 80%）。
   * 专破「叠砖」—— 成排推进的敌人被一次连锁打穿。
   *
   * 特效（形态 = **倒下的积木方阵**）：每级在被打中的敌人身上砸下一块旋转下落的
   * 纸箱方块，方块之间拉一条"倒下轨迹"的折线。方块必须**旋转 90° 后躺平**，
   * 这是"多米诺骨牌倒了"唯一的视觉证据 —— 只闪一下光读不出"连锁"。
   */
  private stratDomino() {
    const kids = this.activeEnemies()
    if (kids.length === 0) return
    // 起点 = 离玩家最近的敌人（玩家按下去，最先倒的就是眼前那块）
    kids.sort((a, b) =>
      Phaser.Math.Distance.Between(a.x, a.y, this.player.x, this.player.y)
      - Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y))
    const chain: Phaser.Physics.Arcade.Image[] = [kids[0]]
    // 逐级找"离当前这块最近的、还没倒的"—— 连续三跳
    for (let i = 0; i < 3; i++) {
      const cur = chain[chain.length - 1]
      let best: Phaser.Physics.Arcade.Image | null = null
      let bd = 240
      for (const e of kids) {
        if (chain.indexOf(e) >= 0) continue
        const d = Phaser.Math.Distance.Between(cur.x, cur.y, e.x, e.y)
        if (d < bd) { bd = d; best = e }
      }
      if (!best) break
      chain.push(best)
    }
    const path = this.add.graphics().setDepth(7)
    chain.forEach((e, i) => {
      // 每级 80%：第 0 块满伤，之后每一块都因为"前面倒了"而衰减
      const dmg = 30 * Math.pow(0.8, i) * this.dmgScale * this.buffDmg
      this.hurtEnemy(e, dmg, 0xf0a03d, '#f0a03d')
      this.impactRing(e.x, e.y, 0xf0a03d, 40 + i * 4, 200)
      // 倒下的方块：从敌人头顶落下并旋转 90°
      const blk = this.add.graphics().setDepth(58)
      blk.fillStyle(0xf0a03d, 0.95)
      blk.fillRoundedRect(-9, -12, 18, 24, 3)
      blk.lineStyle(2, 0x8a5a1e, 0.9).strokeRoundedRect(-9, -12, 18, 24, 3)
      blk.setPosition(e.x, e.y - 46).setRotation(0).setAlpha(0)
      this.tweens.add({
        targets: blk, y: e.y - 4, rotation: Math.PI / 2, alpha: { from: 1, to: 0 },
        duration: 420 + i * 90, ease: 'Quad.easeIn', onComplete: () => blk.destroy()
      })
      // 轨迹：从上一块拉一条线过来（"倒过来的方向"）
      if (i > 0) {
        const p = chain[i - 1]
        path.lineStyle(4, 0xf0a03d, 0.75).lineBetween(p.x, p.y, e.x, e.y)
      }
      // 击退：让整排敌人一起被推，强化"成排倒"
      const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y)
      e.setData('kbx', Math.cos(a) * 150)
      e.setData('kby', Math.sin(a) * 150)
    })
    this.tweens.add({ targets: path, alpha: 0, duration: 500, onComplete: () => path.destroy() })
    this.shake(160, 0.004)
  }

  /**
   * 磁铁球：把全场敌人吸向一点并聚拢 1.2 秒。专破「月牙」——
   * 弧形包夹的两翼会被拉直，绕侧翼的战术当场失效。
   *
   * 特效（形态 = **一个悬浮的铁球 + 吸过来的铁屑拖尾**）：
   * 球在玩家前方出现并持续脉动，每只被拉的敌人身后拖一条指向球的细线 ——
   * "被吸"这个动作必须靠**线的方向**读出来，只靠敌人移动会被误认为"它们自己冲过来了"。
   */
  private stratMagnetBall() {
    const ang = this.facingAngle()
    const cx = this.player.x + Math.cos(ang) * 170
    const cy = this.player.y + Math.sin(ang) * 170
    const ball = this.fxSprite(cx, cy, 'glow', 0x9ab8d8, 1.2, 56)
    const core = this.add.graphics().setDepth(57)
    core.fillStyle(0xd8e6f5, 1).fillCircle(cx, cy, 13)
    core.fillStyle(0x5a7fa8, 1).fillCircle(cx, cy, 7)
    this.tweens.add({ targets: ball, scale: 2.6, alpha: 0.7, duration: 240, yoyo: true, repeat: 4 })

    const link = this.add.graphics().setDepth(9)
    const N = 24
    const step = (k: number) => {
      if (k <= 0 || this.over) { link.destroy(); core.destroy(); return }
      link.clear()
      for (const e of this.activeEnemies()) {
        const d = Phaser.Math.Distance.Between(e.x, e.y, cx, cy)
        if (d < 6) continue
        const a = Phaser.Math.Angle.Between(e.x, e.y, cx, cy)
        // 越远吸力越强 —— 否则远处的敌人永远进不来，"聚拢"就失效
        const pull = Math.min(560, 260 + d * 1.1)
        e.setData('kbx', Math.cos(a) * pull)
        e.setData('kby', Math.sin(a) * pull)
        link.lineStyle(2, 0x9ab8d8, 0.5).lineBetween(e.x, e.y, cx, cy)
      }
      this.time.delayedCall(50, () => step(k - 1))
    }
    step(N)
    // 聚拢 1.2 秒后炸一次：把这些挤成一堆的敌人一起打
    this.time.delayedCall(1200, () => {
      if (this.over) return
      this.impactRing(cx, cy, 0x9ab8d8, 150, 320)
      this.shake(200, 0.005)
      for (const e of this.activeEnemies()) {
        if (Phaser.Math.Distance.Between(e.x, e.y, cx, cy) > 120) continue
        this.hurtEnemy(e, 22 * this.dmgScale * this.buffDmg, 0x9ab8d8, '#9ab8d8')
      }
    })
  }

  /**
   * 声呐冲击：身前打出一道声波，持续 1.5 秒；撞上的敌人以 2 倍速弹回，
   * 并把后面的同伴一起撞散。专破「尖刀」—— 楔形冲锋的箭头被顶回去。
   *
   * 特效（形态 = **一根绷紧后回弹的皮筋**）：两根立柱插在玩家两侧，
   * 中间一根高频抖动的皮筋（抖动 = 绷紧），每次弹到敌人时皮筋向反方向猛凹一下。
   */
  private stratRubber() {
    const ang = this.facingAngle()
    const px2 = -Math.sin(ang)
    const py2 = Math.cos(ang)
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    const cx = this.player.x + ux * 120
    const cy = this.player.y + uy * 120
    const HALF = 95

    const g = this.add.graphics().setDepth(10)
    const wobble = { v: 0 }
    const draw = () => {
      g.clear()
      const ax = cx + px2 * HALF, ay = cy + py2 * HALF
      const bx = cx - px2 * HALF, by = cy - py2 * HALF
      // 立柱
      g.fillStyle(0x8fe08a, 0.9)
      g.fillRect(ax - 5, ay - 14, 10, 28)
      g.fillRect(bx - 5, by - 14, 10, 28)
      // 皮筋：中点被"拉"出一个凹口（wobble），读起来像弹性件
      const mx = cx - ux * wobble.v
      const my = cy - uy * wobble.v
      g.lineStyle(5, 0x7ee08a, 0.95)
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(mx, my); g.lineTo(bx, by); g.strokePath()
      g.lineStyle(2, 0xdfffe0, 0.8)
      g.beginPath(); g.moveTo(ax, ay - 2); g.lineTo(mx, my - 2); g.lineTo(bx, by - 2); g.strokePath()
    }
    // 抖动循环
    const N = 18
    const tick = (k: number) => {
      if (k <= 0 || this.over) { this.tweens.add({ targets: g, alpha: 0, duration: 120, onComplete: () => g.destroy() }); return }
      wobble.v = wobble.v > 0 ? -3 : 3
      draw()
      // 判定：前方矩形带内的敌人被弹回
      for (const e of this.activeEnemies()) {
        const dx = e.x - this.player.x
        const dy = e.y - this.player.y
        const fwd = dx * ux + dy * uy
        const side = dx * px2 + dy * py2
        if (fwd < 70 || fwd > 210 || Math.abs(side) > HALF + 10) continue
        if (e.getData('rubberCd') > this.elapsed) continue
        e.setData('rubberCd', this.elapsed + 0.4)
        const sp = (e.getData('sp') as number) || 70
        // 2 倍速弹回 + 附加冲量
        const push = sp * 2 + 260
        e.setData('kbx', -ux * push)
        e.setData('kby', -uy * push)
        wobble.v = 16
        this.hitFlash(e)
        this.hurtEnemy(e, 24 * this.dmgScale * this.buffDmg, 0x7ee08a, '#7ee08a')
        this.impactRing(e.x, e.y, 0x7ee08a, 46, 180)
        this.emitBits(e.x, e.y, 'fx_ember', 0x7ee08a, 3, 70, 380)
      }
      this.time.delayedCall(80, () => tick(k - 1))
    }
    tick(N)
    this.shake(120, 0.003)
  }

  /**
   * 陀螺：自身旋转 3 秒，近身持续击退并造成伤害。专破「乱堆」——
   * 被围在中间时，这就是"谁都近不了身"的那一下。
   *
   * 特效（形态 = **绕着玩家公转的陀螺 + 旋转残影环**）：
   * 陀螺本体绕玩家转圈并自转（两层旋转），地面留一圈持续旋转的刻度环 ——
   * "旋转"必须同时有**公转**和**自转**，只有一层读起来像个普通圆点。
   */
  private stratSpinner() {
    const top = this.add.graphics().setDepth(59)
    top.fillStyle(0x8fe8ff, 1)
    top.fillTriangle(0, -12, 9, 8, -9, 8)
    top.fillStyle(0xdff8ff, 1).fillRect(-2, 8, 4, 7)
    const ring = this.add.graphics().setDepth(8)
    const N = 25
    const tick = (k: number) => {
      if (k <= 0 || this.over) {
        this.tweens.add({ targets: [top, ring], alpha: 0, duration: 160, onComplete: () => { top.destroy(); ring.destroy() } })
        return
      }
      const t = this.time.now
      const oa = t / 90
      top.setPosition(this.player.x + Math.cos(oa) * 74, this.player.y + Math.sin(oa) * 74)
      top.setRotation((t / 40) % (Math.PI * 2))
      // 刻度环：随陀螺自转一起转，读得出"它在转"
      ring.clear()
      ring.lineStyle(3, 0x6ec6ff, 0.55).strokeCircle(this.player.x, this.player.y, 120)
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t / 220
        ring.lineStyle(3, 0xbfe9ff, 0.8).lineBetween(
          this.player.x + Math.cos(a) * 112, this.player.y + Math.sin(a) * 112,
          this.player.x + Math.cos(a) * 128, this.player.y + Math.sin(a) * 128)
      }
      // 近身判定：击退 + 伤害
      for (const e of this.activeEnemies()) {
        const d = Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y)
        if (d > 120) continue
        const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y)
        e.setData('kbx', Math.cos(a) * 420)
        e.setData('kby', Math.sin(a) * 420)
        this.hurtEnemy(e, 11 * this.dmgScale * this.buffDmg, 0x6ec6ff, '#8fe8ff')
      }
      this.time.delayedCall(120, () => tick(k - 1))
    }
    tick(N)
    this.shake(120, 0.003)
  }

  /**
   * 拼图盒：把全场的**远程单位**装进盒子定身 3 秒，近战不受影响。
   * 专破「人字」与「铁桶」—— 这两个阵的威胁全在后排射手，
   * 定住射手 = 阵型只剩一层皮。
   *
   * 特效（形态 = **每个射手脚下一个合拢的盒子 + 拼图缺口**）：
   * 盒子从四面合拢（四个梯形片向中心收），并在顶部留一个拼图凸起 ——
   * "盒子"这个概念靠**合拢**这个动作读出来，只画一个方框会被当成护盾。
   */
  private stratPuzzleBox() {
    let n = 0
    for (const e of this.activeEnemies()) {
      // 只认远程：带 shootMax 的才是射手
      if (!((e.getData('shootMax') as number) > 0)) continue
      n++
      e.setData('stunUntil', this.elapsed + 3)
      e.setData('kbx', 0)
      e.setData('kby', 0)
      // 盒子：四个梯形片 + 顶盖
      const box = this.add.graphics().setDepth(57)
      const R = 26
      const seg = (i: number, k: number) => {
        box.clear()
        const c = 0xb98cff
        box.fillStyle(c, 0.85)
        const off = (1 - k) * (R + 14)
        box.fillTriangle(-R, -R - off, R, -R - off, 0, -R + 6 - off)          // 上
        box.fillTriangle(-R - off, -R, -R - off, R, -R + 6 - off, 0)          // 左
        box.fillTriangle(R + off, -R, R + off, R, R - 6 + off, 0)             // 右
        box.fillTriangle(-R, R + off, R, R + off, 0, R - 6 + off)             // 下
        box.fillStyle(0xd9c4ff, 0.95)
        box.fillCircle(0, -R + 4, 5)                                          // 拼图凸起
      }
      box.setPosition(e.x, e.y + 4)
      // 三段合拢：0 -> 1 用 240ms
      let k = 0
      const close = () => {
        if (!box.active) return
        k = Math.min(1, k + 0.16)
        seg(0, k)
        if (k < 1) this.time.delayedCall(28, close)
      }
      close()
      // 盒子跟着敌人（射手其实被定住了，但击退残留可能还在动）
      const follow = this.time.addEvent({
        delay: 60, repeat: 49, callback: () => {
          if (!box.active) return
          box.setPosition(e.x, e.y + 4)
          if (this.over) { box.destroy(); follow.remove() }
        }
      })
      this.time.delayedCall(3000, () => {
        if (!box.active) return
        this.tweens.add({
          targets: box, alpha: 0, scale: 1.5, duration: 220, onComplete: () => box.destroy()
        })
        this.emitBits(e.x, e.y, 'fx_shard', 0xb98cff, 5, 80, 420)
      })
      this.tintFlash(e, 0xb98cff)
    }
    if (n === 0) this.toast('这一波没有远程单位 —— 拼图盒落空了')
    else this.toast(`装进盒子：${n} 个远程单位被定身 3 秒`)
  }

  /**
   * 超频电池：攻速 +70%、伤害 +30% 持续 8 秒，但受伤 +50%。
   * 不带针对性时的通用爆发 —— 也是唯一一个"放完要还"的计谋。
   *
   * 特效（形态 = **从下往上升的电流 + 顶部的闪电**）：与别的计谋"向外扩散"反着来，
   * 它一律向**上**升，配合屏幕四边的金色脉冲，把"我充上电了"压进视野边缘。
   */
  private stratOverclock() {
    this.buffDmg = 1.3
    this.buffAtk = 1.7
    this.buffVuln = 1.5
    this.buffT = 8000
    this.redFlash()
    const rune = this.fxSprite(this.player.x, this.player.y + 10, 'fx_rune', 0xffd93d, 1.6, 56)
    this.tweens.add({
      targets: rune, scale: 2.4, alpha: 0, rotation: -1.2,
      duration: 700, ease: 'Cubic.easeOut', onComplete: () => rune.destroy()
    })
    // 电流上升：闪电贴图从脚下往上飘
    for (let i = 0; i < 20; i++) {
      this.time.delayedCall(i * 30, () => {
        if (this.over) return
        const o = this.fxSprite(
          this.player.x + Phaser.Math.Between(-26, 26),
          this.player.y + Phaser.Math.Between(-2, 18),
          'fx_bolt', i % 3 === 0 ? 0xfff0a8 : 0xffd93d, 0.9, 57)
        this.tweens.add({
          targets: o, y: o.y - Phaser.Math.Between(34, 66), alpha: 0,
          rotation: Phaser.Math.FloatBetween(-0.4, 0.4),
          duration: 480 + Math.random() * 240, ease: 'Quad.easeOut',
          onComplete: () => o.destroy()
        })
      })
    }
    for (let i = 0; i < 2; i++) {
      this.time.delayedCall(i * 230, () => this.edgePulse(0xffd93d))
    }
  }

  /**
   * 计谋类别 -> 主色。备战界面、HUD 图标、施法特效共用同一套色 ——
   * 玩家进局前就记住"黄=多米诺 / 银=磁铁 / 绿=皮筋 / 青=陀螺 / 紫=盒子 / 金=电池"。
   */
  private kindColor(kind: string): number {
    switch (kind) {
      case 'chain': return 0xf0a03d     // 多米诺：纸箱黄
      case 'pull': return 0x9ab8d8      // 磁铁球：冷银
      case 'rebound': return 0x7ee08a   // 声呐冲击：声波绿
      case 'spin': return 0x6ec6ff      // 陀螺：转起来的青
      case 'stun': return 0xb98cff      // 拼图盒：拼图紫
      case 'buff': return 0xffd93d      // 超频电池：电金
      default: return 0xffffff
    }
  }

  /**
   * 命中冲击环：在命中点炸开一圈独立的扩散环（不染敌人、不放大敌人）。
   * 这是"撞击感"的主来源 —— 过去敌人白闪被刻意压到 55ms/1.07 倍（修"敌人发白"的硬约束），
   * 单靠它给不出"这一下发实了"的分量，所以另起一个独立光环来补重量。
   * 用 window 的 cring 贴图 + ADD 混合，叠在深色地面上像一道能量回波。
   */
  private impactRing(x: number, y: number, color: number, maxR = 44, dur = 190) {
    const r = this.add.image(x, y, 'cring')
      .setTint(color).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(58).setScale(0.3).setAlpha(0.95)
    this.tweens.add({
      targets: r, scale: maxR / 28, alpha: 0, duration: dur,
      ease: 'Cubic.easeOut', onComplete: () => r.destroy()
    })
  }

  /**
   * 命中顿帧（hit-stop）：极短暂地把 time/tweens 的 timeScale 压低，再真时复位。
   * 这是动作游戏里"重量感"最便宜也最有效的手段 —— 那一瞬间全世界慢半拍，
   * 玩家的眼睛会被钉在击中点上。只用在"大事"上（施法、击杀、受击、Boss 命中），
   * 逐发子弹绝不调用，否则会变成全局慢动作。
   * 用 window.setTimeout 做真时复位：time.timeScale 本身被压低后，Phaser 自家的
   * delayedCall 也会跟着变慢，不能拿它来复位自己。
   */
  private hitStop(ms: number, slow = 0.12) {
    if (this.fxStopping) return
    this.fxStopping = true
    this.time.timeScale = slow
    this.tweens.timeScale = slow
    window.setTimeout(() => {
      this.time.timeScale = 1
      this.tweens.timeScale = 1
      this.fxStopping = false
    }, ms)
  }

  // ==========================================================================
  // 特效系统
  // --------------------------------------------------------------------------
  // 「技能特效还是很单一」是这一版专门要解的问题。它**不是美术资源问题**：
  // 本作所有特效都由代码画（见 makeTextures 里的 fx_* 底形），
  // 缺的是**一套统一的规则**。规则定下来之后，六个计谋的差异是"填空"而不是"重画"。
  //
  // 统一规则（三段式）：
  //
  //   ① 蓄力：脚下符印浮现 + 一圈光环向内收拢 + 类别图标盖在角色上
  //            —— 解决"这一下是我按的"，把它和普攻的细碎命中彻底分开
  //   ② 爆发：形态化的扩散。**每个计谋的形态必须轮廓不同**，
  //            不能是同一颗圆点换六个颜色（那正是"单一"的来源）
  //   ③ 余韵：地面残留（灼痕 / 霜面 / 插地箭簇 / 城垛轮廓）
  //            —— 让"刚刚发生过一件大事"在画面上停留一会儿
  //
  // 颜色语言（与备战界面的计谋图标**共用同一套**，进局前就该记住）：
  //   火 burst = 橙 0xff7b29 ／ 冰 control = 蓝 0x6ec6ff
  //   金 buff  = 黄 0xffd93d ／ 守 guard   = 青玉 UI.jade
  // ==========================================================================

  // ==========================================================================
  // 后期辉光 + 粒子系统
  //
  // 上面那段"三段式规则"管的是**形态**，但形态对了画面依然不发光 ——
  // 因为这两块此前**一处都没用**，而这正是"弹幕不炫酷"的根因：
  //
  //   · 没有 postFX：所有 ADD 混合的弹体只是"亮色贴图"，没有过曝溢出的光晕。
  //     肉眼看到的是一堆彩色小方块，而不是"光"。
  //   · 没有粒子系统：枪口/命中/击杀的碎屑是**逐个 tween 一段 image**
  //     （见旧版 spark / deathBurst），件数少、生命周期僵硬，
  //     读起来像几个孤立小点在各自飘，凑不出"炸开"的量。
  //
  // 补上之后，原来那套形态规则才真正"通电"——同一个冲击环，
  // 有辉光和没辉光是两种东西。
  // ==========================================================================

  /**
   * 相机级辉光。postFX 是 **WebGL 专有管线**：Canvas 渲染器下 `postFX` 不存在，
   * 不判空会直接崩在启动（部分无头浏览器会回退到 Canvas）。
   * 判定用 renderer.type 而不是 `postFX != null`，是因为后者在类型上永远为真。
   */
  private setupPostFX() {
    if (this.game.renderer.type !== Phaser.WEBGL) return
    const cam = this.cameras.main
    if (!cam.postFX) return
    // blurStrength 决定光晕铺多远，strength 决定过曝多狠。
    // **刻意不拉满**，实测 0.7 以上会把弹体颜色整体冲成白色 ——
    // 本作武器配色本来就偏浅（浅金／米白／淡蓝），ADD 混合再叠强辉光就只剩白，
    // 而"靠颜色+形状认武器"是这套战斗的核心读法，颜色不能丢。
    this.bloomFX = cam.postFX.addBloom(0xffffff, 1, 1, 1.0, 0.62, 4)
  }

  /**
   * 把辉光瞬间推高再回落。
   * 全屏亮度变化是**帧级**的，比任何单个特效对象都更容易被余光捕捉到 ——
   * "这一下比平常更猛"就靠它，不需要再加任何新贴图。
   */
  private bloomPunch(to = 1.8, back = 0.62, dur = 430) {
    if (!this.bloomFX) return
    this.tweens.killTweensOf(this.bloomFX)
    this.bloomFX.strength = to
    this.tweens.add({ targets: this.bloomFX, strength: back, duration: dur, ease: 'Quad.easeOut' })
  }

  /**
   * 三个粒子发射器。全部 `emitting: false` —— 只在需要时 `emitParticleAt` 喷一把。
   * 常驻发射会变成一屏无意义的持续雾，既费性能又糊掉画面。
   * 关掉常驻还有个好处：粒子系统的开销与"事件数"成正比，而不是与帧数成正比。
   */
  private setupParticles() {
    // 灼热火星：枪口 / 命中。ADD 混合 + 快速收束，才有"烫"的读感。
    this.pSpark = this.add.particles(0, 0, 'fx_ember', {
      emitting: false,
      lifespan: { min: 150, max: 340 },
      speed: { min: 110, max: 340 },
      scale: { start: 0.75, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD'
    }).setDepth(56)

    // 余烬：更慢更飘，还给弹道留一条渐隐的尾（重力为负 = 往上飘，像热灰）
    this.pEmber = this.add.particles(0, 0, 'fx_ember', {
      emitting: false,
      lifespan: { min: 260, max: 560 },
      speed: { min: 20, max: 95 },
      gravityY: -14,
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.9, end: 0 },
      blendMode: 'ADD'
    }).setDepth(54)

    // 烟尘：**不加光**（普通混合），负责"挡住光"。
    // 纯发光特效堆在一起会互相抵消成一片白，必须有暗的东西压住。
    this.pSmoke = this.add.particles(0, 0, 'dot', {
      emitting: false,
      lifespan: { min: 280, max: 620 },
      speed: { min: 10, max: 60 },
      gravityY: -10,
      scale: { start: 0.3, end: 0.8 },
      alpha: { start: 0.32, end: 0 },
      tint: 0x6b5c48
    }).setDepth(53)
  }

  /**
   * 生成一个短命的特效贴图。统一入口是为了让深度与混合模式只有一处定义，
   * 同时也是为了**能被整体清场**：每个特效对象都打上 `fx` 标记，
   * `fxClear()` 才能在不碰敌人/掉落/UI 的前提下把特效一次性收走。
   */
  private fxSprite(
    x: number, y: number, tex: string, color: number,
    scale = 1, depth = 60, blend = true
  ): Phaser.GameObjects.Image {
    const o = this.add.image(x, y, tex).setTint(color).setDepth(depth).setScale(scale)
    if (blend) o.setBlendMode(Phaser.BlendModes.ADD)
    o.setData('fx', 1)
    return o
  }

  /** 碎屑四散（火星 / 尘土 / 木屑通用）。n 个，速度与寿命带随机，避免"整整齐齐"的塑料感。 */
  private emitBits(
    x: number, y: number, tex: string, color: number,
    n: number, speed = 90, life = 420, depth = 60
  ) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const d = speed * (0.45 + Math.random())
      const o = this.fxSprite(x, y, tex, color, 0.75 + Math.random() * 0.6, depth)
      this.tweens.add({
        targets: o,
        x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        alpha: 0, scale: 0.1, rotation: Math.random() * 3,
        duration: life * (0.7 + Math.random() * 0.6), ease: 'Quad.easeOut',
        onComplete: () => o.destroy()
      })
    }
  }

  /** 屏幕四边的赤色/异色脉冲。比整屏闪更有"画面被框住"的压迫感。 */
  private edgePulse(color: number, alpha = 0.8, dur = 420) {
    const w = this.scale.width
    const h = this.scale.height
    const bars = [
      this.add.rectangle(0, 0, w, 6, color, 1).setOrigin(0, 0),
      this.add.rectangle(0, h - 6, w, 6, color, 1).setOrigin(0, 0),
      this.add.rectangle(0, 0, 6, h, color, 1).setOrigin(0, 0),
      this.add.rectangle(w - 6, 0, 6, h, color, 1).setOrigin(0, 0)
    ]
    for (const b of bars) {
      b.setScrollFactor(0).setDepth(86).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha)
      this.tweens.add({ targets: b, alpha: 0, duration: dur, onComplete: () => b.destroy() })
    }
  }

  /**
   * 施法「蓄力」段。所有计谋共用，保证"我按了计谋"这件事有一致的前摇读感。
   * 纯视觉：不延迟任何伤害/状态的结算，所以逻辑时序与之前完全一致。
   */
  private castTelegraph(color: number, kind: string) {
    const x = this.player.x
    const y = this.player.y
    // ① 地面符印：先浮现（大→正常），再炸开消失
    const rune = this.fxSprite(x, y + 10, 'fx_rune', color, 1.6, 56)
    this.tweens.add({ targets: rune, scale: 1.0, alpha: 0.95, duration: 130, ease: 'Quad.easeOut' })
    this.tweens.add({
      targets: rune, scale: 3.6, alpha: 0, rotation: 0.9, duration: 460, delay: 130,
      ease: 'Cubic.easeOut', onComplete: () => rune.destroy()
    })
    // ② 收拢环：从外向内收，视觉上"把气聚起来"
    const conv = this.fxSprite(x, y, 'cring', color, 3.4, 57)
    conv.setAlpha(0.6)
    this.tweens.add({
      targets: conv, scale: 0.45, alpha: 0, duration: 210, ease: 'Quad.easeIn',
      onComplete: () => conv.destroy()
    })
    // ③ 类别图标：把备战界面记住的那个形状，在发招瞬间"盖"到角色上
    const gl = this.add.graphics().setDepth(63).setPosition(x, y)
    this.drawStratGlyph(gl, kind, 0xffffff, 2.0)
    gl.setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setAlpha(1)
    this.tweens.add({
      targets: gl, scale: 2.6, alpha: 0, duration: 430,
      ease: 'Quad.easeOut', onComplete: () => gl.destroy()
    })
  }

  /** 计谋释放的 spectacle：蓄力段 + 双重冲击波 + 全屏色彩冲刷 + 震屏 + 顿帧。
   *  明确"这一下是你主动按出来的大事件"，而不是普攻那种细碎的命中。 */
  private stratBurst() {
    const kind = this.stratagem ? this.stratagem.kind : ''
    const color = this.kindColor(kind)
    const x = this.player.x
    const y = this.player.y

    this.castTelegraph(color, kind)

    // 全屏亮度冲顶 + 粒子环。计谋是全作"最重"的一次输入，
    // 必须在**全屏亮度**这一层也读得出来 —— 单个特效对象做不到这件事，
    // 而"我按的这一下比普攻猛得多"正是靠这个区分开的。
    this.bloomPunch(2.1, 0.62, 520)
    this.pSpark.setParticleTint(color)
    this.pSpark.emitParticleAt(x, y, 26)
    this.pEmber.setParticleTint(color)
    this.pEmber.emitParticleAt(x, y, 16)

    // 双重彩色冲击波：外环推得更远、内核更亮，层次拉开后"炸开"才读得出
    for (const [scaleTo, dur, alp] of [[9, 540, 0.9], [5.5, 420, 0.65]] as [number, number, number][]) {
      const r = this.add.image(x, y, 'cring').setTint(color)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(62).setScale(0.25).setAlpha(alp)
      this.tweens.add({
        targets: r, scale: scaleTo, alpha: 0, duration: dur,
        ease: 'Cubic.easeOut', onComplete: () => r.destroy()
      })
    }

    // 屏幕元素冲刷：一层很淡的同色全屏闪，把"火/冰/金/盾"的气氛铺满视野
    const wash = this.add.rectangle(0, 0, this.scale.width, this.scale.height, color, 0.2)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(85).setBlendMode(Phaser.BlendModes.ADD)
    this.tweens.add({ targets: wash, alpha: 0, duration: 260, onComplete: () => wash.destroy() })

    // 发招分量的最后两块：角色提亮 + 一点震屏（计谋 20~30s 才放一次，震一下是"大事"不是"噪音"）
    this.heroImg.setAlpha(1)
    this.shake(130, 0.0035)
    this.hitStop(55, 0.1)
  }

  /** 十面埋伏的落箭：预兆圈 → 弹道线 → 落地扬尘 → 插地残留。 */
  private arrowRain(x: number, y: number, color = 0xffe066) {
    // 落点预兆：一个快速收缩的圈，"这里马上要落"必须在箭到之前读到。
    // 140ms 太快了（缩放动画还没走完箭就落地），且**插地残留要留得够久**：
    // 八波箭每 190ms 一波，单支箭只在场 150ms 的话，任何一帧都只有 1 支箭，
    // 拍出来根本读不到"十面埋伏"是一个覆盖全场的技能。
    const warn = this.fxSprite(x, y, 'cring', color, 2.4, 45)
    warn.setAlpha(0.55)
    this.tweens.add({
      targets: warn, scale: 0.3, alpha: 0.95, duration: 200,
      onComplete: () => warn.destroy()
    })
    const H = 270
    const arrow = this.fxSprite(x, y - H, 'fx_arrowfall', color, 1.5, 70, false)
    const trail = this.fxSprite(x, y - H / 2, 'tracer', color, 1.0, 69)
    trail.setRotation(Math.PI / 2).setAlpha(0.9)
    this.tweens.add({ targets: arrow, y, duration: 150, ease: 'Quad.easeIn' })
    this.tweens.add({
      targets: trail, y: y - 30, alpha: 0, duration: 150, ease: 'Quad.easeIn',
      onComplete: () => trail.destroy()
    })
    this.time.delayedCall(150, () => {
      this.emitBits(x, y, 'fx_ember', 0x8a7350, 5, 70, 380)
      const stuck = this.fxSprite(x, y - 7, 'fx_arrowfall', color, 1.25, 44, false)
      stuck.setAlpha(0.85)
      this.tweens.add({
        targets: stuck, alpha: 0, duration: 900, delay: 380,
        onComplete: () => stuck.destroy()
      })
    })
    arrow.setAlpha(1)
  }

  /** 近战命中：一道月牙斩击弧。和远程的"点命中"在轮廓上直接分开。 */
  private slashArc(x: number, y: number, angle: number, color: number) {
    const s = this.fxSprite(x, y, 'fx_slash', color, 1.5, 59)
    s.setRotation(angle + Math.PI / 2)
    this.tweens.add({
      targets: s, scale: 2.1, alpha: 0, rotation: s.rotation + 0.5,
      duration: 220, ease: 'Quad.easeOut', onComplete: () => s.destroy()
    })
  }

  /**
   * 截图/调试专用：把场上所有特效对象一次性收走。
   *
   * 为什么必须有它：计谋特效是**有时长**的（火墙活 4 秒、灼痕留到火墙结束），
   * 截图脚本要逐个拍六个计谋时，上一发的残留会盖在下一发的照片上 ——
   * 实测 `fx-4-十面埋伏.png` 里拍到的是 fx-1 火计的火墙，落箭反而看不清。
   * 抓拍脚本不能靠"等它自然消失"（那一局的状态会跑掉几千帧），必须能**显式**回到干净画面。
   *
   * 只清视觉，不碰任何逻辑数值；敌人、掉落、UI 都不带 fx 标记，所以一个都不会被误伤。
   */
  fxClear() {
    // 先复制一份再遍历：destroy() 会把对象从 children.list 里摘掉，
    // 直接遍历原数组会"边删边跳"（Phaser 的 children 内部就是普通数组）。
    for (const o of [...this.children.list]) {
      if (o.getData('fx') !== 1) continue
      // 无限循环的补间（火苗的 yoyo repeat:-1）必须先停，
      // 否则会继续对已销毁的对象写属性。
      this.tweens.killTweensOf(o)
      o.destroy()
    }
  }

  /**
   * 截图/调试专用：把一圈敌人直接摆到玩家周围。
   *
   * 为什么不复用 spawnFormation()：阵心是**刻意**放在屏幕外的（见 spawnFormation 的注释），
   * 拍计谋特效时场上会是一圈空地 —— "打在人身上"的撞击感全丢，
   * 而这恰恰是这一版要证明的东西。这里绕过刷怪节奏，只为验证视觉。
   */
  fxRing(n = 14, r = 125) {
    // 用 values 而不是 keys + 反查：roles 是 Record<ArmyRole, string>，
    // 拿 string 去索引会触发 TS7053（strict 下 noImplicitAny）。
    const ids = Object.values(this.faction.roles)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.22, 0.22)
      // 半径抖动收窄到 ±15%：抖太开（试过 0.72~1.28）时这一圈会挤成互相重叠的一坨，
      // 照片里特效反而被靶子挡住 —— 摆靶是为了看清特效，不是为了看清靶子。
      const rr = r * Phaser.Math.FloatBetween(0.85, 1.15)
      const def = enemyById(ids[i % ids.length])
      const e = this.spawnEnemy(def, false,
        this.player.x + Math.cos(a) * rr, this.player.y + Math.sin(a) * rr)
      // 池化实例会带着上一个单位的 behavior / holdR / fgt 残留
      // （正是本项目踩过的"白色敌人 / 胖怪顶着小虫贴图"同一类坑），
      // 不重设的话这圈靶子会出现"被摆到脸上却往后退"的怪行为。
      if (e) {
        e.setData('behavior', 'charge')
        e.setData('holdR', 0)
        e.setData('fgt', '')
      }
    }
  }

  /** 受控的染色反馈（不覆盖贴图细节，与 hitFlash 的短暂白闪区分开） */
  private tintFlash(e: Phaser.Physics.Arcade.Image, color: number) {
    e.setTint(color)
    this.tweens.add({
      targets: e, alpha: 0.55, duration: 120, yoyo: true, repeat: 1,
      onComplete: () => { if (e.active) { e.clearTint(); e.setAlpha(1) } }
    })
  }

  /**
   * 波次推进 + 目标判定（Brotato 化的核心）。
   *
   * 一关 = stage.waves 波，每波 BALANCE.waveSec 秒；波与波之间进商店（enterShop）。
   * 三种目标（见 StageDef.objective）：
   *   survive —— 打满全部波次即通关
   *   kill    —— 击杀数达标即通关（可以提前结束）
   *   boss    —— 打满全部波次且斩杀 Boss 即通关；到时未斩杀 = 未竟
   * 中途阵亡 = 直接失败（走 gameOver 的另一条分支）。
   */
  private tickWave() {
    if (this.objDone || this.objFailed || this.over || this.inShop) return
    const st = this.stage
    const totalSec = st.waves * BALANCE.waveSec
    this.waveT = this.elapsed - (this.wave - 1) * BALANCE.waveSec

    if (st.objective === 'kill') {
      this.objProgress = Math.min(1, this.kills / st.target)
      if (this.kills >= st.target) { this.finishStage(); return }
    } else {
      this.objProgress = Math.min(1, this.elapsed / totalSec)
    }

    // 打满全部波次 —— 结算
    if (this.elapsed >= totalSec) {
      if (st.objective === 'boss' && !this.bossDown) this.failStage()
      else this.finishStage()
      return
    }

    // 跨波 → 波间商店
    const w = Math.floor(this.elapsed / BALANCE.waveSec) + 1
    if (w > this.wave) {
      this.wave = w
      this.enterShop()
    }
  }

  /**
   * 受击无敌帧。
   *
   * 这是全场唯一一条把「被围住」从必死改成可操作的机制，必须有。
   * 没有它的时候：5 只杂兵叠在玩家身上 = 5 x 8 伤害 / 0.6s ≈ 58 dps，
   * 而玩家总共 100 血 —— 实测对局曲线里血量是 88 → 94 → 34 → -4，
   * 1.4 秒内掉 60 血，玩家连"该往哪跑"都来不及想。这不是难，是不给操作空间。
   * 加上之后，同样的包围圈最大伤害被钉在「每 0.7 秒掉一次」，玩家有时间脱身。
   *
   * 闪烁是配套的必需品：不加视觉反馈，玩家只会觉得"偶尔不掉血"很诡异。
   */
  private tickInvuln(delta: number) {
    if (this.invuln <= 0) return
    this.invuln -= delta
    if (this.invuln <= 0) {
      this.invuln = 0
      this.heroImg.setAlpha(1)
      return
    }
    this.heroImg.setAlpha(Math.floor(this.invuln / 90) % 2 ? 0.3 : 1)
  }

  private handleMove() {
    const k = this.keys
    let vx = 0
    let vy = 0
    if (k.A.isDown || k.LEFT.isDown) vx -= 1
    if (k.D.isDown || k.RIGHT.isDown) vx += 1
    if (k.W.isDown || k.UP.isDown) vy -= 1
    if (k.S.isDown || k.DOWN.isDown) vy += 1
    this.moving = (vx !== 0 || vy !== 0)
    this.moveVx = vx
    this.moveVy = vy

    // 4 向朝向：水平分量占优走"侧身"，否则上=背身 / 下=正面。
    // 判据用 |vx| >= |vy|（而不是 vx 是否为零），斜向移动时朝向才不会每帧反复横跳。
    if (vx !== 0) this.lastVx = vx > 0 ? 1 : -1
    if (vx !== 0 || vy !== 0) {
      if (Math.abs(vx) >= Math.abs(vy)) {
        this.facing = 'side'
        this.faceRight = vx > 0
      } else {
        this.facing = vy < 0 ? 'up' : 'down'
        this.faceRight = this.lastVx > 0 // 上下移动沿用最近的水平朝向，避免突然翻面
      }
    }

    const len = Math.hypot(vx, vy) || 1
    const body = this.player.body as Phaser.Physics.Arcade.Body
    body.setVelocity((vx / len) * this.speed, (vy / len) * this.speed)
  }

  // 主角动画：帧序列驱动（方向 x 动作），不再用旋转/缩放去"模拟"动作。
  //   朝向 = 移动输入方向（下/上/侧）；施法瞬间锁到目标方向
  //   动作 = 开火 attack / 移动 walk / 静止 idle
  // 表现层只保留极轻的整数像素位移（开火后坐），避免破坏像素网格的锐利感。
  /**
   * P2 · 光资源的每帧推进：回光 → 算半径 → 驱动遮罩 → 刷 HUD。
   *
   * 三段设计（详见 gameData.LIGHT）：
   *   · 光量 = 伤害消耗的累计（spendLight 由每次开火调用）
   *   · 光量自然回涨，回涨速率固定 —— 于是「不停开火」等于「视野持续收缩」
   *   · 半径在 lampR 与 tacticalR 之间插值，低于 tacticalFrac 时收缩最快
   *
   * 为什么半径要**平滑**而不能直接用光量算：
   * 直接算的话，光量每掉一点视野就抖一下，实测像是屏幕在闪烁。
   * 实测标定：8px/帧的收敛时间约 0.35秒，够跟手又不拖沓。
   */
  private tickLight(delta: number) {
    // 结算/升级面板打开时不回光：面板期间玩家不做决策，
    // 白送的光会让"光"变成一个不需要管的数值。
    if (!this.paused) {
      this.light = Math.min(LIGHT.max, this.light + LIGHT.regenPerSec * delta / 1000)
    }
    const frac = this.light / LIGHT.max
    // 两段插值：tacticalFrac 以下用 lampR 附近（衰减快），以上往 tacticalR 靠
    const tf = LIGHT.tacticalFrac
    let targetR: number
    if (frac >= tf) {
      const t = (frac - tf) / (1 - tf)
      targetR = LIGHT.lampR + (LIGHT.tacticalR - LIGHT.lampR) * t
    } else {
      // 低于阈值：**平方**衰减，让最后那一小段光掉得很快，
      // 玩家能明确感到"要熄火了"，而不是缓慢地一点点看不清
      const t = frac / tf
      targetR = LIGHT.lampR * (0.45 + 0.55 * t * t)
    }
    // 平滑收敛：8px/帧 @60fps ≈ 0.35s 从头灯到战术半径
    const step = 8 * delta / 16.67
    this.lightR += Phaser.Math.Clamp(targetR - this.lightR, -step, step)
    if (this.lightR < 1) this.lightR = 1

    // 遮罩尺寸必须**至少盖满整个屏幕**，不能只等于光圈直径。
    //
    // 踩过的坑：最初直接setDisplaySize(lightR*2, lightR*2)，
    // 而战术半径 420 → 遮罩只有 840×840，
    // 而实测窗口是 960×649 —— 遮罩的**左右两侧压根没覆盖到屏幕边缘**，
    // 结果是「一圈黑 + 屏幕两边照样看得清清楚楚」，
    // 光照范围看起来像个奇怪的黑色甜甜圈，完全不是「黑暗中的一束光」。
    //
    // 正确做法：贴图是**径向**的，把半径换算成能盖住屏幕的尺寸 ——
    // 中心透明区半径 = 贴图半径 × CLEAR（0.52）。
    // 所以要让中心透明区恰好等于 lightR，贴图半径必须 = lightR / CLEAR。
    const CLEAR_FRAC = 0.14
    const coverR = Math.max(
      this.lightR / CLEAR_FRAC,
      // 再兜一层：无论半径多小，也要盖满屏幕，
      // 否则缩到头灯范围时屏幕角落会露出两条亮边。
      Math.hypot(this.scale.width, this.scale.height) / 2)
    const d = coverR * 2
    this.darkMask.setPosition(this.player.x, this.player.y)
      .setDisplaySize(d, d).setAlpha(1)

    // 跨入头灯范围时给一次提示，之后不再刷屏
    if (!this.lightWarned && frac < tf) {
      this.lightWarned = true
      this.toast('光量不足 · 视野收窄')
    } else if (frac >= tf + 0.06) {
      this.lightWarned = false
    }
    this.drawLightBar()
  }

  /** 开火扣光：**按伤害扣**，所以高伤武器自然更费光，不需要另配平衡表 */
  private spendLight(dmg: number) {
    // 每点伤害 0.9 光：连发声呐(6伤/140ms) ≈ 5.4 光/发，标枪(20伤/700ms) ≈ 18 光/发。
    // 配合 7/s 回光，前者可持续、后者必须择时 —— 这个差就是玩法。
    this.light = Math.max(0, this.light - dmg * 0.9)
  }

  /**
   * 光量条。**故意画成"光圈半径的实时读数"**而不是一根普通进度条：
   * 条的长度对应光量，条的颜色对应当前是否还在战术半径内，
   * 临界时整条转成呼吸的警示色。玩家不用看数字就知道自己还有没有光。
   */
  private drawLightBar() {
    if (!this.lightBar) return
    // 自己算 HUD 缩放：refreshHud 里的 px() 是局部函数，
    // 而光量条是**每帧**重画的（在 tickLight 里），不能挂在那个生命周期上。
    // 用 hudK 是等值的 —— 它就是 refreshHud 里 px 用的那个系数。
    const px = (v: number) => Math.round(v * this.hudK)
    const bx = px(this.hudBarX)
    const bw = px(this.hudBarW)
    // y=62：血条(y=44,h=15) 结束于 59，经验条在 y=68。
    // 原来的 78 正好压在经验条上，两条叠在一起完全读不出来。
    const y = px(61)
    const h = px(6)
    const frac = Phaser.Math.Clamp(this.light / LIGHT.max, 0, 1)
    // 阈值线：标出 tacticalFrac 的位置，玩家能"看见"边界在哪
    const tfX = bx + 1 + (bw - 2) * LIGHT.tacticalFrac
    const low = frac < LIGHT.tacticalFrac
    // 低于阈值时闪烁，频率约 3Hz —— 慢到不刺眼，快到能被余光捕捉
    const blink = low ? 0.55 + 0.45 * Math.sin(this.elapsed * 9) : 1
    const col = low ? 0xff5fd0 : frac > 0.7 ? 0x4fe8ff : 0xffd24a

    const g = this.lightBar
    g.clear()
    g.fillStyle(0x000000, 0.6).fillRect(bx, y, bw, h)
    g.fillStyle(col, blink).fillRect(bx + 1, y + 1, Math.max(0, (bw - 2) * frac), h - 2)
    // 阈值竖线：用深色画在条上方 2px 处，不遮进度
    g.fillStyle(0xffffff, 0.5).fillRect(tfX, y - 2, 1, 3)
    this.lightText.setText(`光 ${Math.round(this.light)}`)
    this.lightText.setColor(low ? '#ff8ade' : '#dff6ff')
  }

  private animatePlayer(delta: number) {
    this.shadow.setPosition(this.player.x, this.player.y + 30)
    // 头灯：玩家身上的一圈柔光，**画在黑暗遮罩之上**（depth 36 > 35）。
    //
    // 为什么必须有这一层：黑暗遮罩压下去之后，玩家的潜水服
    // （深墨色 + 深描边）在"亮区"里反而成了**全画面最黑的一块** ——
    // 实机截图里玩家就是一个黑方块，完全看不见自己。
    // 这不是亮度问题，是**对比方向问题**：周围亮了，深色剪影就变黑了。
    //
    // 解法符合设定：头灯本来就是玩家身上的东西。
    // 一层 ADD 混合的青色光晕把玩家自己照亮，
    // 于是「黑暗中的一束光」在角色身上也成立。
    const lampR = 58 + 5 * Math.sin(this.elapsed * 3.4)
    this.heroLamp.setPosition(this.player.x, this.player.y - 6)
      .setDisplaySize(lampR * 2, lampR * 2)
      .setAlpha(0.34 + 0.08 * Math.sin(this.elapsed * 3.4))
    // 轮廓光跟着玩家的体型走：横向略宽、纵向略高，符合人形比例。
    // 固定尺寸会出现"人很大但圈很小"或者反过来，边缘对不上身体。
    this.heroEdge.setPosition(this.player.x, this.player.y - 6)
      .setDisplaySize(lampR * 1.5, lampR * 1.85)
      .setAlpha(0.6 + 0.2 * Math.sin(this.elapsed * 3.4))
    // 指示环轻微呼吸，让静止时也能一眼定位自己
    const ringPulse = 0.78 + 0.2 * Math.sin(this.elapsed * 3.4)
    this.playerHalo.setPosition(this.player.x, this.player.y + 30)
      .setAlpha(0.42 + 0.1 * Math.sin(this.elapsed * 3.4))
    this.ring.setPosition(this.player.x, this.player.y + 30)
      .setAlpha(ringPulse)
      .setDisplaySize(64 + 4 * Math.sin(this.elapsed * 3.4), 26)
    this.castAnim = Math.max(0, this.castAnim - delta * 0.0045)
    this.aimLock = Math.max(0, this.aimLock - delta)

    if (this.moving) {
      this.walkAnimT += delta
      this.dustTimer -= delta
      if (this.dustTimer <= 0) {
        this.dustTimer = 190
        this.footDust()
      }
    } else {
      this.walkAnimT = 0
    }

    // ---- 本帧朝向：施法锁优先（开火瞬间锁向目标，避免"朝左却向右挥"）----
    const casting = this.aimLock > 0
    const dir: PxDir = casting ? this.aimDir : this.facing
    const right = casting ? this.aimFacing > 0 : this.faceRight

    // ---- 本帧动作与帧号 ----
    let act: PxAct = 'idle'
    let f = Math.floor(this.elapsed * 2) % 2
    if (casting && this.castAnim > 0.01) {
      // 三段式：蓄力 -> 出手 -> 收势。出手帧停留久一点，读得出"打出去了"
      act = 'attack'
      const p = 1 - this.castAnim
      f = p < 0.25 ? 0 : p < 0.62 ? 1 : 2
    } else if (this.moving) {
      act = 'walk'
      f = Math.floor(this.walkAnimT / 110) % 4
    }

    this.heroImg.setFrame(pxFrame(dir, act, f))
    // 侧面帧按"朝右"绘制，朝左时水平翻转；正面/背身左右对称，不翻
    this.heroImg.setFlipX(dir === 'side' && !right)

    // ---- 开火后坐：整体沿枪口反方向轻退（取整，保持像素网格对齐）----
    let ox = 0
    let oy = 0
    if (this.castAnim > 0.01) {
      const p = 1 - this.castAnim
      const e = p < 0.18
        ? Phaser.Math.SmoothStep(p / 0.18, 0, 1)
        : 1 - Phaser.Math.SmoothStep((p - 0.18) / 0.82, 0, 1)
      ox = -Math.cos(this.fireAngle) * 3 * e
      oy = -Math.sin(this.fireAngle) * 2 * e
    }
    this.heroImg.x = Math.round(ox)
    this.heroImg.y = Math.round(oy)
  }

  private footDust() {
    for (let i = 0; i < 2; i++) {
      const d = this.add.image(
        this.player.x + Phaser.Math.FloatBetween(-9, 9),
        this.player.y + 22 + Phaser.Math.FloatBetween(-3, 3),
        'dot'
      ).setTint(0x9aa0b5).setAlpha(0.5).setScale(Phaser.Math.FloatBetween(0.12, 0.26)).setDepth(1)
      this.tweens.add({
        targets: d,
        y: d.y - Phaser.Math.FloatBetween(8, 18),
        alpha: 0,
        scale: d.scale * 1.8,
        duration: Phaser.Math.Between(280, 420),
        onComplete: () => d.destroy()
      })
    }
  }

  // ---------- 武器 ----------
  private tickWeapons(delta: number) {
    for (const w of this.weapons) {
      if (w.def.kind === 'orbit') continue
      w.cd -= delta
      if (w.cd > 0) continue
      w.cd = w.def.cooldown * this.fireCdScale / this.buffAtk
      const target = this.nearestEnemy()
      // 扣光放在**这里**而不是各 fireXxx 内部：
      // 四种武器（gun/beam/aura）共用这一个入口，将来加新武器也不会漏。
      // 扣的是 w.def.damage —— 于是「高伤武器更费光」自动成立，
      // 不需要给每把武器单独配一张耗光表（那种表一定会和伤害表对不上）。
      this.spendLight(w.def.damage)
      if (w.def.kind === 'gun') this.fireGun(w.def, target)
      else if (w.def.kind === 'beam') this.fireBeam(w.def, target)
      else if (w.def.kind === 'aura') this.fireAura(w.def)
    }
  }

  /**
   * 兵种相克：武器 vs 敌人护甲 的伤害倍率。
   *
   * 这是本作对抗"换皮"质疑的核心机制 —— 敌潮的护甲构成会随时间变化
   * （早期轻甲 → 中期骑甲 → 后期重甲），玩家必须换武器应对，
   * 而不是像通用幸存者那样无脑堆 dmg%。表在 gameData.ts 的 WEAPONS[].vs。
   */
  private armorMul(vs: Partial<Record<Armor, number>> | undefined, e: Phaser.Physics.Arcade.Image) {
    let m = 1
    if (vs) {
      // 默认按胶质算：`gel` 是唯一"没有硬边护甲"的类型，也是最常见的杂兵。
      // 不设默认值会返回 1（无加成无惩罚），那等于杂兵白送 20% 伤害。
      const a = (e.getData('armor') as Armor) || 'gel'
      m = vs[a] ?? 1
    }
    // 骨甲近卫顶盾：非重击武器（vs.cal < 1.3）打它只有 70% 伤害。
    // 这是"盾阵必须用重武器破"这条战术的直接落点—— 方圆阵/鱼鳞阵的前排
    // 就是靠这个把"只能绕后"变成"该换武器了"。
    if (e.getData('guard') && (vs?.cal ?? 1) < 1.3) m *= 0.7
    return m
  }

  /** 相克反馈：克制放大飘字并标"克"，被克缩小并压暗，让玩家一眼学会看兵种。 */
  private damageLabel(mul: number) {
    if (mul >= 1.3) return { text: '#ffd93d', scale: 1.22, tag: '克' }
    if (mul >= 1.1) return { text: '#ffe9a8', scale: 1.05, tag: '' }
    if (mul <= 0.8) return { text: '#8b93a7', scale: 0.84, tag: '被克' }
    return null
  }

  /**
   * 武器 → 弹体贴图。
   *
   * 用**形状**区分弹种，而不是只靠颜色。旧版全部共用一张 tracer，
   * 玩家看到的永远是一根白线，分不出短弓的箭、连弩的矢、铁蒺藜的钉。
   * 形状在满屏弹幕里比颜色可靠得多 —— 一眼能认出"这是哪把武器在打"。
   */
  private bulletTex(w: WeaponDef): string {
    switch (w.id) {
      case 'bow': return 'b_arrow'
      case 'crossbow': return 'b_bolt'
      case 'caltrop': return 'b_spike'
      case 'heavybow': return 'b_greatarrow'
      case 'spear': return 'b_spear'
      default: return 'tracer'
    }
  }

  private fireGun(w: WeaponDef, target: Phaser.Physics.Arcade.Image | null) {
    const px = this.player.x
    const py = this.player.y
    const base = target ? Phaser.Math.Angle.Between(px, py, target.x, target.y) : -Math.PI / 2
    this.fireAngle = base
    // 瞄准即转身：开火瞬间把朝向锁到目标方向，施法期间保持不变
    this.lockAim(base)
    this.castAnim = 1
    // 出弹点 = 武器口（侧身时是贴图里枪/刀/矛的真实前端），不再从角色中心冒出来
    const mz = this.muzzlePoint(base)
    this.muzzleFlash(mz.x, mz.y, w.color, base)
    // 这里刻意**不震屏**：手枪 450ms、冲锋枪 140ms 一发，逐发震屏等于屏幕一直在抖，
    // 而且 Phaser 的 shake 会连 scrollFactor=0 的 HUD 一起晃。后坐力交给角色位移表达。

    const tex = this.bulletTex(w)
    for (let i = 0; i < w.count; i++) {
      const a = base + (i - (w.count - 1) / 2) * (w.spread || 0)
      const b = this.bullets.get(mz.x, mz.y, tex) as Phaser.Physics.Arcade.Image | null
      if (!b) continue
      // **必须显式 setTexture**：Group.get(x,y,key) 只在"新建实例"时才用 key，
      // 回收复用的实例会被直接返回、key 被忽略（和敌人那边同一个坑）。
      // 少了这一行，弹体的外观就取决于池子里撞到哪个旧实例 ——
      // 弓箭手可能射出一发"铁蒺藜"，玩家没法靠轮廓认武器。
      b.setTexture(tex)
      const vx = Math.cos(a) * w.speed
      const vy = Math.sin(a) * w.speed
      this.tweens.killTweensOf(b)
      b.setActive(true).setVisible(true).setTint(w.color)
      b.setBlendMode(Phaser.BlendModes.ADD)
      b.setRotation(a)
      b.setAlpha(1)
      // 出膛瞬间沿飞行方向拉长再回弹 —— 「这一发有速度」的关键帧
      b.setScale(1.35 * FX_SCALE, 0.82 * FX_SCALE)
      this.tweens.add({
        targets: b, scaleX: FX_SCALE, scaleY: FX_SCALE,
        duration: 95, ease: 'Quad.easeOut'
      })
      const body = b.body as Phaser.Physics.Arcade.Body
      body.setSize(24, 6, true)
      body.setVelocity(vx, vy)
      // buffDmg = 背水一战的临时攻击倍率。放在赋值处而不是各武器内部，
      // 保证四条伤害路径（子弹/环绕/光束/光环）一致地吃到增益。
      b.setData('dmg', w.damage * this.dmgScale * this.buffDmg)
      b.setData('pierce', w.pierce + this.pierceBonus)
      b.setData('hit', new Set())
      b.setData('col', w.color)
      // 相克表随弹携带：命中时才知道打的是什么护甲，倍率在那时才算
      b.setData('vs', w.vs)
    }

    // 出膛曳光：一条从枪口沿弹道射出的短光带，向前疾走并淡出。
    // 连射武器（连弩 140ms/发）会把它连成一条"火线"，不用看弹体也能读出弹道方向。
    const tm = this.add.image(mz.x + Math.cos(base) * 20, mz.y + Math.sin(base) * 20, 'tracer')
      .setTint(w.color).setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(base).setDepth(49).setScale(1.7 * FX_SCALE, 0.85 * FX_SCALE)
    this.tweens.add({
      targets: tm, alpha: 0, scaleX: 2.8 * FX_SCALE, duration: 120,
      onComplete: () => tm.destroy()
    })
  }

  /**
   * 子弹视觉（三层）。
   *
   * 没有拖尾时，高速弹体在 60fps 下只是几个互不相关的孤立光点 ——
   * 玩家读不出"它从哪来、往哪去"，主观感受就是"子弹很平淡"。
   *
   * 这次的关键是**分层**：光晕（大而软）+ 光带（细而长）+ 弹体（亮核）。
   * 旧版只有中间那一条光带，满屏弹幕看起来是一堆细线；
   * 补上外圈光晕之后，每颗弹才像"裹着一团自己的颜色"在飞 ——
   * 而这也正是辉光管线最能吃到的形状（大块柔和亮面才铺得开光晕）。
   */
  private driveBullets() {
    const kids = this.bullets.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const b of kids) {
      const tail = b.getData('tail') as Phaser.GameObjects.Image | undefined
      const halo = b.getData('halo') as Phaser.GameObjects.Image | undefined
      if (!b.active) {
        // 子弹被回收/命中销毁：拖尾与光晕必须跟着消失，
        // 否则会在原地留下一串幽灵光点
        if (tail) tail.setVisible(false)
        if (halo) halo.setVisible(false)
        continue
      }
      const body = b.body as Phaser.Physics.Arcade.Body
      const vx = body.velocity.x
      const vy = body.velocity.y
      const sp = Math.hypot(vx, vy) || 1
      const col = (b.getData('col') as number) || 0xffffff

      let t = tail
      if (!t) {
        t = this.add.image(b.x, b.y, 'tracer')
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(48)
        b.setData('tail', t)
      }
      let h = halo
      if (!h) {
        h = this.add.image(b.x, b.y, 'glow')
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(47)
        b.setData('halo', h)
      }
      // 光晕压在弹体正中。圆形贴图转了看不出来，所以不跟弹道旋转。
      // alpha 压在 0.26：它只负责"这发弹自带一团颜色"，
      // 再高就会盖住弹体本身的形状（形状才是分武器的第一读法）。
      h.setVisible(true)
        .setPosition(b.x, b.y).setTint(col)
        .setAlpha(0.26).setScale(0.55 * FX_SCALE)
      // 光带贴在弹体后方（沿速度反方向偏移），随弹道旋转
      const off = 16
      t.setVisible(true)
        .setPosition(b.x - (vx / sp) * off, b.y - (vy / sp) * off)
        .setRotation(Math.atan2(vy, vx))
        .setTint(col)
        .setAlpha(0.42).setScale(1.55 * FX_SCALE, 0.46 * FX_SCALE)
    }
  }

  // 开火瞬间锁定朝向：朝哪打就朝哪转身，并在整个施法动作期间保持不抖。
  // 水平方向用侧面图（图里角色本来就是平举武器的姿势，天然就是"出手"姿态），
  // 偏垂直时退回背身/正面，避免"朝上打却摆出侧身"的违和。
  private lockAim(angle: number) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    this.aimFacing = dx >= 0 ? 1 : -1
    if (Math.abs(dx) >= 0.45) this.aimDir = 'side'
    else this.aimDir = dy < 0 ? 'up' : 'down'
    // 略长于常见武器冷却：否则两发之间的空档朝向会闪回移动方向，看起来像抽搐
    this.aimLock = 500
  }

  // 当前朝向下的「武器口」世界坐标，子弹与枪口火光都从这里发出。
  // 侧面取生成器算好的武器前端（manifest.muzzle.side，单位是逻辑像素）；
  // 正面/背身没有"指向前方"的武器姿态，就从身体中上部朝目标偏出。
  private muzzlePoint(angle: number): { x: number; y: number } {
    const casting = this.aimLock > 0
    const dir: PxDir = casting ? this.aimDir : this.facing
    const right = casting ? this.aimFacing > 0 : this.faceRight
    const unit = 'hero_' + this.activeChar.id
    const mz = PX_UNITS[unit]?.muzzle?.side
    if (dir === 'side' && mz) {
      const s = pxScale(unit)
      return {
        x: this.player.x + mz[0] * s * (right ? 1 : -1),
        y: this.player.y + mz[1] * s
      }
    }
    return {
      x: this.player.x + Math.cos(angle) * 12,
      y: this.player.y - 4 + Math.sin(angle) * 8
    }
  }

  // 枪口火光：小而亮的十字星，沿枪管方向略作随机（坐标由 muzzlePoint 给出）。
  // 旧版是拿 48px 的径向 glow 放大到 40~58px 再加色叠加 —— 高射速下屏幕上会同时
  // 挂着好几个黄色大椭圆，看着像荷包蛋，也盖掉了角色本身。
  private muzzleFlash(x: number, y: number, color: number, angle = 0) {
    const f = this.add.image(x, y, 'flash')
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(angle + Phaser.Math.FloatBetween(-0.25, 0.25))
      .setScale(0.5)
      .setDepth(60)
    this.tweens.add({
      targets: f, scale: 1.05, alpha: 0, duration: 90,
      ease: 'Quad.easeOut', onComplete: () => f.destroy()
    })
    for (let i = 0; i < 2; i++) {
      const a = angle + Phaser.Math.FloatBetween(-0.55, 0.55)
      const d = Phaser.Math.FloatBetween(12, 28)
      const s = this.add.image(x, y, 'dot')
        .setTint(color).setBlendMode(Phaser.BlendModes.ADD)
        .setScale(Phaser.Math.FloatBetween(0.08, 0.18)).setDepth(59)
      this.tweens.add({
        targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        alpha: 0, duration: 110, onComplete: () => s.destroy()
      })
    }
    // 粒子上量。上面那两颗锥形点负责**方向**（tween 能精确沿弹道铺开，
    // 粒子做不到锥形），粒子负责**量** —— 旧版总共就这 2 颗小圆点，
    // 在满屏弹幕里等于看不见，所以"开火"这件事完全没有存在感。
    const mx = x + Math.cos(angle) * 12
    const my = y + Math.sin(angle) * 12
    this.pSpark.setParticleTint(color)
    this.pSpark.emitParticleAt(mx, my, 7)
    this.pSmoke.emitParticleAt(mx, my, 2)
  }

  /**
   * 命中火花。
   *
   * 旧版是"循环 new 一段 image，再给它挂一个 tween 飞出去、到点 destroy" ——
   * 每次命中都在**创建对象**（贴图实例 + tween 条目），件数一多就散，
   * 而且 tween 的时间曲线是线性的，读起来像小圆点匀速平移。
   * 现在走粒子发射器：对象池复用、零分配、寿命/速度/缩放各自有曲线，
   * 数量可以放心开到两倍，观感从"几个点"变成"一蓬火星"。
   */
  private spark(x: number, y: number, color: number, n = 3) {
    this.pSpark.setParticleTint(color)
    this.pSpark.emitParticleAt(x, y, Math.max(2, n * 2))
    // 再补几颗慢速余烬：只有快速火星的话，"啪"一下就没，缺少余韵
    this.pEmber.setParticleTint(color)
    this.pEmber.emitParticleAt(x, y, n)
  }

  private shake(dur: number, intensity: number) {
    this.cameras.main.shake(dur, intensity, false)
  }

  /** 受伤时的全屏红闪。震屏只在画面中心晃，红闪覆盖整个视野，
   *  在被围住手忙脚乱时，"我掉血了"这件事必须是无条件可感知的。 */
  private redFlash() {
    // 受击警示：**边缘暗红渐隐** + 极淡整屏微红。
    //
    // 旧版是一个 depth 86 的全屏矩形，0xff2b2b / alpha 0.3 / 230ms 渐隐。
    // 在暖色场地里只是"闪一下"，换成深海深水色之后它变成**整屏红罩** ——
    // 实机截图里被抓拍到的那一帧就是：满屏 (85,36,41) 的暗红，
    // 水母、玩家、HUD 边框全部偏红，画面完全不可读。
    //
    // 还有一个更糟的叠加效应：无敌帧 700ms，被围住时每 0.7 秒触发一次，
    // 于是这层红实际上**持续挂着**，玩家在密集期几乎看不见自己的角色。
    //
    // 现在复用现成的 vignette 贴图（见 makeTextures：中心 alpha 为 0、
    // 四周按平方衰减），染红后就是一圈边缘渐隐的红边 ——
    // 人眼对视野边缘的亮度变化最敏感，所以"我挨打了"照样一眼可感，
    // 但画面中心永远读得出来。整屏微红只留 alpha 0.1 / 160ms 的那一瞬。
    const w = this.scale.width
    const h = this.scale.height
    if (this.textures.exists('vignette')) {
      const edge = this.add.image(w / 2, h / 2, 'vignette')
        .setDisplaySize(w, h).setTint(0xd01830)
        .setAlpha(0.75).setScrollFactor(0).setDepth(86)
      this.tweens.add({
        targets: edge, alpha: 0, duration: 300,
        onComplete: () => edge.destroy()
      })
    }
    const veil = this.add.rectangle(0, 0, w, h, 0xff2b2b, 0.1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(86)
    this.tweens.add({
      targets: veil, alpha: 0, duration: 160,
      onComplete: () => veil.destroy()
    })
  }

  private fireBeam(w: WeaponDef, target: Phaser.Physics.Arcade.Image | null) {
    const px = this.player.x
    const py = this.player.y
    const ang = target ? Phaser.Math.Angle.Between(px, py, target.x, target.y) : -Math.PI / 2
    this.fireAngle = ang
    this.lockAim(ang)
    this.castAnim = 1
    // 光束同样从武器口起，而不是角色中心
    const mz = this.muzzlePoint(ang)
    const ex = mz.x + Math.cos(ang) * w.range
    const ey = mz.y + Math.sin(ang) * w.range

    // 外层辉光 + 内层高亮核心
    for (const [wdt, alp] of [[14, 0.28], [6, 0.9]] as [number, number][]) {
      const g = this.add.graphics().setDepth(50).setBlendMode(Phaser.BlendModes.ADD)
      g.lineStyle(wdt, w.color, alp)
      g.beginPath(); g.moveTo(mz.x, mz.y); g.lineTo(ex, ey); g.strokePath()
      this.time.delayedCall(130, () => g.destroy())
    }
    this.muzzleFlash(mz.x, mz.y, w.color, ang)
    this.impactRing(ex, ey, w.color, 64)
    this.shake(80, 0.0022)

    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      if (this.distToSegment(e.x, e.y, mz.x, mz.y, ex, ey) < 26) {
        const mul = this.armorMul(w.vs, e)
        const dmg = w.damage * this.dmgScale * this.buffDmg * mul
        const hp = ((e.getData('hp') as number) || 0) - dmg
        const lab = this.damageLabel(mul)
        this.popDamage(e.x, e.y, dmg, lab?.text ?? '#7ef0c0', false, lab?.scale ?? 1, lab?.tag ?? '')
        if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
        this.spark(e.x, e.y, w.color, 2)
        // 近战命中：补一道月牙斩击弧 —— 和远程的"点命中"在轮廓上分开，
        // 也让探照灯束这道强光每次命中都有分量。
        this.slashArc(e.x, e.y, ang, w.color)
      }
    }
  }

  private fireAura(w: WeaponDef) {
    const px = this.player.x
    const py = this.player.y
    // 光环是自身范围技，不锁定朝向；前冲方向沿用当前面向，避免"朝上冲一下"的突兀感
    this.castAnim = Math.max(this.castAnim, 0.55)
    this.fireAngle = this.faceRight ? 0 : Math.PI
    const g = this.add.graphics().setDepth(40).setBlendMode(Phaser.BlendModes.ADD)
    g.fillStyle(w.color, 0.16); g.fillCircle(px, py, w.radius)
    g.lineStyle(3, w.color, 0.7); g.strokeCircle(px, py, w.radius)
    this.time.delayedCall(200, () => g.destroy())
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      if (Phaser.Math.Distance.Between(px, py, e.x, e.y) <= w.radius) {
        const mul = this.armorMul(w.vs, e)
        const dmg = w.damage * this.dmgScale * this.buffDmg * mul
        const hp = ((e.getData('hp') as number) || 0) - dmg
        const lab = this.damageLabel(mul)
        this.popDamage(e.x, e.y, dmg, lab?.text ?? '#ffb347', false, lab?.scale ?? 1, lab?.tag ?? '')
        if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
      }
    }
  }

  private createOrbits(def: WeaponDef) {
    for (let i = 0; i < def.count; i++) {
      const o = this.orbits.get(this.player.x, this.player.y, 'b_knife') as Phaser.Physics.Arcade.Image | null
      if (!o) continue
      // 同样必须显式 setTexture（复用实例会忽略 get 的 key）
      o.setTexture('b_knife')
      o.setActive(true).setVisible(true).setTint(def.color)
      // 尺寸按刀刃贴图（22x8）而不是原来 16px 的圆点重算
      o.setScale(Math.max(0.9, def.radius / 70))
      o.setBlendMode(Phaser.BlendModes.ADD)
      o.setAlpha(1)
      ;(o.body as Phaser.Physics.Arcade.Body).setCircle(8)
      o.setData('dmg', def.damage * this.dmgScale * this.buffDmg)
      o.setData('vs', def.vs)
      o.setData('cd', 0)
      o.setData('off', (Math.PI * 2 / def.count) * i)
      o.setData('radius', def.radius)
    }
  }

  private driveOrbits(delta: number) {
    this.orbitAngle += 2.2 * (delta / 1000)
    const kids = this.orbits.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const o of kids) {
      if (!o.active) continue
      // 环绕球的伤害每帧重算：dmgScale / buffDmg 会在升级与计谋中变化，
      // 只在创建时赋一次，会让「拿到飞刀之后再点伤害升级」完全不生效。
      const ow = this.weapons.find((x) => x.def.kind === 'orbit')
      if (ow) o.setData('dmg', ow.def.damage * this.dmgScale * this.buffDmg)
      const off = o.getData('off') as number
      const radius = o.getData('radius') as number
      const a = off + this.orbitAngle
      o.x = this.player.x + Math.cos(a) * radius
      o.y = this.player.y + Math.sin(a) * radius
      // 刀刃沿**切线**方向：它是"在环绕着割"，不是"自转的光点"。
      // 切线 = 半径方向 + 90°；朝左时贴图自然翻过来。
      o.setRotation(a + Math.PI / 2)
      let cd = (o.getData('cd') as number) - delta
      if (cd < 0) cd = 0
      o.setData('cd', cd)
    }
  }

  // ---------- 敌人 ----------
  private nearestEnemy(): Phaser.Physics.Arcade.Image | null {
    let best: Phaser.Physics.Arcade.Image | null = null
    let bd = Infinity
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y)
      if (d < bd) { bd = d; best = e }
    }
    return best
  }

  /** 当前波次强度阶段（只决定"刷多快 / 多大比例是阵型"，不决定出什么怪） */
  private waveIndex() {
    let idx = 0
    for (let i = 0; i < WAVE_RAMP.length; i++) {
      if (this.elapsed >= WAVE_RAMP[i].startSec) idx = i
    }
    return idx
  }

  /** 波号 → 强度阶段下标（商店的敌情卡要预告"下一波"会用哪个阵型）。 */
  private waveIndexOf(wave: number): number {
    const t = Math.max(0, (wave - 1) * BALANCE.waveSec)
    let idx = 0
    for (let i = 0; i < WAVE_RAMP.length; i++) {
      if (t >= WAVE_RAMP[i].startSec) idx = i
    }
    return idx
  }

  private currentWave() {
    return WAVE_RAMP[this.waveIndex()]
  }

  /**
   * 章节播报：开局把「这是谁在打你、该用什么克」一次说清。
   *
   * 相克系统有一个致命前提 —— **它必须可读，否则等于不存在**。
   * 玩家不会去读策划案里的倍率表，唯一的教学入口就是这里：
   * 报出主势力的兵种与护甲，并点名一件克制它的武器。
   * 三章之后玩家自己就会在升级时主动挑克制武器了。
   */
  private announceChapter() {
    const f = this.faction
    const topId = Object.entries(f.roster).sort((a, b) => b[1] - a[1])[0][0]
    const def = enemyById(topId)
    const counter = WEAPONS.find((w) => (w.vs?.[def.armor] ?? 1) >= 1.3)
    this.toast(`第${this.chapter.index}章 · ${this.chapter.name}　${f.name}军 · ${f.trait}`)
    this.time.delayedCall(2600, () => {
      if (this.over) return
      this.toast(counter
        ? `${f.name}·${def.name}（${ARMOR_NAMES[def.armor]}）　→　${counter.name} 可克　·　按 Q/E 施计`
        : `${f.name}·${def.name}（${ARMOR_NAMES[def.armor]}）　·　按 Q/E 施计`)
    })
  }

  /**
   * 波次播报：每进入新强度阶段，提示"接下来会上阵型了"。
   * 阵型是这一版最核心的变化，玩家必须知道它出现了 —— 否则只会觉得"怪忽然变多了"。
   */
  private announceWave(idx: number) {
    const w = WAVE_RAMP[idx]
    if (!w || w.formationChance <= 0) return
    const pool = this.formationsFor(idx)
    const f = formationById(pool[Math.min(pool.length - 1, Math.floor(idx / 2))])
    this.toast(`${this.faction.name}军变阵：${f.name}阵　（${f.desc}）　→　${f.counter}`)
  }

  /** 当前波次阶段可用的阵型池：章节阵型按波次逐段解锁，后期才上最硬的阵 */
  private formationsFor(idx: number): string[] {
    const pool = this.chapter.formations
    const n = Math.max(1, Math.min(pool.length, 1 + Math.floor(idx / 2)))
    return pool.slice(0, n)
  }

  private pickWeighted(w: Record<string, number>): string {
    let total = 0
    for (const k in w) total += w[k]
    let r = Math.random() * total
    for (const k in w) { r -= w[k]; if (r <= 0) return k }
    return Object.keys(w)[0]
  }

  /**
   * 阵型刷怪 —— 本轮最关键的创新。
   *
   * 现状问题：敌人是"随机撒在屏幕外一圈"，所以任何时刻看到的都是一团没有形状的点。
   * 改法：以**阵型**为单位整组生成，一组 6~12 人，按槽位表落位。
   *
   * 所有幸存者类都在做"密度"，没人做"**阵型**"。而阵型是战争题材里最容易被记住的
   * 视觉记忆 —— 玩家一眼能认出、一句话能说出。
   *
   * 关键设计：阵型只提供**骨架**（槽位 + role + 行为），
   * **具体兵种由当前势力的 roles 表填**。所以同一个"锋矢阵"，
   * 黄巾填出来是杂兵人海、西凉填出来是铁骑冲锋、魏填出来是盾甲精锐 ——
   * 一张阵型表 × 六张势力表 = 大量组合，**零美术成本**。
   */
  private spawnFormation() {
    const pool = this.formationsFor(this.waveIdx)
    const f = formationById(Phaser.Utils.Array.GetRandom(pool) as string)
    this.formationLog.push(f.id)

    // 阵心放在**屏幕外**（按对角线半径 + 阵型自身展宽），保证不会凭空出现在画面里。
    // 旧的固定半径 420 在这个窗口下同时犯了两个错：水平 420 < 半宽 472（左右两侧
    // 直接在画面里冒出来），垂直 420 > 半高 324（上下两侧要走很久才进场）。
    const spread = Math.max(...f.slots.map((s) => Math.abs(s.dx)))
    const vh = this.viewHalf()
    const r = Math.hypot(vh.hw, vh.hh) + 90 + spread
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const ax = this.player.x + Math.cos(ang) * r
    const ay = this.player.y + Math.sin(ang) * r
    // 阵型的局部坐标：dx = 侧向，dy = 纵深（沿"玩家 → 阵心"方向向外）
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    const px2 = -uy
    const py2 = ux

    const pts: { x: number; y: number }[] = []
    for (const slot of f.slots) {
      // 蜂拥阵刻意加抖动：太整齐就不像"蜂拥"了
      const jitter = f.id === 'swarm' ? 20 : 4
      const jx = Phaser.Math.FloatBetween(-jitter, jitter)
      const jy = Phaser.Math.FloatBetween(-jitter, jitter)
      const sx = ax + px2 * (slot.dx + jx) + ux * (slot.dy + jy)
      const sy = ay + py2 * (slot.dx + jx) + uy * (slot.dy + jy)
      const def = enemyById(this.faction.roles[slot.role])
      const e = this.spawnEnemy(def, false, sx, sy)
      if (!e) continue
      e.setData('behavior', f.behavior)
      // hold / fireline：站位半径定在玩家武器射程的边缘（230~280），
      // 逼玩家主动冲进危险区才能清掉 —— 否则"敌人不进攻"会让游戏变简单。
      e.setData('holdR', f.behavior === 'hold' ? 230 : f.behavior === 'fireline' ? 280 : 0)
      e.setData('fgt', f.id)
      pts.push({ x: sx, y: sy })
    }

    // 地面阵型轮廓：从阵心向每个槽位拉一条放射线 —— 战阵本来就是
    // 一张图，把它画在地上，玩家追过去时能亲眼看见"这是一个阵"而不是一堆散兵。
    if (pts.length > 1) {
      const gg = this.add.graphics().setDepth(-5).setBlendMode(Phaser.BlendModes.ADD)
      const rad = Math.max(...pts.map((p) => Math.hypot(p.x - ax, p.y - ay)))
      gg.lineStyle(3, this.faction.color, 0.4)
      for (const p of pts) gg.lineBetween(ax, ay, p.x, p.y)
      gg.lineStyle(2, this.faction.color, 0.26)
      gg.strokeCircle(ax, ay, rad + 26)
      this.tweens.add({
        targets: gg, alpha: 0, delay: 1500, duration: 800,
        onComplete: () => gg.destroy()
      })
    }

    this.formationBanner(f, ang)
  }

  /**
   * 阵型进场播报。
   *
   * 阵型是「看不见就等于不存在」的东西。敌人还没进画面，玩家必须先知道
   * **哪边、什么阵、怎么破** —— 否则 charge / hold / encircle 这些行为差异
   * 只会被感受成"这批怪有点怪"，而不是"西凉在冲我的侧翼"。
   * 所以给两件事：顶部横幅（势力色 + 阵型名 + 破法）与屏幕**边缘**的方向箭头。
   */
  private formationBanner(f: FormationDef, ang: number) {
    const w = this.scale.width
    const h = this.scale.height
    const col = this.faction.color
    const k = this.hudK

    // 横幅底衬：不加的话阵型名直接压在战场装饰上，读起来像"漏在画面外的文字"
    const bg = this.add.rectangle(w / 2, Math.round(82 * k), Math.round(330 * k),
      Math.round(58 * k), UI.ink1, 0.88)
      .setScrollFactor(0).setDepth(415).setAlpha(0)
      .setStrokeStyle(1, col, 0.85)
    const t1 = this.add.text(w / 2, Math.round(70 * k), `${this.faction.name}军 · ${f.name}阵`, {
      fontSize: `${Math.max(14, Math.round(19 * k))}px`, color: TXT.main,
      stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(416).setAlpha(0)
    const t2 = this.add.text(w / 2, Math.round(93 * k), `破法：${f.counter}`, {
      fontSize: `${Math.max(12, Math.round(13 * k))}px`, color: TXT.gold,
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(416).setAlpha(0)
    const ln = this.add.rectangle(w / 2, Math.round(57 * k), Math.round(190 * k), 3, col, 0.9)
      .setScrollFactor(0).setDepth(416).setAlpha(0)

    for (const o of [bg, t1, t2, ln] as Phaser.GameObjects.GameObject[]) {
      this.tweens.add({ targets: o, alpha: 1, duration: 150 })
      this.tweens.add({
        targets: o, alpha: 0, delay: 1750, duration: 450,
        onComplete: () => o.destroy()
      })
    }

    // 屏幕边缘的方向指示：把"这一阵从哪压上来"指出来。
    // 用与准星/破法同色（势力色）的箭头，和横幅是同一条信息。
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    const tx = Math.abs(dx) < 1e-6 ? Infinity : (w / 2 - 46) / Math.abs(dx)
    const ty = Math.abs(dy) < 1e-6 ? Infinity : (h / 2 - 46) / Math.abs(dy)
    const tt = Math.min(tx, ty)
    const arrow = this.add.image(w / 2 + dx * tt, h / 2 + dy * tt, 'b_arrow')
      .setTint(col).setBlendMode(Phaser.BlendModes.ADD)
      .setRotation(ang).setScale(2.6).setScrollFactor(0).setDepth(415).setAlpha(0)
    this.tweens.add({ targets: arrow, alpha: 0.95, duration: 150 })
    this.tweens.add({
      targets: arrow,
      x: arrow.x + dx * 18, y: arrow.y + dy * 18,
      alpha: 0, duration: 1600, ease: 'Quad.easeOut',
      onComplete: () => arrow.destroy()
    })
  }

  private spawnDirector(delta: number) {
    // Boss 出场由**当前关卡**决定（StageDef.bossAt），不再是一张全局时间表 ——
    // 这是"章 = 一个 Boss"能成立的前提。
    const st = this.stage
    // Boss 在 bossWave（默认倒数第二波）出场 —— 波次制下按波号判定，不再用绝对秒数
    if (st.objective === 'boss' && st.bossId
      && this.wave >= (st.bossWave ?? st.waves) && !this.bossesSpawned.has(st.bossId)) {
      this.bossesSpawned.add(st.bossId)
      this.spawnEnemy(enemyById(st.bossId), true)
    }
    // 已通关或已判负：停止刷怪，让玩家体面地把残局收完
    if (this.objDone || this.objFailed) return

    const wi = this.waveIndex()
    if (wi !== this.waveIdx) {
      this.waveIdx = wi
      if (wi > 0) this.announceWave(wi)
    }
    this.spawnAccum += delta
    const w = this.currentWave()
    // 节奏随等级和时间一起收紧。
    // 两条曲线都是**标定出来的**，不是拍脑袋：短弓 450ms/发、12 伤，
    // 2 级杂兵 28 血 → 单杀 1.35s → 0.74 只/秒。刷怪一旦超过这个速率，
    // 玩家就必然被越堆越多，与操作无关。
    const base = Math.max(180, w.spawnInterval - this.level * 9 - this.elapsed * 0.4)
    // 反雪崩节流：场上敌人越多，刷怪越慢。
    // 这是幸存者类**必须有**的负反馈。没有它时会形成死亡螺旋 ——
    // 玩家一被压制就杀不动，杀不动就堆得更多。节流保证「劣势」是压力而不是死刑。
    //
    // ⚠️ 上限必须**随玩家强度浮动**，不能写死。
    // 上一版写死 SOFT_CAP=120 / 每档 4 只，实测开局 34.8 秒就堆到 87 只 ——
    // 而 87 只是第 5 波（225 秒）的终局量，被提前到第 1 波，玩家直接被埋。
    // 根因是**密度上限与玩家输出脱钩**：2 级玩家输出约 5 只/秒，12 级玩家十几只/秒，
    // 却共用一个天花板。写死的 120 对 2 级是送葬，对 12 级是没人够得着的空话。
    //
    // 现在的做法：cap = 30 + 等级 × 8（10 级 ≈ 110，逼近品类基准下沿）。
    // 这样「能扛多少怪」跟着「能杀多快」一起长，前期不会被拖死，
    // 后期才有本钱去接 80-150 的弹幕。
    const cap = Math.min(130, 30 + this.level * 8)
    const throttleFrom = cap * 0.65
    const alive = this.enemies.countActive(true)
    const throttle = Phaser.Math.Clamp(
      1 - (alive - throttleFrom) / (cap - throttleFrom), 0.35, 1)
    const interval = base / throttle
    if (this.spawnAccum < interval) return
    // 用减法推进累加器而不是清零：掉一帧不会整段丢掉刷怪节拍
    this.spawnAccum -= interval

    // 阵型 vs 散兵：比例由波次阶段给定。
    // 开局先给散兵热身，再让成建制的阵型压上来 —— 一上来就鱼鳞阵会把新手按死。
    if (Math.random() < w.formationChance) {
      this.spawnFormation()
    } else {
      // 每档 3 只：这个数字是**算出来的，不是试出来的**。
      // 平衡条件是「节流触底时的入场速率仍略高于玩家清除速率」——
      // 触底速率 = (base/0.35) ÷ 1000 × 3，base 最小 180ms 时约 1.54 只/秒，
      // 略高于实测的玩家清除速率（约 1.4 只/秒），
      // 于是密度能缓慢爬升又不会失控。
      // 试过 4 只：触底速率 2.1 只/秒，远高于清除速率，
      // 实测第 1 波 34 秒就堆到 87 只把玩家埋掉 —— 那是终局的量。
      // 也试过 2 只：触底速率 1.0 只/秒，**低于**清除速率，
      // 密度被钉死在 10 只左右，满屏空荡荡，弹幕压迫感彻底没了。
      // 3 只是唯一让「密度可控爬升」的档位。
      for (let i = 0; i < 3; i++) {
        this.spawnEnemy(enemyById(this.pickWeighted(this.faction.roster)), false)
      }
    }
  }

  /**
   * 生成一只敌人。
   *
   * `ox/oy` 可选：**阵型生成时必须传入具体坐标**（按槽位落位）；
   * 不传则退回"沿屏幕外一圈出生"的散兵逻辑。
   *
   * 返回值是敌人实例 —— 阵型生成需要往上面挂 behavior / holdR，
   * 所以这里不能再返回 void。
   */
  private spawnEnemy(def: EnemyDef, boss: boolean, ox?: number, oy?: number) {
    // 在「屏幕外一圈」出生，而不是固定半径 420 的圆上。
    // 固定半径在 944x649 的窗口里同时犯了两个错：420 小于水平半宽 472，
    // 于是左右两侧的怪直接在画面里凭空出现（pop-in）；420 又大于垂直半高 324，
    // 于是上下两侧的怪要走很远才进场。实测结果是"场上明明有 5~6 只，
    // 玩家在画面里只看得见 2~3 只" —— 主观感受就是地图很空。
    // 改成沿矩形周长出生后，每个方向都是刚好看不见的距离，进场时间一致。
    const pad = boss ? 150 : 70
    // 用**世界坐标**的可见半宽/半高（除以 zoom）而不是屏幕半宽：
    // zoom 之后屏幕能看到的范围变小了，继续用屏幕尺寸算会让敌人
    // 从画面外很远的地方生成，进场要等很久。
    const vh = this.viewHalf()
    const rx = vh.hw + pad
    const ry = vh.hh + pad
    const pw = rx * 2
    const ph = ry * 2
    let t = Math.random() * (pw * 2 + ph * 2)
    let x: number
    let y: number
    if (ox !== undefined && oy !== undefined) {
      x = ox
      y = oy
    } else if (t < pw) { x = this.player.x - rx + t; y = this.player.y - ry }
    else if ((t -= pw) < pw) { x = this.player.x + rx - t; y = this.player.y + ry }
    else if ((t -= pw) < ph) { x = this.player.x - rx; y = this.player.y - ry + t }
    else { t -= ph; x = this.player.x + rx; y = this.player.y + ry - t }
    // 像素单位：统一 2 倍显示（upscale=2 的 Boss 在逻辑网格里就画得更大），
    // 因此所有单位之间的像素块大小一致 —— 像素游戏的核心美学规则。
    const unit = 'foe_' + def.id
    const e = this.enemies.get(x, y, pxKey(unit)) as Phaser.Physics.Arcade.Image | null
    if (!e) return null
    const s = pxScale(unit)

    // 复用对象池的实例：必须彻底重置上一次的残留状态，否则会出现"出生的敌人是白色的"
    // （典型原因：上一条命被 setTintFill 闪白，回调未执行就被回收，tint 残留到下一次出生）
    e.setActive(true).setVisible(true).setScale(s)
    // **必须显式 setTexture。**
    // Phaser 的 Group.get(x, y, key) 只在"新建实例"时才用 key，回收复用的实例会被
    // 直接返回、key 被忽略（Group.js 官方注释原话："Unless a new member is created,
    // key, frame, and visible are ignored"）。于是场上怪物的外观取决于池子里撞到哪个
    // 旧实例，而不是波次权重抽出来的那个怪种 —— 一个 70 血、判定 25x32 的胖怪
    // 完全可能顶着虫群的小贴图出场，玩家没法靠剪影判断威胁等级。
    e.setTexture(pxKey(unit))
    e.setFrame(pxFrame('down', 'walk', 0))
    e.setAngle(0)
    e.setFlipX(false)
    e.clearTint()
    e.setData('baseScale', s)
    // 势力特性 + 关卡强度在这里落到**真实数值**上：
    // 黄巾 hpMul 0.72（人多而脆）、魏 hpMul 1.3（砍不动）、章节 spawnMul 逐关递增。
    // Boss 不吃势力的 hpMul（它本身就该是硬的），只吃关卡倍率。
    const hpBase = def.hp + this.level * 4
    e.setData('hp', hpBase * (boss ? 1 : this.faction.hpMul) * this.stage.spawnMul)
    e.setData('dmg', def.damage)
    e.setData('sp', def.speed * this.faction.speedMul)
    e.setData('isBoss', !!def.isBoss)
    // 名字必须写进实例数据：斩将播报是 `e.getData('bossName')`，
    // 少了这一行 toast 会变成光秃秃的「斩将！」—— 玩家看不到自己斩的是谁，
    // 而 Boss 战的全部意义就是这个"谁"。同一个 id 可能在不同关卡复用，
    // 所以每次出生都重设，不依赖上一次的残留。
    e.setData('bossName', def.bossName || def.name)
    e.setData('touchCd', 0)
    e.setData('shockCd', 4000)
    e.setData('col', def.color)
    // 兵种护甲 + 阵型行为 —— 都是相克/阵型判定的输入，对象池复用必须重设，
    // 否则上一个单位的护甲或阵型行为会残留到新单位身上。
    e.setData('armor', def.armor)
    e.setData('faction', def.faction)
    e.setData('guard', !!def.guard)
    e.setData('behavior', '')
    e.setData('holdR', 0)
    if (def.shooter) {
      e.setData('shootMax', def.shootCd || 1600)
      e.setData('shootCd', def.shootCd || 1600)
      e.setData('shootDmg', def.shootDmg || 10)
    }
    e.setData('eid', ++this.eidSeq)
    e.setData('kbx', 0)
    e.setData('kby', 0)
    // 对象池复用：上一次如果在闪白中途被回收，tween 的 onComplete 不会再执行，
    // tintFill 会一直挂着 —— 这个新出生的敌人就是纯白的。必须显式复位。
    // 同时要**杀掉挂在这个实例上的残留 tween**：闪白 tween 把目标缩放写死成了
    // 上一次那个单位的 baseScale，如果 Boss（upscale=2）在闪白中被回收、
    // 实例被杂兵复用，这条 tween 会把杂兵缩成 Boss 的尺寸。
    this.tweens.killTweensOf(e)
    e.setData('flashing', 0)
    e.setData('lastFlash', 0)

    // 碰撞框按「实测可视尺寸」而不是策划表里的 radius 定。
    // 像素 sprite 的可视包围盒随体型变化（虫群 20x22 / 胖怪 25x32），
    // 沿用同一个 radius 会出现"看着没碰到却掉血"或"明明打中了却不判"。
    // 除 upscale 是换回 source 像素（body.setSize 用的是贴图像素）。
    const bb = PX_UNITS[unit]?.bbox
    const up = PX_UNITS[unit]?.upscale ?? 1
    const bw = (bb ? bb[2] - bb[0] : 20) * up
    const bh = (bb ? bb[3] - bb[1] : 28) * up
    const body = e.body as Phaser.Physics.Arcade.Body
    body.setSize(bw * 0.82, bh * 0.78, true)

    // 落地阴影：单位"踩在地上"的关键，缺了就会像贴片浮在背景上
    let sh = e.getData('shadow') as Phaser.GameObjects.Image | undefined
    if (!sh) {
      sh = this.add.image(x, y, 'blob').setDepth(-1)
      e.setData('shadow', sh)
    }
    const visW = pxVisW(unit)
    const visH = pxVisH(unit)
    sh.setVisible(true).setPosition(x, y + visH * 0.44)
      .setDisplaySize(visW * 1.05, Math.max(9, visH * 0.2))

    // ------------------------------------------------------------------
    // 兵种 × 势力 的脚下标识
    //
    // 这是"看不出兵种、感受不到势力"的直接解法。贴图本身能表达"是什么兵"，
    // 但满屏小小人时靠剪影分辨太吃力；脚下的环是**一眼可读**的：
    //   形状 = 护甲类型（宽扁＝骑兵 / 又大又厚＝重甲 / 细＝轻甲 / 无甲＝不画）
    //   颜色 = 当前势力色
    // 于是"宽扁的黄环"＝西凉铁骑，玩家不用点开任何面板就知道该换铁蒺藜了。
    // 相克表（WEAPONS[].vs）本来就在算这些倍率，这里只是把它**画出来**。
    // ------------------------------------------------------------------
    let mk = e.getData('mark') as Phaser.GameObjects.Image | undefined
    if (!mk) {
      mk = this.add.image(x, y, 'ring').setDepth(-1)
      e.setData('mark', mk)
    }
    const ar = ARMOR_RING[def.armor]
    mk.setVisible(ar.a > 0)
      .setTint(this.faction.color)
      .setAlpha(ar.a)
      .setPosition(x, y + visH * 0.44)
      .setDisplaySize(Math.max(18, visW * ar.w), ar.h)

    if (def.isBoss) {
      this.bossBanner(def.bossName || def.name)
      this.shake(420, 0.006)
      // Boss 血条：没有它玩家无法判断"还要打多久"，Boss 战就只是挨打
      let bar = e.getData('hpBar') as Phaser.GameObjects.Graphics | undefined
      if (!bar) {
        bar = this.add.graphics().setDepth(31)
        e.setData('hpBar', bar)
      }
      bar.setVisible(true)
      e.setData('hpMax', (e.getData('hp') as number) || hpBase)
      e.setData('visW', visW)
      e.setData('visH', visH)
    }
    return e
  }

  private driveEnemies(delta: number) {
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    const slow = this.slowUntil > this.elapsed
    for (const e of kids) {
      if (!e.active) continue
      let sp = (e.getData('sp') as number) || 70
      const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
      const dist = Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y)
      const body = e.body as Phaser.Physics.Arcade.Body

      // 全场减速：减速 75%
      if (slow) sp *= 0.25

      // 拼图盒定身：被"装进盒子"的远程单位原地不动、不射击。
      // 放在这里统一拦截，比在每个分支里判断可靠 —— 射手同样走 hold/fireline 分支，
      // 逐分支判断迟早会漏一处，而漏掉的那一处会让整个计谋失效。
      const stunned = (e.getData('stunUntil') as number) > this.elapsed
      if (stunned) {
        body.setVelocity(0, 0)
        e.setData('kbx', 0)
        e.setData('kby', 0)
        // 定身时也要把预警球收掉，否则会被"定住了还在蓄力"的画面误读
        const tg0 = e.getData('telegraph') as Phaser.GameObjects.Image | undefined
        if (tg0) { tg0.destroy(); e.setData('telegraph', undefined) }
        continue
      }

      // ---- 阵型行为 ----
      // 不是"所有怪都直线贴脸"。行为差异是阵型真正成立的证据 ——
      // 只有名字不同而行为一致，那阵型就只是换了个播报文案。
      const beh = (e.getData('behavior') as string) || ''
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      let vx: number
      let vy: number
      if (beh === 'charge') {
        // 冲锋：更快、更直 —— "锋矢阵"的压迫感来自速度而不是血量
        vx = cos * sp * 1.35
        vy = sin * sp * 1.35
      } else if (beh === 'hold' || beh === 'fireline') {
        // 保持距离：远了压上、近了后撤、在射程环上横向绕行。
        // 远程兵种**站定才是威胁**，这样玩家必须主动冲进危险区才能清掉它们，
        // 而不是站在原地等它们自己送上门（那会让游戏变简单）。
        const hold = (e.getData('holdR') as number) || 240
        const sgn = ((e.getData('eid') as number) % 2) ? 1 : -1
        if (dist < hold * 0.78) {
          vx = -cos * sp
          vy = -sin * sp
        } else if (dist > hold * 1.22) {
          vx = cos * sp
          vy = sin * sp
        } else {
          vx = -sin * sp * 0.5 * sgn
          vy = cos * sp * 0.5 * sgn
        }
      } else if (beh === 'encircle') {
        // 包夹：目标点不是玩家本人，而是玩家**外侧的偏移点** —— 走位绕到侧面，
        // 玩家的"往后退"不再等于"脱战"（偃月阵最难缠的地方）
        const sgn = ((e.getData('eid') as number) % 2) ? 1 : -1
        const gx = this.player.x + -sin * sgn * 120
        const gy = this.player.y + cos * sgn * 120
        const ga = Phaser.Math.Angle.Between(e.x, e.y, gx, gy)
        vx = Math.cos(ga) * sp
        vy = Math.sin(ga) * sp
      } else if (beh === 'advance' || beh === '') {
        // 推进 / 无阵型（Boss、散兵）：保持阵列整体前压，速度不加成。
        // 鱼鳞阵靠"一排排推线 + 层层叠叠"制造压迫，而不是靠速度。
        // **必须写出来** —— 让它落在兜底分支里，以后加行为时就会被悄悄改掉。
        vx = cos * sp
        vy = sin * sp
      } else {
        vx = cos * sp
        vy = sin * sp
      }

      // 击退：命中时叠加一个反向速度分量，按帧衰减。命中才有"把它顶开"的手感
      const kx = (e.getData('kbx') as number) || 0
      const ky = (e.getData('kby') as number) || 0
      body.setVelocity(vx + kx, vy + ky)
      if (kx !== 0 || ky !== 0) {
        e.setData('kbx', Math.abs(kx) < 4 ? 0 : kx * 0.82)
        e.setData('kby', Math.abs(ky) < 4 ? 0 : ky * 0.82)
      }

      // 朝向玩家：按方向换帧（下/上/侧），侧向朝左用水平翻转
      const ddx = this.player.x - e.x
      const ddy = this.player.y - e.y
      const edir: PxDir = Math.abs(ddx) >= Math.abs(ddy) ? 'side' : (ddy < 0 ? 'down' : 'up')
      // 每只怪用 eid 错开相位：否则整屏敌人同步踏步会非常机械
      const eid = (e.getData('eid') as number) || 0
      const ef = Math.floor((this.elapsed * 1000 + eid * 137) / 130) % 4
      e.setFrame(pxFrame(edir, 'walk', ef))
      e.setFlipX(edir === 'side' && ddx < 0)

      // 影子跟着走（用 sprite 实际显示高度定位脚底）
      const sh = e.getData('shadow') as Phaser.GameObjects.Image | undefined
      if (sh) sh.setPosition(e.x, e.y + e.displayHeight / 2 - 2)
      // 护甲/势力标识环同步（独立对象，不跟着 sprite 自动走）
      const mk = e.getData('mark') as Phaser.GameObjects.Image | undefined
      if (mk && mk.visible) mk.setPosition(e.x, e.y + e.displayHeight / 2 - 2)

      let touch = (e.getData('touchCd') as number) - delta
      if (touch < 0) touch = 0
      e.setData('touchCd', touch)

      if (e.getData('isBoss')) {
        const bar = e.getData('hpBar') as Phaser.GameObjects.Graphics | undefined
        if (bar) {
          const hpMax = (e.getData('hpMax') as number) || 1
          const hpNow = Math.max(0, (e.getData('hp') as number) || 0)
          const bw2 = Math.max(64, e.displayWidth * 0.88)
          const x0 = e.x - bw2 / 2
          const y0 = e.y - e.displayHeight / 2 - 14
          bar.clear()
          bar.fillStyle(0x000000, 0.7).fillRect(x0 - 2, y0 - 2, bw2 + 4, 10)
          bar.fillStyle(0xff5252, 1).fillRect(x0, y0, bw2 * (hpNow / hpMax), 6)
        }

        // Boss 电鳗冲击：4 秒一次的电弧伤害。
        //
        // ⚠️ 必须走 hurtPlayer() 这条统一入口，不能直接 `this.hp -=`。
        // 直扣会**绕过三样东西**：无敌帧（invuln）、固定减伤（armorFlat）、
        // 易伤倍率（buffVuln）。上一版就是这么写的，一直没暴露是因为场上最多只有
        // 1 个 Boss；把同屏密度从 26提到 80 之后，多个 Boss 的冲击叠在一起
        // （每 4 秒一轮、每轮 N 次直扣），玩家在 34 秒就被打死 ——
        // 而日志显示伤害完全绕过了受击保护，属于明确的 bug 而不是难度问题。
        let sc = (e.getData('shockCd') as number) - delta
        if (sc <= 0) {
          sc = 4000
          if (Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y)
            < e.displayWidth / 2 + 130) {
            this.damagePlayer((e.getData('dmg') as number) || 0, e)
          }
        }
        e.setData('shockCd', sc)
      }

      if (e.getData('shootMax') > 0) {
        let cd = (e.getData('shootCd') as number) - delta
        // 预警改为「身前聚起一颗能量球」而不是整体放大：
        // 缩放会让敌人看起来在抽搐，而且和受击的缩放脉冲互相打架。
        const tg = e.getData('telegraph') as Phaser.GameObjects.Image | undefined
        if (cd < 340) {
          const t = 1 - Math.max(0, cd) / 340
          let ball = tg
          if (!ball) {
            ball = this.add.image(e.x, e.y, 'dot')
              .setTint(0xff5ce6).setBlendMode(Phaser.BlendModes.ADD).setDepth(20)
            e.setData('telegraph', ball)
          }
          ball.setPosition(e.x + Math.cos(a) * 15, e.y + Math.sin(a) * 15)
            .setScale(0.12 + t * 0.42).setAlpha(0.45 + t * 0.55)
        } else if (tg) {
          tg.destroy()
          e.setData('telegraph', undefined)
        }
        if (cd <= 0) {
          this.enemyShoot(e, (e.getData('shootDmg') as number) || 10)
          cd = (e.getData('shootMax') as number)
        }
        e.setData('shootCd', cd)
      }
    }
  }

  private enemyShoot(e: Phaser.Physics.Arcade.Image, dmg: number) {
    const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
    // 子弹从预警球的位置发出：预警球在哪，弹就从哪出来，玩家能把"看到预警"和
    // "躲开这一发"连起来
    const sx = e.x + Math.cos(a) * 16
    const sy = e.y + Math.sin(a) * 16
    const tg = e.getData('telegraph') as Phaser.GameObjects.Image | undefined
    if (tg) { tg.destroy(); e.setData('telegraph', undefined) }

    const b = this.enemyBullets.get(sx, sy, 'dot') as Phaser.Physics.Arcade.Image | null
    if (!b) return
    b.setActive(true).setVisible(true).setTint(0xff3b3b)
    b.setBlendMode(Phaser.BlendModes.ADD)
    b.setScale(0.5)
    ;(b.body as Phaser.Physics.Arcade.Body).setCircle(8)
    b.setVelocity(Math.cos(a) * 260, Math.sin(a) * 260)
    b.setData('dmg', dmg)
    this.muzzleFlash(sx, sy, 0xff3b3b, a)
  }

  private driveEnemyBullets() {
    const kids = this.enemyBullets.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const b of kids) {
      if (!b.active) continue
      if (Phaser.Math.Distance.Between(b.x, b.y, this.player.x, this.player.y) > 900) {
        b.setActive(false).setVisible(false)
        ;(b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
      }
    }
  }

  private drivePickups() {
    const kids = this.pickups.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const p of kids) {
      if (!p.active) continue
      const body = p.body as Phaser.Physics.Arcade.Body
      const d = Phaser.Math.Distance.Between(p.x, p.y, this.player.x, this.player.y)
      if (d < this.magnet) {
        const a = Phaser.Math.Angle.Between(p.x, p.y, this.player.x, this.player.y)
        // 速度随距离衰减：贴身时不再全速冲，否则会过冲到玩家另一侧绕圈
        const sp = Phaser.Math.Clamp(d * 6 + 90, 110, 420)
        body.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp)
      } else if (body.velocity.x !== 0 || body.velocity.y !== 0) {
        // **离开吸附范围必须把速度清掉。**
        // 旧版只设不清：球一旦进过吸附范围就被 260px/s 发射出去，此后永远保持
        // 这个速度飞下去。实测打完 14 只怪，13 颗经验球散落在 x46~758 / y58~519
        // 的整张屏幕上，玩家永远捡不到，还误以为是敌方子弹。
        body.setVelocity(0, 0)
      }
    }
  }

  // ---------- 碰撞回调 ----------
  /**
   * 统一的敌人受伤入口（计谋等**非武器**伤害走这里）。
   *
   * 武器命中有自己的额外职责（消耗穿透、沿弹道击退），不能合并；
   * 但计谋只需要"扣血 + 飘字 + 闪光 + 死亡处理"这一套，抽出来避免
   * 六个计谋各写一遍 —— 少一次复制就少一处会忘记处理死亡的地方。
   */
  private hurtEnemy(e: Phaser.Physics.Arcade.Image, dmg: number, col: number, colStr: string) {
    if (!e.active) return
    const hp = ((e.getData('hp') as number) || 0) - dmg
    this.popDamage(e.x, e.y, dmg, colStr)
    this.spark(e.x, e.y, col, 2)
    this.hitFlash(e)
    if (hp <= 0) this.killEnemy(e)
    else e.setData('hp', hp)
  }

  /**
   * 命中闪光。
   *
   * 四条约束，全是被实测逼出来的：
   * 1. **不用纯白**。`setTintFill(0xffffff)` 会把整只怪变成一块纯白剪影 ——
   *    轮廓还在但颜色/特征全丢，而幸存者类里玩家是**靠轮廓+颜色认威胁等级**的。
   *    改成闪成「自身颜色向白提亮 60%」：红杂兵闪成浅粉、黄快怪闪成浅米、
   *    绿胖怪闪成浅绿，一眼还能分出是谁在挨打。
   * 2. **时长短**（55ms）。高射速武器下闪光时长直接等于"敌人有多少时间是色块"，
   *    110ms 配 140ms 的冲锋枪 = 79% 都是白块（用户报的"敌方是白色的"）。
   * 3. **有最小间隔**（140ms）。不然两把武器交替命中时闪光会首尾相接，变成常亮。
   * 4. **回收时必须复位**。对象池复用旧实例时若还带着 tintFill，新出生的敌人
   *    就是纯白的 —— 这是"敌方刚出来是白色"的另一个来源。
   */
  private hitFlash(e: Phaser.Physics.Arcade.Image) {
    const now = this.time.now
    if (!e.getData('flashing') && now - ((e.getData('lastFlash') as number) || 0) > 140) {
      e.setData('flashing', 1)
      e.setData('lastFlash', now)
      const c = (e.getData('col') as number) || 0xffffff
      // 自身色向白插值 60%：保留色相，只把明度顶上去
      const mix = (ch: number) => Math.round(ch * 0.4 + 255 * 0.6)
      e.setTintFill(Phaser.Display.Color.GetColor(
        mix((c >> 16) & 0xff), mix((c >> 8) & 0xff), mix(c & 0xff)))
      const baseScale = (e.getData('baseScale') as number) || e.scaleX
      e.setData('baseScale', baseScale)
      // 只放大 7%。曾经是 12%，但配上 60% 提亮的 tintFill，静态帧里那只怪
      // 会明显**比旁边的大一圈**，看起来像"冒出来个不一样的敌人"，而不是"它挨打了"。
      e.setScale(baseScale * 1.07)
      this.tweens.add({
        targets: e,
        scaleX: baseScale,
        scaleY: baseScale,
        duration: 55,
        ease: 'Quad.easeOut',
        onComplete: () => {
          e.setData('flashing', 0)
          if (e.active) e.clearTint()
        }
      })
    }
  }

  private onBulletHit = (bObj: any, eObj: any) => {
    const b = bObj as Phaser.Physics.Arcade.Image
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!b.active || !e.active) return
    const hit = b.getData('hit') as Set<any>
    if (hit.has(e)) return
    hit.add(e)
    // 兵种相克：命中时才乘倍率（打什么护甲要等撞上才知道）
    const mul = this.armorMul(b.getData('vs'), e)
    // 暴击：道具「狙击镜 / 幸运币」带来的乘算收益（与相克倍率相乘）
    const crit = Math.random() < this.critChance
    const dmg = (b.getData('dmg') as number) * mul * (crit ? 1 + this.critMul : 1)
    const hp = ((e.getData('hp') as number) || 0) - dmg
    const col = (b.getData('col') as number) || 0xffe066
    this.spark(b.x, b.y, col, 2)
    this.impactRing(b.x, b.y, col, 40)
    // 伤害飘字：打击感里性价比最高的一环。没有它，玩家只知道"在掉血"，
    // 不知道"这一发打了几分" —— 升级收益也就无从感知。
    // 现在它还要承担第二职责：**把兵种相克教给玩家**。克制时飘字放大并标"克"，
    // 被克时缩小压暗 —— 玩家不需要读说明就知道该换武器了。
    const lab = crit ? { text: '#ffd93d', scale: 1.35, tag: '暴' } : this.damageLabel(mul)
    this.popDamage(e.x, e.y, dmg, lab?.text ?? (col === 0xffe066 ? '#ffe066' : '#ffffff'),
      false, lab?.scale ?? 1, lab?.tag ?? '')
    if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)

    // 命中反馈：短促闪白 + 轻微缩放脉冲
    // 这里踩过一个很典型的坑：原来是 setTintFill(0xffffff) + 110ms，而冲锋枪是
    // 140ms 一发 —— 被连续命中的敌人有 **79% 的时间是一团纯白剪影**，
    // 玩家根本看不清自己在打什么、打的是哪种怪（用户报的"敌方刚出来是白色"
    // 就是这一幕）。闪光必须**短**，而且要么打完就恢复、要么干脆别触发。
    this.hitFlash(e)

    // 击退：沿弹道推一下（在 driveEnemies 里按帧衰减），命中才有"顶开"的手感
    const bv = (b.body as Phaser.Physics.Arcade.Body).velocity
    const bl = Math.hypot(bv.x, bv.y) || 1
    e.setData('kbx', (bv.x / bl) * 105)
    e.setData('kby', (bv.y / bl) * 105)

    let pierce = (b.getData('pierce') as number) || 0
    if (pierce > 0) b.setData('pierce', pierce - 1)
    else {
      b.setActive(false).setVisible(false)
      ;(b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
    }
  }

  private onOrbitHit = (oObj: any, eObj: any) => {
    const o = oObj as Phaser.Physics.Arcade.Image
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!o.active || !e.active) return
    if ((o.getData('cd') as number) > 0) return
    o.setData('cd', 250)
    const mul = this.armorMul(o.getData('vs'), e)
    const crit = Math.random() < this.critChance
    const dmg = (o.getData('dmg') as number) * mul * (crit ? 1 + this.critMul : 1)
    const hp = ((e.getData('hp') as number) || 0) - dmg
    const lab = crit ? { text: '#ffd93d', scale: 1.35, tag: '暴' } : this.damageLabel(mul)
    this.popDamage(e.x, e.y, dmg, lab?.text ?? '#8fd6ff', false, lab?.scale ?? 1, lab?.tag ?? '')
    this.spark(e.x, e.y, UI.jadeHi, 2)
    this.impactRing(e.x, e.y, UI.jadeHi, 34)
    this.hitFlash(e)
    if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
  }

  /**
   * 玩家受到一次伤害的**唯一入口**。
   *
   * 为什么必须收敛成一条路：受伤要吃四样东西 —— 无敌帧、固定减伤、
   * 易伤倍率、被动反弹。任何一处直接 `this.hp -=` 都会漏掉其中一部分。
   * 踩过的坑：Boss 电鳗冲击就直接扣血，绕过了无敌帧与减伤；
   * 场上只有 1 个 Boss 时看不出问题，同屏密度从 26 提到 80 之后
   * 多个 Boss 冲击叠加，玩家 34 秒暴毙 —— 看着像难度问题，其实是 bug。
   *
   * `source` 传入受伤来源，用于取伤害值与触发反弹；为 null 时视为环境伤害。
   */
  private damagePlayer(dmgRaw: number, source?: Phaser.Physics.Arcade.Image) {
    if (this.invuln > 0) return          // 无敌帧：包围圈里的多只怪只算一次伤害
    // 电鳗使：无敌帧比其它潜行者长 40%，更长的无敌窗口靠的就是这个
    this.invuln = this.activeChar.passiveId === 'dash' ? 980 : 700
    // buffVuln：过载脉冲的代价（受伤 +50%）。增益必须带代价，否则计谋就只是白送。
    // 道具的固定减伤先扣，再乘代价倍率；下限 1 点，避免堆满减伤后"全程免疫"。
    const raw = dmgRaw * this.buffVuln
    const dmg = Math.max(1, raw - this.armorFlat)
    this.hp -= dmg
    if (this.hp <= 0) { this.gameOver(false); return }
    if (source && !source.active) return
    this.shake(160, 0.006)
    this.hitStop(70, 0.1)  // 受击顿帧：被围住手忙脚乱时，"我挨打了"必须无条件可感知
    this.spark(this.player.x, this.player.y, 0xff6b6b, 4)
    this.popDamage(this.player.x, this.player.y - 12, dmg, '#ff6b6b')
    this.redFlash()

    // 钙壳被动 + 「尖刺披风」道具：受击反弹。坦克不该只是"血多"，还要有
    // "越挨打越占便宜"的正反馈，否则被围住仍然只能跑。
    const backRate = (this.activeChar.passiveId === 'thorns' ? 0.6 : 0) + this.thornsBonus
    if (backRate > 0 && source) {
      const back = dmg * backRate
      const ehp = ((source.getData('hp') as number) || 0) - back
      this.popDamage(source.x, source.y, back, '#7ec8ff', false, 0.92, '反')
      this.spark(source.x, source.y, 0x7ec8ff, 3)
      if (ehp <= 0) this.killEnemy(source); else source.setData('hp', ehp)
    }
  }

  private onPlayerHit = (_pObj: any, eObj: any) => {
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!e.active) return
    if (this.invuln > 0) return          // 无敌帧：包围圈里的多只怪只算一次伤害
    if ((e.getData('touchCd') as number) > 0) return
    e.setData('touchCd', 600)
    this.damagePlayer((e.getData('dmg') as number) || 0, e)
  }

  private onEnemyBulletHit = (_pObj: any, bObj: any) => {
    const b = bObj as Phaser.Physics.Arcade.Image
    if (!b.active) return
    if (this.invuln > 0) return
    this.invuln = 600
    const raw = ((b.getData('dmg') as number) || 0) * this.buffVuln
    const dmg = Math.max(1, raw - this.armorFlat)
    this.hp -= dmg
    b.setActive(false).setVisible(false)
    ;(b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
    this.spark(this.player.x, this.player.y, 0xff3b3b, 4)
    this.popDamage(this.player.x, this.player.y - 12, dmg, '#ff6b6b')
    this.redFlash()
    this.shake(150, 0.005)
    if (this.hp <= 0) this.gameOver(false)
  }

  private onPickup = (_pObj: any, kObj: any) => {
    const k = kObj as Phaser.Physics.Arcade.Image
    if (!k.active) return
    k.setActive(false).setVisible(false)
    ;(k.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
    this.exp += BALANCE.expPerKill
    // 拾取物同时给材料（Brotato 式：经验与货币都来自场上资源，捡得越多买得越多）
    this.materials += 1 + this.materialsPerPickup
    while (this.exp >= this.expNeed) {
      this.exp -= this.expNeed
      this.levelUp()
    }
  }

  private killEnemy(e: Phaser.Physics.Arcade.Image) {
    const col = (e.getData('col') as number) || 0xffffff
    const isBoss = !!e.getData('isBoss')
    // 击杀回光：让「打得准」有回报。
    //
    // 为什么必须有这一条：光只靠 7/s 自然回涨时，玩家陷入
    // 「光没了 → 只能停火 → 停火怪就贴上来 → 更打不到」的负循环。
    // 击杀回光把这个循环打开了：**清怪本身就是续航**，
    // 于是"主动清怪"和"保住光量"变成同一件事而不是互相打架。
    //
    // Boss 回得多（30），因为 Boss 战本就该是「打满→ 熄火 → 靠走位熬 → 再打满」的循环。
    this.light = Math.min(LIGHT.max, this.light + (isBoss ? 30 : 5))
    // 死亡粒子：直接消失会让"击杀"毫无手感，炸成同色像素块才读得出"打爆了"
    this.deathBurst(e.x, e.y, col, isBoss ? 22 : 8)
    this.spark(e.x, e.y, col, isBoss ? 12 : 5)
    // 击杀冲击环：比普通命中更大更亮，把"打爆"这件事故钉在画面上
    this.impactRing(e.x, e.y, col, isBoss ? 100 : 56, isBoss ? 340 : 210)
    // 震屏只留在这里和受伤时 —— 逐发子弹震屏等于一直在抖
    this.shake(isBoss ? 340 : 70, isBoss ? 0.009 : 0.0016)
    if (isBoss) {
      this.hitStop(90, 0.06)  // Boss 倒下是主线唯一质变节点，顿一下才配得上
      this.bloomPunch(2.3, 0.62, 620)  // 全屏亮度跟着炸一下，把这一刻钉死
    }

    e.setActive(false).setVisible(false)
    // 立刻清掉闪白，避免回收后残留到下一次出生
    e.clearTint()
    // 停掉可能仍在跑的受击缩放 tween，否则会和"下一次出生"的 scale 设置打架
    this.tweens.killTweensOf(e)
    ;(e.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)

    // 影子与预警球是独立对象，必须一起收掉，否则会留在地上/原地不动
    const sh = e.getData('shadow') as Phaser.GameObjects.Image | undefined
    if (sh) sh.setVisible(false)
    const mk = e.getData('mark') as Phaser.GameObjects.Image | undefined
    if (mk) mk.setVisible(false)
    const tg = e.getData('telegraph') as Phaser.GameObjects.Image | undefined
    if (tg) { tg.destroy(); e.setData('telegraph', undefined) }
    const bar = e.getData('hpBar') as Phaser.GameObjects.Graphics | undefined
    if (bar) { bar.destroy(); e.setData('hpBar', undefined) }

    this.kills += 1
    this.score += (isBoss ? 50 : 1)
    this.dropExp(e.x, e.y, isBoss ? 12 : 1)
    // 材料：击杀给基础量，Boss 给大份（商店才有"攒一件大件"的期待感）
    this.materials += BALANCE.materialPerKill + (isBoss ? 10 : 0)

    // 军刀被动 + 「吸血牙」道具：每次击杀回血，把"打得准"兑换成"活得久"
    const heal = (this.activeChar.passiveId === 'lifesteal' ? 3 : 0) + this.lifestealBonus
    if (heal > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + heal)
      this.popDamage(this.player.x, this.player.y - 20, heal, '#8ff0a4', false, 0.82, '血')
    }

    // boss 关：Boss 倒下 = 目标达成。
    // 这是主线唯一一个"质变节点" —— 从砍杂兵变成砍主将，必须立刻给足反馈。
    if (isBoss && this.stage.objective === 'boss') {
      this.bossDown = true
      this.toast(`斩将！${e.getData('bossName') || ''}`)
      this.time.delayedCall(900, () => this.finishStage())
    }
  }

  /** 伤害飘字（对象池）。Text 每次 new 都要烘焙一张贴图，逐发新建会拖帧。 */
  private popDamage(x: number, y: number, amount: number, color: string, big = false, scale = 1, tag = '') {
    let t = this.dmgPool.find((o) => !o.active)
    if (!t) {
      if (this.dmgPool.length < 30) {
        t = this.add.text(0, 0, '', {
          fontSize: '15px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5).setScrollFactor(1).setDepth(72).setActive(false).setVisible(false)
        this.dmgPool.push(t)
      } else {
        t = this.dmgPool[0]
        this.tweens.killTweensOf(t)
      }
    }
    if (!t) return
    this.tweens.killTweensOf(t)
    // 同一位置的飘字必须错开。高射速武器会在同一帧里从同一个点冒出好几个数字，
    // 叠在一起就是一团糊 —— 实测截图里那个"克16"其实是"克1"和"6"重叠出来的，
    // 连弩命中 8 连带显示成"88"。错位后每个数字才读得清。
    const now = this.time.now
    if (now - this.lastPopAt < 240 && Math.abs(x - this.lastPopX) < 28 && Math.abs(y - this.lastPopY) < 28) {
      this.popStack = Math.min(6, this.popStack + 1)
    } else {
      this.popStack = 0
    }
    this.lastPopAt = now
    this.lastPopX = x
    this.lastPopY = y
    const offX = Phaser.Math.Between(-5, 5) + (this.popStack % 2 ? 13 : -13) * Math.min(1, this.popStack)
    const offY = -16 - this.popStack * 13
    t.setActive(true).setVisible(true)
      .setText(tag ? `${tag}${Math.round(amount)}` : String(Math.round(amount)))
      .setFontSize(big ? 22 : tag ? 17 : 15)
      .setColor(color)
      .setStroke('#000000', 4)
      .setPosition(x + offX, y + offY)
      .setAlpha(1).setScale((big ? 1.3 : 1.05) * scale)
    // 飘字的可读性全看「不透明度曲线的头部」。
    // 旧版一生成就开始线性 alpha→0，420ms 里大半时间都是半透明的，压在深色地面
    // 上几乎读不出来（实测截图里只剩一团灰）。现在拆两段：前 40% 定住不动且保持
    // 全不透明，后 60% 才一边上浮一边淡出。
    const dur = big ? 660 : 460
    this.tweens.add({
      targets: t, scale: (big ? 1.0 : 0.95) * scale, duration: 110, ease: 'Quad.easeOut'
    })
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: t.y - (big ? 34 : 24),
      delay: Math.round(dur * 0.4),
      duration: Math.round(dur * 0.6),
      ease: 'Quad.easeIn',
      onComplete: () => { t!.setActive(false).setVisible(false) }
    })
  }

  /** 击杀时炸出的像素碎块 */
  private deathBurst(x: number, y: number, color: number, n = 8) {
    // 粒子层：火星 + 余烬 + 烟尘。三层寿命/速度/混合各不相同，叠起来才有
    // "炸开 → 散掉"的过程感。下面那层 tween 碎块保留 —— 它带旋转，粒子做不到，
    // 但只有它的时候件数太少、没有余韵，看着像几片纸屑被甩出去。
    this.pSpark.setParticleTint(color)
    this.pSpark.emitParticleAt(x, y, n * 2)
    this.pEmber.setParticleTint(color)
    this.pEmber.emitParticleAt(x, y, n)
    this.pSmoke.emitParticleAt(x, y, Math.ceil(n / 2))
    for (let i = 0; i < n; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const sp = Phaser.Math.FloatBetween(50, 175)
      const s = this.add.image(x, y, 'shard')
        .setTint(color)
        .setScale(Phaser.Math.FloatBetween(0.75, 1.6))
        .setDepth(30)
      this.tweens.add({
        targets: s,
        x: x + Math.cos(a) * sp,
        y: y + Math.sin(a) * sp,
        scale: 0.2,
        angle: Phaser.Math.Between(-200, 200),
        alpha: 0,
        duration: Phaser.Math.Between(240, 430),
        ease: 'Quad.easeOut',
        onComplete: () => s.destroy()
      })
    }
  }

  private dropExp(x: number, y: number, n = 1) {
    for (let i = 0; i < n; i++) {
      const k = this.pickups.get(
        x + Phaser.Math.FloatBetween(-12, 12),
        y + Phaser.Math.FloatBetween(-12, 12),
        'crystal'
      ) as Phaser.Physics.Arcade.Image | null
      if (!k) continue
      k.setActive(true).setVisible(true).setTexture('crystal').setTint(0x6bcb77)
      k.setBlendMode(Phaser.BlendModes.NORMAL)
      k.setScale(0.8)
      ;(k.body as Phaser.Physics.Arcade.Body).setCircle(8)
    }
  }

  private distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Phaser.Math.Distance.Between(px, py, ax, ay)
    let t = ((px - ax) * dx + (py - ay) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Phaser.Math.Distance.Between(px, py, ax + t * dx, ay + t * dy)
  }

  // ==========================================================================
  // 波间商店 + 敌情预告（Brotato 化的核心体验）
  // ==========================================================================
  //
  // 为什么商店要配一张「敌情卡」
  // ----------------------------
  // Brotato 的商店是**纯数值题**：钱够就买最强的，答案唯一，没有决策。
  // 这里在商店上方提前摆出**下一波的敌情**（军团 / 阵型 / 兵种构成 / 破法），
  // 于是商店从"数值题"变成"情报题" —— 是花钱扩通用强度，还是赌一把针对性克制？
  //
  // 关键：**这几乎零新增成本**。军团 roles、阵型 slots、相克 vs 三张表早就在数据层，
  // 只是把"打起来才知道"提前到"备战前就知道"。这是本作相对 Brotato 的差异点。
  // ==========================================================================

  /** 波结束 → 发材料 / 回血 → 进商店。 */
  private enterShop() {
    this.materials += BALANCE.materialPerWave
    if (this.regenPerWave > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenPerWave)
    }
    this.showShop()
  }

  private showShop() {
    if (this.over || this.objDone || this.objFailed) return
    if (this.paused) return   // 升级面板正开着，别叠一层
    this.inShop = true
    this.paused = true
    this.physics.pause()
    this.rollOffers()
    this.renderShop()
  }

  /** 抽 4 件商品：武器与道具混抽。武器只在"已解锁且未持有"里抽。 */
  private rollOffers() {
    const offers: { kind: 'weapon' | 'item'; id: string; price: number; sold: boolean }[] = []
    const availW = WEAPONS.filter((w) =>
      this.unlockedW.has(w.id) && !this.weapons.find((o) => o.def.id === w.id))
    const availI = ITEMS.filter((it) => !this.items.find((o) => o.id === it.id))
    const slotLeft = BALANCE.weaponSlots - this.weapons.length
    for (let i = 0; i < BALANCE.shopOffers; i++) {
      // 前两格优先武器（只要还有槽）—— 保证"补槽"这条线不会被运气卡死
      const takeWeapon = availW.length > 0 && slotLeft > 0 && (i < 2 || Math.random() < 0.35)
      if (takeWeapon) {
        const w = Phaser.Utils.Array.RemoveRandomElement(availW) as WeaponDef
        offers.push({ kind: 'weapon', id: w.id, price: 8 * w.tier, sold: false })
      } else if (availI.length > 0) {
        const it = Phaser.Utils.Array.RemoveRandomElement(availI) as ItemDef
        offers.push({ kind: 'item', id: it.id, price: it.price, sold: false })
      }
    }
    this.shopOffers = offers
  }

  private renderShop() {
    if (this.shopOverlay) { this.shopOverlay.destroy(); this.shopOverlay = null }
    if (this.shopKeyHandler) {
      window.removeEventListener('keydown', this.shopKeyHandler)
      this.shopKeyHandler = null
    }
    const k = this.hudK
    const px = (v: number) => Math.round(v * k)
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setScrollFactor(0).setDepth(260)
    this.shopOverlay = c

    // 压暗底：场景级、比面板大、先于面板添加（与备战界面同理）
    if (this.shopBackdrop) this.shopBackdrop.destroy()
    this.shopBackdrop = this.add.rectangle(0, 0, this.scale.width + 4, this.scale.height + 4,
      P.board, 0.94).setOrigin(0, 0).setScrollFactor(0).setDepth(259)

    const W = 900
    const H = 540
    // 纸盒外壳（顶栏黄胶带 + 圆角厚纸板）。场地是暗的、纸板是亮的 ——
    // "一副摆在关灯客厅地板上的桌游"，这个对比是整套 UI 的记忆点。
    const sh = shell(this, W, H, { title: '波间补给' })
    this.uiAdd(c, sh.bg)
    this.uiAdd(c, shellTitle(this, W, H, '波 间 补 给',
      `第 ${Math.min(this.wave, this.stage.waves)} / ${this.stage.waves} 波已清 · ${this.chapter.name}`))

    // 材料：一枚黄色胶囊引脚在右上。玩家在商店里最关心的数字，旧版只是一行
    // 和说明文字同重量的灰字 —— 这一版把它提到和敌情卡同级的信息块。
    const matBg = this.add.graphics()
    matBg.fillStyle(P.tapeDim, 0.5).fillRoundedRect(322, -206, 100, 30, 15)
    matBg.fillStyle(P.tape, 1).fillRoundedRect(320, -208, 100, 30, 15)
    matBg.lineStyle(2, P.edgeHi, 0.7).strokeRoundedRect(320, -208, 100, 30, 15)
    this.uiAdd(c, matBg)
    const matText = this.uiAdd(c, label(this, 370, -193, '', FS.sub, INK.main,
      { fontStyle: 'bold' }).setOrigin(0.5))

    // ---- 敌情卡：下一波（这一版的差异化核心）----
    this.renderIntel(c)

    // ---- 商品区 ----
    this.uiAdd(c, label(this, -420, -52, '商店', FS.sub, INK.main, { fontStyle: 'bold' })
      .setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -378, -52, '点击卡片购买 · 数字键 1~4', FS.caption, INK.mute)
      .setOrigin(0, 0.5))
    this.shopOffers.forEach((o, i) => {
      this.renderOfferCard(c, i, o, -316 + i * 211, 68)
    })
    if (this.shopOffers.length === 0) {
      this.uiAdd(c, label(this, 0, 68, '已无新商品可售（武器与道具都买齐了）', FS.sub, INK.mute)
        .setOrigin(0.5))
    }

    // ---- 底部按钮 ----
    this.uiAdd(c, button(this, -176, 218, 300, 54,
      `刷新 (R)　-${BALANCE.shopRerollCost} 材料`,
      { ghost: true, onClick: () => this.rerollShop() }))
    this.uiAdd(c, button(this, 176, 218, 300, 54, '进入下一波　(Enter)',
      { primary: true, onClick: () => this.leaveShop() }))

    this.shopRefresh = () => { matText.setText(`材料 ${this.materials}`) }
    this.shopRefresh()

    // 面板是固定版式，小窗口下整体等比缩放
    const fit = Math.min((this.scale.width - 24) / W, (this.scale.height - 24) / H, UI_MAX_ZOOM)
    c.setScale(fit)

    const kh = (ev: KeyboardEvent) => {
      if (!this.inShop || !this.shopOverlay) return
      if (ev.key === 'Enter' || ev.key === ' ') { this.leaveShop(); return }
      if (ev.key === 'r' || ev.key === 'R') { this.rerollShop(); return }
      const idx = ['1', '2', '3', '4'].indexOf(ev.key)
      if (idx >= 0) this.buyOffer(idx)
    }
    this.shopKeyHandler = kh
    window.addEventListener('keydown', kh)
  }

  /** 单张商品卡。武器显示品质与克制，道具显示稀有度与正负修正。 */
  private renderOfferCard(
    c: Phaser.GameObjects.Container, i: number,
    o: { kind: 'weapon' | 'item'; id: string; price: number; sold: boolean },
    cx: number, cy: number
  ) {
    const w = o.kind === 'weapon' ? weaponById(o.id) : undefined
    const it = o.kind === 'item' ? itemById(o.id) : undefined
    const name = w?.name ?? it?.name ?? o.id
    const desc = w?.desc ?? it?.desc ?? ''
    const afford = this.materials >= o.price
    const ok = !o.sold && afford
    // 品质色：武器走警示黄、道具走塑料绿。旧版四张卡同色同框，
    // 玩家要读完文字才知道哪个是武器 —— 现在扫一眼边框颜色就能分。
    const accent = o.sold || !afford ? P.edge
      : o.kind === 'weapon' ? P.tape : P.green

    const HW = 98
    const HH = 108
    // 纸卡本身。买得起 = 抬起纸面 + 厚描边；买不起/已购 = 灰纸。
    this.uiAdd(c, card(this, cx - HW, cy - HH, HW * 2, HH * 2, {
      accent, selected: ok, locked: o.sold || !afford, radius: 10
    }))

    // 图标槽：武器画武器形状、道具按**效果类别**画形状（详见 ui/glyphs.ts）。
    // 它解决的是"四张卡长得一模一样"—— 有了一块固定形状的识别位，
    // 玩家的眼睛可以靠形状而不是文字去定位；同类道具还会天然长得像。
    this.uiAdd(c, iconSlot(this, cx, cy - 72, 48,
      o.sold || !afford ? P.kraftDim : P.kraft, accent))
    const gl = this.add.graphics()
    gl.setPosition(cx, cy - 72)
    if (w) drawWeaponGlyph(gl, w.id, accent, 1.15)
    else drawItemGlyph(gl, itemIconTag(o.id), accent, 1.15)
    if (o.sold || !afford) gl.setAlpha(0.4)
    this.uiAdd(c, gl)
    const tierN = w ? w.tier : { common: 1, uncommon: 2, rare: 3 }[it!.rarity]
    const dots = this.add.graphics()
    for (let t = 0; t < 3; t++) {
      const on = t < tierN
      dots.fillStyle(on ? (o.sold || !afford ? P.edge : accent) : P.kraftDim, on ? 1 : 0.55)
      dots.fillCircle(cx - 16 + t * 16, cy - 38, 3.6)
    }
    this.uiAdd(c, dots)

    this.uiAdd(c, label(this, cx, cy - 14, name, FS.sub,
      o.sold ? INK.mute : INK.main, { fontStyle: 'bold' }).setOrigin(0.5))
    const typeLab = w
      ? `武器 · ${'★'.repeat(w.tier)}`
      : `道具 · ${{ common: '普通', uncommon: '精良', rare: '稀有' }[it!.rarity]}`
    this.uiAdd(c, label(this, cx, cy + 6, typeLab, FS.caption,
      o.sold ? INK.mute : o.kind === 'weapon' ? INK.tape : INK.green).setOrigin(0.5))
    this.uiAdd(c, label(this, cx, cy + 32, desc, FS.caption, INK.dim)
      .setOrigin(0.5).setWordWrapWidth(174).setAlign('center'))
    if (w) {
      this.uiAdd(c, label(this, cx, cy + 56, w.strong, FS.caption, INK.green).setOrigin(0.5))
    }

    // 价格条：黄胶带底 + 墨字。买不起转红底白字 —— 不用读数字就知道"现在买不了"。
    // 它的底边落在卡内（cy+100 < cy+HH），旧版 28px 高的条会从卡片下沿探出去 7px。
    const priceBg = this.add.graphics()
    priceBg.fillStyle(o.sold ? P.kraftDim : afford ? P.tape : P.red, o.sold ? 0.55 : 1)
    priceBg.fillRoundedRect(cx - 82, cy + 72, 164, 28, 6)
    priceBg.lineStyle(1.5, P.edgeHi, 0.45).strokeRoundedRect(cx - 82, cy + 72, 164, 28, 6)
    this.uiAdd(c, priceBg)
    this.uiAdd(c, label(this, cx, cy + 86, o.sold ? '已购入' : `${o.price} 材料`, FS.body,
      o.sold ? INK.mute : afford ? INK.main : '#fff1ec', { fontStyle: 'bold' }).setOrigin(0.5))

    if (ok) {
      const hit = this.uiAdd(c, this.add.rectangle(cx, cy, HW * 2, HH * 2, 0xffffff, 0.001))
      const hl = this.uiAdd(c, this.add.rectangle(cx, cy, HW * 2 + 5, HH * 2 + 5, 0x000000, 0)
        .setStrokeStyle(3, P.tape, 0))
      hit.setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => hl.setStrokeStyle(3, P.tape, 1))
      hit.on('pointerout', () => hl.setStrokeStyle(3, P.tape, 0))
      hit.on('pointerdown', () => this.buyOffer(i))
    }
  }

  /**
   * 敌情卡 —— 本作相对 Brotato 的差异化落点。
   *
   * 把"下一波的军团 / 阵型 / 兵种构成 / 破法"从"打起来才知道"提前到"备战前就知道"，
   * 让商店的决策从"买最强"变成"赌克制还是扩通用"。
   * 阵型示意图直接用 FormationDef.slots 画点阵 —— **零美术成本**。
   */
  private renderIntel(c: Phaser.GameObjects.Container) {
    const top = -176
    const h = 110
    // 敌情条 = 一张贴在纸板上的"情报卡"。它比商品卡更宽、更靠上，
    // 位置本身就是层级：先看敌情（决定策略）→ 再挑商品（执行策略）。
    this.uiAdd(c, card(this, -420, top, 840, h, {
      radius: 8, thick: false, accent: P.edge, fill: P.paper
    }))
    // 左端势力色竖条：不读字就知道这波是谁
    this.uiAdd(c, this.add.rectangle(-416, top + h / 2, 5, h - 8, this.faction.color, 1))

    const nextWave = Math.min(this.stage.waves, this.wave + 1)
    const pool = this.formationsFor(this.waveIndexOf(nextWave))
    const f = formationById(pool[pool.length - 1])

    this.uiAdd(c, label(this, -404, top + 14, `下一波敌情 · 第 ${nextWave} 波`,
      FS.caption, INK.tape, { fontStyle: 'bold' }).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -404, top + 36, `${this.faction.name}军 · ${f.name}阵`,
      FS.sub, INK.main, { fontStyle: 'bold' }).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -404, top + 58, f.desc, FS.caption, INK.dim).setOrigin(0, 0.5))

    // 中列：兵种构成（阵位 -> 兵种，零成本地把 roles 表变成情报）
    const roles = this.faction.roles
    const comp = (['front', 'mid', 'back', 'flank'] as ArmyRole[])
      .map((r) => `${ROLE_NAMES[r]} ${enemyById(roles[r]).name}`).join('　')
    this.uiAdd(c, label(this, -44, top + 18, '兵种构成', FS.caption, INK.mute).setOrigin(0.5))
    this.uiAdd(c, label(this, -44, top + 42, comp, FS.caption, INK.main)
      .setOrigin(0.5).setWordWrapWidth(310).setAlign('center'))

    // 右列：破法 + 弱点护甲
    const armor = enemyById(roles.front).armor
    const counter = WEAPONS.find((wp) => (wp.vs?.[armor] ?? 1) >= 1.3)
    this.uiAdd(c, label(this, 178, top + 18, '破法', FS.caption, INK.mute).setOrigin(0.5))
    this.uiAdd(c, label(this, 178, top + 42, counter ? `${counter.name}（${counter.strong}）` : f.counter,
      FS.caption, INK.tape, { fontStyle: 'bold' }).setOrigin(0.5)
      .setWordWrapWidth(190).setAlign('center'))
    this.uiAdd(c, label(this, 178, top + 64, `弱点护甲：${ARMOR_NAMES[armor]}`, FS.caption, INK.dim)
      .setOrigin(0.5))

    // 右端：阵型示意图（slots 点阵，零美术）
    this.drawFormationDots(c, 366, top + 40, f)

    // ---- 底行：推荐计谋（把"敌情 → 计谋"这条链路摆到台面上）----
    // 玩家手里的计谋是对着阵型选的，但如果不提示，他永远不知道自己带错了。
    // 这里直接给出"破这个阵该带哪个"，并标出他**现在带的**是不是那个 ——
    // 于是"看敌情 → 选计谋 → 破阵"从隐性知识变成屏幕上的显性提示。
    this.uiAdd(c, this.add.rectangle(0, top + h - 15, 828, 26, P.kraftDim, 1))
    const rec = STRATAGEMS.filter((s) => s.counterFormations.indexOf(f.id) >= 0)
    const mine = this.stratagem
    const hit = !!mine && rec.some((s) => s.id === mine.id)
    const recTxt = rec.length > 0 ? rec.map((s) => s.name).join(' / ') : '无（本阵无专属解，用通用爆发）'
    this.uiAdd(c, label(this, -404, top + h - 15, `推荐计谋：${recTxt}`, FS.caption,
      rec.length > 0 ? INK.tape : INK.dim, { fontStyle: 'bold' }).setOrigin(0, 0.5))
    if (mine) {
      this.uiAdd(c, label(this, 404, top + h - 15,
        hit ? `✓ 你带着 ${mine.name} —— 正好破它` : `✗ 你带着 ${mine.name}`,
        FS.caption, hit ? INK.green : INK.red, { fontStyle: 'bold' }).setOrigin(1, 0.5))
    }
  }

  /** 用 FormationDef.slots 画阵型点阵示意图：玩家在下，敌军阵型在上方展开。 */
  private drawFormationDots(c: Phaser.GameObjects.Container, cx: number, cy: number, f: FormationDef) {
    const g = this.add.graphics()
    const maxDx = Math.max(1, ...f.slots.map((s) => Math.abs(s.dx)))
    const maxDy = Math.max(1, ...f.slots.map((s) => s.dy))
    // 一块"沙盘"方格：俯视视角，纵向压扁（纵深压缩），像看桌面上的棋子推演
    const R = 34
    g.fillStyle(P.kraftDim, 0.9).fillRoundedRect(cx - R, cy - R, R * 2, R * 2, 5)
    g.lineStyle(1.5, P.edge, 0.85).strokeRoundedRect(cx - R, cy - R, R * 2, R * 2, 5)
    for (const s of f.slots) {
      const x = cx + s.dx * (26 / maxDx)
      const y = cy - 2 - s.dy * (20 / maxDy)
      g.fillStyle(this.faction.color, 1)
        .fillRect(Math.round(x) - 2.5, Math.round(y) - 2.5, 6, 6)
    }
    // 玩家位：绿点钉在方格底沿
    g.fillStyle(P.green, 1).fillCircle(cx, cy + R - 7, 4)
    this.uiAdd(c, g)
  }

  private rerollShop() {
    if (!this.inShop) return
    if (this.materials < BALANCE.shopRerollCost) { this.toast('材料不足，无法刷新'); return }
    this.materials -= BALANCE.shopRerollCost
    this.rollOffers()
    this.renderShop()
  }

  private buyOffer(i: number) {
    const o = this.shopOffers[i]
    if (!o || o.sold) return
    if (o.kind === 'weapon' && this.weapons.length >= BALANCE.weaponSlots) {
      this.toast(`武器槽已满（${BALANCE.weaponSlots}）`); return
    }
    if (this.materials < o.price) { this.toast('材料不足'); return }
    this.materials -= o.price
    o.sold = true
    if (o.kind === 'weapon') {
      const w = weaponById(o.id)
      if (w) { this.addWeapon(w); this.toast(`购入武器：${w.name}`) }
    } else {
      const it = itemById(o.id)
      if (it) { this.applyItem(it); this.toast(`购入道具：${it.name}`) }
    }
    this.renderShop()
  }

  /** 把道具的正负修正落到数值上。全部走加法累积，与升级的乘法倍率分开。 */
  private applyItem(it: ItemDef) {
    const m = it.mods
    if (m.dmgMul) this.dmgScale *= m.dmgMul
    if (m.cdMul) this.fireCdScale *= m.cdMul
    if (m.speedMul) this.speed *= m.speedMul
    if (m.maxHp) {
      this.maxHp = Math.max(10, this.maxHp + m.maxHp)
      if (m.maxHp > 0) this.hp = Math.min(this.maxHp, this.hp + m.maxHp)
      else this.hp = Math.min(this.hp, this.maxHp)
    }
    if (m.armor) this.armorFlat += m.armor
    if (m.magnet) this.magnet += m.magnet
    if (m.pierce) this.pierceBonus += m.pierce
    if (m.lifesteal) this.lifestealBonus += m.lifesteal
    if (m.thorns) this.thornsBonus += m.thorns
    if (m.regenPerWave) this.regenPerWave += m.regenPerWave
    if (m.critChance) this.critChance += m.critChance
    if (m.critMul) this.critMul += m.critMul
    if (m.materials) this.materialsPerPickup += m.materials
    this.items.push(it)
  }

  /** 离开商店 → 继续下一波。 */
  private leaveShop() {
    if (!this.inShop) return
    this.inShop = false
    if (this.shopOverlay) { this.shopOverlay.destroy(); this.shopOverlay = null }
    if (this.shopBackdrop) { this.shopBackdrop.destroy(); this.shopBackdrop = null }
    if (this.shopKeyHandler) {
      window.removeEventListener('keydown', this.shopKeyHandler)
      this.shopKeyHandler = null
    }
    this.shopRefresh = null
    this.physics.resume()
    this.paused = false
  }

  // ---------- 升级 ----------
  private levelUp() {
    this.level += 1
    this.expNeed = Math.floor(this.expNeed * 1.3 + 4)
    this.paused = true
    this.physics.pause()
    this.showUpgrade()
  }

  /** 往 UI 容器里放子对象。
   *  Phaser 渲染容器子节点时会**分别**套用每个子节点自己的 scrollFactor，
   *  只给容器设 0 是不够的 —— 镜头一移动整个面板就会飘走。 */
  private uiAdd<T extends Phaser.GameObjects.GameObject>(
    c: Phaser.GameObjects.Container, o: T): T {
    const any = o as unknown as { setScrollFactor?: (v: number) => void }
    if (any.setScrollFactor) any.setScrollFactor(0)
    c.add(o)
    return o
  }

  private showUpgrade() {
    // 「新武器」卡在没有武器可给的时候必须从池子里剔掉。
    // 旧版会在武器全解锁/全持有之后照样抽出这张卡，玩家点了只拿到一个
    // 隐式的 +10% 伤害，而卡片上写着"获得一把已解锁的武器" —— 这是 UI 说谎，
    // 也是纯鼠标/新手玩家最容易被坑的地方。
    const pool = UPGRADES.filter((u) => u.id !== 'newgun' || this.hasWeaponSlot())
    let picks = Phaser.Utils.Array.Shuffle(pool.slice()).slice(0, 3)
    // 保底：只有一把武器时，升级必须给一张「新武器」。
    // 没有保底时玩家的 DPS 完全由抽卡运气决定 —— 同一份代码实测：
    // 抽到第二把武器的局活 95 秒、没抽到的活 36 秒，三倍差距。
    // 7 张卡抽 3 张，单次漏掉新武器的概率是 57%，连抽两次还有三分之一会漏，
    // 开局半分钟就出现这个量级的运气差，是设计缺陷而不是难度。
    if (this.weapons.length < 2 && this.hasWeaponSlot() && !picks.find((u) => u.id === 'newgun')) {
      const ng = UPGRADES.find((u) => u.id === 'newgun')
      if (ng) picks = [ng, ...picks.slice(0, 2)]
    }
    // 把抽到的选项 id 挂到场景上。**只给自动化测试读**（tools/shoot_game.py
    // 通过 CDP 读它来决定按哪个数字键），不参与任何游戏逻辑。
    // 有了它，自动化跑出来的曲线才是"一个会做选择的玩家"，而不是乱按的木桩 ——
    // 乱按的机器人永远拿不到第二把武器，会让平衡数据严重失真。
    this.upgradePicks = picks.map((u) => u.id)
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setScrollFactor(0).setDepth(200)

    // 升级三选一 —— 与备战/潜航台共用同一套面板语言。
    // 版式固定 520x400，最后整体 fit 缩放：**不再跟 hudK 走**。
    // 旧版跟 hudK（三档界面缩放）联动，同一块面板在三档下字号忽大忽小，
    // 而它本质是个模态弹层，应该和商店/结算一样只按窗口尺寸等比缩放。
    const W = 520
    const H = 400
    const sh = shell(this, W, H, { title: '升级', accent: P.tape })
    this.uiAdd(c, sh.bg)
    this.uiAdd(c, shellTitle(this, W, H, '升　级', '选一项强化，立刻生效'))

    let chosen = false
    const choose = (i: number) => {
      if (chosen) return
      chosen = true
      this.upgradePicks = []
      window.removeEventListener('keydown', handler)
      this.applyUpgrade(picks[i].id)
      c.destroy()
      this.physics.resume()
      this.paused = false
    }

    picks.forEach((u, i) => {
      const cy2 = -52 + i * 82
      this.uiAdd(c, card(this, -224, cy2 - 38, 448, 76, { fill: P.paper, radius: 8 }))
      // 序号块：黄胶带小方块 + 大号数字。键盘玩家靠它把"数字键"和"卡片"对上。
      const num = this.add.graphics()
      num.fillStyle(P.tape, 1).fillRoundedRect(-212, cy2 - 18, 36, 36, 6)
      num.lineStyle(1.5, P.edgeHi, 0.5).strokeRoundedRect(-212, cy2 - 18, 36, 36, 6)
      this.uiAdd(c, num)
      this.uiAdd(c, label(this, -194, cy2, String(i + 1), FS.title, INK.main,
        { fontStyle: 'bold' }).setOrigin(0.5))
      this.uiAdd(c, label(this, -164, cy2 - 12, u.name, FS.sub, INK.main,
        { fontStyle: 'bold' }).setOrigin(0, 0.5))
      this.uiAdd(c, label(this, -164, cy2 + 12, u.desc, FS.caption, INK.dim).setOrigin(0, 0.5))
      // 鼠标玩家也必须能选。旧版只认数字键，纯鼠标操作会直接卡死在升级界面。
      const hit = this.uiAdd(c, this.add.rectangle(0, cy2, 448, 76, 0xffffff, 0.001))
      const hl = this.uiAdd(c, this.add.rectangle(0, cy2, 453, 81, 0x000000, 0)
        .setStrokeStyle(3, P.tape, 0))
      hit.setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => hl.setStrokeStyle(3, P.tape, 1))
      hit.on('pointerout', () => hl.setStrokeStyle(3, P.tape, 0))
      hit.on('pointerdown', () => choose(i))
    })

    const handler = (ev: KeyboardEvent) => {
      // 场景已收场 / 已重开时不再响应：window 监听不属于场景，
      // 场景 restart 不会替你摘 —— 与备战界面的键盘泄漏是同一类风险。
      if (this.over || this.paused === false) return
      const idx = ['1', '2', '3'].indexOf(ev.key)
      if (idx < 0 || idx >= picks.length) return
      choose(idx)
    }
    window.addEventListener('keydown', handler)

    const fit = Math.min((this.scale.width - 24) / W, (this.scale.height - 24) / H, UI_MAX_ZOOM)
    c.setScale(fit)
  }

  private applyUpgrade(id: string) {
    switch (id) {
      case 'dmg': this.dmgScale *= 1.2; break
      case 'spd': this.speed *= 1.15; break
      case 'cd': this.fireCdScale *= 0.85; break
      case 'hp': this.maxHp += 25; this.hp += 25; break
      case 'magnet': this.magnet += 40; break
      case 'pierce': this.pierceBonus += 1; break
      case 'regen': this.hp = Math.min(this.maxHp, this.hp + 30); break
      case 'newgun': this.grantRandomWeapon(); break
    }
  }

  /** 是否还有「已解锁但没持有」的武器 —— 决定「新武器」卡该不该进抽卡池 */
  private hasWeaponSlot(): boolean {
    if (this.weapons.length >= BALANCE.weaponSlots) return false
    return WEAPONS.some((w) =>
      this.unlockedW.has(w.id) && !this.weapons.find((o) => o.def.id === w.id))
  }

  private grantRandomWeapon() {
    const avail = WEAPONS.filter((w) => this.unlockedW.has(w.id) && !this.weapons.find((o) => o.def.id === w.id))
    if (avail.length === 0) { this.dmgScale *= 1.1; return }
    const w = Phaser.Utils.Array.GetRandom(avail) as WeaponDef
    this.addWeapon(w)
  }

  // ---------- meta ----------
  private async loadMeta() {
    try {
      const r = await fetch(`/api/meta?pid=${encodeURIComponent(this.pid)}`)
      if (r.ok) {
        const m = await r.json()
        this.unlockedW = new Set<string>(m.unlockedWeapons || ['bow', 'crossbow'])
        this.unlockedC = new Set<string>(m.unlockedChars || ['rookie'])
        // 计谋默认给一个：否则第一章的"计谋"这条支柱完全不可见，
        // 玩家要到通关第一章之后才知道游戏里有主动技能。
        // 初始给「陀螺」—— 它正好破第 1 章积木帮的乱堆/月牙阵，
        // 玩家第一次用就能体会到"计谋是对着敌情选的"，而不是随便丢个技能。
        this.unlockedS = new Set<string>(m.unlockedStrats || ['spinner'])
        this.cleared = new Set<string>(m.clearedStages || [])
      }
    } catch { /* 离线也可玩，仅无解锁内容 */ }
    // 存档迁移 + 兜底：老存档里的计谋 id（fire/slowdown/…）已不存在，
    // 直接剔除；陀螺（初始计谋）永远可用。
    for (const id of Array.from(this.unlockedS)) {
      if (!stratagemById(id)) this.unlockedS.delete(id)
    }
    this.unlockedS.add('spinner')
    for (let i = CHARS.length - 1; i >= 0; i--) {
      if (this.unlockedC.has(CHARS[i].id)) { this.activeChar = CHARS[i]; break }
    }
    this.refreshPlayerLook()
    this.showPrep()
  }

  private refreshPlayerLook() {
    const id = this.activeChar.id
    this.curDir = this.facing
    this.heroImg.setTexture(pxKey('hero_' + id))
    // HUD 头像也用像素单位（已无 AI 立绘贴图）
    this.portrait.setTexture(pxKey('hero_' + id))
    this.portrait.setFrame(pxFrame('down', 'idle', 0))
  }

  // ==========================================================================
  // 备战流程 —— 两屏：① 战役·选关　② 帐前·点将
  // ==========================================================================
  //
  // 为什么拆开
  // ----------
  // 旧版把「选章 / 选关 / 选潜行者 / 选计谋 / 出征」全塞进一屏 900x646 的面板，
  // 实测反馈就是两个字：**乱**。一屏里同时有 4 组可选卡片 + 章节箭头 + 两行提示，
  // 眼睛没有落点，"我现在到底在挑什么"这个问题没人回答得了。
  //
  // 拆成两步之后每一屏只剩一个主题，字号能放大、留白能拉开：
  //
  //   ① 战役 · 选关   打哪一关 / 目标是什么 / 首通给什么（+ 势力特性）
  //   ② 帐前 · 点将   用谁 / 带哪个计谋（+ 本关摘要）
  //   ③ 出征
  //
  // 顺序与同类作品一致（Vampire Survivors 选关→选人、Brotato 选人→选关），
  // 玩家的既有心智可以直接迁移，不需要重新学一套流程。
  //
  // 视觉全部走 config/theme.ts（墨底 · 鎏金 · 朱红 · 青玉 · 米白），
  // 不再出现"什么都在用同一种青色"的层级塌陷。
  // ==========================================================================

  /** 章节是否已解锁：第 1 章永远开放，之后需先通关上一章的最后一关 */
  private chapterUnlocked(c: ChapterDef): boolean {
    if (c.index === 1) return true
    const prev = CAMPAIGN[c.index - 2]
    if (!prev) return false
    const last = prev.stages[prev.stages.length - 1]
    return this.cleared.has(stageKey(prev.id, last.index))
  }

  /** 该章当前该打第几关：第一个未通关的关；全通则停在最后一关（可重打） */
  private nextStageIndex(c: ChapterDef): number {
    for (const s of c.stages) {
      if (!this.cleared.has(stageKey(c.id, s.index))) return s.index
    }
    return c.stages[c.stages.length - 1].index
  }

  private objTextOf(s: StageDef): string {
    const mm = Math.floor(s.durationSec / 60)
    const ss = String(s.durationSec % 60).padStart(2, '0')
    switch (s.objective) {
      case 'survive': return `生存 ${mm}:${ss}`
      case 'kill': return `击杀 ${s.target}`
      case 'boss': return `击破 ${enemyById(s.bossId || '').name}（第 ${s.bossWave ?? s.waves} 波出场）`
    }
  }

  /** 关卡目标的短标签（竖排在关卡卡上，比整句好扫） */
  private objKindLabel(s: StageDef): string {
    switch (s.objective) {
      case 'survive': return '坚守'
      case 'kill': return '清剿'
      case 'boss': return '击破'
    }
  }

  private showPrep() {
    this.started = false
    // 默认选中：第一个解锁的章节
    let idx = 0
    for (let i = CAMPAIGN.length - 1; i >= 0; i--) {
      if (this.chapterUnlocked(CAMPAIGN[i])) { idx = i; break }
    }
    this.prepIdx = idx
    this.prepStep = 'hub'
    this.prepStage = this.nextStageIndex(CAMPAIGN[idx])
    this.renderPrep()
  }

  /** 进入潜航台 Hub。出征 / 选关 / 点将三个入口都从这里出发。 */
  private gotoHub() {
    this.prepStep = 'hub'
    this.renderPrep()
  }

  /** 按当前 prepStep 重建备战界面。两屏共用一个容器、一份键盘监听。 */
  private renderPrep() {
    if (this.selectOverlay) {
      this.selectOverlay.destroy()
      this.selectOverlay = null
    }
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setScrollFactor(0).setDepth(500)
    this.selectOverlay = c

    // ---- 全屏压暗底 ----
    // 面板只有 900x646，画布比它大时四角会**漏出局内 HUD**（左上时间面板、
    // 左下操作提示），看起来像"两层界面叠在一起"。这块底必须比面板大、比面板先加。
    //
    // 注意它**不能放进 c 里**：c 会在小窗口下整体 setScale(fit) 缩小，
    // 压暗底跟着缩就会在四边漏出缝隙（实测截图里四条边各有一条 10px 的暗缝）。
    // 所以它是场景级对象，生命周期跟着备战面板一起销毁/重建。
    if (this.prepBackdrop) this.prepBackdrop.destroy()
    this.prepBackdrop = this.add.rectangle(0, 0, this.scale.width + 4, this.scale.height + 4,
      P.board, 0.95).setOrigin(0, 0).setScrollFactor(0).setDepth(499)

    if (this.prepStep === 'hub') this.renderHub(c)
    else if (this.prepStep === 'stage') this.renderStageSelect(c)
    else this.renderDeploy(c)

    // 面板是 900x646 的固定版式，画布尺寸随窗口变（RESIZE 模式）。
    // 小窗口下必须整体等比缩放，否则两侧内容直接被裁掉 ——
    // 实测 headless 视口只有 944x649，靠"刚好塞下"是不牢靠的。
    // 大窗口下允许放大到 UI_MAX_ZOOM，否则界面缩在中间一小块、四周全是黑边。
    const fit = Math.min(
      (this.scale.width - 24) / 900,
      (this.scale.height - 24) / 646,
      UI_MAX_ZOOM)
    c.setScale(fit)

    this.bindPrepKeys()
  }

  /**
   * 备战界面的键盘绑定。
   *
   * ⚠️ 这里踩过一个**代价很高的真 bug**，注释留在这里防止再犯：
   *
   * 旧版每次重建面板都 `window.addEventListener('keydown', kh)`，
   * 而"摘掉上一份"读的是**刚刚新建的容器**上的 `c._kh` —— 永远是 undefined，
   * 于是 removeEventListener 从来没被调用过，监听只增不减。
   *
   * `startRun()` 只摘掉了一份（它摘的是 selectOverlay 上存的那份），
   * 前面点过 ◀/▶ 切章留下的监听全都还挂在 window 上。
   * 后果：**对局中按 ← / → 会把备战面板重新弹出来**（而方向键正是本作的移动键）。
   * 玩家截图反馈的"打着打着弹了这个"就是这个。
   *
   * 现在改成场景级唯一一份：每次重建先摘旧的、再挂新的；
   * 并且 handler 内部再挡一道 `this.started` —— 双保险，不依赖调用顺序。
   */
  private bindPrepKeys() {
    if (this.prepKeyHandler) {
      window.removeEventListener('keydown', this.prepKeyHandler)
      this.prepKeyHandler = null
    }
    const kh = (ev: KeyboardEvent) => {
      // 双保险：对局中 / 面板已销毁时，任何键都不该再驱动备战界面
      if (this.started || !this.selectOverlay) return
      if (this.prepStep === 'hub') {
        if (ev.key === 'Enter') this.gotoStageSelect()
        else if (ev.key === 'f' || ev.key === 'F') this.deployCurrent()
      } else if (this.prepStep === 'stage') {
        if (ev.key === 'ArrowLeft') this.switchChapter(-1)
        else if (ev.key === 'ArrowRight') this.switchChapter(1)
        else if (ev.key === 'Enter') this.gotoDeploy()
        else if (ev.key === 'Escape') this.gotoHub()
      } else {
        if (ev.key === 'Enter') this.deploy()
        else if (ev.key === 'Escape') this.gotoStageSelect()
      }
    }
    this.prepKeyHandler = kh
    window.addEventListener('keydown', kh)
  }

  private switchChapter(d: number) {
    this.prepIdx = Phaser.Math.Wrap(this.prepIdx + d, 0, CAMPAIGN.length)
    this.prepStage = this.nextStageIndex(CAMPAIGN[this.prepIdx])
    this.renderPrep()
  }

  private gotoStageSelect() {
    this.prepStep = 'stage'
    this.renderPrep()
  }

  /** 进入点将页。锁定的章节不许进 —— 按钮与键盘路径共用这一个入口。 */
  private gotoDeploy() {
    if (!this.chapterUnlocked(CAMPAIGN[this.prepIdx])) {
      this.toast('该章尚未解锁：先通关上一章的最后一关')
      return
    }
    this.prepStep = 'deploy'
    this.renderPrep()
  }

  /** 真正开始一局。所有"出征"入口（按钮 / Enter）都收敛到这里。 */
  private deploy() {
    const ch = CAMPAIGN[this.prepIdx]
    if (!this.chapterUnlocked(ch)) return
    const st = ch.stages.find((s) => s.index === this.prepStage) || ch.stages[0]
    this.startRun(ch, st)
  }

  // ---------------------------------------------------------------- 屏 ⓿ 潜航台
  /**
   * 潜航台 Hub —— 取代"打开就是选关"的裸流程。
   *
   * 为什么不做传统主城（建造/产出/等待）：那套会把"启动即开打"拉成"点五步才开打"，
   * 直接杀死 Roguelike 的快节奏。但玩家确实需要一个"我变强了"的容器 ——
   * 于是这里只做三件事：**我是谁 / 我有什么 / 打哪里**。
   * 铁律：只展示，不消耗，不等待。出征入口常驻，一屏内可直接开打。
   */
  private renderHub(c: Phaser.GameObjects.Container) {
    const ch = CAMPAIGN[this.prepIdx]
    const st = ch.stages.find((s) => s.index === this.prepStage) || ch.stages[0]
    const fx = factionById(ch.faction)
    const totalStages = CAMPAIGN.reduce((a, x) => a + x.stages.length, 0)

    // Hub 标题：原为「玩具箱 / TOY BOX」。换题材后**必须一起换**——
    // 这是玩家看到的第一屏，标题还写着玩具箱而战斗是深海，
    // 等于开场就自曝换皮没换完（实测截图里就是这么暴露的）。
    const { bg } = shell(this, 900, 646, { title: '潜 航 台', accent: P.tape })
    this.uiAdd(c, bg)
    this.uiAdd(c, shellTitle(this, 900, 646, '潜 航 台', 'D E E P   S E A'))

    // ---------- 左：指挥官档案 ----------
    this.uiAdd(c, card(this, -420, -235, 280, 485, { fill: P.paper }))
    this.uiAdd(c, label(this, -404, -220, '指 挥 官', FS.caption, INK.dim).setOrigin(0, 0.5))
    // 立绘：用像素单位的放大帧（与场上跑的是同一套素材，零额外资源）
    this.uiAdd(c, this.add.sprite(-280, -140, pxKey('hero_' + this.prepChar.id),
      pxFrame('down', 'idle', 0)).setScale(3.4))
    this.uiAdd(c, label(this, -280, -66, this.prepChar.name, FS.title, INK.main,
      { fontStyle: 'bold' }).setOrigin(0.5))
    this.uiAdd(c, label(this, -280, -44, this.prepChar.title, FS.caption, INK.dim).setOrigin(0.5))
    this.uiAdd(c, tag(this, -280, -16, `${this.prepChar.passiveName}`, P.tape, INK.main))

    const stat = (yy: number, k: string, v: string, col: string = INK.main) => {
      this.uiAdd(c, label(this, -404, yy, k, FS.caption, INK.dim).setOrigin(0, 0.5))
      this.uiAdd(c, label(this, -156, yy, v, FS.body, col, { fontStyle: 'bold' }).setOrigin(1, 0.5))
    }
    stat(14, '已通关', `${this.cleared.size} / ${totalStages}`, INK.green)
    stat(40, '解锁单位', `${this.unlockedC.size} / ${CHARS.length}`)
    stat(66, '解锁武器', `${this.unlockedW.size} / ${WEAPONS.length}`)
    stat(92, '解锁计谋', `${this.unlockedS.size} / ${STRATAGEMS.length}`, INK.blue)
    // 生涯战绩：从本地存档读（离线也能显示）
    this.uiAdd(c, label(this, -404, 128, '最高波次', FS.caption, INK.dim).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -156, 128, String(this.bestWave || 0), FS.body, INK.main,
      { fontStyle: 'bold' }).setOrigin(1, 0.5))
    this.uiAdd(c, label(this, -404, 154, '总击杀', FS.caption, INK.dim).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -156, 154, String(this.totalKills || 0), FS.body, INK.main,
      { fontStyle: 'bold' }).setOrigin(1, 0.5))

    this.uiAdd(c, button(this, -280, 218, 236, 48, '换 指 挥 官', {
      ghost: true, sub: '在"点将"页选择', onClick: () => this.gotoStageSelect()
    }))

    // ---------- 右上：出征 ----------
    // 高度 140（旧版 150 且内容溢出到卡片外，与按钮重叠）。
    // 文字列限宽 275px —— 章节全称在 20px 下能到 400px 以上，会被右侧按钮压住。
    this.uiAdd(c, card(this, -120, -235, 540, 140, { fill: P.paper, selected: true }))
    this.uiAdd(c, label(this, -100, -215, '出 征', FS.caption, INK.dim).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -100, -186, `第${ch.index}章　${ch.name}`,
      FS.sub, INK.main, { fontStyle: 'bold' }).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -100, -163, `第${st.index}关 · ${st.name}`,
      FS.body, INK.dim).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -100, -136, `${fx.name}军 · ${fx.trait}`,
      FS.caption, INK.dim).setOrigin(0, 0.5)
      .setWordWrapWidth(270).setLineSpacing(2))
    // 左对齐小标签（宽度自适应）：标签宽度得等文字量出来才知道，
    // 所以先建文字、按它算底板、再回填位置。
    {
      const txt = this.objKindLabel(st) + ' · 强度 x' + st.spawnMul.toFixed(2)
      const t = label(this, 0, 0, txt, FS.caption, '#ffffff', { fontStyle: 'bold' })
      const tw = t.width + 18
      const g = this.add.graphics()
      g.fillStyle(P.green, 1).fillRoundedRect(-100, -124, tw, 22, 5)
      g.lineStyle(1.5, P.edgeHi, 0.45).strokeRoundedRect(-100, -124, tw, 22, 5)
      this.uiAdd(c, g)
      this.uiAdd(c, t.setPosition(-91, -113).setOrigin(0, 0.5))
    }
    this.uiAdd(c, button(this, 280, -200, 200, 60, '出 征', {
      primary: true, sub: '直接开打', onClick: () => this.deployCurrent()
    }))
    this.uiAdd(c, button(this, 280, -134, 200, 40, '选 关 / 点 将', {
      ghost: true, onClick: () => this.gotoStageSelect()
    }))

    // ---------- 右中：仓库（收集度） ----------
    // 两行格子必须完整落在卡内：行高 60 + 间距 8，从 -46 起，底边 82 < 卡底 83。
    // 旧版行高 66/间距 78 会让第二行戳出卡片，被下面的勋章卡压住。
    this.uiAdd(c, card(this, -120, -83, 540, 166, { fill: P.paper }))
    this.uiAdd(c, label(this, -100, -65, '仓 库　（收集度）', FS.caption, INK.dim).setOrigin(0, 0.5))
    const col = (i: number, name: string, have: number, all: number, cc: number) => {
      const x = -104 + (i % 3) * 178
      const y = -46 + Math.floor(i / 3) * 68
      this.uiAdd(c, card(this, x, y, 158, 60, { fill: P.kraft, thick: false, radius: 6 }))
      this.uiAdd(c, label(this, x + 12, y + 19, name, FS.body, INK.main).setOrigin(0, 0.5))
      this.uiAdd(c, label(this, x + 146, y + 19, `${have}/${all}`, FS.sub, INK.main,
        { fontStyle: 'bold' }).setOrigin(1, 0.5))
      this.uiAdd(c, statBar(this, x + 12, y + 38, 134, 9, all ? have / all : 0, cc))
    }
    col(0, '单位', this.unlockedC.size, CHARS.length, P.green)
    col(1, '武器', this.unlockedW.size, WEAPONS.length, P.tape)
    col(2, '计谋', this.unlockedS.size, STRATAGEMS.length, P.blue)
    col(3, '关卡', this.cleared.size, totalStages, P.red)
    col(4, '军团', CAMPAIGN.filter((x) => this.chapterUnlocked(x)).length, CAMPAIGN.length, P.green)
    col(5, '阵型', FORMATIONS.length, FORMATIONS.length, P.tape)

    // ---------- 右下：勋章（章节首通） ----------
    this.uiAdd(c, card(this, -120, 115, 540, 135, { fill: P.paper }))
    this.uiAdd(c, label(this, -100, 133, '勋 章　（每章通关进度）', FS.caption, INK.dim).setOrigin(0, 0.5))
    CAMPAIGN.forEach((cc, i) => {
      const x = -100 + i * 88
      const unlocked = this.chapterUnlocked(cc)
      const got = cc.stages.filter((s) => this.cleared.has(stageKey(cc.id, s.index))).length
      const g = this.add.graphics()
      g.fillStyle(unlocked ? P.label : P.kraftDim, 1).fillRoundedRect(x, 150, 74, 74, 8)
      g.lineStyle(2, unlocked ? P.tape : P.edge, 1).strokeRoundedRect(x, 150, 74, 74, 8)
      this.uiAdd(c, g)
      this.uiAdd(c, label(this, x + 37, 170, unlocked ? `第${cc.index}章` : '？', FS.caption,
        unlocked ? INK.main : INK.mute).setOrigin(0.5))
      this.uiAdd(c, label(this, x + 37, 192, unlocked ? '★'.repeat(got) + '☆'.repeat(3 - got) : '未解锁',
        FS.caption, unlocked ? INK.tape : INK.mute).setOrigin(0.5))
      this.uiAdd(c, label(this, x + 37, 211, unlocked ? `${got}/3` : '—', FS.caption,
        INK.dim).setOrigin(0.5))
    })

    this.uiAdd(c, label(this, 0, 292,
      'Enter 选关　·　F 直接出征　·　点击卡片操作', FS.caption, INK.dim).setOrigin(0.5))
  }

  /** 从 Hub 直接打当前选中的关卡（跳过选关页）。 */
  private deployCurrent() {
    const ch = CAMPAIGN[this.prepIdx]
    if (!this.chapterUnlocked(ch)) { this.toast('该章尚未解锁：先通关上一章的最后一关'); return }
    const st = ch.stages.find((s) => s.index === this.prepStage) || ch.stages[0]
    this.startRun(ch, st)
  }

  // ---------------------------------------------------------------- 屏 ① 选关
  private renderStageSelect(c: Phaser.GameObjects.Container) {
    const ch = CAMPAIGN[this.prepIdx]
    const locked = !this.chapterUnlocked(ch)
    const fx = factionById(ch.faction)

    const sh = shell(this, 900, 646, { title: '战役 · 选关', accent: P.tape })
    this.uiAdd(c, sh.bg)
    this.uiAdd(c, shellTitle(this, 900, 646, '战 役 · 选 关',
      locked ? '该章尚未解锁' : `${fx.name}军 · ${fx.motto}`))

    // ---- 章节条：◀ 第N章 ▶ ----
    const cy = -196
    this.uiAdd(c, card(this, -424, cy - 33, 848, 66, { fill: P.paper, thick: false }))
    const arrow = (x: number, s: string, d: number) => {
      this.uiAdd(c, card(this, x - 23, cy - 23, 46, 46, {
        fill: P.label, radius: 8, thick: false, accent: P.edge
      }))
      const t = this.uiAdd(c, label(this, x, cy, s, FS.title, INK.main).setOrigin(0.5))
      const hit = this.uiAdd(c, this.add.rectangle(x, cy, 46, 46, 0xffffff, 0.001))
      hit.setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => t.setColor(INK.tape))
      hit.on('pointerout', () => t.setColor(INK.main))
      hit.on('pointerdown', () => this.switchChapter(d))
    }
    arrow(-394, '◀', -1)
    arrow(394, '▶', 1)
    this.uiAdd(c, label(this, 0, cy - 14,
      locked ? `第${ch.index}章　？？？（未解锁）` : `第${ch.index}章　${ch.name}`,
      FS.title, locked ? INK.mute : INK.main, { fontStyle: 'bold' }).setOrigin(0.5))
    this.uiAdd(c, label(this, 0, cy + 15,
      locked ? '通关上一章的最后一关即可解锁'
        : `${fx.name}军 · ${fx.motto} · 特性：${fx.trait}`,
      FS.caption, locked ? INK.mute : INK.tape).setOrigin(0.5))

    // ---- 关卡卡：一章三关，横排 ----
    // 三张卡用"边框颜色"而不是"读文字"来区分解锁/通关/选中状态：
    // 灰 = 不可选、绿 = 已通关、黄胶带 = 当前选中。扫一眼就有结论。
    this.uiAdd(c, label(this, -420, -146, '选 关　（共三关，逐关加压）', FS.caption, INK.dim)
      .setOrigin(0, 0.5))
    ch.stages.forEach((s, i) => {
      const x = -286 + i * 286
      const done = this.cleared.has(stageKey(ch.id, s.index))
      const sel = this.prepStage === s.index
      const accent = locked ? P.edge : done ? P.green : sel ? P.tape : P.edge
      this.uiAdd(c, card(this, x - 131, -128, 262, 196, {
        fill: locked ? P.kraftDim : sel ? P.paper : P.kraft,
        accent, selected: sel && !locked, locked
      }))
      this.uiAdd(c, label(this, x, -100, `第 ${s.index} 关`, FS.caption,
        locked ? INK.mute : INK.dim).setOrigin(0.5))
      this.uiAdd(c, label(this, x, -72, s.name, FS.title,
        locked ? INK.mute : INK.main, { fontStyle: 'bold' }).setOrigin(0.5))
      const dv = this.add.graphics()
      dv.fillStyle(P.edge, 0.4).fillRect(x - 100, -50, 200, 1.5)
      this.uiAdd(c, dv)
      this.uiAdd(c, label(this, x, -28, this.objTextOf(s), FS.sub,
        locked ? INK.mute : INK.main, { fontStyle: 'bold' }).setOrigin(0.5))
      this.uiAdd(c, label(this, x, 0, `${this.objKindLabel(s)} · 强度 x${s.spawnMul.toFixed(2)}`,
        FS.caption, locked ? INK.mute : INK.green).setOrigin(0.5))
      // 进度徽标：已通关 / 待出征 / 待挑战
      const bl = done ? '★ 已通关' : sel ? '◆ 待出征' : '· 待挑战'
      const bcol = locked ? P.kraftDim : done ? P.green : sel ? P.tape : P.kraftDim
      const btxt = locked ? INK.mute : done ? '#ffffff' : sel ? INK.main : INK.dim
      this.uiAdd(c, tag(this, x, 62, bl, bcol, btxt))

      if (!locked) {
        const hit = this.uiAdd(c, this.add.rectangle(x, -30, 262, 196, 0xffffff, 0.001))
        const hl = this.uiAdd(c, this.add.rectangle(x, -30, 267, 201, 0x000000, 0)
          .setStrokeStyle(3, P.tape, 0))
        hit.setInteractive({ useHandCursor: true })
        hit.on('pointerover', () => hl.setStrokeStyle(3, P.tape, 1))
        hit.on('pointerout', () => hl.setStrokeStyle(3, P.tape, 0))
        hit.on('pointerdown', () => {
          if (this.prepStage === s.index) this.gotoDeploy()
          else { this.prepStage = s.index; this.renderPrep() }
        })
      }
    })

    // ---- 首通奖励 ----
    const rw = ch.reward.map((id) => META_NAMES[id] || id).join('、')
    const ry = 118
    this.uiAdd(c, card(this, -424, ry - 26, 848, 52, { fill: P.paper, thick: false }))
    this.uiAdd(c, label(this, -404, ry, '首通奖励', FS.caption, INK.dim).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, 404, ry, locked ? '—' : rw, FS.sub,
      locked ? INK.mute : INK.tape, { fontStyle: 'bold' }).setOrigin(1, 0.5))

    // ---- 主行动：点将（下一步）----
    const canGo = !locked
    this.uiAdd(c, button(this, 0, 232, 320, 58, canGo ? '点　将' : '通关上一章后解锁', {
      primary: canGo, disabled: !canGo, onClick: () => this.gotoDeploy()
    }))

    // 提示必须和屏幕上真能点的东西对得上。
    this.uiAdd(c, label(this, 0, 286, '◀ ▶ 切章　·　点击关卡选择　·　Enter 下一步',
      FS.caption, INK.dim).setOrigin(0.5))
  }

  // ---------------------------------------------------------------- 屏 ② 点将
  private renderDeploy(c: Phaser.GameObjects.Container) {
    const ch = CAMPAIGN[this.prepIdx]
    const st = ch.stages.find((s) => s.index === this.prepStage) || ch.stages[0]
    const fx = factionById(ch.faction)

    const sh = shell(this, 900, 646, { title: '出击准备', accent: P.red })
    this.uiAdd(c, sh.bg)
    this.uiAdd(c, shellTitle(this, 900, 646, '出 击 准 备',
      `第${ch.index}章 ${ch.name} · 第${st.index}关 ${st.name}`, INK.main, '#ffe9e2'))

    // ---- 本关摘要条：从选关页带过来的上下文，避免"点将时忘了在打什么" ----
    const sy = -219
    this.uiAdd(c, card(this, -424, sy - 29, 848, 58, { fill: P.paper, thick: false }))
    this.uiAdd(c, this.add.rectangle(-420, sy, 5, 50, fx.color, 1))
    this.uiAdd(c, label(this, -404, sy - 13, `目标：${this.objTextOf(st)}`,
      FS.body, INK.main, { fontStyle: 'bold' }).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, -404, sy + 13,
      `对手：${fx.name}军（${fx.trait}）`, FS.caption, INK.dim).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, 404, sy, `${this.objKindLabel(st)} · 强度 x${st.spawnMul.toFixed(2)}`,
      FS.body, INK.tape, { fontStyle: 'bold' }).setOrigin(1, 0.5))

    // ---- 单位卡 ----
    this.uiAdd(c, label(this, -420, -176, '选 择 单 位', FS.caption, INK.dim).setOrigin(0, 0.5))
    CHARS.forEach((cdef, i) => {
      const x = -285 + i * 190
      const ck = !this.unlockedC.has(cdef.id)
      const picked = this.prepChar.id === cdef.id
      const box = this.add.container(x, -44).setScrollFactor(0)
      this.uiAdd(box, card(this, -84, -122, 168, 244, {
        fill: ck ? P.kraftDim : picked ? P.paper : P.kraft,
        accent: ck ? P.edge : picked ? P.tape : P.edge,
        selected: picked && !ck, locked: ck
      }))
      this.uiAdd(box, label(this, 0, -108, cdef.name, FS.sub, ck ? INK.mute : INK.main,
        { fontStyle: 'bold' }).setOrigin(0.5))
      this.uiAdd(box, label(this, 0, -88, cdef.title, FS.caption, ck ? INK.mute : INK.green).setOrigin(0.5))
      // 卡片主图 = 放大的像素单位帧（不再使用 AI 立绘）
      this.uiAdd(box, this.add.sprite(0, -34, pxKey('hero_' + cdef.id), pxFrame('down', 'idle', 0))
        .setScale(2.6))
      this.uiAdd(box, this.add.sprite(0, 40, pxKey('hero_' + cdef.id), pxFrame('down', 'idle', 0))
      // 卡片上的局内小人预览：**除以 FX_SCALE 抵消**像素倍率。
      // 这张卡片的尺寸是按屏幕像素定死的，不跟着 PX_SCALE 走 ——
      // 不抵消的话，PX_SCALE 一调大，预览小人就会撑破卡片边框。
        .setScale(pxScale('hero_' + cdef.id) * 0.8 / FX_SCALE))
      const dv = this.add.graphics()
      dv.fillStyle(P.edge, 0.4).fillRect(-66, 62, 132, 1.5)
      this.uiAdd(box, dv)
      const sw2 = weaponById(cdef.weapon)
      // 起始武器带图标：备战页是玩家做"选谁"决策的地方，
      // 一眼看到武器形状比读"起始声呐枪"六个字快得多。
      if (sw2) {
        const wg = this.add.graphics()
        wg.setPosition(-62, 76)
        drawWeaponGlyph(wg, sw2.id, P.tape, 0.62)
        if (ck) wg.setAlpha(0.4)
        this.uiAdd(box, wg)
      }
      this.uiAdd(box, label(this, -50, 76, `起始 ${sw2 ? sw2.name : '—'}`, FS.caption,
        ck ? INK.mute : INK.tape, { fontStyle: 'bold' }).setOrigin(0, 0.5))
      this.uiAdd(box, label(this, 0, 94, `${cdef.passiveName} · ${cdef.passiveDesc}`, FS.caption,
        ck ? INK.mute : INK.green).setOrigin(0.5).setWordWrapWidth(152).setAlign('center'))
      this.uiAdd(box, label(this, 0, 112, `生命 ${cdef.hp} · 移速 ${cdef.speed}`, FS.caption,
        ck ? INK.mute : INK.dim).setOrigin(0.5))
      if (ck) {
        // 遮罩必须盖住整块"形象区"（立绘 + 局内小图预览），
        // 旧版只盖住立绘，底部的小图预览还亮着 —— 锁定的卡片里露出一块清晰的小人，
        // 看上去像"其实能用"。
        this.uiAdd(box, this.add.rectangle(0, -25, 164, 172, 0x000000, 0.5))
        this.uiAdd(box, label(this, 0, -40, '未解锁', FS.sub, '#fdf1e0',
          { fontStyle: 'bold' }).setOrigin(0.5))
        this.uiAdd(box, label(this, 0, -16, '通关章节解锁', FS.caption, '#e8d9c0').setOrigin(0.5))
      } else {
        const hit = this.uiAdd(box, this.add.rectangle(0, 0, 168, 244, 0xffffff, 0.001))
        const hl = this.uiAdd(box, this.add.rectangle(0, 0, 173, 249, 0x000000, 0)
          .setStrokeStyle(3, P.tape, 0))
        hit.setInteractive({ useHandCursor: true })
        hit.on('pointerover', () => hl.setStrokeStyle(3, P.tape, 1))
        hit.on('pointerout', () => hl.setStrokeStyle(3, P.tape, 0))
        hit.on('pointerdown', () => { this.prepChar = cdef; this.renderPrep() })
      }
      c.add(box)
    })

    // ---- 计谋卡（6 选 1）----
    // 本章会用到的阵型 —— 用来标出"本关推荐"的计谋（哪些能破这些阵）
    const chForms = ch.formations
    const isRec = (sg: StratagemDef) => sg.counterFormations.some((x) => chForms.indexOf(x) >= 0)
    this.uiAdd(c, label(this, -420, 90, '选 择 计 谋　（局内 Q / E 释放 · 每个计谋专破一种阵）',
      FS.caption, INK.dim).setOrigin(0, 0.5))
    this.uiAdd(c, label(this, 420, 90, '✦ = 本关推荐（能破本章阵型）', FS.caption, INK.green)
      .setOrigin(1, 0.5))
    STRATAGEMS.forEach((sg, i) => {
      const x = -330 + i * 132
      const uk = this.unlockedS.has(sg.id)
      const picked = this.prepStrat === sg.id
      const rec = uk && isRec(sg)
      const box = this.add.container(x, 156).setScrollFactor(0)
      this.uiAdd(box, card(this, -69, -55, 138, 110, {
        fill: !uk ? P.kraftDim : picked ? P.paper : P.kraft,
        accent: !uk ? P.edge : picked ? P.tape : rec ? P.green : P.edge,
        selected: picked && uk, locked: !uk
      }))
      // 局内计谋槽用的是同一套形状（多米诺/磁铁/皮筋/陀螺/盒子/电池）。
      // 备战阶段就让玩家把"形状 → 效果"记下来，进局后不用再读字。
      const gl = this.add.graphics()
      gl.setPosition(0, -34)
      this.drawStratGlyph(gl, sg.kind, uk ? (picked ? P.tape : this.kindColor(sg.kind)) : P.edge, 0.62)
      this.uiAdd(box, gl)
      this.uiAdd(box, label(this, 0, -10, sg.name, FS.body,
        uk ? (picked ? INK.tape : INK.main) : INK.mute, { fontStyle: 'bold' }).setOrigin(0.5))
      // 破阵说明：把"这个计谋是干什么用的"直接写成"破什么阵"
      const cnt = sg.counterFormations.map((id) => formationById(id).name).join('/')
      this.uiAdd(box, label(this, 0, 8, uk ? (cnt ? `破 ${cnt}` : '通用爆发') : '未解锁', FS.caption,
        uk ? (cnt ? INK.green : INK.tape) : INK.mute, { fontStyle: 'bold' }).setOrigin(0.5))
      this.uiAdd(box, label(this, 0, 26, uk ? sg.quote : '通关章节解锁', FS.caption,
        uk ? INK.dim : INK.mute).setOrigin(0.5).setWordWrapWidth(126).setAlign('center'))
      this.uiAdd(box, label(this, 0, 42, uk ? `冷却 ${sg.cdSec}s` : '—', FS.caption,
        INK.mute).setOrigin(0.5))
      // 本关推荐角标
      if (rec) {
        this.uiAdd(box, label(this, 58, -46, '✦', FS.caption, INK.green,
          { fontStyle: 'bold' }).setOrigin(1, 0.5))
      }
      if (uk) {
        const hit = this.uiAdd(box, this.add.rectangle(0, 0, 138, 110, 0xffffff, 0.001))
        const hl = this.uiAdd(box, this.add.rectangle(0, 0, 143, 115, 0x000000, 0)
          .setStrokeStyle(3, P.tape, 0))
        hit.setInteractive({ useHandCursor: true })
        hit.on('pointerover', () => hl.setStrokeStyle(3, P.tape, 1))
        hit.on('pointerout', () => hl.setStrokeStyle(3, P.tape, 0))
        hit.on('pointerdown', () => { this.prepStrat = sg.id; this.renderPrep() })
      }
      c.add(box)
    })

    // ---- 返回 / 出征 ----
    this.uiAdd(c, button(this, -186, 268, 188, 54, '◀ 选　关', {
      ghost: true, onClick: () => this.gotoStageSelect()
    }))
    this.uiAdd(c, button(this, 112, 268, 336, 58, '出　征', {
      primary: true, onClick: () => this.deploy()
    }))

    this.uiAdd(c, label(this, 0, 308,
      '点击卡片选择　·　Enter 出征　·　Esc 返回选关', FS.caption, INK.dim).setOrigin(0.5))
  }

  private startRun(ch: ChapterDef, st: StageDef) {
    this.chapter = ch
    this.stage = st
    this.faction = factionById(ch.faction)
    this.chapterTint.setFillStyle(ch.tint, 0.22)
    this.refreshPlayerLook()
    this.applyCharStats(this.prepChar)
    // 计谋：选中项若不可用（未解锁），回退到第一个已解锁的
    const pick = stratagemById(this.prepStrat)
    this.stratagem = pick && this.unlockedS.has(pick.id)
      ? pick
      : stratagemById(STRATAGEMS.find((s) => this.unlockedS.has(s.id))?.id || 'spinner') || null
    this.objLabel = this.objTextOf(st)
    this.objDone = false
    this.objFailed = false
    this.bossDown = false
    this.objProgress = 0
    this.stratCd = 0
    this.buffDmg = 1
    this.buffAtk = 1
    this.buffVuln = 1
    this.buffT = 0
    this.slowUntil = -1
    this.formationLog = []
    // Brotato 化：波次 / 材料 / 道具 每局从零开始（同一场景实例连打两关时必须清干净）
    this.wave = 1
    this.waveT = 0
    this.materials = 0
    this.inShop = false
    this.items = []
    this.armorFlat = 0
    this.critChance = 0
    this.critMul = 0
    this.lifestealBonus = 0
    this.thornsBonus = 0
    this.regenPerWave = 0
    this.materialsPerPickup = 0
    if (this.shopOverlay) { this.shopOverlay.destroy(); this.shopOverlay = null }
    if (this.shopBackdrop) { this.shopBackdrop.destroy(); this.shopBackdrop = null }
    if (this.shopKeyHandler) {
      window.removeEventListener('keydown', this.shopKeyHandler)
      this.shopKeyHandler = null
    }
    this.shopRefresh = null

    if (this.selectOverlay) {
      // 摘掉备战界面的 window 键盘监听。**必须摘** —— 不摘的话，
      // 进局后按 ← / →（也是移动键）会把备战面板重新弹出来。见 bindPrepKeys()。
      if (this.prepKeyHandler) {
        window.removeEventListener('keydown', this.prepKeyHandler)
        this.prepKeyHandler = null
      }
      this.selectOverlay.destroy()
      this.selectOverlay = null
    }
    if (this.prepBackdrop) { this.prepBackdrop.destroy(); this.prepBackdrop = null }
    // 下一局从「选关」开始，而不是停在上一局的点将页
    this.prepStep = 'stage'
    this.started = true
    // 开局报幕：这是谁在打你、该用什么克、计谋怎么按
    this.announceChapter()
  }

  /**
   * 把潜行者的机制差异真正落到数值上。
   *
   * 这是"不只是换皮"的落点。旧版 startRun() 只调 refreshPlayerLook()，
   * 四个"潜行者"除贴图颜色外血量/移速/起始武器/被动**完全一致**
   * （见 docs/方向定位与差异化策略.md 第 1.2 节的举证）。
   */
  private applyCharStats(char: CharDef) {
    this.maxHp = char.hp
    this.hp = char.hp
    // 龙胆：移速 +20%。注意这是**乘在体型基础移速上**，所以四人手感差距更大。
    this.speed = char.speed * (char.passiveId === 'dash' ? 1.2 : 1)
    // 仁德：拾取范围 +70%。直接改造 magnet，避免再开一条拾取半径的旁路。
    this.magnet = char.passiveId === 'bounty' ? Math.round(this.magnet * 1.7) : this.magnet
    // 起始武器：四人各一把，且**机制类型互不相同**
    // （声呐枪 = gun / 探照灯束 = beam / 骨刺长枪 = gun+pierce / 浮游光球 = orbit）。
    this.weapons = []
    this.orbits.clear(true, true)
    this.addWeapon(weaponById(char.weapon) || WEAPONS[0])
  }

  private addWeapon(w: WeaponDef) {
    // 武器槽上限：满了就不再接受（商店购买前已挡住，这里是兜底）
    if (this.weapons.length >= BALANCE.weaponSlots) return
    this.weapons.push({ def: w, cd: 0, angle: 0 })
    if (w.kind === 'orbit') this.createOrbits(w)
  }

  // ---------- 结算 ----------
  /** 达成目标：标记通关并进入结算（存活/击杀/boss 三种目标共用这一条出口） */
  private finishStage() {
    if (this.objDone || this.over) return
    this.objDone = true
    this.objProgress = 1
    this.gameOver(true)
  }

  /** 超时未达成目标 —— 不是死亡，但这一关没过 */
  private failStage() {
    if (this.objDone || this.objFailed || this.over) return
    this.objFailed = true
    this.gameOver(false)
  }

  private gameOver(win: boolean) {
    if (this.over) return
    this.over = true
    this.physics.pause()
    this.submitScore()
    // 生涯战绩累计：Hub 要显示"最高波次 / 累计击杀"，这两个数必须跨局累加+落盘。
    // bestWave 取历史最大值（本局波次不会比历史高就不动它）；totalKills 是本局击杀的累加。
    this.bestWave = Math.max(this.bestWave, this.wave)
    this.totalKills += this.kills
    this.saveCareer()
    if (win) this.cleared.add(stageKey(this.chapter.id, this.stage.index))
    this.submitMeta(win)

    const c = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setScrollFactor(0).setDepth(300)
    // 三种收场要分得开：通关 / 超时未达成 / 阵亡。
    // 旧版只有"通关/阵亡"两种，超时也会显示"阵亡"，玩家会以为自己是被打死的。
    // 这一版连顶栏胶带的颜色一起换（绿/黄/红）—— 不看字也知道这一局是什么结果。
    const title = win ? '通　关' : this.objFailed ? '未　竟' : '阵　亡'
    const sub = win ? '这一关拿下了' : this.objFailed ? '时间到了，目标未达成' : '你被击倒了'
    const accent = win ? P.green : this.objFailed ? P.tape : P.red
    const W = 520
    const H = 460

    const sh = shell(this, W, H, { title, accent })
    this.uiAdd(c, sh.bg)
    this.uiAdd(c, shellTitle(this, W, H, title, sub, '#ffffff', '#ffeede'))

    // 四项战绩：2x2 纸盒小卡。数值给最大字号、标签压到最小 —— 层级拉开才有重点。
    const mk = (cx: number, cy: number, val: string, lab: string, col: string) => {
      this.uiAdd(c, card(this, cx - 104, cy - 37, 208, 74,
        { fill: P.paper, radius: 8, thick: false }))
      this.uiAdd(c, label(this, cx, cy - 10, val, FS.head, col, { fontStyle: 'bold' }).setOrigin(0.5))
      this.uiAdd(c, label(this, cx, cy + 22, lab, FS.caption, INK.dim).setOrigin(0.5))
    }
    mk(-112, -104, `${this.wave}/${this.stage.waves}`, '波次', INK.tape)
    mk(112, -104, String(this.kills), '击杀', INK.main)
    mk(-112, -18, String(this.level), '等级', INK.green)
    mk(112, -18, String(this.materials), '材料', INK.blue)

    // 本章进度：三关的完成状态。
    // 这是"主线"在结算界面上唯一的体现 —— 没有它，玩家打完不知道自己走到哪了。
    this.uiAdd(c, label(this, -216, 48, '本章进度', FS.caption, INK.dim).setOrigin(0, 0.5))
    this.chapter.stages.forEach((s, i) => {
      const done = this.cleared.has(stageKey(this.chapter.id, s.index))
      const here = this.stage.index === s.index
      const x = -152 + i * 152
      this.uiAdd(c, card(this, x - 70, 64, 140, 38, {
        fill: done ? P.paper : here ? P.label : P.kraftDim,
        accent: done ? P.green : here ? P.red : P.edge,
        radius: 6, thick: false
      }))
      this.uiAdd(c, label(this, x, 83, `${done ? '★' : here ? '◆' : '・'} ${s.name}`,
        FS.body, done ? INK.green : here ? INK.red : INK.mute,
        { fontStyle: done || here ? 'bold' : 'normal' }).setOrigin(0.5))
    })

    // 必须有重开入口。旧版打完成绩就没了，只能手动刷新页面 ——
    // 幸存者类游戏的核心循环就是"再来一局"，这一环缺了整个手感就断了。
    this.uiAdd(c, button(this, 0, 170, 280, 56, '返回备战　(R)', {
      primary: true, onClick: () => this.restartRun()
    }))
    this.input.keyboard!.once('keydown-R', () => this.restartRun())

    const fit = Math.min((this.scale.width - 24) / W, (this.scale.height - 24) / H, UI_MAX_ZOOM)
    c.setScale(fit)
  }

  private restartRun() {
    if (this.restarting) return
    this.restarting = true
    this.scene.restart()
  }

  private async submitMeta(win: boolean) {
    try {
      const r = await fetch(`/api/meta?pid=${encodeURIComponent(this.pid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: this.score,
          kills: this.kills,
          timeSurvived: Math.floor(this.elapsed),
          won: win,
          // 关卡键（"c2s3"）：后端据此累加通关进度并权威解锁章节奖励。
          // **必须上报** —— 否则"通关解锁下一章"只在本地内存里生效，换台设备就丢档。
          stage: win ? stageKey(this.chapter.id, this.stage.index) : ''
        })
      })
      if (r.ok) {
        const m = await r.json()
        const now = (m.unlockedNow as string[]) || []
        if (now.length) this.showUnlockBanner(now)
        // 后端回传的权威进度覆盖本地：保证多设备一致
        if (Array.isArray(m.clearedStages)) this.cleared = new Set<string>(m.clearedStages)
        if (Array.isArray(m.unlockedStrats)) this.unlockedS = new Set<string>(m.unlockedStrats)
        if (Array.isArray(m.unlockedWeapons)) this.unlockedW = new Set<string>(m.unlockedWeapons)
        if (Array.isArray(m.unlockedChars)) this.unlockedC = new Set<string>(m.unlockedChars)
      }
    } catch { /* 忽略上报失败 */ }
  }

  private submitScore() {
    fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: this.pid, name: this.activeChar.name, score: this.score })
    }).catch(() => {})
  }

  private showUnlockBanner(ids: string[]) {
    const names = ids.map((id) => META_NAMES[id] || id).join('、')
    const t = this.add.text(this.scale.width / 2, 120, `★ 新解锁：${names}`, {
      fontFamily: FONT, fontSize: '20px', color: TXT.goldHi,
      backgroundColor: '#120e17ee', padding: { x: 14, y: 8 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(400)
    this.time.delayedCall(3200, () => t.destroy())
  }

  private bossBanner(name: string) {
    const t = this.add.text(this.scale.width / 2, 90, `⚠ ${name} 出现！`, {
      fontFamily: FONT, fontSize: '24px', color: TXT.red,
      backgroundColor: '#120e17ee', padding: { x: 16, y: 10 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(400)
    this.time.delayedCall(2600, () => t.destroy())
  }
}
