export type FetchImpl = typeof fetch

export type AuthFetchInit = Omit<RequestInit, 'headers'> & {
  headers?: HeadersInit
  userId: string
  fetchImpl?: FetchImpl
}

export class HttpJsonError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message = httpJsonErrorMessage(status, body)) {
    super(message)
    this.name = 'HttpJsonError'
    this.status = status
    this.body = body
  }
}

export function authenticatedHeaders(userId: string, headers: HeadersInit = {}): HeadersInit {
  return {
    ...headersToRecord(headers),
    'x-user-id': userId,
  }
}

export async function authenticatedFetch(input: RequestInfo | URL, init: AuthFetchInit): Promise<Response> {
  const { userId, fetchImpl = fetch, headers, ...requestInit } = init
  return fetchImpl(input, {
    ...requestInit,
    headers: authenticatedHeaders(userId, headers),
  })
}

export async function authenticatedJson<T>(
  input: RequestInfo | URL,
  init: AuthFetchInit,
): Promise<T> {
  const response = await authenticatedFetch(input, init)
  const body = await readJsonBody(response)
  if (!response.ok) throw new HttpJsonError(response.status, body)
  return body as T
}

export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function headersToRecord(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return { ...headers }
}

function httpJsonErrorMessage(status: number, body: unknown): string {
  if (body !== null && typeof body === 'object') {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string' && error.length > 0) return error
    const message = (body as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return `HTTP ${status}`
}
