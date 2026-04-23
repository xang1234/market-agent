import { serializeNullableJsonValue, type JsonValue, type QueryExecutor } from "./types.ts";

export type VerifierFailLogInput = {
  thread_id?: string | null;
  snapshot_id?: string | null;
  reason_code: string;
  details?: JsonValue | null;
};

export type VerifierFailLogRow = {
  verifier_fail_log_id: string;
  created_at: Date;
};

// Writes a row to verifier_fail_logs. `details` is optional jsonb — omit
// when the reason_code alone carries the failure context.
export async function writeVerifierFailLog(
  db: QueryExecutor,
  input: VerifierFailLogInput,
): Promise<VerifierFailLogRow> {
  const { rows } = await db.query<VerifierFailLogRow>(
    `insert into verifier_fail_logs
       (thread_id, snapshot_id, reason_code, details)
     values ($1, $2, $3, $4::jsonb)
     returning verifier_fail_log_id, created_at`,
    [
      input.thread_id ?? null,
      input.snapshot_id ?? null,
      input.reason_code,
      serializeNullableJsonValue(input.details),
    ],
  );
  return rows[0];
}
