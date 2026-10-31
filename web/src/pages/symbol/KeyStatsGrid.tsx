import type { ReactElement } from 'react'

import type { KeyStatCell } from './keyStatsGrid.ts'

// Dense label/value grid under the hero chart. Wraps to fewer columns on
// narrow widths. The emphasized cell (prev close) gets an accent-tinted tile;
// unavailable cells show a subdued dash rather than disappearing, so the grid
// keeps a stable shape.
export function KeyStatsGrid({ cells }: { cells: ReadonlyArray<KeyStatCell> }): ReactElement {
  return (
    <dl
      data-testid="key-stats-grid"
      className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6"
    >
      {cells.map((cell) => (
        <div
          key={cell.key}
          data-testid={`key-stat-${cell.key}`}
          className={`-mr-px -mb-px flex flex-col gap-1 border-r border-b border-line p-3 ${cell.emphasis ? 'bg-accent-soft' : ''}`}
        >
          <dt
            className={`text-[11px] uppercase tracking-wide ${cell.emphasis ? 'text-accent' : 'text-muted'}`}
          >
            {cell.label}
          </dt>
          <dd className={`num text-sm font-medium ${cell.value === null ? 'text-faint' : 'text-fg'}`}>
            {cell.value ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}
