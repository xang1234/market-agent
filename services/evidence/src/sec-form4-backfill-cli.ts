// Backfill recent Form 4 insider transactions for issuers.
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... S3_* =... \
//     npm run backfill:sec-form4 [-- <issuer_uuid> ...]
//
// With no arguments, backfills every issuer that has a CIK. Form 4 ingestion is
// atomic per filing (read-model rows + per-transaction events + material-only
// claims), so a rerun is idempotent: accessions already stored are skipped.

import { createEvidenceCliRuntime } from "./evidence-cli-runtime.ts";
import { backfillIssuerForm4 } from "./sec-form4-backfill.ts";

async function main(): Promise<void> {
  const { db: pool, objectStore, secClient } = createEvidenceCliRuntime();
  const requestedIds = process.argv.slice(2);
  let hadFailures = false;
  try {
    const issuers = requestedIds.length
      ? await pool.query<{ issuer_id: string; legal_name: string; cik: string | null }>(
          `select issuer_id::text as issuer_id, legal_name, cik from issuers where issuer_id = any($1::uuid[])`,
          [requestedIds],
        )
      : await pool.query<{ issuer_id: string; legal_name: string; cik: string | null }>(
          `select issuer_id::text as issuer_id, legal_name, cik from issuers where cik is not null order by legal_name`,
        );

    for (const issuer of issuers.rows) {
      const cik = Number(issuer.cik);
      if (!Number.isInteger(cik) || cik <= 0) {
        console.log(`skip ${issuer.legal_name}: no usable CIK (${issuer.cik})`);
        continue;
      }
      try {
        const result = await backfillIssuerForm4(
          { db: pool, objectStore, secClient },
          { cik },
        );
        console.log(
          `${issuer.legal_name}: ingested ${result.ingested} Form 4 filing(s), skipped ${result.skipped} already present`,
        );
      } catch (error) {
        hadFailures = true;
        console.error(
          `${issuer.legal_name}: Form 4 backfill failed —`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } finally {
    await pool.end();
  }
  // Per-issuer failures are logged and the loop continues, but automation must
  // still see a non-zero exit when any issuer failed.
  if (hadFailures) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
