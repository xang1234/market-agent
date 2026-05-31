import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom'

import { AgentPayloadValidationError, buildAgentPayload } from '../agents/agentPayload.ts'
import { persistUserChatTurn } from '../chat/persistUserChatTurn.ts'
import { AgentsPage } from './AgentsPage.tsx'
import { AnalyzePage } from './AnalyzePage.tsx'
import { ChatEmptyState, ChatLayout, ChatThreadView } from './ChatPage.tsx'
import { shareAnalyzeRunToChat } from '../analyze/shareToChat.ts'
import { BlockRegistryProvider, createDefaultBlockRegistry, type Block } from '../blocks'
import { openChatTurnStream } from '../chat/openChatTurnStream.ts'
import type { ChatSseEvent } from '../chat/sseEventTypes.ts'
import { AuthContext } from '../shell/authTypes.ts'
import { ThemeProvider } from '../shell/ThemeProvider.tsx'
import { WorkspaceShell } from '../shell/WorkspaceShell.tsx'

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

  assert.match(html, /Commodities Intelligence/)
  assert.doesNotMatch(html, /raw provider payload/i)
})

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

test('Chat thread route virtualizes long persisted histories while preserving rendered assistant blocks', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input, init) => {
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
          <MemoryRouter initialEntries={['/chat/thread-123']}>
            <Routes>
              <Route path="/chat/:threadId" element={<ChatThreadView />} />
            </Routes>
          </MemoryRouter>
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
      messageId: 'message-user',
      snapshotId: SNAPSHOT_ID,
      content: 'Review copper disruptions',
    })

    assert.equal(message.message_id, 'message-user')
    assert.equal(calls[0].input, '/v1/chat/threads/thread-123/messages')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal((calls[0].init?.headers as Record<string, string>)['x-user-id'], USER_ID)
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      message_id: 'message-user',
      snapshot_id: SNAPSHOT_ID,
      content: 'Review copper disruptions',
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
    turnId: 'message-user',
    userIntent: 'Review copper disruptions',
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
  assert.match(eventSources[0].url, /user_intent=Review\+copper\+disruptions/)
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

