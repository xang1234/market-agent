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
      '/v1/chat': {
        target: process.env.CHAT_ORIGIN ?? 'http://127.0.0.1:4310',
        changeOrigin: true,
      },
      '/v1/run-activities': {
        target: process.env.CHAT_ORIGIN ?? 'http://127.0.0.1:4310',
        changeOrigin: true,
      },
      '/v1/watchlists': {
        target: process.env.WATCHLISTS_ORIGIN ?? 'http://127.0.0.1:4313',
        changeOrigin: true,
      },
      '/v1/market': {
        target: process.env.MARKET_ORIGIN ?? 'http://127.0.0.1:4321',
        changeOrigin: true,
      },
      '/v1/fundamentals': {
        target: process.env.FUNDAMENTALS_ORIGIN ?? 'http://127.0.0.1:4322',
        changeOrigin: true,
      },
      '/v1/screener': {
        target: process.env.SCREENER_ORIGIN ?? 'http://127.0.0.1:4323',
        changeOrigin: true,
      },
      '/v1/portfolios': {
        target: process.env.PORTFOLIO_ORIGIN ?? 'http://127.0.0.1:4333',
        changeOrigin: true,
      },
      '/v1/home': {
        target: process.env.HOME_ORIGIN ?? 'http://127.0.0.1:4334',
        changeOrigin: true,
      },
      '/v1/evidence': {
        target: process.env.EVIDENCE_ORIGIN ?? 'http://127.0.0.1:4335',
        changeOrigin: true,
      },
    },
  },
})
