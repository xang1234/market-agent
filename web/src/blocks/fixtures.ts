import type {
  LineChartBlock,
  MentionVolumeBlock,
  MetricRowBlock,
  MetricsComparisonBlock,
  PerfComparisonBlock,
  RevenueBarsBlock,
  RichTextBlock,
  SectionBlock,
  SegmentDonutBlock,
  SegmentTrajectoryBlock,
  SentimentTrendBlock,
  TableBlock,
} from './types.ts'

const FIXTURE_SNAPSHOT_ID = '11111111-1111-4111-9111-111111111111'
const FIXTURE_AS_OF = '2026-04-22T16:00:00.000Z'
const FIXTURE_FACT_REF = '22222222-2222-4222-9222-222222222222'
const FIXTURE_CLAIM_REF = '33333333-3333-4333-9333-333333333333'
const FIXTURE_SOURCE_REF = '44444444-4444-4444-9444-444444444444'
const FIXTURE_VALUE_REF_A = '55555555-5555-4555-9555-555555555555'
const FIXTURE_VALUE_REF_B = '66666666-6666-4666-9666-666666666666'
const FIXTURE_VALUE_REF_C = '77777777-7777-4777-9777-777777777777'
const FIXTURE_DELTA_REF = '88888888-8888-4888-9888-888888888888'

export const richTextFixture: RichTextBlock = {
  id: 'rt-1',
  kind: 'rich_text',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'narrative', id: 'rt-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  segments: [
    { type: 'text', text: 'Apple posted Q3 revenue of ' },
    { type: 'ref', ref_kind: 'fact', ref_id: FIXTURE_FACT_REF, format: '$85.8B' },
    { type: 'text', text: ', up year over year. Management ' },
    { type: 'ref', ref_kind: 'claim', ref_id: FIXTURE_CLAIM_REF, format: 'guided cautiously' },
    { type: 'text', text: ' on services growth.' },
  ],
}

export const metricRowFixture: MetricRowBlock = {
  id: 'mr-1',
  kind: 'metric_row',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'metric_row', id: 'mr-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  items: [
    { label: 'Revenue', value_ref: FIXTURE_VALUE_REF_A, format: '$85.8B', delta_ref: FIXTURE_DELTA_REF },
    { label: 'Gross margin', value_ref: FIXTURE_VALUE_REF_B, format: '46.3%' },
    { label: 'EPS', value_ref: FIXTURE_VALUE_REF_C, format: '$1.40' },
  ],
}

export const tableFixture: TableBlock = {
  id: 'tb-1',
  kind: 'table',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'table', id: 'tb-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Recent quarters',
  columns: ['Quarter', 'Revenue', 'Net income'],
  rows: [
    ['Q3 FY24', '$85.8B', '$21.4B'],
    ['Q2 FY24', '$90.8B', '$23.6B'],
    ['Q1 FY24', '$119.6B', '$33.9B'],
  ],
}

export const sectionFixture: SectionBlock = {
  id: 'sec-1',
  kind: 'section',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'section', id: 'sec-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Quarterly results',
  collapsible: true,
  children: [richTextFixture, metricRowFixture, tableFixture],
}

const ISSUER_AAPL = '99999999-9999-4999-9999-999999999991'
const ISSUER_MSFT = '99999999-9999-4999-9999-999999999992'
const ISSUER_GOOG = '99999999-9999-4999-9999-999999999993'

export const lineChartFixture: LineChartBlock = {
  id: 'lc-1',
  kind: 'line_chart',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'line_chart', id: 'lc-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Revenue trajectory',
  x_type: 'time',
  y_format: '$M',
  series: [
    {
      name: 'AAPL',
      unit: 'USD',
      points: [
        { x: '2024-Q1', y: 119.6 },
        { x: '2024-Q2', y: 90.8 },
        { x: '2024-Q3', y: 85.8 },
        { x: '2024-Q4', y: 94.9 },
      ],
    },
    {
      name: 'MSFT',
      unit: 'USD',
      points: [
        { x: '2024-Q1', y: 62.0 },
        { x: '2024-Q2', y: 64.7 },
        { x: '2024-Q3', y: 65.6 },
        { x: '2024-Q4', y: 69.6 },
      ],
    },
  ],
}

