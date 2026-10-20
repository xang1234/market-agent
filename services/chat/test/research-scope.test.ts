import test from "node:test";
import assert from "node:assert/strict";

import { facetWords, parseResearchScope, resolveResearchScope, type ResearchScope, type ScopeProposal } from "../src/research-scope.ts";
import { proposal } from "./scope-fixtures.ts";

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };
const AAPL = { issuer_id: "60000000-0000-4000-8000-000000000003", label: "AAPL" };
const AS_OF = "2026-09-01T00:00:00.000Z";
const LATER = "2026-09-02T00:00:00.000Z";
const INCOME = { metric_key: "income_statement", label: "Revenue, profit and margins", available: true };

const fresh = (question: string, read: ScopeProposal | null, companies: ResearchScope["companies"] = [NVDA]) =>
  resolveResearchScope({ question, companies, prior: null, asOf: AS_OF, proposal: read });
const followUp = (question: string, read: ScopeProposal | null, prior: ResearchScope, companies = prior.companies, asOf = LATER) =>
  resolveResearchScope({ question, companies, prior, asOf, proposal: read });

test("the route follows from what the turn asks for and the companies it covers", () => {
  const cases: Array<[ScopeProposal, ResearchScope["companies"], ResearchScope["route"]]> = [
    [proposal(), [NVDA], "latest_quarter"],
    [proposal({ asks: ["margins", "margin_trend"], metrics: ["income_statement"] }), [NVDA], "trend"],
    [proposal({ asks: ["margins"], metrics: ["income_statement"] }), [NVDA], "derived_margin"],
    [proposal({ metrics: ["ebitda"] }), [AMD], "unavailable_metric"],
    // Cash flow, the balance sheet and EPS, for one company.
    [proposal({ metrics: ["free_cash_flow"] }), [AMD], "statements"],
    [proposal({ metrics: ["free_cash_flow", "ebitda"] }), [AMD], "statements"],
    // Statement figures are one company at a time: a comparison asking only for
    // them is a named gap, with no income figures in their place.
    [proposal({ metrics: ["free_cash_flow"] }), [NVDA, AMD], "unavailable_metric"],
    // A request that is partly available takes its usual route; the rest is a named gap.
    [proposal({ metrics: ["income_statement", "free_cash_flow"] }), [NVDA, AMD], "comparison"],
    [proposal({ metrics: ["income_statement", "free_cash_flow"] }), [NVDA], "latest_quarter"],
    // A named metric's margin is part of that metric, not a margin question.
    [proposal({ metrics: [{ metric: "free_cash_flow", qualifier: "margin" }] }), [AMD], "unavailable_metric"],
    [proposal({ asks: ["margins"], metrics: ["ebitda", "income_statement"] }), [AMD], "derived_margin"],
    [proposal({ asks: ["segments"], metrics: ["income_statement"] }), [NVDA], "segments"],
    [proposal(), [NVDA, AMD], "comparison"],
    [proposal({ asks: ["peers"] }), [NVDA], "comparison"],
    [proposal(), [], "unknown"],
  ];
  for (const [read, companies, route] of cases) {
    assert.equal(fresh("", read, companies).route, route, JSON.stringify({ ...read, asks: [...read.asks], companies: companies.length }));
  }
});

test("a fresh question records what it asks for and inherits nothing", () => {
  const read = proposal({ metrics: ["income_statement"], items: ["revenue"] });
  assert.deepEqual(fresh("Compare NVDA's and AMD's fiscal 2025 revenue YTD", read, [NVDA, AMD]), {
    route: "comparison",
    reads: "comparison",
    companies: [NVDA, AMD],
    peers: false,
    segments: false,
    margin_trend: false,
    margins: false,
    metrics: [INCOME],
    fiscal_year: 2025,
    fiscal_quarter: null,
    price_window: { kind: "ytd", cutoff: AS_OF },
    benchmark: false,
    income_items: ["revenue"],
    inherited: [],
  });
});

