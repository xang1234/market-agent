// The deployer-reviewed set of financial versions this build can honour. It
// lists only code compiled into this build: a saved run whose plan names an
// operation, definition, catalog, numeric policy, or certificate version that
// is not here is unavailable for replay and inspection. Nothing is ever
// downloaded or substituted — a newer build does not reinterpret an older
// version with today's implementation. Adding an entry is a reviewed change
// that ships the matching implementation.

import {
  FINANCIAL_CATALOG_VERSION,
  FINANCIAL_PRESENTATION_VERSION,
  METRIC_CATALOG_V1,
  NUMERIC_POLICY,
  OPERATION_REGISTRY,
  type FinancialPlanV1,
} from "../../financial-core/src/index.ts";
import { FINANCIAL_PUBLICATION_SCHEMA_VERSION, FINANCIAL_VERIFIER_VERSION } from "../../snapshot/src/financial-verifier.ts";

export type FinancialVersionRegistry = Readonly<{
  catalog_versions: ReadonlySet<string>;
  operation_versions: ReadonlySet<string>;
  definition_versions: ReadonlySet<string>;
  numeric_policy_versions: ReadonlySet<string>;
  certificate_versions: ReadonlySet<string>;
  verifier_versions: ReadonlySet<string>;
  presentation_versions: ReadonlySet<string>;
}>;

export const FINANCIAL_VERSION_REGISTRY: FinancialVersionRegistry = Object.freeze({
  catalog_versions: new Set([FINANCIAL_CATALOG_VERSION]),
  operation_versions: new Set(Object.values(OPERATION_REGISTRY).map((spec) => spec.operation_version)),
  definition_versions: new Set([...METRIC_CATALOG_V1.values()].map((definition) => definition.definition_version)),
  numeric_policy_versions: new Set([NUMERIC_POLICY.version]),
  certificate_versions: new Set([FINANCIAL_PUBLICATION_SCHEMA_VERSION]),
  verifier_versions: new Set([FINANCIAL_VERIFIER_VERSION]),
  presentation_versions: new Set([FINANCIAL_PRESENTATION_VERSION]),
});

/** The first version a plan needs that this build does not ship, or null. */
export function unsupportedPlanVersion(plan: FinancialPlanV1, registry: FinancialVersionRegistry = FINANCIAL_VERSION_REGISTRY): string | null {
  if (!registry.catalog_versions.has(plan.catalog_version)) return plan.catalog_version;
  for (const node of plan.operations) if (!registry.operation_versions.has(node.operation_version)) return node.operation_version;
  for (const definition of plan.metric_definitions) if (!registry.definition_versions.has(definition.definition_version)) return definition.definition_version;
  return null;
}

/** Whether a sealed certificate and its computation versions are ones this build can explain. */
export function supportedPublication(
  input: { certificate_version: unknown; verifier_version: unknown; presentation_version: unknown; operation_version: string | null; numeric_policy_version: string | null },
  registry: FinancialVersionRegistry = FINANCIAL_VERSION_REGISTRY,
): boolean {
  return typeof input.certificate_version === "string" && registry.certificate_versions.has(input.certificate_version)
    && typeof input.verifier_version === "string" && registry.verifier_versions.has(input.verifier_version)
    && typeof input.presentation_version === "string" && registry.presentation_versions.has(input.presentation_version)
    && (input.operation_version === null || registry.operation_versions.has(input.operation_version))
    && (input.numeric_policy_version === null || registry.numeric_policy_versions.has(input.numeric_policy_version));
}
