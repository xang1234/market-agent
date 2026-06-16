// Backfill recent SEC filings (documents + issuer mentions) for issuers.
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... S3_* =... \
//     npm run backfill:sec-filings [-- <issuer_uuid> ...]
//
// With no arguments, backfills every issuer that has a CIK. Blobs are written
// to S3/MinIO (not the in-process memory store) because consumers like
// analyst-grids reader columns load document text via S3.

import { createEvidenceCliRuntime } from "./evidence-cli-runtime.ts";
import { backfillIssuerFilings } from "./sec-filings-backfill.ts";

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
        const result = await backfillIssuerFilings(
          { db: pool, objectStore, secClient },
          { issuerId: issuer.issuer_id, cik },
        );
        const forms = result.ingested.map((f) => f.form).join(", ") || "none";
        console.log(
          `${issuer.legal_name}: ingested ${result.ingested.length} filing(s) [${forms}], skipped ${result.skipped} already present`,
        );
      } catch (error) {
        hadFailures = true;
        console.error(`${issuer.legal_name}: backfill failed —`, error instanceof Error ? error.message : error);
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
