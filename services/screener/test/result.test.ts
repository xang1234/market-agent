import test from "node:test";
import assert from "node:assert/strict";
import {
  assertScreenerResponseContract,
  normalizedScreenerResponse,
  type ScreenerFundamentalsSummary,
  type ScreenerQuoteSummary,
  type ScreenerResponse,
  type ScreenerResultRow,
} from "../src/result.ts";
import type { ScreenerQuery } from "../src/query.ts";
import { SCREENER_SUBJECT_KINDS } from "../src/subject-ref.ts";

const APPLE_ISSUER_ID = "11111111-1111-4111-a111-111111111111";
const MSFT_ISSUER_ID = "22222222-2222-4222-a222-222222222222";
const NVDA_ISSUER_ID = "33333333-3333-4333-a333-333333333333";
const AS_OF = "2026-04-22T15:30:00.000Z";

function validQuery(overrides: Partial<ScreenerQuery> = {}): ScreenerQuery {
  return {
    universe: [{ field: "asset_type", values: ["common_stock"] }],
    market: [{ field: "last_price", min: 5 }],
    fundamentals: [{ field: "market_cap", min: 1_000_000_000 }],
    sort: [{ field: "market_cap", direction: "desc" }],
    page: { limit: 50 },
    ...overrides,
  };
}

function quoteSummary(
  overrides: Partial<ScreenerQuoteSummary> = {},
): ScreenerQuoteSummary {
  return {
    last_price: 187.42,
    prev_close: 185.0,
    change_pct: 0.0131,
    volume: 50_123_456,
    delay_class: "real_time",
    currency: "USD",
    as_of: AS_OF,
    ...overrides,
  };
}

function fundamentalsSummary(
  overrides: Partial<ScreenerFundamentalsSummary> = {},
): ScreenerFundamentalsSummary {
  return {
    market_cap: 2_900_000_000_000,
    pe_ratio: 28.4,
    gross_margin: 0.45,
    operating_margin: 0.30,
    net_margin: 0.25,
    revenue_growth_yoy: 0.08,
    ...overrides,
  };
}

function row(
  rank: number,
  subjectId: string,
  overrides: Partial<ScreenerResultRow> = {},
): ScreenerResultRow {
  return {
    subject_ref: { kind: "issuer", id: subjectId },
    display: { primary: "Apple Inc.", ticker: "AAPL", legal_name: "Apple Inc." },
    rank,
    quote: quoteSummary(),
    fundamentals: fundamentalsSummary(),
    ...overrides,
  };
}

function validResponse(
  overrides: Partial<ScreenerResponse> = {},
): ScreenerResponse {
  return {
    query: validQuery(),
    rows: [
      row(1, APPLE_ISSUER_ID),
      row(2, MSFT_ISSUER_ID, {
        display: { primary: "Microsoft", ticker: "MSFT" },
        fundamentals: fundamentalsSummary({ market_cap: 2_700_000_000_000 }),
      }),
    ],
    total_count: 1234,
    page: { limit: 50 },
    as_of: AS_OF,
    snapshot_compatible: true,
    ...overrides,
  };
}

test("normalizedScreenerResponse accepts a fully bound response and freezes it", () => {
  const r = normalizedScreenerResponse(validResponse());

  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.query), true);
  assert.equal(Object.isFrozen(r.rows), true);
  assert.equal(Object.isFrozen(r.rows[0]), true);
  assert.equal(Object.isFrozen(r.rows[0].subject_ref), true);
  assert.equal(Object.isFrozen(r.rows[0].display), true);
  assert.equal(Object.isFrozen(r.rows[0].quote), true);
  assert.equal(Object.isFrozen(r.rows[0].fundamentals), true);
  assert.equal(Object.isFrozen(r.page), true);

  assert.equal(r.total_count, 1234);
  assert.equal(r.snapshot_compatible, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].subject_ref.kind, "issuer");
  assert.equal(r.rows[0].subject_ref.id, APPLE_ISSUER_ID);
  assert.equal(r.rows[0].rank, 1);
  assert.equal(r.rows[0].display.primary, "Apple Inc.");
  assert.equal(r.rows[0].display.ticker, "AAPL");
  assert.equal(r.rows[0].quote.delay_class, "real_time");
});

test("normalizedScreenerResponse accepts an empty result set", () => {
  const r = normalizedScreenerResponse({
    ...validResponse(),
    rows: [],
    total_count: 0,
  });
  assert.equal(r.rows.length, 0);
  assert.equal(r.total_count, 0);
});

test("normalizedScreenerResponse rejects rows count > total_count", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        total_count: 1,
      }),
    /exceeds total_count/,
  );
});

