import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { authenticatedJson } from '../http/authFetch.ts'
import {
  INITIAL_CHAT_SESSION,
  MAX_REOPENS,
  reduceChatSession,
  selectThreadView,
  wantedStream,
  type ChatSessionAction,
  type ChatSessionState,
  type ThreadView,
  type TurnIds,
  type StreamTarget,
} from './chatSession.ts'
import { parseThreadMessages, type ChatMessage, type RunRef } from './messageTypes.ts'
import { openChatTurnStream } from './openChatTurnStream.ts'
import { persistUserChatTurn } from './persistUserChatTurn.ts'
import { createThread } from './threadActions.ts'

const HISTORY_TIMEOUT_MS = 10_000

export type ChatSession = {
  view: ThreadView
  // Claims the turn synchronously against the store; false means rejected
  // (a turn is in flight), and the caller keeps its draft.
  ask(text: string): boolean
  retry(): void
  reconnect(): void
  reload(): void
}

type SessionStore = {
  getState(): ChatSessionState
  dispatch(action: ChatSessionAction): void
  subscribe(listener: () => void): () => void
}

function createSessionStore(initial: ChatSessionState): SessionStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceChatSession(state, action)
      if (next === state) return
      state = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// A stream handle. A released one dispatches stream events no more. reached:
// the server answered or sent an event, so the run exists or existed.
type RunStream = { source: EventSource; live: boolean; reached: boolean }

const CONNECTING = 0

// Holds the one stream the state wants (wantedStream) and follows the store:
// a new key releases the held stream and opens the wanted one. A stream that
// hasn't reached the server may not have started its run, so a released one
// without attach stays open until the server answers, and one that fails first
// is opened again (up to MAX_REOPENS times) so its run starts. One that reaches
// the server tells the session released.reached, and its loads decide the rest;
// one that never does is sent again when its thread is next loaded.
function createRunStreams(store: SessionStore) {
  let held: { key: string; stream: RunStream } | null = null
  let unsubscribe: (() => void) | null = null
  let disposed = true
  let userId = ''

  const open = (target: StreamTarget, live: boolean, starts = 0): RunStream => {
    const { threadId, run } = target
    const mode = target.attach ? { attach: true as const } : { userIntent: target.userIntent }
    const stream: RunStream = { source: null as unknown as EventSource, live, reached: false }
    stream.source = openChatTurnStream({ threadId, runId: run.runId, turnId: run.turnId, userId, ...mode }, {
      onOpen: () => {
        stream.reached = true
        if (stream.live) {
          store.dispatch({ type: 'stream.opened', threadId, runId: run.runId })
          return
        }
        stream.source.close()
        if (!target.attach && !disposed) store.dispatch({ type: 'released.reached', threadId, runId: run.runId })
      },
      onEvent: (event) => {
        stream.reached = true
        if (stream.live) store.dispatch({ type: 'stream.event', threadId, event })
      },
      onError: () => {
        if (stream.live) {
          store.dispatch({ type: 'stream.dropped', threadId, runId: run.runId })
          return
        }
        if (!target.attach && !stream.reached && starts < MAX_REOPENS) open(target, false, starts + 1)
      },
    })
    return stream
  }
  const release = (stream: RunStream) => {
    stream.live = false
    if (stream.source.readyState !== CONNECTING) stream.source.close()
  }
  const sync = () => {
    const wanted = disposed ? null : wantedStream(store.getState())
    if (wanted?.key === held?.key) return
    if (held) release(held.stream)
    held = wanted && { key: wanted.key, stream: open(wanted, true) }
  }
  return {
    // A send whose user left its thread mid-POST: opened only to start the run.
    start(threadId: string, run: RunRef, userIntent: string) {
      if (!disposed) store.dispatch({ type: 'run.released', threadId, run, input: { userIntent } })
      open({ threadId, run, attach: false, userIntent }, false)
    },
    get disposed() {
      return disposed
    },
    mount(user: string) {
      userId = user
      disposed = false
      unsubscribe = store.subscribe(sync)
      sync()
    },
    dispose() {
      disposed = true
      unsubscribe?.()
      unsubscribe = null
      sync()
    },
  }
}

