// Business and risk claims from a 10-K's Item 1 and Item 1A. A model picks the
// sentences that describe the business, its products, customers and
// competition, and the risk factors; each is kept only if it is a verbatim
// quote of its section (verifyStatement), so the stored claim is the filing's
// own words. Each competitor a quote names becomes a claim argument when the
// resolver finds exactly one issuer for it.
//
// A document is read once: its parse_status leaves 'pending' in the same
// transaction that stores its claims, guarded by rowCount, so a rerun or a
// concurrent run adds nothing.

import { createHash } from "node:crypto";

import { normalizeNameForLookup, resolveByNameCandidate } from "../../resolver/src/lookup.ts";
import type { LlmChatMessage } from "../../llm/src/router.ts";
import { writeToolCallLog } from "../../observability/src/tool-call.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
import { createClaimEvidence } from "./claim-evidence-repo.ts";
import { createClaim } from "./claim-repo.ts";
import { ingestDocument } from "./ingest.ts";
import { createMention } from "./mention-repo.ts";
import { contentHashFromBytes, type ObjectStore } from "./object-store.ts";
import { canonicalText, completeLogged, releasePrompts, verifyStatement, type ExtractReleaseLlm } from "./sec-earnings-release-extraction.ts";
import { recentSubmissionRows, type SecFilingFetcher, type SecSubmissions } from "./sec-edgar.ts";
import { tenKSections, TEN_K_ITEMS, type TenKItem, type TenKSection } from "./sec-10k-sections.ts";
import { createSource } from "./source-repo.ts";
import { withTransaction } from "./transaction.ts";
import type { QueryExecutor } from "./types.ts";

export const TEN_K_PREDICATES = {
  "1": ["business.description", "business.products", "business.customers", "business.competition"],
  "1A": ["risk.factor"],
} as const satisfies Record<TenKItem, ReadonlyArray<string>>;
export type TenKPredicate = (typeof TEN_K_PREDICATES)[TenKItem][number];

export type TenKClaim = { predicate: TenKPredicate; quote: string; competitors: string[] };

const MAX_CLAIMS: Readonly<Record<TenKItem, number>> = { "1": 16, "1A": 15 };
// verifyStatement's bounds on a quote.
const MIN_QUOTE_CHARS = 20;
const MAX_QUOTE_CHARS = 600;
// The words are verified; their reading as a predicate is the model's.
const TEN_K_CONFIDENCE = 0.8;

// The issuer id a competitor's name resolves to, or null.
export type ResolveCompetitor = (name: string) => Promise<string | null>;

export type Extract10kDeps = { db: QueryExecutor; llm: ExtractReleaseLlm; resolveCompetitor: ResolveCompetitor };

export type TenKDocument = {
  documentId: string;
  sourceId: string;
  issuerId: string;
  html: string;
  effectiveTime: string | null;
};

// "already_extracted": the document was read before, so nothing ran.
// "unparseable": a reply of the wrong shape, or none of whose quotes is in the
// filing, so nothing is stored and the document stays unread for the next run.
// "no_sections": neither item was found, and the document is marked failed.
export type Extract10kOutcome = "extracted" | "already_extracted" | "unparseable" | "no_sections";
export type Extract10kResult = {
  outcome: Extract10kOutcome;
  extracted: number;
  droppedUnquoted: number;
  competitors: { resolved: number; named: number };
  missing: TenKItem[];
  llmCalls: number;
};

