import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHAT_ROLES } from './messageTypes.ts'

const CHAT_DIR = dirname(fileURLToPath(import.meta.url))
const BACKEND_MESSAGES_PATH = join(CHAT_DIR, '../../../services/chat/src/messages.ts')

test('CHAT_ROLES mirrors the backend ChatRole union exactly', () => {
  // Backend is the source of truth (services/chat/src/messages.ts:34). Static
  // text scan keeps the mirror honest without pulling backend tsconfig into
  // the web build. If the backend adds a role the wire payload may carry it
  // before the frontend can render it — fail loud here so the gap is caught
  // in CI rather than at runtime.
  const source = readFileSync(BACKEND_MESSAGES_PATH, 'utf-8')
  const match = source.match(/export type ChatRole\s*=\s*([^;]+);/)
  assert.ok(match, 'could not locate `export type ChatRole = …;` in backend messages.ts')

  const backendRoles = Array.from(match[1].matchAll(/"([a-z_]+)"/g))
    .map((m) => m[1])
    .sort()

  assert.deepEqual(
    [...CHAT_ROLES].sort(),
    backendRoles,
    'frontend CHAT_ROLES drifted from backend ChatRole union',
  )
})
