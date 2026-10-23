// What a follow-up turn knows about its thread: the companies the previous
// answer covered (so "compare it with AMD" can refer back), and the recent
// conversation (so the narrative reads as a reply, not a fresh answer).

import { hydrateSubjectRef, type HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { parseResearchScope, type ResearchScope } from "./research-scope.ts";
import type { ChatResolvedSubjectPreResolution } from "./subjects.ts";
import type { QueryExecutor } from "../../shared/src/http.ts";

type Hydrate = (db: QueryExecutor, ref: SubjectRef) => Promise<HydratedSubjectHandoff>;

// Only companies carry forward; a screen or theme fallback does not.
const COMPANY_KINDS = new Set(["issuer", "instrument", "listing"]);

export async function loadPriorSubjects(
  db: QueryExecutor,
  input: { threadId: string },
  hydrate: Hydrate = hydrateSubjectRef as Hydrate,
): Promise<ReadonlyArray<ChatResolvedSubjectPreResolution>> {
  const { rows } = await db.query<{ subject_refs: unknown; research_scope: unknown }>(
    `select s.subject_refs, m.research_scope
       from chat_messages m
       join snapshots s on s.snapshot_id = m.snapshot_id
      where m.thread_id = $1::uuid
        and m.role = 'assistant'
        -- An answer about no company (a clarification, a notice, or a gap
        -- that names none) leaves the earlier companies in place, as it
        -- leaves the scope (loadPriorScope).
        and exists (
          select 1 from jsonb_array_elements(s.subject_refs) ref
           where ref->>'kind' in ('issuer', 'instrument', 'listing')
        )
      order by m.created_at desc
      limit 1`,
    [input.threadId],
  );
  const refs = Array.isArray(rows[0]?.subject_refs) ? rows[0].subject_refs : [];
  // The labels that answer's scope gave its companies, by issuer.
  const labels = new Map((parseResearchScope(rows[0]?.research_scope ?? null)?.companies ?? [])
    .flatMap((company) => company.label === undefined ? [] : [[company.issuer_id.toLowerCase(), company.label] as const]));
  const handoffs: HydratedSubjectHandoff[] = [];
  for (const ref of refs) {
    if (!isCompanyRef(ref)) continue;
    try {
      handoffs.push(withListingTicker(await hydrate(db, ref), labels));
    } catch (reason) {
      // A company that no longer hydrates is dropped; the turn still answers.
      console.warn("[chat] could not carry a previous subject forward", reason);
    }
  }
  return handoffs.map(resolutionFromHandoff);
}

// An engine answer seals its companies as issuers, which hydrate with no
// ticker; each takes an active ticker, as answers name companies (#425): the
// one its answer named (GOOGL, not GOOG), else its smallest.
function withListingTicker(handoff: HydratedSubjectHandoff, labels: ReadonlyMap<string, string>): HydratedSubjectHandoff {
  const tickers = (handoff.context.active_listings ?? []).map((listing) => listing.ticker).sort();
  const named = labels.get(handoff.subject_ref.id.toLowerCase());
  const ticker = named !== undefined && tickers.includes(named) ? named : tickers[0];
  return handoff.display_labels.ticker !== undefined || ticker === undefined
    ? handoff
    : { ...handoff, display_labels: { ...handoff.display_labels, ticker } };
}

// The latest research scope an answer saved (research-scope.ts), for a
// follow-up to keep what it does not change. Answers that save none (a
// clarification, a notice, a gap that names no company, or an answer whose
// scope was unavailable when it was saved) leave it in place; null when no
// answer saved one.
export async function loadPriorScope(
  db: QueryExecutor,
  input: { threadId: string },
): Promise<ResearchScope | null> {
  const { rows } = await db.query<{ research_scope: unknown }>(
    `select m.research_scope
       from chat_messages m
      where m.thread_id = $1::uuid
        and m.role = 'assistant'
        and m.snapshot_id is not null
        and m.research_scope is not null
      order by m.created_at desc
      limit 1`,
    [input.threadId],
  );
  return parseResearchScope(rows[0]?.research_scope ?? null);
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

export function narrativeText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    // Commentary appended to an answer is not what the answer said.
    .filter((block) => block?.kind === "rich_text" && Array.isArray(block.segments) && block.analyst_commentary !== true)
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
