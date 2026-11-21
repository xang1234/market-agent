// Agents detail, Symbol overview and Screener, plus Review, Grids and Home as controls,
// at 1024, 1280 and 1440 px, light and dark, with the evidence inspector closed and then
// open. Exits 1 if a part a page names is narrower than its floor, or if any pane
// scrolls sideways. Saves a still of each view to OUT.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, LISTING_ID, OUT } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
mkdirSync(OUT, { recursive: true })

const VIEWS = [1024, 1280, 1440]
const AGENT_NAME = 'Layout check agent'
const SCREENER_FORM = 'form[aria-label="Screener query controls"]'
// Each floor sits under what that part gets on main at 1280 px with the inspector closed,
// so the closed layout passes and a column the inspector squeezes fails.
const PAGES = [
  {
    name: 'agents', path: '/agents', ready: '#thesis-panel-heading', open: openAgent,
    parts: [
      ['agent form', 'form:has([name="agent-name"])', 300],
      ['thesis panel', 'section[aria-labelledby="thesis-panel-heading"]', 300],
      ['quick subject id', 'label:has([name="subject-id"])', 120],
      ['delivery channel', 'label:has([name="alert-mobile-push"])', 100],
    ],
  },
  {
    name: 'symbol-overview', path: `/symbol/listing:${LISTING_ID}/overview`, ready: '[data-testid="key-stats-grid"]',
    // The subject header's tab strip needs about 440 px, so a narrower canvas scrolls
    // sideways on main as well. Recorded as a note rather than a failure.
    minCanvasPx: 440,
    parts: [
      ['company profile', '[data-testid="overview-profile"]', 290],
      ['analyst consensus', '[data-testid="overview-consensus"]', 280],
      ['key stat', '[data-testid^="key-stat-"]', 110],
    ],
  },
  {
    name: 'screener', path: '/screener', ready: SCREENER_FORM,
    parts: [
      ['query fieldset', `${SCREENER_FORM} fieldset`, 200],
      ['starter screen', '[aria-label="Starter screens"] button', 160],
    ],
  },
  { name: 'review', path: '/review', ready: 'h1', parts: [] },
  { name: 'grids', path: '/analyst-grids', ready: 'h1', parts: [] },
  { name: 'home', path: '/home', ready: 'h1', parts: [] },
]

// The inspector lives in the shell, so a full load closes it. Route in the app instead.
async function route(page, path) {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

// The detail column shows only with an agent selected. Creates one the first time.
async function openAgent(page) {
  const row = page.locator('li', { has: page.locator('h3', { hasText: AGENT_NAME }) })
  await page.locator('[name="agent-name"]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1_000)
  if ((await row.count()) === 0) {
    await page.locator('[name="agent-name"]').fill(AGENT_NAME)
    await page.locator('[name="agent-thesis"]').fill('Checks that the page lays out.')
    await page.locator('[name="static-subject-refs"]').fill(`listing:${LISTING_ID}`)
    await page.getByRole('button', { name: 'Create agent' }).click()
    await row.first().waitFor({ timeout: 30_000 })
  }
  await row.first().getByRole('button', { name: 'View', exact: true }).click()
}

async function openInspector(page) {
  await page.goto(`${WEB_URL}/symbol/listing:${LISTING_ID}/overview`)
  await page.locator('[data-testid=analyze-this-subject]').click({ timeout: 30_000 })
  await page.waitForURL(/\/analyze\?subject=/, { timeout: 30_000 })
  await page.locator('select:has(option[value="investment_memo"])').selectOption('investment_memo', { timeout: 30_000 })
  const stored = page.locator('li', { hasText: 'Investment memo' }).getByRole('button', { name: 'Open', exact: true })
  if ((await stored.count()) > 0) await stored.first().click()
  else await page.getByRole('button', { name: 'Generate memo' }).click()
  await page.locator('[data-testid^="block-shell-"]').first().hover({ timeout: 200_000 })
  await page.locator('[aria-label="Inspect block metadata"]').first().click()
  await page.locator('aside[aria-label$="inspector"]').waitFor({ timeout: 30_000 })
}

function measure(page, parts) {
  return page.evaluate((parts) => {
    const canvas = document.getElementById('workspace-main')
    const grids = [...canvas.querySelectorAll('*')]
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).display === 'grid')
      .map((element) => ({ element, columns: getComputedStyle(element).gridTemplateColumns.split(' ').map(parseFloat) }))
      .filter(({ columns }) => columns.length > 1)
      .map(({ element, columns }) => ({ grid: `${element.tagName}.${String(element.className).slice(0, 80)}`, columns: columns.map(Math.round) }))
    return {
      canvas_px: canvas.clientWidth,
      parts: parts.map(([name, selector, floor]) => {
        const widths = [...canvas.querySelectorAll(selector)].filter((element) => element.getClientRects().length > 0).map((element) => Math.round(element.getBoundingClientRect().width))
        return { name, floor, found: widths.length, min_px: widths.length ? Math.min(...widths) : null }
      }),
      inspector: Boolean(document.querySelector('aside[aria-label$="inspector"]')),
      grids,
      sideways: [...document.querySelectorAll('*')]
        .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && (element === document.documentElement || ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)))
        .map((element) => `${element.tagName}.${String(element.className).slice(0, 60)} ${element.scrollWidth}/${element.clientWidth}`),
    }
  }, parts)
}

const results = []
const failures = []
const notes = []
const browser = await chromium.launch()
try {
  for (const theme of ['light', 'dark']) {
    for (const width of VIEWS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
      const page = await context.newPage()
      try {
        for (const inspector of ['closed', 'open']) {
          if (inspector === 'open') await openInspector(page)
          else await page.goto(`${WEB_URL}/home`)
          for (const target of PAGES) {
            const label = `${target.name} ${width} ${theme} inspector ${inspector}`
            try {
              await route(page, target.path)
              await target.open?.(page)
              await page.locator(target.ready).first().waitFor({ timeout: 30_000 })
              await page.waitForTimeout(1_500)
              const shot = join(OUT, `${target.name}-${width}-${theme}-inspector-${inspector}.png`)
              await page.screenshot({ path: shot })
              const seen = { page: target.name, width, theme, inspector, ...(await measure(page, target.parts)), shot }
              results.push(seen)
              if (seen.inspector !== (inspector === 'open')) failures.push(`${label}: inspector is ${seen.inspector ? 'open' : 'closed'}`)
              for (const part of seen.parts.filter((part) => part.found === 0 || part.min_px < part.floor)) {
                failures.push(`${label}: ${part.name} ${part.found === 0 ? 'not found' : `is ${part.min_px}px, under ${part.floor}px`}`)
              }
              if (seen.sideways.length > 0) (seen.canvas_px < (target.minCanvasPx ?? 0) ? notes : failures).push(`${label}: scrolls sideways ${seen.sideways.join(', ')}`)
            } catch (error) {
              failures.push(`${label}: ${error.message.split('\n')[0]}`)
              await page.screenshot({ path: join(OUT, `${target.name}-${width}-${theme}-inspector-${inspector}-error.png`) }).catch((shotError) => console.warn(`no still of the failure: ${shotError.message}`))
            }
          }
        }
      } catch (error) {
        failures.push(`${width} ${theme}: ${error.message.split('\n')[0]}`)
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}

const report = { passed: failures.length === 0, failures, notes, views: results.map(({ grids, ...view }) => view), evidence: OUT }
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ ...report, views: results }, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exit(report.passed ? 0 : 1)
