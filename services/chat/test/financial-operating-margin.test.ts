// One certified operating-margin answer end to end (#200): facts written only
// by SEC ingestion, planned from a chat turn, bound on public-time evidence,
// computed, and sealed by the independent verifier.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { chatDatabase, chatHarness, completed, SEC_ISSUER } from "./financial-fixtures.ts";

const ANNUAL = "0000320190-24-000010";
const QUARTERLY = "0000320190-23-000077";
const FETCHED_AT = "2024-02-01T15:05:00.000Z";

function companyFacts() {
  const annual = (val: string) => ({ start: "2023-01-01", end: "2023-12-31", val: Number(val), val_token: val, accn: ANNUAL, fy: 2023, fp: "FY", form: "10-K", filed: "2024-01-10" });
  const q2 = (val: string) => ({ start: "2023-04-01", end: "2023-06-30", val: Number(val), val_token: val, accn: QUARTERLY, fy: 2023, fp: "Q2", form: "10-Q", filed: "2023-08-01" });
  return {
    cik: 320190,
    entityName: "Operating Example Corp",
    facts: {
      "us-gaap": {
        Revenues: { label: "", description: "", units: { USD: [annual("100000000000"), q2("40000000000")] } },
        OperatingIncomeLoss: { label: "", description: "", units: { USD: [annual("25000000000"), q2("-2000000000")] } },
      },
    },
  };
}

/** A planning model that drafts OPM's operating margin for one fiscal period. */
function operatingMarginModel(fiscalPeriod: "FY" | "Q2", fiscalYear = 2023): PlanningModel {
  const period = { kind: "fiscal_period", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod };
  return (async () => ({
    model: "stub-model",
    text: JSON.stringify({
      outcome: "ready",
      subjects: [{ slot_id: "a", mention: "OPM" }],
      operations: [
        { node_id: "oi", operation: "reported_metric", subject_slot: "a", metric_key: "operating_income", period },
        { node_id: "rev", operation: "reported_metric", subject_slot: "a", metric_key: "revenue", period },
        { node_id: "om", operation: "operating_margin", numerator: "oi", revenue: "rev" },
      ],
      outputs: [{ output_id: "out_om", node_id: "om" }],
      thresholds: [],
    }),
  })) as unknown as PlanningModel;
}

test("a certified operating margin from SEC-ingested facts", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-op-margin");
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Operating Example Corp', '320190')`, [SEC_ISSUER]);
  await db.query(
    `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ($1, 'operating_income', 'Operating income', 'currency', 'sum', 'higher_is_better', 'gaap')`,
    [randomUUID()],
  );
  const statements = createSecBackedStatementRepository(pool, {
    fetcher: secCompanyFetcher(companyFacts, { completed_at: FETCHED_AT }),
    sourceId: randomUUID(),
    logger: { warn: () => {} },
  });
  for (const fiscal_period of ["FY", "Q2"] as const) {
    assert.ok(await statements.find({ issuer_id: SEC_ISSUER, family: "income", basis: "as_reported", fiscal_year: 2023, fiscal_period }));
  }
  const ask = (fiscalPeriod: "FY" | "Q2", options: { fiscalYear?: number } = {}) =>
    chatHarness(pool, { model: operatingMarginModel(fiscalPeriod, options.fiscalYear) })
      .run({ threadId, userId: IDS.owner, userIntent: `What was OPM's operating margin for ${fiscalPeriod} ${options.fiscalYear ?? 2023}?` });
  const certified = async (messageId: unknown) => {
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    const message = read!.messages.find((candidate) => candidate.message_id === messageId)!;
    const block = (message.blocks as Array<{ id: string; kind: string; financial: any }>)[0]!;
    assert.equal(block.kind, "financial_answer");
    return { proof: message.block_proofs[block.id], results: block.financial.results.map((result: any) => [result.disposition, result.presented?.text ?? null]) };
  };
  const latestBindings = async () => (await db.query(
    `select i.input_slot, i.gap_reason, f.fiscal_period, s.provider
       from financial_run_inputs i
       join financial_runs r on r.run_id = i.run_id
       left join facts f on f.fact_id = i.fact_id
       left join sources s on s.source_id = f.source_id
      where r.parent_id = $1 and r.created_at = (select max(created_at) from financial_runs where parent_id = $1)
      order by i.input_slot`,
    [threadId],
  )).rows;
  const VERIFIED = { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" };

  await t.test("the annual margin binds the 10-K's operating income and revenue and seals 25%", async () => {
    const done = completed((await ask("FY")).events);
    assert.deepEqual(await certified(done.message_id), { proof: VERIFIED, results: [["verified", "25.00%"]] });
    assert.deepEqual(await latestBindings(), [
      { input_slot: "oi", gap_reason: null, fiscal_period: "FY", provider: "sec_edgar" },
      { input_slot: "rev", gap_reason: null, fiscal_period: "FY", provider: "sec_edgar" },
    ]);
  });

  await t.test("a quarterly margin binds the 10-Q's facts; an operating loss is a negative margin", async () => {
    const done = completed((await ask("Q2")).events);
    assert.deepEqual(await certified(done.message_id), { proof: VERIFIED, results: [["verified", "-5.00%"]] });
    assert.deepEqual(await latestBindings(), [
      { input_slot: "oi", gap_reason: null, fiscal_period: "Q2", provider: "sec_edgar" },
      { input_slot: "rev", gap_reason: null, fiscal_period: "Q2", provider: "sec_edgar" },
    ]);
  });

  await t.test("a period with no filed facts is a named gap, not a number", async () => {
    const done = completed((await ask("FY", { fiscalYear: 2022 })).events);
    assert.deepEqual(await certified(done.message_id), { proof: VERIFIED, results: [["blocked_dependency", "A required input or calculation is unavailable."]] });
    assert.deepEqual(await latestBindings(), [
      { input_slot: "oi", gap_reason: "missing_input", fiscal_period: null, provider: null },
      { input_slot: "rev", gap_reason: "missing_input", fiscal_period: null, provider: null },
    ]);
  });
});
