// Starts the supervised financial worker for the dev API when
// FINANCIAL_WORKER_ENABLED=true. It resumes pinned replays out of the box;
// parent features register their recovery (authority and artifact
// persistence) as they adopt financial answers. Discovery-owned runs are never
// resumed here.

import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { ParentRecovery } from "../../financial-engine/src/recovery.ts";
import { createFinancialWorker, type FinancialWorker, type WorkerPool } from "../../financial-engine/src/worker.ts";

export type FinancialWorkerEnv = {
  FINANCIAL_WORKER_ENABLED?: string;
  FINANCIAL_WORKER_INTERVAL_MS?: string;
};

export function startFinancialWorkerFromEnv(
  pool: WorkerPool,
  env: FinancialWorkerEnv,
  parents: Readonly<Partial<Record<string, ParentRecovery>>> = {},
): FinancialWorker | null {
  if (env.FINANCIAL_WORKER_ENABLED !== "true") return null;
  const interval = Number(env.FINANCIAL_WORKER_INTERVAL_MS ?? 5_000);
  const worker = createFinancialWorker({
    pool,
    worker_id: `dev-api-${process.pid}`,
    ttl_ms: 60_000,
    evidence: createEvidenceFinancialPort,
    parents,
    interval_ms: Number.isSafeInteger(interval) && interval >= 100 ? interval : 5_000,
    max_runs_per_tick: 10,
  });
  worker.start();
  return worker;
}
