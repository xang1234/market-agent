import { createHash } from "node:crypto";

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

export type ApprovalInterceptionInput = {
  registry: ToolRegistry;
  bundle_id: string;
  audience: ToolAudience;
  tool_name: string;
  arguments?: JsonValue;
  idempotency_key?: string;
};

export type PendingToolAction = {
  pending_action_id: string;
  tool_name: string;
  bundle_id: string;
  audience: ToolAudience;
  arguments?: JsonValue;
  approval_required: true;
  read_only: false;
  cost_class: ToolCostClass;
  idempotency_key?: string;
};

export type ApprovalInterception =
  | {
      ok: true;
      action: "execute";
      tool: ToolDefinition;
      approval_required: false;
      write_intent: boolean;
    }
  | {
      ok: true;
      action: "pending_approval";
      tool: ToolDefinition;
      pending_action: PendingToolAction;
    }
  | ToolCallRejection;

type ToolCallRejection = Extract<ToolCallAuthorization, { ok: false }>;

export function interceptToolCall(
  input: ApprovalInterceptionInput,
): ApprovalInterception {
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

  if (!authorization.tool.approval_required) {
    return Object.freeze({
      ok: true,
      action: "execute",
      tool: authorization.tool,
      approval_required: false,
      write_intent: !authorization.tool.read_only,
    });
  }

  if (authorization.tool.read_only) {
    throw new Error(
      `approval interceptor: tool "${authorization.tool.name}" cannot be both read-only and approval-required`,
    );
  }

  return Object.freeze({
    ok: true,
    action: "pending_approval",
    tool: authorization.tool,
    pending_action: buildPendingToolAction(input, authorization.tool),
  });
}

function buildPendingToolAction(
  input: ApprovalInterceptionInput,
  tool: ToolDefinition,
): PendingToolAction {
  const action = {
    pending_action_id: pendingActionId(input),
    tool_name: tool.name,
    bundle_id: input.bundle_id,
    audience: input.audience,
    ...(input.arguments === undefined
      ? {}
      : { arguments: deepFreezeJson(cloneJson(input.arguments)) }),
    approval_required: true,
    read_only: false,
    cost_class: tool.cost_class,
    ...(input.idempotency_key === undefined
      ? {}
      : { idempotency_key: input.idempotency_key }),
  } satisfies PendingToolAction;

  return Object.freeze(action);
}

function pendingActionId(input: ApprovalInterceptionInput): string {
  const seed = {
    tool_name: input.tool_name,
    bundle_id: input.bundle_id,
    audience: input.audience,
    arguments: input.arguments ?? null,
    idempotency_key: input.idempotency_key ?? null,
  };
  const digest = createHash("sha256")
    .update(stableJson(seed))
    .digest("hex")
    .slice(0, 32);
  return deterministicUuid(digest);
}

function deterministicUuid(hex: string): string {
  const chars = [...hex];
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars
    .slice(12, 16)
    .join("")}-${chars.slice(16, 20).join("")}-${chars
    .slice(20, 32)
    .join("")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneJson(item)));
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
    ),
  );
}

function deepFreezeJson<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) {
        deepFreezeJson(item);
      }
    } else {
      for (const item of Object.values(value)) {
        deepFreezeJson(item);
      }
    }
    Object.freeze(value);
  }
  return value;
}
