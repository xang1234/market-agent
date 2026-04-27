import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeEntryFromSubject,
  analyzeIntentLabel,
  analyzePathForSubject,
  ANALYZE_INTENTS,
  ANALYZE_PATH,
  parseAnalyzeQuery,
  subjectFromAnalyzeEntry,
} from './analyzeEntry.ts'
import type { ResolvedSubject, SubjectRef } from '../symbol/search.ts'

const APPLE_REF: SubjectRef = {
  kind: 'issuer',
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1',
}

const APPLE_SUBJECT: ResolvedSubject = {
  subject_ref: APPLE_REF,
  display_name: 'Apple Inc.',
  confidence: 1,
  display_labels: { primary: 'Apple Inc.', ticker: 'AAPL', mic: 'XNAS' },
}

test('analyzePathForSubject encodes canonical SubjectRef into the analyze query', () => {
  const path = analyzePathForSubject(APPLE_REF)
  assert.equal(path, `${ANALYZE_PATH}?subject=issuer%3A${APPLE_REF.id}`)
})

test('analyzePathForSubject appends an explicit intent when provided', () => {
  const path = analyzePathForSubject(APPLE_REF, 'memo')
  assert.equal(path, `${ANALYZE_PATH}?subject=issuer%3A${APPLE_REF.id}&intent=memo`)
})

test('analyzeEntryFromSubject pairs a canonical URL with the hydrated subject as state', () => {
  const entry = analyzeEntryFromSubject(APPLE_SUBJECT, 'compare')
  assert.equal(entry.to, `${ANALYZE_PATH}?subject=issuer%3A${APPLE_REF.id}&intent=compare`)
  assert.equal(entry.state.subject, APPLE_SUBJECT)
})

test('parseAnalyzeQuery roundtrips subject_ref + intent built by analyzePathForSubject', () => {
  const path = analyzePathForSubject(APPLE_REF, 'general')
  const params = new URLSearchParams(path.split('?')[1])
  const parsed = parseAnalyzeQuery(params)
  assert.deepEqual(parsed.subject_ref, APPLE_REF)
  assert.equal(parsed.intent, 'general')
})

test('parseAnalyzeQuery returns nulls for an empty query so callers fall back to the empty entry', () => {
  const parsed = parseAnalyzeQuery(new URLSearchParams(''))
  assert.equal(parsed.subject_ref, null)
  assert.equal(parsed.intent, null)
})

test('parseAnalyzeQuery rejects an unknown intent string instead of carrying it through unchecked', () => {
  const params = new URLSearchParams(`subject=issuer:${APPLE_REF.id}&intent=mystery`)
  const parsed = parseAnalyzeQuery(params)
  assert.deepEqual(parsed.subject_ref, APPLE_REF)
  assert.equal(parsed.intent, null)
})

test('parseAnalyzeQuery returns null subject_ref for a malformed subject param so the page does not render phantom identity', () => {
  const params = new URLSearchParams('subject=not-a-valid-ref')
  const parsed = parseAnalyzeQuery(params)
  assert.equal(parsed.subject_ref, null)
})

test('parseAnalyzeQuery accepts intent without a subject (caller still falls back to empty entry for the subject half)', () => {
  const parsed = parseAnalyzeQuery(new URLSearchParams('intent=memo'))
  assert.equal(parsed.subject_ref, null)
  assert.equal(parsed.intent, 'memo')
})

test('subjectFromAnalyzeEntry prefers the hydrated subject from React Router state', () => {
  const query = parseAnalyzeQuery(new URLSearchParams(`subject=issuer:${APPLE_REF.id}`))
  const subject = subjectFromAnalyzeEntry(query, { subject: APPLE_SUBJECT })
  assert.equal(subject, APPLE_SUBJECT)
})

test('subjectFromAnalyzeEntry falls back to a minimal subject built from the URL when state is empty (deep-link / reload)', () => {
  const query = parseAnalyzeQuery(new URLSearchParams(`subject=issuer:${APPLE_REF.id}`))
  const subject = subjectFromAnalyzeEntry(query, null)
  assert.ok(subject !== null)
  assert.deepEqual(subject!.subject_ref, APPLE_REF)
})

test('subjectFromAnalyzeEntry returns null when neither state nor URL carry a subject', () => {
  const subject = subjectFromAnalyzeEntry(parseAnalyzeQuery(new URLSearchParams('')), null)
  assert.equal(subject, null)
})

test('subjectFromAnalyzeEntry ignores garbage React Router state without crashing', () => {
  const query = parseAnalyzeQuery(new URLSearchParams(''))
  assert.equal(subjectFromAnalyzeEntry(query, { subject: 'not a subject' }), null)
  assert.equal(subjectFromAnalyzeEntry(query, undefined), null)
  assert.equal(subjectFromAnalyzeEntry(query, 42), null)
})

test('ANALYZE_INTENTS lists every value accepted by parseAnalyzeQuery, and analyzeIntentLabel covers every value', () => {
  for (const intent of ANALYZE_INTENTS) {
    const params = new URLSearchParams(`subject=issuer:${APPLE_REF.id}&intent=${intent}`)
    assert.equal(parseAnalyzeQuery(params).intent, intent)
    assert.ok(analyzeIntentLabel(intent).length > 0)
  }
})
