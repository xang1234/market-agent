// Workspace form-state model for the screener query envelope.
//
// The wire envelope (`ScreenerQuery` in contracts.ts) demands typed
// numeric clauses, frozen arrays, and a non-empty sort spec. A live
// form holds half-typed input — empty min boxes, no selected enum
// values, half-deleted offsets — so the UI keeps a looser "draft"
// shape and projects to the wire shape only at submit time.
//
// `draftToQuery` is the projection. It silently drops empty clauses
// (an empty universe filter means "no filter on that dimension", not
// "match nothing") so the user can leave inputs blank without
// poisoning the request. Numeric inputs stay as strings in the draft
// because '' is the natural empty state — `Number('')` would coerce
// to 0 and silently filter on min=0, which is meaningfully different
// from "no min."

import {
  SCREENER_LIMIT_MAX,
  SCREENER_LIMIT_MIN,
  type EnumClause,
  type NumericClause,
  type ScreenerClause,
  type ScreenerQuery,
  type SortDirection,
  type SortSpec,
} from './contracts.ts'

export type NumericRangeDraft = {
  min: string
  max: string
}

export type QueryDraft = {
  // field name -> selected option values
  universe: Record<string, ReadonlyArray<string>>
  // numeric range fields under the market dimension
  marketNumeric: Record<string, NumericRangeDraft>
  // numeric range fields under the fundamentals dimension
  fundamentalsNumeric: Record<string, NumericRangeDraft>
  sort: { field: string; direction: SortDirection }
  limit: number
  offset: number
}

export const DEFAULT_SORT: SortSpec = { field: 'market_cap', direction: 'desc' }
export const DEFAULT_LIMIT = 50

export function createDefaultQueryDraft(): QueryDraft {
  return {
    universe: {},
    marketNumeric: {},
    fundamentalsNumeric: {},
    sort: { field: DEFAULT_SORT.field, direction: DEFAULT_SORT.direction },
    limit: DEFAULT_LIMIT,
    offset: 0,
  }
}

export function emptyNumericRange(): NumericRangeDraft {
  return { min: '', max: '' }
}

export function setUniverseSelection(
  draft: QueryDraft,
  field: string,
  values: ReadonlyArray<string>,
): QueryDraft {
  const next = { ...draft.universe }
  if (values.length === 0) {
    delete next[field]
  } else {
    next[field] = values
  }
  return { ...draft, universe: next, offset: 0 }
}

export function setNumericRange(
  draft: QueryDraft,
  dimension: 'market' | 'fundamentals',
  field: string,
  range: NumericRangeDraft,
): QueryDraft {
  const key = dimension === 'market' ? 'marketNumeric' : 'fundamentalsNumeric'
  const current = draft[key]
  const next = { ...current, [field]: range }
  // Clearing both bounds is equivalent to dropping the clause; keep
  // the draft tidy so "did the user touch this?" stays meaningful.
  if (range.min === '' && range.max === '') {
    delete next[field]
  }
  return { ...draft, [key]: next, offset: 0 }
}

export function setSort(
  draft: QueryDraft,
  sort: { field: string; direction: SortDirection },
): QueryDraft {
  return { ...draft, sort, offset: 0 }
}

export function setLimit(draft: QueryDraft, limit: number): QueryDraft {
  const clamped = Math.max(SCREENER_LIMIT_MIN, Math.min(SCREENER_LIMIT_MAX, Math.floor(limit)))
  return { ...draft, limit: clamped, offset: 0 }
}

export function setOffset(draft: QueryDraft, offset: number): QueryDraft {
  return { ...draft, offset: Math.max(0, Math.floor(offset)) }
}

export function draftToQuery(draft: QueryDraft): ScreenerQuery {
  const universe: EnumClause[] = []
  for (const [field, values] of Object.entries(draft.universe)) {
    if (values.length > 0) {
      universe.push({ field, values })
    }
  }

  const market: ScreenerClause[] = []
  for (const [field, range] of Object.entries(draft.marketNumeric)) {
    const clause = numericRangeToClause(field, range)
    if (clause) market.push(clause)
  }

  const fundamentals: NumericClause[] = []
  for (const [field, range] of Object.entries(draft.fundamentalsNumeric)) {
    const clause = numericRangeToClause(field, range)
    if (clause) fundamentals.push(clause)
  }

  const page: ScreenerPageDraft =
    draft.offset > 0
      ? { limit: draft.limit, offset: draft.offset }
      : { limit: draft.limit }

  return {
    universe,
    market,
    fundamentals,
    sort: [{ field: draft.sort.field, direction: draft.sort.direction }],
    page,
  }
}

type ScreenerPageDraft = { limit: number; offset?: number }

function numericRangeToClause(
  field: string,
  range: NumericRangeDraft,
): NumericClause | null {
  const min = parseOptionalNumber(range.min)
  const max = parseOptionalNumber(range.max)
  if (min === null && max === null) return null
  const clause: NumericClause = { field }
  if (min !== null) clause.min = min
  if (max !== null) clause.max = max
  return clause
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  if (!Number.isFinite(num)) return null
  return num
}

// Reverse projection: ScreenerQuery → QueryDraft. Used when reopening a
// saved screen (cw0.8.2) to restore the workspace form. Numeric clauses
// become string min/max bounds; the first sort spec wins (the workspace
// only exposes a single sort axis); offset and limit pass through.
//
// Lossy for clause kinds the workspace doesn't render (currently:
// market-dimension enum clauses like delay_class). The saved screen's
// definition stays intact on the backend; only the form display drops
// what it cannot show. Round-trip identity holds for any query the
// workspace itself produces.
export function queryToDraft(query: ScreenerQuery): QueryDraft {
  const universe: Record<string, ReadonlyArray<string>> = {}
  for (const clause of query.universe) {
    if (clause.values.length > 0) universe[clause.field] = [...clause.values]
  }

  const marketNumeric: Record<string, NumericRangeDraft> = {}
  for (const clause of query.market) {
    if (isNumericClause(clause)) {
      marketNumeric[clause.field] = numericClauseToRange(clause)
    }
  }

  const fundamentalsNumeric: Record<string, NumericRangeDraft> = {}
  for (const clause of query.fundamentals) {
    fundamentalsNumeric[clause.field] = numericClauseToRange(clause)
  }

  const firstSort = query.sort[0] ?? DEFAULT_SORT
  return {
    universe,
    marketNumeric,
    fundamentalsNumeric,
    sort: { field: firstSort.field, direction: firstSort.direction },
    limit: query.page.limit,
    offset: query.page.offset ?? 0,
  }
}

function isNumericClause(clause: ScreenerClause): clause is NumericClause {
  // Discriminate by absence of `values` rather than presence of
  // min/max — a NumericClause is allowed by the type to have neither
  // bound (the validator forbids it, but the type doesn't), and that
  // empty case should still resolve to numeric.
  return !('values' in clause)
}

function numericClauseToRange(clause: NumericClause): NumericRangeDraft {
  return {
    min: clause.min === undefined ? '' : String(clause.min),
    max: clause.max === undefined ? '' : String(clause.max),
  }
}
