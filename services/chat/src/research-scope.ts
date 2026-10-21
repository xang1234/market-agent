// A turn's research scope (#206): which route answers it, the companies it
// covers, the facets it asks for, and its periods. What the question asks for
// and turns off (facets, metrics, income items) is a model's reading of it,
// proposed from closed vocabularies and validated (scope-proposal.ts); its
// periods are read from fixed tokens (FY2026, Q3, YTD). Everything else here
// is derived from those: the route, inheritance, what a turn-off clears. Saved
// with the answer, so the next follow-up and a reload read the same
// interpretation.
//
// The scope is what the thread is researching, not what one answer drew: a
// field a turn's blocks cannot show (a single company's answer has no price
// window) is still kept for the next turn, never erased by it.
//
// A follow-up keeps every field it does not change. An inherited YTD window
// keeps its cutoff, so its baseline and end are the ones already charted, not
// recomputed from the current date. With no proposal (no model, a failure, a
// reply outside the vocabularies) a turn asks for nothing new: a follow-up
// keeps the previous scope whole, and a fresh question gets the plain answer
// for its companies and periods.
//
// A metric the question names that no reader here serves (EBITDA, debt)
// is a named gap: it is never answered with another metric in its place, so a
// question asking only for such metrics reads no income-statement facts at all.
//
// A follow-up can turn a facet off ("without segments", "drop the YTD
// window"): it is cleared, not inherited, and stays off until asked for again.
//
// A benchmark index (the S&P 500) is a named gap no reader serves; it is kept
// like any other facet, so a later turn still says it is missing.

import { requestedFiscalQuarter, requestedFiscalYear, requestedPriceWindow, type FiscalQuarter } from "./fact-blocks.ts";

const ROUTES = [
  "latest_quarter",
  "trend",
  "derived_margin",
  "segments",
  // Cash flow, balance sheet or EPS, for one company.
  "statements",
  "comparison",
  "unavailable_metric",
  "evidence_followup",
  // An answer the financial engine published: its figures and their sources
  // are in that answer, and no reader here re-reads them.
  "financial_answer",
  "unknown",
] as const;
export type ResearchRoute = (typeof ROUTES)[number];

export type ScopeField = "peers" | "segments" | "margin_trend" | "metrics" | "fiscal_year" | "fiscal_quarter" | "price_window" | "benchmark";

// A metric a question names: one this chat's readers show, or a named gap.
export type RequestedMetric = { metric_key: string; label: string; available: boolean };

export type ResearchScope = {
  route: ResearchRoute;
  // The route whose readers the answer used: the route itself, except that an
  // evidence follow-up re-reads what the previous answer read.
  reads: ResearchRoute;
  // Canonical companies the answer compares, primary first: the ones the
  // question covers, then any auto-selected peers (which carry no label).
  companies: ReadonlyArray<{ issuer_id: string; label?: string }>;
  peers: boolean;
  segments: boolean;
  margin_trend: boolean;
  // Any margin asked for this turn, its latest value or its trend.
  margins: boolean;
  // The metrics the question names (none: the route's usual figures).
  metrics: ReadonlyArray<RequestedMetric>;
  fiscal_year: number | null;
  // A fiscal quarter the question names (#290): a single company's answer shows
  // it instead of the latest quarter.
  fiscal_quarter: FiscalQuarter | null;
  // The window's cutoff is the answer that first charted it.
  price_window: { kind: "ytd"; cutoff: string } | null;
  // A benchmark index asked for: never in this data, so always a named gap.
  benchmark: boolean;
  // Guidance asked for, this turn or an earlier one, until a turn turns it off:
  // its claims are read first. Absent when not.
  guidance?: true;
  // A cause asked for, this turn or an earlier one, until a turn turns it off:
  // management's explanation is then read with the guidance. Absent when not.
  explains?: true;
  // The income-statement items the question names, which its metrics read as
  // the whole statement: their claims come first. This turn's, or the answer
  // an evidence follow-up re-reads. Absent when none.
  income_items?: ReadonlyArray<string>;
  // The fields carried from the previous answer rather than asked for now.
  inherited: ReadonlyArray<ScopeField>;
};

