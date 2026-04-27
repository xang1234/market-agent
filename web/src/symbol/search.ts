export const SUBJECT_KINDS = [
  'issuer',
  'instrument',
  'listing',
  'theme',
  'macro_topic',
  'portfolio',
  'screen',
] as const

export type SubjectKind = (typeof SUBJECT_KINDS)[number]

export type SubjectRef = {
  kind: SubjectKind
  id: string
}

export type SubjectDisplayLabels = {
  primary: string
  legal_name?: string
  ticker?: string
  mic?: string
  share_class?: string
}

export type IssuerContext = {
  subject_ref: SubjectRef & { kind: 'issuer' }
  legal_name: string
  cik?: string
  lei?: string
  domicile?: string
  sector?: string
  industry?: string
}

export type InstrumentContext = {
  subject_ref: SubjectRef & { kind: 'instrument' }
  issuer_ref: SubjectRef & { kind: 'issuer' }
  asset_type: string
  share_class?: string
  isin?: string
}

export type ListingContext = {
  subject_ref: SubjectRef & { kind: 'listing' }
  instrument_ref: SubjectRef & { kind: 'instrument' }
  issuer_ref: SubjectRef & { kind: 'issuer' }
  mic: string
  ticker: string
  trading_currency: string
  timezone: string
  active_from?: string
  active_to?: string
}

export type HydratedSubjectContext = {
  issuer?: IssuerContext
  instrument?: InstrumentContext
  listing?: ListingContext
  active_listings?: ListingContext[]
}

export type ResolvedSubject = {
  subject_ref: SubjectRef
  display_name: string
  confidence: number
  alternatives?: SubjectRef[]
  identity_level?: SubjectKind
  display_label?: string
  display_labels?: SubjectDisplayLabels
  normalized_input?: string
  resolution_path?: 'auto_advanced' | 'explicit_choice'
  context?: HydratedSubjectContext
}

export type ResolveSubjectsResponse = {
  subjects: ResolvedSubject[]
  unresolved: string[]
}

export type SubjectChoice = {
  subject_ref: SubjectRef
}

export type SymbolResolutionPlan =
  | {
      state: 'enter_subject'
      subject: ResolvedSubject
      to: string
    }
  | {
      state: 'needs_choice'
      candidates: ResolvedSubject[]
    }
  | {
      state: 'not_found'
      unresolved: string
    }

export type SymbolTypeaheadState = {
  candidates: ResolvedSubject[]
  highlightedIndex: number
}

export function subjectRouteParam(subjectRef: SubjectRef): string {
  return encodeURIComponent(`${subjectRef.kind}:${subjectRef.id}`)
}

export function symbolDetailPathForSubject(subjectRef: SubjectRef): string {
  return `/symbol/${subjectRouteParam(subjectRef)}/overview`
}

export function parseSubjectRouteParam(param: string | undefined): SubjectRef {
  const raw = param ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const separator = decoded.indexOf(':')
  const kind = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)

  if (separator > 0 && isSubjectKind(kind) && id) {
    return { kind, id }
  }

  return {
    kind: 'listing',
    id: decoded || 'unknown',
  }
}

export function subjectFromRouteParam(param: string | undefined): ResolvedSubject {
  return subjectFromRef(parseSubjectRouteParam(param))
}

// Build a minimal ResolvedSubject from a bare SubjectRef. Shared between the
// URL-entered landing path (subjectFromRouteParam) and the watchlist row
// hydration path (fra-6al.6.2) so both feed createQuoteSnapshotStub with the
// same shape — the verification that row values equal landing values for the
// same subject reduces to a single derivation function over a single subject.
export function subjectFromRef(subjectRef: SubjectRef): ResolvedSubject {
  const displayName = routeFallbackDisplayName(subjectRef)
  return {
    subject_ref: subjectRef,
    display_name: displayName,
    confidence: 1,
    display_labels: {
      primary: displayName,
    },
  }
}

export function isResolvedSubject(value: unknown): value is ResolvedSubject {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return isSubjectRef(obj.subject_ref) && typeof obj.display_name === 'string'
}

// Shared narrower for React Router `state` payloads built via
// `navigate(path, { state: { subject } })` or `<Link state={{ subject }}>`.
// Returns null on shape mismatch so callers fall back to URL-based hydration
// instead of crashing on garbage state.
export function subjectFromRouterState(state: unknown): ResolvedSubject | null {
  if (typeof state !== 'object' || state === null) return null
  const subject = (state as { subject?: unknown }).subject
  return isResolvedSubject(subject) ? subject : null
}

