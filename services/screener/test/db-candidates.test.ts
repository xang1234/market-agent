import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresCandidateRepository } from "../src/db-candidates.ts";
import { executeScreenerQuery } from "../src/executor.ts";
import type { ScreenerQuery } from "../src/query.ts";
import { fakeRows } from "../../shared/test/fake-query.ts";

// 11:00 on Monday 2024-06-10 in New York: Friday's session is the last one closed.
const MONDAY_MORNING = new Date("2024-06-10T15:00:00.000Z");
const ISSUER = "11111111-1111-4111-8111-111111111111";
const LISTING = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

function listing(overrides: Row = {}): Row {
  return {
    issuer_id: ISSUER,
    listing_id: LISTING,
    legal_name: "Provider Co",
    share_class: null,
    asset_type: "common_stock",
    mic: "XNAS",
    ticker: "PROV",
    trading_currency: "USD",
    domicile: "US",
    sector: "Technology",
    industry: "Software",
    price: 120,
    prev_close: 118,
    delay_class: "delayed_15m",
    currency: "USD",
    as_of: "2024-06-10T14:55:00.000Z",
    ...overrides,
  };
}

/** A certified figure as the read model returns it: certified for Friday's session, priced on a New York listing. */
function certified(valuation: "market_cap" | "pe_ratio", value: string, overrides: Row = {}): Row {
  return { issuer_id: ISSUER, valuation, value, currency: valuation === "market_cap" ? "USD" : null, session_date: "2024-06-07", timezone: "America/New_York", ...overrides };
}

function fact(metric_key: string, fiscal_year: number, value_num: number): Row {
  return {
    fact_id: `f-${metric_key}-${fiscal_year}`,
    metric_key,
    display_name: metric_key,
    value_num,
    value_text: null,
    unit: "currency",
    currency: "USD",
    fiscal_year,
    fiscal_period: "FY",
    as_of: "2024-06-01T00:00:00.000Z",
    source_id: "33333333-3333-4333-8333-333333333333",
  };
}

// What the legacy screener multiplied and divided: FY diluted EPS and weighted-average diluted shares, as filed before a split.
const REPORTED_FACTS = [
  fact("revenue", 2024, 100),
  fact("gross_profit", 2024, 40),
  fact("operating_income", 2024, 30),
  fact("net_income", 2024, 20),
  fact("eps_diluted", 2024, 11.93),
  fact("weighted_average_diluted_shares", 2024, 2_494_000_000),
  fact("revenue", 2023, 80),
];

/** Answers the candidate loader's queries from fixed rows, and records each one. */
class FakeScreenerDb {
  readonly queries: string[] = [];
  listings: Row[];
  readonly valuations: Row[];

  constructor(listings: Row[], valuations: Row[] = []) {
    this.listings = listings;
    this.valuations = valuations;
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string): Promise<{ rows: R[] }> {
    this.queries.push(text);
    if (text.includes("from listings l")) return { rows: fakeRows<R>(this.listings) };
    if (text.includes("from screener_certified_valuations")) return { rows: fakeRows<R>(this.valuations) };
    if (text.includes("f.entitlement_channels")) return { rows: fakeRows<R>(REPORTED_FACTS) };
    if (text.includes("from insider_transactions")) return { rows: fakeRows<R>([{ net_shares: "5000" }]) };
    throw new Error(`unhandled query: ${text}`);
  }
}

test("Postgres screener candidate repository reloads candidates on each list", async () => {
  const db = new FakeScreenerDb([listing({ price: 10 })]);
  const repo = createPostgresCandidateRepository(db, () => MONDAY_MORNING);

  const first = await repo.list();
  db.listings = [listing({ price: 12 })];
  const second = await repo.list();

  assert.equal(first[0]?.quote.last_price, 10);
  assert.equal(second[0]?.quote.last_price, 12);
});

test("market cap and P/E are the issuer's certified figures; margins and growth stay reported", async () => {
  const db = new FakeScreenerDb([listing()], [certified("market_cap", "2956800000000"), certified("pe_ratio", "100.58675607711651299245599329421626152556580050293")]);
  const [candidate] = await createPostgresCandidateRepository(db, () => MONDAY_MORNING).list();

  assert.deepEqual(candidate?.fundamentals, {
    market_cap: 2_956_800_000_000,
    market_cap_currency: "USD",
    pe_ratio: 100.58675607711652,
    gross_margin: 0.4,
    operating_margin: 0.3,
    net_margin: 0.2,
    revenue_growth_yoy: 0.25,
    insider_net_shares_90d: 5000,
    forward_pe: null,
    roic: null,
    perf_quarter: null,
    perf_year: null,
    rsi_14: null,
    week_52_high_distance: null,
  });
});

