import { createHash } from "node:crypto";

import type { JsonValue, ToolDefinition } from "./registry.ts";
import type { ToolRegistry } from "./registry.ts";

export const ANALYST_PROMPT_TEMPLATE_VERSION = "v1";

export type PromptCachePrefixMessage = {
  role: "system";
  name:
    | "tools"
    | "system"
    | "bundle_policy"
    | "response_schema"
    | "few_shots"
    | "thread_summary"
    | "resolved_context";
  content: string;
};

export type PromptCachePrefix = {
  cache_key: string;
  messages: ReadonlyArray<PromptCachePrefixMessage>;
  user_turn?: string;
};

export type PromptCacheFewShot = {
  name: string;
  content: string;
};

export type BuildPromptCachePrefixInput = {
  template: AnalystPromptTemplate;
  tools: ReadonlyArray<ToolDefinition>;
  response_schema: JsonValue;
  few_shots?: ReadonlyArray<PromptCacheFewShot>;
  thread_summary?: string | null;
  resolved_context?: JsonValue;
  user_turn?: string;
};

export type AnalystPromptTemplate = {
  bundle_id: string;
  version: typeof ANALYST_PROMPT_TEMPLATE_VERSION;
  system_prompt: string;
  policy_prompt: string;
  prompt_cache_prefix: PromptCachePrefix;
};

export type AnalystPromptTemplateValidation = {
  ok: boolean;
  expected_bundle_ids: ReadonlyArray<string>;
  template_bundle_ids: ReadonlyArray<string>;
  missing_bundle_ids: ReadonlyArray<string>;
  extra_bundle_ids: ReadonlyArray<string>;
  duplicate_bundle_ids: ReadonlyArray<string>;
};

export const ANALYST_PROMPT_TEMPLATES: ReadonlyArray<AnalystPromptTemplate> =
  Object.freeze([
    makeTemplate({
      bundle_id: "quote_lookup",
      system:
        "Answer market quote requests with listing-oriented price, movement, session, and timestamp context.",
      policy:
        "Use quote_lookup tools for lightweight market snapshots. Keep the answer compact, flag stale prices, and avoid long fundamentals or document analysis.",
    }),
    makeTemplate({
      bundle_id: "single_subject_analysis",
      system:
        "Analyze one primary subject using normalized fundamentals, market context, claims, events, and facts.",
      policy:
        "Use single_subject_analysis tools to build an evidence-backed view of one issuer, instrument, listing, or topic. Separate facts from interpretation.",
    }),
    makeTemplate({
      bundle_id: "peer_comparison",
      system:
        "Compare multiple resolved subjects with consistent metrics, periods, and evidence-backed explanations.",
      policy:
        "Use peer_comparison tools to normalize periods and units before ranking peers. Prefer tables and call out missing or stale inputs.",
    }),
    makeTemplate({
      bundle_id: "theme_research",
      system:
        "Research a theme by connecting subjects, claims, events, catalysts, and market or fundamental context.",
      policy:
        "Use theme_research tools to group evidence by driver, beneficiary, risk, and timeframe. Avoid over-weighting isolated claims.",
    }),
    makeTemplate({
      bundle_id: "segment_deep_dive",
      system:
        "Explain business segments with segment facts, definitions, trends, and warnings before making conclusions.",
      policy:
        "Use segment_deep_dive tools for segment revenue, margin, mix, and disclosure changes. State when segment definitions are not comparable.",
    }),
    makeTemplate({
      bundle_id: "document_research",
      system:
        "Research documents through structured claims, events, facts, and evidence bundles without exposing raw source text.",
      policy:
        "Use document_research tools only for structured claims, events, facts, and evidence bundles. Cite evidence and return a partial answer when sources are insufficient.",
    }),
    makeTemplate({
      bundle_id: "filing_research",
      system:
        "Analyze filings through extracted filing facts, claims, events, periods, and section-level evidence.",
      policy:
        "Use filing_research tools to surface material changes, risks, accounting context, and cited filing evidence. Do not quote raw filing text unless it is structured evidence.",
    }),
    makeTemplate({
      bundle_id: "screener",
      system:
        "Turn screening requests into explicit filter logic, ranked candidates, and concise rationale for inclusion or exclusion.",
      policy:
        "Use screener tools to validate fields, execute safe filters, and explain criteria. Treat missing fields as unknown rather than as passing filters.",
    }),
    makeTemplate({
      bundle_id: "agent_management",
      system:
        "Help create, inspect, and manage research agents while keeping side effects explicit and approval mediated.",
      policy:
        "Use agent_management tools for agent lifecycle tasks. Approval-required actions must be staged, and generated agent instructions must be specific and bounded.",
    }),
    makeTemplate({
      bundle_id: "alert_management",
      system:
        "Help create, inspect, and manage alerts or watchlist updates with clear trigger semantics and side-effect boundaries.",
      policy:
        "Use alert_management tools for alert and watchlist workflows. Stage approval-required writes and summarize exactly what would change.",
    }),
    makeTemplate({
      bundle_id: "analyze_template_run",
      system:
        "Run saved analysis templates by honoring template scope, selected sources, added subjects, and block layout expectations.",
      policy:
        "Use analyze_template_run tools to keep output aligned with the saved template. Preserve template intent while noting unavailable data or skipped sources.",
    }),
  ]);

const TEMPLATES_BY_BUNDLE = new Map(
  ANALYST_PROMPT_TEMPLATES.map((template) => [template.bundle_id, template]),
);

