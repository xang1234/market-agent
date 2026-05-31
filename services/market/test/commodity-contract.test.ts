import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMODITY_DELIVERY_TERMS,
  normalizeCommodityMarketQuote,
  normalizeCurve,
  normalizeSpread,
} from "../src/commodity-contract.ts";

const CONTRACT_ID = "11111111-1111-4111-9111-111111111111";
const CURVE_ID = "22222222-2222-4222-9222-222222222222";
const SOURCE_ID = "33333333-3333-4333-9333-333333333333";

test("normalizeCommodityMarketQuote keeps grade, location, unit, delivery month, and incoterm", () => {
  assert.deepEqual(COMMODITY_DELIVERY_TERMS, ["warehouse", "fob", "cfr", "cif", "dap"]);

  const quote = normalizeCommodityMarketQuote({
    subject_ref: { kind: "contract", id: CONTRACT_ID },
    benchmark: "LME Copper Cash",
    price: 10350,
    prev_close: 10225,
    currency: "USD",
    unit: "t",
    grade: "Grade A copper cathode",
    location: "LME warehouse",
    delivery_month: "cash",
    incoterm: "warehouse",
    freshness: "real_time",
    as_of: "2026-05-31T00:00:00.000Z",
    source_id: SOURCE_ID,
  });

  assert.equal(quote.change_abs, 125);
  assert.equal(quote.change_pct, 125 / 10225);
  assert.equal(quote.grade, "Grade A copper cathode");
  assert.equal(Object.isFrozen(quote), true);
});

test("normalizeCurve sorts tenors and rejects duplicate tenor labels", () => {
  const curve = normalizeCurve({
    curve_ref: { kind: "curve", id: CURVE_ID },
    as_of: "2026-05-31T00:00:00.000Z",
    currency: "USD",
    unit: "t",
    source_id: SOURCE_ID,
    points: [
      { tenor: "3M", tenor_rank: 3, price: 10290 },
      { tenor: "cash", tenor_rank: 0, price: 10350 },
    ],
  });

  assert.deepEqual(curve.points.map((point) => point.tenor), ["cash", "3M"]);
  assert.throws(
    () =>
      normalizeCurve({
        ...curve,
        points: [
          { tenor: "cash", tenor_rank: 0, price: 10350 },
          { tenor: "cash", tenor_rank: 1, price: 10340 },
        ],
      }),
    /duplicate tenor/i,
  );
});

test("normalizeSpread binds the two legs and computes value from leg prices", () => {
  const spread = normalizeSpread({
    spread_id: "cash-3m",
    first_leg: { tenor: "cash", price: 10350 },
    second_leg: { tenor: "3M", price: 10290 },
    currency: "USD",
    unit: "t",
    as_of: "2026-05-31T00:00:00.000Z",
    source_id: SOURCE_ID,
  });

  assert.equal(spread.value, 60);
  assert.equal(spread.label, "cash / 3M");
});
