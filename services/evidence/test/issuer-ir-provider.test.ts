import test from "node:test";
import assert from "node:assert/strict";

import {
  discoverIssuerIrCandidates,
  classifyIssuerIrAssetKind,
  hostedProviderFromUrl,
} from "../src/providers/issuer-ir.ts";
import type { IrSourceRegistryRow } from "../src/issuer-ir-registry.ts";

const ISSUER_ID = "33333333-3333-4333-a333-333333333333";
const SOURCE_ID = "44444444-4444-4444-a444-444444444444";

function registry(overrides: Partial<IrSourceRegistryRow> = {}): IrSourceRegistryRow {
  return Object.freeze({
    ir_source_id: SOURCE_ID,
    issuer_id: ISSUER_ID,
    source_type: "rss",
    url: "https://investors.acme.example/news/rss",
    provider_hint: "issuer_ir",
    document_kind: null,
    enabled: true,
    last_crawled_at: null,
    last_success_at: null,
    last_error: null,
    etag: null,
    last_modified: null,
    crawl_interval_seconds: 86_400,
    created_at: "2026-05-30T00:00:00.000Z",
    updated_at: "2026-05-30T00:00:00.000Z",
    ...overrides,
  });
}

test("classifyIssuerIrAssetKind distinguishes releases, transcripts, and presentation decks", () => {
  assert.equal(
    classifyIssuerIrAssetKind({
      url: "https://investors.acme.example/news/q1-earnings-release",
      title: "Acme reports first quarter results",
      contentType: "text/html",
    }),
    "press_release",
  );
  assert.equal(
    classifyIssuerIrAssetKind({
      url: "https://investors.acme.example/events/q1-2026-transcript",
      title: "Q1 2026 earnings call transcript",
      contentType: "text/html",
    }),
    "transcript",
  );
  assert.equal(
    classifyIssuerIrAssetKind({
      url: "https://investors.acme.example/events/q1-2026-transcript.pdf",
      title: "Q1 2026 earnings call transcript",
      contentType: "application/pdf",
    }),
    "transcript",
  );
  assert.equal(
    classifyIssuerIrAssetKind({
      url: "https://s201.q4cdn.com/123/files/doc_presentations/2026/acme-investor-day.pdf",
      title: "Investor Day presentation",
      contentType: "application/pdf",
    }),
    "presentation",
  );
});

test("hostedProviderFromUrl identifies common IR hosting and wire providers", () => {
  assert.equal(hostedProviderFromUrl("https://s201.q4cdn.com/123/files/doc.pdf"), "q4cdn");
  assert.equal(hostedProviderFromUrl("https://www.businesswire.com/news/home/2026053001"), "business_wire");
  assert.equal(hostedProviderFromUrl("https://acme.gcs-web.com/news-releases/news-release-details/x"), "notified");
  assert.equal(hostedProviderFromUrl("https://investors.acme.example/news/x"), "issuer_ir");
});

test("discoverIssuerIrCandidates parses RSS items and applies issuer-safe URL classification", async () => {
  const feed = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>Acme reports Q1 results and raises guidance</title>
        <link>https://investors.acme.example/news/q1-results?utm_source=email</link>
        <pubDate>Fri, 29 May 2026 12:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Acme investor day presentation</title>
        <link>https://s201.q4cdn.com/123/files/doc_presentations/acme-investor-day.pdf</link>
        <pubDate>Fri, 29 May 2026 13:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Unsafe mirror</title>
        <link>javascript:alert(1)</link>
      </item>
    </channel></rss>`;
  const fetches: string[] = [];

  const candidates = await discoverIssuerIrCandidates(registry(), {
    fetch: async (url) => {
      fetches.push(url);
      return new Response(feed, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    },
    now: () => 1_780_000_000_000,
  });

  assert.deepEqual(fetches, ["https://investors.acme.example/news/rss"]);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.assetKind, "press_release");
  assert.equal(candidates[0]?.canonicalUrl, "https://investors.acme.example/news/q1-results");
  assert.equal(candidates[0]?.publishedAt, "2026-05-29T12:00:00.000Z");
  assert.equal(candidates[1]?.assetKind, "presentation");
  assert.equal(candidates[1]?.hostedProvider, "q4cdn");
});

test("discoverIssuerIrCandidates treats unchanged conditional feeds as an empty result", async () => {
  const headers: Array<Record<string, string> | undefined> = [];

  const candidates = await discoverIssuerIrCandidates(registry({
    etag: "\"feed-v1\"",
    last_modified: "Fri, 29 May 2026 12:00:00 GMT",
  }), {
    fetch: async (_url, init) => {
      headers.push(init?.headers);
      return new Response(null, { status: 304 });
    },
  });

  assert.deepEqual(candidates, []);
  assert.equal(headers[0]?.["If-None-Match"], "\"feed-v1\"");
  assert.equal(headers[0]?.["If-Modified-Since"], "Fri, 29 May 2026 12:00:00 GMT");
});

test("discoverIssuerIrCandidates parses sitemap and html index sources without recursive crawling", async () => {
  const sitemap = `<?xml version="1.0"?>
    <urlset>
      <url><loc>https://investors.acme.example/news/q1-results</loc><lastmod>2026-05-29</lastmod></url>
      <url><loc>https://investors.acme.example/events/q1-2026-transcript</loc><lastmod>2026-05-30</lastmod></url>
    </urlset>`;
  const html = `<html><body>
    <a href="/files/acme-investor-day.pdf">Investor Day presentation</a>
    <a href="https://example.org/unrelated">Unrelated</a>
  </body></html>`;
  const responses = new Map([
    ["https://investors.acme.example/sitemap.xml", sitemap],
    ["https://investors.acme.example/events", html],
  ]);

  const fetched: string[] = [];
  const fetch = async (url: string) => {
    fetched.push(url);
    return new Response(responses.get(url) ?? "", { status: 200, headers: { "content-type": "text/html" } });
  };

  const fromSitemap = await discoverIssuerIrCandidates(registry({
    source_type: "sitemap",
    url: "https://investors.acme.example/sitemap.xml",
  }), { fetch });
  const fromHtml = await discoverIssuerIrCandidates(registry({
    source_type: "html_index",
    url: "https://investors.acme.example/events",
  }), { fetch });

  assert.deepEqual(fetched, [
    "https://investors.acme.example/sitemap.xml",
    "https://investors.acme.example/events",
  ]);
  assert.deepEqual(fromSitemap.map((candidate) => candidate.assetKind), ["press_release", "transcript"]);
  assert.equal(fromHtml.length, 1);
  assert.equal(fromHtml[0]?.canonicalUrl, "https://investors.acme.example/files/acme-investor-day.pdf");
  assert.equal(fromHtml[0]?.assetKind, "presentation");
});
