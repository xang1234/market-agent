// Importing this module turns the page into the demo: it installs the in-page backend
// when it loads, so the banner never shows without the replay behind it, or the replay
// without the banner. (react-refresh/only-export-components keeps the backend in its
// own module.)
import type { ReactNode } from 'react'
import { StarterQuestionsContext } from '../chat/starterQuestions.ts'
import { DEMO_QUESTIONS, installDemoBackend } from './demoBackend.ts'

// Per tab, and it survives a reload.
installDemoBackend(sessionStorage)

/** The app under an always-visible note that every answer is recorded. */
export function DemoFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <aside
        role="note"
        aria-label="About this demo"
        className="border-b border-warning bg-warning-soft px-4 py-2 text-sm text-warning"
      >
        Recorded demo: every answer replays one recorded conversation; nothing is generated live
        and there is no backend. In Chat, ask in order:{' '}
        {DEMO_QUESTIONS.map((q, i) => (
          <span key={q}>
            {i > 0 ? ' → ' : null}
            <q>{q}</q>
          </span>
        ))}
        .
      </aside>
      <div className="min-h-0 flex-1">
        {/* The replay answers its questions in order, so a new chat can start with the first only. */}
        <StarterQuestionsContext.Provider value={DEMO_QUESTIONS.slice(0, 1)}>{children}</StarterQuestionsContext.Provider>
      </div>
    </div>
  )
}
