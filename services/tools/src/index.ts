export {
  selectToolBundle,
} from "./bundle-selector.ts";
export type {
  BundleSelection,
  BundleSelectionInput,
  PreResolveBundleClassification,
} from "./bundle-selector.ts";

export {
  RAW_DOCUMENT_FIELD_NAMES,
  assertRegistryAudienceBoundary,
  authorizeToolCall,
  toolsForAudience,
  validateRegistryAudienceBoundary,
} from "./audience-enforcement.ts";
export type {
  AudienceBoundaryViolation,
  AuthorizeToolCallInput,
  RegistryAudienceBoundaryValidation,
  ToolCallAuthorization,
  ToolsForAudienceInput,
} from "./audience-enforcement.ts";

export {
  DEFAULT_TOOL_REGISTRY_PATH,
  TOOL_AUDIENCES,
  TOOL_COST_CLASSES,
  TOOL_REGISTRY_PATH_ENV,
  TOOL_REGISTRY_RELATIVE_PATH,
  loadToolRegistry,
  parseToolRegistry,
  resolveToolRegistryPath,
} from "./registry.ts";
export type {
  JsonObject,
  JsonValue,
  LoadToolRegistryOptions,
  ResolveToolRegistryPathOptions,
  ToolAudience,
  ToolBundleDefinition,
  ToolCostClass,
  ToolDefinition,
  ToolRegistry,
} from "./registry.ts";
