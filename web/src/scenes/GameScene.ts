import Phaser from 'phaser'
import {
  WEAPONS, ENEMIES, UPGRADES, WAVE_STAGES, BOSS_SCHEDULE, CHARS, META_NAMES,
  BALANCE, WeaponDef, EnemyDef, enemyById, weaponById
} from '../config/gameData'
import rookiePortrait from '../assets/portraits/rookie.png'
import guanyuPortrait from '../assets/portraits/guanyu.png'
import zhangfeiPortrait from '../assets/portraits/zhangfei.png'
import zhaoyunPortrait from '../assets/portraits/zhaoyun.png'

  // 幸存者类核心场景：
// 移动 + 多类型自动武器 + 波次导演刷怪 + 射手远程 + Boss + 经验升级三选一 + 计时结算 + meta 解锁。
// 美术策略：
// - 游戏内主角：直接用 AI 生成的 1024x1024 chibi 立绘（缩小到约 60px），玩家看到的就是立绘本人。
// - 选人/HUD/结算：同一套 AI 立绘 PNG（更大的展示）。
// - 子弹/敌人/拾取：白色圆点运行时着色。
interface WeaponRT { def: WeaponDef; cd: number; angle: number }

export class GameScene extends Phaser.Scene {
  // 玩家用 Container 承载 AI 立绘：可见层是缩放后的立绘图片，物理碰撞框独立设为世界单位，
  // 避免 1024 大图缩放把 Arcade 圆形碰撞框带成超大/超小（不同 Phaser 版本行为不一致）。
  private player!: Phaser.GameObjects.Container
  private playerImg!: Phaser.GameObjects.Image
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
  private portrait!: Phaser.GameObjects.Image
  private paused = false
  private over = false
  private started = false
  private selectOverlay!: Phaser.GameObjects.Container | null

  // meta（跨局解锁）
  private unlockedW = new Set<string>(['pistol'])
  private unlockedC = new Set<string>(['rookie'])
  private activeChar = CHARS[0]
  private pid = 'local'

  constructor() { super('game') }

