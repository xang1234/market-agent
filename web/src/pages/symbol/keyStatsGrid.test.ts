import assert from 'node:assert/strict'
import test from 'node:test'

import type { NormalizedBar } from '../../symbol/series.ts'
import type { KeyStat, KeyStatsEnvelope } from '../../symbol/stats.ts'
import { buildKeyStatsGrid, formatCompactNumber } from './keyStatsGrid.ts'

function bar(partial: Partial<NormalizedBar>): NormalizedBar {
  return { ts: '2026-04-25T00:00:00.000Z', open: 0, high: 0, low: 0, close: 0, volume: 0, ...partial }
}

function stat(stat_key: KeyStat['stat_key'], value_num: number, format_hint: KeyStat['format_hint']): KeyStat {
  return {
    stat_key,
    value_num,
    unit: format_hint === 'percent' ? 'ratio' : 'multiple',
    format_hint,
    coverage_level: 'full',
    basis: 'as_reported',
    period_kind: 'fiscal_y',
    period_start: null,
    period_end: '2025-12-31',
    fiscal_year: 2025,
    fiscal_period: 'FY',
    as_of: '2026-02-01T00:00:00.000Z',
    computation: { kind: 'ratio', expression: 'x/y' },
    warnings: [],
  }
}

const envelope = (stats: ReadonlyArray<KeyStat>): KeyStatsEnvelope => ({
  subject: { kind: 'issuer', id: 'i-1' },
  family: 'key_stats',
  basis: 'as_reported',
  period_kind: 'fiscal_y',
  period_start: null,
  period_end: '2025-12-31',
  fiscal_year: 2025,
  fiscal_period: 'FY',
  reporting_currency: 'USD',
  as_of: '2026-02-01T00:00:00.000Z',
  stats,
})

test('formatCompactNumber abbreviates by magnitude', () => {
  assert.equal(formatCompactNumber(2_410_000), '2.41M')
  assert.equal(formatCompactNumber(812_600_000_000), '812.60B')
  assert.equal(formatCompactNumber(950), '950')
})

test('prev close comes from the authoritative quote value, not the bars', () => {
  const bars = [
    bar({ close: 1_640 }), // a bars-derived prev close would wrongly pick this
    bar({ open: 1_646.1, high: 1_662, low: 1_641, close: 1_658.4, volume: 2_410_000 }),
  ]
  const cells = buildKeyStatsGrid({ bars, stats: null, prevClose: 1_643.23, currency: 'USD' })
  const byKey = new Map(cells.map((c) => [c.key, c]))

  const prev = byKey.get('prev_close')
  assert.ok(prev)
  assert.equal(prev.emphasis, true)
  assert.match(prev.value ?? '', /1,643\.23/)
  // open / day range / volume still come from the latest bar
  assert.match(byKey.get('open')?.value ?? '', /1,646\.10/)
  assert.match(byKey.get('day_range')?.value ?? '', /1,641\.00.*1,662\.00/)
  assert.equal(byKey.get('volume')?.value, '2.41M')
})

test('buildKeyStatsGrid fills fundamental cells from the stats envelope', () => {
  const cells = buildKeyStatsGrid({
    bars: null,
    stats: envelope([stat('pe_ratio', 48.2, 'multiple'), stat('gross_margin', 0.712, 'percent')]),
    prevClose: null,
    currency: 'USD',
  })
  const byKey = new Map(cells.map((c) => [c.key, c]))
  assert.equal(byKey.get('pe_ratio')?.value, '48.20×')
  assert.equal(byKey.get('gross_margin')?.value, '71.20%')
})

test('only provider-backed cells are emitted; unavailable ones are null (dash)', () => {
  const cells = buildKeyStatsGrid({ bars: null, stats: null, prevClose: null, currency: 'USD' })
  const byKey = new Map(cells.map((c) => [c.key, c]))
  // prev close / fundamentals exist as cells but carry null (no data yet)
  assert.ok(byKey.has('prev_close'))
  assert.equal(byKey.get('prev_close')?.value, null)
  assert.ok(byKey.has('pe_ratio'))
  // no-provider placeholders are NOT emitted at all
  assert.equal(byKey.has('market_cap'), false)
  assert.equal(byKey.has('fifty_two_week'), false)
  assert.equal(byKey.has('beta'), false)
  // every emitted cell has a label
  assert.ok(cells.every((c) => c.label.length > 0))
})
