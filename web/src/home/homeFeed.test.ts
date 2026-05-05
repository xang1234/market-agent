import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzePathForSubject } from '../analyze/analyzeEntry.ts'
import { symbolDetailPathForSubject } from '../symbol/search.ts'
import {
  homeCardPath,
  homeFindingCardLinkState,
  rateLimitActivityStream,
  summarizeHomeSections,
  type HomeFeed,
  type HomeRunActivity,
} from './homeFeed.ts'

const AAPL = {
  kind: 'listing',
  id: '11111111-1111-4111-9111-111111111111',
} as const

test('homeCardPath routes symbol and analyze destinations from canonical SubjectRef', () => {
  assert.equal(
    homeCardPath({ kind: 'symbol', subject_ref: AAPL }),
    symbolDetailPathForSubject(AAPL),
  )
  assert.equal(
    homeCardPath({ kind: 'symbol', subject_ref: AAPL, tab: 'earnings' }),
    '/symbol/listing%3A11111111-1111-4111-9111-111111111111/earnings',
  )
  assert.equal(
    homeCardPath({ kind: 'analyze', subject_ref: AAPL, intent: 'memo' }),
    analyzePathForSubject(AAPL, 'memo'),
  )
})

test('homeCardPath keeps theme and none destinations unlinked', () => {
  assert.equal(
    homeCardPath({
      kind: 'theme',
      theme_ref: { kind: 'theme', id: '22222222-2222-4222-9222-222222222222' },
    }),
    null,
  )
  assert.equal(homeCardPath({ kind: 'none' }), null)
})

test('homeFindingCardLinkState disables cards without explicit routes', () => {
  assert.deepEqual(homeFindingCardLinkState({ kind: 'none' }), {
    linked: false,
    to: null,
  })
  assert.deepEqual(homeFindingCardLinkState({ kind: 'symbol', subject_ref: AAPL }), {
    linked: true,
    to: symbolDetailPathForSubject(AAPL),
  })
})

test('summarizeHomeSections reports the four secondary Home sections', () => {
  const feed: HomeFeed = {
    findings: [],
    marketPulse: [
      { label: 'S&P 500', value: '5,210', movePercent: 0.42, asOf: '2026-05-05T01:00:00.000Z' },
    ],
    watchlistMovers: [
      {
        subject_ref: AAPL,
        label: 'AAPL',
        price: '$192.10',
        movePercent: 1.4,
        asOf: '2026-05-05T01:00:00.000Z',
      },
    ],
    agentSummaries: [
      { agent_id: 'agent-1', name: 'Earnings watcher', status: 'running', summary: 'Reading 10-Qs' },
    ],
    pinnedScreens: [
      {
        screen_id: '33333333-3333-4333-9333-333333333333',
        name: 'Large-cap tech',
        updated_at: '2026-05-05T01:00:00.000Z',
      },
    ],
  }

  assert.deepEqual(summarizeHomeSections(feed), {
    findings: 0,
    marketPulse: 1,
    watchlistMovers: 1,
    agentSummaries: 1,
    pinnedScreens: 1,
  })
})

test('rateLimitActivityStream caps each agent while preserving other agents in reverse chronological order', () => {
  const events: HomeRunActivity[] = [
    activity('noisy', '2026-05-05T10:04:00.000Z'),
    activity('quiet', '2026-05-05T10:03:00.000Z'),
    activity('noisy', '2026-05-05T10:02:00.000Z'),
    activity('noisy', '2026-05-05T10:01:00.000Z'),
    activity('quiet', '2026-05-05T10:00:00.000Z'),
  ]

  assert.deepEqual(
    rateLimitActivityStream(events, { perAgentLimit: 2 }).map((event) => event.run_activity_id),
    ['noisy-2026-05-05T10:04:00.000Z', 'quiet-2026-05-05T10:03:00.000Z', 'noisy-2026-05-05T10:02:00.000Z', 'quiet-2026-05-05T10:00:00.000Z'],
  )
})

function activity(agentId: string, ts: string): HomeRunActivity {
  return {
    run_activity_id: `${agentId}-${ts}`,
    agent_id: agentId,
    stage: 'reading',
    subject_refs: [AAPL],
    source_refs: [],
    summary: `${agentId} event`,
    ts,
  }
}
