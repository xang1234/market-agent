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
import {
  canonicalText,
  completeLogged,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  releasePrompts,
  verifyStatement,
  type ExtractReleaseLlm,
} from "./sec-earnings-release-extraction.ts";
import { cleanupSourceAfterFailedIngest, recentSubmissionRows, type SecFilingFetcher, type SecSubmissions } from "./sec-edgar.ts";
import { tenKSections, TEN_K_ITEMS, type TenKItem, type TenKSection } from "./sec-10k-sections.ts";
import { createSource, deleteSource } from "./source-repo.ts";
import { withTransaction } from "./transaction.ts";
import type { QueryExecutor } from "./types.ts";

export const TEN_K_PREDICATES = {
  "1": ["business.description", "business.products", "business.customers", "business.competition"],
  "1A": ["risk.factor"],
} as const satisfies Record<TenKItem, ReadonlyArray<string>>;
export type TenKPredicate = (typeof TEN_K_PREDICATES)[TenKItem][number];

export type TenKClaim = { predicate: TenKPredicate; quote: string; competitors: string[] };

const MAX_CLAIMS: Readonly<Record<TenKItem, number>> = { "1": 16, "1A": 15 };
// A 10-K's model calls per run; the plan's perf rule fails one above 12.
const MAX_LLM_CALLS = 12;
// 16 quotes of up to 600 characters, with their keys and low reasoning.
const MAX_REPLY_TOKENS = 8_000;
const TEN_K_CONFIDENCE = 0.8;

export type ResolveCompetitor = (name: string) => Promise<string | null>;

export type Extract10kDeps = { db: QueryExecutor; llm: ExtractReleaseLlm; resolveCompetitor: ResolveCompetitor };

export type TenKDocument = {
  documentId: string;
  sourceId: string;
  issuerId: string;
  html: string;
  effectiveTime: string | null;
};

// parse_status "parsed" means every item was read, and "failed" that an item
// was not. Either the parser missed it, as for a 10-K laid out by a
// cross-reference index (Intel's) or a smaller reporting company with no Item
// 1A, or the model's reply for it was unusable. An item counts as read once it has
// claims, so a rerun sections a failed document again from its stored bytes
// and asks the model only about the items still unread.
// ponytail: an item whose reply held no claim reads as unread, so each rerun of
// a failed document asks the model about it again. Record the items read on the
// document if that costs.
// "unread": items whose reply had the wrong shape, or none of whose quotes is
// in the filing, so none of their claims is stored. The other items are.
// "unparseable": every item asked is unread, so nothing is stored.
// "cut": items longer than the run's MAX_LLM_CALLS prompts allow, read as far
// as the budget went. An item cut before its first prompt stays unread.
// "no_sections": no item is found or read.
export type Extract10kOutcome = "extracted" | "already_extracted" | "unparseable" | "no_sections";
export type CutItem = { item: TenKItem; prompts: number; of: number };
export type Extract10kResult = {
  outcome: Extract10kOutcome;
  extracted: number;
  droppedUnquoted: number;
  competitors: { resolved: number; named: number };
  missing: TenKItem[];
  unread: TenKItem[];
  cut: CutItem[];
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
    const { predicate, quote, competitors } = (entry ?? {}) as Record<string, unknown>;
    if (typeof quote !== "string" || !(TEN_K_PREDICATES[item] as ReadonlyArray<unknown>).includes(predicate)) return null;
    // A slip in the competitor list costs only the competitors.
    const names = Array.isArray(competitors) ? competitors.filter((name): name is string => typeof name === "string") : [];
    claims.push({ predicate: predicate as TenKPredicate, quote, competitors: names });
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

// Kept beside verifyStatement, not in it, so earnings-release claims keep
// their sentence rule: a 10-K list item ends in a semicolon, or opens with a
// bullet ("*") no sentence starts after. A quote that ends mid-clause
// ("...compete with AMD,") is the first paragraph of a longer item; one that
// ends "...Tesla, Inc.; and" is an item joined to the next.
const RUNS_ON = /(?:[,:-]|(?<!;)\s(?:and|or|but|nor|with|of|to|for|the|a|an))$/i;
const BULLETS = "•▪◦●■*·\uf0b7";
const LEADING_BULLET = new RegExp(`^[${BULLETS}]\\s*`);
function wholeListItem(claim: TenKClaim, section: TenKSection): (TenKClaim & { exhibit: string; start: number; end: number }) | null {
  const quote = canonicalText(claim.quote).replace(LEADING_BULLET, "");
  if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS || RUNS_ON.test(quote)) return null;
  for (let start = section.text.indexOf(quote); start >= 0; start = section.text.indexOf(quote, start + 1)) {
    const end = start + quote.length;
    if (start >= 2 && BULLETS.includes(section.text[start - 2]!) && section.text[start - 1] === " " && section.edges.has(start - 2) && section.edges.has(end)) {
      return { ...claim, quote, exhibit: section.type, start, end };
    }
  }
  return null;
}

