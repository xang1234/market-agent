import type { ChatMessage, RunRef, RunStatus } from './messageTypes.ts'
import type { ChatSseEvent } from './sseEventTypes.ts'
import { INITIAL_STREAM_STATE, applyChatStreamEvent, type StreamState } from './streamReducer.ts'

export type TurnIds = { runId: string; messageId: string; snapshotId: string; text: string }

export type RunInput = Readonly<{ userIntent: string }>

// Who started the run the session follows. It holds for the run's life, and
// decides whether its streamed blocks render.
export type RunOrigin =
  // Sent from this session, so its question is known and its streamed answer
  // stays on screen through any reconnect, until the hand-off replaces it.
  | OwnOrigin
  // A run a load reported as active_run that this session didn't send. Its
  // streamed blocks never render: the load may already hold its answer.
  | { kind: 'adopted' }
export type OwnOrigin = { kind: 'own'; input: RunInput }

export type StreamLink = Readonly<{
  kind: 'open' | 'reconnecting' | 'offline'
  // attach=1: follows a run the server has and never starts one, replaying it
  // from its first event. Without attach the stream carries the question, which
  // starts the run if it never began; only a stream that never reached the
  // server reopens so.
  attach: boolean
  // Numbers the streams opened for the run, so each reopen is a new stream.
  attempt: number
  // The open stream answered or delivered an event.
  reached: boolean
  // Drops since the run last delivered an event past seenSeq. Replays don't count as progress.
  drops: number
  seenSeq: number
}>

// A run this session sent and left behind on switch-away, until a load of its
// thread reconciles it. One whose stream hasn't reached the server yet is sent
// again when that load lacks it.
export type ReleasedRun = Readonly<{ threadId: string; run: RunRef; input: RunInput; reached: boolean }>

// "handed_off" collapses into idle: once the sealed message is in history there
// is nothing left to render.
export type TurnState =
  | { phase: 'idle' }
  | { phase: 'persisting'; turn: TurnIds }
  | { phase: 'not_sent'; text: string; error: string }
  | { phase: 'streaming'; run: RunRef; origin: RunOrigin; stream: StreamState; link: StreamLink }
  | { phase: 'failed'; run: RunRef; origin: OwnOrigin; stream: StreamState; error: string; recovery: 'retry_run' }
  // The run completed without a sealed copy on the stream: load the thread until
  // a load returns messageId, the saved answer it named.
  | { phase: 'failed'; run: RunRef; origin: RunOrigin; stream: StreamState; error: string; recovery: 'reload_thread'; messageId: string | null }
  // A run this session didn't send failed; there is no question to send again.
  | { phase: 'failed'; run: RunRef; origin: RunOrigin; stream: StreamState; error: string; recovery: 'none' }
  | { phase: 'unverified'; run: RunRef; stream: StreamState }

type LoadedHistory =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; messages: ReadonlyArray<ChatMessage> }

export type HistoryState = {
  // The generation the shell must load; bumping it means "refetch".
  requested: number
  // The last generation that resolved, ok or failed.
  settled: number
  loaded: LoadedHistory
  // Messages the server returned outside a history load (the POSTed question,
  // the sealed answer from turn.completed) that no load has returned yet.
  local: ReadonlyArray<ChatMessage>
}

export type ChatSessionState = {
  threadId: string | null
  history: HistoryState
  turn: TurnState
  sealedTurns: number
  // Runs on this thread the session saw end. A load read before one ended
  // still reports it as active_run, and must not bring it back.
  endedRuns: ReadonlyArray<string>
  // Runs the last read listed in flight. The session follows one at a time,
  // and attaches to the next when it ends.
  inFlight: ReadonlyArray<RunRef>
  // Across threads: survives thread.opened.
  released: ReadonlyArray<ReleasedRun>
  // Bumped by every thread.opened that changes the thread, but not by
  // thread.created, so ask-first keeps one message list into its new thread.
  opens: number
}

