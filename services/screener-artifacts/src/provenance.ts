import { randomUUID } from "node:crypto";
import type { QueryExecutor } from "./types.ts";

// The provider string for both seeded source rows (reference_data + market_data).
export const ARTIFACT_PROVIDER = "xang1234_stock_screener";

// Resolves the seeded source_id for a (provider, kind). The row is seeded with a
// fixed UUID in db/seed/sources.sql; resolving by provider+kind avoids hard-coding
// that UUID here. Fails fast if the seed is missing.
export async function resolveSourceId(
  db: QueryExecutor,
  selector: { provider: string; kind: string },
): Promise<string> {
  const result = await db.query<{ source_id: string }>(
    `select source_id::text as source_id
       from sources
      where provider = $1 and kind = $2::source_kind
      order by created_at asc
      limit 1`,
    [selector.provider, selector.kind],
  );
  const sourceId = result.rows[0]?.source_id;
  if (!sourceId) {
    throw new Error(`no source registered for provider=${selector.provider} kind=${selector.kind}`);
  }
  return sourceId;
}

// Loads metric_key → metric_id for the mapped metric set. Fails fast if the
// registry is missing any key the fact-mapper can emit — a missing seed would
// otherwise silently drop those facts.
export async function loadMetricIds(
  db: QueryExecutor,
  metricKeys: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const result = await db.query<{ metric_key: string; metric_id: string }>(
    `select metric_key, metric_id::text as metric_id
       from metrics
      where metric_key = any($1::text[])`,
    [[...metricKeys]],
  );
  const byKey = new Map(result.rows.map((row) => [row.metric_key, row.metric_id]));
  const missing = metricKeys.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    throw new Error(`missing metric registry rows for: ${missing.join(", ")}`);
  }
  return byKey;
}

export function newIngestionBatchId(): string {
  return randomUUID();
}
