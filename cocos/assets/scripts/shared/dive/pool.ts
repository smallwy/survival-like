// ============================================================================
// ⚠️ GENERATED FILE —— 不要手改本文件。
//    真源：shared/dive/pool.ts
//    生成：tools/sync_shared.py（改完 shared/ 后运行：python tools/sync_shared.py）
//    原因：Cocos Creator 只编译 assets/ 下的脚本，真源必须被复制进来。
// ============================================================================
/**
 * 潜水战斗循环 · 商店卡池（引擎无关）
 *
 * 逐字从 `web/src/scenes/DiveScene.ts:4909-5099` 的 `pool: Upgrade[]` 搬来。
 * 唯一差异：`apply` / `dead` 的入参从 `DiveScene` 换成结构接口 `ShopTarget`，
 * 于是卡池不依赖任何引擎、可以在无头测试里跑。
 */

import type { UpgradeDef, ShopTarget, RelicId } from './types'
import { RELIC_DEF, RELIC_SLOTS } from './tables'

export const CARD_POOL: UpgradeDef[] = [
  // ⚠️ 武器卡都带 `family`（解锁过滤用，见 `unlocks.ts` filterPool）。
  //    新加武器卡**必须**补 `family`，否则它会绕过解锁、锁了也照抽。
  // —— 器械卡（V6.3）——
  { id: 'w_sonar', name: '声呐共振', desc: '环形波前 · 群体伤害', kind: 'weapon', family: 'sonar',
    cost: 32, apply: s => s.addWeapon('sonar') },

  // —— V6.18 新增三种基础武器。——
  { id: 'w_harp', name: '穿透鱼叉', desc: '直线穿透 · 命中拉拽', kind: 'weapon', family: 'harpoon',
    cost: 34, apply: s => s.addWeapon('harpoon') },
  { id: 'w_echo', name: '回声炮', desc: '延迟爆发 · 需预判', kind: 'weapon', family: 'echo',
    cost: 36, apply: s => s.addWeapon('echo') },
  { id: 'w_acid', name: '酸液喷射', desc: '地面持续伤害区', kind: 'weapon', family: 'acid',
    cost: 34, apply: s => s.addWeapon('acid') },

  { id: 'w_gun', name: '脉冲机关枪', desc: '高频连射 · 单体', kind: 'weapon', family: 'gun',
    cost: 30,
    apply: s => s.addWeapon('gun'),
  },
  { id: 'w_torp', name: '追踪鱼雷', desc: '低频追踪 · 范围爆炸', kind: 'weapon', family: 'torpedo',
    cost: 38,
    apply: s => s.addWeapon('torpedo'),
  },
  { id: 'w_arc', name: '链式电弧', desc: '瞬发连锁 · 多目标', kind: 'weapon', family: 'arc',
    cost: 34,
    apply: s => s.addWeapon('arc'),
  },
  // 弹药改良不带 family —— 它作用于"全部已拥有武器"，永远可用
  { id: 'w_all', name: '弹药改良', desc: '全部器械 +1 级', kind: 'weapon',
    cost: 26,
    apply: s => s.levelAllWeapons(),
    dead: s => s.weapons.length === 0,
  },

  // —— 进化卡（V6.17）：每把武器 2 条分支，满级（Lv5）后才会出现在池里 ——
  { id: 'e_gun_gl', name: '进化 · 加特林', desc: '射速翻倍 · 射程腰斩', kind: 'weapon', family: 'gun',
    cost: 66, apply: s => s.evolveWeapon('gun', 'gun_gl'),
    dead: s => !s.weapons.some(w => w.id === 'gun' && w.lvl >= 5) },
  { id: 'e_gun_sg', name: '进化 · 霰弹散射', desc: '一次 5 弹扇形 · 近距', kind: 'weapon', family: 'gun',
    cost: 66, apply: s => s.evolveWeapon('gun', 'gun_sg'),
    dead: s => !s.weapons.some(w => w.id === 'gun' && w.lvl >= 5) },

  { id: 'e_torp_cl', name: '进化 · 集束鱼雷', desc: '一次 3 枚 · 覆盖面', kind: 'weapon', family: 'torpedo',
    cost: 74, apply: s => s.evolveWeapon('torpedo', 'torp_cl'),
    dead: s => !s.weapons.some(w => w.id === 'torpedo' && w.lvl >= 5) },
  { id: 'e_torp_hv', name: '进化 · 重型鱼雷', desc: '单发重击 · 爆炸更大', kind: 'weapon', family: 'torpedo',
    cost: 74, apply: s => s.evolveWeapon('torpedo', 'torp_hv'),
    dead: s => !s.weapons.some(w => w.id === 'torpedo' && w.lvl >= 5) },

  { id: 'e_arc_ov', name: '进化 · 过载电弧', desc: '跳跃 +4 · 串得更远', kind: 'weapon', family: 'arc',
    cost: 70, apply: s => s.evolveWeapon('arc', 'arc_ov'),
    dead: s => !s.weapons.some(w => w.id === 'arc' && w.lvl >= 5) },
  { id: 'e_arc_st', name: '进化 · 定点雷暴', desc: '一次电击全部目标', kind: 'weapon', family: 'arc',
    cost: 70, apply: s => s.evolveWeapon('arc', 'arc_st'),
    dead: s => !s.weapons.some(w => w.id === 'arc' && w.lvl >= 5) },

  { id: 'e_sonar_rs', name: '进化 · 共振炮', desc: '命中后向邻近弹射', kind: 'weapon', family: 'sonar',
    cost: 70, apply: s => s.evolveWeapon('sonar', 'sonar_rs'),
    dead: s => !s.weapons.some(w => w.id === 'sonar' && w.lvl >= 5) },
  { id: 'e_sonar_fc', name: '进化 · 定向聚焦', desc: '短距强波 · 高伤', kind: 'weapon', family: 'sonar',
    cost: 70, apply: s => s.evolveWeapon('sonar', 'sonar_fc'),
    dead: s => !s.weapons.some(w => w.id === 'sonar' && w.lvl >= 5) },

  // —— V6.29：鱼叉 / 回声 / 酸液 的进化（三把此前零进化的武器）——
  { id: 'e_harp_tr', name: '进化 · 三重鱼叉', desc: '一次 3 叉扇形 · 群体拉拽', kind: 'weapon', family: 'harpoon',
    cost: 68, apply: s => s.evolveWeapon('harpoon', 'harp_tr'),
    dead: s => !s.weapons.some(w => w.id === 'harpoon' && w.lvl >= 5) },
  { id: 'e_harp_cb', name: '进化 · 回旋鱼叉', desc: '到程掉头 · 二次穿刺回氧', kind: 'weapon', family: 'harpoon',
    cost: 68, apply: s => s.evolveWeapon('harpoon', 'harp_cb'),
    dead: s => !s.weapons.some(w => w.id === 'harpoon' && w.lvl >= 5) },

  { id: 'e_echo_mu', name: '进化 · 多重回声', desc: '三点延时爆炸 · 群爆回氧', kind: 'weapon', family: 'echo',
    cost: 72, apply: s => s.evolveWeapon('echo', 'echo_mu'),
    dead: s => !s.weapons.some(w => w.id === 'echo' && w.lvl >= 5) },
  { id: 'e_echo_fo', name: '进化 · 聚焦回声', desc: '大半径延时爆发 · 高伤', kind: 'weapon', family: 'echo',
    cost: 72, apply: s => s.evolveWeapon('echo', 'echo_fo'),
    dead: s => !s.weapons.some(w => w.id === 'echo' && w.lvl >= 5) },

  { id: 'e_acid_fd', name: '进化 · 持久酸池', desc: '更大更久 · 池内省氧', kind: 'weapon', family: 'acid',
    cost: 66, apply: s => s.evolveWeapon('acid', 'acid_fd'),
    dead: s => !s.weapons.some(w => w.id === 'acid' && w.lvl >= 5) },
  { id: 'e_acid_ra', name: '进化 · 酸雨', desc: '三池成排 · 封锁一线', kind: 'weapon', family: 'acid',
    cost: 70, apply: s => s.evolveWeapon('acid', 'acid_ra'),
    dead: s => !s.weapons.some(w => w.id === 'acid' && w.lvl >= 5) },

  // —— 挂载位扩容卡（V6.6 / V6.10）：顺序很重要，必须先 5 再 6 ——
  { id: 't_slot5', name: '挂载扩容 I', desc: '座圈解锁第 5 座 · 尾侧新增炮位', kind: 'mount',
    cost: 55,
    apply: s => { s.maxWeapons = 5 },
    dead: s => s.maxWeapons >= 5,
  },
  { id: 't_slot6', name: '挂载扩容 II', desc: '座圈解锁第 6 座 · 火力上限 +1', kind: 'mount',
    cost: 70,
    apply: s => { s.maxWeapons = 6 },
    dead: s => s.maxWeapons !== 5,
  },
  { id: 't_twin', name: '齐射同步', desc: '扩容座（第 5/6 座）射速 +25%', kind: 'mount',
    cost: 45,
    apply: s => s.addStat('twinRate', 0.25),
    dead: s => s.maxWeapons < 5,
  },

  // —— 属性卡（V6.8）——
  { id: 'speed', name: '增压推进', desc: '移速 +15%', kind: 'stat',
    cost: 24,
    apply: s => s.addStat('speed', 0.15),
  },
  { id: 'pickup', name: '吸附鳍', desc: '拾取范围 +40%', kind: 'stat',
    cost: 22,
    apply: s => s.addStat('pickup', 0.4),
  },
  { id: 'tank', name: '扩容气瓶', desc: '氧气上限 +20 并回满', kind: 'stat',
    cost: 36,
    apply: s => { s.addStat('o2Bonus', 20); s.o2Max = s.layer().o2Max + s.st.o2Bonus; s.o2 = s.o2Max },
  },
  { id: 'gill', name: '循环鳃', desc: '击杀额外回氧 +3', kind: 'stat',
    cost: 28,
    apply: s => s.addStat('killO2', 3),
  },
  { id: 's_dmg', name: '共振放大', desc: '伤害 +12%', kind: 'stat',
    cost: 32,
    apply: s => s.addStat('dmg', 0.12),
  },
  { id: 's_rate', name: '高压供能', desc: '射速 +10%', kind: 'stat',
    cost: 30,
    apply: s => s.addStat('rate', 0.10),
  },
  { id: 's_crit', name: '弱点解析', desc: '暴击率 +8%', kind: 'stat',
    cost: 28,
    apply: s => s.addStat('crit', 0.08),
    dead: s => s.st.crit >= 0.75,
  },
  { id: 's_range', name: '声场延伸', desc: '射程 +15%', kind: 'stat',
    cost: 26,
    apply: s => s.addStat('range', 0.15),
  },
  { id: 's_armor', name: '耐压装甲', desc: '受到的伤害 −8%', kind: 'stat',
    cost: 30,
    apply: s => s.addStat('armor', 0.08),
    dead: s => s.st.armor >= 0.6,
  },
  { id: 's_dodge', name: '流体规避', desc: '一次性打击闪避 +6%', kind: 'stat',
    cost: 28,
    apply: s => s.addStat('dodge', 0.06),
    dead: s => s.st.dodge >= 0.6,
  },
  { id: 's_regen', name: '循环泵', desc: '每秒回氧 +0.4', kind: 'stat',
    cost: 34,
    apply: s => s.addStat('regen', 0.4),
  },
  { id: 's_luck', name: '打捞直觉', desc: '鱼骨换钱 +15%', kind: 'stat',
    cost: 24,
    apply: s => s.addStat('luck', 0.15),
  },
]

// —— 遗物（被动道具，V6.8）：卡池里最贵、也是唯一**会改变打法**的一类 ——
// 两个出现条件：① 槽位没满 ② 打过 2 波以上（开局就刷会让玩家无从判断价值）。
for (const id of Object.keys(RELIC_DEF) as RelicId[]) {
  const r = RELIC_DEF[id]
  CARD_POOL.push({
    id: `r_${id}`, name: r.name, desc: r.desc, kind: 'relic',
    cost: r.price,
    relicId: id,
    apply: (s: ShopTarget) => s.equipRelic(id),
    dead: (s: ShopTarget) => s.relics.length >= RELIC_SLOTS
      || s.relics.includes(id)
      || s.layerIdx * 4 + s.waveInLayer < 2,
  })
}