// What a question can ask for beside its metrics (scope-proposal.ts).
export const SCOPE_FACETS = [
  "peers",
  "segments",
  "margins",
  "margin_trend",
  "price_window",
  "benchmark",
  "guidance",
  "explains",
  "evidence",
  "latest_quarter",
] as const;
export type ScopeFacet = (typeof SCOPE_FACETS)[number];
// The periods a question can turn off beside its facets.
export const PERIOD_FIELDS = ["fiscal_year", "fiscal_quarter"] as const;
// The income-statement items, in earnings-release terms
// (sec-earnings-release-extraction.ts).
export const INCOME_ITEMS = ["revenue", "gross_margin", "operating_expenses", "operating_income", "net_income"] as const;
export type IncomeItem = (typeof INCOME_ITEMS)[number];

// A model's reading of what a question asks for and turns off, every entry
// from the vocabularies above or the metric catalog (scope-proposal.ts).
export type ScopeProposal = {
  metrics: ReadonlyArray<RequestedMetric>;
  asks: ReadonlySet<ScopeFacet>;
  // Metric keys as proposedMetric builds them.
  turns_off: { facets: ReadonlySet<ScopeFacet | (typeof PERIOD_FIELDS)[number]>; metrics: ReadonlySet<string> };
  income_items: ReadonlyArray<IncomeItem>;
};

const NO_PROPOSAL: ScopeProposal = { metrics: [], asks: new Set(), turns_off: { facets: new Set(), metrics: new Set() }, income_items: [] };

// The field a facet turned off clears. Guidance and a cause are read apart;
// evidence and the latest quarter are asked for one turn only.
const CLEARS: Partial<Record<ScopeFacet | (typeof PERIOD_FIELDS)[number], ScopeField>> = {
  peers: "peers",
  segments: "segments",
  benchmark: "benchmark",
  margins: "margin_trend",
  margin_trend: "margin_trend",
  price_window: "price_window",
  fiscal_year: "fiscal_year",
  fiscal_quarter: "fiscal_quarter",
};

// A quarter named without its year ("Q3", "the third quarter").
const PARTIAL_QUARTER = /\bQ([1-4])\b|\b(first|second|third|fourth)\s+quarter\b/i;
const ORDINAL_QUARTERS: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4 };

// The metrics a question can name. A model proposes from this catalog
// (scope-proposal.ts); nothing else is accepted.
export const PROPOSABLE_METRICS: ReadonlyArray<RequestedMetric> = Object.freeze([
  { metric_key: "free_cash_flow", label: "Free cash flow", available: true },
  { metric_key: "financing_cash_flow", label: "Financing cash flow", available: false },
  { metric_key: "investing_cash_flow", label: "Investing cash flow", available: false },
  { metric_key: "operating_cash_flow", label: "Operating cash flow", available: true },
  { metric_key: "capex", label: "Capital expenditures", available: true },
  // The whole balance sheet, or one item of it, each its own request: a cash
  // question is answered by cash, never by assets.
  { metric_key: "balance_sheet", label: "Balance sheet", available: true },
  { metric_key: "cash_and_equivalents", label: "Cash and equivalents", available: true },
  { metric_key: "total_assets", label: "Total assets", available: true },
  { metric_key: "total_liabilities", label: "Total liabilities", available: true },
  { metric_key: "total_equity", label: "Stockholders' equity", available: true },
  // Basic EPS is its own figure, never answered with diluted EPS.
  { metric_key: "eps_basic", label: "Basic earnings per share", available: true },
  { metric_key: "eps_diluted", label: "Earnings per share", available: true },
  { metric_key: "ebitda", label: "EBITDA", available: false },
  // An adjusted income figure is not the reported one.
  { metric_key: "non_gaap_income", label: "Non-GAAP earnings", available: false },
  { metric_key: "total_debt", label: "Debt", available: false },
  { metric_key: "dividends", label: "Dividends", available: false },
  // Share counts the financial engine reports; no reader here does.
  { metric_key: "weighted_average_basic_shares", label: "Weighted-average basic shares", available: false },
  { metric_key: "weighted_average_diluted_shares", label: "Weighted-average diluted shares", available: false },
  { metric_key: "shares_outstanding", label: "Shares outstanding", available: false },
  // Valuations the financial engine certifies (#444): its answer shows them.
  { metric_key: "market_cap", label: "Market capitalization", available: true },
  { metric_key: "pe_ratio", label: "P/E ratio", available: true },
  { metric_key: "income_statement", label: "Revenue, profit and margins", available: true },
].map((metric) => Object.freeze(metric)));

