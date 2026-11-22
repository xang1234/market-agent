import { pluralize } from '../format/pluralize.ts'
import { formatCompactCurrency, formatCurrency2 } from './format.ts'
import type { GuidanceComparison, GuidanceOutcome, GuidanceRecordEnvelope, GuidanceSource } from './guidanceRecord.ts'

const METRIC_LABEL: Readonly<Record<string, string>> = {
  revenue: 'Revenue',
  gross_margin: 'Gross margin',
  operating_expenses: 'Operating expenses',
  operating_income: 'Operating income',
  net_income: 'Net income',
  eps: 'EPS',
  operating_cash_flow: 'Operating cash flow',
  free_cash_flow: 'Free cash flow',
  capex: 'Capex',
}
const BASIS_LABEL = { gaap: 'GAAP', non_gaap: 'non-GAAP' } as const
const COSTS: ReadonlySet<string> = new Set(['operating_expenses', 'capex'])

const OUTCOME_LABEL: Readonly<Record<GuidanceOutcome, string>> = {
  beat: 'Beat',
  in_line: 'In line',
  miss: 'Miss',
  not_comparable: 'Not comparable',
  not_yet_reported: 'Not yet reported',
}
const OUTCOME_CLASS: Readonly<Record<GuidanceOutcome, string>> = {
  beat: 'border-positive/40 bg-positive-soft text-positive',
  miss: 'border-negative/40 bg-negative-soft text-negative',
  in_line: 'border-line bg-surface-2 text-fg-soft',
  not_comparable: 'border-line bg-surface-2 text-muted',
  not_yet_reported: 'border-line bg-surface-2 text-muted',
}

const label = (row: Pick<GuidanceComparison, 'metric' | 'basis'>) => `${METRIC_LABEL[row.metric] ?? row.metric} (${BASIS_LABEL[row.basis]})`

function figure(value: number, unit: GuidanceComparison['unit']): string {
  if (unit === 'percent') return `${Number(value.toFixed(2))}%`
  return unit === 'usd_per_share' ? formatCurrency2(value, 'USD') : formatCompactCurrency(value, 'USD')
}

function whyNotCompared(row: GuidanceComparison): string {
  if (row.reason === 'conflicting_guidance') return 'The release gives different figures for this guide, so it is not compared.'
  if (row.reason === 'conflicting_actuals') return 'The releases report different actuals for this quarter, so the guide is not compared.'
  return `No ${BASIS_LABEL[row.basis]} actual for this quarter was read from the next release, and a guide is never compared across bases.`
}

// Each guide beside the next release's actual on the same basis, both quoted
// with their filings, and how often the actual met the guide.
export function GuidanceRecordBody({ envelope }: { envelope: GuidanceRecordEnvelope }) {
  const { rows, hit_rates: rates } = envelope.record
  if (rows.length === 0) {
    return <p className="text-sm text-muted">No guidance with figures is on file from this company's earnings releases.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {rates.length > 0 ? (
        <ul data-testid="guidance-hit-rates" className="flex flex-wrap gap-2">
          {rates.map((rate) => (
            <li key={`${rate.metric}-${rate.basis}`} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-soft">
              <span className="font-medium text-fg">{label(rate)}</span>{' '}
              <span className="num">{rate.hits} of {rate.compared}</span> {pluralize(rate.compared, 'quarter')} in line or beat
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <GuidanceRow key={`${row.quarter_end ?? 'next'}-${row.metric}-${row.basis}`} row={row} />
        ))}
      </ul>
      {rows.some((row) => COSTS.has(row.metric)) ? (
        <p className="text-xs text-muted">For operating expenses and capex, an actual below the guided range counts as a beat.</p>
      ) : null}
    </div>
  )
}

function GuidanceRow({ row }: { row: GuidanceComparison }) {
  const guided = row.guided.low === row.guided.high
    ? figure(row.guided.low, row.unit)
    : `${figure(row.guided.low, row.unit)} to ${figure(row.guided.high, row.unit)}`
  return (
    <li
      data-testid={`guidance-row-${row.quarter_end ?? 'next'}-${row.metric}-${row.basis}`}
      data-outcome={row.outcome}
      className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-fg">{label(row)}</span>
        <span className="num text-xs text-muted">{row.quarter_end ? `Quarter ended ${row.quarter_end}` : 'Next quarter'}</span>
        <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${OUTCOME_CLASS[row.outcome]}`}>
          {OUTCOME_LABEL[row.outcome]}
        </span>
      </div>
      <Cited heading="Guided" value={guided} source={row.guided.source} />
      {row.actual ? <Cited heading="Reported" value={figure(row.actual.value, row.unit)} source={row.actual.source} /> : null}
      {row.outcome === 'not_comparable' ? <p className="text-xs text-muted">{whyNotCompared(row)}</p> : null}
    </li>
  )
}

function Cited({ heading, value, source }: { heading: string; value: string; source: GuidanceSource }) {
  const filed = `8-K filed ${source.filed_on}`
  return (
    <figure className="flex flex-col gap-0.5 text-xs">
      <div>
        <span className="text-muted">{heading} </span>
        <span className="num font-medium text-fg">{value}</span>
      </div>
      <blockquote className="text-fg-soft">"{source.quote}"</blockquote>
      <figcaption className="text-faint">
        {source.url ? (
          <a href={source.url} target="_blank" rel="noreferrer" className="underline hover:text-fg">{filed}</a>
        ) : filed}
      </figcaption>
    </figure>
  )
}
