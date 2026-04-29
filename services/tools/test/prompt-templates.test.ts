import test from "node:test";
import assert from "node:assert/strict";

import { loadToolRegistry } from "../src/registry.ts";
import {
  ANALYST_PROMPT_TEMPLATE_VERSION,
  ANALYST_PROMPT_TEMPLATES,
  analystPromptTemplateForBundle,
  buildPromptCachePrefix,
  promptCachePrefixHash,
  validateAnalystPromptTemplates,
} from "../src/prompt-templates.ts";
import type { ToolDefinition } from "../src/registry.ts";

function registryTool(name: string): ToolDefinition {
  const tool = loadToolRegistry().getTool(name);
  assert.ok(tool);
  return tool;
}

test("analyst prompt templates cover every registered bundle exactly once", () => {
  const registry = loadToolRegistry();
  const validation = validateAnalystPromptTemplates(registry);

  assert.deepEqual(validation, {
    ok: true,
    expected_bundle_ids: registry.bundleIds(),
    template_bundle_ids: registry.bundleIds(),
    missing_bundle_ids: [],
    extra_bundle_ids: [],
    duplicate_bundle_ids: [],
  });
  assert.equal(ANALYST_PROMPT_TEMPLATES.length, 11);
});

test("each analyst prompt template carries system and policy prompts in the cache prefix", () => {
  for (const template of ANALYST_PROMPT_TEMPLATES) {
    assert.equal(Object.isFrozen(template), true);
    assert.equal(template.version, ANALYST_PROMPT_TEMPLATE_VERSION);
    assert.equal(template.system_prompt.includes(template.bundle_id), true);
    assert.equal(template.policy_prompt.includes(template.bundle_id), true);
    assert.equal(template.prompt_cache_prefix.cache_key, `analyst:${template.bundle_id}:${template.version}`);
    assert.deepEqual(
      template.prompt_cache_prefix.messages.map((message) => message.name),
      ["system", "bundle_policy"],
    );
    assert.deepEqual(
      template.prompt_cache_prefix.messages.map((message) => message.content),
      [template.system_prompt, template.policy_prompt],
    );
    assert.equal(Object.isFrozen(template.prompt_cache_prefix), true);
    assert.equal(Object.isFrozen(template.prompt_cache_prefix.messages), true);
  }
});

test("analystPromptTemplateForBundle returns the immutable template for a bundle", () => {
  const template = analystPromptTemplateForBundle("document_research");

  assert.ok(template);
  assert.equal(template.bundle_id, "document_research");
  assert.equal(Object.isFrozen(template), true);
  assert.equal(
    template.policy_prompt.includes("structured claims, events, facts, and evidence bundles"),
    true,
  );
});

test("buildPromptCachePrefix enforces cache-stable prompt ordering and excludes user turn", () => {
  const template = analystPromptTemplateForBundle("document_research");
  assert.ok(template);
  const userTurn = "What changed in the latest filing?";

  const prefix = buildPromptCachePrefix({
    template,
    tools: [registryTool("get_claims"), registryTool("get_events")],
    response_schema: { schema_id: "finance_research_blocks/v1" },
    few_shots: [{ name: "document_example", content: "Use structured evidence only." }],
    thread_summary: "User is researching AAPL supplier risk.",
    resolved_context: {
      subjects: [{ kind: "listing", id: "00000000-0000-4000-8000-000000000001" }],
      period: "FY2026",
    },
    user_turn: userTurn,
  });

  assert.deepEqual(
    prefix.messages.map((message) => message.name),
    [
      "tools",
      "system",
      "bundle_policy",
      "response_schema",
      "few_shots",
      "thread_summary",
      "resolved_context",
    ],
  );
  assert.equal(
    prefix.messages.some((message) => message.content === userTurn),
    false,
  );
  assert.equal(prefix.user_turn, userTurn);
  assert.equal(Object.isFrozen(prefix), true);
  assert.equal(Object.isFrozen(prefix.messages), true);
});

test("prompt-cache prefix hash is stable across volatile user turns within a bundle", () => {
  const template = analystPromptTemplateForBundle("single_subject_analysis");
  assert.ok(template);
  const stableInput = {
    template,
    tools: [registryTool("resolve_subjects"), registryTool("get_statement_facts")],
    response_schema: { schema_id: "finance_research_blocks/v1" },
    few_shots: [{ name: "facts_table", content: "Return metric_row blocks." }],
    thread_summary: "User is tracking quarterly margin recovery.",
    resolved_context: {
      subjects: [{ kind: "listing", id: "00000000-0000-4000-8000-000000000001" }],
      period: "FY2026",
    },
  };

  const first = buildPromptCachePrefix({
    ...stableInput,
    user_turn: "Summarize margins.",
  });
  const second = buildPromptCachePrefix({
    ...stableInput,
    user_turn: "Now compare revenue growth.",
  });
  const changedBundle = buildPromptCachePrefix({
    ...stableInput,
    template: analystPromptTemplateForBundle("peer_comparison")!,
    user_turn: "Now compare revenue growth.",
  });

  assert.equal(first.cache_key, second.cache_key);
  assert.equal(promptCachePrefixHash(first), promptCachePrefixHash(second));
  assert.notEqual(first.cache_key, changedBundle.cache_key);
  assert.notEqual(promptCachePrefixHash(first), promptCachePrefixHash(changedBundle));
});

test("prompt-cache prefix hash changes when selected tool definitions change", () => {
  const registry = loadToolRegistry();
  const template = analystPromptTemplateForBundle("document_research");
  assert.ok(template);
  const tool = registry.getTool("get_claims");
  assert.ok(tool);
  const baseInput = {
    template,
    response_schema: { schema_id: "finance_research_blocks/v1" },
    thread_summary: "Researching supplier risk.",
    resolved_context: {
      subjects: [{ kind: "listing", id: "00000000-0000-4000-8000-000000000001" }],
    },
  };

  const original = buildPromptCachePrefix({
    ...baseInput,
    tools: [tool],
  });
  const changed = buildPromptCachePrefix({
    ...baseInput,
    tools: [
      {
        ...tool,
        description: `${tool.description} Changed for cache invalidation.`,
      },
    ],
  });

  assert.notEqual(original.cache_key, changed.cache_key);
  assert.notEqual(promptCachePrefixHash(original), promptCachePrefixHash(changed));
});