// The cash flow, balance sheet and EPS a question can name, each with the item
// labels its block shows (statement-blocks.ts). One company at a time: a
// comparison names them as a gap.
export const STATEMENT_METRIC_LABELS: Readonly<Record<string, ReadonlyArray<string>>> = {
  operating_cash_flow: ["Operating cash flow"],
  capex: ["Capital expenditures"],
  free_cash_flow: ["Free cash flow"],
  balance_sheet: ["Cash and equivalents", "Total assets", "Total liabilities", "Stockholders' equity"],
  cash_and_equivalents: ["Cash and equivalents"],
  total_assets: ["Total assets"],
  total_liabilities: ["Total liabilities"],
  total_equity: ["Stockholders' equity"],
  eps_diluted: ["EPS (diluted)"],
  eps_basic: ["EPS (basic)"],
};

export const BALANCE_SHEET_ITEMS = ["cash_and_equivalents", "total_assets", "total_liabilities", "total_equity"];

function metricByKey(key: string): RequestedMetric {
  return PROPOSABLE_METRICS.find((candidate) => candidate.metric_key === key)!;
}

// The statement metrics a turn asks for (or kept from the previous one).
export function statementMetrics(scope: ResearchScope): ReadonlyArray<RequestedMetric> {
  return scope.metrics.filter((metric) => metric.available && metric.metric_key in STATEMENT_METRIC_LABELS);
}

// Adjectives that make a statement metric another, unreported figure
// ("adjusted EPS", "non-GAAP free cash flow"), and what is asked of one
// ("free cash flow margin", "growth in EPS").
export const PROPOSABLE_ADJUSTMENTS = ["adjusted", "non_gaap", "pro_forma", "core", "normalized", "levered", "unlevered"] as const;
export const PROPOSABLE_QUALIFIERS = ["growth", "margin", "yield", "trend", "per_share", "ytd"] as const;
type Adjustment = (typeof PROPOSABLE_ADJUSTMENTS)[number];
type Qualifier = (typeof PROPOSABLE_QUALIFIERS)[number];
const ADJUSTMENT_LABELS: Readonly<Record<Adjustment, string>> = {
  adjusted: "Adjusted",
  non_gaap: "Non-GAAP",
  pro_forma: "Pro forma",
  core: "Core",
  normalized: "Normalized",
  levered: "Levered",
  unlevered: "Unlevered",
};

export function isOneOf<T extends string>(value: unknown, vocabulary: ReadonlyArray<T>): value is T {
  return (vocabulary as ReadonlyArray<unknown>).includes(value);
}

// A statement metric with an adjustment and/or a qualifier is another figure
// no reader serves: a named gap.
function qualifiedMetric(metric: RequestedMetric, adjustment: Adjustment | null, qualifier: Qualifier | null): RequestedMetric {
  if (adjustment === null && qualifier === null) return metric;
  const name = adjustment === null
    ? metric.label
    : `${ADJUSTMENT_LABELS[adjustment]} ${metric.label[0]!.toLowerCase()}${metric.label.slice(1)}`;
  return {
    metric_key: [metric.metric_key, adjustment, qualifier].filter(Boolean).join("_"),
    label: [name, qualifier === "ytd" ? "year to date" : qualifier?.replaceAll("_", " ")].filter(Boolean).join(" "),
    available: false,
  };
}

