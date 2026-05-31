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
  const valueClass = emphasis ? 'text-sm font-medium text-fg' : 'text-fg'
  return (
    <div data-testid={testId} {...dataAttrs} className="flex flex-col gap-0.5">
      <dt className="uppercase tracking-wide text-muted">{label}</dt>
      <dd className={valueClass}>{children}</dd>
    </div>
  )
}
