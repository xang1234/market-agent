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
  const decoded = decodeURIComponent(param ?? '')
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
  const subjectRef = parseSubjectRouteParam(param)
  return {
    subject_ref: subjectRef,
    display_name: displaySubjectRef(subjectRef),
    confidence: 1,
    display_labels: {
      primary: displaySubjectRef(subjectRef),
    },
  }
}

export function isResolvedSubject(value: unknown): value is ResolvedSubject {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return isSubjectRef(obj.subject_ref) && typeof obj.display_name === 'string'
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
    highlightedIndex: candidates.length > 0 ? 0 : -1,
  }
}

export function moveSymbolTypeaheadHighlight(
  state: SymbolTypeaheadState,
  direction: 'next' | 'previous',
): SymbolTypeaheadState {
  if (state.candidates.length === 0) {
    return { ...state, highlightedIndex: -1 }
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

function isSubjectRef(value: unknown): value is SubjectRef {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.id === 'string' && typeof obj.kind === 'string' && isSubjectKind(obj.kind)
}

function isSubjectKind(value: string): value is SubjectKind {
  return (SUBJECT_KINDS as readonly string[]).includes(value)
}
