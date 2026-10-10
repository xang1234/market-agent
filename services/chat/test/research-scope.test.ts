import test from "node:test";
import assert from "node:assert/strict";

import { needsWindowFetch, parseResearchScope, resolveResearchScope, type ResearchScope } from "../src/research-scope.ts";

const NVDA = { issuer_id: "60000000-0000-4000-8000-000000000001", label: "NVDA" };
const AMD = { issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" };
const AS_OF = "2026-09-01T00:00:00.000Z";

const fresh = (question: string, companies: ResearchScope["companies"] = [NVDA]) =>
  resolveResearchScope({ question, companies, prior: null, asOf: AS_OF });

test("each recurring question takes its own route", () => {
  const cases: Array<[string, ResearchScope["companies"], ResearchScope["route"]]> = [
    ["Analyze NVDA's latest quarter.", [NVDA], "latest_quarter"],
    ["How have NVDA's operating margins trended?", [NVDA], "trend"],
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
    companies: [NVDA, AMD],
    peers: false,
    segments: false,
    margin_trend: false,
    fiscal_year: 2025,
    price_window: { kind: "ytd", cutoff: AS_OF },
    inherited: [],
  });
});

test("a follow-up keeps the window, year and facets it does not change", () => {
  const prior = fresh("Compare NVDA with AMD fiscal 2025 margins YTD", [NVDA, AMD]);
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
  assert.deepEqual(next.inherited, ["margin_trend", "fiscal_year", "price_window"]);
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
  ]) {
    assert.equal(parseResearchScope(value), null, JSON.stringify(value));
  }
});

test("a live turn fetches a window asked for now, or an inherited one only for an added company", () => {
  const AAPL = { issuer_id: "60000000-0000-4000-8000-000000000003", label: "AAPL" };
  const prior = fresh("Compare NVDA with AMD YTD", [NVDA, AMD]);
  const later = "2026-09-02T00:00:00.000Z";
  const next = (question: string, companies: ResearchScope["companies"]) =>
    resolveResearchScope({ question, companies, prior, asOf: later });
  assert.equal(needsWindowFetch(prior, null), true);
  assert.equal(needsWindowFetch(next("Explain the differences", [NVDA, AMD]), prior), false);
  assert.equal(needsWindowFetch(next("Add AAPL too", [NVDA, AMD, AAPL]), prior), true);
  assert.equal(needsWindowFetch(fresh("Compare NVDA with AMD", [NVDA, AMD]), null), false);
});
