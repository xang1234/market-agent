// A market cap and P/E unit (#444) seals only when the verifier recomputes
// both from inputs whose evidence still proves them as bound: NVDA's Friday
// close, its 10-Q cover count, and its FY2024 diluted EPS, each restated to
// Monday 2024-06-10 after the 10-for-1 split.

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
  type BoundFinancialInputV1,
  type FinancialPlanV1,
  type MetricValueKind,
  type SlotBinding,
  type SplitAdjustmentV2,
} from "../../financial-core/src/index.ts";
import type { FinancialUnitRecords, LoadedEvidence } from "../src/financial-verifier-loader.ts";
import { verifyFinancialUnit, type FinancialSealContext, type FinancialVerification } from "../src/financial-verifier.ts";
import { YAHOO_FINANCE_DEV_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { F, mutable } from "./financial-fixtures.ts";

const POLYGON = "00000000-0000-4000-a000-000000000009";
const TEN_K = "5f000000-0000-4000-8000-0000000005c1";
const TEN_Q = "5f000000-0000-4000-8000-0000000005c2";
const LISTING = "5f000000-0000-4000-8000-0000000005e1";
const OBSERVATION = "5f000000-0000-4000-8000-0000000005d1";
const EPS_FACT = "5f000000-0000-4000-8000-0000000005d2";
const SHARES_FACT = "5f000000-0000-4000-8000-0000000005d3";
const PUBLICATION: Readonly<Record<string, string>> = { [TEN_K]: "5f000000-0000-4000-8000-0000000005f1", [TEN_Q]: "5f000000-0000-4000-8000-0000000005f2" };
const SOURCE_VERSION: Readonly<Record<string, string>> = { [TEN_K]: "4".repeat(64), [TEN_Q]: "5".repeat(64) };
const PUBLIC_BY: Readonly<Record<string, string>> = { [TEN_K]: "2024-02-22T04:59:59.999Z", [TEN_Q]: "2024-05-30T03:59:59.999Z" };
const PRECISION: Readonly<Record<string, string>> = { shares: "5f000000-0000-4000-8000-000000000601", eps: "5f000000-0000-4000-8000-000000000602" };
// 10:00 on Monday 2024-06-10 in New York: NVDA's split has executed, Monday's session has not closed.
const CUTOFF = "2024-06-10T14:00:00.000Z";
const SPLIT = { execution_date: "2024-06-10", split_from: "1", split_to: "10" };
const CONTEXT: FinancialSealContext = { snapshot_id: F.snapshot, manifest: { fact_refs: [EPS_FACT, SHARES_FACT], source_ids: [TEN_K, TEN_Q, POLYGON], as_of: CUTOFF } };

function valuationPlan(): FinancialPlanV1 {
  const reported = (node_id: string, metric_key: string, period: Record<string, unknown>) =>
    ({ node_id, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key, period });
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
    metric_definitions: ["share_price", "shares_outstanding", "eps_diluted"].map((key) => ({ metric_key: key, definition_version: `${key}.v1` })),
    operations: [
      reported("px", "share_price", { kind: "at_cutoff" }),
      reported("shares", "shares_outstanding", { kind: "latest", period_type: "quarterly", offset: 0 }),
      reported("eps", "eps_diluted", { kind: "latest", period_type: "annual", offset: 0 }),
      { node_id: "cap", operation: "market_cap", operation_version: "market_cap.v1", price: "px", shares: "shares" },
      { node_id: "pe", operation: "pe_ratio", operation_version: "pe_ratio.v1", price: "px", earnings: "eps" },
    ],
    outputs: [{ output_id: "out_cap", node_id: "cap", unit_id: "valuation" }, { output_id: "out_pe", node_id: "pe", unit_id: "valuation" }],
    publication_units: [{ unit_id: "valuation", kind: "chat_section" }],
    thresholds: [],
    limits: { max_subjects: 25, max_periods_per_subject: 20, max_operations: 512, max_outputs: 2000, max_input_candidates: 10000, max_concurrent_evidence_tasks: 4 },
    presentation_template_version: "financial-answer.v1",
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

/** `value` on the split basis of `asFiledOn`, restated by the split to Monday. */
function restated(value: string, valueKind: MetricValueKind, asFiledOn: string): SplitAdjustmentV2 {
  const parsed = parseFinancialDecimal(value);
  assert.ok(parsed.ok);
  const outcome = restateToReference({
    native: rationalFromDecimal(parsed.value)!, value_kind: valueKind, as_filed_on: asFiledOn, reference_date: "2024-06-10",
    listing_id: LISTING, listing_timezone: "America/New_York", splits: [SPLIT],
  });
  assert.ok(outcome.ok);
  return outcome.adjustment;
}

function validated(input: unknown): BoundFinancialInputV1 {
  const outcome = validateBoundInput(input);
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.issues));
  return outcome.value;
}

