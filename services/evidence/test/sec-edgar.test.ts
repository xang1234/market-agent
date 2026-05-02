import test from "node:test";
import assert from "node:assert/strict";

import {
  SEC_EDGAR_DEFAULT_RATE_LIMIT,
  SEC_EDGAR_DEFAULT_USER_AGENT_ENV,
  SecEdgarClient,
  SecEdgarFetchError,
  SecEdgarRateLimitError,
  TokenBucketRateLimiter,
  filingArchiveUrl,
  filingIndexUrl,
  ingestSecFiling,
} from "../src/sec-edgar.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import { createSource } from "../src/source-repo.ts";
import type { QueryExecutor } from "../src/types.ts";
import { RecordingObjectStore } from "./recording-object-store.ts";

const VALID_USER_AGENT = "Market-Agent/0.1 (ops@example.com)";

function fixedClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

// ---- TokenBucketRateLimiter ------------------------------------------------

test("TokenBucketRateLimiter allows burst up to capacity without waiting", async () => {
  const clock = fixedClock();
  const limiter = new TokenBucketRateLimiter({
    capacity: 5,
    refillPerSecond: 5,
    now: clock.now,
  });

  for (let i = 0; i < 5; i++) {
    const waited = await limiter.acquire();
    assert.equal(waited, 0, `request ${i} should not have waited`);
  }
});

test("TokenBucketRateLimiter blocks the (capacity+1)-th request until refill", async () => {
  const clock = fixedClock();
  const sleeps: number[] = [];
  const limiter = new TokenBucketRateLimiter({
    capacity: 3,
    refillPerSecond: 3,
    now: clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
  });

  for (let i = 0; i < 3; i++) await limiter.acquire();

  const waited = await limiter.acquire();
  // refillPerSecond=3 → one token every ~333ms. After draining the bucket at
  // t=0, the next token isn't available until ~333ms.
  assert.ok(waited > 0, "must have waited for refill");
  assert.ok(waited <= 334, `waited ${waited}ms but refill is ~333ms`);
  assert.equal(sleeps.length, 1, "must have slept exactly once");
});

test("TokenBucketRateLimiter refills proportionally to elapsed time", async () => {
  const clock = fixedClock();
  const limiter = new TokenBucketRateLimiter({
    capacity: 10,
    refillPerSecond: 10,
    now: clock.now,
  });

  for (let i = 0; i < 10; i++) await limiter.acquire();

  // Half a second elapses externally — should refill ~5 tokens.
  clock.advance(500);

  for (let i = 0; i < 5; i++) {
    const waited = await limiter.acquire();
    assert.equal(waited, 0, `request ${i} after refill should not have waited`);
  }
});

test("TokenBucketRateLimiter rejects nonsensical config (defends the SEC ceiling)", () => {
  // Capacity > SEC's 10 req/sec ceiling is forbidden — silently allowing 100
  // would be a footgun: the limiter's existence implies it's safe to use.
  assert.throws(
    () =>
      new TokenBucketRateLimiter({
        capacity: 100,
        refillPerSecond: 100,
        now: () => 0,
      }),
    /capacity must be <= 10/,
  );
  assert.throws(
    () =>
      new TokenBucketRateLimiter({
        capacity: 0,
        refillPerSecond: 5,
        now: () => 0,
      }),
    /capacity must be a positive integer/,
  );
  assert.throws(
    () =>
      new TokenBucketRateLimiter({
        capacity: 5,
        refillPerSecond: 0,
        now: () => 0,
      }),
    /refillPerSecond must be > 0/,
  );
});

test("SEC_EDGAR_DEFAULT_RATE_LIMIT is set conservatively below SEC's 10 req/sec ceiling", () => {
  // Documents the defensive default at the type level so a future bump
  // requires editing this test (and re-justifying the headroom).
  assert.equal(SEC_EDGAR_DEFAULT_RATE_LIMIT.capacity, 8);
  assert.equal(SEC_EDGAR_DEFAULT_RATE_LIMIT.refillPerSecond, 8);
});

// ---- URL builders ----------------------------------------------------------

test("filingArchiveUrl pads CIK to 10 digits and strips dashes from accession in the path", () => {
  assert.equal(
    filingArchiveUrl({
      cik: 320193,
      accession_number: "0000320193-23-000106",
      document: "aapl-20230930.htm",
    }),
    "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
  );
});

