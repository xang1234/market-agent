// Saved-screen HTTP client (cw0.8.2).
//
// The screener service exposes one CRUD surface for `screen` subjects
// at `/v1/screener/screens/*` (see services/screener/src/http.ts).
// Frontend usage is gated behind the auth interrupt: callers must hold
// a session before any of these endpoints are reached. Server-side
// auth enforcement lands with the real auth backend; for now the
// gating happens here through `requestProtectedAction`.

import type { ScreenerQuery } from './contracts.ts'
import {
  readScreenerErrorMessage,
  SCREENER_API_BASE,
  ScreenerFetchError,
} from './screenerFetch.ts'

export type ScreenSubject = {
  screen_id: string
  user_id: string
  name: string
  definition: ScreenerQuery
  created_at: string
  updated_at: string
}

export type SaveScreenResult = {
  status: 'created' | 'replaced'
  screen: ScreenSubject
}

type FetchImpl = typeof fetch

type CommonArgs = {
  userId?: string
  endpoint?: string
  fetchImpl?: FetchImpl
  signal?: AbortSignal
}

export async function saveScreen(
  args: { name: string; definition: ScreenerQuery; screen_id?: string } & CommonArgs,
): Promise<SaveScreenResult> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url = args.endpoint ?? `${SCREENER_API_BASE}/screens`
  const body: Record<string, unknown> = {
    name: args.name,
    definition: args.definition,
  }
  if (args.screen_id) body.screen_id = args.screen_id

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: screenHeaders(args.userId),
    body: JSON.stringify(body),
    signal: args.signal,
  })
  if (!response.ok) {
    throw new ScreenerFetchError(
      response.status,
      (await readScreenerErrorMessage(response)) ??
        `save screen failed with HTTP ${response.status}`,
    )
  }
  return (await response.json()) as SaveScreenResult
}

export async function listSavedScreens(args: CommonArgs = {}): Promise<ScreenSubject[]> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url = args.endpoint ?? `${SCREENER_API_BASE}/screens`
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: userHeaders(args.userId),
    signal: args.signal,
  })
  if (!response.ok) {
    throw new ScreenerFetchError(
      response.status,
      (await readScreenerErrorMessage(response)) ??
        `list screens failed with HTTP ${response.status}`,
    )
  }
  const body = (await response.json()) as { screens: ScreenSubject[] }
  return body.screens
}

export async function deleteSavedScreen(
  args: { screen_id: string } & CommonArgs,
): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url =
    args.endpoint ?? `${SCREENER_API_BASE}/screens/${encodeURIComponent(args.screen_id)}`
  const response = await fetchImpl(url, {
    method: 'DELETE',
    headers: userHeaders(args.userId),
    signal: args.signal,
  })
  // 204 No Content (the documented success path) and 404 (already gone)
  // both leave the user in the same observable state — no record by
  // that id. Treating 404 as success here keeps optimistic-delete UX
  // simple without a separate retry path.
  if (!response.ok && response.status !== 404) {
    throw new ScreenerFetchError(
      response.status,
      (await readScreenerErrorMessage(response)) ??
        `delete screen failed with HTTP ${response.status}`,
    )
  }
}

function screenHeaders(userId: string | undefined): HeadersInit {
  return userId
    ? { 'content-type': 'application/json', 'x-user-id': userId }
    : { 'content-type': 'application/json' }
}

function userHeaders(userId: string | undefined): HeadersInit | undefined {
  return userId ? { 'x-user-id': userId } : undefined
}
