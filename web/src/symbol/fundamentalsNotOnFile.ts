import { NotOnFileError } from '../fetch/resource.ts'

// The fundamentals service answers a lookup it holds no data for with HTTP 404
// and an unavailable envelope (services/fundamentals/src/http.ts,
// statusForUnavailable). That is an answer, not a failure: Retry can't help.
export async function notOnFileError(res: Response): Promise<NotOnFileError | null> {
  if (res.status !== 404) return null
  let body: { unavailable?: { reason?: unknown; retryable?: unknown; detail?: unknown } } | null
  try {
    body = await res.json()
  } catch {
    return null
  }
  const unavailable = body?.unavailable
  if (unavailable?.reason !== 'missing_coverage' || unavailable.retryable !== false) return null
  return new NotOnFileError(typeof unavailable.detail === 'string' ? unavailable.detail : 'not on file')
}
