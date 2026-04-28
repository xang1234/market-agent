import type { RefSegment, RefSegmentKind } from './types.ts'

export type SnapshotManifest = Readonly<Record<RefSegmentKind, Readonly<Record<string, string>>>>

export type ResolvedRefSegment =
  | { state: 'resolved'; value: string }
  | { state: 'unresolved'; segment: RefSegment }

export function createSnapshotManifest(partial: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    fact: partial.fact ?? {},
    claim: partial.claim ?? {},
    event: partial.event ?? {},
  }
}

export function resolveRefSegment(
  manifest: SnapshotManifest,
  segment: RefSegment,
): ResolvedRefSegment {
  const value = manifest[segment.ref_kind][segment.ref_id]
  if (value === undefined) {
    return { state: 'unresolved', segment }
  }
  return { state: 'resolved', value }
}
