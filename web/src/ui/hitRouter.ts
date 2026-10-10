/**
 * 屏幕空间点击路由器 —— 绕开 Phaser 的容器输入命中缺陷。
 *
 * 为什么需要它（2026-10-10 实测，无头浏览器 + CDP 探针，tools/diag_input2.py）：
 *
 *   只要 overlay 容器调过 `setScale(fit)`，且镜头 scrollX/scrollY ≠ 0
 *   （局内镜头跟随玩家，必然非 0），容器里 `setInteractive()` 的对象
 *   永远命中 **0 个** ——「进入下一波」、商店卡、升级三选一、结算按钮
 *   全部点了没反应；而镜头在 (0,0) 时（备战界面）一切正常。
 *   最小复现：单层 scrollFactor=0 容器 + setScale(1.04) + 镜头滚动 = miss。
 *   这是 Phaser 输入系统对「scrollFactor=0 + 缩放容器」的局部坐标换算错误，
 *   不是本项目代码写错 —— 但必须在这里绕开。
 *
 * 全项目约定：**UI 热区一律不 setInteractive**，改走本路由器：
 *   1. `registerUiHit(scene, ...)` 登记热区（传入热区矩形对象 + 尺寸 + 回调）；
 *   2. GameScene 把 pointerdown / pointermove 交给 `routeDown` / `routeMove`；
 *   3. 命中判定用**屏幕坐标**手工换算：沿 parentContainer 链累积位置与缩放
 *      （和渲染变换同源），容器怎么 setScale、怎么嵌套都天然跟随。
 *
 * 生命周期：`alive()` 返回 false、或热区对象已随容器销毁（scene 为空）时，
 * 条目在下次路由时自动剔除 —— 不需要调用方手动反注册。
 */
import type Phaser from 'phaser'

export interface UiHit {
  /** 热区矩形：只当**定位锚点**用（ parentContainer 链决定屏幕位置），不再 setInteractive */
  obj: Phaser.GameObjects.Rectangle
  w: number
  h: number
  /** 点击回调（等价于原来的 pointerdown） */
  onClick: () => void
  /** 悬停进入/离开（等价于 pointerover / pointerout，用于高亮描边） */
  onHover?: (v: boolean) => void
  /** 按下瞬间的视觉反馈（等价于原来 pointerdown 里的位移动画） */
  onPress?: () => void
  /** 活性检查：所属 overlay 已关闭/销毁时返回 false */
  alive: () => boolean
}

const KEY = '__uiHitRoutes'

function routes(scene: Phaser.Scene): UiHit[] {
  const any = scene as unknown as { [k: string]: UiHit[] | undefined }
  if (!any[KEY]) any[KEY] = []
  return any[KEY]
}

/** 登记一个 UI 热区。 */
export function registerUiHit(scene: Phaser.Scene, hit: UiHit): void {
  routes(scene).push(hit)
}

/** 热区矩形对象沿容器链换算到屏幕坐标（与 Phaser 渲染变换同源）。 */
function screenPos(obj: Phaser.GameObjects.Rectangle): { x: number; y: number; sx: number; sy: number } {
  let x = obj.x
  let y = obj.y
  let sx = 1
  let sy = 1
  let p = obj.parentContainer
  while (p) {
    x = p.x + x * p.scaleX
    y = p.y + y * p.scaleY
    sx *= p.scaleX
    sy *= p.scaleY
    p = p.parentContainer
  }
  return { x, y, sx, sy }
}

/** 返回 (px,py) 命中的最上层热区；顺手剔除已失效条目。后登记的 = 渲染更靠上 = 优先。 */
function hitAt(scene: Phaser.Scene, px: number, py: number): UiHit | null {
  const list = routes(scene)
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]
    if (!h.alive() || !h.obj.scene) {
      list.splice(i, 1)
      continue
    }
    const { x, y, sx, sy } = screenPos(h.obj)
    const dx = (px - x) / sx
    const dy = (py - y) / sy
    if (Math.abs(dx) <= h.w / 2 && Math.abs(dy) <= h.h / 2) return h
  }
  return null
}

/** GameScene 在 `input.on('pointerdown')` 里调用。 */
export function routeDown(scene: Phaser.Scene, p: Phaser.Input.Pointer): void {
  const h = hitAt(scene, p.x, p.y)
  if (!h) return
  h.onPress?.()
  h.onClick()
}

/** GameScene 在 `input.on('pointermove')` 里调用：维护悬停高亮 + 手型光标。 */
export function routeMove(scene: Phaser.Scene, p: Phaser.Input.Pointer): void {
  const any = scene as unknown as { [k: string]: UiHit | undefined }
  const prev = any['__uiHovered']
  const now = hitAt(scene, p.x, p.y)
  if (prev !== now) {
    prev?.onHover?.(false)
    now?.onHover?.(true)
    any['__uiHovered'] = now ?? undefined
    scene.input.setDefaultCursor(now ? 'pointer' : 'default')
  }
}
