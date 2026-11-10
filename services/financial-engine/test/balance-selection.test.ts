// Net cash and total debt leave out a balance only when no filing reported it
// for that period (ADR 0006, #602). A candidate selection filters out, such as
// a restatement under as_reported or a fact not yet public at the cutoff,
// blocks the figure: leaving it out would understate its side.

import assert from "node:assert/strict";
import test from "node:test";
import type { ReportedMetricNode } from "../../financial-core/src/index.ts";
import { aapl, FY2026, gapOf, publish, valueOf } from "../../financial-core/test/balance-fixtures.ts";
import type { InputCandidate } from "../src/ports.ts";
import { selectInput, type SelectionPolicy } from "../src/select-inputs.ts";

const HASH = "a".repeat(64);
const POLICY: SelectionPolicy = { knowledge_cutoff: "2026-11-09T23:59:59.999-05:00", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] };
const COMMERCIAL_PAPER: ReportedMetricNode = {
  node_id: "commercial_paper", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "commercial_paper", period: FY2026,
};

type Spec = { relation?: "original" | "economic_restatement" | "unverified_restatement"; fiscalYear?: number; publishedLocalDate?: string };

function commercialPaper({ relation = "original", fiscalYear = 2026, publishedLocalDate = "2026-11-03" }: Spec = {}): InputCandidate {
  const id = `00000000-0000-4000-8000-${relation === "original" ? "000000000001" : "000000000002"}`;
  return {
    fact_id: id,
    source_id: "11111111-1111-4111-8111-111111111111",
    source_class: "sec_filing",
    source_version_hash: HASH,
    metric_key: "commercial_paper",
    period: { start: `${fiscalYear}-09-26`, end: `${fiscalYear}-09-26`, fiscal_year: fiscalYear, fiscal_period: "FY" },
    value_text: "1997000000",
    scale_text: "1",
    unit: { kind: "currency", currency: "USD" },
    method: relation === "original" ? "reported" : "restated",
    verification_status: "authoritative",
    coverage_level: "full",
    reported_at: `${publishedLocalDate}T00:00:00.000Z`,
    observed_at: "2026-11-09T15:00:00.000Z",
    supersedes: relation === "original" ? null : "00000000-0000-4000-8000-0000000000ff",
    superseded_by: null,
    context: {
      period_type: "instant",
      dimension_scope: "consolidated",
      dimension_members: [],
      adjustment_basis: "unadjusted",
      share_basis: "not_applicable",
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: relation,
    },
    precision: { precision_attestation_id: `p-${id}`, precision_class: "source_token_preserved", raw_token: "1997000000", token_proof_hash: HASH, source_locator: "loc", derivation: null },
    publication: [{
      attestation_id: `a-${id}`,
      timing: { available_not_before: null, available_no_later_than: `${publishedLocalDate}T00:00:00-05:00`, timing_precision: "date", source_timezone: "America/New_York" },
    }],
  };
}

/** Commercial paper's selection from these candidates, and the two figures with every other balance AAPL's. */
function figures(candidates: InputCandidate[]) {
  const selection = selectInput(COMMERCIAL_PAPER, candidates, POLICY);
  assert.equal(selection.status, "gap", "commercial paper is never bound here");
  const reason = selection.status === "gap" ? selection.reason_code : "missing_input";
  const results = publish(aapl({ commercial_paper: reason }));
  const outcome = (result: (typeof results)[string]) => result?.payload.kind === "value" ? valueOf(result) : gapOf(result);
  return { reason, net_cash: outcome(results.net_cash), total_debt: outcome(results.total_debt) };
}

const BLOCKED = ["blocked_dependency", "blocked_by_dependency"];

test("the candidate an as_reported 10-K figure would bind is selectable", () => {
  const selection = selectInput(COMMERCIAL_PAPER, [commercialPaper()], POLICY);
  assert.deepEqual(selection.status === "selected" && selection.input.candidate.fact_id, "00000000-0000-4000-8000-000000000001");
});

test("a balance reported only as a restatement blocks both figures under as_reported", () => {
  for (const relation of ["economic_restatement", "unverified_restatement"] as const) {
    assert.deepEqual(figures([commercialPaper({ relation })]), { reason: "ineligible_input", net_cash: BLOCKED, total_debt: BLOCKED }, relation);
  }
});

test("a balance no filing made public by the cutoff blocks both figures", () => {
  assert.deepEqual(figures([commercialPaper({ publishedLocalDate: "2026-12-01" })]), { reason: "ineligible_input", net_cash: BLOCKED, total_debt: BLOCKED });
});

test("a balance with no candidate for its fiscal year is left out of both figures", () => {
  // 80.111B of debt less 1.997B of commercial paper, and 56.824B of net cash plus it.
  const absent = { reason: "missing_input", net_cash: "58821000000", total_debt: "78114000000" };
  assert.deepEqual(figures([]), absent);
  assert.deepEqual(figures([commercialPaper({ fiscalYear: 2025 })]), absent);
});
