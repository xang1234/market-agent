import { useEffect, useMemo, type ReactElement } from 'react'

import { isTypingTarget } from '../shell/isTypingTarget.ts'
import { ALL_OF_THE_ABOVE } from './offeredChoices.ts'

// Each offered option as a button the reader can click or pick with keys 1-9.
export function ChoiceBar({ choices, onAsk }: { choices: ReadonlyArray<string>; onAsk: (text: string) => boolean }): ReactElement | null {
  const options = useMemo(() => choices.length > 1 ? [...choices, ALL_OF_THE_ABOVE] : choices, [choices])
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return
      const option = /^[1-9]$/.test(event.key) ? options[Number(event.key) - 1] : undefined
      if (option === undefined) return
      event.preventDefault()
      onAsk(option)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [options, onAsk])
  if (options.length === 0) return null
  return (
    <div data-testid="clarification-choices" role="group" aria-label="Answer the question" className="flex flex-wrap gap-2 py-2">
      {options.map((option, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onAsk(option)}
          className="flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent"
        >
          {index < 9 ? (
            <kbd aria-hidden="true" className="num rounded border border-line px-1 text-[10px] text-faint">{index + 1}</kbd>
          ) : null}
          {option}
        </button>
      ))}
    </div>
  )
}
