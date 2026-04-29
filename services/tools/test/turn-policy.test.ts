import test from "node:test";
import assert from "node:assert/strict";

import {
  createTurnToolPolicy,
} from "../src/turn-policy.ts";
import { DEFAULT_TOOL_CALL_BUDGET } from "../src/budget-gate.ts";
import { loadToolRegistry, type ToolDefinition } from "../src/registry.ts";

test("createTurnToolPolicy selects each registered bundle with a default budget", () => {
  const registry = loadToolRegistry();

  assert.equal(registry.bundleIds().length, 11);
  for (const bundle_id of registry.bundleIds()) {
    const policy = createTurnToolPolicy({
      registry,
      audience: "analyst",
      classification: { bundle_id },
    });

    assert.equal(policy.ok, true);
    assert.equal(policy.bundle_id, bundle_id);
    assert.deepEqual(policy.budget, DEFAULT_TOOL_CALL_BUDGET);
    assert.deepEqual(policy.usage, { low: 0, medium: 0, high: 0 });
    assert.equal(policy.selection.prompt_template.bundle_id, bundle_id);
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.budget), true);
    assert.equal(Object.isFrozen(policy.usage), true);
  }
});

test("createTurnToolPolicy returns the selector rejection for unknown bundles", () => {
  const registry = loadToolRegistry();

  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "made_up_bundle" },
  });

  assert.deepEqual(policy, {
    ok: false,
    reason: "unknown_bundle",
    audience: "analyst",
    bundle_id: "made_up_bundle",
    message: 'Unknown tool bundle "made_up_bundle"',
    available_bundle_ids: registry.bundleIds(),
  });
});

test("turn tool policy stress-limits cost classes and returns an explicit partial-answer note", () => {
  const registry = loadToolRegistry();
  let policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "single_subject_analysis" },
    budget: { low: 8, medium: 4, high: 2 },
  });
  assert.equal(policy.ok, true);

  for (let i = 0; i < 12; i += 1) {
    const decision = policy.checkToolCall({ tool_name: "get_segment_facts" });
    if (i < 2) {
      assert.equal(decision.ok, true);
      assert.equal(decision.cost_class, "high");
      policy = policy.recordAcceptedToolCall(decision);
      continue;
    }

    assert.deepEqual(decision, {
      ok: false,
      action: "partial_answer",
      reason: "budget_exceeded",
      tool_name: "get_segment_facts",
      bundle_id: "single_subject_analysis",
      audience: "analyst",
      cost_class: "high",
      used: 2,
      limit: 2,
      note:
        'Skipped tool "get_segment_facts" because the high-cost per-turn budget is exhausted; return a partial answer with available evidence.',
    });
  }

  const lowCostDecision = policy.checkToolCall({ tool_name: "resolve_subjects" });
  assert.equal(lowCostDecision.ok, true);
  assert.equal(lowCostDecision.cost_class, "low");
});

test("turn tool policy records usage only from accepted budget decisions", () => {
  const registry = loadToolRegistry();
  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "single_subject_analysis" },
  });
  assert.equal(policy.ok, true);

  const decision = policy.checkToolCall({ tool_name: "get_segment_facts" });
  assert.equal(decision.ok, true);

  const nextPolicy = policy.recordAcceptedToolCall(decision);
  assert.equal(nextPolicy.ok, true);
  assert.deepEqual(nextPolicy.usage, { low: 0, medium: 0, high: 1 });
});

test("turn tool policy rejects unverified usage progression inputs", () => {
  const registry = loadToolRegistry();
  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "single_subject_analysis" },
  });
  assert.equal(policy.ok, true);

  assert.throws(
    () => policy.recordAcceptedToolCall("low" as never),
    /accepted tool-call decision/,
  );
  assert.throws(
    () =>
      policy.recordAcceptedToolCall(
        registry.getTool("resolve_subjects") as ToolDefinition as never,
      ),
    /accepted tool-call decision/,
  );
});

test("turn tool policy keeps model-selected tools inside the system-selected bundle", () => {
  const registry = loadToolRegistry();
  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "quote_lookup" },
  });
  assert.equal(policy.ok, true);

  const decision = policy.checkToolCall({ tool_name: "get_segment_facts" });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "tool_not_in_bundle");
  assert.equal(decision.bundle_id, "quote_lookup");
});
