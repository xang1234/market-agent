// Asks each question in QUESTIONS (a JSON array) in one new chat thread, the way a
// user types them, waiting for the assistant message saved after each submission.
// Saves a screenshot per turn, the page text, and every saved message's blocks to
// OUT; the report names each turn's first block kind.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, DATABASE_URL, QUESTIONS, OUT } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
const { Client } = createRequire(join(ROOT, 'services/chat/package.json'))('pg')
const questions = JSON.parse(QUESTIONS)
mkdirSync(OUT, { recursive: true })

const db = new Client({ connectionString: DATABASE_URL })
await db.connect()
const browser = await chromium.launch()
const report = { thread_id: null, turns: [], failure: null, evidence: OUT }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await page.goto(`${WEB_URL}/chat`)
  for (const [index, question] of questions.entries()) {
    await page.locator('#chat-composer').fill(question, { timeout: 30_000 })
    // The database's clock, so a reply is matched to its turn whatever this machine's says.
    const { rows: [{ now: submitted }] } = await db.query('select now()')
    await page.locator('#chat-composer').press('Enter')
    if (report.thread_id === null) {
      await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 30_000 })
      report.thread_id = page.url().match(/\/chat\/([0-9a-f-]{36})/)[1]
    }
    const deadline = Date.now() + 240_000
    let reply
    while (reply === undefined && Date.now() < deadline) {
      await page.waitForTimeout(2_000)
      reply = (await db.query(
        `select blocks->0->>'kind' as kind from chat_messages where thread_id = $1 and role = 'assistant' and created_at > $2 order by created_at desc, message_id desc limit 1`,
        [report.thread_id, submitted],
      )).rows[0]
    }
    if (reply === undefined) throw new Error(`no assistant message was saved for "${question}" within 240s`)
    await page.waitForTimeout(3_000)
    const shot = join(OUT, `${index + 1}-turn.png`)
    await page.screenshot({ path: shot, fullPage: true })
    report.turns.push({ question, block_kind: reply.kind, screenshot: shot })
  }
  writeFileSync(join(OUT, 'page.txt'), await page.locator('body').innerText())
} catch (error) {
  report.failure = error.message
} finally {
  await browser.close()
}
if (report.thread_id !== null) {
  const { rows } = await db.query(
    `select message_id, role, snapshot_id, blocks, research_scope from chat_messages where thread_id = $1 order by created_at, message_id`,
    [report.thread_id],
  )
  writeFileSync(join(OUT, 'messages.json'), JSON.stringify(rows, null, 2))
}
await db.end()
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exit(report.failure === null ? 0 : 1)
