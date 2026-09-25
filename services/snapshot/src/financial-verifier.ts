// Independent verification of one financial publication unit at the snapshot
// boundary. Every input is a database record loaded in the finalization
// transaction (financial-verifier-loader.ts); nothing a caller supplies —
// a `verified` flag, a numeric array, a result payload — can change the
// outcome. The unit is recomputed through the pure core and compared with the
// persisted draft results and computations, so a wrong value keeps failing
// even when every citation ID is valid.
//
// Failures carry deterministic reason codes and identifiers only; values,
// payloads, and source content never appear in diagnostics.

import {
  canonicallyEqual,
  ExecutionIntegrityError,
  evaluateBoundPlan,
  FINANCIAL_PRESENTATION_VERSION,
  hashCanonical,
  nodeLineageHashes,
  NUMERIC_POLICY,
  planSemanticHash,
  presentationHash,
  presentFinancialUnit,
  publicAtCutoff,
  unitClosures,
  unitPublication,
  validateBoundInput,
  validateFinancialPlan,
  type BoundFinancialInputV1,
  type CommittedResult,
  type FinancialAnswerContent,
  type FinancialPlanV1,
  type LocalId,
  type ReasonCode,
  type Sha256Hex,
  type SlotBinding,
} from "../../financial-core/src/index.ts";
import {
  loadFinancialUnitRecords,
  type FinancialSealClaim,
  type FinancialUnitRecords,
  type LoadedEvidence,
} from "./financial-verifier-loader.ts";
import type { JsonObject, QueryExecutor } from "./manifest-staging.ts";

export const FINANCIAL_VERIFIER_VERSION = "snapshot-financial-verifier.v1";
export const FINANCIAL_PUBLICATION_SCHEMA_VERSION = "financial_publication.v1";

export const FINANCIAL_VERIFIER_REASON_CODES = [
  "financial_run_not_found",
  "financial_run_not_ready",
  "financial_unit_not_ready",
  "financial_plan_mismatch",
  "financial_closure_mismatch",
  "financial_binding_mismatch",
  "financial_input_ineligible",
  "financial_recompute_mismatch",
  "financial_lineage_mismatch",
  "financial_manifest_mismatch",
  "financial_presentation_unavailable",
  "financial_seal_blocks",
  "financial_verification_unavailable",
] as const;
export type FinancialVerifierReasonCode = (typeof FINANCIAL_VERIFIER_REASON_CODES)[number];

export type FinancialVerifierFailure = Readonly<{ reason_code: FinancialVerifierReasonCode; details: JsonObject }>;

/** What the seal asserts about itself; cross-checked against the unit's bound evidence. */
export type FinancialSealContext = Readonly<{
  snapshot_id: string;
  manifest: Readonly<{ fact_refs: ReadonlyArray<string>; source_ids: ReadonlyArray<string>; as_of: string }>;
}>;

/**
 * The certified `financial_answer` block. Only verification creates it, from
 * the records it just checked; a caller can never supply one.
 */
export type FinancialAnswerBlock = Readonly<{
  id: string;
  kind: "financial_answer";
  snapshot_id: string;
  data_ref: Readonly<{ kind: "financial_answer"; id: string }>;
  source_refs: ReadonlyArray<string>;
  as_of: string;
  presentation_hash: Sha256Hex;
  financial: FinancialAnswerContent;
}>;

export type FinancialPublicationV1 = Readonly<{
  schema_version: typeof FINANCIAL_PUBLICATION_SCHEMA_VERSION;
  verifier_version: string;
  snapshot_id: string;
  run: Readonly<{
    run_id: string;
    parent: Readonly<{ kind: string; id: string; version: string }>;
    plan_id: string;
    plan_semantic_hash: Sha256Hex;
    knowledge_cutoff: string;
  }>;
  unit: Readonly<{ unit_id: LocalId; closure_hash: Sha256Hex; coverage: string }>;
  inputs: ReadonlyArray<Readonly<{
    input_slot: LocalId;
    status: "bound" | "gap";
    fact_id: string | null;
    payload_hash: Sha256Hex | null;
    reason_code: string | null;
    candidate_set_digest: Sha256Hex;
  }>>;
  definitions: ReadonlyArray<Readonly<{ metric_key: string; definition_version: string }>>;
  computations: ReadonlyArray<Readonly<{ node_id: LocalId; output_hash: Sha256Hex }>>;
  results: ReadonlyArray<Readonly<{ result_id: string; output_id: LocalId; disposition: string; result_hash: Sha256Hex }>>;
  presentation: Readonly<{ version: string; hash: Sha256Hex }>;
  numeric_policy_version: string;
}>;

