import Phaser from 'phaser'
import { GameScene } from './scenes/GameScene'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  // 暖黑（与木地板、纸盒 UI 同族）。用冷色底会在画布边缘和场景之间露出一圈色差。
  backgroundColor: '#0e0a07',

  // ---------------------------------------------------------------------------
  // 像素渲染的两个开关（缺了它们，像素图会被 LINEAR 过滤糊成"低分辨率贴图"）
  //   pixelArt    -> 纹理采样改用 NEAREST 并关闭抗锯齿，像素块才是硬边方块
  //   roundPixels -> 顶点位置取整，避免物件落在半像素上被重采样
  // 之前游戏内单位看起来发虚，根因就是这两项没开 —— 生成器画得再准也白搭。
  // ---------------------------------------------------------------------------
  pixelArt: true,
  roundPixels: true,

  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%'
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  },
  scene: [GameScene]
}

const game = new Phaser.Game(config)

// ---------------------------------------------------------------------------
// 调试句柄。
// 保留它是**有明确用途的**：tools/shoot_game.py 通过 CDP 的 Runtime.evaluate
// 读这个句柄拿到实时对局数据（血量 / 等级 / 同屏敌人数 / 存活时间），
// 这样平衡性调整可以按数字收敛，而不是靠截图一张张猜。
// 只读，不参与游戏逻辑，对线上表现零影响。
// ---------------------------------------------------------------------------
;(window as unknown as { __sg?: Phaser.Game }).__sg = game
