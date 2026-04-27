import { useMemo } from 'react'
import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { formatCompactNumber } from '../../symbol/format.ts'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import {
  EVIDENCE_SOURCE_KINDS,
  loadSignalsFixture,
  sourceKindLabel,
  stanceLabel,
  totalEvidenceCount,
  type ClaimCluster,
  type ClaimClustersBlock,
  type ClaimStance,
  type EvidenceSourceKind,
  type SentimentTrendBlock,
} from '../../symbol/signals.ts'
import {
  NEGATIVE_CLASS,
  NEUTRAL_CLASS,
  POSITIVE_CLASS,
  signedDirection,
  type SignedDirection,
} from '../../symbol/signedColor.ts'
import { Sparkline } from '../../symbol/Sparkline.tsx'

const PLACEHOLDER_CLASS = 'text-sm text-neutral-500 dark:text-neutral-400'

// Sentiment scores in (-NEUTRAL_BAND, +NEUTRAL_BAND) read as effectively flat.
const NEUTRAL_BAND = 0.05

const SCORE_TEXT_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: POSITIVE_CLASS,
  negative: NEGATIVE_CLASS,
  neutral: NEUTRAL_CLASS,
}

const SCORE_STROKE_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: 'stroke-emerald-600 dark:stroke-emerald-400',
  negative: 'stroke-red-600 dark:stroke-red-400',
  neutral: 'stroke-neutral-500',
}

const STANCE_BADGE_CLASS: Readonly<Record<ClaimStance, string>> = {
  bullish:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  bearish:
    'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-900',
  neutral:
    'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700',
}

const SOURCE_KIND_DOT_CLASS: Readonly<Record<EvidenceSourceKind, string>> = {
  community: 'bg-violet-500',
  news: 'bg-sky-500',
  filing: 'bg-amber-500',
}

export function SignalsSection() {
  const { subject } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)
  const envelope = useMemo(
    () => (issuerId === null ? null : loadSignalsFixture(issuerId)),
    [issuerId],
  )

  return (
    <div data-testid="section-signals" className="flex w-full flex-col gap-6 p-8">
      <Card
        testId="signals-sentiment-trend"
        headingId="signals-sentiment-trend-heading"
        heading={`Sentiment trend · ${envelope?.sentiment_trend.window_days ?? 30}d`}
      >
        {envelope ? (
          <SentimentTrendBody block={envelope.sentiment_trend} />
        ) : (
          <p className={PLACEHOLDER_CLASS}>
            Issuer context unavailable for this entry. Open this symbol from search to load
            signals.
          </p>
        )}
      </Card>
      <Card
        testId="signals-claim-clusters"
        headingId="signals-claim-clusters-heading"
        heading="Recent claim clusters"
      >
        {envelope ? (
          <ClaimClustersBody block={envelope.claim_clusters} />
        ) : (
          <p className={PLACEHOLDER_CLASS}>Issuer context unavailable for this entry.</p>
        )}
      </Card>
      <p className={`${PLACEHOLDER_CLASS} px-1`} data-testid="signals-provenance-note">
        Source-agnostic surface: community, news, and filing-derived evidence compose shared
        blocks. Real evidence-bundle wiring lands with the document/evidence plane (P3) and the
        specialized social/news block renderers (P4.6).
      </p>
    </div>
  )
}

function SentimentTrendBody({ block }: { block: SentimentTrendBlock }) {
  if (block.points.length < 2) {
    return <p className={PLACEHOLDER_CLASS}>Not enough sentiment observations to draw a trend.</p>
  }
  const latest = block.points[block.points.length - 1]
  const earliest = block.points[0]
  const totalMentions = block.points.reduce((sum, p) => sum + p.mention_count, 0)
  const direction = signedDirection(latest.sentiment_score, NEUTRAL_BAND)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col">
          <span className={`text-xs uppercase tracking-wide ${NEUTRAL_CLASS}`}>
            Latest score
          </span>
          <span className={`text-2xl font-semibold tabular-nums ${SCORE_TEXT_CLASS[direction]}`}>
            {formatScore(latest.sentiment_score)}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className={`text-xs uppercase tracking-wide ${NEUTRAL_CLASS}`}>
            Mentions ({block.window_days}d)
          </span>
          <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {formatCompactNumber(totalMentions)}
          </span>
        </div>
      </div>
      <Sparkline
        values={block.points.map((p) => p.sentiment_score)}
        ariaLabel={`${block.window_days}-day sentiment trend ending at ${formatScore(latest.sentiment_score)}`}
        trendStrokeClass={SCORE_STROKE_CLASS[direction]}
        domain={[-1, 1]}
        baseline={0}
      />
      <div className={`flex items-center justify-between text-xs tabular-nums ${NEUTRAL_CLASS}`}>
        <span>{earliest.date}</span>
        <span>{block.points.length} days</span>
        <span>{latest.date}</span>
      </div>
    </div>
  )
}

function ClaimClustersBody({ block }: { block: ClaimClustersBlock }) {
  if (block.clusters.length === 0) {
    return <p className={PLACEHOLDER_CLASS}>No active claim clusters in the current window.</p>
  }
  return (
    <ul className="flex flex-col gap-3">
      {block.clusters.map((cluster) => (
        <ClaimClusterRow key={cluster.cluster_id} cluster={cluster} />
      ))}
    </ul>
  )
}

function ClaimClusterRow({ cluster }: { cluster: ClaimCluster }) {
  const evidenceTotal = totalEvidenceCount(cluster.evidence_mix)
  return (
    <li
      data-testid={`claim-cluster-${cluster.cluster_id}`}
      className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-neutral-800 dark:text-neutral-100">
          {cluster.representative_claim}
        </p>
        <StanceBadge stance={cluster.stance} />
      </div>
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums ${NEUTRAL_CLASS}`}
      >
        <span>{cluster.mention_count.toLocaleString()} mentions</span>
        <span aria-hidden="true">·</span>
        <span>{evidenceTotal} evidence</span>
        <span aria-hidden="true">·</span>
        <span>
          {cluster.first_observed} → {cluster.last_observed}
        </span>
      </div>
      <EvidenceMixLegend mix={cluster.evidence_mix} />
    </li>
  )
}

function StanceBadge({ stance }: { stance: ClaimStance }) {
  return (
    <span
      data-testid={`stance-badge-${stance}`}
      className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${STANCE_BADGE_CLASS[stance]}`}
    >
      {stanceLabel(stance)}
    </span>
  )
}

function EvidenceMixLegend({ mix }: { mix: ClaimCluster['evidence_mix'] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {EVIDENCE_SOURCE_KINDS.map((kind) => (
        <li
          key={kind}
          className={`flex items-center gap-1.5 ${mix[kind] === 0 ? 'opacity-50' : ''}`}
        >
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-sm ${SOURCE_KIND_DOT_CLASS[kind]}`} />
          <span className={NEUTRAL_CLASS}>{sourceKindLabel(kind)}</span>
          <span className="tabular-nums text-neutral-700 dark:text-neutral-200">{mix[kind]}</span>
        </li>
      ))}
    </ul>
  )
}

function formatScore(score: number): string {
  const sign = score > 0 ? '+' : ''
  return `${sign}${score.toFixed(2)}`
}
