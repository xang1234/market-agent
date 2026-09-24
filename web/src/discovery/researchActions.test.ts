import assert from 'node:assert/strict'
import test from 'node:test'

import type { CandidateView, CampaignEvent, RunView } from '../../../services/discovery/src/types.ts'
import { formatCampaignMarkdown } from './export.ts'
import { readAuthorizedResearchView, readResearchHandoff, researchHandoffForCandidate, researchSummaryForCandidate } from './handoff.ts'
import { learningForEvent } from './learning.ts'

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333'
const ISSUER_ID = '44444444-4444-4444-8444-444444444444'
const LISTING_ID = '55555555-5555-4555-8555-555555555555'

test('learning trail maps only recorded event kinds and explains the skeptic pass can be wrong', () => {
  assert.equal(learningForEvent({ ...eventFixture(), kind: 'budget_exhausted' })?.title, 'Why the agent stopped')
  assert.match(learningForEvent({ ...eventFixture(), kind: 'skeptic_completed' })?.explanation ?? '', /second model pass.*can also be wrong/i)
  assert.equal(learningForEvent({ ...eventFixture(), kind: 'run_finalized' }), null)
})

test('learning trail has an exact explanation for every observable research event without inventing missing work', () => {
  const expected = {
    search_completed: 'How the agent searched',
    lead_resolved: 'How a company was identified',
    document_acquired: 'How the agent gathered evidence',
    criterion_assessed: 'How the research was checked',
    skeptic_completed: 'Why the research was challenged',
    budget_exhausted: 'Why the agent stopped',
    run_resumed: 'How the research resumed',
  } as const

  for (const [kind, title] of Object.entries(expected)) {
    assert.equal(learningForEvent({ ...eventFixture(), kind: kind as CampaignEvent['kind'] })?.title, title)
  }
  assert.equal(learningForEvent({ ...eventFixture(), kind: 'run_finalized' }), null)
})

test('campaign export is a cited research shortlist with unknown valuation and no recommendation language', () => {
  const markdown = formatCampaignMarkdown({ run: runViewFixture(), candidates: [candidateFixture()] })

  assert.match(markdown, /Research shortlist/)
  assert.match(markdown, /Valuation.*unknown/i)
  assert.match(markdown, /Company filing.*https:\/\/issuer\.example\.com\/filing/i)
  assert.match(markdown, /Evidence date: 2026-09-01/i)
  assert.match(markdown, /Research limit: 25/i)
  assert.match(markdown, /Rank policy:/i)
  assert.doesNotMatch(markdown, /Buy rating|expected return/i)
})

test('campaign export excludes redacted source text while retaining data gaps and limits', () => {
  const redacted = { ...candidateFixture(), evidence_available: false, sources: [{ ...candidateFixture().sources[0]!, title: 'Cached private title' }] }
  const markdown = formatCampaignMarkdown({ run: runViewFixture(), candidates: [redacted] })

  assert.doesNotMatch(markdown, /Cached private title/)
  assert.match(markdown, /Evidence details are no longer available/i)
  assert.match(markdown, /Data gaps/i)
  assert.match(markdown, /financial_gap/i)
})

test('research handoff rejects malformed state and trims a draft to five explicit conditions', () => {
  assert.equal(readResearchHandoff({ researchHandoff: { kind: 'discovery', runId: 'bad' } }), null)

  const handoff = readResearchHandoff({
    researchHandoff: {
      kind: 'discovery', campaignId: CAMPAIGN_ID, runId: RUN_ID, candidateId: CANDIDATE_ID,
      subjectRef: { kind: 'listing', id: LISTING_ID }, name: 'Grid Co', thesis: 'Cited draft thesis.',
      conditions: Array.from({ length: 7 }, (_, index) => ({ statement: `Condition ${index + 1}`, falsifier: `Falsifier ${index + 1}`, horizon: 'Next review' })),
    },
  })

  assert.equal(handoff?.conditions.length, 5)
  assert.equal(handoff?.conditions[4]?.statement, 'Condition 5')
  assert.equal(handoff?.trimmedConditions, 2)
  assert.equal(readResearchHandoff({ researchHandoff: { ...handoff, campaignId: 'not-a-uuid' } }), null)
})

test('research thesis handoff accepts either canonical issuer or listing identity', () => {
  const issuerHandoff = readResearchHandoff({
    researchHandoff: {
      kind: 'discovery', campaignId: CAMPAIGN_ID, runId: RUN_ID, candidateId: CANDIDATE_ID,
      subjectRef: { kind: 'issuer', id: ISSUER_ID }, name: 'Grid Co', thesis: 'Cited thesis.', conditions: [],
    },
  })

  assert.deepEqual(issuerHandoff?.subjectRef, { kind: 'issuer', id: ISSUER_ID })
})

test('research thesis handoff uses the canonical listing identity and does not invent financial conditions when valuation is unknown', () => {
  const handoff = researchHandoffForCandidate(runViewFixture(), candidateFixture())

  assert.deepEqual(handoff?.subjectRef, { kind: 'listing', id: LISTING_ID })
  assert.equal(handoff?.campaignId, CAMPAIGN_ID)
  assert.equal(handoff?.runId, RUN_ID)
  assert.equal(handoff?.candidateId, CANDIDATE_ID)
  assert.equal(handoff?.conditions.length, 0)
  assert.match(handoff?.thesis ?? '', /Company filing/)
  assert.match(researchSummaryForCandidate(runViewFixture(), candidateFixture())?.summary ?? '', /Company filing/)
  assert.equal(researchSummaryForCandidate(runViewFixture(), { ...candidateFixture(), identity: null }), null)
})

