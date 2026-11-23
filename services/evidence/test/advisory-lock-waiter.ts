import { setTimeout as delay } from "node:timers/promises";

import type { QueryExecutor } from "../src/types.ts";

// Resolves once some session waits on an advisory lock, such as an ingest
// queued behind another transaction's blob lock.
export async function waitForAdvisoryLockWaiter(db: QueryExecutor): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const { rows: [row] } = await db.query<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`);
    if (row!.n > 0) return;
    await delay(10);
  }
  throw new Error("no session waited on an advisory lock");
}
