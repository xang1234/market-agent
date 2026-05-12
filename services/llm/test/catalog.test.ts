import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderEntry,
  loadLlmProviderCatalog,
  requireProviderEntry,
  resetLlmProviderCatalogCacheForTests,
} from "../src/providers/catalog.ts";

test("catalog loads and is a non-empty frozen array", async () => {
  resetLlmProviderCatalogCacheForTests();
  const catalog = await loadLlmProviderCatalog();
  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length > 0);
  assert.ok(Object.isFrozen(catalog));
});

test("catalog includes the documented providers", async () => {
  const catalog = await loadLlmProviderCatalog();
  const ids = catalog.map((entry) => entry.id);
  assert.ok(ids.includes("openai"));
  assert.ok(ids.includes("openai_compatible"));
});

test("openai entry has the expected defaults", async () => {
  const catalog = await loadLlmProviderCatalog();
  const openai = requireProviderEntry(catalog, "openai");
  assert.equal(openai.default_base_url, "https://api.openai.com/v1");
  assert.equal(openai.requires_key, true);
  assert.equal(openai.supports_reasoning_effort, true);
});

test("openai_compatible allows base url override and does not require a key", async () => {
  const catalog = await loadLlmProviderCatalog();
  const compat = requireProviderEntry(catalog, "openai_compatible");
  assert.equal(compat.base_url_editable, true);
  assert.equal(compat.requires_key, false);
});

test("requireProviderEntry throws on unknown ids", async () => {
  const catalog = await loadLlmProviderCatalog();
  assert.throws(() => requireProviderEntry(catalog, "does-not-exist"));
  assert.equal(getProviderEntry(catalog, "does-not-exist"), null);
});

test("loadLlmProviderCatalog memoizes the parsed result", async () => {
  resetLlmProviderCatalogCacheForTests();
  const first = await loadLlmProviderCatalog();
  const second = await loadLlmProviderCatalog();
  assert.equal(first, second);
});
