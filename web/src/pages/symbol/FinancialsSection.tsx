import { useState } from 'react'
import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { FetchStateView } from '../../symbol/FetchStateView.tsx'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import { SegmentedToggle } from '../../symbol/SegmentedToggle.tsx'
import {
  fetchStatements,
  findLineValue,
  recentFyPeriods,
  type GetStatementsResponse,
  type NormalizedStatement,
  type StatementBasis,
} from '../../symbol/statements.ts'
import { formatCompactDollars } from '../../symbol/format.ts'
import {
  axisLabel,
  fetchSegments,
  type SegmentAxis,
  type SegmentFactsEnvelope,
} from '../../symbol/segments.ts'
import { useFetched } from '../../symbol/useFetched.ts'

const STATEMENT_FAMILY = 'income' as const
const PERIOD_COUNT = 5
// Apple, MSFT, NVDA, etc. each have a different fiscal year end (Sep, Jun,
// Jan…), so a calendar-year heuristic is wrong in general. The current
// fixture caps at FY2024 for every issuer; a real backend would expose a
// "latest period" hint we'd consume here instead.
const LATEST_FISCAL_YEAR = 2024
const SEGMENT_PERIOD = recentFyPeriods(LATEST_FISCAL_YEAR, 1)[0]

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

const AXIS_OPTIONS: ReadonlyArray<{ value: SegmentAxis; label: string }> = [
  { value: 'business', label: axisLabel('business') },
  { value: 'geography', label: axisLabel('geography') },
]

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
      <Card
        testId="financials-statements"
        headingId="financials-statements-heading"
        heading={`Income statement · last ${PERIOD_COUNT} FY`}
        action={
          <SegmentedToggle
            options={BASIS_OPTIONS}
            value={basis}
            onChange={setBasis}
            ariaLabel="Statement basis"
            testIdPrefix="basis"
          />
        }
      >
        <FetchStateView
          state={statements}
          noun="statements"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load financials."
        >
          {(data) => <StatementsTable response={data} />}
        </FetchStateView>
      </Card>
      <Card
        testId="financials-segments"
        headingId="financials-segments-heading"
        heading={`Segments · ${SEGMENT_PERIOD} · revenue share`}
        action={
          <SegmentedToggle
            options={AXIS_OPTIONS}
            value={axis}
            onChange={setAxis}
            ariaLabel="Segment axis"
            testIdPrefix="axis"
          />
        }
      >
        <FetchStateView
          state={segments}
          noun="segments"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load segments."
        >
          {(envelope) => <SegmentsView envelope={envelope} />}
        </FetchStateView>
      </Card>
    </div>
  )
}

function StatementsTable({ response }: { response: GetStatementsResponse }) {
  const periods = response.results
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

function SegmentsView({ envelope }: { envelope: SegmentFactsEnvelope }) {
  const definitionsById = new Map(envelope.segment_definitions.map((d) => [d.segment_id, d]))
  const revenueFacts = envelope.facts.filter((f) => f.metric_key === 'revenue' && f.value_num !== null)
  let total = 0
  for (const fact of revenueFacts) total += fact.value_num as number
  const slices = revenueFacts.map((f) => ({
    segment_id: f.segment_id,
    value: f.value_num as number,
    share: total === 0 ? 0 : (f.value_num as number) / total,
    label: definitionsById.get(f.segment_id)?.segment_name ?? f.segment_id,
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
