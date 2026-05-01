// fra-oc8: User-facing "source categories" → internal tool bundle ids.
//
// AnalyzeTemplate.source_categories[] holds names users select in the
// analyze UI ("financials_quarterly", "news", ...). The orchestrator
// must NOT expose raw internal tool/bundle names to users (per
// fra-7vn.2: "Do NOT expose raw internal tool names to users. Keep UI
// vocabulary at 'source categories' + 'layout hints'."), so this
// module is the one place that translates the user vocabulary into
// the bundle vocabulary that services/tools/* speaks.
//
// The mapping is declarative + auditable: SOURCE_CATEGORY_BUNDLES is
// the single source of truth and is exported so any caller (tests,
// admin tools, the analyze UI) can render or audit the table directly.

// The umbrella bundle that owns the analyze prompt template + few-shots
// (see services/tools/src/prompt-templates.ts). Every analyze run
// carries this regardless of which source categories the user picked.
export const ANALYZE_BASE_BUNDLE_ID = "analyze_template_run";

// Declarative mapping table. Each user-facing category names a set of
// internal tool bundles whose tools may be drawn on for that category.
// Keep the bundle ids in sync with spec/finance_research_tool_registry.json
// — the drift test in test/source-category-mapping.test.ts catches
// mismatches at test time.
export const SOURCE_CATEGORY_BUNDLES = Object.freeze({
  company_profile: Object.freeze(["quote_lookup", "single_subject_analysis"]),
  financials_annual: Object.freeze(["single_subject_analysis"]),
  financials_quarterly: Object.freeze(["single_subject_analysis"]),
  estimates: Object.freeze(["single_subject_analysis"]),
  holders: Object.freeze(["single_subject_analysis"]),
  prices: Object.freeze(["quote_lookup", "single_subject_analysis"]),
  segments: Object.freeze(["segment_deep_dive"]),
  peers: Object.freeze(["peer_comparison"]),
  news: Object.freeze(["document_research"]),
  filings: Object.freeze(["filing_research"]),
  transcripts: Object.freeze(["document_research"]),
}) satisfies Readonly<Record<string, ReadonlyArray<string>>>;

export type SourceCategory = keyof typeof SOURCE_CATEGORY_BUNDLES;

export const SOURCE_CATEGORIES: ReadonlyArray<SourceCategory> = Object.freeze(
  Object.keys(SOURCE_CATEGORY_BUNDLES) as SourceCategory[],
);

export class SourceCategoryMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceCategoryMappingError";
  }
}

export type MapSourceCategoriesInput = {
  categories: ReadonlyArray<string>;
};

export type SourceCategoryMappingResult = {
  bundle_ids: ReadonlyArray<string>;
};

export function mapSourceCategoriesToBundles(
  input: MapSourceCategoriesInput,
): SourceCategoryMappingResult {
  if (!Array.isArray(input.categories)) {
    throw new SourceCategoryMappingError(
      "categories: must be an array of source category names",
    );
  }

  // Collect into a Set so duplicates collapse and order is decoupled
  // from input. The base bundle goes in first so it always sorts to a
  // stable position relative to the rest.
  const bundleIds = new Set<string>([ANALYZE_BASE_BUNDLE_ID]);

  input.categories.forEach((category, index) => {
    if (typeof category !== "string" || category.length === 0) {
      throw new SourceCategoryMappingError(
        `categories[${index}]: must be a non-empty string`,
      );
    }
    const bundles = SOURCE_CATEGORY_BUNDLES[category as SourceCategory];
    if (bundles === undefined) {
      throw new SourceCategoryMappingError(
        `categories[${index}]: unknown source category "${category}". Known categories: ${SOURCE_CATEGORIES.join(", ")}`,
      );
    }
    for (const bundleId of bundles) {
      bundleIds.add(bundleId);
    }
  });

  // Sort for determinism — callers (e.g. prompt cache prefix hashing)
  // need the same input to produce the same bundle list across runs.
  return Object.freeze({
    bundle_ids: Object.freeze([...bundleIds].sort()),
  });
}
