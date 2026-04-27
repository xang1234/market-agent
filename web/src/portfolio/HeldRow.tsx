// Portfolio-held row (cw0.10.1).
//
// A held subject is rendered through the shared QuoteRow skeleton so a
// subject that is both watchlisted and held shows identical core values
// (ticker / venue / price / percent move) on either surface. The held-
// specific affordance — quantity, optional cost basis — slots into the
// `trailing` block; everything else flows through the shared component.
//
// Holdings bind to `instrument` or `listing` SubjectRefs (see
// services/portfolio/src/holdings.ts: HOLDING_SUBJECT_KINDS). Only
// listing-kind holdings hydrate a quote today; instrument-kind rows
// show the same "—" placeholder watchlist members get when their
// subject doesn't resolve to a listing.

import { QuoteRow } from '../symbol/QuoteRow'
import type { SubjectKind } from '../symbol/search'

export type HeldSubjectRef = {
  kind: Extract<SubjectKind, 'instrument' | 'listing'>
  id: string
}

export type Holding = {
  portfolio_holding_id: string
  subject_ref: HeldSubjectRef
  quantity: number
  cost_basis: number | null
}

type HeldRowProps = {
  holding: Holding
}

export function HeldRow({ holding }: HeldRowProps) {
  return (
    <QuoteRow
      subjectRef={holding.subject_ref}
      trailing={<HoldingBadge quantity={holding.quantity} costBasis={holding.cost_basis} />}
    />
  )
}

function HoldingBadge({ quantity, costBasis }: { quantity: number; costBasis: number | null }) {
  return (
    <span className="flex shrink-0 flex-col items-end justify-center px-2 text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
      <span className="font-medium text-neutral-700 dark:text-neutral-200">{formatQuantity(quantity)}</span>
      {costBasis !== null ? <span>cost {formatCost(costBasis)}</span> : null}
    </span>
  )
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(quantity)
}

function formatCost(costBasis: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(costBasis)
}
