import { useEffect, useState, type ReactElement } from 'react'
import { Check, ClipboardCopy } from 'lucide-react'
import { announce } from '../ui/announcer.ts'

type CopyState = 'idle' | 'copied' | 'failed'

type CopyButtonProps = {
  // Built on click, so a long answer is only turned into text when copied.
  text: () => string
  label: string
  // Names what is copied, for the accessible name and the announcement.
  what: string
  purpose: string
  // An icon alone, for a button that sits inside content it must not add words to.
  iconOnly?: boolean
}

export function CopyButton({ text, label, what, purpose, iconOnly = false }: CopyButtonProps): ReactElement {
  const [state, setState] = useState<CopyState>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])
  const copy = () => {
    // Without a secure origin there is no clipboard API, so this rejects too.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text()))
      .then(
        () => {
          setState('copied')
          announce(`Copied ${what} ${purpose}.`)
        },
        () => {
          setState('failed')
          announce(`Couldn't copy ${what}.`, 'assertive')
        },
      )
  }
  const shown = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label
  const Icon = state === 'copied' ? Check : ClipboardCopy
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${what} ${purpose}`}
      title={iconOnly ? shown : undefined}
      className={iconOnly
        ? 'grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-fg'
        : 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-fg'}
    >
      <Icon aria-hidden="true" className={iconOnly ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={1.8} />
      {iconOnly ? null : shown}
    </button>
  )
}
