import assert from "node:assert/strict";
import test from "node:test";
import type { ReportedMetricNode } from "../../financial-core/src/index.ts";
import type { InputCandidate } from "../src/ports.ts";
import { selectInput, type SelectionPolicy } from "../src/select-inputs.ts";

let counter = 0;
const HASH = "a".repeat(64);

type CandidateSpec = {
  value?: string;
  year?: number;
  period?: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  start?: string;
  end?: string;
  publishedLocalDate?: string;
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
    source_version_hash: HASH,
    metric_key: "revenue",
    period: { start: spec.start ?? `${year}-01-01`, end: spec.end ?? `${year}-12-31`, fiscal_year: year, fiscal_period: spec.period ?? "FY" },
    value_text: spec.value ?? "100",
    scale_text: "1",
    unit: { kind: "currency", currency: "USD" },
    method: "reported",
    verification_status: "authoritative",
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
  return { knowledge_cutoff: "2024-01-15T23:59:59.999-05:00", reporting_basis: "as_reported", max_age_days: null, ...overrides };
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
