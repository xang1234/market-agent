// Owner-scoped run reservation and lifecycle. Idempotency is by owner,
// parent kind/id, and request key; the same key with a different request
// hash or parent version is a conflict, never a silent reuse. Lifecycle
// writes are fenced by the current lease (lease.ts), and bound payloads stay
// immutable (enforced again by the database).

import {
  planBindingHash,
  planSemanticHash,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
} from "../../financial-core/src/index.ts";
import { appendRunEvent } from "./events-repo.ts";
import { assertLeaseFence, type RunLease } from "./lease.ts";
import type { SqlExecutor } from "./ports.ts";
import { RUN_COLUMNS, toRun, type ExecutionState, type RunRecord } from "./run-record.ts";

export type { ExecutionState, RunRecord } from "./run-record.ts";

export type ReserveRunResult =
  | { status: "created" | "existing"; run: RunRecord }
  | { status: "conflict"; reason: "request_hash_mismatch" | "parent_version_mismatch"; run_id: string };

/** The request identity of a run: what is asked, independent of random plan ids. */
export function runRequestHash(plan: FinancialPlanV1): string {
  return planSemanticHash(plan);
}

/**
 * Reserves the run for (owner, parent, request key) or returns the existing
 * one. Concurrent creators serialize on the unique key; the loser's plan row
 * rolls back with its transaction.
 */
export async function reserveRun(
  client: SqlExecutor,
  input: { authority: FinancialRuntimeAuthority; request_key: string; plan: FinancialPlanV1; replay_of_run_id?: string | null },
): Promise<ReserveRunResult> {
  const { authority, plan } = input;
  const requestHash = runRequestHash(plan);
  await client.query("begin");
  try {
    await client.query(
      `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash, interpretation)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [plan.plan_id, authority.owner_user_id, plan.origin.kind, plan.origin.ref, plan.catalog_version, JSON.stringify(plan),
        planSemanticHash(plan), planBindingHash(plan, authority), plan.interpretation?.text ?? null],
    );
    const created = (await client.query<Record<string, unknown>>(
      `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode,
                                   knowledge_cutoff, policies, replay_of_run_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       on conflict (user_id, parent_kind, parent_id, request_key) do nothing
       returning ${RUN_COLUMNS}`,
      [authority.owner_user_id, authority.parent.kind, authority.parent.id, authority.parent.version, input.request_key, requestHash,
        plan.plan_id, authority.feature.mode, plan.time.knowledge_cutoff, JSON.stringify(plan.policies), input.replay_of_run_id ?? null],
    )).rows[0];
    if (created) {
      const run = toRun(created);
      await appendRunEvent(client, run.run_id, "run_created", { payload: { execution_state: "pending" } });
      await client.query("commit");
      return { status: "created", run };
    }
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  const existing = (await client.query<Record<string, unknown>>(
    `select ${RUN_COLUMNS} from financial_runs where user_id = $1 and parent_kind = $2 and parent_id = $3 and request_key = $4`,
    [authority.owner_user_id, authority.parent.kind, authority.parent.id, input.request_key],
  )).rows[0];
  if (!existing) throw new Error("run reservation lost its conflicting row");
  const run = toRun(existing);
  if (run.request_hash !== requestHash) return { status: "conflict", reason: "request_hash_mismatch", run_id: run.run_id };
  if (run.parent_version !== authority.parent.version) return { status: "conflict", reason: "parent_version_mismatch", run_id: run.run_id };
  return { status: "existing", run };
}

/** Owner-scoped lookup; another owner's run is indistinguishable from a missing one. */
export async function getRun(client: SqlExecutor, ownerUserId: string, runId: string): Promise<RunRecord | null> {
  const row = (await client.query<Record<string, unknown>>(`select ${RUN_COLUMNS} from financial_runs where run_id = $1 and user_id = $2`, [runId, ownerUserId])).rows[0];
  return row ? toRun(row) : null;
}

const ALLOWED_TRANSITIONS: Readonly<Record<ExecutionState, ReadonlyArray<ExecutionState>>> = {
  pending: ["running", "failed", "cancelled"],
  running: ["ready_to_seal", "failed", "cancelled"],
  ready_to_seal: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class RunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunTransitionError";
  }
}

/**
 * Moves a run to its next execution state under the current lease fence, in
 * the caller's transaction. Coverage is recorded on completion; failures carry
 * a reason code.
 */
export async function transitionRun(
  client: SqlExecutor,
  lease: RunLease,
  to: Exclude<ExecutionState, "pending" | "running">,
  details: { coverage_state?: "complete" | "partial" | "none"; failure_code?: string } = {},
): Promise<RunRecord> {
  const current = await assertLeaseFence(client, lease, { allowCancelRequested: to === "cancelled" || to === "failed" });
  if (!ALLOWED_TRANSITIONS[current.execution_state].includes(to)) {
    throw new RunTransitionError(`cannot move run from ${current.execution_state} to ${to}`);
  }
  if (to === "failed" && !details.failure_code) throw new RunTransitionError("a failed run needs a failure code");
  if (to === "completed" && !details.coverage_state) throw new RunTransitionError("a completed run needs its coverage");
  const terminal = to === "completed" || to === "failed" || to === "cancelled";
  const row = (await client.query<Record<string, unknown>>(
    `update financial_runs
        set execution_state = $2, coverage_state = coalesce($3, coverage_state), failure_code = $4, updated_at = now(),
            lease_owner = case when $5 then null else lease_owner end,
            lease_expires_at = case when $5 then null else lease_expires_at end
      where run_id = $1
      returning ${RUN_COLUMNS}`,
    [lease.run_id, to, details.coverage_state ?? null, to === "failed" ? details.failure_code : null, terminal],
  )).rows[0]!;
  const eventKind = to === "ready_to_seal" ? "run_ready_to_seal" : to === "completed" ? "run_completed" : to === "failed" ? "run_failed" : "run_cancelled";
  const payload: Record<string, string> = { execution_state: to };
  if (details.coverage_state) payload.coverage_state = details.coverage_state;
  if (to === "failed") payload.reason_code = details.failure_code!;
  await appendRunEvent(client, lease.run_id, eventKind, { payload });
  return toRun(row);
}

/**
 * Records the owner's cancellation. Without a live lease the run is cancelled
 * at once; otherwise the lease holder observes the request at its next fence.
 */
export async function requestCancellation(client: SqlExecutor, ownerUserId: string, runId: string): Promise<RunRecord | null> {
  await client.query("begin");
  try {
    const row = (await client.query<Record<string, unknown>>(
      `update financial_runs
          set cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now(),
              execution_state = case when lease_owner is null or lease_expires_at <= now() then 'cancelled' else execution_state end,
              lease_owner = case when lease_owner is null or lease_expires_at <= now() then null else lease_owner end,
              lease_expires_at = case when lease_owner is null or lease_expires_at <= now() then null else lease_expires_at end
        where run_id = $1 and user_id = $2 and execution_state not in ('completed', 'failed', 'cancelled')
        returning ${RUN_COLUMNS}`,
      [runId, ownerUserId],
    )).rows[0];
    if (row && toRun(row).execution_state === "cancelled") {
      await appendRunEvent(client, runId, "run_cancelled", { payload: { execution_state: "cancelled" } });
    }
    await client.query("commit");
    return row ? toRun(row) : getRun(client, ownerUserId, runId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
