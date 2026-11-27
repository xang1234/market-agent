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

// Devin on #813: the page listed sources in array order and counted the claim no operand
// reads. Here the growth reads its sources in reverse order, so array order would be wrong.
const GROWTH: FigureSegment = {
  type: 'figure',
  text: '58%',
  sources: [
    { ref_kind: 'result', ref_id: RESULT, format: '$62.1B', period: 'Q4 FY2026' },
    { ref_kind: 'result', ref_id: YEAR_AGO, format: '$39.3B', period: 'Q4 FY2025' },
    { ref_kind: 'claim', ref_id: CLAIM, format: 'Revenue rose 58% from a year ago.', numeral: 1 },
  ],
  derivation: 'growth',
  operands: [{ add: [1], subtract: [], over: null }, { add: [0], subtract: [], over: null }],
}

const INSPECTOR = (opened: unknown[]): EvidenceInspectorContextValue => ({
  openInspection(input) { opened.push(['evidence', input]) },
  openBlockInspection() {},
  openFinancialResult(resultId, shown) { opened.push(['result', resultId, shown]) },
  closeInspection() {},
})

async function renderPage(figure: FigureSegment, opened: unknown[], use: (panel: Element) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window }
  const previous = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window }
  Object.assign(globals, { IS_REACT_ACT_ENVIRONMENT: true, document: dom.window.document, window: dom.window })
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(<EvidenceInspectorPanel stack={[{ kind: 'figure', snapshotId: SNAPSHOT_ID, figure }]} inspector={INSPECTOR(opened)} onBack={() => {}} onClose={() => {}} />)
    })
    await use(dom.window.document.querySelector('aside')!)
    await act(async () => root.unmount())
  } finally {
    Object.assign(globals, { IS_REACT_ACT_ENVIRONMENT: previous.act, document: previous.document, window: previous.window })
  }
}

test('a derived figure\'s page reads its operands in order, each source in its part, and lists the rest as citations (#800)', async () => {
  const opened: unknown[] = []
  await renderPage(GROWTH, opened, async (panel) => {
    assert.equal(panel.querySelector('h2')!.textContent, '58%')
    assert.equal(panel.querySelector('h2 + p')!.textContent, 'Growth, computed from 2 sources')
    assert.deepEqual([...panel.querySelectorAll('ol[aria-label="Calculation"] > li')].map((item) => item.textContent), ['From $39.3B, Q4 FY2025', 'To $62.1B, Q4 FY2026'])
    assert.deepEqual([...panel.querySelectorAll('ul[aria-label="Also cited"] button')].map((button) => button.textContent), ['Revenue rose 58% from a year ago.'])
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-inspect-result], ul[aria-label="Also cited"] button')) await act(async () => button.click())
  })
  assert.deepEqual(opened, [
    ['result', YEAR_AGO, { subject: null, measure: null, period: 'Q4 FY2025', value: '$39.3B' }],
    ['result', RESULT, { subject: null, measure: null, period: 'Q4 FY2026', value: '$62.1B' }],
    ['evidence', { snapshotId: SNAPSHOT_ID, ref: { kind: 'claim', id: CLAIM }, shownAs: 'Revenue rose 58% from a year ago.' }],
  ])
})

test('an operand shows what it adds, subtracts and divides by', async () => {
  const result = (id: string, format: string) => ({ ref_kind: 'result', ref_id: `9${id}111111-1111-4111-9111-111111111111`, format }) as const
  const change: FigureSegment = {
    type: 'figure',
    text: '-0.7 points',
    sources: [result('1', '$46.2B'), result('2', '$62.1B'), result('3', '$29.1B'), result('4', '$2.0B'), result('5', '$39.3B')],
    derivation: 'difference',
    operands: [{ add: [0], subtract: [], over: [1] }, { add: [2, 3], subtract: [], over: [4] }],
  }
  await renderPage(change, [], async (panel) => {
    assert.equal(panel.querySelector('h2 + p')!.textContent, 'Difference, computed from 5 sources')
    assert.deepEqual([...panel.querySelectorAll('ol[aria-label="Calculation"] > li')].map((item) => item.textContent), ['From $46.2B ÷ $62.1B', 'Less ($29.1B + $2.0B) ÷ $39.3B'])
    assert.equal(panel.querySelector('ul[aria-label="Also cited"]'), null)
  })
  const net: FigureSegment = { ...change, text: '$5.1B', derivation: 'sum', sources: change.sources.slice(0, 3), operands: [{ add: [0], subtract: [2], over: null }, { add: [1], subtract: [], over: null }] }
  await renderPage(net, [], async (panel) => {
    assert.deepEqual([...panel.querySelectorAll('ol[aria-label="Calculation"] > li')].map((item) => item.textContent), ['Add $46.2B − $29.1B', 'Add $62.1B'])
  })
})
