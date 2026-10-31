import { expect, test, type Locator, type Page } from '@playwright/test'

// The golden conversation (#118) in a real browser (#122, #194): Analyze NVDA -> Compare it
// with AMD YTD -> Explain the differences and show the evidence -> inspect a cited figure ->
// reload, on the no-keys stack (frozen dataset + recorded model replies), against its UI
// replay, and in the static demo build. The API-level golden test covers the data; this
// proves the UI renders and links it.

// Each answer is rendered from its recorded reply's assertions, so neither the
// placeholder nor the fallback sentence passes.
const NVDA_NARRATIVE = "NVDA's revenue rose in every period from Q1 FY2025"
const NVDA_REVENUE = 'NVIDIA Corporation: Revenue'
const COMPARE_NARRATIVE = "Of NVDA and AMD, NVDA's price return was highest"
const EXPLAIN_NARRATIVE = 'effective Jun 2025 on AMD'
const AMD_RELEASE = 'AMD Reports Second Quarter 2025 Financial Results (Form 8-K, Exhibit 99.1)'
const QUESTIONS = ['Analyze NVDA', 'Compare it with AMD YTD', 'Explain the differences and show the evidence']
const YTD_TITLE = 'Price return YTD 2026 (split-adjusted, excluding dividends)'
const YTD_RANGE = 'YTD 2026: 2025-12-31 close to 2026-08-31 close'
// Against a capturing stack (docs/development.md, UI mode), also open every evidence page
// each answer offers, so the replays can show any of them.
const CAPTURE = process.env.E2E_CAPTURE === '1'
// Against the static demo build (playwright.config.ts).
const DEMO = process.env.E2E_DEMO === '1'
// A capture records a real stack's responses; the demo answers in the page and has none.
if (CAPTURE && DEMO) throw new Error('E2E_CAPTURE records a running stack; unset E2E_DEMO')

async function ask(page: Page, question: string) {
  // One turn at a time: Send stays disabled until the previous answer is sealed.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  const composer = page.getByRole('textbox', { name: 'Ask the analyst' })
  await composer.fill(question)
  await composer.press('Enter')
}

const answer = (page: Page, narrative: string) =>
  page.locator('[data-role="assistant"]', { hasText: narrative })
const compareAnswer = (page: Page) =>
  page.locator('[data-role="assistant"]', { hasText: COMPARE_NARRATIVE, hasNotText: EXPLAIN_NARRATIVE })

// The URLs of the /v1 requests the page makes from now on. The static demo answers them
// in the page, so they never reach the network; there the evidence is the demo's own
// `[demo replay]` log line for each (src/demo/demoBackend.ts), self-reported, not observed.
function apiRequests(page: Page, method: string, path: RegExp): string[] {
  const seen: string[] = []
  page.on('request', (request) => {
    if (request.method() === method && path.test(new URL(request.url()).pathname)) seen.push(request.url())
  })
  page.on('console', (message) => {
    const logged = /^\[demo replay\] (\S+) (\S+) ->/.exec(message.text())
    if (logged && logged[1] === method && path.test(logged[2]!)) seen.push(logged[2]!)
  })
  return seen
}

