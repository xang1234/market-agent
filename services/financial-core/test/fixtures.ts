import type { FinancialPlanV1, FinancialRuntimeAuthorityV1, PeriodSelector } from "../src/contracts.ts";

export const ISSUER_A = "11111111-1111-4111-8111-111111111111";
export const ISSUER_B = "22222222-2222-4222-8222-222222222222";
export const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Two-company FY2023 gross-margin comparison with a threshold check. */
export function planFixture(): FinancialPlanV1 {
  return {
    schema_version: "financial_plan.v1",
    plan_id: "33333333-3333-4333-8333-333333333333",
    origin: { kind: "chat_request", ref: "chat:turn:1" },
    planner: { kind: "model", adapter_version: "planner.v1", model: "stub-model", prompt_version: "plan-prompt.v1" },
    catalog_version: "catalog.v1",
    interpretation: null,
    subjects: {
      membership: "explicit",
      requested_count: 2,
      resolved_count: 2,
      omitted_count: 0,
      members: [
        { slot_id: "a", subject_ref: { kind: "issuer", id: ISSUER_A }, display_order: 0, role: "primary" },
        { slot_id: "b", subject_ref: { kind: "issuer", id: ISSUER_B }, display_order: 1, role: "peer" },
      ],
    },
    time: {
      knowledge_cutoff: "2024-01-15T23:59:59.999-05:00",
      cutoff_timezone: "America/New_York",
      time_mode: "public_information",
    },
    policies: {
      reporting_basis: "as_reported",
      period_policy: "exact_fiscal",
      freshness: { max_age_days: null },
      source_policy_version: "sources.v1",
    },
    metric_definitions: [
      { metric_key: "revenue", definition_version: "revenue.v1" },
      { metric_key: "gross_profit", definition_version: "gross_profit.v1" },
    ],
    operations: [
      reported("a_rev", "a", "revenue"),
      reported("a_gp", "a", "gross_profit"),
      reported("b_rev", "b", "revenue"),
      reported("b_gp", "b", "gross_profit"),
      { node_id: "a_gm", operation: "gross_margin", operation_version: "gross_margin.v1", numerator: "a_gp", revenue: "a_rev" },
      { node_id: "b_gm", operation: "gross_margin", operation_version: "gross_margin.v1", numerator: "b_gp", revenue: "b_rev" },
      { node_id: "a_gm_check", operation: "threshold", operation_version: "threshold.v1", subject: "a_gm", threshold_id: "min_gm", comparison: "gte" },
      { node_id: "gm_rank", operation: "peer_compare", operation_version: "peer_compare.v1", members: ["a_gm", "b_gm"], direction: "highest" },
    ],
    outputs: [
      { output_id: "out_a_rev", node_id: "a_rev", unit_id: "section" },
      { output_id: "out_a_gm", node_id: "a_gm", unit_id: "section" },
      { output_id: "out_b_gm", node_id: "b_gm", unit_id: "section" },
      { output_id: "out_check", node_id: "a_gm_check", unit_id: "section" },
      { output_id: "out_rank", node_id: "gm_rank", unit_id: "section" },
    ],
    publication_units: [{ unit_id: "section", kind: "chat_section" }],
    thresholds: [
      {
        threshold_id: "min_gm",
        value: "0.4",
        unit: { kind: "ratio" },
        attribution: { kind: "user_request", ref: "chat:turn:1" },
      },
    ],
    limits: {
      max_subjects: 25,
      max_periods_per_subject: 20,
      max_operations: 512,
      max_outputs: 2000,
      max_input_candidates: 10000,
      max_concurrent_evidence_tasks: 4,
    },
    presentation_template_version: "financial-answer.v1",
  };
}

function reported(nodeId: string, slot: string, metricKey: string) {
  return {
    node_id: nodeId,
    operation: "reported_metric" as const,
    operation_version: "reported_metric.v1",
    subject_slot: slot,
    metric_key: metricKey,
    period: { kind: "fiscal_period" as const, fiscal_year: 2023, fiscal_period: "FY" as const },
  };
}

export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
const QUARTERS: ReadonlyArray<Quarter> = ["Q1", "Q2", "Q3", "Q4"];

export function quarterBack(fiscal_year: number, fiscal_period: Quarter, back: number): PeriodSelector {
  const total = fiscal_year * 4 + QUARTERS.indexOf(fiscal_period) - back;
  return { kind: "fiscal_period", fiscal_year: Math.floor(total / 4), fiscal_period: QUARTERS[total % 4]! };
}

export const reportedAt = (node_id: string, subject_slot: string, metric_key: string, period: PeriodSelector) =>
  ({ node_id, operation: "reported_metric" as const, operation_version: "reported_metric.v1", subject_slot, metric_key, period });

export const change = (node_id: string, operation: "absolute_change" | "percent_change_positive_base", current: string, prior: string) =>
  ({ node_id, operation, operation_version: `${operation}.v1`, current, prior });

export const OVERVIEW_LINES = ["rev", "gp", "oi", "ni", "gm", "om", "nm", "qoq", "yoy"] as const;

export function overviewComparisonPlan(companies: ReadonlyArray<{ slot: "a" | "b"; newest: [number, Quarter]; reversed?: boolean }>): FinancialPlanV1 {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.operations = [];
  plan.outputs = [];
  plan.thresholds = [];
  for (const { slot, newest: [year, quarter], reversed } of companies) {
    const id = (line: string) => `${slot}_${line}`;
    const at = (back: number) => quarterBack(year, quarter, back);
    plan.operations.push(
      reportedAt(id("rev"), slot, "revenue", at(0)),
      reportedAt(id("rev_q1"), slot, "revenue", at(1)),
      reportedAt(id("rev_q4"), slot, "revenue", at(4)),
      reportedAt(id("gp"), slot, "gross_profit", at(0)),
      reportedAt(id("oi"), slot, "operating_income", at(0)),
      reportedAt(id("ni"), slot, "net_income", at(0)),
      { node_id: id("gm"), operation: "gross_margin", operation_version: "gross_margin.v1", numerator: id("gp"), revenue: id("rev") },
      { node_id: id("om"), operation: "operating_margin", operation_version: "operating_margin.v1", numerator: id("oi"), revenue: id("rev") },
      { node_id: id("nm"), operation: "net_margin", operation_version: "net_margin.v1", numerator: id("ni"), revenue: id("rev") },
      change(id("qoq"), "percent_change_positive_base", id("rev"), id("rev_q1")),
      change(id("yoy"), "percent_change_positive_base", id("rev"), id("rev_q4")),
    );
    const outputs = OVERVIEW_LINES.map((line) => ({ output_id: `out_${id(line)}`, node_id: id(line), unit_id: "section" }));
    plan.outputs.push(...(reversed ? outputs.reverse() : outputs));
  }
  return plan;
}

export function authorityFixture(owner = OWNER_A): FinancialRuntimeAuthorityV1 {
  return {
    owner_user_id: owner,
    egress_channel: "chat",
    parent: { kind: "chat_thread", id: "44444444-4444-4444-8444-444444444444", version: "1" },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  };
}

/** Deep, JSON-only clone that lets tests mutate a fixture freely. */
export function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}
