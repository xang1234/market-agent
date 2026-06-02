import assert from 'node:assert/strict'
import test from 'node:test'

import { isWideBlock, PROSE_COLUMN_CLASS, BREAKOUT_COLUMN_CLASS } from './blockColumns.ts'

// ── isWideBlock ───────────────────────────────────────────────────────────────

// chart / comparison kinds → wide
for (const kind of [
  'line_chart',
  'revenue_bars',
  'perf_comparison',
  'segment_donut',
  'segment_trajectory',
  'metrics_comparison',
  'sentiment_trend',
  'mention_volume',
]) {
  test(`isWideBlock('${kind}') === true`, () => {
    assert.equal(isWideBlock(kind), true)
  })
}

// table → wide (data artifact even though it lives in NarrativeLayoutBlock)
test("isWideBlock('table') === true", () => {
  assert.equal(isWideBlock('table'), true)
})

// research evidence data blocks → wide
for (const kind of ['analyst_consensus', 'price_target_range', 'eps_surprise', 'filings_list']) {
  test(`isWideBlock('${kind}') === true`, () => {
    assert.equal(isWideBlock(kind), true)
  })
}

// text-ish kinds → NOT wide
for (const kind of [
  'rich_text',
  'section',
  'metric_row',
  'news_cluster',
  'finding_card',
  'sources',
  'disclosure',
]) {
  test(`isWideBlock('${kind}') === false`, () => {
    assert.equal(isWideBlock(kind), false)
  })
}

// unknown kind → NOT wide
test("isWideBlock('unknown_kind') === false", () => {
  assert.equal(isWideBlock('unknown_kind'), false)
})

// ── column class strings ──────────────────────────────────────────────────────

test('PROSE_COLUMN_CLASS contains max-w-[820px]', () => {
  assert.ok(PROSE_COLUMN_CLASS.includes('max-w-[820px]'), `Got: ${PROSE_COLUMN_CLASS}`)
})

test('PROSE_COLUMN_CLASS does NOT contain mx-auto', () => {
  assert.ok(!PROSE_COLUMN_CLASS.includes('mx-auto'), `Got: ${PROSE_COLUMN_CLASS}`)
})

test('BREAKOUT_COLUMN_CLASS contains max-w-[960px]', () => {
  assert.ok(BREAKOUT_COLUMN_CLASS.includes('max-w-[960px]'), `Got: ${BREAKOUT_COLUMN_CLASS}`)
})

test('BREAKOUT_COLUMN_CLASS does NOT contain mx-auto', () => {
  assert.ok(!BREAKOUT_COLUMN_CLASS.includes('mx-auto'), `Got: ${BREAKOUT_COLUMN_CLASS}`)
})
