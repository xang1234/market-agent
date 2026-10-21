// Market cap and P/E end to end (#444): NVDA's Friday close, its 10-Q cover
// count, and its FY2024 diluted EPS bind restated after its 2024-06-10 split,
// the deterministic plan's unit seals and inspects, and an authority without
// market data gets a named gap instead of a price.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import Ajv2020 from "../../financial-core/node_modules/ajv/dist/2020.js";
import type { FinancialPlanV1, FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { executeRun } from "../src/execute.ts";
import { finalizeUnit } from "../src/finalize.ts";
import { acquireLease } from "../src/lease.ts";
import { reserveRun } from "../src/run-repo.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { buildDeterministicPlan } from "../src/planner.ts";
import { authorityFor, engineDatabase, IDS as FIXTURE_IDS, NVDA, pinnedClients, readyRun, seedNvda } from "./db-fixtures.ts";

/** The deterministic plan a surface builds for NVDA's market cap and P/E, publishing their inputs beside them. */
function valuationPlan(authority: FinancialRuntimeAuthority): FinancialPlanV1 {
  const reported = (node_id: string, metric_key: string, period: Record<string, unknown>) => ({ node_id, operation: "reported_metric", subject_slot: "a", metric_key, period });
  const planned = buildDeterministicPlan({
    plan_id: randomUUID(),
    origin: { kind: "chat_request", ref: "chat:turn:valuation" },
    knowledge_cutoff: NVDA.cutoff,
    cutoff_timezone: "America/New_York",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: [{ mention: "NVDA", resolution: { status: "resolved", subject_ref: { kind: "issuer", id: NVDA.issuer }, label: "NVIDIA Corporation" } }],
    publication_unit_kind: "chat_section",
  }, {
    subjects: [{ slot_id: "a", mention: "NVDA" }],
    operations: [
      reported("px", "share_price", { kind: "at_cutoff" }),
      reported("shares", "shares_outstanding", { kind: "latest", period_type: "quarterly", offset: 0 }),
      reported("eps", "eps_diluted", { kind: "latest", period_type: "annual", offset: 0 }),
      { node_id: "cap", operation: "market_cap", price: "px", shares: "shares" },
      { node_id: "pe", operation: "pe_ratio", price: "px", earnings: "eps" },
    ],
    outputs: ["px", "shares", "eps", "cap", "pe"].map((node) => ({ output_id: `out_${node}`, node_id: node })),
    thresholds: [],
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

test("market cap and P/E", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for valuation coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-valuation");
  await seedNvda(db);

  await t.test("with market data allowed, NVDA's market cap is 2,956,800,000,000 and its P/E 120 / 1.193, and the unit seals", async () => {
    const authority = authorityFor(FIXTURE_IDS.owner, { allowed_source_classes: ["sec_filing", "market_data"] });
    const { runId, lease } = await readyRun(db, valuationPlan(authority), authority);
    assert.deepEqual(await results(db, runId), {
      out_cap: ["computed", "2956800000000"],
      out_eps: ["computed", "1.193"],
      out_pe: ["computed", "100.58675607711651299245599329421626152556580050293"],
      out_px: ["computed", "120"],
      out_shares: ["computed", "24640000000"],
    });
    const [client] = await pinnedClients(t, db, 1);
    const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "answer", snapshot_id: randomUUID(), persistParent: async () => {} });
    assert.equal(sealed.status, "published", JSON.stringify(sealed));

    const resultId = (await db.query(`select result_id::text from financial_results where run_id = $1 and output_id = 'out_pe'`, [runId])).rows[0]!.result_id;
    const inspection = await inspectCommittedResult(db, FIXTURE_IDS.owner, resultId);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const file of ["finance_research_block_schema.json", "financial_plan_schema.json", "financial_result_schema.json", "financial_answer_http_schema.json"]) {
      ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../spec/${file}`, import.meta.url), "utf8")));
    }
    const valid = ajv.getSchema("https://example.com/schemas/financial_answer_http_schema.json#/$defs/FinancialResultInspection")!;
    assert.ok(valid(inspection), JSON.stringify(valid.errors));
    assert.ok(inspection?.availability === "available");
    assert.deepEqual([inspection.disposition, inspection.formula], ["verified", { operation: "pe_ratio", operation_version: "pe_ratio.v1", numeric_policy_version: "numeric-policy.v1" }]);
    assert.deepEqual(inspection.inputs.map((input) => input.status === "bound" && [input.input_slot, input.value, input.split_adjustment?.adjusted_native_value]), [
      ["eps", "11.93", { numerator: "1193", denominator: "1000" }],
      ["px", "1200", { numerator: "120", denominator: "1" }],
    ]);
  });

  await t.test("a run binds under the grant it recorded: a retry granting more resumes it as reserved, one granting less is a conflict", async () => {
    const filingsOnly = authorityFor();
    const withPrices = authorityFor(FIXTURE_IDS.owner, { allowed_source_classes: ["sec_filing", "market_data"] });
    const plan = valuationPlan(filingsOnly);
    const key = randomUUID();
    const first = await reserveRun(db, { authority: filingsOnly, request_key: key, plan });
    const retry = await reserveRun(db, { authority: withPrices, request_key: key, plan });
    assert.deepEqual([first.status, retry.status, retry.status === "existing" && retry.run.allowed_source_classes], ["created", "existing", ["sec_filing"]]);
    const runId = (retry as { run: { run_id: string } }).run.run_id;
    const acquired = await acquireLease(db, { authority: withPrices, run_id: runId, worker_id: "retry", ttl_ms: 60_000 });
    assert.ok(acquired.status === "acquired");
    await executeRun({ client: db, lease: acquired.lease, plan, authority: withPrices, evidence: createEvidenceFinancialPort, parent_limits: {} });
    assert.deepEqual((await results(db, runId)).out_px, ["unsupported", "source_class_not_allowed"]);

    const pricedKey = randomUUID();
    const pricedPlan = valuationPlan(withPrices);
    const priced = await reserveRun(db, { authority: withPrices, request_key: pricedKey, plan: pricedPlan });
    assert.ok(priced.status === "created");
    assert.deepEqual(priced.run.allowed_source_classes, ["market_data", "sec_filing"]);
    const narrower = await reserveRun(db, { authority: filingsOnly, request_key: pricedKey, plan: pricedPlan });
    assert.deepEqual(narrower, { status: "conflict", reason: "source_classes_not_granted", run_id: priced.run.run_id });
  });

  await t.test("without market data, the price is a named gap and both figures are blocked, never computed from another price", async () => {
    const authority = authorityFor();
    const { runId } = await readyRun(db, valuationPlan(authority), authority);
    assert.deepEqual(await results(db, runId), {
      out_cap: ["blocked_dependency", "blocked_by_dependency"],
      out_eps: ["computed", "1.193"],
      out_pe: ["blocked_dependency", "blocked_by_dependency"],
      out_px: ["unsupported", "source_class_not_allowed"],
      out_shares: ["computed", "24640000000"],
    });
  });
});
