import Phaser from 'phaser'
import { GameScene } from './scenes/GameScene'
import { TitleScene } from './scenes/TitleScene'
import ExploreScene from './scenes/ExploreScene'
import DiveScene from './scenes/DiveScene'
import { BUILD_TAG } from './config/theme'

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
  // 高 DPI 清晰度：核心结论（V6.27，源码级验证）
  //
  // Phaser 3 WebGL 渲染器的分辨率固定为 1（源码 pushScissor / gl.scissor 直接把
  // camera.width/height 当设备像素用，没有 resolution 倍率）。因此 framebuffer
  // 必须等于 gameSize，相机才能铺满画布——任何「gameSize=CSS、framebuffer=物理」
  // 的解耦方案（曾试过的 logical 模式）都会让相机只覆盖画布左上角 1/DPR²，
  // 其余露清屏色（黑边）。
  //
  // 所以正确做法不是去动 gameSize，而是：
  //   1) gameSize = canvas = CSS（RESIZE 默认行为，UI 按 CSS 像素布局，尺寸永远对）；
  //   2) 给 canvas 设 imageRendering:'pixelated'，让合成器在高 DPR 屏上用最近邻
  //      把 CSS 位图放大到物理像素——像素风保持硬边，世界清晰，且零黑边。
  //
  // 旧版「zoom 模式」（gameSize=物理、ScaleManager.zoom=1/DPR）虽能让纹理以物理
  // 分辨率渲染，但代价是「所有按 gameSize 布局的内容（卡宽 248、字号）按 1/DPR 缩小」
  // —— 高 DPR 屏上整个商店/世界变成屏幕中央一小团，正是用户反馈的「不适应切图」。
  // 现保留为 ?dprmode=zoom 的可选开关（追求极限纹理清晰度者自取），默认关闭。
  // ---------------------------------------------------------------------------
  // 关闭 Phaser 的默认抗锯齿：世界像素图必须走 NEAREST 才有硬边（pixelArt 已设）。
  antialias: false,
  // 场景顺序即启动顺序：TitleScene 在前 = 打开游戏先看到主界面（深海发光风），
  // 点「开始下潜」或按 Enter 才进入 DiveScene。
  //
  // V6 变更：入口从 ExploreScene（V5 探索器）改为 DiveScene（波次制 Bullet Heaven）。
  // ExploreScene / GameScene 均已废弃，保留注册只是为了让引用不断，S3 阶段删除。
  scene: [TitleScene, DiveScene, ExploreScene, GameScene]
}

const game = new Phaser.Game(config)

