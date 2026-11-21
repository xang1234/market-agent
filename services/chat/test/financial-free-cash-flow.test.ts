// Certified annual free cash flow end to end (#211): reported operating cash
// flow less PP&E cash capex, from facts SEC ingestion wrote, planned from a chat
// turn and sealed by the independent verifier. Capex v1 is
// PaymentsToAcquirePropertyPlantAndEquipment, or PaymentsToAcquireProductiveAssets
// for a filer that tags that instead, bound with its scope (#731). OCF is only the
// total NetCashProvidedByUsedInOperatingActivities; a filer tagging only the
// continuing-operations OCF gets a named gap, never a substitute.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { chatDatabase, chatHarness, completed, SEC_ISSUER, SEC_ISSUER_B, SEC_ISSUER_C, SEC_ISSUER_E } from "./financial-fixtures.ts";

const FETCHED_AT = "2024-02-01T15:05:00.000Z";

function companyFacts(cik: number, accession: string, capexConcept: string, ocfConcept: string) {
  const annual = (val: string) => ({ start: "2023-01-01", end: "2023-12-31", val: Number(val), val_token: val, accn: accession, fy: 2023, fp: "FY", form: "10-K", filed: "2024-01-10" });
  const q2YearToDate = (val: string) => ({ start: "2023-01-01", end: "2023-06-30", val: Number(val), val_token: val, accn: `${accession.slice(0, -1)}9`, fy: 2023, fp: "Q2", form: "10-Q", filed: "2023-08-01" });
  return {
    cik,
    entityName: "Example",
    facts: {
      "us-gaap": {
        Revenues: { label: "", description: "", units: { USD: [annual("500000000000")] } },
        [ocfConcept]: { label: "", description: "", units: { USD: [annual("120000000000"), q2YearToDate("50000000000")] } },
        [capexConcept]: { label: "", description: "", units: { USD: [annual("30000000000"), q2YearToDate("12000000000")] } },
      },
    },
  };
}

