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
  signedTextClass,
} from '../../symbol/signedColor.ts'
import { Th } from '../../symbol/Th.tsx'
import { useFetched, type FetchedResult } from '../../symbol/useFetched.ts'

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
    <div data-testid="section-holders" className="flex w-full flex-col gap-6 p-8">
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

function InstitutionalTable({ envelope }: { envelope: InstitutionalHoldersEnvelope }) {
  if (envelope.holders.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No institutional holders disclosed for this issuer.
      </p>
    )
  }
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
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
      className="border-t border-neutral-100 dark:border-neutral-800"
    >
      <td className="px-2 py-2 text-neutral-700 dark:text-neutral-200">{holder.holder_name}</td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {formatCompactDollars(holder.shares_held)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {formatCompactCurrency(holder.market_value, currency)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {holder.percent_of_shares_outstanding.toFixed(2)}%
      </td>
      <td className={`px-2 py-2 text-right tabular-nums ${signedTextClass(holder.shares_change)}`}>
        {formatSignedCount(holder.shares_change)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
        {holder.filing_date}
      </td>
    </tr>
  )
}

function InsiderTable({ envelope }: { envelope: InsiderHoldersEnvelope }) {
  if (envelope.holders.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No recent insider transactions disclosed for this issuer.
      </p>
    )
  }
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
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
      className="border-t border-neutral-100 dark:border-neutral-800"
    >
      <td className="px-2 py-2 text-neutral-700 dark:text-neutral-200">{transaction.insider_name}</td>
      <td className={`px-2 py-2 ${NEUTRAL_CLASS}`}>{transaction.insider_role}</td>
      <td className={`px-2 py-2 ${INSIDER_DIRECTION_CLASS[transaction.transaction_type]}`}>
        {insiderTransactionLabel(transaction.transaction_type)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {formatCompactDollars(transaction.shares)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {transaction.price === null ? '—' : formatCurrency2(transaction.price, currency)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
        {transaction.value === null ? '—' : formatCompactCurrency(transaction.value, currency)}
      </td>
      <td className={`px-2 py-2 text-right tabular-nums ${NEUTRAL_CLASS}`}>
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
