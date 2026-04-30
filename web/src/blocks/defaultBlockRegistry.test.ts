import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CHART_COMPARISON_BLOCK_KINDS,
  NARRATIVE_LAYOUT_BLOCK_KINDS,
  RESEARCH_EVIDENCE_BLOCK_KINDS,
  TRUST_PROVENANCE_BLOCK_KINDS,
} from './types.ts'

// The default registry's composition chain (defaultBlockRegistry.ts ->
// register*Blocks.ts -> *.tsx components) cannot be loaded by node:test
// because --experimental-strip-types does not handle .tsx. So this suite
// drift-checks the chain by static text scan instead: schema enum ↔ typed
// kind-group constants ↔ register helpers ↔ composer. Every layer must
// agree, which is the actual fra-046 invariant ("adding a block kind is a
// single-registry change").

const BLOCKS_DIR = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(BLOCKS_DIR, '../../../spec/finance_research_block_schema.json')

const ALL_CATALOG_KINDS = [
  ...NARRATIVE_LAYOUT_BLOCK_KINDS,
  ...CHART_COMPARISON_BLOCK_KINDS,
  ...RESEARCH_EVIDENCE_BLOCK_KINDS,
  ...TRUST_PROVENANCE_BLOCK_KINDS,
]

function extractRegisteredKinds(filename: string): string[] {
  const source = readFileSync(join(BLOCKS_DIR, filename), 'utf-8')
  return Array.from(source.matchAll(/registry\.register\(\s*'([a-z_]+)'/g)).map((m) => m[1])
}

test('typed kind-group constants match the canonical schema enum exactly', () => {
  const schemaText = readFileSync(SCHEMA_PATH, 'utf-8')
  const schemaKinds = Array.from(
    schemaText.matchAll(/"kind":\s*\{\s*"const":\s*"([a-z_]+)"/g),
  )
    .map((m) => m[1])
    .sort()

  assert.deepEqual(
    [...ALL_CATALOG_KINDS].sort(),
    schemaKinds,
    'typed kind groups in types.ts must equal the schema enum — schema/types drift',
  )
})

test('each register*Blocks helper covers exactly the kinds in its typed group', () => {
  const cases: Array<{ filename: string; expected: readonly string[]; label: string }> = [
    { filename: 'registerNarrativeBlocks.ts', expected: NARRATIVE_LAYOUT_BLOCK_KINDS, label: 'narrative' },
    { filename: 'registerChartBlocks.ts', expected: CHART_COMPARISON_BLOCK_KINDS, label: 'chart' },
    {
      filename: 'registerResearchEvidenceBlocks.ts',
      expected: RESEARCH_EVIDENCE_BLOCK_KINDS,
      label: 'research_evidence',
    },
    {
      filename: 'registerTrustProvenanceBlocks.ts',
      expected: TRUST_PROVENANCE_BLOCK_KINDS,
      label: 'trust_provenance',
    },
  ]

  for (const { filename, expected, label } of cases) {
    const found = extractRegisteredKinds(filename).slice().sort()
    assert.deepEqual(
      found,
      [...expected].sort(),
      `${filename} (${label}) must register exactly its typed-group kinds — kind constant / register helper drift`,
    )
  }
})

test('defaultBlockRegistry composer invokes every register*Blocks helper', () => {
  const composer = readFileSync(join(BLOCKS_DIR, 'defaultBlockRegistry.ts'), 'utf-8')
  for (const helper of [
    'registerNarrativeBlockRenderers',
    'registerChartBlockRenderers',
    'registerResearchEvidenceBlockRenderers',
    'registerTrustProvenanceBlockRenderers',
  ]) {
    assert.ok(
      composer.includes(`${helper}(registry)`),
      `defaultBlockRegistry.ts must invoke ${helper}(registry) — composer/helper drift`,
    )
  }
})
