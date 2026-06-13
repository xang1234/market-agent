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

test('buildKeyStatsGrid derives price cells from the latest two bars', () => {
  const bars = [
    bar({ close: 1_643.23 }),
    bar({ open: 1_646.1, high: 1_662, low: 1_641, close: 1_658.4, volume: 2_410_000 }),
  ]
  const cells = buildKeyStatsGrid(bars, null, 'USD')
  const byKey = new Map(cells.map((c) => [c.key, c]))

  const prev = byKey.get('prev_close')
  assert.ok(prev)
  assert.equal(prev.emphasis, true)
  assert.match(prev.value ?? '', /1,643\.23/)
  assert.match(byKey.get('open')?.value ?? '', /1,646\.10/)
  assert.match(byKey.get('day_range')?.value ?? '', /1,641\.00.*1,662\.00/)
  assert.equal(byKey.get('volume')?.value, '2.41M')
})

test('buildKeyStatsGrid fills fundamental cells from the stats envelope', () => {
  const cells = buildKeyStatsGrid(null, envelope([
    stat('pe_ratio', 48.2, 'multiple'),
    stat('gross_margin', 0.712, 'percent'),
  ]), 'USD')
  const byKey = new Map(cells.map((c) => [c.key, c]))
  assert.equal(byKey.get('pe_ratio')?.value, '48.20×')
  assert.equal(byKey.get('gross_margin')?.value, '71.20%')
})

test('cells with no data carry a null value (rendered as a dash)', () => {
  const cells = buildKeyStatsGrid(null, null, 'USD')
  const byKey = new Map(cells.map((c) => [c.key, c]))
  // price cells have no bars, fundamentals have no envelope, and these are
  // always-null placeholders until their providers are wired.
  assert.equal(byKey.get('prev_close')?.value, null)
  assert.equal(byKey.get('market_cap')?.value, null)
  assert.equal(byKey.get('fifty_two_week')?.value, null)
  assert.equal(byKey.get('beta')?.value, null)
  // every cell still has a label so the grid renders a complete shape
  assert.ok(cells.every((c) => c.label.length > 0))
})
