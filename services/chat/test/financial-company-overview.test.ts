// The lane takes only a question with a metric word until routing changes
// (#398 step 6), so each turn here asks one and scripts how its question is read.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel, PlanningResult } from "../../financial-engine/src/planner.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { SqlExecutor } from "../../financial-engine/src/ports.ts";
import { IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import { resolveResearchScope, type ResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, METRIC_READING, NO_ASKS, readingOf, resolveMention, revenueModel } from "./financial-fixtures.ts";

const COMPANIES: Readonly<Record<string, string>> = {
  QTRS: "4f000000-0000-4000-8000-0000000000e1",
  NOGP: "4f000000-0000-4000-8000-0000000000e2",
  // These two store each fourth quarter as the SEC ingester does.
  SECY: "4f000000-0000-4000-8000-0000000000e3",
  SECQ: "4f000000-0000-4000-8000-0000000000e4",
  FUTR: "4f000000-0000-4000-8000-0000000000e5",
  OFFQ: "4f000000-0000-4000-8000-0000000000e6",
  MOVD: "4f000000-0000-4000-8000-0000000000e7",
  MRGN: "4f000000-0000-4000-8000-0000000000e8",
};
const REVENUE = [
  [2022, 1, "800"], [2022, 2, "900"], [2022, 3, "1000"], [2022, 4, "1100"],
  [2023, 1, "1200"], [2023, 2, "1300"], [2023, 3, "1500"], [2023, 4, "2000"],
] as const;
const QTRS_LATEST = [
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
const QTRS_OVERVIEW = [
  ["out_revenue_fy2022_q1", "Q1 FY2022", "verified", "USD 800.00"],
  ["out_revenue_fy2022_q2", "Q2 FY2022", "verified", "USD 900.00"],
  ["out_revenue_fy2022_q3", "Q3 FY2022", "verified", "USD 1,000.00"],
  ["out_revenue_fy2022_q4", "Q4 FY2022", "verified", "USD 1,100.00"],
  ["out_revenue_fy2023_q1", "Q1 FY2023", "verified", "USD 1,200.00"],
  ["out_revenue_fy2023_q2", "Q2 FY2023", "verified", "USD 1,300.00"],
  ["out_revenue_fy2023_q3", "Q3 FY2023", "verified", "USD 1,500.00"],
  ...QTRS_LATEST.slice(0, 7),
  ["out_revenue_growth_qoq_fy2022_q2", "Q2 FY2022 vs Q1 FY2022", "verified", "12.50%"],
  ["out_revenue_growth_qoq_fy2022_q3", "Q3 FY2022 vs Q2 FY2022", "verified", "11.11%"],
  ["out_revenue_growth_qoq_fy2022_q4", "Q4 FY2022 vs Q3 FY2022", "verified", "10.00%"],
  ["out_revenue_growth_qoq_fy2023_q1", "Q1 FY2023 vs Q4 FY2022", "verified", "9.09%"],
  ["out_revenue_growth_qoq_fy2023_q2", "Q2 FY2023 vs Q1 FY2023", "verified", "8.33%"],
  ["out_revenue_growth_qoq_fy2023_q3", "Q3 FY2023 vs Q2 FY2023", "verified", "15.38%"],
  ...QTRS_LATEST.slice(7),
  ["out_revenue_highest", "Q1 FY2022 to Q4 FY2023", "verified", "Q4 FY2023 has the highest revenue of the 8 quarters ranked"],
  ["out_revenue_lowest", "Q1 FY2022 to Q4 FY2023", "verified", "Q1 FY2022 has the lowest revenue of the 8 quarters ranked"],
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
  await db.query(
    `update facts set period_start = period_start + interval '1 month', period_end = period_start + interval '4 months' - interval '1 day' where subject_id = $1 and fiscal_year = 2023`,
    [COMPANIES.MOVD],
  );
  const MRGN_LINES = { gross_profit: ["400", "450", "500", "550", "600", "650", "900", "1200"], operating_income: ["80", "90", "100", "110", "120", "130", "150", "500"], net_income: ["-8", "9", "10", "11", "12", "13", "15", "400"] };
  await db.query(`delete from facts where subject_id = $1 and fiscal_year = 2023 and fiscal_period = 'Q4' and metric_id in (select metric_id from metrics where metric_key <> 'revenue')`, [COMPANIES.MRGN]);
  for (const [metric, values] of Object.entries(MRGN_LINES)) {
    for (const [index, [year, quarter]] of REVENUE.entries()) await quarterly(COMPANIES.MRGN!, metric, year, quarter, values[index]!);
  }
  await quarterly(COMPANIES.FUTR!, "revenue", 2201, 1, "2400");
  await quarterly(COMPANIES.OFFQ!, "revenue", 2024, 1, "2100");
  for (const [metric, value] of [["revenue", "2600"], ["gross_profit", "1300"], ["operating_income", "650"], ["net_income", "520"]] as const) {
    await quarterly(COMPANIES.OFFQ!, metric, 2024, 2, value);
  }
  const results = async (messageId: unknown) => {
    const { rows: [message] } = await db.query(`select blocks from chat_messages where message_id = $1`, [messageId]);
    assert.ok(message, "a published answer");
    const { labels, results } = message.blocks[0].financial as {
      labels: Record<string, { text: string }>;
      results: Array<{ output_id: string; period_label_id: string; disposition: string; presented: { kind: string; text: string; reason_code?: string } }>;
    };
    return results.map((result) => [result.output_id, labels[result.period_label_id]!.text, result.disposition, result.presented.kind === "gap" ? result.presented.reason_code : result.presented.text]);
  };
  const reading = readingOf;

  await t.test("a reading that asks for no figure publishes the overview, never waiting on the planning model", async () => {
    let calls = 0;
    const never: PlanningModel = () => {
      calls += 1;
      return new Promise(() => {});
    };
    const done = completed((await chatHarness(pool, { model: never, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual(await results(done.message_id), QTRS_OVERVIEW);
    assert.equal(calls, 0, "the reading decides the overview before any planning");
    const { rows: [shown] } = await db.query(`select blocks->0->'financial'->'presentations' as presentations from chat_messages where message_id = $1`, [done.message_id]);
    assert.deepEqual(
      shown.presentations.map((presentation: { kind: string; points?: unknown[] }) => `${presentation.kind}${presentation.points ? `(${presentation.points.length})` : ""}`),
      ["series(8)", "series(7)", "scalar", "scalar", "scalar", "scalar", "scalar", "scalar", "scalar", "predicate", "predicate"],
      "revenue and its QoQ growth over the quarters, then the latest quarter's lines, its YoY growth, and the high and low (#470)",
    );
    const latest = completed((await chatHarness(pool, { model: null, readQuestion: reading({ ...NO_ASKS, asks: new Set(["latest_quarter"]) }), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual(await results(latest.message_id), QTRS_OVERVIEW, "a reading that asks for the latest quarter gets the overview, which shows it");
  });

  await t.test("an explanation of a company is its overview, and its note names the cause as not covered, commentary or not (#398)", async () => {
    const notes = async (commentary?: Parameters<typeof chatHarness>[1]["commentary"]) => {
      const done = completed((await chatHarness(pool, { model: null, readQuestion: reading({ ...NO_ASKS, asks: new Set(["explains"]) }), resolveMention: resolve, ...(commentary ? { commentary } : {}) }).run({ ...base, userIntent: "Explain QTRS's results" })).events);
      assert.deepEqual(await results(done.message_id), QTRS_OVERVIEW);
      const { rows: [message] } = await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id]);
      return message.blocks.slice(1).map((block: { segments: Array<{ text: string }> }) => block.segments[0]!.text);
    };
    const uncovered = ["Not covered by this answer: the cause of these figures."];
    assert.deepEqual(await notes(async () => {}), uncovered, "commentary written from the figures gives no cause");
    assert.deepEqual(await notes(), uncovered);
  });



  await t.test("a question the overview answers never calls the planner's model (#398)", async () => {
    const model = revenueModel(["QTRS"]);
    const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Tell me about QTRS" })).events);
    assert.deepEqual([model.calls, await results(done.message_id)], [0, QTRS_OVERVIEW]);
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
    let calls = 0;
    const failing: PlanningModel = async () => {
      calls += 1;
      throw new Error("the model is down");
    };
    const { events } = await chatHarness(pool, { model: failing, readQuestion: reading(NO_ASKS), resolveMention: resolve, evidence: defective }).run({ ...base, userIntent: "Revenue for QTRS" });
    assert.deepEqual([events.at(-1)!.type, events.at(-1)!.error_code, calls], ["turn.error", "financial_answer_failed", 0]);
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

  const scoped = async (context: { userIntent?: string }, read: Promise<ScopeProposal | null>) =>
    resolveResearchScope({ question: context.userIntent ?? "", companies: [{ issuer_id: COMPANIES.QTRS!, label: "QTRS" }], prior: null, asOf: "2026-10-22T00:00:00.000Z", served: true, proposal: await read });

  await t.test("an overview keeps no period in its saved scope, as it shows the latest quarters (#398)", async () => {
    const keepsYear = (async (context: { userIntent?: string }, read: Promise<ScopeProposal | null>) => ({ ...(await scoped(context, read)), fiscal_year: 2023 })) as never;
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve, researchScope: keepsYear }).run({ ...base, userIntent: "How is QTRS doing?" })).events);
    assert.deepEqual(await results(done.message_id), QTRS_OVERVIEW);
    const { rows: [saved] } = await db.query(`select research_scope from chat_messages where message_id = $1`, [done.message_id]);
    assert.deepEqual([saved.research_scope.fiscal_year, saved.research_scope.fiscal_quarter], [null, null]);
  });

  await t.test("a reading that asks for a figure or a period other than the latest, or a company with no quarters, goes to the planner; a carried company is the overview, and a price window the analyst's", async () => {
    const planned = async (userIntent: string, mentions: string[], options: { readQuestion?: (question: string) => Promise<ScopeProposal | null>; priorSubjects?: () => Promise<ChatResolvedSubjectPreResolution[]>; researchScope?: typeof scoped | (() => Promise<ResearchScope>) } = {}) => {
      const model = revenueModel(mentions);
      const done = completed((await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve, ...options }).run({ ...base, userIntent })).events);
      return [model.calls, (await results(done.message_id)).map(([outputId]) => outputId)];
    };
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading(METRIC_READING) }), [1, ["a_out"]], "a metric");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading({ ...NO_ASKS, income_items: ["revenue"] }) }), [1, ["a_out"]], "an income item");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading({ ...NO_ASKS, asks: new Set(["margins"]) }) }), [1, ["a_out"]], "a facet");
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { readQuestion: reading(null) }), [1, ["a_out"]], "no reading");
    assert.deepEqual(await planned("Revenue for AAA", ["AAA"]), [1, ["a_out"]], "a company with no quarterly revenue");
    assert.deepEqual(await planned("Compare revenue for QTRS and AAA", ["QTRS", "AAA"]), [1, ["a_out", "b_out"]], "a company with no quarterly revenue beside one with");
    const carried = (await resolve("QTRS")) as ChatResolvedSubjectPreResolution;
    // A follow-up that adds a company is the overview of the carried one and the added one.
    assert.deepEqual(await planned("Compare it with AAA", ["QTRS", "AAA"], { priorSubjects: async () => [carried], readQuestion: reading({ ...NO_ASKS, companies: { kind: "compare", add: ["AAA"] } }) }), [1, ["a_out", "b_out"]], "a carried company beside one with no quarters");
    const periods: Array<[string, ScopeProposal]> = [
      ["in fiscal 2023", { ...NO_ASKS, period: { kind: "fiscal_year", fiscal_year: 2023 } }],
      ["for Q4 2023", { ...NO_ASKS, period: { kind: "fiscal_quarter", fiscal_period: "Q4", fiscal_year: 2023 } }],
      ["for Q4", { ...NO_ASKS, period: { kind: "fiscal_quarter", fiscal_period: "Q4", fiscal_year: null } }],
      ["TTM", { ...NO_ASKS, period: { kind: "trailing_twelve_months" } }],
      ["since 2021", { ...NO_ASKS, period: { kind: "range" } }],
      ["last year", { ...NO_ASKS, period: { kind: "other" } }],
    ];
    for (const [period, read] of periods) {
      // The reading names QTRS, so it is a question of its own, not a follow-up.
      const named = { ...read, companies: { kind: "as_named" as const, names: ["QTRS"] } };
      assert.deepEqual(await planned(`Revenue for QTRS ${period}`, ["QTRS"], { readQuestion: reading(named) }), [1, ["a_out"]], period);
    }
    // A price window, asked for or kept by the scope, is market data the analyst path charts (#398 D2).
    let analystCalls = 0;
    const analyst = () => {
      analystCalls += 1;
      return { snapshot_id: "00000000-0000-4000-8000-000000000000", blocks: [], verification: { ok: true } };
    };
    for (const options of [{ readQuestion: reading({ ...NO_ASKS, asks: new Set(["price_window"]) }) }, { researchScope: scoped }]) {
      const model = revenueModel(["QTRS"]);
      await chatHarness(pool, { model, readQuestion: reading(NO_ASKS), resolveMention: resolve, analyst, ...options }).run({ ...base, userIntent: "Revenue for QTRS YTD" });
      assert.equal(model.calls, 0);
    }
    assert.equal(analystCalls, 2, "a window the reading asks for, and one the scope keeps");
    const failing = async (): Promise<ResearchScope> => {
      throw new Error("the scope is down");
    };
    assert.deepEqual(await planned("Revenue for QTRS", ["QTRS"], { researchScope: failing }), [1, ["a_out"]], "no scope");
  });

  await t.test("a reading of the latest period is the overview, whatever period words the question holds (#472)", async () => {
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for QTRS in fiscal 2023" })).events);
    assert.deepEqual(await results(done.message_id), QTRS_OVERVIEW);
  });

  await t.test("a quarter whose dates do not follow the one before it gets no growth, and the answer's note names it (#479)", async () => {
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Revenue for MOVD" })).events);
    const growth = (await results(done.message_id)).flatMap(([outputId, period]) => outputId!.startsWith("out_revenue_growth") ? [period] : []);
    assert.deepEqual(growth, ["Q2 FY2022 vs Q1 FY2022", "Q3 FY2022 vs Q2 FY2022", "Q4 FY2022 vs Q3 FY2022", "Q2 FY2023 vs Q1 FY2023", "Q3 FY2023 vs Q2 FY2023", "Q4 FY2023 vs Q3 FY2023"]);
    const { rows: [message] } = await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id]);
    assert.equal(
      message.blocks[1]?.segments?.[0]?.text,
      "Not covered by this answer: revenue growth from Q4 FY2022 to Q1 FY2023, whose quarters are not dated consecutively; revenue growth from Q4 FY2022 to Q4 FY2023, whose quarters are not dated consecutively.",
    );
  });

  await t.test("a turn resumed before its overview was saved notes the growth its first attempt left out (#479)", async () => {
    const thread = (await db.query(`insert into chat_threads (thread_id, user_id) values (gen_random_uuid(), $1) returning thread_id`, [IDS.other])).rows[0].thread_id;
    const turn = { threadId: thread, userId: IDS.owner, turnId: randomUUID(), userIntent: "Revenue for MOVD" };
    // The thread is another user's, so the first attempt plans and reserves the run but cannot publish.
    await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run(turn);
    await db.query(`update chat_threads set user_id = $2 where thread_id = $1`, [thread, IDS.owner]);
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run(turn)).events);
    const { rows: [message] } = await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id]);
    assert.equal(
      message.blocks[1]?.segments?.[0]?.text,
      "Not covered by this answer: revenue growth from Q4 FY2022 to Q1 FY2023, whose quarters are not dated consecutively; revenue growth from Q4 FY2022 to Q4 FY2023, whose quarters are not dated consecutively.",
    );
  });

  await t.test("a statement error as the overview is read again for its note leaves the answer published (#479 review)", async (st) => {
    const warned: unknown[][] = [];
    st.mock.method(console, "warn", (...args: unknown[]) => warned.push(args));
    // Its revenue is read to plan the overview, then again in the transaction that saves the answer.
    let reads = 0;
    const failingReread: typeof createEvidenceFinancialPort = (executor) => {
      const port = createEvidenceFinancialPort(executor);
      const failing = createEvidenceFinancialPort({ query: () => executor.query("select 1/0") } as unknown as SqlExecutor);
      return { ...port, listInputCandidates: (request) => (request.fiscal_year === null && reads++ > 0 ? failing : port).listInputCandidates(request) };
    };
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve, evidence: failingReread }).run({ ...base, userIntent: "Revenue for QTRS" })).events);
    assert.deepEqual([reads, await results(done.message_id)], [2, QTRS_OVERVIEW]);
    assert.deepEqual(warned.filter(([message]) => String(message).startsWith("[chat]")), [
      ["[chat] the overview's revenue quarters could not be read again, so its note names no growth it leaves out", "database_error"],
    ]);
  });

  await t.test("a question about one company's margin trend is its three margins over the quarters, each with its high and low, with no model planning it (#398)", async () => {
    let calls = 0;
    const counted: PlanningModel = async () => {
      calls += 1;
      throw new Error("the planner should not be asked");
    };
    const trend = { ...NO_ASKS, asks: new Set(["margins", "margin_trend"] as const), income_items: ["operating_margin" as const] };
    const done = completed((await chatHarness(pool, { model: counted, readQuestion: reading(trend), resolveMention: resolve }).run({ ...base, userIntent: "How have MRGN's operating margins trended?" })).events);
    const rows = await results(done.message_id);
    assert.equal(calls, 0);
    assert.deepEqual(rows.filter(([outputId]) => outputId!.startsWith("out_operating_margin_fy")).map(([, period, , text]) => [period, text]), REVENUE.map(([year, quarter], index) => [`Q${quarter} FY${year}`, index === 7 ? "25.00%" : "10.00%"]));
    assert.deepEqual(rows.filter(([outputId]) => /_(highest|lowest)$/u.test(outputId!)).map(([outputId, period, , text]) => [outputId, period, text]), [
      ["out_gross_margin_highest", "Q1 FY2022 to Q4 FY2023", "Q3 FY2023 and Q4 FY2023 tie for the highest gross margin (gross profit / revenue) of the 8 quarters ranked"],
      ["out_gross_margin_lowest", "Q1 FY2022 to Q4 FY2023", "Q1 FY2022, Q2 FY2022, Q3 FY2022, Q4 FY2022, Q1 FY2023, and Q2 FY2023 tie for the lowest gross margin (gross profit / revenue) of the 8 quarters ranked"],
      ["out_operating_margin_highest", "Q1 FY2022 to Q4 FY2023", "Q4 FY2023 has the highest operating margin (operating income / revenue) of the 8 quarters ranked"],
      ["out_operating_margin_lowest", "Q1 FY2022 to Q4 FY2023", "Q1 FY2022, Q2 FY2022, Q3 FY2022, Q4 FY2022, Q1 FY2023, Q2 FY2023, and Q3 FY2023 tie for the lowest operating margin (operating income / revenue) of the 8 quarters ranked"],
      ["out_net_margin_highest", "Q1 FY2022 to Q4 FY2023", "Q4 FY2023 has the highest net margin (net income / revenue) of the 8 quarters ranked"],
      ["out_net_margin_lowest", "Q1 FY2022 to Q4 FY2023", "Q1 FY2022 has the lowest net margin (net income / revenue) of the 8 quarters ranked"],
    ]);
    const { rows: [shown] } = await db.query(`select blocks->0->'financial'->'presentations' as presentations, research_scope from chat_messages where message_id = $1`, [done.message_id]);
    assert.deepEqual(shown.presentations.map((presentation: { kind: string; points?: unknown[] }) => `${presentation.kind}${presentation.points ? `(${presentation.points.length})` : ""}`), [
      "series(8)", "series(8)", "series(8)", "predicate", "predicate", "predicate", "predicate", "predicate", "predicate",
    ]);
    assert.deepEqual([shown.research_scope.fiscal_year, shown.research_scope.fiscal_quarter], [null, null], "it shows the latest quarters, so it keeps no period");
  });

  await t.test("a margin trend's answer is saved without reading its revenue again, as only an overview's note names growth it leaves out (#479 review)", async () => {
    const reads: string[] = [];
    const counted: typeof createEvidenceFinancialPort = (executor) => {
      const port = createEvidenceFinancialPort(executor);
      return {
        ...port,
        listInputCandidates: (request) => {
          if (request.fiscal_year === null) reads.push(request.metric_key);
          return port.listInputCandidates(request);
        },
      };
    };
    const quartersRead = async (read: ScopeProposal) => {
      reads.length = 0;
      completed((await chatHarness(pool, { model: null, readQuestion: reading(read), resolveMention: resolve, evidence: counted }).run({ ...base, userIntent: "How have MRGN's margins trended?" })).events);
      return [...reads];
    };
    const trend = { ...NO_ASKS, asks: new Set(["margins", "margin_trend"] as const) };
    assert.deepEqual(await quartersRead(trend), ["revenue"], "read once, to plan the trend");
    assert.deepEqual(await quartersRead(NO_ASKS), ["revenue", "revenue"], "an overview is read again as its answer is saved");
  });

  const slotted = (slot: string, rows: ReadonlyArray<ReadonlyArray<string>>) => rows.map(([outputId, ...rest]) => [outputId!.replace(/^out_/u, `out_${slot}_`), ...rest]);
  const OFFQ_LATEST = [
    ["out_revenue_fy2024_q2", "Q2 FY2024", "verified", "USD 2,600.00"],
    ["out_gross_profit_fy2024_q2", "Q2 FY2024", "verified", "USD 1,300.00"],
    ["out_operating_income_fy2024_q2", "Q2 FY2024", "verified", "USD 650.00"],
    ["out_net_income_fy2024_q2", "Q2 FY2024", "verified", "USD 520.00"],
    ["out_gross_margin", "Q2 FY2024", "verified", "50.00%"],
    ["out_operating_margin", "Q2 FY2024", "verified", "25.00%"],
    ["out_net_margin", "Q2 FY2024", "verified", "20.00%"],
    ["out_revenue_growth_qoq", "Q2 FY2024 vs Q1 FY2024", "verified", "23.81%"],
    ["out_revenue_growth_yoy", "Q2 FY2024 vs Q2 FY2023", "verified", "100.00%"],
  ];
  const leads = (period: string, outcomes: ReadonlyArray<ReadonlyArray<string>>) =>
    ["gross_margin", "operating_margin", "net_margin"].map((metric, index) => [`out_a_minus_b_${metric}`, period, ...outcomes[index]!]);
  const QTRS_OVER_OFFQ = [
    ["out_b_gross_margin_fy2023_q4", "Q4 FY2023", "verified", "60.00%"],
    ["out_b_operating_margin_fy2023_q4", "Q4 FY2023", "verified", "25.00%"],
    ["out_b_net_margin_fy2023_q4", "Q4 FY2023", "verified", "20.00%"],
    ...leads("QTRS Corp Q4 FY2023 minus OFFQ Corp Q4 FY2023", Array(3).fill(["verified", "0.00 pp"])),
  ];

  await t.test("a comparison of named companies is one table, each company's figures from its own latest quarter (#398)", async () => {
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Compare revenue for QTRS and OFFQ" })).events);
    assert.deepEqual(await results(done.message_id), [...slotted("a", QTRS_LATEST), ...slotted("b", OFFQ_LATEST), ...QTRS_OVER_OFFQ]);
    const { rows: [shown] } = await db.query(`select blocks->0->'financial'->'presentations' as presentations from chat_messages where message_id = $1`, [done.message_id]);
    assert.deepEqual(shown.presentations.map((presentation: { kind: string }) => presentation.kind), ["table", "scalar", "scalar", "scalar"], "the leads stand beside the table");
  });

  await t.test("a line the engine cannot certify for one compared company is its gap cell, and the comparison still publishes (#398)", async () => {
    const done = completed((await chatHarness(pool, { model: null, readQuestion: reading(NO_ASKS), resolveMention: resolve }).run({ ...base, userIntent: "Compare revenue for QTRS and NOGP" })).events);
    const nogp = slotted("b", QTRS_LATEST);
    nogp[1] = ["out_b_gross_profit_fy2023_q4", "Q4 FY2023", "missing", "missing_input"];
    nogp[4] = ["out_b_gross_margin", "Q4 FY2023", "blocked_dependency", "blocked_by_dependency"];
    const tied = leads("QTRS Corp Q4 FY2023 minus NOGP Corp Q4 FY2023", [["blocked_dependency", "blocked_by_dependency"], ["verified", "0.00 pp"], ["verified", "0.00 pp"]]);
    assert.deepEqual(await results(done.message_id), [...slotted("a", QTRS_LATEST), ...nogp, ...tied], "equal margins tie at a real zero; a lead over a gap is blocked, never zero");
  });

  await t.test("a question about one company that asks for its peers is answered with the company and its peers, saved as auto-selected (#398)", async () => {
    const peerSet = [COMPANIES.QTRS, COMPANIES.OFFQ];
    await db.query(`update issuers set industry = 'Quarterly test filers' where issuer_id = any($1::uuid[])`, [peerSet]);
    try {
      const peers = { ...NO_ASKS, asks: new Set(["peers"] as const) };
      const { turnId, events } = await chatHarness(pool, { model: null, readQuestion: reading(peers), resolveMention: resolve, researchScope: scoped }).run({ ...base, userIntent: "Revenue for QTRS" });
      const done = completed(events);
      assert.deepEqual(await results(done.message_id), [...slotted("a", QTRS_LATEST), ...slotted("b", OFFQ_LATEST), ...QTRS_OVER_OFFQ]);
      const { rows: [message] } = await db.query(`select blocks, research_scope from chat_messages where message_id = $1`, [done.message_id]);
      assert.deepEqual([message.research_scope.companies, message.research_scope.peers], [[{ issuer_id: COMPANIES.QTRS, label: "QTRS" }, { issuer_id: COMPANIES.OFFQ }], true]);
      assert.equal(message.blocks.length, 1, "no note names peers the question did not name");
      const { rows: [planned] } = await db.query(
        `select p.plan->'interpretation'->>'text' as text from financial_runs r join financial_plans p on p.plan_id = r.plan_id where r.request_key = $1`,
        [turnId],
      );
      assert.match(planned.text, /^Subjects: QTRS Corp \(issuer:[^)]+\), OFFQ Corp \(issuer:/u, "a peer is named by its legal name");
    } finally {
      await db.query(`update issuers set industry = null where issuer_id = any($1::uuid[])`, [peerSet]);
    }
  });

  await t.test("peers the planner leaves out are named in the answer's note (#398)", async () => {
    const model = revenueModel(["QTRS", "NOGP"]);
    const done = completed((await chatHarness(pool, { model, readQuestion: reading({ ...NO_ASKS, asks: new Set(["peers"]) }), resolveMention: resolve }).run({ ...base, userIntent: "Compare revenue for QTRS and NOGP with their peers" })).events);
    const { rows: [message] } = await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id]);
    assert.deepEqual([model.calls, message.blocks[1]?.segments?.[0]?.text], [1, "Not covered by this answer: peers the question did not name."]);
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
    const window = (period: string, highest: string, lowest: string) => [
      ["out_revenue_highest", period, "verified", `${highest} has the highest revenue of the 6 of 8 quarters ranked`],
      ["out_revenue_lowest", period, "verified", `${lowest} has the lowest revenue of the 6 of 8 quarters ranked`],
    ];
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
      ...QTRS_OVERVIEW.slice(14, 16),
      blocked("out_revenue_growth_qoq_fy2022_q4", "Q4 FY2022 vs Q3 FY2022"),
      blocked("out_revenue_growth_qoq_fy2023_q1", "Q1 FY2023 vs Q4 FY2022"),
      ...QTRS_OVERVIEW.slice(18, 20),
      blocked("out_revenue_growth_qoq", "Q4 FY2023 vs Q3 FY2023"),
      blocked("out_revenue_growth_yoy", "Q4 FY2023 vs Q4 FY2022"),
      ...window("Q1 FY2022 to Q4 FY2023", "Q3 FY2023", "Q1 FY2022"),
    ], "the latest quarter is the derived fourth quarter, not the third before it, and the window ranks the quarters with a value");
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
      QTRS_OVERVIEW[15]!,
      blocked("out_revenue_growth_qoq_fy2022_q4", "Q4 FY2022 vs Q3 FY2022"),
      blocked("out_revenue_growth_qoq_fy2023_q1", "Q1 FY2023 vs Q4 FY2022"),
      ...QTRS_OVERVIEW.slice(18, 20),
      blocked("out_revenue_growth_qoq_fy2023_q4", "Q4 FY2023 vs Q3 FY2023"),
      blocked("out_revenue_growth_qoq", "Q1 FY2024 vs Q4 FY2023"),
      ["out_revenue_growth_yoy", "Q1 FY2024 vs Q1 FY2023", "verified", "100.00%"],
      ...window("Q2 FY2022 to Q1 FY2024", "Q1 FY2024", "Q2 FY2022"),
    ], "growth after a first quarter compares with the fourth quarter before it and the first a year earlier");
  });
});
