import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHAT_SSE_EVENT_TYPES } from './sseEventTypes.ts'

const CHAT_DIR = dirname(fileURLToPath(import.meta.url))
const BACKEND_SSE_PATH = join(CHAT_DIR, '../../../services/chat/src/sse.ts')

test('CHAT_SSE_EVENT_TYPES mirrors the backend CHAT_SSE_EVENT_TYPES exactly', () => {
  // Static text scan because node:test --experimental-strip-types cannot pull
  // the backend tsconfig into the web build.
  const source = readFileSync(BACKEND_SSE_PATH, 'utf-8')
  const match = source.match(
    /export const CHAT_SSE_EVENT_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/,
  )
  assert.ok(
    match,
    'could not locate `export const CHAT_SSE_EVENT_TYPES = [...] as const` in backend sse.ts',
  )

  const backendTypes = Array.from(match[1].matchAll(/["']([a-zA-Z0-9._]+)["']/g))
    .map((m) => m[1])
    .sort()
  assert.ok(
    backendTypes.length > 0,
    'backend CHAT_SSE_EVENT_TYPES regex matched zero types — quote/syntax drift',
  )

  assert.deepEqual(
    [...CHAT_SSE_EVENT_TYPES].sort(),
    backendTypes,
    'frontend CHAT_SSE_EVENT_TYPES drifted from backend',
  )
})
