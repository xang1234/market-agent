import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  NEWS_ARTICLE_ALLOWED_LICENSE_CLASSES,
  NEWS_ARTICLE_ALLOWED_TRUST_TIERS,
  PRESS_RELEASE_ALLOWED_LICENSE_CLASSES,
  PRESS_RELEASE_ALLOWED_TRUST_TIERS,
  TRANSCRIPT_ALLOWED_LICENSE_CLASSES,
  TRANSCRIPT_ALLOWED_TRUST_TIERS,
  canonicalizeNewsUrl,
  ingestEarningsTranscript,
  ingestNewsArticle,
  ingestPressRelease,
} from "../src/news-ingest.ts";
import type { QueryExecutor } from "../src/types.ts";
import { RecordingObjectStore } from "./recording-object-store.ts";

const SOURCE_ID = "11111111-1111-4111-a111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-a222-222222222222";

function recordingDb() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      const row = /insert into sources/.test(text)
        ? {
            source_id: SOURCE_ID,
            provider: values?.[0],
            kind: values?.[1],
            canonical_url: values?.[2],
            trust_tier: values?.[3],
            license_class: values?.[4],
            retrieved_at: new Date(values?.[5] as string),
            content_hash: values?.[6],
            user_id: values?.[7],
            created_at: new Date("2026-05-03T00:00:00.000Z"),
          }
        : {
            inserted: true,
            document_id: DOCUMENT_ID,
            source_id: values?.[0],
            provider_doc_id: values?.[1] ?? null,
            kind: values?.[2],
            parent_document_id: null,
            conversation_id: null,
            title: values?.[5] ?? null,
            author: values?.[6] ?? null,
            published_at: values?.[7] ?? null,
            lang: values?.[8] ?? null,
            content_hash: values?.[9],
            raw_blob_id: values?.[10],
            parse_status: "pending",
            deleted_at: null,
            created_at: new Date("2026-05-03T00:00:00.000Z"),
            updated_at: new Date("2026-05-03T00:00:00.000Z"),
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

// ---- canonicalizeNewsUrl ---------------------------------------------------

test("canonicalizeNewsUrl strips utm_* tracking parameters", () => {
  const before = "https://example.com/article/123?utm_source=newsletter&utm_medium=email&utm_campaign=q1&id=42";
  const after = canonicalizeNewsUrl(before);
  assert.equal(after, "https://example.com/article/123?id=42");
});

test("canonicalizeNewsUrl strips fbclid, gclid, mc_eid, mc_cid, _hsenc/_hsmi (no-semantic tracking ids)", () => {
  for (const tracker of ["fbclid", "gclid", "mc_eid", "mc_cid", "_hsenc", "_hsmi", "yclid", "msclkid"]) {
    const url = `https://example.com/x?${tracker}=abc123&keep=ok`;
    assert.equal(canonicalizeNewsUrl(url), "https://example.com/x?keep=ok", `${tracker} must be stripped`);
  }
});

test("canonicalizeNewsUrl lowercases the host but preserves path/query case", () => {
  // Host is case-insensitive per RFC 3986; path and query are case-sensitive
  // and must be preserved verbatim (e.g. an article slug with capitals).
  assert.equal(
    canonicalizeNewsUrl("https://Example.COM/Path/CapsTitle?Query=Yes"),
    "https://example.com/Path/CapsTitle?Query=Yes",
  );
});

test("canonicalizeNewsUrl drops a trailing slash from the path (but not from a bare-host URL)", () => {
  assert.equal(canonicalizeNewsUrl("https://example.com/article/123/"), "https://example.com/article/123");
  // Bare-host URL stays "/" because dropping it changes semantics (root vs no-path).
  assert.equal(canonicalizeNewsUrl("https://example.com/"), "https://example.com/");
});

test("canonicalizeNewsUrl preserves the fragment (#) — anchors sometimes identify article versions", () => {
  // Per the bake-in decision: fragments aren't stripped because some
  // publishers use them to disambiguate article variants (#comments,
  // #v2, etc.).
  assert.equal(
    canonicalizeNewsUrl("https://example.com/article#section-2"),
    "https://example.com/article#section-2",
  );
});

test("canonicalizeNewsUrl is idempotent (canonicalize twice == canonicalize once)", () => {
  const raw = "https://Example.com/x/?utm_source=a&keep=1";
  const once = canonicalizeNewsUrl(raw);
  const twice = canonicalizeNewsUrl(once);
  assert.equal(once, twice);
});

test("canonicalizeNewsUrl rejects non-http(s) schemes (no javascript:, file:, data:)", () => {
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,foo", "ftp://x.com"]) {
    assert.throws(() => canonicalizeNewsUrl(bad), /scheme must be http\(s\)/i);
  }
});

