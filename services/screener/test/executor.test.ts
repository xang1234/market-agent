import test from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryCandidateRepository,
  type ScreenerCandidate,
} from "../src/candidate.ts";
import { executeScreenerQuery, type ExecutorDeps } from "../src/executor.ts";
import type { ScreenerQuery } from "../src/query.ts";

const APPLE_ID = "11111111-1111-4111-a111-111111111111";
const MSFT_ID = "22222222-2222-4222-a222-222222222222";
const NVDA_ID = "33333333-3333-4333-a333-333333333333";
const TSLA_ID = "44444444-4444-4444-a444-444444444444";
const META_ID = "55555555-5555-4555-a555-555555555555";
const AS_OF = "2026-04-22T15:30:00.000Z";
const FIXED_NOW = new Date("2026-04-22T15:30:00.000Z");

function fixedClock(): Date {
  return FIXED_NOW;
}

function candidate(
  id: string,
  overrides: { display?: Partial<ScreenerCandidate["display"]>; universe?: Partial<ScreenerCandidate["universe"]>; quote?: Partial<ScreenerCandidate["quote"]>; fundamentals?: Partial<ScreenerCandidate["fundamentals"]> } = {},
): ScreenerCandidate {
  return {
    subject_ref: { kind: "issuer", id },
    display: { primary: "Test Co", ticker: "TST", ...overrides.display },
    universe: {
      asset_type: "common_stock",
      mic: "XNAS",
      trading_currency: "USD",
      domicile: "US",
      sector: "Technology",
      industry: "Software",
      ...overrides.universe,
    },
    quote: {
      last_price: 100,
      prev_close: 99,
      change_pct: 0.01,
      volume: 1_000_000,
      delay_class: "real_time",
      currency: "USD",
      as_of: AS_OF,
      ...overrides.quote,
    },
    fundamentals: {
      market_cap: 1_000_000_000,
      pe_ratio: 20,
      gross_margin: 0.5,
      operating_margin: 0.3,
      net_margin: 0.2,
      revenue_growth_yoy: 0.05,
      ...overrides.fundamentals,
    },
  };
}

function deps(records: ReadonlyArray<ScreenerCandidate>): ExecutorDeps {
  return {
    candidates: createInMemoryCandidateRepository(records),
    clock: fixedClock,
  };
}

function baseQuery(overrides: Partial<ScreenerQuery> = {}): ScreenerQuery {
  return {
    universe: [],
    market: [],
    fundamentals: [],
    sort: [{ field: "market_cap", direction: "desc" }],
    page: { limit: 50 },
    ...overrides,
  };
}

const APPLE = candidate(APPLE_ID, {
  display: { primary: "Apple Inc.", ticker: "AAPL", mic: "XNAS" },
  universe: { sector: "Technology", industry: "Consumer Electronics" },
  quote: { last_price: 187.42, volume: 50_000_000 },
  fundamentals: { market_cap: 2_900_000_000_000, pe_ratio: 28, gross_margin: 0.45 },
});

const MSFT = candidate(MSFT_ID, {
  display: { primary: "Microsoft", ticker: "MSFT" },
  universe: { sector: "Technology", industry: "Software" },
  quote: { last_price: 415, volume: 25_000_000 },
  fundamentals: { market_cap: 3_100_000_000_000, pe_ratio: 35, gross_margin: 0.69 },
});

const NVDA = candidate(NVDA_ID, {
  display: { primary: "NVIDIA", ticker: "NVDA" },
  universe: { sector: "Technology", industry: "Semiconductors" },
  quote: { last_price: 950, volume: 35_000_000 },
  fundamentals: { market_cap: 2_300_000_000_000, pe_ratio: 65, gross_margin: 0.74 },
});

const TSLA = candidate(TSLA_ID, {
  display: { primary: "Tesla", ticker: "TSLA" },
  universe: { sector: "Consumer Cyclical", industry: "Auto Manufacturers" },
  quote: { last_price: 248, volume: 70_000_000 },
  fundamentals: { market_cap: 790_000_000_000, pe_ratio: 75, gross_margin: 0.18 },
});

const META = candidate(META_ID, {
  display: { primary: "Meta Platforms", ticker: "META" },
  universe: { sector: "Communication Services", industry: "Internet Content" },
  quote: { last_price: 510, volume: 18_000_000 },
  fundamentals: { market_cap: 1_300_000_000_000, pe_ratio: 27, gross_margin: 0.81 },
});

const ALL = [APPLE, MSFT, NVDA, TSLA, META];

test("executor returns all candidates when no filters and sorts by market_cap desc", () => {
  const r = executeScreenerQuery(deps(ALL), baseQuery());
  assert.equal(r.total_count, 5);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Microsoft", "Apple Inc.", "NVIDIA", "Meta Platforms", "Tesla"],
  );
  assert.equal(r.rows[0].rank, 1);
  assert.equal(r.rows[4].rank, 5);
  assert.equal(r.as_of, AS_OF);
  assert.equal(r.snapshot_compatible, false);
});

test("executor universe filter excludes by mic / sector", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({
      universe: [{ field: "sector", values: ["Technology"] }],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Microsoft", "Apple Inc.", "NVIDIA"],
  );
});

test("executor market clause: numeric range filters by last_price", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({
      market: [{ field: "last_price", min: 200, max: 600 }],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Microsoft", "Meta Platforms", "Tesla"],
  );
});

test("executor fundamentals clause: filter by market_cap > $1T", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({
      fundamentals: [{ field: "market_cap", min: 1_000_000_000_000 }],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Microsoft", "Apple Inc.", "NVIDIA", "Meta Platforms"],
  );
});