export type ChatSessionAction =
  | { type: 'thread.opened'; threadId: string | null }
  | { type: 'ask.started'; turn: TurnIds }
  | { type: 'thread.created'; threadId: string }
  | { type: 'message.persisted'; threadId: string; message: ChatMessage }
  | { type: 'ask.failed'; error: string }
  // A send whose user had left its thread: its stream was opened only to start the run.
  | { type: 'run.released'; threadId: string; run: RunRef; input: RunInput }
  // A released stream reached the server.
  | { type: 'released.reached'; threadId: string; runId: string }
  | { type: 'stream.opened'; threadId: string; runId: string }
  | { type: 'stream.event'; threadId: string; event: ChatSseEvent }
  | { type: 'stream.dropped'; threadId: string; runId: string }
  | { type: 'turn.retried'; runId: string }
  | { type: 'link.reconnected' }
  | { type: 'history.requested' }
  | { type: 'history.loaded'; threadId: string; gen: number; messages: ReadonlyArray<ChatMessage>; activeRun: RunRef | null; runs: ReadonlyArray<RunStatus> }
  | { type: 'history.failed'; threadId: string; gen: number; message: string }

export const NOT_SEALED = "Couldn't show the saved copy of this answer."
export const NOT_IN_THREAD = "The saved copy of this answer isn't in the thread yet."
export const RELOAD_FAILED = "Couldn't load the saved copy of this answer."
export const RUN_FAILED = "The analyst couldn't answer this question."

// Drops allowed without progress; Reconnect starts a new budget.
export const MAX_REOPENS = 3

const IDLE: TurnState = { phase: 'idle' }
const EMPTY_READY: LoadedHistory = { kind: 'ready', messages: [] }
const FRESH_LINK: StreamLink = { kind: 'open', attach: false, attempt: 0, reached: false, drops: 0, seenSeq: 0 }
const ATTACHED_LINK: StreamLink = { ...FRESH_LINK, attach: true }

export const INITIAL_CHAT_SESSION: ChatSessionState = {
  threadId: null,
  history: { requested: 0, settled: 0, loaded: EMPTY_READY, local: [] },
  turn: IDLE,
  sealedTurns: 0,
  endedRuns: [],
  inFlight: [],
  released: [],
  opens: 0,
}

function openedSession(threadId: string | null, opens: number, released: ReadonlyArray<ReleasedRun>): ChatSessionState {
  if (threadId === null) return { ...INITIAL_CHAT_SESSION, released, opens }
  return {
    threadId,
    history: { requested: 1, settled: 0, loaded: { kind: 'loading' }, local: [] },
    turn: IDLE,
    sealedTurns: 0,
    endedRuns: [],
    inFlight: [],
    released,
    opens,
  }
}

function releasedOnLeave(s: ChatSessionState): ReadonlyArray<ReleasedRun> {
  const { turn, threadId } = s
  if (threadId === null || turn.phase !== 'streaming' || turn.origin.kind !== 'own') return s.released
  const { link } = turn
  const reached = link.attach || link.reached
  return [...s.released, { threadId, run: turn.run, input: turn.origin.input, reached }]
}

const ASKABLE_PHASES: ReadonlySet<TurnState['phase']> = new Set(['idle', 'not_sent', 'failed', 'unverified'])

const reachedHere = (s: ChatSessionState) => s.released.some((r) => r.threadId === s.threadId && r.reached)
const waiting = (s: ChatSessionState) => reachedHere(s) || s.inFlight.some((run) => !s.endedRuns.includes(run.runId))
const loadPending = (s: ChatSessionState) => s.history.requested > s.history.settled

// Until the thread's first load lands, the server may have a run going on it;
// while a load is due to reconcile a released run, that run may be in flight.
function askable(s: ChatSessionState): boolean {
  return ASKABLE_PHASES.has(s.turn.phase) && s.history.loaded.kind !== 'loading' && !(waiting(s) && loadPending(s))
}

// Nothing follows a stream on this thread: follow the next run the session knows
// of there by its stream, so a failed load can't leave it running unfollowed,
// and load the thread, whose last read may predate its question. A pending load
// reconciles them itself.
function followUp(s: ChatSessionState): ChatSessionState {
  if (s.threadId === null || !ASKABLE_PHASES.has(s.turn.phase) || loadPending(s)) return s
  const released = s.released.find((r) => r.threadId === s.threadId)
  const next = released ? undefined : s.inFlight.find((run) => !s.endedRuns.includes(run.runId))
  const turn = released
    ? following(released.run, { kind: 'own', input: released.input }, released.reached ? ATTACHED_LINK : FRESH_LINK)
    : next && following(next, { kind: 'adopted' }, ATTACHED_LINK)
  if (!turn) return s
  return { ...s, history: requestHistory(s.history), released: s.released.filter((r) => r !== released), turn }
}

