import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_COVERAGE, DEFAULT_LIMITS } from "../src/policy.ts";
import type { Lease, WorkerDeps } from "../src/ports.ts";
import type { RunRecord } from "../src/types.ts";
import { runDiscoveryWorker } from "../src/worker.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const FIRST_RUN_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_RUN_ID = "20000000-0000-4000-8000-000000000002";

test("continues claiming work after an individual run fails", async () => {
  const controller = new AbortController();
  const claimed: string[] = [];
  const finalized: string[] = [];
  const repo = {
    async claimNextRun(workerId: string): Promise<Lease | null> {
      const runId = claimed.length === 0 ? FIRST_RUN_ID : SECOND_RUN_ID;
      claimed.push(runId);
      if (runId === SECOND_RUN_ID) controller.abort();
      return { run_id: runId, user_id: USER_ID, worker_id: workerId, epoch: 1, expires_at: "2026-09-10T12:01:30.000Z" };
    },
    async readRun(_userId: string, runId: string) { return run(runId); },
    async getBrief() { throw new Error("malformed persisted brief"); },
    async candidates() { return []; },
    async finalize(lease: Lease) { finalized.push(lease.run_id); },
  } as unknown as WorkerDeps["repo"];
  const deps = { repo, clock: () => new Date("2026-09-10T12:00:00.000Z") } as unknown as WorkerDeps;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await runDiscoveryWorker(deps, { signal: controller.signal, pollMs: 1 });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(finalized, [FIRST_RUN_ID]);
  assert.deepEqual(claimed, [FIRST_RUN_ID, SECOND_RUN_ID]);
});

function run(runId: string): RunRecord {
  return {
    run_id: runId,
    campaign_id: "30000000-0000-4000-8000-000000000001",
    brief_id: "40000000-0000-4000-8000-000000000001",
    user_id: USER_ID,
    status: "running",
    stage: "discovery",
    policy_version: "discovery-v1",
    request_key: "50000000-0000-4000-8000-000000000001",
    model_config: [],
    limits: DEFAULT_LIMITS,
    usage: { search: 0, document: 0, identity: 0, financial: 0, model: 0 },
    coverage: structuredClone(EMPTY_COVERAGE),
    started_at: "2026-09-10T12:00:00.000Z",
    finished_at: null,
    cancel_requested_at: null,
    created_at: "2026-09-10T12:00:00.000Z",
  };
}
