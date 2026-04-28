import type {
  ToolBundleDefinition,
  ToolDefinition,
  ToolRegistry,
} from "./registry.ts";

export type PreResolveBundleClassification = {
  bundle_id: string;
  reason?: string;
};

export type BundleSelectionInput = {
  registry: ToolRegistry;
  classification: PreResolveBundleClassification;
};

export type BundleSelection =
  | {
      ok: true;
      bundle_id: string;
      bundle: ToolBundleDefinition;
      tools: ReadonlyArray<ToolDefinition>;
      classification: PreResolveBundleClassification;
    }
  | {
      ok: false;
      reason: "unknown_bundle";
      bundle_id: string;
      message: string;
      available_bundle_ids: ReadonlyArray<string>;
    };

export function selectToolBundle(input: BundleSelectionInput): BundleSelection {
  const classification = freezeClassification(input.classification);
  const bundle = input.registry.getBundle(classification.bundle_id);

  if (!bundle) {
    return Object.freeze({
      ok: false,
      reason: "unknown_bundle",
      bundle_id: classification.bundle_id,
      message: `Unknown tool bundle "${classification.bundle_id}"`,
      available_bundle_ids: input.registry.bundleIds(),
    });
  }

  return Object.freeze({
    ok: true,
    bundle_id: bundle.bundle_id,
    bundle,
    tools: input.registry.toolsForBundle(bundle.bundle_id),
    classification,
  });
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
