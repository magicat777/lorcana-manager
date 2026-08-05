import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // dev-only: point /api at the deployed API through the web NodePort
      '/api': { target: 'http://192.168.1.154:30710', changeOrigin: true },
    },
  },
})
