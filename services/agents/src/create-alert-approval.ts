import { assertSubjectRef, type SubjectRef } from "../../resolver/src/subject-ref.ts";
import {
  interceptToolCall,
  type PendingToolAction,
} from "../../tools/src/approval-interceptor.ts";
import type { ToolRegistry } from "../../tools/src/registry.ts";
import type { JsonObject, JsonValue } from "../../observability/src/types.ts";
import {
  getAgent,
  updateAgent,
  type AgentRow,
  type QueryExecutor,
} from "./agent-repo.ts";
import {
  AlertRuleValidationError,
  compileAlertRule,
  type AlertRule,
} from "./alert-rule-compiler.ts";

const APPROVED_CREATE_ALERT_ACTION: unique symbol = Symbol("agents.approvedCreateAlertAction");

export type CreateAlertInput = {
  agent_id: string;
  subject_ref: SubjectRef;
  rule: JsonObject;
  channels: ReadonlyArray<string>;
};

export type CreateAlertApprovalIntentInput = {
  registry: ToolRegistry;
  input: CreateAlertInput;
  idempotency_key?: string;
};

export type CreateAlertApprovalIntent = {
  pending_action_id: string;
  confirmation_required: true;
  pending_action: PendingToolAction;
};

export type CreateAlertApprovalConfirmation = {
  approved_by_user_id: string;
  approved_at: string;
};

type ApprovedCreateAlertActionBrand = {
  readonly [APPROVED_CREATE_ALERT_ACTION]: true;
};

export type ApprovedCreateAlertAction = PendingToolAction &
  ApprovedCreateAlertActionBrand & {
    approved_by_user_id: string;
    approved_at: string;
  };

export class CreateAlertApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateAlertApprovalError";
  }
}

export function createAlertApprovalIntent(
  input: CreateAlertApprovalIntentInput,
): CreateAlertApprovalIntent {
  assertCreateAlertInput(input.input);

  const interception = interceptToolCall({
    registry: input.registry,
    bundle_id: "alert_management",
    audience: "analyst",
    tool_name: "create_alert",
    arguments: input.input as unknown as JsonValue,
    idempotency_key: input.idempotency_key,
  });

  if (!interception.ok) {
    throw new CreateAlertApprovalError(interception.message);
  }
  if (interception.action !== "pending_approval") {
    throw new CreateAlertApprovalError("create_alert must require pending approval");
  }

  return Object.freeze({
    pending_action_id: interception.pending_action.pending_action_id,
    confirmation_required: true,
    pending_action: interception.pending_action,
  });
}

export function approveCreateAlertAction(
  pendingAction: PendingToolAction,
  confirmation: CreateAlertApprovalConfirmation,
): ApprovedCreateAlertAction {
  assertCreateAlertPendingAction(pendingAction);
  assertNonEmptyString(confirmation.approved_by_user_id, "approved_by_user_id");
  assertNonEmptyString(confirmation.approved_at, "approved_at");

  return Object.freeze(
    Object.defineProperty(
      {
        ...pendingAction,
        approved_by_user_id: confirmation.approved_by_user_id,
        approved_at: confirmation.approved_at,
      },
      APPROVED_CREATE_ALERT_ACTION,
      {
        value: true,
        enumerable: false,
        configurable: false,
      },
    ),
  ) as ApprovedCreateAlertAction;
}

export async function applyApprovedCreateAlert(
  db: QueryExecutor,
  pendingAction: ApprovedCreateAlertAction,
): Promise<AgentRow> {
  assertApprovedCreateAlertAction(pendingAction);
  const input = pendingAction.arguments as unknown as CreateAlertInput;
  const compiled = compileCreateAlertRule(input);
  const agent = await getAgent(db, input.agent_id);
  if (!agent) {
    throw new CreateAlertApprovalError("agent not found");
  }
  if (!Array.isArray(agent.alert_rules)) {
    throw new CreateAlertApprovalError("agent alert_rules must be an array");
  }
  return updateAgent(db, input.agent_id, {
    alert_rules: [...agent.alert_rules, compiled] as unknown as JsonValue,
  });
}

function assertCreateAlertInput(input: CreateAlertInput): void {
  if (input === null || typeof input !== "object") {
    throw new CreateAlertApprovalError("create_alert input must be an object");
  }
  assertUuidString(input.agent_id, "agent_id");
  try {
    assertSubjectRef(input.subject_ref, "subject_ref");
    compileCreateAlertRule(input);
  } catch (error) {
    if (error instanceof AlertRuleValidationError) {
      throw new CreateAlertApprovalError(error.message);
    }
    throw error;
  }
}

function compileCreateAlertRule(input: CreateAlertInput): AlertRule {
  if (input.rule === null || typeof input.rule !== "object" || Array.isArray(input.rule)) {
    throw new CreateAlertApprovalError("rule must be an object");
  }
  const compiled = compileAlertRule({
    ...input.rule,
    subject: input.subject_ref,
    channels: input.channels,
  });
  return compiled.rule;
}

function assertCreateAlertPendingAction(
  pendingAction: PendingToolAction,
): asserts pendingAction is PendingToolAction & { arguments: JsonValue } {
  if (pendingAction.tool_name !== "create_alert") {
    throw new CreateAlertApprovalError("pending action must be for create_alert");
  }
  if (pendingAction.bundle_id !== "alert_management") {
    throw new CreateAlertApprovalError("create_alert pending action must use alert_management bundle");
  }
  if (pendingAction.approval_required !== true || pendingAction.read_only !== false) {
    throw new CreateAlertApprovalError("create_alert pending action must be approval-required write intent");
  }
  if (pendingAction.arguments === undefined) {
    throw new CreateAlertApprovalError("create_alert pending action must include arguments");
  }
  assertCreateAlertInput(pendingAction.arguments as unknown as CreateAlertInput);
}

function assertApprovedCreateAlertAction(
  action: PendingToolAction,
): asserts action is ApprovedCreateAlertAction {
  if ((action as Partial<ApprovedCreateAlertActionBrand>)[APPROVED_CREATE_ALERT_ACTION] !== true) {
    throw new CreateAlertApprovalError("applyApprovedCreateAlert requires an approved create_alert action");
  }
  assertCreateAlertPendingAction(action);
}

function assertUuidString(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new CreateAlertApprovalError(`${label} must be a UUID`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CreateAlertApprovalError(`${label} must be a non-empty string`);
  }
}