// A risk factor names partners and customers too, so only a competition
// claim has competitors. A competitor is a proper name, matched as the quote
// writes it, so "target customers" names no Target and "custom chips" no
// Custom Inc. ponytail: a capitalized common word that opens the quote
// ("Target customers") still matches.
function competitorsNamedIn(claim: TenKClaim): string[] {
  if (claim.predicate !== "business.competition") return [];
  const namedAsWord = (name: string) => /[\p{Lu}\p{N}]/u.test(name) &&
    new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(claim.quote);
  return claim.competitors.map(canonicalText).filter((name) => name !== "" && namedAsWord(name));
}

type VerifiedClaim = TenKClaim & { item: TenKItem; start: number; end: number; issuerIds: string[] };

const TEXT_BASIS = "sec_10k_item_canonical_text.v1";
const readThrough = (parseStatus: string | undefined) => parseStatus === "parsed" || parseStatus === "superseded";
async function itemsRead(db: QueryExecutor, documentId: string): Promise<Set<TenKItem>> {
  const { rows } = await db.query<{ item: TenKItem }>(
    `select distinct locator->>'item' as item from claim_evidence where document_id = $1 and locator->>'text_basis' = $2`,
    [documentId, TEXT_BASIS],
  );
  return new Set(rows.map((row) => row.item));
}