test("guidance asked for is recorded, and the items the question names", () => {
  assert.deepEqual(fresh("What revenue guidance did NVDA give?", proposal({ asks: ["guidance"], metrics: ["income_statement"], items: ["revenue"] })), {
    route: "latest_quarter",
    reads: "latest_quarter",
    companies: [NVDA],
    peers: false,
    segments: false,
    margin_trend: false,
    margins: false,
    metrics: [INCOME],
    fiscal_year: null,
    fiscal_quarter: null,
    price_window: null,
    benchmark: false,
    guidance: true,
    income_items: ["revenue"],
    inherited: [],
  });
});

test("guidance is kept by a follow-up until one turns it off", () => {
  const asked = fresh("What revenue guidance did NVDA give?", proposal({ asks: ["guidance"], metrics: ["income_statement"], items: ["revenue"] }));
  assert.equal(followUp("How about EPS?", proposal({ metrics: ["eps_diluted"] }), asked).guidance, true);
  const grossMargin = { asks: ["margins"], metrics: ["income_statement"], items: ["gross_margin"] } as const;
  assert.deepEqual(followUp("And its gross margin, without guidance?", proposal({ ...grossMargin, off: ["guidance"] }), asked), {
    route: "derived_margin",
    reads: "derived_margin",
    companies: [NVDA],
    peers: false,
    segments: false,
    margin_trend: false,
    margins: true,
    metrics: [INCOME],
    fiscal_year: null,
    fiscal_quarter: null,
    price_window: null,
    benchmark: false,
    income_items: ["gross_margin"],
    inherited: [],
  });
  // Kept, the follow-up names its own items.
  assert.deepEqual(followUp("And its gross margin?", proposal(grossMargin), asked).income_items, ["gross_margin"]);
  // An evidence follow-up re-reads the answer it asks about, guidance and items too,
  // unless it turns guidance off.
  const sources = followUp("What are your sources?", proposal({ asks: ["evidence"] }), asked);
  assert.deepEqual([sources.route, sources.guidance, sources.income_items], ["evidence_followup", true, ["revenue"]]);
  const without = followUp("What are your sources, but without guidance?", proposal({ asks: ["evidence"], off: ["guidance"] }), asked);
  assert.deepEqual([without.route, without.guidance], ["evidence_followup", undefined]);
  // A cause asked for is kept as guidance is.
  const both = fresh("Why did NVDA's revenue decline, and what guidance did management give?", proposal({ asks: ["explains", "guidance"] }));
  const howAbout = followUp("How about operating income?", proposal({ metrics: ["income_statement"], items: ["operating_income"] }), both);
  assert.deepEqual([howAbout.guidance, howAbout.explains], [true, true]);
  // One that names no items, and keeps the metrics it asked about, keeps its items too.
  const why = followUp("Why?", proposal({ asks: ["explains"] }), fresh("How did NVDA's operating income change?", proposal({ metrics: ["income_statement"], items: ["operating_income"] })));
  assert.deepEqual([why.inherited, why.income_items], [["metrics"], ["operating_income"]]);
  // Read back from a saved answer.
  const saved = JSON.parse(JSON.stringify(asked));
  assert.deepEqual(parseResearchScope(saved), { ...saved, inherited: [] });
});

test("a follow-up that drops the segments clears them, keeps the rest, and they stay off", () => {
  const prior = fresh(
    "Compare NVDA with AMD segments, margin trends and free cash flow, fiscal 2025, YTD",
    proposal({ asks: ["segments", "margins", "margin_trend"], metrics: ["income_statement", "free_cash_flow"] }),
    [NVDA, AMD],
  );
  const dropped = followUp("Same again without segments", proposal({ off: ["segments"] }), prior);
  assert.deepEqual(dropped, {
    route: "comparison",
    reads: "comparison",
    companies: [NVDA, AMD],
    peers: false,
    segments: false,
    margin_trend: true,
    margins: true,
    metrics: [INCOME, { metric_key: "free_cash_flow", label: "Free cash flow", available: true }],
    fiscal_year: 2025,
    fiscal_quarter: null,
    price_window: { kind: "ytd", cutoff: AS_OF },
    benchmark: false,
    inherited: ["margin_trend", "metrics", "fiscal_year", "price_window"],
  });
  assert.equal(followUp("And now?", proposal(), dropped).segments, false);
  // Each other field turned off is cleared the same way.
  assert.equal(followUp("Drop the YTD window", proposal({ off: ["price_window"] }), prior).price_window, null);
  const noMargins = followUp("Remove the margins", proposal({ off: ["margins"] }), prior);
  assert.deepEqual([noMargins.margin_trend, noMargins.margins], [false, false]);
  assert.deepEqual(followUp("Leave out free cash flow", proposal({ offMetrics: ["free_cash_flow"] }), prior).metrics, [INCOME]);
});