// The model's reply for a section, or null when it is not the expected shape.
// A claim whose predicate is not the section's makes the whole reply null, as
// for an earnings release: the document is read again rather than half-stored.
export function parseTenKReply(text: string, item: TenKItem): TenKClaim[] | null {
  let reply: unknown;
  try {
    reply = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const items = (reply as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(items)) return null;
  const claims: TenKClaim[] = [];
  for (const entry of items.slice(0, MAX_CLAIMS[item])) {
    const { predicate, quote, competitors = [] } = (entry ?? {}) as Record<string, unknown>;
    if (
      typeof quote !== "string" ||
      !(TEN_K_PREDICATES[item] as ReadonlyArray<unknown>).includes(predicate) ||
      !Array.isArray(competitors) ||
      !competitors.every((name) => typeof name === "string")
    ) {
      return null;
    }
    claims.push({ predicate: predicate as TenKPredicate, quote, competitors });
  }
  return claims;
}

const QUOTE_RULES = [
  "quote is copied EXACTLY from the text, character for character: one or two whole sentences, or one whole bulleted list item, no paraphrase,",
  "no ellipsis, nothing added. A quote that is not in the text is discarded.",
];

function buildMessages(item: TenKItem, text: string): LlmChatMessage[] {
  const rules = item === "1"
    ? [
      "You read Item 1 (Business) of a company's SEC 10-K annual report, or part of it, and pick the sentences that state facts about its business.",
      'Reply with minified JSON only: {"claims":[{"predicate":"<predicate>","quote":"<sentence>","competitors":["<company>"]}]}',
      "predicate is one of: business.description (what the company is and does, its segments and strategy);",
      "business.products (its products, services and platforms); business.customers (who its customers are, customer concentration);",
      "business.competition (who it competes with, and on what).",
      "competitors lists each company a business.competition quote names as a competitor, written exactly as in the quote; [] otherwise.",
      ...QUOTE_RULES,
      "Pick at least one sentence for each predicate the text supports.",
      `At most ${MAX_CLAIMS[item]} claims, the most informative first. If there are none, reply with {"claims":[]}.`,
    ]
    : [
      "You read Item 1A (Risk Factors) of a company's SEC 10-K annual report, or part of it, and pick the sentences that state its material risks,",
      "usually each risk factor's own heading sentence.",
      'Reply with minified JSON only: {"claims":[{"predicate":"risk.factor","quote":"<sentence>"}]}',
      ...QUOTE_RULES,
      "Skip summaries that only list risks covered later, and generic statements that any company could make.",
      `At most ${MAX_CLAIMS[item]} claims, the most material first. If there are none, reply with {"claims":[]}.`,
    ];
  return [{ role: "system", content: rules.join("\n") }, { role: "user", content: text }];
}

// One whole bulleted list item, which a 10-K uses where a release writes a
// sentence ("Our current competitors include: • suppliers ..., such as
// Advanced Micro Devices, Inc., or AMD, ...; • large cloud services
// companies..."): an item ending in a semicolon is no sentence, so
// verifyStatement never finds it. The stored quote leaves out the bullet.
function wholeListItem(claim: TenKClaim, section: TenKSection): (TenKClaim & { exhibit: string; start: number; end: number }) | null {
  const quote = canonicalText(claim.quote).replace(/^•\s*/, "");
  if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS) return null;
  for (let start = section.text.indexOf(quote); start >= 0; start = section.text.indexOf(quote, start + 1)) {
    const end = start + quote.length;
    if (section.text.slice(start - 2, start) === "• " && section.edges.has(start - 2) && section.edges.has(end)) {
      return { ...claim, quote, exhibit: section.type, start, end };
    }
  }
  return null;
}

type VerifiedClaim = TenKClaim & { item: TenKItem; start: number; end: number; issuerIds: string[] };

