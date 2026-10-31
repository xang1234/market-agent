import { useEffect, useState, type ReactElement } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { announce } from '../ui/announcer.ts'
import { toCsv, type CsvRows } from './csv.ts'

type CopyState = 'idle' | 'copied' | 'failed'

const LABEL: Record<CopyState, string> = { idle: 'Copy CSV', copied: 'Copied', failed: 'Copy failed' }

export function CopyCsvButton({ rows, what }: { rows: () => CsvRows; what: string }): ReactElement {
  const [state, setState] = useState<CopyState>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])
  const copy = () => {
    navigator.clipboard.writeText(toCsv(rows())).then(
      () => {
        setState('copied')
        announce(`Copied ${what} as CSV.`)
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
      aria-label={`Copy ${what} as CSV`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-fg"
    >
      <ClipboardCopy aria-hidden="true" className="h-3 w-3" strokeWidth={1.8} />
      {LABEL[state]}
    </button>
  )
}
