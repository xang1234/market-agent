import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDefaultQueryDraft,
  draftToQuery,
  queryToDraft,
  setLimit,
  setNumericRange,
  setOffset,
  setSort,
  setUniverseSelection,
} from './queryDraft.ts'
import { SCREENER_LIMIT_MAX, type ScreenerQuery } from './contracts.ts'

test('default draft converts to a valid query with non-empty sort and default limit', () => {
  const query = draftToQuery(createDefaultQueryDraft())
  assert.deepEqual(query.universe, [])
  assert.deepEqual(query.market, [])
  assert.deepEqual(query.fundamentals, [])
  assert.equal(query.sort.length, 1)
  assert.deepEqual(query.sort[0], { field: 'market_cap', direction: 'desc' })
  assert.equal(query.page.limit, 50)
  // offset = 0 omits the field; the server treats absent offset as 0.
  assert.ok(!('offset' in query.page))
})

test('universe selection with values appears in the envelope; empty selection is dropped', () => {
  let draft = createDefaultQueryDraft()
  draft = setUniverseSelection(draft, 'asset_type', ['common_stock', 'etf'])
  draft = setUniverseSelection(draft, 'sector', [])
  const query = draftToQuery(draft)
  assert.deepEqual(query.universe, [{ field: 'asset_type', values: ['common_stock', 'etf'] }])
})

test('numeric range with empty min and max produces no clause', () => {
  let draft = createDefaultQueryDraft()
  draft = setNumericRange(draft, 'fundamentals', 'market_cap', { min: '', max: '' })
  const query = draftToQuery(draft)
  assert.deepEqual(query.fundamentals, [])
})

test('numeric range with only min becomes a min-only clause', () => {
  let draft = createDefaultQueryDraft()
  draft = setNumericRange(draft, 'fundamentals', 'market_cap', { min: '1e9', max: '' })
  const query = draftToQuery(draft)
  assert.equal(query.fundamentals.length, 1)
  assert.deepEqual(query.fundamentals[0], { field: 'market_cap', min: 1e9 })
})

test('numeric range with both bounds becomes a bounded clause on the right dimension', () => {
  let draft = createDefaultQueryDraft()
  draft = setNumericRange(draft, 'market', 'change_pct', { min: '-0.05', max: '0.1' })
  const query = draftToQuery(draft)
  assert.deepEqual(query.market, [{ field: 'change_pct', min: -0.05, max: 0.1 }])
  assert.deepEqual(query.fundamentals, [])
})

test('non-numeric strings in min/max are treated as empty', () => {
  let draft = createDefaultQueryDraft()
  draft = setNumericRange(draft, 'fundamentals', 'pe_ratio', { min: 'abc', max: '' })
  const query = draftToQuery(draft)
  assert.deepEqual(query.fundamentals, [])
})

test('setSort overrides the sort spec; output still has exactly one entry', () => {
  let draft = createDefaultQueryDraft()
  draft = setSort(draft, { field: 'change_pct', direction: 'asc' })
  const query = draftToQuery(draft)
  assert.deepEqual(query.sort, [{ field: 'change_pct', direction: 'asc' }])
})

test('setLimit clamps to the screener service bounds', () => {
  let draft = createDefaultQueryDraft()
  draft = setLimit(draft, 0)
  assert.equal(draftToQuery(draft).page.limit, 1)
  draft = setLimit(draft, SCREENER_LIMIT_MAX + 9999)
  assert.equal(draftToQuery(draft).page.limit, SCREENER_LIMIT_MAX)
})

test('setOffset > 0 surfaces in the envelope; setOffset(0) omits the field', () => {
  let draft = createDefaultQueryDraft()
  draft = setOffset(draft, 100)
  let query = draftToQuery(draft)
  assert.equal(query.page.offset, 100)
  draft = setOffset(draft, 0)
  query = draftToQuery(draft)
  assert.ok(!('offset' in query.page))
})

test('mutating any filter resets offset so pagination cannot show the wrong page', () => {
  // Why: the user paged forward (offset=100), then tightens the
  // filter — total_count likely shrinks below 100 and the new
  // page would be empty. Resetting offset to 0 keeps the user on
  // the first page of the refined result.
  let draft = createDefaultQueryDraft()
  draft = setOffset(draft, 100)
  draft = setUniverseSelection(draft, 'asset_type', ['common_stock'])
  assert.equal(draft.offset, 0)

  draft = setOffset(draft, 100)
  draft = setNumericRange(draft, 'fundamentals', 'market_cap', { min: '1e9', max: '' })
  assert.equal(draft.offset, 0)

  draft = setOffset(draft, 100)
  draft = setSort(draft, { field: 'volume', direction: 'asc' })
  assert.equal(draft.offset, 0)
})

test('clearing both bounds removes the field from draft state too', () => {
  let draft = createDefaultQueryDraft()
  draft = setNumericRange(draft, 'fundamentals', 'pe_ratio', { min: '5', max: '50' })
  assert.ok('pe_ratio' in draft.fundamentalsNumeric)
  draft = setNumericRange(draft, 'fundamentals', 'pe_ratio', { min: '', max: '' })
  assert.ok(!('pe_ratio' in draft.fundamentalsNumeric))
})

test('queryToDraft restores a draft that round-trips back to the same envelope', () => {
  let draft = createDefaultQueryDraft()
  draft = setUniverseSelection(draft, 'asset_type', ['common_stock', 'etf'])
  draft = setNumericRange(draft, 'market', 'change_pct', { min: '-0.05', max: '0.1' })
  draft = setNumericRange(draft, 'fundamentals', 'market_cap', { min: '1000000000', max: '' })
  draft = setSort(draft, { field: 'volume', direction: 'asc' })
  draft = setLimit(draft, 100)
  draft = setOffset(draft, 50)

  const original = draftToQuery(draft)
  const restored = draftToQuery(queryToDraft(original))

  assert.deepEqual(restored, original)
})

test('queryToDraft loads a server envelope into a workspace-renderable draft', () => {
  const query: ScreenerQuery = {
    universe: [{ field: 'sector', values: ['Technology'] }],
    market: [{ field: 'last_price', min: 10, max: 1000 }],
    fundamentals: [{ field: 'pe_ratio', max: 30 }],
    sort: [{ field: 'market_cap', direction: 'desc' }],
    page: { limit: 25, offset: 75 },
  }
  const draft = queryToDraft(query)

  assert.deepEqual(draft.universe, { sector: ['Technology'] })
  assert.deepEqual(draft.marketNumeric, { last_price: { min: '10', max: '1000' } })
  assert.deepEqual(draft.fundamentalsNumeric, { pe_ratio: { min: '', max: '30' } })
  assert.deepEqual(draft.sort, { field: 'market_cap', direction: 'desc' })
  assert.equal(draft.limit, 25)
  assert.equal(draft.offset, 75)
})

test('queryToDraft drops market enum clauses the workspace cannot render today', () => {
  // delay_class is a registered enum field on the market dimension
  // (services/screener/src/fields.ts), but the workspace UI exposes
  // only numeric market filters. Restoration silently drops what it
  // cannot show — the saved screen on the backend keeps the clause.
  const query: ScreenerQuery = {
    universe: [],
    market: [{ field: 'delay_class', values: ['real_time'] }],
    fundamentals: [],
    sort: [{ field: 'market_cap', direction: 'desc' }],
    page: { limit: 10 },
  }
  const draft = queryToDraft(query)

  assert.deepEqual(draft.marketNumeric, {})
})
