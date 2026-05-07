import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AgentsPage, buildAgentPayload } from './AgentsPage.tsx'
import { AnalyzePage } from './AnalyzePage.tsx'
import { ChatEmptyState, ChatLayout, ChatThreadView, persistUserChatTurn } from './ChatPage.tsx'
import { shareAnalyzeRunToChat } from '../analyze/shareToChat.ts'
import { BlockRegistryProvider, createDefaultBlockRegistry, type Block } from '../blocks'
import { openChatTurnStream } from '../chat/openChatTurnStream.ts'
import type { ChatSseEvent } from '../chat/sseEventTypes.ts'
import { AuthContext } from '../shell/authTypes.ts'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'

const IMPORTED_MEMO_BLOCK: Block = {
  id: 'memo-block',
  kind: 'rich_text',
  snapshot_id: SNAPSHOT_ID,
  data_ref: { kind: 'analyze_run', id: 'memo-block' },
  source_refs: [],
  as_of: '2026-05-06T00:00:00.000Z',
  segments: [{ type: 'text', text: 'Imported memo content' }],
}

function wrapWithAuth(element: React.ReactElement): React.ReactElement {
  return (
    <AuthContext.Provider
      value={{
        session: { userId: USER_ID, displayName: 'Mock User' },
        signIn: () => undefined,
        signOut: () => undefined,
      }}
    >
      {element}
    </AuthContext.Provider>
  )
}

function renderWithAuth(element: React.ReactElement): string {
  return renderToString(wrapWithAuth(element))
}

