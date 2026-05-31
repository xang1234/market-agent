import type { QueryResult } from "pg";

import type { QueryExecutor } from "../src/types.ts";

export type RecordingQueryTarget = "pool" | "tx";

export type RecordingPoolExecutor = Readonly<{
  db: QueryExecutor & { connect(): Promise<QueryExecutor & { release(destroy?: boolean): void }> };
  poolQueries: string[];
  txQueries: string[];
  releases: unknown[];
}>;

export function recordingPoolExecutor(
  query: <R extends Record<string, unknown>>(
    target: RecordingQueryTarget,
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<R>> | QueryResult<R>,
): RecordingPoolExecutor {
  const poolQueries: string[] = [];
  const txQueries: string[] = [];
  const releases: unknown[] = [];
  const tx: QueryExecutor & { release(destroy?: boolean): void } = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      txQueries.push(text);
      return query<R>("tx", text, values);
    },
    release(destroy?: boolean) {
      releases.push(destroy);
    },
  };
  const db: RecordingPoolExecutor["db"] = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      poolQueries.push(text);
      return query<R>("pool", text, values);
    },
    async connect() {
      return tx;
    },
  };
  return Object.freeze({ db, poolQueries, txQueries, releases });
}
