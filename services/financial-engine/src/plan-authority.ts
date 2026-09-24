// Checks a validated plan against server-owned authority before any
// acquisition: feature mode, approval, and parent limits (the lowest limit
// wins). Plans never carry authority themselves.

import {
  validatePlanGraph,
  type ExecutionLimits,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type ValidationIssue,
} from "../../financial-core/src/index.ts";

export type PlanAuthorization = { ok: true } | { ok: false; issues: ValidationIssue[] };

export function authorizePlan(
  plan: FinancialPlanV1,
  authority: FinancialRuntimeAuthority,
  parentLimits: Partial<ExecutionLimits>,
): PlanAuthorization {
  const issues: ValidationIssue[] = [];
  if (authority.feature.mode === "off") {
    issues.push({ path: "$authority.feature.mode", code: "feature_disabled", message: "financial answers are off for this surface" });
  }
  issues.push(...validatePlanGraph(plan, parentLimits));
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
