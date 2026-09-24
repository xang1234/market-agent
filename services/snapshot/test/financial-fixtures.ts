// In-memory financial unit records shaped exactly as the loader returns them,
// produced by the pure core so they are internally consistent. Tests mutate a
// copy to prove each tampering is caught.

import assert from "node:assert/strict";
import {
  evaluateBoundPlan,
  hashCanonical,
  nodeLineageHashes,
  planSemanticHash,
  unitClosures,
  unitPublication,
  validateBoundInput,
  validateFinancialPlan,
  type BoundFinancialInputV1,
  type FinancialPlanV1,
  type SlotBinding,
} from "../../financial-core/src/index.ts";
import type { FinancialUnitRecords, LoadedEvidence } from "../src/financial-verifier-loader.ts";
import type { FinancialSealContext } from "../src/financial-verifier.ts";

export const F = {
  owner: "5f000000-0000-4000-8000-000000000001",
  run: "5f000000-0000-4000-8000-000000000002",
  plan: "5f000000-0000-4000-8000-000000000003",
  parent: "5f000000-0000-4000-8000-000000000004",
  issuer: "5f000000-0000-4000-8000-0000000000a1",
  source: "5f000000-0000-4000-8000-0000000000c1",
  revenueFact: "5f000000-0000-4000-8000-0000000000d1",
  grossProfitFact: "5f000000-0000-4000-8000-0000000000d2",
  pubAttestation: "5f000000-0000-4000-8000-0000000000e1",
  precRevenue: "5f000000-0000-4000-8000-0000000000e2",
  precGrossProfit: "5f000000-0000-4000-8000-0000000000e3",
  snapshot: "5f000000-0000-4000-8000-0000000000f1",
  cutoff: "2024-01-16T04:59:59.999Z",
  sourceVersion: "1".repeat(64),
  proof: "9".repeat(64),
  digest: "8".repeat(64),
} as const;

