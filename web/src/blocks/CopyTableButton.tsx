import { useEffect, useState, type ReactElement } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { announce } from '../ui/announcer.ts'
import { toTsv, type TableRows } from './tableCopy.ts'

type CopyState = 'idle' | 'copied' | 'failed'

const LABEL: Record<CopyState, string> = { idle: 'Copy table', copied: 'Copied', failed: 'Copy failed' }

export function CopyTableButton({ rows, what }: { rows: () => TableRows; what: string }): ReactElement {
  const [state, setState] = useState<CopyState>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])
  const copy = () => {
    // Without a secure origin there is no clipboard API, so this rejects too.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(toTsv(rows())))
      .then(
        () => {
          setState('copied')
          announce(`Copied ${what} for a spreadsheet.`)
        },
        () => {
          setState('failed')
          announce(`Couldn't copy ${what}.`, 'assertive')
        },
      )
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${what} for a spreadsheet`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-fg"
    >
      <ClipboardCopy aria-hidden="true" className="h-3 w-3" strokeWidth={1.8} />
      {LABEL[state]}
    </button>
  )
}
