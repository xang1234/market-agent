import type { ReactElement, ReactNode } from 'react'

type BadgeProps = {
  toneClass: string
  layoutClass?: string
  testId?: string
  children: ReactNode
}

const BADGE_BASE_CLASS = 'rounded px-2 py-0.5 text-xs font-medium'

export function Badge({ toneClass, layoutClass, testId, children }: BadgeProps): ReactElement {
  const className = layoutClass
    ? `${layoutClass} ${BADGE_BASE_CLASS} ${toneClass}`
    : `${BADGE_BASE_CLASS} ${toneClass}`
  return (
    <span data-testid={testId} className={className}>
      {children}
    </span>
  )
}
