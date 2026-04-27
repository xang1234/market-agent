import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { FetchStateView } from '../../symbol/FetchStateView.tsx'
import {
  ANALYST_RATINGS,
  consensusBelongsToIssuer,
  fetchConsensus,
  ratingLabel,
  type AnalystConsensusEnvelope,
  type AnalystRating,
  type ConsensusEstimate,
  type PriceTarget,
  type RatingDistribution,
} from '../../symbol/consensus.ts'
import {
  earningsBelongToIssuer,
  fetchEarnings,
  type EarningsEvent,
  type EarningsEventsEnvelope,
  type EarningsSurpriseDirection,
} from '../../symbol/earnings.ts'
import { currencyPrefix, formatCompactDollars, formatCurrency2 } from '../../symbol/format.ts'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import { Th } from '../../symbol/Th.tsx'
import { useFetched } from '../../symbol/useFetched.ts'

export function EarningsSection() {
  const { subject } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)

  const earnings = useFetched<EarningsEventsEnvelope>(issuerId, async (id, signal) => {
    const data = await fetchEarnings(id, { signal })
    if (!earningsBelongToIssuer(data, id)) {
      return { kind: 'unavailable', reason: 'earnings response did not match requested issuer' }
    }
    return { kind: 'ready', data }
  })

  const consensus = useFetched<AnalystConsensusEnvelope>(issuerId, async (id, signal) => {
    const data = await fetchConsensus(id, { signal })
    if (!consensusBelongsToIssuer(data, id)) {
      return { kind: 'unavailable', reason: 'consensus response did not match requested issuer' }
    }
    return { kind: 'ready', data }
  })

  return (
    <div data-testid="section-earnings" className="flex w-full flex-col gap-6 p-8">
      <Card
        testId="earnings-chronology"
        headingId="earnings-chronology-heading"
        heading="Earnings · last 8 quarters"
      >
        <FetchStateView
          state={earnings}
          noun="earnings history"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load earnings."
        >
          {(envelope) => <EarningsTable envelope={envelope} />}
        </FetchStateView>
      </Card>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <Card
          testId="earnings-consensus"
          headingId="earnings-consensus-heading"
          heading="Analyst consensus"
        >
          <FetchStateView
            state={consensus}
            noun="consensus"
            idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load consensus."
          >
            {(envelope) => <ConsensusBody envelope={envelope} />}
          </FetchStateView>
        </Card>
        <Card
          testId="earnings-target"
          headingId="earnings-target-heading"
          heading="Price target"
        >
          <FetchStateView
            state={consensus}
            noun="price target"
            idleMessage="Issuer context unavailable for this entry."
          >
            {(envelope) =>
              envelope.price_target ? (
                <PriceTargetBody target={envelope.price_target} />
              ) : (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No price target in this consensus envelope.
                </p>
              )
            }
          </FetchStateView>
        </Card>
      </div>
    </div>
  )
}

