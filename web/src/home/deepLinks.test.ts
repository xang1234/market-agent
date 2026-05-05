import assert from 'node:assert/strict'
import test from 'node:test'
import { homeCardPath, type HomeCardDestination } from './deepLinks.ts'

const LISTING_REF = {
  kind: 'listing',
  id: '55555555-5555-4555-a555-555555555555',
} as const

test('homeCardPath maps symbol earnings destinations to the symbol earnings tab', () => {
  const destination: HomeCardDestination = {
    kind: 'symbol',
    subject_ref: LISTING_REF,
    tab: 'earnings',
  }

  assert.equal(
    homeCardPath(destination),
    '/symbol/listing%3A55555555-5555-4555-a555-555555555555/earnings',
  )
})

test('homeCardPath maps Analyze memo destinations through the existing Analyze entry URL', () => {
  const destination: HomeCardDestination = {
    kind: 'analyze',
    subject_ref: LISTING_REF,
    intent: 'memo',
  }

  assert.equal(
    homeCardPath(destination),
    '/analyze?subject=listing%3A55555555-5555-4555-a555-555555555555&intent=memo',
  )
})

test('homeCardPath does not invent routes for theme or none destinations', () => {
  assert.equal(
    homeCardPath({
      kind: 'theme',
      subject_ref: {
        kind: 'theme',
        id: '77777777-7777-4777-a777-777777777777',
      },
    }),
    null,
  )
  assert.equal(homeCardPath({ kind: 'none', reason: 'missing_destination' }), null)
})
