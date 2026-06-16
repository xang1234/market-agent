// Per-issuer Form 4 backfill: the on-demand counterpart to the daily crawl.
// Lists an issuer's recent ownership filings via the submissions API and runs
// the atomic Form 4 handler on each accession not already stored.
//
// Ownership forms (4, 4/A) are deliberately excluded from the generic filings
// backfill (see BACKFILL_DEFAULT_FORMS in sec-filings-backfill.ts): they need
// the transactional insider-transaction extraction handleForm4 performs, not the
// plain document ingest the generic path does. Idempotent — accessions with a
// live documents row are skipped (the same dedup the crawl applies).

import type { FilingIndexEntry } from "./sec-daily-index.ts";
import { handleForm4 } from "./sec-form4-handler.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import type { SecFilingFetcher, SecSubmissions } from "./sec-edgar.ts";
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
  // Issuer display name, threaded into the FilingIndexEntry.company field the
  // handler carries but does not read. The handler resolves the issuer itself
  // from the filing's <issuerCik>, so the issuer UUID is not an input here.
  company?: string;
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
  const recent = submissions.filings.recent;
  const inWindow = recent.accessionNumber
    .map((accession, index) => ({
      accession,
      form: recent.form[index],
      primaryDocument: recent.primaryDocument[index],
      filedDate: recent.filingDate[index],
      filedAtMs: Date.parse(recent.filingDate[index]),
    }))
    // EDGAR's parallel arrays can be ragged; a row missing any field it needs is
    // skipped rather than failing the whole issuer (mirrors backfillIssuerFilings).
    .filter(
      (c): c is { accession: string; form: string; primaryDocument: string; filedDate: string; filedAtMs: number } =>
        typeof c.accession === "string" &&
        c.accession.length > 0 &&
        typeof c.form === "string" &&
        typeof c.primaryDocument === "string" &&
        c.primaryDocument.length > 0 &&
        typeof c.filedDate === "string",
    )
    .filter((c) => FORM4_FORMS.has(c.form))
    .filter((c) => Number.isFinite(c.filedAtMs) && c.filedAtMs >= cutoffMs);

  // No silent truncation: EDGAR returns `recent` newest-first, so slicing keeps
  // the most recent filings, but a caller should know coverage was capped.
  if (inWindow.length > maxFilings) {
    console.warn(
      `[sec-form4-backfill] CIK ${input.cik}: ${inWindow.length} Form 4 filings in the last ${sinceDays}d ` +
        `exceed the cap of ${maxFilings}; processing the most recent ${maxFilings}.`,
    );
  }
  const candidates = inWindow.slice(0, maxFilings);

  const handlerDeps = { db: deps.db, objectStore: deps.objectStore, client: deps.secClient };
  let ingested = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if ((await findLiveDocumentIdByAccession(deps.db, candidate.accession)) !== null) {
      skipped += 1;
      continue;
    }
    const entry: FilingIndexEntry = {
      cik: input.cik,
      company: input.company ?? "",
      form: candidate.form,
      filedDate: candidate.filedDate,
      // handleForm4 keys off cik/accession/form/filedDate. fileName completes the
      // FilingIndexEntry contract with the real EDGAR primary-document path; the
      // Form 4 handler does not read it (it fetches `${accession}.txt`).
      fileName: `edgar/data/${input.cik}/${candidate.accession.replace(/-/g, "")}/${candidate.primaryDocument}`,
      accession: candidate.accession,
    };
    const result = await handleForm4(entry, handlerDeps);
    if (result.ingested) ingested += 1;
    else skipped += 1;
  }
  return { ingested, skipped };
}
