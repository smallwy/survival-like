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

  export class Node {
    constructor(name?: string)
    name: string
    parent: Node | null
    active: boolean
    /** 渲染层掩码：运行时 new 出来默认是 DEFAULT，必须显式继承父节点 */
    layer: number
    scene: Scene | null
    addComponent<T>(ctor: new (...args: any[]) => T): T
    getComponent<T>(ctor: new (...args: any[]) => T): T | null
    getComponentInChildren<T>(ctor: new (...args: any[]) => T): T | null
    setPosition(x: number, y: number, z?: number): void
    on(type: string, callback: (...args: any[]) => void, target?: any): void
    off(type: string, callback?: (...args: any[]) => void, target?: any): void
    static EventType: {
      TOUCH_START: string
      TOUCH_MOVE: string
      TOUCH_END: string
      TOUCH_CANCEL: string
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
    close(): void
  }

  export class Label extends Component {
    string: string
    fontSize: number
    lineHeight: number
    color: Color
    horizontalAlign: number
    verticalAlign: number
    static HorizontalAlign: { LEFT: number; CENTER: number; RIGHT: number }
    static VerticalAlign: { TOP: number; CENTER: number; BOTTOM: number }
  }

  export class SpriteFrame {}

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
  }
  export type KeyCode = number

  export const _decorator: {
    ccclass: (name?: string) => ClassDecorator
    property: (options?: any) => PropertyDecorator
  }
}
