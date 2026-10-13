/**
 * 只为**沙箱内类型检查**而写的 `cc` 最小声明。
 *
 * 为什么需要：本机装了 Cocos Creator，但沙箱里跑不起 GUI 编辑器，也就拿不到
 * 引擎自带的 `cc.d.ts`。而 `cocos/assets/scripts/view/*.ts` 全都 `import ... from 'cc'`，
 * 没有声明就无法 `tsc`，等于**渲染层一行都没被验证过**。
 *
 * 这个文件只声明 view/ 实际用到的那些成员，签名刻意与 Cocos 3.8 一致。
 * 它不是"真·cc 类型"，用途只有一个：让 tsc 能跑起来，从而抓出
 *   ① 语法/类型错误；
 *   ② **view 层用错 sim API**（字段名拼错、参数个数不对、类型不匹配）——
 *      这是移植里最容易出的错，而且只有 tsc 抓得住。
 *
 * ⚠️ 引擎 API 本身（比如 `Graphics.circle` 的真实行为、`Node.layer` 的默认值）
 *    这一层验证不了，只能由你在 Creator 里打开工程确认。
 */
declare module 'cc' {
  export class Color {
    constructor(r?: number, g?: number, b?: number, a?: number)
    r: number
    g: number
    b: number
    a: number
  }

  export interface EventKeyboard {
    keyCode: number
  }

  export class Vec3 {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
  }

  export class Node {
    constructor(name?: string)
    name: string
    parent: Node | null
    active: boolean
    /** 渲染层掩码：运行时 new 出来默认是 DEFAULT，必须显式继承父节点 */
    layer: number
    scene: Scene | null
    /** **本地**位置（父节点坐标系）。改它不会同步到 `setPosition` 的内部缓存 */
    position: Vec3
    /** 2D 旋转角（度），等价于 `eulerAngles.z` */
    angle: number
    addComponent<T>(ctor: new (...args: any[]) => T): T
    getComponent<T>(ctor: new (...args: any[]) => T): T | null
    getComponentInChildren<T>(ctor: new (...args: any[]) => T): T | null
    setPosition(x: number, y: number, z?: number): void
    setScale(x: number, y?: number, z?: number): void
    destroy(): boolean
    on(type: string, callback: (...args: any[]) => void, target?: any): void
    off(type: string, callback?: (...args: any[]) => void, target?: any): void
    static EventType: {
      TOUCH_START: string
      TOUCH_MOVE: string
      TOUCH_END: string
      TOUCH_CANCEL: string
      MOUSE_ENTER: string
      MOUSE_LEAVE: string
    }
  }

  export class Scene {
    getComponentInChildren<T>(ctor: new (...args: any[]) => T): T | null
  }

  export class Component {
    node: Node
  }

  export class UITransform extends Component {
    setAnchorPoint(x: number, y: number): void
    setContentSize(w: number, h: number): void
    contentSize: { width: number; height: number }
  }

  export class Camera extends Component {
    zoom: number
  }

  export class UIOpacity extends Component {
    /** 0–255。与 `Node.active` 不同：它保留节点与其命中区，只改透明度 */
    opacity: number
  }