// The metric a validated proposal names: a catalog metric, qualified only if
// it is a statement metric (an unavailable one is a named gap already).
// Undefined for anything outside the catalog.
export function proposedMetric(
  key: string,
  adjustment: string | null,
  qualifier: string | null,
): RequestedMetric | undefined {
  const metric = PROPOSABLE_METRICS.find((candidate) => candidate.metric_key === key);
  if (!metric) return undefined;
  if (adjustment !== null && !isOneOf(adjustment, PROPOSABLE_ADJUSTMENTS)) return undefined;
  if (qualifier !== null && !isOneOf(qualifier, PROPOSABLE_QUALIFIERS)) return undefined;
  // Adjusted income ("adjusted profit") is not the reported income statement:
  // the non-GAAP gap.
  if (metric.metric_key === "income_statement" && adjustment !== null) return proposedMetric("non_gaap_income", null, null);
  if (!(metric.metric_key in STATEMENT_METRIC_LABELS)) return metric;
  return qualifiedMetric(metric, adjustment, qualifier);
}

// What a reading asks for once its turn-offs apply. A facet turned off is not
// asked for, though the model may also have read it as asked ("Show NVDA
// without the segments"), and no margins is no trend. A metric turned off
// ("drop capex") is not asked for either; the whole balance sheet takes its
// items with it, however they were kept.
export function readingAsks(proposal: ScopeProposal): {
  asks: ReadonlySet<ScopeFacet>;
  offFacets: ReadonlySet<ScopeFacet | (typeof PERIOD_FIELDS)[number]>;
  offMetrics: ReadonlySet<string>;
} {
  const offFacets = new Set(proposal.turns_off.facets);
  if (offFacets.has("margins")) offFacets.add("margin_trend");
  const offMetrics = new Set(proposal.turns_off.metrics);
  if (offMetrics.has("balance_sheet")) for (const key of BALANCE_SHEET_ITEMS) offMetrics.add(key);
  return { asks: new Set([...proposal.asks].filter((facet) => !offFacets.has(facet))), offFacets, offMetrics };
}

