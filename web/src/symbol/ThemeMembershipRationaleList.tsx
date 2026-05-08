import type { ReactElement } from 'react'

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
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
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
    <li className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {membership.theme_name}
          </p>
          {membership.theme_description ? (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {membership.theme_description}
            </p>
          ) : null}
        </div>
        <span className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          {membership.membership_mode}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        {membership.score === null ? null : (
          <span className="font-medium tabular-nums text-neutral-800 dark:text-neutral-100">
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
              className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
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
