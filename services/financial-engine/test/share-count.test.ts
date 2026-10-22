// An instant share count, a filing's cover-page count as of its own date S
// (#444), binds only while it is the latest filing's, restated from S to the
// listing's reference date, and is a gap when a split falls near S.

import assert from "node:assert/strict";
import test from "node:test";
import type { RecordedSplit, ReportedMetricNode } from "../../financial-core/src/index.ts";
import type { InputCandidate, SplitHistory } from "../src/ports.ts";
import { boundBasis, selectInput, sharedLatestPeriods } from "../src/select-inputs.ts";

const LISTING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HASH = "a".repeat(64);

type Filing = { serial: string; fiscal_year: number; fiscal_period: "FY" | "Q1" | "Q2"; count_date: string; filed: string; shares: string };
// NVDA's cover counts as companyfacts lists them.
const K24: Filing = { serial: "1", fiscal_year: 2024, fiscal_period: "FY", count_date: "2024-02-16", filed: "2024-02-21", shares: "2500000000" };
const Q1: Filing = { serial: "2", fiscal_year: 2025, fiscal_period: "Q1", count_date: "2024-05-24", filed: "2024-05-29", shares: "2460000000" };
const Q2: Filing = { serial: "3", fiscal_year: 2025, fiscal_period: "Q2", count_date: "2024-08-23", filed: "2024-08-28", shares: "24530000000" };

/** A filing's cover count, certified as filed on its own date and public at the end of its filing day. */
function cover(filing: Filing, overrides: Partial<InputCandidate> = {}): InputCandidate {
  return {
    fact_id: `00000000-0000-4000-8000-00000000000${filing.serial}`,
    source_id: `11111111-1111-4111-8111-11111111111${filing.serial}`,
    source_class: "sec_filing",
    source_version_hash: HASH,
    metric_key: "shares_outstanding",
    period: { start: null, end: filing.count_date, fiscal_year: filing.fiscal_year, fiscal_period: filing.fiscal_period },
    value_text: filing.shares,
    scale_text: "1",
    unit: { kind: "shares" },
    method: "reported",
    verification_status: "authoritative",
    coverage_level: "full",
    reported_at: `${filing.filed}T00:00:00.000Z`,
    observed_at: "2026-10-01T00:00:00.000Z",
    supersedes: null,
    superseded_by: null,
    context: {
      period_type: "instant",
      dimension_scope: "consolidated",
      dimension_members: [],
      adjustment_basis: "as_filed",
      as_filed_on: filing.count_date,
      share_basis: "not_applicable",
      fiscal_calendar_version: "sec_filer_fiscal_year.v1",
      disclosure_relation: "original",
    },
    precision: { precision_attestation_id: `p-${filing.serial}`, precision_class: "source_token_preserved", raw_token: filing.shares, token_proof_hash: HASH, source_locator: "loc" },
    publication: [{
      attestation_id: `a-${filing.serial}`,
      timing: { available_not_before: null, available_no_later_than: `${filing.filed}T23:00:00.000Z`, timing_precision: "instant", source_timezone: "UTC" },
    }],
    ...overrides,
  };
}

const node = (period: ReportedMetricNode["period"]): ReportedMetricNode => ({
  node_id: "shares",
  operation: "reported_metric",
  operation_version: "reported_metric.v1",
  subject_slot: "a",
  metric_key: "shares_outstanding",
  period,
});
const LATEST = node({ kind: "latest", period_type: "quarterly", offset: 0 });

// NVDA's splits: 4-for-1 on 2021-07-20 and 10-for-1 on 2024-06-10.
const NVDA_SPLITS: RecordedSplit[] = [
  { execution_date: "2021-07-20", split_from: "1", split_to: "4" },
  { execution_date: "2024-06-10", split_from: "1", split_to: "10" },
];
const history = (splits: RecordedSplit[]): SplitHistory =>
  ({ status: "ok", listing_id: LISTING, timezone: "America/New_York", checked_at: "2026-10-01T12:00:00.000Z", splits });

/** The bound count's restatement, or the slot's gap. */
function bound(cutoff: string, candidates: InputCandidate[], options: { at?: ReportedMetricNode; splits?: RecordedSplit[] } = {}) {
  const selection = selectInput(options.at ?? LATEST, candidates, { knowledge_cutoff: cutoff, reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] });
  if (selection.status === "gap") return selection.reason_code;
  const basis = boundBasis(selection.input, history(options.splits ?? NVDA_SPLITS), cutoff);
  if (basis.status !== "restated") return basis.status === "gap" ? basis.reason_code : basis.status;
  const { as_filed_on, splits, adjusted_native_value } = basis.split_adjustment;
  return { fact_id: selection.input.candidate.fact_id, as_filed_on, splits: splits.map((split) => split.execution_date), shares: adjusted_native_value.numerator };
}

const Q1_BOUND = (shares: string, splits: string[]) => ({ fact_id: cover(Q1).fact_id, as_filed_on: "2024-05-24", splits, shares });