type ChatSessionDeps = {
  userId: string
  threadId: string | null
  navigate: (to: string) => void
  onThreadCreated: () => void
}

export function useChatSession({ userId, threadId, navigate, onThreadCreated }: ChatSessionDeps): ChatSession {
  const [store] = useState(() =>
    createSessionStore(reduceChatSession(INITIAL_CHAT_SESSION, { type: 'thread.opened', threadId })))
  const [streams] = useState(() => createRunStreams(store))
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const view = useMemo(() => selectThreadView(state), [state])

  useLayoutEffect(() => {
    store.dispatch({ type: 'thread.opened', threadId })
  }, [store, threadId])

  useEffect(() => {
    streams.mount(userId)
    return () => streams.dispose()
  }, [streams, userId])

  const ask = useCallback((raw: string): boolean => {
    const text = raw.trim()
    const before = store.getState()
    if (text === '' || !userId || !selectThreadView(before).canAsk) return false
    const turn: TurnIds = { runId: makeId(), messageId: makeId(), snapshotId: makeId(), text }
    store.dispatch({ type: 'ask.started', turn })

    // A disposed session has no UI left to update or navigate from.
    const owns = () => {
      const current = store.getState().turn
      return !streams.disposed && current.phase === 'persisting' && current.turn.runId === turn.runId
    }
    const fail = (caught: unknown) => {
      if (owns()) store.dispatch({ type: 'ask.failed', error: errorText(caught) })
    }
    const send = async () => {
      let sendThreadId = before.threadId
      if (sendThreadId === null) {
        let created
        try {
          created = await createThread(userId)
        } catch (caught) {
          fail(caught)
          return
        }
        sendThreadId = created.thread_id
        onThreadCreated()
        if (owns()) {
          store.dispatch({ type: 'thread.created', threadId: sendThreadId })
          navigate(`/chat/${sendThreadId}`)
        }
      }
      let message: ChatMessage
      try {
        message = await persistUserChatTurn({
          threadId: sendThreadId,
          userId,
          messageId: turn.messageId,
          snapshotId: turn.snapshotId,
          content: turn.text,
        })
      } catch (caught) {
        fail(caught)
        return
      }
      // The store wants the turn's stream from here on. A user who left
      // mid-send still gets the run started.
      if (owns() && store.getState().threadId === sendThreadId) store.dispatch({ type: 'message.persisted', threadId: sendThreadId, message })
      else streams.start(sendThreadId, { runId: turn.runId, turnId: turn.messageId }, turn.text)
    }
    void send()
    return true
  }, [store, streams, userId, navigate, onThreadCreated])

  const retry = useCallback(() => store.dispatch({ type: 'turn.retried', runId: makeId() }), [store])
  const reconnect = useCallback(() => store.dispatch({ type: 'link.reconnected' }), [store])

  const reload = useCallback(() => store.dispatch({ type: 'history.requested' }), [store])

  const loadThreadId = view.needsLoad?.threadId ?? null
  const loadGen = view.needsLoad?.gen ?? 0
  useEffect(() => {
    if (loadThreadId === null || !userId) return
    const controller = new AbortController()
    authenticatedJson<unknown>(`/v1/chat/threads/${encodeURIComponent(loadThreadId)}/messages`, {
      userId,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(HISTORY_TIMEOUT_MS)]),
    }).then(
      (body) => store.dispatch({ type: 'history.loaded', threadId: loadThreadId, gen: loadGen, ...parseThreadMessages(body) }),
      (caught: unknown) => {
        if (controller.signal.aborted) return
        store.dispatch({ type: 'history.failed', threadId: loadThreadId, gen: loadGen, message: errorText(caught) })
      },
    )
    return () => controller.abort()
  }, [store, userId, loadThreadId, loadGen])

  return useMemo(() => ({ view, ask, retry, reconnect, reload }), [view, ask, retry, reconnect, reload])
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

function makeId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID()
  return `00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString().padStart(12, '0')}`
}
