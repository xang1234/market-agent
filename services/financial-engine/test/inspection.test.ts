import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { recordFactPrecisionAttestation } from "../../evidence/src/financial-attestations.ts";
import Ajv2020 from "../../financial-core/node_modules/ajv/dist/2020.js";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import { validateFinancialPlan, type DerivationProofV1, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { inspectCommittedResult, type ResultInspection } from "../src/inspection.ts";
import type { SqlExecutor } from "../src/ports.ts";
import { completedRun, engineDatabase, IDS, marginPlan, pinnedClients, readyRun, revenuePlan } from "./db-fixtures.ts";

function available(inspection: ResultInspection | null): Extract<ResultInspection, { availability: "available" }> {
  assert.ok(inspection && inspection.availability === "available", JSON.stringify(inspection));
  return inspection;
}

type Statement = Readonly<{ sql: string; params: unknown[] }>;

/** Applies `change` for the duration of `action`, bypassing immutability guards, then applies `restore`. */
async function whileChanged<T>(db: Client, change: Statement, restore: Statement, action: () => Promise<T>): Promise<T> {
  const bypass = async ({ sql, params }: Statement) => {
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query(sql, params);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  };
  await bypass(change);
  try {
    return await action();
  } finally {
    await bypass(restore);
  }
}

const Q4_FACT = "4f000000-0000-4000-8000-0000000000d9";

async function seedDerivedQuarter(db: Client): Promise<DerivationProofV1> {
  await db.query(
    `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence)
     values ($1, 'issuer', $2, $3, 'fiscal_q', '2023-10-01', '2023-12-31', 2023, 'Q4', 100000000000, 'currency', 'USD', 1,
             '2024-02-01T00:00:00Z', '2024-01-10T00:00:00Z', '2024-02-01T00:00:00Z', $4, 'reported', 'authoritative', 'filing_time', 'full', 1)`,
    [Q4_FACT, IDS.issuerA, IDS.revenue, IDS.sourceV1],
  );
  const term = (sign: "+" | "-", fiscal_period: "FY" | "Q1" | "Q2" | "Q3", start: string, end: string, raw_token: string, source_id: string, filed: string) => ({
    sign,
    span: fiscal_period === "FY" ? ("fiscal_year" as const) : ("quarter" as const),
    fiscal_year: 2023,
    fiscal_period,
    start,
    end,
    raw_token,
    token_proof_hash: "8".repeat(64),
    source: { source_id, accession: `0000000001-23-${fiscal_period}`, form: fiscal_period === "FY" ? "10-K" : "10-Q", filed, locator: `locator:${fiscal_period}` },
  });
  const derivation: DerivationProofV1 = {
    version: "period_difference.v1",
    concept: "Revenues",
    unit: "USD",
    terms: [
      term("+", "FY", "2023-01-01", "2023-12-31", "400000000000", IDS.sourceV1, "2024-01-10"),
      term("-", "Q1", "2023-01-01", "2023-03-31", "90000000000", "4f000000-0000-4000-8000-0000000000c5", "2023-05-01"),
      term("-", "Q2", "2023-04-01", "2023-06-30", "100000000000", "4f000000-0000-4000-8000-0000000000c6", "2023-08-01"),
      term("-", "Q3", "2023-07-01", "2023-09-30", "110000000000", "4f000000-0000-4000-8000-0000000000c7", "2023-11-01"),
    ],
  };
  await recordFactPrecisionAttestation(db, { fact_id: Q4_FACT, precision_class: "derived_from_source_tokens", derivation, source_locator: "locator:Q4", validation_method: "fixture" });
  await recordFactFinancialContext(db, {
    fact_id: Q4_FACT,
    context_version: "context.v1",
    period_type: "duration",
    dimension_scope: "consolidated",
    dimension_members: [],
    reporting_basis: "as_reported",
    adjustment_basis: "unadjusted",
    share_basis: "not_applicable",
    fiscal_calendar_version: "fiscal-calendar.v1",
    disclosure_relation: "original",
    source_context_ref: "locator:Q4",
  });
  return derivation;
}

function fourthQuarterPlan(): FinancialPlanV1 {
  const validated = validateFinancialPlan({
    ...revenuePlan(),
    plan_id: randomUUID(),
    operations: [{ node_id: "a_q4", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "Q4" } }],
    outputs: [{ output_id: "out_q4", node_id: "a_q4", unit_id: "q4_unit" }],
    publication_units: [{ unit_id: "q4_unit", kind: "chat_section" }],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("committed result inspection", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for inspection coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-inspect");
  const [client] = await pinnedClients(t, db, 1) as [SnapshotTransactionClient];
  const { runId, results } = await completedRun(db, client);
  const inspect = (outputId: string, owner: string = IDS.owner) => inspectCommittedResult(db, owner, results[outputId]!);

  await t.test("a derived result carries its formula, definitions, inputs, time, coverage, and publication", async () => {
    const margin = available(await inspect("out_gm"));
    assert.equal(margin.run_id, runId);
    assert.equal(margin.disposition, "verified");
    assert.deepEqual(margin.formula, { operation: "gross_margin", operation_version: "gross_margin.v1", numeric_policy_version: margin.formula!.numeric_policy_version });
    assert.deepEqual(margin.definitions.map((definition) => definition.metric_key).sort(), ["gross_profit", "revenue"]);
    assert.deepEqual(margin.inputs.map((input) => [input.input_slot, input.status, "fact_id" in input ? input.fact_id : null]), [
      ["a_gp", "bound", IDS.grossProfit2023],
      ["a_rev", "bound", IDS.original],
    ]);
    const revenue = margin.inputs.find((input) => input.input_slot === "a_rev")!;
    assert.ok("fact_id" in revenue);
    assert.equal(revenue.source.source_id, IDS.sourceV1);
    assert.equal(revenue.period.fiscal_year, 2023);
    assert.equal(revenue.derivation, null);
    assert.match(revenue.publication.available_no_later_than, /^2024-/u);
    assert.equal(margin.time.time_mode, "public_information");
    assert.equal(margin.coverage_state, "partial", "the unit's FY2022 margin is a gap");
    const unit = (await db.query(`select snapshot_id::text, certificate_digest from financial_run_units where run_id = $1 and unit_id = 'margin_unit'`, [runId])).rows[0];
    assert.deepEqual(margin.publication, { snapshot_id: unit.snapshot_id, certificate_digest: unit.certificate_digest });

    const reported = available(await inspect("out_rev"));
    assert.equal(reported.formula, null, "a reported value has no formula");
    assert.deepEqual(reported.definitions, [{ metric_key: "revenue", definition_version: "revenue.v1" }]);
  });

  await t.test("a gap shows the missing input and its reason", async () => {
    const blocked = available(await inspect("out_gm22"));
    assert.equal(blocked.disposition, "blocked_dependency");
    assert.deepEqual(blocked.inputs.find((input) => input.input_slot === "a_gp22"), { input_slot: "a_gp22", status: "gap", reason_code: "missing_input" });
  });

  await t.test("another owner, an unknown id, and an uncommitted result are all not found", async () => {
    assert.equal(await inspect("out_gm", IDS.other), null);
    assert.equal(await inspectCommittedResult(db, IDS.owner, randomUUID()), null);
    const draft = await readyRun(db, marginPlan());
    const draftResult = (await db.query(`select result_id::text from financial_results where run_id = $1 and output_id = 'out_gm'`, [draft.runId])).rows[0].result_id;
    assert.equal(await inspectCommittedResult(db, IDS.owner, draftResult), null);
  });

  await t.test("one revoked input anywhere in the transitive closure hides the result", async () => {
    const fact = [IDS.grossProfit2023];
    await whileChanged(db, { sql: `update facts set invalidated_at = now() where fact_id = $1`, params: fact }, { sql: `update facts set invalidated_at = null where fact_id = $1`, params: fact }, async () => {
      assert.equal(await inspect("out_gm"), null, "a direct input");
      assert.equal(await inspect("out_check"), null, "an input two operations away");
      assert.ok(available(await inspect("out_rev")), "a result outside that closure is unaffected");
    });
    const revoke = { sql: `update sources set user_id = $2 where source_id = $1`, params: [IDS.sourceV1, IDS.other] };
    await whileChanged(db, revoke, { sql: `update sources set user_id = null where source_id = $1`, params: [IDS.sourceV1] }, async () => {
      assert.equal(await inspect("out_rev"), null, "a source the owner can no longer read");
    });
    assert.ok(available(await inspect("out_gm")), "access returns with the evidence");
  });

  await t.test("an unsupported certificate version is unavailable, never reinterpreted", async () => {
    const change = `update snapshot_financial_runs set certificate = jsonb_set(certificate, '{verifier_version}', '"snapshot-financial-verifier.v0"') where run_id = $1`;
    const restore = `update snapshot_financial_runs set certificate = jsonb_set(certificate, '{verifier_version}', '"snapshot-financial-verifier.v1"') where run_id = $1`;
    await whileChanged(db, { sql: change, params: [runId] }, { sql: restore, params: [runId] }, async () => {
      const inspection = await inspect("out_gm");
      assert.deepEqual(inspection, { schema_version: "financial_result_inspection.v1", availability: "unsupported_version", result_id: results.out_gm, run_id: runId, reason_code: "unsupported_version" });
    });
  });

  await t.test("a result certified before presentation v2 is still inspectable", async () => {
    const certifiedAs = (version: string) => ({ sql: `update snapshot_financial_runs set certificate = jsonb_set(certificate, '{presentation,version}', to_jsonb($2::text)) where run_id = $1`, params: [runId, version] });
    await whileChanged(db, certifiedAs("financial-presentation.v1"), certifiedAs("financial-presentation.v2"), async () => {
      assert.equal(available(await inspect("out_gm")).result_id, results.out_gm);
    });
  });

  await t.test("inspection only reads", async () => {
    const statements: string[] = [];
    const recording: SqlExecutor = { query: (text, values) => { statements.push(text); return db.query(text, values as unknown[]) as never; } };
    available(await inspectCommittedResult(recording, IDS.owner, results.out_gm!));
    assert.ok(statements.length > 0);
    for (const statement of statements) assert.match(statement.trimStart(), /^select\b/iu);
  });

  await t.test("a derived quarter binds with its derivation, passes the seal, and is inspected with each term's filing (#481)", async () => {
    const derivation = await seedDerivedQuarter(db);
    const quarter = await completedRun(db, client, fourthQuarterPlan());
    const inspected = available(await inspectCommittedResult(db, IDS.owner, quarter.results.out_q4!));
    assert.equal(inspected.disposition, "verified");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const file of ["finance_research_block_schema.json", "financial_plan_schema.json", "financial_result_schema.json", "financial_answer_http_schema.json"]) {
      ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../spec/${file}`, import.meta.url), "utf8")));
    }
    const valid = ajv.getSchema("https://example.com/schemas/financial_answer_http_schema.json#/$defs/FinancialResultInspection")!;
    assert.ok(valid(inspected), JSON.stringify(valid.errors));
    const [input] = inspected.inputs;
    assert.ok(input && "fact_id" in input);
    assert.equal(valid({ ...inspected, inputs: [{ ...input, derivation: null }] }), false, "a derived status shows its derivation");
    assert.equal(valid({ ...inspected, inputs: [{ ...input, precision_status: "source_token_preserved" }] }), false, "only a derived status shows a derivation");
    assert.deepEqual([input.fact_id, input.value, input.precision_status, input.source.locator, input.derivation],
      [Q4_FACT, "100000000000", "derived_from_source_tokens", "locator:Q4", derivation]);
  });
});
