// Client for the watchlists service (fra-6al.6.1). Endpoints live at
// /v1/watchlists/default/*; the caller threads x-user-id from the session
// context. Real auth (bearer JWT) replaces the header stub in fra-6al.6.3.

import {
  isSubjectRef,
  SUBJECT_KINDS,
  type SubjectKind,
  type SubjectRef,
} from '../subject/subjectRef.ts'
import { authenticatedFetch, HttpJsonError, readJsonBody, type FetchImpl } from '../http/authFetch.ts'

export { SUBJECT_KINDS, type SubjectKind, type SubjectRef }

export type WatchlistMember = {
  subject_ref: SubjectRef
  created_at: string
}

export type AddMemberResult = {
  status: 'created' | 'already_present'
  member: WatchlistMember
}

type CallArgs = {
  userId: string
  endpoint?: string
  fetchImpl?: FetchImpl
  signal?: AbortSignal
}

export async function listManualWatchlistMembers(
  args: CallArgs,
): Promise<WatchlistMember[]> {
  const base = args.endpoint ?? '/v1/watchlists/default/members'
  const response = await authenticatedFetch(base, {
    userId: args.userId,
    fetchImpl: args.fetchImpl,
    signal: args.signal,
  })
  if (!response.ok) {
    throw new HttpJsonError(response.status, await readJsonBody(response), `list watchlist members failed with HTTP ${response.status}`)
  }
  const body = (await response.json()) as { members?: unknown }
  if (!Array.isArray(body.members) || !body.members.every(isWatchlistMember)) {
    throw new Error('list watchlist members returned malformed members')
  }
  return body.members
}

export async function addManualWatchlistMember(
  args: CallArgs & { subject_ref: SubjectRef },
): Promise<AddMemberResult> {
  const base = args.endpoint ?? '/v1/watchlists/default/members'
  const response = await authenticatedFetch(base, {
    userId: args.userId,
    fetchImpl: args.fetchImpl,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ subject_ref: args.subject_ref }),
    signal: args.signal,
  })
  if (response.status !== 200 && response.status !== 201) {
    throw new HttpJsonError(response.status, await readJsonBody(response), `add watchlist member failed with HTTP ${response.status}`)
  }
  const body = await response.json()
  if (!isAddMemberResult(body)) {
    throw new Error('add watchlist member returned malformed result')
  }
  return body
}

export async function removeManualWatchlistMember(
  args: CallArgs & { subject_ref: SubjectRef },
): Promise<void> {
  const { kind, id } = args.subject_ref
  const base =
    args.endpoint ??
    `/v1/watchlists/default/members/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
  const response = await authenticatedFetch(base, {
    userId: args.userId,
    fetchImpl: args.fetchImpl,
    method: 'DELETE',
    signal: args.signal,
  })
  if (response.status !== 204 && response.status !== 404) {
    throw new HttpJsonError(response.status, await readJsonBody(response), `remove watchlist member failed with HTTP ${response.status}`)
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

function isWatchlistMember(value: unknown): value is WatchlistMember {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return isSubjectRef(obj.subject_ref) && typeof obj.created_at === 'string'
}

function isAddMemberResult(value: unknown): value is AddMemberResult {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (obj.status === 'created' || obj.status === 'already_present') &&
    isWatchlistMember(obj.member)
}
