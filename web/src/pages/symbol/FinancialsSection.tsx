import { useState } from 'react'
import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import {
  fetchStatements,
  findLineValue,
  recentFyPeriods,
  type GetStatementsResponse,
  type NormalizedStatement,
  type StatementBasis,
} from '../../symbol/statements.ts'
import {
  axisLabel,
  fetchSegments,
  sumSegmentMetric,
  type SegmentAxis,
  type SegmentFactsEnvelope,
} from '../../symbol/segments.ts'
import { useFetched, type VisibleFetchState } from '../../symbol/useFetched.ts'

const STATEMENT_FAMILY = 'income' as const
const PERIOD_COUNT = 5
const LATEST_FISCAL_YEAR = 2024
const SEGMENT_PERIOD = `${LATEST_FISCAL_YEAR}-FY`

const INCOME_LINE_ORDER: ReadonlyArray<{ metric_key: string; label: string; emphasis?: 'subtotal' | 'eps' }> = [
  { metric_key: 'revenue', label: 'Revenue' },
  { metric_key: 'cost_of_revenue', label: 'Cost of revenue' },
  { metric_key: 'gross_profit', label: 'Gross profit', emphasis: 'subtotal' },
  { metric_key: 'operating_expenses', label: 'Operating expenses' },
  { metric_key: 'operating_income', label: 'Operating income', emphasis: 'subtotal' },
  { metric_key: 'net_income', label: 'Net income', emphasis: 'subtotal' },
  { metric_key: 'eps_basic', label: 'EPS (basic)', emphasis: 'eps' },
  { metric_key: 'eps_diluted', label: 'EPS (diluted)', emphasis: 'eps' },
]

const BASIS_OPTIONS: ReadonlyArray<{ value: StatementBasis; label: string }> = [
  { value: 'as_reported', label: 'As reported' },
  { value: 'as_restated', label: 'As restated' },
]

const SEGMENT_AXIS_OPTIONS: ReadonlyArray<SegmentAxis> = ['business', 'geography']

export function FinancialsSection() {
  const { subject } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)
  const [basis, setBasis] = useState<StatementBasis>('as_reported')
  const [axis, setAxis] = useState<SegmentAxis>('business')

  const statementsKey = issuerId === null ? null : `${issuerId}|${basis}`
  const segmentsKey = issuerId === null ? null : `${issuerId}|${axis}`

  const statements = useFetched<GetStatementsResponse>(statementsKey, async (_key, signal) => {
    const periods = recentFyPeriods(LATEST_FISCAL_YEAR, PERIOD_COUNT)
    const data = await fetchStatements(
      {
        subject_ref: { kind: 'issuer', id: issuerId! },
        statement: STATEMENT_FAMILY,
        periods,
        basis,
      },
      { signal },
    )
    return { kind: 'ready', data }
  })

  const segments = useFetched<SegmentFactsEnvelope>(segmentsKey, async (_key, signal) => {
    const data = await fetchSegments(
      {
        subject_ref: { kind: 'issuer', id: issuerId! },
        axis,
        period: SEGMENT_PERIOD,
        basis: 'as_reported',
      },
      { signal },
    )
    return { kind: 'ready', data }
  })

  return (
    <div data-testid="section-financials" className="flex w-full flex-col gap-6 p-8">
      <StatementsCard
        issuerId={issuerId}
        basis={basis}
        onBasisChange={setBasis}
        state={statements}
      />
      <SegmentsCard
        issuerId={issuerId}
        axis={axis}
        onAxisChange={setAxis}
        state={segments}
      />
    </div>
  )
}

function StatementsCard({
  issuerId,
  basis,
  onBasisChange,
  state,
}: {
  issuerId: string | null
  basis: StatementBasis
  onBasisChange: (b: StatementBasis) => void
  state: VisibleFetchState<GetStatementsResponse>
}) {
  return (
    <section
      data-testid="financials-statements"
      aria-labelledby="financials-statements-heading"
      className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id="financials-statements-heading"
          className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          Income statement · last {PERIOD_COUNT} FY
        </h3>
        <BasisToggle current={basis} onChange={onBasisChange} />
      </div>
      <StatementsBody issuerId={issuerId} state={state} />
    </section>
  )
}

