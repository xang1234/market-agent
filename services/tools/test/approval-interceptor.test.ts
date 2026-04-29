import test from "node:test";
import assert from "node:assert/strict";

import { interceptToolCall } from "../src/approval-interceptor.ts";
import { loadToolRegistry } from "../src/registry.ts";

test("interceptToolCall routes create_alert through a pending approval action", () => {
  const registry = loadToolRegistry();

  const interception = interceptToolCall({
    registry,
    bundle_id: "alert_management",
    audience: "analyst",
    tool_name: "create_alert",
    arguments: {
      subject_ref: {
        kind: "issuer",
        id: "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b",
      },
      rule: { metric: "price", operator: ">", value: 250 },
      channels: ["in_app"],
    },
    idempotency_key: "turn-1/tool-1",
  });

  assert.equal(interception.ok, true);
  assert.equal(interception.action, "pending_approval");
  assert.equal(interception.tool.name, "create_alert");
  assert.equal(interception.pending_action.tool_name, "create_alert");
  assert.equal(interception.pending_action.approval_required, true);
  assert.equal(interception.pending_action.read_only, false);
  assert.equal(
    interception.pending_action.pending_action_id,
    "b72a1c82-bf7b-58ed-8b81-081ca8ec9948",
  );
  assert.equal(Object.isFrozen(interception), true);
  assert.equal(Object.isFrozen(interception.pending_action), true);
});

test("interceptToolCall pending action id generation does not depend on localeCompare", () => {
  const registry = loadToolRegistry();
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function localeCompareMustNotBeCalled() {
    throw new Error("localeCompare must not be used for pending action ids");
  };

  try {
    const interception = interceptToolCall({
      registry,
      bundle_id: "alert_management",
      audience: "analyst",
      tool_name: "create_alert",
      arguments: {
        z_key: "last",
        a_key: "first",
      },
      idempotency_key: "turn-1/tool-2",
    });

    assert.equal(interception.ok, true);
    assert.equal(interception.action, "pending_approval");
    assert.match(
      interception.pending_action.pending_action_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("interceptToolCall routes create_agent through a pending approval action", () => {
  const registry = loadToolRegistry();

  const interception = interceptToolCall({
    registry,
    bundle_id: "agent_management",
    audience: "analyst",
    tool_name: "create_agent",
    arguments: {
      name: "Margin recovery monitor",
      thesis: "Track margin recovery after inventory normalization",
      universe: { subject_refs: [] },
      cadence: "daily",
      prompt_template: "segment_margin_watch",
    },
    idempotency_key: "turn-2/tool-1",
  });

  assert.equal(interception.ok, true);
  assert.equal(interception.action, "pending_approval");
  assert.equal(interception.pending_action.tool_name, "create_agent");
  assert.equal(interception.pending_action.bundle_id, "agent_management");
  assert.deepEqual(interception.pending_action.arguments, {
    name: "Margin recovery monitor",
    thesis: "Track margin recovery after inventory normalization",
    universe: { subject_refs: [] },
    cadence: "daily",
    prompt_template: "segment_margin_watch",
  });
});

test("interceptToolCall allows non-approval write-intent tools but flags the policy boundary", () => {
  const registry = loadToolRegistry();

  const interception = interceptToolCall({
    registry,
    bundle_id: "alert_management",
    audience: "analyst",
    tool_name: "add_to_watchlist",
    arguments: {
      watchlist_id: "primary",
      subject_ref: {
        kind: "issuer",
        id: "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b",
      },
    },
  });

  assert.equal(interception.ok, true);
  assert.equal(interception.action, "execute");
  assert.equal(interception.approval_required, false);
  assert.equal(interception.write_intent, true);
});

test("interceptToolCall rejects reader-only tools before approval handling", () => {
  const registry = loadToolRegistry();

  const interception = interceptToolCall({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "fetch_raw_document",
    arguments: {
      document_id: "70a0cc2e-e198-4b59-a5c9-9bd2da4a359b",
    },
  });

  assert.equal(interception.ok, false);
  assert.equal(interception.reason, "audience_mismatch");
});