test("canonicalizeNewsUrl rejects malformed URLs before returning", () => {
  assert.throws(() => canonicalizeNewsUrl("not a url"), /invalid/i);
  assert.throws(() => canonicalizeNewsUrl(""), /invalid/i);
});

// ---- ingestPressRelease ----------------------------------------------------

test("ingestPressRelease writes a source (kind=press_release) and a document with the canonicalized URL", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();
  const bytes = new TextEncoder().encode("<html>Apple announces Q1 results</html>");

  const result = await ingestPressRelease(
    { db, objectStore },
    {
      bytes,
      provider: "businesswire",
      // Note the tracking params — orchestrator must strip them before persisting.
      canonicalUrl: "https://www.businesswire.com/news/home/123?utm_source=newsletter&fbclid=abc",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
      providerDocId: "BW-123",
    },
  );

  assert.equal(result.source.kind, "press_release");
  assert.equal(result.source.provider, "businesswire");
  assert.equal(result.source.trust_tier, "secondary"); // non-issuer aggregator → secondary
  assert.equal(result.source.license_class, "public");
  assert.equal(
    result.source.canonical_url,
    "https://www.businesswire.com/news/home/123",
    "canonical_url must be canonicalized before persisting",
  );
  assert.equal(result.ingest.document.kind, "press_release");
  assert.equal(result.ingest.document.title, "Apple, Inc.");
  assert.equal(result.ingest.document.provider_doc_id, "BW-123");
  assert.equal(result.ingest.status, "blob_stored");
  assert.equal(objectStore.putCalls, 1);

  // Insert SQL parameter ordering sanity:
  assert.equal(queries[0]?.values?.[2], "https://www.businesswire.com/news/home/123");
});

test("ingestPressRelease sets trust_tier=primary when the provider starts with issuer_ or ir_ (issuer's own newsroom)", async () => {
  // Issuer's own press release is a primary source; an aggregator's
  // copy of the same release is secondary. The orchestrator's default
  // is provider-string-driven; callers can override but the default
  // is what surfaces in tests.
  const { db } = recordingDb();
  const result = await ingestPressRelease(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("<html>release</html>"),
      provider: "issuer_ir",
      canonicalUrl: "https://investor.apple.com/press/2026-05-03",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
    },
  );

  assert.equal(result.source.trust_tier, "primary");
});

test("ingestPressRelease honors caller-supplied trust_tier override (within the allowed set)", async () => {
  const { db } = recordingDb();
  const result = await ingestPressRelease(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("<html>release</html>"),
      provider: "businesswire",
      canonicalUrl: "https://www.businesswire.com/x",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
      trustTier: "primary", // override: caller knows this aggregator IS the issuer's official wire
    },
  );

  assert.equal(result.source.trust_tier, "primary");
});

test("ingestPressRelease rejects trust_tier='user' (uploads aren't press releases)", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestPressRelease(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("<html>x</html>"),
        provider: "businesswire",
        canonicalUrl: "https://www.businesswire.com/x",
        publisher: "Apple, Inc.",
        publishedAt: "2026-05-03T13:30:00Z",
        trustTier: "user" as never,
      },
    ),
    /trust_tier.*one of/,
  );

  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("ingestPressRelease rejects empty bytes and missing publisher before any side-effects", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestPressRelease(
      { db, objectStore },
      {
        bytes: new Uint8Array(0),
        provider: "businesswire",
        canonicalUrl: "https://www.businesswire.com/x",
        publisher: "Apple, Inc.",
        publishedAt: "2026-05-03T13:30:00Z",
      },
    ),
    /bytes: must be non-empty/,
  );
  await assert.rejects(
    ingestPressRelease(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("x"),
        provider: "businesswire",
        canonicalUrl: "https://www.businesswire.com/x",
        publisher: "",
        publishedAt: "2026-05-03T13:30:00Z",
      },
    ),
    /publisher: must be a non-empty string/,
  );

  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

// ---- ingestEarningsTranscript ----------------------------------------------

