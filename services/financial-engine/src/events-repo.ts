// Durable, sanitized run events. Payloads carry identifiers, hashes, reason
// codes, states, and counts only — never raw provider values, draft numbers,
// or model text — so progress can stream before publication without leaking
// unsealed financial content.

import type { SqlExecutor } from "./ports.ts";

export const RUN_EVENT_KINDS = [
  "run_created",
  "lease_acquired",
  "lease_expired",
  "inputs_bound",
  "unit_computed",
  "unit_sealed",
  "unit_rejected",
  "run_ready_to_seal",
  "run_completed",
  "run_failed",
  "run_cancelled",
] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

const PAYLOAD_KEYS = new Set(["reason_code", "coverage_state", "execution_state", "lease_epoch", "worker_id", "bound_count", "gap_count", "unit_count", "certificate_digest"]);
const SAFE_TOKEN = /^[A-Za-z0-9_:.-]{1,128}$/u;

export type RunEventPayload = Readonly<Record<string, string | number | boolean>>;
export type RunEvent = { run_id: string; sequence: number; event_kind: RunEventKind; unit_id: string | null; payload: RunEventPayload; created_at: string };

export class UnsafeEventPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeEventPayloadError";
  }
}

/**
 * Appends the next event for a run. Callers hold the run row lock (a lease
 * fence or finalization transaction), which serializes sequence allocation.
 */
export async function appendRunEvent(
  client: SqlExecutor,
  runId: string,
  kind: RunEventKind,
  options: { unit_id?: string | null; payload?: RunEventPayload } = {},
): Promise<RunEvent> {
  const payload = sanitizePayload(options.payload ?? {});
  const row = (await client.query<{ sequence: string; created_at: string }>(
    `insert into financial_run_events (run_id, sequence, event_kind, unit_id, payload)
     select $1, coalesce(max(sequence), 0) + 1, $2, $3, $4::jsonb from financial_run_events where run_id = $1
     returning sequence::text, created_at::text`,
    [runId, kind, options.unit_id ?? null, JSON.stringify(payload)],
  )).rows[0]!;
  return { run_id: runId, sequence: Number(row.sequence), event_kind: kind, unit_id: options.unit_id ?? null, payload, created_at: row.created_at };
}

/** Owner-scoped event page after a cursor. Another owner's run looks like an empty page. */
export async function listRunEvents(
  client: SqlExecutor,
  input: { owner_user_id: string; run_id: string; after_sequence: number; limit: number },
): Promise<RunEvent[]> {
  if (!Number.isSafeInteger(input.after_sequence) || input.after_sequence < 0) throw new RangeError("after_sequence must be a non-negative integer");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new RangeError("limit must be from 1 to 500");
  const rows = (await client.query<{ sequence: string; event_kind: RunEventKind; unit_id: string | null; payload: RunEventPayload; created_at: string }>(
    `select e.sequence::text, e.event_kind, e.unit_id, e.payload, e.created_at::text
       from financial_run_events e
       join financial_runs r on r.run_id = e.run_id
      where e.run_id = $1 and r.user_id = $2 and e.sequence > $3
      order by e.sequence
      limit $4`,
    [input.run_id, input.owner_user_id, input.after_sequence, input.limit],
  )).rows;
  return rows.map((row) => ({ run_id: input.run_id, sequence: Number(row.sequence), event_kind: row.event_kind, unit_id: row.unit_id, payload: row.payload, created_at: row.created_at }));
}

function sanitizePayload(payload: RunEventPayload): RunEventPayload {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!PAYLOAD_KEYS.has(key)) throw new UnsafeEventPayloadError(`event payload key ${key} is not allowed`);
    if (typeof value === "string" && !SAFE_TOKEN.test(value)) throw new UnsafeEventPayloadError(`event payload ${key} must be an identifier, hash, or code`);
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new UnsafeEventPayloadError(`event payload ${key} must be an integer count`);
    safe[key] = value;
  }
  return safe;
}
