import assert from "node:assert/strict";
import test from "node:test";
import type { ReportedMetricNode } from "../../financial-core/src/index.ts";
import type { InputCandidate, SplitHistory } from "../src/ports.ts";
import { boundBasis, selectInput, type BoundBasis, type SelectedInput } from "../src/select-inputs.ts";

const LISTING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HASH = "a".repeat(64);
const EPS_FY2024: ReportedMetricNode = {
  node_id: "eps",
  operation: "reported_metric",
  operation_version: "reported_metric.v1",
  subject_slot: "a",
  metric_key: "eps_diluted",
  period: { kind: "fiscal_period", fiscal_year: 2024, fiscal_period: "FY" },
};

/** NVDA's FY2024 10-K diluted EPS, as filed on 2024-02-21 and public that day. */
function eps(context: Partial<NonNullable<InputCandidate["context"]>> = {}): InputCandidate {
  return {
    fact_id: "00000000-0000-4000-8000-000000000001",
    source_id: "11111111-1111-4111-8111-111111111111",
    source_version_hash: HASH,
    metric_key: "eps_diluted",
    period: { start: "2023-01-30", end: "2024-01-28", fiscal_year: 2024, fiscal_period: "FY" },
    value_text: "11.93",
    scale_text: "1",
    unit: { kind: "currency_per_share", currency: "USD" },
    method: "reported",
    verification_status: "authoritative",
    reported_at: null,
    observed_at: "2026-10-01T00:00:00.000Z",
    supersedes: null,
    superseded_by: null,
    context: {
      period_type: "duration",
      dimension_scope: "consolidated",
      dimension_members: [],
      adjustment_basis: "as_filed",
      as_filed_on: "2024-02-21",
      share_basis: "diluted",
      fiscal_calendar_version: "sec_filer_fiscal_year.v1",
      disclosure_relation: "original",
      ...context,
    } as NonNullable<InputCandidate["context"]>,
    precision: { precision_attestation_id: "p-1", precision_class: "source_token_preserved", raw_token: "11.93", token_proof_hash: HASH, source_locator: "loc" },
    publication: [{
      attestation_id: "a-1",
      timing: { available_not_before: null, available_no_later_than: "2024-02-21T00:00:00-05:00", timing_precision: "date", source_timezone: "America/New_York" },
    }],
  };
}

const NVDA_HISTORY: SplitHistory = {
  status: "ok",
  listing_id: LISTING,
  timezone: "America/New_York",
  checked_at: "2026-10-01T12:00:00.000Z",
  splits: [
    { execution_date: "2021-07-20", split_from: "1", split_to: "4" },
    { execution_date: "2024-06-10", split_from: "1", split_to: "10" },
    { execution_date: "2026-11-02", split_from: "1", split_to: "2" },
  ],
};

function selected(candidate: InputCandidate, cutoff: string): SelectedInput {
  const selection = selectInput(EPS_FY2024, [candidate], { knowledge_cutoff: cutoff, reporting_basis: "as_reported", max_age_days: null });
  if (selection.status !== "selected") return assert.fail(selection.reason_code);
  return selection.input;
}

function basisAt(cutoff: string, history: SplitHistory | undefined, candidate = eps()): BoundBasis {
  return boundBasis(selected(candidate, cutoff), history, cutoff);
}

test("an as-filed EPS binds restated to its listing's reference date, ignoring splits outside it", () => {
  assert.deepEqual(basisAt("2025-01-01T12:00:00.000Z", NVDA_HISTORY), {
    status: "restated",
    split_adjustment: {
      version: "split_adjustment.v2",
      as_filed_on: "2024-02-21",
      reference_date: "2025-01-01",
      listing_id: LISTING,
      listing_timezone: "America/New_York",
      splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }],
      factor: { numerator: "10", denominator: "1" },
      adjusted_native_value: { numerator: "1193", denominator: "1000" },
    },
  });
  const before = basisAt("2024-05-01T12:00:00.000Z", NVDA_HISTORY);
  assert.equal(before.status, "restated");
  assert.deepEqual(before.status === "restated" && [before.split_adjustment.splits, before.split_adjustment.adjusted_native_value], [[], { numerator: "1193", denominator: "100" }]);
});

test("an unknown split history is a named gap, never the value as filed", () => {
  const cutoff = "2025-01-01T12:00:00.000Z";
  assert.deepEqual(basisAt(cutoff, { status: "gap", reason_code: "split_history_missing" }), { status: "gap", reason_code: "split_history_missing" });
  assert.deepEqual(basisAt(cutoff, { status: "gap", reason_code: "split_listing_unresolved" }), { status: "gap", reason_code: "split_listing_unresolved" });
  // The reference date and the fetch are dated in New York, where 2025-01-01 starts at 05:00 UTC.
  assert.deepEqual(basisAt(cutoff, { ...NVDA_HISTORY, checked_at: "2025-01-01T04:59:59.000Z" }), { status: "gap", reason_code: "split_history_stale" });
  assert.deepEqual(basisAt(cutoff, { ...NVDA_HISTORY, checked_at: "2025-01-01T05:00:00.000Z" }).status, "restated");
});

test("an unadjusted value binds as stored; a split-adjusted one, which names no reference date, does not bind", () => {
  const unadjusted = eps({ adjustment_basis: "unadjusted", as_filed_on: undefined });
  assert.deepEqual(basisAt("2025-01-01T12:00:00.000Z", undefined, unadjusted), { status: "unadjusted" });
  const splitAdjusted = eps({ adjustment_basis: "split_adjusted", as_filed_on: undefined });
  assert.deepEqual(basisAt("2025-01-01T12:00:00.000Z", NVDA_HISTORY, splitAdjusted), { status: "gap", reason_code: "context_unverified" });
});