export function marginPlan(): FinancialPlanV1 {
  const reported = (nodeId: string, metric: string) => ({
    node_id: nodeId,
    operation: "reported_metric" as const,
    operation_version: "reported_metric.v1",
    subject_slot: "a",
    metric_key: metric,
    period: { kind: "fiscal_period" as const, fiscal_year: 2023, fiscal_period: "FY" as const },
  });
  const validated = validateFinancialPlan({
    schema_version: "financial_plan.v1",
    plan_id: F.plan,
    origin: { kind: "chat_request", ref: "chat:turn:1" },
    planner: { kind: "deterministic", adapter_version: "test.v1", model: null, prompt_version: null },
    catalog_version: "catalog.v1",
    interpretation: null,
    subjects: {
      membership: "explicit",
      requested_count: 1,
      resolved_count: 1,
      omitted_count: 0,
      members: [{ slot_id: "a", subject_ref: { kind: "issuer", id: F.issuer }, display_order: 0, role: "primary" }],
    },
    time: { knowledge_cutoff: F.cutoff, cutoff_timezone: "America/New_York", time_mode: "public_information" },
    policies: { reporting_basis: "as_reported", period_policy: "exact_fiscal", freshness: { max_age_days: null }, source_policy_version: "sources.v1" },
    metric_definitions: [
      { metric_key: "revenue", definition_version: "revenue.v1" },
      { metric_key: "gross_profit", definition_version: "gross_profit.v1" },
    ],
    operations: [
      reported("a_rev", "revenue"),
      reported("a_gp", "gross_profit"),
      { node_id: "a_gm", operation: "gross_margin", operation_version: "gross_margin.v1", numerator: "a_gp", revenue: "a_rev" },
    ],
    outputs: [
      { output_id: "out_rev", node_id: "a_rev", unit_id: "section" },
      { output_id: "out_gm", node_id: "a_gm", unit_id: "section" },
    ],
    publication_units: [{ unit_id: "section", kind: "chat_section" }],
    thresholds: [],
    limits: { max_subjects: 25, max_periods_per_subject: 20, max_operations: 512, max_outputs: 2000, max_input_candidates: 10000, max_concurrent_evidence_tasks: 4 },
    presentation_template_version: "financial-answer.v1",
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

function boundInput(slot: string, factId: string, metric: string, value: string): BoundFinancialInputV1 {
  const validated = validateBoundInput({
    schema_version: "financial_bound_input.v1",
    input_slot: slot,
    fact_id: factId,
    subject_ref: { kind: "issuer", id: F.issuer },
    metric: { metric_key: metric, definition_version: `${metric}.v1` },
    source: { source_id: F.source, document_id: null, source_version_hash: F.sourceVersion, locator: `locator:${factId}` },
    numeric: { raw_token: value, token_proof_hash: F.proof, value, scale: "1", native_value: value },
    unit: { kind: "currency", currency: "USD" },
    period: { kind: "duration", start: "2023-01-01", end: "2023-12-31", fiscal_year: 2023, fiscal_period: "FY", calendar_version: "fiscal-calendar.v1" },
    dimensions: { scope: "consolidated", members: [] },
    basis: { reporting: "as_reported", adjustment: "unadjusted", share_basis: "not_applicable" },
    publication: { attestation_id: F.pubAttestation, available_no_later_than: "2024-01-11T04:59:59.999Z", precision: "date", source_timezone: "America/New_York" },
    observed_at: "2024-02-01T00:00:00.000Z",
    precision_status: "source_token_preserved",
    eligibility: { selection_policy_version: "public-information-selection.v1", promotion_status: "authoritative", candidate_set_digest: F.digest },
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

function evidence(factId: string): LoadedEvidence {
  return {
    fact_id: factId,
    source_id: F.source,
    invalidated: false,
    method: "reported",
    source_user_id: null,
    source_version_hash: F.sourceVersion,
    publication: {
      attestation_id: F.pubAttestation,
      available_not_before: null,
      available_no_later_than: "2024-01-11T04:59:59.999Z",
      timing_precision: "date",
      source_timezone: "America/New_York",
    },
    precision_current: true,
    context: { period_type: "duration", dimension_scope: "consolidated", adjustment_basis: "unadjusted", share_basis: "not_applicable", fiscal_calendar_version: "fiscal-calendar.v1" },
  };
}

/** Records a correct run of `marginPlan()` would persist, ready to seal. */
export function validRecords(): FinancialUnitRecords {
  const plan = marginPlan();
  const inputs = [
    boundInput("a_rev", F.revenueFact, "revenue", "383285000000.123456789012345678"),
    boundInput("a_gp", F.grossProfitFact, "gross_profit", "169148000000"),
  ];
  const bindings = new Map<string, SlotBinding>(inputs.map((input) => [input.input_slot, {
    status: "bound",
    input,
    payload_hash: hashCanonical("bound_input", input),
    candidate_set_digest: F.digest,
  }]));
  const evaluation = evaluateBoundPlan(plan, bindings);
  const publication = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "section");
  const closure = unitClosures(plan).get("section")!;
  const computationIds = new Map(publication.computations.map((computation, index) => [computation.node_id, `5f000000-0000-4000-8000-00000000010${index}`]));
  return {
    run: {
      run_id: F.run,
      plan_id: F.plan,
      parent_kind: "chat_thread",
      parent_id: F.parent,
      parent_version: "1",
      request_hash: planSemanticHash(plan),
      execution_state: "ready_to_seal",
      knowledge_cutoff: F.cutoff,
    },
    plan: { plan: JSON.parse(JSON.stringify(plan)), semantic_hash: planSemanticHash(plan) },
    unit: {
      unit_id: "section",
      state: "computed",
      coverage_state: publication.coverage,
      output_ids: [...closure.output_ids],
      closure_node_ids: [...closure.node_ids],
      closure_hash: hashCanonical("unit_closure", { unit_id: closure.unit_id, output_ids: closure.output_ids, node_ids: closure.node_ids }),
    },
    bindings: inputs.map((input) => ({
      input_slot: input.input_slot,
      binding_status: "bound",
      fact_id: input.fact_id,
      publication_attestation_id: F.pubAttestation,
      precision_attestation_id: input.input_slot === "a_rev" ? F.precRevenue : F.precGrossProfit,
      bound_payload: JSON.parse(JSON.stringify(input)),
      payload_hash: hashCanonical("bound_input", input),
      gap_reason: null,
      candidate_set_digest: F.digest,
    })),
    evidence: [evidence(F.revenueFact), evidence(F.grossProfitFact)],
    computations: publication.computations.map((computation) => ({
      computation_id: computationIds.get(computation.node_id)!,
      node_id: computation.node_id,
      formula_id: computation.operation,
      operation_version: computation.operation_version,
      numeric_policy_version: computation.numeric_policy_version,
      definition_versions: JSON.parse(JSON.stringify(computation.definition_versions)),
      input_refs: JSON.parse(JSON.stringify(computation.input_refs)),
      output_hash: computation.output_hash,
    })),
    results: publication.results.map((result, index) => ({
      result_id: `5f000000-0000-4000-8000-00000000020${index}`,
      output_id: result.output_id,
      node_id: result.node_id,
      unit_id: result.unit_id,
      computation_id: computationIds.get(result.node_id) ?? null,
      state: "draft",
      disposition: result.disposition,
      payload: JSON.parse(JSON.stringify(result.payload)),
      dependencies: [...result.dependencies],
      result_hash: result.result_hash,
    })),
    subject_names: [{ kind: "issuer", id: F.issuer, name: "Fixture Industries Inc." }],
  };
}

export const SEAL_CONTEXT: FinancialSealContext = {
  snapshot_id: F.snapshot,
  manifest: { fact_refs: [F.revenueFact, F.grossProfitFact], source_ids: [F.source], as_of: F.cutoff },
};

/** A deep, mutable copy for tampering. */
export function mutable(records: FinancialUnitRecords): { -readonly [K in keyof FinancialUnitRecords]: any } {
  return JSON.parse(JSON.stringify(records));
}
