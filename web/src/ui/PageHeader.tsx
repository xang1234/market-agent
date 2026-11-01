import type { ReactElement, ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  description?: ReactNode
}

export function PageHeader({ title, description }: PageHeaderProps): ReactElement {
  return (
    <header className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      {description !== undefined ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
    </header>
  )
}
