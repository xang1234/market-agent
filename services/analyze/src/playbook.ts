import playbookCatalog from "../../../spec/commodities_analyze_playbooks.json" with { type: "json" };
import {
  AnalyzePlaybookCatalogError,
  parseAnalyzePlaybookCatalog,
  type AnalyzePlaybook,
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
  source_categories?: ReadonlyArray<string>;
};

export type ResolvedAnalyzePlaybookRequest = {
  playbook: AnalyzePlaybook;
  instructions: string;
  source_categories: ReadonlyArray<string>;
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
  const sourceCategories = normalizeSourceCategories(input.source_categories) ?? playbook.default_source_categories;

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

function normalizeSourceCategories(value: unknown): ReadonlyArray<string> | null {
  if (!Array.isArray(value)) return null;
  const categories = value
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim());
  return categories.length === 0 ? null : Object.freeze([...new Set(categories)]);
}
