import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchIssuerProfile,
  issuerIdFromSubject,
  ProfileFetchError,
  profileBelongsToIssuer,
  type IssuerProfile,
} from './profile.ts'
import type { ResolvedSubject } from './search.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const APPLE_LISTING_ID = '11111111-1111-4111-a111-111111111111'
const FUNDAMENTALS_SOURCE_ID = '00000000-0000-4000-a000-000000000002'

const baseProfile: IssuerProfile = {
  subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
  legal_name: 'Apple Inc.',
  former_names: [],
  cik: '0000320193',
  lei: 'HWUPKR0MPOU8FGXBT394',
  domicile: 'US',
  sector: 'Technology',
  industry: 'Consumer Electronics',
  exchanges: [
    {
      listing: { kind: 'listing', id: APPLE_LISTING_ID },
      mic: 'XNAS',
      ticker: 'AAPL',
      trading_currency: 'USD',
      timezone: 'America/New_York',
    },
  ],
  as_of: '2026-04-26T15:30:00.000Z',
  source_id: FUNDAMENTALS_SOURCE_ID,
}

test('issuerIdFromSubject returns the subject id for an issuer-kind subject', () => {
  const subject: ResolvedSubject = {
    subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
    display_name: 'Apple Inc.',
    confidence: 1,
  }
  assert.equal(issuerIdFromSubject(subject), APPLE_ISSUER_ID)
})

test('issuerIdFromSubject pulls the issuer linkage from a hydrated listing subject', () => {
  const subject: ResolvedSubject = {
    subject_ref: { kind: 'listing', id: APPLE_LISTING_ID },
    display_name: 'Apple Inc.',
    confidence: 1,
    context: {
      issuer: {
        subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
        legal_name: 'Apple Inc.',
      },
    },
  }
  assert.equal(issuerIdFromSubject(subject), APPLE_ISSUER_ID)
})

test('issuerIdFromSubject returns null for a bare listing subject without context', () => {
  const subject: ResolvedSubject = {
    subject_ref: { kind: 'listing', id: APPLE_LISTING_ID },
    display_name: 'Listing subject',
    confidence: 1,
  }
  assert.equal(issuerIdFromSubject(subject), null)
})

test('fetchIssuerProfile decodes the wire envelope and returns the profile', async () => {
  let calledUrl = ''
  const fetchImpl: typeof fetch = async (input) => {
    calledUrl = input.toString()
    return new Response(JSON.stringify({ profile: baseProfile }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const profile = await fetchIssuerProfile(APPLE_ISSUER_ID, { fetchImpl })
  assert.equal(profile.legal_name, 'Apple Inc.')
  assert.equal(profile.cik, '0000320193')
  assert.match(calledUrl, /\/v1\/fundamentals\/profile\?subject_kind=issuer&subject_id=/)
  assert.match(calledUrl, new RegExp(APPLE_ISSUER_ID))
})

test('fetchIssuerProfile throws ProfileFetchError on non-2xx with the status code', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'fundamentals profile unavailable' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  await assert.rejects(
    () => fetchIssuerProfile(APPLE_ISSUER_ID, { fetchImpl }),
    (err: unknown) => err instanceof ProfileFetchError && err.status === 404,
  )
})

test('fetchIssuerProfile url-encodes the issuer id', async () => {
  let calledUrl = ''
  const fetchImpl: typeof fetch = async (input) => {
    calledUrl = input.toString()
    return new Response(JSON.stringify({ profile: baseProfile }), { status: 200 })
  }
  await fetchIssuerProfile('weird/id with spaces', { fetchImpl })
  assert.match(calledUrl, /weird%2Fid%20with%20spaces/)
})

test('profileBelongsToIssuer rejects null/mismatched issuer ids', () => {
  const profile = { subject: { kind: 'issuer' as const, id: APPLE_ISSUER_ID } }
  assert.equal(profileBelongsToIssuer(profile, APPLE_ISSUER_ID), true)
  assert.equal(profileBelongsToIssuer(profile, null), false)
  assert.equal(profileBelongsToIssuer(profile, 'some-other-id'), false)
})
