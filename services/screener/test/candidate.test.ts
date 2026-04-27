import test from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryCandidateRepository,
  type ScreenerCandidate,
} from "../src/candidate.ts";

const APPLE_ID = "11111111-1111-4111-a111-111111111111";
const MSFT_ID = "22222222-2222-4222-a222-222222222222";
const AS_OF = "2026-04-22T15:30:00.000Z";

function candidate(overrides: Partial<ScreenerCandidate> = {}): ScreenerCandidate {
  return {
    subject_ref: { kind: "issuer", id: APPLE_ID },
    display: { primary: "Apple Inc.", ticker: "AAPL", mic: "XNAS" },
    universe: {
      asset_type: "common_stock",
      mic: "XNAS",
      trading_currency: "USD",
      domicile: "US",
      sector: "Technology",
      industry: "Consumer Electronics",
    },
    quote: {
      last_price: 187.42,
      prev_close: 185.0,
      change_pct: 0.013,
      volume: 50_000_000,
      delay_class: "real_time",
      currency: "USD",
      as_of: AS_OF,
    },
    fundamentals: {
      market_cap: 2_900_000_000_000,
      pe_ratio: 28.4,
      gross_margin: 0.45,
      operating_margin: 0.30,
      net_margin: 0.25,
      revenue_growth_yoy: 0.08,
    },
    ...overrides,
  };
}

test("createInMemoryCandidateRepository accepts and freezes a valid record set", () => {
  const repo = createInMemoryCandidateRepository([
    candidate(),
    candidate({ subject_ref: { kind: "issuer", id: MSFT_ID }, display: { primary: "Microsoft", ticker: "MSFT" } }),
  ]);
  const list = repo.list();
  assert.equal(list.length, 2);
  assert.equal(Object.isFrozen(list), true);
  assert.equal(Object.isFrozen(list[0]), true);
  assert.equal(Object.isFrozen(list[0].quote), true);
  assert.equal(Object.isFrozen(list[0].fundamentals), true);
  assert.equal(Object.isFrozen(list[0].universe), true);
});

test("findByRef returns the matching candidate and null on miss", () => {
  const repo = createInMemoryCandidateRepository([candidate()]);
  const found = repo.findByRef({ kind: "issuer", id: APPLE_ID });
  assert.equal(found?.display.primary, "Apple Inc.");
  assert.equal(repo.findByRef({ kind: "issuer", id: MSFT_ID }), null);
  assert.equal(repo.findByRef({ kind: "listing", id: APPLE_ID }), null);
});

test("createInMemoryCandidateRepository rejects duplicate subject_refs", () => {
  assert.throws(
    () =>
      createInMemoryCandidateRepository([
        candidate(),
        candidate(), // same subject_ref
      ]),
    /duplicate/,
  );
});

test("createInMemoryCandidateRepository rejects bad subject_ref / display / universe / quote / fundamentals", () => {
  assert.throws(
    () =>
      createInMemoryCandidateRepository([
        candidate({ subject_ref: { kind: "screen" as "issuer", id: APPLE_ID } }),
      ]),
    /subject_ref\.kind/,
  );
  assert.throws(
    () => createInMemoryCandidateRepository([candidate({ display: { primary: "" } })]),
    /display\.primary/,
  );
  assert.throws(
    () =>
      createInMemoryCandidateRepository([
        candidate({
          universe: {
            asset_type: "common_stock",
            mic: "XNAS",
            trading_currency: "USD",
            domicile: "US",
            sector: "Technology",
            industry: "",
          },
        }),
      ]),
    /universe\.industry/,
  );
  assert.throws(
    () =>
      createInMemoryCandidateRepository([
        candidate({
          quote: {
            ...candidate().quote,
            delay_class: "realtime", // typo of real_time — drift guard
          },
        }),
      ]),
    /delay_class/,
  );
  assert.throws(
    () =>
      createInMemoryCandidateRepository([
        candidate({
          fundamentals: {
            ...candidate().fundamentals,
            market_cap: -1,
          },
        }),
      ]),
    /market_cap/,
  );
});

test("createInMemoryCandidateRepository accepts nullable numerics on quote and fundamentals", () => {
  const repo = createInMemoryCandidateRepository([
    candidate({
      quote: {
        last_price: null,
        prev_close: null,
        change_pct: null,
        volume: null,
        delay_class: "real_time",
        currency: "USD",
        as_of: AS_OF,
      },
      fundamentals: {
        market_cap: null,
        pe_ratio: null,
        gross_margin: null,
        operating_margin: null,
        net_margin: null,
        revenue_growth_yoy: null,
      },
    }),
  ]);
  const c = repo.list()[0];
  assert.equal(c.quote.last_price, null);
  assert.equal(c.fundamentals.market_cap, null);
});

test("repository list is frozen — caller cannot mutate the registry", () => {
  const repo = createInMemoryCandidateRepository([candidate()]);
  const list = repo.list();
  assert.throws(() => (list as ScreenerCandidate[]).push(candidate()));
});
