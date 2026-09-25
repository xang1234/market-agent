// One request from a parent feature to the engine: resume the plan an earlier
// attempt reserved or plan anew, then reserve, lease, execute, and publish —
// every surface the same way, with one list of reasons a request did not
// publish. Surfaces supply only their authority, how to plan, and how to write
// their artifact in the finalization transaction; they read back their own
// committed records afterwards.

import type { FinancialPlanV1, FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "./finalize.ts";
import type { Clarification, PlanningResult } from "./planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "./ports.ts";
import { reserveAndPublish, type DriveReport, type PublishResult } from "./publish.ts";
import { findRunForRequest } from "./run-repo.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";

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
  worker_id: string;
}>;

export async function publishRequest(pool: FinancialPool, request: FinancialRequest): Promise<RequestOutcome> {
  const client = snapshotTransactionClient(await pool.connect());
  try {
    const earlier = await findRunForRequest(client, { authority: request.authority, request_key: request.request_key });
    let plan = earlier?.plan;
    if (!plan) {
      const planned = await planOrGap(client, request);
      if (planned.status !== "planned") return planned;
      plan = planned.plan;
    }
    if (request.mode === "shadow") return { status: "planned", plan };
    let published: PublishResult;
    try {
      published = await reserveAndPublish(client, {
        plan,
        authority: request.authority,
        request_key: request.request_key,
        worker_id: request.worker_id,
        ttl_ms: LEASE_TTL_MS,
        evidence: request.evidence,
        parent_limits: {},
        persistParent: request.persistParent,
      });
    } catch {
      // A finalization that rolled back leaves units computed and the run checkpointed: a retry or recovery finishes it.
      return { status: "gap", reason: "publication_failed" };
    }
    return outcomeOf(published);
  } finally {
    client.release();
  }
}

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

function outcomeOf(result: PublishResult): RequestOutcome {
  switch (result.status) {
    case "driven":
      return { status: "driven", run_id: result.report.run_id, report: result.report };
    case "completed":
      return { status: "driven", run_id: result.run.run_id, report: null };
    case "failed":
      return { status: "gap", reason: "run_failed" };
    case "cancelled":
      return { status: "gap", reason: "run_cancelled" };
    case "conflict":
      return { status: "gap", reason: "request_conflict" };
    case "unavailable":
      switch (result.reason) {
        case "busy":
          return { status: "gap", reason: "run_in_progress" };
        case "cancel_requested":
          return { status: "gap", reason: "run_cancelled" };
        case "parent_authority_required":
          return { status: "gap", reason: "parent_authority_required" };
        default:
          return { status: "gap", reason: "run_failed" };
      }
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