  export class Graphics extends Component {
    fillColor: Color
    strokeColor: Color
    lineWidth: number
    clear(): void
    fill(): void
    stroke(): void
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    circle(x: number, y: number, r: number): void
    rect(x: number, y: number, w: number, h: number): void
    /** 圆心 + **两个半径**（与 Phaser 的"收直径"相反，抄 web 侧数值必须 ÷2） */
    ellipse(cx: number, cy: number, rx: number, ry: number): void
    /** 圆心 + 半径 + 弧度区间。⚠️ y 轴翻转后方向与直觉相反，本项目一律走 `Gfx.arc()` */
    arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number,
        counterclockwise?: boolean): void
    roundRect(x: number, y: number, w: number, h: number, r: number): void
    close(): void
  }

  export class Label extends Component {
    string: string
    fontSize: number
    lineHeight: number
    color: Color
    horizontalAlign: number
    verticalAlign: number
    isBold: boolean
    /** 描边必须三件套一起开，只设 `outlineWidth` 不会生效 */
    enableOutline: boolean
    outlineColor: Color
    outlineWidth: number
    static HorizontalAlign: { LEFT: number; CENTER: number; RIGHT: number }
    static VerticalAlign: { TOP: number; CENTER: number; BOTTOM: number }
  }

  export class Size {
    width: number
    height: number
  }

  export class Rect {
    x: number
    y: number
    width: number
    height: number
  }

  export class SpriteFrame {
    /**
     * **裁剪后**的矩形。素材导入 meta 默认 `trimType: auto`，
     * 所以它通常**小于** `originalSize`（实测 `item_gun`：rect 344×264 vs originalSize 600×300）。
     */
    rect: Rect
    /** **未裁剪**的整张画布尺寸。`Sprite.trim=false` 时引擎按它算顶点 */
    originalSize: Size
    /** 九宫格边界 —— 绑在 SpriteFrame 上，**一个 SpriteFrame 只有一套** */
    insetLeft: number
    insetTop: number
    insetRight: number
    insetBottom: number
  }

  export class Sprite extends Component {
    spriteFrame: SpriteFrame | null
    /**
     * CUSTOM 时必须由代码显式给尺寸（`UITransform.setContentSize`），
     * 否则会被贴图尺寸覆盖 —— 本项目所有"按圆盘缩放"的地方都依赖它。
     */
    sizeMode: number
    /**
     * `false` 才保留透明边。比例计算（`frameAspect`）与圆盘缩放都要求 `false`：
     * 默认的 `true` 会按裁剪后的 rect 渲染，突出件会被切掉。
     */
    trim: boolean
    color: Color
    static SizeMode: { CUSTOM: number; TRIMMED: number; RAW: number }
    static Type: { SIMPLE: number; SLICED: number; TILED: number; FILLED: number }
  }

  /** 资源数据库（`assets/resources/` 下） */
  export const resources: {
    load<T>(
      path: string,
      type: new (...args: any[]) => T,
      onComplete: (err: Error | null, asset: T) => void,
    ): void
  }

  export const director: {
    loadScene(name: string): void
  }

  export class Input {
    static EventType: {
      KEY_DOWN: string
      KEY_PRESSING: string
      KEY_UP: string
      MOUSE_DOWN: string
      MOUSE_UP: string
      TOUCH_START: string
      TOUCH_END: string
    }
  }

  export const input: {
    on(type: string, callback: (event: any) => void, target?: any): void
    off(type: string, callback: (event: any) => void, target?: any): void
  }

  export const KeyCode: {
    ESCAPE: number
    ENTER: number
    SPACE: number
    SHIFT_LEFT: number
    SHIFT_RIGHT: number
    KEY_W: number
    KEY_A: number
    KEY_S: number
    KEY_D: number
    ARROW_LEFT: number
    ARROW_UP: number
    ARROW_RIGHT: number
    ARROW_DOWN: number
    DIGIT_0: number
    DIGIT_1: number
    DIGIT_2: number
    DIGIT_3: number
    DIGIT_4: number
    DIGIT_5: number
    DIGIT_6: number
    DIGIT_7: number
    DIGIT_8: number
    DIGIT_9: number
    NUM_0: number
    NUM_1: number
    NUM_2: number
    NUM_3: number
    NUM_4: number
    NUM_5: number
    NUM_6: number
    NUM_7: number
    NUM_8: number
    NUM_9: number
  }
  export type KeyCode = number

  /** 平台信息。本项目只用到 `localStorage`（Web 上等价于 `window.localStorage`） */
  export const sys: {
    localStorage: Storage | null
  }

  export const _decorator: {
    ccclass: (name?: string) => ClassDecorator
    property: (options?: any) => PropertyDecorator
  }
}
