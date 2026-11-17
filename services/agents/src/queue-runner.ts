import type { JsonValue } from "../../observability/src/types.ts";
import type { QueryExecutor } from "./agent-repo.ts";
import {
  AgentRunSupersededError,
  claimAgentRun,
  completeAgentRun,
  failAgentRun,
  getAgentRun,
  type AgentRunAdmission,
  type AgentRunRow,
} from "./agent-run-repo.ts";

export type AgentRunMessage = {
  run_id: string;
  agent_id: string;
  enqueued_at?: string;
};

export type HandleAgentRunMessageInput = {
  message: unknown;
  execute(): Promise<JsonValue>;
  admit?: AgentRunAdmission;
  failed_outputs_summary?: JsonValue;
};

export type AgentRunMessageResult =
  | { status: "completed"; run_id: string; run: AgentRunRow; outputs_summary: JsonValue }
  | { status: "duplicate"; run_id: string; run: AgentRunRow }
  | { status: "skipped_concurrency_limit"; run_id: string; active_run: AgentRunRow }
  | { status: "not_admitted"; run_id: string }
  | { status: "failed"; run_id: string; run: AgentRunRow; error: string }
  | { status: "superseded"; run_id: string; run: AgentRunRow };

export type FinishedAgentRun = Extract<AgentRunMessageResult, { status: "completed" | "failed" | "superseded" }>;

export class AgentRunMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunMessageValidationError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

export async function handleAgentRunMessage(
  db: QueryExecutor,
  input: HandleAgentRunMessageInput,
): Promise<AgentRunMessageResult> {
  const message = assertAgentRunMessage(input.message);

  const claim = await claimAgentRun(db, {
    run_id: message.run_id,
    agent_id: message.agent_id,
    inputs_watermark: message.enqueued_at === undefined
      ? null
      : { enqueued_at: message.enqueued_at },
    admit: input.admit,
  });
  if (!claim.claimed) {
    if (claim.reason === "not_admitted") {
      return Object.freeze({ status: "not_admitted", run_id: message.run_id });
    }
    if (claim.reason === "concurrency_limit") {
      return Object.freeze({
        status: "skipped_concurrency_limit",
        run_id: message.run_id,
        active_run: claim.row,
      });
    }
    return Object.freeze({
      status: "duplicate",
      run_id: message.run_id,
      run: claim.row,
    });
  }

  return finishClaimedAgentRun(db, message.run_id, input);
}

/** Executes a claimed run and ends it. A run another claim ended first is superseded and keeps that claim's ending. */
export async function finishClaimedAgentRun(
  db: QueryExecutor,
  runId: string,
  input: Pick<HandleAgentRunMessageInput, "execute" | "failed_outputs_summary">,
): Promise<FinishedAgentRun> {
  try {
    return await completeOrFailAgentRun(db, runId, input);
  } catch (error) {
    if (!(error instanceof AgentRunSupersededError)) throw error;
    const run = await getAgentRun(db, runId);
    if (run === null) throw error;
    return Object.freeze({ status: "superseded", run_id: runId, run });
  }
}

async function completeOrFailAgentRun(
  db: QueryExecutor,
  runId: string,
  input: Pick<HandleAgentRunMessageInput, "execute" | "failed_outputs_summary">,
): Promise<FinishedAgentRun> {
  try {
    const outputsSummary = await input.execute();
    const run = await completeAgentRun(db, {
      run_id: runId,
      outputs_summary: outputsSummary,
    });
    return Object.freeze({
      status: "completed",
      run_id: runId,
      run,
      outputs_summary: outputsSummary,
    });
  } catch (error) {
    if (error instanceof AgentRunSupersededError) throw error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const run = await failAgentRun(db, {
      run_id: runId,
      error: errorMessage,
      outputs_summary: input.failed_outputs_summary,
    });
    return Object.freeze({
      status: "failed",
      run_id: runId,
      run,
      error: errorMessage,
    });
  }
}

function assertAgentRunMessage(message: unknown): AgentRunMessage {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    throw new AgentRunMessageValidationError("message must be an object");
  }
  const candidate = message as Partial<AgentRunMessage>;
  assertUuidString(candidate.run_id, "run_id");
  assertUuidString(candidate.agent_id, "agent_id");
  if (
    candidate.enqueued_at !== undefined &&
    (typeof candidate.enqueued_at !== "string" ||
      !DATE_TIME_WITH_OFFSET.test(candidate.enqueued_at) ||
      Number.isNaN(Date.parse(candidate.enqueued_at)))
  ) {
    throw new AgentRunMessageValidationError("enqueued_at must be an ISO date-time string");
  }
  return {
    run_id: candidate.run_id,
    agent_id: candidate.agent_id,
    enqueued_at: candidate.enqueued_at,
  };
}

function assertUuidString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AgentRunMessageValidationError(`${field} must be a non-empty string`);
  }
  if (!UUID_RE.test(value)) {
    throw new AgentRunMessageValidationError(`${field} must be a UUID`);
  }
}
