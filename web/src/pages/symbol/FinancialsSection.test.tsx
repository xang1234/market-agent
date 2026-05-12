import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'

import type { SubjectDetailOutletContext } from '../../shell/subjectDetailOutletContext.ts'
import type { SegmentFactsEnvelope } from '../../symbol/segments.ts'
import type { ResolvedSubject } from '../../symbol/search.ts'
import type { GetStatementsRequest, GetStatementsResponse } from '../../symbol/statements.ts'
import { FinancialsSection } from './FinancialsSection.tsx'

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
  return <Outlet context={{ subject } satisfies SubjectDetailOutletContext} />
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

test('FinancialsSection requests recent fiscal quarters after switching statement period mode', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const statementCalls: GetStatementsRequest[] = []
  let root: Root | null = null

  try {
    globalThis.fetch = async (input, init) => {
      const url = input.toString()
      if (url === '/v1/fundamentals/statements') {
        const query = JSON.parse(String(init?.body ?? '{}')) as GetStatementsRequest
        statementCalls.push(query)
        return new Response(JSON.stringify(statementsResponse(query)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === '/v1/fundamentals/segments') {
        return new Response(JSON.stringify({ segments: segmentsResponse() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
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

    await waitFor(() => {
      assert.equal(statementCalls.length, 1)
    })
    assert.deepEqual(statementCalls[0]?.periods, ['2024-FY', '2023-FY', '2022-FY', '2021-FY', '2020-FY'])

    const quarterlyButton = dom.window.document.querySelector('[data-testid="period-mode-quarterly"]')
    assert.ok(quarterlyButton)
    await act(async () => {
      quarterlyButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      assert.ok(
        statementCalls.some((call) =>
          call.periods.length === 4 &&
          call.periods[0] === '2024-Q4' &&
          call.periods[1] === '2024-Q3' &&
          call.periods[2] === '2024-Q2' &&
          call.periods[3] === '2024-Q1',
        ),
      )
    })
  } finally {
    if (root !== null) {
      await act(async () => root?.unmount())
    }
    dom.window.close()
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})