export function resolveResearchScope(input: {
  question: string;
  companies: ResearchScope["companies"];
  // The previous answer's scope, for a follow-up; null for a fresh question.
  prior: ResearchScope | null;
  asOf: string;
  // The metrics were served by the financial engine, so none is a gap even if
  // no reader here serves it.
  served?: boolean;
  // Every auto-selected peer was dropped by name: peers are off (local-runtime).
  peersOff?: boolean;
  // What a model read the question to ask for and turn off
  // (scope-proposal.ts). Null: it asks for nothing beyond its companies and
  // period tokens, and turns nothing off.
  proposal: ScopeProposal | null;
}): ResearchScope {
  const { prior, question } = input;
  const { metrics: proposed, income_items: namedItems } = input.proposal ?? NO_PROPOSAL;
  const { asks, offFacets, offMetrics } = readingAsks(input.proposal ?? NO_PROPOSAL);
  const off = new Set([...offFacets].flatMap((facet) => CLEARS[facet] ?? []));
  if (input.peersOff) off.add("peers");
  const inherited: ScopeField[] = [];
  // A field turned off is neither asked for nor kept.
  const pick = <T>(field: ScopeField, asked: T | null, kept: T | null | undefined): T | null => {
    if (off.has(field)) return null;
    if (asked !== null) return asked;
    if (kept === null || kept === undefined) return null;
    inherited.push(field);
    return kept;
  };
  const flag = (field: ScopeField & ScopeFacet, kept: boolean | undefined): boolean =>
    pick(field, asks.has(field) ? true : null, kept ? true : null) ?? false;
  const peers = flag("peers", prior?.peers);
  const segments = flag("segments", prior?.segments);
  const benchmark = flag("benchmark", prior?.benchmark);
  const marginAsked = asks.has("margins") || asks.has("margin_trend");
  // With no proposal a follow-up asks nothing new: it keeps the previous
  // answer's scope unchanged, its margins and the items it named included
  // (#378 review). Not the engine's turn, which is routed as its answer.
  const unchanged = input.proposal === null && !input.served ? prior : null;
  const margins = unchanged?.margins ?? marginAsked;
  const margin_trend = flag("margin_trend", prior?.margin_trend);
  const named = proposed
    .filter((metric) => !offMetrics.has(metric.metric_key))
    .map((metric) => (input.served ? { ...metric, available: true } : metric));
  // A metric turned off leaves the ones kept; none left keeps none.
  // Dropping one item of the whole balance sheet keeps the others, named.
  const kept = (prior?.metrics ?? []).flatMap((metric): RequestedMetric[] => {
    if (offMetrics.has(metric.metric_key)) return [];
    const parts = metric.metric_key === "balance_sheet" ? BALANCE_SHEET_ITEMS : [];
    if (!parts.some((key) => offMetrics.has(key))) return [metric];
    return parts.filter((key) => !offMetrics.has(key)).map(metricByKey);
  });
  // A margin is an income figure: asked with no metric, it names the income
  // statement, unless kept, so it is not read as a kept cash flow (#378 eval).
  const income = metricByKey("income_statement");
  if (marginAsked && named.length === 0 && !offMetrics.has(income.metric_key) && !kept.some((metric) => metric.metric_key === income.metric_key)) named.push(income);
  const metrics = pick("metrics", named.length > 0 ? named : null, kept.length > 0 ? kept : null) ?? [];
  // A period turned off is read as not named, though its words are still in
  // the question ("forget fiscal 2025").
  const yearNamed = off.has("fiscal_year") ? undefined : requestedFiscalYear(question);
  const quarterNamed = off.has("fiscal_quarter") ? undefined : requestedFiscalQuarter(question);
  const latest = asks.has("latest_quarter");
  // The latest quarter replaces an inherited fiscal year ("Q1 fiscal 2025"
  // named both), so a reader that takes no quarter isn't held to the old year.
  if (yearNamed === undefined && quarterNamed === undefined && latest) off.add("fiscal_year");
  // A complete quarter named without a fiscal year sets its year (#292
  // review): a comparison then compares that fiscal year, not the latest.
  const fiscal_year = pick("fiscal_year", yearNamed ?? quarterNamed?.fiscal_year ?? null, prior?.fiscal_year);
  // A follow-up naming part of a period updates the inherited quarter (#292
  // review): a quarter alone ("now Q3") takes its year; a fiscal year alone
  // ("now for fiscal 2026") or the latest quarter replaces it.
  const partial = off.has("fiscal_quarter") ? null : PARTIAL_QUARTER.exec(question);
  const partialPeriod = partial ? `Q${partial[1] ?? ORDINAL_QUARTERS[partial[2]!.toLowerCase()]}` : null;
  // Its year: one named in the question ("Q3, FY2026"), else the inherited
  // quarter's, else an inherited fiscal year (#292 review).
  const partialYear = yearNamed ?? prior?.fiscal_quarter?.fiscal_year ?? prior?.fiscal_year ?? undefined;
  const namedQuarter = quarterNamed ??
    (partialPeriod && partialYear !== undefined ? { fiscal_year: partialYear, fiscal_period: partialPeriod } : null);
  if (namedQuarter === null && (latest || yearNamed !== undefined)) off.add("fiscal_quarter");
  const fiscal_quarter = pick("fiscal_quarter", namedQuarter, prior?.fiscal_quarter);
  // The window is fixed syntax (YTD): its token asks for it, and the proposal
  // only turns it off.
  const asked = !off.has("price_window") && requestedPriceWindow(question) === "ytd" ? { kind: "ytd" as const, cutoff: input.asOf } : null;
  const price_window = pick("price_window", asked, prior?.price_window);
  // An evidence follow-up asks for the sources of the previous answer about the
  // same companies, so it reads that answer's scope again.
  const priorIds = new Set(prior?.companies.map((company) => company.issuer_id) ?? []);
  const evidence = prior !== null && asks.has("evidence") && input.companies.every((company) => priorIds.has(company.issuer_id));
  // Only metrics no reader serves (named now, or kept from the previous turn)
  // and nothing else asked for now: a window, peers, segments or margins asked
  // beside such a gap are still read, with the gap named.
  // A price window counts only where it can be shown: a comparison charts it, a
  // single company's answer does not.
  // Statement figures are read for one company at a time: a comparison asking
  // now only for them is a named gap too. Kept from an earlier turn, they do
  // not stop a comparison asked for now ("compare it with AMD").
  const comparing = input.companies.length > 1 || peers;
  const readable = (metric: RequestedMetric) =>
    metric.available && !(comparing && named.length > 0 && metric.metric_key in STATEMENT_METRIC_LABELS);
  const onlyUnavailable = metrics.length > 0 && metrics.every((metric) => !readable(metric)) &&
    (asked === null || input.companies.length < 2) && !asks.has("peers") && !asks.has("segments") && !margins;
  // Only cash flow, balance sheet or EPS (and any named gaps beside them): the
  // statement figures alone, as a segment request reads segments alone.
  const onlyStatements = metrics.some((metric) => metric.available && metric.metric_key in STATEMENT_METRIC_LABELS) &&
    metrics.every((metric) => !metric.available || metric.metric_key in STATEMENT_METRIC_LABELS) &&
    !asks.has("segments") && !margins;
  // The items named now; else the previous answer's, where this turn re-reads
  // it (an evidence follow-up) or keeps the metrics it named them for ("Why?").
  const incomeItems = evidence || unchanged !== null || (namedItems.length === 0 && inherited.includes("metrics"))
    ? prior?.income_items ?? []
    : namedItems;
  // Unchanged, it reads what the previous answer read: not the engine's
  // answer, which no reader here re-reads, nor one that compared where this
  // turn covers one company, or the reverse. Those are routed by what they keep.
  const reread = unchanged !== null && unchanged.reads !== "financial_answer" &&
      comparing === (unchanged.companies.length > 1 || unchanged.peers)
    ? unchanged
    : null;
  const reads = evidence && prior !== null
    ? prior.reads
    : input.served
    ? "financial_answer"
    : reread
    ? reread.reads
    : routeOf(input.companies.length, { peers, segments, margin_trend, margins, onlyUnavailable, onlyStatements });
  // Guidance and a cause are asked this turn, or kept from an earlier one as
  // the other facets are, unless this one turns them off.
  const keeps = (facet: "guidance" | "explains", kept: true | undefined) =>
    !offFacets.has(facet) && (asks.has(facet) || kept === true);
  return {
    route: evidence ? "evidence_followup" : reread?.route ?? reads,
    reads,
    // An evidence follow-up re-reads the previous answer, over all its companies.
    companies: evidence && prior !== null ? prior.companies : input.companies,
    peers,
    segments,
    margin_trend,
    margins: margins || margin_trend,
    metrics,
    fiscal_year,
    fiscal_quarter,
    price_window,
    benchmark,
    ...(keeps("guidance", prior?.guidance) ? { guidance: true as const } : {}),
    ...(keeps("explains", prior?.explains) ? { explains: true as const } : {}),
    ...(incomeItems.length > 0 ? { income_items: incomeItems } : {}),
    inherited,
  };
}

