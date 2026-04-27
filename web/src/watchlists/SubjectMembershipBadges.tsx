// Subject-detail header membership badges. Reports watchlisted and held
// independently — a subject that is both shows two distinct badges, never
// a combined "saved" indicator. The badges are read-only; actions live
// alongside (Save-to-watchlist button).

import type { SubjectRef } from '../symbol/search'
import { useSubjectHeld } from '../portfolio/useSubjectHeld'
import { useWatchlist } from './watchlistContext'
import { isSubjectWatchlisted } from './subjectMembership'

type Props = {
  subjectRef: SubjectRef
  userId: string
}

export function SubjectMembershipBadges({ subjectRef, userId }: Props) {
  const { members } = useWatchlist()
  const heldState = useSubjectHeld(subjectRef, userId)

  const watchlisted = isSubjectWatchlisted(subjectRef, members)
  const held = heldState.status === 'ready' && heldState.data
  if (!watchlisted && !held) return null

  return (
    <div data-testid="subject-membership-badges" className="mt-3 flex items-center gap-2">
      {watchlisted ? <Badge label="Watchlisted" tone="watchlist" /> : null}
      {held ? <Badge label="Held" tone="held" /> : null}
    </div>
  )
}

function Badge({ label, tone }: { label: string; tone: 'watchlist' | 'held' }) {
  return (
    <span
      data-testid={`badge-${tone}`}
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  )
}

const TONE_CLASS: Readonly<Record<'watchlist' | 'held', string>> = {
  watchlist: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  held: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
}
