import type { ReactElement, ReactNode } from 'react'

type DataAttrs = { [K in `data-${string}`]?: string }

type ChartCardProps = {
  testId: string
  blockKind: string
  title: string | undefined
  dataAttrs?: DataAttrs
  children: ReactNode
}

export function ChartCard({
  testId,
  blockKind,
  title,
  dataAttrs,
  children,
}: ChartCardProps): ReactElement {
  return (
    <figure
      data-testid={testId}
      data-block-kind={blockKind}
      {...dataAttrs}
      className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      {title ? (
        <figcaption className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {title}
        </figcaption>
      ) : null}
      {children}
    </figure>
  )
}
