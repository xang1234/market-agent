// Measures how the chat thread THREAD_ID scrolls in a real browser at CPU_THROTTLE x
// slowdown: a reader wheeling from the newest message to the top, then a question
// sent at the end, read mid-stream, and followed again. Writes report.json and
// frame captures to OUT and prints the summary.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { ROOT, WEB_URL, OUT, THREAD_ID, ASK = 'Summarise AAPL in two sentences', CPU_THROTTLE = '4', REDUCED_MOTION = '', MESSAGES_FILE = '', HISTORY_HEIGHT = '800' } = process.env
const { chromium } = createRequire(join(ROOT, 'web/package.json'))('@playwright/test')
const LIST = '[data-testid="virtualized-message-list"]'

// Runs in the page before app code. Each frame it records where the view is and
// how far the first visible message moved on screen beyond what the reader's
// wheel moved it: a reader sees that remainder as content jumping. The wheel, not
// scrollTop, is the reference, since the list moves scrollTop itself to hold
// content still.
function installFrameRecorder() {
  const rec = (window.__scroll = { frames: [], longTasks: [], shifts: [], on: false })
  new PerformanceObserver((list) => {
    if (rec.on) for (const e of list.getEntries()) rec.longTasks.push(e.duration)
  }).observe({ type: 'longtask', buffered: false })
  new PerformanceObserver((list) => {
    if (rec.on) for (const e of list.getEntries()) if (!e.hadRecentInput) rec.shifts.push(e.value)
  }).observe({ type: 'layout-shift', buffered: false })
  let wheel = 0
  addEventListener('wheel', (e) => { wheel += e.deltaY }, { capture: true, passive: true })
  let prev = null
  const tick = (now) => {
    const el = document.querySelector('[data-testid="virtualized-message-list"]')
    if (rec.on && el !== null) {
      const viewTop = el.getBoundingClientRect().top
      const tops = new Map()
      for (const m of el.querySelectorAll('[data-message-id]')) {
        const r = m.getBoundingClientRect()
        tops.set(m.dataset.messageId, { top: r.top - viewTop, bottom: r.bottom - viewTop })
      }
      const frame = { t: now, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, jump: 0 }
      // A wheel notch lands in the frame its scroll does, sometimes the one after
      // it arrived, and stops at the edges.
      const landed = prev !== null && el.scrollTop !== prev.scrollTop
      const scrolled = landed ? Math.min(Math.max(wheel, -prev.scrollTop), prev.scrollHeight - prev.clientHeight - prev.scrollTop) : 0
      frame.wheel = scrolled
      if (landed || prev === null) wheel = 0
      if (prev !== null) {
        // The visible message nearest the top that was on screen last frame too.
        for (const [id, box] of tops) {
          const was = prev.tops.get(id)
          if (was === undefined || box.bottom <= 0 || box.top >= el.clientHeight) continue
          frame.jump = box.top - was.top + scrolled
          break
        }
      }
      rec.frames.push(frame)
      prev = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, tops }
    } else {
      prev = null
      wheel = 0
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const startRecording = (page) => page.evaluate(() => Object.assign(window.__scroll, { frames: [], longTasks: [], shifts: [], on: true }))
const stopRecording = (page) => page.evaluate(() => { window.__scroll.on = false; return window.__scroll })
const frames = (page, n) => page.evaluate((count) => new Promise((done) => {
  let left = count
  const step = () => (--left <= 0 ? done() : requestAnimationFrame(step))
  requestAnimationFrame(step)
}), n)
const pct = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10
}

function summarizeFrames(rec) {
  const gaps = rec.frames.slice(1).map((f, i) => f.t - rec.frames[i].t)
  const jumps = rec.frames.map((f) => Math.abs(f.jump))
  return {
    frames: rec.frames.length,
    frame_ms_p50: pct(gaps, 50),
    frame_ms_p95: pct(gaps, 95),
    frames_over_50ms: gaps.filter((g) => g > 50).length,
    long_tasks: rec.longTasks.length,
    long_task_ms_total: Math.round(rec.longTasks.reduce((a, b) => a + b, 0)),
    cls: Number(rec.shifts.reduce((a, b) => a + b, 0).toFixed(4)),
    content_jumps_over_2px: jumps.filter((j) => j > 2).length,
    content_jump_px_max: Math.round(Math.max(0, ...jumps)),
    content_jump_px_total: Math.round(jumps.reduce((a, b) => a + b, 0)),
  }
}

async function wheelHistory(page) {
  await startRecording(page)
  const box = await page.locator(LIST).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  let steps = 0
  // A reader's wheel: 100px notches, about one per frame, until the top.
  for (; steps < 600; steps++) {
    await page.mouse.wheel(0, -100)
    await frames(page, 1)
    if (steps % 10 === 9 && (await page.locator(LIST).evaluate((el) => el.scrollTop)) <= 0) break
  }
  await frames(page, 30)
  const rec = await stopRecording(page)
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify(rec.frames))
  return { wheel_notches: steps + 1, scroll_height: rec.frames.at(-1)?.scrollHeight ?? null, ...summarizeFrames(rec) }
}

