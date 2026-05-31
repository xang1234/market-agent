import type { HTMLAttributes, ReactNode } from 'react'

// Single source of truth for chat turn presentation. A streaming turn and the
// persisted turn it becomes are the SAME message at two moments in its life —
// the stream seals and re-renders through MessageItem. Sharing these wrappers
// keeps the two paths pixel-identical, so the turn doesn't visually jump at the
// seal moment, and the width/card styling can't drift between them.

// Centered reading column for the thread (mockup ~780px). Exported as a class
// too so VirtualizedMessageList can apply it to its own scroll-content div
// (which carries virtualization padding + a test id) without a wrapper element.
export const THREAD_COLUMN_CLASS = 'mx-auto w-full max-w-[780px]'

export function ThreadColumn({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${THREAD_COLUMN_CLASS} ${className}`.trim()}>{children}</div>
}

// Assistant turns get the full answer canvas; the user's turn stays a compact
// bubble (USER_BUBBLE_CLASS). Extra div props pass through so callers can attach
// test ids / data attributes without re-declaring the styling.
export function AssistantTurn({
  children,
  className = '',
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-md ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  )
}

// The sent-message bubble gradient is intentionally theme-independent so it
// reads as "your message" in both light and dark.
export const USER_BUBBLE_CLASS =
  'max-w-[80%] rounded-2xl rounded-br-md border border-[#244a6e] bg-gradient-to-b from-[#1d3a59] to-[#16314c] px-3.5 py-2.5 text-[#dcebff] shadow-md'
