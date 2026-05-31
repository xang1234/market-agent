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

const COPPER_REF: SubjectRef = {
  kind: 'commodity',
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1',
}

const COPPER_SUBJECT: ResolvedSubject = {
  subject_ref: COPPER_REF,
  display_name: 'Copper',
  confidence: 1,
  display_labels: { primary: 'Copper' },
}

test('analyzePathForSubject encodes canonical SubjectRef into the analyze query', () => {
  const path = analyzePathForSubject(COPPER_REF)
  assert.equal(path, `${ANALYZE_PATH}?subject=commodity%3A${COPPER_REF.id}`)
})

test('analyzePathForSubject appends an explicit intent when provided', () => {
  const path = analyzePathForSubject(COPPER_REF, 'memo')
  assert.equal(path, `${ANALYZE_PATH}?subject=commodity%3A${COPPER_REF.id}&intent=memo`)
})

test('analyzeEntryFromSubject pairs a canonical URL with the hydrated subject as state', () => {
  const entry = analyzeEntryFromSubject(COPPER_SUBJECT, 'compare')
  assert.equal(entry.to, `${ANALYZE_PATH}?subject=commodity%3A${COPPER_REF.id}&intent=compare`)
  assert.equal(entry.state.subject, COPPER_SUBJECT)
})

test('parseAnalyzeQuery roundtrips subject_ref + intent built by analyzePathForSubject', () => {
  const path = analyzePathForSubject(COPPER_REF, 'general')
  const params = new URLSearchParams(path.split('?')[1])
  const parsed = parseAnalyzeQuery(params)
  assert.deepEqual(parsed.subject_ref, COPPER_REF)
  assert.equal(parsed.intent, 'general')
})

test('parseAnalyzeQuery returns nulls for an empty query so callers fall back to the empty entry', () => {
  const parsed = parseAnalyzeQuery(new URLSearchParams(''))
  assert.equal(parsed.subject_ref, null)
  assert.equal(parsed.intent, null)
})

test('parseAnalyzeQuery rejects an unknown intent string instead of carrying it through unchecked', () => {
  const params = new URLSearchParams(`subject=commodity:${COPPER_REF.id}&intent=mystery`)
  const parsed = parseAnalyzeQuery(params)
  assert.deepEqual(parsed.subject_ref, COPPER_REF)
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
  const query = parseAnalyzeQuery(new URLSearchParams(`subject=commodity:${COPPER_REF.id}`))
  const subject = subjectFromAnalyzeEntry(query, { subject: COPPER_SUBJECT })
  assert.equal(subject, COPPER_SUBJECT)
})

test('subjectFromAnalyzeEntry falls back to a minimal subject built from the URL when state is empty (deep-link / reload)', () => {
  const query = parseAnalyzeQuery(new URLSearchParams(`subject=commodity:${COPPER_REF.id}`))
  const subject = subjectFromAnalyzeEntry(query, null)
  assert.ok(subject !== null)
  assert.deepEqual(subject!.subject_ref, COPPER_REF)
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
    const params = new URLSearchParams(`subject=commodity:${COPPER_REF.id}&intent=${intent}`)
    assert.equal(parseAnalyzeQuery(params).intent, intent)
    assert.ok(analyzeIntentLabel(intent).length > 0)
  }
})
