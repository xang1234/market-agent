// `signals` is the symbol-detail bucket for community sentiment, news pulse,
// and future alt-data. The route name is intentionally vendor-agnostic
// (spec §3.4.4) — Reddit-/news-/alt-data content composes evidence-backed
// blocks here rather than living under a source-specific shell.
//
// The real evidence + claim-clustering plane lives in P3; specialized social
// and news block renderers ship in P4.6. Until those land, this module
// returns deterministic dev-fixture data shaped like the eventual
// BlockRegistry contract (BaseBlock fields per spec §8.1) so the rendering
// layer stays stable when the upstream swap happens.

import type { SubjectRef } from './search.ts'

export type BaseBlock = {
  id: string
  snapshot_id: string
  data_ref: string
  source_refs: ReadonlyArray<string>
  as_of: string
}

export const SIGNALS_BLOCK_KINDS = ['sentiment_trend', 'claim_clusters'] as const
export type SignalsBlockKind = (typeof SIGNALS_BLOCK_KINDS)[number]

export const CLAIM_STANCES = ['bullish', 'bearish', 'neutral'] as const
export type ClaimStance = (typeof CLAIM_STANCES)[number]

export const EVIDENCE_SOURCE_KINDS = ['community', 'news', 'filing'] as const
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number]

export const SENTIMENT_WINDOW_DAYS = 30

export type SentimentPoint = {
  date: string
  sentiment_score: number
  mention_count: number
}

export type SentimentTrendBlock = BaseBlock & {
  kind: typeof SIGNALS_BLOCK_KINDS[0]
  subject: SubjectRef & { kind: 'issuer' }
  window_days: number
  points: ReadonlyArray<SentimentPoint>
}

export type EvidenceMix = Readonly<Record<EvidenceSourceKind, number>>

export type ClaimCluster = {
  cluster_id: string
  representative_claim: string
  stance: ClaimStance
  mention_count: number
  evidence_mix: EvidenceMix
  first_observed: string
  last_observed: string
}

export type ClaimClustersBlock = BaseBlock & {
  kind: typeof SIGNALS_BLOCK_KINDS[1]
  subject: SubjectRef & { kind: 'issuer' }
  clusters: ReadonlyArray<ClaimCluster>
}

export type SignalsEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'signals'
  sentiment_trend: SentimentTrendBlock
  claim_clusters: ClaimClustersBlock
  as_of: string
}

const PLACEHOLDER_SNAPSHOT_ID = '00000000-0000-4000-a000-00000000000a'
const PLACEHOLDER_DATA_REF = 'dev-fixture'
const PLACEHOLDER_SOURCE_REFS: ReadonlyArray<string> = Object.freeze([
  '00000000-0000-4000-a000-000000000010',
])
const PLACEHOLDER_AS_OF = '2024-11-01T20:30:00.000Z'

export function loadSignalsFixture(issuerId: string): SignalsEnvelope {
  const subject = { kind: 'issuer' as const, id: issuerId }
  return {
    subject,
    family: 'signals',
    sentiment_trend: {
      id: `sentiment-trend-${issuerId}`,
      kind: SIGNALS_BLOCK_KINDS[0],
      subject,
      snapshot_id: PLACEHOLDER_SNAPSHOT_ID,
      data_ref: PLACEHOLDER_DATA_REF,
      source_refs: PLACEHOLDER_SOURCE_REFS,
      as_of: PLACEHOLDER_AS_OF,
      window_days: SENTIMENT_WINDOW_DAYS,
      points: deriveSentimentSeries(issuerId, SENTIMENT_WINDOW_DAYS),
    },
    claim_clusters: {
      id: `claim-clusters-${issuerId}`,
      kind: SIGNALS_BLOCK_KINDS[1],
      subject,
      snapshot_id: PLACEHOLDER_SNAPSHOT_ID,
      data_ref: PLACEHOLDER_DATA_REF,
      source_refs: PLACEHOLDER_SOURCE_REFS,
      as_of: PLACEHOLDER_AS_OF,
      clusters: deriveClaimClusters(issuerId),
    },
    as_of: PLACEHOLDER_AS_OF,
  }
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
  representative_claim: string
  stance: ClaimStance
  evidence_mix: EvidenceMix
  daysAgoFirst: number
  daysAgoLast: number
}> = [
  {
    representative_claim:
      'Services revenue mix continues to expand and supports gross-margin expansion.',
    stance: 'bullish',
    evidence_mix: { community: 12, news: 9, filing: 2 },
    daysAgoFirst: 26,
    daysAgoLast: 2,
  },
  {
    representative_claim:
      'China demand softness flagged as a near-term unit-volume risk for the next quarter.',
    stance: 'bearish',
    evidence_mix: { community: 18, news: 14, filing: 1 },
    daysAgoFirst: 21,
    daysAgoLast: 4,
  },
  {
    representative_claim:
      'AI feature roadmap positioned as a multi-year cycle catalyst for unit upgrades.',
    stance: 'bullish',
    evidence_mix: { community: 27, news: 7, filing: 0 },
    daysAgoFirst: 18,
    daysAgoLast: 1,
  },
  {
    representative_claim:
      'Insider selling cadence drawing scrutiny in retail discussion despite scheduled-plan disclosures.',
    stance: 'bearish',
    evidence_mix: { community: 22, news: 3, filing: 6 },
    daysAgoFirst: 14,
    daysAgoLast: 3,
  },
  {
    representative_claim:
      'Capital-return cadence (buybacks + dividend) viewed as steady but unsurprising.',
    stance: 'neutral',
    evidence_mix: { community: 8, news: 4, filing: 1 },
    daysAgoFirst: 30,
    daysAgoLast: 6,
  },
]

function deriveClaimClusters(issuerId: string): ReadonlyArray<ClaimCluster> {
  const offset = hashSeed(issuerId, 'cluster-offset') % CLUSTER_TEMPLATES.length
  const ordered = [
    ...CLUSTER_TEMPLATES.slice(offset),
    ...CLUSTER_TEMPLATES.slice(0, offset),
  ]
  const clusters: ClaimCluster[] = ordered.map((template, i) => {
    const totalEvidence =
      template.evidence_mix.community + template.evidence_mix.news + template.evidence_mix.filing
    return {
      cluster_id: `${issuerId}-cluster-${i}`,
      representative_claim: template.representative_claim,
      stance: template.stance,
      mention_count: totalEvidence * 4 + (hashSeed(issuerId, `cluster-${i}-mentions`) % 30),
      evidence_mix: template.evidence_mix,
      first_observed: daysAgo(template.daysAgoFirst),
      last_observed: daysAgo(template.daysAgoLast),
    }
  })
  clusters.sort((a, b) => b.last_observed.localeCompare(a.last_observed))
  return Object.freeze(clusters)
}

export function totalEvidenceCount(mix: EvidenceMix): number {
  return mix.community + mix.news + mix.filing
}

const STANCE_LABELS: Readonly<Record<ClaimStance, string>> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral',
}

export function stanceLabel(stance: ClaimStance): string {
  return STANCE_LABELS[stance]
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

function daysAgo(n: number): string {
  return new Date(SENTIMENT_FIXTURE_END - n * ONE_DAY_MS).toISOString().slice(0, 10)
}

// FNV-1a-style hash so per-issuer fixtures are stable across reloads but
// distinct per issuer. Keeps the dev surface deterministic without a real
// data source while mirroring how a real signals service would key its
// envelopes by canonical issuer id.
function hashSeed(input: string, salt: string): number {
  let h = 0x811c9dc5
  const combined = `${salt}::${input}`
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}
