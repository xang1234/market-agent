import assert from 'node:assert/strict'
import test from 'node:test'
import {
  lineChartFixture,
  mentionVolumeFixture,
  metricRowFixture,
  metricsComparisonFixture,
  perfComparisonFixture,
  revenueBarsFixture,
  richTextFixture,
  sectionFixture,
  segmentDonutFixture,
  segmentTrajectoryFixture,
  sentimentTrendFixture,
  tableFixture,
} from './fixtures.ts'
import type { BaseBlock, Series } from './types.ts'
import { PERF_NORMALIZATIONS, SUBJECT_KINDS, X_AXIS_TYPES } from './types.ts'

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

function assertBaseBlockShape(block: BaseBlock, expectedKind: string): void {
  assert.equal(block.kind, expectedKind, `expected kind=${expectedKind}`)
  assert.ok(block.id.length > 0, 'id is non-empty')
  assert.match(block.snapshot_id, UUID_PATTERN, 'snapshot_id is a UUID')
  assert.equal(typeof block.data_ref.kind, 'string')
  assert.equal(typeof block.data_ref.id, 'string')
  assert.ok(Array.isArray(block.source_refs), 'source_refs is an array')
  for (const ref of block.source_refs) {
    assert.match(ref, UUID_PATTERN, 'every source_ref is a UUID')
  }
  assert.match(block.as_of, ISO_PATTERN, 'as_of is an ISO date-time')
}

test('rich_text fixture satisfies the BaseBlock contract', () => {
  assertBaseBlockShape(richTextFixture, 'rich_text')
  assert.ok(richTextFixture.segments.length > 0)
  for (const segment of richTextFixture.segments) {
    if (segment.type === 'ref') {
      assert.match(segment.ref_id, UUID_PATTERN)
    }
  }
})

test('rich_text fixture mixes text and ref segments so renderers exercise both branches', () => {
  const types = new Set(richTextFixture.segments.map((s) => s.type))
  assert.ok(types.has('text'))
  assert.ok(types.has('ref'))
})

test('metric_row fixture has at least one cell with a value_ref UUID', () => {
  assertBaseBlockShape(metricRowFixture, 'metric_row')
  assert.ok(metricRowFixture.items.length > 0)
  for (const cell of metricRowFixture.items) {
    assert.ok(cell.label.length > 0)
    assert.match(cell.value_ref, UUID_PATTERN)
  }
})

test('metric_row fixture exercises the optional delta_ref path on at least one cell', () => {
  const withDelta = metricRowFixture.items.find((cell) => cell.delta_ref !== undefined)
  assert.ok(withDelta, 'expected at least one delta-bearing cell so the renderer exercises the chip variant')
})

test('table fixture rows align with declared columns', () => {
  assertBaseBlockShape(tableFixture, 'table')
  for (const row of tableFixture.rows) {
    assert.equal(row.length, tableFixture.columns.length, 'every row has one cell per column')
  }
})

test('section fixture wraps the other three fixtures so recursive dispatch is exercised', () => {
  assertBaseBlockShape(sectionFixture, 'section')
  const childKinds = sectionFixture.children.map((child) => child.kind)
  assert.deepEqual(childKinds, ['rich_text', 'metric_row', 'table'])
  assert.equal(sectionFixture.collapsible, true)
})

function assertNonEmptySeriesArray(series: ReadonlyArray<Series>, label: string): void {
  assert.ok(series.length > 0, `${label}: expected at least one series`)
  for (const s of series) {
    assert.ok(s.name.length > 0, `${label}: series name is non-empty`)
    assert.ok(s.points.length >= 2, `${label}: at least 2 points so a line can be drawn`)
    for (const point of s.points) {
      assert.equal(typeof point.y, 'number')
      assert.ok(Number.isFinite(point.y), `${label}: every y is finite`)
    }
  }
}

