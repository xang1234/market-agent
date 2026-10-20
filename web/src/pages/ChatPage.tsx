import { useCallback, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, useMatch, useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'

import { PRIMARY_BUTTON_CLASS } from '../shell/buttonStyles.ts'
import { VirtualizedMessageList } from '../chat'
import { ChatComposer } from '../chat/ChatComposer.tsx'
import { PendingTurnView } from '../chat/PendingTurnView.tsx'
import { ThreadColumn } from '../chat/turnLayout.tsx'
import { FailureNotice } from '../ui/FailureNotice.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { useAuth } from '../shell/useAuth.ts'
import { cancelThreadDelete, startThreadDelete, useThreadDeletes } from '../chat/threadDeletes.ts'
import { StarterQuestionsContext } from '../chat/starterQuestions.ts'
import { threadDisplayName } from '../chat/threadName.ts'
import { useChatSession, type ChatSession } from '../chat/useChatSession.ts'
import { useThreadList, useTitleFollowUp, type ThreadListState } from '../chat/useThreadList.ts'


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
  const chat = useChatSession({ userId, threadId: routeThreadId, navigate, onThreadCreated: threads.refresh })
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
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`grid min-h-0 flex-1 overflow-hidden ${collapsed ? 'grid-cols-[0px_minmax(0,1fr)]' : 'grid-cols-[260px_minmax(0,1fr)]'}`}
      >
        {collapsed ? null : (
          <aside className="min-h-0 border-r border-line bg-surface-2/70 p-4">
            <ThreadList
              userId={userId}
              state={threads.state}
              activeThreadId={activeThreadId}
              activeName={threadName}
              refresh={threads.refresh}
            />
          </aside>
        )}
        <div className="flex min-h-0 flex-col overflow-auto">
          {chat.view.canvas === 'thread'
            ? <ChatThreadView chat={chat} threadName={threadName} collapsed={collapsed} setCollapsed={setCollapsed} />
            : <ChatEmptyState chat={chat} />}
          <ChatComposer canAsk={chat.view.canAsk} onAsk={chat.ask} />
        </div>
      </div>
    </div>
  )
}

function ChatEmptyState({ chat }: { chat: ChatSession }) {
  const starterQuestions = useContext(StarterQuestionsContext)
  return (
    <div data-testid="chat-empty" className="flex flex-1 flex-col gap-6 p-8">
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

type ChatThreadViewProps = {
  chat: ChatSession
  threadName: string
  collapsed: boolean
  setCollapsed: Dispatch<SetStateAction<boolean>>
}

function ChatThreadView({ chat, threadName, collapsed, setCollapsed }: ChatThreadViewProps) {
  const { view } = chat

  return (
    <div data-testid="chat-thread" className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <button
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed((c) => !c)}
          className="text-sm text-muted hover:text-fg"
        >
          {collapsed ? '☰' : '⟨'}
        </button>
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
          <section className="flex min-h-[24rem] flex-1 flex-col" aria-label="Persisted message history">
            <VirtualizedMessageList
              key={view.listKey}
              messages={view.messages}
              tail={<PendingTurnView turn={view.turn} onRetry={chat.retry} onReconnect={chat.reconnect} onReload={chat.reload} onAsk={chat.ask} />}
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
    <nav aria-label="Chats" className="flex min-h-0 flex-col gap-3">
      <button
        ref={newChatButton}
        type="button"
        onClick={() => navigate('/chat')}
        className={`${PRIMARY_BUTTON_CLASS} w-full justify-center`}
      >
        + New chat
      </button>
      {deleteError ? <FailureNotice message="Couldn't delete the chat." detail={deleteError.message} announce={false} /> : null}
      <h2 className="text-sm font-semibold text-fg">Chats</h2>
      {state.kind === 'loading' ? (
        <div className="flex flex-col gap-2">
          <Skeleton label="Loading chats" className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : state.kind === 'error' ? (
        <FailureNotice message="Couldn't load your chats." detail={state.message} onRetry={refresh} />
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-3 text-xs text-muted">
          No chats yet.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-auto">
          {rows.map((thread) => {
            if (thread.thread_id === pending?.threadId) {
              return (
                <li
                  key={thread.thread_id}
                  className="flex items-center justify-between rounded-md border border-dashed border-line-strong p-3 text-xs text-muted"
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
            const name = active ? activeName : threadDisplayName(thread, null)
            return (
              <li key={thread.thread_id} className="group relative">
                <Link
                  to={`/chat/${thread.thread_id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-md border bg-surface p-3 text-sm ${active ? 'border-accent' : 'border-line hover:border-line-strong'}`}
                >
                  <span className="block truncate font-medium text-fg">{name}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {new Date(thread.updated_at).toLocaleString()}
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete ${name}`}
                  className="absolute right-2 top-2 rounded p-1 text-muted opacity-0 transition hover:text-negative focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault()
                    focusUndo.current = true
                    startThreadDelete(userId, thread.thread_id, name)
                    if (active) navigate('/chat')
                  }}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
