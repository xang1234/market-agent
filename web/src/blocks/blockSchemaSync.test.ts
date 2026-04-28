import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BLOCKS_DIR = dirname(fileURLToPath(import.meta.url))
const CANONICAL_SCHEMA_PATH = join(BLOCKS_DIR, '../../../spec/finance_research_block_schema.json')
const MIRRORED_SCHEMA_PATH = join(BLOCKS_DIR, 'blockSchema.json')

test('mirrored blockSchema.json matches the canonical spec/finance_research_block_schema.json byte-for-byte', () => {
  const canonical = readFileSync(CANONICAL_SCHEMA_PATH, 'utf-8')
  const mirrored = readFileSync(MIRRORED_SCHEMA_PATH, 'utf-8')
  assert.equal(
    mirrored,
    canonical,
    'web/src/blocks/blockSchema.json drifted from spec/finance_research_block_schema.json — run `npm run sync:schema` from web/ to refresh the mirror.',
  )
})
