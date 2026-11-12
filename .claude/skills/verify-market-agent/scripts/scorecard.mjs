// Drives each case in CASES_FILE (only the ids in ONLY, when set) RUNS times through
// the chat UI, each run in a new thread, and checks every turn's expectations and the
// case's budgets. Writes report.json, summary.md, screenshots, and each run's page.txt
// and messages.json to OUT. Exits 1 on any failure, 2 on a bad case file.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, DATABASE_URL, OUT, CASES_FILE, ONLY = '', RUNS = '1', TRACE_DIR, CHAT_LOG, COMMIT = '' } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
const { Client } = createRequire(join(ROOT, 'services/chat/package.json'))('pg')

const TURN_TIMEOUT_MS = 240_000
const TRACE_WAIT_MS = 3_000

const expectations = {
  subjects: (turn, wanted) =>
    turn.subjects === null ? `no stored scope, wanted subjects ${wanted.join(', ')}` : missing(wanted, (label) => turn.subjects.includes(label), turn.subjects, 'subjects'),
  not_subjects: (turn, unwanted) => present(unwanted, (label) => (turn.subjects ?? []).includes(label), 'subjects'),
  text: (turn, wanted) =>
    turn.reply === null ? 'the reply never rendered' : missing(wanted, (text) => turn.reply.includes(text), turn.reply, 'the reply'),
  not_text: (turn, unwanted) => present(unwanted, (text) => (turn.reply ?? '').includes(text), 'the reply'),
  tools: (turn, wanted) => {
    if (turn.tools === null) {
      return existsSync(TRACE_DIR) ? 'no trace for this turn: only an analyst answer writes one' : 'no trace: run the stack in DEV_MODE=analyst'
    }
    const names = turn.tools.map((tool) => tool.name)
    return missing(wanted, (name) => names.includes(name), names, 'tools called')
  },
}
const budgets = { first_text: 'first_text_ms', saved: 'saved_ms' }
const nullOnTimeout = (error) => {
  if (error.name === 'TimeoutError') return null
  throw error
}

function missing(wanted, holds, got, what) {
  const absent = wanted.filter((item) => !holds(item))
  return absent.length === 0 ? null : `${what} missing ${absent.map((a) => JSON.stringify(a)).join(', ')}, got ${JSON.stringify(got)}`
}

function present(unwanted, holds, what) {
  const found = unwanted.filter(holds)
  return found.length === 0 ? null : `${what} unexpectedly has ${found.map((f) => JSON.stringify(f)).join(', ')}`
}

function loadCases() {
  const all = JSON.parse(readFileSync(CASES_FILE, 'utf8'))
  const wanted = ONLY === '' ? all.map((c) => c.id) : ONLY.split(',')
  const unknownIds = wanted.filter((id) => !all.some((c) => c.id === id))
  const badKeys = all.flatMap((c) => [
    ...c.turns.flatMap((t) => Object.keys(t.expect ?? {}).filter((key) => !(key in expectations)).map((key) => `${c.id}: expect.${key}`)),
    ...Object.keys(c.budget_ms ?? {}).filter((key) => !(key in budgets)).map((key) => `${c.id}: budget_ms.${key}`),
  ])
  if (unknownIds.length > 0 || badKeys.length > 0) {
    console.error(`bad case file ${CASES_FILE}: ${[...unknownIds.map((id) => `no case ${id}`), ...badKeys].join('; ')}`)
    process.exit(2)
  }
  return all.filter((c) => wanted.includes(c.id))
}

// Runs in the page before any app code, so every long task and layout shift is counted.
function installLagObservers() {
  const lag = (window.__scorecardLag = { long_tasks: 0, longest_task_ms: 0, layout_shift: 0 })
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      lag.long_tasks += 1
      lag.longest_task_ms = Math.max(lag.longest_task_ms, entry.duration)
    }
  }).observe({ type: 'longtask', buffered: true })
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) lag.layout_shift += entry.value
  }).observe({ type: 'layout-shift', buffered: true })
}

const takeLag = (page) =>
  page.evaluate(() => {
    const lag = window.__scorecardLag
    const taken = { long_tasks: lag.long_tasks, longest_task_ms: Math.round(lag.longest_task_ms), layout_shift: Number(lag.layout_shift.toFixed(4)) }
    Object.assign(lag, { long_tasks: 0, longest_task_ms: 0, layout_shift: 0 })
    return taken
  })

// Rendered answer blocks in the streaming turn: streamed rich text, or a sealed answer's
// blocks. A pending block's skeleton is in neither, so its "Loading … block" label never counts.
// Or a new saved assistant message with text.
function answerTextShown(knownIds) {
  const blocks = document.querySelectorAll(
    '[data-testid="streaming-turn"] [data-testid^="streaming-block-"], [data-testid="streaming-turn"] [data-testid^="block-shell-"]',
  )
  if ([...blocks].some((block) => block.innerText.trim() !== '')) return true
  return [...document.querySelectorAll('[data-role="assistant"]')].some(
    (message) => !knownIds.includes(message.dataset.messageId) && message.innerText.trim() !== '',
  )
}

