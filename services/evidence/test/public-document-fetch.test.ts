import assert from "node:assert/strict";
import test from "node:test";

import { PublicDocumentFetchError, createPinnedHttpsFetch, createPublicDocumentFetcher, isPublicAddress } from "../src/public-document-fetch.ts";

test("public document fetcher pins a verified public address while preserving the TLS hostname", async () => {
  const requests: Array<{ hostname: string; servername: string; host: string }> = [];
  const fetcher = createPublicDocumentFetcher({
    dns: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
    transport: {
      request: async (request) => {
        requests.push({ hostname: request.hostname, servername: request.servername, host: request.headers.host });
        return { status: 200, headers: { "content-type": "text/html" }, body: new TextEncoder().encode("<p>primary evidence</p>") };
      },
    },
  });

  const result = await fetcher.fetch("https://issuer.example/investors/results");

  assert.equal(requests[0]?.hostname, "93.184.216.34");
  assert.equal(requests[0]?.servername, "issuer.example");
  assert.equal(requests[0]?.host, "issuer.example");
  assert.equal(new TextDecoder().decode(result.bytes), "<p>primary evidence</p>");
});

test("public document fetcher rejects private destinations before transport", async () => {
  let called = false;
  const fetcher = createPublicDocumentFetcher({
    dns: { lookup: async () => [{ address: "127.0.0.1", family: 4 }] },
    transport: { request: async () => { called = true; throw new Error("unexpected"); } },
  });

  await assert.rejects(
    fetcher.fetch("https://issuer.example/investors/results"),
    (error: unknown) => error instanceof PublicDocumentFetchError && error.code === "blocked_destination",
  );
  assert.equal(called, false);
});

test("public document fetcher rejects credential-bearing URLs before DNS or transport", async () => {
  let lookedUp = false;
  const fetcher = createPublicDocumentFetcher({
    dns: { lookup: async () => { lookedUp = true; return [{ address: "93.184.216.34", family: 4 }]; } },
    transport: { request: async () => { throw new Error("unexpected"); } },
  });

  await assert.rejects(
    fetcher.fetch("https://user:password@issuer.example/investors/results"),
    (error: unknown) => error instanceof PublicDocumentFetchError && error.code === "invalid_url",
  );
  assert.equal(lookedUp, false);
});

test("public address validation rejects expanded IPv6 loopback", () => {
  assert.equal(isPublicAddress("0:0:0:0:0:0:0:1"), false);
});

test("public document fetcher revalidates each redirect and rejects an unsafe rebinding", async () => {
  const lookedUp: string[] = [];
  const fetcher = createPublicDocumentFetcher({
    dns: {
      lookup: async (hostname) => {
        lookedUp.push(hostname);
        return hostname === "issuer.example"
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "::ffff:127.0.0.1", family: 6 }];
      },
    },
    transport: {
      request: async () => ({ status: 302, headers: { location: "https://redirect.example/next" }, body: new Uint8Array() }),
    },
  });

  await assert.rejects(
    fetcher.fetch("https://issuer.example/investors/results"),
    (error: unknown) => error instanceof PublicDocumentFetchError && error.code === "blocked_destination",
  );
  assert.deepEqual(lookedUp, ["issuer.example", "redirect.example"]);
});

test("public document fetcher never permits more than the campaign redirect cap", async () => {
  let calls = 0;
  const fetcher = createPublicDocumentFetcher({
    max_redirects: 100,
    dns: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
    transport: { request: async () => {
      calls += 1;
      return { status: 302, headers: { location: `https://issuer.example/next/${calls}` }, body: new Uint8Array() };
    } },
  });

  await assert.rejects(
    fetcher.fetch("https://issuer.example/investors/results"),
    (error: unknown) => error instanceof PublicDocumentFetchError && error.code === "redirect_limit",
  );
  assert.equal(calls, 4);
});

test("public document fetcher rejects unsupported PDFs without exposing bytes", async () => {
  const fetcher = createPublicDocumentFetcher({
    dns: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
    transport: {
      request: async () => ({ status: 200, headers: { "content-type": "application/pdf" }, body: new Uint8Array([37, 80, 68, 70]) }),
    },
  });

  await assert.rejects(
    fetcher.fetch("https://issuer.example/investors/presentation.pdf"),
    (error: unknown) => error instanceof PublicDocumentFetchError && error.code === "unsupported_content",
  );
});

test("pinned HTTPS fetch permits bounded SEC JSON metadata through the existing SEC client seam", async () => {
  const fetch = createPinnedHttpsFetch({
    dns: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
    transport: {
      request: async () => ({ status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"filings":{}}') }),
    },
  });

  const response = await fetch("https://data.sec.gov/submissions/CIK0000000001.json", {
    headers: { "User-Agent": "Market-Agent/0.1 (ops@example.com)" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { filings: {} });
});
