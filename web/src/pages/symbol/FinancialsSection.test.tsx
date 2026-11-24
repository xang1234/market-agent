import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { JSDOM } from 'jsdom'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'

import type { SubjectDetailOutletContext } from '../../shell/subjectDetailOutletContext.ts'
import type { SegmentFactsEnvelope } from '../../symbol/segments.ts'
import type { ResolvedSubject } from '../../symbol/search.ts'
import type { GetStatementsRequest, GetStatementsResponse } from '../../symbol/statements.ts'
import { FinancialsSection } from './FinancialsSection.tsx'
import { resetResourcesForTests } from '../../fetch/resource.ts'

afterEach(resetResourcesForTests)

const ISSUER_ID = '33333333-3333-4333-a333-333333333333'

const ISSUER_SUBJECT: ResolvedSubject = {
  subject_ref: { kind: 'issuer', id: ISSUER_ID },
  display_name: 'Apple Inc.',
  confidence: 1,
  identity_level: 'issuer',
  display_label: 'Apple Inc.',
  display_labels: {
    primary: 'Apple Inc.',
  },
  normalized_input: `issuer:${ISSUER_ID}`,
  resolution_path: 'direct_ref',
}

function SubjectOutlet({ subject }: { subject: ResolvedSubject }): ReactElement {
  return <Outlet context={{ subject, quote: null } satisfies SubjectDetailOutletContext} />
}

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

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  throw lastError
}

function statementsResponse(query: GetStatementsRequest): GetStatementsResponse {
  return {
    query,
    results: query.periods.map((period) => ({
      period,
      outcome: {
        outcome: 'unavailable',
        reason: 'missing_coverage',
        subject: query.subject_ref,
        source_id: '00000000-0000-4000-a000-000000000005',
        as_of: '2024-11-01T00:00:00.000Z',
        retryable: false,
      },
    })),
  }
}

function segmentsResponse(): SegmentFactsEnvelope {
  return {
    subject: { kind: 'issuer', id: ISSUER_ID },
    family: 'segment_facts',
    axis: 'business',
    basis: 'as_reported',
    period_kind: 'fiscal_y',
    period_start: '2023-10-01',
    period_end: '2024-09-28',
    fiscal_year: 2024,
    fiscal_period: 'FY',
    reporting_currency: 'USD',
    as_of: '2024-11-01T20:30:00.000Z',
    segment_definitions: [],
    facts: [],
    coverage_warnings: [],
  }
}

type Routes404 = { stats?: unknown; segments?: unknown }

function statsResponse(fiscalYear: number) {
  return {
    stats: {
      subject: { kind: 'issuer', id: ISSUER_ID },
      family: 'key_stats',
      basis: 'as_reported',
      period_kind: 'fiscal_y',
      period_start: null,
      period_end: `${fiscalYear}-08-28`,
      fiscal_year: fiscalYear,
      fiscal_period: 'FY',
      reporting_currency: 'USD',
      as_of: '2026-10-01T00:00:00.000Z',
      stats: [],
    },
  }
}

const notOnFile = (detail: string) => ({
  error: 'fundamentals unavailable',
  unavailable: { outcome: 'unavailable', reason: 'missing_coverage', retryable: false, detail },
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function mountFinancials(
  run: (ctx: { doc: Document; dom: JSDOM; statementCalls: GetStatementsRequest[]; segmentCalls: { period: string }[] }) => Promise<void>,
  options: { fiscalYear?: number; notOnFile?: Routes404 } = {},
): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const statementCalls: GetStatementsRequest[] = []
  const segmentCalls: { period: string }[] = []
  let root: Root | null = null

  try {
    globalThis.fetch = async (input, init) => {
      const url = input.toString()
      if (url.startsWith('/v1/fundamentals/stats?')) {
        if (options.notOnFile?.stats) return json(404, options.notOnFile.stats)
        return json(200, statsResponse(options.fiscalYear ?? 2026))
      }
      if (url === '/v1/fundamentals/statements') {
        const query = JSON.parse(String(init?.body ?? '{}')) as GetStatementsRequest
        statementCalls.push(query)
        return json(200, statementsResponse(query))
      }
      if (url === '/v1/fundamentals/segments') {
        segmentCalls.push(JSON.parse(String(init?.body ?? '{}')) as { period: string })
        if (options.notOnFile?.segments) return json(404, options.notOnFile.segments)
        return json(200, { segments: segmentsResponse() })
      }
      return json(404, {})
    }

    const mountedRoot = createRoot(dom.window.document.getElementById('root')!)
    root = mountedRoot
    await act(async () => {
      mountedRoot.render(
        <MemoryRouter initialEntries={['/symbol/issuer/financials']}>
          <Routes>
            <Route element={<SubjectOutlet subject={ISSUER_SUBJECT} />}>
              <Route path="/symbol/issuer/financials" element={<FinancialsSection />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )
    })
    await run({ doc: dom.window.document, dom, statementCalls, segmentCalls })
  } finally {
    if (root !== null) {
      await act(async () => root?.unmount())
    }
    dom.window.close()
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
}

test('FinancialsSection anchors annual, quarterly and segment periods on the issuer latest fiscal year', async () => {
  await mountFinancials(async ({ doc, dom, statementCalls, segmentCalls }) => {
    await waitFor(() => {
      assert.equal(statementCalls.length, 1)
    })
    assert.deepEqual(statementCalls[0]?.periods, ['2026-FY', '2025-FY', '2024-FY', '2023-FY', '2022-FY'])
    assert.deepEqual(segmentCalls.map((call) => call.period), ['2026-FY'])
    assert.match(doc.querySelector('[data-testid="financials-segments"]')?.textContent ?? '', /Segments · 2026-FY/)

    const quarterlyButton = doc.querySelector('[data-testid="period-mode-quarterly"]')
    assert.ok(quarterlyButton)
    await act(async () => {
      quarterlyButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      assert.ok(
        statementCalls.some((call) =>
          call.periods.join() === ['2026-Q4', '2026-Q3', '2026-Q2', '2026-Q1'].join(),
        ),
      )
    })
  })
})

test('FinancialsSection shows segments not on file as an empty state with no Retry', async () => {
  await mountFinancials(
    async ({ doc }) => {
      await waitFor(() => {
        const card = doc.querySelector('[data-testid="financials-segments"]')
        assert.match(card?.textContent ?? '', /No revenue segments on file\./)
        assert.equal(card?.querySelector('button:not([data-testid^="axis-"])'), null)
      })
    },
    { notOnFile: { segments: notOnFile('business segments not found') } },
  )
})

test('FinancialsSection with no fiscal year on file requests no statements and says so', async () => {
  await mountFinancials(
    async ({ doc, statementCalls, segmentCalls }) => {
      await waitFor(() => {
        assert.match(
          doc.querySelector('[data-testid="financials-statements"]')?.textContent ?? '',
          /No income statement on file\./,
        )
      })
      assert.equal(statementCalls.length, 0)
      assert.equal(segmentCalls.length, 0)
    },
    { notOnFile: { stats: notOnFile('stats not found') } },
  )
})