test("executor combines universe + market + fundamentals filters (AND semantics)", () => {
  // Tech sector + price > $300 + market_cap > $2T → MSFT, NVDA only.
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({
      universe: [{ field: "sector", values: ["Technology"] }],
      market: [{ field: "last_price", min: 300 }],
      fundamentals: [{ field: "market_cap", min: 2_000_000_000_000 }],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Microsoft", "NVIDIA"],
  );
});

test("executor sort asc reverses the order", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({
      sort: [{ field: "market_cap", direction: "asc" }],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Tesla", "Meta Platforms", "NVIDIA", "Apple Inc.", "Microsoft"],
  );
});

test("executor multi-field sort uses primary then tiebreaker", () => {
  // Primary: gross_margin desc — META(0.81) > NVDA(0.74) > MSFT(0.69) > APPLE(0.45) > TSLA(0.18)
  // No ties here; just verify order respects primary.
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({
      sort: [
        { field: "gross_margin", direction: "desc" },
        { field: "market_cap", direction: "desc" },
      ],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Meta Platforms", "NVIDIA", "Microsoft", "Apple Inc.", "Tesla"],
  );
});

test("executor pagination: limit caps row count, total_count holds full match set", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({ page: { limit: 2 } }),
  );
  assert.equal(r.total_count, 5);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Microsoft", "Apple Inc."],
  );
  assert.equal(r.rows[0].rank, 1);
  assert.equal(r.rows[1].rank, 2);
});

test("executor pagination: offset advances rank window globally", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({ page: { limit: 2, offset: 2 } }),
  );
  assert.equal(r.total_count, 5);
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["NVIDIA", "Meta Platforms"],
  );
  // Global rank, not page rank — third match worldwide is the 3rd row.
  assert.equal(r.rows[0].rank, 3);
  assert.equal(r.rows[1].rank, 4);
});

test("executor pagination: offset beyond match set returns empty rows but real total_count", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({ page: { limit: 2, offset: 100 } }),
  );
  assert.equal(r.total_count, 5);
  assert.equal(r.rows.length, 0);
});

test("executor: numeric clause excludes candidates whose value is null", () => {
  const lossMaker = candidate("66666666-6666-4666-a666-666666666666", {
    display: { primary: "Loss Co", ticker: "LOSS" },
    fundamentals: {
      market_cap: 100_000_000,
      pe_ratio: null,
      gross_margin: 0.3,
      operating_margin: -0.1,
      net_margin: -0.2,
      revenue_growth_yoy: -0.05,
    },
  });
  const r = executeScreenerQuery(
    deps([APPLE, lossMaker]),
    baseQuery({
      fundamentals: [{ field: "pe_ratio", min: 5 }],
    }),
  );
  // pe_ratio null on lossMaker → excluded.
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Apple Inc."],
  );
});

test("executor: sort with null values pushes them to the bottom regardless of direction", () => {
  const lossMaker = candidate("66666666-6666-4666-a666-666666666666", {
    display: { primary: "Loss Co" },
    fundamentals: {
      market_cap: 100_000_000,
      pe_ratio: null,
      gross_margin: 0.1,
      operating_margin: -0.1,
      net_margin: -0.2,
      revenue_growth_yoy: -0.05,
    },
  });
  // Asc sort by pe_ratio — null should still rank last, not first.
  const r = executeScreenerQuery(
    deps([APPLE, MSFT, lossMaker]),
    baseQuery({
      sort: [{ field: "pe_ratio", direction: "asc" }],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Apple Inc.", "Microsoft", "Loss Co"],
  );
});

test("executor: market enum clause filters by delay_class", () => {
  const eod = candidate("66666666-6666-4666-a666-666666666666", {
    display: { primary: "EOD Only", ticker: "EOD" },
    quote: { last_price: 50, prev_close: 50, change_pct: 0, volume: 1_000, delay_class: "eod", currency: "USD", as_of: AS_OF },
  });
  const r = executeScreenerQuery(
    deps([APPLE, eod]),
    baseQuery({
      market: [{ field: "delay_class", values: ["real_time"] }],
    }),
  );
  assert.deepEqual(
    r.rows.map((row) => row.display.primary),
    ["Apple Inc."],
  );
});

test("executor returns an empty response when no candidates match", () => {
  const r = executeScreenerQuery(
    deps(ALL),
    baseQuery({
      universe: [{ field: "asset_type", values: ["bond"] }],
    }),
  );
  assert.equal(r.total_count, 0);
  assert.equal(r.rows.length, 0);
});

test("executor passes the validated frozen ScreenerResponse contract", () => {
  // Freezing + invariant checks happen inside normalizedScreenerResponse,
  // which is what the executor returns. Just sanity-check a few invariants.
  const r = executeScreenerQuery(deps(ALL), baseQuery());
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.rows), true);
  assert.equal(Object.isFrozen(r.rows[0]), true);
});

test("executor does not mutate the candidate registry (sort happens on a copy)", () => {
  const repo = createInMemoryCandidateRepository(ALL);
  const before = repo.list().map((c) => c.subject_ref.id);
  executeScreenerQuery(
    { candidates: repo, clock: fixedClock },
    baseQuery({
      sort: [{ field: "market_cap", direction: "asc" }],
    }),
  );
  const after = repo.list().map((c) => c.subject_ref.id);
  assert.deepEqual(after, before);
});

test("executor: row.subject_ref hands off the canonical {kind, id} for symbol-entry flow", () => {
  const r = executeScreenerQuery(
    deps([APPLE]),
    baseQuery(),
  );
  assert.equal(r.rows[0].subject_ref.kind, "issuer");
  assert.equal(r.rows[0].subject_ref.id, APPLE_ID);
});
