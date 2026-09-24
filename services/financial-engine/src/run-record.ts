// Shape of a financial_runs row as the engine reads it.

export type ExecutionState = "pending" | "running" | "ready_to_seal" | "completed" | "failed" | "cancelled";

export type RunRecord = Readonly<{
  run_id: string;
  user_id: string;
  parent_kind: string;
  parent_id: string;
  parent_version: string;
  request_key: string;
  request_hash: string;
  plan_id: string;
  feature_mode: "off" | "shadow" | "enforce";
  knowledge_cutoff: string;
  execution_state: ExecutionState;
  coverage_state: "complete" | "partial" | "none" | null;
  lease_owner: string | null;
  lease_epoch: number;
  lease_expires_at: string | null;
  cancel_requested_at: string | null;
  failure_code: string | null;
  replay_of_run_id: string | null;
  bound_at: string | null;
}>;

export const RUN_COLUMNS = `run_id::text, user_id::text, parent_kind, parent_id::text, parent_version, request_key, request_hash, plan_id::text,
  feature_mode, to_char(knowledge_cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as knowledge_cutoff, execution_state,
  coverage_state, lease_owner, lease_epoch::text, lease_expires_at::text, cancel_requested_at::text, failure_code, replay_of_run_id::text, bound_at::text`;

export function toRun(row: Record<string, unknown>): RunRecord {
  return {
    run_id: row.run_id as string,
    user_id: row.user_id as string,
    parent_kind: row.parent_kind as string,
    parent_id: row.parent_id as string,
    parent_version: row.parent_version as string,
    request_key: row.request_key as string,
    request_hash: row.request_hash as string,
    plan_id: row.plan_id as string,
    feature_mode: row.feature_mode as RunRecord["feature_mode"],
    knowledge_cutoff: row.knowledge_cutoff as string,
    execution_state: row.execution_state as ExecutionState,
    coverage_state: row.coverage_state as RunRecord["coverage_state"],
    lease_owner: row.lease_owner as string | null,
    lease_epoch: Number(row.lease_epoch),
    lease_expires_at: row.lease_expires_at as string | null,
    cancel_requested_at: row.cancel_requested_at as string | null,
    failure_code: row.failure_code as string | null,
    replay_of_run_id: row.replay_of_run_id as string | null,
    bound_at: row.bound_at as string | null,
  };
}
