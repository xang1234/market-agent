import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF_PATH = fileURLToPath(import.meta.url)
const BLOCKS_DIR = dirname(SELF_PATH)

const NON_CANONICAL_PATTERNS = [
  ['dataRef', /\bdataRef\b/],
  ['queryRef', /\bqueryRef\b/],
] as const

function isEmitterSource(name: string): boolean {
  const pathSegments = name.split(/[\\/]/)
  return (
    (name.endsWith('.ts') || name.endsWith('.tsx')) &&
    !name.includes('.test.') &&
    !name.includes('.spec.') &&
    !pathSegments.includes('__tests__')
  )
}

test('block emitter sources use the canonical data_ref naming', () => {
  const files = readdirSync(BLOCKS_DIR, { recursive: true, encoding: 'utf-8' })
    .filter(isEmitterSource)
    .map((name) => join(BLOCKS_DIR, name))
    .filter((path) => path !== SELF_PATH)
  assert.ok(files.length > 0, 'expected at least one emitter source to scan')
  const violations: Array<{ file: string; banned: string }> = []
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    for (const [banned, pattern] of NON_CANONICAL_PATTERNS) {
      if (pattern.test(content)) {
        violations.push({ file: relative(BLOCKS_DIR, file), banned })
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    'Found non-canonical camelCase ref aliases in block emitter sources; replace with canonical snake_case names.',
  )
})