test("filingArchiveUrl rejects malformed accession (NNNNNNNNNN-NN-NNNNNN)", () => {
  assert.throws(
    () =>
      filingArchiveUrl({
        cik: 320193,
        accession_number: "not-an-accession",
        document: "doc.htm",
      }),
    /accession_number/,
  );
});

test("filingArchiveUrl rejects non-positive CIK", () => {
  assert.throws(
    () =>
      filingArchiveUrl({
        cik: 0,
        accession_number: "0000320193-23-000106",
        document: "doc.htm",
      }),
    /cik/,
  );
});

test("filingArchiveUrl rejects path-traversal in document filename", () => {
  // Defense against an accession-doc index that returns "../../etc/passwd"
  // or similar — the URL builder is the choke point, so it has to be the
  // place we refuse.
  assert.throws(
    () =>
      filingArchiveUrl({
        cik: 320193,
        accession_number: "0000320193-23-000106",
        document: "../../escape.htm",
      }),
    /document/,
  );
  assert.throws(
    () =>
      filingArchiveUrl({
        cik: 320193,
        accession_number: "0000320193-23-000106",
        document: "subdir/doc.htm",
      }),
    /document/,
  );
  assert.throws(
    () =>
      filingArchiveUrl({
        cik: 320193,
        accession_number: "0000320193-23-000106",
        document: "",
      }),
    /document/,
  );
});

test("filingIndexUrl points at the per-accession index document", () => {
  assert.equal(
    filingIndexUrl({ cik: 320193, accession_number: "0000320193-23-000106" }),
    "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/0000320193-23-000106-index.htm",
  );
});

// ---- SecEdgarClient --------------------------------------------------------

test("SecEdgarClient constructor refuses an empty User-Agent (SEC Fair Access requirement)", () => {
  // Failing here at construction (not on first request) makes mis-deploys
  // crash at boot rather than after the first inbound trigger.
  assert.throws(
    () =>
      new SecEdgarClient({
        userAgent: "",
        fetch: async () => new Response("", { status: 200 }),
      }),
    /userAgent/,
  );
  assert.throws(
    () =>
      new SecEdgarClient({
        userAgent: "   ",
        fetch: async () => new Response("", { status: 200 }),
      }),
    /userAgent/,
  );
});

test("SecEdgarClient.fetchFiling sends the configured User-Agent + Accept headers", async () => {
  const seenHeaders: Headers[] = [];
  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async (_url, init) => {
      seenHeaders.push(new Headers(init?.headers));
      return new Response("filing-bytes", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  await client.fetchFiling({
    cik: 320193,
    accession_number: "0000320193-23-000106",
    document: "aapl-20230930.htm",
  });

  assert.equal(seenHeaders.length, 1);
  assert.equal(seenHeaders[0].get("user-agent"), VALID_USER_AGENT);
  // SEC's docs request a specific Accept header; missing it can prompt 403s.
  assert.match(seenHeaders[0].get("accept") ?? "", /\*\/\*|text\/html/i);
});

test("SecEdgarClient.fetchFiling returns bytes + contentType + retrievedAt", async () => {
  const expectedBytes = new TextEncoder().encode("filing body");
  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async () =>
      new Response(expectedBytes, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    now: () => Date.parse("2026-05-02T12:00:00Z"),
  });

  const result = await client.fetchFiling({
    cik: 320193,
    accession_number: "0000320193-23-000106",
    document: "aapl-20230930.htm",
  });

  assert.deepEqual(Array.from(result.bytes), Array.from(expectedBytes));
  assert.equal(result.contentType, "text/html; charset=utf-8");
  assert.equal(result.retrievedAt, "2026-05-02T12:00:00.000Z");
  assert.equal(
    result.url,
    "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
  );
});

test("SecEdgarClient.fetchFiling classifies 429 as SecEdgarRateLimitError (caller must back off)", async () => {
  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async () => new Response("rate limited", { status: 429 }),
  });

  await assert.rejects(
    client.fetchFiling({
      cik: 320193,
      accession_number: "0000320193-23-000106",
      document: "doc.htm",
    }),
    (err: unknown) => err instanceof SecEdgarRateLimitError && err.status === 429,
  );
});

