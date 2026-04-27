import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchHolders,
  holdersBelongToIssuer,
  HoldersFetchError,
  insiderTransactionLabel,
  isInsiderHolders,
  isInstitutionalHolders,
  type InsiderHoldersEnvelope,
  type InstitutionalHoldersEnvelope,
} from './holders.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const SOURCE_ID = '00000000-0000-4000-a000-000000000008'

const institutionalEnvelope: InstitutionalHoldersEnvelope = {
  subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
  family: 'holders',
  kind: 'institutional',
  currency: 'USD',
  as_of: '2024-11-01T20:30:00.000Z',
  source_id: SOURCE_ID,
  holders: [
    {
      holder_name: 'Vanguard Group Inc',
      shares_held: 1_350_000_000,
      market_value: 305_100_000_000,
      percent_of_shares_outstanding: 8.94,
      shares_change: 12_000_000,
      filing_date: '2024-09-30',
    },
  ],
}

const insiderEnvelope: InsiderHoldersEnvelope = {
  subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
  family: 'holders',
  kind: 'insider',
  currency: 'USD',
  as_of: '2024-11-01T20:30:00.000Z',
  source_id: SOURCE_ID,
  holders: [
    {
      insider_name: 'COOK TIMOTHY D',
      insider_role: 'Chief Executive Officer',
      transaction_date: '2024-10-04',
      transaction_type: 'sell',
      shares: 223_986,
      price: 226.04,
      value: 50_628_113,
    },
  ],
}

test('fetchHolders issues a GET against /v1/fundamentals/holders with the kind query', async () => {
  let capturedUrl = ''
  const fetchImpl: typeof fetch = async (input) => {
    capturedUrl = input.toString()
    return new Response(JSON.stringify({ holders: institutionalEnvelope }), { status: 200 })
  }
  const out = await fetchHolders(APPLE_ISSUER_ID, 'institutional', { fetchImpl })
  assert.equal(out.subject.id, APPLE_ISSUER_ID)
  assert.equal(out.kind, 'institutional')
  assert.equal(
    capturedUrl,
    `/v1/fundamentals/holders?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}&kind=institutional`,
  )
})

test('fetchHolders unwraps the insider envelope shape distinctly from institutional', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ holders: insiderEnvelope }), { status: 200 })
  const out = await fetchHolders(APPLE_ISSUER_ID, 'insider', { fetchImpl })
  assert.equal(out.kind, 'insider')
  if (!isInsiderHolders(out)) throw new Error('expected insider kind')
  assert.equal(out.holders[0].insider_name, 'COOK TIMOTHY D')
  assert.equal(out.holders[0].transaction_type, 'sell')
})

test('fetchHolders throws HoldersFetchError on non-2xx with the status code', async () => {
  const fetchImpl: typeof fetch = async () => new Response('{}', { status: 404 })
  await assert.rejects(
    () => fetchHolders(APPLE_ISSUER_ID, 'institutional', { fetchImpl }),
    (err: unknown) => err instanceof HoldersFetchError && err.status === 404,
  )
})

test('holdersBelongToIssuer matches issuer id and rejects mismatches', () => {
  assert.equal(holdersBelongToIssuer(institutionalEnvelope, APPLE_ISSUER_ID), true)
  assert.equal(holdersBelongToIssuer(insiderEnvelope, APPLE_ISSUER_ID), true)
  assert.equal(holdersBelongToIssuer(institutionalEnvelope, 'other-id'), false)
  assert.equal(holdersBelongToIssuer(institutionalEnvelope, null), false)
})

test('isInstitutionalHolders and isInsiderHolders narrow exclusively', () => {
  assert.equal(isInstitutionalHolders(institutionalEnvelope), true)
  assert.equal(isInsiderHolders(institutionalEnvelope), false)
  assert.equal(isInstitutionalHolders(insiderEnvelope), false)
  assert.equal(isInsiderHolders(insiderEnvelope), true)
})

test('insiderTransactionLabel maps each enum to a human-readable string', () => {
  assert.equal(insiderTransactionLabel('buy'), 'Buy')
  assert.equal(insiderTransactionLabel('sell'), 'Sell')
  assert.equal(insiderTransactionLabel('option_exercise'), 'Option exercise')
  assert.equal(insiderTransactionLabel('gift'), 'Gift')
  assert.equal(insiderTransactionLabel('other'), 'Other')
})
