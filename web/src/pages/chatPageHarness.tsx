/* eslint-disable react-refresh/only-export-components -- test-only module, never hot-reloaded */
import { SidebarSlotProvider } from '../shell/SidebarSlotProvider.tsx'
import { useSidebarSlot } from '../shell/useSidebarSlot.ts'
import assert from 'node:assert/strict'

import { JSDOM } from 'jsdom'
import { act, Profiler, StrictMode, useEffect, type ReactElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, createRoutesFromElements, Outlet, Route, RouterProvider, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'

import { BlockRegistryProvider, createDefaultBlockRegistry } from '../blocks/index.ts'
import { forgetThreadDeletes } from '../chat/threadDeletes.ts'
import { Announcer } from '../ui/Announcer.tsx'
import { resetAnnouncerForTests } from '../ui/announcer.ts'
import type { ChatMessage } from '../chat/messageTypes.ts'
import { AuthContext } from '../shell/authTypes.ts'
import { ChatLayout } from './ChatPage.tsx'

export const USER_ID = '00000000-0000-4000-8000-000000000001'
export const ANSWER = "NVIDIA's revenue rose"
export const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

export class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor(url: string | URL) {
    this.url = String(url)
    FakeEventSource.instances.push(this)
  }

  get params(): URLSearchParams {
    return new URL(this.url, 'http://localhost').searchParams
  }

  get threadId(): string {
    return /\/v1\/chat\/threads\/([^/]+)\/stream/.exec(this.url)?.[1] ?? ''
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  get closed(): boolean {
    return this.readyState === 2
  }

  close() {
    this.readyState = 2
  }

  // The server answered: the turn exists from here on.
  open() {
    if (this.readyState !== 0) return
    this.readyState = 1
    this.onopen?.()
  }

  // A real EventSource stops delivering once closed, and delivers only once open.
  emit(type: string, seq: number, payload: Record<string, unknown> = {}) {
    this.open()
    if (this.closed) return
    const data = JSON.stringify({
      type,
      seq,
      thread_id: this.threadId,
      run_id: this.params.get('run_id'),
      turn_id: this.params.get('turn_id'),
      ...payload,
    })
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }))
  }
}

type Write = [method: string, path: string, body: string]
type Reply = { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>

function block(id: string, text: string) {
  return {
    id,
    kind: 'rich_text',
    snapshot_id: '11111111-1111-4111-8111-111111111111',
    data_ref: { kind: 'chat_turn', id },
    source_refs: [],
    as_of: '2026-05-06T00:00:00.000Z',
    segments: [{ type: 'text', text }],
  }
}

export function chatMessage(threadId: string, id: string, role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    message_id: id,
    thread_id: threadId,
    role,
    snapshot_id: '11111111-1111-4111-8111-111111111111',
    blocks: [block(`${id}-block`, text)],
    content_hash: `sha256:${id}`,
    created_at: '2026-05-06T00:00:00.000Z',
    ...extra,
  } as ChatMessage
}

export function sealedAnswer(threadId: string): ChatMessage {
  return chatMessage(threadId, 'a1', 'assistant', ANSWER, {
    block_proofs: { 'a1-block': { evidence: 'linked', calculation: 'not_verified', public_by_cutoff: 'unknown' } },
  })
}

export class FakeServer {
  readonly log: Write[] = []
  readonly posted = new Map<string, ChatMessage>()
  threads: Array<{ thread_id: string; title: string | null; updated_at: string }> = []
  createdThreadId = 'T1'
  history: (threadId: string) => Reply = () => ({ body: { messages: [] } })
  createReply: () => Reply = () => ({ status: 201, body: this.createThread() })
  listReply: () => Reply = () => ({ body: { threads: this.threads } })
  postReply: (message: ChatMessage) => Reply = (message) => ({ status: 201, body: { message } })
  deleteReply: (threadId: string) => Reply = (threadId) => {
    this.threads = this.threads.filter((thread) => thread.thread_id !== threadId)
    return { body: {} }
  }

  createThread() {
    const thread = { thread_id: this.createdThreadId, title: null, updated_at: '2026-05-06T00:00:00.000Z' }
    this.threads = [thread, ...this.threads]
    return thread
  }

  writes(): Write[] {
    return this.log.filter(([method]) => method !== 'GET')
  }

  gets(path: string): number {
    return this.log.filter(([method, logged]) => method === 'GET' && logged === path).length
  }

