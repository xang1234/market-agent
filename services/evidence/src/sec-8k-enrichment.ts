// 8-K LLM enrichment (fra-ajvd.6): the deterministic handler writes a generic
// claim per material-event Item ("Material event reported via 8-K: restatement
// (4.02)."); this batch step LLM-extracts a narrative of WHAT actually happened for
// high-severity items and AUGMENTS that claim's text in place (claims.enriched_at
// marks it, gating idempotency + signalling the text is LLM-derived, not the
// deterministic template). A batch/CLI step — never the atomic crawl — because the
// LLM call is external/slow (same constraint as the OpenFIGI CUSIP harvest).
import type { QueryExecutor } from "./types.ts";
import type { SecFilingFetcher } from "./sec-edgar.ts";
import { writeToolCallLog } from "../../observability/src/tool-call.ts";
import type { LlmChatMessage, LlmChatRequest, LlmRouterResult } from "../../llm/src/router.ts";

// High-severity material events worth a narrative (the deterministic event-type alone
// is too coarse for these). Keyed by the persisted claim predicate.
const HIGH_SEVERITY_EVENT_TYPES = ["bankruptcy", "restatement", "delisting", "m_and_a", "auditor_change"] as const;
const HIGH_SEVERITY_PREDICATES = HIGH_SEVERITY_EVENT_TYPES.map((t) => `material_event.${t}`);

// 8-K bodies (the Item narrative) sit early in the full-submission .txt, before the
// exhibits; cap the prompt input so a large exhibit-heavy filing stays affordable.
const MAX_FILING_CHARS = 16_000;

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
// uuid) rather than the text attributed_to_id.
export async function findEnrich8kCandidates(db: QueryExecutor, limit = 100): Promise<Enrich8kCandidate[]> {
  const { rows } = await db.query<{ claim_id: string; predicate: string; accession: string; cik: string }>(
    `select c.claim_id::text as claim_id,
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
      order by c.created_at
      limit $2`,
    [HIGH_SEVERITY_PREDICATES, limit],
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
      content: `Material event type: ${eventType.replace(/_/g, " ")}.\n\n8-K filing text:\n${filingText.slice(0, MAX_FILING_CHARS)}`,
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
  return typeof description === "string" ? description.trim() : null;
}

// Enrich one candidate: fetch the filing, LLM-extract a narrative, and augment the
// deterministic claim's text in place (enriched_at = now()). Records the LLM call as a
// tool_call_log (the provenance contract for LLM-derived content). Returns the outcome;
// transport errors from the LLM/fetch propagate so a batch run can fail the item and retry.
export async function enrich8kClaim(deps: Enrich8kDeps, candidate: Enrich8kCandidate): Promise<Enrich8kOutcome> {
  const fetched = await deps.secClient.fetchFiling({
    cik: candidate.issuerCik,
    accession_number: candidate.accession,
    document: `${candidate.accession}.txt`,
  });
  const filingText = new TextDecoder("utf-8").decode(fetched.bytes);
  const completion = await deps.llm.complete({
    messages: buildEnrichmentMessages(candidate.eventType, filingText),
    temperature: 0,
    maxTokens: 500,
  });
  const description = parseEnrichmentDescription(completion.text);
  if (description === null) return "unparseable";
  if (description === "") return "empty";

  // Augment in place (idempotent: the enriched_at guard means a concurrent/rerun no-ops).
  await deps.db.query(
    `update claims set text_canonical = $1, enriched_at = now() where claim_id = $2 and enriched_at is null`,
    [description, candidate.claimId],
  );
  await writeToolCallLog(deps.db, {
    tool_name: "enrich_8k",
    args: { claim_id: candidate.claimId, accession: candidate.accession, event_type: candidate.eventType, model: completion.deployment.model },
    result: { description },
    status: "ok",
  });
  return "enriched";
}