test("a period turned off is not read from its words", () => {
  const prior = fresh("Why did AMD's operating margin turn negative in Q2 fiscal 2025?", proposal(), [AMD]);
  assert.deepEqual([prior.fiscal_year, prior.fiscal_quarter], [2025, { fiscal_year: 2025, fiscal_period: "Q2" }]);
  const noYear = followUp("Forget fiscal 2025", proposal({ off: ["fiscal_year"] }), prior);
  assert.deepEqual([noYear.fiscal_year, noYear.fiscal_quarter], [null, { fiscal_year: 2025, fiscal_period: "Q2" }]);
  const noQuarter = followUp("Drop Q2 2025", proposal({ off: ["fiscal_quarter"] }), prior);
  assert.deepEqual([noQuarter.fiscal_year, noQuarter.fiscal_quarter], [2025, null]);
});

test("a field turned off is not also asked for", () => {
  const prior = fresh("Break down NVDA's revenue by segment", proposal({ asks: ["segments"] }));
  const next = followUp("Show NVDA without the segments", proposal({ asks: ["segments"], off: ["segments"] }), prior);
  assert.deepEqual([next.segments, next.route], [false, "latest_quarter"]);
  // A metric the turn turns off stays off, even when the model names it too.
  const statements = fresh("Show NVDA's operating cash flow and capex", proposal({ metrics: ["operating_cash_flow", "capex"] }));
  const dropped = followUp("Drop capex", proposal({ metrics: ["capex"], offMetrics: ["capex"] }), statements);
  assert.deepEqual(dropped.metrics.map((metric) => metric.metric_key), ["operating_cash_flow"]);
});

test("a facet both asked for and turned off routes as if never asked (#378 review)", () => {
  const without = (metric: string) =>
    fresh(`Show NVDA's ${metric} without segments`, proposal({ asks: ["segments"], off: ["segments"], metrics: [metric] }));
  assert.deepEqual([without("ebitda").route, without("ebitda").segments], ["unavailable_metric", false]);
  assert.deepEqual([without("eps_diluted").route, without("eps_diluted").segments], ["statements", false]);
  const quarter = fresh("Why did AMD's operating margin turn negative in Q2 2025?", proposal(), [AMD]);
  const notLatest = followUp("Not the latest quarter", proposal({ asks: ["latest_quarter"], off: ["latest_quarter"] }), quarter);
  assert.deepEqual([notLatest.fiscal_year, notLatest.fiscal_quarter], [2025, { fiscal_year: 2025, fiscal_period: "Q2" }]);
  const noEvidence = followUp("No sources", proposal({ asks: ["evidence"], off: ["evidence"] }), quarter);
  assert.deepEqual([noEvidence.route, noEvidence.reads], ["latest_quarter", "latest_quarter"]);
});

test("turning off the margin trend keeps the margins asked for (#378 eval)", () => {
  const prior = fresh("Why did AMD's operating margin turn negative in Q2 2025?", proposal({ asks: ["explains", "margins"], metrics: ["income_statement"] }), [AMD]);
  const same = followUp("Same margins, without quarter-over-quarter growth", proposal({ asks: ["margins"], off: ["margin_trend"] }), prior);
  assert.deepEqual([same.route, same.margins, same.margin_trend], ["derived_margin", true, false]);
  const none = followUp("Remove the margins", proposal({ asks: ["margin_trend"], off: ["margins"] }), prior);
  assert.deepEqual([none.route, none.margins, none.margin_trend], ["latest_quarter", false, false]);
});

