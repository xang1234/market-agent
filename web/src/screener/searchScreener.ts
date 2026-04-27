import type { ScreenerQuery, ScreenerResponse } from './contracts.ts'

const SCREENER_API_BASE = '/v1/screener'

export class ScreenerFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ScreenerFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

type SearchScreenerArgs = {
  query: ScreenerQuery
  endpoint?: string
  fetchImpl?: FetchImpl
  signal?: AbortSignal
}

export async function searchScreener(
  args: SearchScreenerArgs,
): Promise<ScreenerResponse> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url = args.endpoint ?? `${SCREENER_API_BASE}/search`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args.query),
    signal: args.signal,
  })
  if (!response.ok) {
    const detail = await safeReadErrorMessage(response)
    throw new ScreenerFetchError(
      response.status,
      detail ?? `screener search failed with HTTP ${response.status}`,
    )
  }
  // The server validates and freezes the envelope before sending; the UI
  // trusts the response shape and reads it as ScreenerResponse without
  // re-running the contract assertions client-side.
  return (await response.json()) as ScreenerResponse
}

async function safeReadErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body?.error === 'string' && body.error.length > 0) {
      return body.error
    }
    return null
  } catch {
    return null
  }
}
