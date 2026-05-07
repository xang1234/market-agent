import { useEffect, useMemo, useReducer, useState, type FormEvent } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'

import { BlockView, type Block } from '../blocks'
import { openChatTurnStream } from '../chat/openChatTurnStream.ts'
import { INITIAL_STREAM_STATE, applyChatStreamEvent } from '../chat/streamReducer.ts'
import { StreamingTurnView } from '../chat/StreamingTurnView.tsx'
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

export type PersistedChatMessage = {
  message_id: string
  thread_id: string
  role: 'user' | 'assistant' | 'tool'
  snapshot_id: string
  blocks: ReadonlyArray<Block>
  content_hash: string
  created_at: string
}

type MessageHistoryState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; messages: ReadonlyArray<PersistedChatMessage> }

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
  const [history, setHistory] = useState<MessageHistoryState>({ kind: 'idle' })
  const [historyReloadKey, setHistoryReloadKey] = useState(0)
  const [state, dispatch] = useReducer(applyChatStreamEvent, INITIAL_STREAM_STATE)
  const [streamError, setStreamError] = useState<string | null>(null)

  useEffect(() => {
    if (!session || !threadId) return
    const controller = new AbortController()
    fetch(`/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      headers: { 'x-user-id': session.userId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as { messages?: PersistedChatMessage[] }
      })
      .then((body) => {
        setHistory({ kind: 'ready', messages: body.messages ?? [] })
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setHistory({ kind: 'error', message: caught instanceof Error ? caught.message : String(caught) })
      })
    return () => controller.abort()
  }, [session, threadId, historyReloadKey])

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = prompt.trim()
    if (!session || text.length === 0) return

    setStreamError(null)
    const runId = makeRunId()
    const messageId = makeRunId()
    const snapshotId = makeRunId()
    try {
      const message = await persistUserChatTurn({
        threadId,
        userId: session.userId,
        messageId,
        snapshotId,
        content: text,
      })
      setHistory((current) => {
        if (current.kind !== 'ready') return { kind: 'ready', messages: [message] }
        if (current.messages.some((existing) => existing.message_id === message.message_id)) return current
        return { kind: 'ready', messages: [...current.messages, message] }
      })
      setPrompt('')
    } catch (caught) {
      setStreamError(`Message save failed: ${caught instanceof Error ? caught.message : String(caught)}`)
      return
    }
    openChatTurnStream({
      threadId,
      runId,
      userIntent: text,
      userId: session.userId,
    }, {
      onEvent: dispatch,
      onCompleted: () => setHistoryReloadKey((current) => current + 1),
      onError: () => setStreamError('The analyst stream disconnected.'),
    })
  }

  return (
    <div data-testid="chat-thread" className="flex min-h-full flex-col">
      <section className="border-b border-neutral-200 px-8 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
          Message stream
        </h2>
        <p className="mt-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">{threadId}</p>
      </section>
      <div className="flex flex-1 flex-col gap-3 p-6">
        {history.kind === 'loading' ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading message history.</p>
        ) : null}
        {history.kind === 'error' ? (
          <p className="text-sm text-rose-600 dark:text-rose-300">Message history unavailable: {history.message}</p>
        ) : null}
        {history.kind === 'ready' ? (
          <PersistedMessageHistory messages={history.messages} />
        ) : null}
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

function PersistedMessageHistory({ messages }: { messages: ReadonlyArray<PersistedChatMessage> }) {
  if (messages.length === 0) return null
  return (
    <section className="flex flex-col gap-3" aria-label="Persisted message history">
      {messages.map((message) => (
        <article
          key={message.message_id}
          className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold capitalize text-neutral-900 dark:text-neutral-100">
              {message.role}
            </h3>
            <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
              {new Date(message.created_at).toLocaleString()}
            </span>
          </div>
          {message.role === 'assistant' ? (
            <div className="flex flex-col gap-3">
              {message.blocks.map((block) => (
                <BlockView key={`${message.message_id}-${block.id}`} block={block} />
              ))}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-200">
              {message.blocks.map((block) => blockText(block)).join('\n')}
            </pre>
          )}
        </article>
      ))}
    </section>
  )
}

export async function persistUserChatTurn(input: {
  threadId: string
  userId: string
  messageId: string
  snapshotId: string
  content: string
}): Promise<PersistedChatMessage> {
  const response = await fetch(`/v1/chat/threads/${encodeURIComponent(input.threadId)}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': input.userId,
    },
    body: JSON.stringify({
      message_id: input.messageId,
      snapshot_id: input.snapshotId,
      content: input.content,
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as { message?: PersistedChatMessage }
  if (!body.message) throw new Error('message missing from response')
  return body.message
}

function blockText(block: Block): string {
  const segments = 'segments' in block && Array.isArray(block.segments) ? block.segments : []
  const text = segments
    .map((segment) => (typeof segment === 'object' && segment !== null && 'text' in segment ? String(segment.text) : ''))
    .join('')
  return text || JSON.stringify(block)
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
