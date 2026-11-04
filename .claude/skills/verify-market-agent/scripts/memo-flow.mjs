// Symbol page -> Analyze -> Generate memo, the way a user does it. Exits 1 unless the
// memo generates and carries evidence claims, and always saves what it saw to OUT.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, LISTING_ID, OUT } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
let failure = null
try {
  await page.goto(`${WEB_URL}/symbol/listing:${LISTING_ID}/overview`)
  await page.locator('[data-testid=analyze-this-subject]').click({ timeout: 30_000 })
  await page.waitForURL(/\/analyze\?subject=/, { timeout: 30_000 })
  await page.screenshot({ path: join(OUT, '1-analyze.png'), fullPage: true })
  await page.getByRole('button', { name: 'Generate memo' }).click({ timeout: 30_000 })
  await page.getByText(/Memo generated|Generate failed/).first().waitFor({ timeout: 180_000 })
} catch (error) {
  failure = error.message
}
const text = await page.locator('body').innerText()
await page.screenshot({ path: join(OUT, '2-result.png'), fullPage: true })
await browser.close()

writeFileSync(join(OUT, 'page.txt'), text)
const report = {
  url: page.url(),
  generated: text.includes('Memo generated'),
  insufficient_evidence: text.includes('Insufficient local evidence'),
  sec_8k_mentions: (text.match(/8-K/g) ?? []).length,
  failure,
  evidence: OUT,
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exit(report.generated && !report.insufficient_evidence ? 0 : 1)
