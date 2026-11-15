import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeThesisHandoff, readAnalyzeThesisHandoff, readThesisHandoff } from './thesisHandoff.ts'
import type { AnalyzeRunDetail } from './runHistory.ts'

const CURRENT_SUBJECT_ID = '11111111-1111-4111-8111-111111111111'
const HISTORICAL_SUBJECT_ID = '22222222-2222-4222-8222-222222222222'

test('Analyze thesis handoff uses the opened run subject and rendered memo text', () => {
  const run = runDetail({
    subjectRefs: [{ kind: 'listing', id: HISTORICAL_SUBJECT_ID }],
    blocks: [{
      id: 'memo-summary',
      kind: 'rich_text',
      title: 'Summary',
      snapshot_id: '33333333-3333-4333-8333-333333333333',
      data_ref: { kind: 'analyze_run', id: 'memo-summary' },
      source_refs: [],
      as_of: '2026-09-08T00:00:00.000Z',
      segments: [{ type: 'text', text: 'Margins are expanding while cash conversion remains stable.' }],
    }],
  })

  const handoff = analyzeThesisHandoff(run)

  assert.deepEqual(handoff, {
    sourceRunId: 'run-historical',
    subjectRef: { kind: 'listing', id: HISTORICAL_SUBJECT_ID },
    thesis: 'Margins are expanding while cash conversion remains stable.',
    name: 'Historical memo monitor',
  })
  assert.notEqual(handoff?.subjectRef.id, CURRENT_SUBJECT_ID)
  assert.deepEqual(readAnalyzeThesisHandoff({ thesisHandoff: handoff }), handoff)
})

test("Analyze thesis handoff carries the memo's investment thesis section as it reads, not the rest of the memo", () => {
  const section = (id: string, children: ReadonlyArray<Record<string, unknown>>) => ({
    id: `section-${id}`, kind: 'section', title: id, snapshot_id: '33333333-3333-4333-8333-333333333333',
    data_ref: { kind: 'section', id: `analyze:${id}`, params: { playbook_section_id: id } }, children,
  })
  const run = runDetail({
    subjectRefs: [{ kind: 'issuer', id: CURRENT_SUBJECT_ID }],
    blocks: [
      section('investment_thesis', [
        { id: 'thesis-1', kind: 'rich_text', segments: [
          { type: 'text', text: 'NVIDIA sells ' },
          { type: 'ref', ref_kind: 'claim', ref_id: '66666666-6666-4666-8666-666666666666', format: 'data center platforms' },
          { type: 'text', text: '. Its revenue was ' },
          { type: 'ref', ref_kind: 'result', ref_id: '77777777-7777-4777-8777-777777777777', format: '$130.5B', period: 'FY2026' },
          { type: 'text', text: ' in its latest fiscal year.' },
        ] },
        { id: 'thesis-2', kind: 'rich_text', segments: [{ type: 'text', text: 'Its 10-K names gaming as its other market.' }] },
      ]),
      { id: 'figures', kind: 'financial_answer', segments: [{ type: 'text', text: 'Revenue table' }] },
      section('downside_risks', [{ id: 'risk-1', kind: 'rich_text', segments: [{ type: 'text', text: 'Export controls limit sales.' }] }]),
    ],
  })

  assert.equal(
    analyzeThesisHandoff(run)?.thesis,
    'NVIDIA sells data center platforms. Its revenue was $130.5B in its latest fiscal year.\n\nIts 10-K names gaming as its other market.',
  )
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
