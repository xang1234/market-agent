import { createHash } from "node:crypto";

import { serializeJsonValue, type JsonValue, type QueryExecutor } from "./types.ts";

export type ToolCallLogStatus = "ok" | "error" | "skipped" | "partial";

export type ToolCallArgsDigest = {
  args_hash: string;
};

export type ToolCallLogInput = {
  thread_id?: string | null;
  agent_id?: string | null;
  tool_name: string;
  args: JsonValue;
  result?: JsonValue;
  result_hash?: string | null;
  duration_ms?: number | null;
  status: ToolCallLogStatus | string;
  error_code?: string | null;
};

export type ToolCallLogRow = {
  tool_call_id: string;
  created_at: Date;
};

export type RunLoggedToolCallInput<
  Args extends JsonValue,
  Result extends JsonValue,
> = {
  thread_id?: string | null;
  agent_id?: string | null;
  tool_name: string;
  args: Args;
  now?: () => number;
  errorCode?: (error: unknown) => string | null | undefined;
  invoke: (args: Args) => Result | Promise<Result>;
};

// Writes a row to tool_call_logs. Callers choose the `status` vocabulary
// (e.g. "ok"/"error") and `error_code` taxonomy. Arguments are stored as
// a stable digest so logs can be correlated without retaining raw tool args.
export async function writeToolCallLog(
  db: QueryExecutor,
  input: ToolCallLogInput,
): Promise<ToolCallLogRow> {
  const result_hash =
    input.result_hash !== undefined
      ? input.result_hash
      : input.result === undefined
        ? null
        : hashJsonValue(input.result);

  const { rows } = await db.query<ToolCallLogRow>(
    `insert into tool_call_logs
       (thread_id, agent_id, tool_name, args, result_hash, duration_ms, status, error_code)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     returning tool_call_id, created_at`,
    [
      input.thread_id ?? null,
      input.agent_id ?? null,
      input.tool_name,
      serializeJsonValue(toolCallArgsDigest(input.args)),
      result_hash,
      input.duration_ms ?? null,
      input.status,
      input.error_code ?? null,
    ],
  );
  return rows[0];
}

export async function runLoggedToolCall<
  Args extends JsonValue,
  Result extends JsonValue,
>(
  db: QueryExecutor,
  input: RunLoggedToolCallInput<Args, Result>,
): Promise<Result> {
  const now = input.now ?? Date.now;
  const startedAt = now();

  try {
    const result = await input.invoke(input.args);
    await writeToolCallLog(db, {
      thread_id: input.thread_id,
      agent_id: input.agent_id,
      tool_name: input.tool_name,
      args: input.args,
      result,
      duration_ms: elapsedMilliseconds(startedAt, now()),
      status: "ok",
    });
    return result;
  } catch (error) {
    await writeToolCallLog(db, {
      thread_id: input.thread_id,
      agent_id: input.agent_id,
      tool_name: input.tool_name,
      args: input.args,
      duration_ms: elapsedMilliseconds(startedAt, now()),
      status: "error",
      error_code: input.errorCode?.(error) ?? defaultErrorCode(error),
    });
    throw error;
  }
}

export function toolCallArgsDigest(args: JsonValue): ToolCallArgsDigest {
  return Object.freeze({
    args_hash: hashJsonValue(args),
  });
}

export function hashJsonValue(value: JsonValue): string {
  serializeJsonValue(value);
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function elapsedMilliseconds(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}

function defaultErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return "TOOL_ERROR";
}
