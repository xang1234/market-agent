import playbookCatalog from "../../../spec/commodities_analyze_playbooks.json" with { type: "json" };
import {
  AnalyzePlaybookCatalogError,
  parseAnalyzePlaybookCatalog,
  SOURCE_CATEGORIES,
  type AnalyzePlaybook,
  type SourceCategory,
} from "../../../spec/commodities_analyze_catalog.ts";

export {
  AnalyzePlaybookCatalogError,
  parseAnalyzePlaybookCatalog,
  type AnalyzePlaybook,
  type AnalyzePlaybookSection,
} from "../../../spec/commodities_analyze_catalog.ts";

export type AnalyzePlaybookRunRequest = {
  playbook_id: string;
  instructions?: string;
  source_categories?: unknown;
};

export type ResolvedAnalyzePlaybookRequest = {
  playbook: AnalyzePlaybook;
  instructions: string;
  source_categories: ReadonlyArray<SourceCategory>;
  prompt: string;
};

export class AnalyzePlaybookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzePlaybookError";
  }
}

export const ANALYZE_PLAYBOOKS: ReadonlyArray<AnalyzePlaybook> = parseAnalyzePlaybookCatalog(playbookCatalog);

export function resolveAnalyzePlaybookRequest(
  input: AnalyzePlaybookRunRequest,
): ResolvedAnalyzePlaybookRequest {
  const playbook = ANALYZE_PLAYBOOKS.find((item) => item.playbook_id === input.playbook_id);
  if (!playbook) throw new AnalyzePlaybookError("playbook_id is unknown");

  const instructions = normalizeText(input.instructions) ?? playbook.default_instructions;
  const sourceCategories = input.source_categories === undefined
    ? playbook.default_source_categories
    : parseAnalyzeSourceCategories(input.source_categories);

  return Object.freeze({
    playbook,
    instructions,
    source_categories: Object.freeze([...sourceCategories]),
    prompt: [
      `${playbook.name}: ${playbook.description}`,
      `Instructions: ${instructions}`,
      `Required sections: ${playbook.sections.map((section) => section.title).join("; ")}`,
      `Source categories: ${sourceCategories.join(", ")}`,
    ].join("\n"),
  });
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function parseAnalyzeSourceCategories(value: unknown): ReadonlyArray<SourceCategory> {
  if (!Array.isArray(value)) throw new AnalyzePlaybookError("source_categories must be an array");
  const seen = new Set<SourceCategory>();
  const categories: SourceCategory[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new AnalyzePlaybookError(`source_categories[${index}] must be a non-empty string`);
    }
    const category = item.trim();
    if (!SOURCE_CATEGORIES.includes(category as SourceCategory)) {
      throw new AnalyzePlaybookError(`source_categories[${index}]: unknown source category "${category}"`);
    }
    const sourceCategory = category as SourceCategory;
    if (!seen.has(sourceCategory)) {
      seen.add(sourceCategory);
      categories.push(sourceCategory);
    }
  });
  return Object.freeze(categories);
}
