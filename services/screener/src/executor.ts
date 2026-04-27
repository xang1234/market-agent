// Screener executor (cw0.7.4 runtime).
//
// Pure pipeline: takes a normalized ScreenerQuery (cw0.7.1) and a
// candidate registry (`candidate.ts`), produces a frozen ScreenerResponse
// (cw0.7.2). Filter → sort → page → assemble rows.
//
// "Pure" means no I/O, no clocks of its own — `deps.clock` is injected
// so tests pin a fixed `as_of` for deterministic snapshots and so prod
// can substitute a wall-clock. The executor does NOT make HTTP calls;
// the candidate registry already holds pre-hydrated values.

import type { ScreenerCandidate, ScreenerCandidateRepository } from "./candidate.ts";
import { getFieldDefinition } from "./fields.ts";
import type {
  EnumClause,
  NumericClause,
  ScreenerClause,
  ScreenerQuery,
  SortSpec,
} from "./query.ts";
import {
  normalizedScreenerResponse,
  type ScreenerFundamentalsSummary,
  type ScreenerQuoteSummary,
  type ScreenerResponse,
  type ScreenerResultRow,
} from "./result.ts";

export type ExecutorDeps = {
  candidates: ScreenerCandidateRepository;
  clock: () => Date;
};

export function executeScreenerQuery(
  deps: ExecutorDeps,
  query: ScreenerQuery,
): ScreenerResponse {
  const all = deps.candidates.list();
  const matched = all.filter((c) => candidateMatchesQuery(query, c));
  const sorted = sortCandidates(query.sort, matched);
  const offset = query.page.offset ?? 0;
  const paged = sorted.slice(offset, offset + query.page.limit);
  const rows: ScreenerResultRow[] = paged.map((c, i) => ({
    subject_ref: c.subject_ref,
    display: c.display,
    // Rank is global (1-based within the matched set), not page-local —
    // so a paginated result clearly tells the consumer "this row is the
    // 27th match", not "this row is the 7th on page 4."
    rank: offset + i + 1,
    quote: c.quote,
    fundamentals: c.fundamentals,
  }));

  return normalizedScreenerResponse({
    query,
    rows,
    total_count: matched.length,
    page: query.page,
    as_of: deps.clock().toISOString(),
    // The executor reads from the in-memory candidate registry, not
    // from a sealed snapshot. Dynamic-watchlist / theme replay flows
    // (P4.7, P4.1) will set this to true once snapshot binding lands.
    snapshot_compatible: false,
  });
}

function candidateMatchesQuery(
  query: ScreenerQuery,
  c: ScreenerCandidate,
): boolean {
  for (const clause of query.universe) {
    if (!enumClauseMatches(clause, candidateUniverseValue(c, clause.field))) {
      return false;
    }
  }
  for (const clause of query.market) {
    if (!marketClauseMatches(clause, c)) return false;
  }
  for (const clause of query.fundamentals) {
    if (!numericClauseMatches(clause, candidateFundamentalsValue(c, clause.field))) {
      return false;
    }
  }
  return true;
}

function marketClauseMatches(
  clause: ScreenerClause,
  c: ScreenerCandidate,
): boolean {
  if (isEnumClause(clause)) {
    const value = candidateMarketValue(c, clause.field);
    return typeof value === "string" && enumClauseMatches(clause, value);
  }
  return numericClauseMatches(clause, candidateMarketValue(c, clause.field) as number | null);
}

function enumClauseMatches(clause: EnumClause, value: string | undefined): boolean {
  return value !== undefined && clause.values.includes(value);
}

// A numeric clause on a field whose candidate value is null excludes the
// candidate. "Companies with P/E > 5" should not include a loss-maker
// whose P/E is undefined — letting nulls slip through would fabricate
// matches that have no basis in data.
function numericClauseMatches(
  clause: NumericClause,
  value: number | null,
): boolean {
  if (value === null) return false;
  if (clause.min !== undefined && value < clause.min) return false;
  if (clause.max !== undefined && value > clause.max) return false;
  return true;
}

function isEnumClause(clause: ScreenerClause): clause is EnumClause {
  return "values" in clause;
}

function sortCandidates(
  sort: ReadonlyArray<SortSpec>,
  candidates: ReadonlyArray<ScreenerCandidate>,
): ReadonlyArray<ScreenerCandidate> {
  // `Array.sort` mutates; copy first so the candidate repo's frozen list
  // stays untouched.
  const copy = [...candidates];
  copy.sort((a, b) => compareCandidates(sort, a, b));
  return copy;
}

function compareCandidates(
  sort: ReadonlyArray<SortSpec>,
  a: ScreenerCandidate,
  b: ScreenerCandidate,
): number {
  for (const spec of sort) {
    const av = sortableValue(a, spec.field);
    const bv = sortableValue(b, spec.field);
    // Nulls always sort last regardless of direction. Otherwise asc-sort
    // would parade no-data candidates to the top, drowning real signal.
    if (av === null && bv === null) continue;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) continue;
    return spec.direction === "asc" ? av - bv : bv - av;
  }
  return 0;
}

function sortableValue(c: ScreenerCandidate, field: string): number | null {
  const def = getFieldDefinition(field);
  // Validation in cw0.7.1 already rejected non-sortable / unknown sort
  // fields, so this is defensive only — if the registry says market or
  // fundamentals, look there; otherwise treat as null.
  if (def?.dimension === "market") {
    return c.quote[field as keyof ScreenerQuoteSummary] as number | null;
  }
  if (def?.dimension === "fundamentals") {
    return c.fundamentals[field as keyof ScreenerFundamentalsSummary] as number | null;
  }
  return null;
}

function candidateUniverseValue(
  c: ScreenerCandidate,
  field: string,
): string | undefined {
  return c.universe[field as keyof typeof c.universe];
}

function candidateMarketValue(
  c: ScreenerCandidate,
  field: string,
): string | number | null {
  return c.quote[field as keyof ScreenerQuoteSummary] as string | number | null;
}

function candidateFundamentalsValue(
  c: ScreenerCandidate,
  field: string,
): number | null {
  return c.fundamentals[field as keyof ScreenerFundamentalsSummary] as number | null;
}
