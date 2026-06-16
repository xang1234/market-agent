// Cross-market daily EDGAR crawl: fetch the day's master index, dispatch each
// filing of a requested form to its handler, skipping any accession already
// stored (idempotent), and record per-form progress in the crawl ledger.
import type { FilingIndexEntry } from "./sec-daily-index.ts";
import { recordCrawlBatch } from "./edgar-crawl-ledger-repo.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import type { SecFilingFetcher } from "./sec-edgar.ts";
import type { QueryExecutor } from "./types.ts";

export type DailyCrawlClient = { fetchDailyIndex(date: Date): Promise<FilingIndexEntry[]> };

// Handlers fetch the filing they're dispatched (the submission .txt), so the
// capability they need is fetchFiling — not the index fetch the orchestrator uses.
export type FormHandlerDeps = { db: QueryExecutor; objectStore: ObjectStore; client: SecFilingFetcher };
// CONTRACT: a handler MUST persist the filing's `documents` row and all derived
// rows (events/claims/facts/mentions) in a SINGLE database transaction. The
// orchestrator skips any accession that already has a live `documents` row, so a
// non-atomic handler that commits the document and then fails before its derived
// rows would strand the filing — the next crawl would skip it and never repair
// the missing rows. Compose createSource/createDocument + the derived writes
// inside one transaction (see issuer-ir-ingest.ts); do NOT reuse the
// non-transactional `ingestSecFiling` and then write derived rows separately.
export type FormHandler = (entry: FilingIndexEntry, deps: FormHandlerDeps) => Promise<{ ingested: boolean }>;

export type CrawlDailyFilingsDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
  // The orchestrator reads the daily index; handlers fetch filings — the client
  // must do both. SecEdgarClient satisfies this intersection.
  client: DailyCrawlClient & SecFilingFetcher;
};

export type CrawlDailyFilingsInput = {
  date: Date;
  handlers: Record<string, FormHandler>;
  now?: () => Date;
};

export type FormCrawlOutcome = {
  total: number;
  ingested: number;
  skipped: number;
  status: "succeeded" | "partial" | "failed";
};

export type CrawlDailyFilingsResult = { byForm: Record<string, FormCrawlOutcome> };

export async function crawlDailyFilings(
  deps: CrawlDailyFilingsDeps,
  input: CrawlDailyFilingsInput,
): Promise<CrawlDailyFilingsResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const indexDate = isoDate(input.date);
  const wanted = new Set(Object.keys(input.handlers));
  const entries = (await deps.client.fetchDailyIndex(input.date)).filter((e) => wanted.has(e.form));

  const byForm: Record<string, FormCrawlOutcome> = {};
  for (const form of wanted) byForm[form] = { total: 0, ingested: 0, skipped: 0, status: "succeeded" };

  for (const entry of entries) {
    const outcome = byForm[entry.form];
    outcome.total += 1;
    // Dedup is infrastructure: a DB fault here must abort the crawl loudly
    // rather than be downgraded to a silently-skipped filing. Only the handler
    // call is wrapped below, so a parser/persistence bug isolates to its form.
    if ((await findLiveDocumentIdByAccession(deps.db, entry.accession)) !== null) {
      outcome.skipped += 1;
      continue;
    }
    try {
      const handlerDeps: FormHandlerDeps = {
        db: deps.db,
        objectStore: deps.objectStore,
        client: deps.client,
      };
      const result = await input.handlers[entry.form](entry, handlerDeps);
      if (result.ingested) outcome.ingested += 1;
      else outcome.skipped += 1;
    } catch (err) {
      // A handler failure marks the form partial and counts the filing as
      // skipped (keeps total = ingested + skipped), logs it (no silent drops),
      // and the crawl continues to the next filing.
      outcome.status = "partial";
      outcome.skipped += 1;
      console.error(
        `[sec-daily-crawl] handler failed for form=${entry.form} accession=${entry.accession}`,
        err,
      );
    }
  }

  for (const form of wanted) {
    const o = byForm[form];
    await recordCrawlBatch(deps.db, {
      form,
      indexDate,
      status: o.status,
      filingsTotal: o.total,
      filingsIngested: o.ingested,
      filingsSkipped: o.skipped,
      startedAt,
    });
  }
  return { byForm };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
