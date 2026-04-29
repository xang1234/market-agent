import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ToolAudience = "reader" | "analyst";
export type ToolCostClass = "low" | "medium" | "high";

export const TOOL_AUDIENCES: ReadonlyArray<ToolAudience> = [
  "reader",
  "analyst",
];
export const TOOL_COST_CLASSES: ReadonlyArray<ToolCostClass> = [
  "low",
  "medium",
  "high",
];

export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | JsonObject;

export type ToolBundleDefinition = {
  bundle_id: string;
  description: string;
};

export type ToolDefinition = {
  name: string;
  audience: ToolAudience;
  bundles: ReadonlyArray<string>;
  description: string;
  read_only: boolean;
  approval_required: boolean;
  cost_class: ToolCostClass;
  freshness_expectation: string;
  input_json_schema: JsonObject;
  output_json_schema: JsonObject;
  error_codes: ReadonlyArray<string>;
};

export type ToolRegistry = {
  version: string;
  description: string;
  design_rules: ReadonlyArray<string>;
  bundles: ReadonlyArray<ToolBundleDefinition>;
  tools: ReadonlyArray<ToolDefinition>;
  bundleIds(): ReadonlyArray<string>;
  toolNames(): ReadonlyArray<string>;
  getBundle(bundleId: string): ToolBundleDefinition | undefined;
  getTool(name: string): ToolDefinition | undefined;
  toolsForBundle(bundleId: string): ReadonlyArray<ToolDefinition>;
};

export type LoadToolRegistryOptions = {
  registryPath?: string;
};

export type ResolveToolRegistryPathOptions = {
  registryPath?: string;
  moduleDir?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const TOOL_REGISTRY_RELATIVE_PATH =
  "spec/finance_research_tool_registry.json";
export const TOOL_REGISTRY_PATH_ENV = "FINANCE_RESEARCH_TOOL_REGISTRY_PATH";
export const DEFAULT_TOOL_REGISTRY_PATH = resolve(
  MODULE_DIR,
  "../../../",
  TOOL_REGISTRY_RELATIVE_PATH,
);

export function loadToolRegistry(
  options: LoadToolRegistryOptions = {},
): ToolRegistry {
  const registryPath = resolveToolRegistryPath(options);
  const raw = readFileSync(registryPath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`loadToolRegistry(${registryPath}): invalid JSON: ${message}`);
  }

  return parseToolRegistry(parsed, registryPath);
}

export function resolveToolRegistryPath(
  options: ResolveToolRegistryPathOptions = {},
): string {
  const env = options.env ?? process.env;
  const explicitPath = options.registryPath ?? env[TOOL_REGISTRY_PATH_ENV];
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const startDirs = uniqueStrings([
    options.moduleDir ?? MODULE_DIR,
    options.cwd ?? process.cwd(),
  ]);
  for (const startDir of startDirs) {
    const registryPath = findRegistryPathAbove(startDir);
    if (registryPath) {
      return registryPath;
    }
  }

  return DEFAULT_TOOL_REGISTRY_PATH;
}

export function parseToolRegistry(
  value: unknown,
  sourceLabel = "tool registry",
): ToolRegistry {
  const raw = assertRecord(value, sourceLabel);
  const version = nonEmptyString(raw.version, `${sourceLabel}.version`);
  const description = nonEmptyString(
    raw.description,
    `${sourceLabel}.description`,
  );
  const design_rules = freezeStringArray(
    raw.design_rules,
    `${sourceLabel}.design_rules`,
    { allowEmpty: true },
  );
  const bundles = freezeBundles(raw.bundles, `${sourceLabel}.bundles`);
  const bundleIds = new Set(bundles.map((bundle) => bundle.bundle_id));
  const tools = freezeTools(raw.tools, `${sourceLabel}.tools`, bundleIds);

  const bundlesById = new Map(
    bundles.map((bundle) => [bundle.bundle_id, bundle]),
  );
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolsByBundle = new Map<string, ReadonlyArray<ToolDefinition>>();

  for (const bundle of bundles) {
    toolsByBundle.set(
      bundle.bundle_id,
      Object.freeze(
        tools.filter((tool) => tool.bundles.includes(bundle.bundle_id)),
      ),
    );
  }

  return Object.freeze({
    version,
    description,
    design_rules,
    bundles,
    tools,
    bundleIds: () => Object.freeze([...bundlesById.keys()]),
    toolNames: () => Object.freeze([...toolsByName.keys()]),
    getBundle: (bundleId: string) => bundlesById.get(bundleId),
    getTool: (name: string) => toolsByName.get(name),
    toolsForBundle: (bundleId: string) => {
      const bundleTools = toolsByBundle.get(bundleId);
      if (!bundleTools) {
        throw new Error(`toolsForBundle: unknown bundle "${bundleId}"`);
      }
      return bundleTools;
    },
  });
}

