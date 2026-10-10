// A turn's research scope (#206): which route answers it, the companies it
// covers, the facets it asks for, and its periods. Resolved by the server from
// the question and, for a follow-up, the previous answer's scope; never chosen
// by a model. Saved with the answer, so the next follow-up and a reload read
// the same interpretation.
//
// The scope is what the thread is researching, not what one answer drew: a
// field a turn's blocks cannot show (a single company's answer has no price
// window) is still kept for the next turn, never erased by it.
//
// A follow-up keeps every field it does not change. An inherited YTD window
// keeps its cutoff, so its baseline and end are the ones already charted, not
// recomputed from the current date.
//
// A metric the question names that no reader here serves (free cash flow, EPS)
// is a named gap: it is never answered with another metric in its place, so a
// question asking only for such metrics reads no income-statement facts at all.
//
// ponytail: a facet named once stays on for the rest of the thread; turning one
// off, and clarifying an ambiguous change, are #206's last slice.

import { requestedFiscalYear, requestedPriceWindow } from "./fact-blocks.ts";

const ROUTES = [
  "latest_quarter",
  "trend",
  "derived_margin",
  "segments",
  "comparison",
  "unavailable_metric",
  "evidence_followup",
  // An answer the financial engine published: its figures and their sources
  // are in that answer, and no reader here re-reads them.
  "financial_answer",
  "unknown",
] as const;
export type ResearchRoute = (typeof ROUTES)[number];

export type ScopeField = "peers" | "segments" | "margin_trend" | "metrics" | "fiscal_year" | "price_window";

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
  // The window's cutoff is the answer that first charted it.
  price_window: { kind: "ytd"; cutoff: string } | null;
  // The fields carried from the previous answer rather than asked for now.
  inherited: ReadonlyArray<ScopeField>;
};

const PEERS = /\bpeers?\b/i;
const SEGMENTS = /\bsegments?\b/i;
const MARGINS = /\b(margins?|profitab\w*)\b/i;
// A margin asked about over time, not just its latest value.
const OVER_TIME =
  /\b(trend\w*|over (?:the )?(?:last|past)\b|histor\w*|chang\w*|since|evolv\w*|quarters|years|qoq|yoy|quarter[- ]over[- ]quarter|year[- ]over[- ]year|(?:last|prior|previous) (?:quarter|year)|a year ago)\b/i;
// Phrases that name a context, not a metric: "earnings" in "earnings call".
const NOT_METRICS = /\bearnings (?:calls?|releases?|reports?|dates?|season)\b/gi;
// Words that qualify a metric just named ("free cash flow growth") rather than
// asking for another one.
const QUALIFIER = String.raw`(?:\s+(?:growth|margins?|yields?|trends?|per share))?`;
// Asking for an answer's evidence, not about a company's sources of revenue:
// "sources" counts only as the answer's ("show the sources", "your sources").
const EVIDENCE =
  /\b(evidence|cite|citations?|(?:the|your|its) sources|sources (?:for|of) (?:this|that|these|those)|where (?:does|do|did) (?:this|that|these|those) come from)\b/i;

// The metrics a question can name, most specific first: each match is removed
// before the next is tried, so "free cash flow" is not also "cash flow" and
// "earnings per share" is not also "earnings".
const METRICS: ReadonlyArray<RequestedMetric & { pattern: RegExp }> = [
  { metric_key: "free_cash_flow", label: "Free cash flow", available: false, pattern: /\bfree[- ]cash[- ]flows?\b|\bFCF\b/gi },
  { metric_key: "financing_cash_flow", label: "Financing cash flow", available: false, pattern: /\bfinancing cash[- ]flows?\b/gi },
  { metric_key: "investing_cash_flow", label: "Investing cash flow", available: false, pattern: /\binvesting cash[- ]flows?\b/gi },
  // Unqualified "cash flow" means operating cash flow.
  { metric_key: "operating_cash_flow", label: "Operating cash flow", available: false, pattern: /\b(?:operating )?cash[- ]flows?\b/gi },
  { metric_key: "capex", label: "Capital expenditures", available: false, pattern: /\bcapex\b|\bcapital expenditures?\b/gi },
  { metric_key: "eps_diluted", label: "Earnings per share", available: false, pattern: /\bEPS\b|\bearnings per share\b/gi },
  { metric_key: "ebitda", label: "EBITDA", available: false, pattern: /\bEBITDA\b/gi },
  { metric_key: "total_debt", label: "Debt", available: false, pattern: /\bdebt\b/gi },
  { metric_key: "dividends", label: "Dividends", available: false, pattern: /\bdividends?\b/gi },
  { metric_key: "income_statement", label: "Revenue, profit and margins", available: true, pattern: /\b(revenue|sales|income|profits?|profitab\w*|margins?|growth|earnings)\b/gi },
];

export function requestedMetrics(question: string): RequestedMetric[] {
  return scanMetrics(question).metrics;
}