test("margins asked with no metric read the income statement, not a kept cash flow (#378 eval)", () => {
  const fcf = fresh("What is AMD's free cash flow?", proposal({ metrics: ["free_cash_flow"] }), [AMD]);
  const profitability = followUp("What is its profitability?", proposal({ asks: ["margins"] }), fcf);
  assert.deepEqual([profitability.route, profitability.metrics, profitability.inherited], ["derived_margin", [INCOME], []]);
  assert.deepEqual(fresh("What is NVDA's gross margin?", proposal({ asks: ["margins"], items: ["gross_margin"] })).metrics, [INCOME]);
  // Kept income figures are the margins' own: a kept cash flow beside them stays.
  const both = fresh("NVDA revenue and free cash flow", proposal({ metrics: ["income_statement", "free_cash_flow"] }));
  assert.deepEqual(followUp("And its margins?", proposal({ asks: ["margins"] }), both).metrics, both.metrics);
});

test("an evidence follow-up re-reads what the previous answer read, over its companies", () => {
  const prior = fresh("Break down AMD's revenue by segment", proposal({ asks: ["segments"], metrics: ["income_statement"], items: ["revenue"] }), [AMD]);
  assert.deepEqual(followUp("Show the evidence", proposal({ asks: ["evidence"] }), prior), {
    route: "evidence_followup",
    reads: "segments",
    companies: [AMD],
    peers: false,
    segments: true,
    margin_trend: false,
    margins: false,
    metrics: [INCOME],
    fiscal_year: null,
    fiscal_quarter: null,
    price_window: null,
    benchmark: false,
    income_items: ["revenue"],
    inherited: ["segments", "metrics"],
  });
  const evidence = proposal({ asks: ["evidence"] });
  assert.equal(followUp("Show the evidence", evidence, fresh("What is AMD's EBITDA?", proposal({ metrics: ["ebitda"] }), [AMD])).reads, "unavailable_metric");
  assert.equal(followUp("Show the evidence", evidence, fresh("What is AMD's free cash flow?", proposal({ metrics: ["free_cash_flow"] }), [AMD])).reads, "statements");
  // About one compared company: the whole comparison.
  const compared = fresh("Compare NVDA with AMD", proposal(), [NVDA, AMD]);
  const one = followUp("Show the evidence for NVDA", evidence, compared, [NVDA]);
  assert.deepEqual([one.route, one.reads, one.companies], ["evidence_followup", "comparison", [NVDA, AMD]]);
  // About a company the previous answer did not cover, or with no previous answer: not one.
  assert.equal(followUp("Show the evidence for AAPL too", evidence, compared, [NVDA, AMD, AAPL]).route, "comparison");
  assert.equal(fresh("Show the evidence for NVDA", evidence).route, "latest_quarter");
});

test("a margin trend asked for routes to the trend", () => {
  const read = proposal({ asks: ["margins", "margin_trend"], metrics: ["income_statement"], items: ["operating_income"] });
  assert.deepEqual(fresh("How have AMD's operating margins trended over the last eight quarters?", read, [AMD]), {
    route: "trend",
    reads: "trend",
    companies: [AMD],
    peers: false,
    segments: false,
    margin_trend: true,
    margins: true,
    metrics: [INCOME],
    fiscal_year: null,
    fiscal_quarter: null,
    price_window: null,
    benchmark: false,
    income_items: ["operating_income"],
    inherited: [],
  });
});

test("with no proposal, a follow-up keeps the previous scope whole", () => {
  const prior = fresh(
    "Break down NVDA's segments and margin trend for fiscal 2025 YTD: why, and what guidance?",
    proposal({ asks: ["segments", "margins", "margin_trend", "guidance", "explains"], metrics: ["income_statement"], items: ["revenue"] }),
  );
  assert.deepEqual(followUp("And then?", null, prior), {
    ...prior,
    inherited: ["segments", "margin_trend", "metrics", "fiscal_year", "price_window"],
  });
});

