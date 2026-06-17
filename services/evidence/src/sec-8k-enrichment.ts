// 8-K LLM enrichment (fra-ajvd.6): the deterministic handler writes a generic
// claim per material-event Item ("Material event reported via 8-K: restatement
// (4.02)."); this batch step LLM-extracts a narrative of WHAT actually happened for
// high-severity items and AUGMENTS that claim's text in place (claims.enriched_at
// marks it, gating idempotency + signalling the text is LLM-derived, not the
// deterministic template). A batch/CLI step — never the atomic crawl — because the
// LLM call is external/slow (same constraint as the OpenFIGI CUSIP harvest).
import type { QueryExecutor } from "./types.ts";
import type { SecFilingFetcher } from "./sec-edgar.ts";
import { withTransaction } from "./transaction.ts";
import { writeToolCallLog } from "../../observability/src/tool-call.ts";
import type { LlmChatMessage, LlmChatRequest, LlmRouterResult } from "../../llm/src/router.ts";

// High-severity material events worth a narrative (the deterministic event-type alone
// is too coarse for these). Keyed by the persisted claim predicate.
const HIGH_SEVERITY_EVENT_TYPES = ["bankruptcy", "restatement", "delisting", "m_and_a", "auditor_change"] as const;
const HIGH_SEVERITY_PREDICATES = HIGH_SEVERITY_EVENT_TYPES.map((t) => `material_event.${t}`);

// Human-readable event labels for the prompt — naive underscore-stripping turns
// "m_and_a" into "m and a", a poor hint for the model.
const EVENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  bankruptcy: "bankruptcy or receivership",
  restatement: "financial restatement (non-reliance on previously issued financials)",
  delisting: "delisting or transfer of listing",
  m_and_a: "merger or acquisition",
  auditor_change: "change of certifying accountant (auditor)",
};

// Keyset paging sentinel: claim_id > this matches every claim (uuid order).
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// Cap the prompt input so a large exhibit-heavy filing stays affordable. Windowed from
// the <DOCUMENT> body (see extractFilingBody) so the budget covers the Item narrative,
// not the SGML <SEC-HEADER>/cover boilerplate.
const MAX_FILING_CHARS = 16_000;

// A material-event narrative is one or two sentences; reject a model that ignores that
// and returns a runaway blob rather than writing it into the claim's text column.
const MAX_DESCRIPTION_CHARS = 1_000;

// Window the full-submission .txt from its first <DOCUMENT> (the primary 8-K body),
// skipping the <SEC-HEADER> metadata so the truncation budget lands on the Item text.
export function extractFilingBody(filingText: string): string {
  const start = filingText.indexOf("<DOCUMENT>");
  return start >= 0 ? filingText.slice(start) : filingText;
}

// The LLM client surface this needs — the llm router's `complete` satisfies it, and a
// test can inject a fake without booting a provider.
export type Enrich8kLlm = { complete(request: LlmChatRequest): Promise<LlmRouterResult> };

export type Enrich8kDeps = {
  db: QueryExecutor;
  llm: Enrich8kLlm;
  secClient: SecFilingFetcher;
};

export type Enrich8kCandidate = {
  claimId: string;
  eventType: string;
  accession: string;
  issuerCik: number;
};

export type Enrich8kOutcome = "enriched" | "empty" | "unparseable";

// High-severity 8-K claims not yet LLM-enriched, with the CIK + accession needed to
// re-fetch the filing. Joined through claim_arguments (subject_id is a typed issuer
// uuid) rather than the text attributed_to_id; distinct on (claim_id) guards against a
// future claim with multiple issuer args. Paged by a claim_id keyset (afterClaimId) so
// the drain advances past failures without an in-memory seen-set.
//
// No `superseded_at is null` filter (unlike the sibling claim-selection queries in
// local-runtime-evidence / inferred-membership): only insider.transaction claims are
// ever superseded (see insider-transactions-repo), so a material_event claim can't be.
export async function findEnrich8kCandidates(
  db: QueryExecutor,
  opts: { afterClaimId?: string; limit?: number } = {},
): Promise<Enrich8kCandidate[]> {
  const { rows } = await db.query<{ claim_id: string; predicate: string; accession: string; cik: string }>(
    `select distinct on (c.claim_id)
            c.claim_id::text as claim_id,
            c.predicate,
            d.provider_doc_id as accession,
            i.cik
       from claims c
       join claim_arguments ca on ca.claim_id = c.claim_id and ca.subject_kind = 'issuer'
       join documents d on d.document_id = c.document_id
       join issuers i on i.issuer_id = ca.subject_id
      where c.predicate = any($1::text[])
        and c.enriched_at is null
        and i.cik is not null
        and c.claim_id > $2::uuid
      order by c.claim_id
      limit $3`,
    [HIGH_SEVERITY_PREDICATES, opts.afterClaimId ?? ZERO_UUID, opts.limit ?? 100],
  );
  return rows.flatMap((row) => {
    const issuerCik = Number(row.cik);
    if (!Number.isInteger(issuerCik) || issuerCik <= 0) return [];
    return [{
      claimId: row.claim_id,
      eventType: row.predicate.replace(/^material_event\./, ""),
      accession: row.accession,
      issuerCik,
    }];
  });
}

