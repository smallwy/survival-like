import Phaser from 'phaser'
import {
  WEAPONS, ENEMIES, UPGRADES, WAVE_STAGES, BOSS_SCHEDULE, CHARS, META_NAMES,
  BALANCE, WeaponDef, EnemyDef, enemyById, weaponById
} from '../config/gameData'
import rookiePortrait from '../assets/portraits/rookie.png'
import rookieUpper from '../assets/portraits/rookie_upper.png'
import rookieLower from '../assets/portraits/rookie_lower.png'
import guanyuPortrait from '../assets/portraits/guanyu.png'
import guanyuUpper from '../assets/portraits/guanyu_upper.png'
import guanyuLower from '../assets/portraits/guanyu_lower.png'
import zhangfeiPortrait from '../assets/portraits/zhangfei.png'
import zhangfeiUpper from '../assets/portraits/zhangfei_upper.png'
import zhangfeiLower from '../assets/portraits/zhangfei_lower.png'
import zhaoyunPortrait from '../assets/portraits/zhaoyun.png'
import zhaoyunUpper from '../assets/portraits/zhaoyun_upper.png'
import zhaoyunLower from '../assets/portraits/zhaoyun_lower.png'
import enemyMinion from '../assets/portraits/enemy_minion.png'
import enemyRunner from '../assets/portraits/enemy_runner.png'
import enemyTank from '../assets/portraits/enemy_tank.png'
import enemySwarm from '../assets/portraits/enemy_swarm.png'
import enemyShooter from '../assets/portraits/enemy_shooter.png'
import enemyBossWarlord from '../assets/portraits/enemy_boss_warlord.png'
import enemyBossTyrant from '../assets/portraits/enemy_boss_tyrant.png'

// 立绘统一规格（由 tools/process_portraits.py 生成）：
// - 真透明底（flood fill 抠掉与边缘连通的白底，角色内部眼白保留）
// - 裁切到角色边界后放大，角色填满 256x256 画布
// 因此下面所有 scale 都基于 TEX=256，所见即所得。
const TEX = 256
const PLAYER_SCALE = 0.22 // 256 * 0.22 ≈ 56px
// 上下半身图层的腰线比例（由 tools/split_limbs.py 按 alpha 轮廓自动探测生成）。
// 上半身以该点为旋转支点，抬手时手臂（在上半身图层内）会真正绕腰部抬起。
const WAIST: Record<string, number> = {
  rookie: 0.535,
  guanyu: 0.402,
  zhangfei: 0.703,
  zhaoyun: 0.426
}

interface WeaponRT { def: WeaponDef; cd: number; angle: number }

// 幸存者类核心场景：
// 移动 + 多类型自动武器 + 波次导演刷怪 + 射手远程 + Boss + 经验升级三选一 + 计时结算 + meta 解锁。
// 表现层：主角走路动画（bob/倾斜/压扁/扬尘）、枪口火光 + 曳光弹 + 后坐力、命中火花与闪白、震屏。
export class GameScene extends Phaser.Scene {
  // 玩家用 Container 承载 AI 立绘：可见层是缩放后的立绘图片，物理碰撞框独立设为世界单位，
  // 避免大图缩放把 Arcade 圆形碰撞框带成超大/超小（不同 Phaser 版本行为不一致）。
  private player!: Phaser.GameObjects.Container
  private playerImg!: Phaser.GameObjects.Image
  // 分层：上半身（含头+手臂+武器）绕腰部旋转 => 真正的"抬手施法"动作
  private upperImg!: Phaser.GameObjects.Image
  private lowerImg!: Phaser.GameObjects.Image
  private waistY = 0          // 腰线在屏幕像素中的 y（缩放后），抬手旋转支点
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
  private moveVx = 0        // 本帧输入方向（-1/0/1），用于 4 向朝向
  private moveVy = 0
  private faceRight = true
  private faceUp = false    // 是否背对镜头（向上走）
  private aimFacing = 1     // 施法瞬间锁定的朝向（+1 面朝右 / -1 面朝左），施法期间固定，避免每帧抖动
  private walkPhase = 0     // 走路循环相位
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
    this.load.image('portrait_rookie', rookiePortrait)
    this.load.image('portrait_guanyu', guanyuPortrait)
    this.load.image('portrait_zhangfei', zhangfeiPortrait)
    this.load.image('portrait_zhaoyun', zhaoyunPortrait)

    // 上/下半身图层，用于抬手施法
    this.load.image('upper_rookie', rookieUpper)
    this.load.image('lower_rookie', rookieLower)
    this.load.image('upper_guanyu', guanyuUpper)
    this.load.image('lower_guanyu', guanyuLower)
    this.load.image('upper_zhangfei', zhangfeiUpper)
    this.load.image('lower_zhangfei', zhangfeiLower)
    this.load.image('upper_zhaoyun', zhaoyunUpper)
    this.load.image('lower_zhaoyun', zhaoyunLower)

