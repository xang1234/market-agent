import { useMemo } from 'react'
import { INSET_SURFACE_CLASS } from '../symbol/surfaceStyles.ts'
import { formatCompactCurrency } from '../symbol/format.ts'
import { VerticalBars } from '../symbol/VerticalBars.tsx'
import type { Distribution } from '../symbol/distribution.ts'
import type { ScreenerResponse } from './contracts.ts'
import { screenerSummary } from './screenerSummary.ts'

// Charts-first lead for the results: a stat strip + a P/E distribution over the
// loaded rows — the shape of the basket a paginated table can't show. Stats are
// scoped to the rows on screen ("shown"); the full match count is total_count.
export function ScreenerSummaryView({ response }: { response: ScreenerResponse }) {
  const summary = useMemo(() => screenerSummary(response.rows), [response])
  // Matches is the full result set; the medians and up% are computed only over
  // the loaded page, so call that out when the page is a subset.
  const pageScoped = summary.shown < response.total_count
  return (
    <div className="flex flex-col gap-2 border-b border-line pb-3">
      <div className="flex flex-wrap gap-2">
        <SummaryStat label="Matches" value={String(response.total_count)} />
        <SummaryStat label="Median P/E" value={summary.medianPe === null ? '—' : summary.medianPe.toFixed(1)} />
        <SummaryStat
          label="Median cap"
          value={
            summary.medianMarketCap === null || summary.marketCapCurrency === null
              ? '—'
              : formatCompactCurrency(summary.medianMarketCap, summary.marketCapCurrency)
          }
        />
        <SummaryStat
          label="Up today"
          value={summary.upPct === null ? '—' : `${Math.round(summary.upPct)}%`}
          positive={summary.upPct !== null && summary.upPct >= 50}
        />
      </div>
      {pageScoped ? (
        <p className="text-[10px] text-faint">
          Median &amp; up% cover the <span className="num">{summary.shown}</span> loaded rows; Matches is the full set.
        </p>
      ) : null}
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
  const bars = dist.bins.map((bin, i) => ({
    key: String(i),
    value: bin.count,
    title: `${bin.from.toFixed(1)}–${bin.to.toFixed(1)}: ${bin.count}`,
  }))
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted">
        {label} distribution · <span className="num">{dist.count}</span> shown
      </span>
      <VerticalBars bars={bars} minBarPct={8} ariaLabel={`${label} distribution across shown rows`} />
      <div className="flex justify-between text-[10px] num text-faint">
        <span>{dist.min === null ? '' : dist.min.toFixed(0)}</span>
        {dist.median !== null ? <span className="text-accent">med {dist.median.toFixed(1)}</span> : null}
        <span>{dist.maxValue === null ? '' : dist.maxValue.toFixed(0)}</span>
      </div>
    </div>
  )
}
