import type {
  AllowedTransforms,
  MentionVolumeBlock,
  NewsClusterBlock,
  SentimentTrendBlock,
} from './types.ts'

export const MENTION_VOLUME_DISCLOSURE = 'Mentions measure observed discussion volume, not impact.'

type SocialSeriesBlock = SentimentTrendBlock | MentionVolumeBlock

type NewsClusterSupportSummary = {
  claimCount: number
  documentCount: number
  supportLabel: string
}

type NewsClusterEvidenceTarget = {
  clusterId: string
  claimIds: readonly string[]
  documentIds: readonly string[]
  bundleInput: { claim_ids: readonly string[] }
}

type SocialSeriesSummary = {
  kind: SocialSeriesBlock['kind']
  latestLabel: string
  latestValue: string
  pointCount: number
  total: number | null
}

type SeriesCacheContract = {
  seriesRefs: readonly string[]
  allowedRanges: readonly string[]
  allowedIntervals: readonly string[]
  allowedTransforms: AllowedTransforms
  rangeEndMax: string | null
  hoverDetails: boolean
}

export function newsClusterSupportSummary(block: NewsClusterBlock): NewsClusterSupportSummary {
  const claimCount = block.claim_refs.length
  const documentCount = block.document_refs.length
  if (claimCount === 0) {
    throw new Error('claim_refs: at least one claim is required')
  }
  if (documentCount === 0) {
    throw new Error('document_refs: at least one document is required')
  }
  return {
    claimCount,
    documentCount,
    supportLabel: `${claimCount} ${pluralize(claimCount, 'claim')} · ${documentCount} ${pluralize(documentCount, 'document')}`,
  }
}

export function newsClusterEvidenceTarget(block: NewsClusterBlock): NewsClusterEvidenceTarget {
  newsClusterSupportSummary(block)
  return {
    clusterId: block.cluster_id,
    claimIds: block.claim_refs,
    documentIds: block.document_refs,
    bundleInput: { claim_ids: block.claim_refs },
  }
}

export function socialSeriesSummary(block: SocialSeriesBlock): SocialSeriesSummary {
  const points = block.series.flatMap((series) => series.points)
  const latest = latestPoint(points)
  if (block.kind === 'sentiment_trend') {
    return {
      kind: block.kind,
      latestLabel: 'Latest sentiment',
      latestValue: latest === null ? '—' : formatSigned(latest.y),
      pointCount: points.length,
      total: null,
    }
  }

  const total = points.reduce((sum, point) => sum + point.y, 0)
  const latestTotal = block.series.reduce((sum, series) => {
    const latestSeriesPoint = latestPoint(series.points)
    return sum + (latestSeriesPoint?.y ?? 0)
  }, 0)
  return {
    kind: block.kind,
    latestLabel: 'Latest mentions',
    latestValue: points.length === 0 ? '—' : formatInteger(latestTotal),
    pointCount: points.length,
    total,
  }
}

export function seriesCacheContract(block: SocialSeriesBlock): SeriesCacheContract {
  return {
    seriesRefs: seriesRefsFromParams(block.data_ref.params),
    allowedRanges: block.interactive?.ranges ?? [],
    allowedIntervals: block.interactive?.intervals ?? [],
    allowedTransforms: block.interactive?.allowed_transforms ?? {},
    rangeEndMax: block.interactive?.range_end_max ?? null,
    hoverDetails: block.interactive?.hover_details ?? false,
  }
}

function seriesRefsFromParams(params: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  const refs = params?.series_refs
  if (Array.isArray(refs)) {
    return Object.freeze(refs.filter((ref): ref is string => typeof ref === 'string'))
  }
  const ref = params?.series_ref
  return typeof ref === 'string' ? Object.freeze([ref]) : Object.freeze([])
}

function latestPoint(points: ReadonlyArray<{ x: string | number; y: number }>) {
  return points.length === 0 ? null : points[points.length - 1]
}

function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`
}
