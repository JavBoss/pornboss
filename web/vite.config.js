import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendProxy = () => ({ target: 'http://localhost:17654', changeOrigin: false })

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/healthz': backendProxy(),
      '/auth': backendProxy(),
      '/videos': backendProxy(),
      '/tags': backendProxy(),
      '/sync': backendProxy(),
      '/directories': backendProxy(),
      '/downloader': backendProxy(),
      '/downloads': backendProxy(),
      '/extension': backendProxy(),
      '/jav': backendProxy(),
      '/config': backendProxy(),
      '/tools': backendProxy(),
    },
  },
})
