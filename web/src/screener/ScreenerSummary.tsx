import { useMemo } from 'react'
import { INSET_SURFACE_CLASS } from '../symbol/surfaceStyles.ts'
import { formatCompactCurrency } from '../symbol/format.ts'
import type { ScreenerResponse } from './contracts.ts'
import { screenerSummary, type Distribution } from './screenerSummary.ts'

// Charts-first lead for the results: a stat strip + a P/E distribution over the
// loaded rows — the shape of the basket a paginated table can't show. Stats are
// scoped to the rows on screen ("shown"); the full match count is total_count.
export function ScreenerSummaryView({ response }: { response: ScreenerResponse }) {
  const summary = useMemo(() => screenerSummary(response.rows), [response])
  const currency = response.rows[0]?.quote.currency ?? 'USD'
  return (
    <div className="flex flex-col gap-2 border-b border-line pb-3">
      <div className="flex flex-wrap gap-2">
        <SummaryStat label="Matches" value={String(response.total_count)} />
        <SummaryStat label="Median P/E" value={summary.medianPe === null ? '—' : summary.medianPe.toFixed(1)} />
        <SummaryStat
          label="Median cap"
          value={summary.medianMarketCap === null ? '—' : formatCompactCurrency(summary.medianMarketCap, currency)}
        />
        <SummaryStat
          label="Up (shown)"
          value={summary.upPct === null ? '—' : `${Math.round(summary.upPct)}%`}
          positive={summary.upPct !== null && summary.upPct >= 50}
        />
      </div>
      {summary.peDistribution.count >= 3 ? (
        <MetricDistribution dist={summary.peDistribution} label="P/E" />
      ) : null}
    </div>
  )
}

function SummaryStat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className={`min-w-[88px] flex-1 ${INSET_SURFACE_CLASS} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`num text-lg font-semibold ${positive ? 'text-positive' : 'text-fg'}`}>{value}</div>
    </div>
  )
}

function MetricDistribution({ dist, label }: { dist: Distribution; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted">
        {label} distribution · <span className="num">{dist.count}</span> shown
      </span>
      <div className="flex h-10 items-end gap-0.5" role="img" aria-label={`${label} distribution across shown rows`}>
        {dist.bins.map((bin, i) => (
          <span
            key={i}
            title={`${bin.from.toFixed(1)}–${bin.to.toFixed(1)}: ${bin.count}`}
            className={`flex-1 rounded-t-sm ${dist.max === 0 ? '' : 'bg-accent'}`}
            style={{ height: `${dist.max === 0 ? 0 : Math.max(bin.count === 0 ? 0 : 8, (bin.count / dist.max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] num text-faint">
        <span>{dist.min === null ? '' : dist.min.toFixed(0)}</span>
        {dist.median !== null ? <span className="text-accent">med {dist.median.toFixed(1)}</span> : null}
        <span>{dist.maxValue === null ? '' : dist.maxValue.toFixed(0)}</span>
      </div>
    </div>
  )
}