// ---------------------------------------------------------------------------
// 高 DPI 清晰度（唯一必要的运行时改动）：给画布打上 image-rendering:pixelated。
//
// Phaser 只在 Canvas 渲染器里设过这个属性，WebGL 没设；不设这个属性时，
// 高 DPR 屏的合成器会用双线性把 CSS 分辨率画布放大到物理像素→像素图发虚。
// 设了之后合成器改走最近邻→硬边像素块，和游戏本身的 NEAREST 纹理采样一致。
//
// 三种模式（?dprmode=，默认 none）：
//   none  —— 原生 RESIZE：gameSize=canvas=CSS，靠 pixelated 保持清晰。
//            无黑边、UI 尺寸永远正确、世界清晰。推荐日常使用。
//   zoom  —— 旧实现：framebuffer=物理、ScaleManager.zoom=1/DPR。纹理/文字以物理
//            分辨率渲染（最锐），但所有内容按 1/DPR 缩小（高 DPR 屏上偏小）。
//   （logical 已废弃：gameSize≠framebuffer 必出黑边，见上方说明。）
//
// 「黑边 / 视野遮挡」真根因（V6.27 定论）：早期 zoom 实现把 gameSize 改成物理后，
//   用 physW 当 resize 事件的 previousWidth 重发，而相机此刻是 CSS 尺寸，
//   CameraManager.onResize 的 cam._width===previousWidth 不成立→相机停在 CSS、
//   画布已是物理，世界只画在左上角 1/DPR² 区域。修法：previousWidth 传 CSS 尺寸，
//   或直接用 none 模式（本就不存在这个错位）。详见 docs/分辨率自适应_V6.27.md。
// ---------------------------------------------------------------------------
function installDprScale(game: Phaser.Game): void {
  const sm = game.scale
  const mode = new URLSearchParams(location.search).get('dprmode') || 'none'
  const canvas = sm.canvas
  // 关键：让合成器最近邻放大（none 模式真正依赖它；zoom 模式纹理已物理渲染，
  // pixelated 不会让它更差，顺手也设上以防某些浏览器对缩小后的小画布做平滑）。
  canvas.style.imageRendering = 'pixelated'
  ;(canvas.style as unknown as Record<string, string>).webkitImageRendering = 'pixelated'

  const origRefresh = sm.refresh.bind(sm)
  let inside = false

  const setDisplayScale = () => {
    sm.updateBounds()
    if (sm.canvasBounds.width > 0 && sm.canvasBounds.height > 0) {
      sm.displayScale.set(
        sm.baseSize.width / sm.canvasBounds.width,
        sm.baseSize.height / sm.canvasBounds.height
      )
    }
  }

  ;(sm as unknown as { refresh: () => void }).refresh = () => {
    origRefresh()
    if (inside) return          // 递归守卫：resize 会回调 refresh，避免死循环
    inside = true
    try {
      // DPR 每次都现读，不能用安装时的常量：用户改系统显示缩放（"改变分辨率"）后
      // devicePixelRatio 会变，旧常量会让画布按旧 DPR 出尺寸 → 黑边 / 视野遮挡。
      const dpr = Math.min(window.devicePixelRatio || 1, 2)  // 钳到 2，防 4K+DPR2 打爆填充率
      const cssW = Math.round(window.innerWidth)
      const cssH = Math.round(window.innerHeight)
      const prevW = sm.width
      const prevH = sm.height
      const emit = () => {
        sm.emit('resize', sm.gameSize, sm.baseSize, sm.displaySize, prevW, prevH)
        game.events.emit('resize')
      }

      if (mode === 'none' || dpr <= 1) {
        // 原生 RESIZE：gameSize=canvas=CSS，无需改画布尺寸，pixelated 负责清晰。
        // 默认行为已正确，这里直接返回（origRefresh 已经发过正确的 resize 事件，
        // 相机也会随之铺满 CSS 尺寸的画布 → 零黑边）。
        return
      }

      // zoom（可选）：framebuffer=物理、ScaleManager.zoom=1/DPR。
      // 注意 previousWidth 必须传 CSS 尺寸（prevW/prevH），否则相机停在 CSS、
      // 画布已是物理→黑边。这是 V6.27 之前黑边的根因。
      const physW = Math.round(cssW * dpr)
      const physH = Math.round(cssH * dpr)
      sm.zoom = 1 / dpr
      if (sm.width !== physW || sm.height !== physH) {
        sm.gameSize.resize(physW, physH)
        sm.baseSize.resize(physW, physH)
        sm.displaySize.setSize(cssW, cssH)
        canvas.width = physW
        canvas.height = physH
        canvas.style.width = cssW + 'px'
        canvas.style.height = cssH + 'px'
        setDisplayScale()
        emit()
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
// 文字光栅化倍率：高 DPR 屏上 canvas 会被合成器用最近邻放大 dpr 倍，
// 文字若只按 3x 光栅，3x 采样再被 2x 最近邻放大→等效 1.5x，会偏「脆」。
// 所以在 dpr>1 时把光栅倍率提到 2*dpr（钳到 6），让文字在物理屏上仍锐利。
// 代价是文字纹理显存按倍率平方增长，但 UI 文字总量小，可忽略。
// ---------------------------------------------------------------------------
;(() => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const TXT_RES = Math.min(Math.max(3, Math.round(dpr * 2)), 6)
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as Record<string, unknown>
  const orig = factory.text as (...args: unknown[]) => Phaser.GameObjects.Text
  factory.text = function (this: unknown, x: number, y: number, text: string, style?: object, padding?: unknown) {
    return orig.call(this, x, y, text, { resolution: TXT_RES, ...(style ?? {}) }, padding)
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

// 启动横幅：按 F12 就能确认跑的是哪个版本、DPR 与 gameSize 是多少。
// 用于把"代码没更新"和"代码有 bug"这两类问题分开——这是本项目反复踩的坑。
console.log(
  `[深海回响] ${BUILD_TAG} 启动　` +
  `DPR=${window.devicePixelRatio}　` +
  `mode=${(new URLSearchParams(location.search).get('dprmode') || 'none')}　` +
  `gameSize=${game.scale.width}x${game.scale.height}　` +
  `displayScale=${game.scale.displayScale.x}`
)
