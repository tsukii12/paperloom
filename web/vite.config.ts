import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// 版本号只在 package.json 里写一次,构建时注入前端(设置页「关于」显示)
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// 开发模式下 API/资产代理到后端 8686 端口
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8686',
      '/files': 'http://127.0.0.1:8686',
    },
  },
})