function following(run: RunRef, origin: RunOrigin, link: StreamLink): TurnState {
  return { phase: 'streaming', run, origin, stream: INITIAL_STREAM_STATE, link }
}

export function reduceChatSession(s: ChatSessionState, a: ChatSessionAction): ChatSessionState {
  switch (a.type) {
    case 'thread.opened':
      return a.threadId === s.threadId ? s : openedSession(a.threadId, s.opens + 1, releasedOnLeave(s))

    case 'ask.started':
      if (!askable(s)) return s
      return { ...s, turn: { phase: 'persisting', turn: a.turn } }

    case 'thread.created':
      if (s.threadId !== null || s.turn.phase !== 'persisting') return s
      return {
        ...s,
        threadId: a.threadId,
        history: { requested: 0, settled: 0, loaded: EMPTY_READY, local: [] },
      }

    case 'message.persisted': {
      if (a.threadId !== s.threadId || s.turn.phase !== 'persisting') return s
      const { runId, messageId, text } = s.turn.turn
      const history = withLocal(s.history, a.message)
      return {
        ...s,
        history: { ...history, loaded: history.loaded.kind === 'ready' ? history.loaded : EMPTY_READY },
        turn: { phase: 'streaming', run: { runId, turnId: messageId }, origin: { kind: 'own', input: { userIntent: text } }, stream: INITIAL_STREAM_STATE, link: FRESH_LINK },
      }
    }

    case 'ask.failed':
      if (s.turn.phase !== 'persisting') return s
      return followUp({ ...s, turn: { phase: 'not_sent', text: s.turn.turn.text, error: a.error } })

    case 'run.released':
      if (s.released.some((r) => r.run.runId === a.run.runId)) return s
      return followUp({ ...s, released: [...s.released, { threadId: a.threadId, run: a.run, input: a.input, reached: false }] })

    case 'released.reached': {
      const index = s.released.findIndex((r) => r.threadId === a.threadId && r.run.runId === a.runId && !r.reached)
      if (index === -1) return s
      const reached = { ...s, released: s.released.map((r, i) => (i === index ? { ...r, reached: true } : r)) }
      // A load already in flight may have read the thread before the run
      // existed; a newer generation replaces it.
      if (a.threadId === s.threadId && loadPending(s)) return { ...reached, history: requestHistory(s.history) }
      return followUp(reached)
    }

    case 'stream.opened': {
      const { turn } = s
      if (a.threadId !== s.threadId || turn.phase !== 'streaming' || turn.run.runId !== a.runId) return s
      if (turn.link.kind !== 'open' || turn.link.reached) return s
      return { ...s, turn: { ...turn, link: { ...turn.link, reached: true } } }
    }

    case 'stream.event':
      return reduceStreamEvent(s, a.threadId, a.event)

    case 'stream.dropped': {
      const { turn } = s
      if (a.threadId !== s.threadId || turn.phase !== 'streaming' || turn.run.runId !== a.runId) return s
      const { link } = turn
      if (link.kind !== 'open') return s
      const drops = link.drops + 1
      if (drops > MAX_REOPENS) return { ...s, turn: { ...turn, link: { ...link, kind: 'offline', drops } } }
      // The run may never have reached the server: the same request starts it, or finds it.
      if (!link.attach && !link.reached) return { ...s, turn: { ...turn, link: { ...link, attempt: link.attempt + 1, drops } } }
      // It did: only the server's status says whether it goes on.
      return { ...s, history: requestHistory(s.history), turn: { ...turn, link: { ...link, kind: 'reconnecting', attach: true, drops } } }
    }

    case 'turn.retried': {
      const { turn } = s
      if (turn.phase === 'failed' && turn.recovery === 'retry_run') {
        const run = { runId: a.runId, turnId: turn.run.turnId }
        return { ...s, turn: { phase: 'streaming', run, origin: turn.origin, stream: INITIAL_STREAM_STATE, link: FRESH_LINK } }
      }
      return s
    }

    case 'link.reconnected': {
      const { turn } = s
      if (turn.phase === 'streaming' && turn.link.kind === 'offline') {
        // No request ever reached the server, so the run never started: send it again.
        if (!turn.link.attach && !turn.link.reached) {
          return { ...s, turn: { ...turn, link: { ...turn.link, kind: 'open', attempt: turn.link.attempt + 1, drops: 0 } } }
        }
        return { ...s, history: requestHistory(s.history), turn: { ...turn, link: { ...turn.link, kind: 'reconnecting', attach: true, drops: 0 } } }
      }
      return s
    }

    case 'history.requested':
      if (s.threadId === null) return s
      return { ...s, history: requestHistory(s.history) }

    case 'history.loaded': {
      if (a.threadId !== s.threadId || a.gen !== s.history.requested) return s
      const loadedIds = new Set(a.messages.map((m) => m.message_id))
      const history: HistoryState = {
        requested: s.history.requested,
        settled: a.gen,
        loaded: { kind: 'ready', messages: a.messages },
        local: s.history.local.filter((m) => !loadedIds.has(m.message_id)),
      }
      const read: Read = { ids: loadedIds, runs: a.runs }
      const inFlight = a.runs.flatMap((entry) => (entry.status === 'in_flight' ? [entry.run] : []))
      return adopt(reconcileReleased(settled({ ...s, history, inFlight }, read), read), a.activeRun)
    }

    case 'history.failed': {
      if (a.threadId !== s.threadId || a.gen !== s.history.requested) return s
      const loaded: LoadedHistory = s.history.loaded.kind === 'ready' ? s.history.loaded : { kind: 'error', message: a.message }
      return followUp({ ...s, history: { ...s.history, settled: a.gen, loaded }, turn: failedLoad(s.turn) })
    }
  }
}

