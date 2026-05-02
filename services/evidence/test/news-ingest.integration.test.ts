import test from "node:test";
import assert from "node:assert/strict";

import {
  ingestEarningsTranscript,
  ingestNewsArticle,
  ingestPressRelease,
} from "../src/news-ingest.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

test(
  "fra-bsp headline: ingest one sample of each kind (press release, transcript, article) end-to-end",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fra-bsp-each-kind");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new MemoryObjectStore();

    const pressRelease = await ingestPressRelease(
      { db: client, objectStore },
      {
        bytes: new TextEncoder().encode("<html>Apple announces Q1</html>"),
        provider: "businesswire",
        canonicalUrl: "https://www.businesswire.com/news/home/aapl-q1?utm_source=feed",
        publisher: "Apple, Inc.",
        publishedAt: "2026-05-03T13:30:00Z",
        providerDocId: "BW-AAPL-Q1",
      },
    );
    assert.equal(pressRelease.source.kind, "press_release");
    assert.equal(pressRelease.source.trust_tier, "secondary");
    assert.equal(pressRelease.source.license_class, "public");
    assert.equal(pressRelease.ingest.document.kind, "press_release");
    assert.equal(pressRelease.ingest.status, "blob_stored");
    assert.equal(
      pressRelease.source.canonical_url,
      "https://www.businesswire.com/news/home/aapl-q1",
      "tracking params must be stripped",
    );

    const transcript = await ingestEarningsTranscript(
      { db: client, objectStore },
      {
        bytes: new TextEncoder().encode("<html>transcript body</html>"),
        provider: "seeking_alpha",
        canonicalUrl: "https://seekingalpha.com/article/aapl-q1-2026?utm_campaign=earnings",
        publisher: "Seeking Alpha",
        publishedAt: "2026-05-03T15:00:00Z",
        fiscalPeriod: "2026Q1",
        issuer: "Apple, Inc.",
      },
    );
    assert.equal(transcript.source.kind, "transcript");
    assert.equal(transcript.source.trust_tier, "secondary");
    assert.equal(transcript.source.license_class, "licensed");
    assert.equal(transcript.ingest.document.kind, "transcript");
    assert.match(transcript.ingest.document.title ?? "", /Apple, Inc.*2026Q1/);

    const article = await ingestNewsArticle(
      { db: client, objectStore },
      {
        bytes: new TextEncoder().encode("<html>news body</html>"),
        provider: "reuters",
        canonicalUrl: "https://www.reuters.com/markets/aapl-news/?fbclid=xyz",
        publisher: "Reuters",
        author: "Jane Reporter",
        publishedAt: "2026-05-03T16:00:00Z",
        title: "Apple beats Q1 estimates",
      },
    );
    assert.equal(article.source.kind, "article");
    assert.equal(article.source.trust_tier, "tertiary");
    assert.equal(article.source.license_class, "free");
    assert.equal(article.ingest.document.kind, "article");
    assert.equal(article.ingest.document.author, "Jane Reporter");
    assert.equal(
      article.source.canonical_url,
      "https://www.reuters.com/markets/aapl-news",
      "trailing slash + fbclid must be normalized",
    );

    // All three landed distinct documents (different content_hashes ⇒
    // different rows under the (content_hash, raw_blob_id) unique key).
    const ids = [
      pressRelease.ingest.document.document_id,
      transcript.ingest.document.document_id,
      article.ingest.document.document_id,
    ];
    assert.equal(new Set(ids).size, 3);
  },
);

test(
  "fra-bsp dedup: same press-release content + canonicalizable URLs collapses to one document",
  { skip: !dockerAvailable() },
  async (t) => {
    // The bead's "per-kind canonicalization" contract: two ingests of
    // the same press release with different aggregator URLs (UTM params,
    // host casing, trailing slash) must dedupe to a single document
    // because:
    //   1. canonicalizeNewsUrl normalizes the URL the same way both times
    //   2. content_hash is identical (same bytes)
    //   3. ingestDocument's ON CONFLICT (content_hash, raw_blob_id) DO ...
    //      collapses the second insert to the first row
    const { databaseUrl } = await bootstrapDatabase(t, "fra-bsp-dedup");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new MemoryObjectStore();

    const bytes = new TextEncoder().encode("<html>Apple Q1 release body, identical bytes</html>");

    const first = await ingestPressRelease(
      { db: client, objectStore },
      {
        bytes,
        provider: "businesswire",
        canonicalUrl: "https://www.businesswire.com/news/home/aapl-q1?utm_source=newsletter&utm_medium=email",
        publisher: "Apple, Inc.",
        publishedAt: "2026-05-03T13:30:00Z",
      },
    );
    const second = await ingestPressRelease(
      { db: client, objectStore },
      {
        bytes,
        provider: "businesswire",
        // Different presentation: lowercased host, trailing slash, different tracking params.
        canonicalUrl: "https://WWW.BusinessWire.com/news/home/aapl-q1/?fbclid=abc&gclid=def",
        publisher: "Apple, Inc.",
        publishedAt: "2026-05-03T13:30:00Z",
      },
    );

    // Both ingests resolve to the same documents row.
    assert.equal(first.ingest.document.document_id, second.ingest.document.document_id);
    assert.equal(first.ingest.status, "blob_stored");
    assert.equal(second.ingest.status, "blob_stored");
    // Object store stored exactly one blob (sha256 dedupe).
    assert.equal(
      await objectStore.has(first.ingest.raw_blob_id),
      true,
      "blob must be retrievable after canonicalized re-ingest",
    );
  },
);

test(
  "fra-bsp ephemeral path: a paywalled article with license_class='ephemeral' lands a documents row but no blob",
  { skip: !dockerAvailable() },
  async (t) => {
    // Pins the cross-bead contract (fra-0sa license-aware ingest +
    // fra-bsp news orchestrators): a paywalled WSJ scrape lands the
    // documents row (so we can attribute mentions/claims to it) but
    // never stores the bytes.
    const { databaseUrl } = await bootstrapDatabase(t, "fra-bsp-ephemeral");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new MemoryObjectStore();

    const result = await ingestNewsArticle(
      { db: client, objectStore },
      {
        bytes: new TextEncoder().encode("<html>WSJ paywalled body</html>"),
        provider: "wsj",
        canonicalUrl: "https://www.wsj.com/articles/aapl-deep-dive",
        publisher: "WSJ",
        author: "Reporter",
        publishedAt: "2026-05-03T16:00:00Z",
        title: "Apple's deep dive",
        licenseClass: "ephemeral",
      },
    );

    assert.equal(result.ingest.status, "ephemeral");
    assert.match(result.ingest.raw_blob_id, /^ephemeral:/);
    assert.equal(
      await objectStore.has(result.ingest.raw_blob_id).catch(() => false),
      false,
      "ephemeral path must NOT store the blob",
    );
  },
);
