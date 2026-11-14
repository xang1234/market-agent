import assert from 'node:assert/strict'
import test from 'node:test'

import { NotOnFileError } from '../fetch/resource.ts'
import { fetchConsensus } from './consensus.ts'
import { fetchEarnings } from './earnings.ts'
import { fetchHolders } from './holders.ts'
import { fetchIssuerProfile } from './profile.ts'
import { fetchSegments } from './segments.ts'
import { fetchKeyStats } from './stats.ts'

const ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'

// Every symbol-page card fed by the fundamentals service can get this envelope
// (services/fundamentals/src/http.ts statusForUnavailable: missing_coverage -> 404).
const FETCHERS: ReadonlyArray<[string, (fetchImpl: typeof fetch) => Promise<unknown>]> = [
  ['profile', (fetchImpl) => fetchIssuerProfile(ISSUER_ID, { fetchImpl })],
  ['stats', (fetchImpl) => fetchKeyStats(ISSUER_ID, { fetchImpl })],
  ['consensus', (fetchImpl) => fetchConsensus(ISSUER_ID, { fetchImpl })],
  ['earnings', (fetchImpl) => fetchEarnings(ISSUER_ID, { fetchImpl })],
  ['holders', (fetchImpl) => fetchHolders(ISSUER_ID, 'insider', { fetchImpl })],
  [
    'segments',
    (fetchImpl) =>
      fetchSegments(
        { subject_ref: { kind: 'issuer', id: ISSUER_ID }, axis: 'business', period: '2026-FY', basis: 'as_reported' },
        { fetchImpl },
      ),
  ],
]

function respond(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status })
}

const missingCoverage = (name: string) => ({
  error: `fundamentals ${name} unavailable`,
  unavailable: { outcome: 'unavailable', reason: 'missing_coverage', retryable: false, detail: `${name} not found` },
})

for (const [name, fetchOne] of FETCHERS) {
  test(`${name}: a missing_coverage 404 rejects as NotOnFileError with the server detail`, async () => {
    await assert.rejects(
      () => fetchOne(respond(404, missingCoverage(name))),
      (err: unknown) => err instanceof NotOnFileError && err.message === `${name} not found`,
    )
  })

  test(`${name}: a 404 without the envelope, or a retryable outage, stays a failure`, async () => {
    for (const fetchImpl of [
      respond(404, { error: 'not found' }),
      respond(503, { unavailable: { reason: 'stale_data', retryable: true } }),
      async () => new Response('not json', { status: 404 }),
    ]) {
      await assert.rejects(
        () => fetchOne(fetchImpl),
        (err: unknown) => err instanceof Error && !(err instanceof NotOnFileError),
      )
    }
  })
}
