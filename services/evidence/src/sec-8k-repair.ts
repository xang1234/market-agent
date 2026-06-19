// One-time repair for legacy 8-K filings (fra-5uf7). Before the typed 8-K slice,
// 8-K/8-K/A were in the generic filings backfill, which stored each as a plain
// `documents` row (the primary-document body, title = form) + an issuer mention, with
// NO events or material_event.* claims. The typed crawl/backfill then dedups on document
// EXISTENCE (findLiveDocumentIdByAccession), so those legacy accessions are permanently
// skipped and never get their typed artifacts.
//
// This repair ATTACHES the typed events/claims to the EXISTING legacy document, reusing
// its source — it does NOT re-ingest the filing as a new document (the legacy doc holds
// the primary-document body, a different content_hash than the full submission, and the
// reader-friendly representation worth keeping). Item codes come from the full-submission
// header (classify8kHeader), which the stored primary-document body doesn't carry, so the
// .txt is re-fetched per candidate. A batch/CLI step — never the atomic crawl.
import { persist8kMaterialEvents } from "./sec-8k-handler.ts";
import { classify8kHeader, parseFiledAsOfDate } from "./sec-8k-item-taxonomy.ts";
import { resolveIssuerIdByCik } from "./sec-issuer-resolve.ts";
import { withTransaction } from "./transaction.ts";
import type { SecFilingFetcher } from "./sec-edgar.ts";
import type { QueryExecutor } from "./types.ts";

// Keyset paging sentinel: document_id > this matches every document (uuid order).
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export type Repair8kDeps = { db: QueryExecutor; secClient: SecFilingFetcher };

export type Repair8kCandidate = {
  documentId: string;
  accession: string;
  sourceId: string; // the legacy document's source — the typed claims/events reuse it
  form: string; // "8-K" | "8-K/A" (the document title the generic backfill stored)
};

// "untracked" = the filer CIK isn't a tracked issuer (skip, same as the crawl handler).
// "no_items" / "no_date" = the re-fetched header lacked ITEM INFORMATION / FILED AS OF
// DATE, so there's nothing to attach (or no date to stamp) — skip without writing.
export type Repair8kOutcome = "repaired" | "untracked" | "no_items" | "no_date";

// Legacy 8-K documents lacking typed artifacts: a sec_edgar filing document titled 8-K/8-K-A
// with NO event referencing its source. Keying on events-by-source (not claims) makes the
// repair idempotent for every item shape, including a 9.01-only filing (which yields an
// event but no claim). Paged by a document_id keyset so the drain advances past skips.
export async function findRepair8kCandidates(
  db: QueryExecutor,
  opts: { afterDocumentId?: string; limit?: number } = {},
): Promise<Repair8kCandidate[]> {
  const { rows } = await db.query<{ document_id: string; accession: string; source_id: string; form: string }>(
    `select d.document_id::text as document_id,
            d.provider_doc_id as accession,
            d.source_id::text as source_id,
            d.title as form
       from documents d
       join sources s on s.source_id = d.source_id
      where d.kind = 'filing'
        and d.deleted_at is null
        and s.provider = 'sec_edgar'
        and d.title in ('8-K', '8-K/A')
        and d.provider_doc_id is not null
        and d.document_id > $1::uuid
        and not exists (
          select 1 from events e where e.source_ids @> to_jsonb(d.source_id::text)
        )
      order by d.document_id
      limit $2`,
    [opts.afterDocumentId ?? ZERO_UUID, opts.limit ?? 100],
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    accession: row.accession,
    sourceId: row.source_id,
    form: row.form,
  }));
}

// The SEC accession's leading segment is the zero-padded filer CIK; for an 8-K the filer
// IS the issuer (mirrors how the crawl handler resolves from the index entry's CIK).
function accessionCik(accession: string): number {
  return Number(accession.split("-")[0]);
}

// Repair one legacy document: resolve the issuer, re-fetch the full submission for its
// item codes + filing date, and attach the typed events/claims to the EXISTING document +
// source in one transaction. Transport errors propagate so the drain can fail-and-retry.
export async function repair8kDocument(deps: Repair8kDeps, candidate: Repair8kCandidate): Promise<Repair8kOutcome> {
  const issuerCik = accessionCik(candidate.accession);
  if (!Number.isInteger(issuerCik) || issuerCik <= 0) {
    console.warn(`[sec-8k-repair] skip ${candidate.accession}: unparseable filer CIK`);
    return "untracked";
  }
  const issuerId = await resolveIssuerIdByCik(deps.db, issuerCik);
  if (issuerId === null) {
    console.warn(`[sec-8k-repair] skip ${candidate.accession}: filer CIK ${issuerCik} not tracked`);
    return "untracked";
  }
  const fetched = await deps.secClient.fetchFiling({
    cik: issuerCik,
    accession_number: candidate.accession,
    document: `${candidate.accession}.txt`,
  });
  const txt = new TextDecoder("utf-8").decode(fetched.bytes);
  const items = classify8kHeader(txt);
  if (items.length === 0) {
    console.warn(`[sec-8k-repair] skip ${candidate.accession}: no ITEM INFORMATION in header`);
    return "no_items";
  }
  const filedDate = parseFiledAsOfDate(txt);
  if (filedDate === null) {
    console.warn(`[sec-8k-repair] skip ${candidate.accession}: no FILED AS OF DATE in header`);
    return "no_date";
  }
  await withTransaction(deps.db, async (tx) => {
    await persist8kMaterialEvents(tx.db, {
      documentId: candidate.documentId,
      sourceId: candidate.sourceId,
      issuerId,
      items,
      occurredAt: `${filedDate}T00:00:00Z`,
      form: candidate.form,
      accession: candidate.accession,
    });
  });
  return "repaired";
}

export type Repair8kDrainResult = { repaired: number; untracked: number; no_items: number; no_date: number; failed: number };

// Drain the full legacy-8-K backlog: page by a document_id keyset, advancing the cursor
// even on a skip/failure so one document never blocks the rest. A repaired document gains
// an event referencing its source and drops out of the candidate set (idempotent re-run).
export async function runRepair8kDrain(
  deps: Repair8kDeps,
  opts: { pageSize?: number; onDocument?: (candidate: Repair8kCandidate, outcome: Repair8kOutcome | { error: unknown }) => void } = {},
): Promise<Repair8kDrainResult> {
  const result: Repair8kDrainResult = { repaired: 0, untracked: 0, no_items: 0, no_date: 0, failed: 0 };
  let cursor = ZERO_UUID;
  for (;;) {
    const page = await findRepair8kCandidates(deps.db, { afterDocumentId: cursor, limit: opts.pageSize ?? 100 });
    if (page.length === 0) break;
    for (const candidate of page) {
      cursor = candidate.documentId;
      try {
        const outcome = await repair8kDocument(deps, candidate);
        result[outcome] += 1;
        opts.onDocument?.(candidate, outcome);
      } catch (error) {
        result.failed += 1;
        opts.onDocument?.(candidate, { error });
      }
    }
  }
  return result;
}