test("ingestEarningsTranscript writes a transcript source/document with the fiscal period in the title", async () => {
  // The transcript title must encode the fiscal_period so a downstream
  // reader (or human) can disambiguate AAPL Q1 2026 from AAPL Q1 2025
  // without a database join.
  const { db } = recordingDb();
  const result = await ingestEarningsTranscript(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("<html>transcript body</html>"),
      provider: "seeking_alpha",
      canonicalUrl: "https://seekingalpha.com/article/aapl-q1-2026?utm_source=feed",
      publisher: "Seeking Alpha",
      publishedAt: "2026-05-03T13:30:00Z",
      fiscalPeriod: "2026Q1",
      issuer: "Apple, Inc.",
    },
  );

  assert.equal(result.source.kind, "transcript");
  assert.equal(result.source.trust_tier, "secondary");
  assert.equal(result.source.license_class, "licensed");
  assert.equal(
    result.source.canonical_url,
    "https://seekingalpha.com/article/aapl-q1-2026",
  );
  assert.equal(result.ingest.document.kind, "transcript");
  assert.match(result.ingest.document.title ?? "", /Apple, Inc.*2026Q1/);
});

test("ingestEarningsTranscript requires a non-empty fiscalPeriod", async () => {
  // Without a fiscal_period the transcript can't be deduped or routed.
  // Fail-closed at the API boundary.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestEarningsTranscript(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("transcript"),
        provider: "seeking_alpha",
        canonicalUrl: "https://example.com/x",
        publisher: "Seeking Alpha",
        publishedAt: "2026-05-03T13:30:00Z",
        fiscalPeriod: "",
        issuer: "Apple, Inc.",
      },
    ),
    /fiscal_period: must be a non-empty string/,
  );

  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("ingestEarningsTranscript license_class='public' is allowed (issuer's own posted transcript)", async () => {
  // Some issuers post transcripts on their IR site themselves. The
  // license is then 'public' rather than 'licensed' — the orchestrator
  // accepts both rather than hard-pinning 'licensed'.
  const { db } = recordingDb();
  const result = await ingestEarningsTranscript(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("transcript"),
      provider: "issuer_ir",
      canonicalUrl: "https://investor.apple.com/transcripts/q1-2026",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
      fiscalPeriod: "2026Q1",
      issuer: "Apple, Inc.",
      licenseClass: "public",
    },
  );

  assert.equal(result.source.license_class, "public");
});

// ---- ingestNewsArticle -----------------------------------------------------

test("ingestNewsArticle writes a tertiary-trust article source/document with author and published_at", async () => {
  const { db } = recordingDb();
  const result = await ingestNewsArticle(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("<html>article body</html>"),
      provider: "reuters",
      canonicalUrl: "https://www.reuters.com/markets/aapl-news?utm_campaign=feed&id=42",
      publisher: "Reuters",
      author: "Jane Reporter",
      publishedAt: "2026-05-03T13:30:00Z",
      title: "Apple beats Q1 estimates",
    },
  );

  assert.equal(result.source.kind, "article");
  assert.equal(result.source.trust_tier, "tertiary");
  assert.equal(result.source.license_class, "free");
  assert.equal(
    result.source.canonical_url,
    "https://www.reuters.com/markets/aapl-news?id=42",
  );
  assert.equal(result.ingest.document.kind, "article");
  assert.equal(result.ingest.document.author, "Jane Reporter");
  assert.equal(result.ingest.document.title, "Apple beats Q1 estimates");
});

test("ingestNewsArticle rejects trust_tier='primary' (news is never primary per spec § 5.2)", async () => {
  const { db, queries } = recordingDb();

  await assert.rejects(
    ingestNewsArticle(
      { db, objectStore: new RecordingObjectStore() },
      {
        bytes: new TextEncoder().encode("x"),
        provider: "reuters",
        canonicalUrl: "https://www.reuters.com/x",
        publisher: "Reuters",
        publishedAt: "2026-05-03T13:30:00Z",
        title: "x",
        trustTier: "primary" as never,
      },
    ),
    /trust_tier.*one of/,
  );

  assert.equal(queries.length, 0);
});

test("ingestNewsArticle accepts license_class='licensed' for paywalled outlets (Bloomberg, FT, etc.)", async () => {
  const { db } = recordingDb();
  const result = await ingestNewsArticle(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("article"),
      provider: "bloomberg",
      canonicalUrl: "https://www.bloomberg.com/news/aapl",
      publisher: "Bloomberg",
      author: "Reporter",
      publishedAt: "2026-05-03T13:30:00Z",
      title: "x",
      licenseClass: "licensed",
    },
  );

  assert.equal(result.source.license_class, "licensed");
});

