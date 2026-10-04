import { expect, test, type Locator, type Page } from '@playwright/test'

// The golden conversation (#118) in a real browser (#122, #194): Analyze NVDA -> Compare it
// with AMD YTD -> Explain the differences and show the evidence -> inspect a cited figure ->
// reload, on the no-keys stack (frozen dataset + recorded model replies) and against its UI
// replay. The API-level golden test covers the data; this proves the UI renders and links it.

const NVDA_NARRATIVE = "NVIDIA's reported revenue rose in every quarter shown"
const COMPARE_NARRATIVE = 'Side by side, NVIDIA reports much higher revenue'
// The whole recorded reply: a placeholder or a cut-off answer doesn't pass.
const EXPLAIN_NARRATIVE =
  'NVIDIA is far larger than AMD and converts more of its revenue into profit, as the table below shows; each figure links to its filing.'
const QUESTIONS = ['Analyze NVDA', 'Compare it with AMD YTD', 'Explain the differences and show the evidence']
const YTD_TITLE = 'Price return YTD 2026 (split-adjusted, excluding dividends)'
const YTD_RANGE = 'YTD 2026: 2025-12-31 close to 2026-08-31 close'

async function ask(page: Page, question: string) {
  const composer = page.getByRole('textbox', { name: 'Ask the analyst' })
  await composer.fill(question)
  await composer.press('Enter')
}

const answer = (page: Page, narrative: string) =>
  page.locator('[data-role="assistant"]', { hasText: narrative })

test('golden conversation renders charts, metrics and inspectable sources, and survives a reload', async ({ page }) => {
  // Auto-login (VITE_MA_FLAG_DEV_AUTO_LOGIN) means no sign-in step.
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Start research' }).click()
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/)

  await ask(page, QUESTIONS[0])
  await expect(page.getByText(NVDA_NARRATIVE)).toBeVisible()
  // Fact-built blocks: the metric row's figures and the revenue chart.
  await expect(page.getByText('Revenue', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Quarterly revenue')).toBeVisible()
  await expectProportionalBars(page)

  await ask(page, QUESTIONS[1])
  await expect(page.getByText(COMPARE_NARRATIVE)).toBeVisible()
  await expectComparison(answer(page, COMPARE_NARRATIVE))
  await expectYtdChart(answer(page, COMPARE_NARRATIVE))
  // End-of-day prices and the split-adjusted, dividend-free basis are disclosed (#191).
  const disclosure = answer(page, COMPARE_NARRATIVE).locator('[data-block-kind="disclosure"]')
  await expect(disclosure).toContainText('end-of-day')
  await expect(disclosure).toContainText('split-adjusted price returns; dividends are not included')

  await ask(page, QUESTIONS[2])
  await expect(page.getByText(EXPLAIN_NARRATIVE)).toBeVisible()
  // The third answer keeps both companies and shows the figures it points to.
  await expectComparison(answer(page, EXPLAIN_NARRATIVE))

  // The inspector opens a figure cited in the third answer and, through it, its filing.
  await inspectCitedFigure(page, answer(page, EXPLAIN_NARRATIVE))

  // Reload: all three questions and answers come back from the persisted thread, with
  // their figures, chart points and sources.
  await page.reload()
  for (const question of QUESTIONS) {
    await expect(page.locator('[data-role="user"]', { hasText: question })).toBeVisible()
  }
  await expect(page.getByText(NVDA_NARRATIVE)).toBeVisible()
  await expect(page.getByText('Quarterly revenue')).toBeVisible()
  await expect(page.getByText(COMPARE_NARRATIVE)).toBeVisible()
  await expectComparison(answer(page, COMPARE_NARRATIVE))
  await expectYtdChart(answer(page, COMPARE_NARRATIVE))
  await expect(page.getByText(EXPLAIN_NARRATIVE)).toBeVisible()
  await expectComparison(answer(page, EXPLAIN_NARRATIVE))
  await inspectCitedFigure(page, answer(page, EXPLAIN_NARRATIVE))
})

// NVDA first, then AMD, each row with figures that open their evidence.
async function expectComparison(message: Locator) {
  const table = message.locator('[data-block-kind="metrics_comparison"]')
  await expect(table).toBeVisible()
  await expect(table.locator('tbody th[scope="row"]')).toHaveText(['NVDA', 'AMD'])
  for (const row of await table.locator('tbody tr').all()) {
    await expect(row.locator('button[data-inspection-kind="fact"]').first()).toBeVisible()
  }
}

// The requested year-to-date window, labelled with its dates and basis, drawn as one
// line per company.
async function expectYtdChart(message: Locator) {
  const chart = message.locator('[data-block-kind="perf_comparison"]')
  await expect(chart).toBeVisible()
  await expect(chart).toContainText(YTD_TITLE)
  await expect(chart).toHaveAttribute('data-default-range', YTD_RANGE)
  await expect(chart.locator('[data-testid$="-legend"] li')).toHaveText(['NVDA(%)', 'AMD(%)'])
  const lines = chart.locator('svg path[fill="none"]')
  await expect(lines).toHaveCount(2)
  for (const line of await lines.all()) {
    // A drawn line has a move and at least one segment.
    expect((await line.getAttribute('d'))?.match(/[ML]/g)?.length ?? 0).toBeGreaterThan(1)
  }
}

async function inspectCitedFigure(page: Page, message: Locator) {
  await message.locator('button[data-inspection-kind="fact"]').first().click()
  const inspector = page.getByRole('complementary', { name: 'Evidence inspector' })
  await expect(inspector).toBeVisible()
  await inspector.locator('button[data-inspection-kind="source"]').first().click()
  await expect(inspector.getByRole('heading', { name: 'sec_edgar filing' })).toBeVisible()
  await inspector.getByRole('button', { name: 'Close' }).click()
  await expect(inspector).toBeHidden()
}

// The revenue chart draws real bars (#187): the tallest fills most of the chart, and
// each bar's height matches its share of the tallest, as its inline percentage says.
async function expectProportionalBars(page: Page) {
  const bars = page.locator('[data-testid^="block-revenue-bars-"] [data-bar]')
  await expect(bars.first()).toBeVisible()
  const measured = await bars.evaluateAll((nodes) =>
    nodes.map((node) => ({ px: node.getBoundingClientRect().height, pct: parseFloat((node as HTMLElement).style.height) })))
  expect(measured.length).toBeGreaterThan(1)
  const tallest = measured.reduce((a, b) => (b.px > a.px ? b : a))
  expect(tallest.px).toBeGreaterThan(40)
  for (const bar of measured) expect(bar.px / tallest.px).toBeCloseTo(bar.pct / tallest.pct, 1)
}
