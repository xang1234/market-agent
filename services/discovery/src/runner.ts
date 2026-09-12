import { rankedDecisions, reconciledCoverage, executeStages, type StageOutcome } from "./stages.ts";
import type { Lease, WorkerDeps } from "./ports.ts";
import { DiscoveryError } from "./types.ts";

const HEARTBEAT_MS = 20_000;

export async function executeDiscoveryRun(deps: WorkerDeps, lease: Lease, signal: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let heartbeatFailure: unknown = null;
  let heartbeating = false;
  const heartbeat = async () => {
    if (heartbeating || combined.aborted) return;
    heartbeating = true;
    try { await deps.repo.heartbeat(lease); }
    catch (error) { heartbeatFailure = error; controller.abort(error); }
    finally { heartbeating = false; }
  };
  const timer = setInterval(() => { void heartbeat(); }, HEARTBEAT_MS);
  let outcome: StageOutcome | null = null;
  try {
    outcome = await executeStages(deps, lease, combined);
    if (signal.aborted || heartbeatFailure !== null) return;
    const candidates = await deps.repo.candidates(lease.user_id, lease.run_id);
    await deps.repo.finalize(lease, { status: outcome.status, decisions: rankedDecisions(candidates), coverage: outcome.coverage });
  } catch (error) {
    if (signal.aborted || heartbeatFailure !== null || isLeaseLost(error) || isInProgress(error)) return;
    const status = isCancelled(error) ? "cancelled" : isPartial(error) ? "partial" : "failed";
    try {
      const candidates = await deps.repo.candidates(lease.user_id, lease.run_id);
      const run = await deps.repo.readRun(lease.user_id, lease.run_id);
      await deps.repo.finalize(lease, {
        status: outcome?.status ?? status,
        decisions: rankedDecisions(candidates),
        coverage: outcome?.coverage ?? reconciledCoverage(run.coverage, candidates),
      });
    } catch (finalizeError) {
      if (!isLeaseLost(finalizeError)) throw finalizeError;
    }
    if (outcome === null && status === "failed") throw error;
  } finally {
    clearInterval(timer);
  }
}

function isLeaseLost(error: unknown): boolean { return error instanceof DiscoveryError && error.code === "lease_lost"; }
function isInProgress(error: unknown): boolean { return error instanceof DiscoveryError && error.code === "operation_in_progress"; }
function isCancelled(error: unknown): boolean { return error instanceof DiscoveryError && error.code === "cancelled"; }
function isPartial(error: unknown): boolean {
  return error instanceof DiscoveryError && (error.code === "budget_exhausted" || error.code === "deadline_exceeded");
}
