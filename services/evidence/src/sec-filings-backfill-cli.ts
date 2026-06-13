// Backfill recent SEC filings (documents + issuer mentions) for issuers.
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... S3_* =... \
//     npm run backfill:sec-filings [-- <issuer_uuid> ...]
//
// With no arguments, backfills every issuer that has a CIK. Blobs are written
// to S3/MinIO (not the in-process memory store) because consumers like
// analyst-grids reader columns load document text via S3.

import { Pool } from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStore } from "./s3-object-store.ts";
import { SecEdgarClient } from "./sec-edgar.ts";
import { backfillIssuerFilings } from "./sec-filings-backfill.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
  throw new Error(
    "S3_BUCKET and S3_REGION are required: the backfill writes blobs to S3/MinIO so reader columns can load them (the in-process memory store would discard them at exit)",
  );
}

const secClient = SecEdgarClient.fromEnv();
const s3 = new S3Client({
  region: process.env.S3_REGION,
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  ...(process.env.S3_FORCE_PATH_STYLE === "true" ? { forcePathStyle: true } : {}),
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});
const objectStore = new S3ObjectStore({ client: s3, bucket: process.env.S3_BUCKET });
const pool = new Pool({ connectionString: databaseUrl });

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
