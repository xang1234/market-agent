export function ChatPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Thread-scoped research interface. Full surface ships with P2.1 (thread coordinator + SSE).
        </p>
      </header>
      <div className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        Chat thread list + composer — protected, requires session.
      </div>
    </div>
  )
}
