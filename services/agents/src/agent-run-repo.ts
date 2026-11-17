import type { JsonValue } from "../../observability/src/types.ts";
import { withTransaction } from "../../evidence/src/transaction.ts";
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
  | { claimed: false; reason: "concurrency_limit"; row: AgentRunRow }
  | { claimed: false; reason: "not_admitted" };

export type AgentRunAdmission = (tx: QueryExecutor) => Promise<boolean>;

export class AgentRunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunStateError";
  }
}

/** Another claim ended the run, so it may commit nothing more. */
export class AgentRunSupersededError extends AgentRunStateError {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunSupersededError";
  }
}

const LEASE_MINUTES = 15;

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

const INSERT_RUNNING = `insert into agent_run_logs
         (agent_run_log_id, agent_id, inputs_watermark, status, claim_expires_at)
       values ($1::uuid, $2::uuid, $3::jsonb, 'running', $4::timestamptz)`;

export async function claimAgentRun(
  db: QueryExecutor,
  input: {
    run_id: string;
    agent_id: string;
    inputs_watermark?: JsonValue | null;
    lease_expires_at?: string;
    admit?: AgentRunAdmission;
  },
): Promise<AgentRunClaim> {
  const values = [
    input.run_id,
    input.agent_id,
    input.inputs_watermark === undefined ? null : JSON.stringify(input.inputs_watermark),
    input.lease_expires_at ?? defaultLeaseExpiresAt(),
  ];

  await expireStaleAgentRuns(db, input.agent_id);

  // A conflict with a run that ends before the readback leaves the slot free, so the claim tries again.
  for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt += 1) {
    const claim = await attemptAgentRunClaim(db, input, values);
    if (claim !== null) return claim;
  }
  throw new AgentRunStateError("agent run claim conflicted but no duplicate or active run was found");
}

const CLAIM_ATTEMPTS = 3;

async function attemptAgentRunClaim(
  db: QueryExecutor,
  input: { run_id: string; agent_id: string; admit?: AgentRunAdmission },
  values: unknown[],
): Promise<AgentRunClaim | null> {
  if (input.admit !== undefined) {
    const admit = input.admit;
    // The agent row lock orders this check against a disable, a delete, and every other admitted claim.
    const outcome = await withTransaction(db, async ({ db: tx }) => {
      await lockAgentRow(tx, input.agent_id);
      if (!(await admit(tx))) return "not_admitted" as const;
      const { rows } = await tx.query<AgentRunDbRow>(`${INSERT_RUNNING} on conflict do nothing returning ${SELECT_COLUMNS}`, values);
      return rows[0] ?? null;
    });
    if (outcome !== null && outcome !== "not_admitted") return Object.freeze({ claimed: true, row: rowFromDb(outcome) });
    return unclaimedAgentRun(db, input, outcome === "not_admitted");
  }

  try {
    const { rows } = await db.query<AgentRunDbRow>(`${INSERT_RUNNING} returning ${SELECT_COLUMNS}`, values);
    return Object.freeze({ claimed: true, row: rowFromDb(rows[0]) });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return unclaimedAgentRun(db, input, false);
  }
}

async function unclaimedAgentRun(
  db: QueryExecutor,
  input: { run_id: string; agent_id: string },
  notAdmitted: boolean,
): Promise<AgentRunClaim | null> {
  const duplicate = await getAgentRun(db, input.run_id);
  if (duplicate !== null) {
    return Object.freeze({ claimed: false, reason: "duplicate", row: duplicate });
  }
  if (notAdmitted) return Object.freeze({ claimed: false, reason: "not_admitted" });
  const active = await findActiveAgentRun(db, input);
  return active === null ? null : Object.freeze({ claimed: false, reason: "concurrency_limit", row: active });
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

export async function getAgentRun(db: QueryExecutor, runId: string): Promise<AgentRunRow | null> {
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

/** A claim and a run's commit both take this lock before they touch the agent's run rows, so neither waits on a run row while holding the other's lock. */
async function lockAgentRow(tx: QueryExecutor, agentId: string): Promise<void> {
  await tx.query("select 1 from agents where agent_id = $1::uuid for update", [agentId]);
}

/**
 * Run first in the transaction that commits a run's effects. It holds the agent's row and the
 * run's own row until commit, so no claim can end the run first, and the renewed lease lets the
 * run's completion still find it running.
 */
export async function fenceAgentRun(tx: QueryExecutor, run: { run_id: string; agent_id: string }): Promise<void> {
  await lockAgentRow(tx, run.agent_id);
  const { rowCount } = await tx.query(
    `update agent_run_logs
        set claim_expires_at = greatest(claim_expires_at, now() + make_interval(mins => $3::int))
      where agent_run_log_id = $1::uuid
        and agent_id = $2::uuid
        and status = 'running'
        and ended_at is null`,
    [run.run_id, run.agent_id, LEASE_MINUTES],
  );
  if ((rowCount ?? 0) === 0) {
    throw new AgentRunSupersededError("agent run lost its claim before it could commit");
  }
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
    throw new AgentRunSupersededError("agent run is not running and cannot be completed");
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
    throw new AgentRunSupersededError("agent run is not running and cannot be failed");
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
  return new Date(Date.now() + LEASE_MINUTES * 60 * 1000).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}
