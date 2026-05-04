import type { JsonValue } from "../../observability/src/types.ts";
import type { QueryExecutor } from "./agent-repo.ts";

export type AgentRunStatus = "running" | "completed" | "failed";

export type AgentRunRow = {
  agent_run_log_id: string;
  agent_id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  inputs_watermark: JsonValue | null;
  outputs_summary: JsonValue | null;
  status: AgentRunStatus;
  error: string | null;
  claim_expires_at: string | null;
};

type AgentRunDbRow = {
  agent_run_log_id: string;
  agent_id: string | null;
  started_at: Date | string;
  ended_at: Date | string | null;
  duration_ms: number | null;
  inputs_watermark: JsonValue | null;
  outputs_summary: JsonValue | null;
  status: AgentRunStatus;
  error: string | null;
  claim_expires_at?: Date | string | null;
};

export type AgentRunClaim =
  | { claimed: true; row: AgentRunRow }
  | { claimed: false; reason: "duplicate"; row: AgentRunRow }
  | { claimed: false; reason: "concurrency_limit"; row: AgentRunRow };

export class AgentRunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunStateError";
  }
}

const SELECT_COLUMNS = `agent_run_log_id::text as agent_run_log_id,
       agent_id::text as agent_id,
       started_at,
       ended_at,
       duration_ms,
       inputs_watermark,
       outputs_summary,
       status,
       error,
       claim_expires_at`;

export async function claimAgentRun(
  db: QueryExecutor,
  input: {
    run_id: string;
    agent_id: string;
    inputs_watermark?: JsonValue | null;
    lease_expires_at?: string;
  },
): Promise<AgentRunClaim> {
  const leaseExpiresAt = input.lease_expires_at ?? defaultLeaseExpiresAt();

  await expireStaleAgentRuns(db, input.agent_id);

  try {
    const { rows } = await db.query<AgentRunDbRow>(
      `insert into agent_run_logs
         (agent_run_log_id, agent_id, inputs_watermark, status, claim_expires_at)
       values ($1::uuid, $2::uuid, $3::jsonb, 'running', $4::timestamptz)
       returning ${SELECT_COLUMNS}`,
      [
        input.run_id,
        input.agent_id,
        input.inputs_watermark === undefined ? null : JSON.stringify(input.inputs_watermark),
        leaseExpiresAt,
      ],
    );
    return Object.freeze({ claimed: true, row: rowFromDb(rows[0]) });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const duplicate = await getAgentRun(db, input.run_id);
    if (duplicate !== null) {
      return Object.freeze({ claimed: false, reason: "duplicate", row: duplicate });
    }
    const active = await findActiveAgentRun(db, input);
    if (active === null) {
      throw new AgentRunStateError("agent run claim conflicted but no duplicate or active run was found");
    }
    return Object.freeze({ claimed: false, reason: "concurrency_limit", row: active });
  }
}

async function expireStaleAgentRuns(db: QueryExecutor, agentId: string): Promise<void> {
  await db.query(
    `update agent_run_logs
        set status = 'failed',
            ended_at = now(),
            duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer),
            outputs_summary = coalesce(outputs_summary, '{}'::jsonb),
            error = coalesce(error, 'agent run claim expired')
      where agent_id = $1::uuid
        and status = 'running'
        and ended_at is null
        and claim_expires_at is not null
        and claim_expires_at <= now()`,
    [agentId],
  );
}

async function getAgentRun(db: QueryExecutor, runId: string): Promise<AgentRunRow | null> {
  const { rows } = await db.query<AgentRunDbRow>(
    `select ${SELECT_COLUMNS}
       from agent_run_logs
      where agent_run_log_id = $1::uuid`,
    [runId],
  );
  return rows[0] === undefined ? null : rowFromDb(rows[0]);
}

async function findActiveAgentRun(
  db: QueryExecutor,
  input: { run_id: string; agent_id: string },
): Promise<AgentRunRow | null> {
  const { rows } = await db.query<AgentRunDbRow>(
    `select ${SELECT_COLUMNS}
       from agent_run_logs
      where agent_id = $1::uuid
        and status = 'running'
        and ended_at is null
        and agent_run_log_id <> $2::uuid
      order by started_at asc
      limit 1`,
    [input.agent_id, input.run_id],
  );
  return rows[0] === undefined ? null : rowFromDb(rows[0]);
}

export async function completeAgentRun(
  db: QueryExecutor,
  input: { run_id: string; outputs_summary: JsonValue },
): Promise<AgentRunRow> {
  const { rows } = await db.query<AgentRunDbRow>(
    `update agent_run_logs
        set status = 'completed',
            ended_at = now(),
            duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer),
            outputs_summary = $2::jsonb,
            error = null
      where agent_run_log_id = $1::uuid
        and status = 'running'
        and ended_at is null
      returning ${SELECT_COLUMNS}`,
    [input.run_id, JSON.stringify(input.outputs_summary)],
  );
  if (rows[0] === undefined) {
    throw new AgentRunStateError("agent run is not running and cannot be completed");
  }
  return rowFromDb(rows[0]);
}

export async function failAgentRun(
  db: QueryExecutor,
  input: { run_id: string; error: string; outputs_summary?: JsonValue },
): Promise<AgentRunRow> {
  const { rows } = await db.query<AgentRunDbRow>(
    `update agent_run_logs
        set status = 'failed',
            ended_at = now(),
            duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer),
            outputs_summary = $2::jsonb,
            error = $3
      where agent_run_log_id = $1::uuid
        and status = 'running'
        and ended_at is null
      returning ${SELECT_COLUMNS}`,
    [input.run_id, JSON.stringify(input.outputs_summary ?? {}), input.error],
  );
  if (rows[0] === undefined) {
    throw new AgentRunStateError("agent run is not running and cannot be failed");
  }
  return rowFromDb(rows[0]);
}

function rowFromDb(row: AgentRunDbRow): AgentRunRow {
  return Object.freeze({
    agent_run_log_id: row.agent_run_log_id,
    agent_id: row.agent_id ?? "",
    started_at: toIso(row.started_at),
    ended_at: row.ended_at === null ? null : toIso(row.ended_at),
    duration_ms: row.duration_ms,
    inputs_watermark: row.inputs_watermark,
    outputs_summary: row.outputs_summary,
    status: row.status,
    error: row.error,
    claim_expires_at: row.claim_expires_at === undefined || row.claim_expires_at === null
      ? null
      : toIso(row.claim_expires_at),
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function defaultLeaseExpiresAt(): string {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}
