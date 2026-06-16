import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { FetchStateView } from '../../symbol/FetchStateView.tsx'
import {
  formatCompactCurrency,
  formatCompactDollars,
  formatCurrency2,
} from '../../symbol/format.ts'
import {
  fetchHolders,
  holdersBelongToIssuer,
  insiderTransactionLabel,
  isInsiderHolders,
  isInstitutionalHolders,
  type HoldersEnvelope,
  type InsiderHoldersEnvelope,
  type InsiderTransaction,
  type InsiderTransactionType,
  type InstitutionalHolder,
  type InstitutionalHoldersEnvelope,
} from '../../symbol/holders.ts'
import { issuerIdFromSubject } from '../../symbol/profile.ts'
import {
  NEGATIVE_CLASS,
  NEUTRAL_CLASS,
  POSITIVE_CLASS,
  signedDirection,
  signedTextClass,
} from '../../symbol/signedColor.ts'
import {
  insiderNetFlow,
  topOwnership,
  type InsiderNetFlow,
  type OwnershipView,
} from '../../symbol/holdersCharts.ts'
import { MetricBars, type MetricBar } from '../../symbol/MetricBars.tsx'
import { StackedBar } from '../../symbol/StackedBar.tsx'
import { Th } from '../../symbol/Th.tsx'
import { useFetched, type FetchedResult } from '../../symbol/useFetched.ts'
import { SECTION_STACK_CLASS } from '../../symbol/surfaceStyles.ts'

const TOP_OWNERS = 6

export function HoldersSection() {
  const { subject } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)

  const institutional = useFetched<InstitutionalHoldersEnvelope>(
    issuerId,
    (id, signal) =>
      loadHolders(id, 'institutional', isInstitutionalHolders, signal),
  )
  const insider = useFetched<InsiderHoldersEnvelope>(
    issuerId,
    (id, signal) => loadHolders(id, 'insider', isInsiderHolders, signal),
  )

  return (
    <div data-testid="section-holders" className={SECTION_STACK_CLASS}>
      <Card
        testId="holders-ownership"
        headingId="holders-ownership-heading"
        heading={`Top institutional holders · % of shares`}
      >
        <FetchStateView
          state={institutional}
          noun="institutional holders"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load holders."
        >
          {(envelope) => <OwnershipBars view={topOwnership(envelope.holders, TOP_OWNERS)} />}
        </FetchStateView>
      </Card>
      <Card
        testId="holders-insider-flow"
        headingId="holders-insider-flow-heading"
        heading="Insider activity"
      >
        <FetchStateView
          state={insider}
          noun="insider transactions"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load insider activity."
        >
          {(envelope) => <InsiderFlow flow={insiderNetFlow(envelope.holders)} />}
        </FetchStateView>
      </Card>
      <Card
        testId="holders-institutional"
        headingId="holders-institutional-heading"
        heading="Institutional holders"
      >
        <FetchStateView
          state={institutional}
          noun="institutional holders"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load holders."
        >
          {(envelope) => <InstitutionalTable envelope={envelope} />}
        </FetchStateView>
      </Card>
      <Card
        testId="holders-insider"
        headingId="holders-insider-heading"
        heading="Insider transactions"
      >
        <FetchStateView
          state={insider}
          noun="insider transactions"
          idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load insider activity."
        >
          {(envelope) => <InsiderTable envelope={envelope} />}
        </FetchStateView>
      </Card>
    </div>
  )
}

async function loadHolders<E extends HoldersEnvelope>(
  issuerId: string,
  kind: E['kind'],
  narrow: (envelope: HoldersEnvelope) => envelope is E,
  signal: AbortSignal,
): Promise<FetchedResult<E>> {
  const data = await fetchHolders(issuerId, kind, { signal })
  if (!holdersBelongToIssuer(data, issuerId)) {
    return { kind: 'unavailable', reason: 'holders response did not match requested issuer' }
  }
  if (!narrow(data)) {
    return { kind: 'unavailable', reason: `expected ${kind} kind, received ${data.kind}` }
  }
  return { kind: 'ready', data }
}

// Top owners as bars (% of shares), scaled to the largest holder, with the
// signed share-change as the delta — the charts-first lede above the table.
function OwnershipBars({ view }: { view: OwnershipView }) {
  if (view.bars.length === 0) {
    return (
      <p className="text-sm text-muted">
        {view.percentUnavailable
          ? 'Ownership % not reported for these holders (see the holdings table below).'
          : 'No institutional holders recorded.'}
      </p>
    )
  }
  const bars: MetricBar[] = view.bars.map((bar) => ({
    key: bar.key,
    label: bar.holderName,
    fraction: view.maxPct === 0 ? 0 : bar.pct / view.maxPct,
    value: `${bar.pct.toFixed(1)}%`,
    delta:
      bar.sharesChange === 0
        ? undefined
        : { text: formatSignedCount(bar.sharesChange), direction: signedDirection(bar.sharesChange) },
  }))
  return (
    <div className="flex flex-col gap-3">
      <MetricBars bars={bars} fillClass="bg-accent" testId="ownership-bars" ariaLabel="Top holders by share" />
      <p className="text-xs text-muted">
        Top {view.bars.length} hold{' '}
        <span className="num text-fg">{view.topSharePct.toFixed(1)}%</span> of shares outstanding
      </p>
    </div>
  )
}

