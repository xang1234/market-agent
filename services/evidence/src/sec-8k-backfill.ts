// Per-issuer 8-K backfill: the on-demand counterpart to the daily crawl. Lists an
// issuer's recent 8-K filings via the submissions API and persists each accession
// not already stored. Item codes come from the feed's `recent.items` (clean
// numeric codes) — no header parsing needed on this path — and the rows are
// written by the shared persist8kFiling, so crawl and backfill produce identical
// events/claims. Idempotent: accessions with a live documents row are skipped.
import { persist8kFiling, type Form8kFilingRef } from "./sec-8k-handler.ts";
import { classify8kItems } from "./sec-8k-item-taxonomy.ts";
import { resolveIssuerIdByCik } from "./sec-issuer-resolve.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
import { withTransaction } from "./transaction.ts";
import { recentSubmissionRows, type SecFilingFetcher, type SecSubmissions } from "./sec-edgar.ts";
import type { ObjectStore } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";

const FORM8K_FORMS: ReadonlySet<string> = new Set(["8-K", "8-K/A"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export type Form8kBackfillClient = SecFilingFetcher & {
  fetchSubmissions(cik: number): Promise<SecSubmissions>;
};

export type Form8kBackfillDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  secClient: Form8kBackfillClient;
};

export type BackfillIssuer8kInput = {
  cik: number;
  // Defaults match the reader's document-selection window (180 days).
  sinceDays?: number;
  maxFilings?: number;
  now?: () => Date;
};

export type BackfillIssuer8kResult = {
  ingested: number;
  skipped: number;
};

export async function backfillIssuer8k(
  deps: Form8kBackfillDeps,
  input: BackfillIssuer8kInput,
): Promise<BackfillIssuer8kResult> {
  const sinceDays = input.sinceDays ?? 180;
  const maxFilings = input.maxFilings ?? 50;
  const now = input.now ?? (() => new Date());
  const cutoffMs = now().getTime() - sinceDays * DAY_MS;

  // One issuer per call; resolve once up front (skip the whole issuer if untracked).
  const issuerId = await resolveIssuerIdByCik(deps.db, input.cik);
  if (issuerId === null) {
    console.warn(`[sec-8k-backfill] skip CIK ${input.cik}: not tracked`);
    return { ingested: 0, skipped: 0 };
  }

  const submissions = await deps.secClient.fetchSubmissions(input.cik);
  const inWindow = recentSubmissionRows(submissions.filings.recent)
    .filter((row) => FORM8K_FORMS.has(row.form))
    .filter((row) => row.filedAtMs >= cutoffMs);

  if (inWindow.length > maxFilings) {
    console.warn(
      `[sec-8k-backfill] CIK ${input.cik}: ${inWindow.length} 8-K filings in the last ${sinceDays}d ` +
        `exceed the cap of ${maxFilings}; processing the most recent ${maxFilings}.`,
    );
  }
  const candidates = inWindow.slice(0, maxFilings);

  let ingested = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if ((await findLiveDocumentIdByAccession(deps.db, candidate.accession)) !== null) {
      skipped += 1;
      continue;
    }
    const items = classify8kItems(
      candidate.items.split(",").map((code) => code.trim()).filter((code) => code !== ""),
    );
    // An 8-K with no item codes in the feed has nothing to record; skip without
    // fetching (no orphan document), mirroring the crawl handler's empty guard.
    if (items.length === 0) {
      skipped += 1;
      continue;
    }
    const fetched = await deps.secClient.fetchFiling({
      cik: input.cik,
      accession_number: candidate.accession,
      document: `${candidate.accession}.txt`,
    });
    const entry: Form8kFilingRef = {
      cik: input.cik,
      accession: candidate.accession,
      form: candidate.form,
      filedDate: candidate.filedDate,
    };
    await withTransaction(deps.db, async (tx) => {
      await persist8kFiling({ tx, objectStore: deps.objectStore }, { issuerId, fetched, entry, items });
    });
    ingested += 1;
  }
  return { ingested, skipped };
}
