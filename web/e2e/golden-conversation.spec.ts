import { expect, test, type Page } from '@playwright/test'

// The golden conversation (#118) in a real browser (#122): Analyze NVDA -> Compare it
// with AMD -> reload, on the no-keys stack (frozen dataset + recorded model replies).
// The API-level golden test covers the data; this proves the UI renders and links it.

const NVDA_NARRATIVE = "NVIDIA's reported revenue rose in every quarter shown"
const AMD_NARRATIVE = 'Side by side, NVIDIA reports much higher revenue'

async function ask(page: Page, question: string) {
  const composer = page.getByRole('textbox', { name: 'Ask the analyst' })
  await composer.fill(question)
  await composer.press('Enter')
}

test('golden conversation renders charts, metrics and inspectable sources, and survives a reload', async ({ page }) => {
  // Auto-login (VITE_MA_FLAG_DEV_AUTO_LOGIN) means no sign-in step.
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Start research' }).click()
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/)

  await ask(page, 'Analyze NVDA')
  await expect(page.getByText(NVDA_NARRATIVE)).toBeVisible()
  // Fact-built blocks: the metric row's figures and the revenue chart.
  await expect(page.getByText('Revenue', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Quarterly revenue')).toBeVisible()

  await ask(page, 'Compare it with AMD')
  await expect(page.getByText(AMD_NARRATIVE)).toBeVisible()

  // The inspector opens a cited figure and, through it, the filing it came from.
  await page.locator('button[data-inspection-kind="fact"]').first().click()
  const inspector = page.getByRole('complementary', { name: 'Evidence inspector' })
  await expect(inspector).toBeVisible()
  await inspector.locator('button[data-inspection-kind="source"]').first().click()
  await expect(inspector.getByRole('heading', { name: 'sec_edgar filing' })).toBeVisible()
  await inspector.getByRole('button', { name: 'Close' }).click()

  // Reload: both answers come back from the persisted thread.
  await page.reload()
  await expect(page.getByText(NVDA_NARRATIVE)).toBeVisible()
  await expect(page.getByText(AMD_NARRATIVE)).toBeVisible()
  await expect(page.getByText('Quarterly revenue')).toBeVisible()
})
