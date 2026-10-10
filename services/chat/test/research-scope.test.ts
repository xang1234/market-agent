import test from "node:test";
import assert from "node:assert/strict";

import { parseResearchScope, requestedMetrics, resolveResearchScope, type ResearchScope } from "../src/research-scope.ts";

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };
const AS_OF = "2026-09-01T00:00:00.000Z";

const fresh = (question: string, companies: ResearchScope["companies"] = [NVDA]) =>
  resolveResearchScope({ question, companies, prior: null, asOf: AS_OF });

test("each recurring question takes its own route", () => {
  const cases: Array<[string, ResearchScope["companies"], ResearchScope["route"]]> = [
    ["Analyze NVDA's latest quarter.", [NVDA], "latest_quarter"],
    ["How have NVDA's operating margins trended?", [NVDA], "trend"],
    ["What changed in NVDA's gross margin in Q1 fiscal 2026?", [NVDA], "trend"],
    ["What is NVDA's gross margin?", [NVDA], "derived_margin"],
    // A comparison with an earlier period needs the margins over time.
    ["Show AMD operating margins QoQ", [AMD], "trend"],
    ["Compare AMD gross margin with last quarter", [AMD], "trend"],
    ["What is AMD's free cash flow?", [AMD], "unavailable_metric"],
    // A request that is partly available takes its usual route; the rest is a named gap.
    ["Compare NVDA and AMD revenue and free cash flow", [NVDA, AMD], "comparison"],
    ["Break down NVDA's revenue by segment.", [NVDA], "segments"],
    ["Compare NVDA with AMD.", [NVDA, AMD], "comparison"],
    ["How does NVDA compare with its peers?", [NVDA], "comparison"],
    ["What is the market doing?", [], "unknown"],
  ];
  for (const [question, companies, route] of cases) {
    assert.equal(fresh(question, companies).route, route, question);
  }
});

test("a fresh question records what it asks for and inherits nothing", () => {
  assert.deepEqual(fresh("Compare NVDA's and AMD's fiscal 2025 revenue YTD", [NVDA, AMD]), {
    route: "comparison",
    reads: "comparison",
    companies: [NVDA, AMD],
    peers: false,
    segments: false,
    margin_trend: false,
    metrics: [{ metric_key: "income_statement", label: "Revenue, profit and margins", available: true }],
    fiscal_year: 2025,
    price_window: { kind: "ytd", cutoff: AS_OF },
    inherited: [],
  });
});

test("a follow-up keeps the window, year and facets it does not change", () => {
  const prior = fresh("Compare NVDA with AMD fiscal 2025 margin trends YTD", [NVDA, AMD]);
  const next = resolveResearchScope({
    question: "Explain the differences and show the evidence",
    companies: [NVDA, AMD],
    prior,
    asOf: "2026-09-02T00:00:00.000Z",
  });
  // The window keeps the cutoff it was charted at, not this turn's.
  assert.deepEqual(next.price_window, { kind: "ytd", cutoff: AS_OF });
  assert.equal(next.fiscal_year, 2025);
  assert.equal(next.margin_trend, true);
  assert.deepEqual(next.inherited, ["margin_trend", "metrics", "fiscal_year", "price_window"]);
  // It asks for the previous answer's evidence about the same companies.
  assert.equal(next.route, "evidence_followup");
});

test("a follow-up that names a field replaces only that field", () => {
  const prior = fresh("Compare NVDA with AMD fiscal 2025 YTD", [NVDA, AMD]);
  const next = resolveResearchScope({
    question: "Now for fiscal 2026",
    companies: [NVDA, AMD],
    prior,
    asOf: "2026-09-02T00:00:00.000Z",
  });
  assert.equal(next.fiscal_year, 2026);
  assert.deepEqual(next.price_window, { kind: "ytd", cutoff: AS_OF });
  assert.deepEqual(next.inherited, ["price_window"]);
});

test("a window asked for again is cut off at the new turn", () => {
  const prior = fresh("Compare NVDA with AMD YTD", [NVDA, AMD]);
  const later = "2026-09-02T00:00:00.000Z";
  const next = resolveResearchScope({ question: "And YTD now?", companies: [NVDA, AMD], prior, asOf: later });
  assert.deepEqual(next.price_window, { kind: "ytd", cutoff: later });
  assert.deepEqual(next.inherited, []);
});

test("a saved scope reads back; anything else starts fresh", () => {
  const saved = JSON.parse(JSON.stringify(fresh("Compare NVDA with AMD YTD", [NVDA, AMD])));
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
  ]) {
    assert.equal(parseResearchScope(value), null, JSON.stringify(value));
  }
});


test("each metric a question names is found once, the most specific first", () => {
  const keys = (question: string) => requestedMetrics(question).map((metric) => metric.metric_key);
  assert.deepEqual(keys("What is AMD's free cash flow?"), ["free_cash_flow"]);
  assert.deepEqual(keys("Show operating cash flow and capex"), ["operating_cash_flow", "capex"]);
  assert.deepEqual(keys("What are NVDA's earnings per share?"), ["eps_diluted"]);
  assert.deepEqual(keys("NVDA earnings and EPS"), ["eps_diluted", "income_statement"]);
  assert.deepEqual(keys("Compare NVDA with AMD"), []);
});

