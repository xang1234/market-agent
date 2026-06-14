import { useEffect, useMemo, useState } from 'react'
import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { CARD_CLASS } from '../../symbol/surfaceStyles.ts'
import { formatCompactNumber } from '../../symbol/format.ts'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import {
  EVIDENCE_SOURCE_KINDS,
  SIGNALS_FIXTURE_AS_OF,
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
  ThemeMembershipRationaleList,
  type ThemeMembershipRationaleView,
} from '../../symbol/ThemeMembershipRationaleList.tsx'
import {
  NEGATIVE_CLASS,
  NEUTRAL_CLASS,
  POSITIVE_CLASS,
  signedDirection,
  type SignedDirection,
} from '../../symbol/signedColor.ts'
import { Sparkline } from '../../symbol/Sparkline.tsx'
import { fetchThemeMembershipRationales } from '../../symbol/themeRationale.ts'
import { SECTION_STACK_CLASS } from './sectionLayout.ts'

const PLACEHOLDER_CLASS = 'text-sm text-muted'

// Sentiment scores in (-NEUTRAL_BAND, +NEUTRAL_BAND) read as effectively flat.
const NEUTRAL_BAND = 0.05

const SCORE_TEXT_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: POSITIVE_CLASS,
  negative: NEGATIVE_CLASS,
  neutral: NEUTRAL_CLASS,
}

const SCORE_STROKE_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: 'stroke-positive',
  negative: 'stroke-negative',
  neutral: 'stroke-muted',
}

const SCORE_FILL_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: 'fill-positive/15',
  negative: 'fill-negative/15',
  neutral: 'fill-muted/10',
}

const STANCE_BADGE_CLASS: Readonly<Record<ClaimStance, string>> = {
  bullish:
    'bg-positive-soft text-positive border-positive/40',
  bearish:
    'bg-negative-soft text-negative border-negative/40',
  neutral:
    'bg-surface-2 text-fg border-line',
}

const SOURCE_KIND_DOT_CLASS: Readonly<Record<EvidenceSourceKind, string>> = {
  community: 'bg-violet-500',
  news: 'bg-accent',
  filing: 'bg-warning',
}

type ThemeRationaleState =
  | { status: 'loading'; memberships: ReadonlyArray<ThemeMembershipRationaleView> }
  | { status: 'loaded'; memberships: ReadonlyArray<ThemeMembershipRationaleView> }
  | { status: 'error'; memberships: ReadonlyArray<ThemeMembershipRationaleView> }

function ThemeRationaleLoader({ issuerId }: { issuerId: string }) {
  const [themeRationaleState, setThemeRationaleState] = useState<ThemeRationaleState>({
    status: 'loading',
    memberships: [],
  })

  useEffect(() => {
    const controller = new AbortController()
    fetchThemeMembershipRationales(
      { kind: 'issuer', id: issuerId },
      { signal: controller.signal, limit: 8 },
    )
      .then((response) => {
        setThemeRationaleState({ status: 'loaded', memberships: response.memberships })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setThemeRationaleState({ status: 'error', memberships: [] })
      })

    return () => controller.abort()
  }, [issuerId])

  return <ThemeRationaleBody state={themeRationaleState} />
}

function ThemeRationaleCard({ issuerId }: { issuerId: string | null }) {
  return (
    <Card
      testId="signals-theme-rationale"
      headingId="signals-theme-rationale-heading"
      heading="Theme rationale"
    >
      {issuerId === null ? (
        <p className={PLACEHOLDER_CLASS}>Issuer context unavailable for theme rationale.</p>
      ) : (
        <ThemeRationaleLoader key={issuerId} issuerId={issuerId} />
      )}
    </Card>
  )
}

export function SignalsSection() {
  const { subject } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)
  const envelope = useMemo(
    () => (issuerId === null ? null : loadSignalsFixture(issuerId)),
    [issuerId],
  )

  return (
    <div data-testid="section-signals" className={SECTION_STACK_CLASS}>
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
      <ThemeRationaleCard issuerId={issuerId} />
      <p className={`${PLACEHOLDER_CLASS} px-1`} data-testid="signals-provenance-note">
        Static dev signals fixture as of {SIGNALS_FIXTURE_AS_OF}; these sentiment and claim blocks
        are not live market data.
      </p>
    </div>
  )
}

function ThemeRationaleBody({
  state,
}: {
  state: ThemeRationaleState
}) {
  if (state.status === 'loading') {
    return <p className={PLACEHOLDER_CLASS}>Loading theme rationale...</p>
  }
  if (state.status === 'error') {
    return <p className={PLACEHOLDER_CLASS}>Theme rationale is unavailable.</p>
  }
  if (state.memberships.length === 0) {
    return <p className={PLACEHOLDER_CLASS}>No theme rationale is available for this issuer.</p>
  }
  return <ThemeMembershipRationaleList memberships={state.memberships} />
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
          <span className={`text-2xl font-semibold num ${SCORE_TEXT_CLASS[direction]}`}>
            {formatScore(latest.sentiment_score)}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className={`text-xs uppercase tracking-wide ${NEUTRAL_CLASS}`}>
            Mentions ({block.window_days}d)
          </span>
          <span className="text-lg font-semibold num text-fg">
            {formatCompactNumber(totalMentions)}
          </span>
        </div>
      </div>
      <Sparkline
        values={block.points.map((p) => p.sentiment_score)}
        ariaLabel={`${block.window_days}-day sentiment trend ending at ${formatScore(latest.sentiment_score)}`}
        trendStrokeClass={SCORE_STROKE_CLASS[direction]}
        areaFillClass={SCORE_FILL_CLASS[direction]}
        domain={[-1, 1]}
        baseline={0}
      />
      <div className={`flex items-center justify-between text-xs num ${NEUTRAL_CLASS}`}>
        <span>{earliest.date}</span>
        <span>{block.points.length} days</span>
        <span>{latest.date}</span>
      </div>
      <MentionVolumeBars points={block.points} />
    </div>
  )
}

// Per-day mention volume as compact vertical bars under the sentiment line —
// the "how loud" beside the "how positive". Heights are normalized to the
// busiest day in the window.
function MentionVolumeBars({ points }: { points: SentimentTrendBlock['points'] }) {
  const max = Math.max(1, ...points.map((p) => p.mention_count))
  return (
    <div className="flex flex-col gap-1" data-testid="mention-volume-bars">
      <span className={`text-[10px] uppercase tracking-wide ${NEUTRAL_CLASS}`}>Mention volume</span>
      <div className="flex h-8 items-end gap-0.5" aria-hidden="true">
        {points.map((point) => (
          <span
            key={point.date}
            title={`${point.date}: ${point.mention_count}`}
            className="flex-1 rounded-t-sm bg-accent/70"
            style={{ height: `${Math.max(4, (point.mention_count / max) * 100)}%` }}
          />
        ))}
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
      className={`flex flex-col gap-2 ${CARD_CLASS} p-3`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-fg">
          {cluster.representative_claim}
        </p>
        <StanceBadge stance={cluster.stance} />
      </div>
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs num ${NEUTRAL_CLASS}`}
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
          <span className="num text-fg">{mix[kind]}</span>
        </li>
      ))}
    </ul>
  )
}

function formatScore(score: number): string {
  const sign = score > 0 ? '+' : ''
  return `${sign}${score.toFixed(2)}`
}