function freezeBundles(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}: must be a non-empty array`);
  }

  const seen = new Set<string>();
  return Object.freeze(
    value.map((item, index) => {
      const itemLabel = `${label}[${index}]`;
      const raw = assertRecord(item, itemLabel);
      const bundle_id = nonEmptyString(raw.bundle_id, `${itemLabel}.bundle_id`);
      if (seen.has(bundle_id)) {
        throw new Error(`${itemLabel}.bundle_id: duplicate bundle "${bundle_id}"`);
      }
      seen.add(bundle_id);

      return Object.freeze({
        bundle_id,
        description: nonEmptyString(raw.description, `${itemLabel}.description`),
      });
    }),
  );
}

function freezeTools(
  value: unknown,
  label: string,
  bundleIds: ReadonlySet<string>,
) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}: must be a non-empty array`);
  }

  const seen = new Set<string>();
  return Object.freeze(
    value.map((item, index) => {
      const itemLabel = `${label}[${index}]`;
      const raw = assertRecord(item, itemLabel);
      const name = nonEmptyString(raw.name, `${itemLabel}.name`);
      if (seen.has(name)) {
        throw new Error(`${itemLabel}.name: duplicate tool "${name}"`);
      }
      seen.add(name);

      const bundles = freezeStringArray(raw.bundles, `${itemLabel}.bundles`);
      rejectDuplicateStrings(bundles, `${itemLabel}.bundles`, "bundle");
      for (const bundleId of bundles) {
        if (!bundleIds.has(bundleId)) {
          throw new Error(
            `${itemLabel}.bundles: tool "${name}" references unknown bundle "${bundleId}"`,
          );
        }
      }

      return Object.freeze({
        name,
        audience: oneOf(raw.audience, TOOL_AUDIENCES, `${itemLabel}.audience`),
        bundles,
        description: nonEmptyString(raw.description, `${itemLabel}.description`),
        read_only: booleanValue(raw.read_only, `${itemLabel}.read_only`),
        approval_required: booleanValue(
          raw.approval_required,
          `${itemLabel}.approval_required`,
        ),
        cost_class: oneOf(
          raw.cost_class,
          TOOL_COST_CLASSES,
          `${itemLabel}.cost_class`,
        ),
        freshness_expectation: nonEmptyString(
          raw.freshness_expectation,
          `${itemLabel}.freshness_expectation`,
        ),
        input_json_schema: jsonObject(
          raw.input_json_schema,
          `${itemLabel}.input_json_schema`,
        ),
        output_json_schema: jsonObject(
          raw.output_json_schema,
          `${itemLabel}.output_json_schema`,
        ),
        error_codes: freezeStringArray(
          raw.error_codes,
          `${itemLabel}.error_codes`,
        ),
      });
    }),
  );
}

function findRegistryPathAbove(startDir: string): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    const candidate = resolve(current, TOOL_REGISTRY_RELATIVE_PATH);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function uniqueStrings(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return Object.freeze([...new Set(values)]);
}

function rejectDuplicateStrings(
  values: ReadonlyArray<string>,
  label: string,
  noun: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label}: duplicate ${noun} "${value}"`);
    }
    seen.add(value);
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: must be a non-empty string`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label}: must be a boolean`);
  }
  return value;
}

function freezeStringArray(
  value: unknown,
  label: string,
  options: { allowEmpty?: boolean } = {},
): ReadonlyArray<string> {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`${label}: must be a non-empty array`);
  }

  return Object.freeze(
    value.map((item, index) => nonEmptyString(item, `${label}[${index}]`)),
  );
}

function oneOf<const T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label}: must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function jsonObject(value: unknown, label: string): JsonObject {
  assertJsonValue(value, label);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: must be a JSON object`);
  }
  return deepFreezeJson(value as JsonObject);
}

function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${label}: must be finite JSON number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${label}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${label}.${key}`);
    }
    return;
  }
  throw new Error(`${label}: must be JSON-compatible`);
}

function deepFreezeJson<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) {
        deepFreezeJson(item);
      }
    } else {
      for (const item of Object.values(value)) {
        deepFreezeJson(item);
      }
    }
    Object.freeze(value);
  }
  return value;
}
