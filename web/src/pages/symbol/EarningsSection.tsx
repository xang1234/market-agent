import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { FetchStateView } from '../../symbol/FetchStateView.tsx'
import {
  consensusBelongsToIssuer,
  fetchConsensus,
  type AnalystConsensusEnvelope,
} from '../../symbol/consensus.ts'
import { ConsensusBody, PriceTargetBody } from '../../symbol/consensusViews.tsx'
import {
  earningsBelongToIssuer,
  fetchEarnings,
  type EarningsEvent,
  type EarningsEventsEnvelope,
  type EarningsSurpriseDirection,
} from '../../symbol/earnings.ts'
import { formatCurrency2 } from '../../symbol/format.ts'
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
                <p className="text-sm text-muted">
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
