# 幸存者（轻美术）· 工程说明

一款轻美术幸存者类（Survivors-like）游戏：**Phaser 3 + TypeScript + Vite** 前端，**Go** 后端（云存档/排行榜），为独立个人与跨设备协作设计，可上 Steam。

## 技术栈
- 前端：Phaser 3（游戏）、TypeScript、Vite（开发服务器 + 构建）
- 后端：Go 1.21+（标准库，零第三方依赖）
- 通信：前端 `/api/*` 由 Vite 代理到 Go（默认 `localhost:8080`）

## 目录结构
```
survivors-game/
├── go.mod                 # Go 模块（无外部依赖）
├── server/                # 后端 Go
│   ├── main.go            # 入口：加载配置 + 路由
│   └── internal/
│       ├── config/        # 环境变量配置（APP_PORT / APP_DATA_DIR）
│       ├── store/         # JSON 文件存储（存档/排行榜）
│       └── handler/       # HTTP 接口
├── web/                   # 前端
│   ├── package.json
│   ├── vite.config.ts     # 开发代理 /api -> 后端
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.ts        # Phaser 启动
│       ├── scenes/GameScene.ts  # 核心玩法
│       ├── config/gameData.ts   # 数值/内容数据表（策划改这里）
│       ├── types.d.ts     # 静态资源类型声明
│       └── assets/
│           ├── pixel/           # 【游戏内单位】像素帧序列 spritesheet + manifest.json
│           └── portraits/       # 【静态展示】AI 立绘（选人卡片 / HUD 头像）
├── tools/
│   ├── pixelgen.py            # 像素角色生成器：产出 assets/pixel/*（改配色/体型后重跑）
│   ├── check_facing_applied.mjs  # 回归守卫：朝向与动作是否真的贴到了角色上
│   └── process_portraits.py   # 立绘后处理：抠白底 + 归一化到 256（改动原图后重跑）
├── docs/                  # 策划文档 + 数据表
│   ├── 立项策划案.md
│   ├── 武器被动表.csv
│   └── 数值框架.md
├── data/                  # 运行时数据（已在 .gitignore，不入库）
└── README.md
```

## 环境要求
- **Go** 1.21 或更高（后端）
- **Node.js** 18 或更高（前端）
- 任意操作系统（Windows / macOS / Linux 均可，工程不含机器相关路径）

## 在两台电脑间迁移 / 共享（核心诉求）
本工程是**独立 Git 仓库**，已规划可移植：
1. 在公司电脑：`git commit && git push` 到你的远程仓库（GitHub / Gitee / 公司 GitLab）。
2. 在自己电脑：`git clone` 同一个仓库。
3. 两台电脑都执行下面"运行"步骤即可，进度通过后端云存档自动同步（同一 `playerId`）。

> 关键点：所有配置走环境变量，所有依赖锁在 `go.mod` / `package.json`，运行时数据不入库——clone 即跑，绝不绑定某一台机器。

## 运行（开发模式，前后端同时）
```bash
# 终端 1：后端
cd server
go run .            # 默认监听 :8080，数据写 ./data

# 终端 2：前端
cd web
npm install         # 首次需要（会拉取 phaser/vite/typescript）
npm run dev         # 打开 http://localhost:5173
```
前端所有 `/api` 请求会被 Vite 自动代理到 `localhost:8080`，无需任何额外配置。

## 运行（仅后端 / 生产）
```bash
cd server
APP_PORT=8080 APP_DATA_DIR=./data go run .
# 或编译后运行：
go build -o ../bin/server ./server && ../bin/server
```

## 如何改数值（策划向，不碰逻辑）
打开 `web/src/config/gameData.ts`：
- `WEAPONS`：武器伤害/间隔/弹数
- `ENEMIES`：敌人血量/速度/伤害/外观颜色
- `UPGRADES`：升级池
- `BALANCE`：玩家血量/移速/经验曲线/刷怪间隔/单局时长

改完保存，Vite 热更新立即生效。详见 `docs/数值框架.md`。

