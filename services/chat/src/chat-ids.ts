// Deterministic identifiers and content hashes for chat turns, messages, and
// blocks, so a retried turn addresses the same rows.

import { createHash } from "node:crypto";

export function contentHashForText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/**
 * The one assistant message a turn saves, so a read of the thread can tell
 * that a turn's answer is saved before the turn ends.
 */
export function answerMessageId(threadId: string, runId: string, turnId: string): string {
  return stableUuid(`answer-message:${threadId}:${runId}:${turnId}`);
}

/**
 * The financial lane's outcome for a turn: its published answer, or the gap
 * it declined with until an answer replaces it. It differs from
 * answerMessageId, which an in-progress notice of the same turn may hold.
 */
export function financialMessageId(threadId: string, turnId: string): string {
  return stableUuid(`financial-message:${threadId}:${turnId}`);
}

// Looser than shared/src/subject-ref.ts isUuid (v4, lowercase only): ids from
// clients and stored blocks may be any version, in either case.
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** A note in an answer: one plain sentence, citing nothing. */
export function noteBlock(input: { snapshotId: string; asOf: string }, key: string, text: string): Record<string, unknown> {
  const id = stableUuid(`block:${input.snapshotId}:${key}`);
  return {
    id,
    kind: "rich_text",
    snapshot_id: input.snapshotId,
    data_ref: { kind: "rich_text", id },
    source_refs: [],
    as_of: input.asOf,
    segments: [{ type: "text", text }],
  };
}
