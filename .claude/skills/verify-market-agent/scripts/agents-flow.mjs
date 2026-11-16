// Analyze -> Monitor this thesis -> Agents, the way a user does it: the memo's
// thesis section becomes a thesis agent, its conditions are drafted (or typed
// from CONDITIONS), and the agent runs twice. Exits 1 unless the handoff
// carries the memo's investment thesis section, and after the two runs every
// condition shows two dated assessments, newest first, each citing F or C refs
// or saying not enough evidence, and at 390 px nothing scrolls sideways.
// Records each run's model calls from the dev-api log. Saves what it saw to OUT.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, LISTING_ID, TICKER, OUT, STORED, CONDITIONS } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
mkdirSync(OUT, { recursive: true })

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) })
const timings = {}
const agentName = `${TICKER} thesis ${new Date().toISOString().slice(0, 19)}`
let failure = null
const LLM_LOG = join(ROOT, '.dev/logs/dev-api.log')
const logSize = () => (existsSync(LLM_LOG) ? statSync(LLM_LOG).size : 0)
const llmCallsSince = (from) => (existsSync(LLM_LOG) ? (readFileSync(LLM_LOG).subarray(from).toString().match(/^\[llm\] /gm) ?? []).length : null)
const handedText = (block) => (Array.isArray(block.commentary)
  ? block.commentary.flatMap((part) => (part.kind === 'inference' ? [part.text] : part.kind === 'figures' ? part.segments.filter((segment) => segment.type === 'text').map((segment) => segment.text) : []))
  : block.analyst_commentary ? [] : (block.segments ?? []).filter((segment) => segment.type === 'text').map((segment) => segment.text))
// Words of 12 characters or more from a block's text segments, never its refs.
const wordsOf = (blocks) => (blocks ?? []).flatMap(handedText).map((text) => text.trim()).filter((text) => text.length >= 12)
const segmentText = (segments) => (segments ?? []).map((segment) => (segment.type === 'text' ? segment.text : segment.type === 'ref' ? segment.format || `[${segment.ref_kind}:${segment.ref_id.slice(0, 8)}]` : '')).join('')
// Whole paragraphs as the handoff writes them, so a phrase two sections share is no match but a merged leak is.
const paragraphsOf = (blocks) => (blocks ?? []).flatMap((block) => (Array.isArray(block.commentary)
  ? block.commentary.flatMap((part) => (part.kind === 'inference' ? [part.subject ? `${part.subject}: ${part.text}` : part.text] : part.kind === 'figures' ? [segmentText(part.segments)] : []))
  : block.analyst_commentary ? [] : [segmentText(block.segments)])).flatMap((text) => text.split(/\n\n+/)).map((text) => text.trim()).filter(Boolean)
const unverifiedOf = (blocks) => (blocks ?? []).flatMap((block) => (block.commentary ?? []).flatMap((part) => (part.kind === 'unverified' ? [part.text.trim()] : [])))

const readHistory = (page) => page.locator('[data-condition-id]').evaluateAll((conditions) => conditions.map((condition) => ({
  condition_id: condition.getAttribute('data-condition-id'),
  summary: condition.querySelector('summary')?.textContent ?? '',
  entries: [...condition.querySelectorAll('li[data-assessment-id]')].map((entry) => ({
    assessed_at: entry.querySelector('time')?.getAttribute('datetime') ?? '',
    badges: [...entry.querySelectorAll('span.rounded.border')].map((badge) => badge.textContent ?? ''),
    refs: [...entry.querySelectorAll('[data-inspection-kind], [data-inspect-result]')].map((ref) => ref.textContent ?? ''),
  })),
})))