## 后端 API
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/meta?pid=<id>` | 读取 meta 进度（武器/角色解锁） |
| POST | `/api/meta?pid=<id>` | 上报一局结果，返回 `unlockedNow`（本次解锁项） |
| POST | `/api/leaderboard` | 提交成绩 `{playerId,name,score}` |
| GET | `/api/leaderboard` | 取 Top100 |

> 当前存储为本地 JSON 文件，便于零依赖起步；上线前可替换为 SQLite 或云存储，接口不变。

## 接 Steam（后续）
- MVP 稳定后，前端接入 Steamworks SDK（或绿色版 wrapper），后端继续托管云存档与排行榜。
- 后端已做接口隔离，迁移成本低。

## 美术说明

### 游戏内单位：程序化像素帧序列（主方案）
- 全部角色/敌人由 `tools/pixelgen.py` **程序化绘制**，不依赖外部素材，也不消耗 AI 生图额度。
- 每个单位都画在同一张 **32x32 逻辑像素网格**上（硬边几何 + 1px 深色描边）；
  需要更大的单位（Boss）时按**整数倍**放大整张网格，因此**所有单位之间的像素块大小一致**——像素游戏的核心美学规则。
- 帧规格：**3 方向（下 / 上 / 侧）x 3 动作（待机 2 帧 / 走路 4 帧 / 攻击 3 帧）**，合成 4 列 x 9 行的 spritesheet。
- **为什么用帧序列而不是立绘变形**：AI 立绘是静态展示品，不含任何动作信息，让它抬手/转身
  只能靠代码旋转缩放去"猜"，必然别扭（这也是早期几轮返工的根因）。像素帧序列里
  **朝向和抬手是画出来的**，不存在推导误差。
- 攻击帧的「武器前端」坐标由生成器算好写入 `manifest.json`，游戏直接读取 → 子弹必定从武器口发出，无需再量 alpha 猜枪口。
- 重新生成（改完配色/体型/武器后重跑即可）：
  ```bash
  python tools/pixelgen.py   # 产出 web/src/assets/pixel/*.png + manifest.json + docs/pixel-preview-*.png
  ```
- 配色、体型、武器类型集中在 `pixelgen.py` 顶部的 `HEROES` / `FOES` 两张表里改。
- 回归守卫：`node tools/check_facing_applied.mjs` 会断言「朝向/动作真的被 setFrame 贴到角色上」，
  以及「sheet 尺寸与 manifest 的帧布局一致」——防止再次出现"算了朝向却没接上线"。

### AI 立绘：只用于静态展示
- 来源 `web/src/assets/portraits_raw/`（不入库），由 AI 生成的 chibi 立绘。
- 用途仅限**静态展示**：选人卡片、HUD 头像、Steam 商店页与宣传图。
- 入库版本由 `tools/process_portraits.py` 后处理：抠白底（flood fill，保留角色内部眼白）→ 裁切归一化到 256 → 降采样（包体约 11MB → 1MB）。
- **Steam 发布要求**：商店页需勾选「AI 生成内容」披露。像素单位是程序生成、不涉及该披露，但一并说明更稳妥。

### 表现层
- 玩家：走路 / 待机 / 施法三套帧动画 + 脚下扬尘 + 开火后坐（**整数像素位移**，保持像素网格锐利）。
- 敌人：朝玩家切换方向帧，并按 `eid` 错开动画相位（否则整屏敌人同步踏步会非常机械）。
- 射击：枪口火光、旋转曳光弹、命中火花与闪白、震屏。

## 已知 TODO
- [x] 更多武器 / 敌人 / Boss 与波次（gun/orbit/beam/aura + 射手 + 双 Boss + 波次导演）
- [x] meta 解锁（后端 /api/meta 驱动武器/皮肤解锁，结算自动上报）
- [x] 游戏内单位改为程序化像素帧序列（3 方向 x 3 动作；朝向与抬手都是画出来的，不靠变形推导）
- [x] AI 立绘转岗静态展示（选人卡片 / HUD 头像）
- [x] 子弹从武器口发出（枪口坐标由生成器写入 manifest，游戏直接读）
- [x] 玩家移动感（走路帧 + 脚下扬尘）与 HUD 视觉优化
- [ ] 音效与轻量特效（提升"爽感"）
- [ ] Steam 接入与商店页 / 预告片