test("with no proposal, a follow-up reads what the previous answer read (#378 review)", () => {
  const segments = fresh("Show NVDA's segments and EBITDA", proposal({ asks: ["segments"], metrics: ["ebitda"] }));
  assert.equal(segments.reads, "segments");
  assert.deepEqual(followUp("And then?", null, segments), { ...segments, inherited: ["segments", "metrics"] });
  const trend = fresh("NVDA's margin trend and free cash flow", proposal({ asks: ["margin_trend"], metrics: ["free_cash_flow"] }));
  assert.equal(trend.route, "trend");
  assert.deepEqual(followUp("And then?", null, trend), { ...trend, inherited: ["margin_trend", "metrics"] });
  const margin = fresh("What is NVDA's gross margin?", proposal({ asks: ["margins"], metrics: ["income_statement"] }));
  assert.deepEqual(followUp("And then?", null, margin), { ...margin, inherited: ["metrics"] });
  // Explicit period tokens still apply.
  assert.deepEqual(followUp("And for FY2025?", null, segments), { ...segments, fiscal_year: 2025, inherited: ["segments", "metrics"] });
  // Its companies are the turn's: one company added to a single company's answer is compared.
  assert.equal(followUp("And then?", null, margin, [NVDA, AMD]).route, "comparison");
  // The engine's answer is not re-read here: its kept figures are.
  const engine: ResearchScope = { ...fresh("", proposal({ metrics: ["eps_diluted"] })), route: "financial_answer", reads: "financial_answer" };
  assert.deepEqual([followUp("And then?", null, engine).route, followUp("And then?", null, engine).reads], ["statements", "statements"]);
});

test("with no proposal, a follow-up keeps the margins, and a company added routes them as a comparison (#378 review)", () => {
  const margin = fresh("What is NVDA's gross margin?", proposal({ asks: ["margins"], metrics: ["income_statement"] }));
  assert.deepEqual(followUp("Add AMD", null, margin, [NVDA, AMD]), {
    ...margin,
    route: "comparison",
    reads: "comparison",
    companies: [NVDA, AMD],
    inherited: ["metrics"],
  });
  // Routed by the margins kept, as margins asked on a comparison are: not as the gap alone.
  const ebitda = fresh("NVDA's margins and EBITDA", proposal({ asks: ["margins"], metrics: ["ebitda"] }));
  assert.equal(fresh("NVDA and AMD's margins and EBITDA", proposal({ asks: ["margins"], metrics: ["ebitda"] }), [NVDA, AMD]).route, "comparison");
  assert.deepEqual(
    [followUp("Add AMD", null, ebitda, [NVDA, AMD]).route, followUp("Add AMD", null, ebitda, [NVDA, AMD]).margins],
    ["comparison", true],
  );
  // The items it named are kept with it, metrics or none.
  const why = fresh("What drove NVDA's revenue?", proposal({ asks: ["explains"], items: ["revenue"] }));
  assert.deepEqual(followUp("And then?", null, why), { ...why, inherited: [] });
});

test("with no proposal, a fresh question gets the plain answer for its companies and period tokens", () => {
  assert.deepEqual(fresh("How does NVDA stack up against AMD on margins and segments?", null, [NVDA, AMD]), {
    route: "comparison",
    reads: "comparison",
    companies: [NVDA, AMD],
    peers: false,
    segments: false,
    margin_trend: false,
    margins: false,
    metrics: [],
    fiscal_year: null,
    fiscal_quarter: null,
    price_window: null,
    benchmark: false,
    inherited: [],
  });
  const year = fresh("NVDA revenue FY2025", null);
  assert.deepEqual([year.route, year.fiscal_year], ["latest_quarter", 2025]);
  assert.deepEqual(fresh("NVDA YTD", null).price_window, { kind: "ytd", cutoff: AS_OF });
});

test("a follow-up that names a period or window replaces only that field", () => {
  const prior = fresh("Compare NVDA with AMD fiscal 2025 YTD", proposal(), [NVDA, AMD]);
  const year = followUp("Now for fiscal 2026", proposal(), prior);
  assert.deepEqual([year.fiscal_year, year.price_window, year.inherited], [2026, { kind: "ytd", cutoff: AS_OF }, ["price_window"]]);
  // A window asked for again is cut off at the new turn.
  const window = followUp("And YTD now?", proposal(), fresh("Compare NVDA with AMD YTD", proposal(), [NVDA, AMD]));
  assert.deepEqual([window.price_window, window.inherited], [{ kind: "ytd", cutoff: LATER }, []]);
});

