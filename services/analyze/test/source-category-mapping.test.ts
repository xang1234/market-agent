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

test("mapSourceCategoriesToBundles always includes the analyze base bundle", () => {
  // The analyze_template_run bundle owns the prompt template + few-shots
  // for the analyze surface. Every run needs it regardless of which
  // source categories the user picked, so the mapping always
  // unconditionally includes it. Without it, the orchestrator would
  // have to remember to add the base bundle separately, which is the
  // class of bug this bead is meant to make impossible.
  const result = mapSourceCategoriesToBundles({ categories: [] });
  assert.deepEqual([...result.bundle_ids], [ANALYZE_BASE_BUNDLE_ID]);
});

test("mapSourceCategoriesToBundles maps a single category to its declared bundles", () => {
  const result = mapSourceCategoriesToBundles({
    categories: ["financials_quarterly"],
  });
  assert.ok(result.bundle_ids.includes("financials_analysis"));
  assert.ok(result.bundle_ids.includes(ANALYZE_BASE_BUNDLE_ID));
});

test("mapSourceCategoriesToBundles preserves distinct analysis granularity for focused sources", () => {
  const result = mapSourceCategoriesToBundles({
    categories: ["financials_quarterly", "estimates", "holders"],
  });
  assert.deepEqual(
    new Set(result.bundle_ids),
    new Set([
      ANALYZE_BASE_BUNDLE_ID,
      "financials_analysis",
      "estimates_analysis",
      "ownership_analysis",
    ]),
  );
});

test("mapSourceCategoriesToBundles deduplicates duplicate categories in the input", () => {
  // A template author who lists the same category twice in
  // source_categories should get the same result as listing it once.
  // The mapping is set-valued in spirit — the input is a list because
  // postgres jsonb columns surface as arrays, not because order or
  // multiplicity carries meaning.
  const single = mapSourceCategoriesToBundles({
    categories: ["news"],
  });
  const duplicated = mapSourceCategoriesToBundles({
    categories: ["news", "news"],
  });
  assert.deepEqual([...single.bundle_ids], [...duplicated.bundle_ids]);
});

test("mapSourceCategoriesToBundles returns deterministic bundle order across permutations", () => {
  // The mapping is consumed by callers that hash the bundle list (e.g.
  // prompt_cache_prefix in services/tools/src/bundle-selector.ts) — a
  // non-deterministic order would break cache hits across re-runs of
  // the same template.
  const a = mapSourceCategoriesToBundles({
    categories: ["news", "financials_quarterly", "peers"],
  });
  const b = mapSourceCategoriesToBundles({
    categories: ["peers", "financials_quarterly", "news"],
  });
  assert.deepEqual([...a.bundle_ids], [...b.bundle_ids]);
});

test("mapSourceCategoriesToBundles throws SourceCategoryMappingError on an unknown category", () => {
  // Unknown source categories must fail closed — silently dropping
  // them would hide template-author typos and produce memos with
  // missing data. The error names the offending category so the
  // analyze UI can surface a helpful validation message.
  assert.throws(
    () =>
      mapSourceCategoriesToBundles({
        categories: ["financials_quarterly", "fictional_category"],
      }),
    (err: unknown) =>
      err instanceof SourceCategoryMappingError &&
      /fictional_category/.test(err.message),
  );
});

test("mapSourceCategoriesToBundles rejects non-string category entries", () => {
  // The repo layer validates source_categories shape on
  // create/update, but a run that bypasses repo validation (or a row
  // hand-edited in the DB) could still pass through here. Fail closed.
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
  // The constant export and the table must stay in sync — a category
  // listed in SOURCE_CATEGORIES but missing from SOURCE_CATEGORY_BUNDLES
  // would map to an empty bundle list at runtime, silently degrading
  // the analyze run. This invariant catches drift at module load time.
  const tableKeys = Object.keys(SOURCE_CATEGORY_BUNDLES).sort();
  const enumValues = [...SOURCE_CATEGORIES].sort();
  assert.deepEqual(enumValues, tableKeys);
});

test("every bundle id named in SOURCE_CATEGORY_BUNDLES exists in the tool registry (drift guard)", () => {
  // The "auditable" half of the bead: if anyone ever renames a bundle
  // in spec/finance_research_tool_registry.json without updating this
  // table, the analyze runner would request a bundle the registry
  // doesn't know about and fail at orchestration time. Catch it at
  // test time instead.
  const registry = loadToolRegistry();
  const knownBundleIds = new Set(registry.bundleIds());
  // Plus the base bundle, which must also exist in the registry.
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

test("focused financial source categories do not all collapse to the broad single-subject bundle", () => {
  const focusedCategories = [
    "financials_annual",
    "financials_quarterly",
    "estimates",
    "holders",
  ] as const;
  const focusedBundleSets = focusedCategories.map((category) =>
    SOURCE_CATEGORY_BUNDLES[category].join(","),
  );
  assert.notEqual(
    new Set(focusedBundleSets).size,
    1,
    "financials, estimates, and holders need auditable bundle granularity",
  );
});

test("golden template: quarterly earnings memo maps to expected bundles", () => {
  // The bead's verification: "Golden templates map to expected
  // bundles." A "Quarterly earnings memo" (per fra-7vn.2 description)
  // would draw from financials_quarterly, estimates, and news. The
  // expected bundle set is the auditable contract that downstream
  // orchestration can rely on.
  const result = mapSourceCategoriesToBundles({
    categories: ["financials_quarterly", "estimates", "news"],
  });
  const expected = new Set([
    ANALYZE_BASE_BUNDLE_ID,
    "financials_analysis",
    "estimates_analysis",
    "document_research",
  ]);
  assert.deepEqual(new Set(result.bundle_ids), expected);
  // Pin order too — golden snapshots are the cache key for prompt
  // prefixes downstream, so a future change to the sort would
  // silently invalidate cached prompts in production.
  assert.deepEqual([...result.bundle_ids], [...expected].sort());
});

test("golden template: competitive snapshot maps to expected bundles", () => {
  // A second golden — "Competitive snapshot" pulls company profile +
  // peers + segments. Two distinct templates produce visibly
  // different bundle sets, demonstrating the mapping discriminates.
  const result = mapSourceCategoriesToBundles({
    categories: ["company_profile", "peers", "segments"],
  });
  const expected = new Set([
    ANALYZE_BASE_BUNDLE_ID,
    "quote_lookup",
    "single_subject_analysis",
    "peer_comparison",
    "segment_deep_dive",
  ]);
  assert.deepEqual(new Set(result.bundle_ids), expected);
  assert.deepEqual([...result.bundle_ids], [...expected].sort());
});
