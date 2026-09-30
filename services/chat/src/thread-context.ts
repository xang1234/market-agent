// What a follow-up turn knows about its thread: the companies the previous
// answer covered (so "compare it with AMD" can refer back), and the recent
// conversation (so the narrative reads as a reply, not a fresh answer).

import { hydrateSubjectRef, type HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { ChatResolvedSubjectPreResolution } from "./subjects.ts";

type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

type Hydrate = (db: QueryExecutor, ref: SubjectRef) => Promise<HydratedSubjectHandoff>;

// Only companies carry forward; a screen or theme fallback does not.
const COMPANY_KINDS = new Set(["issuer", "instrument", "listing"]);

export async function loadPriorSubjects(
  db: QueryExecutor,
  input: { threadId: string },
  hydrate: Hydrate = hydrateSubjectRef as Hydrate,
): Promise<ReadonlyArray<ChatResolvedSubjectPreResolution>> {
  const { rows } = await db.query<{ subject_refs: unknown }>(
    `select s.subject_refs
       from chat_messages m
       join snapshots s on s.snapshot_id = m.snapshot_id
      where m.thread_id = $1::uuid
        and m.role = 'assistant'
      order by m.created_at desc
      limit 1`,
    [input.threadId],
  );
  const refs = Array.isArray(rows[0]?.subject_refs) ? rows[0].subject_refs : [];
  const subjects: ChatResolvedSubjectPreResolution[] = [];
  for (const ref of refs) {
    if (!isCompanyRef(ref)) continue;
    try {
      subjects.push(resolutionFromHandoff(await hydrate(db, ref)));
    } catch (reason) {
      // A company that no longer hydrates is dropped; the turn still answers.
      console.warn("[chat] could not carry a previous subject forward", reason);
    }
  }
  return subjects;
}

export type ConversationMessage = { role: string; text: string };

export async function loadRecentConversation(
  db: QueryExecutor,
  input: { threadId: string; limit: number },
): Promise<ReadonlyArray<ConversationMessage>> {
  const { rows } = await db.query<{ role: string; blocks: unknown }>(
    `select role::text as role, blocks
       from chat_messages
      where thread_id = $1::uuid
      order by created_at desc
      limit $2`,
    [input.threadId, input.limit],
  );
  return rows
    .map((row) => ({ role: row.role, text: narrativeText(row.blocks) }))
    .filter((message) => message.text.length > 0)
    .reverse();
}

function narrativeText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block?.kind === "rich_text" && Array.isArray(block.segments))
    .flatMap((block) => block.segments)
    .map((segment: { text?: unknown }) => (typeof segment?.text === "string" ? segment.text : ""))
    .join(" ")
    .trim();
}

function isCompanyRef(value: unknown): value is SubjectRef {
  const ref = value as { kind?: unknown; id?: unknown } | null;
  return typeof ref?.kind === "string" && COMPANY_KINDS.has(ref.kind) && typeof ref.id === "string";
}

function resolutionFromHandoff(handoff: HydratedSubjectHandoff): ChatResolvedSubjectPreResolution {
  return {
    status: "resolved",
    input_text: handoff.display_labels.ticker ?? handoff.display_label,
    normalized_input: handoff.normalized_input,
    subject_ref: handoff.subject_ref,
    identity_level: handoff.identity_level,
    display_label: handoff.display_label,
    resolution_path: handoff.resolution_path,
    confidence: handoff.confidence,
    handoff,
  };
}
