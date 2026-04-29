import {
  DEFAULT_TOOL_CALL_BUDGET,
  EMPTY_TOOL_CALL_USAGE,
  checkToolCallBudget,
  recordToolCallUsage,
  type ToolCallBudget,
  type ToolCallBudgetDecision,
  type ToolCallUsage,
} from "./budget-gate.ts";
import {
  selectToolBundle,
  type BundleSelection,
  type PreResolveBundleClassification,
} from "./bundle-selector.ts";
import type { PromptCacheFewShot } from "./prompt-templates.ts";
import type {
  JsonValue,
  ToolAudience,
  ToolCostClass,
  ToolRegistry,
} from "./registry.ts";

export type TurnToolPolicyInput = {
  registry: ToolRegistry;
  audience: ToolAudience;
  classification: PreResolveBundleClassification;
  usage?: Partial<ToolCallUsage>;
  budget?: Partial<ToolCallBudget>;
  response_schema?: JsonValue;
  few_shots?: ReadonlyArray<PromptCacheFewShot>;
  thread_summary?: string | null;
  resolved_context?: JsonValue;
  user_turn?: string;
};

export type TurnToolCallInput = {
  tool_name: string;
  arguments?: JsonValue;
};

export type AcceptedToolCallBudgetDecision = Extract<ToolCallBudgetDecision, { ok: true }>;

export type TurnToolPolicy =
  | {
      ok: true;
      audience: ToolAudience;
      bundle_id: string;
      selection: Extract<BundleSelection, { ok: true }>;
      budget: ToolCallBudget;
      usage: ToolCallUsage;
      checkToolCall(input: TurnToolCallInput): ToolCallBudgetDecision;
      recordAcceptedToolCall(decision: AcceptedToolCallBudgetDecision): TurnToolPolicy;
    }
  | Extract<BundleSelection, { ok: false }>;

type TurnToolPolicySession = {
  acceptedDecisions: WeakSet<AcceptedToolCallBudgetDecision>;
  reservedUsage: ToolCallUsage;
};

export function createTurnToolPolicy(input: TurnToolPolicyInput): TurnToolPolicy {
  return createTurnToolPolicyWithSession(input);
}

function createTurnToolPolicyWithSession(
  input: TurnToolPolicyInput,
  session?: TurnToolPolicySession,
): TurnToolPolicy {
  const selection = selectToolBundle({
    registry: input.registry,
    audience: input.audience,
    classification: input.classification,
    response_schema: input.response_schema,
    few_shots: input.few_shots,
    thread_summary: input.thread_summary,
    resolved_context: input.resolved_context,
    user_turn: input.user_turn,
  });

  if (!selection.ok) {
    return selection;
  }

  const budget = normalizeBudget(input.budget);
  const usage = normalizeUsage(input.usage);
  const policySession = session ?? {
    acceptedDecisions: new WeakSet<AcceptedToolCallBudgetDecision>(),
    reservedUsage: usage,
  };

  return Object.freeze({
    ok: true,
    audience: selection.audience,
    bundle_id: selection.bundle_id,
    selection,
    budget,
    usage,
    checkToolCall(toolCall) {
      const decision = checkToolCallBudget({
        registry: input.registry,
        bundle_id: selection.bundle_id,
        audience: selection.audience,
        tool_name: toolCall.tool_name,
        arguments: toolCall.arguments,
        usage: policySession.reservedUsage,
        budget,
      });
      if (decision.ok) {
        policySession.acceptedDecisions.add(decision);
        policySession.reservedUsage = recordToolCallUsage(policySession.reservedUsage, decision.tool);
      }
      return decision;
    },
    recordAcceptedToolCall(decision) {
      assertAcceptedDecision(decision, policySession.acceptedDecisions, usage);
      policySession.acceptedDecisions.delete(decision);
      return createTurnToolPolicyWithSession({
        registry: input.registry,
        audience: selection.audience,
        classification: selection.classification,
        budget,
        usage: recordToolCallUsage(usage, decision.tool),
        response_schema: input.response_schema,
        few_shots: input.few_shots,
        thread_summary: input.thread_summary,
        resolved_context: input.resolved_context,
        user_turn: input.user_turn,
      }, policySession);
    },
  });
}

function assertAcceptedDecision(
  decision: ToolCallBudgetDecision,
  acceptedDecisions: WeakSet<AcceptedToolCallBudgetDecision>,
  usage: ToolCallUsage,
): asserts decision is AcceptedToolCallBudgetDecision {
  if (
    decision === null ||
    typeof decision !== "object" ||
    decision.ok !== true ||
    !acceptedDecisions.has(decision) ||
    decision.used !== usage[decision.cost_class]
  ) {
    throw new Error("recordAcceptedToolCall requires an accepted tool-call decision");
  }
}

function normalizeBudget(budget: Partial<ToolCallBudget> = {}): ToolCallBudget {
  return freezeBudget({
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
  return freezeBudget({
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

function freezeBudget<T extends Record<ToolCostClass, number>>(value: T): T {
  return Object.freeze(value);
}
