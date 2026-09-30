import { defineConfig, devices } from '@playwright/test'

// Browser smoke of the golden conversation (#122). Runs against an already-running
// no-keys stack: DEV_PROFILE=chat DEV_NO_KEYS=true ./scripts/dev-shell.sh up
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
