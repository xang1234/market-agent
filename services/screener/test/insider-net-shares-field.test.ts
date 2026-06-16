import test from "node:test";
import assert from "node:assert/strict";
import { getFieldDefinition } from "../src/fields.ts";
import { freezeFundamentalsSummary } from "../src/result.ts";

// The six required fundamentals fields (FUNDAMENTALS_FIELDS) a candidate input
// must carry; insider_net_shares_90d is null-defaulted on top, like the vendor
// technical fields, so older inputs without it stay valid.
const REQUIRED = {
  market_cap: null,
  pe_ratio: null,
  gross_margin: null,
  operating_margin: null,
  net_margin: null,
  revenue_growth_yoy: null,
};

test("insider_net_shares_90d is a sortable numeric fundamentals field", () => {
  const def = getFieldDefinition("insider_net_shares_90d");
  assert.ok(def, "field is registered");
  assert.equal(def.dimension, "fundamentals");
  assert.equal(def.kind, "numeric");
  assert.equal(def.sortable, true);
  assert.equal(def.enum_values, undefined, "numeric fields carry no enum set");
});

test("freezeFundamentalsSummary defaults insider_net_shares_90d to null when absent", () => {
  const f = freezeFundamentalsSummary(REQUIRED, "candidate");
  assert.equal(f.insider_net_shares_90d, null);
});

test("freezeFundamentalsSummary passes a negative net through (insiders net-selling)", () => {
  const f = freezeFundamentalsSummary({ ...REQUIRED, insider_net_shares_90d: -1500 }, "candidate");
  assert.equal(f.insider_net_shares_90d, -1500);
});

test("freezeFundamentalsSummary rejects a non-finite net", () => {
  assert.throws(
    () => freezeFundamentalsSummary({ ...REQUIRED, insider_net_shares_90d: Number.NaN }, "candidate"),
    /insider_net_shares_90d/,
  );
});