type Read = { ids: ReadonlySet<string>; runs: ReadonlyArray<RunStatus> }

const statusOf = (read: Read, run: RunRef): RunStatus | undefined =>
  read.runs.find((entry) => entry.run.runId === run.runId && entry.run.turnId === run.turnId)

// What a load decides for the followed turn. Past the answer check, only a turn
// waiting on the load, requested after its stream ended or dropped, is decided.
function settled(s: ChatSessionState, read: Read): ChatSessionState {
  const { turn } = s
  if (turn.phase === 'streaming') {
    const status = statusOf(read, turn.run)
    // The read holds the answer, which the stream may not have reached yet.
    if (status?.status === 'completed' && status.messageId !== null && read.ids.has(status.messageId)) return { ...s, ...handOff(s, turn.run) }
  }
  if (turn.phase === 'streaming' && turn.link.kind === 'reconnecting') {
    const { run, origin, stream, link } = turn
    const status = statusOf(read, run)
    const reattached: ChatSessionState = { ...s, turn: { ...turn, link: { ...link, kind: 'open', attempt: link.attempt + 1, reached: false } } }
    switch (status?.status) {
      case 'in_flight':
        return reattached
      case 'completed':
        // No saved message (display_unverified): only the replayed turn.completed carries the answer.
        if (status.messageId === null) return reattached
        // The read predates the answer's commit: one more load brings it.
        return {
          ...s,
          history: requestHistory(s.history),
          turn: { phase: 'failed', run, origin, stream, error: NOT_SEALED, recovery: 'reload_thread', messageId: status.messageId },
          endedRuns: withEnded(s, run),
        }
      case 'failed':
        return { ...s, turn: failedRun(turn), endedRuns: withEnded(s, run) }
      case undefined:
        // Restarted, another instance, or past retention: nobody knows, so the thread is shown as it is.
        return { ...s, turn: IDLE, endedRuns: withEnded(s, run) }
    }
  }
  if (turn.phase === 'failed' && turn.recovery === 'reload_thread') {
    if (turn.messageId === null || read.ids.has(turn.messageId)) return { ...s, ...handOff(s, turn.run) }
    return { ...s, turn: { ...turn, error: NOT_IN_THREAD } }
  }
  return s
}

function failedRun(turn: Extract<TurnState, { phase: 'streaming' }>): TurnState {
  const { run, origin, stream } = turn
  return origin.kind === 'own'
    ? { phase: 'failed', run, origin, stream, error: RUN_FAILED, recovery: 'retry_run' }
    : { phase: 'failed', run, origin, stream, error: RUN_FAILED, recovery: 'none' }
}

