// Canonical metric_key -> metric_id resolution against the metrics dimension
// table. Fact writers (the analyze materializers) resolve the metric ids they
// mint facts against through here rather than each rolling its own query.

import type { QueryExecutor } from "./types.ts";

// Resolve a batch of metric_keys to their metric_ids in one query. Keys with no
// row are simply absent from the map; callers decide whether a miss is fatal.
export async function resolveMetricIds(
  db: QueryExecutor,
  keys: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> {
  if (keys.length === 0) return new Map();
  const { rows } = await db.query<{ metric_key: string; metric_id: string }>(
    `select metric_key, metric_id::text as metric_id
       from metrics
      where metric_key = any($1::text[])`,
    [[...keys]],
  );
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.metric_key, row.metric_id);
  return map;
}