// Strict counterpart to parseSubjectRouteParam: takes an already-decoded
// `kind:id` string (e.g. from `URLSearchParams.get`), returns null on
// anything that isn't a known SubjectKind paired with a non-empty id.
// `parseSubjectRouteParam` itself coerces malformed input into a
// `{kind: 'listing', id: '<raw>'}` fallback to support the legacy
// ticker-style `/symbol/AAPL` URL — surfaces that don't have that
// fallback contract (e.g. Analyze's `?subject=` query) should use this.
export function parseSubjectRefString(decoded: string): SubjectRef | null {
  const separator = decoded.indexOf(':')
  if (separator <= 0) return null
  const kind = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)
  if (id.length === 0) return null
  if (!isSubjectKind(kind)) return null
  return { kind, id }
}

export function planSymbolResolution(response: ResolveSubjectsResponse): SymbolResolutionPlan {
  if (response.subjects.length === 1) {
    const [subject] = response.subjects
    return {
      state: 'enter_subject',
      subject,
      to: symbolDetailPathForSubject(subject.subject_ref),
    }
  }

  if (response.subjects.length > 1) {
    return {
      state: 'needs_choice',
      candidates: response.subjects,
    }
  }

  return {
    state: 'not_found',
    unresolved: response.unresolved[0] ?? '',
  }
}

export function createSymbolTypeaheadState(
  candidates: ResolvedSubject[],
): SymbolTypeaheadState {
  return {
    candidates,
    highlightedIndex: candidates.length === 1 ? 0 : -1,
  }
}

export function moveSymbolTypeaheadHighlight(
  state: SymbolTypeaheadState,
  direction: 'next' | 'previous',
): SymbolTypeaheadState {
  if (state.candidates.length === 0) {
    return { ...state, highlightedIndex: -1 }
  }

  if (state.highlightedIndex < 0) {
    return {
      ...state,
      highlightedIndex: direction === 'next' ? 0 : state.candidates.length - 1,
    }
  }

  const delta = direction === 'next' ? 1 : -1
  const nextIndex =
    (state.highlightedIndex + delta + state.candidates.length) % state.candidates.length

  return {
    ...state,
    highlightedIndex: nextIndex,
  }
}

export function selectedSymbolCandidate(
  state: SymbolTypeaheadState,
): ResolvedSubject | null {
  if (state.highlightedIndex < 0) return null
  return state.candidates[state.highlightedIndex] ?? null
}

export function clearSymbolTypeaheadForQueryChange(
  state: SymbolTypeaheadState,
  nextQuery: string,
): SymbolTypeaheadState {
  if (state.candidates.length === 0 && !nextQuery.trim()) return state
  return createSymbolTypeaheadState([])
}

export async function resolveSubjects(args: {
  text: string
  choice?: SubjectChoice
  endpoint?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}): Promise<ResolveSubjectsResponse> {
  const response = await (args.fetchImpl ?? fetch)(args.endpoint ?? '/v1/subjects/resolve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: args.text,
      ...(args.choice ? { choice: args.choice } : {}),
    }),
    signal: args.signal,
  })

  if (!response.ok) {
    throw new Error(`subject resolve failed with HTTP ${response.status}`)
  }

  return (await response.json()) as ResolveSubjectsResponse
}

export function displaySubjectRef(subjectRef: SubjectRef): string {
  return `${subjectRef.kind}:${subjectRef.id}`
}

export function candidateListingLabel(subject: ResolvedSubject): string {
  const labels = subject.display_labels
  const ticker = labels?.ticker
  const mic = labels?.mic

  if (ticker && mic) return `${ticker} · ${mic}`
  if (ticker) return ticker
  return subject.identity_level ?? subject.subject_ref.kind
}

export function isSubjectRef(value: unknown): value is SubjectRef {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    obj.id.length > 0 &&
    typeof obj.kind === 'string' &&
    isSubjectKind(obj.kind)
  )
}

function isSubjectKind(value: string): value is SubjectKind {
  return (SUBJECT_KINDS as readonly string[]).includes(value)
}

function routeFallbackDisplayName(subjectRef: SubjectRef): string {
  const label = subjectRef.kind
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')

  return `${label} subject`
}