function replyRendered(knownIds) {
  return (
    !document.querySelector('[data-testid="pending-turn"], [data-testid="streaming-turn"]') &&
    [...document.querySelectorAll('[data-role="assistant"]')].some((message) => !knownIds.includes(message.dataset.messageId))
  )
}

const logSize = () => (CHAT_LOG && existsSync(CHAT_LOG) ? statSync(CHAT_LOG).size : null)

// ponytail: chat.log lines carry no run id, so a turn owns the lines written between its
// submit and its render. Turns here run one at a time; another user of the same stack, or
// a model call that finishes after the reply renders, is counted against the wrong turn.
function llmUsage(fromOffset) {
  if (fromOffset === null || !existsSync(CHAT_LOG)) return null
  const text = readFileSync(CHAT_LOG).subarray(fromOffset).toString('utf8')
  const calls = [...text.matchAll(/\[llm\] \S+ (\d+)ms (failed|tokens (?:in=(\d+) out=(\d+)|n\/a))/g)]
  if (calls.length === 0) return null
  const sum = (index) => calls.reduce((total, call) => total + Number(call[index] ?? 0), 0)
  return { calls: calls.length, failed: calls.filter((call) => call[2] === 'failed').length, latency_ms: sum(1), tokens_in: sum(3), tokens_out: sum(4) }
}

async function readTrace(threadId, userMessageId) {
  const dir = join(TRACE_DIR, threadId)
  const deadline = Date.now() + TRACE_WAIT_MS
  do {
    const name = existsSync(dir) ? readdirSync(dir).find((file) => file.endsWith(`.${userMessageId}.json`)) : undefined
    if (name !== undefined) return JSON.parse(readFileSync(join(dir, name), 'utf8'))
    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < deadline)
  return null
}

function judgeOf(trace) {
  if (trace?.assertions == null) return null
  const { accepted, rejected } = trace.assertions
  return { accepted: accepted.length, rejected: rejected.length, judge_hidden: rejected.filter((r) => r.check === 'judge').length }
}

async function savedReply(db, page, threadId, submitted, started) {
  const deadline = started + TURN_TIMEOUT_MS
  while (Date.now() < deadline) {
    const { rows } = await db.query(
      `select message_id, blocks, research_scope from chat_messages
        where thread_id = $1 and role = 'assistant' and created_at > $2 order by created_at desc, message_id desc limit 1`,
      [threadId(), submitted],
    )
    if (rows.length > 0) return { row: rows[0], ms: Date.now() - started }
    await page.waitForTimeout(250)
  }
  return null
}

async function runTurn({ db, page, kase, index, thread, knownIds, consoleErrors, dir }) {
  const { ask, expect = {} } = kase.turns[index]
  await page.locator('#chat-composer').fill(ask, { timeout: 30_000 })
  await takeLag(page)
  consoleErrors.length = 0
  // The database's clock, so a reply is matched to its turn whatever this machine's says.
  const { rows: [{ now: submitted }] } = await db.query('select now()')
  const offset = logSize()
  const started = Date.now()
  await page.locator('#chat-composer').press('Enter')
  if (thread.id === null) {
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 30_000 })
    thread.id = page.url().match(/\/chat\/([0-9a-f-]{36})/)[1]
  }
  const elapsed = () => Date.now() - started
  const waitInPage = (fn) => page.waitForFunction(fn, knownIds, { polling: 100, timeout: TURN_TIMEOUT_MS }).then(elapsed, nullOnTimeout)
  const [firstText, saved, rendered] = await Promise.all([
    waitInPage(answerTextShown),
    savedReply(db, page, () => thread.id, submitted, started),
    waitInPage(replyRendered),
  ])

  const turn = { question: ask, user_message_id: null, assistant_message_id: null, block_kinds: [], subjects: null, tools: null, judge: null, reply: null }
  turn.timings = { first_text_ms: firstText, saved_ms: saved?.ms ?? null, rendered_ms: rendered }
  if (saved !== null) {
    const { row } = saved
    knownIds.push(row.message_id)
    turn.assistant_message_id = row.message_id
    turn.block_kinds = (row.blocks ?? []).map((block) => block.kind)
    turn.subjects = row.research_scope?.companies?.map((company) => company.label) ?? null
    const { rows: [user] } = await db.query(
      `select message_id from chat_messages where thread_id = $1 and role = 'user' and created_at > $2 order by created_at, message_id limit 1`,
      [thread.id, submitted],
    )
    turn.user_message_id = user?.message_id ?? null
    const trace = user ? await readTrace(thread.id, user.message_id) : null
    turn.tools = trace?.input.toolCalls.map((call) => ({ name: call.tool_name, status: call.status })) ?? null
    turn.judge = judgeOf(trace)
    turn.reply = await page.locator(`[data-message-id="${row.message_id}"]`).innerText({ timeout: 10_000 }).catch(nullOnTimeout)
  }
  turn.lag = { ...(await takeLag(page)), console_errors: [...consoleErrors] }
  turn.llm = llmUsage(offset)
  turn.screenshot = join(dir, `turn-${index + 1}.png`)
  await page.screenshot({ path: turn.screenshot, fullPage: true })

  turn.failures = [
    ...(saved === null ? [`no assistant message was saved within ${TURN_TIMEOUT_MS / 1000}s`] : []),
    ...Object.entries(expect).map(([key, wanted]) => expectations[key](turn, wanted)),
    ...Object.entries(kase.budget_ms ?? {}).map(([key, budget]) => {
      const took = turn.timings[budgets[key]]
      return took === null ? `${key} never happened (budget ${budget}ms)` : took > budget ? `${key} took ${took}ms, over its ${budget}ms budget` : null
    }),
  ].filter((failure) => failure !== null)
  return turn
}

