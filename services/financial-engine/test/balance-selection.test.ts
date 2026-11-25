// Net cash and total debt leave out a balance only when no filing reported it
// for that period (ADR 0006, #602). A candidate selection filters out, such as
// a restatement under as_reported or a fact not yet public at the cutoff,
// blocks the figure: leaving it out would understate its side. So does a
// balance the 10-K for the year before reported: the store may have missed
// this year's line (#792).

import assert from "node:assert/strict";
import test from "node:test";
import type { ReasonCode, ReportedMetricNode } from "../../financial-core/src/index.ts";
import { aapl, FY2026, gapOf, publish, valueOf } from "../../financial-core/test/balance-fixtures.ts";
import type { InputCandidate } from "../src/ports.ts";
import { selectInput, type SelectionPolicy } from "../src/select-inputs.ts";

const HASH = "a".repeat(64);
const POLICY: SelectionPolicy = { knowledge_cutoff: "2026-11-09T23:59:59.999-05:00", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] };
const balanceNode = (metric: string): ReportedMetricNode => ({
  node_id: metric, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: metric, period: FY2026,
});
const COMMERCIAL_PAPER = balanceNode("commercial_paper");

type Spec = {
  relation?: "original" | "economic_restatement" | "unverified_restatement";
  fiscalYear?: number;
  publishedLocalDate?: string;
  metric?: string;
  value?: string;
  end?: string;
  /** Ingestion records a balance's context only from a 10-K. */
  form?: "10-K" | "10-Q";
};

function commercialPaper({
  relation = "original", fiscalYear = 2026, publishedLocalDate = "2026-11-03", metric = "commercial_paper", value = "1997000000", end = `${fiscalYear}-09-26`, form = "10-K",
}: Spec = {}): InputCandidate {
  const id = `00000000-0000-4000-8000-${relation === "original" ? "000000000001" : "000000000002"}`;
  return {
    fact_id: id,
    source_id: "11111111-1111-4111-8111-111111111111",
    source_class: "sec_filing",
    source_version_hash: HASH,
    metric_key: metric,
    period: { start: end, end, fiscal_year: fiscalYear, fiscal_period: "FY" },
    value_text: value,
    scale_text: "1",
    unit: { kind: "currency", currency: "USD" },
    method: relation === "original" ? "reported" : "restated",
    verification_status: "authoritative",
    coverage_level: "full",
    reported_at: `${publishedLocalDate}T00:00:00.000Z`,
    observed_at: "2026-11-09T15:00:00.000Z",
    supersedes: relation === "original" ? null : "00000000-0000-4000-8000-0000000000ff",
    superseded_by: null,
    context: form === "10-Q" ? null : {
      period_type: "instant",
      dimension_scope: "consolidated",
      dimension_members: [],
      adjustment_basis: "unadjusted",
      share_basis: "not_applicable",
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: relation,
    },
    precision: { precision_attestation_id: `p-${id}`, precision_class: "source_token_preserved", raw_token: value, token_proof_hash: HASH, source_locator: "loc", derivation: null },
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

test("a balance with no candidate for its fiscal year, which no 10-K reported the year before, is left out of both figures", () => {
  // 80.111B of debt less 1.997B of commercial paper, and 56.824B of net cash plus it.
  const absent = { reason: "missing_input", net_cash: "58821000000", total_debt: "78114000000" };
  assert.deepEqual(figures([]), absent);
  assert.deepEqual(figures([commercialPaper({ fiscalYear: 2024 })]), absent);
  // A 10-Q's balance is stored labelled FY of its fiscal year, without a context.
  assert.deepEqual(figures([commercialPaper({ fiscalYear: 2025, form: "10-Q" })]), absent);
});

test("a balance the 10-K for the year before reported, with none for its fiscal year, blocks both figures (#792)", () => {
  assert.deepEqual(figures([commercialPaper({ fiscalYear: 2025 })]), { reason: "absence_unverified", net_cash: BLOCKED, total_debt: BLOCKED });
});

// NVDA's FY2026 10-K (0001045810-26-000021) tags its 51.951B of marketable
// securities nvda:MarketableSecuritiesAndEquitySecuritiesFVNI, a company
// concept SEC companyfacts does not carry, so the store holds none. Its FY2025
// 10-K tagged 34.621B MarketableSecuritiesCurrent and zero commercial paper,
// and its FY2026 10-K tags no commercial paper.
test("NVDA FY2026: lines its FY2025 10-K reported block both figures, not a net cash of 2.137B (#792)", () => {
  const reasons: Record<string, ReasonCode> = {};
  for (const candidate of [
    commercialPaper({ metric: "marketable_securities_current", value: "34621000000", fiscalYear: 2025, end: "2025-01-26" }),
    commercialPaper({ metric: "commercial_paper", value: "0", fiscalYear: 2025, end: "2025-01-26" }),
  ]) {
    const selection = selectInput(balanceNode(candidate.metric_key), [candidate], POLICY);
    assert.ok(selection.status === "gap", candidate.metric_key);
    reasons[candidate.metric_key] = selection.reason_code;
  }
  assert.deepEqual(reasons, { marketable_securities_current: "absence_unverified", commercial_paper: "absence_unverified" });
  // Cash and equivalents 10.605B, long-term debt 0.999B current and 7.469B noncurrent.
  const results = publish(aapl(reasons, { cash_and_equivalents: "10605000000", long_term_debt_current: "999000000", long_term_debt_noncurrent: "7469000000" }));
  assert.deepEqual([gapOf(results.net_cash), gapOf(results.total_debt)], [BLOCKED, BLOCKED]);
});