export type FinancialVerification =
  | Readonly<{ ok: true; certificate: FinancialPublicationV1; certificate_digest: Sha256Hex; result_ids: ReadonlyArray<string>; block: FinancialAnswerBlock }>
  | Readonly<{ ok: false; failures: ReadonlyArray<FinancialVerifierFailure> }>;

/**
 * The financial part of a snapshot seal. A financial seal carries no caller
 * content beyond policy disclosures: its one answer block is generated here.
 * Without a transaction client nothing can be verified.
 */
export async function verifyFinancialSnapshot(
  db: QueryExecutor | undefined,
  claim: FinancialSealClaim,
  context: FinancialSealContext & { block_kinds: ReadonlyArray<string> },
): Promise<FinancialVerification> {
  if (context.block_kinds.some((kind) => kind !== "disclosure")) return failed("financial_seal_blocks", { run_id: claim.run_id });
  if (db === undefined) return failed("financial_verification_unavailable", { reason: "no_transaction_client" });
  return verifyFinancialSeal(db, claim, context);
}

/** Loads the unit's records through `db` (the finalization transaction) and verifies them. */
export async function verifyFinancialSeal(
  db: QueryExecutor,
  claim: FinancialSealClaim,
  context: FinancialSealContext,
): Promise<FinancialVerification> {
  const records = await loadFinancialUnitRecords(db, claim);
  if (records === null) return failed("financial_run_not_found", { run_id: claim.run_id });
  return verifyFinancialUnit(records, claim.unit_id, context);
}

