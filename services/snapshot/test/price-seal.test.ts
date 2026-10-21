// A share price unit (#444) seals only while its observation, the listing its
// subject resolves to, and that listing's splits still prove it as bound.

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBoundPlan,
  hashCanonical,
  nodeLineageHashes,
  parseFinancialDecimal,
  planSemanticHash,
  rationalFromDecimal,
  restateToReference,
  unitClosures,
  unitPublication,
  validateBoundInput,
  validateFinancialPlan,
  type BoundPriceInputV1,
  type FinancialPlanV1,
  type SlotBinding,
} from "../../financial-core/src/index.ts";
import type { FinancialUnitRecords } from "../src/financial-verifier-loader.ts";
import { verifyFinancialUnit, type FinancialSealContext, type FinancialVerification } from "../src/financial-verifier.ts";
import { F, mutable } from "./financial-fixtures.ts";

const POLYGON = "00000000-0000-4000-a000-000000000009";
const LISTING = "5f000000-0000-4000-8000-0000000003e1";
const OBSERVATION = "5f000000-0000-4000-8000-0000000003d1";
// 10:00 on Monday 2024-06-10 in New York: NVDA's split has executed, Monday's session has not closed.
const CUTOFF = "2024-06-10T14:00:00.000Z";
const SPLIT = { execution_date: "2024-06-10", split_from: "1", split_to: "10" };
const CONTEXT: FinancialSealContext = { snapshot_id: F.snapshot, manifest: { fact_refs: [], source_ids: [POLYGON], as_of: CUTOFF } };