export function analystPromptTemplateForBundle(
  bundleId: string,
): AnalystPromptTemplate | undefined {
  return TEMPLATES_BY_BUNDLE.get(bundleId);
}

export function analystPromptTemplateBundleIds(): ReadonlyArray<string> {
  return Object.freeze(
    ANALYST_PROMPT_TEMPLATES.map((template) => template.bundle_id),
  );
}

export function validateAnalystPromptTemplates(
  registry: ToolRegistry,
): AnalystPromptTemplateValidation {
  const expectedBundleIds = registry.bundleIds();
  const templateBundleIds = ANALYST_PROMPT_TEMPLATES.map(
    (template) => template.bundle_id,
  );
  const expectedSet = new Set(expectedBundleIds);
  const templateSet = new Set(templateBundleIds);
  const duplicateBundleIds = duplicateStrings(templateBundleIds);

  return Object.freeze({
    ok:
      duplicateBundleIds.length === 0 &&
      expectedBundleIds.every((bundleId) => templateSet.has(bundleId)) &&
      templateBundleIds.every((bundleId) => expectedSet.has(bundleId)),
    expected_bundle_ids: Object.freeze([...expectedBundleIds]),
    template_bundle_ids: Object.freeze([...templateBundleIds]),
    missing_bundle_ids: Object.freeze(
      expectedBundleIds.filter((bundleId) => !templateSet.has(bundleId)),
    ),
    extra_bundle_ids: Object.freeze(
      templateBundleIds.filter((bundleId) => !expectedSet.has(bundleId)),
    ),
    duplicate_bundle_ids: Object.freeze(duplicateBundleIds),
  });
}

export function assertAnalystPromptTemplates(registry: ToolRegistry): void {
  const validation = validateAnalystPromptTemplates(registry);
  if (validation.ok) {
    return;
  }

  throw new Error(
    [
      "Analyst prompt templates do not match registered bundles",
      `missing: ${validation.missing_bundle_ids.join(", ") || "none"}`,
      `extra: ${validation.extra_bundle_ids.join(", ") || "none"}`,
      `duplicate: ${validation.duplicate_bundle_ids.join(", ") || "none"}`,
    ].join("; "),
  );
}

export function buildPromptCachePrefix(
  input: BuildPromptCachePrefixInput,
): PromptCachePrefix {
  const template = input.template;
  const messages = Object.freeze([
    prefixMessage("tools", canonicalJson(toolDescriptors(input.tools))),
    prefixMessage("system", template.system_prompt),
    prefixMessage("bundle_policy", template.policy_prompt),
    prefixMessage("response_schema", canonicalJson(input.response_schema)),
    prefixMessage("few_shots", canonicalJson(input.few_shots ?? [])),
    prefixMessage("thread_summary", input.thread_summary ?? ""),
    prefixMessage("resolved_context", canonicalJson(input.resolved_context ?? null)),
  ]);
  const cache_key = [
    "analyst",
    template.bundle_id,
    template.version,
    promptCachePrefixHash({ cache_key: "", messages }),
  ].join(":");

  return Object.freeze({
    cache_key,
    messages,
    ...(input.user_turn === undefined ? {} : { user_turn: input.user_turn }),
  });
}

export function promptCachePrefixHash(
  prefix: Pick<PromptCachePrefix, "messages">,
): string {
  return createHash("sha256")
    .update(canonicalJson(prefix.messages))
    .digest("hex");
}

function makeTemplate(input: {
  bundle_id: string;
  system: string;
  policy: string;
}): AnalystPromptTemplate {
  const systemPrompt = `Analyst bundle ${input.bundle_id}: ${input.system}`;
  const policyPrompt = `Bundle policy ${input.bundle_id}: ${input.policy}`;
  const messages = Object.freeze([
    Object.freeze({
      role: "system",
      name: "system",
      content: systemPrompt,
    }),
    Object.freeze({
      role: "system",
      name: "bundle_policy",
      content: policyPrompt,
    }),
  ] satisfies ReadonlyArray<PromptCachePrefixMessage>);

  return Object.freeze({
    bundle_id: input.bundle_id,
    version: ANALYST_PROMPT_TEMPLATE_VERSION,
    system_prompt: systemPrompt,
    policy_prompt: policyPrompt,
    prompt_cache_prefix: Object.freeze({
      cache_key: `analyst:${input.bundle_id}:${ANALYST_PROMPT_TEMPLATE_VERSION}`,
      messages,
    }),
  });
}

function prefixMessage(
  name: PromptCachePrefixMessage["name"],
  content: string,
): PromptCachePrefixMessage {
  return Object.freeze({
    role: "system",
    name,
    content,
  });
}

function toolDescriptors(tools: ReadonlyArray<ToolDefinition>): ReadonlyArray<JsonValue> {
  return Object.freeze(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      audience: tool.audience,
      read_only: tool.read_only,
      approval_required: tool.approval_required,
      cost_class: tool.cost_class,
      freshness_expectation: tool.freshness_expectation,
      input_json_schema: tool.input_json_schema,
      output_json_schema: tool.output_json_schema,
      error_codes: tool.error_codes,
    })),
  );
}

function canonicalJson(value: JsonValue | ReadonlyArray<unknown>): string {
  return stableJson(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function duplicateStrings(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }

  return Object.freeze([...duplicates]);
}