function buildEnrichmentMessages(eventType: string, filingText: string): LlmChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You extract a concise, factual description of a material corporate event from an SEC 8-K filing. " +
        'Respond ONLY with minified JSON: {"description":"<one or two factual sentences>"}. ' +
        "State only what the filing says — no speculation, no investment commentary. " +
        'If the filing text does not actually describe the event, return {"description":""}.',
    },
    {
      role: "user",
      content: `Material event type: ${EVENT_TYPE_LABELS[eventType] ?? eventType.replace(/_/g, " ")}.\n\n8-K filing text:\n${filingText.slice(0, MAX_FILING_CHARS)}`,
    },
  ];
}

// Parse the LLM's {"description": "..."} (tolerating ```json fences), or null when the
// output isn't the expected shape — the caller then records an unparseable outcome and
// leaves the deterministic claim untouched.
export function parseEnrichmentDescription(text: string): string | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const description = (parsed as Record<string, unknown>).description;
  if (typeof description !== "string") return null;
  const trimmed = description.trim();
  // A runaway blob (model ignored "one or two sentences") is treated as unparseable
  // rather than written into the claim's text column.
  return trimmed.length > MAX_DESCRIPTION_CHARS ? null : trimmed;
}

// Enrich one candidate: fetch the filing, LLM-extract a narrative, and augment the
// deterministic claim's text in place. Returns the outcome; transport errors from the
// LLM/fetch propagate so a batch run can fail the item and retry.
//
// Confidence is intentionally NOT lowered: the event detection (predicate
// material_event.<type>) is deterministic and certain; only the descriptive prose is
// LLM-derived, and enriched_at marks that. The tool_call_log is an AUDIT trail of the
// enrichment, not a seal-consumable provenance link — claims carry no tool-call FK and
// the snapshot seal recomputes its own provenance. If an enriched claim is ever cited in
// a snapshot block, that block must re-establish tool-call provenance at seal time (as
// the analyst-grid reader does); the seal is fail-closed, so LLM text cannot pass as
// deterministic. The augment + audit log are written in one transaction so an enriched
// claim is never left unlogged.
export async function enrich8kClaim(deps: Enrich8kDeps, candidate: Enrich8kCandidate): Promise<Enrich8kOutcome> {
  const fetched = await deps.secClient.fetchFiling({
    cik: candidate.issuerCik,
    accession_number: candidate.accession,
    document: `${candidate.accession}.txt`,
  });
  const filingText = new TextDecoder("utf-8").decode(fetched.bytes);
  const completion = await deps.llm.complete({
    messages: buildEnrichmentMessages(candidate.eventType, extractFilingBody(filingText)),
    temperature: 0,
    maxTokens: 500,
  });
  const description = parseEnrichmentDescription(completion.text);
  const outcome: Enrich8kOutcome = description === null ? "unparseable" : description === "" ? "empty" : "enriched";
  const narrative = outcome === "enriched" ? description : null; // derived from outcome so they can't disagree

  // Mark the claim attempted (enriched_at) for EVERY terminal outcome — not just success
  // — and augment the text only when there's a narrative. The LLM runs at temperature 0,
  // so an empty/unparseable result is deterministic for a given filing: re-fetching +
  // re-calling it on every batch run would never change, so marking it keeps the batch
  // idempotent. A transport error throws before this point, so it stays a candidate for
  // retry. The claim update + audit log are one transaction, so a committed enrichment is
  // always logged; the tool_call status records the outcome (ok / skipped-empty /
  // partial-unparseable — never "error", which is reserved for the throwing transport path).
  await withTransaction(deps.db, async (tx) => {
    if (narrative !== null) {
      await tx.db.query(
        `update claims set text_canonical = $1, enriched_at = now() where claim_id = $2 and enriched_at is null`,
        [narrative, candidate.claimId],
      );
    } else {
      await tx.db.query(`update claims set enriched_at = now() where claim_id = $1 and enriched_at is null`, [candidate.claimId]);
    }
    await writeToolCallLog(tx.db, {
      tool_name: "enrich_8k",
      args: { claim_id: candidate.claimId, accession: candidate.accession, event_type: candidate.eventType, model: completion.deployment.model },
      result: { outcome, description: narrative },
      status: outcome === "enriched" ? "ok" : outcome === "empty" ? "skipped" : "partial",
    });
  });
  return outcome;
}

export type Enrich8kDrainResult = { enriched: number; empty: number; unparseable: number; failed: number };

// Drain the full high-severity backlog: page by a claim_id keyset, advancing the cursor
// even on a failure so a failing claim never blocks the rest of the run. Every terminal
// outcome stamps enriched_at (so the claim drops out of future runs); a transport error
// leaves it a candidate for the next invocation. onClaim reports per-claim progress for a
// CLI; the aggregate counts (including failures) are returned.
export async function runEnrich8kDrain(
  deps: Enrich8kDeps,
  opts: { pageSize?: number; onClaim?: (candidate: Enrich8kCandidate, result: Enrich8kOutcome | { error: unknown }) => void } = {},
): Promise<Enrich8kDrainResult> {
  const result: Enrich8kDrainResult = { enriched: 0, empty: 0, unparseable: 0, failed: 0 };
  let cursor = ZERO_UUID;
  for (;;) {
    const page = await findEnrich8kCandidates(deps.db, { afterClaimId: cursor, limit: opts.pageSize ?? 100 });
    if (page.length === 0) break;
    for (const candidate of page) {
      cursor = candidate.claimId; // advance even on failure → never re-fetch a failing claim this run
      try {
        const outcome = await enrich8kClaim(deps, candidate);
        result[outcome] += 1;
        opts.onClaim?.(candidate, outcome);
      } catch (error) {
        result.failed += 1;
        opts.onClaim?.(candidate, { error });
      }
    }
  }
  return result;
}