test('Chat stream reports server-signaled turn errors to retry callbacks', () => {
  const eventSources: MockEventSource[] = []
  const events: ChatSseEvent[] = []
  let errors = 0

  openChatTurnStream({
    threadId: 'thread-123',
    runId: 'run-1',
    turnId: 'message-user',
    userIntent: 'Review copper disruptions',
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

  assert.equal(errors, 1)
  assert.equal(events.at(-1)?.type, 'turn.error')
  assert.equal(eventSources[0].closed, true)
})

test('Analyze surface renders template controls, source controls, brief canvas, and Add to chat action', () => {
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
  assert.match(html, /licensed_reports/)
  assert.match(html, /Brief canvas/)
  assert.match(html, /Generate draft/)
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
          title: 'Daily copper call - Research brief',
          updated_at: '2026-05-06T00:00:00.000Z',
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    }

    const result = await shareAnalyzeRunToChat({
      userId: USER_ID,
      sourceKind: 'memo',
      title: 'Daily copper call - Research brief',
      primarySubjectRef: null,
      run: {
        run_id: 'run-123',
      },
    })

    assert.equal(result.thread.thread_id, 'thread-123')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, '/v1/analyze/runs/run-123/share-to-chat')
    assert.equal(calls[0].init?.method, 'POST')
    assert.equal((calls[0].init?.headers as Record<string, string>)['x-user-id'], USER_ID)
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      source_kind: 'memo',
      title: 'Daily copper call - Research brief',
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
  assert.match(html, /commodity: 99999999-9999-4999-8999-999999999999/)
  assert.match(html, /critical\+ headline contains disruption/)
  assert.match(html, /Disable/)
  assert.match(html, /Delete/)
  assert.match(html, /Run history/)
  assert.match(html, /Findings/)
  assert.match(html, /Run activity/)
  assert.match(html, /Activity/)
  assert.doesNotMatch(html, /ships with P5\.1/i)
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
              name: 'Copper evidence monitor',
              thesis: 'Track source-backed copper drivers',
              cadence: 'daily',
              enabled: true,
              universe: { mode: 'static', subject_refs: [{ kind: 'commodity', id: '22222222-2222-4222-8222-222222222222' }] },
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
              headline: 'Copper disruption risk increased',
              severity: 'medium',
              subject_refs: [{ kind: 'commodity', id: '22222222-2222-4222-8222-222222222222' }],
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
              subject_refs: [{ kind: 'commodity', id: '22222222-2222-4222-8222-222222222222' }],
              source_refs: ['66666666-6666-4666-8666-666666666666'],
              summary: 'Created 1 source-backed finding.',
              ts: '2026-05-06T00:00:00.000Z',
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${String(input)}`)
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(wrapWithAuth(<AgentsPage />))
    })
    await act(async () => undefined)
    await act(async () => undefined)

    assert.deepEqual(calls, [
      '/v1/agents',
      '/v1/agents/11111111-1111-4111-8111-111111111111/findings',
      '/v1/agents/11111111-1111-4111-8111-111111111111/activity',
    ])
    assert.match(dom.window.document.body.innerHTML, /Copper disruption risk increased/)
    assert.match(dom.window.document.body.innerHTML, /Created 1 source-backed finding/)
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
    staticSubjectRefsText: 'commodity:11111111-1111-4111-8111-111111111111\ncontract: 22222222-2222-4222-8222-222222222222',
    dynamicUniverseId: '',
    subjectKind: 'commodity',
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
        { kind: 'commodity', id: '11111111-1111-4111-8111-111111111111' },
        { kind: 'contract', id: '22222222-2222-4222-8222-222222222222' },
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
    name: ' Disruption monitor ',
    thesis: ' Watch copper disruption risk ',
    cadence: 'hourly',
    universeMode: 'theme',
    staticSubjectRefsText: '',
    dynamicUniverseId: ' 33333333-3333-4333-8333-333333333333 ',
    subjectKind: 'commodity',
    subjectId: ' 11111111-1111-4111-8111-111111111111 ',
    alertRuleId: ' disruption-risk ',
    alertSeverity: 'high',
    alertHeadline: ' disruption ',
    alertEmail: true,
    alertWebPush: true,
    alertSms: true,
    alertMobilePush: true,
    alertDigest: false,
  }), {
    name: 'Disruption monitor',
    thesis: 'Watch copper disruption risk',
    cadence: 'hourly',
    universe: { mode: 'theme', theme_id: '33333333-3333-4333-8333-333333333333' },
    alert_rules: [
      {
        rule_id: 'disruption-risk',
        severity_at_least: 'high',
        headline_contains: 'disruption',
        channels: ['email', 'web_push', 'sms', 'mobile_push'],
      },
    ],
  })

  assert.deepEqual(buildAgentPayload({
    name: 'No-alert monitor',
    thesis: 'Track report deltas',
    cadence: 'weekly',
    universeMode: 'portfolio',
    staticSubjectRefsText: '',
    dynamicUniverseId: '44444444-4444-4444-8444-444444444444',
    subjectKind: 'market_theme',
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
    thesis: 'Track report deltas',
    cadence: 'weekly',
    universe: { mode: 'portfolio', portfolio_id: '44444444-4444-4444-8444-444444444444' },
    alert_rules: [],
  })

  const screenUniverse = { mode: 'screen', screen_id: '55555555-5555-4555-8555-555555555555' } as const
  const multipleRules = [
    { rule_id: 'disruption-risk', severity_at_least: 'high', headline_contains: 'disruption' },
    { rule_id: 'inventory-risk', severity_at_least: 'medium', headline_contains: 'inventory' },
  ] as const
  assert.deepEqual(buildAgentPayload({
    name: ' Existing screen monitor ',
    thesis: ' Preserve unsupported config ',
    cadence: 'daily',
    universeMode: 'agent',
    staticSubjectRefsText: '',
    dynamicUniverseId: '66666666-6666-4666-8666-666666666666',
    subjectKind: 'commodity',
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
    staticSubjectRefsText: 'commodity:33333333-3333-4333-8333-333333333333',
    dynamicUniverseId: '',
    subjectKind: 'commodity',
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
      subjectKind: 'commodity',
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
      staticSubjectRefsText: 'commodity:33333333-3333-4333-8333-333333333333\ncontract:LME',
      dynamicUniverseId: '',
      subjectKind: 'commodity',
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

  emit(type: string, payload: Record<string, unknown>) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) })
    this.onmessage?.(event)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}
