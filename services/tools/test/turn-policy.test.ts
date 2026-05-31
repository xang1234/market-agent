import test from "node:test";
import assert from "node:assert/strict";

import {
  createTurnToolPolicy,
} from "../src/turn-policy.ts";
import { DEFAULT_TOOL_CALL_BUDGET } from "../src/budget-gate.ts";
import { loadToolRegistry, type ToolDefinition } from "../src/registry.ts";

test("createTurnToolPolicy selects each registered bundle with a default budget", () => {
  const registry = loadToolRegistry();

  assert.equal(registry.bundleIds().length, 8);
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

test("createTurnToolPolicy forwards prompt prefix context into bundle selection", () => {
  const registry = loadToolRegistry();

  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "event_impact_analysis" },
    response_schema: { schema_id: "commodities_research_blocks/v1" },
    few_shots: [{ name: "impact_example", content: "Map drivers to channel and horizon." }],
    thread_summary: "Preparing the copper morning call.",
    resolved_context: {
      subjects: [{ kind: "commodity", id: "00000000-0000-4000-8000-000000000001" }],
    },
    user_turn: "What changed in the latest port disruption?",
  });

  assert.equal(policy.ok, true);
  assert.equal(policy.selection.prompt_cache_prefix.user_turn, "What changed in the latest port disruption?");
  assert.equal(
    policy.selection.prompt_cache_prefix.messages.some((message) =>
      message.content.includes("Preparing the copper morning call"),
    ),
    true,
  );
  assert.equal(
    policy.selection.prompt_cache_prefix.messages.some((message) =>
      message.content.includes("latest port disruption"),
    ),
    false,
  );

  const decision = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  assert.equal(decision.ok, true);
  const nextPolicy = policy.recordAcceptedToolCall(decision);
  assert.equal(nextPolicy.ok, true);
  assert.equal(
    nextPolicy.selection.prompt_cache_prefix.user_turn,
    "What changed in the latest port disruption?",
  );
  assert.equal(
    nextPolicy.selection.prompt_cache_prefix.messages.some((message) =>
      message.content.includes("Preparing the copper morning call"),
    ),
    true,
  );
  assert.equal(
    nextPolicy.selection.prompt_cache_prefix.messages.some((message) =>
      message.content.includes("latest port disruption"),
    ),
    false,
  );
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

test("createTurnToolPolicy validates budget and usage before bundle selection", () => {
  const registry = loadToolRegistry();

  assert.throws(
    () =>
      createTurnToolPolicy({
        registry,
        audience: "analyst",
        classification: { bundle_id: "made_up_bundle" },
        budget: { low: -1 },
      }),
    /budget\.low: must be a non-negative integer/,
  );
  assert.throws(
    () =>
      createTurnToolPolicy({
        registry,
        audience: "analyst",
        classification: { bundle_id: "made_up_bundle" },
        usage: { medium: -1 },
      }),
    /usage\.medium: must be a non-negative integer/,
  );
});

test("turn tool policy stress-limits cost classes and returns an explicit partial-answer note", () => {
  const registry = loadToolRegistry();
  let policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "event_impact_analysis" },
    budget: { low: 8, medium: 4, high: 2 },
  });
  assert.equal(policy.ok, true);

  for (let i = 0; i < 12; i += 1) {
    const decision = policy.checkToolCall({ tool_name: "get_impact_drivers" });
    if (i < 4) {
      assert.equal(decision.ok, true);
      assert.equal(decision.cost_class, "medium");
      policy = policy.recordAcceptedToolCall(decision);
      continue;
    }

    assert.deepEqual(decision, {
      ok: false,
      action: "partial_answer",
      reason: "budget_exceeded",
      tool_name: "get_impact_drivers",
      bundle_id: "event_impact_analysis",
      audience: "analyst",
      cost_class: "medium",
      used: 4,
      limit: 4,
      note:
        'Skipped tool "get_impact_drivers" because the medium-cost per-turn budget is exhausted; return a partial answer with available evidence.',
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
    classification: { bundle_id: "event_impact_analysis" },
  });
  assert.equal(policy.ok, true);

  const decision = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  assert.equal(decision.ok, true);

  const nextPolicy = policy.recordAcceptedToolCall(decision);
  assert.equal(nextPolicy.ok, true);
  assert.deepEqual(nextPolicy.usage, { low: 0, medium: 1, high: 0 });
});

test("turn tool policy rejects unverified usage progression inputs", () => {
  const registry = loadToolRegistry();
  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "event_impact_analysis" },
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
  assert.throws(
    () =>
      policy.recordAcceptedToolCall({
        ok: true,
        action: "execute",
        tool: registry.getTool("get_impact_drivers") as ToolDefinition,
        cost_class: "medium",
        used: 0,
        limit: 4,
        remaining: { low: 8, medium: 3, high: 2 },
      } as never),
    /accepted tool-call decision/,
  );
});

test("turn tool policy rejects cross-policy and replayed accepted decisions", () => {
  const registry = loadToolRegistry();
  const firstPolicy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "event_impact_analysis" },
  });
  const secondPolicy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "commodity_quote_lookup" },
  });
  assert.equal(firstPolicy.ok, true);
  assert.equal(secondPolicy.ok, true);

  const decision = firstPolicy.checkToolCall({ tool_name: "get_impact_drivers" });
  assert.equal(decision.ok, true);

  assert.throws(
    () => secondPolicy.recordAcceptedToolCall(decision),
    /accepted tool-call decision/,
  );

  const nextPolicy = firstPolicy.recordAcceptedToolCall(decision);
  assert.equal(nextPolicy.ok, true);
  assert.throws(
    () => firstPolicy.recordAcceptedToolCall(decision),
    /accepted tool-call decision/,
  );
});

test("turn tool policy reserves budget for accepted decisions before they are recorded", () => {
  const registry = loadToolRegistry();
  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "event_impact_analysis" },
    budget: { low: 8, medium: 4, high: 2 },
  });
  assert.equal(policy.ok, true);

  const first = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  const second = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  const third = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  const fourth = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  const fifth = policy.checkToolCall({ tool_name: "get_impact_drivers" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.equal(fourth.ok, true);
  assert.equal(fifth.ok, false);
  assert.equal(fifth.reason, "budget_exceeded");
  assert.equal(fifth.used, 4);
  assert.equal(fifth.limit, 4);
});

test("turn tool policy records batched accepted decisions in reservation order", () => {
  const registry = loadToolRegistry();
  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "event_impact_analysis" },
    budget: { low: 8, medium: 4, high: 2 },
  });
  assert.equal(policy.ok, true);

  const first = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  const second = policy.checkToolCall({ tool_name: "get_impact_drivers" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const nextPolicy = policy.recordAcceptedToolCall(first);
  assert.equal(nextPolicy.ok, true);
  const finalPolicy = nextPolicy.recordAcceptedToolCall(second);
  assert.equal(finalPolicy.ok, true);
  assert.deepEqual(finalPolicy.usage, { low: 0, medium: 2, high: 0 });

  assert.throws(
    () => policy.recordAcceptedToolCall(second),
    /accepted tool-call decision/,
  );
});

test("turn tool policy keeps model-selected tools inside the system-selected bundle", () => {
  const registry = loadToolRegistry();
  const policy = createTurnToolPolicy({
    registry,
    audience: "analyst",
    classification: { bundle_id: "commodity_quote_lookup" },
  });
  assert.equal(policy.ok, true);

  const decision = policy.checkToolCall({ tool_name: "get_impact_drivers" });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "tool_not_in_bundle");
  assert.equal(decision.bundle_id, "commodity_quote_lookup");
});
