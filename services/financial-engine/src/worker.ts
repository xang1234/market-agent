// A supervised financial worker: on each tick it takes up to a bounded number
// of recoverable runs and resumes them one at a time, each on its own pinned
// connection. A failure in one run is recorded and never stops the loop; a
// lease lost to another worker is expected and simply ends that run's turn.
// The loop never overlaps itself, and stop() waits for the tick in flight.

import { snapshotTransactionClient, type SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { StaleLeaseError } from "./lease.ts";
import type { SqlExecutor } from "./ports.ts";
import { listRecoverableRuns, recoverRun, type RecoveryDeps, type RecoveryOutcome } from "./recovery.ts";

export type WorkerPool = SqlExecutor & { connect(): Promise<Parameters<typeof snapshotTransactionClient>[0]> };

export type WorkerTickEntry = RecoveryOutcome | Readonly<{ run_id: string; status: "lease_lost" | "error"; reason: string }>;

export type FinancialWorker = Readonly<{
  tick(): Promise<ReadonlyArray<WorkerTickEntry>>;
  start(): void;
  stop(): Promise<void>;
}>;

export function createFinancialWorker(input: RecoveryDeps & {
  pool: WorkerPool;
  interval_ms: number;
  max_runs_per_tick: number;
  onTick?: (entries: ReadonlyArray<WorkerTickEntry>) => void;
}): FinancialWorker {
  if (!Number.isSafeInteger(input.interval_ms) || input.interval_ms < 100) throw new RangeError("interval_ms must be at least 100");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<unknown> | null = null;
  let stopped = true;

  const tick = async (): Promise<ReadonlyArray<WorkerTickEntry>> => {
    const runs = await listRecoverableRuns(input.pool, { parent_kinds: Object.keys(input.parents), limit: input.max_runs_per_tick });
    const entries: WorkerTickEntry[] = [];
    for (const run of runs) {
      const connection = await input.pool.connect();
      const client: SnapshotTransactionClient = snapshotTransactionClient(connection);
      try {
        entries.push(await recoverRun(client, run, input));
      } catch (error) {
        entries.push(error instanceof StaleLeaseError
          ? { run_id: run.run_id, status: "lease_lost", reason: error.reason }
          : { run_id: run.run_id, status: "error", reason: error instanceof Error ? error.name : "unknown" });
      } finally {
        client.release();
      }
    }
    return entries;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick()
        .then((entries) => input.onTick?.(entries))
        .catch(() => input.onTick?.([]))
        .finally(() => {
          running = null;
          schedule();
        });
    }, input.interval_ms);
  };

  return Object.freeze({
    tick,
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  });
}