test("ingestNewsArticle accepts license_class='ephemeral' (paywalled scrape) and routes through ephemeral storage", async () => {
  // A scraped paywalled article that we MUST NOT store the bytes of —
  // the document row + sentinel raw_blob_id only. Routes through the
  // fra-0sa ephemeral path.
  const { db } = recordingDb();
  const result = await ingestNewsArticle(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("article"),
      provider: "wsj",
      canonicalUrl: "https://www.wsj.com/articles/x",
      publisher: "WSJ",
      author: "Reporter",
      publishedAt: "2026-05-03T13:30:00Z",
      title: "x",
      licenseClass: "ephemeral",
    },
  );

  assert.equal(result.ingest.status, "ephemeral");
  assert.match(result.ingest.raw_blob_id, /^ephemeral:/);
});

// ---- exported allowed-trust-tier sets --------------------------------------

test("exported allowed-trust-tier sets match the spec § 5.2 mapping (frozen and disjoint enough)", () => {
  // Pin the constants the orchestrators branch on so a future edit must
  // explicitly justify changing the spec mapping.
  assert.deepEqual([...PRESS_RELEASE_ALLOWED_TRUST_TIERS], ["primary", "secondary"]);
  assert.deepEqual([...TRANSCRIPT_ALLOWED_TRUST_TIERS], ["secondary", "tertiary"]);
  assert.deepEqual([...NEWS_ARTICLE_ALLOWED_TRUST_TIERS], ["secondary", "tertiary"]);
  assert.equal(Object.isFrozen(PRESS_RELEASE_ALLOWED_TRUST_TIERS), true);
  assert.equal(Object.isFrozen(TRANSCRIPT_ALLOWED_TRUST_TIERS), true);
  assert.equal(Object.isFrozen(NEWS_ARTICLE_ALLOWED_TRUST_TIERS), true);
});

// ---- exported allowed-license-class sets -----------------------------------

test("exported allowed-license-class sets pin spec § 5.2 license classes per kind (frozen)", () => {
  // Why these contents:
  //   - press_release: 'public' is the canonical case; 'free' covers
  //     aggregators that don't gate the wire content.
  //   - transcript: 'licensed' (Seeking Alpha etc.) is the default;
  //     'public' covers issuer-posted transcripts; 'ephemeral' covers
  //     paywalled scrapes we cannot store.
  //   - article: 'free' is the default; 'licensed' for paywalled outlets;
  //     'ephemeral' for paywalled scrapes.
  // Anything outside these is a spec violation routed through the API
  // boundary rather than the storage policy layer.
  assert.deepEqual([...PRESS_RELEASE_ALLOWED_LICENSE_CLASSES], ["public", "free"]);
  assert.deepEqual(
    [...TRANSCRIPT_ALLOWED_LICENSE_CLASSES],
    ["licensed", "public", "ephemeral"],
  );
  assert.deepEqual(
    [...NEWS_ARTICLE_ALLOWED_LICENSE_CLASSES],
    ["free", "licensed", "ephemeral"],
  );
  assert.equal(Object.isFrozen(PRESS_RELEASE_ALLOWED_LICENSE_CLASSES), true);
  assert.equal(Object.isFrozen(TRANSCRIPT_ALLOWED_LICENSE_CLASSES), true);
  assert.equal(Object.isFrozen(NEWS_ARTICLE_ALLOWED_LICENSE_CLASSES), true);
});

// ---- license-class allow-list enforcement (review Important #2/#5) ---------

