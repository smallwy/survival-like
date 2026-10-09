import Phaser from 'phaser'
import {
  WEAPONS, ENEMIES, UPGRADES, WAVE_STAGES, BOSS_SCHEDULE, CHARS, META_NAMES,
  BALANCE, WeaponDef, EnemyDef, enemyById, weaponById
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

interface PxUnit { sheet: string; upscale: number; muzzle: Record<string, [number, number]> }
const PX_UNITS = pixelManifest.units as unknown as Record<string, PxUnit>

const pxKey = (unit: string) => 'px_' + unit
const pxCell = (unit: string) => (pixelManifest.grid as number) * (PX_UNITS[unit]?.upscale ?? 1)
const pxScale = (unit: string) => PX_SCALE * (PX_UNITS[unit]?.upscale ?? 1)

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
  private shadow!: Phaser.GameObjects.Ellipse
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
  private magnet = 60
  private pierceBonus = 0
  private weapons: WeaponRT[] = []
  private spawnAccum = 0
  private orbitAngle = 0
  private bossesSpawned = new Set<string>()
  private eidSeq = 0

  private hpText!: Phaser.GameObjects.Text
  private lvText!: Phaser.GameObjects.Text
  private timeText!: Phaser.GameObjects.Text
  private expBar!: Phaser.GameObjects.Graphics
  private hpBar!: Phaser.GameObjects.Graphics
  private portrait!: Phaser.GameObjects.Image
  private paused = false
  private over = false
  private started = false
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
  private unlockedW = new Set<string>(['pistol'])
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
    this.makeTextures()
    this.pid = this.resolvePid()
    this.hp = this.maxHp = BALANCE.playerMaxHp
    this.speed = BALANCE.playerSpeed
    this.expNeed = BALANCE.expToLevel
    this.magnet = 60
    const pistol = weaponById('pistol')!
    this.weapons = [{ def: pistol, cd: 0, angle: 0 }]

    const cx = this.scale.width / 2
    const cy = this.scale.height / 2

    // 地图网格背景：让空旷世界有空间感，跟随镜头移动
    this.bg = this.add.tileSprite(cx, cy, this.scale.width, this.scale.height, 'grid')
      .setScrollFactor(0)
      .setDepth(-20)

    // 玩家脚下的阴影
    this.shadow = this.add.ellipse(cx, cy + 28, 44, 13, 0x000000, 0.34).setDepth(-1)

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
    this.buildHud()
    this.loadMeta()
  }

  private resolvePid(): string {
    const p = new URLSearchParams(location.search).get('pid')
    if (p) return p
    const k = 'sg_pid'
    let v = localStorage.getItem(k)
    if (!v) { v = 'u_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(k, v) }
    return v
  }

  // 程序绘制：dot（子弹/拾取）、tracer（曳光弹）、glow（火光/光晕）、grid（背景网格）
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

    const gg = this.make.graphics({ x: 0, y: 0 }, false)
    gg.lineStyle(1, 0xffffff, 0.08)
    gg.strokeRect(0, 0, 128, 128)
    gg.fillStyle(0xffffff, 0.02)
    gg.fillRect(0, 0, 128, 128)
    gg.generateTexture('grid', 128, 128)
    gg.destroy()
  }

  private buildHud() {
    const hudBase = 99
    this.add.rectangle(4, 4, 336, 90, 0x0b0b16, 0.6)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(hudBase)
      .setStrokeStyle(1, 0x4ecdc4, 0.45)

    this.portrait = this.add.image(44, 49, 'portrait_' + this.activeChar.id)
      .setScale(PLAYER_SCALE * 0.92)
      .setScrollFactor(0)
      .setDepth(hudBase + 1)

    this.hpText = this.add.text(94, 14, '', {
      fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 3
    }).setScrollFactor(0).setDepth(hudBase + 1)
    this.lvText = this.add.text(94, 38, '', {
      fontSize: '15px', color: '#ffd93d', stroke: '#000000', strokeThickness: 2
    }).setScrollFactor(0).setDepth(hudBase + 1)
    this.timeText = this.add
      .text(this.scale.width - 12, 12, '', {
        fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(hudBase + 1)
    this.hpBar = this.add.graphics().setScrollFactor(0).setDepth(hudBase + 1)
    this.expBar = this.add.graphics().setScrollFactor(0).setDepth(hudBase + 1)
    this.refreshHud()
  }

  private refreshHud() {
    this.hpText.setText(`HP ${Math.max(0, Math.ceil(this.hp))}/${this.maxHp}`)
    this.lvText.setText(`${this.activeChar.name}  Lv.${this.level}  分 ${this.score} 杀 ${this.kills}`)
    const m = Math.floor(this.elapsed / 60)
    const s = String(Math.floor(this.elapsed % 60)).padStart(2, '0')
    this.timeText.setText(`${m}:${s}`)

    this.hpBar.clear()
    this.hpBar.fillStyle(0x000000, 0.55).fillRect(94, 60, 158, 8)
    const hpPct = Math.max(0, Math.min(1, this.hp / this.maxHp))
    const hpColor = hpPct > 0.5 ? 0x6bcb77 : hpPct > 0.25 ? 0xffd93d : 0xff6b6b
    this.hpBar.fillStyle(hpColor, 1).fillRect(94, 60, 158 * hpPct, 8)

    this.expBar.clear()
    this.expBar.fillStyle(0x000000, 0.45).fillRect(94, 72, 158, 6)
    this.expBar.fillStyle(0x4ecdc4, 1).fillRect(94, 72, 158 * Math.min(1, this.exp / this.expNeed), 6)
  }

  update(_t: number, delta: number) {
    if (!this.started || this.over || this.paused) return
    this.elapsed += delta / 1000
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
    this.shadow.setPosition(this.player.x, this.player.y + 28)
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
    this.muzzleFlash(mz.x, mz.y, w.color)
    this.shake(60, 0.0015)

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

  // 枪口火光：开火瞬间的加色光斑，快速放大淡出（坐标由 muzzlePoint 给出）
  private muzzleFlash(x: number, y: number, color: number) {
    const f = this.add
      .image(x, y, 'glow')
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.55)
      .setDepth(60)
    this.tweens.add({
      targets: f,
      scale: 1.2,
      alpha: 0,
      duration: 95,
      ease: 'Quad.easeOut',
      onComplete: () => f.destroy()
    })
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
    this.muzzleFlash(mz.x, mz.y, w.color)
    this.shake(70, 0.002)

    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      if (this.distToSegment(e.x, e.y, mz.x, mz.y, ex, ey) < 26) {
        const hp = ((e.getData('hp') as number) || 0) - w.damage * this.dmgScale
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
        const hp = ((e.getData('hp') as number) || 0) - w.damage * this.dmgScale
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

  private currentStage() {
    let st = WAVE_STAGES[0]
    for (const s of WAVE_STAGES) if (this.elapsed / 60 >= s.startMin) st = s
    return st
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
    this.spawnAccum += delta
    const st = this.currentStage()
    const interval = Math.max(220, st.spawnInterval - this.level * 8)
    if (this.spawnAccum < interval) return
    this.spawnAccum = 0
    this.spawnEnemy(enemyById(this.pickWeighted(st.weights)), false)
  }

  private spawnEnemy(def: EnemyDef, boss: boolean) {
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const r = boss ? 520 : 420
    const x = this.player.x + Math.cos(ang) * r
    const y = this.player.y + Math.sin(ang) * r
    // 像素单位：统一 2 倍显示（upscale=2 的 Boss 在逻辑网格里就画得更大），
    // 因此所有单位之间的像素块大小一致 —— 像素游戏的核心美学规则。
    const unit = 'foe_' + def.id
    const e = this.enemies.get(x, y, pxKey(unit)) as Phaser.Physics.Arcade.Image | null
    if (!e) return
    const s = pxScale(unit)

    // 复用对象池的实例：必须彻底重置上一次的残留状态，否则会出现"出生的敌人是白色的"
    // （典型原因：上一条命被 setTintFill 闪白，回调未执行就被回收，tint 残留到下一次出生）
    e.setActive(true).setVisible(true).setScale(s)
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
    if (def.shooter) {
      e.setData('shootMax', def.shootCd || 1600)
      e.setData('shootCd', def.shootCd || 1600)
      e.setData('shootDmg', def.shootDmg || 10)
    }
    e.setData('eid', ++this.eidSeq)

    // 碰撞框取视觉尺寸的 78%，让走位更宽容（除以 scale 换回 source 像素）
    const hb = def.radius * 2 * 0.78
    const body = e.body as Phaser.Physics.Arcade.Body
    body.setSize(hb / s, hb / s, true)

    if (def.isBoss) {
      this.bossBanner(def.bossName || def.name)
      this.shake(420, 0.006)
    }
  }

  private driveEnemies(delta: number) {
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      const sp = (e.getData('sp') as number) || 70
      const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
      ;(e.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a) * sp, Math.sin(a) * sp)

      // 朝向玩家：按方向换帧（下/上/侧），侧向朝左用水平翻转
      const ddx = this.player.x - e.x
      const ddy = this.player.y - e.y
      const edir: PxDir = Math.abs(ddx) >= Math.abs(ddy) ? 'side' : (ddy < 0 ? 'down' : 'up')
      // 每只怪用 eid 错开相位：否则整屏敌人同步踏步会非常机械
      const eid = (e.getData('eid') as number) || 0
      const ef = Math.floor((this.elapsed * 1000 + eid * 137) / 130) % 4
      e.setFrame(pxFrame(edir, 'walk', ef))
      e.setFlipX(edir === 'side' && ddx < 0)

      let touch = (e.getData('touchCd') as number) - delta
      if (touch < 0) touch = 0
      e.setData('touchCd', touch)

      if (e.getData('isBoss')) {
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
        // 抬手预备：开火前 260ms 起做"举身"蓄力，给玩家可读的预警
        const bs = (e.getData('baseScale') as number) || e.scaleX
        const windup = cd < 260 ? 1 - cd / 260 : 0
        e.setScale(bs * (1 + windup * 0.18))
        if (cd <= 0) {
          this.enemyShoot(e, (e.getData('shootDmg') as number) || 10)
          cd = (e.getData('shootMax') as number)
        }
        e.setData('shootCd', cd)
      }
    }
  }

  private enemyShoot(e: Phaser.Physics.Arcade.Image, dmg: number) {
    const b = this.enemyBullets.get(e.x, e.y, 'dot') as Phaser.Physics.Arcade.Image | null
    if (!b) return
    const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
    b.setActive(true).setVisible(true).setTint(0xff3b3b)
    b.setBlendMode(Phaser.BlendModes.ADD)
    b.setScale(0.55)
    ;(b.body as Phaser.Physics.Arcade.Body).setCircle(8)
    b.setVelocity(Math.cos(a) * 260, Math.sin(a) * 260)
    b.setData('dmg', dmg)
    // 射手开火也有火光，给玩家预警
    const f = this.add.image(e.x, e.y, 'glow').setTint(0xff3b3b)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(0.4).setDepth(60)
    this.tweens.add({
      targets: f, scale: 0.9, alpha: 0, duration: 130,
      onComplete: () => f.destroy()
    })
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
      if (Phaser.Math.Distance.Between(p.x, p.y, this.player.x, this.player.y) < this.magnet) {
        const a = Phaser.Math.Angle.Between(p.x, p.y, this.player.x, this.player.y)
        ;(p.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a) * 260, Math.sin(a) * 260)
      }
    }
  }

  // ---------- 碰撞回调 ----------
  private onBulletHit = (bObj: any, eObj: any) => {
    const b = bObj as Phaser.Physics.Arcade.Image
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!b.active || !e.active) return
    const hit = b.getData('hit') as Set<any>
    if (hit.has(e)) return
    hit.add(e)
    const hp = ((e.getData('hp') as number) || 0) - (b.getData('dmg') as number)
    this.spark(b.x, b.y, (b.getData('col') as number) || 0xffe066, 2)
    if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
    // 命中反馈：闪白 + 轻微缩放脉冲（比单纯变色更有"打到了"的实感）
    const baseScale = (e.getData('baseScale') as number) || e.scaleX
    e.setData('baseScale', baseScale)
    e.setTintFill(0xffffff)
    e.setScale(baseScale * 1.15)
    this.tweens.add({
      targets: e,
      scaleX: baseScale,
      scaleY: baseScale,
      duration: 110,
      ease: 'Quad.easeOut',
      onComplete: () => { if (e.active) e.clearTint() }
    })

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
    const hp = ((e.getData('hp') as number) || 0) - (o.getData('dmg') as number)
    if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
  }

  private onPlayerHit = (_pObj: any, eObj: any) => {
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!e.active) return
    if ((e.getData('touchCd') as number) > 0) return
    e.setData('touchCd', 600)
    this.hp -= (e.getData('dmg') as number) || 0
    this.shake(150, 0.005)
    this.spark(this.player.x, this.player.y, 0xff6b6b, 4)
    if (this.hp <= 0) this.gameOver(false)
  }

  private onEnemyBulletHit = (_pObj: any, bObj: any) => {
    const b = bObj as Phaser.Physics.Arcade.Image
    if (!b.active) return
    this.hp -= (b.getData('dmg') as number) || 0
    b.setActive(false).setVisible(false)
    ;(b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
    this.spark(this.player.x, this.player.y, 0xff3b3b, 4)
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
    this.spark(e.x, e.y, col, e.getData('isBoss') ? 12 : 5)
    if (e.getData('isBoss')) this.shake(320, 0.008)
    e.setActive(false).setVisible(false)
    // 立刻清掉闪白，避免回收后残留到下一次出生
    e.clearTint()
    // 停掉可能仍在跑的受击缩放 tween，否则会和"下一次出生"的 scale 设置打架
    this.tweens.killTweensOf(e)
    ;(e.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
    this.kills += 1
    this.score += (e.getData('isBoss') ? 50 : 1)
    this.dropExp(e.x, e.y, e.getData('isBoss') ? 12 : 1)
  }

  private dropExp(x: number, y: number, n = 1) {
    for (let i = 0; i < n; i++) {
      const k = this.pickups.get(
        x + Phaser.Math.FloatBetween(-12, 12),
        y + Phaser.Math.FloatBetween(-12, 12),
        'dot'
      ) as Phaser.Physics.Arcade.Image | null
      if (!k) continue
      k.setActive(true).setVisible(true).setTint(0x6bcb77)
      k.setBlendMode(Phaser.BlendModes.ADD)
      k.setScale(0.55)
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
    this.expNeed = Math.floor(this.expNeed * 1.25 + 4)
    this.paused = true
    this.physics.pause()
    this.showUpgrade()
  }

  private showUpgrade() {
    const picks = Phaser.Utils.Array.Shuffle(UPGRADES.slice()).slice(0, 3)
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setScrollFactor(0).setDepth(200)
    c.add(this.add.rectangle(0, 0, 380, 280, 0x000000, 0.85).setStrokeStyle(2, 0x4ecdc4))
    c.add(this.add.text(0, -115, '升级！选一个 (按 1/2/3)', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5))
    picks.forEach((u, i) => {
      c.add(
        this.add
          .text(0, -55 + i * 56, `${i + 1}. ${u.name}\n${u.desc}`, {
            fontSize: '15px', color: '#ffe066', align: 'center'
          })
          .setOrigin(0.5)
      )
    })
    const handler = (ev: KeyboardEvent) => {
      const idx = ['1', '2', '3'].indexOf(ev.key)
      if (idx < 0 || idx >= picks.length) return
      this.applyUpgrade(picks[idx].id)
      window.removeEventListener('keydown', handler)
      c.destroy()
      this.physics.resume()
      this.paused = false
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

  private grantRandomWeapon() {
    const avail = WEAPONS.filter((w) => this.unlockedW.has(w.id) && !this.weapons.find((o) => o.def.id === w.id))
    if (avail.length === 0) { this.dmgScale *= 1.1; return }
    const w = Phaser.Utils.Array.GetRandom(avail) as WeaponDef
    this.weapons.push({ def: w, cd: 0, angle: 0 })
    if (w.kind === 'orbit') this.createOrbits(w)
  }

  // ---------- meta ----------
  private async loadMeta() {
    try {
      const r = await fetch(`/api/meta?pid=${encodeURIComponent(this.pid)}`)
      if (r.ok) {
        const m = await r.json()
        this.unlockedW = new Set<string>(m.unlockedWeapons || ['pistol'])
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

    c.add(this.add.rectangle(0, 0, 800, 440, 0x0f0f1a, 0.96).setStrokeStyle(3, 0x4ecdc4))
    c.add(this.add.text(0, -186, '选择你的武将', { fontSize: '28px', color: '#ffffff' }).setOrigin(0.5))

    CHARS.forEach((ch, i) => {
      const x = -276 + i * 184
      const locked = !this.unlockedC.has(ch.id)
      const card = this.add.container(x, 0)

      const bg = this.add.rectangle(0, 0, 136, 190, 0x222233, 1).setStrokeStyle(2, locked ? 0x555566 : 0x4ecdc4)
      card.add(bg)

      const portrait = this.add.image(0, -30, 'portrait_' + ch.id).setScale(0.44)
      card.add(portrait)

      const name = this.add.text(0, 66, ch.name, { fontSize: '16px', color: locked ? '#888888' : '#ffffff' }).setOrigin(0.5)
      card.add(name)

      if (locked) {
        card.add(this.add.rectangle(0, -30, 136, 150, 0x000000, 0.68))
        card.add(this.add.text(0, -30, '未解锁', { fontSize: '13px', color: '#ff6b6b' }).setOrigin(0.5))
        card.add(this.add.text(0, 22, '累计击杀解锁', { fontSize: '11px', color: '#888888' }).setOrigin(0.5))
      }

      if (!locked) {
        bg.setInteractive({ useHandCursor: true })
        bg.on('pointerdown', () => this.startRun(ch))
        bg.on('pointerover', () => bg.setFillStyle(0x333344))
        bg.on('pointerout', () => bg.setFillStyle(0x222233))
      }

      c.add(card)
    })
  }

  private startRun(char: typeof CHARS[0]) {
    this.activeChar = char
    this.refreshPlayerLook()
    if (this.selectOverlay) {
      this.selectOverlay.destroy()
      this.selectOverlay = null
    }
    this.started = true
  }

  // ---------- 结算 ----------
  private gameOver(win: boolean) {
    if (this.over) return
    this.over = true
    this.physics.pause()
    this.submitScore()
    this.submitMeta(win)
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setScrollFactor(0).setDepth(300)
    c.add(this.add.rectangle(0, 0, 420, 200, 0x000000, 0.92).setStrokeStyle(2, win ? 0x6bcb77 : 0xff6b6b))
    c.add(this.add.text(0, -55, win ? '通关！' : '阵亡', { fontSize: '28px', color: '#ffffff' }).setOrigin(0.5))
    c.add(this.add.text(0, -5, `分数 ${this.score}   等级 ${this.level}   击杀 ${this.kills}`, { fontSize: '16px', color: '#ffd93d' }).setOrigin(0.5))
    c.add(this.add.text(0, 40, '成绩与解锁已提交后端', { fontSize: '13px', color: '#aaaaaa' }).setOrigin(0.5))
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