test('golden conversation renders the verified answer, the year-to-date chart and inspectable sources, and survives a reload', async ({ page }) => {
  test.slow(CAPTURE, 'opens every evidence page')
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
  const historyReads = apiRequests(page, 'GET', /\/v1\/chat\/threads\/[^/]+\/messages$/)

  // The demo answers /v1 in the page, so a /v1 request on the network came from code that
  // held fetch or EventSource before the replay replaced them.
  const leakedToNetwork: string[] = []
  if (DEMO) {
    await page.context().route('**/v1/**', (route) => {
      const request = `${route.request().method()} ${route.request().url()}`
      leakedToNetwork.push(request)
      // Reported where it happens: the aborted request may break the page before the end.
      expect.soft(request, 'a /v1 request reached the network').toBeUndefined()
      return route.abort()
    })
  }

  // Auto-login (VITE_MA_FLAG_DEV_AUTO_LOGIN, or the demo build) means no sign-in step.
  // Relative, so it stays under a base path (the demo's /market-agent/).
  await page.goto('chat')
  await ask(page, QUESTIONS[0])
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('thread-name')).not.toHaveText(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  await expect(page.getByText(NVDA_NARRATIVE)).toBeVisible()
  await expect(answer(page, NVDA_NARRATIVE)).toBeVisible()
  const narrativeCounts = await page.evaluate(() => (window as unknown as { __narrativeCounts: number[] }).__narrativeCounts)
  expect(narrativeCounts.length).toBeGreaterThan(0)
  expect(narrativeCounts.filter((count) => count !== 1)).toEqual([])
  await expect(page.getByRole('status').filter({ hasText: 'Loading message history' })).toHaveCount(0)
  // The engine's verified answer: its revenue over the quarters, drawn as bars.
  await expect(answer(page, NVDA_NARRATIVE).getByText('Verified calculation')).toBeVisible()
  await expect(page.getByText(NVDA_REVENUE)).toBeVisible()
  await expectProportionalBars(page)
  if (CAPTURE) {
    await openEveryEvidencePage(page, answer(page, NVDA_NARRATIVE))
    await loadThreadElsewhere(page, QUESTIONS.slice(0, 1))
  }

  await ask(page, QUESTIONS[1])
  await expect(compareAnswer(page)).toBeVisible()
  await expectYtdChart(compareAnswer(page))
  // End-of-day prices and the split-adjusted, dividend-free basis are disclosed (#191).
  const disclosure = compareAnswer(page).locator('[data-block-kind="disclosure"]')
  await expect(disclosure).toContainText('end-of-day')
  await expect(disclosure).toContainText('split-adjusted price returns; dividends are not included')
  if (CAPTURE) {
    await openEveryEvidencePage(page, compareAnswer(page))
    await loadThreadElsewhere(page, QUESTIONS.slice(0, 2))
  }

  await ask(page, QUESTIONS[2])
  await expect(answer(page, EXPLAIN_NARRATIVE)).toBeVisible()
  await expectYtdChart(answer(page, EXPLAIN_NARRATIVE))
  await expect(answer(page, EXPLAIN_NARRATIVE).locator('button[data-inspection-kind="claim"]')).toContainText('$800 million')
  if (CAPTURE) await openEveryEvidencePage(page, answer(page, EXPLAIN_NARRATIVE))

  await inspectCitedClaim(page, answer(page, EXPLAIN_NARRATIVE))

  expect(historyReads).toEqual([])

  // Reload: all three questions and answers come back from the persisted thread, with
  // their figures, chart points and sources.
  const streamsAfterReload = apiRequests(page, 'GET', /\/v1\/chat\/threads\/[^/]+\/stream$/)
  await page.reload()
  for (const question of QUESTIONS) {
    await expect(page.locator('[data-role="user"]', { hasText: question })).toBeVisible()
  }
  await expect(page.getByText(NVDA_NARRATIVE)).toBeVisible()
  await expect(page.getByText(NVDA_REVENUE)).toBeVisible()
  await expectYtdChart(compareAnswer(page))
  await expect(answer(page, EXPLAIN_NARRATIVE)).toBeVisible()
  await inspectCitedClaim(page, answer(page, EXPLAIN_NARRATIVE))
  expect(historyReads.length).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  expect(streamsAfterReload).toEqual([])
  expect(leakedToNetwork).toEqual([])
})

// What a reload between turns reads, recorded so the replays show the thread as it stood
// then: without it, the only history recorded is the final reload's, all three turns. A
// second tab, so this page's request log stays what the visitor's page asked.
async function loadThreadElsewhere(page: Page, asked: readonly string[]) {
  const tab = await page.context().newPage()
  await tab.goto(page.url())
  await expect(tab.locator('[data-role="user"]')).toHaveCount(asked.length)
  for (const question of asked) await expect(tab.locator('[data-role="user"]', { hasText: question })).toBeVisible()
  await expect(tab.locator('[data-role="assistant"]')).toHaveCount(asked.length)
  await tab.close()
}