test('line_chart fixture carries multi-series data and a recognized x_type', () => {
  assertBaseBlockShape(lineChartFixture, 'line_chart')
  assert.ok((X_AXIS_TYPES as ReadonlyArray<string>).includes(lineChartFixture.x_type))
  assert.ok(lineChartFixture.series.length >= 2, 'multi-series exercises shared y-domain')
  assertNonEmptySeriesArray(lineChartFixture.series, 'line_chart')
})

test('revenue_bars fixture has labeled bars and at least one delta-bearing bar', () => {
  assertBaseBlockShape(revenueBarsFixture, 'revenue_bars')
  assert.ok(revenueBarsFixture.bars.length > 0)
  for (const bar of revenueBarsFixture.bars) {
    assert.ok(bar.label.length > 0)
    assert.match(bar.value_ref, UUID_PATTERN)
  }
  const withDelta = revenueBarsFixture.bars.find((bar) => bar.delta_ref !== undefined)
  assert.ok(withDelta, 'at least one bar exercises the optional delta_ref path')
})

test('perf_comparison fixture has subject refs and a recognized normalization', () => {
  assertBaseBlockShape(perfComparisonFixture, 'perf_comparison')
  assert.ok(perfComparisonFixture.subject_refs.length > 0)
  for (const subject of perfComparisonFixture.subject_refs) {
    assert.ok((SUBJECT_KINDS as ReadonlyArray<string>).includes(subject.kind))
    assert.match(subject.id, UUID_PATTERN)
  }
  assert.ok((PERF_NORMALIZATIONS as ReadonlyArray<string>).includes(perfComparisonFixture.normalization))
  assert.ok(perfComparisonFixture.default_range.length > 0)
  assert.ok(perfComparisonFixture.basis.length > 0)
})

test('segment_donut fixture has named segments and surfaces coverage warnings when present', () => {
  assertBaseBlockShape(segmentDonutFixture, 'segment_donut')
  assert.ok(segmentDonutFixture.segments.length > 0)
  for (const segment of segmentDonutFixture.segments) {
    assert.ok(segment.name.length > 0)
    assert.match(segment.value_ref, UUID_PATTERN)
  }
  const definitionRow = segmentDonutFixture.segments.find((s) => s.definition_as_of !== undefined)
  assert.ok(definitionRow, 'at least one segment exercises the optional definition_as_of path')
  assert.ok(segmentDonutFixture.coverage_warnings && segmentDonutFixture.coverage_warnings.length > 0)
})

test('segment_trajectory fixture carries multi-series share data', () => {
  assertBaseBlockShape(segmentTrajectoryFixture, 'segment_trajectory')
  assertNonEmptySeriesArray(segmentTrajectoryFixture.series, 'segment_trajectory')
})

test('metrics_comparison fixture pairs subjects with metric labels', () => {
  assertBaseBlockShape(metricsComparisonFixture, 'metrics_comparison')
  assert.ok(metricsComparisonFixture.subjects.length > 0)
  assert.ok(metricsComparisonFixture.metrics.length > 0)
  for (const subject of metricsComparisonFixture.subjects) {
    assert.ok((SUBJECT_KINDS as ReadonlyArray<string>).includes(subject.kind))
    assert.match(subject.id, UUID_PATTERN)
  }
})

test('sentiment_trend fixture has a single series with finite scores in a sensible range', () => {
  assertBaseBlockShape(sentimentTrendFixture, 'sentiment_trend')
  assertNonEmptySeriesArray(sentimentTrendFixture.series, 'sentiment_trend')
  for (const series of sentimentTrendFixture.series) {
    for (const point of series.points) {
      assert.ok(point.y >= -1 && point.y <= 1, 'sentiment scores stay in [-1, 1]')
    }
  }
})

test('mention_volume fixture has multi-series counts that are non-negative integers', () => {
  assertBaseBlockShape(mentionVolumeFixture, 'mention_volume')
  assertNonEmptySeriesArray(mentionVolumeFixture.series, 'mention_volume')
  for (const series of mentionVolumeFixture.series) {
    for (const point of series.points) {
      assert.ok(point.y >= 0, 'mention counts are non-negative')
      assert.ok(Number.isInteger(point.y), 'mention counts are integers')
    }
  }
})
