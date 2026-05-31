// Filled green/red %-change pill — the redesign's status primitive. Used in
// watchlist rows, the quote header, screener change columns, peer tables, and
// right-rail movers. Keeps a directional arrow alongside the color so meaning
// is not encoded by color alone (accessibility). The numeric text uses the
// mono/tabular `num` treatment so pills line up in a column.

import type { ReactNode } from 'react'
import { SIGNED_ARROW, SIGNED_PILL_CLASS, type SignedDirection } from './signedColor.ts'

type ChangePillProps = {
  direction: SignedDirection
  children: ReactNode
  // Hide the ▲/▼ glyph when the surrounding text already carries the sign.
  withArrow?: boolean
  className?: string
}

const BASE_CLASS =
  'num inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold'

export function ChangePill({
  direction,
  children,
  withArrow = true,
  className = '',
}: ChangePillProps) {
  const arrow = withArrow ? SIGNED_ARROW[direction] : ''
  return (
    <span className={`${BASE_CLASS} ${SIGNED_PILL_CLASS[direction]} ${className}`.trim()}>
      {arrow && (
        <span aria-hidden="true" className="text-[0.7em] leading-none">
          {arrow}
        </span>
      )}
      {children}
    </span>
  )
}
