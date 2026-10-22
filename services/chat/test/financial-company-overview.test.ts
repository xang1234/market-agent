// The lane takes only a question with a metric word until routing changes
// (#398 step 6), so each turn here asks one and scripts how its question is read.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel, PlanningResult } from "../../financial-engine/src/planner.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import type { ScopeProposal } from "../src/research-scope.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, METRIC_READING, NO_ASKS, resolveMention, revenueModel } from "./financial-fixtures.ts";

const COMPANIES: Readonly<Record<string, string>> = {
  QTRS: "4f000000-0000-4000-8000-0000000000e1",
  NOGP: "4f000000-0000-4000-8000-0000000000e2",
  // These two store each fourth quarter as the SEC ingester does.
  SECY: "4f000000-0000-4000-8000-0000000000e3",
  SECQ: "4f000000-0000-4000-8000-0000000000e4",
  // Its newest quarter is in fiscal 2201, past the plan schema's last year.
  FUTR: "4f000000-0000-4000-8000-0000000000e5",
};
const REVENUE = [
  [2022, 1, "800"], [2022, 2, "900"], [2022, 3, "1000"], [2022, 4, "1100"],
  [2023, 1, "1200"], [2023, 2, "1300"], [2023, 3, "1500"], [2023, 4, "2000"],
] as const;
const QTRS_OVERVIEW = [
  ["out_revenue_fy2022_q1", "Q1 FY2022", "verified", "USD 800.00"],
  ["out_revenue_fy2022_q2", "Q2 FY2022", "verified", "USD 900.00"],
  ["out_revenue_fy2022_q3", "Q3 FY2022", "verified", "USD 1,000.00"],
  ["out_revenue_fy2022_q4", "Q4 FY2022", "verified", "USD 1,100.00"],
  ["out_revenue_fy2023_q1", "Q1 FY2023", "verified", "USD 1,200.00"],
  ["out_revenue_fy2023_q2", "Q2 FY2023", "verified", "USD 1,300.00"],
  ["out_revenue_fy2023_q3", "Q3 FY2023", "verified", "USD 1,500.00"],
  ["out_revenue_fy2023_q4", "Q4 FY2023", "verified", "USD 2,000.00"],
  ["out_gross_profit_fy2023_q4", "Q4 FY2023", "verified", "USD 1,200.00"],
  ["out_operating_income_fy2023_q4", "Q4 FY2023", "verified", "USD 500.00"],
  ["out_net_income_fy2023_q4", "Q4 FY2023", "verified", "USD 400.00"],
  ["out_gross_margin", "Q4 FY2023", "verified", "60.00%"],
  ["out_operating_margin", "Q4 FY2023", "verified", "25.00%"],
  ["out_net_margin", "Q4 FY2023", "verified", "20.00%"],
  ["out_revenue_growth_qoq", "Q4 FY2023 vs Q3 FY2023", "verified", "33.33%"],
  ["out_revenue_growth_yoy", "Q4 FY2023 vs Q4 FY2022", "verified", "81.82%"],
];

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
  const quarterly = async (subject: string, metric_key: string, fiscal_year: number, quarter: number, value: string, derived = false) => {
    const start = `${fiscal_year}-${String(3 * quarter - 2).padStart(2, "0")}-01`;
    if (derived) {
      // The SEC ingester stores a fourth quarter as the year less its first
      // three: no source token, so no precision proof and no context.
      const { rowCount } = await db.query(
        `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                            value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                            freshness_class, coverage_level, confidence)
         select 'issuer', $1, metric_id, 'fiscal_q', $2::date, ($2::date + interval '3 months' - interval '1 day')::date, $3, $4, $5, 'currency', 'USD', 1,
                '2024-02-01T00:00:00Z', '2024-01-10T00:00:00Z', '2024-02-01T00:00:00Z', $6, 'reported', 'authoritative', 'filing_time', 'full', 1
           from metrics where metric_key = $7`,
        [subject, start, fiscal_year, `Q${quarter}`, value, IDS.sourceV1, metric_key],
      );
      assert.equal(rowCount, 1, `a derived ${metric_key} fact`);
      return;
    }
    const factId = await seedReportedFact(db, { metric_key, value, fiscal_year, subject });
    await db.query(
      `update facts set period_kind = 'fiscal_q', fiscal_period = $2, period_start = $3::date, period_end = ($3::date + interval '3 months' - interval '1 day')::date where fact_id = $1::uuid`,
      [factId, `Q${quarter}`, start],
    );
  };
  for (const [ticker, issuer] of Object.entries(COMPANIES)) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, `${ticker} Corp`]);
    const derived = ticker === "SECY" || ticker === "SECQ";
    for (const [year, quarter, revenue] of REVENUE) await quarterly(issuer, "revenue", year, quarter, revenue, derived && quarter === 4);
    if (ticker === "SECQ") continue;
    await quarterly(issuer, "gross_profit", 2023, ticker === "NOGP" ? 3 : 4, "1200", derived);
    await quarterly(issuer, "operating_income", 2023, 4, "500", derived);
    await quarterly(issuer, "net_income", 2023, 4, "400", derived);
  }
  for (const [metric, value] of [["revenue", "2400"], ["gross_profit", "1200"], ["operating_income", "600"], ["net_income", "480"]] as const) {
    await quarterly(COMPANIES.SECQ!, metric, 2024, 1, value);
  }
  await quarterly(COMPANIES.FUTR!, "revenue", 2201, 1, "2400");
  const results = async (messageId: unknown) => {
    const { rows: [message] } = await db.query(`select blocks from chat_messages where message_id = $1`, [messageId]);
    assert.ok(message, "a published answer");
    const { labels, results } = message.blocks[0].financial as {
      labels: Record<string, { text: string }>;
      results: Array<{ output_id: string; period_label_id: string; disposition: string; presented: { kind: string; text: string; reason_code?: string } }>;
    };
    return results.map((result) => [result.output_id, labels[result.period_label_id]!.text, result.disposition, result.presented.kind === "value" ? result.presented.text : result.presented.reason_code]);
  };
  const reading = (reading: ScopeProposal | null) => async () => reading;

  await t.test("a reading that asks for no figure publishes the overview, never waiting on the planning model", async () => {
    let calls = 0;
    const never: PlanningModel = () => {
      calls += 1;
      return new Promise(() => {});
    };
    const done = completed((await chatHarness(pool, { model: never, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual(await results(done.message_id), QTRS_OVERVIEW);
    assert.equal(calls, 1, "the planner starts beside the reading");
    const { rows: [shown] } = await db.query(`select blocks->0->'financial'->'presentations' as presentations from chat_messages where message_id = $1`, [done.message_id]);
    assert.deepEqual(
      shown.presentations.map((presentation: { kind: string; points?: unknown[] }) => `${presentation.kind}${presentation.points ? `(${presentation.points.length})` : ""}`),
      ["series(8)", "series(2)", "scalar", "scalar", "scalar", "scalar", "scalar", "scalar"],
      "revenue over the quarters first, then its growth, then the latest quarter's lines",
    );
    const latest = completed((await chatHarness(pool, { model: null, readQuestion: reading({ ...NO_ASKS, asks: new Set(["latest_quarter"]) }), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual(await results(latest.message_id), QTRS_OVERVIEW, "a reading that asks for the latest quarter gets the overview, which shows it");
  });

  await t.test("a planner the overview drops never calls the model again, and how it ended is logged", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    let calls = 0;
    let answer!: (reply: { text: string; model: string }) => void;
    const model: PlanningModel = () => {
      calls += 1;
      return new Promise((resolve) => (answer = resolve));
    };
    const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual(await results(done.message_id), QTRS_OVERVIEW);
    // A reply that is no draft makes the planner ask the model again.
    answer({ text: "not a draft", model: "test" });
    const dropped = () => warned.filter(([message]) => String(message).startsWith("[chat]"));
    for (const deadline = Date.now() + 10_000; dropped().length === 0 && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, 1, "the planner's second call never reaches the model");
    assert.deepEqual(dropped(), [["[chat] the planner was dropped for the company overview; its next model call was not made"]]);
  });

  await t.test("a planner that fails after the overview replaced it is logged as failed, not as dropped (#473)", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    let fail!: (reason: Error) => void;
    const model: PlanningModel = () => new Promise((_, reject) => (fail = reject));
    const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual(await results(done.message_id), QTRS_OVERVIEW);
    fail(new Error("the model is down"));
    const logged = () => warned.filter(([message]) => String(message).startsWith("[chat]"));
    for (const deadline = Date.now() + 10_000; logged().length === 0 && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(logged().map(([message, reason]) => [message, ((reason as Error).cause as Error).message]), [
      ["[chat] the planner the company overview replaced had failed", "the model is down"],
    ]);
  });

  await t.test("a planner whose reply lands while the overview reads, before that read fails, still answers (#473)", async (st) => {
    st.mock.method(console, "warn", () => {});
    const drafts = revenueModel(["QTRS"]);
    let calls = 0;
    let answer!: (reply: { text: string; model: string }) => void;
    const model: PlanningModel = (request) => {
      calls += 1;
      return calls === 1 ? new Promise((resolve) => (answer = resolve)) : drafts(request);
    };
    let started!: () => void;
    const overviewReads = new Promise<void>((resolve) => (started = resolve));
    let failRead: (() => void) | undefined;
    const slowFailing: typeof createEvidenceFinancialPort = (executor) => {
      const port = createEvidenceFinancialPort(executor);
      return {
        ...port,
        listInputCandidates: (request) => {
          if (failRead) return port.listInputCandidates(request);
          started();
          return new Promise((resolve) => (failRead = () => resolve({ status: "error", reason_code: "database_error" })));
        },
      };
    };
    const turn = chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve, evidence: slowFailing }).run({ ...base, userIntent: "Revenue for QTRS" });
    await overviewReads;
    // A reply that is no draft makes the planner ask the model again.
    answer({ text: "not a draft", model: "test" });
    for (const deadline = Date.now() + 2_000; calls < 2 && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 10));
    failRead!();
    const done = completed((await turn).events);
    assert.deepEqual([calls, (await results(done.message_id)).map(([outputId]) => outputId)], [2, ["a_out"]]);
  });

  await t.test("an overview that cannot read the company's quarters falls back to the planner's answer", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    let failed = false;
    const failingOnce: typeof createEvidenceFinancialPort = (executor) => {
      const port = createEvidenceFinancialPort(executor);
      return {
        ...port,
        listInputCandidates: async (request) => {
          if (failed) return port.listInputCandidates(request);
          failed = true;
          return { status: "error", reason_code: "database_error" };
        },
      };
    };
    const model = revenueModel(["QTRS"]);
    const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve, evidence: failingOnce }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual([model.calls, (await results(done.message_id)).map(([outputId]) => outputId)], [1, ["a_out"]]);
    assert.deepEqual(warned.filter(([message]) => String(message).startsWith("[chat]")).map(([message]) => message), [
      "[chat] the company overview could not be planned; the planner answers",
    ]);
  });

  await t.test("a defect in the overview fails the turn rather than answering through the planner (#473)", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    const errors: unknown[][] = [];
    st.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
    const defective: typeof createEvidenceFinancialPort = (executor) => ({
      ...createEvidenceFinancialPort(executor),
      listInputCandidates: async () => {
        throw new TypeError("a defect");
      },
    });
    // It rejects too: a planner the failed turn leaves behind is no unhandled rejection.
    const failing: PlanningModel = async () => {
      throw new Error("the model is down");
    };
    const { events } = await chatHarness(pool, { model: failing, readQuestion: reading(NO_ASKS), resolveMention: resolve, evidence: defective }).run({ ...base, userIntent: "Revenue for QTRS" });
    assert.deepEqual([events.at(-1)!.type, events.at(-1)!.error_code], ["turn.error", "financial_answer_failed"]);
    assert.deepEqual(warned.filter(([message]) => String(message).startsWith("[chat]")), []);
    assert.ok(errors.some((args) => args.some((arg) => arg instanceof TypeError)), "the defect is logged");
  });

  await t.test("an overview the engine does not plan falls back to the planner's answer, and says why (#473)", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    const model = revenueModel(["FUTR"]);
    const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for FUTR" })).events);
    assert.deepEqual([model.calls, (await results(done.message_id)).map(([outputId]) => outputId)], [1, ["a_out"]]);
    assert.deepEqual(
      warned.filter(([message]) => String(message).startsWith("[chat]")).map(([message, overview]) => [message, (overview as PlanningResult).outcome]),
      [["[chat] the company overview could not be planned; the planner answers", "unsupported"]],
    );
  });

  await t.test("a reading that asks for a figure, two companies, a carried company, a named period, or a company with no quarters goes to the planner", async () => {
    const planned = async (userIntent: string, mentions: string[], options: { readQuestion?: () => Promise<ScopeProposal | null>; priorSubjects?: () => Promise<ChatResolvedSubjectPreResolution[]> } = {}) => {
      const model = revenueModel(mentions);
      const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve, ...options }).run({ ...base, userIntent })).events);
      return [model.calls, (await results(done.message_id)).map(([outputId]) => outputId)];
    };
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading(METRIC_READING) }), [1, ["a_out"]], "a metric");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading({ ...NO_ASKS, income_items: ["revenue"] }) }), [1, ["a_out"]], "an income item");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading({ ...NO_ASKS, asks: new Set(["margins"]) }) }), [1, ["a_out"]], "a facet");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading(null) }), [1, ["a_out"]], "no reading");
    assert.deepEqual(await planned("Revenue for AAA", ["AAA"]), [1, ["a_out"]], "a company with no quarterly revenue");
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
      ...QTRS_OVERVIEW.slice(0, 8),
      ["out_gross_profit_fy2023_q4", "Q4 FY2023", "missing", "missing_input"],
      ...QTRS_OVERVIEW.slice(9, 11),
      ["out_gross_margin", "Q4 FY2023", "blocked_dependency", "blocked_by_dependency"],
      ...QTRS_OVERVIEW.slice(12),
    ]);
  });

  await t.test("a fourth quarter the SEC ingester derived is the newest quarter or a gap where it falls, never skipped", async () => {
    const overview = async (userIntent: string) =>
      results(completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent })).events).message_id);
    const derived = (outputId: string, period: string) => [outputId, period, "missing", "precision_unverified"];
    const blocked = (outputId: string, period: string) => [outputId, period, "blocked_dependency", "blocked_by_dependency"];
    assert.deepEqual(await overview("Revenue for SECY"), [
      ...QTRS_OVERVIEW.slice(0, 3),
      derived("out_revenue_fy2022_q4", "Q4 FY2022"),
      ...QTRS_OVERVIEW.slice(4, 7),
      derived("out_revenue_fy2023_q4", "Q4 FY2023"),
      derived("out_gross_profit_fy2023_q4", "Q4 FY2023"),
      derived("out_operating_income_fy2023_q4", "Q4 FY2023"),
      derived("out_net_income_fy2023_q4", "Q4 FY2023"),
      blocked("out_gross_margin", "Q4 FY2023"),
      blocked("out_operating_margin", "Q4 FY2023"),
      blocked("out_net_margin", "Q4 FY2023"),
      blocked("out_revenue_growth_qoq", "Q4 FY2023 vs Q3 FY2023"),
      blocked("out_revenue_growth_yoy", "Q4 FY2023 vs Q4 FY2022"),
    ], "the latest quarter is the derived fourth quarter, not the third before it");
    assert.deepEqual(await overview("Revenue for SECQ"), [
      ...QTRS_OVERVIEW.slice(1, 3),
      derived("out_revenue_fy2022_q4", "Q4 FY2022"),
      ...QTRS_OVERVIEW.slice(4, 7),
      derived("out_revenue_fy2023_q4", "Q4 FY2023"),
      ["out_revenue_fy2024_q1", "Q1 FY2024", "verified", "USD 2,400.00"],
      ["out_gross_profit_fy2024_q1", "Q1 FY2024", "verified", "USD 1,200.00"],
      ["out_operating_income_fy2024_q1", "Q1 FY2024", "verified", "USD 600.00"],
      ["out_net_income_fy2024_q1", "Q1 FY2024", "verified", "USD 480.00"],
      ["out_gross_margin", "Q1 FY2024", "verified", "50.00%"],
      ["out_operating_margin", "Q1 FY2024", "verified", "25.00%"],
      ["out_net_margin", "Q1 FY2024", "verified", "20.00%"],
      blocked("out_revenue_growth_qoq", "Q1 FY2024 vs Q4 FY2023"),
      ["out_revenue_growth_yoy", "Q1 FY2024 vs Q1 FY2023", "verified", "100.00%"],
    ], "growth after a first quarter compares with the fourth quarter before it and the first a year earlier");
  });
});
