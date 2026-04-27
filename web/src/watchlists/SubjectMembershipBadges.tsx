// Subject-detail header membership badges (cw0.10.2). Reports the two
// states independently: a subject that is both watchlisted AND held
// shows two distinct badges. The badges are read-only — actions live
// alongside (Save-to-watchlist button, future hold-from-here CTAs).

import type { SubjectRef } from '../symbol/search'
import { useSubjectHeld } from '../portfolio/useSubjectHeld'
import { useWatchlist } from './watchlistContext'
import { subjectMembershipBadges } from './subjectMembership'

type Props = {
  subjectRef: SubjectRef
  userId: string | null
}

export function SubjectMembershipBadges({ subjectRef, userId }: Props) {
  const { members } = useWatchlist()
  const heldState = useSubjectHeld(subjectRef, userId)

  if (userId === null) return null

  const held = heldState.status === 'ready' && heldState.held
  const badges = subjectMembershipBadges({
    subjectRef,
    watchlistMembers: members,
    held,
  })

  if (!badges.watchlisted && !badges.held) return null

  return (
    <div data-testid="subject-membership-badges" className="flex items-center gap-2">
      {badges.watchlisted ? <Badge label="Watchlisted" tone="watchlist" /> : null}
      {badges.held ? <Badge label="Held" tone="held" /> : null}
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
  watchlist:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  held: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
}
