// `signals` is the symbol-detail bucket for community sentiment, news pulse,
// and future alt-data. The route name is intentionally vendor-agnostic:
// Reddit-/news-/alt-data content composes evidence-backed blocks here rather
// than living under a source-specific shell.

import type {
  Block,
  MentionVolumeBlock,
  NewsClusterBlock,
  SentimentTrendBlock,
} from '../blocks/types.ts'
import type { SubjectRef } from './search.ts'

export const SIGNALS_BLOCK_KINDS = ['sentiment_trend', 'mention_volume', 'news_cluster'] as const
export type SignalsBlockKind = (typeof SIGNALS_BLOCK_KINDS)[number]

export const EVIDENCE_SOURCE_KINDS = ['community', 'news', 'filing'] as const
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number]

export const SENTIMENT_WINDOW_DAYS = 30
const SIGNALS_RANGES = ['7D', '30D'] as const
const SIGNALS_INTERVALS = ['1d'] as const

export type EvidenceMix = Readonly<Record<EvidenceSourceKind, number>>

export type SignalsEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'signals'
  blocks: ReadonlyArray<SentimentTrendBlock | MentionVolumeBlock | NewsClusterBlock>
  sentiment_trend: SentimentTrendBlock
  mention_volume: MentionVolumeBlock
  news_clusters: ReadonlyArray<NewsClusterBlock>
  as_of: string
}

const PLACEHOLDER_SNAPSHOT_ID = '00000000-0000-4000-a000-00000000000a'
const PLACEHOLDER_SOURCE_REFS: ReadonlyArray<string> = Object.freeze([
  '00000000-0000-4000-a000-000000000010',
])
const PLACEHOLDER_AS_OF = '2024-11-01T20:30:00.000Z'
const FIXTURE_DOC_REFS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
] as const

export function loadSignalsFixture(issuerId: string): SignalsEnvelope {
  const subject = { kind: 'issuer' as const, id: issuerId }
  const sentiment_trend = sentimentTrendBlock(subject)
  const mention_volume = mentionVolumeBlock(subject)
  const news_clusters = deriveNewsClusters(subject)
  const blocks = Object.freeze([
    sentiment_trend,
    mention_volume,
    ...news_clusters,
  ] satisfies ReadonlyArray<Block>) as SignalsEnvelope['blocks']

  return {
    subject,
    family: 'signals',
    blocks,
    sentiment_trend,
    mention_volume,
    news_clusters,
    as_of: PLACEHOLDER_AS_OF,
  }
}

function sentimentTrendBlock(subject: SubjectRef & { kind: 'issuer' }): SentimentTrendBlock {
  return {
    id: `sentiment-trend-${subject.id}`,
    kind: 'sentiment_trend',
    snapshot_id: PLACEHOLDER_SNAPSHOT_ID,
    data_ref: {
      kind: 'sentiment_series',
      id: `sentiment:${subject.id}`,
      params: { series_refs: [deterministicUuid(subject.id, 'sentiment-series')] },
    },
    source_refs: PLACEHOLDER_SOURCE_REFS,
    as_of: PLACEHOLDER_AS_OF,
    title: `Sentiment trend · ${SENTIMENT_WINDOW_DAYS}d`,
    interactive: signalSeriesInteractive(),
    series: [
      {
        name: 'Sentiment',
        points: deriveSentimentSeries(subject.id, SENTIMENT_WINDOW_DAYS).map((point) => ({
          x: point.date,
          y: point.sentiment_score,
        })),
      },
    ],
  }
}

function mentionVolumeBlock(subject: SubjectRef & { kind: 'issuer' }): MentionVolumeBlock {
  const points = deriveSentimentSeries(subject.id, SENTIMENT_WINDOW_DAYS)
  return {
    id: `mention-volume-${subject.id}`,
    kind: 'mention_volume',
    snapshot_id: PLACEHOLDER_SNAPSHOT_ID,
    data_ref: {
      kind: 'mention_volume_series',
      id: `mention-volume:${subject.id}`,
      params: {
        series_refs: [
          deterministicUuid(subject.id, 'mention-community-series'),
          deterministicUuid(subject.id, 'mention-news-series'),
        ],
      },
    },
    source_refs: PLACEHOLDER_SOURCE_REFS,
    as_of: PLACEHOLDER_AS_OF,
    title: `Mention volume · ${SENTIMENT_WINDOW_DAYS}d`,
    interactive: signalSeriesInteractive(),
    series: [
      {
        name: 'Community',
        points: points.map((point) => ({ x: point.date, y: point.mention_count })),
      },
      {
        name: 'News',
        points: points.map((point, index) => ({
          x: point.date,
          y: Math.max(0, Math.round(point.mention_count * (0.2 + (index % 4) * 0.03))),
        })),
      },
    ],
  }
}

function signalSeriesInteractive() {
  return {
    ranges: SIGNALS_RANGES,
    intervals: SIGNALS_INTERVALS,
    allowed_transforms: {
      series: SIGNALS_RANGES.map((range) => ({
        range: signalRangeWindow(range),
        interval: SIGNALS_INTERVALS[0],
      })),
    },
    range_end_max: PLACEHOLDER_AS_OF,
    hover_details: true,
  }
}

function signalRangeWindow(range: (typeof SIGNALS_RANGES)[number]): Readonly<Record<string, string>> {
  const days = range === '7D' ? 7 : 30
  const end = new Date(PLACEHOLDER_AS_OF).getTime()
  return Object.freeze({
    start: new Date(end - days * ONE_DAY_MS).toISOString(),
    end: PLACEHOLDER_AS_OF,
  })
}