test('research handoff summaries use the fresh candidate state and never call investigated research shortlisted', () => {
  const shortlisted = researchSummaryForCandidate(runViewFixture(), candidateFixture())
  const investigated = researchSummaryForCandidate(runViewFixture(), {
    ...candidateFixture(),
    state: 'eligible_not_shortlisted',
    rank: null,
    can_promote: false,
  })

  assert.match(shortlisted?.summary ?? '', /was shortlisted in discovery research/i)
  assert.match(investigated?.summary ?? '', /was investigated in discovery research/i)
  assert.doesNotMatch(investigated?.summary ?? '', /shortlisted/i)
})

test('fresh research actions read current run and candidates then reject changed authorization', async () => {
  let runReads = 0
  let candidateReads = 0
  const view = await readAuthorizedResearchView({
    userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    campaignId: CAMPAIGN_ID,
    runId: RUN_ID,
    getRun: async () => { runReads += 1; return runViewFixture() },
    listCandidates: async () => { candidateReads += 1; return [candidateFixture()] },
  })

  assert.equal(runReads, 1)
  assert.equal(candidateReads, 1)
  assert.equal(view.candidates[0]?.candidate_id, CANDIDATE_ID)
  await assert.rejects(readAuthorizedResearchView({
    userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    campaignId: CAMPAIGN_ID,
    runId: RUN_ID,
    getRun: async () => ({ ...runViewFixture(), user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    listCandidates: async () => [candidateFixture()],
  }), /no longer authorized/i)
})

function eventFixture(): CampaignEvent {
  return {
    run_id: RUN_ID, sequence: 3, stage: 'research', kind: 'criterion_assessed', candidate_id: CANDIDATE_ID,
    summary: 'Recorded an assessed criterion.', citations: [{ kind: 'claim', id: '66666666-6666-4666-8666-666666666666' }], created_at: '2026-09-10T00:00:00.000Z',
  }
}

function candidateFixture(): CandidateView {
  return {
    candidate_id: CANDIDATE_ID,
    identity: { issuer_id: ISSUER_ID, listing_id: LISTING_ID, legal_name: 'Grid Co, Inc.', ticker: 'GRID', mic: 'XNAS', currency: 'USD', asset_type: 'common_stock', identity_source_ids: ['77777777-7777-4777-8777-777777777777'] },
    name: 'Grid Co', state: 'shortlisted', rank: 1, snapshot_id: '88888888-8888-4888-8888-888888888888', evidence_available: true, can_promote: true,
    assessment: {
      candidate_id: CANDIDATE_ID,
      identity: { issuer_id: ISSUER_ID, listing_id: LISTING_ID, legal_name: 'Grid Co, Inc.', ticker: 'GRID', mic: 'XNAS', currency: 'USD', asset_type: 'common_stock', identity_source_ids: ['77777777-7777-4777-8777-777777777777'] },
      state: 'eligible_not_shortlisted',
      dimensions: {
        theme_exposure: { level: 'strong', explanation: 'Equipment is used in grid upgrades.', citations: [{ kind: 'claim', id: '99999999-9999-4999-8999-999999999999' }] },
        evidence_strength: { level: 'mixed', explanation: 'One primary source is available.', citations: [{ kind: 'claim', id: '99999999-9999-4999-8999-999999999999' }] },
        business_quality: { level: 'mixed', explanation: 'Operating evidence is incomplete.', citations: [] },
        valuation_context: { level: 'unknown', explanation: 'No current valuation evidence is available.', citations: [] },
      },
      criteria: [{ criterion_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', outcome: 'pass', explanation: 'Direct exposure is documented.', citations: [{ kind: 'claim', id: '99999999-9999-4999-8999-999999999999' }] }],
      counterarguments: Array.from({ length: 7 }, (_, index) => ({ text: `Counterargument ${index + 1}`, citations: [] })),
      unresolved_questions: ['Can margin improve?'], next_action: 'Read the next filing.', reason_codes: [],
    },
    sources: [{ citation: { kind: 'claim', id: '99999999-9999-4999-8999-999999999999' }, title: 'Company filing', url: 'https://issuer.example.com/filing', published_at: '2026-09-01T00:00:00.000Z', retrieved_at: '2026-09-10T00:00:00.000Z' }],
    origins: ['web'], mechanism_ids: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'], reason_codes: [],
  }
}

function runViewFixture(): RunView {
  return {
    run_id: RUN_ID, campaign_id: CAMPAIGN_ID, brief_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'completed', stage: 'finalization', policy_version: 'v1', request_key: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', model_config: [],
    limits: { candidates: 100, research: 25, shortlist: 10, attempts: { search: 80, document: 150, identity: 120, financial: 50, model: 64 }, input_chars: 64000, output_tokens: 10000, request_timeout_ms: 30000, run_timeout_ms: 2700000 },
    usage: { search: 5, document: 10, identity: 3, financial: 1, model: 3 },
    coverage: { searches_planned: 5, searches_completed: 5, hits_truncated: 0, leads_overflow: 0, extraction_batches_skipped: 0, unresolved: 1, discovered: 6, selected: 3, assessed: 3, not_selected: 2, mechanisms: [{ mechanism_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', discovered: 6, selected: 3, assessed: 3 }], gaps: [{ code: 'financial_gap', candidate_id: CANDIDATE_ID, detail: 'No current valuation evidence is available.' }] },
    started_at: '2026-09-10T00:00:00.000Z', finished_at: '2026-09-10T01:00:00.000Z', cancel_requested_at: null,
    shortlist: [candidateFixture()], cost: { status: 'unavailable' }, worker_waiting: false,
  }
}
