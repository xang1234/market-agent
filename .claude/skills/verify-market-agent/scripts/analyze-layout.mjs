// Analyze with a memo open, at 1280, 1440 and 390 px, light and dark, with the evidence
// inspector closed and then open. Exits 1 if a desktop memo canvas is narrower than a
// readable line, or if any pane scrolls sideways. Saves a still of each view to OUT.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, LISTING_ID, OUT } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
mkdirSync(OUT, { recursive: true })

// About 40 characters of the memo's 14 px text.
const MIN_MEMO_PX = 300
const VIEWS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844, phone: true },
]

async function openMemo(page) {
  await page.goto(`${WEB_URL}/symbol/listing:${LISTING_ID}/overview`)
  await page.locator('[data-testid=analyze-this-subject]').click({ timeout: 30_000 })
  await page.waitForURL(/\/analyze\?subject=/, { timeout: 30_000 })
  // Playbooks and run history load together, so once the playbook is offered the history is in.
  await page.locator('select:has(option[value="investment_memo"])').selectOption('investment_memo', { timeout: 30_000 })
  const stored = page.locator('li', { hasText: 'Investment memo' }).getByRole('button', { name: 'Open', exact: true })
  if ((await stored.count()) > 0) await stored.first().click()
  else await page.getByRole('button', { name: 'Generate memo' }).click()
  await page.locator('article [data-block-kind="section"]').first().waitFor({ timeout: 200_000 })
}

function measure(page) {
  return page.evaluate(() => {
    const article = document.querySelector('article')
    const style = getComputedStyle(article)
    const text = [...article.querySelectorAll('p')].sort((a, b) => b.textContent.length - a.textContent.length)[0]
    const range = document.createRange()
    range.selectNodeContents(text)
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
    const memoPanel = article.parentElement.getBoundingClientRect()
    const controls = document.querySelector('select').closest('div').getBoundingClientRect()
    const inspector = document.querySelector('aside[aria-label$="inspector"]')?.getBoundingClientRect() ?? null
    // On a phone the open inspector takes the whole width and the canvas behind it is zero wide.
    const canvas = document.getElementById('workspace-main')
    const canvasHidden = canvas.clientWidth === 0
    return {
      memo_px: Math.round(article.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
      longest_paragraph: { chars: text.textContent.length, lines, chars_per_line: Math.round(text.textContent.length / lines) },
      side_by_side: memoPanel.left >= controls.right,
      inspector_box: inspector && { left: Math.round(inspector.left), right: Math.round(inspector.right) },
      canvas_hidden: canvasHidden,
      sideways: [...document.querySelectorAll('*')]
        .filter((element) => !(canvasHidden && canvas.contains(element)))
        .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && (element === document.documentElement || ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)))
        .map((element) => `${element.tagName}.${String(element.className).slice(0, 60)} ${element.scrollWidth}/${element.clientWidth}`),
    }
  })
}

async function still(page, path) {
  await page.locator('article').first().evaluate((node) => node.parentElement.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path })
}

const results = []
const failures = []
const browser = await chromium.launch()
try {
  for (const theme of ['light', 'dark']) {
    for (const view of VIEWS) {
      const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: theme })
      if (view.phone) await context.addInitScript(() => localStorage.setItem('sidebar-collapsed', 'true'))
      const page = await context.newPage()
      try {
        await openMemo(page)
        for (const inspector of ['closed', 'open']) {
          if (inspector === 'open') {
            await page.locator('[data-testid^="block-shell-"]').first().hover()
            await page.locator('[aria-label="Inspect block metadata"]').first().click()
            await page.locator('aside[aria-label$="inspector"]').waitFor({ timeout: 30_000 })
          }
          const shot = join(OUT, `${view.name}-${theme}-inspector-${inspector}.png`)
          await still(page, shot)
          const seen = { view: view.name, theme, inspector, ...(await measure(page)), shot }
          results.push(seen)
          const label = `${view.name} ${theme} inspector ${inspector}`
          if (seen.inspector_box && seen.inspector_box.right > view.width) failures.push(`${label}: inspector runs past the screen to ${seen.inspector_box.right}px`)
          if (!view.phone && seen.memo_px < MIN_MEMO_PX) failures.push(`${label}: memo canvas ${seen.memo_px}px is under ${MIN_MEMO_PX}px`)
          if (seen.sideways.length > 0) failures.push(`${label}: scrolls sideways ${seen.sideways.join(', ')}`)
        }
      } catch (error) {
        failures.push(`${view.name} ${theme}: ${error.message}`)
        await page.screenshot({ path: join(OUT, `${view.name}-${theme}-error.png`) }).catch((shotError) => console.warn(`no still of the failure: ${shotError.message}`))
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}

const report = { passed: failures.length === 0, failures, views: results, evidence: OUT }
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exit(report.passed ? 0 : 1)
