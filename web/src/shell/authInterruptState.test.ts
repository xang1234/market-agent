import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePendingProtectedAction,
  planPendingProtectedActionResume,
  serializePendingProtectedAction,
  type PendingProtectedAction,
} from './authInterruptState.ts'

const pendingAction: PendingProtectedAction = {
  title: 'Sign in to save to watchlist',
  description: 'Watchlists are session-scoped.',
  returnTo: '/home',
  action: {
    kind: 'save-to-watchlist',
    symbol: 'AAPL',
  },
}

test('serialize/parse round-trips pending protected actions', () => {
  const serialized = serializePendingProtectedAction(pendingAction)
  const parsed = parsePendingProtectedAction(serialized)

  assert.deepEqual(parsed, pendingAction)
})

test('parsePendingProtectedAction rejects invalid payloads', () => {
  assert.equal(parsePendingProtectedAction('{"action":{"kind":"unknown"}}'), null)
  assert.equal(parsePendingProtectedAction('{"returnTo":"/home"}'), null)
  assert.equal(parsePendingProtectedAction('not-json'), null)
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
