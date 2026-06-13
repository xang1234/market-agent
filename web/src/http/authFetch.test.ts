import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authenticatedFetch,
  authenticatedHeaders,
  authenticatedJson,
  HttpJsonError,
} from './authFetch.ts'

const USER_ID = '11111111-1111-4111-8111-111111111111'

test('authenticatedHeaders adds x-user-id without dropping caller headers', () => {
  assert.deepEqual(authenticatedHeaders(USER_ID, { 'content-type': 'application/json' }), {
    'content-type': 'application/json',
    'x-user-id': USER_ID,
  })
})

test('authenticatedFetch threads explicit user id through fetch implementation', async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init })
    return Response.json({ ok: true })
  }

  await authenticatedFetch('/v1/example', {
    userId: USER_ID,
    fetchImpl,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })

  assert.equal(calls[0].input, '/v1/example')
  assert.deepEqual(calls[0].init?.headers, {
    'content-type': 'application/json',
    'x-user-id': USER_ID,
  })
})

test('authenticatedJson throws HttpJsonError with parsed response body', async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ error: 'nope' }, { status: 403 })

  await assert.rejects(
    authenticatedJson('/v1/example', { userId: USER_ID, fetchImpl }),
    (error: unknown) =>
      error instanceof HttpJsonError &&
      error.status === 403 &&
      error.message === 'nope' &&
      JSON.stringify(error.body) === JSON.stringify({ error: 'nope' }),
  )
})

test('authenticatedJson throws on 2xx responses without a JSON body', async () => {
  // A 200 with an HTML body is what a dev-server SPA fallback returns when an
  // API path is not proxied; surfacing null instead of throwing turns that
  // misconfiguration into an opaque TypeError at the call site.
  const fetchImpl: typeof fetch = async () =>
    new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })

  await assert.rejects(
    authenticatedJson('/v1/example', { userId: USER_ID, fetchImpl }),
    (error: unknown) =>
      error instanceof HttpJsonError &&
      error.status === 200 &&
      /expected a JSON response/i.test(error.message),
  )
})
