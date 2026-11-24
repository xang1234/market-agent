// Cross-market daily EDGAR crawl: fetch the day's master index, dispatch each
// filing of a requested form to its handler, skipping any accession already
// stored (idempotent), and record per-form progress in the crawl ledger.
import type { FilingIndexEntry } from "./sec-daily-index.ts";
import { recordCrawlBatch, type CrawlFailure } from "./edgar-crawl-ledger-repo.ts";
import { findLiveDocumentIdByAccession } from "./document-repo.ts";
import type { ObjectStore } from "./object-store.ts";
import type { SecFilingFetcher } from "./sec-edgar.ts";
import type { QueryExecutor } from "./types.ts";
import { failed, type Outcome } from "../../shared/src/outcome.ts";

export type DailyCrawlClient = { fetchDailyIndex(date: Date): Promise<FilingIndexEntry[]> };

// Handlers fetch the filing they're dispatched (the submission .txt), so the
// capability they need is fetchFiling — not the index fetch the orchestrator uses.
// A cause as the ledger's jsonb can hold it: Postgres rejects a NUL or a lone
// surrogate in jsonb text, and a parser error can quote raw filing bytes. Capped so one quoted
// document cannot bloat the row.
const CAUSE_MAX = 500;
function storableCause(cause: Error): string {
  const clean = (text: string) => text.replace(/\u0000/g, "").toWellFormed();
  // Capped by code point, so the cut never leaves half a surrogate pair, which jsonb rejects too.
  return Array.from(clean(cause.message) || clean(cause.name)).slice(0, CAUSE_MAX).join("");
}

export type FormHandlerDeps = { db: QueryExecutor; objectStore: ObjectStore; client: SecFilingFetcher };
// What a handler returns: it throws on failure, so it never returns `failed`;
// the crawl turns a throw into one.
export type HandlerResult = Exclude<Outcome<string>, { status: "failed" }>;
// CONTRACT: a handler MUST persist the filing's `documents` row and all derived
// rows (events/claims/facts/mentions) in a SINGLE database transaction. The
// orchestrator skips any accession that already has a live `documents` row, so a
// non-atomic handler that commits the document and then fails before its derived
// rows would strand the filing — the next crawl would skip it and never repair
// the missing rows. Compose createSource/createDocument + the derived writes
// inside one transaction (see issuer-ir-ingest.ts); do NOT reuse the
// non-transactional `ingestSecFiling` and then write derived rows separately.
// "stored" holds the accession now on file; "empty" says why it was not ingested.
export type FormHandler = (entry: FilingIndexEntry, deps: FormHandlerDeps) => Promise<Outcome<string>>;

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
  // Why each skipped filing was not ingested, by reason; failures are listed
  // apart, so skipped = sum(skipReasons) + failures.length.
  skipReasons: Record<string, number>;
  failures: CrawlFailure[];
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
  for (const form of wanted) byForm[form] = { total: 0, ingested: 0, skipped: 0, status: "succeeded", skipReasons: {}, failures: [] };
  const skip = (outcome: FormCrawlOutcome, reason: string) => {
    outcome.skipped += 1;
    outcome.skipReasons[reason] = (outcome.skipReasons[reason] ?? 0) + 1;
  };

  for (const entry of entries) {
    const outcome = byForm[entry.form];
    outcome.total += 1;
    // Dedup is infrastructure: a DB fault here must abort the crawl loudly
    // rather than be downgraded to a silently-skipped filing. Only the handler
    // call is wrapped below, so a parser/persistence bug isolates to its form.
    if ((await findLiveDocumentIdByAccession(deps.db, entry.accession)) !== null) {
      skip(outcome, "already_stored");
      continue;
    }
    let result: Outcome<string>;
    try {
      result = await input.handlers[entry.form](entry, { db: deps.db, objectStore: deps.objectStore, client: deps.client });
    } catch (err) {
      result = failed(err);
    }
    if (result.status === "stored") outcome.ingested += 1;
    else if (result.status === "empty") skip(outcome, result.reason);
    else {
      // A handler failure counts the filing as skipped (keeps total = ingested
      // + skipped), keeps and logs its cause, and the crawl continues.
      outcome.skipped += 1;
      outcome.failures.push({ accession: entry.accession, cause: storableCause(result.cause) });
      console.error(
        `[sec-daily-crawl] handler failed for form=${entry.form} accession=${entry.accession}`,
        result.cause,
      );
    }
  }

  for (const form of wanted) {
    const o = byForm[form];
    // A form with a failure is partial only if it still ingested something.
    o.status = o.failures.length === 0 ? "succeeded" : o.ingested > 0 ? "partial" : "failed";
    await recordCrawlBatch(deps.db, {
      form,
      indexDate,
      status: o.status,
      filingsTotal: o.total,
      filingsIngested: o.ingested,
      filingsSkipped: o.skipped,
      startedAt,
      failures: o.failures,
    });
  }
  return { byForm };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
