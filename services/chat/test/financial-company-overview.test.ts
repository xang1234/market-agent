// The lane takes only a question with a metric word until routing changes
// (#398 step 6), so each turn here asks one and scripts how its question is read.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import type { ScopeProposal } from "../src/research-scope.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, METRIC_READING, NO_ASKS, resolveMention, revenueModel } from "./financial-fixtures.ts";

const COMPANIES: Readonly<Record<string, string>> = {
  QTRS: "4f000000-0000-4000-8000-0000000000e1",
  NOGP: "4f000000-0000-4000-8000-0000000000e2",
};
const REVENUE = [
  [2022, 1, "800"], [2022, 2, "900"], [2022, 3, "1000"], [2022, 4, "1100"],
  [2023, 1, "1200"], [2023, 2, "1300"], [2023, 3, "1500"], [2023, 4, "2000"],
] as const;

function resolve(mention: string): Promise<ChatSubjectPreResolution> {
  const id = COMPANIES[mention];
  return id === undefined
    ? resolveMention(mention)
    : Promise.resolve({ status: "resolved", subject_ref: { kind: "issuer", id }, display_label: `${mention} Corp`, handoff: { display_labels: { ticker: mention } } } as unknown as ChatSubjectPreResolution);
}

test("a question about one company that asks for no figure is answered with its overview (#398)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-overview");
  const base = { threadId, userId: IDS.owner };
  const quarterly = async (subject: string, metric_key: string, fiscal_year: number, quarter: number, value: string) => {
    const factId = await seedReportedFact(db, { metric_key, value, fiscal_year, subject });
    const month = 3 * quarter;
    await db.query(
      `update facts set period_kind = 'fiscal_q', fiscal_period = $2, period_start = $3::date, period_end = ($3::date + interval '3 months' - interval '1 day')::date where fact_id = $1::uuid`,
      [factId, `Q${quarter}`, `${fiscal_year}-${String(month - 2).padStart(2, "0")}-01`],
    );
  };
  for (const [ticker, issuer] of Object.entries(COMPANIES)) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, `${ticker} Corp`]);
    for (const [year, quarter, revenue] of REVENUE) await quarterly(issuer, "revenue", year, quarter, revenue);
    await quarterly(issuer, "gross_profit", 2023, ticker === "NOGP" ? 3 : 4, "1200");
    await quarterly(issuer, "operating_income", 2023, 4, "500");
    await quarterly(issuer, "net_income", 2023, 4, "400");
  }
  const results = async (messageId: unknown) => {
    const { rows: [message] } = await db.query(`select blocks from chat_messages where message_id = $1`, [messageId]);
    assert.ok(message, "a published answer");
    return (message.blocks[0].financial.results as Array<{ output_id: string; disposition: string; presented: { kind: string; text: string; reason_code?: string } }>)
      .map((result) => [result.output_id, result.disposition, result.presented.kind === "value" ? result.presented.text : result.presented.reason_code]);
  };
  const reading = (reading: ScopeProposal | null) => async () => reading;

  await t.test("a reading that asks for no figure publishes the overview, never waiting on the planning model", async () => {
    let calls = 0;
    const never: PlanningModel = () => {
      calls += 1;
      return new Promise(() => {});
    };
    const done = completed((await chatHarness(pool, { model: never, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual(await results(done.message_id), [
      ["out_revenue_q7", "verified", "USD 800.00"],
      ["out_revenue_q6", "verified", "USD 900.00"],
      ["out_revenue_q5", "verified", "USD 1,000.00"],
      ["out_revenue_q4", "verified", "USD 1,100.00"],
      ["out_revenue_q3", "verified", "USD 1,200.00"],
      ["out_revenue_q2", "verified", "USD 1,300.00"],
      ["out_revenue_q1", "verified", "USD 1,500.00"],
      ["out_revenue_q0", "verified", "USD 2,000.00"],
      ["out_gross_profit_q0", "verified", "USD 1,200.00"],
      ["out_operating_income_q0", "verified", "USD 500.00"],
      ["out_net_income_q0", "verified", "USD 400.00"],
      ["out_gross_margin", "verified", "60.00%"],
      ["out_operating_margin", "verified", "25.00%"],
      ["out_net_margin", "verified", "20.00%"],
      ["out_revenue_qoq", "verified", "33.33%"],
      ["out_revenue_yoy", "verified", "81.82%"],
    ]);
    assert.equal(calls, 1, "the planner starts beside the reading");
    const { rows: [shown] } = await db.query(`select blocks->0->'financial'->'presentations' as presentations from chat_messages where message_id = $1`, [done.message_id]);
    assert.deepEqual(
      shown.presentations.map((presentation: { kind: string; points?: unknown[] }) => `${presentation.kind}${presentation.points ? `(${presentation.points.length})` : ""}`),
      ["series(8)", "series(2)", "scalar", "scalar", "scalar", "scalar", "scalar", "scalar"],
      "revenue over the quarters first, then its growth, then the latest quarter's lines",
    );
    const latest = completed((await chatHarness(pool, { model: null, readQuestion: reading({ ...NO_ASKS, asks: new Set(["latest_quarter"]) }), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.equal((await results(latest.message_id)).length, 16, "the latest quarter is what the overview shows");
  });

  await t.test("a reading that asks for a figure, two companies, a carried company, or a named period goes to the planner", async () => {
    const planned = async (userIntent: string, mentions: string[], options: { readQuestion?: () => Promise<ScopeProposal | null>; priorSubjects?: () => Promise<ChatResolvedSubjectPreResolution[]> } = {}) => {
      const model = revenueModel(mentions);
      const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve, ...options }).run({ ...base, userIntent })).events);
      return [model.calls, (await results(done.message_id)).map(([outputId]) => outputId)];
    };
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading(METRIC_READING) }), [1, ["a_out"]], "a metric");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading({ ...NO_ASKS, income_items: ["revenue"] }) }), [1, ["a_out"]], "an income item");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading({ ...NO_ASKS, asks: new Set(["margins"]) }) }), [1, ["a_out"]], "a facet");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading(null) }), [1, ["a_out"]], "no reading");
    assert.deepEqual(await planned("Compare revenue for QTRS and NOGP", ["QTRS", "NOGP"]), [1, ["a_out", "b_out"]], "two companies");
    const carried = (await resolve("QTRS")) as ChatResolvedSubjectPreResolution;
    assert.deepEqual(await planned("And what about its revenue?", ["QTRS"], { priorSubjects: async () => [carried] }), [1, ["a_out"]], "a carried company");
    for (const period of ["in fiscal 2023", "for Q4 2023", "YTD"]) {
      assert.deepEqual(await planned(`Revenue for QTRS ${period}`, ["QTRS"]), [1, ["a_out"]], period);
    }
  });

  await t.test("a line the engine cannot certify is a gap cell, and the rest still publishes", async () => {
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for NOGP" })).events);
    assert.deepEqual(await results(done.message_id), [
      ["out_revenue_q7", "verified", "USD 800.00"],
      ["out_revenue_q6", "verified", "USD 900.00"],
      ["out_revenue_q5", "verified", "USD 1,000.00"],
      ["out_revenue_q4", "verified", "USD 1,100.00"],
      ["out_revenue_q3", "verified", "USD 1,200.00"],
      ["out_revenue_q2", "verified", "USD 1,300.00"],
      ["out_revenue_q1", "verified", "USD 1,500.00"],
      ["out_revenue_q0", "verified", "USD 2,000.00"],
      ["out_gross_profit_q0", "missing", "missing_input"],
      ["out_operating_income_q0", "verified", "USD 500.00"],
      ["out_net_income_q0", "verified", "USD 400.00"],
      ["out_gross_margin", "blocked_dependency", "blocked_by_dependency"],
      ["out_operating_margin", "verified", "25.00%"],
      ["out_net_margin", "verified", "20.00%"],
      ["out_revenue_qoq", "verified", "33.33%"],
      ["out_revenue_yoy", "verified", "81.82%"],
    ]);
  });
});