function EarningsTable({ envelope }: { envelope: EarningsEventsEnvelope }) {
  if (envelope.events.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">No earnings releases recorded.</p>
  }
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            <Th>Period</Th>
            <Th>Release</Th>
            <Th align="right">Estimate</Th>
            <Th align="right">Actual</Th>
            <Th align="right">Surprise</Th>
          </tr>
        </thead>
        <tbody>
          {envelope.events.map((event) => (
            <EarningsRow key={`${event.fiscal_year}-${event.fiscal_period}`} event={event} currency={envelope.currency} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SURPRISE_TEXT_CLASS: Readonly<Record<EarningsSurpriseDirection | 'unknown', string>> = {
  beat: 'text-emerald-700 dark:text-emerald-400',
  miss: 'text-red-700 dark:text-red-400',
  inline: 'text-neutral-500 dark:text-neutral-400',
  unknown: 'text-neutral-500 dark:text-neutral-400',
}

const SURPRISE_ARROW: Readonly<Record<EarningsSurpriseDirection, string>> = {
  beat: '▲',
  miss: '▼',
  inline: '·',
}

function EarningsRow({ event, currency }: { event: EarningsEvent; currency: string }) {
  const surpriseClass = SURPRISE_TEXT_CLASS[event.surprise_direction ?? 'unknown']
  return (
    <tr
      data-testid={`earnings-row-${event.fiscal_year}-${event.fiscal_period}`}
      className="border-t border-neutral-100 dark:border-neutral-800"
    >
      <td className="px-2 py-2 text-neutral-700 dark:text-neutral-200">
        FY{event.fiscal_year} {event.fiscal_period}
      </td>
      <td className="px-2 py-2 text-neutral-500 dark:text-neutral-400 tabular-nums">
        {event.release_date}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {formatEps(event.eps_estimate_at_release, currency)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {formatEps(event.eps_actual, currency)}
      </td>
      <td className={`px-2 py-2 text-right tabular-nums ${surpriseClass}`}>
        {formatSurprise(event.surprise_pct, event.surprise_direction)}
      </td>
    </tr>
  )
}

function formatEps(value: number | null, currency: string): string {
  if (value === null) return '—'
  return formatCurrency2(value, currency)
}

function formatSurprise(pct: number | null, direction: EarningsSurpriseDirection | null): string {
  if (pct === null) return '—'
  const arrow = direction ? SURPRISE_ARROW[direction] : '·'
  return `${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

const RATING_BAR_COLORS: Readonly<Record<AnalystRating, string>> = {
  strong_buy: 'bg-emerald-600 dark:bg-emerald-500',
  buy: 'bg-emerald-400 dark:bg-emerald-600',
  hold: 'bg-neutral-400 dark:bg-neutral-500',
  sell: 'bg-red-400 dark:bg-red-600',
  strong_sell: 'bg-red-600 dark:bg-red-500',
}

function ConsensusBody({ envelope }: { envelope: AnalystConsensusEnvelope }) {
  return (
    <div className="flex flex-col gap-4">
      {envelope.rating_distribution ? (
        <RatingDistributionBar distribution={envelope.rating_distribution} analystCount={envelope.analyst_count} />
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No rating distribution available.</p>
      )}
      {envelope.estimates.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {envelope.estimates.map((estimate) => (
            <EstimateRow key={`${estimate.metric_key}-${estimate.fiscal_year}-${estimate.fiscal_period}`} estimate={estimate} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RatingDistributionBar({
  distribution,
  analystCount,
}: {
  distribution: RatingDistribution
  analystCount: number
}) {
  const total = distribution.contributor_count
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Analyst ratings across ${total} contributors`}
        className="flex h-3 w-full overflow-hidden rounded"
      >
        {ANALYST_RATINGS.map((rating) => {
          const count = distribution.counts[rating]
          if (count === 0) return null
          const widthPct = (count / total) * 100
          return (
            <div
              key={rating}
              data-testid={`rating-segment-${rating}`}
              className={RATING_BAR_COLORS[rating]}
              style={{ width: `${widthPct}%` }}
              title={`${ratingLabel(rating)}: ${count}`}
            />
          )
        })}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {ANALYST_RATINGS.map((rating) => {
          const count = distribution.counts[rating]
          // Mute zero-count buckets so the legend matches the bar's
          // selectivity instead of showing an unused color swatch as if
          // it carried weight.
          const muted = count === 0
          return (
            <li
              key={rating}
              className={
                muted
                  ? 'flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500'
                  : 'flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300'
              }
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 rounded-sm ${muted ? 'bg-neutral-300 dark:bg-neutral-700' : RATING_BAR_COLORS[rating]}`}
              />
              <span className="flex-1">{ratingLabel(rating)}</span>
              <span className="tabular-nums">{count}</span>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {distribution.contributor_count} of {analystCount} analysts contributed.
      </p>
    </div>
  )
}

function EstimateRow({ estimate }: { estimate: ConsensusEstimate }) {
  return (
    <li
      data-testid={`estimate-${estimate.metric_key}-${estimate.fiscal_year}`}
      className="flex items-center justify-between gap-3"
    >
      <span className="text-neutral-600 dark:text-neutral-300">
        {estimate.metric_key.replaceAll('_', ' ')} · FY{estimate.fiscal_year} {estimate.fiscal_period}
      </span>
      <span className="tabular-nums text-neutral-700 dark:text-neutral-200">
        {formatEstimateValue(estimate)}
      </span>
    </li>
  )
}

function formatEstimateValue(estimate: ConsensusEstimate): string {
  const prefix = currencyPrefix(estimate.currency ?? '')
  if (estimate.unit === 'currency_per_share') return `${prefix}${estimate.mean.toFixed(2)}`
  if (estimate.unit === 'currency') return `${prefix}${formatCompactDollars(estimate.mean)}`
  return estimate.mean.toFixed(2)
}

function PriceTargetBody({ target }: { target: PriceTarget }) {
  const span = target.high - target.low || 1
  const meanPct = ((target.mean - target.low) / span) * 100
  const medianPct = ((target.median - target.low) / span) * 100
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <PriceRow label="Low" value={formatCurrency2(target.low, target.currency)} />
        <PriceRow label="High" value={formatCurrency2(target.high, target.currency)} />
        <PriceRow label="Mean" value={formatCurrency2(target.mean, target.currency)} emphasis />
        <PriceRow label="Median" value={formatCurrency2(target.median, target.currency)} />
      </dl>
      <div className="relative h-2 rounded bg-neutral-200 dark:bg-neutral-800">
        <span
          aria-hidden="true"
          data-testid="price-target-mean-marker"
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-blue-600 dark:bg-blue-400"
          style={{ left: `${meanPct}%` }}
        />
        <span
          aria-hidden="true"
          data-testid="price-target-median-marker"
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-neutral-500 dark:bg-neutral-300"
          style={{ left: `${medianPct}%` }}
        />
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {target.contributor_count} contributors
      </p>
    </div>
  )
}

function PriceRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd
        className={
          emphasis
            ? 'text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-100'
            : 'text-right tabular-nums text-neutral-700 dark:text-neutral-200'
        }
      >
        {value}
      </dd>
    </>
  )
}
