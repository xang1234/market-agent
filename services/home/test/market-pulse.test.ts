import assert from "node:assert/strict";
import test from "node:test";

import { getHomeMarketPulse } from "../src/market-pulse.ts";
import type { HomeQuoteProvider } from "../src/secondary-types.ts";

const SPY = "00000000-0000-4000-a000-0000000000a1";
const QQQ = "00000000-0000-4000-a000-0000000000a2";
const DIA = "00000000-0000-4000-a000-0000000000a3";
const SOURCE = "11111111-1111-4111-a111-111111111111";

const PULSE_SUBJECTS = [
  { kind: "listing" as const, id: SPY },
  { kind: "listing" as const, id: QQQ },
  { kind: "listing" as const, id: DIA },
];

function quote(id: string, price: number, prev: number) {
  return Object.freeze({
    quote: Object.freeze({
      listing: { kind: "listing" as const, id },
      price,
      prev_close: prev,
      change_abs: price - prev,
      change_pct: (price - prev) / prev,
      session_state: "regular" as const,
      as_of: "2026-05-05T15:30:00.000Z",
      delay_class: "delayed_15m" as const,
      currency: "USD",
      source_id: SOURCE,
    }),
    listing_context: Object.freeze({
      ticker: `T-${id.slice(0, 4)}`,
      mic: "XNAS",
      timezone: "America/New_York",
    }),
  });
}

function provider(rows: ReadonlyArray<ReturnType<typeof quote>>): HomeQuoteProvider {
  return async () => rows;
}

test("getHomeMarketPulse preserves the input subject order", async () => {
  const result = await getHomeMarketPulse({
    pulse_subjects: PULSE_SUBJECTS,
    quoteProvider: provider([
      quote(QQQ, 460, 458),
      quote(DIA, 388, 390),
      quote(SPY, 510, 505),
    ]),
  });

  assert.deepEqual(
    result.rows.map((row) => row.listing.id),
    [SPY, QQQ, DIA],
  );
  assert.equal(result.omitted.length, 0);
});

test("getHomeMarketPulse exposes quote fields and listing context verbatim", async () => {
  const result = await getHomeMarketPulse({
    pulse_subjects: [{ kind: "listing", id: SPY }],
    quoteProvider: provider([quote(SPY, 510, 505)]),
  });

  const row = result.rows[0];
  assert.equal(row.price, 510);
  assert.equal(row.prev_close, 505);
  assert.equal(row.change_abs, 5);
  assert.ok(Math.abs(row.change_pct - 5 / 505) < 1e-9);
  assert.equal(row.session_state, "regular");
  assert.equal(row.delay_class, "delayed_15m");
  assert.equal(row.as_of, "2026-05-05T15:30:00.000Z");
  assert.equal(row.currency, "USD");
  assert.equal(row.ticker, `T-${SPY.slice(0, 4)}`);
  assert.equal(row.mic, "XNAS");
});

test("getHomeMarketPulse reports unpriced refs in the omitted sidecar", async () => {
  const result = await getHomeMarketPulse({
    pulse_subjects: PULSE_SUBJECTS,
    quoteProvider: provider([quote(SPY, 510, 505)]),
  });

  assert.deepEqual(
    result.rows.map((row) => row.listing.id),
    [SPY],
  );
  assert.deepEqual(
    result.omitted.map((entry) => entry.listing.id),
    [QQQ, DIA],
  );
  for (const entry of result.omitted) {
    assert.equal(entry.reason, "no_quote");
  }
});

test("getHomeMarketPulse returns empty rows and empty omitted when no pulse subjects are configured", async () => {
  const result = await getHomeMarketPulse({
    pulse_subjects: [],
    quoteProvider: provider([]),
  });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.omitted, []);
});

test("getHomeMarketPulse rejects non-listing pulse subjects", async () => {
  await assert.rejects(
    getHomeMarketPulse({
      pulse_subjects: [
        // @ts-expect-error — intentionally invalid kind
        { kind: "issuer", id: SPY },
      ],
      quoteProvider: provider([]),
    }),
    /pulse_subjects.*listing/i,
  );
});

test("getHomeMarketPulse rejects malformed UUIDs in pulse_subjects", async () => {
  await assert.rejects(
    getHomeMarketPulse({
      pulse_subjects: [{ kind: "listing", id: "not-a-uuid" }],
      quoteProvider: provider([]),
    }),
    /pulse_subjects.*UUID/i,
  );
});

test("getHomeMarketPulse skips quote rows whose listing wasn't requested", async () => {
  const stranger = "99999999-9999-4999-a999-999999999999";
  const result = await getHomeMarketPulse({
    pulse_subjects: [{ kind: "listing", id: SPY }],
    quoteProvider: provider([quote(SPY, 510, 505), quote(stranger, 1, 1.1)]),
  });
  assert.deepEqual(
    result.rows.map((row) => row.listing.id),
    [SPY],
  );
});

test("getHomeMarketPulse rejects quote results missing listing context", async () => {
  const malformed: HomeQuoteProvider = async () => [
    {
      quote: {
        listing: { kind: "listing", id: SPY },
        price: 1,
        prev_close: 1,
        change_abs: 0,
        change_pct: 0,
        session_state: "regular",
        as_of: "2026-05-05T15:30:00.000Z",
        delay_class: "delayed_15m",
        currency: "USD",
        source_id: SOURCE,
      },
      listing_context: { ticker: "", mic: "XNAS", timezone: "UTC" },
    },
  ]
  await assert.rejects(
    getHomeMarketPulse({
      pulse_subjects: [{ kind: "listing", id: SPY }],
      quoteProvider: malformed,
    }),
    /ticker/i,
  );
});