// Extract one 10-K document's claims and store the verified ones. Transport
// errors propagate and store nothing, so the document stays unread.
export async function extract10kClaims(deps: Extract10kDeps, doc: TenKDocument): Promise<Extract10kResult> {
  const started = { extracted: 0, droppedUnquoted: 0, competitors: { resolved: 0, named: 0 }, llmCalls: 0 };
  const { rows: [status] } = await deps.db.query<{ parse_status: string }>(
    `select parse_status from documents where document_id = $1`,
    [doc.documentId],
  );
  const sections = tenKSections(doc.html);
  const found = TEN_K_ITEMS.flatMap((item) => "error" in sections[item] ? [] : [sections[item] as TenKSection]);
  const missing = TEN_K_ITEMS.filter((item) => "error" in sections[item]);
  if (status?.parse_status !== "pending") return { ...started, outcome: "already_extracted", missing };
  if (found.length === 0) {
    await deps.db.query(`update documents set parse_status = 'failed' where document_id = $1 and parse_status = 'pending'`, [doc.documentId]);
    return { ...started, outcome: "no_sections", missing };
  }

  // Every prompt runs at once: a 10-K is three or four, and run one by one
  // they take minutes.
  const prompts = found.flatMap((section) => releasePrompts([section]).map((text) => ({ section, text })));
  const replies = await Promise.all(prompts.map(async ({ section, text }, index) => {
    const completion = await completeLogged(
      deps,
      "extract_10k_claims.prompt",
      { document_id: doc.documentId, item: section.type, prompt: index + 1, prompts: prompts.length },
      buildMessages(section.type, text),
    );
    return { section, model: completion.model, claims: parseTenKReply(completion.text, section.type) };
  }));

  let unparseable = false;
  let droppedUnquoted = 0;
  const verified = new Map<string, VerifiedClaim>();
  for (const { section, claims } of replies) {
    const checked = (claims ?? []).map((claim) => ({ claim, found: verifyStatement(claim, [section]) ?? wholeListItem(claim, section) }));
    if (claims === null || (checked.length > 0 && checked.every((pick) => pick.found === null))) unparseable = true;
    for (const { found } of checked) {
      if (found === null) {
        droppedUnquoted += 1;
        continue;
      }
      const key = JSON.stringify([found.predicate, found.quote]);
      const prior = verified.get(key);
      // A competitor counts only on a competition claim, and only if its
      // quote names it: a risk factor names partners and customers too.
      const named = found.predicate !== "business.competition" ? [] : found.competitors.map((name) => name.trim()).filter((name) => name !== "" && found.quote.toLowerCase().includes(name.toLowerCase()));
      verified.set(key, {
        ...found,
        item: section.type,
        competitors: [...new Set([...(prior?.competitors ?? []), ...named])],
        issuerIds: [],
      });
    }
  }
  const model = replies[0]?.model ?? null;
  const args = { document_id: doc.documentId, model };
  if (unparseable) {
    await writeToolCallLog(deps.db, { tool_name: "extract_10k_claims", args, result: { outcome: "unparseable", proposed: replies.length }, status: "partial" });
    return { ...started, outcome: "unparseable", droppedUnquoted, missing, llmCalls: prompts.length };
  }

  let named = 0;
  for (const claim of verified.values()) {
    for (const name of claim.competitors) {
      named += 1;
      const issuerId = await deps.resolveCompetitor(name);
      if (issuerId !== null && issuerId !== doc.issuerId && !claim.issuerIds.includes(issuerId)) claim.issuerIds.push(issuerId);
    }
  }

  return withTransaction(deps.db, async (tx) => {
    const stamped = await tx.db.query(
      `update documents set parse_status = 'parsed' where document_id = $1 and parse_status = 'pending'`,
      [doc.documentId],
    );
    if ((stamped.rowCount ?? 0) === 0) return { ...started, outcome: "already_extracted" as const, missing };
    const claimIds: string[] = [];
    let resolved = 0;
    for (const claim of verified.values()) {
      const row = await createClaim(tx.db, {
        document_id: doc.documentId,
        predicate: claim.predicate,
        text_canonical: claim.quote,
        polarity: claim.predicate === "risk.factor" ? "negative" : "neutral",
        modality: "quoted",
        reported_by_source_id: doc.sourceId,
        attributed_to_type: "issuer",
        attributed_to_id: doc.issuerId,
        effective_time: doc.effectiveTime,
        confidence: TEN_K_CONFIDENCE,
        status: "extracted",
      });
      await createClaimArgument(tx.db, { claim_id: row.claim_id, subject_kind: "issuer", subject_id: doc.issuerId, role: "subject" });
      for (const issuerId of claim.issuerIds) {
        await createClaimArgument(tx.db, { claim_id: row.claim_id, subject_kind: "issuer", subject_id: issuerId, role: "competitor" });
        resolved += 1;
      }
      await createClaimEvidence(tx.db, {
        claim_id: row.claim_id,
        document_id: doc.documentId,
        locator: { item: claim.item, start: claim.start, end: claim.end, text_basis: "sec_10k_item_canonical_text.v1" },
        excerpt_hash: createHash("sha256").update(claim.quote).digest("hex"),
        confidence: 1,
      });
      claimIds.push(row.claim_id);
    }
    const competitors = { resolved, named };
    await writeToolCallLog(tx.db, {
      tool_name: "extract_10k_claims",
      args,
      result: { outcome: "extracted", missing, claim_ids: claimIds, dropped_unquoted: droppedUnquoted, competitors },
      status: claimIds.length > 0 ? "ok" : "skipped",
    });
    return { outcome: "extracted" as const, extracted: claimIds.length, droppedUnquoted, competitors, missing, llmCalls: prompts.length };
  });
}

// A competitor's issuer by name: as written, else its stem with each
// corporate suffix, since a 10-K writes "Intel Corporation" and "Qualcomm
// Incorporated" and the issuers are "Intel Corp" and "Qualcomm Inc". Only a
// single issuer counts; an ambiguous name stores no row. ponytail: a brand
// that is not the legal name ("Google", "AMD") stays unresolved.
const SUFFIX = / (?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc)$/;
const SUFFIXES = [" inc", " corp", " corporation", " co", " ltd", " plc"];
export async function resolveCompetitorByName(db: QueryExecutor, name: string): Promise<string | null> {
  const written = normalizeNameForLookup(name);
  const stem = written.replace(SUFFIX, "");
  if (stem === "") return null;
  for (const candidate of new Set([written, ...SUFFIXES.map((suffix) => stem + suffix)])) {
    const envelope = await resolveByNameCandidate(db, candidate);
    if (envelope.outcome === "resolved" && envelope.subject_ref.kind === "issuer") return envelope.subject_ref.id;
    if (envelope.outcome === "ambiguous") return null;
  }
  return null;
}

