// Explicit handoff from symbol detail (and other surfaces) into the
// top-level Analyze workspace. The contract (spec §3.4.4):
//   - Analyze stays a top-level workspace, never a nested symbol-detail tab.
//   - Symbol detail launches Analyze with carried SubjectRef context or an
//     explicit analyze intent.
//   - Subject identity is canonical (SubjectRef), not raw ticker text — the
//     handoff must not force Analyze to re-resolve from a string.
//
// The URL carries canonical identity (`subject=kind:uuid&intent=...`) so
// links survive reload and are shareable; React Router `state` carries the
// hydrated `ResolvedSubject` (display labels, exchanges, etc.) so the
// landing render can skip a round-trip through the resolver. Both halves
// are optional independently — a deep-linked share still resolves to a
// usable subject; an in-app navigation still uses canonical identity in
// the URL bar.

import {
  parseSubjectRefString,
  subjectFromRef,
  subjectFromRouterState,
  type ResolvedSubject,
  type SubjectRef,
} from '../symbol/search.ts'

export const ANALYZE_INTENTS = ['memo', 'compare', 'general'] as const
export type AnalyzeIntent = (typeof ANALYZE_INTENTS)[number]

export const ANALYZE_PATH = '/analyze'

const SUBJECT_PARAM = 'subject'
const INTENT_PARAM = 'intent'

export type AnalyzeEntryNavigation = {
  to: string
  state: { subject: ResolvedSubject }
}

export type AnalyzeEntryQuery = {
  subject_ref: SubjectRef | null
  intent: AnalyzeIntent | null
}

// Build the navigation target for opening Analyze with carried subject
// context. Pair the returned `to`/`state` with `<Link to={x.to} state={x.state}>`
// or `navigate(x.to, { state: x.state })` so the URL stays canonical and the
// hydrated subject avoids a re-resolution at the landing page.
export function analyzeEntryFromSubject(
  subject: ResolvedSubject,
  intent?: AnalyzeIntent,
): AnalyzeEntryNavigation {
  return {
    to: analyzePathForSubject(subject.subject_ref, intent),
    state: { subject },
  }
}

export function analyzePathForSubject(
  subjectRef: SubjectRef,
  intent?: AnalyzeIntent,
): string {
  const params = new URLSearchParams()
  params.set(SUBJECT_PARAM, `${subjectRef.kind}:${subjectRef.id}`)
  if (intent !== undefined) {
    params.set(INTENT_PARAM, intent)
  }
  return `${ANALYZE_PATH}?${params.toString()}`
}

// Decode the subject + intent from the Analyze URL. Returns nulls (rather
// than throwing) when fields are missing or malformed so the page can fall
// back to the empty-entry state instead of crashing on a bad share link.
export function parseAnalyzeQuery(searchParams: URLSearchParams): AnalyzeEntryQuery {
  const subjectParam = searchParams.get(SUBJECT_PARAM)
  // URLSearchParams.get already percent-decodes — pass straight to the
  // strict decoded-string parser; no second decodeURIComponent needed.
  const subject_ref = subjectParam === null ? null : parseSubjectRefString(subjectParam)
  const intentParam = searchParams.get(INTENT_PARAM)
  const intent: AnalyzeIntent | null = isAnalyzeIntent(intentParam) ? intentParam : null
  return { subject_ref, intent }
}

// Recover the richest available subject for a landing render. Prefers the
// hydrated ResolvedSubject from React Router state (in-app navigation),
// falls back to a minimal subject built from the URL's SubjectRef
// (deep-linked share / reload), and returns null if neither is present.
export function subjectFromAnalyzeEntry(
  query: AnalyzeEntryQuery,
  locationState: unknown,
): ResolvedSubject | null {
  const fromState = subjectFromRouterState(locationState)
  if (fromState !== null) return fromState
  return query.subject_ref === null ? null : subjectFromRef(query.subject_ref)
}

const INTENT_LABELS: Readonly<Record<AnalyzeIntent, string>> = {
  memo: 'Memo',
  compare: 'Comparison',
  general: 'General',
}

export function analyzeIntentLabel(intent: AnalyzeIntent): string {
  return INTENT_LABELS[intent]
}

function isAnalyzeIntent(value: unknown): value is AnalyzeIntent {
  return typeof value === 'string' && (ANALYZE_INTENTS as ReadonlyArray<string>).includes(value)
}