/** An SEC value as binding records it: certified as filed on `asFiledOn`, restated to Monday. */
function filed(slot: string, factId: string, source: string, metric: string, value: string, asFiledOn: string, period: Record<string, unknown>): BoundFinancialInputV1 {
  const shares = metric === "shares_outstanding";
  return validated({
    schema_version: "financial_bound_input.v1",
    input_slot: slot,
    fact_id: factId,
    subject_ref: { kind: "issuer", id: F.issuer },
    metric: { metric_key: metric, definition_version: `${metric}.v1` },
    source: { source_id: source, document_id: null, source_version_hash: SOURCE_VERSION[source], locator: `locator:${factId}` },
    numeric: { raw_token: value, token_proof_hash: F.proof, value, scale: "1", native_value: value },
    unit: shares ? { kind: "shares" } : { kind: "currency_per_share", currency: "USD" },
    period: { ...period, calendar_version: "fiscal-calendar.v1" },
    dimensions: { scope: "consolidated", members: [] },
    basis: { reporting: "as_reported", adjustment: "split_adjusted", share_basis: shares ? "not_applicable" : "diluted" },
    split_adjustment: restated(value, shares ? "share_count" : "per_share", asFiledOn),
    publication: { attestation_id: PUBLICATION[source], available_no_later_than: PUBLIC_BY[source], precision: "date", source_timezone: "America/New_York" },
    observed_at: "2026-10-01T00:00:00.000Z",
    precision_status: "source_token_preserved",
    eligibility: { selection_policy_version: "public-information-selection.v4", promotion_status: "authoritative", candidate_set_digest: F.digest },
  });
}

function evidence(input: BoundFinancialInputV1): LoadedEvidence {
  assert.ok(input.schema_version === "financial_bound_input.v1" && input.split_adjustment);
  return {
    fact_id: input.fact_id, source_id: input.source.source_id, source_kind: "filing", invalidated: false, method: "reported", source_user_id: null,
    source_version_hash: input.source.source_version_hash,
    publication: { attestation_id: input.publication.attestation_id, available_not_before: null, available_no_later_than: input.publication.available_no_later_than, timing_precision: "date", source_timezone: "America/New_York" },
    precision_current: true,
    context: {
      period_type: input.period.kind, dimension_scope: "consolidated", adjustment_basis: "as_filed", as_filed_on: input.split_adjustment.as_filed_on,
      share_basis: input.basis.share_basis, fiscal_calendar_version: "fiscal-calendar.v1",
    },
  };
}

