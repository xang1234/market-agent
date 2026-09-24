import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical, planSemanticHash } from "../../financial-core/src/index.ts";
import { verifyFinancialUnit, type FinancialVerification } from "../src/financial-verifier.ts";
import { F, mutable, SEAL_CONTEXT, validRecords } from "./financial-fixtures.ts";

function reasons(outcome: FinancialVerification): string[] {
  return outcome.ok ? [] : outcome.failures.map((failure) => `${failure.reason_code}:${String(failure.details.field ?? failure.details.reason ?? failure.details.state ?? "")}`);
}

function rehashBinding(records: ReturnType<typeof mutable>, slot: string, edit: (payload: any) => void) {
  const row = records.bindings.find((binding: { input_slot: string }) => binding.input_slot === slot);
  edit(row.bound_payload);
  row.payload_hash = hashCanonical("bound_input", row.bound_payload);
}

test("a true calculation with full lineage verifies and yields a deterministic certificate", () => {
  const outcome = verifyFinancialUnit(validRecords(), "section", SEAL_CONTEXT);
  assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  if (!outcome.ok) return;
  assert.equal(outcome.certificate.schema_version, "financial_publication.v1");
  assert.deepEqual(outcome.certificate.run.parent, { kind: "chat_thread", id: F.parent, version: "1" });
  assert.deepEqual(outcome.certificate.inputs.map((input) => [input.input_slot, input.fact_id]), [["a_rev", F.revenueFact], ["a_gp", F.grossProfitFact]]);
  assert.deepEqual(outcome.certificate.results.map((result) => [result.output_id, result.disposition]), [["out_rev", "computed"], ["out_gm", "computed"]]);
  assert.deepEqual(outcome.certificate.computations.map((computation) => computation.node_id), ["a_gm"]);
  assert.equal(outcome.certificate_digest, hashCanonical("publication", outcome.certificate));
  const again = verifyFinancialUnit(validRecords(), "section", SEAL_CONTEXT);
  assert.ok(again.ok && again.certificate_digest === outcome.certificate_digest);
});

test("a wrong value fails even when every citation ID is valid", () => {
  const records = mutable(validRecords());
  records.results.find((row: { output_id: string }) => row.output_id === "out_gm").payload.value = "0.5";
  assert.deepEqual(reasons(verifyFinancialUnit(records, "section", SEAL_CONTEXT)), ["financial_recompute_mismatch:payload"]);
});

test("changing the unit, the result hash, or the disposition of a stored result fails", () => {
  const unit = mutable(validRecords());
  unit.results[0].payload.unit = { kind: "currency", currency: "EUR" };
  assert.deepEqual(reasons(verifyFinancialUnit(unit, "section", SEAL_CONTEXT)), ["financial_recompute_mismatch:payload"]);
  const hash = mutable(validRecords());
  hash.results[0].result_hash = "a".repeat(64);
  assert.deepEqual(reasons(verifyFinancialUnit(hash, "section", SEAL_CONTEXT)), ["financial_recompute_mismatch:result_hash"]);
  const disposition = mutable(validRecords());
  disposition.results[1].disposition = "missing";
  assert.deepEqual(reasons(verifyFinancialUnit(disposition, "section", SEAL_CONTEXT)), ["financial_recompute_mismatch:disposition"]);
});

test("a changed bound value, scale, or definition version is recomputed, not trusted", () => {
  const value = mutable(validRecords());
  rehashBinding(value, "a_rev", (payload) => {
    payload.numeric.value = payload.numeric.raw_token = payload.numeric.native_value = "400000000000";
  });
  assert.deepEqual(reasons(verifyFinancialUnit(value, "section", SEAL_CONTEXT)), ["financial_recompute_mismatch:payload", "financial_recompute_mismatch:payload"]);

  const scale = mutable(validRecords());
  rehashBinding(scale, "a_gp", (payload) => {
    payload.numeric.scale = "1000";
    payload.numeric.native_value = "169148000000000";
  });
  assert.deepEqual(reasons(verifyFinancialUnit(scale, "section", SEAL_CONTEXT)), ["financial_recompute_mismatch:payload"]);

  const definition = mutable(validRecords());
  rehashBinding(definition, "a_gp", (payload) => {
    payload.metric.definition_version = "gross_profit.v2";
  });
  // The margin can no longer be computed, so the unit's coverage no longer matches what was stored.
  assert.deepEqual(reasons(verifyFinancialUnit(definition, "section", SEAL_CONTEXT)), ["financial_recompute_mismatch:coverage"]);
});

test("a binding edited without rehashing, or bound to another fact, is a binding mismatch", () => {
  const unhashed = mutable(validRecords());
  unhashed.bindings[0].bound_payload.numeric.value = "1";
  assert.deepEqual(reasons(verifyFinancialUnit(unhashed, "section", SEAL_CONTEXT)), ["financial_binding_mismatch:payload_hash"]);
  const swapped = mutable(validRecords());
  swapped.bindings[0].fact_id = F.grossProfitFact;
  assert.deepEqual(reasons(verifyFinancialUnit(swapped, "section", SEAL_CONTEXT)), ["financial_binding_mismatch:fact_id"]);
});

