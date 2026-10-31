import { createPortal } from 'react-dom'
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useMatch, useNavigate } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'

import { PRIMARY_BUTTON_CLASS } from '../shell/buttonStyles.ts'
import { VirtualizedMessageList } from '../chat'
import { ChatComposer, type ChatComposerHandle } from '../chat/ChatComposer.tsx'
import { PendingTurnView } from '../chat/PendingTurnView.tsx'
import { ThreadColumn } from '../chat/turnLayout.tsx'
import { FailureNotice } from '../ui/FailureNotice.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { formatRelativeTime, useMinuteClock } from '../ui/relativeTime.ts'
import { renameThread, type ChatThread } from '../chat/threadActions.ts'
import { useAuth } from '../shell/useAuth.ts'
import { cancelThreadDelete, startThreadDelete, useThreadDeletes } from '../chat/threadDeletes.ts'
import { StarterQuestionsContext } from '../chat/starterQuestions.ts'
import { threadDisplayName } from '../chat/threadName.ts'
import { useChatSession, type ChatSession } from '../chat/useChatSession.ts'
import { useThreadList, useTitleFollowUp, type ThreadListState } from '../chat/useThreadList.ts'
import { useSidebarSlot } from '../shell/useSidebarSlot.ts'
import { moveDraft } from '../chat/composerDrafts.ts'


export function ChatLayout() {
  const { session } = useAuth()
  const userId = session?.userId ?? ''
  const navigate = useNavigate()
  const routeThreadId = useMatch('/chat/:threadId')?.params.threadId ?? null
  const threads = useThreadList(userId)
  const { sent } = useThreadDeletes()
  useEffect(() => {
    if (routeThreadId !== null && sent.has(routeThreadId)) navigate('/chat', { replace: true })
  }, [routeThreadId, sent, navigate])
  // Route changes only, never `sent`: a store change can render before a delete's navigation
  // away lands, and re-running here would cancel the delete just started.
  useEffect(() => {
    if (routeThreadId !== null) cancelThreadDelete(routeThreadId)
  }, [routeThreadId])
  const { refresh: refreshThreads } = threads
  // A question typed while the first one creates its thread belongs to that
  // thread, unless the reader has since left the screen that sent it.
  const composer = useRef<ChatComposerHandle>(null)
  const onThreadCreated = useCallback(
    (threadId: string, owned: boolean) => {
      if (owned) {
        moveDraft(`${userId}:new`, `${userId}:${threadId}`)
        composer.current?.carryInto(`${userId}:${threadId}`)
      }
      refreshThreads()
    },
    [userId, refreshThreads],
  )
  const chat = useChatSession({ userId, threadId: routeThreadId, navigate, onThreadCreated })
  const activeThreadId = chat.view.threadId
  const activeThread = threads.state.kind === 'ready'
    ? threads.state.threads.find((thread) => thread.thread_id === activeThreadId)
    : undefined
  const threadName = threadDisplayName(activeThread, chat.view.firstQuestion)
  useTitleFollowUp({
    threadId: activeThreadId,
    sealedTurns: chat.view.sealedTurns,
    titled: Boolean(activeThread?.title?.trim()),
    refresh: threads.refresh,
  })
  const draftScope = `${userId}:${routeThreadId ?? 'new'}`
  const sidebar = useSidebarSlot()
  const { setClaimed } = sidebar
  // Before paint, so the watchlist never flashes in the slot on the way in.
  useLayoutEffect(() => {
    setClaimed(true)
    return () => setClaimed(false)
  }, [setClaimed])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sidebar.node && !sidebar.collapsed
        ? createPortal(
            <ThreadList
              userId={userId}
              state={threads.state}
              activeThreadId={activeThreadId}
              activeName={threadName}
              refresh={threads.refresh}
            />,
            sidebar.node,
          )
        : null}
      {chat.view.canvas === 'thread'
        ? <ChatThreadView chat={chat} threadName={threadName} />
        : <ChatEmptyState chat={chat} />}
      <ChatComposer
        ref={composer}
        draftScope={draftScope}
        canAsk={chat.view.canAsk}
        onAsk={chat.ask}
      />
    </div>
  )
}