test('Chat surface renders thread list and composer workflow copy without phase placeholders', () => {
  const html = renderWithAuth(
    <MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route path="/chat" element={<ChatLayout />}>
          <Route index element={<ChatEmptyState />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Thread list/)
  assert.match(html, /Start research/)
  assert.doesNotMatch(html, /ships with P2\.1/i)
})

test('Chat thread route renders message stream and composer workflow copy', () => {
  const html = renderWithAuth(
    <MemoryRouter initialEntries={['/chat/thread-123']}>
      <Routes>
        <Route path="/chat" element={<ChatLayout />}>
          <Route path=":threadId" element={<ChatThreadView />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Message stream/)
  assert.match(html, /Ask the analyst/)
  assert.doesNotMatch(html, /ships with P2\.1/i)
})

test('Chat thread route does not render imported Analyze memo from Router state', () => {
  const html = renderWithAuth(
    <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/chat/thread-123',
            state: {
              importedMemo: {
                run_id: 'run-123',
                snapshot_id: SNAPSHOT_ID,
                blocks: [IMPORTED_MEMO_BLOCK],
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/chat/:threadId" element={<ChatThreadView />} />
        </Routes>
      </MemoryRouter>
    </BlockRegistryProvider>,
  )

  assert.doesNotMatch(html, /Imported analyze memo/)
  assert.doesNotMatch(html, /Imported memo content/)
})

test('Chat thread route loads persisted user and assistant messages on direct navigation', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const persistedBlock: Block = {
    id: 'persisted-block',
    kind: 'rich_text',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'chat_turn', id: 'persisted-block' },
    source_refs: [],
    as_of: '2026-05-06T00:00:00.000Z',
    segments: [{ type: 'text', text: 'Persisted assistant answer' }],
  }
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), '/v1/chat/threads/thread-123/messages')
      assert.equal((init?.headers as Record<string, string>)['x-user-id'], USER_ID)
      return new Response(JSON.stringify({
        messages: [
          {
            message_id: 'message-user',
            thread_id: 'thread-123',
            role: 'user',
            snapshot_id: SNAPSHOT_ID,
            blocks: [
              {
                id: 'user-block',
                kind: 'rich_text',
                snapshot_id: SNAPSHOT_ID,
                data_ref: { kind: 'chat_turn', id: 'message-user' },
                source_refs: [],
                as_of: '2026-05-06T00:00:00.000Z',
                segments: [{ type: 'text', text: 'Persisted user prompt' }],
              },
            ],
            content_hash: 'sha256:user',
            created_at: '2026-05-06T00:00:00.000Z',
          },
          {
            message_id: 'message-1',
            thread_id: 'thread-123',
            role: 'assistant',
            snapshot_id: SNAPSHOT_ID,
            blocks: [persistedBlock],
            content_hash: 'sha256:persisted',
            created_at: '2026-05-06T00:00:00.000Z',
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(
        <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
          <MemoryRouter initialEntries={['/chat/thread-123']}>
            <Routes>
              <Route path="/chat/:threadId" element={<ChatThreadView />} />
            </Routes>
          </MemoryRouter>
        </BlockRegistryProvider>,
      ))
    })
    await act(async () => undefined)

    assert.match(dom.window.document.body.innerHTML, /Persisted user prompt/)
    assert.match(dom.window.document.body.innerHTML, /Persisted assistant answer/)
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Chat user turns are posted to durable thread messages before streaming', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init })
      return new Response(JSON.stringify({
        message: {
          message_id: 'message-user',
          thread_id: 'thread-123',
          role: 'user',
          snapshot_id: SNAPSHOT_ID,
          blocks: [IMPORTED_MEMO_BLOCK],
          content_hash: 'sha256:user',
          created_at: '2026-05-06T00:00:00.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    }

    const message = await persistUserChatTurn({
      threadId: 'thread-123',
      userId: USER_ID,
      messageId: 'message-user',
      snapshotId: SNAPSHOT_ID,
      content: 'Review margins',
    })

    assert.equal(message.message_id, 'message-user')
    assert.equal(calls[0].input, '/v1/chat/threads/thread-123/messages')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal((calls[0].init?.headers as Record<string, string>)['x-user-id'], USER_ID)
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      message_id: 'message-user',
      snapshot_id: SNAPSHOT_ID,
      content: 'Review margins',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Chat stream URL carries dev identity and refreshes history after completion', () => {
  const eventSources: MockEventSource[] = []
  const events: ChatSseEvent[] = []
  let refreshes = 0
  const source = openChatTurnStream({
    threadId: 'thread-123',
    runId: 'run-1',
    userIntent: 'Review margins',
    userId: USER_ID,
  }, {
    onEvent: (event) => events.push(event),
    onCompleted: () => {
      refreshes += 1
    },
    onError: () => {
      throw new Error('unexpected stream error')
    },
  }, class extends MockEventSource {
      constructor(url: string | URL) {
        super(url)
        eventSources.push(this)
      }
    } as unknown as typeof EventSource)

  assert.equal(source, eventSources[0] as unknown as EventSource)
  assert.match(eventSources[0].url, /user_id=00000000-0000-4000-8000-000000000001/)
  assert.match(eventSources[0].url, /user_intent=Review\+margins/)

  eventSources[0].emit('turn.completed', {
    type: 'turn.completed',
    seq: 1,
    thread_id: 'thread-123',
    run_id: 'run-1',
    turn_id: 'run-1',
    message_id: 'message-completed',
  })

  assert.equal(refreshes, 1)
  assert.equal(events.at(-1)?.type, 'turn.completed')
  assert.equal(eventSources[0].closed, true)
})

test('Analyze surface renders template controls, source controls, memo canvas, and Add to chat action', () => {
  const html = renderWithAuth(
    <MemoryRouter initialEntries={['/analyze']}>
      <Routes>
        <Route path="/analyze" element={<AnalyzePage />} />
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Template/)
  assert.match(html, /Instructions/)
  assert.match(html, /Source controls/)
  assert.match(html, /Memo canvas/)
  assert.match(html, /Generate memo/)
  assert.match(html, /Add to chat/)
  assert.doesNotMatch(html, /ships with P4\.2/i)
})

test('Analyze Add-to-chat shares run blocks through the durable artifact endpoint', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init })
      return new Response(JSON.stringify({
        thread: {
          thread_id: 'thread-123',
          title: 'Earnings quality - Research memo',
          updated_at: '2026-05-06T00:00:00.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    }

    const result = await shareAnalyzeRunToChat({
      userId: USER_ID,
      sourceKind: 'memo',
      title: 'Earnings quality - Research memo',
      primarySubjectRef: null,
      run: {
        run_id: 'run-123',
        template_id: 'earnings-quality',
        template_version: 1,
        snapshot_id: SNAPSHOT_ID,
        blocks: [IMPORTED_MEMO_BLOCK],
        created_at: '2026-05-06T00:00:00.000Z',
      },
    })

    assert.equal(result.thread.thread_id, 'thread-123')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, '/v1/analyze/runs/run-123/share-to-chat')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal((calls[0].init?.headers as Record<string, string>)['x-user-id'], USER_ID)
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      source_kind: 'memo',
      title: 'Earnings quality - Research memo',
      primary_subject_ref: null,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Agents surface renders CRUD controls, run history, and activity status', () => {
  const html = renderWithAuth(<AgentsPage />)

  assert.match(html, /Create agent/)
  assert.match(html, /Universe/)
  assert.match(html, /Alert rule/)
  assert.match(html, /issuer: demo-issuer/)
  assert.match(html, /critical\+ headline contains margin/)
  assert.match(html, /Disable/)
  assert.match(html, /Delete/)
  assert.match(html, /Run history/)
  assert.match(html, /Activity/)
  assert.doesNotMatch(html, /ships with P5\.1/i)
})

test('Agents create/edit payloads include selected universe and alert rule policy', () => {
  assert.deepEqual(buildAgentPayload({
    name: ' Margin monitor ',
    thesis: ' Watch supplier margin risk ',
    cadence: 'hourly',
    subjectKind: 'issuer',
    subjectId: ' issuer-123 ',
    alertRuleId: ' margin-risk ',
    alertSeverity: 'high',
    alertHeadline: ' margin ',
    alertEmail: true,
  }), {
    name: 'Margin monitor',
    thesis: 'Watch supplier margin risk',
    cadence: 'hourly',
    universe: { mode: 'static', subject_refs: [{ kind: 'issuer', id: 'issuer-123' }] },
    alert_rules: [
      {
        rule_id: 'margin-risk',
        severity_at_least: 'high',
        headline_contains: 'margin',
        channels: ['email'],
      },
    ],
  })

  assert.deepEqual(buildAgentPayload({
    name: 'No-alert monitor',
    thesis: 'Track guidance',
    cadence: 'weekly',
    subjectKind: 'theme',
    subjectId: 'quality',
    alertRuleId: '',
    alertSeverity: 'medium',
    alertHeadline: '',
    alertEmail: false,
  }), {
    name: 'No-alert monitor',
    thesis: 'Track guidance',
    cadence: 'weekly',
    universe: { mode: 'static', subject_refs: [{ kind: 'theme', id: 'quality' }] },
    alert_rules: [],
  })
})

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
  }
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
  }
}

class MockEventSource {
  readonly url: string
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor(url: string | URL) {
    this.url = String(url)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function'
      ? listener as (event: MessageEvent) => void
      : (event: MessageEvent) => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  close() {
    this.closed = true
  }

  emit(type: string, payload: Record<string, unknown>) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) })
    this.onmessage?.(event)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}