    this.load.image('enemy_minion', enemyMinion)
    this.load.image('enemy_runner', enemyRunner)
    this.load.image('enemy_tank', enemyTank)
    this.load.image('enemy_swarm', enemySwarm)
    this.load.image('enemy_shooter', enemyShooter)
    this.load.image('enemy_boss_warlord', enemyBossWarlord)
    this.load.image('enemy_boss_tyrant', enemyBossTyrant)
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
    this.shadow = this.add.ellipse(cx, cy + 26, 42, 13, 0x000000, 0.3).setDepth(-1)

    // 游戏内主角 = AI 立绘（分上下两层）
    // 两层内容坐标与原图一致（见 tools/split_limbs.py），因此用相同 scale/position
    // 摆放即可精确还原原图；上半身把 origin 设在腰线，rotation 即绕腰抬手。
    const waist = WAIST[this.activeChar.id] ?? 0.5
    this.waistY = waist * TEX * PLAYER_SCALE
    this.lowerImg = this.add.image(0, 0, 'lower_' + this.activeChar.id)
      .setScale(PLAYER_SCALE).setOrigin(0.5, 0.5).setDepth(8)
    this.upperImg = this.add.image(0, 0, 'upper_' + this.activeChar.id)
      .setScale(PLAYER_SCALE).setOrigin(0.5, waist).setDepth(9)
    this.playerImg = this.add.image(0, 0, 'portrait_' + this.activeChar.id)
      .setScale(PLAYER_SCALE)
      .setDepth(7)
      .setVisible(false) // 分层已覆盖整图；受击闪白时短暂启用作整体闪白
    this.player = this.add.container(cx, cy, [this.playerImg, this.lowerImg, this.upperImg])
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