async function streamFollow(page, dir) {
  const list = page.locator(LIST)
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await frames(page, 30)
  await page.locator('#chat-composer').fill(ASK)
  await startRecording(page)
  await page.locator('#chat-composer').press('Enter')
  // Sent when the composer clears. Then read back up while the answer streams in.
  await page.waitForFunction(() => document.querySelector('#chat-composer').value === '', null, { timeout: 30_000 })
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: join(dir, 'stream-before-read.png') })
  const box = await list.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -100); await frames(page, 1) }
  await frames(page, 5)
  const readAt = await list.evaluate((el) => el.scrollTop)
  await page.waitForTimeout(3_000)
  const afterRead = await list.evaluate((el) => el.scrollTop)
  await page.screenshot({ path: join(dir, 'stream-reading.png') })
  // Scroll back to the end by hand: new content stays in view from here.
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 400); await frames(page, 1) }
  await page.waitForTimeout(4_000)
  const end = await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
  await page.screenshot({ path: join(dir, 'stream-followed.png') })
  const rec = await stopRecording(page)
  // Following the end: each frame's distance from the bottom while it grew.
  const following = rec.frames.filter((f) => f.t > rec.frames.at(-1).t - 4_000)
  const gaps = following.map((f) => f.scrollHeight - f.scrollTop - f.clientHeight)
  return {
    moved_while_reading_px: Math.round(afterRead - readAt),
    distance_from_end_after_follow_px: Math.round(end),
    follow_gap_px_max: Math.round(Math.max(0, ...gaps)),
    follow_scroll_step_px_max: Math.round(Math.max(0, ...following.slice(1).map((f, i) => Math.abs(f.scrollTop - following[i].scrollTop)))),
    ...summarizeFrames(rec),
  }
}

// Opens the thread at each viewport height and counts the ones whose list fails
// to settle: React gives up with "Maximum update depth exceeded".
async function openAt(browser, height) {
  const context = await browser.newContext({ viewport: { width: 1440, height }, reducedMotion: REDUCED_MOTION === '1' ? 'reduce' : 'no-preference' })
  await context.addInitScript(installFrameRecorder)
  if (MESSAGES_FILE) {
    // The thread from a saved messages.json, for when the stack's database is down.
    const messages = JSON.parse(readFileSync(MESSAGES_FILE, 'utf8'))
    await context.route('**/v1/chat/threads', (route) => route.fulfill({ json: { threads: [] } }))
    await context.route('**/v1/chat/threads/*/messages', (route) => route.fulfill({ json: { messages } }))
  }
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`${WEB_URL}/chat/${THREAD_ID}`)
  await page.locator(`${LIST} [data-message-id]`).first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => null)
  await page.waitForTimeout(3_000)
  const rendered = await page.locator(`${LIST} [data-message-id]`).count()
  const looped = errors.some((e) => e.includes('Maximum update depth'))
  return { context, page, height, rendered, looped }
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const report = { thread_id: THREAD_ID, cpu_throttle: Number(CPU_THROTTLE), reduced_motion: REDUCED_MOTION === '1', mocked: Boolean(MESSAGES_FILE), open: [] }
for (const height of [700, 800, 900, 1000, 1100, 1200, 1300]) {
  const opened = await openAt(browser, height)
  report.open.push({ height, rendered: opened.rendered, looped: opened.looped })
  await opened.page.screenshot({ path: join(OUT, `open-${height}.png`) })
  await opened.context.close()
}
const { context, page, rendered } = await openAt(browser, Number(HISTORY_HEIGHT))
if (rendered > 0) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(CPU_THROTTLE) })
  report.history = await wheelHistory(page)
  await page.screenshot({ path: join(OUT, 'history-top.png') })
  if (!MESSAGES_FILE) report.stream = await streamFollow(page, OUT)
}
await browser.close()
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
