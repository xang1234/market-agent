import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTH_INTERRUPT_SCHEMA_VERSION,
  AUTH_INTERRUPT_TTL_MS,
  ProtectedActionType,
  planProtectedActionResumeDispatch,
  parsePendingProtectedAction,
  planPendingProtectedActionResume,
  serializePendingProtectedAction,
  type PendingProtectedAction,
} from './authInterruptState.ts'

const pendingAction: PendingProtectedAction = {
  schemaVersion: AUTH_INTERRUPT_SCHEMA_VERSION,
  title: 'Sign in to save to watchlist',
  description: 'Watchlists are session-scoped.',
  returnTo: {
    pathname: '/home',
    search: '',
    hash: '',
  },
  createdAt: 1_000,
  expiresAt: 1_000 + AUTH_INTERRUPT_TTL_MS,
  action: {
    actionType: ProtectedActionType.SaveToWatchlist,
    payload: {
      symbol: 'AAPL',
    },
  },
}

test('serialize/parse round-trips versioned pending protected actions', () => {
  const serialized = serializePendingProtectedAction(pendingAction)
  const parsed = parsePendingProtectedAction(serialized, { now: 1_000 })

  assert.deepEqual(parsed, pendingAction)
})

test('serialized pending protected actions use durable route and typed payload fields', () => {
  const serialized = serializePendingProtectedAction(pendingAction)
  const parsed = JSON.parse(serialized)

  assert.equal(parsed.schemaVersion, AUTH_INTERRUPT_SCHEMA_VERSION)
  assert.deepEqual(parsed.returnTo, {
    pathname: '/home',
    search: '',
    hash: '',
  })
  assert.deepEqual(parsed.action, {
    actionType: ProtectedActionType.SaveToWatchlist,
    payload: {
      symbol: 'AAPL',
    },
  })
  assert.equal(parsed.createdAt, 1_000)
  assert.equal(parsed.expiresAt, 1_000 + AUTH_INTERRUPT_TTL_MS)
})

test('parsePendingProtectedAction rejects invalid payloads', () => {
  assert.equal(parsePendingProtectedAction('{"action":{"kind":"unknown"}}'), null)
  assert.equal(parsePendingProtectedAction('{"returnTo":"/home"}'), null)
  assert.equal(
    parsePendingProtectedAction(
      '{"schemaVersion":1,"title":"Sign in","returnTo":{"pathname":"//evil.com","search":"","hash":""},"createdAt":1000,"expiresAt":2000,"action":{"actionType":"save-to-watchlist","payload":{"symbol":"AAPL"}}}',
      { now: 1_000 },
    ),
    null,
  )
  assert.equal(
    parsePendingProtectedAction(
      '{"schemaVersion":1,"title":"Sign in","returnTo":{"pathname":"/home","search":"?ok=1","hash":"https://evil.com"},"createdAt":1000,"expiresAt":2000,"action":{"actionType":"save-to-watchlist","payload":{"symbol":"AAPL"}}}',
      { now: 1_000 },
    ),
    null,
  )
  assert.equal(parsePendingProtectedAction('not-json'), null)
})

test('parsePendingProtectedAction rejects stale pending actions', () => {
  const serialized = serializePendingProtectedAction(pendingAction)

  assert.equal(
    parsePendingProtectedAction(serialized, { now: 1_000 + AUTH_INTERRUPT_TTL_MS + 1 }),
    null,
  )
})

test('resume plan dispatches immediately when already at returnTo path', () => {
  const plan = planPendingProtectedActionResume({
    currentPath: '/home',
    hasSession: true,
    pending: pendingAction,
  })

  assert.deepEqual(plan, {
    type: 'dispatch',
    action: pendingAction.action,
  })
})

test('resume plan navigates when auth returns on a different route', () => {
  const plan = planPendingProtectedActionResume({
    currentPath: '/auth/callback',
    hasSession: true,
    pending: pendingAction,
  })

  assert.deepEqual(plan, {
    type: 'navigate',
    to: '/home',
    action: pendingAction.action,
  })
})

test('resume plan does nothing without both session and pending action', () => {
  assert.deepEqual(
    planPendingProtectedActionResume({
      currentPath: '/home',
      hasSession: false,
      pending: pendingAction,
    }),
    { type: 'idle' },
  )

  assert.deepEqual(
    planPendingProtectedActionResume({
      currentPath: '/home',
      hasSession: true,
      pending: null,
    }),
    { type: 'idle' },
  )
})

test('planned resume dispatch skips duplicate path/action pairs', () => {
  const first = planProtectedActionResumeDispatch(null, '/home', pendingAction.action)
  assert.deepEqual(first, {
    shouldDispatch: true,
    resumeKey:
      '/home\u0000{"actionType":"save-to-watchlist","payload":{"symbol":"AAPL"}}',
  })

  const second = planProtectedActionResumeDispatch(
    first.resumeKey,
    '/home',
    pendingAction.action,
  )
  assert.deepEqual(second, {
    shouldDispatch: false,
    resumeKey:
      '/home\u0000{"actionType":"save-to-watchlist","payload":{"symbol":"AAPL"}}',
  })
})

test('planned resume dispatch allows distinct path/action pairs', () => {
  const first = planProtectedActionResumeDispatch(null, '/home', pendingAction.action)
  const second = planProtectedActionResumeDispatch(
    first.resumeKey,
    '/chat/abc123',
    pendingAction.action,
  )

  assert.equal(second.shouldDispatch, true)
  assert.equal(
    second.resumeKey,
    '/chat/abc123\u0000{"actionType":"save-to-watchlist","payload":{"symbol":"AAPL"}}',
  )
})