test("a count dated before the 2024-06-10 split binds after it multiplied by 10, restated from its own date", () => {
  const selection = selectInput(LATEST, [cover(K24), cover(Q1)], { knowledge_cutoff: "2024-07-01T16:00:00.000Z", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] });
  assert.equal(selection.status, "selected");
  assert.deepEqual(selection.status === "selected" && boundBasis(selection.input, history(NVDA_SPLITS), "2024-07-01T16:00:00.000Z"), {
    status: "restated",
    split_adjustment: {
      version: "split_adjustment.v2",
      as_filed_on: "2024-05-24",
      reference_date: "2024-07-01",
      listing_id: LISTING,
      listing_timezone: "America/New_York",
      splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }],
      factor: { numerator: "10", denominator: "1" },
      adjusted_native_value: { numerator: "24600000000", denominator: "1" },
    },
  });
  assert.deepEqual(bound("2024-03-01T16:00:00.000Z", [cover(K24), cover(Q1)]), {
    fact_id: cover(K24).fact_id, as_filed_on: "2024-02-16", splits: [], shares: "2500000000",
  }, "before the 10-Q is filed, the 10-K's count binds as it stands");
});

test("a split within a week of the count's date, or after it and by the filing date, is a gap", () => {
  const cutoff = "2024-07-01T16:00:00.000Z";
  const splitOn = (date: string) => bound(cutoff, [cover(Q1)], { splits: [{ execution_date: date, split_from: "1", split_to: "10" }] });
  assert.deepEqual(
    ["2024-05-16", "2024-05-17", "2024-05-28", "2024-05-31", "2024-06-01"].map(splitOn),
    [Q1_BOUND("2460000000", []), "incompatible_basis", "incompatible_basis", "incompatible_basis", Q1_BOUND("24600000000", ["2024-06-01"])],
  );
  // Filed after the 2024-06-10 split, the 10-Q's statements would be on the split basis and its count, dated 2024-05-24, would not.
  const filedAfterSplit = cover(Q1, { reported_at: "2024-06-14T00:00:00.000Z" });
  assert.equal(bound(cutoff, [filedAfterSplit]), "incompatible_basis");
});

test("a count that is not the latest filing's, or is dated more than 130 days before the cutoff, is stale", () => {
  const cutoff = "2024-07-01T16:00:00.000Z";
  const both = [cover(K24), cover(Q1)];
  assert.deepEqual([
    bound(cutoff, both, { at: node({ kind: "fiscal_period", fiscal_year: 2024, fiscal_period: "FY" }) }),
    bound(cutoff, both, { at: node({ kind: "latest", period_type: "annual", offset: 0 }) }),
    bound(cutoff, both, { at: node({ kind: "latest", period_type: "quarterly", offset: 1 }) }),
    bound(cutoff, both, { at: node({ kind: "fiscal_period", fiscal_year: 2025, fiscal_period: "Q1" }) }),
    bound(cutoff, both, { at: node({ kind: "fiscal_period", fiscal_year: 2025, fiscal_period: "Q2" }) }),
  ], ["stale_input", Q1_BOUND("24600000000", ["2024-06-10"]), "stale_input", Q1_BOUND("24600000000", ["2024-06-10"]), "missing_input"]);
  // With the Q2 10-Q not on file, the Q1 count dated 2024-05-24 is 130 days old on 2024-10-01 and 131 the day after.
  assert.deepEqual(
    [bound("2024-10-01T16:00:00.000Z", both), bound("2024-10-02T16:00:00.000Z", both)],
    [Q1_BOUND("24600000000", ["2024-06-10"]), "stale_input"],
  );
});

test("the latest filing's count that cannot bind is a gap, never an older filing's count", () => {
  const cutoff = "2024-09-15T16:00:00.000Z";
  const counts = [cover(K24), cover(Q1)];
  assert.deepEqual(bound(cutoff, counts), Q1_BOUND("24600000000", ["2024-06-10"]));
  // A filing listing two counts stores one, as partial coverage with no context.
  assert.equal(bound(cutoff, [...counts, cover(Q2, { coverage_level: "partial", context: null })]), "incompatible_scope");
  // Filed by the cutoff, but proven public only by a fetch after it.
  const fetchedLater = cover(Q2, { publication: [{ attestation_id: "a-3", timing: { available_not_before: null, available_no_later_than: "2026-10-01T15:00:00.000Z", timing_precision: "instant", source_timezone: "UTC" } }] });
  assert.equal(bound(cutoff, [...counts, fetchedLater]), "missing_input");
  // From a source the authority does not allow (#444).
  assert.equal(bound(cutoff, [...counts, cover(Q2, { source_class: null })]), "source_class_not_allowed");
});

test("a share count resolves its latest filing apart from the plan's statement periods", () => {
  const eps: ReportedMetricNode = { ...node({ kind: "latest", period_type: "annual", offset: 0 }), node_id: "eps", metric_key: "eps_diluted" };
  const shares = node({ kind: "latest", period_type: "annual", offset: 0 });
  const fy2024Eps: InputCandidate = {
    ...cover(K24),
    fact_id: "00000000-0000-4000-8000-000000000009",
    metric_key: "eps_diluted",
    period: { start: "2023-01-30", end: "2024-01-28", fiscal_year: 2024, fiscal_period: "FY" },
    value_text: "11.93",
    unit: { kind: "currency_per_share", currency: "USD" },
  };
  const policy = { knowledge_cutoff: "2024-03-01T16:00:00.000Z", reporting_basis: "as_reported" as const, max_age_days: null, allowed_source_classes: ["sec_filing" as const] };
  assert.deepEqual([...sharedLatestPeriods([{ node: eps, candidates: [fy2024Eps] }, { node: shares, candidates: [cover(K24)] }], policy)], [
    ["eps", { kind: "fiscal_period", fiscal_year: 2024, fiscal_period: "FY" }],
  ]);
});
