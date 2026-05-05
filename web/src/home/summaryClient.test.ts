import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchHomeSummary, type HomeSummary } from './summaryClient.ts'

const USER_ID = '00000000-0000-4000-8000-000000000001'

const EMPTY_SUMMARY: HomeSummary = {
  generated_at: '2026-05-05T12:00:00.000Z',
  findings: { cards: [] },
  market_pulse: { rows: [], omitted: [] },
  watchlist_movers: { reason: 'no_default_watchlist', rows: [], omitted: [] },
  agent_summaries: { window_hours: 24, rows: [] },
  saved_screens: { rows: [] },
}

function fixedResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('fetchHomeSummary threads x-user-id and parses the envelope', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input, init })
    return fixedResponse(EMPTY_SUMMARY)
  }

  const summary = await fetchHomeSummary({ userId: USER_ID, fetchImpl })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].input, '/v1/home/summary')
  assert.equal((requests[0].init?.headers as Record<string, string>)['x-user-id'], USER_ID)
  assert.equal(summary.generated_at, EMPTY_SUMMARY.generated_at)
  assert.equal(summary.watchlist_movers.reason, 'no_default_watchlist')
})

test('fetchHomeSummary throws on non-ok response', async () => {
  const fetchImpl: typeof fetch = async () => fixedResponse({ error: 'boom' }, { status: 500 })
  await assert.rejects(fetchHomeSummary({ userId: USER_ID, fetchImpl }), /HTTP 500/)
})