/** Pure verification of loaded records. */
export function verifyFinancialUnit(records: FinancialUnitRecords, unitId: LocalId, context: FinancialSealContext): FinancialVerification {
  const { run, unit } = records;
  if (run.execution_state !== "ready_to_seal") return failed("financial_run_not_ready", { run_id: run.run_id, execution_state: run.execution_state });
  if (unit === null) return failed("financial_unit_not_ready", { run_id: run.run_id, unit_id: unitId, state: "missing" });
  if (unit.state !== "computed") return failed("financial_unit_not_ready", { run_id: run.run_id, unit_id: unitId, state: unit.state });

  const validatedPlan = validateFinancialPlan(records.plan.plan);
  if (!validatedPlan.ok) return failed("financial_plan_mismatch", { run_id: run.run_id, field: "plan" });
  const plan = validatedPlan.value;
  const planHash = planSemanticHash(plan);
  const planProblem =
    plan.plan_id !== run.plan_id ? "plan_id"
    : planHash !== records.plan.semantic_hash || planHash !== run.request_hash ? "semantic_hash"
    : Date.parse(plan.time.knowledge_cutoff) !== Date.parse(run.knowledge_cutoff) ? "knowledge_cutoff"
    : null;
  if (planProblem) return failed("financial_plan_mismatch", { run_id: run.run_id, field: planProblem });

  const closure = unitClosures(plan).get(unitId);
  const closureHash = closure && hashCanonical("unit_closure", { unit_id: closure.unit_id, output_ids: closure.output_ids, node_ids: closure.node_ids });
  if (!closure || closureHash !== unit.closure_hash
    || !canonicallyEqual(closure.output_ids, unit.output_ids) || !canonicallyEqual(closure.node_ids, unit.closure_node_ids)) {
    return failed("financial_closure_mismatch", { run_id: run.run_id, unit_id: unitId });
  }

  const bindings = bindingsFor(plan, records);
  if (!bindings.ok) return failed("financial_binding_mismatch", { run_id: run.run_id, input_slot: bindings.input_slot, field: bindings.field });

  const closureNodes = new Set(closure.node_ids);
  const evidence = new Map(records.evidence.map((row) => [row.fact_id, row]));
  const failures: FinancialVerifierFailure[] = [];
  for (const [slot, binding] of bindings.value) {
    if (!closureNodes.has(slot) || binding.status !== "bound") continue;
    const problem = ineligibility(binding.input, evidence.get(binding.input.fact_id), plan);
    if (problem) failures.push(failure("financial_input_ineligible", { run_id: run.run_id, input_slot: slot, reason: problem }));
  }
  if (failures.length > 0) return { ok: false, failures };

  let expected;
  try {
    const evaluation = evaluateBoundPlan(plan, bindings.value);
    expected = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings.value), unitId);
  } catch (error) {
    if (error instanceof ExecutionIntegrityError) return failed("financial_binding_mismatch", { run_id: run.run_id, field: "evaluation" });
    throw error;
  }
  if (expected.rejected || expected.coverage !== unit.coverage_state) {
    return failed("financial_recompute_mismatch", { run_id: run.run_id, unit_id: unitId, field: expected.rejected ? "rejected" : "coverage" });
  }

  const stored = new Map(records.results.map((row) => [row.output_id, row]));
  if (stored.size !== expected.results.length || expected.results.some((result) => !stored.has(result.output_id))) {
    return failed("financial_recompute_mismatch", { run_id: run.run_id, unit_id: unitId, field: "result_set" });
  }
  for (const result of expected.results) {
    const row = stored.get(result.output_id)!;
    const field =
      row.state !== "draft" ? "state"
      : row.node_id !== result.node_id ? "node_id"
      : row.disposition !== result.disposition ? "disposition"
      : !canonicallyEqual(row.payload, result.payload) ? "payload"
      : !canonicallyEqual(row.dependencies, result.dependencies) ? "dependencies"
      : row.result_hash !== result.result_hash ? "result_hash"
      : null;
    if (field) failures.push(failure("financial_recompute_mismatch", { run_id: run.run_id, output_id: result.output_id, field }));
  }
  if (failures.length > 0) return { ok: false, failures };

  // Result -> computation and computation -> result: every derived computed
  // output references exactly its node's recomputed computation; nothing else
  // references a computation.
  const storedComputations = new Map(records.computations.map((row) => [row.node_id, row]));
  const expectedComputations = new Map(expected.computations.map((computation) => [computation.node_id, computation]));
  for (const computation of expected.computations) {
    const row = storedComputations.get(computation.node_id);
    const field =
      !row ? "missing"
      : row.formula_id !== computation.operation ? "operation"
      : row.operation_version !== computation.operation_version ? "operation_version"
      : row.numeric_policy_version !== computation.numeric_policy_version ? "numeric_policy_version"
      : !canonicallyEqual(row.definition_versions, computation.definition_versions) ? "definition_versions"
      : !canonicallyEqual(row.input_refs, computation.input_refs) ? "input_refs"
      : row.output_hash !== computation.output_hash ? "output_hash"
      : null;
    if (field) failures.push(failure("financial_lineage_mismatch", { run_id: run.run_id, node_id: computation.node_id, field }));
  }
  for (const result of expected.results) {
    const row = stored.get(result.output_id)!;
    const expectedId = expectedComputations.has(result.node_id) ? storedComputations.get(result.node_id)?.computation_id ?? null : null;
    if (row.computation_id !== expectedId) {
      failures.push(failure("financial_lineage_mismatch", { run_id: run.run_id, output_id: result.output_id, field: "computation_id" }));
    }
  }
  if (failures.length > 0) return { ok: false, failures };

  // The seal must cite every bound fact of the closure and its source, at the knowledge cutoff.
  const factRefs = new Set(context.manifest.fact_refs);
  const sourceIds = new Set(context.manifest.source_ids);
  if (Date.parse(context.manifest.as_of) !== Date.parse(plan.time.knowledge_cutoff)) {
    return failed("financial_manifest_mismatch", { run_id: run.run_id, field: "as_of" });
  }
  for (const [slot, binding] of bindings.value) {
    if (!closureNodes.has(slot) || binding.status !== "bound") continue;
    if (!factRefs.has(binding.input.fact_id)) failures.push(failure("financial_manifest_mismatch", { run_id: run.run_id, input_slot: slot, field: "fact_refs" }));
    if (!sourceIds.has(binding.input.source.source_id)) failures.push(failure("financial_manifest_mismatch", { run_id: run.run_id, input_slot: slot, field: "source_ids" }));
  }
  if (failures.length > 0) return { ok: false, failures };

  // The presentation is generated from the recomputed results, so it can only show what was verified.
  const content = presentVerifiedUnit(plan, records, unitId, expected.results.map((result) => ({ ...result, result_id: stored.get(result.output_id)!.result_id })));
  if (!content) return failed("financial_presentation_unavailable", { run_id: run.run_id, unit_id: unitId, field: "subject_name" });
  const hash = presentationHash(content);

  const certificate: FinancialPublicationV1 = {
    schema_version: FINANCIAL_PUBLICATION_SCHEMA_VERSION,
    verifier_version: FINANCIAL_VERIFIER_VERSION,
    snapshot_id: context.snapshot_id,
    run: {
      run_id: run.run_id,
      parent: { kind: run.parent_kind, id: run.parent_id, version: run.parent_version },
      plan_id: plan.plan_id,
      plan_semantic_hash: planHash,
      knowledge_cutoff: run.knowledge_cutoff,
    },
    unit: { unit_id: unitId, closure_hash: unit.closure_hash, coverage: expected.coverage },
    inputs: closure.node_ids.flatMap((nodeId) => {
      const binding = bindings.value.get(nodeId);
      if (!binding) return [];
      return [binding.status === "bound"
        ? { input_slot: nodeId, status: "bound" as const, fact_id: binding.input.fact_id, payload_hash: binding.payload_hash, reason_code: null, candidate_set_digest: binding.candidate_set_digest }
        : { input_slot: nodeId, status: "gap" as const, fact_id: null, payload_hash: null, reason_code: binding.reason_code, candidate_set_digest: binding.candidate_set_digest }];
    }),
    definitions: [...plan.metric_definitions].sort((left, right) => left.metric_key.localeCompare(right.metric_key)),
    computations: expected.computations.map((computation) => ({ node_id: computation.node_id, output_hash: computation.output_hash })),
    results: expected.results.map((result) => {
      const row = stored.get(result.output_id)!;
      return { result_id: row.result_id, output_id: result.output_id, disposition: result.disposition, result_hash: result.result_hash };
    }),
    presentation: { version: FINANCIAL_PRESENTATION_VERSION, hash },
    numeric_policy_version: NUMERIC_POLICY.version,
  };
  return {
    ok: true,
    certificate,
    certificate_digest: hashCanonical("publication", certificate),
    result_ids: certificate.results.map((result) => result.result_id),
    block: {
      id: `financial-answer-${unitId}`,
      kind: "financial_answer",
      snapshot_id: context.snapshot_id,
      data_ref: { kind: "financial_answer", id: `${run.run_id}:${unitId}` },
      source_refs: [...context.manifest.source_ids],
      as_of: new Date(plan.time.knowledge_cutoff).toISOString(),
      presentation_hash: hash,
      financial: content,
    },
  };
}

