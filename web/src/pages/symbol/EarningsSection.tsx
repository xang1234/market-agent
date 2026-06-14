import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { FetchStateView } from '../../symbol/FetchStateView.tsx'
import { useConsensus } from '../../symbol/useConsensus.ts'
import { ConsensusBody, PriceTargetBody } from '../../symbol/consensusViews.tsx'
import {
  earningsBelongToIssuer,
  fetchEarnings,
  type EarningsEvent,
  type EarningsEventsEnvelope,
  type EarningsSurpriseDirection,
} from '../../symbol/earnings.ts'
import { beatMissSummary, type BeatMissChip, type BeatMissSummary } from '../../symbol/earningsStrip.ts'
import { formatCurrency2 } from '../../symbol/format.ts'
import { formatSignedPercent } from '../../symbol/quote.ts'
import { pluralize } from '../../format/pluralize.ts'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import { Th } from '../../symbol/Th.tsx'
import { useFetched } from '../../symbol/useFetched.ts'
import { SECTION_STACK_CLASS } from '../../symbol/surfaceStyles.ts'

const BEAT_MISS_COUNT = 4

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

  const consensus = useConsensus(issuerId)

  return (
    <div data-testid="section-earnings" className={SECTION_STACK_CLASS}>
      <Card
        testId="earnings-beats"
        headingId="earnings-beats-heading"
        heading={`Beats & misses · last ${BEAT_MISS_COUNT} quarters`}
      >
        <FetchStateView
          state={earnings}
          noun="earnings history"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load earnings."
        >
          {(envelope) => <BeatMissStrip summary={beatMissSummary(envelope.events, BEAT_MISS_COUNT)} />}
        </FetchStateView>
      </Card>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
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
                <p className="text-sm text-muted">
                  No price target in this consensus envelope.
                </p>
              )
            }
          </FetchStateView>
        </Card>
      </div>
      {/* Quarter-by-quarter table is the detail layer — kept last so the
          section reads at-a-glance first (beat/miss chips, then consensus). */}
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
    </div>
  )
}

const CHIP_CLASS: Readonly<Record<EarningsSurpriseDirection, string>> = {
  beat: 'border-positive/40 bg-positive-soft text-positive',
  miss: 'border-negative/40 bg-negative-soft text-negative',
  inline: 'border-line bg-surface-2 text-muted',
}

const CHIP_LABEL: Readonly<Record<EarningsSurpriseDirection, string>> = {
  beat: 'Beat',
  miss: 'Miss',
  inline: 'Inline',
}

// At-a-glance beat/miss chips for the most recent quarters, plus a one-line
// streak summary — the charts-first lede above the detail table.
function BeatMissStrip({ summary }: { summary: BeatMissSummary }) {
  if (summary.chips.length === 0) {
    return <p className="text-sm text-muted">No earnings releases recorded.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <ul data-testid="beat-miss-strip" className="flex flex-wrap gap-2">
        {summary.chips.map((chip) => (
          <BeatMissChipView key={chip.key} chip={chip} />
        ))}
      </ul>
      <p className="text-xs text-muted">
        {summary.beatCount} of last {summary.total} {pluralize(summary.total, 'quarter')} beat
        {summary.avgSurprisePct !== null ? (
          <>
            {' · avg surprise '}
            <span className={summary.avgSurprisePct >= 0 ? 'num text-positive' : 'num text-negative'}>
              {formatSignedPercent(summary.avgSurprisePct, 1)}
            </span>
          </>
        ) : null}
      </p>
    </div>
  )
}

function BeatMissChipView({ chip }: { chip: BeatMissChip }) {
  return (
    <li
      data-testid={`beat-miss-chip-${chip.key}`}
      data-direction={chip.direction}
      className={`flex min-w-[72px] flex-1 flex-col items-center gap-0.5 rounded-lg border px-3 py-2 ${CHIP_CLASS[chip.direction]}`}
    >
      <span className="num text-[10px] uppercase tracking-wide opacity-80">
        FY{String(chip.fiscalYear).slice(2)} {chip.fiscalPeriod}
      </span>
      <span className="text-sm font-bold">{CHIP_LABEL[chip.direction]}</span>
      {chip.surprisePct !== null ? (
        <span className="num text-[11px] font-medium">{formatSignedPercent(chip.surprisePct, 1)}</span>
      ) : null}
    </li>
  )
}

function EarningsTable({ envelope }: { envelope: EarningsEventsEnvelope }) {
  if (envelope.events.length === 0) {
    return <p className="text-sm text-muted">No earnings releases recorded.</p>
  }
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line">
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
  beat: 'text-positive',
  miss: 'text-negative',
  inline: 'text-muted',
  unknown: 'text-muted',
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
      className="border-t border-line"
    >
      <td className="px-2 py-2 text-fg">
        FY{event.fiscal_year} {event.fiscal_period}
      </td>
      <td className="px-2 py-2 text-muted num">
        {event.release_date}
      </td>
      <td className="px-2 py-2 text-right num text-fg">
        {formatEps(event.eps_estimate_at_release, currency)}
      </td>
      <td className="px-2 py-2 text-right num text-fg">
        {formatEps(event.eps_actual, currency)}
      </td>
      <td className={`px-2 py-2 text-right num ${surpriseClass}`}>
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
