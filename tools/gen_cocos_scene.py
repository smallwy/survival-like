# -*- coding: utf-8 -*-
"""生成 Cocos Creator 3.8.8 可直接打开的工程骨架（**脚手架，通常只跑一次**）。

产出：
  · assets/scenes/Dive.scene               —— 照抄编辑器自带的 scene-2d.scene 结构，
                                              只改名字/坐标/id，并加一个预挂 DiveGame 的 Game 节点
  · assets/scenes/Dive.scene.meta
  · assets/scripts/view/DiveGame.ts.meta   —— 固定 uuid，让场景里的组件引用立即有效
  · settings/v2/packages/project.json      —— 设计分辨率 1304x749
  · settings/v2/packages/scene.json        —— 让编辑器自动打开 Dive 场景
  · .creator/default-meta.json             —— 图片默认按 sprite-frame 导入

⚠️ 生成之后**场景就该在编辑器里改**。本脚本默认**拒绝覆盖已存在的文件**
   （加了 --force 才覆盖）—— 因为它不知道你在编辑器里改了什么，
   默默覆盖 = 静默丢掉美术摆位/新加的节点。

用法：
    python tools/gen_cocos_scene.py            # 已存在则拒绝并列出，退出码 1
    python tools/gen_cocos_scene.py --force    # 明确要求重新生成

两个容易被忽略的前提，写在这里免得下次再找一遍：
  1. 场景里引用**用户脚本**用的是脚本资源的**压缩 uuid**（23 字符，5 位保留头 +
     其余 hex 每 3 位转 2 个 base64 字符）。算法在 tools/cocos_uuid.py，带往返自检。
     算错的后果是编辑器显示 **Missing Script** —— 所以在纯文本里"预挂组件"
     这件事能不能做，全看这个算法对不对。
  2. 本文件的场景结构是**逐字段照抄**编辑器 3.8.8 自带的 2D 场景模板
     （`resources/.../default_file_content/scene/scene-2d.scene`），
     只改 `_name` / `_lpos` / `_contentSize` / `_id`，并新增 Game 节点与组件。
     凭记忆手写 `cc.SceneGlobals` 那一段是必错的。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
ROOT = os.path.join(_ROOT, 'cocos')

# UUID 压缩算法**只存一份** —— 在 tools/cocos_uuid.py（版本化、带往返自检）。
# 这里直接复用，免得同一套微妙算法写两遍、其中一处被改坏还没人发现。
sys.path.insert(0, _HERE)
from cocos_uuid import compress_uuid, selfcheck, BASE64_KEY_CHARS  # noqa: E402


# ---------------------------------------------------------------------------
# 固定的 UUID（写死 → 场景与脚本 meta 永远对得上，跨机器可复现）
# ---------------------------------------------------------------------------
SCRIPT_UUID = "7b3c9d10-4e2a-4f68-9c51-8d2e6a0b13f4"   # assets/scripts/view/DiveGame.ts
SCENE_UUID = "3f7a1c2e-9b4d-4a86-8c15-2e7d6f0a9b43"    # assets/scenes/Dive.scene

DESIGN_W = 1304
DESIGN_H = 749
SEED = 20261013

_rid = random.Random(0xC0C05)


def nid() -> str:
    """22 字符的节点/组件 id（Cocos 用同一套 base64 字符集生成）。"""
    return "".join(_rid.choice(BASE64_KEY_CHARS) for _ in range(22))


WRITE_TARGETS = [
    'assets/scenes/Dive.scene',
    'assets/scenes/Dive.scene.meta',
    'assets/scripts/view/DiveGame.ts.meta',
    'settings/v2/packages/project.json',
    'settings/v2/packages/scene.json',
    '.creator/default-meta.json',
]


def main() -> int:
    ap = argparse.ArgumentParser(
        description='生成 cocos/ 工程骨架（脚手架，通常只跑一次）')
    ap.add_argument('--force', action='store_true',
                    help='已存在的文件也覆盖（会丢掉编辑器里的手改，想清楚再用）')
    args = ap.parse_args()

    # ---- 拒绝静默覆盖 ----
    # 这些文件生成之后是"在编辑器里维护"的。默默覆盖 = 丢掉美术摆位、新加的节点，
    # 而且丢了不会报错 —— 这正是最需要脚本主动挡一下的那类操作。
    existing = [t for t in WRITE_TARGETS if os.path.exists(os.path.join(ROOT, t))]
    if existing and not args.force:
        print('以下文件已存在，本脚本拒绝覆盖（生成后它们应当在编辑器里维护）：')
        for t in existing:
            print('  - cocos/' + t)
        print('\n确实要按模板重新生成，请加 --force（会丢弃编辑器里的改动）。')
        return 1

    selfcheck()
    script_cls = compress_uuid(SCRIPT_UUID)
    print(f"[uuid] DiveGame.ts  uuid = {SCRIPT_UUID}")
    print(f"[uuid] 场景内引用压缩形式 = {script_cls}")

    def write(path: str, text: str) -> None:
        full = os.path.join(ROOT, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"  写入 {path}")

    # -----------------------------------------------------------------------
    # 1) 场景 —— 结构照抄编辑器的 scene-2d.scene
    # -----------------------------------------------------------------------
    scene = [
        {   # 0
            "__type__": "cc.SceneAsset",
            "_name": "Dive",
            "_objFlags": 0,
            "_native": "",
            "scene": {"__id__": 1},
        },
        {   # 1
            "__type__": "cc.Scene",
            "_name": "Dive",
            "_objFlags": 0,
            "_parent": None,
            "_children": [{"__id__": 2}],
            "_active": True,
            "_components": [],
            "_prefab": None,
            "autoReleaseAssets": False,
            "_globals": {"__id__": 10},
            "_id": SCENE_UUID,
        },
        {   # 2  Canvas
            "__type__": "cc.Node",
            "_name": "Canvas",
            "_objFlags": 0,
            "_parent": {"__id__": 1},
            "_children": [{"__id__": 3}, {"__id__": 8}],
            "_active": True,
            "_components": [{"__id__": 5}, {"__id__": 6}, {"__id__": 7}],
            "_prefab": None,
            "_lpos": {"__type__": "cc.Vec3", "x": DESIGN_W / 2, "y": DESIGN_H / 2, "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
            "_layer": 33554432,          # UI_2D
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_id": nid(),
        },
        {   # 3  Camera
            "__type__": "cc.Node",
            "_name": "Camera",
            "_objFlags": 0,
            "_parent": {"__id__": 2},
            "_children": [],
            "_active": True,
            "_components": [{"__id__": 4}],
            "_prefab": None,
            "_lpos": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
            "_layer": 1073741824,        # DEFAULT
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_id": nid(),
        },
        {   # 4  cc.Camera（_visibility 含 UI_2D，UI 相机）
            "__type__": "cc.Camera",
            "_name": "",
            "_objFlags": 0,
            "node": {"__id__": 3},
            "_enabled": True,
            "__prefab": None,
            "_projection": 0,
            "_priority": 0,
            "_fov": 45,
            "_fovAxis": 0,
            "_orthoHeight": 10,
            "_near": 0,
            "_far": 2000,
            "_color": {"__type__": "cc.Color", "r": 0, "g": 0, "b": 0, "a": 255},
            "_depth": 1,
            "_stencil": 0,
            "_clearFlags": 7,
            "_rect": {"__type__": "cc.Rect", "x": 0, "y": 0, "width": 1, "height": 1},
            "_aperture": 19,
            "_shutter": 7,
            "_iso": 0,
            "_screenScale": 1,
            "_visibility": 1108344832,   # DEFAULT | UI_2D | IGNORE_RAYCAST
            "_targetTexture": None,
            "_id": nid(),
        },
        {   # 5  Canvas UITransform
            "__type__": "cc.UITransform",
            "_name": "",
            "_objFlags": 0,
            "node": {"__id__": 2},
            "_enabled": True,
            "__prefab": None,
            "_contentSize": {"__type__": "cc.Size", "width": DESIGN_W, "height": DESIGN_H},
            "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
            "_id": nid(),
        },
        {   # 6  cc.Canvas
            "__type__": "cc.Canvas",
            "_name": "",
            "_objFlags": 0,
            "node": {"__id__": 2},
            "_enabled": True,
            "__prefab": None,
            "_cameraComponent": {"__id__": 4},
            "_alignCanvasWithScreen": True,
            "_id": nid(),
        },
        {   # 7  cc.Widget（Canvas 随屏幕铺满）
            "__type__": "cc.Widget",
            "_name": "",
            "_objFlags": 0,
            "node": {"__id__": 2},
            "_enabled": True,
            "__prefab": None,
            "_alignFlags": 45,
            "_target": None,
            "_left": 0,
            "_right": 0,
            "_top": 0,
            "_bottom": 0,
            "_horizontalCenter": 0,
            "_verticalCenter": 0,
            "_isAbsLeft": True,
            "_isAbsRight": True,
            "_isAbsTop": True,
            "_isAbsBottom": True,
            "_isAbsHorizontalCenter": True,
            "_isAbsVerticalCenter": True,
            "_originalWidth": 0,
            "_originalHeight": 0,
            "_alignMode": 2,
            "_lockFlags": 0,
            "_id": nid(),
        },
        {   # 8  Game（挂 DiveGame）
            "__type__": "cc.Node",
            "_name": "Game",
            "_objFlags": 0,
            "_parent": {"__id__": 2},
            "_children": [],
            "_active": True,
            "_components": [{"__id__": 9}],
            "_prefab": None,
            "_lpos": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
            "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
            "_layer": 33554432,          # UI_2D —— 必须与 Canvas 同层，否则 UI 相机不渲染
            "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
            "_id": nid(),
        },
        {   # 9  DiveGame 组件（__type__ = 脚本的压缩 uuid）
            "__type__": script_cls,
            "_name": "",
            "_objFlags": 0,
            "node": {"__id__": 8},
            "_enabled": True,
            "__prefab": None,
            "designW": DESIGN_W,
            "designH": DESIGN_H,
            "seed": SEED,
            "subIndex": 0,
            "cam": {"__id__": 4},
            "_id": nid(),
        },
        {   # 10 cc.SceneGlobals
            "__type__": "cc.SceneGlobals",
            "ambient": {"__id__": 11},
            "shadows": {"__id__": 12},
            "_skybox": {"__id__": 13},
            "fog": {"__id__": 14},
            "octree": {"__id__": 15},
            "skin": {"__id__": 16},
        },
        {   # 11
            "__type__": "cc.AmbientInfo",
            "_skyColorHDR": {"__type__": "cc.Vec4", "x": 0, "y": 0, "z": 0, "w": 0.520833125},
            "_skyColor": {"__type__": "cc.Vec4", "x": 0, "y": 0, "z": 0, "w": 0.520833125},
            "_skyIllumHDR": 20000,
            "_skyIllum": 20000,
            "_groundAlbedoHDR": {"__type__": "cc.Vec4", "x": 0, "y": 0, "z": 0, "w": 0},
            "_groundAlbedo": {"__type__": "cc.Vec4", "x": 0, "y": 0, "z": 0, "w": 0},
            "_skyColorLDR": {"__type__": "cc.Vec4", "x": 0.2, "y": 0.5, "z": 0.8, "w": 1},
            "_skyIllumLDR": 20000,
            "_groundAlbedoLDR": {"__type__": "cc.Vec4", "x": 0.2, "y": 0.2, "z": 0.2, "w": 1},
        },
        {   # 12
            "__type__": "cc.ShadowsInfo",
            "_enabled": False,
            "_type": 0,
            "_normal": {"__type__": "cc.Vec3", "x": 0, "y": 1, "z": 0},
            "_distance": 0,
            "_shadowColor": {"__type__": "cc.Color", "r": 76, "g": 76, "b": 76, "a": 255},
            "_maxReceived": 4,
            "_size": {"__type__": "cc.Vec2", "x": 512, "y": 512},
        },
        {   # 13
            "__type__": "cc.SkyboxInfo",
            "_envLightingType": 0,
            "_envmapHDR": None,
            "_envmap": None,
            "_envmapLDR": None,
            "_diffuseMapHDR": None,
            "_diffuseMapLDR": None,
            "_enabled": False,
            "_useHDR": True,
        },
        {   # 14
            "__type__": "cc.FogInfo",
            "_type": 0,
            "_fogColor": {"__type__": "cc.Color", "r": 200, "g": 200, "b": 200, "a": 255},
            "_enabled": False,
            "_fogDensity": 0.3,
            "_fogStart": 0.5,
            "_fogEnd": 300,
            "_fogAtten": 5,
            "_fogTop": 1.5,
            "_fogRange": 1.2,
            "_accurate": False,
        },
        {   # 15
            "__type__": "cc.OctreeInfo",
            "_enabled": False,
            "_minPos": {"__type__": "cc.Vec3", "x": -1024, "y": -1024, "z": -1024},
            "_maxPos": {"__type__": "cc.Vec3", "x": 1024, "y": 1024, "z": 1024},
            "_depth": 8,
        },
        {   # 16
            "__type__": "cc.SkinInfo",
            "_enabled": False,
            "_scale": 5,
        },
    ]

    write("assets/scenes/Dive.scene", json.dumps(scene, indent=2, ensure_ascii=False) + "\n")
    write("assets/scenes/Dive.scene.meta", json.dumps({
        "ver": "1.1.50", "importer": "scene", "imported": True,
        "uuid": SCENE_UUID, "files": [".json"], "subMetas": {}, "userData": {},
    }, indent=2) + "\n")

    # -----------------------------------------------------------------------
    # 2) 脚本 meta —— 固定 uuid，场景里的组件引用靠它成立
    # -----------------------------------------------------------------------
    write("assets/scripts/view/DiveGame.ts.meta", json.dumps({
        "ver": "4.0.24", "importer": "typescript", "imported": True,
        "uuid": SCRIPT_UUID, "files": [], "subMetas": {}, "userData": {},
    }, indent=2) + "\n")

    # -----------------------------------------------------------------------
    # 3) 工程设置
    # -----------------------------------------------------------------------
    write("settings/v2/packages/project.json", json.dumps({
        "__version__": "1.0.6",
        "general": {
            "designResolution": {
                "width": DESIGN_W,
                "height": DESIGN_H,
                "fitWidth": True,
                "fitHeight": False,
            },
        },
    }, indent=2) + "\n")

    write("settings/v2/packages/scene.json", json.dumps({
        "__version__": "1.0.0",
        "current-scene": SCENE_UUID,
    }, indent=2) + "\n")

    write(".creator/default-meta.json", json.dumps({
        "image": {"type": "sprite-frame"},
    }, indent=2) + "\n")

    print('\n完成。之后请直接在 Cocos Creator 里改这 6 个文件。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
