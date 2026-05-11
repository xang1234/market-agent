import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SUBJECT_KINDS,
  formatSubjectRef,
  isSubjectRef,
  parseSubjectRefString,
} from './subjectRef.ts'

const workspaceRoot = join(import.meta.dirname, '..', '..', '..')
const blockSchemaPath = join(workspaceRoot, 'spec', 'finance_research_block_schema.json')
const backendSubjectRefPath = join(workspaceRoot, 'services', 'shared', 'src', 'subject-ref.ts')
const VALID_ID = '11111111-1111-4111-8111-111111111111'

test('SUBJECT_KINDS matches backend shared identity and the block schema', () => {
  const schema = JSON.parse(readFileSync(blockSchemaPath, 'utf8')) as {
    $defs: { SubjectKind: { enum: string[] } }
  }
  const backendSource = readFileSync(backendSubjectRefPath, 'utf8')
  const backendKinds = parseBackendSubjectKinds(backendSource)

  assert.deepEqual([...SUBJECT_KINDS], backendKinds)
  assert.deepEqual([...SUBJECT_KINDS], schema.$defs.SubjectKind.enum)
})

test('web SubjectRef helpers accept only canonical UUID identity', () => {
  const ref = { kind: 'issuer' as const, id: VALID_ID }
  assert.equal(isSubjectRef(ref), true)
  assert.equal(formatSubjectRef(ref), `issuer:${VALID_ID}`)
  assert.deepEqual(parseSubjectRefString(`issuer:${VALID_ID}`), ref)
})

test('web SubjectRef parser rejects non-canonical route input', () => {
  assert.equal(isSubjectRef({ kind: 'listing', id: 'AAPL' }), false)
  assert.equal(parseSubjectRefString('AAPL'), null)
  assert.equal(parseSubjectRefString('listing:AAPL'), null)
  assert.equal(parseSubjectRefString(`ticker:${VALID_ID}`), null)
})

function parseBackendSubjectKinds(source: string): string[] {
  const match = source.match(/export const SUBJECT_KINDS = \[([\s\S]*?)\] as const;/)
  assert.ok(match, 'backend SUBJECT_KINDS constant should be parseable')
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}
