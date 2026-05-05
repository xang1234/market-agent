import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzePathForSubject } from '../analyze/analyzeEntry.ts'
import { symbolDetailPathForSubject } from '../symbol/search.ts'
import {
  EMPTY_HOME_FEED,
  homeCardPath,
  homeFindingCardLinkState,
  loadHomeFeed,
  rateLimitActivityStream,
  summarizeHomeSections,
  pinnedScreensFromSavedScreens,
  type HomeFeed,
  type HomeFinding,
  type HomeRunActivity,
} from './homeFeed.ts'
import type { QuoteSnapshot } from '../symbol/quote.ts'

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

test('pinnedScreensFromSavedScreens projects user-scoped saved screens for Home', () => {
  assert.deepEqual(
    pinnedScreensFromSavedScreens([
      {
        screen_id: '33333333-3333-4333-9333-333333333333',
        user_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        name: 'Large-cap tech',
        definition: {
          universe: [],
          market: [],
          fundamentals: [],
          sort: [{ field: 'market_cap', direction: 'desc' }],
          page: { limit: 50 },
        },
        created_at: '2026-05-04T01:00:00.000Z',
        updated_at: '2026-05-05T01:00:00.000Z',
      },
    ]),
    [
      {
        screen_id: '33333333-3333-4333-9333-333333333333',
        name: 'Large-cap tech',
        updated_at: '2026-05-05T01:00:00.000Z',
      },
    ],
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

test('loadHomeFeed composes service-backed Home sections from injected clients', async () => {
  const calls: string[] = []

  const result = await loadHomeFeed({
    userId: 'user-1',
    deps: {
      listFindings: async ({ userId }) => {
        calls.push(`findings:${userId}`)
        return [finding()]
      },
      listMarketPulse: async ({ userId }) => {
        calls.push(`pulse:${userId}`)
        return [
          {
            label: 'SOXX',
            value: '720.00',
            movePercent: 0.81,
            asOf: '2026-05-05T01:02:00.000Z',
          },
        ]
      },
      listAgentSummaries: async ({ userId }) => {
        calls.push(`agents:${userId}`)
        return [
          {
            agent_id: 'agent-live',
            name: 'Live agent',
            status: 'running',
            summary: 'Reading fresh filings.',
          },
        ]
      },
      listRunActivities: async ({ userId }) => {
        calls.push(`activity:${userId}`)
        return [activity('agent-live', '2026-05-05T01:04:00.000Z')]
      },
      listSavedScreens: async ({ userId }) => {
        calls.push(`screens:${userId}`)
        return [
          {
            screen_id: '33333333-3333-4333-9333-333333333333',
            user_id: userId,
            name: 'Large-cap tech',
            definition: {
              universe: [],
              market: [],
              fundamentals: [],
              sort: [{ field: 'market_cap', direction: 'desc' }],
              page: { limit: 50 },
            },
            created_at: '2026-05-04T01:00:00.000Z',
            updated_at: '2026-05-05T01:00:00.000Z',
          },
        ]
      },
      listManualWatchlistMembers: async ({ userId }) => {
        calls.push(`watchlist:${userId}`)
        return [
          {
            subject_ref: AAPL,
            created_at: '2026-05-05T01:00:00.000Z',
          },
          {
            subject_ref: { kind: 'theme', id: '22222222-2222-4222-9222-222222222222' },
            created_at: '2026-05-05T01:00:00.000Z',
          },
        ]
      },
      fetchQuoteSnapshot: async (listingId) => {
        calls.push(`quote:${listingId}`)
        return quoteSnapshot(listingId)
      },
    },
  })

  assert.deepEqual(calls.sort(), [
    'activity:user-1',
    'agents:user-1',
    'findings:user-1',
    'pulse:user-1',
    'quote:11111111-1111-4111-9111-111111111111',
    'screens:user-1',
    'watchlist:user-1',
  ])
  assert.equal(result.usedDevFallback, false)
  assert.equal(result.feed.findings[0]?.block.id, 'home-live-finding')
  assert.deepEqual(result.feed.marketPulse, [
    {
      label: 'SOXX',
      value: '720.00',
      movePercent: 0.81,
      asOf: '2026-05-05T01:02:00.000Z',
    },
  ])
  assert.deepEqual(result.feed.watchlistMovers, [
    {
      subject_ref: AAPL,
      label: 'AAPL',
      price: '$192.10',
      movePercent: 1.4,
      asOf: '2026-05-05T01:03:00.000Z',
    },
  ])
  assert.deepEqual(result.feed.agentSummaries, [
    {
      agent_id: 'agent-live',
      name: 'Live agent',
      status: 'running',
      summary: 'Reading fresh filings.',
    },
  ])
  assert.deepEqual(result.feed.pinnedScreens, [
    {
      screen_id: '33333333-3333-4333-9333-333333333333',
      name: 'Large-cap tech',
      updated_at: '2026-05-05T01:00:00.000Z',
    },
  ])
  assert.deepEqual(result.activities.map((event) => event.run_activity_id), [
    'agent-live-2026-05-05T01:04:00.000Z',
  ])
})

test('loadHomeFeed only uses fixture fallback when explicitly allowed', async () => {
  const fallbackFeed: HomeFeed = {
    ...EMPTY_HOME_FEED,
    marketPulse: [
      {
        label: 'Fixture index',
        value: '1.00',
        movePercent: 0,
        asOf: '2026-05-05T01:00:00.000Z',
      },
    ],
  }
  const fallbackActivities = [activity('fixture', '2026-05-05T01:00:00.000Z')]

  assert.deepEqual(
    await loadHomeFeed({
      userId: null,
      deps: {},
      fallbackFeed,
      fallbackActivities,
      allowDevFallback: false,
    }),
    {
      feed: EMPTY_HOME_FEED,
      activities: [],
      usedDevFallback: false,
    },
  )

  assert.deepEqual(
    await loadHomeFeed({
      userId: null,
      deps: {},
      fallbackFeed,
      fallbackActivities,
      allowDevFallback: true,
    }),
    {
      feed: fallbackFeed,
      activities: fallbackActivities,
      usedDevFallback: true,
    },
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

function quoteSnapshot(listingId: string): QuoteSnapshot {
  return {
    subject_ref: { kind: 'listing', id: listingId },
    listing: {
      ticker: 'AAPL',
      mic: 'XNAS',
      timezone: 'America/New_York',
    },
    latest_price: 192.1,
    prev_close: 189.45,
    absolute_move: 2.65,
    percent_move: 1.4,
    currency: 'USD',
    as_of: '2026-05-05T01:03:00.000Z',
    delay_class: 'delayed_15m',
    session_state: 'regular',
    source_id: 'source-live',
  }
}

function finding(): HomeFinding {
  return {
    block: {
      id: 'home-live-finding',
      kind: 'finding_card',
      snapshot_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      data_ref: { kind: 'finding_card', id: 'home-live-finding' },
      source_refs: ['11111111-1111-4111-9111-111111111111'],
      as_of: '2026-05-05T01:01:00.000Z',
      title: 'Live finding',
      finding_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      headline: 'Service-composed finding.',
      severity: 'medium',
      subject_refs: [AAPL],
    },
    destination: { kind: 'symbol', subject_ref: AAPL },
  }
}
