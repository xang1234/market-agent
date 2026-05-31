import type { ReactNode } from 'react'

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
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id={headingId}
          className="text-sm font-medium uppercase tracking-wide text-muted"
        >
          {heading}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}