// Extract one 10-K document's claims and store the verified ones. Transport
// errors propagate and store nothing, so the document stays unread.
export async function extract10kClaims(deps: Extract10kDeps, doc: TenKDocument): Promise<Extract10kResult> {
  const started = { extracted: 0, droppedUnquoted: 0, competitors: { resolved: 0, named: 0 }, unread: [], cut: [], llmCalls: 0 };
  const { rows: [status] } = await deps.db.query<{ parse_status: string }>(
    `select parse_status from documents where document_id = $1`,
    [doc.documentId],
  );
  if (status === undefined) throw new Error(`no document ${doc.documentId}`);
  if (readThrough(status.parse_status)) return { ...started, outcome: "already_extracted", missing: [] };
  const sections = tenKSections(doc.html);
  const read = await itemsRead(deps.db, doc.documentId);
  const missingAfter = (readNow: Set<TenKItem>) => TEN_K_ITEMS.filter((item) => "error" in sections[item] && !readNow.has(item));
  const found = TEN_K_ITEMS.flatMap((item) => "error" in sections[item] || read.has(item) ? [] : [sections[item] as TenKSection]);
  const missing = missingAfter(read);
  if (found.length === 0) {
    await deps.db.query(
      `update documents set parse_status = $2 where document_id = $1 and parse_status in ('pending', 'failed')`,
      [doc.documentId, missing.length === 0 ? "parsed" : "failed"],
    );
    return { ...started, outcome: read.size === 0 ? "no_sections" : "already_extracted", missing };
  }

  let callsLeft = MAX_LLM_CALLS;
  const cut: CutItem[] = [];
  const prompts = found.flatMap((section) => {
    const all = releasePrompts([section]);
    const asked = all.slice(0, callsLeft);
    callsLeft -= asked.length;
    if (asked.length < all.length) cut.push({ item: section.type, prompts: asked.length, of: all.length });
    return asked.map((text) => ({ section, text }));
  });
  const replies = await Promise.all(prompts.map(async ({ section, text }, index) => {
    const completion = await completeLogged(
      deps,
      "extract_10k_claims.prompt",
      { document_id: doc.documentId, item: section.type, prompt: index + 1, prompts: prompts.length },
      buildMessages(section.type, text),
      MAX_REPLY_TOKENS,
    );
    return { section, model: completion.model, claims: completion.truncated ? null : parseTenKReply(completion.text, section.type) };
  }));

  let droppedUnquoted = 0;
  const verified = new Map<string, VerifiedClaim>();
  const checkedReplies = replies.map(({ section, claims }) => {
    const checked = (claims ?? []).map((claim) => verifyStatement(claim, [section]) ?? wholeListItem(claim, section));
    return { section, checked, usable: claims !== null && (checked.length === 0 || checked.some((pick) => pick !== null)) };
  });
  const unread = found.map((section) => section.type).filter((item) =>
    !prompts.some(({ section }) => section.type === item) || checkedReplies.some((reply) => reply.section.type === item && !reply.usable));
  for (const { section, checked } of checkedReplies) {
    if (unread.includes(section.type)) continue;
    for (const claim of checked) {
      if (claim === null) {
        droppedUnquoted += 1;
        continue;
      }
      const key = JSON.stringify([claim.predicate, claim.quote]);
      const prior = verified.get(key);
      verified.set(key, {
        ...claim,
        item: section.type,
        competitors: [...new Set([...(prior?.competitors ?? []), ...competitorsNamedIn(claim)])],
        issuerIds: [],
      });
    }
  }
  const model = replies[0]?.model ?? null;
  const args = { document_id: doc.documentId, model };
  const proposed = replies.map((reply) => reply.claims?.length ?? null);
  if (unread.length === found.length) {
    await writeToolCallLog(deps.db, { tool_name: "extract_10k_claims", args, result: { outcome: "unparseable", unread, cut, proposed, dropped_unquoted: droppedUnquoted }, status: "partial" });
    return { ...started, outcome: "unparseable", droppedUnquoted, missing, unread, cut, llmCalls: prompts.length };
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
    // The row lock orders this with a concurrent read of the same document and
    // with storeTenK adopting the filing's date.
    const { rows: [locked] } = await tx.db.query<{ parse_status: string; published_at: Date | null }>(
      `select parse_status, published_at from documents where document_id = $1 for update`,
      [doc.documentId],
    );
    // A concurrent run may have read some items meanwhile, so store the others.
    const readNow = await itemsRead(tx.db, doc.documentId);
    const missingNow = missingAfter(readNow);
    const storing = found.map((section) => section.type).filter((item) => !unread.includes(item) && !readNow.has(item));
    const unreadNow = unread.filter((item) => !readNow.has(item));
    if (readThrough(locked!.parse_status) || storing.length === 0) {
      return { ...started, outcome: "already_extracted" as const, missing: missingNow, unread: unreadNow };
    }
    const effectiveTime = doc.effectiveTime ?? locked!.published_at?.toISOString() ?? null;
    const claimIds: string[] = [];
    let resolved = 0;
    for (const claim of [...verified.values()].filter((claim) => storing.includes(claim.item))) {
      const row = await createClaim(tx.db, {
        document_id: doc.documentId,
        predicate: claim.predicate,
        text_canonical: claim.quote,
        polarity: claim.predicate === "risk.factor" ? "negative" : "neutral",
        modality: "quoted",
        reported_by_source_id: doc.sourceId,
        attributed_to_type: "issuer",
        attributed_to_id: doc.issuerId,
        effective_time: effectiveTime,
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
        locator: { item: claim.item, start: claim.start, end: claim.end, text_basis: TEXT_BASIS },
        excerpt_hash: createHash("sha256").update(claim.quote).digest("hex"),
        confidence: 1,
      });
      claimIds.push(row.claim_id);
    }
    const competitors = { resolved, named };
    const allRead = missingNow.length === 0 && unreadNow.length === 0;
    await tx.db.query(`update documents set parse_status = $2 where document_id = $1`, [doc.documentId, allRead ? "parsed" : "failed"]);
    await writeToolCallLog(tx.db, {
      tool_name: "extract_10k_claims",
      args,
      result: { outcome: "extracted", missing: missingNow, unread: unreadNow, cut, proposed, claim_ids: claimIds, dropped_unquoted: droppedUnquoted, competitors },
      status: allRead && cut.length === 0 ? (claimIds.length > 0 ? "ok" : "skipped") : "partial",
    });
    return { outcome: "extracted" as const, extracted: claimIds.length, droppedUnquoted, competitors, missing: missingNow, unread: unreadNow, cut, llmCalls: prompts.length };
  });
}