test("a changed cutoff or cohort changes the plan identity", () => {
  const cutoff = mutable(validRecords());
  cutoff.run.knowledge_cutoff = "2024-06-30T00:00:00.000Z";
  assert.deepEqual(reasons(verifyFinancialUnit(cutoff, "section", SEAL_CONTEXT)), ["financial_plan_mismatch:knowledge_cutoff"]);

  const planCutoff = mutable(validRecords());
  planCutoff.plan.plan.time.knowledge_cutoff = "2024-06-30T00:00:00.000Z";
  assert.deepEqual(reasons(verifyFinancialUnit(planCutoff, "section", SEAL_CONTEXT)), ["financial_plan_mismatch:semantic_hash"]);

  const cohort = mutable(validRecords());
  cohort.plan.plan.subjects.members[0].subject_ref.id = "5f000000-0000-4000-8000-0000000000a9";
  assert.deepEqual(reasons(verifyFinancialUnit(cohort, "section", SEAL_CONTEXT)), ["financial_plan_mismatch:semantic_hash"]);

  // Even a consistently re-hashed cohort change is caught: the bindings no longer belong to the plan's subject.
  const rehashed = mutable(validRecords());
  rehashed.plan.plan.subjects.members[0].subject_ref.id = "5f000000-0000-4000-8000-0000000000a9";
  rehashed.plan.semantic_hash = rehashed.run.request_hash = planSemanticHash(rehashed.plan.plan);
  assert.deepEqual(reasons(verifyFinancialUnit(rehashed, "section", SEAL_CONTEXT)), ["financial_binding_mismatch:subject"]);
});

test("computation lineage is checked in both directions", () => {
  const output = mutable(validRecords());
  output.computations[0].output_hash = "b".repeat(64);
  assert.deepEqual(reasons(verifyFinancialUnit(output, "section", SEAL_CONTEXT)), ["financial_lineage_mismatch:output_hash"]);
  const missing = mutable(validRecords());
  missing.computations = [];
  assert.deepEqual(reasons(verifyFinancialUnit(missing, "section", SEAL_CONTEXT)), ["financial_lineage_mismatch:missing", "financial_lineage_mismatch:computation_id"]);
  const dangling = mutable(validRecords());
  dangling.results[0].computation_id = dangling.computations[0].computation_id;
  assert.deepEqual(reasons(verifyFinancialUnit(dangling, "section", SEAL_CONTEXT)), ["financial_lineage_mismatch:computation_id"]);
});

test("current evidence is rechecked: invalidation, access, versions, proofs, and time", () => {
  const cases: Array<[string, (records: ReturnType<typeof mutable>) => void]> = [
    ["fact_invalidated", (records) => { records.evidence[0].invalidated = true; }],
    ["source_not_public", (records) => { records.evidence[0].source_user_id = F.owner; }],
    ["source_version_changed", (records) => { records.evidence[0].source_version_hash = "c".repeat(64); }],
    ["precision_proof_superseded", (records) => { records.evidence[0].precision_current = false; }],
    ["publication_proof_unavailable", (records) => { records.evidence[0].publication = null; }],
    ["not_public_at_cutoff", (records) => { records.evidence[0].publication.available_no_later_than = "2024-02-01T00:00:00.000Z"; }],
    ["context_changed", (records) => { records.evidence[0].context.dimension_scope = "segment"; }],
    ["fact_unavailable", (records) => { records.evidence.shift(); }],
  ];
  for (const [reason, edit] of cases) {
    const records = mutable(validRecords());
    edit(records);
    const outcome = verifyFinancialUnit(records, "section", SEAL_CONTEXT);
    assert.ok(!outcome.ok && outcome.failures.some((failure) => failure.details.reason === reason), `${reason}: ${JSON.stringify(outcome)}`);
    assert.ok(!outcome.ok && outcome.failures.every((failure) => failure.reason_code === "financial_input_ineligible"));
  }
});

test("the seal must cite the bound facts and sources at the knowledge cutoff", () => {
  const withoutFact = { ...SEAL_CONTEXT, manifest: { ...SEAL_CONTEXT.manifest, fact_refs: [F.revenueFact] } };
  assert.deepEqual(reasons(verifyFinancialUnit(validRecords(), "section", withoutFact)), ["financial_manifest_mismatch:fact_refs"]);
  const laterAsOf = { ...SEAL_CONTEXT, manifest: { ...SEAL_CONTEXT.manifest, as_of: "2026-09-24T00:00:00.000Z" } };
  assert.deepEqual(reasons(verifyFinancialUnit(validRecords(), "section", laterAsOf)), ["financial_manifest_mismatch:as_of"]);
});

test("only a ready run and a computed unit can be certified", () => {
  const running = mutable(validRecords());
  running.run.execution_state = "running";
  assert.deepEqual(reasons(verifyFinancialUnit(running, "section", SEAL_CONTEXT)), ["financial_run_not_ready:"]);
  const sealed = mutable(validRecords());
  sealed.unit.state = "sealed";
  assert.deepEqual(reasons(verifyFinancialUnit(sealed, "section", SEAL_CONTEXT)), ["financial_unit_not_ready:sealed"]);
  assert.deepEqual(reasons(verifyFinancialUnit(validRecords(), "other_unit", SEAL_CONTEXT)), ["financial_closure_mismatch:"]);
});

test("caller-supplied verification claims and numbers carry no weight", () => {
  const tampered = mutable(validRecords());
  tampered.results[1].payload.value = "0.99";
  const callerContext = { ...SEAL_CONTEXT, verified: true, results: [{ output_id: "out_gm", value: "0.99", disposition: "verified" }] };
  assert.equal(verifyFinancialUnit(tampered, "section", callerContext as typeof SEAL_CONTEXT).ok, false);
});

test("diagnostics carry identifiers and codes, never values", () => {
  const records = mutable(validRecords());
  records.results[0].payload.value = "383285000000.123456789012345679";
  const outcome = verifyFinancialUnit(records, "section", SEAL_CONTEXT);
  assert.ok(!outcome.ok);
  assert.doesNotMatch(JSON.stringify(outcome), /383285000000/);
});
