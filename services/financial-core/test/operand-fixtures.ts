import assert from "node:assert/strict";
import type { BoundFinancialInputV1, FinancialUnit, FiscalPeriod, SubjectSlot } from "../src/contracts.ts";
import { operandFromBoundInput, type FinancialOperand } from "../src/operations.ts";
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
  share_basis?: "basic" | "diluted" | "not_applicable";
  calendar_version?: string;
  definition_version?: string;
};

const USD: FinancialUnit = { kind: "currency", currency: "USD" };

export function boundInput(spec: InputSpec): BoundFinancialInputV1 {
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
      adjustment: spec.adjustment ?? "unadjusted",
      share_basis: spec.share_basis ?? "not_applicable",
    },
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
    { slot: SLOTS[spec.slot ?? "a"], definition_version: `${spec.metric}.v1` },
  );
  assert.ok(outcome.ok, `operand ${nodeId}: ${JSON.stringify(!outcome.ok && outcome)}`);
  return (outcome as { operand: FinancialOperand }).operand;
}

/** FY2023 calendar-year duration. */
export const FY2023 = { start: "2023-01-01", end: "2023-12-31", fiscal_year: 2023, fiscal_period: "FY" as const };
export const FY2022 = { start: "2022-01-01", end: "2022-12-31", fiscal_year: 2022, fiscal_period: "FY" as const };