// Words as subject-extraction.ts splits them, so each is one a company could be.
const wordsOf = (text: string) => text.split(/[^A-Za-z]+/).filter(Boolean);

// The whole names of what a scope tracks (each catalog key and label, each
// facet, period and income item) and the abbreviations written for them.
const FACET_NAMES = new Set([
  ...PROPOSABLE_METRICS.flatMap(({ metric_key, label }) => [metric_key, label]),
  ...SCOPE_FACETS,
  ...PERIOD_FIELDS,
  ...INCOME_ITEMS,
  "fcf",
  "ocf",
  "eps",
].map((name) => wordsOf(name).join(" ").toLowerCase()));

// The words of a phrase that lie inside a whole name this scope tracks
// ("FREE CASH FLOW", "the FCF"), so they are not companies to drop. A word of
// a longer name alone is not one: NET (of net income) is a company (#378).
export function facetWords(phrase: string): ReadonlySet<string> {
  const words = wordsOf(phrase);
  const inside = new Set<string>();
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= words.length; end++) {
      const span = words.slice(start, end);
      if (FACET_NAMES.has(span.join(" ").toLowerCase())) for (const word of span) inside.add(word);
    }
  }
  return inside;
}

function routeOf(
  companies: number,
  facets: {
    peers: boolean;
    segments: boolean;
    margin_trend: boolean;
    margins: boolean;
    onlyUnavailable: boolean;
    onlyStatements: boolean;
  },
): ResearchRoute {
  if (companies === 0) return "unknown";
  if (facets.onlyUnavailable) return "unavailable_metric";
  if (companies > 1 || facets.peers) return "comparison";
  if (facets.segments) return "segments";
  if (facets.onlyStatements) return "statements";
  if (facets.margin_trend) return "trend";
  if (facets.margins) return "derived_margin";
  return "latest_quarter";
}