// Store a 10-K's bytes as an evidence document of the issuer, or find the one
// already stored with the same bytes, and assert the issuer mention reader
// document selection queries on.
export async function storeTenK(
  deps: { db: QueryExecutor; objectStore: ObjectStore },
  input: { issuerId: string; bytes: Uint8Array; url: string | null; accession: string | null; filedDate: string | null; retrievedAt: string },
): Promise<{ documentId: string; sourceId: string }> {
  const { rows: [existing] } = await deps.db.query<{ document_id: string; source_id: string }>(
    `select document_id::text as document_id, source_id::text as source_id from documents
      where content_hash = $1 and deleted_at is null order by created_at limit 1`,
    [contentHashFromBytes(input.bytes)],
  );
  let stored = existing ? { documentId: existing.document_id, sourceId: existing.source_id } : null;
  if (stored === null) {
    const source = await createSource(deps.db, {
      provider: "sec_edgar",
      kind: "filing",
      canonical_url: input.url,
      trust_tier: "primary",
      license_class: "public",
      retrieved_at: input.retrievedAt,
    });
    const { document } = await ingestDocument(deps, {
      source: { source_id: source.source_id, license_class: source.license_class },
      bytes: input.bytes,
      document: {
        kind: "filing",
        provider_doc_id: input.accession,
        title: "10-K",
        published_at: input.filedDate === null ? null : `${input.filedDate}T00:00:00Z`,
      },
    });
    stored = { documentId: document.document_id, sourceId: document.source_id };
  }
  await createMention(deps.db, {
    document_id: stored.documentId,
    subject_kind: "issuer",
    subject_id: input.issuerId,
    prominence: "headline",
    mention_count: 1,
    confidence: 1,
  });
  return stored;
}

export type TenKBackfillDeps = Extract10kDeps & {
  objectStore: ObjectStore;
  secClient: SecFilingFetcher & { fetchSubmissions(cik: number): Promise<SecSubmissions> };
};

// An issuer's latest 10-K, from its submissions feed: fetched and stored
// unless already stored, then extracted unless already read. A rerun makes one
// SEC request per issuer (the feed) and no model call.
export async function backfillIssuer10k(
  deps: TenKBackfillDeps,
  issuer: { issuerId: string; cik: number },
): Promise<(Extract10kResult & { accession: string }) | { outcome: "no_10k" }> {
  const submissions = await deps.secClient.fetchSubmissions(issuer.cik);
  const latest = recentSubmissionRows(submissions.filings.recent).find((row) => row.form === "10-K");
  if (latest === undefined) return { outcome: "no_10k" };
  const { rows: [existing] } = await deps.db.query<{ raw_blob_id: string; parse_status: string }>(
    `select raw_blob_id, parse_status from documents
      where provider_doc_id = $1 and deleted_at is null order by created_at limit 1`,
    [latest.accession],
  );
  if (existing !== undefined && existing.parse_status !== "pending") {
    return { outcome: "already_extracted", extracted: 0, droppedUnquoted: 0, competitors: { resolved: 0, named: 0 }, missing: [], llmCalls: 0, accession: latest.accession };
  }
  // Stored but unread (the filings backfill stores 10-Ks too): read from the
  // object store, so the claims cite the stored bytes.
  const blob = existing === undefined ? null : await deps.objectStore.get(existing.raw_blob_id);
  const fetched = blob === null
    ? await deps.secClient.fetchFiling({ cik: issuer.cik, accession_number: latest.accession, document: latest.primaryDocument })
    : null;
  const bytes = blob?.bytes ?? fetched!.bytes;
  const doc = await storeTenK(deps, {
    issuerId: issuer.issuerId,
    bytes,
    url: fetched?.url ?? null,
    accession: latest.accession,
    filedDate: latest.filedDate,
    retrievedAt: fetched?.retrievedAt ?? new Date().toISOString(),
  });
  const result = await extract10kClaims(deps, {
    ...doc,
    issuerId: issuer.issuerId,
    html: new TextDecoder("utf-8").decode(bytes),
    effectiveTime: `${latest.filedDate}T00:00:00Z`,
  });
  return { ...result, accession: latest.accession };
}
