import test from "node:test";
import assert from "node:assert/strict";

import {
  GDELT_ARTICLE_DISCOVERY_SORTS,
  GdeltDocClient,
  GdeltDocFetchError,
  GdeltDocPayloadError,
  GdeltDocRateLimitError,
} from "../src/providers/gdelt.ts";

function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_ARTICLE = Object.freeze({
  url: "https://Example.com/markets/aapl-suppliers?utm_source=feed&id=42",
  title: "Apple supplier shares rise after guidance update",
  seendate: "20260529123000",
  domain: "example.com",
  language: "English",
  sourcecountry: "United States",
  socialimage: "https://example.com/image.jpg",
  snippet: "Apple suppliers rallied after updated guidance.",
  fulltext: "THIS FULL BODY MUST NEVER BE COPIED INTO PROVIDER METADATA",
});

test("GdeltDocClient.searchArticles builds an ArtList JSON request with date, language, domain, sort, and max-record filters", async () => {
  let requestedUrl = "";
  const client = new GdeltDocClient({
    now: () => Date.parse("2026-05-30T01:00:00Z"),
    fetch: async (url) => {
      requestedUrl = url;
      return jsonResponse({ articles: [SAMPLE_ARTICLE] });
    },
  });

  const result = await client.searchArticles({
    query: "Apple",
    startDateTime: "2026-05-29T00:00:00Z",
    endDateTime: "2026-05-30T00:00:00Z",
    maxRecords: 25,
    sort: "datedesc",
    searchLanguage: "english",
    domains: ["Reuters.com", "apnews.com"],
  });

  const url = new URL(requestedUrl);
  assert.equal(url.origin + url.pathname, "https://api.gdeltproject.org/api/v2/doc/doc");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.get("mode"), "artlist");
  assert.equal(url.searchParams.get("maxrecords"), "25");
  assert.equal(url.searchParams.get("sort"), "datedesc");
  assert.equal(url.searchParams.get("searchlang"), "english");
  assert.equal(url.searchParams.get("startdatetime"), "20260529000000");
  assert.equal(url.searchParams.get("enddatetime"), "20260530000000");
  assert.equal(url.searchParams.get("query"), "Apple (domain:reuters.com OR domain:apnews.com)");
  assert.equal(result.retrievedAt, "2026-05-30T01:00:00.000Z");
  assert.equal(result.articles.length, 1);
});

test("GdeltDocClient.searchArticles normalizes metadata-only articles and dedupes by canonical URL", async () => {
  const client = new GdeltDocClient({
    fetch: async () =>
      jsonResponse({
        articles: [
          SAMPLE_ARTICLE,
          {
            ...SAMPLE_ARTICLE,
            url: "https://example.com/markets/aapl-suppliers?id=42&utm_medium=email",
            title: "Duplicate URL should be discarded",
          },
        ],
      }),
  });

  const result = await client.searchArticles({
    query: "Apple",
    timespan: "1d",
    maxRecords: 10,
  });

  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.articles[0], {
    url: "https://example.com/markets/aapl-suppliers?id=42",
    title: "Apple supplier shares rise after guidance update",
    seenAt: "2026-05-29T12:30:00.000Z",
    domain: "example.com",
    language: "English",
    sourceCountry: "United States",
    snippet: "Apple suppliers rallied after updated guidance.",
    imageUrl: "https://example.com/image.jpg",
    dedupeKey: "https://example.com/markets/aapl-suppliers?id=42",
    providerMetadataHash: result.articles[0].providerMetadataHash,
    providerMetadata: {
      url: SAMPLE_ARTICLE.url,
      seendate: SAMPLE_ARTICLE.seendate,
      domain: SAMPLE_ARTICLE.domain,
      language: SAMPLE_ARTICLE.language,
      sourcecountry: SAMPLE_ARTICLE.sourcecountry,
      socialimage: SAMPLE_ARTICLE.socialimage,
      snippet: SAMPLE_ARTICLE.snippet,
    },
  });
  assert.match(result.articles[0].providerMetadataHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result.articles[0].providerMetadata).includes("THIS FULL BODY"), false);
});

