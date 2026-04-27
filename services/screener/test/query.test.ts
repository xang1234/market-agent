import test from "node:test";
import assert from "node:assert/strict";
import {
  assertScreenerQueryContract,
  LIMIT_MAX,
  LIMIT_MIN,
  normalizedScreenerQuery,
  type ScreenerQuery,
} from "../src/query.ts";

function validQuery(overrides: Partial<ScreenerQuery> = {}): ScreenerQuery {
  return {
    universe: [
      { field: "asset_type", values: ["common_stock"] },
      { field: "mic", values: ["XNAS", "XNYS"] },
    ],
    market: [
      { field: "last_price", min: 5 },
      { field: "delay_class", values: ["realtime", "delayed_15m"] },
    ],
    fundamentals: [
      { field: "market_cap", min: 1_000_000_000 },
      { field: "gross_margin", min: 0.2, max: 0.9 },
    ],
    sort: [{ field: "market_cap", direction: "desc" }],
    page: { limit: 50 },
    ...overrides,
  };
}

test("normalizedScreenerQuery accepts a fully bound envelope and freezes it", () => {
  const q = normalizedScreenerQuery(validQuery());
  assert.equal(Object.isFrozen(q), true);
  assert.equal(Object.isFrozen(q.universe), true);
  assert.equal(Object.isFrozen(q.universe[0]), true);
  assert.equal(Object.isFrozen(q.universe[0].values), true);
  assert.equal(Object.isFrozen(q.market), true);
  assert.equal(Object.isFrozen(q.fundamentals), true);
  assert.equal(Object.isFrozen(q.sort), true);
  assert.equal(Object.isFrozen(q.sort[0]), true);
  assert.equal(Object.isFrozen(q.page), true);

  assert.equal(q.universe.length, 2);
  assert.equal(q.universe[0].field, "asset_type");
  assert.deepEqual([...q.universe[0].values], ["common_stock"]);
  assert.equal(q.market.length, 2);
  assert.equal(q.fundamentals.length, 2);
  assert.equal(q.sort[0].direction, "desc");
  assert.equal(q.page.limit, 50);
  assert.equal(q.page.offset, undefined);
});

test("normalizedScreenerQuery accepts empty filter dimensions when sort and page are valid", () => {
  const q = normalizedScreenerQuery({
    universe: [],
    market: [],
    fundamentals: [],
    sort: [{ field: "last_price", direction: "asc" }],
    page: { limit: 1 },
  });
  assert.equal(q.universe.length, 0);
  assert.equal(q.market.length, 0);
  assert.equal(q.fundamentals.length, 0);
});

test("normalizedScreenerQuery rejects a missing dimension", () => {
  for (const dimension of ["universe", "market", "fundamentals", "sort", "page"] as const) {
    const base = validQuery() as Record<string, unknown>;
    delete base[dimension];
    assert.throws(
      () => normalizedScreenerQuery(base as ScreenerQuery),
      new RegExp(dimension),
      `must reject missing ${dimension} dimension`,
    );
  }
});

test("normalizedScreenerQuery rejects unknown screener fields (no raw provider columns)", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        market: [{ field: "polygon.lastTrade.p", min: 5 }] as unknown as ScreenerQuery["market"],
      }),
    /unknown screener field/,
  );
});

test("normalizedScreenerQuery rejects fields placed in the wrong dimension", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        universe: [{ field: "last_price", values: ["5"] }] as unknown as ScreenerQuery["universe"],
      }),
    /belongs to the market dimension/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        market: [{ field: "asset_type", values: ["common_stock"] }] as ScreenerQuery["market"],
      }),
    /belongs to the universe dimension/,
  );
});

test("normalizedScreenerQuery rejects numeric clauses in the universe dimension", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        universe: [{ field: "last_price", min: 5 }] as unknown as ScreenerQuery["universe"],
      }),
    /belongs to the market dimension/,
  );
});

test("normalizedScreenerQuery rejects enum clauses in the fundamentals dimension", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        fundamentals: [{ field: "asset_type", values: ["common_stock"] }] as unknown as ScreenerQuery["fundamentals"],
      }),
    /belongs to the universe dimension/,
  );
});

test("normalizedScreenerQuery rejects unknown enum values for a constrained field", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        universe: [
          { field: "asset_type", values: ["space_bond"] },
        ],
      }),
    /not a registered value/,
  );
});

test("normalizedScreenerQuery accepts free-form enum values when the field has no enum_values constraint", () => {
  const q = normalizedScreenerQuery({
    ...validQuery(),
    universe: [{ field: "mic", values: ["XLON", "XPAR"] }],
  });
  assert.deepEqual([...q.universe[0].values], ["XLON", "XPAR"]);
});

