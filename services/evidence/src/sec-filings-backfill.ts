// Backfills an issuer's recent SEC filings as evidence documents: discovers
// filings via the submissions API, ingests each primary document
// (source + blob + documents row via ingestSecFiling), and records a mention
// binding the document to the issuer — the linkage reader columns select by.
// Idempotent: filings whose accession number already has a live documents row
// are skipped without refetching (the issuer mention is still re-asserted via
// upsert, so a rerun heals a run that died between ingest and mention).

import {
  ingestSecFiling,
  SEC_FORM_CODES,
  type FetchFilingInput,
  type FetchFilingResult,
  type SecFormCode,
  type SecSubmissions,
} from "./sec-edgar.ts";
import { createMention } from "./mention-repo.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
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
    // EDGAR's parallel arrays can be ragged; a row missing its primary
    // document (or form/accession) is skipped instead of failing the issuer.
    .filter(
      (c): c is { accession: string; form: string; document: string; filedAt: number } =>
        typeof c.accession === "string" &&
        c.accession.length > 0 &&
        typeof c.form === "string" &&
        typeof c.document === "string" &&
        c.document.length > 0,
    )
    .filter((c) => (forms as ReadonlyArray<string>).includes(c.form))
    .filter((c) => Number.isFinite(c.filedAt) && c.filedAt >= cutoffMs)
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