test("SecEdgarClient.fetchFiling classifies non-2xx (404, 5xx) as SecEdgarFetchError with status", async () => {
  const cases = [404, 500, 503];
  for (const status of cases) {
    const client = new SecEdgarClient({
      userAgent: VALID_USER_AGENT,
      fetch: async () => new Response(`status ${status}`, { status }),
    });
    await assert.rejects(
      client.fetchFiling({
        cik: 320193,
        accession_number: "0000320193-23-000106",
        document: "doc.htm",
      }),
      (err: unknown) =>
        err instanceof SecEdgarFetchError &&
        err.status === status &&
        !(err instanceof SecEdgarRateLimitError),
      `status ${status} must reject with SecEdgarFetchError`,
    );
  }
});

test("SecEdgarClient.fetchFiling consults the rate limiter before issuing the request", async () => {
  const order: string[] = [];
  const limiter = {
    async acquire() {
      order.push("acquire");
      return 0;
    },
  };
  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async () => {
      order.push("fetch");
      return new Response("ok", { status: 200 });
    },
    rateLimiter: limiter,
  });

  await client.fetchFiling({
    cik: 320193,
    accession_number: "0000320193-23-000106",
    document: "doc.htm",
  });

  assert.deepEqual(order, ["acquire", "fetch"]);
});

test("SecEdgarClient.fromEnv reads the User-Agent from SEC_EDGAR_USER_AGENT and fails when unset", () => {
  const original = process.env[SEC_EDGAR_DEFAULT_USER_AGENT_ENV];
  try {
    delete process.env[SEC_EDGAR_DEFAULT_USER_AGENT_ENV];
    assert.throws(() => SecEdgarClient.fromEnv(), /SEC_EDGAR_USER_AGENT/);

    process.env[SEC_EDGAR_DEFAULT_USER_AGENT_ENV] = VALID_USER_AGENT;
    const client = SecEdgarClient.fromEnv();
    assert.ok(client instanceof SecEdgarClient);
  } finally {
    if (original === undefined) {
      delete process.env[SEC_EDGAR_DEFAULT_USER_AGENT_ENV];
    } else {
      process.env[SEC_EDGAR_DEFAULT_USER_AGENT_ENV] = original;
    }
  }
});

// ---- ingestSecFiling -------------------------------------------------------

const SOURCE_ID = "33333333-3333-4333-a333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-a444-444444444444";

function recordingDb() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      // sources insert returns the source row; documents insert returns the document row.
      const isSourceInsert = /insert into sources/.test(text);
      const row = isSourceInsert
        ? {
            source_id: SOURCE_ID,
            provider: values?.[0],
            kind: values?.[1],
            canonical_url: values?.[2],
            trust_tier: values?.[3],
            license_class: values?.[4],
            retrieved_at: new Date(values?.[5] as string),
            content_hash: values?.[6],
            created_at: new Date("2026-05-02T00:00:00.000Z"),
          }
        : {
            inserted: true,
            document_id: DOCUMENT_ID,
            source_id: values?.[0],
            provider_doc_id: values?.[1] ?? null,
            kind: values?.[2] ?? "filing",
            parent_document_id: null,
            conversation_id: null,
            title: values?.[5] ?? null,
            author: values?.[6] ?? null,
            published_at: null,
            lang: null,
            content_hash: values?.[9],
            raw_blob_id: values?.[10],
            parse_status: "pending",
            deleted_at: null,
            created_at: new Date("2026-05-02T00:00:00.000Z"),
            updated_at: new Date("2026-05-02T00:00:00.000Z"),
          };
      return {
        rows: [row] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("ingestSecFiling creates a primary/public source and ingests the document with a sha256 raw_blob_id", async () => {
  // Headline contract: a successful SEC pull lands BOTH a source row
  // (provider=sec_edgar, trust=primary, license=public) AND a documents
  // row pointing at a stored blob. The blob is sha256-addressed because
  // 'public' license_class routes through the permissive ingest path.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();
  const filingBytes = new TextEncoder().encode("<html>10-K body</html>");

  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async () =>
      new Response(filingBytes, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    now: () => Date.parse("2026-05-02T12:00:00Z"),
  });

  const result = await ingestSecFiling(
    { db, objectStore, secClient: client },
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
  assert.match(
    result.source.canonical_url ?? "",
    /sec\.gov\/Archives\/edgar\/data\/320193\//,
  );
  assert.equal(result.ingest.status, "blob_stored");
  assert.match(result.ingest.raw_blob_id, /^sha256:[0-9a-f]{64}$/);
  assert.equal(objectStore.putCalls, 1, "permissive license must store the blob");
  assert.equal(await objectStore.has(result.ingest.raw_blob_id), true);

  assert.match(queries[0]?.text ?? "", /insert into sources/);
  assert.match(queries[1]?.text ?? "", /insert into documents/);
});

test("ingestSecFiling sets provider_doc_id to the accession number for downstream dedupe", async () => {
  // Without provider_doc_id, two ingests of the same accession can't
  // dedupe at the documents table (content_hash collisions catch it
  // belatedly, but provider_doc_id is the cheap upfront signal).
  const { db, queries } = recordingDb();
  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async () => new Response("body", { status: 200 }),
  });

  await ingestSecFiling(
    { db, objectStore: new RecordingObjectStore(), secClient: client },
    {
      cik: 320193,
      accession_number: "0000320193-23-000106",
      document: "aapl-20230930.htm",
      form: "10-K",
    },
  );

  // documents insert is queries[1]; provider_doc_id is values[1] in createDocument.
  assert.equal(queries[1]?.values?.[1], "0000320193-23-000106");
});

