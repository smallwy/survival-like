import { defineConfig } from 'vite'

// 开发环境下，前端所有 /api 请求被代理到 Go 后端。
// 这样前端代码里只用写相对路径 /api/...，换机器、换端口都不用改代码。
//
// 端口说明：本机 8080 常被其它程序占用（netstat 可见），故默认用 8099。
// 需要改端口时直接设环境变量即可，无需改代码：
//   Windows(cmd):   set API_PORT=9000 && npm run dev
//   PowerShell:     $env:API_PORT=9000; npm run dev
//   bash:           API_PORT=9000 npm run dev
const apiPort = process.env.API_PORT || '8099'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true
      }
    }
  }
})
