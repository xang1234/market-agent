// TypeScript shapes mirroring `spec/finance_research_block_schema.json`.
// Runtime validation against the schema is a separate concern.

export const NARRATIVE_LAYOUT_BLOCK_KINDS = ['rich_text', 'section', 'metric_row', 'table'] as const
export type NarrativeLayoutBlockKind = (typeof NARRATIVE_LAYOUT_BLOCK_KINDS)[number]

export const CHART_COMPARISON_BLOCK_KINDS = [
  'line_chart',
  'revenue_bars',
  'perf_comparison',
  'segment_donut',
  'segment_trajectory',
  'metrics_comparison',
  'sentiment_trend',
  'mention_volume',
] as const
export type ChartComparisonBlockKind = (typeof CHART_COMPARISON_BLOCK_KINDS)[number]

export const DISCLOSURE_TIERS = [
  'real_time',
  'delayed_15m',
  'eod',
  'filing_time',
  'estimate',
  'candidate',
  'tertiary_source',
] as const
export type DisclosureTier = (typeof DISCLOSURE_TIERS)[number]

export type DataRef = {
  kind: string
  id: string
  params?: Readonly<Record<string, unknown>>
}

export type InteractiveSpec = {
  ranges?: ReadonlyArray<string>
  intervals?: ReadonlyArray<string>
  sort_fields?: ReadonlyArray<string>
  range_end_max?: string
  hover_details?: boolean
  collapsible?: boolean
}

export type BaseBlock = {
  id: string
  kind: string
  snapshot_id: string
  data_ref: DataRef
  source_refs: ReadonlyArray<string>
  as_of: string
  title?: string
  disclosure_tier?: DisclosureTier
  interactive?: InteractiveSpec
}

export type TextSegment = { type: 'text'; text: string }

export const REF_SEGMENT_KINDS = ['fact', 'claim', 'event'] as const
export type RefSegmentKind = (typeof REF_SEGMENT_KINDS)[number]

export type RefSegment = {
  type: 'ref'
  ref_kind: RefSegmentKind
  ref_id: string
  format?: string
}

export type RichTextSegment = TextSegment | RefSegment

export type RichTextBlock = BaseBlock & {
  kind: 'rich_text'
  segments: ReadonlyArray<RichTextSegment>
}

export type SectionBlock = BaseBlock & {
  kind: 'section'
  children: ReadonlyArray<Block>
  collapsible?: boolean
}

export type MetricCell = {
  label: string
  value_ref: string
  format?: string
  delta_ref?: string
}

export type MetricRowBlock = BaseBlock & {
  kind: 'metric_row'
  items: ReadonlyArray<MetricCell>
}

// JSON-schema permits string | number | object cells; rendering coerces
// objects to JSON-stringified text in the renderer.
export type TableCellValue = string | number | Readonly<Record<string, unknown>>

export type TableBlock = BaseBlock & {
  kind: 'table'
  columns: ReadonlyArray<string>
  rows: ReadonlyArray<ReadonlyArray<TableCellValue>>
}

export type NarrativeLayoutBlock = RichTextBlock | SectionBlock | MetricRowBlock | TableBlock

import type { SubjectKind, SubjectRef } from '../symbol/search.ts'
export { SUBJECT_KINDS } from '../symbol/search.ts'
export type { SubjectKind, SubjectRef }

export type SeriesPoint = {
  x: string | number
  y: number
  label?: string
}

export type Series = {
  name: string
  points: ReadonlyArray<SeriesPoint>
  unit?: string
}

export const X_AXIS_TYPES = ['time', 'category'] as const
export type XAxisType = (typeof X_AXIS_TYPES)[number]

export type LineChartBlock = BaseBlock & {
  kind: 'line_chart'
  series: ReadonlyArray<Series>
  x_type: XAxisType
  y_format?: string
}

export type RevenueBar = {
  label: string
  value_ref: string
  delta_ref?: string
}

export type RevenueBarsBlock = BaseBlock & {
  kind: 'revenue_bars'
  bars: ReadonlyArray<RevenueBar>
}

export const PERF_NORMALIZATIONS = ['raw', 'pct_return', 'index_100'] as const
export type PerfNormalization = (typeof PERF_NORMALIZATIONS)[number]

export type PerfComparisonBlock = BaseBlock & {
  kind: 'perf_comparison'
  subject_refs: ReadonlyArray<SubjectRef>
  default_range: string
  basis: string
  normalization: PerfNormalization
}

export type DonutSegment = {
  name: string
  value_ref: string
  definition_as_of?: string
}

export type SegmentDonutBlock = BaseBlock & {
  kind: 'segment_donut'
  segments: ReadonlyArray<DonutSegment>
  coverage_warnings?: ReadonlyArray<string>
}

export type SegmentTrajectoryBlock = BaseBlock & {
  kind: 'segment_trajectory'
  series: ReadonlyArray<Series>
}

export type MetricsComparisonBlock = BaseBlock & {
  kind: 'metrics_comparison'
  subjects: ReadonlyArray<SubjectRef>
  metrics: ReadonlyArray<string>
}

export type SentimentTrendBlock = BaseBlock & {
  kind: 'sentiment_trend'
  series: ReadonlyArray<Series>
}

export type MentionVolumeBlock = BaseBlock & {
  kind: 'mention_volume'
  series: ReadonlyArray<Series>
}

export type ChartComparisonBlock =
  | LineChartBlock
  | RevenueBarsBlock
  | PerfComparisonBlock
  | SegmentDonutBlock
  | SegmentTrajectoryBlock
  | MetricsComparisonBlock
  | SentimentTrendBlock
  | MentionVolumeBlock

// Open variant lets Section.children carry kinds whose typed shape
// ships later. Narrow this once the full catalog is unioned.
export type Block = NarrativeLayoutBlock | ChartComparisonBlock | (BaseBlock & { kind: string })
