import assert from "node:assert/strict";
import test from "node:test";

import { loadToolRegistry } from "../../tools/src/registry.ts";
import {
  ANALYZE_BASE_BUNDLE_ID,
  SOURCE_CATEGORIES,
  SOURCE_CATEGORY_BUNDLES,
  SourceCategoryMappingError,
  mapSourceCategoriesToBundles,
} from "../src/source-category-mapping.ts";

test("mapSourceCategoriesToBundles always includes the event-impact base bundle", () => {
  const result = mapSourceCategoriesToBundles({ categories: [] });
  assert.deepEqual([...result.bundle_ids], [ANALYZE_BASE_BUNDLE_ID]);
});

test("mapSourceCategoriesToBundles maps a single category to its declared bundles", () => {
  const result = mapSourceCategoriesToBundles({
    categories: ["licensed_reports"],
  });
  assert.ok(result.bundle_ids.includes("report_delta_analysis"));
  assert.ok(result.bundle_ids.includes(ANALYZE_BASE_BUNDLE_ID));
});

test("mapSourceCategoriesToBundles maps prices into quote and curve analysis", () => {
  const result = mapSourceCategoriesToBundles({
    categories: ["prices"],
  });
  assert.deepEqual(
    new Set(result.bundle_ids),
    new Set([ANALYZE_BASE_BUNDLE_ID, "commodity_quote_lookup", "curve_analysis"]),
  );
});

test("mapSourceCategoriesToBundles preserves distinct commodities source granularity", () => {
  const result = mapSourceCategoriesToBundles({
    categories: ["inventories", "internal_forecasts", "licensed_reports"],
  });
  assert.deepEqual(
    new Set(result.bundle_ids),
    new Set([
      ANALYZE_BASE_BUNDLE_ID,
      "balance_snapshot",
      "curve_analysis",
      "forecast_assumption_review",
      "report_delta_analysis",
    ]),
  );
});

test("mapSourceCategoriesToBundles deduplicates duplicate categories in the input", () => {
  const single = mapSourceCategoriesToBundles({
    categories: ["news"],
  });
  const duplicated = mapSourceCategoriesToBundles({
    categories: ["news", "news"],
  });
  assert.deepEqual([...single.bundle_ids], [...duplicated.bundle_ids]);
});

test("mapSourceCategoriesToBundles returns deterministic bundle order across permutations", () => {
  const a = mapSourceCategoriesToBundles({
    categories: ["news", "licensed_reports", "prices"],
  });
  const b = mapSourceCategoriesToBundles({
    categories: ["prices", "licensed_reports", "news"],
  });
  assert.deepEqual([...a.bundle_ids], [...b.bundle_ids]);
});

test("mapSourceCategoriesToBundles throws SourceCategoryMappingError on an unknown category", () => {
  assert.throws(
    () =>
      mapSourceCategoriesToBundles({
        categories: ["prices", "fictional_category"],
      }),
    (err: unknown) =>
      err instanceof SourceCategoryMappingError &&
      /fictional_category/.test(err.message),
  );
});

test("mapSourceCategoriesToBundles rejects non-string category entries", () => {
  assert.throws(
    () =>
      mapSourceCategoriesToBundles({
        categories: [123 as unknown as string],
      }),
    (err: unknown) =>
      err instanceof SourceCategoryMappingError &&
      /must be a non-empty string/.test(err.message),
  );
});

test("SOURCE_CATEGORIES enumerates every key in SOURCE_CATEGORY_BUNDLES", () => {
  const tableKeys = Object.keys(SOURCE_CATEGORY_BUNDLES).sort();
  const enumValues = [...SOURCE_CATEGORIES].sort();
  assert.deepEqual(enumValues, tableKeys);
});

test("every bundle id named in SOURCE_CATEGORY_BUNDLES exists in the tool registry", () => {
  const registry = loadToolRegistry();
  const knownBundleIds = new Set(registry.bundleIds());
  assert.ok(
    knownBundleIds.has(ANALYZE_BASE_BUNDLE_ID),
    `${ANALYZE_BASE_BUNDLE_ID} must be a real bundle in spec/finance_research_tool_registry.json`,
  );
  for (const [category, bundles] of Object.entries(SOURCE_CATEGORY_BUNDLES)) {
    for (const bundleId of bundles) {
      assert.ok(
        knownBundleIds.has(bundleId),
        `category "${category}" references unknown bundle "${bundleId}"`,
      );
    }
  }
});

test("all built-in playbook default source categories are mappable", async () => {
  const { ANALYZE_PLAYBOOKS } = await import("../src/playbook.ts");
  for (const playbook of ANALYZE_PLAYBOOKS) {
    assert.doesNotThrow(
      () => mapSourceCategoriesToBundles({ categories: playbook.default_source_categories }),
      `playbook ${playbook.playbook_id} has unmapped source categories`,
    );
  }
});

test("golden template: daily copper call maps to expected bundles", () => {
  const result = mapSourceCategoriesToBundles({
    categories: ["prices", "curves", "inventories", "licensed_reports", "news", "internal_forecasts"],
  });
  const expected = new Set([
    ANALYZE_BASE_BUNDLE_ID,
    "commodity_quote_lookup",
    "curve_analysis",
    "balance_snapshot",
    "report_delta_analysis",
    "forecast_assumption_review",
  ]);
  assert.deepEqual(new Set(result.bundle_ids), expected);
  assert.deepEqual([...result.bundle_ids], [...expected].sort());
});

test("golden template: supply shock readout maps to expected bundles", () => {
  const result = mapSourceCategoriesToBundles({
    categories: ["news", "licensed_reports", "internal_notes", "inventories"],
  });
  const expected = new Set([
    ANALYZE_BASE_BUNDLE_ID,
    "report_delta_analysis",
    "balance_snapshot",
    "curve_analysis",
  ]);
  assert.deepEqual(new Set(result.bundle_ids), expected);
  assert.deepEqual([...result.bundle_ids], [...expected].sort());
});
