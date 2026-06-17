// Per-issuer Form 4 backfill: the on-demand counterpart to the daily crawl.
// Lists an issuer's recent ownership filings via the submissions API and runs
// the atomic Form 4 handler on each accession not already stored.
//
// Ownership forms (4, 4/A) are deliberately excluded from the generic filings
// backfill (see BACKFILL_DEFAULT_FORMS in sec-filings-backfill.ts): they need
// the transactional insider-transaction extraction handleForm4 performs, not the
// plain document ingest the generic path does. Idempotent — accessions with a
// live documents row are skipped (the same dedup the crawl applies).

import { handleForm4, type Form4FilingRef } from "./sec-form4-handler.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import { recentSubmissionRows, type SecFilingFetcher, type SecSubmissions } from "./sec-edgar.ts";
import type { QueryExecutor } from "./types.ts";

const FORM4_FORMS: ReadonlySet<string> = new Set(["4", "4/A"]);
const DAY_MS = 24 * 60 * 60 * 1000;

// The backfill lists submissions (crawl-style discovery) and fetches each filing
// through the handler — so it needs both capabilities. SecEdgarClient satisfies it.
export type Form4BackfillClient = SecFilingFetcher & {
  fetchSubmissions(cik: number): Promise<SecSubmissions>;
};

export type Form4BackfillDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  secClient: Form4BackfillClient;
};

export type BackfillIssuerForm4Input = {
  cik: number;
  // Defaults match the reader's document-selection window (180 days).
  sinceDays?: number;
  // Safety cap — ownership forms are high-frequency. Truncation is logged.
  maxFilings?: number;
  now?: () => Date;
};

export type BackfillIssuerForm4Result = {
  ingested: number;
  skipped: number;
};

export async function backfillIssuerForm4(
  deps: Form4BackfillDeps,
  input: BackfillIssuerForm4Input,
): Promise<BackfillIssuerForm4Result> {
  const sinceDays = input.sinceDays ?? 180;
  const maxFilings = input.maxFilings ?? 50;
  const now = input.now ?? (() => new Date());
  const cutoffMs = now().getTime() - sinceDays * DAY_MS;

  const submissions = await deps.secClient.fetchSubmissions(input.cik);
  const inWindow = recentSubmissionRows(submissions.filings.recent)
    .filter((row) => FORM4_FORMS.has(row.form))
    .filter((row) => row.filedAtMs >= cutoffMs);

  // No silent truncation: EDGAR returns `recent` newest-first, so slicing keeps
  // the most recent filings, but a caller should know coverage was capped.
  if (inWindow.length > maxFilings) {
    console.warn(
      `[sec-form4-backfill] CIK ${input.cik}: ${inWindow.length} Form 4 filings in the last ${sinceDays}d ` +
        `exceed the cap of ${maxFilings}; processing the most recent ${maxFilings}.`,
    );
  }
  // Keep the most-recent `maxFilings` (recent is newest-first), then process them
  // OLDEST-first so a 4/A is handled after the original it amends and can supersede it
  // (the daily crawl ingests chronologically; this restores that order for the backfill,
  // otherwise a newer 4/A processed before its original supersedes nothing and the
  // later-inserted original double-counts).
  const candidates = inWindow.slice(0, maxFilings).reverse();

  const handlerDeps = { db: deps.db, objectStore: deps.objectStore, client: deps.secClient };
  let ingested = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if ((await findLiveDocumentIdByAccession(deps.db, candidate.accession)) !== null) {
      skipped += 1;
      continue;
    }
    const entry: Form4FilingRef = {
      cik: input.cik,
      accession: candidate.accession,
      form: candidate.form,
      filedDate: candidate.filedDate,
    };
    const result = await handleForm4(entry, handlerDeps);
    if (result.ingested) ingested += 1;
    else skipped += 1;
  }
  return { ingested, skipped };
}
