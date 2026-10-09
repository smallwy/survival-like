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
│       └── assets/portraits/    # AI 生成的角色立绘（PNG）
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

## 美术说明与 AI 披露
- 游戏内角色小人：由 `GameScene.makeHero()` 程序绘制（零图片资源）。
- 选人界面 / HUD 立绘：`web/src/assets/portraits/*.png` 为 AI 生成（chibi 卡通风格）。
- **Steam 发布要求**：上架时需在商店页勾选「AI 生成内容」披露，因角色立绘为 AI 生成。这是平台合规项，不影响审核。

## 已知 TODO
- [x] 更多武器 / 敌人 / Boss 与波次（gun/orbit/beam/aura + 射手 + 双 Boss + 波次导演）
- [x] meta 解锁（后端 /api/meta 驱动武器/皮肤解锁，结算自动上报）
- [x] 角色立绘与选人界面（AI 生成 chibi 立绘 + 程序绘制小人）
- [ ] 音效与轻量特效（提升"爽感"）
- [ ] Steam 接入与商店页 / 预告片
