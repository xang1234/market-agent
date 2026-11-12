// One request from a parent feature to the engine: resume the plan an earlier
// attempt reserved or plan anew, then reserve, lease, execute, and publish —
// every surface the same way, with one list of reasons a request did not
// publish. A defect is not one of those reasons: it is logged with the request
// it hit and rethrown, so the surface reports a failure. Surfaces supply only
// their authority, how to plan, and how to write their artifact in the
// finalization transaction; they read back their own committed records
// afterwards.

import { AsyncLocalStorage } from "node:async_hooks";

import type { FinancialPlan, FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "./finalize.ts";
import { acquireLease, releaseLease, type AcquireLeaseResult } from "./lease.ts";
import { PlanningModelError, type Clarification, type PlanningResult } from "./planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "./ports.ts";
import { driveLeasedRun, isRoutinePublicationFailure, type DriveReport } from "./publish.ts";
import { findPlanForRequest, reserveRun } from "./run-repo.ts";
import { withPinnedClient } from "./transaction.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";

const LEASE_TTL_MS = 120_000;

/** Why a request did not publish; surfaces word these, they never invent their own. */
export type RequestGap =
  | "planning_unavailable"
  | "unsupported"
  | "configuration_needed"
  | "request_conflict"
  | "run_in_progress"
  | "run_cancelled"
  | "run_failed"
  | "parent_authority_required"
  | "publication_failed";

export type RequestOutcome =
  /** The run was driven; `report` is null when an earlier attempt already completed it. */
  | Readonly<{ status: "driven"; run_id: string; report: DriveReport | null }>
  | Readonly<{ status: "clarification"; clarification: Clarification }>
  | Readonly<{ status: "gap"; reason: RequestGap }>;

export type FinancialRequest = Readonly<{
  authority: FinancialRuntimeAuthority;
  request_key: string;
  /** Called only when no earlier attempt reserved a plan for this request. */
  plan: (db: SqlExecutor) => Promise<PlanningResult>;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  persistParent: PersistParentArtifact;
  /**
   * Awaited once this attempt holds the run's lease, before the run is
   * driven: what the parent artifact needs from outside the database is ready
   * before finalization opens its transaction. A rejection is a defect.
   */
  beforeDrive?: () => Promise<unknown>;
}>;

/** A caller's stop of the requests it makes: one stopped takes no lease, and gives up the one it holds when the stop comes. */
export type RequestStop = Readonly<{
  stopped: boolean;
  /** Registers `release` to run when the caller stops, which awaits it; returns a function that unregisters it. */
  onStop(release: () => Promise<void>): () => void;
}>;

const callerStop = new AsyncLocalStorage<RequestStop>();

/** Runs `fn` with every request it publishes, including from async work it starts, answering to `stop`. */
export function withRequestStop<T>(stop: RequestStop, fn: () => T): T {
  return callerStop.run(stop, fn);
}

export async function publishRequest(pool: FinancialPool, request: FinancialRequest): Promise<RequestOutcome> {
  const stop = callerStop.getStore();
  return withPinnedClient(pool, async (client, lost) => {
    let plan = await findPlanForRequest(client, request);
    if (!plan) {
      const planned = await planOrGap(client, request);
      if (planned.status !== "planned") return planned;
      plan = planned.plan;
    }
    try {
      return await reserveAndDrive(pool, client, request, plan, stop);
    } catch (error) {
      // A stopped request's fence refusing its writes, or its parent refusing the save, is the stop working.
      if (stop?.stopped && isRoutinePublicationFailure(error, lost())) return { status: "gap", reason: "run_cancelled" };
      // A finalization that rolled back leaves units computed and the run checkpointed: a retry or recovery finishes it.
      if (isRoutinePublicationFailure(error, lost())) {
        console.warn(`[financial-engine] publication stopped for ${requestName(request)}`, lost() ?? error);
        return { status: "gap", reason: "publication_failed" };
      }
      console.error(`[financial-engine] publication failed for ${requestName(request)}`, error);
      throw error;
    }
  });
}

/**
 * Reserves the run for the request key (or finds the one an earlier attempt
 * reserved), leases it, and drives it to published units. A retry after a
 * commit the caller never heard about lands on a completed run or on existing
 * units, never on a second publication.
 */
async function reserveAndDrive(
  pool: FinancialPool,
  client: SnapshotTransactionClient,
  request: FinancialRequest,
  plan: FinancialPlan,
  stop: RequestStop | undefined,
): Promise<RequestOutcome> {
  const reserved = await reserveRun(client, { authority: request.authority, request_key: request.request_key, plan });
  if (reserved.status === "conflict") return { status: "gap", reason: "request_conflict" };
  const { run } = reserved;
  if (run.execution_state === "completed") return { status: "driven", run_id: run.run_id, report: null };
  if (run.execution_state === "failed") return { status: "gap", reason: "run_failed" };
  if (run.execution_state === "cancelled" || stop?.stopped) return { status: "gap", reason: "run_cancelled" };
  const acquiring = acquireLease(client, {
    authority: request.authority,
    run_id: run.run_id,
    worker_id: `${request.authority.feature.surface}-${process.pid}`,
    ttl_ms: LEASE_TTL_MS,
  });
  // A stop gives the lease up at once, on its own connection since the drive's
  // may be mid-transaction: the drive's next write then fails its fence, and the
  // run is free for the next attempt. Releasing is fenced by epoch, so it never
  // touches a lease a later attempt took.
  const unwatch = stop?.onStop(async () => {
    const acquired = await acquiring.catch(() => null);
    if (acquired?.status !== "acquired") return;
    await releaseLease(pool, acquired.lease).catch((error: unknown) => {
      console.warn(`[financial-engine] a stopped ${requestName(request)} keeps its lease until it lapses`, error);
    });
  });
  try {
    const acquired = await acquiring;
    if (acquired.status !== "acquired") return { status: "gap", reason: UNAVAILABLE[acquired.status] };
    try {
      await request.beforeDrive?.();
      const report = await driveLeasedRun(client, acquired.lease, acquired.run, { ...request, parent_limits: {} });
      return { status: "driven", run_id: run.run_id, report };
    } finally {
      // Whatever stopped this drive short (a failure, a rejected unit), the next attempt need not wait out the lease.
      await releaseLease(client, acquired.lease);
    }
  } finally {
    unwatch?.();
  }
}

const UNAVAILABLE: Readonly<Record<Exclude<AcquireLeaseResult["status"], "acquired">, RequestGap>> = {
  busy: "run_in_progress",
  cancel_requested: "run_cancelled",
  parent_authority_required: "parent_authority_required",
  not_found: "run_failed",
  terminal: "run_failed",
};

async function planOrGap(db: SqlExecutor, request: FinancialRequest): Promise<RequestOutcome | Readonly<{ status: "planned"; plan: FinancialPlan }>> {
  let result: PlanningResult;
  try {
    result = await request.plan(db);
  } catch (error) {
    if (error instanceof PlanningModelError) {
      console.warn(`[financial-engine] the planning model did not answer for ${requestName(request)}`, error.cause);
      return { status: "gap", reason: "planning_unavailable" };
    }
    console.error(`[financial-engine] planning failed for ${requestName(request)}`, error);
    throw error;
  }
  switch (result.outcome) {
    case "ready":
      return { status: "planned", plan: result.plan };
    case "needs_clarification":
      return { status: "clarification", clarification: result.clarification };
    case "configuration_needed":
      return { status: "gap", reason: "configuration_needed" };
    case "unsupported":
      return { status: "gap", reason: result.issues.some((issue) => issue.code === "no_model_budget") ? "planning_unavailable" : "unsupported" };
  }
}

function requestName(request: FinancialRequest): string {
  return `${request.authority.feature.surface} request ${request.request_key}`;
}

/** Legal names for issuer subjects, for plan labels; an absent issuer is simply absent from the map. */
export async function issuerLabels(db: SqlExecutor, issuerIds: ReadonlyArray<string>): Promise<Map<string, string>> {
  if (issuerIds.length === 0) return new Map();
  const { rows } = await db.query<{ issuer_id: string; legal_name: string }>(
    `select issuer_id::text, legal_name from issuers where issuer_id = any($1::uuid[])`,
    [[...issuerIds]],
  );
  return new Map(rows.map((row) => [row.issuer_id, row.legal_name]));
}
