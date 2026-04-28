import {
  authorizeToolCall,
  type ToolCallAuthorization,
} from "./audience-enforcement.ts";
import type {
  JsonValue,
  ToolAudience,
  ToolCostClass,
  ToolDefinition,
  ToolRegistry,
} from "./registry.ts";
import { TOOL_COST_CLASSES } from "./registry.ts";

export type ToolCallBudget = Readonly<Record<ToolCostClass, number>>;
export type ToolCallUsage = Readonly<Record<ToolCostClass, number>>;

export const DEFAULT_TOOL_CALL_BUDGET: ToolCallBudget = Object.freeze({
  low: 8,
  medium: 4,
  high: 2,
});

export const EMPTY_TOOL_CALL_USAGE: ToolCallUsage = Object.freeze({
  low: 0,
  medium: 0,
  high: 0,
});

export type CheckToolCallBudgetInput = {
  registry: ToolRegistry;
  bundle_id: string;
  audience: ToolAudience;
  tool_name: string;
  arguments?: JsonValue;
  usage?: Partial<ToolCallUsage>;
  budget?: Partial<ToolCallBudget>;
};

export type ToolCallBudgetDecision =
  | {
      ok: true;
      action: "execute";
      tool: ToolDefinition;
      cost_class: ToolCostClass;
      used: number;
      limit: number;
      remaining: ToolCallUsage;
    }
  | {
      ok: false;
      action: "partial_answer";
      reason: "budget_exceeded";
      tool_name: string;
      bundle_id: string;
      audience: ToolAudience;
      cost_class: ToolCostClass;
      used: number;
      limit: number;
      note: string;
    }
  | ToolCallRejection;

type ToolCallRejection = Extract<ToolCallAuthorization, { ok: false }>;

export function checkToolCallBudget(
  input: CheckToolCallBudgetInput,
): ToolCallBudgetDecision {
  const authorization = authorizeToolCall({
    registry: input.registry,
    bundle_id: input.bundle_id,
    audience: input.audience,
    tool_name: input.tool_name,
    arguments: input.arguments,
  });

  if (!authorization.ok) {
    return authorization;
  }

  const costClass = authorization.tool.cost_class;
  const usage = normalizeUsage(input.usage);
  const budget = normalizeBudget(input.budget);
  const used = usage[costClass];
  const limit = budget[costClass];

  if (used >= limit) {
    return Object.freeze({
      ok: false,
      action: "partial_answer",
      reason: "budget_exceeded",
      tool_name: authorization.tool.name,
      bundle_id: input.bundle_id,
      audience: input.audience,
      cost_class: costClass,
      used,
      limit,
      note: `Skipped tool "${authorization.tool.name}" because the ${costClass}-cost per-turn budget is exhausted; return a partial answer with available evidence.`,
    });
  }

  return Object.freeze({
    ok: true,
    action: "execute",
    tool: authorization.tool,
    cost_class: costClass,
    used,
    limit,
    remaining: remainingBudget(usage, budget, costClass),
  });
}

export function recordToolCallUsage(
  usage: Partial<ToolCallUsage> | undefined,
  toolOrCostClass: ToolDefinition | ToolCostClass,
): ToolCallUsage {
  const costClass =
    typeof toolOrCostClass === "string"
      ? toolOrCostClass
      : toolOrCostClass.cost_class;
  const current = normalizeUsage(usage);
  return freezeUsage({
    ...current,
    [costClass]: current[costClass] + 1,
  });
}

function remainingBudget(
  usage: ToolCallUsage,
  budget: ToolCallBudget,
  acceptedCostClass: ToolCostClass,
): ToolCallUsage {
  return freezeUsage(
    Object.fromEntries(
      TOOL_COST_CLASSES.map((costClass) => {
        const acceptedCallCount = costClass === acceptedCostClass ? 1 : 0;
        return [
          costClass,
          Math.max(0, budget[costClass] - usage[costClass] - acceptedCallCount),
        ];
      }),
    ) as Record<ToolCostClass, number>,
  );
}

function normalizeBudget(budget: Partial<ToolCallBudget> = {}): ToolCallBudget {
  return freezeUsage({
    low: normalizeNonNegativeInteger(
      budget.low ?? DEFAULT_TOOL_CALL_BUDGET.low,
      "budget.low",
    ),
    medium: normalizeNonNegativeInteger(
      budget.medium ?? DEFAULT_TOOL_CALL_BUDGET.medium,
      "budget.medium",
    ),
    high: normalizeNonNegativeInteger(
      budget.high ?? DEFAULT_TOOL_CALL_BUDGET.high,
      "budget.high",
    ),
  });
}

function normalizeUsage(usage: Partial<ToolCallUsage> = {}): ToolCallUsage {
  return freezeUsage({
    low: normalizeNonNegativeInteger(
      usage.low ?? EMPTY_TOOL_CALL_USAGE.low,
      "usage.low",
    ),
    medium: normalizeNonNegativeInteger(
      usage.medium ?? EMPTY_TOOL_CALL_USAGE.medium,
      "usage.medium",
    ),
    high: normalizeNonNegativeInteger(
      usage.high ?? EMPTY_TOOL_CALL_USAGE.high,
      "usage.high",
    ),
  });
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label}: must be a non-negative integer`);
  }
  return value;
}

function freezeUsage(value: Record<ToolCostClass, number>): ToolCallUsage {
  return Object.freeze(value);
}
