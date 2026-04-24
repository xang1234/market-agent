import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearSymbolTypeaheadForQueryChange,
  createSymbolTypeaheadState,
  moveSymbolTypeaheadHighlight,
  parseSubjectRouteParam,
  planSymbolResolution,
  selectedSymbolCandidate,
  symbolDetailPathForSubject,
  subjectFromRouteParam,
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

test('typeahead does not preselect ambiguous candidates before explicit movement', () => {
  const initial = createSymbolTypeaheadState([appleListing, appleFrankfurt])

  assert.equal(initial.highlightedIndex, -1)
  assert.equal(selectedSymbolCandidate(initial), null)

  const next = moveSymbolTypeaheadHighlight(initial, 'next')
  assert.equal(next.highlightedIndex, 0)
  assert.equal(selectedSymbolCandidate(next), appleListing)

  const wrappedNext = moveSymbolTypeaheadHighlight(next, 'next')
  assert.equal(wrappedNext.highlightedIndex, 1)

  const wrappedPrevious = moveSymbolTypeaheadHighlight(wrappedNext, 'previous')
  assert.equal(wrappedPrevious.highlightedIndex, 0)
})

test('typeahead query edits clear candidates even when the next query is non-empty', () => {
  const current = createSymbolTypeaheadState([appleListing, appleFrankfurt])
  const next = clearSymbolTypeaheadForQueryChange(current, 'AAPX')

  assert.deepEqual(next, {
    candidates: [],
    highlightedIndex: -1,
  })
})

test('route fallback display avoids presenting raw subject refs as market labels', () => {
  const subject = subjectFromRouteParam('listing%3A11111111-1111-4111-a111-111111111111')

  assert.equal(subject.display_name, 'Listing subject')
  assert.deepEqual(subject.display_labels, {
    primary: 'Listing subject',
  })
})

test('parseSubjectRouteParam falls back without crashing on malformed percent-encoding', () => {
  const subjectRef = parseSubjectRouteParam('listing%ZZbroken')

  assert.equal(subjectRef.kind, 'listing')
  assert.equal(typeof subjectRef.id, 'string')
})