type SentimentPoint = {
  date: string
  sentiment_score: number
  mention_count: number
}

const SENTIMENT_FIXTURE_END = Date.UTC(2024, 9, 31)
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function deriveSentimentSeries(issuerId: string, days: number): ReadonlyArray<SentimentPoint> {
  const seedA = hashSeed(issuerId, 'sentiment-amp')
  const seedB = hashSeed(issuerId, 'sentiment-phase')
  const seedV = hashSeed(issuerId, 'volume')
  const baseScore = ((seedA % 60) - 30) / 100
  const phase = (seedB % 360) * (Math.PI / 180)
  const baseVolume = 800 + (seedV % 1200)

  const points: SentimentPoint[] = []
  for (let i = 0; i < days; i++) {
    const dayIndex = days - 1 - i
    const t = i / Math.max(1, days - 1)
    const wave = Math.sin(phase + i * 0.42) * 0.18
    const drift = (t - 0.5) * 0.25
    const score = clamp(baseScore + wave + drift, -1, 1)
    const volumeWave = 1 + Math.sin(phase + i * 0.28) * 0.35
    const date = new Date(SENTIMENT_FIXTURE_END - dayIndex * ONE_DAY_MS)
      .toISOString()
      .slice(0, 10)
    points.push({
      date,
      sentiment_score: round(score, 3),
      mention_count: Math.max(0, Math.round(baseVolume * volumeWave)),
    })
  }
  return Object.freeze(points)
}

const CLUSTER_TEMPLATES: ReadonlyArray<{
  headline: string
  evidence_mix: EvidenceMix
}> = [
  {
    headline: 'Services revenue mix continues to expand and supports gross-margin expansion.',
    evidence_mix: { community: 12, news: 9, filing: 2 },
  },
  {
    headline: 'China demand softness flagged as a near-term unit-volume risk for the next quarter.',
    evidence_mix: { community: 18, news: 14, filing: 1 },
  },
  {
    headline: 'AI feature roadmap positioned as a multi-year cycle catalyst for unit upgrades.',
    evidence_mix: { community: 27, news: 7, filing: 0 },
  },
  {
    headline: 'Capital-return cadence viewed as steady but unsurprising.',
    evidence_mix: { community: 8, news: 4, filing: 1 },
  },
]

function deriveNewsClusters(subject: SubjectRef & { kind: 'issuer' }): ReadonlyArray<NewsClusterBlock> {
  const offset = hashSeed(subject.id, 'cluster-offset') % CLUSTER_TEMPLATES.length
  const ordered = [
    ...CLUSTER_TEMPLATES.slice(offset),
    ...CLUSTER_TEMPLATES.slice(0, offset),
  ].slice(0, 2)

  return Object.freeze(
    ordered.map((template, index) => ({
      id: `news-cluster-${subject.id}-${index}`,
      kind: 'news_cluster' as const,
      snapshot_id: PLACEHOLDER_SNAPSHOT_ID,
      data_ref: {
        kind: 'claim_cluster',
        id: deterministicUuid(subject.id, `cluster-${index}`),
        params: { evidence_bundle: { claim_ids: claimRefs(subject.id, index) } },
      },
      source_refs: PLACEHOLDER_SOURCE_REFS,
      as_of: PLACEHOLDER_AS_OF,
      title: 'News cluster',
      cluster_id: deterministicUuid(subject.id, `cluster-${index}`),
      headline: template.headline,
      claim_refs: claimRefs(subject.id, index),
      document_refs: documentRefs(index, template.evidence_mix),
    })),
  )
}

function claimRefs(issuerId: string, clusterIndex: number): readonly string[] {
  return Object.freeze([
    deterministicUuid(issuerId, `cluster-${clusterIndex}-claim-0`),
    deterministicUuid(issuerId, `cluster-${clusterIndex}-claim-1`),
  ])
}

function documentRefs(clusterIndex: number, mix: EvidenceMix): readonly string[] {
  const evidenceCount = totalEvidenceCount(mix)
  const refs = FIXTURE_DOC_REFS.slice(0, Math.min(FIXTURE_DOC_REFS.length, Math.max(1, evidenceCount % 4)))
  return Object.freeze(refs.map((ref, index) => deterministicUuid(ref, `cluster-${clusterIndex}-doc-${index}`)))
}

export function totalEvidenceCount(mix: EvidenceMix): number {
  return mix.community + mix.news + mix.filing
}

const SOURCE_KIND_LABELS: Readonly<Record<EvidenceSourceKind, string>> = {
  community: 'Community',
  news: 'News',
  filing: 'Filing',
}

export function sourceKindLabel(kind: EvidenceSourceKind): string {
  return SOURCE_KIND_LABELS[kind]
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function hashSeed(input: string, salt: string): number {
  let h = 0x811c9dc5
  const combined = `${salt}::${input}`
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

function deterministicUuid(input: string, salt: string): string {
  const a = hashSeed(input, `${salt}:a`).toString(16).padStart(8, '0')
  const b = hashSeed(input, `${salt}:b`).toString(16).padStart(8, '0')
  const c = hashSeed(input, `${salt}:c`).toString(16).padStart(8, '0')
  return `${a.slice(0, 8)}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(0, 3)}-${c.slice(3, 8)}${a.slice(0, 7)}`
}
