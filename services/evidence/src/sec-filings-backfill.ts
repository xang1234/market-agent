// Backfills an issuer's recent SEC filings as evidence documents: discovers
// filings via the submissions API, ingests each primary document
// (source + blob + documents row via ingestSecFiling), and records a mention
// binding the document to the issuer — the linkage reader columns select by.
// Idempotent: filings whose accession number already has a live documents row
// are skipped without refetching.

import {
  ingestSecFiling,
  SEC_FORM_CODES,
  type FetchFilingInput,
  type FetchFilingResult,
  type SecFormCode,
  type SecSubmissions,
} from "./sec-edgar.ts";
import { createMention } from "./mention-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";

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
  const forms = input.forms ?? SEC_FORM_CODES;
  const now = input.now ?? (() => new Date());
  const cutoffMs = now().getTime() - sinceDays * 24 * 60 * 60 * 1000;

  const submissions = await deps.secClient.fetchSubmissions(input.cik);
  const recent = submissions.filings.recent;
  const candidates = recent.accessionNumber
    .map((accession, index) => ({
      accession,
      form: recent.form[index],
      document: recent.primaryDocument[index],
      filedAt: Date.parse(recent.filingDate[index]),
    }))
    .filter((c) => (forms as ReadonlyArray<string>).includes(c.form))
    .filter((c) => Number.isFinite(c.filedAt) && c.filedAt >= cutoffMs)
    .slice(0, maxFilings);

  const ingested: BackfillIssuerFilingsResult["ingested"] = [];
  let skipped = 0;
  for (const candidate of candidates) {
    const existing = await deps.db.query(
      `select 1 from documents where provider_doc_id = $1 and deleted_at is null limit 1`,
      [candidate.accession],
    );
    if ((existing.rows as unknown[]).length > 0) {
      skipped += 1;
      continue;
    }
    const result = await ingestSecFiling(
      { db: deps.db, objectStore: deps.objectStore, secClient: deps.secClient },
      {
        cik: input.cik,
        accession_number: candidate.accession,
        document: candidate.document,
        form: candidate.form as SecFormCode,
      },
    );
    // The filing IS the issuer's own document — full-confidence headline
    // mention, the linkage reader document selection queries on.
    await createMention(deps.db, {
      document_id: result.ingest.document.document_id,
      subject_kind: "issuer",
      subject_id: input.issuerId,
      prominence: "headline",
      mention_count: 1,
      confidence: 1,
    });
    ingested.push({
      document_id: result.ingest.document.document_id,
      form: candidate.form as SecFormCode,
      accession_number: candidate.accession,
    });
  }
  return { ingested, skipped };
}
