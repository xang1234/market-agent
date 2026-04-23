import type { QueryExecutor } from "./types.ts";

export type CitationLogInput = {
  snapshot_id: string;
  block_id: string;
  ref_kind: string;
  ref_id: string;
  source_id?: string | null;
};

export type CitationLogRow = {
  citation_log_id: string;
  created_at: Date;
};

// Writes a row to citation_logs. `snapshot_id` is required and references
// snapshots(snapshot_id) — callers must create the snapshot first.
export async function writeCitationLog(
  db: QueryExecutor,
  input: CitationLogInput,
): Promise<CitationLogRow> {
  const { rows } = await db.query<CitationLogRow>(
    `insert into citation_logs
       (snapshot_id, block_id, ref_kind, ref_id, source_id)
     values ($1, $2, $3, $4, $5)
     returning citation_log_id, created_at`,
    [input.snapshot_id, input.block_id, input.ref_kind, input.ref_id, input.source_id ?? null],
  );
  return rows[0];
}
