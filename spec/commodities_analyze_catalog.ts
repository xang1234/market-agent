export const ANALYZE_BASE_BUNDLE_ID = "event_impact_analysis";

export const SOURCE_CATEGORY_BUNDLES = Object.freeze({
  prices: Object.freeze(["commodity_quote_lookup", "curve_analysis"]),
  curves: Object.freeze(["curve_analysis"]),
  inventories: Object.freeze(["balance_snapshot", "curve_analysis"]),
  port_stocks: Object.freeze(["balance_snapshot"]),
  licensed_reports: Object.freeze(["report_delta_analysis"]),
  news: Object.freeze(["event_impact_analysis"]),
  internal_forecasts: Object.freeze(["forecast_assumption_review"]),
  internal_notes: Object.freeze(["report_delta_analysis"]),
  macro: Object.freeze(["event_impact_analysis"]),
  balances: Object.freeze(["balance_snapshot"]),
}) satisfies Readonly<Record<string, ReadonlyArray<string>>>;

export type SourceCategory = keyof typeof SOURCE_CATEGORY_BUNDLES;

export const SOURCE_CATEGORIES: ReadonlyArray<SourceCategory> = Object.freeze(
  Object.keys(SOURCE_CATEGORY_BUNDLES) as SourceCategory[],
);

export const ANALYZE_PLAYBOOK_BLOCK_HINTS = [
  "rich_text",
  "metric_row",
  "table",
  "line_chart",
  "section",
  "daily_call_summary",
  "driver_board",
  "curve_chart",
  "spread_table",
  "inventory_bridge",
  "impact_matrix",
  "report_delta",
  "watch_item_table",
  "forecast_vs_market",
] as const;

export type AnalyzePlaybookBlockHint = (typeof ANALYZE_PLAYBOOK_BLOCK_HINTS)[number];

export type AnalyzePlaybookSection = {
  section_id: string;
  title: string;
  required: boolean;
  block_hint: AnalyzePlaybookBlockHint;
};

export type AnalyzePlaybook = {
  playbook_id: string;
  version: number;
  name: string;
  description: string;
  default_instructions: string;
  default_source_categories: ReadonlyArray<SourceCategory>;
  sections: ReadonlyArray<AnalyzePlaybookSection>;
};

export class AnalyzePlaybookCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzePlaybookCatalogError";
  }
}

export function parseAnalyzePlaybookCatalog(value: unknown): ReadonlyArray<AnalyzePlaybook> {
  if (!Array.isArray(value)) {
    throw new AnalyzePlaybookCatalogError("playbooks: must be an array");
  }
  if (value.length === 0) {
    throw new AnalyzePlaybookCatalogError("playbooks: must be non-empty");
  }

  const seenIds = new Set<string>();
  return Object.freeze(value.map((item, index) => {
    const playbook = parsePlaybook(item, `playbooks[${index}]`);
    if (seenIds.has(playbook.playbook_id)) {
      throw new AnalyzePlaybookCatalogError(`${playbook.playbook_id}: duplicate playbook_id`);
    }
    seenIds.add(playbook.playbook_id);
    return playbook;
  }));
}

function parsePlaybook(value: unknown, label: string): AnalyzePlaybook {
  const item = objectRecord(value, label);
  const playbookId = nonEmptyString(item.playbook_id, `${label}.playbook_id`);
  const version = positiveInteger(item.version, `${label}.version`);
  const sourceCategories = stringEnumArray(
    item.default_source_categories,
    SOURCE_CATEGORIES,
    `${label}.default_source_categories`,
  );
  const sections = parseSections(item.sections, `${label}.sections`);

  return Object.freeze({
    playbook_id: playbookId,
    version,
    name: nonEmptyString(item.name, `${label}.name`),
    description: nonEmptyString(item.description, `${label}.description`),
    default_instructions: nonEmptyString(item.default_instructions, `${label}.default_instructions`),
    default_source_categories: sourceCategories,
    sections,
  });
}

function parseSections(value: unknown, label: string): ReadonlyArray<AnalyzePlaybookSection> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AnalyzePlaybookCatalogError(`${label}: must be a non-empty array`);
  }
  const seenIds = new Set<string>();
  return Object.freeze(value.map((sectionValue, index) => {
    const section = objectRecord(sectionValue, `${label}[${index}]`);
    const sectionId = nonEmptyString(section.section_id, `${label}[${index}].section_id`);
    if (seenIds.has(sectionId)) {
      throw new AnalyzePlaybookCatalogError(`${label}[${index}].section_id: duplicate section_id`);
    }
    seenIds.add(sectionId);
    if (typeof section.required !== "boolean") {
      throw new AnalyzePlaybookCatalogError(`${label}[${index}].required: must be a boolean`);
    }
    return Object.freeze({
      section_id: sectionId,
      title: nonEmptyString(section.title, `${label}[${index}].title`),
      required: section.required,
      block_hint: stringEnum(
        section.block_hint,
        ANALYZE_PLAYBOOK_BLOCK_HINTS,
        `${label}[${index}].block_hint`,
      ),
    });
  }));
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyzePlaybookCatalogError(`${label}: must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AnalyzePlaybookCatalogError(`${label}: must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new AnalyzePlaybookCatalogError(`${label}: must be a positive integer`);
  }
  return value as number;
}

function stringEnum<T extends string>(value: unknown, choices: ReadonlyArray<T>, label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new AnalyzePlaybookCatalogError(`${label}: must be one of ${choices.join(", ")}`);
  }
  return value as T;
}

function stringEnumArray<T extends string>(
  value: unknown,
  choices: ReadonlyArray<T>,
  label: string,
): ReadonlyArray<T> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AnalyzePlaybookCatalogError(`${label}: must be a non-empty array`);
  }
  const seen = new Set<T>();
  return Object.freeze(value.map((item, index) => {
    const parsed = stringEnum(item, choices, `${label}[${index}]`);
    if (seen.has(parsed)) {
      throw new AnalyzePlaybookCatalogError(`${label}[${index}]: duplicate value ${parsed}`);
    }
    seen.add(parsed);
    return parsed;
  }));
}
