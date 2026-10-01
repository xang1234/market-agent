import type { QueryResult } from "pg";
import type { SealedSnapshot } from "../../snapshot/src/snapshot-sealer.ts";

// Adapts a hand-written fake to the generic `query<R>()` signature the
// repositories declare (a full pg QueryResult). The fake decides which rows
// come back; asserting them as R[] is the test double's contract, kept in
// this one place.
type FakeResult = { rows: unknown[]; rowCount?: number | null };

export function fakePgQuery(
  handler: (text: string, values?: unknown[]) => FakeResult | Promise<FakeResult>,
) {
  return async <R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> => {
    const result = await handler(text, values);
    return { command: "", oid: 0, fields: [], rowCount: result.rowCount ?? null, rows: result.rows as R[] };
  };
}

// A well-formed sealed snapshot for fakes whose seal always succeeds.
export function sealedSnapshot(snapshotId: string): SealedSnapshot {
  return {
    snapshot_id: snapshotId,
    subject_refs: [],
    fact_refs: [],
    claim_refs: [],
    event_refs: [],
    document_refs: [],
    series_specs: [],
    source_ids: [],
    tool_call_ids: [],
    tool_call_result_hashes: [],
    as_of: "2026-05-06T00:00:00.000Z",
    basis: "reported",
    normalization: "raw",
    coverage_start: null,
    allowed_transforms: {},
    model_version: "test",
    parent_snapshot: null,
    created_at: "2026-05-06T00:00:00.000Z",
  };
}
