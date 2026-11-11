// Backfill SEC cash flow and balance sheet facts for income periods already
// on file (backfillSecCompanionStatements).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... \
//     npm run backfill:sec-statements [-- [--annual-history-years N] <issuer_uuid> ...]
//
// With no issuers, backfills every issuer that has SEC income facts. Either
// way it skips the frozen golden dataset's issuers. --annual-history-years is
// for a dev DB only (#610), so it refuses a DATABASE_URL that is not on this
// machine: it also stores each issuer's newest N fiscal years of 10-K
// statements and cover counts from the same download, with or without income
// on file, so an offline backtest has history to read. One companyfacts download
// per issuer, paced under SEC's fair-access rate with a backoff on HTTP 429
// (withSecFairAccess). A rerun is safe: a stored fact the filing still states
// is kept and gains the proofs it lacks.

import { parseArgs } from "node:util";
import { Pool } from "pg";
import { logPoolErrors } from "../../shared/src/pool-client.ts";

import { FROZEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "./provider-sources.ts";
import type { SecEdgarFetcher } from "./sec-edgar.ts";
import { createSecCompanyFactsHttpFetcher, withSecFairAccess } from "./sec-edgar-http.ts";
import { backfillSecCompanionStatements, type FundamentalsTransactionalQueryExecutor } from "./sec-facts-repository.ts";


export async function backfillSecStatements(
  db: FundamentalsTransactionalQueryExecutor,
  fetcher: SecEdgarFetcher,
  requestedIds: ReadonlyArray<string>,
  log: Pick<Console, "log" | "warn" | "error"> = console,
  annualHistoryYears = 0,
): Promise<{ failures: number }> {
  const issuers = requestedIds.length
    ? await db.query<{ issuer_id: string; legal_name: string }>(
        `select issuer_id::text as issuer_id, legal_name from issuers where issuer_id = any($1::uuid[])`,
        [requestedIds],
      )
    : await db.query<{ issuer_id: string; legal_name: string }>(
        `select i.issuer_id::text as issuer_id, i.legal_name
           from issuers i
          where i.cik is not null
            and exists (
              select 1 from facts f join sources s on s.source_id = f.source_id
               where f.subject_kind = 'issuer' and f.subject_id = i.issuer_id and s.provider = 'sec_edgar'
            )
          order by i.legal_name`,
      );
  let failures = 0;
  for (const issuer of issuers.rows) {
    if (FROZEN_ISSUER_IDS.has(issuer.issuer_id)) {
      log.log(`${issuer.legal_name}: skipped, it is the frozen golden dataset`);
      continue;
    }
    try {
      const { periods } = await backfillSecCompanionStatements(db, {
        issuerId: issuer.issuer_id,
        fetcher,
        sourceId: SEC_EDGAR_FILING_SOURCE_ID,
        logger: log,
        annualHistoryYears,
      });
      log.log(`${issuer.legal_name}: cash flow and balance sheet checked for ${periods} period(s)`);
    } catch (error) {
      failures += 1;
      log.error(`${issuer.legal_name}: backfill failed —`, error instanceof Error ? error.message : error);
    }
  }
  return { failures };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const userAgent = process.env.SEC_EDGAR_USER_AGENT;
  if (!databaseUrl || !userAgent) throw new Error("DATABASE_URL and SEC_EDGAR_USER_AGENT are required");
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "annual-history-years": { type: "string" } } });
  const years = Number(values["annual-history-years"] ?? 0);
  if (!Number.isInteger(years) || years < 0) throw new Error("--annual-history-years needs a whole number of years, e.g. 10");
  if (years > 0) {
    // URL.parse, unlike new URL, has no error to carry the URL and its password into the log.
    const host = URL.parse(databaseUrl)?.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error(`--annual-history-years is for a dev DB only: DATABASE_URL must point at localhost or 127.0.0.1, not ${host || "an unreadable URL"}`);
    }
  }
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl }));
  // Paced under SEC's fair-access rate, backing off on a 429.
  // A bulk run downloads the largest companyfacts files, so it waits longer than a request does.
  const fetcher = withSecFairAccess(createSecCompanyFactsHttpFetcher({ userAgent, baseUrl: process.env.SEC_EDGAR_BASE_URL, timeoutMs: 120_000 }));
  try {
    const { failures } = await backfillSecStatements(pool, fetcher, positionals, console, years);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