test("without a certified figure, market cap and P/E are null, though a quote, diluted EPS and diluted shares exist", async () => {
  const db = new FakeScreenerDb([listing()]);
  const [candidate] = await createPostgresCandidateRepository(db, () => MONDAY_MORNING).list();

  assert.deepEqual(
    [candidate?.quote.last_price, candidate?.fundamentals.market_cap, candidate?.fundamentals.market_cap_currency, candidate?.fundamentals.pe_ratio, candidate?.fundamentals.gross_margin],
    [120, null, null, null, 0.4],
  );
});

test("every listing of an issuer shows the issuer's one market cap, in the currency it was priced in", async () => {
  const frankfurt = listing({ listing_id: "44444444-4444-4444-8444-444444444444", mic: "XFRA", ticker: "NVD", trading_currency: "EUR", currency: "EUR", price: 110, prev_close: 109 });
  const db = new FakeScreenerDb([listing(), frankfurt], [certified("market_cap", "2956800000000")]);
  const candidates = await createPostgresCandidateRepository(db, () => MONDAY_MORNING).list();

  assert.deepEqual(
    candidates.map((candidate) => [candidate.display.ticker, candidate.quote.currency, candidate.fundamentals.market_cap, candidate.fundamentals.market_cap_currency]),
    [["PROV", "USD", 2_956_800_000_000, "USD"], ["NVD", "EUR", 2_956_800_000_000, "USD"]],
  );
});

test("a figure certified before the last closed session reads as absent", async () => {
  const db = new FakeScreenerDb([listing()], [certified("market_cap", "2956800000000"), certified("pe_ratio", "25")]);
  const at = async (now: string) => (await createPostgresCandidateRepository(db, () => new Date(now)).list())[0]?.fundamentals;

  // Saturday: Friday's session is still the last one closed.
  assert.deepEqual([(await at("2024-06-08T16:00:00.000Z"))?.market_cap, (await at("2024-06-08T16:00:00.000Z"))?.pe_ratio], [2_956_800_000_000, 25]);
  // 16:30 on Monday in New York: Monday's session has closed, and the batch has not certified it.
  const stale = await at("2024-06-10T20:30:00.000Z");
  assert.deepEqual([stale?.market_cap, stale?.market_cap_currency, stale?.pe_ratio], [null, null, null]);
});

test("a loss maker's missing P/E fails a P/E ceiling and sorts after every P/E", async () => {
  const LOSS = "55555555-5555-4555-8555-555555555555";
  const db = new FakeScreenerDb(
    [listing(), listing({ issuer_id: LOSS, listing_id: "66666666-6666-4666-8666-666666666666", ticker: "LOSS", legal_name: "Loss Co" })],
    [certified("pe_ratio", "20"), certified("market_cap", "20000000000", { issuer_id: LOSS })],
  );
  const screen = (query: Partial<ScreenerQuery>) => executeScreenerQuery(
    { candidates: createPostgresCandidateRepository(db, () => MONDAY_MORNING), clock: () => MONDAY_MORNING },
    { universe: [], market: [], fundamentals: [], sort: [{ field: "market_cap", direction: "desc" }], page: { limit: 50 }, ...query },
  );

  const capped = await screen({ fundamentals: [{ field: "pe_ratio", max: 50 }] });
  assert.deepEqual(capped.rows.map((row) => row.display.ticker), ["PROV"]);
  for (const direction of ["asc", "desc"] as const) {
    const sorted = await screen({ sort: [{ field: "pe_ratio", direction }] });
    assert.deepEqual(sorted.rows.map((row) => [row.display.ticker, row.fundamentals.pe_ratio]), [["PROV", 20], ["LOSS", null]]);
  }
});

test("a screen reads the certified figures once, however many candidates it has", async () => {
  const db = new FakeScreenerDb(
    ["a", "b", "c"].map((suffix, index) => listing({ listing_id: `7777777${index}-7777-4777-8777-777777777777`, ticker: `T${suffix}` })),
    [certified("market_cap", "2956800000000")],
  );
  const candidates = await createPostgresCandidateRepository(db, () => MONDAY_MORNING).list();

  assert.deepEqual(candidates.map((candidate) => candidate.fundamentals.market_cap), [2_956_800_000_000, 2_956_800_000_000, 2_956_800_000_000]);
  assert.equal(db.queries.filter((text) => text.includes("screener_certified_valuations")).length, 1);
});
