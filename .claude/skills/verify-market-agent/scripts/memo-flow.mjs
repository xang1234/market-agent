// Symbol page -> Analyze -> Investment memo -> Generate memo, the way a user does it.
// Exits 1 unless the memo generates with the analyst agent's four sections, each citing
// an F or C id or saying no stored source covers it, with no stance word in the agent's
// own words. Saves what it saw to OUT.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, LISTING_ID, OUT, DATABASE_URL } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
const { Client } = createRequire(join(ROOT, 'services/dev-api/package.json'))('pg')
mkdirSync(OUT, { recursive: true })

const SECTIONS = ['investment_thesis', 'growth_drivers', 'competitive_position', 'downside_risks']
const EMPTY = /^(No stored source covers this section|This section was not written)/
// Case matters for Buy, Hold and Sell: a 10-K's "we sell" is not a Sell.
const stanceIn = (text) => [...text.matchAll(/\b(?:Buy|Hold|Sell)\b/g), ...text.matchAll(/\b(?:rating|conviction)\b/gi)].map((match) => match[0])
const LLM_LOG = join(ROOT, '.dev/logs/dev-api.log')
const logSize = () => (existsSync(LLM_LOG) ? statSync(LLM_LOG).size : 0)

const browser = await chromium.launch()
let failure = null
let text = ''
let canvas = ''
let url = ''
let run = null
let memoMs = null
const logFrom = logSize()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  try {
    await page.goto(`${WEB_URL}/symbol/listing:${LISTING_ID}/overview`)
    await page.locator('[data-testid=analyze-this-subject]').click({ timeout: 30_000 })
    await page.waitForURL(/\/analyze\?subject=/, { timeout: 30_000 })
    await page.locator('select:has(option[value="investment_memo"])').selectOption('investment_memo', { timeout: 30_000 })
    await page.screenshot({ path: join(OUT, '1-analyze.png'), fullPage: true })
    const response = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/v1/analyze/runs'), { timeout: 200_000 })
    const started = Date.now()
    await page.getByRole('button', { name: 'Generate memo' }).click({ timeout: 30_000 })
    await page.getByText(/Memo generated|Generate failed/).first().waitFor({ timeout: 200_000 })
    const generated = await response
    if (generated.ok()) {
      await page.locator('article [data-block-kind="section"]').first().waitFor({ timeout: 30_000 })
      memoMs = Date.now() - started
      run = await generated.json()
    }
    canvas = await page.locator('article').first().evaluate((node) => {
      const copy = node.cloneNode(true)
      copy.querySelectorAll('[data-ref-kind="claim"]').forEach((quote) => quote.remove())
      return copy.innerText ?? copy.textContent ?? ''
    })
  } catch (error) {
    failure = error.message
  }
  text = await page.locator('body').innerText()
  url = page.url()
  await page.screenshot({ path: join(OUT, '2-result.png'), fullPage: true })
} finally {
  await browser.close()
}

const blocks = run?.blocks ?? []
const sections = blocks.filter((block) => block.kind === 'section' && SECTIONS.includes(block.data_ref?.params?.playbook_section_id))
const segmentsOf = (block) => [...(block.segments ?? []), ...(block.commentary ?? []).flatMap((part) => part.segments ?? []), ...(block.children ?? []).flatMap(segmentsOf)]
const claimIds = [...new Set(sections.flatMap((section) => section.claim_refs ?? []))]
const predicates = new Map()
if (claimIds.length > 0) {
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  try {
    const { rows } = await db.query('select claim_id::text as id, predicate from claims where claim_id = any($1::uuid[])', [claimIds])
    for (const row of rows) predicates.set(row.id, row.predicate)
  } finally {
    await db.end()
  }
}
const report = {
  url,
  subject_matches: new URL(url).searchParams.get('subject') === `listing:${LISTING_ID}`,
  generated: text.includes('Memo generated'),
  memo_ms: memoMs,
  llm_calls: existsSync(LLM_LOG) ? (readFileSync(LLM_LOG).subarray(logFrom).toString().match(/^\[llm\] /gm) ?? []).length : null,
  sections: SECTIONS.map((id) => {
    const section = sections.find((entry) => entry.data_ref.params.playbook_section_id === id)
    if (!section) return { id, shown: false }
    const segments = segmentsOf(section)
    const notes = segments.filter((segment) => segment.type === 'text').map((segment) => segment.text)
    return {
      id,
      title: section.title,
      shown: canvas.includes(section.title),
      claims: (section.claim_refs ?? []).map((claim) => predicates.get(claim) ?? 'unknown'),
      figures: segments.filter((segment) => segment.type === 'ref' && segment.ref_kind === 'result').length,
      empty: notes.some((note) => EMPTY.test(note)),
    }
  }),
  certified_blocks: blocks.filter((block) => block.kind === 'financial_answer').length,
  stance_words: stanceIn(canvas),
  page_stance_words: stanceIn(text),
  failure,
  evidence: OUT,
}
const competitive = report.sections.find((section) => section.id === 'competitive_position')
report.competitive_cites_competition = competitive?.claims?.includes('business.competition') ?? false
writeFileSync(join(OUT, 'page.txt'), text)
writeFileSync(join(OUT, 'run.json'), JSON.stringify(run, null, 2))
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
const sectionPasses = (section) => section.shown && (section.empty || section.claims.length > 0 || section.figures > 0)
const passed =
  failure === null && report.subject_matches && report.generated &&
  report.sections.every(sectionPasses) &&
  (competitive.empty || report.competitive_cites_competition) &&
  report.stance_words.length === 0
process.exit(passed ? 0 : 1)