// A filer whose FY2022 10-K tags capex as productive assets and whose FY2023
// 10-K tags PP&E, stating no FY2022 comparative.
function switchedCapexFacts(cik: number) {
  const annual = (fy: number, val: string) => ({
    start: `${fy}-01-01`, end: `${fy}-12-31`, val: Number(val), val_token: val, accn: `0000${cik}-${fy + 1 - 2000}-000010`, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-01-10`,
  });
  return {
    cik,
    entityName: "Switched",
    facts: {
      "us-gaap": {
        Revenues: { label: "", description: "", units: { USD: [annual(2022, "400"), annual(2023, "500")] } },
        PaymentsToAcquireProductiveAssets: { label: "", description: "", units: { USD: [annual(2022, "125")] } },
        PaymentsToAcquirePropertyPlantAndEquipment: { label: "", description: "", units: { USD: [annual(2023, "100")] } },
      },
    },
  };
}

/** A planning model that drafts one company's FY2023 capex growth over FY2022. */
function capexGrowthModel(mention: string): PlanningModel {
  const year = (fiscal_year: number) => ({ kind: "fiscal_period", fiscal_year, fiscal_period: "FY" });
  return (async () => ({
    model: "stub-model",
    text: JSON.stringify({
      outcome: "ready",
      subjects: [{ slot_id: "a", mention }],
      operations: [
        { node_id: "cur", operation: "reported_metric", subject_slot: "a", metric_key: "capex", period: year(2023) },
        { node_id: "pri", operation: "reported_metric", subject_slot: "a", metric_key: "capex", period: year(2022) },
        { node_id: "growth", operation: "percent_change_positive_base", current: "cur", prior: "pri" },
      ],
      outputs: [{ output_id: "out_growth", node_id: "growth" }],
      thresholds: [],
    }),
  })) as unknown as PlanningModel;
}

/** A planning model that drafts free cash flow for one company and period, publishing only the result. */
function freeCashFlowModel(mention: string, fiscalYear = 2023): PlanningModel {
  const period = { kind: "fiscal_period", fiscal_year: fiscalYear, fiscal_period: "FY" };
  return (async () => ({
    model: "stub-model",
    text: JSON.stringify({
      outcome: "ready",
      subjects: [{ slot_id: "a", mention }],
      operations: [
        { node_id: "ocf", operation: "reported_metric", subject_slot: "a", metric_key: "operating_cash_flow", period },
        { node_id: "capex", operation: "reported_metric", subject_slot: "a", metric_key: "capex", period },
        { node_id: "fcf", operation: "free_cash_flow", operating_cash_flow: "ocf", capex: "capex" },
      ],
      outputs: [{ output_id: "out_fcf", node_id: "fcf" }],
      thresholds: [],
    }),
  })) as unknown as PlanningModel;
}

test("certified annual free cash flow from SEC-ingested facts", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-fcf");
  for (const [metricKey, name] of [["operating_cash_flow", "Operating cash flow"], ["capex", "Capital expenditures"]]) {
    await db.query(
      `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
       values ($1, $2, $3, 'currency', 'sum', 'neutral', 'gaap')`,
      [randomUUID(), metricKey, name],
    );
  }
  const ingest = async (issuerId: string, cik: number, accession: string, capexConcept: string, ocfConcept = "NetCashProvidedByUsedInOperatingActivities") => {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Example', $2)`, [issuerId, String(cik)]);
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(() => companyFacts(cik, accession, capexConcept, ocfConcept), { completed_at: FETCHED_AT }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    assert.ok(await statements.find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2023, fiscal_period: "FY" }));
  };
  await ingest(SEC_ISSUER, 320190, "0000320190-24-000010", "PaymentsToAcquirePropertyPlantAndEquipment");
  await ingest(SEC_ISSUER_B, 320191, "0000320191-24-000010", "PaymentsToAcquireProductiveAssets");
  await ingest(SEC_ISSUER_C, 320192, "0000320192-24-000010", "PaymentsToAcquirePropertyPlantAndEquipment", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations");

  const ask = async (mention: string, fiscalYear = 2023) => {
    const done = completed((await chatHarness(pool, { model: freeCashFlowModel(mention, fiscalYear) })
      .run({ threadId, userId: IDS.owner, userIntent: `What was ${mention}'s free cash flow for FY${fiscalYear}?` })).events);
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    const message = read!.messages.find((candidate) => candidate.message_id === done.message_id)!;
    const block = (message.blocks as Array<{ id: string; kind: string; source_refs: string[]; financial: any }>)[0]!;
    assert.equal(block.kind, "financial_answer");
    const { results, labels } = block.financial;
    return {
      proof: message.block_proofs[block.id],
      rows: results.map((result: any) => [labels[result.measure_label_id].text, result.disposition, result.presented?.full_text ?? null]),
      sources: block.source_refs.length,
    };
  };
  const bindings = async () => (await db.query(
    `select i.input_slot, i.gap_reason
       from financial_run_inputs i join financial_runs r on r.run_id = i.run_id
      where r.parent_id = $1 and r.created_at = (select max(created_at) from financial_runs where parent_id = $1)
      order by i.input_slot`,
    [threadId],
  )).rows;

  await t.test("OCF 120bn less PP&E capex 30bn seals 90bn under its exact label, with both inputs cited", async () => {
    assert.deepEqual(await ask("OPM"), {
      proof: { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" },
      rows: [
        ["Operating cash flow", "verified", "USD 120000000000"],
        ["Capital expenditures (PP&E cash payments)", "verified", "USD 30000000000"],
        ["Free cash flow (OCF less PP&E cash capex)", "verified", "USD 90000000000"],
      ],
      sources: 1,
    });
  });

  await t.test("capex tagged only as productive-asset payments certifies, bound with that concept as its scope, under labels of its own (#731)", async () => {
    assert.deepEqual((await ask("PAX")).rows, [
      ["Operating cash flow", "verified", "USD 120000000000"],
      ["Capital expenditures (productive-asset cash payments, may include intangibles)", "verified", "USD 30000000000"],
      ["Free cash flow (OCF less productive-asset capex)", "verified", "USD 90000000000"],
    ]);
    assert.deepEqual(await bindings(), [{ input_slot: "capex", gap_reason: null }, { input_slot: "ocf", gap_reason: null }]);
    const bound = (await db.query(
      `select i.bound_payload -> 'inference' as inference
         from financial_run_inputs i join financial_runs r on r.run_id = i.run_id
        where r.parent_id = $1 and i.input_slot = 'capex' order by r.created_at desc limit 1`,
      [threadId],
    )).rows;
    assert.deepEqual(bound, [{ inference: { kind: "productive_assets_capex", concept: "PaymentsToAcquireProductiveAssets" } }]);
  });

  await t.test("OCF tagged only for continuing operations is a named gap, and free cash flow is not computed (#335)", async () => {
    assert.deepEqual((await ask("COX")).rows, [
      ["Operating cash flow", "missing", null],
      ["Capital expenditures (PP&E cash payments)", "verified", "USD 30000000000"],
      ["Free cash flow (OCF less PP&E cash capex)", "blocked_dependency", null],
    ]);
    assert.deepEqual(await bindings(), [{ input_slot: "capex", gap_reason: null }, { input_slot: "ocf", gap_reason: "context_unverified" }]);
  });

  await t.test("capex growth across a switch from productive assets to PP&E is a named gap, never a change in spending (#731)", async () => {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Switched', '320194')`, [SEC_ISSUER_E]);
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(() => switchedCapexFacts(320194), { completed_at: FETCHED_AT }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    for (const fiscal_year of [2022, 2023]) assert.ok(await statements.find({ issuer_id: SEC_ISSUER_E, family: "income", basis: "as_reported", fiscal_year, fiscal_period: "FY" }));
    const done = completed((await chatHarness(pool, { model: capexGrowthModel("SWX") })
      .run({ threadId, userId: IDS.owner, userIntent: "How much did SWX's capex grow in FY2023?" })).events);
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    const block = (read!.messages.find((candidate) => candidate.message_id === done.message_id)!.blocks as Array<{ financial: any }>)[0]!;
    const { results, labels } = block.financial;
    assert.deepEqual(results.map((result: any) => [labels[result.measure_label_id].text, result.disposition, result.presented.text]), [[
      "Year-over-year percent change in Capital expenditures (PP&E cash payments)",
      "incompatible",
      "One figure's capex is filed as PaymentsToAcquireProductiveAssets, which may include purchased intangibles, and the other's as PP&E only, so they do not measure the same spending.",
    ]]);
    assert.deepEqual(await bindings(), [{ input_slot: "cur", gap_reason: null }, { input_slot: "pri", gap_reason: null }]);
  });

  await t.test("a year with no filing is a named gap, never narrative arithmetic", async () => {
    assert.deepEqual((await ask("OPM", 2022)).rows, [
      ["Operating cash flow", "missing", null],
      ["Capital expenditures (PP&E cash payments)", "missing", null],
      ["Free cash flow (OCF less PP&E cash capex)", "blocked_dependency", null],
    ]);
    assert.deepEqual(await bindings(), [{ input_slot: "capex", gap_reason: "missing_input" }, { input_slot: "ocf", gap_reason: "missing_input" }]);
  });
});
