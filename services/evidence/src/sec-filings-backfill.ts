// Backfills an issuer's recent SEC filings as evidence documents: discovers
// filings via the submissions API, then stores each primary document (source +
// blob + documents row) with a mention binding it to the issuer, the linkage
// reader columns select by, in one transaction.
// Idempotent: filings whose accession number already has a live documents row
// are skipped without refetching (the issuer mention is still re-asserted via
// upsert, so a rerun heals a document stored with no mention).

import { issuerHoldsCik } from "../../shared/src/identifiers.ts";
import {
  recentSubmissionRows,
  type FetchFilingInput,
  type FetchFilingResult,
  type SecFormCode,
  type SecSubmissions,
} from "./sec-edgar.ts";
import { createMention } from "./mention-repo.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
import { ingestDocumentInTransaction } from "./ingest.ts";
import type { ObjectStore } from "./object-store.ts";
import { createSource } from "./source-repo.ts";
import { withTransaction, type TransactionContext } from "./transaction.ts";
import type { QueryExecutor } from "./types.ts";

// Per-issuer backfill targets the periodic narrative-evidence filings. It is
// deliberately NOT the full SEC_FORM_CODES universe: the typed-event forms (4,
// 8-K, 13F-HR) have dedicated atomic handlers + their own per-issuer backfills
// that produce events/claims — ingesting them here as plain documents would both
// crowd out the maxFilings slots and lose that typed extraction. Callers that
// want a specific form set pass `forms` explicitly.
export const BACKFILL_DEFAULT_FORMS: readonly SecFormCode[] = [
  "10-K",
  "10-Q",
  "20-F",
  "6-K",
  "40-F",
];

export type FilingsBackfillClient = {
  fetchSubmissions(cik: number): Promise<SecSubmissions>;
  fetchFiling(input: FetchFilingInput): Promise<FetchFilingResult>;
};

export type FilingsBackfillDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  secClient: FilingsBackfillClient;
};

export type BackfillIssuerFilingsInput = {
  issuerId: string;
  cik: number;
  // Defaults match the reader's document-selection window (180 days).
  sinceDays?: number;
  maxFilings?: number;
  forms?: ReadonlyArray<SecFormCode>;
  now?: () => Date;
};

export type BackfillIssuerFilingsResult = {
  ingested: Array<{ document_id: string; form: SecFormCode; accession_number: string }>;
  skipped: number;
};

export async function backfillIssuerFilings(
  deps: FilingsBackfillDeps,
  input: BackfillIssuerFilingsInput,
): Promise<BackfillIssuerFilingsResult> {
  const sinceDays = input.sinceDays ?? 180;
  const maxFilings = input.maxFilings ?? 5;
  const forms = input.forms ?? BACKFILL_DEFAULT_FORMS;
  const now = input.now ?? (() => new Date());
  const cutoffMs = now().getTime() - sinceDays * 24 * 60 * 60 * 1000;

  const submissions = await deps.secClient.fetchSubmissions(input.cik);
  const candidates = recentSubmissionRows(submissions.filings.recent)
    .filter((row) => (forms as ReadonlyArray<string>).includes(row.form))
    .filter((row) => row.filedAtMs >= cutoffMs)
    .slice(0, maxFilings);

  const ingested: BackfillIssuerFilingsResult["ingested"] = [];
  let skipped = 0;
  // The filing IS the issuer's own document: a full-confidence headline mention,
  // the linkage reader document selection queries on. It stores nothing, and
  // returns null, when the issuer no longer holds the CIK it was downloaded by.
  const storeOnIssuer = async (tx: TransactionContext, store: () => Promise<string>): Promise<string | null> => {
    if (!(await issuerHoldsCik(tx.db, input.issuerId, input.cik))) {
      console.warn(`[sec-filings-backfill] issuer ${input.issuerId} no longer holds CIK ${input.cik}; stored nothing`);
      return null;
    }
    const documentId = await store();
    await createMention(tx.db, {
      document_id: documentId,
      subject_kind: "issuer",
      subject_id: input.issuerId,
      prominence: "headline",
      mention_count: 1,
      confidence: 1,
    });
    return documentId;
  };
  for (const candidate of candidates) {
    const existingDocumentId = await findLiveDocumentIdByAccession(deps.db, candidate.accession);
    if (existingDocumentId !== null) {
      if ((await withTransaction(deps.db, (tx) => storeOnIssuer(tx, async () => existingDocumentId))) === null) break;
      skipped += 1;
      continue;
    }
    const fetched = await deps.secClient.fetchFiling({
      cik: input.cik,
      accession_number: candidate.accession,
      document: candidate.primaryDocument,
    });
    const documentId = await withTransaction(deps.db, (tx) =>
      storeOnIssuer(tx, async () => {
        const source = await createSource(tx.db, {
          provider: "sec_edgar",
          kind: "filing",
          canonical_url: fetched.url,
          trust_tier: "primary",
          license_class: "public",
          retrieved_at: fetched.retrievedAt,
        });
        const { document } = await ingestDocumentInTransaction(
          { tx, objectStore: deps.objectStore },
          {
            source: { source_id: source.source_id, license_class: source.license_class },
            bytes: fetched.bytes,
            document: { kind: "filing", provider_doc_id: candidate.accession, title: candidate.form },
          },
        );
        return document.document_id;
      }));
    // The issuer lost the CIK since it was read, so no later filing is its.
    if (documentId === null) break;
    ingested.push({ document_id: documentId, form: candidate.form as SecFormCode, accession_number: candidate.accession });
  }
  return { ingested, skipped };
}