test("normalizedScreenerQuery rejects enum clauses with empty or duplicate value sets", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        universe: [{ field: "mic", values: [] }],
      }),
    /at least one value/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        universe: [{ field: "mic", values: ["XNAS", "XNAS"] }],
      }),
    /duplicate value/,
  );
});

test("normalizedScreenerQuery rejects enum clauses that smuggle numeric bounds", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        universe: [{ field: "mic", values: ["XNAS"], min: 1 } as unknown as ScreenerQuery["universe"][number]],
      }),
    /must use "values"/,
  );
});

test("normalizedScreenerQuery rejects numeric clauses with no bounds, NaN, or inverted ranges", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        fundamentals: [{ field: "gross_margin" }],
      }),
    /at least one of "min" or "max"/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        fundamentals: [{ field: "gross_margin", min: Number.NaN }],
      }),
    /finite number/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        fundamentals: [{ field: "gross_margin", min: 1, max: 0 }],
      }),
    /min .* must be <= max/,
  );
});

test("normalizedScreenerQuery rejects numeric clauses that smuggle enum values", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        fundamentals: [
          { field: "gross_margin", values: ["high"] } as unknown as ScreenerQuery["fundamentals"][number],
        ],
      }),
    /must use "min"\/"max"/,
  );
});

test("normalizedScreenerQuery rejects duplicate field clauses inside a dimension", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        fundamentals: [
          { field: "gross_margin", min: 0.2 },
          { field: "gross_margin", max: 0.9 },
        ],
      }),
    /duplicate clause/,
  );
});

test("normalizedScreenerQuery requires at least one sort spec", () => {
  assert.throws(
    () => normalizedScreenerQuery({ ...validQuery(), sort: [] }),
    /at least one sort spec/,
  );
});

test("normalizedScreenerQuery rejects sort on unknown, non-sortable, or duplicate fields", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        sort: [{ field: "polygon.foo", direction: "asc" }],
      }),
    /unknown screener field/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        sort: [{ field: "asset_type", direction: "asc" }],
      }),
    /not sortable/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        sort: [
          { field: "market_cap", direction: "desc" },
          { field: "market_cap", direction: "asc" },
        ],
      }),
    /duplicate sort field/,
  );
});

test("normalizedScreenerQuery rejects unknown sort directions", () => {
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        sort: [
          { field: "market_cap", direction: "ascending" as unknown as "asc" },
        ],
      }),
    /direction/,
  );
});

test("normalizedScreenerQuery rejects out-of-range or non-integer page controls", () => {
  assert.throws(
    () => normalizedScreenerQuery({ ...validQuery(), page: { limit: 0 } }),
    /page\.limit/,
  );
  assert.throws(
    () => normalizedScreenerQuery({ ...validQuery(), page: { limit: LIMIT_MAX + 1 } }),
    /page\.limit/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        page: { limit: 10.5 } as unknown as { limit: number },
      }),
    /integer/,
  );
  assert.throws(
    () =>
      normalizedScreenerQuery({
        ...validQuery(),
        page: { limit: 10, offset: -1 },
      }),
    /offset/,
  );
});

test("normalizedScreenerQuery preserves an explicit zero offset and minimum limit", () => {
  const q = normalizedScreenerQuery({
    ...validQuery(),
    page: { limit: LIMIT_MIN, offset: 0 },
  });
  assert.equal(q.page.limit, LIMIT_MIN);
  assert.equal(q.page.offset, 0);
});

test("assertScreenerQueryContract validates untrusted cross-boundary input", () => {
  assert.doesNotThrow(() => assertScreenerQueryContract(validQuery()));
  assert.throws(() => assertScreenerQueryContract(null), /must be an object/);
  assert.throws(() => assertScreenerQueryContract({}), /universe/);
  assert.throws(
    () =>
      assertScreenerQueryContract({
        ...validQuery(),
        market: [{ field: "polygon.foo", min: 5 }],
      }),
    /unknown screener field/,
  );
});

test("normalizedScreenerQuery does not mutate caller arrays or objects", () => {
  const input = validQuery();
  const universeBefore = input.universe.slice();
  const marketBefore = input.market.slice();
  const fundamentalsBefore = input.fundamentals.slice();
  const sortBefore = input.sort.slice();

  const q = normalizedScreenerQuery(input);

  assert.deepEqual(input.universe, universeBefore);
  assert.deepEqual(input.market, marketBefore);
  assert.deepEqual(input.fundamentals, fundamentalsBefore);
  assert.deepEqual(input.sort, sortBefore);
  // The frozen output is a fresh object graph, not aliased to the input.
  assert.notEqual(q.universe, input.universe);
  assert.notEqual(q.universe[0], input.universe[0]);
  assert.notEqual(q.sort, input.sort);
  assert.notEqual(q.page, input.page);
});
