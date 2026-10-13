import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// 开发环境下，前端所有 /api 请求被代理到 Go 后端。
// 这样前端代码里只用写相对路径 /api/...，换机器、换端口都不用改代码。
//
// 端口说明：本机 8080 常被其它程序占用（netstat 可见），故默认用 8099。
// 需要改端口时直接设环境变量即可，无需改代码：
//   Windows(cmd):   set API_PORT=9000 && npm run dev
//   PowerShell:     $env:API_PORT=9000; npm run dev
//   bash:           API_PORT=9000 npm run dev
const apiPort = process.env.API_PORT || '8099'

// ---------------------------------------------------------------------------
// 共享真源 `shared/`（项目根，在 web/ 之外）
//
// Phaser 与 Cocos 两套前端共用同一份引擎无关逻辑/数值表。web 侧**直接引用**
// `../shared/*`（不复制），所以要同时做两件事：
//   ① resolve.alias —— 让打包器把 `@shared/xxx` 解析到 ../shared/xxx；
//   ② server.fs.allow —— 开发服务器默认只允许读 root(web/)，要显式放行 shared/，
//      否则 Vite 会拒绝对 /@fs/../shared/... 的请求（页面白屏 + 控制台 403）。
//
// 为什么不用"复制一份到 web/src"：那样就会有第二份真源，改平衡要同步两处 ——
// 正是这次重构要根除的问题。（Cocos 侧因为只编译 assets/ 下的脚本，只能复制，
// 由 tools/sync_shared.py 统一生成并带 GENERATED 横幅 + 漂移检查。）
// ---------------------------------------------------------------------------
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@shared': sharedDir }
  },
  server: {
    port: 5173,
    fs: {
      // searchForWorkspaceRoot 保留 Vite 的默认放行范围（项目根/node_modules 等）
      allow: [searchForWorkspaceRoot(process.cwd()), sharedDir]
    },
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true
      }
    }
  }
})