    // 代码小人纹理（保留备用，当前主角与敌人都用 AI 立绘）
    this.makeHero('hero_rookie', 0x4ecdc4, {})
    this.makeHero('hero_guanyu', 0xd63031, { beard: true })
    this.makeHero('hero_zhangfei', 0x0984e3, { big: true, fierce: true })
    this.makeHero('hero_zhaoyun', 0x00b894, { spear: true })
  }

  private makeHero(key: string, color: number, o: { beard?: boolean; spear?: boolean; big?: boolean; fierce?: boolean }) {
    const W = 28
    const H = 38
    const cx = 14
    const outline = 0x141414
    const g = this.make.graphics({ x: 0, y: 0 }, false)

    g.fillStyle(0x2f2f3a, 1)
    g.fillRect(cx - 6, H - 11, 4, 11)
    g.fillRect(cx + 2, H - 11, 4, 11)

    const bw = o.big ? 20 : 15
    g.fillStyle(color, 1)
    g.fillRoundedRect(cx - bw / 2, 16, bw, 14, 4)
    g.lineStyle(2, outline, 1)
    g.strokeRoundedRect(cx - bw / 2, 16, bw, 14, 4)

    g.fillStyle(color, 1)
    g.fillRect(cx - bw / 2 - 3, 18, 3, 9)
    g.fillRect(cx + bw / 2, 18, 3, 9)

    g.fillStyle(0xffe0bd, 1)
    g.fillCircle(cx, 10, 7)
    g.lineStyle(2, outline, 1)
    g.strokeCircle(cx, 10, 7)
    g.fillStyle(0x222222, 1)
    g.fillCircle(cx - 2.5, 9, 1.2)
    g.fillCircle(cx + 2.5, 9, 1.2)
    if (o.fierce) {
      g.lineStyle(1.5, 0x222222, 1)
      g.beginPath(); g.moveTo(cx - 5, 6); g.lineTo(cx - 1, 8); g.strokePath()
      g.beginPath(); g.moveTo(cx + 5, 6); g.lineTo(cx + 1, 8); g.strokePath()
    }
    if (o.beard) {
      g.fillStyle(0x222222, 1)
      g.fillRoundedRect(cx - 5, 13, 10, 9, 3)
    }
    if (o.spear) {
      g.lineStyle(2, 0xc9c9c9, 1)
      g.beginPath(); g.moveTo(cx + bw / 2 + 6, 3); g.lineTo(cx + bw / 2 + 6, 35); g.strokePath()
      g.fillStyle(0xdddddd, 1)
      g.fillTriangle(cx + bw / 2 + 6, 0, cx + bw / 2 + 2, 7, cx + bw / 2 + 10, 7)
    }

    g.generateTexture(key, W, H)
    g.destroy()
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
    // 水平朝向：只在左右移动时翻转；上下移动保持原朝向（配合 faceUp 做"背面"表现）
    if (vx > 0) this.faceRight = true
    if (vx < 0) this.faceRight = false
    // 背对镜头：向上移动且垂直分量占优时视为背身
    this.faceUp = vy < 0 && Math.abs(vy) >= Math.abs(vx)
    const len = Math.hypot(vx, vy) || 1
    const body = this.player.body as Phaser.Physics.Arcade.Body
    body.setVelocity((vx / len) * this.speed, (vy / len) * this.speed)
  }

  // 走路 + 施法分层动画
  // 关键：下半身负责走路（起伏/迈步/倾斜），上半身独立绕腰部旋转抬手。
  // 这样抬手时手臂（在上半身图层里）会真的抬起来，而不是整张图平移。
  private animatePlayer(delta: number) {
    this.shadow.setPosition(this.player.x, this.player.y + 26)
    this.castAnim = Math.max(0, this.castAnim - delta * 0.0045)

    // ---- 走路（主要驱动下半身）----
    let bob = 0
    let leanX = 0
    let leanY = 0
    let sqx = 1
    let sqy = 1

    if (this.moving) {
      this.walkPhase += delta * 0.013
      const step = Math.sin(this.walkPhase)
      const step2 = Math.sin(this.walkPhase * 2)
      const vScale = this.moveVy !== 0 ? 1.35 : 1
      bob = Math.abs(step) * 5 * vScale
      sqx = 1 - step2 * 0.055
      sqy = 1 + step2 * 0.055
      // 8 向倾斜
      leanX = this.moveVx * 0.05
      leanY = this.moveVy * 0.045

      this.dustTimer -= delta
      if (this.dustTimer <= 0) {
        this.dustTimer = 190
        this.footDust()
      }
    } else {
      this.walkPhase = 0
      const breathe = Math.sin(this.elapsed * 2.2) * 0.012
      sqx = 1 + breathe
      sqy = 1 + breathe
    }

    const flip = this.faceUp ? this.faceRight : !this.faceRight

    // 阴影随起伏缩放，制造离地错觉
    this.shadow.setScale(1 - bob * 0.035, 1 - bob * 0.05)

    // ---------- 抬手施法 ----------
    // 设计取舍：角色在屏幕上仅约 56px，大角度腰部旋转(±35°)在这个尺寸下
    // 只会显得整个人歪斜诡异，反而看不出"手臂抬起"。因此这里以**小角度 + 位移**
    // 为主：轻微后仰蓄力 + 明显的上举与前送，靠位移和拉伸传达抬手，而不是靠大幅旋转。
    if (this.castAnim > 0.01) {
      const p = 1 - this.castAnim            // 0(刚触发) -> 1(动作结束)
      const f = this.aimFacing              // +1 面朝右，-1 面朝左（开火瞬间锁定，避免朝向跳变）
      const dirX = Math.cos(this.fireAngle)

      // 三段式（角度刻意压小，仅作为姿态微调）：
      //   p 0.00~0.32  蓄力：轻微后仰 -0.16rad
      //   p 0.32~0.64  挥出：越过中线到 +0.10rad，同时明显上举 + 前送
      //   p 0.64~1.00  回正：角度与位移平滑归零
      let swing: number
      let push: number
      if (p < 0.32) {
        swing = -0.16 * Phaser.Math.SmoothStep(p / 0.32, 0, 1)
        push = 0
      } else if (p < 0.64) {
        const e = Phaser.Math.SmoothStep((p - 0.32) / 0.32, 0, 1)
        swing = -0.16 + 0.26 * e
        push = 10 * e
      } else {
        const e = Phaser.Math.SmoothStep((p - 0.64) / 0.36, 0, 1)
        swing = 0.10 * (1 - e)
        push = 10 * (1 - e)
      }

      // strike = 挥出进度(0..1)，用于拉伸/上举；wind = 蓄力进度，用于轻微压缩
      const strike = Phaser.Math.Clamp((swing + 0.16) / 0.26, 0, 1)
      const wind = Phaser.Math.Clamp(-swing / 0.16, 0, 1)

      // 上半身：围绕腰线做小角度姿态 + 明显上举与前送
      this.upperImg.rotation = swing * f + leanX * 0.5 + leanY * 0.3
      this.upperImg.x = push * f
      this.upperImg.y = -bob - strike * 8          // 上举：抬手的主要视觉信号
      this.upperImg.setScale(
        PLAYER_SCALE * sqx * (1 + strike * 0.1),
        PLAYER_SCALE * sqy * (1 + strike * 0.13 + wind * 0.04)
      )
      this.upperImg.setFlipX(flip)

      // 下半身：仅做轻微反向剪切与下沉，配合上半身形成发力感（幅度克制，避免怪异）
      this.lowerImg.setScale(PLAYER_SCALE * sqx, PLAYER_SCALE * sqy)
      this.lowerImg.y = -bob + wind * 2.5 - strike * 1.5
      this.lowerImg.rotation = leanX + leanY * 0.6 + swing * 0.18 * f
      this.lowerImg.setFlipX(flip)
    } else {
      // 静止/走路：两层完全同步（仅保留极轻微惯性），确保严丝合缝
      const inertia = Math.sin(this.walkPhase + Math.PI) * 0.015
      this.upperImg.rotation = inertia + leanX * 0.5 + leanY * 0.3
      this.upperImg.x = 0
      this.upperImg.y = -bob
      this.upperImg.setScale(PLAYER_SCALE * sqx, PLAYER_SCALE * sqy)
      this.upperImg.setFlipX(flip)

      this.lowerImg.setScale(PLAYER_SCALE * sqx, PLAYER_SCALE * sqy)
      this.lowerImg.y = -bob
      this.lowerImg.rotation = leanX + leanY * 0.6 + inertia * 0.5
      this.lowerImg.setFlipX(flip)
    }
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
    // 瞄准即转身：开火瞬间锁定朝向目标，施法期间保持，避免"朝左却向右挥"
    this.aimFacing = Math.cos(base) >= 0 ? 1 : -1
    this.castAnim = 1
    this.muzzleFlash(px, py, base, w.color, this.waistY)
    this.shake(60, 0.0015)

    for (let i = 0; i < w.count; i++) {
      const a = base + (i - (w.count - 1) / 2) * (w.spread || 0)
      const b = this.bullets.get(px, py, 'tracer') as Phaser.Physics.Arcade.Image | null
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

  // 枪口火光：开火瞬间的加色光斑，快速放大淡出
  // muzzleY 用 waistY 让火光跟随抬起后的手部高度，使抬手动作与枪口特效咬合
  private muzzleFlash(x: number, y: number, angle: number, color: number, muzzleY = 0) {
    const d = 30
    const baseY = y - (muzzleY > 0 ? muzzleY * 0.35 : 0)
    const f = this.add
      .image(x + Math.cos(angle) * d, baseY + Math.sin(angle) * d, 'glow')
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
    const ex = px + Math.cos(ang) * w.range
    const ey = py + Math.sin(ang) * w.range

    // 外层辉光 + 内层高亮核心
    for (const [wdt, alp] of [[14, 0.28], [6, 0.9]] as [number, number][]) {
      const g = this.add.graphics().setDepth(50).setBlendMode(Phaser.BlendModes.ADD)
      g.lineStyle(wdt, w.color, alp)
      g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.strokePath()
      this.time.delayedCall(130, () => g.destroy())
    }
    this.fireAngle = ang
    this.aimFacing = Math.cos(ang) >= 0 ? 1 : -1
    this.castAnim = 1
    this.muzzleFlash(px, py, ang, w.color, this.waistY)
    this.shake(70, 0.002)

    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      if (this.distToSegment(e.x, e.y, px, py, ex, ey) < 26) {
        const hp = ((e.getData('hp') as number) || 0) - w.damage * this.dmgScale
        if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
        this.spark(e.x, e.y, w.color, 2)
      }
    }
  }

  private fireAura(w: WeaponDef) {
    const px = this.player.x
    const py = this.player.y
    // 光环是持续施法，用较弱的抬手动作 + 举身感
    this.castAnim = Math.max(this.castAnim, 0.55)
    this.fireAngle = -Math.PI / 2
    this.aimFacing = 1
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
    const tex = 'enemy_' + def.id
    const e = this.enemies.get(x, y, tex) as Phaser.Physics.Arcade.Image | null
    if (!e) return

    // 立绘已归一化填满 256 画布，故 scale = 直径 / 256，radius 即角色真实身高半径
    const s = (def.radius * 2) / TEX
    // 复用对象池的实例：必须彻底重置上一次的残留状态，否则会出现"出生的敌人是白色的"
    // （典型原因：上一条命被 setTintFill 闪白，回调未执行就被回收，tint 残留到下一次出生）
    e.setActive(true).setVisible(true).setScale(s)
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

      // 朝向玩家（水平翻转），比纯色块更有"在追你"的感觉
      e.setFlipX(e.x > this.player.x)

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
    const waist = WAIST[id] ?? 0.5
    this.waistY = waist * TEX * PLAYER_SCALE
    this.playerImg.setTexture('portrait_' + id)
    this.upperImg.setTexture('upper_' + id)
    this.lowerImg.setTexture('lower_' + id)
    // 换角色后腰线比例不同，必须同步 origin，否则抬手支点会偏
    this.upperImg.setOrigin(0.5, waist)
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
