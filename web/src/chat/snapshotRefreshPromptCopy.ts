import type { SnapshotRefreshRequiredReason } from './blockSnapshotTransform.ts'

// User-facing copy keyed by the snapshot's rejection reason. Pure mapping so
// the React component stays a thin shell and the wording is unit-testable.
const REFRESH_REQUIRED_COPY: Record<SnapshotRefreshRequiredReason, string> = {
  basis: 'The pricing basis changed. Refresh to load fresh data on the new basis.',
  normalization: 'The chart normalization changed. Refresh to recompute against fresh data.',
  peer_set: 'The peer set changed. Refresh to load fresh data for the new peer set.',
  freshness: 'This view needs fresher data than the saved snapshot. Refresh to update.',
  transform: 'This change is outside the saved snapshot. Refresh to recompute.',
}

export function snapshotRefreshPromptCopy(reason: SnapshotRefreshRequiredReason): string {
  return REFRESH_REQUIRED_COPY[reason]
}
