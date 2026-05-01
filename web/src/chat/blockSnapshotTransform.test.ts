import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  SNAPSHOT_REFRESH_REQUIRED_REASONS,
  buildBlockSnapshotTransformUrl,
  parseBlockSnapshotTransformResponse,
} from './blockSnapshotTransform.ts'

const ANALYZE_SNAPSHOT = '11111111-1111-4111-8111-111111111111'
const CHAT_THREAD_SNAPSHOT = '22222222-2222-4222-8222-222222222222'

test('buildBlockSnapshotTransformUrl routes through the block.snapshot_id, not the chat thread snapshot', () => {
  // The whole point of invariant I5: an added artifact's transforms must hit
  // the artifact's origin snapshot, even when the surrounding chat message
  // belongs to a different (chat-thread) snapshot.
  const url = buildBlockSnapshotTransformUrl({ snapshot_id: ANALYZE_SNAPSHOT })
  assert.equal(url, `/v1/snapshots/${ANALYZE_SNAPSHOT}/transform`)
  assert.notEqual(url, `/v1/snapshots/${CHAT_THREAD_SNAPSHOT}/transform`)
})

test('buildBlockSnapshotTransformUrl rejects an empty snapshot_id rather than producing a malformed URL', () => {
  assert.throws(() => buildBlockSnapshotTransformUrl({ snapshot_id: '' }), /snapshot_id/)
})

test('buildBlockSnapshotTransformUrl percent-encodes the snapshot_id segment', () => {
  // Defense-in-depth: snapshot_ids are UUIDs in practice, but never trust
  // an opaque server-supplied id when interpolating into a URL.
  const url = buildBlockSnapshotTransformUrl({ snapshot_id: 'snap/with spaces' })
  assert.equal(url, '/v1/snapshots/snap%2Fwith%20spaces/transform')
})

test('buildBlockSnapshotTransformUrl matches the backend route path', () => {
  // Fix-of-record: an earlier draft shipped /v1/snapshot/ (singular) and
  // would have broken every transform request. Pin the path to the backend
  // route regex so the singular/plural drift can't recur.
  const httpSource = readFileSync(
    new URL('../../../services/snapshot/src/http.ts', import.meta.url),
    'utf8',
  )
  const routeMatch = httpSource.match(/\\\/v1\\\/(snapshots?)\\\/[^\s]+\\\/transform/)
  assert.ok(routeMatch, 'expected snapshot transform route regex in services/snapshot/src/http.ts')
  const url = buildBlockSnapshotTransformUrl({ snapshot_id: ANALYZE_SNAPSHOT })
  assert.ok(
    url.startsWith(`/v1/${routeMatch[1]}/`),
    `frontend URL ${url} must start with /v1/${routeMatch[1]}/ to match backend route`,
  )
})

test('parseBlockSnapshotTransformResponse maps a 200 to allowed', () => {
  const parsed = parseBlockSnapshotTransformResponse({ status: 200, body: {} })
  assert.deepEqual(parsed, { state: 'allowed' })
})

test('parseBlockSnapshotTransformResponse extracts the reason from a 409 refresh_required envelope', () => {
  // Each rejection reason from the snapshot boundary must round-trip into a
  // distinct refresh prompt — the user needs to know whether to re-run for
  // freshness, peer-set change, etc.
  for (const reason of SNAPSHOT_REFRESH_REQUIRED_REASONS) {
    const parsed = parseBlockSnapshotTransformResponse({
      status: 409,
      body: { error: 'refresh_required', refresh_required: { reason } },
    })
    assert.deepEqual(parsed, { state: 'refresh_required', reason })
  }
})

test('parseBlockSnapshotTransformResponse maps unexpected statuses (401/403/5xx) to unexpected_error, not refresh_required', () => {
  // Conflating auth failures or server outages with snapshot refresh would
  // route users to the wrong recovery flow. Reserve refresh_required for
  // the validated 409 envelope only.
  assert.deepEqual(
    parseBlockSnapshotTransformResponse({ status: 500, body: 'oops' }),
    { state: 'unexpected_error', status: 500, body: 'oops' },
  )
  assert.deepEqual(
    parseBlockSnapshotTransformResponse({ status: 401, body: { error: 'unauthorized' } }),
    { state: 'unexpected_error', status: 401, body: { error: 'unauthorized' } },
  )
})

test('parseBlockSnapshotTransformResponse maps a 409 with a malformed envelope to unexpected_error', () => {
  // 409 alone isn't enough — only the validated refresh_required envelope
  // should produce a refresh prompt. A 409 with a bogus body is a wire-format
  // break, not a snapshot rejection.
  assert.deepEqual(
    parseBlockSnapshotTransformResponse({ status: 409, body: null }),
    { state: 'unexpected_error', status: 409, body: null },
  )
  assert.deepEqual(
    parseBlockSnapshotTransformResponse({
      status: 409,
      body: { error: 'refresh_required', refresh_required: { reason: 'made_up_reason' } },
    }),
    {
      state: 'unexpected_error',
      status: 409,
      body: { error: 'refresh_required', refresh_required: { reason: 'made_up_reason' } },
    },
  )
})

test('SNAPSHOT_REFRESH_REQUIRED_REASONS mirrors the backend SnapshotRefreshRequiredReason union', () => {
  // Drift test: scan the backend type declaration. If the backend adds a new
  // refresh reason, this fails until the frontend mirrors it. Same pattern
  // as sseEventTypes.test.ts.
  const backendSource = readFileSync(
    new URL('../../../services/snapshot/src/snapshot-transform.ts', import.meta.url),
    'utf8',
  )
  const match = backendSource.match(/export type SnapshotRefreshRequiredReason\s*=([^;]+);/)
  assert.ok(match, 'expected SnapshotRefreshRequiredReason union in snapshot-transform.ts')
  const backendReasons = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
  const frontendReasons = [...SNAPSHOT_REFRESH_REQUIRED_REASONS].sort()
  assert.deepEqual(
    frontendReasons,
    backendReasons,
    `frontend SNAPSHOT_REFRESH_REQUIRED_REASONS must match backend SnapshotRefreshRequiredReason — backend: [${backendReasons.join(', ')}], frontend: [${frontendReasons.join(', ')}]`,
  )
})
