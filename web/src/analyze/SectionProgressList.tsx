import type { ReactElement } from 'react'

import type { SectionProgressRow, SectionProgressState } from './sectionProgress.ts'

const DOT_CLASS: Readonly<Record<SectionProgressState, string>> = {
  pending: 'border-line-strong bg-surface-2',
  running: 'animate-pulse border-accent bg-accent',
  done: 'border-positive bg-positive',
  skipped: 'border-line bg-surface',
}

const GLYPH: Readonly<Record<SectionProgressState, string>> = {
  pending: '',
  running: '',
  done: '✓',
  skipped: '–',
}

// Status-aware playbook TOC: pending dots before a run, pulsing while the
// memo generates, check/dash marks once blocks land.
export function SectionProgressList({
  rows,
}: {
  rows: ReadonlyArray<SectionProgressRow>
}): ReactElement {
  return (
    <ul data-testid="analyze-section-progress" className="mt-2 flex flex-col gap-1.5 text-sm">
      {rows.map((item) => (
        <li key={item.section_id} data-state={item.state} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none text-white ${DOT_CLASS[item.state]}`}
          >
            {GLYPH[item.state]}
          </span>
          <span className={item.state === 'done' ? 'text-fg' : 'text-fg-soft'}>{item.title}</span>
        </li>
      ))}
    </ul>
  )
}
