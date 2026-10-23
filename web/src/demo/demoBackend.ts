// The static demo's backend: the page answers its own /v1 requests from the recorded
// golden conversation, through the replay UI mode runs (services/app/src/replayCore.ts).
// The replay matches the requests. This module adapts fetch and EventSource to it and
// decides what a visitor gets when nothing recorded matches.
import fixtureJson from '../../../services/app/fixtures/golden-conversation.replay.json'
import {
  createReplay,
  parseReplayFixture,
  recordedQuestions,
  type Replay,
  type ReplayReply,
  type ReplayStore,
} from '../../../services/app/src/replayCore.ts'
import { isApiPath } from '../../../services/app/src/routes.ts'

const fixture = parseReplayFixture(fixtureJson, 'golden-conversation.replay.json')

/** The recorded questions, in the order they were asked. */
export const DEMO_QUESTIONS: readonly string[] = recordedQuestions(fixture)

// ponytail: the capture has no timings, so every answer streams over about the same
// time whatever its length. Record timings if the pacing ever has to look real.
const STREAM_BUDGET_MS = 2_500

/** When each event fires, in ms after open. Heartbeats take no time of their own: how
 *  many a capture holds depends on how slowly the recording machine answered. */
export function eventDelays(events: readonly SseEvent[]): number[] {
  const paced = events.filter(({ event }) => event !== 'heartbeat').length
  const gap = Math.min(120, Math.max(10, STREAM_BUDGET_MS / Math.max(1, paced)))
  let at = 0
  return events.map(({ event }) => (event === 'heartbeat' ? at : (at += gap)))
}

/** From here on the replay answers every /v1 fetch and EventSource in this page, and
 *  none reaches the network. Call once, before the app loads. */
export function installDemoBackend(store: ReplayStore | undefined): void {
  const replay = createReplay(fixture, store)
  installFetch(replay)
  installEventSource(replay)
}

/** This tab's sessionStorage, which outlives a reload; none when the browser blocks the
 *  page's site data, so the replay keeps its session in memory for this page load. */
export function tabStore(): ReplayStore | undefined {
  let storage: Storage | null
  try {
    storage = sessionStorage
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return undefined
    throw error
  }
  // Firefox with storage disabled reads it as null instead of throwing.
  if (storage === null) return undefined
  const tab = storage
  return {
    getItem: (key) => tab.getItem(key),
    setItem: (key, value) => {
      try {
        tab.setItem(key, value)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'QuotaExceededError')) throw error
        // The session saved before is now behind the page; a reload must not resume it.
        tab.removeItem(key)
      }
    },
  }
}

function installFetch(replay: Replay): void {
  const network = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input, init) => {
    // Resolves '/v1/...' against the page, so the base path doesn't matter.
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!isApiPath(url.pathname)) return network(request)
    request.signal.throwIfAborted()
    const reply = replay({
      method: request.method,
      path: url.pathname,
      query: url.search.replace(/^\?/, ''),
      body: await request.text(),
    })
    announce(request.method, url.pathname, reply)
    // The caller's signal: the Request's own follows it only weakly, so a collected Request would never abort.
    if (startNewChatInstead(request.method, url.pathname, reply)) return unanswered(init?.signal ?? request.signal)
    return toResponse(reply ?? offScript())
  }
}

/** For the history of the thread this page shows, which the replay has no recording of
 *  (most often one New chat minted in a replay session the tab has lost, #429), sends
 *  the page to a new chat. True when it did; the load is then left unanswered, so no
 *  error shows while the page goes. */
function startNewChatInstead(method: string, path: string, reply: ReplayReply | undefined): boolean {
  const thread = /^\/v1\/chat\/threads\/([^/]+)\/messages$/.exec(path)?.[1]
  if (reply || method !== 'GET' || thread === undefined) return false
  const page = /^(.*\/chat)\/([^/]+)\/?$/.exec(location.pathname)
  if (page?.[2] !== thread) return false
  location.replace(page[1]!)
  return true
}

