import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHAT_ROLES } from './messageTypes.ts'

const CHAT_DIR = dirname(fileURLToPath(import.meta.url))
const BACKEND_MESSAGES_PATH = join(CHAT_DIR, '../../../services/chat/src/messages.ts')

test('CHAT_ROLES mirrors the backend ChatRole union exactly', () => {
  // Static text scan because node:test --experimental-strip-types cannot pull
  // the backend tsconfig into the web build.
  const source = readFileSync(BACKEND_MESSAGES_PATH, 'utf-8')
  const match = source.match(/export type ChatRole\s*=\s*([^;]+);/)
  assert.ok(match, 'could not locate `export type ChatRole = …;` in backend messages.ts')

  const backendRoles = Array.from(match[1].matchAll(/["']([a-zA-Z0-9._]+)["']/g))
    .map((m) => m[1])
    .sort()
  // Fail loud if the regex matches nothing — silent zero-match would still
  // pass deepEqual against an empty CHAT_ROLES, hiding both drifts.
  assert.ok(
    backendRoles.length > 0,
    'backend ChatRole regex matched zero roles — quote/syntax drift',
  )

  assert.deepEqual(
    [...CHAT_ROLES].sort(),
    backendRoles,
    'frontend CHAT_ROLES drifted from backend ChatRole union',
  )
})
