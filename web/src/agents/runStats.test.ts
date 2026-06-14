import assert from 'node:assert/strict'
import test from 'node:test'

import { agentRunTicks, latestRunStatus, rosterRunSummary, type RunStatus } from './runStats.ts'

function run(agent_id: string, status: RunStatus, started_at: string) {
  return { agent_id, status, started_at }
}

test('agentRunTicks returns one agent runs oldest→newest, capped to limit', () => {
  const runs = [
    run('a', 'completed', '2026-05-01T00:00:00Z'),
    run('b', 'failed', '2026-05-01T00:00:00Z'),
    run('a', 'failed', '2026-05-03T00:00:00Z'),
    run('a', 'completed', '2026-05-02T00:00:00Z'),
  ]
  assert.deepEqual(agentRunTicks(runs, 'a'), ['completed', 'completed', 'failed'])
  assert.deepEqual(agentRunTicks(runs, 'a', 2), ['completed', 'failed']) // last 2
  assert.deepEqual(agentRunTicks(runs, 'missing'), [])
})

test('latestRunStatus picks the newest run by started_at, null when none', () => {
  const runs = [
    run('a', 'completed', '2026-05-01T00:00:00Z'),
    run('a', 'running', '2026-05-04T00:00:00Z'),
    run('a', 'failed', '2026-05-02T00:00:00Z'),
  ]
  assert.equal(latestRunStatus(runs, 'a'), 'running')
  assert.equal(latestRunStatus(runs, 'b'), null)
})

test('rosterRunSummary tallies monitors, enabled, running, failing by latest run', () => {
  const agents = [
    { agent_id: 'a', enabled: true },
    { agent_id: 'b', enabled: true },
    { agent_id: 'c', enabled: false },
  ]
  const runs = [
    run('a', 'completed', '2026-05-01T00:00:00Z'),
    run('a', 'running', '2026-05-05T00:00:00Z'), // a's latest = running
    run('b', 'failed', '2026-05-04T00:00:00Z'), // b's latest = failed
    // c has never run
  ]
  assert.deepEqual(rosterRunSummary(agents, runs), { total: 3, enabled: 2, running: 1, failing: 1 })
})
