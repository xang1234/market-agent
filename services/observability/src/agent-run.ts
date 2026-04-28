import { serializeNullableJsonValue, type JsonValue, type QueryExecutor } from "./types.ts";

export type AgentRunLogStartInput = {
  agent_id?: string | null;
  inputs_watermark?: JsonValue | null;
};

export type AgentRunLogStartRow = {
  agent_run_log_id: string;
  started_at: Date;
};

export async function startAgentRunLog(
  db: QueryExecutor,
  input: AgentRunLogStartInput = {},
): Promise<AgentRunLogStartRow> {
  const { rows } = await db.query<AgentRunLogStartRow>(
    `insert into agent_run_logs (agent_id, inputs_watermark)
     values ($1, $2::jsonb)
     returning agent_run_log_id, started_at`,
    [input.agent_id ?? null, serializeNullableJsonValue(input.inputs_watermark)],
  );
  return rows[0];
}

export type AgentRunLogCompleteInput = {
  agent_run_log_id: string;
  status: string;
  outputs_summary?: JsonValue | null;
  error?: string | null;
  ended_at?: Date | null;
};

export type AgentRunLogCompleteRow = {
  agent_run_log_id: string;
  started_at: Date;
  ended_at: Date;
  duration_ms: number;
  status: string;
};

// Closes an agent_run_logs row. duration_ms is computed server-side from
// started_at and the resolved end timestamp; now() is transaction-stable so
// both references in the UPDATE see the same value.
export async function completeAgentRunLog(
  db: QueryExecutor,
  input: AgentRunLogCompleteInput,
): Promise<AgentRunLogCompleteRow> {
  const { rows } = await db.query<AgentRunLogCompleteRow>(
    `update agent_run_logs
        set ended_at = coalesce($1::timestamptz, now()),
            status = $2,
            outputs_summary = $3::jsonb,
            error = $4,
            duration_ms = (extract(epoch from (coalesce($1::timestamptz, now()) - started_at)) * 1000)::integer
      where agent_run_log_id = $5
      returning agent_run_log_id, started_at, ended_at, duration_ms, status`,
    [
      input.ended_at ?? null,
      input.status,
      serializeNullableJsonValue(input.outputs_summary),
      input.error ?? null,
      input.agent_run_log_id,
    ],
  );
  if (rows.length === 0) {
    throw new Error(`agent_run_log not found: ${input.agent_run_log_id}`);
  }
  return rows[0];
}
