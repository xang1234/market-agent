// Backfill SEC cash flow and balance sheet facts for income periods already
// on file (backfillSecCompanionStatements).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... \
//     npm run backfill:sec-statements [-- <issuer_uuid> ...]
//
// With no arguments, backfills every issuer that has SEC income facts. Either
// way it skips the frozen golden dataset's issuers. One companyfacts download
// per issuer, paced under SEC's fair-access rate with a backoff on HTTP 429
// (withSecFairAccess). A rerun is safe: a stored fact the filing still states
// is kept and gains the proofs it lacks.

import { Pool } from "pg";

import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "./provider-sources.ts";
import type { SecEdgarFetcher } from "./sec-edgar.ts";
import { createSecCompanyFactsHttpFetcher, withSecFairAccess } from "./sec-edgar-http.ts";
import { backfillSecCompanionStatements, type FundamentalsTransactionalQueryExecutor } from "./sec-facts-repository.ts";

const FROZEN_ISSUER_IDS: ReadonlySet<string> = new Set(Object.values(GOLDEN_ISSUER_IDS));

export async function backfillSecStatements(
  db: FundamentalsTransactionalQueryExecutor,
  fetcher: SecEdgarFetcher,
  requestedIds: ReadonlyArray<string>,
  log: Pick<Console, "log" | "warn" | "error"> = console,
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
  const pool = new Pool({ connectionString: databaseUrl });
  // Paced under SEC's fair-access rate, backing off on a 429.
  const fetcher = withSecFairAccess(createSecCompanyFactsHttpFetcher({ userAgent, baseUrl: process.env.SEC_EDGAR_BASE_URL }));
  try {
    const { failures } = await backfillSecStatements(pool, fetcher, process.argv.slice(2));
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
