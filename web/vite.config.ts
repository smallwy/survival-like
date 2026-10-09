import { defineConfig } from 'vite'

// 开发环境下，前端所有 /api 请求被代理到 Go 后端（默认 8080）。
// 这样前端代码里只用写相对路径 /api/...，换机器、换端口都不用改代码。
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
