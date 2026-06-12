import type { HTMLAttributes, ReactElement, ReactNode } from 'react'

import { isWideBlock, PROSE_COLUMN_CLASS, BREAKOUT_COLUMN_CLASS } from './blockColumns.ts'

// Single source of truth for chat turn presentation. A streaming turn and the
// persisted turn it becomes are the SAME message at two moments in its life —
// the stream seals and re-renders through MessageItem. Sharing these wrappers
// keeps the two paths pixel-identical, so the turn doesn't visually jump at the
// seal moment, and the width/card styling can't drift between them.

// Outer thread column — left-aligned, wide enough to host breakout data blocks.
export const THREAD_COLUMN_CLASS = 'w-full max-w-[960px]'

/** Wraps a block in the column width appropriate for its kind. */
export function BlockColumn({
  kind,
  children,
}: {
  kind: string
  children: ReactNode
}): ReactElement {
  return <div className={isWideBlock(kind) ? BREAKOUT_COLUMN_CLASS : PROSE_COLUMN_CLASS}>{children}</div>
}

export function ThreadColumn({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${THREAD_COLUMN_CLASS} ${className}`.trim()}>{children}</div>
}

// Assistant turns get the full answer canvas as continuous document flow — no
// card chrome. The turn is ONE surface wrapping all of its blocks (callers
// apply it once per turn, not per block); blocks inside are separated by
// vertical rhythm only, so research output reads as a document. The user's
// turn stays a compact bubble (USER_BUBBLE_CLASS). Extra div props pass
// through so callers can attach test ids / data attributes.
export function AssistantTurn({
  children,
  className = '',
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-col gap-4 py-1 ${className}`.trim()} {...rest}>
      {children}
    </div>
  )
}

// The sent-message bubble gradient is intentionally theme-independent so it
// reads as "your message" in both light and dark.
export const USER_BUBBLE_CLASS =
  'max-w-[80%] rounded-2xl rounded-br-md border border-[#244a6e] bg-linear-to-b from-[#1d3a59] to-[#16314c] px-3.5 py-2.5 text-[#dcebff] shadow-md'
