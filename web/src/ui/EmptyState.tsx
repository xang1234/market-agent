import type { ReactElement, ReactNode } from 'react'

type EmptyStateProps = {
  children: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'error'
}

export function EmptyState({ children, action, tone = 'neutral' }: EmptyStateProps): ReactElement {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm ${tone === 'error' ? 'text-negative' : 'text-muted'}`}
    >
      <p className="min-w-0 grow basis-40">{children}</p>
      {action !== undefined ? <div className="shrink-0 font-medium text-accent">{action}</div> : null}
    </div>
  )
}