function unanswered(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.throwIfAborted()
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

type Listener = ((event: Event) => void) | null

function installEventSource(replay: Replay): void {
  // The part of EventSource the app uses (src/chat/openChatTurnStream.ts).
  class ReplayEventSource extends EventTarget {
    static readonly CONNECTING = CONNECTING
    static readonly OPEN = OPEN
    static readonly CLOSED = CLOSED
    readonly url: string
    readonly withCredentials = false
    readyState = CONNECTING
    onopen: Listener = null
    onmessage: Listener = null
    onerror: Listener = null
    private timers: ReturnType<typeof setTimeout>[] = []

    constructor(url: string | URL) {
      super()
      const target = new URL(url, location.href)
      this.url = target.href
      // Asked now, as a server is asked when the stream opens, so the replay's timeline
      // moves when it does under the Node handler.
      const reply = replay({ method: 'GET', path: target.pathname, query: target.search.replace(/^\?/, ''), body: '' })
      announce('GET', target.pathname, reply)
      // A native EventSource fails on an answer that isn't an event stream, too.
      if (reply?.status !== 200 || !reply.contentType.startsWith('text/event-stream')) {
        this.at(0, () => this.fail())
        return
      }
      const events = parseSse(reply.body)
      const delays = eventDelays(events)
      this.at(0, () => {
        this.readyState = OPEN
        this.emit(new Event('open'))
      })
      events.forEach(({ event, data, id }, i) =>
        this.at(delays[i]!, () => this.emit(new MessageEvent(event, { data, lastEventId: id }))))
      // The recorded server then ended the stream, which a native EventSource reports as
      // an error. The app closes on turn.completed first, which cancels this.
      this.at((delays.at(-1) ?? 0) + 120, () => this.fail())
    }

    close(): void {
      this.timers.forEach(clearTimeout)
      this.readyState = CLOSED
    }

    private at(delayMs: number, run: () => void) {
      this.timers.push(setTimeout(run, delayMs))
    }

    private fail() {
      this.readyState = CLOSED
      this.emit(new Event('error'))
    }

    private emit(event: Event) {
      this.dispatchEvent(event)
      if (event.type === 'open') this.onopen?.(event)
      else if (event.type === 'message') this.onmessage?.(event)
      else if (event.type === 'error') this.onerror?.(event)
    }
  }
  globalThis.EventSource = ReplayEventSource as unknown as typeof EventSource
}

export type SseEvent = { event: string; data: string; id: string }

/** Splits a recorded text/event-stream body into the events a browser dispatches, by
 *  the SSE field rules. */
export function parseSse(body: string): SseEvent[] {
  const events: SseEvent[] = []
  let event = ''
  let data: string[] = []
  let id = ''
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === '') {
      if (data.length > 0) events.push({ event: event || 'message', data: data.join('\n'), id })
      event = ''
      data = []
      continue
    }
    const colon = line.indexOf(':')
    if (colon === 0) continue
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    else if (field === 'id') id = value
  }
  return events
}

// In-page requests never reach the network, so this log is how a visitor in devtools,
// and the e2e, see what the page asked and got.
function announce(method: string, path: string, reply: ReplayReply | undefined): void {
  console.info(`[demo replay] ${method} ${path} -> ${reply?.status ?? 404}`)
}

function offScript(): ReplayReply {
  // The chat shows a failed request's `error` (src/http/authFetch.ts), so an off-script
  // question explains itself.
  return {
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({
      error:
        "This demo replays one recorded conversation, so it can't answer this. " +
        `In Chat, ask in order: ${DEMO_QUESTIONS.map((q) => `"${q}"`).join(', ')}.`,
    }),
  }
}

function toResponse(reply: ReplayReply): Response {
  return new Response(reply.status === 204 || reply.status === 304 ? null : reply.body, {
    status: reply.status,
    headers: reply.contentType ? { 'content-type': reply.contentType } : {},
  })
}
