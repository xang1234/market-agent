import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom'

import { AgentPayloadValidationError, buildAgentPayload } from '../agents/agentPayload.ts'
import { persistUserChatTurn } from '../chat/persistUserChatTurn.ts'
import { AgentsPage } from './AgentsPage.tsx'
import { AnalyzePage } from './AnalyzePage.tsx'
import { ChatLayout } from './ChatPage.tsx'
import { shareAnalyzeRunToChat } from '../analyze/shareToChat.ts'
import { BlockRegistryProvider, createDefaultBlockRegistry, type Block } from '../blocks'
import { openChatTurnStream } from '../chat/openChatTurnStream.ts'
import { CHAT_SSE_EVENT_TYPES, type ChatSseEvent } from '../chat/sseEventTypes.ts'
import { AuthContext } from '../shell/authTypes.ts'
import { ThemeProvider } from '../shell/ThemeProvider.tsx'
import { WorkspaceShell } from '../shell/WorkspaceShell.tsx'
import { resetResourcesForTests } from '../fetch/resource.ts'
import { WithSidebarSlot } from './chatPageHarness.tsx'

afterEach(resetResourcesForTests)

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

test('Analyze playbooks and inspectable evidence controls are present in workflow surfaces', () => {
  const router = createMemoryRouter([
    {
      element: <WorkspaceShell />,
      children: [{ index: true, element: <AnalyzePage /> }],
    },
  ])
  const html = renderWithAuth(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  )

  assert.match(html, /Finance Research/)
  assert.match(html, /href="#workspace-main"/)
  assert.match(html, /id="workspace-main"/)
  assert.doesNotMatch(html, /raw provider payload/i)
})

// The chat list portals into the shell sidebar, which server rendering never attaches;
// ChatPage.sidebar.test.tsx covers it in a DOM.
test('Chat surface renders composer workflow copy without phase placeholders', () => {
  const html = renderWithAuth(
    <WithSidebarSlot><MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route path="/chat" element={<ChatLayout />} />
      </Routes>
    </MemoryRouter></WithSidebarSlot>,
  )

  assert.match(html, /Start research/)
  assert.doesNotMatch(html, /ships with P2\.1/i)
})

test('Chat thread route renders message stream and composer workflow copy', () => {
  const html = renderWithAuth(
    <WithSidebarSlot><MemoryRouter initialEntries={['/chat/thread-123']}>
      <Routes>
        <Route path="/chat" element={<ChatLayout />}>
          <Route path=":threadId" />
        </Route>
      </Routes>
    </MemoryRouter></WithSidebarSlot>,
  )

  assert.match(html, /Ask the analyst/)
  assert.doesNotMatch(html, /ships with P2\.1/i)
})

