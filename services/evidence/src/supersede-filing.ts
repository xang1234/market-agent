import type { QueryExecutor } from "./types.ts";

// The claim predicate a filing's source produces: an exact value (Form 4 mints one
// "insider.transaction" claim) or a dotted prefix (a 13F mints many
// "position_change.<kind>" claims). Kept as a typed choice so callers can't pass a raw
// SQL fragment.
export type ClaimPredicateMatch = { equals: string } | { prefix: string };

export type SupersededArtifactCounts = { claims: number; events: number; documents: number };

// Retire the derived artifacts of a superseded filing, given the source(s) that produced
// it (each filing mints its own source, so source-scoping targets exactly that filing's
// rows). The three steps are the shared tail of every per-filing supersession — Form 4/A
// and 13F-HR/A both need them identically; only the claim predicate and event type differ:
//   - SOFT-supersede the material claims (stamp superseded_at, idempotent) rather than
//     deleting, because a sealed snapshot may cite a claim_id in snapshots.claim_refs:
//     keeping the row lets rehydration-by-id still find it (no verifier missing_claim_ref),
//     while fresh subject->claims selection filters `superseded_at is null`.
//   - HARD-delete the per-filing events (event_subjects cascade); source_ids is a jsonb
//     array of source UUIDs, so match events referencing any superseded source.
//   - Mark the document(s) superseded (bytes/source retained) so a now-claimless document
//     is explained rather than mislabeled 'parsed'.
// Call inside the filing's ingest transaction so the supersede + re-insert are atomic.
export async function supersedeFilingArtifacts(
  db: QueryExecutor,
  spec: { sourceIds: readonly string[]; claimPredicate: ClaimPredicateMatch; eventType: string },
): Promise<SupersededArtifactCounts> {
  // predicateClause is one of two fixed internal strings (never caller text); the value
  // is bound as $2.
  const predicateClause = "equals" in spec.claimPredicate ? "predicate = $2" : "predicate like $2";
  const predicateArg = "equals" in spec.claimPredicate ? spec.claimPredicate.equals : `${spec.claimPredicate.prefix}.%`;
  const sourceIds = [...spec.sourceIds];

  const claims = await db.query(
    `update claims set superseded_at = now()
      where ${predicateClause}
        and reported_by_source_id = any($1::uuid[])
        and superseded_at is null`,
    [sourceIds, predicateArg],
  );
  const events = await db.query(
    `delete from events
      where event_type = $2
        and exists (
          select 1 from jsonb_array_elements_text(source_ids) sid where sid = any($1::text[])
        )`,
    [sourceIds, spec.eventType],
  );
  const documents = await db.query(
    `update documents set parse_status = 'superseded'
      where source_id = any($1::uuid[]) and parse_status <> 'superseded'`,
    [sourceIds],
  );
  return {
    claims: claims.rowCount ?? 0,
    events: events.rowCount ?? 0,
    documents: documents.rowCount ?? 0,
  };
}