async function expectYtdChart(message: Locator) {
  const chart = message.locator('[data-block-kind="perf_comparison"]')
  await expect(chart).toBeVisible()
  const labelled = message.locator('[data-block-verification]', { has: message.page().locator('[data-block-kind="perf_comparison"]') })
  await expect(labelled).toHaveAttribute('data-block-verification', 'source_linked')
  for (const legacy of ['metric_row', 'revenue_bars', 'metrics_comparison', 'segment_donut']) {
    await expect(message.locator(`[data-block-kind="${legacy}"]`)).toHaveCount(0)
  }
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

async function inspectCitedClaim(page: Page, message: Locator) {
  await message.locator('button[data-inspection-kind="claim"]').first().click()
  const inspector = page.getByRole('complementary', { name: 'Evidence inspector' })
  await expect(inspector).toBeVisible()
  await inspector.locator('button[data-inspection-kind="document"]').first().click()
  await expect(inspector.getByRole('heading', { name: AMD_RELEASE, exact: true })).toBeVisible()
  await inspector.getByRole('button', { name: 'Close' }).click()
  await expect(inspector).toBeHidden()
}

// Every evidence page a visitor can reach from this answer, each opened once: the pages
// each block's metadata lists and its figures open, then every ref those pages link to.
async function openEveryEvidencePage(page: Page, message: Locator) {
  const inspector = page.getByRole('complementary', { name: 'Evidence inspector' })
  const opened = new Set<string>()
  // False when the ref was already opened, so nothing changed.
  async function inspect(control: Locator): Promise<boolean> {
    const ref = `${await control.getAttribute('data-inspection-kind')} ${await control.getAttribute('data-inspection-id')}`
    if (opened.has(ref)) return false
    opened.add(ref)
    const lookup = page.waitForResponse((response) => new URL(response.url()).pathname === '/v1/evidence/inspect')
    await control.click()
    expect((await lookup).status(), ref).toBe(200)
    await expect(inspector.getByRole('status')).toHaveCount(0)
    await inspectLinks()
    return true
  }
  async function inspectLinks() {
    for (const link of await inspector.locator('button[data-inspection-kind]').all()) {
      if (await inspect(link)) await inspector.getByRole('button', { name: 'Back' }).click()
    }
  }
  const close = () => inspector.getByRole('button', { name: 'Close' }).click()
  for (const block of await message.locator('[data-testid^="block-shell-"]').all()) {
    await block.hover()
    await block.getByRole('button', { name: 'Inspect block metadata' }).first().click()
    await inspectLinks()
    await close()
  }
  for (const figure of await message.locator('button[data-inspection-kind]').all()) {
    if (await inspect(figure)) await close()
  }
}

// The revenue series draws real bars (#187): the longest is a sizeable bar, and
// each bar's width matches its share of the longest, as its inline percentage says.
// The nearest figure only: the answer's own figure also holds the growth series' bars.
async function expectProportionalBars(page: Page) {
  const bars = page.getByText(NVDA_REVENUE).locator('xpath=ancestor::figure[1]').locator('[aria-hidden="true"] > div')
  await expect(bars.first()).toBeVisible()
  const measured = await bars.evaluateAll((nodes) =>
    nodes.map((node) => ({ px: node.getBoundingClientRect().width, pct: parseFloat((node as HTMLElement).style.width) })))
  expect(measured.length).toBeGreaterThan(1)
  const longest = measured.reduce((a, b) => (b.px > a.px ? b : a))
  expect(longest.px).toBeGreaterThan(40)
  expect(measured.length).toBe(8)
  for (const bar of measured) expect(bar.px / longest.px).toBeCloseTo(bar.pct / longest.pct, 1)
}
