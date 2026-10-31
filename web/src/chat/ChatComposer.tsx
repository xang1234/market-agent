import { useState, type FormEvent, type ReactElement } from 'react'

import { handleComposerKeyDownEvent } from './composer.ts'
import { readDraft, writeDraft } from './composerDrafts.ts'
import { ThreadColumn } from './turnLayout.tsx'

type ChatComposerProps = {
  // Which saved draft this composer edits: one per user and thread.
  draftScope: string
  canAsk: boolean
  onAsk: (text: string) => boolean
}

export function ChatComposer({ draftScope, canAsk, onAsk }: ChatComposerProps): ReactElement {
  const [prompt, setPromptState] = useState(() => readDraft(draftScope))
  const setPrompt = (text: string) => {
    setPromptState(text)
    writeDraft(draftScope, text)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (onAsk(prompt)) setPrompt('')
  }

  return (
    <form onSubmit={submit} className="sticky bottom-0 border-t border-line bg-surface/70 p-4 backdrop-blur">
      <ThreadColumn>
        <label className="sr-only" htmlFor="chat-composer">
          Ask the analyst
        </label>
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-3 py-2.5 shadow-md">
          <textarea
            id="chat-composer"
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDownEvent}
            rows={2}
            className="field-sizing-content max-h-60 min-h-10 min-w-0 flex-1 resize-none border-none bg-transparent text-sm text-fg outline-none placeholder:text-faint"
            placeholder="Ask about a company, theme, screen, or prior artifact"
          />
          <button
            type="submit"
            disabled={!canAsk}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-strong text-base font-bold text-on-accent disabled:opacity-50"
            aria-label="Send"
          >
            ↑
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">Press <span className="font-medium text-muted">Enter</span> to send · <span className="font-medium text-muted">Shift+Enter</span> for a newline</p>
      </ThreadColumn>
    </form>
  )
}