function valuationRecords(): FinancialUnitRecords {
  const plan = valuationPlan();
  const price = validated({
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
    split_adjustment: restated("1200", "price", "2024-06-07"),
    eligibility: { selection_policy_version: "price-at-cutoff-selection.v1", candidate_set_digest: F.digest },
  });
  const shares = filed("shares", SHARES_FACT, TEN_Q, "shares_outstanding", "2464000000", "2024-05-17",
    { kind: "instant", start: null, end: "2024-05-17", fiscal_year: 2025, fiscal_period: "Q1" });
  const eps = filed("eps", EPS_FACT, TEN_K, "eps_diluted", "11.93", "2024-02-21",
    { kind: "duration", start: "2023-01-30", end: "2024-01-28", fiscal_year: 2024, fiscal_period: "FY" });
  const inputs = [price, shares, eps];
  const bindings = new Map<string, SlotBinding>(inputs.map((input) => [input.input_slot, { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: F.digest }]));
  const evaluation = evaluateBoundPlan(plan, bindings);
  const publication = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "valuation");
  const closure = unitClosures(plan).get("valuation")!;
  const computationIds = new Map(publication.computations.map((computation, index) => [computation.node_id, `5f000000-0000-4000-8000-00000000050${index}`]));
  return {
    run: { run_id: F.run, plan_id: F.plan, parent_kind: "chat_thread", parent_id: F.parent, parent_version: "1", request_hash: planSemanticHash(plan), execution_state: "ready_to_seal", knowledge_cutoff: CUTOFF, allowed_source_classes: ["market_data", "sec_filing"] },
    plan: { plan: JSON.parse(JSON.stringify(plan)), semantic_hash: planSemanticHash(plan) },
    unit: {
      unit_id: "valuation", state: "computed", coverage_state: publication.coverage, output_ids: [...closure.output_ids], closure_node_ids: [...closure.node_ids],
      closure_hash: hashCanonical("unit_closure", { unit_id: closure.unit_id, output_ids: closure.output_ids, node_ids: closure.node_ids }),
    },
    bindings: inputs.map((input) => ({
      input_slot: input.input_slot, binding_status: "bound",
      fact_id: input.schema_version === "financial_bound_input.v1" ? input.fact_id : null,
      publication_attestation_id: input.schema_version === "financial_bound_input.v1" ? input.publication.attestation_id : null,
      precision_attestation_id: PRECISION[input.input_slot] ?? null,
      price_observation_id: input.schema_version === "financial_bound_price_input.v1" ? input.observation_id : null,
      bound_payload: JSON.parse(JSON.stringify(input)), payload_hash: hashCanonical("bound_input", input), gap_reason: null, candidate_set_digest: F.digest,
    })),
    evidence: [evidence(shares), evidence(eps)],
    price_observations: [{
      observation_id: OBSERVATION, listing_id: LISTING, source_id: POLYGON, source_kind: "market_data", source_user_id: null, kind: "session_close", price_text: "1200.00", currency: "USD",
      observed_at: "2024-06-07T20:00:00.000Z", known_at: "2024-06-07T20:15:00.000Z", body_sha256: "d".repeat(64),
    }],
    split_histories: [{
      subject_ref: { kind: "issuer", id: F.issuer },
      history: { status: "ok", listing_id: LISTING, timezone: "America/New_York", checked_at: "2024-06-10T12:00:00.000Z", splits: [{ ...SPLIT, provider_ref: "E1" }] },
    }],
    computations: publication.computations.map((computation) => ({
      computation_id: computationIds.get(computation.node_id)!, node_id: computation.node_id, formula_id: computation.operation,
      operation_version: computation.operation_version, numeric_policy_version: computation.numeric_policy_version,
      definition_versions: JSON.parse(JSON.stringify(computation.definition_versions)), input_refs: JSON.parse(JSON.stringify(computation.input_refs)), output_hash: computation.output_hash,
    })),
    results: publication.results.map((result, index) => ({
      result_id: `5f000000-0000-4000-8000-00000000070${index}`, output_id: result.output_id, node_id: result.node_id, unit_id: result.unit_id,
      computation_id: computationIds.get(result.node_id) ?? null, state: "draft", disposition: result.disposition,
      payload: JSON.parse(JSON.stringify(result.payload)), dependencies: [...result.dependencies], result_hash: result.result_hash,
    })),
    subject_names: [{ kind: "issuer", id: F.issuer, name: "NVIDIA Corporation" }],
  };
}

function reasons(outcome: FinancialVerification): string[] {
  return outcome.ok ? [] : outcome.failures.map((failure) => `${failure.reason_code}:${String(failure.details.field ?? failure.details.reason ?? "")}`);
}

