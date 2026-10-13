/**
 * 潜水战斗循环 · 确定性与数学工具（引擎无关）
 *
 * 原 `DiveScene.ts` 直接调 `Math.random()` / `Phaser.Math.*` / `Phaser.Utils.Array.Shuffle`。
 * 抽成引擎无关模块时这两个都要换掉：
 *
 *   - `Math.random()` → **注入式确定性 RNG**。理由：无头冒烟测试要可复现——
 *     同一个 seed 跑两遍必须得到同一条世界线，否则"断言不过"就没法判断
 *     是逻辑错了还是运气不同。
 *   - `Phaser.Math.*` → 本文件的等价函数（`Phaser.Math.Between` 是**闭区间**
 *     整数随机，这里 `Rng.int` 语义相同；`Phaser.Math.Angle.Wrap` 归一到 (-π, π]）。
 */

/** mulberry32 —— 32 位种子、质量够用的确定性 PRNG。 */
export class Rng {
  private s: number

  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [a, b) 浮点 */
  range(a: number, b: number): number {
    return a + this.next() * (b - a)
  }

  /** [a, b] **闭区间整数** —— 与 `Phaser.Math.Between(a, b)` 语义一致 */
  int(a: number, b: number): number {
    return Math.floor(a + this.next() * (b - a + 1))
  }

  /** 概率 p 命中（p ∈ [0,1]） */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]
  }

  /** 原地 Fisher-Yates（对应 `Phaser.Utils.Array.Shuffle`） */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
    }
    return arr
  }
}

// ---------------------------------------------------------------------------
// Phaser.Math.* 的等价物
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1)
}

/** 角度归一到 (-π, π] —— 与 `Phaser.Math.Angle.Wrap` 一致 */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}
