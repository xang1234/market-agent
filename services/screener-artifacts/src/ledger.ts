import type { QueryExecutor } from "./types.ts";

export type LedgerKey = { releaseTag: string; market: string; sha256: string };

export type LedgerStatus = "succeeded" | "partial" | "failed";

export type LedgerEntry = {
  provider: string;
  releaseTag: string;
  market: string;
  schemaVersion: string;
  bundleAssetName: string;
  sha256: string;
  asOfDate: string; // YYYY-MM-DD
  sourceId: string;
  ingestionBatchId: string;
  rowsTotal: number;
  rowsIngested: number;
  rowsSkipped: number;
  status: LedgerStatus;
  startedAt: string; // ISO-8601
  finishedAt: string; // ISO-8601
};

// True when this exact bundle (by upstream sha256) has already been processed to
// completion. A `failed` run (0 rows ingested) is NOT treated as ingested, so it
// can be retried; a `partial` run (a few rows skipped) counts as done.
export async function isAlreadyIngested(db: QueryExecutor, key: LedgerKey): Promise<boolean> {
  const result = await db.query(
    `select 1
       from artifact_ingestion_ledger
      where release_tag = $1 and market = $2 and sha256 = $3 and status <> 'failed'
      limit 1`,
    [key.releaseTag, key.market, key.sha256],
  );
  return result.rows.length > 0;
}

// Records the run. Upserts on (release_tag, market, sha256) so a retried run (e.g.
// after a `failed` outcome, or `--force`) overwrites the prior ledger row rather
// than colliding with the unique constraint.
export async function writeLedgerEntry(db: QueryExecutor, entry: LedgerEntry): Promise<void> {
  await db.query(
    `insert into artifact_ingestion_ledger
       (provider, release_tag, market, schema_version, bundle_asset_name, sha256,
        as_of_date, source_id, ingestion_batch_id, rows_total, rows_ingested,
        rows_skipped, status, started_at, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (release_tag, market, sha256) do update
        set bundle_asset_name = excluded.bundle_asset_name,
            schema_version = excluded.schema_version,
            as_of_date = excluded.as_of_date,
            source_id = excluded.source_id,
            ingestion_batch_id = excluded.ingestion_batch_id,
            rows_total = excluded.rows_total,
            rows_ingested = excluded.rows_ingested,
            rows_skipped = excluded.rows_skipped,
            status = excluded.status,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at`,
    [
      entry.provider,
      entry.releaseTag,
      entry.market,
      entry.schemaVersion,
      entry.bundleAssetName,
      entry.sha256,
      entry.asOfDate,
      entry.sourceId,
      entry.ingestionBatchId,
      entry.rowsTotal,
      entry.rowsIngested,
      entry.rowsSkipped,
      entry.status,
      entry.startedAt,
      entry.finishedAt,
    ],
  );
}
