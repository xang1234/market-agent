import { serializeJsonValue, type JsonValue, type QueryExecutor } from "./types.ts";

export type ToolCallLogInput = {
  thread_id?: string | null;
  agent_id?: string | null;
  tool_name: string;
  args: JsonValue;
  result_hash?: string | null;
  duration_ms?: number | null;
  status: string;
  error_code?: string | null;
};

export type ToolCallLogRow = {
  tool_call_id: string;
  created_at: Date;
};

// Writes a row to tool_call_logs. Callers choose the `status` vocabulary
// (e.g. "ok"/"error") and `error_code` taxonomy; PX.1 formalizes those.
export async function writeToolCallLog(
  db: QueryExecutor,
  input: ToolCallLogInput,
): Promise<ToolCallLogRow> {
  const { rows } = await db.query<ToolCallLogRow>(
    `insert into tool_call_logs
       (thread_id, agent_id, tool_name, args, result_hash, duration_ms, status, error_code)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     returning tool_call_id, created_at`,
    [
      input.thread_id ?? null,
      input.agent_id ?? null,
      input.tool_name,
      serializeJsonValue(input.args),
      input.result_hash ?? null,
      input.duration_ms ?? null,
      input.status,
      input.error_code ?? null,
    ],
  );
  return rows[0];
}
