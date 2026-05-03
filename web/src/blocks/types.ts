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

export const RESEARCH_EVIDENCE_BLOCK_KINDS = [
  'analyst_consensus',
  'price_target_range',
  'eps_surprise',
  'filings_list',
  'news_cluster',
  'finding_card',
] as const
export type ResearchEvidenceBlockKind = (typeof RESEARCH_EVIDENCE_BLOCK_KINDS)[number]

export const TRUST_PROVENANCE_BLOCK_KINDS = ['sources', 'disclosure'] as const
export type TrustProvenanceBlockKind = (typeof TRUST_PROVENANCE_BLOCK_KINDS)[number]

export const FINDING_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]

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

// Sentinel data_ref.kind for blocks that are still streaming (no canonical
// snapshot landed yet). Ref resolvers should treat this as "no manifest"
// rather than try to resolve refs against a non-existent snapshot.
export const STREAMING_DATA_REF_KIND = 'streaming'

export type InteractiveSpec = {
  ranges?: ReadonlyArray<string>
  intervals?: ReadonlyArray<string>
  sort_fields?: ReadonlyArray<string>
  allowed_transforms?: AllowedTransforms
  range_end_max?: string
  hover_details?: boolean
  collapsible?: boolean
}

export type AllowedTransformRange = Readonly<Record<string, unknown>>

export type AllowedSeriesTransform = Readonly<{
  range: AllowedTransformRange
  interval: string
}>

export type AllowedTransforms = Readonly<{
  series?: ReadonlyArray<AllowedSeriesTransform>
  ranges?: ReadonlyArray<AllowedSeriesTransform>
}>

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

export type AnalystDistributionBucket = {
  bucket: string
  count_ref: string
}

export type AnalystConsensusBlock = BaseBlock & {
  kind: 'analyst_consensus'
  analyst_count_ref: string
  distribution: ReadonlyArray<AnalystDistributionBucket>
  coverage_warning?: string
}

export type PriceTargetRangeBlock = BaseBlock & {
  kind: 'price_target_range'
  current_price_ref: string
  low_ref: string
  avg_ref: string
  high_ref: string
  upside_ref?: string
}

export type EpsSurpriseQuarter = {
  label: string
  estimate_ref: string
  actual_ref: string
  surprise_ref?: string
}

export type EpsSurpriseBlock = BaseBlock & {
  kind: 'eps_surprise'
  quarters: ReadonlyArray<EpsSurpriseQuarter>
}

export type FilingItem = {
  document_id: string
  form: string
  filed_at: string
  period?: string
}

export type FilingsListBlock = BaseBlock & {
  kind: 'filings_list'
  items: ReadonlyArray<FilingItem>
}

export type NewsClusterBlock = BaseBlock & {
  kind: 'news_cluster'
  cluster_id: string
  headline: string
  claim_refs: ReadonlyArray<string>
  document_refs: ReadonlyArray<string>
}

export type FindingCardBlock = BaseBlock & {
  kind: 'finding_card'
  finding_id: string
  headline: string
  severity: FindingSeverity
  subject_refs?: ReadonlyArray<SubjectRef>
}

export type ResearchEvidenceBlock =
  | AnalystConsensusBlock
  | PriceTargetRangeBlock
  | EpsSurpriseBlock
  | FilingsListBlock
  | NewsClusterBlock
  | FindingCardBlock

export type SourceItem = {
  source_id: string
  label: string
  url?: string
}

export type SourcesBlock = BaseBlock & {
  kind: 'sources'
  items: ReadonlyArray<SourceItem>
}

export type DisclosureBlock = BaseBlock & {
  kind: 'disclosure'
  items: ReadonlyArray<string>
}

export type TrustProvenanceBlock = SourcesBlock | DisclosureBlock

// Open variant lets Section.children carry kinds whose typed shape
// ships later. Narrow this once the full catalog is unioned.
export type Block =
  | NarrativeLayoutBlock
  | ChartComparisonBlock
  | ResearchEvidenceBlock
  | TrustProvenanceBlock
  | (BaseBlock & { kind: string })
