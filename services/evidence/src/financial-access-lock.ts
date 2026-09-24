// Serialization between financial publication and evidence revocation.
//
// Lock rows: the `sources` and `facts` rows a publication unit bound. They are
// stable (never re-keyed) and are exactly the rows every revocation or erasure
// writer changes: invalidating a fact updates its row, changing a source's
// owner updates the source row, deleting a source (deleteSource, or a user
// erasure cascading to the user's private sources) deletes the source row.
// UPDATE and DELETE take row locks that conflict with FOR SHARE, so every one
// of those writers — including ones written later, migrations, and cascades —
// serializes with publication without having to call anything here.
//
// Canonical order: sources before facts; ascending id within each. Writers
// touch one source (and cascade to its children) or update fact rows, so this
// order cannot form a cycle with them.
//
// Outcome: a revocation that commits before the publisher takes its locks is
// seen by the publisher's in-transaction reverification and wins; one that
// starts while a publication holds its locks waits for that commit and is then
// enforced by every later read, which rechecks current access. Repeatable-read
// alone would not give this: a snapshot can still certify evidence revoked
// after the snapshot was taken.

import type { RowQueryExecutor } from "./types.ts";

export type PublicationEvidence = Readonly<{ source_ids: ReadonlyArray<string>; fact_ids: ReadonlyArray<string> }>;

/**
 * Share-locks the bound sources, then facts, in canonical order, inside the
 * caller's finalization transaction. Returns the ids that no longer exist so
 * the caller can reject before reverifying.
 */
export async function lockEvidenceForPublication(
  db: RowQueryExecutor,
  evidence: PublicationEvidence,
): Promise<{ missing_source_ids: string[]; missing_fact_ids: string[] }> {
  const sourceIds = [...new Set(evidence.source_ids)].sort();
  const factIds = [...new Set(evidence.fact_ids)].sort();
  const lockedSources = new Set((await db.query<{ source_id: string }>(
    `select source_id::text from sources where source_id = any($1::uuid[]) order by source_id for share`,
    [sourceIds],
  )).rows.map((row) => row.source_id));
  const lockedFacts = new Set((await db.query<{ fact_id: string }>(
    `select fact_id::text from facts where fact_id = any($1::uuid[]) order by fact_id for share`,
    [factIds],
  )).rows.map((row) => row.fact_id));
  return {
    missing_source_ids: sourceIds.filter((id) => !lockedSources.has(id)),
    missing_fact_ids: factIds.filter((id) => !lockedFacts.has(id)),
  };
}
