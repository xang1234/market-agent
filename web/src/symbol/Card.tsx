import type { ReactNode } from 'react'
import { CARD_CLASS } from './surfaceStyles.ts'

type CardProps = {
  testId: string
  headingId: string
  heading: string
  action?: ReactNode
  children: ReactNode
}

export function Card({ testId, headingId, heading, action, children }: CardProps) {
  return (
    <section
      data-testid={testId}
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 ${CARD_CLASS} p-4`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id={headingId}
          className="text-xs font-medium uppercase tracking-wide text-muted"
        >
          {heading}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}
