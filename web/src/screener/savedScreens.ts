// Saved-screen HTTP client (cw0.8.2).
//
// The screener service exposes one CRUD surface for `screen` subjects
// at `/v1/screener/screens/*` (see services/screener/src/http.ts).
// Frontend usage is gated behind the auth interrupt: callers must hold
// a session before any of these endpoints are reached. Server-side
// auth enforcement lands with the real auth backend; for now the
// gating happens here through `requestProtectedAction`.

import type { ScreenerQuery, ScreenerResponse } from './contracts.ts'

const SCREENER_API_BASE = '/v1/screener'

export type ScreenSubject = {
  screen_id: string
  name: string
  definition: ScreenerQuery
  created_at: string
  updated_at: string
}

export type SaveScreenResult = {
  status: 'created' | 'replaced'
  screen: ScreenSubject
}

export class SavedScreensFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SavedScreensFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

type CommonArgs = {
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: args.signal,
  })
  if (!response.ok) {
    throw new SavedScreensFetchError(
      response.status,
      (await readErrorMessage(response)) ?? `save screen failed with HTTP ${response.status}`,
    )
  }
  return (await response.json()) as SaveScreenResult
}

export async function listSavedScreens(args: CommonArgs = {}): Promise<ScreenSubject[]> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url = args.endpoint ?? `${SCREENER_API_BASE}/screens`
  const response = await fetchImpl(url, { method: 'GET', signal: args.signal })
  if (!response.ok) {
    throw new SavedScreensFetchError(
      response.status,
      (await readErrorMessage(response)) ?? `list screens failed with HTTP ${response.status}`,
    )
  }
  const body = (await response.json()) as { screens: ScreenSubject[] }
  return body.screens
}

export async function getSavedScreen(
  args: { screen_id: string } & CommonArgs,
): Promise<ScreenSubject> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url =
    args.endpoint ?? `${SCREENER_API_BASE}/screens/${encodeURIComponent(args.screen_id)}`
  const response = await fetchImpl(url, { method: 'GET', signal: args.signal })
  if (!response.ok) {
    throw new SavedScreensFetchError(
      response.status,
      (await readErrorMessage(response)) ?? `get screen failed with HTTP ${response.status}`,
    )
  }
  const body = (await response.json()) as { screen: ScreenSubject }
  return body.screen
}

export async function deleteSavedScreen(
  args: { screen_id: string } & CommonArgs,
): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url =
    args.endpoint ?? `${SCREENER_API_BASE}/screens/${encodeURIComponent(args.screen_id)}`
  const response = await fetchImpl(url, { method: 'DELETE', signal: args.signal })
  // 204 No Content (the documented success path) and 404 (already gone)
  // both leave the user in the same observable state — no record by
  // that id. Treating 404 as success here keeps optimistic-delete UX
  // simple without a separate retry path.
  if (!response.ok && response.status !== 404) {
    throw new SavedScreensFetchError(
      response.status,
      (await readErrorMessage(response)) ?? `delete screen failed with HTTP ${response.status}`,
    )
  }
}

export async function replaySavedScreen(
  args: { screen_id: string } & CommonArgs,
): Promise<ScreenerResponse> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url =
    args.endpoint ??
    `${SCREENER_API_BASE}/screens/${encodeURIComponent(args.screen_id)}/replay`
  const response = await fetchImpl(url, { method: 'POST', signal: args.signal })
  if (!response.ok) {
    throw new SavedScreensFetchError(
      response.status,
      (await readErrorMessage(response)) ?? `replay screen failed with HTTP ${response.status}`,
    )
  }
  return (await response.json()) as ScreenerResponse
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body?.error === 'string' && body.error.length > 0 ? body.error : null
  } catch {
    return null
  }
}
