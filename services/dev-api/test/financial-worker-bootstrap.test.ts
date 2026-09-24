import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerPool } from "../../financial-engine/src/worker.ts";
import { startFinancialWorkerFromEnv } from "../src/financial-worker-bootstrap.ts";

function fakePool(queries: string[]): WorkerPool {
  return {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [] };
    },
    connect: async () => assert.fail("no run is recoverable, so no connection is taken"),
  } as unknown as WorkerPool;
}

test("the financial worker starts only when enabled, and stops cleanly", async () => {
  const queries: string[] = [];
  assert.equal(startFinancialWorkerFromEnv(fakePool(queries), {}), null);
  assert.equal(startFinancialWorkerFromEnv(fakePool(queries), { FINANCIAL_WORKER_ENABLED: "1" }), null);

  const worker = startFinancialWorkerFromEnv(fakePool(queries), { FINANCIAL_WORKER_ENABLED: "true", FINANCIAL_WORKER_INTERVAL_MS: "100" });
  assert.ok(worker);
  while (queries.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
  await worker.stop();
  assert.match(queries[0]!, /from financial_runs/u);
  assert.match(queries[0]!, /parent_kind <> 'discovery_run'/u);
});
