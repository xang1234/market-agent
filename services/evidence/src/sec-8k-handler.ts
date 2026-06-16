// 8-K ingest handler (forms "8-K" and "8-K/A"). Atomic per the FormHandler
// contract: the filing document, its issuer mention, one event per Item, and the
// material-event claims (all recognized items except 9.01) are written in a
// single transaction. handle8k is the CANONICAL 8-K ingester — 8-K/8-K/A were
// removed from the generic filings backfill (they need this typed event
// extraction, not a plain document ingest).
import type { FilingIndexEntry } from "./sec-daily-index.ts";
import type { FormHandlerDeps } from "./sec-daily-crawl.ts";
import { withTransaction } from "./transaction.ts";
import { createSource } from "./source-repo.ts";
import { ingestDocumentInTransaction, type IngestDocumentTransactionDeps } from "./ingest.ts";
import { createMention } from "./mention-repo.ts";
import { createEvent, createEventSubject } from "./event-repo.ts";
import { createClaim } from "./claim-repo.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
import { resolveIssuerIdByCik } from "./sec-issuer-resolve.ts";
import { classify8kHeader, type Item8kClassification } from "./sec-8k-item-taxonomy.ts";
import type { FetchFilingResult } from "./sec-edgar.ts";

// handle8k reads only these fields — the filer CIK (= issuer for an 8-K), the
// accession to fetch/dedup, and form/filing date for the document + event rows.
// FilingIndexEntry is a structural supertype, so FORM_HANDLERS still type-checks
// (mirrors Form4FilingRef).
export type Form8kFilingRef = Pick<FilingIndexEntry, "cik" | "accession" | "form" | "filedDate">;

// Shared atomic persist, driven by already-classified items, so the daily-crawl
// handler (items from the .txt header) and the per-issuer backfill (items from
// the submissions feed) write identical rows. One source + document + issuer
// mention, then one event per item and a material_event claim per claimable item.
export async function persist8kFiling(
  deps: IngestDocumentTransactionDeps,
  args: {
    issuerId: string;
    fetched: FetchFilingResult;
    entry: Form8kFilingRef;
    items: ReadonlyArray<Item8kClassification>;
  },
): Promise<void> {
  const { issuerId, fetched, entry, items } = args;
  const occurredAt = `${entry.filedDate}T00:00:00Z`;

  const source = await createSource(deps.tx.db, {
    provider: "sec_edgar",
    kind: "filing",
    canonical_url: fetched.url,
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: fetched.retrievedAt,
  });
  const { document } = await ingestDocumentInTransaction(deps, {
    source: { source_id: source.source_id, license_class: source.license_class },
    bytes: fetched.bytes,
    document: { kind: "filing", provider_doc_id: entry.accession, title: entry.form },
  });
  // The 8-K IS the issuer's own document — full-confidence headline mention, the
  // linkage the reader's document-selection queries on.
  await createMention(deps.tx.db, {
    document_id: document.document_id,
    subject_kind: "issuer",
    subject_id: issuerId,
    prominence: "headline",
    mention_count: 1,
    confidence: 1,
  });

  for (const item of items) {
    // Label the item by its numeric code when known, else its header title.
    const itemLabel = item.itemCode ?? item.itemDescription ?? "unspecified item";
    const claimIds: string[] = [];
    if (item.claimable) {
      const claim = await createClaim(deps.tx.db, {
        document_id: document.document_id,
        predicate: `material_event.${item.eventType}`,
        text_canonical: `Material event reported via 8-K: ${item.eventType.replace(/_/g, " ")} (${itemLabel}).`,
        polarity: "neutral",
        modality: "asserted",
        reported_by_source_id: source.source_id,
        attributed_to_type: "issuer",
        attributed_to_id: issuerId,
        effective_time: occurredAt,
        confidence: 0.9,
        status: "extracted",
      });
      await createClaimArgument(deps.tx.db, {
        claim_id: claim.claim_id,
        subject_kind: "issuer",
        subject_id: issuerId,
        role: "subject",
      });
      claimIds.push(claim.claim_id);
    }
    const event = await createEvent(deps.tx.db, {
      event_type: item.eventType,
      occurred_at: occurredAt,
      status: "reported",
      source_claim_ids: claimIds,
      source_ids: [source.source_id],
      payload_json: {
        item_code: item.itemCode,
        item_description: item.itemDescription,
        form: entry.form,
        accession: entry.accession,
      },
    });
    await createEventSubject(deps.tx.db, {
      event_id: event.event_id,
      subject_kind: "issuer",
      subject_id: issuerId,
      role: "subject",
    });
  }
}

export const handle8k = async (entry: Form8kFilingRef, deps: FormHandlerDeps) => {
  // For an 8-K the filer IS the issuer, and the filer CIK is known from the index
  // entry — so resolve BEFORE the network fetch and skip untracked filers without
  // downloading the filing. (Form 4 can't: its issuer CIK is inside the parsed
  // body. The daily index is dominated by untracked filers, so this matters.)
  const issuerId = await resolveIssuerIdByCik(deps.db, entry.cik);
  if (issuerId === null) {
    console.warn(`[sec-8k] skip ${entry.accession}: filer CIK ${entry.cik} not tracked`);
    return { ingested: false };
  }

  const fetched = await deps.client.fetchFiling({
    cik: entry.cik,
    accession_number: entry.accession,
    document: `${entry.accession}.txt`,
  });
  const items = classify8kHeader(new TextDecoder("utf-8").decode(fetched.bytes));
  // No ITEM INFORMATION in the header → nothing to classify. Skip WITHOUT
  // persisting a document, so the accession isn't marked done and an edge/
  // malformed filing can be reprocessed later (mirrors the Form 4 empty guard).
  if (items.length === 0) {
    console.warn(`[sec-8k] skip ${entry.accession}: no ITEM INFORMATION in header`);
    return { ingested: false };
  }

  await withTransaction(deps.db, async (tx) => {
    await persist8kFiling({ tx, objectStore: deps.objectStore }, { issuerId, fetched, entry, items });
  });
  return { ingested: true };
};
