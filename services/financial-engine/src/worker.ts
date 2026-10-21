// A supervised financial worker: on each tick it takes up to a bounded number
// of recoverable runs and resumes them one at a time, each on its own pinned
// connection. A failure in one run is recorded and never stops the loop. A
// defect is logged as an error; a routine failure, such as a lease lost to
// another worker, as a warning.
// The loop never overlaps itself, and stop() waits for the tick in flight.

import { StaleLeaseError } from "./lease.ts";
import type { FinancialPool } from "./ports.ts";
import { isRoutinePublicationFailure } from "./publish.ts";
import { listRecoverableRuns, recoverRun, type RecoveryDeps, type RecoveryOutcome } from "./recovery.ts";
import { withPinnedClient } from "./transaction.ts";

export type WorkerPool = FinancialPool;

export type WorkerTickEntry = RecoveryOutcome | Readonly<{ run_id: string; status: "lease_lost" | "error"; reason: string }>;

export type FinancialWorker = Readonly<{
  tick(): Promise<ReadonlyArray<WorkerTickEntry>>;
  start(): void;
  /** Stops scheduling and waits for the tick in flight, at most `timeoutMs`; an abandoned tick's lease expires and recovery resumes it. */
  stop(options?: { timeoutMs?: number }): Promise<void>;
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
      await withPinnedClient(input.pool, async (client, lost) => {
        try {
          entries.push(await recoverRun(client, run, input));
        } catch (error) {
          if (isRoutinePublicationFailure(error, lost())) {
            console.warn(`[financial-engine] recovery stopped for ${run.parent_kind} run ${run.run_id}`, lost() ?? error);
          } else {
            console.error(`[financial-engine] recovery failed for ${run.parent_kind} run ${run.run_id}`, error);
          }
          entries.push(error instanceof StaleLeaseError
            ? { run_id: run.run_id, status: "lease_lost", reason: error.reason }
            : { run_id: run.run_id, status: "error", reason: error instanceof Error ? error.name : "unknown" });
        }
      });
    }
    return entries;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick()
        .then((entries) => input.onTick?.(entries))
        .catch((error: unknown) => {
          console.warn("[financial-engine] recovery tick failed", error);
          input.onTick?.([]);
        })
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
    async stop(options = {}) {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (options.timeoutMs === undefined) {
        await running;
        return;
      }
      let deadline: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([running, new Promise<void>((resolve) => { deadline = setTimeout(resolve, options.timeoutMs); })]);
      clearTimeout(deadline);
    },
  });
}
