// Checks a validated plan against its parent's limits (the lowest limit wins)
// before any acquisition. The planner rejects an unauthorized plan; execution
// re-checks before acquiring evidence and fails the run with the reason code,
// so a plan over its limits is never truncated.

import {
  validatePlanGraph,
  type ExecutionLimits,
  type FinancialPlanV1,
  type ValidationIssue,
} from "../../financial-core/src/index.ts";

export type AuthorizationFailure = "scope_limit_exceeded" | "invalid_plan";
export type PlanAuthorization = { ok: true } | { ok: false; reason_code: AuthorizationFailure; issues: ValidationIssue[] };

export function authorizePlan(plan: FinancialPlanV1, parentLimits: Partial<ExecutionLimits>): PlanAuthorization {
  const issues = validatePlanGraph(plan, parentLimits);
  if (issues.length === 0) return { ok: true };
  return { ok: false, reason_code: issues.some((issue) => issue.code === "scope_limit_exceeded") ? "scope_limit_exceeded" : "invalid_plan", issues };
}
