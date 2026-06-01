import type { ReactElement, ReactNode } from 'react'
import { CARD_CLASS } from '../symbol/surfaceStyles.ts'

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
      className={`flex flex-col gap-2 ${CARD_CLASS} p-3`}
    >
      {title ? (
        <figcaption className="text-sm font-medium text-fg">
          {title}
        </figcaption>
      ) : null}
      {children}
    </figure>
  )
}
