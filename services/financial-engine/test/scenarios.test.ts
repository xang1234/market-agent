// P/E scenarios end to end (#201): a server-built v2 plan binds only its EPS,
// computes bear, base, and bull, seals one unit under a v3 presentation, and
// inspects each scenario with the assumption it read. An assumption is never a
// run input or a cited fact, and a tampered assumption hash fails the seal.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import Ajv2020 from "../../financial-core/node_modules/ajv/dist/2020.js";
import { assumptionHash, type FinancialPlan, type FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { finalizeUnit } from "../src/finalize.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { buildDeterministicPlan } from "../src/planner.ts";
import { authorityFor, engineDatabase, IDS as FIXTURE_IDS, NVDA, pinnedClients, readyRun, seedValuedIssuer } from "./db-fixtures.ts";

/** A company whose FY2024 10-K filed diluted EPS of 40.00 before a 10-for-1 split: 4 per share today. */
const SUBJECT = {
  issuer: "4f000000-0000-4000-8000-0000000006a1",
  listing: "4f000000-0000-4000-8000-0000000006e1",
  tenK: "4f000000-0000-4000-8000-0000000006c1",
  tenQ: "4f000000-0000-4000-8000-0000000006c2",
  ticker: "SCEN",
  name: "Scenario Holdings Inc.",
  close: "500.00",
  eps: "40.00",
  shares: "1000000000",
} as const;

const ATTRIBUTION = { kind: "user_request", ref: "chat:turn:scenario", captured_at: "2024-06-10T13:55:00.000Z" } as const;

function scenarioPlan(authority: FinancialRuntimeAuthority): FinancialPlan {
  const scenario = (name: string) => ({ node_id: name, operation: "scenario_eps_multiple", earnings: "eps", assumption_id: `pe_${name}` });
  const planned = buildDeterministicPlan({
    plan_id: randomUUID(),
    origin: { kind: "chat_request", ref: ATTRIBUTION.ref },
    knowledge_cutoff: NVDA.cutoff,
    cutoff_timezone: "America/New_York",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: [{ mention: SUBJECT.ticker, resolution: { status: "resolved", subject_ref: { kind: "issuer", id: SUBJECT.issuer }, label: SUBJECT.name } }],
    publication_unit_kind: "chat_section",
  }, {
    subjects: [{ slot_id: "a", mention: SUBJECT.ticker }],
    operations: [
      { node_id: "eps", operation: "reported_metric", subject_slot: "a", metric_key: "eps_diluted", period: { kind: "latest", period_type: "annual", offset: 0 } },
      scenario("bear"), scenario("base"), scenario("bull"),
    ],
    outputs: ["bear", "base", "bull"].map((node) => ({ output_id: `out_${node}`, node_id: node })),
    thresholds: [],
    assumptions: [["bear", "20"], ["base", "25"], ["bull", "30"]].map(([name, value]) => ({ assumption_id: `pe_${name}`, scenario: name, value, attribution: ATTRIBUTION })),
  });
  assert.ok(planned.outcome === "ready", JSON.stringify(planned));
  return planned.plan;
}

async function results(db: Client, runId: string): Promise<Record<string, [string, string | undefined]>> {
  const rows = (await db.query<{ output_id: string; disposition: string; payload: { value?: string; reason_code?: string } }>(
    `select output_id, disposition, payload from financial_results where run_id = $1 order by output_id`,
    [runId],
  )).rows;
  return Object.fromEntries(rows.map((row) => [row.output_id, [row.disposition, row.payload.value ?? row.payload.reason_code]]));
}

function inspectionSchema() {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  for (const file of ["finance_research_block_schema.json", "financial_plan_schema.json", "financial_result_schema.json", "financial_answer_http_schema.json"]) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../spec/${file}`, import.meta.url), "utf8")));
  }
  return ajv.getSchema("https://example.com/schemas/financial_answer_http_schema.json#/$defs/FinancialResultInspection")!;
}

test("P/E scenarios", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for scenario coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-scenarios");
  await seedValuedIssuer(db, SUBJECT);
  await db.query(`insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id) values ($1, '2024-06-10', 1, 10, $2)`, [SUBJECT.listing, POLYGON_MARKET_SOURCE_ID]);
  const authority = authorityFor();

  await t.test("EPS of 4 at 20x, 25x, and 30x seals as 80, 100, and 120 per share in one unit", async () => {
    const plan = scenarioPlan(authority);
    const { runId, lease } = await readyRun(db, plan, authority);
    assert.deepEqual(await results(db, runId), {
      eps_input: ["computed", "4"],
      out_base: ["computed", "100"],
      out_bear: ["computed", "80"],
      out_bull: ["computed", "120"],
    });
    const inputs = (await db.query<{ input_slot: string; binding_status: string }>(`select input_slot, binding_status from financial_run_inputs where run_id = $1 order by input_slot`, [runId])).rows;
    assert.deepEqual(inputs.map((row) => [row.input_slot, row.binding_status]), [["eps", "bound"]], "an assumption is never a run input");

    const [client] = await pinnedClients(t, db, 1);
    const snapshotId = randomUUID();
    const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "answer", snapshot_id: snapshotId, persistParent: async () => {} });
    assert.ok(sealed.status === "published", JSON.stringify(sealed));
    const content = sealed.publication.block.financial;
    assert.equal(content.presentation_version, "financial-presentation.v3");
    assert.deepEqual(content.presentations.map((presentation) => presentation.kind), ["scenarios"]);

    const epsFact = (await db.query<{ fact_id: string }>(`select fact_id::text from financial_run_inputs where run_id = $1`, [runId])).rows[0]!.fact_id;
    const snapshot = (await db.query<{ fact_refs: string[] }>(`select fact_refs from snapshots where snapshot_id = $1`, [snapshotId])).rows[0]!;
    assert.deepEqual(snapshot.fact_refs, [epsFact], "the seal cites the EPS fact and nothing for an assumption");

    const valid = inspectionSchema();
    const resultOf = async (outputId: string) =>
      (await db.query<{ result_id: string }>(`select result_id::text from financial_results where run_id = $1 and output_id = $2`, [runId, outputId])).rows[0]!.result_id;
    const base = await inspectCommittedResult(db, FIXTURE_IDS.owner, await resultOf("out_base"));
    assert.ok(valid(base), JSON.stringify(valid.errors));
    assert.ok(base?.availability === "available" && base.schema_version === "financial_result_inspection.v2");
    const assumption = plan.assumptions![1];
    assert.deepEqual(base.assumptions, [{ ...assumption, assumption_hash: assumptionHash(assumption) }]);
    assert.deepEqual(base.inputs.map((input) => input.status === "bound" && [input.input_slot, input.value, input.split_adjustment?.adjusted_native_value]), [
      ["eps", "40", { numerator: "4", denominator: "1" }],
    ]);
    const eps = await inspectCommittedResult(db, FIXTURE_IDS.owner, await resultOf("eps_input"));
    assert.ok(valid(eps), JSON.stringify(valid.errors));
    assert.equal(eps?.schema_version, "financial_result_inspection.v1");
  });

  await t.test("an assumption hash tampered in a computation's input_refs fails the seal", async () => {
    const { runId, lease } = await readyRun(db, scenarioPlan(authority), authority);
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    const tampered = await db.query(
      `update computations set input_refs = jsonb_set(input_refs, '{1,hash}', to_jsonb(repeat('0', 64))) where financial_run_id = $1 and node_id = 'base'`,
      [runId],
    );
    await db.query("commit");
    assert.equal(tampered.rowCount, 1);
    const [client] = await pinnedClients(t, db, 1);
    const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "answer", snapshot_id: randomUUID(), persistParent: async () => {} });
    assert.ok(sealed.status === "rejected", JSON.stringify(sealed));
    assert.deepEqual([sealed.reason_code, sealed.failures.map((failure) => [failure.reason_code, failure.details.field])], [
      "verification_failed", [["financial_lineage_mismatch", "input_refs"]],
    ]);
  });
});

test("the v2 inspection schema is the v1 one plus assumptions", () => {
  const http = JSON.parse(readFileSync(new URL("../../../spec/financial_answer_http_schema.json", import.meta.url), "utf8"));
  const [v1, v2] = http.$defs.FinancialResultInspection.oneOf;
  const { assumptions, schema_version: v2Version, ...v2Properties } = v2.properties;
  const { schema_version: v1Version, ...v1Properties } = v1.properties;
  assert.deepEqual([v1Version.const, v2Version.const], ["financial_result_inspection.v1", "financial_result_inspection.v2"]);
  assert.deepEqual(v2Properties, v1Properties);
  assert.deepEqual(v2.required, [...v1.required, "assumptions"]);
  assert.deepEqual(assumptions.items.required, ["assumption_id", "scenario", "value", "attribution", "assumption_hash"]);
});
