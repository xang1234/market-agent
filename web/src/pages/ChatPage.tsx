import { useCallback, useEffect, useMemo, useReducer, useState, type FormEvent } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'

import { INITIAL_STREAM_STATE, applyChatStreamEvent } from '../chat/streamReducer.ts'
import { StreamingTurnView } from '../chat/StreamingTurnView.tsx'
import type { ChatSseEvent } from '../chat/sseEventTypes.ts'
import { useAuth } from '../shell/useAuth.ts'

type ChatThread = {
  thread_id: string
  title: string | null
  updated_at: string
}

type ThreadListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; threads: ReadonlyArray<ChatThread> }

export function ChatLayout() {
  const { session } = useAuth()
  const userId = session?.userId ?? ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-neutral-200 px-8 py-6 dark:border-neutral-800">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Thread-scoped research workspace with live analyst turns, strict Block[] rendering,
          and reusable artifacts.
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 border-r border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
          <ThreadList userId={userId} />
        </aside>
        <div className="min-h-0 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export function ChatEmptyState() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session || pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/v1/chat/threads', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': session.userId,
        },
        body: JSON.stringify({ title: title.trim() || null }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const thread = (await response.json()) as ChatThread
      navigate(`/chat/${thread.thread_id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div data-testid="chat-empty" className="flex min-h-full flex-col gap-6 p-8">
      <section className="rounded-md border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Start research</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Create a thread, ask the analyst, and keep each answer pinned to its sealed
          snapshot.
        </p>
        <form onSubmit={startThread} className="mt-5 flex max-w-2xl gap-3">
          <input
            aria-label="Thread title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="Optional thread title"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Start research
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
      </section>
    </div>
  )
}

export function ChatThreadView() {
  const { session } = useAuth()
  const { threadId = '' } = useParams<{ threadId: string }>()
  const [prompt, setPrompt] = useState('')
  const [transcript, setTranscript] = useState<ReadonlyArray<{ role: 'user'; text: string }>>([])
  const [state, dispatch] = useReducer(applyChatStreamEvent, INITIAL_STREAM_STATE)
  const [streamError, setStreamError] = useState<string | null>(null)

  const submitPrompt = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const text = prompt.trim()
      if (!session || text.length === 0) return

      setTranscript((current) => [...current, { role: 'user', text }])
      setPrompt('')
      setStreamError(null)
      const runId = makeRunId()
      const params = new URLSearchParams({ run_id: runId, turn_id: runId, subject: text })
      const source = new EventSource(`/v1/chat/threads/${encodeURIComponent(threadId)}/stream?${params}`)
      source.onmessage = (event) => {
        dispatch(JSON.parse(event.data) as ChatSseEvent)
      }
      for (const type of [
        'turn.started',
        'tool.started',
        'tool.completed',
        'snapshot.staged',
        'snapshot.sealed',
        'block.began',
        'block.delta',
        'block.completed',
        'turn.completed',
        'turn.error',
      ] as const) {
        source.addEventListener(type, (event) => {
          dispatch(JSON.parse((event as MessageEvent).data) as ChatSseEvent)
          if (type === 'turn.completed' || type === 'turn.error') source.close()
        })
      }
      source.onerror = () => {
        setStreamError('The analyst stream disconnected.')
        source.close()
      }
    },
    [prompt, session, threadId],
  )

  return (
    <div data-testid="chat-thread" className="flex min-h-full flex-col">
      <section className="border-b border-neutral-200 px-8 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Message stream
        </h2>
        <p className="mt-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">{threadId}</p>
      </section>
      <div className="flex flex-1 flex-col gap-3 p-6">
        {transcript.map((message, index) => (
          <div
            key={`${message.text}-${index}`}
            className="self-end rounded-md bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {message.text}
          </div>
        ))}
        <StreamingTurnView state={state} />
        {streamError ? <p className="text-sm text-rose-600 dark:text-rose-300">{streamError}</p> : null}
      </div>
      <form onSubmit={submitPrompt} className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200" htmlFor="chat-composer">
          Ask the analyst
        </label>
        <div className="mt-2 flex gap-3">
          <textarea
            id="chat-composer"
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            rows={2}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="Ask about a company, theme, screen, or prior artifact"
          />
          <button
            type="submit"
            className="self-end rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}

function ThreadList({ userId }: { userId: string }) {
  const [state, setState] = useState<ThreadListState>({ kind: 'loading' })

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    fetch('/v1/chat/threads', {
      headers: { 'x-user-id': userId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as { threads: ChatThread[] }
      })
      .then((body) => setState({ kind: 'ready', threads: body.threads }))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') {
          setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => controller.abort()
  }, [userId])

  const rows = useMemo(() => (state.kind === 'ready' ? state.threads : []), [state])

  return (
    <nav aria-label="Thread list" className="flex min-h-0 flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Thread list</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Persistent research threads scoped to your session.
        </p>
      </div>
      {state.kind === 'error' ? (
        <p className="text-xs text-rose-600 dark:text-rose-300">{state.message}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
          No threads yet.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-auto">
          {rows.map((thread) => (
            <li key={thread.thread_id}>
              <Link
                to={`/chat/${thread.thread_id}`}
                className="block rounded-md border border-neutral-200 bg-white p-3 text-sm hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                  {thread.title ?? 'Untitled thread'}
                </span>
                <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
                  {new Date(thread.updated_at).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

function makeRunId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID()
  return `00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString().padStart(12, '0')}`
}
