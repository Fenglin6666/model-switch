import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@core': r('../../packages/core/src'),
      '@physics': r('../../packages/physics/src'),
      '@render': r('../../packages/render/src'),
      '@ui': r('../../packages/ui/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // 厂商 API 的跨域预检不通过（OPTIONS 不回 Access-Control-Allow-Origin），
      // 浏览器直连会被拦。开发期由这里转发；Authorization 由前端带，服务端不存 key。
      '/llm': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/llm/, '/api/coding/paas/v4'),
      },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
})
