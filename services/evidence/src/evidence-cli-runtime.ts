// Shared bootstrap for the evidence service's one-shot CLIs (daily crawl,
// per-issuer backfill, …). Validates the required env, then builds the pg Pool,
// the S3-backed object store, and a Fair-Access SEC client. The caller owns the
// pool lifecycle — call `await runtime.db.end()` in a finally.
import { Pool } from "pg";
import { createS3Client, S3ObjectStore } from "./s3-object-store.ts";
import { SecEdgarClient } from "./sec-edgar.ts";

export type EvidenceCliRuntime = {
  db: Pool;
  objectStore: S3ObjectStore;
  secClient: SecEdgarClient;
};

export function createEvidenceCliRuntime(): EvidenceCliRuntime {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
    throw new Error(
      "S3_BUCKET and S3_REGION are required: evidence CLIs write blobs to S3/MinIO so reader columns can load them (the in-process memory store would discard them at exit)",
    );
  }

  // Reject partial static-credential config: a single key set on its own would
  // otherwise silently fall through to the default provider chain and pick up
  // unrelated ambient credentials. Set both (explicit) or neither (default chain).
  if (Boolean(process.env.S3_ACCESS_KEY_ID) !== Boolean(process.env.S3_SECRET_ACCESS_KEY)) {
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together (or both omitted to use the default credential chain)",
    );
  }

  const secClient = SecEdgarClient.fromEnv();
  const s3 = createS3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
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

  return { db, objectStore, secClient };
}
