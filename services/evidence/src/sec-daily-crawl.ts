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
    try {
      if ((await findLiveDocumentIdByAccession(deps.db, entry.accession)) !== null) {
        outcome.skipped += 1;
        continue;
      }
      const handlerDeps: FormHandlerDeps = {
        db: deps.db,
        objectStore: deps.objectStore,
        client: deps.client,
      };
      const result = await input.handlers[entry.form](entry, handlerDeps);
      if (result.ingested) outcome.ingested += 1;
      else outcome.skipped += 1;
    } catch (err) {
      // One bad filing must not sink the day's crawl: mark the form partial,
      // count it as skipped so the ledger keeps total = ingested + skipped, and
      // log it (no silent drops) so an operator can diagnose. Then continue.
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
