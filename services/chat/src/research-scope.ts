// A turn's research scope (#206): which route answers it, the companies it
// covers, the facets it asks for, and its periods. Resolved by the server from
// the question and, for a follow-up, the previous answer's scope; never chosen
// by a model. Saved with the answer, so the next follow-up and a reload read
// the same interpretation.
//
// A follow-up keeps every field it does not change. An inherited YTD window
// keeps its cutoff, so its baseline and end are the ones already charted, not
// recomputed from the current date.
//
// ponytail: a facet named once stays on for the rest of the thread; turning one
// off, and clarifying an ambiguous change, are #206's later slices.

import { requestedFiscalYear, requestedPriceWindow } from "./fact-blocks.ts";

const ROUTES = ["latest_quarter", "trend", "segments", "comparison", "unknown"] as const;
export type ResearchRoute = (typeof ROUTES)[number];

export type ScopeField = "peers" | "segments" | "margin_trend" | "fiscal_year" | "price_window";

export type ResearchScope = {
  route: ResearchRoute;
  // Canonical companies the answer compares, primary first: the ones the
  // question covers, then any auto-selected peers (which carry no label).
  companies: ReadonlyArray<{ issuer_id: string; label?: string }>;
  peers: boolean;
  segments: boolean;
  margin_trend: boolean;
  fiscal_year: number | null;
  // The window's cutoff is the answer that first charted it.
  price_window: { kind: "ytd"; cutoff: string } | null;
  // The fields carried from the previous answer rather than asked for now.
  inherited: ReadonlyArray<ScopeField>;
};

const PEERS = /\bpeers?\b/i;
const SEGMENTS = /\bsegments?\b/i;
const MARGINS = /\b(margins?|profitab\w*)\b/i;

export function resolveResearchScope(input: {
  question: string;
  companies: ResearchScope["companies"];
  // The previous answer's scope, for a follow-up; null for a fresh question.
  prior: ResearchScope | null;
  asOf: string;
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
  const margin_trend = flag("margin_trend", MARGINS, prior?.margin_trend);
  const fiscal_year = pick("fiscal_year", requestedFiscalYear(question) ?? null, prior?.fiscal_year);
  const asked = requestedPriceWindow(question) === "ytd" ? { kind: "ytd" as const, cutoff: input.asOf } : null;
  const price_window = pick("price_window", asked, prior?.price_window);
  return {
    route: routeOf(input.companies.length, { peers, segments, margin_trend }),
    companies: input.companies,
    peers,
    segments,
    margin_trend,
    fiscal_year,
    price_window,
    inherited,
  };
}

// Whether a live turn fetches its YTD window's prices: one asked for now, or an
// inherited one when the turn adds a company the earlier answer did not chart.
export function needsWindowFetch(scope: ResearchScope, prior: ResearchScope | null): boolean {
  if (scope.price_window === null) return false;
  if (!scope.inherited.includes("price_window")) return true;
  const charted = new Set(prior?.companies.map((company) => company.issuer_id) ?? []);
  return scope.companies.some((company) => !charted.has(company.issuer_id));
}

function routeOf(companies: number, facets: { peers: boolean; segments: boolean; margin_trend: boolean }): ResearchRoute {
  if (companies === 0) return "unknown";
  if (companies > 1 || facets.peers) return "comparison";
  if (facets.segments) return "segments";
  if (facets.margin_trend) return "trend";
  return "latest_quarter";
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
    !(Array.isArray(scope.companies) && scope.companies.every(isCompany))
  ) {
    return null;
  }
  return {
    route: ROUTES.includes(scope.route as ResearchRoute) ? scope.route as ResearchRoute : "unknown",
    companies: scope.companies as ResearchScope["companies"],
    peers: scope.peers,
    segments: scope.segments,
    margin_trend: scope.margin_trend,
    fiscal_year: scope.fiscal_year as number | null,
    price_window: window === null ? null : { kind: "ytd", cutoff: window!.cutoff as string },
    inherited: [],
  };
}

function isCompany(value: unknown): boolean {
  const company = value as { issuer_id?: unknown; label?: unknown } | null;
  return typeof company?.issuer_id === "string" && (company.label === undefined || typeof company.label === "string");
}

