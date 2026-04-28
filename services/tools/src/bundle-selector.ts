import type {
  ToolAudience,
  ToolBundleDefinition,
  ToolDefinition,
  ToolRegistry,
} from "./registry.ts";
import { TOOL_AUDIENCES } from "./registry.ts";
import { toolsForAudience } from "./audience-enforcement.ts";
import {
  analystPromptTemplateForBundle,
  analystPromptTemplateBundleIds,
  type AnalystPromptTemplate,
  type PromptCachePrefix,
} from "./prompt-templates.ts";

export type PreResolveBundleClassification = {
  bundle_id: string;
  reason?: string;
};

export type BundleSelectionInput = {
  registry: ToolRegistry;
  audience: ToolAudience;
  classification: PreResolveBundleClassification;
};

export type BundleSelection =
  | {
      ok: true;
      audience: ToolAudience;
      bundle_id: string;
      bundle: ToolBundleDefinition;
      tools: ReadonlyArray<ToolDefinition>;
      prompt_template: AnalystPromptTemplate;
      prompt_cache_prefix: PromptCachePrefix;
      classification: PreResolveBundleClassification;
    }
  | {
      ok: false;
      reason: "unknown_bundle";
      audience: ToolAudience;
      bundle_id: string;
      message: string;
      available_bundle_ids: ReadonlyArray<string>;
    }
  | {
      ok: false;
      reason: "missing_prompt_template";
      audience: ToolAudience;
      bundle_id: string;
      message: string;
      available_template_bundle_ids: ReadonlyArray<string>;
    };

export function selectToolBundle(input: BundleSelectionInput): BundleSelection {
  const audience = runtimeAudience(input.audience);
  const classification = freezeClassification(input.classification);
  const bundle = input.registry.getBundle(classification.bundle_id);

  if (!bundle) {
    return Object.freeze({
      ok: false,
      reason: "unknown_bundle",
      audience,
      bundle_id: classification.bundle_id,
      message: `Unknown tool bundle "${classification.bundle_id}"`,
      available_bundle_ids: input.registry.bundleIds(),
    });
  }
  const promptTemplate = analystPromptTemplateForBundle(bundle.bundle_id);

  if (!promptTemplate) {
    return Object.freeze({
      ok: false,
      reason: "missing_prompt_template",
      audience,
      bundle_id: bundle.bundle_id,
      message: `Missing analyst prompt template for bundle "${bundle.bundle_id}"`,
      available_template_bundle_ids: analystPromptTemplateBundleIds(),
    });
  }

  return Object.freeze({
    ok: true,
    audience,
    bundle_id: bundle.bundle_id,
    bundle,
    tools: toolsForAudience({
      registry: input.registry,
      bundle_id: bundle.bundle_id,
      audience,
    }),
    prompt_template: promptTemplate,
    prompt_cache_prefix: promptTemplate.prompt_cache_prefix,
    classification,
  });
}

function runtimeAudience(audience: ToolAudience): ToolAudience {
  if (typeof audience !== "string" || !TOOL_AUDIENCES.includes(audience)) {
    throw new Error(
      `bundle selection audience: must be one of ${TOOL_AUDIENCES.join(", ")}`,
    );
  }
  return audience;
}

function freezeClassification(
  classification: PreResolveBundleClassification,
): PreResolveBundleClassification {
  if (classification === null || typeof classification !== "object") {
    throw new Error("bundle classification: must be an object");
  }
  if (
    typeof classification.bundle_id !== "string" ||
    classification.bundle_id.length === 0
  ) {
    throw new Error("bundle classification.bundle_id: must be a non-empty string");
  }
  if (
    classification.reason !== undefined &&
    (typeof classification.reason !== "string" ||
      classification.reason.length === 0)
  ) {
    throw new Error("bundle classification.reason: must be a non-empty string");
  }

  return Object.freeze({
    bundle_id: classification.bundle_id,
    ...(classification.reason === undefined
      ? {}
      : { reason: classification.reason }),
  });
}