async function runOnce(page, label) {
  const row = page.locator('li', { has: page.locator('h3', { hasText: agentName }) })
  const response = page.waitForResponse((res) => res.request().method() === 'POST' && /\/v1\/agents\/[^/]+\/runs$/.test(new URL(res.url()).pathname), { timeout: 150_000 })
  const started = Date.now()
  const logFrom = logSize()
  await row.getByRole('button', { name: 'Run', exact: true }).click()
  const run = await (await response).json()
  timings[`${label}_ms`] = Date.now() - started
  timings[`${label}_llm_calls`] = llmCallsSince(logFrom)
  check(`${label} completed`, run.status === 'completed', run.error ?? run.status)
  await page.waitForTimeout(1_000)
  const history = await readHistory(page)
  for (const summary of await page.locator('[data-condition-id] summary').all()) await summary.click()
  await page.screenshot({ path: join(OUT, `${label}.png`), fullPage: true })
  return history
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  try {
    await page.goto(`${WEB_URL}/symbol/listing:${LISTING_ID}/overview`)
    await page.locator('[data-testid=analyze-this-subject]').click({ timeout: 30_000 })
    await page.waitForURL(/\/analyze\?subject=/, { timeout: 30_000 })
    await page.locator('select:has(option[value="investment_memo"])').selectOption('investment_memo', { timeout: 30_000 })
    const memoResponse = STORED
      ? page.waitForResponse((res) => res.request().method() === 'GET' && /\/v1\/analyze\/runs\/[^/]+$/.test(new URL(res.url()).pathname), { timeout: 30_000 })
      : page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/v1/analyze/runs'), { timeout: 200_000 })
    const started = Date.now()
    if (STORED) await page.getByRole('button', { name: 'Open', exact: true }).first().click({ timeout: 30_000 })
    else await page.getByRole('button', { name: 'Generate memo' }).click({ timeout: 30_000 })
    const memo = await (await memoResponse).json()
    timings.memo_ms = Date.now() - started
    writeFileSync(join(OUT, 'memo.json'), JSON.stringify(memo, null, 2))
    await page.getByRole('button', { name: 'Monitor this thesis' }).click({ timeout: 30_000 })
    await page.waitForURL(/\/agents$/, { timeout: 30_000 })
    const handedOff = await page.locator('[name="agent-thesis"]').inputValue()
    await page.screenshot({ path: join(OUT, 'handoff.png'), fullPage: true })
    const section = memo.blocks?.find((block) => block.data_ref?.params?.playbook_section_id === 'investment_thesis')
    check('memo has an investment thesis section', section !== undefined)
    const own = wordsOf(section?.children)
    check('handoff carries every checked passage of the thesis section', own.length > 0 && own.every((words) => handedOff.includes(words)), own.filter((words) => !handedOff.includes(words)))
    const unverified = unverifiedOf(section?.children)
    check('handoff carries no unverified inference', unverified.every((words) => !handedOff.includes(words)), unverified.filter((words) => handedOff.includes(words)))
    const ownParagraphs = paragraphsOf(section?.children)
    const others = (memo.blocks ?? []).filter((block) => block.kind === 'section' && block !== section).flatMap((block) => paragraphsOf(block.children)).filter((text) => text.length >= 40 && !ownParagraphs.some((own) => own.includes(text)))
    check('handoff carries no other section', others.length > 0 && others.every((text) => !handedOff.includes(text)), others.filter((text) => handedOff.includes(text)))

    await page.locator('[name="agent-name"]').fill(agentName)
    await page.getByRole('button', { name: 'Create agent' }).click()
    await page.locator('h3', { hasText: agentName }).waitFor({ timeout: 30_000 })
    await page.locator('li', { has: page.locator('h3', { hasText: agentName }) }).getByRole('button', { name: 'View', exact: true }).click()
    if (CONDITIONS) {
      const conditions = JSON.parse(readFileSync(CONDITIONS, 'utf8'))
      for (let index = 0; index < conditions.length; index += 1) {
        await page.getByRole('button', { name: 'Add condition' }).click()
        for (const field of ['statement', 'falsifier', 'horizon']) await page.locator(`[name="thesis-condition-${index}-${field}"]`).fill(conditions[index][field])
      }
    } else {
      const drafted = page.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith('/thesis/draft'), { timeout: 120_000 })
      await page.getByRole('button', { name: 'Suggest conditions' }).click()
      const response = await drafted
      check('conditions drafted', response.ok(), `HTTP ${response.status()}`)
    }
    const drafted = await page.locator('textarea[name$="-statement"]').evaluateAll((fields) => fields.map((field) => field.value))
    check('every condition has a statement', drafted.length > 0 && drafted.every((text) => text.trim().length > 0), drafted)
    await page.screenshot({ path: join(OUT, 'drafted.png'), fullPage: true })
    const saved = page.waitForResponse((res) => res.request().method() === 'PUT' && res.url().endsWith('/thesis'), { timeout: 30_000 })
    await page.getByRole('button', { name: 'Save thesis' }).click()
    check('thesis saved', (await saved).ok())

    const first = await runOnce(page, 'assessed')
    const cites = (entry) => entry.refs.some((ref) => /^(Inspect \w+ evidence )?[FC] · /.test(ref)) || entry.badges.includes('Not enough evidence')
    check('every condition is assessed once with F or C refs or not enough evidence',
      first.length === drafted.length && first.every((condition) => condition.entries.length === 1 && cites(condition.entries[0])), first)
    const second = await runOnce(page, 'history')
    check('every condition shows two dated assessments, newest first',
      second.length === drafted.length && second.every((condition) => condition.entries.length === 2
        && Date.parse(condition.entries[0].assessed_at) > Date.parse(condition.entries[1].assessed_at) && condition.entries.every(cites)), second)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    const sideways = await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && (element === document.documentElement || ['auto', 'scroll'].includes(getComputedStyle(element).overflowX)))
      .map((element) => `${element.tagName}.${String(element.className).slice(0, 60)} ${element.scrollWidth}/${element.clientWidth}`))
    await page.locator('textarea[name$="-statement"]').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(OUT, 'narrow.png') })
    check('at 390 px nothing scrolls sideways, the thesis editor and open history included', sideways.length === 0, sideways)
  } catch (error) {
    failure = error.message
  }
  writeFileSync(join(OUT, 'page.txt'), await page.locator('body').innerText().catch(() => ''))
  await page.screenshot({ path: join(OUT, 'final.png'), fullPage: true })
} finally {
  await browser.close()
}

const passed = failure === null && checks.every((entry) => entry.ok)
const report = { ticker: TICKER, agent: agentName, stored_memo: Boolean(STORED), passed, failure, checks, timings, evidence: OUT }
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exit(passed ? 0 : 1)
