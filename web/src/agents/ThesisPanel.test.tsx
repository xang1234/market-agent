import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from '../evidence/evidenceInspectorContext.ts'
import { ThesisPanel } from './ThesisPanel.tsx'
import type { ThesisHistoryResponse } from './thesisTypes.ts'

const USER_A = '00000000-0000-4000-8000-000000000001'
const USER_B = '00000000-0000-4000-8000-000000000002'
const AGENT_A = '11111111-1111-4111-8111-111111111111'
const AGENT_B = '22222222-2222-4222-8222-222222222222'
const VERSION_A = '33333333-3333-4333-8333-333333333333'
const CONDITION_A = '44444444-4444-4444-8444-444444444444'
const ASSESSMENT_A = '55555555-5555-4555-8555-555555555555'
const RUN_A = '66666666-6666-4666-8666-666666666666'
const SNAPSHOT_A = '77777777-7777-4777-8777-777777777777'
const FACT_A = '88888888-8888-4888-8888-888888888888'

test('ThesisPanel preserves an existing metric option and saves the exact versioned payload', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const saved: string[] = []
  const history = currentHistory()
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init })
    if (init?.method === 'PUT') {
      return json({ thesis: { ...history.thesis!, thesis: 'Updated margin thesis for the company.' } })
    }
    return json(history)
  }
  const harness = await mountPanel({ fetchImpl, onSaved: (thesis) => saved.push(thesis.thesis) })
  try {
    const metricSelect = harness.document.querySelector<HTMLSelectElement>('[name="thesis-condition-0-metric"]')!
    assert.equal(metricSelect.options.length, 3)
    assert.match(metricSelect.options[1]?.textContent ?? '', /Gross margin.*%.*fiscal quarter.*saved/i)
    assert.equal(metricSelect.selectedOptions[0]?.textContent?.includes('Gross margin'), true)

    await clickButton(harness.document, 'Save thesis')

    const saveCall = calls.find((call) => call.init?.method === 'PUT')
    assert.ok(saveCall)
    assert.equal((saveCall.init?.headers as Record<string, string>)['x-user-id'], USER_A)
    assert.deepEqual(JSON.parse(String(saveCall.init?.body)), {
      expected_version: 2,
      thesis: 'Margins can remain structurally strong.',
      conditions: [{
        condition_id: CONDITION_A,
        statement: 'Gross margin remains above the long-term floor.',
        falsifier: 'Gross margin falls below the threshold.',
        horizon: 'Next fiscal quarter',
        metric: {
          metric_key: 'gross_margin',
          unit: '%',
          period_kind: 'fiscal_q',
          operator: 'gte',
          threshold: 40,
          max_age_days: 120,
        },
      }],
    })
    assert.deepEqual(saved, ['Updated margin thesis for the company.'])
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel completes drafts and saves under StrictMode', async () => {
  const saved: string[] = []
  const history = currentHistory()
  const fetchImpl: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/draft')) {
      return json({ conditions: [{
        condition_id: CONDITION_A,
        statement: 'StrictMode draft completed.',
        falsifier: 'StrictMode draft falsifier.',
        horizon: 'Next quarter',
      }] })
    }
    if (init?.method === 'PUT') {
      return json({ thesis: { ...history.thesis!, thesis: 'StrictMode save completed.' } })
    }
    return json(history)
  }
  const harness = await mountPanel({
    fetchImpl,
    strictMode: true,
    onSaved: (thesis) => saved.push(thesis.thesis),
  })
  try {
    await clickButton(harness.document, 'Suggest conditions')
    assert.equal(
      harness.document.querySelector<HTMLTextAreaElement>('[name="thesis-condition-0-statement"]')?.value,
      'StrictMode draft completed.',
    )

    await clickButton(harness.document, 'Save thesis')
    assert.deepEqual(saved, ['StrictMode save completed.'])
    assert.match(harness.document.body.textContent ?? '', /Thesis version 2 saved/i)
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel accepts and submits fractional metric thresholds', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const history = currentHistory()
  history.thesis!.conditions[0]!.metric!.threshold = 40.5
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init })
    if (init?.method === 'PUT') return json({ thesis: history.thesis })
    return json(history)
  }
  const harness = await mountPanel({ fetchImpl })
  try {
    const threshold = harness.document.querySelector<HTMLInputElement>('input[type="number"][value="40.5"]')!
    assert.equal(threshold.step, 'any')
    assert.equal(threshold.validity.stepMismatch, false)

    await clickButton(harness.document, 'Save thesis')
    const saveCall = calls.find((call) => call.init?.method === 'PUT')
    assert.ok(saveCall)
    assert.equal(JSON.parse(String(saveCall.init?.body)).conditions[0].metric.threshold, 40.5)
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel keeps suggested conditions editable without saving them automatically', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init })
    if (String(input).endsWith('/draft')) {
      return json({ conditions: [{
        condition_id: CONDITION_A,
        statement: 'Revenue growth remains above ten percent.',
        falsifier: 'Revenue growth falls below ten percent.',
        horizon: 'Next two quarters',
      }] })
    }
    return json({ thesis: null, versions: [], assessments: [], metrics: [] })
  }
  const harness = await mountPanel({
    fetchImpl,
    initialThesis: 'Revenue growth can stay durable as demand broadens.',
  })
  try {
    await clickButton(harness.document, 'Suggest conditions')
    const statement = harness.document.querySelector<HTMLTextAreaElement>('[name="thesis-condition-0-statement"]')!
    assert.equal(statement.value, 'Revenue growth remains above ten percent.')

    await act(async () => changeValue(statement, 'Revenue growth remains above twelve percent.'))
    assert.equal(statement.value, 'Revenue growth remains above twelve percent.')
    assert.equal(calls.some((call) => call.init?.method === 'PUT'), false)
    assert.match(harness.document.body.textContent ?? '', /Review and edit these suggestions before saving/i)
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel exposes failed requests as actionable panel state', async () => {
  const harness = await mountPanel({
    fetchImpl: async () => json({ error: 'thesis runtime unavailable' }, 503),
  })
  try {
    assert.match(harness.document.body.textContent ?? '', /Thesis conditions are unavailable/i)
    assert.match(harness.document.body.textContent ?? '', /thesis runtime unavailable/i)
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel aborts and ignores stale responses when the user and agent switch', async () => {
  const pending = new Map<string, Deferred<Response>>()
  const signals = new Map<string, AbortSignal | null>()
  const fetchImpl: typeof fetch = async (input, init) => {
    const key = `${(init?.headers as Record<string, string>)['x-user-id']}:${String(input)}`
    const deferred = createDeferred<Response>()
    pending.set(key, deferred)
    signals.set(key, init?.signal ?? null)
    return deferred.promise
  }
  const harness = await mountPanel({ fetchImpl, waitForEffects: false })
  try {
    await act(async () => undefined)
    const oldKey = `${USER_A}:/v1/agents/${AGENT_A}/thesis`
    assert.ok(pending.has(oldKey))

    await harness.render({ userId: USER_B, agentId: AGENT_B, initialThesis: 'Second agent base thesis.' })
    const newKey = `${USER_B}:/v1/agents/${AGENT_B}/thesis`
    assert.equal(signals.get(oldKey)?.aborted, true)
    assert.match(harness.document.body.textContent ?? '', /Loading thesis conditions/i)

    await act(async () => pending.get(newKey)?.resolve(json({
      thesis: { ...currentHistory().thesis!, agent_id: AGENT_B, thesis: 'Second agent current thesis.' },
      versions: [],
      assessments: [],
      metrics: [],
    })))
    assert.equal(harness.document.querySelector<HTMLTextAreaElement>('[name="thesis-text"]')?.value, 'Second agent current thesis.')

    await act(async () => pending.get(oldKey)?.resolve(json(currentHistory())))
    await act(async () => undefined)
    assert.equal(harness.document.querySelector<HTMLTextAreaElement>('[name="thesis-text"]')?.value, 'Second agent current thesis.')
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel ignores a save completion after switching scope and locks thesis text while saving', async () => {
  const saveResponse = createDeferred<Response>()
  const saved: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    if (init?.method === 'PUT') return saveResponse.promise
    if (String(input).includes(AGENT_B)) {
      return json({
        thesis: { ...currentHistory().thesis!, agent_id: AGENT_B, thesis: 'Second agent current thesis.' },
        versions: [],
        assessments: [],
        metrics: [],
      })
    }
    return json(currentHistory())
  }
  const harness = await mountPanel({ fetchImpl, onSaved: (version) => saved.push(version.thesis) })
  try {
    await clickButton(harness.document, 'Save thesis', false)
    assert.equal(harness.document.querySelector<HTMLTextAreaElement>('[name="thesis-text"]')?.disabled, true)

    await harness.render({ userId: USER_B, agentId: AGENT_B, initialThesis: 'Second agent base thesis.' })
    assert.equal(harness.document.querySelector<HTMLTextAreaElement>('[name="thesis-text"]')?.value, 'Second agent current thesis.')

    await act(async () => saveResponse.resolve(json({ thesis: {
      ...currentHistory().thesis!,
      thesis: 'Old scope save must stay isolated.',
    } })))
    await act(async () => undefined)
    assert.deepEqual(saved, [])
    assert.equal(harness.document.querySelector<HTMLTextAreaElement>('[name="thesis-text"]')?.value, 'Second agent current thesis.')
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel opens condition evidence with its assessment snapshot and explains provenance', async () => {
  const opened: Array<{ snapshotId: string; ref: { kind: string; id: string } }> = []
  const inspector: EvidenceInspectorContextValue = {
    openInspection(input) {
      opened.push(input)
    },
    openBlockInspection() {},
    closeInspection() {},
  }
  const harness = await mountPanel({
    fetchImpl: async () => json(currentHistory()),
    inspector,
  })
  try {
    assert.match(harness.document.body.textContent ?? '', /Checked an authoritative numeric fact/i)
    assert.match(harness.document.body.textContent ?? '', /Prompt thesis-assessment-v1/i)
    await clickButton(harness.document, 'Inspect fact evidence')
    assert.deepEqual(opened, [{ snapshotId: SNAPSHOT_A, ref: { kind: 'fact', id: FACT_A } }])
  } finally {
    await harness.unmount()
  }
})

test('ThesisPanel labels assessments whose thesis version fell outside the recent history bound', async () => {
  const history = currentHistory()
  history.assessments = [{
    ...history.assessments[0],
    thesis_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }]
  const harness = await mountPanel({ fetchImpl: async () => json(history) })
  try {
    assert.match(harness.document.body.textContent ?? '', /Older thesis version · details outside recent history/i)
    assert.match(harness.document.body.textContent ?? '', /Condition details are outside recent history/i)
    assert.doesNotMatch(harness.document.body.textContent ?? '', /Thesis v\?/i)
  } finally {
    await harness.unmount()
  }
})

function currentHistory(): ThesisHistoryResponse {
  const thesis = {
    thesis_version_id: VERSION_A,
    agent_id: AGENT_A,
    version: 2,
    thesis: 'Margins can remain structurally strong.',
    subject_ref: { kind: 'issuer' as const, id: '99999999-9999-4999-8999-999999999999' },
    conditions: [{
      condition_id: CONDITION_A,
      statement: 'Gross margin remains above the long-term floor.',
      falsifier: 'Gross margin falls below the threshold.',
      horizon: 'Next fiscal quarter',
      metric: {
        metric_key: 'gross_margin',
        unit: '%',
        period_kind: 'fiscal_q' as const,
        operator: 'gte' as const,
        threshold: 40,
        max_age_days: 120,
      },
    }],
    created_at: '2026-09-08T00:00:00.000Z',
  }
  return {
    thesis,
    versions: [thesis],
    assessments: [{
      assessment_id: ASSESSMENT_A,
      thesis_version_id: VERSION_A,
      run_id: RUN_A,
      snapshot_id: SNAPSHOT_A,
      input_hash: 'sha256:assessment',
      results: [{
        condition_id: CONDITION_A,
        status: 'supported',
        reason: 'The latest authoritative quarterly fact remains above the threshold.',
        claim_refs: [],
        fact_refs: [FACT_A],
        method: 'metric',
      }],
      model_version: null,
      prompt_version: 'thesis-assessment-v1',
      assessed_at: '2026-09-08T01:00:00.000Z',
    }],
    metrics: [{ metric_key: 'revenue', label: 'Revenue', unit: 'USD', period_kind: 'fiscal_q' }],
  }
}

async function mountPanel(input: {
  fetchImpl: typeof fetch
  initialThesis?: string
  onSaved?: Parameters<typeof ThesisPanel>[0]['onSaved']
  inspector?: EvidenceInspectorContextValue
  waitForEffects?: boolean
  strictMode?: boolean
}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const root = createRoot(dom.window.document.getElementById('root')!)
  const render = async (override?: Partial<Parameters<typeof ThesisPanel>[0]>) => {
    const props = {
      userId: USER_A,
      agentId: AGENT_A,
      initialThesis: input.initialThesis ?? 'Initial agent thesis.',
      refreshKey: 0,
      fetchImpl: input.fetchImpl,
      onSaved: input.onSaved ?? (() => undefined),
      ...override,
    }
    await act(async () => {
      const panel = (
        <EvidenceInspectorContext.Provider value={input.inspector ?? null}>
          <ThesisPanel {...props} />
        </EvidenceInspectorContext.Provider>
      )
      root.render(input.strictMode ? <StrictMode>{panel}</StrictMode> : panel)
    })
    if (input.waitForEffects !== false) await act(async () => undefined)
  }
  await render()
  return {
    document: dom.window.document,
    render,
    async unmount() {
      await act(async () => root.unmount())
      restore()
    },
  }
}

async function clickButton(document: Document, label: string, settle = true) {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label)
  assert.ok(button, `missing button: ${label}`)
  await act(async () => button.dispatchEvent(new document.defaultView!.MouseEvent('click', { bubbles: true })))
  if (settle) await act(async () => undefined)
}

function changeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof element.ownerDocument.defaultView!.HTMLTextAreaElement
    ? element.ownerDocument.defaultView!.HTMLTextAreaElement.prototype
    : element instanceof element.ownerDocument.defaultView!.HTMLSelectElement
      ? element.ownerDocument.defaultView!.HTMLSelectElement.prototype
      : element.ownerDocument.defaultView!.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event('input', { bubbles: true }))
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event('change', { bubbles: true }))
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void }

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
  }
  const previous = {
    act: globals.IS_REACT_ACT_ENVIRONMENT,
    document: globals.document,
    window: globals.window,
  }
  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow
  return () => {
    globals.IS_REACT_ACT_ENVIRONMENT = previous.act
    globals.document = previous.document
    globals.window = previous.window
  }
}
