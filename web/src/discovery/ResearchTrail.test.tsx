import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CampaignEvent } from '../../../services/discovery/src/types.ts'
import { ResearchTrail } from './ResearchTrail.tsx'

test('ResearchTrail groups only recorded events by stage and role without manufacturing a narrative', () => {
  const html = renderToStaticMarkup(<ResearchTrail events={[
    event('search_completed', 'discovery', 'Scout found leads.'),
    event('skeptic_completed', 'research', 'Skeptic challenged the assessment.'),
  ]} />)

  assert.match(html, /Discovery · Scout/)
  assert.match(html, /Research · Skeptic/)
  assert.match(html, /Scout found leads/)
  assert.match(html, /Skeptic challenged the assessment/)
  assert.doesNotMatch(html, /unrecorded|hidden reasoning|step-by-step/i)
})

test('ResearchTrail exposes the recorded-event cursor as an explicit next-page control', () => {
  const html = renderToStaticMarkup(<ResearchTrail events={[event('search_completed', 'discovery', 'Scout found leads.')]} hasMore onLoadMore={() => undefined} />)
  assert.match(html, /Load more recorded activity/)
})

test('ResearchTrail keeps an available cursor reachable when the current page has no events', () => {
  const html = renderToStaticMarkup(<ResearchTrail events={[]} hasMore onLoadMore={() => undefined} />)
  assert.match(html, /Load more recorded activity/)
})

function event(kind: CampaignEvent['kind'], stage: CampaignEvent['stage'], summary: string): CampaignEvent {
  return {
    run_id: '22222222-2222-4222-8222-222222222222', sequence: kind === 'search_completed' ? 1 : 2,
    stage, kind, candidate_id: null, summary, citations: [], created_at: '2026-09-10T00:00:00.000Z',
  }
}
