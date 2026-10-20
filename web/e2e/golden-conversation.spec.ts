import { expect, test, type Locator, type Page } from '@playwright/test'

// The golden conversation (#118) in a real browser (#122, #194): Analyze NVDA -> Compare it
// with AMD YTD -> Explain the differences and show the evidence -> inspect a cited figure ->
// reload, on the no-keys stack (frozen dataset + recorded model replies) and against its UI
// replay. The API-level golden test covers the data; this proves the UI renders and links it.

// Each answer is rendered from its recorded reply's assertions, so neither the
// placeholder nor the fallback sentence passes.
const NVDA_NARRATIVE = "NVDA's revenue rose in every period from Q1 2025"
const COMPARE_NARRATIVE = "Of NVDA and AMD, NVDA's revenue was highest"
const EXPLAIN_NARRATIVE = "Of NVDA and AMD, NVDA's gross margin was highest"
const QUESTIONS = ['Analyze NVDA', 'Compare it with AMD YTD', 'Explain the differences and show the evidence']
const YTD_TITLE = 'Price return YTD 2026 (split-adjusted, excluding dividends)'
const YTD_RANGE = 'YTD 2026: 2025-12-31 close to 2026-08-31 close'

async function ask(page: Page, question: string) {
  // One turn at a time: Send stays disabled until the previous answer is sealed.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  const composer = page.getByRole('textbox', { name: 'Ask the analyst' })
  await composer.fill(question)
  await composer.press('Enter')
}

const answer = (page: Page, narrative: string) =>
  page.locator('[data-role="assistant"]', { hasText: narrative })

test('golden conversation renders charts, metrics and inspectable sources, and survives a reload', async ({ page }) => {
  // From its first appearance, the first answer is on the page exactly once in every
  // mutation batch: the streamed copy hands off to the sealed one with no gap or duplicate.
  await page.addInitScript((narrative) => {
    const counts: number[] = []
    Object.assign(window, { __narrativeCounts: counts })
    new MutationObserver(() => {
      const occurrences = (document.body?.textContent ?? '').split(narrative).length - 1
      if (occurrences > 0 || counts.length > 0) counts.push(occurrences)
    }).observe(document, { subtree: true, childList: true, characterData: true })
  }, NVDA_NARRATIVE)

  // Each completion carries its sealed answer (#331), so no turn reads the thread back:
  // from the first question until the reload, the page never GETs the thread's messages.
  const historyReads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/v1\/chat\/threads\/[^/]+\/messages$/.test(new URL(request.url()).pathname)) {
      historyReads.push(request.url())
    }
  })

  // Auto-login (VITE_MA_FLAG_DEV_AUTO_LOGIN) means no sign-in step.
  await page.goto('/chat')
  await ask(page, QUESTIONS[0])
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('thread-name')).not.toHaveText(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  await expect(page.getByText(NVDA_NARRATIVE)).toBeVisible()
  await expect(answer(page, NVDA_NARRATIVE)).toBeVisible()
  const narrativeCounts = await page.evaluate(() => (window as unknown as { __narrativeCounts: number[] }).__narrativeCounts)
  expect(narrativeCounts.length).toBeGreaterThan(0)
  expect(narrativeCounts.filter((count) => count !== 1)).toEqual([])
  await expect(page.getByRole('status').filter({ hasText: 'Loading message history' })).toHaveCount(0)
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

  expect(historyReads).toEqual([])

  // Reload: all three questions and answers come back from the persisted thread, with
  // their figures, chart points and sources.
  const streamsAfterReload: string[] = []
  page.on('request', (request) => {
    if (/\/v1\/chat\/threads\/[^/]+\/stream$/.test(new URL(request.url()).pathname)) streamsAfterReload.push(request.url())
  })
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
  expect(historyReads.length).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  expect(streamsAfterReload).toEqual([])
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
  await expect(inspector.getByRole('heading', { name: /^(sec_edgar|golden_fixture) filing$/ })).toBeVisible()
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
