"""炮塔座圈几何自检（V6.10 圆形座圈）

与web/src/scenes/DiveScene.ts 的常量保持一致（改动时同步）。
改座圈后跑一遍python/web/tools/check_turret_layout.py，秒级出结论，
不用开游戏截图猜。

为什么需要这个脚本（V6.6~V6.9 的教训）：
矩形塔会随索敌相对艇身旋转最多 ±60°，旋转后宽度方向的半投影变成
19·sin60 + 13·cos60 ≈ 23px，异舷两塔必须留 46px 才不碰 ——
所以当时被迫把挂载点推到 ±0.46，代价是"塔心离艇身24px，像浮在机体外面"。
改成圆座后**旋转不再改变半投影**，这条约束整个消失。

现在唯一的硬约束：**相邻座的弦长 > 两个塔座半径之和**。
"""
import math

# 与 DiveScene.ts 常量保持一致（改动时同步）
SEAT_ANGLES_DEG = [30, -30, 90, -90, 150, -150]   # 座圈固定角度（避开艏0°/艉180°）
SEAT_RING_R = 40                                   # 座圈半径 px（V6.13: 42→40，装载器缩小后收紧）
# 判据必须用**最外圈**半径：装载器本体之外还有装填进度环（×1.38），
# 相邻座撞不撞看的是最外那一圈。
TURRET_R = 12 * 1.38                            # = 16.56 px（装填进度环是最外圈）
EXT_K = 1.15                                       # 扩容座半径放大系数（保留，供报告展示）
SUB_LEN, SUB_WID = 99, 52                          # 机体显示尺寸


def ring_pt(deg, r=SEAT_RING_R):
    a = math.radians(deg)
    return (r * math.cos(a), r * math.sin(a))


print("座圈（艇身局部坐标，+x 为艏、+y 为右舷）:")
for i, deg in enumerate(SEAT_ANGLES_DEG):
    p = ring_pt(deg)
    tag = "扩容座" if i >= 4 else "基础座"
    print(f"  座{i}  {deg:>5.1f}°  ({p[0]:>6.1f}, {p[1]:>6.1f})  {tag}")

# ---- 约束①：相邻座不重叠 ----
# 逐对算弦长。展开一圈（含首尾，即座5→座0）才是真正的"环上相邻"。
print("\n相邻座弦长（判据：> 2×最大塔半径）:")
need = 2 * TURRET_R                   # TURRET_R 已是最外圈（含扩容系数），不能再乘一次
ok_all = True
worst = 1e9
for i in range(len(SEAT_ANGLES_DEG)):
    # 环上相邻：座5 → 座0 是跨零点的一段，差值要先归一到 [0,360)
    d = (SEAT_ANGLES_DEG[(i + 1) % len(SEAT_ANGLES_DEG)]
         - SEAT_ANGLES_DEG[i]) % 360
    d = min(d, 360 - d)              # 取锐角（>180° 的那侧等价于补角）
    chord = 2 * SEAT_RING_R * math.sin(math.radians(d / 2))
    worst = min(worst, chord)
    ok = chord > need
    ok_all &= ok
    print(f"  座{i} ↔ 座{(i+1) % 6}  Δ={d:>5.1f}°  弦长={chord:>5.1f}px  "
          f"{'✓' if ok else '❌'}")
print(f"  最窄处 {worst:.1f}px，需 > {need:.1f}px（富余 {worst-need:.1f}px）")

# ---- 约束②：塔座不得脱离机体轮廓 ----
# 判定标准：塔座内缘（ring_r - turret_r）应当触到或压住机体轮廓，
# 完全脱离（内缘 > 机体半宽/半长）就会变成"浮在艇外的独立零件"。
half_len, half_wid = SUB_LEN / 2, SUB_WID / 2
print(f"\n机体 {SUB_LEN}×{SUB_WID}（半长 {half_len}、半宽 {half_wid}）:")
ok_hull = True
for i, deg in enumerate(SEAT_ANGLES_DEG):
    x, y = ring_pt(deg)
    inner = SEAT_RING_R - TURRET_R * EXT_K
    # 该方向上机体轮廓的半径（椭圆与该角度的交点）
    a = math.radians(deg)
    edge = 1.0 / math.hypot(math.cos(a) / half_len, math.sin(a) / half_wid)
    touches = inner <= edge
    ok_hull &= touches
    print(f"  座{i}  塔心距 {SEAT_RING_R:>4.1f}px  内缘 {inner:>4.1f}px  "
          f"该向机体轮廓 {edge:>4.1f}px  {'✓ 压在艇身上' if touches else '❌ 脱离机体'}")

# ---- 约束③：艏（0°）与艉（180°）必须空出来 ----
# 艏留给探照灯锥（玩家的朝向指示），艉留给推进器尾焰。
# 阈值 20°：再近塔的炮管就会压到光锥/尾焰上。
print("\n艏艉留空:")
mind = min(min(abs(d), abs(abs(d) - 180)) for d in SEAT_ANGLES_DEG)
nearest = min(SEAT_ANGLES_DEG, key=lambda d: min(abs(d), abs(abs(d) - 180)))
ok_clear = mind > 20
print(f"  离艏/艉最近的座：{nearest:.0f}°（距 {mind:.0f}°，需 > 20°）"
      f"  {'✓' if ok_clear else '❌'}")

# ---- 汇总 ----
print()
allok = ok_all and ok_hull and ok_clear
print("结论: " + ("✅ 座圈布局自洽" if allok else "❌ 有约束未满足"))
print("  ① 相邻座不重叠: " + ("✓" if ok_all else "❌"))
print("  ② 塔座压在机体上: " + ("✓" if ok_hull else "❌"))
print("  ③ 艏艉留空: " + ("✓" if ok_clear else "❌"))