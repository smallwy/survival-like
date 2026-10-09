import Phaser from 'phaser'
import {
  WEAPONS, ENEMIES, UPGRADES, WAVE_STAGES, BOSS_SCHEDULE, CHARS, META_NAMES,
  BALANCE, ARMOR_NAMES, WeaponDef, EnemyDef, CharDef, Armor,
  enemyById, weaponById, charById
} from '../config/gameData'
// 立绘只用于「静态展示」场合：HUD 头像、选人卡片。
// 它们是静态展示品，不含动作信息 —— 放在游戏内当活动单位就只能靠程序变形去猜，
// 这正是之前六轮"施法朝向不对/不转身"的病根。游戏内单位改用像素帧序列。
import rookiePortrait from '../assets/portraits/rookie.png'
import guanyuPortrait from '../assets/portraits/guanyu.png'
import zhangfeiPortrait from '../assets/portraits/zhangfei.png'
import zhaoyunPortrait from '../assets/portraits/zhaoyun.png'

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
import pxFoeBossWarlord from '../assets/pixel/foe_boss_warlord.png'
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
const PX_SCALE = 2 // 逻辑像素 -> 屏幕像素（整数倍，像素块才锐利）

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
  foe_boss_warlord: pxFoeBossWarlord,
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
  /** 当前波次阶段下标。初值 -1 是为了让第 0 阶段（开场敌潮）也播报一次，
   *  否则玩家永远听不到「黄巾力士是轻甲、短弓可克」这条最关键的入门提示。 */
  private stageIdx = -1
  private eidSeq = 0
  /** 受击无敌剩余时间（ms）。见 tickInvuln 的说明 —— 这是本作唯一一条
   *  能把「被围住」从必死改成可操作的保护机制。 */
  private invuln = 0
  /** 当前升级面板抽到的 3 个选项 id。仅供自动化测试读取，不参与游戏逻辑。 */
  private upgradePicks: string[] = []

  private hpText!: Phaser.GameObjects.Text
  private lvText!: Phaser.GameObjects.Text
  private nameText!: Phaser.GameObjects.Text
  private statText!: Phaser.GameObjects.Text
  private weaponText!: Phaser.GameObjects.Text
  private timeText!: Phaser.GameObjects.Text
  private timePanel!: Phaser.GameObjects.Rectangle
  private expBar!: Phaser.GameObjects.Graphics
  private hpBar!: Phaser.GameObjects.Graphics
  private portrait!: Phaser.GameObjects.Image
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

  private bg!: Phaser.GameObjects.TileSprite
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
  private fireAngle = 0     // 最近一次施法方向
  private dustTimer = 0     // 走路扬尘计时

  // meta（跨局解锁）
  private unlockedW = new Set<string>(['bow', 'crossbow'])
  private unlockedC = new Set<string>(['rookie'])
  private activeChar = CHARS[0]
  private pid = 'local'

  constructor() { super('game') }

  preload() {
    // 立绘：只给 HUD 头像与选人卡片用（静态展示场合）
    this.load.image('portrait_rookie', rookiePortrait)
    this.load.image('portrait_guanyu', guanyuPortrait)
    this.load.image('portrait_zhangfei', zhangfeiPortrait)
    this.load.image('portrait_zhaoyun', zhaoyunPortrait)

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
    this.dmgPool = []
    this.hudObjs = []
    this.moving = false
    this.castAnim = 0
    this.upgradePicks = []
    this.aimLock = 0
    this.walkAnimT = 0
    this.facing = 'down'
    this.faceRight = true
    this.bossesSpawned = new Set<string>()
    this.stageIdx = -1
    this.popStack = 0
    this.lastPopAt = 0

    this.pid = this.resolvePid()
    this.hp = this.maxHp = BALANCE.playerMaxHp
    this.speed = BALANCE.playerSpeed
    this.expNeed = BALANCE.expToLevel
    this.magnet = 160
    // 初始武器只是个占位，真正生效的起手武器由 applyCharStats() 按武将写入。
    // **不要写 `weaponById('pistol')!`** —— 武器库换成冷兵器后 'pistol' 已不存在，
    // `!` 断言会把这个 undefined 一路放行到 refreshHud 里 `o.def.name` 才炸，
    // 表现是选人界面整个不渲染（异常发生在 buildHud → create 的中途）。
    const starter = weaponById(CHARS[0].weapon) || WEAPONS[0]
    this.weapons = [{ def: starter, cd: 0, angle: 0 }]

    const cx = this.scale.width / 2
    const cy = this.scale.height / 2

    // 石板地面：跟随镜头移动，制造"在场地里跑"的空间感
    this.bg = this.add.tileSprite(cx, cy, this.scale.width, this.scale.height, 'ground')
      .setScrollFactor(0)
      .setDepth(-20)

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
    this.ring = this.add.image(cx, cy + 30, 'ring')
      .setTint(0x4ecdc4).setAlpha(0.55).setDepth(7)

    // 暗角叠加：矩形暗框直接拉伸到屏幕尺寸，边缘和四角一起变暗
    this.vig = this.add.image(cx, cy, 'vignette')
      .setScrollFactor(0).setDepth(85)
      .setDisplaySize(this.scale.width, this.scale.height)

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
    this.cameras.main.setBackgroundColor('#14142b')

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT')
    // F：循环 HUD 三档大小。字号是这个用户明确敏感的项，给他自己放大的能力，
    // 而不是替他固定一个尺寸。
    this.input.keyboard!.on('keydown-F', () => {
      this.hudTier = (this.hudTier + 1) % HUD_SCALES.length
      this.rebuildHud()
      this.toast(`界面大小：${HUD_LABELS[this.hudTier]}`)
    })
    this.scale.on('resize', this.layout, this)
    this.buildHud()
    this.loadMeta()
  }

  /** 窗口尺寸变化时重排常驻 UI（RESIZE 模式下画布会变，位置必须跟着走） */
  private layout() {
    const w = this.scale.width
    const h = this.scale.height
    this.bg.setPosition(w / 2, h / 2).setSize(w, h)
    this.vig.setPosition(w / 2, h / 2).setDisplaySize(w, h)
    this.placeTimePanel()
    if (this.hintText) this.hintText.setPosition(10, h - 22)
  }

  /** 屏幕右上角的时间块：带底衬，否则会被走到角落的敌人盖住看不清 */
  private placeTimePanel() {
    const k = this.hudK
    const w = this.scale.width
    const pw = Math.round(116 * k)
    const ph = Math.round(40 * k)
    // 面板 origin 是 (0,0)，所以 x 必须是「右边缘 - 面板宽 - 边距」。
    // 旧版写成 w - 边距，整块底衬被推到屏幕外，只剩左边框露出来像半个括号。
    this.timePanel
      .setPosition(w - Math.round(10 * k) - pw, Math.round(10 * k))
      .setSize(pw, ph)
    this.timeText.setPosition(w - Math.round(10 * k) - pw / 2, Math.round(10 * k) + ph / 2)
  }

  private toast(msg: string) {
    const t = this.add.text(this.scale.width / 2, this.scale.height - 48, msg, {
      fontSize: `${Math.max(12, Math.round(15 * this.hudK))}px`,
      color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 10, y: 5 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(420)
    this.tweens.add({
      targets: t, alpha: 0, y: t.y - 16, delay: 900, duration: 420,
      onComplete: () => t.destroy()
    })
  }

  private rebuildHud() {
    for (const o of this.hudObjs) o.destroy()
    this.hudObjs = []
    this.buildHud()
  }

  private resolvePid(): string {
    const p = new URLSearchParams(location.search).get('pid')
    if (p) return p
    const k = 'sg_pid'
    let v = localStorage.getItem(k)
    if (!v) { v = 'u_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(k, v) }
    return v
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

    // 地面：暗色石板。
    // 这里踩过一个很典型的坑：原先每块石板四周留了 2px 的深色接缝
    // （0x16162a 压在 0x232340 上），结果整屏看起来像铺了一层电子表格 ——
    // **等距的深色直线比石板本身更抢眼**，格子成了画面的主导图案。
    // 现在不画深缝，只用「石板亮度差 + 极淡的 1px 分界 + 碎石子」表达材质。
    const gr = this.make.graphics({ x: 0, y: 0 }, false)
    const SLAB = 64
    gr.fillStyle(0x22223c, 1)
    gr.fillRect(0, 0, 128, 128)
    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 2; sx++) {
        const v = Phaser.Math.FloatBetween(0.9, 1.13) // 相邻石板靠亮度拉开，而不是靠缝
        const base = Phaser.Display.Color.IntegerToColor(0x232340)
        const c = Phaser.Display.Color.GetColor(
          Math.min(255, Math.round(base.red * v)),
          Math.min(255, Math.round(base.green * v)),
          Math.min(255, Math.round(base.blue * v))
        )
        gr.fillStyle(c, 1)
        gr.fillRect(sx * SLAB, sy * SLAB, SLAB, SLAB)
        gr.fillStyle(0xffffff, 0.035)   // 上沿受光
        gr.fillRect(sx * SLAB, sy * SLAB, SLAB, 2)
        gr.fillStyle(0x000000, 0.09)    // 分界：刚好能看出石料分块，不成线
        gr.fillRect(sx * SLAB, sy * SLAB, SLAB, 1)
        gr.fillRect(sx * SLAB, sy * SLAB, 1, SLAB)
      }
    }
    for (let i = 0; i < 72; i++) {      // 碎石/斑驳，打破重复感
      const big = Math.random() < 0.25
      gr.fillStyle(0x3d3d63, Phaser.Math.FloatBetween(0.32, 0.72))
      gr.fillRect(Math.floor(Phaser.Math.FloatBetween(3, 122)),
        Math.floor(Phaser.Math.FloatBetween(3, 122)), big ? 3 : 2, big ? 3 : 2)
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
    reg(this.add.rectangle(px(8), px(8), W, H, 0x090912, 0.74)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D)
      .setStrokeStyle(2, 0x4ecdc4, 0.5))
    reg(this.add.rectangle(px(8), px(8), W, px(3), 0x4ecdc4, 0.9)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D + 1))

    reg(this.add.rectangle(px(20), px(28), px(64), px(72), 0x14142a, 1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D + 1)
      .setStrokeStyle(1, 0x4ecdc4, 0.45))
    this.portrait = reg(this.add.image(px(52), px(64), 'portrait_' + this.activeChar.id)
      .setScale(PLAYER_SCALE * 0.88 * k).setScrollFactor(0).setDepth(D + 2))

    this.nameText = reg(this.add.text(px(98), px(16), '', {
      fontSize: fs(16), color: '#ffffff', stroke: '#000000', strokeThickness: 3
    }).setScrollFactor(0).setDepth(D + 2))
    this.lvText = reg(this.add.text(px(98), px(38), '', {
      fontSize: fs(13), color: '#ffd93d', stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(D + 2))
    this.statText = reg(this.add.text(px(98), px(88), '', {
      fontSize: fs(13), color: '#c9d2e0', stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(D + 2))
    // 当前握持的冷兵器。相克系统的回报必须**常驻可见**，
    // 否则玩家永远不知道自己手上这把是克什么的。
    this.weaponText = reg(this.add.text(px(98), px(104), '', {
      fontSize: fs(12), color: '#ffe066', stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(D + 2))
    // 血量数字直接压在血条上：旧版把数字放在条上方，读血要来回找
    this.hpText = reg(this.add.text(px(98 + 95), px(58 + 7), '', {
      fontSize: fs(12), color: '#ffffff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 3))

    this.hpBar = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 2))
    this.expBar = reg(this.add.graphics().setScrollFactor(0).setDepth(D + 2))

    // ---- 右上时间块（带底衬，避免被敌人盖住）----
    this.timePanel = reg(this.add.rectangle(0, 0, px(116), px(40), 0x090912, 0.74)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(D)
      .setStrokeStyle(2, 0x4ecdc4, 0.4))
    this.timeText = reg(this.add.text(0, 0, '', {
      fontSize: fs(22), color: '#ffffff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2))

    // ---- 底部操作提示 ----
    this.hintText = reg(this.add.text(10, this.scale.height - 22,
      'WASD / 方向键 移动　·　攻击自动瞄准最近敌人　·　F 切换界面大小', {
        fontSize: fs(12), color: '#8f9bb0'
      }).setScrollFactor(0).setDepth(D))

    this.placeTimePanel()
    this.refreshHud()
  }

  private refreshHud() {
    const k = this.hudK
    const px = (v: number) => Math.round(v * k)
    this.hpText.setText(`${Math.max(0, Math.ceil(this.hp))} / ${this.maxHp}`)
    this.nameText.setText(`${this.activeChar.name}　${this.activeChar.passiveName}`)
    this.lvText.setText(`Lv.${this.level}`)
    this.statText.setText(`击杀 ${this.kills}　　分数 ${this.score}`)
    // 武器栏只显示名字：克制关系由敌潮播报 + 伤害飘字（"克38"）承担教学，
    // 常驻栏位放不下「短弓(克轻甲)·青龙偃月(克重甲)…」这种长串。
    const wnames = this.weapons.map((o) => o.def.name)
    this.weaponText.setText(wnames.length > 3
      ? `${wnames.slice(0, 3).join('·')} +${wnames.length - 3}`
      : wnames.join('·'))
    const m = Math.floor(this.elapsed / 60)
    const s = String(Math.floor(this.elapsed % 60)).padStart(2, '0')
    this.timeText.setText(`${m}:${s}`)

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
    this.expBar.fillStyle(0x4ecdc4, 1).fillRect(bx + 1, exY + 1, Math.max(0, (bw - 2) * exPct), exH - 2)
  }

  update(_t: number, delta: number) {
    if (!this.started || this.over || this.paused) return
    this.elapsed += delta / 1000
    this.tickInvuln(delta)
    this.handleMove()
    this.animatePlayer(delta)
    this.tickWeapons(delta)
    this.driveOrbits(delta)
    this.spawnDirector(delta)
    this.driveEnemies(delta)
    this.driveEnemyBullets()
    this.drivePickups()
    this.refreshHud()
    if (this.elapsed >= BALANCE.runMinutes * 60) this.gameOver(true)

    this.bg.tilePositionX = this.cameras.main.scrollX
    this.bg.tilePositionY = this.cameras.main.scrollY
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
  private animatePlayer(delta: number) {
    this.shadow.setPosition(this.player.x, this.player.y + 30)
    // 指示环轻微呼吸，让静止时也能一眼定位自己
    this.ring.setPosition(this.player.x, this.player.y + 30)
      .setAlpha(0.42 + 0.16 * Math.sin(this.elapsed * 3.4))
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
      w.cd = w.def.cooldown * this.fireCdScale
      const target = this.nearestEnemy()
      if (w.def.kind === 'gun') this.fireGun(w.def, target)
      else if (w.def.kind === 'beam') this.fireBeam(w.def, target)
      else if (w.def.kind === 'aura') this.fireAura(w.def)
    }
  }

  /**
   * 兵种相克：武器 vs 敌人护甲 的伤害倍率。
   *
   * 这是本作对抗"三国只是换皮"的核心机制 —— 敌潮的护甲构成会随时间变化
   * （早期轻甲 → 中期骑甲 → 后期重甲），玩家必须换武器应对，
   * 而不是像通用幸存者那样无脑堆 dmg%。表在 gameData.ts 的 WEAPONS[].vs。
   */
  private armorMul(vs: Partial<Record<Armor, number>> | undefined, e: Phaser.Physics.Arcade.Image) {
    if (!vs) return 1
    const a = (e.getData('armor') as Armor) || 'none'
    return vs[a] ?? 1
  }

  /** 相克反馈：克制放大飘字并标"克"，被克缩小并压暗，让玩家一眼学会看兵种。 */
  private damageLabel(mul: number) {
    if (mul >= 1.3) return { text: '#ffd93d', scale: 1.22, tag: '克' }
    if (mul >= 1.1) return { text: '#ffe9a8', scale: 1.05, tag: '' }
    if (mul <= 0.8) return { text: '#8b93a7', scale: 0.84, tag: '被克' }
    return null
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

    for (let i = 0; i < w.count; i++) {
      const a = base + (i - (w.count - 1) / 2) * (w.spread || 0)
      const b = this.bullets.get(mz.x, mz.y, 'tracer') as Phaser.Physics.Arcade.Image | null
      if (!b) continue
      const vx = Math.cos(a) * w.speed
      const vy = Math.sin(a) * w.speed
      b.setActive(true).setVisible(true).setTint(w.color)
      b.setBlendMode(Phaser.BlendModes.ADD)
      b.setRotation(a)
      b.setScale(1)
      const body = b.body as Phaser.Physics.Arcade.Body
      body.setSize(24, 6, true)
      body.setVelocity(vx, vy)
      b.setData('dmg', w.damage * this.dmgScale)
      b.setData('pierce', w.pierce + this.pierceBonus)
      b.setData('hit', new Set())
      b.setData('col', w.color)
      // 相克表随弹携带：命中时才知道打的是什么护甲，倍率在那时才算
      b.setData('vs', w.vs)
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
  }

  // 命中火花
  private spark(x: number, y: number, color: number, n = 3) {
    for (let i = 0; i < n; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const sp = Phaser.Math.FloatBetween(40, 120)
      const p = this.add
        .image(x, y, 'dot')
        .setTint(color)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(Phaser.Math.FloatBetween(0.16, 0.34))
        .setDepth(55)
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * sp,
        y: y + Math.sin(a) * sp,
        alpha: 0,
        duration: Phaser.Math.Between(160, 300),
        onComplete: () => p.destroy()
      })
    }
  }

  private shake(dur: number, intensity: number) {
    this.cameras.main.shake(dur, intensity, false)
  }

  /** 受伤时的全屏红闪。震屏只在画面中心晃，红闪覆盖整个视野，
   *  在被围住手忙脚乱时，"我掉血了"这件事必须是无条件可感知的。 */
  private redFlash() {
    const r = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xff2b2b, 0.3)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(86)
    this.tweens.add({
      targets: r, alpha: 0, duration: 230,
      onComplete: () => r.destroy()
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
    this.shake(80, 0.0022)

    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      if (this.distToSegment(e.x, e.y, mz.x, mz.y, ex, ey) < 26) {
        const mul = this.armorMul(w.vs, e)
        const dmg = w.damage * this.dmgScale * mul
        const hp = ((e.getData('hp') as number) || 0) - dmg
        const lab = this.damageLabel(mul)
        this.popDamage(e.x, e.y, dmg, lab?.text ?? '#7ef0c0', false, lab?.scale ?? 1, lab?.tag ?? '')
        if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
        this.spark(e.x, e.y, w.color, 2)
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
        const dmg = w.damage * this.dmgScale * mul
        const hp = ((e.getData('hp') as number) || 0) - dmg
        const lab = this.damageLabel(mul)
        this.popDamage(e.x, e.y, dmg, lab?.text ?? '#ffb347', false, lab?.scale ?? 1, lab?.tag ?? '')
        if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
      }
    }
  }

  private createOrbits(def: WeaponDef) {
    for (let i = 0; i < def.count; i++) {
      const o = this.orbits.get(this.player.x, this.player.y, 'dot') as Phaser.Physics.Arcade.Image | null
      if (!o) continue
      o.setActive(true).setVisible(true).setTint(def.color).setScale(Math.max(0.6, def.radius / 40))
      o.setBlendMode(Phaser.BlendModes.ADD)
      ;(o.body as Phaser.Physics.Arcade.Body).setCircle(8)
      o.setData('dmg', def.damage * this.dmgScale)
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
      const off = o.getData('off') as number
      const radius = o.getData('radius') as number
      const a = off + this.orbitAngle
      o.x = this.player.x + Math.cos(a) * radius
      o.y = this.player.y + Math.sin(a) * radius
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

  private stageIndex() {
    let idx = 0
    for (let i = 0; i < WAVE_STAGES.length; i++) {
      if (this.elapsed / 60 >= WAVE_STAGES[i].startMin) idx = i
    }
    return idx
  }

  private currentStage() {
    return WAVE_STAGES[this.stageIndex()]
  }

  /**
   * 敌潮播报：把「这一波该用什么武器」直接告诉玩家。
   *
   * 相克系统有一个致命前提 —— **它必须可读，否则等于不存在**。
   * 玩家不会去读策划案里的倍率表，唯一的教学入口就是这里：
   * 每进入新阶段时报出主威胁的兵种与护甲，并点名一件克制它的武器。
   * 三波之后玩家自己就会在升级时主动挑克制武器了。
   */
  private announceStage(idx: number) {
    const st = WAVE_STAGES[idx]
    if (!st) return
    const top = Object.entries(st.weights).sort((a, b) => b[1] - a[1])[0]
    const def = enemyById(top[0])
    const armor = ARMOR_NAMES[def.armor]
    const counter = WEAPONS.find((w) => (w.vs?.[def.armor] ?? 1) >= 1.3)
    this.toast(counter
      ? `敌军压境：${def.faction}·${def.name}（${armor}）　→　${counter.name} 可克`
      : `敌军压境：${def.faction}·${def.name}（${armor}）`)
  }

  private pickWeighted(w: Record<string, number>): string {
    let total = 0
    for (const k in w) total += w[k]
    let r = Math.random() * total
    for (const k in w) { r -= w[k]; if (r <= 0) return k }
    return Object.keys(w)[0]
  }

  private spawnDirector(delta: number) {
    for (const bs of BOSS_SCHEDULE) {
      if (this.elapsed / 60 >= bs.atMin && !this.bossesSpawned.has(bs.enemyId)) {
        this.bossesSpawned.add(bs.enemyId)
        this.spawnEnemy(enemyById(bs.enemyId), true)
      }
    }
    const si = this.stageIndex()
    if (si !== this.stageIdx) { this.stageIdx = si; this.announceStage(si) }
    this.spawnAccum += delta
    const st = this.currentStage()
    // 节奏随等级和时间一起收紧。
    // 这里的两条曲线都是**标定出来的**，不是拍脑袋：
    // 手枪 450ms/发、12 伤，2 级杂兵 28 血 → 单杀 1.35s → 0.74 只/秒。
    // 刷怪一旦超过这个速率，玩家就必然被越堆越多，与操作无关。
    const base = Math.max(300, st.spawnInterval - this.level * 9 - this.elapsed * 0.4)
    // 反雪崩节流：场上敌人越多，刷怪越慢。
    // 这是幸存者类**必须有**的负反馈。没有它时会形成死亡螺旋 ——
    // 玩家一被压制就杀不动，杀不动就堆得更多。实测数据就是这条曲线：
    // t=29 场上 10 只（还能打）→ t=45 场上 22 只、血量 100 → 0，全程没有翻盘窗口。
    // 节流保证「劣势」是压力而不是死刑：场上超过 10 只才开始刹车，越多刹得越狠。
    // 阈值定在 10 是量出来的 —— 目标稳态是「站着能看清 6~10 只朝你压过来」，
    // 这个数量在 944x649 的画面里已经足够有压迫感，又不至于糊成一片红。
    const alive = this.enemies.countActive(true)
    const throttle = Phaser.Math.Clamp(1 - (alive - 10) / 16, 0.3, 1)
    const interval = base / throttle
    if (this.spawnAccum < interval) return
    // 用减法推进累加器而不是清零：掉一帧不会整段丢掉刷怪节拍
    this.spawnAccum -= interval
    // 成群刷，但**等玩家攒够升级之后再上量**。
    // 幸存者类的压迫感来自「同时逼近的数量」，可数量必须和玩家的成长曲线同步 ——
    // 开局就成群刷等于直接把新手按死。60 秒后才开始成双，上限 2。
    const batch = Math.min(2, 1 + Math.floor(Math.max(0, this.elapsed - 60) / 80))
    for (let i = 0; i < batch; i++) {
      this.spawnEnemy(enemyById(this.pickWeighted(st.weights)), false)
    }
  }

  private spawnEnemy(def: EnemyDef, boss: boolean) {
    // 在「屏幕外一圈」出生，而不是固定半径 420 的圆上。
    // 固定半径在 944x649 的窗口里同时犯了两个错：420 小于水平半宽 472，
    // 于是左右两侧的怪直接在画面里凭空出现（pop-in）；420 又大于垂直半高 324，
    // 于是上下两侧的怪要走很远才进场。实测结果是"场上明明有 5~6 只，
    // 玩家在画面里只看得见 2~3 只" —— 主观感受就是地图很空。
    // 改成沿矩形周长出生后，每个方向都是刚好看不见的距离，进场时间一致。
    const pad = boss ? 150 : 70
    const rx = this.scale.width / 2 + pad
    const ry = this.scale.height / 2 + pad
    const pw = rx * 2
    const ph = ry * 2
    let t = Math.random() * (pw * 2 + ph * 2)
    let x: number
    let y: number
    if (t < pw) { x = this.player.x - rx + t; y = this.player.y - ry }
    else if ((t -= pw) < pw) { x = this.player.x + rx - t; y = this.player.y + ry }
    else if ((t -= pw) < ph) { x = this.player.x - rx; y = this.player.y - ry + t }
    else { t -= ph; x = this.player.x + rx; y = this.player.y + ry - t }
    // 像素单位：统一 2 倍显示（upscale=2 的 Boss 在逻辑网格里就画得更大），
    // 因此所有单位之间的像素块大小一致 —— 像素游戏的核心美学规则。
    const unit = 'foe_' + def.id
    const e = this.enemies.get(x, y, pxKey(unit)) as Phaser.Physics.Arcade.Image | null
    if (!e) return
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
    e.setData('hp', def.hp + this.level * 4)
    e.setData('dmg', def.damage)
    e.setData('sp', def.speed)
    e.setData('isBoss', !!def.isBoss)
    e.setData('touchCd', 0)
    e.setData('shockCd', 4000)
    e.setData('col', def.color)
    // 兵种护甲 —— 相克判定的输入。对象池复用必须重设，否则上一个单位的护甲会残留。
    e.setData('armor', def.armor)
    e.setData('faction', def.faction)
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
      e.setData('hpMax', def.hp + this.level * 4)
      e.setData('visW', visW)
      e.setData('visH', visH)
    }
  }

  private driveEnemies(delta: number) {
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      const sp = (e.getData('sp') as number) || 70
      const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
      const body = e.body as Phaser.Physics.Arcade.Body

      // 击退：命中时叠加一个反向速度分量，按帧衰减。命中才有"把它顶开"的手感
      const kx = (e.getData('kbx') as number) || 0
      const ky = (e.getData('kby') as number) || 0
      body.setVelocity(Math.cos(a) * sp + kx, Math.sin(a) * sp + ky)
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

        let sc = (e.getData('shockCd') as number) - delta
        if (sc <= 0) {
          sc = 4000
          if (Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y) < e.displayWidth / 2 + 130) {
            this.hp -= (e.getData('dmg') as number) || 0
            if (this.hp <= 0) this.gameOver(false)
            this.shake(160, 0.005)
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
      e.setScale(baseScale * 1.12)
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
    const dmg = (b.getData('dmg') as number) * mul
    const hp = ((e.getData('hp') as number) || 0) - dmg
    const col = (b.getData('col') as number) || 0xffe066
    this.spark(b.x, b.y, col, 2)
    // 伤害飘字：打击感里性价比最高的一环。没有它，玩家只知道"在掉血"，
    // 不知道"这一发打了几分" —— 升级收益也就无从感知。
    // 现在它还要承担第二职责：**把兵种相克教给玩家**。克制时飘字放大并标"克"，
    // 被克时缩小压暗 —— 玩家不需要读说明就知道该换武器了。
    const lab = this.damageLabel(mul)
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
    const dmg = (o.getData('dmg') as number) * mul
    const hp = ((e.getData('hp') as number) || 0) - dmg
    const lab = this.damageLabel(mul)
    this.popDamage(e.x, e.y, dmg, lab?.text ?? '#8fd6ff', false, lab?.scale ?? 1, lab?.tag ?? '')
    this.spark(e.x, e.y, 0x4ecdc4, 2)
    this.hitFlash(e)
    if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
  }

  private onPlayerHit = (_pObj: any, eObj: any) => {
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!e.active) return
    if (this.invuln > 0) return          // 无敌帧：包围圈里的多只怪只算一次伤害
    if ((e.getData('touchCd') as number) > 0) return
    e.setData('touchCd', 600)
    // 龙胆：无敌帧比其它武将长 40%，"七进七出"靠的就是这个窗口
    this.invuln = this.activeChar.passiveId === 'dash' ? 980 : 700
    const dmg = (e.getData('dmg') as number) || 0
    this.hp -= dmg
    this.shake(160, 0.006)
    this.spark(this.player.x, this.player.y, 0xff6b6b, 4)
    this.popDamage(this.player.x, this.player.y - 12, dmg, '#ff6b6b')
    this.redFlash()

    // 咆哮（张飞）：受击反弹 60% 伤害。坦克不该只是"血多"，还要有
    // "越挨打越占便宜"的正反馈，否则被围住仍然只能跑。
    if (this.activeChar.passiveId === 'thorns' && e.active) {
      const back = dmg * 0.6
      const ehp = ((e.getData('hp') as number) || 0) - back
      this.popDamage(e.x, e.y, back, '#7ec8ff', false, 0.92, '反')
      this.spark(e.x, e.y, 0x7ec8ff, 3)
      if (ehp <= 0) this.killEnemy(e); else e.setData('hp', ehp)
    }

    if (this.hp <= 0) this.gameOver(false)
  }

  private onEnemyBulletHit = (_pObj: any, bObj: any) => {
    const b = bObj as Phaser.Physics.Arcade.Image
    if (!b.active) return
    if (this.invuln > 0) return
    this.invuln = 600
    const dmg = (b.getData('dmg') as number) || 0
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
    while (this.exp >= this.expNeed) {
      this.exp -= this.expNeed
      this.levelUp()
    }
  }

  private killEnemy(e: Phaser.Physics.Arcade.Image) {
    const col = (e.getData('col') as number) || 0xffffff
    const isBoss = !!e.getData('isBoss')
    // 死亡粒子：直接消失会让"击杀"毫无手感，炸成同色像素块才读得出"打爆了"
    this.deathBurst(e.x, e.y, col, isBoss ? 22 : 8)
    this.spark(e.x, e.y, col, isBoss ? 12 : 5)
    // 震屏只留在这里和受伤时 —— 逐发子弹震屏等于一直在抖
    this.shake(isBoss ? 340 : 70, isBoss ? 0.009 : 0.0016)

    e.setActive(false).setVisible(false)
    // 立刻清掉闪白，避免回收后残留到下一次出生
    e.clearTint()
    // 停掉可能仍在跑的受击缩放 tween，否则会和"下一次出生"的 scale 设置打架
    this.tweens.killTweensOf(e)
    ;(e.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)

    // 影子与预警球是独立对象，必须一起收掉，否则会留在地上/原地不动
    const sh = e.getData('shadow') as Phaser.GameObjects.Image | undefined
    if (sh) sh.setVisible(false)
    const tg = e.getData('telegraph') as Phaser.GameObjects.Image | undefined
    if (tg) { tg.destroy(); e.setData('telegraph', undefined) }
    const bar = e.getData('hpBar') as Phaser.GameObjects.Graphics | undefined
    if (bar) { bar.destroy(); e.setData('hpBar', undefined) }

    this.kills += 1
    this.score += (isBoss ? 50 : 1)
    this.dropExp(e.x, e.y, isBoss ? 12 : 1)

    // 武圣（关羽）：每次击杀回复 3 生命。重击型武将清场慢，
    // 用"击杀即回血"把"打得准"兑换成"活得久"，形成与张飞完全不同的生存逻辑。
    if (this.activeChar.passiveId === 'lifesteal' && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 3)
      this.popDamage(this.player.x, this.player.y - 20, 3, '#8ff0a4', false, 0.82, '血')
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
    const k = this.hudK
    const px = (v: number) => Math.round(v * k)
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setScrollFactor(0).setDepth(200)

    this.uiAdd(c, this.add.rectangle(0, 0, px(420), px(322), 0x05050c, 0.92)
      .setStrokeStyle(2, 0x4ecdc4))
    this.uiAdd(c, this.add.text(0, px(-134), '升　级', {
      fontSize: `${Math.round(22 * k)}px`, color: '#ffffff'
    }).setOrigin(0.5))
    this.uiAdd(c, this.add.text(0, px(-106), '按 1 / 2 / 3 或直接点卡片', {
      fontSize: `${Math.round(13 * k)}px`, color: '#8f9bb0'
    }).setOrigin(0.5))

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
      const y = px(-52 + i * 64)
      const card = this.uiAdd(c,
        this.add.rectangle(0, y, px(364), px(56), 0x15152a, 1)
          .setStrokeStyle(2, 0x3b6f6b))
      this.uiAdd(c, this.add.text(px(-166), y - px(11), `${i + 1}.　${u.name}`, {
        fontSize: `${Math.max(12, Math.round(15 * k))}px`, color: '#ffe066'
      }).setOrigin(0, 0.5))
      this.uiAdd(c, this.add.text(px(-166), y + px(12), u.desc, {
        fontSize: `${Math.max(12, Math.round(12 * k))}px`, color: '#aab4c6'
      }).setOrigin(0, 0.5))
      // 鼠标玩家也必须能选。旧版只认数字键，纯鼠标操作会直接卡死在升级界面。
      card.setInteractive({ useHandCursor: true })
      card.on('pointerover', () => card.setFillStyle(0x22224a).setStrokeStyle(2, 0x4ecdc4))
      card.on('pointerout', () => card.setFillStyle(0x15152a).setStrokeStyle(2, 0x3b6f6b))
      card.on('pointerdown', () => choose(i))
    })

    const handler = (ev: KeyboardEvent) => {
      const idx = ['1', '2', '3'].indexOf(ev.key)
      if (idx < 0 || idx >= picks.length) return
      choose(idx)
    }
    window.addEventListener('keydown', handler)
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
      }
    } catch { /* 离线也可玩，仅无解锁内容 */ }
    for (let i = CHARS.length - 1; i >= 0; i--) {
      if (this.unlockedC.has(CHARS[i].id)) { this.activeChar = CHARS[i]; break }
    }
    this.refreshPlayerLook()
    this.showCharSelect()
  }

  private refreshPlayerLook() {
    const id = this.activeChar.id
    this.curDir = this.facing
    this.heroImg.setTexture(pxKey('hero_' + id))
    this.portrait.setTexture('portrait_' + id)
  }

  private showCharSelect() {
    if (this.selectOverlay) return
    this.started = false
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setScrollFactor(0).setDepth(500)
    this.selectOverlay = c

    this.uiAdd(c, this.add.rectangle(0, 0, 828, 468, 0x07070f, 0.96)
      .setStrokeStyle(3, 0x4ecdc4))
    this.uiAdd(c, this.add.text(0, -206, '选择你的武将', {
      fontSize: '26px', color: '#ffffff'
    }).setOrigin(0.5))
    this.uiAdd(c, this.add.text(0, -174, '上方立绘用于展示　·　下方是在游戏里的实际形象', {
      fontSize: '12px', color: '#8f9bb0'
    }).setOrigin(0.5))

    CHARS.forEach((ch, i) => {
      const x = -288 + i * 192
      const locked = !this.unlockedC.has(ch.id)
      const card = this.add.container(x, 22).setScrollFactor(0)

      const startW = weaponById(ch.weapon)
      const bg = this.uiAdd(card, this.add.rectangle(0, 0, 168, 322, 0x14142a, 1)
        .setStrokeStyle(2, locked ? 0x44445a : 0x4ecdc4))
      this.uiAdd(card, this.add.text(0, -142, ch.name, {
        fontSize: '17px', color: locked ? '#8a8a9a' : '#ffffff'
      }).setOrigin(0.5))
      // 定位：一句话说清"这个武将怎么玩"，取代旧版那个只显示名字的卡片
      this.uiAdd(card, this.add.text(0, -121, ch.title, {
        fontSize: '12px', color: locked ? '#6f7a90' : '#8fd6ff'
      }).setOrigin(0.5))
      this.uiAdd(card, this.add.image(0, -44, 'portrait_' + ch.id).setScale(0.4))

      // 游戏内实际形象：像素帧。选人时看到的就是进游戏后操作的那个单位。
      this.uiAdd(card, this.add.rectangle(0, 62, 108, 74, 0x0b0b16, 1)
        .setStrokeStyle(1, 0x33334d))
      this.uiAdd(card, this.add.sprite(0, 62, pxKey('hero_' + ch.id), pxFrame('down', 'idle', 0))
        .setScale(pxScale('hero_' + ch.id)))

      // 起始武器 + 被动 —— 这两行是"四个武将机制真的不同"的唯一对外说明。
      // 不写出来，玩家会以为四人只是换色，那这套机制就白做了。
      this.uiAdd(card, this.add.text(0, 112, `起始 ${startW ? startW.name : '—'}`, {
        fontSize: '12px', color: locked ? '#6f7a90' : '#ffe066'
      }).setOrigin(0.5))
      this.uiAdd(card, this.add.text(0, 132, `${ch.passiveName} · ${ch.passiveDesc}`, {
        fontSize: '12px', color: locked ? '#6f7a90' : '#9fe1cb'
      }).setOrigin(0.5))
      this.uiAdd(card, this.add.text(0, 150, `生命 ${ch.hp} · 移速 ${ch.speed}`, {
        fontSize: '12px', color: locked ? '#5a6070' : '#8f9bb0'
      }).setOrigin(0.5))

      if (locked) {
        this.uiAdd(card, this.add.rectangle(0, -44, 168, 190, 0x000000, 0.74))
        this.uiAdd(card, this.add.text(0, -48, '未解锁', {
          fontSize: '14px', color: '#ff6b6b'
        }).setOrigin(0.5))
        this.uiAdd(card, this.add.text(0, -22, '累计击杀可解锁', {
          fontSize: '12px', color: '#9aa0b5'
        }).setOrigin(0.5))
      } else {
        bg.setInteractive({ useHandCursor: true })
        bg.on('pointerdown', () => this.startRun(ch))
        bg.on('pointerover', () => bg.setFillStyle(0x22224a))
        bg.on('pointerout', () => bg.setFillStyle(0x14142a))
      }

      c.add(card)
    })
  }

  private startRun(char: CharDef) {
    this.activeChar = char
    this.refreshPlayerLook()
    this.applyCharStats(char)
    if (this.selectOverlay) {
      this.selectOverlay.destroy()
      this.selectOverlay = null
    }
    this.started = true
  }

  /**
   * 把武将的机制差异真正落到数值上。
   *
   * 这是"三国不只是换皮"的落点。旧版 startRun() 只调 refreshPlayerLook()，
   * 四个"武将"除贴图颜色外血量/移速/起始武器/被动**完全一致**
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
    // （弓 = gun / 青龙偃月 = beam / 蛇矛 = aura / 亮银枪 = gun+pierce）。
    this.weapons = []
    this.orbits.clear(true, true)
    this.addWeapon(weaponById(char.weapon) || WEAPONS[0])
  }

  private addWeapon(w: WeaponDef) {
    this.weapons.push({ def: w, cd: 0, angle: 0 })
    if (w.kind === 'orbit') this.createOrbits(w)
  }

  // ---------- 结算 ----------
  private gameOver(win: boolean) {
    if (this.over) return
    this.over = true
    this.physics.pause()
    this.submitScore()
    this.submitMeta(win)

    const k = this.hudK
    const px = (v: number) => Math.round(v * k)
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2)
      .setScrollFactor(0).setDepth(300)
    this.uiAdd(c, this.add.rectangle(0, 0, px(460), px(310), 0x05050c, 0.95)
      .setStrokeStyle(2, win ? 0x6bcb77 : 0xff6b6b))
    this.uiAdd(c, this.add.text(0, px(-108), win ? '通　关' : '阵　亡', {
      fontSize: `${Math.round(30 * k)}px`, color: win ? '#8ff0a4' : '#ff8f8f'
    }).setOrigin(0.5))

    const mm = Math.floor(this.elapsed / 60)
    const ss = String(Math.floor(this.elapsed % 60)).padStart(2, '0')
    const cols: [string, string][] = [
      ['击杀', String(this.kills)],
      ['分数', String(this.score)],
      ['等级', String(this.level)],
      ['存活', `${mm}:${ss}`]
    ]
    cols.forEach(([label, val], i) => {
      const bx = px(-165 + (i % 2) * 330)
      const by = px(-28 + Math.floor(i / 2) * 70)
      this.uiAdd(c, this.add.text(bx, by, val, {
        fontSize: `${Math.round(24 * k)}px`, color: '#ffd93d'
      }).setOrigin(0.5))
      this.uiAdd(c, this.add.text(bx, by + px(23), label, {
        fontSize: `${Math.max(12, Math.round(12 * k))}px`, color: '#8f9bb0'
      }).setOrigin(0.5))
    })

    // 必须有重开入口。旧版打完成绩就没了，只能手动刷新页面 ——
    // 幸存者类游戏的核心循环就是"再来一局"，这一环缺了整个手感就断了。
    const btn = this.uiAdd(c, this.add.rectangle(0, px(106), px(250), px(54), 0x1b3b3a, 1)
      .setStrokeStyle(2, 0x4ecdc4))
    this.uiAdd(c, this.add.text(0, px(106), '再来一局　(R)', {
      fontSize: `${Math.round(17 * k)}px`, color: '#ffffff'
    }).setOrigin(0.5))
    btn.setInteractive({ useHandCursor: true })
    btn.on('pointerover', () => btn.setFillStyle(0x26504e))
    btn.on('pointerout', () => btn.setFillStyle(0x1b3b3a))
    btn.on('pointerdown', () => this.restartRun())
    this.input.keyboard!.once('keydown-R', () => this.restartRun())
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
          won: win
        })
      })
      if (r.ok) {
        const m = await r.json()
        const now = (m.unlockedNow as string[]) || []
        if (now.length) this.showUnlockBanner(now)
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
      fontSize: '20px', color: '#ffe066', backgroundColor: '#00000088', padding: { x: 10, y: 6 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(400)
    this.time.delayedCall(3200, () => t.destroy())
  }

  private bossBanner(name: string) {
    const t = this.add.text(this.scale.width / 2, 90, `⚠ ${name} 出现！`, {
      fontSize: '24px', color: '#ff6b6b', backgroundColor: '#00000099', padding: { x: 12, y: 8 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(400)
    this.time.delayedCall(2600, () => t.destroy())
  }
}