test("normalizedScreenerResponse rejects rows count > page.limit", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        query: validQuery({ page: { limit: 1 } }),
        page: { limit: 1 },
      }),
    /exceeds page\.limit/,
  );
});

test("normalizedScreenerResponse requires response.page to echo query.page", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        page: { limit: 25 },
      }),
    /response page must echo/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        page: { limit: 50, offset: 10 },
      }),
    /response page must echo/,
  );
});

test("normalizedScreenerResponse preserves a non-zero offset that the query carried", () => {
  const r = normalizedScreenerResponse({
    ...validResponse(),
    query: validQuery({ page: { limit: 50, offset: 100 } }),
    page: { limit: 50, offset: 100 },
  });
  assert.equal(r.page.offset, 100);
});

test("normalizedScreenerResponse rejects a stringly-typed response page.limit (not just non-echo)", () => {
  // Without shape validation, "50" !== 50 fires the echo error with a
  // misleading "expected 50, got 50" message because String(50) === "50".
  // The shape assertion surfaces the real cause first.
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        page: { limit: "50" } as unknown as { limit: number },
      }),
    /page\.limit: must be a finite number/,
  );
});

test("normalizedScreenerResponse rejects a non-integer or stringly-typed response page.offset", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        query: validQuery({ page: { limit: 50, offset: 0 } }),
        page: { limit: 50, offset: "0" } as unknown as {
          limit: number;
          offset: number;
        },
      }),
    /page\.offset: must be a finite number/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        query: validQuery({ page: { limit: 50, offset: 0 } }),
        page: { limit: 50, offset: 1.5 },
      }),
    /page\.offset: must be an integer/,
  );
});

test("normalizedScreenerResponse rejects non-strictly-increasing rank", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [row(1, APPLE_ISSUER_ID), row(1, MSFT_ISSUER_ID)],
      }),
    /strictly greater/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [row(2, APPLE_ISSUER_ID), row(1, MSFT_ISSUER_ID)],
      }),
    /strictly greater/,
  );
});

test("normalizedScreenerResponse rejects rank < 1 or non-integer", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [row(0, APPLE_ISSUER_ID)],
      }),
    /rank/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [row(1.5, APPLE_ISSUER_ID)],
      }),
    /rank/,
  );
});

test("normalizedScreenerResponse rejects duplicate subject_refs across rows", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [row(1, APPLE_ISSUER_ID), row(2, APPLE_ISSUER_ID)],
      }),
    /duplicate subject/,
  );
});

test("normalizedScreenerResponse accepts every supported subject kind", () => {
  for (const kind of SCREENER_SUBJECT_KINDS) {
    const r = normalizedScreenerResponse({
      ...validResponse(),
      rows: [row(1, NVDA_ISSUER_ID, { subject_ref: { kind, id: NVDA_ISSUER_ID } })],
    });
    assert.equal(r.rows[0].subject_ref.kind, kind);
  }
});

test("normalizedScreenerResponse rejects unknown subject kinds and bad UUIDs", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, {
            subject_ref: { kind: "theme" as "issuer", id: APPLE_ISSUER_ID },
          }),
        ],
      }),
    /subject_ref\.kind/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, {
            subject_ref: { kind: "issuer", id: "not-a-uuid" },
          }),
        ],
      }),
    /subject_ref\.id/,
  );
});

test("normalizedScreenerResponse rejects display with empty primary or non-string optionals", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [row(1, APPLE_ISSUER_ID, { display: { primary: "" } })],
      }),
    /display\.primary/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, {
            display: { primary: "Apple", ticker: "" },
          }),
        ],
      }),
    /display\.ticker/,
  );
});

test("normalizedScreenerResponse drops display optionals not provided", () => {
  const r = normalizedScreenerResponse({
    ...validResponse(),
    rows: [
      row(1, APPLE_ISSUER_ID, { display: { primary: "Apple Inc." } }),
    ],
  });
  assert.equal(r.rows[0].display.ticker, undefined);
  assert.equal(r.rows[0].display.mic, undefined);
});

test("normalizedScreenerResponse requires every quote field", () => {
  for (const field of [
    "last_price",
    "prev_close",
    "change_pct",
    "volume",
    "delay_class",
    "currency",
    "as_of",
  ] as const) {
    const quote = { ...quoteSummary() } as Record<string, unknown>;
    delete quote[field];
    assert.throws(
      () =>
        normalizedScreenerResponse({
          ...validResponse(),
          rows: [
            row(1, APPLE_ISSUER_ID, {
              quote: quote as unknown as ScreenerQuoteSummary,
            }),
          ],
        }),
      new RegExp(field),
      `must reject missing quote.${field}`,
    );
  }
});

