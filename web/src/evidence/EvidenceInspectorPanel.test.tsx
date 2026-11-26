import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import type { FigureSegment } from '../blocks/types.ts'
import type { EvidenceInspectorContextValue } from './evidenceInspectorContext.ts'
import { EvidenceInspectorPanel } from './EvidenceInspectorPanel.tsx'

const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'
const RESULT = '91111111-1111-4111-9111-111111111111'
const YEAR_AGO = '92222222-2222-4222-9222-222222222222'
const CLAIM = '93333333-3333-4333-9333-333333333333'

const GROWTH: FigureSegment = {
  type: 'figure',
  text: '58%',
  sources: [
    { ref_kind: 'result', ref_id: YEAR_AGO, format: '$39.3B', period: 'Q4 FY2025' },
    { ref_kind: 'result', ref_id: RESULT, format: '$62.1B', period: 'Q4 FY2026' },
    { ref_kind: 'claim', ref_id: CLAIM, format: 'Revenue rose 58% from a year ago.', numeral: 1 },
  ],
  derivation: 'growth',
  operands: [{ add: [0], subtract: [], over: null }, { add: [1], subtract: [], over: null }],
}

test('a derived figure\'s page names its derivation and opens each source it was computed from (#800)', async () => {
  const opened: unknown[] = []
  const inspector: EvidenceInspectorContextValue = {
    openInspection(input) { opened.push(['evidence', input]) },
    openBlockInspection() {},
    openFinancialResult(resultId, shown) { opened.push(['result', resultId, shown]) },
    closeInspection() {},
  }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window }
  const previous = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window }
  Object.assign(globals, { IS_REACT_ACT_ENVIRONMENT: true, document: dom.window.document, window: dom.window })
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(<EvidenceInspectorPanel stack={[{ kind: 'figure', snapshotId: SNAPSHOT_ID, figure: GROWTH }]} inspector={inspector} onBack={() => {}} onClose={() => {}} />)
    })
    const panel = dom.window.document.querySelector('aside')!
    assert.equal(panel.querySelector('h2')!.textContent, '58%')
    assert.equal(panel.querySelector('h2 + p')!.textContent, 'Growth, computed from 3 sources')
    const sources = [...panel.querySelectorAll<HTMLButtonElement>('ol[aria-label="Sources"] button')]
    assert.deepEqual(sources.map((button) => button.textContent), ['$39.3B, Q4 FY2025', '$62.1B, Q4 FY2026', 'Revenue rose 58% from a year ago.'])
    for (const button of sources) await act(async () => button.click())
    assert.deepEqual(opened, [
      ['result', YEAR_AGO, { subject: null, measure: null, period: 'Q4 FY2025', value: '$39.3B' }],
      ['result', RESULT, { subject: null, measure: null, period: 'Q4 FY2026', value: '$62.1B' }],
      ['evidence', { snapshotId: SNAPSHOT_ID, ref: { kind: 'claim', id: CLAIM }, shownAs: 'Revenue rose 58% from a year ago.' }],
    ])
    await act(async () => root.unmount())
  } finally {
    Object.assign(globals, { IS_REACT_ACT_ENVIRONMENT: previous.act, document: previous.document, window: previous.window })
  }
})