// The metrics a turn names that no reader here serves: each is a named gap.
export function unavailableMetrics(scope: ResearchScope): ReadonlyArray<RequestedMetric> {
  return scope.metrics.filter((metric) => !metric.available);
}

// A scope read back from a saved answer; null when absent or not a scope (an
// answer saved before scopes were, or a malformed row), so the turn starts fresh.
export function parseResearchScope(value: unknown): ResearchScope | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  const window = scope.price_window as { kind?: unknown; cutoff?: unknown } | null | undefined;
  const quarter = scope.fiscal_quarter as { fiscal_year?: unknown; fiscal_period?: unknown } | null | undefined;
  // Absent on scopes saved before quarters were recorded (#290): none.
  const validQuarter = quarter === undefined || quarter === null ||
    (Number.isInteger(quarter.fiscal_year) && typeof quarter.fiscal_period === "string" && /^Q[1-4]$/.test(quarter.fiscal_period));
  const validWindow = window === null || (window?.kind === "ytd" && typeof window.cutoff === "string" && !Number.isNaN(Date.parse(window.cutoff)));
  if (
    typeof scope.peers !== "boolean" ||
    typeof scope.segments !== "boolean" ||
    typeof scope.margin_trend !== "boolean" ||
    !(scope.fiscal_year === null || Number.isInteger(scope.fiscal_year)) ||
    !validWindow ||
    !validQuarter ||
    !(Array.isArray(scope.companies) && scope.companies.every(isCompany)) ||
    !(scope.metrics === undefined || (Array.isArray(scope.metrics) && scope.metrics.every(isMetric)))
  ) {
    return null;
  }
  const route = ROUTES.includes(scope.route as ResearchRoute) ? scope.route as ResearchRoute : "unknown";
  return {
    route,
    // Absent on scopes saved before it was recorded: the route itself.
    reads: ROUTES.includes(scope.reads as ResearchRoute) ? scope.reads as ResearchRoute : route,
    companies: scope.companies as ResearchScope["companies"],
    peers: scope.peers,
    segments: scope.segments,
    margin_trend: scope.margin_trend,
    margins: scope.margins === true || scope.margin_trend,
    // Absent on scopes saved before metrics were recorded.
    metrics: (scope.metrics ?? []) as ResearchScope["metrics"],
    fiscal_year: scope.fiscal_year as number | null,
    fiscal_quarter: quarter ? { fiscal_year: quarter.fiscal_year as number, fiscal_period: quarter.fiscal_period as string } : null,
    price_window: window === null ? null : { kind: "ytd", cutoff: window!.cutoff as string },
    // Absent on scopes saved before benchmarks were recorded.
    benchmark: scope.benchmark === true,
    ...(scope.guidance === true ? { guidance: true as const } : {}),
    ...(scope.explains === true ? { explains: true as const } : {}),
    ...(Array.isArray(scope.income_items) && scope.income_items.length > 0 && scope.income_items.every((item) => typeof item === "string")
      ? { income_items: scope.income_items as string[] }
      : {}),
    inherited: [],
  };
}

function isMetric(value: unknown): boolean {
  const metric = value as { metric_key?: unknown; label?: unknown; available?: unknown } | null;
  return typeof metric?.metric_key === "string" && typeof metric.label === "string" && typeof metric.available === "boolean";
}

function isCompany(value: unknown): boolean {
  const company = value as { issuer_id?: unknown; label?: unknown } | null;
  return typeof company?.issuer_id === "string" && (company.label === undefined || typeof company.label === "string");
}

