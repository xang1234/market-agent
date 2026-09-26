// Whether this deployment may run verified finance at all. Every surface's
// shadow or enforce mode needs the schema the engine writes through, the
// evidence views its adapter reads, and a version registry that covers what
// this build emits. A missing piece blocks startup with the reasons; it never
// quietly leaves a surface on legacy numbers while it claims to be enforced.

import {
  FINANCIAL_CATALOG_VERSION,
  FINANCIAL_PRESENTATION_VERSION,
  METRIC_CATALOG_V1,
  NUMERIC_POLICY,
  OPERATION_REGISTRY,
} from "../../financial-core/src/index.ts";
import { FINANCIAL_PUBLICATION_SCHEMA_VERSION, FINANCIAL_VERIFIER_VERSION } from "../../snapshot/src/financial-verifier.ts";
import type { SqlExecutor } from "./ports.ts";
import type { FinancialMode } from "./request.ts";
import { FINANCIAL_VERSION_REGISTRY, type FinancialVersionRegistry } from "./version-registry.ts";

export type FinancialReadiness = Readonly<{ ready: boolean; problems: ReadonlyArray<string> }>;

// What the engine, its evidence adapter, finalization, and erasure read or write.
const RELATIONS = [
  "financial_plans", "financial_runs", "financial_run_units", "financial_run_inputs", "financial_run_events",
  "financial_results", "snapshot_financial_runs", "analyze_run_financial_sections",
  "source_publication_attestations", "fact_precision_attestations", "fact_financial_contexts",
  "current_source_publication_attestations", "current_fact_precision_attestations",
];
const COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["computations", "financial_run_id"], ["grid_runs", "financial_mode"], ["grid_cells", "financial_block"],
];
const FUNCTIONS = ["normalized_content_hash", "erase_financial_run_dependents", "erase_financial_runs_of_parent", "erase_financial_runs_binding_evidence"];

export async function checkFinancialReadiness(db: SqlExecutor, registry: FinancialVersionRegistry = FINANCIAL_VERSION_REGISTRY): Promise<FinancialReadiness> {
  const problems: string[] = [];
  const { rows } = await db.query<{ kind: string; name: string; present: boolean }>(
    `select 'relation' as kind, name, to_regclass(name) is not null as present from unnest($1::text[]) as name
     union all
     select 'column', t || '.' || c, exists (select 1 from information_schema.columns where table_name = t and column_name = c)
       from unnest($2::text[], $3::text[]) as pair(t, c)
     union all
     select 'function', name, exists (select 1 from pg_proc where proname = name) from unnest($4::text[]) as name`,
    [RELATIONS, COLUMNS.map(([table]) => table), COLUMNS.map(([, column]) => column), FUNCTIONS],
  );
  for (const row of rows) if (!row.present) problems.push(`schema: ${row.kind} ${row.name} is missing`);

  // The registry must cover everything this build emits, or its own results would read as unsupported.
  const emitted: ReadonlyArray<readonly [keyof FinancialVersionRegistry, string]> = [
    ["catalog_versions", FINANCIAL_CATALOG_VERSION],
    ["numeric_policy_versions", NUMERIC_POLICY.version],
    ["certificate_versions", FINANCIAL_PUBLICATION_SCHEMA_VERSION],
    ["verifier_versions", FINANCIAL_VERIFIER_VERSION],
    ["presentation_versions", FINANCIAL_PRESENTATION_VERSION],
    ...Object.values(OPERATION_REGISTRY).map((spec) => ["operation_versions", spec.operation_version] as const),
    ...[...METRIC_CATALOG_V1.values()].map((definition) => ["definition_versions", definition.definition_version] as const),
  ];
  for (const [set, version] of emitted) if (!registry[set].has(version)) problems.push(`versions: ${version} is not in the reviewed registry`);
  return { ready: problems.length === 0, problems };
}

/**
 * Refuses to start any surface in shadow or enforce mode unless verified
 * finance is ready. With every surface off, nothing is checked.
 */
export async function requireFinancialReadiness(
  db: SqlExecutor,
  modes: Readonly<Record<string, FinancialMode>>,
  registry?: FinancialVersionRegistry,
): Promise<void> {
  const active = Object.entries(modes).filter(([, mode]) => mode !== "off").map(([surface]) => surface);
  if (active.length === 0) return;
  const readiness = await checkFinancialReadiness(db, registry);
  if (!readiness.ready) {
    throw new Error(`verified finance is not ready for ${active.join(", ")}: ${readiness.problems.join("; ")}`);
  }
}
