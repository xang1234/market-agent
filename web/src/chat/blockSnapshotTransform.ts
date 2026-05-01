// Frontend mirror of the snapshot transform boundary in
// services/snapshot/src/snapshot-transform.ts. Drift-tested against the
// backend so a wire-format change can't ship without an explicit frontend
// update.
//
// Why this exists: an artifact added to chat carries its origin snapshot_id
// (invariant I5). When the user changes a range / interval inside the added
// block, the request must route to that block's *origin* snapshot endpoint —
// not the chat thread's latest snapshot — and an out-of-snapshot transform
// must surface as an explicit refresh prompt rather than a silent refetch
// (invariant I8).

export const SNAPSHOT_REFRESH_REQUIRED_REASONS = [
  'basis',
  'normalization',
  'peer_set',
  'freshness',
  'transform',
] as const

export type SnapshotRefreshRequiredReason = (typeof SNAPSHOT_REFRESH_REQUIRED_REASONS)[number]

export type BlockSnapshotTransformRequest = {
  kind: 'series'
  range: { start: string; end: string }
  interval: string
  basis: string
  normalization: string
  subject_refs: ReadonlyArray<{ kind: string; id: string }>
}

export function buildBlockSnapshotTransformUrl(input: { snapshot_id: string }): string {
  if (typeof input.snapshot_id !== 'string' || input.snapshot_id.length === 0) {
    throw new Error('buildBlockSnapshotTransformUrl: snapshot_id must be a non-empty string')
  }
  return `/v1/snapshots/${encodeURIComponent(input.snapshot_id)}/transform`
}

export type ParsedBlockSnapshotTransformResponse =
  | { state: 'allowed' }
  | { state: 'refresh_required'; reason: SnapshotRefreshRequiredReason }
  | { state: 'unexpected_error'; status: number; body: unknown }

// Reserve refresh_required for the validated 409 envelope. 401/403/5xx and
// malformed responses get their own state so consumers can route to the
// right recovery flow (sign-in prompt, retry with backoff, status page)
// instead of misleading the user with a snapshot refresh.
export function parseBlockSnapshotTransformResponse(input: {
  status: number
  body: unknown
}): ParsedBlockSnapshotTransformResponse {
  if (input.status === 200) return { state: 'allowed' }
  if (input.status === 409 && isRefreshRequiredEnvelope(input.body)) {
    return { state: 'refresh_required', reason: input.body.refresh_required.reason }
  }
  return { state: 'unexpected_error', status: input.status, body: input.body }
}

function isRefreshRequiredEnvelope(value: unknown): value is {
  error: 'refresh_required'
  refresh_required: { reason: SnapshotRefreshRequiredReason }
} {
  if (value === null || typeof value !== 'object') return false
  const envelope = value as Record<string, unknown>
  if (envelope.error !== 'refresh_required') return false
  const inner = envelope.refresh_required
  if (inner === null || typeof inner !== 'object') return false
  const reason = (inner as Record<string, unknown>).reason
  return (
    typeof reason === 'string' &&
    (SNAPSHOT_REFRESH_REQUIRED_REASONS as ReadonlyArray<string>).includes(reason)
  )
}
