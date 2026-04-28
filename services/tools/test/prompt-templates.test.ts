import test from "node:test";
import assert from "node:assert/strict";

import { loadToolRegistry } from "../src/registry.ts";
import {
  ANALYST_PROMPT_TEMPLATE_VERSION,
  ANALYST_PROMPT_TEMPLATES,
  analystPromptTemplateForBundle,
  validateAnalystPromptTemplates,
} from "../src/prompt-templates.ts";

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
      ["bundle_system", "bundle_policy"],
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