function StatementsBody({
  issuerId,
  state,
}: {
  issuerId: string | null
  state: VisibleFetchState<GetStatementsResponse>
}) {
  if (issuerId === null) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Issuer context unavailable for this entry. Open this symbol from search to load financials.
      </p>
    )
  }
  if (state.status === 'idle' || state.status === 'loading') {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading statements…</p>
  }
  if (state.status === 'unavailable') {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Statements unavailable: {state.reason}</p>
  }
  return <StatementsTable response={state.data} />
}

function StatementsTable({ response }: { response: GetStatementsResponse }) {
  const periods = response.results
  // Period order on the wire is whatever the request asked for; preserve it.
  // Only the available outcomes carry a usable statement; per-period misses
  // become em-dash columns rather than missing columns so the basis toggle
  // can reveal "this period wasn't restated" without collapsing the table.
  const reportingCurrency = firstAvailableCurrency(periods)
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            <th className="px-2 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
              Line item
              {reportingCurrency && (
                <span className="ml-1 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                  ({reportingCurrency})
                </span>
              )}
            </th>
            {periods.map((entry) => (
              <th
                key={entry.period}
                className="px-2 py-2 text-right font-medium text-neutral-500 dark:text-neutral-400"
                scope="col"
              >
                {entry.period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {INCOME_LINE_ORDER.map((row) => (
            <tr
              key={row.metric_key}
              className={
                row.emphasis === 'subtotal'
                  ? 'border-t border-neutral-100 font-medium dark:border-neutral-800'
                  : 'border-t border-transparent'
              }
            >
              <td className="px-2 py-1.5 text-neutral-700 dark:text-neutral-200">{row.label}</td>
              {periods.map((entry) => (
                <td
                  key={`${row.metric_key}-${entry.period}`}
                  className="px-2 py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-200"
                >
                  {formatLineCell(entry.outcome.outcome === 'available' ? entry.outcome.data : null, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function firstAvailableCurrency(periods: GetStatementsResponse['results']): string | null {
  for (const entry of periods) {
    if (entry.outcome.outcome === 'available') return entry.outcome.data.reporting_currency
  }
  return null
}

function formatLineCell(
  statement: NormalizedStatement | null,
  row: { metric_key: string; emphasis?: 'subtotal' | 'eps' },
): string {
  const value = findLineValue(statement, row.metric_key)
  if (value === null) return '—'
  if (row.emphasis === 'eps') return value.toFixed(2)
  return formatCompactDollars(value)
}

function formatCompactDollars(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return value.toFixed(0)
}

function BasisToggle({
  current,
  onChange,
}: {
  current: StatementBasis
  onChange: (b: StatementBasis) => void
}) {
  return (
    <div role="radiogroup" aria-label="Statement basis" className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-700">
      {BASIS_OPTIONS.map((opt) => {
        const active = opt.value === current
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`basis-${opt.value}`}
            onClick={() => onChange(opt.value)}
            className={
              active
                ? 'bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'px-3 py-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function SegmentsCard({
  issuerId,
  axis,
  onAxisChange,
  state,
}: {
  issuerId: string | null
  axis: SegmentAxis
  onAxisChange: (a: SegmentAxis) => void
  state: VisibleFetchState<SegmentFactsEnvelope>
}) {
  return (
    <section
      data-testid="financials-segments"
      aria-labelledby="financials-segments-heading"
      className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id="financials-segments-heading"
          className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          Segments · {SEGMENT_PERIOD} · revenue share
        </h3>
        <AxisToggle current={axis} onChange={onAxisChange} />
      </div>
      <SegmentsBody issuerId={issuerId} state={state} />
    </section>
  )
}

function SegmentsBody({
  issuerId,
  state,
}: {
  issuerId: string | null
  state: VisibleFetchState<SegmentFactsEnvelope>
}) {
  if (issuerId === null) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Issuer context unavailable for this entry. Open this symbol from search to load segments.
      </p>
    )
  }
  if (state.status === 'idle' || state.status === 'loading') {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading segments…</p>
  }
  if (state.status === 'unavailable') {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Segments unavailable: {state.reason}</p>
  }
  return <SegmentsView envelope={state.data} />
}

function SegmentsView({ envelope }: { envelope: SegmentFactsEnvelope }) {
  const total = sumSegmentMetric(envelope, 'revenue')
  const slices = envelope.facts
    .filter((f) => f.metric_key === 'revenue' && f.value_num !== null)
    .map((f) => ({
      segment_id: f.segment_id,
      value: f.value_num as number,
      share: total === 0 ? 0 : (f.value_num as number) / total,
      label: envelope.segment_definitions.find((d) => d.segment_id === f.segment_id)?.segment_name ?? f.segment_id,
    }))

  if (slices.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">No revenue facts in this segment envelope.</p>
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <SegmentDonut slices={slices} />
      <SegmentTrajectory slices={slices} reportingCurrency={envelope.reporting_currency} />
      {envelope.coverage_warnings.length > 0 && (
        <div
          data-testid="segments-warnings"
          className="md:col-span-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {envelope.coverage_warnings.length} coverage warning{envelope.coverage_warnings.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}

type DonutSlice = {
  segment_id: string
  value: number
  share: number
  label: string
}

const DONUT_PALETTE = [
  '#2563eb',
  '#7c3aed',
  '#16a34a',
  '#ea580c',
  '#0891b2',
  '#dc2626',
  '#a16207',
] as const

function SegmentDonut({ slices }: { slices: DonutSlice[] }) {
  const size = 180
  const radius = 70
  const stroke = 28
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  const arcs = slices.reduce<{ slice: DonutSlice; index: number; length: number; offset: number }[]>((acc, slice, index) => {
    const length = circumference * slice.share
    const previous = acc[acc.length - 1]
    const offset = previous ? previous.offset + previous.length : 0
    acc.push({ slice, index, length, offset })
    return acc
  }, [])
  return (
    <svg
      role="img"
      aria-label="Segment revenue share"
      viewBox={`0 0 ${size} ${size}`}
      className="h-44 w-full max-w-[200px]"
    >
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={stroke} />
      {arcs.map(({ slice, index, length, offset }) => (
        <circle
          key={slice.segment_id}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={DONUT_PALETTE[index % DONUT_PALETTE.length]}
          strokeWidth={stroke}
          strokeDasharray={`${length} ${circumference - length}`}
          strokeDashoffset={-offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ))}
    </svg>
  )
}

function SegmentTrajectory({
  slices,
  reportingCurrency,
}: {
  slices: DonutSlice[]
  reportingCurrency: string
}) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {slices.map((slice, i) => (
        <li
          key={slice.segment_id}
          data-testid={`segment-row-${slice.segment_id}`}
          className="flex items-center gap-2"
        >
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length] }}
          />
          <span className="flex-1 truncate text-neutral-700 dark:text-neutral-200">{slice.label}</span>
          <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
            {(slice.share * 100).toFixed(1)}%
          </span>
          <span className="w-20 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
            {formatCompactDollars(slice.value)} {reportingCurrency}
          </span>
        </li>
      ))}
    </ul>
  )
}

function AxisToggle({
  current,
  onChange,
}: {
  current: SegmentAxis
  onChange: (a: SegmentAxis) => void
}) {
  return (
    <div role="radiogroup" aria-label="Segment axis" className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-700">
      {SEGMENT_AXIS_OPTIONS.map((value) => {
        const active = value === current
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`axis-${value}`}
            onClick={() => onChange(value)}
            className={
              active
                ? 'bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'px-3 py-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }
          >
            {axisLabel(value)}
          </button>
        )
      })}
    </div>
  )
}
