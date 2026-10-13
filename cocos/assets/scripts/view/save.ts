/**
 * 档案的**本地读写**（薄适配层，约 40 行）。
 *
 * 逻辑全在 `shared/dive/profile.ts` —— 那边是纯函数、无引擎依赖、被无头冒烟
 * 测试覆盖。这里只做一件小事：和平台存储打交道。
 *
 * `sys.localStorage` 在 Web 上等价于 `window.localStorage`，在原生平台落到各平台
 * 的本地存储，所以这一份代码全平台通用，不需要按平台写条件分支。
 *
 * 两条硬性容错（存档是最容易把游戏搞崩的东西）：
 *   ① **读**要防住"没存过 / 存的是半截 JSON / 被用户手改成非 JSON"三种情况 ——
 *      一律退回默认档案，绝不让开场崩掉；
 *   ② **写**要防住隐私模式 / 配额满时 localStorage **抛异常** —— 写失败最多是
 *      "纪录没留下"，不能让一局的结束流程卡住。
 * 所以两个函数都包 try/catch，并且都不抛。
 */

import { sys } from 'cc'
import { defaultProfile, normalizeProfile, migrateV1toV2 } from '../shared/dive/profile'
import type { Profile } from '../shared/dive/profile'

/** 带版本号的 key：将来结构大改时可以并存 key，而不是原地覆盖旧档 */
const KEY = 'sgr.profile.v2'
/**
 * v1 的 key —— **只读**，用于迁移；不写、不删（回滚保护）。
 *
 * 为什么留着：万一 v2 出问题要回退版本，v1 存档还在，老玩家不至于进度全灭。
 * 迁移只在内存里做，落盘一律写 v2。
 */
const KEY_V1 = 'sgr.profile.v1'

/**
 * 取本地存储。Web 上就是 `window.localStorage`，原生平台落到各平台实现。
 *
 * 但**它不一定可用**：隐私模式 / 原生平台未初始化时可能是 undefined，个别平台
 * 取属性本身就会抛。所以这里统一收口成一个可空返回值 —— 拿不到就整体降级为
 * "没有存档"，而不是让开局的读档把整个游戏带崩。
 */
function store(): Storage | null {
  try { return sys.localStorage || null } catch { return null }
}

export function loadProfile(): Profile {
  try {
    const ls = store()
    if (!ls) return defaultProfile()
    const raw = ls.getItem(KEY)
    if (raw) return normalizeProfile(JSON.parse(raw))
    // 回落：v2 没有 → 读 v1 并迁移（旧纪录一个不丢，新字段走默认值）
    const rawV1 = ls.getItem(KEY_V1)
    if (rawV1) {
      console.info('[save] 发现 v1 存档，迁移到 v2（旧 key 保留）')
      return migrateV1toV2(JSON.parse(rawV1))
    }
    return defaultProfile()
  } catch (e) {
    console.warn('[save] 读档失败，按"无存档"开局：', e)
    return defaultProfile()
  }
}

/** @returns 是否真的写进去了（写失败只影响"纪录没留下"，调用方无需特殊处理） */
export function saveProfile(p: Profile): boolean {
  try {
    const ls = store()
    if (!ls) return false
    ls.setItem(KEY, JSON.stringify(p))
    return true
  } catch (e) {
    console.warn('[save] 存档失败（本局纪录未留下）：', e)
    return false
  }
}