  postedUser(threadId: string): ChatMessage {
    return [...this.posted.values()].find((message) => message.thread_id === threadId)!
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    const path = String(input)
    const body = init?.body === undefined ? '' : String(init.body)
    this.log.push([method, path, body])
    const reply = await Promise.race([this.route(method, path, body), rejectOnAbort(init?.signal)])
    if (init?.signal?.aborted) throw init.signal.reason
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
  }

  private route(method: string, path: string, body: string): Reply {
    if (path === '/v1/chat/threads' && method === 'GET') return this.listReply()
    if (path === '/v1/chat/threads' && method === 'POST') return this.createReply()
    const match = /^\/v1\/chat\/threads\/([^/]+)\/messages$/.exec(path)
    if (match && method === 'POST') {
      const posted = JSON.parse(body) as { message_id: string; content: string }
      const message = chatMessage(match[1], posted.message_id, 'user', posted.content)
      this.posted.set(posted.message_id, message)
      return this.postReply(message)
    }
    if (match && method === 'GET') return this.history(match[1])
    const thread = /^\/v1\/chat\/threads\/([^/]+)$/.exec(path)
    if (thread && method === 'DELETE') return this.deleteReply(thread[1])
    throw new Error(`unexpected request ${method} ${path}`)
  }
}

// Like a real fetch, an abort rejects a request whose reply never comes.
function rejectOnAbort(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function LocationProbe({ onPath, onNavigate }: { onPath: (path: string) => void; onNavigate: (navigate: NavigateFunction) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => onPath(location.pathname), [location.pathname, onPath])
  useEffect(() => onNavigate(navigate), [navigate, onNavigate])
  return null
}

export type Harness = {
  dom: JSDOM
  container: HTMLElement
  server: FakeServer
  frames: string[]
  statusFrames: string[][]
  path: () => string
  navigate: (to: string) => Promise<void>
  back: () => Promise<void>
  text: () => string
  query: (selector: string) => Element | null
  button: (name: string) => HTMLButtonElement
  flush: () => Promise<void>
  type: (text: string) => Promise<void>
  ask: (text: string, presses?: number) => Promise<void>
  unmount: () => Promise<void>
  cleanup: () => Promise<void>
}

type RenderOptions = {
  strict?: boolean
  // Holds every navigation into a thread uncommitted, the way a slow CPU
  // leaves react-router's navigation transition behind the stream's updates.
  threadRoute?: Promise<unknown>
}

// Stands in for the shell's Sidebar: its collapse toggle, and the slot ChatLayout
// portals its chat list into.
function SidebarSlotHost() {
  const { collapsed, setCollapsed, setNode } = useSidebarSlot()
  return (
    <>
      <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)} />
      {collapsed ? null : <aside ref={setNode} />}
    </>
  )
}

export function WithSidebarSlot({ children }: { children: ReactNode }) {
  return (
    <SidebarSlotProvider>
      <SidebarSlotHost />
      {children}
    </SidebarSlotProvider>
  )
}

