import { Outlet, useParams } from 'react-router-dom'

// Chat is a thread-scoped surface: `/chat` shows an empty-thread state and
// `/chat/:threadId` shows a specific thread. Per spec §3.7 / bead fra-6al.2.1,
// Chat stays thread-scoped (not symbol-scoped) so threads can span themes,
// multiple subjects, or imported Analyze artifacts.
//
// ChatLayout is the route-level element; the <ProtectedSurface> guard lives
// in App.tsx on the parent route so `index` + `:threadId` both inherit it
// without each needing its own wrap. P2.1 (fra-2fu.1 thread coordinator)
// will replace this with the real layout: persistent thread list + SSE
// transport + composer.

export function ChatLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-neutral-200 px-8 py-6 dark:border-neutral-800">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Thread-scoped research interface. Full surface ships with P2.1
          (thread coordinator + SSE).
        </p>
      </header>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}

export function ChatEmptyState() {
  return (
    <div
      data-testid="chat-empty"
      className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-500 dark:text-neutral-400"
    >
      <div>
        <p className="font-medium text-neutral-700 dark:text-neutral-300">
          No thread selected
        </p>
        <p className="mt-1">
          Thread list + composer ship with P2.1. Open <code>/chat/:threadId</code> to
          render a thread view.
        </p>
      </div>
    </div>
  )
}

export function ChatThreadView() {
  const { threadId } = useParams<{ threadId: string }>()
  return (
    <div data-testid="chat-thread" className="flex flex-1 flex-col gap-6 p-8">
      <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        Thread <code className="font-mono text-neutral-700 dark:text-neutral-200">{threadId}</code>{' '}
        — message stream + composer ship with P2.1 (thread coordinator + SSE).
      </div>
    </div>
  )
}
