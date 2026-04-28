import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_BLOCK_FIXTURES,
  analystConsensusFixture,
  disclosureFixture,
  epsSurpriseFixture,
  filingsListFixture,
  findingCardFixture,
  lineChartFixture,
  mentionVolumeFixture,
  metricRowFixture,
  metricsComparisonFixture,
  newsClusterFixture,
  perfComparisonFixture,
  priceTargetRangeFixture,
  revenueBarsFixture,
  richTextFixture,
  sectionFixture,
  segmentDonutFixture,
  segmentTrajectoryFixture,
  sentimentTrendFixture,
  sourcesFixture,
  tableFixture,
} from './fixtures.ts'
import type { BaseBlock, Series } from './types.ts'
import {
  CHART_COMPARISON_BLOCK_KINDS,
  DISCLOSURE_TIERS,
  FINDING_SEVERITIES,
  NARRATIVE_LAYOUT_BLOCK_KINDS,
  PERF_NORMALIZATIONS,
  RESEARCH_EVIDENCE_BLOCK_KINDS,
  SUBJECT_KINDS,
  TRUST_PROVENANCE_BLOCK_KINDS,
  X_AXIS_TYPES,
} from './types.ts'

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

test('analyst_consensus fixture has named buckets with UUID count refs and a coverage warning', () => {
  assertBaseBlockShape(analystConsensusFixture, 'analyst_consensus')
  assert.match(analystConsensusFixture.analyst_count_ref, UUID_PATTERN)
  assert.ok(analystConsensusFixture.distribution.length > 0)
  for (const bucket of analystConsensusFixture.distribution) {
    assert.ok(bucket.bucket.length > 0)
    assert.match(bucket.count_ref, UUID_PATTERN)
  }
  assert.ok(analystConsensusFixture.coverage_warning && analystConsensusFixture.coverage_warning.length > 0)
})

test('price_target_range fixture has all four required price refs plus the optional upside_ref', () => {
  assertBaseBlockShape(priceTargetRangeFixture, 'price_target_range')
  assert.match(priceTargetRangeFixture.current_price_ref, UUID_PATTERN)
  assert.match(priceTargetRangeFixture.low_ref, UUID_PATTERN)
  assert.match(priceTargetRangeFixture.avg_ref, UUID_PATTERN)
  assert.match(priceTargetRangeFixture.high_ref, UUID_PATTERN)
  assert.ok(priceTargetRangeFixture.upside_ref !== undefined, 'upside_ref exercises the optional field branch')
  assert.match(priceTargetRangeFixture.upside_ref, UUID_PATTERN)
})

test('eps_surprise fixture covers the four-quarter window and exercises both surprise_ref branches', () => {
  assertBaseBlockShape(epsSurpriseFixture, 'eps_surprise')
  assert.equal(epsSurpriseFixture.quarters.length, 4)
  for (const quarter of epsSurpriseFixture.quarters) {
    assert.ok(quarter.label.length > 0)
    assert.match(quarter.estimate_ref, UUID_PATTERN)
    assert.match(quarter.actual_ref, UUID_PATTERN)
  }
  const withSurprise = epsSurpriseFixture.quarters.find((q) => q.surprise_ref !== undefined)
  const withoutSurprise = epsSurpriseFixture.quarters.find((q) => q.surprise_ref === undefined)
  assert.ok(withSurprise, 'at least one quarter exercises the surprise_ref optional field')
  assert.ok(withoutSurprise, 'at least one quarter omits surprise_ref so the renderer covers both branches')
})

test('filings_list fixture has form names, ISO filed_at timestamps, and at least one period-bearing item', () => {
  assertBaseBlockShape(filingsListFixture, 'filings_list')
  assert.ok(filingsListFixture.items.length > 0)
  for (const item of filingsListFixture.items) {
    assert.match(item.document_id, UUID_PATTERN)
    assert.ok(item.form.length > 0)
    assert.match(item.filed_at, ISO_PATTERN)
  }
  const withPeriod = filingsListFixture.items.find((item) => item.period !== undefined)
  assert.ok(withPeriod, 'at least one item carries a period to exercise the optional path')
})

test('news_cluster fixture has a non-empty headline and at least one claim ref', () => {
  assertBaseBlockShape(newsClusterFixture, 'news_cluster')
  assert.match(newsClusterFixture.cluster_id, UUID_PATTERN)
  assert.ok(newsClusterFixture.headline.length > 0)
  assert.ok(newsClusterFixture.claim_refs.length > 0)
  for (const ref of newsClusterFixture.claim_refs) {
    assert.match(ref, UUID_PATTERN)
  }
  assert.ok(newsClusterFixture.document_refs && newsClusterFixture.document_refs.length > 0)
})

test('finding_card fixture carries a recognized severity and at least one subject ref', () => {
  assertBaseBlockShape(findingCardFixture, 'finding_card')
  assert.match(findingCardFixture.finding_id, UUID_PATTERN)
  assert.ok(findingCardFixture.headline.length > 0)
  assert.ok((FINDING_SEVERITIES as ReadonlyArray<string>).includes(findingCardFixture.severity))
  assert.ok(findingCardFixture.subject_refs && findingCardFixture.subject_refs.length > 0)
  for (const subject of findingCardFixture.subject_refs) {
    assert.ok((SUBJECT_KINDS as ReadonlyArray<string>).includes(subject.kind))
    assert.match(subject.id, UUID_PATTERN)
  }
})

test('sources fixture exercises both branches of the optional url field with valid source_ids', () => {
  assertBaseBlockShape(sourcesFixture, 'sources')
  assert.ok(sourcesFixture.items.length > 0)
  for (const item of sourcesFixture.items) {
    assert.match(item.source_id, UUID_PATTERN)
    assert.ok(item.label.length > 0)
  }
  const withUrl = sourcesFixture.items.find((item) => item.url !== undefined)
  const withoutUrl = sourcesFixture.items.find((item) => item.url === undefined)
  assert.ok(withUrl, 'at least one item carries a url to exercise the linked-label path')
  assert.ok(withoutUrl, 'at least one item omits url so the renderer covers both branches')
})

test('disclosure fixture pairs a recognized tier with at least one non-empty text item', () => {
  assertBaseBlockShape(disclosureFixture, 'disclosure')
  assert.ok(disclosureFixture.disclosure_tier !== undefined, 'tier is set so the badge path is exercised')
  assert.ok((DISCLOSURE_TIERS as ReadonlyArray<string>).includes(disclosureFixture.disclosure_tier))
  assert.ok(disclosureFixture.items.length > 0)
  for (const item of disclosureFixture.items) {
    assert.ok(item.length > 0)
  }
})

test('ALL_BLOCK_FIXTURES carries one fixture per catalogued block kind so adding a kind without a fixture loud-fails', () => {
  const fixtureKinds = new Set(ALL_BLOCK_FIXTURES.map((b) => b.kind))
  const cataloguedKinds = new Set<string>([
    ...NARRATIVE_LAYOUT_BLOCK_KINDS,
    ...CHART_COMPARISON_BLOCK_KINDS,
    ...RESEARCH_EVIDENCE_BLOCK_KINDS,
    ...TRUST_PROVENANCE_BLOCK_KINDS,
  ])
  assert.deepEqual(
    [...fixtureKinds].sort(),
    [...cataloguedKinds].sort(),
    'ALL_BLOCK_FIXTURES drifted from the block-kind catalog — append a fixture for every new kind',
  )
  assert.equal(ALL_BLOCK_FIXTURES.length, cataloguedKinds.size, 'expected exactly one fixture per kind')
})
