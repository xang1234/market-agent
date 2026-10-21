import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { randomUUID } from "node:crypto";
import { hashCanonical, validateBoundInput, validateFinancialPlan, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { bindPlanInputs, type InputBinding } from "../src/bind-inputs.ts";
import { ExecutionIntegrityError } from "../../financial-core/src/index.ts";
import { StaleLeaseError } from "../src/lease.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { authorityFor, engineDatabase, IDS, leasedRun, ORIGINAL_REVENUE, revenuePlan, seedReportedFact } from "./db-fixtures.ts";

function bound(binding: InputBinding | undefined) {
  assert.ok(binding?.status === "bound" && "precision_attestation_id" in binding, JSON.stringify(binding));
  return binding;
}

/** Total assets and total liabilities per subject, both "latest fiscal year" at `offset`. */
function latestBalancePlan(subjects: Array<"a" | "b">, offset: number): FinancialPlanV1 {
  const base = revenuePlan({ subjects });
  const period = { kind: "latest" as const, period_type: "annual" as const, offset };
  const node = (slot: string, nodeId: string, metric: string) =>
    ({ node_id: nodeId, operation: "reported_metric" as const, operation_version: "reported_metric.v1", subject_slot: slot, metric_key: metric, period });
  const operations = subjects.flatMap((slot) => [node(slot, `${slot}_assets`, "total_assets"), node(slot, `${slot}_liab`, "total_liabilities")]);
  const validated = validateFinancialPlan({
    ...base,
    plan_id: randomUUID(),
    metric_definitions: [
      { metric_key: "total_assets", definition_version: "total_assets.v1" },
      { metric_key: "total_liabilities", definition_version: "total_liabilities.v1" },
    ],
    operations,
    outputs: operations.map((operation) => ({ output_id: `out_${operation.node_id}`, node_id: operation.node_id, unit_id: `${operation.subject_slot}_unit` })),
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("historical input binding", { timeout: 240_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for input binding coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-binding");
  const authority = authorityFor();

  await t.test("binds the original public before the cutoff despite later ingestion, and persists it", async () => {
    const plan = revenuePlan();
    const { runId, lease } = await leasedRun(db, plan, authority);
    const result = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    assert.equal(result.reused, false);

    const revenue = bound(result.bindings.get("a_rev"));
    assert.equal(revenue.input.fact_id, IDS.original);
    assert.equal(revenue.input.numeric.value, ORIGINAL_REVENUE);
    assert.equal(revenue.input.numeric.native_value, ORIGINAL_REVENUE);
    assert.equal(revenue.input.observed_at, "2024-02-01T00:00:00.000Z", "ingested after the cutoff");
    assert.equal(revenue.input.publication.available_no_later_than, "2024-01-11T04:59:59.999Z");
    assert.equal(revenue.input.basis.reporting, "as_reported");
    assert.equal(revenue.payload_hash, hashCanonical("bound_input", revenue.input));
    assert.ok(validateBoundInput(revenue.input).ok);
    assert.equal(bound(result.bindings.get("a_prev")).input.fact_id, IDS.fy2022);

    const rows = (await db.query(`select input_slot, binding_status, fact_id::text, payload_hash, bound_payload from financial_run_inputs where run_id = $1 order by input_slot`, [runId])).rows;
    assert.deepEqual(rows.map((row) => [row.input_slot, row.binding_status, row.fact_id]), [["a_prev", "bound", IDS.fy2022], ["a_rev", "bound", IDS.original]]);
    assert.deepEqual(rows[1].bound_payload, revenue.input);
    const run = (await db.query(`select bound_at is not null as bound from financial_runs where run_id = $1`, [runId])).rows[0];
    assert.equal(run.bound, true);
  });

  await t.test("a retry reuses the persisted binding even after new evidence arrives", async () => {
    const plan = revenuePlan({ cutoff: "2024-01-25T00:00:00-05:00", basis: "as_restated" });
    const { runId, lease } = await leasedRun(db, plan, authority);
    const first = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    assert.equal(bound(first.bindings.get("a_rev")).input.fact_id, IDS.restated, "as_restated takes the public restatement");

    // Evidence changes after binding (the restatement is invalidated); the retry must not reselect.
    await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.restated]);
    const retry = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    assert.equal(retry.reused, true);
    assert.equal(bound(retry.bindings.get("a_rev")).payload_hash, bound(first.bindings.get("a_rev")).payload_hash);
    await db.query(`update facts set invalidated_at = null where fact_id = $1`, [IDS.restated]);
  });

  await t.test("private sources never enter the public-information mode", async () => {
    const plan = revenuePlan({ subjects: ["a", "b"] });
    const { runId, lease } = await leasedRun(db, plan, authority);
    const result = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    assert.deepEqual(result.bindings.get("b_rev"), { slot: "b_rev", status: "gap", reason_code: "missing_input", candidate_set_digest: result.bindings.get("b_rev")!.candidate_set_digest });
    const row = (await db.query(`select gap_reason, candidate_count from financial_run_inputs where run_id = $1 and input_slot = 'b_rev'`, [runId])).rows[0];
    assert.deepEqual(row, { gap_reason: "missing_input", candidate_count: 0 });
  });

  await t.test("candidate caps become explicit scope gaps", async () => {
    const plan = revenuePlan({ maxCandidates: 1 });
    const { runId, lease } = await leasedRun(db, plan, authority);
    const result = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    const gap = result.bindings.get("a_rev");
    assert.equal(gap?.status === "gap" && gap.reason_code, "scope_limit_exceeded");
    const truncated = (await db.query(`select truncated from financial_run_inputs where run_id = $1 and input_slot = 'a_rev'`, [runId])).rows[0];
    assert.equal(truncated.truncated, true);
  });

  await t.test("the candidate-set digest changes when the authorized candidates change", async () => {
    const plan = revenuePlan();
    const beforeRun = await leasedRun(db, plan, authority);
    const before = await bindPlanInputs({ client: db, lease: beforeRun.lease, plan, authority, evidence: createEvidenceFinancialPort });
    await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.restated]);
    const afterPlan = revenuePlan();
    const afterRun = await leasedRun(db, afterPlan, authority);
    const after = await bindPlanInputs({ client: db, lease: afterRun.lease, plan: afterPlan, authority, evidence: createEvidenceFinancialPort });
    await db.query(`update facts set invalidated_at = null where fact_id = $1`, [IDS.restated]);
    assert.notEqual(before.bindings.get("a_rev")!.candidate_set_digest, after.bindings.get("a_rev")!.candidate_set_digest);
    assert.equal(bound(before.bindings.get("a_rev")).input.fact_id, bound(after.bindings.get("a_rev")).input.fact_id);
  });

  await t.test("latest names one fiscal year per company: an input without that year is a gap, never an older balance (#344)", async () => {
    const facts = {
      assets2023: await seedReportedFact(db, { metric_key: "total_assets", value: "600", fiscal_year: 2023 }),
      assets2022: await seedReportedFact(db, { metric_key: "total_assets", value: "550", fiscal_year: 2022 }),
      liabilities2021: await seedReportedFact(db, { metric_key: "total_liabilities", value: "250", fiscal_year: 2021 }),
      assetsB2022: await seedReportedFact(db, { metric_key: "total_assets", value: "90", fiscal_year: 2022, subject: IDS.issuerB }),
      liabilitiesB2022: await seedReportedFact(db, { metric_key: "total_liabilities", value: "40", fiscal_year: 2022, subject: IDS.issuerB }),
    };
    const bind = async (offset: number) => {
      const plan = latestBalancePlan(["a", "b"], offset);
      const { runId, lease } = await leasedRun(db, plan, authority);
      const { bindings } = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
      const rows = (await db.query(`select input_slot, binding_status, fact_id::text, gap_reason from financial_run_inputs where run_id = $1 order by input_slot`, [runId])).rows;
      return { bindings, rows: rows.map((row) => [row.input_slot, row.binding_status, row.fact_id ?? row.gap_reason]) };
    };

    const latest = await bind(0);
    assert.equal(bound(latest.bindings.get("a_assets")).input.period.fiscal_year, 2023);
    assert.deepEqual(latest.rows, [
      ["a_assets", "bound", facts.assets2023],
      ["a_liab", "gap", "missing_input"],
      ["b_assets", "bound", facts.assetsB2022],
      ["b_liab", "bound", facts.liabilitiesB2022],
    ], "A's FY2021 liabilities are not its latest fiscal year; B keeps its own latest year");

    const prior = await bind(1);
    assert.deepEqual(prior.rows, [
      ["a_assets", "bound", facts.assets2022],
      ["a_liab", "gap", "missing_input"],
      ["b_assets", "gap", "missing_input"],
      ["b_liab", "gap", "missing_input"],
    ], "offset 1 is the year before the company's latest, FY2022, for every input");

    // A failed read may hide a newer year, so none of A's latest inputs is called latest (#349 review).
    const plan = latestBalancePlan(["a", "b"], 0);
    const { runId, lease } = await leasedRun(db, plan, authority);
    const failingLiabilities = (client: Parameters<typeof createEvidenceFinancialPort>[0]) => {
      const port = createEvidenceFinancialPort(client);
      return {
        ...port,
        listInputCandidates: (request: Parameters<typeof port.listInputCandidates>[0]) =>
          request.metric_key === "total_liabilities" && request.subject.id === IDS.issuerA
            ? Promise.resolve({ status: "error" as const, reason_code: "database_error" as const })
            : port.listInputCandidates(request),
      };
    };
    await bindPlanInputs({ client: db, lease, plan, authority, evidence: failingLiabilities });
    const rows = (await db.query(`select input_slot, binding_status, fact_id::text, gap_reason from financial_run_inputs where run_id = $1 order by input_slot`, [runId])).rows;
    assert.deepEqual(rows.map((row) => [row.input_slot, row.binding_status, row.fact_id ?? row.gap_reason]), [
      ["a_assets", "gap", "database_error"],
      ["a_liab", "gap", "database_error"],
      ["b_assets", "bound", facts.assetsB2022],
      ["b_liab", "bound", facts.liabilitiesB2022],
    ]);
  });

  await t.test("stale leases, other owners, and foreign plans cannot bind; failures roll back cleanly", async () => {
    const plan = revenuePlan();
    const { runId, lease } = await leasedRun(db, plan, authority);
    await assert.rejects(
      () => bindPlanInputs({ client: db, lease, plan, authority: authorityFor(IDS.other), evidence: createEvidenceFinancialPort }),
      ExecutionIntegrityError,
    );
    await assert.rejects(
      () => bindPlanInputs({ client: db, lease, plan: revenuePlan(), authority, evidence: createEvidenceFinancialPort }),
      /plan does not belong/,
    );
    await db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where run_id = $1`, [runId]);
    await assert.rejects(() => bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort }), StaleLeaseError);
    assert.equal((await db.query(`select count(*)::int as n from financial_run_inputs where run_id = $1`, [runId])).rows[0].n, 0);
  });
});
