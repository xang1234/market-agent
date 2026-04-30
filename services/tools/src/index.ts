export {
  selectToolBundle,
} from "./bundle-selector.ts";
export type {
  BundleSelection,
  BundleSelectionInput,
  PreResolveBundleClassification,
} from "./bundle-selector.ts";

export {
  ANALYST_PROMPT_TEMPLATES,
  ANALYST_PROMPT_TEMPLATE_VERSION,
  analystPromptTemplateBundleIds,
  analystPromptTemplateForBundle,
  assertAnalystPromptTemplates,
  buildPromptCachePrefix,
  promptCachePrefixHash,
  validateAnalystPromptTemplates,
} from "./prompt-templates.ts";
export type {
  AnalystPromptTemplate,
  AnalystPromptTemplateValidation,
  BuildPromptCachePrefixInput,
  PromptCacheFewShot,
  PromptCachePrefix,
  PromptCachePrefixMessage,
} from "./prompt-templates.ts";

export {
  interceptToolCall,
} from "./approval-interceptor.ts";
export type {
  ApprovalInterception,
  ApprovalInterceptionInput,
  PendingToolAction,
} from "./approval-interceptor.ts";

export {
  DEFAULT_TOOL_CALL_BUDGET,
  EMPTY_TOOL_CALL_USAGE,
  checkToolCallBudget,
  recordToolCallUsage,
} from "./budget-gate.ts";
export type {
  CheckToolCallBudgetInput,
  ToolCallBudget,
  ToolCallBudgetDecision,
  ToolCallUsage,
} from "./budget-gate.ts";

export {
  createTurnToolPolicy,
} from "./turn-policy.ts";
export type {
  AcceptedToolCallBudgetDecision,
  TurnToolCallInput,
  TurnToolPolicy,
  TurnToolPolicyInput,
} from "./turn-policy.ts";

export {
  RAW_DOCUMENT_FIELD_NAMES,
  assertRegistryAudienceBoundary,
  authorizeToolCall,
  authorizeToolResult,
  toolsForAudience,
  validateRegistryAudienceBoundary,
} from "./audience-enforcement.ts";
export type {
  AudienceBoundaryViolation,
  AuthorizeToolCallInput,
  AuthorizeToolResultInput,
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
