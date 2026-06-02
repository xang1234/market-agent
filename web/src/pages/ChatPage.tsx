import React, { useEffect, useMemo, useReducer, useState, type FormEvent } from 'react'
import { PRIMARY_BUTTON_CLASS } from '../shell/buttonStyles.ts'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'

import { VirtualizedMessageList } from '../chat'
import type { ChatMessage as PersistedChatMessage } from '../chat/messageTypes.ts'
import { openChatTurnStream } from '../chat/openChatTurnStream.ts'
import { persistUserChatTurn } from '../chat/persistUserChatTurn.ts'
import { INITIAL_STREAM_STATE, applyChatStreamEvent } from '../chat/streamReducer.ts'
import { StreamingTurnView } from '../chat/StreamingTurnView.tsx'
import { ThreadColumn } from '../chat/turnLayout.tsx'
import { authenticatedFetch, authenticatedJson } from '../http/authFetch.ts'
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

type PendingChatTurn = {
  runId: string
  messageId: string
  snapshotId: string
  text: string
}

type MessageHistoryState =
  | { kind: 'idle' }
  | { kind: 'error'; requestKey: string; message: string }
  | { kind: 'ready'; requestKey: string; messages: ReadonlyArray<PersistedChatMessage> }

export function ChatLayout() {
  const { session } = useAuth()
  const userId = session?.userId ?? ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-8 py-6">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="mt-1 text-sm text-muted">
          Thread-scoped research workspace with live analyst turns, strict Block[] rendering,
          and reusable artifacts.
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 border-r border-line bg-surface-2/70 p-4/40">
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
      const thread = await authenticatedJson<ChatThread>('/v1/chat/threads', {
        userId: session.userId,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: title.trim() || null }),
      })
      navigate(`/chat/${thread.thread_id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div data-testid="chat-empty" className="flex min-h-full flex-col gap-6 p-8">
      <section className="rounded-md border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold text-fg">Start research</h2>
        <p className="mt-2 text-sm text-fg-soft">
          Create a thread, ask the analyst, and keep each answer pinned to its sealed
          snapshot.
        </p>
        <form onSubmit={startThread} className="mt-5 flex max-w-2xl gap-3">
          <input
            aria-label="Thread title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="Optional thread title"
            className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className={`${PRIMARY_BUTTON_CLASS} disabled:opacity-60`}
          >
            Start research
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}
      </section>
    </div>
  )
}

export function handleComposerKeyDownEvent(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
}

export function ChatThreadView() {
  const { session } = useAuth()
  const { threadId = '' } = useParams<{ threadId: string }>()
  const [prompt, setPrompt] = useState('')
  const [history, setHistory] = useState<MessageHistoryState>({ kind: 'idle' })
  const [historyReloadKey, setHistoryReloadKey] = useState(0)
  const [state, dispatch] = useReducer(applyChatStreamEvent, INITIAL_STREAM_STATE)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [failedTurn, setFailedTurn] = useState<PendingChatTurn | null>(null)
  const historyRequestKey = session && threadId ? `${session.userId}:${threadId}:${historyReloadKey}` : ''
  const visibleHistory: MessageHistoryState | { kind: 'loading' } =
    !session || !threadId
      ? { kind: 'idle' }
      : history.kind !== 'idle' && history.requestKey === historyRequestKey
        ? history
        : { kind: 'loading' }

  useEffect(() => {
    if (!session || !threadId) return
    const controller = new AbortController()
    authenticatedJson<{ messages?: PersistedChatMessage[] }>(`/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      userId: session.userId,
      signal: controller.signal,
    })
      .then((body) => {
        setHistory({ kind: 'ready', requestKey: historyRequestKey, messages: body.messages ?? [] })
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setHistory({
          kind: 'error',
          requestKey: historyRequestKey,
          message: caught instanceof Error ? caught.message : String(caught),
        })
      })
    return () => controller.abort()
  }, [session, threadId, historyRequestKey])

  const startPersistedTurn = (turn: PendingChatTurn) => {
    if (!session) return
    setStreamError(null)
    setFailedTurn(null)
    openChatTurnStream({
      threadId,
      runId: turn.runId,
      turnId: turn.messageId,
      userIntent: turn.text,
      userId: session.userId,
    }, {
      onEvent: dispatch,
      onCompleted: () => {
        setFailedTurn(null)
        setHistoryReloadKey((current) => current + 1)
      },
      onError: () => {
        setFailedTurn(turn)
        setStreamError('The analyst stream disconnected.')
      },
    })
  }

  const handleComposerKeyDown = handleComposerKeyDownEvent

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = prompt.trim()
    if (!session || text.length === 0) return

    const turn: PendingChatTurn = {
      runId: makeRunId(),
      messageId: makeRunId(),
      snapshotId: makeRunId(),
      text,
    }
    try {
      const message = await persistUserChatTurn({
        threadId,
        userId: session.userId,
        messageId: turn.messageId,
        snapshotId: turn.snapshotId,
        content: turn.text,
      })
      setHistory((current) => {
        if (current.kind !== 'ready' || current.requestKey !== historyRequestKey) {
          return { kind: 'ready', requestKey: historyRequestKey, messages: [message] }
        }
        if (current.messages.some((existing) => existing.message_id === message.message_id)) return current
        return { kind: 'ready', requestKey: historyRequestKey, messages: [...current.messages, message] }
      })
      setPrompt('')
    } catch (caught) {
      setStreamError(`Message save failed: ${caught instanceof Error ? caught.message : String(caught)}`)
      return
    }
    startPersistedTurn(turn)
  }

  return (
    <div data-testid="chat-thread" className="flex min-h-full flex-col">
      <section className="border-b border-line px-6 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Message stream
        </h2>
        <p className="num mt-0.5 text-xs text-faint">{threadId}</p>
      </section>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {visibleHistory.kind === 'ready' ? (
          <PersistedMessageHistory messages={visibleHistory.messages} />
        ) : null}
        {/* Transient thread content shares one reading column; the persisted
            list above owns its own column so its scrollbar stays edge-aligned. */}
        <ThreadColumn className="flex flex-col gap-4">
          {visibleHistory.kind === 'loading' ? (
            <p className="text-sm text-muted">Loading message history.</p>
          ) : null}
          {visibleHistory.kind === 'error' ? (
            <p className="text-sm text-negative">
              Message history unavailable: {visibleHistory.message}
            </p>
          ) : null}
          <StreamingTurnView state={state} />
          {streamError ? (
            <div className="flex items-center gap-3 text-sm">
              <p className="text-negative">{streamError}</p>
              {failedTurn ? (
                <button
                  type="button"
                  onClick={() => startPersistedTurn(failedTurn)}
                  className="rounded-md border border-negative px-3 py-1.5 text-xs font-medium text-negative"
                >
                  Retry stream
                </button>
              ) : null}
            </div>
          ) : null}
        </ThreadColumn>
      </div>
      <form
        onSubmit={submitPrompt}
        className="sticky bottom-0 border-t border-line bg-surface/70 p-4 backdrop-blur"
      >
        <ThreadColumn>
          <label className="sr-only" htmlFor="chat-composer">
            Ask the analyst
          </label>
          <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface px-3 py-2.5 shadow-md">
            <textarea
              id="chat-composer"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={handleComposerKeyDown}
              rows={2}
              className="min-w-0 flex-1 resize-none border-none bg-transparent text-sm text-fg outline-none placeholder:text-faint"
              placeholder="Ask about a company, theme, screen, or prior artifact"
            />
            <button
              type="submit"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-strong text-base font-bold text-on-accent"
              aria-label="Send"
            >
              ↑
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-faint">Press <span className="font-medium text-muted">Enter</span> to send · <span className="font-medium text-muted">Shift+Enter</span> for a newline</p>
        </ThreadColumn>
      </form>
    </div>
  )
}

function PersistedMessageHistory({ messages }: { messages: ReadonlyArray<PersistedChatMessage> }) {
  if (messages.length === 0) return null
  return (
    <section className="flex min-h-[24rem] flex-1 flex-col" aria-label="Persisted message history">
      <VirtualizedMessageList messages={messages} />
    </section>
  )
}

function ThreadList({ userId }: { userId: string }) {
  const [state, setState] = useState<ThreadListState>({ kind: 'loading' })

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    authenticatedFetch('/v1/chat/threads', {
      userId,
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
        <h2 className="text-sm font-semibold text-fg">Thread list</h2>
        <p className="mt-1 text-xs text-muted">
          Persistent research threads scoped to your session.
        </p>
      </div>
      {state.kind === 'error' ? (
        <p className="text-xs text-negative">{state.message}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-3 text-xs text-muted">
          No threads yet.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-auto">
          {rows.map((thread) => (
            <li key={thread.thread_id}>
              <Link
                to={`/chat/${thread.thread_id}`}
                className="block rounded-md border border-line bg-surface p-3 text-sm hover:border-line-strong"
              >
                <span className="block font-medium text-fg">
                  {thread.title ?? 'Untitled thread'}
                </span>
                <span className="mt-1 block text-xs text-muted">
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