export async function renderChat(initialPath: string, server: FakeServer, options: RenderOptions = {}): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const globals = globalThis as unknown as Record<string, unknown>
  const saved = Object.fromEntries(['IS_REACT_ACT_ENVIRONMENT', 'document', 'window', 'ResizeObserver', 'EventSource', 'fetch']
    .map((key) => [key, globals[key]]))
  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = dom.window.document
  globals.window = dom.window
  globals.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  FakeEventSource.instances = []
  globals.EventSource = FakeEventSource
  globals.fetch = server.fetch

  const container = dom.window.document.getElementById('root')!
  const frames: string[] = []
  const statusFrames: string[][] = []
  let currentPath = initialPath
  const onPath = (path: string) => {
    currentPath = path
  }
  let routerNavigate: NavigateFunction = () => assert.fail('router not mounted')
  const onNavigate = (navigate: NavigateFunction) => {
    routerNavigate = navigate
  }
  const threadRoute = options.threadRoute
  const router = createMemoryRouter(createRoutesFromElements(
    <Route element={<><Outlet /><LocationProbe onPath={onPath} onNavigate={onNavigate} /></>}>
      <Route path="/chat" element={<ChatLayout />}>
        <Route path=":threadId" loader={threadRoute ? () => threadRoute : undefined} />
      </Route>
      <Route path="/home" element={<p>Home</p>} />
    </Route>,
  ), { initialEntries: [initialPath] })
  const tree: ReactElement = (
    <Profiler
      id="chat"
      onRender={() => {
        frames.push(container.textContent ?? '')
        statusFrames.push([...container.querySelectorAll('[role="status"]')].map((node) => node.textContent ?? ''))
      }}
    >
      <AuthContext.Provider value={{ session: { userId: USER_ID, displayName: 'Test User' }, signIn: () => undefined, signOut: () => undefined }}>
        <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
          <WithSidebarSlot>
            <RouterProvider router={router} />
          </WithSidebarSlot>
          <Announcer />
        </BlockRegistryProvider>
      </AuthContext.Provider>
    </Profiler>
  )
  const root = createRoot(container)
  const flush = () => act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  })
  await act(async () => root.render(options.strict ? <StrictMode>{tree}</StrictMode> : tree))
  await flush()
  let mounted = true
  const unmount = async () => {
    if (!mounted) return
    mounted = false
    await act(async () => root.unmount())
  }

  const harness: Harness = {
    dom,
    container,
    server,
    frames,
    statusFrames,
    path: () => currentPath,
    navigate: async (to) => {
      await act(async () => routerNavigate(to))
      await flush()
    },
    back: async () => {
      await act(async () => routerNavigate(-1))
      await flush()
    },
    text: () => container.textContent ?? '',
    query: (selector) => container.querySelector(selector),
    button: (name) => {
      const found = [...container.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === name || button.textContent === name,
      )
      assert.ok(found, `button "${name}" is rendered`)
      return found as HTMLButtonElement
    },
    flush,
    type: async (text) => {
      const textarea = container.querySelector('textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
        textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    },
    ask: async (text, presses = 1) => {
      await harness.type(text)
      const textarea = container.querySelector('textarea')!
      await act(async () => {
        for (let i = 0; i < presses; i++) {
          textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        }
      })
      await flush()
    },
    unmount,
    cleanup: async () => {
      await unmount()
      forgetThreadDeletes()
      resetAnnouncerForTests()
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globals[key]
        else globals[key] = value
      }
    },
  }
  return harness
}

export const occurrences = (text: string, needle: string) => text.split(needle).length - 1

export async function streamAnswer(h: Harness, source: FakeEventSource) {
  await act(async () => {
    source.emit('turn.started', 1)
    source.emit('block.began', 2, { block_id: 'b1', kind: 'rich_text' })
    source.emit('block.delta', 3, { block_id: 'b1', delta: { segment: { type: 'text', text: ANSWER } } })
    source.emit('block.completed', 4, { block_id: 'b1', content_hash: 'h1' })
  })
  await h.flush()
}

export async function complete(h: Harness, source: FakeEventSource, message: unknown = sealedAnswer(source.threadId)) {
  await act(async () => source.emit('turn.completed', 5, { message_id: 'a1', message }))
  await h.flush()
}

export const HISTORY_T1 = '/v1/chat/threads/T1/messages'
// The sealed answer as rendered: its block carries the label its server proof earns.
export const SEALED_TEXT = `Source-linked narrative${ANSWER}`

export const TWO_THREADS = [
  { thread_id: 'T1', title: 'Chips', updated_at: '2026-05-06T00:00:00.000Z' },
  { thread_id: 'T2', title: 'Rates', updated_at: '2026-05-05T00:00:00.000Z' },
]
export const T2_QUESTION = chatMessage('T2', 't2-user', 'user', 'What did the Fed do?')
export const STILL_ANSWERING = /The analyst is still answering this question\./

export async function openThread(h: Harness, threadId: string) {
  await act(async () => (h.query(`a[href="/chat/${threadId}"]`) as HTMLAnchorElement).click())
  await h.flush()
}

export const consecutive = (counts: number[]) => counts.filter((count, i) => i === 0 || count !== counts[i - 1])

export const RUN_OF = (server: FakeServer) => {
  const source = FakeEventSource.instances[0]
  return { run_id: source.params.get('run_id')!, turn_id: [...server.posted.keys()][0] }
}

export const streamParams = (source: FakeEventSource) => Object.fromEntries(source.params)

export type RunJson = { run_id: string; turn_id: string; status: 'in_flight' | 'completed' | 'failed'; message_id?: string }

// A messages GET body as the chat service builds it: active_run is the oldest run in flight.
export function threadRead(messages: ReadonlyArray<ChatMessage>, runs: ReadonlyArray<RunJson> = []) {
  const active = runs.find((run) => run.status === 'in_flight')
  return { body: { messages, active_run: active ? { run_id: active.run_id, turn_id: active.turn_id } : null, runs } }
}

export const answerMessage = (threadId: string, id: string, text: string): ChatMessage =>
  chatMessage(threadId, id, 'assistant', text, {
    block_proofs: { [`${id}-block`]: { evidence: 'linked', calculation: 'not_verified', public_by_cutoff: 'unknown' } },
  })