test("the seal recomputes market cap and P/E from their restated inputs and presents them", () => {
  const outcome = verifyFinancialUnit(valuationRecords(), "valuation", CONTEXT);
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  assert.deepEqual(outcome.certificate.computations.map((computation) => computation.node_id), ["cap", "pe"]);
  assert.deepEqual(outcome.block.financial.results.map((result) => [result.disposition, result.presented.kind === "value" && result.presented.value, result.presented.text]), [
    ["verified", "2956800000000", "USD 2,956,800,000,000.00"],
    ["verified", "100.58675607711651299245599329421626152556580050293", "100.59x"],
  ]);
});

test("a tampered market cap or P/E fails the seal", () => {
  const value = mutable(valuationRecords());
  value.results[0].payload.value = "2956800000001";
  assert.deepEqual(reasons(verifyFinancialUnit(value, "valuation", CONTEXT)), ["financial_recompute_mismatch:payload"]);
  const hash = mutable(valuationRecords());
  hash.results[1].result_hash = "0".repeat(64);
  assert.deepEqual(reasons(verifyFinancialUnit(hash, "valuation", CONTEXT)), ["financial_recompute_mismatch:result_hash"]);
  const lineage = mutable(valuationRecords());
  lineage.computations[0].output_hash = "0".repeat(64);
  assert.deepEqual(reasons(verifyFinancialUnit(lineage, "valuation", CONTEXT)), ["financial_lineage_mismatch:output_hash"]);
});

test("a tampered price or share count fails the seal", () => {
  const rehash = (slot: string, edit: (payload: any) => void) => {
    const records = mutable(valuationRecords());
    const binding = records.bindings.find((row: { input_slot: string }) => row.input_slot === slot);
    edit(binding.bound_payload);
    binding.payload_hash = hashCanonical("bound_input", binding.bound_payload);
    return reasons(verifyFinancialUnit(records, "valuation", CONTEXT));
  };
  assert.deepEqual(rehash("px", (payload) => { payload.numeric = { raw_token: "1100.00", value: "1100" }; }), ["financial_input_ineligible:price_observation_changed"]);
  // A count edited with its restatement kept no longer restates to it from the listing's splits.
  assert.deepEqual(rehash("shares", (payload) => { payload.numeric = { ...payload.numeric, raw_token: "2464000001", value: "2464000001", native_value: "2464000001" }; }), ["financial_input_ineligible:splits_changed"]);
  const edited = mutable(valuationRecords());
  edited.bindings[1].bound_payload.numeric.value = "2464000001";
  assert.deepEqual(reasons(verifyFinancialUnit(edited, "valuation", CONTEXT)), ["financial_binding_mismatch:payload_hash"]);
});

test("the seal re-checks each bound input's class against the grant its run recorded (#444)", () => {
  const filingsOnly = mutable(valuationRecords());
  filingsOnly.run.allowed_source_classes = ["sec_filing"];
  assert.deepEqual(reasons(verifyFinancialUnit(filingsOnly, "valuation", CONTEXT)), ["financial_input_ineligible:source_class_not_allowed"]);

  // A development feed's price has no class, whatever the run was granted.
  const yahoo = mutable(valuationRecords());
  const price = yahoo.bindings.find((row: { input_slot: string }) => row.input_slot === "px");
  price.bound_payload.source.source_id = YAHOO_FINANCE_DEV_MARKET_SOURCE_ID;
  price.payload_hash = hashCanonical("bound_input", price.bound_payload);
  yahoo.price_observations[0].source_id = YAHOO_FINANCE_DEV_MARKET_SOURCE_ID;
  assert.deepEqual(reasons(verifyFinancialUnit(yahoo, "valuation", CONTEXT)), ["financial_input_ineligible:source_class_not_allowed"]);

  // A fact whose source is no filing is no SEC filing.
  const article = mutable(valuationRecords());
  article.evidence[0].source_kind = "article";
  assert.deepEqual(reasons(verifyFinancialUnit(article, "valuation", CONTEXT)), ["financial_input_ineligible:source_class_not_allowed"]);
});
