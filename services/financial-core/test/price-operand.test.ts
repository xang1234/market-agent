import assert from "node:assert/strict";
import test from "node:test";
import type { BoundPriceInputV1, ReportedMetricNode, SplitAdjustmentV2 } from "../src/contracts.ts";
import { parseFinancialDecimal } from "../src/exact-decimal.ts";
import { FinancialIntegrityError, operandFromBoundInput } from "../src/operations.ts";
import { rationalFromDecimal } from "../src/rational.ts";
import { restateToReference, type RecordedSplit } from "../src/split-adjustment.ts";
import { validateBoundInput } from "../src/validate.ts";
import { boundInput, SLOTS } from "./operand-fixtures.ts";

const LISTING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_YORK = "America/New_York";
// NVDA's 2024-06-10 split as Polygon lists it: each share became ten.
const SPLITS: RecordedSplit[] = [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }];
// The reference date R is 2024-06-11 in New York, after the split.
const CUTOFF = "2024-06-11T20:30:00.000Z";
const NODE: ReportedMetricNode = {
  node_id: "px", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "share_price", period: { kind: "at_cutoff" },
};
const EXPECTED = { slot: SLOTS.a, definition_version: "share_price.v1", knowledge_cutoff: CUTOFF, reporting_basis: "as_reported" as const };

function adjustment(price: string, tradeDate: string): SplitAdjustmentV2 {
  const parsed = parseFinancialDecimal(price);
  assert.ok(parsed.ok);
  const outcome = restateToReference({
    native: rationalFromDecimal(parsed.value)!, value_kind: "price", as_filed_on: tradeDate, reference_date: "2024-06-11",
    listing_id: LISTING, listing_timezone: NEW_YORK, splits: SPLITS,
  });
  if (!outcome.ok) return assert.fail(outcome.reason);
  return outcome.adjustment;
}

/** A session close of `tradeDate`, observed at 16:00 New York time and known a quarter hour later. */
function priceInput(token: string, value: string, tradeDate: string, overrides: Partial<BoundPriceInputV1> = {}): BoundPriceInputV1 {
  const validated = validateBoundInput({
    schema_version: "financial_bound_price_input.v1",
    input_slot: "px",
    observation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    subject_ref: SLOTS.a.subject_ref,
    metric: { metric_key: "share_price", definition_version: "share_price.v1" },
    listing_id: LISTING,
    source: { source_id: "00000000-0000-4000-a000-000000000009", body_sha256: "d".repeat(64) },
    observation_kind: "session_close",
    numeric: { raw_token: token, value },
    unit: { kind: "currency_per_share", currency: "USD" },
    observed_at: `${tradeDate}T20:00:00.000Z`,
    known_at: `${tradeDate}T20:15:00.000Z`,
    split_adjustment: adjustment(value, tradeDate),
    eligibility: { selection_policy_version: "price-at-cutoff-selection.v1", candidate_set_digest: "e".repeat(64) },
    ...overrides,
  });
  if (!validated.ok) return assert.fail(JSON.stringify(validated.issues));
  assert.ok(validated.value.schema_version === "financial_bound_price_input.v1");
  return validated.value;
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
