import { defineConfig, devices } from '@playwright/test'

// Browser smoke of the golden conversation (#122). Runs against an already-running
// no-keys stack: DEV_PROFILE=chat DEV_NO_KEYS=true ./scripts/dev-shell.sh up
// E2E_DEMO=1 runs it against the static demo instead (`npm run build:demo` first),
// served under its GitHub Pages base path.
const demo = process.env.E2E_DEMO === '1'
const DEMO_URL = 'http://127.0.0.1:4173/market-agent/'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? (demo ? DEMO_URL : 'http://127.0.0.1:5173'),
    trace: 'retain-on-failure',
  },
  webServer: demo ? { command: 'npm run preview:demo', url: DEMO_URL, reuseExistingServer: !process.env.CI } : undefined,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
