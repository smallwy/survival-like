import Phaser from 'phaser'
import { GameScene } from './scenes/GameScene'
import { TitleScene } from './scenes/TitleScene'
import ExploreScene from './scenes/ExploreScene'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  // 深渊近黑蓝（V4 霓虹冷色）。旧版是暖黑 #0e0a07（V3「鎏金/木地板」遗留），
  // 画布边缘会露出暖色，和场景的冷色万能不对。
  backgroundColor: '#04070d',

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
  // ---------------------------------------------------------------------------
  // 分辨率对齐设备像素比（本轮「画面糊」的根因修复）。
  //
  // 实测数据（tools/diag_dpr.py，Chromium + --force-device-scale-factor）：
  //   DPR=1.0  canvas 位图 960×661  → CSS 960×661   1.0 倍  ✓ 清晰
  //   DPR=1.5  canvas 位图 960×661  → 物理 1440×991  1.5 倍  ✗ 糊
  //   DPR=2.0  canvas 位图 960×661  → 物理 1920×1322 2.0 倍  ✗ 糊
  //
  // RESIZE 模式让 canvas **位图缓冲区 = 逻辑 CSS 尺寸**，在高 DPR 屏幕
  // （Windows 125%/150% 显示缩放是最常见的）上由浏览器合成阶段放大 1.25~2 倍。
  // 叠加 pixelArt 的 NEAREST 采样后，像素块大小不均 —— 这就是"糊"的头号来源，
  // 和选不选像素风无关（《土豆兄弟》本身也是卡通描边风，它清晰是因为原生 App
  // 的 canvas 与物理像素 1:1）。
  //
  // Phaser 3 没有顶层 canvas resolution 配置项（Phaser 2 有，3 移除了），
  // 所以走**手动同步**：见下方 syncCanvasToDpr()，把 canvas 的位图尺寸设为
  // 「CSS 尺寸 × DPR」，再由 Phaser 的 Game.scale 重新设定 gameSize。
  // 代价：显存与填充率按 DPR² 增长（DPR2 时 4 倍像素），对 2D 像素游戏可接受。
  // ---------------------------------------------------------------------------
  // 关闭 Phaser 的默认抗锯齿：世界像素图必须走 NEAREST 才有硬边（pixelArt 已设）。
  antialias: false,
  // 场景顺序即启动顺序：TitleScene 在前 = 打开游戏先看到主界面（深海发光风），
  // 点「开始下潜」或按 Enter 才 scene.start('explore') 进探索器。
  //
  // GameScene 是 V3 的割草场景，V4 已废弃玩法方向（见《项目计划书》V4 §1），
  // 保留注册只是为了让引用不断，S3 阶段随文件一并删除；主界面不再路由过去。
  scene: [TitleScene, ExploreScene, GameScene]
}

const game = new Phaser.Game(config)

