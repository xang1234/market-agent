import assert from 'node:assert/strict'
import test from 'node:test'

import { formatPeriodLabel, revenueBarsFromStatements } from './financialsCharts.ts'
import type { GetStatementsResponse, NormalizedStatement } from './statements.ts'

function statement(period: string, revenue: number | null): NormalizedStatement {
  const [year, kind] = period.split('-')
  return {
    subject: { kind: 'issuer', id: 'i-1' },
    family: 'income',
    basis: 'as_reported',
    period_kind: kind === 'FY' ? 'fiscal_y' : 'fiscal_q',
    period_start: null,
    period_end: `${year}-12-31`,
    fiscal_year: Number(year),
    fiscal_period: kind as NormalizedStatement['fiscal_period'],
    reporting_currency: 'USD',
    as_of: '2026-01-01T00:00:00.000Z',
    reported_at: null,
    source_id: 's',
    lines: revenue === null ? [] : [{ metric_key: 'revenue', value_num: revenue, scale: 1 } as never],
  }
}

function response(entries: Array<[string, number | null]>): GetStatementsResponse {
  return {
    query: { subject_ref: { kind: 'issuer', id: 'i-1' }, statement: 'income', periods: [], basis: 'as_reported' },
    results: entries.map(([period, rev]) => ({
      period,
      outcome: { outcome: 'available', data: statement(period, rev) },
    })),
  }
}

test('revenueBarsFromStatements orders oldest→newest and computes period-over-period deltas', () => {
  // fetched newest-first (recentFyPeriods order)
  const bars = revenueBarsFromStatements(response([
    ['2024-FY', 130.5],
    ['2023-FY', 60.9],
    ['2022-FY', 26.9],
  ]))
  assert.deepEqual(bars.map((b) => b.period), ['2022-FY', '2023-FY', '2024-FY'])
  assert.equal(bars[0].deltaPct, null) // oldest has no prior
  assert.ok(Math.abs((bars[1].deltaPct ?? 0) - (60.9 - 26.9) / 26.9) < 1e-9)
  assert.ok(Math.abs((bars[2].deltaPct ?? 0) - (130.5 - 60.9) / 60.9) < 1e-9)
})

test('revenueBarsFromStatements skips periods with no revenue line', () => {
  const bars = revenueBarsFromStatements(response([
    ['2024-FY', 130.5],
    ['2023-FY', null],
    ['2022-FY', 26.9],
  ]))
  assert.deepEqual(bars.map((b) => b.value), [26.9, 130.5])
  // delta computed against the previous AVAILABLE bar
  assert.ok(Math.abs((bars[1].deltaPct ?? 0) - (130.5 - 26.9) / 26.9) < 1e-9)
})

test('formatPeriodLabel renders compact FY/quarter labels', () => {
  assert.equal(formatPeriodLabel('2024-FY'), 'FY24')
  assert.equal(formatPeriodLabel('2024-Q3'), "Q3'24")
  assert.equal(formatPeriodLabel('weird'), 'weird')
})
