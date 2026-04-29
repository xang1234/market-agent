import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TOOL_CALL_BUDGET,
  checkToolCallBudget,
  recordToolCallUsage,
} from "../src/budget-gate.ts";
import { loadToolRegistry } from "../src/registry.ts";

test("checkToolCallBudget allows calls while cost-class usage is below the per-turn cap", () => {
  const registry = loadToolRegistry();

  const decision = checkToolCallBudget({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "get_claims",
    usage: { low: 0, medium: 1, high: 0 },
    budget: { low: 8, medium: 3, high: 1 },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "execute");
  assert.equal(decision.cost_class, "medium");
  assert.equal(decision.remaining.medium, 1);
  assert.equal(Object.isFrozen(decision), true);
});

test("checkToolCallBudget produces a partial-answer path when a cost-class cap is exceeded", () => {
  const registry = loadToolRegistry();

  const decision = checkToolCallBudget({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "get_claims",
    usage: { low: 0, medium: 3, high: 0 },
    budget: { low: 8, medium: 3, high: 1 },
  });

  assert.deepEqual(decision, {
    ok: false,
    action: "partial_answer",
    reason: "budget_exceeded",
    tool_name: "get_claims",
    bundle_id: "document_research",
    audience: "analyst",
    cost_class: "medium",
    used: 3,
    limit: 3,
    note:
      'Skipped tool "get_claims" because the medium-cost per-turn budget is exhausted; return a partial answer with available evidence.',
  });
});

test("checkToolCallBudget stress-limits high-cost tools independently from low-cost tools", () => {
  const registry = loadToolRegistry();
  let usage = { low: 0, medium: 0, high: 0 };

  for (let i = 0; i < DEFAULT_TOOL_CALL_BUDGET.high; i += 1) {
    const decision = checkToolCallBudget({
      registry,
      bundle_id: "single_subject_analysis",
      audience: "analyst",
      tool_name: "get_segment_facts",
      usage,
      budget: DEFAULT_TOOL_CALL_BUDGET,
    });
    assert.equal(decision.ok, true);
    usage = recordToolCallUsage(usage, decision.tool);
  }

  const exhausted = checkToolCallBudget({
    registry,
    bundle_id: "single_subject_analysis",
    audience: "analyst",
    tool_name: "get_segment_facts",
    usage,
    budget: DEFAULT_TOOL_CALL_BUDGET,
  });
  const lowCost = checkToolCallBudget({
    registry,
    bundle_id: "single_subject_analysis",
    audience: "analyst",
    tool_name: "resolve_subjects",
    usage,
    budget: DEFAULT_TOOL_CALL_BUDGET,
  });

  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.cost_class, "high");
  assert.equal(lowCost.ok, true);
  assert.equal(lowCost.cost_class, "low");
});

test("checkToolCallBudget rejects unauthorized tool calls before budget handling", () => {
  const registry = loadToolRegistry();

  const decision = checkToolCallBudget({
    registry,
    bundle_id: "document_research",
    audience: "analyst",
    tool_name: "fetch_raw_document",
    usage: { low: 0, medium: 0, high: 0 },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "audience_mismatch");
});
