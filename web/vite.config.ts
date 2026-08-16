import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // dev-only: point /api at the deployed API through the web NodePort
      '/api': { target: 'http://jason-holt-blade-18-rz09-0484.local:30710', changeOrigin: true },
    },
  },
})
