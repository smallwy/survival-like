/**
 * 美术资源加载（潜航器 / 鱼 / 环境背景 / 商店立绘）。
 *
 * ---------------------------------------------------------------------------
 * 设计原则：**没有美术也能跑**
 * ---------------------------------------------------------------------------
 * `resources` 下缺哪张图就静默跳过，渲染层自动退回 `Gfx` 画的几何剪影。
 * 于是"打开工程 → 挂上组件 → 点运行"不依赖任何美术导入步骤；美术是增量。
 * 这条在移植期尤其值钱：能先把"逻辑对不对"验完，再谈好不好看。
 *
 * ---------------------------------------------------------------------------
 * 资源从哪来：**不手工复制**
 * ---------------------------------------------------------------------------
 *   python tools/sync_art.py          # web/src/assets → cocos/assets/resources
 *   python tools/sync_art.py --check  # 双向漂移检测（源变了 / 副本被手改）
 *
 * 同步时做了两处必要的转换（理由见该脚本头部注释）：五层背景 webp → PNG
 * （绕开"编辑器导入器是否支持 webp"这个我无法在沙箱里验证的问题）；
 * 23 张 1200×600 的道具立绘降到 600×300（恰为显示尺寸的 2 倍）。
 *
 * ---------------------------------------------------------------------------
 * 为什么路径表是**推导**出来的，不是手写的
 * ---------------------------------------------------------------------------
 * 手写一份 key→路径 的表，等于在美术和代码之间插了一层最容易漏的东西：
 * 以后加一种敌人 / 一件遗物，表格忘了加，症状是"这东西在游戏里没图"——
 * 而它**不会报错**，只会静默退回几何剪影，很难注意。
 *
 * 所以这张表**不在本文件里**，而在 `shared/dive/artKeys.ts` —— 它是"游戏需要
 * 哪些美术"的唯一说明，由 `ENEMY_TEX` / `LAYERS` / `WEAPON_DEF` / `RELIC_DEF` /
 * `SUB_ART_PATH` 推导。同一份表 `tools/verify_cocos.py` 也会 require 一遍去跟
 * 磁盘上的文件对账，于是"表里加了 id、美术却漏了"在离线阶段就会红。
 */

import { resources, SpriteFrame } from 'cc'
import { artPaths } from '../shared/dive/artKeys'

/** key → `resources` 下的相对路径（**不含扩展名**，见 artKeys.ts）。 */
export const ART_PATHS: Record<string, string> = artPaths()

/**
 * 一张图都没有时的兜底判据用的 key（用来判断"美术到底加载上没有"）。
 * 敌人贴图是必装项，所以拿它当探针最灵敏。
 */
export const ART_PROBE_KEY = 'f_swarm'

export class SpriteBank {
  private readonly map = new Map<string, SpriteFrame>()

  /** 按 key 取（key 就是模拟层给的 `tex`，如 'f_swarm' / 'sub_lumen'） */
  get(key: string): SpriteFrame | undefined {
    return this.map.get(key)
  }

  has(key: string): boolean { return this.map.has(key) }

  get size(): number { return this.map.size }

  /**
   * 批量加载。**任何一张失败都不抛错**（美术缺失时游戏照跑）。
   * 返回成功加载的张数，便于日志里一句话看出"美术到底接上没有"。
   */
  async loadAll(paths: Record<string, string> = ART_PATHS): Promise<number> {
    const jobs = Object.entries(paths).map(async ([key, p]) => {
      const sf = await this.tryLoad(p)
      if (sf) this.map.set(key, sf)
    })
    await Promise.all(jobs)
    return this.map.size
  }

  private tryLoad(p: string): Promise<SpriteFrame | null> {
    const attempt = (path: string) => new Promise<SpriteFrame | null>(resolve => {
      resources.load(path, SpriteFrame, (err, asset) => resolve(err ? null : asset))
    })
    return attempt(`${p}/spriteFrame`).then(sf => sf ?? attempt(p))
  }
}

/**
 * 取一张图的**像素宽高比**（宽/高）。
 *
 * 为什么必须按素材比例：web 侧踩过一次并留下了记录（DiveScene.ts `fishSprite`）——
 * 旧代码把非水母一律 `setDisplaySize(s, s)` 拉成正方形，而素材实际比例是
 * swarm 1.99 / drift 1.54 / dash 0.55，于是"一条 2:1 的长鱼被压成方块"，
 * 玩家看到的是"黑块"，认不出是鱼。
 *
 * `trim = false` + `rect` 才是**含透明边的原图尺寸**，与 web 的
 * `texture.source[0].width/height` 等价；用 `originalSize` 在开了 trim 时
 * 会得到裁剪后的尺寸，比例就错了。
 */
export function frameAspect(sf: SpriteFrame): number {
  const w = sf.rect.width
  const h = sf.rect.height
  return h > 0 ? w / h : 1
}