async function runCase(db, browser, kase, run) {
  const dir = join(OUT, kase.id, `run-${run}`)
  mkdirSync(dir, { recursive: true })
  const result = { run, thread_id: null, error: null, turns: [] }
  const thread = { id: null }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  await context.addInitScript(installLagObservers)
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()))
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  try {
    await page.goto(`${WEB_URL}/chat`)
    const knownIds = []
    for (const index of kase.turns.keys()) {
      const turn = await runTurn({ db, page, kase, index, thread, knownIds, consoleErrors, dir })
      result.turns.push(turn)
      if (turn.timings.saved_ms === null) break
    }
    writeFileSync(join(dir, 'page.txt'), await page.locator('body').innerText())
  } catch (error) {
    result.error = error.message
  } finally {
    await context.close()
  }
  result.thread_id = thread.id
  if (thread.id !== null) {
    const { rows } = await db.query(
      `select message_id, role, snapshot_id, blocks, research_scope from chat_messages where thread_id = $1 order by created_at, message_id`,
      [thread.id],
    )
    writeFileSync(join(dir, 'messages.json'), JSON.stringify(rows, null, 2))
  }
  return result
}

const runFailures = (run) => [
  ...(run.error === null ? [] : [`run ${run.run}: ${run.error}`]),
  ...run.turns.flatMap((turn, index) => turn.failures.map((failure) => `run ${run.run} turn ${index + 1}: ${failure}`)),
]
const failuresOf = (kase) => kase.runs.flatMap(runFailures)

function median(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function summarize(report) {
  const show = (value) => (value === null ? '-' : String(value))
  const rows = report.cases.map((kase) => {
    const turns = kase.runs.flatMap((run) => run.turns)
    const timing = (key) => show(median(turns.map((turn) => turn.timings[key])))
    const perRun = (key) =>
      median(kase.runs.map((run) => {
        const used = run.turns.map((turn) => turn.llm).filter((llm) => llm !== null)
        return used.length === 0 ? null : used.reduce((total, llm) => total + llm[key], 0)
      }))
    const passedRuns = kase.runs.filter((run) => runFailures(run).length === 0).length
    return `| ${kase.id} | ${kase.passed ? 'pass' : 'FAIL'} | ${passedRuns}/${kase.runs.length} | ${timing('first_text_ms')} | ${timing('saved_ms')} | ${timing('rendered_ms')} | ${show(perRun('calls'))} | ${show(perRun('tokens_in'))}/${show(perRun('tokens_out'))} |`
  })
  const failures = report.cases.flatMap((kase) => failuresOf(kase).map((failure) => `- ${kase.id} ${failure}`))
  return [
    `# Chat scorecard ${report.commit}`,
    '',
    `${report.cases.filter((kase) => kase.passed).length}/${report.cases.length} cases passed, ${report.runs} run(s) each. Timings are medians per turn in ms; llm is the median per run.`,
    '',
    '| case | result | runs passed | first text | saved | rendered | llm calls | tokens in/out |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...(failures.length === 0 ? ['No failures.'] : ['## Failures', '', ...failures]),
    '',
    `Evidence: ${report.evidence}`,
    '',
  ].join('\n')
}

const cases = loadCases()
const runs = Number(RUNS)
mkdirSync(OUT, { recursive: true })
const db = new Client({ connectionString: DATABASE_URL })
await db.connect()
const browser = await chromium.launch()
const report = { commit: COMMIT, web_url: WEB_URL, runs, evidence: OUT, cases: [] }
try {
  for (const kase of cases) {
    const result = { id: kase.id, note: kase.note ?? null, passed: false, runs: [] }
    for (let run = 1; run <= runs; run += 1) result.runs.push(await runCase(db, browser, kase, run))
    result.passed = failuresOf(result).length === 0
    report.cases.push(result)
    console.error(`${result.passed ? 'pass' : 'FAIL'}  ${kase.id}`)
  }
} finally {
  await browser.close()
  await db.end()
}
report.passed = report.cases.every((kase) => kase.passed)
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
const summary = summarize(report)
writeFileSync(join(OUT, 'summary.md'), summary)
console.log(summary)
process.exit(report.passed ? 0 : 1)