// normalizeNameForLookup keeps corporate suffixes, so a 10-K's "Intel
// Corporation" misses the issuer "Intel Corp": strip the written suffix, then
// try each short form issuers are named with. ponytail: a brand that is not
// the legal name ("Google", "AMD") stays unresolved.
const WRITTEN_SUFFIX = / (?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc)$/;
const ISSUER_SUFFIXES = [" inc", " corp", " corporation", " co", " ltd", " plc"];
export async function resolveCompetitorByName(db: QueryExecutor, name: string): Promise<string | null> {
  const written = normalizeNameForLookup(name);
  const stem = written.replace(WRITTEN_SUFFIX, "");
  if (stem === "") return null;
  const exact = await resolveByNameCandidate(db, written);
  if (exact.outcome !== "not_found") return exact.outcome === "resolved" && exact.subject_ref.kind === "issuer" ? exact.subject_ref.id : null;
  // One issuer across every short form: "Acme" names neither of "Acme Inc"
  // and "Acme Corp".
  const ids = new Set<string>();
  for (const candidate of new Set(ISSUER_SUFFIXES.map((suffix) => stem + suffix))) {
    const envelope = await resolveByNameCandidate(db, candidate);
    if (envelope.outcome === "ambiguous") return null;
    if (envelope.outcome === "resolved" && envelope.subject_ref.kind === "issuer") ids.add(envelope.subject_ref.id);
  }
  return ids.size === 1 ? [...ids][0]! : null;
}

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
    }).catch((error: unknown) => cleanupSourceAfterFailedIngest(deps.db, source.source_id, error));
    // A concurrent run stored the same bytes first, and its document keeps its source.
    if (document.source_id !== source.source_id) await deleteSource(deps.db, source.source_id);
    stored = { documentId: document.document_id, sourceId: document.source_id };
  }
  // Bytes stored first by --file (before, or by a concurrent run) carry no
  // filing until the backfill names it: its accession, so the next backfill
  // finds them without a fetch, and its date, for the document and its claims.
  if (input.accession !== null) {
    const filedAt = input.filedDate === null ? null : `${input.filedDate}T00:00:00Z`;
    await deps.db.query(
      `update documents set provider_doc_id = coalesce(provider_doc_id, $2), published_at = coalesce(published_at, $3::timestamptz)
        where document_id = $1`,
      [stored.documentId, input.accession, filedAt],
    );
    await deps.db.query(`update claims set effective_time = $2::timestamptz where document_id = $1 and effective_time is null`, [stored.documentId, filedAt]);
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
// SEC request per issuer (the feed), and a model call only for an item the
// parser newly finds.
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
  if (readThrough(existing?.parse_status)) {
    return { outcome: "already_extracted", extracted: 0, droppedUnquoted: 0, competitors: { resolved: 0, named: 0 }, missing: [], unread: [], cut: [], llmCalls: 0, accession: latest.accession };
  }
  // The filings backfill stores 10-Ks too: claims cite the stored bytes.
  const blob = existing === undefined ? null : await deps.objectStore.get(existing.raw_blob_id);
  const { bytes, url, retrievedAt } = blob !== null
    ? { bytes: blob.bytes, url: null, retrievedAt: new Date().toISOString() }
    : await deps.secClient.fetchFiling({ cik: issuer.cik, accession_number: latest.accession, document: latest.primaryDocument });
  const doc = await storeTenK(deps, { issuerId: issuer.issuerId, bytes, url, accession: latest.accession, filedDate: latest.filedDate, retrievedAt });
  const result = await extract10kClaims(deps, {
    ...doc,
    issuerId: issuer.issuerId,
    html: new TextDecoder("utf-8").decode(bytes),
    effectiveTime: `${latest.filedDate}T00:00:00Z`,
  });
  return { ...result, accession: latest.accession };
}
