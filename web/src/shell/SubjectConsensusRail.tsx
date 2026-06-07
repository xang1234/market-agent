import type { ReactNode } from 'react'

import { ANALYST_RATINGS, ratingLabel, type AnalystConsensusEnvelope } from '../symbol/consensus.ts'
import { formatCurrency2 } from '../symbol/format.ts'
import { useConsensus } from '../symbol/useConsensus.ts'

type SubjectConsensusRailProps = {
  issuerId: string | null
}

export function SubjectConsensusRail({ issuerId }: SubjectConsensusRailProps) {
  const consensus = useConsensus(issuerId)

  return (
    <div className="flex flex-col gap-5 p-4" data-testid="subject-consensus-rail">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Street view</h2>
        {consensus.status === 'idle' ? (
          <RailStatus>Issuer context unavailable.</RailStatus>
        ) : consensus.status === 'loading' ? (
          <RailStatus>Loading analyst consensus...</RailStatus>
        ) : consensus.status === 'unavailable' ? (
          <RailStatus>Consensus unavailable: {consensus.reason}</RailStatus>
        ) : (
          <StreetViewSummary envelope={consensus.data} />
        )}
      </section>
    </div>
  )
}

function StreetViewSummary({ envelope }: { envelope: AnalystConsensusEnvelope }) {
  const distribution = envelope.rating_distribution
  const leadRating = distribution ? leadingRating(distribution.counts) : null

  return (
    <div className="mt-3 flex flex-col gap-4 text-sm">
      <dl className="flex flex-col gap-2">
        <RailRow label="Analysts">
          <span className="num text-fg">{envelope.analyst_count}</span>
        </RailRow>
        {leadRating ? (
          <RailRow label="Consensus">
            <span className="text-fg">{ratingLabel(leadRating)}</span>
          </RailRow>
        ) : null}
        {envelope.price_target ? (
          <RailRow label="Mean target">
            <span className="num text-fg">
              {formatCurrency2(envelope.price_target.mean, envelope.price_target.currency)}
            </span>
          </RailRow>
        ) : null}
      </dl>
      {distribution ? (
        <ul className="flex flex-col gap-1.5">
          {ANALYST_RATINGS.map((rating) => {
            const count = distribution.counts[rating]
            return (
              <li key={rating} className="flex items-center justify-between gap-2 text-xs">
                <span className={count === 0 ? 'text-faint' : 'text-fg-soft'}>
                  {ratingLabel(rating)}
                </span>
                <span className={count === 0 ? 'num text-faint' : 'num text-fg'}>{count}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No rating distribution available.</p>
      )}
    </div>
  )
}

function RailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function RailStatus({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm text-muted">{children}</p>
}

function leadingRating(counts: NonNullable<AnalystConsensusEnvelope['rating_distribution']>['counts']) {
  let bestRating = ANALYST_RATINGS[0]
  let bestCount = counts[bestRating]
  for (const rating of ANALYST_RATINGS.slice(1)) {
    const count = counts[rating]
    if (count > bestCount) {
      bestRating = rating
      bestCount = count
    }
  }
  return bestCount > 0 ? bestRating : null
}
