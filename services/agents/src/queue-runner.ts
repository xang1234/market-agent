import type { JsonValue } from "../../observability/src/types.ts";
import type { QueryExecutor } from "./agent-repo.ts";
import {
  claimAgentRun,
  completeAgentRun,
  failAgentRun,
  type AgentRunRow,
} from "./agent-run-repo.ts";

export type AgentRunMessage = {
  run_id: string;
  agent_id: string;
  enqueued_at?: string;
};

export type HandleAgentRunMessageInput = {
  message: AgentRunMessage;
  execute(): Promise<JsonValue>;
};

export type AgentRunMessageResult =
  | { status: "completed"; run_id: string; run: AgentRunRow; outputs_summary: JsonValue }
  | { status: "duplicate"; run_id: string; run: AgentRunRow }
  | { status: "skipped_concurrency_limit"; run_id: string; active_run: AgentRunRow }
  | { status: "failed"; run_id: string; run: AgentRunRow; error: string };

export class AgentRunMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunMessageValidationError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleAgentRunMessage(
  db: QueryExecutor,
  input: HandleAgentRunMessageInput,
): Promise<AgentRunMessageResult> {
  assertAgentRunMessage(input.message);

  const claim = await claimAgentRun(db, {
    run_id: input.message.run_id,
    agent_id: input.message.agent_id,
    inputs_watermark: input.message.enqueued_at === undefined
      ? null
      : { enqueued_at: input.message.enqueued_at },
  });
  if (!claim.claimed) {
    if (claim.reason === "concurrency_limit") {
      return Object.freeze({
        status: "skipped_concurrency_limit",
        run_id: input.message.run_id,
        active_run: claim.row,
      });
    }
    return Object.freeze({
      status: "duplicate",
      run_id: input.message.run_id,
      run: claim.row,
    });
  }

  try {
    const outputsSummary = await input.execute();
    const run = await completeAgentRun(db, {
      run_id: input.message.run_id,
      outputs_summary: outputsSummary,
    });
    return Object.freeze({
      status: "completed",
      run_id: input.message.run_id,
      run,
      outputs_summary: outputsSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const run = await failAgentRun(db, {
      run_id: input.message.run_id,
      error: message,
    });
    return Object.freeze({
      status: "failed",
      run_id: input.message.run_id,
      run,
      error: message,
    });
  }
}

function assertAgentRunMessage(message: AgentRunMessage): void {
  assertUuidString(message.run_id, "run_id");
  assertUuidString(message.agent_id, "agent_id");
  if (message.enqueued_at !== undefined && Number.isNaN(Date.parse(message.enqueued_at))) {
    throw new AgentRunMessageValidationError("enqueued_at must be an ISO date-time string");
  }
}

function assertUuidString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AgentRunMessageValidationError(`${field} must be a non-empty string`);
  }
  if (!UUID_RE.test(value)) {
    throw new AgentRunMessageValidationError(`${field} must be a UUID`);
  }
}