test('Chat thread route does not render imported Analyze memo from Router state', () => {
  const html = renderWithAuth(
    <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
      <WithSidebarSlot><MemoryRouter
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
          <Route path="/chat" element={<ChatLayout />}>
            <Route path=":threadId" />
          </Route>
        </Routes>
      </MemoryRouter></WithSidebarSlot>
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
      if (String(input) === '/v1/chat/threads') return new Response(JSON.stringify({ threads: [] }), { status: 200 })
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
          <WithSidebarSlot><MemoryRouter initialEntries={['/chat/thread-123']}>
            <Routes>
              <Route path="/chat" element={<ChatLayout />}>
                <Route path=":threadId" />
              </Route>
            </Routes>
          </MemoryRouter></WithSidebarSlot>
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

test('Chat thread route virtualizes long persisted histories while preserving rendered assistant blocks', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input, init) => {
      if (String(input) === '/v1/chat/threads') return new Response(JSON.stringify({ threads: [] }), { status: 200 })
      assert.equal(String(input), '/v1/chat/threads/thread-123/messages')
      assert.equal((init?.headers as Record<string, string>)['x-user-id'], USER_ID)
      return new Response(JSON.stringify({
        messages: Array.from({ length: 80 }, (_, index) => persistedMessage(index)),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(
        <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
          <WithSidebarSlot><MemoryRouter initialEntries={['/chat/thread-123']}>
            <Routes>
              <Route path="/chat" element={<ChatLayout />}>
                <Route path=":threadId" />
              </Route>
            </Routes>
          </MemoryRouter></WithSidebarSlot>
        </BlockRegistryProvider>,
      ))
    })
    await act(async () => undefined)

    const list = dom.window.document.querySelector('[data-testid="virtualized-message-list"]')
    const renderedRows = dom.window.document.querySelectorAll('[data-testid^="chat-message-"]')
    assert.ok(list)
    assert.ok(renderedRows.length > 0)
    assert.ok(renderedRows.length < 20, `expected a bounded rendered window, got ${renderedRows.length}`)
    assert.match(dom.window.document.body.innerHTML, /Persisted assistant answer 0/)
    assert.doesNotMatch(dom.window.document.body.innerHTML, /Persisted assistant answer 79/)
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
      content: 'Review margins',
    })

    assert.equal(message.message_id, 'message-user')
    assert.equal(calls[0].input, '/v1/chat/threads/thread-123/messages')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal((calls[0].init?.headers as Record<string, string>)['x-user-id'], USER_ID)
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { content: 'Review margins' })
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
    turnId: 'message-user',
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
  assert.match(eventSources[0].url, /turn_id=message-user/)

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

test('Chat stream delivers every event kind the server sends, a sealed answer shown before it is saved included', () => {
  const eventSources: MockEventSource[] = []
  const events: ChatSseEvent[] = []
  openChatTurnStream({
    threadId: 'thread-123',
    runId: 'run-1',
    turnId: 'message-user',
    userIntent: 'Review margins',
    userId: USER_ID,
  }, {
    onEvent: (event) => events.push(event),
    onError: () => {
      throw new Error('unexpected stream error')
    },
  }, class extends MockEventSource {
      constructor(url: string | URL) {
        super(url)
        eventSources.push(this)
      }
    } as unknown as typeof EventSource)

  const delivered = CHAT_SSE_EVENT_TYPES.filter((type) => type !== 'turn.completed' && type !== 'turn.error')
  delivered.forEach((type, i) => eventSources[0].emit(type, { type, seq: i + 1, thread_id: 'thread-123', run_id: 'run-1', turn_id: 'message-user' }))
  assert.deepEqual(events.map((event) => event.type), delivered)
  assert.ok(delivered.includes('answer.shown'))
})

test('Chat stream delivers a server-signaled turn error as an event, closes, and reports no connection error', () => {
  const eventSources: MockEventSource[] = []
  const events: ChatSseEvent[] = []
  let errors = 0

  openChatTurnStream({
    threadId: 'thread-123',
    runId: 'run-1',
    turnId: 'message-user',
    userIntent: 'Review margins',
    userId: USER_ID,
  }, {
    onEvent: (event) => events.push(event),
    onCompleted: () => {
      throw new Error('unexpected completion')
    },
    onError: () => {
      errors += 1
    },
  }, class extends MockEventSource {
      constructor(url: string | URL) {
        super(url)
        eventSources.push(this)
      }
    } as unknown as typeof EventSource)

  eventSources[0].emit('turn.error', {
    type: 'turn.error',
    seq: 1,
    thread_id: 'thread-123',
    run_id: 'run-1',
    turn_id: 'run-1',
    error: 'upstream_500',
  })

  assert.equal(errors, 0)
  assert.equal(events.at(-1)?.type, 'turn.error')
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

  assert.match(html, /Playbook/)
  assert.match(html, /Template/)
  assert.match(html, /Sections/)
  assert.match(html, /Instructions/)
  assert.match(html, /Source controls/)
  assert.match(html, /issuer_ir/)
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

test('Agents surface renders CRUD controls and activity status, and holds the per-agent panels until an agent is selected', () => {
  const html = renderWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>)

  assert.match(html, /Create agent/)
  assert.match(html, /Universe/)
  assert.match(html, /Alert rule/)
  assert.doesNotMatch(html, /Quality monitor/)
  assert.doesNotMatch(html, /No agents yet/)
  assert.doesNotMatch(html, /Run history/)
  assert.doesNotMatch(html, /Findings/)
  assert.doesNotMatch(html, /Run activity/)
  assert.doesNotMatch(html, /Thesis conditions/)
  const roster = new JSDOM(html).window.document.querySelector('section')
  assert.equal(roster?.querySelector('h2')?.textContent, 'Agents')
  assert.equal(roster?.querySelector('[role="status"]')?.textContent, 'Activity · Idle')
  assert.doesNotMatch(html, /ships with P5\.1/i)
})

test('Agents roster shows only what the server sent, and says when it could not load', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const requested: string[] = []
  try {
    let answerRoster: (response: Response) => void = () => {}
    globalThis.fetch = async (input) => {
      requested.push(String(input))
      if (String(input) === '/v1/agents') return new Promise<Response>((resolve) => { answerRoster = resolve })
      throw new Error(`unexpected fetch: ${String(input)}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>))
    })
    const rosterText = () => [...dom.window.document.querySelectorAll('section')]
      .find((section) => section.querySelector('h2')?.textContent === 'Agents')?.textContent ?? ''

    assert.equal(rosterText(), 'Agents0 monitors · 0 enabledActivity · IdleLoading agents')
    await act(async () => {
      answerRoster(new Response('{"error":"down"}', { status: 503 }))
    })
    await act(async () => undefined)
    assert.equal(rosterText(), 'Agents0 monitors · 0 enabledActivity · IdleLoad failed: HTTP 503')
    assert.deepEqual(requested, ['/v1/agents'])
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Agents form shows its own validation error beside the submit button, not in the roster status', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input) => {
      if (String(input) === '/v1/agents') {
        return new Response(JSON.stringify({ agents: [], runs: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>))
    })
    await act(async () => undefined)

    const document = dom.window.document
    const refs = document.querySelector<HTMLTextAreaElement>('[name="static-subject-refs"]')!
    // react-dom loaded before this file's DOM existed, so it listens through its focus/keyup fallback, not `input`.
    await act(async () => {
      refs.focus()
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(refs, 'not-a-ref')
      refs.dispatchEvent(new dom.window.Event('keyup', { bubbles: true }))
    })
    const form = document.querySelector('form')!
    await act(async () => {
      form.requestSubmit()
    })

    assert.equal(form.querySelector('[role="alert"]')?.textContent, 'Static subject ref line 1 must be kind:uuid')
    const roster = [...document.querySelectorAll('section')]
      .find((section) => section.querySelector('h2')?.textContent === 'Agents')
    assert.equal(roster?.querySelector('[role="status"]')?.textContent, 'Activity · Idle')
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Agents form keeps a focused field focused when the loaded roster selects its first agent', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  let resolveRoster!: (response: Response) => void
  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url === '/v1/agents') return new Promise<Response>((resolve) => { resolveRoster = resolve })
      if (url.endsWith('/findings')) return json({ findings: [] })
      if (url.endsWith('/activity')) return json({ activity: [] })
      if (url.endsWith('/thesis')) return json({ thesis: null, versions: [], assessments: [], metrics: [] })
      throw new Error(`unexpected fetch: ${url}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>))
    })
    const document = dom.window.document
    const nameInput = document.querySelector<HTMLInputElement>('[name="agent-name"]')!
    nameInput.focus()
    assert.equal(document.activeElement, nameInput)

    await act(async () => {
      resolveRoster(json({
        agents: [{
          agent_id: '11111111-1111-4111-8111-111111111111',
          name: 'Loaded monitor',
          thesis: 'Loaded thesis',
          cadence: 'daily',
          enabled: true,
          universe: { mode: 'static', subject_refs: [] },
          alert_rules: [],
          updated_at: '2026-05-06T00:00:00.000Z',
        }],
        runs: [],
      }))
    })
    await act(async () => undefined)

    assert.deepEqual(
      [...document.querySelectorAll('h2')].map((h) => h.textContent),
      ['Agents', 'Create agent', 'Thesis conditions', 'Findings', 'Run history', 'Run activity'],
    )
    assert.equal(document.activeElement, nameInput)
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Agents form returns to Create agent when the agent being edited is deleted', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const agent = (agent_id: string, name: string) => ({
    agent_id,
    name,
    thesis: `${name} thesis`,
    cadence: 'daily',
    enabled: true,
    universe: { mode: 'static', subject_refs: [] },
    alert_rules: [],
    updated_at: '2026-05-06T00:00:00.000Z',
  })
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url === '/v1/agents') {
        return json({
          agents: [
            agent('11111111-1111-4111-8111-111111111111', 'Edited monitor'),
            agent('22222222-2222-4222-8222-222222222222', 'Other monitor'),
          ],
          runs: [],
        })
      }
      if (url === '/v1/agents/11111111-1111-4111-8111-111111111111' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/findings')) return json({ findings: [] })
      if (url.endsWith('/activity')) return json({ activity: [] })
      if (url.endsWith('/thesis')) return json({ thesis: null, versions: [], assessments: [], metrics: [] })
      throw new Error(`unexpected fetch: ${url}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>))
    })
    await act(async () => undefined)
    await act(async () => undefined)

    const document = dom.window.document
    const editedRow = [...document.querySelectorAll('li')]
      .find((item) => item.querySelector('h3')?.textContent === 'Edited monitor')!
    const rowButton = (label: string) => [...editedRow.querySelectorAll('button')].find((button) => button.textContent === label)!
    await act(async () => {
      rowButton('Edit').click()
    })
    const agentForm = () => document.querySelector('[name="agent-name"]')!.closest('form')!
    const formMessage = () => agentForm().querySelector('[role="status"], [role="alert"]')?.textContent ?? null
    assert.equal(agentForm().querySelector('h2')?.textContent, 'Edit agent')
    assert.equal(formMessage(), 'Editing agent')

    await act(async () => {
      rowButton('Delete').click()
    })
    await act(async () => undefined)

    assert.equal(agentForm().querySelector('h2')?.textContent, 'Create agent')
    assert.equal(formMessage(), null)
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Agents form follows the agent being edited when a delete response arrives late', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  const agent = (agent_id: string, name: string) => ({
    agent_id,
    name,
    thesis: `${name} thesis`,
    cadence: 'daily',
    enabled: true,
    universe: { mode: 'static', subject_refs: [] },
    alert_rules: [],
    updated_at: '2026-05-06T00:00:00.000Z',
  })
  const pendingDeletes = new Map<string, () => void>()
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url === '/v1/agents') {
        return json({
          agents: [
            agent('11111111-1111-4111-8111-111111111111', 'First monitor'),
            agent('22222222-2222-4222-8222-222222222222', 'Second monitor'),
            agent('33333333-3333-4333-8333-333333333333', 'Third monitor'),
          ],
          runs: [],
        })
      }
      if (init?.method === 'DELETE') {
        return new Promise<Response>((resolve) => {
          pendingDeletes.set(url, () => resolve(new Response(null, { status: 204 })))
        })
      }
      if (url.endsWith('/findings')) return json({ findings: [] })
      if (url.endsWith('/activity')) return json({ activity: [] })
      if (url.endsWith('/thesis')) return json({ thesis: null, versions: [], assessments: [], metrics: [] })
      throw new Error(`unexpected fetch: ${url}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>))
    })
    await act(async () => undefined)
    await act(async () => undefined)

    const document = dom.window.document
    const rowButton = (agentName: string, label: string) => {
      const row = [...document.querySelectorAll('li')].find((item) => item.querySelector('h3')?.textContent === agentName)!
      return [...row.querySelectorAll('button')].find((button) => button.textContent === label)!
    }
    const formHeading = () => document.querySelector('[name="agent-name"]')!.closest('form')!.querySelector('h2')?.textContent
    const nameValue = () => (document.querySelector('[name="agent-name"]') as HTMLInputElement).value
    const resolveDelete = async (agentId: string) => {
      await act(async () => pendingDeletes.get(`/v1/agents/${agentId}`)!())
      await act(async () => undefined)
    }

    await act(async () => rowButton('First monitor', 'Edit').click())
    await act(async () => rowButton('First monitor', 'Delete').click())
    await act(async () => rowButton('Second monitor', 'Edit').click())
    await resolveDelete('11111111-1111-4111-8111-111111111111')
    assert.equal(formHeading(), 'Edit agent')
    assert.equal(nameValue(), 'Second monitor')

    await act(async () => rowButton('Third monitor', 'Delete').click())
    await act(async () => rowButton('Third monitor', 'Edit').click())
    await resolveDelete('33333333-3333-4333-8333-333333333333')
    assert.equal(formHeading(), 'Create agent')
    assert.equal(nameValue(), '')
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Agents surface loads selected agent findings and activity routes', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  try {
    globalThis.fetch = async (input, init) => {
      calls.push(String(input))
      assert.equal((init?.headers as Record<string, string>)['x-user-id'], USER_ID)
      if (String(input) === '/v1/agents') {
        return new Response(JSON.stringify({
          agents: [
            {
              agent_id: '11111111-1111-4111-8111-111111111111',
              name: 'Evidence monitor',
              thesis: 'Track source-backed evidence',
              cadence: 'daily',
              enabled: true,
              universe: { mode: 'static', subject_refs: [{ kind: 'issuer', id: '22222222-2222-4222-8222-222222222222' }] },
              alert_rules: [],
              updated_at: '2026-05-06T00:00:00.000Z',
            },
          ],
          runs: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(input) === '/v1/agents/11111111-1111-4111-8111-111111111111/findings') {
        return new Response(JSON.stringify({
          findings: [
            {
              finding_id: '44444444-4444-4444-8444-444444444444',
              agent_id: '11111111-1111-4111-8111-111111111111',
              snapshot_id: SNAPSHOT_ID,
              headline: 'Operating margin quality improved',
              severity: 'medium',
              subject_refs: [{ kind: 'issuer', id: '22222222-2222-4222-8222-222222222222' }],
              summary_blocks: [],
              created_at: '2026-05-06T00:00:00.000Z',
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(input) === '/v1/agents/11111111-1111-4111-8111-111111111111/activity') {
        return new Response(JSON.stringify({
          activity: [
            {
              run_activity_id: '33333333-3333-4333-8333-333333333333',
              agent_id: '11111111-1111-4111-8111-111111111111',
              stage: 'found',
              subject_refs: [{ kind: 'issuer', id: '22222222-2222-4222-8222-222222222222' }],
              source_refs: ['66666666-6666-4666-8666-666666666666'],
              summary: 'Created 1 source-backed finding.',
              ts: '2026-05-06T00:00:00.000Z',
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(input) === '/v1/agents/11111111-1111-4111-8111-111111111111/thesis') {
        return new Response(JSON.stringify({
          thesis: null,
          versions: [],
          assessments: [],
          metrics: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>))
    })
    await act(async () => undefined)
    await act(async () => undefined)

    assert.deepEqual([...calls].sort(), [
      '/v1/agents',
      '/v1/agents/11111111-1111-4111-8111-111111111111/findings',
      '/v1/agents/11111111-1111-4111-8111-111111111111/activity',
      '/v1/agents/11111111-1111-4111-8111-111111111111/thesis',
    ].sort())
    assert.match(dom.window.document.body.innerHTML, /Operating margin quality improved/)
    assert.match(dom.window.document.body.innerHTML, /Created 1 source-backed finding/)
    assert.deepEqual(
      [...dom.window.document.querySelectorAll('h2')].map((h) => h.textContent),
      ['Agents', 'Create agent', 'Thesis conditions', 'Findings', 'Run history', 'Run activity'],
    )
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Agents run history lists only the selected agent runs', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const agent = (agent_id: string, name: string) => ({
    agent_id,
    name,
    thesis: `${name} thesis`,
    cadence: 'daily',
    enabled: true,
    universe: { mode: 'static', subject_refs: [] },
    alert_rules: [],
    updated_at: '2026-05-06T00:00:00.000Z',
  })
  const run = (agent_run_log_id: string, agent_id: string, started_at: string) => ({
    agent_run_log_id,
    agent_id,
    status: 'completed',
    started_at,
    ended_at: started_at,
    error: null,
  })
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url === '/v1/agents') {
        return json({
          agents: [
            agent('11111111-1111-4111-8111-111111111111', 'Selected monitor'),
            agent('22222222-2222-4222-8222-222222222222', 'Other monitor'),
          ],
          runs: [
            run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', '2026-05-06T01:00:00.000Z'),
            run('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', '2026-05-07T02:00:00.000Z'),
          ],
        })
      }
      if (url.endsWith('/findings')) return json({ findings: [] })
      if (url.endsWith('/activity')) return json({ activity: [] })
      if (url.endsWith('/thesis')) return json({ thesis: null, versions: [], assessments: [], metrics: [] })
      throw new Error(`unexpected fetch: ${url}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<MemoryRouter><AgentsPage /></MemoryRouter>))
    })
    await act(async () => undefined)
    await act(async () => undefined)

    const runHistory = [...dom.window.document.querySelectorAll('section')]
      .find((section) => section.querySelector('h2')?.textContent === 'Run history')
    assert.deepEqual(
      [...(runHistory?.querySelectorAll('li') ?? [])].map((item) => item.textContent),
      ['completed2026-05-06T01:00:00.000Z'],
    )
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('Agents create/edit payloads include selected universe and alert rule policy', () => {
  assert.deepEqual(buildAgentPayload({
    name: 'Headline optional monitor',
    thesis: 'Alert on any high severity finding',
    cadence: 'daily',
    universeMode: 'static',
    staticSubjectRefsText: 'issuer:11111111-1111-4111-8111-111111111111\nlisting: 22222222-2222-4222-8222-222222222222',
    dynamicUniverseId: '',
    subjectKind: 'issuer',
    subjectId: '11111111-1111-4111-8111-111111111111',
    alertRuleId: 'any-high',
    alertSeverity: 'high',
    alertHeadline: '',
    alertEmail: false,
    alertWebPush: true,
    alertSms: false,
    alertMobilePush: true,
    alertDigest: true,
  }), {
    name: 'Headline optional monitor',
    thesis: 'Alert on any high severity finding',
    cadence: 'daily',
    universe: {
      mode: 'static',
      subject_refs: [
        { kind: 'issuer', id: '11111111-1111-4111-8111-111111111111' },
        { kind: 'listing', id: '22222222-2222-4222-8222-222222222222' },
      ],
    },
    alert_rules: [
      {
        rule_id: 'any-high',
        severity_at_least: 'high',
        channels: ['web_push', 'mobile_push', 'digest'],
      },
    ],
  })

  assert.deepEqual(buildAgentPayload({
    name: ' Margin monitor ',
    thesis: ' Watch supplier margin risk ',
    cadence: 'hourly',
    universeMode: 'theme',
    staticSubjectRefsText: '',
    dynamicUniverseId: ' 33333333-3333-4333-8333-333333333333 ',
    subjectKind: 'issuer',
    subjectId: ' 11111111-1111-4111-8111-111111111111 ',
    alertRuleId: ' margin-risk ',
    alertSeverity: 'high',
    alertHeadline: ' margin ',
    alertEmail: true,
    alertWebPush: true,
    alertSms: true,
    alertMobilePush: true,
    alertDigest: false,
  }), {
    name: 'Margin monitor',
    thesis: 'Watch supplier margin risk',
    cadence: 'hourly',
    universe: { mode: 'theme', theme_id: '33333333-3333-4333-8333-333333333333' },
    alert_rules: [
      {
        rule_id: 'margin-risk',
        severity_at_least: 'high',
        headline_contains: 'margin',
        channels: ['email', 'web_push', 'sms', 'mobile_push'],
      },
    ],
  })

  assert.deepEqual(buildAgentPayload({
    name: 'No-alert monitor',
    thesis: 'Track guidance',
    cadence: 'weekly',
    universeMode: 'portfolio',
    staticSubjectRefsText: '',
    dynamicUniverseId: '44444444-4444-4444-8444-444444444444',
    subjectKind: 'theme',
    subjectId: 'quality',
    alertRuleId: '',
    alertSeverity: 'medium',
    alertHeadline: '',
    alertEmail: false,
    alertWebPush: false,
    alertSms: false,
    alertMobilePush: false,
    alertDigest: false,
  }), {
    name: 'No-alert monitor',
    thesis: 'Track guidance',
    cadence: 'weekly',
    universe: { mode: 'portfolio', portfolio_id: '44444444-4444-4444-8444-444444444444' },
    alert_rules: [],
  })

  const screenUniverse = { mode: 'screen', screen_id: '55555555-5555-4555-8555-555555555555' } as const
  const multipleRules = [
    { rule_id: 'margin-risk', severity_at_least: 'high', headline_contains: 'margin' },
    { rule_id: 'cash-risk', severity_at_least: 'medium', headline_contains: 'cash' },
  ] as const
  assert.deepEqual(buildAgentPayload({
    name: ' Existing screen monitor ',
    thesis: ' Preserve unsupported config ',
    cadence: 'daily',
    universeMode: 'agent',
    staticSubjectRefsText: '',
    dynamicUniverseId: '66666666-6666-4666-8666-666666666666',
    subjectKind: 'issuer',
    subjectId: '',
    alertRuleId: '',
    alertSeverity: 'high',
    alertHeadline: '',
    alertEmail: false,
    alertWebPush: false,
    alertSms: false,
    alertMobilePush: false,
    alertDigest: false,
  }, {
    universe: screenUniverse,
    alert_rules: multipleRules,
  }), {
    name: 'Existing screen monitor',
    thesis: 'Preserve unsupported config',
    cadence: 'daily',
    universe: { mode: 'agent', agent_id: '66666666-6666-4666-8666-666666666666' },
    alert_rules: multipleRules,
  })

  const unsupportedUniverse = { mode: 'custom_query', query_id: 'query-123' }
  const unsupportedSingleRule = {
    rule_id: 'claim-watch',
    severity_at_least: 'high',
    claim_cluster_id_in: ['cluster-123'],
  }
  assert.deepEqual(buildAgentPayload({
    name: ' Existing custom monitor ',
    thesis: ' Preserve unsupported single rule ',
    cadence: 'daily',
    universeMode: 'static',
    staticSubjectRefsText: 'issuer:33333333-3333-4333-8333-333333333333',
    dynamicUniverseId: '',
    subjectKind: 'issuer',
    subjectId: '',
    alertRuleId: 'replacement',
    alertSeverity: 'medium',
    alertHeadline: 'replacement',
    alertEmail: true,
    alertWebPush: false,
    alertSms: false,
    alertMobilePush: false,
    alertDigest: false,
  }, {
    universe: unsupportedUniverse,
    alert_rules: [unsupportedSingleRule],
  }), {
    name: 'Existing custom monitor',
    thesis: 'Preserve unsupported single rule',
    cadence: 'daily',
    universe: unsupportedUniverse,
    alert_rules: [unsupportedSingleRule],
  })

  assert.throws(
    () => buildAgentPayload({
      name: 'Invalid dynamic monitor',
      thesis: 'Do not send backend-rejected dynamic ids',
      cadence: 'daily',
      universeMode: 'theme',
      staticSubjectRefsText: '',
      dynamicUniverseId: 'theme-123',
      subjectKind: 'issuer',
      subjectId: '',
      alertRuleId: '',
      alertSeverity: 'medium',
      alertHeadline: '',
      alertEmail: false,
      alertWebPush: false,
      alertSms: false,
      alertMobilePush: false,
      alertDigest: false,
    }),
    (error: unknown) => error instanceof AgentPayloadValidationError && error.message === 'theme universe id must be a UUID',
  )

  assert.throws(
    () => buildAgentPayload({
      name: 'Invalid static monitor',
      thesis: 'Reject partial static universe',
      cadence: 'daily',
      universeMode: 'static',
      staticSubjectRefsText: 'issuer:33333333-3333-4333-8333-333333333333\nlisting:AAPL',
      dynamicUniverseId: '',
      subjectKind: 'issuer',
      subjectId: '',
      alertRuleId: '',
      alertSeverity: 'medium',
      alertHeadline: '',
      alertEmail: false,
      alertWebPush: false,
      alertSms: false,
      alertMobilePush: false,
      alertDigest: false,
    }),
    (error: unknown) => error instanceof AgentPayloadValidationError && error.message === 'Static subject ref line 2 must be kind:uuid',
  )
})

function persistedMessage(index: number) {
  return {
    message_id: `message-${index}`,
    thread_id: 'thread-123',
    role: index % 2 === 0 ? 'assistant' : 'user',
    snapshot_id: SNAPSHOT_ID,
    blocks: [
      {
        id: `block-${index}`,
        kind: 'rich_text',
        snapshot_id: SNAPSHOT_ID,
        data_ref: { kind: 'chat_turn', id: `message-${index}` },
        source_refs: [],
        as_of: '2026-05-06T00:00:00.000Z',
        segments: [{ type: 'text', text: `Persisted assistant answer ${index}` }],
      },
    ],
    content_hash: `sha256:${index}`,
    created_at: '2026-05-06T00:00:00.000Z',
  }
}

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
    ResizeObserver?: typeof ResizeObserver
  }
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const hadResizeObserver = Object.prototype.hasOwnProperty.call(globals, 'ResizeObserver')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window
  const previousResizeObserver = globals.ResizeObserver

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow
  globals.ResizeObserver = class {
    observe() {
      return undefined
    }
    disconnect() {
      return undefined
    }
  } as unknown as typeof ResizeObserver

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
    if (hadResizeObserver) globals.ResizeObserver = previousResizeObserver
    else delete globals.ResizeObserver
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

  // As an EventSource: onmessage hears only unnamed events, a named one its listeners.
  emit(type: string, payload: Record<string, unknown>) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) })
    if (type === 'message') this.onmessage?.(event)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}
