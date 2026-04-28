// Shared fetch primitives for the screener client modules.
// Both `searchScreener.ts` and `savedScreens.ts` go through this so the
// error class and the response-detail extractor stay in one place.

export const SCREENER_API_BASE = '/v1/screener'

export class ScreenerFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ScreenerFetchError'
    this.status = status
  }
}

export async function readScreenerErrorMessage(response: Response): Promise<string | null> {
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
