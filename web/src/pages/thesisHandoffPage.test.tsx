import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import { BlockRegistryProvider, createDefaultBlockRegistry } from '../blocks/index.ts'
import { AuthContext } from '../shell/authTypes.ts'
import { AgentsPage } from './AgentsPage.tsx'
import { AnalyzePage } from './AnalyzePage.tsx'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const CURRENT_SUBJECT_ID = '11111111-1111-4111-8111-111111111111'
const RUN_SUBJECT_ID = '22222222-2222-4222-8222-222222222222'

test('Analyze Monitor this thesis carries the opened historical run subject to Agents', async () => {
  const calls: Array<{ url: string; method: string }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url === '/v1/analyze/templates') return json({ templates: [] })
    if (url === '/v1/analyze/playbooks') return json({ playbooks: [] })
    if (url.startsWith('/v1/analyze/runs?')) return json({ runs: [runSummary()], next_cursor: null })
    if (url === '/v1/analyze/runs/run-history') return json(runDetail())
    return json({ error: `unexpected ${url}` }, 404)
  }
  const harness = installHarness(fetchImpl)
  const router = createMemoryRouter([
    { path: '/analyze', element: <AnalyzePage /> },
    { path: '/agents', element: <p>Agents destination</p> },
  ], { initialEntries: [`/analyze?subject=issuer:${CURRENT_SUBJECT_ID}`] })
  try {
    await harness.render(<RouterProvider router={router} />)
    await harness.click('Open')
    await harness.click('Monitor this thesis')

    assert.equal(router.state.location.pathname, '/agents')
    assert.deepEqual(router.state.location.state, {
      thesisHandoff: {
        sourceRunId: 'run-history',
        subjectRef: { kind: 'listing', id: RUN_SUBJECT_ID },
        thesis: 'Historical memo says demand remains resilient.',
        name: 'Historical memo monitor',
      },
    })
    assert.equal(calls.some((call) => call.method !== 'GET'), false)
  } finally {
    await harness.unmount()
  }
})

test('Agents prefill from Analyze remains editable and does not create an agent automatically', async () => {
  const calls: Array<{ url: string; method: string }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' })
    return json({ agents: [], runs: [] })
  }
  const harness = installHarness(fetchImpl)
  const router = createMemoryRouter([
    { path: '/agents', element: <AgentsPage /> },
  ], {
    initialEntries: [{
      pathname: '/agents',
      state: {
        thesisHandoff: {
          sourceRunId: 'run-history',
          subjectRef: { kind: 'listing', id: RUN_SUBJECT_ID },
          thesis: 'Historical memo says demand remains resilient.',
          name: 'Historical memo monitor',
        },
      },
    }],
  })
  try {
    await harness.render(<RouterProvider router={router} />)
    assert.equal(harness.document.querySelector<HTMLInputElement>('[name="agent-name"]')?.value, 'Historical memo monitor')
    assert.equal(harness.document.querySelector<HTMLTextAreaElement>('[name="agent-thesis"]')?.value, 'Historical memo says demand remains resilient.')
    assert.equal(harness.document.querySelector<HTMLTextAreaElement>('[name="static-subject-refs"]')?.value, `listing:${RUN_SUBJECT_ID}`)
    assert.equal(harness.document.querySelector<HTMLSelectElement>('[name="subject-kind"]')?.value, 'listing')
    assert.equal(harness.document.querySelector<HTMLInputElement>('[name="subject-id"]')?.value, RUN_SUBJECT_ID)
    assert.match(harness.document.body.textContent ?? '', /Review this Analyze memo, create the agent, then draft and save its conditions/i)
    assert.equal(calls.some((call) => call.method === 'POST'), false)
  } finally {
    await harness.unmount()
  }
})

function runSummary() {
  return {
    run_id: 'run-history',
    template_id: '33333333-3333-4333-8333-333333333333',
    template_name: 'Historical template',
    template_version: 1,
    playbook_id: 'earnings_quality',
    playbook_name: 'Historical memo',
    playbook_version: 1,
    display_title: 'Historical memo',
    can_rerun: true,
    rerun_unavailable_reason: null,
    created_at: '2026-09-08T00:00:00.000Z',
    snapshot_id: '44444444-4444-4444-8444-444444444444',
  }
}

function runDetail() {
  return {
    ...runSummary(),
    run_metadata: {
      schema_version: 1,
      template_id: '33333333-3333-4333-8333-333333333333',
      template_version: 1,
      playbook_id: 'earnings_quality',
      playbook_version: 1,
      instructions: 'Current screen instructions must not replace historical identity.',
      source_categories: ['filings'],
      subject_refs: [{ kind: 'listing', id: RUN_SUBJECT_ID }],
    },
    blocks: [{
      id: 'memo-summary',
      kind: 'rich_text',
      snapshot_id: '44444444-4444-4444-8444-444444444444',
      data_ref: { kind: 'analyze_run', id: 'memo-summary' },
      source_refs: [],
      as_of: '2026-09-08T00:00:00.000Z',
      segments: [{ type: 'text', text: 'Historical memo says demand remains resilient.' }],
    }],
  }
}

function installHarness(fetchImpl: typeof fetch) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  const root = createRoot(dom.window.document.getElementById('root')!)
  return {
    document: dom.window.document,
    async render(element: React.ReactElement) {
      await act(async () => {
        root.render(
          <AuthContext.Provider value={{ session: { userId: USER_ID, displayName: 'User' }, signIn() {}, signOut() {} }}>
            <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
              {element}
            </BlockRegistryProvider>
          </AuthContext.Provider>,
        )
      })
      await act(async () => undefined)
    },
    async click(label: string) {
      const button = [...dom.window.document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label)
      assert.ok(button, `missing button: ${label}`)
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
      await act(async () => undefined)
    },
    async unmount() {
      await act(async () => root.unmount())
      globalThis.fetch = originalFetch
      restoreGlobals()
    },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window }
  const previous = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window }
  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow
  return () => {
    globals.IS_REACT_ACT_ENVIRONMENT = previous.act
    globals.document = previous.document
    globals.window = previous.window
  }
}
