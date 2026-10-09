import Phaser from 'phaser'
import { WEAPONS, ENEMIES, UPGRADES, BALANCE, WeaponDef } from '../config/gameData'

// 幸存者类核心场景：移动 + 自动射击 + 刷怪 + 经验升级 + 三选一 + 计时/结算。
// 全程零图片资源：所有单位用一张白色圆点纹理着色，契合"轻美术"。
export class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Image
  private enemies!: Phaser.Physics.Arcade.Group
  private bullets!: Phaser.Physics.Arcade.Group
  private pickups!: Phaser.Physics.Arcade.Group
  private keys!: any

  private hp = 0
  private maxHp = 0
  private speed = 0
  private level = 1
  private exp = 0
  private expNeed = 0
  private score = 0
  private elapsed = 0
  private fireCdScale = 1
  private dmgScale = 1
  private magnet = 0
  private owned: WeaponDef[] = []
  private fireAccum = 0
  private spawnAccum = 0

  private hpText!: Phaser.GameObjects.Text
  private lvText!: Phaser.GameObjects.Text
  private timeText!: Phaser.GameObjects.Text
  private expBar!: Phaser.GameObjects.Graphics
  private paused = false
  private over = false

  constructor() {
    super('game')
  }

  create() {
    this.makeTextures()
    this.hp = this.maxHp = BALANCE.playerMaxHp
    this.speed = BALANCE.playerSpeed
    this.expNeed = BALANCE.expToLevel
    this.magnet = 60
    this.owned = [WEAPONS[0]]

    const cx = this.scale.width / 2
    const cy = this.scale.height / 2
    this.player = this.physics.add.image(cx, cy, 'dot').setTint(0x4ecdc4).setScale(1.5)
    ;(this.player.body as Phaser.Physics.Arcade.Body).setCircle(8)

    this.enemies = this.physics.add.group()
    this.bullets = this.physics.add.group()
    this.pickups = this.physics.add.group()

    this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHit as any, undefined, this)
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerHit as any, undefined, this)
    this.physics.add.overlap(this.player, this.pickups, this.onPickup as any, undefined, this)

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1)
    this.cameras.main.setBackgroundColor('#1a1a2e')

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT')
    this.buildHud()
  }

  private makeTextures() {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(8, 8, 8)
    g.generateTexture('dot', 16, 16)
    g.destroy()
  }

  private buildHud() {
    this.hpText = this.add.text(12, 12, '', { fontSize: '18px', color: '#ffffff' }).setScrollFactor(0).setDepth(100)
    this.lvText = this.add.text(12, 38, '', { fontSize: '16px', color: '#ffd93d' }).setScrollFactor(0).setDepth(100)
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
    this.lvText.setText(`Lv.${this.level}  分 ${this.score}`)
    const m = Math.floor(this.elapsed / 60)
    const s = String(Math.floor(this.elapsed % 60)).padStart(2, '0')
    this.timeText.setText(`${m}:${s}`)
    this.expBar.clear()
    this.expBar.fillStyle(0x000000, 0.4).fillRect(12, 64, 220, 10)
    this.expBar.fillStyle(0x4ecdc4, 1).fillRect(12, 64, 220 * Math.min(1, this.exp / this.expNeed), 10)
  }

  update(_t: number, delta: number) {
    if (this.over || this.paused) return
    const dt = delta / 1000
    this.elapsed += dt
    this.handleMove()
    this.autoFire(delta)
    this.spawn(delta)
    this.driveEnemies()
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

  private autoFire(delta: number) {
    this.fireAccum += delta
    const interval = Math.min(...this.owned.map((w) => w.cooldown * this.fireCdScale))
    if (this.fireAccum < interval) return
    this.fireAccum = 0
    const target = this.nearestEnemy()
    this.owned.forEach((w) => this.fireWeapon(w, target))
  }

  private fireWeapon(w: WeaponDef, target: Phaser.Physics.Arcade.Image | null) {
    const px = this.player.x
    const py = this.player.y
    const base = target ? Phaser.Math.Angle.Between(px, py, target.x, target.y) : -Math.PI / 2
    for (let i = 0; i < w.count; i++) {
      const spread = (i - (w.count - 1) / 2) * 0.18
      const a = base + spread
      const b = this.bullets.get(px, py, 'dot') as Phaser.Physics.Arcade.Image | null
      if (!b) continue
      b.setActive(true).setVisible(true).setTint(0xffe066).setScale(0.5)
      const body = b.body as Phaser.Physics.Arcade.Body
      body.setCircle(8)
      body.setVelocity(Math.cos(a) * w.speed, Math.sin(a) * w.speed)
      b.setData('dmg', w.damage * this.dmgScale)
    }
  }

  private nearestEnemy(): Phaser.Physics.Arcade.Image | null {
    let best: Phaser.Physics.Arcade.Image | null = null
    let bd = Infinity
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y)
      if (d < bd) {
        bd = d
        best = e
      }
    }
    return best
  }

  private spawn(delta: number) {
    this.spawnAccum += delta
    const interval = Math.max(250, BALANCE.spawnIntervalMs - this.level * 30)
    if (this.spawnAccum < interval) return
    this.spawnAccum = 0
    const def = ENEMIES[Phaser.Math.Between(0, ENEMIES.length - 1)]
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const r = 420
    const x = this.player.x + Math.cos(ang) * r
    const y = this.player.y + Math.sin(ang) * r
    const e = this.enemies.get(x, y, 'dot') as Phaser.Physics.Arcade.Image | null
    if (!e) return
    e.setActive(true).setVisible(true).setTint(def.color).setScale(def.radius / 8)
    e.setData('hp', def.hp + this.level * 4)
    e.setData('dmg', def.damage)
    e.setData('sp', def.speed)
    ;(e.body as Phaser.Physics.Arcade.Body).setCircle(8)
  }

  private driveEnemies() {
    const kids = this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const e of kids) {
      if (!e.active) continue
      const sp = (e.getData('sp') as number) || 70
      const a = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y)
      const body = e.body as Phaser.Physics.Arcade.Body
      body.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp)
    }
  }

  private drivePickups() {
    const kids = this.pickups.getChildren() as Phaser.Physics.Arcade.Image[]
    for (const p of kids) {
      if (!p.active) continue
      const d = Phaser.Math.Distance.Between(p.x, p.y, this.player.x, this.player.y)
      if (d < this.magnet) {
        const a = Phaser.Math.Angle.Between(p.x, p.y, this.player.x, this.player.y)
        ;(p.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a) * 260, Math.sin(a) * 260)
      }
    }
  }

  private onBulletHit = (bObj: any, eObj: any) => {
    const b = bObj as Phaser.Physics.Arcade.Image
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!b.active || !e.active) return
    const dmg = (b.getData('dmg') as number) || 0
    const hp = ((e.getData('hp') as number) || 0) - dmg
    if (hp <= 0) {
      e.setActive(false).setVisible(false)
      ;(e.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
      this.score += 1
      this.dropExp(e.x, e.y)
    } else {
      e.setData('hp', hp)
    }
    b.setActive(false).setVisible(false)
    ;(b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0)
  }

  private onPlayerHit = (_pObj: any, eObj: any) => {
    const e = eObj as Phaser.Physics.Arcade.Image
    if (!e.active) return
    const dmg = (e.getData('dmg') as number) || 0
    this.hp -= dmg
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

  private dropExp(x: number, y: number) {
    const k = this.pickups.get(x, y, 'dot') as Phaser.Physics.Arcade.Image | null
    if (!k) return
    k.setActive(true).setVisible(true).setTint(0x6bcb77).setScale(0.4)
    ;(k.body as Phaser.Physics.Arcade.Body).setCircle(8)
  }

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
    c.add(this.add.rectangle(0, 0, 360, 260, 0x000000, 0.85).setStrokeStyle(2, 0x4ecdc4))
    c.add(this.add.text(0, -100, '升级！选一个 (按 1/2/3)', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5))
    picks.forEach((u, i) => {
      c.add(
        this.add
          .text(0, -40 + i * 50, `${i + 1}. ${u.name}\n${u.desc}`, {
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
      case 'dmg':
        this.dmgScale *= 1.2
        break
      case 'spd':
        this.speed *= 1.15
        break
      case 'cd':
        this.fireCdScale *= 0.85
        break
      case 'hp':
        this.maxHp += 25
        this.hp += 25
        break
      case 'magnet':
        this.magnet += 40
        break
      case 'newgun': {
        const w = Phaser.Utils.Array.GetRandom(WEAPONS) as WeaponDef
        if (!this.owned.find((o) => o.id === w.id)) this.owned.push(w)
        break
      }
    }
  }

  private gameOver(win: boolean) {
    this.over = true
    this.physics.pause()
    const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setScrollFactor(0).setDepth(300)
    c.add(this.add.rectangle(0, 0, 400, 200, 0x000000, 0.9).setStrokeStyle(2, 0xff6b6b))
    c.add(this.add.text(0, -50, win ? '通关！' : '阵亡', { fontSize: '28px', color: '#ffffff' }).setOrigin(0.5))
    c.add(
      this.add.text(0, 0, `分数 ${this.score}   等级 ${this.level}`, { fontSize: '18px', color: '#ffd93d' }).setOrigin(0.5)
    )
    c.add(this.add.text(0, 45, '成绩已提交后端', { fontSize: '14px', color: '#aaaaaa' }).setOrigin(0.5))
    this.submitScore()
  }

  private submitScore() {
    fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'local', name: '玩家', score: this.score })
    }).catch(() => {})
  }
}
