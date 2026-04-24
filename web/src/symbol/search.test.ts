import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSymbolTypeaheadState,
  moveSymbolTypeaheadHighlight,
  planSymbolResolution,
  selectedSymbolCandidate,
  symbolDetailPathForSubject,
  subjectRouteParam,
  type ResolvedSubject,
} from './search.ts'

const appleListing: ResolvedSubject = {
  subject_ref: {
    kind: 'listing',
    id: '11111111-1111-4111-a111-111111111111',
  },
  display_name: 'Apple Inc.',
  confidence: 0.95,
  display_labels: {
    primary: 'Apple Inc.',
    ticker: 'AAPL',
    mic: 'XNAS',
  },
  resolution_path: 'auto_advanced',
}

const appleFrankfurt: ResolvedSubject = {
  subject_ref: {
    kind: 'listing',
    id: '22222222-2222-4222-a222-222222222222',
  },
  display_name: 'Apple Inc. Frankfurt',
  confidence: 0.71,
  display_labels: {
    primary: 'Apple Inc.',
    ticker: 'APC',
    mic: 'XFRA',
  },
}

test('subjectRouteParam encodes canonical subject refs without ticker shortcuts', () => {
  assert.equal(
    subjectRouteParam(appleListing.subject_ref),
    'listing%3A11111111-1111-4111-a111-111111111111',
  )
  assert.equal(
    symbolDetailPathForSubject(appleListing.subject_ref),
    '/symbol/listing%3A11111111-1111-4111-a111-111111111111/overview',
  )
})

test('planSymbolResolution auto-enters unique resolved subjects', () => {
  const plan = planSymbolResolution({
    subjects: [appleListing],
    unresolved: [],
  })

  assert.deepEqual(plan, {
    state: 'enter_subject',
    subject: appleListing,
    to: '/symbol/listing%3A11111111-1111-4111-a111-111111111111/overview',
  })
})

test('planSymbolResolution requires explicit choice for ambiguous candidates', () => {
  const plan = planSymbolResolution({
    subjects: [appleListing, appleFrankfurt],
    unresolved: [],
  })

  assert.deepEqual(plan, {
    state: 'needs_choice',
    candidates: [appleListing, appleFrankfurt],
  })
})

test('planSymbolResolution stops hydration for not found input', () => {
  const plan = planSymbolResolution({
    subjects: [],
    unresolved: ['NOTREAL'],
  })

  assert.deepEqual(plan, {
    state: 'not_found',
    unresolved: 'NOTREAL',
  })
})

test('typeahead highlight moves with arrow keys and wraps over ranked candidates', () => {
  const initial = createSymbolTypeaheadState([appleListing, appleFrankfurt])

  assert.equal(initial.highlightedIndex, 0)
  assert.equal(selectedSymbolCandidate(initial), appleListing)

  const next = moveSymbolTypeaheadHighlight(initial, 'next')
  assert.equal(next.highlightedIndex, 1)
  assert.equal(selectedSymbolCandidate(next), appleFrankfurt)

  const wrappedNext = moveSymbolTypeaheadHighlight(next, 'next')
  assert.equal(wrappedNext.highlightedIndex, 0)

  const wrappedPrevious = moveSymbolTypeaheadHighlight(wrappedNext, 'previous')
  assert.equal(wrappedPrevious.highlightedIndex, 1)
})