/** The unit's presentation with the subjects' current display names; null when a subject has no name. */
function presentVerifiedUnit(plan: FinancialPlanV1, records: FinancialUnitRecords, unitId: LocalId, results: ReadonlyArray<CommittedResult>): FinancialAnswerContent | null {
  const names = new Map(records.subject_names.map((subject) => [`${subject.kind}:${subject.id.toLowerCase()}`, subject.name]));
  const subjectNames: Record<LocalId, string> = {};
  for (const member of plan.subjects.members) {
    const name = names.get(`${member.subject_ref.kind}:${member.subject_ref.id.toLowerCase()}`);
    if (name === undefined) return null;
    subjectNames[member.slot_id] = name;
  }
  return presentFinancialUnit({ plan, run_id: records.run.run_id, unit_id: unitId, results, subject_names: subjectNames });
}

type BindingsOutcome =
  | { ok: true; value: Map<LocalId, SlotBinding> }
  | { ok: false; input_slot: string; field: string };

/** Every reported node's persisted binding, validated against its hash and the plan. */
function bindingsFor(plan: FinancialPlanV1, records: FinancialUnitRecords): BindingsOutcome {
  const rows = new Map(records.bindings.map((row) => [row.input_slot, row]));
  const slots = new Map(plan.subjects.members.map((member) => [member.slot_id, member]));
  const value = new Map<LocalId, SlotBinding>();
  for (const node of plan.operations) {
    if (node.operation !== "reported_metric") continue;
    const row = rows.get(node.node_id);
    if (!row) return { ok: false, input_slot: node.node_id, field: "missing" };
    if (row.binding_status === "gap") {
      value.set(node.node_id, { status: "gap", reason_code: row.gap_reason as ReasonCode, candidate_set_digest: row.candidate_set_digest });
      continue;
    }
    const validated = validateBoundInput(row.bound_payload);
    if (!validated.ok) return { ok: false, input_slot: node.node_id, field: "payload" };
    const input = validated.value;
    const subject = slots.get(node.subject_slot)!.subject_ref;
    const field =
      hashCanonical("bound_input", input) !== row.payload_hash ? "payload_hash"
      : input.input_slot !== node.node_id ? "input_slot"
      : input.fact_id !== row.fact_id ? "fact_id"
      : input.publication.attestation_id !== row.publication_attestation_id ? "publication_attestation_id"
      : input.metric.metric_key !== node.metric_key ? "metric"
      : input.subject_ref.kind !== subject.kind || input.subject_ref.id.toLowerCase() !== subject.id.toLowerCase() ? "subject"
      : input.eligibility.candidate_set_digest !== row.candidate_set_digest ? "candidate_set_digest"
      : null;
    if (field) return { ok: false, input_slot: node.node_id, field };
    value.set(node.node_id, { status: "bound", input, payload_hash: row.payload_hash!, candidate_set_digest: row.candidate_set_digest });
  }
  return { ok: true, value };
}

