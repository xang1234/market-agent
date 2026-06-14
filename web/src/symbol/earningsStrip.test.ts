import assert from 'node:assert/strict'
import test from 'node:test'

import type { EarningsEvent } from './earnings.ts'
import { beatMissSummary } from './earningsStrip.ts'

function ev(fy: number, q: string, pct: number | null, dir: EarningsEvent['surprise_direction']): EarningsEvent {
  return {
    release_date: `${fy}-01-01`,
    period_end: `${fy}-01-01`,
    fiscal_year: fy,
    fiscal_period: q,
    eps_actual: 1,
    eps_estimate_at_release: 1,
    surprise_pct: pct,
    surprise_direction: dir,
    source_id: 's',
    as_of: '2026-01-01',
  }
}

test('beatMissSummary takes the most recent N in chronological order regardless of input order', () => {
  const summary = beatMissSummary(
    [
      ev(2026, 'Q1', -3.6, 'miss'),
      ev(2026, 'Q3', 16.8, 'beat'),
      ev(2025, 'Q4', 18.7, 'beat'),
      ev(2026, 'Q2', 9.1, 'beat'),
      ev(2025, 'Q3', 2.0, 'beat'), // older — dropped when count=4
    ],
    4,
  )
  assert.deepEqual(
    summary.chips.map((c) => `${c.fiscalYear}-${c.fiscalPeriod}`),
    ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'],
  )
  assert.equal(summary.beatCount, 3)
  assert.equal(summary.total, 4)
  // avg surprise across the 4 chips
  assert.ok(Math.abs((summary.avgSurprisePct ?? 0) - (18.7 - 3.6 + 9.1 + 16.8) / 4) < 1e-9)
})

test('direction falls back to the surprise sign when not provided', () => {
  const summary = beatMissSummary([ev(2026, 'Q1', 4.2, null), ev(2026, 'Q2', -1.0, null)], 4)
  assert.deepEqual(summary.chips.map((c) => c.direction), ['beat', 'miss'])
})

test('empty events yield an empty summary', () => {
  const summary = beatMissSummary([], 4)
  assert.equal(summary.chips.length, 0)
  assert.equal(summary.beatCount, 0)
  assert.equal(summary.avgSurprisePct, null)
})