  preload() {
    // 预加载 AI 生成的 chibi 立绘（Vite 会把 import 解析为打包后 URL）
    this.load.image('portrait_rookie', rookiePortrait)
    this.load.image('portrait_guanyu', guanyuPortrait)
    this.load.image('portrait_zhangfei', zhangfeiPortrait)
    this.load.image('portrait_zhaoyun', zhaoyunPortrait)
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
    // 游戏内主角 = AI 立绘：Container 承载缩放后的立绘图片，碰撞框独立设成世界单位。
    this.playerImg = this.add.image(0, 0, 'portrait_' + this.activeChar.id).setScale(0.06)
    this.player = this.add.container(cx, cy, [this.playerImg])
    this.physics.add.existing(this.player)
    const pbody = this.player.body as Phaser.Physics.Arcade.Body
    pbody.setSize(46, 46)
    pbody.setOffset(-23, -23)

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
    this.cameras.main.setBackgroundColor('#1a1a2e')

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

  // 程序绘制所有纹理：dot 供子弹/敌人/拾取；hero_ 为代码小人纹理（保留备用，当前主角改用 AI 立绘）。
  private makeTextures() {
    // 通用圆点（白底，运行时着色）
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(8, 8, 8)
    g.generateTexture('dot', 16, 16)
    g.destroy()

    // 角色立绘（分辨率统一 28x38，按角色换色 + 换配件区分）
    this.makeHero('hero_rookie', 0x4ecdc4, {})                       // 新人：青衫，无配件
    this.makeHero('hero_guanyu', 0xd63031, { beard: true })           // 关二哥：红袍 + 长髯
    this.makeHero('hero_zhangfei', 0x0984e3, { big: true, fierce: true }) // 张三爷：蓝甲 + 壮 + 怒眉
    this.makeHero('hero_zhaoyun', 0x00b894, { spear: true })          // 赵子龙：白甲 + 长枪
  }

  // 绘制一个 chibi 小人：头(肤色) + 身(角色色) + 腿 + 可选项(髯/枪/壮/怒眉)，全部程序生成、零图片。
  private makeHero(key: string, color: number, o: { beard?: boolean; spear?: boolean; big?: boolean; fierce?: boolean }) {
    const W = 28
    const H = 38
    const cx = 14
    const outline = 0x141414
    const g = this.make.graphics({ x: 0, y: 0 }, false)

    // 腿
    g.fillStyle(0x2f2f3a, 1)
    g.fillRect(cx - 6, H - 11, 4, 11)
    g.fillRect(cx + 2, H - 11, 4, 11)

    // 身体（壮角色更宽）
    const bw = o.big ? 20 : 15
    g.fillStyle(color, 1)
    g.fillRoundedRect(cx - bw / 2, 16, bw, 14, 4)
    g.lineStyle(2, outline, 1)
    g.strokeRoundedRect(cx - bw / 2, 16, bw, 14, 4)

    // 手臂
    g.fillStyle(color, 1)
    g.fillRect(cx - bw / 2 - 3, 18, 3, 9)
    g.fillRect(cx + bw / 2, 18, 3, 9)

    // 头
    g.fillStyle(0xffe0bd, 1)
    g.fillCircle(cx, 10, 7)
    g.lineStyle(2, outline, 1)
    g.strokeCircle(cx, 10, 7)
    // 眼睛
    g.fillStyle(0x222222, 1)
    g.fillCircle(cx - 2.5, 9, 1.2)
    g.fillCircle(cx + 2.5, 9, 1.2)
    // 怒眉（张飞）
    if (o.fierce) {
      g.lineStyle(1.5, 0x222222, 1)
      g.beginPath(); g.moveTo(cx - 5, 6); g.lineTo(cx - 1, 8); g.strokePath()
      g.beginPath(); g.moveTo(cx + 5, 6); g.lineTo(cx + 1, 8); g.strokePath()
    }
    // 长髯（关羽）
    if (o.beard) {
      g.fillStyle(0x222222, 1)
      g.fillRoundedRect(cx - 5, 13, 10, 9, 3)
    }
    // 长枪（赵云）
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
    // 左上角 AI 立绘（放大展示）
    this.portrait = this.add.image(34, 50, 'portrait_' + this.activeChar.id).setScale(0.06).setScrollFactor(0).setDepth(100)
    this.hpText = this.add.text(78, 14, '', { fontSize: '18px', color: '#ffffff' }).setScrollFactor(0).setDepth(100)
    this.lvText = this.add.text(78, 40, '', { fontSize: '15px', color: '#ffd93d' }).setScrollFactor(0).setDepth(100)
    this.timeText = this.add
      .text(this.scale.width - 12, 12, '', { fontSize: '18px', color: '#ffffff' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100)
    this.expBar = this.add.graphics().setScrollFactor(0).setDepth(100)
    this.refreshHud()
  }

  private refreshHud() {
    this.hpText.setText(`HP ${Math.max(0, Math.ceil(this.hp))}/${this.maxHp}`)
    this.lvText.setText(`${this.activeChar.name}  Lv.${this.level}  分 ${this.score}  杀 ${this.kills}`)
    const m = Math.floor(this.elapsed / 60)
    const s = String(Math.floor(this.elapsed % 60)).padStart(2, '0')
    this.timeText.setText(`${m}:${s}`)
    this.expBar.clear()
    this.expBar.fillStyle(0x000000, 0.4).fillRect(78, 62, 200, 10)
    this.expBar.fillStyle(0x4ecdc4, 1).fillRect(78, 62, 200 * Math.min(1, this.exp / this.expNeed), 10)
  }

  update(_t: number, delta: number) {
    if (!this.started || this.over || this.paused) return
    this.elapsed += delta / 1000
    this.handleMove()
    this.tickWeapons(delta)
    this.driveOrbits(delta)
    this.spawnDirector(delta)
    this.driveEnemies(delta)
    this.driveEnemyBullets()
    this.drivePickups()
    this.refreshHud()
    if (this.elapsed >= BALANCE.runMinutes * 60) this.gameOver(true)
  }

  private handleMove() {
    const k = this.keys
    let vx = 0
    let vy = 0
    if (k.A.isDown || k.LEFT.isDown) vx -= 1
    if (k.D.isDown || k.RIGHT.isDown) vx += 1
    if (k.W.isDown || k.UP.isDown) vy -= 1
    if (k.S.isDown || k.DOWN.isDown) vy += 1
    const len = Math.hypot(vx, vy) || 1
    const body = this.player.body as Phaser.Physics.Arcade.Body
    body.setVelocity((vx / len) * this.speed, (vy / len) * this.speed)
  }

  // ---------- 武器 ----------
  private tickWeapons(delta: number) {
    for (const w of this.weapons) {
      if (w.def.kind === 'orbit') continue // 环绕球由 driveOrbits 处理移动，伤害走 overlap
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
    for (let i = 0; i < w.count; i++) {
      const a = base + (i - (w.count - 1) / 2) * (w.spread || 0)
      const b = this.bullets.get(px, py, 'dot') as Phaser.Physics.Arcade.Image | null
      if (!b) continue
      b.setActive(true).setVisible(true).setTint(w.color).setScale(0.5)
      const body = b.body as Phaser.Physics.Arcade.Body
      body.setCircle(8)
      body.setVelocity(Math.cos(a) * w.speed, Math.sin(a) * w.speed)
      b.setData('dmg', w.damage * this.dmgScale)
      b.setData('pierce', w.pierce + this.pierceBonus)
      b.setData('hit', new Set())
    }
  }

  private fireBeam(w: WeaponDef, target: Phaser.Physics.Arcade.Image | null) {
    const px = this.player.x
    const py = this.player.y
    const ang = target ? Phaser.Math.Angle.Between(px, py, target.x, target.y) : -Math.PI / 2
    const ex = px + Math.cos(ang) * w.range
    const ey = py + Math.sin(ang) * w.range
    const g = this.add.graphics().setDepth(50)
    g.lineStyle(4, w.color, 0.9)
    g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.strokePath()
    this.time.delayedCall(120, () => g.destroy())
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      if (this.distToSegment(e.x, e.y, px, py, ex, ey) < 26) {
        const hp = ((e.getData('hp') as number) || 0) - w.damage * this.dmgScale
        if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
      }
    }
  }

  private fireAura(w: WeaponDef) {
    const px = this.player.x
    const py = this.player.y
    const g = this.add.graphics().setDepth(40)
    g.fillStyle(w.color, 0.22); g.fillCircle(px, py, w.radius)
    g.lineStyle(3, w.color, 0.8); g.strokeCircle(px, py, w.radius)
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
    const e = this.enemies.get(x, y, 'dot') as Phaser.Physics.Arcade.Image | null
    if (!e) return
    e.setActive(true).setVisible(true).setTint(def.color).setScale(def.radius / 8)
    e.setData('hp', def.hp + this.level * 4)
    e.setData('dmg', def.damage)
    e.setData('sp', def.speed)
    e.setData('isBoss', !!def.isBoss)
    e.setData('touchCd', 0)
    e.setData('shockCd', 4000)
    if (def.shooter) {
      e.setData('shootMax', def.shootCd || 1600)
      e.setData('shootCd', def.shootCd || 1600)
      e.setData('shootDmg', def.shootDmg || 10)
    }
    e.setData('eid', ++this.eidSeq)
    ;(e.body as Phaser.Physics.Arcade.Body).setCircle(8)
    if (def.isBoss) this.bossBanner(def.bossName || def.name)
  }

  private driveEnemies(delta: number) {
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      const sp = (e.getData('sp') as number) || 70
      const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
      ;(e.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a) * sp, Math.sin(a) * sp)

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
          }
        }
        e.setData('shockCd', sc)
      }

      if (e.getData('shootMax') > 0) {
        let cd = (e.getData('shootCd') as number) - delta
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
    b.setActive(true).setVisible(true).setTint(0xff3b3b).setScale(0.45)
    ;(b.body as Phaser.Physics.Arcade.Body).setCircle(8)
    const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
    b.setVelocity(Math.cos(a) * 260, Math.sin(a) * 260)
    b.setData('dmg', dmg)
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
    if (hp <= 0) this.killEnemy(e); else e.setData('hp', hp)
    let pierce = (b.getData('pierce') as number) || 0
    if (pierce > 0) b.setData('pierce', pierce - 1)
    else { b.setActive(false).setVisible(false); (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0) }
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
    if (this.hp <= 0) this.gameOver(false)
  }

  private onEnemyBulletHit = (_pObj: any, bObj: any) => {
    const b = bObj as Phaser.Physics.Arcade.Image
    if (!b.active) return
    this.hp -= (b.getData('dmg') as number) || 0
    b.setActive(false).setVisible(false)
    ;(b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
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
    e.setActive(false).setVisible(false)
    ;(e.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
    this.kills += 1
    this.score += (e.getData('isBoss') ? 50 : 1)
    this.dropExp(e.x, e.y, e.getData('isBoss') ? 12 : 1)
  }

  private dropExp(x: number, y: number, n = 1) {
    for (let i = 0; i < n; i++) {
      const k = this.pickups.get(x + Phaser.Math.FloatBetween(-12, 12), y + Phaser.Math.FloatBetween(-12, 12), 'dot') as Phaser.Physics.Arcade.Image | null
      if (!k) continue
      k.setActive(true).setVisible(true).setTint(0x6bcb77).setScale(0.4)
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
            fontSize: '15px',
            color: '#ffe066',
            align: 'center'
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
    // 默认选已解锁里最后一个（赵云最后）
    for (let i = CHARS.length - 1; i >= 0; i--) {
      if (this.unlockedC.has(CHARS[i].id)) { this.activeChar = CHARS[i]; break }
    }
    this.refreshPlayerLook()
    this.showCharSelect()
  }

  // 同步更新游戏内主角立绘 + HUD AI 立绘
  private refreshPlayerLook() {
    this.playerImg.setTexture('portrait_' + this.activeChar.id)
    this.portrait.setTexture('portrait_' + this.activeChar.id)
  }

  // 开局选人界面：用 AI 立绘做成卡片，未解锁角色灰显并提示
  private showCharSelect() {
    if (this.selectOverlay) return
    this.started = false
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setScrollFactor(0).setDepth(500)
    this.selectOverlay = c

    c.add(this.add.rectangle(0, 0, 780, 420, 0x0f0f1a, 0.95).setStrokeStyle(3, 0x4ecdc4))
    c.add(this.add.text(0, -170, '选择你的武将', { fontSize: '28px', color: '#ffffff' }).setOrigin(0.5))

    CHARS.forEach((ch, i) => {
      const x = -270 + i * 180
      const locked = !this.unlockedC.has(ch.id)
      const card = this.add.container(x, 0)

      const bg = this.add.rectangle(0, 0, 130, 170, 0x222233, 1).setStrokeStyle(2, locked ? 0x555566 : 0x4ecdc4)
      card.add(bg)

      const portrait = this.add.image(0, -25, 'portrait_' + ch.id).setScale(0.095)
      card.add(portrait)

      const name = this.add.text(0, 55, ch.name, { fontSize: '16px', color: locked ? '#888888' : '#ffffff' }).setOrigin(0.5)
      card.add(name)

      if (locked) {
        card.add(this.add.rectangle(0, -25, 130, 130, 0x000000, 0.65))
        card.add(this.add.text(0, -25, '未解锁', { fontSize: '13px', color: '#ff6b6b' }).setOrigin(0.5))
        card.add(this.add.text(0, 25, '累计击杀解锁', { fontSize: '11px', color: '#888888' }).setOrigin(0.5))
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
