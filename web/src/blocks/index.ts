export type {
  BaseBlock,
  Block,
  ChartComparisonBlock,
  ChartComparisonBlockKind,
  DataRef,
  DisclosureTier,
  DonutSegment,
  InteractiveSpec,
  LineChartBlock,
  MentionVolumeBlock,
  MetricCell,
  MetricRowBlock,
  MetricsComparisonBlock,
  NarrativeLayoutBlock,
  NarrativeLayoutBlockKind,
  PerfComparisonBlock,
  PerfNormalization,
  RefSegment,
  RefSegmentKind,
  RevenueBar,
  RevenueBarsBlock,
  RichTextBlock,
  RichTextSegment,
  SectionBlock,
  SegmentDonutBlock,
  SegmentTrajectoryBlock,
  SentimentTrendBlock,
  Series,
  SeriesPoint,
  SubjectKind,
  SubjectRef,
  TableBlock,
  TableCellValue,
  TextSegment,
  XAxisType,
} from './types.ts'
export {
  CHART_COMPARISON_BLOCK_KINDS,
  DISCLOSURE_TIERS,
  NARRATIVE_LAYOUT_BLOCK_KINDS,
  PERF_NORMALIZATIONS,
  REF_SEGMENT_KINDS,
  SUBJECT_KINDS,
  X_AXIS_TYPES,
} from './types.ts'

export {
  BlockRegistryContext,
  createBlockRegistry,
  useBlockRegistry,
} from './Registry.ts'
export type { BlockRegistry, BlockRenderer, BlockRendererProps } from './Registry.ts'

export { BlockRegistryProvider, BlockView } from './BlockView.tsx'
export { registerNarrativeBlockRenderers } from './registerNarrativeBlocks.ts'
export { registerChartBlockRenderers } from './registerChartBlocks.ts'

export { RichText } from './RichText.tsx'
export { Section } from './Section.tsx'
export { MetricRow } from './MetricRow.tsx'
export { Table } from './Table.tsx'
export { LineChart } from './LineChart.tsx'
export { RevenueBars } from './RevenueBars.tsx'
export { PerfComparison } from './PerfComparison.tsx'
export { SegmentDonut } from './SegmentDonut.tsx'
export { SegmentTrajectory } from './SegmentTrajectory.tsx'
export { MetricsComparison } from './MetricsComparison.tsx'
export { SentimentTrend } from './SentimentTrend.tsx'
export { MentionVolume } from './MentionVolume.tsx'
