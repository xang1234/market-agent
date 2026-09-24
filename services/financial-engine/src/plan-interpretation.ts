// Human-readable interpretation generated from the validated plan structure
// only. No model text is used, so the explanation cannot describe a different
// plan than the one that runs.

import type { FinancialPlanV1, OperationNode, PeriodSelector } from "../../financial-core/src/index.ts";

export const INTERPRETATION_GENERATOR_VERSION = "plan-interpretation.v1";

const OPERATION_PHRASES: Record<Exclude<OperationNode["operation"], "reported_metric">, string> = {
  absolute_change: "absolute change",
  percent_change_positive_base: "percent change (positive prior base only)",
  gross_margin: "gross margin",
  operating_margin: "operating margin",
  net_margin: "net margin",
  ratio: "approved ratio",
  trailing_sum: "trailing four-quarter sum",
  threshold: "threshold check",
  peer_compare: "peer ranking",
};

/** `labels` maps subject slot ids to display names resolved by the server. */
export function interpretPlan(plan: FinancialPlanV1, labels: ReadonlyMap<string, string>): { generator_version: string; text: string } {
  const subjects = plan.subjects.members
    .map((member) => `${labels.get(member.slot_id) ?? member.subject_ref.id} (${member.subject_ref.kind}:${member.subject_ref.id})`)
    .join(", ");
  const population =
    plan.subjects.omitted_count > 0
      ? `${plan.subjects.resolved_count} of ${plan.subjects.requested_count} requested subjects (${plan.subjects.omitted_count} omitted)`
      : `${plan.subjects.resolved_count} requested subject${plan.subjects.resolved_count === 1 ? "" : "s"}`;
  const metrics = plan.metric_definitions.map((definition) => `${definition.metric_key} (${definition.definition_version})`).join(", ");
  const periods = [...new Set(plan.operations.flatMap((node) => (node.operation === "reported_metric" ? [periodPhrase(node.period)] : [])))].join(", ");
  const derived = [...new Set(plan.operations.flatMap((node) => (node.operation === "reported_metric" ? [] : [OPERATION_PHRASES[node.operation]])))];
  const thresholds = plan.thresholds.map((threshold) => `${threshold.threshold_id} = ${threshold.value} ${threshold.unit.kind}${"currency" in threshold.unit ? ` ${threshold.unit.currency}` : ""} (from ${threshold.attribution.kind})`);
  const lines = [
    `Subjects: ${subjects}; ${population}.`,
    `Metrics: ${metrics}.`,
    `Periods: ${periods}; ${plan.policies.reporting_basis === "as_reported" ? "as originally reported" : "latest restatement public by the cutoff"}.`,
    `Information public by ${plan.time.knowledge_cutoff} (${plan.time.cutoff_timezone}).`,
  ];
  if (derived.length > 0) lines.push(`Calculations: ${derived.join(", ")}.`);
  if (thresholds.length > 0) lines.push(`Thresholds: ${thresholds.join("; ")}.`);
  return { generator_version: INTERPRETATION_GENERATOR_VERSION, text: lines.join(" ") };
}

function periodPhrase(period: PeriodSelector): string {
  if (period.kind === "fiscal_period") return `${period.fiscal_period} ${period.fiscal_year}`;
  const unit = period.period_type === "annual" ? "fiscal year" : "fiscal quarter";
  return period.offset === 0 ? `latest ${unit} at the cutoff` : `${unit} ${period.offset} before the latest at the cutoff`;
}