test("a follow-up naming another metric replaces the metrics; one naming none keeps them", () => {
  const prior = fresh("What is AMD's EBITDA?", proposal({ metrics: ["ebitda"] }), [AMD]);
  const why = followUp("And why is that?", proposal({ asks: ["explains"] }), prior);
  assert.deepEqual([why.route, why.inherited], ["unavailable_metric", ["metrics"]]);
  const revenue = followUp("What about its revenue?", proposal({ metrics: ["income_statement"], items: ["revenue"] }), prior);
  assert.deepEqual([revenue.route, revenue.metrics], ["latest_quarter", [INCOME]]);
});

test("an inherited gap, or one asked beside something it can show, does not stop the turn reading", () => {
  const prior = fresh("What is AMD's free cash flow?", proposal({ metrics: ["free_cash_flow"] }), [AMD]);
  const ytd = followUp("Also compare its YTD stock performance with NVDA", proposal({ asks: ["price_window"] }), prior, [AMD, NVDA]);
  assert.deepEqual([ytd.route, ytd.metrics.map((metric) => metric.metric_key)], ["comparison", ["free_cash_flow"]]);
  assert.equal(followUp("What is its profitability?", proposal({ asks: ["margins"], metrics: ["income_statement"] }), prior).route, "derived_margin");
  assert.equal(fresh("What is AMD's free cash flow YTD versus NVDA?", proposal({ metrics: ["free_cash_flow"] }), [AMD, NVDA]).route, "comparison");
});

test("a statement metric asked year to date is a named gap; a comparison still charts the window", () => {
  const ytdCashFlow = proposal({ metrics: [{ metric: "free_cash_flow", qualifier: "ytd" }] });
  const single = fresh("What is NVDA's free cash flow YTD?", ytdCashFlow);
  assert.deepEqual([single.route, single.metrics], ["unavailable_metric", [{ metric_key: "free_cash_flow_ytd", label: "Free cash flow year to date", available: false }]]);
  assert.equal(fresh("Compare NVDA and AMD free cash flow YTD", ytdCashFlow, [NVDA, AMD]).route, "comparison");
  // A YTD that qualifies something else leaves the statement metric as asked.
  assert.equal(fresh("Show NVDA EPS and YTD stock return", proposal({ metrics: ["eps_diluted"] })).route, "statements");
  // A gap with a window: one company's answer has no price chart, a comparison does.
  assert.equal(fresh("What was AMD's EBITDA YTD?", proposal({ metrics: ["ebitda"] }), [AMD]).route, "unavailable_metric");
  assert.equal(fresh("What is AMD's EBITDA YTD versus NVDA?", proposal({ metrics: ["ebitda"] }), [AMD, NVDA]).route, "comparison");
});

test("metrics the financial engine served are not gaps", () => {
  const scope = resolveResearchScope({ question: "What was NVDA's EPS?", companies: [NVDA], prior: null, asOf: AS_OF, served: true, proposal: proposal({ metrics: ["eps_diluted"] }) });
  assert.deepEqual([scope.metrics.map((metric) => metric.available), scope.reads], [[true], "financial_answer"]);
  // A follow-up asking for its evidence re-reads that answer; any other reads its own route.
  assert.equal(followUp("Show the evidence", proposal({ asks: ["evidence"] }), scope).reads, "financial_answer");
  assert.equal(followUp("Compare it with AMD", proposal(), scope, [NVDA, AMD]).reads, "comparison");
});

test("segments asked with any margin record the margin, so both are read", () => {
  const scope = fresh("Break down AMD's revenue by segment and show its gross margin", proposal({ asks: ["segments", "margins"], metrics: ["income_statement"] }), [AMD]);
  assert.deepEqual([scope.reads, scope.margins], ["segments", true]);
  const prior = fresh("Break down AMD's revenue by segment", proposal({ asks: ["segments"] }), [AMD]);
  assert.equal(prior.margins, false);
  assert.equal(followUp("What is its gross margin?", proposal({ asks: ["margins"], metrics: ["income_statement"] }), prior).margins, true);
});