test("ingestPressRelease rejects license_class outside the press-release allow-list before any side-effects", async () => {
  // 'licensed' and 'user_private' would silently route a press release
  // into the wrong storage policy if accepted. Fail at the API boundary.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  for (const bad of ["licensed", "user_private", "ephemeral", "made_up"]) {
    await assert.rejects(
      ingestPressRelease(
        { db, objectStore },
        {
          bytes: new TextEncoder().encode("x"),
          provider: "businesswire",
          canonicalUrl: "https://www.businesswire.com/x",
          publisher: "Apple, Inc.",
          publishedAt: "2026-05-03T13:30:00Z",
          licenseClass: bad,
        },
      ),
      /license_class.*one of/,
      `license_class="${bad}" must be rejected for press_release`,
    );
  }
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("ingestEarningsTranscript rejects license_class outside the transcript allow-list before any side-effects", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  for (const bad of ["free", "user_private", "made_up"]) {
    await assert.rejects(
      ingestEarningsTranscript(
        { db, objectStore },
        {
          bytes: new TextEncoder().encode("x"),
          provider: "seeking_alpha",
          canonicalUrl: "https://seekingalpha.com/x",
          publisher: "Seeking Alpha",
          publishedAt: "2026-05-03T13:30:00Z",
          fiscalPeriod: "2026Q1",
          issuer: "Apple, Inc.",
          licenseClass: bad,
        },
      ),
      /license_class.*one of/,
      `license_class="${bad}" must be rejected for transcript`,
    );
  }
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("ingestNewsArticle rejects license_class outside the article allow-list before any side-effects", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  for (const bad of ["public", "user_private", "made_up"]) {
    await assert.rejects(
      ingestNewsArticle(
        { db, objectStore },
        {
          bytes: new TextEncoder().encode("x"),
          provider: "reuters",
          canonicalUrl: "https://www.reuters.com/x",
          publisher: "Reuters",
          publishedAt: "2026-05-03T13:30:00Z",
          title: "x",
          licenseClass: bad,
        },
      ),
      /license_class.*one of/,
      `license_class="${bad}" must be rejected for article`,
    );
  }
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

// ---- transcript license_class issuer heuristic (review Important #1) -------

test("ingestEarningsTranscript defaults license_class='public' for issuer_/ir_ providers (issuer's own posted transcript)", async () => {
  // Mirrors the press-release trust_tier issuer heuristic. An issuer
  // posting their own transcript on their IR site is 'public', not
  // 'licensed' — defaulting to 'licensed' would route it through the
  // wrong storage policy bucket downstream.
  const { db } = recordingDb();
  const result = await ingestEarningsTranscript(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("transcript"),
      provider: "issuer_ir",
      canonicalUrl: "https://investor.apple.com/transcripts/q1-2026",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
      fiscalPeriod: "2026Q1",
      issuer: "Apple, Inc.",
    },
  );

  assert.equal(result.source.license_class, "public");
});

test("ingestEarningsTranscript defaults license_class='licensed' for non-issuer providers (default-licensed wire)", async () => {
  // Counter-test: the issuer heuristic must not over-fire. A
  // seeking_alpha transcript stays 'licensed' by default.
  const { db } = recordingDb();
  const result = await ingestEarningsTranscript(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("transcript"),
      provider: "seeking_alpha",
      canonicalUrl: "https://seekingalpha.com/x",
      publisher: "Seeking Alpha",
      publishedAt: "2026-05-03T13:30:00Z",
      fiscalPeriod: "2026Q1",
      issuer: "Apple, Inc.",
    },
  );

  assert.equal(result.source.license_class, "licensed");
});

// ---- canonicalUrl boundary check (review Important #3) ---------------------

test("ingestPressRelease rejects empty/missing canonicalUrl before any side-effects", async () => {
  // canonicalizeNewsUrl throws on empty/non-URL input, but the throw
  // happens after createSource fires off if validation is stitched in
  // the wrong order. Pin both that empty rejects AND that no SQL ran.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestPressRelease(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("x"),
        provider: "businesswire",
        canonicalUrl: "",
        publisher: "Apple, Inc.",
        publishedAt: "2026-05-03T13:30:00Z",
      },
    ),
    /canonical_url: must be a non-empty string/,
  );
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("ingestEarningsTranscript rejects empty canonicalUrl before any side-effects", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestEarningsTranscript(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("x"),
        provider: "seeking_alpha",
        canonicalUrl: "",
        publisher: "Seeking Alpha",
        publishedAt: "2026-05-03T13:30:00Z",
        fiscalPeriod: "2026Q1",
        issuer: "Apple, Inc.",
      },
    ),
    /canonical_url: must be a non-empty string/,
  );
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("ingestNewsArticle rejects empty canonicalUrl before any side-effects", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestNewsArticle(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("x"),
        provider: "reuters",
        canonicalUrl: "",
        publisher: "Reuters",
        publishedAt: "2026-05-03T13:30:00Z",
        title: "x",
      },
    ),
    /canonical_url: must be a non-empty string/,
  );
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

// ---- optional-string boundary checks (review Important #4) -----------------

