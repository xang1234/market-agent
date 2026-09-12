import { randomUUID } from "node:crypto";

import type { WorkerDeps } from "./ports.ts";
import { executeDiscoveryRun } from "./runner.ts";

export async function runDiscoveryWorker(deps: WorkerDeps, options: { signal: AbortSignal; pollMs: number }): Promise<void> {
  const workerId = `discovery:${process.pid}:${randomUUID()}`;
  while (!options.signal.aborted) {
    const lease = await deps.repo.claimNextRun(workerId);
    if (lease === null) {
      await waitForPoll(options.signal, options.pollMs);
      continue;
    }
    await executeDiscoveryRun(deps, lease, options.signal);
  }
}

function waitForPoll(signal: AbortSignal, pollMs: number): Promise<void> {
  if (!Number.isFinite(pollMs) || pollMs < 1) throw new Error("pollMs must be positive");
  return new Promise((resolve) => {
    const timeout = setTimeout(done, pollMs);
    const abort = () => done();
    function done() { clearTimeout(timeout); signal.removeEventListener("abort", abort); resolve(); }
    signal.addEventListener("abort", abort, { once: true });
  });
}
