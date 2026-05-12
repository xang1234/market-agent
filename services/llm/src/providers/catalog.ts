import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type LlmReasoningEffort = "off" | "low" | "medium" | "high" | "max";

export const LLM_REASONING_EFFORTS = [
  "off",
  "low",
  "medium",
  "high",
  "max",
] as const satisfies ReadonlyArray<LlmReasoningEffort>;

export type LlmProviderCatalogEntry = {
  id: string;
  label: string;
  default_base_url: string | null;
  default_model: string | null;
  suggested_models: ReadonlyArray<string>;
  requires_key: boolean;
  base_url_editable: boolean;
  supports_reasoning_effort: boolean;
  supports_tools: boolean;
  supports_json_mode: boolean;
  supports_streaming: boolean;
};

export type LlmProviderCatalog = ReadonlyArray<LlmProviderCatalogEntry>;

const CATALOG_PATH = fileURLToPath(new URL("./catalog.json", import.meta.url));

let cached: LlmProviderCatalog | null = null;

export async function loadLlmProviderCatalog(): Promise<LlmProviderCatalog> {
  if (cached !== null) return cached;
  const raw = await readFile(CATALOG_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  cached = validateCatalog(parsed);
  return cached;
}

export function resetLlmProviderCatalogCacheForTests(): void {
  cached = null;
}

export function getProviderEntry(
  catalog: LlmProviderCatalog,
  providerId: string,
): LlmProviderCatalogEntry | null {
  return catalog.find((entry) => entry.id === providerId) ?? null;
}

export function requireProviderEntry(
  catalog: LlmProviderCatalog,
  providerId: string,
): LlmProviderCatalogEntry {
  const entry = getProviderEntry(catalog, providerId);
  if (entry === null) {
    throw new Error(`unknown provider_id '${providerId}'`);
  }
  return entry;
}

function validateCatalog(value: unknown): LlmProviderCatalog {
  if (!Array.isArray(value)) {
    throw new Error("llm provider catalog must be an array");
  }
  const seen = new Set<string>();
  const entries: LlmProviderCatalogEntry[] = value.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`catalog[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const id = requireString(record.id, `catalog[${index}].id`);
    if (seen.has(id)) {
      throw new Error(`catalog[${index}].id '${id}' is duplicated`);
    }
    seen.add(id);
    const suggestedModels = record.suggested_models;
    if (!Array.isArray(suggestedModels)) {
      throw new Error(`catalog[${index}].suggested_models must be an array`);
    }
    return Object.freeze({
      id,
      label: requireString(record.label, `catalog[${index}].label`),
      default_base_url: nullableString(record.default_base_url, `catalog[${index}].default_base_url`),
      default_model: nullableString(record.default_model, `catalog[${index}].default_model`),
      suggested_models: Object.freeze(
        suggestedModels.map((model, modelIndex) =>
          requireString(model, `catalog[${index}].suggested_models[${modelIndex}]`),
        ),
      ),
      requires_key: requireBoolean(record.requires_key, `catalog[${index}].requires_key`),
      base_url_editable: requireBoolean(record.base_url_editable, `catalog[${index}].base_url_editable`),
      supports_reasoning_effort: requireBoolean(
        record.supports_reasoning_effort,
        `catalog[${index}].supports_reasoning_effort`,
      ),
      supports_tools: requireBoolean(record.supports_tools, `catalog[${index}].supports_tools`),
      supports_json_mode: requireBoolean(record.supports_json_mode, `catalog[${index}].supports_json_mode`),
      supports_streaming: requireBoolean(record.supports_streaming, `catalog[${index}].supports_streaming`),
    });
  });
  return Object.freeze(entries);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be null or a non-empty string`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}