function reconcileReleased(s: ChatSessionState, read: Read): ChatSessionState {
  if (!s.released.some((r) => r.threadId === s.threadId)) return s
  let next = s
  const kept: ReleasedRun[] = []
  for (const released of s.released) {
    if (released.threadId !== s.threadId) {
      kept.push(released)
      continue
    }
    const status = statusOf(read, released.run)
    const own: OwnOrigin = { kind: 'own', input: released.input }
    const follow = (link: StreamLink) => {
      if (ASKABLE_PHASES.has(next.turn.phase)) next = { ...next, turn: following(released.run, own, link) }
      else kept.push(link.attach ? { ...released, reached: true } : released)
    }
    switch (status?.status) {
      case 'in_flight':
        follow(ATTACHED_LINK)
        break
      case 'completed': {
        // No saved message (display_unverified): only the replayed turn.completed carries the answer.
        if (status.messageId === null) {
          follow(ATTACHED_LINK)
          break
        }
        const shown = read.ids.has(status.messageId)
        next = { ...next, endedRuns: withEnded(next, released.run), sealedTurns: next.sealedTurns + (shown ? 1 : 0) }
        if (!shown) next = { ...next, history: requestHistory(next.history) }
        break
      }
      case 'failed':
        next = { ...next, endedRuns: withEnded(next, released.run) }
        if (next.turn.phase === 'idle') {
          next = { ...next, turn: { phase: 'failed', run: released.run, origin: own, stream: INITIAL_STREAM_STATE, error: RUN_FAILED, recovery: 'retry_run' } }
        }
        break
      case undefined:
        if (!released.reached) follow(FRESH_LINK)
        break
    }
  }
  return { ...next, released: kept }
}

function handOff(s: ChatSessionState, run: RunRef): Pick<ChatSessionState, 'turn' | 'sealedTurns' | 'endedRuns'> {
  return { turn: IDLE, sealedTurns: s.sealedTurns + 1, endedRuns: withEnded(s, run) }
}

function withEnded(s: ChatSessionState, run: RunRef): ReadonlyArray<string> {
  return s.endedRuns.includes(run.runId) ? s.endedRuns : [...s.endedRuns, run.runId]
}

// A run the session isn't following: show it in progress and keep Send off.
// An own run that failed keeps its failure on screen.
function adopt(s: ChatSessionState, activeRun: RunRef | null): ChatSessionState {
  const { turn } = s
  if (activeRun === null || !ASKABLE_PHASES.has(turn.phase)) return s
  if (s.endedRuns.includes(activeRun.runId) || s.released.some((r) => r.run.runId === activeRun.runId)) return s
  return { ...s, turn: following(activeRun, { kind: 'adopted' }, ATTACHED_LINK) }
}

function failedLoad(turn: TurnState): TurnState {
  if (turn.phase === 'streaming' && turn.link.kind === 'reconnecting') return { ...turn, link: { ...turn.link, kind: 'offline' } }
  if (turn.phase === 'failed' && turn.recovery === 'reload_thread') return { ...turn, error: RELOAD_FAILED }
  return turn
}

function requestHistory(history: HistoryState): HistoryState {
  const loaded: LoadedHistory = history.loaded.kind === 'error' ? { kind: 'loading' } : history.loaded
  return { ...history, requested: history.requested + 1, loaded }
}

function withLocal(history: HistoryState, message: ChatMessage): HistoryState {
  const known = (m: ChatMessage) => m.message_id === message.message_id
  if (history.local.some(known)) return history
  if (history.loaded.kind === 'ready' && history.loaded.messages.some(known)) return history
  return { ...history, local: [...history.local, message] }
}

function reduceStreamEvent(s: ChatSessionState, threadId: string, event: ChatSseEvent): ChatSessionState {
  const { turn } = s
  if (threadId !== s.threadId || turn.phase !== 'streaming' || event.run_id !== turn.run.runId) return s
  const progressed = event.seq > turn.link.seenSeq
  // A reattached stream replays the run from its first event; the stream already holds what it saw.
  const stream = progressed ? applyChatStreamEvent(turn.stream, event) : turn.stream
  const link: StreamLink = progressed || !turn.link.reached
    ? { ...turn.link, reached: true, ...(progressed ? { seenSeq: event.seq, drops: 0 } : {}) }
    : turn.link
  if (stream === turn.stream && link === turn.link) return s
  const { run, origin } = turn
  switch (stream.turn_status) {
    case 'completed':
      // The hand-off: the sealed answer joins the thread in the state that drops the stream.
      return followUp({ ...s, history: withLocal(s.history, stream.sealed), ...handOff(s, run) })
    case 'unsealed':
      if (stream.message_id !== null && visibleMessages(s.history).some((m) => m.message_id === stream.message_id)) {
        return followUp({ ...s, ...handOff(s, run) })
      }
      // The load this requests starts after the turn ended, so a load already
      // in flight (an older generation) can't settle it.
      return {
        ...s,
        history: requestHistory(s.history),
        turn: { phase: 'failed', run, origin, stream, error: NOT_SEALED, recovery: 'reload_thread', messageId: stream.message_id },
        endedRuns: withEnded(s, run),
      }
    case 'unverified':
      return followUp({ ...s, turn: { phase: 'unverified', run, stream }, endedRuns: withEnded(s, run) })
    case 'error': {
      const error = `Stream error: ${stream.error ?? 'unknown'}`
      const failed: TurnState = origin.kind === 'own'
        ? { phase: 'failed', run, origin, stream, error, recovery: 'retry_run' }
        : { phase: 'failed', run, origin, stream, error, recovery: 'none' }
      return followUp({ ...s, turn: failed, endedRuns: withEnded(s, run) })
    }
    default:
      return { ...s, turn: { ...turn, stream, link } }
  }
}

