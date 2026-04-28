import type { ReactElement, ReactNode } from 'react'

type DataAttrs = { [K in `data-${string}`]?: string }

type LabelValueCellProps = {
  label: string
  children: ReactNode
  testId?: string
  dataAttrs?: DataAttrs
  emphasis?: boolean
}

export function LabelValueCell({
  label,
  children,
  testId,
  dataAttrs,
  emphasis = false,
}: LabelValueCellProps): ReactElement {
  const valueClass = emphasis
    ? 'text-sm font-medium text-neutral-800 dark:text-neutral-200'
    : 'text-neutral-800 dark:text-neutral-200'
  return (
    <div data-testid={testId} {...dataAttrs} className="flex flex-col gap-0.5">
      <dt className="uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className={valueClass}>{children}</dd>
    </div>
  )
}