// ---------------------------------------------------------------------------
// 高 DPI 画布：让渲染分辨率 = 物理像素，消除浏览器合成期的拉伸。
//
// 走过的弯路（重要，别再踩）：
//   1) 直接在 Phaser 设好 canvas 之后手改 canvas.width/height **不行** ——
//      渲染器初始化时已按当时 gameSize 定好投影与视口，事后改 canvas 只会重置
//      2D 上下文，渲染器仍按旧尺寸画 → "内容只在左上角、右侧和底部全黑"。
//   2) 在拦截的 refresh 里再调 sm.resize() 会**无限递归**
//      （resize → refresh → resize…），栈溢出，DPR 根本不生效。
//
// 正确做法：用 Phaser 自己的 **zoom** 机制（见 ScaleManager.resize）：
//   canvas.width       = width          (gameSize，即**渲染分辨率**)
//   canvas.style.width = width * zoom   (显示尺寸)
// 所以把「渲染分辨率」设为物理像素、zoom 设为 1/DPR，
// 就得到「高位图 + 逻辑显示尺寸」，且 gameSize = 物理像素 →
// 所有按 gameSize 布局的 UI 自动变清晰。
//
// 实现：包一层 refresh，**只做计算、不再回调 resize**（用递归守卫），
// 直接写 gameSize/baseSize/canvas 属性，复刻 ScaleManager.resize 的核心几行。
// ---------------------------------------------------------------------------
function installDprScale(game: Phaser.Game): void {
  const sm = game.scale
  const dpr = Math.min(window.devicePixelRatio || 1, 2)  // 钳到 2，防 4K+DPR2 打爆填充率
  if (dpr <= 1) return  // DPR=1 无需处理，直接用 Phaser 原生逻辑

  const origRefresh = sm.refresh.bind(sm)
  let inside = false
  ;(sm as unknown as { refresh: () => void }).refresh = () => {
    origRefresh()
    if (inside) return          // 递归守卫：resize 会回调 refresh，避免死循环
    inside = true
    try {
      const cssW = Math.round(window.innerWidth)
      const cssH = Math.round(window.innerHeight)
      const physW = Math.round(cssW * dpr)
      const physH = Math.round(cssH * dpr)
      if (sm.width !== physW || sm.height !== physH) {
        // 渲染分辨率 = 物理像素；显示尺寸 = CSS 逻辑尺寸（zoom 负责缩回）
        sm.zoom = 1 / dpr
        sm.gameSize.resize(physW, physH)
        sm.baseSize.resize(physW, physH)
        sm.displaySize.setSize(cssW, cssH)
        sm.canvas.width = physW
        sm.canvas.height = physH
        sm.canvas.style.width = cssW + 'px'
        sm.canvas.style.height = cssH + 'px'
        // ---------------------------------------------------------------------
        // canvasBounds **必须是 canvas 的 CSS 矩形**（1280×720），不是位图尺寸。
        //
        // 这里曾经写成 setSize(physW, physH)，后果（2026-10-10 实测，不是推测）：
        //   ScaleManager.refresh() 里有 displayScale = baseSize / canvasBounds，
        //   于是 displayScale = 2560 / 2560 = 1。
        //   而 Phaser 的指针换算是 (pageX - bounds.left) * displayScale：
        //   鼠标点在 CSS 640，被换算成游戏坐标 640 —— 但按钮在 1280，
        //   **永远差一半**，所以 DPR>1 的机器上所有按钮点了都没反应。
        //   （DPR=1 时 physW == cssW，这个 bug 不显现，所以一直没被发现。）
        // ---------------------------------------------------------------------
        sm.updateBounds()
        if (sm.canvasBounds.width > 0 && sm.canvasBounds.height > 0) {
          sm.displayScale.set(
            sm.baseSize.width / sm.canvasBounds.width,
            sm.baseSize.height / sm.canvasBounds.height
          )
        }
        // 通知渲染器与相机同步新的尺寸。
        // 注意事件必须发在 **scale** 上：GameScene 用的是 this.scale.on('resize')，
        // 发在 game.events 上没人听（实测 GameScene 不重排，内容只占左上角）。
        sm.emit('resize', sm.gameSize, sm.baseSize, sm.displaySize, physW, physH)
        game.events.emit('resize')
      }
    } finally {
      inside = false
    }
  }
}

installDprScale(game)

// 安装后立即触发一次：Phaser 的初始化 refresh 发生在**补丁安装之前**，
// 不主动跑一次的话，首帧仍是逻辑分辨率（实测 canvas.width 停在 1280）。
// 用 rAF 推迟到 Phaser 完成首帧布局之后，避免和它的 READY 流程抢时序。
requestAnimationFrame(() => {
  game.scale.refresh()
  requestAnimationFrame(() => game.scale.refresh())
})
// 窗口尺寸/DPR 变化时也要重算（refresh 已被上面的补丁接管，会带上 DPR）
window.addEventListener('resize', () => game.scale.refresh())

// ---------------------------------------------------------------------------
// 文字光栅化倍率（本轮从 2 提到 3）。
//
// 为什么是 3 而不是 2：文字发虚有**三重放大**同时作用 ——
//   1) 面板容器 setScale(fit≤1.25) 整体放大；
//   2) 高 DPR 屏幕上 canvas 被浏览器拉伸（resolution 修复前最高 2 倍）；
//   3) 中文字形本身比拉丁字母笔画多，同样的光栅倍率下更早糊。
// 三者相乘，2x 光栅在高 DPR 屏上仍是被放大采样。提到 3x 后，
// 即使叠加最坏情况（1.25 面板缩放 × 2 DPR 合成）也变成缩小采样 —— 锐利。
//
// 代价：每条文字纹理占 9 倍于 1x 的显存（3² ）。但 UI 文字总量小
// （HUD + 弹窗，数十条量级），按 128px 字号估算单条 3x 纹理约 0.5MB，
// 全屏文字合计仍在个位数 MB，对 2D 游戏可忽略。
//
// 注意：这只作用于 Text。世界像素图**必须**保持 NEAREST 1x（见上 pixelArt），
// 像素图放大只会变成色块，用高分光栅没有意义。
// ---------------------------------------------------------------------------
;(() => {
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as Record<string, unknown>
  const orig = factory.text as (...args: unknown[]) => Phaser.GameObjects.Text
  factory.text = function (this: unknown, x: number, y: number, text: string, style?: object, padding?: unknown) {
    return orig.call(this, x, y, text, { resolution: 3, ...(style ?? {}) }, padding)
  } as typeof orig
})()

// ---------------------------------------------------------------------------
// 调试句柄。
// 保留它是**有明确用途的**：tools/shoot_game.py 通过 CDP 的 Runtime.evaluate
// 读这个句柄拿到实时对局数据（血量 / 等级 / 同屏敌人数 / 存活时间），
// 这样平衡性调整可以按数字收敛，而不是靠截图一张张猜。
// 只读，不参与游戏逻辑，对线上表现零影响。
// ---------------------------------------------------------------------------
;(window as unknown as { __sg?: Phaser.Game }).__sg = game
