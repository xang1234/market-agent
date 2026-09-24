// Checks a validated plan against server-owned authority before any
// acquisition: feature mode, approval, and parent limits (the lowest limit
// wins). Plans never carry authority themselves. The planner rejects an
// unauthorized plan; execution re-checks before acquiring evidence and fails
// the run with the reason code — a plan over its limits is never truncated.

import {
  validatePlanGraph,
  type ExecutionLimits,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type ValidationIssue,
} from "../../financial-core/src/index.ts";

export type AuthorizationFailure = "feature_disabled" | "scope_limit_exceeded" | "invalid_plan";
export type PlanAuthorization = { ok: true } | { ok: false; reason_code: AuthorizationFailure; issues: ValidationIssue[] };

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
  if (issues.length === 0) return { ok: true };
  const reason = (["feature_disabled", "scope_limit_exceeded"] as const).find((code) => issues.some((issue) => issue.code === code));
  return { ok: false, reason_code: reason ?? "invalid_plan", issues };
}
