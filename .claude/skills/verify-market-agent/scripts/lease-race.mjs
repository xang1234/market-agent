// Two workers meet on one agent after the first stalls (#661): an agent run is held
// after analyze, its lease is aged past expiry, a run-now takes the agent over and
// finishes, and then the held run is released. Exits 1 unless the held run commits
// nothing: the agent's watermark and effects are the newer run's, and the held run
// ends as the takeover left it. MODE=run-now holds a run-now, MODE=scheduled holds the
// scheduler's run. THESIS=1 uses a thesis agent with one narrative condition and no
// stored claims, so the run takes the real thesis path without a model call.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const { ROOT, API_URL, DATABASE_URL, OUT, MODE, THESIS } = process.env
const { Pool } = createRequire(join(ROOT, 'services/dev-api/package.json'))('pg')
const HOLD_DIR = join(ROOT, '.dev/lease-hold')
const DEV_API_LOG = join(ROOT, '.dev/logs/dev-api.log')
const USER_ID = '6c000000-0000-4000-8000-000000000661'
const ISSUER_ID = '6c000000-0000-4000-8000-0000000006a1'
const db = new Pool({ connectionString: DATABASE_URL })
mkdirSync(OUT, { recursive: true })
rmSync(HOLD_DIR, { recursive: true, force: true })
mkdirSync(HOLD_DIR, { recursive: true })

const api = async (method, path, body) => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-user-id': USER_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}
const until = async (what, probe, ms = 90_000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(100)) {
    const value = await probe()
    if (value) return value
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`)
}
const rows = async (sql, values) => (await db.query(sql, values)).rows

try {
  await db.query(`insert into users (user_id, email) values ($1, 'lease-race@example.test') on conflict do nothing`, [USER_ID])
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Lease Race Fixture Inc.') on conflict do nothing`, [ISSUER_ID])
  const created = await api('POST', '/v1/agents', {
    name: `lease race ${MODE}${THESIS ? ' thesis' : ''} ${new Date().toISOString().slice(0, 19)}`,
    thesis: 'Demand holds this year.',
    cadence: 'hourly',
    universe: { mode: 'static', subject_refs: [{ kind: 'issuer', id: ISSUER_ID }] },
  })
  const agentId = created.body?.agent_id
  if (created.status !== 201 || !agentId) throw new Error(`creating the agent answered ${created.status}: ${JSON.stringify(created.body)}`)
  if (THESIS) {
    const saved = await api('PUT', `/v1/agents/${agentId}/thesis`, {
      expected_version: 0,
      thesis: 'Demand holds this year.',
      conditions: [{ condition_id: randomUUID(), statement: 'Demand holds this year.', falsifier: 'Customers cancel their orders.', horizon: 'This year' }],
    })
    if (saved.status !== 200) throw new Error(`saving the thesis answered ${saved.status}: ${JSON.stringify(saved.body)}`)
  }

  writeFileSync(join(HOLD_DIR, 'hold'), agentId)
  const heldRequest = MODE === 'run-now' ? api('POST', `/v1/agents/${agentId}/runs`) : null
  if (MODE === 'scheduled') {
    await db.query(
      `insert into agent_run_logs (agent_id, started_at, ended_at, status, outputs_summary)
       values ($1::uuid, now() - interval '2 hours', now() - interval '2 hours', 'completed', '{}'::jsonb)`,
      [agentId],
    )
  }
  const held = await until('a run to take the hold', () => readdirSync(HOLD_DIR).find((name) => name.startsWith('held-'))?.slice('held-'.length))
  await db.query(`update agent_run_logs set claim_expires_at = now() - interval '1 second' where agent_run_log_id = $1::uuid`, [held])
  const newer = await api('POST', `/v1/agents/${agentId}/runs`)
  writeFileSync(join(HOLD_DIR, 'release'), '')
  const heldOutcome = MODE === 'run-now'
    ? await heldRequest
    : await until('the scheduler to log the held run', () =>
        existsSync(DEV_API_LOG) && readFileSync(DEV_API_LOG, 'utf8').split('\n').find((line) => new RegExp(`run ${held} (completed|failed|superseded|duplicate|skipped|errored)`).test(line)))

  const newerId = newer.body?.agent_run_log_id
  const runs = await rows(
    `select agent_run_log_id::text as id, status, error, outputs_summary->>'trigger' as trigger
       from agent_run_logs where agent_run_log_id = any($1::uuid[]) order by started_at`,
    [[held, newerId].filter(Boolean)],
  )
  const [{ watermarks }] = await rows(`select watermarks from agents where agent_id = $1::uuid`, [agentId])
  const activities = (await rows(`select stage, summary from run_activities where agent_id = $1 order by ts, summary`, [agentId]))
  const assessments = THESIS
    ? (await rows(
        `select a.run_id::text as run_id, a.results->0->>'status' as status
           from agent_thesis_assessments a join agent_thesis_versions v using (thesis_version_id)
          where v.agent_id = $1::uuid order by a.assessed_at`,
        [agentId],
      )).map((row) => row.run_id)
    : null
  const watermarkRun = THESIS ? watermarks?.thesis_monitor?.input_hash?.split('/')[1] : watermarks?.local_agent_evidence?.last_manual_run_id
  const heldRow = runs.find((run) => run.id === held)

  const checks = [
    { name: 'newer run completed', ok: newer.status === 201 && newer.body?.status === 'completed', detail: newer },
    { name: 'held run ended by the takeover', ok: heldRow?.status === 'failed' && heldRow?.error === 'agent run claim expired', detail: heldRow },
    MODE === 'run-now'
      ? { name: 'held run-now returns its superseded run', ok: heldOutcome.status === 201 && heldOutcome.body?.agent_run_log_id === held && heldOutcome.body?.error === 'agent run claim expired', detail: heldOutcome }
      : { name: 'scheduler logs the held run superseded', ok: heldOutcome.endsWith(`run ${held} superseded`), detail: heldOutcome },
    { name: "watermark is the newer run's", ok: watermarkRun === newerId, detail: watermarks },
    THESIS
      ? { name: "only the newer run's assessment is recorded", ok: JSON.stringify(assessments) === JSON.stringify([newerId]), detail: assessments }
      : { name: "only the newer run's activity is recorded", ok: activities.length === 2, detail: activities },
  ]
  const report = { mode: MODE, thesis: Boolean(THESIS), agent_id: agentId, held_run: held, newer_run: newerId, checks, runs, watermarks, activities, assessments }
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  for (const check of checks) console.log(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.name}`)
  console.log(`report: ${join(OUT, 'report.json')}`)
  process.exitCode = checks.every((check) => check.ok) ? 0 : 1
} finally {
  writeFileSync(join(HOLD_DIR, 'release'), '')
  await db.end()
}