export const revenueBarsFixture: RevenueBarsBlock = {
  id: 'rb-1',
  kind: 'revenue_bars',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'revenue_bars', id: 'rb-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Quarterly revenue',
  bars: [
    { label: 'Q1 FY24', value_ref: '11111111-1111-4111-9111-aaaaaaaaaaaa' },
    { label: 'Q2 FY24', value_ref: '11111111-1111-4111-9111-bbbbbbbbbbbb' },
    { label: 'Q3 FY24', value_ref: '11111111-1111-4111-9111-cccccccccccc', delta_ref: '11111111-1111-4111-9111-dddddddddddd' },
    { label: 'Q4 FY24', value_ref: '11111111-1111-4111-9111-eeeeeeeeeeee' },
  ],
}

export const perfComparisonFixture: PerfComparisonBlock = {
  id: 'pc-1',
  kind: 'perf_comparison',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'perf_comparison', id: 'pc-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Mega-cap comparison',
  subject_refs: [
    { kind: 'issuer', id: ISSUER_AAPL },
    { kind: 'issuer', id: ISSUER_MSFT },
    { kind: 'issuer', id: ISSUER_GOOG },
  ],
  default_range: '1Y',
  basis: 'adj_close',
  normalization: 'index_100',
}

export const segmentDonutFixture: SegmentDonutBlock = {
  id: 'sd-1',
  kind: 'segment_donut',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'segment_donut', id: 'sd-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Revenue by segment',
  segments: [
    { name: 'iPhone', value_ref: '22222222-2222-4222-9222-aaaaaaaaaaaa' },
    { name: 'Mac', value_ref: '22222222-2222-4222-9222-bbbbbbbbbbbb' },
    { name: 'iPad', value_ref: '22222222-2222-4222-9222-cccccccccccc', definition_as_of: '2024-09-30' },
    { name: 'Wearables', value_ref: '22222222-2222-4222-9222-dddddddddddd' },
    { name: 'Services', value_ref: '22222222-2222-4222-9222-eeeeeeeeeeee' },
  ],
  coverage_warnings: ['Wearables redefined in FY23 — pre-FY23 share not directly comparable.'],
}

export const segmentTrajectoryFixture: SegmentTrajectoryBlock = {
  id: 'stj-1',
  kind: 'segment_trajectory',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'segment_trajectory', id: 'stj-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Segment share over time',
  series: [
    {
      name: 'iPhone',
      points: [
        { x: '2022', y: 0.52 },
        { x: '2023', y: 0.51 },
        { x: '2024', y: 0.50 },
      ],
    },
    {
      name: 'Services',
      points: [
        { x: '2022', y: 0.18 },
        { x: '2023', y: 0.20 },
        { x: '2024', y: 0.22 },
      ],
    },
  ],
}

export const metricsComparisonFixture: MetricsComparisonBlock = {
  id: 'mc-1',
  kind: 'metrics_comparison',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'metrics_comparison', id: 'mc-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Mega-cap fundamentals',
  subjects: [
    { kind: 'issuer', id: ISSUER_AAPL },
    { kind: 'issuer', id: ISSUER_MSFT },
    { kind: 'issuer', id: ISSUER_GOOG },
  ],
  metrics: ['Revenue (TTM)', 'Gross margin', 'EPS (TTM)', 'P/E'],
}

export const sentimentTrendFixture: SentimentTrendBlock = {
  id: 'st-1',
  kind: 'sentiment_trend',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'sentiment_trend', id: 'st-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Community sentiment (30 day)',
  series: [
    {
      name: 'Sentiment',
      points: [
        { x: '2024-09-01', y: 0.12 },
        { x: '2024-09-08', y: 0.18 },
        { x: '2024-09-15', y: 0.05 },
        { x: '2024-09-22', y: -0.08 },
        { x: '2024-09-29', y: 0.02 },
      ],
    },
  ],
}

export const mentionVolumeFixture: MentionVolumeBlock = {
  id: 'mv-1',
  kind: 'mention_volume',
  snapshot_id: FIXTURE_SNAPSHOT_ID,
  data_ref: { kind: 'mention_volume', id: 'mv-1' },
  source_refs: [FIXTURE_SOURCE_REF],
  as_of: FIXTURE_AS_OF,
  title: 'Mentions by source (30 day)',
  series: [
    {
      name: 'Community',
      points: [
        { x: '2024-09-01', y: 1240 },
        { x: '2024-09-08', y: 1480 },
        { x: '2024-09-15', y: 1210 },
        { x: '2024-09-22', y: 980 },
        { x: '2024-09-29', y: 1320 },
      ],
    },
    {
      name: 'News',
      points: [
        { x: '2024-09-01', y: 320 },
        { x: '2024-09-08', y: 290 },
        { x: '2024-09-15', y: 410 },
        { x: '2024-09-22', y: 380 },
        { x: '2024-09-29', y: 340 },
      ],
    },
  ],
}
