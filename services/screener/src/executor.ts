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
import { getFieldDefinition, type FieldDefinition } from "./fields.ts";
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
  // Pre-resolve market clauses' enum/numeric kind once instead of asking
  // the field registry per (candidate × clause) inside the filter.
  const marketResolved: ResolvedMarketClause[] = query.market.map((clause) => ({
    clause,
    isEnum: getFieldDefinition(clause.field)?.kind === "enum",
  }));
  const matched = all.filter((c) => candidateMatchesQuery(query, marketResolved, c));
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
    // The executor reads the live in-memory candidate registry, not a
    // sealed snapshot — so two replays of the same query may legitimately
    // disagree as the registry refreshes. Snapshot-bound execution flips
    // this to true.
    snapshot_compatible: false,
  });
}

type ResolvedMarketClause = { clause: ScreenerClause; isEnum: boolean };

function candidateMatchesQuery(
  query: ScreenerQuery,
  market: ReadonlyArray<ResolvedMarketClause>,
  c: ScreenerCandidate,
): boolean {
  for (const clause of query.universe) {
    if (!enumClauseMatches(clause, candidateUniverseValue(c, clause.field))) {
      return false;
    }
  }
  for (const { clause, isEnum } of market) {
    const value = candidateMarketValue(c, clause.field);
    if (isEnum) {
      if (typeof value !== "string") return false;
      if (!enumClauseMatches(clause as EnumClause, value)) return false;
    } else {
      if (!numericClauseMatches(clause as NumericClause, value as number | null)) return false;
    }
  }
  for (const clause of query.fundamentals) {
    if (!numericClauseMatches(clause, candidateFundamentalsValue(c, clause.field))) {
      return false;
    }
  }
  return true;
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

function candidateUniverseValue(c: ScreenerCandidate, field: string): string | undefined {
  return c.universe[field as keyof typeof c.universe];
}

function candidateMarketValue(c: ScreenerCandidate, field: string): string | number | null {
  return c.quote[field as keyof ScreenerQuoteSummary] as string | number | null;
}

function candidateFundamentalsValue(c: ScreenerCandidate, field: string): number | null {
  return c.fundamentals[field as keyof ScreenerFundamentalsSummary];
}

function sortableValueFor(c: ScreenerCandidate, def: FieldDefinition): number | null {
  if (def.dimension === "market") {
    return c.quote[def.field as keyof ScreenerQuoteSummary] as number | null;
  }
  if (def.dimension === "fundamentals") {
    return c.fundamentals[def.field as keyof ScreenerFundamentalsSummary];
  }
  return null;
}

type ResolvedSort = { def: FieldDefinition; direction: SortSpec["direction"] };

function sortCandidates(
  sort: ReadonlyArray<SortSpec>,
  candidates: ReadonlyArray<ScreenerCandidate>,
): ReadonlyArray<ScreenerCandidate> {
  // Resolve each sort spec's FieldDefinition once instead of per comparison.
  const resolved: ResolvedSort[] = sort.map((spec) => {
    const def = getFieldDefinition(spec.field);
    if (!def) {
      throw new Error(`sortCandidates: unknown sort field '${spec.field}'`);
    }
    return { def, direction: spec.direction };
  });
  const copy = [...candidates];
  copy.sort((a, b) => {
    for (const { def, direction } of resolved) {
      const av = sortableValueFor(a, def);
      const bv = sortableValueFor(b, def);
      // Nulls always sort last regardless of direction. Otherwise asc-sort
      // would parade no-data candidates to the top, drowning real signal.
      if (av === null && bv === null) continue;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) continue;
      return direction === "asc" ? av - bv : bv - av;
    }
    return 0;
  });
  return copy;
}
