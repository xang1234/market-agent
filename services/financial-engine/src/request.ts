// One request from a parent feature to the engine: resume the plan an earlier
// attempt reserved or plan anew, then reserve, lease, execute, and publish —
// every surface the same way, with one list of reasons a request did not
// publish. Surfaces supply only their authority, how to plan, and how to write
// their artifact in the finalization transaction; they read back their own
// committed records afterwards.

import type { FinancialPlanV1, FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "./finalize.ts";
import { acquireLease, releaseLease, type AcquireLeaseResult } from "./lease.ts";
import type { Clarification, PlanningResult } from "./planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "./ports.ts";
import { driveLeasedRun, type DriveReport } from "./publish.ts";
import { findPlanForRequest, reserveRun } from "./run-repo.ts";
import { snapshotTransactionClient, type SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";

const LEASE_TTL_MS = 120_000;

/** A surface's financial lane: off, planning only beside the legacy answer, or the engine's answer alone. */
export type FinancialMode = "off" | "shadow" | "enforce";

/**
 * Reads a surface's server-owned mode flag: unset is off. A value that is not a
 * mode is a configuration error, never a silent fallback to legacy numbers.
 */
export function parseFinancialMode(value: string | undefined, name = "financial mode"): FinancialMode {
  const mode = value?.trim() ?? "";
  if (mode === "") return "off";
  if (mode === "off" || mode === "shadow" || mode === "enforce") return mode;
  throw new Error(`${name} must be off, shadow, or enforce (got ${JSON.stringify(value)})`);
}

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
  /** Shadow mode: the request planned; nothing was reserved or published. */
  | Readonly<{ status: "planned"; plan: FinancialPlanV1 }>
  | Readonly<{ status: "gap"; reason: RequestGap }>;

export type FinancialRequest = Readonly<{
  authority: FinancialRuntimeAuthority;
  request_key: string;
  mode: "shadow" | "enforce";
  /** Called only when no earlier attempt reserved a plan for this request. */
  plan: (db: SqlExecutor) => Promise<PlanningResult>;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  persistParent: PersistParentArtifact;
}>;

export async function publishRequest(pool: FinancialPool, request: FinancialRequest): Promise<RequestOutcome> {
  const client = snapshotTransactionClient(await pool.connect());
  try {
    let plan = await findPlanForRequest(client, request);
    if (!plan) {
      const planned = await planOrGap(client, request);
      if (planned.status !== "planned") return planned;
      plan = planned.plan;
    }
    if (request.mode === "shadow") return { status: "planned", plan };
    try {
      return await reserveAndDrive(client, request, plan);
    } catch {
      // A finalization that rolled back leaves units computed and the run checkpointed: a retry or recovery finishes it.
      return { status: "gap", reason: "publication_failed" };
    }
  } finally {
    client.release();
  }
}

/**
 * Reserves the run for the request key (or finds the one an earlier attempt
 * reserved), leases it, and drives it to published units. A retry after a
 * commit the caller never heard about lands on a completed run or on existing
 * units, never on a second publication.
 */
async function reserveAndDrive(client: SnapshotTransactionClient, request: FinancialRequest, plan: FinancialPlanV1): Promise<RequestOutcome> {
  const reserved = await reserveRun(client, { authority: request.authority, request_key: request.request_key, plan });
  if (reserved.status === "conflict") return { status: "gap", reason: "request_conflict" };
  const { run } = reserved;
  if (run.execution_state === "completed") return { status: "driven", run_id: run.run_id, report: null };
  if (run.execution_state === "failed") return { status: "gap", reason: "run_failed" };
  if (run.execution_state === "cancelled") return { status: "gap", reason: "run_cancelled" };
  const acquired = await acquireLease(client, {
    authority: request.authority,
    run_id: run.run_id,
    worker_id: `${request.authority.feature.surface}-${process.pid}`,
    ttl_ms: LEASE_TTL_MS,
  });
  if (acquired.status !== "acquired") return { status: "gap", reason: UNAVAILABLE[acquired.status] };
  try {
    const report = await driveLeasedRun(client, acquired.lease, acquired.run, { ...request, parent_limits: {} });
    return { status: "driven", run_id: run.run_id, report };
  } finally {
    // Whatever stopped this drive short (a failure, a rejected unit), the next attempt need not wait out the lease.
    await releaseLease(client, acquired.lease);
  }
}

const UNAVAILABLE: Readonly<Record<Exclude<AcquireLeaseResult["status"], "acquired">, RequestGap>> = {
  busy: "run_in_progress",
  cancel_requested: "run_cancelled",
  parent_authority_required: "parent_authority_required",
  not_found: "run_failed",
  terminal: "run_failed",
};

async function planOrGap(db: SqlExecutor, request: FinancialRequest): Promise<RequestOutcome> {
  let result: PlanningResult;
  try {
    result = await request.plan(db);
  } catch {
    // An unreachable or failing planner is a gap; no surface falls back to an unverified number.
    return { status: "gap", reason: "planning_unavailable" };
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

/** Legal names for issuer subjects, for plan labels; an absent issuer is simply absent from the map. */
export async function issuerLabels(db: SqlExecutor, issuerIds: ReadonlyArray<string>): Promise<Map<string, string>> {
  if (issuerIds.length === 0) return new Map();
  const { rows } = await db.query<{ issuer_id: string; legal_name: string }>(
    `select issuer_id::text, legal_name from issuers where issuer_id = any($1::uuid[])`,
    [[...issuerIds]],
  );
  return new Map(rows.map((row) => [row.issuer_id, row.legal_name]));
}
