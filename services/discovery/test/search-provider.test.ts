import assert from "node:assert/strict";
import test from "node:test";

import { createBraveSearchProvider, ProviderRequestError } from "../src/providers/search.ts";
import { fakeOperations } from "./fake-operations.ts";

const HASH = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("search returns bounded leads and cannot create primary evidence", async () => {
  const calls: URL[] = [];
  const provider = createBraveSearchProvider({
    apiKey: "test",
    fetch: async (url) => {
      calls.push(new URL(String(url)));
      return new Response(JSON.stringify({
        web: { results: [{ title: "Example", url: "https://example.test/story", description: "Transformer supplier" }] },
      }));
    },
    now: () => new Date("2026-09-10T01:02:03.000Z"),
  });
  const fake = fakeOperations();

  const result = await provider.search({
    query: "grid suppliers",
    query_index: 0,
    operation_key: "run-1/discovery/search/0",
    request_hash: HASH,
    phase: "discovery",
  }, fake);

  assert.equal(calls[0]?.origin, "https://api.search.brave.com");
  assert.equal(calls[0]?.pathname, "/res/v1/web/search");
  assert.deepEqual(Object.fromEntries(calls[0]!.searchParams), {
    q: "grid suppliers", count: "10", country: "US", search_lang: "en",
  });
  assert.equal(result.hits[0]?.url, "https://example.test/story");
  assert.equal(result.hits[0]?.retrieved_at, "2026-09-10T01:02:03.000Z");
  assert.equal("claim_id" in result.hits[0]!, false);
  assert.equal(result.hits_truncated, 0);
});

test("search rejects a missing Brave credential before reserving an attempt", async () => {
  const provider = createBraveSearchProvider({ apiKey: "", fetch: async () => new Response("unexpected") });
  const fake = fakeOperations();

  await assert.rejects(
    provider.search({
      query: "grid suppliers", query_index: 0, operation_key: "run-1/discovery/search/0",
      request_hash: HASH, phase: "discovery",
    }, fake.operations),
    (error: unknown) => error instanceof ProviderRequestError && error.code === "missing_configuration",
  );
  assert.equal(fake.ledger.size, 0);
});

test("search maps provider authorization and invalid lead data to typed failures without leaking credentials", async () => {
  const unauthorized = createBraveSearchProvider({
    apiKey: "secret-never-log",
    fetch: async () => new Response("denied", { status: 401 }),
  });
  const fake = fakeOperations();

  await assert.rejects(
    unauthorized.search({
      query: "grid suppliers", query_index: 0, operation_key: "run-1/discovery/search/0",
      request_hash: HASH, phase: "discovery",
    }, fake.operations),
    (error: unknown) => error instanceof ProviderRequestError && error.code === "unauthorized" && !error.message.includes("secret-never-log"),
  );

  const malformed = createBraveSearchProvider({
    apiKey: "test",
    fetch: async () => new Response(JSON.stringify({ web: { results: [{ title: "bad", url: "http://unsafe.test", description: "x" }] } })),
  });
  const another = fakeOperations();
  await assert.rejects(
    malformed.search({
      query: "grid suppliers", query_index: 0, operation_key: "run-1/discovery/search/1",
      request_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", phase: "discovery",
    }, another.operations),
    (error: unknown) => error instanceof ProviderRequestError && error.code === "invalid_response",
  );
});
