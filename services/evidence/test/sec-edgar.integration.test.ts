import test from "node:test";
import assert from "node:assert/strict";

import {
  SEC_EDGAR_DEFAULT_USER_AGENT_ENV,
  SecEdgarClient,
  ingestSecFiling,
} from "../src/sec-edgar.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

// Live integration against SEC EDGAR. Skipped by default — opt-in by
// exporting SEC_EDGAR_USER_AGENT (e.g.,
//   SEC_EDGAR_USER_AGENT="Market-Agent/0.1 (you@example.com)" npm test)
// AND running on a machine with Docker for Postgres. Pulls Apple's
// 2023 10-K from the live SEC archive — small enough not to be rude
// but big enough to exercise the full retrieval-+-storage path.
const liveOptIn =
  typeof process.env[SEC_EDGAR_DEFAULT_USER_AGENT_ENV] === "string" &&
  process.env[SEC_EDGAR_DEFAULT_USER_AGENT_ENV]!.trim().length > 0;

test(
  "live: pulls Apple's 2023 10-K from sec.gov and stores it via ingestSecFiling",
  { skip: !liveOptIn || !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "ingest-fra-10a-live");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new MemoryObjectStore();
    const sec = SecEdgarClient.fromEnv();

    // AAPL 2023 10-K, filed 2023-11-03. The accession + document
    // filename are public artifacts; their permanence is the whole
    // point of EDGAR.
    const result = await ingestSecFiling(
      { db: client, objectStore, secClient: sec },
      {
        cik: 320193,
        accession_number: "0000320193-23-000106",
        document: "aapl-20230930.htm",
        form: "10-K",
      },
    );

    assert.equal(result.source.provider, "sec_edgar");
    assert.equal(result.source.kind, "filing");
    assert.equal(result.source.trust_tier, "primary");
    assert.equal(result.source.license_class, "public");

    assert.equal(result.ingest.status, "blob_stored");
    assert.match(result.ingest.raw_blob_id, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      await objectStore.has(result.ingest.raw_blob_id),
      true,
      "blob must be retrievable from object store after live ingest",
    );

    // Sanity: the 10-K body is HTML and non-trivial in size. If the
    // SEC ever serves an empty/redirect response for this URL, this
    // assertion will catch it loudly rather than silently storing junk.
    const fetched = await objectStore.get(result.ingest.raw_blob_id);
    assert.ok(fetched);
    assert.ok(
      fetched.bytes.byteLength > 100_000,
      `expected 10-K body > 100KB, got ${fetched.bytes.byteLength} bytes`,
    );
  },
);
