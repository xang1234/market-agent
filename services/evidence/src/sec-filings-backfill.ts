// Backfills an issuer's recent SEC filings as evidence documents: discovers
// filings via the submissions API, ingests each primary document
// (source + blob + documents row via ingestSecFiling), and records a mention
// binding the document to the issuer — the linkage reader columns select by.
// Idempotent: filings whose accession number already has a live documents row
// are skipped without refetching (the issuer mention is still re-asserted via
// upsert, so a rerun heals a run that died between ingest and mention).

import {
  ingestSecFiling,
  recentSubmissionRows,
  type FetchFilingInput,
  type FetchFilingResult,
  type SecFormCode,
  type SecSubmissions,
} from "./sec-edgar.ts";
import { createMention } from "./mention-repo.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";

// Per-issuer backfill targets the periodic/event evidence filings. It is
// deliberately NOT the full SEC_FORM_CODES universe: ownership forms (4, 13F-HR)
// are high-frequency and would consume the maxFilings slots, crowding out the
// 10-K/10-Q/8-K evidence this backfill exists to fetch. Ownership ingestion is
// the daily crawl's job; callers that want ownership forms pass `forms`
// explicitly (e.g. the Form 4 lazy backfill).
export const BACKFILL_DEFAULT_FORMS: readonly SecFormCode[] = [
  "10-K",
  "10-Q",
  "8-K",
  "8-K/A",
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
  for (const candidate of candidates) {
    const existingDocumentId = await findLiveDocumentIdByAccession(deps.db, candidate.accession);
    if (existingDocumentId !== null) {
      // A prior run may have ingested the document but died before recording
      // the issuer mention; createMention upserts, so re-asserting the
      // linkage here keeps reruns truly idempotent (heals partial state).
      await createMention(deps.db, {
        document_id: existingDocumentId,
        subject_kind: "issuer",
        subject_id: input.issuerId,
        prominence: "headline",
        mention_count: 1,
        confidence: 1,
      });
      skipped += 1;
      continue;
    }
    const result = await ingestSecFiling(
      { db: deps.db, objectStore: deps.objectStore, secClient: deps.secClient },
      {
        cik: input.cik,
        accession_number: candidate.accession,
        document: candidate.primaryDocument,
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
