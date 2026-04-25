// Client for the watchlists service (fra-6al.6.1). Endpoints live at
// /v1/watchlists/default/*; the caller threads x-user-id from the session
// context. Real auth (bearer JWT) replaces the header stub in fra-6al.6.3.

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

export type WatchlistMember = {
  subject_ref: SubjectRef
  created_at: string
}

export type AddMemberResult = {
  status: 'created' | 'already_present'
  member: WatchlistMember
}

type FetchImpl = typeof fetch

type CallArgs = {
  userId: string
  endpoint?: string
  fetchImpl?: FetchImpl
  signal?: AbortSignal
}

function baseHeaders(userId: string): HeadersInit {
  return {
    'x-user-id': userId,
  }
}

export async function listManualWatchlistMembers(
  args: CallArgs,
): Promise<WatchlistMember[]> {
  const base = args.endpoint ?? '/v1/watchlists/default/members'
  const response = await (args.fetchImpl ?? fetch)(base, {
    headers: baseHeaders(args.userId),
    signal: args.signal,
  })
  if (!response.ok) {
    throw new Error(`list watchlist members failed with HTTP ${response.status}`)
  }
  const body = (await response.json()) as { members: WatchlistMember[] }
  return body.members
}

export async function addManualWatchlistMember(
  args: CallArgs & { subject_ref: SubjectRef },
): Promise<AddMemberResult> {
  const base = args.endpoint ?? '/v1/watchlists/default/members'
  const response = await (args.fetchImpl ?? fetch)(base, {
    method: 'POST',
    headers: {
      ...baseHeaders(args.userId),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ subject_ref: args.subject_ref }),
    signal: args.signal,
  })
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`add watchlist member failed with HTTP ${response.status}`)
  }
  return (await response.json()) as AddMemberResult
}

export async function removeManualWatchlistMember(
  args: CallArgs & { subject_ref: SubjectRef },
): Promise<void> {
  const { kind, id } = args.subject_ref
  const base =
    args.endpoint ??
    `/v1/watchlists/default/members/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
  const response = await (args.fetchImpl ?? fetch)(base, {
    method: 'DELETE',
    headers: baseHeaders(args.userId),
    signal: args.signal,
  })
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`remove watchlist member failed with HTTP ${response.status}`)
  }
}

export function mergeMemberIntoList(
  members: WatchlistMember[],
  result: AddMemberResult,
): WatchlistMember[] {
  if (result.status === 'already_present') return members
  const existing = members.find(
    (m) =>
      m.subject_ref.kind === result.member.subject_ref.kind &&
      m.subject_ref.id === result.member.subject_ref.id,
  )
  if (existing) return members
  return [...members, result.member]
}

export function removeMemberFromList(
  members: WatchlistMember[],
  subjectRef: SubjectRef,
): WatchlistMember[] {
  return members.filter(
    (m) => !(m.subject_ref.kind === subjectRef.kind && m.subject_ref.id === subjectRef.id),
  )
}
