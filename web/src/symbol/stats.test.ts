import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchKeyStats,
  formatStatValue,
  issuerIdForStats,
  StatsFetchError,
  statLabel,
  statsBelongToIssuer,
  type KeyStat,
  type KeyStatsEnvelope,
} from './stats.ts'
import type { ResolvedSubject } from './search.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const APPLE_LISTING_ID = '11111111-1111-4111-a111-111111111111'

function envelope(overrides: Partial<KeyStatsEnvelope> = {}): KeyStatsEnvelope {
  return {
    subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
    family: 'key_stats',
    basis: 'as_reported',
    period_kind: 'fiscal_y',
    period_start: '2023-10-01',
    period_end: '2024-09-28',
    fiscal_year: 2024,
    fiscal_period: 'FY',
    reporting_currency: 'USD',
    as_of: '2024-11-01T20:30:00.000Z',
    stats: [],
    ...overrides,
  }
}

test('issuerIdForStats matches issuerIdForProfile semantics for hydrated and bare subjects', () => {
  const issuerSubject: ResolvedSubject = {
    subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
    display_name: 'Apple Inc.',
    confidence: 1,
  }
  assert.equal(issuerIdForStats(issuerSubject), APPLE_ISSUER_ID)

  const bareListing: ResolvedSubject = {
    subject_ref: { kind: 'listing', id: APPLE_LISTING_ID },
    display_name: 'Listing subject',
    confidence: 1,
  }
  assert.equal(issuerIdForStats(bareListing), null)
})

test('fetchKeyStats unwraps the wire envelope into a KeyStatsEnvelope', async () => {
  let calledUrl = ''
  const wireEnvelope = envelope()
  const fetchImpl: typeof fetch = async (input) => {
    calledUrl = input.toString()
    return new Response(JSON.stringify({ stats: wireEnvelope }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const out = await fetchKeyStats(APPLE_ISSUER_ID, { fetchImpl })
  assert.equal(out.fiscal_year, 2024)
  assert.equal(out.subject.id, APPLE_ISSUER_ID)
  assert.match(calledUrl, /\/v1\/fundamentals\/stats\?subject_kind=issuer&subject_id=/)
})

test('fetchKeyStats throws StatsFetchError on non-2xx with the status code', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('{}', { status: 404 })
  await assert.rejects(
    () => fetchKeyStats(APPLE_ISSUER_ID, { fetchImpl }),
    (err: unknown) => err instanceof StatsFetchError && err.status === 404,
  )
})

test('statsBelongToIssuer rejects mismatched envelopes (would hide a stale fetch)', () => {
  const env = { subject: { kind: 'issuer' as const, id: APPLE_ISSUER_ID } }
  assert.equal(statsBelongToIssuer(env, APPLE_ISSUER_ID), true)
  assert.equal(statsBelongToIssuer(env, 'different-id'), false)
  assert.equal(statsBelongToIssuer(env, null), false)
})

test('statLabel returns a human label for every known stat key', () => {
  assert.equal(statLabel('gross_margin'), 'Gross margin')
  assert.equal(statLabel('operating_margin'), 'Operating margin')
  assert.equal(statLabel('net_margin'), 'Net margin')
  assert.equal(statLabel('revenue_growth_yoy'), 'Revenue growth (YoY)')
  assert.equal(statLabel('pe_ratio'), 'P/E (diluted)')
})

test("formatStatValue renders a percent for format_hint='percent'", () => {
  const stat: Pick<KeyStat, 'value_num' | 'format_hint'> = {
    value_num: 0.4621,
    format_hint: 'percent',
  }
  assert.equal(formatStatValue(stat), '46.21%')
})

test("formatStatValue renders a multiple suffix for format_hint='multiple'", () => {
  const stat: Pick<KeyStat, 'value_num' | 'format_hint'> = {
    value_num: 32.34,
    format_hint: 'multiple',
  }
  assert.equal(formatStatValue(stat), '32.34×')
})

test('formatStatValue renders an em-dash when value_num is null (sparse-coverage path)', () => {
  assert.equal(formatStatValue({ value_num: null, format_hint: 'percent' }), '—')
  assert.equal(formatStatValue({ value_num: null, format_hint: 'multiple' }), '—')
})
