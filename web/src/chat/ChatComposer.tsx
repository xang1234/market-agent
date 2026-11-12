import { useImperativeHandle, useState, type FormEvent, type ReactElement, type Ref } from 'react'

import { handleComposerKeyDownEvent } from './composer.ts'
import { readDraft, writeDraft } from './composerDrafts.ts'
import { ThreadColumn } from './turnLayout.tsx'

export type ChatComposerHandle = {
  // The question this composer sent created a thread: the text on screen moves
  // there with it instead of being swapped for that thread's saved draft.
  carryInto: (scope: string) => void
}

type ChatComposerProps = {
  // Which saved draft this composer edits: one per user and thread.
  draftScope: string
  ref?: Ref<ChatComposerHandle>
  canAsk: boolean
  onAsk: (text: string) => boolean
  // While a run is followed the send button is a Stop button; it stays typable.
  stop: 'none' | 'ready' | 'stopping'
  onStop: () => void
}

export function ChatComposer({ ref, draftScope, canAsk, onAsk, stop, onStop }: ChatComposerProps): ReactElement {
  const [prompt, setPromptState] = useState(() => readDraft(draftScope))
  // Stays mounted across threads, so focus survives; each thread brings its own draft.
  const [shownScope, setShownScope] = useState(draftScope)
  const [carryScope, setCarryScope] = useState<string | null>(null)
  useImperativeHandle(ref, () => ({ carryInto: setCarryScope }), [])
  if (shownScope !== draftScope) {
    setShownScope(draftScope)
    setCarryScope(null)
    if (draftScope !== carryScope) setPromptState(readDraft(draftScope))
  }
  const setPrompt = (text: string) => {
    setPromptState(text)
    writeDraft(draftScope, text)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (onAsk(prompt)) setPrompt('')
  }

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-line bg-surface/70 p-4 backdrop-blur">
      <ThreadColumn>
        <label className="sr-only" htmlFor="chat-composer">
          Ask the analyst
        </label>
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-3 py-2.5 shadow-md transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
          <textarea
            id="chat-composer"
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDownEvent}
            rows={2}
            className="field-sizing-content max-h-60 min-h-10 min-w-0 flex-1 resize-none border-none bg-transparent text-sm text-fg outline-none placeholder:text-faint"
            placeholder="Ask about a company, theme, screen, or prior artifact"
          />
          {stop === 'none' ? (
            <button
              type="submit"
              disabled={!canAsk}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-strong text-base font-bold text-on-accent disabled:opacity-50"
              aria-label="Send"
            >
              ↑
            </button>
          ) : (
            <button
              type="button"
              onClick={onStop}
              disabled={stop === 'stopping'}
              title={stop === 'stopping' ? 'Stopping' : 'Stop generation'}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-negative text-white shadow-sm transition-colors hover:opacity-90 disabled:cursor-default disabled:opacity-60"
              aria-label={stop === 'stopping' ? 'Stopping' : 'Stop generation'}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <rect x="2" y="2" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">Press <span className="font-medium text-muted">Enter</span> to send · <span className="font-medium text-muted">Shift+Enter</span> for a newline</p>
      </ThreadColumn>
    </form>
  )
}