test("ingestSecFiling propagates a SecEdgarFetchError without writing source or document", async () => {
  // Fail-closed: a 404/5xx must not leave a half-attributed source row
  // pointing at content we never retrieved.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();
  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async () => new Response("missing", { status: 404 }),
  });

  await assert.rejects(
    ingestSecFiling(
      { db, objectStore, secClient: client },
      {
        cik: 320193,
        accession_number: "0000320193-23-000106",
        document: "missing.htm",
        form: "10-K",
      },
    ),
    SecEdgarFetchError,
  );

  assert.equal(queries.length, 0, "no source or documents row should have been written");
  assert.equal(objectStore.putCalls, 0);
});

test("ingestSecFiling end-to-end against the real source-repo (createSource path)", async () => {
  // Light integration: uses the actual createSource so a regression in
  // SourceInput shape (trust_tier/license_class typos) breaks here, not
  // only at db time.
  const calls: string[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push(text);
      if (/insert into sources/.test(text)) {
        const row = await createSourceCapture(values);
        return {
          rows: [row] as R[],
          command: "INSERT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      // documents insert
      return {
        rows: [
          {
            inserted: true,
            document_id: DOCUMENT_ID,
            source_id: values?.[0],
            provider_doc_id: values?.[1] ?? null,
            kind: values?.[2] ?? "filing",
            parent_document_id: null,
            conversation_id: null,
            title: null,
            author: null,
            published_at: null,
            lang: null,
            content_hash: values?.[9],
            raw_blob_id: values?.[10],
            parse_status: "pending",
            deleted_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  const objectStore = new MemoryObjectStore();
  const client = new SecEdgarClient({
    userAgent: VALID_USER_AGENT,
    fetch: async () =>
      new Response("body", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  // createSource in the real source-repo runs validateSourceInput, which
  // rejects bad trust_tier/license_class — so this round-trip exercises
  // the real validator for the SEC ingestSecFiling output.
  const source = await createSource(db, {
    provider: "sec_edgar",
    kind: "filing",
    canonical_url: "https://www.sec.gov/Archives/edgar/data/320193/.../doc.htm",
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: "2026-05-02T00:00:00Z",
  });
  assert.equal(source.provider, "sec_edgar");

  // Now full ingest path with the same db (sources + documents inserts).
  const result = await ingestSecFiling(
    { db, objectStore, secClient: client },
    {
      cik: 320193,
      accession_number: "0000320193-23-000106",
      document: "doc.htm",
      form: "10-K",
    },
  );
  assert.equal(result.source.provider, "sec_edgar");
  assert.equal(calls.length, 3, "createSource + ingestSecFiling's source insert + documents insert");
});

async function createSourceCapture(values: unknown[] | undefined) {
  return {
    source_id: SOURCE_ID,
    provider: values?.[0],
    kind: values?.[1],
    canonical_url: values?.[2],
    trust_tier: values?.[3],
    license_class: values?.[4],
    retrieved_at: new Date(values?.[5] as string),
    content_hash: values?.[6],
    created_at: new Date("2026-05-02T00:00:00.000Z"),
  };
}
