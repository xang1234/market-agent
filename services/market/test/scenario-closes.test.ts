// The stored closes a scenario comparison may use (#224): only session
// closes, only public sources, and only those known by the cutoff, picked
// inside each source's newest row, so nothing later hides an eligible close.

import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { loadScenarioCloseCandidates } from "../src/price-observations.ts";
import { regularSessionCloseAt } from "../src/ytd-window.ts";

const ISSUER = "39000000-0000-4000-8000-0000000000a1";
const LISTING = "39000000-0000-4000-8000-000000000001";
const PUBLIC_SOURCE = "39000000-0000-4000-8000-0000000000b1";
const PRIVATE_SOURCE = "39000000-0000-4000-8000-0000000000b2";
const USER = "39000000-0000-4000-8000-0000000000c1";

test("a session close is stamped at 16:00 New York on its date; another exchange has no supported close", () => {
  assert.equal(regularSessionCloseAt("2024-06-07", "America/New_York"), "2024-06-07T20:00:00.000Z");
  assert.equal(regularSessionCloseAt("2024-01-05", "America/New_York"), "2024-01-05T21:00:00.000Z");
  assert.equal(regularSessionCloseAt("2024-06-07", "Asia/Tokyo"), null);
});

test("scenario close candidates", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for price observation coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "market-scenario-closes");
  const db = await connectedPool(t, databaseUrl);
  await db.query(`insert into users (user_id, email) values ($1, 'closes@example.com')`, [USER]);
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Closes Inc.')`, [ISSUER]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [ISSUER]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', 'CLS', 'USD', 'America/New_York')`, [LISTING, ISSUER]);
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, user_id)
     values ($1, 'polygon_market', 'market_data', 'primary', 'licensed', now(), null), ($2, 'upload', 'upload', 'tertiary', 'user', now(), $3)`,
    [PUBLIC_SOURCE, PRIVATE_SOURCE, USER],
  );
  const observe = (row: { source?: string; kind?: string; price: string; observed: string; known: string | null; fetched?: string }) =>
    db.query(
      `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
       values ($1, $2, $3, $4, 'USD', $5, $6, $7, $8)`,
      [LISTING, row.source ?? PUBLIC_SOURCE, row.kind ?? "session_close", row.price, row.observed, row.known, row.fetched ?? row.known ?? row.observed, "a".repeat(64)],
    );
  const prices = async (at: string, inclusive = true) => {
    const read = await loadScenarioCloseCandidates(db, LISTING, { at, inclusive });
    return { prices: read.candidates.map((row) => [row.kind, row.price_text, row.adjustment_basis]), unknown: read.unknown_publication };
  };

  await observe({ price: "100.00", observed: "2024-06-07T20:00:00Z", known: "2024-06-07T20:15:00Z" });
  // Monday's last trade, newer than Friday's close: never a close.
  await observe({ kind: "last_trade", price: "101.50", observed: "2024-06-10T14:00:00Z", known: "2024-06-10T14:00:05Z" });
  // A private upload's close is never evidence.
  await observe({ source: PRIVATE_SOURCE, price: "999", observed: "2024-06-10T20:00:00Z", known: "2024-06-10T20:01:00Z" });

  await t.test("a newer last trade or a private close never hides a public session close, and its stored basis is read", async () => {
    assert.deepEqual(await prices("2024-06-10T15:00:00Z"), { prices: [["session_close", "100.00", "unadjusted"]], unknown: false });
    const { candidates } = await loadScenarioCloseCandidates(db, LISTING, { at: "2024-06-10T15:00:00Z", inclusive: true });
    assert.deepEqual(candidates.map((row) => row.source_name), ["polygon_market"], "the source's stored name");
  });

  await t.test("a close first known after the cutoff never stands for one public then: the earlier close is used, and the later one is flagged", async () => {
    // Monday's close, captured only on Wednesday.
    await observe({ price: "102.00", observed: "2024-06-10T20:00:00Z", known: "2024-06-12T09:00:00Z" });
    assert.deepEqual(await prices("2024-06-11T12:00:00Z"), { prices: [["session_close", "100.00", "unadjusted"]], unknown: true });
    assert.deepEqual(await prices("2024-06-12T12:00:00Z"), { prices: [["session_close", "102.00", "unadjusted"]], unknown: false });
  });

  await t.test("a close with no known publication time is never a candidate, and is flagged", async () => {
    await observe({ price: "103.00", observed: "2024-06-12T20:00:00Z", known: null, fetched: "2024-06-12T20:30:00Z" });
    assert.deepEqual(await prices("2024-06-13T12:00:00Z"), { prices: [["session_close", "102.00", "unadjusted"]], unknown: true });
  });

  await t.test("a date's next local midnight bounds exclusively, at the column's own precision", async () => {
    await observe({ price: "104.00", observed: "2024-06-13T20:00:00Z", known: "2024-06-14T03:59:59.999999Z" });
    await observe({ price: "105.00", observed: "2024-06-14T20:00:00Z", known: "2024-06-15T04:00:00Z" });
    // Through the end of Friday 2024-06-14 in New York: up to 04:00Z on the 15th, exclusive.
    assert.deepEqual((await prices("2024-06-15T04:00:00Z", false)).prices, [["session_close", "104.00", "unadjusted"]]);
    assert.deepEqual((await prices("2024-06-15T04:00:00Z", true)).prices, [["session_close", "105.00", "unadjusted"]]);
    // Known a microsecond before Thursday's next midnight: a bound one millisecond before it would miss this close.
    assert.deepEqual((await prices("2024-06-14T04:00:00Z", false)).prices, [["session_close", "104.00", "unadjusted"]]);
  });

  await t.test("a revised close of the same session from the same source is the one known later", async () => {
    await observe({ price: "105.10", observed: "2024-06-14T20:00:00Z", known: "2024-06-16T12:00:00Z" });
    assert.deepEqual((await prices("2024-06-16T00:00:00Z")).prices, [["session_close", "105.00", "unadjusted"]]);
    assert.deepEqual((await prices("2024-06-17T00:00:00Z")).prices, [["session_close", "105.10", "unadjusted"]]);
  });
});
