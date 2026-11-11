// What a follow-up turn knows about its thread: the companies the previous
// answer covered (so "compare it with AMD" can refer back), and the recent
// conversation (so the narrative reads as a reply, not a fresh answer).

import { hydrateSubjectRef, type HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { parseResearchScope, type ResearchScope } from "./research-scope.ts";
import type { ChatResolvedSubjectPreResolution } from "./subjects.ts";
import type { QueryExecutor } from "../../shared/src/http.ts";

type Hydrate = (db: QueryExecutor, ref: SubjectRef) => Promise<HydratedSubjectHandoff>;

export type PreviousAnswer = Readonly<{ snapshot_id: string; scenarios: boolean }>;

/**
 * The thread's previous financial answer, for its owner: the latest assistant
 * message, looking past this thread's own price comparison declines and
 * refusals (#224), which their block marks (comparison_gap), so the ask a
 * decline suggests works next. A price comparison stands for the scenario
 * answer it compared: a follow-up to it, a comparison or "make bull 35",
 * follows that answer. `scenarios` says whether the answer presented P/E
 * scenarios. Null when the message is neither.
 */
export async function previousAnswer(db: QueryExecutor, threadId: string, userId: string): Promise<PreviousAnswer | null> {
  const { rows } = await db.query<PreviousAnswer>(
    `select case when m.blocks->0->>'kind' = 'financial_answer' then m.snapshot_id::text
                 else m.blocks->0->'comparison'->'scenario'->>'snapshot_id' end as snapshot_id,
            m.blocks->0->>'kind' = 'scenario_price_comparison' or m.blocks->0->'financial'->'presentations' @> '[{"kind": "scenarios"}]'::jsonb as scenarios
       from (select snapshot_id, blocks from chat_messages
              where thread_id = $1::uuid and role = 'assistant' and blocks->0->'comparison_gap' is null
              order by created_at desc, message_id desc limit 1) m
       join chat_threads t on t.thread_id = $1::uuid and t.user_id = $2::uuid
      where m.blocks->0->>'kind' in ('financial_answer', 'scenario_price_comparison')`,
    [threadId, userId],
  );
  return rows[0]?.snapshot_id ? rows[0] : null;
}

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
        -- An answer about no company (a notice, or a gap or clarification
        -- that names none) leaves the earlier companies in place, as it
        -- leaves the scope (loadPriorScope). A metric or request clarification names
        -- the companies it asked about, so a typed reply continues them (#623).
        -- A price comparison (#224) names the listing its close is of; the
        -- company a follow-up continues is the scenario answer's it compared.
        and m.blocks->0->>'kind' is distinct from 'scenario_price_comparison'
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

// The answer an evidence follow-up in thread $1 re-reads: the latest that
// saved a scope and is not itself an evidence follow-up, so "Show the
// evidence" asked twice re-reads the same one.
export const RE_READ_ANSWER_SQL = `select m.snapshot_id, m.blocks
               from chat_messages m
              where m.thread_id = $1::uuid
                and m.role = 'assistant'
                and m.snapshot_id is not null
                and m.research_scope is not null
                and m.research_scope->>'route' is distinct from 'evidence_followup'
              order by m.created_at desc
              limit 1`;

// The claims the answer an evidence follow-up re-reads quoted as the filed
// cause of its figures (#542), as its child snapshot seals them; none when it
// quoted none.
export async function loadPriorCauseClaims(
  db: QueryExecutor,
  input: { threadId: string },
): Promise<ReadonlyArray<string>> {
  const { rows } = await db.query<{ claim_refs: unknown }>(
    `select cause.claim_refs
       from (${RE_READ_ANSWER_SQL}) answer
       join snapshots cause on cause.parent_snapshot = answer.snapshot_id
      order by cause.created_at, cause.snapshot_id`,
    [input.threadId],
  );
  return rows.flatMap((row) => Array.isArray(row.claim_refs) ? row.claim_refs.filter((ref): ref is string => typeof ref === "string") : []);
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