function pricePlan(): FinancialPlanV1 {
  const validated = validateFinancialPlan({
    schema_version: "financial_plan.v1",
    plan_id: F.plan,
    origin: { kind: "chat_request", ref: "chat:turn:1" },
    planner: { kind: "deterministic", adapter_version: "test.v1", model: null, prompt_version: null },
    catalog_version: "catalog.v1",
    interpretation: null,
    subjects: {
      membership: "explicit", requested_count: 1, resolved_count: 1, omitted_count: 0,
      members: [{ slot_id: "a", subject_ref: { kind: "issuer", id: F.issuer }, display_order: 0, role: "primary" }],
    },
    time: { knowledge_cutoff: CUTOFF, cutoff_timezone: "America/New_York", time_mode: "public_information" },
    policies: { reporting_basis: "as_reported", period_policy: "exact_fiscal", freshness: { max_age_days: null }, source_policy_version: "sources.v1" },
    metric_definitions: [{ metric_key: "share_price", definition_version: "share_price.v1" }],
    operations: [{ node_id: "px", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "share_price", period: { kind: "at_cutoff" } }],
    outputs: [{ output_id: "out_px", node_id: "px", unit_id: "price_unit" }],
    publication_units: [{ unit_id: "price_unit", kind: "chat_section" }],
    thresholds: [],
    limits: { max_subjects: 25, max_periods_per_subject: 20, max_operations: 512, max_outputs: 2000, max_input_candidates: 10000, max_concurrent_evidence_tasks: 4 },
    presentation_template_version: "financial-answer.v1",
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

/** Friday's 1200.00 close, bound restated to Monday after the split: the records a seal loads. */
function priceRecords(): FinancialUnitRecords {
  const plan = pricePlan();
  const parsed = parseFinancialDecimal("1200.00");
  assert.ok(parsed.ok);
  const restated = restateToReference({
    native: rationalFromDecimal(parsed.value)!, value_kind: "price", as_filed_on: "2024-06-07", reference_date: "2024-06-10",
    listing_id: LISTING, listing_timezone: "America/New_York", splits: [SPLIT],
  });
  assert.ok(restated.ok);
  const validated = validateBoundInput({
    schema_version: "financial_bound_price_input.v1",
    input_slot: "px",
    observation_id: OBSERVATION,
    subject_ref: { kind: "issuer", id: F.issuer },
    metric: { metric_key: "share_price", definition_version: "share_price.v1" },
    listing_id: LISTING,
    source: { source_id: POLYGON, body_sha256: "d".repeat(64) },
    observation_kind: "session_close",
    numeric: { raw_token: "1200.00", value: "1200" },
    unit: { kind: "currency_per_share", currency: "USD" },
    observed_at: "2024-06-07T20:00:00.000Z",
    known_at: "2024-06-07T20:15:00.000Z",
    split_adjustment: restated.adjustment,
    eligibility: { selection_policy_version: "price-at-cutoff-selection.v1", candidate_set_digest: F.digest },
  });
  assert.ok(validated.ok && validated.value.schema_version === "financial_bound_price_input.v1", JSON.stringify(!validated.ok && validated.issues));
  const input: BoundPriceInputV1 = validated.value;
  const bindings = new Map<string, SlotBinding>([["px", { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: F.digest }]]);
  const evaluation = evaluateBoundPlan(plan, bindings);
  const publication = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "price_unit");
  const closure = unitClosures(plan).get("price_unit")!;
  return {
    run: { run_id: F.run, plan_id: F.plan, parent_kind: "chat_thread", parent_id: F.parent, parent_version: "1", request_hash: planSemanticHash(plan), execution_state: "ready_to_seal", knowledge_cutoff: CUTOFF },
    plan: { plan: JSON.parse(JSON.stringify(plan)), semantic_hash: planSemanticHash(plan) },
    unit: {
      unit_id: "price_unit", state: "computed", coverage_state: publication.coverage, output_ids: [...closure.output_ids], closure_node_ids: [...closure.node_ids],
      closure_hash: hashCanonical("unit_closure", { unit_id: closure.unit_id, output_ids: closure.output_ids, node_ids: closure.node_ids }),
    },
    bindings: [{
      input_slot: "px", binding_status: "bound", fact_id: null, publication_attestation_id: null, precision_attestation_id: null, price_observation_id: OBSERVATION,
      bound_payload: JSON.parse(JSON.stringify(input)), payload_hash: hashCanonical("bound_input", input), gap_reason: null, candidate_set_digest: F.digest,
    }],
    evidence: [],
    price_observations: [{
      observation_id: OBSERVATION, listing_id: LISTING, source_id: POLYGON, source_user_id: null, kind: "session_close", price_text: "1200.00", currency: "USD",
      observed_at: "2024-06-07T20:00:00.000Z", known_at: "2024-06-07T20:15:00.000Z", body_sha256: "d".repeat(64),
    }],
    split_histories: [{
      subject_id: F.issuer,
      history: { status: "ok", listing_id: LISTING, timezone: "America/New_York", checked_at: "2024-06-10T12:00:00.000Z", splits: [{ ...SPLIT, provider_ref: "E1" }] },
    }],
    computations: publication.computations.map((computation) => ({
      computation_id: "5f000000-0000-4000-8000-000000000401", node_id: computation.node_id, formula_id: computation.operation,
      operation_version: computation.operation_version, numeric_policy_version: computation.numeric_policy_version,
      definition_versions: JSON.parse(JSON.stringify(computation.definition_versions)), input_refs: JSON.parse(JSON.stringify(computation.input_refs)), output_hash: computation.output_hash,
    })),
    results: publication.results.map((result) => ({
      result_id: "5f000000-0000-4000-8000-000000000301", output_id: result.output_id, node_id: result.node_id, unit_id: result.unit_id,
      computation_id: publication.computations.some((computation) => computation.node_id === result.node_id) ? "5f000000-0000-4000-8000-000000000401" : null,
      state: "draft", disposition: result.disposition, payload: JSON.parse(JSON.stringify(result.payload)), dependencies: [...result.dependencies], result_hash: result.result_hash,
    })),
    subject_names: [{ kind: "issuer", id: F.issuer, name: "NVIDIA Corporation" }],
  };
}

function reasons(outcome: FinancialVerification): string[] {
  return outcome.ok ? [] : outcome.failures.map((failure) => `${failure.reason_code}:${String(failure.details.field ?? failure.details.reason ?? "")}`);
}

test("a bound price seals as 120, with its observation as stored", () => {
  const outcome = verifyFinancialUnit(priceRecords(), "price_unit", CONTEXT);
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  assert.deepEqual(outcome.certificate.inputs, [{ input_slot: "px", status: "bound", fact_id: null, payload_hash: priceRecords().bindings[0]!.payload_hash, reason_code: null, candidate_set_digest: F.digest }]);
  assert.deepEqual(outcome.block.financial.results.map((result) => result.presented), [
    { kind: "value", text: "USD 120.00 per share", full_text: "USD 120 per share", value: "120", unit: { kind: "currency_per_share", currency: "USD" }, exact: true },
  ]);
});

test("a changed or missing observation fails the seal", () => {
  const missing = mutable(priceRecords());
  missing.price_observations = [];
  assert.deepEqual(reasons(verifyFinancialUnit(missing, "price_unit", CONTEXT)), ["financial_input_ineligible:price_observation_unavailable"]);
  for (const [field, value] of [["price_text", "1200.01"], ["known_at", "2024-06-07T20:16:00.000Z"], ["observed_at", "2024-06-07T19:00:00.000Z"], ["body_sha256", "e".repeat(64)]] as const) {
    const changed = mutable(priceRecords());
    changed.price_observations[0][field] = value;
    assert.deepEqual(reasons(verifyFinancialUnit(changed, "price_unit", CONTEXT)), ["financial_input_ineligible:price_observation_changed"], field);
  }
});

test("a tampered price or adjustment fails the seal", () => {
  const rehash = (edit: (payload: any) => void) => {
    const records = mutable(priceRecords());
    edit(records.bindings[0].bound_payload);
    records.bindings[0].payload_hash = hashCanonical("bound_input", records.bindings[0].bound_payload);
    return reasons(verifyFinancialUnit(records, "price_unit", CONTEXT));
  };
  assert.deepEqual(rehash((payload) => { payload.numeric = { raw_token: "1100.00", value: "1100" }; }), ["financial_input_ineligible:price_observation_changed"]);
  // Internally consistent, so core accepts it: only the listing's splits show the split was dropped.
  assert.deepEqual(rehash((payload) => {
    payload.split_adjustment = { ...payload.split_adjustment, splits: [], factor: { numerator: "1", denominator: "1" }, adjusted_native_value: { numerator: "1200", denominator: "1" } };
  }), ["financial_input_ineligible:splits_changed"]);
  const edited = mutable(priceRecords());
  edited.bindings[0].bound_payload.numeric.raw_token = "1100.00";
  assert.deepEqual(reasons(verifyFinancialUnit(edited, "price_unit", CONTEXT)), ["financial_binding_mismatch:payload_hash"]);
});

test("the seal resolves the subject's listing again and rebuilds the restatement from its splits", () => {
  const relisted = mutable(priceRecords());
  relisted.split_histories[0].history.listing_id = "5f000000-0000-4000-8000-0000000003e2";
  assert.deepEqual(reasons(verifyFinancialUnit(relisted, "price_unit", CONTEXT)), ["financial_input_ineligible:listing_changed"]);
  const unresolved = mutable(priceRecords());
  unresolved.split_histories[0].history = { status: "gap", reason_code: "split_listing_unresolved" };
  assert.deepEqual(reasons(verifyFinancialUnit(unresolved, "price_unit", CONTEXT)), ["financial_input_ineligible:listing_changed"]);
  const resplit = mutable(priceRecords());
  resplit.split_histories[0].history.splits = [{ ...SPLIT, split_to: "20" }];
  assert.deepEqual(reasons(verifyFinancialUnit(resplit, "price_unit", CONTEXT)), ["financial_input_ineligible:splits_changed"]);
});

test("the seal must cite the price's source", () => {
  assert.deepEqual(reasons(verifyFinancialUnit(priceRecords(), "price_unit", { ...CONTEXT, manifest: { ...CONTEXT.manifest, source_ids: [] } })), ["financial_manifest_mismatch:source_ids"]);
});
