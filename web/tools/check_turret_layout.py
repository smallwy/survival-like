import math
# 与 DiveScene.ts 常量保持一致（改动时同步）
HARDPOINTS=[(-0.26,0.46),(-0.26,-0.46),(0.26,0.46),(0.26,-0.46)]
SUB_LEN, SUB_WID = 99, 52
TURRET_L, TURRET_W = 38, 26
TWIN_OFF=[-0.10,0.10]
TWIN_K=0.52

def pts(): return [(hx*SUB_LEN, hy*SUB_WID) for hx,hy in HARDPOINTS]
P=pts()
print("塔中心（艇身局部坐标）:")
for i,p in enumerate(P): print(f"  座{i}: ({p[0]:.1f}, {p[1]:.1f})")

# 塔旋转 theta 后，在 y 轴方向的半投影（判断异舷）
def half_proj_y(theta):
    return abs(TURRET_L/2*math.sin(theta)) + abs(TURRET_W/2*math.cos(theta))
def half_proj_x(theta):
    return abs(TURRET_L/2*math.cos(theta)) + abs(TURRET_W/2*math.sin(theta))

worst = max(half_proj_y(math.radians(a)) for a in range(0,61))
print(f"\n异舷（沿宽度方向）:")
print(f"  间距 = {abs(P[0][1]-P[1][1]):.2f}px")
print(f"  最坏半投影(0~60°) = {worst:.2f}px → 两塔需 {2*worst:.2f}px")
ok_y = abs(P[0][1]-P[1][1]) >= 2*worst
print(f"  {'✓ 不重叠' if ok_y else '❌ 会重叠'}")

worst_x = max(half_proj_x(math.radians(a)) for a in range(0,61))
print(f"\n同舷（沿长度方向）:")
print(f"  间距 = {abs(P[0][0]-P[2][0]):.2f}px")
print(f"  最坏半投影 = {worst_x:.2f}px → 两塔需 {2*worst_x:.2f}px")
ok_x = abs(P[0][0]-P[2][0]) >= 2*worst_x
print(f"  {'✓ 不重叠' if ok_x else '❌ 会重叠'}")

# 双联：同座两根管
d = abs(TWIN_OFF[1]-TWIN_OFF[0])*SUB_WID
tl, tw = TURRET_L*TWIN_K, TURRET_W*TWIN_K
print(f"\n双联同座两根管:")
print(f"  中心距 = {d:.2f}px, 每根 {tl:.1f}×{tw:.1f}")
print(f"  宽度方向重叠 {max(0,tw-d):.1f}px（少量重叠是'并联'的设计意图）")
# 双联管与异舷最近管的距离
near = abs(P[0][1]+TWIN_OFF[1]*SUB_WID) - abs(P[1][1]+TWIN_OFF[0]*SUB_WID)
print(f"  双联座与异舷最近管间距 = {near:.2f}px")
ok_t = near >= 2*max(abs(tl/2*math.sin(math.radians(a)))+abs(tw/2*math.cos(math.radians(a))) for a in range(0,61))
print(f"  {'✓ 不重叠' if ok_t else '❌ 会重叠'}")

print(f"\n艇身 {SUB_LEN}×{SUB_WID}，塔中心 y=±{abs(P[0][1]):.1f}（半宽 {SUB_WID/2} 之内={'✓' if abs(P[0][1])<SUB_WID/2 else '❌'}）")
print(f"\n结论: {'✅ 布局自洽' if (ok_y and ok_x and ok_t) else '❌ 仍有重叠'}")
