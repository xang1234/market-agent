// What an answer says about a figure later filings moved (#513). A restated
// quarter says a later filing restated it. A derived fourth quarter was never
// stated, so its 10-K's line restates nothing: the filer only stated it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { chatDatabase, chatHarness, completed, METRIC_READING, readingOf, SEC_ISSUER, SEC_ISSUER_B } from "./financial-fixtures.ts";

const CIK = 320190;
const CIK_B = 320191;

function companyFacts(cik: number, fourthQuarterLine: boolean) {
  const accn = (serial: number) => `${String(cik).padStart(10, "0")}-25-${String(serial).padStart(6, "0")}`;
  const value = (serial: number, form: string, filed: string, fp: string, start: string, end: string, token: string) =>
    ({ start, end, val: Number(token), val_token: token, accn: accn(serial), fy: 2024, fp, form, filed });
  return {
    cik,
    entityName: "Operating Example Corp",
    facts: { "us-gaap": { Revenues: { label: "", description: "", units: { USD: [
      value(1, "10-Q", "2024-04-23", "Q1", "2024-01-01", "2024-03-31", "16053000000"),
      value(2, "10-Q", "2024-07-23", "Q2", "2024-04-01", "2024-06-30", "9094000000"),
      value(3, "10-Q", "2024-10-22", "Q3", "2024-07-01", "2024-09-30", "9842000000"),
      value(4, "10-K", "2025-02-03", "FY", "2024-01-01", "2024-12-31", "38702000000"),
      value(4, "10-K", "2025-02-03", "FY", "2024-01-01", "2024-03-31", "8955000000"),
      ...(fourthQuarterLine ? [value(4, "10-K", "2025-02-03", "FY", "2024-10-01", "2024-12-31", "10812000000")] : []),
    ] } } } },
  };
}

function quarterModel(mention: string, fiscalPeriod: "Q1" | "Q4"): PlanningModel {
  return (async () => ({
    model: "stub-model",
    text: JSON.stringify({
      outcome: "ready",
      subjects: [{ slot_id: "a", mention }],
      operations: [{ node_id: "rev", operation: "reported_metric", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2024, fiscal_period: fiscalPeriod } }],
      outputs: [{ output_id: "out", node_id: "rev" }],
      thresholds: [],
    }),
  })) as unknown as PlanningModel;
}

test("the note on a figure later filings moved", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool } = await chatDatabase(t, "chat-restated-note");
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Operating Example Corp', $2)`, [SEC_ISSUER, String(CIK)]);
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Productive Assets Corp', $2)`, [SEC_ISSUER_B, String(CIK_B)]);
  for (const [issuerId, cik, fourthQuarterLine] of [[SEC_ISSUER, CIK, true], [SEC_ISSUER_B, CIK_B, false]] as const) {
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(() => companyFacts(cik, fourthQuarterLine), { completed_at: "2025-03-01T15:05:00.000Z" }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    for (const fiscalPeriod of ["Q1", "Q2", "Q3", "Q4", "FY"] as const) {
      assert.ok(await statements.find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: fiscalPeriod }));
    }
  }
  const answer = async (fiscalPeriod: "Q1" | "Q4", mention = "OPM") => {
    const threadId = randomUUID();
    await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, IDS.owner]);
    const done = completed((await chatHarness(pool, {
      model: quarterModel(mention, fiscalPeriod),
      readQuestion: readingOf({ ...METRIC_READING, income_items: ["revenue"], period: { kind: "fiscal_quarter", fiscal_period: fiscalPeriod, fiscal_year: 2024 } }),
    }).run({ threadId, userId: IDS.owner, userIntent: `${mention}'s revenue in ${fiscalPeriod} FY2024` })).events);
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    return JSON.stringify(read!.messages.find((message) => message.message_id === done.message_id)!.blocks);
  };

  await t.test("a quarter a later filing changed says the filing restated it", async () => {
    const blocks = await answer("Q1");
    assert.ok(blocks.includes("8,955,000,000"), blocks);
    assert.ok(blocks.includes("Restated by a later filing, so not as first reported: OPM's revenue in Q1 FY2024 (ended 2024-03-31)."), blocks);
    assert.ok(!blocks.includes(SEC_ISSUER), "no raw subject id");
  });

  await t.test("a derived fourth quarter says it is the filing's own statement, not a restatement", async () => {
    const blocks = await answer("Q4");
    assert.ok(blocks.includes("10,812,000,000"), blocks);
    assert.ok(blocks.includes("Taken from the filing's own statement of the quarter: OPM's revenue in Q4 FY2024 (ended 2024-12-31)."), blocks);
    assert.ok(!blocks.includes("Restated by a later filing"), blocks);
  });

  await t.test("a derived quarter whose input a filing changed is a gap that says so, with no number and no talk of stock splits", async () => {
    const blocks = await answer("Q4", "PAX");
    assert.ok(blocks.includes("A later filing states a different figure, or changes one this is derived from, and the current figure could not be verified."), blocks);
    assert.ok(!blocks.includes("3,713,000,000"), "the stale figure is not shown");
    assert.ok(!blocks.includes("stock splits"), blocks);
  });
});
