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
      bundle_id: "commodity_quote_lookup",
      system:
        "Answer commodity_quote_lookup requests with benchmark or contract price, unit, currency, grade, location, delivery-month, freshness, and timestamp context.",
      policy:
        "Use commodity_quote_lookup tools for lightweight copper and iron ore market snapshots. Keep the answer compact, flag stale or delayed prices, and never infer a grade, location, or delivery term that was not returned by a tool.",
    }),
    makeTemplate({
      bundle_id: "curve_analysis",
      system:
        "Analyze curve_analysis requests through normalized commodity curves, spreads, inventory context, and source-bound market series.",
      policy:
        "Use curve_analysis tools to explain curve shape, cash-3m or inter-month spreads, basis moves, and inventory-sensitive structure. Preserve unit, currency, tenor, basis, and as-of boundaries.",
    }),
    makeTemplate({
      bundle_id: "report_delta_analysis",
      system:
        "Analyze report_delta_analysis requests by comparing licensed report and internal-note deltas against prior assumptions.",
      policy:
        "Use report_delta_analysis tools to extract changed claims, changed assumptions, affected commodity subjects, horizon, confidence, and conflicts. Treat licensed report text as entitled evidence and preserve source controls.",
    }),
    makeTemplate({
      bundle_id: "event_impact_analysis",
      system:
        "Analyze event_impact_analysis requests by mapping events and claims into the commodities event-impact graph.",
      policy:
        "Use event_impact_analysis tools to build the event-impact graph and rank drivers by channel, direction, confidence, magnitude, and 1d, 1w, 1m, and 3m horizons. Separate evidence from interpretation and stop short of autonomous trade instructions.",
    }),
    makeTemplate({
      bundle_id: "balance_snapshot",
      system:
        "Analyze balance_snapshot requests through supply, demand, inventory, trade-flow, margin, freight, disruption, and house-forecast components.",
      policy:
        "Use balance_snapshot tools to build a source-bound balance bridge. Keep units explicit, distinguish external evidence from internal forecasts, and call out unavailable or stale balance coverage.",
    }),
    makeTemplate({
      bundle_id: "daily_call_run",
      system:
        "Run daily_call_run workflows for copper and iron ore morning-call drafts with analyst signoff.",
      policy:
        "Use daily_call_run tools to assemble drivers-first market calls across 1d, 1w, 1m, and 3m horizons. Draft a decision brief with citations, watch items, and confidence, but do not issue autonomous buy/sell instructions.",
    }),
    makeTemplate({
      bundle_id: "forecast_assumption_review",
      system:
        "Analyze forecast_assumption_review requests by comparing house forecasts, market curves, report deltas, and current event-impact evidence.",
      policy:
        "Use forecast_assumption_review tools to explain where house forecasts diverge from market pricing and why. Preserve assumptions, dates, units, and authorized internal-source boundaries.",
    }),
    makeTemplate({
      bundle_id: "alert_management",
      system:
        "Help create, inspect, and manage alert_management workflows for material commodity price, curve, report, balance, and event-impact changes.",
      policy:
        "Use alert_management tools to stage approval-required writes and summarize exactly what alert, channel, subject, and trigger would change.",
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
    promptCachePrefixHash({ messages }),
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
    [...tools]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => ({
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
