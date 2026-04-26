import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchStatements,
  findLineValue,
  recentFyPeriods,
  StatementsFetchError,
  type GetStatementsRequest,
  type GetStatementsResponse,
  type NormalizedStatement,
} from './statements.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const FIXTURE_SOURCE_ID = '00000000-0000-4000-a000-000000000005'

const baseStatement: NormalizedStatement = {
  subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
  family: 'income',
  basis: 'as_reported',
  period_kind: 'fiscal_y',
  period_start: '2023-10-01',
  period_end: '2024-09-28',
  fiscal_year: 2024,
  fiscal_period: 'FY',
  reporting_currency: 'USD',
  as_of: '2024-11-01T20:30:00.000Z',
  reported_at: '2024-11-01T20:30:00.000Z',
  source_id: FIXTURE_SOURCE_ID,
  lines: [
    { metric_key: 'revenue', value_num: 391_035_000_000, unit: 'currency', currency: 'USD', scale: 1, coverage_level: 'full' },
    { metric_key: 'gross_profit', value_num: 180_683_000_000, unit: 'currency', currency: 'USD', scale: 1, coverage_level: 'full' },
    { metric_key: 'eps_diluted', value_num: 6.08, unit: 'currency_per_share', currency: 'USD', scale: 1, coverage_level: 'full' },
  ],
}

function appleRequest(periods: string[]): GetStatementsRequest {
  return {
    subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
    statement: 'income',
    periods,
    basis: 'as_reported',
  }
}

test('recentFyPeriods returns N most-recent FY period strings, newest first', () => {
  assert.deepEqual(recentFyPeriods(2024, 5), ['2024-FY', '2023-FY', '2022-FY', '2021-FY', '2020-FY'])
  assert.deepEqual(recentFyPeriods(2024, 1), ['2024-FY'])
  assert.deepEqual(recentFyPeriods(2024, 0), [])
})

test('fetchStatements POSTs JSON, sends the binding query, and returns the GetStatementsResponse', async () => {
  const query = appleRequest(['2024-FY'])
  const wireResponse: GetStatementsResponse = {
    query,
    results: [{ period: '2024-FY', outcome: { outcome: 'available', data: baseStatement } }],
  }

  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = input.toString()
    capturedInit = init
    return new Response(JSON.stringify(wireResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const out = await fetchStatements(query, { fetchImpl })
  assert.equal(out.results.length, 1)
  assert.equal(capturedUrl, '/v1/fundamentals/statements')
  assert.equal(capturedInit?.method, 'POST')
  assert.deepEqual(JSON.parse((capturedInit?.body as string) ?? ''), query)
})

test('fetchStatements throws StatementsFetchError on non-2xx with the status code', async () => {
  const fetchImpl: typeof fetch = async () => new Response('{}', { status: 400 })
  await assert.rejects(
    () => fetchStatements(appleRequest(['2024-FY']), { fetchImpl }),
    (err: unknown) => err instanceof StatementsFetchError && err.status === 400,
  )
})

test('findLineValue returns the value × scale for the matching metric_key', () => {
  assert.equal(findLineValue(baseStatement, 'revenue'), 391_035_000_000)
  assert.equal(findLineValue(baseStatement, 'eps_diluted'), 6.08)
})

test('findLineValue returns null for missing metric_key, missing statement, or null value_num', () => {
  assert.equal(findLineValue(baseStatement, 'cost_of_revenue'), null)
  assert.equal(findLineValue(null, 'revenue'), null)
  assert.equal(findLineValue(undefined, 'revenue'), null)
  const sparse: NormalizedStatement = {
    ...baseStatement,
    lines: [{ ...baseStatement.lines[0], value_num: null, coverage_level: 'sparse' }],
  }
  assert.equal(findLineValue(sparse, 'revenue'), null)
})

test('findLineValue honors the scale field when value_num × scale != value_num', () => {
  const scaled: NormalizedStatement = {
    ...baseStatement,
    lines: [{ metric_key: 'revenue', value_num: 391, unit: 'currency', currency: 'USD', scale: 1_000_000_000, coverage_level: 'full' }],
  }
  assert.equal(findLineValue(scaled, 'revenue'), 391_000_000_000)
})
