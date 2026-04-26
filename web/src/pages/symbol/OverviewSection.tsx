import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { FetchStateView } from '../../symbol/FetchStateView.tsx'
import { useFetched } from '../../symbol/useFetched.ts'
import {
  fetchIssuerProfile,
  issuerIdFromSubject,
  profileBelongsToIssuer,
  type IssuerProfile,
  type IssuerProfileExchange,
} from '../../symbol/profile.ts'
import {
  fetchKeyStats,
  formatStatValue,
  statLabel,
  statsBelongToIssuer,
  type KeyStat,
  type KeyStatKey,
  type KeyStatsEnvelope,
} from '../../symbol/stats.ts'
import { listingIdForQuote } from '../../symbol/quote.ts'
import {
  fetchSeries,
  recentDailyQuery,
  singleListingOutcome,
  type NormalizedBar,
} from '../../symbol/series.ts'

const STAT_ORDER: ReadonlyArray<KeyStatKey> = [
  'gross_margin',
  'operating_margin',
  'net_margin',
  'revenue_growth_yoy',
  'pe_ratio',
]

export function OverviewSection() {
  const { subject } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)
  const listingId = listingIdForQuote(subject)

  const profile = useFetched<IssuerProfile>(issuerId, async (id, signal) => {
    const data = await fetchIssuerProfile(id, { signal })
    if (!profileBelongsToIssuer(data, id)) {
      return { kind: 'unavailable', reason: 'profile response did not match requested issuer' }
    }
    return { kind: 'ready', data }
  })

  const stats = useFetched<KeyStatsEnvelope>(issuerId, async (id, signal) => {
    const data = await fetchKeyStats(id, { signal })
    if (!statsBelongToIssuer(data, id)) {
      return { kind: 'unavailable', reason: 'stats response did not match requested issuer' }
    }
    return { kind: 'ready', data }
  })

  const series = useFetched<NormalizedBar[]>(listingId, async (id, signal) => {
    const response = await fetchSeries(recentDailyQuery(id), { signal })
    const outcome = singleListingOutcome(response, id)
    if (outcome === null) {
      return { kind: 'unavailable', reason: 'series response did not include this listing' }
    }
    if (outcome.outcome === 'unavailable') {
      return { kind: 'unavailable', reason: outcome.detail ?? outcome.reason }
    }
    return { kind: 'ready', data: outcome.data.bars }
  })

  return (
    <div
      data-testid="section-overview"
      className="flex w-full flex-col gap-6 p-8"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <Card testId="overview-profile" headingId="overview-profile-heading" heading="Company profile">
          <FetchStateView
            state={profile}
            noun="profile"
            idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load the company profile."
          >
            {(data) => <ProfileBody profile={data} />}
          </FetchStateView>
        </Card>
        <Card testId="overview-performance" headingId="overview-performance-heading" heading="Performance · 30d">
          <FetchStateView
            state={series}
            noun="series"
            idleMessage="No listing context for this subject."
          >
            {(bars) =>
              bars.length < 2 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Not enough bars in the requested range to draw a line.
                </p>
              ) : (
                <Sparkline bars={bars} />
              )
            }
          </FetchStateView>
        </Card>
      </div>
      <Card testId="overview-key-stats" headingId="overview-key-stats-heading" heading="Key stats">
        <FetchStateView
          state={stats}
          noun="key stats"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load key stats."
        >
          {(envelope) => <KeyStatsBody envelope={envelope} />}
        </FetchStateView>
      </Card>
    </div>
  )
}

function ProfileBody({ profile }: { profile: IssuerProfile }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <ProfileRow label="Legal name" value={profile.legal_name} />
      {profile.sector && <ProfileRow label="Sector" value={profile.sector} />}
      {profile.industry && <ProfileRow label="Industry" value={profile.industry} />}
      {profile.domicile && <ProfileRow label="Domicile" value={profile.domicile} />}
      {profile.cik && <ProfileRow label="CIK" value={profile.cik} mono />}
      {profile.lei && <ProfileRow label="LEI" value={profile.lei} mono />}
      {profile.exchanges.length > 0 && (
        <div className="sm:col-span-2">
          <ProfileLabel>Listed on</ProfileLabel>
          <ul className="mt-1 flex flex-wrap gap-2">
            {profile.exchanges.map((exchange) => (
              <ExchangeBadge key={exchange.listing.id} exchange={exchange} />
            ))}
          </ul>
        </div>
      )}
      {profile.former_names.length > 0 && (
        <div className="sm:col-span-2">
          <ProfileLabel>Former names</ProfileLabel>
          <p className="mt-1 text-neutral-700 dark:text-neutral-200">{profile.former_names.join(', ')}</p>
        </div>
      )}
    </dl>
  )
}

function ProfileRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <ProfileLabel>{label}</ProfileLabel>
      <dd
        className={
          mono
            ? 'mt-0.5 font-mono text-xs text-neutral-700 dark:text-neutral-200'
            : 'mt-0.5 text-neutral-700 dark:text-neutral-200'
        }
      >
        {value}
      </dd>
    </div>
  )
}

function ProfileLabel({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
      {children}
    </dt>
  )
}

function ExchangeBadge({ exchange }: { exchange: IssuerProfileExchange }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">
      <span className="font-medium">{exchange.ticker}</span>
      <span className="text-neutral-500 dark:text-neutral-400">·</span>
      <span>{exchange.mic}</span>
      <span className="text-neutral-500 dark:text-neutral-400">·</span>
      <span>{exchange.trading_currency}</span>
    </li>
  )
}

function Sparkline({ bars }: { bars: NormalizedBar[] }) {
  const width = 320
  const height = 80
  const padX = 4
  const padY = 6
  const closes = bars.map((b) => b.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || 1
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  const points = bars.map((bar, i) => {
    const x = padX + (i / (bars.length - 1)) * innerW
    const y = padY + (1 - (bar.close - min) / span) * innerH
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const path = `M ${points.join(' L ')}`
  const first = bars[0].close
  const last = bars[bars.length - 1].close
  const trendClass =
    last > first
      ? 'stroke-emerald-600 dark:stroke-emerald-400'
      : last < first
        ? 'stroke-red-600 dark:stroke-red-400'
        : 'stroke-neutral-500'
  return (
    <div className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label={`30-day price line from ${formatPrice(first)} to ${formatPrice(last)}`}
        viewBox={`0 0 ${width} ${height}`}
        className="h-20 w-full"
        preserveAspectRatio="none"
      >
        <path d={path} fill="none" strokeWidth={1.5} className={trendClass} />
      </svg>
      <div className="flex items-center justify-between text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
        <span>{formatPrice(first)}</span>
        <span>{bars.length} bars</span>
        <span>{formatPrice(last)}</span>
      </div>
    </div>
  )
}

function formatPrice(value: number): string {
  return value.toFixed(2)
}

function KeyStatsBody({ envelope }: { envelope: KeyStatsEnvelope }) {
  const byKey = new Map(envelope.stats.map((s) => [s.stat_key, s] as const))
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STAT_ORDER.map((key) => {
          const stat = byKey.get(key)
          return stat ? (
            <KeyStatTile key={key} stat={stat} />
          ) : (
            <KeyStatMissingTile key={key} statKey={key} />
          )
        })}
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        FY{envelope.fiscal_year} {envelope.fiscal_period} · {envelope.basis.replaceAll('_', ' ')} ·{' '}
        {envelope.reporting_currency}
      </p>
    </div>
  )
}

function KeyStatTile({ stat }: { stat: KeyStat }) {
  const hasWarning = stat.warnings.length > 0
  const warningSummary = hasWarning ? stat.warnings.map((w) => w.message).join('\n') : undefined
  return (
    <div
      data-testid={`key-stat-${stat.stat_key}`}
      className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {statLabel(stat.stat_key)}
      </span>
      <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {formatStatValue(stat)}
      </span>
      {hasWarning && (
        <span
          title={warningSummary}
          className="text-xs text-amber-700 dark:text-amber-400"
        >
          {stat.warnings.length} warning{stat.warnings.length === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}

function KeyStatMissingTile({ statKey }: { statKey: KeyStatKey }) {
  return (
    <div
      data-testid={`key-stat-${statKey}`}
      className="flex flex-col gap-1 rounded-md border border-dashed border-neutral-200 bg-white p-3 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
    >
      <span className="text-xs uppercase tracking-wide">{statLabel(statKey)}</span>
      <span className="text-lg font-semibold tabular-nums">—</span>
    </div>
  )
}

