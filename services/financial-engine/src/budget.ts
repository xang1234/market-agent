// Execution limits are enforced before any evidence is acquired or graph is
// allocated: the plan's own limits, then the parent's, whichever is lower.
// A plan over its limits fails the run with an explicit scope reason; it is
// never silently truncated. Evidence reads run sequentially on the run's
// pinned client, so at most one evidence task is in flight — within every
// allowed max_concurrent_evidence_tasks.

import type { ExecutionLimits, FinancialPlanV1, FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import { authorizePlan } from "./plan-authority.ts";

export type BudgetCheck = { ok: true } | { ok: false; reason_code: "scope_limit_exceeded" | "feature_disabled" | "invalid_plan" };

export function checkExecutionBudget(
  plan: FinancialPlanV1,
  authority: FinancialRuntimeAuthority,
  parentLimits: Partial<ExecutionLimits>,
): BudgetCheck {
  const authorized = authorizePlan(plan, authority, parentLimits);
  if (authorized.ok) return { ok: true };
  if (authorized.issues.some((issue) => issue.code === "feature_disabled")) return { ok: false, reason_code: "feature_disabled" };
  if (authorized.issues.some((issue) => issue.code === "scope_limit_exceeded")) return { ok: false, reason_code: "scope_limit_exceeded" };
  return { ok: false, reason_code: "invalid_plan" };
}
