import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { installDomGlobals } from '../analyst-grids/testDom.ts'
import type { GuidanceRecordEnvelope, GuidanceSource } from './guidanceRecord.ts'
import { GuidanceRecordBody } from './GuidanceRecordView.tsx'

const source = (filed_on: string, quote: string, url: string | null = `https://www.sec.gov/${filed_on}`): GuidanceSource => ({ document_id: filed_on, claim_id: null, filed_on, url, quote })

const ENVELOPE: GuidanceRecordEnvelope = {
  issuer_id: 'issuer-1',
  quarters: 8,
  record: {
    rows: [
      { quarter_end: null, metric: 'revenue', basis: 'gaap', unit: 'usd', guided: { low: 52.92e9, high: 55.08e9, source: source('2025-08-27', 'Revenue is expected to be $54.0 billion, plus or minus 2%.') }, actual: null, outcome: 'not_yet_reported' },
      {
        quarter_end: '2025-07-27', metric: 'revenue', basis: 'gaap', unit: 'usd',
        guided: { low: 44.1e9, high: 45.9e9, source: source('2025-05-28', 'Revenue is expected to be $45.0 billion, plus or minus 2%.') },
        actual: { value: 46.7e9, source: source('2025-08-27', 'Revenue for the second quarter was $46.7 billion.') },
        outcome: 'beat',
      },
      { quarter_end: '2025-07-27', metric: 'gross_margin', basis: 'non_gaap', unit: 'percent', guided: { low: 71.5, high: 72.5, source: source('2025-05-28', 'GAAP and non-GAAP gross margins are expected to be 71.8% and 72.0%, respectively, plus or minus 50 basis points.', null) }, actual: null, outcome: 'not_comparable', reason: 'no_same_basis_actual' },
      {
        quarter_end: '2025-07-27', metric: 'operating_expenses', basis: 'non_gaap', unit: 'usd',
        guided: { low: 4.0e9, high: 4.0e9, source: source('2025-05-28', 'Non-GAAP operating expenses are expected to be approximately $4.0 billion.') },
        actual: { value: 3.9e9, source: { ...source('2025-09-02', 'Non-GAAP operating expenses were $3.9 billion.'), form: '8-K/A' } },
        outcome: 'beat',
      },
    ],
    hit_rates: [
      { metric: 'revenue', basis: 'gaap', hits: 1, compared: 1 },
      { metric: 'operating_expenses', basis: 'non_gaap', hits: 1, compared: 1 },
    ],
  },
}

async function render(envelope: GuidanceRecordEnvelope) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restore = installDomGlobals(dom.window as unknown as Window)
  const root = createRoot(dom.window.document.getElementById('root')!)
  await act(async () => root.render(<GuidanceRecordBody envelope={envelope} />))
  return { doc: dom.window.document, done: async () => { await act(async () => root.unmount()); restore() } }
}

test('each guide shows beside the actual on its basis, both quoted with their filings, and the hit rate per figure', async () => {
  const { doc, done } = await render(ENVELOPE)
  try {
    assert.deepEqual(
      [...doc.querySelectorAll('[data-testid="guidance-hit-rates"] li')].map((li) => li.textContent),
      ['Revenue (GAAP) 1 of 1 quarter in line or beat', 'Operating expenses (non-GAAP) 1 of 1 quarter in line or beat'],
    )
    const beat = doc.querySelector('[data-testid="guidance-row-2025-07-27-revenue-gaap"]')!
    assert.equal(beat.getAttribute('data-outcome'), 'beat')
    assert.match(beat.textContent!, /Guided \$44\.10B to \$45\.90B"Revenue is expected to be \$45\.0 billion, plus or minus 2%\."8-K filed 2025-05-28/)
    assert.match(beat.textContent!, /Reported \$46\.70B"Revenue for the second quarter was \$46\.7 billion\."8-K filed 2025-08-27/)
    assert.deepEqual([...beat.querySelectorAll('a')].map((a) => a.getAttribute('href')), ['https://www.sec.gov/2025-05-28', 'https://www.sec.gov/2025-08-27'])
    // A non-GAAP guide with no non-GAAP actual shows no actual from another basis.
    const unmatched = doc.querySelector('[data-testid="guidance-row-2025-07-27-gross_margin-non_gaap"]')!
    assert.match(unmatched.textContent!, /Not comparable/)
    assert.match(unmatched.textContent!, /Guided 71\.5% to 72\.5%/)
    assert.doesNotMatch(unmatched.textContent!, /Reported/)
    assert.match(unmatched.textContent!, /No non-GAAP actual for this quarter was read from the next release, and a guide is never compared across bases\./)
    assert.equal(unmatched.querySelectorAll('a').length, 0, 'a filing with no link is named, not linked')
    assert.match(doc.querySelector('[data-testid="guidance-row-next-revenue-gaap"]')!.textContent!, /Next quarterNot yet reported/)
    assert.match(doc.querySelector('[data-testid="guidance-row-2025-07-27-operating_expenses-non_gaap"]')!.textContent!, /8-K\/A filed 2025-09-02/)
    assert.match(doc.body.textContent!, /For operating expenses and capex, an actual below the guided range counts as a beat\./)
  } finally {
    await done()
  }
})

test('an issuer with no guidance figures says so', async () => {
  const { doc, done } = await render({ ...ENVELOPE, record: { rows: [], hit_rates: [] } })
  try {
    assert.equal(doc.body.textContent, "No guidance with figures is on file from this company's earnings releases.")
  } finally {
    await done()
  }
})

test('a guide not compared says why: conflicting guides for the next quarter, or EPS across a stock split or without split history', async () => {
  const eps = (quarter_end: string, reason: 'split_between_releases' | 'split_history_missing') => ({
    quarter_end, metric: 'eps', basis: 'non_gaap' as const, unit: 'usd_per_share' as const,
    guided: { low: 10.5, high: 10.5, source: source('2024-05-22', 'Non-GAAP diluted EPS is expected to be $10.50.') },
    actual: { value: 1.2, source: source('2024-08-28', 'Non-GAAP diluted EPS was $1.20.') },
    outcome: 'not_comparable' as const, reason,
  })
  const { doc, done } = await render({
    ...ENVELOPE,
    record: {
      rows: [
        { ...ENVELOPE.record.rows[0]!, outcome: 'not_comparable', reason: 'conflicting_guidance' },
        eps('2024-07-28', 'split_between_releases'),
        eps('2024-04-28', 'split_history_missing'),
      ],
      hit_rates: [],
    },
  })
  try {
    assert.match(doc.querySelector('[data-testid="guidance-row-next-revenue-gaap"]')!.textContent!, /Next quarterNot comparable.*The release gives different figures for this guide, so it is not compared\./)
    assert.match(
      doc.querySelector('[data-testid="guidance-row-2024-07-28-eps-non_gaap"]')!.textContent!,
      /Reported \$1\.20.*A stock split between the two releases puts their EPS on different share counts, so the guide is not compared\./,
    )
    assert.match(
      doc.querySelector('[data-testid="guidance-row-2024-04-28-eps-non_gaap"]')!.textContent!,
      /This company's stock split history is not on file through the later release, so its EPS is not compared\./,
    )
  } finally {
    await done()
  }
})