test("dropping the balance sheet drops its items, however they were kept", () => {
  const balance = fresh("Show NVDA's balance sheet and EPS", proposal({ metrics: ["balance_sheet", "eps_diluted"] }));
  const withoutAssets = followUp("Drop total assets", proposal({ offMetrics: ["total_assets"] }), balance);
  assert.deepEqual(withoutAssets.metrics.map((metric) => metric.metric_key), ["cash_and_equivalents", "total_liabilities", "total_equity", "eps_diluted"]);
  const withoutBalance = followUp("Drop the balance sheet", proposal({ offMetrics: ["balance_sheet"] }), withoutAssets);
  assert.deepEqual(withoutBalance.metrics.map((metric) => metric.metric_key), ["eps_diluted"]);
});

test("a benchmark is a named gap the next turns keep until it is turned off", () => {
  const first = fresh("Compare NVDA and AMD YTD against the S&P 500", proposal({ asks: ["benchmark"] }), [NVDA, AMD]);
  assert.deepEqual([first.benchmark, first.route], [true, "comparison"]);
  const table = followUp("Show it as a table", proposal(), first);
  assert.deepEqual([table.benchmark, table.inherited.includes("benchmark")], [true, true]);
  assert.equal(followUp("Drop the benchmark", proposal({ off: ["benchmark"] }), table).benchmark, false);
  // Saved before benchmarks were recorded: none.
  const { benchmark: _benchmark, ...old } = JSON.parse(JSON.stringify(first));
  assert.equal(parseResearchScope(old)?.benchmark, false);
  assert.equal(parseResearchScope(JSON.parse(JSON.stringify(first)))?.benchmark, true);
});

test("a named fiscal quarter is scoped, kept by a follow-up and can be turned off (#290)", () => {
  const asked = fresh("Why did AMD's operating margin turn negative in Q2 2025?", proposal({ asks: ["explains", "margins"], metrics: ["income_statement"] }), [AMD]);
  assert.deepEqual([asked.fiscal_quarter, asked.route], [{ fiscal_year: 2025, fiscal_period: "Q2" }, "derived_margin"]);
  const next = followUp("And its gross margin?", proposal({ asks: ["margins"], metrics: ["income_statement"] }), asked);
  assert.deepEqual([next.fiscal_quarter, next.inherited.includes("fiscal_quarter")], [{ fiscal_year: 2025, fiscal_period: "Q2" }, true]);
  assert.equal(followUp("Drop the quarter and show the latest", proposal({ asks: ["latest_quarter"], off: ["fiscal_quarter"] }), asked).fiscal_quarter, null);
  // Saved and read back; a scope saved before quarters were recorded has none.
  assert.deepEqual(parseResearchScope(JSON.parse(JSON.stringify(asked)))!.fiscal_quarter, asked.fiscal_quarter);
  const { fiscal_quarter: _q, ...older } = asked;
  assert.equal(parseResearchScope(older)!.fiscal_quarter, null);
});

test("asking for the latest quarter clears an inherited named quarter and the year it named (#292 review)", () => {
  const latest = proposal({ asks: ["latest_quarter"] });
  const quarter = fresh("Why did AMD's operating margin turn negative in Q2 2025?", proposal(), [AMD]);
  assert.equal(followUp("Now show the latest quarter", latest, quarter).fiscal_quarter, null);
  const eps = fresh("What was AMD's EPS in Q1 fiscal 2025?", proposal({ metrics: ["eps_diluted"] }), [AMD]);
  assert.equal(eps.fiscal_year, 2025);
  const cleared = followUp("Show the latest quarter and EPS", latest, eps);
  assert.deepEqual([cleared.fiscal_quarter, cleared.fiscal_year], [null, null]);
});