/** Why a bound input may no longer be published, judged on its current evidence. */
function ineligibility(input: BoundFinancialInputV1, evidence: LoadedEvidence | undefined, plan: FinancialPlanV1): string | null {
  if (!evidence) return "fact_unavailable";
  if (evidence.invalidated) return "fact_invalidated";
  if (evidence.method !== "reported" && evidence.method !== "extracted") return "fact_not_reported";
  if (evidence.source_id !== input.source.source_id) return "source_changed";
  if (plan.time.time_mode === "public_information" && evidence.source_user_id !== null) return "source_not_public";
  if (evidence.source_version_hash !== input.source.source_version_hash) return "source_version_changed";
  if (!evidence.precision_current) return "precision_proof_superseded";
  if (!evidence.publication) return "publication_proof_unavailable";
  if (publicAtCutoff(evidence.publication, plan.time.knowledge_cutoff) !== "eligible") return "not_public_at_cutoff";
  if (Date.parse(input.publication.available_no_later_than) > Date.parse(plan.time.knowledge_cutoff)) return "not_public_at_cutoff";
  const context = evidence.context;
  if (!context) return "context_unavailable";
  if (context.period_type !== input.period.kind || context.dimension_scope !== input.dimensions.scope
    || context.adjustment_basis !== input.basis.adjustment || context.share_basis !== input.basis.share_basis
    || context.fiscal_calendar_version !== input.period.calendar_version) {
    return "context_changed";
  }
  return null;
}

function failure(reason_code: FinancialVerifierReasonCode, details: JsonObject): FinancialVerifierFailure {
  return Object.freeze({ reason_code, details: Object.freeze(details) });
}

function failed(reason_code: FinancialVerifierReasonCode, details: JsonObject): FinancialVerification {
  return { ok: false, failures: [failure(reason_code, details)] };
}