test("normalizedScreenerResponse accepts null for nullable quote fields", () => {
  const r = normalizedScreenerResponse({
    ...validResponse(),
    rows: [
      row(1, APPLE_ISSUER_ID, {
        quote: quoteSummary({
          last_price: null,
          prev_close: null,
          change_pct: null,
          volume: null,
        }),
      }),
    ],
  });
  assert.equal(r.rows[0].quote.last_price, null);
  assert.equal(r.rows[0].quote.volume, null);
});

test("normalizedScreenerResponse rejects non-positive prices and negative volume", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, { quote: quoteSummary({ last_price: 0 }) }),
        ],
      }),
    /last_price/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, { quote: quoteSummary({ volume: -1 }) }),
        ],
      }),
    /volume/,
  );
});

test("normalizedScreenerResponse rejects unknown delay_class values (drift guard)", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, {
            quote: quoteSummary({ delay_class: "realtime" }),
          }),
        ],
      }),
    /delay_class/,
  );
});

test("normalizedScreenerResponse rejects bad currency / non-ISO timestamps", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, { quote: quoteSummary({ currency: "us dollars" }) }),
        ],
      }),
    /currency/,
  );
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, { quote: quoteSummary({ as_of: "2026-04-22" }) }),
        ],
      }),
    /as_of/,
  );
});

test("normalizedScreenerResponse requires every fundamentals field", () => {
  for (const field of [
    "market_cap",
    "pe_ratio",
    "gross_margin",
    "operating_margin",
    "net_margin",
    "revenue_growth_yoy",
  ] as const) {
    const fundamentals = { ...fundamentalsSummary() } as Record<string, unknown>;
    delete fundamentals[field];
    assert.throws(
      () =>
        normalizedScreenerResponse({
          ...validResponse(),
          rows: [
            row(1, APPLE_ISSUER_ID, {
              fundamentals: fundamentals as unknown as ScreenerFundamentalsSummary,
            }),
          ],
        }),
      new RegExp(field),
      `must reject missing fundamentals.${field}`,
    );
  }
});

test("normalizedScreenerResponse accepts negative margins and pe_ratio (loss-makers)", () => {
  const r = normalizedScreenerResponse({
    ...validResponse(),
    rows: [
      row(1, APPLE_ISSUER_ID, {
        fundamentals: fundamentalsSummary({
          pe_ratio: -15,
          net_margin: -0.4,
          revenue_growth_yoy: -0.1,
        }),
      }),
    ],
  });
  assert.equal(r.rows[0].fundamentals.pe_ratio, -15);
  assert.equal(r.rows[0].fundamentals.net_margin, -0.4);
});

test("normalizedScreenerResponse rejects negative market_cap", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        rows: [
          row(1, APPLE_ISSUER_ID, {
            fundamentals: fundamentalsSummary({ market_cap: -1 }),
          }),
        ],
      }),
    /market_cap/,
  );
});

test("normalizedScreenerResponse rejects non-integer or negative total_count", () => {
  assert.throws(
    () => normalizedScreenerResponse({ ...validResponse(), total_count: -1 }),
    /total_count/,
  );
  assert.throws(
    () => normalizedScreenerResponse({ ...validResponse(), total_count: 12.5 }),
    /total_count/,
  );
});

test("normalizedScreenerResponse delegates query validation to the screener-query contract", () => {
  assert.throws(
    () =>
      normalizedScreenerResponse({
        ...validResponse(),
        query: { ...validQuery(), sort: [] },
      }),
    /sort/,
  );
});

test("assertScreenerResponseContract validates untrusted cross-boundary input", () => {
  assert.doesNotThrow(() => assertScreenerResponseContract(validResponse()));
  assert.throws(() => assertScreenerResponseContract(null), /must be an object/);
  assert.throws(
    () => assertScreenerResponseContract({}),
    /normalizedScreenerQuery/,
  );
});

test("row.subject_ref carries the canonical {kind, id} handoff key for symbol-entry flow", () => {
  const r = normalizedScreenerResponse(validResponse());
  const ref = r.rows[0].subject_ref;
  // The web symbol-entry parser (web/src/symbol/search.ts parseSubjectRefString)
  // expects the `kind:uuid` URL form. Constructing it from the row should be a
  // one-line operation — that's the whole point of "row hands off subject identity".
  assert.equal(`${ref.kind}:${ref.id}`, `issuer:${APPLE_ISSUER_ID}`);
});

test("normalizedScreenerResponse does not mutate caller objects", () => {
  const input = validResponse();
  const rowsBefore = input.rows.slice();
  const queryBefore = { ...input.query };
  normalizedScreenerResponse(input);
  assert.deepEqual(input.rows, rowsBefore);
  assert.deepEqual(input.query, queryBefore);
});