test("a follow-up naming part of a period updates the inherited quarter, never keeps the old one (#292 review)", () => {
  const asked = fresh("Why did AMD's operating margin turn negative in Q2 2025?", proposal(), [AMD]);
  const next = (question: string) => followUp(question, proposal(), asked);
  // A quarter without a year keeps the inherited year.
  assert.deepEqual(next("Now Q3").fiscal_quarter, { fiscal_year: 2025, fiscal_period: "Q3" });
  assert.deepEqual(next("What about the third quarter?").fiscal_quarter, { fiscal_year: 2025, fiscal_period: "Q3" });
  // A fiscal year without a quarter clears it: the year's figures, not Q2 2025's.
  assert.deepEqual([next("Now for fiscal 2026").fiscal_quarter, next("Now for fiscal 2026").fiscal_year], [null, 2026]);
  // Nothing about the period: the quarter is kept.
  assert.deepEqual(next("And its gross margin?").fiscal_quarter, { fiscal_year: 2025, fiscal_period: "Q2" });
  // A new complete quarter sets the year to its own; one written year first too.
  assert.deepEqual([next("What about EPS in Q2 2026?").fiscal_quarter, next("What about EPS in Q2 2026?").fiscal_year], [{ fiscal_year: 2026, fiscal_period: "Q2" }, 2026]);
  assert.deepEqual(next("Now FY2026 Q3").fiscal_quarter, { fiscal_year: 2026, fiscal_period: "Q3" });
  // A quarter and a fiscal year written apart are paired.
  assert.deepEqual(next("Now Q3, fiscal 2026").fiscal_quarter, { fiscal_year: 2026, fiscal_period: "Q3" });
  assert.deepEqual(fresh("AMD revenue in Q3, FY2026", proposal(), [AMD]).fiscal_quarter, { fiscal_year: 2026, fiscal_period: "Q3" });
  // A quarter named alone takes an inherited fiscal year when no quarter was inherited.
  const year = fresh("Show AMD's fiscal 2025 EPS", proposal({ metrics: ["eps_diluted"] }), [AMD]);
  assert.deepEqual(followUp("Now show revenue in Q3", proposal(), year).fiscal_quarter, { fiscal_year: 2025, fiscal_period: "Q3" });
});

test("a named quarter's year is the fiscal year a comparison uses (#292 review)", () => {
  const compared = fresh("Compare AMD and NVDA revenue in Q2 2025", proposal(), [AMD, NVDA]);
  assert.deepEqual([compared.fiscal_quarter, compared.fiscal_year], [{ fiscal_year: 2025, fiscal_period: "Q2" }, 2025]);
});

test("a saved scope reads back; anything else starts fresh", () => {
  const saved = JSON.parse(JSON.stringify(fresh("Compare NVDA with AMD YTD", proposal(), [NVDA, AMD])));
  assert.deepEqual(parseResearchScope(saved), { ...saved, inherited: [] });
  for (const value of [
    null,
    "scope",
    [],
    { ...saved, peers: "yes" },
    { ...saved, fiscal_year: 2025.5 },
    { ...saved, price_window: { kind: "ytd", cutoff: "not a date" } },
    { ...saved, price_window: { kind: "1y", cutoff: AS_OF } },
    { ...saved, companies: [null] },
    { ...saved, companies: [{ issuer_id: NVDA.issuer_id, label: 7 }] },
    { ...saved, companies: "NVDA" },
    { ...saved, metrics: [{ metric_key: "free_cash_flow" }] },
  ]) {
    assert.equal(parseResearchScope(value), null, JSON.stringify(value));
  }
  // Saved before metrics or reads were recorded: none, and the route.
  const { metrics: _metrics, reads: _reads, ...older } = saved;
  assert.deepEqual([parseResearchScope(older)?.metrics, parseResearchScope(older)?.reads], [[], "comparison"]);
});

test("the words of a whole catalog metric or facet name are not companies to drop", () => {
  assert.deepEqual([...facetWords("FCF, OCF, CAPEX, EPS, DEBT and PEERS")], ["FCF", "OCF", "CAPEX", "EPS", "DEBT", "PEERS"]);
  assert.deepEqual([...facetWords("AMD, the FREE CASH FLOW and STOCKHOLDERS' EQUITY")], ["FREE", "CASH", "FLOW", "STOCKHOLDERS", "EQUITY"]);
  // A word of a longer name alone is not that name: NET (net income) is a ticker.
  assert.deepEqual([...facetWords("XYZQ AMD NOW NET CASH TOTAL FLOW TREND")], []);
});