function ChatEmptyState({ chat }: { chat: ChatSession }) {
  const starterQuestions = useContext(StarterQuestionsContext)
  return (
    <div data-testid="chat-empty" className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-8">
      <section className="rounded-md border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold text-fg">Start research</h2>
        <p className="mt-2 text-sm text-fg-soft">
          Ask the analyst about a company, theme, or screen. Each answer stays pinned to its
          sealed snapshot.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {starterQuestions.map((question) => (
            <button
              key={question}
              type="button"
              disabled={!chat.view.canAsk}
              onClick={() => chat.ask(question)}
              className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent disabled:opacity-60"
            >
              {question}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function ChatThreadView({ chat, threadName }: { chat: ChatSession; threadName: string }) {
  const { view } = chat

  return (
    <div data-testid="chat-thread" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-6 py-2.5">
        <h1 data-testid="thread-name" className="truncate text-sm font-medium text-fg">{threadName}</h1>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {view.history === 'loading' ? (
          <ThreadColumn>
            <div className="flex flex-col gap-3">
              <Skeleton label="Loading message history" className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-24" />
            </div>
          </ThreadColumn>
        ) : null}
        {view.history === 'error' ? (
          <ThreadColumn>
            <FailureNotice message="Couldn't load this chat." detail={view.historyError ?? ''} onRetry={chat.reload} />
          </ThreadColumn>
        ) : null}
        {view.listMounted ? (
          <section className="flex min-h-0 flex-1 flex-col" aria-label="Persisted message history">
            <VirtualizedMessageList
              key={view.listKey}
              messages={view.messages}
              tail={<PendingTurnView turn={view.turn} messages={view.messages} onRetry={chat.retry} onReconnect={chat.reconnect} onReload={chat.reload} onAsk={chat.ask} />}
            />
          </section>
        ) : null}
      </div>
    </div>
  )
}

function ThreadList({
  userId,
  state,
  activeThreadId,
  activeName,
  refresh,
}: {
  userId: string
  state: ThreadListState
  activeThreadId: string | null
  activeName: string
  refresh: () => void
}) {
  const navigate = useNavigate()
  const { pending, error: deleteError } = useThreadDeletes()
  const rows = state.kind === 'ready' ? state.threads : []
  const now = useMinuteClock()
  const list = useRef<HTMLUListElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // A new name shows until the server's title moves off the one it replaced.
  // Once the server confirms it, it shows only until the next list arrives, so
  // any later title, even the one it replaced, is the server's to give.
  type Rename = { title: string; replaced: string | null; confirmedBefore: ReadonlyArray<ChatThread> | null }
  const [renamed, setRenamed] = useState<Record<string, Rename>>({})
  const [renameError, setRenameError] = useState<string | null>(null)
  // The row's link only exists again after the editor closes.
  const refocusRow = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (editing !== null || refocusRow.current === null) return
    list.current?.querySelector<HTMLElement>(`[data-thread-id="${refocusRow.current}"]`)?.focus()
    refocusRow.current = null
  }, [editing])
  const finishRename = (threadId: string, replaced: string | null, next: string | null, byKey: boolean) => {
    // Leaving the field by clicking or tabbing elsewhere keeps focus there.
    if (byKey) refocusRow.current = threadId
    setEditing(null)
    const title = next?.trim() ?? ''
    if (title === '') return
    setRenamed((current) => ({ ...current, [threadId]: { title, replaced, confirmedBefore: null } }))
    setRenameError(null)
    const listAtRename = rows
    renameThread(userId, threadId, title).then(() => {
      setRenamed((current) => {
        const rename = current[threadId]
        return rename?.title === title ? { ...current, [threadId]: { ...rename, confirmedBefore: listAtRename } } : current
      })
      refresh()
    }, (caught: unknown) => {
      setRenamed((current) => {
        const rest = { ...current }
        delete rest[threadId]
        return rest
      })
      setRenameError(caught instanceof Error ? caught.message : String(caught))
    })
  }
  const undoButton = useRef<HTMLButtonElement>(null)
  // Only the delete click moves focus; coming back to a pending delete doesn't.
  const focusUndo = useRef(false)
  useEffect(() => {
    if (!focusUndo.current) return
    focusUndo.current = false
    undoButton.current?.focus()
  }, [pending])
  const newChatButton = useRef<HTMLButtonElement>(null)
  const undoLostFocus = useRef<{ button: HTMLButtonElement; row: Element | null; neighbour: Element | null } | null>(null)
  // React detaches the ref before it removes the button, so focus can still be read here.
  const undoRef = useCallback((button: HTMLButtonElement) => {
    undoButton.current = button
    return () => {
      undoButton.current = null
      if (button.ownerDocument.activeElement !== button) return
      const row = button.closest('li')
      undoLostFocus.current = { button, row, neighbour: row?.nextElementSibling ?? row?.previousElementSibling ?? null }
    }
  }, [])
  useEffect(() => {
    const lost = undoLostFocus.current
    if (lost === null) return
    undoLostFocus.current = null
    // Restore only if focus fell to the page or stayed on the node React reused as Delete;
    // the [pending] effect may already have focused a new Undo.
    const { activeElement, body } = lost.button.ownerDocument
    if (activeElement !== null && activeElement !== body && activeElement !== lost.button) return
    const link = [lost.row, lost.neighbour].find((row) => row?.isConnected)?.querySelector('a')
    ;(link ?? newChatButton.current)?.focus()
  })

  return (
    <nav aria-label="Chats" className="flex min-h-0 flex-1 flex-col gap-2">
      <button
        ref={newChatButton}
        type="button"
        onClick={() => navigate('/chat')}
        className={`${PRIMARY_BUTTON_CLASS} w-full justify-center`}
      >
        + New chat
      </button>
      {deleteError ? <FailureNotice message="Couldn't delete the chat." detail={deleteError.message} announce={false} /> : null}
      {renameError ? <FailureNotice message="Couldn't rename the chat." detail={renameError} /> : null}
      <h2 className="mt-1 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">Chats</h2>
      {state.kind === 'loading' ? (
        <div className="flex flex-col gap-2">
          <Skeleton label="Loading chats" className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : state.kind === 'error' ? (
        <FailureNotice message="Couldn't load your chats." detail={state.message} onRetry={refresh} />
      ) : rows.length === 0 ? (
        <p className="px-1.5 text-xs text-muted">
          No chats yet.
        </p>
      ) : (
        <ul ref={list} className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          {rows.map((thread) => {
            if (thread.thread_id === pending?.threadId) {
              return (
                <li
                  key={thread.thread_id}
                  className="flex items-center justify-between rounded-md border border-dashed border-line-strong px-2.5 py-2 text-xs text-muted"
                >
                  <span aria-hidden="true">Chat deleted.</span>
                  <button
                    ref={undoRef}
                    type="button"
                    aria-label={`Undo deleting ${pending.name}`}
                    onClick={() => cancelThreadDelete(pending.threadId)}
                    className="font-medium text-fg hover:underline"
                  >
                    Undo
                  </button>
                </li>
              )
            }
            const active = thread.thread_id === activeThreadId
            const override = renamed[thread.thread_id]
            const overrideShows = override !== undefined && (override.confirmedBefore === null
              ? thread.title === override.replaced
              : rows === override.confirmedBefore)
            const name = overrideShows
              ? override.title
              : active ? activeName : threadDisplayName(thread, null)
            if (editing === thread.thread_id) {
              return (
                <li key={thread.thread_id}>
                  <TitleEditor initial={name} onDone={(next, byKey) => finishRename(thread.thread_id, thread.title, next, byKey)} />
                </li>
              )
            }
            return (
              <li key={thread.thread_id} className="group relative">
                <Link
                  to={`/chat/${thread.thread_id}`}
                  data-thread-id={thread.thread_id}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-md py-2 pl-2.5 pr-14 text-sm transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-surface-hover'}`}
                >
                  <span className={`block truncate font-medium ${active ? 'text-accent' : 'text-fg'}`}>{name}</span>
                  <time
                    dateTime={thread.updated_at}
                    title={new Date(thread.updated_at).toLocaleString()}
                    className="mt-0.5 block text-[11px] text-muted"
                  >
                    {formatRelativeTime(thread.updated_at, now)}
                  </time>
                </Link>
                <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`Rename ${name}`}
                    className="rounded p-1 text-muted hover:text-fg"
                    onClick={() => setEditing(thread.thread_id)}
                  >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${name}`}
                    className="rounded p-1 text-muted hover:text-negative"
                    onClick={(e) => {
                      e.preventDefault()
                      focusUndo.current = true
                      startThreadDelete(userId, thread.thread_id, name)
                      if (active) navigate('/chat')
                    }}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}

// Enter saves, Escape cancels, and leaving the field saves. A name left as it
// opened is a cancel, even if the row's name changed meanwhile. `settled` stops
// the blur that follows Enter or Escape from finishing a second time.
export function TitleEditor({ initial, onDone }: { initial: string; onDone: (next: string | null, byKey: boolean) => void }) {
  const settled = useRef(false)
  // The field keeps the text it opened with even if the row's name changes.
  const [opened] = useState(initial)
  const finish = (next: string | null, byKey: boolean) => {
    if (settled.current) return
    settled.current = true
    onDone(next === null || next.trim() === opened ? null : next, byKey)
  }
  return (
    <input
      aria-label="Chat name"
      defaultValue={opened}
      maxLength={200}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(event.currentTarget.value, true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(null, true)
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value, false)}
      className="block w-full rounded-md border border-accent bg-surface px-2.5 py-2 text-sm text-fg outline-none ring-2 ring-accent-soft"
    />
  )
}
