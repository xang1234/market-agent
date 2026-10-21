import assert from "node:assert/strict";
import test from "node:test";
import type { ReportedMetricNode } from "../../financial-core/src/index.ts";
import type { InputCandidate } from "../src/ports.ts";
import { selectInput, sharedLatestPeriods, type SelectionPolicy } from "../src/select-inputs.ts";

let counter = 0;
const HASH = "a".repeat(64);

type CandidateSpec = {
  value?: string;
  year?: number;
  period?: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  start?: string;
  end?: string;
  publishedLocalDate?: string;
  filed?: string | null;
  publication?: InputCandidate["publication"];
  relation?: "original" | "economic_restatement" | "extraction_correction";
  precision?: InputCandidate["precision"];
  context?: InputCandidate["context"] | undefined;
  supersedes?: string | null;
  superseded_by?: string | null;
  id?: string;
};

function candidate(spec: CandidateSpec = {}): InputCandidate {
  counter += 1;
  const id = spec.id ?? `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  const year = spec.year ?? 2023;
  return {
    fact_id: id,
    source_id: "11111111-1111-4111-8111-111111111111",
    source_class: "sec_filing",
    source_version_hash: HASH,
    metric_key: "revenue",
    period: { start: spec.start ?? `${year}-01-01`, end: spec.end ?? `${year}-12-31`, fiscal_year: year, fiscal_period: spec.period ?? "FY" },
    value_text: spec.value ?? "100",
    scale_text: "1",
    unit: { kind: "currency", currency: "USD" },
    method: "reported",
    verification_status: "authoritative",
    coverage_level: "full",
    reported_at: spec.filed === undefined ? `${spec.publishedLocalDate ?? `${year + 1}-01-10`}T00:00:00.000Z` : spec.filed,
    observed_at: "2024-02-01T00:00:00.000Z",
    supersedes: spec.supersedes ?? null,
    superseded_by: spec.superseded_by ?? null,
    context:
      spec.context === undefined
        ? {
            period_type: "duration",
            dimension_scope: "consolidated",
            dimension_members: [],
            adjustment_basis: "unadjusted",
            share_basis: "not_applicable",
            fiscal_calendar_version: "fiscal-calendar.v1",
            disclosure_relation: spec.relation ?? "original",
          }
        : spec.context,
    precision:
      spec.precision === undefined
        ? { precision_attestation_id: `p-${id}`, precision_class: "source_token_preserved", raw_token: spec.value ?? "100", token_proof_hash: HASH, source_locator: "loc" }
        : spec.precision,
    publication: spec.publication ?? [
      {
        attestation_id: `a-${id}`,
        timing: {
          available_not_before: null,
          available_no_later_than: `${spec.publishedLocalDate ?? `${year + 1}-01-10`}T00:00:00-05:00`,
          timing_precision: "date",
          source_timezone: "America/New_York",
        },
      },
    ],
  };
}

const FY2023: ReportedMetricNode = {
  node_id: "a_rev",
  operation: "reported_metric",
  operation_version: "reported_metric.v1",
  subject_slot: "a",
  metric_key: "revenue",
  period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" },
};

function policy(overrides: Partial<SelectionPolicy> = {}): SelectionPolicy {
  return { knowledge_cutoff: "2024-01-15T23:59:59.999-05:00", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"], ...overrides };
}

function selectedId(result: ReturnType<typeof selectInput>): string {
  assert.equal(result.status, "selected", result.status === "gap" ? result.reason_code : "");
  return result.status === "selected" ? result.input.candidate.fact_id : "";
}

function gapReason(result: ReturnType<typeof selectInput>): string {
  assert.equal(result.status, "gap", result.status === "selected" ? result.input.candidate.fact_id : "");
  return result.status === "gap" ? result.reason_code : "";
}

test("public Jan 10 and ingested Feb 1 is eligible at a Jan 15 cutoff; a Jan 20 restatement is not", () => {
  const original = candidate({ value: "100", publishedLocalDate: "2024-01-10" });
  const restatement = candidate({ value: "90", publishedLocalDate: "2024-01-20", relation: "economic_restatement", supersedes: original.fact_id });
  assert.equal(selectedId(selectInput(FY2023, [original, restatement], policy())), original.fact_id);
  assert.equal(selectedId(selectInput(FY2023, [original, restatement], policy({ reporting_basis: "as_restated" }))), original.fact_id);
  // After the restatement is public: as_restated takes it, as_reported keeps the original.
  const later = policy({ knowledge_cutoff: "2024-01-25T00:00:00-05:00" });
  assert.equal(selectedId(selectInput(FY2023, [original, restatement], { ...later, reporting_basis: "as_restated" })), restatement.fact_id);
  assert.equal(selectedId(selectInput(FY2023, [original, restatement], later)), original.fact_id);
});

test("as_restated takes the restatement filed last, not the one proven public last", () => {
  const original = candidate({ value: "100", publishedLocalDate: "2024-01-10" });
  const older = candidate({ value: "95", filed: "2025-01-10T00:00:00.000Z", publishedLocalDate: "2026-03-01", relation: "economic_restatement", supersedes: original.fact_id });
  const newer = candidate({ value: "93", filed: "2026-01-10T00:00:00.000Z", publishedLocalDate: "2026-02-01", relation: "economic_restatement", supersedes: original.fact_id });
  const restated = (cutoff: string) => policy({ knowledge_cutoff: cutoff, reporting_basis: "as_restated" });
  assert.equal(selectedId(selectInput(FY2023, [original, older, newer], restated("2026-04-01T00:00:00Z"))), newer.fact_id);
  assert.equal(selectedId(selectInput(FY2023, [original, older, newer], restated("2026-02-15T00:00:00Z"))), newer.fact_id, "the older one is not public yet");
  const published = (candidateSpec: InputCandidate, localDate: string) => ({
    ...candidateSpec,
    publication: [{ ...candidateSpec.publication[0]!, timing: { ...candidateSpec.publication[0]!.timing, available_no_later_than: `${localDate}T00:00:00-05:00` } }],
  });
  assert.equal(
    selectedId(selectInput(FY2023, [original, published(older, "2025-01-10"), published(newer, "2026-01-10")], restated("2025-06-01T00:00:00Z"))),
    older.fact_id,
    "the newer one is not public yet",
  );
});

test("a corrected restatement ranks by the filing it corrects, not by when the correction was recorded (#337 review)", () => {
  const original = candidate({ value: "100", publishedLocalDate: "2024-01-10" });
  const older = candidate({ value: "95", filed: "2025-01-10T00:00:00.000Z", publishedLocalDate: "2025-01-10", relation: "economic_restatement", supersedes: original.fact_id });
  const correction = candidate({ value: "96", filed: "2026-03-01T00:00:00.000Z", publishedLocalDate: "2026-03-01", relation: "extraction_correction", supersedes: older.fact_id });
  const newer = candidate({ value: "93", filed: "2026-01-10T00:00:00.000Z", publishedLocalDate: "2026-01-10", relation: "economic_restatement", supersedes: original.fact_id });
  const restated = policy({ knowledge_cutoff: "2026-04-01T00:00:00Z", reporting_basis: "as_restated" });
  assert.equal(selectedId(selectInput(FY2023, [original, older, correction, newer], restated)), newer.fact_id);
});

test("a date-only publication is not assumed available earlier on the same day", () => {
  const onJan10 = candidate({ publishedLocalDate: "2024-01-10" });
  assert.equal(gapReason(selectInput(FY2023, [onJan10], policy({ knowledge_cutoff: "2024-01-10T12:00:00-05:00" }))), "missing_input");
  assert.equal(selectedId(selectInput(FY2023, [onJan10], policy({ knowledge_cutoff: "2024-01-10T23:59:59.999-05:00" }))), onJan10.fact_id);
});

test("without a proof for the fact's exact source version, timing is unknown", () => {
  assert.equal(gapReason(selectInput(FY2023, [candidate({ publication: [] })], policy())), "publication_time_unknown");
  const badZone = candidate({
    publication: [{ attestation_id: "x", timing: { available_not_before: null, available_no_later_than: "2024-01-10T00:00:00Z", timing_precision: "date", source_timezone: "Mars/Base" } }],
  });
  assert.equal(gapReason(selectInput(FY2023, [badZone], policy())), "publication_time_unknown");
});

test("unproven precision and missing financial context are gaps, not implicit defaults", () => {
  assert.equal(gapReason(selectInput(FY2023, [candidate({ precision: null })], policy())), "precision_unverified");
  const legacy = candidate({ precision: { precision_attestation_id: "p", precision_class: "legacy_unverified", raw_token: null, token_proof_hash: null, source_locator: null } });
  assert.equal(gapReason(selectInput(FY2023, [legacy], policy())), "precision_unverified");
  assert.equal(gapReason(selectInput(FY2023, [candidate({ context: null })], policy())), "context_unverified");
});

test("an extraction correction replaces the fact it corrects as the same disclosure", () => {
  const wrong = candidate({ value: "1000", publishedLocalDate: "2024-01-10" });
  const corrected = candidate({ value: "100", publishedLocalDate: "2024-01-10", relation: "extraction_correction", supersedes: wrong.fact_id });
  const linked = { ...wrong, superseded_by: corrected.fact_id };
  assert.equal(selectedId(selectInput(FY2023, [linked, corrected], policy())), corrected.fact_id);
});

test("equivalent duplicates tie-break stably; conflicting values are a conflict", () => {
  const first = candidate({ value: "100.0", id: "00000000-0000-4000-8000-00000000aaaa" });
  const second = candidate({ value: "100", id: "00000000-0000-4000-8000-00000000bbbb" });
  assert.equal(selectedId(selectInput(FY2023, [second, first], policy())), first.fact_id);
  const conflicting = candidate({ value: "101" });
  assert.equal(gapReason(selectInput(FY2023, [first, conflicting], policy())), "conflicting_evidence");
});

test("exact fiscal periods only: labels must match the requested period", () => {
  assert.equal(gapReason(selectInput(FY2023, [candidate({ year: 2022 })], policy())), "missing_input");
  const q1: ReportedMetricNode = { ...FY2023, period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "Q1" } };
  assert.equal(gapReason(selectInput(q1, [candidate()], policy())), "missing_input");
});

test("latest resolves at the cutoff, with offsets for prior periods", () => {
  const fy2022 = candidate({ year: 2022, publishedLocalDate: "2023-02-01" });
  const fy2023 = candidate({ year: 2023, publishedLocalDate: "2024-01-10" });
  const fy2024 = candidate({ year: 2024, publishedLocalDate: "2025-01-10" });
  const latest: ReportedMetricNode = { ...FY2023, period: { kind: "latest", period_type: "annual", offset: 0 } };
  assert.equal(selectedId(selectInput(latest, [fy2022, fy2023, fy2024], policy())), fy2023.fact_id);
  assert.equal(selectedId(selectInput({ ...latest, period: { kind: "latest", period_type: "annual", offset: 1 } }, [fy2022, fy2023, fy2024], policy())), fy2022.fact_id);
  assert.equal(gapReason(selectInput({ ...latest, period: { kind: "latest", period_type: "annual", offset: 2 } }, [fy2022, fy2023, fy2024], policy())), "missing_input");
  assert.equal(gapReason(selectInput({ ...latest, period: { kind: "latest", period_type: "quarterly", offset: 0 } }, [fy2023], policy())), "missing_input");
});

test("a plan's latest nodes name one period per subject: the newest any of them has eligible (#344)", () => {
  const latest = (nodeId: string, metric: string, slot = "a"): ReportedMetricNode => ({ ...FY2023, node_id: nodeId, subject_slot: slot, metric_key: metric, period: { kind: "latest", period_type: "annual", offset: 0 } });
  const as = (metric: string, spec: CandidateSpec) => ({ ...candidate(spec), metric_key: metric });
  const revenue = latest("a_rev", "revenue");
  const grossProfit = latest("a_gp", "gross_profit");
  const unproven = latest("a_oi", "operating_income");
  const peer = latest("b_rev", "revenue", "b");
  const slots = [
    { node: revenue, candidates: [as("revenue", { year: 2023 }), as("revenue", { year: 2024, publishedLocalDate: "2025-01-10" })] },
    { node: grossProfit, candidates: [as("gross_profit", { year: 2022, value: "40" })] },
    { node: unproven, candidates: [as("operating_income", { year: 2022 }), as("operating_income", { year: 2023, precision: null })] },
    { node: peer, candidates: [as("revenue", { year: 2022, value: "7" })] },
  ];
  const periods = sharedLatestPeriods(slots, policy());
  const select = (index: number) => selectInput(slots[index]!.node, slots[index]!.candidates, policy(), { truncated: false }, periods.get(slots[index]!.node.node_id)!);

  assert.equal(selectedId(select(0)), slots[0]!.candidates[0]!.fact_id, "FY2024 was not public at the cutoff, so FY2023 is the latest");
  assert.equal(gapReason(select(1)), "missing_input", "FY2022 gross profit is not the latest fiscal year");
  assert.equal(gapReason(select(2)), "precision_unverified", "the latest year's candidate exists but is unproven; the FY2022 one is not substituted");
  assert.equal(selectedId(select(3)), slots[3]!.candidates[0]!.fact_id, "another subject keeps its own latest year");
  assert.equal(periods.get("a_gp"), periods.get("a_rev"));
});

test("an incomplete page leaves its subject's latest period unresolved (#349 review)", () => {
  const latest = (nodeId: string, metric: string, slot = "a"): ReportedMetricNode => ({ ...FY2023, node_id: nodeId, subject_slot: slot, metric_key: metric, period: { kind: "latest", period_type: "annual", offset: 0 } });
  const as = (metric: string, spec: CandidateSpec) => ({ ...candidate(spec), metric_key: metric });
  const assets = latest("a_assets", "total_assets");
  const liabilities = latest("a_liab", "total_liabilities");
  const equity = latest("a_equity", "total_equity");
  const quarterly = { ...latest("a_rev_q", "revenue"), period: { kind: "latest", period_type: "quarterly", offset: 0 } } as ReportedMetricNode;
  const peer = latest("b_assets", "total_assets", "b");
  const slots = [
    { node: assets, candidates: [as("total_assets", { year: 2022 })] },
    { node: liabilities, candidates: [as("total_liabilities", { year: 2022 })], incomplete: "scope_limit_exceeded" as const },
    { node: equity, candidates: [], incomplete: "database_error" as const },
    { node: quarterly, candidates: [as("revenue", { year: 2022, period: "Q3", start: "2022-07-01", end: "2022-09-30" })] },
    { node: peer, candidates: [as("total_assets", { year: 2022, value: "7" })] },
  ];
  const periods = sharedLatestPeriods(slots, policy());
  const select = (index: number) => selectInput(slots[index]!.node, slots[index]!.candidates, policy(), { truncated: false }, periods.get(slots[index]!.node.node_id)!);

  assert.equal(gapReason(select(0)), "scope_limit_exceeded", "a truncated page may hold a newer year, so FY2022 assets are not called latest");
  assert.equal(gapReason(select(1)), "scope_limit_exceeded");
  assert.equal(gapReason(select(2)), "scope_limit_exceeded", "the first incomplete slot's reason names the group's gap");
  assert.equal(selectedId(select(3)), slots[3]!.candidates[0]!.fact_id, "a quarterly latest is its own group");
  assert.equal(selectedId(select(4)), slots[4]!.candidates[0]!.fact_id, "another subject's latest is unaffected");
});

test("freshness is evaluated at the cutoff", () => {
  const fy2023 = candidate({ publishedLocalDate: "2024-01-10" });
  assert.equal(selectedId(selectInput(FY2023, [fy2023], policy({ max_age_days: 30 }))), fy2023.fact_id);
  assert.equal(gapReason(selectInput(FY2023, [fy2023], policy({ max_age_days: 30, knowledge_cutoff: "2024-06-01T00:00:00Z" }))), "stale_input");
});

test("a truncated candidate page is a scope limitation, never evidence of completeness", () => {
  assert.equal(gapReason(selectInput(FY2023, [candidate()], policy(), { truncated: true })), "scope_limit_exceeded");
});

test("selection reports the conservative publication bound it relied on", () => {
  const fy2023 = candidate({ publishedLocalDate: "2024-01-10" });
  const result = selectInput(FY2023, [fy2023], policy());
  assert.ok(result.status === "selected");
  if (result.status !== "selected") return;
  assert.deepEqual(result.input.publication, {
    attestation_id: `a-${fy2023.fact_id}`,
    available_no_later_than: "2024-01-11T04:59:59.999Z",
    timing_precision: "date",
    source_timezone: "America/New_York",
  });
});

test("evidence from a source class the authority does not allow is never bound (#444)", () => {
  const disallowed = (spec: CandidateSpec): InputCandidate => ({ ...candidate(spec), source_class: "issuer_disclosure" });
  const release = disallowed({ value: "100" });
  const filing = candidate({ value: "100" });
  assert.equal(gapReason(selectInput(FY2023, [release], policy())), "source_class_not_allowed");
  assert.equal(selectedId(selectInput(FY2023, [release], policy({ allowed_source_classes: ["issuer_disclosure"] }))), release.fact_id);
  // A source no class covers is allowed by no authority.
  const every = policy({ allowed_source_classes: ["sec_filing", "issuer_disclosure", "licensed_fundamentals", "market_data"] });
  assert.equal(gapReason(selectInput(FY2023, [{ ...candidate(), source_class: null }], every)), "source_class_not_allowed");
  // Beside an allowed value it never wins the tie its lower id would, and a different value is no conflict.
  assert.equal(selectedId(selectInput(FY2023, [release, filing], policy())), filing.fact_id);
  assert.equal(selectedId(selectInput(FY2023, [disallowed({ value: "90" }), filing], policy())), filing.fact_id);
  // An allowed value that lacks a proof is the closer reason.
  assert.equal(gapReason(selectInput(FY2023, [disallowed({}), candidate({ precision: null })], policy())), "precision_unverified");
  // Its newer period is not the latest one this authority can bind.
  const latest: ReportedMetricNode = { ...FY2023, period: { kind: "latest", period_type: "annual", offset: 0 } };
  const fy2024 = disallowed({ year: 2024, publishedLocalDate: "2025-01-10" });
  assert.equal(selectedId(selectInput(latest, [filing, fy2024], policy({ knowledge_cutoff: "2025-06-01T00:00:00Z" }))), filing.fact_id);
});