test("ingestPressRelease rejects empty/whitespace providerDocId before any side-effects", async () => {
  // Optional strings, when supplied, must be non-empty — empty defeats
  // the (provider, provider_doc_id) provenance lookup later.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestPressRelease(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("x"),
        provider: "businesswire",
        canonicalUrl: "https://www.businesswire.com/x",
        publisher: "Apple, Inc.",
        publishedAt: "2026-05-03T13:30:00Z",
        providerDocId: "   ",
      },
    ),
    /provider_doc_id: must be a non-empty string/,
  );
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("ingestNewsArticle rejects empty/whitespace author before any side-effects", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestNewsArticle(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("x"),
        provider: "reuters",
        canonicalUrl: "https://www.reuters.com/x",
        publisher: "Reuters",
        publishedAt: "2026-05-03T13:30:00Z",
        title: "x",
        author: "  ",
      },
    ),
    /author: must be a non-empty string/,
  );
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

// ---- press release author symmetry (review Minor #7) -----------------------

test("ingestPressRelease stamps document.author=publisher (mirrors transcript orchestrator's author handling)", async () => {
  // Press releases attribute to the issuing organisation, not a person.
  // The transcript orchestrator already stamps author=publisher; doing
  // the same here keeps the documents.author column populated for press
  // releases instead of leaving it null and forcing downstream readers
  // to fall back to source.publisher (which doesn't exist as a column).
  const { db } = recordingDb();
  const result = await ingestPressRelease(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("<html>release</html>"),
      provider: "businesswire",
      canonicalUrl: "https://www.businesswire.com/x",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
    },
  );

  assert.equal(result.ingest.document.author, "Apple, Inc.");
});

test("ingestPressRelease emits the sha256 content_hash actually derived from the bytes (dedupe key invariant)", async () => {
  // Replaces a previously-tautological test that only checked
  // crypto.createHash output. The behavioral assertion is: the value
  // flowing into documents.content_hash equals sha256(bytes). If a
  // future refactor swaps hashing algorithms here, dedupe (which keys
  // on content_hash) silently breaks — this catches it.
  const { db, queries } = recordingDb();
  const bytes = new TextEncoder().encode("press release body for hash check");
  const expected = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

  const result = await ingestPressRelease(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes,
      provider: "businesswire",
      canonicalUrl: "https://www.businesswire.com/news/x",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
    },
  );

  assert.equal(result.ingest.document.content_hash, expected);
  const documentsInsert = queries.find((query) => /insert into documents/i.test(query.text));
  assert.equal(documentsInsert?.values?.[9], expected);
});

test("ingestPressRelease normalizes retrievedAt before writing the source row", async () => {
  const { db, queries } = recordingDb();

  await ingestPressRelease(
    { db, objectStore: new RecordingObjectStore() },
    {
      bytes: new TextEncoder().encode("release"),
      provider: "businesswire",
      canonicalUrl: "https://www.businesswire.com/news/x",
      publisher: "Apple, Inc.",
      publishedAt: "2026-05-03T13:30:00Z",
      retrievedAt: "2026-05-03T21:30:00+08:00",
    },
  );

  assert.equal(queries[0]?.values?.[5], "2026-05-03T13:30:00.000Z");
});

test("ingestNewsArticle deletes the created source when document ingest fails", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/insert into sources/.test(text)) {
        return {
          rows: [
            {
              source_id: SOURCE_ID,
              provider: values?.[0],
              kind: values?.[1],
              canonical_url: values?.[2],
              trust_tier: values?.[3],
              license_class: values?.[4],
              retrieved_at: new Date(values?.[5] as string),
              content_hash: values?.[6],
              user_id: values?.[7],
              created_at: new Date("2026-05-03T00:00:00.000Z"),
            },
          ] as R[],
          command: "INSERT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      if (/delete from sources/.test(text)) {
        return {
          rows: [] as R[],
          command: "DELETE",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
      throw new Error("documents insert failed");
    },
  };
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestNewsArticle(
      { db, objectStore },
      {
        bytes: new TextEncoder().encode("article"),
        provider: "reuters",
        canonicalUrl: "https://www.reuters.com/x",
        publisher: "Reuters",
        publishedAt: "2026-05-03T13:30:00Z",
        title: "x",
      },
    ),
    /documents insert failed/,
  );

  assert.match(queries[0]?.text ?? "", /insert into sources/);
  assert.match(queries[2]?.text ?? "", /delete from sources/);
  assert.deepEqual(queries[2]?.values, [SOURCE_ID]);
});
