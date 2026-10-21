import assert from "node:assert/strict";
import type { BoundFactInputV1, BoundPriceInputV1, FinancialUnit, FiscalPeriod, SplitAdjustmentV2, SubjectSlot } from "../src/contracts.ts";
import type { MetricValueKind } from "../src/definitions.ts";
import { parseFinancialDecimal } from "../src/exact-decimal.ts";
import { operandFromBoundInput, type FinancialOperand } from "../src/operations.ts";
import { rationalFromDecimal } from "../src/rational.ts";
import { restateToReference, type RecordedSplit } from "../src/split-adjustment.ts";
import { validateBoundInput } from "../src/validate.ts";
import { ISSUER_A, ISSUER_B } from "./fixtures.ts";

const HASH = "c".repeat(64);
let factCounter = 0;

export const SLOTS: Record<"a" | "b" | "c", SubjectSlot> = {
  a: { slot_id: "a", subject_ref: { kind: "issuer", id: ISSUER_A }, display_order: 0, role: "primary" },
  b: { slot_id: "b", subject_ref: { kind: "issuer", id: ISSUER_B }, display_order: 1, role: "peer" },
  c: { slot_id: "c", subject_ref: { kind: "issuer", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, display_order: 2, role: "peer" },
};

export type InputSpec = {
  slot?: keyof typeof SLOTS;
  metric: string;
  value: string;
  scale?: string;
  native?: string;
  start?: string | null;
  end: string;
  kind?: "duration" | "instant";
  fiscal_year?: number;
  fiscal_period?: FiscalPeriod;
  unit?: FinancialUnit;
  scope?: "consolidated" | "segment";
  members?: Array<{ axis: string; member: string }>;
  reporting?: "as_reported" | "as_restated";
  adjustment?: "unadjusted" | "split_adjusted";
  /** Binds the input split-adjusted with this adjustment. */
  split_adjustment?: SplitAdjustmentV2;
  share_basis?: "basic" | "diluted" | "not_applicable";
  calendar_version?: string;
  definition_version?: string;
};

const USD: FinancialUnit = { kind: "currency", currency: "USD" };

export function boundInput(spec: InputSpec): BoundFactInputV1 {
  factCounter += 1;
  const slot = SLOTS[spec.slot ?? "a"];
  const suffix = String(factCounter).padStart(12, "0");
  return {
    schema_version: "financial_bound_input.v1",
    input_slot: `${spec.slot ?? "a"}_${spec.metric}_${factCounter}`,
    fact_id: `dddddddd-dddd-4ddd-8ddd-${suffix}`,
    subject_ref: slot.subject_ref,
    metric: { metric_key: spec.metric, definition_version: spec.definition_version ?? `${spec.metric}.v1` },
    source: { source_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", document_id: null, source_version_hash: HASH, locator: null },
    numeric: {
      raw_token: spec.value,
      token_proof_hash: HASH,
      value: spec.value,
      scale: spec.scale ?? "1",
      native_value: spec.native ?? spec.value,
    },
    unit: spec.unit ?? USD,
    period: {
      kind: spec.kind ?? "duration",
      start: spec.kind === "instant" ? null : (spec.start ?? null),
      end: spec.end,
      fiscal_year: spec.fiscal_year ?? Number(spec.end.slice(0, 4)),
      fiscal_period: spec.fiscal_period ?? "FY",
      calendar_version: spec.calendar_version ?? "fiscal-calendar.v1",
    },
    dimensions: { scope: spec.scope ?? "consolidated", members: spec.members ?? [] },
    basis: {
      reporting: spec.reporting ?? "as_reported",
      adjustment: spec.split_adjustment ? "split_adjusted" : (spec.adjustment ?? "unadjusted"),
      share_basis: spec.share_basis ?? "not_applicable",
    },
    ...(spec.split_adjustment ? { split_adjustment: spec.split_adjustment } : {}),
    publication: {
      attestation_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      available_no_later_than: "2024-01-10T23:59:59.999-05:00",
      precision: "date",
      source_timezone: "America/New_York",
    },
    observed_at: "2024-02-01T00:00:00Z",
    precision_status: "source_token_preserved",
    eligibility: { selection_policy_version: "selection.v1", promotion_status: "authoritative", candidate_set_digest: HASH },
  };
}

/** Builds an operand through the production reported_metric path. */
export function operand(nodeId: string, spec: InputSpec): FinancialOperand {
  const input = boundInput(spec);
  const outcome = operandFromBoundInput(
    input,
    {
      node_id: nodeId,
      operation: "reported_metric",
      operation_version: "reported_metric.v1",
      subject_slot: spec.slot ?? "a",
      metric_key: spec.metric,
      period: { kind: "fiscal_period", fiscal_year: input.period.fiscal_year, fiscal_period: input.period.fiscal_period },
    },
    { slot: SLOTS[spec.slot ?? "a"], definition_version: `${spec.metric}.v1`, knowledge_cutoff: KNOWLEDGE_CUTOFF, reporting_basis: "as_reported" },
  );
  assert.ok(outcome.ok, `operand ${nodeId}: ${JSON.stringify(!outcome.ok && outcome)}`);
  return (outcome as { operand: FinancialOperand }).operand;
}

/** The cutoff operands are evaluated at, and the reference date it is in New York, where their listings trade. */
export const KNOWLEDGE_CUTOFF = "2025-03-01T12:00:00.000Z";
export const REFERENCE_DATE = "2025-03-01";

export const LISTING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// NVDA's 2024-06-10 split as Polygon lists it: each share became ten.
export const NVDA_SPLITS: RecordedSplit[] = [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }];
/** A cutoff whose reference date R is 2024-06-11 in New York, after NVDA's split. */
export const SPLIT_CUTOFF = "2024-06-11T20:30:00.000Z";

/** `value`, on the split basis of `asFiledOn`, restated by NVDA's split to 2024-06-11 on `listing`. */
export function splitAdjustment(value: string, valueKind: MetricValueKind, asFiledOn: string, listing = LISTING): SplitAdjustmentV2 {
  const parsed = parseFinancialDecimal(value);
  assert.ok(parsed.ok);
  const outcome = restateToReference({
    native: rationalFromDecimal(parsed.value)!, value_kind: valueKind, as_filed_on: asFiledOn, reference_date: "2024-06-11",
    listing_id: listing, listing_timezone: "America/New_York", splits: NVDA_SPLITS,
  });
  if (!outcome.ok) return assert.fail(outcome.reason);
  return outcome.adjustment;
}

/** Subject a's session close of `tradeDate`, observed at 16:00 New York time and known a quarter hour later. */
export function priceInput(token: string, value: string, tradeDate: string, overrides: Partial<BoundPriceInputV1> = {}): BoundPriceInputV1 {
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
    split_adjustment: splitAdjustment(value, "price", tradeDate),
    eligibility: { selection_policy_version: "price-at-cutoff-selection.v1", candidate_set_digest: "e".repeat(64) },
    ...overrides,
  });
  if (!validated.ok) return assert.fail(JSON.stringify(validated.issues));
  assert.ok(validated.value.schema_version === "financial_bound_price_input.v1");
  return validated.value;
}

/** FY2023 calendar-year duration. */
export const FY2023 = { start: "2023-01-01", end: "2023-12-31", fiscal_year: 2023, fiscal_period: "FY" as const };
export const FY2022 = { start: "2022-01-01", end: "2022-12-31", fiscal_year: 2022, fiscal_period: "FY" as const };
