import assert from "node:assert/strict";
import test from "node:test";
import type { ReportedMetricNode, SplitAdjustmentV2 } from "../src/contracts.ts";
import { FinancialIntegrityError, operandFromBoundInput } from "../src/operations.ts";
import { boundInput, LISTING, priceInput, SLOTS, SPLIT_CUTOFF, splitAdjustment } from "./operand-fixtures.ts";

const NEW_YORK = "America/New_York";
const CUTOFF = SPLIT_CUTOFF;
const NODE: ReportedMetricNode = {
  node_id: "px", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "share_price", period: { kind: "at_cutoff" },
};
const EXPECTED = { slot: SLOTS.a, definition_version: "share_price.v1", knowledge_cutoff: CUTOFF, reporting_basis: "as_reported" as const };

function adjustment(price: string, tradeDate: string): SplitAdjustmentV2 {
  return splitAdjustment(price, "price", tradeDate);
}

function integrityCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof FinancialIntegrityError) return error.code;
    throw error;
  }
  return assert.fail("expected an integrity failure");
}

test("a price traded before a split binds divided by it to the reference date, with its lineage", () => {
  const input = priceInput("1200.00", "1200", "2024-06-07");
  assert.deepEqual(input.split_adjustment, {
    version: "split_adjustment.v2",
    as_filed_on: "2024-06-07",
    reference_date: "2024-06-11",
    listing_id: LISTING,
    listing_timezone: NEW_YORK,
    splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }],
    factor: { numerator: "10", denominator: "1" },
    adjusted_native_value: { numerator: "120", denominator: "1" },
  });
  const outcome = operandFromBoundInput(input, NODE, EXPECTED);
  if (!outcome.ok) return assert.fail(outcome.reason_code);
  assert.deepEqual([outcome.payload.value, outcome.payload.exact, outcome.payload.unit], ["120", true, { kind: "currency_per_share", currency: "USD" }]);
  assert.deepEqual(input.numeric, { raw_token: "1200.00", value: "1200" });
});

test("a price traded on or after the split's date is already on its basis and binds unchanged", () => {
  for (const tradeDate of ["2024-06-10", "2024-06-11"]) {
    const input = priceInput("120.00", "120", tradeDate);
    assert.deepEqual([input.split_adjustment.splits, input.split_adjustment.factor], [[], { numerator: "1", denominator: "1" }]);
    const outcome = operandFromBoundInput(input, NODE, EXPECTED);
    if (!outcome.ok) return assert.fail(outcome.reason_code);
    assert.equal(outcome.payload.value, "120");
  }
});

test("the provider's token is kept exactly beside its canonical value", () => {
  const input = priceInput("142.0700", "142.07", "2024-06-11");
  assert.deepEqual(input.numeric, { raw_token: "142.0700", value: "142.07" });
  const outcome = operandFromBoundInput(input, NODE, EXPECTED);
  if (!outcome.ok) return assert.fail(outcome.reason_code);
  assert.equal(outcome.payload.value, "142.07");
});

test("a tampered token, adjustment, anchor, or knowledge time fails the input's integrity", () => {
  const input = priceInput("1200.00", "1200", "2024-06-07");
  assert.equal(integrityCode(() => operandFromBoundInput({ ...input, numeric: { raw_token: "1200.01", value: "1200" } }, NODE, EXPECTED)), "token_value_mismatch");
  const halved = { ...input.split_adjustment, factor: { numerator: "5", denominator: "1" }, adjusted_native_value: { numerator: "240", denominator: "1" } };
  assert.equal(integrityCode(() => operandFromBoundInput({ ...input, split_adjustment: halved }, NODE, EXPECTED)), "split_adjustment_mismatch");
  // Anchored a day early, the adjustment is internally consistent but not at the trade's date.
  assert.equal(integrityCode(() => operandFromBoundInput({ ...input, split_adjustment: adjustment("1200", "2024-06-06") }, NODE, EXPECTED)), "split_anchor_mismatch");
  assert.equal(integrityCode(() => operandFromBoundInput({ ...input, known_at: "2024-06-11T20:30:00.001Z" }, NODE, EXPECTED)), "price_not_known_at_cutoff");
  assert.equal(integrityCode(() => operandFromBoundInput({ ...input, known_at: "2024-06-07T19:59:59.999Z" }, NODE, EXPECTED)), "price_not_known_at_cutoff");
});

test("a share price binds only from a price observation", () => {
  const fact = boundInput({ metric: "share_price", value: "1200", unit: { kind: "currency_per_share", currency: "USD" }, kind: "instant", end: "2024-06-07", fiscal_year: 2024, fiscal_period: "Q2" });
  assert.equal(integrityCode(() => operandFromBoundInput(fact, NODE, EXPECTED)), "binding_variant_mismatch");
});
