// Shared analyst-consensus + price-target views. Extracted from EarningsSection
// so the Overview (the symbol's landing tab) can surface the same rating
// distribution and price-target range the Earnings tab shows — matching the
// reference design, where consensus and target sit on the main symbol view.
// Both surfaces fetch the same AnalystConsensusEnvelope; only the framing card
// differs.

import {
  ANALYST_RATINGS,
  RATING_BAR_COLORS,
  ratingLabel,
  type AnalystConsensusEnvelope,
  type ConsensusEstimate,
  type PriceTarget,
  type RatingDistribution,
} from './consensus.ts'
import { currencyPrefix, formatCompactDollars, formatCurrency2 } from './format.ts'
import { StackedBar } from './StackedBar.tsx'

export function ConsensusBody({ envelope }: { envelope: AnalystConsensusEnvelope }) {
  return (
    <div className="flex flex-col gap-4">
      {envelope.rating_distribution ? (
        <RatingDistributionBar
          distribution={envelope.rating_distribution}
          analystCount={envelope.analyst_count}
        />
      ) : (
        <p className="text-sm text-muted">No rating distribution available.</p>
      )}
      {envelope.estimates.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {envelope.estimates.map((estimate) => (
            <EstimateRow
              key={`${estimate.metric_key}-${estimate.fiscal_year}-${estimate.fiscal_period}`}
              estimate={estimate}
            />
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
  // total is the width denominator; a non-positive total (malformed payload)
  // would produce NaN widths and a "0 contributors" label, so bail to the same
  // fallback the null-distribution case uses.
  if (total <= 0) {
    return <p className="text-sm text-muted">No rating distribution available.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <StackedBar
        ariaLabel={`Analyst ratings across ${total} contributors`}
        heightClass="h-3"
        segments={ANALYST_RATINGS.map((rating) => ({
          key: rating,
          value: distribution.counts[rating],
          className: RATING_BAR_COLORS[rating],
          testId: `rating-segment-${rating}`,
          title: `${ratingLabel(rating)}: ${distribution.counts[rating]}`,
        }))}
      />
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
                  ? 'flex items-center gap-1.5 text-faint'
                  : 'flex items-center gap-1.5 text-fg-soft'
              }
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 rounded-sm ${muted ? 'bg-neutral-300 dark:bg-neutral-700' : RATING_BAR_COLORS[rating]}`}
              />
              <span className="flex-1">{ratingLabel(rating)}</span>
              <span className="num">{count}</span>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted">
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
      <span className="text-fg-soft">
        {estimate.metric_key.replaceAll('_', ' ')} · FY{estimate.fiscal_year} {estimate.fiscal_period}
      </span>
      <span className="num text-fg">{formatEstimateValue(estimate)}</span>
    </li>
  )
}

function formatEstimateValue(estimate: ConsensusEstimate): string {
  const prefix = currencyPrefix(estimate.currency ?? '')
  if (estimate.unit === 'currency_per_share') return `${prefix}${estimate.mean.toFixed(2)}`
  if (estimate.unit === 'currency') return `${prefix}${formatCompactDollars(estimate.mean)}`
  return estimate.mean.toFixed(2)
}

export function PriceTargetBody({ target }: { target: PriceTarget }) {
  const span = target.high - target.low || 1
  // Provider data can put mean/median outside [low, high]; clamp so the markers
  // stay on the visible track instead of overflowing it.
  const clamp = (pct: number) => Math.min(100, Math.max(0, pct))
  const meanPct = clamp(((target.mean - target.low) / span) * 100)
  const medianPct = clamp(((target.median - target.low) / span) * 100)
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <PriceRow label="Low" value={formatCurrency2(target.low, target.currency)} />
        <PriceRow label="High" value={formatCurrency2(target.high, target.currency)} />
        <PriceRow label="Mean" value={formatCurrency2(target.mean, target.currency)} emphasis />
        <PriceRow label="Median" value={formatCurrency2(target.median, target.currency)} />
      </dl>
      <div className="relative h-2 rounded bg-surface-2">
        <span
          aria-hidden="true"
          data-testid="price-target-mean-marker"
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-accent"
          style={{ left: `${meanPct}%` }}
        />
        <span
          aria-hidden="true"
          data-testid="price-target-median-marker"
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-fg"
          style={{ left: `${medianPct}%` }}
        />
      </div>
      <p className="text-xs text-muted">{target.contributor_count} contributors</p>
    </div>
  )
}

function PriceRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={emphasis ? 'text-right font-semibold num text-fg' : 'text-right num text-fg'}>
        {value}
      </dd>
    </>
  )
}
