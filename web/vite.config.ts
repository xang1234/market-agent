import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1/subjects': {
        target: process.env.RESOLVER_ORIGIN ?? 'http://127.0.0.1:4311',
        changeOrigin: true,
      },
      '/v1/watchlists': {
        target: process.env.WATCHLISTS_ORIGIN ?? 'http://127.0.0.1:4313',
        changeOrigin: true,
      },
    },
  },
})