// The one stream the state wants open. A new key means close the old one and open this.
export type StreamTarget =
  | { threadId: string; run: RunRef; attach: false; userIntent: string }
  | { threadId: string; run: RunRef; attach: true }
export type WantedStream = StreamTarget & { key: string }

export function wantedStream(s: ChatSessionState): WantedStream | null {
  const { threadId, turn } = s
  if (threadId === null || turn.phase !== 'streaming' || turn.link.kind !== 'open') return null
  const { run, origin, link } = turn
  const key = `${threadId}|${run.runId}|${link.attach ? 'attach' : 'start'}|${link.attempt}`
  if (link.attach || origin.kind !== 'own') return { key, threadId, run, attach: true }
  return { key, threadId, run, attach: false, userIntent: origin.input.userIntent }
}

export type ThreadView = {
  threadId: string | null
  history: 'loading' | 'error' | 'ready'
  historyError: string | null
  messages: ReadonlyArray<ChatMessage>
  // The session, not the route, picks the canvas: ask-first streams and hands
  // off before react-router commits /chat/<id> on a slow CPU.
  canvas: 'empty' | 'thread'
  listKey: number
  listMounted: boolean
  turn: TurnState
  canAsk: boolean
  firstQuestion: string | null
  sealedTurns: number
  needsLoad: { threadId: string; gen: number } | null
}

// Keyed on the loaded history so the list keeps one messages array across
// turn-only updates and its memoized rows don't re-render on every delta.
const mergedMessages = new WeakMap<object, { local: ReadonlyArray<ChatMessage>; messages: ReadonlyArray<ChatMessage> }>()

function visibleMessages(history: HistoryState): ReadonlyArray<ChatMessage> {
  const loaded = history.loaded.kind === 'ready' ? history.loaded.messages : []
  if (history.local.length === 0) return loaded
  const cached = mergedMessages.get(history.loaded)
  if (cached?.local === history.local) return cached.messages
  const messages = [...loaded, ...history.local]
  mergedMessages.set(history.loaded, { local: history.local, messages })
  return messages
}

export function selectThreadView(s: ChatSessionState): ThreadView {
  const { history, turn } = s
  const messages = visibleMessages(history)
  const firstUser = messages.find((m) => m.role === 'user')
  const pendingText = turn.phase === 'persisting' ? turn.turn.text : turn.phase === 'not_sent' ? turn.text : null
  return {
    threadId: s.threadId,
    history: history.loaded.kind,
    historyError: history.loaded.kind === 'error' ? history.loaded.message : null,
    messages,
    canvas: s.threadId !== null || turn.phase !== 'idle' ? 'thread' : 'empty',
    listKey: s.opens,
    listMounted: history.loaded.kind === 'ready' || turn.phase !== 'idle',
    turn,
    canAsk: askable(s),
    firstQuestion: (firstUser ? messageText(firstUser) : null) || pendingText,
    sealedTurns: s.sealedTurns,
    needsLoad: s.threadId !== null && history.requested > history.settled
      ? { threadId: s.threadId, gen: history.requested }
      : null,
  }
}

function messageText(message: ChatMessage): string {
  return message.blocks
    .flatMap((block) => (block.kind === 'rich_text' && 'segments' in block ? block.segments : []))
    .map((segment) => (segment.type === 'text' ? segment.text : ''))
    .join('')
}
