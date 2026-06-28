import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev:preview` proxies API/media to production so the dev server (HMR) renders
// against real data without a local backend. Default `dev` keeps the local backend target.
const previewProxy = process.env.npm_lifecycle_event === 'dev:preview'
const apiTarget = previewProxy ? 'https://inshinlab.com' : 'http://127.0.0.1:4310'
const proxyEntry = { target: apiTarget, changeOrigin: previewProxy, secure: false }

export default defineConfig({
  base: '/ai-dash/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ai-dash/api': proxyEntry,
      '/ai-dash/media': proxyEntry,
      '/ai-dash/screenshots': proxyEntry,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('recharts')) return 'charts'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('react')) return 'react-vendor'
        },
      },
    },
  },
})
