// Verification labels across Chat, memo, grid, thesis, and Discovery: each
// label belongs to one certified item, never to a whole answer; a gap stays
// visible; an old or unknown format is legacy output, never verified text.

import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { AssessmentHistory } from '../agents/ThesisHistory.tsx'
import { FinancialSections } from '../analyze/FinancialSections.tsx'
import { GridTable } from '../analyst-grids/GridTable.tsx'
import type { GridRunDetail } from '../analyst-grids/gridsTypes.ts'
import { CandidateCard } from '../discovery/CandidateCard.tsx'
import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from '../evidence/evidenceInspectorContext.ts'
import { BlockRegistryProvider, BlockView, createDefaultBlockRegistry } from './index.ts'
import { financialAnswerFixture, richTextFixture } from './fixtures.ts'
import type { Block, FinancialAnswerBlock } from './types.ts'

const inspector: EvidenceInspectorContextValue = {
  openInspection() {},
  openBlockInspection() {},
  openFinancialResult() {},
  closeInspection() {},
}

const count = (html: string, text: string) => html.split(text).length - 1

function withInspector(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
      <EvidenceInspectorContext.Provider value={inspector}>{node}</EvidenceInspectorContext.Provider>
    </BlockRegistryProvider>,
  )
}

test('chat: model commentary beside certified values never acquires the verified badge', () => {
  const html = withInspector(
    <>
      <BlockView block={richTextFixture as Block} />
      <BlockView block={financialAnswerFixture as Block} />
    </>,
  )
  assert.equal(count(html, 'Verified calculation'), 1, 'one badge, on the certified block only')
  const narrative = html.slice(0, html.indexOf('block-financial-answer'))
  assert.ok(!narrative.includes('data-verification'), 'the narrative block carries no verification label')
  assert.ok(html.includes('data-inspect-result='), 'certified values open the shared inspector')
})

test('an old client meeting a newer answer format shows legacy output and no values', () => {
  const newer = { ...financialAnswerFixture, financial: { presentation_version: 'financial-presentation.v99' } } as FinancialAnswerBlock
  const html = withInspector(<BlockView block={newer as Block} />)
  assert.ok(html.includes('Legacy output') && !html.includes('Verified calculation'))
  assert.ok(!html.includes('data-inspect-result='))
})

test('memo: a requested section that did not publish stays visible as a gap', () => {
  const html = withInspector(
    <FinancialSections
      sections={{
        coverage: 'partial',
        sections: [
          { section_id: 'financial_health', status: 'published', run_id: 'run', snapshot_id: financialAnswerFixture.snapshot_id, block: financialAnswerFixture as unknown as Record<string, unknown> },
          { section_id: 'revenue_trend', status: 'gap', reason_code: 'verification_failed' },
        ],
      }}
    />,
  )
  assert.ok(html.includes('data-coverage="partial"') && html.includes('Partial coverage'))
  assert.match(html, /data-section-id="revenue_trend" data-section-status="gap"/u)
  assert.ok(html.includes('did not pass verification, so no figures are shown'))
})

test('grid: a peer without a value keeps its row, and its reason is readable', () => {
  const detail: GridRunDetail = {
    run: { grid_run_id: 'g', status: 'partial', cell_total: 2, cell_done: 2, dropped_row_count: 0 },
    rows: [
      { grid_row_id: 'row-a', row_number: 0, subject_ref: { kind: 'issuer', id: 'a' }, subject_label: 'Alpha Industries Inc.', status: 'resolved' },
      { grid_row_id: 'row-b', row_number: 1, subject_ref: { kind: 'issuer', id: 'b' }, subject_label: 'Beta Holdings Corp.', status: 'resolved' },
    ],
    cells: [
      { grid_row_id: 'row-a', column_key: 'latest_revenue', column_instance_id: 'c0', status: 'ok', display: { value: '$383.29B', tone: null }, snapshot_id: 's', primary_ref: null, coverage_flag: null, financial_block: financialAnswerFixture },
      { grid_row_id: 'row-b', column_key: 'latest_revenue', column_instance_id: 'c0', status: 'missing_data', display: { value: '—', tone: null }, snapshot_id: 's2', primary_ref: null, coverage_flag: 'missing_input', financial_block: financialAnswerFixture },
    ],
  }
  const html = withInspector(<GridTable columns={[{ column_key: 'latest_revenue', label: 'Revenue (latest)', kind: 'deterministic' }]} detail={detail} />)
  assert.ok(html.includes('Alpha Industries Inc.') && html.includes('Beta Holdings Corp.'), 'both requested companies stay in the table')
  assert.ok(html.includes('Not available: missing input'))
  assert.deepEqual([count(html, 'Verified calculation'), count(html, 'Partial coverage')], [1, 1])
  assert.ok(html.includes('aria-label="Inspect the verified calculation: $383.29B"'))
})

test('thesis: each condition is labelled by how it was assessed', () => {
  const conditionId = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
  const html = withInspector(
    <AssessmentHistory
      history={{
        thesis: null,
        versions: [],
        metrics: [],
        assessments: [{
          assessment_id: 'a', thesis_version_id: 'v', run_id: 'r', snapshot_id: 's', input_hash: 'h', model_version: null, prompt_version: 'p', assessed_at: '2026-09-25T00:00:00.000Z',
          results: [
            { condition_id: conditionId(1), status: 'supported', reason: 'Meets the saved threshold.', claim_refs: [], fact_refs: [], method: 'metric', financial: { run_id: 'r', unit_id: 'condition', snapshot_id: 's', certificate_digest: 'd'.repeat(64), result_hash: 'e'.repeat(64) } },
            { condition_id: conditionId(2), status: 'challenged', reason: 'Cited evidence disagrees.', claim_refs: [], fact_refs: [], method: 'model' },
            { condition_id: conditionId(3), status: 'supported', reason: 'Stored fact meets it.', claim_refs: [], fact_refs: [], method: 'metric' },
          ],
        }],
      }}
    />,
  )
  assert.deepEqual(['Verified calculation', 'Source-linked narrative', 'Legacy output'].map((text) => count(html, text)), [1, 1, 1])
  assert.ok(html.includes('certificate dddddddddddd'))
})

test('discovery: a numerical criterion shows its certified verdict, never the roles’ narration', () => {
  const html = withInspector(
    <CandidateCard
      candidate={{
        candidate_id: 'c', identity: null, name: 'Alpha', state: 'excluded', rank: null, snapshot_id: 's', evidence_available: true, can_promote: false,
        sources: [], origins: ['web'], mechanism_ids: [], reason_codes: ['required_criterion_failed'],
        assessment: {
          candidate_id: 'c', identity: null as never, state: 'excluded', counterarguments: [], unresolved_questions: [], next_action: 'Stop.', reason_codes: ['required_criterion_failed'],
          dimensions: {} as never,
          criteria: [
            { criterion_id: 'k1', outcome: 'fail', explanation: 'The verified calculation at the assessment cutoff does not meet the saved threshold.', citations: [], certified: { run_id: 'r', unit_id: 'condition', snapshot_id: 's', certificate_digest: 'd'.repeat(64), result_hash: 'e'.repeat(64) } },
            { criterion_id: 'k2', outcome: 'pass', explanation: 'Both roles agree.', citations: [] },
          ],
        },
      }}
    />,
  )
  assert.equal(count(html, 'Verified calculation'), 1)
  assert.match(html, /data-criterion-id="k1"[^]*Not met/u)
  assert.ok(!html.includes('data-criterion-id="k2"'), 'a narrative criterion is not listed as a verified figure')
})
