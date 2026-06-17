// 8-K LLM enrichment (fra-ajvd.6): the deterministic handler writes a generic claim per
// material-event Item ("Material event reported via 8-K: restatement (4.02)."), recording
// THAT an event happened, not WHAT. This batch step LLM-extracts a narrative of what
// happened for high-severity items and records it as a SEPARATE `material_event.<type>.detail`
// claim — attached to the same issuer + event — leaving the deterministic claim untouched.
// That separation matters: the deterministic claim may already be in a cluster signature or
// a sealed snapshot's citations, and mutating its text in place would desync those (a second
// cluster, a citation showing text the snapshot never sealed). claims.enriched_at on the
// deterministic claim marks it processed (idempotency). A batch/CLI step — never the atomic
// crawl — because the LLM call is external/slow (same constraint as the OpenFIGI harvest).
import type { QueryExecutor } from "./types.ts";
import type { SecFilingFetcher } from "./sec-edgar.ts";
import { withTransaction } from "./transaction.ts";
import { createClaim } from "./claim-repo.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
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
  m_and_a: "merger, acquisition, or disposition of assets",
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

// The detail claim is purely LLM-derived prose; a confidence below the deterministic
// claim's 0.9 reflects that the EVENT is certain but its narrative is model-extracted.
const ENRICHED_CONFIDENCE = 0.8;

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
  claimId: string; // the deterministic material_event claim — marked processed, never mutated
  eventType: string;
  accession: string;
  issuerCik: number;
  issuerId: string;
  documentId: string;
  sourceId: string;
  effectiveTime: string | null;
};

// "noop" = the claim's enriched_at was already stamped between discovery and the update
// (a concurrent run/worker), so this call applied nothing and recorded no audit row.
export type Enrich8kOutcome = "enriched" | "empty" | "unparseable" | "noop";

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
  const { rows } = await db.query<{
    claim_id: string;
    predicate: string;
    accession: string;
    cik: string;
    issuer_id: string;
    document_id: string;
    source_id: string;
    effective_time: Date | string | null;
  }>(
    // effective_time is selected uncast so pg returns a Date we can render as ISO-8601;
    // a ::text cast would yield "2026-06-14 00:00:00+00" (no T), which createClaim rejects.
    `select distinct on (c.claim_id)
            c.claim_id::text as claim_id,
            c.predicate,
            d.provider_doc_id as accession,
            i.cik,
            ca.subject_id::text as issuer_id,
            c.document_id::text as document_id,
            c.reported_by_source_id::text as source_id,
            c.effective_time
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
      issuerId: row.issuer_id,
      documentId: row.document_id,
      sourceId: row.source_id,
      effectiveTime: row.effective_time == null ? null : new Date(row.effective_time).toISOString(),
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

// Enrich one candidate: fetch the filing, LLM-extract a narrative, and record it as a
// SEPARATE material_event.<type>.detail claim (attached to the same issuer + event). The
// deterministic claim is NEVER mutated — only its enriched_at is stamped (idempotency) —
// so a cluster signature or sealed snapshot that already cited it stays valid. Returns
// the outcome; transport errors propagate so a batch run can fail-and-retry the item.
//
// The detail claim + the enriched_at stamp + the audit log are one transaction, and the
// stamp is rowCount-guarded: if a concurrent run already processed this deterministic
// claim, the guarded update no-ops and nothing is created or logged ("noop"). An empty or
// unparseable LLM result still stamps enriched_at (the temp-0 result is deterministic, so
// re-running wouldn't change it) but creates no detail claim. The tool_call_log is an
// audit trail, not a seal-consumable provenance link — a snapshot citing the detail claim
// re-establishes tool-call provenance at seal time (the seal is fail-closed). The detail
// claim's confidence is ENRICHED_CONFIDENCE (LLM prose), below the deterministic 0.9.
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

  let applied = false;
  await withTransaction(deps.db, async (tx) => {
    // Mark the deterministic claim processed; the rowCount guard makes a concurrent
    // double-run a no-op rather than a duplicate detail claim.
    const stamped = await tx.db.query(
      `update claims set enriched_at = now() where claim_id = $1 and enriched_at is null`,
      [candidate.claimId],
    );
    if ((stamped.rowCount ?? 0) === 0) return; // a concurrent run already processed this claim
    applied = true;

    let detailClaimId: string | null = null;
    if (narrative !== null) {
      // Record the narrative as a separate claim — the deterministic claim (and anything
      // that already cited it) is left untouched.
      const detail = await createClaim(tx.db, {
        document_id: candidate.documentId,
        predicate: `material_event.${candidate.eventType}.detail`,
        text_canonical: narrative,
        polarity: "neutral",
        modality: "asserted",
        reported_by_source_id: candidate.sourceId,
        attributed_to_type: "issuer",
        attributed_to_id: candidate.issuerId,
        effective_time: candidate.effectiveTime,
        confidence: ENRICHED_CONFIDENCE,
        status: "extracted",
      });
      await createClaimArgument(tx.db, { claim_id: detail.claim_id, subject_kind: "issuer", subject_id: candidate.issuerId, role: "subject" });
      // Attach the detail to the same event as the deterministic claim (it's in exactly one).
      await tx.db.query(
        `update events set source_claim_ids = source_claim_ids || to_jsonb($1::text)
          where source_claim_ids @> jsonb_build_array($2::text)`,
        [detail.claim_id, candidate.claimId],
      );
      detailClaimId = detail.claim_id;
    }
    await writeToolCallLog(tx.db, {
      tool_name: "enrich_8k",
      args: { claim_id: candidate.claimId, accession: candidate.accession, event_type: candidate.eventType, model: completion.deployment.model },
      result: { outcome, detail_claim_id: detailClaimId },
      status: outcome === "enriched" ? "ok" : outcome === "empty" ? "skipped" : "partial",
    });
  });
  return applied ? outcome : "noop";
}

export type Enrich8kDrainResult = { enriched: number; empty: number; unparseable: number; noop: number; failed: number };

// Drain the full high-severity backlog: page by a claim_id keyset, advancing the cursor
// even on a failure so a failing claim never blocks the rest of the run. Every terminal
// outcome stamps enriched_at (so the claim drops out of future runs); a transport error
// leaves it a candidate for the next invocation. onClaim reports per-claim progress for a
// CLI; the aggregate counts (including failures) are returned.
export async function runEnrich8kDrain(
  deps: Enrich8kDeps,
  opts: { pageSize?: number; onClaim?: (candidate: Enrich8kCandidate, result: Enrich8kOutcome | { error: unknown }) => void } = {},
): Promise<Enrich8kDrainResult> {
  const result: Enrich8kDrainResult = { enriched: 0, empty: 0, unparseable: 0, noop: 0, failed: 0 };
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
