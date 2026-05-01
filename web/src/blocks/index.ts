export type {
  AnalystConsensusBlock,
  AnalystDistributionBucket,
  BaseBlock,
  Block,
  ChartComparisonBlock,
  ChartComparisonBlockKind,
  DataRef,
  DisclosureBlock,
  DisclosureTier,
  DonutSegment,
  EpsSurpriseBlock,
  EpsSurpriseQuarter,
  FilingItem,
  FilingsListBlock,
  FindingCardBlock,
  FindingSeverity,
  InteractiveSpec,
  LineChartBlock,
  MentionVolumeBlock,
  MetricCell,
  MetricRowBlock,
  MetricsComparisonBlock,
  NarrativeLayoutBlock,
  NarrativeLayoutBlockKind,
  NewsClusterBlock,
  PerfComparisonBlock,
  PerfNormalization,
  PriceTargetRangeBlock,
  RefSegment,
  RefSegmentKind,
  ResearchEvidenceBlock,
  ResearchEvidenceBlockKind,
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
  SourceItem,
  SourcesBlock,
  SubjectKind,
  SubjectRef,
  TableBlock,
  TableCellValue,
  TextSegment,
  TrustProvenanceBlock,
  TrustProvenanceBlockKind,
  XAxisType,
} from './types.ts'
export {
  CHART_COMPARISON_BLOCK_KINDS,
  DISCLOSURE_TIERS,
  FINDING_SEVERITIES,
  NARRATIVE_LAYOUT_BLOCK_KINDS,
  PERF_NORMALIZATIONS,
  REF_SEGMENT_KINDS,
  RESEARCH_EVIDENCE_BLOCK_KINDS,
  STREAMING_DATA_REF_KIND,
  SUBJECT_KINDS,
  TRUST_PROVENANCE_BLOCK_KINDS,
  X_AXIS_TYPES,
} from './types.ts'

export {
  BlockRegistryContext,
  createBlockRegistry,
  useBlockRegistry,
} from './Registry.ts'
export type { BlockRegistry, BlockRenderer, BlockRendererProps } from './Registry.ts'

export { validateBlock } from './BlockValidator.ts'
export type { BlockValidationError, BlockValidationResult } from './BlockValidator.ts'

export {
  BlockLayoutHintError,
  RESIDUAL_SECTION_ID,
  applyBlockLayoutHint,
  parseBlockLayoutHint,
} from './layoutHint.ts'
export type { BlockLayoutHint, BlockLayoutHintSection } from './layoutHint.ts'

export { createSnapshotManifest, resolveRefSegment } from './snapshotManifest.ts'
export type { ResolvedRefSegment, SnapshotManifest } from './snapshotManifest.ts'

export {
  SnapshotManifestContext,
  useSnapshotManifest,
} from './snapshotManifestContext.ts'

export { BlockRegistryProvider, BlockView, SnapshotManifestProvider } from './BlockView.tsx'
export { MemoizedBlockView } from './MemoizedBlockView.tsx'
export { blockPropsAreEqual } from './blockMemoization.ts'
export { createDefaultBlockRegistry } from './defaultBlockRegistry.ts'
export { registerNarrativeBlockRenderers } from './registerNarrativeBlocks.ts'
export { registerChartBlockRenderers } from './registerChartBlocks.ts'
export { registerResearchEvidenceBlockRenderers } from './registerResearchEvidenceBlocks.ts'
export { registerTrustProvenanceBlockRenderers } from './registerTrustProvenanceBlocks.ts'

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
export { AnalystConsensus } from './AnalystConsensus.tsx'
export { PriceTargetRange } from './PriceTargetRange.tsx'
export { EpsSurprise } from './EpsSurprise.tsx'
export { FilingsList } from './FilingsList.tsx'
export { NewsCluster } from './NewsCluster.tsx'
export { FindingCard } from './FindingCard.tsx'
export { Sources } from './Sources.tsx'
export { Disclosure } from './Disclosure.tsx'
