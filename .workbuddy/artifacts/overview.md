# 提交今天的工作到 GitHub —— 交付概览

## 本次做了什么

把积压的多轮工作（L2 元系统 + 主界面版式规格 + 道具卡立绘补齐 + 一批设计文档）整理并推送到 `origin/cocos`。

- **分支**：`cocos` → `origin/cocos`（github.com/smallwy/survival-like.git）
- **推送结果**：`81bb4a4..fbe91c1` **成功**，本地与远端已一致，工作区干净

## 两笔原子提交

| 提交 | 说明 | 变更 |
|---|---|---|
| `0a2103d` | `chore(git)`：补 `.gitignore` | 1 file, +8 |
| `fbe91c1` | `feat(cocos)`：L2 元系统 + 主界面版式规格 | 65 files, +7347 / −547 |

## 提交前处理的两件事

**① 误删的 `.meta` 已恢复**
`item_abyss_mark.png.meta`、`item_sonar_fc.png.meta` 曾被误删（但 `.png` 与代码引用都还在），
`git checkout --` 找回，避免了一次"资源被 Cocos 重新导入"的隐患。

**② 发现一个历史坑：43MB AI 源图早已误入库**
`.gitignore` 当初只排了 `fish/_regen/`、`sub/_regen_v2/`，**漏了 `web/src/assets/items/_regen/`**，
导致该目录约 39MB 的 Oct-12 AI 原图**早已被提交进仓库**（`git ls-files` 可证），Oct-13 新加的 7 个文件尚未入库。

本次处理：**新增忽略规则，只拦住"新增的 7 个文件"**；历史里已有的 43MB **未回收**
（要回收须 `filter-repo` / `filter-branch` **改写历史 + 强推**，风险大，留作待定）。

## 忽略规则（新增两条）

```
web/src/assets/items/_regen/     # 与 fish/_regen、sub/_regen_v2 同一约定：AI 源图不入库
.workbuddy/artifacts/*.png        # 诊断图/对照图可重新生成，仓库只留 overview.md 与 memory
```

随后做了**混入保险检查**：`git diff --cached --name-only | grep -E "_regen/|artifacts/.*\.png"`
→ 无命中，确认 66 个待提交文件里没有一张该排除的 PNG。

## 待你决定（1 项）

**是否回收历史里的 43MB AI 源图？**
- 不回收（推荐）：历史保持不动，仅阻止继续增长。**零风险**。
- 回收：需在 `cocos` 分支跑 `git filter-repo --path web/src/assets/items/_regen/ --invert-paths` 后**强推**，
  队友/其他克隆需重新 clone。**有风险**，且当前仓库仅你一人维护时可接受。

## 未完成（延续上一轮，未在本轮动）

- **Creator 3.8.8 目视 4 处**：标题屏钱包 / 结算屏沉淀两行 / 图鉴屏 24→18 格 / 装置坞四 tab 三态
- **主界面版式 3 个待拍板点**（见 `docs/主界面版式_V6.38.md`），拍板后才动 `Title.ts`
- **A 做底 + B 做线（海域关卡）**：方向已定，未开工；**C 母港经营**挂后期

---

产物：两笔提交已上线；记忆见 `.workbuddy/memory/2026-10-13.md`。
