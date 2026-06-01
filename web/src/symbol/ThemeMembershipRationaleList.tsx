import type { ReactElement } from 'react'
import { CARD_CLASS } from './surfaceStyles.ts'

export type ThemeMembershipMode = 'manual' | 'rule_based' | 'inferred'

export type ThemeMembershipRationaleView = {
  theme_id: string
  theme_name: string
  theme_description: string | null
  membership_mode: ThemeMembershipMode
  score: number | null
  rationale_supported: boolean
  rationale_claim_ids: ReadonlyArray<string>
}

export function ThemeMembershipRationaleList({
  memberships,
}: {
  memberships: ReadonlyArray<ThemeMembershipRationaleView>
}): ReactElement | null {
  if (memberships.length === 0) return null
  return (
    <section data-testid="theme-membership-rationale" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-fg">
        Theme membership rationale
      </h3>
      <ul className="flex flex-col gap-2">
        {memberships.map((membership) => (
          <ThemeMembershipRationaleRow key={membership.theme_id} membership={membership} />
        ))}
      </ul>
    </section>
  )
}

function ThemeMembershipRationaleRow({
  membership,
}: {
  membership: ThemeMembershipRationaleView
}): ReactElement {
  return (
    <li className={`${CARD_CLASS} p-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-fg">
            {membership.theme_name}
          </p>
          {membership.theme_description ? (
            <p className="mt-1 text-xs text-muted">
              {membership.theme_description}
            </p>
          ) : null}
        </div>
        <span className="rounded-md border border-line px-2 py-0.5 text-xs text-fg-soft">
          {membership.membership_mode}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-soft">
        {membership.score === null ? null : (
          <span className="font-medium num text-fg">
            {`Score ${formatScore(membership.score)}`}
          </span>
        )}
        {membership.rationale_supported ? (
          <span>{`${membership.rationale_claim_ids.length} rationale claims`}</span>
        ) : (
          <span>No claim rationale for this membership mode</span>
        )}
      </div>
      {membership.rationale_supported ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {membership.rationale_claim_ids.map((claimId) => (
            <li
              key={claimId}
              title={`claim:${claimId}`}
              aria-label={`claim:${claimId}`}
              className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg"
            >
              {`claim:${claimId.slice(0, 8)}`}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(2)
}
