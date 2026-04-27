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
      className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id={headingId}
          className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          {heading}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}
