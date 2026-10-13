/**
 * 可选的美术资源加载（潜航器 / 鱼 / 环境背景）。
 *
 * 设计原则：**没有美术也能跑**。
 * Cocos 的资源库（`assets/resources/`）里如果没有对应图片，就静默跳过，
 * 渲染层自动退回用 Graphics 画几何剪影。这样"把工程打开、挂上组件、点运行"
 * 这件事不依赖任何美术导入步骤 —— 美术是后续的增量，不是前置条件。
 *
 * 导入方式（与 web 侧同一批源图，不重画）：
 *   web/src/assets/sub/*.png   → cocos/assets/resources/sub/*.png
 *   web/src/assets/fish/*.png  → cocos/assets/resources/fish/*.png
 *   web/src/assets/env/*.webp  → cocos/assets/resources/env/*.webp
 *
 * 注意 Cocos 会为每张图生成一个 `spriteFrame` 子资源，所以加载路径是
 * `<目录>/<文件名>/spriteFrame`；本类会两种路径都试一次。
 */

import { resources, SpriteFrame } from 'cc'

export class SpriteBank {
  private readonly map = new Map<string, SpriteFrame>()

  /** 按 key 取（key 就是模拟层给的 `tex` 值，如 'f_swarm' / 'sub_lumen'） */
  get(key: string): SpriteFrame | undefined {
    return this.map.get(key)
  }

  has(key: string): boolean { return this.map.has(key) }

  /**
   * 批量加载。**任何一张失败都不抛错**（美术缺失时游戏照跑）。
   * @param paths key → resources 下的相对路径（不含扩展名）
   */
  async loadAll(paths: Record<string, string>): Promise<void> {
    const jobs = Object.entries(paths).map(async ([key, p]) => {
      const sf = await this.tryLoad(p)
      if (sf) this.map.set(key, sf)
    })
    await Promise.all(jobs)
  }

  private tryLoad(p: string): Promise<SpriteFrame | null> {
    const attempt = (path: string) => new Promise<SpriteFrame | null>(resolve => {
      resources.load(path, SpriteFrame, (err, asset) => resolve(err ? null : asset))
    })
    return attempt(`${p}/spriteFrame`).then(sf => sf ?? attempt(p))
  }
}

/** 默认要加载的 key → 路径（与 web 侧资源同名） */
export const ART_PATHS: Record<string, string> = {
  // 潜航器机体（圆盘本体）
  sub_lumen: 'sub/sub_lumen',
  sub_raia: 'sub/sub_raia',
  sub_bathy: 'sub/sub_bathy',
  // 三种敌人
  f_swarm: 'fish/f_swarm',
  f_dash: 'fish/f_dash',
  f_drift: 'fish/f_drift',
  // 五层环境背景
  env0: 'env/env0',
  env1: 'env/env1',
  env2: 'env/env2',
  env3: 'env/env3',
  env4: 'env/env4',
}