test("a follow-up naming another metric replaces the metrics; one naming none keeps them", () => {
  const prior = fresh("What is AMD's free cash flow?", [AMD]);
  const next = (question: string) => resolveResearchScope({ question, companies: [AMD], prior, asOf: AS_OF });
  assert.equal(next("And why is that?").route, "unavailable_metric");
  assert.deepEqual(next("And why is that?").inherited, ["metrics"]);
  const revenue = next("What about its revenue?");
  assert.equal(revenue.route, "latest_quarter");
  assert.deepEqual(revenue.metrics.map((metric) => metric.metric_key), ["income_statement"]);
});

test("asking for evidence about a company the previous answer did not cover is not an evidence follow-up", () => {
  const AAPL = { issuer_id: "60000000-0000-4000-8000-000000000003", label: "AAPL" };
  const prior = fresh("Compare NVDA with AMD", [NVDA, AMD]);
  const scope = resolveResearchScope({ question: "Show the evidence for AAPL too", companies: [NVDA, AMD, AAPL], prior, asOf: AS_OF });
  assert.equal(scope.route, "comparison");
  assert.equal(fresh("Show the evidence for NVDA").route, "latest_quarter", "no previous answer to show the evidence of");
});

test("a scope saved before metrics were recorded reads back with none; a malformed metric starts fresh", () => {
  const saved = JSON.parse(JSON.stringify(fresh("Compare NVDA with AMD", [NVDA, AMD])));
  delete saved.metrics;
  delete saved.reads;
  assert.deepEqual(parseResearchScope(saved)?.metrics, []);
  assert.equal(parseResearchScope(saved)?.reads, saved.route);
  assert.equal(parseResearchScope({ ...saved, metrics: [{ metric_key: "free_cash_flow" }] }), null);
});

test("a metric's context or qualifier is not another metric", () => {
  const keys = (question: string) => requestedMetrics(question).map((metric) => metric.metric_key);
  assert.deepEqual(keys("What did AMD say about free cash flow on its earnings call?"), ["free_cash_flow"]);
  assert.deepEqual(keys("What is AMD's free cash flow growth?"), ["free_cash_flow"]);
  assert.equal(fresh("What is AMD's free cash flow growth?", [AMD]).route, "unavailable_metric");
  assert.deepEqual(keys("What is its profitability?"), ["income_statement"]);
});

test("an inherited gap, or one asked beside something it can show, does not stop the turn reading", () => {
  const prior = fresh("What is AMD's free cash flow?", [AMD]);
  const next = (question: string, companies: ResearchScope["companies"]) =>
    resolveResearchScope({ question, companies, prior, asOf: AS_OF });
  const ytd = next("Also compare its YTD stock performance with NVDA", [AMD, NVDA]);
  assert.equal(ytd.route, "comparison");
  // The gap stays named.
  assert.deepEqual(ytd.metrics.map((metric) => metric.metric_key), ["free_cash_flow"]);
  assert.equal(next("What is its profitability?", [AMD]).route, "derived_margin");
  assert.equal(fresh("What is AMD's free cash flow YTD versus NVDA?", [AMD, NVDA]).route, "comparison");
});

test("an evidence follow-up re-reads what the previous answer read", () => {
  const prior = fresh("Break down AMD's revenue by segment", [AMD]);
  const scope = resolveResearchScope({ question: "Show the evidence", companies: [AMD], prior, asOf: AS_OF });
  assert.equal(scope.route, "evidence_followup");
  assert.equal(scope.reads, "segments");
  const gapPrior = fresh("What is AMD's free cash flow?", [AMD]);
  assert.equal(resolveResearchScope({ question: "Show the evidence", companies: [AMD], prior: gapPrior, asOf: AS_OF }).reads, "unavailable_metric");
});

test("metrics the financial engine served are not gaps", () => {
  const scope = resolveResearchScope({ question: "What was NVDA's EPS?", companies: [NVDA], prior: null, asOf: AS_OF, served: true });
  assert.deepEqual(scope.metrics.map((metric) => metric.available), [true]);
  assert.equal(scope.reads, "financial_answer");
  // A follow-up asking for its evidence re-reads that answer: neither a gap nor
  // another reader's figures in its place.
  const evidence = resolveResearchScope({ question: "Show the evidence", companies: [NVDA], prior: scope, asOf: AS_OF });
  assert.equal(evidence.reads, "financial_answer");
  // Any other follow-up reads its own route.
  assert.equal(resolveResearchScope({ question: "Compare it with AMD", companies: [NVDA, AMD], prior: scope, asOf: AS_OF }).reads, "comparison");
});

test("an evidence follow-up about one compared company re-reads the whole comparison", () => {
  const prior = fresh("Compare NVDA with AMD", [NVDA, AMD]);
  const scope = resolveResearchScope({ question: "Show the evidence for NVDA", companies: [NVDA], prior, asOf: AS_OF });
  assert.equal(scope.route, "evidence_followup");
  assert.equal(scope.reads, "comparison");
  assert.deepEqual(scope.companies, [NVDA, AMD]);
});

test("a company's sources of revenue are not a request for evidence", () => {
  const prior = fresh("Analyze NVDA");
  const ask = (question: string) => resolveResearchScope({ question, companies: [NVDA], prior, asOf: AS_OF }).route;
  assert.notEqual(ask("What are NVDA's revenue sources?"), "evidence_followup");
  assert.equal(ask("What are your sources?"), "evidence_followup");
  assert.equal(ask("Show the sources for this"), "evidence_followup");
});
