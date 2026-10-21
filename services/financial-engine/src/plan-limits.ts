import {
  validatePlanGraph,
  type ExecutionLimits,
  type FinancialPlanV1,
  type ValidationIssue,
} from "../../financial-core/src/index.ts";

export type PlanLimitFailure = "scope_limit_exceeded" | "invalid_plan";
export type PlanLimitCheck = { ok: true } | { ok: false; reason_code: PlanLimitFailure; issues: ValidationIssue[] };

export function checkPlanLimits(plan: FinancialPlanV1, parentLimits: Partial<ExecutionLimits>): PlanLimitCheck {
  const issues = validatePlanGraph(plan, parentLimits);
  if (issues.length === 0) return { ok: true };
  return { ok: false, reason_code: issues.some((issue) => issue.code === "scope_limit_exceeded") ? "scope_limit_exceeded" : "invalid_plan", issues };
}