// The metrics a question names, and the question without the unavailable ones
// and their qualifiers: "free cash flow margin" asks for no (available) margin.
function scanMetrics(question: string): { metrics: RequestedMetric[]; rest: string } {
  let rest = question.replace(NOT_METRICS, " ");
  let withoutUnavailable = question;
  const metrics: RequestedMetric[] = [];
  for (const { pattern, ...metric } of METRICS) {
    // An unavailable metric takes its qualifier with it, so "free cash flow
    // growth" does not also ask for (available) growth.
    const match = new RegExp(`(?:${pattern.source})${metric.available ? "" : QUALIFIER}`, "gi");
    if (!new RegExp(match.source, "i").test(rest)) continue;
    metrics.push(metric);
    rest = rest.replace(match, " ");
    if (!metric.available) withoutUnavailable = withoutUnavailable.replace(match, " ");
  }
  return { metrics, rest: withoutUnavailable };
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
}): ResearchScope {
  const { question, prior } = input;
  const inherited: ScopeField[] = [];
  const pick = <T>(field: ScopeField, asked: T | null, kept: T | null | undefined): T | null => {
    if (asked !== null) return asked;
    if (kept === null || kept === undefined) return null;
    inherited.push(field);
    return kept;
  };
  const flag = (field: ScopeField, pattern: RegExp, kept: boolean | undefined): boolean =>
    pick(field, pattern.test(question) ? true : null, kept ? true : null) ?? false;
  const peers = flag("peers", PEERS, prior?.peers);
  const segments = flag("segments", SEGMENTS, prior?.segments);
  // Margins asked about in their own right, not as an unavailable metric's
  // qualifier ("free cash flow margin").
  const scanned = scanMetrics(question);
  const marginAsked = MARGINS.test(scanned.rest);
  const margin_trend = pick("margin_trend", marginAsked && OVER_TIME.test(scanned.rest) ? true : null, prior?.margin_trend ? true : null) ?? false;
  const named = scanned.metrics.map((metric) => (input.served ? { ...metric, available: true } : metric));
  const metrics = pick("metrics", named.length > 0 ? named : null, prior && prior.metrics.length > 0 ? prior.metrics : null) ?? [];
  const fiscal_year = pick("fiscal_year", requestedFiscalYear(question) ?? null, prior?.fiscal_year);
  const asked = requestedPriceWindow(question) === "ytd" ? { kind: "ytd" as const, cutoff: input.asOf } : null;
  const price_window = pick("price_window", asked, prior?.price_window);
  // An evidence follow-up asks for the sources of the previous answer about the
  // same companies, so it reads that answer's scope again.
  const priorIds = new Set(prior?.companies.map((company) => company.issuer_id) ?? []);
  const evidence = prior !== null && EVIDENCE.test(question) && input.companies.every((company) => priorIds.has(company.issuer_id));
  // Only metrics no reader serves (named now, or kept from the previous turn)
  // and nothing else asked for now: a window, peers, segments or margins asked
  // beside such a gap are still read, with the gap named.
  const onlyUnavailable = metrics.length > 0 && metrics.every((metric) => !metric.available) &&
    asked === null && !PEERS.test(question) && !SEGMENTS.test(question) && !marginAsked;
  const reads = evidence && prior !== null
    ? prior.reads
    : input.served
    ? "financial_answer"
    : routeOf(input.companies.length, { peers, segments, margin_trend, marginAsked, onlyUnavailable });
  return {
    route: evidence ? "evidence_followup" : reads,
    reads,
    // An evidence follow-up re-reads the previous answer, over all its companies.
    companies: evidence && prior !== null ? prior.companies : input.companies,
    peers,
    segments,
    margin_trend,
    margins: marginAsked || margin_trend,
    metrics,
    fiscal_year,
    price_window,
    inherited,
  };
}

function routeOf(
  companies: number,
  facets: {
    peers: boolean;
    segments: boolean;
    margin_trend: boolean;
    marginAsked: boolean;
    onlyUnavailable: boolean;
  },
): ResearchRoute {
  if (companies === 0) return "unknown";
  if (facets.onlyUnavailable) return "unavailable_metric";
  if (companies > 1 || facets.peers) return "comparison";
  if (facets.segments) return "segments";
  if (facets.margin_trend) return "trend";
  if (facets.marginAsked) return "derived_margin";
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
  const validWindow = window === null || (window?.kind === "ytd" && typeof window.cutoff === "string" && !Number.isNaN(Date.parse(window.cutoff)));
  if (
    typeof scope.peers !== "boolean" ||
    typeof scope.segments !== "boolean" ||
    typeof scope.margin_trend !== "boolean" ||
    !(scope.fiscal_year === null || Number.isInteger(scope.fiscal_year)) ||
    !validWindow ||
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
    price_window: window === null ? null : { kind: "ytd", cutoff: window!.cutoff as string },
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

