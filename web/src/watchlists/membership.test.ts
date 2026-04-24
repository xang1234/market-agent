import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addManualWatchlistMember,
  listManualWatchlistMembers,
  mergeMemberIntoList,
  removeManualWatchlistMember,
  removeMemberFromList,
  type SubjectRef,
  type WatchlistMember,
} from './membership.ts'

const APPLE: SubjectRef = { kind: 'listing', id: '11111111-1111-4111-a111-111111111111' }
const MSFT: SubjectRef = { kind: 'listing', id: '22222222-2222-4222-a222-222222222222' }
const USER_ID = '00000000-0000-4000-8000-000000000001'

function fixedResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('listManualWatchlistMembers threads x-user-id and returns members', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input, init })
    return fixedResponse({ members: [{ subject_ref: APPLE, created_at: '2026-04-24T00:00:00Z' }] })
  }

  const members = await listManualWatchlistMembers({ userId: USER_ID, fetchImpl })

  assert.equal(members.length, 1)
  assert.deepEqual(members[0].subject_ref, APPLE)
  assert.equal(requests.length, 1)
  assert.equal((requests[0].init?.headers as Record<string, string>)['x-user-id'], USER_ID)
})

test('listManualWatchlistMembers throws on non-ok response', async () => {
  const fetchImpl: typeof fetch = async () => fixedResponse({ error: 'boom' }, { status: 500 })
  await assert.rejects(
    listManualWatchlistMembers({ userId: USER_ID, fetchImpl }),
    /HTTP 500/,
  )
})

test('addManualWatchlistMember posts subject_ref and parses created response', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input, init })
    return fixedResponse(
      { status: 'created', member: { subject_ref: APPLE, created_at: '2026-04-24T00:00:00Z' } },
      { status: 201 },
    )
  }

  const result = await addManualWatchlistMember({ userId: USER_ID, subject_ref: APPLE, fetchImpl })

  assert.equal(result.status, 'created')
  assert.deepEqual(result.member.subject_ref, APPLE)
  const body = JSON.parse(String(requests[0].init?.body))
  assert.deepEqual(body, { subject_ref: APPLE })
})

test('addManualWatchlistMember accepts 200 already_present without throwing', async () => {
  const fetchImpl: typeof fetch = async () =>
    fixedResponse(
      { status: 'already_present', member: { subject_ref: APPLE, created_at: '2026-04-24T00:00:00Z' } },
      { status: 200 },
    )
  const result = await addManualWatchlistMember({ userId: USER_ID, subject_ref: APPLE, fetchImpl })
  assert.equal(result.status, 'already_present')
})

test('removeManualWatchlistMember sends DELETE and tolerates 404', async () => {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(String(input) + ' ' + (init?.method ?? 'GET'))
    return new Response(null, { status: init?.method === 'DELETE' ? 404 : 500 })
  }
  await removeManualWatchlistMember({ userId: USER_ID, subject_ref: APPLE, fetchImpl })
  assert.equal(calls.length, 1)
  assert.match(calls[0], /\/listing\/11111111-1111-4111-a111-111111111111 DELETE/)
})

test('removeManualWatchlistMember throws on unexpected status', async () => {
  const fetchImpl: typeof fetch = async () => new Response(null, { status: 500 })
  await assert.rejects(
    removeManualWatchlistMember({ userId: USER_ID, subject_ref: APPLE, fetchImpl }),
    /HTTP 500/,
  )
})

test('mergeMemberIntoList appends a newly created member and dedupes already_present', () => {
  const existing: WatchlistMember[] = [{ subject_ref: APPLE, created_at: '2026-04-24T00:00:00Z' }]
  const appended = mergeMemberIntoList(existing, {
    status: 'created',
    member: { subject_ref: MSFT, created_at: '2026-04-24T00:01:00Z' },
  })
  assert.equal(appended.length, 2)
  assert.deepEqual(appended[1].subject_ref, MSFT)

  const noop = mergeMemberIntoList(appended, {
    status: 'already_present',
    member: { subject_ref: MSFT, created_at: '2026-04-24T00:01:00Z' },
  })
  assert.equal(noop.length, 2)
})

test('mergeMemberIntoList does not duplicate when the server reports created but the client already holds the ref', () => {
  const existing: WatchlistMember[] = [{ subject_ref: APPLE, created_at: '2026-04-24T00:00:00Z' }]
  const merged = mergeMemberIntoList(existing, {
    status: 'created',
    member: { subject_ref: APPLE, created_at: '2026-04-24T00:10:00Z' },
  })
  assert.equal(merged.length, 1)
})

test('removeMemberFromList removes matching ref and keeps others untouched', () => {
  const existing: WatchlistMember[] = [
    { subject_ref: APPLE, created_at: '2026-04-24T00:00:00Z' },
    { subject_ref: MSFT, created_at: '2026-04-24T00:01:00Z' },
  ]
  const next = removeMemberFromList(existing, APPLE)
  assert.equal(next.length, 1)
  assert.deepEqual(next[0].subject_ref, MSFT)
})
