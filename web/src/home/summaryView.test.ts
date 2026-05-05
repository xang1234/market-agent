import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agentLastRunLabel,
  agentSummaryHeadline,
  formatChangePercent,
  formatPrice,
  quoteDirection,
  savedScreenSubtitle,
  watchlistMoversEmptyState,
} from './summaryView.ts'
import type { HomeAgentSummaryRow, HomeSavedScreenRow } from './summaryClient.ts'

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const SCREEN_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'

function agentRow(overrides: Partial<HomeAgentSummaryRow> = {}): HomeAgentSummaryRow {
  return {
    agent_id: AGENT_ID,
    name: 'Test agent',
    enabled: true,
    last_run: null,
    finding_counts: { total: 0, high_or_critical: 0, critical: 0 },
    latest_high_or_critical_finding: null,
    ...overrides,
  }
}

test('formatChangePercent matches the shared signed-percent formatter from symbol/quote', () => {
  assert.equal(formatChangePercent(0.0125), '+1.25%')
  assert.equal(formatChangePercent(-0.0125), '-1.25%')
  assert.equal(formatChangePercent(0), '0.00%')
  assert.equal(formatChangePercent(Number.NaN), '—')
})

test('formatPrice formats USD with cents and respects the supplied currency code', () => {
  assert.equal(formatPrice(510.5, 'USD'), '$510.50')
  assert.match(formatPrice(99.99, 'EUR'), /99/)
})

test('quoteDirection returns up/down/flat by sign of change_abs', () => {
  assert.equal(quoteDirection({ change_abs: 1 }), 'up')
  assert.equal(quoteDirection({ change_abs: -1 }), 'down')
  assert.equal(quoteDirection({ change_abs: 0 }), 'flat')
})

test('watchlistMoversEmptyState returns user-facing copy for the two empty cases and null for ok', () => {
  assert.match(watchlistMoversEmptyState('no_default_watchlist') ?? '', /watchlist/i)
  assert.match(watchlistMoversEmptyState('empty_watchlist') ?? '', /empty/i)
  assert.equal(watchlistMoversEmptyState('ok'), null)
})

test('agentSummaryHeadline prefers the latest high-or-critical headline', () => {
  const row = agentRow({
    finding_counts: { total: 3, high_or_critical: 1, critical: 1 },
    latest_high_or_critical_finding: {
      finding_id: '11111111-1111-4111-a111-111111111111',
      headline: 'Critical revenue miss',
      severity: 'critical',
      created_at: '2026-05-05T00:00:00.000Z',
    },
  })
  assert.equal(agentSummaryHeadline(row), 'Critical revenue miss')
})

test('agentSummaryHeadline falls back to a count when no high-or-critical exists', () => {
  const row = agentRow({ finding_counts: { total: 2, high_or_critical: 0, critical: 0 } })
  assert.equal(agentSummaryHeadline(row), '2 findings in window.')
})

test('agentSummaryHeadline reports No runs yet when there is no run and no findings', () => {
  assert.equal(agentSummaryHeadline(agentRow()), 'No runs yet.')
})

test('agentLastRunLabel reports Never run, Running now, or completed/failed timestamps', () => {
  assert.equal(agentLastRunLabel(agentRow()), 'Never run')
  assert.equal(
    agentLastRunLabel(
      agentRow({
        last_run: {
          agent_run_log_id: '11111111-1111-4111-a111-111111111111',
          status: 'running',
          started_at: '2026-05-05T11:00:00.000Z',
          ended_at: null,
          duration_ms: null,
          error: null,
        },
      }),
    ),
    'Running now',
  )
  assert.match(
    agentLastRunLabel(
      agentRow({
        last_run: {
          agent_run_log_id: '11111111-1111-4111-a111-111111111111',
          status: 'completed',
          started_at: '2026-05-05T11:00:00.000Z',
          ended_at: '2026-05-05T11:05:00.000Z',
          duration_ms: 1,
          error: null,
        },
      }),
    ),
    /Completed · 2026-05-05T11:05/,
  )
})

test('savedScreenSubtitle joins filter summary and updated timestamp', () => {
  const row: HomeSavedScreenRow = {
    screen_id: SCREEN_ID,
    name: 'Test',
    filter_summary: '3 filters · universe, market',
    updated_at: '2026-05-05T00:00:00.000Z',
    replay_target: { kind: 'screen', id: SCREEN_ID },
  }
  assert.equal(savedScreenSubtitle(row), '3 filters · universe, market · updated 2026-05-05T00:00:00.000Z')
})