// Net insider buying vs selling over the window: the net figure, a buy/sell
// split bar, and counts — above the transaction log.
function InsiderFlow({ flow }: { flow: InsiderNetFlow }) {
  const traded = flow.buyShares + flow.sellShares
  if (traded === 0) {
    return <p className="text-sm text-muted">No open-market insider buys or sells recorded.</p>
  }
  const netClass = flow.netShares > 0 ? POSITIVE_CLASS : flow.netShares < 0 ? NEGATIVE_CLASS : NEUTRAL_CLASS
  return (
    <div className="flex items-center gap-4" data-testid="insider-flow">
      <div className="shrink-0">
        <div className={`num text-xl font-semibold ${netClass}`}>
          {flow.netShares > 0 ? '+' : flow.netShares < 0 ? '−' : ''}
          {formatCompactDollars(Math.abs(flow.netShares))}
        </div>
        <div className="text-xs text-muted">net shares {flow.netShares >= 0 ? 'bought' : 'sold'}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="num text-xs text-muted">
          {flow.buyCount} {flow.buyCount === 1 ? 'buy' : 'buys'} · {flow.sellCount}{' '}
          {flow.sellCount === 1 ? 'sell' : 'sells'}
        </div>
        <div className="mt-1.5">
          <StackedBar
            segments={[
              { key: 'buy', value: flow.buyShares, className: 'bg-positive' },
              { key: 'sell', value: flow.sellShares, className: 'bg-negative' },
            ]}
            ariaLabel={`Insider buys vs sells: ${flow.buyCount} buys, ${flow.sellCount} sells`}
            heightClass="h-2.5"
          />
        </div>
      </div>
    </div>
  )
}

function InstitutionalTable({ envelope }: { envelope: InstitutionalHoldersEnvelope }) {
  if (envelope.holders.length === 0) {
    return (
      <p className="text-sm text-muted">
        No institutional holders disclosed for this issuer.
      </p>
    )
  }
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line">
            <Th>Holder</Th>
            <Th align="right">Shares</Th>
            <Th align="right">Value</Th>
            <Th align="right">% out</Th>
            <Th align="right">Δ shares</Th>
            <Th align="right">Filed</Th>
          </tr>
        </thead>
        <tbody>
          {envelope.holders.map((holder) => (
            <InstitutionalRow
              key={`${holder.holder_name}-${holder.filing_date}`}
              holder={holder}
              currency={envelope.currency}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InstitutionalRow({ holder, currency }: { holder: InstitutionalHolder; currency: string }) {
  return (
    <tr
      data-testid={`institutional-row-${slugify(holder.holder_name)}`}
      className="border-t border-line"
    >
      <td className="px-2 py-2 text-fg">{holder.holder_name}</td>
      <td className="px-2 py-2 text-right num text-fg">
        {formatCompactDollars(holder.shares_held)}
      </td>
      <td className="px-2 py-2 text-right num text-fg">
        {formatCompactCurrency(holder.market_value, currency)}
      </td>
      <td className="px-2 py-2 text-right num text-fg">
        {holder.percent_of_shares_outstanding === null
          ? '—'
          : `${holder.percent_of_shares_outstanding.toFixed(2)}%`}
      </td>
      <td className={`px-2 py-2 text-right num ${signedTextClass(holder.shares_change)}`}>
        {formatSignedCount(holder.shares_change)}
      </td>
      <td className="px-2 py-2 text-right num text-muted">
        {holder.filing_date}
      </td>
    </tr>
  )
}

function InsiderTable({ envelope }: { envelope: InsiderHoldersEnvelope }) {
  if (envelope.holders.length === 0) {
    return (
      <p className="text-sm text-muted">
        No recent insider transactions disclosed for this issuer.
      </p>
    )
  }
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line">
            <Th>Insider</Th>
            <Th>Role</Th>
            <Th>Type</Th>
            <Th align="right">Shares</Th>
            <Th align="right">Price</Th>
            <Th align="right">Value</Th>
            <Th align="right">Date</Th>
          </tr>
        </thead>
        <tbody>
          {envelope.holders.map((tx, i) => (
            <InsiderRow
              key={`${slugify(tx.insider_name)}-${tx.transaction_date}-${i}`}
              transaction={tx}
              currency={envelope.currency}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const INSIDER_DIRECTION_CLASS: Readonly<Record<InsiderTransactionType, string>> = {
  buy: POSITIVE_CLASS,
  sell: NEGATIVE_CLASS,
  option_exercise: NEUTRAL_CLASS,
  gift: NEUTRAL_CLASS,
  other: NEUTRAL_CLASS,
}

function InsiderRow({
  transaction,
  currency,
}: {
  transaction: InsiderTransaction
  currency: string
}) {
  return (
    <tr
      data-testid={`insider-row-${slugify(transaction.insider_name)}-${transaction.transaction_date}`}
      className="border-t border-line"
    >
      <td className="px-2 py-2 text-fg">{transaction.insider_name}</td>
      <td className={`px-2 py-2 ${NEUTRAL_CLASS}`}>{transaction.insider_role}</td>
      <td className={`px-2 py-2 ${INSIDER_DIRECTION_CLASS[transaction.transaction_type]}`}>
        {insiderTransactionLabel(transaction.transaction_type)}
      </td>
      <td className="px-2 py-2 text-right num text-fg">
        {formatCompactDollars(transaction.shares)}
      </td>
      <td className="px-2 py-2 text-right num text-fg">
        {transaction.price === null ? '—' : formatCurrency2(transaction.price, currency)}
      </td>
      <td className="px-2 py-2 text-right num text-fg">
        {transaction.value === null ? '—' : formatCompactCurrency(transaction.value, currency)}
      </td>
      <td className={`px-2 py-2 text-right num ${NEUTRAL_CLASS}`}>
        {transaction.transaction_date}
      </td>
    </tr>
  )
}

function formatSignedCount(value: number): string {
  if (value === 0) return '0'
  const sign = value > 0 ? '+' : '-'
  return `${sign}${formatCompactDollars(Math.abs(value))}`
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
