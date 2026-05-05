// Pins the live quote provider's contract with services/market: requests
// MUST hit GET /v1/market/quote?subject_kind=listing&subject_id=<uuid>.
//
// We don't import services/home/src/dev.ts directly because it constructs a
// pg.Pool at module load and listens on a port; the quote-provider adapter is
// extracted so this test exercises the production wire format without booting
// the dev server.

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";

import { createLiveQuoteProvider } from "../src/dev-quote-provider.ts";

const LISTING = "11111111-1111-4111-a111-111111111111";
const SOURCE = "99999999-9999-4999-a999-999999999999";

function quoteResponse(listing: ListingSubjectRef) {
  return {
    quote: {
      listing,
      price: 200,
      prev_close: 198,
      change_abs: 2,
      change_pct: 2 / 198,
      session_state: "regular",
      as_of: "2026-05-05T15:30:00.000Z",
      delay_class: "delayed_15m",
      currency: "USD",
      source_id: SOURCE,
    },
    listing_context: { ticker: "AAPL", mic: "XNAS", timezone: "America/New_York" },
  };
}

async function startStubMarket(): Promise<{
  origin: string;
  requests: Array<{ pathname: string; search: string }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ pathname: string; search: string }> = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push({ pathname: url.pathname, search: url.search });
    if (url.pathname !== "/v1/market/quote") {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (
      url.searchParams.get("subject_kind") !== "listing" ||
      url.searchParams.get("subject_id") !== LISTING
    ) {
      res.statusCode = 400;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(quoteResponse({ kind: "listing", id: LISTING })));
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test("live quote provider hits /v1/market/quote with subject_kind+subject_id query params", async () => {
  const market = await startStubMarket();
  try {
    const provider = createLiveQuoteProvider(market.origin);
    const results = await provider([{ kind: "listing", id: LISTING }]);
    assert.equal(results.length, 1);
    assert.equal(results[0].listing_context.ticker, "AAPL");
    assert.equal(market.requests.length, 1);
    assert.equal(market.requests[0].pathname, "/v1/market/quote");
    assert.equal(
      market.requests[0].search,
      `?subject_kind=listing&subject_id=${LISTING}`,
    );
  } finally {
    await market.close();
  }
});

test("live quote provider drops refs whose market response is non-2xx", async () => {
  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.end();
  });
  server.listen(0);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const provider = createLiveQuoteProvider(origin);
    const results = await provider([{ kind: "listing", id: LISTING }]);
    assert.deepEqual(results, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("live quote provider drops refs whose market response carries an unavailable envelope", async () => {
  const server = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ unavailable: { reason: "missing_coverage" } }));
  });
  server.listen(0);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const provider = createLiveQuoteProvider(origin);
    const results = await provider([{ kind: "listing", id: LISTING }]);
    assert.deepEqual(results, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("live quote provider drops refs whose market request times out", async () => {
  const server = createServer((_req, _res) => {
    // Leave the response open until the provider aborts the request.
  });
  server.listen(0);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const provider = createLiveQuoteProvider(origin, { timeoutMs: 25 });
    const results = await provider([{ kind: "listing", id: LISTING }]);
    assert.deepEqual(results, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
