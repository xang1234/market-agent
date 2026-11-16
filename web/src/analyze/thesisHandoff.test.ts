import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeThesisHandoff, readAnalyzeThesisHandoff, readThesisHandoff } from './thesisHandoff.ts'
import type { AnalyzeRunDetail } from './runHistory.ts'

const CURRENT_SUBJECT_ID = '11111111-1111-4111-8111-111111111111'
const HISTORICAL_SUBJECT_ID = '22222222-2222-4222-8222-222222222222'

const SNAPSHOT = '33333333-3333-4333-8333-333333333333'
const CLAIM = '66666666-6666-4666-8666-666666666666'
const section = (id: string, children: ReadonlyArray<Record<string, unknown>>) => ({
  id: `section-${id}`, kind: 'section', title: id, snapshot_id: SNAPSHOT,
  data_ref: { kind: 'section', id: `analyze:${id}`, params: { playbook_section_id: id } }, children,
})
const flat = (id: string, text: string) => ({
  id: `flat-${id}`, kind: 'rich_text', title: id, snapshot_id: SNAPSHOT,
  data_ref: { kind: 'analyze_run', id: `flat-${id}`, params: { playbook_section_id: id } }, segments: [{ type: 'text', text }],
})
const paragraph = (text: string) => ({ id: `p-${text.length}`, kind: 'rich_text', segments: [{ type: 'text', text }] })
const thesisOf = (blocks: ReadonlyArray<Record<string, unknown>>) => {
  const offer = analyzeThesisHandoff(runDetail({ subjectRefs: [{ kind: 'issuer', id: CURRENT_SUBJECT_ID }], blocks }))
  return offer?.kind === 'handoff' ? offer.handoff.thesis : offer
}

test('Analyze thesis handoff uses the opened run subject and its thesis section', () => {
  const run = runDetail({
    subjectRefs: [{ kind: 'listing', id: HISTORICAL_SUBJECT_ID }],
    blocks: [section('investment_thesis', [paragraph('Margins are expanding while cash conversion remains stable.')])],
  })

  const offer = analyzeThesisHandoff(run)

  assert.deepEqual(offer, { kind: 'handoff', handoff: {
    sourceRunId: 'run-historical',
    subjectRef: { kind: 'listing', id: HISTORICAL_SUBJECT_ID },
    thesis: 'Margins are expanding while cash conversion remains stable.',
    name: 'Historical memo monitor',
  } })
  assert.notEqual(offer?.kind === 'handoff' ? offer.handoff.subjectRef.id : null, CURRENT_SUBJECT_ID)
  assert.deepEqual(readAnalyzeThesisHandoff({ thesisHandoff: offer?.kind === 'handoff' ? offer.handoff : null }), offer?.kind === 'handoff' ? offer.handoff : null)
})

test("Analyze thesis handoff carries the memo's investment thesis section as it reads, not the rest of the memo", () => {
  assert.equal(thesisOf([
    section('investment_thesis', [
      { id: 'thesis-1', kind: 'rich_text', segments: [
        { type: 'text', text: 'NVIDIA sells ' },
        { type: 'ref', ref_kind: 'claim', ref_id: CLAIM, format: 'data center platforms' },
        { type: 'text', text: '. Its revenue was ' },
        { type: 'ref', ref_kind: 'result', ref_id: '77777777-7777-4777-8777-777777777777', format: '$130.5B', period: 'FY2026' },
        { type: 'text', text: ' in its latest fiscal year.' },
      ] },
      paragraph('Its 10-K names gaming as its other market.'),
    ]),
    { id: 'figures', kind: 'financial_answer', segments: [{ type: 'text', text: 'Revenue table' }] },
    section('downside_risks', [paragraph('Export controls limit sales.')]),
  ]), 'NVIDIA sells data center platforms. Its revenue was $130.5B in its latest fiscal year.\n\nIts 10-K names gaming as its other market.')
})

test('a v1 memo hands over the rich text blocks its thesis section tags, and no other section', () => {
  assert.equal(thesisOf([flat('investment_thesis', 'THESIS TEXT'), flat('downside_risks', 'RISK TEXT'), flat('final_verdict', 'Rating: Buy')]), 'THESIS TEXT')
})

test('a memo with no thesis, or too little checked thesis text to save, hands over nothing and says why', () => {
  const none = { kind: 'no_thesis', note: 'This memo has no investment thesis section to monitor.' }
  assert.deepEqual(thesisOf([section('downside_risks', [paragraph('RISK TEXT')])]), none)
  assert.deepEqual(thesisOf([paragraph('Margins are expanding while cash conversion remains stable.')]), none, 'untagged memo text is not a thesis')
  const unchecked = { kind: 'no_thesis', note: "This memo's investment thesis section has too little checked text to monitor." }
  assert.deepEqual(thesisOf([section('investment_thesis', []), section('downside_risks', [paragraph('RISK TEXT')])]), unchecked)
  assert.deepEqual(thesisOf([section('investment_thesis', [paragraph('Buy.')])]), unchecked, 'shorter than a thesis can be saved')
  assert.deepEqual(thesisOf([section('investment_thesis', [{ id: 'card', kind: 'rich_text', analyst_commentary: true, segments: [], commentary: [{ kind: 'unverified', subject: null, text: 'Demand will outlast supply.' }] }])]), unchecked)
})

