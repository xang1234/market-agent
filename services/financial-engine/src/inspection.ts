// Inspection of one committed financial result: what was asked, how it was
// computed, from which sources, definitions, precision, and public-time proofs,
// and with what coverage. Access is re-authorized on every read over the
// result's entire transitive input closure: if any input's fact, source, or
// publication document is no longer available to the owner, the result is not
// found — exactly like another owner's or an uncommitted result, so nothing
// about it can be enumerated. A certificate or operation version this build
// does not support is reported as unavailable, never reinterpreted.

import {
  dependencyClosure,
  FINANCIAL_PRESENTATION_VERSION,
  OPERATION_REGISTRY,
  type BoundFinancialInputV1,
  type LocalId,
  type OperationKind,
} from "../../financial-core/src/index.ts";
import { FINANCIAL_VERIFIER_VERSION } from "../../snapshot/src/financial-verifier.ts";
import type { SqlExecutor } from "./ports.ts";
import { readClosureInputs, readCommittedResult, type CommittedResultRecord } from "./read-model.ts";

export const INSPECTION_SCHEMA_VERSION = "financial_result_inspection.v1";

export type InspectedInput = Readonly<
  | {
      input_slot: LocalId;
      status: "bound";
      fact_id: string;
      source: Readonly<{ source_id: string; document_id: string | null; source_version_hash: string; locator: string | null }>;
      metric: Readonly<{ metric_key: string; definition_version: string }>;
      value: string;
      unit: unknown;
      period: Readonly<{ kind: string; start: string | null; end: string; fiscal_year: number; fiscal_period: string }>;
      precision_status: string;
      publication: Readonly<{ attestation_id: string; available_no_later_than: string; precision: string }>;
    }
  | { input_slot: LocalId; status: "gap"; reason_code: string | null }
>;

export type ResultInspection =
  | Readonly<{
      schema_version: typeof INSPECTION_SCHEMA_VERSION;
      availability: "available";
      result_id: string;
      run_id: string;
      unit_id: LocalId;
      output_id: LocalId;
      disposition: string;
      payload: unknown;
      result_hash: string;
      interpretation: string | null;
      coverage_state: "complete" | "partial" | "none" | null;
      time: Readonly<{ knowledge_cutoff: string; time_mode: string; finalized_at: string }>;
      publication: Readonly<{ snapshot_id: string; certificate_digest: string }>;
      formula: Readonly<{ operation: string; operation_version: string; numeric_policy_version: string }> | null;
      definitions: ReadonlyArray<Readonly<{ metric_key: string; definition_version: string }>>;
      inputs: ReadonlyArray<InspectedInput>;
    }>
  | Readonly<{
      schema_version: typeof INSPECTION_SCHEMA_VERSION;
      availability: "unsupported_version";
      result_id: string;
      run_id: string;
      reason_code: "unsupported_version";
    }>;

/** Null when the caller may not see this result (missing, foreign, uncommitted, or with revoked evidence). */
export async function inspectCommittedResult(db: SqlExecutor, ownerUserId: string, resultId: string): Promise<ResultInspection | null> {
  const record = await readCommittedResult(db, ownerUserId, resultId);
  if (!record) return null;
  const { plan } = record;
  const closure = dependencyClosure(plan, [record.node_id]);
  const reportedSlots = plan.operations.filter((node) => node.operation === "reported_metric" && closure.has(node.node_id)).map((node) => node.node_id);
  const inputs = await readClosureInputs(db, ownerUserId, record.run_id, reportedSlots);
  if (inputs.length !== reportedSlots.length || inputs.some((input) => !input.available)) return null;

  if (!supportedVersions(record)) {
    return { schema_version: INSPECTION_SCHEMA_VERSION, availability: "unsupported_version", result_id: record.result_id, run_id: record.run_id, reason_code: "unsupported_version" };
  }
  const metricKeys = new Set(inputs.flatMap((input) => (input.binding_status === "bound" ? [(input.bound_payload as BoundFinancialInputV1).metric.metric_key] : [])));
  return {
    schema_version: INSPECTION_SCHEMA_VERSION,
    availability: "available",
    result_id: record.result_id,
    run_id: record.run_id,
    unit_id: record.unit_id,
    output_id: record.output_id,
    disposition: record.disposition,
    payload: record.payload,
    result_hash: record.result_hash,
    interpretation: record.interpretation,
    coverage_state: record.unit_coverage,
    time: { knowledge_cutoff: record.knowledge_cutoff, time_mode: plan.time.time_mode, finalized_at: record.finalized_at },
    publication: { snapshot_id: record.snapshot_id, certificate_digest: record.certificate_digest },
    formula: record.computation && {
      operation: record.computation.formula_id,
      operation_version: record.computation.operation_version,
      numeric_policy_version: record.computation.numeric_policy_version,
    },
    definitions: plan.metric_definitions.filter((definition) => metricKeys.has(definition.metric_key)),
    inputs: inputs.map((input): InspectedInput => {
      if (input.binding_status === "gap") return { input_slot: input.input_slot, status: "gap", reason_code: input.gap_reason };
      const bound = input.bound_payload as BoundFinancialInputV1;
      return {
        input_slot: input.input_slot,
        status: "bound",
        fact_id: bound.fact_id,
        source: { source_id: bound.source.source_id, document_id: bound.source.document_id, source_version_hash: bound.source.source_version_hash, locator: bound.source.locator },
        metric: bound.metric,
        value: bound.numeric.value,
        unit: bound.unit,
        period: { kind: bound.period.kind, start: bound.period.start, end: bound.period.end, fiscal_year: bound.period.fiscal_year, fiscal_period: bound.period.fiscal_period },
        precision_status: bound.precision_status,
        publication: { attestation_id: bound.publication.attestation_id, available_no_later_than: bound.publication.available_no_later_than, precision: bound.publication.precision },
      };
    }),
  };
}

function supportedVersions(record: CommittedResultRecord): boolean {
  const { certificate, computation } = record;
  if (certificate.schema_version !== "financial_publication.v1" || certificate.verifier_version !== FINANCIAL_VERIFIER_VERSION) return false;
  if (certificate.presentation?.version !== FINANCIAL_PRESENTATION_VERSION) return false;
  if (computation === null) return true;
  return OPERATION_REGISTRY[computation.formula_id as OperationKind]?.operation_version === computation.operation_version;
}
