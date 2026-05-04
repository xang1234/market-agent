import {
  interceptToolCall,
  type PendingToolAction,
} from "../../tools/src/approval-interceptor.ts";
import type { ToolRegistry } from "../../tools/src/registry.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import {
  AgentValidationError,
  assertAgentInput,
  createAgent,
  type AgentInput,
  type AgentRow,
  type QueryExecutor,
} from "./agent-repo.ts";

const APPROVED_CREATE_AGENT_ACTION: unique symbol = Symbol("agents.approvedCreateAgentAction");

export type CreateAgentApprovalIntentInput = {
  registry: ToolRegistry;
  input: AgentInput;
  idempotency_key?: string;
};

export type CreateAgentApprovalIntent = {
  pending_action_id: string;
  confirmation_required: true;
  pending_action: PendingToolAction;
};

export type CreateAgentApprovalConfirmation = {
  approved_by_user_id: string;
  approved_at: string;
};

type ApprovedCreateAgentActionBrand = {
  readonly [APPROVED_CREATE_AGENT_ACTION]: true;
};

export type ApprovedCreateAgentAction = PendingToolAction &
  ApprovedCreateAgentActionBrand & {
    approved_by_user_id: string;
    approved_at: string;
  };

export function createAgentApprovalIntent(
  input: CreateAgentApprovalIntentInput,
): CreateAgentApprovalIntent {
  try {
    assertAgentInput(input.input);
  } catch (error) {
    if (error instanceof AgentValidationError) {
      throw new CreateAgentApprovalError(error.message);
    }
    throw error;
  }

  const interception = interceptToolCall({
    registry: input.registry,
    bundle_id: "agent_management",
    audience: "analyst",
    tool_name: "create_agent",
    arguments: input.input as unknown as JsonValue,
    idempotency_key: input.idempotency_key,
  });

  if (!interception.ok) {
    throw new CreateAgentApprovalError(interception.message);
  }
  if (interception.action !== "pending_approval") {
    throw new CreateAgentApprovalError("create_agent must require pending approval");
  }

  return Object.freeze({
    pending_action_id: interception.pending_action.pending_action_id,
    confirmation_required: true,
    pending_action: interception.pending_action,
  });
}

export async function applyApprovedCreateAgent(
  db: QueryExecutor,
  pendingAction: ApprovedCreateAgentAction,
): Promise<AgentRow> {
  assertApprovedCreateAgentAction(pendingAction);
  return createAgent(db, {
    ...(pendingAction.arguments as unknown as AgentInput),
    enabled: true,
  });
}

export function approveCreateAgentAction(
  pendingAction: PendingToolAction,
  confirmation: CreateAgentApprovalConfirmation,
): ApprovedCreateAgentAction {
  assertCreateAgentPendingAction(pendingAction);
  assertNonEmptyString(confirmation.approved_by_user_id, "approved_by_user_id");
  assertNonEmptyString(confirmation.approved_at, "approved_at");
  return Object.freeze(
    Object.defineProperty(
      {
        ...pendingAction,
        approved_by_user_id: confirmation.approved_by_user_id,
        approved_at: confirmation.approved_at,
      },
      APPROVED_CREATE_AGENT_ACTION,
      {
        value: true,
        enumerable: false,
        configurable: false,
      },
    ),
  ) as ApprovedCreateAgentAction;
}

export class CreateAgentApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateAgentApprovalError";
  }
}

function assertCreateAgentPendingAction(
  pendingAction: PendingToolAction,
): asserts pendingAction is PendingToolAction & { arguments: JsonValue } {
  if (pendingAction.tool_name !== "create_agent") {
    throw new CreateAgentApprovalError("pending action must be for create_agent");
  }
  if (pendingAction.bundle_id !== "agent_management") {
    throw new CreateAgentApprovalError("create_agent pending action must use agent_management bundle");
  }
  if (pendingAction.approval_required !== true || pendingAction.read_only !== false) {
    throw new CreateAgentApprovalError("create_agent pending action must be approval-required write intent");
  }
  if (pendingAction.arguments === undefined) {
    throw new CreateAgentApprovalError("create_agent pending action must include arguments");
  }
}

function assertApprovedCreateAgentAction(
  action: PendingToolAction,
): asserts action is ApprovedCreateAgentAction {
  if ((action as Partial<ApprovedCreateAgentActionBrand>)[APPROVED_CREATE_AGENT_ACTION] !== true) {
    throw new CreateAgentApprovalError("applyApprovedCreateAgent requires an approved create_agent action");
  }
  assertCreateAgentPendingAction(action);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CreateAgentApprovalError(`${label}: must be a non-empty string`);
  }
}
