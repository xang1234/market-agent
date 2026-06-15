// One-shot daily EDGAR crawl entrypoint (designed for external-cron invocation).
//
//   DATABASE_URL=... SEC_EDGAR_USER_AGENT=... S3_BUCKET=... S3_REGION=... \
//     npm run crawl:sec-daily [-- --date YYYY-MM-DD]
//
// With no --date flag, crawls yesterday's or today's UTC date (whatever `now`
// resolves to). Form handlers (Form 4, 8-K, 13F, …) are registered in
// FORM_HANDLERS; the slice is intentionally empty at this stage.

import { Pool } from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStore } from "./s3-object-store.ts";
import { SecEdgarClient } from "./sec-edgar.ts";
import { crawlDailyFilings, type FormHandler } from "./sec-daily-crawl.ts";

// ---------------------------------------------------------------------------
// Exported so tests can import and exercise argv parsing without touching
// the DB or network.
// ---------------------------------------------------------------------------

export function resolveCrawlDate(argv: string[], now: () => Date = () => new Date()): Date {
  const idx = argv.indexOf("--date");
  if (idx !== -1 && argv[idx + 1]) {
    return new Date(`${argv[idx + 1]}T00:00:00Z`);
  }
  return now();
}

// Form handlers registered here by later slices (Form 4 / 8-K / 13F, …).
export const FORM_HANDLERS: Record<string, FormHandler> = {};

// ---------------------------------------------------------------------------
// main — only runs when this module is the process entrypoint (not under test)
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const date = resolveCrawlDate(argv);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
    throw new Error(
      "S3_BUCKET and S3_REGION are required: the crawl writes blobs to S3/MinIO so reader columns can load them",
    );
  }

  const client = SecEdgarClient.fromEnv();
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
  const db = new Pool({ connectionString: databaseUrl });

  try {
    const result = await crawlDailyFilings({ db, client, objectStore }, { date, handlers: FORM_HANDLERS });
    console.log(JSON.stringify({ date: date.toISOString().slice(0, 10), result }));
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
