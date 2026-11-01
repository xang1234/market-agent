import type { ReactElement } from 'react'

import type { SectionProgressRow, SectionProgressState } from './sectionProgress.ts'

const MARKER_CLASS: Readonly<Record<SectionProgressState, string>> = {
  pending: 'bg-surface-2 text-muted',
  running: 'animate-pulse bg-accent-soft text-accent',
  done: 'bg-positive-soft text-positive',
  skipped: 'bg-surface-2 text-faint',
}

const TITLE_CLASS: Readonly<Record<SectionProgressState, string>> = {
  pending: 'text-fg-soft',
  running: 'text-fg',
  done: 'text-fg',
  skipped: 'text-faint line-through',
}

// Status-aware playbook outline: numbered steps before a run, pulsing while
// the memo generates, check/dash marks once blocks land.
export function SectionProgressList({
  rows,
}: {
  rows: ReadonlyArray<SectionProgressRow>
}): ReactElement {
  return (
    <ol data-testid="analyze-section-progress" className="flex flex-col gap-1 text-sm">
      {rows.map((item, index) => (
        <li key={item.section_id} data-state={item.state} className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`num flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-medium ${MARKER_CLASS[item.state]}`}
          >
            {item.state === 'done' ? '✓' : item.state === 'skipped' ? '–' : index + 1}
          </span>
          <span className={TITLE_CLASS[item.state]}>{item.title}</span>
        </li>
      ))}
    </ol>
  )
}