test('commentary hands over its verified inferences and figures, never an unverified or pending inference or its label', () => {
  const card = {
    id: 'card', kind: 'rich_text', analyst_commentary: true,
    segments: [
      { type: 'text', text: 'NVIDIA sells data center platforms.\n\n> **Unverified analyst view** (not backed by the figures shown): Demand will outlast supply.\n\n> _Checking an analyst inference against the figures it rests on…_' },
    ],
    commentary: [
      { kind: 'inference', subject: 'NVDA', basis: 'the revenue figures', text: 'Data center revenue leads its segments.' },
      { kind: 'unverified', subject: null, text: 'Demand will outlast supply.' },
      { kind: 'pending' },
      { kind: 'figures', segments: [{ type: 'text', text: 'NVIDIA sells ' }, { type: 'ref', ref_kind: 'claim', ref_id: CLAIM, format: 'data center platforms' }, { type: 'text', text: '.' }] },
      { kind: 'note', text: 'More sources matched than are shown here.' },
    ],
  }
  const saved = { id: 'old-card', kind: 'rich_text', analyst_commentary: true, segments: [{ type: 'text', text: '> **Unverified analyst view**: Demand will outlast supply.' }] }
  assert.equal(thesisOf([section('investment_thesis', [card, saved])]), 'NVDA: Data center revenue leads its segments.\n\nNVIDIA sells data center platforms.')
})

test('a ref with no format reads as the memo shows it', () => {
  assert.equal(
    thesisOf([section('investment_thesis', [{ id: 'x', kind: 'rich_text', segments: [{ type: 'text', text: 'NVIDIA sells ' }, { type: 'ref', ref_kind: 'claim', ref_id: CLAIM }, { type: 'text', text: ' to cloud customers.' }] }])]),
    'NVIDIA sells [claim:66666666] to cloud customers.',
  )
})

test('a long thesis is cut at the saved limit on a whole character', () => {
  assert.equal(thesisOf([section('investment_thesis', [paragraph(`${'a'.repeat(3998)}😀b`)])]), `${'a'.repeat(3998)}😀`)
  assert.equal(thesisOf([section('investment_thesis', [paragraph(`${'a'.repeat(3999)}😀`)])]), 'a'.repeat(3999))
})

test('Analyze thesis handoff is unavailable for empty, multiple, or unsupported subjects', () => {
  assert.equal(analyzeThesisHandoff(runDetail({ subjectRefs: [] })), null)
  assert.equal(analyzeThesisHandoff(runDetail({
    subjectRefs: [
      { kind: 'issuer', id: CURRENT_SUBJECT_ID },
      { kind: 'issuer', id: HISTORICAL_SUBJECT_ID },
    ],
  })), null)
  assert.equal(analyzeThesisHandoff(runDetail({
    subjectRefs: [{ kind: 'theme', id: CURRENT_SUBJECT_ID }],
  })), null)
  assert.equal(readAnalyzeThesisHandoff({ thesisHandoff: { subjectRef: null } }), null)
})

test('the additive thesis handoff reader discriminates discovery provenance without changing legacy Analyze handoffs', () => {
  const legacy = readThesisHandoff({ thesisHandoff: {
    sourceRunId: 'run-historical',
    subjectRef: { kind: 'listing', id: HISTORICAL_SUBJECT_ID },
    thesis: 'Historical memo.',
    name: 'Historical monitor',
  } })
  const discovery = readThesisHandoff({ researchHandoff: {
    kind: 'discovery',
    campaignId: '33333333-3333-4333-8333-333333333333',
    runId: '44444444-4444-4444-8444-444444444444',
    candidateId: '55555555-5555-4555-8555-555555555555',
    subjectRef: { kind: 'listing', id: HISTORICAL_SUBJECT_ID },
    name: 'Discovery monitor',
    thesis: 'Cited research draft.',
    conditions: [],
  } })

  assert.equal(legacy?.kind, 'analyze')
  assert.equal(legacy?.kind === 'analyze' ? legacy.sourceRunId : null, 'run-historical')
  assert.equal(discovery?.kind, 'discovery')
  assert.equal(discovery?.kind === 'discovery' ? discovery.runId : null, '44444444-4444-4444-8444-444444444444')
  assert.equal(readThesisHandoff({ thesisHandoff: { kind: 'discovery', sourceRunId: 'run-historical' } }), null)
})

function runDetail(input: {
  subjectRefs: ReadonlyArray<{ kind: string; id: string }>
  blocks?: ReadonlyArray<Record<string, unknown>>
}): AnalyzeRunDetail {
  return {
    run_id: 'run-historical',
    template_id: '44444444-4444-4444-8444-444444444444',
    template_name: 'Historical template',
    template_version: 1,
    playbook_id: 'earnings_quality',
    playbook_name: 'Historical memo',
    playbook_version: 1,
    display_title: 'Historical memo',
    can_rerun: true,
    rerun_unavailable_reason: null,
    created_at: '2026-09-08T00:00:00.000Z',
    snapshot_id: '33333333-3333-4333-8333-333333333333',
    run_metadata: {
      schema_version: 1,
      template_id: '44444444-4444-4444-8444-444444444444',
      template_version: 1,
      playbook_id: 'earnings_quality',
      playbook_version: 1,
      instructions: 'Fallback instructions for the memo.',
      source_categories: ['filings'],
      subject_refs: input.subjectRefs,
    },
    blocks: input.blocks ?? [],
  }
}
