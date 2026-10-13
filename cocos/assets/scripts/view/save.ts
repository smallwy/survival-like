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
import { defaultProfile, normalizeProfile } from '../shared/dive/profile'
import type { Profile } from '../shared/dive/profile'

/** 带版本号的 key：将来结构大改时可以并存 key，而不是原地覆盖旧档 */
const KEY = 'sgr.profile.v1'

export function loadProfile(): Profile {
  try {
    const raw = sys.localStorage.getItem(KEY)
    if (!raw) return defaultProfile()
    return normalizeProfile(JSON.parse(raw))
  } catch (e) {
    console.warn('[save] 读档失败，按"无存档"开局：', e)
    return defaultProfile()
  }
}

/** @returns 是否真的写进去了（写失败只影响"纪录没留下"，调用方无需特殊处理） */
export function saveProfile(p: Profile): boolean {
  try {
    sys.localStorage.setItem(KEY, JSON.stringify(p))
    return true
  } catch (e) {
    console.warn('[save] 存档失败（本局纪录未留下）：', e)
    return false
  }
}