test("GdeltDocClient.searchArticles returns an empty list for an empty ArticleList response", async () => {
  const client = new GdeltDocClient({ fetch: async () => jsonResponse({ articles: [] }) });

  const result = await client.searchArticles({ query: "Apple", maxRecords: 1 });

  assert.deepEqual(result.articles, []);
});

test("GdeltDocClient.searchArticles validates request shape before fetching", async () => {
  let fetchCalls = 0;
  const client = new GdeltDocClient({
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ articles: [] });
    },
  });

  await assert.rejects(() => client.searchArticles({ query: "" }), /query/);
  await assert.rejects(() => client.searchArticles({ query: "Apple", maxRecords: 251 }), /maxRecords/);
  await assert.rejects(
    () =>
      client.searchArticles({
        query: "Apple",
        timespan: "1d",
        startDateTime: "2026-05-29T00:00:00Z",
      }),
    /timespan/,
  );
  await assert.rejects(
    () =>
      client.searchArticles({
        query: "Apple",
        startDateTime: "2026-05-30T00:00:00Z",
        endDateTime: "2026-05-29T00:00:00Z",
      }),
    /startDateTime/,
  );
  await assert.rejects(
    () => client.searchArticles({ query: "Apple", sort: "newest" as never }),
    /sort/,
  );

  assert.equal(fetchCalls, 0);
});

test("GdeltDocClient.searchArticles classifies rate-limit and provider failures", async () => {
  const rateLimited = new GdeltDocClient({ fetch: async () => jsonResponse({ error: "slow down" }, 429) });
  await assert.rejects(
    () => rateLimited.searchArticles({ query: "Apple" }),
    (err: unknown) => err instanceof GdeltDocRateLimitError && err.status === 429,
  );

  const failed = new GdeltDocClient({ fetch: async () => jsonResponse({ error: "bad gateway" }, 502) });
  await assert.rejects(
    () => failed.searchArticles({ query: "Apple" }),
    (err: unknown) => err instanceof GdeltDocFetchError && err.status === 502,
  );

  const networkFailure = new GdeltDocClient({
    fetch: async () => {
      throw new TypeError("network down");
    },
  });
  await assert.rejects(
    () => networkFailure.searchArticles({ query: "Apple" }),
    (err: unknown) =>
      err instanceof GdeltDocFetchError &&
      err.status === 0 &&
      /network down/.test(err.message),
  );
});

test("GdeltDocClient.searchArticles rejects malformed payloads deterministically", async () => {
  const invalidJson = new GdeltDocClient({
    fetch: async () =>
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    () => invalidJson.searchArticles({ query: "Apple" }),
    (err: unknown) => err instanceof GdeltDocPayloadError && /JSON/.test(err.message),
  );

  const missingArticles = new GdeltDocClient({ fetch: async () => jsonResponse({ not_articles: [] }) });
  await assert.rejects(
    () => missingArticles.searchArticles({ query: "Apple" }),
    (err: unknown) => err instanceof GdeltDocPayloadError && /articles/.test(err.message),
  );

  const malformedArticle = new GdeltDocClient({ fetch: async () => jsonResponse({ articles: [{ url: "not a url" }] }) });
  await assert.rejects(
    () => malformedArticle.searchArticles({ query: "Apple" }),
    (err: unknown) => err instanceof GdeltDocPayloadError && /article/.test(err.message),
  );

  const invalidSeenDate = new GdeltDocClient({
    fetch: async () =>
      jsonResponse({
        articles: [
          {
            url: "https://example.com/aapl",
            title: "Apple update",
            seendate: "20261399123000",
          },
        ],
      }),
  });
  await assert.rejects(
    () => invalidSeenDate.searchArticles({ query: "Apple" }),
    (err: unknown) => err instanceof GdeltDocPayloadError && /seendate/.test(err.message),
  );
});

test("GDELT sort contract is explicit and frozen", () => {
  assert.deepEqual(GDELT_ARTICLE_DISCOVERY_SORTS, ["relevance", "datedesc", "dateasc"]);
  assert.equal(Object.isFrozen(GDELT_ARTICLE_DISCOVERY_SORTS), true);
});
